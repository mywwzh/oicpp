class TitlebarManager {
    constructor() {
        this.titlebar = null;
        this.currentTitle = 'OICPP IDE';
        this.isMaximized = false;
        this._closeConfirmInProgress = false;
        this.init();
    }

    init() {
        this.setupTitlebar();
        this.setupWindowControls();
        this.setupElectronEvents();
        logInfo('标题栏管理器已初始化');
    }

    setupTitlebar() {
        this.titlebar = document.querySelector('.titlebar');
        if (!this.titlebar) {
            this.titlebar = document.createElement('div');
            this.titlebar.className = 'titlebar';
            this.titlebar.innerHTML = `
                <div class="titlebar-left">
                    <div class="titlebar-title">${this.currentTitle}</div>
                </div>
                <div class="titlebar-right">
                    <div class="titlebar-controls">
                        <button class="titlebar-button minimize" title="最小化">
                            <span class="icon">&#x2212;</span>
                        </button>
                        <button class="titlebar-button maximize" title="最大化">
                            <span class="icon">&#x2610;</span>
                        </button>
                        <button class="titlebar-button close" title="关闭">
                            <span class="icon">&#x2715;</span>
                        </button>
                    </div>
                </div>
            `;
            document.body.insertBefore(this.titlebar, document.body.firstChild);
        }
    }

    setupWindowControls() {
    if (!window.electronIPC && typeof require === 'undefined') {
            logWarn('不在 Electron 环境中，跳过窗口控制设置');
            return;
        }
        setTimeout(() => {
            const minimizeBtn = document.getElementById('minimize-btn');
            if (minimizeBtn) {
                minimizeBtn.addEventListener('click', () => {
                    logInfo('点击最小化按钮');
                    if (window.electronIPC) {
                        window.electronIPC.send('window-minimize');
                    }
                });
            }

            const maximizeBtn = document.getElementById('maximize-btn');
            if (maximizeBtn) {
                maximizeBtn.addEventListener('click', () => {
                    logInfo('点击最大化按钮, 当前状态:', this.isMaximized);
                    if (window.electronIPC) {
                        if (this.isMaximized) {
                            window.electronIPC.send('window-unmaximize');
                        } else {
                            window.electronIPC.send('window-maximize');
                        }
                    }
                });
            }

            const closeBtn = document.getElementById('close-btn');
            if (closeBtn) {
                closeBtn.addEventListener('click', async () => {
                    logInfo('点击关闭按钮');
                    await this.requestClose();
                });
            }
        }, 100);
    }

    _escapeHtml(text) {
        try {
            const div = document.createElement('div');
            div.textContent = String(text ?? '');
            return div.innerHTML;
        } catch (_) {
            return String(text ?? '');
        }
    }

    async requestClose() {
        return this._requestCloseInternal({ source: 'button' });
    }

    async _requestCloseInternal({ source } = { source: 'button' }) {
        if (this._closeConfirmInProgress) return;
        if (!window.electronIPC) return;

        const unsavedFiles = (() => {
            try {
                if (window.tabManager && typeof window.tabManager.getUnsavedFiles === 'function') {
                    return window.tabManager.getUnsavedFiles() || [];
                }
            } catch (_) { }
            return [];
        })();

        if (!unsavedFiles || unsavedFiles.length === 0) {
            if (source === 'system') {
                window.electronIPC.send('app-close-confirmed');
            } else {
                window.electronIPC.send('window-close');
            }
            return;
        }

        if (!window.dialogManager || typeof window.dialogManager.showConfirmDialog !== 'function') {
            logWarn('dialogManager 不可用，已阻止关闭以避免无提示自动保存');
            if (source === 'system') {
                try { window.electronIPC.send('app-close-cancelled'); } catch (_) { }
            }
            return;
        }

        this._closeConfirmInProgress = true;
        try {
            const maxShow = 8;
            const shown = unsavedFiles.slice(0, maxShow);
            const moreCount = Math.max(0, unsavedFiles.length - shown.length);

            const listHtml = shown
                .map(name => `- ${this._escapeHtml(name)}`)
                .join('<br>');
            const moreHtml = moreCount > 0 ? `<br>... 还有 ${moreCount} 个文件` : '';

            const message = `检测到 ${unsavedFiles.length} 个未保存文件：<br>${listHtml}${moreHtml}<br><br>关闭将自动保存以上修改并退出。是否继续？`;
            const result = await window.dialogManager.showConfirmDialog('确认退出', message);
            if (result) {
                if (source === 'system') {
                    window.electronIPC.send('app-close-confirmed');
                } else {
                    window.electronIPC.send('window-close');
                }
            } else {
                if (source === 'system') {
                    window.electronIPC.send('app-close-cancelled');
                }
            }
        } finally {
            this._closeConfirmInProgress = false;
        }
    }

    setupElectronEvents() {
        if (window.electronIPC) {
            window.electronIPC.on('window-maximized', () => {
                logInfo('窗口已最大化');
                this.isMaximized = true;
                this.updateMaximizeButton();
            });

            window.electronIPC.on('window-unmaximized', () => {
                logInfo('窗口已还原');
                this.isMaximized = false;
                this.updateMaximizeButton();
            });

            window.electronIPC.on('app-close-requested', async () => {
                try {
                    await this._requestCloseInternal({ source: 'system' });
                } catch (e) {
                    try {
                        logWarn('处理 app-close-requested 失败，已取消关闭:', e);
                        window.electronIPC.send('app-close-cancelled');
                    } catch (_) { }
                }
            });
        }
    }

    updateMaximizeButton() {
        const maximizeBtn = document.getElementById('maximize-btn');
        if (maximizeBtn) {
            const svg = maximizeBtn.querySelector('svg path');
            if (svg) {
                if (this.isMaximized) {
                    svg.setAttribute('d', 'M2 2h6v6H2V2zM4 4h6v6H4V4z');
                    maximizeBtn.title = '还原';
                } else {
                    svg.setAttribute('d', 'M2 2h8v8H2V2z');
                    maximizeBtn.title = '最大化';
                }
            }
        }
    }

    setTitle(title) {
        this.currentTitle = title;
        const titleElement = this.titlebar.querySelector('.titlebar-title');
        if (titleElement) {
            titleElement.textContent = title;
        }
    }
}


window.TitlebarManager = TitlebarManager;
