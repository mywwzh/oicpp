const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');
if (globalThis.__oicppPreloadInitialized) {
    return;
}
globalThis.__oicppPreloadInitialized = true;

const safeIpcRenderer = {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, listener) => ipcRenderer.on(channel, listener),
    once: (channel, listener) => ipcRenderer.once(channel, listener),
    removeListener: (channel, listener) => ipcRenderer.removeListener(channel, listener),
    removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
};


contextBridge.exposeInMainWorld('electron', {
    ipcRenderer: safeIpcRenderer,
    shell: {
        openExternal: (url) => shell.openExternal(url),
        showItemInFolder: (path) => shell.showItemInFolder(path),
        openPath: (targetPath) => shell.openPath(targetPath)
    }
});
contextBridge.exposeInMainWorld('__electronRequireAvailable', true);
contextBridge.exposeInMainWorld('getElectronModule', () => {
    return {
        ipcRenderer: safeIpcRenderer,
        shell: {
            openExternal: (url) => shell.openExternal(url),
            showItemInFolder: (path) => shell.showItemInFolder(path),
            openPath: (targetPath) => shell.openPath(targetPath)
        }
    };
});

contextBridge.exposeInMainWorld('electronAPI', {
    openFile: () => ipcRenderer.send('open-file-dialog'),
    openFolder: () => ipcRenderer.send('open-folder-dialog'),
    saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
    saveAsFile: (content) => ipcRenderer.invoke('save-as-file', content),
    readFileContent: (filePath) => ipcRenderer.invoke('read-file-content', filePath),
    readFileBuffer: (filePath) => ipcRenderer.invoke('read-file-buffer', filePath),
    showItemInFolder: (filePath) => ipcRenderer.invoke('open-path', filePath, { reveal: true }),
    openPath: (targetPath, options = {}) => ipcRenderer.invoke('open-path', targetPath, options),
    showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
    showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),

    openMarkdownFile: (filePath) => ipcRenderer.invoke('open-markdown-file', filePath),

    saveTempFile: (filePath, content) => ipcRenderer.invoke('save-temp-file', filePath, content),
    saveBinaryTempFile: (fileName, base64Data) => ipcRenderer.invoke('save-binary-temp-file', fileName, base64Data),
    loadTempFile: (filePath) => ipcRenderer.invoke('load-temp-file', filePath),
    deleteTempFile: (filePath) => ipcRenderer.invoke('delete-temp-file', filePath),

    getAllSettings: () => ipcRenderer.invoke('get-all-settings'),
    getSettings: () => ipcRenderer.invoke('get-settings'),
    sendSettingsPreview: (settings) => ipcRenderer.send('settings-preview', settings),
    updateSettings: (newSettings) => ipcRenderer.invoke('update-settings', newSettings),
    updateEditorSettings: (editorSettings) => ipcRenderer.invoke('update-editor-settings', editorSettings),
    resetSettings: () => ipcRenderer.invoke('reset-settings'),
    exportSettings: () => ipcRenderer.invoke('export-settings'),
    importSettings: () => ipcRenderer.invoke('import-settings'),
    saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),

    openCompilerSettings: () => ipcRenderer.invoke('open-compiler-settings'),
    openEditorSettings: () => ipcRenderer.invoke('open-editor-settings'),
    openTemplateSettings: () => ipcRenderer.send('open-template-settings'),

    getPlatform: () => ipcRenderer.invoke('get-platform'),
    getUserHome: () => ipcRenderer.invoke('get-user-home'),
    getUserIconPath: () => ipcRenderer.invoke('get-user-icon-path'),
    getBuildInfo: () => ipcRenderer.invoke('get-build-info'),

    getDownloadedCompilers: () => ipcRenderer.invoke('get-downloaded-compilers'),
    downloadCompiler: (config) => ipcRenderer.invoke('download-compiler', config),
    selectCompiler: (version) => ipcRenderer.invoke('select-compiler', version),


    getDownloadedTestlibs: () => ipcRenderer.invoke('get-downloaded-testlibs'),
    downloadTestlib: (config) => ipcRenderer.invoke('download-testlib', config),
    selectTestlib: (version) => ipcRenderer.invoke('select-testlib', version),
    testTestlib: (testlibPath) => ipcRenderer.invoke('test-testlib', testlibPath),

    compileFile: (options) => ipcRenderer.invoke('compile-file', options),
    runExecutable: (options) => ipcRenderer.invoke('run-executable', options),
    runProgram: (executablePath, input, timeLimit) => ipcRenderer.invoke('run-program', executablePath, input, timeLimit),

    readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
    renameFile: (oldPath, newPath) => ipcRenderer.invoke('rename-file', oldPath, newPath),
    deleteFile: (filePath) => ipcRenderer.invoke('delete-file', filePath),
    writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
    createFile: (filePath, content) => ipcRenderer.invoke('create-file', filePath, content),
    createFolder: (folderPath) => ipcRenderer.invoke('create-folder', folderPath),
    checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),
    getPathInfo: (filePath) => ipcRenderer.invoke('get-path-info', filePath),
    ensureDirectory: (dirPath) => ipcRenderer.invoke('ensure-directory', dirPath),
    watchFile: (filePath) => ipcRenderer.invoke('watch-file', filePath),
    unwatchFile: (filePath) => ipcRenderer.invoke('unwatch-file', filePath),

    pathJoin: (...paths) => ipcRenderer.invoke('path-join', ...paths),
    pathDirname: (filePath) => ipcRenderer.invoke('path-dirname', filePath),
    getHomeDir: () => ipcRenderer.invoke('get-home-dir'),
    ensureDir: (dirPath) => ipcRenderer.invoke('ensure-dir', dirPath),

    onMenuSaveFile: (callback) => ipcRenderer.on('menu-save-file', callback),
    onApplySettingsPreview: (callback) => ipcRenderer.on('apply-settings-preview', (event, ...args) => callback(...args)),
    onSettingsApplied: (callback) => ipcRenderer.on('settings-applied', (event, ...args) => callback(...args)),
    onMenuFormatCode: (callback) => ipcRenderer.on('menu-format-code', callback),
    onMenuFindReplace: (callback) => ipcRenderer.on('menu-find-replace', callback),
    onMenuCompile: (callback) => ipcRenderer.on('menu-compile', callback),
    onMenuCompileRun: (callback) => ipcRenderer.on('menu-compile-run', callback),
    onMenuDebug: (callback) => ipcRenderer.on('menu-debug', callback),
    onMenuOpenFile: (callback) => ipcRenderer.on('menu-open-file', callback),
    onMenuOpenFolder: (callback) => ipcRenderer.on('menu-open-folder', callback),
    onMenuSaveAs: (callback) => ipcRenderer.on('menu-save-as', callback),
    onMenuAbout: (callback) => ipcRenderer.on('menu-about', callback),
    onMenuSettings: (callback) => ipcRenderer.on('menu-settings', callback),
    onMenuCheckUpdates: (callback) => ipcRenderer.on('menu-check-updates', callback),

    onShowDebugDevelopingMessage: (callback) => ipcRenderer.on('show-debug-developing-message', callback),
    onSettingsChanged: (callback) => ipcRenderer.on('settings-changed', callback),
    onSettingsReset: (callback) => ipcRenderer.on('settings-reset', callback),
    onSettingsImported: (callback) => ipcRenderer.on('settings-imported', callback),
    onThemeChanged: (callback) => ipcRenderer.on('theme-changed', callback),
    onFileOpened: (callback) => ipcRenderer.on('file-opened', callback),
    onFileSaved: (callback) => ipcRenderer.on('file-saved', (event, filePath, error) => callback(filePath, error)),
    onFolderOpened: (callback) => ipcRenderer.on('folder-opened', (event, folderPath) => callback(folderPath)),
    onFileOpenedFromArgs: (callback) => ipcRenderer.on('file-opened-from-args', (event, data) => callback(data)),
    onExternalFileChange: (callback) => {
        if (typeof callback !== 'function') return () => { };
        const listener = (_event, payload) => callback(payload);
        ipcRenderer.on('external-file-changed', listener);
        return () => ipcRenderer.removeListener('external-file-changed', listener);
    },
    onSampleTesterCreateProblem: (callback) => ipcRenderer.on('sample-tester-create-problem', (_e, data) => callback && callback(data)),

    sendFeedback: (message) => ipcRenderer.invoke('send-feedback', message),
    getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),
    getEncodedToken: () => ipcRenderer.invoke('get-encoded-token'),

    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
    openRecentFile: (filePath) => ipcRenderer.invoke('open-recent-file', filePath),

    versions: process.versions,

    relaunchApp: () => ipcRenderer.invoke('relaunch-app'),

    clipboardWriteText: (text) => ipcRenderer.invoke('clipboard-write-text', text),
    clipboardReadText: () => ipcRenderer.invoke('clipboard-read-text'),

    walkDirectory: (dirPath, options) => ipcRenderer.invoke('walk-directory', dirPath, options),

    onRequestSaveAll: (callback) => ipcRenderer.on('request-save-all', () => callback && callback()),
    notifySaveAllComplete: () => ipcRenderer.send('save-all-complete')
});

contextBridge.exposeInMainWorld('electronIPC', {
    ...safeIpcRenderer,
    ipcRenderer: safeIpcRenderer,
    on: (channel, listener) => {
        if (channel === 'file-saved') {
            return ipcRenderer.on('file-saved', (event, filePath, error) => listener(event, filePath, error));
        }
        return ipcRenderer.on(channel, listener);
    },
    once: (channel, listener) => {
        if (channel === 'file-saved') {
            return ipcRenderer.once('file-saved', (event, filePath, error) => listener(event, filePath, error));
        }
        return ipcRenderer.once(channel, listener);
    }
});

contextBridge.exposeInMainWorld('process', {
    versions: process.versions,
    platform: process.platform,
    env: {
        NODE_ENV: process.env.NODE_ENV || 'development',
        CI: process.env.CI || false
    }
});

contextBridge.exposeInMainWorld('Buffer', Buffer);

const safeSendLog = (level, args) => {
    try {
        let meta = undefined;
        if (level === 'warn' || level === 'error') {
            meta = {
                source: 'renderer',
                ts: Date.now(),
                userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
                stack: (() => { try { throw new Error('__trace__'); } catch (e) { return e.stack; } })(),
            };
        }
        ipcRenderer.send('logger-log', { level, args, meta });
    } catch (_) { }
    try {
        if (level === 'warn') logWarn(...args);
        else if (level === 'error') console.error(...args);
        else console.log(...args);
    } catch (_) { }
};

contextBridge.exposeInMainWorld('logInfo', (...args) => safeSendLog('info', args));
contextBridge.exposeInMainWorld('logWarn', (...args) => safeSendLog('warn', args));
contextBridge.exposeInMainWorld('logError', (...args) => safeSendLog('error', args));
contextBridge.exposeInMainWorld('logwarn', (...args) => safeSendLog('warn', args));
contextBridge.exposeInMainWorld('logerror', (...args) => safeSendLog('error', args));