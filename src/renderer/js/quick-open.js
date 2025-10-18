(function () {
    let allFiles = [];
    let indexedRoot = '';
    const overlay = document.getElementById('quick-open-overlay');
    const input = document.getElementById('quick-open-input');
    const results = document.getElementById('quick-open-results');
    const titleTrigger = document.getElementById('titlebar-quickopen');
    let activeIndex = -1;

    if (!overlay || !input || !results) return;

    function fuzzyScore(query, fullPath) {
        if (!query) return 0;
        const q = query.toLowerCase();
        const p = fullPath.toLowerCase();
        const lastSlash = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
        const base = p.slice(lastSlash + 1);
        if (base === q) return 10_000;
        if (p === q) return 9_000;
        if (base.endsWith(q)) return 8_000 - base.length; // 越短越靠前
        if (base.startsWith(q)) return 7_000 - base.length;
        if (base.includes(q)) return 6_000 - base.indexOf(q);
        let qi = 0, score = 0;
        for (let i = 0; i < p.length && qi < q.length; i++) {
            if (p[i] === q[qi]) { score += 2; qi++; }
            else if (q.includes(p[i])) { score += 1; }
        }
        if (qi === q.length) score += 5;
        return score;
    }

    function render(list) {
        results.innerHTML = '';
        if (list.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'quick-open-empty';
            empty.textContent = '未找到匹配项';
            results.appendChild(empty);
            return;
        }
        list.slice(0, 200).forEach((item, idx) => {
            const row = document.createElement('div');
            row.className = 'quick-open-item';
            if (idx === activeIndex) row.classList.add('active');
            const name = document.createElement('div');
            name.className = 'name';
            name.textContent = item.name;
            const sub = document.createElement('div');
            sub.className = 'sub';
            sub.textContent = item.path;
            row.appendChild(name);
            row.appendChild(sub);
            row.addEventListener('click', () => openFile(item));
            results.appendChild(row);
        });
    }

    let lastList = [];
    function search(query) {
        if (!query) { render(allFiles.slice(0, 100)); return; }
        const ranked = allFiles.map(f => ({ ...f, __s: fuzzyScore(query, f.path) }))
            .filter(x => x.__s > 0)
            .sort((a, b) => b.__s - a.__s || a.path.length - b.path.length);
        lastList = ranked;
        activeIndex = ranked.length ? 0 : -1;
        render(ranked);
    }

    async function ensureIndex() {
        const fileExplorer = window.sidebarManager?.panels?.files;
        const root = fileExplorer?.currentPath || fileExplorer?.workspacePath || '';
        if (!root) return false;
        if (indexedRoot === root && allFiles.length > 0) return true;
        indexedRoot = root;
        try {
            const res = await window.electronAPI.walkDirectory(root, { excludeGlobs: ['node_modules', '.git', '.oicpp', '.vscode'] });
            if (res && res.success) {
                allFiles = res.files || [];
                return true;
            }
        } catch (e) {
            (window.logWarn || console.warn)('walkDirectory 失败:', e);
        }
        return false;
    }

    function open() {
        overlay.classList.add('open');
        input.value = '';
        input.focus();
        lastList = allFiles.slice(0, 100);
        activeIndex = lastList.length ? 0 : -1;
        render(lastList);
    }

    function close() {
        overlay.classList.remove('open');
    }

    async function openFile(item) {
        try {
            const isPdf = item?.name?.toLowerCase?.().endsWith('.pdf');
            if (isPdf) {
                if (window.tabManager?.openFile) {
                    await window.tabManager.openFile(item.name, '', false, { filePath: item.path, viewType: 'pdf' });
                } else {
                    (window.logWarn || console.warn)('tabManager 不可用，无法打开PDF:', item?.path);
                }
                close();
                return;
            }
            const content = await window.electronAPI.readFileContent(item.path);
            const fileName = item.name;
            if (window.tabManager?.openFile) {
                window.tabManager.openFile(fileName, content, false, item.path);
            } else if (window.editorManager?.openFile) {
                window.editorManager.openFile(item.path, content);
            }
            close();
        } catch (e) {
            (window.logError || console.error)('打开文件失败:', e);
        }
    }
    input.addEventListener('input', () => search(input.value.trim()));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'Enter') {
            const list = lastList && lastList.length ? lastList : allFiles;
            if (list.length > 0) {
                const idx = activeIndex >= 0 && activeIndex < list.length ? activeIndex : 0;
                openFile(list[idx]);
            }
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            const list = lastList && lastList.length ? lastList : allFiles;
            if (list.length) {
                activeIndex = Math.min((activeIndex < 0 ? 0 : activeIndex) + 1, list.length - 1);
                render(list);
                ensureActiveVisible();
            }
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const list = lastList && lastList.length ? lastList : allFiles;
            if (list.length) {
                activeIndex = Math.max((activeIndex < 0 ? 0 : activeIndex) - 1, 0);
                render(list);
                ensureActiveVisible();
            }
        }
    });

    function ensureActiveVisible() {
        const items = results.querySelectorAll('.quick-open-item');
        if (!items || !items.length || activeIndex < 0) return;
        const el = items[activeIndex];
        const rTop = results.scrollTop;
        const rBottom = rTop + results.clientHeight;
        const eTop = el.offsetTop;
        const eBottom = eTop + el.offsetHeight;
        if (eTop < rTop) results.scrollTop = eTop;
        else if (eBottom > rBottom) results.scrollTop = eBottom - results.clientHeight;
    }

    document.addEventListener('keydown', async (e) => {
        const isInEditor = e.target.closest?.('.monaco-editor');
        if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
            e.preventDefault();
            const ok = await ensureIndex();
            if (ok) open();
        }
    });

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    window.quickOpen = { open, close, ensureIndex };

    if (titleTrigger) {
        titleTrigger.addEventListener('click', async (e) => {
            e.preventDefault();
            const ok = await ensureIndex();
            if (ok) open();
        });
    }
})();
