document.addEventListener('DOMContentLoaded', function() {
    logInfo('DOM 加载完成，开始初始化应用...');
    setUserIconPath();
    initializeApp();
    setTimeout(() => {
        try {
            const now = new Date();
            const shouldShow = (now.getMonth() === 0 && now.getDate() === 1);
            if (shouldShow && window.dialogManager && typeof window.dialogManager.showNewYearGreeting === 'function') {
                window.dialogManager.showNewYearGreeting(now);
            }
        } catch (e) {
            try { logWarn('新年弹窗触发失败:', e); } catch (_) { }
        }
    }, 350);
});

async function setUserIconPath() {
    try {
        const userIconPath = await window.electronAPI.getUserIconPath();
        const appIcon = document.getElementById('app-icon');
        if (appIcon) {
            appIcon.src = userIconPath;
        }
    } catch (error) {
        logWarn('无法加载用户目录中的图标，使用默认图标:', error);
    }
}
async function initializeApp() {
    try {
        logInfo('初始化标题栏管理器...');
        window.titlebarManager = new TitlebarManager();
  
        logInfo('初始化侧边栏管理器...');
        window.sidebarManager = new SidebarManager();
        window.sampleTester = window.sidebarManager.getPanelManager('samples');
        window.codeComparer = window.sidebarManager.getPanelManager('compare');

        setTimeout(() => {
            window.sidebarManager.updateFileExplorerButtons();
        }, 100);
        logInfo('侧边栏管理器已初始化');
        window.checkSidebarResize = () => {
            if (window.sidebarManager && window.sidebarManager.checkResizeStatus) {
                return window.sidebarManager.checkResizeStatus();
            } else {
                logInfo('侧边栏管理器未找到');
                return null;
            }
        };
        
        logInfo('初始化标签页管理器...');
        window.tabManager = new TabManager();

        logInfo('初始化主应用...');
        window.oicppApp = new OICPPApp();
        logInfo('OICPPApp 实例已创建');
        await window.oicppApp.init();
   
        setupDefaultContent();
        
        logInfo('应用初始化完成！');
        try {
            if (window.electronAPI && window.electronAPI.onRequestSaveAll) {
                window.electronAPI.onRequestSaveAll(async () => {
                    try {
                        if (window.tabManager && typeof window.tabManager.saveAllFiles === 'function') {
                            await window.tabManager.saveAllFiles();
                        } else if (window.oicppApp?.saveCurrentFile) {
                            window.oicppApp.saveCurrentFile();
                        }
                    } finally {
                        window.electronAPI.notifySaveAllComplete();
                    }
                });
            }
        } catch (e) { logWarn('注册关闭前保存监听失败:', e); }
        
    } catch (error) {
        logError('应用初始化失败:', error);
        showErrorMessage('应用初始化失败: ' + error.message);
    }
}

function setupDefaultContent() {
    setTimeout(function() {
        try {
            if (window.tabManager && typeof window.tabManager.getTabCount === 'function' && window.tabManager.getTabCount() === 0) {
                logInfo('显示欢迎页面...');
                if (typeof window.tabManager.showWelcomePage === 'function') {
                    window.tabManager.showWelcomePage();
                } else {
                    logError('showWelcomePage 方法不存在');
                }
            }
        } catch (error) {
            logError('显示欢迎页面时出错:', error);
            if (window.tabManager && typeof window.tabManager.createNewCppFile === 'function') {
                window.tabManager.createNewCppFile();
            }
        }
    }, 1000); 
}

function showErrorMessage(message) {
    var errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #ff4444;
        color: white;
        padding: 20px;
        border-radius: 8px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        z-index: 10000;
        font-family: Arial, sans-serif;
        max-width: 400px;
        text-align: center;
    `;
    errorDiv.textContent = message;
    
    document.body.appendChild(errorDiv);
    
    setTimeout(function() {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 5000);

    errorDiv.addEventListener('click', function() {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    });
}

window.addEventListener('error', function(e) {
    try {
        const info = {
            message: e?.error?.message || e?.message,
            filename: e?.filename,
            lineno: e?.lineno,
            colno: e?.colno,
            stack: e?.error?.stack
        };
        logError('[RendererGlobalError]', info);
    } catch (_) {}
    showErrorMessage('发生错误: ' + (e?.error?.message || e?.message || '未知错误'));
});

window.addEventListener('unhandledrejection', function(e) {
    try {
        const reason = e?.reason;
        const info = reason instanceof Error ? { message: reason.message, stack: reason.stack } : { reason };
        logError('[RendererUnhandledRejection]', info);
    } catch (_) {}
    showErrorMessage('异步错误: ' + (e?.reason?.message || String(e?.reason)));
});

window.initializeApp = initializeApp;
