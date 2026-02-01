class SidebarManager {
    constructor() {
        this.currentPanel = 'files';
        this.panels = {
            files: new FileExplorer(),
            samples: new SampleTester(),
            compare: new CodeComparer(),
            debug: new DebugPanel(),
            cloud: new CloudSyncPanel()
        };

        this._pendingResizeRaf = null;
        this._pendingResizeIsTimeout = false;

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.setupResizer();
        this.showPanel('files');
        this.bootstrapCloudVisibility();
    }

    async bootstrapCloudVisibility() {
        try {
            if (!window.electronAPI?.getIdeLoginStatus) return;
            const status = await window.electronAPI.getIdeLoginStatus();
            logInfo('[CloudSpace] 启动时登录状态:', {
                loggedIn: !!status?.loggedIn,
                user: status?.user?.username || ''
            });
            this.setCloudPanelVisible(!!status?.loggedIn);
        } catch (error) {
            logWarn('初始化云空间面板可见性失败:', error);
        }
    }

    setupEventListeners() {
        const sidebarIcons = document.querySelectorAll('.sidebar-icon');
        logInfo('setupEventListeners: 找到', sidebarIcons.length, '个侧边栏图标');
        sidebarIcons.forEach((icon, index) => {
            logInfo('绑定事件监听器到图标', index, '面板名:', icon.dataset.panel);
            icon.addEventListener('click', (e) => {
                const panelName = e.currentTarget.dataset.panel;
                logInfo('图标被点击，面板名:', panelName);
                this.showPanel(panelName);
            });
        });

        const sidebarIconsContainer = document.querySelector('.sidebar-icons');
        if (sidebarIconsContainer) {
            sidebarIconsContainer.addEventListener('dblclick', (e) => {
                e.preventDefault();
                this.toggleSidebar();
            });
        }

        this.setupPanelHeaderButtons();
    }

    setupResizer() {
        const sidebar = document.querySelector('.sidebar');
        const resizer = document.querySelector('.sidebar-resizer');
        const mainContainer = document.querySelector('.main-container');
        const sidebarPanel = document.querySelector('.sidebar-panel');

        if (!sidebar || !resizer || !mainContainer || !sidebarPanel) return;

        let isResizing = false;
        let startX = 0;
        let startWidth = 0;

        this.resizer = resizer;
        this.sidebar = sidebar;
        this.sidebarPanel = sidebarPanel;
        this.isCollapsed = false;

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            isResizing = true;
            startX = e.clientX;
            startWidth = sidebar.offsetWidth;

            resizer.classList.add('resizing');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            document.addEventListener('selectstart', preventSelection);
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            e.preventDefault();
            const deltaX = e.clientX - startX;
            const newWidth = startWidth + deltaX;

            const hideThreshold = 100;
            const minWidth = 200;

            if (newWidth < hideThreshold) {
                this.collapseSidebar();
            } else {
                if (this.isCollapsed) {
                    this.expandSidebar();
                }

                const clampedWidth = Math.max(minWidth, newWidth);
                sidebar.style.width = clampedWidth + 'px';
            }

            this.scheduleEditorResize();
        });

        document.addEventListener('mouseup', () => {
            if (!isResizing) return;

            isResizing = false;
            resizer.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            document.removeEventListener('selectstart', preventSelection);

            const width = sidebar.offsetWidth;
            localStorage.setItem('sidebar-width', width);

            this.scheduleEditorResize(true);
            setTimeout(() => {
                this.scheduleEditorResize(true);
            }, 100);
        });

        function preventSelection(e) {
            e.preventDefault();
            return false;
        }

        const savedWidth = localStorage.getItem('sidebar-width');
        const savedCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';

        if (savedCollapsed) {
            this.savedWidth = savedWidth ? parseInt(savedWidth) : 350;
            this.isCollapsed = true;
            this.collapseSidebar();
        } else if (savedWidth) {
            const width = parseInt(savedWidth);
            if (width >= 200 && width <= window.innerWidth * 0.6) {
                sidebar.style.width = width + 'px';
            }
        }

        setTimeout(() => {
            const welcomeContainer = document.getElementById('welcome-container');
            const editorArea = document.querySelector('.editor-area');

            const isWelcomeVisible = welcomeContainer &&
                (welcomeContainer.style.display === 'block' ||
                    (welcomeContainer.style.display !== 'none' && welcomeContainer.offsetParent !== null));
            const isEditorHidden = editorArea && editorArea.style.display === 'none';

            if (isWelcomeVisible || isEditorHidden) {
                this.disableResize();
                try {
                    this.hideForWelcome();
                } catch (_) { }
                logInfo('初始化时检测到欢迎页面，已禁用侧边栏拖拽并隐藏侧边栏');
            }
        }, 200);
    }

    disableResize() {
        if (this.resizer) {
            this.resizer.style.pointerEvents = 'none';
            this.resizer.style.display = 'none';
            logInfo('侧边栏拖拽调整已禁用（欢迎页面模式）');
        }
    }

    enableResize() {
        if (this.resizer) {
            this.resizer.style.pointerEvents = '';
            this.resizer.style.display = '';
            logInfo('侧边栏拖拽调整已启用（编辑器模式）');
        }
    }

    hideForWelcome() {
        const sidebar = this.sidebar || document.querySelector('.sidebar');
        if (sidebar) {
            if (sidebar.classList.contains('hidden')) return;
            try {
                this._prevWidth = sidebar.style.width || '';
                this._wasCollapsed = this.isCollapsed === true || localStorage.getItem('sidebar-collapsed') === 'true';
            } catch (_) { }
            sidebar.classList.add('hidden');
        }
        this.disableResize();
    }

    showForEditor() {
        const sidebar = this.sidebar || document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.remove('hidden');
            try {
                if (this._prevWidth) {
                    sidebar.style.width = this._prevWidth;
                } else {
                    const savedWidth = localStorage.getItem('sidebar-width');
                    const width = savedWidth ? parseInt(savedWidth) : 350;
                    sidebar.style.width = (isFinite(width) && width >= 200 ? width : 300) + 'px';
                }
            } catch (_) { }
            try {
                if (this._wasCollapsed) {
                    this.collapseSidebar();
                } else {
                    this.expandSidebar();
                }
            } catch (_) { }
        }
        this.enableResize();
    }

    collapseSidebar() {
        if (!this.sidebar || !this.sidebarPanel) return;

        logInfo('开始折叠侧边栏，当前isCollapsed:', this.isCollapsed);

        this.isCollapsed = true;

        this.savedWidth = this.sidebar.offsetWidth;

        this.sidebar.style.width = '48px';

        this.sidebarPanel.style.display = 'none';

        localStorage.setItem('sidebar-collapsed', 'true');

        logInfo('侧边栏已折叠，新的isCollapsed状态:', this.isCollapsed);

        this.scheduleEditorResize();
    }

    expandSidebar() {
        logInfo('expandSidebar called, sidebar:', !!this.sidebar, 'sidebarPanel:', !!this.sidebarPanel);
        if (!this.sidebar || !this.sidebarPanel) {
            logInfo('expandSidebar: 缺少必要的DOM元素');
            return;
        }

        this.isCollapsed = false;

        this.sidebarPanel.style.display = '';

        const width = 350;
        this.sidebar.style.width = width + 'px';

        localStorage.removeItem('sidebar-collapsed');

        logInfo('侧边栏已展开，宽度:', width, 'isCollapsed:', this.isCollapsed);

        this.scheduleEditorResize();
    }

    toggleSidebar() {
        if (this.isCollapsed) {
            this.expandSidebar();
        } else {
            this.collapseSidebar();
        }
    }

    checkResizeStatus() {
        const welcomeContainer = document.getElementById('welcome-container');
        const editorArea = document.querySelector('.editor-area');
        const isWelcomeVisible = welcomeContainer && welcomeContainer.style.display === 'block';
        const isEditorVisible = editorArea && editorArea.style.display !== 'none';
        const isResizerEnabled = this.resizer && this.resizer.style.display !== 'none';

        logInfo('=== 侧边栏拖拽状态检查 ===');
        logInfo('欢迎页面可见:', isWelcomeVisible);
        logInfo('编辑器区域可见:', isEditorVisible);
        logInfo('拖拽手柄启用:', isResizerEnabled);
        logInfo('当前状态:', isWelcomeVisible ? '欢迎页面模式' : '编辑器模式');
        logInfo('拖拽状态:', isResizerEnabled ? '启用' : '禁用');

        return {
            welcomeVisible: isWelcomeVisible,
            editorVisible: isEditorVisible,
            resizerEnabled: isResizerEnabled
        };
    }

    triggerEditorResize() {
        if (window.monaco && window.editorManager && window.editorManager.currentEditor) {
            setTimeout(() => {
                if (window.editorManager.currentEditor.layout) {
                    window.editorManager.currentEditor.layout();
                }
            }, 50);
        }

        window.dispatchEvent(new Event('resize'));
    }

    scheduleEditorResize(force = false) {
        if (force) {
            if (this._pendingResizeRaf !== null) {
                if (this._pendingResizeIsTimeout) {
                    clearTimeout(this._pendingResizeRaf);
                } else {
                    try { cancelAnimationFrame(this._pendingResizeRaf); } catch (_) { }
                }
                this._pendingResizeRaf = null;
                this._pendingResizeIsTimeout = false;
            }
            this.triggerEditorResize();
            return;
        }

        if (this._pendingResizeRaf !== null) {
            return;
        }

        const raf = window.requestAnimationFrame || window.webkitRequestAnimationFrame || window.mozRequestAnimationFrame;
        if (typeof raf !== 'function') {
            this._pendingResizeRaf = setTimeout(() => {
                this._pendingResizeRaf = null;
                this._pendingResizeIsTimeout = false;
                this.triggerEditorResize();
            }, 50);
            this._pendingResizeIsTimeout = true;
            return;
        }

        this._pendingResizeRaf = raf.call(window, () => {
            this._pendingResizeRaf = null;
            this._pendingResizeIsTimeout = false;
            this.triggerEditorResize();
        });
        this._pendingResizeIsTimeout = false;
    }

    setupPanelHeaderButtons() {
        const fileButtons = document.querySelectorAll('#files-panel .icon-btn');
        fileButtons.forEach((btn, index) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();

                const fileExplorer = this.panels.files;
                logInfo('检查工作区状态:', fileExplorer ? fileExplorer.hasWorkspace : '文件管理器不存在', '路径:', fileExplorer ? fileExplorer.currentPath : 'N/A');
                if (!fileExplorer || !fileExplorer.hasWorkspace) {
                    logInfo('没有工作区，无法执行操作');
                    return;
                }

                switch (index) {
                    case 0: // 新建文件
                        fileExplorer.createNewFile();
                        break;
                    case 1: // 新建文件夹
                        fileExplorer.createNewFolder();
                        break;
                    case 2: // 刷新
                        fileExplorer.refresh();
                        break;
                }
            });
        });
    }

    showPanel(panelName) {
        logInfo('showPanel called, panelName:', panelName, 'isCollapsed:', this.isCollapsed);
        this.updateCloudPanelLocks();
        if (this.isCloudFileActive() && ['debug', 'samples', 'compare'].includes(panelName)) {
            if (window.oicppApp?.showMessage) {
                window.oicppApp.showMessage('云文件仅支持基础编辑与手动保存，请下载到本地再使用该面板。', 'warning');
            }
            return;
        }
        if (this.isCollapsed) {
            logInfo('侧边栏处于折叠状态，正在展开...');
            this.expandSidebar();
        }

        if (this.currentPanel === panelName) {
            return;
        }

        const icons = document.querySelectorAll('.sidebar-icon');
        icons.forEach(icon => {
            icon.classList.remove('active');
            if (icon.dataset.panel === panelName) {
                icon.classList.add('active');
            }
        });

        const panels = document.querySelectorAll('.panel-content');
        panels.forEach(panel => {
            panel.classList.remove('active');
            if (panel.id === `${panelName}-panel`) {
                panel.classList.add('active');
            }
        });

        this.currentPanel = panelName;

        if (this.panels[panelName]) {
            logInfo('正在激活面板管理器:', panelName);
            this.panels[panelName].activate();
            logInfo('面板管理器激活完成:', panelName);
        } else {
            logWarn('面板管理器不存在:', panelName);
        }

        if (panelName === 'compare' && this.panels.compare) {
            setTimeout(() => {
                this.panels.compare.checkCompilerAndUpdate();
            }, 100);
        }
    }

    getCurrentPanel() {
        return this.currentPanel;
    }

    getPanelManager(panelName) {
        return this.panels[panelName];
    }

    updateFileExplorerButtons() {
        const fileButtons = document.querySelectorAll('#files-panel .icon-btn');
        const fileExplorer = this.panels.files;
        const hasWorkspace = fileExplorer && fileExplorer.hasWorkspace;

        fileButtons.forEach((btn, index) => {
            if (index < 2) {
                btn.disabled = !hasWorkspace;
                btn.style.opacity = hasWorkspace ? '1' : '0.5';
                btn.style.cursor = hasWorkspace ? 'pointer' : 'not-allowed';
            }
        });
    }

    isCloudFileActive() {
        try {
            const filePath = window.oicppApp?.getActiveFilePath?.();
            if (!filePath) return false;
            if (window.oicppApp?.isCloudFilePath) {
                return window.oicppApp.isCloudFilePath(filePath);
            }
            return typeof filePath === 'string' && /^cloud:/i.test(filePath);
        } catch (_) {
            return false;
        }
    }

    updateCloudPanelLocks() {
        const locked = this.isCloudFileActive();
        const lockTargets = ['debug', 'samples', 'compare'];
        lockTargets.forEach(panel => {
            const icon = document.querySelector(`.sidebar-icon[data-panel="${panel}"]`);
            if (!icon) return;
            if (locked) {
                icon.classList.add('disabled');
                icon.setAttribute('title', '云文件仅支持基础编辑与手动保存');
            } else {
                icon.classList.remove('disabled');
                if (panel === 'debug') icon.setAttribute('title', '调试');
                if (panel === 'samples') icon.setAttribute('title', '样例测试器');
                if (panel === 'compare') icon.setAttribute('title', '代码对拍器');
            }
        });
    }

    setCloudPanelVisible(visible) {
        const show = !!visible;
        const icon = document.querySelector('.sidebar-icon.cloud-sync-icon');
        const panel = document.getElementById('cloud-panel');
        if (icon) {
            icon.style.display = show ? 'flex' : 'none';
            icon.style.visibility = show ? 'visible' : 'hidden';
        } else {
            logWarn('未找到云空间侧边栏图标');
        }
        if (panel) {
            panel.style.display = show ? 'flex' : 'none';
            panel.style.visibility = show ? 'visible' : 'hidden';
        } else {
            logWarn('未找到云空间面板容器');
        }
        if (!show && this.currentPanel === 'cloud') {
            this.showPanel('files');
        }
        if (this.panels.cloud && typeof this.panels.cloud.setLoggedInState === 'function') {
            this.panels.cloud.setLoggedInState(show);
        }
    }
}

if (typeof window !== 'undefined') {
    window.SidebarManager = SidebarManager;
}
