class CodeComparer {
    constructor() {
        this.standardCodePath = '';
        this.testCodePath = '';
        this.generatorPath = '';
        this.useTestlib = false;
        this.spjPath = '';
        this.isRunning = false;
        this.shouldStop = false;
        this.currentTest = 0;
        this.totalTests = 0;
        this.errorResult = null;
        this.eventsbound = false;

        this.setupEventListeners();
    }

    activate() {
        logInfo('激活代码对拍器面板');
        setTimeout(() => {
            this.checkCompilerAndUpdate();
        }, 100);
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

        if (useTestlibCheckbox) {
            useTestlibCheckbox.addEventListener('change', (e) => {
                this.useTestlib = e.target.checked;
            });
        }

        if (spjBrowseBtn) {
            spjBrowseBtn.addEventListener('click', () => this.browseSpjFile());
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
            }
        } catch (error) {
            logError('选择标准代码文件失败:', error);
        }
    }

    async browseTestCode() {
        try {
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
                    { name: 'C++ 文件', extensions: ['cpp', 'cc', 'cxx', 'c'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                this.generatorPath = result.filePaths[0];
                this.updateFilePath('generator-path', this.generatorPath);
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
            }
        } catch (error) {
            logError('选择SPJ文件失败:', error);
        }
    }

    updateFilePath(elementId, filePath) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = filePath;
            element.classList.add('selected');
        }
    }

    async startComparison() {
        await this.autoSaveCurrentFile();

        if (!this.standardCodePath || !this.testCodePath || !this.generatorPath) {
            this.showCompileError('general', '请先选择所有必要的文件（标准代码、测试代码、数据生成器）');
            return;
        }

        logInfo('对拍器文件检查:');
        logInfo('标准代码:', this.standardCodePath);
        logInfo('测试代码:', this.testCodePath);
        logInfo('数据生成器:', this.generatorPath);

        try {
            const settings = await window.electronAPI.getAllSettings();
            if (!settings || !settings.compilerPath) {
                this.showCompileError('general', '请先设置编译器路径');
                return;
            }
        } catch (error) {
            logError('获取编译器设置失败:', error);
            this.showCompileError('general', '无法获取编译器设置');
            return;
        }

        let compareCount = parseInt(document.getElementById('compare-count').value) || 100;
        compareCount = Math.max(1, Math.min(compareCount, 100000));
        const timeLimit = parseInt(document.getElementById('time-limit').value);
        const effectiveTimeLimit = Number.isFinite(timeLimit) ? timeLimit : 1000;

        this.totalTests = compareCount;
        this.currentTest = 0;
        this.isRunning = true;
        this.shouldStop = false;
        this.errorResult = null;

        this.updateUIForRunning(true);
        this.showStatus();

        try {
            logInfo(`开始对拍！计划执行 ${this.totalTests} 组测试，时间限制 ${timeLimit}ms`);

            const compiledPrograms = await this.compilePrograms();

            if (!compiledPrograms) {
                this.stopComparison();
                return;
            }

            logInfo('所有程序编译成功，开始执行对拍');

            await this.runComparison(compiledPrograms, effectiveTimeLimit);

        } catch (error) {
            logError('对拍过程出错:', error);
            this.showCompileError('general', '对拍过程出错: ' + error.message);
        }
    }

    async compilePrograms() {
        try {
            const settings = await window.electronAPI.getAllSettings();
            const compilerPath = settings.compilerPath;
            let compilerArgs = settings.compilerArgs || '-std=c++14 -O2';

            if (this.useTestlib) {
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
            const generatorExe = await window.electronAPI.pathJoin(tempDir, `generator_${timestamp}${exeSuffix}`);

            this.updateStatus('编译标准程序...');
            const stdResult = await window.electronAPI.compileFile({
                inputFile: this.standardCodePath,
                outputFile: stdExe,
                compilerPath: compilerPath,
                compilerArgs: compilerArgs,
                workingDirectory: await window.electronAPI.pathDirname(this.standardCodePath)
            });

            if (!stdResult.success) {
                this.showCompileError('standard', stdResult.stderr || stdResult.stdout || '编译失败');
                return null;
            }

            this.updateStatus('编译测试程序...');
            const testResult = await window.electronAPI.compileFile({
                inputFile: this.testCodePath,
                outputFile: testExe,
                compilerPath: compilerPath,
                compilerArgs: compilerArgs,
                workingDirectory: await window.electronAPI.pathDirname(this.testCodePath)
            });

            if (!testResult.success) {
                this.showCompileError('test', testResult.stderr || testResult.stdout || '编译失败');
                return null;
            }

            this.updateStatus('编译数据生成器...');
            const generatorResult = await window.electronAPI.compileFile({
                inputFile: this.generatorPath,
                outputFile: generatorExe,
                compilerPath: compilerPath,
                compilerArgs: compilerArgs,
                workingDirectory: await window.electronAPI.pathDirname(this.generatorPath)
            });

            if (!generatorResult.success) {
                this.showCompileError('generator', generatorResult.stderr || generatorResult.stdout || '编译失败');
                return null;
            }

            let spjExe = null;

            if (this.useTestlib && this.spjPath) {
                this.updateStatus('编译Special Judge程序...');
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
                    inputFile: this.spjPath,
                    outputFile: spjExe,
                    compilerPath: compilerPath,
                    compilerArgs: spjCompilerArgs,
                    workingDirectory: await window.electronAPI.pathDirname(this.spjPath)
                });

                if (!spjResult.success) {
                    this.showCompileError('spj', spjResult.stderr || spjResult.stdout || '编译失败');
                    return null;
                }
            }

            this.compiledExecutables = {
                stdExe,
                testExe,
                generatorExe,
                spjExe
            };

            return {
                stdExe,
                testExe,
                generatorExe,
                spjExe
            };

        } catch (error) {
            logError('编译程序失败:', error);
            this.showCompileError('general', '编译程序失败: ' + error.message);
            return null;
        }
    }

    async runComparison(programs, timeLimit) {
        const { stdExe, testExe, generatorExe, spjExe } = programs;
        let failedGenerations = 0;

        for (let i = 1; i <= this.totalTests && !this.shouldStop; i++) {
            this.currentTest = i;
            this.updateStatus(`第 ${i} 组测试`);
            this.updateProgress();

            try {
                const generation = await this.generateTestData(generatorExe, 0);
                if (!generation || generation.success !== true) {
                    const generatorMessage = generation?.message || '数据生成器运行失败';
                    const generatedOutput = generation?.result?.output || '';
                    const generatorType = generation?.type || 'unknown';
                    try {
                        logError(`第 ${i} 组：数据生成失败 (${generatorType})`, generatorMessage);
                    } catch (_) { }

                    this.errorResult = {
                        testNumber: i,
                        input: generatedOutput ? this.limitOutputLines(generatedOutput, 50) : '[生成器未产生有效输入]',
                        stdOutput: generatorMessage,
                        testOutput: '标准/测试程序未运行',
                        errorType: 'generator_program_error',
                        generatorErrorType: generatorType
                    };
                    this.showError();
                    this.stopComparison();
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
                    this.errorResult = {
                        testNumber: i,
                        input: inputData,
                        stdOutput: errorMsg,
                        testOutput: '程序未运行',
                        errorType: 'standard_program_error'
                    };
                    this.showError();
                    this.stopComparison();
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
                    this.errorResult = {
                        testNumber: i,
                        input: inputData,
                        stdOutput: stdOutput.output,
                        testOutput: errorMsg,
                        errorType: 'test_program_error'
                    };
                    this.showError();
                    this.stopComparison();
                    return;
                }

                if (this.useTestlib && spjExe) {
                    const spjResult = await this.judgeWithSpj(spjExe, inputData, testOutput.output, stdOutput.output, timeLimit);
                    if (spjResult !== 'AC') {
                        this.errorResult = {
                            testNumber: i,
                            input: inputData,
                            stdOutput: stdOutput.output,
                            testOutput: testOutput.output,
                            errorType: 'spj_error',
                            errorMessage: `SPJ 结果: ${spjResult}`
                        };
                        this.showError();
                        this.stopComparison();
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
                        this.errorResult = {
                            testNumber: i,
                            input: inputData,
                            stdOutput: stdOutput.output,
                            testOutput: testOutput.output,
                            usedSpj: false
                        };
                        this.showError();
                        this.stopComparison();
                        return;
                    }
                }

            } catch (error) {
                logError(`第 ${i} 组测试出错:`, error);
                continue;
            }
        }

        if (!this.shouldStop) {
            const successfulTests = this.totalTests - failedGenerations;
            if (failedGenerations === 0) {
                logInfo(`对拍完成！共执行 ${successfulTests} 组测试，未发现差异`);
                this.showComplete();
            } else {
                logInfo(`对拍完成，但有 ${failedGenerations} 组数据生成失败。共成功执行 ${successfulTests} 组测试，未在成功组中发现差异`);
                this.showComplete(`有 ${failedGenerations} 组数据生成失败，请检查数据生成器`);
            }
        } else {
            logInfo(`对拍被手动停止，已执行 ${this.currentTest} 组测试，其中有 ${failedGenerations} 组生成失败`);
        }

        this.stopComparison();
    }

    async generateTestData(generatorExe, timeLimit) {
        try {
            const result = await this.runProgram(generatorExe, '', timeLimit);

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

    stopComparison() {
        this.shouldStop = true;
        this.isRunning = false;
        this.updateUIForRunning(false);

        this.cleanupCompiledExecutables();
    }

    resetComparison() {
        this.stopComparison();
        this.currentTest = 0;
        this.totalTests = 0;
        this.errorResult = null;
        this.hideStatus();
        this.hideError();
        this.hideComplete();

        this.cleanupCompiledExecutables();
    }

    updateUIForRunning(running) {
        const startBtn = document.getElementById('compare-start-btn');
        const stopBtn = document.getElementById('compare-stop-btn');
        const resetBtn = document.getElementById('compare-reset-btn');

        if (startBtn) startBtn.disabled = running;
        if (stopBtn) stopBtn.disabled = !running;
        if (resetBtn) resetBtn.disabled = running;
    }

    updateStatus(text) {
        const statusText = document.getElementById('status-text');
        if (statusText) {
            statusText.textContent = text;
        }
    }

    updateProgress() {
        const currentTestEl = document.getElementById('current-test');
        const progressFill = document.getElementById('progress-fill');

        if (currentTestEl) {
            currentTestEl.textContent = `第 ${this.currentTest} 组`;
        }

        if (progressFill && this.totalTests > 0) {
            const percentage = (this.currentTest / this.totalTests) * 100;
            progressFill.style.width = `${percentage}%`;
        }
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

    showError() {
        const errorSection = document.getElementById('compare-result');
        const errorTitle = document.getElementById('error-title');
        const errorTestNum = document.getElementById('error-test-num');
        const inputDiff = document.getElementById('input-diff');
        const stdOutputDiff = document.getElementById('std-output-diff');
        const testOutputDiff = document.getElementById('test-output-diff');
        const stdOutputDiffLabel = document.getElementById('std-output-diff-label');
        const testOutputDiffLabel = document.getElementById('test-output-diff-label');

        if (this.errorResult && errorSection) {
            errorSection.style.display = 'block';

            if (errorTitle) {
                const errType = this.errorResult.errorType;
                if (errType === 'generator_program_error') {
                    const generatorType = this.errorResult.generatorErrorType || '';
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
                        'general': '编译失败'
                    };
                    errorTitle.textContent = compileTypeMap[this.errorResult.compileType] || '编译失败';
                } else {
                    errorTitle.textContent = '发现差异';
                }
            }

            if (errorTestNum) {
                errorTestNum.textContent = `第 ${this.errorResult.testNumber} 组`;
            }

            if (inputDiff) {
                inputDiff.textContent = this.errorResult.input;
            }

            if (stdOutputDiff) {
                const errType = this.errorResult.errorType;
                if (errType === 'compile_error') {
                    stdOutputDiff.textContent = this.errorResult.errorMessage;
                    if (stdOutputDiffLabel) {
                        stdOutputDiffLabel.textContent = '标准程序输出';
                    }
                } else if (errType === 'generator_program_error') {
                    stdOutputDiff.textContent = this.limitOutputLines(this.errorResult.stdOutput || '', 100);
                    if (stdOutputDiffLabel) {
                        stdOutputDiffLabel.textContent = '数据生成器输出/错误';
                    }
                } else if (errType === 'standard_program_error' || errType === 'test_program_error') {
                    stdOutputDiff.textContent = this.limitOutputLines(this.errorResult.stdOutput || '', 100);
                    if (stdOutputDiffLabel) {
                        stdOutputDiffLabel.textContent = '标准程序输出';
                    }
                } else {
                    if (this.errorResult.usedSpj) {
                        if (stdOutputDiffLabel) {
                            stdOutputDiffLabel.textContent = '标准程序输出';
                        }
                        stdOutputDiff.textContent = this.limitOutputLines(this.errorResult.stdOutput, 100);
                    } else {
                        const diffPosition = this.getDifferenceInfo(this.errorResult.stdOutput, this.errorResult.testOutput);
                        if (stdOutputDiffLabel) {
                            if (diffPosition) {
                                stdOutputDiffLabel.innerHTML = `标准程序输出 <span class="diff-info">(第 ${diffPosition.line} 行第 ${diffPosition.char} 字符有差异)</span>`;
                            } else {
                                stdOutputDiffLabel.textContent = '标准程序输出';
                            }
                        }
                        stdOutputDiff.innerHTML = this.formatCompareOutput(this.errorResult.stdOutput, this.errorResult.testOutput, 'standard');
                    }
                }
            }

            if (testOutputDiff) {
                const errType = this.errorResult.errorType;
                if (errType === 'compile_error') {
                    testOutputDiff.textContent = '';
                    if (testOutputDiffLabel) {
                        testOutputDiffLabel.textContent = '测试程序输出';
                    }
                } else if (errType === 'generator_program_error') {
                    testOutputDiff.textContent = this.limitOutputLines(this.errorResult.testOutput || '', 100);
                    if (testOutputDiffLabel) {
                        testOutputDiffLabel.textContent = '标准/测试程序输出';
                    }
                } else if (errType === 'standard_program_error' || errType === 'test_program_error') {
                    testOutputDiff.textContent = this.limitOutputLines(this.errorResult.testOutput || '', 100);
                    if (testOutputDiffLabel) {
                        testOutputDiffLabel.textContent = '测试程序输出';
                    }
                } else {
                    if (this.errorResult.usedSpj) {
                        if (testOutputDiffLabel) {
                            testOutputDiffLabel.textContent = '测试程序输出';
                        }
                        testOutputDiff.textContent = this.limitOutputLines(this.errorResult.testOutput, 100);
                    } else {
                        const diffPosition = this.getDifferenceInfo(this.errorResult.testOutput, this.errorResult.stdOutput);
                        if (testOutputDiffLabel) {
                            if (diffPosition) {
                                testOutputDiffLabel.innerHTML = `测试程序输出 <span class="diff-info">(第 ${diffPosition.line} 行第 ${diffPosition.char} 字符有差异)</span>`;
                            } else {
                                testOutputDiffLabel.textContent = '测试程序输出';
                            }
                        }
                        testOutputDiff.innerHTML = this.formatCompareOutput(this.errorResult.testOutput, this.errorResult.stdOutput, 'test');
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

    showComplete(warningMessage = null) {
        const completeSection = document.getElementById('compare-complete');
        const completedTests = document.getElementById('completed-tests');
        const completeInfo = completeSection?.querySelector('.complete-info span');

        if (completeSection) {
            completeSection.style.display = 'flex';
        }

        if (completedTests) {
            completedTests.textContent = this.totalTests;
        }

        if (warningMessage && completeInfo) {
            completeInfo.innerHTML = `已完成 <span id="completed-tests">${this.totalTests}</span> 组测试，未发现差异<br><span style="color: #ffc107; font-size: 11px; margin-top: 4px; display: inline-block;">${warningMessage}</span>`;
        } else if (completeInfo) {
            completeInfo.innerHTML = `已完成 <span id="completed-tests">${this.totalTests}</span> 组测试，未发现差异`;
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

    showCompileError(errorType, errorMessage) {
        this.errorResult = {
            errorType: 'compile_error',
            compileType: errorType,
            errorMessage: errorMessage,
            testNumber: 0,
            input: '',
            stdOutput: '',
            testOutput: ''
        };

        this.showError();
        this.stopComparison();

        try {
            logError('[CompareCompileError]', {
                type: errorType,
                message: String(errorMessage || ''),
                context: {
                    standardCode: this.standardCodePath,
                    testCode: this.testCodePath,
                    generator: this.generatorPath,
                    useTestlib: this.useTestlib,
                    spjPath: this.spjPath || null
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
            return result + '<span class="diff-highlight">⬚</span>';
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
        if (!this.errorResult) {
            this.showCompileError('general', '没有可导出的错误结果');
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

                await window.electronAPI.createFile(inputFile, this.errorResult.input);
                await window.electronAPI.createFile(stdOutputFile, this.errorResult.stdOutput);
                await window.electronAPI.createFile(testOutputFile, this.errorResult.testOutput);

                this.showSuccessMessage(`测试数据已导出到: ${exportDir}`);
            }
        } catch (error) {
            logError('导出失败:', error);
            this.showCompileError('general', '导出失败: ' + error.message);
        }
    }

    async cleanupCompiledExecutables() {
        if (!this.compiledExecutables) {
            return;
        }

        const { stdExe, testExe, generatorExe, spjExe } = this.compiledExecutables;
        const executables = [stdExe, testExe, generatorExe, spjExe].filter(Boolean);

        for (const exe of executables) {
            try {
                await window.electronAPI.deleteTempFile(exe);
                logInfo('[对拍器] 已清理编译产物:', exe);
            } catch (error) {
                logWarn('[对拍器] 清理编译产物失败:', exe, error);
            }
        }

        this.compiledExecutables = null;
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