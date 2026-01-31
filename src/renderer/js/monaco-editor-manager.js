if (!self.MonacoEnvironment) {
    self.MonacoEnvironment = {
        getWorkerUrl: function (_moduleId, label) {
            const basePath = '../../node_modules/monaco-editor/min/vs';
            if (label === 'json') return `${basePath}/language/json/jsonWorker.js`;
            if (['css','scss','less'].includes(label)) return `${basePath}/language/css/cssWorker.js`;
            if (['html','handlebars','razor'].includes(label)) return `${basePath}/language/html/htmlWorker.js`;
            if (label === 'typescript' || label === 'javascript') return `${basePath}/language/typescript/tsWorker.js`;
            return `${basePath}/base/worker/workerMain.js`;
        }
    };
}

class MonacoEditorManager {
    constructor() {
        this.currentEditor = null;
        this.editors = new Map();
        this.isInitialized = false;
        this.currentFilePath = null;
        this.currentFileName = null;
        this.tabIdToFilePath = new Map();
        this.groupContainers = new Map();
        this.tabIdToGroupId = new Map();
        this.groupActiveTab = new Map();
        this.tabIdToContainer = new Map();
        this.diffEditors = new Map();
        this.markerOwner = 'oicpp-compiler';
        this.breakpoints = new Map();
        this._execHighlights = new Map();
        this.completionProviders = new Map(); 
        this._globalKeysRegistered = false;
        this.userSnippets = [];
        this.defaultKeybindings = this.getDefaultKeybindings();
        this.keybindings = { ...this.defaultKeybindings };
        this._keybindingParseCache = new Map();
    this._headerCache = null;
    this._includePathCache = new Map();
    this._compilerIncludeDirsCache = { compilerPath: null, dirs: [] };
    this._compilerIncludeDirsPromise = null;
    this._includeCacheToken = 0;
    this._includeRootsCache = new Map();
    this._fileIncludeCache = new Map();
        this.lineHeightSetting = 0;
        
        this.init();

        document.addEventListener('settings-applied', (evt) => {
            try {
                this.loadKeybindingsFromSettings(evt?.detail || {});
            } catch (e) {
                logWarn('应用快捷键设置失败:', e);
            }
        });

        if (window.electronAPI?.onSettingsChanged) {
            try {
                window.electronAPI.onSettingsChanged((_type, payload) => {
                    if (payload && Object.prototype.hasOwnProperty.call(payload, 'compilerPath')) {
                        this._compilerIncludeDirsCache = { compilerPath: null, dirs: [] };
                        this._compilerIncludeDirsPromise = null;
                        this._includeCacheToken += 1;
                        if (this._includeRootsCache instanceof Map) {
                            this._includeRootsCache.clear();
                        }
                        if (this._fileIncludeCache instanceof Map) {
                            this._fileIncludeCache.clear();
                        }
                        if (this._includePathCache instanceof Map) {
                            for (const key of Array.from(this._includePathCache.keys())) {
                                if (typeof key === 'string' && key.startsWith('sys::')) {
                                    this._includePathCache.delete(key);
                                }
                            }
                        }
                        if (this.editors instanceof Map) {
                            for (const editor of this.editors.values()) {
                                try {
                                    const model = editor?.getModel?.();
                                    if (model && Object.prototype.hasOwnProperty.call(model, '__oicppIncludeCache')) {
                                        delete model.__oicppIncludeCache;
                                    }
                                } catch (_) {}
                            }
                        }
                    }
                });
            } catch (eventError) {
                logWarn('注册设置变化监听失败:', eventError);
            }
        }
    }

    async init() {
        try {
            logInfo('初始化 Monaco Editor 管理器...');
            
            if (typeof monaco === 'undefined') {
                logInfo('等待Monaco Editor库加载...');
                await this.waitForMonaco();
            }
            try {
                if (typeof monaco !== 'undefined' && monaco.editor && !this._themesDefined) {
                    monaco.editor.defineTheme('oicpp-light', {
                        base: 'vs',
                        inherit: true,
                        rules: [],
                        colors: {
                            'editor.background': '#FFFFFF',
                            'editor.foreground': '#000000',
                            'editor.selectionBackground': '#57A1FF99',
                            'editor.inactiveSelectionBackground': '#ADD6FFB3',
                            'editor.selectionForeground': '#000000',
                            'editor.selectionHighlightBackground': '#ADD6FF99',
                            'editor.wordHighlightStrongBackground': '#ADD6FF66',
                            'editor.lineHighlightBackground': '#E9F2FF',
                            'editorCursor.foreground': '#000000',
                            'editorIndentGuide.background': '#00000022',
                            'editorIndentGuide.activeBackground': '#0b216f66',
                            'editorIndentGuide.background1': '#00000022',
                            'editorIndentGuide.background2': '#00000022',
                            'editorIndentGuide.activeBackground1': '#0b216f66',
                            'editorIndentGuide.activeBackground2': '#0b216f66',
                            'editorBracketPairGuide.background1': '#5c6bc05a',
                            'editorBracketPairGuide.background2': '#42a5f55a',
                            'editorBracketPairGuide.background3': '#26a69a5a',
                            'editorBracketPairGuide.background4': '#9ccc655a',
                            'editorBracketPairGuide.background5': '#ffa7265a',
                            'editorBracketPairGuide.background6': '#ab47bc5a',
                            'editorBracketPairGuide.activeBackground1': '#1e3a8a',
                            'editorBracketPairGuide.activeBackground2': '#0d47a1',
                            'editorBracketPairGuide.activeBackground3': '#01579b',
                            'editorBracketPairGuide.activeBackground4': '#004d40',
                            'editorBracketPairGuide.activeBackground5': '#e65100',
                            'editorBracketPairGuide.activeBackground6': '#4a148c'
                        }
                    });
                    monaco.editor.defineTheme('oicpp-dark', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [],
                        colors: {
                            'editorIndentGuide.background': '#ffffff25',
                            'editorIndentGuide.activeBackground': '#ffffff55',
                            'editorBracketPairGuide.background1': '#90caf925',
                            'editorBracketPairGuide.background2': '#ffcc8025',
                            'editorBracketPairGuide.background3': '#ce93d825',
                            'editorBracketPairGuide.background4': '#80cbc425',
                            'editorBracketPairGuide.background5': '#f48fb125',
                            'editorBracketPairGuide.background6': '#a5d6a725',
                            'editorBracketPairGuide.activeBackground1': '#90caf955',
                            'editorBracketPairGuide.activeBackground2': '#ffcc8055',
                            'editorBracketPairGuide.activeBackground3': '#ce93d855',
                            'editorBracketPairGuide.activeBackground4': '#80cbc455',
                            'editorBracketPairGuide.activeBackground5': '#f48fb155',
                            'editorBracketPairGuide.activeBackground6': '#a5d6a755'
                        }
                    });
                    
                    monaco.editor.defineTheme('oicpp-monokai', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [
                            { token: 'comment', foreground: '75715e' },
                            { token: 'keyword', foreground: 'f92672' },
                            { token: 'string', foreground: 'e6db74' },
                            { token: 'number', foreground: 'ae81ff' },
                            { token: 'type', foreground: '66d9ef' },
                            { token: 'class', foreground: 'a6e22e' },
                            { token: 'function', foreground: 'a6e22e' }
                        ],
                        colors: {
                            'editor.background': '#272822',
                            'editor.foreground': '#f8f8f2',
                            'editorCursor.foreground': '#f8f8f0',
                            'editor.selectionBackground': '#49483e',
                            'editor.lineHighlightBackground': '#3e3d32',
                            'editorIndentGuide.background': '#464741',
                            'editorIndentGuide.activeBackground': '#75715e'
                        }
                    });

                    monaco.editor.defineTheme('oicpp-github-light', {
                        base: 'vs',
                        inherit: true,
                        rules: [
                            { token: 'comment', foreground: '6a737d' },
                            { token: 'keyword', foreground: 'd73a49' },
                            { token: 'string', foreground: '032f62' },
                            { token: 'number', foreground: '005cc5' },
                            { token: 'type', foreground: '6f42c1' }
                        ],
                        colors: {
                            'editor.background': '#ffffff',
                            'editor.foreground': '#24292e',
                            'editorCursor.foreground': '#24292e',
                            'editor.selectionBackground': '#0366d625',
                            'editor.lineHighlightBackground': '#f6f8fa',
                            'editorIndentGuide.background': '#d1d5da',
                            'editorIndentGuide.activeBackground': '#959da5'
                        }
                    });

                    monaco.editor.defineTheme('oicpp-github-dark', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [
                            { token: 'comment', foreground: '6a737d' },
                            { token: 'keyword', foreground: 'ff7b72' },
                            { token: 'string', foreground: 'a5d6ff' },
                            { token: 'number', foreground: '79c0ff' },
                            { token: 'type', foreground: 'd2a8ff' }
                        ],
                        colors: {
                            'editor.background': '#24292e',
                            'editor.foreground': '#e1e4e8',
                            'editorCursor.foreground': '#e1e4e8',
                            'editor.selectionBackground': '#3392FF44',
                            'editor.lineHighlightBackground': '#2b3036',
                            'editorIndentGuide.background': '#444d56',
                            'editorIndentGuide.activeBackground': '#6a737d'
                        }
                    });

                    monaco.editor.defineTheme('oicpp-solarized-light', {
                        base: 'vs',
                        inherit: true,
                        rules: [
                            { token: 'comment', foreground: '93a1a1' },
                            { token: 'keyword', foreground: '859900' },
                            { token: 'string', foreground: '2aa198' },
                            { token: 'number', foreground: 'd33682' },
                            { token: 'type', foreground: 'b58900' }
                        ],
                        colors: {
                            'editor.background': '#fdf6e3',
                            'editor.foreground': '#657b83',
                            'editorCursor.foreground': '#657b83',
                            'editor.selectionBackground': '#eee8d5',
                            'editor.lineHighlightBackground': '#eee8d5',
                            'editorIndentGuide.background': '#93a1a155',
                            'editorIndentGuide.activeBackground': '#586e75'
                        }
                    });

                    monaco.editor.defineTheme('oicpp-solarized-dark', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [
                            { token: 'comment', foreground: '586e75' },
                            { token: 'keyword', foreground: '859900' },
                            { token: 'string', foreground: '2aa198' },
                            { token: 'number', foreground: 'd33682' },
                            { token: 'type', foreground: 'b58900' }
                        ],
                        colors: {
                            'editor.background': '#002b36',
                            'editor.foreground': '#839496',
                            'editorCursor.foreground': '#839496',
                            'editor.selectionBackground': '#073642',
                            'editor.lineHighlightBackground': '#073642',
                            'editorIndentGuide.background': '#586e7555',
                            'editorIndentGuide.activeBackground': '#93a1a1'
                        }
                    });

                    monaco.editor.defineTheme('oicpp-dracula', {
                        base: 'vs-dark',
                        inherit: true,
                        rules: [
                            { token: 'comment', foreground: '6272a4' },
                            { token: 'keyword', foreground: 'ff79c6' },
                            { token: 'string', foreground: 'f1fa8c' },
                            { token: 'number', foreground: 'bd93f9' },
                            { token: 'type', foreground: '8be9fd' },
                            { token: 'class', foreground: '50fa7b' },
                            { token: 'function', foreground: '50fa7b' }
                        ],
                        colors: {
                            'editor.background': '#282a36',
                            'editor.foreground': '#f8f8f2',
                            'editorCursor.foreground': '#f8f8f0',
                            'editor.selectionBackground': '#44475a',
                            'editor.lineHighlightBackground': '#44475a',
                            'editorIndentGuide.background': '#6272a4',
                            'editorIndentGuide.activeBackground': '#f8f8f2'
                        }
                    });

                    this._themesDefined = true;
                }
            } catch (e) { logWarn('定义自定义主题失败:', e); }
            
            this.isInitialized = true;
            logInfo('Monaco Editor 管理器初始化完成');

            await this.refreshKeybindingsFromSettings();
            this.registerGlobalKeybindings();

            await this.loadUserSnippets();
        } catch (error) {
            logError('Monaco Editor 管理器初始化失败:', error);
        }
    }

    getLineHeightValue(fontSize, lineHeightSetting) {
        const parsedLineHeight = parseInt(lineHeightSetting, 10);
        if (!Number.isNaN(parsedLineHeight) && parsedLineHeight > 0) {
            return parsedLineHeight;
        }
        const parsedFontSize = parseInt(fontSize, 10);
        const safeFontSize = Number.isNaN(parsedFontSize) || parsedFontSize <= 0 ? 14 : parsedFontSize;
        return Math.round(safeFontSize * 1.4);
    }

    async waitForMonaco() {
        return new Promise((resolve) => {
            const checkMonaco = () => {
                if (typeof monaco !== 'undefined') {
                    resolve();
                } else {
                    setTimeout(checkMonaco, 100);
                }
            };
            checkMonaco();
        });
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

    normalizeKeybindings(raw) {
        const defaults = this.getDefaultKeybindings();
        const normalized = { ...defaults };
        if (raw && typeof raw === 'object') {
            Object.keys(defaults).forEach((key) => {
                const candidate = raw[key];
                if (typeof candidate === 'string' && candidate.trim()) {
                    normalized[key] = candidate.trim();
                }
            });
        }
        return normalized;
    }

    loadKeybindingsFromSettings(allSettings = {}) {
        this.keybindings = this.normalizeKeybindings(allSettings?.keybindings);
        if (this._keybindingParseCache instanceof Map) {
            this._keybindingParseCache.clear();
        }
    }

    resolveKeybinding(action) {
        if (!action) return null;
        return (this.keybindings && this.keybindings[action]) || this.defaultKeybindings[action] || null;
    }

    parseKeybindingCombo(combo) {
        if (!combo || typeof combo !== 'string') return null;
        const cacheKey = `parse:${combo}`;
        if (this._keybindingParseCache?.has(cacheKey)) {
            return this._keybindingParseCache.get(cacheKey);
        }

        const parts = combo.split('+').map(p => p.trim()).filter(Boolean);
        const result = {
            ctrlOrCmd: false,
            shift: false,
            alt: false,
            keyLower: '',
            codeLower: '',
            keyCode: null
        };

        const mapToMonacoKeyCode = (token) => {
            if (typeof monaco === 'undefined' || !monaco.KeyCode) return null;
            const upper = token.toUpperCase();
            if (upper.length === 1 && upper >= 'A' && upper <= 'Z') {
                result.keyLower = upper.toLowerCase();
                result.codeLower = `key${upper.toLowerCase()}`;
                return monaco.KeyCode[`Key${upper}`];
            }
            if (/^[0-9]$/.test(token)) {
                result.keyLower = token;
                result.codeLower = `digit${token}`;
                return monaco.KeyCode[`Digit${token}`];
            }
            if (/^F([1-9]|1[0-2])$/i.test(token)) {
                const number = token.replace(/[^0-9]/g, '');
                result.keyLower = `f${number}`;
                result.codeLower = `f${number}`;
                return monaco.KeyCode[`F${number}`];
            }

            const specialMap = {
                'UP': { code: monaco.KeyCode.UpArrow, key: 'arrowup' },
                'DOWN': { code: monaco.KeyCode.DownArrow, key: 'arrowdown' },
                'LEFT': { code: monaco.KeyCode.LeftArrow, key: 'arrowleft' },
                'RIGHT': { code: monaco.KeyCode.RightArrow, key: 'arrowright' },
                'ENTER': { code: monaco.KeyCode.Enter, key: 'enter' },
                'RETURN': { code: monaco.KeyCode.Enter, key: 'enter' },
                'ESC': { code: monaco.KeyCode.Escape, key: 'escape' },
                'ESCAPE': { code: monaco.KeyCode.Escape, key: 'escape' },
                'SPACE': { code: monaco.KeyCode.Space, key: ' ' },
                'TAB': { code: monaco.KeyCode.Tab, key: 'tab' },
                'BACKSPACE': { code: monaco.KeyCode.Backspace, key: 'backspace' },
                'DELETE': { code: monaco.KeyCode.Delete, key: 'delete' },
                'HOME': { code: monaco.KeyCode.Home, key: 'home' },
                'END': { code: monaco.KeyCode.End, key: 'end' },
                'PAGEUP': { code: monaco.KeyCode.PageUp, key: 'pageup' },
                'PAGEDOWN': { code: monaco.KeyCode.PageDown, key: 'pagedown' }
            };
            if (specialMap[upper]) {
                result.keyLower = specialMap[upper].key;
                result.codeLower = specialMap[upper].key;
                return specialMap[upper].code;
            }
            return null;
        };

        parts.forEach((part) => {
            const lower = part.toLowerCase();
            if (lower === 'ctrl' || lower === 'cmd' || lower === 'ctrlcmd' || lower === 'cmdorctrl' || lower === 'ctrlorcmd') {
                result.ctrlOrCmd = true;
                return;
            }
            if (lower === 'shift') { result.shift = true; return; }
            if (lower === 'alt' || lower === 'option') { result.alt = true; return; }

            if (!result.keyLower) {
                result.keyCode = mapToMonacoKeyCode(part);
                if (!result.keyLower) {
                    result.keyLower = lower;
                    result.codeLower = lower;
                }
            }
        });

        if (result.keyLower) {
            this._keybindingParseCache?.set(cacheKey, result);
        }
        return result;
    }

    toMonacoKeybinding(action) {
        const combo = this.resolveKeybinding(action);
        if (!combo) return null;
        const cacheKey = `monaco:${combo}`;
        if (this._keybindingParseCache?.has(cacheKey)) {
            return this._keybindingParseCache.get(cacheKey);
        }
        const parsed = this.parseKeybindingCombo(combo);
        if (!parsed || parsed.keyCode === null || typeof parsed.keyCode === 'undefined') {
            this._keybindingParseCache?.set(cacheKey, null);
            return null;
        }
        let code = parsed.keyCode;
        if (parsed.ctrlOrCmd) code |= monaco.KeyMod.CtrlCmd;
        if (parsed.shift) code |= monaco.KeyMod.Shift;
        if (parsed.alt) code |= monaco.KeyMod.Alt;
        this._keybindingParseCache?.set(cacheKey, code);
        return code;
    }

    doesEventMatchShortcut(event, action) {
        const combo = this.resolveKeybinding(action);
        if (!combo) return false;
        const parsed = this.parseKeybindingCombo(combo);
        if (!parsed) return false;

        const ctrlLike = !!(event.ctrlKey || event.metaKey);
        if (parsed.ctrlOrCmd !== ctrlLike) return false;
        if (parsed.shift !== !!event.shiftKey) return false;
        if (parsed.alt !== !!event.altKey) return false;

        const eventKeyLower = (event.key || '').toLowerCase();
        const eventCodeLower = (event.code || '').toLowerCase();
        if (!parsed.keyLower) return false;
        return eventKeyLower === parsed.keyLower || eventCodeLower === parsed.codeLower || eventCodeLower === parsed.keyLower;
    }

    isInputLikeTarget(target) {
        if (!target || !target.tagName) return false;
        const tag = target.tagName.toLowerCase();
        return tag === 'input' || tag === 'textarea' || target.isContentEditable;
    }

    async refreshKeybindingsFromSettings() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const allSettings = await window.electronAPI.getAllSettings();
                this.loadKeybindingsFromSettings(allSettings);
                return;
            }
        } catch (err) {
            logWarn('加载快捷键设置失败，使用默认值', err);
        }
        this.loadKeybindingsFromSettings({});
    }

    registerGroup(groupId, element) {
        try {
            if (!groupId || !element) return;
            this.groupContainers.set(groupId, element);
            if (!this.groupActiveTab.has(groupId)) {
                this.groupActiveTab.set(groupId, null);
            }
        } catch (e) {
            logWarn('MonacoEditorManager.registerGroup 失败:', e);
        }
    }

    unregisterGroup(groupId) {
        try {
            if (!groupId) return;
            this.groupContainers.delete(groupId);
            this.groupActiveTab.delete(groupId);
        } catch (e) {
            logWarn('MonacoEditorManager.unregisterGroup 失败:', e);
        }
    }

    getGroupContainer(groupId) {
        if (groupId && this.groupContainers.has(groupId)) {
            return this.groupContainers.get(groupId);
        }

        const legacy = document.getElementById('editor-area');
        if (legacy) {
            return legacy;
        }

        if (groupId) {
            const fallback = document.querySelector(`.editor-area[data-group-id="${groupId}"]`);
            if (fallback) {
                this.groupContainers.set(groupId, fallback);
                return fallback;
            }
        }

        const defaultArea = document.querySelector('.editor-area');
        if (defaultArea) {
            const defaultId = defaultArea.dataset.groupId || 'group-1';
            this.groupContainers.set(defaultId, defaultArea);
            if (!this.groupActiveTab.has(defaultId)) {
                this.groupActiveTab.set(defaultId, null);
            }
            return defaultArea;
        }

        return null;
    }

    moveEditorToGroup(tabId, targetGroupId) {
        try {
            if (!tabId || !targetGroupId) return;

            const container = this.tabIdToContainer.get(tabId) || null;
            const targetArea = this.getGroupContainer(targetGroupId);
            if (!container || !targetArea) return;

            const currentGroupId = this.tabIdToGroupId.get(tabId);
            if (currentGroupId === targetGroupId) return;

            targetArea.appendChild(container);
            this.tabIdToGroupId.set(tabId, targetGroupId);

            if (currentGroupId && this.groupActiveTab.get(currentGroupId) === tabId) {
                this.groupActiveTab.set(currentGroupId, null);
            }

            container.style.display = 'none';

            const activeInTarget = this.groupActiveTab.get(targetGroupId);
            if (!activeInTarget) {
                this.switchTab(tabId);
            }
        } catch (e) {
            logWarn('MonacoEditorManager.moveEditorToGroup 失败:', e);
        }
    }

    async loadUserSnippets() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const all = await window.electronAPI.getAllSettings();
                this.userSnippets = Array.isArray(all?.codeSnippets) ? all.codeSnippets : [];
            } else if (window.getSettingsManager) {
                const m = window.getSettingsManager();
                this.userSnippets = Array.isArray(m?.getSettings('codeSnippets')) ? m.getSettings('codeSnippets') : [];
            }
            if (!Array.isArray(this.userSnippets)) this.userSnippets = [];
            logInfo('加载用户片段完成，数量:', this.userSnippets.length);
        } catch (e) {
            logWarn('加载用户片段失败:', e);
            this.userSnippets = [];
        }
    }

    async refreshUserSnippets() {
        await this.loadUserSnippets();
    }

    registerGlobalKeybindings() {
        if (this._globalKeysRegistered) return;
        try {
            document.addEventListener('keydown', (e) => {
                try {
                    if (this.isInputLikeTarget(e.target)) return;
                    if (this.doesEventMatchShortcut(e, 'formatCode') && this.currentEditor) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.formatCode();
                        return;
                    }
                    if (this.doesEventMatchShortcut(e, 'showFunctionPicker') && this.currentEditor) {
                        e.preventDefault();
                        e.stopPropagation();
                        this.showFunctionPicker();
                    }
                } catch (_) {}
            }, true);
            this._globalKeysRegistered = true;
        } catch (err) {
            logWarn('注册全局快捷键失败:', err);
        }
    }

    async openFile(filePath, content = '') {
        try {
            this.currentFilePath = filePath;
            this.currentFileName = this.getFileNameFromPath(filePath);
            
            if (!this.currentEditor) {
                const tabId = this.generateTabId(this.currentFileName, filePath);
                await this.createNewEditor(tabId, this.currentFileName, content);
            } else {
                this.currentEditor.setValue(content);
                this.currentEditor.filePath = filePath;
                this.currentEditor.getFilePath = () => {
                    return this.currentEditor.filePath || filePath;
                };
                try {
                    const model = this.currentEditor.getModel ? this.currentEditor.getModel() : null;
                    if (model) {
                        model.__oicppFilePath = filePath;
                    }
                } catch (_) {}
            }
            
            logInfo('文件打开成功:', filePath);
            return true;
        } catch (error) {
            logError('打开文件失败:', error);
            return false;
        }
    }

    async createNewEditor(tabId, fileName, content = '', filePath = null, options = {}) {
        try {
            const existingEditor = this.editors.get(tabId);
            if (existingEditor) {
                logInfo('编辑器已存在，直接切换:', fileName);
                this.currentEditor = existingEditor;
                
                const existingFilePath = this.tabIdToFilePath.get(tabId);
                if (existingFilePath) {
                    this.currentFilePath = existingFilePath;
                    this.currentFileName = this.getFileNameFromPath(existingFilePath);
                } else {
                    this.currentFilePath = filePath || fileName;
                    this.currentFileName = fileName;
                }

                const targetGroup = options?.groupId;
                if (targetGroup) {
                    this.moveEditorToGroup(tabId, targetGroup);
                }
                
                setTimeout(() => {
                    existingEditor.focus();
                    logInfo('编辑器已获得焦点:', this.currentFileName);
                }, 50);
                
                return existingEditor;
            }

            if (filePath && typeof filePath === 'object' && !Array.isArray(filePath)) {
                options = filePath;
                filePath = options.filePath || null;
            }
            if (!options || typeof options !== 'object') {
                options = {};
            }

            const groupId = options.groupId || options.targetGroupId || 'group-1';
            const editorArea = this.getGroupContainer(groupId);

            if (!editorArea) {
                logError('未找到编辑器区域');
                return null;
            }

            const containers = editorArea.querySelectorAll('.monaco-editor-container');
            containers.forEach(c => c.style.display = 'none');
            
            const monacoContainer = document.createElement('div');
            monacoContainer.className = 'monaco-editor-container';
            monacoContainer.dataset.tabId = tabId; // 使用 tabId 关联容器
            monacoContainer.dataset.groupId = groupId;
            monacoContainer.style.width = '100%';
            monacoContainer.style.height = '100%';
            editorArea.appendChild(monacoContainer);

            if (typeof monaco === 'undefined') {
                await this.waitForMonaco();
            }
            



            let currentTheme = 'dark'; // 默认深色主题
            let fontSize = 14; // 默认字体大小
            let fontFamily = 'Consolas'; // 默认字体
            let foldingEnabled = true; // 代码折叠
            let stickyScrollEnabled = true; // 上方显示当前作用域（函数/类）
            let fontLigaturesEnabled = true; // 字体连字
            let tabSize = 4;
            let autoCompletionEnabled = true;
            let lineHeightSetting = 0;
            try {
                if (window.electronAPI && window.electronAPI.getAllSettings) {
                    const allSettings = await window.electronAPI.getAllSettings();
                    if (allSettings) {
                        currentTheme = allSettings.theme || 'dark';
                        if (allSettings.fontSize) {
                            fontSize = parseInt(allSettings.fontSize);
                        }
                        if (typeof allSettings.lineHeight === 'number' && allSettings.lineHeight > 0) {
                            lineHeightSetting = allSettings.lineHeight;
                        }
                        if (allSettings.font) {
                            if (window.fontDetector) {
                                fontFamily = window.fontDetector.validateFont(allSettings.font);
                                if (fontFamily !== allSettings.font) {
                                    window.electronAPI.updateSettings({ font: fontFamily }).catch(err => {
                                        logError('更新字体设置失败:', err);
                                    });
                                }
                            } else {
                                fontFamily = allSettings.font;
                            }
                        }
                        foldingEnabled = allSettings.foldingEnabled !== false;
                        stickyScrollEnabled = allSettings.stickyScrollEnabled !== false;
                        fontLigaturesEnabled = allSettings.fontLigaturesEnabled !== false;
                        autoCompletionEnabled = allSettings.enableAutoCompletion !== false;
                        const parsedTabSize = parseInt(allSettings.tabSize, 10);
                        if (!Number.isNaN(parsedTabSize) && parsedTabSize > 0) {
                            tabSize = parsedTabSize;
                        }
                        this.loadKeybindingsFromSettings(allSettings);
                    }
                }
            } catch (error) {
                logWarn('获取设置失败，使用默认设置:', error);
            }

            this.lineHeightSetting = lineHeightSetting;
            
            let monacoTheme = 'oicpp-dark';
            if (currentTheme === 'light') monacoTheme = 'oicpp-light';
            else if (currentTheme === 'dark') monacoTheme = 'oicpp-dark';
            else monacoTheme = `oicpp-${currentTheme}`;

            const editor = monaco.editor.create(monacoContainer, {
                value: content,
                language: this.getLanguageFromFileName(fileName),
                theme: monacoTheme,
                automaticLayout: true,
                glyphMargin: true,
                    links: true,
                    occurrencesHighlight: true,
                    selectionHighlight: true,
                    colorDecorators: true,
                    bracketPairColorization: { enabled: true },
                guides: {
                    indentation: true,
                    highlightActiveIndentation: true,
                    highlightActiveBracketPair: true,
                    bracketPairs: true,
                    bracketPairsHorizontal: false
                },
                renderIndentGuides: true,
                highlightActiveIndentGuide: true,
                fontSize: fontSize,
                fontFamily: fontFamily,
                fontLigatures: !!fontLigaturesEnabled,
                fontWeight: 'normal',
                letterSpacing: 0,
                lineHeight: this.getLineHeightValue(fontSize, lineHeightSetting),
                lineNumbers: 'on',
                lineNumbersMinChars: 3,
                minimap: { enabled: true },
                scrollBeyondLastLine: true,
                wordWrap: 'off',
                tabSize,
                insertSpaces: false,
                renderWhitespace: 'none',
                renderControlCharacters: false,
                selectionHighlight: true,
                selectionClipboard: true,
                folding: foldingEnabled,
                foldingStrategy: 'auto',
                foldingHighlight: true,
                foldingImportsByDefault: false,
                showFoldingControls: 'always',
                contextmenu: true,
                selectionClipboard: true,
                multiCursorSupport: true,
                find: {
                    addExtraSpaceOnTop: false,
                    autoFindInSelection: 'never',
                    seedSearchStringFromSelection: 'always'
                },
                copyWithSyntaxHighlighting: false,
                emptySelectionClipboard: false,
                readOnly: false,
                domReadOnly: false,
                quickSuggestions: autoCompletionEnabled ? true : false,
                suggestOnTriggerCharacters: autoCompletionEnabled ? true : false,
                wordBasedSuggestions: autoCompletionEnabled ? 'matchingDocuments' : 'off',
                tabCompletion: autoCompletionEnabled ? 'on' : 'off',
                acceptSuggestionOnEnter: autoCompletionEnabled ? 'on' : 'off',
                parameterHints: { enabled: !!autoCompletionEnabled },
                suggest: {
                    showKeywords: true,
                    showSnippets: true,
                    showFunctions: true,
                    showConstructors: true,
                    showFields: true,
                    showVariables: true,
                    showClasses: true,
                    showStructs: true,
                    showInterfaces: true,
                    showModules: true,
                    showProperties: true,
                    showEvents: true,
                    showOperators: true,
                    showUnits: true,
                    showValues: true,
                    showConstants: true,
                    showEnums: true,
                    showEnumMembers: true,
                    showColors: true,
                    showFiles: true,
                    showReferences: true,
                    showFolders: true,
                    showTypeParameters: true,
                    showIssues: true,
                    showUsers: true,
                    showWords: false
                    },
                    stickyScroll: { enabled: stickyScrollEnabled }
            });
            try {
                monaco.editor.setTheme(monacoTheme);
                if (monacoTheme === 'oicpp-light' || monacoTheme === 'oicpp-github-light' || monacoTheme === 'oicpp-solarized-light') {
                    document.body.setAttribute('data-strong-indent-guides', '');
                } else {
                    document.body.removeAttribute('data-strong-indent-guides');
                }
            } catch (_) {}
            
            if (autoCompletionEnabled) {
                this.registerEnhancedCompletionProvider(editor);
            }

            try {
                const markdownPreviewKey = this.toMonacoKeybinding('markdownPreview') || (monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyV);
                editor.addAction({
                    id: 'markdown-preview-split',
                    label: '打开 Markdown 预览',
                    keybindings: markdownPreviewKey ? [markdownPreviewKey] : [],
                    precondition: null,
                    keybindingContext: null,
                    contextMenuGroupId: 'navigation',
                    contextMenuOrder: 1.5,
                    run: function(ed) {
                        if (window.tabManager) {
                            window.tabManager.toggleMarkdownSplitView();
                        }
                    }
                });
            } catch (e) {
                logWarn('Failed to register markdown action:', e);
            }

            try {
                const formatKeybinding = this.toMonacoKeybinding('formatCode') || (monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.KeyS);
                editor.addCommand(formatKeybinding, async () => {
                    try {
                        await this.formatCode();
                        logInfo('已通过快捷键触发格式化');
                    } catch (e) {
                        logError('格式化失败:', e);
                    }
                });
            } catch (e) {
                logWarn('注册格式化快捷键失败:', e);
            }

            try {
                const gotoSymbolKey = this.toMonacoKeybinding('showFunctionPicker') || (monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyG);
                editor.addCommand(gotoSymbolKey, () => {
                    this.showFunctionPicker();
                });
            } catch (e) { logWarn('注册 Ctrl+Shift+G 失败:', e); }
            try {
                const renameKey = this.toMonacoKeybinding('renameSymbol') || monaco.KeyCode.F2;
                editor.addCommand(renameKey, () => {
                    this.renameIdentifierAtCursor();
                });
            } catch (e) { logWarn('注册 F2 重命名 失败:', e); }

            try {
                editor.__forceSelDecos = [];
                const applySelectionDecoration = () => {
                    try {
                        const sel = editor.getSelection();
                        if (!sel || sel.isEmpty()) {
                            if (editor.__forceSelDecos && editor.__forceSelDecos.length) {
                                editor.__forceSelDecos = editor.deltaDecorations(editor.__forceSelDecos, []);
                            }
                            return;
                        }
                        const newDecos = [{
                            range: sel,
                            options: {
                                inlineClassName: 'oicpp-force-sel-inline'
                            }
                        }];
                        editor.__forceSelDecos = editor.deltaDecorations(editor.__forceSelDecos || [], newDecos);
                    } catch (_) {}
                };
                editor.onDidChangeCursorSelection(() => applySelectionDecoration());
                editor.onDidFocusEditorWidget(() => applySelectionDecoration());
                editor.onDidBlurEditorWidget(() => applySelectionDecoration());
            } catch (e) { logWarn('选区兜底装饰器注册失败:', e); }
            
            const copyKeybinding = this.toMonacoKeybinding('copy') || (monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyC);
            editor.addCommand(copyKeybinding, () => {
                const activeEditor = this.currentEditor;
                if (activeEditor) {
                    logInfo('复制命令被触发 - 使用当前活动编辑器:', this.currentFileName);
                    const selection = activeEditor.getSelection();
                    if (selection && !selection.isEmpty()) {
                        const selectedText = activeEditor.getModel().getValueInRange(selection);
                        if (selectedText) {
                            this.copyToClipboard(selectedText);
                        }
                    } else {
                        logInfo('没有选中文本');
                    }
                } else {
                    logInfo('没有当前活动编辑器');
                }
            });
            
            try {
                const deleteKeybinding = this.toMonacoKeybinding('deleteLine') || (monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD);
                editor.addCommand(deleteKeybinding, () => {
                    const ed = this.currentEditor || editor;
                    if (!ed) return;
                    const sel = ed.getSelection();
                    if (!sel) return;
                    const startLine = Math.min(sel.startLineNumber, sel.endLineNumber);
                    const endLine = Math.max(sel.startLineNumber, sel.endLineNumber);
                    const model = ed.getModel();
                    const maxCol = model.getLineMaxColumn(endLine);
                    const range = new monaco.Range(startLine, 1, endLine, maxCol);
                    const isLastLine = endLine >= model.getLineCount();
                    const finalRange = isLastLine ? range : new monaco.Range(startLine, 1, endLine + 1, 1);
                    ed.executeEdits('delete-line', [{ range: finalRange, text: '' }]);
                });
            } catch (e) { logWarn('注册 Ctrl+D 删除行 失败:', e); }

            try {
                const duplicateKeybinding = this.toMonacoKeybinding('duplicateLine') || (monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE);
                editor.addCommand(duplicateKeybinding, () => {
                    const ed = this.currentEditor || editor;
                    if (!ed) return;
                    const sel = ed.getSelection();
                    const model = ed.getModel();
                    if (!sel || !model) return;
                    const startLine = Math.min(sel.startLineNumber, sel.endLineNumber);
                    const endLine = Math.max(sel.startLineNumber, sel.endLineNumber);
                    const text = model.getValueInRange(new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)));
                    const insertPos = new monaco.Position(endLine, model.getLineMaxColumn(endLine));
                    const insertText = '\n' + text;
                    ed.executeEdits('duplicate-line', [{ range: new monaco.Range(insertPos.lineNumber, insertPos.column, insertPos.lineNumber, insertPos.column), text: insertText }]);
                });
            } catch (e) { logWarn('注册 Ctrl+E 复制行 失败:', e); }

            try {
                const moveUpKey = this.toMonacoKeybinding('moveLineUp') || (monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.UpArrow);
                editor.addCommand(moveUpKey, () => {
                    const ed = this.currentEditor || editor;
                    if (!ed) return;
                    ed.trigger('keyboard', 'editor.action.moveLinesUpAction', null);
                });
            } catch (e) { logWarn('注册 Ctrl+Shift+Up 移动行 失败:', e); }

            try {
                const moveDownKey = this.toMonacoKeybinding('moveLineDown') || (monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.DownArrow);
                editor.addCommand(moveDownKey, () => {
                    const ed = this.currentEditor || editor;
                    if (!ed) return;
                    ed.trigger('keyboard', 'editor.action.moveLinesDownAction', null);
                });
            } catch (e) { logWarn('注册 Ctrl+Shift+Down 移动行 失败:', e); }

            const pasteKeybinding = this.toMonacoKeybinding('paste') || (monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV);
            editor.addCommand(pasteKeybinding, async () => {
                const activeEditor = this.currentEditor;
                if (activeEditor) {
                    logInfo('粘贴命令被触发 - 使用当前活动编辑器:', this.currentFileName);
                    try {
                        const text = await this.readFromClipboard();
                        
                        if (text) {
                            const position = activeEditor.getPosition();
                            const selection = activeEditor.getSelection();
                            
                            const range = selection && !selection.isEmpty() 
                                ? selection 
                                : new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
                            
                            activeEditor.executeEdits('paste', [{
                                range: range,
                                text: text
                            }]);
                            
                            const lines = text.split('\n');
                            const lastLineLength = lines[lines.length - 1].length;
                            const newPosition = {
                                lineNumber: position.lineNumber + lines.length - 1,
                                column: lines.length === 1 ? position.column + lastLineLength : lastLineLength + 1
                            };
                            activeEditor.setPosition(newPosition);
                            
                            logInfo('粘贴操作成功');
                        } else {
                            logWarn('剪贴板为空或无法读取');
                        }
                    } catch (err) {
                        logError('粘贴操作失败:', err);
                    }
                } else {
                    logInfo('没有当前活动编辑器');
                }
            });
            
            const cutKeybinding = this.toMonacoKeybinding('cut') || (monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyX);
            editor.addCommand(cutKeybinding, () => {
                const activeEditor = this.currentEditor;
                if (activeEditor) {
                    logInfo('剪切命令被触发 - 使用当前活动编辑器:', this.currentFileName);
                    const selection = activeEditor.getSelection();
                    
                    if (selection && !selection.isEmpty()) {
                        const selectedText = activeEditor.getModel().getValueInRange(selection);
                        if (selectedText) {
                            this.copyToClipboard(selectedText);
                            
                            activeEditor.executeEdits('cut', [{
                                range: selection,
                                text: ''
                            }]);
                            
                            activeEditor.setPosition({
                                lineNumber: selection.startLineNumber,
                                column: selection.startColumn
                            });
                            
                            logInfo('剪切操作成功:', selectedText.substring(0, 50) + (selectedText.length > 50 ? '...' : ''));
                        }
                    } else {
                        logInfo('剪切：没有选中任何文本');
                    }
                } else {
                    logInfo('没有当前活动编辑器');
                }
            });

            this.setupCtrlClickNavigation(editor);

            const resolvedFilePath = filePath || this.currentFilePath || null;
            editor.filePath = resolvedFilePath;
            editor.fileName = fileName;
            editor.getFilePath = () => {
                return editor.filePath || this.currentFilePath || null;
            };
            try {
                const model = editor.getModel ? editor.getModel() : null;
                if (model) {
                    model.__oicppFilePath = resolvedFilePath;
                }
            } catch (_) {}

            this.currentEditor = editor;
            this.editors.set(tabId, editor);
            this.tabIdToGroupId.set(tabId, groupId);
            this.tabIdToContainer.set(tabId, monacoContainer);
            this.groupActiveTab.set(groupId, tabId);
            
            if (filePath) {
                this.tabIdToFilePath.set(tabId, filePath);
                this.currentFilePath = filePath;
            } else {
                this.currentFilePath = fileName; // 临时设置，后续会被正确的文件路径覆盖
            }
            this.currentFileName = fileName;
            
            setTimeout(() => {
                editor.layout();
            }, 100);
            
            monacoContainer.addEventListener('click', (e) => {
                const findWidget = e.target.closest('.find-widget');
                const suggestionWidget = e.target.closest('.suggest-widget');
                const contextMenu = e.target.closest('.context-view');
                const parameterHints = e.target.closest('.parameter-hints-widget');
                
                if (findWidget || suggestionWidget || contextMenu || parameterHints) {
                    return;
                }
                
                if (editor && editor.focus) {
                    editor.focus();
                }
            });
            
            this.addWheelZoomListener(editor, monacoContainer);
            
            try {
                if (editor && editor.onDidFocusEditorWidget) {
                    editor.onDidFocusEditorWidget(() => {
                        try {
                            this.currentEditor = editor;
                            if (editor.filePath) this.currentFilePath = editor.filePath;
                            if (editor.fileName) this.currentFileName = editor.fileName;
                        } catch (_) {}
                    });
                }
            } catch (_) {}
            
            
            const isStructLikeDefinition = (model, braceLineNumber, requireBraceLineMatch = false, startLineNumber = braceLineNumber) => {
                try {
                    for (let line = startLineNumber, scanned = 0; line >= 1 && scanned < 200; line--, scanned++) {
                        const raw = model.getLineContent(line);
                        const content = raw.trim();
                        if (!content) continue;

                        if (/;\s*$/.test(content) && !content.includes('{')) break;

                        if (/\b(struct|class|union|enum)\b/.test(content)) {
                            const prevLineRaw = model.getLineContent(line - 1) || '';
                            if (/\btypedef\b/.test(content) || /\btypedef\b/.test(prevLineRaw)) {
                                continue;
                            }
                            const hasOpeningBraceSameLine = content.includes('{');
                            const nextLineRaw = model.getLineContent(line + 1) || '';
                            const nextLineHasBrace = (!hasOpeningBraceSameLine && /{/.test(nextLineRaw));
                            const isDefinition = hasOpeningBraceSameLine || nextLineHasBrace;
                            if (!isDefinition) {
                                continue;
                            }

                            if (!requireBraceLineMatch) return true;
                            if (hasOpeningBraceSameLine && line === braceLineNumber) return true;
                            if (!hasOpeningBraceSameLine && nextLineHasBrace && line + 1 === braceLineNumber) return true;
                        }

                        if (content.includes('}')) break;
                    }
                } catch (_) {}
                return false;
            };

            const tryAutoSemicolonAtLine = (model, lineNumber) => {
                try {
                    if (!lineNumber || lineNumber < 1 || lineNumber > model.getLineCount()) return false;
                    const lineText = model.getLineContent(lineNumber);
                    const trimmed = lineText.trim();
                    if (trimmed !== '}') return false;
                    const braceIndex = lineText.indexOf('}');
                    if (braceIndex < 0) return false;
                    const afterCloseRaw = lineText.slice(braceIndex + 1);
                    if (afterCloseRaw.trimStart().startsWith(';')) return false;
                    if (!isStructLikeDefinition(model, lineNumber, false, Math.max(1, lineNumber - 1))) return false;
                    const insertRange = new monaco.Range(lineNumber, braceIndex + 2, lineNumber, braceIndex + 2);
                    editor.executeEdits('auto-semicolon', [{ range: insertRange, text: ';' }]);
                    return true;
                } catch (_) {}
                return false;
            };

            editor.onDidType((text) => {
                try {
                    const model = editor.getModel();
                    if (!model) return;
                    const languageId = model.getLanguageId();
                    if (languageId !== 'cpp' && languageId !== 'c') return;
                    const pos = editor.getPosition();
                    if (!pos) return;

                    if (text === '{') {
                        if (!isStructLikeDefinition(model, pos.lineNumber, true)) return;
                        setTimeout(() => {
                            const afterPos = editor.getPosition();
                            if (!afterPos) return;
                            const lineTextNow = model.getLineContent(afterPos.lineNumber);
                            const closeIndex = afterPos.column - 1;
                            if (lineTextNow[closeIndex] !== '}') return;
                            const afterCloseRaw = lineTextNow.slice(closeIndex + 1);
                            if (afterCloseRaw.trimStart().startsWith(';')) return;
                            const insertRange = new monaco.Range(afterPos.lineNumber, closeIndex + 2, afterPos.lineNumber, closeIndex + 2);
                            editor.executeEdits('auto-semicolon', [{ range: insertRange, text: ';' }]);
                        }, 0);
                        return;
                    }

                    if (text !== '}') return;

                    const currentLineContent = model.getLineContent(pos.lineNumber);
                    const afterBrace = currentLineContent.slice(pos.column - 1).trim();
                    if (afterBrace.startsWith(';')) return;

                    if (!isStructLikeDefinition(model, pos.lineNumber, false, Math.max(1, pos.lineNumber - 1))) return;

                    setTimeout(() => {
                        const afterPos = editor.getPosition();
                        if (!afterPos) return;
                        const lineTextNow = model.getLineContent(afterPos.lineNumber);
                        const afterNow = lineTextNow.slice(afterPos.column - 1).trim();
                        if (afterNow.startsWith(';')) return;
                        const insertRange = new monaco.Range(afterPos.lineNumber, afterPos.column, afterPos.lineNumber, afterPos.column);
                        editor.executeEdits('auto-semicolon', [{ range: insertRange, text: ';' }]);
                    }, 0);
                } catch (_) {}
            });

            editor.onDidChangeModelContent((event) => {
                if (event?.isFlush) {
                    return;
                }
                try {
                    const model = editor.getModel();
                    if (model) {
                        const languageId = model.getLanguageId();
                        if (languageId === 'cpp' || languageId === 'c') {
                            const changes = event?.changes || [];
                            const seenLines = new Set();
                            let shouldCheckAroundCursor = false;
                            let seenDeletion = false;
                            changes.forEach(change => {
                                const text = change?.text || '';
                                const isDeletion = text === '';
                                if (isDeletion) {
                                    seenDeletion = true;
                                }
                                if (text.includes('\n') || text.includes('{') || text.includes('}')) {
                                    shouldCheckAroundCursor = true;
                                }
                                const lineNumber = change.range?.endLineNumber || change.range?.startLineNumber;
                                if (!lineNumber || seenLines.has(lineNumber)) return;
                                seenLines.add(lineNumber);
                                if (isDeletion) {
                                    const lineText = model.getLineContent(lineNumber);
                                    if (lineText.includes('}') && !lineText.includes(';')) {
                                        return;
                                    }
                                }
                                tryAutoSemicolonAtLine(model, lineNumber);
                            });

                            if (shouldCheckAroundCursor && !seenDeletion) {
                                setTimeout(() => {
                                    const pos = editor.getPosition();
                                    if (!pos) return;
                                    const lines = [pos.lineNumber - 2, pos.lineNumber - 1, pos.lineNumber, pos.lineNumber + 1, pos.lineNumber + 2];
                                    for (const ln of lines) {
                                        if (tryAutoSemicolonAtLine(model, ln)) break;
                                    }
                                }, 0);
                            }
                        }
                    }
                } catch (_) {}
                if (window.tabManager) {
                    let uniqueKey = fileName;
                    if (filePath) {
                        uniqueKey = filePath.replace(/\\/g, '/');
                    }
                    if (window.tabManager.markTabAsModifiedByUniqueKey && filePath) {
                        window.tabManager.markTabAsModifiedByUniqueKey(uniqueKey);
                    } else {
                        window.tabManager.markTabAsModified(fileName);
                    }
                }
            });

            window.addEventListener('resize', () => {
                if (editor && editor.getModel && editor.getModel()) {
                    try {
                        editor.layout();
                    } catch (e) {
                        logWarn('编辑器布局更新失败:', e);
                    }
                }
            });
            
            if (window.ResizeObserver) {
                const resizeObserver = new ResizeObserver(() => {
                    if (editor && editor.getModel && editor.getModel()) {
                        try {
                            editor.layout();
                        } catch (e) {
                            logWarn('编辑器布局更新失败:', e);
                        }
                    }
                });
                resizeObserver.observe(monacoContainer);
            }

            logInfo('Monaco编辑器创建成功:', fileName);
            try { this._initBreakpointSupport(editor, monacoContainer, tabId); } catch (e) { logWarn('初始化断点支持失败:', e); }
            return editor;
        } catch (error) {
            logError('创建Monaco编辑器失败:', error);
            return null;
        }
    }


    getCurrentEditor() {
        return this.currentEditor;
    }

    clearAllExecHighlights() {
        try {
            if (!this.editors) return;
            for (const [, ed] of this.editors.entries()) {
                try { ed?.clearExecHighlight?.(); } catch (_) {}
            }
        } catch (_) {}
    }

    getAllBreakpoints() {
        const results = [];
        try {
            for (const [tabId, ed] of this.editors.entries()) {
                if (!ed || !ed.getModel) continue;
                const file = ed.filePath || this.tabIdToFilePath.get(tabId) || ed.fileName || null;
                if (!file) continue;
                const decos = Array.isArray(ed.__breakpointDecos) ? ed.__breakpointDecos : [];
                for (const decoId of decos) {
                    const range = ed.getModel().getDecorationRange(decoId);
                    if (range && Number.isFinite(range.startLineNumber)) {
                        results.push({ file, line: range.startLineNumber });
                    }
                }
            }
        } catch (e) { logWarn('getAllBreakpoints 失败:', e); }
        return results;
    }

    applyDiagnostics(diagnostics = []) {
        try {
            if (typeof monaco === 'undefined') return;
            const markers = [];

            if (!Array.isArray(diagnostics)) diagnostics = [];

            for (const d of diagnostics) {
                const sev = d?.severity;
                const severity = sev === 'warning'
                    ? monaco.MarkerSeverity.Warning
                    : (sev === 'note' ? monaco.MarkerSeverity.Info : monaco.MarkerSeverity.Error);
                const line = Math.max(1, parseInt(d?.line || 1, 10));
                const col = Math.max(1, parseInt(d?.column || 1, 10));
                markers.push({
                    severity,
                    message: d?.message || d?.raw || '',
                    startLineNumber: line,
                    startColumn: col,
                    endLineNumber: line,
                    endColumn: col + 1
                });
            }

            const editor = this.getCurrentEditor();
            const model = editor?.getModel ? editor.getModel() : null;
            if (model) {
                monaco.editor.setModelMarkers(model, this.markerOwner, markers);
            }
        } catch (err) {
            logWarn('applyDiagnostics 失败:', err);
        }
    }

    clearDiagnostics() {
        try {
            if (typeof monaco === 'undefined') return;
            const editor = this.getCurrentEditor();
            const model = editor?.getModel ? editor.getModel() : null;
            if (model) {
                monaco.editor.setModelMarkers(model, this.markerOwner, []);
            }
        } catch (err) {
            logWarn('clearDiagnostics 失败:', err);
        }
    }

    _initBreakpointSupport(editor, container, tabId) {
        if (!editor || editor.__bpInited) return;
        editor.__bpInited = true;
        editor.__breakpointDecos = [];
        editor.__execDeco = null;

        const toggleAt = (line) => {
            try {
                if (!Number.isFinite(line) || line <= 0) return;
                const model = editor.getModel();
                if (!model) return;
                const idx = editor.__breakpointDecos.findIndex(id => {
                    const r = model.getDecorationRange(id);
                    return r && r.startLineNumber === line;
                });
                const file = editor.filePath || this.currentFilePath || editor.fileName;
                const sendIPC = (channel, payload) => {
                    try {
                        if (typeof require !== 'undefined' && window.app?.isDebugging) {
                            const { ipcRenderer } = require('electron');
                            ipcRenderer.send(channel, payload);
                        }
                    } catch (_) {}
                };
                if (idx >= 0) {
                    const removeId = editor.__breakpointDecos[idx];
                    editor.__breakpointDecos.splice(idx, 1);
                    editor.deltaDecorations([removeId], []);
                    sendIPC('debug-remove-breakpoint', { file, line });
                } else {
                    const [newId] = editor.deltaDecorations([], [{
                        range: new monaco.Range(line, 1, line, 1),
                        options: {
                            isWholeLine: true,
                            glyphMarginClassName: 'breakpoint-glyph',
                            glyphMargin: true
                        }
                    }]);
                    editor.__breakpointDecos.push(newId);
                    sendIPC('debug-add-breakpoint', { file, line });
                }
            } catch (e) { logWarn('切换断点失败:', e); }
        };

        editor.onMouseDown((e) => {
            try {
                const t = e?.target;
                const type = t?.type;
                const L = monaco.editor.MouseTargetType;
                if (type !== L.GUTTER_GLYPH_MARGIN) return;
                if (t?.element?.className && /fold/gi.test(t.element.className)) return;
                const line = t?.position?.lineNumber;
                toggleAt(line);
            } catch (_) {}
        });

        editor.getBreakpoints = () => {
            const res = [];
            try {
                const model = editor.getModel();
                const file = editor.filePath || editor.fileName;
                for (const id of editor.__breakpointDecos) {
                    const r = model.getDecorationRange(id);
                    if (r) res.push({ file, line: r.startLineNumber });
                }
            } catch (_) {}
            return res;
        };
        editor.getBreakpointLines = () => {
            const res = [];
            try {
                const model = editor.getModel();
                for (const id of editor.__breakpointDecos) {
                    const r = model.getDecorationRange(id);
                    if (r) res.push(r.startLineNumber);
                }
            } catch (_) {}
            return res;
        };

        editor.highlightLine = (line) => {
            try {
                const remove = editor.__execDeco ? [editor.__execDeco] : [];
                const add = [{
                    range: new monaco.Range(line, 1, line, 1),
                    options: { isWholeLine: true, className: 'debug-exec-line' }
                }];
                const [id] = editor.deltaDecorations(remove, add);
                editor.__execDeco = id;
                if (typeof editor.revealLineInCenterIfOutsideViewport === 'function') {
                    editor.revealLineInCenterIfOutsideViewport(line);
                } else {
                    editor.revealLineInCenter(line, monaco.editor.ScrollType.Smooth);
                }
            } catch (e) { logWarn('高亮执行行失败:', e); }
        };
        editor.clearExecHighlight = () => {
            try {
                if (editor.__execDeco) {
                    editor.deltaDecorations([editor.__execDeco], []);
                    editor.__execDeco = null;
                }
            } catch (_) {}
        };
    }

    getCurrentContent() {
        if (this.currentEditor) {
            try {
                return this.currentEditor.getValue();
            } catch (error) {
                logError('获取编辑器内容失败:', error);
                return null;
            }
        }
        return null;
    }

    getFileNameFromPath(filePath) {
        if (!filePath) return 'untitled';
        const parts = filePath.split(/[\\/]/);
        return parts[parts.length - 1];
    }

    getLanguageFromFileName(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();
        switch (ext) {
            case 'cpp':
            case 'cc':
            case 'cxx':
            case 'c++':
                return 'cpp';
            case 'c':
                return 'c';
            case 'h':
            case 'hpp':
                return 'cpp';
            case 'js':
                return 'javascript';
            case 'ts':
                return 'typescript';
            case 'py':
                return 'python';
            case 'java':
                return 'java';
            case 'html':
                return 'html';
            case 'css':
                return 'css';
            case 'json':
                return 'json';
            case 'xml':
                return 'xml';
            case 'md':
                return 'markdown';
            default:
                return 'plaintext';
        }
    }

    async switchTab(tabId) {
        const groupId = this.tabIdToGroupId.get(tabId) || 'group-1';
        const editorArea = this.getGroupContainer(groupId);
        if (!editorArea) return;

        const containers = editorArea.querySelectorAll('.monaco-editor-container');
        containers.forEach(c => (c.style.display = 'none'));

        let targetContainer = this.tabIdToContainer.get(tabId) || null;
        if (targetContainer && targetContainer.parentElement !== editorArea) {
            editorArea.appendChild(targetContainer);
        }
        if (!targetContainer) {
            targetContainer = editorArea.querySelector(`[data-tab-id="${tabId}"]`);
            if (targetContainer) {
                this.tabIdToContainer.set(tabId, targetContainer);
            }
        }

        if (targetContainer) {
            targetContainer.style.display = 'block';
            const editor = this.editors.get(tabId);
            if (editor) {
                const isDiff = !!editor.__isDiffEditor;
                this.currentEditor = (isDiff && editor.getModifiedEditor) ? editor.getModifiedEditor() : editor;

                const filePath = this.tabIdToFilePath.get(tabId) || (isDiff ? (editor.__diffMeta?.modifiedPath || editor.__diffMeta?.originalPath) : null);
                if (filePath) {
                    this.currentFilePath = filePath;
                    this.currentFileName = this.getFileNameFromPath(filePath);
                } else {
                    this.currentFilePath = null;
                    this.currentFileName = isDiff ? (editor.__diffMeta?.label || editor.fileName || 'diff') : (editor.fileName || 'untitled');
                }

                editor.layout();
                this.groupActiveTab.set(groupId, tabId);
            } else {
                logError('未在 editors Map 中找到对应的编辑器实例:', tabId);
            }
        } else {
            logError('未找到目标编辑器容器:', tabId);
        }
    }

    generateTabId(fileName, filePath) {
        try {
            if (filePath) {
                const normalized = filePath.replace(/\\/g, '/');
                let hash = 0x811c9dc5;
                for (let i = 0; i < normalized.length; i++) {
                    hash ^= normalized.charCodeAt(i);
                    hash = (hash >>> 0) * 0x01000193; // FNV prime
                }
                const hex = (hash >>> 0).toString(16).padStart(8, '0');
                const baseName = this.getFileNameFromPath(normalized) || fileName || 'untitled';
                const readable = baseName
                    .replace(/[\r\n\t]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .replace(/["'`<>]/g, '_')
                    .slice(0, 40);
                return `${readable}__${hex}`;
            }
            const rand = Math.random().toString(36).slice(2, 8);
            const safeName = (fileName || 'untitled')
                .replace(/[\r\n\t]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .replace(/["'`<>]/g, '_')
                .slice(0, 30);
            return `${safeName}__${rand}`;
        } catch (_) { return fileName || 'untitled'; }
    }

    updateTabFilePath(tabId, newPath) {
        try {
            if (!tabId || !newPath) return;
            this.tabIdToFilePath.set(tabId, newPath);
            const ed = this.editors.get(tabId);
            if (ed) {
                ed.filePath = newPath;
                ed.getFilePath = () => ed.filePath || newPath;
                try {
                    const model = ed.getModel ? ed.getModel() : null;
                    if (model) {
                        model.__oicppFilePath = newPath;
                    }
                } catch (_) {}
            }
            if (this.currentEditor === ed) {
                this.currentFilePath = newPath;
                this.currentFileName = this.getFileNameFromPath(newPath);
            }
        } catch (e) { logWarn('updateTabFilePath 失败:', e); }
    }

    getSelectedText(fileName) {
        if (this.currentEditor) {
            const selection = this.currentEditor.getSelection();
            return this.currentEditor.getModel().getValueInRange(selection);
        }
        return '';
    }

    insertText(fileName, text) {
        if (this.currentEditor) {
            const position = this.currentEditor.getPosition();
            this.currentEditor.executeEdits('insert-text', [{
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                text: text
            }]);
        }
    }

    async saveFile(fileName) {
        if (this.currentEditor) {
            const content = this.currentEditor.getValue();
            const filePath = this.currentEditor.filePath || this.currentFilePath;
            if (filePath && window.electronIPC) {
                window.electronIPC.send('save-file', filePath, content);
                const handleFileSaved = (event, savedPath, error) => {
                    if (savedPath === filePath) {
                        if (error) {
                            logError('保存失败:', error);
                        } else {
                            this.markFileSaved(filePath);
                        }
                        window.electronIPC.ipcRenderer.removeListener('file-saved', handleFileSaved);
                    }
                };
                window.electronIPC.on('file-saved', handleFileSaved);
            } else {
                logWarn('无法保存: 无文件路径或非Electron环境');
            }
        }
    }

    markFileSaved(filePath) {
        if (window.tabManager) {
            const fileName = this.getFileNameFromPath(filePath);
            window.tabManager.markTabAsSaved(fileName);
        }
    }

    cleanupEditor(tabId) {
        logInfo('清理编辑器:', tabId);
        
        const editor = this.editors.get(tabId);
        if (editor) {
            editor.dispose();
            this.editors.delete(tabId);
        }
        
        const container = this.tabIdToContainer.get(tabId);
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        
        this.tabIdToFilePath.delete(tabId);
        const groupId = this.tabIdToGroupId.get(tabId);
        if (groupId && this.groupActiveTab.get(groupId) === tabId) {
            this.groupActiveTab.set(groupId, null);
        }
        this.tabIdToGroupId.delete(tabId);
        this.tabIdToContainer.delete(tabId);

        const diffEntry = this.diffEditors.get(tabId);
        if (diffEntry) {
            try { diffEntry.originalModel?.dispose?.(); } catch (_) { }
            try { diffEntry.modifiedModel?.dispose?.(); } catch (_) { }
            this.diffEditors.delete(tabId);
        }
        
        const modifiedEditor = editor?.getModifiedEditor ? editor.getModifiedEditor() : null;
        if (this.currentEditor === editor || this.currentEditor === modifiedEditor) {
            this.currentEditor = null;
            this.currentFilePath = null;
            this.currentFileName = null;
        }
    }

    async createDiffEditor(tabId, options = {}) {
        try {
            const existing = this.editors.get(tabId);
            if (existing && existing.__isDiffEditor) {
                return this.showDiffEditor(tabId, options);
            }

            const groupId = options.groupId || options.targetGroupId || 'group-1';
            const editorArea = this.getGroupContainer(groupId);
            if (!editorArea) {
                logError('未找到编辑器区域，无法创建 Diff 视图');
                return null;
            }

            editorArea.querySelectorAll('.monaco-editor-container').forEach(c => (c.style.display = 'none'));

            const container = document.createElement('div');
            container.className = 'monaco-editor-container diff-editor-container';
            container.dataset.tabId = tabId;
            container.dataset.groupId = groupId;
            container.style.width = '100%';
            container.style.height = '100%';
            editorArea.appendChild(container);

            if (typeof monaco === 'undefined') {
                await this.waitForMonaco();
            }

            const originalPath = options.originalPath || '';
            const modifiedPath = options.modifiedPath || '';
            const originalFileName = this.getFileNameFromPath(originalPath) || options.label || 'original';
            const modifiedFileName = this.getFileNameFromPath(modifiedPath) || options.label || 'modified';
            const originalLanguage = this.getLanguageFromFileName(originalFileName);
            const modifiedLanguage = this.getLanguageFromFileName(modifiedFileName);

            const originalUri = originalPath
                ? monaco.Uri.file(originalPath)
                : monaco.Uri.parse(`inmemory://diff/${tabId}/original`);
            const modifiedUri = modifiedPath
                ? monaco.Uri.file(modifiedPath)
                : monaco.Uri.parse(`inmemory://diff/${tabId}/modified`);

            const originalModel = monaco.editor.createModel(options.originalContent || '', originalLanguage, originalUri);
            const modifiedModel = monaco.editor.createModel(options.modifiedContent || '', modifiedLanguage, modifiedUri);

            const diffEditor = monaco.editor.createDiffEditor(container, {
                renderSideBySide: true,
                automaticLayout: true,
                readOnly: false,
                originalEditable: false,
                enableSplitViewResizing: true,
                renderIndicators: true,
                diffCodeLens: true,
                useInlineViewWhenSpaceIsLimited: false,
                renderMarginRevertIcon: false
            });

            diffEditor.setModel({ original: originalModel, modified: modifiedModel });

            diffEditor.__isDiffEditor = true;
            diffEditor.__diffMeta = {
                originalPath,
                modifiedPath,
                label: options.label || modifiedFileName || originalFileName
            };
            diffEditor.filePath = modifiedPath || originalPath || null;
            diffEditor.fileName = options.label || `${originalFileName} vs ${modifiedFileName}`;

            diffEditor.getValue = () => {
                try {
                    const model = diffEditor.getModel?.();
                    return model?.modified?.getValue?.() || '';
                } catch (_) { return ''; }
            };

            diffEditor.setValue = (val) => {
                try {
                    const model = diffEditor.getModel?.();
                    if (model?.modified?.setValue) {
                        model.modified.setValue(val);
                    }
                } catch (_) { }
            };

            this.editors.set(tabId, diffEditor);
            this.diffEditors.set(tabId, { originalModel, modifiedModel });
            this.tabIdToContainer.set(tabId, container);
            this.tabIdToGroupId.set(tabId, groupId);
            this.tabIdToFilePath.set(tabId, diffEditor.filePath || null);
            this.groupActiveTab.set(groupId, tabId);

            this.currentEditor = diffEditor.getModifiedEditor ? diffEditor.getModifiedEditor() : diffEditor;
            this.currentFilePath = diffEditor.filePath || null;
            this.currentFileName = diffEditor.fileName || 'diff';

            return diffEditor;
        } catch (error) {
            logError('创建 Diff 编辑器失败:', error);
            return null;
        }
    }

    async showDiffEditor(tabId, options = {}) {
        try {
            const editor = this.editors.get(tabId);
            if (!editor || !editor.__isDiffEditor) {
                if (options && Object.keys(options).length > 0) {
                    return await this.createDiffEditor(tabId, options);
                }
                return null;
            }

            const groupId = options.groupId || this.tabIdToGroupId.get(tabId) || 'group-1';
            const editorArea = this.getGroupContainer(groupId);
            if (!editorArea) {
                logError('未找到目标编辑器区域，无法显示 Diff 视图');
                return null;
            }

            editorArea.querySelectorAll('.monaco-editor-container').forEach(c => (c.style.display = 'none'));

            const container = this.tabIdToContainer.get(tabId) || null;
            if (container) {
                if (container.parentElement !== editorArea) {
                    editorArea.appendChild(container);
                }
                container.style.display = 'block';
            }

            editor.layout();
            this.currentEditor = editor.getModifiedEditor ? editor.getModifiedEditor() : editor;
            const diffMeta = editor.__diffMeta || {};
            this.currentFilePath = diffMeta.modifiedPath || diffMeta.originalPath || this.tabIdToFilePath.get(tabId) || null;
            this.currentFileName = diffMeta.label || this.getFileNameFromPath(this.currentFilePath) || 'diff';
            this.tabIdToGroupId.set(tabId, groupId);
            this.groupActiveTab.set(groupId, tabId);
            return editor;
        } catch (error) {
            logError('显示 Diff 编辑器失败:', error);
            return null;
        }
    }

    updateSettings(settings) {
        if (this.currentEditor && settings) {
            const updateOptions = {};
            let targetFontSize = null;
            if (settings.fontSize !== undefined) {
                const fontSize = parseInt(settings.fontSize, 10);
                if (!Number.isNaN(fontSize)) {
                    updateOptions.fontSize = fontSize;
                    targetFontSize = fontSize;
                }
            } else {
                try {
                    targetFontSize = this.currentEditor.getOptions().get(monaco.editor.EditorOption.fontSize);
                } catch (_) { }
            }

            if (settings.lineHeight !== undefined) {
                const parsedLineHeight = parseInt(settings.lineHeight, 10);
                this.lineHeightSetting = !Number.isNaN(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : 0;
            }

            if (targetFontSize !== null || settings.lineHeight !== undefined) {
                updateOptions.lineHeight = this.getLineHeightValue(targetFontSize, this.lineHeightSetting);
            }
            
            if (settings.fontFamily) {
                if (window.fontDetector) {
                    updateOptions.fontFamily = window.fontDetector.validateFont(settings.fontFamily);
                } else {
                    updateOptions.fontFamily = settings.fontFamily;
                }
            } else if (settings.font) {
                if (window.fontDetector) {
                    updateOptions.fontFamily = window.fontDetector.validateFont(settings.font);
                } else {
                    updateOptions.fontFamily = settings.font;
                }
            }
            
            if (settings.tabSize !== undefined) {
                const parsedTabSize = parseInt(settings.tabSize, 10);
                if (!Number.isNaN(parsedTabSize) && parsedTabSize > 0) {
                    updateOptions.tabSize = parsedTabSize;
                }
            }
            
            if (settings.wordWrap !== undefined) {
                updateOptions.wordWrap = settings.wordWrap ? 'on' : 'off';
            }
            if (settings.foldingEnabled !== undefined) {
                updateOptions.folding = !!settings.foldingEnabled;
            }
            if (settings.stickyScrollEnabled !== undefined) {
                updateOptions.stickyScroll = { enabled: !!settings.stickyScrollEnabled };
            }
            if (settings.fontLigaturesEnabled !== undefined) {
                updateOptions.fontLigatures = !!settings.fontLigaturesEnabled;
            }
            if (settings.fontLigaturesEnabled !== undefined) {
                updateOptions.fontLigatures = !!settings.fontLigaturesEnabled;
            }

            if (settings.enableAutoCompletion !== undefined) {
                const enabled = settings.enableAutoCompletion !== false;
                updateOptions.quickSuggestions = enabled ? true : false;
                updateOptions.suggestOnTriggerCharacters = enabled ? true : false;
                updateOptions.wordBasedSuggestions = enabled ? 'matchingDocuments' : 'off';
                updateOptions.tabCompletion = enabled ? 'on' : 'off';
                updateOptions.acceptSuggestionOnEnter = enabled ? 'on' : 'off';
                updateOptions.parameterHints = { enabled };

                if (!enabled) {
                    this.disableEnhancedCompletionProviders();
                } else {
                    this.registerEnhancedCompletionProvider(this.currentEditor);
                }
            }
            
            this.currentEditor.updateOptions(updateOptions);
            setTimeout(() => {
                if (this.currentEditor && this.currentEditor.layout) {
                    this.currentEditor.layout();
                    setTimeout(() => {
                        this.currentEditor.layout();
                        this.currentEditor.trigger('source', 'editor.action.fontZoomReset');
                    }, 50);
                }
            }, 100);
        }
    }
    
    
    async newFile(fileName) {
        logInfo('MonacoEditorManager: 创建新文件:', fileName);
        
        if (!fileName) {
            fileName = this.generateNewFileName();
        }
        
        let defaultContent = '';
        if (fileName.endsWith('.cpp') || fileName.endsWith('.cc') || fileName.endsWith('.cxx')) {
            try {
                if (window.electronAPI && window.electronAPI.getAllSettings) {
                    const settings = await window.electronAPI.getAllSettings();
                    if (settings && settings.cppTemplate) {
                        defaultContent = settings.cppTemplate;
                    } else {
                        defaultContent = '';
                    }
                }
            } catch (error) {
                logWarn('获取设置模板失败，新建空文件。', error);
                defaultContent = '';
            }
        }
        
        if (window.tabManager) {
            await window.tabManager.openFile(fileName, defaultContent, true, null);
        } else {
            const tabId = this.generateTabId(fileName, null);
            await this.createNewEditor(tabId, fileName, defaultContent);
        }
        
        logInfo('新文件创建完成:', fileName);
    }
    
    generateNewFileName() {
        let counter = 1;
        let fileName = `untitled-${counter}.cpp`;
        
        while (window.tabManager && window.tabManager.tabs && window.tabManager.tabs.has(fileName)) {
            counter++;
            fileName = `untitled-${counter}.cpp`;
        }
        
        return fileName;
    }

    addWheelZoomListenerToEditorArea(editor) {
    const editorArea = document.querySelector('.editor-groups');
        if (!editorArea || editorArea.hasGlobalWheelZoomListener) {
            return;
        }
                
        editorArea.addEventListener('wheel', (e) => {
            
            if (e.ctrlKey && this.currentEditor) {
                e.preventDefault();
                e.stopPropagation();
                               
                try {
                    const currentOptions = this.currentEditor.getOptions();
                    const currentFontSize = currentOptions.get(monaco.editor.EditorOption.fontSize);
                    let newFontSize = currentFontSize;
                    if (e.deltaY < 0) {
                        newFontSize = Math.min(currentFontSize + 1, 72);
                    } else {
                        newFontSize = Math.max(currentFontSize - 1, 8);
                    }
                                        
                    if (newFontSize !== currentFontSize) {
                        this.currentEditor.updateOptions({ 
                            fontSize: newFontSize,
                            lineHeight: this.getLineHeightValue(newFontSize, this.lineHeightSetting)
                        });
                        
                        if (window.electronAPI && window.electronAPI.updateSettings) {
                            window.electronAPI.updateSettings({ fontSize: newFontSize }).then(() => {
                            }).catch(err => {
                            });
                        } else {
                        }
                        
                        document.documentElement.style.setProperty('--editor-font-size', newFontSize + 'px');

                        setTimeout(() => {
                            this.currentEditor.layout();
                        }, 50);
                    } else {
                    }
                } catch (error) {
                }
            } else {
            }
        }, true); // 使用事件捕获模式
        
    editorArea.hasGlobalWheelZoomListener = true;
    }

    addWheelZoomListener(editor, container) {        
        if (!container || container.hasWheelZoomListener) {
            return; // 避免重复添加
        }
        let wheelRAF = null;
        let pendingDeltaY = 0;
    const wheelHandler = (e) => {
            if (e.ctrlKey) {
                e.preventDefault(); 
                pendingDeltaY += e.deltaY;
                if (wheelRAF) return;
                wheelRAF = requestAnimationFrame(() => {
                    try {
                        const delta = pendingDeltaY;
                        pendingDeltaY = 0;
                        wheelRAF = null;
                        const currentOptions = editor.getOptions();
                        const currentFontSize = currentOptions.get(monaco.editor.EditorOption.fontSize);
                        let step = delta < 0 ? 1 : -1;
                        let newFontSize = Math.max(8, Math.min(72, currentFontSize + step));
                        if (newFontSize !== currentFontSize) {
                            editor.updateOptions({ 
                                fontSize: newFontSize,
                                lineHeight: this.getLineHeightValue(newFontSize, this.lineHeightSetting)
                            });
                            if (window.electronAPI?.updateSettings) {
                                window.electronAPI.updateSettings({ fontSize: newFontSize }).catch(err => {
                                    logError('[字体调整] 更新字体大小设置失败:', err);
                                });
                            }
                            document.documentElement.style.setProperty('--editor-font-size', newFontSize + 'px');
                            setTimeout(() => { editor.layout(); }, 50);
                        }
                    } catch (error) {
                        logError('[字体调整] 调整字体大小时发生错误:', error);
                        wheelRAF = null;
                        pendingDeltaY = 0;
                    }
                });
            } 
        };
        container.addEventListener('wheel', wheelHandler, { capture: true, passive: false });
        try {
            const dom = editor.getDomNode && editor.getDomNode();
            if (dom && !dom._wheelZoomHooked) {
                dom.addEventListener('wheel', wheelHandler, { capture: true, passive: false });
                dom._wheelZoomHooked = true;
            }
        } catch (_) {}
        
    container.hasWheelZoomListener = true;
    }

    updateAllEditorsSettings(settings) {
               
        this.updateSettings(settings);
        
    this.editors.forEach((editor, fileName) => {
            if (editor && editor !== this.currentEditor) {
                const updateOptions = {};
                let targetFontSize = null;
                if (settings.fontSize !== undefined) {
                    const fontSize = parseInt(settings.fontSize, 10);
                    if (!Number.isNaN(fontSize)) {
                        updateOptions.fontSize = fontSize;
                        targetFontSize = fontSize;
                    }
                } else {
                    try {
                        targetFontSize = editor.getOptions().get(monaco.editor.EditorOption.fontSize);
                    } catch (_) { }
                }

                if (settings.lineHeight !== undefined) {
                    const parsedLineHeight = parseInt(settings.lineHeight, 10);
                    this.lineHeightSetting = !Number.isNaN(parsedLineHeight) && parsedLineHeight > 0 ? parsedLineHeight : 0;
                }

                if (targetFontSize !== null || settings.lineHeight !== undefined) {
                    updateOptions.lineHeight = this.getLineHeightValue(targetFontSize, this.lineHeightSetting);
                }
                if (settings.fontFamily || settings.font) {
                    const fontToValidate = settings.fontFamily || settings.font;
                    if (window.fontDetector) {
                        updateOptions.fontFamily = window.fontDetector.validateFont(fontToValidate);
                    } else {
                        updateOptions.fontFamily = fontToValidate;
                    }
                }
                if (settings.tabSize !== undefined) {
                    const parsedTabSize = parseInt(settings.tabSize, 10);
                    if (!Number.isNaN(parsedTabSize) && parsedTabSize > 0) {
                        updateOptions.tabSize = parsedTabSize;
                    }
                }
                if (settings.wordWrap !== undefined) {
                    updateOptions.wordWrap = settings.wordWrap ? 'on' : 'off';
                }
                if (settings.foldingEnabled !== undefined) {
                    updateOptions.folding = !!settings.foldingEnabled;
                }
                if (settings.stickyScrollEnabled !== undefined) {
                    updateOptions.stickyScroll = { enabled: !!settings.stickyScrollEnabled };
                }
                if (settings.fontLigaturesEnabled !== undefined) {
                    updateOptions.fontLigatures = !!settings.fontLigaturesEnabled;
                }

                if (settings.enableAutoCompletion !== undefined) {
                    const enabled = settings.enableAutoCompletion !== false;
                    updateOptions.quickSuggestions = enabled ? true : false;
                    updateOptions.suggestOnTriggerCharacters = enabled ? true : false;
                    updateOptions.wordBasedSuggestions = enabled ? 'matchingDocuments' : 'off';
                    updateOptions.tabCompletion = enabled ? 'on' : 'off';
                    updateOptions.acceptSuggestionOnEnter = enabled ? 'on' : 'off';
                    updateOptions.parameterHints = { enabled };
                }

                
                try {
                    editor.updateOptions(updateOptions); 
                    const editorContainer = document.querySelector(`[data-tab-id="${fileName}"]`);
                    if (editorContainer) {
                        this.addWheelZoomListener(editor, editorContainer);
                    }
                    
                    setTimeout(() => {
                        if (editor && editor.layout) {
                            editor.layout();
                                                        
                            setTimeout(() => {
                                editor.layout();
                                editor.trigger('source', 'editor.action.fontZoomReset');
                            }, 50);
                        }
                    }, 100);
                } catch (error) {
                    logError(`更新编辑器 ${fileName} 设置失败:`, error);
                }
            }
        });

        if (settings && settings.enableAutoCompletion !== undefined) {
            const enabled = settings.enableAutoCompletion !== false;
            if (!enabled) {
                this.disableEnhancedCompletionProviders();
            } else {
                try {
                    if (this.currentEditor) {
                        this.registerEnhancedCompletionProvider(this.currentEditor);
                    }
                } catch (_) {}
            }
        }
        
        if (settings.theme !== undefined && typeof monaco !== 'undefined' && monaco.editor) {
            let newTheme = 'oicpp-dark';
            if (settings.theme === 'light') newTheme = 'oicpp-light';
            else if (settings.theme === 'dark') newTheme = 'oicpp-dark';
            else newTheme = `oicpp-${settings.theme}`;
            
            try { monaco.editor.setTheme(newTheme); } catch (e) { logWarn('切换主题失败:', e); }
        }
    }

    disableEnhancedCompletionProviders() {
        try {
            if (!this.completionProviders) return;
            for (const [lang, disp] of this.completionProviders.entries()) {
                try { disp?.dispose?.(); } catch (_) { }
                this.completionProviders.delete(lang);
            }
        } catch (_) {
        }
    }

    async copyToClipboard(text) {
        let success = false;
        
        if (!success && window.electronAPI && typeof window.electronAPI.clipboardWriteText === 'function') {
            try {
                const result = await window.electronAPI.clipboardWriteText(text);
                if (result && result.success) {
                    logInfo('使用IPC API复制成功');
                    success = true;
                } else {
                    logWarn('IPC API复制失败:', result ? result.error : '未知错误');
                }
            } catch (ipcErr) {
                logWarn('IPC剪贴板写入失败:', ipcErr);
            }
        }
        
        if (!success && navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                logInfo('使用Clipboard API复制成功');
                success = true;
            } catch (clipboardErr) {
                logWarn('Clipboard API写入失败:', clipboardErr);
            }
        }
        
        if (!success) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '-9999px';
                textarea.style.opacity = '0';
                textarea.setAttribute('readonly', '');
                document.body.appendChild(textarea);
                
                textarea.select();
                textarea.setSelectionRange(0, text.length);
                
                const successful = document.execCommand('copy');
                document.body.removeChild(textarea);
                
                if (successful) {
                    logInfo('使用execCommand复制成功');
                    success = true;
                } else {
                    logWarn('execCommand复制失败');
                }
            } catch (execErr) {
                logError('execCommand复制出错:', execErr);
            }
        }
        
        if (!success) {
            logError('所有复制方法都失败了');
        }
        
        return success;
    }
    
    async readFromClipboard() {
        let text = null;
        
        if (!text && window.electronAPI && typeof window.electronAPI.clipboardReadText === 'function') {
            try {
                const result = await window.electronAPI.clipboardReadText();
                if (result && result.success && result.text) {
                    logInfo('使用IPC API读取剪贴板成功');
                    return result.text;
                } else {
                    logWarn('IPC API读取失败:', result ? result.error : '未知错误');
                }
            } catch (ipcErr) {
                logWarn('IPC剪贴板读取失败:', ipcErr);
            }
        }
        
        if (navigator.clipboard && navigator.clipboard.readText) {
            try {
                text = await navigator.clipboard.readText();
                if (text) {
                    logInfo('使用Clipboard API读取剪贴板成功');
                    return text;
                }
            } catch (clipboardErr) {
                logWarn('Clipboard API读取失败:', clipboardErr);
            }
        }
        
        try {
            const textarea = document.createElement('textarea');
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            textarea.style.top = '-9999px';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            
            textarea.focus();
            const successful = document.execCommand('paste');
            
            if (successful && textarea.value) {
                text = textarea.value;
                logInfo('使用execCommand读取剪贴板成功');
            }
            
            document.body.removeChild(textarea);
        } catch (execErr) {
            logWarn('execCommand读取剪贴板失败:', execErr);
        }
        
        if (!text) {
            logWarn('所有剪贴板读取方法都失败了');
        }
        
        return text || '';
    }

    async formatCode() {
        if (this.currentEditor && this.currentEditor.getModel) {
            try {
                logInfo('开始格式化代码...');
                
                const model = this.currentEditor.getModel();
                const language = model.getLanguageId();
                logInfo('当前文件语言:', language);
                
                if (language === 'cpp' || language === 'c') {
                    return await this.formatCppCode();
                }
                
                const formatAction = this.currentEditor.getAction('editor.action.formatDocument');
                if (formatAction) {
                    await formatAction.run();
                    logInfo('代码格式化完成');
                    return true;
                } 
            } catch (error) {
                logError('代码格式化失败:', error);
            }
        } else {
            logWarn('当前没有可用的编辑器实例');
            return false;
        }
    }

    async formatCppCode() {
        try {
            const model = this.currentEditor.getModel();
            const content = model.getValue();

            const opts = this.currentEditor.getOptions();
            const tabSize = opts.get(monaco.editor.EditorOption.tabSize) || 4;
            const insertSpaces = opts.get(monaco.editor.EditorOption.insertSpaces);

            let formattedContent = content;
            if (window.cppFormatter && typeof window.cppFormatter.format === 'function') {
                formattedContent = window.cppFormatter.format(content, { tabSize, insertSpaces: !!insertSpaces });
            } else {
                formattedContent = content;
            }
            
            if (formattedContent !== content) {
                const range = model.getFullModelRange();
                const edit = {
                    range: range,
                    text: formattedContent
                };
                
                this.currentEditor.executeEdits('format', [edit]);
                return true;
            } else {
                return true;
            }
        } catch (error) {
            logError('C++代码格式化失败:', error);
            return false;
        }
    }

    
    registerEnhancedCompletionProvider(editor) {
        const language = editor.getModel().getLanguageId();
        if (language !== 'cpp' && language !== 'c') {
            return;
        }
        if (this.completionProviders.has(language)) {
            return;
        }

        const disposable = monaco.languages.registerCompletionItemProvider(language, {
            provideCompletionItems: async (model, position) => {
                if (!Array.isArray(this.userSnippets) || this.userSnippets.length === 0) {
                    try { await this.loadUserSnippets(); } catch (_) {}
                }
                const suggestions = [];
                const seen = new Set(); // 去重: label+kind
                const word = model.getWordUntilPosition(position);
                const range = {
                    startLineNumber: position.lineNumber,
                    endLineNumber: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn
                };
                
                const code = model.getValue();
                
                if (this.isInComment(model, position)) {
                    return { suggestions: [] };
                }

                try {
                    const lineText = model.getLineContent(position.lineNumber);
                    const prefix = lineText.slice(0, position.column - 1);
                    const trimmed = prefix.trimStart();
                    if (trimmed.startsWith('#')) {
                        const afterHash = trimmed.slice(1).trim();
                        const directives = [
                            { label: '#include', insertText: '#include ${1:<header>}' },
                            { label: '#define', insertText: '#define ${1:NAME} ${2:value}' },
                            { label: '#undef', insertText: '#undef ${1:NAME}' },
                            { label: '#if', insertText: '#if ${1:COND}' },
                            { label: '#ifdef', insertText: '#ifdef ${1:NAME}' },
                            { label: '#ifndef', insertText: '#ifndef ${1:NAME}' },
                            { label: '#elif', insertText: '#elif ${1:COND}' },
                            { label: '#else', insertText: '#else' },
                            { label: '#endif', insertText: '#endif' },
                            { label: '#pragma', insertText: '#pragma ${1:once}' },
                            { label: '#error', insertText: '#error ${1:message}' },
                            { label: '#warning', insertText: '#warning ${1:message}' }
                        ];
                        directives.forEach(d => {
                            const item = {
                                label: d.label,
                                kind: monaco.languages.CompletionItemKind.Keyword,
                                insertText: d.insertText,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                range
                            };
                            const key = `${item.label}#${item.kind}`;
                            if (!seen.has(key)) { seen.add(key); suggestions.push(item); }
                        });

                        if (/^#\s*include\b/.test(trimmed)) {
                            const headerStd = [
                                'bits/stdc++.h','iostream','vector','algorithm','map','set','unordered_map','unordered_set','string','queue','stack','deque','list','array','tuple','utility','bitset','bit','numeric','functional','iomanip','sstream','fstream','cstdio','cstdlib','cstring','cmath','climits','cctype','cassert','limits','chrono','random'
                            ];
                            const lastLt = prefix.lastIndexOf('<');
                            const lastQt = prefix.lastIndexOf('"');
                            const useAngle = lastLt > lastQt;
                            const startCol = (useAngle ? lastLt : lastQt) + 2;
                            const hdrRange = {
                                startLineNumber: position.lineNumber,
                                endLineNumber: position.lineNumber,
                                startColumn: Math.max(startCol, range.startColumn),
                                endColumn: range.endColumn
                            };

                            headerStd.forEach(h => {
                                const label = h;
                                const item = {
                                    label,
                                    kind: monaco.languages.CompletionItemKind.File,
                                    insertText: label,
                                    range: hdrRange,
                                    detail: '标准头文件'
                                };
                                const key = `${item.label}#${item.kind}`;
                                if (!seen.has(key)) { seen.add(key); suggestions.push(item); }
                            });

                            try {
                                const root = window.sidebarManager?.panels?.files?.currentPath || window.sidebarManager?.panels?.files?.workspacePath || '';
                                if (root && window.electronAPI?.walkDirectory) {
                                    if (!this._headerCache || this._headerCache.root !== root) {
                                        const res = await window.electronAPI.walkDirectory(root, { extensions: ['.h','.hpp'], excludeGlobs: ['node_modules','.git','.oicpp','.vscode'] });
                                        this._headerCache = { root, files: (res && res.success && Array.isArray(res.files)) ? res.files : [] };
                                    }
                                    const hdrs = this._headerCache.files || [];
                                    hdrs.slice(0, 300).forEach(f => {
                                        const name = f.name || '';
                                        if (!name) return;
                                        const item = {
                                            label: name,
                                            kind: monaco.languages.CompletionItemKind.File,
                                            insertText: name,
                                            range: hdrRange,
                                            detail: f.path || '本地头文件'
                                        };
                                        const key = `${item.label}#${item.kind}`;
                                        if (!seen.has(key)) { seen.add(key); suggestions.push(item); }
                                    });
                                }
                            } catch (e) { /* 忽略头文件索引错误 */ }
                        }
                    }
                } catch (_) {}

                const currentPrefix = model.getValueInRange({
                    startLineNumber: position.lineNumber,
                    startColumn: Math.max(1, word.startColumn),
                    endLineNumber: position.lineNumber,
                    endColumn: word.endColumn
                }) || '';
                if (Array.isArray(this.userSnippets) && this.userSnippets.length) {
                    const matched = [];
                    const others = [];
                    for (const sn of this.userSnippets) {
                        const label = String(sn.keyword || '').trim();
                        const content = String(sn.content || '');
                        if (!label) continue;
                        const item = {
                            label,
                            kind: monaco.languages.CompletionItemKind.Snippet,
                            insertText: content,
                            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                            documentation: sn.description ? { value: sn.description } : undefined,
                            detail: sn.description || '用户代码片段',
                            range
                        };
                        const key = `${item.label}#${item.kind}`;
                        if (seen.has(key)) continue;
                        if (label.toLowerCase().startsWith(currentPrefix.toLowerCase())) {
                            item.sortText = '0000_' + label;
                            matched.push(item);
                        } else {
                            item.sortText = 'zzzz_' + label;
                            others.push(item);
                        }
                        seen.add(key);
                    }
                    if (matched.length > 0) {
                        matched[0].preselect = true;
                    }
                    suggestions.push(...matched, ...others);
                }
                
                const functions = this.parseFunctions(code);
                functions.forEach(func => {
                    const item = {
                        label: func.name,
                        kind: monaco.languages.CompletionItemKind.Function,
                        insertText: func.name + '(${1})',
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        documentation: {
                            value: `**${func.returnType} ${func.name}(${func.params})**\n\n${func.description || '函数声明'}`
                        },
                        detail: `${func.returnType} ${func.name}(${func.params})`,
                        range: range
                    };
                    const key = `${item.label}#${item.kind}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        suggestions.push(item);
                    }
                });
                
                const structs = this.parseStructsAndClasses(code);
                structs.forEach(struct => {
                    const item = {
                        label: struct.name,
                        kind: struct.type === 'class' ? monaco.languages.CompletionItemKind.Class : monaco.languages.CompletionItemKind.Struct,
                        insertText: struct.name,
                        documentation: {
                            value: `**${struct.type} ${struct.name}**\n\n${struct.members.length > 0 ? '成员:\n' + struct.members.join('\n') : ''}${struct.description ? '\n\n' + struct.description : ''}`
                        },
                        detail: `${struct.type} ${struct.name}`,
                        range: range
                    };
                    const key = `${item.label}#${item.kind}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        suggestions.push(item);
                    }
                });
                
                const cppDataTypes = [
                    { label: 'int', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'int', detail: '32位有符号整数类型' },
                    { label: 'long', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'long', detail: '长整数类型' },
                    { label: 'long long', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'long long', detail: '64位长整数类型' },
                    { label: 'short', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'short', detail: '16位短整数类型' },
                    { label: 'char', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'char', detail: '字符类型' },
                    { label: 'bool', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'bool', detail: '布尔类型' },
                    { label: 'float', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'float', detail: '单精度浮点数类型' },
                    { label: 'double', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'double', detail: '双精度浮点数类型' },
                    { label: 'void', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'void', detail: '空类型' },
                    { label: 'size_t', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'size_t', detail: '无符号整数类型，用于表示大小' },
                    { label: 'unsigned', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'unsigned', detail: '无符号类型修饰符' },
                    { label: 'signed', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'signed', detail: '有符号类型修饰符' }
                ];

                const cppKeywords = [
                    { label: 'if', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'if', detail: '条件语句' },
                    { label: 'else', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'else', detail: '条件语句的else分支' },
                    { label: 'for', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'for', detail: '循环语句' },
                    { label: 'while', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'while', detail: '循环语句' },
                    { label: 'do', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'do', detail: 'do-while循环' },
                    { label: 'switch', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'switch', detail: '多分支选择语句' },
                    { label: 'case', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'case', detail: 'switch语句的分支' },
                    { label: 'default', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'default', detail: 'switch语句的默认分支' },
                    { label: 'break', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'break', detail: '跳出循环或switch' },
                    { label: 'continue', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'continue', detail: '继续下一次循环' },
                    { label: 'return', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'return', detail: '函数返回' },
                    { label: 'class', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'class', detail: '定义类' },
                    { label: 'struct', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'struct', detail: '定义结构体' },
                    { label: 'public', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'public', detail: '公有访问修饰符' },
                    { label: 'private', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'private', detail: '私有访问修饰符' },
                    { label: 'protected', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'protected', detail: '保护访问修饰符' },
                    { label: 'virtual', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'virtual', detail: '虚函数关键字' },
                    { label: 'const', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'const', detail: '常量修饰符' },
                    { label: 'static', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'static', detail: '静态修饰符' },
                    { label: 'inline', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'inline', detail: '内联函数修饰符' },
                    { label: 'namespace', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'namespace', detail: '命名空间' },
                    { label: 'using', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'using', detail: '使用声明' },
                    { label: 'typedef', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'typedef', detail: '类型定义' },
                    { label: 'template', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'template', detail: '模板关键字' },
                    { label: 'typename', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'typename', detail: '类型名关键字' },
                    { label: 'auto', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'auto', detail: '自动类型推导' },
                    { label: 'nullptr', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'nullptr', detail: '空指针常量' },
                    { label: 'new', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'new', detail: '动态内存分配' },
                    { label: 'delete', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'delete', detail: '释放动态内存' },
                    { label: 'try', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'try', detail: '异常处理' },
                    { label: 'catch', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'catch', detail: '捕获异常' },
                    { label: 'throw', kind: monaco.languages.CompletionItemKind.Keyword, insertText: 'throw', detail: '抛出异常' }
                ];

                const stdLibFunctions = [
                    { label: 'printf', kind: monaco.languages.CompletionItemKind.Function, insertText: 'printf("${1:format}", ${2:args});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'int printf(const char *format, ...); - 格式化输出' },
                    { label: 'scanf', kind: monaco.languages.CompletionItemKind.Function, insertText: 'scanf("${1:format}", ${2:&variable});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'int scanf(const char *format, ...); - 格式化输入' },
                    { label: 'malloc', kind: monaco.languages.CompletionItemKind.Function, insertText: 'malloc(${1:size});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'void* malloc(size_t size); - 分配内存' },
                    { label: 'free', kind: monaco.languages.CompletionItemKind.Function, insertText: 'free(${1:ptr});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'void free(void *ptr); - 释放内存' },
                    { label: 'strlen', kind: monaco.languages.CompletionItemKind.Function, insertText: 'strlen(${1:str});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'size_t strlen(const char *str); - 计算字符串长度' },
                    { label: 'strcpy', kind: monaco.languages.CompletionItemKind.Function, insertText: 'strcpy(${1:dest}, ${2:src});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'char* strcpy(char *dest, const char *src); - 复制字符串' },
                    { label: 'strcmp', kind: monaco.languages.CompletionItemKind.Function, insertText: 'strcmp(${1:str1}, ${2:str2});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'int strcmp(const char *str1, const char *str2); - 比较字符串' },
                    { label: 'memset', kind: monaco.languages.CompletionItemKind.Function, insertText: 'memset(${1:ptr}, ${2:value}, ${3:size});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'void* memset(void *ptr, int value, size_t size); - 设置内存值' },
                    { label: 'memcpy', kind: monaco.languages.CompletionItemKind.Function, insertText: 'memcpy(${1:dest}, ${2:src}, ${3:size});', insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet, detail: 'void* memcpy(void *dest, const void *src, size_t size); - 复制内存' }
                ];

                const stlFunctions = [
                    { label: 'sort', kind: monaco.languages.CompletionItemKind.Function, insertText: 'sort(${1:begin}, ${2:end})', detail: 'void sort(RandomAccessIterator first, RandomAccessIterator last); - 排序算法' },
                    { label: 'reverse', kind: monaco.languages.CompletionItemKind.Function, insertText: 'reverse(${1:begin}, ${2:end})', detail: 'void reverse(BidirectionalIterator first, BidirectionalIterator last); - 反转容器' },
                    { label: 'find', kind: monaco.languages.CompletionItemKind.Function, insertText: 'find(${1:begin}, ${2:end}, ${3:value})', detail: 'InputIterator find(InputIterator first, InputIterator last, const T& val); - 查找元素' },
                    { label: 'max', kind: monaco.languages.CompletionItemKind.Function, insertText: 'max(${1:a}, ${2:b})', detail: 'const T& max(const T& a, const T& b); - 返回较大值' },
                    { label: 'min', kind: monaco.languages.CompletionItemKind.Function, insertText: 'min(${1:a}, ${2:b})', detail: 'const T& min(const T& a, const T& b); - 返回较小值' },
                    { label: 'swap', kind: monaco.languages.CompletionItemKind.Function, insertText: 'swap(${1:a}, ${2:b})', detail: 'void swap(T& a, T& b); - 交换两个值' },
                    { label: 'push_back', kind: monaco.languages.CompletionItemKind.Method, insertText: 'push_back(${1:value})', detail: 'void push_back(const T& val); - 在容器末尾添加元素' },
                    { label: 'pop_back', kind: monaco.languages.CompletionItemKind.Method, insertText: 'pop_back()', detail: 'void pop_back(); - 删除容器末尾元素' },
                    { label: 'size', kind: monaco.languages.CompletionItemKind.Method, insertText: 'size()', detail: 'size_type size() const; - 返回容器大小' },
                    { label: 'empty', kind: monaco.languages.CompletionItemKind.Method, insertText: 'empty()', detail: 'bool empty() const; - 检查容器是否为空' },
                    { label: 'clear', kind: monaco.languages.CompletionItemKind.Method, insertText: 'clear()', detail: 'void clear(); - 清空容器' },
                    { label: 'begin', kind: monaco.languages.CompletionItemKind.Method, insertText: 'begin()', detail: 'iterator begin(); - 返回指向开始的迭代器' },
                    { label: 'end', kind: monaco.languages.CompletionItemKind.Method, insertText: 'end()', detail: 'iterator end(); - 返回指向结尾的迭代器' },
                    { label: 'insert', kind: monaco.languages.CompletionItemKind.Method, insertText: 'insert(${1:position}, ${2:value})', detail: 'iterator insert(iterator position, const T& val); - 插入元素' },
                    { label: 'erase', kind: monaco.languages.CompletionItemKind.Method, insertText: 'erase(${1:position})', detail: 'iterator erase(iterator position); - 删除元素' }
                ];

                const stlContainers = [
                    { label: 'vector', kind: monaco.languages.CompletionItemKind.Class, insertText: 'vector<${1:int}>', detail: 'STL动态数组容器' },
                    { label: 'string', kind: monaco.languages.CompletionItemKind.Class, insertText: 'string', detail: 'STL字符串类' },
                    { label: 'map', kind: monaco.languages.CompletionItemKind.Class, insertText: 'map<${1:int}, ${2:int}>', detail: 'STL关联容器（映射）' },
                    { label: 'set', kind: monaco.languages.CompletionItemKind.Class, insertText: 'set<${1:int}>', detail: 'STL集合容器' },
                    { label: 'pair', kind: monaco.languages.CompletionItemKind.Class, insertText: 'pair<${1:int}, ${2:int}>', detail: 'STL对容器' },
                    { label: 'queue', kind: monaco.languages.CompletionItemKind.Class, insertText: 'queue<${1:int}>', detail: 'STL队列容器' },
                    { label: 'stack', kind: monaco.languages.CompletionItemKind.Class, insertText: 'stack<${1:int}>', detail: 'STL栈容器' },
                    { label: 'priority_queue', kind: monaco.languages.CompletionItemKind.Class, insertText: 'priority_queue<${1:int}>', detail: 'STL优先队列容器' },
                    { label: 'list', kind: monaco.languages.CompletionItemKind.Class, insertText: 'list<${1:int}>', detail: 'STL双向链表容器' },
                    { label: 'deque', kind: monaco.languages.CompletionItemKind.Class, insertText: 'deque<${1:int}>', detail: 'STL双端队列容器' },
                    { label: 'unordered_map', kind: monaco.languages.CompletionItemKind.Class, insertText: 'unordered_map<${1:int}, ${2:int}>', detail: 'STL无序映射容器' },
                    { label: 'unordered_set', kind: monaco.languages.CompletionItemKind.Class, insertText: 'unordered_set<${1:int}>', detail: 'STL无序集合容器' }
                ];
                
                [...cppDataTypes, ...cppKeywords, ...stdLibFunctions, ...stlFunctions, ...stlContainers].forEach(item => {
                    const sug = {
                        ...item,
                        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                        range: range
                    };
                    const key = `${sug.label}#${sug.kind}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        suggestions.push(sug);
                    }
                });
                
                return { suggestions };
            }
        });
        this.completionProviders.set(language, disposable);
    }
    
    isInComment(model, position) {
        const lineContent = model.getLineContent(position.lineNumber);
        const beforeCursor = lineContent.substring(0, position.column - 1);
        
        const singleLineCommentIndex = beforeCursor.indexOf('//');
        if (singleLineCommentIndex !== -1) {
            return true;
        }
        
        const fullText = model.getValue();
        const offset = model.getOffsetAt(position);
        
        let inMultiLineComment = false;
        let i = 0;
        while (i < offset) {
            if (fullText.substring(i, i + 2) === '/*') {
                inMultiLineComment = true;
                i += 2;
            } else if (fullText.substring(i, i + 2) === '*/' && inMultiLineComment) {
                inMultiLineComment = false;
                i += 2;
            } else {
                i++;
            }
        }
        
        return inMultiLineComment;
    }

    parseFunctionsWithLocations(model) {
        const text = model.getValue();
        const regex = /(^|\n)\s*([\w:\<\>\~\*&\s]+?)\s+([A-Za-z_~][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?:const\s*)?(?:\{|;)/gm;
        const list = [];
        let m;
        while ((m = regex.exec(text)) !== null) {
            const signatureRet = (m[2] || '').trim();
            const name = (m[3] || '').trim();
            if (!name || ['if','while','for','switch','catch'].includes(name)) continue;
            const idx = m.index + (m[1] ? m[1].length : 0);
            const pos = model.getPositionAt(idx);
            list.push({
                name,
                returnType: signatureRet,
                params: (m[4] || '').trim() || 'void',
                position: pos,
                detail: `${signatureRet} ${name}(${(m[4]||'').trim()})`
            });
        }
        return list;
    }

    showFunctionPicker() {
        try {
            const editor = this.currentEditor;
            const model = editor?.getModel?.();
            if (!editor || !model) return;
            const funcs = this.parseFunctionsWithLocations(model);
            if (!funcs.length) {
                return;
            }

            let overlay = document.getElementById('oicpp-func-picker');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.id = 'oicpp-func-picker';
                overlay.style.position = 'fixed';
                overlay.style.left = '50%';
                overlay.style.top = '20%';
                overlay.style.transform = 'translateX(-50%)';
                overlay.style.zIndex = '10000';
                overlay.style.background = 'var(--bg, #1e1e1e)';
                overlay.style.color = '#ddd';
                overlay.style.border = '1px solid #555';
                overlay.style.borderRadius = '6px';
                overlay.style.boxShadow = '0 6px 24px rgba(0,0,0,.4)';
                overlay.style.width = 'min(700px, 90vw)';
                overlay.style.maxHeight = '60vh';
                overlay.style.display = 'flex';
                overlay.style.flexDirection = 'column';
                overlay.style.overflow = 'hidden';

                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = '输入函数名过滤，回车跳转，Esc关闭';
                input.style.padding = '10px 12px';
                input.style.fontSize = '14px';
                input.style.border = 'none';
                input.style.outline = 'none';
                input.style.background = 'transparent';
                input.style.color = 'inherit';
                input.style.borderBottom = '1px solid #444';

                const listEl = document.createElement('div');
                listEl.style.overflow = 'auto';
                listEl.style.maxHeight = '50vh';
                listEl.style.padding = '6px 0';

                overlay.appendChild(input);
                overlay.appendChild(listEl);
                document.body.appendChild(overlay);

                overlay._input = input;
                overlay._list = listEl;

                let active = 0, filtered = [];
                const render = () => {
                    listEl.innerHTML = '';
                    filtered.forEach((f, idx) => {
                        const row = document.createElement('div');
                        row.style.padding = '6px 12px';
                        row.style.cursor = 'pointer';
                        row.style.whiteSpace = 'nowrap';
                        row.style.textOverflow = 'ellipsis';
                        row.style.overflow = 'hidden';
                        row.style.background = idx === active ? 'rgba(128,128,128,.25)' : 'transparent';
                        row.textContent = `${f.name}  —  ${f.detail}`;
                        row.addEventListener('mouseenter', () => { active = idx; render(); });
                        row.addEventListener('click', () => choose(idx));
                        listEl.appendChild(row);
                    });
                };
                const choose = (idx) => {
                    const item = filtered[idx];
                    if (!item) return;
                    this.goToFunctionPosition(item.position);
                    close();
                };
                const close = () => {
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                    document.removeEventListener('keydown', keyHandler, true);
                };
                const keyHandler = (e) => {
                    if (!document.body.contains(overlay)) return;
                    if (e.key === 'Escape') { e.preventDefault(); close(); }
                    if (e.key === 'Enter') { e.preventDefault(); choose(active); }
                    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); render(); listEl.children[active]?.scrollIntoView({ block: 'nearest' }); }
                    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); render(); listEl.children[active]?.scrollIntoView({ block: 'nearest' }); }
                };
                document.addEventListener('keydown', keyHandler, true);

                input.addEventListener('input', () => {
                    const q = input.value.trim().toLowerCase();
                    filtered = q ? funcs.filter(f => f.name.toLowerCase().includes(q)) : funcs.slice();
                    active = filtered.length ? 0 : -1;
                    render();
                });

                filtered = funcs.slice();
                render();
                setTimeout(() => input.focus(), 0);
            } else {
                const input = overlay._input;
                const listEl = overlay._list;
                let active = 0;
                let filtered = funcs.slice();
                const render = () => {
                    listEl.innerHTML = '';
                    filtered.forEach((f, idx) => {
                        const row = document.createElement('div');
                        row.style.padding = '6px 12px';
                        row.style.cursor = 'pointer';
                        row.style.whiteSpace = 'nowrap';
                        row.style.textOverflow = 'ellipsis';
                        row.style.overflow = 'hidden';
                        row.style.background = idx === active ? 'rgba(128,128,128,.25)' : 'transparent';
                        row.textContent = `${f.name}  —  ${f.detail}`;
                        row.addEventListener('mouseenter', () => { active = idx; render(); });
                        row.addEventListener('click', () => choose(idx));
                        listEl.appendChild(row);
                    });
                };
                const choose = (idx) => {
                    const item = filtered[idx];
                    if (!item) return;
                    this.goToFunctionPosition(item.position);
                    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                };
                input.value = '';
                render();
                document.body.appendChild(overlay);
                setTimeout(() => input.focus(), 0);
            }
        } catch (e) {
            logWarn('显示函数跳转面板失败:', e);
        }
    }

    goToFunctionPosition(position) {
        try {
            const editor = this.currentEditor;
            if (!editor) return;
            editor.revealPositionInCenter(position, monaco.editor.ScrollType.Smooth);
            editor.setPosition(position);
            editor.focus();
        } catch (e) { logWarn('跳转函数失败:', e); }
    }

    async renameIdentifierAtCursor() {
        try {
            const editor = this.currentEditor;
            const model = editor?.getModel?.();
            if (!editor || !model) return;
            const pos = editor.getPosition();
            const word = model.getWordAtPosition(pos);
            const name = word?.word || '';
            if (!name) return;

            let newName = null;
            try {
                if (window.dialogManager?.showInputDialog) {
                    newName = await window.dialogManager.showInputDialog('重命名标识符', name, '输入新的名称');
                } else {
                    newName = window.prompt('重命名为:', name);
                }
            } catch (_) {}
            if (!newName || newName === name) return;

            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) {
                (window.logWarn||console.warn)('非法的标识符名称');
                return;
            }

            const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const matches = model.findMatches(`\\b${escaped}\\b`, true, true, true, null, true);
            const edits = [];
            for (const m of matches) {
                const centerPos = m.range.getStartPosition();
                if (this.isInComment(model, centerPos)) continue;
                edits.push({ range: m.range, text: newName });
            }
            if (!edits.length) return;
            editor.executeEdits('rename-identifier', edits);
        } catch (e) {
            logWarn('重命名失败:', e);
        }
    }

    setupCtrlClickNavigation(editor) {
        try {
            if (!editor || editor.__oicppCtrlNavBound) return;
            editor.__oicppCtrlNavBound = true;
            const domNode = typeof editor.getDomNode === 'function' ? editor.getDomNode() : null;
            const MouseTargetType = monaco?.editor?.MouseTargetType;
            let hoverDecorations = [];
            let hoverKey = null;

            const clearHover = () => {
                try {
                    if (hoverDecorations.length) {
                        hoverDecorations = editor.deltaDecorations(hoverDecorations, []);
                    }
                } catch (_) {}
                if (domNode) {
                    domNode.classList.remove('oicpp-ctrl-hover');
                }
                hoverKey = null;
            };

            editor.onMouseMove((e) => {
                try {
                    if (!e || !e.event) {
                        clearHover();
                        return;
                    }
                    if (!(e.event.ctrlKey || e.event.metaKey)) {
                        clearHover();
                        return;
                    }
                    if (MouseTargetType && e.target && ![MouseTargetType.CONTENT_TEXT, MouseTargetType.CONTENT_EMPTY].includes(e.target.type)) {
                        clearHover();
                        return;
                    }
                    const candidate = this.getCtrlClickCandidate(editor, e.target?.position);
                    if (!candidate || !candidate.range) {
                        clearHover();
                        return;
                    }
                    if (domNode) {
                        domNode.classList.add('oicpp-ctrl-hover');
                    }
                    const range = candidate.range;
                    const key = `${range.startLineNumber}:${range.startColumn}:${range.endLineNumber}:${range.endColumn}`;
                    if (hoverKey !== key) {
                        hoverDecorations = editor.deltaDecorations(hoverDecorations, [{
                            range,
                            options: { inlineClassName: 'oicpp-ctrl-link' }
                        }]);
                        hoverKey = key;
                    }
                } catch (_) {
                    clearHover();
                }
            });

            editor.onMouseLeave(() => clearHover());
            editor.onDidBlurEditorWidget(() => clearHover());
            if (typeof editor.onKeyUp === 'function') {
                editor.onKeyUp((e) => {
                    if (!e.ctrlKey && !e.metaKey) {
                        clearHover();
                    }
                });
            }
            editor.onDidDispose(() => clearHover());

            editor.onMouseDown((e) => {
                try {
                    if (!e || !e.event) return;
                    if (!(e.event.ctrlKey || e.event.metaKey)) return;
                    if (!e.event.leftButton) return;
                    const pos = e.target?.position;
                    if (!pos) return;
                    e.event.preventDefault?.();
                    e.event.stopPropagation?.();
                    Promise.resolve(this.handleCtrlClickNavigation(editor, pos)).finally(() => {
                        clearHover();
                    });
                } catch (_) {}
            });
        } catch (err) {
            logWarn('注册 Ctrl+单击跳转失败:', err);
        }
    }

    getCtrlClickCandidate(editor, position) {
        try {
            if (!editor || !position) return null;
            const model = editor.getModel ? editor.getModel() : null;
            if (!model) return null;
            const symbol = this.identifySymbolAtPosition(model, position);
            if (!symbol || !symbol.range) return null;
            return { range: symbol.range, symbol };
        } catch (err) {
            logWarn('获取 Ctrl+单击候选失败:', err);
            return null;
        }
    }

    identifySymbolAtPosition(model, position) {
        try {
            if (!model || !position) return null;
            const lineText = model.getLineContent(position.lineNumber) || '';
            const trimmedLine = lineText.trimStart();
            if (trimmedLine.startsWith('#')) {
                const directiveMatch = trimmedLine.match(/^#\s*([A-Za-z_]+)/);
                if (directiveMatch) {
                    const directive = directiveMatch[1];
                    const directiveLower = directive.toLowerCase();
                    const leadingWhitespace = lineText.length - trimmedLine.length;
                    const directiveIndex = trimmedLine.indexOf(directive);
                    const directiveStartColumn = leadingWhitespace + directiveIndex + 1;
                    const directiveEndColumn = directiveStartColumn + directive.length;
                    if (position.column >= directiveStartColumn && position.column <= directiveEndColumn + 1) {
                        return null;
                    }
                    if (this.getPreprocessorKeywordSet().has(directiveLower)) {
                        const wordRange = new monaco.Range(position.lineNumber, directiveStartColumn, position.lineNumber, directiveEndColumn);
                        if (wordRange.containsPosition(position)) {
                            return null;
                        }
                    }
                }
            }
            const includeMatch = lineText.match(/#\s*include\s*([<"])([^>"]+)[>"]/);
            if (includeMatch) {
                const header = includeMatch[2];
                const startIndex = lineText.indexOf(header);
                if (startIndex >= 0) {
                    const startColumn = startIndex + 1;
                    const endColumn = startColumn + header.length;
                    if (position.column >= startColumn && position.column <= endColumn + 1) {
                        const range = new monaco.Range(position.lineNumber, startColumn, position.lineNumber, endColumn);
                        return { kind: 'include', path: header, isAngle: includeMatch[1] === '<', range, lineText };
                    }
                }
            }
            const wordInfo = model.getWordAtPosition(position);
            if (!wordInfo || !wordInfo.word) return null;
            const word = wordInfo.word;
            if (!word || /^[0-9]+$/.test(word)) return null;
            const wordLower = word.toLowerCase();
            const disallowed = [
                'if','while','for','switch','case','return','else','break','continue','sizeof','static','const','struct','class','enum','typedef',
                'using','namespace','std','auto','void','int','long','short','char','float','double','bool','signed','unsigned','template','typename',
                'this','new','delete','public','private','protected','virtual','override','final','constexpr','inline','operator','friend','volatile',
                'mutable','alignas','alignof','nullptr','true','false','goto','do','default','try','catch','throw',
                'define','include','ifdef','ifndef','endif','elif','pragma','undef','line','error','warning'
            ];
            if (disallowed.includes(wordLower)) return null;
            const range = new monaco.Range(position.lineNumber, wordInfo.startColumn, position.lineNumber, wordInfo.endColumn);
            return { kind: 'symbol', word, range, lineText };
        } catch (err) {
            logWarn('identifySymbolAtPosition 失败:', err);
            return null;
        }
    }

    findDefinitionInModel(model, word, options = {}) {
        try {
            if (!model || !word) return null;
            const lines = model.getLinesContent();
            const def = this.findDefinitionInLines(lines, word, options);
            if (def) {
                const position = new monaco.Position(def.lineNumber, def.column);
                const range = new monaco.Range(def.lineNumber, def.column, def.lineNumber, def.column + word.length);
                return { position, range, kind: def.kind };
            }

            const fallback = this.findFallbackOccurrence(model, word, options);
            if (fallback) {
                return fallback;
            }

            return null;
        } catch (err) {
            logWarn('findDefinitionInModel 失败:', err);
            return null;
        }
    }

    findDefinitionInLines(lines, word, options = {}) {
        try {
            if (!Array.isArray(lines) || !word) return null;

            const skip = options.skipLine;
            const skipSet = new Set();
            if (Array.isArray(skip)) {
                skip.forEach(n => {
                    const num = Number(n);
                    if (!Number.isNaN(num)) skipSet.add(num);
                });
            } else if (Number.isFinite(skip)) {
                skipSet.add(Number(skip));
            }

            const content = lines.join('\n');
            if (!content || !content.includes(word)) return null;
            const masked = this.maskCommentsAndStrings(content);
            const lineOffsets = this.buildLineOffsets(lines);
            const wordLength = word.length;
            const occurrences = [];

            let index = masked.indexOf(word);
            while (index !== -1) {
                if (!this.isWordBoundary(masked, index, wordLength)) {
                    index = masked.indexOf(word, index + wordLength);
                    continue;
                }

                const location = this.indexToLineColumn(index, lineOffsets);
                if (location && !skipSet.has(location.lineNumber)) {
                    const classification = this.classifyOccurrence(masked, index, wordLength, options);
                    if (classification) {
                        occurrences.push({
                            index,
                            lineNumber: location.lineNumber,
                            column: location.column,
                            kind: classification.kind,
                            priority: classification.priority
                        });
                    }
                }

                index = masked.indexOf(word, index + wordLength);
            }

            if (!occurrences.length) return null;

            occurrences.sort((a, b) => {
                if (a.priority !== b.priority) return a.priority - b.priority;
                return a.index - b.index;
            });

            const best = occurrences[0];
            return best ? { lineNumber: best.lineNumber, column: best.column, kind: best.kind } : null;
        } catch (err) {
            logWarn('findDefinitionInLines 失败:', err);
            return null;
        }
    }

    findFallbackOccurrence(model, word, options = {}) {
        try {
            if (!model || !word) return null;
            const escaped = this.escapeRegExp(word);
            if (!escaped) return null;

            const skipSet = new Set();
            const skip = options.skipLine;
            if (Array.isArray(skip)) {
                skip.forEach((n) => {
                    const num = Number(n);
                    if (!Number.isNaN(num)) {
                        skipSet.add(num);
                    }
                });
            } else if (Number.isFinite(skip)) {
                skipSet.add(Number(skip));
            }

            const matches = model.findMatches(`\\b${escaped}\\b`, false, true, true, null, false);
            if (!Array.isArray(matches) || !matches.length) {
                return null;
            }

            for (const match of matches) {
                if (!match || !match.range) {
                    continue;
                }
                const range = match.range;
                const line = range.startLineNumber;
                if (skipSet.has(line)) {
                    continue;
                }
                const startPos = range.getStartPosition ? range.getStartPosition() : new monaco.Position(line, range.startColumn);
                if (this.isInComment(model, startPos)) {
                    continue;
                }
                return {
                    position: startPos,
                    range: new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn),
                    kind: 'fallback'
                };
            }

            return null;
        } catch (err) {
            logWarn('findFallbackOccurrence 失败:', err);
            return null;
        }
    }

    maskCommentsAndStrings(text) {
        if (typeof text !== 'string' || !text.length) return '';
        const chars = Array.from(text);
        let i = 0;
        let inBlockComment = false;
        let stringDelimiter = null;

        while (i < chars.length) {
            const ch = chars[i];

            if (inBlockComment) {
                if (ch === '*' && chars[i + 1] === '/') {
                    chars[i] = ' ';
                    chars[i + 1] = ' ';
                    inBlockComment = false;
                    i += 2;
                    continue;
                }
                if (ch !== '\n') {
                    chars[i] = ' ';
                }
                i += 1;
                continue;
            }

            if (stringDelimiter) {
                if (ch === '\\') {
                    if (ch !== '\n') chars[i] = ' ';
                    if (i + 1 < chars.length && chars[i + 1] !== '\n') chars[i + 1] = ' ';
                    i += 2;
                    continue;
                }
                if (ch === stringDelimiter) {
                    chars[i] = ' ';
                    stringDelimiter = null;
                    i += 1;
                    continue;
                }
                if (ch !== '\n') {
                    chars[i] = ' ';
                }
                i += 1;
                continue;
            }

            if (ch === '/' && chars[i + 1] === '*') {
                chars[i] = ' ';
                chars[i + 1] = ' ';
                inBlockComment = true;
                i += 2;
                continue;
            }

            if (ch === '/' && chars[i + 1] === '/') {
                chars[i] = ' ';
                chars[i + 1] = ' ';
                i += 2;
                while (i < chars.length && chars[i] !== '\n') {
                    chars[i] = ' ';
                    i += 1;
                }
                continue;
            }

            if (ch === '"' || ch === '\'') {
                stringDelimiter = ch;
                chars[i] = ' ';
                i += 1;
                continue;
            }

            i += 1;
        }

        return chars.join('');
    }

    buildLineOffsets(lines) {
        const offsets = [];
        if (!Array.isArray(lines)) return offsets;
        let total = 0;
        for (const line of lines) {
            offsets.push(total);
            total += (line ? line.length : 0) + 1;
        }
        return offsets;
    }

    indexToLineColumn(index, offsets) {
        if (!Array.isArray(offsets) || index < 0) return null;
        let low = 0;
        let high = offsets.length - 1;
        let lineIndex = offsets.length - 1;

        while (low <= high) {
            const mid = (low + high) >> 1;
            const offset = offsets[mid];
            if (offset <= index) {
                lineIndex = mid;
                low = mid + 1;
            } else {
                high = mid - 1;
            }
        }

        const lineOffset = offsets[lineIndex] || 0;
        return {
            lineNumber: lineIndex + 1,
            column: index - lineOffset + 1
        };
    }

    isIdentifierChar(ch) {
        if (!ch) return false;
        return /[0-9A-Za-z_]/.test(ch);
    }

    isWordBoundary(text, index, length) {
        const prev = index > 0 ? text[index - 1] : '';
        const next = text[index + length] || '';
        return !this.isIdentifierChar(prev) && !this.isIdentifierChar(next);
    }

    skipWhitespace(text, index) {
        let i = index || 0;
        while (i < text.length) {
            const ch = text[i];
            if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
                i += 1;
            } else {
                break;
            }
        }
        return i;
    }

    findMatchingParen(text, openIndex) {
        if (!text || openIndex < 0 || text[openIndex] !== '(') return -1;
        let depth = 0;
        for (let i = openIndex; i < text.length; i++) {
            const ch = text[i];
            if (ch === '(') depth += 1;
            else if (ch === ')') {
                depth -= 1;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    findMatchingAngles(text, openIndex) {
        if (!text || openIndex < 0 || text[openIndex] !== '<') return -1;
        let depth = 0;
        for (let i = openIndex; i < text.length; i++) {
            const ch = text[i];
            if (ch === '<') depth += 1;
            else if (ch === '>') {
                depth -= 1;
                if (depth === 0) {
                    return i;
                }
            }
        }
        return -1;
    }

    skipAttributes(text, index) {
        if (!text || index < 0 || text[index] !== '[' || text[index + 1] !== '[') return index;
        let i = index + 2;
        while (i < text.length) {
            if (text[i] === '[' && text[i + 1] === '[') {
                i = this.skipAttributes(text, i);
                continue;
            }
            if (text[i] === ']' && text[i + 1] === ']') {
                return i + 2;
            }
            i += 1;
        }
        return i;
    }

    skipArrowReturnType(text, index) {
        let i = this.skipWhitespace(text, index);
        while (i < text.length) {
            const ch = text[i];
            if (ch === '{' || ch === ';' || ch === ':' || ch === '=') {
                return i;
            }
            if (ch === '(') {
                const match = this.findMatchingParen(text, i);
                if (match === -1) return i;
                i = match + 1;
                continue;
            }
            if (ch === '<') {
                const match = this.findMatchingAngles(text, i);
                if (match === -1) return i;
                i = match + 1;
                continue;
            }
            i += 1;
        }
        return i;
    }

    skipTrailingQualifiers(text, index) {
        let i = this.skipWhitespace(text, index);
        while (i < text.length) {
            if (this.startsWithWord(text, i, 'const')) {
                i = this.skipWhitespace(text, i + 5);
                continue;
            }
            if (this.startsWithWord(text, i, 'volatile')) {
                i = this.skipWhitespace(text, i + 8);
                continue;
            }
            if (this.startsWithWord(text, i, 'constexpr')) {
                i = this.skipWhitespace(text, i + 9);
                continue;
            }
            if (this.startsWithWord(text, i, 'noexcept')) {
                i = this.skipWhitespace(text, i + 8);
                continue;
            }
            if (this.startsWithWord(text, i, 'override')) {
                i = this.skipWhitespace(text, i + 8);
                continue;
            }
            if (this.startsWithWord(text, i, 'final')) {
                i = this.skipWhitespace(text, i + 5);
                continue;
            }
            if (this.startsWithWord(text, i, 'requires')) {
                i = this.skipWhitespace(text, i + 8);
                while (i < text.length && text[i] !== '{' && text[i] !== ';' && text[i] !== ':' && text[i] !== '=') {
                    if (text[i] === '(') {
                        const match = this.findMatchingParen(text, i);
                        if (match === -1) break;
                        i = match + 1;
                        continue;
                    }
                    if (text[i] === '[' && text[i + 1] === '[') {
                        i = this.skipAttributes(text, i);
                        continue;
                    }
                    if (text[i] === '<') {
                        const match = this.findMatchingAngles(text, i);
                        if (match === -1) break;
                        i = match + 1;
                        continue;
                    }
                    i += 1;
                }
                continue;
            }
            if (text[i] === '[' && text[i + 1] === '[') {
                i = this.skipAttributes(text, i);
                i = this.skipWhitespace(text, i);
                continue;
            }
            if (text[i] === '-' && text[i + 1] === '>') {
                i = this.skipArrowReturnType(text, i + 2);
                i = this.skipWhitespace(text, i);
                continue;
            }
            break;
        }
        return i;
    }

    startsWithWord(text, index, word) {
        if (!text || typeof word !== 'string' || !word.length) return false;
        if (!text.startsWith(word, index)) return false;
        const before = index > 0 ? text[index - 1] : '';
        const after = text[index + word.length] || '';
        return !this.isIdentifierChar(before) && !this.isIdentifierChar(after);
    }

    getPreprocessorKeywordSet() {
        if (!this._preprocessorKeywordSet) {
            this._preprocessorKeywordSet = new Set([
                'define','include','ifdef','ifndef','endif','elif','pragma','undef','line','error','warning'
            ]);
        }
        return this._preprocessorKeywordSet;
    }

    getControlKeywordSet() {
        if (!this._controlKeywordSet) {
            this._controlKeywordSet = new Set([
                'return','if','else','switch','case','for','while','do','goto','break','continue','throw','catch',
                'try','co_return','co_await','co_yield'
            ]);
        }
        return this._controlKeywordSet;
    }

    getTypeKeywordRegex() {
        if (!this._typeKeywordRegex) {
            this._typeKeywordRegex = /\b(?:auto|void|int|long|short|signed|unsigned|float|double|char|bool|wchar_t|char16_t|char32_t|size_t|ssize_t|ptrdiff_t|constexpr|inline|static|extern|friend|virtual|typename|class|struct|enum|using|mutable|volatile|template|decltype|union)\b/;
        }
        return this._typeKeywordRegex;
    }

    extractBeforeSegment(text, index) {
        const windowStart = Math.max(0, index - 400);
        const snippet = text.slice(windowStart, index);
        let delimiter = -1;
        [';', '{', '}', '\n'].forEach(token => {
            const pos = snippet.lastIndexOf(token);
            if (pos > delimiter) delimiter = pos;
        });
        return snippet.slice(delimiter + 1).trim();
    }

    hasTypeBefore(text, index) {
        const segment = this.extractBeforeSegment(text, index);
        if (!segment) return false;

        if (this.getTypeKeywordRegex().test(segment)) {
            return true;
        }

        if (/[*&>)]\s*$/.test(segment)) {
            return true;
        }

        const identifierMatch = segment.match(/([A-Za-z_][A-Za-z0-9_:<>]*)\s*$/);
        if (identifierMatch) {
            const candidate = identifierMatch[1];
            if (!this.getControlKeywordSet().has(candidate.toLowerCase())) {
                return true;
            }
        }

        if (segment.endsWith('::')) {
            const beforeScope = segment.slice(0, -2).trim();
            if (!beforeScope) {
                return false;
            }
            if (this.getTypeKeywordRegex().test(beforeScope)) {
                return true;
            }
            const scopeIdentifierMatch = beforeScope.match(/([A-Za-z_][A-Za-z0-9_:<>]*)\s*$/);
            if (scopeIdentifierMatch) {
                const scopeCandidate = scopeIdentifierMatch[1];
                if (!this.getControlKeywordSet().has(scopeCandidate.toLowerCase())) {
                    return true;
                }
            }
            if (this.getControlKeywordSet().has(beforeScope.toLowerCase())) {
                return false;
            }
            if (/\b[A-Za-z_][A-Za-z0-9_:<>]*\s+$/.test(beforeScope)) {
                return true;
            }
            return false;
        }

        return false;
    }

    prefixIndicatesCall(prefix, hasTypeContext) {
        const trimmed = (prefix || '').trim();
        if (!trimmed) {
            return !hasTypeContext;
        }
        if (trimmed.endsWith('.')) {
            return true;
        }
        if (trimmed.endsWith('->')) {
            return true;
        }
        if (trimmed.endsWith('::')) {
            return !hasTypeContext;
        }
        return false;
    }

    classifyOccurrence(masked, index, wordLength, options = {}) {
        const lineStart = masked.lastIndexOf('\n', index - 1) + 1;
        const lineEndRaw = masked.indexOf('\n', index);
        const lineEnd = lineEndRaw === -1 ? masked.length : lineEndRaw;
        const lineText = masked.slice(lineStart, lineEnd);
        const prefix = lineText.slice(0, index - lineStart);

        if (/^\s*#\s*define\b/.test(lineText)) {
            return { kind: 'macro', priority: 15 };
        }

        if (/\b(struct|class|enum)\b/.test(prefix)) {
            return { kind: 'struct', priority: 5 };
        }

        if (!options.skipTypedef) {
            const typedefSlice = masked.slice(Math.max(0, index - 200), index);
            if (/\btypedef\b/.test(typedefSlice)) {
                return { kind: 'typedef', priority: 7 };
            }
        }

        let pos = this.skipWhitespace(masked, index + wordLength);
        if (masked[pos] === '(') {
            const closing = this.findMatchingParen(masked, pos);
            if (closing !== -1) {
                let after = this.skipWhitespace(masked, closing + 1);
                after = this.skipTrailingQualifiers(masked, after);
                const charAfter = masked[after];

                if (charAfter === '{' || charAfter === ':') {
                    return { kind: 'function', priority: 0 };
                }

                if (charAfter === '=') {
                    const eqNext = this.skipWhitespace(masked, after + 1);
                    if (this.startsWithWord(masked, eqNext, 'default') || this.startsWithWord(masked, eqNext, 'delete')) {
                        return { kind: 'function', priority: 0 };
                    }
                    if (this.startsWithWord(masked, eqNext, '0')) {
                        const hasTypeContext = this.hasTypeBefore(masked, index);
                        if (hasTypeContext) {
                            return { kind: 'function-declaration', priority: 9 };
                        }
                        return null;
                    }
                }

                if (charAfter === ';' || charAfter === ',' || charAfter === ')') {
                    const hasTypeContext = this.hasTypeBefore(masked, index);
                    const callLike = this.prefixIndicatesCall(prefix, hasTypeContext);
                    if (callLike) {
                        return null;
                    }
                    if (hasTypeContext) {
                        return { kind: 'function-declaration', priority: 9 };
                    }
                    return null;
                }

                if (typeof charAfter === 'undefined') {
                    return { kind: 'function', priority: 0 };
                }
            }
        }

        if (masked[pos] === '[' && masked[pos + 1] === '[') {
            pos = this.skipAttributes(masked, pos);
        }

        const segment = this.extractBeforeSegment(masked, index);

        const nextChar = masked[pos];
        if (nextChar === '{') {
            if (!this.hasTypeBefore(masked, index)) {
                return null;
            }
            if (/\bextern\b/.test(segment)) {
                return { kind: 'variable-declaration', priority: 12 };
            }
            return { kind: 'variable', priority: 11 };
        }

        if (nextChar === '[') {
            if (!this.hasTypeBefore(masked, index)) {
                return null;
            }
            if (/\bextern\b/.test(segment)) {
                return { kind: 'variable-declaration', priority: 12 };
            }
            return { kind: 'variable', priority: 11 };
        }

        if (nextChar === ':' && masked[pos + 1] !== ':') {
            if (/\bextern\b/.test(segment)) {
                return { kind: 'variable-declaration', priority: 12 };
            }
            if (!this.hasTypeBefore(masked, index)) {
                return null;
            }
            return { kind: 'variable', priority: 11 };
        }

        if (nextChar === '=' || nextChar === ';' || nextChar === ',') {
            if (/\bextern\b/.test(segment)) {
                return { kind: 'variable-declaration', priority: 12 };
            }
            return { kind: 'variable', priority: 11 };
        }

        return null;
    }

    escapeRegExp(text) {
        return typeof text === 'string' ? text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
    }

    async getIncludedFilePaths(model) {
        try {
            if (!model) return [];
            const versionId = typeof model.getVersionId === 'function' ? model.getVersionId() : null;
            const cache = model.__oicppIncludeCache;
            if (cache && cache.versionId === versionId && cache.token === this._includeCacheToken && Array.isArray(cache.paths)) {
                return cache.paths;
            }

            const lines = typeof model.getLinesContent === 'function' ? model.getLinesContent() : [];
            if (!Array.isArray(lines) || !lines.length) {
                model.__oicppIncludeCache = { versionId, token: this._includeCacheToken, paths: [] };
                return [];
            }

            const includePaths = new Set();
            const modelFilePath = this.getModelFilePath(model);
            const modelDir = modelFilePath ? await this.safeDirname(modelFilePath) : null;
            for (const line of lines) {
                if (!line || typeof line !== 'string' || !line.includes('#include')) continue;
                const regex = /#\s*include\s*([<"])([^>"]+)[>"]/g;
                let match;
                while ((match = regex.exec(line)) !== null) {
                    const delimiter = match[1];
                    const header = (match[2] || '').trim();
                    if (!header) continue;
                    let resolved = null;
                    if (delimiter === '"') {
                        resolved = await this.resolveIncludeTarget(
                            { path: header, isAngle: false },
                            {
                                baseDir: modelDir || undefined,
                                filePath: modelFilePath || undefined,
                                cacheKey: modelDir ? `local::${modelDir}::${header}` : undefined
                            }
                        );
                    } else {
                        resolved = await this.resolveSystemHeader(header);
                    }
                    if (resolved) {
                        includePaths.add(resolved);
                    }
                }
            }

            const paths = Array.from(includePaths);
            model.__oicppIncludeCache = { versionId, token: this._includeCacheToken, paths };
            return paths;
        } catch (err) {
            logWarn('getIncludedFilePaths 失败:', err);
            return [];
        }
    }

    getTabIdByFilePath(filePath) {
        if (!filePath || typeof filePath !== 'string') return null;
        try {
            for (const [tabId, storedPath] of this.tabIdToFilePath.entries()) {
                if (storedPath === filePath) {
                    return tabId;
                }
            }
        } catch (_) {}
        return null;
    }

    async findDefinitionInFile(word, filePath) {
        try {
            if (!word || !filePath) return null;
            const tabId = this.getTabIdByFilePath(filePath);
            if (tabId) {
                const editor = this.editors.get(tabId);
                const model = editor?.getModel?.();
                if (model) {
                    const def = this.findDefinitionInModel(model, word);
                    if (def?.position) {
                        return { filePath, position: def.position };
                    }
                }
            }

            if (window.electronAPI?.readFileContent) {
                const content = await window.electronAPI.readFileContent(filePath);
                if (typeof content === 'string' && content.includes(word)) {
                    const lines = content.split(/\r?\n/);
                    const def = this.findDefinitionInLines(lines, word);
                    if (def) {
                        const position = new monaco.Position(def.lineNumber, def.column);
                        return { filePath, position };
                    }
                }
            }
            return null;
        } catch (err) {
            logWarn('findDefinitionInFile 失败:', err);
            return null;
        }
    }

    async findDefinitionInIncludes(symbol, model, includePaths) {
        try {
            if (!symbol || symbol.kind !== 'symbol') return null;
            const word = symbol.word;
            if (!word) return null;
            const initialPaths = Array.isArray(includePaths) && includePaths.length
                ? includePaths
                : await this.getIncludedFilePaths(model);
            if (!initialPaths || !initialPaths.length) return null;

            const visited = new Set();
            const queue = [];
            const maxDepth = 5;

            for (const filePath of initialPaths) {
                if (!filePath) continue;
                queue.push({ filePath, depth: 0 });
            }

            while (queue.length) {
                const { filePath, depth } = queue.shift();
                if (!filePath || visited.has(filePath)) continue;
                visited.add(filePath);

                const result = await this.findDefinitionInFile(word, filePath);
                if (result && result.position) {
                    return result;
                }

                if (depth >= maxDepth) continue;
                const includes = await this.getIncludesFromFile(filePath);
                if (!includes || !includes.length) continue;

                const baseDir = await this.safeDirname(filePath);
                for (const inc of includes) {
                    let resolved = null;
                    if (inc.isAngle) {
                        resolved = await this.resolveSystemHeader(inc.path);
                    } else {
                        resolved = await this.resolveIncludeTarget(
                            { path: inc.path, isAngle: false },
                            {
                                baseDir: baseDir || undefined,
                                filePath,
                                cacheKey: baseDir ? `local::${baseDir}::${inc.path}` : undefined,
                                allowWorkspaceScan: false
                            }
                        );
                    }
                    if (resolved && !visited.has(resolved)) {
                        queue.push({ filePath: resolved, depth: depth + 1 });
                    }
                }
            }
            return null;
        } catch (err) {
            logWarn('findDefinitionInIncludes 失败:', err);
            return null;
        }
    }

    async handleCtrlClickNavigation(editor, position) {
        try {
            const model = editor?.getModel?.();
            if (!model) return;
            const symbol = this.identifySymbolAtPosition(model, position);
            if (!symbol) return;
            const modelFilePath = this.getModelFilePath(model);
            const modelDir = modelFilePath ? await this.safeDirname(modelFilePath) : null;

            if (symbol.kind === 'include') {
                let targetPath = null;
                if (symbol.isAngle) {
                    targetPath = await this.resolveSystemHeader(symbol.path);
                } else {
                    targetPath = await this.resolveIncludeTarget(symbol, {
                        baseDir: modelDir || undefined,
                        filePath: modelFilePath || undefined
                    });
                }
                if (targetPath) {
                    await this.openFileAtPosition(targetPath, new monaco.Position(1, 1));
                } else {
                    logWarn('未找到头文件:', symbol.path);
                }
                return;
            }

            const local = this.findDefinitionInModel(model, symbol.word, { skipLine: position.lineNumber });
            if (local) {
                this.goToMonacoPosition(editor, local.position);
                return;
            }

            const includeDef = await this.findDefinitionInIncludes(symbol, model);
            if (includeDef && includeDef.filePath && includeDef.position) {
                await this.openFileAtPosition(includeDef.filePath, includeDef.position);
                return;
            }

            logWarn('未找到符号定义:', symbol.word);
        } catch (err) {
            logWarn('Ctrl+单击跳转失败:', err);
        }
    }

    async resolveSystemHeader(header) {
        try {
            if (!header) return null;
            if (!(this._includePathCache instanceof Map)) {
                this._includePathCache = new Map();
            }
            const cacheKey = `sys::${header}`;
            if (this._includePathCache.has(cacheKey)) {
                return this._includePathCache.get(cacheKey);
            }

            const includeDirs = await this.getCompilerIncludeDirs();
            if (!Array.isArray(includeDirs) || !includeDirs.length) {
                this._includePathCache.set(cacheKey, null);
                return null;
            }

            const normalized = String(header).trim().replace(/\\/g, '/').replace(/^\/+/g, '');
            if (!normalized) {
                this._includePathCache.set(cacheKey, null);
                return null;
            }
            const parts = normalized.split('/').filter(Boolean);
            if (!parts.length) {
                this._includePathCache.set(cacheKey, null);
                return null;
            }

            const candidateRoots = new Set();
            for (const dir of includeDirs) {
                if (!dir) continue;
                const roots = await this.getIncludeSearchRoots(dir);
                for (const root of roots) {
                    if (!root) continue;
                    candidateRoots.add(root);
                    const direct = await this.joinPath(root, ...parts);
                    if (direct && await this.pathExists(direct)) {
                        this._includePathCache.set(cacheKey, direct);
                        return direct;
                    }
                }
            }

            const fileName = parts[parts.length - 1];
            if (fileName) {
                for (const root of candidateRoots) {
                    const located = await this.searchHeaderByFileName(root, fileName, parts);
                    if (located) {
                        this._includePathCache.set(cacheKey, located);
                        return located;
                    }
                }
            }

            this._includePathCache.set(cacheKey, null);
            return null;
        } catch (err) {
            logWarn('resolveSystemHeader 失败:', err);
            return null;
        }
    }

    async getCompilerIncludeDirs() {
        try {
            const { compilerPath, compilerArgs } = await this.getCompilerSettingsSnapshot();
            if (!compilerPath) {
                return [];
            }

            if (this._compilerIncludeDirsCache && this._compilerIncludeDirsCache.compilerPath === compilerPath && Array.isArray(this._compilerIncludeDirsCache.dirs) && this._compilerIncludeDirsCache.dirs.length) {
                return this._compilerIncludeDirsCache.dirs;
            }

            if (this._compilerIncludeDirsPromise) {
                return await this._compilerIncludeDirsPromise;
            }

            const promise = this.buildCompilerIncludeDirs(compilerPath, compilerArgs)
                .then((dirs) => {
                    const unique = Array.from(new Set((dirs || []).filter(Boolean)));
                    this._compilerIncludeDirsCache = { compilerPath, dirs: unique };
                    this._compilerIncludeDirsPromise = null;
                    return unique;
                })
                .catch((error) => {
                    logWarn('获取编译器头文件目录失败:', error);
                    this._compilerIncludeDirsPromise = null;
                    return [];
                });

            this._compilerIncludeDirsPromise = promise;
            return await promise;
        } catch (err) {
            logWarn('getCompilerIncludeDirs 异常:', err);
            return [];
        }
    }

    async buildCompilerIncludeDirs(compilerPath, compilerArgs) {
        try {
            const dirs = new Set();
            const visited = new Set();
            const addDir = async (dir) => {
                if (!dir || typeof dir !== 'string') return;
                if (visited.has(dir)) return;
                visited.add(dir);
                if (await this.pathExists(dir)) {
                    dirs.add(dir);
                }
            };

            const compilerDir = await this.safeDirname(compilerPath);
            const rootDir = compilerDir ? await this.safeDirname(compilerDir) : null;
            const workspaceRoot = window.sidebarManager?.panels?.files?.workspacePath || '';

            const includeArgDirs = await this.extractIncludeDirsFromArgs(compilerArgs, compilerDir, rootDir, workspaceRoot);
            for (const dir of includeArgDirs) {
                await addDir(dir);
            }

            if (compilerDir) {
                await addDir(await this.joinPath(compilerDir, 'include'));
                await addDir(await this.joinPath(compilerDir, '..', 'include'));
            }
            if (rootDir) {
                await addDir(await this.joinPath(rootDir, 'include'));
                await addDir(await this.joinPath(rootDir, 'include', 'c++'));
            }
            if (workspaceRoot) {
                await addDir(workspaceRoot);
            }

            const gccRoots = [];
            if (rootDir) {
                gccRoots.push(await this.joinPath(rootDir, 'lib', 'gcc'));
            }
            if (compilerDir) {
                gccRoots.push(await this.joinPath(compilerDir, '..', 'lib', 'gcc'));
            }
            for (const gccRoot of gccRoots) {
                await this.collectGccIncludeDirs(gccRoot, addDir);
            }

            const clangRoots = [];
            if (rootDir) {
                clangRoots.push(await this.joinPath(rootDir, 'lib', 'clang'));
            }
            if (compilerDir) {
                clangRoots.push(await this.joinPath(compilerDir, '..', 'lib', 'clang'));
            }
            for (const clangRoot of clangRoots) {
                if (!clangRoot) continue;
                if (!(await this.pathExists(clangRoot))) continue;
                const clangVersions = await this.listSubdirectories(clangRoot);
                for (const clangDir of clangVersions) {
                    await addDir(await this.joinPath(clangDir, 'include'));
                }
            }

            if (rootDir) {
                const tripletDirs = await this.listSubdirectories(rootDir);
                for (const triplet of tripletDirs) {
                    const name = (triplet.split(/[\\\/]/).pop() || '').toLowerCase();
                    if (!name) continue;
                    if (name.includes('mingw') || name.includes('msys') || name.includes('w64') || /^[a-z0-9_-]+-[a-z0-9_-]+-[a-z0-9_-]+$/.test(name)) {
                        await addDir(await this.joinPath(triplet, 'include'));
                        const tripletCxxRoot = await this.joinPath(triplet, 'include', 'c++');
                        await addDir(tripletCxxRoot);
                        const cxxDirs = await this.listSubdirectories(tripletCxxRoot);
                        for (const cxxDir of cxxDirs) {
                            await addDir(cxxDir);
                        }
                    }
                }
            }

            const platform = (window.process && typeof window.process.platform === 'string') ? window.process.platform : (await window.electronAPI?.getPlatform?.());
            if (platform === 'linux' || platform === 'darwin') {
                await addDir('/usr/include');
                await addDir('/usr/local/include');
            }
            if (platform === 'darwin') {
                await addDir('/Library/Developer/CommandLineTools/usr/include/c++/v1');
                await addDir('/Applications/Xcode.app/Contents/Developer/Toolchains/XcodeDefault.xctoolchain/usr/include/c++/v1');
            }

            return Array.from(dirs);
        } catch (err) {
            logWarn('buildCompilerIncludeDirs 失败:', err);
            return [];
        }
    }

    async collectGccIncludeDirs(gccRoot, addDir) {
        try {
            if (!gccRoot || typeof addDir !== 'function') return;
            if (!(await this.pathExists(gccRoot))) return;
            const targetDirs = await this.listSubdirectories(gccRoot);
            for (const targetDir of targetDirs) {
                const versionDirs = await this.listSubdirectories(targetDir);
                for (const versionDir of versionDirs) {
                    await addDir(await this.joinPath(versionDir, 'include'));
                    await addDir(await this.joinPath(versionDir, 'include-fixed'));
                    const cxxRoot = await this.joinPath(versionDir, 'include', 'c++');
                    await addDir(cxxRoot);
                    const cxxVersionDirs = await this.listSubdirectories(cxxRoot);
                    for (const cxxDir of cxxVersionDirs) {
                        await addDir(cxxDir);
                    }
                }
            }
        } catch (err) {
            logWarn('collectGccIncludeDirs 失败:', err);
        }
    }

    async extractIncludeDirsFromArgs(compilerArgs, compilerDir, rootDir, workspaceRoot) {
        try {
            if (!compilerArgs || typeof compilerArgs !== 'string') return [];
            const tokens = this.tokenizeCompilerArgs(compilerArgs);
            if (!tokens.length) return [];
            const result = [];
            const baseCandidates = [compilerDir, rootDir, workspaceRoot].filter(Boolean);

            const pushPath = async (rawPath) => {
                const trimmed = this.stripQuotes(rawPath);
                if (!trimmed) return;
                if (this.isAbsolutePath(trimmed)) {
                    if (await this.pathExists(trimmed)) {
                        result.push(trimmed);
                    }
                    return;
                }
                for (const base of baseCandidates) {
                    const joined = await this.joinPath(base, trimmed);
                    if (joined && await this.pathExists(joined)) {
                        result.push(joined);
                        return;
                    }
                }
            };

            for (let i = 0; i < tokens.length; i++) {
                const token = tokens[i];
                if (token === '-I' || token === '-isystem') {
                    if (i + 1 < tokens.length) {
                        i++;
                        await pushPath(tokens[i]);
                    }
                    continue;
                }
                if (token.startsWith('-I') && token.length > 2) {
                    await pushPath(token.slice(2));
                    continue;
                }
                if (token.startsWith('-isystem') && token.length > 8) {
                    await pushPath(token.slice(8));
                    continue;
                }
            }

            return result;
        } catch (err) {
            logWarn('解析编译器包含目录失败:', err);
            return [];
        }
    }

    tokenizeCompilerArgs(argString) {
        if (typeof argString !== 'string' || !argString.trim()) return [];
        const matches = argString.match(/"[^"]+"|\S+/g);
        if (!Array.isArray(matches)) return [];
        return matches.map(token => token.trim()).filter(Boolean);
    }

    stripQuotes(value) {
        if (typeof value !== 'string') return '';
        const trimmed = value.trim();
        if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
            return trimmed.slice(1, -1);
        }
        return trimmed;
    }

    isAbsolutePath(p) {
        if (typeof p !== 'string' || !p) return false;
        if (p.startsWith('/') || p.startsWith('\\')) return true;
        return /^[a-zA-Z]:[\\/]/.test(p);
    }

    async joinPath(...segments) {
        try {
            if (!Array.isArray(segments)) return null;
            const filtered = segments.filter(seg => typeof seg === 'string' && seg.length);
            if (!filtered.length) return null;
            if (window.electronAPI?.pathJoin) {
                return await window.electronAPI.pathJoin(...filtered);
            }
            return filtered.join('/');
        } catch (_) {
            return null;
        }
    }

    async safeDirname(filePath) {
        try {
            if (!filePath || typeof filePath !== 'string' || !window.electronAPI?.pathDirname) return null;
            return await window.electronAPI.pathDirname(filePath);
        } catch (_) {
            return null;
        }
    }

    getModelFilePath(model) {
        try {
            if (!model) return null;
            if (typeof model.__oicppFilePath === 'string' && model.__oicppFilePath.length) {
                return model.__oicppFilePath;
            }
            if (!(this.editors instanceof Map)) return null;
            for (const [tabId, editor] of this.editors.entries()) {
                if (!editor || typeof editor.getModel !== 'function') continue;
                const editorModel = editor.getModel();
                if (editorModel !== model) continue;
                const filePath = editor.filePath || this.tabIdToFilePath.get(tabId) || null;
                if (filePath) {
                    try {
                        editorModel.__oicppFilePath = filePath;
                    } catch (_) {}
                    return filePath;
                }
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    async pathExists(filePath) {
        try {
            if (!filePath || typeof filePath !== 'string' || !window.electronAPI?.checkFileExists) return false;
            return !!(await window.electronAPI.checkFileExists(filePath));
        } catch (_) {
            return false;
        }
    }

    async readDirectorySafe(dirPath) {
        try {
            if (!dirPath || typeof dirPath !== 'string' || !window.electronAPI?.readDirectory) return [];
            if (!(await this.pathExists(dirPath))) return [];
            const entries = await window.electronAPI.readDirectory(dirPath);
            return Array.isArray(entries) ? entries : [];
        } catch (_) {
            return [];
        }
    }

    async listSubdirectories(dirPath) {
        try {
            const entries = await this.readDirectorySafe(dirPath);
            if (!Array.isArray(entries) || !entries.length) return [];
            return entries.filter(item => item && item.type === 'folder' && typeof item.path === 'string').map(item => item.path);
        } catch (_) {
            return [];
        }
    }

    async tryResolveHeaderInDir(baseDir, parts) {
        try {
            if (!baseDir || !Array.isArray(parts) || !parts.length) return null;
            let current = baseDir;
            for (const part of parts) {
                if (!part) return null;
                if (!(await this.pathExists(current))) {
                    return null;
                }
                const entries = await this.readDirectorySafe(current);
                if (!Array.isArray(entries) || !entries.length) {
                    return null;
                }
                const lower = part.toLowerCase();
                const match = entries.find(item => item && typeof item.name === 'string' && item.name.toLowerCase() === lower);
                if (!match || !match.path) {
                    return null;
                }
                current = match.path;
            }
            return await this.pathExists(current) ? current : null;
        } catch (_) {
            return null;
        }
    }

    async getIncludeSearchRoots(baseDir) {
        try {
            if (!baseDir || typeof baseDir !== 'string') return [];
            if (!(this._includeRootsCache instanceof Map)) {
                this._includeRootsCache = new Map();
            }
            const cached = this._includeRootsCache.get(baseDir);
            if (cached && cached.token === this._includeCacheToken && Array.isArray(cached.roots)) {
                return cached.roots;
            }

            const roots = new Set();
            if (await this.pathExists(baseDir)) {
                roots.add(baseDir);
                const immediate = await this.listSubdirectories(baseDir);
                for (const sub of immediate) {
                    roots.add(sub);
                }
                for (const sub of immediate) {
                    const name = (sub.split(/[\\\/]/).pop() || '').toLowerCase();
                    if (name === 'c++') {
                        const level1 = await this.listSubdirectories(sub);
                        for (const dir1 of level1) {
                            roots.add(dir1);
                            const level2 = await this.listSubdirectories(dir1);
                            for (const dir2 of level2) {
                                roots.add(dir2);
                            }
                        }
                    }
                }
            }

            const result = Array.from(roots);
            this._includeRootsCache.set(baseDir, { token: this._includeCacheToken, roots: result });
            return result;
        } catch (err) {
            logWarn('getIncludeSearchRoots 失败:', err);
            return [];
        }
    }

    async searchHeaderByFileName(root, targetName, parts) {
        try {
            if (!root || !targetName) return null;
            const normalizedTarget = targetName.toLowerCase();
            const maxDepth = 4;
            const maxVisited = 200;
            const visited = new Set();
            const queue = [{ dir: root, depth: 0 }];
            let processed = 0;

            while (queue.length) {
                const { dir, depth } = queue.shift();
                if (!dir || visited.has(dir)) continue;
                visited.add(dir);
                processed += 1;
                if (processed > maxVisited) break;

                const entries = await this.readDirectorySafe(dir);
                if (!Array.isArray(entries) || !entries.length) continue;

                for (const entry of entries) {
                    if (!entry || typeof entry.name !== 'string') continue;
                    const nameLower = entry.name.toLowerCase();
                    if (entry.type === 'file' && nameLower === normalizedTarget) {
                        const candidatePath = entry.path;
                        if (!candidatePath) continue;
                        if (Array.isArray(parts) && parts.length > 1) {
                            const lowerPath = candidatePath.toLowerCase();
                            let matchedSegments = 0;
                            for (const segment of parts) {
                                if (lowerPath.includes(String(segment).toLowerCase())) {
                                    matchedSegments += 1;
                                }
                            }
                            if (matchedSegments < Math.min(parts.length, 2)) {
                                continue;
                            }
                        }
                        if (await this.pathExists(candidatePath)) {
                            return candidatePath;
                        }
                    } else if (entry.type === 'folder' && depth < maxDepth) {
                        queue.push({ dir: entry.path, depth: depth + 1 });
                    }
                }
            }
            return null;
        } catch (_) {
            return null;
        }
    }

    async getIncludesFromFile(filePath) {
        try {
            if (!filePath || typeof filePath !== 'string' || !window.electronAPI?.readFileContent) return [];
            if (!(this._fileIncludeCache instanceof Map)) {
                this._fileIncludeCache = new Map();
            }
            const cached = this._fileIncludeCache.get(filePath);
            if (cached && cached.token === this._includeCacheToken && Array.isArray(cached.includes)) {
                return cached.includes;
            }

            const content = await window.electronAPI.readFileContent(filePath);
            if (typeof content !== 'string' || !content.includes('#include')) {
                this._fileIncludeCache.set(filePath, { token: this._includeCacheToken, includes: [] });
                return [];
            }

            const includes = [];
            const regex = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/gm;
            let match;
            while ((match = regex.exec(content)) !== null) {
                const includePath = (match[2] || '').trim();
                if (!includePath) continue;
                includes.push({ path: includePath, isAngle: match[1] === '<' });
            }

            this._fileIncludeCache.set(filePath, { token: this._includeCacheToken, includes });
            return includes;
        } catch (err) {
            logWarn('getIncludesFromFile 失败:', err);
            return [];
        }
    }

    async getCompilerSettingsSnapshot() {
        const result = { compilerPath: '', compilerArgs: '' };
        try {
            const manager = window.settingsManager || (typeof window.getSettingsManager === 'function' ? window.getSettingsManager() : null);
            if (manager?.getSettings) {
                result.compilerPath = manager.getSettings('compilerPath') || '';
                result.compilerArgs = manager.getSettings('compilerArgs') || '';
            }
        } catch (_) {}

        const needRemote = (!result.compilerPath || !result.compilerPath.length) || (!result.compilerArgs || !result.compilerArgs.length);
        if (needRemote && window.electronAPI?.getSettings) {
            try {
                const remote = await window.electronAPI.getSettings();
                if (remote && typeof remote === 'object') {
                    if (!result.compilerPath && typeof remote.compilerPath === 'string') {
                        result.compilerPath = remote.compilerPath;
                    }
                    if (!result.compilerArgs && typeof remote.compilerArgs === 'string') {
                        result.compilerArgs = remote.compilerArgs;
                    }
                }
            } catch (_) {}
        }

        result.compilerPath = typeof result.compilerPath === 'string' ? result.compilerPath.trim() : '';
        if (typeof result.compilerArgs !== 'string') {
            result.compilerArgs = '';
        }
        return result;
    }

    async resolveIncludeTarget(symbol, options = {}) {
        try {
            if (!symbol || !symbol.path || symbol.isAngle) return null;
            const header = String(symbol.path || '').trim();
            if (!header) return null;

            if (!(this._includePathCache instanceof Map)) {
                this._includePathCache = new Map();
            }

            const baseDir = typeof options.baseDir === 'string' && options.baseDir.length ? options.baseDir : null;
            const filePathHint = typeof options.filePath === 'string' && options.filePath.length
                ? options.filePath
                : (this.currentEditor?.filePath || this.currentFilePath || null);
            const cacheKey = options.cacheKey || (baseDir ? `local::${baseDir}::${header}` : `local::${header}`);
            if (options.useCache !== false && this._includePathCache.has(cacheKey)) {
                const cached = this._includePathCache.get(cacheKey);
                if (cached) {
                    return cached;
                }
            }

            const candidates = new Set();
            const preferredDir = baseDir || (filePathHint ? await this.safeDirname(filePathHint) : null);
            if (preferredDir) {
                const direct = await this.joinPath(preferredDir, header);
                if (direct) candidates.add(direct);
            }

            const root = window.sidebarManager?.panels?.files?.workspacePath || '';
            if (root) {
                const workspaceCandidate = await this.joinPath(root, header);
                if (workspaceCandidate) candidates.add(workspaceCandidate);
            }

            if (this._headerCache && this._headerCache.root === root && Array.isArray(this._headerCache.files)) {
                const match = this._headerCache.files.find(f => f.name === header || (f.path && f.path.endsWith(header)));
                if (match?.path) {
                    candidates.add(match.path);
                }
            }

            for (const candidate of candidates) {
                if (!candidate) continue;
                if (await this.pathExists(candidate)) {
                    if (options.useCache !== false) {
                        this._includePathCache.set(cacheKey, candidate);
                    }
                    return candidate;
                }
            }

            const allowWorkspaceScan = options.allowWorkspaceScan !== false;
            if (allowWorkspaceScan && root && window.electronAPI?.walkDirectory) {
                try {
                    const walkKey = `${root}::${header}`;
                    if (this._includePathCache.has(walkKey)) {
                        return this._includePathCache.get(walkKey);
                    }
                    const res = await window.electronAPI.walkDirectory(root, {
                        includeExts: ['.h', '.hpp', '.hh', '.hxx', '.c', '.cc', '.cpp', '.cxx'],
                        excludeGlobs: ['node_modules', '.git', '.oicpp', '.vscode'],
                        maxFiles: 5000
                    });
                    if (res && res.success && Array.isArray(res.files)) {
                        const hit = res.files.find(f => f && (f.name === header || (f.path && f.path.endsWith(header))));
                        if (hit?.path && await this.pathExists(hit.path)) {
                            this._includePathCache.set(walkKey, hit.path);
                            if (options.useCache !== false) {
                                this._includePathCache.set(cacheKey, hit.path);
                            }
                            return hit.path;
                        }
                    }
                    this._includePathCache.set(walkKey, null);
                } catch (err) {
                    logWarn('resolveIncludeTarget 遍历失败:', err);
                }
            }

            if (options.useCache !== false) {
                this._includePathCache.set(cacheKey, null);
            }
            return null;
        } catch (err) {
            logWarn('resolveIncludeTarget 失败:', err);
            return null;
        }
    }

    async openFileAtPosition(filePath, position) {
        try {
            if (!filePath) return;
            const fileName = this.getFileNameFromPath(filePath);
            const tabId = this.generateTabId(fileName, filePath);
            let targetEditor = this.editors.get(tabId);
            if (!targetEditor) {
                if (window.tabManager && window.electronAPI?.readFileContent) {
                    const content = await window.electronAPI.readFileContent(filePath);
                    if (typeof content === 'string') {
                        await window.tabManager.openFile(fileName, content, false, { filePath });
                    }
                } else if (window.electronAPI?.readFileContent) {
                    const content = await window.electronAPI.readFileContent(filePath);
                    if (typeof content === 'string') {
                        await this.createNewEditor(tabId, fileName, content, filePath);
                    }
                }
                targetEditor = this.editors.get(tabId);
            }

            if (!targetEditor) return;

            let normalizedKey = null;
            if (filePath && typeof filePath === 'string') {
                normalizedKey = filePath.replace(/\\/g, '/');
            }

            let activatedViaTabManager = false;
            if (normalizedKey && window.tabManager?.activateTabByUniqueKey) {
                try {
                    await window.tabManager.activateTabByUniqueKey(normalizedKey);
                    activatedViaTabManager = true;
                    targetEditor = this.editors.get(tabId) || targetEditor;
                } catch (activationError) {
                    logWarn('TabManager.activateTabByUniqueKey 失败:', activationError);
                }
            }

            if (!activatedViaTabManager) {
                await this.switchTab(tabId);
            }

            const destinationEditor = this.editors.get(tabId) || this.currentEditor || targetEditor;
            if (position && destinationEditor) {
                this.goToMonacoPosition(destinationEditor, position);
            } else if (destinationEditor) {
                destinationEditor.focus();
            }
        } catch (err) {
            logWarn('openFileAtPosition 失败:', err);
        }
    }

    goToMonacoPosition(editor, position) {
        try {
            if (!editor || !position) return;
            editor.setPosition(position);
            if (typeof editor.revealPositionInCenter === 'function') {
                editor.revealPositionInCenter(position, monaco.editor.ScrollType.Smooth);
            } else {
                editor.revealPosition(position);
            }
            editor.focus();
        } catch (err) {
            logWarn('goToMonacoPosition 失败:', err);
        }
    }
    
    parseFunctions(code) {
        const functions = [];
        const cleanCode = this.removeComments(code);
        
        const functionRegex = /(?:^|\n)\s*([\w:]+(?:\s*\*|\s*&)?)\s+([\w~]+)\s*\(([^)]*)\)\s*(?:const\s*)?(?:;|\{)/gm;
        
        let match;
        while ((match = functionRegex.exec(cleanCode)) !== null) {
            const returnType = match[1].trim();
            const name = match[2].trim();
            const params = match[3].trim();
            
            if (name && !['if', 'while', 'for', 'switch', 'catch'].includes(name)) {
                functions.push({
                    name: name,
                    returnType: returnType,
                    params: params || 'void',
                    description: `返回类型: ${returnType}`
                });
            }
        }
        
        return functions;
    }
    
    parseStructsAndClasses(code) {
        const structs = [];
        const cleanCode = this.removeComments(code);
        
        const structRegex = /(struct|class)\s+([\w]+)\s*(?:[^{]*)?\{([^}]*)\}/gm;
        
        let match;
        while ((match = structRegex.exec(cleanCode)) !== null) {
            const type = match[1];
            const name = match[2];
            const body = match[3];
            
            const members = [];
            const memberLines = body.split(';');
            memberLines.forEach(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
                    members.push(trimmed);
                }
            });
            
            structs.push({
                type: type,
                name: name,
                members: members.slice(0, 5), // 只显示前5个成员
                description: `${type === 'class' ? '类' : '结构体'}定义`
            });
        }
        
        return structs;
    }
    
    removeComments(code) {
        let result = code.replace(/\/\/.*$/gm, '');
        result = result.replace(/\/\*[\s\S]*?\*\//g, '');
        return result;
    }
}

window.MonacoEditorManager = MonacoEditorManager;