class CodeComparer {
    constructor() {
        this.activeTaskKey = null;
        this.standardCodePath = '';
        this.testCodePath = '';
        this.generatorPath = '';
        this.useTestlib = false;
        this.spjPath = '';
        this.maxParallelThreads = 1;
        this.tasks = new Map();
        this.eventsbound = false;

        this.setupEventListeners();
        this.setupActiveFileListener();
    }

    setupActiveFileListener() {
        try {
            window.addEventListener('oicpp:active-file-changed', (e) => {
                const filePath = e?.detail?.filePath;
                if (!filePath || typeof filePath !== 'string') return;
                if (!this.isSupportedCodeFile(filePath)) return;
                this.setActiveTaskKey(filePath, { syncTestCodePath: true });
            });
        } catch (error) {
            logWarn('[对拍器] 注册活动文件监听失败:', error);
        }
    }

    isSupportedCodeFile(filePath) {
        const lower = String(filePath || '').toLowerCase();
        return lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.c');
    }

    isPythonGenerator(filePath) {
        const lower = String(filePath || '').trim().toLowerCase();
        return lower.endsWith('.py');
    }

    async promptMissingPythonInterpreter(task) {
        this.showTaskCompileError(task, 'settings', '请先设置 Python 解释器路径');
        try {
            await window.electronAPI?.openCompilerSettings?.();
        } catch (error) {
            logWarn('打开编译器设置失败:', error);
        }
    }

    getOrCreateTask(taskKey) {
        if (!taskKey) return null;
        let task = this.tasks.get(taskKey);
        if (!task) {
            task = {
                key: taskKey,
                config: {
                    standardCodePath: '',
                    testCodePath: taskKey,
                    generatorPath: '',
                    useTestlib: false,
                    spjPath: '',
                    threadCount: 1,
                    compareCount: 100,
                    timeLimit: 1000
                },
                state: {
                    isRunning: false,
                    shouldStop: false,
                    currentTest: 0,
                    totalTests: 0,
                    statusText: '准备中',
                    mode: 'idle', // idle | running | error | complete
                    errorResult: null,
                    warningMessage: null
                },
                compiledExecutables: null
            };
            this.tasks.set(taskKey, task);
        }
        return task;
    }

    getActiveTask() {
        const key = this.activeTaskKey || this.testCodePath || null;
        if (!key) return null;
        return this.getOrCreateTask(key);
    }

    setActiveTaskKey(taskKey, options = {}) {
        if (!taskKey || typeof taskKey !== 'string') return;

        const task = this.getOrCreateTask(taskKey);
        if (!task) return;

        this.activeTaskKey = taskKey;

        if (options.syncTestCodePath) {
            task.config.testCodePath = taskKey;
            this.testCodePath = taskKey;
        }

        this.applyTaskConfigToInstance(task);
        this.renderTask(task);
    }

    applyTaskConfigToInstance(task) {
        const cfg = task?.config;
        if (!cfg) return;
        this.standardCodePath = cfg.standardCodePath || '';
        this.testCodePath = cfg.testCodePath || '';
        this.generatorPath = cfg.generatorPath || '';
        this.useTestlib = !!cfg.useTestlib;
        this.spjPath = cfg.spjPath || '';
    }

    syncInstanceConfigToTask(task) {
        if (!task?.config) return;
        task.config.standardCodePath = this.standardCodePath || '';
        task.config.testCodePath = this.testCodePath || task.key;
        task.config.generatorPath = this.generatorPath || '';
        task.config.useTestlib = !!this.useTestlib;
        task.config.spjPath = this.spjPath || '';

        const compareCountEl = document.getElementById('compare-count');
        const timeLimitEl = document.getElementById('time-limit');
        const threadCountEl = document.getElementById('compare-threads');
        const compareCount = parseInt(compareCountEl?.value);
        const timeLimit = parseInt(timeLimitEl?.value);
        const threadCount = parseInt(threadCountEl?.value);
        if (Number.isFinite(compareCount)) task.config.compareCount = Math.max(1, Math.min(compareCount, 100000));
        if (Number.isFinite(timeLimit)) task.config.timeLimit = timeLimit;
        if (Number.isFinite(threadCount)) {
            const capped = Math.max(1, Math.min(threadCount, this.maxParallelThreads || threadCount));
            task.config.threadCount = capped;
            if (threadCountEl && capped !== threadCount) threadCountEl.value = String(capped);
        }
    }

    mergeTaskConfigIfEmpty(targetTask, sourceConfig) {
        if (!targetTask?.config || !sourceConfig) return;

        const t = targetTask.config;
        const s = sourceConfig;
        if (!t.standardCodePath && s.standardCodePath) t.standardCodePath = s.standardCodePath;
        if (!t.generatorPath && s.generatorPath) t.generatorPath = s.generatorPath;
        if (!t.spjPath && s.spjPath) t.spjPath = s.spjPath;

        if (!t.useTestlib && s.useTestlib) t.useTestlib = !!s.useTestlib;

        if (!Number.isFinite(t.compareCount) && Number.isFinite(s.compareCount)) t.compareCount = s.compareCount;
        if (!Number.isFinite(t.timeLimit) && Number.isFinite(s.timeLimit)) t.timeLimit = s.timeLimit;
        if (!Number.isFinite(t.threadCount) && Number.isFinite(s.threadCount)) t.threadCount = s.threadCount;

        t.testCodePath = targetTask.key;
    }

    activate() {
        logInfo('激活代码对拍器面板');
        setTimeout(() => {
            this.checkCompilerAndUpdate();
        }, 100);

        try {
            const currentEditor = window.editorManager?.getCurrentEditor?.();
            const filePath = currentEditor?.filePath || (currentEditor?.getFilePath && currentEditor.getFilePath());
            if (filePath && this.isSupportedCodeFile(filePath)) {
                this.setActiveTaskKey(filePath, { syncTestCodePath: true });
            } else {
                const task = this.getActiveTask();
                if (task) this.renderTask(task);
            }
        } catch (_) { }
    }

    async checkCompilerAndUpdate() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const settings = await window.electronAPI.getAllSettings();
                const hasCompiler = settings && settings.compilerPath;

                const noCompilerMessage = document.getElementById('no-compiler-message');
                const compareFileSection = document.getElementById('compare-file-section');

                if (hasCompiler) {
                    noCompilerMessage.style.display = 'none';
                    compareFileSection.style.display = 'block';
                } else {
                    noCompilerMessage.style.display = 'flex';
                    compareFileSection.style.display = 'none';
                }
            }
        } catch (error) {
            logError('检查编译器设置失败:', error);
        }
    }

    setupEventListeners() {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.bindEvents();
            });
        } else {
            setTimeout(() => this.bindEvents(), 100);
        }
    }

    bindEvents() {
        if (this.eventsbound) {
            return;
        }
        this.eventsbound = true;

        this.ensureThreadLimitUI();

        const stdCodeBrowse = document.getElementById('std-code-browse');
        const testCodeBrowse = document.getElementById('test-code-browse');
        const generatorBrowse = document.getElementById('generator-browse');

        if (stdCodeBrowse) {
            stdCodeBrowse.addEventListener('click', () => this.browseStandardCode());
        }
        if (testCodeBrowse) {
            testCodeBrowse.addEventListener('click', () => this.browseTestCode());
        }
        if (generatorBrowse) {
            generatorBrowse.addEventListener('click', () => this.browseGenerator());
        }

        const startBtn = document.getElementById('compare-start-btn');
        const stopBtn = document.getElementById('compare-stop-btn');
        const resetBtn = document.getElementById('compare-reset-btn');
        const exportBtn = document.getElementById('export-btn');

        if (startBtn) {
            startBtn.addEventListener('click', () => this.startComparison());
        }
        if (stopBtn) {
            stopBtn.addEventListener('click', () => this.stopComparison());
        }
        if (resetBtn) {
            resetBtn.addEventListener('click', () => this.resetComparison());
        }
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportResults());
        }

        const useTestlibCheckbox = document.getElementById('compare-use-testlib');
        const spjBrowseBtn = document.getElementById('compare-spj-browse');
        const compareCountInput = document.getElementById('compare-count');
        const threadCountInput = document.getElementById('compare-threads');
        const timeLimitInput = document.getElementById('time-limit');

        if (useTestlibCheckbox) {
            useTestlibCheckbox.addEventListener('change', (e) => {
                this.useTestlib = e.target.checked;
                const task = this.getActiveTask();
                if (task) {
                    task.config.useTestlib = !!this.useTestlib;
                    this.renderTask(task);
                }
            });
        }

        if (spjBrowseBtn) {
            spjBrowseBtn.addEventListener('click', () => this.browseSpjFile());
        }

        if (compareCountInput) {
            compareCountInput.addEventListener('change', () => {
                const task = this.getActiveTask();
                if (!task) return;
                this.syncInstanceConfigToTask(task);
            });
        }
        if (threadCountInput) {
            threadCountInput.addEventListener('change', () => {
                const task = this.getActiveTask();
                if (!task) return;
                this.syncInstanceConfigToTask(task);
            });
        }
        if (timeLimitInput) {
            timeLimitInput.addEventListener('change', () => {
                const task = this.getActiveTask();
                if (!task) return;
                this.syncInstanceConfigToTask(task);
            });
        }
    }

    async browseStandardCode() {
        try {
            const result = await window.electronAPI.showOpenDialog({
                title: '选择标准/暴力代码文件',
                filters: [
                    { name: 'C++ 文件', extensions: ['cpp', 'cc', 'cxx', 'c'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                this.standardCodePath = result.filePaths[0];
                this.updateFilePath('std-code-path', this.standardCodePath);

                const task = this.getActiveTask();
                if (task) {
                    task.config.standardCodePath = this.standardCodePath;
                }
            }
        } catch (error) {
            logError('选择标准代码文件失败:', error);
        }
    }

    async browseTestCode() {
        try {
            const prevTask = this.getActiveTask();
            if (prevTask) {
                this.syncInstanceConfigToTask(prevTask);
            }

            const result = await window.electronAPI.showOpenDialog({
                title: '选择要对拍的代码文件',
                filters: [
                    { name: 'C++ 文件', extensions: ['cpp', 'cc', 'cxx', 'c'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                this.testCodePath = result.filePaths[0];
                this.updateFilePath('test-code-path', this.testCodePath);

                const prevConfig = prevTask?.config ? { ...prevTask.config } : {
                    standardCodePath: this.standardCodePath,
                    generatorPath: this.generatorPath,
                    useTestlib: this.useTestlib,
                    spjPath: this.spjPath,
                    compareCount: parseInt(document.getElementById('compare-count')?.value) || 100,
                    timeLimit: parseInt(document.getElementById('time-limit')?.value) || 1000
                };

                this.setActiveTaskKey(this.testCodePath, { syncTestCodePath: true });
                const newTask = this.getActiveTask();
                this.mergeTaskConfigIfEmpty(newTask, prevConfig);

                if (newTask) {
                    this.applyTaskConfigToInstance(newTask);
                    this.renderTask(newTask);
                }
            }
        } catch (error) {
            logError('选择测试代码文件失败:', error);
        }
    }

    async browseGenerator() {
        try {
            const result = await window.electronAPI.showOpenDialog({
                title: '选择数据生成器文件',
                filters: [
                    { name: '数据生成器文件', extensions: ['cpp', 'cc', 'cxx', 'c', 'py'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                this.generatorPath = result.filePaths[0];
                this.updateFilePath('generator-path', this.generatorPath);

                const task = this.getActiveTask();
                if (task) {
                    task.config.generatorPath = this.generatorPath;
                }
            }
        } catch (error) {
            logError('选择数据生成器文件失败:', error);
        }
    }

    async browseSpjFile() {
        try {
            const result = await window.electronAPI.showOpenDialog({
                title: '选择Special Judge文件',
                filters: [
                    { name: 'C++ 文件', extensions: ['cpp', 'cc', 'cxx', 'c'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                this.spjPath = result.filePaths[0];
                const spjPathInput = document.getElementById('compare-spj-path');
                if (spjPathInput) {
                    spjPathInput.value = this.spjPath;
                }

                const task = this.getActiveTask();
                if (task) {
                    task.config.spjPath = this.spjPath;
                }
            }
        } catch (error) {
            logError('选择SPJ文件失败:', error);
        }
    }

    updateFilePath(elementId, filePath) {
        const element = document.getElementById(elementId);
        if (element) {
            const value = (filePath && String(filePath).trim()) ? String(filePath) : '未选择文件';
            element.textContent = value;
            if (value === '未选择文件') {
                element.classList.remove('selected');
            } else {
                element.classList.add('selected');
            }
        }
    }

    renderTask(task) {
        if (!task) return;

        this.updateFilePath('std-code-path', task.config.standardCodePath || '');
        this.updateFilePath('test-code-path', task.config.testCodePath || '');
        this.updateFilePath('generator-path', task.config.generatorPath || '');

        const compareCountInput = document.getElementById('compare-count');
        if (compareCountInput && Number.isFinite(task.config.compareCount)) {
            compareCountInput.value = String(task.config.compareCount);
        }
        const threadCountInput = document.getElementById('compare-threads');
        if (threadCountInput && Number.isFinite(task.config.threadCount)) {
            threadCountInput.value = String(task.config.threadCount);
        }
        const timeLimitInput = document.getElementById('time-limit');
        if (timeLimitInput && Number.isFinite(task.config.timeLimit)) {
            timeLimitInput.value = String(task.config.timeLimit);
        }
        const useTestlibCheckbox = document.getElementById('compare-use-testlib');
        if (useTestlibCheckbox) {
            useTestlibCheckbox.checked = !!task.config.useTestlib;
        }
        const spjPathInput = document.getElementById('compare-spj-path');
        if (spjPathInput) {
            spjPathInput.value = task.config.spjPath || '';
        }

        this.updateUIForTask(task);

        if (task.state.mode === 'running') {
            this.showStatus();
            this.updateStatusText(task.state.statusText || '运行中');
            this.updateProgress(task.state.currentTest, task.state.totalTests);
        } else if (task.state.mode === 'error') {
            this.showError(task.state.errorResult);
        } else if (task.state.mode === 'complete') {
            this.showComplete(task.state.totalTests, task.state.warningMessage);
        } else {
            this.hideStatus();
            this.hideError();
            this.hideComplete();
        }
    }

    async startComparison() {
        await this.autoSaveCurrentFile();

        if (!this.testCodePath) {
            const task = this.getActiveTask();
            this.showTaskCompileError(task, 'general', '请先选择要对拍的代码文件');
            return;
        }

        const task = this.getOrCreateTask(this.testCodePath);
        if (!task) return;

        this.syncInstanceConfigToTask(task);

        if (!task.config.standardCodePath || !task.config.testCodePath || !task.config.generatorPath) {
            this.showTaskCompileError(task, 'general', '请先选择所有必要的文件（标准代码、测试代码、数据生成器）');
            return;
        }

        if (task.state.isRunning) {
            this.showTaskCompileError(task, 'general', '该文件的对拍器正在运行');
            return;
        }

        logInfo('对拍器文件检查:');
        logInfo('标准代码:', task.config.standardCodePath);
        logInfo('测试代码:', task.config.testCodePath);
        logInfo('数据生成器:', task.config.generatorPath);

        try {
            const settings = await window.electronAPI.getAllSettings();
            if (!settings || !settings.compilerPath) {
                this.showTaskCompileError(task, 'general', '请先设置编译器路径');
                return;
            }
            if (this.isPythonGenerator(task.config.generatorPath) && !String(settings.pythonInterpreterPath || '').trim()) {
                await this.promptMissingPythonInterpreter(task);
                return;
            }
        } catch (error) {
            logError('获取编译器设置失败:', error);
            this.showTaskCompileError(task, 'general', '无法获取编译器设置');
            return;
        }

        let compareCount = parseInt(document.getElementById('compare-count').value) || task.config.compareCount || 100;
        compareCount = Math.max(1, Math.min(compareCount, 100000));
        const timeLimit = parseInt(document.getElementById('time-limit').value);
        const effectiveTimeLimit = Number.isFinite(timeLimit) ? timeLimit : (task.config.timeLimit || 1000);
        const { cpuThreads, maxParallel } = await this.getMaxParallelThreads();
        this.maxParallelThreads = maxParallel;
        const requestedThreadsRaw = parseInt(document.getElementById('compare-threads')?.value);
        const requestedThreads = Number.isFinite(requestedThreadsRaw) ? Math.max(1, requestedThreadsRaw) : 1;

        task.config.compareCount = compareCount;
        task.config.timeLimit = Number.isFinite(timeLimit) ? timeLimit : task.config.timeLimit;
        task.config.threadCount = requestedThreads;

        task.state.totalTests = compareCount;
        task.state.currentTest = 0;
        task.state.isRunning = true;
        task.state.shouldStop = false;
        task.state.errorResult = null;
        task.state.warningMessage = null;
        task.state.statusText = '准备中';
        task.state.mode = 'running';

        this.setActiveTaskKey(task.key, { syncTestCodePath: true });
        this.updateUIForTask(task);
        this.showStatus();
        this.updateStatusText(task.state.statusText);
        this.updateProgress(0, task.state.totalTests);

        const workerCount = Math.max(1, Math.min(requestedThreads, maxParallel, task.state.totalTests));
        logInfo('[对拍器] 并行配置', { cpuThreads, maxParallel, requestedThreads, workerCount, totalTests: task.state.totalTests });

        this.runTask(task, effectiveTimeLimit, workerCount, maxParallel).catch((error) => {
            logError('对拍过程出错:', error);
            this.showTaskCompileError(task, 'general', '对拍过程出错: ' + (error?.message || String(error)));
        });
    }

    async runTask(task, effectiveTimeLimit, workerCount, maxParallel) {
        try {
            logInfo(`开始对拍！计划执行 ${task.state.totalTests} 组测试，时间限制 ${task.config.timeLimit}ms`);

            const compiledPrograms = await this.compilePrograms(task);
            if (!compiledPrograms) {
                return;
            }

            logInfo('所有程序编译成功，开始执行对拍');
            await this.runComparison(task, compiledPrograms, effectiveTimeLimit, workerCount, maxParallel);
        } finally {
            task.state.isRunning = false;
            if (task.state.mode === 'running') {
                task.state.mode = 'idle';
            }
            await this.cleanupCompiledExecutables(task);
            if (this.activeTaskKey === task.key) {
                this.updateUIForTask(task);
            }
        }
    }

    async compilePrograms(task) {
        try {
            const settings = await window.electronAPI.getAllSettings();
            const compilerPath = settings.compilerPath;
            let compilerArgs = settings.compilerArgs || '-std=c++14 -O2';

            if (task.config.useTestlib) {
                const compilerDir = await window.electronAPI.pathDirname(compilerPath);
                const testlibIncludePath = await window.electronAPI.pathJoin(compilerDir, '..', 'include');
                compilerArgs += ` -I"${testlibIncludePath}"`;
            }

            const homeDir = await window.electronAPI.getHomeDir();
            const tempDir = await window.electronAPI.pathJoin(homeDir, '.oicpp', 'compare');

            await window.electronAPI.ensureDir(tempDir);

            const timestamp = Date.now();
            const isWin = (typeof window !== 'undefined' && window.process && window.process.platform === 'win32');
            const exeSuffix = isWin ? '.exe' : '';
            const stdExe = await window.electronAPI.pathJoin(tempDir, `std_${timestamp}${exeSuffix}`);
            const testExe = await window.electronAPI.pathJoin(tempDir, `test_${timestamp}${exeSuffix}`);
            let generatorExe = null;
            let generatorRunTarget = null;

            this.updateTaskStatus(task, '编译标准程序...');
            const stdResult = await window.electronAPI.compileFile({
                inputFile: task.config.standardCodePath,
                outputFile: stdExe,
                compilerPath: compilerPath,
                compilerArgs: compilerArgs,
                workingDirectory: await window.electronAPI.pathDirname(task.config.standardCodePath)
            });

            if (!stdResult.success) {
                this.showTaskCompileError(task, 'standard', stdResult.stderr || stdResult.stdout || '编译失败');
                return null;
            }

            this.updateTaskStatus(task, '编译测试程序...');
            const testResult = await window.electronAPI.compileFile({
                inputFile: task.config.testCodePath,
                outputFile: testExe,
                compilerPath: compilerPath,
                compilerArgs: compilerArgs,
                workingDirectory: await window.electronAPI.pathDirname(task.config.testCodePath)
            });

            if (!testResult.success) {
                this.showTaskCompileError(task, 'test', testResult.stderr || testResult.stdout || '编译失败');
                return null;
            }

            const generatorIsPython = this.isPythonGenerator(task.config.generatorPath);
            if (generatorIsPython) {
                const interpreterPath = String(settings.pythonInterpreterPath || '').trim();
                if (!interpreterPath) {
                    await this.promptMissingPythonInterpreter(task);
                    return null;
                }
                const interpreterExists = await window.electronAPI.checkFileExists(interpreterPath);
                if (!interpreterExists) {
                    this.showTaskCompileError(task, 'settings', 'Python 解释器路径无效，请重新设置');
                    try {
                        await window.electronAPI?.openCompilerSettings?.();
                    } catch (_) { }
                    return null;
                }

                this.updateTaskStatus(task, '准备 Python 数据生成器...');
                generatorRunTarget = {
                    executablePath: interpreterPath,
                    args: [task.config.generatorPath],
                    workingDirectory: await window.electronAPI.pathDirname(task.config.generatorPath)
                };
            } else {
                generatorExe = await window.electronAPI.pathJoin(tempDir, `generator_${timestamp}${exeSuffix}`);
                this.updateTaskStatus(task, '编译数据生成器...');
                const generatorResult = await window.electronAPI.compileFile({
                    inputFile: task.config.generatorPath,
                    outputFile: generatorExe,
                    compilerPath: compilerPath,
                    compilerArgs: compilerArgs,
                    workingDirectory: await window.electronAPI.pathDirname(task.config.generatorPath)
                });

                if (!generatorResult.success) {
                    this.showTaskCompileError(task, 'generator', generatorResult.stderr || generatorResult.stdout || '编译失败');
                    return null;
                }
                generatorRunTarget = generatorExe;
            }

            let spjExe = null;

            if (task.config.useTestlib && task.config.spjPath) {
                this.updateTaskStatus(task, '编译Special Judge程序...');
                spjExe = await window.electronAPI.pathJoin(tempDir, `spj_${timestamp}${exeSuffix}`);

                let spjCompilerArgs = compilerArgs;


                if (settings.testlibPath) {
                    const testlibPathInfo = await window.electronAPI.getPathInfo(settings.testlibPath);
                    const testlibIncludePath = testlibPathInfo.dirname;
                    spjCompilerArgs += ` -I"${testlibIncludePath}"`;
                } else {
                    const pathInfo = await window.electronAPI.getPathInfo(compilerPath);
                    const testlibIncludePath = await window.electronAPI.pathJoin(pathInfo.dirname, '..', 'include');
                    spjCompilerArgs += ` -I"${testlibIncludePath}"`;
                }



                const spjResult = await window.electronAPI.compileFile({
                    inputFile: task.config.spjPath,
                    outputFile: spjExe,
                    compilerPath: compilerPath,
                    compilerArgs: spjCompilerArgs,
                    workingDirectory: await window.electronAPI.pathDirname(task.config.spjPath)
                });

                if (!spjResult.success) {
                    this.showTaskCompileError(task, 'spj', spjResult.stderr || spjResult.stdout || '编译失败');
                    return null;
                }
            }

            task.compiledExecutables = {
                stdExe,
                testExe,
                generatorExe,
                spjExe
            };

            return {
                stdExe,
                testExe,
                generatorExe,
                generatorRunTarget,
                spjExe
            };

        } catch (error) {
            logError('编译程序失败:', error);
            this.showTaskCompileError(task, 'general', '编译程序失败: ' + error.message);
            return null;
        }
    }

    async runComparison(task, programs, timeLimit, workerCountFromConfig = 1, maxParallelFromStart = 1) {
        const { stdExe, testExe, generatorExe, generatorRunTarget, spjExe } = programs;
        let failedGenerations = 0;

        const maxParallel = Math.max(1, maxParallelFromStart || 1);
        const workerCount = Math.max(1, Math.min(workerCountFromConfig || 1, maxParallel, task.state.totalTests));
        const totalTests = task.state.totalTests;

        let nextIndex = 1;
        let completed = 0;
        let errorOccurred = false;

        const worker = async () => {
            while (true) {
                if (task.state.shouldStop || errorOccurred) return;

                const i = nextIndex++;
                if (i > totalTests) return;

                if (this.activeTaskKey === task.key) {
                    this.updateTaskStatus(task, `第 ${i} 组测试`);
                    this.updateProgress(completed, totalTests);
                }

                try {
                    const generation = await this.generateTestData(generatorRunTarget || generatorExe, 0);
                    if (!generation || generation.success !== true) {
                        const generatorMessage = generation?.message || '数据生成器运行失败';
                        const generatedOutput = generation?.result?.output || '';
                        const generatorType = generation?.type || 'unknown';
                        try {
                            logError(`第 ${i} 组：数据生成失败 (${generatorType})`, generatorMessage);
                        } catch (_) { }

                        task.state.errorResult = {
                            testNumber: i,
                            input: generatedOutput ? this.limitOutputLines(generatedOutput, 50) : '[生成器未产生有效输入]',
                            stdOutput: generatorMessage,
                            testOutput: '标准/测试程序未运行',
                            errorType: 'generator_program_error',
                            generatorErrorType: generatorType
                        };
                        task.state.mode = 'error';
                        errorOccurred = true;
                        this.renderIfActive(task);
                        return;
                    }

                    const inputData = generation.input;

                    const stdOutput = await this.runProgram(stdExe, inputData, 0);
                    if (stdOutput.outputLimitExceeded || stdOutput.timeout || stdOutput.error || stdOutput.exitCode !== 0) {
                        const limitMbStd = Math.max(1, Math.floor((stdOutput.outputLimitBytes || 0) / (1024 * 1024)));
                        const errorMsg = stdOutput.outputLimitExceeded ? `标准程序输出超过限制 (${limitMbStd} MB)` :
                            stdOutput.timeout ? '标准程序超时 (TLE)' :
                                stdOutput.error ? `标准程序运行错误 (RE): ${stdOutput.error}` :
                                    `标准程序异常退出，退出码: ${stdOutput.exitCode}`;
                        try {
                            if (stdOutput.outputLimitExceeded) {
                                logWarn('[对拍器][OLE][STD]', {
                                    test: i,
                                    durationMs: stdOutput.time,
                                    limitBytes: stdOutput.outputLimitBytes,
                                    capturedBytes: stdOutput.capturedOutputBytes,
                                    observedBytes: stdOutput.observedOutputBytes
                                });
                            } else if (stdOutput.timeout) {
                                logWarn('[对拍器][TLE][STD]', { test: i, durationMs: stdOutput.time, limitMs: 0 });
                            } else {
                                logWarn('[对拍器][RE][STD]', { test: i, exitCode: stdOutput.exitCode, durationMs: stdOutput.time });
                            }
                        } catch (_) { }
                        task.state.errorResult = {
                            testNumber: i,
                            input: inputData,
                            stdOutput: errorMsg,
                            testOutput: '程序未运行',
                            errorType: 'standard_program_error'
                        };
                        task.state.mode = 'error';
                        errorOccurred = true;
                        this.renderIfActive(task);
                        return;
                    }

                    const testOutput = await this.runProgram(testExe, inputData, timeLimit);
                    if (testOutput.outputLimitExceeded || testOutput.timeout || testOutput.error || testOutput.exitCode !== 0) {
                        const limitMbTest = Math.max(1, Math.floor((testOutput.outputLimitBytes || 0) / (1024 * 1024)));
                        const errorMsg = testOutput.outputLimitExceeded ? `测试程序输出超过限制 (${limitMbTest} MB)` :
                            testOutput.timeout ? '测试程序超时 (TLE)' :
                                testOutput.error ? `测试程序运行错误 (RE):  ${testOutput.error}` :
                                    `测试程序异常退出，退出码: ${testOutput.exitCode}`;
                        try {
                            if (testOutput.outputLimitExceeded) {
                                logWarn('[对拍器][OLE][TEST]', {
                                    test: i,
                                    durationMs: testOutput.time,
                                    limitBytes: testOutput.outputLimitBytes,
                                    capturedBytes: testOutput.capturedOutputBytes,
                                    observedBytes: testOutput.observedOutputBytes
                                });
                            } else if (testOutput.timeout) {
                                logWarn('[对拍器][TLE][TEST]', { test: i, durationMs: testOutput.time, limitMs: timeLimit });
                            } else {
                                logWarn('[对拍器][RE][TEST]', { test: i, exitCode: testOutput.exitCode, durationMs: testOutput.time });
                            }
                        } catch (_) { }
                        task.state.errorResult = {
                            testNumber: i,
                            input: inputData,
                            stdOutput: stdOutput.output,
                            testOutput: errorMsg,
                            errorType: 'test_program_error'
                        };
                        task.state.mode = 'error';
                        errorOccurred = true;
                        this.renderIfActive(task);
                        return;
                    }

                    if (task.config.useTestlib && spjExe) {
                        const spjResult = await this.judgeWithSpj(spjExe, inputData, testOutput.output, stdOutput.output, timeLimit);
                        if (spjResult !== 'AC') {
                            task.state.errorResult = {
                                testNumber: i,
                                input: inputData,
                                stdOutput: stdOutput.output,
                                testOutput: testOutput.output,
                                errorType: 'spj_error',
                                errorMessage: `SPJ 结果: ${spjResult}`
                            };
                            task.state.mode = 'error';
                            errorOccurred = true;
                            this.renderIfActive(task);
                            return;
                        }
                    } else {
                        const outputsMatch = this.compareOutputs(stdOutput.output, testOutput.output);
                        if (!outputsMatch) {
                            try {
                                const diff = this.getDifferenceInfo((testOutput.output || '').trimEnd(), (stdOutput.output || '').trimEnd());
                                logWarn('[对拍器][WA]', {
                                    test: i,
                                    actualLen: (testOutput.output || '').length,
                                    expectedLen: (stdOutput.output || '').length,
                                    firstDiff: diff || null
                                });
                            } catch (_) { }
                            task.state.errorResult = {
                                testNumber: i,
                                input: inputData,
                                stdOutput: stdOutput.output,
                                testOutput: testOutput.output,
                                usedSpj: false
                            };
                            task.state.mode = 'error';
                            errorOccurred = true;
                            this.renderIfActive(task);
                            return;
                        }
                    }

                    completed++;
                    task.state.currentTest = completed;
                    this.updateTaskProgress(task);

                } catch (error) {
                    logError(`第 ${i} 组测试出错:`, error);
                    continue;
                }
            }
        };

        const workers = Array.from({ length: workerCount }, worker);
        await Promise.all(workers);

        task.state.currentTest = completed;
        this.updateTaskProgress(task);

        if (task.state.shouldStop) {
            logInfo(`对拍被手动停止，已执行 ${completed} 组测试，其中有 ${failedGenerations} 组生成失败`);
            return;
        }

        if (errorOccurred) {
            return;
        }

        const successfulTests = task.state.totalTests - failedGenerations;
        if (failedGenerations === 0) {
            logInfo(`对拍完成！共执行 ${successfulTests} 组测试，未发现差异`);
            task.state.mode = 'complete';
            task.state.warningMessage = null;
            this.renderIfActive(task);
        } else {
            logInfo(`对拍完成，但有 ${failedGenerations} 组数据生成失败。共成功执行 ${successfulTests} 组测试，未在成功组中发现差异`);
            task.state.mode = 'complete';
            task.state.warningMessage = `有 ${failedGenerations} 组数据生成失败，请检查数据生成器`;
            this.renderIfActive(task);
        }
    }

    renderIfActive(task) {
        if (!task) return;
        if (this.activeTaskKey === task.key) {
            this.renderTask(task);
        }
    }

    async generateTestData(generatorProgram, timeLimit) {
        try {
            const result = await this.runProgram(generatorProgram, '', timeLimit);

            if (result.outputLimitExceeded) {
                const limitBytes = result.outputLimitBytes || (256 * 1024 * 1024);
                const limitMb = Math.max(1, Math.floor(limitBytes / (1024 * 1024)));
                try {
                    logWarn('[对拍器][OLE][GEN]', {
                        durationMs: result.time,
                        limitBytes,
                        capturedBytes: result.capturedOutputBytes,
                        observedBytes: result.observedOutputBytes
                    });
                } catch (_) { }
                return {
                    success: false,
                    type: 'ole',
                    message: `数据生成器输出超限 (${limitMb} MB)`,
                    result
                };
            }

            if (result.timeout) {
                try { logWarn('[对拍器][TLE][GEN]', { durationMs: result.time, limitMs: timeLimit }); } catch (_) { }
                return {
                    success: false,
                    type: 'tle',
                    message: '数据生成器运行超时',
                    result
                };
            }

            if (result.error || result.exitCode !== 0) {
                try {
                    logWarn('[对拍器][RE][GEN]', { exitCode: result.exitCode, durationMs: result.time });
                } catch (_) { }
                return {
                    success: false,
                    type: 're',
                    message: result.error || `数据生成器异常退出，退出码: ${result.exitCode}`,
                    result
                };
            }

            return {
                success: true,
                input: result.output,
                result
            };
        } catch (error) {
            logError('生成测试数据失败:', error);
            return {
                success: false,
                type: 'exception',
                message: error?.message || '生成测试数据失败',
                result: null
            };
        }
    }

    async runProgram(executablePath, input, timeLimit) {
        const execOptions = typeof executablePath === 'object'
            ? { ...executablePath, skipPreKill: true }
            : { executablePath, skipPreKill: true };
        const result = await window.electronAPI.runProgram(execOptions, input, timeLimit);
        const trimmedOutput = (result.output || '').trim();
        const outputLimitExceeded = !!result.outputLimitExceeded;
        let errorMessage = '';
        if (outputLimitExceeded) {
            const limitBytes = result.outputLimitBytes || (256 * 1024 * 1024);
            const limitMb = Math.max(1, Math.floor(limitBytes / (1024 * 1024)));
            errorMessage = `输出超过限制 (${limitMb} MB)`;
        } else if (result.exitCode !== 0) {
            errorMessage = trimmedOutput || result.stderr || `退出码: ${result.exitCode}`;
        }
        return {
            output: trimmedOutput,
            error: errorMessage,
            timeout: !!result.timeout,
            time: result.time,
            exitCode: result.exitCode,
            outputLimitExceeded,
            outputLimitBytes: result.outputLimitBytes,
            capturedOutputBytes: result.capturedOutputBytes,
            observedOutputBytes: result.observedOutputBytes
        };
    }

    compareOutputs(output1, output2) {
        const normalize = (str) => {
            return str.split('\n')
                .map(line => line.trimEnd())
                .join('\n')
                .replace(/\n+$/, '');
        };

        const normalized1 = normalize(output1 || '');
        const normalized2 = normalize(output2 || '');

        return normalized1 === normalized2;
    }

    async judgeWithSpj(spjExecutablePath, inputData, actualOutput, expectedOutput, timeLimit) {
        try {
            const timestamp = Date.now();
            const inputFile = await window.electronAPI.saveTempFile(`spj_input_${timestamp}.txt`, inputData);
            const actualFile = await window.electronAPI.saveTempFile(`spj_actual_${timestamp}.txt`, actualOutput);
            const expectedFile = await window.electronAPI.saveTempFile(`spj_expected_${timestamp}.txt`, expectedOutput);

            try {
                const workingDir = await window.electronAPI.pathDirname(spjExecutablePath);
                const spjParams = {
                    executablePath: spjExecutablePath,
                    args: [inputFile, actualFile, expectedFile],
                    timeLimit: timeLimit,
                    workingDirectory: workingDir,
                    skipPreKill: true
                };

                const spjResult = await window.electronAPI.runProgram(spjParams);

                if (spjResult.outputLimitExceeded) {
                    return 'OLE';
                } else if (spjResult.timeout) {
                    return 'TLE';
                } else if (spjResult.exitCode === 0) {
                    return 'AC';
                } else {
                    return 'WA';
                }
            } finally {
                await window.electronAPI.deleteTempFile(inputFile);
                await window.electronAPI.deleteTempFile(actualFile);
                await window.electronAPI.deleteTempFile(expectedFile);
            }
        } catch (error) {
            return 'SPJ Error';
        }
    }

    async getMaxParallelThreads() {
        const fallbackThreads = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 2;
        let cpuThreads = fallbackThreads;
        try {
            const remoteCount = await window.electronAPI?.getCpuThreads?.();
            if (Number.isFinite(remoteCount) && remoteCount > 0) {
                cpuThreads = remoteCount;
            }
        } catch (_) { }
        const maxParallel = Math.max(1, Math.floor(cpuThreads / 2));
        return { cpuThreads, maxParallel };
    }

    async ensureThreadLimitUI() {
        try {
            const { cpuThreads, maxParallel } = await this.getMaxParallelThreads();
            this.maxParallelThreads = maxParallel;
            const input = document.getElementById('compare-threads');
            const hint = document.getElementById('compare-threads-hint');
            if (input) {
                input.max = String(maxParallel);
                const current = parseInt(input.value);
                if (Number.isFinite(current)) {
                    const capped = Math.max(1, Math.min(current, maxParallel));
                    if (capped !== current) input.value = String(capped);
                }
            }
            if (hint) {
                hint.textContent = `上限 = CPU 线程数/2`;
            }
            logInfo('[对拍器] 线程上限已更新', { cpuThreads, maxParallel });
        } catch (error) {
            logWarn('[对拍器] 获取线程上限失败', error);
        }
    }

    stopComparison() {
        const task = this.getActiveTask();
        if (!task) return;
        task.state.shouldStop = true;
        task.state.isRunning = false;
        if (task.state.mode === 'running') {
            task.state.mode = 'idle';
        }
        this.updateUIForTask(task);
    }

    resetComparison() {
        const task = this.getActiveTask();
        if (!task) return;
        task.state.shouldStop = true;
        task.state.isRunning = false;
        task.state.currentTest = 0;
        task.state.totalTests = 0;
        task.state.statusText = '准备中';
        task.state.errorResult = null;
        task.state.warningMessage = null;
        task.state.mode = 'idle';
        this.renderTask(task);
    }

    updateUIForTask(task) {
        const startBtn = document.getElementById('compare-start-btn');
        const stopBtn = document.getElementById('compare-stop-btn');
        const resetBtn = document.getElementById('compare-reset-btn');

        const running = !!task?.state?.isRunning && task?.state?.mode === 'running';

        if (startBtn) startBtn.disabled = running;
        if (stopBtn) stopBtn.disabled = !running;
        if (resetBtn) resetBtn.disabled = running;
    }

    updateStatusText(text) {
        const statusText = document.getElementById('status-text');
        if (statusText) statusText.textContent = text;
    }

    updateTaskStatus(task, text) {
        if (!task) return;
        task.state.statusText = text;
        if (this.activeTaskKey === task.key) {
            this.updateStatusText(text);
        }
    }

    updateProgress(currentTest, totalTests) {
        const currentTestEl = document.getElementById('current-test');
        const progressFill = document.getElementById('progress-fill');

        if (currentTestEl) {
            currentTestEl.textContent = `第 ${currentTest} 组`;
        }

        if (progressFill && totalTests > 0) {
            const percentage = (currentTest / totalTests) * 100;
            progressFill.style.width = `${percentage}%`;
        }
    }

    updateTaskProgress(task) {
        if (!task) return;
        if (this.activeTaskKey !== task.key) return;
        this.updateProgress(task.state.currentTest, task.state.totalTests);
    }

    showStatus() {
        const statusSection = document.getElementById('compare-status');
        if (statusSection) {
            statusSection.style.display = 'block';
        }
        this.hideError();
        this.hideComplete();
    }

    hideStatus() {
        const statusSection = document.getElementById('compare-status');
        if (statusSection) {
            statusSection.style.display = 'none';
        }
    }

    showError(errorResult) {
        const errorSection = document.getElementById('compare-result');
        const errorTitle = document.getElementById('error-title');
        const errorTestNum = document.getElementById('error-test-num');
        const inputDiff = document.getElementById('input-diff');
        const stdOutputDiff = document.getElementById('std-output-diff');
        const testOutputDiff = document.getElementById('test-output-diff');
        const stdOutputDiffLabel = document.getElementById('std-output-diff-label');
        const testOutputDiffLabel = document.getElementById('test-output-diff-label');

        if (errorResult && errorSection) {
            errorSection.style.display = 'block';

            if (errorTitle) {
                const errType = errorResult.errorType;
                if (errType === 'generator_program_error') {
                    const generatorType = errorResult.generatorErrorType || '';
                    let detailLabel = '运行错误';
                    if (generatorType === 'ole') {
                        detailLabel = '输出超过限制 (OLE)';
                    } else if (generatorType === 'tle') {
                        detailLabel = '超时 (TLE)';
                    } else if (generatorType === 're') {
                        detailLabel = '运行错误 (RE)';
                    }
                    errorTitle.textContent = `数据生成器${detailLabel}`;
                } else if (errType === 'standard_program_error' || errType === 'test_program_error') {
                    errorTitle.textContent = '运行超时/错误';
                } else if (errType === 'compile_error') {
                    const compileTypeMap = {
                        'standard': '标准程序编译失败',
                        'test': '测试程序编译失败',
                        'generator': '数据生成器编译失败',
                        'settings': '运行环境未设置',
                        'general': '编译失败'
                    };
                    errorTitle.textContent = compileTypeMap[errorResult.compileType] || '编译失败';
                } else {
                    errorTitle.textContent = '发现差异';
                }
            }

            if (errorTestNum) {
                errorTestNum.textContent = `第 ${errorResult.testNumber} 组`;
            }

            if (inputDiff) {
                inputDiff.textContent = errorResult.input;
            }

            if (stdOutputDiff) {
                const errType = errorResult.errorType;
                if (errType === 'compile_error') {
                    stdOutputDiff.textContent = errorResult.errorMessage;
                    if (stdOutputDiffLabel) {
                        stdOutputDiffLabel.textContent = '标准程序输出';
                    }
                } else if (errType === 'generator_program_error') {
                    stdOutputDiff.textContent = this.limitOutputLines(errorResult.stdOutput || '', 100);
                    if (stdOutputDiffLabel) {
                        stdOutputDiffLabel.textContent = '数据生成器输出/错误';
                    }
                } else if (errType === 'standard_program_error' || errType === 'test_program_error') {
                    stdOutputDiff.textContent = this.limitOutputLines(errorResult.stdOutput || '', 100);
                    if (stdOutputDiffLabel) {
                        stdOutputDiffLabel.textContent = '标准程序输出';
                    }
                } else {
                    if (errorResult.usedSpj) {
                        if (stdOutputDiffLabel) {
                            stdOutputDiffLabel.textContent = '标准程序输出';
                        }
                        stdOutputDiff.textContent = this.limitOutputLines(errorResult.stdOutput, 100);
                    } else {
                        const diffPosition = this.getDifferenceInfo(errorResult.stdOutput, errorResult.testOutput);
                        if (stdOutputDiffLabel) {
                            if (diffPosition) {
                                stdOutputDiffLabel.innerHTML = `标准程序输出 <span class="diff-info">(第 ${diffPosition.line} 行第 ${diffPosition.char} 字符有差异)</span>`;
                            } else {
                                stdOutputDiffLabel.textContent = '标准程序输出';
                            }
                        }
                        stdOutputDiff.innerHTML = this.formatCompareOutput(errorResult.stdOutput, errorResult.testOutput, 'standard');
                    }
                }
            }

            if (testOutputDiff) {
                const errType = errorResult.errorType;
                if (errType === 'compile_error') {
                    testOutputDiff.textContent = '';
                    if (testOutputDiffLabel) {
                        testOutputDiffLabel.textContent = '测试程序输出';
                    }
                } else if (errType === 'generator_program_error') {
                    testOutputDiff.textContent = this.limitOutputLines(errorResult.testOutput || '', 100);
                    if (testOutputDiffLabel) {
                        testOutputDiffLabel.textContent = '标准/测试程序输出';
                    }
                } else if (errType === 'standard_program_error' || errType === 'test_program_error') {
                    testOutputDiff.textContent = this.limitOutputLines(errorResult.testOutput || '', 100);
                    if (testOutputDiffLabel) {
                        testOutputDiffLabel.textContent = '测试程序输出';
                    }
                } else {
                    if (errorResult.usedSpj) {
                        if (testOutputDiffLabel) {
                            testOutputDiffLabel.textContent = '测试程序输出';
                        }
                        testOutputDiff.textContent = this.limitOutputLines(errorResult.testOutput, 100);
                    } else {
                        const diffPosition = this.getDifferenceInfo(errorResult.testOutput, errorResult.stdOutput);
                        if (testOutputDiffLabel) {
                            if (diffPosition) {
                                testOutputDiffLabel.innerHTML = `测试程序输出 <span class="diff-info">(第 ${diffPosition.line} 行第 ${diffPosition.char} 字符有差异)</span>`;
                            } else {
                                testOutputDiffLabel.textContent = '测试程序输出';
                            }
                        }
                        testOutputDiff.innerHTML = this.formatCompareOutput(errorResult.testOutput, errorResult.stdOutput, 'test');
                    }
                }
            }
        }

        this.hideStatus();
        this.hideComplete();
    }

    hideError() {
        const errorSection = document.getElementById('compare-result');
        if (errorSection) {
            errorSection.style.display = 'none';
        }
    }

    showComplete(totalTests, warningMessage = null) {
        const completeSection = document.getElementById('compare-complete');
        const completedTests = document.getElementById('completed-tests');
        const completeInfo = completeSection?.querySelector('.complete-info span');

        if (completeSection) {
            completeSection.style.display = 'flex';
        }

        if (completedTests) {
            completedTests.textContent = totalTests;
        }

        if (warningMessage && completeInfo) {
            completeInfo.innerHTML = `已完成 <span id="completed-tests">${totalTests}</span> 组测试，未发现差异<br><span style="color: #ffc107; font-size: 11px; margin-top: 4px; display: inline-block;">${warningMessage}</span>`;
        } else if (completeInfo) {
            completeInfo.innerHTML = `已完成 <span id="completed-tests">${totalTests}</span> 组测试，未发现差异`;
        }

        this.hideStatus();
        this.hideError();
    }

    hideComplete() {
        const completeSection = document.getElementById('compare-complete');
        if (completeSection) {
            completeSection.style.display = 'none';
        }
    }

    showTaskCompileError(task, errorType, errorMessage) {
        if (!task) {
            this.showError({
                errorType: 'compile_error',
                compileType: errorType,
                errorMessage: errorMessage,
                testNumber: 0,
                input: '',
                stdOutput: '',
                testOutput: ''
            });
            this.hideStatus();
            this.hideComplete();
            return;
        }

        task.state.errorResult = {
            errorType: 'compile_error',
            compileType: errorType,
            errorMessage: errorMessage,
            testNumber: 0,
            input: '',
            stdOutput: '',
            testOutput: ''
        };
        task.state.mode = 'error';
        task.state.isRunning = false;
        task.state.shouldStop = true;

        if (this.activeTaskKey === task.key) {
            this.renderTask(task);
        }

        try {
            logError('[CompareCompileError]', {
                type: errorType,
                message: String(errorMessage || ''),
                context: {
                    standardCode: task.config.standardCodePath,
                    testCode: task.config.testCodePath,
                    generator: task.config.generatorPath,
                    useTestlib: task.config.useTestlib,
                    spjPath: task.config.spjPath
                }
            });
        } catch (_) { }
        try {
            const text = String(errorMessage || '');
            const lines = text.split(/\r?\n/).filter(l => l.trim());
            const diags = [];
            for (const line of lines) {
                const m = line.match(/^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+)$/i);
                if (m) {
                    const [, file, lineNum, colNum, sev, msg] = m;
                    diags.push({
                        file,
                        line: parseInt(lineNum, 10) || 1,
                        column: colNum ? parseInt(colNum, 10) : 1,
                        severity: /fatal error|error/i.test(sev) ? 'error' : (/warning/i.test(sev) ? 'warning' : 'note'),
                        message: msg,
                        raw: line
                    });
                }
            }
            if (diags.length && window.editorManager && window.editorManager.applyDiagnostics) {
                window.editorManager.applyDiagnostics(diags);
            }
        } catch { }
    }

    showSuccessMessage(message) {
        this.showComplete(message);
    }

    limitOutputLines(output, maxLines) {
        const safeOutput = output == null ? '' : String(output);
        const lines = safeOutput.split('\n');
        if (lines.length > maxLines) {
            return lines.slice(0, maxLines).join('\n') + '\n[输出过大，已省略]';
        }
        return safeOutput;
    }

    formatCompareOutput(currentOutput, otherOutput, outputType) {
        const currentLines = currentOutput.split('\n');
        const otherLines = otherOutput.split('\n');
        const maxLines = 100;

        let firstDiffLine = -1;
        const maxCompareLines = Math.max(currentLines.length, otherLines.length);

        for (let i = 0; i < maxCompareLines; i++) {
            const currentLine = currentLines[i] || '';
            const otherLine = otherLines[i] || '';
            if (currentLine.trimEnd() !== otherLine.trimEnd()) {
                firstDiffLine = i;
                break;
            }
        }

        if (firstDiffLine === -1) {
            return this.addLineNumbers(this.limitOutputLines(currentOutput, maxLines));
        }

        const contextLines = 10;
        const startLine = Math.max(0, firstDiffLine - contextLines);
        const endLine = Math.min(currentLines.length, firstDiffLine + contextLines + 1);

        const displayLines = Math.min(maxLines, endLine - startLine);
        const actualEndLine = startLine + displayLines;

        let result = '';

        for (let i = startLine; i < actualEndLine && i < currentLines.length; i++) {
            const lineNum = i + 1;
            const line = currentLines[i] || '';
            const isDiffLine = i === firstDiffLine;

            if (isDiffLine && outputType === 'test') {
                const otherLine = otherLines[i] || '';
                const highlightedLine = this.highlightCharacterDifferences(line, otherLine);
                result += `<div class="diff-line"><span class="line-number">${lineNum.toString().padStart(4)} </span>${highlightedLine}</div>`;
            } else {
                result += `<div class="diff-line"><span class="line-number">${lineNum.toString().padStart(4)} </span>${this.escapeHtml(line)}</div>`;
            }
        }

        if (actualEndLine < currentLines.length) {
            result += '<div class="diff-truncated">[输出过大，已省略]</div>';
        }

        return result;
    }

    addLineNumbers(output) {
        const lines = output.split('\n');
        let result = '';

        for (let i = 0; i < lines.length; i++) {
            const lineNum = i + 1;
            const line = lines[i];
            if (line === '[输出过大，已省略]') {
                result += `<div class="diff-truncated">${line}</div>`;
            } else {
                result += `<div class="diff-line"><span class="line-number">${lineNum.toString().padStart(4)} </span>${this.escapeHtml(line)}</div>`;
            }
        }

        return result;
    }

    highlightCharacterDifferences(text1, text2) {
        if (!text1 && !text2) return '';
        if (!text1) return `<span class="diff-highlight">${this.escapeHtml(text2)}</span>`;
        if (!text2) return this.escapeHtml(text1);

        const t1 = this.normalizeForCompare(text1);
        const t2 = this.normalizeForCompare(text2);

        let diffIndex = 0;
        const minLength = Math.min(t1.length, t2.length);
        while (diffIndex < minLength && t1[diffIndex] === t2[diffIndex]) diffIndex++;

        if (diffIndex < t1.length) {
            const beforeDiff = this.escapeHtml(t1.substring(0, diffIndex));
            const diffChar = this.escapeHtml(t1.substring(diffIndex, diffIndex + 1));
            const afterDiff = this.escapeHtml(t1.substring(diffIndex + 1));
            return beforeDiff + `<span class="diff-highlight">${diffChar}</span>` + afterDiff;
        }
        const result = this.escapeHtml(t1);
        if (t1.length < t2.length) {
            const icon = (window.uiIcons && typeof window.uiIcons.svg === 'function') ? window.uiIcons.svg('emptyBox') : '';
            return result + `<span class="diff-highlight">${icon}</span>`;
        }
        return result;
    }

    getDifferenceInfo(actual, expected) {
        const normActual = this.normalizeForCompare(actual);
        const normExpected = this.normalizeForCompare(expected);

        if (normActual === normExpected) return null;

        const actualLines = normActual.split('\n');
        const expectedLines = normExpected.split('\n');

        for (let i = 0; i < Math.max(actualLines.length, expectedLines.length); i++) {
            const actualLine = actualLines[i] || '';
            const expectedLine = expectedLines[i] || '';

            if (actualLine !== expectedLine) {
                for (let j = 0; j < Math.max(actualLine.length, expectedLine.length); j++) {
                    if (actualLine[j] !== expectedLine[j]) {
                        return {
                            line: i + 1,
                            char: j + 1
                        };
                    }
                }
                return {
                    line: i + 1,
                    char: Math.min(actualLine.length, expectedLine.length) + 1
                };
            }
        }

        return null;
    }

    normalizeForCompare(text) {
        if (text == null) return '';
        let s = String(text);
        s = s.replace(/^\uFEFF/, '');
        s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        s = s.replace(/\uFEFF/g, '');
        return s;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    highlightDifferences(text1, text2) {
        return this.highlightCharacterDifferences(text1, text2);
    }

    async exportResults() {
        const task = this.getActiveTask();
        const errorResult = task?.state?.errorResult;
        if (!errorResult) {
            this.showTaskCompileError(task, 'general', '没有可导出的错误结果');
            return;
        }

        try {
            const result = await window.electronAPI.showOpenDialog({
                title: '选择导出目录',
                defaultPath: 'test_data',
                properties: ['openDirectory', 'createDirectory']
            });

            if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
                const exportDir = result.filePaths[0];

                await window.electronAPI.ensureDir(exportDir);

                const inputFile = await window.electronAPI.pathJoin(exportDir, 'input.in');
                const stdOutputFile = await window.electronAPI.pathJoin(exportDir, 'std_or_force_output.out');
                const testOutputFile = await window.electronAPI.pathJoin(exportDir, 'code_output.out');

                await window.electronAPI.createFile(inputFile, errorResult.input);
                await window.electronAPI.createFile(stdOutputFile, errorResult.stdOutput);
                await window.electronAPI.createFile(testOutputFile, errorResult.testOutput);

                this.showSuccessMessage(`测试数据已导出到: ${exportDir}`);
            }
        } catch (error) {
            logError('导出失败:', error);
            this.showCompileError('general', '导出失败: ' + error.message);
        }
    }

    async cleanupCompiledExecutables(task) {
        if (!task?.compiledExecutables) {
            return;
        }

        const { stdExe, testExe, generatorExe, spjExe } = task.compiledExecutables;
        const executables = [stdExe, testExe, generatorExe, spjExe].filter(Boolean);

        for (const exe of executables) {
            try {
                await window.electronAPI.deleteTempFile(exe);
                logInfo('[对拍器] 已清理编译产物:', exe);
            } catch (error) {
                logWarn('[对拍器] 清理编译产物失败:', exe, error);
            }
        }

        task.compiledExecutables = null;
    }

    async autoSaveCurrentFile() {
        try {
            const currentEditor = window.editorManager?.getCurrentEditor();
            if (!currentEditor) {
                logInfo('[对拍器-自动保存] 没有当前编辑器');
                return;
            }

            const filePath = currentEditor.filePath || (currentEditor.getFilePath && currentEditor.getFilePath());
            if (!filePath || filePath.startsWith('untitled')) {
                logInfo('[对拍器-自动保存] 文件未保存或为临时文件，跳过自动保存');
                return;
            }

            const content = currentEditor.getValue();
            if (content === null || content === undefined) {
                logInfo('[对拍器-自动保存] 无法获取文件内容');
                return;
            }

            if (window.tabManager) {
                const fileName = filePath.split(/[\\/]/).pop();
                const tab = window.tabManager.getTabByFileName && window.tabManager.getTabByFileName(fileName);
                if (tab && !tab.modified) {
                    logInfo('[对拍器-自动保存] 文件未修改，跳过保存');
                    return;
                }
            }

            logInfo('[对拍器-自动保存] 开始保存文件:', filePath);

            if (window.electronAPI && window.electronAPI.saveFile) {
                await window.electronAPI.saveFile(filePath, content);
                logInfo('[对拍器-自动保存] 文件保存成功');

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
                logWarn('[对拍器-自动保存] electronAPI 不可用');
            }
        } catch (error) {
            logError('[对拍器-自动保存] 保存文件失败:', error);
        }
    }
}

if (typeof window !== 'undefined') {
    window.CodeComparer = CodeComparer;
}