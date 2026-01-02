class FileExplorer {
    constructor() {
        this.currentPath = '';
        this.files = [];
        this.selectedFile = null;
        this.selectedFiles = new Map();
        this.hasWorkspace = false;
        this.clipboard = null;
        this.expandedFolders = new Set();
        this.directoryReadHandlers = {};

        this.setupKeyboardShortcuts();
    }

    /**
     * Validates file or folder name for illegal characters
     * @param {string} name - The file or folder name to validate
     * @returns {Object} - { valid: boolean, error: string }
     */
    validateFileName(name) {
        if (!name || typeof name !== 'string') {
            return { valid: false, error: '名称不能为空' };
        }

        const trimmedName = name.trim();
        if (trimmedName.length === 0) {
            return { valid: false, error: '名称不能为空' };
        }

        // Check for illegal characters
        // Windows: < > : " / \ | ? *
        // Unix/Linux/macOS: /
        const illegalCharsWin = /[<>:"/\\|?*]/;
        const illegalCharsUnix = /\//;
        
        // Detect platform from userAgent or assume Windows if unclear
        const isWindows = navigator.platform?.toLowerCase().includes('win') || 
                          navigator.userAgent?.toLowerCase().includes('windows');
        
        const illegalChars = isWindows ? illegalCharsWin : illegalCharsUnix;
        
        if (illegalChars.test(trimmedName)) {
            const platformMsg = isWindows 
                ? '文件名不能包含以下字符: < > : " / \\ | ? *'
                : '文件名不能包含字符: /';
            return { valid: false, error: platformMsg };
        }

        // Check for reserved names on Windows
        if (isWindows) {
            const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;
            if (reservedNames.test(trimmedName)) {
                return { valid: false, error: '该名称为系统保留名称，不能使用' };
            }
        }

        // Check if the original name (before trim) ends with space or period (Windows restriction)
        // Note: We check the original 'name' not 'trimmedName' because Windows does not allow
        // trailing spaces or periods, even though String.trim() would remove them
        if (isWindows && /[\s.]$/.test(name)) {
            return { valid: false, error: '文件名不能以空格或句点结尾' };
        }

        return { valid: true, error: null };
    }

    async confirmOperation(title, message) {
        try {
            if (window.dialogManager?.showConfirmDialog) {
                const result = await window.dialogManager.showConfirmDialog(title, message);
                return result !== null && result !== undefined && result !== false;
            }
        } catch (error) {
            logWarn('confirmOperation 调用 showConfirmDialog 失败，回退到原生 confirm', error);
        }
        return window.confirm?.(message) ?? true;
    }

    showError(message) {
        const text = typeof message === 'string' ? message : (message?.message ? String(message.message) : String(message));
        try {
            if (window.dialogManager?.showError) {
                window.dialogManager.showError(text);
                return;
            }
        } catch (error) {
            logWarn('showError 调用自定义对话框失败，回退到 alert', error);
        }
        window.alert?.(text);
    }

    refocusSelectedFile() {
        try {
            const anchor = this.getPrimarySelection();
            if (anchor?.path) {
                const escapePath = (value) => {
                    try {
                        if (window.CSS?.escape) {
                            return CSS.escape(value);
                        }
                    } catch (_) { }
                    return String(value).replace(/["\\]/g, (match) => `\\${match}`);
                };
                const selector = `.tree-item[data-path="${escapePath(anchor.path)}"]`;
                const item = document.querySelector(selector) || Array.from(document.querySelectorAll('.tree-item')).find(node => node.dataset?.path === anchor.path) || null;
                if (item) {
                    item.setAttribute('tabindex', '0');
                    item.focus();
                    return;
                }
            }
        } catch (error) {
            logWarn('refocusSelectedFile 定位选中项失败', error);
        }
        const fileTree = document.querySelector('#file-tree');
        if (fileTree) {
            fileTree.setAttribute('tabindex', '0');
            fileTree.focus();
        }
    }

    activate() {
        this.loadFiles();
    }

    applyTheme(theme) {
        logInfo('文件管理器应用主题:', theme);

        const fileTree = document.getElementById('file-tree');
        if (fileTree) {
            fileTree.classList.remove('theme-light', 'theme-dark');
            fileTree.classList.add(`theme-${theme}`);
            fileTree.setAttribute('data-theme', theme);
        }

        const fileItems = document.querySelectorAll('.file-item');
        fileItems.forEach(item => {
            item.classList.remove('theme-light', 'theme-dark');
            item.classList.add(`theme-${theme}`);
            item.setAttribute('data-theme', theme);
        });

        const emptyState = document.querySelector('.empty-state');
        if (emptyState) {
            emptyState.classList.remove('theme-light', 'theme-dark');
            emptyState.classList.add(`theme-${theme}`);
            emptyState.setAttribute('data-theme', theme);
        }
    }

    setupKeyboardShortcuts() {
        document.addEventListener('keydown', async (e) => {
            const currentPanel = window.sidebarManager?.getCurrentPanel?.();
            if (currentPanel !== 'files') return;

            const activeElement = document.activeElement;
            const isInEditor = !!(activeElement && (
                activeElement.closest?.('.monaco-editor') ||
                activeElement.closest?.('.editor-area') ||
                activeElement.classList?.contains?.('monaco-editor') ||
                activeElement.closest?.('.tab-content')
            ));
            const tag = (activeElement && activeElement.tagName) ? activeElement.tagName.toLowerCase() : '';
            const isTypingElement = tag === 'input' || tag === 'textarea' || !!activeElement?.isContentEditable;
            if (isInEditor || isTypingElement) {
                return;
            }

            const isInCompileOutput = (node) => {
                if (!node) return false;
                if (node.closest) {
                    return !!node.closest('.compile-output-window');
                }
                if (node.parentElement && node.parentElement.closest) {
                    return !!node.parentElement.closest('.compile-output-window');
                }
                return false;
            };

            if (isInCompileOutput(e.target) || isInCompileOutput(activeElement)) {
                return;
            }

            const selection = window.getSelection ? window.getSelection() : null;
            if (selection && selection.toString?.()) {
                const anchorNode = selection.anchorNode;
                const focusNode = selection.focusNode;
                const getElement = (node) => {
                    if (!node) return null;
                    try {
                        if (typeof Node !== 'undefined' && node.nodeType === Node.ELEMENT_NODE) {
                            return node;
                        }
                    } catch (_) { }
                    return node.parentElement || null;
                };
                const anchorElement = getElement(anchorNode);
                const focusElement = getElement(focusNode);
                if (isInCompileOutput(anchorElement) || isInCompileOutput(focusElement)) {
                    return;
                }
            }

            if (!this.getPrimarySelection()) {
                const firstItem = document.querySelector('.file-tree .tree-item');
                if (firstItem) {
                    const p = firstItem.getAttribute('data-path');
                    const t = firstItem.getAttribute('data-type');
                    const n = firstItem.querySelector('.tree-item-label')?.textContent || '';
                    if (p && t) {
                        this.selectFile({ path: p, type: t, name: n, extension: '' });
                    }
                }
            }


            switch (e.key) {
                case 'Delete':
                    e.preventDefault();
                    try {
                        const deleteTargets = this.getActionSelection(this.getPrimarySelection());
                        if (!deleteTargets.length) { logInfo('[文件管理器快捷键] Delete 被按下但没有选中文件'); return; }
                        if (deleteTargets.length === 1) {
                            await this.deleteFile(deleteTargets[0]);
                        } else {
                            await this.deleteFiles(deleteTargets);
                        }
                    } catch (error) {
                        logError('删除文件快捷键执行失败:', error);
                    }
                    break;

                case 'F2':
                    e.preventDefault();
                    logInfo('执行重命名文件:', this.getPrimarySelection()?.name, '路径:', this.getPrimarySelection()?.path);
                    try {
                        const renameTarget = this.getPrimarySelection();
                        if (!renameTarget) { logInfo('[文件管理器快捷键] F2 被按下但没有选中文件'); return; }
                        this.renameFile(renameTarget);
                        logInfo('重命名文件方法调用成功');
                    } catch (error) {
                        logError('重命名文件时发生错误:', error);
                    }
                    break;

                case 'c':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        try {
                            const copyTargets = this.getActionSelection(this.getPrimarySelection());
                            if (!copyTargets.length) { logInfo('[文件管理器快捷键] Ctrl+C 被按下但没有选中文件'); return; }
                            this.copyFile(copyTargets);
                            logInfo('复制文件方法调用成功，数量:', copyTargets.length);
                        } catch (error) {
                            logError('复制文件时发生错误:', error);
                        }
                    } else {
                    }
                    break;

                case 'x':
                    if (e.ctrlKey) {
                        e.preventDefault();
                        try {
                            const cutTargets = this.getActionSelection(this.getPrimarySelection());
                            if (!cutTargets.length) { logInfo('[文件管理器快捷键] Ctrl+X 被按下但没有选中文件'); return; }
                            this.cutFile(cutTargets);
                        } catch (error) {
                            logError('剪切文件时发生错误:', error);
                        }
                    } else {
                    }
                    break;

                case 'v':
                    if (e.ctrlKey && this.clipboard) {
                        e.preventDefault();
                        logInfo('执行粘贴文件，剪贴板内容:', this.clipboard);
                        const targetFolder = this.getPasteTargetFolder();
                        logInfo('粘贴目标文件夹:', targetFolder);
                        try {
                            this.pasteFile(targetFolder);
                            logInfo('粘贴文件方法调用成功');
                        } catch (error) {
                            logError('粘贴文件时发生错误:', error);
                        }
                    } else if (e.ctrlKey && !this.clipboard) {
                        logInfo('Ctrl+V被按下但剪贴板为空');
                    } else {
                        logInfo('v键被按下但没有Ctrl键，跳过处理');
                    }
                    break;

                default:
                    break;
            }

        }, true);
    }

    isFileExplorerFocused() {
        const activeElement = document.activeElement;
        const filesPanel = document.querySelector('#files-panel');
        const fileTree = document.querySelector('#file-tree');

        const isInFilesPanel = activeElement && filesPanel && (
            filesPanel.contains(activeElement) || activeElement === filesPanel
        );

        const isInFileTree = activeElement && fileTree && (
            fileTree.contains(activeElement) || activeElement === fileTree
        );

        const isFileItem = activeElement && activeElement.hasAttribute('data-path');
        const result = isInFilesPanel || isInFileTree || isFileItem;
        return result;
    }



    findFileByPath(path) {
        return this.files.find(file => file.path === path);
    }

    loadFiles() {
        if (!this.hasWorkspace || !this.currentPath) {
            this.showEmptyState();
            return;
        }

        this.loadWorkspaceFiles();
    }

    showEmptyState() {
        const fileTree = document.querySelector('.file-tree');
        if (!fileTree) return;

        fileTree.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon" data-ui-icon="folder"></div>
                <div class="empty-state-title">没有打开的文件夹</div>
                <div class="empty-state-subtitle">您还没有打开文件夹</div>
                <button class="empty-state-button" onclick="window.oicppApp.openFolder()">
                    打开文件夹
                </button>
            </div>
        `;

        if (window.uiIcons && typeof window.uiIcons.hydrate === 'function') {
            window.uiIcons.hydrate(fileTree);
        }
    }

    loadWorkspaceFiles() {
        logInfo('加载工作区文件:', this.currentPath);

        if (!this.currentPath) {
            this.showEmptyState();
            return;
        }

        if (window.electronIPC) {
            window.electronIPC.send('read-directory', this.currentPath);

            const handleDirectoryRead = (event, dirPath, files) => {
                if (dirPath === this.currentPath) {
                    this.files = files;
                    this.renderFileTree();
                    window.electronIPC.ipcRenderer.removeListener('directory-read', handleDirectoryRead);
                }
            };

            window.electronIPC.on('directory-read', handleDirectoryRead);
        } else {
            logWarn('Electron IPC 不可用，无法读取文件夹');
        }
    }

    setWorkspace(path) {
        this.currentPath = path;
        this.workspacePath = path;
        this.hasWorkspace = !!path;
        this.clearSelection();
        logInfo('设置工作区:', path, '状态:', this.hasWorkspace);
        this.loadFiles();

        if (window.sidebarManager) {
            window.sidebarManager.updateFileExplorerButtons();
        }
    }

    clearWorkspace() {
        this.currentPath = '';
        this.workspacePath = '';
        this.hasWorkspace = false;
        this.files = [];
        this.selectedFile = null;
        this.selectedFiles.clear();
        this.expandedFolders.clear();
        this.showEmptyState();

        if (window.sidebarManager) {
            window.sidebarManager.updateFileExplorerButtons();
        }
    }

    renderFileTree() {
        const fileTree = document.querySelector('.file-tree');
        if (!fileTree) return;

        if (!this.hasWorkspace) {
            this.showEmptyState();
            return;
        }

        fileTree.innerHTML = '';

        this.files.forEach(file => {
            const item = this.createFileTreeItem(file);
            fileTree.appendChild(item);
        });

        this.setupFileTreeEvents(fileTree);

        this.applySelectionStyles();

        try {
            const restorePromise = this._restoreExpandedFolders();
            if (restorePromise && typeof restorePromise.then === 'function') {
                restorePromise.then(() => this.applySelectionStyles()).catch((e) => logWarn('恢复展开状态失败', e));
            }
        } catch (e) { logWarn('恢复展开状态调度失败', e); }
    }

    async expandFolderSilent(item, folder) {
        return new Promise(resolve => {
            if (!item) return resolve();
            const arrow = item.querySelector('.tree-item-arrow');
            if (arrow) arrow.textContent = '▼';
            let next = item.nextElementSibling;
            while (next) {
                const p = next.dataset?.path;
                if (p && (p.startsWith(folder.path + '/') || p.startsWith(folder.path + '\\'))) return resolve();
                if (!(p && p.startsWith(folder.path))) break;
                next = next.nextElementSibling;
            }
            if (window.electronIPC) {
                const timeoutId = setTimeout(() => { resolve(); }, 3000);
                const handle = (event, dirPath, files) => {
                    if (dirPath === folder.path) {
                        try { this.insertChildItems(item, files, folder.path); } catch (_) { }
                        window.electronIPC.ipcRenderer.removeListener('directory-read', handle);
                        clearTimeout(timeoutId);
                        resolve();
                    }
                };
                window.electronIPC.on('directory-read', handle);
                window.electronIPC.send('read-directory', folder.path);
            } else {
                resolve();
            }
        });
    }

    async _restoreExpandedFolders() {
        if (!this.expandedFolders || this.expandedFolders.size === 0) return;
        const fileTree = document.querySelector('.file-tree');
        if (!fileTree) return;
        const paths = Array.from(this.expandedFolders).sort((a, b) => a.length - b.length);
        for (const path of paths) {
            let item = this._queryItemByPath(path, fileTree);
            if (!item) {
                for (let i = 0; i < 5 && !item; i++) {
                    await new Promise(r => setTimeout(r, 80));
                    item = this._queryItemByPath(path, fileTree);
                }
            }
            if (item && item.dataset.type === 'folder') {
                await this.expandFolderSilent(item, { path, type: 'folder' });
            }
        }
    }

    _queryItemByPath(path, root) {
        try {
            if (!root) return null;
            const esc = (s) => { if (window.CSS?.escape) return CSS.escape(s); return s.replace(/["\\]/g, m => '\\' + m); };
            const selector = `.tree-item[data-path="${esc(path)}"]`;
            const el = root.querySelector(selector);
            if (el) return el;
            return Array.from(root.querySelectorAll('.tree-item')).find(n => n.dataset.path === path) || null;
        } catch (_) { return null; }
    }

    getSelectedFilesArray() {
        return Array.from(this.selectedFiles.values());
    }

    getPrimarySelection() {
        const selected = this.getSelectedFilesArray();
        if (selected.length) return selected[selected.length - 1];
        return null;
    }

    isFileSelected(path) {
        return !!(path && this.selectedFiles.has(path));
    }

    getActionSelection(targetFile) {
        const selected = this.getSelectedFilesArray();
        if (selected.length > 1 && targetFile && this.isFileSelected(targetFile.path)) {
            return selected;
        }
        if (!targetFile && selected.length > 0) {
            return selected;
        }
        if (targetFile) {
            return [targetFile];
        }
        if (selected.length === 1) {
            return selected;
        }
        return [];
    }

    applySelectionStyles() {
        try {
            const selectedPaths = new Set(this.selectedFiles.keys());
            document.querySelectorAll('.tree-item').forEach(item => {
                const isSelected = selectedPaths.has(item.dataset?.path);
                item.classList.toggle('selected', isSelected);
            });
        } catch (error) {
            logWarn('应用多选样式失败', error);
        }
    }

    async refreshFolder(path) {
        try {
            if (!path || !this.expandedFolders.has(path)) return;
            const fileTree = document.querySelector('.file-tree');
            const item = this._queryItemByPath(path, fileTree);
            if (!item) return;
            if (!window.electronIPC) return;
            const handle = (event, dirPath, files) => {
                if (dirPath === path) {
                    try { this.removeChildItems(item, path); this.insertChildItems(item, files, path); } catch (_) { }
                    window.electronIPC.ipcRenderer.removeListener('directory-read', handle);
                }
            };
            window.electronIPC.on('directory-read', handle);
            window.electronIPC.send('read-directory', path);
        } catch (e) { logWarn('refreshFolder 失败', e); }
    }

    setupFileTreeEvents(fileTree) {
        fileTree.addEventListener('click', (e) => {
            if (e.target === fileTree) {
                this.clearSelection();
            }
        });

        fileTree.addEventListener('contextmenu', (e) => {
            if (e.target === fileTree) {
                e.preventDefault();
                this.clearSelection();
                this.showEmptyAreaContextMenu(e);
            }
        });

        this.setupDragAndDrop(fileTree);
    }

    createFileTreeItem(file, level = 0) {
        const item = document.createElement('div');
        item.className = 'tree-item';
        item.dataset.path = file.path;
        if (file.type === 'folder') {
            item.dataset.type = 'folder';
        } else {
            const ext = (file.extension || '').toLowerCase();
            item.dataset.type = ext ? ext.replace(/^\./, '') : 'file';
        }
        item.style.paddingLeft = `${level * 16 + 8}px`;

        const content = document.createElement('div');
        content.className = 'tree-item-content';

        if (file.type === 'folder') {
            const arrow = document.createElement('span');
            arrow.className = 'tree-item-arrow';
            arrow.textContent = '▶';
            content.appendChild(arrow);
        }

        const icon = document.createElement('span');
        icon.className = 'tree-item-icon';
        const iconName = this.getFileIcon(file);
        if (window.uiIcons && typeof window.uiIcons.svg === 'function') {
            icon.innerHTML = window.uiIcons.svg(iconName);
        } else {
            icon.textContent = '';
        }

        const label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = file.name;

        content.appendChild(icon);
        content.appendChild(label);
        item.appendChild(content);

        this.addFileTreeItemListeners(item, file);

        return item;
    }

    getFileIcon(file) {
        if (file.type === 'folder') {
            return 'folder';
        }

        const ext = (file.extension || '').toLowerCase();
        switch (ext) {
            case '.cpp':
            case '.cc':
            case '.cxx':
            case '.c':
                return 'fileCode';
            case '.h':
            case '.hpp':
                return 'fileHeader';
            case '.md':
                return 'fileMarkdown';
            case '.txt':
                return 'fileText';
            case '.pdf':
                return 'filePdf';
            case '.json':
                return 'fileJson';
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

    addFileTreeItemListeners(item, file) {
        const content = item.querySelector('.tree-item-content');

        content.addEventListener('click', (e) => {
            e.stopPropagation();
            const useToggle = e.ctrlKey || e.metaKey;
            this.selectFile(file, { toggle: useToggle });

            if (useToggle) {
                return; // Ctrl/Meta 点击只负责多选，不触发打开或展开
            }

            if (file.type === 'folder') {
                this.toggleFolder(item, file);
            } else if (file.type === 'file') {
                this.openFile(file);
                setTimeout(() => {
                    try {
                        this.refocusSelectedFile();
                    } catch (error) {
                        logWarn('单击文件后恢复焦点失败', error);
                    }
                }, 10);
            }
        });

        content.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
                return;
            }
            this.selectFile(file);
            if (file.type === 'file') {
                this.openFile(file);
                setTimeout(() => {
                    try {
                        this.refocusSelectedFile();
                    } catch (error) {
                        logWarn('双击文件后恢复焦点失败', error);
                    }
                }, 10);
            } else if (file.type === 'folder') {
                this.toggleFolder(item, file);
            }
        });

        content.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const alreadySelected = this.isFileSelected(file.path);
            if (!alreadySelected) {
                this.selectFile(file);
            }
            this.showContextMenu(e, file);
        });

        content.draggable = true;
        content.addEventListener('dragstart', (e) => {
            this.handleDragStart(e, file);
        });
    }

    async toggleFolder(item, folder) {
        const arrow = item.querySelector('.tree-item-arrow');
        const isExpanded = this.expandedFolders.has(folder.path);

        if (isExpanded) {
            arrow.textContent = '▶';
            this.expandedFolders.delete(folder.path);

            this.removeChildItems(item, folder.path);
        } else {
            arrow.textContent = '▼';
            this.expandedFolders.add(folder.path);

            if (window.electronIPC) {
                if (this.directoryReadHandlers && this.directoryReadHandlers[folder.path]) {
                    window.electronIPC.ipcRenderer.removeListener('directory-read', this.directoryReadHandlers[folder.path]);
                }

                if (!this.directoryReadHandlers) {
                    this.directoryReadHandlers = {};
                }

                const handleSubDirectoryRead = (event, dirPath, files) => {
                    if (dirPath === folder.path) {
                        this.insertChildItems(item, files, folder.path);
                        window.electronIPC.ipcRenderer.removeListener('directory-read', handleSubDirectoryRead);
                        delete this.directoryReadHandlers[folder.path];
                    }
                };

                this.directoryReadHandlers[folder.path] = handleSubDirectoryRead;

                window.electronIPC.on('directory-read', handleSubDirectoryRead);

                window.electronIPC.send('read-directory', folder.path);
            }
        }
    }

    removeChildItems(parentItem, parentPath) {
        let nextSibling = parentItem.nextElementSibling;
        const toRemove = [];

        while (nextSibling) {
            const itemPath = nextSibling.dataset.path;
            if (itemPath && itemPath.startsWith(parentPath + '/') || itemPath && itemPath.startsWith(parentPath + '\\')) {
                toRemove.push(nextSibling);
                if (nextSibling.dataset.type === 'folder') {
                    this.expandedFolders.delete(itemPath);
                }
                nextSibling = nextSibling.nextElementSibling;
            } else {
                break;
            }
        }

        toRemove.forEach(item => item.remove());
    }

    insertChildItems(parentItem, files, parentPath) {
        const currentLevel = this.getItemLevel(parentItem);
        let insertPosition = parentItem;

        const existingChildren = [];
        let nextSibling = parentItem.nextElementSibling;
        while (nextSibling) {
            const itemPath = nextSibling.dataset.path;
            if (itemPath && (itemPath.startsWith(parentPath + '/') || itemPath.startsWith(parentPath + '\\'))) {
                existingChildren.push(nextSibling);
                nextSibling = nextSibling.nextElementSibling;
            } else {
                break;
            }
        }

        if (existingChildren.length > 0) {
            logInfo('检测到重复渲染，跳过插入子项:', parentPath);
            return;
        }

        files.forEach(subFile => {
            const subItem = this.createFileTreeItem(subFile, currentLevel + 1);
            insertPosition.insertAdjacentElement('afterend', subItem);
            insertPosition = subItem;
        });
    }

    getItemLevel(item) {
        const paddingLeft = parseInt(item.style.paddingLeft) || 8;
        return Math.floor((paddingLeft - 8) / 16);
    }

    showContextMenu(event, file) {
        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.position = 'fixed';
        menu.style.zIndex = '10000';

        const menuItems = this.getContextMenuItems(file);
        menuItems.forEach(menuItem => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            item.textContent = menuItem.label;
            item.addEventListener('click', () => {
                menuItem.action();
                this.hideContextMenu();
            });
            menu.appendChild(item);
        });

        document.body.appendChild(menu);

        const menuRect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        let left = event.clientX;
        let top = event.clientY;

        if (left + menuRect.width > windowWidth) {
            left = windowWidth - menuRect.width - 10;
        }

        if (top + menuRect.height > windowHeight) {
            top = windowHeight - menuRect.height - 10;
        }

        left = Math.max(10, left);
        top = Math.max(10, top);

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        const hideMenu = (e) => {
            if (!menu.contains(e.target)) {
                this.hideContextMenu();
                document.removeEventListener('click', hideMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', hideMenu);
        }, 0);
    }

    getContextMenuItems(file) {
        const items = [];

        if (file.type === 'file') {
            items.push({ label: '打开', action: () => this.openFile(file) });
            items.push({ label: '重命名', action: () => this.renameFile(file) });
            items.push({ label: '复制', action: () => this.copyFile(this.getActionSelection(file)) });
            items.push({ label: '剪切', action: () => this.cutFile(this.getActionSelection(file)) });
            items.push({ label: '删除', action: () => this.deleteFiles(this.getActionSelection(file)) });
            items.push({ label: '在资源管理器中显示', action: () => this.openInSystemExplorer(file) });
        } else {
            items.push({ label: '新建文件', action: () => this.createNewFileInFolder(file) });
            items.push({ label: '新建文件夹', action: () => this.createNewFolderInFolder(file) });
            items.push({ label: '重命名', action: () => this.renameFile(file) });
            items.push({ label: '复制', action: () => this.copyFile(this.getActionSelection(file)) });
            items.push({ label: '剪切', action: () => this.cutFile(this.getActionSelection(file)) });
            items.push({ label: '删除', action: () => this.deleteFiles(this.getActionSelection(file)) });
            items.push({ label: '在资源管理器中打开', action: () => this.openInSystemExplorer(file) });
        }

        if (this.clipboard) {
            items.push({ label: '粘贴', action: () => this.pasteFile(file) });
        }

        return items;
    }

    hideContextMenu() {
        const menus = document.querySelectorAll('.context-menu');
        menus.forEach(menu => {
            menu.remove();
        });
    }

    showEmptyAreaContextMenu(event) {
        if (!this.hasWorkspace) {
            return;
        }

        this.hideContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.position = 'fixed';
        menu.style.zIndex = '10000';

        const menuItems = this.getEmptyAreaContextMenuItems();
        menuItems.forEach(menuItem => {
            const item = document.createElement('div');
            item.className = 'context-menu-item';

            if (menuItem.label === '---') {
                item.setAttribute('data-separator', 'true');
                item.textContent = '';
            } else {
                item.textContent = menuItem.label;
                item.addEventListener('click', () => {
                    menuItem.action();
                    this.hideContextMenu();
                });
            }

            menu.appendChild(item);
        });

        document.body.appendChild(menu);

        const menuRect = menu.getBoundingClientRect();
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        let left = event.clientX;
        let top = event.clientY;

        if (left + menuRect.width > windowWidth) {
            left = windowWidth - menuRect.width - 10;
        }

        if (top + menuRect.height > windowHeight) {
            top = windowHeight - menuRect.height - 10;
        }

        left = Math.max(10, left);
        top = Math.max(10, top);

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';

        const hideMenu = (e) => {
            if (!menu.contains(e.target)) {
                this.hideContextMenu();
                document.removeEventListener('click', hideMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', hideMenu);
        }, 0);
    }

    getEmptyAreaContextMenuItems() {
        const items = [];

        items.push({ label: '新建文件', action: () => this.createNewFile() });

        items.push({ label: '新建文件夹', action: () => this.createNewFolder() });

        items.push({ label: '---', action: () => { } });

        items.push({ label: '刷新', action: () => this.refresh() });

        if (this.workspacePath || this.currentPath) {
            items.push({ label: '在资源管理器中打开工作区', action: () => this.openWorkspaceInExplorer() });
        }

        if (this.clipboard) {
            items.push({ label: '粘贴', action: () => this.pasteFile() });
        }

        return items;
    }

    copyFile(fileOrFiles) {
        const files = Array.isArray(fileOrFiles)
            ? fileOrFiles.filter(f => f?.path)
            : (fileOrFiles ? [fileOrFiles] : []);
        if (!files.length) {
            logWarn('copyFile 调用时未提供有效文件');
            return;
        }

        this.clipboard = { files, operation: 'copy' };
        logInfo('复制文件:', files.map(f => f.name));
    }

    openInSystemExplorer(target) {
        try {
            if (!target || !target.path) {
                logWarn('openInSystemExplorer: 无有效目标');
                return;
            }
            const isFolder = target.type === 'folder';
            const path = target.path;
            if (isFolder) {
                if (window.electronAPI?.openPath) {
                    window.electronAPI.openPath(path);
                } else if (window.electron?.shell?.openPath) {
                    window.electron.shell.openPath(path);
                } else if (window.electron?.shell?.showItemInFolder) {
                    window.electron.shell.showItemInFolder(path);
                }
            } else {
                if (window.electronAPI?.openPath) {
                    window.electronAPI.openPath(path, { reveal: true });
                } else if (window.electron?.shell?.showItemInFolder) {
                    window.electron.shell.showItemInFolder(path);
                } else if (window.electron?.shell?.openPath) {
                    window.electron.shell.openPath(path);
                }
            }
        } catch (error) {
            logWarn('打开资源管理器失败:', error);
        }
    }

    openWorkspaceInExplorer() {
        try {
            const root = this.workspacePath || this.currentPath;
            if (!root) {
                logWarn('openWorkspaceInExplorer: 当前无工作区路径');
                return;
            }
            if (window.electronAPI?.openPath) {
                window.electronAPI.openPath(root);
            } else if (window.electron?.shell?.openPath) {
                window.electron.shell.openPath(root);
            } else if (window.electron?.shell?.showItemInFolder) {
                window.electron.shell.showItemInFolder(root);
            }
        } catch (error) {
            logWarn('打开工作区所在目录失败:', error);
        }
    }

    cutFile(fileOrFiles) {
        const files = Array.isArray(fileOrFiles)
            ? fileOrFiles.filter(f => f?.path)
            : (fileOrFiles ? [fileOrFiles] : []);
        if (!files.length) {
            logWarn('cutFile 调用时未提供有效文件');
            return;
        }

        this.clipboard = { files, operation: 'cut' };
        logInfo('剪切文件:', files.map(f => f.name));
    }



    getPasteTargetFolder() {
        const selected = this.getSelectedFilesArray();
        for (let i = selected.length - 1; i >= 0; i--) {
            if (selected[i]?.type === 'folder') {
                return selected[i];
            }
        }
        if (this.currentPath) {
            return { path: this.currentPath, type: 'folder' };
        }
        return null;
    }

    pasteFile(targetFolder) {
        if (!this.clipboard) {
            logWarn('尝试粘贴但剪贴板为空');
            return;
        }
        if (!this.hasWorkspace || !this.currentPath) {
            logWarn('尝试粘贴但当前没有有效工作区');
            return;
        }

        if (!targetFolder) {
            targetFolder = this.getPasteTargetFolder();
            logInfo('未提供 targetFolder，自动推断为:', targetFolder);
        }

        if (!targetFolder || !targetFolder.path) {
            logError('粘贴失败：无法确定目标文件夹', targetFolder);
            return;
        }

        const targetPath = targetFolder.type === 'folder' ? targetFolder.path : this.currentPath;
        logInfo('粘贴文件到:', targetPath);
        logInfo('粘贴的文件:', this.clipboard.files.map(f => f.name));
        logInfo('操作类型:', this.clipboard.operation);

        if (window.electronIPC) {
            this.clipboard.files.forEach(file => {
                const operation = this.clipboard.operation;
                window.electronIPC.send('paste-file', file.path, targetPath, operation);

                const handleFilePasted = (event, sourcePath, destPath, operation, error) => {
                    if (sourcePath === file.path) {
                        if (error) {
                            logError(`${operation === 'copy' ? '复制' : '移动'}文件失败:`, file.name, error);
                            this.showError(`${operation === 'copy' ? '复制' : '移动'}失败: ${error}`);
                        } else {
                            logInfo(`文件${operation === 'copy' ? '复制' : '移动'}成功:`, file.name, '->', destPath);

                            if (operation === 'cut' && window.tabManager) {
                                try { window.tabManager.updateTabPathBySource(sourcePath, destPath); } catch (e) { logWarn('更新标签页路径失败:', e); }
                            }
                        }
                        window.electronIPC.ipcRenderer.removeListener('file-pasted', handleFilePasted);
                    }
                };

                window.electronIPC.on('file-pasted', handleFilePasted);
            });

            setTimeout(() => this.refresh(), 1000);
        } else {
            this.showError('文件粘贴功能需要在完整应用环境中运行');
        }

        if (this.clipboard.operation === 'cut') {
            this.clipboard = null;
        }
    }

    async renameFile(file) {
        try {
            const newName = await dialogManager.showInputDialog('重命名', file.name, '请输入新名称');
            if (newName && newName !== file.name) {
                // Validate the new name before sending to backend
                const validation = this.validateFileName(newName);
                if (!validation.valid) {
                    this.showError(validation.error);
                    logWarn('重命名文件失败 - 非法名称:', newName, '-', validation.error);
                    return;
                }

                logInfo('重命名文件:', file.name, '->', newName);

                if (window.electronIPC) {
                    window.electronIPC.send('rename-file', file.path, newName);

                    const handleRenameResult = (event, oldPath, newPath, error) => {
                        if (oldPath === file.path) {
                            if (error) {
                                logError('重命名文件失败:', error);
                                this.showError(`重命名失败: ${error}`);
                            } else {
                                logInfo('文件重命名成功:', oldPath, '->', newPath);
                                this.refresh();

                                if (window.tabManager) {
                                    const sep = newPath.includes('\\') ? '\\' : '/';
                                    const newTitle = newPath.substring(newPath.lastIndexOf(sep) + 1);
                                    window.tabManager.updateTabTitle(file.name, newTitle);
                                    try { window.tabManager.updateTabPathBySource(oldPath, newPath); } catch (_) { }
                                }
                            }
                            window.electronIPC.ipcRenderer.removeListener('file-renamed', handleRenameResult);
                        }
                    };

                    window.electronIPC.on('file-renamed', handleRenameResult);
                } else {
                    this.showError('文件重命名功能需要在完整应用环境中运行');
                }
            }
        } catch (error) {
            logError('重命名文件时出错:', error);
        }
    }

    handleDragStart(event, file) {
        const filesToDrag = this.getActionSelection(file);
        const dragData = {
            files: filesToDrag.length ? filesToDrag : [file],
            action: 'move'
        };
        event.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        event.dataTransfer.effectAllowed = 'move';

        dragData.files.forEach((f) => {
            const dragItem = this._queryItemByPath(f.path, document) || document.querySelector(`[data-path="${f.path}"]`);
            if (dragItem) {
                dragItem.classList.add('dragging');
            }
        });

        logInfo('开始拖拽:', dragData.files.map(f => f.name));
    }

    setupDragAndDrop(fileTree) {
        this.isDragging = false;

        fileTree.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            const targetItem = e.target.closest('.tree-item');
            if (targetItem) {
                const targetType = targetItem.dataset.type;

                document.querySelectorAll('.drag-over').forEach(el => {
                    el.classList.remove('drag-over');
                });

                if (targetType === 'folder') {
                    targetItem.classList.add('drag-over');
                }
            } else {
                document.querySelectorAll('.drag-over').forEach(el => {
                    el.classList.remove('drag-over');
                });
                fileTree.classList.add('drag-over-root');
            }
        });

        fileTree.addEventListener('dragleave', (e) => {
            if (!fileTree.contains(e.relatedTarget)) {
                document.querySelectorAll('.drag-over').forEach(el => {
                    el.classList.remove('drag-over');
                });
                fileTree.classList.remove('drag-over-root');
            }
        });

        fileTree.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (this.isDragging) {
                logInfo('拖拽操作正在进行中，忽略重复事件');
                return;
            }

            this.isDragging = true;

            document.querySelectorAll('.dragging').forEach(el => {
                el.classList.remove('dragging');
            });
            document.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
            fileTree.classList.remove('drag-over-root');

            try {
                const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
                const targetItem = e.target.closest('.tree-item');

                let targetPath;
                if (targetItem) {
                    const targetType = targetItem.dataset.type;
                    if (targetType === 'folder') {
                        targetPath = targetItem.dataset.path;
                    } else {
                        const itemPath = targetItem.dataset.path;
                        const lastSeparator = Math.max(itemPath.lastIndexOf('\\'), itemPath.lastIndexOf('/'));
                        targetPath = itemPath.substring(0, lastSeparator);
                    }
                } else {
                    targetPath = this.currentPath;
                }

                this.moveFiles(dragData.files, targetPath).finally(() => {
                    this.isDragging = false;
                });

            } catch (error) {
                logError('处理拖拽数据时出错:', error);
                this.isDragging = false;
            }
        });

        fileTree.addEventListener('dragend', (e) => {
            document.querySelectorAll('.dragging').forEach(el => {
                el.classList.remove('dragging');
            });
            document.querySelectorAll('.drag-over').forEach(el => {
                el.classList.remove('drag-over');
            });
            fileTree.classList.remove('drag-over-root');
            this.isDragging = false;
        });
    }

    async moveFiles(files, targetPath) {
        logInfo('移动文件:', files.map(f => f.name), '到:', targetPath);

        if (!window.electronIPC) {
            logError('Electron IPC 不可用');
            return;
        }

        try {
            const isSameLocation = files.some(file => {
                const fileDir = file.path.substring(0, file.path.lastIndexOf('\\') || file.path.lastIndexOf('/'));
                return fileDir === targetPath;
            });

            if (isSameLocation) {
                logInfo('文件已在目标位置，无需移动');
                return;
            }

            for (const file of files) {
                const separator = targetPath.includes('\\') ? '\\' : '/';
                const newPath = targetPath + separator + file.name;

                const exists = await window.electronIPC.invoke('check-file-exists', newPath);

                if (exists) {
                    const shouldOverwrite = await this.confirmOperation('覆盖文件确认', `文件 "${file.name}" 已存在于目标位置。是否要覆盖？`);
                    if (!shouldOverwrite) {
                        logInfo('用户取消了文件移动操作');
                        return;
                    }
                }
            }

            for (const file of files) {
                const separator = targetPath.includes('\\') ? '\\' : '/';
                const newPath = targetPath + separator + file.name;

                logInfo(`移动文件: ${file.path} -> ${newPath}`);

                await new Promise((resolve, reject) => {
                    let resolved = false;

                    const successHandler = (event, oldPath, movedNewPath) => {
                        if (oldPath === file.path && movedNewPath === newPath && !resolved) {
                            resolved = true;
                            window.electronIPC.ipcRenderer.removeListener('file-moved', successHandler);
                            window.electronIPC.ipcRenderer.removeListener('file-move-error', errorHandler);
                            logInfo(`文件移动成功: ${oldPath} -> ${movedNewPath}`);
                            try { window.tabManager?.updateTabPathBySource?.(oldPath, movedNewPath); } catch (e) { logWarn('移动后更新标签页路径失败:', e); }
                            resolve();
                        }
                    };

                    const errorHandler = (event, oldPath, error) => {
                        if (oldPath === file.path && !resolved) {
                            resolved = true;
                            window.electronIPC.ipcRenderer.removeListener('file-moved', successHandler);
                            window.electronIPC.ipcRenderer.removeListener('file-move-error', errorHandler);
                            logError(`文件移动失败: ${oldPath}, 错误: ${error}`);
                            reject(new Error(error));
                        }
                    };

                    window.electronIPC.ipcRenderer.on('file-moved', successHandler);
                    window.electronIPC.ipcRenderer.on('file-move-error', errorHandler);

                    window.electronIPC.send('move-file', file.path, newPath);
                });
            }

            this.refresh();
            logInfo('文件移动完成');

        } catch (error) {
            logError('移动文件时出错:', error);
            this.showError(`移动文件时出错: ${error?.message || error}`);
        }
    }

    selectFile(file, options = {}) {
        const { toggle = false, append = false, focus = true } = options;
        if (!file || !file.path) return;

        if (!toggle && !append) {
            this.clearSelection();
        }

        const item = this._queryItemByPath(file.path, document) || document.querySelector(`[data-path="${file.path}"]`);
        const alreadySelected = this.selectedFiles.has(file.path);

        if (toggle && alreadySelected) {
            this.selectedFiles.delete(file.path);
            if (item) item.classList.remove('selected');
        } else {
            this.selectedFiles.set(file.path, file);
            if (item) item.classList.add('selected');
        }

        this.selectedFile = this.getPrimarySelection();

        if (focus) {
            const target = item || document.querySelector('#file-tree');
            if (target) {
                target.setAttribute('tabindex', '0');
                target.focus();
            }
        }

        logInfo('选择文件:', file.name, '当前已选数量:', this.selectedFiles.size);
    }



    clearSelection() {
        const selected = document.querySelectorAll('.tree-item.selected');
        selected.forEach(item => item.classList.remove('selected'));
        this.selectedFiles.clear();
        this.selectedFile = null;
    }



    async openFile(file) {
        if (file.type === 'file') {
            logInfo('打开文件:', file.name);

            try {
                const isPdf = typeof file.name === 'string' && file.name.toLowerCase().endsWith('.pdf');
                if (isPdf) {
                    if (window.tabManager?.openFile) {
                        await window.tabManager.openFile(file.name, '', false, { filePath: file.path, viewType: 'pdf' });
                    } else {
                        logWarn('tabManager不可用，无法打开PDF文件');
                    }
                    return;
                }

                if (window.electronAPI && window.electronAPI.readFileContent) {
                    const content = await window.electronAPI.readFileContent(file.path);
                    if (window.tabManager) {
                        window.tabManager.openFile(file.name, content, false, file.path);
                    }
                } else {
                    logError('electronAPI不可用');
                    this.showError('无法读取文件: electronAPI不可用');
                }
            } catch (error) {
                logError('读取文件失败:', error);
                this.showError(`无法读取文件: ${error?.message || error}`);
            }
        }
    }

    async createNewFile() {
        if (!this.hasWorkspace) {
            logInfo('没有工作区，无法创建文件');
            return;
        }

        try {
            let fileName;
            let attempts = 0;
            const maxAttempts = 10;
            let errorMessage = '';

            const computeDefaultName = async () => {
                let baseName = 'untitled';
                let ext = '.cpp';
                let candidate = baseName + ext;
                const sep = '/';
                let idx = 0;
                for (let i = 0; i < 100; i++) {
                    const checkPath = this.currentPath + sep + candidate;
                    const exists = await this.checkFileExists(checkPath);
                    if (!exists) return candidate;
                    idx++;
                    candidate = baseName + String(idx) + ext;
                }
                return 'untitled-' + Date.now() + ext;
            };

            let defaultName = await computeDefaultName();

            do {
                fileName = await dialogManager.showNewFileDialog(errorMessage, defaultName);
                if (!fileName) {
                    return;
                }

                // Validate the file name for illegal characters
                const validation = this.validateFileName(fileName);
                if (!validation.valid) {
                    errorMessage = validation.error;
                    logWarn('文件创建失败 - 非法名称:', fileName, '-', validation.error);
                    attempts++;
                    continue;
                }

                try {
                    if (!/\.[^.\\/]+$/.test(fileName)) {
                        fileName = fileName + '.cpp';
                    }
                } catch (_) { }

                const filePath = this.currentPath + '/' + fileName;
                const fileExists = await this.checkFileExists(filePath);

                if (!fileExists) {
                    break;
                }

                errorMessage = `文件 "${fileName}" 已存在，请选择其他名称`;
                logWarn(errorMessage);
                attempts++;
                const m = fileName.match(/^(.*?)(\d+)(\.[^.]+)$/);
                if (m) {
                    defaultName = `${m[1]}${parseInt(m[2], 10) + 1}${m[3]}`;
                } else {
                    const dot = fileName.lastIndexOf('.');
                    if (dot > 0) {
                        defaultName = fileName.slice(0, dot) + '1' + fileName.slice(dot);
                    } else {
                        defaultName = fileName + '1';
                    }
                }

            } while (attempts < maxAttempts);

            if (attempts >= maxAttempts) {
                logError('创建文件失败：尝试次数过多');
                return;
            }

            if (fileName) {
                let defaultContent = '';
                const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();

                if (['.cpp', '.cc', '.cxx'].includes(ext)) {
                    try {
                        if (window.electronAPI && window.electronAPI.getAllSettings) {
                            const settings = await window.electronAPI.getAllSettings();
                            if (settings && settings.cppTemplate) {
                                defaultContent = settings.cppTemplate;
                            } else {
                                defaultContent = '';
                            }
                        }
                    } catch (error) {
                        logWarn('获取设置模板失败，新建空文件。', error);
                        defaultContent = '';
                    }
                }

                if (window.electronIPC) {
                    const filePath = this.currentPath + '/' + fileName;
                    logInfo('创建文件:', filePath);

                    window.electronIPC.send('create-file', filePath, defaultContent);

                    const handleFileCreated = (event, createdPath, error) => {
                        if (!handleFileCreated._handled && createdPath && createdPath.startsWith(this.currentPath + '/')) {
                            handleFileCreated._handled = true;
                            if (error) {
                                logError('创建文件失败:', error);
                                this.showError(`创建文件失败: ${error}`);
                            } else {
                                logInfo('文件创建成功:', createdPath);
                                this.refresh();

                                if (window.tabManager) {
                                    const createdName = createdPath.substring(createdPath.lastIndexOf('/') + 1).replace(/^.*\\/, '');
                                    window.tabManager.openFile(createdName, defaultContent, false, createdPath);
                                }
                            }
                            window.electronIPC.ipcRenderer.removeListener('file-created', handleFileCreated);
                        }
                    };

                    window.electronIPC.on('file-created', handleFileCreated);
                } else {
                    this.showError('文件创建功能需要在完整应用环境中运行');
                }
            }
        } catch (error) {
            logError('创建文件时出错:', error);
        }
    }

    async createNewFolder() {
        logInfo('创建新文件夹');

        if (!this.hasWorkspace) {
            logInfo('没有工作区，无法创建文件夹');
            return;
        }

        try {
            const folderName = await dialogManager.showNewFolderDialog();
            if (folderName) {
                // Validate the folder name before sending to backend
                const validation = this.validateFileName(folderName);
                if (!validation.valid) {
                    this.showError(validation.error);
                    logWarn('文件夹创建失败 - 非法名称:', folderName, '-', validation.error);
                    return;
                }

                if (window.electronIPC) {
                    const folderPath = this.currentPath + '/' + folderName;
                    window.electronIPC.send('create-folder', folderPath);

                    const handleFolderCreated = (event, createdPath, error) => {
                        if (createdPath && createdPath.startsWith(this.currentPath)) {
                            if (error) {
                                logError('创建文件夹失败:', error);
                                this.showError(`创建文件夹失败: ${error}`);
                            } else {
                                logInfo('文件夹创建成功:', createdPath);
                                this.refresh();
                            }
                            window.electronIPC.ipcRenderer.removeListener('folder-created', handleFolderCreated);
                        }
                    };

                    window.electronIPC.on('folder-created', handleFolderCreated);
                } else {
                    this.showError('文件夹创建功能需要在完整应用环境中运行');
                }
            }
        } catch (error) {
            logError('创建文件夹时出错:', error);
        }
    }

    async createNewFileInFolder(folder) {
        logInfo('在文件夹中创建新文件:', folder.name);

        try {
            const computeDefaultName = async () => {
                let baseName = 'untitled';
                let ext = '.cpp';
                let candidate = baseName + ext;
                for (let i = 0; i < 100; i++) {
                    const checkPath = folder.path + '/' + candidate;
                    const exists = await this.checkFileExists(checkPath);
                    if (!exists) return candidate;
                    candidate = baseName + String(i + 1) + ext;
                }
                return 'untitled-' + Date.now() + ext;
            };
            const defaultName = await computeDefaultName();

            let fileName = await dialogManager.showNewFileDialog('', defaultName);
            if (fileName) {
                // Validate the file name before sending to backend
                const validation = this.validateFileName(fileName);
                if (!validation.valid) {
                    this.showError(validation.error);
                    logWarn('文件创建失败 - 非法名称:', fileName, '-', validation.error);
                    return;
                }

                try {
                    if (!/\.[^.\\/]+$/.test(fileName)) {
                        fileName = fileName + '.cpp';
                    }
                } catch (_) { }
                let defaultContent = '';
                try {
                    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
                    if (['.cpp', '.cc', '.cxx', '.c', '.hpp', '.h'].includes(ext)) {
                        if (window.electronAPI && window.electronAPI.getAllSettings) {
                            const settings = await window.electronAPI.getAllSettings();
                            if (settings && settings.cppTemplate) {
                                defaultContent = settings.cppTemplate;
                            }
                        }
                        if (!defaultContent) {
                            defaultContent = '';
                        }
                    }
                } catch (e) { logWarn('获取模板失败, 使用默认空内容', e); }

                if (window.electronIPC) {
                    const filePath = folder.path + '/' + fileName;
                    window.electronIPC.send('create-file', filePath, defaultContent);

                    const handleFileCreated = (event, createdPath, error) => {
                        if (createdPath === filePath) {
                            if (error) {
                                logError('创建文件失败:', error);
                                this.showError(`创建文件失败: ${error}`);
                            } else {
                                logInfo('在文件夹', folder.name, '中创建文件:', fileName);
                                this.refresh();
                                if (window.tabManager) {
                                    window.tabManager.openFile(fileName, defaultContent, false, createdPath);
                                }
                            }
                            window.electronIPC.ipcRenderer.removeListener('file-created', handleFileCreated);
                        }
                    };

                    window.electronIPC.on('file-created', handleFileCreated);
                } else {
                    this.showError('文件创建功能需要在完整应用环境中运行');
                }
            }
        } catch (error) {
            logError('在文件夹中创建文件时出错:', error);
        }
    }

    async createNewFolderInFolder(parentFolder) {
        logInfo('在文件夹中创建新文件夹:', parentFolder.name);

        try {
            const folderName = await dialogManager.showNewFolderDialog();
            if (folderName) {
                // Validate the folder name before sending to backend
                const validation = this.validateFileName(folderName);
                if (!validation.valid) {
                    this.showError(validation.error);
                    logWarn('文件夹创建失败 - 非法名称:', folderName, '-', validation.error);
                    return;
                }

                if (window.electronIPC) {
                    const folderPath = parentFolder.path + '/' + folderName;
                    window.electronIPC.send('create-folder', folderPath);

                    const handleFolderCreated = (event, createdPath, error) => {
                        if (createdPath === folderPath) {
                            if (error) {
                                logError('创建文件夹失败:', error);
                                this.showError(`创建文件夹失败: ${error}`);
                            } else {
                                logInfo('在文件夹', parentFolder.name, '中创建文件夹:', folderName);
                                this.refresh();
                            }
                            window.electronIPC.ipcRenderer.removeListener('folder-created', handleFolderCreated);
                        }
                    };

                    window.electronIPC.on('folder-created', handleFolderCreated);
                } else {
                    this.showError('文件夹创建功能需要在完整应用环境中运行');
                }
            }
        } catch (error) {
            logError('在文件夹中创建文件夹时出错:', error);
        }
    }

    refresh() {
        logInfo('刷新文件管理器');
        this.loadFiles();
    }

    async checkFileExists(filePath) {
        try {
            if (window.electronAPI && window.electronAPI.checkFileExists) {
                return await window.electronAPI.checkFileExists(filePath);
            }
            return this.findFileByPath(filePath) !== null;
        } catch (error) {
            logError('检查文件是否存在时出错:', error);
            return false;
        }
    }

    async deleteFiles(files) {
        const validFiles = Array.isArray(files) ? files.filter(f => f?.path) : [];
        const uniqueFiles = [];
        const seen = new Set();
        for (const f of validFiles) {
            if (!seen.has(f.path)) {
                seen.add(f.path);
                uniqueFiles.push(f);
            }
        }

        if (uniqueFiles.length === 0) {
            logWarn('deleteFiles 调用时文件列表为空');
            return;
        }

        if (uniqueFiles.length === 1) {
            return this.deleteFile(uniqueFiles[0]);
        }

        const preview = uniqueFiles.slice(0, 3).map(f => `"${f.name}"`).join('、');
        const moreHint = uniqueFiles.length > 3 ? ' 等' : '';
        const message = `确定要删除这 ${uniqueFiles.length} 个项目吗？${preview}${moreHint}`;
        const confirmed = await this.confirmOperation('删除文件', message);
        if (!confirmed) {
            this.refocusSelectedFile();
            return;
        }

        for (const file of uniqueFiles) {
            try {
                await this.deleteFile(file, { skipConfirm: true, skipRefresh: true, suppressFocus: true });
            } catch (error) {
                logError('批量删除文件时出错:', error);
            }
        }

        this.refresh();
        setTimeout(() => this.refocusSelectedFile(), 50);
    }

    async deleteFile(file, options = {}) {
        if (!file) {
            logWarn('deleteFile 调用时未提供有效文件');
            return;
        }

        const { skipConfirm = false, skipRefresh = false, suppressFocus = false } = options;

        logInfo('删除文件:', file.name);

        if (!skipConfirm) {
            const confirmed = await this.confirmOperation('删除文件', `确定要删除 "${file.name}" 吗？`);
            if (!confirmed) {
                if (!suppressFocus) this.refocusSelectedFile();
                return;
            }
        }

        logInfo('用户确认删除文件:', file.name);

        if (window.electronIPC) {
            return await new Promise((resolve) => {
                window.electronIPC.send('delete-file', file.path);

                const handleFileDeleted = (event, deletedPath, error) => {
                    if (deletedPath === file.path) {
                        if (error) {
                            logError('删除文件失败:', error);
                            this.showError(`删除失败: ${error}`);
                            if (!suppressFocus) setTimeout(() => this.refocusSelectedFile(), 0);
                        } else {
                            this.selectedFiles.delete(file.path);
                            if (this.selectedFile && this.selectedFile.path === file.path) {
                                this.selectedFile = this.getPrimarySelection();
                            }

                            if (window.tabManager) {
                                const normalizedPath = typeof file.path === 'string' ? file.path.replace(/\\/g, '/') : '';
                                if (normalizedPath && typeof window.tabManager.closeTabByUniqueKey === 'function') {
                                    window.tabManager.closeTabByUniqueKey(normalizedPath, { skipAutoSave: true });
                                } else if (typeof window.tabManager.closeTabByFileName === 'function') {
                                    window.tabManager.closeTabByFileName(file.name, { skipAutoSave: true });
                                }
                            }

                            if (!skipRefresh) {
                                this.refresh();
                            }
                            if (!suppressFocus) {
                                setTimeout(() => this.refocusSelectedFile(), 50);
                            }
                        }
                        window.electronIPC.ipcRenderer.removeListener('file-deleted', handleFileDeleted);
                        resolve();
                    }
                };

                window.electronIPC.on('file-deleted', handleFileDeleted);
            });
        }

        this.showError('文件删除功能需要在完整应用环境中运行');
        if (!suppressFocus) this.refocusSelectedFile();
    }
}

if (typeof window !== 'undefined') {
    window.FileExplorer = FileExplorer;
}