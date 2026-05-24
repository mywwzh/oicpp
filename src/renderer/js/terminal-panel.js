class IntegratedTerminalPanel {
    constructor(options = {}) {
        this.getApp = typeof options.getApp === 'function' ? options.getApp : () => null;
        this.sessions = new Map();
        this.activeId = null;
        this.visible = false;
        this.initialized = false;
        this.status = { available: false, reason: '', detail: '' };

        this.panel = null;
        this.resizer = null;
        this.tabs = null;
        this.body = null;
        this.empty = null;
        this.statusNode = null;
        this.newBtn = null;
        this.hideBtn = null;
        this.counter = 0;
        this.panelHeight = 290;
        this._dragState = null;
        this.fixedTerminalFontSize = 14;

        this._resizeObserver = null;
    }

    async init() {
        if (this.initialized) {
            return;
        }

        this.panel = document.getElementById('integrated-terminal-panel');
        this.resizer = document.getElementById('integrated-terminal-resizer');
        this.tabs = document.getElementById('integrated-terminal-tabs');
        this.body = document.getElementById('integrated-terminal-body');
        this.empty = document.getElementById('integrated-terminal-empty');
        this.statusNode = document.getElementById('integrated-terminal-status');
        this.newBtn = document.getElementById('integrated-terminal-new');
        this.hideBtn = document.getElementById('integrated-terminal-hide');

        if (!this.panel || !this.resizer || !this.tabs || !this.body) {
            return;
        }

        this.bindEvents();
        await this.refreshFeatureStatus();
        this.initialized = true;
    }

    bindEvents() {
        this.newBtn?.addEventListener('click', () => {
            this.open({ createIfNone: true, forceCreate: true });
        });

        this.hideBtn?.addEventListener('click', () => {
            this.setVisible(false);
        });

        this.resizer?.addEventListener('pointerdown', (event) => {
            this.startResizeDrag(event);
        });

        if (window.electronAPI?.onTerminalData) {
            window.electronAPI.onTerminalData((payload) => {
                this.handleTerminalData(payload);
            });
        }

        if (window.electronAPI?.onTerminalExit) {
            window.electronAPI.onTerminalExit((payload) => {
                this.handleTerminalExit(payload);
            });
        }

        this._resizeObserver = new ResizeObserver(() => {
            this.fitActiveTerminal();
        });
        this._resizeObserver.observe(this.panel);

        window.addEventListener('resize', () => {
            this.fitActiveTerminal();
        });
    }

    startResizeDrag(event) {
        if (!this.panel || !this.visible) {
            return;
        }

        this._dragState = {
            startY: event.clientY,
            startHeight: this.panel.getBoundingClientRect().height
        };

        this.resizer.classList.add('dragging');
        this.resizer.setPointerCapture(event.pointerId);

        const onMove = (moveEvent) => {
            if (!this._dragState) {
                return;
            }
            const delta = this._dragState.startY - moveEvent.clientY;
            const nextHeight = this._dragState.startHeight + delta;
            this.setPanelHeight(nextHeight);
            this.fitActiveTerminal();
        };

        const stop = () => {
            this._dragState = null;
            this.resizer.classList.remove('dragging');
            this.resizer.removeEventListener('pointermove', onMove);
            this.resizer.removeEventListener('pointerup', stop);
            this.resizer.removeEventListener('pointercancel', stop);
        };

        this.resizer.addEventListener('pointermove', onMove);
        this.resizer.addEventListener('pointerup', stop);
        this.resizer.addEventListener('pointercancel', stop);
    }

    setPanelHeight(height) {
        if (!this.panel) {
            return;
        }
        const viewportHeight = window.innerHeight || 900;
        const minHeight = 160;
        const maxHeight = Math.max(minHeight + 40, Math.floor(viewportHeight * 0.72));
        const next = Math.max(minHeight, Math.min(maxHeight, Math.round(Number(height) || this.panelHeight)));
        this.panelHeight = next;
        this.panel.style.height = `${next}px`;
    }

    async refreshFeatureStatus() {
        if (!window.electronAPI?.getTerminalFeatureStatus) {
            this.status = {
                available: false,
                reason: '终端接口不可用',
                detail: '预加载层未暴露终端接口'
            };
            this.renderStatus();
            return this.status;
        }

        try {
            const status = await window.electronAPI.getTerminalFeatureStatus();
            this.status = status || { available: false, reason: '未知错误', detail: '' };
        } catch (error) {
            this.status = {
                available: false,
                reason: '获取终端状态失败',
                detail: error?.message || String(error)
            };
        }

        this.renderStatus();
        return this.status;
    }

    renderStatus() {
        // Status line intentionally removed from UI.
    }

    async open(options = {}) {
        await this.init();
        await this.refreshFeatureStatus();

        this.setVisible(true);

        if (!this.status.available) {
            this.renderEmptyState();
            return null;
        }

        const forceCreate = !!options.forceCreate;
        const createIfNone = options.createIfNone !== false;

        if (forceCreate || (createIfNone && this.sessions.size === 0)) {
            return await this.createTerminal();
        }

        this.renderEmptyState();
        this.fitActiveTerminal();
        return this.activeId || null;
    }

    setVisible(visible) {
        this.visible = !!visible;
        if (!this.panel) {
            return;
        }

        this.panel.classList.toggle('collapsed', !this.visible);
        if (this.visible) {
            this.setPanelHeight(this.panelHeight);
            this.fitActiveTerminal();
        }
    }

    resolveTerminalFontOptions() {
        const app = this.getApp ? this.getApp() : null;
        const settings = app?.settings || {};
        const fontFamily = (typeof settings.font === 'string' && settings.font.trim())
            ? settings.font.trim()
            : 'Consolas';
        const configuredFontSize = Number(settings.terminalFontSize);
        const fontSize = Number.isFinite(configuredFontSize) && configuredFontSize > 0
            ? Math.round(configuredFontSize)
            : this.fixedTerminalFontSize;
        return { fontFamily, fontSize };
    }

    getCurrentThemeName() {
        const app = this.getApp ? this.getApp() : null;
        const theme = app?.settings?.theme;
        return typeof theme === 'string' && theme.trim() ? theme.trim() : 'dark';
    }

    isLightThemeActive() {
        return this.getCurrentThemeName().toLowerCase().includes('light');
    }

    resolveTerminalTheme() {
        if (this.isLightThemeActive()) {
            return {
                background: 'rgba(0,0,0,0)',
                foreground: '#1f2328',
                cursor: '#0b57d0',
                cursorAccent: '#ffffff',
                selectionBackground: 'rgba(9, 105, 218, 0.45)',
                selectionForeground: '#ffffff'
            };
        }

        return {
            background: 'rgba(0,0,0,0)',
            foreground: '#d0d0d0',
            cursor: '#c8c8c8',
            cursorAccent: '#111111',
            selectionBackground: 'rgba(90, 170, 255, 0.35)',
            selectionForeground: '#ffffff'
        };
    }

    applyThemeSettings() {
        const lightTheme = this.isLightThemeActive();
        if (this.panel) {
            this.panel.classList.toggle('terminal-theme-light', lightTheme);
        }

        const xtermTheme = this.resolveTerminalTheme();
        for (const session of this.sessions.values()) {
            try {
                session.terminal.options.theme = xtermTheme;
                session.terminal.refresh(0, session.terminal.rows - 1);
            } catch (_) { }
        }
    }

    applyTerminalFontSettings() {
        const { fontFamily, fontSize } = this.resolveTerminalFontOptions();
        for (const session of this.sessions.values()) {
            try {
                session.terminal.options.fontFamily = fontFamily;
                session.terminal.options.fontSize = fontSize;
                session.fitAddon.fit();
                if (session.remoteId) {
                    window.electronAPI.resizeTerminal(session.remoteId, session.terminal.cols, session.terminal.rows);
                }
            } catch (_) { }
        }
    }

    // Keep backward compatibility with older call sites.
    applyEditorFontSettings() {
        this.applyTerminalFontSettings();
    }

    async createTerminal(options = {}) {
        if (!this.status.available) {
            this.renderEmptyState();
            return;
        }

        if (typeof window.Terminal !== 'function') {
            this.status = {
                available: false,
                reason: 'xterm 未加载',
                detail: '请确认已安装 xterm 依赖'
            };
            this.renderStatus();
            this.renderEmptyState();
            return;
        }

        const fitAddonCtor = window.FitAddon?.FitAddon;
        if (typeof fitAddonCtor !== 'function') {
            this.status = {
                available: false,
                reason: 'xterm Fit 插件未加载',
                detail: '请确认已安装 xterm-addon-fit'
            };
            this.renderStatus();
            this.renderEmptyState();
            return;
        }

        this.counter += 1;
        const tabId = `terminal-local-${Date.now()}-${this.counter}`;

        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'integrated-terminal-tab pending';
        tab.dataset.terminalId = tabId;
        tab.innerHTML = `<span class="terminal-tab-label">终端 ${this.counter}</span><span class="terminal-tab-close" aria-label="关闭终端">×</span>`;

        const pane = document.createElement('div');
        pane.className = 'integrated-terminal-pane';
        pane.dataset.terminalId = tabId;

        const mount = document.createElement('div');
        mount.className = 'integrated-terminal-mount';
        pane.appendChild(mount);

        this.tabs.appendChild(tab);
        this.body.appendChild(pane);

        const fontOptions = this.resolveTerminalFontOptions();

        const terminal = new window.Terminal({
            cursorBlink: true,
            fontSize: fontOptions.fontSize,
            fontFamily: fontOptions.fontFamily,
            convertEol: true,
            scrollback: 8000,
            allowTransparency: true,
            theme: this.resolveTerminalTheme()
        });
        const fitAddon = new fitAddonCtor();
        terminal.loadAddon(fitAddon);
        terminal.open(mount);
        fitAddon.fit();

        const provisionalSession = {
            terminalId: tabId,
            tab,
            pane,
            mount,
            terminal,
            fitAddon,
            remoteId: null,
            cwd: null,
            shell: null,
            inputBridge: null,
            muteRemoteOutput: false
        };

        this.sessions.set(tabId, provisionalSession);
        this.bindTabEvents(tabId);

        this.activateTerminal(tabId);

        const createPayload = {
            cols: terminal.cols,
            rows: terminal.rows,
            cwd: options.cwd || await this.getPreferredCwd()
        };

        let created;
        try {
            created = await window.electronAPI.createTerminal(createPayload);
        } catch (error) {
            terminal.writeln('\r\n[Error] 创建终端失败: ' + (error?.message || String(error)));
            tab.classList.remove('pending');
            this.renderEmptyState();
            return;
        }

        if (!created?.ok || !created?.terminalId) {
            terminal.writeln(`\r\n[Error] ${created?.error || '终端创建失败'}`);
            tab.classList.remove('pending');
            this.renderEmptyState();
            return;
        }

        const remoteId = created.terminalId;
        provisionalSession.remoteId = remoteId;
        provisionalSession.cwd = created.cwd || null;
        provisionalSession.shell = created.shell || null;

        const labelNode = tab.querySelector('.terminal-tab-label');
        if (labelNode) {
            labelNode.textContent = `终端 ${this.sessions.size}`;
        }

        tab.classList.remove('pending');
        tab.dataset.terminalId = remoteId;
        pane.dataset.terminalId = remoteId;

        this.sessions.delete(tabId);
        this.sessions.set(remoteId, provisionalSession);

        if (this.activeId === tabId) {
            this.activeId = remoteId;
        }

        terminal.onData((data) => {
            if (!provisionalSession.remoteId) {
                return;
            }
            if (typeof provisionalSession.inputBridge === 'function') {
                this.echoBridgedInput(provisionalSession, String(data || ''));
                try {
                    provisionalSession.inputBridge(String(data || ''));
                } catch (_) {
                }
                return;
            }
            window.electronAPI.writeTerminal(provisionalSession.remoteId, data);
        });

        this.setupTerminalClipboardShortcuts(terminal, provisionalSession);
        this.setupTerminalLinkProvider(terminal);
        this.shieldTerminalKeyEvents(mount, provisionalSession);

        await this.initializeSessionEncodingIfNeeded(provisionalSession);

        this.fitTerminal(remoteId);
        this.applyThemeSettings();
        this.renderEmptyState();
        return remoteId;
    }

    shieldTerminalKeyEvents(mountNode, sessionRef = null) {
        if (!mountNode || mountNode._terminalKeyShielded) {
            return;
        }

        const sendInput = async (text) => {
            const session = sessionRef;
            const remoteId = session?.remoteId;
            if (!remoteId || !text) {
                return;
            }

            if (typeof session.inputBridge === 'function') {
                this.echoBridgedInput(session, String(text));
                try {
                    session.inputBridge(String(text));
                } catch (_) {
                }
                return;
            }

            try {
                await window.electronAPI?.writeTerminal?.(remoteId, String(text));
            } catch (_) {
            }
        };

        mountNode.addEventListener('keydown', (event) => {
            const key = String(event?.key || '').toLowerCase();
            const ctrl = !!event.ctrlKey;
            const meta = !!event.metaKey;
            const alt = !!event.altKey;
            const shift = !!event.shiftKey;
            const ctrlOrMeta = ctrl || meta;
            const shiftOnly = shift && !ctrl && !meta && !alt;

            // ---- 终端复制/粘贴快捷键（比 xterm attachCustomKeyEventHandler 更早拦截） ----
            const session = sessionRef;
            const term = session?.terminal;
            const hasSelection = term && typeof term.getSelection === 'function' && !!term.getSelection();
            const wantsCopy = (ctrlOrMeta && key === 'c' && (shift || hasSelection))
                || (ctrlOrMeta && key === 'insert');
            const wantsPaste = (ctrlOrMeta && key === 'v')
                || (shiftOnly && key === 'insert');

            if (wantsCopy) {
                event.preventDefault();
                event.stopPropagation();
                const sel = term && typeof term.getSelection === 'function' ? term.getSelection() : '';
                this.copyTextToClipboard(sel);
                return;
            }

            if (wantsPaste) {
                event.preventDefault();
                event.stopPropagation();
                const remoteId = session?.remoteId;
                if (remoteId) {
                    this.pasteClipboardToTerminal(remoteId);
                }
                return;
            }

            // Ensure terminal input is not stolen by focus traversal or global handlers.
            if (key === 'tab' && !ctrl && !meta && !alt) {
                event.preventDefault();
                event.stopPropagation();
                const seq = shift ? '\u001b[Z]' : '\t';
                sendInput(seq);
                return;
            }

            if (!ctrl && !meta && !alt && (key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright')) {
                event.preventDefault();
                event.stopPropagation();
                const map = {
                    arrowup: '\u001b[A',
                    arrowdown: '\u001b[B',
                    arrowright: '\u001b[C',
                    arrowleft: '\u001b[D'
                };
                sendInput(map[key] || '');
                return;
            }
            // Let xterm handle all other keys (e.g. Backspace/Delete/Ctrl combinations).
        }, true);

        mountNode.addEventListener('wheel', (event) => {
            event.preventDefault();
            event.stopPropagation();

            const session = sessionRef;
            if (!session?.terminal || typeof session.terminal.scrollLines !== 'function') {
                return;
            }

            const deltaY = Number(event.deltaY) || 0;
            if (deltaY === 0) {
                return;
            }

            const lines = Math.max(1, Math.min(6, Math.round(Math.abs(deltaY) / 36)));
            session.terminal.scrollLines(deltaY > 0 ? lines : -lines);
        }, true);

        mountNode._terminalKeyShielded = true;
    }

    async initializeSessionEncodingIfNeeded(session) {
        const terminalId = session?.remoteId;
        if (!terminalId || !window.electronAPI?.getPlatform || !window.electronAPI?.writeTerminal) {
            return;
        }

        let platform = '';
        try {
            platform = String(await window.electronAPI.getPlatform() || '').toLowerCase();
        } catch (_) {
            return;
        }

        if (platform !== 'windows') {
            return;
        }

        const shell = String(session?.shell || '').toLowerCase();
        let initCmd = 'chcp 65001 > nul\r';
        if (shell.includes('powershell') || shell.includes('pwsh')) {
            initCmd = '[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);chcp 65001 > $null\r';
        }

        try {
            await window.electronAPI.writeTerminal(terminalId, initCmd);
        } catch (_) {
        }
    }

    setupTerminalLinkProvider(terminal) {
        if (!terminal || typeof terminal.registerLinkProvider !== 'function') {
            return;
        }

        const urlPattern = /\b(?:https?:\/\/|www\.)[^\s<>"'()\[\]{}]+/gi;

        terminal.registerLinkProvider({
            provideLinks: (bufferLineNumber, callback) => {
                const line = terminal.buffer?.active?.getLine?.(bufferLineNumber - 1);
                if (!line || typeof line.translateToString !== 'function') {
                    callback(undefined);
                    return;
                }

                const lineText = line.translateToString(true);
                if (!lineText) {
                    callback(undefined);
                    return;
                }

                const links = [];
                for (const match of lineText.matchAll(urlPattern)) {
                    const rawText = String(match[0] || '').replace(/[).,!?;:]+$/, '');
                    if (!rawText) {
                        continue;
                    }

                    const startIndex = match.index || 0;
                    const endIndex = startIndex + rawText.length;
                    const range = this.resolveTerminalLinkRange(line, startIndex, endIndex, bufferLineNumber);
                    if (!range) {
                        continue;
                    }

                    links.push({
                        text: rawText,
                        range,
                        activate: (event, text) => {
                            if (!(event?.ctrlKey || event?.metaKey)) {
                                return;
                            }
                            const resolvedUrl = this.normalizeTerminalUrl(text || rawText);
                            if (resolvedUrl) {
                                this.openExternalUrl(resolvedUrl);
                            }
                        }
                    });
                }

                callback(links.length > 0 ? links : undefined);
            }
        });
    }

    resolveTerminalLinkRange(line, startIndex, endIndex, bufferLineNumber) {
        if (!line || typeof line.getCell !== 'function' || startIndex < 0 || endIndex <= startIndex) {
            return null;
        }

        let textOffset = 0;
        let columnOffset = 0;
        let startColumn = null;
        let endColumn = null;
        const lineLength = Number(line.length) || 0;

        for (let cellIndex = 0; cellIndex < lineLength; cellIndex++) {
            const cell = line.getCell(cellIndex);
            if (!cell || typeof cell.getChars !== 'function') {
                columnOffset += 1;
                continue;
            }

            const chars = String(cell.getChars() || '');
            const width = typeof cell.getWidth === 'function' ? Number(cell.getWidth()) : 1;
            const displayWidth = Number.isFinite(width) && width > 0 ? width : 0;

            if (startColumn === null && startIndex >= textOffset && startIndex < textOffset + chars.length) {
                startColumn = columnOffset;
            }

            if (endColumn === null && endIndex <= textOffset + chars.length) {
                endColumn = columnOffset + displayWidth;
            }

            textOffset += chars.length;
            columnOffset += displayWidth;

            if (startColumn !== null && endColumn !== null) {
                break;
            }
        }

        if (startColumn === null) {
            return null;
        }

        if (endColumn === null || endColumn < startColumn) {
            endColumn = startColumn + Math.max(1, endIndex - startIndex);
        }

        return {
            start: { x: startColumn + 1, y: bufferLineNumber },
            end: { x: endColumn, y: bufferLineNumber }
        };
    }

    normalizeTerminalUrl(text) {
        const value = String(text || '').trim();
        if (!value) {
            return '';
        }

        if (/^www\./i.test(value)) {
            try {
                return new URL(`https://${value}`).href;
            } catch (_) {
                return '';
            }
        }

        if (/^[a-z][a-z0-9+.-]*:/i.test(value)) {
            try {
                const parsedUrl = new URL(value);
                if (['http:', 'https:', 'mailto:', 'file:'].includes(parsedUrl.protocol)) {
                    return parsedUrl.href;
                }
            } catch (_) {
            }
            return '';
        }

        try {
            return new URL(value, window.location.href).href;
        } catch (_) {
            return '';
        }
    }

    async openExternalUrl(url) {
        const targetUrl = String(url || '').trim();
        if (!targetUrl) {
            return;
        }

        try {
            if (window.electronAPI && typeof window.electronAPI.openExternal === 'function') {
                await window.electronAPI.openExternal(targetUrl);
            } else if (window.electron && window.electron.shell && typeof window.electron.shell.openExternal === 'function') {
                window.electron.shell.openExternal(targetUrl);
            } else if (typeof window.open === 'function') {
                window.open(targetUrl, '_blank', 'noopener');
            }
        } catch (_) {
        }
    }

    setupTerminalClipboardShortcuts(terminal, sessionRef) {
        if (!terminal || typeof terminal.attachCustomKeyEventHandler !== 'function') {
            return;
        }

        terminal.attachCustomKeyEventHandler((event) => {
            if (!event || event.type !== 'keydown') {
                return true;
            }

            const key = String(event.key || '').toLowerCase();
            const ctrlOrMeta = !!(event.ctrlKey || event.metaKey);
            const shiftOnly = !!event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
            if (!ctrlOrMeta && !shiftOnly) {
                return true;
            }

            const hasSelection = typeof terminal.getSelection === 'function' && !!terminal.getSelection();
            const wantsCopy = (ctrlOrMeta && key === 'c' && (event.shiftKey || hasSelection))
                || (ctrlOrMeta && key === 'insert');
            const wantsPaste = (ctrlOrMeta && key === 'v')
                || (shiftOnly && key === 'insert');

            if (wantsCopy) {
                event.preventDefault();
                this.copyTextToClipboard(terminal.getSelection ? terminal.getSelection() : '');
                return false;
            }

            if (wantsPaste) {
                event.preventDefault();
                const terminalId = sessionRef?.remoteId;
                if (terminalId) {
                    this.pasteClipboardToTerminal(terminalId);
                }
                return false;
            }

            return true;
        });
    }

    async copyTextToClipboard(text) {
        const value = String(text || '');
        if (!value) {
            return;
        }
        try {
            await navigator.clipboard.writeText(value);
            return;
        } catch (_) { }

        try {
            const result = await window.electronAPI?.clipboardWriteText?.(value);
            if (result?.success) {
                return;
            }
        } catch (_) { }
    }

    async pasteClipboardToTerminal(terminalId) {
        let text = '';
        try {
            text = await navigator.clipboard.readText();
        } catch (_) { }

        if (!text) {
            try {
                const result = await window.electronAPI?.clipboardReadText?.();
                text = result?.success ? String(result.text || '') : '';
            } catch (_) { }
        }

        if (!text) {
            return;
        }

        // 调试输入桥接模式：通过 inputBridge 发送，确保粘贴内容到达被调试程序
        const session = this.sessions.get(terminalId);
        if (session && typeof session.inputBridge === 'function') {
            this.echoBridgedInput(session, text);
            try {
                session.inputBridge(text);
            } catch (_) { }
            return;
        }

        try {
            await window.electronAPI.writeTerminal(terminalId, text);
        } catch (_) { }
    }

    quoteExecutableForShell(executablePath, platform) {
        const text = String(executablePath || '');
        if (platform === 'windows') {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return `'${text.replace(/'/g, `'\\''`)}'`;
    }

    buildRunCommandForShell(executablePath, shellPath, platform) {
        const shell = String(shellPath || '').toLowerCase();
        const quoted = this.quoteExecutableForShell(executablePath, platform);
        if (platform === 'windows' && shell.includes('powershell')) {
            return `& ${quoted}\r`;
        }
        if (platform === 'macos' || platform === 'linux') {
            return `${quoted}; printf '\\n'\r`;
        }
        return `${quoted}\r`;
    }

    async runExecutableInNewTerminal(executablePath, options = {}) {
        if (!executablePath) {
            throw new Error('可执行文件路径为空');
        }

        await this.init();
        await this.refreshFeatureStatus();
        this.setVisible(true);
        if (!this.status.available) {
            throw new Error(this.status.reason || '终端功能不可用');
        }

        const cwd = options.workingDirectory || await this.getPreferredCwd();
        const terminalId = await this.createTerminal({ cwd });
        if (!terminalId) {
            throw new Error('创建内置终端失败');
        }

        this.activateTerminal(terminalId);

        let platform = 'windows';
        try {
            if (window.electronAPI?.getPlatform) {
                platform = await window.electronAPI.getPlatform();
            }
        } catch (_) { }

        const session = this.sessions.get(terminalId);
        const command = this.buildRunCommandForShell(executablePath, session?.shell || '', platform);
        await window.electronAPI.writeTerminal(terminalId, command);
        return terminalId;
    }

    bindTabEvents(terminalId) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            return;
        }

        session.tab.addEventListener('click', (event) => {
            const closeBtn = event.target.closest('.terminal-tab-close');
            if (closeBtn) {
                event.preventDefault();
                event.stopPropagation();
                this.closeTerminal(session.remoteId || terminalId);
                return;
            }
            this.activateTerminal(session.remoteId || terminalId);
        });
    }

    activateTerminal(terminalId) {
        this.activeId = terminalId;

        for (const [id, session] of this.sessions.entries()) {
            const active = id === terminalId;
            session.tab.classList.toggle('active', active);
            session.pane.classList.toggle('active', active);
        }

        this.fitActiveTerminal();
        this.focusTerminal(terminalId);
    }

    focusTerminal(terminalId) {
        const session = this.sessions.get(terminalId);
        if (!session || !session.terminal) {
            return false;
        }
        try {
            session.terminal.focus();
            return true;
        } catch (_) {
            return false;
        }
    }

    echoBridgedInput(session, data) {
        if (!session || !session.terminal || typeof data !== 'string' || !data) {
            return;
        }

        let out = '';
        for (const ch of data) {
            if (ch === '\r' || ch === '\n') {
                out += '\r\n';
                continue;
            }
            if (ch === '\u007f' || ch === '\b') {
                out += '\b \b';
                continue;
            }
            const code = ch.charCodeAt(0);
            if (code >= 0x20 || ch === '\t') {
                out += ch;
            }
        }

        if (!out) {
            return;
        }

        try {
            session.terminal.write(out);
        } catch (_) {
        }
    }

    handleTerminalData(payload) {
        const terminalId = payload?.terminalId;
        const data = payload?.data;
        if (!terminalId || typeof data !== 'string') {
            return;
        }

        const session = this.sessions.get(terminalId);
        if (!session) {
            return;
        }

        if (session.muteRemoteOutput) {
            return;
        }

        session.terminal.write(data);
    }

    setInputBridge(terminalId, bridgeHandler) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            return false;
        }
        session.inputBridge = typeof bridgeHandler === 'function' ? bridgeHandler : null;
        return true;
    }

    clearInputBridge(terminalId) {
        return this.setInputBridge(terminalId, null);
    }

    setRemoteOutputMuted(terminalId, muted) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            return false;
        }
        session.muteRemoteOutput = !!muted;
        return true;
    }

    writeTerminalOutput(terminalId, data) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            return false;
        }
        try {
            session.terminal.write(String(data ?? ''));
            return true;
        } catch (_) {
            return false;
        }
    }

    handleTerminalExit(payload) {
        const terminalId = payload?.terminalId;
        if (!terminalId) {
            return;
        }

        const session = this.sessions.get(terminalId);
        if (!session) {
            return;
        }

        const code = payload?.exitCode;
        const signal = payload?.signal;
        const suffix = Number.isFinite(code)
            ? `退出码 ${code}`
            : (signal ? `信号 ${signal}` : '已退出');
        session.terminal.writeln(`\r\n[终端已退出] ${suffix}`);
        session.tab.classList.add('exited');
    }

    async closeTerminal(terminalId) {
        const session = this.sessions.get(terminalId);
        if (!session) {
            return;
        }

        if (session.remoteId) {
            try {
                await window.electronAPI.killTerminal(session.remoteId);
            } catch (_) {}
        }

        try {
            session.terminal.dispose();
        } catch (_) {}

        session.tab.remove();
        session.pane.remove();
        this.sessions.delete(terminalId);

        if (this.activeId === terminalId) {
            const first = this.sessions.keys().next();
            this.activeId = first.done ? null : first.value;
            if (this.activeId) {
                this.activateTerminal(this.activeId);
            }
        }

        this.renderEmptyState();
    }

    renderEmptyState() {
        if (!this.empty) {
            return;
        }

        if (!this.visible) {
            this.empty.style.display = 'none';
            return;
        }

        if (!this.status.available) {
            this.empty.style.display = 'flex';
            this.empty.textContent = this.formatUnavailableStatusText();
            return;
        }

        if (this.sessions.size === 0) {
            this.empty.style.display = 'flex';
            this.empty.textContent = '点击“新建终端”开始使用内置终端';
            return;
        }

        this.empty.style.display = 'none';
    }

    formatUnavailableStatusText() {
        const reason = String(this.status?.reason || '终端功能不可用').trim();
        const detailRaw = this.status?.detail == null ? '' : String(this.status.detail).trim();

        if (!detailRaw) {
            return reason;
        }

        let detail = detailRaw
            .replace(/\s*Require stack:\s*/i, '\nRequire stack:\n')
            .replace(/\s+-\s+/g, '\n- ')
            .replace(/\s+尝试位置:\s*/g, '\n尝试位置: ');

        return `${reason}\n${detail}`;
    }

    fitActiveTerminal() {
        if (!this.activeId) {
            return;
        }
        this.fitTerminal(this.activeId);
    }

    fitTerminal(terminalId) {
        const session = this.sessions.get(terminalId);
        if (!session || !this.visible) {
            return;
        }

        try {
            session.fitAddon.fit();
            if (session.remoteId) {
                window.electronAPI.resizeTerminal(session.remoteId, session.terminal.cols, session.terminal.rows);
            }
        } catch (_) {}
    }

    async getPreferredCwd() {
        const app = this.getApp();
        if (!app || typeof app.getActiveFilePath !== 'function') {
            return undefined;
        }
        const active = app.getActiveFilePath();
        if (!active || app.isCloudFilePath?.(active)) {
            return undefined;
        }
        if (typeof window.electronAPI?.pathDirname !== 'function') {
            return undefined;
        }
        try {
            return await window.electronAPI.pathDirname(active);
        } catch (_) {
            return undefined;
        }
    }
}

window.IntegratedTerminalPanel = IntegratedTerminalPanel;
