class TitlebarManager {
    constructor() {
        this.titlebar = null;
        this.currentTitle = 'OICPP IDE';
        this.isMaximized = false;
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
                closeBtn.addEventListener('click', () => {
                    logInfo('点击关闭按钮');
                    if (window.electronIPC) {
                        window.electronIPC.send('window-close');
                    }
                });
            }
        }, 100);
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
