// 全局声明：主进程/渲染层/preload 通过 contextBridge 或全局注入的全局。
// 仅做「名称可解析」，签名先用 unknown[]，后续可细化。

declare function logInfo(...args: unknown[]): void;
declare function logWarn(...args: unknown[]): void;
declare function logError(...args: unknown[]): void;

declare function decodeBufferAuto(buffer: Buffer): string;
declare function updateProgress(message: string, percent?: number | null, speed?: string | null): void;

declare const APP_VERSION: string;

declare const oicppKeybindings: unknown;
declare const i18next: unknown;

interface Window {
    oicppKeybindings?: unknown;
    i18next?: unknown;

    // electronAPI (contextBridge)
    electronAPI?: {
        getIdeLoginStatus?: () => Promise<{ loggedIn?: boolean; user?: { username?: string } }>;
        browserResolveUrl?: (url: string) => string;
        readFileContent?: (filePath: string) => Promise<string>;
        onRequestSaveAll?: (cb: () => Promise<unknown>) => void;
        notifySaveAllFailed?: (d: unknown) => void;
        notifySaveAllComplete?: () => void;
        getUserIconPath?: () => Promise<string>;
        send?: (channel: string, ...args: unknown[]) => void;
        saveAsFile?: (content: string, filePath?: string) => Promise<unknown>;
        on?: (channel: string, listener: (...args: unknown[]) => void) => void;
        walkDirectory?: (root: string, options?: { excludeGlobs?: string[]; includeExts?: string[]; maxFiles?: number }) => Promise<{ success?: boolean; error?: string; files?: Array<{ name: string; path: string; ext?: string }> }>;
        getAllSettings?: () => Promise<Record<string, unknown>>;
        updateSettings?: (settings: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>;
        getLanguage?: () => Promise<string>;
        getLanguageFile?: (lang: string) => Promise<Record<string, unknown> | null>;
        openFileDialog?: (opts: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePaths?: string[] }>;
        saveFileDialog?: (opts: { title?: string; defaultPath?: string }) => Promise<{ canceled?: boolean; filePath?: string }>;
        readFile?: (filePath: string) => Promise<string>;
        writeFile?: (filePath: string, content: string) => Promise<{ success?: boolean; error?: string }>;
        getSettings?: () => Promise<Record<string, unknown>>;
        onLanguageChanged?: (cb: (langCode: string) => void) => void;
        getAvailableLanguages?: () => Promise<string[]>;
        getSettingsBackupInfo?: () => Promise<{ success?: boolean; error?: string; info?: Record<string, unknown> }>;
        backupSettingsToCloud?: () => Promise<{ success?: boolean; error?: string }>;
        syncSettingsFromCloud?: () => Promise<{ success?: boolean; error?: string }>;
        lspStart?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
        lspStop?: () => Promise<unknown>;
        lspRestart?: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
        lspRequest?: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
        lspNotify?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
        onLspNotification?: (cb: (payload: Record<string, unknown>) => void) => void;
        onTerminalData?: (cb: (payload: { terminalId: string; data: string }) => void) => void;
        onTerminalExit?: (cb: (payload: { terminalId: string; exitCode?: number; signal?: string }) => void) => void;
        onExternalFileChange?: (cb: (payload: { path: string }) => void) => void;
        getTerminalFeatureStatus?: () => Promise<{ available?: boolean; reason?: string; detail?: string }>;
        createTerminal?: (payload: { cols: number; rows: number; cwd: string }) => Promise<{ ok?: boolean; terminalId?: string; cwd?: string; shell?: string; error?: string }>;
        writeTerminal?: (terminalId: string, data: string) => Promise<unknown>;
        getPlatform?: () => Promise<string>;
        resizeTerminal?: (terminalId: string, cols: number, rows: number) => void;
        killTerminal?: (terminalId: string) => Promise<unknown>;
        openExternal?: (url: string) => Promise<unknown>;
        clipboardWriteText?: (text: string) => Promise<{ success?: boolean; error?: string }>;
        clipboardReadText?: () => Promise<{ success?: boolean; text?: string; error?: string }>;
        readDirectory?: (dirPath: string) => Promise<{ entries?: Array<{ name: string; path: string; isDirectory?: boolean }> }>;
        ensureDirectory?: (dirPath: string) => Promise<unknown>;
        pathDirname?: (p: string) => Promise<string>;
        downloadCompiler?: (opts: { url: string; version: string; name: string }) => Promise<{ success?: boolean; compilerPath?: string; error?: string }>;
        selectCompiler?: (version: string) => Promise<{ success?: boolean; compilerPath?: string; error?: string }>;
        downloadTestlib?: (opts: { url: string; version: string; name: string }) => Promise<{ success?: boolean; testlibPath?: string; error?: string }>;
        selectTestlib?: (version: string) => Promise<{ success?: boolean; testlibPath?: string; error?: string }>;
        getDownloadedCompilers?: () => Promise<string[]>;
        getDownloadedTestlibs?: () => Promise<string[]>;
        isCompilerSelected?: (path: string) => Promise<boolean>;
        isTestlibSelected?: (version: string) => Promise<boolean>;
        saveSetting?: (key: string, value: string) => Promise<unknown>;
        runCommandVersionProbe?: (cmd: string, args: string[], options?: { env?: Record<string, string>; timeoutMs?: number }) => Promise<{ ok: boolean; output: string; message: string }>;
        onSampleTesterCreateProblem?: (cb: (data: Record<string, unknown>) => void) => void;
        onBrowserOpenNewTab?: (cb: (request: { url?: string; sourceWebContentsId?: number }) => void) => (() => void);
        ipcRenderer?: {
            send?: (channel: string, ...args: unknown[]) => void;
        };
        showOpenDialog?: (opts?: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; properties?: string[]; defaultPath?: string }) => Promise<{ canceled?: boolean; filePaths?: string[] }>;
        showSaveDialog?: (opts?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>;
        sendSettingsPreview?: (settings: Record<string, unknown>) => void;
        onSettingsChanged?: (cb: (event: unknown, settingsType: string, payload: unknown) => void) => void;
        resetSettings?: () => Promise<{ success?: boolean; error?: string }>;
        getUserHome?: () => Promise<string>;
        testTestlib?: (testlibPath: string) => Promise<{ success?: boolean; testlibPath?: string; error?: string }>;
        openCompilerSettings?: () => Promise<unknown>;
        reportWorkspacePath?: (path: string) => void;
        clearDirectoryContents?: (dirPath: string) => Promise<{ success?: boolean; removed?: number; error?: string }>;
        watchFile?: (path: string) => Promise<unknown>;
        unwatchFile?: (path: string) => Promise<unknown>;
        showItemInFolder?: (path: string) => Promise<unknown>;
        openPath?: (path: string, options?: { reveal?: boolean }) => Promise<unknown>;
        openRecentFile?: (filePath: string) => Promise<unknown>;
        getRecentFiles?: () => Promise<string[]>;
        extractZipEntry?: (zipPath: string, entryName: string, outDir: string) => Promise<{ success?: boolean; error?: string; filePath?: string }>;
        runInteractive?: (payload: Record<string, unknown>) => Promise<{ ok?: boolean; output?: string; stderr?: string; exitCode?: number; error?: string; contestantExitCode?: number; graderExitCode?: number; timeout?: boolean; time?: number; memoryBytes?: number; memoryLimitExceeded?: boolean; outputLimitExceeded?: boolean }>;
        readZipTextFiles?: (zipPath: string, entryNames?: string[]) => Promise<Record<string, string>>;
        deleteTempFile?: (path: string) => Promise<unknown>;
        pathJoin?: (...parts: string[]) => string;
        ensureDir?: (dirPath: string) => Promise<unknown>;
        compileFile?: (opts: Record<string, unknown>) => Promise<{ success?: boolean; stderr?: string; stdout?: string; executablePath?: any; cached?: boolean; diagnostics?: unknown[] }>;
        checkFileExists?: (path: string) => Promise<boolean>;
        getPathInfo?: (path: string) => Promise<{ dirname?: string; [key: string]: unknown }>;
        getHomeDir?: () => Promise<string>;
        dirname?: (path: string) => string;
        runProgram?: (opts: Record<string, unknown>, input?: string, timeLimit?: number, memoryLimit?: number) => Promise<{ output?: string; stdout?: string; outputLimitExceeded?: boolean; outputLimitBytes?: number; exitCode?: number; stderr?: string; timeout?: boolean; time?: number; capturedOutputBytes?: number; observedOutputBytes?: number }>;
        deleteFile?: (path: string) => Promise<{ success?: boolean; error?: string }>;
        saveTempFile?: (filename: string, content: string) => Promise<string>;
        getCpuThreads?: () => Promise<number>;
        createFile?: (filename: string, content?: string) => Promise<{ success?: boolean; error?: string; filePath?: string }>;
        readFileBuffer?: (filePath: string) => Promise<{ data?: ArrayBuffer | Uint8Array }>;
        saveFile?: (path: string, content?: string) => Promise<{ success?: boolean; error?: string }>;
        getEncodedToken?: () => Promise<string | null>;
        cloudSyncRequest?: (payload: { method: string; path: string; query?: unknown; body?: unknown }) => Promise<{ ok?: boolean; status?: number; data?: { msg?: string; code?: number; }; error?: string }>;
        logoutIdeAccount?: () => Promise<unknown>;
        onIdeLoginUpdated?: (cb: (status: { loggedIn?: boolean; user?: { username?: string }; message?: string }) => void) => void;
        onIdeLoginError?: (cb: (err: { message?: string }) => void) => void;
        startIdeLogin?: () => Promise<unknown>;
        onMenuSaveFile?: (cb: () => void) => void;
        onMenuNewTempFile?: (cb: () => void) => void;
        onMenuFormatCode?: (cb: () => void) => void;
        onMenuFindReplace?: (cb: () => void) => void;
        onMenuCompile?: (cb: () => void) => void;
        onMenuCompileRun?: (cb: () => void) => void;
        onMenuOpenTerminal?: (cb: () => void) => void;
        onMenuOpenFileHistory?: (cb: () => void) => void;
        onMenuOpenBrowser?: (cb: () => void) => void;
        onMenuNewBrowserTab?: (cb: () => void) => void;
        onMenuDebug?: (cb: () => void) => void;
        onMenuRestoreLayout?: (cb: () => void) => void;
        onMenuSettings?: (cb: () => void) => void;
        onMenuAbout?: (cb: () => void) => void;
        onShowDebugDevelopingMessage?: (cb: () => void) => void;
        openFile?: () => Promise<unknown>;
        onThemeChanged?: (cb: (theme: string) => void) => void;
        onSettingsReset?: (cb: (allSettings: Record<string, unknown>) => void) => void;
        onSettingsImported?: (cb: (allSettings: Record<string, unknown>) => void) => void;
        onFileOpened?: (cb: (event: unknown, data: { filePath?: string; content?: string } | string) => void) => void;
        onFileSaved?: (cb: (filePath: string, error: string | null) => void) => void;
        onFolderOpened?: (cb: (folderPath: string) => void) => void;
        onFileOpenedFromArgs?: (cb: (data: { path: string; fileName?: string; content?: string; viewType?: string }) => void) => void;
        onApplySettingsPreview?: (cb: (previewSettings: Record<string, unknown>) => void) => void;
        onSettingsApplied?: (cb: (finalSettings: Record<string, unknown>) => void) => void;
        onUpdateDownloadStatus?: (cb: (payload: Record<string, unknown>) => void) => void;
        getUpdateDownloadStatus?: () => Promise<Record<string, unknown>>;
        onAppToast?: (cb: (payload: { message: string; type?: string }) => void) => void;
        consumeStartupWorkspaceToOpen?: () => Promise<string | null>;
        saveBinaryTempFile?: (filename: string, data: string) => Promise<string | null>;
        openEditorSettings?: () => Promise<unknown>;
        openFolder?: () => Promise<unknown>;
        getTerminalTTY?: (terminalId: string) => Promise<{ tty?: string } | null>;
        saveCloudFile?: (cloudPath: string, content: string) => Promise<boolean>;
        openTemplateSettings?: () => Promise<unknown>;
        openBackupSettings?: () => Promise<unknown>;
        listClientLogs?: () => Promise<{ success?: boolean; message?: string; logs?: Array<{ path?: string; name?: string }> }>;
        uploadClientLog?: (logPath: string) => Promise<{ success?: boolean; message?: string; traceCode?: string; uploadedAt?: string }>;
        getBuildInfo?: () => Promise<{ version?: string; buildTime?: string; author?: string; buildTag?: string; buildVersion?: string; buildNo?: string }>;
        addToFileHistory?: (path: string) => Promise<unknown>;
        getFileHistory?: () => Promise<Array<{ path?: string; name?: string; time?: number }>>;
        openFileFromHistory?: (path: string) => Promise<unknown>;
        clearFileHistory?: () => Promise<unknown>;
        saveLastOpenTabs?: (tabs: Array<{ filePath?: string; fileName?: string; groupId?: string; viewType?: string }>) => Promise<unknown>;
        getLastOpenTabs?: () => Promise<Array<{ filePath?: string; fileName?: string; groupId?: string; viewType?: string }>>;
    };

    // electronIPC
    electronIPC?: {
        send?: (channel: string, ...args: unknown[]) => void;
        on?: (channel: string, listener: (...args: unknown[]) => void) => void;
        invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
        ipcRenderer?: {
            removeListener?: (channel: string, listener: (...args: unknown[]) => void) => void;
            on?: (channel: string, listener: (...args: unknown[]) => void) => void;
        };
    };

    // electron (remote shell, etc.)
    electron?: {
        shell?: {
            openExternal?: (url: string) => Promise<void>;
            showItemInFolder?: (path: string) => Promise<void>;
            openPath?: (path: string) => Promise<void>;
        };
        ipcRenderer?: {
            send?: (channel: string, ...args: unknown[]) => void;
            on?: (channel: string, listener: (...args: unknown[]) => void) => void;
            invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
        };
    };

    getElectronModule?: () => Record<string, unknown>;

    // i18n
    i18n?: {
        init?: () => Promise<void>;
        enableAutoTranslate?: () => void;
        t?: (key: string, params?: Record<string, unknown>) => string;
        _applyToDOM?: () => void;
        onChange?: (cb: () => void) => (() => void) | void;
        getCurrentLanguage?: () => string;
        getAvailableLanguages?: () => Promise<Array<{ code: string; name: string; nameEn: string }>>;
        setLanguage?: (lang: string) => void;
    };
    __?: (key: string, params?: Record<string, unknown>) => string;

    // Sidebar
    // Sidebar
    sidebar?: {
        panels?: {
            files?: {
                currentPath?: string;
                workspacePath?: string;
                selectedFile?: { path?: string; name?: string };
                hasWorkspace?: boolean;
                createNewFile?: () => Promise<unknown>;
                samples?: {
                    handleFileRenamed?: (oldPath: string, newPath: string) => void | Promise<void>;
                    handleFileDeleted?: (path: string) => void | Promise<void>;
                };
            };
        };
    };

    sidebarManager?: {
        panels?: { files?: { currentPath?: string; workspacePath?: string; selectedFile?: { path?: string; name?: string }; hasWorkspace?: boolean; createNewFile?: () => Promise<unknown>; setWorkspace?: (path: string) => void; clearWorkspace?: () => void }; samples?: { handleFileRenamed?: (oldPath: string, newPath: string) => void | Promise<void>; handleFileDeleted?: (path: string) => void | Promise<void> } };
        getPanelManager?: (name: string) => unknown;
        getCurrentPanel?: () => unknown;
        updateFileExplorerButtons?: () => void;
        checkResizeStatus?: () => void;
        showPanel?: (name: string) => void;
        setCloudPanelVisible?: (visible: boolean) => void;
        showForEditor?: () => void;
        enableResize?: () => void;
        hideForWelcome?: () => void;
        disableResize?: () => void;
        hideGroupBrowserContainers?: () => void;
    };

    // TabManager
    tabManager?: {
        openFile?: (name: string, content: string, readonly: boolean, options?: { filePath?: string; viewType?: string; groupId?: string; isTempFile?: boolean; pdfBase64?: string | null }) => void;
        saveAllFiles?: () => Promise<{ success: boolean; failures: any[] }>;
        saveCurrentFile?: () => Promise<unknown>;
        getTabCount?: () => number;
        showWelcomePage?: () => void;
        closeWelcomePage?: () => void;
        getUnsavedFiles?: () => unknown;
        tabs?: Map<string, { filePath?: string; fileName?: string; viewType?: string; groupId?: string; isWelcome?: boolean; isTempFile?: boolean }>;
        getTabContentForSave?: (tab: unknown) => unknown;
        saveAsFile?: (content: string, filePath?: string) => Promise<unknown>;
        syncWebviewSize?: () => void;
        resizeObserver?: unknown;
        openBrowserTab?: (opts: { url?: string; groupId?: string }) => void;
        activeGroupId?: string;
        groupOrder?: string[];
        tabDragInProgress?: boolean;
        getTabByFileName?: (fileName: string) => unknown;
        markTabAsSaved?: (tab: unknown) => void;
        markTabAsSavedByUniqueKey?: (uniqueKey: string) => void;
        updateTabPathBySource?: (source: string, path: string, newName?: string) => void;
        updateTabPathsUnderDirectory?: (source: string, dest: string) => void;
        openDiff?: (files: Array<{ path: string; name: string; type: string }>) => void | Promise<void>;
        closeTabByUniqueKey?: (uniqueKey: string, options?: { skipAutoSave?: boolean; skipAutoClose?: boolean }) => void;
        closeTabByFileName?: (fileName: string, options?: { skipAutoSave?: boolean; skipAutoClose?: boolean }) => void;
        closeTab?: (uniqueKey: string, options?: { skipCloseConfirm?: boolean }) => void;
        toggleMarkdownSplitView?: () => void;
        activateTabByUniqueKey?: (uniqueKey: string) => void;
        markTabAsModifiedByUniqueKey?: (uniqueKey: string) => void;
        markTabAsModified?: (tab: unknown) => void;
        getAllTabs?: () => string[];
        autoSaveModifiedTabs?: () => Promise<number>;
        updateAllEditorsSettings?: (settings: Record<string, unknown>) => void;
        refreshTabLabels?: () => void;
        openFileByPath?: (filePath: string, content: string) => void;
        editorManager?: {
            currentEditor?: { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
            getCurrentEditor?: () => { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
            applyDiagnostics?: (diagnostics: unknown[]) => void;
            clearDiagnostics?: () => void;
            getModel?: () => unknown;
            clearAllExecHighlights?: () => void;
            getAllBreakpoints?: () => unknown[];
            restartLspWithCompiler?: (compilerPath: string) => unknown;
            refreshUserSnippets?: () => void;
        };
    };

    // OICPPApp
    oicppApp?: {
        init?: () => Promise<void>;
        saveCurrentFile?: () => Promise<unknown>;
        saveCurrentOpenTabs?: (tabs?: unknown) => void;
        createNewCppFile?: () => void;
        openDroppedFile?: (filePath: string, options?: { groupId?: string; fileName?: string; filePath?: string; base64Data?: string }) => void;
        showMessage?: (message: string, type?: string, durationMs?: number) => void;
        getActiveFilePath?: () => string | null;
        isCloudFilePath?: (path: string) => boolean;
        settings?: Record<string, unknown>;
        editor?: unknown;
        startDebug?: (executablePath?: string, sourcePath?: string, options?: Record<string, unknown>) => Promise<void>;
        openIntegratedTerminalAndRunExecutable?: (executablePath: string, options?: { workingDirectory?: string }) => void;
        compilerManager?: unknown;
        updateLspStatusBar?: (status?: string) => void;
        saveCloudFileToServer?: (path: string, content: string) => Promise<unknown>;
        openTemplateSettings?: () => void;
        openFolder?: (path: string) => void;
        openFile?: (path: string) => void;
        openRecentFile?: () => void;
        getRecentFiles?: () => Promise<Array<{ path?: string; name?: string }>>;
        editorManager?: {
            currentEditor?: { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
            getCurrentEditor?: () => { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
            applyDiagnostics?: (diagnostics: unknown[]) => void;
            clearDiagnostics?: () => void;
            getModel?: () => unknown;
        };
    };

    // dialogManager
    dialogManager?: {
        showNewYearGreeting?: (d: Date) => void;
        showSpringFestivalGreeting?: (d: Date) => void;
        showConfirmDialog?: (title: string, msg: string) => Promise<unknown>;
        showConfirm?: (title: string, msg: string) => Promise<boolean>;
        showActionDialog?: (title: string, msg: string, buttons: Array<{ id: string; label: string; className?: string }>) => Promise<unknown>;
        showError?: (title: string, msg?: string) => void;
        showInputDialog?: (title: string, msg: string, defaultValue?: string, options?: { selectStart?: number; selectEnd?: number }) => Promise<string>;
        showSaveDialog?: (opts?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>;
        showNewFileDialog?: (message?: string, defaultName?: string) => Promise<string | null>;
        showNewFolderDialog?: () => Promise<string | null>;
    };

    // Titlebar
    titlebarManager?: unknown;

    // markdownAPI
    markdownAPI?: {
        render?: (content: string, filePath?: string) => string;
    };

    // BrowserManager
    browserManager?: {
        hideGroupBrowserContainers?: (groupId: string) => void;
        getOrCreateContainer?: (opts: { groupId: string; uniqueKey: string; url: string }) => unknown;
        moveContainerToGroup?: (uniqueKey: string, groupId: string) => unknown;
        getBrowserState?: (uniqueKey?: string) => unknown;
        showBrowserContainer?: (container: unknown) => void;
        focusBrowserTab?: (tab: unknown) => void;
        destroyBrowserTab?: (tabId: string) => void;
    };

    // uiIcons
    uiIcons?: {
        hydrate?: (container: HTMLElement) => void;
        svg?: unknown;
    };

    // fontDetector
    fontDetector?: {
        validateFont?: (font: string) => string;
        getAllAvailableFonts?: () => Promise<string[]>;
        getAllAvailableFontsSync?: () => string[];
    };

    // Font Loading API
    queryLocalFonts?: () => Promise<Array<{ family: string }>>;

    // applySettings / getCurrentSettings / updateSettings
    applySettings?: (settings: Record<string, unknown>) => void;
    getCurrentSettings?: () => Promise<Record<string, unknown>>;
    updateSettings?: (newSettings: Record<string, unknown>) => Promise<boolean>;

    // QuickOpen
    quickOpen?: {
        open?: () => void;
        close?: () => void;
        ensureIndex?: () => Promise<boolean>;
    };

    // cppFormatter
    cppFormatter?: {
        format?: (code: string, options?: Record<string, unknown>) => string;
    };

    // xterm
    Terminal?: new (options: Record<string, unknown>) => {
        cols: number;
        rows: number;
        open: (mount: HTMLElement) => void;
        loadAddon: (addon: unknown) => void;
        write: (data: string) => void;
        writeln: (data: string) => void;
        focus: () => void;
        dispose: () => void;
        onData: (callback: (data: string) => void) => void;
        registerLinkProvider: (provider: unknown) => void;
        attachCustomKeyEventHandler: (handler: (event: unknown) => boolean) => void;
        buffer?: {
            active?: {
                getLine?: (row: number) => { translateToString?: (trim: boolean) => string } | null;
                length?: number;
            };
        };
        registerCharacterJoiner?: (joiner: unknown) => void;
        options?: {
            theme?: unknown;
            fontFamily?: string;
            fontSize?: number;
            fontWeight?: string;
            fontWeightBold?: string;
            letterSpacing?: number;
            lineHeight?: number;
            convertEol?: boolean;
            scrollback?: number;
            allowTransparency?: boolean;
            allowProposedApi?: boolean;
        };
        unicode?: { activeVersion?: string | number };
    };
    FitAddon?: { FitAddon: new () => { fit: () => void } };
    Unicode11Addon?: { Unicode11Addon: new () => void };

    // LSP
    LspClientBridge?: typeof import('./lsp-client').LspClientBridge;
    lspClient?: LspClientBridge;

    // IntegratedTerminalPanel
    IntegratedTerminalPanel?: unknown;

    // Compiler settings
    compilerSettings?: {
        compilerPath?: string;
        pythonInterpreterPath?: string;
        compilerArgs?: string;
        runMode?: string;
    };
    compilerManager?: {
        setStatus?: (status: string) => void;
        appendOutput?: (text: string, type?: string) => void;
        showExternalCompileResult?: (result: unknown, opts?: { title?: string }) => void;
        showOutput?: () => void;
        clearOutput?: () => void;
        showCurrentEditorProblems?: (problems?: unknown) => void;
    };

    TitlebarManager?: typeof import('./renderer/js/titlebar').TitlebarManager;
    OICPPApp?: typeof import('./renderer/js/main').OICPPApp;

    // editorManager
    editorManager?: {
        currentEditor?: { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
        getCurrentEditor?: () => { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
        applyDiagnostics?: (diagnostics: unknown[]) => void;
        clearDiagnostics?: () => void;
        getCurrentContent?: () => string;
    };
    monacoEditorManager?: {
        currentEditor?: { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
        getCurrentEditor?: () => { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
        applyDiagnostics?: (diagnostics: unknown[]) => void;
        clearDiagnostics?: () => void;
        getModel?: () => unknown;
        getCurrentContent?: () => string;
        switchTab?: (tabId: string) => void;
        moveEditorToGroup?: (tabId: string, groupId: string) => void;
        cleanupEditor?: (tabId: string) => void;
        loadKeybindingsFromSettings?: (settings: Record<string, unknown>) => void;
        restartLspWithCompiler?: (compilerPath: string) => unknown;
        updateAllEditorsSettings?: (settings: Record<string, unknown>) => void;
        clearAllExecHighlights?: () => void;
        getAllBreakpoints?: () => unknown[];
        refreshUserSnippets?: () => void;
    };
    // app
    app?: {
        isDebugging?: boolean;
        fileExplorer?: {
            openFile?: (path?: string) => void;
            openFolder?: (path?: string) => void;
        };
        editorManager?: {
            currentEditor?: { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
            getCurrentEditor?: () => { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown; highlightLine?: (line: number) => void };
        };
    };
    [key: string]: unknown;
}
interface HTMLElement {
    disabled?: boolean;
    value?: string;
    selectStart?: number;
    selectEnd?: number;
    offsetTop?: number;
    offsetHeight?: number;
    style?: any;
    src?: string;
    checked?: boolean;
    max?: string;
    __hideTimer?: any;
    __oicppResizeBound?: any;
    __oicppFile?: any;
    title?: string;
    placeholder?: string;
    type?: string;
    options?: any;
    _input?: any;
    _list?: any;
    hasGlobalWheelZoomListener?: boolean;
}
interface Element {
    style?: any;
    disabled?: boolean;
    dataset?: { [key: string]: string };
    tabIndex?: number;
    offsetWidth?: number;
    offsetHeight?: number;
    isContentEditable?: boolean;
    focus(): void;
    __hideTimer?: any;
    title?: string;
    placeholder?: string;
}
interface Event {
    key?: string;
    detail?: any;
    clientX?: number;
    clientY?: number;
    target?: any;
    currentTarget?: EventTarget & { dataset?: { [key: string]: string } };
    preventDefault?(): void;
    stopPropagation?(): void;
}
interface EventTarget {
    value?: string;
    checked?: boolean;
    classList?: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
    querySelector?: (s: string) => Element | null;
    dataset?: { [key: string]: string };
    closest?: (selector: string) => Element | null;
}

// 允许 window.require 被自定义函数替代
interface Window {
    require: any;
}
