/**
 * BrowserManager - 内置浏览器管理器
 * 提供标签页内的网页浏览功能，支持分屏
 */

// 新建标签页默认显示的欢迎页（data URI，避免约:blank 一片空白）
const NEW_TAB_PAGE_HTML = (() => {
    const isDark = document.body.classList.contains('theme-light') ? false : true;
    const bg = isDark ? '#1e1e1e' : '#ffffff';
    const fg = isDark ? '#cccccc' : '#333333';
    const muted = isDark ? '#6a6a6a' : '#999999';
    const accent = '#007acc';
    // 构建极简欢迎页
    return `data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>新标签页</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  background:${bg};color:${fg};display:flex;flex-direction:column;
  align-items:center;justify-content:center;height:100vh;user-select:none}
.logo{width:48px;height:48px;margin-bottom:16px;opacity:0.3;
  background:${accent};border-radius:12px;display:flex;align-items:center;justify-content:center}
.logo svg{width:28px;height:28px;fill:${bg}}
h1{font-size:18px;font-weight:400;margin-bottom:6px}
p{font-size:13px;color:${muted};margin-bottom:24px;text-align:center;line-height:1.6}
.hint{font-size:11px;color:${muted};opacity:0.6;margin-top:8px}
</style></head>
<body>
<div class="logo"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/></svg></div>
<h1>内置浏览器</h1>
<p>在上方地址栏输入网址开始浏览<br>支持 Ctrl+Shift+I 快速打开</p>
<div class="hint">支持标签页分屏 · 拖动标签到空白处即可</div>
</body></html>`)}`;
})();

class BrowserManager {
    constructor() {
        this.browserTabs = new Map(); // uniqueKey -> { webview, container, navBar, urlInput, title }
        this._currentFocusKey = null;
        this._pendingNav = new Map(); // uniqueKey -> url
        this._newTabPage = NEW_TAB_PAGE_HTML;
    }

    /**
     * 创建一个浏览器标签页容器
     * @param {object} options
     * @param {string} options.groupId - 所属编辑器分组 ID
     * @param {string} options.uniqueKey - 标签唯一键
     * @param {string} options.url - 初始 URL
     * @returns {HTMLElement} browserContainer
     */
    createBrowserContainer({ groupId, uniqueKey, url }) {
        // 未指定 URL 时使用内置新标签页
        const initialUrl = (url && url.trim()) ? url.trim() : this._newTabPage;
        // 主容器
        const container = document.createElement('div');
        container.className = 'browser-container';
        container.dataset.groupId = groupId || '';
        container.dataset.uniqueKey = uniqueKey || '';
        container.style.display = 'none';

        // 导航栏
        const navBar = this._createNavBar(uniqueKey, initialUrl);
        container.appendChild(navBar);

        // iframe 容器
        const frameWrapper = document.createElement('div');
        frameWrapper.className = 'browser-webview-wrapper';
        frameWrapper.style.flex = '1';
        frameWrapper.style.position = 'relative';
        frameWrapper.style.overflow = 'hidden';

        const webview = document.createElement('webview');
        webview.className = 'browser-webview';
        webview.setAttribute('src', initialUrl);
        webview.style.width = '100%';
        webview.style.height = '100%';
        webview.style.border = 'none';

        frameWrapper.appendChild(webview);
        container.appendChild(frameWrapper);

        // 保存引用
        const state = {
            webview,
            iframe: webview,
            container,
            navBar,
            urlInput: navBar.querySelector('.browser-url-input'),
            title: '',
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            currentUrl: initialUrl,
            history: []
        };
        this.browserTabs.set(uniqueKey, state);

        this._bindWebviewEvents(uniqueKey, state);

        return container;
    }

    /**
     * 创建导航栏
     */
    _createNavBar(uniqueKey, initialUrl) {
        const navBar = document.createElement('div');
        navBar.className = 'browser-nav-bar';

        // 导航按钮组
        const navButtons = document.createElement('div');
        navButtons.className = 'browser-nav-buttons';

        // 后退
        const backBtn = this._createNavButton('browser-nav-back', [
            '<svg width="16" height="16" viewBox="0 0 16 16">',
            '<path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
            '</svg>'
        ].join(''), '后退');
        navButtons.appendChild(backBtn);

        // 前进
        const forwardBtn = this._createNavButton('browser-nav-forward', [
            '<svg width="16" height="16" viewBox="0 0 16 16">',
            '<path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
            '</svg>'
        ].join(''), '前进');
        navButtons.appendChild(forwardBtn);

        // 刷新/停止
        const refreshBtn = this._createNavButton('browser-nav-reload', [
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
            '<polyline points="23 4 23 10 17 10"/>',
            '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
            '</svg>'
        ].join(''), '刷新');
        refreshBtn.dataset.action = 'reload';
        navButtons.appendChild(refreshBtn);

        navBar.appendChild(navButtons);

        // URL 输入框
        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.className = 'browser-url-input';
        urlInput.setAttribute('placeholder', window.i18n ? window.i18n.t('browser.urlPlaceholder') : '输入网址或搜索...');
        urlInput.value = initialUrl || '';
        urlInput.setAttribute('spellcheck', 'false');
        urlInput.setAttribute('autocomplete', 'off');
        navBar.appendChild(urlInput);

        // 在新标签页中打开的按钮
        const openNewTabBtn = document.createElement('button');
        openNewTabBtn.className = 'browser-nav-action browser-nav-newtab';
        openNewTabBtn.innerHTML = [
            '<svg width="16" height="16" viewBox="0 0 16 16">',
            '<path d="M3 2h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zm1 2v8h8V4H4z" fill="currentColor"/>',
            '<path d="M7 7V5h2v2h2v2H9v2H7V9H5V7h2z" fill="currentColor"/>',
            '</svg>'
        ].join('');
        openNewTabBtn.title = window.i18n ? window.i18n.t('browser.openInNewTab') : '新建浏览器标签页';
        navBar.appendChild(openNewTabBtn);

        // 导航按钮事件
        backBtn.addEventListener('click', () => this.goBack(uniqueKey));
        forwardBtn.addEventListener('click', () => this.goForward(uniqueKey));
        refreshBtn.addEventListener('click', () => {
            const state = this.browserTabs.get(uniqueKey);
            if (!state) return;
            if (state.isLoading) {
                this.stopLoading(uniqueKey);
            } else {
                this.reload(uniqueKey);
            }
        });
        urlInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.navigateTo(uniqueKey, urlInput.value);
            }
        });
        // 输入框获得焦点时选中全部文本
        urlInput.addEventListener('focus', () => {
            setTimeout(() => urlInput.select(), 0);
        });
        openNewTabBtn.addEventListener('click', () => {
            const state = this.browserTabs.get(uniqueKey);
            const url = state?.currentUrl || urlInput.value || 'about:blank';
            this._openInNewTab(url);
        });

        return navBar;
    }

    /**
     * 创建导航按钮
     */
    _createNavButton(className, innerHtml, title) {
        const btn = document.createElement('button');
        btn.className = 'browser-nav-btn ' + className;
        btn.innerHTML = innerHtml;
        btn.title = title || '';
        btn.tabIndex = -1;
        return btn;
    }

    /**
     * 绑定 webview 事件
     */
    _bindWebviewEvents(uniqueKey, state) {
        const { webview, navBar, urlInput } = state;
        const updateLocation = (url) => {
            if (!url || url === 'about:blank' || url.startsWith('data:text/html')) return;
            state.currentUrl = url;
            urlInput.value = url;
            this._updateNavButtons(uniqueKey);
        };

        webview.addEventListener('did-start-loading', () => {
            state.isLoading = true;
            this._updateReloadButton(uniqueKey, true);
            navBar.classList.add('loading');
        });
        webview.addEventListener('did-stop-loading', () => {
            state.isLoading = false;
            this._updateReloadButton(uniqueKey, false);
            navBar.classList.remove('loading');
            try { updateLocation(webview.getURL()); } catch (_) {}
        });
        webview.addEventListener('did-navigate', (event) => updateLocation(event.url));
        webview.addEventListener('did-navigate-in-page', (event) => updateLocation(event.url));
        webview.addEventListener('page-title-updated', (event) => {
            const title = typeof event.title === 'string' ? event.title.trim() : '';
            if (!title) return;
            state.title = title;
            this._updateTabTitle(uniqueKey, title);
        });
        webview.addEventListener('did-fail-load', (event) => {
            if (event.errorCode === -3) return;
            state.isLoading = false;
            this._updateReloadButton(uniqueKey, false);
            navBar.classList.remove('loading');
        });

        this._updateNavButtons(uniqueKey);
    }

    /**
     * 在新标签页中打开 URL
     */
    _openInNewTab(url) {
        if (!url || !window.tabManager) return;
        const resolvedUrl = url;
        // 使用 tabManager 打开新的浏览器标签
        window.tabManager.openBrowserTab({ url: resolvedUrl, groupId: window.tabManager.activeGroupId });
    }

    /**
     * 导航到指定 URL
     */
    async navigateTo(uniqueKey, rawUrl) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state) return;
        let url = rawUrl ? rawUrl.trim() : '';
        if (!url) return;
        // 通过主进程解析 URL
        try {
            if (window.electronAPI && typeof window.electronAPI.browserResolveUrl === 'function') {
                url = await window.electronAPI.browserResolveUrl(url);
            }
        } catch (_) {}
        if (!url) return;
        state.currentUrl = url;
        state.webview.loadURL(url).catch(() => {});
        state.urlInput.value = url;
        this._updateNavButtons(uniqueKey);
    }

    /**
     * 后退
     */
    goBack(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state?.webview) return;
        try {
            if (state.webview.canGoBack()) state.webview.goBack();
        } catch (_) {}
        this._updateNavButtons(uniqueKey);
    }

    /**
     * 前进
     */
    goForward(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state?.webview) return;
        try {
            if (state.webview.canGoForward()) state.webview.goForward();
        } catch (_) {}
        this._updateNavButtons(uniqueKey);
    }

    /**
     * 刷新
     */
    reload(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (state?.webview) {
            try { state.webview.reload(); } catch (_) {}
        }
    }

    /**
     * 停止加载
     */
    stopLoading(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (state?.webview) {
            try { state.webview.stop(); } catch (_) {}
        }
    }

    /**
     * 更新导航按钮状态
     */
    _updateNavButtons(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state) return;
        const backBtn = state.navBar.querySelector('.browser-nav-back');
        const forwardBtn = state.navBar.querySelector('.browser-nav-forward');
        let canGoBack = false;
        let canGoForward = false;
        try {
            canGoBack = state.webview?.canGoBack?.() || false;
            canGoForward = state.webview?.canGoForward?.() || false;
        } catch (_) {}
        if (backBtn) backBtn.classList.toggle('disabled', !canGoBack);
        if (forwardBtn) forwardBtn.classList.toggle('disabled', !canGoForward);
    }

    /**
     * 更新刷新/停止按钮
     */
    _updateReloadButton(uniqueKey, isLoading) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state) return;
        const reloadBtn = state.navBar.querySelector('.browser-nav-reload');
        if (!reloadBtn) return;
        if (isLoading) {
            reloadBtn.innerHTML = [
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">',
                '<rect x="6" y="6" width="12" height="12" rx="2"/>',
                '</svg>'
            ].join('');
            reloadBtn.title = window.i18n ? window.i18n.t('browser.stop') : '停止';
            reloadBtn.dataset.action = 'stop';
        } else {
            reloadBtn.innerHTML = [
                '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">',
                '<polyline points="23 4 23 10 17 10"/>',
                '<path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
                '</svg>'
            ].join('');
            reloadBtn.title = window.i18n ? window.i18n.t('browser.reload') : '刷新';
            reloadBtn.dataset.action = 'reload';
        }
    }

    /**
     * 更新标签标题
     */
    _updateTabTitle(uniqueKey, title) {
        if (!title || !window.tabManager) return;
        const tabData = window.tabManager.tabs.get(uniqueKey);
        if (!tabData) return;
        const displayTitle = title || tabData.fileName;
        tabData.fileName = displayTitle;
        if (tabData.element) {
            const label = tabData.element.querySelector('.tab-label');
            if (label) {
                label.textContent = displayTitle;
                label.title = displayTitle;
            }
        }
    }

    /**
     * 获取浏览器标签页的状态
     */
    getBrowserState(uniqueKey) {
        return this.browserTabs.get(uniqueKey) || null;
    }

    /**
     * 销毁浏览器标签页
     */
    destroyBrowserTab(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state) return;
        try {
            if (state.webview && state.webview.parentNode) {
                try { state.webview.stop(); } catch (_) {}
                state.webview.parentNode.removeChild(state.webview);
            }
            // 清理导航栏
            if (state.navBar && state.navBar.parentNode) {
                state.navBar.parentNode.removeChild(state.navBar);
            }
            // 清理容器
            if (state.container && state.container.parentNode) {
                state.container.parentNode.removeChild(state.container);
            }
        } catch (_) {}
        this.browserTabs.delete(uniqueKey);
        if (this._currentFocusKey === uniqueKey) {
            this._currentFocusKey = null;
        }
    }

    /**
     * 聚焦浏览器标签页
     */
    focusBrowserTab(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state) return;
        this._currentFocusKey = uniqueKey;
        if (state.urlInput) {
            setTimeout(() => state.urlInput.focus(), 100);
        }
    }

    /**
     * 获取或创建浏览器容器（供 TabManager 调用）
     */
    getOrCreateContainer({ groupId, uniqueKey, url }) {
        const existing = this.browserTabs.get(uniqueKey);
        if (existing && existing.container) {
            // 如果 groupId 变化，需要移动容器
            if (existing.container.dataset.groupId !== groupId) {
                existing.container.dataset.groupId = groupId;
            }
            return existing.container;
        }
        return this.createBrowserContainer({ groupId, uniqueKey, url });
    }

    /**
     * 显示浏览器容器（隐藏其他视图）
     */
    showBrowserContainer(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state || !state.container) return;
        state.container.classList.add('active');
        state.container.style.display = '';
        if (state.webview) {
            state.webview.style.width = '100%';
            state.webview.style.height = '100%';
            try { state.webview.focus(); } catch (_) {}

            // 如果是因为 DOM 搬移需要恢复内容，或有内容丢失迹象，则重新加载
            const needsRestore = state._needsContentRestore;
            state._needsContentRestore = false;

            let shouldReload = needsRestore;
            try { shouldReload = shouldReload || !state.webview.getURL(); } catch (_) {}

            if (shouldReload) {
                const url = state.currentUrl || this._newTabPage || 'about:blank';
                // 用 requestAnimationFrame 确保 DOM 已挂载后再设置 src
                requestAnimationFrame(() => {
                    try {
                        if (state.webview.getURL() !== url) {
                            state.webview.loadURL(url).catch(() => {});
                        }
                    } catch (_) {
                        state.webview.setAttribute('src', url);
                    }
                });
            }
        }
    }

    /**
     * 隐藏浏览器容器
     */
    hideBrowserContainer(uniqueKey) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state || !state.container) return;
        state.container.classList.remove('active');
        state.container.style.display = 'none';
    }

    /**
     * 隐藏分组内所有浏览器容器
     */
    hideGroupBrowserContainers(groupId) {
        for (const [key, state] of this.browserTabs.entries()) {
            if (state.container && state.container.dataset.groupId === groupId) {
                state.container.classList.remove('active');
                state.container.style.display = 'none';
            }
        }
    }

    /**
     * 移动浏览器容器到新分组（直接搬移 DOM，不重建 webview）
     */
    moveContainerToGroup(uniqueKey, newGroupId) {
        const state = this.browserTabs.get(uniqueKey);
        if (!state || !state.container) return null;

        // 只更新分组 ID，DOM 节点由调用方通过 appendChild 搬移
        state.container.dataset.groupId = newGroupId;

        // appendChild 会自动从旧父节点移除，标记需要恢复以兼容 webview 重挂载
        state._needsContentRestore = true;

        return state.container;
    }
}

// 全局实例
window.browserManager = new BrowserManager();
