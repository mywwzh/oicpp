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
        walkDirectory?: (root: string, options?: { excludeGlobs?: string[]; includeExts?: string[] }) => Promise<{ success?: boolean; error?: string; files?: Array<{ name: string; path: string; ext?: string }> }>;
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
        getTerminalFeatureStatus?: () => Promise<{ available?: boolean; reason?: string; detail?: string }>;
        createTerminal?: (payload: { cols: number; rows: number; cwd: string }) => Promise<{ ok?: boolean; terminalId?: string; cwd?: string; shell?: string; error?: string }>;
        writeTerminal?: (terminalId: string, data: string) => Promise<unknown>;
        getPlatform?: () => Promise<string>;
        resizeTerminal?: (terminalId: string, cols: number, rows: number) => void;
        killTerminal?: (terminalId: string) => Promise<unknown>;
        openExternal?: (url: string) => Promise<unknown>;
        clipboardWriteText?: (text: string) => Promise<{ success?: boolean }>;
        clipboardReadText?: () => Promise<{ success?: boolean; text?: string }>;
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
        resetSettings?: () => Promise<unknown>;
        getUserHome?: () => Promise<string>;
        testTestlib?: (opts: { url: string; version: string; name: string }) => Promise<{ success?: boolean; testlibPath?: string; error?: string }>;
        openCompilerSettings?: () => Promise<unknown>;
        deleteTempFile?: (path: string) => Promise<unknown>;
        pathJoin?: (...parts: string[]) => string;
        ensureDir?: (dirPath: string) => Promise<unknown>;
        compileFile?: (opts: Record<string, unknown>) => Promise<{ success?: boolean; stderr?: string; stdout?: string }>;
        checkFileExists?: (path: string) => Promise<boolean>;
        getPathInfo?: (path: string) => Promise<{ dirname?: string; [key: string]: unknown }>;
        getHomeDir?: () => Promise<string>;
        dirname?: (path: string) => string;
        runProgram?: (opts: Record<string, unknown>, input?: string, timeLimit?: number) => Promise<{ output?: string; outputLimitExceeded?: boolean; outputLimitBytes?: number; exitCode?: number; stderr?: string; timeout?: boolean; time?: number; capturedOutputBytes?: number; observedOutputBytes?: number }>;
        deleteFile?: (path: string) => Promise<unknown>;
        saveTempFile?: (filename: string, content: string) => Promise<string>;
        getCpuThreads?: () => Promise<number>;
        createFile?: (filename: string, content?: string) => Promise<unknown>;
        readFileBuffer?: (filePath: string) => Promise<{ data?: ArrayBuffer | Uint8Array }>;
        saveFile?: (path: string, content?: string) => Promise<{ success?: boolean; error?: string }>;
        getEncodedToken?: () => Promise<string | null>;
        cloudSyncRequest?: (payload: { method: string; path: string; query?: unknown; body?: unknown }) => Promise<{ ok?: boolean; status?: number; data?: { msg?: string; code?: number; }; error?: string }>;
        logoutIdeAccount?: () => Promise<unknown>;
        onIdeLoginUpdated?: (cb: (status: { loggedIn?: boolean; user?: { username?: string } }) => void) => void;
        onIdeLoginError?: (cb: (err: unknown) => void) => void;
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
    };

    // electronIPC
    electronIPC?: {
        send?: (channel: string, ...args: unknown[]) => void;
        on?: (channel: string, listener: (...args: unknown[]) => void) => void;
        invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };

    // electron (remote shell, etc.)
    electron?: {
        shell?: {
            openExternal?: (url: string) => Promise<void>;
        };
        ipcRenderer?: {
            send?: (channel: string, ...args: unknown[]) => void;
            on?: (channel: string, listener: (...args: unknown[]) => void) => void;
            invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
        };
    };

    // i18n
    i18n?: {
        init?: () => Promise<void>;
        enableAutoTranslate?: () => void;
        t?: (key: string, params?: Record<string, unknown>) => string;
        _applyToDOM?: () => void;
        onChange?: (cb: () => void) => void;
        getCurrentLanguage?: () => string;
    };
    __?: (key: string, params?: Record<string, unknown>) => string;

    // Sidebar
    sidebarManager?: {
        panels?: { files?: { currentPath?: string; workspacePath?: string } };
        getPanelManager?: (name: string) => unknown;
        getCurrentPanel?: () => unknown;
        updateFileExplorerButtons?: () => void;
        checkResizeStatus?: () => void;
        showPanel?: (name: string) => void;
        setCloudPanelVisible?: (visible: boolean) => void;
    };

    // TabManager
    tabManager?: {
        openFile?: (name: string, content: string, readonly: boolean, options?: { filePath?: string; viewType?: string }) => void;
        saveAllFiles?: () => Promise<{ success: boolean; failures: any[] }>;
        saveCurrentFile?: () => Promise<unknown>;
        getTabCount?: () => number;
        showWelcomePage?: () => void;
        getUnsavedFiles?: () => unknown;
        tabs?: Map<string, unknown>;
        getTabContentForSave?: (tab: unknown) => unknown;
        saveAsFile?: (content: string, filePath?: string) => Promise<unknown>;
        syncWebviewSize?: () => void;
        resizeObserver?: unknown;
        openBrowserTab?: (opts: { url: string; groupId?: string }) => void;
        activeGroupId?: string;
        getTabByFileName?: (fileName: string) => unknown;
        markTabAsSaved?: (tab: unknown) => void;
        markTabAsSavedByUniqueKey?: (uniqueKey: string) => void;
        updateTabPathBySource?: (source: string, path: string, newName?: string) => void;
    };

    // OICPPApp
    oicppApp?: {
        init?: () => Promise<void>;
        saveCurrentFile?: () => Promise<unknown>;
        saveCurrentOpenTabs?: (tabs?: unknown) => void;
        createNewCppFile?: () => void;
        openDroppedFile?: (filePath: string) => void;
        showMessage?: (message: string, type?: string) => void;
        getActiveFilePath?: () => string | null;
        isCloudFilePath?: (path: string) => boolean;
        settings?: Record<string, unknown>;
        startDebug?: (executablePath?: string, sourcePath?: string, options?: Record<string, unknown>) => Promise<void>;
        openIntegratedTerminalAndRunExecutable?: (executablePath: string, options?: { workingDirectory?: string }) => void;
        compilerManager?: unknown;
    };

    // dialogManager
    dialogManager?: {
        showNewYearGreeting?: (d: Date) => void;
        showSpringFestivalGreeting?: (d: Date) => void;
        showConfirmDialog?: (title: string, msg: string) => Promise<unknown>;
        showActionDialog?: (title: string, msg: string, buttons: Array<{ id: string; label: string; className?: string }>) => Promise<unknown>;
        showError?: (title: string, msg: string) => void;
        showInputDialog?: (title: string, msg: string, defaultValue?: string) => Promise<string>;
        showSaveDialog?: (opts?: { title?: string; defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePath?: string }>;
    };

    // Titlebar
    titlebarManager?: unknown;

    // uiIcons
    uiIcons?: {
        hydrate?: (container: HTMLElement) => void;
        svg?: unknown;
    };

    // fontDetector
    fontDetector?: {
        validateFont?: (font: string) => string;
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

    // editorManager
    editorManager?: {
        currentEditor?: { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown };
        getCurrentEditor?: () => { layout?: () => void; filePath?: string; getFilePath?: () => string; getValue?: () => string; getModel?: () => unknown };
        applyDiagnostics?: (diagnostics: unknown[]) => void;
        clearDiagnostics?: () => void;
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
    classList?: { add: (c: string) => void; remove: (c: string) => void; contains: (c: string) => boolean };
    querySelector?: (s: string) => Element | null;
    dataset?: { [key: string]: string };
    closest?: (selector: string) => Element | null;
}

// 允许 window.require 被自定义函数替代
interface Window {
    require: any;
}
