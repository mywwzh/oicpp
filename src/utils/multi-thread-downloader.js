const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const isHttps = urlObj.protocol === 'https:';
        const client = isHttps ? https : http;

        const requestOptions = {
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
                    get: (name) => res.headers[name.toLowerCase()]
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
    constructor(options = {}) {
        this.isCancelled = false;
        this.cancelError = null;
        this.maxConcurrency = options.maxConcurrency || 16; // 最大并发数
        this.chunkSize = options.chunkSize || 1024 * 1024 * 2; // 每个分片大小 (2MB)
        this.timeout = options.timeout || 30000; // 超时时间 (30秒)
        this.retryCount = options.retryCount || 8; // 增加重试次数到8次
        this.minMultiThreadSize = options.minMultiThreadSize || 1024 * 1024 * 2;
        this.progressCallback = options.progressCallback || (() => { });
    }

    cancel() {
        this.isCancelled = true;
        logInfo('[多线程下载] 下载已取消');
        this.cancelError = new Error('下载已取消');
    }


    async checkRangeSupport(url) {
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
            logWarn('[多线程下载] 检查范围请求支持失败:', error.message);
            return false;
        }
    }


    async getFileSize(url) {
        try {
            const response = await makeRequest(url, { method: 'HEAD' });
            const contentLength = response.headers.get('content-length');
            return contentLength ? parseInt(contentLength) : null;
        } catch (error) {
            logWarn('[多线程下载] 获取文件大小失败:', error.message);
            return null;
        }
    }


    async downloadChunk(url, start, end, chunkIndex, tempDir) {
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
                    logWarn(`[多线程下载] 警告：分片 ${chunkIndex} 未收到206状态码，可能服务器不支持范围请求`);
                }

                const writer = fs.createWriteStream(chunkFile);
                let downloadedBytes = 0;

                return new Promise((resolve, reject) => {
                    response.body.on('data', (chunk) => {
                        if (this.isCancelled) {
                            writer.end(() => {
                                if (fs.existsSync(chunkFile)) {
                                    fs.unlinkSync(chunkFile); // 清理文件
                                }
                            });
                            response.body.destroy();
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

                    response.body.on('end', () => {
                        writer.end((error) => {
                            if (error) {
                                reject(error);
                            } else {
                                logInfo(`[多线程下载] 分片 ${chunkIndex} 下载完成`);
                                resolve({ chunkIndex, file: chunkFile, size: downloadedBytes });
                            }
                        });
                    });

                    response.body.on('error', (error) => {
                        if (this.isCancelled) {
                            return reject(this.cancelError);
                        }
                        if (!writer.destroyed) {
                            writer.destroy();
                        }
                        reject(error);
                    });

                    writer.on('error', (error) => {
                        if (this.isCancelled) {
                            return reject(this.cancelError);
                        }
                        reject(error);
                    });
                });

            } catch (error) {
                retries++;

                const isNetworkError = error.code === 'ECONNRESET' ||
                    error.code === 'ENOTFOUND' ||
                    error.code === 'ETIMEDOUT' ||
                    error.code === 'ECONNREFUSED' ||
                    error.message.includes('aborted') ||
                    error.message.includes('timeout');

                if (isNetworkError) {
                    logWarn(`[多线程下载] 分片 ${chunkIndex} 网络错误 (尝试 ${retries}/${this.retryCount}):`, error.code || error.message);
                } else {
                    logWarn(`[多线程下载] 分片 ${chunkIndex} 下载失败 (尝试 ${retries}/${this.retryCount}):`, error.message);
                }

                if (fs.existsSync(chunkFile)) {
                    try {
                        fs.unlinkSync(chunkFile);
                    } catch (cleanupError) {
                        logWarn(`[多线程下载] 清理失败分片文件出错:`, cleanupError.message);
                    }
                }

                if (retries >= this.retryCount) {
                    throw new Error(`分片 ${chunkIndex} 下载失败: ${error.message}`);
                }

                let delay;
                if (isNetworkError) {
                    delay = Math.pow(2, retries) * 1000; // 2s, 4s, 8s, 16s
                    logInfo(`[多线程下载] 分片 ${chunkIndex} 网络错误，将在 ${delay / 1000}s 后重试`);
                } else {
                    delay = Math.pow(2, retries - 1) * 1000; // 1s, 2s, 4s, 8s
                    logInfo(`[多线程下载] 分片 ${chunkIndex} 将在 ${delay / 1000}s 后重试`);
                }

                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }


    async mergeChunks(chunks, outputFile) {
        logInfo('[多线程下载] 开始合并分片文件');

        const writer = fs.createWriteStream(outputFile);

        try {
            for (const chunk of chunks.sort((a, b) => a.chunkIndex - b.chunkIndex)) {
                const chunkData = fs.readFileSync(chunk.file);
                writer.write(chunkData);

                try {
                    fs.unlinkSync(chunk.file);
                } catch (error) {
                    logWarn(`[多线程下载] 删除临时文件失败:`, error.message);
                }
            }

            await new Promise((resolve, reject) => {
                writer.end((error) => {
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


    async downloadSingleThread(url, outputFile) {
        logInfo('[多线程下载] 使用单线程下载模式');

        const maxAttempts = Math.max(1, this.retryCount);
        let attempt = 0;
        let lastError = null;

        while (attempt < maxAttempts) {
            attempt++;
            if (this.isCancelled) throw new Error('下载已取消');

            let response = null;
            let writer = null;
            let inactivityTimer = null;
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
                        try { response.body.destroy(new Error('下载超时(无数据)')); } catch (_) { }
                    }, this.timeout);
                };

                resetInactivityTimer();

                const finishSuccessfully = () => {
                    if (finished) return;
                    finished = true;
                    if (inactivityTimer) clearTimeout(inactivityTimer);
                    try { writer.end(() => { }); } catch (_) { }
                };

                await new Promise((resolve, reject) => {
                    response.body.on('data', (chunk) => {
                        if (this.isCancelled) {
                            try { writer.end(() => { if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile); }); } catch (_) { }
                            try { response.body.destroy(); } catch (_) { }
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
                        if (now - lastProgressTime > 500) { // 每500ms报告一次进度
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

                    response.body.on('end', () => {
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

                    response.body.on('close', () => {
                        if (!finished) {
                            return reject(new Error('连接关闭但未完成下载'));
                        }
                    });

                    response.body.on('error', (error) => {
                        if (this.isCancelled) {
                            return reject(this.cancelError);
                        }
                        try { if (writer && !writer.destroyed) writer.destroy(); } catch (_) { }
                        reject(error);
                    });

                    writer.on('error', (error) => {
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
                lastError = error;
                logWarn(`[单线程下载] 失败(尝试 ${attempt}/${maxAttempts}):`, error?.message || String(error));
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


    async download(url, outputFile, options = {}) {
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
                const parts = [];
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

                const enhancedProgressCallback = (progress) => {
                    if (progress.type === 'chunk') {
                        const safeDownloaded = Math.min(
                            typeof progress.downloadedBytes === 'number' ? progress.downloadedBytes : 0,
                            typeof progress.totalBytes === 'number' && isFinite(progress.totalBytes) ? progress.totalBytes : Infinity
                        );
                        chunkProgress[progress.chunkIndex] = safeDownloaded;
                        const now = Date.now();
                        if (now - lastProgressReport > 500) {
                            reportMultiThreadProgress();
                            lastProgressReport = now;
                        }
                    }
                };

                this.progressCallback = enhancedProgressCallback;

                const results = new Array(totalParts);
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

                const completedChunks = results.filter(Boolean);
                logInfo(`[多线程下载] 分片全部完成，准备合并 ${completedChunks.length} 个分片`);
                await this.mergeChunks(completedChunks, outputFile);

                try {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                } catch (error) {
                    logWarn('[多线程下载] 清理临时目录失败:', error.message);
                }

            } catch (error) {
                try {
                    if (fs.existsSync(tempDir)) {
                        fs.rmSync(tempDir, { recursive: true, force: true });
                    }
                } catch (cleanupError) {
                    logWarn('[多线程下载] 清理临时目录失败:', cleanupError.message);
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


    async verifyFile(filePath, expectedMd5) {
        if (!expectedMd5) return true;

        try {
            const fileBuffer = fs.readFileSync(filePath);
            const actualMd5 = crypto.createHash('md5').update(fileBuffer).digest('hex');
            return actualMd5 === expectedMd5;
        } catch (error) {
            logError('[多线程下载] 文件验证失败:', error.message);
            return false;
        }
    }
}

module.exports = MultiThreadDownloader;
