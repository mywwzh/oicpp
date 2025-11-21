class DebugPanel {
    constructor() {
        this.isActive = false;
        this.root = null;
        this.bound = false;
        this.expandedVars = new Set();
        this.loadingMore = new Set();
        this.variableCache = { local: {}, watches: {}, global: {} };
        this.pendingWatchRemovals = new Set();
    }

    activate() {
        this.isActive = true;
        if (!this.root) this._mount();
        if (!this.bound) this._bind();
    }

    deactivate() {
        this.isActive = false;
    }

    _mount() {
        const host = document.querySelector('#debug-panel .debug-content');
        if (!host) return;
        host.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.className = 'debug-mini-wrap';
        wrap.innerHTML = `
      <div class="debug-toolbar">
        <button id="dbg-start" class="icon-btn" title="开始">▶</button>
        <button id="dbg-continue" class="icon-btn" title="继续(F6)">⏵</button>
        <button id="dbg-step-over" class="icon-btn" title="步过(F7)">⤼</button>
        <button id="dbg-step-into" class="icon-btn" title="步入(F8)">↳</button>
        <button id="dbg-step-out" class="icon-btn" title="步出(Shift+F8)">↰</button>
        <button id="dbg-stop" class="icon-btn" title="停止">■</button>
        <div class="flex-spacer"></div>
        <input id="dbg-watch-input" class="debug-watch-input" placeholder="添加监视表达式..."/>
        <button id="dbg-add-watch" class="icon-btn" title="添加监视">＋</button>
      </div>
      <div class="debug-split">
        <div class="left">
          <div class="debug-section"><h4 class="debug-section-title">变量</h4>
            <div class="variables-panel">
              <div class="variable-category">
                <div class="category-header" data-cat="local"><span class="expand-arrow">▼</span> 局部变量</div>
                <div class="category-content"><div id="local-variables"><div class="waiting-debug-message">等待开始调试...</div></div></div>
              </div>
              <div class="variable-category">
                <div class="category-header" data-cat="watch"><span class="expand-arrow">▼</span> 监视</div>
                <div class="category-content"><div id="watch-variables"><div class="no-debug-message">暂无</div></div></div>
              </div>
            </div>
          </div>
        </div>
  </div>`;
        host.appendChild(wrap);
        this.root = wrap;
    }

    _bind() {
        this.bound = true;
        const $ = (id) => this.root && this.root.querySelector(id);
        const send = (ch, ...args) => this._ipcSend(ch, ...args);
        $('#dbg-start')?.addEventListener('click', () => (window.oicppApp?.startDebug?.() || window.app?.startDebug?.()));
        $('#dbg-continue')?.addEventListener('click', () => send('debug-continue'));
        $('#dbg-step-over')?.addEventListener('click', () => send('debug-step-over'));
        $('#dbg-step-into')?.addEventListener('click', () => send('debug-step-into'));
        $('#dbg-step-out')?.addEventListener('click', () => send('debug-step-out'));
        $('#dbg-stop')?.addEventListener('click', () => send('stop-debug'));
        $('#dbg-add-watch')?.addEventListener('click', () => {
            const input = $('#dbg-watch-input');
            const expr = input?.value?.trim();
            if (expr) { send('debug-add-watch', expr); input.value = ''; }
        });
        $('#dbg-watch-input')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const input = $('#dbg-watch-input');
                const expr = input?.value?.trim();
                if (expr) { send('debug-add-watch', expr); input.value = ''; }
            }
        });

        this.root.querySelectorAll('.category-header').forEach(el => {
            el.addEventListener('click', () => {
                const arrow = el.querySelector('.expand-arrow');
                const content = el.nextElementSibling;
                const hidden = content.style.display === 'none';
                content.style.display = hidden ? 'block' : 'none';
                arrow.textContent = hidden ? '▼' : '▶';
            });
        });

        try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.on('debug-variables-updated', (_e, variables) => this._renderVariables(variables));
            ipcRenderer.on('debug-callstack-updated', (_e, stack) => this._renderStack(stack));
            ipcRenderer.on('debug-program-exited', () => this._setToolbarEnabled(false));
            ipcRenderer.on('debug-stopped', (_e, data) => {
                if (data && (data.reason === 'program-exited' || /exited/.test(String(data.reason || '')))) {
                    this._setToolbarEnabled(false);
                }
            });
            ipcRenderer.on('debug-started', () => this._setToolbarEnabled(true));
            ipcRenderer.on('debug-running', () => this._setToolbarEnabled(true));
            ipcRenderer.on('debug-variable-expanded', (_e, payload) => this._handleVariableExpanded(payload));
            ipcRenderer.on('debug-error', (_e, msg) => {

                if (this.loadingMore.size > 0) {
                    this.loadingMore.clear();
                    this._renderVariables(this.variableCache); 
                }
                console.error('Debug Error:', msg);
            });
        } catch (_) { }

        if (this.root) {
            this.root.addEventListener('click', (ev) => {
                const toggleBtn = ev.target.closest('.expand-toggle-btn');
                if (toggleBtn && this.root.contains(toggleBtn)) {
                    this._handleToggleButtonClick(toggleBtn, ev);
                    return;
                }

                const removeBtn = ev.target.closest('.remove-watch-btn');
                if (removeBtn && this.root.contains(removeBtn)) {
                    this._handleRemoveWatchClick(removeBtn, ev);
                    return;
                }
            });
        }
    }

    _normalizeScope(scope) {
        const value = typeof scope === 'string' ? scope.toLowerCase() : '';
        if (value === 'watches') return 'watch';
        if (value === 'locals') return 'local';
        if (value === 'globals') return 'global';
        if (value) return value;
        return 'local';
    }

    _resolveBackendName(scope, rootName, data) {
        const normalizedScope = this._normalizeScope(scope);
        if (data && typeof data.backendName === 'string' && data.backendName) {
            return String(data.backendName);
        }
        if (data && typeof data.varObjectName === 'string' && data.varObjectName) {
            return String(data.varObjectName);
        }
        if (normalizedScope === 'watch') {
            if (data && typeof data.expression === 'string' && data.expression) {
                return String(data.expression);
            }
            if (data && typeof data.name === 'string' && data.name) {
                return String(data.name);
            }
        }
        if (data && typeof data.displayExpression === 'string' && data.displayExpression) {
            return String(data.displayExpression);
        }
        return rootName;
    }

    _makeNodeKey(scope, rootName, path = []) {
        const normalizedScope = this._normalizeScope(scope);
        const safeName = encodeURIComponent(rootName || '');
        if (!Array.isArray(path) || path.length === 0) {
            return `${normalizedScope}:${safeName}`;
        }
        return `${normalizedScope}:${safeName}:${path.map((p) => String(p)).join('.')}`;
    }

    _getCacheRoot(scope) {
        scope = this._normalizeScope(scope);
        if (!this.variableCache) this.variableCache = { local: {}, watches: {}, global: {} };
        if (scope === 'watch') {
            this.variableCache.watches = this.variableCache.watches || {};
            return this.variableCache.watches;
        }
        if (scope === 'global') {
            this.variableCache.global = this.variableCache.global || {};
            return this.variableCache.global;
        }
        this.variableCache.local = this.variableCache.local || {};
        return this.variableCache.local;
    }

    _getVariableNode(scope, rootName, path = []) {
        scope = this._normalizeScope(scope);
        const cacheRoot = this._getCacheRoot(scope);
        const root = cacheRoot ? cacheRoot[rootName] : null;
        if (!path || path.length === 0) return root || null;
        let node = root;
        for (const segment of path) {
            const idx = Number(segment);
            if (!node || !Array.isArray(node.children) || idx < 0 || idx >= node.children.length) {
                return null;
            }
            node = node.children[idx];
        }
        return node || null;
    }

    _pruneExpandedKeys(scope, rootName) {
        scope = this._normalizeScope(scope);
        const prefix = `${scope}:${encodeURIComponent(rootName || '')}`;
        const expandedToDelete = [];
        this.expandedVars.forEach((key) => {
            if (key === prefix || key.startsWith(`${prefix}:`)) {
                expandedToDelete.push(key);
            }
        });
        expandedToDelete.forEach((key) => this.expandedVars.delete(key));

        const loadingToDelete = [];
        this.loadingMore.forEach((key) => {
            if (key === prefix || key.startsWith(`${prefix}:`)) {
                loadingToDelete.push(key);
            }
        });
        loadingToDelete.forEach((key) => this.loadingMore.delete(key));
    }

    _setToolbarEnabled(enabled) {
        if (!this.root) return;
        ['#dbg-continue', '#dbg-step-over', '#dbg-step-into', '#dbg-step-out', '#dbg-stop', '#dbg-add-watch', '#dbg-start']
            .forEach(sel => { const el = this.root.querySelector(sel); if (el) el.disabled = false; });
    }

    _handleVariableExpanded(payload) {
        if (!payload || !payload.name) return;
        if (!this.variableCache) return;
        let scope = 'local';
        if (payload.scope === 'watch') scope = 'watch';
        else if (payload.scope === 'global') scope = 'global';
        const cacheRoot = this._getCacheRoot(scope);
        if (payload.data) {
            if (payload.path && payload.path.length > 0) {
                let current = cacheRoot[payload.name];
                if (current) {
                    for (let i = 0; i < payload.path.length - 1; i++) {
                        const idx = payload.path[i];
                        if (current.children && current.children[idx]) {
                            current = current.children[idx];
                        } else {
                            current = null;
                            break;
                        }
                    }
                    if (current && current.children) {
                        const lastIdx = payload.path[payload.path.length - 1];
                        if (current.children[lastIdx]) {
                            current.children[lastIdx] = payload.data;
                        }
                    }
                }
            } else {
                cacheRoot[payload.name] = payload.data;
            }
            
            if (scope === 'watch') {
                this.pendingWatchRemovals.delete(payload.name);
                const alias = payload.data?.expression || payload.data?.backendName || payload.data?.varObjectName;
                if (alias) {
                    this.pendingWatchRemovals.delete(String(alias));
                }
            }
        }
        this._renderVariableGroup('#local-variables', this.variableCache.local, 'local');
        this._renderVariableGroup('#watch-variables', this.variableCache.watches, 'watch');
    }

    _renderVariables(v) {
        console.log('[DebugPanel] _renderVariables:', v);
        if (!this.root) return;
        this.loadingMore.clear();
        this.variableCache = {
            local: v?.local || {},
            global: v?.global || {},
            watches: v?.watches || {}
        };

        if (this.pendingWatchRemovals.size > 0) {
            this.pendingWatchRemovals.forEach((name) => {
                if (this.variableCache.watches && this.variableCache.watches[name]) {
                    delete this.variableCache.watches[name];
                } else {
                    this.pendingWatchRemovals.delete(name);
                }
            });
        }

        this._renderVariableGroup('#local-variables', this.variableCache.local, 'local');
        this._renderVariableGroup('#watch-variables', this.variableCache.watches, 'watch');
    }

    _renderVariableGroup(selector, variables, scope) {
        scope = this._normalizeScope(scope);
        const container = this.root.querySelector(selector);
        if (!container) return;
        const names = Object.keys(variables || {});
        if (names.length === 0) {
            const emptyText = scope === 'watch' ? '暂无' : '无';
            container.innerHTML = `<div class="no-debug-message">${emptyText}</div>`;
            return;
        }

        const frag = document.createDocumentFragment();

        for (const name of names) {
            if (scope === 'watch' && this.pendingWatchRemovals.has(name)) {
                continue;
            }
            const data = variables[name] || {};
            const nodeEl = this._renderVariableNode({
                scope,
                rootName: name,
                data,
                path: [],
                isRoot: true
            });
            if (nodeEl) frag.appendChild(nodeEl);
        }

        container.innerHTML = '';
        container.appendChild(frag);
    }

    _renderVariableNode({ scope, rootName, data = {}, path = [], isRoot = false }) {
        scope = this._normalizeScope(scope);
        const nodeKey = this._makeNodeKey(scope, rootName, path);
        const item = document.createElement('div');
        item.className = isRoot ? 'variable-item' : 'variable-item variable-child';
        item.dataset.scope = scope;
        item.dataset.name = isRoot ? rootName : (data?.name != null ? String(data.name) : '');
        item.dataset.root = rootName;
        const pathSegments = Array.isArray(path) ? path.map((seg) => String(seg)) : [];
        item.dataset.path = pathSegments.join(',');
        const backendName = this._resolveBackendName(scope, rootName, data);
        item.dataset.backendName = backendName || rootName || '';

        const header = document.createElement('div');
        header.className = 'variable-header';
        item.appendChild(header);
        item.__variableData = data;

        const hasChildren = Array.isArray(data?.children) && data.children.length > 0;
        const numericCount = Number(data?.elementCount);
        const elementCount = Number.isFinite(numericCount)
            ? numericCount
            : (hasChildren ? data.children.filter(ch => !ch?.isPlaceholder).length : null);
        const inferredExpandable = this._isExpandableVariable(data, elementCount, hasChildren);
        const extraExpandable = Number.isFinite(Number(data?.numchild)) && Number(data.numchild) > 0;
        const canExpand = inferredExpandable || !!data?.canExpand || extraExpandable;
        const isWatchScope = scope === 'watch';
        const isWatchRoot = isRoot && isWatchScope;
        let shouldShowToggle = canExpand || hasChildren || this._shouldForceToggle(scope, data, elementCount);
        if (isWatchRoot) {
            shouldShowToggle = true;
        }
        const needsLabel = (isRoot && scope === 'watch') || this._shouldEmphasizeToggle(data);
        const isExpanded = this.expandedVars.has(nodeKey);

        let toggleEl = null;
        if (isWatchRoot) {
            toggleEl = document.createElement('button');
            toggleEl.type = 'button';
            toggleEl.className = 'expand-toggle-btn force-visible';
            this._applyForceToggleStyles(toggleEl);
            toggleEl.style.zIndex = '100'; // Ensure on top
            toggleEl.style.position = 'relative';
            this._updateToggleButton(toggleEl, isExpanded);
            header.appendChild(toggleEl);
        }

        if (!toggleEl && shouldShowToggle) {
            toggleEl = document.createElement('button');
            toggleEl.type = 'button';
            toggleEl.className = 'expand-toggle-btn';
            if (needsLabel) toggleEl.classList.add('with-label');
            this._updateToggleButton(toggleEl, isExpanded);
            header.appendChild(toggleEl);
        }

        if (!toggleEl) {
            const spacer = document.createElement('span');
            spacer.className = 'expand-spacer';
            header.appendChild(spacer);
        } else {
            toggleEl.dataset.nodeKey = nodeKey;
            toggleEl.dataset.scope = scope;
            toggleEl.dataset.root = rootName;
            toggleEl.dataset.path = item.dataset.path || '';
            toggleEl.dataset.backendName = backendName || rootName || '';
        }

        const nameEl = document.createElement('span');
        nameEl.className = 'variable-name';
        const displayName = isRoot ? rootName : (data?.name != null ? String(data.name) : '');
        nameEl.textContent = displayName;
        if (data?.type) {
            nameEl.title = data.type;
        }
        header.appendChild(nameEl);

        const valueEl = document.createElement('span');
        valueEl.className = 'variable-value';
        const rawValue = data?.value != null ? String(data.value) : '';
        const valueText = isRoot ? this._formatValue(data) : rawValue;
        valueEl.textContent = valueText;
        if (rawValue) valueEl.title = rawValue;
        header.appendChild(valueEl);

        let removeBtn = null;
        if (isRoot && scope === 'watch') {
            const rm = document.createElement('button');
            rm.className = 'remove-watch-btn';
            rm.title = '移除';
            rm.textContent = '×';
            const watchExpression = (data && typeof data.expression === 'string' && data.expression)
                ? String(data.expression)
                : backendName || rootName;
            if (watchExpression) {
                rm.dataset.watchExpression = watchExpression;
            }
            rm.dataset.scope = scope;
            rm.dataset.root = rootName;
            rm.dataset.backendName = backendName || rootName || '';
            rm.addEventListener('mousedown', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
            });
            header.appendChild(rm);
            removeBtn = rm;
        }

        const childrenWrap = document.createElement('div');
        childrenWrap.className = 'variable-children';
        if (!isExpanded) {
            childrenWrap.style.display = 'none';
        }
        childrenWrap.dataset.nodeKey = nodeKey;
        item.appendChild(childrenWrap);

        header.addEventListener('dblclick', (ev) => {
            if (!toggleEl) return;
            if (removeBtn && (ev.target === removeBtn || removeBtn.contains(ev.target))) return;
            if (ev.target === toggleEl || toggleEl.contains(ev.target)) return;
            ev.preventDefault();
            ev.stopPropagation();
            toggleEl.click();
        });

        if (isExpanded) {
            const latestNode = this._getVariableNode(scope, rootName, path) || data;
            this._renderVariableChildren(childrenWrap, latestNode?.children, rootName, scope, path, latestNode);
        }

        return item;
    }

    _parsePathSegments(pathStr) {
        if (!pathStr) return [];
        return pathStr
            .split(',')
            .filter(segment => segment.length > 0)
            .map((segment) => {
                const maybeNumber = Number(segment);
                return Number.isNaN(maybeNumber) ? segment : maybeNumber;
            });
    }

    _handleToggleButtonClick(button, ev) {
        if (!button) return;
        if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
        }
        const item = button.closest('.variable-item');
        if (!item) return;
        const scope = this._normalizeScope(button.dataset.scope || item.dataset.scope);
        const rootName = button.dataset.root || item.dataset.root || item.dataset.name || '';
        const path = this._parsePathSegments(button.dataset.path || item.dataset.path || '');
        const nodeKey = button.dataset.nodeKey
            || item.querySelector('.variable-children')?.dataset.nodeKey
            || this._makeNodeKey(scope, rootName, path);
        const backendName = button.dataset.backendName || item.dataset.backendName || rootName;
        const childrenWrap = item.querySelector(`.variable-children[data-node-key="${nodeKey}"]`) || item.querySelector('.variable-children');
        if (!childrenWrap) return;

        const currentlyExpanded = this.expandedVars.has(nodeKey);
        if (currentlyExpanded) {
            this.expandedVars.delete(nodeKey);
            childrenWrap.style.display = 'none';
            this._updateToggleButton(button, false);
            const collapseTarget = backendName || rootName;
            this._ipcSend('debug-collapse-variable', collapseTarget, { scope, path, cacheKey: nodeKey });
            return;
        }

        this.expandedVars.add(nodeKey);
        this._updateToggleButton(button, true);
        childrenWrap.style.display = 'block';
        const latestNode = this._getVariableNode(scope, rootName, path);
        const candidate = latestNode || item.__variableData || {};
        const childData = Array.isArray(candidate?.children) ? candidate.children : [];
        if (childData.length > 0) {
            this._renderVariableChildren(childrenWrap, childData, rootName, scope, path, candidate);
            return;
        }

        childrenWrap.innerHTML = '<div class="no-debug-message">加载中…</div>';
        const payload = {
            scope,
            path,
            cacheKey: nodeKey,
            start: 0
        };
        if (candidate?.varObjectName) payload.varObjectName = candidate.varObjectName;
        if (candidate?.expression) payload.expression = candidate.expression;
        if (candidate?.chunkSize && Number(candidate.chunkSize) > 0) {
            payload.count = Number(candidate.chunkSize);
        }
        const expandTarget = candidate?.expression || candidate?.varObjectName || backendName || rootName;
        this._ipcSend('debug-expand-variable', expandTarget, payload);
    }

    _handleRemoveWatchClick(button, ev) {
        if (!button) return;
        if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
        }
        const item = button.closest('.variable-item');
        if (!item) return;
        const scope = this._normalizeScope(button.dataset.scope || item.dataset.scope);
        if (scope !== 'watch') return;
        const rootName = button.dataset.root || item.dataset.root || item.dataset.name || '';
        const removalKey = button.dataset.watchExpression
            || button.dataset.backendName
            || item.dataset.backendName
            || rootName;
        if (!removalKey) return;

        this._ipcSend('debug-remove-watch', removalKey);
        this._pruneExpandedKeys(scope, removalKey);
        if (removalKey !== rootName) {
            this._pruneExpandedKeys(scope, rootName);
        }
        this.pendingWatchRemovals.add(rootName);
        if (removalKey && removalKey !== rootName) {
            this.pendingWatchRemovals.add(removalKey);
        }
        const cacheRoot = this._getCacheRoot(scope);
        if (cacheRoot) {
            if (Object.prototype.hasOwnProperty.call(cacheRoot, rootName)) {
                delete cacheRoot[rootName];
            }
            if (removalKey && removalKey !== rootName && Object.prototype.hasOwnProperty.call(cacheRoot, removalKey)) {
                delete cacheRoot[removalKey];
            }
        }
        this._renderVariableGroup('#watch-variables', this._getCacheRoot(scope), scope);
        try { item.remove(); } catch (_) { }
    }

    _applyForceToggleStyles(button) {
        if (!button) return;
        button.classList.add('force-visible');
    }

    _updateToggleButton(button, expanded) {
        if (!button) return;
        const forceVisible = button.classList.contains('force-visible');
        const withLabel = button.classList.contains('with-label');
        const arrow = expanded ? '▼' : '▶';
        if (forceVisible) {
            button.textContent = arrow;
        } else if (withLabel) {
            const text = expanded ? '收起' : '展开';
            button.innerHTML = `<span class="arrow">${arrow}</span><span class="label">${text}</span>`;
        } else {
            button.textContent = arrow;
        }
        button.setAttribute('aria-label', expanded ? '折叠变量' : '展开变量');
    }

    _shouldForceToggle(scope, data, elementCount) {
        if (this._normalizeScope(scope) !== 'watch') return false;
        if (!data) return false;
        if (data.isArray || data.isContainer) return true;
        if (Number.isFinite(elementCount) && elementCount > 0) return true;
        const hint = `${data.type || ''} ${data.value || ''}`.toLowerCase();
        if (/std::/.test(hint)) return true;
        const rawVal = String(data.value || '').trim();
        if (rawVal.startsWith('{') && rawVal.endsWith('}')) return true;
        return false;
    }

    _shouldEmphasizeToggle(data) {
        if (!data) return false;
        if (data.isArray || data.isContainer) return true;
        const hint = `${data.type || ''} ${data.value || ''}`.toLowerCase();
        return /std::/.test(hint);
    }

    _isExpandableVariable(data, elementCount, hasChildren) {
        if (!data) return false;
        if (hasChildren) return true;
        if (elementCount != null && elementCount > 0) return true;
        if (data.isContainer || data.isArray) return true;
        const typeStr = String(data.type || '');
        const valueStr = String(data.value || '');
        const stdContainerPattern = /std::(vector|array|deque|list|forward_list|basic_string|u8string|u16string|u32string|wstring|set|map|unordered_set|unordered_map|multiset|multimap|queue|stack)\b/;
        if (stdContainerPattern.test(typeStr) || stdContainerPattern.test(valueStr)) return true;
        const trimmed = valueStr.trim();
        if (/^\{.*\}$/.test(trimmed)) return true;
        if (trimmed.includes('{') && trimmed.includes('}')) return true;
        return false;
    }

    _extractChildrenData(scope, name) {
        const node = this._getVariableNode(scope, name, []);
        return Array.isArray(node?.children) ? node.children : [];
    }

    _renderVariableChildren(container, children, rootName, scope, parentPath = [], parentData = null) {
        scope = this._normalizeScope(scope);
        if (!container) return;
        container.innerHTML = '';
        const list = Array.isArray(children) ? children : [];
        if (list.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'no-debug-message';
            empty.textContent = '无子项';
            container.appendChild(empty);
            return;
        }

        const loadedCount = list.filter(child => !child?.isPlaceholder).length;
        container.dataset.loadedCount = String(loadedCount);

        list.forEach((child, index) => {
            if (child && child.isPlaceholder) {
                const more = document.createElement('div');
                more.className = 'variable-item more-items';
                const label = document.createElement('span');
                label.className = 'variable-name';
                label.textContent = child.name || '更多…';
                const val = document.createElement('span');
                val.className = 'variable-value';
                val.textContent = child.value || '点击加载更多';
                more.appendChild(label);
                more.appendChild(val);

                more.addEventListener('click', (ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const parentKey = this._makeNodeKey(scope, rootName, parentPath);
                    if (this.loadingMore.has(parentKey)) return;
                    this.loadingMore.add(parentKey);
                    val.textContent = '加载中…';
                    const latestParent = this._getVariableNode(scope, rootName, parentPath) || parentData || {};
                    const nextIndex = Number.isFinite(child.nextIndex) ? child.nextIndex : loadedCount;
                    const count = Number.isFinite(child.chunkSize) && child.chunkSize > 0 ? child.chunkSize : 100;
                    const payload = {
                        scope,
                        path: parentPath,
                        start: nextIndex,
                        count,
                        append: true,
                        cacheKey: parentKey
                    };
                    if (latestParent?.varObjectName) payload.varObjectName = latestParent.varObjectName;
                    if (latestParent?.expression) payload.expression = latestParent.expression;
                    const loadMoreTarget = latestParent?.expression || latestParent?.varObjectName || rootName;
                    this._ipcSend('debug-load-more-variable', loadMoreTarget, payload);
                    setTimeout(() => this.loadingMore.delete(parentKey), 800);
                });

                container.appendChild(more);
                return;
            }

            const childPath = parentPath.concat(index);
            const nodeEl = this._renderVariableNode({
                scope,
                rootName,
                data: child,
                path: childPath,
                isRoot: false
            });
            if (nodeEl) container.appendChild(nodeEl);
        });
    }

    _ipcSend(channel, ...args) {
        console.log(`[DebugPanel] Sending IPC: ${channel}`, args);
        try {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send(channel, ...args);
            return;
        } catch (_) { }
        try {
            window?.electron?.ipcRenderer?.send?.(channel, ...args);
            return;
        } catch (_) { }
        try {
            window?.electronAPI?.ipcRenderer?.send?.(channel, ...args);
        } catch (_) { }
    }

    _renderStack(stack) {
        const c = this.root.querySelector('#call-stack');
        if (!c) return;
        c.innerHTML = '';
        if (!Array.isArray(stack) || stack.length === 0) { c.innerHTML = '<div class="no-debug-message">无</div>'; return; }
        for (let i = 0; i < stack.length; i++) {
            const f = stack[i];
            const el = document.createElement('div');
            el.className = 'callstack-item';
            el.innerHTML = `
        <div class="frame-info"><span class="frame-index">#${i}</span><span class="frame-function">${f.function || '未知函数'}</span></div>
        <div class="frame-location"><span class="frame-file">${f.file || '未知文件'}</span>${f.line ? `<span class="frame-line">:${f.line}</span>` : ''}</div>`;
            c.appendChild(el);
        }
    }

    _formatValue(data) {
        if (!data) return '';
        let display = data.value || '';
        if (data.isArray || data.isContainer) {
            const cnt = data.elementCount != null ? data.elementCount : '?';
            display = `${data.isArray ? '数组' : '容器'}[${cnt}] ${display}`;
        }
        if (display.length > 60) display = display.slice(0, 57) + '...';
        return display;
    }
}

if (typeof window !== 'undefined') {
    window.DebugPanel = DebugPanel;
}