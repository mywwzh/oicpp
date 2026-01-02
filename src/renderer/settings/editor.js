class EditorSettings {
    constructor() {
        this.settings = {
            font: 'Consolas, "Courier New", monospace',
            fontSize: 14,
            theme: 'dark',
            tabSize: 4,
            wordWrap: false,
            foldingEnabled: true,
            stickyScrollEnabled: true,
            fontLigaturesEnabled: true,
            enableAutoCompletion: true,
            bracketMatching: true,
            highlightCurrentLine: true,
            autoSave: true,
            autoSaveInterval: 60000,
            markdownMode: 'split',
            keybindings: this.getDefaultKeybindings()
        };

        this._initialLoadedSettings = null;
        this._saved = false;

        this.keybindingSchema = this.getKeybindingSchema();
    }

    getDefaultKeybindings() {
        return {
            formatCode: 'Alt+Shift+S',
            showFunctionPicker: 'Ctrl+Shift+G',
            markdownPreview: 'Ctrl+Shift+V',
            renameSymbol: 'F2',
            deleteLine: 'Ctrl+D',
            duplicateLine: 'Ctrl+E',
            moveLineUp: 'Ctrl+Shift+Up',
            moveLineDown: 'Ctrl+Shift+Down',
            copy: 'Ctrl+C',
            paste: 'Ctrl+V',
            cut: 'Ctrl+X',
            compileCode: 'F9',
            runCode: 'F10',
            compileAndRun: 'F11',
            toggleDebug: 'F5',
            debugContinue: 'F6',
            debugStepOver: 'F7',
            debugStepInto: 'F8',
            debugStepOut: 'Shift+F8',
            cloudCompile: 'F12'
        };
    }

    getKeybindingSchema() {
        return [
            { key: 'formatCode', label: '格式化代码' },
            { key: 'showFunctionPicker', label: '跳转符号选择器' },
            { key: 'markdownPreview', label: 'Markdown 预览' },
            { key: 'renameSymbol', label: '重命名符号' },
            { key: 'deleteLine', label: '删除行' },
            { key: 'duplicateLine', label: '复制行' },
            { key: 'moveLineUp', label: '上移行' },
            { key: 'moveLineDown', label: '下移行' },
            { key: 'copy', label: '复制' },
            { key: 'paste', label: '粘贴' },
            { key: 'cut', label: '剪切' },
            { key: 'compileCode', label: '编译当前文件' },
            { key: 'runCode', label: '运行当前文件' },
            { key: 'compileAndRun', label: '编译并运行' },
            { key: 'toggleDebug', label: '启动/继续调试' },
            { key: 'debugContinue', label: '调试继续 (继续/暂停)' },
            { key: 'debugStepOver', label: '单步跳过' },
            { key: 'debugStepInto', label: '单步进入' },
            { key: 'debugStepOut', label: '单步跳出' },
            { key: 'cloudCompile', label: '云端编译' }
        ];
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        const themeFromUrl = urlParams.get('theme');
        if (themeFromUrl) {
            this.applyTheme(themeFromUrl);
            this.settings.theme = themeFromUrl;
        }

        await this.loadSettings();

        // 记录进入页面时的设置快照，用于取消/关闭时回滚实时预览
        try {
            this._initialLoadedSettings = JSON.parse(JSON.stringify(this.settings));
        } catch (_) {
            this._initialLoadedSettings = { ...this.settings };
        }

        this.renderKeybindingsUI();

        await this.loadSystemFonts();

        this.setupEventListeners();
        
        this.setupSidebarNavigation();

        this.setupThemeListener();

        this.applyTheme(this.settings.theme);

        this.updateUI();

        logInfo('EditorSettings 初始化完成');
    }

    setupSidebarNavigation() {
        const sidebarItems = document.querySelectorAll('.sidebar-item');
        const sections = document.querySelectorAll('.settings-section');

        sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                sections.forEach(section => section.classList.remove('active'));
                
                const targetId = item.getAttribute('data-target');
                const targetSection = document.getElementById(targetId);
                if (targetSection) {
                    targetSection.classList.add('active');
                }
            });
        });
    }

    setupEventListeners() {
        const saveBtn = document.getElementById('save-settings');
        logInfo('保存按钮元素:', saveBtn);
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                logInfo('保存按钮被点击');
                this.saveSettings();
            });
        } else {
            logError('找不到保存按钮元素 #save-settings');
        }
        window.addEventListener('beforeunload', () => {
            this.revertPreviewToLoadedSettings();
        });

        document.getElementById('cancel-settings').addEventListener('click', () => {
            this.cancelAndClose();
        });

        const resetBtn = document.getElementById('reset-settings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetSettings();
            });
        }

        const resetKeybindingBtn = document.getElementById('reset-keybindings');
        if (resetKeybindingBtn) {
            resetKeybindingBtn.addEventListener('click', () => {
                this.resetKeybindingsToDefault();
            });
        }

        const closeFontDialogBtn = document.getElementById('close-font-dialog');
        if (closeFontDialogBtn) {
            closeFontDialogBtn.addEventListener('click', () => {
                this.closeFontDialog();
            });
        }

        this.setupRealTimePreview();

        const autoSaveCheckbox = document.getElementById('editor-auto-save-enabled');
        const autoSaveIntervalInput = document.getElementById('editor-auto-save-interval');
        if (autoSaveCheckbox && autoSaveIntervalInput) {
            autoSaveCheckbox.addEventListener('change', (e) => {
                this.toggleAutoSaveInterval(autoSaveIntervalInput, e.target.checked);
                this.notifyMainWindowPreview();
            });
            autoSaveIntervalInput.addEventListener('input', () => {
                this.notifyMainWindowPreview();
            });
        }

        const autoCompletionCheckbox = document.getElementById('editor-auto-completion');
        if (autoCompletionCheckbox) {
            autoCompletionCheckbox.addEventListener('change', () => {
                this.notifyMainWindowPreview();
            });
        }

        const tabSizeInput = document.getElementById('editor-tab-size');
        if (tabSizeInput) {
            tabSizeInput.addEventListener('input', () => {
                this.notifyMainWindowPreview();
            });
        }

        const opacityInput = document.getElementById('editor-opacity');
        const opacityValue = document.getElementById('editor-opacity-value');
        if (opacityInput && opacityValue) {
            opacityInput.addEventListener('input', (e) => {
                const val = parseFloat(e.target.value);
                opacityValue.textContent = Math.round(val * 100) + '%';
                // 实时预览透明度
                if (window.electronAPI && window.electronAPI.updateSettings) {
                    // 简单的防抖
                    clearTimeout(this.opacityTimeout);
                    this.opacityTimeout = setTimeout(() => {
                        window.electronAPI.updateSettings({ windowOpacity: val });
                    }, 100);
                }
            });
        }

        const browseBgBtn = document.getElementById('browse-bg-image');
        const bgImageInput = document.getElementById('editor-bg-image');
        if (browseBgBtn && bgImageInput) {
            browseBgBtn.addEventListener('click', async () => {
                if (window.electronAPI && window.electronAPI.showOpenDialog) {
                    const result = await window.electronAPI.showOpenDialog({
                        title: '选择背景图片',
                        filters: [
                            { name: 'Images', extensions: ['jpg', 'png', 'gif', 'jpeg', 'webp'] },
                            { name: 'All Files', extensions: ['*'] }
                        ],
                        properties: ['openFile']
                    });
                    
                    if (!result.canceled && result.filePaths.length > 0) {
                        bgImageInput.value = result.filePaths[0];
                    }
                }
            });
        }

        const clearBgBtn = document.getElementById('clear-bg-image');
        if (clearBgBtn && bgImageInput) {
            clearBgBtn.addEventListener('click', () => {
                bgImageInput.value = '';
            });
        }
    }

    toggleAutoSaveInterval(inputElement, enabled) {
        if (!inputElement) return;
        inputElement.disabled = !enabled;
    }

    setupThemeListener() {
        if (window.electronIPC && window.electronIPC.on) {
            window.electronIPC.on('theme-changed', (event, theme) => {
                logInfo('编辑器设置页面收到主题变更:', theme);
                this.settings.theme = theme;
                this.applyTheme(theme);
                this.updateUI();
            });
        }
    }

    applyTheme(theme) {
        logInfo('应用主题到编辑器设置页面:', theme);

        document.body.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
    }

    setupRealTimePreview() {
        const fontSizeInput = document.getElementById('editor-font-size');
        logInfo('字体大小输入框元素:', fontSizeInput);
        if (fontSizeInput) {
            fontSizeInput.addEventListener('input', (e) => {
                const newFontSize = parseInt(e.target.value);
                logInfo('字体大小输入变化:', { oldValue: this.settings.fontSize, newValue: newFontSize });
                this.updatePreview();
                this.notifyMainWindowPreview();
            });
        } else {
            logError('未找到字体大小输入框元素');
        }

        const fontSelect = document.getElementById('editor-font');
        if (fontSelect) {
            fontSelect.addEventListener('change', (e) => {
                logInfo('字体选择变化:', { oldValue: this.settings.font, newValue: e.target.value });
                this.updatePreview();
                this.notifyMainWindowPreview();
            });
        }


    }

    normalizeKeybindings(raw) {
        const defaults = this.getDefaultKeybindings();
        const normalized = { ...defaults };
        if (raw && typeof raw === 'object') {
            Object.keys(defaults).forEach((key) => {
                const val = raw[key];
                if (typeof val === 'string' && val.trim()) {
                    normalized[key] = val.trim();
                }
            });
        }
        return normalized;
    }

    renderKeybindingsUI() {
        const container = document.getElementById('keybindings-list');
        if (!container) return;
        const defaults = this.getDefaultKeybindings();
        const current = this.normalizeKeybindings(this.settings.keybindings);
        container.innerHTML = '';

        this.keybindingSchema.forEach((item) => {
            const row = document.createElement('div');
            row.className = 'keybinding-row';

            const label = document.createElement('div');
            label.className = 'keybinding-label';
            label.textContent = item.label;

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'keybinding-input';
            input.value = current[item.key] || defaults[item.key];
            input.dataset.keybindingKey = item.key;
            input.placeholder = defaults[item.key];

            const reset = document.createElement('button');
            reset.className = 'btn btn-secondary keybinding-reset';
            reset.textContent = '恢复默认';
            reset.addEventListener('click', () => {
                input.value = defaults[item.key];
            });

            row.appendChild(label);
            row.appendChild(input);
            row.appendChild(reset);
            container.appendChild(row);
        });
    }

    resetKeybindingsToDefault() {
        this.settings.keybindings = this.getDefaultKeybindings();
        this.renderKeybindingsUI();
        this.updateUI();
    }

    updatePreview() {
        const currentSettings = this.collectSettings();
        const preview = document.querySelector('.settings-preview');
        if (preview) {
            preview.style.fontFamily = currentSettings.font;
            preview.style.fontSize = currentSettings.fontSize + 'px';
        }

        const codeExamples = document.querySelectorAll('.code-example, pre, code');
        codeExamples.forEach(element => {
            element.style.fontFamily = currentSettings.font;
            element.style.fontSize = currentSettings.fontSize + 'px';
        });
    }

    notifyMainWindowPreview() {
        try {
            const previewSettings = this.collectSettings();
            logInfo('实时预览设置变更:', previewSettings);

            clearTimeout(this.previewTimeout);
            this.previewTimeout = setTimeout(() => {
                if (window.electronAPI && window.electronAPI.sendSettingsPreview) {
                    logInfo('通过IPC发送预览设置到主进程');
                    window.electronAPI.sendSettingsPreview(previewSettings);
                } else {
                    logWarn('预览API (electronAPI.sendSettingsPreview) 不可用');
                }
            }, 150);

        } catch (error) {
            logWarn('实时预览通知失败:', error);
        }
    }

    revertPreviewToLoadedSettings() {
        try {
            if (this._saved) return;
            if (!this._initialLoadedSettings) return;
            if (window.electronAPI && window.electronAPI.sendSettingsPreview) {
                clearTimeout(this.previewTimeout);
                window.electronAPI.sendSettingsPreview(this._initialLoadedSettings);
            }
        } catch (error) {
            logWarn('回滚预览设置失败:', error);
        }
    }

    cancelAndClose() {
        this.revertPreviewToLoadedSettings();
        this.closeWindow();
    }
    async loadSettings() {
        try {
            let allSettings = null;

            if (window.electronAPI && window.electronAPI.getAllSettings) {
                try {
                    allSettings = await window.electronAPI.getAllSettings();
                    logInfo('通过electronAPI加载设置成功:', allSettings);
                } catch (apiError) {
                    logError('electronAPI加载失败:', apiError);
                }
            }

            if (!allSettings && typeof require !== 'undefined') {
                try {
                    const { ipcRenderer } = require('electron');
                    allSettings = await ipcRenderer.invoke('get-all-settings');
                    logInfo('通过ipcRenderer加载设置成功:', allSettings);
                } catch (ipcError) {
                    logError('ipcRenderer加载失败:', ipcError);
                }
            }

            if (allSettings) {
                const rawMode = typeof allSettings.markdownMode === 'string' ? allSettings.markdownMode.trim().toLowerCase() : '';
                const markdownMode = ['code', 'wysiwyg', 'split'].includes(rawMode) ? rawMode : 'split';
                this.settings = {
                    font: allSettings.font || 'Consolas',
                    fontSize: allSettings.fontSize || 14,
                    theme: allSettings.theme || 'dark',
                    tabSize: allSettings.tabSize || 4,
                    fontLigaturesEnabled: allSettings.fontLigaturesEnabled !== false,
                    foldingEnabled: allSettings.foldingEnabled !== false,
                    stickyScrollEnabled: allSettings.stickyScrollEnabled !== false,
                    enableAutoCompletion: allSettings.enableAutoCompletion !== false,
                    autoSave: allSettings.autoSave !== false,
                    autoSaveInterval: typeof allSettings.autoSaveInterval === 'number' ? allSettings.autoSaveInterval : 60000,
                    windowOpacity: typeof allSettings.windowOpacity === 'number' ? allSettings.windowOpacity : 1.0,
                    backgroundImage: allSettings.backgroundImage || '',
                    markdownMode,
                    keybindings: this.normalizeKeybindings(allSettings.keybindings)
                };
                logInfo('编辑器设置加载完成:', this.settings);
            } else {
                logWarn('无法从主进程加载设置，使用默认设置');
                this.settings = {
                    font: 'Consolas',
                    fontSize: 14,
                    theme: 'dark',
                    tabSize: 4,
                    stickyScrollEnabled: true,
                    foldingEnabled: true,
                    enableAutoCompletion: true,
                    autoSave: true,
                    autoSaveInterval: 60000,
                    windowOpacity: 1.0,
                    backgroundImage: '',
                    markdownMode: 'split',
                    keybindings: this.getDefaultKeybindings()
                };
            }
        } catch (error) {
            logError('加载编辑器设置失败:', error);
            this.settings = {
                font: 'Consolas',
                fontSize: 14,
                theme: 'dark',
                tabSize: 4,
                stickyScrollEnabled: true,
                foldingEnabled: true,
                enableAutoCompletion: true,
                autoSave: true,
                autoSaveInterval: 60000,
                windowOpacity: 1.0,
                backgroundImage: '',
                markdownMode: 'split',
                keybindings: this.getDefaultKeybindings()
            };
        }
    }

    async loadSystemFonts() {
        logInfo('开始加载系统字体');

        const fontSelect = document.getElementById('editor-font');
        if (!fontSelect) {
            logError('找不到字体选择器元素');
            return;
        }

        fontSelect.innerHTML = '<option value="">正在加载字体...</option>';

        let availableFonts = [];
        if (window.fontDetector) {
            try {
                if (typeof window.fontDetector.getAllAvailableFonts === 'function') {
                    availableFonts = await window.fontDetector.getAllAvailableFonts();
                    logInfo('通过异步方法检测到的系统字体:', availableFonts.length, '个');
                }

                if (availableFonts.length === 0 && typeof window.fontDetector.getAllAvailableFontsSync === 'function') {
                    availableFonts = window.fontDetector.getAllAvailableFontsSync();
                    logInfo('通过同步方法检测到的系统字体:', availableFonts.length, '个');
                }
            } catch (error) {
                logWarn('字体检测失败，使用默认字体列表:', error);
                availableFonts = this.getDefaultFontList();
            }
        } else {
            logWarn('字体检测器不可用，使用默认字体列表');
            availableFonts = this.getDefaultFontList();
        }

        fontSelect.innerHTML = '';

        availableFonts.forEach(font => {
            const option = document.createElement('option');
            option.value = font;
            option.textContent = font;

            option.style.fontFamily = `"${font}", monospace`;

            fontSelect.appendChild(option);
        });

        logInfo(`已加载 ${availableFonts.length} 个字体到选择器`);
    }

    getDefaultFontList() {
        return [
            'Consolas',
            'Monaco',
            'Menlo',
            'Fira Code',
            'Source Code Pro',
            'JetBrains Mono',
            'Cascadia Code',
            'Ubuntu Mono',
            'Roboto Mono',
            'Inconsolata',
            'Courier New',
            'Lucida Console',
            'DejaVu Sans Mono',
            'Arial',
            'Helvetica',
            'Times New Roman',
            'Georgia',
            'Verdana',
            'Microsoft YaHei',
            'SimSun',
            'monospace'
        ];
    }

    closeFontDialog() {
        const dialog = document.getElementById('font-download-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    collectSettings() {
        const fontSelect = document.getElementById('editor-font');
        const themeSelect = document.getElementById('editor-theme');
        const fontSizeInput = document.getElementById('editor-font-size');

        const newSettings = {};

        if (fontSelect) newSettings.font = fontSelect.value;
        if (themeSelect) newSettings.theme = themeSelect.value;
        if (fontSizeInput) newSettings.fontSize = parseInt(fontSizeInput.value);
        const foldingCheckbox = document.getElementById('editor-folding');
        if (foldingCheckbox) newSettings.foldingEnabled = !!foldingCheckbox.checked;
        const stickyScrollCheckbox = document.getElementById('editor-sticky-scroll');
        if (stickyScrollCheckbox) newSettings.stickyScrollEnabled = !!stickyScrollCheckbox.checked;
        const markdownModeSelect = document.getElementById('markdown-mode');
        if (markdownModeSelect) newSettings.markdownMode = markdownModeSelect.value;
        const ligaturesCheckbox = document.getElementById('editor-font-ligatures');
        if (ligaturesCheckbox) newSettings.fontLigaturesEnabled = !!ligaturesCheckbox.checked;
        const tabSizeInput = document.getElementById('editor-tab-size');
        if (tabSizeInput) {
            const parsedTabSize = parseInt(tabSizeInput.value, 10);
            if (!Number.isNaN(parsedTabSize) && parsedTabSize > 0) {
                newSettings.tabSize = parsedTabSize;
            }
        }

        const autoCompletionCheckbox = document.getElementById('editor-auto-completion');
        if (autoCompletionCheckbox) {
            newSettings.enableAutoCompletion = !!autoCompletionCheckbox.checked;
        }

        const autoSaveCheckbox = document.getElementById('editor-auto-save-enabled');
        if (autoSaveCheckbox) {
            newSettings.autoSave = !!autoSaveCheckbox.checked;
        }
        const autoSaveIntervalInput = document.getElementById('editor-auto-save-interval');
        if (autoSaveIntervalInput) {
            const parsedInterval = parseInt(autoSaveIntervalInput.value, 10);
            if (!Number.isNaN(parsedInterval) && parsedInterval > 0) {
                newSettings.autoSaveInterval = parsedInterval * 1000;
            }
        }

        const opacityInput = document.getElementById('editor-opacity');
        if (opacityInput) {
            newSettings.windowOpacity = parseFloat(opacityInput.value);
        }

        const bgImageInput = document.getElementById('editor-bg-image');
        if (bgImageInput) {
            newSettings.backgroundImage = bgImageInput.value;
        }

        const defaultKeybindings = this.getDefaultKeybindings();
        const keybindingInputs = document.querySelectorAll('[data-keybinding-key]');
        const keybindings = { ...defaultKeybindings };
        keybindingInputs.forEach((input) => {
            const key = input.dataset.keybindingKey;
            if (!key) return;
            const val = (input.value || '').trim();
            keybindings[key] = val || defaultKeybindings[key];
        });
        newSettings.keybindings = keybindings;

        logInfo('收集到的设置:', newSettings);
        logInfo('字体大小输入框值:', fontSizeInput ? fontSizeInput.value : '未找到输入框');

        return newSettings;
    }

    async saveSettings() {
        clearTimeout(this.previewTimeout);
        try {
            const newSettings = this.collectSettings();

            if (newSettings.font && window.fontDetector) {
                logInfo('开始验证字体:', newSettings.font);
                const validatedFont = window.fontDetector.validateFont(newSettings.font);
                if (validatedFont !== newSettings.font) {
                    logInfo('字体验证失败，从', newSettings.font, '切换到', validatedFont);
                    newSettings.font = validatedFont;
                }
            }

            logInfo('即将保存的设置:', newSettings);

            logInfo('API可用性检查:', {
                electronAPI: !!window.electronAPI,
                updateSettings: !!(window.electronAPI && window.electronAPI.updateSettings),
                requireAvailable: typeof require !== 'undefined'
            });

            let result = null;

            if (window.electronAPI && window.electronAPI.updateSettings) {
                try {
                    result = await window.electronAPI.updateSettings(newSettings);
                    logInfo('通过electronAPI保存设置结果:', result);
                } catch (apiError) {
                    logError('electronAPI保存失败:', apiError);
                }
            }

            if (!result && typeof require !== 'undefined') {
                try {
                    const { ipcRenderer } = require('electron');
                    result = await ipcRenderer.invoke('update-top-level-settings', newSettings);
                    logInfo('通过ipcRenderer保存设置结果:', result);
                } catch (ipcError) {
                    logError('ipcRenderer保存失败:', ipcError);
                }
            }

            if (result && result.success) {
                logInfo('编辑器设置保存成功');
                this._saved = true;
                try {
                    this._initialLoadedSettings = JSON.parse(JSON.stringify(newSettings));
                } catch (_) {
                    this._initialLoadedSettings = { ...newSettings };
                }

                const themeChanged = newSettings.theme && newSettings.theme !== this.settings.theme;
                const bgImageChanged = newSettings.backgroundImage !== undefined && newSettings.backgroundImage !== this.settings.backgroundImage;
                logInfo('主题变化检测:', { oldTheme: this.settings.theme, newTheme: newSettings.theme, changed: themeChanged });
                logInfo('背景图片变化检测:', { oldBgImage: this.settings.backgroundImage, newBgImage: newSettings.backgroundImage, changed: bgImageChanged });

                Object.assign(this.settings, newSettings);

                if (themeChanged || bgImageChanged) {
                    const msg = themeChanged ? '主题已更改，正在重启编辑器...' : '背景图片已更改，正在重启编辑器...';
                    this.showMessage(msg, 'info');
                    setTimeout(() => {
                        if (window.electronAPI && window.electronAPI.relaunchApp) {
                            window.electronAPI.relaunchApp();
                        } else {
                            window.location.reload();
                        }
                    }, 1000);
                    return; // 不执行后续的关闭窗口操作
                }

                this.showMessage('编辑器设置保存成功！', 'success');


                const fontChanged = newSettings.font || newSettings.fontSize;
                const delay = fontChanged ? 1500 : 1000;

                setTimeout(() => {
                    this.closeWindow();
                }, delay);
            } else {
                const errorMsg = result ? (result.error || '未知错误') : '设置 API 不可用';
                this.showMessage('保存设置失败：' + errorMsg, 'error');
                logError('保存设置失败，详细信息:', {
                    result,
                    electronAPI: !!window.electronAPI,
                    updateSettings: !!(window.electronAPI && window.electronAPI.updateSettings),
                    requireAvailable: typeof require !== 'undefined'
                });
            }

        } catch (error) {
            logError('保存编辑器设置失败:', error);
            this.showMessage('保存设置失败：' + error.message, 'error');
        }
    }

    async resetSettings() {
        try {
            if (window.electronAPI && window.electronAPI.resetSettings) {
                const result = await window.electronAPI.resetSettings();
                if (result.success) {
                    await this.loadSettings();
                    this.renderKeybindingsUI();
                    this.updateUI();
                    this.showMessage('编辑器设置已重置为默认值', 'success');
                } else {
                    this.showMessage('重置设置失败：' + (result.error || '未知错误'), 'error');
                }
            } else {
                this.showMessage('设置 API 不可用', 'error');
            }
        } catch (error) {
            logError('重置设置失败:', error);
            this.showMessage('重置设置失败：' + error.message, 'error');
        }
    }

    updateUI() {
        const fontSelect = document.getElementById('editor-font');
        const fontSizeInput = document.getElementById('editor-font-size');
        const themeSelect = document.getElementById('editor-theme');
        const foldingCheckbox = document.getElementById('editor-folding');
        const stickyScrollCheckbox = document.getElementById('editor-sticky-scroll');
        const ligaturesCheckbox = document.getElementById('editor-font-ligatures');
        const tabSizeInput = document.getElementById('editor-tab-size');
        const autoCompletionCheckbox = document.getElementById('editor-auto-completion');
        const autoSaveCheckbox = document.getElementById('editor-auto-save-enabled');
        const autoSaveIntervalInput = document.getElementById('editor-auto-save-interval');
        const opacityInput = document.getElementById('editor-opacity');
        const opacityValue = document.getElementById('editor-opacity-value');
        const bgImageInput = document.getElementById('editor-bg-image');

        logInfo('更新UI，当前设置:', this.settings);
        logInfo('字体大小输入框:', fontSizeInput, '值:', this.settings.fontSize);

        if (fontSelect && this.settings.font) {
            let fontValue = this.settings.font;
            if (fontValue.includes(',')) {
                fontValue = fontValue.split(',')[0].trim().replace(/["']/g, '');
            }
            const options = Array.from(fontSelect.options);
            const matchingOption = options.find(option => option.value === fontValue);
            if (matchingOption) {
                fontSelect.value = fontValue;
            } else {
                fontSelect.value = 'Consolas';
            }
            logInfo('字体设置已更新:', fontSelect.value);
        }

        if (fontSizeInput && this.settings.fontSize) {
            fontSizeInput.value = this.settings.fontSize;
            logInfo('字体大小已更新:', fontSizeInput.value);
        }

        if (themeSelect && this.settings.theme) {
            themeSelect.value = this.settings.theme;
            logInfo('主题设置已更新:', themeSelect.value);
        }
        if (foldingCheckbox) {
            foldingCheckbox.checked = this.settings.foldingEnabled !== false;
        }
        if (stickyScrollCheckbox) {
            stickyScrollCheckbox.checked = this.settings.stickyScrollEnabled !== false;
        }
        const markdownModeSelect = document.getElementById('markdown-mode');
        if (markdownModeSelect) {
            markdownModeSelect.value = this.settings.markdownMode || 'split';
        }
        if (ligaturesCheckbox) {
            ligaturesCheckbox.checked = this.settings.fontLigaturesEnabled !== false;
        }
        if (tabSizeInput) {
            const tabSize = Number.isFinite(this.settings.tabSize) ? this.settings.tabSize : 4;
            tabSizeInput.value = tabSize;
        }

        if (autoCompletionCheckbox) {
            autoCompletionCheckbox.checked = this.settings.enableAutoCompletion !== false;
        }

        const autoSaveEnabled = this.settings.autoSave !== false;
        if (autoSaveCheckbox) {
            autoSaveCheckbox.checked = autoSaveEnabled;
        }
        if (autoSaveIntervalInput) {
            const intervalMs = Number.isFinite(this.settings.autoSaveInterval) && this.settings.autoSaveInterval > 0 ? this.settings.autoSaveInterval : 60000;
            autoSaveIntervalInput.value = Math.max(1, Math.round(intervalMs / 1000));
            this.toggleAutoSaveInterval(autoSaveIntervalInput, autoSaveEnabled);
        }

        if (opacityInput && opacityValue) {
            const opacity = typeof this.settings.windowOpacity === 'number' ? this.settings.windowOpacity : 1.0;
            opacityInput.value = opacity;
            opacityValue.textContent = Math.round(opacity * 100) + '%';
        }

        if (bgImageInput) {
            bgImageInput.value = this.settings.backgroundImage || '';
        }

        const normalizedKeybindings = this.normalizeKeybindings(this.settings.keybindings);
        const defaultKeybindings = this.getDefaultKeybindings();
        const keybindingInputs = document.querySelectorAll('[data-keybinding-key]');
        keybindingInputs.forEach((input) => {
            const key = input.dataset.keybindingKey;
            if (!key) return;
            input.value = normalizedKeybindings[key] || defaultKeybindings[key] || '';
        });
    }

    showMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-toast ${type}`;
        messageDiv.textContent = message;
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-weight: bold;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.3s;
        `;

        switch (type) {
            case 'success':
                messageDiv.style.backgroundColor = '#4CAF50';
                break;
            case 'error':
                messageDiv.style.backgroundColor = '#f44336';
                break;
            default:
                messageDiv.style.backgroundColor = '#2196F3';
        }

        try {
            if (type === 'error') {
                const errObj = message instanceof Error ? message : new Error(String(message));
                logError('[EditorSettingsToastError]', { message: String(message), stack: errObj.stack });
            }
        } catch (_) { }
        document.body.appendChild(messageDiv);

        requestAnimationFrame(() => {
            messageDiv.style.opacity = '1';
        });

        setTimeout(() => {
            messageDiv.style.opacity = '0';
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 300);
        }, 3000);
    }

    closeWindow() {
        window.close();
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    const editorSettings = new EditorSettings();
    await editorSettings.init();
});
