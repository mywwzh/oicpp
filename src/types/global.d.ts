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
        clipboardWriteText?: (text: string) => void;
        browserResolveUrl?: (url: string) => string;
        readFileContent?: (filePath: string) => Promise<string>;
        onRequestSaveAll?: (cb: () => Promise<unknown>) => void;
        notifySaveAllFailed?: (d: unknown) => void;
        notifySaveAllComplete?: () => void;
        getUserIconPath?: () => Promise<string>;
        send?: (channel: string, ...args: unknown[]) => void;
        saveAsFile?: (content: string, filePath?: string) => Promise<unknown>;
        on?: (channel: string, listener: (...args: unknown[]) => void) => void;
        walkDirectory?: (root: string, options?: { excludeGlobs?: string[] }) => Promise<{ success?: boolean; files?: Array<{ name: string; path: string }> }>;
        getAllSettings?: () => Promise<Record<string, unknown>>;
        updateSettings?: (settings: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>;
        getLanguage?: () => Promise<string>;
        getLanguageFile?: (lang: string) => Promise<Record<string, unknown> | null>;
        openFileDialog?: (opts: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<{ canceled?: boolean; filePaths?: string[] }>;
        saveFileDialog?: (opts: { title?: string; defaultPath?: string }) => Promise<{ canceled?: boolean; filePath?: string }>;
        readFile?: (filePath: string) => Promise<string>;
        writeFile?: (filePath: string, content: string) => Promise<unknown>;
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
    };

    // electronIPC
    electronIPC?: {
        send?: (channel: string, ...args: unknown[]) => void;
        on?: (channel: string, listener: (...args: unknown[]) => void) => void;
        invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
    };

    // i18n
    i18n?: {
        init?: () => Promise<void>;
        enableAutoTranslate?: () => void;
        t?: (key: string, params?: Record<string, unknown>) => string;
        _applyToDOM?: () => void;
        onChange?: (cb: () => void) => void;
    };
    __?: (key: string, params?: Record<string, unknown>) => string;

    // Sidebar
    sidebarManager?: {
        panels?: { files?: { currentPath?: string; workspacePath?: string } };
        getPanelManager?: (name: string) => unknown;
        updateFileExplorerButtons?: () => void;
        checkResizeStatus?: () => void;
        showPanel?: (name: string) => void;
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
    };

    // dialogManager
    dialogManager?: {
        showNewYearGreeting?: (d: Date) => void;
        showSpringFestivalGreeting?: (d: Date) => void;
        showConfirmDialog?: (title: string, msg: string) => Promise<unknown>;
        showActionDialog?: (title: string, msg: string, buttons: Array<{ id: string; label: string; className?: string }>) => Promise<unknown>;
        showError?: (title: string, msg: string) => void;
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

    [key: string]: unknown;
}
