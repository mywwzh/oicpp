// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';

interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
}

interface Response {
    ok: boolean;
    status: number;
    statusText: string | undefined;
    headers: {
        get: (name: string) => string | undefined;
    };
    body: unknown;
}

interface DownloadOptions {
    maxConcurrency?: number;
    chunkSize?: number;
    timeout?: number;
    retryCount?: number;
    minMultiThreadSize?: number;
    progressCallback?: (progress: {
        type: string;
        chunkIndex?: number;
        downloadedBytes?: number;
        totalBytes?: number;
        progress?: number;
        speed?: number;
        activeChunks?: number;
    }) => void;
}

interface ChunkPart {
    index: number;
    start: number;
    end: number;
}

interface ChunkResult {
    chunkIndex: number;
    file: string;
    size: number;
}

interface ProgressInfo {
    type: string;
    chunkIndex?: number;
    downloadedBytes?: number;
    totalBytes?: number;
    progress?: number;
    speed?: number;
    activeChunks?: number;
}

function makeRequest(url: string, options: RequestOptions = {}): Promise<Response> {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const requestOptions: https.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || 30000
        };

        const req = client.request(requestOptions, (res) => {
            resolve({
                ok: res.statusCode >= 200 && res.statusCode < 300,
                status: res.statusCode,
                statusText: res.statusMessage,
                headers: {
                    get: (name: string) => res.headers[name.toLowerCase()]
                },
                body: res
            });
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.end();
    });
}

class MultiThreadDownloader {
    private isCancelled: boolean = false;
    private cancelError: Error | null = null;
    private maxConcurrency: number = 16;
    private chunkSize: number = 1024 * 1024 * 2;
    private timeout: number = 30000;
    private retryCount: number = 8;
    private minMultiThreadSize: number = 1024 * 1024 * 2;
    private progressCallback: ((progress: ProgressInfo) => void) | null = null;

    constructor(options: DownloadOptions = {}) {
        this.isCancelled = false;
        this.cancelError = null;
        this.maxConcurrency = options.maxConcurrency || 16;
        this.chunkSize = options.chunkSize || 1024 * 1024 * 2;
        this.timeout = options.timeout || 30000;
        this.retryCount = options.retryCount || 8;
        this.minMultiThreadSize = options.minMultiThreadSize || 1024 * 1024 * 2;
        this.progressCallback = options.progressCallback || null;
    }

    cancel(): void {
        this.isCancelled = true;
        logInfo('[多线程下载] 下载已取消');
        this.cancelError = new Error('下载已取消');
    }

    async checkRangeSupport(url: string): Promise<boolean> {
        try {
            const headResponse = await makeRequest(url, {
                method: 'HEAD'
            });

            const acceptRanges = headResponse.headers.get('accept-ranges');
            if (acceptRanges === 'bytes') {
                return true;
            }

            const rangeResponse = await makeRequest(url, {
                headers: {
                    'Range': 'bytes=0-1'
                }
            });
            const isSupported = rangeResponse.status === 206;

            return isSupported;
        } catch (error) {
            logWarn('[多线程下载] 检查范围请求支持失败:', (error as Error).message);
            return false;
        }
    }

    async getFileSize(url: string): Promise<number | null> {
        try {
            const response = await makeRequest(url, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            return contentLength ? parseInt(contentLength) : null;
        } catch (error) {
            logWarn('[多线程下载] 获取文件大小失败:', (error as Error).message);
            return null;
        }
    }

    async downloadChunk(url: string, start: number, end: number, chunkIndex: number, tempDir: string): Promise<ChunkResult> {
        const chunkFile = path.join(tempDir, `chunk_${chunkIndex}.tmp`);
        let retries = 0;

        while (retries < this.retryCount) {
            if (this.isCancelled) throw new Error('下载已取消');
            try {
                const rangeHeader = `bytes=${start}-${end}`;

                const response = await makeRequest(url, {
                    headers: {
                        'Range': rangeHeader
                    },
                    timeout: this.timeout
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                if (response.status !== 206) {
                    const rangeError = new Error(`服务器未按范围请求返回数据（HTTP ${response.status}）`);
                    (rangeError as Record<string, unknown>).code = 'RANGE_NOT_SUPPORTED';
                    try { (response.body as { destroy?: () => void }).destroy?.(); } catch (_) { }
                    throw rangeError;
                }

                const writer = fs.createWriteStream(chunkFile);
                let downloadedBytes = 0;

                return new Promise<ChunkResult>((resolve, reject) => {
                    const body = response.body as { on: (event: string, listener: (...args: unknown[]) => void) => void };
                    body.on('data', (chunk: Buffer) => {
                        if (this.isCancelled) {
                            writer.end(() => {
                                if (fs.existsSync(chunkFile)) {
                                    fs.unlinkSync(chunkFile);
                                }
                            });
                            body.destroy?.();
                            return reject(this.cancelError || new Error('下载已取消'));
                        }
                        writer.write(chunk);
                        downloadedBytes += chunk.length;

                        if (this.progressCallback) {
                            this.progressCallback({
                                type: 'chunk',
                                chunkIndex,
                                downloadedBytes,
                                totalBytes: end - start + 1
                            });
                        }
                    });

                    body.on('end', () => {
                        writer.end((error: Error | null) => {
                            if (error) {
                                reject(error);
                            } else {
                                const expectedBytes = end - start + 1;
                                if (downloadedBytes !== expectedBytes) {
                                    const sizeError = new Error(`分片 ${chunkIndex} 大小异常（${downloadedBytes}/${expectedBytes}）`);
                                    (sizeError as Record<string, unknown>).code = 'RANGE_SIZE_MISMATCH';
                                    return reject(sizeError);
                                }
                                logInfo(`[多线程下载] 分片 ${chunkIndex} 下载完成`);
                                resolve({ chunkIndex, file: chunkFile, size: downloadedBytes });
                            }
                        });
                    });

                    body.on('error', (error: Error) => {
                        if (this.isCancelled) {
                            return reject(this.cancelError);
                        }
                        if (!writer.destroyed) {
                            writer.destroy();
                        }
                        reject(error);
                    });

                    writer.on('error', (error: Error) => {
                        if (this.isCancelled) {
                            return reject(this.cancelError);
                        }
                        reject(error);
                    });
                });

            } catch (error) {
                const err = error as Record<string, unknown>;
                if (err.code === 'RANGE_NOT_SUPPORTED' || err.code === 'RANGE_SIZE_MISMATCH') {
                    if (fs.existsSync(chunkFile)) {
                        try { fs.unlinkSync(chunkFile); } catch (_) { }
                    }
                    throw error;
                }

                retries++;

                const isNetworkError = err.code === 'ECONNRESET' ||
                    err.code === 'ENOTFOUND' ||
                    err.code === 'ETIMEDOUT' ||
                    err.code === 'ECONNREFUSED' ||
                    (err.message as string).includes('aborted') ||
                    (err.message as string).includes('timeout');

                if (isNetworkError) {
                    logWarn(`[多线程下载] 分片 ${chunkIndex} 网络错误 (尝试 ${retries}/${this.retryCount}):`, err.code || err.message);
                } else {
                    logWarn(`[多线程下载] 分片 ${chunkIndex} 下载失败 (尝试 ${retries}/${this.retryCount}):`, err.message);
                }

                if (fs.existsSync(chunkFile)) {
                    try {
                        fs.unlinkSync(chunkFile);
                    } catch (cleanupError) {
                        logWarn(`[多线程下载] 清理失败分片文件出错:`, (cleanupError as Error).message);
                    }
                }

                if (retries >= this.retryCount) {
                    throw new Error(`分片 ${chunkIndex} 下载失败: ${err.message}`);
                }

                let delay: number;
                if (isNetworkError) {
                    delay = Math.pow(2, retries) * 1000;
                    logInfo(`[多线程下载] 分片 ${chunkIndex} 网络错误，将在 ${delay / 1000}s 后重试`);
                } else {
                    delay = Math.pow(2, retries - 1) * 1000;
                    logInfo(`[多线程下载] 分片 ${chunkIndex} 将在 ${delay / 1000}s 后重试`);
                }

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        throw new Error('Unexpected exit from retry loop');
    }

    async mergeChunks(chunks: ChunkResult[], outputFile: string): Promise<void> {
        logInfo('[多线程下载] 开始合并分片文件');

        const writer = fs.createWriteStream(outputFile);

        try {
            for (const chunk of chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)) {
                const chunkData = fs.readFileSync(chunk.file);
                writer.write(chunkData);

                try {
                    fs.unlinkSync(chunk.file);
                } catch (error) {
                    logWarn(`[多线程下载] 删除临时文件失败:`, (error as Error).message);
                }
            }

            await new Promise<void>((resolve, reject) => {
                writer.end((error: Error | null) => {
                    if (error) reject(error);
                    else resolve();
                });
            });

            logInfo('[多线程下载] 分片合并完成');
        } finally {
            if (!writer.destroyed) {
                writer.destroy();
            }
        }
    }

    async downloadSingleThread(url: string, outputFile: string): Promise<void> {
        logInfo('[多线程下载] 使用单线程下载模式');

        const maxAttempts = Math.max(1, this.retryCount);
        let attempt = 0;
        let lastError: Error | null = null;

        while (attempt < maxAttempts) {
            attempt++;
            if (this.isCancelled) throw new Error('下载已取消');

            let response: Response | null = null;
            let writer: fs.WriteStream | null = null;
            let inactivityTimer: NodeJS.Timeout | null = null;
            let finished = false;

            try {
                response = await makeRequest(url, {
                    timeout: this.timeout * 3
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const totalSize = parseInt(response.headers.get('content-length') || '0');
                writer = fs.createWriteStream(outputFile);

                let downloadedBytes = 0;
                const startTime = Date.now();
                let lastProgressTime = startTime;

                const resetInactivityTimer = () => {
                    if (inactivityTimer) clearTimeout(inactivityTimer);
                    inactivityTimer = setTimeout(() => {
                        try { (response.body as { destroy?: (err?: Error) => void }).destroy?.(new Error('下载超时(无数据)')); } catch (_) { }
                    }, this.timeout);
                };

                resetInactivityTimer();

                const finishSuccessfully = () => {
                    if (finished) return;
                    finished = true;
                    if (inactivityTimer) clearTimeout(inactivityTimer);
                    try { writer?.end(() => { }); } catch (_) { }
                };

                await new Promise<void>((resolve, reject) => {
                    const body = response.body as { on: (event: string, listener: (...args: unknown[]) => void) => void };
                    body.on('data', (chunk: Buffer) => {
                        if (this.isCancelled) {
                            try { writer?.end(() => { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); }); } catch (_) { }
                            try { body.destroy?.(); } catch (_) { }
                            return reject(this.cancelError || new Error('下载已取消'));
                        }

                        resetInactivityTimer();
                        const canContinue = writer.write(chunk);
                        if (!canContinue) {
                            response.body.pause();
                            writer.once('drain', () => {
                                try { response.body.resume(); } catch (_) { }
                            });
                        }
                        downloadedBytes += chunk.length;

                        const now = Date.now();
                        if (now - lastProgressTime > 500) {
                            const progress = totalSize > 0 ? (downloadedBytes / totalSize) * 100 : 0;
                            const elapsed = (now - startTime) / 1000;
                            const speed = elapsed > 0 ? (downloadedBytes / elapsed) : 0;

                            logInfo(`[单线程下载] 进度: ${progress.toFixed(1)}%, 已下载: ${(downloadedBytes / 1024 / 1024).toFixed(1)}MB, 速度: ${(speed / 1024 / 1024).toFixed(1)}MB/s`);

                            if (this.progressCallback) {
                                this.progressCallback({
                                    type: 'single',
                                    downloadedBytes,
                                    totalBytes: totalSize,
                                    progress,
                                    speed
                                });
                            }

                            lastProgressTime = now;
                        }
                    });

                    body.on('end', () => {
                        finishSuccessfully();
                        const elapsed = Math.max(0.001, (Date.now() - startTime) / 1000);
                        if (this.progressCallback) {
                            this.progressCallback({
                                type: 'single',
                                downloadedBytes: totalSize || downloadedBytes,
                                totalBytes: totalSize || downloadedBytes,
                                progress: totalSize ? Math.min(100, (downloadedBytes / totalSize) * 100) : 100,
                                speed: downloadedBytes / elapsed
                            });
                        }
                        resolve();
                    });

                    body.on('close', () => {
                        if (!finished) {
                            return reject(new Error('连接关闭但未完成下载'));
                        }
                    });

                    body.on('error', (error: Error) => {
                        if (this.isCancelled) {
                            return reject(this.cancelError);
                        }
                        try { if (writer && !writer.destroyed) writer.destroy(); } catch (_) { }
                        reject(error);
                    });

                    writer.on('error', (error: Error) => {
                        if (this.isCancelled) {
                            return reject(this.cancelError);
                        }
                        reject(error);
                    });

                    writer.on('finish', () => {
                    });
                });

                try {
                    if (typeof totalSize === 'number' && totalSize > 0) {
                        const stat = fs.statSync(outputFile);
                        if (stat.size < totalSize) {
                            throw new Error(`文件大小不完整(${stat.size}/${totalSize})`);
                        }
                    }
                } catch (e) {
                    throw e;
                }
                return;
            } catch (error) {
                lastError = error as Error;
                logWarn(`[单线程下载] 失败(尝试 ${attempt}/${maxAttempts}):`, (error as Error)?.message || String(error));
                try { if (writer && !writer.destroyed) writer.destroy(); } catch (_) { }
                try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch (_) { }
                if (attempt < maxAttempts) {
                    const backoff = Math.min(8000, Math.pow(2, attempt - 1) * 1000);
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }
                throw error;
            } finally {
                try { if (writer && !writer.destroyed) writer.destroy(); } catch (_) { }
            }
        }

        throw lastError || new Error('单线程下载失败');
    }

    async download(url: string, outputFile: string, options: DownloadOptions = {}): Promise<void> {
        const startTime = Date.now();
        logInfo(`[多线程下载] 开始下载: ${url}`);

        if (!url || typeof url !== 'string') {
            throw new Error('下载URL无效或为空');
        }

        if (!outputFile || typeof outputFile !== 'string') {
            throw new Error('输出文件路径无效或为空');
        }

        try {
            const fileSize = await this.getFileSize(url);
            if (!fileSize) {
                logInfo('[多线程下载] 无法获取文件大小，使用单线程下载');
                await this.downloadSingleThread(url, outputFile);
                return;
            }

            logInfo(`[多线程下载] 文件大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB`);

            logInfo('[多线程下载] 检查服务器范围请求支持...');
            const supportsRange = await this.checkRangeSupport(url);
            logInfo(`[多线程下载] 范围请求支持检测结果: ${supportsRange}`);

            if (!supportsRange) {
                logInfo('[多线程下载] 服务器不支持范围请求，切换为单线程下载模式');
                await this.downloadSingleThread(url, outputFile);
                return;
            }

            if (fileSize < this.minMultiThreadSize) {
                logInfo('[多线程下载] 文件较小，使用单线程下载');
                await this.downloadSingleThread(url, outputFile);
                return;
            }

            const tempDir = path.join(path.dirname(outputFile), `temp_${Date.now()}`);
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            try {
                const totalParts = Math.ceil(fileSize / this.chunkSize);
                const parts: ChunkPart[] = [];
                for (let i = 0; i < totalParts; i++) {
                    const start = i * this.chunkSize;
                    const end = Math.min(start + this.chunkSize - 1, fileSize - 1);
                    parts.push({ index: i, start, end });
                }

                logInfo(`[多线程下载] 文件大小: ${(fileSize / 1024 / 1024).toFixed(2)} MB，分片数: ${totalParts}，每片 ${(this.chunkSize / 1024 / 1024).toFixed(2)} MB`);

                const originalCallback = this.progressCallback;
                const chunkProgress = new Array(totalParts).fill(0);
                let lastProgressReport = Date.now();
                let activeCount = 0;

                const reportMultiThreadProgress = () => {
                    const totalDownloaded = chunkProgress.reduce((sum, v) => sum + v, 0);
                    const percent = Math.min(100, (totalDownloaded / fileSize) * 100);
                    const elapsed = (Date.now() - startTime) / 1000;
                    const speed = elapsed > 0 ? (totalDownloaded / elapsed) : 0;
                    if (originalCallback) {
                        originalCallback({
                            type: 'multi',
                            downloadedBytes: totalDownloaded,
                            totalBytes: fileSize,
                            progress: percent,
                            speed,
                            activeChunks: activeCount
                        });
                    }
                };

                const enhancedProgressCallback = (progress: ProgressInfo) => {
                    if (progress.type === 'chunk') {
                        const safeDownloaded = Math.min(
                            typeof progress.downloadedBytes === 'number' ? progress.downloadedBytes : 0,
                            typeof progress.totalBytes === 'number' && isFinite(progress.totalBytes) ? progress.totalBytes : Infinity
                        );
                        chunkProgress[progress.chunkIndex as number] = safeDownloaded;
                        const now = Date.now();
                        if (now - lastProgressReport > 500) {
                            reportMultiThreadProgress();
                            lastProgressReport = now;
                        }
                    }
                };

                this.progressCallback = enhancedProgressCallback;

                const results = new Array<ChunkResult | undefined>(totalParts);
                let cursor = 0;

                const runWorker = async () => {
                    while (true) {
                        if (this.isCancelled) throw this.cancelError || new Error('下载已取消');
                        const idx = cursor++;
                        if (idx >= parts.length) break;
                        const myTask = parts[idx];
                        activeCount++;
                        try {
                            const r = await this.downloadChunk(url, myTask.start, myTask.end, myTask.index, tempDir);
                            results[myTask.index] = r;
                        } catch (e) {
                            throw e;
                        } finally {
                            activeCount--;
                        }
                    }
                };

                const workerCount = Math.min(this.maxConcurrency, parts.length);
                const workers = new Array(workerCount).fill(0).map(() => runWorker());
                await Promise.all(workers);

                this.progressCallback = originalCallback;
                reportMultiThreadProgress();
                if (originalCallback) {
                    originalCallback({
                        type: 'multi',
                        downloadedBytes: fileSize,
                        totalBytes: fileSize,
                        progress: 100,
                        speed: fileSize / Math.max(0.001, (Date.now() - startTime) / 1000),
                        activeChunks: 0
                    });
                }

                const completedChunks = results.filter(Boolean) as ChunkResult[];
                logInfo(`[多线程下载] 分片全部完成，准备合并 ${completedChunks.length} 个分片`);
                await this.mergeChunks(completedChunks, outputFile);

                // 合并后校验最终大小，避免静默产出损坏文件。
                const mergedStats = fs.statSync(outputFile);
                if (mergedStats.size !== fileSize) {
                    try { fs.unlinkSync(outputFile); } catch (_) { }
                    throw new Error(`合并后文件大小校验失败（${mergedStats.size}/${fileSize}）`);
                }

                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (error) {
                    logWarn('[多线程下载] 清理临时目录失败:', (error as Error).message);
                }

            } catch (error) {
                try {
                    if (fs.existsSync(tempDir)) {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    }
                } catch (cleanupError) {
                    logWarn('[多线程下载] 清理临时目录失败:', (cleanupError as Error).message);
                }
                const err = error as Record<string, unknown>;
                if (err.code === 'RANGE_NOT_SUPPORTED' || err.code === 'RANGE_SIZE_MISMATCH') {
                    logWarn('[多线程下载] 服务器未正确支持范围请求，回退到单线程下载:', err.message);
                    try { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); } catch (_) { }
                    await this.downloadSingleThread(url, outputFile);
                    return;
                }
                throw error;
            }

            const elapsed = (Date.now() - startTime) / 1000;
            const speed = fileSize / elapsed;
            const speedText = speed > 1024 * 1024
                ? `${(speed / 1024 / 1024).toFixed(1)} MB/s`
                : `${(speed / 1024).toFixed(0)} KB/s`;

            logInfo(`[多线程下载] 下载完成，耗时: ${elapsed.toFixed(1)}s，平均速度: ${speedText}`);

        } catch (error) {
            logError('[多线程下载] 下载失败:', error);
            throw error;
        }
    }

    async verifyFile(filePath: string, expectedMd5: string): Promise<boolean> {
        if (!expectedMd5) return true;

        try {
            const fileBuffer = fs.readFileSync(filePath);
            const actualMd5 = crypto.createHash('md5').update(fileBuffer).digest('hex');
            return actualMd5 === expectedMd5;
        } catch (error) {
            logError('[多线程下载] 文件验证失败:', (error as Error).message);
            return false;
        }
    }
}

export default MultiThreadDownloader;
