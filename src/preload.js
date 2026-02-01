const { contextBridge, ipcRenderer, shell, clipboard } = require('electron');
const path = require('path');

const showToast = (message, type = 'info', durationMs = 1200) => {
    try {
        const safeMsg = String(message ?? '');
        const safeType = ['info', 'success', 'error', 'warning'].includes(type) ? type : 'info';
        const dur = Number.isFinite(durationMs) ? durationMs : 1200;

        const ensure = () => {
            const existing = document.querySelector('.message-toast');
            if (existing) return existing;
            const div = document.createElement('div');
            div.className = 'message-toast info';
            div.style.pointerEvents = 'none';
            document.body.appendChild(div);
            return div;
        };

        const show = () => {
            const toast = ensure();
            toast.className = `message-toast ${safeType}`;
            toast.textContent = safeMsg;
            toast.style.display = 'block';
            clearTimeout(toast.__hideTimer);
            toast.__hideTimer = setTimeout(() => {
                try {
                    toast.style.display = 'none';
                } catch (_) { }
            }, dur);
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', show, { once: true });
        } else {
            show();
        }
    } catch (_) {
    }
};

let md = null;
let TurndownService = null;
let turndownInstance = null;

const normalizeMarkdownMath = (input) => {
    if (!input || typeof input !== 'string') return input;

    const normalizeInlineMathInLine = (line) => {
        let out = '';
        let inCode = false;
        let codeFence = '';
        let i = 0;

        while (i < line.length) {
            const ch = line[i];
            if (ch === '`') {
                let count = 1;
                while (i + count < line.length && line[i + count] === '`') {
                    count++;
                }
                const fence = '`'.repeat(count);
                if (!inCode) {
                    inCode = true;
                    codeFence = fence;
                } else if (fence === codeFence) {
                    inCode = false;
                    codeFence = '';
                }
                out += fence;
                i += count;
                continue;
            }

            if (!inCode && ch === '$') {
                const next = line[i + 1];
                if (next === '$' || (i > 0 && line[i - 1] === '\\')) {
                    out += ch;
                    i += 1;
                    continue;
                }
                let j = i + 1;
                while (j < line.length) {
                    if (line[j] === '$' && line[j - 1] !== '\\') {
                        break;
                    }
                    j += 1;
                }
                if (j < line.length && line[j] === '$') {
                    const content = line.slice(i + 1, j);
                    const trimmed = content.replace(/^\s+|\s+$/g, '');
                    out += `$${trimmed.length ? trimmed : content}$`;
                    i = j + 1;
                    continue;
                }
            }

            out += ch;
            i += 1;
        }

        return out;
    };

    const lines = input.split('\n');
    let inFence = false;
    let fenceMarker = '';
    let inMathBlock = false;

    for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        const fenceMatch = line.match(/^\s{0,3}(```+|~~~+)/);
        if (fenceMatch) {
            const marker = fenceMatch[1][0];
            if (!inFence) {
                inFence = true;
                fenceMarker = marker;
            } else if (marker === fenceMarker) {
                inFence = false;
                fenceMarker = '';
            }
            continue;
        }
        if (!inFence) {
            const mathFenceMatch = line.match(/^\s*\$\$\s*$/);
            if (mathFenceMatch) {
                inMathBlock = !inMathBlock;
                lines[idx] = '$$';
                continue;
            }
            if (inMathBlock) {
                let normalized = line.trim();
                normalized = normalized
                    .replace(/\\begin\{align\*?\}/g, '\\begin{aligned}')
                    .replace(/\\end\{align\*?\}/g, '\\end{aligned}');
                lines[idx] = normalized;
                continue;
            }
            lines[idx] = normalizeInlineMathInLine(line);
        }
    }

    return lines.join('\n');
};

try {
    TurndownService = require('turndown');
    turndownInstance = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        fence: '```',
        emDelimiter: '*',
        strongDelimiter: '**',
        linkStyle: 'inlined',
    });

    turndownInstance.addRule('taskListItem', {
        filter: function (node) {
            return node.nodeName === 'LI' && 
                   node.classList.contains('task-list-item');
        },
        replacement: function (content, node) {
            const checkbox = node.querySelector('input[type="checkbox"]');
            const checked = checkbox && checkbox.checked;
            const prefix = checked ? '- [x] ' : '- [ ] ';
            return prefix + content.trim().replace(/^\[[ x]\]\s*/i, '') + '\n';
        }
    });

    turndownInstance.addRule('fencedCodeBlock', {
        filter: function (node) {
            return (
                node.nodeName === 'PRE' &&
                node.firstChild &&
                node.firstChild.nodeName === 'CODE'
            );
        },
        replacement: function (content, node, options) {
            const code = node.firstChild;
            const className = code.getAttribute('class') || '';
            const langMatch = className.match(/language-(\S+)/);
            const lang = langMatch ? langMatch[1] : '';
            const fence = options.fence;
            
            return '\n\n' + fence + lang + '\n' + code.textContent + '\n' + fence + '\n\n';
        }
    });

    turndownInstance.addRule('hljsCodeBlock', {
        filter: function (node) {
            return (
                node.nodeName === 'PRE' &&
                node.classList.contains('hljs')
            );
        },
        replacement: function (content, node, options) {
            const codeText = node.textContent || '';
            return '\n\n```\n' + codeText + '\n```\n\n';
        }
    });
    turndownInstance.addRule('ignoreCopyButton', {
        filter: function (node) {
            return node.nodeName === 'BUTTON' && 
                   node.classList.contains('copy-code-btn');
        },
        replacement: function () {
            return '';
        }
    });

    turndownInstance.addRule('codeBlockWrapper', {
        filter: function (node) {
            return node.nodeName === 'DIV' && 
                   node.classList.contains('code-block-wrapper');
        },
        replacement: function (content, node, options) {
            const pre = node.querySelector('pre');
            if (pre) {
                const codeText = pre.textContent || '';
                return '\n\n```\n' + codeText + '\n```\n\n';
            }
            return content;
        }
    });

} catch (e) {
    console.error('Failed to initialize Turndown:', e);
}

try {
    const MarkdownIt = require('markdown-it');
    const mk = require('@iktakahiro/markdown-it-katex');
    const taskLists = require('markdown-it-task-lists');
    const imageFigures = require('markdown-it-image-figures');
    const hljs = require('highlight.js');

    md = new MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
        highlight: function (str, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return '<pre class="hljs"><code>' +
                           hljs.highlight(str, { language: lang, ignoreIllegals: true }).value +
                           '</code></pre>';
                } catch (__) {}
            }
            return '<pre class="hljs"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
        }
    })
    .use(mk, {
        throwOnError: false,
        strict: 'ignore'
    })
    .use(taskLists)
    .use(imageFigures, {
        figcaption: true
    });

    const defaultFence = md.renderer.rules.fence || function(tokens, idx, options, env, self) {
        return self.renderToken(tokens, idx, options);
    };

    md.renderer.rules.fence = function (tokens, idx, options, env, self) {
        const token = tokens[idx];
        const code = token.content;
        const lang = token.info.trim();
        
        let highlighted;
        try {
            if (lang && hljs.getLanguage(lang)) {
                highlighted = '<pre class="hljs"><code>' +
                              hljs.highlight(code, { language: lang, ignoreIllegals: true }).value +
                              '</code></pre>';
            } else {
                highlighted = '<pre class="hljs"><code>' +
                              hljs.highlightAuto(code).value +
                              '</code></pre>';
            }
        } catch (__) {
            highlighted = '<pre class="hljs"><code>' + md.utils.escapeHtml(code) + '</code></pre>';
        }
        const encodedCode = encodeURIComponent(code);

        return `<div class="code-block-wrapper" style="position: relative;">
            <button class="copy-code-btn" type="button" data-code="${encodedCode}"
                    style="position: absolute; top: 5px; right: 5px; z-index: 10; padding: 4px 8px; background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); border-radius: 4px; color: inherit; cursor: pointer; font-size: 12px;">
                Copy
            </button>
            ${highlighted}
        </div>`;
    };

} catch (e) {
    console.error('Failed to initialize markdown-it:', e);
}

contextBridge.exposeInMainWorld('markdownAPI', {
    render: (text, filePath) => {
        if (!md) return text;
        try {
            const normalizedText = normalizeMarkdownMath(text || '');
            const defaultImageRender = md.renderer.rules.image || function(tokens, idx, options, env, self) {
                return self.renderToken(tokens, idx, options);
            };

            md.renderer.rules.image = function (tokens, idx, options, env, self) {
                const token = tokens[idx];
                const srcIndex = token.attrIndex('src');
                if (srcIndex >= 0) {
                    let src = token.attrs[srcIndex][1];
                    if (src && !src.startsWith('http') && !src.startsWith('https:') && !src.startsWith('data:') && !src.startsWith('file:')) {
                        if (filePath) {
                            const dir = path.dirname(filePath);
                            if (!path.isAbsolute(src)) {
                                src = path.join(dir, src);
                            }
                            src = src.replace(/\\/g, '/');
                            if (!src.startsWith('/')) {
                                src = '/' + src;
                            }
                            token.attrs[srcIndex][1] = `file://${src}`;
                        }
                    }
                }
                return defaultImageRender(tokens, idx, options, env, self);
            };
            return md.render(normalizedText);
        } catch (err) {
            console.error('Markdown render error:', err);
            return text;
        }
    }
});

contextBridge.exposeInMainWorld('turndownAPI', {
    toMarkdown: (html) => {
        if (!turndownInstance) {
            console.warn('Turndown not initialized, returning plain text');
            const temp = document.createElement('div');
            temp.innerHTML = html;
            return temp.textContent || temp.innerText || '';
        }
        try {
            return turndownInstance.turndown(html);
        } catch (err) {
            console.error('Turndown error:', err);
            const temp = document.createElement('div');
            temp.innerHTML = html;
            return temp.textContent || temp.innerText || '';
        }
    }
});

if (globalThis.__oicppPreloadInitialized) {
    return;
}
globalThis.__oicppPreloadInitialized = true;

try {
    window.addEventListener('click', async (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLElement)) return;
        const btn = target.closest('.copy-code-btn');
        if (!(btn instanceof HTMLElement)) return;
        const encoded = btn.getAttribute('data-code');
        if (!encoded) return;

        ev.preventDefault();
        ev.stopPropagation();

        let text = '';
        try {
            text = decodeURIComponent(encoded);
        } catch (_) {
            text = encoded;
        }

        try {
            if (window.electronAPI && typeof window.electronAPI.clipboardWriteText === 'function') {
                await window.electronAPI.clipboardWriteText(text);
            } else {
                ipcRenderer.invoke('clipboard-write-text', text);
            }
            showToast('已复制到剪贴板', 'success', 1200);
        } catch (err) {
            showToast('复制失败', 'error', 1600);
            try { console.error('Copy code failed:', err); } catch (_) { }
        }
    }, true);
} catch (_) { }

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

    getCpuThreads: () => ipcRenderer.invoke('get-cpu-threads'),

    sendFeedback: (message) => ipcRenderer.invoke('send-feedback', message),
    getDeviceInfo: () => ipcRenderer.invoke('get-device-info'),
    getEncodedToken: () => ipcRenderer.invoke('get-encoded-token'),

    openExternal: (url) => ipcRenderer.invoke('open-external', url),

    startIdeLogin: () => ipcRenderer.invoke('ide-login-start'),
    getIdeLoginStatus: () => ipcRenderer.invoke('ide-login-status'),
    logoutIdeAccount: () => ipcRenderer.invoke('ide-logout'),
    cloudSyncRequest: (payload) => ipcRenderer.invoke('cloud-sync-request', payload),
    onIdeLoginUpdated: (callback) => ipcRenderer.on('ide-login-updated', (_event, payload) => callback && callback(payload)),
    onIdeLoginError: (callback) => ipcRenderer.on('ide-login-error', (_event, payload) => callback && callback(payload)),

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