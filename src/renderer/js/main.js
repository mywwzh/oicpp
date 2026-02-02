class OICPPApp {
    constructor() {
        this.currentFile = null;
        this.files = new Map();
        this.settings = {
            theme: 'dark',
            fontSize: 14,
            tabSize: 4,
            wordWrap: false,
            enableAutoCompletion: true
        };
        this.editorManager = null;
        this.initialized = false;
        this.accountLoggedIn = false;
        this.accountInfo = null;
        this._accountIpcBound = false;
    this.isDebugging = false;
    this._autoContinueOnStart = false;
    this._debugSessionId = 0;
    this._debugExited = false;
        this.autoSaveController = {
        timerId: null,
        enabled: true,
        intervalMs: 60000,
        running: false
    };
    this.supportedDropTextExtensions = new Set(['cpp', 'c', 'cc', 'cxx', 'h', 'hpp', 'hh', 'txt', 'in', 'out', 'ans', 'md', 'json']);
        this._isWindowsPlatform = undefined;
    }

    async init() {
        try {
            logInfo('开始初始化 OICPP App...');
            if (typeof MonacoEditorManager !== 'undefined') {
                this.editorManager = new MonacoEditorManager();
                window.editorManager = this.editorManager;
                window.monacoEditorManager = this.editorManager;
            } else {
                logError('MonacoEditorManager 类未定义');
                return;
            }
            
            this.compilerManager = new CompilerManager();
            window.compilerManager = this.compilerManager;
            
            let attempts = 0;
            while (attempts < 100) {
                if (this.editorManager.isInitialized) {
                    logInfo('编辑器管理器初始化完成');
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 50));
                attempts++;
            }
            
            if (attempts >= 100) {
                logWarn('编辑器管理器初始化超时，继续其他初始化...');
            }
            
            this.setupEventListeners();
            this.updatePlatformSpecificMenu();
            this.setupIPC();
            await this.initAccountMenu();
            await this.loadSettings();
            this.configureAutoSave();
            this.loadDefaultFiles();
            this.updateStatusBar();
            this.setAppIcon();
            this.initialized = true;
            
            logInfo('OICPP App 初始化完成');
        } catch (error) {
            logError('OICPP App 初始化失败', error);
        }
    }

    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.handleResize();
        });

        document.addEventListener('keydown', (e) => {
            this.handleKeyDown(e);
        });


        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        document.addEventListener('drop', (e) => {
            e.preventDefault();
            this.handleFileDrop(e);
        });

        document.addEventListener('contextmenu', (e) => {
            const isInEditor = e.target.closest('.monaco-editor') || 
                              e.target.closest('.monaco-editor-container') ||
                              e.target.classList.contains('monaco-editor') ||
                              e.target.classList.contains('monaco-editor-container');

            const isInCloudPanel = e.target.closest('#cloud-panel') || e.target.closest('.cloud-tree');
            if (isInCloudPanel) {
                return;
            }
            
            if (isInEditor) {
                return;
            }
            
            e.preventDefault();
            this.showContextMenu(e);
        });

        document.addEventListener('settings-changed', (e) => {
            this.applySettings(e.detail.type, e.detail.settings);
        });

        this.setupMenuBarEvents();
    }

    setupMenuBarEvents() {
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('menu-dropdown-item') || 
                e.target.closest('.menu-dropdown-item')) {
                
                const menuItem = e.target.classList.contains('menu-dropdown-item') ? 
                    e.target : e.target.closest('.menu-dropdown-item');
                
                const action = menuItem.dataset.action;
                if (action) {
                    this.handleMenuAction(action);
                }
            }
        });

        document.addEventListener('mouseover', (e) => {
            if (e.target.classList.contains('menu-item')) {
                document.querySelectorAll('.menu-dropdown.active').forEach(menu => {
                    menu.classList.remove('active');
                });
                const dropdown = e.target.querySelector('.menu-dropdown');
                if (dropdown) {
                    dropdown.classList.add('active');
                }
            }
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.menu-bar')) {
                document.querySelectorAll('.menu-dropdown.active').forEach(menu => {
                    menu.classList.remove('active');
                });
            }
        });
    }

    async handleMenuAction(action) {
        logInfo('菜单动作:', action);
        
        switch (action) {
            case 'new-file':
                this.createNewCppFile();
                break;
            case 'open-file':
                this.openFile();
                break;
            case 'open-folder':
                this.openFolder();
                break;
            case 'save-file':
                this.saveFile();
                break;
            case 'save-as':
                this.saveFileAs();
                break;
            case 'compiler-settings':
                this.openCompilerSettings();
                break;
            case 'editor-settings':
                await this.openEditorSettings();
                break;
            case 'templates':
                this.openTemplateSettings();
                break;
            case 'template-settings':
                this.openTemplateSettings();
                break;
            case 'debug':
                this.startDebug();
                break;
            case 'compile':
                this.compileCode();
                break;
            case 'run':
                this.runCode();
                break;
            case 'format-code':
                this.formatCode();
                break;
            case 'cloud-compile':
                if (!this.ensureLocalFileForFeature('云端编译')) {
                    break;
                }
                if (this.compilerManager && typeof this.compilerManager.cloudCompileCurrentFile === 'function') {
                    this.compilerManager.cloudCompileCurrentFile();
                }
                break;
            case 'find-replace':
                this.showFindReplace();
                break;
            case 'compile-run':
                this.compileAndRun();
                break;
            case 'about':
                this.showAbout();
                break;
            case 'feedback':
                this.showFeedback();
                break;
            case 'check-update':
                this.checkForUpdates();
                break;
            case 'ide-login':
                await this.startIdeLogin();
                break;
            case 'ide-account':
                this.openIdeAccount();
                break;
            case 'ide-logout':
                await this.logoutIdeAccount();
                break;
            default:
                logInfo('未知的菜单动作:', action);
        }
    }

    async initAccountMenu() {
        await this.refreshAccountState();

        if (!window.electronAPI || this._accountIpcBound) {
            return;
        }

        this._accountIpcBound = true;

        if (typeof window.electronAPI.onIdeLoginUpdated === 'function') {
            window.electronAPI.onIdeLoginUpdated((payload) => {
                this.accountLoggedIn = !!payload?.loggedIn;
                this.accountInfo = payload?.user || null;
                this.updateAccountMenu();
                if (payload?.message) {
                    this.showMessage(payload.message, payload.loggedIn ? 'success' : 'info');
                }
            });
        }

        if (typeof window.electronAPI.onIdeLoginError === 'function') {
            window.electronAPI.onIdeLoginError((payload) => {
                const msg = payload?.message || '登录失败';
                this.showMessage(msg, 'error');
            });
        }
    }

    async refreshAccountState() {
        if (!window.electronAPI || typeof window.electronAPI.getIdeLoginStatus !== 'function') {
            this.updateAccountMenu();
            return;
        }
        try {
            const status = await window.electronAPI.getIdeLoginStatus();
            this.accountLoggedIn = !!status?.loggedIn;
            this.accountInfo = status?.user || null;
            logInfo('[Account] 获取登录状态:', {
                loggedIn: this.accountLoggedIn,
                user: this.accountInfo?.username || ''
            });
        } catch (error) {
            logWarn('获取登录状态失败:', error?.message || error);
        }
        this.updateAccountMenu();
    }

    updateAccountMenu() {
        const loginItem = document.querySelector('.menu-dropdown-item[data-action="ide-login"]');
        const accountItem = document.querySelector('.menu-dropdown-item[data-action="ide-account"]');
        const logoutItem = document.querySelector('.menu-dropdown-item[data-action="ide-logout"]');

        try {
            if (window.sidebarManager && typeof window.sidebarManager.setCloudPanelVisible === 'function') {
                window.sidebarManager.setCloudPanelVisible(this.accountLoggedIn);
            }
        } catch (error) {
            logWarn('更新云同步面板可见性失败:', error);
        }
        if (!loginItem || !accountItem || !logoutItem) return;

        const accountLabel = accountItem.querySelector('span') || accountItem;
        const username = this.accountInfo?.username || '';

        if (this.accountLoggedIn) {
            loginItem.style.display = 'none';
            accountItem.style.display = '';
            logoutItem.style.display = '';
            if (accountLabel) {
                accountLabel.textContent = username ? `我的账户(${username})` : '我的账户';
            }
        } else {
            loginItem.style.display = '';
            accountItem.style.display = 'none';
            logoutItem.style.display = 'none';
            if (accountLabel) {
                accountLabel.textContent = '我的账户';
            }
        }

    }

    async startIdeLogin() {
        if (!window.electronAPI || typeof window.electronAPI.startIdeLogin !== 'function') {
            this.showMessage('登录功能不可用', 'error');
            return;
        }
        try {
            const result = await window.electronAPI.startIdeLogin();
            if (result && result.ok === false && result.message) {
                this.showMessage(result.message, 'warning');
            } else {
                this.showMessage('已打开浏览器，请完成登录', 'info');
            }
        } catch (error) {
            this.showMessage('启动登录失败: ' + (error?.message || error), 'error');
        }
    }

    openIdeAccount() {
        if (!this.accountLoggedIn) {
            this.showMessage('请先登录账户', 'warning');
            return;
        }
        if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
            window.electronAPI.openExternal('https://auth.mywwzh.top/account');
        }
    }

    async logoutIdeAccount() {
        if (!window.electronAPI || typeof window.electronAPI.logoutIdeAccount !== 'function') {
            this.showMessage('退出登录不可用', 'error');
            return;
        }
        try {
            const result = await window.electronAPI.logoutIdeAccount();
            if (result && result.ok) {
                this.showMessage('已退出登录', 'success');
            }
        } catch (error) {
            this.showMessage('退出登录失败: ' + (error?.message || error), 'error');
        }
    }

    openFolder() {
        window.electronAPI.openFolder();
    }

    updatePlatformSpecificMenu() {
        try {
            const isWindows = !!(window.process && window.process.platform === 'win32');
            const cloudMenuItem = document.querySelector('.menu-dropdown-item[data-action="cloud-compile"]');
            if (cloudMenuItem) {
                cloudMenuItem.style.display = isWindows ? '' : 'none';
                if (!isWindows) {
                    cloudMenuItem.setAttribute('title', '云编译目前仅在 Windows 版本提供');
                }
            }
        } catch (error) {
            logWarn('更新平台特定菜单失败:', error);
        }
    }

    setupIPC() {
        if (!window.electronAPI) {
            logWarn('Electron IPC 不可用');
            return;
        }
        try {
            window.electronAPI.onMenuSaveFile(() => {
                this.saveCurrentFile();
            });

            window.electronAPI.onMenuFormatCode(() => {
                this.formatCode();
            });

            window.electronAPI.onMenuFindReplace(() => {
                this.showFindReplace();
            });

            window.electronAPI.onMenuCompile(() => {
                this.compileCode();
            });

            window.electronAPI.onMenuCompileRun(() => {
                this.compileAndRun();
            });

            window.electronAPI.onMenuDebug(() => {
                if (this.isDebugging) this.handleDebugContinue();
                else this.startDebug();
            });

            window.electronAPI.onShowDebugDevelopingMessage(() => {
                if (this.isDebugging) this.handleDebugContinue();
                else this.startDebug();
            });

            window.electronAPI.onSettingsChanged((settingsType, newSettings) => {
                logInfo(`收到设置变化通知: ${settingsType}`, newSettings);
                this.applySettings(settingsType, newSettings);
                if (newSettings && Object.prototype.hasOwnProperty.call(newSettings, 'codeSnippets')) {
                    try { window.monacoEditorManager?.refreshUserSnippets?.(); } catch (_) {}
                }
            });
            
            if (window.electronAPI.onThemeChanged) {
                window.electronAPI.onThemeChanged((theme) => {
                    logInfo('收到主题变更通知:', theme);
                    this.settings.theme = theme;
                    this.applyThemeSettings();
                    this.notifyThemeChange(theme);
                });
            }

            window.electronAPI.onSettingsReset((allSettings) => {
                logInfo('收到设置重置通知:', allSettings);
                this.settings = allSettings;
                this.applySettings();
                try { window.monacoEditorManager?.refreshUserSnippets?.(); } catch (_) {}
            });

            window.electronAPI.onSettingsImported((allSettings) => {
                logInfo('收到设置导入通知:', allSettings);
                this.settings = allSettings;
                this.applySettings();
                try { window.monacoEditorManager?.refreshUserSnippets?.(); } catch (_) {}
            });

            window.electronAPI.onFileOpened((event, data) => {
                try { logInfo('[渲染进程] 收到 file-opened:', { fileName: data?.fileName, filePath: data?.filePath, contentBytes: (data?.content || '').length }); } catch (_) {}
                if (data && data.filePath !== undefined && data.content !== undefined) {
                    this.openFile(data.filePath, data.content);
                } else if (typeof data === 'string') {
                    this.openFile(data, '');
                }
            });

            window.electronAPI.onFileSaved((filePath, error) => {
                try { logInfo('[渲染进程] 收到 file-saved:', { filePath, error }); } catch (_) {}
                if (error) {
                    this.showMessage(`保存失败: ${error}`, 'error');
                }
                this.onFileSaved(filePath);
            });

            window.electronAPI.onFolderOpened((folderPath) => {
                this.onFolderOpened(folderPath);
            });

            window.electronAPI.onFileOpenedFromArgs((data) => {
                logInfo('收到命令行文件打开请求:', data);
                if (!data || !data.path) {
                    return;
                }

                const fileName = data.fileName || (data.path.split(/[\\/]/).pop() || 'untitled.cpp');
                const content = data.content ?? '';
                const openOptions = { filePath: data.path };
                if (data.viewType) {
                    openOptions.viewType = data.viewType;
                }

                const tryOpenWithTabManager = () => {
                    if (window.tabManager && typeof window.tabManager.openFile === 'function') {
                        window.tabManager.openFile(fileName, content, false, openOptions);
                        return true;
                    }
                    return false;
                };

                if (tryOpenWithTabManager()) {
                    return;
                }

                let attempts = 0;
                const maxAttempts = 25;
                const interval = setInterval(() => {
                    attempts += 1;
                    if (tryOpenWithTabManager()) {
                        clearInterval(interval);
                        return;
                    }
                    if (attempts >= maxAttempts) {
                        clearInterval(interval);
                        if (this.editorManager && typeof this.editorManager.openFile === 'function') {
                            this.editorManager.openFile(fileName, content);
                        }
                    }
                }, 200);
            });

            window.electronAPI.onApplySettingsPreview((previewSettings) => {
                this.applySettings('editor', previewSettings);
            });

            window.electronAPI.onSettingsApplied((finalSettings) => {;
                this.applySettings('editor', finalSettings);
                this.forceRefreshEditor(); // 强制刷新以应用字体等
                try { window.monacoEditorManager?.refreshUserSnippets?.(); } catch (_) {}
            });

            logInfo('IPC 事件监听器已设置');
        } catch (error) {
            logError('设置IPC失败:', error);
        }
    }

    async loadSettings() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const allSettings = await window.electronAPI.getAllSettings();
                if (allSettings) {
                    this.settings = allSettings;
                    localStorage.removeItem('oicpp-settings');
                } else {
                    logWarn('主进程返回空设置，使用默认设置');
                }
            } else {
                logWarn('electronAPI不可用，使用默认设置');
            }
            this.applySettings();
            
            if (this.compilerManager) {
                this.compilerManager.updateSettings({
                    compilerPath: this.settings.compilerPath || '',
                    compilerArgs: this.settings.compilerArgs || '-std=c++14 -O2 -static'
                });
            }
            
        } catch (error) {
            logError('加载设置失败:', error);
            this.applySettings();
        }
    }

    applySettings(settingsType = null, newSettings = null) {
        if (newSettings) {
            this.settings = { ...this.settings, ...newSettings };
        }
        
        if (window.monacoEditorManager && typeof window.monacoEditorManager.loadKeybindingsFromSettings === 'function') {
            try {
                window.monacoEditorManager.loadKeybindingsFromSettings(this.settings);
            } catch (err) {
                logWarn('应用快捷键设置失败，将使用默认快捷键', err);
            }
        }

        this.updateEditorSettings();
        
        this.applyTheme(this.settings.theme);
        
        if (newSettings && (newSettings.fontSize !== undefined || newSettings.font !== undefined)) {
            this.forceRefreshEditor();
        }
        
        if (this.compilerManager && (newSettings?.compilerPath !== undefined || newSettings?.compilerArgs !== undefined || !settingsType)) {
            this.compilerManager.updateSettings({
                compilerPath: this.settings.compilerPath || '',
                compilerArgs: this.settings.compilerArgs || '-std=c++14 -O2 -static'
            });
        }     

        if (!newSettings || newSettings.autoSave !== undefined || newSettings.autoSaveInterval !== undefined) {
            this.configureAutoSave();
        }
    }
    
    configureAutoSave() {
        if (!this.autoSaveController) {
            this.autoSaveController = {
                timerId: null,
                enabled: true,
                intervalMs: 60000,
                running: false
            };
        }

        const intervalCandidate = Number(this.settings.autoSaveInterval);
        const intervalMs = Number.isFinite(intervalCandidate) && intervalCandidate > 0 ? intervalCandidate : 60000;
        const enabled = this.settings.autoSave !== false;

        this.autoSaveController.intervalMs = Math.max(5000, intervalMs);
        this.autoSaveController.enabled = enabled;

        if (this.autoSaveController.timerId) {
            clearTimeout(this.autoSaveController.timerId);
            this.autoSaveController.timerId = null;
        }

        if (enabled) {
            this.scheduleAutoSave();
        }
    }

    scheduleAutoSave() {
        if (!this.autoSaveController?.enabled) {
            return;
        }

        if (this.autoSaveController.timerId) {
            clearTimeout(this.autoSaveController.timerId);
        }

        this.autoSaveController.timerId = setTimeout(() => this.handleAutoSaveTick(), this.autoSaveController.intervalMs);
    }

    async handleAutoSaveTick() {
        if (!this.autoSaveController?.enabled) {
            return;
        }

        if (this.autoSaveController.running) {
            this.scheduleAutoSave();
            return;
        }

        this.autoSaveController.running = true;
        try {
            const savedCount = await this.performAutoSave();
            if (savedCount > 0) {
                logInfo(`[自动保存] 已保存 ${savedCount} 个文件`);
            }
        } catch (error) {
            logError('[自动保存] 执行失败:', error);
        } finally {
            this.autoSaveController.running = false;
            this.scheduleAutoSave();
        }
    }

    async performAutoSave() {
        try {
            if (window.__oicppDiscardClose) {
                return 0;
            }
        } catch (_) { }
        if (!window.tabManager || typeof window.tabManager.autoSaveModifiedTabs !== 'function') {
            return 0;
        }
        try {
            const count = await window.tabManager.autoSaveModifiedTabs();
            return Number.isFinite(count) ? count : 0;
        } catch (error) {
            logError('[自动保存] TabManager 自动保存失败:', error);
            return 0;
        }
    }

    forceRefreshEditor() {
        try {
            if (window.monacoEditorManager) {
                const settings = {
                    fontSize: this.settings.fontSize,
                    font: this.settings.font,
                    theme: this.settings.theme
                };
                window.monacoEditorManager.updateAllEditorsSettings(settings);
            }
            
            if (window.tabManager && window.tabManager.updateAllEditorsSettings) {
                const settings = {
                    fontSize: this.settings.fontSize,
                    font: this.settings.font,
                    theme: this.settings.theme
                };
                window.tabManager.updateAllEditorsSettings(settings);
            }
        } catch (error) {
            logError('强制刷新编辑器失败:', error);
        }
    }

    applyTheme(theme) {
        const resolvedTheme = typeof theme === 'string' && theme.trim().length > 0 ? theme.trim() : 'dark';
        const body = document.body;
        if (!body) {
            return;
        }

        const root = document.documentElement;
        const titlebar = document.querySelector('.titlebar');
        const normalized = resolvedTheme.toLowerCase();
        const isLightTheme = normalized.includes('light');
        const tone = isLightTheme ? 'light' : 'dark';

        body.setAttribute('data-theme', resolvedTheme);
        body.setAttribute('data-editor-theme', tone);
        body.style.setProperty('color-scheme', tone);
        root?.setAttribute('data-theme', resolvedTheme);
        root?.setAttribute('data-editor-theme', tone);

        const classNames = ['theme-light', 'theme-dark', 'light-theme', 'dark-theme'];
        body.classList.remove(...classNames);
        root?.classList.remove(...classNames);
        const bodyClass = isLightTheme ? 'theme-light' : 'theme-dark';
        const compatClass = isLightTheme ? 'light-theme' : 'dark-theme';
        body.classList.add(bodyClass, compatClass);
        root?.classList.add(bodyClass, compatClass);

        if (titlebar) {
            titlebar.setAttribute('data-theme', resolvedTheme);
        }

        const event = new CustomEvent('theme-changed', {
            detail: { theme: resolvedTheme, tone }
        });
        document.dispatchEvent(event);
    }
    
    applyThemeSettings() {
        this.applyTheme(this.settings.theme);
    }
    
    notifyThemeChange(theme) {
        logInfo('通知主题变更:', theme);
    }

    forceUIRerender() {
        const forceReflow = () => {
            document.body.style.display = 'none';
            void document.body.offsetHeight;
            document.body.style.display = '';

            document.body.style.animation = 'none';
            void document.body.offsetHeight;
            document.body.style.animation = '';
            window.dispatchEvent(new Event('resize'));
        };

        forceReflow();
        setTimeout(forceReflow, 100);
        setTimeout(forceReflow, 500);
        const componentsToUpdate = [
            '.welcome-container',
            '.welcome-page',
            '.welcome-recent-item',
            '.sidebar',
            '.file-item',
            '.folder-item'
        ];

        componentsToUpdate.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                element.style.display = 'none';
                void element.offsetHeight;
                element.style.display = '';
            });
        });
    }
    updateEditorSettings() {
        const editorSettings = {
            font: this.settings.font || 'Consolas',
            fontSize: this.settings.fontSize || 14,
            theme: this.settings.theme || 'dark',
            enableAutoCompletion: this.settings.enableAutoCompletion !== false,
            tabSize: this.settings.tabSize || 4,
            wordWrap: this.settings.wordWrap || false,
            foldingEnabled: this.settings.foldingEnabled !== false,
            stickyScrollEnabled: this.settings.stickyScrollEnabled !== false
        };
        
        if (window.monacoEditorManager && typeof window.monacoEditorManager.updateAllEditorsSettings === 'function') {
            try {
                window.monacoEditorManager.updateAllEditorsSettings(editorSettings);
            } catch (error) {
                logError('通过 Monaco编辑器管理器 更新所有编辑器设置失败:', error);
            }
        }
        if (window.tabManager && typeof window.tabManager.updateAllEditorsSettings === 'function') {
            try {
                window.tabManager.updateAllEditorsSettings(editorSettings);
            } catch (error) {
                logError('通过 tabManager 更新所有编辑器设置失败:', error);
            }
        }
        this.updateEditorCSSVariables(editorSettings);
    }
    
    updateEditorCSSVariables(settings) {
        const root = document.documentElement;
        
        if (settings.font) {
            root.style.setProperty('--editor-font-family', settings.font);
        }
        if (settings.fontSize) {
            root.style.setProperty('--editor-font-size', settings.fontSize + 'px');
        }
    }

    loadDefaultFiles() {
        logInfo('跳过默认文件创建，显示欢迎页面');
    }

    handleResize() {
        if (this.editorManager && this.editorManager.currentEditor) {
            this.editorManager.currentEditor.focus();
        }
    }

    handleKeyDown(e) {
        const isInEditor = e.target.closest('.monaco-editor') || 
                          e.target.closest('.monaco-editor-container') ||
                          e.target.classList.contains('monaco-editor') ||
                          e.target.classList.contains('monaco-editor-container');
        const matches = (action) => {
            return this.editorManager && typeof this.editorManager.doesEventMatchShortcut === 'function'
                ? this.editorManager.doesEventMatchShortcut(e, action)
                : false;
        };
        const isInputLike = this.editorManager && typeof this.editorManager.isInputLikeTarget === 'function'
            ? this.editorManager.isInputLikeTarget(e.target)
            : false;
        const handle = (fn) => {
            e.preventDefault();
            e.stopPropagation();
            fn();
        };
        
        if (isInEditor) {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case 'n':
                        e.preventDefault();
                        this.createNewCppFile();
                        return;
                    case 's':
                        e.preventDefault();
                        this.saveCurrentFile();
                        return;
                    case 'k':
                        e.preventDefault();
                        this.openFolder();
                        return;
                }
            }

            if (matches('toggleDebug')) return handle(() => { this.isDebugging ? this.handleDebugContinue() : this.startDebug(); });
            if (matches('debugContinue') && this.isDebugging) return handle(() => this.handleDebugContinue());
            if (matches('debugStepOver') && this.isDebugging) return handle(() => this.handleDebugStepOver());
            if (matches('debugStepInto') && this.isDebugging) return handle(() => this.handleDebugStepInto());
            if (matches('debugStepOut') && this.isDebugging) return handle(() => this.handleDebugStepOut());
            if (matches('compileAndRun') && !this.isDebugging) return handle(() => this.compileAndRun());
            if (matches('runCode') && !this.isDebugging) return handle(() => this.runCode());
            if (matches('compileCode')) return handle(() => this.compileCode());
            if (matches('cloudCompile') && this.compilerManager && typeof this.compilerManager.cloudCompileCurrentFile === 'function') {
                return handle(() => this.compilerManager.cloudCompileCurrentFile());
            }

            if (e.shiftKey && e.altKey && e.key === 'F') {
                e.preventDefault();
                this.formatCode();
                return;
            }
            return;
        }
        
        if (e.ctrlKey && e.key === 'z') {
            logInfo(`全局Ctrl+Z事件被检测到，目标元素:`, e.target);
            logInfo(`当前活跃编辑器:`, this.editorManager ? this.editorManager.currentEditor : '无');
            logInfo(`当前标签页ID:`, this.editorManager ? this.editorManager.currentTabId : '无');
        }
        
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 'n':
                    e.preventDefault();
                    this.createNewCppFile();
                    break;
                case 's':
                    e.preventDefault();
                    this.saveCurrentFile();
                    break;
                case 'k':
                    e.preventDefault();
                    this.openFolder();
                    break;
            }
        }

        if (!isInputLike) {
            if (matches('toggleDebug')) return handle(() => { this.isDebugging ? this.handleDebugContinue() : this.startDebug(); });
            if (matches('debugContinue') && this.isDebugging) return handle(() => this.handleDebugContinue());
            if (matches('debugStepOver') && this.isDebugging) return handle(() => this.handleDebugStepOver());
            if (matches('debugStepInto') && this.isDebugging) return handle(() => this.handleDebugStepInto());
            if (matches('debugStepOut') && this.isDebugging) return handle(() => this.handleDebugStepOut());
            if (matches('compileAndRun') && !this.isDebugging) return handle(() => this.compileAndRun());
            if (matches('runCode') && !this.isDebugging) return handle(() => this.runCode());
            if (matches('compileCode')) return handle(() => this.compileCode());
            if (matches('cloudCompile') && this.compilerManager && typeof this.compilerManager.cloudCompileCurrentFile === 'function') {
                return handle(() => this.compilerManager.cloudCompileCurrentFile());
            }
        }
    }

    async handleFileDrop(e) {
        const types = Array.from(e?.dataTransfer?.types || []);
        const isTabDrag = types.includes('application/oicpp-tab') || Boolean(window.tabManager?.tabDragInProgress);
        if (isTabDrag) {
            return;
        }

        const files = Array.from(e?.dataTransfer?.files || []);
        if (!files.length) {
            return;
        }

        for (const file of files) {
            try {
                await this.openDroppedFile(file);
            } catch (error) {
                logError('打开拖拽文件失败:', error);
                if (window.dialogManager?.showError) {
                    const displayName = file?.name || '未知文件';
                    window.dialogManager.showError(`无法打开 ${displayName}\n${error?.message || String(error)}`);
                }
            }
        }
    }

    async openDroppedFile(file, options = {}) {
        if (!file && !options?.filePath) {
            return;
        }


        let fileName = null;
        const overrideName = typeof options?.fileName === 'string' && options.fileName.trim()
            ? options.fileName.trim()
            : null;

        if (overrideName) {
            fileName = overrideName;
        } else if (file?.name) {
            fileName = file.name;
        } else if (typeof options?.filePath === 'string' && options.filePath.trim()) {
            const pathParts = options.filePath.trim().split(/[\\\/]/);
            fileName = pathParts.pop() || 'untitled';
        } else {
            fileName = 'untitled';
        }

        const extension = (fileName.split('.').pop() || '').toLowerCase();
        const isPdf = extension === 'pdf';
        const isTextCandidate = this.isSupportedTextFileExtension(extension);

        if (!isPdf && !isTextCandidate) {
            logWarn('拖入的文件类型暂不支持直接打开:', fileName);
            return;
        }

        const base64Override = typeof options?.base64Data === 'string' && options.base64Data.trim()
            ? options.base64Data.trim()
            : null;

        const tabManager = window.tabManager;
        const preferredGroupId = options?.groupId || null;
        const activeGroupId = preferredGroupId || tabManager?.activeGroupId || tabManager?.groupOrder?.[0] || 'group-1';

        const overrideRawPath = typeof options?.filePath === 'string' && options.filePath.trim()
            ? options.filePath.trim()
            : null;
        const normalizedOverridePath = overrideRawPath ? this.normalizeFilePathCandidate(overrideRawPath) : null;
        const fileRawPath = typeof file?.path === 'string' && file.path.trim() ? file.path.trim() : null;
        const normalizedFilePath = fileRawPath ? this.normalizeFilePathCandidate(fileRawPath) : null;

        const candidatePathSet = new Set();
        if (normalizedOverridePath) {
            candidatePathSet.add(normalizedOverridePath);
        }
        if (normalizedFilePath) {
            candidatePathSet.add(normalizedFilePath);
        }
        const candidatePaths = Array.from(candidatePathSet);

        let normalizedPath = null;
        for (const candidate of candidatePaths) {
            if (await this.checkFileExistsSafe(candidate)) {
                normalizedPath = candidate;
                break;
            }
        }
        const fallbackPaths = candidatePaths;

        if (tabManager) {
            if (isPdf) {
                const resolution = await this.ensurePdfFilePath(file, fileName, normalizedPath, base64Override);
                let pdfPath = resolution?.filePath || null;
                let base64Data = resolution?.base64Data || null;
                let isTempFile = Boolean(resolution?.isTempFile);

                if (!pdfPath && !base64Data && base64Override) {
                    base64Data = base64Override;
                }

                if (!pdfPath && !base64Data && fallbackPaths.length > 0 && window.electronAPI?.readFileBuffer) {
                    for (const candidate of fallbackPaths) {
                        if (!candidate) {
                            continue;
                        }
                        try {
                            const fetched = await window.electronAPI.readFileBuffer(candidate);
                            const trimmed = typeof fetched === 'string' ? fetched.trim() : '';
                            if (trimmed) {
                                base64Data = trimmed;
                                const persisted = await this.tryPersistPdfToTemp(fileName, base64Data);
                                if (persisted?.filePath) {
                                    pdfPath = persisted.filePath;
                                    isTempFile = Boolean(persisted.isTempFile);
                                    base64Data = null;
                                }
                                break;
                            }
                        } catch (error) {
                            logWarn('通过主进程读取 PDF 数据失败:', error);
                        }
                    }
                }

                if (!pdfPath && base64Data) {
                    const persisted = await this.tryPersistPdfToTemp(fileName, base64Data);
                    if (persisted?.filePath) {
                        pdfPath = persisted.filePath;
                        isTempFile = Boolean(persisted.isTempFile);
                        base64Data = null;
                    }
                }

                if (!pdfPath && !base64Data) {
                    throw new Error('无法获取 PDF 文件数据');
                }

                await tabManager.openFile(fileName, '', false, {
                    filePath: pdfPath,
                    groupId: activeGroupId,
                    viewType: 'pdf',
                    isTempFile,
                    pdfBase64: base64Data || null
                });
                logInfo('已打开拖拽的 PDF 文件:', fileName);
                return;
            }

            let content = null;
            if (normalizedPath && window.electronAPI?.readFileContent) {
                try {
                    content = await window.electronAPI.readFileContent(normalizedPath);
                } catch (error) {
                    logWarn('通过文件路径读取拖拽内容失败，准备使用浏览器接口:', error);
                    content = null;
                }
            }

            if (typeof content !== 'string' && file && typeof file.text === 'function') {
                content = await file.text();
            }

            await tabManager.openFile(fileName, content ?? '', false, {
                filePath: normalizedPath || null,
                groupId: activeGroupId
            });
            logInfo('已打开拖拽的文件:', fileName);
            return;
        }

        if (file && typeof file.text === 'function') {
            const fallbackContent = await file.text();
            if (this.editorManager) {
                this.editorManager.openFile(fileName, fallbackContent ?? '');
                logInfo('通过备用方案打开拖拽的文件:', fileName);
            }
        } else if (normalizedPath && this.editorManager && window.electronAPI?.readFileContent) {
            const fallbackContent = await window.electronAPI.readFileContent(normalizedPath);
            this.editorManager.openFile(fileName, fallbackContent ?? '');
            logInfo('通过备用方案打开拖拽的文件:', fileName);
        } else if (this.editorManager) {
            this.editorManager.openFile(fileName, '');
            logInfo('通过备用方案打开拖拽的文件:', fileName);
        }
    }

    isSupportedTextFileExtension(ext) {
        if (!ext || !this.supportedDropTextExtensions) {
            return false;
        }
        return this.supportedDropTextExtensions.has(ext);
    }

    async checkFileExistsSafe(filePath) {
        if (!filePath || !window.electronAPI?.checkFileExists) {
            return false;
        }
        try {
            const safePath = this.normalizeFilePathCandidate(filePath);
            if (!safePath) {
                return false;
            }
            return await window.electronAPI.checkFileExists(safePath);
        } catch (error) {
            logWarn('检查文件存在性失败:', error);
            return false;
        }
    }

    async ensurePdfFilePath(file, fileName, existingPath, base64Override = null) {
        if (existingPath) {
            const sanitized = this.normalizeFilePathCandidate(existingPath);
            return { filePath: sanitized || existingPath, isTempFile: false, base64Data: null };
        }

        let inlineBase64 = typeof base64Override === 'string' && base64Override.trim()
            ? base64Override.trim()
            : null;

        if (inlineBase64) {
            const persisted = await this.tryPersistPdfToTemp(fileName, inlineBase64);
            if (persisted?.filePath) {
                return { filePath: persisted.filePath, isTempFile: Boolean(persisted.isTempFile), base64Data: null };
            }
        }

        if (!inlineBase64 && file) {
            try {
                inlineBase64 = await this.readFileAsBase64(file);
                if (inlineBase64) {
                    const persisted = await this.tryPersistPdfToTemp(fileName, inlineBase64);
                    if (persisted?.filePath) {
                        return { filePath: persisted.filePath, isTempFile: Boolean(persisted.isTempFile), base64Data: null };
                    }
                }
            } catch (error) {
                logWarn('获取拖拽 PDF 数据失败:', error);
            }
        }

        if (inlineBase64) {
            return { filePath: null, isTempFile: false, base64Data: inlineBase64 };
        }

        return { filePath: existingPath || null, isTempFile: false, base64Data: null };
    }

    async tryPersistPdfToTemp(fileName, base64Data) {
        if (!window.electronAPI?.saveBinaryTempFile) {
            return null;
        }
        const sanitizedData = typeof base64Data === 'string' ? base64Data.trim() : '';
        if (!sanitizedData) {
            return null;
        }
        try {
            const tempPath = await window.electronAPI.saveBinaryTempFile(fileName, sanitizedData);
            if (tempPath) {
                const normalizedTemp = this.normalizeFilePathCandidate(tempPath);
                return { filePath: normalizedTemp || tempPath, isTempFile: true };
            }
        } catch (error) {
            logWarn('保存 PDF 临时文件失败，准备回退到内联数据:', error);
        }
        return null;
    }

    arrayBufferToBase64(arrayBuffer) {
        try {
            if (!arrayBuffer) {
                return '';
            }
            if (typeof window.Buffer !== 'undefined') {
                return window.Buffer.from(arrayBuffer).toString('base64');
            }
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 1) {
                binary += String.fromCharCode(bytes[i]);
            }
            return btoa(binary);
        } catch (error) {
            logWarn('二进制数据转换 Base64 失败:', error);
            return '';
        }
    }

    isWindowsPlatform() {
        if (this._isWindowsPlatform !== undefined) {
            return this._isWindowsPlatform;
        }
        try {
            const platform = (window.process?.platform || navigator?.platform || '').toLowerCase();
            this._isWindowsPlatform = platform.includes('win');
        } catch (_) {
            this._isWindowsPlatform = false;
        }
        return this._isWindowsPlatform;
    }

    normalizeFilePathCandidate(candidate) {
        if (candidate == null) {
            return '';
        }
        let normalized = typeof candidate === 'string' ? candidate : String(candidate);
        normalized = normalized.trim();
        if (!normalized) {
            return '';
        }

        if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith('\'') && normalized.endsWith('\''))) {
            normalized = normalized.slice(1, -1);
        }

        if (/^file:\/\//i.test(normalized)) {
            try {
                const fileUrl = new URL(normalized);
                if (fileUrl.protocol.toLowerCase() === 'file:') {
                    const isWindows = this.isWindowsPlatform();
                    const host = fileUrl.hostname || '';
                    let pathname = decodeURIComponent(fileUrl.pathname || '');
                    if (host) {
                        if (isWindows) {
                            pathname = `\\\\${host}${pathname.replace(/\//g, '\\')}`;
                        } else {
                            pathname = `//${host}${pathname}`;
                        }
                    } else if (isWindows && pathname.startsWith('/')) {
                        pathname = pathname.slice(1);
                    }
                    normalized = pathname || '';
                }
            } catch (error) {
                logWarn('解析 file:// 路径失败，使用原始值', error);
            }
        }

        normalized = normalized.replace(/\u0000/g, '');
        return normalized;
    }

    async readFileAsArrayBuffer(file) {
        if (!file) {
            return null;
        }
        if (typeof file.arrayBuffer === 'function') {
            try {
                return await file.arrayBuffer();
            } catch (error) {
                logWarn('file.arrayBuffer 读取失败，尝试使用 FileReader', error);
            }
        }

        if (typeof FileReader !== 'undefined') {
            try {
                return await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
                    reader.readAsArrayBuffer(file);
                });
            } catch (error) {
                logWarn('FileReader 读取拖拽文件失败', error);
            }
        }

        return null;
    }

    async readFileAsBase64(file) {
        if (!file) {
            return '';
        }
        try {
            if (typeof file.arrayBuffer === 'function' && typeof window.Buffer !== 'undefined') {
                const buffer = await file.arrayBuffer();
                return window.Buffer.from(buffer).toString('base64');
            }
        } catch (error) {
            logWarn('通过 arrayBuffer 转 Base64 失败，尝试使用 FileReader:', error);
        }

        if (typeof FileReader !== 'undefined') {
            try {
                return await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        const result = reader.result;
                        if (typeof result === 'string') {
                            const commaIndex = result.indexOf(',');
                            resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
                        } else {
                            resolve('');
                        }
                    };
                    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
                    reader.readAsDataURL(file);
                });
            } catch (error) {
                logWarn('通过 readAsDataURL 读取拖拽文件失败:', error);
            }
        }

        const buffer = await this.readFileAsArrayBuffer(file);
        return this.arrayBufferToBase64(buffer);
    }

    showContextMenu(e) {
        logInfo('显示右键菜单');
    }

    async createNewCppFile() {
        logInfo('创建新的C++文件');
        const fileExplorer = window.sidebarManager?.panels?.files;      
        if (!fileExplorer || !fileExplorer.hasWorkspace) {
            logWarn('没有打开的工作区，无法创建新文件');
            if (window.dialogManager) {
                window.dialogManager.showError('请先打开一个工作区文件夹');
            }
            return;
        }
        
        if (fileExplorer.createNewFile) {
            await fileExplorer.createNewFile();
        } else {
            logError('文件管理器不可用，无法创建新文件');
            if (window.dialogManager) {
                window.dialogManager.showError('文件管理器不可用，无法创建新文件');
            }
        }
    }

    openFile(filePath, content) {
        if (typeof filePath === 'string' && typeof content === 'string') {
            try { logInfo('[渲染进程] 直接打开指定文件内容（不弹窗）:', { filePath, contentBytes: content.length }); } catch (_) {}
            const fileName = (filePath.split(/[\\\/]/).pop()) || filePath;
            if (window.tabManager) {
                window.tabManager.openFile(fileName, content, false, filePath);
            } else if (this.editorManager) {
                this.editorManager.openFile(filePath, content);
            } else {
                logWarn('没有可用的编辑器管理器，无法打开文件');
            }
            return;
        }

        if (window.electronAPI) {
            window.electronAPI.openFile();
        } else {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.cpp,.c,.h,.hpp,.cc,.cxx,.txt,.in,.out,.ans';
            input.onchange = (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        if (this.editorManager) {
                            this.editorManager.openFile(file.name, event.target.result);
                        }
                    };
                    reader.readAsText(file);
                }
            };
            input.click();
        }
    }

    openFolder() {
    const isLinux = (window.process && window.process.platform === 'linux');
    if (isLinux && window.folderPicker) {
            window.folderPicker.show({ startPath: this.settings.lastOpen || '/' }).then(sel => {
                if (sel) {
                    if (window.electronAPI) {
            window.electronAPI.openRecentFile ? window.electronAPI.openRecentFile(sel) : this.onFolderOpened(sel);
                    } else {
                        this.onFolderOpened(sel);
                    }
                }
            });
            return;
        }
        if (window.electronAPI) return window.electronAPI.openFolder();
        alert('打开文件夹功能需要在 Electron 环境中运行');
    }

    setWorkspace(path) {
        logInfo('设置工作区:', path);
        if (window.sidebarManager) {
            const fileExplorer = window.sidebarManager.getPanelManager('files');
            if (fileExplorer) {
                fileExplorer.setWorkspace(path);
            }
        }
    }

    clearWorkspace() {
        logInfo('清除工作区');
        if (window.sidebarManager) {
            const fileExplorer = window.sidebarManager.getPanelManager('files');
            if (fileExplorer) {
                fileExplorer.clearWorkspace();
            }
        }
    }

    getActiveFilePath() {
        try {
            const editor = this.editorManager?.currentEditor;
            if (!editor) return null;
            return editor.getFilePath ? editor.getFilePath() : editor.filePath || null;
        } catch (_) {
            return null;
        }
    }

    isCloudFilePath(filePath) {
        if (typeof filePath !== 'string') return false;
        return /^cloud:/i.test(filePath);
    }

    ensureLocalFileForFeature(featureLabel = '该功能') {
        const filePath = this.getActiveFilePath();
        if (this.isCloudFilePath(filePath)) {
            this.showMessage(`云文件仅支持基础编辑与手动保存，请先下载到本地再使用${featureLabel}。`, 'warning');
            return false;
        }
        return true;
    }

    async saveFile() {
        if (this.editorManager && this.editorManager.currentEditor) {
            const content = this.editorManager.currentEditor.getValue();
            const filePath = this.editorManager.currentEditor.getFilePath ? 
                            this.editorManager.currentEditor.getFilePath() : null;
            
            logInfo('保存文件 - 文件路径:', filePath, '内容长度:', content ? content.length : 'undefined');
            if (window.electronAPI) {
                if (filePath) {
                    if (this.isCloudFilePath(String(filePath))) {
                        const ok = await this.saveCloudFileToServer(filePath, content);
                        if (ok && window.tabManager?.markTabAsSavedByUniqueKey) {
                            window.tabManager.markTabAsSavedByUniqueKey(filePath);
                        }
                        return;
                    }
                    logInfo('调用 electronAPI.saveFile 保存到:', filePath);
                    try {
                        await window.electronAPI.saveFile(filePath, content);
                        if (window.tabManager) {
                            if (window.tabManager.markTabAsSavedByUniqueKey) {
                                window.tabManager.markTabAsSavedByUniqueKey(filePath.replace(/\\/g, '/'));
                            } else {
                                const fileName = filePath.split(/[\\/]/).pop();
                                window.tabManager.markTabAsSaved(fileName);
                            }
                        }
                    } catch (e) {
                        logError('保存失败:', e);
                    }
                } else {
                    logInfo('调用 electronAPI.saveAsFile 另存为新文件');
                    try {
                        const newPath = await window.electronAPI.saveAsFile(content);
                        if (newPath) {
                            try {
                                const ed = this.editorManager.currentEditor;
                                ed.filePath = newPath;
                                ed.getFilePath = () => ed.filePath;
                            } catch (_) {}
                            try { window.tabManager?.updateTabPathBySource(null, newPath); } catch (_) {}
                            if (window.tabManager) {
                                if (window.tabManager.markTabAsSavedByUniqueKey) {
                                    window.tabManager.markTabAsSavedByUniqueKey(newPath.replace(/\\/g, '/'));
                                } else {
                                    const fileName = newPath.split(/[\\/]/).pop();
                                    window.tabManager.markTabAsSaved(fileName);
                                }
                            }
                        }
                    } catch (e) {
                        logError('另存为失败:', e);
                    }
                }
            } else {
                const blob = new Blob([content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'untitled.cpp';
                a.click();
                URL.revokeObjectURL(url);
            }
        } else {
            logWarn('保存文件失败: 没有编辑器管理器或当前编辑器');
        }
    }

    saveFileAs() {
        if (this.editorManager && this.editorManager.currentEditor) {
            const content = this.editorManager.currentEditor.getValue();
            if (window.electronAPI) {
                window.electronAPI.saveAsFile(content);
            } else {
                this.saveFile(); // 浏览器环境下等同于保存
            }
        }
    }

    async saveCurrentFile() {

        if (this.editorManager && this.editorManager.currentEditor) {
            const content = this.editorManager.getCurrentContent();
            const filePath = this.editorManager.currentEditor.getFilePath ? 
                            this.editorManager.currentEditor.getFilePath() : null;
            
            if (window.electronAPI && filePath && content !== null) {
                try {
                    if (this.isCloudFilePath(String(filePath))) {
                        const ok = await this.saveCloudFileToServer(filePath, content);
                        if (ok && window.tabManager?.markTabAsSavedByUniqueKey) {
                            window.tabManager.markTabAsSavedByUniqueKey(filePath);
                        }
                        return;
                    }
                    await window.electronAPI.saveFile(filePath, content);
                    if (window.tabManager) {
                        if (window.tabManager.markTabAsSavedByUniqueKey) {
                            window.tabManager.markTabAsSavedByUniqueKey(filePath.replace(/\\/g, '/'));
                        } else {
                            const fileName = filePath.split(/[\\/]/).pop();
                            window.tabManager.markTabAsSaved(fileName);
                        }
                    }
                } catch (e) {
                    logError('保存失败:', e);
                }
            } else {
                const event = new CustomEvent('saveFile', {
                    detail: { 
                        content: content,
                        filePath: filePath
                    }
                });
                document.dispatchEvent(event);
            }
        } else {
            logWarn('保存文件失败: 没有编辑器管理器或当前编辑器');
        }
    }

    openCompilerSettings() {
        if (window.electronAPI && window.electronAPI.openCompilerSettings) {
            window.electronAPI.openCompilerSettings();
        } else if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('open-compiler-settings').catch(error => {
                    logError('打开编译器设置失败:', error);
                });
            } catch (error) {
                logError('IPC 调用失败:', error);
            }
        } else {
            logWarn('无法打开编译器设置：API不可用');
        }
    }

    async openEditorSettings() {
        logInfo('=== openEditorSettings 被调用 ===');
        logInfo('electronAPI 可用性:', !!window.electronAPI);
        logInfo('openEditorSettings 方法可用性:', !!(window.electronAPI && window.electronAPI.openEditorSettings));
        
        if (window.electronAPI && window.electronAPI.openEditorSettings) {
            logInfo('使用 electronAPI.openEditorSettings');
            window.electronAPI.openEditorSettings();
        } else if (typeof require !== 'undefined') {
            logInfo('使用 ipcRenderer.send');
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('open-editor-settings');
        } else {
            logWarn('无法打开编辑器设置：Electron API 不可用');
            await this.showSettingsDialog('editor');
        }
    }

    async saveCloudFileToServer(filePath, content) {
        try {
            const cloudPanel = window.sidebarManager?.getPanelManager?.('cloud') || window.cloudSyncPanel;
            if (!cloudPanel || typeof cloudPanel.saveCloudFile !== 'function') {
                this.showMessage('云同步面板未就绪', 'error');
                return false;
            }
            const cloudPath = String(filePath).replace(/^cloud:\/\//, '/').replace(/^cloud:/i, '/');
            const ok = await cloudPanel.saveCloudFile(cloudPath, content || '');
            if (ok) {
                this.showMessage('云端保存成功', 'success');
            }
            return ok;
        } catch (error) {
            this.showMessage('云端保存失败: ' + (error?.message || error), 'error');
            return false;
        }
    }

    openTemplateSettings() {
        if (window.electronAPI && window.electronAPI.openTemplateSettings) {
            window.electronAPI.openTemplateSettings();
        } else if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('open-template-settings');
        } else {
            logWarn('无法打开模板设置：Electron API 不可用');
            this.showSettingsDialog('templates');
        }
    }

    async showSettingsDialog(type) {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const latestSettings = await window.electronAPI.getAllSettings();
                this.settings = { ...this.settings, ...latestSettings };
                logInfo('设置对话框显示前刷新设置:', this.settings);
            }
        } catch (error) {
            logWarn('刷新设置失败，使用缓存设置:', error);
        }
        
        const dialog = document.createElement('div');
        dialog.className = 'settings-dialog-overlay';
        dialog.innerHTML = `
            <div class="settings-dialog">
                <div class="settings-header">
                    <h2>${this.getSettingsTitle(type)}</h2>
                    <button class="settings-close" id="close-settings-btn">×</button>
                </div>
                <div class="settings-content">
                    ${this.getSettingsContent(type)}
                </div>
                <div class="settings-footer">
                    <button class="settings-cancel" id="cancel-settings-btn">取消</button>
                    <button class="settings-save" id="save-settings-btn" data-type="${type}">保存</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);

        this.setupSettingsDialogListeners(dialog, type);
    }

    setupSettingsDialogListeners(dialog, type) {
        const closeBtn = dialog.querySelector('#close-settings-btn');
        const cancelBtn = dialog.querySelector('#cancel-settings-btn');
        const saveBtn = dialog.querySelector('#save-settings-btn');
        
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                dialog.remove();
            });
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                dialog.remove();
            });
        }
        
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveSettings(type);
            });
        }
        
        if (type === 'compiler') {
            const browseBtn = dialog.querySelector('#browse-compiler-btn');
            const installBtn = dialog.querySelector('#install-compiler-btn');
            
            if (browseBtn) {
                browseBtn.addEventListener('click', () => {
                    this.selectCompilerPath();
                });
            }
            
            if (installBtn) {
                installBtn.addEventListener('click', () => {
                    this.installCompiler();
                });
            }
        }
    }

    getSettingsTitle(type) {
        switch (type) {
            case 'compiler': return '编译器设置';
            case 'editor': return '编辑器设置';
            case 'templates': return '代码模板设置';
            default: return '设置';
        }
    }

    getSettingsContent(type) {
        switch (type) {
            case 'compiler':
                return `
                    <div class="setting-item">
                        <label>编译器路径:</label>
                        <div class="input-group">
                            <input type="text" id="compiler-path" value="${this.settings.compilerPath || ''}" placeholder="选择 g++.exe 路径">
                            <button id="browse-compiler-btn">浏览</button>
                            <button id="install-compiler-btn">安装编译器</button>
                        </div>
                    </div>
                    <div class="setting-item">
                        <label>编译选项:</label>
                        <input type="text" id="compiler-options" value="${this.settings.compilerArgs || '-std=c++14 -O2 -static'}" placeholder="编译选项">
                    </div>
                `;
            case 'editor':
                const currentFont = this.settings.font || 'Consolas';
                const currentTheme = this.settings.theme || 'dark';
                const currentFontSize = this.settings.fontSize || 14;
                
                logInfo('编辑器设置对话框 - 当前设置:', {
                    font: currentFont,
                    theme: currentTheme,
                    fontSize: currentFontSize,
                    allSettings: this.settings
                });
                
                let fontOptions = '';
                if (window.fontDetector && window.fontDetector.getAllAvailableFonts) {
                    const availableFonts = window.fontDetector.getAllAvailableFonts();
                    fontOptions = availableFonts.map(font => 
                        `<option value="${font}" ${currentFont === font ? 'selected' : ''}>${font}</option>`
                    ).join('');
                } else {
                    const defaultFonts = ['Consolas', 'Monaco', 'Courier New', 'Source Code Pro'];
                    fontOptions = defaultFonts.map(font => 
                        `<option value="${font}" ${currentFont === font ? 'selected' : ''}>${font}</option>`
                    ).join('');
                }
                
                return `
                    <div class="setting-item">
                        <label>字体:</label>
                        <select id="editor-font">
                            ${fontOptions}
                        </select>
                    </div>
                    <div class="setting-item">
                        <label>主题:</label>
                        <select id="editor-theme">
                            <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>深色</option>
                            <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>浅色</option>
                        </select>
                    </div>
                    <div class="setting-item">
                        <label>字体大小:</label>
                        <input type="number" id="editor-font-size" value="${currentFontSize}" min="8" max="32">
                    </div>
                    <div class="setting-item">
                        <label style="color: #ff9500;">注意:</label>
                        <span style="color: #cccccc;">更改主题后将自动重启编辑器</span>
                    </div>
                `;
            case 'templates':
                return `
                    <div class="setting-item">
                        <label>C++ 模板:</label>
                        <textarea id="cpp-template" rows="15" style="width: 100%;">${this.settings.cppTemplate || this.getDefaultCppTemplate()}</textarea>
                    </div>
                `;
            default:
                return '';
        }
    }

    getDefaultCppTemplate() {
        return '';
    }
    startDebug() {
        if (!this.ensureLocalFileForFeature('调试')) {
            return;
        }
        logInfo('开始调试');
        if (window.sidebarManager) {
            window.sidebarManager.showPanel('debug');
        }
        
        this.initializeDebugFeatures();
        
        setTimeout(() => {
            this.handleDebugStart();
        }, 100);
    }

    initializeDebugFeatures() {
        if (!window.debugUIInitialized) {
            window.debugUIInitialized = true;
        }
        
        this.setupDebugEventListeners();
        
        this.setupDebugIPC();
    }

    loadDebugUI() {
        logInfo('调试UI采用侧边栏 DebugPanel，跳过外部脚本加载');
        window.debugUIInitialized = true;
    }

    initializeDebugUI() {
        this.setupSimplifiedDebugUI();
    }

    setupSimplifiedDebugUI() {
        logInfo('设置简化版调试UI');
        
        const waitingMessages = document.querySelectorAll('.waiting-debug-message');
        waitingMessages.forEach(msg => {
            msg.textContent = '调试器就绪，等待开始调试...';
        });
        
        this.setupDebugEventListeners();
    }

    setupDebugEventListeners() {
        if (window.debugUI) {
            logInfo('DebugUI已存在，跳过简化版事件监听器设置');
            return;
        }
        
        logInfo('设置简化版调试事件监听器');
        
        const startBtn = document.getElementById('debug-start');
        if (startBtn && !startBtn.hasAttribute('data-debug-listener')) {
            startBtn.addEventListener('click', () => {
                this.handleDebugStart();
            });
            startBtn.setAttribute('data-debug-listener', 'true');
        }

        const debugControls = {
            'debug-continue': () => this.handleDebugContinue(),
            'debug-step-over': () => this.handleDebugStepOver(),
            'debug-step-into': () => this.handleDebugStepInto(),
            'debug-step-out': () => this.handleDebugStepOut(),
            'debug-stop': () => this.handleDebugStop()
        };

        Object.entries(debugControls).forEach(([id, handler]) => {
            const btn = document.getElementById(id);
            if (btn && !btn.hasAttribute('data-debug-listener')) {
                btn.addEventListener('click', handler);
                btn.setAttribute('data-debug-listener', 'true');
            }
        });
    }

    setupDebugIPC() {
        if (typeof require === 'undefined') {
            logWarn('Electron IPC 不可用');
            return;
        }

        try {
            const { ipcRenderer } = require('electron');
            
            if (!window.debugIPCInitialized) {
            ipcRenderer.on('debug-started', (event, data) => {
                logInfo('[前端] 收到debug-started事件:', data);
                this.onDebugStarted(data);
            });
            ipcRenderer.on('debug-stopped', (event, data) => {
                logInfo('[前端] 收到debug-stopped事件:', data);
                this.onDebugStopped(data);
            });
            ipcRenderer.on('debug-running', (event) => {
                logInfo('[前端] 收到debug-running事件');
                this.onDebugRunning();
                try { window.monacoEditorManager?.clearAllExecHighlights?.(); } catch (_) {}
            });

            ipcRenderer.on('debug-program-exited', (event, data) => {
                this.onProgramExited(data);
            });

            ipcRenderer.on('debug-ready-waiting', (event, data) => {
                this.onDebugReadyWaiting(data);
            });

            ipcRenderer.removeAllListeners('debug-breakpoint-hit');
            ipcRenderer.on('debug-breakpoint-hit', (event, data) => {
                this.onBreakpointHit(data);
            });

            ipcRenderer.on('debug-error', (event, error) => {
                this.onDebugError(error);
            });

                ipcRenderer.on('debug-variables-updated', (event, variables) => {
                    this.onVariablesUpdated(variables);
                });

                ipcRenderer.on('debug-callstack-updated', (event, callStack) => {
                    this.onCallStackUpdated(callStack);
                });


                ipcRenderer.on('goto-source-location', async (event, frame) => {
                    try {
                        const file = frame?.file;
                        const line = Number(frame?.line) || 1;
                        if (!file) return;
                        if (window.tabManager && typeof window.tabManager.openFileByPath === 'function') {
                            await window.tabManager.openFileByPath(file);
                        }
                        const ed = window.monacoEditorManager?.getCurrentEditor?.();
                        if (ed && typeof ed.highlightLine === 'function') {
                            ed.highlightLine(line);
                        }
                    } catch (_) {}
                });

                window.debugIPCInitialized = true;
                logInfo('调试IPC监听器已设置');
            }
        } catch (error) {
            logError('设置调试IPC失败:', error);
        }
    }

    async handleDebugStart() {
        logInfo('开始调试会话');
        
        try {
            this.showMessage('检查调试环境...', 'info');
            const gdbStatus = await this.checkGDBAvailability();
            
            if (!gdbStatus.available) {
                this.showMessage(gdbStatus.message, 'error');
                this.showGDBInstallGuide();
                return;
            }
            
            logInfo('GDB检查通过:', gdbStatus.message);
        } catch (error) {
            logError('GDB检查失败:', error);
            this.showMessage('无法检查调试环境。请确保GDB已正确安装。', 'error');
            return;
        }
        
        const currentFile = this.getCurrentFilePath();
        logInfo('当前文件路径:', currentFile);
        
        if (!currentFile) {
            this.showMessage('没有打开的文件可以调试。请先打开一个C++源文件。', 'warning');
            return;
        }

        if (!currentFile.match(/\.(cpp|cc|cxx|c)$/i)) {
            this.showMessage('请打开一个C++源文件进行调试。当前文件不是C++源文件。', 'warning');
            return;
        }

        this.showMessage('正在编译代码，准备调试...', 'info');
        
        try {
            if (!this.compilerManager) {
                this.showMessage('编译器未初始化，无法进行调试', 'error');
                return;
            }

            logInfo('开始编译代码...');
            await this.compileBeforeDebug();
            
            const isWin = navigator.platform.toLowerCase().includes('win');
            let executablePath = currentFile.replace(/\.(cpp|cc|cxx|c)$/i, isWin ? '.exe' : '');
            if (!isWin && executablePath.endsWith('.exe')) {
                const noExt = executablePath.slice(0, -4);
                executablePath = noExt;
            }
            logInfo('检查可执行文件:', executablePath);
            
            await new Promise(resolve => setTimeout(resolve, 500));

            this._autoContinueOnStart = true;
            this.startDebugSession(currentFile);
            
        } catch (error) {
            logError('编译失败:', error);
            this.showMessage('编译失败，无法启动调试。请查看下方编译输出面板。', 'warning');
        }
    }

    async checkGDBAvailability() {
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                return await ipcRenderer.invoke('check-gdb-availability');
            } catch (error) {
                logError('检查GDB可用性失败:', error);
                throw error;
            }
        } else {
            throw new Error('Electron环境不可用');
        }
    }

    showGDBInstallGuide() {
        const container = document.getElementById('debug-variables');
        if (container) {
            container.innerHTML = `
                <div class="debug-error-message" style="padding: 16px; color: #f44747;">
                    <h3>GDB调试器未安装</h3>
                    <p>调试功能需要GDB调试器支持。请安装GDB：</p>
                    <ul style="margin: 10px 0; padding-left: 20px;">
                        <li><strong>Windows:</strong> 安装MinGW-w64或TDM-GCC</li>
                        <li><strong>Linux:</strong> sudo apt install gdb（Ubuntu/Debian）</li>
                    </ul>
                    <p style="margin-top: 16px; font-size: 12px; color: #cccccc;">
                        安装完成后重启IDE即可使用调试功能。
                    </p>
                </div>
            `;
        }
    }

    async compileBeforeDebug() {
        return new Promise((resolve, reject) => {
            logInfo('开始为调试编译代码...');
            
            if (!this.compilerManager) {
                reject(new Error('编译器未初始化'));
                return;
            }
            
            if (!this.settings.compilerPath) {
                if (process.platform !== 'win32') {
                    try {
                        const fs = require('fs');
                        if (fs.existsSync('/bin/g++')) {
                            this.settings.compilerPath = '/bin/g++';
                            logInfo('[调试编译] 自动使用 /bin/g++');
                        }
                    } catch (_) {}
                }
                if (!this.settings.compilerPath) {
                    this.showMessage('请先设置编译器路径', 'warning');
                    try { require('electron').ipcRenderer.send('menu-open-settings'); } catch(_) {}
                    reject(new Error('请先设置编译器路径'));
                    return;
                }
            }
            
            let resolved = false;
            
            const handleCompileResult = (success, error = null) => {
                if (resolved) return;
                resolved = true;
                
                window.removeEventListener('compile-success', handleSuccess);
                window.removeEventListener('compile-error', handleError);
                
                if (success) {
                    logInfo('编译成功，准备启动调试');
                    resolve();
                } else {
                    const msg = this.stringifyError(error);
                    logInfo('编译失败，无法启动调试:');
                    reject(new Error(msg || '编译失败'));
                }
            };
            
            const handleSuccess = (event) => {
                logInfo('收到编译成功事件:', event.detail);
                handleCompileResult(true);
            };
            
            const handleError = (event) => {
                logInfo('收到编译失败事件:', event.detail);
                handleCompileResult(false, event.detail);
            };
            
            window.addEventListener('compile-success', handleSuccess);
            window.addEventListener('compile-error', handleError);
            
            logInfo('调用编译管理器编译当前文件（调试模式）');
            try {
                this.compilerManager.compileCurrentFile({ forDebug: true });
            } catch (error) {
                handleCompileResult(false, error.message);
                return;
            }
            
            setTimeout(() => {
                if (!resolved) {
                    handleCompileResult(false, '编译超时');
                }
            }, 30000); // 30秒超时
        });
    }

    startDebugSession(currentFile) {
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                logInfo('发送start-debug IPC消息，文件:', currentFile);
                
                const breakpoints = this.getBreakpoints();
                logInfo('当前断点:', breakpoints);
                
                ipcRenderer.send('start-debug', currentFile, {
                    breakpoints: breakpoints
                });
                
                this.updateDebugControlsState(true);
                this.showMessage('正在启动调试会话...', 'info');
                this.updateDebugStatus('正在启动调试会话...');
            } catch (error) {
                logError('启动调试失败:', error);
                this.showMessage('启动调试失败: ' + this.stringifyError(error), 'error');
            }
        } else {
            logError('require函数不可用，无法调用IPC');
            this.showMessage('调试功能初始化失败：无法访问系统API', 'error');
        }
    }

    getBreakpoints() {
        try {
            if (window.monacoEditorManager && typeof window.monacoEditorManager.getAllBreakpoints === 'function') {
                const list = window.monacoEditorManager.getAllBreakpoints();
                logInfo('[前端] 当前断点列表:', list);
                return Array.isArray(list) ? list : [];
            }
        } catch (e) {
            logWarn('[前端] 获取断点失败:', e);
        }
        return [];
    }

    getCurrentFilePath() {
        if (window.editorManager) {
            const currentEditor = window.editorManager.getCurrentEditor();
            if (currentEditor && currentEditor.filePath) {
                return currentEditor.filePath;
            }
        }
        
        if (this.editor && this.currentFile) {
            return this.currentFile;
        }
        
        return null;
    }


    updateDebugControlsState(_isDebugging) {
        const ids = [
            'debug-start', 'debug-continue', 'debug-step-over', 'debug-step-into',
            'debug-step-out', 'debug-stop', 'debug-add-watch', 'debug-refresh-vars'
        ];
        ids.forEach((id) => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = false;
        });
    }

    onDebugStarted(data) {
        logInfo('[前端] 调试已启动:', data);
        this.updateDebugControlsState(true);
    this.isDebugging = true;
    this._debugSessionId++;
    this._debugExited = false;
        
        this.updateAllDebugPanels('调试会话已启动，程序已加载');
        
        this.updateDebugStatus('调试器已启动，程序准备运行');
    this.showDebugInfo(`调试会话已启动
        
程序已加载: ${data.executable || data.sourceFile}
状态: 等待运行或断点命中

提示:
- 点击行号设置断点
- 使用F6继续执行
- 使用F7单步执行
- 查看右侧变量面板`);
    }

    onDebugStopped(data) {
        logInfo('[前端] 调试已停止(原始事件):', data);
        const reason = String(data?.reason || '').toLowerCase();
        const isExit = reason.includes('program-exited') || reason === 'exited' || reason.includes('exit');

        if (isExit) {
            this.isDebugging = false;
            this._debugExited = true;
            this.updateDebugControlsState(false);
            this.updateDebugStatus(`程序运行完成，退出码: ${data.exitCode ?? data.code ?? 0}`);
            this.showDebugInfo(`程序运行完成，退出码: ${data.exitCode ?? data.code ?? 0}\n\n程序输出应该在终端窗口中显示。`);
            this.showWaitingMessages();
            try { window.monacoEditorManager?.clearAllExecHighlights?.(); } catch (_) {}
            return;
        }

        if (this._debugExited || !this.isDebugging) {
            logInfo('[前端] 忽略迟到的非退出 stopped 事件');
            return;
        }

        this.isDebugging = true;
        this.updateDebugControlsState(true);

        const file = data?.file || data?.frame?.file || '';
        const line = Number(data?.line || data?.frame?.line || '') || '';
        const fileName = file ? String(file).split(/[\\/]/).pop() : '';
        const where = fileName && line ? ` 在 ${fileName}:${line}` : '';

        const prettyReason = reason.includes('breakpoint') ? '断点处暂停'
                             : reason.includes('end-stepping-range') ? '单步结束已暂停'
                             : reason.includes('signal') ? '收到信号已暂停'
                             : '程序已暂停';

        this.updateDebugStatus(`${prettyReason}${where}`);
        this.showDebugInfo(`${prettyReason}${where}\n\n您可以继续执行(F6)或步过(F7)/步入(F8)/步出(Shift+F8)。`);

        if (file && line) {
            try { this.highlightCurrentLine(file, line); } catch (_) {}
        }
    }

    onDebugRunning() {
        logInfo('[前端] 程序正在运行');
        this.updateDebugStatus('程序正在运行...');
        this.showDebugInfo('程序正在运行，请等待程序执行或命中断点\n\n如果程序需要输入，请在控制台或弹出的终端窗口中输入');
        
        this.clearContinueButtonHighlight();
    }

    clearContinueButtonHighlight() {
        const continueBtn = document.getElementById('debug-continue');
        if (continueBtn) {
            continueBtn.style.animation = '';
            continueBtn.style.background = '';
            continueBtn.style.transform = '';
            continueBtn.title = '继续执行 (F6)';
        }
    }

    onProgramExited(data) {
        logInfo('[前端] 程序已退出:', data);
        this.updateDebugStatus(`程序执行完成，退出码: ${data.exitCode}`);
        this.showDebugInfo(`程序执行完成，退出码: ${data.exitCode}`);
    this.isDebugging = false;
    }

    onDebugReadyWaiting(data) {
        logInfo('[前端] 调试器就绪等待:', data);
        this.updateDebugStatus('调试器已就绪，等待启动程序');
        
    const message = `调试器已成功启动并准备就绪！

${data.message || '程序已加载，等待开始执行'}

操作提示:
- 点击 "继续执行" 按钮 (▶️) 或按 F6 开始运行程序
- 如果设置了断点，程序会在断点处停止
- 如果没有断点，程序会正常运行到结束

当前状态: ${data.hasBreakpoints ? '已设置断点' : '未设置断点'}`;
        
        this.showDebugInfo(message);
        
        this.highlightContinueButton();

        if (this._autoContinueOnStart) {
            this._autoContinueOnStart = false;
            setTimeout(() => {
                try { this.handleDebugContinue(); } catch (_) {}
            }, 200);
        }
    }

    highlightContinueButton() {
        const continueBtn = document.getElementById('debug-continue');
        if (continueBtn) {
            this.addPulseAnimation();
            
            continueBtn.style.animation = 'debug-pulse 2s infinite';
            continueBtn.style.background = '#0078d4';
            continueBtn.style.transform = 'scale(1.05)';
            continueBtn.title = '点击开始运行程序 (F6)';
            
            setTimeout(() => {
                continueBtn.style.animation = '';
                continueBtn.style.background = '';
                continueBtn.style.transform = '';
                continueBtn.title = '继续执行 (F6)';
            }, 5000);
        }
    }

    addPulseAnimation() {
        if (!document.getElementById('debug-pulse-animation')) {
            const style = document.createElement('style');
            style.id = 'debug-pulse-animation';
            style.textContent = `
                @keyframes debug-pulse {
                    0% { 
                        transform: scale(1); 
                        box-shadow: 0 0 0 0 rgba(0, 120, 212, 0.7); 
                    }
                    50% { 
                        transform: scale(1.05); 
                        box-shadow: 0 0 0 10px rgba(0, 120, 212, 0); 
                    }
                    100% { 
                        transform: scale(1); 
                        box-shadow: 0 0 0 0 rgba(0, 120, 212, 0); 
                    }
                }
            `;
            document.head.appendChild(style);
        }
    }

    updateAllDebugPanels(message) {
        const containers = ['local-variables', 'global-variables', 'watch-variables', 'call-stack'];
        containers.forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                container.innerHTML = `<div class="debug-panel-message" style="padding: 8px; color: #cccccc; font-size: 12px;">${message}</div>`;
            }
        });

        this.showDebugInfo(message);
    }

    onDebugError(error) {
        const msg = this.stringifyError(error) || '';
        const lower = msg.toLowerCase();
    if (/running|not\s*stopped|already\s*running|already\s*started|target\s+is\s+executing|debugger\s+not\s+running|调试器未运行/.test(lower)) {
            logInfo('收到良性调试提示:', msg);
            this.updateDebugStatus('程序正在运行...');
            return;
        }
        logError('调试错误:', error);
        this.showMessage('调试错误: ' + msg, 'error');
        this.updateDebugControlsState(false);
    }

    onVariablesUpdated(variables) {
        logInfo('变量已更新');
        if (this.isModernDebugPanelMounted()) {
            return;
        }
        this.updateVariablesDisplay(variables);
    }

    onCallStackUpdated(callStack) {
        logInfo('调用堆栈已更新');
        if (this.isModernDebugPanelMounted()) {
            return;
        }
        this.updateCallStackDisplay(callStack);
    }

    isModernDebugPanelMounted() {
        try {
            const panelManager = window.sidebarManager?.getPanelManager?.('debug');
            return Boolean(panelManager?.root && panelManager.root.isConnected);
        } catch (_) {
            return false;
        }
    }

    onBreakpointHit(breakpoint) {
        logInfo('[前端] 断点命中');
        try {
            const overlays = Array.from(document.querySelectorAll('.settings-dialog-overlay, .about-dialog-overlay, .update-dialog-overlay'));
            overlays.forEach(el => {
                const hasDialog = !!el.querySelector('.settings-dialog, .about-dialog, .update-dialog');
                if (!hasDialog) el.remove();
            });
        } catch (_) {}

        const fileName = breakpoint.file ? breakpoint.file.split(/[\\/]/).pop() : '未知文件';
        this.updateDebugStatus(`断点命中: ${fileName}:${breakpoint.line} (${breakpoint.function || '未知函数'})`);
        
    const debugInfo = `断点命中！

文件: ${fileName}
行号: ${breakpoint.line}
函数: ${breakpoint.function || '未知函数'}

程序已暂停，您可以：
- 查看右侧变量面板中的当前变量值
- 使用F6继续执行
- 使用F7单步执行
- 使用F8步入函数`;
        
        this.showDebugInfo(debugInfo);
        
        this.clearWaitingMessages();
        
        this.highlightCurrentLine(breakpoint.file, breakpoint.line);
        try {
            document.querySelectorAll('.message-toast').forEach(n => n.style.pointerEvents = 'none');
        } catch (_) {}
    }

    highlightCurrentLine(file, line) {
        try {
            if (window.editorManager && window.editorManager.currentEditor) {
                const currentEditor = window.editorManager.currentEditor;
                if (currentEditor.highlightLine) {
                    currentEditor.highlightLine(line);
                }
            }
        } catch (error) {
            logWarn('[前端] 高亮当前行失败:', error);
        }
    }

    clearWaitingMessages() {
        const containers = ['local-variables', 'global-variables', 'watch-variables', 'call-stack'];
        containers.forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                const waitingMsg = container.querySelector('.waiting-debug-message');
                if (waitingMsg) {
                    waitingMsg.style.display = 'none';
                }
            }
        });
    }

    showWaitingMessages() {
        const containers = ['local-variables', 'global-variables', 'watch-variables', 'call-stack'];
        containers.forEach(id => {
            const container = document.getElementById(id);
            if (container) {
                container.innerHTML = '<div class="waiting-debug-message">等待开始调试...</div>';
            }
        });
    }

    updateDebugStatus(message) {
        const statusElement = document.querySelector('.debug-status');
        if (statusElement) {
            statusElement.textContent = message;
        }
        
        logInfo('[调试状态]', message);
    }

    showDebugInfo(message) {
        const container = document.getElementById('debug-variables');
        if (container) {
            let infoElement = container.querySelector('.debug-info-message');
            if (!infoElement) {
                infoElement = document.createElement('div');
                infoElement.className = 'debug-info-message';
                infoElement.style.cssText = `
                    padding: 16px; 
                    color: #cccccc; 
                    background: #252526; 
                    border: 1px solid #464647; 
                    border-radius: 4px; 
                    margin: 8px;
                    font-size: 14px;
                    line-height: 1.5;
                `;
                container.insertBefore(infoElement, container.firstChild);
            }
            
            infoElement.innerHTML = `
                <h4 style="margin: 0 0 8px 0; color: #4fc3f7;">调试状态</h4>
                <p style="margin: 0; white-space: pre-line;">${message}</p>
            `;
        }
    }

    updateVariablesDisplay(variables) {
        if (this.isModernDebugPanelMounted()) {
            return;
        }
        if (variables.local) {
            this.renderVariables('local-variables', variables.local, 'local');
        }
        
        if (variables.global) {
            this.renderVariables('global-variables', variables.global, 'global');
        }
        
        if (variables.watches) {
            this.renderVariables('watch-variables', variables.watches, 'watch');
        }
    }

    renderVariables(containerId, variables, scope) {
        if (this.isModernDebugPanelMounted()) {
            return;
        }
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        
        if (Object.keys(variables).length === 0) {
            container.innerHTML = '<div class="no-debug-message">没有变量</div>';
            return;
        }

        Object.entries(variables).forEach(([name, data]) => {
            const variableElement = this.createVariableElement(name, data, scope);
            container.appendChild(variableElement);
        });
    }

    createVariableElement(name, data, scope) {
        const element = document.createElement('div');
        element.className = 'variable-item';
        
        const hasChildren = data.children && data.children.length > 0;
        
        element.innerHTML = `
            <div class="variable-header">
                ${hasChildren ? '<span class="expand-toggle">▶</span>' : '<span class="expand-spacer"></span>'}
                <span class="variable-name" title="${data.type || 'unknown'}">${name}</span>
                <span class="variable-value" title="${data.value || ''}">${this.formatVariableValue(data)}</span>
                ${scope === 'watch' ? '<button class="remove-watch-btn" title="移除监视">×</button>' : ''}
            </div>
        `;
        
        return element;
    }

    formatVariableValue(data) {
        if (!data.value) return '';
        
        let displayValue = data.value.toString();
        
        if (data.isContainer || data.isArray) {
            const count = data.elementCount !== null ? data.elementCount : '?';
            const type = data.isArray ? '数组' : '容器';
            displayValue = `${type}[${count}] ${displayValue}`;
        }
        
        if (displayValue.length > 50) {
            displayValue = displayValue.substring(0, 47) + '...';
        }
        
        return displayValue;
    }

    updateCallStackDisplay(callStack) {
        if (this.isModernDebugPanelMounted()) {
            return;
        }
        const container = document.getElementById('call-stack');
        if (!container) return;

        if (!callStack || callStack.length === 0) {
            container.innerHTML = '<div class="no-debug-message">没有调用堆栈信息</div>';
            return;
        }

        container.innerHTML = '';
        
        callStack.forEach((frame, index) => {
            const frameElement = document.createElement('div');
            frameElement.className = 'callstack-item';
            frameElement.innerHTML = `
                <div class="frame-info">
                    <span class="frame-index">#${index}</span>
                    <span class="frame-function">${frame.function || '未知函数'}</span>
                </div>
                <div class="frame-location">
                    <span class="frame-file">${frame.file || '未知文件'}</span>
                    ${frame.line ? `<span class="frame-line">:${frame.line}</span>` : ''}
                </div>
            `;
            
            container.appendChild(frameElement);
        });
    }

    showDebugError(message) {
        const container = document.getElementById('debug-variables');
        if (container) {
            container.innerHTML = `
                <div class="debug-error-message" style="padding: 16px; color: #f44747;">
                    <p><strong>调试功能错误</strong></p>
                    <p>${message}</p>
                    <p style="margin-top: 8px; font-size: 11px; color: #cccccc;">
                        请检查GDB是否已安装，代码是否已编译（使用-g选项）
                    </p>
                </div>
            `;
        }
    }

    stringifyError(err) {
        try {
            if (!err) return '未知错误';
            if (typeof err === 'string') return err;
            if (err instanceof Error) return err.message || err.toString();
            if (err.detail) return this.stringifyError(err.detail);
            if (err.result) {
                const r = err.result;
                if (Array.isArray(r.errors) && r.errors.length) return r.errors.join('\n');
                if (typeof r.stderr === 'string' && r.stderr.trim()) return r.stderr;
                if (typeof r.stdout === 'string' && r.stdout.trim()) return r.stdout;
                if (typeof r.message === 'string') return r.message;
            }
            if (typeof err.error === 'string') return err.error;
            if (err.error) return this.stringifyError(err.error);
            if (typeof err.message === 'string') return err.message;
            return JSON.stringify(err);
        } catch (_) {
            try { return String(err); } catch { return '未知错误'; }
        }
    }

    handleDebugContinue() {
        logInfo('继续执行调试');
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('debug-continue');
        }
    }

    handleDebugStepOver() {
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('debug-step-over');
        }
    }

    handleDebugStepInto() {
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('debug-step-into');
        }
    }

    handleDebugStepOut() {
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('debug-step-out');
        }
    }

    handleDebugStop() {
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('stop-debug');
        }
    }

    handleAddWatch() {
        const variableName = prompt('请输入要监视的变量名或表达式：\n例如：myVar, array[0], obj.member');
        if (variableName && variableName.trim()) {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                ipcRenderer.send('debug-add-watch', variableName.trim());
                this.showMessage(`已添加监视变量: ${variableName.trim()}`, 'info');
            }
        }
    }

    handleRefreshVariables() {
        if (typeof require !== 'undefined') {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('debug-request-variables');
        }
    }

    toggleCategory(header) {
        const arrow = header.querySelector('.expand-arrow');
        const content = header.nextElementSibling;
        
        if (content && arrow) {
            if (content.style.display === 'none') {
                content.style.display = 'block';
                arrow.textContent = '▼';
            } else {
                content.style.display = 'none';
                arrow.textContent = '▶';
            }
        }
    }

    compileCode() {
        if (!this.ensureLocalFileForFeature('编译')) {
            return;
        }
        if (this.compilerManager) {
            this.compilerManager.compileCurrentFile();
        }
    }

    runCode() {
        if (!this.ensureLocalFileForFeature('运行')) {
            return;
        }
        if (this.compilerManager) {
            this.compilerManager.runCurrentFile();
        }
    }

    showFeedback() {
        const dialog = document.createElement('div');
        dialog.className = 'about-dialog-overlay';
        dialog.innerHTML = `
            <div class="about-dialog">
                <div class="about-header">
                    <div class="about-logo">
                        <img id="feedback-dialog-icon" src="" width="48" height="48" alt="OICPP IDE">
                    </div>
                    <h2>用户反馈</h2>
                </div>
                <div class="about-content">
                    <div class="feedback-section">
                        <p class="feedback-description">点击按钮打开 GitHub Issues，如打不开请搜索"github 打不开"解决。</p>
                        <div class="feedback-actions">
                            <button id="open-github-btn" class="feedback-btn primary">打开 GitHub Issues</button>
                        </div>
                    </div>
                </div>
                <div class="about-footer">
                    <button id="feedback-close-btn">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        this.setFeedbackDialogIcon();
        
        this.setupFeedbackDialogListeners(dialog);
    }

    async setFeedbackDialogIcon() {
        try {
            if (window.electronAPI && window.electronAPI.getUserIconPath) {
                const iconPath = await window.electronAPI.getUserIconPath();
                const iconElement = document.querySelector('#feedback-dialog-icon');
                if (iconElement && iconPath) {
                    iconElement.src = iconPath;
                }
            }
        } catch (error) {
            logInfo('无法获取应用图标路径，使用默认图标');
        }
    }

    setupFeedbackDialogListeners(dialog) {
        const closeBtn = dialog.querySelector('#feedback-close-btn');
        closeBtn.addEventListener('click', () => {
            dialog.remove();
        });

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                dialog.remove();
            }
        });

        const openGithubBtn = dialog.querySelector('#open-github-btn');
        openGithubBtn.addEventListener('click', async () => {
            const url = 'https://github.com/mywwzh/oicpp/issues';
            try {
                logInfo('[主进程] 检查 window.electron:', typeof window.electron);
                logInfo('[主进程] 检查 window.electron.shell:', typeof window.electron?.shell);
                logInfo('[主进程] 检查 window.electron.shell.openExternal:', typeof window.electron?.shell?.openExternal);

                if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
                    await window.electronAPI.openExternal(url);
                } else if (window.electron && window.electron.shell && typeof window.electron.shell.openExternal === 'function') {
                    window.electron.shell.openExternal(url);
                } else if (typeof window.open === 'function') {
                    window.open(url, '_blank');
                } else {
                    alert('无法自动打开外部链接。请访问：\n' + url);
                }
            } catch (error) {
                logError('[主进程] 打开GitHub Issues时出错:', error || {});
                alert('无法打开外部链接。请访问：\n' + url);
            }
            dialog.remove();
        });
    }



    async showAbout() {
        const fallbackBuildInfo = { version: '1.3.0 (v26)', buildTime: '未知', author: 'mywwzh' };
        let buildInfo = { ...fallbackBuildInfo };
        try {
            const buildInfoData = window.electronAPI ? await window.electronAPI.getBuildInfo() : null;
            if (buildInfoData) {
                buildInfo = buildInfoData;
            }
        } catch (error) {
            logWarn('无法读取构建信息:', error);
        }

        let versionLabel = typeof buildInfo.version === 'string' && buildInfo.version.trim()
            ? buildInfo.version.trim()
            : fallbackBuildInfo.version;

        if (!/\(v[^)]+\)/i.test(versionLabel)) {
            const tag = buildInfo.buildTag || buildInfo.buildVersion || buildInfo.buildNo;
            if (typeof tag === 'string' && tag.trim()) {
                const normalizedTag = tag.trim().startsWith('v') ? tag.trim() : `v${tag.trim()}`;
                versionLabel = `${versionLabel} (${normalizedTag})`;
            } else {
                const fallbackMatch = fallbackBuildInfo.version.match(/\(v[^)]+\)/i);
                if (fallbackMatch && fallbackMatch[0]) {
                    versionLabel = `${versionLabel} ${fallbackMatch[0]}`;
                }
            }
        }

        const dialog = document.createElement('div');
        dialog.className = 'about-dialog-overlay';
        dialog.innerHTML = `
            <div class="about-dialog">
                <div class="about-header">
                    <div class="about-logo">
                        <img id="about-dialog-icon" src="" width="48" height="48" alt="OICPP IDE">
                    </div>
                    <h2>关于 OICPP IDE</h2>
                </div>
                <div class="about-content">
                    <div class="about-info">
                        <p><strong>版本:</strong> ${versionLabel}</p>
                        <p><strong>构建时间:</strong> ${buildInfo.buildTime}</p>
                        <p><strong>开发者:</strong> ${buildInfo.author}</p>
                        <p><strong>描述:</strong> 专为 OI 选手优化的 C++ 开发环境</p>
                    </div>
                </div>
                <div  class="about-footer">
                    <button id="about-close-btn">关闭</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        this.setAboutDialogIcon();
        this.setFeedbackDialogIcon();
        this.setupAboutDialogListeners(dialog);
        
    }

    async setAboutDialogIcon() {
        try {
            const userIconPath = await window.electronAPI.getUserIconPath();
            const aboutIcon = document.getElementById('about-dialog-icon');
            if (aboutIcon) {
                aboutIcon.src = userIconPath;
            }
        } catch (error) {
            logWarn('无法设置关于对话框图标:', error);
        }
    }

    async setAppIcon() {
        try {
            const userIconPath = await window.electronAPI.getUserIconPath();
            const appIcon = document.getElementById('app-icon');
            if (appIcon) {
                appIcon.src = userIconPath;
            }
        } catch (error) {
            logWarn('无法设置应用图标:', error);
        }
    }

    setupAboutDialogListeners(dialog) {
        const closeBtn = dialog.querySelector('#about-close-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                dialog.remove();
            });
        }

        dialog.addEventListener('click', (e) => {
            if (e.target === dialog) {
                dialog.remove();
            }
        });
    }

    checkForUpdates() {
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');
                logInfo('[渲染进程] 触发手动检查更新');
                
                ipcRenderer.send('check-updates-manual');
                
                this.showUpdateCheckingDialog();
            } catch (error) {
                logError('[渲染进程] 检查更新失败:', error);
                alert('检查更新功能暂时不可用');
            }
        } else {
            logWarn('[渲染进程] Electron环境不可用，无法检查更新');
            alert('检查更新功能仅在Electron环境中可用');
        }
    }

    showUpdateCheckingDialog() {
        const dialog = document.createElement('div');
        dialog.className = 'update-dialog-overlay';
        dialog.id = 'update-checking-dialog';
        dialog.innerHTML = `
            <div class="update-dialog">
                <div class="update-header">
                    <h3>检查更新</h3>
                </div>
                <div class="update-content">
                    <div class="update-spinner"></div>
                    <p>正在检查更新，请稍候...</p>
                </div>
                <div class="update-footer">
                    <button onclick="this.parentElement.parentElement.parentElement.remove()">取消</button>
                </div>
            </div>
        `;
        document.body.appendChild(dialog);
        
        setTimeout(() => {
            const dialogElement = document.getElementById('update-checking-dialog');
            if (dialogElement) {
                dialogElement.remove();
            }
        }, 3000);
    }

    async saveSettings(type) {
        const dialog = document.querySelector('.settings-dialog-overlay');
        if (!dialog) return;
        
        const newSettings = {};
        
        switch (type) {
            case 'compiler':
                const compilerPath = dialog.querySelector('#compiler-path')?.value || '';
                const compilerOptions = dialog.querySelector('#compiler-options')?.value || '-std=c++14 -O2 -static';
                newSettings.compilerPath = compilerPath;
                newSettings.compilerArgs = compilerOptions;
                break;
            case 'editor':
                const font = dialog.querySelector('#editor-font')?.value || 'Consolas';
                const theme = dialog.querySelector('#editor-theme')?.value || 'dark';
                const fontSize = parseInt(dialog.querySelector('#editor-font-size')?.value || '14');
                
                logInfo('保存编辑器设置 - 读取到的值:', {
                    font,
                    theme,
                    fontSize,
                    fontSizeInputValue: dialog.querySelector('#editor-font-size')?.value
                });
                
                const themeChanged = theme !== this.settings.theme;
                logInfo('主题变化检测:', { oldTheme: this.settings.theme, newTheme: theme, changed: themeChanged });
                
                newSettings.font = font;
                newSettings.theme = theme;
                newSettings.fontSize = fontSize;
                
                if (themeChanged) {
                    logInfo('检测到主题变化，将在保存后重启编辑器');
                    newSettings._shouldRestart = true;
                }
                break;
            case 'templates':
                const cppTemplate = dialog.querySelector('#cpp-template')?.value || this.getDefaultCppTemplate();
                newSettings.cppTemplate = cppTemplate;
                break;
            default:
                logWarn('未知的设置类型:', type);
                return;
        }
        
        try {
            if (window.electronAPI && window.electronAPI.updateSettings) {
                const result = await window.electronAPI.updateSettings(newSettings);
                if (result.success) {
                    logInfo(`${type} 设置已保存:`, newSettings);
                    
                    Object.assign(this.settings, newSettings);
                    
                    if (newSettings._shouldRestart) {
                        logInfo('检测到需要重启，正在重启应用...');
                        this.showMessage('主题已更改，正在重启编辑器...', 'info');
                        
                        setTimeout(() => {
                            if (window.electronAPI && window.electronAPI.relaunchApp) {
                                window.electronAPI.relaunchApp();
                            } else {
                                window.location.reload();
                            }
                        }, 1000);
                        return; // 不执行后续的应用设置和消息显示
                    }
                    
                    this.applySettings(type, newSettings);
                    
                    this.showMessage(`${type} 设置已保存`, 'success');
                } else {
                    throw new Error(result.error || '保存失败');
                }
            } else {
                localStorage.setItem(`oicpp_settings_${type}`, JSON.stringify({[type]: newSettings}));
                logInfo(`${type} 设置已保存到本地:`, newSettings);
                this.showMessage(`${type} 设置已保存`, 'success');
            }
        } catch (error) {
            logError('保存设置失败:', error);
            this.showMessage('保存设置失败: ' + error.message, 'error');
        }
        
        dialog.remove();
    }

    async selectCompilerPath() {
        try {
            if (window.electronAPI && window.electronAPI.showOpenDialog) {
                const result = await window.electronAPI.showOpenDialog({
                    title: '选择编译器',
                    filters: [
                        { name: '可执行文件', extensions: ['exe'] },
                        { name: '所有文件', extensions: ['*'] }
                    ],
                    properties: ['openFile']
                });
                
                if (!result.canceled && result.filePaths.length > 0) {
                    const compilerPath = result.filePaths[0];
                    const pathInput = document.querySelector('#compiler-path');
                    if (pathInput) {
                        pathInput.value = compilerPath;
                    }
                }
            } else {
                this.showMessage('文件选择功能不可用', 'error');
            }
        } catch (error) {
            logError('选择编译器路径失败:', error);
            this.showMessage('选择编译器路径失败: ' + error.message, 'error');
        }
    }

    collectCompilerSettings(dialog) {
        const settings = {};
        const inputs = dialog.querySelectorAll('input, select');
        inputs.forEach(input => {
            if (input.name) {
                settings[input.name] = input.value;
            }
        });
        return settings;
    }

    collectEditorSettings(dialog) {
        const settings = {};
        const inputs = dialog.querySelectorAll('input, select');
        inputs.forEach(input => {
            if (input.name) {
                if (input.type === 'checkbox') {
                    settings[input.name] = input.checked;
                } else if (input.type === 'number') {
                    settings[input.name] = parseInt(input.value);
                } else {
                    settings[input.name] = input.value;
                }
            }
        });
        return settings;
    }

    collectTerminalSettings(dialog) {
        const settings = {};
        const inputs = dialog.querySelectorAll('input, select');
        inputs.forEach(input => {
            if (input.name) {
                if (input.type === 'checkbox') {
                    settings[input.name] = input.checked;
                } else {
                    settings[input.name] = input.value;
                }
            }
        });
        return settings;
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
            font-size: 14px;
            z-index: 10000;
            animation: slideIn 0.3s ease-out;
            pointer-events: none; /* 不拦截点击，避免阻塞交互 */
            max-width: 380px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.25);
        `;
        
        if (type === 'success') {
            messageDiv.style.backgroundColor = '#4CAF50';
        } else if (type === 'error') {
            messageDiv.style.backgroundColor = '#f44336';
        } else {
            messageDiv.style.backgroundColor = '#2196F3';
        }
        
        try {
            if (type === 'error') {
                const errObj = message instanceof Error ? message : new Error(String(message));
                logError('[UIToastError]', { message: String(message), stack: errObj.stack });
            }
        } catch (_) {}
        document.body.appendChild(messageDiv);
        
        setTimeout(() => {
            messageDiv.remove();
        }, 3000);
    }

    updateStatusBar() {
        const statusBar = document.querySelector('.status-bar');
        if (statusBar) {
            const cursor = statusBar.querySelector('.cursor-position');
            const encoding = statusBar.querySelector('.encoding');
            const language = statusBar.querySelector('.language');
            
            if (this.editorManager && this.editorManager.currentEditor) {
                const editor = this.editorManager.currentEditor;
                const pos = editor.cursorPosition || { line: 1, column: 1 };
                
                if (cursor) cursor.textContent = `行 ${pos.line}, 列 ${pos.column}`;
                if (encoding) encoding.textContent = 'UTF-8';
                if (language) language.textContent = 'C++';
            }
        }
    }

    onFileSaved(filePath) {
        logInfo('文件已保存:', filePath);
        if (this.editorManager) {
            this.editorManager.markFileSaved(filePath);
        }
        
        if (window.tabManager) {
            if (window.tabManager.markTabAsSavedByUniqueKey) {
                window.tabManager.markTabAsSavedByUniqueKey(filePath);
            } else {
                const fileName = typeof filePath === 'string' ? filePath.split(/[\\/]/).pop() : '';
                if (fileName) window.tabManager.markTabAsSaved(fileName);
            }
        }
    }

    onFolderOpened(folderPath) {
        logInfo('文件夹已打开:', folderPath);
        
        if (window.tabManager && window.tabManager.tabs.has('Welcome')) {
            logInfo('自动关闭欢迎页面');
            window.tabManager.closeWelcomePage();
        }
        
        if (window.sidebarManager) {
            const fileExplorer = window.sidebarManager.getPanelManager('files');
            if (fileExplorer) {
                fileExplorer.setWorkspace(folderPath);
            }
            
            window.sidebarManager.showPanel('files');
        }
        
        const event = new CustomEvent('workspace-opened', {
            detail: { folderPath: folderPath }
        });
        document.dispatchEvent(event);
    }

    async formatCode() {
        if (!this.ensureLocalFileForFeature('格式化')) {
            return;
        }
        if (this.editorManager && this.editorManager.formatCode) {
            try {
                const success = await this.editorManager.formatCode();
                if (success) {
                    logInfo('代码格式化成功');
                } else {
                    logInfo('代码格式化失败');
                }
            } catch (error) {
                logError('代码格式化出错:', error);
            }
        } else {
            logInfo('编辑器管理器不可用或不支持代码格式化功能');
        }
    }

    showFindReplace() {
        if (this.editorManager && this.editorManager.currentEditor) {
            this.editorManager.currentEditor.trigger('keyboard', 'actions.find');
        }
    }

    compileAndRun() {
        if (!this.ensureLocalFileForFeature('编译并运行')) {
            return;
        }
        if (this.compilerManager) {
            this.compilerManager.compileAndRun();
        }
    }
}

window.OICPPApp = OICPPApp;

