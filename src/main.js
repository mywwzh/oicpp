const { app, BrowserWindow, Menu, ipcMain, dialog, shell, webContents } = require('electron');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const os = require('os');
const StreamZip = require('node-stream-zip');
const extractZip = require('extract-zip');
let sevenBinPath = null;
try {
    sevenBinPath = require('7zip-bin').path7za;
} catch (_) {
    sevenBinPath = null;
}
const logger = require('./utils/logger');

const GDBDebugger = require('./gdb-debugger');
const MultiThreadDownloader = require('./utils/multi-thread-downloader');

const APP_VERSION = '1.2.1';
const SAVE_ALL_TIMEOUT = 4000;

function getUserIconPath() {
    const userIconPath = path.join(os.homedir(), '.oicpp', 'oicpp.ico');
    if (fs.existsSync(userIconPath)) {
        return userIconPath;
    }
    return path.join(__dirname, '../oicpp.ico');
}

let mainWindow;
let sampleTesterServer = null; // HTTP 服务实例
let competitiveCompanionServer = null; // Competitive Companion

const AUTH_BASE = 'https://auth.mywwzh.top';
const AUTH_LOGIN_PATH = '/oicpp_ide_login';
const AUTH_VERIFY_PATH = '/api/verify_token';
const AUTH_SERVICE = 'oicpp-ide';
const IDE_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

let ideLoginServer = null;
let ideLoginState = null;
let ideLoginTimeout = null;

let allowMainWindowClose = false;
let allowMainWindowCloseTimer = null;
let closeRequestInProgress = false;
let closeRequestInProgressTimer = null;

function armAllowMainWindowClose(timeoutMs = 15000) {
    allowMainWindowClose = true;
    if (allowMainWindowCloseTimer) {
        try { clearTimeout(allowMainWindowCloseTimer); } catch (_) { }
    }
    allowMainWindowCloseTimer = setTimeout(() => {
        allowMainWindowClose = false;
        allowMainWindowCloseTimer = null;
    }, timeoutMs);
}

function resetCloseGuards() {
    allowMainWindowClose = false;
    closeRequestInProgress = false;
    if (allowMainWindowCloseTimer) {
        try { clearTimeout(allowMainWindowCloseTimer); } catch (_) { }
        allowMainWindowCloseTimer = null;
    }
    if (closeRequestInProgressTimer) {
        try { clearTimeout(closeRequestInProgressTimer); } catch (_) { }
        closeRequestInProgressTimer = null;
    }
}

function requestRendererCloseConfirmation(context = '关闭窗口') {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (closeRequestInProgress) return;
    closeRequestInProgress = true;
    if (closeRequestInProgressTimer) {
        try { clearTimeout(closeRequestInProgressTimer); } catch (_) { }
    }
    closeRequestInProgressTimer = setTimeout(() => {
        closeRequestInProgress = false;
        closeRequestInProgressTimer = null;
    }, 10000);

    try {
        mainWindow.webContents.send('app-close-requested', { context });
    } catch (e) {
        try { logWarn(`[${context}] 无法通知渲染进程弹出关闭确认:`, e?.message || String(e)); } catch (_) { }
        closeRequestInProgress = false;
    }
}

function isLocalAddress(address) {
    const addr = String(address || '');
    return addr === '127.0.0.1' || addr === '::1' || addr.startsWith('::ffff:127.0.0.1');
}

function clearIdeLoginServer() {
    if (ideLoginTimeout) {
        try { clearTimeout(ideLoginTimeout); } catch (_) { }
        ideLoginTimeout = null;
    }
    if (ideLoginServer) {
        try { ideLoginServer.close(); } catch (_) { }
        ideLoginServer = null;
    }
    ideLoginState = null;
}

function broadcastIdeLoginState(payload) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('ide-login-updated', payload); } catch (_) { }
    }
}

function broadcastIdeLoginError(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('ide-login-error', { message }); } catch (_) { }
    }
}

function sendLoginHtml(res, title, message, statusCode = 200) {
    const escapeHtml = (input) => String(input || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const safeTitle = escapeHtml(title);
    const safeMsg = escapeHtml(message);
    const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>${safeTitle}</title></head><body style="font-family: sans-serif; padding: 24px;"><h2>${safeTitle}</h2><p>${safeMsg}</p><p>你可以关闭此页面。</p></body></html>`;
    try {
        res.writeHead(statusCode, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    } catch (_) {
        try { res.end(); } catch (_) { }
    }
}

function verifyIdeLoginToken(payload) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(payload || {});
        const req = https.request(`${AUTH_BASE}${AUTH_VERIFY_PATH}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            },
            timeout: 10000
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data || '{}');
                    resolve(json);
                } catch (err) {
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            try { req.destroy(new Error('请求超时')); } catch (_) { }
        });
        req.write(body);
        req.end();
    });
}

async function handleIdeLoginCallback(req, res) {
    if (!req || !res) return;

    if (!isLocalAddress(req.socket?.remoteAddress)) {
        sendLoginHtml(res, '登录失败', '非法回调来源。', 403);
        clearIdeLoginServer();
        return;
    }

    const reqUrl = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
    if (reqUrl.pathname !== '/callback') {
        sendLoginHtml(res, '未找到', '回调路径无效。', 404);
        return;
    }

    const params = reqUrl.searchParams;
    const uid = params.get('uid');
    const username = params.get('username');
    const timestamp = params.get('timestamp');
    const token = params.get('token');
    const accessToken = params.get('access_token');
    const service = params.get('service');
    const state = params.get('state');

    if (!state || state !== ideLoginState) {
        sendLoginHtml(res, '登录失败', '状态校验失败。');
        broadcastIdeLoginError('状态校验失败');
        clearIdeLoginServer();
        return;
    }

    if (!uid || !username || !timestamp || !token || service !== AUTH_SERVICE) {
        sendLoginHtml(res, '登录失败', '回调参数不完整或服务标识不匹配。');
        broadcastIdeLoginError('回调参数不完整');
        clearIdeLoginServer();
        return;
    }

    try {
        const verifyResult = await verifyIdeLoginToken({ uid, username, timestamp, token, service });
        if (!verifyResult || verifyResult.success !== true || !verifyResult.user) {
            sendLoginHtml(res, '登录失败', verifyResult?.error || '验证失败。');
            broadcastIdeLoginError(verifyResult?.error || '验证失败');
            clearIdeLoginServer();
            return;
        }

        settings.account = {
            user: verifyResult.user,
            loginToken: accessToken || '',
            loggedInAt: Date.now()
        };
        saveSettings();

        try {
            sendHeartbeat('start', verifyResult.user?.username || '');
        } catch (_) { }

        sendLoginHtml(res, '登录成功', '已完成登录。');
        broadcastIdeLoginState({ loggedIn: true, user: verifyResult.user, message: '登录成功' });
        clearIdeLoginServer();
    } catch (err) {
        sendLoginHtml(res, '登录失败', '验证请求失败。');
        broadcastIdeLoginError('验证请求失败');
        clearIdeLoginServer();
    }
}

function startIdeLoginFlow() {
    if (ideLoginServer) {
        return Promise.resolve({ ok: false, message: '登录流程正在进行，请稍候完成。' });
    }

    return new Promise((resolve) => {
        const state = crypto.randomBytes(16).toString('hex');
        ideLoginState = state;

        ideLoginServer = http.createServer((req, res) => {
            handleIdeLoginCallback(req, res);
        });

        ideLoginServer.on('error', (err) => {
            logError('[登录] 本地回调服务失败:', err?.message || err);
            broadcastIdeLoginError('本地回调服务启动失败');
            clearIdeLoginServer();
        });

        ideLoginServer.listen(0, '127.0.0.1', async () => {
            try {
                const port = ideLoginServer.address().port;
                const redirect = `http://127.0.0.1:${port}/callback`;
                const loginUrl = `${AUTH_BASE}${AUTH_LOGIN_PATH}?redirect=${encodeURIComponent(redirect)}&service=${encodeURIComponent(AUTH_SERVICE)}&state=${encodeURIComponent(state)}`;
                await shell.openExternal(loginUrl);
                ideLoginTimeout = setTimeout(() => {
                    broadcastIdeLoginError('登录超时，请重试');
                    clearIdeLoginServer();
                }, IDE_LOGIN_TIMEOUT_MS);
                resolve({ ok: true });
            } catch (err) {
                logError('[登录] 打开浏览器失败:', err?.message || err);
                broadcastIdeLoginError('打开浏览器失败');
                clearIdeLoginServer();
                resolve({ ok: false, message: '打开浏览器失败' });
            }
        });
    });
}

logger.init();
logger.logInfo('OICPP IDE 启动');

process.on('uncaughtException', (err) => {
    try { logger.logerror('[uncaughtException]', err); } catch (_) { }
});
process.on('unhandledRejection', (reason, p) => {
    try { logger.logerror('[unhandledRejection]', { reason, promise: String(p) }); } catch (_) { }
});

global.logInfo = (...args) => { try { logger.logInfo(...args); } catch (_) { } };
global.logwarn = (...args) => { try { logger.logwarn(...args); } catch (_) { } };
global.logerror = (...args) => { try { logger.logerror(...args); } catch (_) { } };
global.logWarn = global.logwarn;
global.logError = global.logerror;

function validateFileName(name) {
    if (!name || typeof name !== 'string') {
        return { valid: false, error: '名称不能为空' };
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
        return { valid: false, error: '名称不能为空' };
    }
    const illegalCharsWin = /[<>:"/\\|?*]/;
    const illegalCharsUnix = /\//;
    
    const illegalChars = process.platform === 'win32' ? illegalCharsWin : illegalCharsUnix;
    
    if (illegalChars.test(trimmedName)) {
        const platformMsg = process.platform === 'win32' 
            ? '文件名不能包含以下字符: < > : " / \\ | ? *'
            : '文件名不能包含字符: /';
        return { valid: false, error: platformMsg };
    }

    if (process.platform === 'win32') {
        const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
        if (reservedNames.test(trimmedName)) {
            return { valid: false, error: '该名称为系统保留名称，不能使用' };
        }
    }

    if (process.platform === 'win32' && /[\s.]$/.test(name)) {
        return { valid: false, error: '文件名不能以空格或句点结尾' };
    }

    return { valid: true, error: null };
}

const fileWatchRegistry = new Map();

function normalizeWatchKey(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        return null;
    }
    try {
        const resolved = path.resolve(filePath);
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
        return { key, resolved };
    } catch (error) {
        try { logger.logwarn('[FileWatch] 规范化路径失败', { filePath, error: error?.message || String(error) }); } catch (_) { }
        return null;
    }
}

function getSubscriberCount(entry) {
    if (!entry || !entry.subscribers) return 0;
    let total = 0;
    for (const info of entry.subscribers.values()) {
        if (info && typeof info.count === 'number') {
            total += info.count;
        }
    }
    return total;
}

function disposeWatcher(entry, key) {
    if (!entry) return;
    try { entry.watcher?.close(); } catch (_) { }
    if (key) {
        fileWatchRegistry.delete(key);
    }
}

function broadcastExternalChange(entry, payload) {
    if (!entry || !entry.subscribers) return;
    for (const [contentsId, info] of entry.subscribers.entries()) {
        if (!info || info.count <= 0) continue;
        try {
            const target = webContents.fromId(contentsId);
            if (target && !target.isDestroyed()) {
                target.send('external-file-changed', payload);
            } else {
                entry.subscribers.delete(contentsId);
            }
        } catch (error) {
            try { logger.logwarn('[FileWatch] 推送变更失败', { contentsId, error: error?.message || String(error) }); } catch (_) { }
        }
    }
}

function handleWatcherEvent(key, eventType) {
    const entry = fileWatchRegistry.get(key);
    if (!entry) return;

    const now = Date.now();
    if (entry.lastLocalSave && now - entry.lastLocalSave < 750) {
        return;
    }

    let exists = false;
    let mtimeMs = null;
    try {
        const stat = fs.statSync(entry.resolvedPath);
        exists = true;
        mtimeMs = stat.mtimeMs;
    } catch (_) {
        exists = false;
    }

    let changeType = 'modified';
    if (!exists) {
        changeType = 'deleted';
    } else if (eventType === 'rename') {
        changeType = 'renamed';
    }

    const signature = `${changeType}:${mtimeMs ?? 'NA'}`;
    if (signature === entry.lastEventSignature) {
        return;
    }
    entry.lastEventSignature = signature;
    entry.lastObservedMtime = mtimeMs ?? null;

    const payload = {
        filePath: entry.resolvedPath,
        changeType,
        eventType,
        exists,
        mtimeMs,
        timestamp: now
    };

    broadcastExternalChange(entry, payload);

    if (getSubscriberCount(entry) === 0) {
        disposeWatcher(entry, key);
    }
}

function markLocalSave(filePath) {
    const normalized = normalizeWatchKey(filePath);
    if (!normalized) return;
    const entry = fileWatchRegistry.get(normalized.key);
    if (!entry) return;
    entry.lastLocalSave = Date.now();
    entry.lastEventSignature = null;
}

function removeRendererWatchers(contentsId) {
    if (!contentsId) return;
    for (const [key, entry] of Array.from(fileWatchRegistry.entries())) {
        if (!entry?.subscribers || !entry.subscribers.has(contentsId)) continue;
        entry.subscribers.delete(contentsId);
        if (getSubscriberCount(entry) === 0) {
            disposeWatcher(entry, key);
        }
    }
}

function disposeAllFileWatchers() {
    for (const [key, entry] of Array.from(fileWatchRegistry.entries())) {
        disposeWatcher(entry, key);
    }
}

const EXTERNAL_OPEN_SUPPORTED_EXTENSIONS = new Set(['.cpp', '.c', '.cc', '.cxx', '.h', '.hpp']);
const pendingExternalOpenQueue = [];
let rendererReadyForExternalOpens = false;
let processingExternalOpenQueue = false;
let skipAutoOpenWorkspace = false;

function getDefaultSettings() {
    let compilerArgs = '-std=c++14 -O2 -static';
    let cppTemplate = '';

    return {
        compilerPath: '',
        compilerArgs,
        testlibPath: '', // testlib库路径
        font: 'Consolas',
        fontSize: 14,
        lineHeight: 0,
        theme: 'dark',
        tabSize: 4,
        fontLigaturesEnabled: true, // 是否启用编程字体连字（Fira Code 等）
        foldingEnabled: true,
        stickyScrollEnabled: true,
        enableAutoCompletion: true,
        autoSave: true,
        autoSaveInterval: 60000,
        markdownMode: 'split',
        lastUpdateCheck: '1970-01-01',
        pendingUpdate: null, // 待安装的更新信息
        lastOpen: '', // 最后打开的工作区路径
        autoOpenLastWorkspace: true,
        recentFiles: [], // 最近使用的文件列表
        codeSnippets: [],
        windowOpacity: 1.0,
        backgroundImage: '',
        cppTemplate,
        account: null,
        keybindings: {
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
        }
    };
}

let settings = getDefaultSettings();

let isUpdateDownloading = false; // 是否正在下载更新
let currentDownloadingVersion = null; // 正在下载的版本
let pendingInstallerLaunch = null; // 退出后待启动的安装程序
let pendingInstallerLaunchArmed = false;

let debugProcess = null;
let debugSession = null;
let breakpoints = new Map();
let currentOpenFile = null;
let isDebugging = false;
let debugSessionRootDir = null;
let lastDebugCommand = null;
let autoSkipInternalCounter = 0;
const AUTO_SKIP_INTERNAL_LIMIT = 8;
const AUTO_SKIP_ELIGIBLE_COMMANDS = new Set(['continue', 'step', 'stepi', 'finish']);

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, commandLine, workingDirectory) => {
        try {
            const files = extractSupportedFilesFromArgs(
                Array.isArray(commandLine) ? commandLine.slice(1) : [],
                { workingDirectory }
            );
            if (files.length > 0) {
                files.forEach(queueExternalFileOpen);
                processExternalOpenQueue();
            }
        } catch (err) {
            logWarn('处理 second-instance 参数失败:', err?.message || err);
        }

        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });
}

function broadcastCurrentVariablesSnapshot(targetEvent = null) {
    if (!gdbDebugger || !gdbDebugger.isRunning) return;
    try {
        const snapshot = gdbDebugger.getVariables ? gdbDebugger.getVariables() : null;
        if (!snapshot) return;
        const payload = {
            local: snapshot.local || {},
            global: snapshot.global || {},
            watches: snapshot.watches || {}
        };
        if (targetEvent && typeof targetEvent.reply === 'function') {
            try { targetEvent.reply('debug-variables-updated', payload); } catch (_) { }
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
            try { mainWindow.webContents.send('debug-variables-updated', payload); } catch (_) { }
        }
    } catch (err) {
        try { logWarn('[主进程] 广播变量快照失败:', err?.message || err); } catch (_) { }
    }
}

function normalizePathLowerCase(p) {
    try {
        return path.resolve(p).replace(/\\/g, '/').toLowerCase();
    } catch (_) {
        return String(p || '').replace(/\\/g, '/').toLowerCase();
    }
}

function isFrameOutsideUserCode(frameFile) {
    const raw = String(frameFile || '').trim();
    if (!raw || raw === '??' || raw.startsWith('<') || raw.startsWith('[')) {
        return true;
    }
    if (!debugSessionRootDir) {
        return false;
    }
    try {
        const root = normalizePathLowerCase(debugSessionRootDir);
        const resolved = normalizePathLowerCase(path.isAbsolute(raw) ? raw : path.join(debugSessionRootDir, raw));
        const rootPrefix = root.endsWith('/') ? root : `${root}/`;
        return !(resolved === root || resolved.startsWith(rootPrefix));
    } catch (_) {
        return true;
    }
}

function findConsolePauser() {
    const userProfilePath = os.homedir();
    const consolePauserPath = path.join(userProfilePath, '.oicpp', 'consolePauser.exe');

    if (fs.existsSync(consolePauserPath)) {
        return consolePauserPath;
    }
    return null;
}

function findCompilerExecutable(baseDir) {
    logInfo('[查找编译器] 开始在目录中查找:', baseDir);

    const commonPaths = [
        'bin/g++.exe',
        'bin/gcc.exe',
        'mingw64/bin/g++.exe',
        'mingw32/bin/g++.exe',
        'x86_64-w64-mingw32/bin/g++.exe',
        'i686-w64-mingw32/bin/g++.exe'
    ];

    logInfo('[查找编译器] 检查常见路径...');
    for (const relativePath of commonPaths) {
        const fullPath = path.join(baseDir, relativePath);
        logInfo('[查找编译器] 检查路径:', fullPath);
        if (fs.existsSync(fullPath)) {
            logInfo('[查找编译器] 找到编译器:', fullPath);
            return fullPath;
        }
    }

    logInfo('[查找编译器] 常见路径未找到，开始递归搜索...');

    try {
        const files = walkDir(baseDir);
        logInfo('[查找编译器] 搜索到的所有文件数量:', files.length);

        const gppFiles = files.filter(file =>
            file.endsWith('g++.exe') || file.endsWith('gcc.exe')
        );

        logInfo('[查找编译器] 找到的编译器文件:', gppFiles);

        if (gppFiles.length > 0) {
            logInfo('[查找编译器] 使用第一个找到的编译器:', gppFiles[0]);
            return gppFiles[0];
        }
    } catch (error) {
        logError('[查找编译器] 搜索编译器可执行文件失败:', error);
    }

    logInfo('[查找编译器] 未找到任何编译器可执行文件');
    return null;
}

function walkDir(dir) {
    const files = [];
    function walk(currentDir) {
        try {
            const items = fs.readdirSync(currentDir);
            for (const item of items) {
                if (item.toLowerCase().endsWith('.dsym')) continue;
                const fullPath = path.join(currentDir, item);
                try {
                    const stat = fs.statSync(fullPath);
                    if (stat.isDirectory()) {
                        walk(fullPath);
                    } else {
                        files.push(fullPath);
                    }
                } catch (error) {
                    logInfo('[查找编译器] 跳过无法访问的文件:', fullPath, error.message);
                }
            }
        } catch (error) {
            logInfo('[查找编译器] 无法读取目录:', currentDir, error.message);
        }
    }
    walk(dir);
    return files;
}

ipcMain.on('open-folder', openFolder);

ipcMain.handle('get-user-icon-path', () => {
    return getUserIconPath();
});

ipcMain.handle('get-build-info', () => {
    try {
        const buildInfoPath = path.join(__dirname, 'build-info.json');
        if (fs.existsSync(buildInfoPath)) {
            const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
            return buildInfo;
        }
    } catch (error) {
        logger.logwarn('读取构建信息失败:', error);
    }
    return { version: '1.2.1 (v25)', buildTime: '未知', author: 'mywwzh' };
});

function requestSaveAllAndClose(context = '关闭窗口') {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    
    try {
        mainWindow.webContents.send('request-save-all');
        const timeout = setTimeout(() => {
            try { logWarn(`[${context}] 保存超时，强制关闭窗口`); } catch (_) { }
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.close();
            }
        }, SAVE_ALL_TIMEOUT);
        
        ipcMain.once('save-all-complete', () => {
            clearTimeout(timeout);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.close();
            }
        });
    } catch (e) {
        try { logWarn(`[${context}] 发送保存请求失败，直接关闭:`, e?.message || String(e)); } catch (_) { }
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.close();
        }
    }
}

function requestCloseWithoutSave(context = '关闭窗口') {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }
    try {
        armAllowMainWindowClose();
        mainWindow.close();
    } catch (e) {
        try { logWarn(`[${context}] 丢弃保存关闭失败:`, e?.message || String(e)); } catch (_) { }
    }
}

function createWindow() {
    loadSettings();
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false, // 出于安全原因，建议禁用
            contextIsolation: true,
            sandbox: false,
            webSecurity: false,
            devTools: process.argv.includes('--dev')
        },
        icon: getUserIconPath(),
        frame: false,
        titleBarStyle: 'hidden',
        opacity: settings.windowOpacity || 1.0,
        show: false
    });

    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': ["script-src 'self' 'unsafe-inline' 'unsafe-eval'; worker-src 'self' blob:;"],
                'Permissions-Policy': ['fullscreen=*']
            }
        });
    });

    mainWindow.loadFile('src/renderer/index.html');

    let initialExternalReadyTriggered = false;
    mainWindow.webContents.on('did-finish-load', () => {
        if (!initialExternalReadyTriggered) {
            initialExternalReadyTriggered = true;
            setTimeout(() => {
                rendererReadyForExternalOpens = true;
                processExternalOpenQueue();
            }, 400);
        } else {
            rendererReadyForExternalOpens = true;
            processExternalOpenQueue();
        }
    });

    if (process.argv.includes('--dev')) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.once('ready-to-show', () => {
        mainWindow.show();

        mainWindow.webContents.send('settings-loaded', settings);

        (function autoOpenWorkspace() {
            if (skipAutoOpenWorkspace) {
                logInfo('[启动] 检测到外部文件打开请求，跳过自动恢复工作区');
                return;
            }
            let target = null;
            if (settings.autoOpenLastWorkspace === false) {
                logInfo('[启动] 已关闭自动恢复工作区');
                return;
            }
            if (settings.lastOpen && fs.existsSync(settings.lastOpen)) {
                target = settings.lastOpen;
            } else if (Array.isArray(settings.recentFiles) && settings.recentFiles.length > 0) {
                for (const rf of settings.recentFiles) {
                    const p = typeof rf === 'string' ? rf : rf.path;
                    if (p && fs.existsSync(p)) { target = p; break; }
                }
            }
            if (target) {
                setTimeout(() => {
                    logInfo('[启动] 自动打开工作区:', target);
                    mainWindow.webContents.send('folder-opened', target);
                }, 1200);
            }
        })();

        checkPendingUpdate();

        checkDailyUpdate().catch(err => logError('启动时检查更新失败:', err));
        
        // 清理启动时可能遗留的旧安装包（延迟执行，避免影响启动速度）
        setTimeout(async () => {
            try {
                // 如果有待处理的更新，保留其安装包
                const keepFile = settings.pendingUpdate?.installerPath || null;
                await cleanupOldInstallers(keepFile);
            } catch (err) {
                logWarn('[启动] 清理旧安装包失败:', err);
            }
        }, 5000);

        try { restoreSettingsBackupLinux(); ensureUserIconForLinux(); } catch (_) { }
    });

    mainWindow.on('close', (e) => {
        try {
            if (allowMainWindowClose) {
                return;
            }
            e.preventDefault();
            requestRendererCloseConfirmation('关闭窗口');
        } catch (err) {
            try { logWarn('[关闭窗口] close 事件拦截失败，已阻止关闭:', err?.message || String(err)); } catch (_) { }
            try { e.preventDefault(); } catch (_) { }
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
        resetCloseGuards();
    });

    createMenuBar();

    setupWindowControls();

    setupIPC();


    ipcMain.handle('open-external', async (_event, url) => {
        try {
            if (!url || typeof url !== 'string') {
                throw new Error('Invalid URL');
            }
            await shell.openExternal(url);
            return { ok: true };
        } catch (err) {
            logError('open-external 失败:', err?.message || err);
            throw err;
        }
    });

    startSampleTesterServer();
}


function createMenuBar() {
    const compileRunAccelerator = 'F11';
    const menuTemplate = [
        {
            label: '文件',
            submenu: [
                {
                    label: '新建 C++ 文件',
                    accelerator: 'CmdOrCtrl+N',
                    click: () => {
                        mainWindow.webContents.send('menu-new-cpp-file');
                    }
                },
                {
                    label: '打开文件',
                    accelerator: 'CmdOrCtrl+O',
                    click: () => {
                        openFile();
                    }
                },
                {
                    label: '打开文件夹',
                    accelerator: 'CmdOrCtrl+K',
                    click: () => {
                        openFolder();
                    }
                },
                { type: 'separator' },
                {
                    label: '保存',
                    accelerator: 'CmdOrCtrl+S',
                    click: () => {
                        mainWindow.webContents.send('menu-save-file');
                    }
                },
                {
                    label: '另存为',
                    accelerator: 'CmdOrCtrl+Shift+S',
                    click: () => {
                        saveAsFile();
                    }
                },
                { type: 'separator' },
                {
                    label: '设置',
                    accelerator: 'CmdOrCtrl+,',
                    click: () => {
                        mainWindow.webContents.send('menu-open-settings');
                    }
                },
                {
                    label: '模板设置',
                    accelerator: 'CmdOrCtrl+T',
                    click: () => {
                        openCodeTemplates();
                    }
                }
            ]
        },
        {
            label: '运行',
            submenu: [
                {
                    label: '调试',
                    click: () => {
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('menu-debug');
                        }
                    }
                },
                {
                    label: '编译',
                    accelerator: 'F9',
                    click: () => {
                        mainWindow.webContents.send('menu-compile');
                    }
                },
                {
                    label: '运行',
                    accelerator: 'F10',
                    click: () => {
                        mainWindow.webContents.send('menu-run');
                    }
                },
                {
                    label: '编译运行',
                    accelerator: compileRunAccelerator,
                    click: () => {
                        mainWindow.webContents.send('menu-compile-run');
                    }
                }
            ]
        },
        {
            label: '帮助',
            submenu: [
                {
                    label: '检查更新',
                    click: () => {
                        checkForUpdates(true); // true 表示手动检查
                    }
                }
            ]
        }
    ];

    const menu = Menu.buildFromTemplate(menuTemplate);
    Menu.setApplicationMenu(menu);
}

function writeJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    });
    res.end(JSON.stringify(payload));
}

function getRequestPath(req) {
    try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        let pathname = url.pathname || '/';
        if (pathname.length > 1 && pathname.endsWith('/')) {
            pathname = pathname.slice(0, -1);
        }
        return pathname || '/';
    } catch (_) {
        return req.url || '/';
    }
}

function readJsonBody(req, res, callback) {
    let body = '';
    req.on('data', chunk => {
        body += chunk;
        if (body.length > 2 * 1024 * 1024) {
            req.destroy();
        }
    }); // 2MB 限制
    req.on('end', () => {
        let data = null;
        try { data = JSON.parse(body || '{}'); } catch (_) { }
        if (!data || typeof data !== 'object') {
            return writeJson(res, 400, { code: 400, message: 'Invalid JSON body' });
        }
        callback(data);
    });
}

function normalizeCompetitiveCompanionPayload(data) {
    if (!data || typeof data !== 'object') {
        return { ok: false, message: 'body must be JSON object', invalidField: 'body' };
    }

    const titleRaw = (typeof data.title === 'string' && data.title.trim())
        ? data.title.trim()
        : (typeof data.name === 'string' && data.name.trim())
            ? data.name.trim()
            : (typeof data.problemName === 'string' && data.problemName.trim())
                ? data.problemName.trim()
                : '';

    if (!titleRaw) {
        return { ok: false, message: 'problem title missing', invalidField: 'title' };
    }

    if (!Array.isArray(data.tests) || data.tests.length === 0) {
        return { ok: false, message: 'tests must not be empty', invalidField: 'tests' };
    }

    let ojName = 'Competitive Companion';
    if (typeof data.group === 'string' && data.group.trim()) {
        ojName = data.group.trim();
    } else if (typeof data.source === 'string' && data.source.trim()) {
        ojName = data.source.trim();
    } else if (typeof data.url === 'string' && data.url.trim()) {
        try {
            const host = new URL(data.url.trim()).hostname;
            if (host) ojName = host;
        } catch (_) { }
    }

    let timeLimitMs;
    if (typeof data.timeLimit === 'number' && Number.isFinite(data.timeLimit) && data.timeLimit > 0) {
        timeLimitMs = data.timeLimit <= 50 ? Math.round(data.timeLimit * 1000) : Math.round(data.timeLimit);
    }

    const samples = data.tests.map((t, idx) => ({
        id: idx + 1,
        input: typeof t?.input === 'string' ? t.input : '',
        output: typeof t?.output === 'string' ? t.output : '',
        timeLimit: timeLimitMs
    }));

    const payload = {
        OJ: ojName,
        problemName: titleRaw,
        samples
    };

    return { ok: true, payload };
}

function createCompetitiveCompanionServer(port, tagLabel) {
    const label = tagLabel || 'CompetitiveCompanion';
    const server = http.createServer(async (req, res) => {
        const requestPath = getRequestPath(req);
        const acceptPaths = new Set(['/', '/competitive-companion', '/add', '/receive', '/companion']);
        if (req.method === 'OPTIONS') {
            return writeJson(res, 204, { code: 204, message: 'No Content' });
        }
        if (req.method === 'POST' && acceptPaths.has(requestPath)) {
            readJsonBody(req, res, (data) => {
                const normalized = normalizeCompetitiveCompanionPayload(data);
                if (!normalized.ok) {
                    const resp = { code: 400, message: 'Invalid parameters: ' + normalized.message, invalidField: normalized.invalidField };
                    return writeJson(res, 400, resp);
                }

                const result = validateSampleTesterPayload(normalized.payload);
                if (!result.valid) {
                    const resp = { code: 400, message: 'Invalid parameters: ' + result.message, invalidField: result.invalidField };
                    return writeJson(res, 400, resp);
                }

                try {
                    logger.logInfo(`[${label}] 收到题目:`, normalized.payload.problemName, '样例数:', normalized.payload.samples?.length || 0);
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('sample-tester-create-problem', normalized.payload);
                    }
                } catch (e) { logger.logerror(`发送 ${label} 样例创建事件失败`, e); }

                return writeJson(res, 200, { code: 200, message: 'Problem created successfully' });
            });
            return;
        }
        return writeJson(res, 404, { code: 404, message: 'Not Found' });
    });

    server.on('request', (req) => {
        try {
            const requestPath = getRequestPath(req);
            logger.logInfo(`[${label}] 请求:`, req.method, requestPath, '来自', req.socket?.remoteAddress || 'unknown');
        } catch (_) { }
    });

    server.on('error', (err) => {
        if (err && err.code === 'EADDRINUSE') {
            try { logWarn(`[${label}] 端口 ${port} 被占用，可能被其他工具占用（如 cph）。可在 Competitive Companion 中添加 http://127.0.0.1:${port}/ 作为自定义端口。`); } catch (_) { }
            return;
        }
        try { logger.logerror(`[${label}] 服务出错`, err); } catch (_) { }
    });

    server.listen(port, '0.0.0.0', () => {
        logger.logInfo(`[${label}] 服务已启动 http://127.0.0.1:${port}`);
    });

    return server;
}

function startSampleTesterServer() {
    try {
        if (sampleTesterServer) return; // 已启动
        const PORT = 20030;
        sampleTesterServer = http.createServer(async (req, res) => {
            const requestPath = getRequestPath(req);
            if (req.method === 'OPTIONS') {
                return writeJson(res, 204, { code: 204, message: 'No Content' });
            }
            if (req.method === 'POST' && requestPath === '/createNewProblem') {
                readJsonBody(req, res, (data) => {
                    const result = validateSampleTesterPayload(data);
                    if (!result.valid) {
                        const resp = { code: 400, message: 'Invalid parameters: ' + result.message, invalidField: result.invalidField };
                        return writeJson(res, 400, resp);
                    }
                    try {
                        logger.logInfo('[SampleTesterAPI] 收到题目:', data.problemName, '样例数:', data.samples?.length || 0);
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('sample-tester-create-problem', data);
                        }
                    } catch (e) { logger.logerror('发送样例创建事件失败', e); }
                    return writeJson(res, 200, { code: 200, message: 'Problem created successfully' });
                });
                return;
            }
            return writeJson(res, 404, { code: 404, message: 'Not Found' });
        });
        sampleTesterServer.on('request', (req) => {
            try {
                const requestPath = getRequestPath(req);
                logger.logInfo('[SampleTesterAPI] 请求:', req.method, requestPath, '来自', req.socket?.remoteAddress || 'unknown');
            } catch (_) { }
        });
        sampleTesterServer.listen(PORT, '0.0.0.0', () => {
            logger.logInfo(`[SampleTesterAPI] 服务已启动 http://127.0.0.1:${PORT}`);
        });
    } catch (err) {
        try { logger.logerror('[SampleTesterAPI] 启动失败', err); } catch (_) { }
    }

    startCompetitiveCompanionServer();
}

function startCompetitiveCompanionServer() {
    try {
        if (competitiveCompanionServer) return; // 已启动
        competitiveCompanionServer = createCompetitiveCompanionServer(10043, 'CompetitiveCompanion');
    } catch (err) {
        try { logger.logerror('[CompetitiveCompanion] 启动失败', err); } catch (_) { }
    }
}

function validateSampleTesterPayload(data) {
    if (!data || typeof data !== 'object') return { valid: false, message: 'body must be JSON object', invalidField: 'body' };
    if (!data.problemName || typeof data.problemName !== 'string') return { valid: false, message: 'problemName missing.', invalidField: 'problemName' };
    if (!Array.isArray(data.samples) || data.samples.length === 0) return { valid: false, message: 'samples must not be empty.', invalidField: 'samples' };
    const ids = new Set();
    for (const s of data.samples) {
        if (!s || typeof s !== 'object') return { valid: false, message: 'sample must be object', invalidField: 'samples' };
        if (!Number.isInteger(s.id) || s.id <= 0) return { valid: false, message: 'sample id invalid', invalidField: 'id' };
        if (ids.has(s.id)) return { valid: false, message: 'duplicate sample id', invalidField: 'id' };
        ids.add(s.id);
        if (typeof s.input !== 'string') return { valid: false, message: 'input must be string', invalidField: 'input' };
        if (typeof s.output !== 'string') return { valid: false, message: 'output must be string', invalidField: 'output' };
        if (s.timeLimit !== undefined && (!Number.isInteger(s.timeLimit) || s.timeLimit <= 0)) return { valid: false, message: 'timeLimit must be positive integer', invalidField: 'timeLimit' };
    }
    return { valid: true };
}

app.on('before-quit', () => {
    try { if (sampleTesterServer) { sampleTesterServer.close(); sampleTesterServer = null; } } catch (_) { }
    try { if (competitiveCompanionServer) { competitiveCompanionServer.close(); competitiveCompanionServer = null; } } catch (_) { }
});

function setupWindowControls() {
    ipcMain.on('window-minimize', () => {
        if (mainWindow) {
            mainWindow.minimize();
        }
    });

    ipcMain.on('window-maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) {
                mainWindow.unmaximize();
            } else {
                mainWindow.maximize();
            }
        }
    });

    ipcMain.on('window-unmaximize', () => {
        if (mainWindow) {
            mainWindow.unmaximize();
        }
    });

    ipcMain.on('window-close', () => {
        // 标题栏关闭按钮已在渲染进程侧确认，这里直接进入保存并关闭，同时避免 close 事件二次拦截
        armAllowMainWindowClose();
        requestSaveAllAndClose('关闭窗口');
    });

    ipcMain.on('window-close-discard', () => {
        // 丢弃未保存修改并关闭
        armAllowMainWindowClose();
        requestCloseWithoutSave('关闭窗口');
    });

    // 系统级关闭确认回传（Alt+F4 等）
    ipcMain.on('app-close-confirmed', () => {
        closeRequestInProgress = false;
        if (closeRequestInProgressTimer) {
            try { clearTimeout(closeRequestInProgressTimer); } catch (_) { }
            closeRequestInProgressTimer = null;
        }
        armAllowMainWindowClose();
        requestSaveAllAndClose('关闭窗口');
    });

    ipcMain.on('app-close-discard', () => {
        closeRequestInProgress = false;
        if (closeRequestInProgressTimer) {
            try { clearTimeout(closeRequestInProgressTimer); } catch (_) { }
            closeRequestInProgressTimer = null;
        }
        armAllowMainWindowClose();
        requestCloseWithoutSave('关闭窗口');
    });

    ipcMain.on('app-close-cancelled', () => {
        closeRequestInProgress = false;
        if (closeRequestInProgressTimer) {
            try { clearTimeout(closeRequestInProgressTimer); } catch (_) { }
            closeRequestInProgressTimer = null;
        }
    });

    ipcMain.handle('window-is-maximized', () => {
        return mainWindow ? mainWindow.isMaximized() : false;
    });

    if (mainWindow) {
        mainWindow.on('maximize', () => {
            mainWindow.webContents.send('window-maximized');
        });

        mainWindow.on('unmaximize', () => {
            mainWindow.webContents.send('window-unmaximized');
        });
    }
}

function setupIPC() {
    ipcMain.handle('get-app-path', () => {
        return app.getAppPath();
    });
    ipcMain.on('request-new-file', (event, fileType) => {
        logInfo(`新建文件: ${fileType}`);
    });

    ipcMain.on('request-open-file', (event, filePath) => {
        logInfo(`打开文件: ${filePath}`);
    });

    ipcMain.on('request-save-file', (event, filePath, content) => {
        logInfo(`保存文件: ${filePath}`);
    });

    ipcMain.on('settings-preview', (event, previewSettings) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            logInfo('接收到预览设置并转发给主窗口:', previewSettings);
            mainWindow.webContents.send('apply-settings-preview', previewSettings);
        }
    });

    ipcMain.on('logger-log', (event, payload) => {
        try {
            const { level = 'info', args = [], meta } = payload || {};
            if (meta) {
                const wrapped = [
                    '[renderer]',
                    ...args,
                    { __meta: meta }
                ];
                if (level === 'error') logger.logerror(...wrapped);
                else if (level === 'warn') logger.logwarn(...wrapped);
                else logger.logInfo(...wrapped);
            } else {
                if (level === 'error') logger.logerror(...args);
                else if (level === 'warn') logger.logwarn(...args);
                else logger.logInfo(...args);
            }
        } catch (e) {
        }
    });

    ipcMain.handle('update-settings', async (event, newSettings) => {
        try {
            settings = { ...settings, ...newSettings };
            
            if (mainWindow && !mainWindow.isDestroyed()) {
                if (typeof newSettings.windowOpacity === 'number') {
                    mainWindow.setOpacity(newSettings.windowOpacity);
                }
            }

            await saveSettings(); // 确保保存完成
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('settings-applied', settings);
            }

            return { success: true };
        } catch (error) {
            logError('保存设置失败:', error);
            return { success: false, error: error.message };
        }
    });



    ipcMain.handle('get-settings', (event, settingsType) => {
        return settings;
    });



    ipcMain.handle('get-all-settings', () => {
        return settings;
    });

    ipcMain.handle('ide-login-start', async () => {
        return startIdeLoginFlow();
    });

    ipcMain.handle('ide-login-status', () => {
        const user = getLoggedInUser();
        const loginToken = getLoginToken();
        return { loggedIn: !!user, user, loginToken };
    });

    ipcMain.handle('cloud-sync-request', async (_event, payload) => {
        return callCloudSyncApi(payload || {});
    });

    ipcMain.handle('ide-logout', () => {
        settings.account = null;
        saveSettings();
        broadcastIdeLoginState({ loggedIn: false, user: null, message: '已退出登录' });
        return { ok: true };
    });

    ipcMain.handle('get-top-level-settings', () => {
        return settings;
    });

    ipcMain.handle('update-top-level-settings', (event, newSettings) => {
        return updateSettings(null, newSettings);
    });

    ipcMain.handle('updateSettings', (event, newSettings) => {
        return updateSettings(null, newSettings);
    });

    ipcMain.handle('reset-settings', (settingsType) => {
        return resetSettings();
    });

    ipcMain.handle('get-system-info', () => {
        const base = {
            platform: process.platform,
            arch: process.arch,
            nodeVersion: process.version,
            homedir: os.homedir(),
            tmpdir: os.tmpdir(),
            osRelease: os.release()
        };
        let systemVersion = '';
        let distro = '';
        try {
            const { execSync } = require('child_process');
            if (process.platform === 'win32') {
                try {
                    const prodNameRaw = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v ProductName', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
                    const matchName = prodNameRaw.match(/ProductName\s+REG_[A-Z_]+\s+(.+)/i);
                    if (matchName) distro = matchName[1].trim();
                } catch (_) { }
                try {
                    const buildRaw = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v CurrentBuild', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
                    const matchBuild = buildRaw.match(/CurrentBuild\s+REG_[A-Z_]+\s+(\d+)/i);
                    const ubrRaw = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v UBR', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
                    const matchUbr = ubrRaw.match(/UBR\s+REG_[A-Z_]+\s+(\d+)/i);
                    const build = matchBuild ? matchBuild[1] : '';
                    const ubr = matchUbr ? matchUbr[1] : '';
                    if (build) systemVersion = `Build ${build}${ubr ? '.' + ubr : ''}`;
                } catch (_) { }
                if (!distro) distro = 'Windows';
            } else if (process.platform === 'linux') {
                try {
                    const osReleaseContent = fs.readFileSync('/etc/os-release', 'utf8');
                    const pretty = osReleaseContent.match(/^PRETTY_NAME="?([^"\n]+)"?/m);
                    if (pretty) {
                        distro = pretty[1];
                        systemVersion = distro; // 通常已经包含版本
                    }
                    const nameM = osReleaseContent.match(/^NAME="?([^"\n]+)"?/m);
                    const verM = osReleaseContent.match(/^VERSION="?([^"\n]+)"?/m);
                    if (!systemVersion && (nameM || verM)) {
                        systemVersion = [nameM ? nameM[1] : '', verM ? verM[1] : ''].filter(Boolean).join(' ');
                    }
                } catch (_) { }
                if (!distro) distro = 'Linux';
                if (!systemVersion) systemVersion = `Kernel ${base.osRelease}`;
            } else {
                if (!distro) distro = 'Unknown';
                if (!systemVersion) systemVersion = base.osRelease || '';
            }
        } catch (e) {
        }
        return { ...base, systemVersion, distro };
    });

    ipcMain.handle('show-open-dialog', async (event, options) => {
        try {
            const bw = BrowserWindow.fromWebContents(event.sender) || mainWindow;
            return await dialog.showOpenDialog(bw, options);
        } catch (e) {
            logError('show-open-dialog 失败:', e);
            return { canceled: true, filePaths: [], error: e.message };
        }
    });

    ipcMain.handle('show-save-dialog', async (event, options) => {
        try {
            const bw = BrowserWindow.fromWebContents(event.sender) || mainWindow;
            return await dialog.showSaveDialog(bw, options);
        } catch (e) {
            logError('show-save-dialog 失败:', e);
            return { canceled: true, filePath: undefined, error: e.message };
        }
    });

    ipcMain.handle('show-message-box', async (event, options) => {
        try {
            const bw = BrowserWindow.fromWebContents(event.sender) || mainWindow;
            return await dialog.showMessageBox(bw, options);
        } catch (e) {
            logError('show-message-box 失败:', e);
            return { response: -1, checkboxChecked: false, error: e.message };
        }
    });

    ipcMain.handle('open-path', async (_event, targetPath, options = {}) => {
        try {
            if (!targetPath || typeof targetPath !== 'string') {
                throw new Error('无效的路径');
            }
            const normalized = path.normalize(targetPath);
            let stat = null;
            try {
                stat = fs.existsSync(normalized) ? fs.statSync(normalized) : null;
            } catch (_) {
                stat = null;
            }

            if (stat && stat.isFile() && (options?.reveal || options?.highlight)) {
                shell.showItemInFolder(normalized);
                return { success: true, action: 'reveal' };
            }

            if (stat && stat.isFile()) {
                shell.showItemInFolder(normalized);
                return { success: true, action: 'reveal' };
            }

            const result = await shell.openPath(normalized);
            if (result) {
                throw new Error(result);
            }
            return { success: true, action: 'open' };
        } catch (error) {
            logWarn('open-path 失败:', error?.message || error);
            return { success: false, error: error?.message || String(error) };
        }
    });

    ipcMain.on('compile-code', (event, code, options) => {
        compileCode(code, options).then(result => {
            event.reply('compile-result', result);
        }).catch(error => {
            event.reply('compile-error', error.message);
        });
    });

    ipcMain.on('start-debug', (event, filePath, options) => {
        startDebugSession(filePath, options).then(result => {
            event.reply('debug-started', result);
        }).catch(error => {
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('stop-debug', (event) => {
        stopDebugSession().then(result => {
            event.reply('debug-stopped', result);
        }).catch(error => {
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('debug-step-over', (event) => {
        sendDebugCommand('step').then(result => {
            event.reply('debug-output', { message: '步过执行', type: 'debug' });
        }).catch(error => {
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('debug-step-into', (event) => {
        sendDebugCommand('stepi').then(result => {
            event.reply('debug-output', { message: '步入执行', type: 'debug' });
        }).catch(error => {
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('debug-step-out', (event) => {
        sendDebugCommand('finish').then(result => {
            event.reply('debug-output', { message: '步出执行', type: 'debug' });
        }).catch(error => {
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('debug-continue', (event) => {
        logInfo('[主进程] 收到继续执行命令');
        sendDebugCommand('continue').then(result => {
            logInfo('[主进程] 继续执行命令发送成功');
            event.reply('debug-output', { message: '继续执行', type: 'debug' });
        }).catch(error => {
            logError('[主进程] 继续执行命令失败:', error);
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('debug-run', (event) => {
        logInfo('[主进程] 收到手动启动程序命令');
        if (gdbDebugger && gdbDebugger.isRunning) {
            gdbDebugger.run().then(() => {
                logInfo('[主进程] 程序手动启动成功');
                event.reply('debug-output', { message: '程序已启动', type: 'debug' });

                if (mainWindow) {
                    mainWindow.webContents.send('debug-running');
                }
            }).catch(error => {
                logError('[主进程] 手动启动程序失败:', error);
                event.reply('debug-error', error.message);
            });
        } else {
            event.reply('debug-error', '调试器未运行');
        }
    });

    ipcMain.on('debug-send-input', (event, input) => {
        sendDebugInput(input).then(result => {
            event.reply('debug-output', { message: `输入已发送: ${input}`, type: 'input' });
        }).catch(error => {
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('debug-add-breakpoint', (event, breakpoint) => {
        logInfo('[主进程] 收到添加断点请求:', breakpoint);
        addBreakpoint(breakpoint).then(result => {
            logInfo('[主进程] 断点添加成功:', result);
            event.reply('debug-output', { message: `断点已设置: ${breakpoint.file}:${breakpoint.line}`, type: 'info' });
            event.reply('debug-breakpoint-set', {
                file: breakpoint.file,
                line: breakpoint.line,
                success: true
            });
        }).catch(error => {
            logError('[主进程] 断点添加失败:', error);
            event.reply('debug-error', error.message);
            event.reply('debug-breakpoint-set', {
                file: breakpoint.file,
                line: breakpoint.line,
                success: false,
                error: error.message
            });
        });
    });

    ipcMain.on('debug-remove-breakpoint', (event, breakpoint) => {
        logInfo('[主进程] 收到移除断点请求:', breakpoint);
        removeBreakpoint(breakpoint).then(result => {
            logInfo('[主进程] 断点移除成功:', result);
            event.reply('debug-output', { message: `断点已移除: ${breakpoint.file}:${breakpoint.line}`, type: 'info' });
            event.reply('debug-breakpoint-removed', {
                file: breakpoint.file,
                line: breakpoint.line,
                success: true
            });
        }).catch(error => {
            logError('[主进程] 断点移除失败:', error);
            event.reply('debug-error', error.message);
            event.reply('debug-breakpoint-removed', {
                file: breakpoint.file,
                line: breakpoint.line,
                success: false,
                error: error.message
            });
        });
    });

    ipcMain.on('debug-request-variables', (event) => {
        getDebugVariables().then(variables => {
            event.reply('debug-variables-updated', variables);
        }).catch(error => {
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('debug-request-callstack', (event) => {
        getDebugCallStack().then(callStack => {
            event.reply('debug-callstack-updated', callStack);
        }).catch(error => {
            event.reply('debug-error', error.message);
        });
    });

    ipcMain.on('debug-goto-frame', (event, frame) => {
        if (mainWindow) {
            mainWindow.webContents.send('goto-source-location', frame);
        }
    });

    ipcMain.on('debug-add-watch', (event, variableName) => {
        const expr = String(variableName || '').trim();
        if (!expr) {
            event.reply?.('debug-error', '监视表达式不能为空');
            return;
        }

        try { pendingWatchExprs.add(expr); } catch (_) { }

        if (gdbDebugger && gdbDebugger.isRunning) {
            gdbDebugger.addWatchVariable(expr).then(() => {
                event.reply('debug-output', { message: `已添加监视变量: ${expr}`, type: 'info' });
                try {
                    gdbDebugger.updateVariables().then(() => {
                        const vars = gdbDebugger.getVariables();
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('debug-variables-updated', {
                                local: vars.local || {},
                                global: vars.global || {},
                                watches: vars.watches || {}
                            });
                        } else {
                            event.reply('debug-variables-updated', {
                                local: vars.local || {},
                                global: vars.global || {},
                                watches: vars.watches || {}
                            });
                        }
                    }).catch(() => { });
                } catch (_) { }
            }).catch(error => {
                try { pendingWatchExprs.delete(expr); } catch (_) { }
                event.reply('debug-error', error.message);
            });
        } else {
            broadcastPendingWatchSnapshot(event);
            event.reply('debug-output', { message: `已添加监视待处理: ${expr}`, type: 'info' });
        }
    });

    ipcMain.on('debug-remove-watch', (event, variableName) => {
        const expr = String(variableName || '').trim();
        if (!expr) return;

        const removeFromCache = () => { try { pendingWatchExprs.delete(expr); } catch (_) { } };

        if (gdbDebugger && gdbDebugger.isRunning) {
            gdbDebugger.removeWatchVariable(expr).then(() => {
                removeFromCache();
                event.reply('debug-output', { message: `已移除监视变量: ${expr}`, type: 'info' });
                try {
                    gdbDebugger.updateVariables().then(() => {
                        const vars = gdbDebugger.getVariables();
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('debug-variables-updated', {
                                local: vars.local || {},
                                global: vars.global || {},
                                watches: vars.watches || {}
                            });
                        } else {
                            event.reply('debug-variables-updated', {
                                local: vars.local || {},
                                global: vars.global || {},
                                watches: vars.watches || {}
                            });
                        }
                    }).catch(() => { });
                } catch (_) { }
            }).catch(error => {
                event.reply('debug-error', error.message);
            });
        } else {
            removeFromCache();
            broadcastPendingWatchSnapshot(event);
            event.reply('debug-output', { message: `已移除监视待处理: ${expr}`, type: 'info' });
        }
    });

    ipcMain.on('debug-refresh-variables', (event) => {
        if (gdbDebugger && gdbDebugger.isRunning) {
            gdbDebugger.updateVariables().then(result => {
                const variables = gdbDebugger.getVariables();
                const payload = {
                    local: variables.local || {},
                    global: variables.global || {},
                    watches: variables.watches || {}
                };
                event.reply('debug-variables-updated', payload);
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('debug-variables-updated', payload);
                }
            }).catch(error => {
                event.reply('debug-error', error.message);
            });
        } else {
            event.reply('debug-error', '调试器未运行');
        }
    });

    ipcMain.on('debug-expand-variable', (event, variableName, options = {}) => {
        if (gdbDebugger && gdbDebugger.isRunning) {
            gdbDebugger.expandVariable(variableName, options).then((result) => {
                event.reply('debug-output', { message: `已展开变量: ${variableName}`, type: 'info' });
                broadcastCurrentVariablesSnapshot(event);
                const payload = {
                    name: variableName,
                    scope: result?.scope || (gdbDebugger.getVariables()?.watches?.[variableName] ? 'watch' : 'local'),
                    path: Array.isArray(result?.path) ? result.path : (Array.isArray(options.path) ? options.path : []),
                    cacheKey: result?.cacheKey || options.cacheKey || null,
                    options,
                    data: result?.data || null
                };
                try { event.reply('debug-variable-expanded', payload); } catch (_) { }
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents !== event.sender) {
                    try { mainWindow.webContents.send('debug-variable-expanded', payload); } catch (_) { }
                }
            }).catch(error => {
                event.reply('debug-error', error.message);
            });
        } else {
            event.reply('debug-error', '调试器未运行');
        }
    });

    ipcMain.on('debug-load-more-variable', (event, variableName, options = {}) => {
        if (gdbDebugger && gdbDebugger.isRunning) {
            const nextOptions = { ...options, append: true };
            gdbDebugger.expandVariable(variableName, nextOptions).then((result) => {
                event.reply('debug-output', { message: `已加载更多: ${variableName}`, type: 'info' });
                broadcastCurrentVariablesSnapshot(event);
                const payload = {
                    name: variableName,
                    scope: result?.scope || (gdbDebugger.getVariables()?.watches?.[variableName] ? 'watch' : 'local'),
                    path: Array.isArray(result?.path) ? result.path : (Array.isArray(nextOptions.path) ? nextOptions.path : []),
                    cacheKey: result?.cacheKey || nextOptions.cacheKey || null,
                    options: nextOptions,
                    append: true,
                    data: result?.data || null
                };
                try { event.reply('debug-variable-expanded', payload); } catch (_) { }
                if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents !== event.sender) {
                    try { mainWindow.webContents.send('debug-variable-expanded', payload); } catch (_) { }
                }
            }).catch(error => {
                event.reply('debug-error', error.message);
            });
        } else {
            event.reply('debug-error', '调试器未运行');
        }
    });

    ipcMain.on('debug-collapse-variable', (event, variableName, options = {}) => {
        if (gdbDebugger && gdbDebugger.isRunning) {
            gdbDebugger.collapseVariable(variableName, options).then(result => {
                event.reply('debug-output', { message: `已折叠变量: ${variableName}`, type: 'info' });
                broadcastCurrentVariablesSnapshot(event);
            }).catch(error => {
                event.reply('debug-error', error.message);
            });
        } else {
            event.reply('debug-error', '调试器未运行');
        }
    });

    ipcMain.handle('get-current-file', () => {
        return currentOpenFile;
    });

    ipcMain.handle('get-breakpoints', () => {
        return Array.from(breakpoints.entries());
    });

    ipcMain.on('open-file-dialog', () => {
        openFile();
    });

    ipcMain.on('open-folder-dialog', () => {
        openFolder();
    });

    ipcMain.on('save-file', (event, filePath, content) => {
        try {
            if (!filePath || typeof filePath !== 'string') {
                throw new Error('无效的文件路径');
            }
            if (/^cloud:/i.test(filePath)) {
                throw new Error('云端文件不支持本地保存');
            }
            markLocalSave(filePath);
            fs.writeFileSync(filePath, content ?? '', 'utf8');
            logInfo('文件保存成功(事件):', filePath);
            try { event.reply('file-saved', filePath, null); } catch (_) { }
            try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file-saved', filePath); } catch (_) { }
        } catch (error) {
            logError('保存文件失败(事件):', error);
            try { event.reply('file-saved', filePath || '', error?.message || String(error)); } catch (_) { }
        }
    });

    ipcMain.on('save-file-as', (event, content) => {
        saveAsFile();
    });

    const tempDir = path.join(os.homedir(), '.oicpp', 'codeTemp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    ipcMain.handle('save-temp-file', async (event, filePath, content) => {
        try {
            const tempPath = path.join(os.homedir(), '.oicpp', 'codeTemp', filePath);
            const tempDir = path.dirname(tempPath);

            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            fs.writeFileSync(tempPath, content, 'utf8');
            logInfo('临时文件保存成功:', tempPath);
            return tempPath; // 返回完整的文件路径
        } catch (error) {
            logError('保存临时文件失败:', error);
            throw error;
        }
    });

    ipcMain.handle('save-binary-temp-file', async (_event, fileName, base64Data) => {
        try {
            if (!base64Data || typeof base64Data !== 'string') {
                throw new Error('缺少文件数据');
            }
            const tempDirPath = path.join(os.homedir(), '.oicpp', 'codeTemp');
            if (!fs.existsSync(tempDirPath)) {
                fs.mkdirSync(tempDirPath, { recursive: true });
            }
            const safeName = fileName ? path.basename(fileName) : `temp-${Date.now()}.bin`;
            let targetPath = path.join(tempDirPath, safeName);
            if (fs.existsSync(targetPath)) {
                targetPath = getUniquePath(tempDirPath, safeName);
            }
            const buffer = Buffer.from(base64Data, 'base64');
            fs.writeFileSync(targetPath, buffer);
            logInfo('二进制临时文件保存成功:', targetPath);
            return targetPath;
        } catch (error) {
            logError('保存二进制临时文件失败:', error);
            throw error;
        }
    });

    ipcMain.handle('load-temp-file', async (event, filePath) => {
        try {
            const tempPath = path.join(os.homedir(), filePath);
            if (fs.existsSync(tempPath)) {
                const content = fs.readFileSync(tempPath, 'utf8');
                logInfo('临时文件加载成功:', tempPath);
                return content;
            } else {
                logInfo('临时文件不存在:', tempPath);
                return null;
            }
        } catch (error) {
            logError('加载临时文件失败:', error);
            throw error;
        }
    });

    ipcMain.handle('delete-temp-file', async (event, filePath) => {
        try {
            let tempPath;
            if (path.isAbsolute(filePath)) {
                tempPath = filePath;
            } else {
                tempPath = path.join(os.homedir(), '.oicpp', 'codeTemp', filePath);
            }

            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            } else {
                logInfo('临时文件不存在，无需删除:', tempPath);
            }
            return true;
        } catch (error) {
            logError('删除临时文件失败:', error);
            throw error;
        }
    });

    ipcMain.handle('save-file', async (event, filePath, content) => {
        try {
            if (!filePath || typeof filePath !== 'string') {
                throw new Error('无效的文件路径');
            }
            if (/^cloud:/i.test(filePath)) {
                throw new Error('云端文件不支持本地保存');
            }
            markLocalSave(filePath);
            fs.writeFileSync(filePath, content ?? '', 'utf8');
            logInfo('文件保存成功:', filePath);
            try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file-saved', filePath); } catch (_) { }
            return true;
        } catch (error) {
            logError('保存文件失败:', error);
            throw error;
        }
    });

    ipcMain.handle('save-as-file', async (event, content) => {
        try {
            const result = await dialog.showSaveDialog(mainWindow, {
                title: '另存为',
                defaultPath: 'untitled.cpp',
                filters: [
                    { name: 'C++ Files', extensions: ['cpp', 'cc', 'cxx', 'c++'] },
                    { name: 'C Files', extensions: ['c'] },
                    { name: 'Header Files', extensions: ['h', 'hpp', 'hxx'] },
                    { name: 'All Files', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePath) {
                markLocalSave(result.filePath);
                fs.writeFileSync(result.filePath, content ?? '', 'utf8');
                logInfo('文件另存为成功:', result.filePath);
                try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file-saved', result.filePath); } catch (_) { }
                return result.filePath;
            }
            return null;
        } catch (error) {
            logError('另存为文件失败:', error);
            throw error;
        }
    });

    ipcMain.on('read-directory', async (event, dirPath) => {
        try {
            const items = await readDirectory(dirPath);
            event.reply('directory-read', dirPath, items);
        } catch (error) {
            logError('读取目录失败 (event):', error);
            event.reply('directory-read-error', dirPath, error.message);
        }
    });
    ipcMain.handle('read-directory', async (event, dirPath) => {
        try {
            return await readDirectory(dirPath);
        } catch (error) {
            logError('读取目录失败 (invoke):', error);
            throw error;
        }
    });

    ipcMain.handle('read-file-content', async (event, filePath) => {
        try {
            const content = await readFileContent(filePath);
            return content;
        } catch (error) {
            logError('读取文件失败:', error);
            throw error;
        }
    });

    ipcMain.handle('watch-file', async (event, filePath) => {
        const normalized = normalizeWatchKey(filePath);
        if (!normalized) {
            return { success: false, error: 'invalid-path' };
        }

        if (!fs.existsSync(normalized.resolved)) {
            return { success: false, error: 'not-found' };
        }

        let entry = fileWatchRegistry.get(normalized.key);
        if (!entry) {
            try {
                const watcher = fs.watch(normalized.resolved, { persistent: false }, (eventType) => {
                    try {
                        handleWatcherEvent(normalized.key, eventType);
                    } catch (error) {
                        try { logger.logwarn('[FileWatch] 事件处理失败', { filePath: normalized.resolved, error: error?.message || String(error) }); } catch (_) { }
                    }
                });
                watcher.on('error', (error) => {
                    try { logger.logwarn('[FileWatch] 监听出错', { filePath: normalized.resolved, error: error?.message || String(error) }); } catch (_) { }
                });
                entry = {
                    key: normalized.key,
                    resolvedPath: normalized.resolved,
                    watcher,
                    subscribers: new Map(),
                    lastLocalSave: 0,
                    lastEventSignature: null,
                    lastObservedMtime: null
                };
                fileWatchRegistry.set(normalized.key, entry);
            } catch (error) {
                try { logger.logwarn('[FileWatch] 创建监听失败', { filePath: normalized.resolved, error: error?.message || String(error) }); } catch (_) { }
                return { success: false, error: error?.message || String(error) };
            }
        } else {
            entry.resolvedPath = normalized.resolved;
        }

        const contentsId = event.sender.id;
        const info = entry.subscribers.get(contentsId) || { count: 0 };
        info.count += 1;
        entry.subscribers.set(contentsId, info);

        return { success: true };
    });

    ipcMain.handle('unwatch-file', async (event, filePath) => {
        const normalized = normalizeWatchKey(filePath);
        if (!normalized) {
            return { success: false, error: 'invalid-path' };
        }

        const entry = fileWatchRegistry.get(normalized.key);
        if (!entry) {
            return { success: true };
        }

        const contentsId = event.sender.id;
        if (entry.subscribers.has(contentsId)) {
            const info = entry.subscribers.get(contentsId);
            if (info && info.count > 1) {
                info.count -= 1;
                entry.subscribers.set(contentsId, info);
            } else {
                entry.subscribers.delete(contentsId);
            }
        }

        if (getSubscriberCount(entry) === 0) {
            disposeWatcher(entry, normalized.key);
        }

        return { success: true };
    });

    ipcMain.handle('read-file-buffer', async (_event, filePath) => {
        try {
            const normalizedPath = normalizeDroppedPath(filePath);
            if (!normalizedPath) {
                throw new Error('缺少文件路径');
            }
            if (!fs.existsSync(normalizedPath)) {
                throw new Error('文件不存在');
            }
            const buffer = fs.readFileSync(normalizedPath);
            return buffer.toString('base64');
        } catch (error) {
            logError('读取二进制文件失败:', error);
            throw error;
        }
    });

    ipcMain.handle('walk-directory', async (event, dirPath, options = {}) => {
        const {
            includeExts = ['.cpp', '.c', '.h', '.hpp', '.cc', '.cxx', '.txt', '.md', '.json', '.in', '.out', '.ans'],
            excludeGlobs = ['node_modules', '.git', '.oicpp', '.vscode', '.dsym'],
            maxFiles = 5000
        } = options || {};

        const results = [];
        try {
            const shouldExclude = (name) => {
                const lower = name.toLowerCase();
                if (lower.endsWith('.dsym')) return true; // 强制忽略 *.dSYM 目录
                return excludeGlobs.some(g => lower.includes(g.toLowerCase()));
            };
            const walk = (p) => {
                if (results.length >= maxFiles) return;
                let entries = [];
                try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
                for (const entry of entries) {
                    if (results.length >= maxFiles) break;
                    const full = path.join(p, entry.name);
                    if (entry.name.startsWith('.') || shouldExclude(full)) continue;
                    try {
                        if (entry.isDirectory()) {
                            walk(full);
                        } else if (entry.isFile()) {
                            const ext = path.extname(entry.name).toLowerCase();
                            if (includeExts.length === 0 || includeExts.includes(ext) || !ext) {
                                results.push({ name: entry.name, path: full, ext });
                            }
                        }
                    } catch (_) { }
                }
            };
            walk(dirPath);
            return { success: true, files: results };
        } catch (error) {
            try { logError('[walk-directory] 失败:', error); } catch (_) { }
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('rename-file', async (event, oldPath, newName) => {
        try {
            // Validate the new file name
            const validation = validateFileName(newName);
            if (!validation.valid) {
                event.reply('file-renamed', oldPath, null, validation.error);
                logWarn('文件重命名失败 - 非法名称:', newName, '-', validation.error);
                return;
            }

            const dir = path.dirname(oldPath);
            let newPath = path.join(dir, newName);
            if (fs.existsSync(newPath)) {
                newPath = getUniquePath(dir, newName);
            }

            fs.renameSync(oldPath, newPath);
            event.reply('file-renamed', oldPath, newPath, null);
            logInfo('文件重命名成功:', oldPath, '->', newPath);
        } catch (error) {
            logError('重命名文件失败:', error);
            event.reply('file-renamed', oldPath, null, error.message);
        }
    });

    ipcMain.on('delete-file', async (event, filePath) => {
        try {
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                fs.rmSync(filePath, { recursive: true, force: true });
            } else {
                fs.unlinkSync(filePath);
            }
            event.reply('file-deleted', filePath, null);
        } catch (error) {
            logError('删除文件失败:', error);
            event.reply('file-deleted', filePath, error.message);
        }
    });

    ipcMain.on('create-file', async (event, filePath, content = '') => {
        try {
            // Validate the file name
            const fileName = path.basename(filePath);
            const validation = validateFileName(fileName);
            if (!validation.valid) {
                event.reply('file-created', filePath, validation.error);
                logWarn('文件创建失败 - 非法名称:', fileName, '-', validation.error);
                return;
            }

            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            if (fs.existsSync(filePath)) {
                const base = path.basename(filePath);
                const parent = path.dirname(filePath);
                filePath = getUniquePath(parent, base);
            }

            markLocalSave(filePath);
            fs.writeFileSync(filePath, content, 'utf8');
            event.reply('file-created', filePath, null);
            logInfo('文件创建成功:', filePath);
        } catch (error) {
            logError('创建文件失败:', error);
            event.reply('file-created', filePath, error.message);
        }
    });

    ipcMain.handle('create-file', async (_event, filePath, content = '') => {
        try {
            if (!filePath || typeof filePath !== 'string') throw new Error('无效文件路径');
            
            // Validate the file name
            const fileName = path.basename(filePath);
            const validation = validateFileName(fileName);
            if (!validation.valid) {
                logWarn('文件创建失败(invoke) - 非法名称:', fileName, '-', validation.error);
                return { success: false, error: validation.error };
            }

            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            let finalPath = filePath;
            if (fs.existsSync(finalPath)) {
                finalPath = getUniquePath(path.dirname(finalPath), path.basename(finalPath));
            }
            markLocalSave(finalPath);
            fs.writeFileSync(finalPath, content, 'utf8');
            try { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('file-created', finalPath, null); } catch (_) { }
            logInfo('文件创建成功(invoke):', finalPath);
            return { success: true, filePath: finalPath };
        } catch (error) {
            logError('创建文件失败(invoke):', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.on('create-folder', async (event, folderPath) => {
        try {
            // Validate the folder name
            const folderName = path.basename(folderPath);
            const validation = validateFileName(folderName);
            if (!validation.valid) {
                event.reply('folder-created', folderPath, validation.error);
                logWarn('文件夹创建失败 - 非法名称:', folderName, '-', validation.error);
                return;
            }

            if (fs.existsSync(folderPath)) {
                const base = path.basename(folderPath);
                const parent = path.dirname(folderPath);
                folderPath = getUniquePath(parent, base);
            }

            fs.mkdirSync(folderPath, { recursive: true });
            event.reply('folder-created', folderPath, null);
            logInfo('文件夹创建成功:', folderPath);
        } catch (error) {
            logError('创建文件夹失败:', error);
            event.reply('folder-created', folderPath, error.message);
        }
    });

    ipcMain.on('paste-file', async (event, sourcePath, targetDir, operation) => {
        try {
            const fileName = path.basename(sourcePath);
            let targetPath = path.join(targetDir, fileName);

            if (fs.existsSync(targetPath)) {
                targetPath = getUniquePath(targetDir, fileName);
            }

            if (operation === 'copy') {
                const stat = fs.statSync(sourcePath);
                if (stat.isDirectory()) {
                    copyDirectorySync(sourcePath, targetPath);
                } else {
                    fs.copyFileSync(sourcePath, targetPath);
                }
            } else if (operation === 'cut') {
                fs.renameSync(sourcePath, targetPath);
            }

            event.reply('file-pasted', sourcePath, targetPath, operation, null);
            logInfo(`文件${operation === 'copy' ? '复制' : '移动'}成功:`, sourcePath, '->', targetPath);
        } catch (error) {
            logError(`${operation === 'copy' ? '复制' : '移动'}文件失败:`, error);
            event.reply('file-pasted', sourcePath, null, operation, error.message);
        }
    });


    ipcMain.on('move-file', async (event, sourcePath, targetPath) => {
        try {
            if (!fs.existsSync(sourcePath)) {
                throw new Error('源文件不存在');
            }

            const targetDir = path.dirname(targetPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            fs.renameSync(sourcePath, targetPath);

            event.reply('file-moved', sourcePath, targetPath);
            logInfo('文件移动成功:', sourcePath, '->', targetPath);
        } catch (error) {
            logError('移动文件失败:', error);
            event.reply('file-move-error', sourcePath, error.message);
        }
    });


    ipcMain.handle('export-settings', async () => {
        try {
            const result = await dialog.showSaveDialog(mainWindow, {
                title: '导出设置',
                defaultPath: 'oicpp-settings.json',
                filters: [
                    { name: 'JSON文件', extensions: ['json'] },
                    { name: '所有文件', extensions: ['*'] }
                ]
            });

            if (!result.canceled && result.filePath) {
                fs.writeFileSync(result.filePath, JSON.stringify(settings, null, 2), 'utf8');
                return { success: true, filePath: result.filePath };
            }

            return { success: false, message: '用户取消操作' };
        } catch (error) {
            logError('导出设置失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('import-settings', async () => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                title: '导入设置',
                filters: [
                    { name: 'JSON文件', extensions: ['json'] },
                    { name: '所有文件', extensions: ['*'] }
                ],
                properties: ['openFile']
            });

            if (!result.canceled && result.filePaths.length > 0) {
                const filePath = result.filePaths[0];
                const importedSettings = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                const defaultSettings = getDefaultSettings();
                settings = mergeSettings(defaultSettings, importedSettings);

                saveSettings();

                if (mainWindow) {
                    mainWindow.webContents.send('settings-imported', settings);
                }

                return { success: true, settings };
            }

            return { success: false, message: '用户取消操作' };
        } catch (error) {
            logError('导入设置失败:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('relaunch-app', () => {
        app.relaunch();
        app.exit();
    });

    ipcMain.handle('compile-file', async (event, options) => {
        try {
            const result = await compileFile(options);
            return result;
        } catch (error) {
            throw error;
        }
    });

    ipcMain.handle('run-executable', async (event, options) => {
        try {
            await runExecutable(options);
            return { success: true };
        } catch (error) {
            throw error;
        }
    });

    ipcMain.handle('run-program', async (event, executablePathOrOptions, input, timeLimit) => {
        const { spawn } = require('child_process');

        let executablePath, args = [], workingDirectory = null;
        let skipPreKill = false;
        if (typeof executablePathOrOptions === 'object' && executablePathOrOptions && executablePathOrOptions.executablePath) {
            executablePath = executablePathOrOptions.executablePath;
            args = executablePathOrOptions.args || [];
            workingDirectory = executablePathOrOptions.workingDirectory;
            skipPreKill = !!executablePathOrOptions.skipPreKill;
        } else {
            executablePath = executablePathOrOptions;
        }

        const compilerPath = settings.compilerPath || '';
        let runtimeEnv = { ...process.env };

        if (compilerPath && fs.existsSync(compilerPath)) {
            const compilerDir = path.dirname(compilerPath);
            const compilerRoot = path.dirname(compilerDir);

            let mingwBinPaths = [
                compilerDir,
                path.join(compilerRoot, 'bin'),
                path.join(compilerRoot, 'mingw64', 'bin'),
                path.join(compilerRoot, 'mingw32', 'bin')
            ];

            mingwBinPaths = mingwBinPaths.filter(p => fs.existsSync(p));

            if (mingwBinPaths.length > 0) {
                const envPath = [...mingwBinPaths, process.env.PATH].join(path.delimiter);
                runtimeEnv.PATH = envPath;
                logInfo('[运行时环境] 已添加编译器路径到PATH，路径数量:', mingwBinPaths.length);
            }
        }

        function decodeBufferAuto(buffer) {
            if (!buffer || buffer.length === 0) return '';
            try {
                const encoding = detectEncoding(buffer);
                if (encoding === 'utf8') return buffer.toString('utf8');
            } catch (_) { }
            try {
                const iconv = require('iconv-lite');
                return iconv.decode(buffer, 'gbk');
            } catch (_) {
                return buffer.toString('utf8');
            }
        }

        try {
            if (!skipPreKill && process.platform === 'win32') {
                const target = typeof executablePath === 'string' ? executablePath : '';
                if (target) {
                    await killByExePathWindows(require('path').resolve(target));
                    await killConsolePauserForTargetWindows(require('path').resolve(target));
                }
            }
        } catch (_) { }

        try {
            logInfo('[运行程序][准备]', {
                exec: typeof executablePath === 'string' ? executablePath : String(executablePath),
                args,
                cwd: workingDirectory || null,
                timeLimitMs: Number(timeLimit) || 0,
                inputBytes: input ? Buffer.byteLength(input, 'utf8') : 0
            });
        } catch (_) { }

        return new Promise((resolve) => {
            let childProcess;

            if (executablePath.startsWith('cmd /c ')) {
                const actualCommand = executablePath.substring(7); // 去掉"cmd /c "
                childProcess = spawn('cmd', ['/c', actualCommand], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: runtimeEnv,
                    shell: true,
                    cwd: workingDirectory
                });
            } else if (Array.isArray(args) && args.length > 0) {
                childProcess = spawn(executablePath, args, {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: runtimeEnv,
                    shell: false, // SPJ不需要shell
                    cwd: workingDirectory
                });
            } else {
                const absoluteExePath = path.resolve(executablePath);
                childProcess = spawn(absoluteExePath, [], {
                    stdio: ['pipe', 'pipe', 'pipe'],
                    env: runtimeEnv,
                    cwd: workingDirectory
                });
            }

            const stdoutChunks = [];
            const stderrChunks = [];
            const OUTPUT_LIMIT_BYTES = 256 * 1024 * 1024;
            const limitLabel = `${Math.floor(OUTPUT_LIMIT_BYTES / (1024 * 1024))} MB`;
            let combinedOutputBytes = 0;
            let observedOutputBytes = 0;
            let outputLimitExceeded = false;
            let outputLimitTriggered = false;
            let timeout = false;
            let startTime = null;

            let effectiveTimeLimit = Number(timeLimit);
            const useTimeouts = Number.isFinite(effectiveTimeLimit) && effectiveTimeLimit > 0;
            if (!useTimeouts) {
                effectiveTimeLimit = 0;
            }

            const tleTimer = useTimeouts ? setTimeout(() => {
                timeout = true;
                try { logWarn('[运行程序][超时触发]', { limitMs: effectiveTimeLimit }); } catch (_) { }
            }, effectiveTimeLimit) : null;

            const killTimer = useTimeouts ? setTimeout(() => {
                try {
                    if (childProcess && !childProcess.killed) {
                        childProcess.kill('SIGKILL');
                    }
                } catch (e) {
                    logError('[主进程-程序调试] 尝试终止进程时出错:', e.message);
                }
            }, Math.floor(effectiveTimeLimit * 1.1)) : null; // 110%时杀进程

            const handleOutputLimit = (streamName) => {
                if (outputLimitTriggered) {
                    return;
                }
                outputLimitTriggered = true;
                timeout = false;
                if (tleTimer) {
                    clearTimeout(tleTimer);
                }
                if (killTimer) {
                    clearTimeout(killTimer);
                }
                try {
                    logWarn('[运行程序][OLE触发]', { limitBytes: OUTPUT_LIMIT_BYTES, stream: streamName });
                } catch (_) { }
                try {
                    if (childProcess && !childProcess.killed) {
                        childProcess.kill('SIGKILL');
                    }
                } catch (e) {
                    logError('[主进程-程序调试] 终止进程(输出限制)出错:', e?.message || String(e));
                }
            };

            const pushChunkWithLimit = (chunk, target, streamName) => {
                if (chunk == null) {
                    return;
                }
                const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                observedOutputBytes += buffer.length;
                if (outputLimitExceeded) {
                    return;
                }
                const available = OUTPUT_LIMIT_BYTES - combinedOutputBytes;
                if (available <= 0) {
                    outputLimitExceeded = true;
                    handleOutputLimit(streamName);
                    return;
                }
                if (buffer.length <= available) {
                    target.push(buffer);
                    combinedOutputBytes += buffer.length;
                    return;
                }
                if (available > 0) {
                    target.push(buffer.slice(0, available));
                    combinedOutputBytes += available;
                }
                outputLimitExceeded = true;
                handleOutputLimit(streamName);
            };

            childProcess.on('spawn', () => {
                startTime = performance.now();
                try { logInfo('[运行程序][启动] 子进程已启动'); } catch (_) { }
            });

            childProcess.stdout.on('data', (data) => {
                pushChunkWithLimit(data, stdoutChunks, 'stdout');
            });

            childProcess.stderr.on('data', (data) => {
                pushChunkWithLimit(data, stderrChunks, 'stderr');
            });

            childProcess.on('close', (code) => {
                if (tleTimer) clearTimeout(tleTimer);
                if (killTimer) clearTimeout(killTimer);

                const endTime = performance.now();

                let executionTime = 0;
                if (startTime !== null) {
                    executionTime = Math.round(endTime - startTime);
                } else if (useTimeouts && timeout) {
                    executionTime = effectiveTimeLimit;
                }
                const stdoutBuf = Buffer.concat(stdoutChunks);
                const stderrBuf = Buffer.concat(stderrChunks);
                const output = decodeBufferAuto(stdoutBuf);
                const errorOutput = decodeBufferAuto(stderrBuf);

                let finalOutput = '';
                if (code !== 0 && code !== null) {
                    finalOutput = errorOutput || output || `程序异常退出，退出码: ${code}`;
                } else if (code === null) {
                    finalOutput = errorOutput || output || '程序被强制终止或异常退出';
                } else {
                    finalOutput = output;
                }

                if (outputLimitExceeded) {
                    const notice = `输出超过限制 (${limitLabel})，程序已被终止。`;
                    if (finalOutput) {
                        finalOutput = finalOutput.endsWith('\n') ? `${finalOutput}${notice}` : `${finalOutput}\n${notice}`;
                    } else {
                        finalOutput = notice;
                    }
                }

                const effectiveExitCode = outputLimitExceeded ? (code ?? -3) : code;
                const measuredTime = useTimeouts ? Math.max(0, Math.min(executionTime, effectiveTimeLimit + 100)) : Math.max(0, executionTime);
                const timedOut = outputLimitExceeded ? false : (useTimeouts ? timeout : false);

                const result = {
                    output: finalOutput,
                    time: measuredTime,
                    timeout: timedOut,
                    exitCode: effectiveExitCode,
                    stdout: output,
                    stderr: errorOutput,
                    outputLimitExceeded,
                    outputLimitBytes: OUTPUT_LIMIT_BYTES,
                    capturedOutputBytes: combinedOutputBytes,
                    observedOutputBytes
                };

                try {
                    const sizes = {
                        stdoutBytes: Buffer.byteLength(output || '', 'utf8'),
                        stderrBytes: Buffer.byteLength(errorOutput || '', 'utf8'),
                        capturedBytes: combinedOutputBytes,
                        observedBytes: observedOutputBytes
                    };
                    if (outputLimitExceeded) {
                        logWarn('[运行程序][结束][OLE]', { durationMs: result.time, limitBytes: OUTPUT_LIMIT_BYTES, exitCode: effectiveExitCode, ...sizes });
                    } else if (result.timeout) {
                        logWarn('[运行程序][结束][TLE]', { durationMs: result.time, limitMs: effectiveTimeLimit, exitCode: effectiveExitCode, ...sizes });
                    } else if (effectiveExitCode !== 0) {
                        logWarn('[运行程序][结束][RE]', { durationMs: result.time, exitCode: effectiveExitCode, ...sizes });
                    } else {
                        logInfo('[运行程序][结束][OK]', { durationMs: result.time, ...sizes });
                    }
                } catch (_) { }

                resolve(result);
            });

            childProcess.on('error', (error) => {
                if (tleTimer) clearTimeout(tleTimer);
                if (killTimer) clearTimeout(killTimer);

                const errorResult = {
                    output: error.message,
                    time: 0,
                    timeout: false,
                    exitCode: -1,
                    stdout: '',
                    stderr: error.message,
                    outputLimitExceeded: false,
                    outputLimitBytes: OUTPUT_LIMIT_BYTES,
                    capturedOutputBytes: combinedOutputBytes,
                    observedOutputBytes
                };
                try { logError('[运行程序][异常]', error?.message || String(error)); } catch (_) { }

                resolve(errorResult);
            });

            if (input && !(Array.isArray(args) && args.length > 0)) {
                childProcess.stdin.write(input);
            }
            childProcess.stdin.end();
        });
    });

    ipcMain.handle('check-file-exists', async (event, filePath) => {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
            return true;
        } catch (error) {
            logInfo(`[主进程] 文件不存在: ${filePath}, 错误: ${error.message}`);
            try {
                const exists = fs.existsSync(filePath);
                return exists;
            } catch (syncError) {
                logInfo(`[主进程] 同步检查也失败: ${syncError.message}`);
                return false;
            }
        }
    });

    ipcMain.handle('path-join', async (event, ...paths) => {
        return path.join(...paths);
    });

    ipcMain.handle('path-dirname', async (event, filePath) => {
        return path.dirname(filePath);
    });

    ipcMain.handle('get-home-dir', async (event) => {
        return os.homedir();
    });

    ipcMain.handle('ensure-dir', async (event, dirPath) => {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            return true;
        } catch (error) {
            throw error;
        }
    });

    ipcMain.handle('write-file', async (event, filePath, content) => {
        try {
            markLocalSave(filePath);
            await fs.promises.writeFile(filePath, content, 'utf8');
            return { success: true };
        } catch (error) {
            logError(`[主进程] 写入文件失败: ${filePath}`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('delete-file', async (event, filePath) => {
        try {
            await fs.promises.unlink(filePath);
            return { success: true };
        } catch (error) {
            logError(`[主进程] 删除文件失败: ${filePath}`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-path-info', async (event, filePath) => {
        try {
            return {
                dirname: path.dirname(filePath),
                basename: path.basename(filePath),
                extname: path.extname(filePath),
                basenameWithoutExt: path.basename(filePath, path.extname(filePath))
            };
        } catch (error) {
            throw error;
        }
    });

    ipcMain.handle('ensure-directory', async (event, dirPath) => {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
            }
            return true;
        } catch (error) {
            throw error;
        }
    });

    ipcMain.handle('open-compiler-settings', async (event) => {
        openCompilerSettings();
        return { success: true };
    });

    ipcMain.handle('open-editor-settings', async (event) => {
        openEditorSettings();
        return { success: true };
    });

    ipcMain.on('open-template-settings', () => {
        openCodeTemplates();
    });

    ipcMain.on('check-updates-manual', () => {
        logInfo('[IPC] 收到渲染进程的手动检查更新请求');
        checkForUpdates(true); // true 表示手动检查
    });

    ipcMain.handle('check-gdb-availability', async () => {
        return checkGDBAvailability();
    });

    ipcMain.handle('get-platform', async () => {
        return process.platform === 'win32' ? 'windows' : 'linux';
    });

    ipcMain.handle('get-user-home', async () => {
        return os.homedir();
    });

    ipcMain.handle('get-downloaded-compilers', async () => {
        logInfo('[获取已下载编译器] 开始获取已下载编译器列表');
        try {
            const userHome = os.homedir();
            const compilersDir = path.join(userHome, '.oicpp', 'Compilers');
            logInfo('[获取已下载编译器] 编译器目录:', compilersDir);

            if (!fs.existsSync(compilersDir)) {
                logInfo('[获取已下载编译器] 编译器目录不存在，返回空列表');
                return [];
            }

            const versions = fs.readdirSync(compilersDir).filter(item => {
                const itemPath = path.join(compilersDir, item);
                return fs.statSync(itemPath).isDirectory();
            });

            logInfo('[获取已下载编译器] 找到的版本:', versions);
            return versions;
        } catch (error) {
            logError('[获取已下载编译器] 获取已下载编译器失败:', error);
            return [];
        }
    });

    ipcMain.handle('download-compiler', async (event, { url, version, name }) => {
        if (process.platform !== 'win32') {
            return { success: false, error: '非 Windows 平台已禁用内置编译器下载，请访问官网获取: https://oicpp.mywwzh.top/' };
        }
        logInfo('[编译器下载] 开始下载请求:', { version, name });

        if (!url || !version || !name) {
            logError('[编译器下载] 缺少必要参数:', { url, version, name });
            return { success: false, error: '缺少必要的下载参数' };
        }

        return new Promise(async (resolve) => {
            const userHome = os.homedir();
            const compilersDir = path.join(userHome, '.oicpp', 'Compilers');
            const versionDir = path.join(compilersDir, version);

            logInfo('[编译器下载] 目录路径:', { compilersDir, versionDir });

            if (!fs.existsSync(compilersDir)) {
                fs.mkdirSync(compilersDir, { recursive: true });
                logInfo('[编译器下载] 创建编译器目录:', compilersDir);
            }

            if (fs.existsSync(versionDir)) {
                logInfo('[编译器下载] 版本目录已存在:', versionDir);
                resolve({ success: false, error: '该版本已存在' });
                return;
            }

            let backgroundDownload = false;
            let downloadCompleted = false;
            let progressWindow = null;
            let downloader = null;

            try {
                logInfo('[编译器下载] 创建进度窗口...');

                const tmpDir = path.join(os.tmpdir(), 'oicpp-compiler-download');
                if (!fs.existsSync(tmpDir)) {
                    fs.mkdirSync(tmpDir, { recursive: true });
                }

                const htmlFile = path.join(tmpDir, 'compiler-progress.html');
                const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>下载编译器</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 30px;
            background: #252526;
            color: #cccccc;
            font-size: 14px;
            line-height: 1.5;
        }
        h3 {
            color: #4fc3f7;
            margin-bottom: 30px;
            font-weight: 400;
            font-size: 18px;
        }
        #status {
            font-size: 14px;
            margin-bottom: 20px;
            color: #cccccc;
            min-height: 20px;
        }
        #progress-container {
            background: #3c3c3c;
            border-radius: 4px;
            padding: 2px;
            margin: 20px 0;
            border: 1px solid #464647;
        }
        #progress-bar {
            background: linear-gradient(90deg, #0e639c, #1177bb);
            height: 16px;
            border-radius: 2px;
            width: 0%;
            transition: width 0.2s ease;
            position: relative;
        }
        #progress-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 11px;
            font-weight: 500;
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        }
        #speed {
            font-size: 12px;
            color: #9cdcfe;
            margin-top: 10px;
            text-align: center;
        }
    </style>
</head>
<body>
    <h3>正在下载编译器: ${name} ${version}</h3>
    <div id="status">准备开始下载...</div>
    <div id="progress-container">
        <div id="progress-bar">
            <div id="progress-text">0%</div>
        </div>
    </div>
    <div id="speed"></div>
</body>
</html>`;

                fs.writeFileSync(htmlFile, htmlContent, 'utf8');
                logInfo('[编译器下载] HTML文件已创建:', htmlFile);

                progressWindow = new BrowserWindow({
                    width: 500,
                    height: 400,
                    show: false,
                    resizable: false,
                    parent: BrowserWindow.getFocusedWindow(),
                    modal: false,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true
                    }
                });

                logInfo('[编译器下载] 进度窗口已创建');

                progressWindow.on('close', (event) => {
                    logInfo('[编译器下载] 进度窗口关闭事件, downloadCompleted:', downloadCompleted);

                    if (!backgroundDownload && !downloadCompleted) {
                        event.preventDefault();

                        const choice = dialog.showMessageBoxSync(progressWindow, {
                            type: 'question',
                            title: '后台下载',
                            message: '是否在后台继续下载编译器？',
                            detail: '关闭此窗口后，下载将在后台继续进行。',
                            buttons: ['后台下载', '取消下载'],
                            defaultId: 0
                        });

                        if (choice === 0) {
                            backgroundDownload = true;
                            logInfo('[编译器下载] 用户选择后台下载编译器');
                            progressWindow.destroy();
                        } else {
                            logInfo('[编译器下载] 用户取消编译器下载');
                            if (downloader) {
                                downloader.cancel();
                            }
                            resolve({ success: false, error: '用户取消下载' });
                            progressWindow.destroy();
                            return;
                        }
                    } else {
                        try {
                            if (fs.existsSync(htmlFile)) {
                                fs.unlinkSync(htmlFile);
                                logInfo('[编译器下载] 临时HTML文件已清理');
                            }
                        } catch (error) {
                            logInfo('[编译器下载] 清理临时文件失败:', error.message);
                        }
                    }
                });

                progressWindow.loadFile(htmlFile);

                progressWindow.webContents.once('did-finish-load', () => {
                    progressWindow.show();
                    updateProgress('开始下载编译器...');
                });

                progressWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                    logError('[编译器下载] 页面加载失败:', errorCode, errorDescription);
                });

                function updateProgress(message, percent = null, speed = null) {
                    try {
                        if (!backgroundDownload && progressWindow && !progressWindow.isDestroyed()) {
                            progressWindow.webContents.executeJavaScript(`
                (function() {
                  try {
                    const statusElement = document.getElementById('status');
                    const progressBar = document.getElementById('progress-bar');
                    const progressText = document.getElementById('progress-text');
                    const speedElement = document.getElementById('speed');
                    
                    if (statusElement) {
                      statusElement.textContent = ${JSON.stringify(message)};
                    }
                    
                    if (progressBar && progressText && ${percent !== null}) {
                      const percentValue = Math.max(0, Math.min(100, Math.round(${percent})));
                      progressBar.style.width = percentValue + '%';
                      progressText.textContent = percentValue + '%';
                    }
                    
                    if (speedElement && ${speed !== null}) {
                      speedElement.textContent = ${JSON.stringify(speed)};
                    }
                    
                    return true;
                  } catch (error) {
                    return false;
                  }
                })()
              `).catch(() => {
                            });
                        }
                    } catch (error) {
                    }
                }

                updateProgress(`开始下载编译器: ${name} ${version}`);

                if (typeof url !== 'string' || !url.includes('.')) {
                    throw new Error('无效的下载URL格式');
                }

                let fileExtension = '';
                try {
                    const u = new URL(url);
                    const ext = path.extname(u.pathname).toLowerCase();
                    fileExtension = ext ? ext.slice(1) : '';
                } catch (_) {
                    const urlParts = url.split('.');
                    fileExtension = urlParts[urlParts.length - 1].toLowerCase();
                }
                if (!fileExtension) throw new Error('无法识别下载文件类型');
                const tempFile = path.join(compilersDir, `${version}.${fileExtension}`);

                downloader = new MultiThreadDownloader({
                    maxConcurrency: 16,
                    chunkSize: 1024 * 1024 * 2,
                    timeout: 45000,
                    retryCount: 8,
                    minMultiThreadSize: 1024 * 1024 * 2,
                    progressCallback: (progress) => {
                        let percent = null;
                        let speedText = null;
                        let receivedMB = null;
                        let totalMB = null;
                        if (progress.type === 'single' || progress.type === 'multi') {
                            percent = progress.progress;
                            speedText = progress.speed > 1024 * 1024
                                ? `${(progress.speed / 1024 / 1024).toFixed(1)} MB/s`
                                : `${(progress.speed / 1024).toFixed(0)} KB/s`;
                            receivedMB = (progress.downloadedBytes / 1024 / 1024).toFixed(1);
                            totalMB = progress.totalBytes > 0 ? (progress.totalBytes / 1024 / 1024).toFixed(1) : '未知';
                            const prefix = progress.type === 'multi' ? `多线程下载中` : '下载中';
                            const threadInfo = progress.type === 'multi' ? ` (${progress.activeChunks}线程)` : '';
                            updateProgress(`${prefix}${threadInfo}: ${receivedMB}MB / ${totalMB}MB`, percent, speedText);
                        }
                    }
                });

                await downloader.download(url, tempFile);

                updateProgress('下载完成，开始解压...', 100);
                logInfo('[编译器下载] 开始解压缩:', { archive: tempFile, targetDir: versionDir });

                if (!fs.existsSync(versionDir)) {
                    fs.mkdirSync(versionDir, { recursive: true });
                }

                if (fileExtension === 'zip') {
                    await extractZip(tempFile, { dir: versionDir });
                } else if (fileExtension === '7z') {
                    if (!sevenBinPath || !fs.existsSync(sevenBinPath)) {
                        throw new Error('7z 解压工具不可用，请联网安装依赖或改用zip包');
                    }
                    await new Promise((resolve, reject) => {
                        const { spawn } = require('child_process');
                        const args = ['x', '-y', `-o${versionDir}`, tempFile];
                        const proc = spawn(sevenBinPath, args, { windowsHide: true });
                        let stderr = '';
                        proc.stderr.on('data', (d) => { stderr += d.toString(); });
                        proc.on('close', (code) => {
                            if (code === 0) resolve();
                            else reject(new Error(`7z 解压失败(code=${code}): ${stderr || ''}`));
                        });
                        proc.on('error', (err) => reject(err));
                    });
                } else {
                    throw new Error(`不支持的文件格式: ${fileExtension}`);
                }

                fs.unlinkSync(tempFile);

                updateProgress('解压完成，查找编译器可执行文件...');

                const compilerPath = findCompilerExecutable(versionDir);
                logInfo('[编译器下载] 编译器探测结果:', Boolean(compilerPath));

                downloadCompleted = true;
                updateProgress('编译器安装完成！');

                const result = {
                    success: true,
                    compilerPath: compilerPath || path.join(versionDir, 'bin', 'g++.exe')
                };

                if (!backgroundDownload && progressWindow && !progressWindow.isDestroyed()) {
                    setTimeout(() => {
                        if (progressWindow && !progressWindow.isDestroyed()) {
                            progressWindow.close();
                        }
                    }, 2000); // 2秒后关闭
                }

                resolve(result);

            } catch (error) {
                downloadCompleted = true;

                const isCancelledError = error.message.includes('下载已取消') || error.message.includes('用户取消');
                const errorMessage = isCancelledError ? '下载已取消' : `下载失败: ${error.message}`;

                logError('[编译器下载] 下载过程出错:', error.message);

                if (!backgroundDownload && progressWindow && !progressWindow.isDestroyed()) {
                    updateProgress(errorMessage);
                    setTimeout(() => {
                        if (progressWindow && !progressWindow.isDestroyed()) {
                            progressWindow.close();
                        }
                    }, isCancelledError ? 1000 : 3000); // 取消时更快关闭
                }

                resolve({ success: false, error: errorMessage });
            }
        });
    });

    ipcMain.handle('select-compiler', async (event, version) => {
        logInfo('[选择编译器] 开始选择编译器，版本:', version);
        try {
            const userHome = os.homedir();
            const versionDir = path.join(userHome, '.oicpp', 'Compilers', version);

            if (!fs.existsSync(versionDir)) {
                return { success: false, error: '编译器版本不存在' };
            }

            const compilerPath = findCompilerExecutable(versionDir);

            if (!compilerPath) {
                return { success: false, error: '未找到编译器可执行文件' };
            }

            settings.compilerPath = compilerPath;
            saveSettings();
            return { success: true, compilerPath };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });



    ipcMain.handle('get-downloaded-testlibs', async (event) => {
        try {
            const userHome = os.homedir();
            const testlibsDir = path.join(userHome, '.oicpp', 'Testlibs');

            if (!fs.existsSync(testlibsDir)) {
                return [];
            }

            const dirs = fs.readdirSync(testlibsDir, { withFileTypes: true })
                .filter(dirent => dirent.isDirectory())
                .map(dirent => dirent.name);

            return dirs;
        } catch (error) {
            logError('[获取已下载testlib] 获取已下载testlib失败:', error);
            return [];
        }
    });

    ipcMain.handle('download-testlib', async (event, { url, version, name }) => {
        logInfo('[testlib下载] 开始下载请求:', { version, name });

        if (!url || !version || !name) {
            logError('[testlib下载] 缺少必要参数:', { url, version, name });
            return { success: false, error: '缺少必要的下载参数' };
        }

        return new Promise(async (resolve) => {
            const userHome = os.homedir();
            const testlibsDir = path.join(userHome, '.oicpp', 'Testlibs');
            const versionDir = path.join(testlibsDir, version);

            logInfo('[testlib下载] 目录路径:', { testlibsDir, versionDir });

            if (!fs.existsSync(testlibsDir)) {
                fs.mkdirSync(testlibsDir, { recursive: true });
                logInfo('[testlib下载] 创建testlib目录:', testlibsDir);
            }

            if (fs.existsSync(versionDir)) {
                logInfo('[testlib下载] 版本目录已存在:', versionDir);
                resolve({ success: false, error: '该版本已存在' });
                return;
            }

            let backgroundDownload = false;
            let downloadCompleted = false;
            let progressWindow = null;
            let downloader = null;

            try {
                logInfo('[testlib下载] 创建进度窗口...');

                const tmpDir = path.join(os.tmpdir(), 'oicpp-testlib-download');
                if (!fs.existsSync(tmpDir)) {
                    fs.mkdirSync(tmpDir, { recursive: true });
                }

                const htmlFile = path.join(tmpDir, 'testlib-progress.html');
                const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>下载testlib</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            margin: 0;
            padding: 30px;
            background: #252526;
            color: #cccccc;
            font-size: 14px;
            line-height: 1.5;
        }
        h3 {
            color: #4fc3f7;
            margin-bottom: 30px;
            font-weight: 400;
            font-size: 18px;
        }
        #status {
            font-size: 14px;
            margin-bottom: 20px;
            color: #cccccc;
            min-height: 20px;
        }
        #progress-container {
            background: #3c3c3c;
            border-radius: 4px;
            padding: 2px;
            margin: 20px 0;
            border: 1px solid #464647;
        }
        #progress-bar {
            background: linear-gradient(90deg, #0e639c, #1177bb);
            height: 16px;
            border-radius: 2px;
            width: 0%;
            transition: width 0.2s ease;
            position: relative;
        }
        #progress-text {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            color: white;
            font-size: 11px;
            font-weight: 500;
            text-shadow: 0 1px 2px rgba(0,0,0,0.8);
        }
        #speed {
            font-size: 12px;
            color: #9cdcfe;
            margin-top: 10px;
            text-align: center;
        }
    </style>
</head>
<body>
    <h3>正在下载testlib: ${name} ${version}</h3>
    <div id="status">准备开始下载...</div>
    <div id="progress-container">
        <div id="progress-bar">
            <div id="progress-text">0%</div>
        </div>
    </div>
    <div id="speed"></div>
</body>
</html>`;

                fs.writeFileSync(htmlFile, htmlContent, 'utf8');
                logInfo('[testlib下载] HTML文件已创建:', htmlFile);

                progressWindow = new BrowserWindow({
                    width: 500,
                    height: 400,
                    show: false,
                    resizable: false,
                    parent: BrowserWindow.getFocusedWindow(),
                    modal: false,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true
                    }
                });

                logInfo('[testlib下载] 进度窗口已创建');

                progressWindow.on('close', (event) => {
                    logInfo('[testlib下载] 进度窗口关闭事件, downloadCompleted:', downloadCompleted);

                    if (!backgroundDownload && !downloadCompleted) {
                        event.preventDefault();

                        const choice = dialog.showMessageBoxSync(progressWindow, {
                            type: 'question',
                            title: '后台下载',
                            message: '是否在后台继续下载testlib？',
                            detail: '关闭此窗口后，下载将在后台继续进行。',
                            buttons: ['后台下载', '取消下载'],
                            defaultId: 0
                        });

                        if (choice === 0) {
                            backgroundDownload = true;
                            logInfo('[testlib下载] 用户选择后台下载testlib');
                            progressWindow.destroy();
                        } else {
                            logInfo('[testlib下载] 用户取消testlib下载');
                            if (downloader) {
                                downloader.cancel();
                            }
                            resolve({ success: false, error: '用户取消下载' });
                            progressWindow.destroy();
                            return;
                        }
                    } else {
                        try {
                            if (fs.existsSync(htmlFile)) {
                                fs.unlinkSync(htmlFile);
                                logInfo('[testlib下载] 临时HTML文件已清理');
                            }
                        } catch (error) {
                            logInfo('[testlib下载] 清理临时文件失败:', error.message);
                        }
                    }
                });

                progressWindow.loadFile(htmlFile);

                progressWindow.webContents.once('did-finish-load', () => {
                    progressWindow.show();
                    updateProgress('开始下载testlib...');
                });

                progressWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                    logError('[testlib下载] 页面加载失败:', errorCode, errorDescription);
                });

                function updateProgress(message, percent = null, speed = null) {
                    try {
                        if (!backgroundDownload && progressWindow && !progressWindow.isDestroyed()) {
                            progressWindow.webContents.executeJavaScript(`
                (function() {
                  try {
                    const statusElement = document.getElementById('status');
                    const progressBar = document.getElementById('progress-bar');
                    const progressText = document.getElementById('progress-text');
                    const speedElement = document.getElementById('speed');
                    
                    if (statusElement) {
                      statusElement.textContent = ${JSON.stringify(message)};
                    }
                    
                    if (progressBar && progressText && ${percent !== null}) {
                      const percentValue = Math.max(0, Math.min(100, Math.round(${percent})));
                      progressBar.style.width = percentValue + '%';
                      progressText.textContent = percentValue + '%';
                    }
                    
                    if (speedElement && ${speed !== null}) {
                      speedElement.textContent = ${JSON.stringify(speed)};
                    }
                    
                    return true;
                  } catch (error) {
                    return false;
                  }
                })()
              `).catch(() => {
                            });
                        }
                    } catch (error) {
                    }
                }

                updateProgress(`开始下载testlib: ${name} ${version}`);

                if (typeof url !== 'string' || !url.includes('.')) {
                    throw new Error('无效的下载URL格式');
                }

                let fileExtension = '';
                try {
                    const u = new URL(url);
                    const ext = path.extname(u.pathname).toLowerCase();
                    fileExtension = ext ? ext.slice(1) : '';
                } catch (_) {
                    const urlParts = url.split('.');
                    fileExtension = urlParts[urlParts.length - 1].toLowerCase();
                }
                if (!fileExtension) throw new Error('无法识别下载文件类型');
                const tempFile = path.join(testlibsDir, `${version}.${fileExtension}`);

                downloader = new MultiThreadDownloader({
                    maxConcurrency: 16,
                    chunkSize: 1024 * 1024 * 2,
                    timeout: 45000,
                    retryCount: 8,
                    minMultiThreadSize: 1024 * 1024 * 2,
                    progressCallback: (progress) => {
                        if (progress.type === 'single' || progress.type === 'multi') {
                            const percent = progress.progress;
                            const speedText = progress.speed > 1024 * 1024
                                ? `${(progress.speed / 1024 / 1024).toFixed(1)} MB/s`
                                : `${(progress.speed / 1024).toFixed(0)} KB/s`;
                            const receivedMB = (progress.downloadedBytes / 1024 / 1024).toFixed(1);
                            const totalMB = progress.totalBytes > 0 ? (progress.totalBytes / 1024 / 1024).toFixed(1) : '未知';
                            const prefix = progress.type === 'multi' ? `多线程下载中` : '下载中';
                            const threadInfo = progress.type === 'multi' ? ` (${progress.activeChunks}线程)` : '';
                            updateProgress(`${prefix}${threadInfo}: ${receivedMB}MB / ${totalMB}MB`, percent, speedText);
                        }
                    }
                });

                await downloader.download(url, tempFile);

                updateProgress('下载完成，开始解压...', 100);

                if (!fs.existsSync(versionDir)) {
                    fs.mkdirSync(versionDir, { recursive: true });
                }

                if (fileExtension === 'zip') {
                    await extractZip(tempFile, { dir: versionDir });
                } else if (fileExtension === '7z') {
                    if (!sevenBinPath || !fs.existsSync(sevenBinPath)) {
                        throw new Error('7z 解压工具不可用，请联网安装依赖或改用zip包');
                    }
                    await new Promise((resolve, reject) => {
                        const { spawn } = require('child_process');
                        const args = ['x', '-y', `-o${versionDir}`, tempFile];
                        const proc = spawn(sevenBinPath, args, { windowsHide: true });
                        let stderr = '';
                        proc.stderr.on('data', (d) => { stderr += d.toString(); });
                        proc.on('close', (code) => {
                            if (code === 0) resolve();
                            else reject(new Error(`7z 解压失败(code=${code}): ${stderr || ''}`));
                        });
                        proc.on('error', (err) => reject(err));
                    });
                } else {
                    throw new Error(`不支持的文件格式: ${fileExtension}`);
                }

                fs.unlinkSync(tempFile);

                updateProgress('解压完成，查找testlib文件...');

                const testlibPath = findTestlibFile(versionDir);

                downloadCompleted = true;
                updateProgress('testlib安装完成！');

                const result = {
                    success: true,
                    testlibPath: testlibPath || path.join(versionDir, 'testlib.h')
                };

                if (!backgroundDownload && progressWindow && !progressWindow.isDestroyed()) {
                    setTimeout(() => {
                        if (progressWindow && !progressWindow.isDestroyed()) {
                            progressWindow.close();
                        }
                    }, 2000); // 2秒后关闭
                }

                resolve(result);

            } catch (error) {
                downloadCompleted = true;

                const isCancelledError = error.message.includes('下载已取消') || error.message.includes('用户取消');
                const errorMessage = isCancelledError ? '下载已取消' : `下载失败: ${error.message}`;

                logError('[testlib下载] 下载过程出错:', error.message);

                if (!backgroundDownload && progressWindow && !progressWindow.isDestroyed()) {
                    updateProgress(errorMessage);
                    setTimeout(() => {
                        if (progressWindow && !progressWindow.isDestroyed()) {
                            progressWindow.close();
                        }
                    }, isCancelledError ? 1000 : 3000); // 取消时更快关闭
                }

                resolve({ success: false, error: errorMessage });
            }
        });
    });

    ipcMain.handle('select-testlib', async (event, version) => {
        logInfo('[选择testlib] 开始选择testlib，版本:', version);
        try {
            const userHome = os.homedir();
            const versionDir = path.join(userHome, '.oicpp', 'Testlibs', version);
            logInfo('[选择testlib] 检查版本目录:', versionDir);

            if (!fs.existsSync(versionDir)) {
                logInfo('[选择testlib] 版本目录不存在');
                return { success: false, error: 'testlib版本不存在' };
            }

            logInfo('[选择testlib] 版本目录存在，查找testlib文件');
            const testlibPath = findTestlibFile(versionDir);
            logInfo('[选择testlib] 查找结果:', testlibPath);

            if (!testlibPath) {
                logInfo('[选择testlib] 未找到testlib文件');
                return { success: false, error: '未找到testlib文件' };
            }

            settings.testlibPath = testlibPath;
            saveSettings();

            logInfo('[选择testlib] 选择成功，已更新设置，testlib路径:', testlibPath);
            return { success: true, testlibPath };
        } catch (error) {
            logError('[选择testlib] 发生错误:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('test-compiler', async (event, compilerPath) => {
        try {
            if (!compilerPath || !fs.existsSync(compilerPath)) {
                return { success: false, message: '编译器路径无效或不存在。' };
            }

            const testDir = path.join(os.tmpdir(), 'oicpp-test');
            if (!fs.existsSync(testDir)) {
                fs.mkdirSync(testDir, { recursive: true });
            }

            const testCppFile = path.join(testDir, 'test.cpp');
            const testExeFile = path.join(testDir, 'test.exe');
            const cppContent = '#include <iostream>\nint main() { std::cout << "oicpp-test-success"; return 0; }';

            fs.writeFileSync(testCppFile, cppContent, 'utf8');

            let compilerArgs = '-std=c++17';

            const compileResult = await compileFile({
                inputFile: testCppFile,
                outputFile: testExeFile,
                compilerPath: compilerPath,
                compilerArgs: compilerArgs,
                workingDirectory: testDir
            });

            if (!compileResult.success) {
                return { success: false, message: '编译测试代码失败。', details: compileResult.stderr };
            }

            const runResult = await new Promise((resolve) => {
                const { spawn } = require('child_process');

                let testEnv = { ...process.env };
                if (compilerPath && fs.existsSync(compilerPath)) {
                    const compilerDir = path.dirname(compilerPath);
                    const compilerRoot = path.dirname(compilerDir);

                    let mingwBinPaths = [
                        compilerDir,
                        path.join(compilerRoot, 'bin'),
                        path.join(compilerRoot, 'mingw64', 'bin'),
                        path.join(compilerRoot, 'mingw32', 'bin')
                    ];

                    mingwBinPaths = mingwBinPaths.filter(p => fs.existsSync(p));

                    if (mingwBinPaths.length > 0) {
                        const envPath = [process.env.PATH, ...mingwBinPaths].join(path.delimiter);
                        testEnv.PATH = envPath;
                    }
                }

                const proc = spawn(testExeFile, [], {
                    env: testEnv,
                    timeout: 10000  // 10秒超时
                });
                let output = '';
                let stderr = '';

                proc.stdout.on('data', (data) => output += data.toString());
                proc.stderr.on('data', (data) => stderr += data.toString());

                proc.on('close', (code) => {
                    if (code === 0 && output.includes('oicpp-test-success')) {
                        resolve({ success: true });
                    } else {
                        resolve({
                            success: false,
                            message: `测试程序运行失败 (退出码: ${code})`,
                            details: stderr || output || '程序无输出'
                        });
                    }
                });

                proc.on('error', (error) => {
                    let errorMessage = `运行测试程序失败: ${error.message}`;
                    resolve({ success: false, message: errorMessage });
                });
            });

            try {
                fs.unlinkSync(testCppFile);
                if (fs.existsSync(testExeFile)) {
                    fs.unlinkSync(testExeFile);
                }
            } catch (cleanupError) {
                logWarn('清理测试文件失败:', cleanupError);
            }

            return runResult;
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    ipcMain.handle('test-testlib', async (event, testlibPath) => {
        try {
            if (!testlibPath || !fs.existsSync(testlibPath)) {
                return { success: false, message: 'testlib路径无效或不存在。' };
            }

            const fileName = path.basename(testlibPath).toLowerCase();
            if (fileName !== 'testlib.h') {
                return { success: false, message: '所选文件不是testlib.h文件。' };
            }

            const content = fs.readFileSync(testlibPath, 'utf8');
            if (!content.includes('This file contains testlib library')) {
                return { success: false, message: '所选文件不是有效的testlib库文件。' };
            }

            return { success: true, message: 'testlib测试成功！' };
        } catch (error) {
            return { success: false, message: '测试testlib时发生未知错误。', details: error.message };
        }
    });

    function findTestlibFile(baseDir) {
        try {
            const rootTestlib = path.join(baseDir, 'testlib.h');
            if (fs.existsSync(rootTestlib)) {
                return rootTestlib;
            }

            const files = walkDir(baseDir);
            const testlibFile = files.find(file => path.basename(file).toLowerCase() === 'testlib.h');

            return testlibFile || null;
        } catch (error) {
            logError('[查找testlib] 查找testlib文件失败:', error);
            return null;
        }
    }
}

function normalizeDroppedPath(filePath) {
    if (filePath == null) {
        return '';
    }
    let normalized = typeof filePath === 'string' ? filePath : String(filePath);
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
                let pathname = fileUrl.pathname || '';
                pathname = decodeURIComponent(pathname);
                if (process.platform === 'win32' && pathname.startsWith('/')) {
                    pathname = pathname.slice(1);
                }
                normalized = pathname;
            }
        } catch (error) {
            try {
                if (typeof logWarn === 'function') {
                    logWarn('文件路径解析失败，使用原值:', error);
                } else {
                    console.warn('[normalizeDroppedPath] 文件路径解析失败，使用原值:', error);
                }
            } catch (_) { }
        }
    }

    normalized = normalized.replace(/\u0000/g, '');

    if (process.platform === 'win32') {
        normalized = normalized.replace(/\//g, '\\');
    }

    try {
        normalized = path.normalize(normalized);
    } catch (_) { }

    return normalized;
}

async function readFileContent(filePath) {
    try {
        const normalizedPath = normalizeDroppedPath(filePath);
        if (!normalizedPath || !fs.existsSync(normalizedPath)) {
            throw new Error('文件不存在');
        }

        const buffer = fs.readFileSync(normalizedPath);

        const isBinary = buffer.some(byte => byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13));

        if (isBinary) {
            throw new Error('不支持的二进制文件');
        }

        const encoding = detectEncoding(buffer);
        if (encoding === 'gbk' || encoding === 'gb2312') {
            const iconv = require('iconv-lite');
            return iconv.decode(buffer, 'gbk');
        } else {
            return buffer.toString('utf8');
        }
    } catch (error) {
        throw error;
    }
}

function detectEncoding(buffer) {
    if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
        return 'utf8';
    }

    if (buffer.length >= 2) {
        if ((buffer[0] === 0xFF && buffer[1] === 0xFE) || (buffer[0] === 0xFE && buffer[1] === 0xFF)) {
            return 'utf16';
        }
    }

    let isValidUTF8 = true;
    for (let i = 0; i < buffer.length; i++) {
        const byte = buffer[i];
        if (byte > 127) {
            if ((byte & 0xE0) === 0xC0) {
                if (i + 1 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80) {
                    isValidUTF8 = false;
                    break;
                }
                i++;
            } else if ((byte & 0xF0) === 0xE0) {
                if (i + 2 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80 || (buffer[i + 2] & 0xC0) !== 0x80) {
                    isValidUTF8 = false;
                    break;
                }
                i += 2;
            } else if ((byte & 0xF8) === 0xF0) {
                if (i + 3 >= buffer.length || (buffer[i + 1] & 0xC0) !== 0x80 || (buffer[i + 2] & 0xC0) !== 0x80 || (buffer[i + 3] & 0xC0) !== 0x80) {
                    isValidUTF8 = false;
                    break;
                }
                i += 3;
            } else {
                isValidUTF8 = false;
                break;
            }
        }
    }

    if (isValidUTF8) {
        return 'utf8';
    }

    return 'gbk';
}

async function readDirectory(dirPath) {
    const items = [];

    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);

            if (entry.name.startsWith('.')) {
                continue;
            }
            if (entry.name.toLowerCase().endsWith('.dsym')) {
                continue;
            }

            if (entry.isDirectory()) {
                items.push({
                    name: entry.name,
                    type: 'folder',
                    path: fullPath,
                    children: [] // 延迟加载子目录
                });
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                const supportedExts = ['.cpp', '.c', '.h', '.hpp', '.cc', '.cxx', '.txt', '.md', '.json', '.in', '.out', '.ans', '.pdf'];

                if (supportedExts.includes(ext) || !ext) {
                    items.push({
                        name: entry.name,
                        type: 'file',
                        path: fullPath,
                        extension: ext
                    });
                }
            }
        }

        items.sort((a, b) => {
            if (a.type !== b.type) {
                return a.type === 'folder' ? -1 : 1;
            }
            return a.name.localeCompare(b.name);
        });

    } catch (error) {
        logError('读取目录失败:', error);
        throw error;
    }

    return items;
}

function copyDirectorySync(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }

    const entries = fs.readdirSync(src, { withFileTypes: true });

    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
            copyDirectorySync(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

function getUniquePath(targetDir, fileName) {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    let index = 1;
    let candidate = path.join(targetDir, `${base} (${index})${ext}`);
    while (fs.existsSync(candidate)) {
        index++;
        candidate = path.join(targetDir, `${base} (${index})${ext}`);
    }
    return candidate;
}

async function openFile() {
    try { logInfo('[打开文件] 打开对话框'); } catch (_) { }
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'C++ Files', extensions: ['cpp', 'cxx', 'cc', 'c'] },
            { name: 'Text Files', extensions: ['txt', 'in', 'out'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        try {
            logInfo('[打开文件] 选择路径:', filePath);
            const buffer = fs.readFileSync(filePath);
            try { logInfo('[打开文件] 文件大小(bytes):', buffer.length); } catch (_) { }
            const isBinary = buffer.some(byte => byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13));

            if (isBinary) {
                logWarn('[打开文件] 检测到二进制文件，发送提示，文件名:', path.basename(filePath));
                mainWindow.webContents.send('file-open-binary', path.basename(filePath));
            } else {
                const content = buffer.toString('utf8');
                try { logInfo('[打开文件] 文本文件读取成功，内容长度:', content.length); } catch (_) { }
                mainWindow.webContents.send('file-opened', {
                    fileName: path.basename(filePath),
                    filePath: filePath,
                    content: content
                });
                try { logInfo('[打开文件] 已发送 file-opened 事件'); } catch (_) { }
            }
        } catch (error) {
            logError('打开文件失败:', error);
            dialog.showErrorBox('错误', `无法打开文件: ${error.message}`);
        }
    } else {
        try { logInfo('[打开文件] 用户取消或未选择文件'); } catch (_) { }
    }
}

function updateRecentFiles(filePath) {
    if (!settings.recentFiles) {
        settings.recentFiles = [];
    }

    try {
        if (filePath && fs.existsSync(filePath)) {
            const stat = fs.statSync(filePath);
            if (stat.isFile()) {
                const dir = path.dirname(filePath);
                logInfo('[最近列表] 传入为文件路径，已转换为目录:', filePath, '->', dir);
                filePath = dir;
            }
        }
    } catch (e) {
        logWarn('[最近列表] 检测/转换路径失败，原样使用:', filePath, e.message);
    }

    settings.recentFiles = settings.recentFiles.filter(item => item.path !== filePath);

    settings.recentFiles.unshift({
        path: filePath,
        name: path.basename(filePath),
        lastAccessed: new Date().toISOString()
    });

    if (settings.recentFiles.length > 10) {
        settings.recentFiles = settings.recentFiles.slice(0, 10);
    }
}

async function openFolder() {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory']
    });

    if (!result.canceled && result.filePaths.length > 0) {
        let selectedPath = result.filePaths[0];
        if (selectedPath) {
            try {
                const stat = fs.statSync(selectedPath);
                if (stat.isFile()) {
                    selectedPath = path.dirname(selectedPath);
                    logInfo('[打开工作区] 选择为文件，已自动转换为目录:', selectedPath);
                }
            } catch (e) {
                logWarn('[打开工作区] 读取选中路径信息失败，将直接尝试作为目录:', e.message);
            }

            settings.lastOpen = selectedPath;

            updateRecentFiles(selectedPath);

            saveSettings();

            mainWindow.webContents.send('folder-opened', selectedPath);
        }
    }
}

async function saveAsFile() {
    const result = await dialog.showSaveDialog(mainWindow, {
        filters: [
            { name: 'C++ Files', extensions: ['cpp'] },
            { name: 'Text Files', extensions: ['txt'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });

    if (!result.canceled) {
        mainWindow.webContents.send('file-save-as', result.filePath);
    }
}

let compilerSettingsWindow = null;
let editorSettingsWindow = null;
let codeTemplatesWindow = null;

function openCompilerSettings() {
    if (compilerSettingsWindow) {
        compilerSettingsWindow.focus();
        return;
    }

    compilerSettingsWindow = new BrowserWindow({
        width: 800,
        height: 600,
        parent: mainWindow,
        modal: true,
        resizable: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: false
        },
        title: '编译器设置',
        icon: getUserIconPath()
    });

    compilerSettingsWindow.loadFile('src/renderer/settings/compiler.html');

    compilerSettingsWindow.on('closed', () => {
        compilerSettingsWindow = null;
    });
}

function openEditorSettings() {

    if (editorSettingsWindow) {
        logInfo('编辑器设置窗口已存在，聚焦窗口');
        editorSettingsWindow.focus();
        return;
    }

    logInfo('创建新的编辑器设置窗口');
    editorSettingsWindow = new BrowserWindow({
        width: 900,
        height: 700,
        parent: mainWindow,
        modal: true,
        resizable: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: false
        },
        title: '编辑器设置',
        icon: getUserIconPath()
    });

    editorSettingsWindow.loadFile('src/renderer/settings/editor.html', { query: { theme: settings.theme } });

    editorSettingsWindow.on('closed', () => {
        logInfo('编辑器设置窗口已关闭');
        editorSettingsWindow = null;
    });

    editorSettingsWindow.webContents.on('did-finish-load', () => {
        logInfo('编辑器设置页面加载完成');
    });

    editorSettingsWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        logError('编辑器设置页面加载失败:', errorCode, errorDescription);
    });
}

function openCodeTemplates() {
    if (codeTemplatesWindow) {
        codeTemplatesWindow.focus();
        return;
    }

    codeTemplatesWindow = new BrowserWindow({
        width: 800,
        height: 650,
        parent: mainWindow,
        modal: true,
        resizable: true,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            webSecurity: false
        },
        title: '代码模板设置',
        icon: getUserIconPath()
    });

    codeTemplatesWindow.loadFile('src/renderer/settings/templates.html');

    codeTemplatesWindow.on('closed', () => {
        codeTemplatesWindow = null;
    });
}

async function checkForUpdates(isManual = false) {
    try {
        if (process.platform !== 'win32') {
            logInfo('[更新] 非 Windows 平台，跳过下载更新逻辑');
            if (isManual && mainWindow) {
                dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: '检查更新',
                    message: '请前往官网获取最新版本',
                    detail: '即将打开: https://oicpp.mywwzh.top/'
                }).then(() => { try { shell.openExternal('https://oicpp.mywwzh.top/'); } catch (_) { } });
            }
            try { const today = new Date().toISOString().split('T')[0]; settings.lastUpdateCheck = today; saveSettings(); } catch (_) { }
            return;
        }
        logInfo('开始检查更新...');
        logInfo('检查类型:', isManual ? '手动检查' : '自动检查');

        const response = await fetch('https://oicpp.mywwzh.top/api/checkUpdate');
        logInfo('请求更新API状态码:', response.status);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const updateInfo = await response.json();

        const currentVersion = APP_VERSION; // 当前程序版本
        const latestVersion = updateInfo.latestVersion;
        const description = updateInfo.description || '';

        try {
            const today = new Date().toISOString().split('T')[0];
            settings.lastUpdateCheck = today;
            saveSettings();
        } catch (_) { }

        const hasUpdate = compareVersions(currentVersion, latestVersion);

        if (hasUpdate) {
            logInfo('发现新版本:', latestVersion);

            const formattedDescription = description.replace(/\\n/g, '\n');

            const choice = dialog.showMessageBoxSync(mainWindow, {
                type: 'info',
                title: '发现新版本',
                message: `发现新版本 ${latestVersion}`,
                detail: formattedDescription || `有新版本 ${latestVersion} 可用，是否立即更新？`,
                buttons: ['立即更新', '稍后更新'],
                defaultId: 0,
                width: 500
            });

            if (choice === 0) {
                logInfo('用户选择立即更新');
                downloadAndInstallUpdate(updateInfo);
            } else {
                logInfo('用户选择稍后更新');
            }
        } else {
            logInfo('当前已是最新版本');
            if (isManual) {
                dialog.showMessageBox(mainWindow, {
                    type: 'info',
                    title: '检查更新',
                    message: '当前已是最新版本',
                    detail: `您当前使用的版本 ${currentVersion} 已是最新版本。`
                });
            }
        }
    } catch (error) {
        logError('检查更新失败:', error);
        if (isManual) {
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                title: '检查更新失败',
                message: '无法连接到更新服务器',
                detail: '请检查网络连接或稍后重试。'
            });
        }
    }
}

async function cleanupOldInstallers(keepFile = null) {
    try {
        const userOicppDir = path.join(os.homedir(), '.oicpp');
        if (!fs.existsSync(userOicppDir)) {
            return;
        }

        logInfo('[更新] 开始清理旧的安装包...');
        const files = await fs.promises.readdir(userOicppDir);
        
        // 匹配安装包文件名模式: OICPP-x.y.z-Setup.exe 或类似的 .deb/.rpm 文件
        // 使用更严格的版本号格式：主版本.次版本.修订号
        const installerPattern = /^OICPP-\d+\.\d+\.\d+-Setup\.(exe|deb|rpm)$/i;
        
        const deletePromises = [];
        
        for (const file of files) {
            if (installerPattern.test(file)) {
                const filePath = path.join(userOicppDir, file);
                
                // 如果指定了要保留的文件，跳过该文件
                if (keepFile && filePath === keepFile) {
                    logInfo('[更新] 保留当前安装包:', file);
                    continue;
                }
                
                // 异步删除文件，收集所有 promise，确保错误也被捕获
                deletePromises.push(
                    fs.promises.unlink(filePath)
                        .then(() => ({ file, success: true }))
                        .catch(error => ({ file, success: false, error }))
                );
            }
        }
        
        // 等待所有删除操作完成，使用 allSettled 确保所有操作都执行
        const results = await Promise.allSettled(deletePromises);
        
        let cleanedCount = 0;
        for (const result of results) {
            if (result.status === 'fulfilled') {
                if (result.value.success) {
                    logInfo('[更新] 已删除旧安装包:', result.value.file);
                    cleanedCount++;
                } else {
                    logWarn('[更新] 无法删除旧安装包:', result.value.file, result.value.error?.message || result.value.error);
                }
            } else {
                logWarn('[更新] 删除操作失败:', result.reason?.message || result.reason);
            }
        }
        
        if (cleanedCount > 0) {
            logInfo(`[更新] 共清理了 ${cleanedCount} 个旧安装包`);
        } else {
            logInfo('[更新] 没有发现需要清理的旧安装包');
        }
    } catch (error) {
        logWarn('[更新] 清理旧安装包时出错:', error.message);
    }
}

async function downloadAndInstallUpdate(updateInfo = null) {
    try {
        logInfo('=== 开始下载安装程序(静默) ===');

        if (isUpdateDownloading) {
            logInfo('[更新] 已有静默下载进行中，忽略本次调用');
            return;
        }

        let latestVersion = updateInfo?.latestVersion;
        if (!latestVersion) {
            try {
                const versionResponse = await fetch('https://oicpp.mywwzh.top/api/checkUpdate');
                if (versionResponse.ok) {
                    const versionInfo = await versionResponse.json();
                    latestVersion = versionInfo.latestVersion;
                }
            } catch (e) {
                logWarn('[更新] 获取远程版本失败，放弃下载');
                return;
            }
        }
        if (!latestVersion) return;

        if (currentDownloadingVersion === latestVersion) {
            logInfo('[更新] 同版本正在下载，跳过');
            return;
        }

        const sysParam = process.platform === 'win32' ? 'win' : 'linux';
        const filelistResp = await fetch(`https://oicpp.mywwzh.top/api/getUpdateFilelist?version=${encodeURIComponent(latestVersion)}&sys=${sysParam}`);
        if (!filelistResp.ok) {
            logWarn('[更新] 获取文件列表失败');
            return;
        }
        const filelist = await filelistResp.json();
        if (!filelist || !filelist.files || filelist.files.length === 0) {
            logWarn('[更新] 文件列表为空');
            return;
        }

        let installerFile = null;
        if (process.platform === 'win32') {
            installerFile = filelist.files.find(f => /\.exe$/i.test(f.name));
        } else if (process.platform === 'linux') {
            installerFile = filelist.files.find(f => /\.deb$/i.test(f.name)) || filelist.files.find(f => /\.rpm$/i.test(f.name));
        }
        if (!installerFile || !installerFile.downloadUrl) {
            logWarn('[更新] 未找到可用安装包');
            return;
        }

        const userOicppDir = path.join(os.homedir(), '.oicpp');
        if (!fs.existsSync(userOicppDir)) fs.mkdirSync(userOicppDir, { recursive: true });
        
        // 在下载新安装包之前，清理旧的安装包
        await cleanupOldInstallers();
        
        const installerPath = path.join(userOicppDir, installerFile.name);

        if (fs.existsSync(installerPath)) {
            logInfo('[更新] 安装程序已存在，直接提示安装');
        } else {
            isUpdateDownloading = true;
            currentDownloadingVersion = latestVersion;
            const downloader = new MultiThreadDownloader({
                maxConcurrency: 16,
                chunkSize: 1024 * 1024 * 2,
                timeout: 45000,
                retryCount: 8,
                progressCallback: () => { /* 静默，不回显 */ }
            });
            try {
                await downloader.download(installerFile.downloadUrl, installerPath);
                logInfo('[更新] 静默下载完成');
            } catch (e) {
                logError('[更新] 静默下载失败:', e.message);
                isUpdateDownloading = false;
                currentDownloadingVersion = null;
                dialog.showMessageBox(mainWindow, {
                    type: 'error',
                    title: '更新下载失败',
                    message: '更新下载安装程序失败',
                    detail: e.message || '请稍后重试'
                });
                return;
            } finally {
                isUpdateDownloading = false;
            }
        }

        settings.pendingUpdate = {
            version: latestVersion,
            installerPath,
            installerName: installerFile.name,
            downloadTime: new Date().toISOString()
        };
        saveSettings();

        const choice = dialog.showMessageBoxSync(mainWindow, {
            type: 'info',
            title: '安装程序已准备就绪',
            message: '更新安装程序下载完成',
            detail: '是否立即运行安装程序？\n\n选择"稍后安装"将在下次启动时再次提醒。',
            buttons: ['立即安装', '稍后安装'],
            defaultId: 0
        });
        if (choice === 0) {
            runInstaller(installerPath);
            delete settings.pendingUpdate;
            saveSettings();
        } else {
            logInfo('[更新] 用户稍后安装');
        }
    } catch (error) {
        isUpdateDownloading = false;
        currentDownloadingVersion = null;
        logError('[更新] 更新流程异常:', error.message);
        dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '更新失败',
            message: '获取更新或下载时出现错误',
            detail: error.message || ''
        });
    }
}

function launchInstallerDetached(installerPath) {
    const { spawn } = require('child_process');
    const child = spawn('cmd.exe', ['/c', 'start', '""', installerPath], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', (err) => {
        try { logError('[更新] 启动安装程序失败:', err?.message || err); } catch (_) { }
        try {
            const { shell } = require('electron');
            shell.openPath(installerPath).catch(() => { });
        } catch (_) { }
    });
    child.unref();
}

function armInstallerLaunchOnQuit(installerPath) {
    if (!installerPath || process.platform !== 'win32') return;
    pendingInstallerLaunch = { installerPath, requestedAt: Date.now() };
    if (pendingInstallerLaunchArmed) return;
    pendingInstallerLaunchArmed = true;
    app.once('will-quit', () => {
        const launchInfo = pendingInstallerLaunch;
        pendingInstallerLaunch = null;
        pendingInstallerLaunchArmed = false;
        if (!launchInfo || !launchInfo.installerPath) return;
        try {
            launchInstallerDetached(launchInfo.installerPath);
            logInfo('[更新] 应用退出后已尝试启动安装程序');
        } catch (err) {
            logError('[更新] 退出后启动安装程序失败:', err?.message || err);
        }
    });
}

function runInstaller(installerPath) {
    try {
        logInfo('准备运行安装程序:', installerPath);
        if (!fs.existsSync(installerPath)) throw new Error('安装程序文件不存在');
        const isWindows = process.platform === 'win32';

        if (!isWindows) {
            const { shell } = require('electron');
            const openPromise = process.platform === 'linux' ? shell.openPath(installerPath) : shell.openExternal(installerPath);
            openPromise.catch(() => { });
            return;
        }

        try {
            dialog.showMessageBoxSync(mainWindow, {
                type: 'info',
                title: '即将启动更新',
                message: '应用将自动退出后启动更新安装程序',
                detail: '为避免文件占用，OICPP IDE 会先退出，然后运行安装程序。',
                buttons: ['确定'],
                defaultId: 0
            });
        } catch (_) { }

        armInstallerLaunchOnQuit(installerPath);

        if (mainWindow && !mainWindow.isDestroyed()) {
            armAllowMainWindowClose(SAVE_ALL_TIMEOUT + 10000);
            requestSaveAllAndClose('更新安装');
        } else {
            app.quit();
        }

        setTimeout(() => {
            try { app.quit(); } catch (_) { }
        }, SAVE_ALL_TIMEOUT + 8000);
    } catch (error) {
        logError('运行安装程序失败:', error);
        let errorDetail = `错误信息: ${error.message}\n\n安装程序位置: ${installerPath}\n\n您可以手动运行安装程序来完成更新。`;
        dialog.showMessageBox(mainWindow, {
            type: 'error',
            title: '无法启动安装程序',
            message: '自动启动安装程序失败',
            detail: errorDetail,
            buttons: ['打开安装程序所在文件夹', '确定']
        }).then(res => { if (res.response === 0) shell.showItemInFolder(installerPath); });
    }
}

function restoreSettingsBackupLinux() {
    if (process.platform !== 'linux') return;
    try {
        const backupFile = path.join(os.tmpdir(), 'oicpp_backup', 'settings.json');
        if (!fs.existsSync(backupFile)) return;
        const settingsPath = getSettingsPath();
        let needRestore = !fs.existsSync(settingsPath);
        if (!needRestore) {
            try {
                const stat = fs.statSync(settingsPath);
                if (stat.size < 10) needRestore = true; // 基本空文件
            } catch (_) { needRestore = true; }
        }
        if (needRestore) {
            const targetDir = path.dirname(settingsPath);
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            fs.copyFileSync(backupFile, settingsPath);
            logInfo('[启动] 已从临时备份恢复 settings.json');
        }
        try { fs.unlinkSync(backupFile); } catch (_) { }
    } catch (e) { logWarn('[启动] 恢复 Linux 设置备份失败(可忽略):', e.message); }
}

function ensureUserIconForLinux() {
    if (process.platform !== 'linux') return;
    try {
        const userIcon = path.join(os.homedir(), '.oicpp', 'oicpp.ico');
        if (!fs.existsSync(userIcon)) {
            const srcIcon = path.join(__dirname, '../oicpp.ico');
            if (fs.existsSync(srcIcon)) {
                const dir = path.dirname(userIcon);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.copyFileSync(srcIcon, userIcon);
                logInfo('[启动] 已复制图标到用户目录 (Linux)');
            }
        }
    } catch (e) { logWarn('[启动] 复制 Linux 图标失败(可忽略):', e.message); }
}

function checkPendingUpdate() {
    if (settings.pendingUpdate) {
        const pendingUpdate = settings.pendingUpdate;
        logInfo('发现待安装的更新:', pendingUpdate);

        if (fs.existsSync(pendingUpdate.installerPath)) {
            setTimeout(() => {
                const installChoice = dialog.showMessageBoxSync(mainWindow, {
                    type: 'info',
                    title: '发现待安装的更新',
                    message: `您有一个待安装的更新 (版本 ${pendingUpdate.version})`,
                    detail: `安装程序已准备就绪。\n\n是否现在运行安装程序？`,
                    buttons: ['立即安装', '稍后提醒', '取消此更新'],
                    defaultId: 0
                });

                if (installChoice === 0) {
                    logInfo('用户选择立即安装待更新版本');
                    runInstaller(pendingUpdate.installerPath);

                    delete settings.pendingUpdate;
                    saveSettings();
                } else if (installChoice === 2) {
                    logInfo('用户取消此更新');

                    try {
                        fs.unlinkSync(pendingUpdate.installerPath);
                        logInfo('已删除安装程序文件');
                    } catch (error) {
                        logWarn('删除安装程序文件失败:', error);
                    }

                    delete settings.pendingUpdate;
                    saveSettings();
                }
            }, 3000); // 3秒后显示提示
        } else {

            delete settings.pendingUpdate;
            saveSettings();
        }
    }
}

async function checkDailyUpdate() {
    const lastCheckDate = settings.lastUpdateCheck || '1970-01-01';
    logInfo('启动时检查更新...');
    logInfo('上次检查日期:', lastCheckDate);

    return new Promise(resolve => {
        setTimeout(async () => {
            logInfo('开始执行启动时自动检查更新');
            await checkForUpdates(false); // false 表示自动检查
            resolve();
        }, 5000);
    });
}

function getSettingsPath() {
    const settingsDir = path.join(os.homedir(), '.oicpp');
    if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
    }
    return path.join(settingsDir, 'settings.json');
}

function mergeSettings(defaultSettings, userSettings) {
    const result = JSON.parse(JSON.stringify(defaultSettings));

    function merge(target, source) {
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
                    if (!target[key] || typeof target[key] !== 'object') {
                        target[key] = {};
                    }
                    merge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        }
    }

    merge(result, userSettings);
    return result;
}

function loadSettings() {
    try {
        const settingsPath = getSettingsPath();

        settings = getDefaultSettings();

        if (fs.existsSync(settingsPath)) {
            const savedSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            const validKeys = ['compilerPath', 'compilerArgs', 'testlibPath', 'font', 'fontSize', 'lineHeight', 'theme', 'tabSize', 'fontLigaturesEnabled', 'enableAutoCompletion', 'foldingEnabled', 'stickyScrollEnabled', 'autoSave', 'autoSaveInterval', 'markdownMode', 'cppTemplate', 'codeSnippets', 'lastOpen', 'recentFiles', 'lastUpdateCheck', 'pendingUpdate', 'windowOpacity', 'backgroundImage', 'keybindings', 'autoOpenLastWorkspace', 'account'];

            for (const key of validKeys) {
                if (savedSettings[key] !== undefined) {
                    settings[key] = savedSettings[key];
                }
            }
        } else {
            logInfo('设置文件不存在，使用默认设置');
            saveSettings();
        }
        if (process.platform !== 'win32' && !settings.compilerPath) {
            try {
                if (fs.existsSync('/usr/bin/g++')) {
                    settings.compilerPath = '/usr/bin/g++';
                    logInfo('[设置] 非 Windows 平台默认使用 /usr/bin/g++');
                } else if (fs.existsSync('/bin/g++')) {
                    settings.compilerPath = '/bin/g++';
                    logInfo('[设置] 非 Windows 平台回退使用 /bin/g++');
                } else if (fs.existsSync('/usr/bin/clang++')) {
                    settings.compilerPath = '/usr/bin/clang++';
                    logInfo('[设置] 非 Windows 平台进一步回退使用 /usr/bin/clang++');
                }
                if (settings.compilerPath) saveSettings();
            } catch (e) {
                logWarn('[设置] 检测系统编译器失败:', e.message);
            }
        }

    } catch (error) {
        logError('加载设置失败:', error);
        settings = getDefaultSettings();
        saveSettings();
    }
}

function mergeSettings(defaultSettings, userSettings) {
    const result = JSON.parse(JSON.stringify(defaultSettings));
    const validKeys = ['compilerPath', 'compilerArgs', 'testlibPath', 'font', 'fontSize', 'lineHeight', 'theme', 'tabSize', 'fontLigaturesEnabled', 'enableAutoCompletion', 'foldingEnabled', 'stickyScrollEnabled', 'autoSave', 'autoSaveInterval', 'markdownMode', 'cppTemplate', 'codeSnippets', 'windowOpacity', 'backgroundImage', 'keybindings', 'autoOpenLastWorkspace', 'account'];

    for (const key of validKeys) {
        if (userSettings[key] !== undefined) {
            result[key] = userSettings[key];
        } else {
            result[key] = defaultSettings[key];
        }
    }

    return result;
}

function saveSettings() {
    try {
        const settingsPath = getSettingsPath();
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (error) {
        logError('保存设置失败:', error);
    }
}

function migrateOldSettings() {
    try {
        const settingsDir = path.join(os.homedir(), '.oicpp');
        let migrated = false;

        const compilerPath = path.join(settingsDir, 'compiler.json');
        if (fs.existsSync(compilerPath)) {
            const compilerSettings = JSON.parse(fs.readFileSync(compilerPath, 'utf8'));
            settings.compiler = { ...settings.compiler, ...compilerSettings };
            migrated = true;
            logInfo('已迁移编译器设置');
        }

        const editorPath = path.join(settingsDir, 'editor.json');
        if (fs.existsSync(editorPath)) {
            const editorSettings = JSON.parse(fs.readFileSync(editorPath, 'utf8'));
            settings = { ...settings, ...editorSettings };
            migrated = true;
            logInfo('已迁移编辑器设置');
        }

        if (migrated) {
            saveSettings();
            logInfo('设置迁移完成，保存统一设置文件');
        }

    } catch (error) {
        logError('迁移旧设置失败:', error);
    }
}

function updateSettings(settingsType, newSettings) {
    try {

        const validKeys = [
            'compilerPath', 'compilerArgs', 'testlibPath', 'font', 'fontSize', 'lineHeight', 'theme',
            'enableAutoCompletion', 'foldingEnabled', 'stickyScrollEnabled', 'fontLigaturesEnabled', 'cppTemplate', 'tabSize', 'autoSave', 'autoSaveInterval',
            'codeSnippets', 'windowOpacity', 'backgroundImage', 'markdownMode', 'keybindings', 'autoOpenLastWorkspace'
        ];

        for (const key in newSettings) {
            if (validKeys.includes(key)) {
                logInfo(`更新设置键: ${key} = ${newSettings[key]}`);
                settings[key] = newSettings[key];
            } else {
                logInfo(`忽略无效键: ${key}`);
            }
        }

        saveSettings();

        if (mainWindow) {
            mainWindow.webContents.send('settings-changed', null, settings);
        }

        if (newSettings.theme) {
            if (compilerSettingsWindow) {
                compilerSettingsWindow.webContents.send('theme-changed', newSettings.theme);
            }
            if (editorSettingsWindow) {
                editorSettingsWindow.webContents.send('theme-changed', newSettings.theme);
            }
            if (codeTemplatesWindow) {
                codeTemplatesWindow.webContents.send('theme-changed', newSettings.theme);
            }
        }

        logInfo('设置已更新:', settings);
        return { success: true };
    } catch (error) {
        logError('更新设置失败:', error);
        return { success: false, error: error.message };
    }
}

function resetSettings(settingsType = null) {
    try {
        settings = getDefaultSettings();

        saveSettings();

        if (mainWindow) {

            mainWindow.webContents.send('settings-reset', settings);
        }

        logInfo('所有设置已重置为默认值');
        return { success: true, settings };
    } catch (error) {
        logError('重置设置失败:', error);
        return { success: false, error: error.message };
    }
}

function exportSettings(filePath) {
    try {
        const exportData = {
            version: '1.2.1 (v25)',
            timestamp: new Date().toISOString(),
            settings: settings
        };

        fs.writeFileSync(filePath, JSON.stringify(exportData, null, 2), 'utf8');
        logInfo('设置已导出到:', filePath);
        return { success: true };
    } catch (error) {
        logError('导出设置失败:', error);
        return { success: false, error: error.message };
    }
}

function importSettings(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            throw new Error('设置文件不存在');
        }

        const importData = JSON.parse(fs.readFileSync(filePath, 'utf8'));

        if (!importData.settings) {
            throw new Error('无效的设置文件格式');
        }

        const validKeys = ['compilerPath', 'compilerArgs', 'testlibPath', 'font', 'fontSize', 'lineHeight', 'theme', 'tabSize', 'fontLigaturesEnabled', 'enableAutoCompletion', 'foldingEnabled', 'stickyScrollEnabled', 'autoSave', 'autoSaveInterval', 'cppTemplate', 'codeSnippets', 'windowOpacity', 'backgroundImage', 'keybindings'];
        const defaultSettings = getDefaultSettings();

        for (const key of validKeys) {
            if (importData.settings[key] !== undefined) {
                settings[key] = importData.settings[key];
            } else {
                settings[key] = defaultSettings[key];
            }
        }

        saveSettings();

        if (mainWindow) {
            mainWindow.webContents.send('settings-imported', settings);
        }

        logInfo('设置已导入自:', filePath);
        return { success: true, settings: settings };
    } catch (error) {
        logError('导入设置失败:', error);
        return { success: false, error: error.message };
    }
}

async function compileFile(options) {
    const { spawn } = require('child_process');
    const path = require('path');

    const { inputFile, outputFile, compilerPath, compilerArgs, workingDirectory } = options;

    function parseArgsPreservingQuotes(argString) {
        if (!argString || typeof argString !== 'string') return [];
        const args = [];
        let current = '';
        let inQuotes = false;
        let quoteChar = null; // ' or "
        for (let i = 0; i < argString.length; i++) {
            const ch = argString[i];
            if ((ch === '"' || ch === "'") && (!inQuotes || ch === quoteChar)) {
                if (!inQuotes) {
                    inQuotes = true;
                    quoteChar = ch;
                } else {
                    inQuotes = false;
                    quoteChar = null;
                }
                continue;
            }
            if (!inQuotes && /\s/.test(ch)) {
                if (current.length > 0) {
                    args.push(current);
                    current = '';
                }
            } else {
                current += ch;
            }
        }
        if (current.length > 0) args.push(current);
        return args;
    }

    function decodeBufferAuto(buffer) {
        if (!buffer || buffer.length === 0) return '';
        try {
            const encoding = detectEncoding(buffer);
            if (encoding === 'utf8') return buffer.toString('utf8');
        } catch (_) { }
        try {
            const iconv = require('iconv-lite');
            return iconv.decode(buffer, 'gbk');
        } catch (_) {
            return buffer.toString('utf8');
        }
    }

    try {
        if (process.platform === 'win32') {
            if (outputFile) { await killByExePathWindows(outputFile); await killConsolePauserForTargetWindows(outputFile); }
            await killImageWindows('gdb.exe');
        }
    } catch (_) { }

    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        logInfo('开始编译文件:', inputFile);
        logInfo('编译器路径:', compilerPath);
        logInfo('编译参数:', compilerArgs);
        logInfo('输出文件:', outputFile);
        logInfo('工作目录:', workingDirectory);

        if (!fs.existsSync(compilerPath)) {
            logError('编译器文件不存在:', compilerPath);
            logError('当前工作目录:', process.cwd());
            logError('编译器路径是否为绝对路径:', path.isAbsolute(compilerPath));
            reject(new Error(`编译器不存在: ${compilerPath}`));
            return;
        }

        try {
            const stats = fs.statSync(compilerPath);
            logInfo('编译器文件信息:', {
                size: stats.size,
                isFile: stats.isFile(),
                mode: stats.mode.toString(8)
            });
        } catch (statError) {
            logError('无法获取编译器文件信息:', statError);
        }

        const compilerDir = path.dirname(compilerPath);
        const compilerRoot = path.dirname(compilerDir);

        if (!fs.existsSync(inputFile)) {
            reject(new Error(`源文件不存在: ${inputFile}`));
            return;
        }

        let userArgsStr = compilerArgs || '';
        try {
            if (process.platform !== 'win32' && /(^|\s)-static(\s|$)/.test(userArgsStr)) {
                userArgsStr = userArgsStr.replace(/(^|\s)-static(\s|$)/g, ' ').replace(/\s{2,}/g, ' ').trim();
                logInfo('[编译参数] 已在非 Windows 平台移除 -static');
            }
        } catch (_) { }
        const parsedUserArgs = parseArgsPreservingQuotes(userArgsStr).filter(a => a && a.trim());
        const args = [
            ...parsedUserArgs,
            '-o', outputFile,
            inputFile
        ];

        logInfo('编译命令:', compilerPath, args.join(' '));

        const outputDir = path.dirname(outputFile);
        if (!fs.existsSync(outputDir)) {
            logInfo('输出目录不存在，尝试创建:', outputDir);
            try {
                fs.mkdirSync(outputDir, { recursive: true });
                logInfo('输出目录创建成功');
            } catch (mkdirError) {
                logError('创建输出目录失败:', mkdirError);
                reject(new Error(`无法创建输出目录: ${outputDir}`));
                return;
            }
        }

        let mingwBinPaths = [
            compilerDir,
            path.join(compilerRoot, 'bin'),
            path.join(compilerRoot, 'mingw64', 'bin'),
            path.join(compilerRoot, 'mingw32', 'bin')
        ];

        mingwBinPaths = mingwBinPaths.filter(p => fs.existsSync(p));

        const { execSync } = require('child_process');
        let systemPath = process.env.PATH;

        try {
            if (process.platform === 'win32') {
                try {
                    const systemPathCmd = 'reg query "HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment" /v PATH';
                    const systemPathOutput = execSync(systemPathCmd, {
                        encoding: 'utf8',
                        timeout: 5000
                    });

                    const userPathCmd = 'reg query "HKEY_CURRENT_USER\\Environment" /v PATH';
                    let userPathOutput = '';
                    try {
                        userPathOutput = execSync(userPathCmd, {
                            encoding: 'utf8',
                            timeout: 5000
                        });
                    } catch (userError) {
                    }

                    let systemPathValue = '';
                    let userPathValue = '';

                    const systemMatch = systemPathOutput.match(/PATH\s+REG_EXPAND_SZ\s+(.+)/i);
                    if (systemMatch) {
                        systemPathValue = systemMatch[1].trim();
                    }

                    const userMatch = userPathOutput.match(/PATH\s+REG_EXPAND_SZ\s+(.+)/i);
                    if (userMatch) {
                        userPathValue = userMatch[1].trim();
                    }

                    if (systemPathValue) {
                        systemPath = userPathValue ? `${userPathValue};${systemPathValue}` : systemPathValue;
                    }

                } catch (regError) {
                    logInfo('[编译环境] 无法从注册表获取PATH，使用当前进程PATH');
                }
            }
        } catch (error) {
            logInfo('[编译环境] 获取系统PATH失败，使用当前进程PATH');
        }

        const envPath = [...mingwBinPaths, systemPath].join(path.delimiter);

        let includePaths = [];

        if (settings.testlibPath && fs.existsSync(settings.testlibPath)) {
            const testlibDir = path.dirname(settings.testlibPath);
            if (!includePaths.includes(testlibDir)) {
                includePaths.unshift(testlibDir); // 添加到开头，优先级更高
            }
        }

        const ensureExistingDirs = (paths = []) => {
            const existing = [];
            for (const pth of paths) {
                if (!pth) continue;
                try {
                    if (fs.existsSync(pth)) {
                        existing.push(pth);
                    }
                } catch (_) { }
            }
            return existing;
        };

        const mergeEnvPathValue = (extras = [], existingRaw = '') => {
            const result = [];
            const seen = new Set();
            const push = (raw) => {
                if (!raw) return;
                const trimmed = raw.trim();
                if (!trimmed) return;
                const key = process.platform === 'win32' ? trimmed.toLowerCase() : trimmed;
                if (seen.has(key)) return;
                seen.add(key);
                result.push(trimmed);
            };
            extras.forEach(push);
            if (existingRaw) {
                existingRaw.split(path.delimiter).forEach(push);
            }
            return result.join(path.delimiter);
        };

        includePaths = ensureExistingDirs(includePaths);

        const includeEnvValue = mergeEnvPathValue(includePaths, process.env.C_INCLUDE_PATH);
        const cplusIncludeEnvValue = mergeEnvPathValue(includePaths, process.env.CPLUS_INCLUDE_PATH);
        const cpathEnvValue = mergeEnvPathValue(includePaths, process.env.CPATH);
        const libraryCandidates = ensureExistingDirs([
            path.join(compilerRoot, 'lib'),
            path.join(compilerRoot, 'lib64')
        ]);
        const libraryEnvValue = mergeEnvPathValue(libraryCandidates, process.env.LIBRARY_PATH);

        const compilerEnv = {
            ...process.env,
            PATH: envPath,
            MINGW_PREFIX: compilerRoot
        };

        if (includeEnvValue) {
            compilerEnv.C_INCLUDE_PATH = includeEnvValue;
        }
        if (cplusIncludeEnvValue) {
            compilerEnv.CPLUS_INCLUDE_PATH = cplusIncludeEnvValue;
        }
        if (cpathEnvValue) {
            compilerEnv.CPATH = cpathEnvValue;
        }
        if (libraryEnvValue) {
            compilerEnv.LIBRARY_PATH = libraryEnvValue;
        }

        logInfo('[编译环境] PATH路径数量:', mingwBinPaths.length);
        logInfo('[编译环境] C_INCLUDE_PATH:', compilerEnv.C_INCLUDE_PATH);
        logInfo('[编译环境] CPLUS_INCLUDE_PATH:', compilerEnv.CPLUS_INCLUDE_PATH);
        logInfo('[编译环境] LIBRARY_PATH:', compilerEnv.LIBRARY_PATH);

        const compiler = spawn(compilerPath, args, {
            cwd: workingDirectory,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: compilerEnv,
            shell: false // 禁用shell模式以避免路径解析问题
        });

        const stdoutChunks = [];
        const stderrChunks = [];

        compiler.stdout.on('data', (data) => {
            stdoutChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        });

        compiler.stderr.on('data', (data) => {
            stderrChunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
        });

        compiler.on('close', (code) => {
            const stdoutBuf = Buffer.concat(stdoutChunks);
            const stderrBuf = Buffer.concat(stderrChunks);
            const stdout = decodeBufferAuto(stdoutBuf);
            const stderr = decodeBufferAuto(stderrBuf);
            logInfo('编译完成，退出码:', code);
            logInfo('标准输出长度:', stdout.length);
            logInfo('标准错误长度:', stderr.length);
            if (stderr.length > 0) {
                logInfo('标准错误内容:', stderr);
            }
            const elapsed = Date.now() - t0;
            logInfo('编译耗时(ms):', elapsed);

            const outputExists = fs.existsSync(outputFile);

            const result = {
                success: code === 0,
                exitCode: code,
                stdout: stdout,
                stderr: stderr,
                warnings: [],
                errors: [],
                diagnostics: []
            };

            if (code !== 0 && !stderr.trim() && !stdout.trim()) {
                result.errors.push('编译失败，但编译器未提供错误信息。可能的原因：');
                result.errors.push('1. 编译器路径不正确');
                result.errors.push('2. 编译器版本不兼容');
                result.errors.push('3. 系统环境变量配置问题');
                result.errors.push('4. 权限不足');
                result.errors.push(`退出码: ${code}`);
            }

            if (stderr) {
                const lines = stderr.split(/\r?\n/).filter(line => line.trim());

                const parseDiagnostic = (line) => {
                    const m = line.match(/^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.+)$/i);
                    if (m) {
                        const [, file, lineNum, colNum, sevRaw, msg] = m;
                        const sev = /fatal error|error/i.test(sevRaw) ? 'error' : (/warning/i.test(sevRaw) ? 'warning' : 'note');
                        return {
                            file: file,
                            line: parseInt(lineNum, 10) || 1,
                            column: colNum ? parseInt(colNum, 10) : 1,
                            severity: sev,
                            message: msg.trim(),
                            raw: line
                        };
                    }
                    const noteMatch = line.match(/^(.+?):(\d+):(?:(\d+):)?\s*(.+)$/);
                    if (noteMatch && !/error|warning/i.test(line)) {
                        const [, file, lineNum, colNum, msg] = noteMatch;
                        return {
                            file: file,
                            line: parseInt(lineNum, 10) || 1,
                            column: colNum ? parseInt(colNum, 10) : 1,
                            severity: 'note',
                            message: String(msg).trim(),
                            raw: line
                        };
                    }
                    return null;
                };

                for (const line of lines) {
                    const diag = parseDiagnostic(line);
                    if (diag) {
                        result.diagnostics.push(diag);
                        if (diag.severity === 'warning') {
                            result.warnings.push(line);
                        } else if (diag.severity === 'error') {
                            result.errors.push(line);
                        }
                    } else {
                        if (line.toLowerCase().includes('warning')) {
                            result.warnings.push(line);
                        } else if (line.toLowerCase().includes('error') || code !== 0) {
                            result.errors.push(line);
                        }
                    }
                }
            }

            if (process.platform !== 'win32') {
                try {
                    if (fs.existsSync(outputFile)) {
                        const beforeMode = (fs.statSync(outputFile).mode & 0o777).toString(8);
                        let changed = false;
                        if (code === 0) {
                            try {
                                const st = fs.statSync(outputFile);
                                if ((st.mode & 0o111) !== 0o111) { // 任意执行位缺失则赋 755
                                    fs.chmodSync(outputFile, 0o755);
                                    changed = true;
                                }
                            } catch (chmodErr) {
                                logWarn('[编译后] chmod 尝试失败:', chmodErr.message);
                            }
                        } else {
                            logInfo('[编译后] 编译失败，跳过自动 chmod');
                        }
                        const afterMode = fs.existsSync(outputFile) ? (fs.statSync(outputFile).mode & 0o777).toString(8) : 'missing';
                        logInfo('[编译后][权限]', { before: beforeMode, after: afterMode, changed });
                    } else {
                        logWarn('[编译后] 输出文件不存在，无法设置权限');
                    }
                } catch (permErr) {
                    logWarn('[编译后] 权限处理异常:', permErr.message);
                }
            }

            if (code === 0) {
                resolve(result);
            } else {
                resolve(result); // 不要reject，让前端处理编译错误
            }
        });

        compiler.on('error', (error) => {
            logError('编译进程启动失败:', error);
            logError('错误代码:', error.code);
            logError('错误路径:', error.path);
            logError('系统错误号:', error.errno);
            logError('系统调用:', error.syscall);

            let errorMessage = `编译器启动失败: ${error.message}`;
            if (error.code === 'ENOENT') {
                errorMessage += ' (编译器文件不存在或路径错误)';
            } else if (error.code === 'EACCES') {
                errorMessage += ' (权限不足，无法执行编译器)';
            } else if (error.code === 'EPERM') {
                errorMessage += ' (操作被拒绝)';
            }

            reject(new Error(errorMessage));
        });
    });
}

async function runExecutable(options) {
    const { spawn } = require('child_process');
    const path = require('path');

    const { executablePath, workingDirectory } = options;

    function decodeBufferAuto(buffer) {
        if (!buffer || buffer.length === 0) return '';
        try {
            const encoding = detectEncoding(buffer);
            if (encoding === 'utf8') return buffer.toString('utf8');
        } catch (_) { }
        try {
            const iconv = require('iconv-lite');
            return iconv.decode(buffer, 'gbk');
        } catch (_) {
            return buffer.toString('utf8');
        }
    }

    try {
        if (process.platform === 'win32') {
            const abs = require('path').resolve(executablePath);
            await killByExePathWindows(abs);
            await killConsolePauserForTargetWindows(abs);
        }
    } catch (_) { }

    return new Promise((resolve, reject) => {
        logInfo('运行可执行文件:', executablePath);
        logInfo('工作目录:', workingDirectory);

        if (!require('fs').existsSync(executablePath)) {
            reject(new Error(`可执行文件不存在: ${executablePath}`));
            return;
        }

        logInfo('可执行文件路径:', executablePath);
        logInfo('工作目录:', workingDirectory);

        if (process.platform !== 'win32') {
            try {
                const st = fs.statSync(executablePath);
                const modeOct = (st.mode & 0o777).toString(8);
                const hasExec = (st.mode & 0o111) === 0o111;
                logInfo('[运行前][权限]', { mode: modeOct, executableBitsAll: hasExec });
                if (!hasExec) {
                    try {
                        fs.chmodSync(executablePath, 0o755);
                        const after = fs.statSync(executablePath).mode & 0o777;
                        logInfo('[运行前] 已补授执行权限 ->', after.toString(8));
                    } catch (chmodErr) {
                        logWarn('[运行前] 自动 chmod 失败:', chmodErr.message);
                    }
                }
            } catch (preErr) {
                logWarn('[运行前] 权限诊断失败:', preErr.message);
            }
        }

        let command, args, spawnOptions;
        if (process.platform === 'win32') {
            const consolePauserPath = findConsolePauser();

            if (!consolePauserPath) {
                logInfo('错误: 未找到ConsolePauser.exe');
                reject(new Error('未找到ConsolePauser.exe，无法启动程序。请确保ConsolePauser.exe已正确安装。'));
                return;
            }

            command = 'cmd';
            const absoluteExePath = path.resolve(executablePath);
            const absoluteConsolePauserPath = path.resolve(consolePauserPath);

            logInfo('绝对路径 - ConsolePauser:', absoluteConsolePauserPath);
            logInfo('绝对路径 - 可执行文件:', absoluteExePath);

            args = ['/c', `start "Program Running" "${absoluteConsolePauserPath}" "${absoluteExePath}"`];

            let runEnv = { ...process.env };
            const compilerPath = settings && settings.compilerPath;
            if (compilerPath && require('fs').existsSync(compilerPath)) {
                const compilerDir = path.dirname(compilerPath);
                const compilerRoot = path.dirname(compilerDir);

                let mingwBinPaths = [
                    compilerDir,
                    path.join(compilerRoot, 'bin'),
                    path.join(compilerRoot, 'mingw64', 'bin'),
                    path.join(compilerRoot, 'mingw32', 'bin')
                ].filter(p => require('fs').existsSync(p));

                if (mingwBinPaths.length > 0) {
                    runEnv.PATH = [...mingwBinPaths, process.env.PATH].join(path.delimiter);
                }
            }

            spawnOptions = {
                cwd: workingDirectory,
                detached: true,
                stdio: 'ignore',
                shell: true,
                env: runEnv
            };
        } else {
            const fsLocal = require('fs');
            const which = (bin) => {
                try {
                    const { execSync } = require('child_process');
                    execSync(`command -v ${bin}`, { stdio: 'pipe' });
                    return true;
                } catch (_) { return false; }
            };
            const candidates = [
                'gnome-terminal',
                'konsole',
                'xterm',
                'xfce4-terminal',
                'x-terminal-emulator'
            ];
            const picked = candidates.find(c => which(c)) || 'xterm';
            command = picked;
            const absExe = path.resolve(executablePath);
            const cwd = workingDirectory ? path.resolve(workingDirectory) : path.dirname(absExe);
            const bashCmd = `cd \"${cwd.replace(/"/g, '\\"')}\" && \"${absExe.replace(/"/g, '\\"')}\"; echo \"程序执行完成，按回车键继续...\"; read`;
            if (picked === 'gnome-terminal') {
                args = ['--', 'bash', '-c', bashCmd];
            } else if (picked === 'konsole') {
                args = ['-e', 'bash', '-c', bashCmd];
            } else if (picked === 'xfce4-terminal') {
                args = ['-e', `bash -c "${bashCmd.replace(/"/g, '\\"')}"`];
            } else if (picked === 'x-terminal-emulator') {
                args = ['-e', 'bash', '-c', bashCmd];
            } else { // xterm 或其他
                args = ['-e', 'bash', '-c', bashCmd];
            }
            spawnOptions = {
                detached: true,
                stdio: 'ignore'
            };
        }

        logInfo('执行命令:', command);
        logInfo('命令参数:', args);

        try {
            const child = spawn(command, args, spawnOptions);

            child.unref(); // 允许父进程退出而不等待子进程
            child.on('error', (error) => {
                try {
                    let diag = { message: error.message, code: error.code, errno: error.errno, syscall: error.syscall };
                    try {
                        if (fs.existsSync(executablePath)) {
                            const st = fs.statSync(executablePath);
                            diag.targetMode = (st.mode & 0o777).toString(8);
                            diag.size = st.size;
                        } else {
                            diag.targetExists = false;
                        }
                    } catch (_) { }
                    diag.command = command;
                    diag.args = args;
                    diag.cwd = spawnOptions?.cwd;
                    logError('[运行][spawn-error]', diag);
                } catch (_) { }
                reject(new Error(`启动程序失败: ${error.message}`));
            });

            child.on('spawn', () => {
                logInfo('程序启动成功！');
                resolve({ success: true, message: '程序已在新窗口启动' });
            });

            setTimeout(() => {
                if (!child.killed) {
                    logInfo('程序启动中...');
                    resolve({ success: true, message: '程序启动中...' });
                }
            }, 1000);

        } catch (error) {
            logInfo('创建子进程失败:', error.message);
            reject(new Error(`创建子进程失败: ${error.message}`));
        }
    });
}

function compareVersions(currentVersion, latestVersion) {
    if (!latestVersion || !currentVersion) return false;

    const semverRank = (id) => {
        if (id == null) return 0;
        const s = String(id).toLowerCase();
        if (s === 'alpha' || s === 'a') return 1;
        if (s === 'beta' || s === 'b') return 2;
        if (s === 'rc') return 3;
        return 10; // 其他未知标识放在后面，按字典序再比较
    };

    const tokenizePre = (pre) => {
        if (!pre) return [];
        const parts = pre.split('.').flatMap(p => {
            const tokens = p.match(/[a-zA-Z]+|\d+/g);
            return tokens ? tokens : [p];
        });
        return parts.map(tok => (/^\d+$/.test(tok) ? Number(tok) : String(tok)));
    };

    const parse = (v) => {
        const vs = String(v).trim().replace(/^v/i, '');
        const [preBuildSplit] = vs.split('+', 1);
        const coreAndPre = preBuildSplit || vs;
        const hy = coreAndPre.indexOf('-');
        const core = hy >= 0 ? coreAndPre.slice(0, hy) : coreAndPre;
        const pre = hy >= 0 ? coreAndPre.slice(hy + 1) : '';
        const [maj, min, pat] = core.split('.').map(x => parseInt(x, 10) || 0);
        return { core: [maj || 0, min || 0, pat || 0], pre: tokenizePre(pre) };
    };

    const cmpId = (a, b) => {
        const aNum = typeof a === 'number';
        const bNum = typeof b === 'number';
        if (aNum && bNum) return a === b ? 0 : (a < b ? -1 : 1);
        if (aNum && !bNum) return -1; // 数字标识优先级低于非数字
        if (!aNum && bNum) return 1;
        const ra = semverRank(a);
        const rb = semverRank(b);
        if (ra !== rb) return ra < rb ? -1 : 1;
        const as = String(a).toLowerCase();
        const bs = String(b).toLowerCase();
        if (as === bs) return 0;
        return as < bs ? -1 : 1;
    };

    const cmp = (a, b) => {
        const A = parse(a);
        const B = parse(b);
        for (let i = 0; i < 3; i++) {
            if (A.core[i] !== B.core[i]) return A.core[i] < B.core[i] ? -1 : 1;
        }
        const AhasPre = A.pre.length > 0;
        const BhasPre = B.pre.length > 0;
        if (!AhasPre && !BhasPre) return 0;
        if (!AhasPre && BhasPre) return 1;  // A 为正式版，新于带预发布的 B
        if (AhasPre && !BhasPre) return -1; // A 为预发布，旧于正式版 B
        const len = Math.max(A.pre.length, B.pre.length);
        for (let i = 0; i < len; i++) {
            const ai = A.pre[i];
            const bi = B.pre[i];
            if (ai === undefined) return -1; // A 较短，优先级更低
            if (bi === undefined) return 1;  // B 较短
            const r = cmpId(ai, bi);
            if (r !== 0) return r;
        }
        return 0;
    };

    return cmp(latestVersion, currentVersion) > 0;
}

app.whenReady().then(() => {
    app.commandLine.appendSwitch('charset', 'utf-8');
    createWindow();

    handleCommandLineArgs();

    startHeartbeatService();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    stopHeartbeatService();
    app.quit();
});

app.on('before-quit', () => {
    stopHeartbeatService();
    disposeAllFileWatchers();
});

app.on('web-contents-created', (event, contents) => {
    contents.on('new-window', (event, navigationUrl) => {
        event.preventDefault();
        shell.openExternal(navigationUrl);
    });

    contents.on('will-navigate', (event, navigationUrl) => {
        const parsedUrl = new URL(navigationUrl);

        if (parsedUrl.origin !== 'file://') {
            event.preventDefault();
        }
    });

    contents.on('destroyed', () => {
        try { removeRendererWatchers(contents.id); } catch (_) { }
    });
});
function handleCommandLineArgs(argv = process.argv) {
    try {
        const args = Array.isArray(argv) ? argv.slice(1) : [];
        const files = extractSupportedFilesFromArgs(args);
        if (files.length > 0) {
            files.forEach(queueExternalFileOpen);
            processExternalOpenQueue();
        }
    } catch (error) {
        logWarn('处理启动参数失败:', error?.message || error);
    }
}

function isSupportedExternalFile(filePath) {
    if (!filePath || typeof filePath !== 'string') {
        return false;
    }
    try {
        const ext = path.extname(filePath).toLowerCase();
        return EXTERNAL_OPEN_SUPPORTED_EXTENSIONS.has(ext);
    } catch (_) {
        return false;
    }
}

function extractSupportedFilesFromArgs(args = [], options = {}) {
    const results = [];
    if (!Array.isArray(args)) {
        return results;
    }

    const baseDir = (() => {
        if (options && typeof options.workingDirectory === 'string' && options.workingDirectory.trim()) {
            return options.workingDirectory;
        }
        return process.cwd();
    })();

    for (const raw of args) {
        if (!raw || typeof raw !== 'string') {
            continue;
        }

        const trimmed = raw.trim();
        if (!trimmed || trimmed === '.' || trimmed.startsWith('--') || trimmed.startsWith('-psn')) {
            continue;
        }

        const cleaned = trimmed.replace(/^['"]|['"]$/g, '');
        if (!cleaned) {
            continue;
        }

        let candidate = cleaned;
        if (candidate.startsWith('file://')) {
            try {
                const fileUrl = new URL(candidate);
                candidate = fileUrl.pathname || candidate;
            } catch (_) {
            }
        }

        const normalized = normalizeDroppedPath(candidate);
        if (!normalized) {
            continue;
        }

        let resolved = normalized;
        try {
            resolved = path.isAbsolute(normalized)
                ? normalized
                : path.resolve(baseDir, normalized);
        } catch (_) {
            resolved = path.isAbsolute(normalized)
                ? normalized
                : path.join(baseDir, normalized);
        }

        if (!fs.existsSync(resolved)) {
            continue;
        }

        if (!isSupportedExternalFile(resolved)) {
            continue;
        }

        if (!results.includes(resolved)) {
            results.push(resolved);
        }
    }

    return results;
}

function queueExternalFileOpen(filePath) {
    try {
        if (!filePath) {
            return false;
        }

        const normalizedPath = normalizeDroppedPath(filePath);
        if (!normalizedPath || !fs.existsSync(normalizedPath)) {
            logWarn('外部文件不存在，已忽略:', filePath);
            return false;
        }

        if (!isSupportedExternalFile(normalizedPath)) {
            logWarn('外部文件类型不受支持，已忽略:', normalizedPath);
            return false;
        }

        let resolvedPath = normalizedPath;
        try {
            resolvedPath = path.resolve(normalizedPath);
        } catch (_) { }

        if (!pendingExternalOpenQueue.includes(resolvedPath)) {
            pendingExternalOpenQueue.push(resolvedPath);
        }

        skipAutoOpenWorkspace = true;
        processExternalOpenQueue();
        return true;
    } catch (error) {
        logWarn('队列外部文件失败:', error?.message || error);
        return false;
    }
}

async function processExternalOpenQueue() {
    if (processingExternalOpenQueue) {
        return;
    }
    if (!rendererReadyForExternalOpens || !mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    processingExternalOpenQueue = true;
    try {
        while (pendingExternalOpenQueue.length > 0) {
            const nextFile = pendingExternalOpenQueue.shift();
            await openFileFromExternalQueue(nextFile);
        }
    } finally {
        processingExternalOpenQueue = false;
    }
}

async function openFileFromExternalQueue(filePath) {
    if (!filePath) {
        return;
    }

    try {
        if (!fs.existsSync(filePath)) {
            logWarn('外部文件已不存在，跳过:', filePath);
            return;
        }

        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }

        const folderPath = path.dirname(filePath);
        if (folderPath && fs.existsSync(folderPath)) {
            settings.lastOpen = folderPath;
            updateRecentFiles(folderPath);
            saveSettings();
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('folder-opened', folderPath);
            }
            await delay(250);
        }

        const content = await readFileContent(filePath);
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('file-opened-from-args', {
                path: filePath,
                fileName: path.basename(filePath),
                content
            });
        }
    } catch (error) {
        logError('通过外部请求打开文件失败:', error);
        if (mainWindow && !mainWindow.isDestroyed()) {
            try {
                dialog.showErrorBox('打开文件失败', `${path.basename(filePath)}\n${error?.message || error}`);
            } catch (_) { }
        }
    }
}

function delay(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

app.on('open-file', (event, filePath) => {
    event.preventDefault();
    if (queueExternalFileOpen(filePath)) {
        processExternalOpenQueue();
    }
});

logInfo('OICPP IDE 主进程启动完成');



let heartbeatInterval = null;
let deviceInfo = null;

function getLoggedInUser() {
    return settings?.account?.user || null;
}

function getLoggedInUsername() {
    return settings?.account?.user?.username || '';
}

function getLoginToken() {
    return settings?.account?.loginToken || '';
}

function getDeviceInfo() {
    if (!deviceInfo) {
        const cpus = os.cpus();
        const cpuId = cpus.length > 0 ? `CPU-${cpus[0].model.replace(/\s+/g, '-').substring(0, 50)}` : 'CPU-Unknown';
        const deviceName = (process.platform === 'win32' && process.env.COMPUTERNAME)
            ? process.env.COMPUTERNAME
            : (os.hostname() || 'Unknown-Device');

        deviceInfo = {
            deviceName: deviceName,
            cpuId: cpuId
        };
    }
    return deviceInfo;
}

function generateEncodedToken(username = '') {
    const device = getDeviceInfo();
    const sys = process.platform === 'win32' ? 'win' : 'linux';
    const tokenData = `${username}&${device.deviceName}&${device.cpuId}&${sys}`;
    return Buffer.from(tokenData).toString('base64');
}

const CLOUD_SYNC_BASE = 'https://oicpp.mywwzh.top/api';

function buildCloudSyncSignature({ loginToken, method, path, timestamp, nonce, bodyString }) {
    const bodyHash = bodyString ? crypto.createHash('sha256').update(bodyString).digest('hex') : '';
    const payload = [
        String(method || 'GET').toUpperCase(),
        String(path || '/'),
        String(timestamp || ''),
        String(nonce || ''),
        bodyHash
    ].join('\n');
    return crypto.createHmac('sha256', loginToken).update(payload).digest('hex');
}

async function callCloudSyncApi(options = {}) {
    const loginToken = getLoginToken();
    if (!loginToken) {
        return { ok: false, status: 401, error: '未登录' };
    }

    const method = String(options.method || 'GET').toUpperCase();
    const pathRaw = options.path || '/cloudSync/list';
    const pathPart = pathRaw.startsWith('/') ? pathRaw : `/${pathRaw}`;
    const url = new URL(`${CLOUD_SYNC_BASE}${pathPart}`);
    if (options.query && typeof options.query === 'object') {
        for (const [key, value] of Object.entries(options.query)) {
            if (value === undefined || value === null) continue;
            url.searchParams.set(key, String(value));
        }
    }

    let bodyPayload = options.body || {};
    if (method !== 'GET' && method !== 'HEAD') {
        if (typeof bodyPayload !== 'object' || Array.isArray(bodyPayload) || bodyPayload === null) {
            bodyPayload = { data: bodyPayload };
        }
    }

    const bodyString = (method === 'GET' || method === 'HEAD')
        ? ''
        : JSON.stringify(bodyPayload);

    const timestamp = Date.now().toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const signature = buildCloudSyncSignature({
        loginToken,
        method,
        path: `/api${pathPart}`,
        timestamp,
        nonce,
        bodyString
    });

    const headers = {
        'Authorization': loginToken,
        'X-OICPP-Token': generateEncodedToken(getLoggedInUsername()),
        'X-OICPP-Timestamp': timestamp,
        'X-OICPP-Nonce': nonce,
        'X-OICPP-Signature': signature
    };
    if (bodyString) {
        headers['Content-Type'] = 'application/json';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
        try { controller.abort(); } catch (_) { }
    }, 15000);

    try {
        const response = await fetch(url.toString(), {
            method,
            headers,
            body: bodyString || undefined,
            signal: controller.signal
        });
        const text = await response.text();
        let data = null;
        try {
            data = text ? JSON.parse(text) : null;
        } catch (_) {
            data = text;
        }
        return { ok: response.ok, status: response.status, data };
    } catch (error) {
        return { ok: false, status: 0, error: error?.message || String(error) };
    } finally {
        clearTimeout(timeout);
    }
}

async function sendHeartbeat(type = 'heartbeat', username = '') {
    try {
        const actualUsername = (typeof username === 'string' && username.trim()) ? username.trim() : getLoggedInUsername();
        const token = generateEncodedToken(actualUsername || '');
        const device = getDeviceInfo();
        const loginToken = getLoginToken();
        let currentVersion = APP_VERSION;
        try {
            if (app && typeof app.getVersion === 'function') {
                const v = app.getVersion();
                if (typeof v === 'string' && v.length > 0) currentVersion = v;
            }
        } catch (_) { }

        const data = {
            type: type,
            token: token,
            version: currentVersion
        };

        if (loginToken) {
            data.login_token = loginToken;
        }

        if (type === 'start') {
            data.username = actualUsername || '';
            data.device_name = device.deviceName;
            data.cpu_id = device.cpuId;
        }

        const response = await fetch('https://oicpp.mywwzh.top/api/heartbeat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data),
            timeout: 10000 // 10秒超时
        });

        const result = await response.json();
        return result;
    } catch (error) {
        return null;
    }
}

function startHeartbeatService() {
    sendHeartbeat('start', getLoggedInUsername());

    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }

    heartbeatInterval = setInterval(() => {
        sendHeartbeat('heartbeat', getLoggedInUsername());
    }, 30 * 60 * 1000); // 30分钟

}

function stopHeartbeatService() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
}

ipcMain.handle('get-encoded-token', () => {
    try {
        return generateEncodedToken(getLoggedInUsername());
    } catch (e) {
        return '';
    }
});

ipcMain.handle('get-device-info', () => {
    return getDeviceInfo();
});

ipcMain.handle('get-cpu-threads', () => {
    try {
        const cpus = os.cpus();
        const count = Array.isArray(cpus) && cpus.length > 0 ? cpus.length : 2;
        return Math.max(1, count);
    } catch (_) {
        return 2;
    }
});

ipcMain.handle('get-recent-files', () => {
    try {
        if (!Array.isArray(settings.recentFiles)) settings.recentFiles = [];
        let changed = false;
        const seen = new Set();
        const migrated = [];
        for (const item of settings.recentFiles) {
            if (!item || !item.path) continue;
            let p = item.path;
            let exists = false;
            try {
                if (fs.existsSync(p)) {
                    exists = true;
                    const st = fs.statSync(p);
                    if (st.isFile()) {
                        const dir = path.dirname(p);
                        logInfo('[最近列表迁移] 文件路径转换为目录:', p, '->', dir);
                        p = dir; changed = true;
                    }
                } else {
                    logInfo('[最近列表] 路径不存在，已移除:', p);
                    changed = true;
                }
            } catch (_) { 
                logInfo('[最近列表] 路径检查失败，已移除:', p);
                changed = true;
            }
            if (!exists) continue; // 跳过不存在的路径
            if (seen.has(p)) continue; // 去重
            seen.add(p);
            migrated.push({ ...item, path: p, name: path.basename(p) });
        }
        if (changed || migrated.length !== settings.recentFiles.length) {
            settings.recentFiles = migrated;
            saveSettings();
        }
        return settings.recentFiles;
    } catch (e) {
        logWarn('[获取最近文件] 处理失败:', e.message);
        return settings.recentFiles || [];
    }
});

ipcMain.handle('open-recent-file', async (event, filePath) => {
    try {
        if (!filePath || !fs.existsSync(filePath)) return false;
        let targetPath = filePath;
        try {
            const st = fs.statSync(filePath);
            if (st.isFile()) {
                const dir = path.dirname(filePath);
                logInfo('[打开最近] 选择为文件，转换为目录:', filePath, '->', dir);
                targetPath = dir;
            }
        } catch (e) {
            logWarn('[打开最近] stat 失败，直接尝试作为目录:', e.message);
        }
        updateRecentFiles(targetPath);
        saveSettings();
        mainWindow.webContents.send('folder-opened', targetPath);
        return true;
    } catch (err) {
        logError('[打开最近] 失败:', err);
        return false;
    }
});

ipcMain.handle('clipboard-write-text', async (event, text) => {
    try {
        const { clipboard } = require('electron');
        clipboard.writeText(text);
        return { success: true };
    } catch (error) {
        logError('主进程剪贴板写入失败:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('clipboard-read-text', async (event) => {
    try {
        const { clipboard } = require('electron');
        const text = clipboard.readText();
        return { success: true, text };
    } catch (error) {
        logError('主进程剪贴板读取失败:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('save-setting', async (event, key, value) => {
    try {
        settings[key] = value;
        await saveSettings();
        return { success: true };
    } catch (error) {
        logError('保存设置失败:', error);
        return { success: false, error: error.message };
    }
});


async function checkGDBAvailability() {
    return new Promise((resolve) => {
        logInfo('[主进程] 检查GDB可用性...');

        const { spawn } = require('child_process');

        let gdbEnv = { ...process.env };
        const compilerPath = settings.compilerPath || '';
        if (compilerPath && fs.existsSync(compilerPath)) {
            const compilerDir = path.dirname(compilerPath);
            const compilerRoot = path.dirname(compilerDir);

            const mingwBinPaths = [
                compilerDir,
                path.join(compilerRoot, 'bin'),
                path.join(compilerRoot, 'mingw64', 'bin'),
                path.join(compilerRoot, 'mingw32', 'bin')
            ].filter(p => fs.existsSync(p));

            if (mingwBinPaths.length > 0) {
                const envPath = [...mingwBinPaths, process.env.PATH].join(path.delimiter);
                gdbEnv.PATH = envPath;
                logInfo('[主进程] GDB检查已添加环境变量，PATH:', envPath);
            }
        }

        const testProcess = spawn('gdb', ['--version'], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: gdbEnv
        });

        let output = '';
        let hasError = false;

        testProcess.stdout.on('data', (data) => {
            output += data.toString();
        });

        testProcess.stderr.on('data', (data) => {
            hasError = true;
        });

        testProcess.on('close', (code) => {
            if (code === 0 && output.includes('GNU gdb') && !hasError) {
                const versionLine = output.split('\n')[0];
                logInfo('[主进程] GDB可用，版本:', versionLine);
                resolve({
                    available: true,
                    version: versionLine,
                    message: `GDB可用: ${versionLine}`
                });
            } else {
                logInfo('[主进程] GDB不可用，退出码:', code);
                resolve({
                    available: false,
                    message: 'GDB调试器未安装或不可用。请安装GDB调试器以使用调试功能。'
                });
            }
        });

        testProcess.on('error', (error) => {
            logInfo('[主进程] GDB检查出错:', error.message);
            resolve({
                available: false,
                message: `GDB调试器不可用: ${error.message}。请安装GDB调试器以使用调试功能。`
            });
        });

        setTimeout(() => {
            testProcess.kill();
            resolve({
                available: false,
                message: 'GDB检查超时。请确保GDB调试器已正确安装。'
            });
        }, 5000);
    });
}


let gdbDebugger = null;
let pendingWatchExprs = new Set();

function buildPendingWatchPayload(message = '(等待调试开始)') {
    const watchesObj = {};
    try {
        pendingWatchExprs.forEach((expr) => {
            const key = String(expr);
            if (!key) return;
            watchesObj[key] = {
                type: '',
                value: message,
                isArray: false,
                isContainer: false,
                elementCount: null,
                children: []
            };
        });
    } catch (_) { }
    return {
        local: {},
        global: {},
        watches: watchesObj
    };
}

function broadcastPendingWatchSnapshot(event = null, message = '(等待调试开始)') {
    const payload = buildPendingWatchPayload(message);
    try {
        if (event && typeof event.reply === 'function') {
            event.reply('debug-variables-updated', payload);
        }
    } catch (_) { }
    try {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('debug-variables-updated', payload);
        }
    } catch (_) { }
}

async function killImageWindows(imageName) {
    if (process.platform !== 'win32') return;
    try {
        const { spawn } = require('child_process');
        await new Promise((resolve) => {
            const p = spawn('taskkill', ['/F', '/IM', imageName], { stdio: 'ignore', windowsHide: true });
            const to = setTimeout(resolve, 1500);
            p.on('close', () => { clearTimeout(to); resolve(); });
            p.on('error', () => { clearTimeout(to); resolve(); });
        });
    } catch (_) { }
}

async function killByExePathWindows(exePath) {
    if (process.platform !== 'win32') return;
    if (!exePath) return;
    try {
        const { spawn } = require('child_process');
        const escaped = String(exePath).replace(/'/g, "''");
        const ps = `Try { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escaped}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } } Catch {}`;
        await new Promise((resolve) => {
            const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'ignore', windowsHide: true });
            const to = setTimeout(resolve, 2000);
            p.on('close', () => { clearTimeout(to); resolve(); });
            p.on('error', () => { clearTimeout(to); resolve(); });
        });
    } catch (_) { }
}

async function killConsolePauserForTargetWindows(targetExePath) {
    if (process.platform !== 'win32') return;
    if (!targetExePath) return;
    try {
        const { spawn } = require('child_process');
        const escaped = String(targetExePath).replace(/`/g, '``').replace(/'/g, "''");
        const ps = `Try { Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -match 'ConsolePauser\\.exe$' -and $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } } Catch {}`;
        await new Promise((resolve) => {
            const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], { stdio: 'ignore', windowsHide: true });
            const to = setTimeout(resolve, 2000);
            p.on('close', () => { clearTimeout(to); resolve(); });
            p.on('error', () => { clearTimeout(to); resolve(); });
        });
    } catch (_) { }
}

async function startDebugSession(filePath, options = {}) {
    try {
        logInfo('[主进程] 开始调试会话:', filePath);
        logInfo('[主进程] 调试选项:', options);

        const supportedPlatforms = new Set(['win32', 'linux']);
        if (!supportedPlatforms.has(process.platform)) {
            const platformName = process.platform === 'darwin' ? 'macOS' : '当前平台';
            const errorMsg = `调试功能暂未在 ${platformName} 上提供支持。`;
            logWarn(`[主进程] ${errorMsg}`);

            if (mainWindow) {
                mainWindow.webContents.send('debug-error', errorMsg);
            }

            throw new Error(errorMsg);
        }

        if (isDebugging || (gdbDebugger && gdbDebugger.isRunning)) {
            logInfo('[主进程] 停止当前调试会话...');
            await stopDebugSession();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (!fs.existsSync(filePath)) {
            throw new Error(`源文件不存在: ${filePath}`);
        }

        const isWinPlatform = process.platform === 'win32';
        const base = filePath.replace(/\.(cpp|cc|cxx|c)$/i, '');
        let executablePath = isWinPlatform ? base + '.exe' : base;
        if (!isWinPlatform && executablePath.endsWith('.exe')) {
            const noExt = executablePath.slice(0, -4);
            try {
                if (fs.existsSync(noExt) && fs.statSync(noExt).isFile()) {
                    logWarn('[主进程] 发现非 Windows 平台带 .exe 的路径，自动改为无扩展:', noExt);
                    executablePath = noExt;
                }
            } catch (_) { }
        }
        logInfo('[主进程] 可执行文件预期路径:', executablePath);
        if (!isWinPlatform) {
            if (!fs.existsSync(executablePath)) {
                try {
                    const stat = fs.statSync(base);
                    if (stat && stat.isFile()) {
                        executablePath = base; // 已存在无扩展名文件
                    }
                } catch (_) { }
            }
        }

        try {
            await killImageWindows('gdb.exe');
            await killByExePathWindows(executablePath);
            await killConsolePauserForTargetWindows(executablePath);
        } catch (_) { }

        if (!fs.existsSync(executablePath)) {
            throw new Error(`可执行文件不存在: ${executablePath}。请先编译代码（需要包含 -g 参数）。`);
        }

        try {
            const { spawn } = require('child_process');

            let debugEnv = { ...process.env };
            const compilerPath = settings.compilerPath || '';
            if (compilerPath && fs.existsSync(compilerPath)) {
                const compilerDir = path.dirname(compilerPath);
                const compilerRoot = path.dirname(compilerDir);

                const mingwBinPaths = [
                    compilerDir,
                    path.join(compilerRoot, 'bin'),
                    path.join(compilerRoot, 'mingw64', 'bin'),
                    path.join(compilerRoot, 'mingw32', 'bin')
                ].filter(p => fs.existsSync(p));

                if (mingwBinPaths.length > 0) {
                    const envPath = [process.env.PATH, ...mingwBinPaths].join(path.delimiter);
                    debugEnv.PATH = envPath;
                }
            }

            const objdumpProcess = spawn('objdump', ['-h', executablePath], {
                stdio: 'pipe',
                env: debugEnv
            });
            let hasDebugInfo = false;

            objdumpProcess.stdout.on('data', (data) => {
                const output = data.toString();
                if (output.includes('.debug_info') || output.includes('.debug_line')) {
                    hasDebugInfo = true;
                }
            });

            await new Promise((resolve) => {
                objdumpProcess.on('close', resolve);
                setTimeout(resolve, 2000); // 2秒超时
            });

            if (!hasDebugInfo) {
                logWarn('[主进程] 警告：可执行文件可能不包含调试信息');
            }
        } catch (error) {
            logWarn('[主进程] 无法检查调试信息:', error.message);
        }

        logInfo('[主进程] 使用 GDB 调试器');
        gdbDebugger = new GDBDebugger();

        setupDebuggerEvents();

        logInfo('[主进程] 启动调试器...');
        let gdbEnv = { ...process.env };
        try {
            const compilerPath = settings.compilerPath || '';
            if (compilerPath && fs.existsSync(compilerPath)) {
                const compilerDir = path.dirname(compilerPath);
                const compilerRoot = path.dirname(compilerDir);
                const mingwBinPaths = [
                    compilerDir,
                    path.join(compilerRoot, 'bin'),
                    path.join(compilerRoot, 'mingw64', 'bin'),
                    path.join(compilerRoot, 'mingw32', 'bin')
                ].filter(p => fs.existsSync(p));
                if (mingwBinPaths.length > 0) {
                    const envPath = [...mingwBinPaths, process.env.PATH].join(path.delimiter);
                    gdbEnv.PATH = envPath;
                    logInfo('[主进程] 调试启动已注入 PATH，包含编译器目录数量:', mingwBinPaths.length);
                }
            }
        } catch (e) { logWarn('[主进程] 构造 GDB 环境失败:', e?.message || String(e)); }
        try {
            await gdbDebugger.start(executablePath, filePath, { env: gdbEnv });
        } catch (err) {
            logError('[主进程] 调试器启动失败:', err);
            throw err;
        }

        let hasBreakpoints = false;
        if (options.breakpoints && options.breakpoints.length > 0) {
            logInfo('[主进程] 设置断点:', options.breakpoints);
            for (const breakpoint of options.breakpoints) {
                try {
                    if (typeof breakpoint === 'object' && breakpoint.line) {
                        await gdbDebugger.setBreakpoint(filePath, breakpoint.line);
                        logInfo(`[主进程] 断点设置成功: ${filePath}:${breakpoint.line}`);
                        hasBreakpoints = true;
                    } else if (typeof breakpoint === 'number') {
                        await gdbDebugger.setBreakpoint(filePath, breakpoint);
                        logInfo(`[主进程] 断点设置成功: ${filePath}:${breakpoint}`);
                        hasBreakpoints = true;
                    }
                } catch (error) {
                    logWarn('[主进程] 设置断点失败:', error.message);
                }
            }
        }

        logInfo('[主进程] 调试器已就绪，等待用户操作...');
        logInfo(`[主进程] 已设置断点数量: ${hasBreakpoints ? '有断点' : '无断点'}`);

        if (mainWindow) {
            mainWindow.webContents.send('debug-ready-waiting', {
                hasBreakpoints: hasBreakpoints,
                message: hasBreakpoints ?
                    '调试器已启动，程序已加载断点，点击继续执行开始调试' :
                    '调试器已启动，程序已准备就绪，点击继续执行开始运行'
            });
        }

        isDebugging = true;
        currentOpenFile = filePath;
        debugSessionRootDir = path.dirname(filePath);
        autoSkipInternalCounter = 0;
        lastDebugCommand = null;

        logInfo('[主进程] 调试会话启动成功');
        return {
            success: true,
            file: filePath,
            executable: executablePath,
            process: gdbDebugger.gdbProcess ? gdbDebugger.gdbProcess.pid : null
        };

    } catch (error) {
        logError('[主进程] 启动调试会话失败:', error);
        isDebugging = false;
        if (gdbDebugger) {
            try {
                await gdbDebugger.stop();
            } catch (stopError) {
                logError('[主进程] 停止调试器失败:', stopError);
            }
        }
        gdbDebugger = null;
        debugSessionRootDir = null;
        lastDebugCommand = null;
        autoSkipInternalCounter = 0;

        if (mainWindow) {
            mainWindow.webContents.send('debug-error', error.message);
        }

        throw error;
    }
}

async function stopDebugSession() {
    try {
        logInfo('停止调试会话');

        if (gdbDebugger && gdbDebugger.isRunning) {
            await gdbDebugger.stop();
            await new Promise(r => setTimeout(r, 200));
        }

        isDebugging = false;
        gdbDebugger = null;
        currentOpenFile = null;
        debugSessionRootDir = null;
        lastDebugCommand = null;
        autoSkipInternalCounter = 0;
        broadcastPendingWatchSnapshot();

        logInfo('调试会话已停止');
        return { success: true };

    } catch (error) {
        logError('停止调试会话失败:', error);
        isDebugging = false;
        gdbDebugger = null;
        debugSessionRootDir = null;
        lastDebugCommand = null;
        autoSkipInternalCounter = 0;
        throw error;
    }
}

function setupDebuggerEvents() {
    if (!gdbDebugger) return;

    logInfo('[主进程] 设置调试器事件监听...');

    gdbDebugger.on('started', (data) => {
        logInfo('[主进程] 调试器已启动:', data);
        if (mainWindow) {
            mainWindow.webContents.send('debug-started', data);
        }
        if (pendingWatchExprs && pendingWatchExprs.size > 0) {
            const toApply = Array.from(pendingWatchExprs);
            (async () => {
                for (const expr of toApply) {
                    try { await gdbDebugger.addWatchVariable(expr); } catch (e) { try { logWarn('[主进程] 应用缓冲监视失败:', expr, e?.message || String(e)); } catch (_) { } }
                }
                try {
                    await gdbDebugger.updateVariables();
                    const vars = gdbDebugger.getVariables();
                    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('debug-variables-updated', vars);
                } catch (_) { }
            })();
        }
    });

    let lastUpdateAt = 0;
    let refreshChain = Promise.resolve();

    const queueDebuggerRefresh = () => {
        if (!gdbDebugger || !gdbDebugger.isRunning || gdbDebugger.programExited) {
            return;
        }
        const targetDebugger = gdbDebugger;
        refreshChain = refreshChain.then(async () => {
            if (!targetDebugger || targetDebugger !== gdbDebugger) return;
            if (!targetDebugger.isRunning || targetDebugger.programExited) return;
            const now = Date.now();
            const gap = now - lastUpdateAt;
            const delay = gap >= 250 ? 0 : (250 - gap);
            if (delay > 0) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            lastUpdateAt = Date.now();
            let variables = null;
            try {
                variables = await getDebugVariables();
            } catch (e) {
                logWarn('[主进程] 获取变量失败:', e);
            }
            if (variables) {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    try { mainWindow.webContents.send('debug-variables-updated', variables); } catch (_) { }
                }
            } else {
                broadcastCurrentVariablesSnapshot();
            }
            let callStack = null;
            try {
                callStack = await getDebugCallStack();
            } catch (e) {
                logWarn('[主进程] 获取调用栈失败:', e);
            }
            if (callStack && mainWindow && !mainWindow.isDestroyed()) {
                try { mainWindow.webContents.send('debug-callstack-updated', callStack); } catch (_) { }
            }
        }).catch((err) => {
            logWarn('[主进程] 调试刷新链执行失败:', err?.message || err);
        });
    };

    gdbDebugger.on('stopped', (data) => {
        logInfo('[主进程] 程序已停止:', data);
        const reason = String(data?.reason || '').toLowerCase();
        const frameFile = data?.frame?.file || '';
        const eligible = lastDebugCommand && AUTO_SKIP_ELIGIBLE_COMMANDS.has(lastDebugCommand);
        const autoSkipReason = reason === 'end-stepping-range' || reason === 'location-reached' || reason === 'function-finished';
        const outsideUserCode = isFrameOutsideUserCode(frameFile);

        if (eligible && autoSkipReason && outsideUserCode && autoSkipInternalCounter < AUTO_SKIP_INTERNAL_LIMIT) {
            const retryCommand = lastDebugCommand;
            autoSkipInternalCounter += 1;
            logInfo(`[主进程] 检测到内部暂停(${reason})，frame=${frameFile || '未知'}，自动重试 ${retryCommand} (${autoSkipInternalCounter}/${AUTO_SKIP_INTERNAL_LIMIT})`);
            setTimeout(() => {
                if (!gdbDebugger || !gdbDebugger.isRunning || gdbDebugger.programExited) {
                    return;
                }
                sendDebugCommand(retryCommand).catch((err) => {
                    logWarn(`[主进程] 自动重试命令 ${retryCommand} 失败: ${err?.message || err}`);
                });
            }, 0);
            return;
        }

        if (eligible && autoSkipReason && outsideUserCode && autoSkipInternalCounter >= AUTO_SKIP_INTERNAL_LIMIT) {
            logWarn(`[主进程] 自动跳过达到上限，保留暂停状态。reason=${reason}, frame=${frameFile || '未知'}`);
        }

        autoSkipInternalCounter = 0;
        lastDebugCommand = null;
        if (mainWindow) {
            mainWindow.webContents.send('debug-stopped', data);

            const isPaused = !reason.includes('exit');
            if (isPaused) {
                logInfo('[主进程] 程序暂停，更新变量和调用栈');
                queueDebuggerRefresh();
            } else {
                logInfo('[主进程] 程序已退出，跳过变量和调用栈更新');
            }
        }
    });

    gdbDebugger.on('running', () => {
        logInfo('[主进程] 程序正在运行...');
        if (mainWindow) {
            mainWindow.webContents.send('debug-running');
        }
    });

    gdbDebugger.on('error', (error) => {
        logError('[主进程] 调试器错误:', error);
        if (mainWindow) {
            mainWindow.webContents.send('debug-error', error);
        }
    });

    gdbDebugger.on('exited', (data) => {
        logInfo('[主进程] 调试器进程退出:', data);
        isDebugging = false;
        debugSessionRootDir = null;
        lastDebugCommand = null;
        autoSkipInternalCounter = 0;
        try {
            if (gdbDebugger && typeof gdbDebugger.getVariables === 'function') {
                const vars = gdbDebugger.getVariables() || {};
                pendingWatchExprs = new Set(Object.keys(vars.watches || {}));
            }
        } catch (_) { }
        broadcastPendingWatchSnapshot();
        if (mainWindow) {
            mainWindow.webContents.send('debug-stopped', {
                exitCode: data.code,
                signal: data.signal,
                reason: 'exited'
            });
        }
    });

    gdbDebugger.on('breakpoint-set', (data) => {
        logInfo('[主进程] 断点已设置:', data);
        if (mainWindow) {
            mainWindow.webContents.send('debug-breakpoint-set', data);
        }
    });

    gdbDebugger.on('breakpoint-removed', (data) => {
        logInfo('[主进程] 断点已移除:', data);
        if (mainWindow) {
            mainWindow.webContents.send('debug-breakpoint-removed', data);
        }
    });

    gdbDebugger.on('breakpoint-hit', (data) => {
        logInfo('[主进程] 断点命中:', data);
        if (mainWindow) {
            mainWindow.webContents.send('debug-breakpoint-hit', data);
            try {
                if (!mainWindow.isDestroyed()) {
                    mainWindow.setAlwaysOnTop(true, 'screen-saver');
                    mainWindow.show();
                    mainWindow.focus();
                    setTimeout(() => {
                        try { if (!mainWindow.isDestroyed()) mainWindow.setAlwaysOnTop(false); } catch (_) { }
                    }, 600);
                }
            } catch (e) { try { logWarn('[主进程] 置顶聚焦失败:', e?.message || String(e)); } catch (_) { } }
        }
    });

    gdbDebugger.on('variables-updated', (data) => {
        logInfo('[主进程] 变量已更新');
        if (mainWindow) {
            mainWindow.webContents.send('debug-variables-updated', data);
        }
    });

    gdbDebugger.on('callstack-updated', (data) => {
        logInfo('[主进程] 调用栈已更新');
        if (mainWindow) {
            mainWindow.webContents.send('debug-callstack-updated', data);
        }
    });

    gdbDebugger.on('program-exited', (data) => {
        logInfo('[主进程] 程序退出事件:', data);
        if (mainWindow) {
            mainWindow.webContents.send('debug-program-exited', data);
            setTimeout(() => {
                mainWindow.webContents.send('debug-stopped', {
                    reason: 'program-exited',
                    exitCode: data.exitCode
                });
            }, 100);
        }
    });

    logInfo('[主进程] 调试器事件监听已设置完成');
}

async function sendDebugCommand(command) {
    if (!gdbDebugger || !gdbDebugger.isRunning) {
        throw new Error('调试器未运行');
    }
    if (gdbDebugger.programExited) {
        throw new Error('程序已结束');
    }
    lastDebugCommand = command;
    try {
        logInfo(`[主进程] 执行调试命令: ${command}`);

        switch (command) {
            case 'continue':
                try { await gdbDebugger.run(); logInfo('[主进程] 程序已启动'); }
                catch (error) {
                    const msg = String(error?.message || error || '').toLowerCase();
                    if (/running|already\s*running|already\s*started|not\s*stopped/.test(msg)) {
                        logInfo('[主进程] 程序已在运行（run 报 running），忽略错误');
                    } else {
                        try { await gdbDebugger.continue(); }
                        catch (err2) {
                            const msg2 = String(err2?.message || err2 || '').toLowerCase();
                            if (/running|not\s*stopped/.test(msg2)) {
                                logInfo('[主进程] 程序处于 running/非暂停状态（continue 报错），忽略');
                            } else { throw err2; }
                        }
                    }
                }
                break;
            case 'step':
                await gdbDebugger.stepOver();
                break;
            case 'stepi':
                await gdbDebugger.stepInto();
                break;
            case 'finish':
                await gdbDebugger.stepOut();
                break;
            default:
                throw new Error(`未知的调试命令: ${command}`);
        }

        return { success: true };

    } catch (error) {
        logError('[主进程] 发送调试命令失败:', error);
        lastDebugCommand = null;
        throw error;
    }
}

async function sendDebugInput(input) {
    if (!gdbDebugger || !gdbDebugger.isRunning) {
        throw new Error('调试器未运行');
    }

    try {
        await gdbDebugger.sendInput(input);
        return { success: true };

    } catch (error) {
        logError('发送调试输入失败:', error);
        throw error;
    }
}

async function addBreakpoint(breakpoint) {
    logInfo('[主进程] 添加断点:', breakpoint);

    if (!gdbDebugger || !gdbDebugger.isRunning) {
        throw new Error('调试器未运行');
    }

    try {
        if (!breakpoint.file || !breakpoint.line) {
            throw new Error('断点参数不完整');
        }

        await gdbDebugger.setBreakpoint(breakpoint.file, breakpoint.line);

        const breakpointKey = `${breakpoint.file}:${breakpoint.line}`;
        breakpoints.set(breakpointKey, {
            file: breakpoint.file,
            line: breakpoint.line,
            enabled: true
        });

        logInfo('[主进程] 断点添加成功:', breakpointKey);
        return { success: true, file: breakpoint.file, line: breakpoint.line };

    } catch (error) {
        logError('[主进程] 添加断点失败:', error);
        throw error;
    }
}

async function removeBreakpoint(breakpoint) {
    logInfo('[主进程] 移除断点:', breakpoint);

    if (!gdbDebugger || !gdbDebugger.isRunning) {
        throw new Error('调试器未运行');
    }

    try {
        if (!breakpoint.file || !breakpoint.line) {
            throw new Error('断点参数不完整');
        }

        const breakpointKey = `${breakpoint.file}:${breakpoint.line}`;

        const gdbBreakpoints = gdbDebugger.getBreakpoints();
        let breakpointNumber = null;

        for (const bp of gdbBreakpoints) {
            if (bp.file === breakpoint.file && bp.line === breakpoint.line) {
                breakpointNumber = bp.number;
                break;
            }
        }

        if (breakpointNumber) {
            await gdbDebugger.removeBreakpoint(breakpointNumber);
            logInfo(`[主进程] 移除断点 #${breakpointNumber}: ${breakpointKey}`);
        } else {
            logWarn(`[主进程] 未找到断点: ${breakpointKey}`);
        }

        breakpoints.delete(breakpointKey);

        logInfo('[主进程] 断点移除成功:', breakpointKey);
        return { success: true, file: breakpoint.file, line: breakpoint.line };

    } catch (error) {
        logError('[主进程] 移除断点失败:', error);
        throw error;
    }
}

async function getDebugVariables() {
    if (!gdbDebugger || !gdbDebugger.isRunning) {
        throw new Error('调试器未运行');
    }

    try {
        const updated = await gdbDebugger.updateVariables();
        const variables = gdbDebugger.getVariables();
        return {
            local: variables.local || {},
            global: variables.global || {},
            watches: variables.watches || {}
        };
    } catch (error) {
        logError('获取调试变量失败:', error);
        throw error;
    }
}

async function getDebugCallStack() {
    if (!gdbDebugger || !gdbDebugger.isRunning) {
        throw new Error('调试器未运行');
    }

    try {
        await gdbDebugger.updateCallStack();
        return gdbDebugger.getCallStack();

    } catch (error) {
        logError('获取调用堆栈失败:', error);
        throw error;
    }
}
