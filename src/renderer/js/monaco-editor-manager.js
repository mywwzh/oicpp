Warning: truncated output (original token count: 74364)
Total output lines: 6907

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
        this.lspMarkerOwner = 'oicpp-lsp';
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
        this.syntaxColorsByTheme = {};
        this.syntaxStyles = {};
        this.unifiedPreprocessorColor = false;
        this.formatterIndentStyle = 'editor';
        this.clangFormatStyle = this.getDefaultClangFormatStyle();
        this._lspSemanticProviders = [];
        this._lspDocuments = new Map();
        this._lspChangeTimers = new Map();
        this._lspChangeInFlight = new Set();
        this._lspChangePending = new Set();
        this._lspReadyPromise = null;
        this._lspCompletionEnabled = true;
        this._syntaxCheckEnabled = true;
        this._lspCompilerPath = undefined;
        this._lspProviders = new Map();
        this._lspProvidersReady = false;
        this.lspClient = window.lspClient || null;
        this.setupLspIntegration();
        this._onMonacoContextMenuPasteCapture = this.handleMonacoContextMenuPasteCapture.bind(this);
        
        this.init();
        document.addEventListener('click', this._onMonacoContextMenuPasteCapture, true);

        document.addEventListener('settings-applied', (evt) => {
            try {
                this.loadKeybindingsFromSettings(evt?.detail || {});
                this.updateFormatterSettings(evt?.detail || {});
                this.updateClangFormatSettings(evt?.detail || {});
            } catch (e) {
                logWarn('应用快捷键设置失败:', e);
            }
        });

        if (window.electronAPI?.onSettingsChanged) {
            try {
                window.electronAPI.onSettingsChanged((_event, _settingsType, payload) => {
                    if (payload && Object.prototype.hasOwnProperty.call(payload, 'compilerPath')) {
                        const newCompilerPath = payload.compilerPath || '';
                        this._lspCompilerPath = newCompilerPath;

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

            this.registerCppSemanticHighlightingProviders();
            // Local completion does not depend on clangd. Register it as soon
            // as Monaco is available so suggestions remain usable while the
            // language server is starting or recovering.
            this._registerLocalCompletionProvider();
            
            this.isInitialized = true;
            logInfo('Monaco Editor 管理器初始化完成');

            await this.refreshKeybindingsFromSettings();
            this.registerGlobalKeybindings();

            await this.loadUserSnippets();

            this._initLspProactively();
        } catch (error) {
            logError('Monaco Editor 管理器初始化失败:', error);
        }
    }

    _initLspProactively() {
        setTimeout(() => {
            this.ensureLspReady().then(() => {
                logInfo('[LSP] 主动启动完成');
            }).catch(err => {
                logWarn('[LSP] 主动启动失败（将在打开文件时重试）:', err?.message || err);
            });
        }, 500);
    }

    async restartLspWithCompiler(newCompilerPath) {
        // 重启 clangd 以应用新的 --query-driver
        try {
            if (!this.lspClient) return;
            logInfo('[LSP] 正在重启 clangd 以应用新编译器路径:', newCompilerPath);

            this._lspDocuments.clear();
            for (const timer of this._lspChangeTimers.values()) {
                clearTimeout(timer);
            }
            this._lspChangeTimers.clear();
            this._lspChangeInFlight.clear();
            this._lspChangePending.clear();

            this._lspCompilerPath = newCompilerPath;

            const workspaceRoot = this.getWorkspaceRootPath();
            const rootUri = (workspaceRoot && typeof monaco !== 'undefined' && monaco.Uri)
                ? monaco.Uri.file(workspaceRoot).toString()
                : '';
            const workspaceName = workspaceRoot ? this.getFileNameFromPath(workspaceRoot) : 'workspace';
            const { compilerPath, compilerArgs } = await this.getCompilerSettingsSnapshot();
            const fallbackFlags = this.tokenizeCompilerArgs(compilerArgs || '');
            if (!fallbackFlags.some(f => f.startsWith('-std='))) {
                fallbackFlags.unshift('-std=c++17');
            }

            this._lspReadyPromise = this.lspClient.restart({
                workspaceRoot,
                rootUri,
                workspaceName,
                fallbackFlags,
                compilerPath: compilerPath || newCompilerPath
            });

            await this._lspReadyPromise;

            const allModels = typeof monaco !== 'undefined' && monaco.editor ? monaco.editor.getModels() : [];
            for (const model of allModels) {
                const langId = model.getLanguageId ? model.getLanguageId() : '';
                if (langId === 'cpp' || langId === 'c') {
                    const filePath = model.__oicppFilePath || this.getModelFilePath(model);
                    const fileName = filePath ? filePath.split(/[\\/]/).pop() : 'untitled';
                    delete model.__oicppLspUri;
                    try {
                        await this.openLspDocument(model, filePath, fileName);
                    } catch (_) {}
                }
            }

            logInfo('[LSP] clangd 重启完成，已应用新编译器路径');
        } catch (err) {
            this._lspReadyPromise = null;
            logWarn('[LSP] 重启 clangd 失败:', err?.message || err);
        }
    }

    getLspStatus() {
        if (!this.lspClient) return 'unavailable';
        if (this.lspClient._ready) return 'ready';
        if (this._lspReadyPromise) return 'starting';
        return 'idle';
    }

    getCurrentMarkerCounts() {
        try {
            if (typeof monaco === 'undefined' || !monaco.editor) return { errors: 0, warnings: 0, infos: 0 };
            const editor = this.getCurrentEditor();
            const model = editor?.getModel ? editor.getModel() : null;
            if (!model) return { errors: 0, warnings: 0, infos: 0 };

            const allMarkers = monaco.editor.getModelMarkers
                ? monaco.editor.getModelMarkers({ resource: model.uri })
                : [];

            let errors = 0, warnings = 0, infos = 0;
            for (const m of allMarkers) {
                if (m.severity === monaco.MarkerSeverity.Error) errors++;
                else if (m.severity === monaco.MarkerSeverity.Warning) warnings++;
                else if (m.severity === monaco.MarkerSeverity.Info) infos++;
            }
            return { errors, warnings, infos };
        } catch (_) {
            return { errors: 0, warnings: 0, infos: 0 };
        }
    }

    getWorkspaceRootPath() {
        try {
            return window.sidebarManager?.panels?.files?.workspacePath || window.sidebarManager?.panels?.files?.currentPath || '';
        } catch (_) {
            return '';
        }
    }

    async ensureLspReady() {
        if (!this.lspClient) {
            logWarn('[LSP] lspClient 不可用，跳过 LSP 初始化');
            return null;
        }
        if (this._lspReadyPromise) {
            return this._lspReadyPromise;
        }
        this._lspReadyPromise = (async () => {
            let fallbackFlags = [];
            let compilerPath = '';
            try {
                if (window.electronAPI?.getAllSettings) {
                    const settings = await window.electronAPI.getAllSettings();
                    fallbackFlags = this.tokenizeCompilerArgs(settings?.compilerArgs || '');
                    compilerPath = settings?.compilerPath || '';
                }
            } catch (_) {
                fallbackFlags = [];
            }
            if (!fallbackFlags.some(f => f.startsWith('-std='))) {
                fallbackFlags.unshift('-std=c++17');
            }
            logInfo('[LSP] 回退编译参数:', fallbackFlags.length ? fallbackFlags.join(' ') : '(无)');
            if (compilerPath) {
                logInfo('[LSP] 编译器路径:', compilerPath);
            }
            this._lspCompilerPath = compilerPath;

            const workspaceRoot = this.getWorkspaceRootPath();
            const rootUri = (workspaceRoot && typeof monaco !== 'undefined' && monaco.Uri)
                ? monaco.Uri.file(workspaceRoot).toString()
                : '';
            const workspaceName = workspaceRoot ? this.getFileNameFromPath(workspaceRoot) : 'workspace';

            logInfo('[LSP] 准备初始化 LSP, 工作区:', workspaceRoot || '(无)');
            try {
                await this.lspClient.start({
                    workspaceRoot,
                    rootUri,
                    workspaceName,
                    fallbackFlags,
                    compilerPath
                });
            } catch (startErr) {
                logError('[LSP] LSP 启动失败:', startErr?.message || startErr);
                this._lspReadyPromise = null;  // 允许重试
                throw startErr;
            }

            logInfo('[LSP] LSP 就绪，注册语义高亮提供器');
            this.registerCppSemanticHighlightingProviders();
            this.registerAllLspProviders();
            return true;
        })();
        return this._lspReadyPromise;
    }

    setupLspIntegration() {
        if (!this.lspClient) {
            return;
        }
        this.lspClient.onDiagnostics((uri, diagnostics) => {
            this.applyLspDiagnostics(uri, diagnostics);
        });
        this.lspClient.onReady(() => {
            this.registerCppSemanticHighlightingProviders();
            this.registerAllLspProviders();
        });
    }

    registerAllLspProviders() {
        if (this._lspProvidersReady) {
            return;
        }
        try {
            if (typeof monaco === 'undefined' || !monaco.languages) return;
            this._registerLocalCompletionProvider();
            this._registerLspCompletionProvider();
            this._registerLspSignatureHelpProvider();
            this._registerLspHoverProvider();
            this._registerLspDefinitionProvider();
            this._registerLspDocumentSymbolProvider();
            this._lspProvidersReady = true;
            logInfo('[LSP] 所有 LSP 提供器已注册 (补全、签名帮助、悬停、定义、符号)');
        } catch (err) {
            logWarn('[LSP] 注册 LSP 提供器失败:', err?.message || err);
        }
    }

    async _ensureLspDocumentReady(model) {
        if (!model || !this.lspClient) return false;
        await this.ensureLspReady();
        if (this._lspDocuments.has(model)) return true;
        try {
            const filePath = this.getModelFilePath(model);
            const fileName = this.currentFileName || null;
            await this.openLspDocument(model, filePath, fileName);
            return this._lspDocuments.has(model);
        } catch (_) {
            return false;
        }
    }

    _getLocalCompletionCandidates(model) {
        const versionId = model?.getVersionId?.();
        const cached = model?.__oicppLocalCompletionCache;
        if (cached && cached.versionId === versionId) {
            return cached.candidates;
        }

        const counts = new Map();
        const text = model?.getValue?.() || '';
        const identifierPattern = /\b[A-Za-z_][A-Za-z0-9_]*\b/g;
        const ignored = new Set(['alignas', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'class', 'const', 'continue', 'default', 'delete', 'do', 'double', 'else', 'enum', 'explicit', 'extern', 'false', 'float', 'for', 'friend', 'if', 'inline', 'int', 'long', 'namespace', 'new', 'nullptr', 'operator', 'private', 'protected', 'public', 'register', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'template', 'this', 'throw', 'true', 'try', 'typedef', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'while']);
        let match;
        while ((match = identifierPattern.exec(text)) !== null) {
            const name = match[0];
            if (name.length < 2 || ignored.has(name)) continue;
            counts.set(name, (counts.get(name) || 0) + 1);
        }
        const candidates = Array.from(counts.entries())
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 250)
            .map(([label, count]) => ({ label, count }));
        if (model) model.__oicppLocalCompletionCache = { versionId, candidates };
        return candidates;
    }

    _registerLocalCompletionProvider() {
        const commonCppItems = [
            'vector', 'string', 'pair', 'map', 'set', 'queue', 'stack', 'deque',
            'priority_queue', 'unordered_map', 'unordered_set', 'sort', 'reverse',
            'lower_bound', 'upper_bound', 'binary_search', 'max', 'min', 'swap',
            'push_back', 'emplace_back', 'begin', 'end', 'size', 'memset', 'fill'
        ];
        for (const language of ['cpp', 'c']) {
            const key = `${language}:localCompletion`;
            if (this._lspProviders.has(key)) continue;
            const disposable = monaco.languages.registerCompletionItemProvider(language, {
                provideCompletionItems: (model, position) => {
                    if (!this._lspCompletionEnabled || !model || model.isDisposed?.()) return { suggestions: [] };
                    const word = model.getWordUntilPosition(position);
                    const prefix = (word.word || '').toLowerCase();
                    const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
                    const seen = new Set();
                    const suggestions = [];
                    const add = (label, detail, count = 0, kind = monaco.languages.CompletionItemKind.Variable) => {
                        const normalized = String(label || '').trim();
                        if (!normalized || seen.has(normalized) || (prefix && !normalized.toLowerCase().includes(prefix))) return;
                        seen.add(normalized);
                        const exact = normalized.toLowerCase() === prefix;
                        const startsWith = normalized.toLowerCase().startsWith(prefix);
                        suggestions.push({
                            label: normalized, kind, insertText: normalized, range, detail,
                            // Prefer frequently used symbols from the current file.
                            sortText: `${exact ? '00' : (startsWith ? '01' : '02')}${String(9999 - Math.min(count, 9999)).padStart(4, '0')}_${normalized}`
                        });
                    };
                    this._getLocalCompletionCandidates(model).forEach(({ label, count }) => add(label, '当前文件', count));
                    commonCppItems.forEach((label) => add(label, 'C++ 常用', 0, monaco.languages.CompletionItemKind.Keyword));
                    return { suggestions };
                }
            });
            this._lspProviders.set(key, disposable);
        }
    }

    _registerLspCompletionProvider() {
        const languages = ['cpp', 'c'];
        for (const language of languages) {
            const key = `${language}:completion`;
            if (this._lspProviders.has(key)) continue;

            const kindMap = {
                1: monaco.languages.CompletionItemKind.Text,
                2: monaco.languages.CompletionItemKind.Method,
                3: monaco.languages.CompletionItemKind.Function,
                4: monaco.languages.CompletionItemKind.Constructor,
                5: monaco.languages.CompletionItemKind.Field,
                6: monaco.languages.CompletionItemKind.Variable,
                7: monaco.languages.CompletionItemKind.Class,
                8: monaco.languages.CompletionItemKind.Interface,
                9: monaco.languages.CompletionItemKind.Module,
                10: monaco.languages.CompletionItemKind.Property,
                11: monaco.languages.CompletionItemKind.Unit,
                12: monaco.languages.CompletionItemKind.Value,
                13: monaco.languages.CompletionItemKind.Enum,
                14: monaco.languages.CompletionItemKind.Keyword,
                15: monaco.languages.CompletionItemKind.Snippet,
                16: monaco.languages.CompletionItemKind.Color,
                17: monaco.languages.CompletionItemKind.File,
                18: monaco.languages.CompletionItemKind.Reference,
                19: monaco.languages.CompletionItemKind.Folder,
                20: monaco.languages.CompletionItemKind.EnumMember,
                21: monaco.languages.CompletionItemKind.Constant,
                22: monaco.languages.CompletionItemKind.Struct,
                23: monaco.languages.CompletionItemKind.Event,
                24: monaco.languages.CompletionItemKind.Operator,
                25: monaco.languages.CompletionItemKind.TypeParameter
            };

            const toRange = (range) => new monaco.Range(
                (range.start.line || 0) + 1,
                (range.start.character || 0) + 1,
                (range.end.line || 0) + 1,
                (range.end.character || 0) + 1
            );

            logInfo('[LSP] 注册自动补全提供器 (语言:', language, ')');
            
            const lspComplete = async (model, position, context) => {
                if (!this._lspCompletionEnabled) {
                    return { suggestions: [] };
                }
                try {
                    await this._ensureLspDocumentReady(model);
                    if (!this.lspClient) {
                        return { suggestions: [] };
                    }
                    const uri = await this.getDocumentUriForModel(model);
                    if (!uri) {
                        return { suggestions: [] };
                    }

                    const result = await this.lspClient.request('textDocument/completion', {
                        textDocument: { uri },
                        position: {
                            line: position.lineNumber - 1,
                            character: position.column - 1
                        },
                        context: context ? {
                            triggerKind: context.triggerKind,
                            triggerCharacter: context.triggerCharacter
                        } : undefined
                    });

                    const items = Array.isArray(result?.items) ? result.items : (Array.isArray(result) ? result : []);
                    const isIncomplete = result?.isIncomplete === true;

                    const word = model.getWordUntilPosition(position);
                    const wordRange = new monaco.Range(
                        position.lineNumber, word.startColumn,
                        position.lineNumber, word.endColumn
                    );
                    const prefix = (word.word || '').toLowerCase();
                    const rankLspItem = (item, label) => {
                        const candidate = String(item.filterText || label || '').toLowerCase();
                        const matchRank = candidate === prefix ? '00' : (candidate.startsWith(prefix) ? '01' : '02');
                        const kind = Number(item.kind) || 0;
                        // Functions, methods and variables are generally more
                        // useful while writing contest code than generic types
                        // and low-relevance clangd entries.
                        const kindRank = [2, 3, 5, 6, 10, 12, 13, 20, 21].includes(kind) ? '00'
                            : ([7, 13, 22, 25].includes(kind) ? '01' : '02');
                        return `${matchRank}${kindRank}_${String(item.sortText || label || '')}`;
                    };

                    const suggestions = items.map((item) => {
                        const rawLabel = String(item.label || '').trim();
                        if (!rawLabel) return null;

                        const textEdit = item.textEdit || null;
                        const insertText = (textEdit && textEdit.newText) || item.insertText || rawLabel;
                        const range = (textEdit && textEdit.range)
                            ? toRange(textEdit.range)
                            : wordRange;
                        const additionalTextEdits = Array.isArray(item.additionalTextEdits)
                            ? item.additionalTextEdits.map((edit) => ({ range: toRange(edit.range), text: edit.newText }))
                            : undefined;

                        let documentation = undefined;
                        if (item.documentation) {
                            if (typeof item.documentation === 'string') {
                                documentation = { value: item.documentation };
                            } else if (item.documentation.value) {
                                documentation = { value: item.documentation.value };
                            }
                        }

                        const sug = {
                            label: rawLabel,
                            kind: kindMap[item.kind] || monaco.languages.CompletionItemKind.Text,
                            insertText,
                            range,
                            detail: item.detail || undefined,
                            sortText: rankLspItem(item, rawLabel),
                            filterText: item.filterText,
                            documentation,
                            additionalTextEdits
                        };
                        if (item.insertTextFormat === 2) {
                            sug.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
                        }
                        return sug;
                    }).filter(Boolean);


                    if (Array.isArray(this.userSnippets)) {
                        const prefix = model.getValueInRange({
                            startLineNumber: position.lineNumber,
                            startColumn: Math.max(1, word.startColumn),
                            endLineNumber: position.lineNumber,
                            endColumn: word.endColumn
                        }) || '';
                        for (const sn of this.userSnippets) {
                            const label = String(sn.keyword || '').trim();
                            if (!label) continue;
                            const content = String(sn.content || '');
                            suggestions.push({
                                label,
                                kind: monaco.languages.CompletionItemKind.Snippet,
                                detail: sn.description || '用户代码片段',
                                insertText: content,
                                insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
                                range: wordRange,
                                sortText: (label.startsWith(prefix) ? '0001_' : 'zzzz_') + label
                            });
                        }
                    }

                    return { suggestions, incomplete: isIncomplete };
                } catch (err) {
                    logWarn('[LSP] 补全失败:', err?.message || err);
                    return { suggestions: [] };
                }
            };

            const disposableTrigger = monaco.languages.registerCompletionItemProvider(language, {
                triggerCharacters: ['.', '>', ':', '"', '<', '/', '#', '&', '*', '[', '(', ','],
                provideCompletionItems: lspComplete
            });
            this._lspProviders.set(key, disposableTrigger);
        }
    }

    _registerLspSignatureHelpProvider() {
        const languages = ['cpp', 'c'];
        const emptySignatureHelp = {
            activeSignature: 0,
            activeParameter: 0,
            signatures: []
        };
        const createSignatureHelpResult = (signatureHelp) => ({
            value: signatureHelp,
            dispose() { }
        });
        for (const language of languages) {
            const key = `${language}:signatureHelp`;
            if (this._lspProviders.has(key)) continue;
            logInfo('[LSP] 注册签名帮助提供器 (语言:', language, ')');
            const disposable = monaco.languages.registerSignatureHelpProvider(language, {
                signatureHelpTriggerCharacters: ['(', ','],
                signatureHelpRetriggerCharacters: [','],
                provideSignatureHelp: async (model, position) => {
                    try {
                        await this._ensureLspDocumentReady(model);
                        if (!this.lspClient) return createSignatureHelpResult(emptySignatureHelp);
                        const uri = await this.getDocumentUriForModel(model);
                        if (!uri) return createSignatureHelpResult(emptySignatureHelp);

                        const result = await this.lspClient.request('textDocument/signatureHelp', {
                            textDocument: { uri },
                            position: {
                                line: position.lineNumber - 1,
                                character: position.column - 1
                            }
                        });
                        if (!result || !Array.isArray(result.signatures) || result.signatures.length === 0) {
                            return createSignatureHelpResult(emptySignatureHelp);
                        }
                        return createSignatureHelpResult({
                            activeSignature: Number.isInteger(result.activeSignature) ? result.activeSignature : 0,
                            activeParameter: Number.isInteger(result.activeParameter) ? result.activeParameter : 0,
                            signatures: result.signatures.map((sig) => ({
                                label: sig.label || '',
                                documentation: sig.documentation
                                    ? (typeof sig.documentation === 'string' ? sig.documentation : (sig.documentation.value || ''))
                                    : undefined,
                                parameters: Array.isArray(sig.parameters)
                                    ? sig.parameters.map((p, idx) => ({
                                        label: typeof p.label === 'string' ? p.label : (Array.isArray(p.label) ? p.label.join('') : `[${idx}]`),
                                        documentation: p.documentation
                                            ? (typeof p.documentation === 'string' ? p.documentation : (p.documentation.value || ''))
                                            : undefined
                                    }))
                                    : []
                            }))
                        });
                    } catch (_) {
                        return createSignatureHelpResult(emptySignatureHelp);
                    }
                }
            });
            this._lspProviders.set(key, disposable);
        }
    }

    _registerLspHoverProvider() {
        const languages = ['cpp', 'c'];
        for (const language of languages) {
            const key = `${language}:hover`;
            if (this._lspProviders.has(key)) continue;
            logInfo('[LSP] 注册悬停提示提供器 (语言:', language, ')');
            const disposable = monaco.languages.registerHoverProvider(language, {
                provideHover: async (model, position) => {
                    try {
                        await this._ensureLspDocumentReady(model);
                        if (!this.lspClient) return null;
                        const uri = await this.getDocumentUriForModel(model);
                        if (!uri) return null;

                        const result = await this.lspClient.request('textDocument/hover', {
                            textDocument: { uri },
                            position: {
                                line: position.lineNumber - 1,
                                character: position.column - 1
                            }
                        });
                        if (!result || !result.contents) return null;

                        let contents = [];
                        if (typeof result.contents === 'string') {
                            contents = [{ value: result.contents }];
                        } else if (result.contents.value) {
                            contents = [{ value: result.contents.value }];
                        } else if (Array.isArray(result.contents)) {
                            contents = result.contents
                                .filter(Boolean)
                                .map((c) => typeof c === 'string' ? { value: c } : { value: c.value || '' });
                        }
                        if (contents.length === 0) return null;

                        let range = null;
                        if (result.range) {
                            range = new monaco.Range(
                                (result.range.start.line || 0) + 1,
                                (result.range.start.character || 0) + 1,
                                (result.range.end.line || 0) + 1,
                                (result.range.end.character || 0) + 1
                            );
                        }
                        return { contents, range };
                    } catch (_) {
                        return null;
                    }
                }
            });
            this._lspProviders.set(key, disposable);
        }
    }

    _registerLspDefinitionProvider() {
        const languages = ['cpp', 'c'];
        for (const language of languages) {
            const key = `${language}:definition`;
            if (this._lspProviders.has(key)) continue;
            logInfo('[LSP] 注册定义跳转提供器 (语言:', language, ')');
            const disposable = monaco.languages.registerDefinitionProvider(language, {
                provideDefinition: async (model, position) => {
                    try {
                        if (!model || (typeof model.isDisposed === 'function' && model.isDisposed())) {
                            return null;
                        }
                        await this._ensureLspDocumentReady(model);
                        if (!this.lspClient) return null;
                        const uri = await this.getDocumentUriForModel(model);
                        if (!uri) return null;

                        if (typeof model.isDisposed === 'function' && model.isDisposed()) {
                            return null;
                        }

                        const result = await this.lspClient.request('textDocument/definition', {
                            textDocument: { uri },
                            position: {
                                line: position.lineNumber - 1,
                                character: position.column - 1
                            }
                        });
                        // The editor/tab may have been disposed while clangd was
                        // answering. Returning locations for it makes Monaco's
                        // built-in definition action attempt to reference a model
                        // that no longer exists.
                        if (!model || (typeof model.isDisposed === 'function' && model.isDisposed())) {
                            return null;
                        }
                        if (!result) return null;

                        const locations = Array.isArray(result) ? result : [result];
                        return locations
                            .filter(Boolean)
                            .map((loc) => {
                                try {
                                    const targetUri = loc.uri || '';
                                    const targetRange = loc.range || {};
                                    return {
                                        uri: monaco.Uri.parse(targetUri),
                                        range: new monaco.Range(
                                            (targetRange.start?.line || 0) + 1,
                                            (targetRange.start?.character || 0) + 1,
                                            (targetRange.end?.line || 0) + 1,
                                            (targetRange.end?.character || 0) + 1
                                        )
                                    };
                                } catch (err) {
                                    logWarn('[LSP] 定义位置处理失败:', err?.message || String(err));
                                    return null;
                                }
                            })
                            .filter(Boolean);
                    } catch (_) {
                        return null;
                    }
                }
            });
            this._lspProviders.set(key, disposable);
        }
    }

    _registerLspDocumentSymbolProvider() {
        const languages = ['cpp', 'c'];
        for (const language of languages) {
            const key = `${language}:documentSymbol`;
            if (this._lspProviders.has(key)) continue;
            logInfo('[LSP] 注册文档符号提供器 (语言:', language, ')');
            const disposable = monaco.languages.registerDocumentSymbolProvider(language, {
                provideDocumentSymbols: async (model) => {
                    try {
                        await this._ensureLspDocumentReady(model);
                        if (!this.lspClient) return [];
                        const uri = await this.getDocumentUriForModel(model);
                        if (!uri) return [];

                        const result = await this.lspClient.request('textDocument/documentSymbol', {
                            textDocument: { uri }
                        });
                        if (!Array.isArray(result)) return [];

                        const toRange = (range) => new monaco.Range(
                            (range.start?.line || 0) + 1,
                            (range.start?.character || 0) + 1,
                            (range.end?.line || 0) + 1,
                            (range.end?.character || 0) + 1
                        );

                        const kindMap = {
                            1: monaco.languages.SymbolKind.File,
                            2: monaco.languages.SymbolKind.Module,
                            3: monaco.languages.SymbolKind.Namespace,
                            4: monaco.languages.SymbolKind.Package,
                            5: monaco.languages.SymbolKind.Class,
                            6: monaco.languages.SymbolKind.Method,
                            7: monaco.languages.SymbolKind.Property,
                            8: monaco.languages.SymbolKind.Field,
                            9: monaco.languages.SymbolKind.Constructor,
                            10: monaco.languages.SymbolKind.Enum,
                            11: monaco.languages.SymbolKind.Interface,
                            12: monaco.languages.SymbolKind.Function,
                            13: monaco.languages.SymbolKind.Variable,
                            14: monaco.languages.SymbolKind.Constant,
                            15: monaco.languages.SymbolKind.String,
                            16: monaco.languages.SymbolKind.Number,
                            17: monaco.languages.SymbolKind.Boolean,
                            18: monaco.languages.SymbolKind.Array,
                            19: monaco.languages.SymbolKind.Object,
                            20: monaco.languages.SymbolKind.Key,
                            21: monaco.languages.SymbolKind.Null,
                            22: monaco.languages.SymbolKind.EnumMember,
                            23: monaco.languages.SymbolKind.Struct,
                            24: monaco.languages.SymbolKind.Event,
                            25: monaco.languages.SymbolKind.Operator,
                            26: monaco.languages.SymbolKind.TypeParameter
                        };

                        return result.filter(Boolean).map((sym) => ({
                            name: sym.name || '',
                            detail: sym.detail || '',
                            kind: kindMap[sym.kind] || monaco.languages.SymbolKind.Variable,
                            range: toRange(sym.range || sym.location?.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }),
                            selectionRange: toRange(sym.selectionRange || sym.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }),
                            children: Array.isArray(sym.children) ? sym.children.filter(Boolean).map((child) => ({
                                name: child.name || '',
                                detail: child.detail || '',
                                kind: kindMap[child.kind] || monaco.languages.SymbolKind.Variable,
                                range: toRange(child.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }),
                                selectionRange: toRange(child.selectionRange || child.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } })
                            })) : []
                        }));
                    } catch (_) {
                        return [];
                    }
                }
            });
            this._lspProviders.set(key, disposable);
        }
    }

    async getDocumentUriForModel(model, filePathHint = null, fileNameHint = null) {
        if (!model || typeof monaco === 'undefined' || !monaco.Uri) {
            return '';
        }
        if (model.__oicppLspUri) {
            return model.__oicppLspUri;
        }
        const uri = model.uri && typeof model.uri.toString === 'function' ? model.uri.toString() : '';
        if (uri && uri.startsWith('file:')) {
            const cleaned = this._normalizeLspUri(uri);
            model.__oicppLspUri = cleaned;
            return cleaned;
        }

        const filePath = filePathHint || this.getModelFilePath(model);
        if (filePath) {
            const fileUri = this._buildCleanFileUri(filePath);
            model.__oicppLspUri = fileUri;
            return fileUri;
        }

        const workspaceRoot = this.getWorkspaceRootPath();
        const fileName = (fileNameHint || model.__oicppVirtualName || 'untitled.cpp').replace(/[\\/]/g, '_');
        let virtualPath = fileName;
        if (workspaceRoot) {
            if (window.electronAPI?.pathJoin) {
                virtualPath = await window.electronAPI.pathJoin(workspaceRoot, '.oicpp', 'lsp', fileName);
            } else {
                virtualPath = `${workspaceRoot}/.oicpp/lsp/${fileName}`;
            }
        }
        const fileUri = this._buildCleanFileUri(virtualPath);
        model.__oicppVirtualName = fileName;
        model.__oicppLspUri = fileUri;
        return fileUri;
    }

    _buildCleanFileUri(filePath) {
        const normalized = filePath.replace(/\\/g, '/');
        // Windows: file:///D:/path, Unix: file:///home/path
        if (/^[a-zA-Z]:/.test(normalized)) {
            return 'file:///' + normalized;
        }
        return 'file://' + (normalized.startsWith('/') ? '' : '/') + normalized;
    }

    _normalizeLspUri(uri) {
        if (/%3[Aa]/.test(uri)) {
            const decoded = decodeURIComponent(uri);
            if (decoded.startsWith('file:///')) {
                const pathPart = decoded.slice('file:///'.length);
                if (/^[a-zA-Z]:/.test(pathPart)) {
                    return 'file:///' + pathPart;
                }
            }
            return decoded;
        }
        return uri;
    }

    async openLspDocument(model, filePathHint = null, fileNameHint = null) {
        try {
            if (!this.lspClient || !model) return;
            await this.ensureLspReady();

            if (this._lspDocuments.has(model)) {
                return;
            }
            const uri = await this.getDocumentUriForModel(model, filePathHint, fileNameHint);
            if (!uri) return;

            const languageId = model.getLanguageId ? model.getLanguageId() : 'cpp';
            if (languageId !== 'cpp' && languageId !== 'c') {
                return;
            }
            const fileName = fileNameHint || (filePathHint ? filePathHint.split(/[\\/]/).pop() : 'untitled');

            const { compilerPath } = await this.getCompilerSettingsSnapshot();
            if (!compilerPath) {
                const notice = '编译器路径未设置，语法检查将找不到头文件，请先设置编译器路径。';
                if (window.oicppApp?.showMessage) {
                    window.oicppApp.showMessage(notice, 'warning');
                } else {
                    logWarn('[LSP] ' + notice);
                }
            }

            logInfo('[LSP] 打开文档:', fileName, 'uri:', uri.replace(/^file:\/\//, ''));
            const version = 1;
            const text = model.getValue ? model.getValue() : '';
            this._lspDocuments.set(model, { uri, version, languageId });

            const didOpenResult = await this.lspClient.notify('textDocument/didOpen', {
                textDocument: { uri, languageId, version, text }
            });

            if (didOpenResult && didOpenResult.ok === false) {
                this._lspDocuments.delete(model);
                logWarn('[LSP] didOpen 失败 (' + fileName + '):', didOpenResult.error || '未知错误');
                return;
            }

            // 发送 didSave 触发 clangd 进行完整的诊断分析
            try {
                await this.lspClient.notify('textDocument/didSave', {
                    textDocument: { uri }
                });
            } catch (_) {}

            if (!model.__oicppLspContentListener && typeof model.onDidChangeContent === 'function') {
                model.__oicppLspContentListener = model.onDidChangeContent(() => {
                    this.queueLspDidChange(model);
                });
            }
            if (!model.__oicppLspDisposeListener && typeof model.onWillDispose === 'function') {
                model.__oicppLspDisposeListener = model.onWillDispose(() => {
                    this.closeLspDocument(model);
                });
            }
        } catch (err) {
            logWarn('[LSP] 打开文档失败:', err?.message || err);
        }
    }

    queueLspDidChange(model) {
        if (!model || model.isDisposed?.()) return;
        const existing = this._lspChangeTimers.get(model);
        if (existing) {
            clearTimeout(existing);
        }
        const lineCount = model.getLineCount?.() || 0;
        const contentLength = model.getValueLength?.() || 0;
        // didChange sends the complete document. Give clangd time to settle
        // after a large paste instead of queuing multiple full parses.
        const delay = contentLength >= 100000 || lineCount >= 1000
            ? 700
            : (contentLength >= 15000 || lineCount >= 150 ? 350 : 150);
        const timer = setTimeout(() => {
            this._lspChangeTimers.delete(model);
            this.sendLspDidChange(model);
        }, delay);
        this._lspChangeTimers.set(model, timer);
    }

    async sendLspDidChange(model) {
        if (!model || model.isDisposed?.()) return;
        if (this._lspChangeInFlight.has(model)) {
            this._lspChangePending.add(model);
            return;
        }
        try {
            if (!this.lspClient) return;
            const entry = this._lspDocuments.get(model);
            if (!entry) return;
            this._lspChangeInFlight.add(model);
            entry.version += 1;
            const result = await this.lspClient.notify('textDocument/didChange', {
                textDocument: { uri: entry.uri, version: entry.version },
                contentChanges: [{ text: model.getValue() }]
            });
            if (result && result.ok === false) {
                logWarn('[LSP] didChange 失败:', result.error || '未知错误');
            }
        } catch (err) {
            logWarn('[LSP] 文档变更失败:', err?.message || err);
        } finally {
            this._lspChangeInFlight.delete(model);
            if (this._lspChangePending.delete(model) && !model.isDisposed?.() && this._lspDocuments.has(model)) {
                this.queueLspDidChange(model);
            }
        }
    }

    async closeLspDocument(model) {
        try {
            if (!this.lspClient || !model) return;
            const entry = this._lspDocuments.get(model);
            if (!entry) return;
            this._lspDocuments.delete(model);
            const timer = this._lspChangeTimers.get(model);
            if (timer)…44364 tokens truncated…on.lineNumber,
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
            if (!editor || (typeof editor.isDisposed === 'function' && editor.isDisposed())) {
                return;
            }
            const model = editor?.getModel?.();
            if (!model || (typeof model.isDisposed === 'function' && model.isDisposed())) return;
            const symbol = this.identifySymbolAtPosition(model, position);
            if (!symbol) return;

            if (symbol.kind === 'url') {
                if (symbol.url) {
                    await this.openExternalUrl(symbol.url);
                }
                return;
            }
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
            if (window.electronAPI?.getAllSettings) {
                const all = await window.electronAPI.getAllSettings();
                result.compilerPath = all?.compilerPath || '';
                result.compilerArgs = all?.compilerArgs || '';
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
                    const activated = await window.tabManager.activateTabByUniqueKey(normalizedKey);
                    activatedViaTabManager = activated === true;
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
