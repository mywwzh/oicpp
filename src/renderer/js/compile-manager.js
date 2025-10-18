class CompilerManager {
    constructor() {
        this.settings = {
            compilerPath: '',
            compilerArgs: '-std=c++14 -O2 -static',
            workingDirectory: ''
        };
        
        this.isCompiling = false;
        this.isRunning = false;
        this.compileOutput = null;
        this.shouldRunAfterCompile = false;
        this.isCloudCompiling = false;
        this.cloudCompileTaskId = null;
        this.cloudCompilePollTimer = null;
        this.cloudCompileAbortController = null;
        this.cloudProgressLine = null;
        this.cloudQueueLastCount = null;
        this.cloudCompileStartTime = null;
    }

    init() {
        logInfo('编译管理器初始化...');
        this.createCompileOutputWindow();
        this.setupEventListeners();
        this.loadSettings();
    }

    createCompileOutputWindow() {
        let existingWindow = document.querySelector('.compile-output-window');
        if (existingWindow) {
            existingWindow.remove();
        }

        this.compileOutput = document.createElement('div');
        this.compileOutput.className = 'compile-output-window hidden';
        this.compileOutput.id = 'compile-output-panel';
        this.compileOutput.innerHTML = `
            <div class="compile-output-header">
                <div class="compile-output-title">
                    <span class="compile-status" id="compile-status-text">编译输出</span>
                </div>
                <div class="compile-output-controls">
                    <button class="compile-output-clear" id="clear-compile-output" title="清空输出">
                        <i class="icon-clear">🗑️</i>
                    </button>
                    <button class="compile-output-close" id="close-compile-output" title="关闭">
                        <i class="icon-close">✕</i>
                    </button>
                </div>
            </div>
            <div class="compile-output-content">
                <div class="compile-output-text" id="compile-output-messages">
                    <div id="compile-command-text" class="output-line output-command" style="display: none;"></div>
                </div>
            </div>
            <div class="compile-output-resizer" title="拖拽调整高度"></div>
        `;

        const editorContainer = document.querySelector('.editor-container');
        if (editorContainer) {
            editorContainer.appendChild(this.compileOutput);
        } else {
            document.body.appendChild(this.compileOutput);
        }

        this.compileOutput.querySelector('.compile-output-clear').addEventListener('click', () => {
            this.clearOutput();
        });

        this.compileOutput.querySelector('.compile-output-close').addEventListener('click', () => {
            this.hideOutput();
        });

        try {
            const savedH = localStorage.getItem('oicpp.compileOutput.height');
            if (savedH) this.compileOutput.style.height = savedH + 'px';
        } catch {}

        const resizer = this.compileOutput.querySelector('.compile-output-resizer');
        if (resizer) {
            let startY = 0;
            let startH = 0;
            const onMove = (e) => {
                const dy = (e.touches ? e.touches[0].clientY : e.clientY) - startY;
                const newH = Math.max(120, startH - dy);
                this.compileOutput.style.height = newH + 'px';
            };
            const onUp = () => {
                window.removeEventListener('mousemove', onMove);
                window.removeEventListener('mouseup', onUp);
                window.removeEventListener('touchmove', onMove);
                window.removeEventListener('touchend', onUp);
                try {
                    const h = parseInt(this.compileOutput.style.height || '300', 10);
                    localStorage.setItem('oicpp.compileOutput.height', String(h));
                } catch {}
            };
            const onDown = (e) => {
                startY = e.touches ? e.touches[0].clientY : e.clientY;
                startH = this.compileOutput.getBoundingClientRect().height;
                window.addEventListener('mousemove', onMove);
                window.addEventListener('mouseup', onUp);
                window.addEventListener('touchmove', onMove);
                window.addEventListener('touchend', onUp);
            };
            resizer.addEventListener('mousedown', onDown);
            resizer.addEventListener('touchstart', onDown);
        }
    }

    setupEventListeners() {
        if (window.electron && window.electron.ipcRenderer) {
            const ipcRenderer = window.electron.ipcRenderer;

            ipcRenderer.on('compile-result', (result) => {
                this.handleCompileResult(result);
            });

            ipcRenderer.on('compile-error', (error) => {
                this.handleCompileError(error);
            });

            ipcRenderer.on('run-result', (result) => {
                this.handleRunResult(result);
            });

            ipcRenderer.on('run-error', (error) => {
                this.handleRunError(error);
            });

            ipcRenderer.on('settings-changed', (settingsType, newSettings) => {
                logInfo('编译管理器收到设置变化通知:', newSettings);
                if (newSettings && (newSettings.compilerPath !== undefined || newSettings.compilerArgs !== undefined)) {
                    this.updateSettings({
                        compilerPath: newSettings.compilerPath !== undefined ? newSettings.compilerPath : this.settings.compilerPath,
                        compilerArgs: newSettings.compilerArgs !== undefined ? newSettings.compilerArgs : this.settings.compilerArgs
                    });
                    logInfo('编译管理器设置已更新:', this.settings);
                }
            });

            logInfo('编译管理器 IPC 监听器已设置');
        } else {
            logWarn('Electron 环境不可用，跳过 IPC 监听器设置');
        }
    }

    async loadSettings() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const allSettings = await window.electronAPI.getAllSettings();
                if (allSettings) {
                    this.updateSettings({
                        compilerPath: allSettings.compilerPath || '',
                        compilerArgs: allSettings.compilerArgs || '-std=c++14 -O2 -static'
                    });
                    logInfo('编译器设置已加载:', this.settings);
                }
            } else {
                logInfo('window.electronAPI 不可用，使用默认编译器设置');
                const savedSettings = localStorage.getItem('oicpp-settings');
                if (savedSettings) {
                    const parsed = JSON.parse(savedSettings);
                    this.updateSettings({
                        compilerPath: parsed.compilerPath || '',
                        compilerArgs: parsed.compilerArgs || '-std=c++14 -O2 -static'
                    });
                    logInfo('从本地存储加载编译器设置:', this.settings);
                }
            }
        } catch (error) {
            logError('加载编译器设置失败:', error);
        }
    }

    updateSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
    }

    async compileCurrentFile(options = {}) {
        try {
            await this.autoSaveCurrentFile();
            logInfo('compileCurrentFile 被调用，自动保存当前文件');
            await this.loadSettings();
            logInfo('重新加载设置后的编译器设置:', this.settings);

            if (!this.settings.compilerPath) {
                logInfo('编译器路径为空，显示设置提示');
                this.showMessage('请先设置编译器路径', 'error');
                this.openCompilerSettings();
                return;
            }

            logInfo('使用编译器路径:', this.settings.compilerPath);

            const currentEditor = window.editorManager?.getCurrentEditor();
            if (!currentEditor) {
                this.showMessage('没有打开的文件', 'error');
                return;
            }

            const filePath = currentEditor.filePath || (currentEditor.getFilePath && currentEditor.getFilePath());
            const content = currentEditor.getValue();

            logInfo('[编译管理器] 获取到的文件路径:', filePath);
            logInfo('[编译管理器] 文件路径类型:', typeof filePath);
            logInfo('[编译管理器] currentEditor.filePath:', currentEditor.filePath);
            if (!filePath || filePath === 'null' || filePath === 'undefined' || filePath.toString().startsWith('untitled')) {
                logInfo('[编译管理器] 文件路径无效，提示保存文件');
                this.showMessage('请先保存文件', 'error');
                return;
            }

            this.isCompiling = true;
            this.showOutput();
            this.setStatus('正在编译...');
            this.clearOutput();

            const inputFile = filePath;
            const outputFile = this.getExecutablePath(filePath);

            let compilerArgs = this.settings.compilerArgs;
            if (options.forDebug) {
                if (!compilerArgs.includes('-g')) {
                    compilerArgs = compilerArgs + ' -g';
                }
                compilerArgs = compilerArgs.replace(/\s*-O[^\s]*/gi, ' ');
                compilerArgs = compilerArgs.replace(/\s+/g, ' ').trim();
                if (!/\b-O0\b/.test(compilerArgs)) {
                    compilerArgs = `${compilerArgs} -O0`.trim();
                }
                compilerArgs = compilerArgs.replace(/-s\b/g, '');
                compilerArgs = compilerArgs.replace(/\s+/g, ' ').trim();
                this.appendOutput('编译模式: 调试模式 (包含调试信息，禁用优化)\n', 'info');
            } else {
                if (!compilerArgs.includes('-g')) {
                    compilerArgs = compilerArgs + ' -g';
                    this.appendOutput('编译模式: 普通模式 (包含调试信息)\n', 'info');
                }
            }

            const compileCommand = this.buildCompileCommand(inputFile, outputFile, compilerArgs);

            logInfo(`源文件: ${inputFile}`);
            logInfo(`目标文件: ${outputFile}`);
            logInfo(`编译命令: ${compileCommand}`);

            this.appendOutput(`编译命令: ${compileCommand}\n`, 'command');
            this.appendOutput(`目标文件: ${outputFile}\n`, 'info');
            this.appendOutput('正在编译...\n', 'info');

            if (typeof require !== 'undefined') {
                try {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('compile-file', {
                        inputFile,
                        outputFile,
                        compilerPath: this.settings.compilerPath,
                        compilerArgs: compilerArgs,
                        workingDirectory: this.getWorkingDirectory(filePath)
                    }).then(result => {
                        this.handleCompileResult(result);
                    }).catch(error => {
                        this.handleCompileError(error.message || error);
                    });
                } catch (error) {
                    this.handleCompileError('IPC 调用失败: ' + error.message);
                }
            } else {
                this.handleCompileError('Electron 环境不可用');
            }

        } catch (error) {
            logError('编译失败:', error);
            this.handleCompileError(error.message);
        }
    }

    async cloudCompileCurrentFile() {
        try {
            if (!this.isWindowsPlatform()) {
                this.showMessage('云编译功能目前仅在 Windows 版本提供', 'warning');
                return;
            }

            const currentEditor = window.editorManager?.getCurrentEditor();
            if (!currentEditor) {
                this.showMessage('没有打开的文件', 'error');
                return;
            }

            const filePath = currentEditor.filePath || (currentEditor.getFilePath && currentEditor.getFilePath());
            if (!filePath || filePath === 'null' || filePath === 'undefined' || filePath.toString().startsWith('untitled')) {
                this.showMessage('请先保存文件', 'error');
                return;
            }

            if (!/\.cpp$/i.test(filePath)) {
                this.showMessage('云编译目前仅支持 .cpp 文件', 'error');
                return;
            }

            this.shouldRunAfterCompile = false;

            await this.autoSaveCurrentFile();

            const codeContent = currentEditor.getValue() ?? '';
            const encoder = new TextEncoder();
            const byteLength = encoder.encode(codeContent).length;

            if (byteLength > 20 * 1024) {
                this.showOutput();
                this.clearOutput();
                this.setStatus('云编译失败');
                const sizeText = this.formatByteSize(byteLength);
                this.appendOutput(`代码长度为 ${sizeText}，超出云编译 20KB 限制。`, 'error');
                return;
            }

            this.cancelCloudCompilationPolling();
            if (this.cloudCompileAbortController) {
                try {
                    this.cloudCompileAbortController.abort();
                } catch (_) {}
            }
            this.cloudCompileAbortController = new AbortController();

            this.isCompiling = true;
            this.isCloudCompiling = true;
            this.cloudCompileTaskId = null;
            this.cloudQueueLastCount = null;
            this.cloudProgressLine = null;
            this.cloudCompileStartTime = Date.now();

            this.showOutput();
            this.clearOutput();
            this.setStatus('正在云编译...');
            this.appendOutput('正在将代码发送至 Linux 云编译服务...', 'info');

            let token = '';
            try {
                if (window.electronAPI && window.electronAPI.getEncodedToken) {
                    token = await window.electronAPI.getEncodedToken();
                }
            } catch (e) { logWarn('获取编码 token 失败:', e); }

            const payload = {
                cpp: codeContent,
                token: token || ''
            };

            const response = await fetch(`https://oicpp.mywwzh.top/api/cloudCompilation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: this.cloudCompileAbortController.signal
            });

            let data = null;
            try {
                data = await response.json();
            } catch (error) {
                logWarn('解析云编译响应失败:', error);
            }

            if (!data) {
                throw new Error(`云编译服务响应异常 (HTTP ${response.status})`);
            }

            if (data.code === 200 && data.task_id) {
                this.cloudCompileTaskId = data.task_id;
                this.appendOutput(`云编译任务创建成功，任务编号: ${data.task_id}`, 'info');
                this.setCloudProgressMessage('云编译任务已提交，正在等待排队结果...', 'info');
                this.pollCloudCompilationResult(data.task_id, 0);
                return;
            }

            if (data.code === 400) {
                this.setStatus('云编译失败');
                if (data.msg) {
                    this.appendMultilineOutput(data.msg, 'error');
                }
                this.showMessage(data.msg || '云编译失败：代码长度超出限制', 'error');
                this.resetCloudCompileState();
                return;
            }

            if (data.code === 429) {
                this.setStatus('云编译受限');
                this.appendOutput('云编译请求过于频繁，请稍后再试。', 'warning');
                if (data.msg) {
                    this.appendMultilineOutput(data.msg, 'warning');
                }
                this.showMessage(data.msg || '云编译请求过于频繁，请稍后再试', 'warning');
                this.resetCloudCompileState();
                return;
            }

            const message = data.msg || `云编译服务返回未知状态: ${data.code}`;
            this.setStatus('云编译失败');
            this.appendOutput(message, 'error');
            this.showMessage(message, 'error');
            this.resetCloudCompileState();
        } catch (error) {
            if (error?.name === 'AbortError') {
                this.appendOutput('云编译请求已取消。', 'warning');
            } else {
                const message = error?.message || '云编译请求失败';
                this.setStatus('云编译失败');
                this.appendOutput(message, 'error');
                this.showMessage(message, 'error');
            }
            this.resetCloudCompileState();
        }
    }

    async runCurrentFile() {
        try {
            await this.autoSaveCurrentFile();

            const currentEditor = window.editorManager?.getCurrentEditor();
            if (!currentEditor) {
                this.showMessage('没有打开的文件', 'error');
                return;
            }

            const filePath = currentEditor.filePath || (currentEditor.getFilePath && currentEditor.getFilePath());
            if (!filePath || filePath.startsWith('untitled')) {
                this.showMessage('请先保存文件', 'error');
                return;
            }

            const executablePath = this.getExecutablePath(filePath);
            logInfo(`检查可执行文件路径: ${executablePath}`);
            
            let exists = false;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (!exists && retryCount < maxRetries) {
                exists = await this.checkFileExists(executablePath);
                logInfo(`可执行文件存在性检查结果 (第${retryCount + 1}次): ${exists}`);
                
                if (!exists && retryCount < maxRetries - 1) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                retryCount++;
            }
            
            if (!exists) {
                this.showMessage(`请先编译程序 (未找到: ${executablePath})`, 'error');
                return;
            }

            this.isRunning = true;
            this.showOutput();
            this.appendOutput(`正在启动程序: ${executablePath}\n`, 'info');
            this.runExecutable(executablePath);

        } catch (error) {
            logError('运行失败:', error);
            this.showMessage(`运行失败: ${error.message}`, 'error');
        }
    }

    async compileAndRun() {
        try {
            this.shouldRunAfterCompile = true;
            await this.compileCurrentFile();
        } catch (error) {
            logError('编译并运行失败:', error);
            this.shouldRunAfterCompile = false;
        }
    }

    buildCompileCommand(inputFile, outputFile, customArgs = null) {
        const args = [
            customArgs || this.settings.compilerArgs,
            `-o "${outputFile}"`,
            `"${inputFile}"`
        ].filter(arg => arg.trim()).join(' ');
        
        return `"${this.settings.compilerPath}" ${args}`;
    }

    getExecutablePath(sourceFile) {
        const isWin = (typeof window !== 'undefined' && window.process && window.process.platform === 'win32');
        const lastSlash = Math.max(sourceFile.lastIndexOf('/'), sourceFile.lastIndexOf('\\'));
        const dir = lastSlash >= 0 ? sourceFile.substring(0, lastSlash) : '';
        const fileName = lastSlash >= 0 ? sourceFile.substring(lastSlash + 1) : sourceFile;
        const dot = fileName.lastIndexOf('.');
        const nameWithoutExt = dot >= 0 ? fileName.substring(0, dot) : fileName;
        const sep = sourceFile.includes('/') ? '/' : (sourceFile.includes('\\') ? '\\' : (isWin ? '\\' : '/'));
        const base = (dir ? (dir + (dir.endsWith('/') || dir.endsWith('\\') ? '' : sep)) : '') + nameWithoutExt;
        return isWin ? base + '.exe' : base;
    }

    getWorkingDirectory(filePath) {
        const lastSlash = filePath.lastIndexOf('/') > filePath.lastIndexOf('\\') ?
            filePath.lastIndexOf('/') : filePath.lastIndexOf('\\');
        return filePath.substring(0, lastSlash);
    }

    async checkFileExists(filePath) {
        try {
            if (window.electronAPI && window.electronAPI.checkFileExists) {
                return await window.electronAPI.checkFileExists(filePath);
            }

            logWarn('无法检查文件存在性，假设文件存在:', filePath);
            return true;
        } catch (error) {
            logError('检查文件存在性失败:', error);
            return true;
        }
    }

    runExecutable(executablePath) {
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('run-executable', {
                    executablePath,
                    workingDirectory: this.getWorkingDirectory(executablePath)
                }).then(result => {
                    this.handleRunResult(result);
                }).catch(error => {
                    this.handleRunError(error.message || error);
                });
            } catch (error) {
                this.handleRunError('IPC 调用失败: ' + error.message);
            }
        } else {
            this.handleRunError('Electron API 不可用');
        }
    }

    async pollCloudCompilationResult(taskId, attempt = 0) {
        if (!taskId || !this.isCloudCompiling) return;
        if (attempt >= 300) {
            this.setStatus('云编译超时');
            this.setCloudProgressMessage('云编译等待超时，请稍后再试。', 'error');
            this.appendOutput('云编译等待超时，请稍后重试。', 'error');
            this.showMessage('云编译等待超时，请稍后重试', 'error');
            this.resetCloudCompileState();
            return;
        }

        try {
            const response = await fetch(`https://oicpp.mywwzh.top/api/getCloudCompilationResult?task_id=${encodeURIComponent(taskId)}`, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                }
            });

            let data = null;
            try {
                data = await response.json();
            } catch (error) {
                logWarn('解析云编译结果失败:', error);
            }

            if (!data) {
                throw new Error(`云编译服务响应异常 (HTTP ${response.status})`);
            }

            switch (data.code) {
                case 200:
                    this.updateCloudQueueStatus(data.queueFrontCnt);
                    this.scheduleCloudCompilationPoll(taskId, attempt + 1);
                    break;
                case 201:
                    this.handleCloudCompilationSuccess(data);
                    break;
                case 202:
                    this.handleCloudCompilationFailure(data);
                    break;
                default:
                    throw new Error(data.msg || `云编译服务返回未知状态: ${data.code}`);
            }
        } catch (error) {
            if (attempt + 1 >= 300) {
                const message = `云编译状态查询失败：${error?.message || error}`;
                this.setStatus('云编译失败');
                this.setCloudProgressMessage('云编译状态查询失败，请稍后再试。', 'error');
                this.appendOutput(message, 'error');
                this.showMessage('云编译状态查询失败，请稍后再试', 'error');
                this.resetCloudCompileState();
                return;
            }

            this.appendOutput(`查询云编译状态失败 (${attempt + 1})：${error?.message || error}`, 'warning');
            this.scheduleCloudCompilationPoll(taskId, attempt + 1);
        }
    }

    scheduleCloudCompilationPoll(taskId, nextAttempt) {
        this.cancelCloudCompilationPolling();
        this.cloudCompilePollTimer = setTimeout(() => {
            this.pollCloudCompilationResult(taskId, nextAttempt);
        }, 2000);
    }

    updateCloudQueueStatus(queueFrontCnt) {
        if (!this.isCloudCompiling) return;
        if (typeof queueFrontCnt === 'number' && queueFrontCnt >= 0) {
            this.setStatus(`云编译排队中 (前方 ${queueFrontCnt} 人)`);
            if (this.cloudQueueLastCount !== queueFrontCnt) {
                this.setCloudProgressMessage(`云编译排队中，前方还有 ${queueFrontCnt} 人。`, 'info');
                this.cloudQueueLastCount = queueFrontCnt;
            }
        } else {
            this.setStatus('云编译排队中...');
            this.setCloudProgressMessage('云编译排队中，请稍候...', 'info');
            this.cloudQueueLastCount = null;
        }
    }

    setCloudProgressMessage(text, type = 'info') {
        if (!text) return;
        if (!this.compileOutput) this.createCompileOutputWindow();
        if (!this.compileOutput) return;
        if (!this.cloudProgressLine || !this.cloudProgressLine.parentElement) {
            this.cloudProgressLine = this.appendOutput(text, type);
        } else {
            this.cloudProgressLine.className = `output-line output-${type}`;
            this.cloudProgressLine.textContent = text;
        }
    }

    handleCloudCompilationSuccess(data) {
        const duration = this.cloudCompileStartTime ? ((Date.now() - this.cloudCompileStartTime) / 1000).toFixed(2) : null;
        const status = duration ? `云编译成功 (${duration}s)` : '云编译成功';
        this.setStatus(status);
        this.setCloudProgressMessage('云编译完成，结果：通过。', 'success');
        this.appendOutput('云编译通过!', 'success');
        if (data.msg) {
            this.appendOutput('编译器输出:', 'info');
            this.appendMultilineOutput(data.msg, 'info');
        }
        this.resetCloudCompileState();
    }

    handleCloudCompilationFailure(data) {
        const duration = this.cloudCompileStartTime ? ((Date.now() - this.cloudCompileStartTime) / 1000).toFixed(2) : null;
        const status = duration ? `云编译失败 (${duration}s)` : '云编译失败';
        this.setStatus(status);
        this.setCloudProgressMessage('云编译失败，请查看下方错误信息。', 'error');
        this.appendOutput('云编译失败!', 'error');
        if (data.msg) {
            this.appendOutput('编译错误信息:', 'error');
            this.appendMultilineOutput(data.msg, 'error');
        }
        this.resetCloudCompileState();
    }

    appendMultilineOutput(message, type = 'info') {
        if (!message) return;
        const lines = String(message).split(/\r?\n/);
        lines.forEach(line => {
            if (line.trim().length > 0) {
                this.appendOutput(line, type);
            }
        });
    }

    cancelCloudCompilationPolling() {
        if (this.cloudCompilePollTimer) {
            clearTimeout(this.cloudCompilePollTimer);
            this.cloudCompilePollTimer = null;
        }
    }

    resetCloudCompileState() {
        this.cancelCloudCompilationPolling();
        this.isCompiling = false;
        this.isCloudCompiling = false;
        this.cloudCompileTaskId = null;
        this.cloudCompileAbortController = null;
        this.cloudQueueLastCount = null;
        this.cloudCompileStartTime = null;
    }

    formatByteSize(bytes) {
        if (bytes < 1024) return `${bytes} 字节`;
        const kb = bytes / 1024;
        if (kb < 1024) {
            return kb >= 100 ? `${Math.round(kb)} KB` : `${kb.toFixed(2)} KB`;
        }
        const mb = kb / 1024;
        return mb >= 100 ? `${Math.round(mb)} MB` : `${mb.toFixed(2)} MB`;
    }

    extractFileName(filePath) {
        if (!filePath) return '';
        const segments = filePath.split(/[\\/]/);
        return segments.pop() || '';
    }

    isWindowsPlatform() {
        try {
            return !!(window.process && window.process.platform === 'win32');
        } catch (_) {
            return false;
        }
    }

    handleCompileResult(result) {
        this.isCompiling = false;
        
            if (result.success) {
            this.setStatus('编译成功');
            this.appendOutput('编译成功!\n', 'success');
            
            if (result.warnings && result.warnings.length > 0) {
                this.appendOutput('警告信息:\n', 'warning');
                    result.warnings.forEach(warning => {
                        this.appendOutput(`${warning}\n`, 'warning');
                    });
            }

                if (window.editorManager && window.editorManager.clearDiagnostics) {
                    window.editorManager.clearDiagnostics();
                }

            window.dispatchEvent(new CustomEvent('compile-success', {
                detail: { result }
            }));

            if (this.shouldRunAfterCompile) {
                this.shouldRunAfterCompile = false;
                setTimeout(() => {
                    this.runCurrentFile();
                }, 500);
            }
            } else {
            this.setStatus('编译失败');
            this.appendOutput('编译失败!\n', 'error');
            this.shouldRunAfterCompile = false;
            
            if (result.errors && result.errors.length > 0) {
                this.appendOutput('错误信息:\n', 'error');
                result.errors.forEach(error => {
                    this.appendOutput(`${this._stringifyError(error)}\n`, 'error');
                });
            }

                if (result.diagnostics && window.editorManager && window.editorManager.applyDiagnostics) {
                    window.editorManager.applyDiagnostics(result.diagnostics);
                }

            window.dispatchEvent(new CustomEvent('compile-error', {
                detail: { result }
            }));
        }
    }

    handleCompileError(error) {
        this.isCompiling = false;
        this.setStatus('编译错误');
        const msg = this._stringifyError(error);
        this.appendOutput(`编译错误: ${msg}\n`, 'error');
        
        window.dispatchEvent(new CustomEvent('compile-error', {
            detail: { error }
        }));
    }

    handleRunResult(result) {
        this.isRunning = false;
        if (result.success) {
            this.appendOutput('程序已在新窗口中启动\n', 'success');
            this.showMessage('程序已在新窗口中启动', 'success');
        }
        logInfo('程序运行完成:', result);
    }

    handleRunError(error) {
        this.isRunning = false;
        this.appendOutput(`运行错误: ${error}\n`, 'error');
        this.showMessage(`运行错误: ${error}`, 'error');
    }

    showOutput() {
        if (!this.compileOutput) this.createCompileOutputWindow();
        if (!this.compileOutput) return;
        this.compileOutput.classList.remove('hidden');
        setTimeout(() => {
            if (!this.compileOutput) return;
            this.compileOutput.classList.add('show');
        }, 10);
    }

    hideOutput() {
        if (!this.compileOutput) return;
        this.compileOutput.classList.remove('show');
        setTimeout(() => {
            if (!this.compileOutput) return;
            this.compileOutput.classList.add('hidden');
        }, 300);
    }

    clearOutput() {
        if (!this.compileOutput) this.createCompileOutputWindow();
        if (!this.compileOutput) return;
        const outputText = this.compileOutput.querySelector('.compile-output-text');
        if (outputText) {
            outputText.innerHTML = '';
        }
        this.cloudProgressLine = null;
        this.cloudQueueLastCount = null;
    }

    appendOutput(text, type = 'info') {
        if (!this.compileOutput) this.createCompileOutputWindow();
        if (!this.compileOutput) return null;
        const outputText = this.compileOutput.querySelector('.compile-output-text');
        let line = null;
        if (outputText) {
            line = document.createElement('div');
            line.className = `output-line output-${type}`;
            line.textContent = text;
            try {
                const m = String(text).match(/^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+)$/i);
                if (m) {
                    line.classList.add('output-link');
                    line.style.cursor = 'pointer';
                    line.addEventListener('click', () => {
                        const [, file, lineNum, colNum] = m;
                        const editor = window.editorManager?.getCurrentEditor?.();
                        if (editor && editor.revealLineInCenter) {
                            const ln = parseInt(lineNum, 10) || 1;
                            const cn = colNum ? parseInt(colNum, 10) : 1;
                            try { editor.revealLineInCenter(ln); } catch {}
                            try { editor.setPosition({ lineNumber: ln, column: cn }); editor.focus(); } catch {}
                        }
                    });
                }
            } catch {}
            outputText.appendChild(line);
            outputText.scrollTop = outputText.scrollHeight;
        }

        return line;
    }

    setStatus(status) {
        if (!this.compileOutput) this.createCompileOutputWindow();
        if (!this.compileOutput) return;

        const statusElement = this.compileOutput.querySelector('.compile-status');
        if (statusElement) {
            statusElement.textContent = status;
        }
    }

    showMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-popup message-${type}`;
        messageDiv.textContent = message;
        
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            messageDiv.classList.add('show');
        }, 10);
        
        setTimeout(() => {
            messageDiv.classList.remove('show');
            setTimeout(() => {
                if (messageDiv.parentElement) {
                    messageDiv.parentElement.removeChild(messageDiv);
                }
            }, 300);
        }, 3000);
    }

    _stringifyError(err) {
        try {
            if (!err) return '未知错误';
            if (typeof err === 'string') return err;
            if (err instanceof Error) return err.message || err.toString();
            if (err.detail) return this._stringifyError(err.detail);
            if (err.result) {
                const r = err.result;
                if (Array.isArray(r.errors) && r.errors.length) return r.errors.join('\n');
                if (typeof r.stderr === 'string' && r.stderr.trim()) return r.stderr;
                if (typeof r.stdout === 'string' && r.stdout.trim()) return r.stdout;
                if (typeof r.message === 'string') return r.message;
            }
            if (typeof err.error === 'string') return err.error;
            if (err.error) return this._stringifyError(err.error);
            if (typeof err.message === 'string') return err.message;
            return JSON.stringify(err);
        } catch (_) {
            try { return String(err); } catch { return '未知错误'; }
        }
    }

    async autoSaveCurrentFile() {
        try {
            const currentEditor = window.editorManager?.getCurrentEditor();
            if (!currentEditor) {
                logInfo('[自动保存] 没有当前编辑器');
                return;
            }

            const filePath = currentEditor.filePath || (currentEditor.getFilePath && currentEditor.getFilePath());
            if (!filePath || filePath.startsWith('untitled')) {
                logInfo('[自动保存] 文件未保存或为临时文件，跳过自动保存');
                return;
            }

            const content = currentEditor.getValue();
            if (content === null || content === undefined) {
                logInfo('[自动保存] 无法获取文件内容');
                return;
            }

            if (window.tabManager) {
                const fileName = filePath.split(/[\\/]/).pop();
                const tab = window.tabManager.getTabByFileName && window.tabManager.getTabByFileName(fileName);
                if (tab && !tab.modified) {
                    logInfo('[自动保存] 文件未修改，跳过保存');
                    return;
                }
            }

            logInfo('[自动保存] 开始保存文件:', filePath);
            
            if (window.electronAPI && window.electronAPI.saveFile) {
                await window.electronAPI.saveFile(filePath, content);
                logInfo('[自动保存] 文件保存成功');
                
                if (window.tabManager) {
                    const fileName = filePath.split(/[\\/]/).pop();
                    if (window.tabManager.markTabAsSaved) {
                        window.tabManager.markTabAsSaved(fileName);
                    }
                    if (window.tabManager.markTabAsSavedByUniqueKey) {
                        window.tabManager.markTabAsSavedByUniqueKey(filePath);
                    }
                }
            } else {
                logWarn('[自动保存] electronAPI 不可用');
            }
        } catch (error) {
            logError('[自动保存] 保存文件失败:', error);
        }
    }

    openCompilerSettings() {
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('open-compiler-settings').catch(error => {
                    logError('打开编译器设置失败:', error);
                });
            } catch (error) {
                logError('IPC 调用失败:', error);
            }
        } else {
            logWarn('Electron API 不可用，无法打开编译器设置');
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CompilerManager;
} else {
    window.CompilerManager = CompilerManager;
}

