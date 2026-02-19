class CloudSyncPanel {
    constructor() {
        this.rootPath = '/';
        this.currentPath = '/';
        this.itemsCache = new Map();
        this.expandedFolders = new Set(['/']);
        this.selectedItems = new Map();
        this.remainingFiles = null;
        this.allowedExtensions = new Set(['.ans', '.in', '.out', '.cpp', '.py', '.txt', '.md']);
        this.maxFileSize = 20 * 1024;
        this.isLoading = false;
        this._lastLoggedIn = false;
        this._contextMenu = null;
        this.init();
    }

    init() {
        this.treeEl = document.getElementById('cloud-tree');
        this.summaryEl = document.getElementById('cloud-summary');
        this.remainingEl = document.getElementById('cloud-remaining');
        this.uploadProgressEl = document.getElementById('cloud-upload-progress');
        this.uploadProgressTextEl = document.getElementById('cloud-upload-progress-text');
        this.uploadProgressFillEl = document.getElementById('cloud-upload-progress-fill');
        this.bindHeaderActions();
        this.setupTreeEvents();
        this.setupKeyboardShortcuts();
        this.renderEmptyState('请先登录账户');
    }

    bindHeaderActions() {
        const panel = document.getElementById('cloud-panel');
        if (!panel) return;
        panel.querySelectorAll('.icon-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                switch (action) {
                    case 'cloud-new-file':
                        this.createNewFile();
                        break;
                    case 'cloud-new-folder':
                        this.createNewFolder();
                        break;
                    case 'cloud-upload':
                        this.uploadLocalFile();
                        break;
                    case 'cloud-upload-folder':
                        this.uploadLocalFolder();
                        break;
                    case 'cloud-refresh':
                        this.refresh();
                        break;
                }
            });
        });
    }

    setupTreeEvents() {
        if (!this.treeEl) return;
        this.treeEl.addEventListener('click', (e) => {
            const item = e.target.closest('.tree-item');
            if (!item) return;
            const path = item.dataset.path;
            const type = item.dataset.kind;
            const name = item.dataset.name;
            const file = { path, type, name, extension: this.getExtension(name) };
            this.selectItem(file, { toggle: e.ctrlKey || e.metaKey });
            if (type === 'folder') {
                this.toggleFolder(item, file);
            } else if (type === 'file') {
                this.openCloudFile(file);
            }
        });

        this.treeEl.addEventListener('dblclick', (e) => {
            const item = e.target.closest('.tree-item');
            if (!item) return;
            const path = item.dataset.path;
            const type = item.dataset.kind;
            const name = item.dataset.name;
            const file = { path, type, name, extension: this.getExtension(name) };
            this.selectItem(file);
            if (type === 'folder') {
                this.toggleFolder(item, file);
            } else if (type === 'file') {
                this.openCloudFile(file);
            }
        });

        this.treeEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const item = e.target.closest('.tree-item');
            if (!item) {
                this.clearSelection();
                this.showEmptyAreaContextMenu(e);
                return;
            }
            const path = item.dataset.path;
            const type = item.dataset.kind;
            const name = item.dataset.name;
            const file = { path, type, name, extension: this.getExtension(name) };
            if (!this.selectedItems.has(path)) {
                this.selectItem(file);
            }
            this.showItemContextMenu(e, file);
        });

        this.treeEl.addEventListener('click', (e) => {
            if (e.target === this.treeEl) {
                this.clearSelection();
            }
        });

        this.setupDragAndDrop();
    }

    setupDragAndDrop() {
        const clearDragState = () => {
            document.querySelectorAll('.tree-item.drag-over').forEach(node => node.classList.remove('drag-over'));
            if (this.treeEl) {
                this.treeEl.classList.remove('drag-over-root');
            }
        };

        this.treeEl.addEventListener('dragstart', (e) => {
            const item = e.target.closest('.tree-item');
            if (!item) return;
            const path = item.dataset.path;
            const type = item.dataset.kind;
            const name = item.dataset.name;
            if (!path || !type) return;
            const payload = JSON.stringify({ path, type, name });
            e.dataTransfer?.setData('text/plain', payload);
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
            item.classList.add('dragging');
        });

        this.treeEl.addEventListener('dragend', (e) => {
            const item = e.target.closest('.tree-item');
            if (item) item.classList.remove('dragging');
            clearDragState();
        });

        this.treeEl.addEventListener('dragover', (e) => {
            e.preventDefault();
            clearDragState();
            const item = e.target.closest('.tree-item');
            if (!item) {
                this.treeEl.classList.add('drag-over-root');
                return;
            }
            const type = item.dataset.kind;
            if (type === 'folder') {
                item.classList.add('drag-over');
            }
        });

        this.treeEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            clearDragState();
            const data = e.dataTransfer?.getData('text/plain');
            if (!data) return;
            let payload;
            try { payload = JSON.parse(data); } catch (_) { return; }
            if (!payload?.path || !payload?.type) return;

            const item = e.target.closest('.tree-item');
            let targetFolder = '/';
            if (item && item.dataset.kind === 'folder') {
                targetFolder = item.dataset.path;
            }

            await this.moveItem(payload, targetFolder);
        });
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', async (e) => {
            const currentPanel = window.sidebarManager?.getCurrentPanel?.();
            if (currentPanel !== 'cloud') return;
            const activeElement = document.activeElement;
            const tag = (activeElement && activeElement.tagName) ? activeElement.tagName.toLowerCase() : '';
            const isTyping = tag === 'input' || tag === 'textarea' || !!activeElement?.isContentEditable;
            if (isTyping) return;

            const target = this.getPrimarySelection();
            if (!target) return;

            if (e.key === 'Delete') {
                e.preventDefault();
                await this.deleteItem(target);
            }
            if (e.key === 'F2') {
                e.preventDefault();
                await this.renameItem(target);
            }
        }, true);
    }

    setLoggedInState(loggedIn) {
        this._lastLoggedIn = !!loggedIn;
        if (!loggedIn) {
            this.itemsCache.clear();
            this.expandedFolders = new Set(['/']);
            this.selectedItems.clear();
            this.updateRemaining(null);
            this.renderEmptyState('请先登录账户');
            return;
        }
        this.refresh();
    }

    async activate() {
        try {
            if (window.electronAPI?.getIdeLoginStatus) {
                const status = await window.electronAPI.getIdeLoginStatus();
                this._lastLoggedIn = !!status?.loggedIn;
            }
        } catch (_) { }

        if (!this._lastLoggedIn) {
            this.renderEmptyState('请先登录账户');
            return;
        }
        this.refresh();
    }

    async refresh() {
        if (this.isLoading) return;
        if (!this._lastLoggedIn) {
            this.renderEmptyState('请先登录账户');
            return;
        }
        this.isLoading = true;
        try {
            await this.loadDirectory('/');
            this.renderTree();
        } catch (error) {
            this.showMessage(error?.message || '刷新失败', 'error');
        } finally {
            this.isLoading = false;
        }
    }

    async loadDirectory(dirPath) {
        const data = await this.request('GET', '/cloudSync/list', { path: dirPath });
        if (!data) return;
        const items = Array.isArray(data.items) ? data.items : [];
        const normalized = items.map(item => ({
            name: item.name,
            type: item.type,
            path: this.normalizePath(item.path || this.joinPath(dirPath, item.name)),
            size: item.size || 0,
            updatedAt: item.updated_at || item.updatedAt || null
        }));
        const filtered = normalized.filter(item => !this.isHiddenSettingsBackupName(item.name));
        this.itemsCache.set(this.normalizePath(dirPath), filtered);
        if (typeof data.remainingFiles === 'number') {
            this.updateRemaining(data.remainingFiles);
        }
    }

    renderTree() {
        if (!this.treeEl) return;
        const rootItems = this.itemsCache.get('/') || [];
        if (rootItems.length === 0) {
            this.renderEmptyState('云空间还没有文件');
            return;
        }
        this.treeEl.innerHTML = '';
        const fragment = document.createDocumentFragment();
        this.renderItemsRecursive('/', 0, fragment);
        this.treeEl.appendChild(fragment);
    }

    renderItemsRecursive(dirPath, level, container) {
        const items = this.itemsCache.get(this.normalizePath(dirPath)) || [];
        const sorted = [...items].sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name, 'zh-CN');
        });

        for (const item of sorted) {
            const node = this.createTreeItem(item, level);
            container.appendChild(node);
            if (item.type === 'folder' && this.expandedFolders.has(item.path)) {
                this.renderItemsRecursive(item.path, level + 1, container);
            }
        }
    }

    createTreeItem(item, level) {
        const node = document.createElement('div');
        node.className = 'tree-item';
        node.dataset.path = item.path;
        node.dataset.kind = item.type;
        if (item.type === 'folder') {
            node.dataset.type = 'folder';
        } else {
            const ext = this.getExtension(item.name);
            node.dataset.type = ext ? ext.replace(/^\./, '') : 'file';
        }
        node.dataset.name = item.name;
        node.style.paddingLeft = `${level * 16 + 8}px`;
        node.setAttribute('draggable', 'true');

        const content = document.createElement('div');
        content.className = 'tree-item-content';

        if (item.type === 'folder') {
            const arrow = document.createElement('span');
            arrow.className = 'tree-item-arrow';
            arrow.textContent = this.expandedFolders.has(item.path) ? '▼' : '▶';
            content.appendChild(arrow);
        }

        const icon = document.createElement('span');
        icon.className = 'tree-item-icon';
        const iconName = this.getFileIcon(item);
        if (window.uiIcons && typeof window.uiIcons.svg === 'function') {
            icon.innerHTML = window.uiIcons.svg(iconName);
        }
        const label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = item.name;

        content.appendChild(icon);
        content.appendChild(label);
        node.appendChild(content);

        if (this.selectedItems.has(item.path)) {
            node.classList.add('selected');
        }

        return node;
    }

    async moveItem(payload, targetFolder) {
        const sourcePath = this.normalizePath(payload.path);
        const sourceType = payload.type;
        const name = payload.name || this.getBaseName(sourcePath);
        const targetPath = this.joinPath(targetFolder, name);

        if (sourcePath === targetPath) return;
        if (sourceType === 'folder' && this.isDescendantPath(targetPath, sourcePath)) {
            this.showMessage('不能将文件夹移动到自身或子目录中', 'warning');
            return;
        }

        const ok = await window.dialogManager?.showConfirmDialog?.('移动确认', `确定移动 ${name} 到 ${targetFolder} 吗？`);
        if (ok === false) return;

        try {
            if (sourceType === 'file') {
                const fileData = await this.request('GET', '/cloudSync/download', { path: sourcePath });
                const content = typeof fileData?.content === 'string' ? fileData.content : '';
                await this.request('POST', '/cloudSync/upload', { path: targetPath, content });
                await this.request('POST', '/cloudSync/delete', { path: sourcePath });
            } else if (sourceType === 'folder') {
                await this.copyFolderRecursive(sourcePath, targetPath);
                await this.request('POST', '/cloudSync/delete', { path: sourcePath });
            }
            const sourceParent = this.getParentPath(sourcePath);
            const targetParent = this.getParentPath(targetPath);
            await this.loadDirectory(sourceParent);
            if (targetParent !== sourceParent) {
                await this.loadDirectory(targetParent);
            }
            if (sourceType === 'folder') {
                if (this.itemsCache.has(sourcePath)) {
                    const cached = this.itemsCache.get(sourcePath);
                    this.itemsCache.delete(sourcePath);
                    this.itemsCache.set(targetPath, cached);
                }
                if (this.expandedFolders.has(sourcePath)) {
                    this.expandedFolders.delete(sourcePath);
                    this.expandedFolders.add(targetPath);
                }
            }
            this.renderTree();
            this.showMessage('移动完成', 'success');
        } catch (error) {
            this.showMessage(error?.message || '移动失败', 'error');
        }
    }

    async copyFolderRecursive(sourcePath, targetPath) {
        await this.request('POST', '/cloudSync/createFolder', { path: targetPath });
        const data = await this.request('GET', '/cloudSync/list', { path: sourcePath });
        const items = Array.isArray(data?.items) ? data.items : [];
        for (const item of items) {
            const itemPath = this.normalizePath(item.path || this.joinPath(sourcePath, item.name));
            const destPath = this.joinPath(targetPath, item.name);
            if (item.type === 'folder') {
                await this.copyFolderRecursive(itemPath, destPath);
                await this.request('POST', '/cloudSync/delete', { path: itemPath });
            } else {
                const fileData = await this.request('GET', '/cloudSync/download', { path: itemPath });
                const content = typeof fileData?.content === 'string' ? fileData.content : '';
                await this.request('POST', '/cloudSync/upload', { path: destPath, content });
                await this.request('POST', '/cloudSync/delete', { path: itemPath });
            }
        }
    }

    isDescendantPath(target, source) {
        const src = this.normalizePath(source);
        const tgt = this.normalizePath(target);
        return tgt.startsWith(src + '/');
    }

    getBaseName(p) {
        const norm = this.normalizePath(p);
        const parts = norm.split('/').filter(Boolean);
        return parts.length ? parts[parts.length - 1] : '';
    }

    getFileIcon(item) {
        if (item.type === 'folder') return 'folder';
        const ext = this.getExtension(item.name);
        switch (ext) {
            case '.cpp':
                return 'fileCode';
            case '.py':
                return 'fileCode';
            case '.txt':
                return 'fileText';
            case '.in':
                return 'fileIn';
            case '.out':
                return 'fileOut';
            case '.ans':
                return 'check';
            default:
                return 'file';
        }
    }

    isHiddenSettingsBackupName(name) {
        const raw = String(name || '').trim();
        const base = raw.split('/').filter(Boolean).pop() || raw;
        return /^OICPP_user_\d{8}_\d{6}_.+_settings\.cpp$/i.test(base);
    }

    toggleFolder(node, folder) {
        if (folder.type !== 'folder') return;
        const path = folder.path;
        if (this.expandedFolders.has(path)) {
            this.expandedFolders.delete(path);
            this.renderTree();
            return;
        }
        this.expandedFolders.add(path);
        if (!this.itemsCache.has(path)) {
            this.loadDirectory(path).then(() => this.renderTree()).catch(err => {
                this.showMessage(err?.message || '加载文件夹失败', 'error');
                this.renderTree();
            });
        } else {
            this.renderTree();
        }
    }

    selectItem(item, options = {}) {
        const toggle = !!options.toggle;
        if (!toggle) {
            this.selectedItems.clear();
        }
        if (this.selectedItems.has(item.path) && toggle) {
            this.selectedItems.delete(item.path);
        } else {
            this.selectedItems.set(item.path, item);
        }
        this.renderTree();
    }

    clearSelection() {
        if (this.selectedItems.size === 0) return;
        this.selectedItems.clear();
        this.renderTree();
    }

    getPrimarySelection() {
        for (const item of this.selectedItems.values()) {
            return item;
        }
        return null;
    }

    async openCloudFile(file) {
        try {
            const data = await this.request('GET', '/cloudSync/download', { path: file.path });
            const content = typeof data?.content === 'string' ? data.content : '';
            const fileName = file.name;
            if (window.tabManager && typeof window.tabManager.openFile === 'function') {
                await window.tabManager.openFile(fileName, content, false, `cloud://${file.path}`);
                if (window.tabManager.markTabAsSavedByUniqueKey) {
                    window.tabManager.markTabAsSavedByUniqueKey(`cloud://${file.path}`);
                }
            }
        } catch (error) {
            this.showMessage(error?.message || '打开文件失败', 'error');
        }
    }

    async saveCloudFile(cloudPath, content) {
        if (!this._lastLoggedIn) {
            this.showMessage('请先登录账户', 'warning');
            return false;
        }
        const bytes = new TextEncoder().encode(content || '').length;
        if (bytes > this.maxFileSize) {
            this.showMessage('文件大小超过 20KB，无法上传', 'error');
            return false;
        }
        const ext = this.getExtension(cloudPath);
        if (!this.allowedExtensions.has(ext)) {
            this.showMessage('仅支持 .ans .in .out .cpp .py .txt .md', 'error');
            return false;
        }
        try {
            await this.request('POST', '/cloudSync/upload', {
                path: cloudPath,
                content: content || ''
            });
            await this.loadDirectory(this.getParentPath(cloudPath));
            this.renderTree();
            return true;
        } catch (error) {
            this.showMessage(error?.message || '保存失败', 'error');
            return false;
        }
    }

    async createNewFile() {
        if (!this._lastLoggedIn) {
            this.showMessage('请先登录账户', 'warning');
            return;
        }
        const name = await window.dialogManager?.showInputDialog('新建云端文件', 'untitled.cpp', '请输入文件名');
        if (!name) return;
        const check = this.validateFileName(name);
        if (!check.valid) {
            this.showMessage(check.error, 'error');
            return;
        }
        const ext = this.getExtension(name);
        if (!this.allowedExtensions.has(ext)) {
            this.showMessage('仅支持 .ans .in .out .cpp .py .txt .md', 'error');
            return;
        }
        if (!this.checkRemainingCapacity()) return;
        const targetDir = this.getActionTargetFolder();
        await this.ensureDirectoryLoaded(targetDir);
        if (this.hasNameInDirectory(targetDir, name)) {
            this.showMessage('已存在同名文件或文件夹，请更换名称', 'warning');
            return;
        }
        const fullPath = this.joinPath(targetDir, name);
        try {
            await this.request('POST', '/cloudSync/upload', { path: fullPath, content: '' });
            await this.loadDirectory(targetDir);
            this.renderTree();
            this.openCloudFile({ path: fullPath, name, type: 'file' });
        } catch (error) {
            this.showMessage(error?.message || '新建文件失败', 'error');
        }
    }

    async createNewFolder() {
        if (!this._lastLoggedIn) {
            this.showMessage('请先登录账户', 'warning');
            return;
        }
        const name = await window.dialogManager?.showInputDialog('新建云端文件夹', 'new-folder', '请输入文件夹名');
        if (!name) return;
        const check = this.validateFileName(name);
        if (!check.valid) {
            this.showMessage(check.error, 'error');
            return;
        }
        if (!this.checkRemainingCapacity()) return;
        const targetDir = this.getActionTargetFolder();
        await this.ensureDirectoryLoaded(targetDir);
        if (this.hasNameInDirectory(targetDir, name)) {
            this.showMessage('已存在同名文件或文件夹，请更换名称', 'warning');
            return;
        }
        const fullPath = this.joinPath(targetDir, name);
        try {
            await this.request('POST', '/cloudSync/createFolder', { path: fullPath });
            await this.loadDirectory(targetDir);
            this.renderTree();
        } catch (error) {
            this.showMessage(error?.message || '新建文件夹失败', 'error');
        }
    }

    async uploadLocalFile() {
        if (!this._lastLoggedIn) {
            this.showMessage('请先登录账户', 'warning');
            return;
        }
        if (!window.electronAPI?.showOpenDialog) {
            this.showMessage('上传功能不可用', 'error');
            return;
        }
        try {
            const result = await window.electronAPI.showOpenDialog({
                title: '选择要上传的文件',
                properties: ['openFile']
            });
            const filePath = result?.filePaths?.[0];
            if (!filePath) return;
            const info = await window.electronAPI.getPathInfo(filePath);
            const ext = (info?.extname || '').toLowerCase();
            if (!this.allowedExtensions.has(ext)) {
                this.showMessage('仅支持 .ans .in .out .cpp .py .txt .md', 'error');
                return;
            }
            const buffer = await window.electronAPI.readFileBuffer(filePath);
            const byteLength = buffer?.byteLength ?? buffer?.length ?? 0;
            if (byteLength > this.maxFileSize) {
                this.showMessage('文件大小超过 20KB，无法上传', 'error');
                return;
            }
            const content = await window.electronAPI.readFileContent(filePath);
            if (!this.checkRemainingCapacity()) return;
            const targetDir = this.getActionTargetFolder();
            const fileName = info?.basename || filePath.split(/[\\/]/).pop();
            const conflictAction = await this.resolveUploadConflict(targetDir, fileName, 'file');
            if (conflictAction === 'cancel' || conflictAction === 'skip') {
                return;
            }
            const fullPath = this.joinPath(targetDir, fileName);
            await this.request('POST', '/cloudSync/upload', { path: fullPath, content: content || '' });
            await this.loadDirectory(targetDir);
            this.renderTree();
            this.showMessage('上传成功', 'success');
        } catch (error) {
            this.showMessage(error?.message || '上传失败', 'error');
        }
    }

    async uploadLocalFolder() {
        if (!this._lastLoggedIn) {
            this.showMessage('请先登录账户', 'warning');
            return;
        }
        if (!window.electronAPI?.showOpenDialog || !window.electronAPI?.walkDirectory) {
            this.showMessage('上传功能不可用', 'error');
            return;
        }
        try {
            const result = await window.electronAPI.showOpenDialog({
                title: '选择要上传的文件夹',
                properties: ['openDirectory']
            });
            const folderPath = result?.filePaths?.[0];
            if (!folderPath) return;

            const info = await window.electronAPI.getPathInfo(folderPath);
            const folderName = info?.basename || folderPath.split(/[\\/]/).pop() || 'folder';
            const targetDir = this.getActionTargetFolder();
            const rootConflict = await this.resolveUploadConflict(targetDir, folderName, 'folder');
            if (rootConflict === 'cancel' || rootConflict === 'skip') {
                return;
            }
            const cloudRoot = this.joinPath(targetDir, folderName);

            const walkResult = await window.electronAPI.walkDirectory(folderPath, {
                includeExts: Array.from(this.allowedExtensions)
            });
            if (!walkResult?.success) {
                throw new Error(walkResult?.error || '读取文件夹失败');
            }
            const rawFiles = Array.isArray(walkResult.files) ? walkResult.files : [];
            if (rawFiles.length === 0) {
                this.showMessage('文件夹内没有可上传的文件', 'warning');
                return;
            }

            const rootNorm = this.normalizeLocalPath(folderPath);
            const entries = [];
            for (const file of rawFiles) {
                const ext = (file.ext || this.getExtension(file.name)).toLowerCase();
                if (!this.allowedExtensions.has(ext)) {
                    continue;
                }
                const rel = this.getRelativeLocalPath(file.path, rootNorm);
                if (!rel) continue;
                entries.push({ path: file.path, rel });
            }

            if (entries.length === 0) {
                this.showMessage('文件夹内没有可上传的文件', 'warning');
                return;
            }

            if (typeof this.remainingFiles === 'number' && entries.length > this.remainingFiles) {
                this.showMessage(`待上传文件 ${entries.length} 个，超过云端剩余数量 ${this.remainingFiles}`, 'warning');
                return;
            }

            await this.tryCreateCloudFolder(cloudRoot);
            const folders = new Set();
            for (const entry of entries) {
                const relDir = this.getRelativeDir(entry.rel);
                if (!relDir) continue;
                const parts = relDir.split('/').filter(Boolean);
                for (let i = 1; i <= parts.length; i++) {
                    folders.add(parts.slice(0, i).join('/'));
                }
            }
            const folderList = Array.from(folders).sort((a, b) => a.split('/').length - b.split('/').length);
            for (const relDir of folderList) {
                const cloudPath = this.joinPath(cloudRoot, relDir);
                await this.tryCreateCloudFolder(cloudPath);
            }

            let uploaded = 0;
            let skippedSize = 0;
            let processed = 0;
            this.showUploadProgress(0, entries.length, `上传中: 0/${entries.length}`);
            for (const entry of entries) {
                const content = await window.electronAPI.readFileContent(entry.path);
                const bytes = new TextEncoder().encode(content || '').length;
                if (bytes > this.maxFileSize) {
                    skippedSize += 1;
                    processed += 1;
                    this.updateUploadProgress(processed, entries.length);
                    continue;
                }
                const cloudPath = this.joinPath(cloudRoot, entry.rel);
                const parentDir = this.getParentPath(cloudPath);
                const baseName = this.getBaseName(cloudPath);
                const action = await this.resolveUploadConflict(parentDir, baseName, 'file');
                if (action === 'cancel') {
                    this.hideUploadProgress();
                    return;
                }
                if (action === 'skip') {
                    processed += 1;
                    this.updateUploadProgress(processed, entries.length);
                    continue;
                }
                await this.request('POST', '/cloudSync/upload', { path: cloudPath, content: content || '' });
                uploaded += 1;
                processed += 1;
                this.updateUploadProgress(processed, entries.length);
            }

            await this.loadDirectory(targetDir);
            if (cloudRoot !== targetDir) {
                await this.loadDirectory(cloudRoot);
            }
            this.expandedFolders.add(cloudRoot);
            this.renderTree();

            let message = `上传完成：${uploaded} 个文件`;
            if (skippedSize > 0) {
                message += `，跳过 ${skippedSize} 个超出 20KB 的文件`;
            }
            this.showUploadProgress(entries.length, entries.length, message);
            this.hideUploadProgress(2000);
            this.showMessage(message, uploaded > 0 ? 'success' : 'warning');
        } catch (error) {
            this.hideUploadProgress();
            this.showMessage(error?.message || '上传失败', 'error');
        }
    }

    async downloadFile(file) {
        if (!window.electronAPI?.showSaveDialog) {
            this.showMessage('下载功能不可用', 'error');
            return;
        }
        try {
            const data = await this.request('GET', '/cloudSync/download', { path: file.path });
            const content = typeof data?.content === 'string' ? data.content : '';
            const result = await window.electronAPI.showSaveDialog({
                title: '保存云端文件',
                defaultPath: file.name
            });
            const targetPath = result?.filePath;
            if (!targetPath) return;
            const writeResult = await window.electronAPI.writeFile(targetPath, content);
            if (writeResult?.success === false) {
                throw new Error(writeResult?.error || '写入失败');
            }
            this.showMessage('保存成功', 'success');
        } catch (error) {
            this.showMessage(error?.message || '下载失败', 'error');
        }
    }

    async renameItem(file) {
        if (!this._lastLoggedIn) {
            this.showMessage('请先登录账户', 'warning');
            return;
        }
        const newName = await window.dialogManager?.showInputDialog('重命名', file.name, '请输入新名称');
        if (!newName || newName === file.name) return;
        const check = this.validateFileName(newName);
        if (!check.valid) {
            this.showMessage(check.error, 'error');
            return;
        }
        if (file.type === 'file') {
            const ext = this.getExtension(newName);
            if (!this.allowedExtensions.has(ext)) {
                this.showMessage('仅支持 .ans .in .out .cpp .py .txt', 'error');
                return;
            }
        }
        try {
            await this.request('POST', '/cloudSync/rename', {
                path: file.path,
                new_name: newName
            });
            const parent = this.getParentPath(file.path);
            await this.loadDirectory(parent);
            this.renderTree();
        } catch (error) {
            this.showMessage(error?.message || '重命名失败', 'error');
        }
    }

    async deleteItem(file) {
        if (!this._lastLoggedIn) {
            this.showMessage('请先登录账户', 'warning');
            return;
        }
        const ok = await window.dialogManager?.showConfirmDialog('删除确认', `确定删除 ${file.name} 吗？`);
        if (!ok) return;
        try {
            await this.request('POST', '/cloudSync/delete', { path: file.path });
            const parent = this.getParentPath(file.path);
            await this.loadDirectory(parent);
            this.renderTree();
        } catch (error) {
            this.showMessage(error?.message || '删除失败', 'error');
        }
    }

    showItemContextMenu(e, file) {
        const items = [];
        if (file.type === 'file') {
            items.push({ label: '打开', action: () => this.openCloudFile(file) });
            items.push({ label: '下载到本地', action: () => this.downloadFile(file) });
        }
        items.push({ label: '重命名', action: () => this.renameItem(file) });
        items.push({ label: '删除', action: () => this.deleteItem(file) });
        items.push({ separator: true });
        items.push({ label: '新建文件', action: () => this.createNewFile() });
        items.push({ label: '新建文件夹', action: () => this.createNewFolder() });
        items.push({ label: '上传文件', action: () => this.uploadLocalFile() });
        items.push({ label: '上传文件夹', action: () => this.uploadLocalFolder() });
        items.push({ label: '刷新', action: () => this.refresh() });
        this.showContextMenu(items, e.clientX, e.clientY);
    }

    showEmptyAreaContextMenu(e) {
        const items = [
            { label: '新建文件', action: () => this.createNewFile() },
            { label: '新建文件夹', action: () => this.createNewFolder() },
            { label: '上传文件', action: () => this.uploadLocalFile() },
            { label: '上传文件夹', action: () => this.uploadLocalFolder() },
            { separator: true },
            { label: '刷新', action: () => this.refresh() }
        ];
        this.showContextMenu(items, e.clientX, e.clientY);
    }

    showContextMenu(items, x, y) {
        this.clearContextMenu();
        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.position = 'fixed';
        menu.style.zIndex = '10000';
        items.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'context-menu-item';
                sep.dataset.separator = 'true';
                menu.appendChild(sep);
                return;
            }
            const entry = document.createElement('div');
            entry.className = 'context-menu-item';
            entry.textContent = item.label;
            entry.addEventListener('click', () => {
                this.clearContextMenu();
                item.action?.();
            });
            menu.appendChild(entry);
        });
        document.body.appendChild(menu);

        const menuRect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        let left = x;
        let top = y;

        if (left + menuRect.width > windowWidth) {
            left = windowWidth - menuRect.width - 10;
        }
        if (top + menuRect.height > windowHeight) {
            top = windowHeight - menuRect.height - 10;
        }

        left = Math.max(10, left);
        top = Math.max(10, top);

        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        this._contextMenu = menu;
        setTimeout(() => {
            document.addEventListener('click', this._dismissContextMenu, { once: true });
        }, 0);
    }

    _dismissContextMenu = () => {
        this.clearContextMenu();
    };

    clearContextMenu() {
        if (this._contextMenu) {
            this._contextMenu.remove();
            this._contextMenu = null;
        }
    }

    renderEmptyState(message) {
        if (!this.treeEl) return;
        this.treeEl.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon" data-ui-icon="cloud"></div>
                <div class="empty-state-title">${message}</div>
                <div class="empty-state-subtitle">云空间文件将在此显示</div>
            </div>
        `;
        if (window.uiIcons?.hydrate) {
            window.uiIcons.hydrate(this.treeEl);
        }
    }

    updateRemaining(value) {
        this.remainingFiles = typeof value === 'number' ? value : null;
        if (this.remainingEl) {
            this.remainingEl.textContent = typeof value === 'number'
                ? `剩余文件数量: ${value}`
                : '剩余文件数量: --';
        }
    }

    showUploadProgress(current, total, text) {
        if (!this.uploadProgressEl) return;
        this.uploadProgressEl.style.display = 'block';
        this.updateUploadProgress(current, total, true, text);
    }

    updateUploadProgress(current, total, force = false, text) {
        if (!this.uploadProgressEl || !this.uploadProgressFillEl) return;
        if (!force && current > 0 && current < total && current % 3 !== 0) return;
        const safeTotal = total > 0 ? total : 1;
        const percent = Math.min(100, Math.round((current / safeTotal) * 100));
        this.uploadProgressFillEl.style.width = `${percent}%`;
        if (this.uploadProgressTextEl) {
            this.uploadProgressTextEl.textContent = text || `上传中: ${current}/${total}`;
        }
    }

    hideUploadProgress(delayMs = 0) {
        if (!this.uploadProgressEl) return;
        const hide = () => {
            if (!this.uploadProgressEl) return;
            this.uploadProgressEl.style.display = 'none';
            if (this.uploadProgressFillEl) this.uploadProgressFillEl.style.width = '0%';
        };
        if (delayMs > 0) {
            setTimeout(hide, delayMs);
        } else {
            hide();
        }
    }

    checkRemainingCapacity() {
        if (typeof this.remainingFiles !== 'number') return true;
        if (this.remainingFiles <= 0) {
            this.showMessage('云端剩余文件数量不足', 'warning');
            return false;
        }
        return true;
    }

    getActionTargetFolder() {
        const primary = this.getPrimarySelection();
        if (!primary) return '/';
        if (primary.type === 'folder') return primary.path;
        return this.getParentPath(primary.path);
    }

    async ensureDirectoryLoaded(dirPath) {
        const norm = this.normalizePath(dirPath);
        if (this.itemsCache.has(norm)) return;
        try {
            await this.loadDirectory(norm);
        } catch (_) {
        }
    }

    hasNameInDirectory(dirPath, name) {
        const norm = this.normalizePath(dirPath);
        const items = this.itemsCache.get(norm) || [];
        return items.some(item => item.name === name);
    }

    getItemInDirectory(dirPath, name) {
        const norm = this.normalizePath(dirPath);
        const items = this.itemsCache.get(norm) || [];
        return items.find(item => item.name === name) || null;
    }

    async resolveUploadConflict(dirPath, name, targetKind) {
        await this.ensureDirectoryLoaded(dirPath);
        const existing = this.getItemInDirectory(dirPath, name);
        if (!existing) return 'none';

        const existingKind = existing.type === 'folder' ? '文件夹' : '文件';
        const targetLabel = targetKind === 'folder' ? '文件夹' : '文件';

        if (existing.type === 'folder' && targetKind === 'file') {
            const action = await window.dialogManager?.showActionDialog?.(
                '上传冲突',
                `云端已存在同名文件夹: ${name}，无法用${targetLabel}覆盖。`,
                [
                    { id: 'skip', label: '跳过' },
                    { id: 'cancel', label: '取消', className: 'dialog-btn-cancel' }
                ]
            );
            return action || 'cancel';
        }

        const action = await window.dialogManager?.showActionDialog?.(
            '上传冲突',
            `云端已存在同名${existingKind}: ${name}，是否覆盖该${existingKind}？`,
            [
                { id: 'overwrite', label: '覆盖', className: 'dialog-btn-confirm' },
                { id: 'skip', label: '跳过' },
                { id: 'cancel', label: '取消', className: 'dialog-btn-cancel' }
            ]
        );

        if (action === 'overwrite' && existing.type === 'file' && targetKind === 'folder') {
            try {
                await this.request('POST', '/cloudSync/delete', { path: existing.path });
                await this.loadDirectory(dirPath);
            } catch (_) {
                return 'cancel';
            }
        }

        return action || 'cancel';
    }

    validateFileName(name) {
        if (!name || typeof name !== 'string') {
            return { valid: false, error: '名称不能为空' };
        }
        const trimmedName = name.trim();
        if (trimmedName.length === 0) {
            return { valid: false, error: '名称不能为空' };
        }
        const illegalChars = /[<>:"/\\|?*]/;
        if (illegalChars.test(trimmedName)) {
            return { valid: false, error: '文件名不能包含以下字符: < > : " / \\ | ? *' };
        }
        return { valid: true, error: null };
    }

    getExtension(name) {
        if (!name) return '';
        const idx = name.lastIndexOf('.');
        return idx >= 0 ? name.slice(idx).toLowerCase() : '';
    }

    normalizePath(p) {
        if (!p) return '/';
        let out = String(p).replace(/\\/g, '/');
        if (!out.startsWith('/')) out = '/' + out;
        if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
        return out;
    }

    normalizeLocalPath(p) {
        if (!p) return '';
        return String(p).replace(/\\/g, '/').replace(/\/+$/g, '');
    }

    getRelativeLocalPath(filePath, rootPath) {
        const fileNorm = this.normalizeLocalPath(filePath);
        const rootNorm = this.normalizeLocalPath(rootPath);
        if (!fileNorm.startsWith(rootNorm)) return '';
        let rel = fileNorm.slice(rootNorm.length);
        if (rel.startsWith('/')) rel = rel.slice(1);
        return rel;
    }

    getRelativeDir(relPath) {
        if (!relPath) return '';
        const parts = relPath.split('/').filter(Boolean);
        if (parts.length <= 1) return '';
        parts.pop();
        return parts.join('/');
    }

    joinPath(parent, name) {
        const base = this.normalizePath(parent);
        if (base === '/') return `/${name}`;
        return `${base}/${name}`;
    }

    getParentPath(p) {
        const norm = this.normalizePath(p);
        if (norm === '/') return '/';
        const parts = norm.split('/').filter(Boolean);
        parts.pop();
        return '/' + parts.join('/');
    }

    async tryCreateCloudFolder(path) {
        try {
            await this.request('POST', '/cloudSync/createFolder', { path });
        } catch (error) {
            const msg = error?.message || '';
            if (/已存在|exists/i.test(msg)) return;
            throw error;
        }
    }

    showMessage(message, type = 'info') {
        if (window.oicppApp?.showMessage) {
            window.oicppApp.showMessage(message, type);
        } else {
            alert(message);
        }
    }

    async request(method, path, params) {
        if (!window.electronAPI?.cloudSyncRequest) {
            throw new Error('云同步接口不可用');
        }
        const payload = {
            method: method,
            path: path,
            query: method === 'GET' ? params : undefined,
            body: method !== 'GET' ? params : undefined
        };
        const response = await window.electronAPI.cloudSyncRequest(payload);
        if (!response?.ok) {
            if (response?.status === 401) {
                try { await window.electronAPI.logoutIdeAccount?.(); } catch (_) { }
                this.setLoggedInState(false);
                throw new Error('登录已过期，请重新登录');
            }
            const msg = response?.data?.msg || response?.error || '请求失败';
            throw new Error(msg);
        }
        const data = response?.data;
        if (data && data.code && data.code !== 200) {
            throw new Error(data.msg || '服务器返回错误');
        }
        return data?.data ?? data;
    }
}

if (typeof window !== 'undefined') {
    window.CloudSyncPanel = CloudSyncPanel;
}
