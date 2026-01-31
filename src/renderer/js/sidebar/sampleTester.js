class SampleTester {
    constructor() {
        this.samples = [];
        this.currentFile = null;
        this.samplesFilePath = null;
        this.nextId = 1;
        this.isOperating = false;
        this.editorChangeInterval = null;
        this.globalSettings = {
            useTestlib: false,
            spjPath: ''
        };

        this.setupEventListeners();

        try {
            if (window.electronAPI && window.electronAPI.onSampleTesterCreateProblem) {
                window.electronAPI.onSampleTesterCreateProblem((data) => {
                    try {
                        logInfo('[样例测试器] 收到外部 createNewProblem:', data?.problemName);
                        if (!data || !Array.isArray(data.samples) || data.samples.length === 0) return;
                        const workspacePath = window.sidebarManager?.panels?.files?.workspacePath;
                        if (!workspacePath) {
                            logWarn('[样例测试器] 未打开工作区，无法创建题目文件');
                            try { window.sidebarManager?.showPanel?.('files'); } catch (_) { }
                            window.alert?.('请先打开工作区：然后重新发送题目。');
                            return;
                        }
                        const ojPart = (data.OJ || 'OJ').replace(/[^A-Za-z0-9]/g, '');
                        const nameRaw = (data.problemName || 'problem').trim();
                        let firstTokenMatch = nameRaw.match(/[A-Za-z0-9_\-]+/);
                        let idPart = firstTokenMatch ? firstTokenMatch[0] : nameRaw.replace(/[^A-Za-z0-9_\-]/g, '_');
                        if (!idPart) idPart = 'problem';
                        if (idPart.length > 32) idPart = idPart.slice(0, 32);
                        const fileName = `${ojPart}_${idPart}.cpp`;
                        (async () => {
                            try {
                                const targetPath = await window.electronAPI.pathJoin(workspacePath, fileName);
                                let created = false;
                                if (!(await window.electronAPI.checkFileExists(targetPath))) {
                                    let template = '';
                                    try { const all = await window.electronAPI.getAllSettings(); if (all?.cppTemplate) template = all.cppTemplate + '\n'; } catch (_) { }
                                    if (!template) template = '';
                                    await window.electronAPI.createFile(targetPath, template);
                                    created = true;
                                }
                                try {
                                    const content = await window.electronAPI.readFileContent(targetPath);
                                    window.tabManager?.openFile?.(fileName, content, false, targetPath);
                                } catch (e) { logWarn('[样例测试器] 打开题目文件失败', e); }
                                const waitEditor = async () => {
                                    for (let i = 0; i < 20; i++) {
                                        const cur = window.editorManager?.currentEditor;
                                        const p = cur?.getFilePath ? cur.getFilePath() : cur?.filePath;
                                        if (p === targetPath) return true;
                                        await new Promise(r => setTimeout(r, 100));
                                    }
                                    return false;
                                };
                                await waitEditor();
                                this.currentFile = targetPath;
                                await this.updateSamplesFilePath();
                                let existing = [];
                                if (this.samplesFilePath && await window.electronAPI.checkFileExists(this.samplesFilePath)) {
                                    try {
                                        const oldData = JSON.parse(await window.electronAPI.readFileContent(this.samplesFilePath));
                                        existing = Array.isArray(oldData.samples) ? oldData.samples : [];
                                    } catch (_) { }
                                }
                                const baseId = existing.length;
                                const newSamples = data.samples.map((s, idx) => ({
                                    id: baseId + idx + 1,
                                    title: `样例 ${baseId + idx + 1}`,
                                    input: s.input || '',
                                    output: s.output || '',
                                    timeLimit: s.timeLimit && Number.isInteger(s.timeLimit) ? s.timeLimit : 1000,
                                    showInput: true,
                                    showOutput: true,
                                    inputType: 'userinput',
                                    outputType: 'userinput'
                                }));
                                this.samples = existing.concat(newSamples);
                                this.nextId = this.samples.length + 1;
                                await this.saveSamples();
                                this.updateUI();
                                setTimeout(() => this.expandAllSamples(), 120);
                                try { window.sidebarManager?.showPanel?.('samples'); } catch (_) { }
                                logInfo('[样例测试器] 题目处理完成 文件:', targetPath, '新增样例数:', newSamples.length, '创建新文件:', created);
                            } catch (e) { logError('[样例测试器] 处理外部题目失败', e); }
                        })();
                    } catch (e) { logError('[样例测试器] 处理外部样例失败(外层)', e); }
                });
            }
        } catch (e) { logWarn('[样例测试器] 注册外部 API 监听失败', e); }
    }

    async activate() {
        logInfo('激活样例测试器面板');
        await this.updateCurrentFile();
        await this.loadSamples();
        this.updateUI();

        setTimeout(() => {
            this.expandAllSamples();
        }, 100);
    }

    async refresh() {
        await this.updateCurrentFile();
        await this.loadSamples();
        this.updateUI();
    }

    setupEditorChangeListener() {
        if (this.editorChangeInterval) {
            clearInterval(this.editorChangeInterval);
            logInfo('[样例测试器] 清理旧的编辑器变化监听定时器');
        }

        let lastFilePath = null;
        let lastEditor = null;

        const checkEditorChange = async () => {
            if (this.isOperating) {
                logInfo('[样例测试器] 正在操作中，跳过编辑器变化检查');
                return;
            }

            if (window.sidebarManager?.getCurrentPanel() === 'samples') {
                const currentEditor = window.editorManager?.currentEditor;

                if (currentEditor !== lastEditor) {
                    lastEditor = currentEditor;
                    const currentFilePath = currentEditor?.getFilePath ? currentEditor.getFilePath() : currentEditor?.filePath;

                    if (currentFilePath !== lastFilePath) {

                        this.isOperating = true;

                        try {
                            lastFilePath = currentFilePath;

                            this.samples = [];
                            this.samplesFilePath = null;

                            await this.updateCurrentFile();
                            await this.loadSamples();
                            this.updateUI();

                            setTimeout(() => {
                                if (this.samples.length > 0) {
                                    this.expandAllSamples();
                                }
                            }, 100);
                        } finally {
                            this.isOperating = false;
                        }
                    }
                }
            }
        };

        this.editorChangeInterval = setInterval(checkEditorChange, 1000);
        logInfo('[样例测试器] 创建新的编辑器变化监听定时器');

        setTimeout(checkEditorChange, 100);
    }

    setupEventListeners() {
        const addBtn = document.getElementById('add-sample-btn');
        if (addBtn) {
            const newAddBtn = addBtn.cloneNode(true);
            addBtn.parentNode.replaceChild(newAddBtn, addBtn);

            newAddBtn.addEventListener('click', () => {
                logInfo('[样例测试器] 添加按钮被点击');
                this.addSample();
            });
        }

        const runAllBtn = document.getElementById('run-all-samples-btn');
        if (runAllBtn) {
            const newRunAllBtn = runAllBtn.cloneNode(true);
            runAllBtn.parentNode.replaceChild(newRunAllBtn, runAllBtn);

            newRunAllBtn.addEventListener('click', () => {
                logInfo('[样例测试器] 运行所有样例按钮被点击');
                this.runAllSamples();
            });
        }

        this.setupEditorChangeListener();

        const globalUseTestlib = document.getElementById('global-use-testlib');
        if (globalUseTestlib) {
            globalUseTestlib.addEventListener('change', (e) => {
                this.updateGlobalSetting('useTestlib', e.target.checked);
            });
        }

        const browseGlobalSpjBtn = document.getElementById('browse-global-spj-btn');
        if (browseGlobalSpjBtn) {
            browseGlobalSpjBtn.addEventListener('click', () => {
                this.selectGlobalSpjFile();
            });
        }

        const globalSpjPath = document.getElementById('global-spj-path');
        if (globalSpjPath) {
            globalSpjPath.addEventListener('change', (e) => {
                this.updateGlobalSetting('spjPath', e.target.value);
            });
        }
    }

    async updateCurrentFile() {
        if (window.editorManager && window.editorManager.currentEditor) {
            const currentEditor = window.editorManager.currentEditor;

            let filePath = null;
            if (currentEditor.getFilePath) {
                filePath = currentEditor.getFilePath();
            } else if (currentEditor.filePath) {
                filePath = currentEditor.filePath;
            } else if (currentEditor.fileName) {
                filePath = currentEditor.fileName;
            }

            if (filePath &&
                !filePath.startsWith('untitled') &&
                (filePath.endsWith('.cpp') || filePath.endsWith('.c') || filePath.endsWith('.cc') || filePath.endsWith('.cxx'))) {
                this.currentFile = filePath;
                try {
                    await this.updateSamplesFilePath();
                } catch (error) {
                    logError('[样例测试器] 更新样例文件路径失败:', error);
                }
            } else {
                this.currentFile = null;
                this.samplesFilePath = null;
                this.samples = [];
            }
        } else {
            this.currentFile = null;
            this.samplesFilePath = null;
            this.samples = [];
        }
    }

    async updateSamplesFilePath() {
        if (!this.currentFile) {
            this.samplesFilePath = null;
            return;
        }

        try {
            const fileExplorer = window.sidebarManager?.panels?.files;
            if (!fileExplorer || !fileExplorer.workspacePath) {
                logError('[样例测试器] 无法获取工作区路径');
                this.samplesFilePath = null;
                return;
            }

            const workspaceRoot = fileExplorer.workspacePath;

            let relativePath;
            if (this.currentFile.startsWith(workspaceRoot)) {
                relativePath = this.currentFile.substring(workspaceRoot.length);
                if (relativePath.startsWith('\\') || relativePath.startsWith('/')) {
                    relativePath = relativePath.substring(1);
                }
            } else {
                relativePath = this.currentFile.replace(/[:\\]/g, '_');
            }

            const oicppDir = await window.electronAPI.pathJoin(workspaceRoot, '.oicpp');
            const sampleTesterDir = await window.electronAPI.pathJoin(oicppDir, 'sampleTester');

            await window.electronAPI.ensureDirectory(oicppDir);
            await window.electronAPI.ensureDirectory(sampleTesterDir);

            const safeRelativePath = relativePath.replace(/[\\\/]/g, '_').replace(/[<>:"|?*]/g, '_');
            this.samplesFilePath = await window.electronAPI.pathJoin(sampleTesterDir, `${safeRelativePath}.json`);

            logInfo('[样例测试器] 样例文件路径:', this.samplesFilePath);
        } catch (error) {
            logError('[样例测试器] 更新样例文件路径失败:', error);
            this.samplesFilePath = null;
        }
    }

    async computeSamplesFilePathForFile(filePath) {
        if (!filePath) return null;
        const fileExplorer = window.sidebarManager?.panels?.files;
        if (!fileExplorer || !fileExplorer.workspacePath) {
            return null;
        }

        const workspaceRoot = fileExplorer.workspacePath;
        let relativePath;
        if (filePath.startsWith(workspaceRoot)) {
            relativePath = filePath.substring(workspaceRoot.length);
            if (relativePath.startsWith('\\') || relativePath.startsWith('/')) {
                relativePath = relativePath.substring(1);
            }
        } else {
            relativePath = filePath.replace(/[:\\]/g, '_');
        }

        const oicppDir = await window.electronAPI.pathJoin(workspaceRoot, '.oicpp');
        const sampleTesterDir = await window.electronAPI.pathJoin(oicppDir, 'sampleTester');

        await window.electronAPI.ensureDirectory(oicppDir);
        await window.electronAPI.ensureDirectory(sampleTesterDir);

        const safeRelativePath = relativePath.replace(/[\\\/]/g, '_').replace(/[<>:"|?*]/g, '_');
        return await window.electronAPI.pathJoin(sampleTesterDir, `${safeRelativePath}.json`);
    }

    async handleFileRenamed(oldPath, newPath) {
        try {
            if (!oldPath || !newPath) return;
            const oldSamplesPath = await this.computeSamplesFilePathForFile(oldPath);
            const newSamplesPath = await this.computeSamplesFilePathForFile(newPath);
            if (!oldSamplesPath || !newSamplesPath) return;

            const exists = await window.electronAPI.checkFileExists(oldSamplesPath);
            if (exists) {
                const sep = newSamplesPath.includes('\\') ? '\\' : '/';
                const newFileName = newSamplesPath.substring(newSamplesPath.lastIndexOf(sep) + 1);
                await new Promise((resolve) => {
                    const handleRenameResult = (event, renamedOldPath, renamedNewPath, error) => {
                        if (renamedOldPath === oldSamplesPath) {
                            window.electronIPC.ipcRenderer.removeListener('file-renamed', handleRenameResult);
                            resolve({ renamedNewPath, error });
                        }
                    };
                    window.electronIPC.on('file-renamed', handleRenameResult);
                    window.electronIPC.send('rename-file', oldSamplesPath, newFileName);
                });
                logInfo('[样例测试器] 样例配置已重命名:', oldSamplesPath, '->', newSamplesPath);
            }

            if (this.currentFile === oldPath) {
                this.currentFile = newPath;
                this.samplesFilePath = newSamplesPath;
            }
        } catch (error) {
            logWarn('[样例测试器] 重命名样例配置失败:', error);
        }
    }

    async loadSamples() {
        if (!this.samplesFilePath) {
            this.samples = [];
            logInfo('[样例测试器] 没有样例文件路径，清空样例列表');
            return;
        }

        try {
            const fileExists = await window.electronAPI.checkFileExists(this.samplesFilePath);
            if (fileExists) {
                logInfo('[样例测试器] 从文件加载样例:', this.samplesFilePath);
                const data = await window.electronAPI.readFileContent(this.samplesFilePath);
                const parsed = JSON.parse(data);
                this.samples = parsed.samples || [];

                this.loadGlobalSettings(parsed);

                logInfo('[样例测试器] 加载到样例数量:', this.samples.length);

                this.samples.forEach((sample, index) => {
                    sample.id = index + 1;

                    if (sample.type) {
                        if (!sample.inputType) {
                            sample.inputType = sample.type;
                        }
                        if (!sample.outputType) {
                            sample.outputType = sample.type;
                        }
                        delete sample.type;
                    }

                    if (!sample.inputType) {
                        sample.inputType = 'userinput';
                    }
                    if (!sample.outputType) {
                        sample.outputType = 'userinput';
                    }

                    if (sample.hasOwnProperty('useTestlib')) {
                        delete sample.useTestlib;
                    }
                    if (sample.hasOwnProperty('spjPath')) {
                        delete sample.spjPath;
                    }
                });
                const maxId = this.samples.length > 0 ? Math.max(...this.samples.map(s => s.id)) : 0;
                this.nextId = maxId + 1;
            } else {
                logInfo('[样例测试器] 样例文件不存在，使用空列表');
                this.samples = [];
            }
        } catch (error) {
            logError('加载样例失败:', error);
            this.samples = [];
        }
    }

    async saveSamples() {
        if (!this.samplesFilePath) return;

        try {
            const data = {
                samples: this.samples,
                globalSettings: this.globalSettings
            };
            await window.electronAPI.saveFile(this.samplesFilePath, JSON.stringify(data, null, 2));
        } catch (error) {
            logError('保存样例失败:', error);
        }
    }

    updateUI() {
        const noFileMessage = document.getElementById('no-file-message');
        const noSamplesMessage = document.getElementById('no-samples-message');
        const samplesList = document.getElementById('samples-list');
        const addBtn = document.getElementById('add-sample-btn');
        const runAllBtn = document.getElementById('run-all-samples-btn');
        const globalSettings = document.getElementById('global-settings');

        if (!this.currentFile) {
            noFileMessage.style.display = 'flex';
            noSamplesMessage.style.display = 'none';
            samplesList.style.display = 'none';
            globalSettings.style.display = 'none';
            addBtn.disabled = true;
            runAllBtn.disabled = true;
            return;
        }

        noFileMessage.style.display = 'none';
        globalSettings.style.display = 'block';
        addBtn.disabled = false;
        runAllBtn.disabled = this.samples.length === 0;

        this.updateGlobalSettingsUI();

        if (this.samples.length === 0) {
            noSamplesMessage.style.display = 'flex';
            samplesList.style.display = 'none';
        } else {
            noSamplesMessage.style.display = 'none';
            samplesList.style.display = 'block';
            this.renderSamples();
        }
    }

    renderSamples() {
        const samplesList = document.getElementById('samples-list');
        samplesList.innerHTML = '';

        this.samples.forEach(sample => {
            const sampleElement = this.createSampleElement(sample);
            samplesList.appendChild(sampleElement);
        });

        setTimeout(() => {
            const textareas = samplesList.querySelectorAll('.sample-textarea');
            textareas.forEach(textarea => {
                this.autoResizeTextarea(textarea);
            });

            const programOutputs = samplesList.querySelectorAll('.program-output');
            programOutputs.forEach(textarea => {
                this.autoResizeProgramOutput(textarea);
            });
        }, 0);
    }

    createSampleElement(sample) {
        const div = document.createElement('div');
        div.className = 'sample-group';
        div.dataset.sampleId = sample.id;

        let statusBadge = '';
        if (sample.result) {
            statusBadge = `<span class="status-badge status-${sample.result.status.toLowerCase()}">${sample.result.status}</span>`;
            if (sample.result.time) {
                statusBadge += `<span style="color: #858585; font-size: 11px;">${sample.result.time}ms</span>`;
            }
        }

        const inputDisplay = this.getDisplayContent(sample, 'input');
        const outputDisplay = this.getDisplayContent(sample, 'output');

        div.innerHTML = `
            <div class="sample-header" onclick="sampleTester.toggleSample(${sample.id})">
                <span class="sample-title">样例 ${sample.id}</span>
                <div class="sample-status">
                    ${statusBadge}
                </div>
                <div class="sample-controls" onclick="event.stopPropagation()">
                    <button class="sample-run-btn" id="run-btn-${sample.id}" onclick="sampleTester.runSample(${sample.id})" title="运行此样例">
                        运行
                    </button>
                    <button class="sample-delete-btn" onclick="sampleTester.deleteSample(${sample.id}).catch(logError)" title="删除样例">
                        <svg width="12" height="12" viewBox="0 0 12 12">
                            <path d="M2 2l8 8M2 10l8-8" stroke="currentColor" stroke-width="1.5"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="sample-content">
                <div class="sample-content-grid">
                    <div class="sample-io-group">
                        <div class="sample-io-header">
                            <span class="sample-io-label">输入</span>
                            <div class="file-actions">
                                ${sample.inputType === 'file' ?
                `<button class="file-btn switch-btn" onclick="sampleTester.switchToManualInput(${sample.id})" title="切换到手动输入">切换手动输入</button>` :
                `<button class="file-btn" onclick="sampleTester.selectInputFile(${sample.id})" title="从文件读取">从文件读取</button>`
            }
                            </div>
                        </div>
                        ${inputDisplay}
                    </div>
                    <div class="sample-io-group">
                        <div class="sample-io-header">
                            <span class="sample-io-label">期望输出</span>
                            <div class="file-actions">
                                ${sample.outputType === 'file' ?
                `<button class="file-btn switch-btn" onclick="sampleTester.switchToManualOutput(${sample.id})" title="切换到手动输入">切换手动输入</button>` :
                `<button class="file-btn" onclick="sampleTester.selectOutputFile(${sample.id})" title="从文件读取">从文件读取</button>`
            }
                            </div>
                        </div>
                        ${outputDisplay}
                    </div>
                    <div class="program-output-group">
                        <div class="sample-io-header">
                            <span class="sample-io-label">程序输出</span>
                            <span class="diff-info" id="diff-info-${sample.id}" style="display: none;"></span>
                            <div class="output-controls" style="display: ${sample.result?.output ? 'flex' : 'none'};">
                                <button class="export-output-btn" onclick="sampleTester.exportSampleOutput(${sample.id})" title="导出输出到文件">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                        <polyline points="7,10 12,15 17,10"></polyline>
                                        <line x1="12" y1="15" x2="12" y2="3"></line>
                                    </svg>
                                    导出
                                </button>
                            </div>
                        </div>
            <div class="program-output-container" id="output-container-${sample.id}">
              <textarea class="program-output" readonly spellcheck="false" placeholder="运行程序后显示输出..." id="output-${sample.id}">${sample.result?.output || ''}</textarea>
                        </div>
                    </div>
                </div>
                <div class="sample-settings">
                    <div class="setting-group">
                        <span class="setting-label">时限:</span>
                        <input type="number" class="setting-input" value="${sample.timeLimit || 1000}" 
                               onchange="sampleTester.updateSampleSetting(${sample.id}, 'timeLimit', this.value)">
                        <span class="setting-unit">ms</span>
                    </div>
                </div>
            </div>
        `;

        return div;
    }

    getDisplayContent(sample, type) {
        const typeField = type === 'input' ? 'inputType' : 'outputType';
        const isFromFile = sample[typeField] === 'file';

        if (isFromFile) {
            const filePath = type === 'input' ? sample.input : sample.output;
            const abbreviatedPath = this.abbreviateFilePath(filePath);
            const icon = (window.uiIcons && typeof window.uiIcons.svg === 'function') ? window.uiIcons.svg('folder') : '';
            return `<div class="file-reference" title="${filePath}"><span class="file-reference-icon" aria-hidden="true">${icon}</span><span>file: ${abbreviatedPath}</span></div>`;
        } else {
            const content = type === 'input' ? sample.input : sample.output;
            const lines = (content || '').split('\n').length;
            const autoHeight = lines <= 1 ? 'auto-height' : '';

            return `<textarea class="sample-textarea ${autoHeight}" spellcheck="false"
           placeholder="输入${type === 'input' ? '测试数据' : '期望输出'}..."
           onfocus="sampleTester.expandTextarea(this)"
           onblur="sampleTester.collapseTextarea(this)"
           oninput="sampleTester.autoResizeTextarea(this); sampleTester.updateSampleContent(${sample.id}, '${type}', this.value)"
           onchange="sampleTester.updateSampleContent(${sample.id}, '${type}', this.value)">${content || ''}</textarea>`;
        }
    }

    abbreviateFilePath(filePath, maxLength = 10) {
        if (!filePath || filePath.length <= maxLength) {
            return filePath;
        }

        const fileName = filePath.split(/[\\/]/).pop();

        if (fileName.length > maxLength - 3) {
            return '...' + fileName.slice(-(maxLength - 3));
        }

        const availableLength = maxLength - fileName.length - 3;

        if (availableLength <= 0) {
            return '...' + fileName;
        }

        const pathPart = filePath.substring(0, filePath.length - fileName.length);

        if (pathPart.length <= availableLength) {
            return filePath;
        }

        const truncatedPath = pathPart.substring(0, availableLength);
        return truncatedPath + '...' + fileName;
    }

    async addSample() {
        if (!this.currentFile) return;

        this.isOperating = true;
        try {
            const maxId = this.samples.length > 0 ? Math.max(...this.samples.map(s => s.id)) : 0;
            const newId = maxId + 1;

            const newSample = {
                id: newId,
                inputType: 'userinput',
                outputType: 'userinput',
                input: '',
                output: '',
                timeLimit: 1000,
                useTestlib: false,
                spjPath: '',
                result: null
            };

            this.samples.push(newSample);

            this.nextId = newId + 1;
            await this.saveSamples();
            this.updateUI();

            setTimeout(() => {
                const element = document.querySelector(`[data-sample-id="${newSample.id}"]`);
                if (element && !element.classList.contains('expanded')) {
                    element.classList.add('expanded');
                }
            }, 100);
        } finally {
            this.isOperating = false;
        }
    }

    async deleteSample(id) {
        this.isOperating = true;

        try {

            const sampleIndex = this.samples.findIndex(s => s.id === id);
            if (sampleIndex === -1) {
                logWarn('[样例测试器] 未找到要删除的样例:', id);
                return;
            }

            this.samples.splice(sampleIndex, 1);

            this.samples.forEach((sample, index) => {
                sample.id = index + 1;
            });

            const maxId = this.samples.length > 0 ? Math.max(...this.samples.map(s => s.id)) : 0;
            this.nextId = maxId + 1;
            await this.saveSamples();
            this.updateUI();
            logInfo('[样例测试器] 删除操作完成');
        } finally {
            this.isOperating = false;
        }
    }

    toggleSample(id) {
        const element = document.querySelector(`[data-sample-id="${id}"]`);
        if (element) {
            element.classList.toggle('expanded');
        }
    }

    expandAllSamples() {
        const sampleElements = document.querySelectorAll('.sample-group');
        sampleElements.forEach(element => {
            element.classList.add('expanded');
        });
    }

    updateSampleContent(id, type, value) {
        const sample = this.samples.find(s => s.id === id);
        if (sample) {
            sample[type] = value;
            this.saveSamples();
        }
    }

    updateSampleSetting(id, setting, value) {
        const sample = this.samples.find(s => s.id === id);
        if (sample) {
            if (setting === 'timeLimit') {
                sample[setting] = parseInt(value);
            } else if (setting === 'useTestlib') {
                sample[setting] = value;
            } else {
                sample[setting] = value;
            }
            this.saveSamples();
        }
    }

    updateSampleDisplay(id) {
        const sample = this.samples.find(s => s.id === id);
        if (!sample) return;

        const element = document.querySelector(`[data-sample-id="${id}"]`);
        if (!element) return;

        const isExpanded = element.classList.contains('expanded');

        const newElement = this.createSampleElement(sample);

        if (isExpanded) {
            newElement.classList.add('expanded');
        }

        element.parentNode.replaceChild(newElement, element);

        setTimeout(() => {
            const textareas = newElement.querySelectorAll('.sample-textarea');
            textareas.forEach(textarea => {
                this.autoResizeTextarea(textarea);
            });

            const programOutput = newElement.querySelector('.program-output');
            if (programOutput) {
                this.autoResizeProgramOutput(programOutput);
            }
        }, 0);
    }

    expandTextarea(textarea) {
        textarea.classList.add('expanded');
        textarea.classList.remove('auto-height');
    }

    collapseTextarea(textarea) {
        textarea.classList.remove('expanded');
        this.autoResizeTextarea(textarea);
    }

    autoResizeTextarea(textarea) {
        if (textarea.classList.contains('expanded')) return;

        const content = textarea.value;
        const lines = content.split('\n').length;
        const isEmpty = !content.trim();

        if (isEmpty || lines === 1) {
            textarea.classList.add('auto-height');
            textarea.style.height = 'auto';
        } else {
            textarea.classList.remove('auto-height');
            const lineHeight = 16.8;
            const padding = 16;
            const minHeight = Math.min(lines * lineHeight + padding, 200);
            textarea.style.height = `${minHeight}px`;
        }
    }

    autoResizeProgramOutput(textarea) {
        const content = textarea.value;
        const lines = content.split('\n').length;
        const isEmpty = !content.trim();

        if (isEmpty) {
            textarea.style.height = '60px';
        } else {
            const lineHeight = 16.8;
            const padding = 16;
            const calculatedHeight = lines * lineHeight + padding;
            const minHeight = Math.max(60, Math.min(calculatedHeight, 200));
            textarea.style.height = `${minHeight}px`;
        }
    }

    switchToManualInput(id) {
        const sample = this.samples.find(s => s.id === id);
        if (sample) {
            sample.inputType = 'userinput';
            sample.input = '';
            this.saveSamples();
            this.updateSampleDisplay(id);
        }
    }

    switchToManualOutput(id) {
        const sample = this.samples.find(s => s.id === id);
        if (sample) {
            sample.outputType = 'userinput';
            sample.output = '';
            this.saveSamples();
            this.updateSampleDisplay(id);
        }
    }

    async selectInputFile(id) {
        const result = await window.electronAPI.showOpenDialog({
            title: '选择输入文件',
            filters: [
                { name: '文本文件', extensions: ['txt', 'in'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const sample = this.samples.find(s => s.id === id);
            if (sample) {
                sample.inputType = 'file';
                sample.input = result.filePaths[0];
                await this.tryAutoMatchOutputFile(sample);
                this.saveSamples();
                this.updateSampleDisplay(id);
            }
        }
    }

    async selectOutputFile(id) {
        const result = await window.electronAPI.showOpenDialog({
            title: '选择输出文件',
            filters: [
                { name: '文本文件', extensions: ['txt', 'out', 'ans'] },
                { name: '所有文件', extensions: ['*'] }
            ],
            properties: ['openFile']
        });

        if (!result.canceled && result.filePaths.length > 0) {
            const sample = this.samples.find(s => s.id === id);
            if (sample) {
                sample.outputType = 'file';
                sample.output = result.filePaths[0];
                this.saveSamples();
                this.updateSampleDisplay(id);
            }
        }
    }

    async tryAutoMatchOutputFile(sample) {
        if (!sample || !sample.input) return false;

        try {
            const pathInfo = await window.electronAPI.getPathInfo(sample.input);
            if (!pathInfo || !pathInfo.dirname || !pathInfo.basenameWithoutExt) return false;

            const candidates = [`${pathInfo.basenameWithoutExt}.ans`, `${pathInfo.basenameWithoutExt}.out`];
            for (const name of candidates) {
                const candidatePath = await window.electronAPI.pathJoin(pathInfo.dirname, name);
                if (await window.electronAPI.checkFileExists(candidatePath)) {
                    sample.outputType = 'file';
                    sample.output = candidatePath;
                    try { logInfo('[样例测试器] 自动匹配输出文件:', candidatePath); } catch (_) { }
                    return true;
                }
            }
        } catch (error) {
            try { logWarn('[样例测试器] 自动匹配输出文件失败', error); } catch (_) { }
        }
        return false;
    }



    async runSample(id) {
        const sample = this.samples.find(s => s.id === id);
        if (!sample) return;

        const button = document.getElementById(`run-btn-${id}`);
        if (!button || button.disabled) return;

        await this.autoSaveCurrentFile();

        button.disabled = true;
        button.classList.add('running');

        try {
            button.textContent = '编译中';
            const result = await this.executeSample(sample, (status) => {
                if (status === 'compiling') {
                    button.textContent = '编译中';
                } else if (status === 'running') {
                    button.textContent = '运行中';
                }
            });
            sample.result = result;
            this.saveSamples();
            this.updateSampleResult(id, result, sample);
        } catch (error) {
            logError('运行样例失败:', error);
            sample.result = {
                status: 'CE',
                output: error.message,
                time: 0
            };
            this.updateSampleResult(id, sample.result);
        } finally {
            button.disabled = false;
            button.textContent = '运行';
            button.classList.remove('running');
        }
    }

    async runAllSamples() {
        if (this.samples.length === 0) return;

        await this.autoSaveCurrentFile();

        const runAllBtn = document.getElementById('run-all-samples-btn');
        if (runAllBtn) {
            runAllBtn.disabled = true;
            runAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" style="animation: spin 1s linear infinite;"><circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="31.416" stroke-dashoffset="31.416" stroke-linecap="round"/></svg>';
        }

        this.samples.forEach(sample => {
            const button = document.getElementById(`run-btn-${sample.id}`);
            if (button) {
                button.disabled = true;
                button.classList.add('running');
            }
        });

        let executablePath = null;
        let spjExecutablePath = null;

        try {
            const useTestlib = this.globalSettings.useTestlib;
            const spjPath = this.globalSettings.spjPath;

            this.samples.forEach(sample => {
                const button = document.getElementById(`run-btn-${sample.id}`);
                if (button) {
                    button.textContent = '编译中';
                }
            });

            const compileResult = await this.compileCurrentFile(useTestlib);
            if (!compileResult.success) {
                for (const sample of this.samples) {
                    sample.result = {
                        status: 'CE',
                        output: compileResult.stderr || compileResult.stdout || '编译失败',
                        time: 0
                    };
                    this.updateSampleResult(sample.id, sample.result, sample);
                }
                this.saveSamples();
                return;
            }

            executablePath = compileResult.executablePath;

            if (useTestlib && spjPath) {
                const spjCompileResult = await this.compileSpjFile(spjPath);
                if (!spjCompileResult.success) {
                    for (const sample of this.samples) {
                        sample.result = {
                            status: 'CE',
                            output: `SPJ编译失败: ${spjCompileResult.stderr || spjCompileResult.stdout || '编译失败'}`,
                            time: 0
                        };
                        this.updateSampleResult(sample.id, sample.result, sample);
                    }
                    this.saveSamples();
                    return;
                }
                spjExecutablePath = spjCompileResult.executablePath;
            }

            this.samples.forEach(sample => {
                const button = document.getElementById(`run-btn-${sample.id}`);
                if (button) {
                    button.textContent = '运行中';
                }
            });

            const logicalCores = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) ? navigator.hardwareConcurrency : 2;
            const maxParallel = Math.max(1, Math.floor(logicalCores / 2));
            const workerCount = Math.min(maxParallel, this.samples.length);

            logInfo('[样例测试器] 并行运行样例', { logicalCores, workerCount, sampleCount: this.samples.length });

            let currentIndex = 0;
            const worker = async () => {
                while (true) {
                    const index = currentIndex++;
                    if (index >= this.samples.length) return;

                    const sample = this.samples[index];
                    try {
                        const result = await this.executeSampleWithCompiledProgram(sample, executablePath, spjExecutablePath);
                        sample.result = result;
                        this.updateSampleResult(sample.id, result, sample);
                    } catch (error) {
                        logError(`运行样例 ${sample.id} 失败:`, error);
                        sample.result = {
                            status: 'RE',
                            output: error.message,
                            time: 0
                        };
                        this.updateSampleResult(sample.id, sample.result, sample);
                    }
                }
            };

            const workers = Array.from({ length: workerCount }, worker);
            await Promise.all(workers);

            this.saveSamples();

        } finally {
            if (executablePath) {
                try {
                    await window.electronAPI.deleteTempFile(executablePath);
                } catch (e) {
                }
            }

            if (spjExecutablePath) {
                try {
                    await window.electronAPI.deleteTempFile(spjExecutablePath);
                } catch (e) {
                }
            }

            if (runAllBtn) {
                runAllBtn.disabled = false;
                runAllBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14"><path d="M4 2l8 5-8 5V2z" fill="currentColor"/></svg>';
            }

            this.samples.forEach(sample => {
                const button = document.getElementById(`run-btn-${sample.id}`);
                if (button) {
                    button.disabled = false;
                    button.textContent = '运行';
                    button.classList.remove('running');
                }
            });
        }
    }

    async executeSampleWithCompiledProgram(sample, executablePath, spjExecutablePath = null) {
        const useTestlib = this.globalSettings.useTestlib;
        const spjPath = this.globalSettings.spjPath;

        try {
            let inputData = '';
            if (sample.inputType === 'file') {
                try {
                    inputData = await window.electronAPI.readFileContent(sample.input);
                } catch (error) {
                    throw new Error(`无法读取输入文件: ${error.message}`);
                }
            } else {
                inputData = sample.input || '';
            }

            let expectedOutput = '';
            if (sample.outputType === 'file') {
                try {
                    expectedOutput = await window.electronAPI.readFileContent(sample.output);
                } catch (error) {
                    throw new Error(`无法读取输出文件: ${error.message}`);
                }
            } else {
                expectedOutput = sample.output || '';
            }

            const runResult = await this.runProgram(executablePath, inputData, sample.timeLimit);

            let status;
            let spjUsed = false;

            if (runResult.outputLimitExceeded) {
                status = 'OLE';
                try {
                    logWarn('[样例测试器][OLE]', {
                        sampleId: sample.id,
                        limitBytes: runResult.outputLimitBytes,
                        capturedBytes: runResult.capturedOutputBytes,
                        observedBytes: runResult.observedOutputBytes
                    });
                } catch (_) { }
            } else if (runResult.timeout) {
                status = 'TLE';
                try { logWarn('[样例测试器][TLE]', { sampleId: sample.id, durationMs: runResult.time, limitMs: sample.timeLimit }); } catch (_) { }
            } else if (runResult.exitCode !== 0) {
                status = 'RE';
                try { logWarn('[样例测试器][RE]', { sampleId: sample.id, exitCode: runResult.exitCode, stderrBytes: (runResult.stderr || '').length, durationMs: runResult.time }); } catch (_) { }
            } else {
                if (useTestlib && spjExecutablePath) {
                    const normalizedActual = runResult.output.trimEnd();
                    const normalizedExpected = expectedOutput.trimEnd();

                    const spjExists = await window.electronAPI.checkFileExists(spjExecutablePath);

                    if (!spjExists) {
                        status = 'WA';
                    } else {
                        status = await this.judgeWithSpj(spjExecutablePath, inputData, normalizedActual, normalizedExpected);
                    }
                    spjUsed = true;
                } else {
                    status = this.compareOutput(runResult.output, expectedOutput);
                    if (status === 'WA') {
                        const diff = this.getDifferenceInfo((runResult.output || '').trimEnd(), (expectedOutput || '').trimEnd());
                        try {
                            logWarn('[样例测试器][WA]', {
                                sampleId: sample.id,
                                inputSource: sample.inputType === 'file' ? `file:${sample.input}` : 'manual',
                                expectedSource: sample.outputType === 'file' ? `file:${sample.output}` : 'manual',
                                actualLen: (runResult.output || '').length,
                                expectedLen: (expectedOutput || '').length,
                                firstDiff: diff || null
                            });
                        } catch (_) { }
                    }
                }
            }

            return {
                status: status,
                output: this.truncateOutput(runResult.output),
                time: runResult.time,
                usedSpj: spjUsed
            };
        } catch (error) {
            throw error;
        }
    }

    async executeSample(sample, statusCallback = null) {
        const useTestlib = sample.useTestlib !== undefined ? sample.useTestlib : this.globalSettings.useTestlib;

        const spjPath = sample.spjPath || this.globalSettings.spjPath;

        logInfo('[样例测试器] 执行样例调试信息:');
        logInfo('- 样例ID:', sample.id);
        logInfo('- 使用testlib:', useTestlib);
        logInfo('- SPJ路径:', spjPath);
        logInfo('- 全局设置:', this.globalSettings);

        if (statusCallback) statusCallback('compiling');

        const compileResult = await this.compileCurrentFile(useTestlib);
        if (!compileResult.success) {
            return {
                status: 'CE',
                output: compileResult.stderr || compileResult.stdout || '编译失败',
                time: 0
            };
        }

        let executablePath = compileResult.executablePath;
        let spjExecutablePath = null;

        try {
            if (useTestlib && spjPath) {
                logInfo('[样例测试器] 开始编译SPJ程序:', spjPath);
                const spjCompileResult = await this.compileSpjFile(spjPath);

                if (!spjCompileResult.success) {
                    return {
                        status: 'CE',
                        output: `SPJ编译失败: ${spjCompileResult.stderr || spjCompileResult.stdout || '编译失败'}`,
                        time: 0
                    };
                }
                spjExecutablePath = spjCompileResult.executablePath;

            } else {

            }

            let inputData = '';
            if (sample.inputType === 'file') {
                try {
                    inputData = await window.electronAPI.readFileContent(sample.input);
                } catch (error) {
                    throw new Error(`无法读取输入文件: ${error.message}`);
                }
            } else {
                inputData = sample.input || '';
            }

            let expectedOutput = '';
            if (sample.outputType === 'file') {
                try {
                    expectedOutput = await window.electronAPI.readFileContent(sample.output);
                } catch (error) {
                    throw new Error(`无法读取输出文件: ${error.message}`);
                }
            } else {
                expectedOutput = sample.output || '';
            }

            if (statusCallback) {
                statusCallback('running');
            }
            const runResult = await this.runProgram(executablePath, inputData, sample.timeLimit);

            let status;
            let spjUsed = false;

            try {
                if (runResult.outputLimitExceeded) {
                    status = 'OLE';
                    try {
                        logWarn('[样例测试器][OLE]', {
                            sampleId: sample.id,
                            limitBytes: runResult.outputLimitBytes,
                            capturedBytes: runResult.capturedOutputBytes,
                            observedBytes: runResult.observedOutputBytes
                        });
                    } catch (_) { }
                } else if (runResult.timeout) {
                    status = 'TLE';
                    try { logWarn('[样例测试器][TLE]', { sampleId: sample.id, durationMs: runResult.time, limitMs: sample.timeLimit }); } catch (_) { }
                } else if (runResult.exitCode !== 0) {
                    status = 'RE';
                    try { logWarn('[样例测试器][RE]', { sampleId: sample.id, exitCode: runResult.exitCode, stderrBytes: (runResult.stderr || '').length, durationMs: runResult.time }); } catch (_) { }
                } else {
                    if (useTestlib && spjExecutablePath) {
                        const normalizedActual = runResult.output.trimEnd();
                        const normalizedExpected = expectedOutput.trimEnd();

                        const spjExists = await window.electronAPI.checkFileExists(spjExecutablePath);

                        if (!spjExists) {

                            status = 'WA';
                        } else {
                            status = await this.judgeWithSpj(spjExecutablePath, inputData, normalizedActual, normalizedExpected);

                        }
                        spjUsed = true;
                    } else {
                        status = this.compareOutput(runResult.output, expectedOutput);
                        if (status === 'WA') {
                            const diff = this.getDifferenceInfo((runResult.output || '').trimEnd(), (expectedOutput || '').trimEnd());
                            try {
                                logWarn('[样例测试器][WA]', {
                                    sampleId: sample.id,
                                    inputSource: sample.inputType === 'file' ? `file:${sample.input}` : 'manual',
                                    expectedSource: sample.outputType === 'file' ? `file:${sample.output}` : 'manual',
                                    actualLen: (runResult.output || '').length,
                                    expectedLen: (expectedOutput || '').length,
                                    firstDiff: diff || null
                                });
                            } catch (_) { }
                        }
                    }
                }
            } finally {
            }

            return {
                status: status,
                output: this.truncateOutput(runResult.output),
                time: runResult.time,
                usedSpj: spjUsed
            };
        } finally {
            try {
                if (executablePath) {
                    await window.electronAPI.deleteTempFile(executablePath);

                }
            } catch (e) {
            }
        }
    }

    async compileCurrentFile(useTestlib = false) {
        if (!this.currentFile) {
            throw new Error('没有活动的C++文件');
        }

        const content = window.editorManager?.getCurrentContent() || '';
        logInfo('[样例测试器] 获取到的文件内容长度:', content.length);
        if (!content.trim()) {
            throw new Error('文件内容为空');
        }

        const settings = await window.electronAPI.getAllSettings();
        const compilerPath = settings.compilerPath;
        let compilerArgs = settings.compilerArgs || '-std=c++14 -O2';

        if (!compilerPath) {
            throw new Error('请先设置编译器路径');
        }

        if (useTestlib) {
            let testlibIncludePath;
            if (settings.testlibPath) {
                const pathInfo = await window.electronAPI.getPathInfo(settings.testlibPath);
                testlibIncludePath = pathInfo.dirname;
            } else {
                const pathInfo = await window.electronAPI.getPathInfo(compilerPath);
                testlibIncludePath = await window.electronAPI.pathJoin(pathInfo.dirname, '..', 'include');
            }
            compilerArgs += ` -I"${testlibIncludePath}"`;
        }

        const timestamp = Date.now();
        const tempFileName = `sample_${timestamp}.cpp`;
        const tempFile = await window.electronAPI.saveTempFile(tempFileName, content);
        const isWin = (typeof window !== 'undefined' && window.process && window.process.platform === 'win32');
        const executableFile = tempFile.replace(/\.(cpp|cc|cxx|c)$/i, isWin ? '.exe' : '');

        try {
            const pathInfo = await window.electronAPI.getPathInfo(tempFile);
            const result = await window.electronAPI.compileFile({
                inputFile: tempFile,
                outputFile: executableFile,
                compilerPath: compilerPath,
                compilerArgs: compilerArgs + ' -g',
                workingDirectory: pathInfo.dirname
            });

            if (result.success) {
                result.executablePath = executableFile;
                if (window.editorManager && window.editorManager.clearDiagnostics) {
                    window.editorManager.clearDiagnostics();
                }
            }
            if (!result.success && result.diagnostics && window.editorManager && window.editorManager.applyDiagnostics) {
                window.editorManager.applyDiagnostics(result.diagnostics);
            }

            return result;
        } finally {
            try {
                await window.electronAPI.deleteTempFile(tempFile);
            } catch (e) {
            }
        }
    }

    async runProgram(executablePath, input, timeLimit) {
        const execOptions = typeof executablePath === 'object'
            ? { ...executablePath, skipPreKill: true }
            : { executablePath, skipPreKill: true };
        return await window.electronAPI.runProgram(execOptions, input, timeLimit);
    }

    compareOutput(actual, expected) {
        const normalize = (str) => {
            return str.split('\n')
                .map(line => line.trimEnd())
                .join('\n')
                .replace(/\n+$/, '');
        };

        const normalizedActual = normalize(actual || '');
        const normalizedExpected = normalize(expected || '');

        return normalizedActual === normalizedExpected ? 'AC' : 'WA';
    }

    truncateOutput(output) {
        if (!output) return '';
        if (output.length > 1000) {
            return output.substring(0, 1000) + '\n... [输出过长，已截断]';
        }
        return output;
    }

    processOutputForDisplay(output, result, sampleId) {
        const lines = output.split('\n');
        const maxLines = 100;

        if (lines.length > maxLines) {
            const truncatedOutput = lines.slice(0, maxLines).join('\n');
            return truncatedOutput + '\n[输出过大，已省略]';
        }
        return output;
    }

    getDifferenceInfo(actual, expected) {
        const actualLines = actual.split('\n');
        const expectedLines = expected.split('\n');

        const maxCompareLines = Math.max(actualLines.length, expectedLines.length);

        for (let i = 0; i < maxCompareLines; i++) {
            const actualLine = actualLines[i] || '';
            const expectedLine = expectedLines[i] || '';
            if (actualLine.trimEnd() !== expectedLine.trimEnd()) {
                let diffChar = 0;
                const minLength = Math.min(actualLine.length, expectedLine.length);
                while (diffChar < minLength && actualLine[diffChar] === expectedLine[diffChar]) {
                    diffChar++;
                }
                return {
                    line: i + 1,
                    char: diffChar + 1
                };
            }
        }

        return null;
    }

    getDifferenceInfo(actual, expected) {
        const actualLines = actual.split('\n');
        const expectedLines = expected.split('\n');

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

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    createHighlightedOutput(actual, expected) {
        const actualLines = actual.split('\n');
        const expectedLines = expected.split('\n');
        const maxLines = 100;

        let result = '';
        const maxCompareLines = Math.max(actualLines.length, expectedLines.length);
        const displayLines = Math.min(maxLines, actualLines.length);

        for (let i = 0; i < displayLines; i++) {
            const actualLine = actualLines[i] || '';
            const expectedLine = expectedLines[i] || '';

            if (i < expectedLines.length && actualLine.trimEnd() !== expectedLine.trimEnd()) {
                let diffChar = 0;
                const minLength = Math.min(actualLine.length, expectedLine.length);
                while (diffChar < minLength && actualLine[diffChar] === expectedLine[diffChar]) {
                    diffChar++;
                }

                const beforeDiff = this.escapeHtml(actualLine.substring(0, diffChar));
                const diffCharacter = actualLine.length > diffChar ? this.escapeHtml(actualLine.substring(diffChar, diffChar + 1)) : '';
                const afterDiff = actualLine.length > diffChar + 1 ? this.escapeHtml(actualLine.substring(diffChar + 1)) : '';

                if (diffCharacter) {
                    result += beforeDiff + `<span class="diff-highlight">${diffCharacter}</span>` + afterDiff;
                } else {
                    const icon = (window.uiIcons && typeof window.uiIcons.svg === 'function') ? window.uiIcons.svg('emptyBox') : '';
                    result += beforeDiff + `<span class="diff-highlight">${icon}</span>`;
                }
            } else {
                result += this.escapeHtml(actualLine);
            }

            if (i < displayLines - 1) {
                result += '\n';
            }
        }

        if (actualLines.length > maxLines) {
            result += '\n[输出过大，已省略]';
        }

        return result;
    }

    updateSampleResult(id, result, sample = null) {
        const element = document.querySelector(`[data-sample-id="${id}"]`);
        if (!element) return;

        const statusContainer = element.querySelector('.sample-status');
        let statusBadge = `<span class="status-badge status-${result.status.toLowerCase()}">${result.status}</span>`;

        if (result.time !== undefined) {
            statusBadge += `<span style="color: #858585; font-size: 11px; margin-left: 8px;">${result.time}ms</span>`;
        }

        statusContainer.innerHTML = statusBadge;

        const outputContainer = element.querySelector('.program-output-container');
        const outputTextarea = element.querySelector('.program-output');
        const diffInfo = element.querySelector('.diff-info');

        if (outputTextarea && outputContainer) {
            const processedOutput = this.processOutputForDisplay(result.output || '', result, id);

            const usedSpj = result.usedSpj || false;

            if (result.status === 'WA' && !usedSpj) {
                if (!sample) {
                    sample = this.samples.find(s => s.id === id);
                }
                if (sample) {
                    let expectedOutput = '';
                    if (sample.outputType === 'file') {
                        expectedOutput = sample.output || '';
                    } else {
                        expectedOutput = sample.output || '';
                    }

                    const diffPosition = this.getDifferenceInfo(result.output || '', expectedOutput);
                    if (diffPosition && diffInfo) {
                        diffInfo.textContent = `(第 ${diffPosition.line} 行第 ${diffPosition.char} 字符有差异)`;
                        diffInfo.style.display = 'inline';
                    }

                    const highlightedOutput = this.createHighlightedOutput(result.output || '', expectedOutput);

                    outputTextarea.style.display = 'none';

                    let highlightDiv = outputContainer.querySelector('.highlighted-output');
                    if (!highlightDiv) {
                        highlightDiv = document.createElement('div');
                        highlightDiv.className = 'highlighted-output';
                        outputContainer.appendChild(highlightDiv);
                    }
                    highlightDiv.innerHTML = highlightedOutput;
                    highlightDiv.style.display = 'block';
                }
            } else {
                outputTextarea.value = processedOutput;
                outputTextarea.style.display = 'block';

                if (diffInfo) {
                    diffInfo.style.display = 'none';
                }

                const highlightDiv = outputContainer.querySelector('.highlighted-output');
                if (highlightDiv) {
                    highlightDiv.style.display = 'none';
                }

                this.autoResizeProgramOutput(outputTextarea);
            }
        }

        const outputControls = element.querySelector('.output-controls');
        if (outputControls) {
            outputControls.style.display = result.output ? 'flex' : 'none';
        }

        element.classList.remove('success', 'error');
        if (result.status === 'AC') {
            element.classList.add('success');
        } else {
            element.classList.add('error');
        }
    }

    async exportSampleOutput(sampleId) {
        try {
            const sample = this.samples.find(s => s.id === sampleId);
            if (!sample || !sample.result || !sample.result.output) {
                logWarn('没有可导出的输出数据');
                return;
            }

            const result = await window.electronAPI.showSaveDialog({
                title: '导出样例输出',
                defaultPath: `sample_${sampleId}_output.txt`,
                filters: [
                    { name: '文本文件', extensions: ['txt'] },
                    { name: '所有文件', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePath) {
                await window.electronAPI.saveFile(result.filePath, sample.result.output);

                const statusContainer = document.querySelector(`[data-sample-id="${sampleId}"] .sample-status`);
                if (statusContainer) {
                    const originalContent = statusContainer.innerHTML;
                    statusContainer.innerHTML = '<span style="color: #4CAF50; font-size: 11px;">已导出</span>';
                    setTimeout(() => {
                        statusContainer.innerHTML = originalContent;
                    }, 2000);
                }
            }
        } catch (error) {
            logError('导出样例输出失败:', error);
        }
    }

    async autoSaveCurrentFile() {
        try {
            const currentEditor = window.editorManager?.getCurrentEditor();
            if (!currentEditor) {
                logInfo('[样例测试器-自动保存] 没有当前编辑器');
                return;
            }

            const filePath = currentEditor.filePath || (currentEditor.getFilePath && currentEditor.getFilePath());
            if (!filePath || filePath.startsWith('untitled')) {
                logInfo('[样例测试器-自动保存] 文件未保存或为临时文件，跳过自动保存');
                return;
            }

            const content = currentEditor.getValue();
            if (content === null || content === undefined) {
                logInfo('[样例测试器-自动保存] 无法获取文件内容');
                return;
            }

            if (window.tabManager) {
                const fileName = filePath.split(/[\\/]/).pop();
                const tab = window.tabManager.getTabByFileName && window.tabManager.getTabByFileName(fileName);
                if (tab && !tab.modified) {
                    logInfo('[样例测试器-自动保存] 文件未修改，跳过保存');
                    return;
                }
            }

            logInfo('[样例测试器-自动保存] 开始保存文件:', filePath);

            if (window.electronAPI && window.electronAPI.saveFile) {
                await window.electronAPI.saveFile(filePath, content);
                logInfo('[样例测试器-自动保存] 文件保存成功');

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
                logWarn('[样例测试器-自动保存] electronAPI 不可用');
            }
        } catch (error) {
            logError('[样例测试器-自动保存] 保存文件失败:', error);
        }
    }

    async compileSpjFile(spjPath) {
        if (!spjPath) {
            throw new Error('SPJ文件路径为空');
        }

        let spjContent;
        try {
            spjContent = await window.electronAPI.readFileContent(spjPath);
        } catch (error) {
            throw new Error(`无法读取SPJ文件: ${error.message}`);
        }

        if (!spjContent.trim()) {
            throw new Error('SPJ文件内容为空');
        }

        const settings = await window.electronAPI.getAllSettings();
        const compilerPath = settings.compilerPath;
        let compilerArgs = settings.compilerArgs || '-std=c++14 -O2';

        if (!compilerPath) {
            throw new Error('请先设置编译器路径');
        }

        if (settings.testlibPath) {
            const testlibPathInfo = await window.electronAPI.getPathInfo(settings.testlibPath);
            const testlibIncludePath = testlibPathInfo.dirname;
            compilerArgs += ` -I"${testlibIncludePath}"`;
        } else {
            const pathInfo = await window.electronAPI.getPathInfo(compilerPath);
            const testlibIncludePath = await window.electronAPI.pathJoin(pathInfo.dirname, '..', 'include');
            compilerArgs += ` -I"${testlibIncludePath}"`;
        }



        const timestamp = Date.now();
        const tempFileName = `spj_${timestamp}.cpp`;
        const tempFile = await window.electronAPI.saveTempFile(tempFileName, spjContent);
        const isWin2 = (typeof window !== 'undefined' && window.process && window.process.platform === 'win32');
        const executableFile = tempFile.replace(/\.(cpp|cc|cxx|c)$/i, isWin2 ? '.exe' : '');

        try {
            const pathInfo = await window.electronAPI.getPathInfo(tempFile);
            const result = await window.electronAPI.compileFile({
                inputFile: tempFile,
                outputFile: executableFile,
                compilerPath: compilerPath,
                compilerArgs: compilerArgs + ' -g',
                workingDirectory: pathInfo.dirname
            });

            if (result.success) {
                result.executablePath = executableFile;
            }

            return result;
        } finally {
            try {
                await window.electronAPI.deleteTempFile(tempFile);
            } catch (e) {
            }
        }
    }

    async judgeWithSpj(spjExecutablePath, inputData, actualOutput, expectedOutput) {
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
                    timeLimit: 5000,
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
            logError('SPJ判题失败:', error);
            return 'Error';
        }
    }

    updateGlobalSettingsUI() {
        const globalUseTestlib = document.getElementById('global-use-testlib');
        const globalSpjPath = document.getElementById('global-spj-path');

        if (globalUseTestlib) {
            globalUseTestlib.checked = this.globalSettings.useTestlib;
        }
        if (globalSpjPath) {
            globalSpjPath.value = this.globalSettings.spjPath || '';
            this.updateSpjFileDisplay(this.globalSettings.spjPath || '');
        }
    }

    updateGlobalSetting(setting, value) {
        logInfo('[样例测试器] 更新全局设置:', setting, '=', value);
        this.globalSettings[setting] = value;
        logInfo('[样例测试器] 更新后的全局设置:', this.globalSettings);
        this.saveGlobalSettings();
    }

    async selectGlobalSpjFile() {
        try {
            const result = await window.electronAPI.showOpenDialog({
                title: '选择SPJ代码文件',
                filters: [
                    { name: 'C++ Files', extensions: ['cpp', 'cc', 'cxx'] },
                    { name: 'All Files', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                const spjPath = result.filePaths[0];
                this.globalSettings.spjPath = spjPath;
                document.getElementById('global-spj-path').value = spjPath;
                this.updateSpjFileDisplay(spjPath);
                this.saveGlobalSettings();
            }
        } catch (error) {
            logError('选择SPJ文件失败:', error);
        }
    }

    clearGlobalSpjFile() {
        this.globalSettings.spjPath = '';
        document.getElementById('global-spj-path').value = '';
        this.updateSpjFileDisplay('');
        this.saveGlobalSettings();
    }

    updateSpjFileDisplay(spjPath) {
        const spjFileDisplay = document.getElementById('spj-file-display');
        const spjFileName = document.getElementById('spj-file-name');

        if (spjPath) {
            const fileName = spjPath.split(/[\\\/]/).pop();
            spjFileName.textContent = fileName;
            spjFileName.title = spjPath;
            spjFileDisplay.style.display = 'flex';
        } else {
            spjFileDisplay.style.display = 'none';
        }
    }

    saveGlobalSettings() {
        if (this.currentFile && this.samplesFilePath) {
            this.saveSamples();
        }
    }

    loadGlobalSettings(data) {
        if (data && data.globalSettings) {
            this.globalSettings = { ...this.globalSettings, ...data.globalSettings };
        } else {
            this.globalSettings = {
                useTestlib: false,
                spjPath: ''
            };
        }
    }
}

if (typeof window !== 'undefined') {
    window.SampleTester = SampleTester;
}