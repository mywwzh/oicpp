class EditorSettings {
    constructor() {
        this.settings = {
            font: 'Consolas, "Courier New", monospace',
            fontSize: 14,
            lineHeight: 0,
            theme: 'dark',
            syntaxColorsByTheme: {},
            syntaxFontStyles: {},
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
            autoOpenLastWorkspace: true,
            glassEffectEnabled: false,
            markdownMode: 'split',
            keybindings: this.getDefaultKeybindings()
        };

        this._initialLoadedSettings = null;
        this._saved = false;

        this.keybindingSchema = this.getKeybindingSchema();
    }

    getDefaultKeybindings() {
        const isMacPlatform = (() => {
            try {
                const platform = String(window.process?.platform || navigator?.platform || '').toLowerCase();
                return platform.includes('darwin') || platform.includes('mac');
            } catch (_) {
                return false;
            }
        })();

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
            compileAndRun: isMacPlatform ? 'Ctrl+F11' : 'F11',
            toggleDebug: 'F5',
            debugContinue: 'F6',
            debugStepOver: 'F7',
            debugStepInto: 'F8',
            debugStepOut: 'Shift+F8',
            cloudCompile: 'F12',
            openTerminal: 'Ctrl+`'
        };
    }

    getEditableKeybindingKeys() {
        return [
            'formatCode',
            'showFunctionPicker',
            'markdownPreview',
            'renameSymbol',
            'deleteLine',
            'duplicateLine',
            'moveLineUp',
            'moveLineDown',
            'compileCode',
            'runCode',
            'compileAndRun',
            'toggleDebug',
            'debugContinue',
            'debugStepOver',
            'debugStepInto',
            'debugStepOut',
            'cloudCompile',
            'openTerminal'
        ];
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
            { key: 'compileCode', label: '编译当前文件' },
            { key: 'runCode', label: '运行当前文件' },
            { key: 'compileAndRun', label: '编译并运行' },
            { key: 'toggleDebug', label: '启动/继续调试' },
            { key: 'debugContinue', label: '调试继续 (继续/暂停)' },
            { key: 'debugStepOver', label: '单步跳过' },
            { key: 'debugStepInto', label: '单步进入' },
            { key: 'debugStepOut', label: '单步跳出' },
            { key: 'cloudCompile', label: '云端编译' },
            { key: 'openTerminal', label: '打开内置终端' }
        ];
    }

    normalizeThemeKey(theme) {
        const raw = (typeof theme === 'string' && theme.trim()) ? theme.trim() : 'dark';
        return raw;
    }

    getSyntaxTokenKeys() {
        return [
            'keyword',
            'string',
            'number',
            'type',
            'function',
            'class',
            'comment',
            'namespace',
            'preprocessor',
            'operator',
            'pointer',
            'localVariable',
            'globalVariable'
        ];
    }

    getDefaultSyntaxColors(theme = 'dark') {
        const themeKey = this.normalizeThemeKey(theme);
        const presets = {
            dark: {
                keyword: '#c586c0',
                string: '#ce9178',
                number: '#b5cea8',
                type: '#4ec9b0',
                function: '#dcdcaa',
                class: '#4ec9b0',
                comment: '#6a9955',
                namespace: '#4fc1ff',
                preprocessor: '#c586c0',
                operator: '#d4d4d4',
                pointer: '#d4d4d4',
                localVariable: '#9cdcfe',
                globalVariable: '#4fc1ff'
            },
            light: {
                keyword: '#0000ff',
                string: '#a31515',
                number: '#098658',
                type: '#267f99',
                function: '#795e26',
                class: '#267f99',
                comment: '#008000',
                namespace: '#0451a5',
                preprocessor: '#0000ff',
                operator: '#000000',
                pointer: '#001080',
                localVariable: '#001080',
                globalVariable: '#005cc5'
            },
            monokai: {
                keyword: '#f92672',
                string: '#e6db74',
                number: '#ae81ff',
                type: '#66d9ef',
                function: '#a6e22e',
                class: '#a6e22e',
                comment: '#75715e',
                namespace: '#66d9ef',
                preprocessor: '#f92672',
                operator: '#f8f8f2',
                pointer: '#fd971f',
                localVariable: '#f8f8f2',
                globalVariable: '#66d9ef'
            },
            'github-light': {
                keyword: '#d73a49',
                string: '#032f62',
                number: '#005cc5',
                type: '#6f42c1',
                function: '#6f42c1',
                class: '#6f42c1',
                comment: '#6a737d',
                namespace: '#005cc5',
                preprocessor: '#d73a49',
                operator: '#24292e',
                pointer: '#e36209',
                localVariable: '#24292e',
                globalVariable: '#005cc5'
            },
            'github-dark': {
                keyword: '#ff7b72',
                string: '#a5d6ff',
                number: '#79c0ff',
                type: '#d2a8ff',
                function: '#d2a8ff',
                class: '#d2a8ff',
                comment: '#6a737d',
                namespace: '#79c0ff',
                preprocessor: '#ff7b72',
                operator: '#e6edf3',
                pointer: '#ffa657',
                localVariable: '#c9d1d9',
                globalVariable: '#79c0ff'
            },
            'solarized-light': {
                keyword: '#859900',
                string: '#2aa198',
                number: '#d33682',
                type: '#b58900',
                function: '#b58900',
                class: '#b58900',
                comment: '#93a1a1',
                namespace: '#268bd2',
                preprocessor: '#859900',
                operator: '#586e75',
                pointer: '#cb4b16',
                localVariable: '#657b83',
                globalVariable: '#268bd2'
            },
            'solarized-dark': {
                keyword: '#859900',
                string: '#2aa198',
                number: '#d33682',
                type: '#b58900',
                function: '#b58900',
                class: '#b58900',
                comment: '#586e75',
                namespace: '#268bd2',
                preprocessor: '#859900',
                operator: '#93a1a1',
                pointer: '#cb4b16',
                localVariable: '#93a1a1',
                globalVariable: '#268bd2'
            },
            dracula: {
                keyword: '#ff79c6',
                string: '#f1fa8c',
                number: '#bd93f9',
                type: '#8be9fd',
                function: '#50fa7b',
                class: '#50fa7b',
                comment: '#6272a4',
                namespace: '#8be9fd',
                preprocessor: '#ff79c6',
                operator: '#f8f8f2',
                pointer: '#ffb86c',
                localVariable: '#f8f8f2',
                globalVariable: '#8be9fd'
            }
        };
        return { ...(presets[themeKey] || presets.dark) };
    }

    getDefaultSyntaxFontStyles() {
        const styles = {};
        this.getSyntaxTokenKeys().forEach((key) => {
            styles[key] = { bold: false, italic: false };
        });
        styles.comment.italic = true;
        return styles;
    }

    normalizeHexColor(color, fallback = '#c586c0') {
        if (typeof color !== 'string') {
            return fallback;
        }
        const trimmed = color.trim();
        if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
            return trimmed.toLowerCase();
        }
        return fallback;
    }

    normalizeSyntaxColors(raw, theme = 'dark') {
        const defaults = this.getDefaultSyntaxColors(theme);
        const normalized = { ...defaults };
        if (raw && typeof raw === 'object') {
            Object.keys(defaults).forEach((key) => {
                normalized[key] = this.normalizeHexColor(raw[key], defaults[key]);
            });
        }
        return normalized;
    }

    normalizeSyntaxFontStyles(raw) {
        const defaults = this.getDefaultSyntaxFontStyles();
        const normalized = JSON.parse(JSON.stringify(defaults));
        if (raw && typeof raw === 'object') {
            Object.keys(defaults).forEach((key) => {
                const style = raw[key];
                if (style && typeof style === 'object') {
                    normalized[key].bold = !!style.bold;
                    normalized[key].italic = !!style.italic;
                }
            });
        }
        return normalized;
    }

    normalizeSyntaxColorsByTheme(raw) {
        const normalized = {};
        if (!raw || typeof raw !== 'object') {
            return normalized;
        }
        Object.keys(raw).forEach((themeKey) => {
            if (!raw[themeKey] || typeof raw[themeKey] !== 'object') {
                return;
            }
            normalized[this.normalizeThemeKey(themeKey)] = this.normalizeSyntaxColors(raw[themeKey], themeKey);
        });
        return normalized;
    }

    areSyntaxColorsEqual(left, right) {
        const keys = this.getSyntaxTokenKeys();
        return keys.every((key) => left[key] === right[key]);
    }

    areSyntaxFontStylesEqual(left, right) {
        const keys = this.getSyntaxTokenKeys();
        return keys.every((key) => !!left[key]?.bold === !!right[key]?.bold && !!left[key]?.italic === !!right[key]?.italic);
    }

    getCurrentThemeFromUI() {
        const themeSelect = document.getElementById('editor-theme');
        return this.normalizeThemeKey(themeSelect?.value || this.settings.theme || 'dark');
    }

    getEffectiveSyntaxColors(theme = this.getCurrentThemeFromUI(), syntaxColorsByTheme = this.settings.syntaxColorsByTheme) {
        const themeKey = this.normalizeThemeKey(theme);
        const defaults = this.getDefaultSyntaxColors(themeKey);
        const byTheme = this.normalizeSyntaxColorsByTheme(syntaxColorsByTheme);
        if (byTheme[themeKey]) {
            return this.normalizeSyntaxColors(byTheme[themeKey], themeKey);
        }
        return defaults;
    }

    getEffectiveSyntaxStyles(syntaxStyles = this.settings.syntaxFontStyles) {
        const defaults = this.getDefaultSyntaxFontStyles();
        if (syntaxStyles && typeof syntaxStyles === 'object' && Object.keys(syntaxStyles).length > 0) {
            return this.normalizeSyntaxFontStyles(syntaxStyles);
        }
        return defaults;
    }

    setThemeSyntaxColorOverride(theme, colors, targetByTheme = null) {
        const themeKey = this.normalizeThemeKey(theme);
        const defaults = this.getDefaultSyntaxColors(themeKey);
        const normalizedColors = this.normalizeSyntaxColors(colors, themeKey);
        const byTheme = targetByTheme || this.settings.syntaxColorsByTheme || {};
        if (this.areSyntaxColorsEqual(normalizedColors, defaults)) {
            delete byTheme[themeKey];
        } else {
            byTheme[themeKey] = normalizedColors;
        }
        if (!targetByTheme) {
            this.settings.syntaxColorsByTheme = byTheme;
        }
        return byTheme;
    }

    setSyntaxStyleOverride(styles) {
        const defaults = this.getDefaultSyntaxFontStyles();
        const normalizedStyles = this.normalizeSyntaxFontStyles(styles);
        if (this.areSyntaxFontStylesEqual(normalizedStyles, defaults)) {
            this.settings.syntaxFontStyles = {};
        } else {
            this.settings.syntaxFontStyles = normalizedStyles;
        }
        return this.settings.syntaxFontStyles;
    }

    persistCurrentThemeSyntaxColors(theme = this.getCurrentThemeFromUI()) {
        const currentColors = this.getSyntaxColorsFromUI(theme);
        const currentStyles = this.getSyntaxStylesFromUI(theme);
        this.setThemeSyntaxColorOverride(theme, currentColors);
        this.setSyntaxStyleOverride(currentStyles);
    }

    updateSyntaxColorUI(colors, theme = this.getCurrentThemeFromUI()) {
        const normalized = this.normalizeSyntaxColors(colors, theme);
        const normalizedStyles = this.getEffectiveSyntaxStyles();
        Object.keys(normalized).forEach((key) => {
            const colorInput = document.getElementById(`syntax-color-${key}`);
            const textInput = document.getElementById(`syntax-color-${key}-text`);
            const boldInput = document.getElementById(`syntax-style-${key}-bold`);
            const italicInput = document.getElementById(`syntax-style-${key}-italic`);
            if (colorInput) {
                colorInput.value = normalized[key];
            }
            if (textInput) {
                textInput.value = normalized[key].toUpperCase();
            }
            if (boldInput) {
                boldInput.checked = !!normalizedStyles[key]?.bold;
            }
            if (italicInput) {
                italicInput.checked = !!normalizedStyles[key]?.italic;
            }
        });
        this.updateSyntaxPreview(normalized, theme, normalizedStyles);
    }

    getSyntaxColorsFromUI(theme = this.getCurrentThemeFromUI()) {
        const defaults = this.getDefaultSyntaxColors(theme);
        const result = { ...defaults };
        this.getSyntaxTokenKeys().forEach((key) => {
            const textInput = document.getElementById(`syntax-color-${key}-text`);
            const colorInput = document.getElementById(`syntax-color-${key}`);
            const raw = textInput?.value || colorInput?.value;
            result[key] = this.normalizeHexColor(raw, defaults[key]);
        });
        return result;
    }

    getSyntaxStylesFromUI() {
        const defaults = this.getDefaultSyntaxFontStyles();
        const result = JSON.parse(JSON.stringify(defaults));
        this.getSyntaxTokenKeys().forEach((key) => {
            const boldInput = document.getElementById(`syntax-style-${key}-bold`);
            const italicInput = document.getElementById(`syntax-style-${key}-italic`);
            if (boldInput) {
                result[key].bold = !!boldInput.checked;
            }
            if (italicInput) {
                result[key].italic = !!italicInput.checked;
            }
        });
        return this.normalizeSyntaxFontStyles(result);
    }

    updateSyntaxPreview(colors = null, theme = this.getCurrentThemeFromUI(), styles = null) {
        const preview = document.getElementById('syntax-color-preview');
        if (!preview) {
            return;
        }
        const normalized = this.normalizeSyntaxColors(colors || this.getSyntaxColorsFromUI(theme), theme);
        const normalizedStyles = this.normalizeSyntaxFontStyles(styles || this.getSyntaxStylesFromUI(theme));

        this.getSyntaxTokenKeys().forEach((key) => {
            preview.style.setProperty(`--syntax-${key}`, normalized[key]);
            preview.style.setProperty(`--syntax-${key}-weight`, normalizedStyles[key]?.bold ? '700' : '400');
            preview.style.setProperty(`--syntax-${key}-style`, normalizedStyles[key]?.italic ? 'italic' : 'normal');
        });

        const fontSelect = document.getElementById('editor-font');
        const fontSizeInput = document.getElementById('editor-font-size');
        if (fontSelect && fontSelect.value) {
            preview.style.fontFamily = fontSelect.value;
        }
        const parsedFontSize = parseInt(fontSizeInput?.value || '', 10);
        if (!Number.isNaN(parsedFontSize) && parsedFontSize > 0) {
            preview.style.fontSize = `${Math.max(10, parsedFontSize - 1)}px`;
        }
    }

    bindSyntaxColorControls() {
        const defaults = this.getDefaultSyntaxColors(this.getCurrentThemeFromUI());
        const bindColorPair = (key) => {
            const colorInput = document.getElementById(`syntax-color-${key}`);
            const textInput = document.getElementById(`syntax-color-${key}-text`);
            const boldInput = document.getElementById(`syntax-style-${key}-bold`);
            const italicInput = document.getElementById(`syntax-style-${key}-italic`);
            if (!colorInput || !textInput) {
                return;
            }

            colorInput.addEventListener('input', () => {
                const currentTheme = this.getCurrentThemeFromUI();
                const themeDefaults = this.getDefaultSyntaxColors(currentTheme);
                const normalized = this.normalizeHexColor(colorInput.value, themeDefaults[key]);
                textInput.value = normalized.toUpperCase();
                this.updateSyntaxPreview(null, currentTheme);
                this.notifyMainWindowPreview();
            });

            textInput.addEventListener('input', () => {
                const currentTheme = this.getCurrentThemeFromUI();
                const themeDefaults = this.getDefaultSyntaxColors(currentTheme);
                const normalized = this.normalizeHexColor(textInput.value, themeDefaults[key]);
                colorInput.value = normalized;
                textInput.value = normalized.toUpperCase();
                this.updateSyntaxPreview(null, currentTheme);
                this.notifyMainWindowPreview();
            });

            if (boldInput) {
                boldInput.addEventListener('change', () => {
                    const currentTheme = this.getCurrentThemeFromUI();
                    this.updateSyntaxPreview(null, currentTheme);
                    this.notifyMainWindowPreview();
                });
            }

            if (italicInput) {
                italicInput.addEventListener('change', () => {
                    const currentTheme = this.getCurrentThemeFromUI();
                    this.updateSyntaxPreview(null, currentTheme);
                    this.notifyMainWindowPreview();
                });
            }
        };

        Object.keys(defaults).forEach(bindColorPair);

        const resetBtn = document.getElementById('reset-syntax-colors');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                const currentTheme = this.getCurrentThemeFromUI();
                const byTheme = this.normalizeSyntaxColorsByTheme(this.settings.syntaxColorsByTheme);
                delete byTheme[currentTheme];
                this.settings.syntaxColorsByTheme = byTheme;
                this.settings.syntaxFontStyles = {};
                this.updateSyntaxColorUI(this.getDefaultSyntaxColors(currentTheme), currentTheme);
                this.notifyMainWindowPreview();
            });
        }
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
        this.bindSyntaxColorControls();

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

        const autoOpenLastWorkspaceCheckbox = document.getElementById('editor-auto-open-last-workspace');
        if (autoOpenLastWorkspaceCheckbox) {
            autoOpenLastWorkspaceCheckbox.addEventListener('change', () => {
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

        const glassEffectCheckbox = document.getElementById('editor-glass-effect-enabled');
        if (glassEffectCheckbox) {
            glassEffectCheckbox.addEventListener('change', () => {
                this.notifyMainWindowPreview();
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
                this.updateSyntaxPreview();
                this.notifyMainWindowPreview();
            });
        } else {
            logError('未找到字体大小输入框元素');
        }

        const lineHeightInput = document.getElementById('editor-line-height');
        if (lineHeightInput) {
            lineHeightInput.addEventListener('input', () => {
                this.updatePreview();
                this.notifyMainWindowPreview();
            });
        }

        const fontSelect = document.getElementById('editor-font');
        if (fontSelect) {
            fontSelect.addEventListener('change', (e) => {
                logInfo('字体选择变化:', { oldValue: this.settings.font, newValue: e.target.value });
                this.updatePreview();
                this.updateSyntaxPreview();
                this.notifyMainWindowPreview();
            });
        }

        const themeSelect = document.getElementById('editor-theme');
        if (themeSelect) {
            themeSelect.addEventListener('change', () => {
                const previousTheme = this.settings.theme || 'dark';
                this.persistCurrentThemeSyntaxColors(previousTheme);

                const nextTheme = this.normalizeThemeKey(themeSelect.value || 'dark');
                this.settings.theme = nextTheme;
                this.updateSyntaxColorUI(this.getEffectiveSyntaxColors(nextTheme), nextTheme);
                this.notifyMainWindowPreview();
            });
        }


    }

    normalizeKeybindings(raw) {
        const defaults = this.getDefaultKeybindings();
        const normalized = { ...defaults };
        const editableKeys = new Set(this.getEditableKeybindingKeys());
        if (raw && typeof raw === 'object') {
            Object.keys(defaults).forEach((key) => {
                if (!editableKeys.has(key)) {
                    return;
                }
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
            if (currentSettings.lineHeight && currentSettings.lineHeight > 0) {
                preview.style.lineHeight = currentSettings.lineHeight + 'px';
            } else {
                preview.style.lineHeight = '';
            }
        }

        const codeExamples = document.querySelectorAll('.code-example, pre, code');
        codeExamples.forEach(element => {
            element.style.fontFamily = currentSettings.font;
            element.style.fontSize = currentSettings.fontSize + 'px';
            if (currentSettings.lineHeight && currentSettings.lineHeight > 0) {
                element.style.lineHeight = currentSettings.lineHeight + 'px';
            } else {
                element.style.lineHeight = '';
            }
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
                const markdownMode = ['code', 'split'].includes(rawMode) ? rawMode : 'split';
                this.settings = {
                    font: allSettings.font || 'Consolas',
                    fontSize: allSettings.fontSize || 14,
                    lineHeight: typeof allSettings.lineHeight === 'number' && allSettings.lineHeight > 0 ? allSettings.lineHeight : 0,
                    theme: allSettings.theme || 'dark',
                    syntaxColorsByTheme: (() => {
                        const normalizedTheme = this.normalizeThemeKey(allSettings.theme || 'dark');
                        const byTheme = this.normalizeSyntaxColorsByTheme(allSettings.syntaxColorsByTheme);
                        if (Object.keys(byTheme).length === 0 && allSettings.syntaxColors && typeof allSettings.syntaxColors === 'object') {
                            const migrated = this.normalizeSyntaxColors(allSettings.syntaxColors, normalizedTheme);
                            if (!this.areSyntaxColorsEqual(migrated, this.getDefaultSyntaxColors(normalizedTheme))) {
                                byTheme[normalizedTheme] = migrated;
                            }
                        }
                        return byTheme;
                    })(),
                    syntaxFontStyles: (() => {
                        return this.normalizeSyntaxFontStyles(allSettings.syntaxFontStyles);
                    })(),
                    tabSize: allSettings.tabSize || 4,
                    fontLigaturesEnabled: allSettings.fontLigaturesEnabled !== false,
                    foldingEnabled: allSettings.foldingEnabled !== false,
                    stickyScrollEnabled: allSettings.stickyScrollEnabled !== false,
                    enableAutoCompletion: allSettings.enableAutoCompletion !== false,
                    autoSave: allSettings.autoSave !== false,
                    autoSaveInterval: typeof allSettings.autoSaveInterval === 'number' ? allSettings.autoSaveInterval : 60000,
                    autoOpenLastWorkspace: allSettings.autoOpenLastWorkspace !== false,
                    glassEffectEnabled: allSettings.glassEffectEnabled === true,
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
                    lineHeight: 0,
                    theme: 'dark',
                    syntaxColorsByTheme: {},
                    syntaxFontStyles: {},
                    tabSize: 4,
                    stickyScrollEnabled: true,
                    foldingEnabled: true,
                    enableAutoCompletion: true,
                    autoSave: true,
                    autoSaveInterval: 60000,
                    autoOpenLastWorkspace: true,
                    glassEffectEnabled: false,
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
                lineHeight: 0,
                theme: 'dark',
                syntaxColorsByTheme: {},
                syntaxFontStyles: {},
                tabSize: 4,
                stickyScrollEnabled: true,
                foldingEnabled: true,
                enableAutoCompletion: true,
                autoSave: true,
                autoSaveInterval: 60000,
                autoOpenLastWorkspace: true,
                glassEffectEnabled: false,
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
        const lineHeightInput = document.getElementById('editor-line-height');

        const newSettings = {};

        if (fontSelect) newSettings.font = fontSelect.value;
        if (themeSelect) newSettings.theme = themeSelect.value;
        if (fontSizeInput) newSettings.fontSize = parseInt(fontSizeInput.value);
        if (lineHeightInput) {
            const parsedLineHeight = parseInt(lineHeightInput.value, 10);
            newSettings.lineHeight = !Number.isNaN(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : 0;
        }
        const foldingCheckbox = document.getElementById('editor-folding');
        if (foldingCheckbox) newSettings.foldingEnabled = !!foldingCheckbox.checked;
        const stickyScrollCheckbox = document.getElementById('editor-sticky-scroll');
        if (stickyScrollCheckbox) newSettings.stickyScrollEnabled = !!stickyScrollCheckbox.checked;
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
        const autoOpenLastWorkspaceCheckbox = document.getElementById('editor-auto-open-last-workspace');
        if (autoOpenLastWorkspaceCheckbox) {
            newSettings.autoOpenLastWorkspace = !!autoOpenLastWorkspaceCheckbox.checked;
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

        const glassEffectCheckbox = document.getElementById('editor-glass-effect-enabled');
        if (glassEffectCheckbox) {
            newSettings.glassEffectEnabled = !!glassEffectCheckbox.checked;
        }

        const bgImageInput = document.getElementById('editor-bg-image');
        if (bgImageInput) {
            newSettings.backgroundImage = bgImageInput.value;
        }

        const currentTheme = this.normalizeThemeKey(newSettings.theme || this.settings.theme || 'dark');
        const syntaxColorsByTheme = this.normalizeSyntaxColorsByTheme(this.settings.syntaxColorsByTheme);
        const syntaxColors = this.getSyntaxColorsFromUI(currentTheme);
        const syntaxFontStyles = this.getSyntaxStylesFromUI();
        this.setThemeSyntaxColorOverride(currentTheme, syntaxColors, syntaxColorsByTheme);
        this.setSyntaxStyleOverride(syntaxFontStyles);
        newSettings.syntaxColorsByTheme = syntaxColorsByTheme;
        newSettings.syntaxFontStyles = this.normalizeSyntaxFontStyles(this.settings.syntaxFontStyles);

        const defaultKeybindings = this.getDefaultKeybindings();
        const editableKeys = new Set(this.getEditableKeybindingKeys());
        const keybindingInputs = document.querySelectorAll('[data-keybinding-key]');
        const keybindings = this.normalizeKeybindings(this.settings.keybindings);
        keybindingInputs.forEach((input) => {
            const key = input.dataset.keybindingKey;
            if (!key) return;
            if (!editableKeys.has(key)) return;
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
        const lineHeightInput = document.getElementById('editor-line-height');
        const themeSelect = document.getElementById('editor-theme');
        const foldingCheckbox = document.getElementById('editor-folding');
        const stickyScrollCheckbox = document.getElementById('editor-sticky-scroll');
        const ligaturesCheckbox = document.getElementById('editor-font-ligatures');
        const tabSizeInput = document.getElementById('editor-tab-size');
        const autoCompletionCheckbox = document.getElementById('editor-auto-completion');
        const autoSaveCheckbox = document.getElementById('editor-auto-save-enabled');
        const autoSaveIntervalInput = document.getElementById('editor-auto-save-interval');
        const autoOpenLastWorkspaceCheckbox = document.getElementById('editor-auto-open-last-workspace');
        const opacityInput = document.getElementById('editor-opacity');
        const opacityValue = document.getElementById('editor-opacity-value');
        const glassEffectCheckbox = document.getElementById('editor-glass-effect-enabled');
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

        if (lineHeightInput) {
            const lh = Number.isFinite(this.settings.lineHeight) ? this.settings.lineHeight : 0;
            lineHeightInput.value = lh > 0 ? lh : '';
        }

        if (themeSelect && this.settings.theme) {
            themeSelect.value = this.settings.theme;
            logInfo('主题设置已更新:', themeSelect.value);
        }
        const currentTheme = this.normalizeThemeKey(themeSelect?.value || this.settings.theme || 'dark');
        const effectiveSyntaxColors = this.getEffectiveSyntaxColors(currentTheme, this.settings.syntaxColorsByTheme);
        const effectiveSyntaxStyles = this.getEffectiveSyntaxStyles(this.settings.syntaxFontStyles);
        this.updateSyntaxColorUI(effectiveSyntaxColors, currentTheme);
        this.updateSyntaxPreview(effectiveSyntaxColors, currentTheme, effectiveSyntaxStyles);
        if (foldingCheckbox) {
            foldingCheckbox.checked = this.settings.foldingEnabled !== false;
        }
        if (stickyScrollCheckbox) {
            stickyScrollCheckbox.checked = this.settings.stickyScrollEnabled !== false;
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


        if (autoOpenLastWorkspaceCheckbox) {
            autoOpenLastWorkspaceCheckbox.checked = this.settings.autoOpenLastWorkspace !== false;
        }

        if (opacityInput && opacityValue) {
            const opacity = typeof this.settings.windowOpacity === 'number' ? this.settings.windowOpacity : 1.0;
            opacityInput.value = opacity;
            opacityValue.textContent = Math.round(opacity * 100) + '%';
        }

        if (glassEffectCheckbox) {
            glassEffectCheckbox.checked = this.settings.glassEffectEnabled === true;
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
