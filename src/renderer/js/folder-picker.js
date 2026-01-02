(function () {
    if (window.folderPicker) return;
    const E = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt !== undefined) e.textContent = txt; return e; };
    const norm = (...ps) => ps.join('/').replace(/\\/g, '/').replace(/\/+/g, '/');

    function buildBreadcrumb(path, bar, onChange) {
        bar.innerHTML = '';
        const upBtn = E('button', 'folder-picker-up', '⬆');
        upBtn.title = '上一级';
        upBtn.onclick = () => {
            if (path === '/' || /^[A-Za-z]:\/$/.test(path)) return;
            const parent = path.replace(/[\\/]+$/, '').replace(/[/\\][^/\\]+$/, '') || '/';
            onChange(parent);
        };
        bar.appendChild(upBtn);
        const parts = path.split(/\/+?/).filter(Boolean);
        let acc = path.startsWith('/') ? '/' : '';
        if (path.startsWith('/')) {
            const root = E('div', 'folder-picker-breadcrumb', '/');
            root.onclick = () => { if (path !== '/') onChange('/'); };
            bar.appendChild(root);
        } else if (/^[A-Za-z]:\\?$/.test(path)) {
            const drv = path.slice(0, 2);
            const root = E('div', 'folder-picker-breadcrumb', drv);
            root.onclick = () => onChange(drv + '/');
            bar.appendChild(root);
        }
        for (const seg of parts) {
            if (seg === '') continue;
            acc = acc === '/' ? ('/' + seg) : (acc ? acc + '/' + seg : seg);
            const c = E('div', 'folder-picker-breadcrumb', seg);
            const targetPath = acc;
            c.onclick = () => onChange(targetPath);
            bar.appendChild(c);
        }
    }

    function getQuickAccess() {
        const list = [];
        const home = (process.platform === 'win32' ? process.env.USERPROFILE : process.env.HOME) || '';
        if (home) list.push({ name: '主目录', path: home.replace(/\\/g, '/') });
        if (process.platform !== 'win32') list.push({ name: '/ (根目录)', path: '/' });
        return list;
    }

    window.folderPicker = {
        show(opts = {}) {
            return new Promise(resolve => {
                const theme = (window.oicppApp?.settings?.theme) || 'dark';
                let cur = opts.startPath || window.oicppApp?.settings?.lastOpen || ((process.platform === 'win32') ? (process.env.USERPROFILE || 'C:/') : '/');
                if (!cur) cur = '/';
                const backdrop = E('div', 'folder-picker-backdrop');
                const panel = E('div', 'folder-picker ' + (theme === 'light' ? 'light' : ''));
                backdrop.appendChild(panel);
                const header = E('div', 'folder-picker-header');
                header.appendChild(E('span', null, '选择工作区文件夹'));
                const close = E('span', 'folder-picker-close', '✕');
                close.onclick = () => { clean(); resolve(null); };
                header.appendChild(close);
                panel.appendChild(header);
                const bar = E('div', 'folder-picker-pathbar');
                panel.appendChild(bar);
                const body = E('div', 'folder-picker-body');
                panel.appendChild(body);
                const side = E('div', 'folder-picker-side');
                body.appendChild(side);
                const treeWrap = E('div', 'folder-picker-tree');
                body.appendChild(treeWrap);

                const quick = E('div', 'folder-picker-quick');
                quick.appendChild(E('div', 'folder-picker-quick-title', '快速访问'));
                const quickList = E('div', 'folder-picker-quick-list');
                getQuickAccess().forEach(q => {
                    const it = E('div', 'folder-picker-quick-item', q.name);
                    it.title = q.path;
                    it.onclick = () => { cur = q.path; reload(); };
                    quickList.appendChild(it);
                });
                quick.appendChild(quickList);
                side.appendChild(quick);

                const search = E('input', 'folder-picker-search');
                search.placeholder = '过滤当前目录';
                side.appendChild(search);

                const createWrap = E('div', 'folder-picker-create');
                const createInput = E('input');
                createInput.placeholder = '新建文件夹';
                const createBtn = E('button', null, '创建');
                createBtn.onclick = async () => {
                    const name = createInput.value.trim();
                    if (!name) return;
                    await window.electronAPI.ensureDirectory(norm(cur, name));
                    createInput.value = '';
                    reload();
                };
                createWrap.appendChild(createInput);
                createWrap.appendChild(createBtn);
                side.appendChild(createWrap);

                const footer = E('div', 'folder-picker-footer');
                const tip = E('div', null, '选择后点击 “选择此目录”');
                tip.style.fontSize = '12px';
                tip.style.opacity = '.7';
                tip.style.flex = '1';
                const actions = E('div', 'folder-picker-actions');
                const cancel = E('button', 'folder-picker-btn secondary', '取消');
                const choose = E('button', 'folder-picker-btn', '选择此目录');
                cancel.onclick = () => { clean(); resolve(null); };
                choose.onclick = () => { clean(); resolve(cur); };
                actions.appendChild(cancel);
                actions.appendChild(choose);
                footer.appendChild(tip);
                footer.appendChild(actions);
                panel.appendChild(footer);
                document.body.appendChild(backdrop);
                let destroyed = false;
                function clean() { if (destroyed) return; destroyed = true; backdrop.remove(); }

                async function reload() {
                    choose.disabled = true;
                    buildBreadcrumb(cur, bar, p => { cur = p; reload(); });
                    treeWrap.innerHTML = '<div class="folder-picker-loading">读取中...</div>';
                    let entries = [], error = null;
                    try {
                        entries = await window.electronAPI.readDirectory(cur);
                    } catch (e) { error = e; }
                    const folders = (entries || []).filter(i => i.type === 'folder');
                    const f = search.value.trim().toLowerCase();
                    treeWrap.innerHTML = '';
                    if (error) {
                        const err = E('div', 'folder-picker-error');
                        err.innerHTML = '<div>无法访问该目录 (可能没有权限)</div>';
                        const backBtn = E('button', 'folder-picker-btn secondary', '返回上一级');
                        backBtn.onclick = () => {
                            const parent = cur.replace(/[\\/]+$/, '').replace(/[/\\][^/\\]+$/, '') || '/';
                            cur = parent; reload();
                        };
                        err.appendChild(backBtn);
                        treeWrap.appendChild(err);
                        choose.disabled = true;
                        return;
                    }
                    const list = folders.filter(d => !f || d.name.toLowerCase().includes(f));
                    if (list.length === 0) {
                        treeWrap.appendChild(E('div', 'folder-picker-empty', '(空目录)'));
                    }
                    list.forEach(d => {
                        const item = E('div', 'folder-picker-item folder');
                        const icon = E('span', 'folder-picker-icon');
                        icon.setAttribute('data-ui-icon', 'folder');
                        icon.setAttribute('aria-hidden', 'true');
                        const label = E('span', null, d.name);
                        item.appendChild(icon);
                        item.appendChild(label);
                        item.onclick = (ev) => {
                            selectItem(item, d);
                        };
                        item.ondblclick = () => { cur = d.path; reload(); };
                        treeWrap.appendChild(item);
                    });
                    if (window.uiIcons && typeof window.uiIcons.hydrate === 'function') {
                        window.uiIcons.hydrate(treeWrap);
                    }
                    choose.disabled = false;
                }

                function clearActive() { treeWrap.querySelectorAll('.folder-picker-item.active').forEach(i => i.classList.remove('active')); }
                function selectItem(el, d) { clearActive(); el.classList.add('active'); cur = d.path; }

                search.oninput = () => reload();
                reload();
            });
        }
    };
})();
