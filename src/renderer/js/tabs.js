class TabManager {
    constructor() {
        this.tabs = new Map();
        this.groups = new Map();
        this.groupOrder = [];
        this.activeGroupId = null;
        this.activeTab = null;
        this.activeTabKey = null;
        this.tabOrder = [];
        this.monacoEditorManager = null;
        this.editorGroupsElement = null;
        this.welcomeContainer = null;
        this.splitOverlay = null;
        this.groupCounter = 1;
        this.draggedTabInfo = null;
        this.draggedTab = null;
        this.placeholder = null;
        this.tabDragInProgress = false;
        this.lastTabDropInfo = null;
        this.dropHandled = false;
        this._openingKeys = new Set();
        this._watchedFiles = new Map(); 
        this._fileWatchListenerBound = false;
        this._externalFileChangeUnsubscribe = null;
        this._fileWatchCleanupBound = false;

        if (typeof window !== 'undefined') {
            this.handlePdfViewerMessage = this.handlePdfViewerMessage.bind(this);
            window.addEventListener('message', this.handlePdfViewerMessage, false);
        }

        this.init();
    }

    cacheDOM() {
        this.editorGroupsElement = document.getElementById('editor-groups');
        this.welcomeContainer = document.getElementById('welcome-container');
        if (!this.editorGroupsElement) {
            logError('TabManager: 未找到编辑器分组容器 #editor-groups');
        }
    }

    initializeGroups() {
        if (!this.editorGroupsElement) {
            this.cacheDOM();
        }

        const groupElements = Array.from(document.querySelectorAll('.editor-group'));
        if (groupElements.length === 0 && this.editorGroupsElement) {
            const defaultGroup = document.createElement('div');
            defaultGroup.className = 'editor-group';
            defaultGroup.dataset.groupId = 'group-1';

            const tabBar = document.createElement('div');
            tabBar.className = 'tab-bar';
            tabBar.dataset.groupId = 'group-1';

            const editorArea = document.createElement('div');
            editorArea.className = 'editor-area';
            editorArea.dataset.groupId = 'group-1';

            defaultGroup.appendChild(tabBar);
            defaultGroup.appendChild(editorArea);
            this.editorGroupsElement.appendChild(defaultGroup);
            groupElements.push(defaultGroup);
        }

        groupElements.forEach((groupEl, index) => {
            let groupId = groupEl.dataset.groupId;
            if (!groupId) {
                groupId = `group-${index + 1}`;
                groupEl.dataset.groupId = groupId;
            }
            const numericId = parseInt(groupId.replace(/[^0-9]/g, ''), 10);
            if (!Number.isNaN(numericId)) {
                this.groupCounter = Math.max(this.groupCounter, numericId);
            }

            const tabBar = groupEl.querySelector('.tab-bar');
            const editorArea = groupEl.querySelector('.editor-area');
            if (tabBar) {
                tabBar.dataset.groupId = groupId;
            }
            if (editorArea) {
                editorArea.dataset.groupId = groupId;
                this.bindEditorAreaDnD(editorArea);
            }

            const groupData = {
                id: groupId,
                element: groupEl,
                tabBar,
                editorArea,
                tabs: new Map(),
                tabOrder: [],
                activeTabKey: null,
                size: 1,
            };

            this.groups.set(groupId, groupData);
            if (!this.groupOrder.includes(groupId)) {
                this.groupOrder.push(groupId);
            }

            if (tabBar) {
                this.bindTabBarEvents(tabBar);
            }
        });

        if (!this.activeGroupId && this.groupOrder.length > 0) {
            this.activeGroupId = this.groupOrder[0];
        }

        this.ensureSplitOverlay();
        this.refreshGroupResizers();
    }

    bindEditorAreaDnD(editorArea) {
        if (!editorArea || editorArea._editorDnDBound) return;
        const onDragOver = (e) => {
            try {
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'copy';
                }
            } catch (_) { }
        };
        const onDrop = async (e) => {
            try {
                e.preventDefault();
                e.stopPropagation();
                const groupId = editorArea.dataset.groupId || this.activeGroupId || 'group-1';
                await this.processExternalDrop(e.dataTransfer, groupId);
            } catch (err) {
                logWarn('编辑区 drop 处理失败:', err);
            }
        };
        editorArea.addEventListener('dragover', onDragOver, true);
        editorArea.addEventListener('drop', onDrop, true);
        editorArea._editorDnDBound = true;
    }

    async processExternalDrop(dataTransfer, groupId) {
        if (!dataTransfer) {
            return false;
        }

        if (this.tabDragInProgress) {
            return false;
        }

        if (this.isInternalTabDrag(dataTransfer)) {
            return false;
        }

        const entries = [];
        const text = typeof dataTransfer.getData === 'function' ? dataTransfer.getData('text/plain') || '' : '';
        if (text && text.trim().startsWith('{') && text.includes('files')) {
            try {
                const parsed = JSON.parse(text);
                if (parsed && Array.isArray(parsed.files)) {
                    parsed.files.forEach((f) => {
                        if (!f || f.type !== 'file') {
                            return;
                        }
                        const filePathRaw = typeof f.path === 'string' ? f.path : null;
                        const filePath = this.normalizeDroppedPath(filePathRaw);
                        if (!filePath) {
                            return;
                        }
                        const fileName = f.name || (filePath.split(/[\\\/]/).pop()) || 'untitled';
                        const base64 = typeof f.base64 === 'string' && f.base64.trim() ? f.base64.trim() : null;
                        entries.push({
                            fileName,
                            filePath,
                            fileObject: null,
                            base64
                        });
                    });
                }
            } catch (error) {
                logWarn('解析拖拽数据失败:', error);
            }
        }

        if (entries.length === 0) {
            const fileList = Array.from(dataTransfer.files || []);
            fileList.forEach((file) => {
                if (!file) {
                    return;
                }
                const fpRaw = typeof file.path === 'string' ? file.path : null;
                const fp = this.normalizeDroppedPath(fpRaw);
                const name = file.name || (fp && fp.split(/[\\\/]/).pop()) || 'untitled';
                entries.push({
                    fileName: name,
                    filePath: fp,
                    fileObject: file,
                    base64: null
                });
            });
        }

        if (entries.length === 0) {
            const uriList = typeof dataTransfer.getData === 'function' ? dataTransfer.getData('text/uri-list') || '' : '';
            if (uriList && uriList.trim()) {
                uriList.split(/\r?\n/).forEach((line) => {
                    const uri = line.trim();
                    if (!uri || uri.startsWith('#')) {
                        return;
                    }
                    if (!/^file:/i.test(uri)) {
                        return;
                    }
                    const normalizedPath = this.normalizeDroppedPath(uri);
                    const fileName = normalizedPath
                        ? normalizedPath.split(/[\\\/]/).pop()
                        : uri.split('/').pop();
                    entries.push({
                        fileName: fileName || 'untitled',
                        filePath: normalizedPath,
                        fileObject: null,
                        base64: null
                    });
                });
            }
        }

        if (entries.length === 0) {
            return false;
        }

        return this.openDropEntries(entries, groupId);
    }

    isInternalTabDrag(dataTransfer) {
        try {
            const types = Array.isArray(dataTransfer.types)
                ? dataTransfer.types
                : Array.from(dataTransfer.types || []);
            return types.includes('application/oicpp-tab');
        } catch (_) {
            return false;
        }
    }

    async openDropEntries(entries, groupId) {
        if (!Array.isArray(entries) || entries.length === 0) {
            return false;
        }

        let opened = false;
        for (const entry of entries) {
            if (!entry || !entry.fileName) {
                continue;
            }
            const displayName = entry.fileName || '未知文件';
            try {
                if (entry.fileObject && window.oicppApp?.openDroppedFile) {
                    await window.oicppApp.openDroppedFile(entry.fileObject, {
                        groupId,
                        fileName: entry.fileName,
                        filePath: entry.filePath || null,
                        base64Data: entry.base64 || null
                    });
                    opened = true;
                    continue;
                }

                const filePath = this.normalizeDroppedPath(entry.filePath);
                const isPdf = this.isPdfFile(entry.fileName);

                if (isPdf) {
                    await this.openFile(entry.fileName, '', false, {
                        filePath: filePath || null,
                        groupId,
                        viewType: 'pdf',
                        pdfBase64: entry.base64 && entry.base64.trim() ? entry.base64.trim() : null
                    });
                    opened = true;
                    continue;
                }

                if (filePath && window.electronAPI?.readFileContent) {
                    const content = await window.electronAPI.readFileContent(filePath);
                    if (typeof content === 'string') {
                        await this.openFile(entry.fileName, content, false, {
                            filePath,
                            groupId
                        });
                        opened = true;
                        continue;
                    }
                }

                if (entry.fileObject && typeof entry.fileObject.text === 'function') {
                    const content = await entry.fileObject.text();
                    await this.openFile(entry.fileName, content ?? '', false, {
                        filePath: filePath || null,
                        groupId
                    });
                    opened = true;
                    continue;
                }

                throw new Error('无法读取文件内容');
            } catch (error) {
                this.showDropError(displayName, error);
            }
        }

        return opened;
    }

    showDropError(displayName, error) {
        if (!window.dialogManager?.showError) {
            return;
        }
        const name = displayName || '未知文件';
        const message = error?.message || String(error || '未知错误');
        window.dialogManager.showError(`无法打开 ${name}\n${message}`);
    }

    ensureSplitOverlay() {
        if (this.splitOverlay) {
            return;
        }
        const container = this.editorGroupsElement?.parentElement;
        if (!container) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.className = 'split-drop-overlay';
        const onDragOver = (event) => {
            if (!this.draggedTabInfo) {
                return;
            }
            event.preventDefault();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'move';
            }
        };
        const onDragLeave = (event) => {
            if (event.relatedTarget && overlay.contains(event.relatedTarget)) {
                return;
            }
        };
        const onDrop = (event) => {
            if (!this.draggedTabInfo) {
                return;
            }
            event.preventDefault();
            const tabKey = event.dataTransfer?.getData('application/oicpp-tab') || this.draggedTabInfo.uniqueKey;
            const sourceGroupId = this.draggedTabInfo.groupId || this.activeGroupId;
            if (tabKey && sourceGroupId) {
                this.handleSplitDrop(tabKey, sourceGroupId);
            }
            this.hideSplitOverlay();
        };

        overlay.addEventListener('dragover', onDragOver);
        overlay.addEventListener('dragleave', onDragLeave);
        overlay.addEventListener('drop', onDrop);

        container.appendChild(overlay);
        this.splitOverlay = overlay;
    }

    showSplitOverlay(sourceGroupId) {
        if (!this.splitOverlay) return;
        const groupId = sourceGroupId || this.activeGroupId || '';
        if (!this.canSplitGroup(groupId)) {
            this.hideSplitOverlay();
            return;
        }
        this.splitOverlay.dataset.sourceGroupId = groupId;
        this.splitOverlay.classList.add('visible');
    }

    hideSplitOverlay() {
        if (!this.splitOverlay) return;
        this.splitOverlay.classList.remove('visible');
        delete this.splitOverlay.dataset.sourceGroupId;
    }

    getGroupTabCount(groupId) {
        if (!groupId) {
            return 0;
        }
        const group = this.groups.get(groupId);
        if (!group) {
            return 0;
        }
        if (group.tabBar && typeof group.tabBar.querySelectorAll === 'function') {
            return group.tabBar.querySelectorAll('.tab').length;
        }
        if (group.tabs instanceof Map) {
            return group.tabs.size;
        }
        return 0;
    }

    canSplitGroup(groupId) {
        return this.getGroupTabCount(groupId) > 1;
    }

    bindTabBarEvents(tabBar) {
        if (!tabBar || tabBar._tabBarEventsBound) {
            return;
        }
        const groupId = tabBar.dataset.groupId || tabBar.closest('.editor-group')?.dataset.groupId || this.activeGroupId || 'group-1';
        tabBar.dataset.groupId = groupId;
        this.ensureTabBarDragHandlers(tabBar);
        tabBar._tabBarEventsBound = true;
    }

    ensureTabBarDragHandlers(tabBar) {
        if (!tabBar || tabBar._dragHandlersBound) {
            return;
        }

        tabBar.addEventListener('dragover', (e) => {
            if (this.draggedTab && this.draggedTabInfo) {
                this.handleTabBarDragOver(e, tabBar);
            }
        });

        tabBar.addEventListener('drop', (e) => {
            if (this.draggedTab && this.draggedTabInfo) {
                this.handleTabBarDrop(e, tabBar);
            }
        });

        tabBar.addEventListener('dragleave', (e) => {
            if (this.placeholder && this.placeholder.parentNode === tabBar) {
                const rect = tabBar.getBoundingClientRect();
                const x = e.clientX;
                const y = e.clientY;

                if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
                    if (!tabBar.contains(e.relatedTarget)) {
                    }
                }
            }
        });

        tabBar._dragHandlersBound = true;
    }

    handleTabBarDragOver(e, tabBar) {
        if (!this.draggedTab || !this.draggedTabInfo) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const afterElement = this.getDragAfterElement(tabBar, e.clientX);

        if (!this.placeholder) {
            this.placeholder = document.createElement('div');
            this.placeholder.className = 'tab-placeholder';
            const baseWidth = this.draggedTab.offsetWidth || 140;
            const baseHeight = this.draggedTab.offsetHeight || 35;
            Object.assign(this.placeholder.style, {
                width: `${baseWidth}px`,
                height: `${baseHeight}px`,
                backgroundColor: '#2a2d2e',
                border: '2px dashed #0e639c',
                opacity: '0.4',
                boxSizing: 'border-box',
                display: 'inline-block'
            });
        }

        const currentParent = this.placeholder.parentNode;
        if (currentParent && currentParent !== tabBar) {
            currentParent.removeChild(this.placeholder);
        }

        if (afterElement == null) {
            if (!currentParent || currentParent !== tabBar || this.placeholder.nextSibling !== null) {
                tabBar.appendChild(this.placeholder);
            }
        } else if (afterElement !== this.placeholder) {
            const nextSibling = this.placeholder.nextSibling;
            if (nextSibling !== afterElement) {
                tabBar.insertBefore(this.placeholder, afterElement);
            }
        }

        const dropInfo = this.getDropTargetInfo(tabBar, e);
        const targetGroupId = tabBar.dataset.groupId || this.activeGroupId || 'group-1';
        this.lastTabDropInfo = {
            tabBar,
            targetGroupId,
            targetIndex: dropInfo.targetIndex,
            beforeElement: dropInfo.beforeElement || null
        };
    }

    handleTabBarDrop(e, tabBar) {
        if (!this.draggedTabInfo) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();

        const targetGroupId = tabBar.dataset.groupId || this.activeGroupId || 'group-1';
        const { targetIndex, beforeElement } = this.getDropTargetInfo(tabBar, e);
        const applied = this.applyTabDrop({
            tabBar,
            targetGroupId,
            targetIndex,
            beforeElement: beforeElement || null
        });

        if (applied) {
            this.dropHandled = true;
        }

        this.cleanupTabDrag();
    }

    applyTabDrop({ tabBar, targetGroupId, targetIndex, beforeElement }) {
        if (!this.draggedTabInfo || !tabBar) {
            return false;
        }

        const computed = this.getDropTargetInfo(tabBar);
        const finalIndex = typeof targetIndex === 'number' ? targetIndex : computed.targetIndex;
        const finalBefore = beforeElement || computed.beforeElement || null;

        const sameGroup = this.draggedTab && this.draggedTabInfo.groupId === targetGroupId;
        const uniqueKey = this.draggedTabInfo.uniqueKey;

        if (sameGroup) {
            this.reorderTabWithinGroup(tabBar, finalIndex, finalBefore);
        } else if (uniqueKey) {
            this.moveTabToGroup(uniqueKey, targetGroupId, finalIndex, finalBefore);
        } else {
            return false;
        }

        this.dropHandled = true;
        return true;
    }

    cleanupTabDrag(tabElement = null) {
        const tab = tabElement || this.draggedTab;
        if (tab) {
            tab.classList.remove('dragging');
            tab.style.opacity = '';
        }

        if (this.placeholder && this.placeholder.parentNode) {
            this.placeholder.parentNode.removeChild(this.placeholder);
        }

        this.placeholder = null;
        this.draggedTab = null;
        this.draggedTabInfo = null;
        this.tabDragInProgress = false;
        this.hideSplitOverlay();
        this.lastTabDropInfo = null;
    }

    getPlaceholderIndex(tabBar) {
        if (!tabBar || !this.placeholder) {
            return null;
        }
        let index = 0;
        for (const child of tabBar.children) {
            if (child === this.placeholder) {
                return index;
            }
            if (child.classList?.contains('tab') && child !== this.draggedTab) {
                index += 1;
            }
        }
        return null;
    }

    getDropTargetInfo(tabBar, event = null) {
        const allTabs = Array.from(tabBar.querySelectorAll('.tab'));
        const draggedTab = this.draggedTab;
        const otherTabs = draggedTab ? allTabs.filter((tab) => tab !== draggedTab) : allTabs.slice();

        let targetIndex = this.getPlaceholderIndex(tabBar);

        if (targetIndex == null && event && typeof event.clientX === 'number') {
            const afterElement = this.getDragAfterElement(tabBar, event.clientX);
            if (afterElement) {
                const idx = otherTabs.indexOf(afterElement);
                targetIndex = idx >= 0 ? idx : otherTabs.length;
            } else {
                targetIndex = otherTabs.length;
            }
        }

        if (targetIndex == null) {
            targetIndex = otherTabs.length;
        }

        if (targetIndex < 0) targetIndex = 0;
        if (targetIndex > otherTabs.length) targetIndex = otherTabs.length;

        const beforeElement = otherTabs[targetIndex] || null;
        return { targetIndex, beforeElement };
    }

    reorderTabWithinGroup(tabBar, targetIndex, beforeElement = null) {
        if (!this.draggedTab) {
            return;
        }

        let referenceNode = null;
        if (beforeElement && beforeElement.parentNode === tabBar) {
            referenceNode = beforeElement;
        } else if (this.placeholder && this.placeholder.parentNode === tabBar) {
            referenceNode = this.placeholder;
        } else if (typeof targetIndex === 'number') {
            const otherTabs = Array.from(tabBar.querySelectorAll('.tab')).filter((tab) => tab !== this.draggedTab);
            referenceNode = otherTabs[targetIndex] || null;
        }

        if (referenceNode === this.draggedTab) {
            referenceNode = this.draggedTab.nextSibling;
        }

        if (referenceNode) {
            tabBar.insertBefore(this.draggedTab, referenceNode);
        } else {
            tabBar.appendChild(this.draggedTab);
        }

        const groupId = tabBar.dataset.groupId;
        const uniqueKey = this.draggedTab.dataset.uniqueKey;
        if (uniqueKey) {
            const tabData = this.tabs.get(uniqueKey);
            if (tabData) {
                tabData.groupId = groupId;
            }
        }
        this.draggedTab.dataset.groupId = groupId;
        this.syncGroupTabs(groupId);
    }

    moveTabToGroup(uniqueKey, targetGroupId, dropIndex = null, beforeElement = null) {
        if (!uniqueKey) {
            return;
        }
        const tabData = this.tabs.get(uniqueKey);
        if (!tabData) {
            return;
        }

        const sourceGroupId = tabData.groupId;
        let fallbackKey = null;
        if (sourceGroupId) {
            fallbackKey = this.getFallbackTabKeyWithinGroup(sourceGroupId, uniqueKey);
            const sourceGroup = this.groups.get(sourceGroupId);
            if (sourceGroup && sourceGroup.activeTabKey === uniqueKey) {
                sourceGroup.activeTabKey = null;
            }
        }
        if (sourceGroupId === targetGroupId && sourceGroupId) {
            const targetGroup = this.groups.get(targetGroupId);
            if (targetGroup?.tabBar) {
                this.draggedTab = tabData.element;
                const fallbackIndex = dropIndex ?? Array.from(targetGroup.tabBar.querySelectorAll('.tab')).length;
                this.reorderTabWithinGroup(targetGroup.tabBar, fallbackIndex, beforeElement || null);
            }
            return;
        }

        let targetGroup = this.groups.get(targetGroupId);
        if (!targetGroup) {
            targetGroup = this.createGroup({ afterGroupId: sourceGroupId });
            targetGroupId = targetGroup?.id;
        }
        if (!targetGroup || !targetGroup.tabBar) {
            return;
        }

        const tabElement = tabData.element;
        if (tabElement) {
            tabElement.dataset.groupId = targetGroupId;
            let referenceNode = null;
            if (beforeElement && beforeElement.parentNode === targetGroup.tabBar) {
                referenceNode = beforeElement;
            } else if (this.placeholder && this.placeholder.parentNode === targetGroup.tabBar) {
                referenceNode = this.placeholder;
            } else if (dropIndex != null && dropIndex >= 0) {
                const targetTabs = Array.from(targetGroup.tabBar.querySelectorAll('.tab')).filter((tab) => tab !== tabElement);
                referenceNode = targetTabs[dropIndex] || null;
            }

            if (referenceNode === tabElement) {
                referenceNode = tabElement.nextSibling;
            }

            if (referenceNode) {
                targetGroup.tabBar.insertBefore(tabElement, referenceNode);
            } else {
                targetGroup.tabBar.appendChild(tabElement);
            }
        }

        if (sourceGroupId) {
            const sourceGroup = this.groups.get(sourceGroupId);
            sourceGroup?.tabs?.delete(uniqueKey);
            this.syncGroupTabs(sourceGroupId);
            this.ensureGroupHasActiveTab(sourceGroupId, { preferredUniqueKey: fallbackKey });
            this.handleGroupBecameEmpty(sourceGroupId);
        }

        targetGroup.tabs.set(uniqueKey, tabData);
        tabData.groupId = targetGroupId;

        if (tabData.viewType === 'pdf' && tabData.viewerContainer) {
            const newGroup = this.groups.get(targetGroupId);
            const targetArea = newGroup?.editorArea;
            if (targetArea) {
                targetArea.appendChild(tabData.viewerContainer);
                tabData.viewerContainer.dataset.groupId = targetGroupId;
                tabData.viewerContainer.style.display = 'none';
            }
        } else if (this.monacoEditorManager && tabData.tabId) {
            this.monacoEditorManager.moveEditorToGroup(tabData.tabId, targetGroupId);
        }

        this.activeGroupId = targetGroupId;
        targetGroup.activeTabKey = uniqueKey;
        this.activeTabKey = uniqueKey;
        this.activeTab = tabData.fileName;

        this.syncGroupTabs(targetGroupId);

        this.activateTabByUniqueKey(uniqueKey).catch(logError);
    }

    syncGroupTabs(groupId) {
        const group = this.groups.get(groupId);
        if (!group || !group.tabBar) {
            return;
        }
        const newMap = new Map();
        const tabElements = group.tabBar.querySelectorAll('.tab');
        tabElements.forEach((tabElement) => {
            const key = tabElement.dataset.uniqueKey;
            if (!key) return;
            const tabData = this.tabs.get(key);
            if (tabData) {
                tabData.element = tabElement;
                tabData.groupId = groupId;
                newMap.set(key, tabData);
            }
        });
        group.tabs = newMap;
        group.tabOrder = Array.from(newMap.keys());
        this.updateGlobalTabOrder();
    }

    updateGlobalTabOrder() {
        const orderedNames = [];
        if (Array.isArray(this.groupOrder)) {
            this.groupOrder.forEach((groupId) => {
                const group = this.groups.get(groupId);
                if (!group || !Array.isArray(group.tabOrder)) {
                    return;
                }
                group.tabOrder.forEach((key) => {
                    const tabData = this.tabs.get(key);
                    if (tabData) {
                        orderedNames.push(tabData.fileName);
                    }
                });
            });
        }
        this.tabOrder = orderedNames;
    }

    getFallbackTabKeyWithinGroup(groupId, removedKey = null) {
        const group = this.groups.get(groupId);
        if (!group?.tabBar) {
            return null;
        }
        const tabs = Array.from(group.tabBar.querySelectorAll('.tab'));
        if (tabs.length === 0) {
            return null;
        }
        if (removedKey) {
            const removedIndex = tabs.findIndex((tab) => tab.dataset.uniqueKey === removedKey);
            if (removedIndex !== -1) {
                const right = tabs[removedIndex + 1];
                if (right?.dataset.uniqueKey && right.dataset.uniqueKey !== removedKey) {
                    return right.dataset.uniqueKey;
                }
                const left = tabs[removedIndex - 1];
                if (left?.dataset.uniqueKey && left.dataset.uniqueKey !== removedKey) {
                    return left.dataset.uniqueKey;
                }
            }
        }
        const first = tabs[0];
        if (first?.dataset.uniqueKey && first.dataset.uniqueKey !== removedKey) {
            return first.dataset.uniqueKey;
        }
        if (tabs[1]?.dataset.uniqueKey && tabs[1].dataset.uniqueKey !== removedKey) {
            return tabs[1].dataset.uniqueKey;
        }
        return null;
    }

    ensureGroupHasActiveTab(groupId, options = {}) {
        const group = this.groups.get(groupId);
        if (!group?.tabBar) {
            return;
        }

        const { preferredUniqueKey = null, triggerEditor = true } = options;

        if (!group.tabs || group.tabs.size === 0) {
            group.activeTabKey = null;
            group.tabBar.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
            return;
        }

        let candidateKey = null;
        if (preferredUniqueKey && group.tabs.has(preferredUniqueKey)) {
            candidateKey = preferredUniqueKey;
        } else if (group.activeTabKey && group.tabs.has(group.activeTabKey)) {
            candidateKey = group.activeTabKey;
        } else {
            const firstTab = group.tabBar.querySelector('.tab');
            candidateKey = firstTab?.dataset.uniqueKey || Array.from(group.tabs.keys())[0];
        }

        if (!candidateKey) {
            group.activeTabKey = null;
            group.tabBar.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
            return;
        }

        group.activeTabKey = candidateKey;
        group.tabBar.querySelectorAll('.tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.uniqueKey === candidateKey);
        });

        if (!triggerEditor) {
            return;
        }

        const tabData = this.tabs.get(candidateKey);
        if (tabData?.viewType === 'pdf') {
            this.activateTabByUniqueKey(candidateKey).catch(logError);
            return;
        }
        const tabId = tabData?.tabId;
        if (tabId && this.monacoEditorManager && typeof this.monacoEditorManager.switchTab === 'function') {
            const currentActive = this.monacoEditorManager.groupActiveTab?.get?.(groupId);
            if (currentActive !== tabId) {
                this.monacoEditorManager.switchTab(tabId);
            }
        }
    }

    handleSplitDrop(uniqueKey, sourceGroupId) {
        const tabKey = uniqueKey || this.draggedTabInfo?.uniqueKey;
        if (!tabKey) return;
        const sourceGroup = this.groups.get(sourceGroupId) || this.groups.get(this.activeGroupId);
        if (!sourceGroup) return;
        if (!this.canSplitGroup(sourceGroup.id)) {
            return;
        }

        const originalSize = sourceGroup.size || 1;
        const newSize = Math.max(originalSize / 2, 1);
        sourceGroup.size = newSize;
        const newGroup = this.createGroup({ afterGroupId: sourceGroup.id, size: newSize });
        this.updateGroupLayout();

        if (newGroup) {
            this.moveTabToGroup(tabKey, newGroup.id, 0, null);
        }
    }

    splitActiveTabToNewGroup() {
        const uniqueKey = this.activeTabKey || null;
        const groupId = this.activeGroupId || null;
        if (!uniqueKey || !groupId) {
            return false;
        }
        if (!this.canSplitGroup(groupId)) {
            return false;
        }
        this.handleSplitDrop(uniqueKey, groupId);
        return true;
    }

    createGroup({ afterGroupId = null, size = 1 } = {}) {
        if (!this.editorGroupsElement) {
            return null;
        }
        const groupId = `group-${++this.groupCounter}`;
        const groupElement = document.createElement('div');
        groupElement.className = 'editor-group';
        groupElement.dataset.groupId = groupId;

        const tabBar = document.createElement('div');
        tabBar.className = 'tab-bar';
        tabBar.dataset.groupId = groupId;

        const editorArea = document.createElement('div');
        editorArea.className = 'editor-area';
        editorArea.dataset.groupId = groupId;

        groupElement.appendChild(tabBar);
        groupElement.appendChild(editorArea);

        this.bindEditorAreaDnD(editorArea);

        if (afterGroupId && this.groups.has(afterGroupId)) {
            const afterGroup = this.groups.get(afterGroupId);
            if (afterGroup?.element?.parentNode === this.editorGroupsElement) {
                this.editorGroupsElement.insertBefore(groupElement, afterGroup.element.nextSibling);
            } else {
                this.editorGroupsElement.appendChild(groupElement);
            }
            const insertIndex = this.groupOrder.indexOf(afterGroupId) + 1;
            this.groupOrder.splice(insertIndex, 0, groupId);
        } else {
            this.editorGroupsElement.appendChild(groupElement);
            this.groupOrder.push(groupId);
        }

        const groupData = {
            id: groupId,
            element: groupElement,
            tabBar,
            editorArea,
            tabs: new Map(),
            tabOrder: [],
            activeTabKey: null,
            size: size || 1
        };

        this.groups.set(groupId, groupData);
        this.bindTabBarEvents(tabBar);

        if (this.monacoEditorManager) {
            this.monacoEditorManager.registerGroup(groupId, editorArea);
        }

        this.updateGroupLayout();
        this.refreshGroupResizers();

        return groupData;
    }

    updateGroupLayout() {
        const totalSize = this.groupOrder.reduce((sum, id) => {
            const group = this.groups.get(id);
            return sum + (group?.size || 1);
        }, 0);
        if (totalSize <= 0) {
            return;
        }
        this.groupOrder.forEach((id) => {
            const group = this.groups.get(id);
            if (!group) return;
            const weight = group.size || 1;
            group.element.style.flex = `${weight} 1 0`;
        });
    }

    handleGroupBecameEmpty(groupId) {
        const group = this.groups.get(groupId);
        if (!group) {
            return;
        }
        const hasTabs = group.tabBar && group.tabBar.querySelector('.tab');
        if (hasTabs) {
            return;
        }
        if (this.groups.size <= 1) {
            return;
        }

        if (group.element && group.element.parentNode === this.editorGroupsElement) {
            this.editorGroupsElement.removeChild(group.element);
        }
        this.groups.delete(groupId);
        this.groupOrder = this.groupOrder.filter((id) => id !== groupId);

        if (this.monacoEditorManager) {
            this.monacoEditorManager.unregisterGroup(groupId);
        }

        if (this.activeGroupId === groupId) {
            this.activeGroupId = this.groupOrder[0] || null;
            const firstGroup = this.groups.get(this.activeGroupId);
            if (firstGroup && firstGroup.activeTabKey) {
                this.activeTabKey = firstGroup.activeTabKey;
            }
        }

        if (this.groups.size === 1) {
            const remainingId = this.groupOrder[0];
            const remainingGroup = this.groups.get(remainingId);
            if (remainingGroup) {
                remainingGroup.size = 1;
            }
        }

        this.updateGroupLayout();
        this.refreshGroupResizers();
    }

    refreshGroupResizers() {
        if (!this.editorGroupsElement) return;
        const oldResizers = Array.from(this.editorGroupsElement.querySelectorAll('.editor-group-resizer'));
        oldResizers.forEach(r => r.parentNode && r.parentNode.removeChild(r));

        if (!this.groupOrder || this.groupOrder.length <= 1) return;

        for (let i = 0; i < this.groupOrder.length - 1; i++) {
            const leftId = this.groupOrder[i];
            const rightId = this.groupOrder[i + 1];
            const leftGroup = this.groups.get(leftId);
            const rightGroup = this.groups.get(rightId);
            if (!leftGroup?.element || !rightGroup?.element) continue;

            const resizer = document.createElement('div');
            resizer.className = 'editor-group-resizer';
            resizer.dataset.leftGroupId = leftId;
            resizer.dataset.rightGroupId = rightId;
            this.bindResizerEvents(resizer);
            this.editorGroupsElement.insertBefore(resizer, rightGroup.element);
        }
    }

    bindResizerEvents(resizer) {
        if (!resizer || resizer._bound) return;
        const onMouseDown = (e) => {
            try {
                e.preventDefault();
                e.stopPropagation();
                const leftId = resizer.dataset.leftGroupId;
                const rightId = resizer.dataset.rightGroupId;
                const leftGroup = this.groups.get(leftId);
                const rightGroup = this.groups.get(rightId);
                if (!leftGroup?.element || !rightGroup?.element) return;

                const leftEl = leftGroup.element;
                const rightEl = rightGroup.element;
                const leftStart = leftEl.getBoundingClientRect().width;
                const rightStart = rightEl.getBoundingClientRect().width;
                const totalPx = leftStart + rightStart;
                const startX = e.clientX;
                const minPx = 160;
                const leftSize0 = leftGroup.size || 1;
                const rightSize0 = rightGroup.size || 1;
                const sumSize0 = leftSize0 + rightSize0;

                const onMouseMove = (ev) => {
                    let delta = ev.clientX - startX;
                    let newLeft = leftStart + delta;
                    let newRight = rightStart - delta;
                    if (newLeft < minPx) {
                        newLeft = minPx;
                        newRight = totalPx - newLeft;
                    }
                    if (newRight < minPx) {
                        newRight = minPx;
                        newLeft = totalPx - newRight;
                    }
                    if (newLeft < minPx || newRight < minPx) return;

                    const leftRatio = newLeft / (newLeft + newRight);
                    const rightRatio = 1 - leftRatio;
                    leftGroup.size = sumSize0 * leftRatio;
                    rightGroup.size = sumSize0 * rightRatio;
                    this.updateGroupLayout();
                };

                const onMouseUp = () => {
                    document.removeEventListener('mousemove', onMouseMove, true);
                    document.removeEventListener('mouseup', onMouseUp, true);
                    resizer.classList.remove('dragging');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                };

                document.addEventListener('mousemove', onMouseMove, true);
                document.addEventListener('mouseup', onMouseUp, true);
                resizer.classList.add('dragging');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
            } catch (err) { logWarn('分隔条拖拽初始化失败:', err); }
        };
        resizer.addEventListener('mousedown', onMouseDown);
        resizer._bound = true;
    }

    findUniqueKeyByFileName(fileName) {
        for (const [uniqueKey, tabData] of this.tabs.entries()) {
            if (tabData.fileName === fileName) {
                return uniqueKey;
            }
        }
        return null;
    }

    getTabByFileName(fileName) {
        const matchingTabs = [];
        for (const [uniqueKey, tabData] of this.tabs) {
            if (tabData.fileName === fileName) {
                matchingTabs.push({ uniqueKey, tabData });
            }
        }

        if (matchingTabs.length === 0) {
            return null;
        }

        if (matchingTabs.length === 1) {
            return matchingTabs[0].tabData;
        }


        if (this.activeTab === fileName) {
            const activeMatch = matchingTabs.find(item => item.tabData.active);
            if (activeMatch) {
                return activeMatch.tabData;
            }
        }

        if (window.sidebarManager && window.sidebarManager.panels && window.sidebarManager.panels.files) {
            const fileExplorer = window.sidebarManager.panels.files;
            if (fileExplorer.selectedFile && fileExplorer.selectedFile.name === fileName) {
                const contextPath = fileExplorer.selectedFile.path;
                const contextMatch = matchingTabs.find(item => item.uniqueKey === contextPath);
                if (contextMatch) {
                    return contextMatch.tabData;
                }
            }
        }

        const activeMatch = matchingTabs.find(item =>
            item.tabData.element && item.tabData.element.classList.contains('active')
        );
        if (activeMatch) {
            return activeMatch.tabData;
        }

        return matchingTabs[0].tabData;
    }

    async activateTabByUniqueKey(uniqueKey) {
        const tabData = this.tabs.get(uniqueKey);
        if (!tabData) {
            logError('未找到uniqueKey对应的标签页:', uniqueKey);
            return;
        }
        this.saveCurrentEditorContent();

        this.activeTab = tabData.fileName;
        this.activeTabKey = uniqueKey;
        this.activeGroupId = tabData.groupId;

        const group = this.groups.get(tabData.groupId);
        if (group?.tabBar) {
            group.tabBar.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            if (tabData.element && tabData.element.parentNode === group.tabBar) {
                tabData.element.classList.add('active');
            } else {
                const targetTab = group.tabBar.querySelector(`[data-unique-key="${uniqueKey}"]`);
                if (targetTab) {
                    targetTab.classList.add('active');
                    tabData.element = targetTab;
                } else {
                    logError('无法在目标分组中找到对应的DOM元素:', uniqueKey);
                }
            }
            group.activeTabKey = uniqueKey;
        }

        if (tabData.viewType === 'pdf') {
            this.hideGroupViewContainers(tabData.groupId);
            if (!tabData.viewerContainer || !tabData.viewerContainer.parentElement) {
                tabData.viewerContainer = this.createPdfViewerContainer({
                    groupId: tabData.groupId,
                    tabId: tabData.tabId || this.generatePdfTabId(tabData.uniqueKey),
                    filePath: tabData.filePath,
                    fileName: tabData.fileName
                });
                tabData.viewerFrame = tabData.viewerContainer?.querySelector('.pdf-viewer-frame') || null;
            } else if (tabData.viewerContainer.dataset.groupId !== tabData.groupId) {
                const targetGroup = this.groups.get(tabData.groupId);
                if (targetGroup?.editorArea) {
                    targetGroup.editorArea.appendChild(tabData.viewerContainer);
                    tabData.viewerContainer.dataset.groupId = tabData.groupId;
                }
            }
            if (tabData.viewerContainer) {
                tabData.viewerContainer.style.display = 'flex';
                tabData.viewerContainer.classList.add('active');
                this.focusPdfViewer(tabData);
            }
            if (this.monacoEditorManager) {
                try {
                    this.monacoEditorManager.groupActiveTab.set(tabData.groupId, null);
                    this.monacoEditorManager.currentEditor = null;
                } catch (err) {
                    logWarn('切换到PDF视图时更新编辑器状态失败:', err);
                }
            }
        } else if (tabData.viewType === 'markdown') {
            this.hideGroupViewContainers(tabData.groupId);
            if (!tabData.viewerContainer || !tabData.viewerContainer.parentElement) {
                tabData.viewerContainer = this.createMarkdownViewerContainer({
                    groupId: tabData.groupId,
                    tabId: tabData.tabId || this.generateMarkdownTabId(tabData.uniqueKey),
                    filePath: tabData.filePath,
                    fileName: tabData.fileName,
                    content: tabData.content
                });
            } else if (tabData.viewerContainer.dataset.groupId !== tabData.groupId) {
                const targetGroup = this.groups.get(tabData.groupId);
                if (targetGroup?.editorArea) {
                    targetGroup.editorArea.appendChild(tabData.viewerContainer);
                    tabData.viewerContainer.dataset.groupId = tabData.groupId;
                }
            }
            if (tabData.viewerContainer) {
                tabData.viewerContainer.style.display = 'flex';
                tabData.viewerContainer.classList.add('active');
            }
            if (this.monacoEditorManager) {
                try {
                    this.monacoEditorManager.groupActiveTab.set(tabData.groupId, null);
                    this.monacoEditorManager.currentEditor = null;
                } catch (err) {
                    logWarn('切换到 Markdown 视图时更新编辑器状态失败:', err);
                }
            }
        } else if (this.monacoEditorManager) {
            this.hideGroupViewContainers(tabData.groupId);
            const expectedTabId = this.monacoEditorManager.generateTabId(tabData.fileName, tabData.filePath || tabData.uniqueKey || null);
            const actualTabId = tabData.tabId || expectedTabId;
            const editorExists = this.monacoEditorManager.editors && this.monacoEditorManager.editors.has(actualTabId);
            if (editorExists) {
                await this.monacoEditorManager.switchTab(actualTabId);
                logInfo('编辑器已存在，切换到:', tabData.fileName, 'tabId:', actualTabId);
            } else {
                logInfo('编辑器不存在，重新加载文件:', tabData.fileName, '期望tabId:', expectedTabId);
                this.loadFileContentToEditor(tabData.fileName, tabData);
            }
        } else {
            this.hideGroupViewContainers(tabData.groupId);
            this.loadFileContentToEditor(tabData.fileName, tabData);
        }

        for (const [key, tab] of this.tabs) {
            tab.active = (key === uniqueKey);
        }

        if (this.welcomeContainer) {
            this.welcomeContainer.style.display = 'none';
        }
        if (this.editorGroupsElement) {
            this.editorGroupsElement.style.display = 'flex';
        }

        if (window.sidebarManager) {
            try {
                if (typeof window.sidebarManager.showForEditor === 'function') {
                    window.sidebarManager.showForEditor();
                } else if (typeof window.sidebarManager.enableResize === 'function') {
                    window.sidebarManager.enableResize();
                }
            } catch (e) {
                logWarn('恢复侧边栏状态失败:', e);
            }
        }

        if (tabData.externalModified) {
            const forcePrompt = !!tabData.pendingExternalPrompt || !tabData.externalPromptDismissed;
            this.maybePromptExternalReload(tabData, { force: forcePrompt }).catch(logWarn);
        }
    }

    closeTabByUniqueKey(uniqueKey, options = {}) {
        const tabData = this.tabs.get(uniqueKey);
        if (!tabData) {
            logError('标签页不存在 (uniqueKey):', uniqueKey);
            return;
        }
        return this.closeTab(tabData.fileName, {
            ...options,
            uniqueKeyOverride: uniqueKey
        });
    }

    setTabElementUniqueKey(tabElement, uniqueKey) {
        if (tabElement) {
            tabElement.dataset.uniqueKey = uniqueKey;
        }
    }

    attachTabEventHandlers(tabElement) {
        if (!tabElement || tabElement._tabEventsBound) {
            return;
        }

        const getUniqueKey = () => tabElement.dataset.uniqueKey;

        tabElement.addEventListener('click', (e) => {
            if (e.target.classList.contains('tab-close')) {
                return;
            }
            const uniqueKey = getUniqueKey();
            if (uniqueKey) {
                this.activateTabByUniqueKey(uniqueKey).catch(logError);
            }
        });

        const closeBtn = tabElement.querySelector('.tab-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const uniqueKey = getUniqueKey();
                if (uniqueKey) {
                    this.closeTabByUniqueKey(uniqueKey);
                }
            });
        }

        tabElement.addEventListener('mouseup', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                const uniqueKey = getUniqueKey();
                if (uniqueKey) {
                    this.closeTabByUniqueKey(uniqueKey);
                }
            }
        });

        tabElement._tabEventsBound = true;
    }

    init() {
        this.cacheDOM();
        this.initializeGroups();
        this.setupEventListeners();
        this.initializeTabs();

        this.initializeEditorManagerReference();
        this.bindExternalFileWatcher();
    }

    initializeEditorManagerReference() {
        this.tryGetEditorManagerReference();

        if (!this.monacoEditorManager) {
            let retryCount = 0;
            const maxRetries = 20; // 最多重试20次
            const retryInterval = 200; // 每200ms重试一次

            const retryTimer = setInterval(() => {
                retryCount++;
                logInfo(`TabManager: 第${retryCount}次尝试获取编辑器管理器引用`);

                this.tryGetEditorManagerReference();

                if (this.monacoEditorManager || retryCount >= maxRetries) {
                    clearInterval(retryTimer);
                    if (!this.monacoEditorManager) {
                        logError('TabManager: 无法获取编辑器管理器引用，updateSettings功能将不可用');
                    }
                }
            }, retryInterval);
        }
    }

    tryGetEditorManagerReference() {
        if (window.editorManager) {
            this.monacoEditorManager = window.editorManager;
            logInfo('TabManager: 从全局变量获取到编辑器管理器引用');
            this.registerGroupsWithEditorManager();
            return true;
        }

        if (window.oicppApp && window.oicppApp.editorManager) {
            this.monacoEditorManager = window.oicppApp.editorManager;
            logInfo('TabManager: 从oicppApp获取到编辑器管理器引用');
            this.registerGroupsWithEditorManager();
            return true;
        }

        if (window.app && window.app.editorManager) {
            this.monacoEditorManager = window.app.editorManager;
            logInfo('TabManager: 从app获取到编辑器管理器引用');
            this.registerGroupsWithEditorManager();
            return true;
        }

        return false;
    }

    registerGroupsWithEditorManager() {
        if (!this.monacoEditorManager) return;
        for (const groupId of this.groupOrder) {
            const group = this.groups.get(groupId);
            if (group && group.editorArea) {
                this.monacoEditorManager.registerGroup(groupId, group.editorArea);
            }
        }
    }

    bindExternalFileWatcher() {
        if (this._fileWatchListenerBound) {
            return;
        }
        if (window.electronAPI?.onExternalFileChange) {
            try {
                const unsubscribe = window.electronAPI.onExternalFileChange((payload) => {
                    this.handleExternalFileChange(payload);
                });
                if (typeof unsubscribe === 'function') {
                    this._externalFileChangeUnsubscribe = unsubscribe;
                }
                this._fileWatchListenerBound = true;
            } catch (error) {
                logWarn('TabManager: 绑定外部文件变更监听失败:', error);
            }
        }

        if (!this._fileWatchCleanupBound && typeof window !== 'undefined') {
            const beforeUnloadHandler = () => {
                try { this.disposeAllFileWatchers(); } catch (_) { }
                if (this._externalFileChangeUnsubscribe) {
                    try { this._externalFileChangeUnsubscribe(); } catch (_) { }
                    this._externalFileChangeUnsubscribe = null;
                }
            };
            window.addEventListener('beforeunload', beforeUnloadHandler, { once: true });
            this._fileWatchCleanupBound = true;
        }
    }

    normalizeWatchKey(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return '';
        }
        let normalized = filePath.replace(/\\/g, '/');
        if (this.isWindowsPlatform()) {
            normalized = normalized.toLowerCase();
        }
        return normalized;
    }

    async registerFileWatchForTab(tabData) {
        try {
            if (!tabData || tabData.viewType === 'pdf') {
                return;
            }
            const filePath = tabData.filePath;
            const tabId = tabData.tabId;
            if (!filePath || !tabId || !window.electronAPI?.watchFile) {
                return;
            }
            const key = this.normalizeWatchKey(filePath);
            if (!key) {
                return;
            }

            let entry = this._watchedFiles.get(key);
            if (!entry) {
                entry = { path: filePath, tabs: new Set(), lastChangeType: null };
                this._watchedFiles.set(key, entry);
                try {
                    const result = await window.electronAPI.watchFile(filePath);
                    if (result && result.success === false) {
                        this._watchedFiles.delete(key);
                        logWarn('TabManager: 主进程拒绝监听文件', { filePath, error: result.error });
                        return;
                    }
                } catch (error) {
                    this._watchedFiles.delete(key);
                    logWarn('TabManager: 注册文件监听失败:', error);
                    return;
                }
            }

            entry.path = filePath;
            entry.tabs.add(tabId);
        } catch (error) {
            logWarn('TabManager: 注册文件监听时发生异常:', error);
        }
    }

    async unregisterFileWatchForTab(tabData) {
        try {
            if (!tabData) {
                return;
            }
            const filePath = tabData.filePath;
            const tabId = tabData.tabId;
            if (!filePath || !tabId) {
                return;
            }
            const key = this.normalizeWatchKey(filePath);
            if (!key) {
                return;
            }
            const entry = this._watchedFiles.get(key);
            if (!entry) {
                return;
            }
            entry.tabs.delete(tabId);
            if (entry.tabs.size === 0) {
                this._watchedFiles.delete(key);
                if (window.electronAPI?.unwatchFile) {
                    try {
                        await window.electronAPI.unwatchFile(entry.path);
                    } catch (error) {
                        logWarn('TabManager: 取消文件监听失败:', error);
                    }
                }
            }
        } catch (error) {
            logWarn('TabManager: 取消文件监听时发生异常:', error);
        }
    }

    disposeAllFileWatchers() {
        if (!this._watchedFiles || this._watchedFiles.size === 0) {
            return;
        }
        const entries = Array.from(this._watchedFiles.values());
        this._watchedFiles.clear();
        if (window.electronAPI?.unwatchFile) {
            entries.forEach((entry) => {
                if (!entry?.path) return;
                window.electronAPI.unwatchFile(entry.path).catch(() => { });
            });
        }
    }

    getTabDataByTabId(tabId) {
        if (!tabId) {
            return null;
        }
        for (const tabData of this.tabs.values()) {
            if (tabData && tabData.tabId === tabId) {
                return tabData;
            }
        }
        return null;
    }

    handleTabFileWatchRebind(oldPath, newPath, tabData) {
        if (!tabData || tabData.viewType === 'pdf') {
            return;
        }
        try {
            if (oldPath && oldPath !== newPath) {
                const oldKey = this.normalizeWatchKey(oldPath);
                if (oldKey) {
                    const oldEntry = this._watchedFiles.get(oldKey);
                    if (oldEntry) {
                        oldEntry.tabs.delete(tabData.tabId);
                        if (oldEntry.tabs.size === 0) {
                            this._watchedFiles.delete(oldKey);
                            if (window.electronAPI?.unwatchFile) {
                                window.electronAPI.unwatchFile(oldEntry.path).catch(() => { });
                            }
                        }
                    }
                }
            }
            if (newPath && oldPath !== newPath) {
                Promise.resolve(this.registerFileWatchForTab(tabData)).catch((error) => {
                    logWarn('TabManager: 重新绑定文件监听失败:', error);
                });
            }
        } catch (error) {
            logWarn('TabManager: 处理文件监听重绑定失败:', error);
        }
    }

    handleExternalFileChange(payload = {}) {
        try {
            const key = this.normalizeWatchKey(payload.filePath);
            if (!key) {
                return;
            }
            const entry = this._watchedFiles.get(key);
            if (!entry) {
                return;
            }

            const tabIds = Array.from(entry.tabs);
            const affectedTabs = [];
            for (const tabId of tabIds) {
                const tabData = this.getTabDataByTabId(tabId);
                if (tabData) {
                    affectedTabs.push(tabData);
                } else {
                    entry.tabs.delete(tabId);
                }
            }

            if (affectedTabs.length === 0) {
                if (entry.tabs.size === 0) {
                    this._watchedFiles.delete(key);
                    if (window.electronAPI?.unwatchFile) {
                        window.electronAPI.unwatchFile(entry.path).catch(() => { });
                    }
                }
                return;
            }

            const changeType = payload.changeType || 'modified';
            const timestamp = payload.timestamp || Date.now();
            entry.lastChangeType = changeType;

            affectedTabs.forEach((tabData) => {
                tabData.externalModified = true;
                tabData.externalChangeType = changeType;
                tabData.externalChangeTimestamp = timestamp;
                tabData.externalPromptDismissed = false;
                tabData.pendingExternalPrompt = true;
            });

            this.refreshTabLabels();

            const activeTabData = affectedTabs.find(tab => tab.uniqueKey === this.activeTabKey);
            if (activeTabData) {
                this.maybePromptExternalReload(activeTabData, { force: true });
            }
        } catch (error) {
            logWarn('TabManager: 处理外部文件变更时发生异常:', error);
        }
    }

    triggerFileExplorerRefresh() {
        try {
            const sidebar = window.sidebarManager || null;
            let fileExplorer = null;
            if (sidebar?.getPanelManager) {
                try {
                    fileExplorer = sidebar.getPanelManager('files') || null;
                } catch (_) { }
            }
            if (!fileExplorer && sidebar?.panels?.files) {
                fileExplorer = sidebar.panels.files;
            }
            if (!fileExplorer && window.app?.fileExplorer) {
                fileExplorer = window.app.fileExplorer;
            }
            if (!fileExplorer && window.fileExplorer) {
                fileExplorer = window.fileExplorer;
            }
            if (fileExplorer?.refresh) {
                fileExplorer.refresh();
            }
        } catch (error) {
            logWarn('TabManager: 刷新文件管理器失败:', error);
        }
    }

    async maybePromptExternalReload(tabData, options = {}) {
        if (!tabData || tabData.viewType === 'pdf') {
            return;
        }
        if (!tabData.externalModified) {
            return;
        }
        if (tabData.externalPromptInProgress) {
            return;
        }

        const forcePrompt = !!options.force;
        if (!forcePrompt && tabData.externalPromptDismissed) {
            return;
        }

        tabData.pendingExternalPrompt = false;
        tabData.externalPromptInProgress = true;

        const changeType = tabData.externalChangeType || 'modified';
        const fileDisplay = tabData.fileName || tabData.filePath || '当前文件';
        const hasLocalChanges = !!tabData.modified;
        const shouldSuggestClose = changeType === 'deleted' || changeType === 'renamed';
        let message = '';

        if (changeType === 'deleted') {
            message = `文件 “${fileDisplay}” 已在外部被删除或移动。`;
        } else if (changeType === 'renamed') {
            message = `文件 “${fileDisplay}” 在外部可能被重命名或替换。`;
        } else {
            message = `文件 “${fileDisplay}” 已在外部被修改。`;
        }

        if (shouldSuggestClose) {
            message += '\n文件已不再可用，建议关闭该标签页并刷新文件管理器。';
            message += '\n关闭时不会保存当前编辑内容。';
        } else if (hasLocalChanges) {
            message += '\n重新加载将覆盖未保存的修改，是否继续？';
        } else {
            message += '\n是否重新加载以获取最新内容？';
        }

        let shouldReload = false;
        let shouldCloseTab = false;
        try {
            if (window.dialogManager?.showConfirmDialog) {
                const result = await window.dialogManager.showConfirmDialog('外部修改检测', message);
                if (shouldSuggestClose) {
                    shouldCloseTab = !!result;
                } else {
                    shouldReload = !!result;
                }
            } else {
                if (shouldSuggestClose) {
                    shouldCloseTab = window.confirm(message);
                } else {
                    shouldReload = window.confirm(message);
                }
            }
        } catch (error) {
            logWarn('TabManager: 弹出外部修改对话框失败:', error);
        }

        if (shouldSuggestClose) {
            tabData.pendingExternalPrompt = false;
            tabData.externalPromptInProgress = false;
            if (shouldCloseTab) {
                tabData.externalModified = false;
                tabData.externalPromptDismissed = false;
                const uniqueKey = tabData.uniqueKey || null;
                try {
                    if (uniqueKey && typeof this.closeTabByUniqueKey === 'function') {
                        this.closeTabByUniqueKey(uniqueKey, { skipAutoSave: true });
                    } else if (tabData.fileName) {
                        this.closeTab(tabData.fileName, { skipAutoSave: true });
                    }
                } catch (closeError) {
                    logWarn('TabManager: 外部变更关闭标签页失败:', closeError);
                }
                this.triggerFileExplorerRefresh();
            } else {
                tabData.externalPromptDismissed = true;
                this.refreshTabLabels();
            }
            return;
        }

        if (shouldReload) {
            const success = await this.reloadTabFromDisk(tabData);
            if (!success) {
                tabData.externalModified = true;
                tabData.externalPromptDismissed = false;
            }
        } else {
            tabData.externalPromptDismissed = true;
        }

        tabData.externalPromptInProgress = false;
        this.refreshTabLabels();
    }

    async reloadTabFromDisk(tabData) {
        if (!tabData || tabData.viewType === 'pdf' || !tabData.filePath) {
            return false;
        }
        try {
            if (!window.electronAPI?.readFileContent) {
                throw new Error('读文件接口不可用');
            }
            const content = await window.electronAPI.readFileContent(tabData.filePath);
            const editorManager = this.monacoEditorManager || window.monacoEditorManager || window.editorManager;
            let editor = null;
            if (editorManager?.editors instanceof Map && tabData.tabId) {
                editor = editorManager.editors.get(tabData.tabId) || null;
            }
            if (!editor && editorManager?.currentEditor) {
                const currentPath = editorManager.currentEditor.getFilePath ? editorManager.currentEditor.getFilePath() : editorManager.currentEditor.filePath;
                if (this.normalizeWatchKey(currentPath) === this.normalizeWatchKey(tabData.filePath)) {
                    editor = editorManager.currentEditor;
                }
            }

            if (editor && editor.getModel) {
                const model = editor.getModel();
                const viewState = editor.saveViewState ? editor.saveViewState() : null;
                model.setValue(content);
                if (viewState && editor.restoreViewState) {
                    editor.restoreViewState(viewState);
                }
                editor.pushUndoStop?.();
                editor.layout?.();
            }

            tabData.content = content;
            tabData.modified = false;
            tabData.externalModified = false;
            tabData.externalChangeType = null;
            tabData.externalPromptDismissed = false;
            tabData.pendingExternalPrompt = false;
            if (typeof this.markTabAsSavedByUniqueKey === 'function') {
                this.markTabAsSavedByUniqueKey(tabData.uniqueKey);
            }
            this.refreshTabLabels();
            return true;
        } catch (error) {
            logError('重新加载文件失败:', error);
            if (window.dialogManager?.showError) {
                window.dialogManager.showError(`重新加载文件失败：\n${error?.message || String(error)}`);
            }
            return false;
        }
    }

    setupEventListeners() {
        const tabs = document.querySelectorAll('.tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                if (!e.target.classList.contains('tab-close')) {
                    this.activateTab(tab.dataset.file).catch(logError);
                }
            });
        });

        const closeBtns = document.querySelectorAll('.tab-close');
        closeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const tab = e.target.closest('.tab');
                this.closeTab(tab.dataset.file);
            });
        });


        document.addEventListener('mouseup', (e) => {
            if (e.button === 1 && e.target.closest('.tab')) {
                const tab = e.target.closest('.tab');
                this.closeTab(tab.dataset.file);
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey) {
                switch (e.key) {
                    case 'Tab':
                        e.preventDefault();
                        this.switchToNextTab();
                        break;
                    case 'w':
                        e.preventDefault();
                        try {
                            const active = this.getTabByFileName(this.activeTab);
                            const mgr = window.monacoEditorManager || window.editorManager;
                            const ed = mgr?.currentEditor;
                            const content = ed?.getValue?.();
                            const filePath = ed?.getFilePath ? ed.getFilePath() : (active?.filePath || null);
                            if (content != null) {
                                if (filePath && window.electronAPI?.saveFile) {
                                    window.electronAPI.saveFile(filePath, content)
                                        .then(() => {
                                            const uniq = (filePath || '').replace(/\\/g, '/');
                                            if (uniq && this.markTabAsSavedByUniqueKey) this.markTabAsSavedByUniqueKey(uniq);
                                            else if (active?.fileName) this.markTabAsSaved(active.fileName);
                                        })
                                        .catch((e) => { logError('关闭前保存失败:', e); });
                                } else if (window.electronAPI?.saveAsFile) {
                                    window.electronAPI.saveAsFile(content)
                                        .then((newPath) => {
                                            if (newPath) {
                                                const uniq = newPath.replace(/\\/g, '/');
                                                if (uniq && this.markTabAsSavedByUniqueKey) this.markTabAsSavedByUniqueKey(uniq);
                                            }
                                        })
                                        .catch((e) => { logError('关闭前另存为失败:', e); });
                                }
                            }
                        } catch (_) { }
                        this.closeActiveTab();
                        break;
                    case '=':
                    case '+':
                        if (this.tryHandlePdfShortcut('zoom-in')) {
                            e.preventDefault();
                        }
                        break;
                    case '-':
                    case '_':
                        if (this.tryHandlePdfShortcut('zoom-out')) {
                            e.preventDefault();
                        }
                        break;
                    case '0':
                        if (this.tryHandlePdfShortcut('zoom-reset')) {
                            e.preventDefault();
                        }
                        break;
                    case 'm':
                        if (this.splitActiveTabToNewGroup()) {
                            e.preventDefault();
                        }
                        break;
                    case 't':
                        e.preventDefault();
                        this.createNewTab();
                        break;
                }
            }
        });
    }

    initializeTabs() {
        this.tabs.clear();
        this.tabOrder = [];
        this.groups.forEach((group) => {
            group.tabs = group.tabs || new Map();
            const tabElements = group.tabBar ? Array.from(group.tabBar.querySelectorAll('.tab')) : [];
            tabElements.forEach((tabEl) => {
                const fileName = tabEl.dataset.file || tabEl.querySelector('.tab-label')?.textContent?.trim() || 'untitled';
                const uniqueKey = tabEl.dataset.uniqueKey || tabEl.dataset.filePath || fileName;
                const tabData = {
                    element: tabEl,
                    fileName,
                    modified: tabEl.classList.contains('modified') || false,
                    content: '',
                    active: tabEl.classList.contains('active'),
                    filePath: tabEl.dataset.filePath || null,
                    tabId: tabEl.dataset.tabId || null,
                    uniqueKey,
                    groupId: group.id,
                    externalModified: false,
                    externalChangeType: null,
                    externalPromptDismissed: false,
                    externalPromptInProgress: false,
                    pendingExternalPrompt: false,
                    externalChangeTimestamp: null
                };
                this.tabs.set(uniqueKey, tabData);
                group.tabs.set(uniqueKey, tabData);
                this.setTabElementUniqueKey(tabEl, uniqueKey);
                tabEl.dataset.groupId = group.id;

                if (!tabEl.draggable) {
                    tabEl.draggable = true;
                }

                this.attachTabEventHandlers(tabEl);
                this.addTabDragListeners(tabEl);
                if (tabData.filePath) {
                    Promise.resolve(this.registerFileWatchForTab(tabData)).catch(() => { });
                }
                if (tabData.active) {
                    this.activeTab = fileName;
                    this.activeTabKey = uniqueKey;
                    group.activeTabKey = uniqueKey;
                    this.activeGroupId = group.id;
                }
            });
            group.tabOrder = Array.from(group.tabs.keys());
        });

        this.updateGlobalTabOrder();
    }

    async activateTab(fileName) {
        const uniqueKey = this.findUniqueKeyByFileName(fileName);
        if (uniqueKey) {
            await this.activateTabByUniqueKey(uniqueKey);
            return;
        }
        logError('activateTab: 无法根据文件名找到标签页', fileName);
    }

    saveCurrentEditorContent() {
        if (!this.activeTab) return;

        const currentTab = this.tabs.get(this.activeTab);
        if (!currentTab) return;

        const content = this.getCurrentEditorContent();
        if (content !== null) {
            if (currentTab.filePath && window.electronAPI?.saveFile) {
                window.electronAPI.saveFile(currentTab.filePath, content)
                    .then(() => { logInfo('文件自动保存成功:', currentTab.filePath); })
                    .catch((e) => { logError('自动保存失败:', e); });
            }

            currentTab.content = content;
        }
    }

    getCurrentEditorContent() {
        if (this.monacoEditorManager && this.monacoEditorManager.currentEditor) {
            try {
                return this.monacoEditorManager.currentEditor.getValue();
            } catch (error) {
                logError('获取编辑器内容失败:', error);
                return null;
            }
        }
        return null;
    }



    loadFileContentToEditor(fileName, tab) {
        logInfo('加载文件内容到编辑器:', fileName);

        if (tab.isLoading) {
            logInfo('文件正在加载中，跳过重复调用:', fileName);
            return;
        }

        if (this.monacoEditorManager && this.monacoEditorManager.currentEditor) {
            const editor = this.monacoEditorManager.currentEditor;
            if (editor.updateFileName) {
                editor.updateFileName(fileName, tab.modified || false);
            }
        }

        if (tab.filePath && window.electronIPC) {
            logInfo('从文件系统重新读取文件:', tab.filePath);
            tab.isLoading = true; // 设置加载标志
            window.electronIPC.send('read-file-content', tab.filePath);

            const handleFileRead = (event, filePath, content, error) => {
                if (filePath === tab.filePath) {
                    tab.isLoading = false; // 清除加载标志
                    if (error) {
                        logError('读取文件失败:', error);
                        alert('无法读取文件: ' + error);
                        if (tab.content !== undefined) {
                            this.setEditorContent(tab.content);
                        }
                    } else {
                        logInfo('文件内容读取成功，直接设置到当前编辑器');
                        this.setEditorContent(content, true); // 标记为已保存
                        tab.content = content;
                        tab.modified = false; // 从文件系统加载的内容标记为未修改

                        if (this.monacoEditorManager && this.monacoEditorManager.currentEditor) {
                            const editor = this.monacoEditorManager.currentEditor;
                            if (editor.updateFileName) {
                                editor.updateFileName(fileName, false);
                            }
                        }
                    }
                    window.electronIPC.ipcRenderer.removeListener('file-content-read', handleFileRead);
                }
            };

            window.electronIPC.on('file-content-read', handleFileRead);
        } else {
            const content = tab.content || this.getDefaultContentForFile(fileName);
            this.setEditorContent(content, !tab.modified); // 根据修改状态决定是否标记为已保存
            logInfo('使用缓存或默认内容');
        }
    }

    setEditorContent(content, markAsSaved = false) {
        if (this.monacoEditorManager && this.monacoEditorManager.currentEditor) {
            this.monacoEditorManager.currentEditor.setValue(content, markAsSaved);
            logInfo('编辑器内容已更新，保存状态:', markAsSaved);
        } else {
            logWarn('编辑器管理器或当前编辑器不可用');
        }
    }

    getDefaultContentForFile(fileName) {
        const ext = fileName.split('.').pop().toLowerCase();

        if (ext === 'cpp' || ext === 'cc' || ext === 'cxx') {
            return '';
        } else if (ext === 'c') {
            return '';
        } else if (ext === 'h' || ext === 'hpp') {
            const guard = fileName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase() + '_';
            return `#ifndef ${guard}
#define ${guard}


#endif // ${guard}`;
        }

        return '// 新文件\n';
    }

    closeTab(fileName, options = {}) {
        logInfo('关闭标签页:', fileName);
        const explicitKey = options.uniqueKeyOverride;
        let tabData = null;
        if (explicitKey && this.tabs.has(explicitKey)) {
            tabData = this.tabs.get(explicitKey);
        }
        if (!tabData) {
            tabData = this.getTabByFileName(fileName);
        }
        if (!tabData) {
            logError('标签页不存在:', fileName);
            return;
        }

        Promise.resolve(this.unregisterFileWatchForTab(tabData)).catch((error) => {
            try { logWarn('TabManager: 移除文件监听失败:', error); } catch (_) { }
        });

        const groupId = tabData.groupId;
        const uniqueKey = explicitKey
            || tabData.uniqueKey
            || this.findUniqueKeyByFileName(fileName)
            || null;
        let fallbackKey = null;
        let relatedGroup = null;
        let shouldTriggerFallback = false;
        if (groupId && uniqueKey) {
            relatedGroup = this.groups.get(groupId) || null;
            fallbackKey = this.getFallbackTabKeyWithinGroup(groupId, uniqueKey);
            if (relatedGroup && relatedGroup.activeTabKey === uniqueKey) {
                relatedGroup.activeTabKey = null;
                shouldTriggerFallback = true;
            } else if (tabData.element?.classList.contains('active')) {
                shouldTriggerFallback = true;
            }
        }

        if (!options.skipAutoSave && tabData.viewType !== 'pdf') {
            try {
                const isActive = this.activeTab === fileName;
                const editorMgr = this.monacoEditorManager || window.monacoEditorManager || window.editorManager;
                const currentEd = editorMgr?.currentEditor;
                const path = tabData.filePath || (uniqueKey && uniqueKey.includes('/') ? uniqueKey : null);
                if (path && editorMgr && currentEd && isActive) {
                    const content = currentEd.getValue?.();
                    if (typeof content === 'string' && window.electronAPI?.saveFile) {
                        window.electronAPI.saveFile(path, content)
                            .then(() => {
                                if (this.markTabAsSavedByUniqueKey) {
                                    this.markTabAsSavedByUniqueKey(path.replace(/\\/g, '/'));
                                } else if (fileName) {
                                    this.markTabAsSaved(fileName);
                                }
                            })
                            .catch(e => logWarn('关闭前自动保存失败:', e));
                    }
                }
            } catch (e) { logWarn('关闭前自动保存异常:', e); }
        }

        let tabId = tabData.tabId;
        if (!tabId && uniqueKey) {
            try {
                if (this.monacoEditorManager && this.monacoEditorManager.generateTabId) {
                    const fname = tabData.fileName || fileName || uniqueKey.split('/').pop();
                    tabId = this.monacoEditorManager.generateTabId(fname, uniqueKey);
                } else {
                    tabId = uniqueKey.replace(/[\\/:]/g, '_');
                }
            } catch (_) {
                tabId = uniqueKey.replace(/[\\/:]/g, '_');
            }
        }

        if (tabData.viewType === 'pdf') {
            if (tabData.viewerContainer && tabData.viewerContainer.parentNode) {
                tabData.viewerContainer.parentNode.removeChild(tabData.viewerContainer);
            }
            tabData.viewerContainer = null;
        } else if (tabId && window.monacoEditorManager) {
            window.monacoEditorManager.cleanupEditor(tabId);
        }

        if (tabData.isTempFile && tabData.filePath && window.electronAPI?.deleteTempFile) {
            window.electronAPI.deleteTempFile(tabData.filePath).catch((err) => logWarn('删除临时文件失败:', err));
        }

        if (tabData.element && tabData.element.parentNode) {
            tabData.element.parentNode.removeChild(tabData.element);
        }

        if (groupId && uniqueKey) {
            relatedGroup?.tabs?.delete(uniqueKey);
            this.syncGroupTabs(groupId);
            this.ensureGroupHasActiveTab(groupId, {
                preferredUniqueKey: fallbackKey,
                triggerEditor: shouldTriggerFallback
            });
            this.handleGroupBecameEmpty(groupId);
        }

        if (uniqueKey) {
            this.tabs.delete(uniqueKey);
        }

        if (this.activeTab === fileName) {
            this.activeTab = null;

            const remainingTabs = Array.from(this.tabs.keys());
            if (remainingTabs.length > 0) {
                const nextUniqueKey = remainingTabs[0];
                const firstTabData = this.tabs.get(nextUniqueKey);
                if (firstTabData) {
                    this.activateTabByUniqueKey(nextUniqueKey).catch(logError);
                }
            } else {
                this.showEmptyState();
            }
        }

        this.refreshTabLabels();
    }

    closeActiveTab() {
        if (this.activeTab) {
            this.closeTab(this.activeTab);
        }
    }

    createNewTab() {
        this.createNewCppFile();
    }

    generateNewFileName() {
        let counter = 1;
        let fileName = `untitled-${counter}.cpp`;

        while (this.tabs.has(fileName)) {
            counter++;
            fileName = `untitled-${counter}.cpp`;
        }

        return fileName;
    }

    isPdfFile(fileName = '') {
        if (!fileName || typeof fileName !== 'string') {
            return false;
        }
        const parts = fileName.split('.');
        if (parts.length < 2) {
            return false;
        }
        return parts.pop().toLowerCase() === 'pdf';
    }

    isLikelyFileObject(candidate) {
        if (!candidate || typeof candidate !== 'object') {
            return false;
        }

        if (typeof File !== 'undefined' && candidate instanceof File) {
            return true;
        }

        const hasArrayBuffer = typeof candidate.arrayBuffer === 'function';
        const hasText = typeof candidate.text === 'function';
        const hasStream = typeof candidate.stream === 'function';
        const hasName = typeof candidate.name === 'string';
        const hasSize = typeof candidate.size === 'number';
        const hasPath = typeof candidate.path === 'string';
        const hasType = typeof candidate.type === 'string';

        if (hasName && (hasArrayBuffer || hasText || hasStream)) {
            return true;
        }

        if (hasName && hasSize && hasType) {
            return true;
        }

        if (hasPath && hasName) {
            return true;
        }

        return false;
    }

    base64ToUint8Array(base64) {
        if (!base64 || typeof base64 !== 'string') {
            return null;
        }
        try {
            const binaryString = atob(base64);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i += 1) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        } catch (error) {
            logWarn('解析 Base64 数据失败', error);
            return null;
        }
    }

    isWindowsPlatform() {
        if (this._isWindowsPlatform !== undefined) {
            return this._isWindowsPlatform;
        }
        try {
            const platform = (window.process?.platform || navigator?.platform || '').toLowerCase();
            this._isWindowsPlatform = platform.includes('win');
        } catch (_) {
            this._isWindowsPlatform = false;
        }
        return this._isWindowsPlatform;
    }

    getWorkspaceRootPath() {
        try {
            return window.sidebarManager?.panels?.files?.workspacePath || '';
        } catch (_) {
            return '';
        }
    }

    normalizePathSlashes(pathCandidate) {
        if (!pathCandidate || typeof pathCandidate !== 'string') {
            return '';
        }
        return pathCandidate.replace(/\\/g, '/');
    }

    isPathInsideWorkspace(filePath, workspacePath) {
        if (!filePath || !workspacePath) {
            return false;
        }
        const normalizedFile = this.normalizePathSlashes(filePath);
        let normalizedWorkspace = this.normalizePathSlashes(workspacePath);
        normalizedWorkspace = normalizedWorkspace.replace(/\/+$/g, '');
        if (!normalizedWorkspace) {
            return false;
        }
        if (this.isWindowsPlatform()) {
            const fileLower = normalizedFile.toLowerCase();
            const workspaceLower = normalizedWorkspace.toLowerCase();
            return fileLower === workspaceLower || fileLower.startsWith(`${workspaceLower}/`);
        }
        return normalizedFile === normalizedWorkspace || normalizedFile.startsWith(`${normalizedWorkspace}/`);
    }

    computeDisplayDirectory(filePath, workspacePath) {
        try {
            const normalizedFile = this.normalizePathSlashes(filePath);
            const workspaceNormalized = workspacePath ? this.normalizePathSlashes(workspacePath).replace(/\/+$/g, '') : '';
            const lastSlashIndex = normalizedFile.lastIndexOf('/');
            const directoryPart = lastSlashIndex >= 0 ? normalizedFile.slice(0, lastSlashIndex) : '';

            if (!directoryPart) {
                return '';
            }

            if (workspaceNormalized && this.isPathInsideWorkspace(normalizedFile, workspaceNormalized)) {
                let relative = normalizedFile.slice(workspaceNormalized.length);
                if (relative.startsWith('/')) {
                    relative = relative.slice(1);
                }
                const relativeDirEnd = relative.lastIndexOf('/');
                let relativeDir = relativeDirEnd >= 0 ? relative.slice(0, relativeDirEnd) : '';
                if (!relativeDir) {
                    const workspaceName = workspaceNormalized.split('/').pop();
                    return workspaceName || '.';
                }
                return relativeDir;
            }

            return directoryPart;
        } catch (err) {
            logWarn('计算标签路径失败:', err);
            return '';
        }
    }

    refreshTabLabels() {
        try {
            if (!this.tabs || this.tabs.size === 0) {
                return;
            }

            const workspacePath = this.getWorkspaceRootPath();
            const normalizedWorkspace = workspacePath ? this.normalizePathSlashes(workspacePath).replace(/\/+$/g, '') : '';
            const groupedByName = new Map();

            for (const [, tabData] of this.tabs.entries()) {
                if (!tabData || !tabData.element) {
                    continue;
                }
                const baseName = tabData.fileName || 'untitled';
                if (!groupedByName.has(baseName)) {
                    groupedByName.set(baseName, []);
                }
                groupedByName.get(baseName).push(tabData);
            }

            for (const tabsWithSameName of groupedByName.values()) {
                const hasDuplicates = tabsWithSameName.length > 1;
                tabsWithSameName.forEach((tabData) => {
                    const labelElement = tabData.element?.querySelector?.('.tab-label');
                    if (!labelElement) {
                        return;
                    }

                    const filePath = tabData.filePath || (tabData.uniqueKey && tabData.uniqueKey.includes('/') ? tabData.uniqueKey : null);
                    const normalizedFile = filePath ? this.normalizePathSlashes(filePath) : '';
                    const outsideWorkspace = normalizedFile && (!normalizedWorkspace || !this.isPathInsideWorkspace(normalizedFile, normalizedWorkspace));
                    const shouldAppendPath = normalizedFile && (hasDuplicates || outsideWorkspace);

                    let baseLabel = tabData.fileName || 'untitled';
                    if (shouldAppendPath) {
                        const dirText = this.computeDisplayDirectory(normalizedFile, normalizedWorkspace);
                        if (dirText) {
                            baseLabel = `${tabData.fileName} — ${dirText}`;
                        }
                    }

                    const prefixes = [];
                    if (tabData.modified) {
                        prefixes.push('●');
                    }
                    if (tabData.externalModified) {
                        prefixes.push(tabData.externalChangeType === 'deleted' ? '⚠' : '⟳');
                    }
                    labelElement.textContent = prefixes.length ? `${prefixes.join(' ')} ${baseLabel}` : baseLabel;
                });
            }
        } catch (err) {
            logWarn('刷新标签标题失败:', err);
        }
    }

    normalizeDroppedPath(candidate) {
        if (!candidate) {
            return '';
        }
        let normalized = typeof candidate === 'string' ? candidate : String(candidate);
        normalized = normalized.trim();
        if (!normalized) {
            return '';
        }

        if ((normalized.startsWith('"') && normalized.endsWith('"')) || (normalized.startsWith('\'') && normalized.endsWith('\''))) {
            normalized = normalized.slice(1, -1);
        }

        if (/^file:\/\//i.test(normalized)) {
            try {
                const fileUrl = new URL(normalized);
                if (fileUrl.protocol.toLowerCase() === 'file:') {
                    const isWindows = this.isWindowsPlatform();
                    const host = fileUrl.hostname || '';
                    let pathname = decodeURIComponent(fileUrl.pathname || '');
                    if (host) {
                        if (isWindows) {
                            pathname = `\\\\${host}${pathname.replace(/\//g, '\\')}`;
                        } else {
                            pathname = `//${host}${pathname}`;
                        }
                    } else if (isWindows && pathname.startsWith('/')) {
                        pathname = pathname.slice(1);
                    }
                    normalized = pathname || '';
                }
            } catch (error) {
                logWarn('解析 file:// 路径失败，使用原值', error);
            }
        }

        normalized = normalized.replace(/\u0000/g, '');
        return normalized;
    }

    buildFileObjectFromDescriptor(descriptor, fallbackName = 'untitled') {
        if (!descriptor || typeof descriptor.base64 !== 'string' || !descriptor.base64.trim()) {
            return null;
        }
        const bytes = this.base64ToUint8Array(descriptor.base64.trim());
        if (!bytes) {
            return null;
        }
        const fileName = fallbackName || descriptor.name || 'untitled';
        const fileType = typeof descriptor.type === 'string' && descriptor.type
            ? descriptor.type
            : 'application/pdf';
        const lastModified = typeof descriptor.lastModified === 'number' && Number.isFinite(descriptor.lastModified)
            ? descriptor.lastModified
            : Date.now();
        try {
            if (typeof File === 'function') {
                return new File([bytes], fileName, { type: fileType, lastModified });
            }
        } catch (error) {
            logWarn('使用 File 构建文件对象失败，尝试退回 Blob', error);
        }
        try {
            const blob = new Blob([bytes], { type: fileType });
            return Object.assign(blob, {
                name: fileName,
                lastModified,
                size: bytes.length
            });
        } catch (error) {
            logWarn('构建 Blob 文件对象失败', error);
            return null;
        }
    }

    buildFileUrl(filePath) {
        if (!filePath || typeof filePath !== 'string') {
            return '';
        }
        let normalized = filePath.replace(/\\/g, '/');
        if (!normalized.startsWith('/')) {
            normalized = `/${normalized}`;
        }
        const url = `file://${normalized}`;
        try {
            return encodeURI(url);
        } catch (err) {
            logWarn('构建文件URL失败，使用未编码路径:', err);
            return url;
        }
    }

    generatePdfTabId(uniqueKey) {
        try {
            if (!uniqueKey) {
                return `pdf-${Date.now().toString(36)}`;
            }
            const normalized = uniqueKey.replace(/\\/g, '/');
            let hash = 0;
            for (let i = 0; i < normalized.length; i += 1) {
                hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
                hash |= 0;
            }
            return `pdf-${Math.abs(hash).toString(36)}`;
        } catch (err) {
            logWarn('生成PDF标签ID失败，使用时间戳兜底:', err);
            return `pdf-${Date.now().toString(36)}`;
        }
    }

    createPdfViewerContainer({ groupId, tabId, filePath, fileName, inline = false }) {
        const group = this.groups.get(groupId);
        const editorArea = group?.editorArea;
        if (!editorArea) {
            logError('创建PDF查看器失败：未找到目标编辑区域', groupId);
            return null;
        }

        const container = document.createElement('div');
        container.className = 'pdf-viewer-container';
        container.dataset.tabId = tabId;
        container.dataset.groupId = groupId;
        container.dataset.filePath = filePath || '';
        container.style.display = 'none';
        if (!container.style.position) {
            container.style.position = 'relative';
        }

        const loader = document.createElement('div');
        loader.className = 'pdf-viewer-loading';
        loader.innerHTML = '<div class="spinner"></div><div>PDF 加载中…</div>';

        const iframe = document.createElement('iframe');
        iframe.className = 'pdf-viewer-frame';
        iframe.dataset.tabId = tabId;
        iframe.setAttribute('loading', 'lazy');
        iframe.setAttribute('sandbox', 'allow-same-origin allow-scripts allow-popups allow-downloads');
        iframe.title = fileName ? `${fileName} (PDF 查看器)` : 'PDF 查看器';

        const viewerSrc = this.buildPdfViewerSrc({ filePath, tabId, inline });
        if (viewerSrc) {
            iframe.src = viewerSrc;
        } else {
            loader.innerHTML = '<div class="spinner"></div><div>无法定位 PDF 文件</div>';
        }

        iframe.addEventListener('load', () => {
            loader.style.display = 'none';
            this.handlePdfViewerLoaded(tabId);
        });

        container.appendChild(loader);
        container.appendChild(iframe);
        this.attachPdfDropHandlers(container, groupId);
        editorArea.appendChild(container);
        return container;
    }

    buildPdfViewerSrc({ filePath, tabId, zoom, inline = false } = {}) {
        if (!filePath && !inline) {
            return '';
        }
        try {
            const baseUrl = window.location?.href || document.baseURI;
            const viewerUrl = new URL('./pdf-viewer.html', baseUrl);
            if (inline) {
                viewerUrl.searchParams.set('file', 'inline');
            } else {
                const fileUrl = this.buildFileUrl(filePath);
                viewerUrl.searchParams.set('file', fileUrl);
            }
            if (tabId) {
                viewerUrl.searchParams.set('tabId', tabId);
            }
            viewerUrl.searchParams.set('zoom', zoom || 'page-width');
            viewerUrl.searchParams.set('disableFullscreen', 'true');
            const theme = this.getCurrentTheme();
            if (theme) {
                viewerUrl.searchParams.set('theme', theme);
            }
            return viewerUrl.href;
        } catch (err) {
            logWarn('构建 PDF 查看地址失败:', err);
            return '';
        }
    }

    attachPdfDropHandlers(viewerContainer, groupId) {
        if (!viewerContainer || viewerContainer._pdfDnDBound) {
            return;
        }

        if (!viewerContainer.style.position || viewerContainer.style.position === 'static') {
            viewerContainer.style.position = 'relative';
        }

        let overlay = viewerContainer.querySelector('.pdf-drop-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'pdf-drop-overlay';
            const message = document.createElement('div');
            message.className = 'pdf-drop-message';
            message.textContent = '拖拽文件到此处打开';
            overlay.appendChild(message);
            viewerContainer.appendChild(overlay);
        }

        let hoverCounter = 0;

        const isTabDrag = (event) => {
            try {
                const types = Array.isArray(event?.dataTransfer?.types)
                    ? event.dataTransfer.types
                    : Array.from(event?.dataTransfer?.types || []);
                return types.includes('application/oicpp-tab');
            } catch (_) {
                return false;
            }
        };

        const showOverlay = (event) => {
            if (isTabDrag(event)) {
                return;
            }
            hoverCounter += 1;
            if (event?.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy';
            }
            overlay.classList.add('visible');
        };

        const hideOverlay = () => {
            hoverCounter = 0;
            overlay.classList.remove('visible');
        };

        const decrementHover = (event) => {
            if (event && event.relatedTarget && viewerContainer.contains(event.relatedTarget)) {
                return;
            }
            hoverCounter = Math.max(hoverCounter - 1, 0);
            if (hoverCounter === 0) {
                overlay.classList.remove('visible');
            }
        };

        viewerContainer.addEventListener('dragenter', (event) => {
            event.preventDefault();
            event.stopPropagation();
            showOverlay(event);
        });

        viewerContainer.addEventListener('dragover', (event) => {
            if (isTabDrag(event)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy';
            }
            overlay.classList.add('visible');
        });

        viewerContainer.addEventListener('dragleave', (event) => {
            event.stopPropagation();
            decrementHover(event);
        });

        viewerContainer.addEventListener('drop', async (event) => {
            if (isTabDrag(event)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            hideOverlay();
            try {
                await this.processExternalDrop(event.dataTransfer, groupId);
            } catch (error) {
                logWarn('PDF 容器 drop 处理失败:', error);
            }
        });

        overlay.addEventListener('dragover', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.dataTransfer) {
                event.dataTransfer.dropEffect = 'copy';
            }
        });

        overlay.addEventListener('dragleave', (event) => {
            event.stopPropagation();
            if (event.relatedTarget && overlay.contains(event.relatedTarget)) {
                return;
            }
            decrementHover(event);
        });

        overlay.addEventListener('drop', async (event) => {
            event.preventDefault();
            event.stopPropagation();
            hideOverlay();
            try {
                await this.processExternalDrop(event.dataTransfer, groupId);
            } catch (error) {
                logWarn('PDF 覆盖层 drop 处理失败:', error);
            }
        });

        const frame = viewerContainer.querySelector('.pdf-viewer-frame');
        if (frame) {
            frame.addEventListener('dragenter', (event) => {
                event.preventDefault();
                event.stopPropagation();
                showOverlay(event);
            });
            frame.addEventListener('dragover', (event) => {
                if (isTabDrag(event)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                if (event.dataTransfer) {
                    event.dataTransfer.dropEffect = 'copy';
                }
                overlay.classList.add('visible');
            });
            frame.addEventListener('dragleave', (event) => {
                event.stopPropagation();
                decrementHover(event);
            });
            frame.addEventListener('drop', async (event) => {
                if (isTabDrag(event)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                hideOverlay();
                try {
                    await this.processExternalDrop(event.dataTransfer, groupId);
                } catch (error) {
                    logWarn('PDF 框架 drop 处理失败:', error);
                }
            });
        }

        viewerContainer._pdfDnDBound = true;
    }

    getCurrentTheme() {
        try {
            const body = document.body;
            if (!body) {
                return null;
            }
            const dataTheme = body.getAttribute('data-theme') || body.dataset?.theme;
            if (dataTheme) {
                return dataTheme;
            }
            if (body.classList.contains('theme-light') || body.classList.contains('light-theme')) {
                return 'light';
            }
            if (body.classList.contains('theme-dark') || body.classList.contains('dark-theme')) {
                return 'dark';
            }
        } catch (err) {
            logWarn('检测主题失败:', err);
        }
        return null;
    }

    handlePdfViewerLoaded(tabId) {
        if (!tabId) {
            return;
        }
        let targetTab = null;
        for (const tabData of this.tabs.values()) {
            if (tabData.tabId === tabId) {
                targetTab = tabData;
                break;
            }
        }
        if (!targetTab || targetTab.viewType !== 'pdf') {
            return;
        }
        targetTab.pdfViewerReady = true;
        const frame = targetTab.viewerFrame || targetTab.viewerContainer?.querySelector('.pdf-viewer-frame');
        if (frame) {
            try {
                frame.focus();
                frame.contentWindow?.focus();
            } catch (err) {
                logWarn('激活 PDF 查看器焦点失败:', err);
            }
            targetTab.viewerFrame = frame;
        }
        if (this.activeTabKey === targetTab.uniqueKey) {
            this.focusPdfViewer(targetTab);
        }
    }

    focusPdfViewer(tabData) {
        if (!tabData || tabData.viewType !== 'pdf') {
            return;
        }
        const frame = tabData.viewerFrame || tabData.viewerContainer?.querySelector('.pdf-viewer-frame');
        if (frame) {
            try {
                frame.focus();
                frame.contentWindow?.focus();
            } catch (err) {
                logWarn('设置 PDF 查看器焦点失败:', err);
            }
            tabData.viewerFrame = frame;
        }
    }

    tryHandlePdfShortcut(action) {
        if (!action) {
            return false;
        }
        const activeKey = this.activeTabKey;
        if (!activeKey) {
            return false;
        }
        const tabData = this.tabs.get(activeKey);
        if (!tabData || tabData.viewType !== 'pdf') {
            return false;
        }
        const frame = tabData.viewerFrame || tabData.viewerContainer?.querySelector('.pdf-viewer-frame');
        if (!frame) {
            return false;
        }
        try {
            const viewerWindow = frame.contentWindow;
            if (!viewerWindow) {
                return false;
            }
            const app = viewerWindow.PDFViewerApplication;
            if (!app) {
                return false;
            }
            switch (action) {
                case 'zoom-in':
                    app.eventBus.dispatch('zoomIn', { source: 'oicpp-tabs' });
                    return true;
                case 'zoom-out':
                    app.eventBus.dispatch('zoomOut', { source: 'oicpp-tabs' });
                    return true;
                case 'zoom-reset':
                    app.eventBus.dispatch('zoomReset', { source: 'oicpp-tabs' });
                    return true;
                default:
                    return false;
            }
        } catch (err) {
            logWarn('转发 PDF 快捷键失败:', err);
            return false;
        }
    }

    async handlePdfViewerMessage(event) {
        if (!event || !event.data) {
            return;
        }
        const { source, tabId, type, detail } = event.data;
        if (source !== 'oicpp-pdf-viewer' || !tabId) {
            return;
        }
        let targetTab = null;
        for (const tabData of this.tabs.values()) {
            if (tabData.viewType === 'pdf' && tabData.tabId === tabId) {
                targetTab = tabData;
                break;
            }
        }
        if (!targetTab) {
            return;
        }
        try {
            switch (type) {
                case 'ready': {
                    targetTab.pdfViewerReady = true;
                    targetTab.pdfViewerError = null;
                    if (detail && typeof detail.scale === 'number' && Number.isFinite(detail.scale)) {
                        targetTab.pdfViewerScale = detail.scale;
                    }
                    const loader = targetTab.viewerContainer?.querySelector('.pdf-viewer-loading');
                    if (loader) {
                        loader.style.display = 'none';
                    }
                    const errorBox = targetTab.viewerContainer?.querySelector('.pdf-viewer-error');
                    if (errorBox) {
                        errorBox.style.display = 'none';
                        errorBox.innerHTML = '';
                    }
                    if (this.activeTabKey === targetTab.uniqueKey) {
                        this.focusPdfViewer(targetTab);
                    }
                    break;
                }
                case 'zoom-changed': {
                    if (detail && typeof detail.scale === 'number' && Number.isFinite(detail.scale)) {
                        targetTab.pdfViewerScale = detail.scale;
                    }
                    break;
                }
                case 'error': {
                    const message = detail?.message || '未知错误';
                    targetTab.pdfViewerError = message;
                    const loader = targetTab.viewerContainer?.querySelector('.pdf-viewer-loading');
                    if (loader) {
                        loader.style.display = 'none';
                    }
                    const existingError = targetTab.viewerContainer?.querySelector('.pdf-viewer-error');
                    if (existingError && existingError.parentNode) {
                        existingError.parentNode.removeChild(existingError);
                    }
                    logError('PDF 查看器错误:', message);
                    break;
                }
                case 'external-drop': {
                    const files = Array.isArray(detail?.files) ? detail.files : [];
                    if (files.length > 0) {
                        const groupId = targetTab.groupId || this.activeGroupId || 'group-1';
                        const entries = files.map((descriptor) => {
                            if (!descriptor) {
                                return null;
                            }
                            const fileName = descriptor.name
                                || (typeof descriptor.path === 'string' && descriptor.path.split(/[\\\/]/).pop())
                                || 'untitled';
                            const candidate = descriptor.file ?? descriptor.fileObject ?? descriptor;
                            let fileObject = this.isLikelyFileObject(candidate) ? candidate : null;
                            if (!fileObject) {
                                fileObject = this.buildFileObjectFromDescriptor(descriptor, fileName);
                            }
                            const derivedPath = typeof descriptor.path === 'string'
                                ? descriptor.path
                                : (fileObject && typeof fileObject.path === 'string' ? fileObject.path : null);
                            const base64 = typeof descriptor.base64 === 'string' && descriptor.base64.trim()
                                ? descriptor.base64.trim()
                                : null;
                            const finalName = fileName || fileObject?.name || (derivedPath && derivedPath.split(/[\\\/]/).pop()) || 'untitled';
                            return {
                                fileName: finalName,
                                filePath: derivedPath,
                                fileObject,
                                base64
                            };
                        }).filter(Boolean);
                        if (entries.length > 0) {
                            await this.openDropEntries(entries, groupId);
                        }
                    }
                    break;
                }
                case 'request-file': {
                    this.respondToPdfFileRequest(targetTab, detail, tabId).catch(logError);
                    break;
                }
                default:
                    break;
            }
        } catch (err) {
            logWarn('处理 PDF 查看器消息失败', err);
        }
    }

    async respondToPdfFileRequest(tabData, detail, tabId) {
        if (!tabData || !tabData.viewerContainer) {
            return;
        }
        const requestId = detail?.requestId;
        if (!requestId) {
            return;
        }

        const frame = tabData.viewerFrame || tabData.viewerContainer.querySelector('.pdf-viewer-frame');
        const targetWindow = frame?.contentWindow;
        if (!targetWindow) {
            return;
        }

        const postResponse = (payload) => {
            try {
                targetWindow.postMessage({
                    source: 'oicpp-tabs',
                    tabId,
                    type: 'file-data',
                    requestId,
                    ...payload
                }, '*');
            } catch (error) {
                logWarn('向 PDF 查看器发送文件响应失败:', error);
            }
        };

        const filePath = tabData.filePath || detail?.filePath;
        if (!filePath) {
            if (tabData.pdfBase64) {
                postResponse({ base64: tabData.pdfBase64, filePath: null });
            } else {
                postResponse({ error: '无法确定 PDF 文件路径' });
            }
            return;
        }

        if (!window.electronAPI?.readFileBuffer) {
            postResponse({ error: '当前环境不支持读取二进制文件' });
            return;
        }

        try {
            const base64 = await window.electronAPI.readFileBuffer(filePath);
            if (!base64) {
                postResponse({ error: '读取 PDF 文件失败：无数据' });
                return;
            }
            postResponse({ base64, filePath });
        } catch (error) {
            logError('读取 PDF 文件失败:', error);
            postResponse({ error: error?.message || String(error) });
        }
    }

    hideGroupViewContainers(groupId) {
        const group = this.groups.get(groupId);
        const editorArea = group?.editorArea;
        if (!editorArea) {
            return;
        }
        const panes = editorArea.querySelectorAll('.monaco-editor-container, .pdf-viewer-container');
        panes.forEach((pane) => {
            pane.style.display = 'none';
            if (pane.classList.contains('pdf-viewer-container')) {
                pane.classList.remove('active');
            }
        });
    }

    async openPdfTab({ fileName, filePath, uniqueKey, targetGroupId, targetGroup, isTempFile = false, pdfBase64 = null }) {
        if (!filePath && !pdfBase64) {
            logError('打开PDF失败：缺少文件路径或数据');
            this._openingKeys.delete(uniqueKey);
            return;
        }

        const tabId = this.generatePdfTabId(uniqueKey);
        const tabElement = this.createTabElement(fileName, tabId);
        tabElement.dataset.groupId = targetGroupId;
        tabElement.dataset.viewType = 'pdf';
        tabElement.classList.add('tab-type-pdf');
        this.addTabDragListeners(tabElement);

        const viewerContainer = this.createPdfViewerContainer({
            groupId: targetGroupId,
            tabId,
            filePath,
            fileName,
            inline: !!pdfBase64
        });
        if (!viewerContainer) {
            logError('创建 PDF 查看器容器失败');
            this._openingKeys.delete(uniqueKey);
            return;
        }

        const viewerFrame = viewerContainer.querySelector('.pdf-viewer-frame') || null;

        const tabData = {
            element: tabElement,
            fileName,
            modified: false,
            content: null,
            active: true,
            filePath,
            tabId,
            uniqueKey,
            groupId: targetGroupId,
            viewType: 'pdf',
            viewerContainer,
            viewerFrame,
            pdfViewerReady: false,
            pdfViewerScale: null,
            pdfViewerError: null,
            isTempFile,
            pdfBase64: pdfBase64 || null
        };
        this.tabs.set(uniqueKey, tabData);

        if (targetGroup) {
            targetGroup.tabs.set(uniqueKey, tabData);
            if (targetGroup.tabBar) {
                this.bindTabBarEvents(targetGroup.tabBar);
                targetGroup.tabBar.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
                targetGroup.tabBar.appendChild(tabElement);
            }
            targetGroup.activeTabKey = uniqueKey;
        }

        this.activeTab = fileName;
        this.activeTabKey = uniqueKey;
        this.activeGroupId = targetGroupId;
        tabElement.classList.add('active');

        this.setTabElementUniqueKey(tabElement, uniqueKey);

        this.syncGroupTabs(targetGroupId);

        await this.activateTabByUniqueKey(uniqueKey);
    }

    async openFile(fileName, content, isNew = false, options = {}) {
        const { filePath = null, groupId = null, viewType = 'editor', pdfBase64 = null } = options;
        const uniqueKey = filePath || fileName;

        if (this._openingKeys.has(uniqueKey)) {
            logInfo('文件���在打开中，跳过重复调用:', uniqueKey);
            return;
        }
        this._openingKeys.add(uniqueKey);

        try {
            let targetGroup = this.groups.get(groupId || this.activeGroupId);
            if (!targetGroup) {
                targetGroup = this.createGroup();
                this.activeGroupId = targetGroup.id;
            }

            let tabData = this.tabs.get(uniqueKey);
            if (tabData) {
                logInfo('标签页已存在，激活它:', uniqueKey);
                await this.activateTabByUniqueKey(uniqueKey);
                return;
            }

            const tabElement = document.createElement('div');
            tabElement.className = 'tab';
            tabElement.dataset.file = fileName;
            tabElement.dataset.uniqueKey = uniqueKey;
            tabElement.dataset.groupId = targetGroup.id;
            if (filePath) {
                tabElement.dataset.filePath = filePath;
            }
            if (viewType) {
                tabElement.dataset.viewType = viewType;
            }

            const tabLabel = document.createElement('span');
            tabLabel.className = 'tab-label';
            tabLabel.textContent = fileName;

            const closeBtn = document.createElement('button');
            closeBtn.className = 'tab-close';
            closeBtn.innerHTML = '&times;';

            tabElement.appendChild(tabLabel);
            tabElement.appendChild(closeBtn);

            targetGroup.tabBar.appendChild(tabElement);

            tabData = {
                element: tabElement,
                fileName,
                modified: isNew,
                content,
                active: false,
                filePath,
                tabId: null,
                uniqueKey,
                groupId: targetGroup.id,
                viewType,
                pdfBase64,
                viewerContainer: null,
                viewerFrame: null,
                externalModified: false,
                externalChangeType: null,
                externalPromptDismissed: false,
                externalPromptInProgress: false,
                pendingExternalPrompt: false,
                externalChangeTimestamp: null,
                isLoading: false
            };

            this.tabs.set(uniqueKey, tabData);
            targetGroup.tabs.set(uniqueKey, tabData);
            targetGroup.tabOrder.push(uniqueKey);
            this.updateGlobalTabOrder();

            this.attachTabEventHandlers(tabElement);
            this.addTabDragListeners(tabElement);

            if (filePath && viewType !== 'pdf' && viewType !== 'markdown') {
                await this.registerFileWatchForTab(tabData);
            }

            await this.activateTabByUniqueKey(uniqueKey);

            if (this.welcomeContainer) {
                this.welcomeContainer.style.display = 'none';
            }
            if (this.editorGroupsElement) {
                this.editorGroupsElement.style.display = 'flex';
            }

            if (isNew && viewType === 'editor' && this.monacoEditorManager && tabData.tabId) {
                this.monacoEditorManager.currentEditor.setValue(content || '');
                this.monacoEditorManager.currentEditor.focus();
            }

            this.refreshGroupResizers();
        } catch (error) {
            logError('打开文件失败:', error);
            throw error;
        } finally {
            this._openingKeys.delete(uniqueKey);
        }
    }

    syncTabDOMWithMap(fileName, filePath) {
        logInfo(`同步标签页DOM: ${fileName}`);

        const allTabs = document.querySelectorAll('.tab');
        for (const tabEl of allTabs) {
            const tabLabel = tabEl.querySelector('.tab-label');
            const datasetFileName = typeof tabEl.dataset?.file === 'string' ? tabEl.dataset.file : '';
            const labelText = tabLabel?.textContent || '';
            const strippedLabel = labelText.replace(/^●\s*/, '').split(' — ')[0].trim();
            const candidateName = datasetFileName || strippedLabel;

            if (candidateName === fileName) {
                if (!tabEl.dataset.tabId && this.monacoEditorManager && this.monacoEditorManager.generateTabId) {
                    const tabId = this.monacoEditorManager.generateTabId(fileName, filePath);
                    tabEl.dataset.tabId = tabId;
                    logInfo(`为标签页 ${fileName} 设置 tabId: ${tabId}`);
                }
                break;
            }
        }
    }

    createTabElement(fileName, tabId) {
        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.dataset.file = fileName;
        tab.dataset.tabId = tabId;
        tab.draggable = true;  // 启用拖拽

        const label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = fileName;

        const closeBtn = document.createElement('span');
        closeBtn.className = 'tab-close';
        closeBtn.textContent = '×';

        tab.appendChild(label);
        tab.appendChild(closeBtn);

        tab.addEventListener('click', (e) => {
            if (!e.target.classList.contains('tab-close')) {
                const uniqueKey = tab.dataset.uniqueKey;
                logInfo('标签页点击:', fileName, 'DOM uniqueKey:', uniqueKey);
                if (uniqueKey && this.tabs.has(uniqueKey)) {
                    this.activateTabByUniqueKey(uniqueKey).catch(logError);
                } else {
                    this.activateTab(fileName).catch(logError);
                }
            }
        });

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const uniqueKey = tab.dataset.uniqueKey;
            logInfo('关闭标签页:', fileName, 'DOM uniqueKey:', uniqueKey);
            if (uniqueKey && this.tabs.has(uniqueKey)) {
                this.closeTabByUniqueKey(uniqueKey);
            } else {
                this.closeTab(fileName);
            }
        });

        tab.addEventListener('mouseup', (e) => {
            if (e.button === 1) {
                e.preventDefault();
                const uniqueKey = tab.dataset.uniqueKey;
                logInfo('中键关闭标签页:', fileName, 'DOM uniqueKey:', uniqueKey);
                if (uniqueKey && this.tabs.has(uniqueKey)) {
                    this.closeTabByUniqueKey(uniqueKey);
                } else {
                    this.closeTab(fileName);
                }
            }
        });


        return tab;
    }

    addTabDragListeners(tab) {
        if (!tab || tab._dragListenersBound) {
            return;
        }

        if (!tab.draggable) {
            tab.draggable = true;
        }

        const ensureTabBar = () => {
            const parent = tab.parentNode;
            if (parent) {
                this.bindTabBarEvents(parent);
            }
            return parent;
        };

        const tabBar = ensureTabBar();

        const forwardDragHover = (event) => {
            if (!event) {
                return;
            }
            const hostBar = ensureTabBar();
            if (!hostBar || !this.draggedTab) {
                return;
            }
            this.handleTabBarDragOver(event, hostBar);
            event.stopPropagation();
        };

        tab.addEventListener('dragstart', (e) => {
            this.draggedTab = tab;
            const uniqueKey = tab.dataset.uniqueKey;
            const groupId = tab.dataset.groupId || tab.parentElement?.dataset.groupId || tab.closest('.editor-group')?.dataset.groupId || this.activeGroupId;
            this.draggedTabInfo = { uniqueKey, groupId };
            this.dropHandled = false;
            this.lastTabDropInfo = null;

            tab.classList.add('dragging');
            tab.style.opacity = '0.5';
            this.tabDragInProgress = true;

            e.dataTransfer.effectAllowed = 'move';
            if (uniqueKey) {
                e.dataTransfer.setData('application/oicpp-tab', uniqueKey);
            }
            e.dataTransfer.setData('text/plain', uniqueKey || '');

            try {
                const rect = tab.getBoundingClientRect();
                const canvas = document.createElement('canvas');
                canvas.width = rect.width;
                canvas.height = rect.height;
                const ctx = canvas.getContext('2d');

                ctx.fillStyle = getComputedStyle(tab).backgroundColor || '#2d2d30';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                ctx.fillStyle = getComputedStyle(tab).color || '#cccccc';
                ctx.font = getComputedStyle(tab).font || '13px "Segoe UI", sans-serif';
                const label = tab.querySelector('.tab-label');
                if (label) {
                    ctx.fillText(label.textContent, 10, canvas.height / 2 + 5);
                }

                const dataUrl = canvas.toDataURL('image/png');
                if (dataUrl && dataUrl.startsWith('data:')) {
                    const img = new Image();
                    img.onload = () => {
                        e.dataTransfer.setDragImage(img, rect.width / 2, rect.height / 2);
                    };
                    img.src = dataUrl;
                } else {
                    throw new Error('Failed to generate drag image data URL');
                }
            } catch (err) {
                const dragImage = new Image();
                dragImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAUEBAAAACwAAAAAAQABAAACAkQBADs=';
                e.dataTransfer.setDragImage(dragImage, 0, 0);
            }

            if (this.canSplitGroup(groupId)) {
                this.showSplitOverlay(groupId);
            } else {
                this.hideSplitOverlay();
            }

        });

        tab.addEventListener('dragend', (e) => {
            const shouldFallback = !this.dropHandled && this.lastTabDropInfo && this.draggedTabInfo;
            if (shouldFallback) {
                const fallbackInfo = { ...this.lastTabDropInfo };
                const applied = this.applyTabDrop(fallbackInfo);
            }

            this.cleanupTabDrag(tab);
            this.dropHandled = false;
        });

        tab.addEventListener('dragenter', (event) => {
            event.preventDefault();
            forwardDragHover(event);
        });
        tab.addEventListener('dragover', (event) => {
            event.preventDefault();
            forwardDragHover(event);
        });
        tab.addEventListener('drop', (event) => {
            const hostBar = ensureTabBar();
            if (!hostBar) {
                return;
            }
            this.handleTabBarDrop(event, hostBar);
            event.stopPropagation();
        });

        tab._dragListenersBound = true;
    }

    getDragAfterElement(container, x) {
        const draggableElements = [...container.querySelectorAll('.tab:not(.dragging):not(.tab-placeholder)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = x - box.left - box.width / 2;

            if (offset < 0 && offset > (closest.offset || Number.NEGATIVE_INFINITY)) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, {}).element || null;
    }

    reorderTabs(draggedTab, targetTab) {
        const tabBar = draggedTab.parentNode;
        const draggedIndex = Array.from(tabBar.children).indexOf(draggedTab);
        const targetIndex = Array.from(tabBar.children).indexOf(targetTab);

        if (draggedIndex < targetIndex) {
            tabBar.insertBefore(draggedTab, targetTab.nextSibling);
        } else {
            tabBar.insertBefore(draggedTab, targetTab);
        }

        const groupId = tabBar?.dataset?.groupId || null;
        this.syncTabOrder(groupId);
    }

    syncTabOrder(groupId = null) {
        if (groupId) {
            this.syncGroupTabs(groupId);
        } else {
            this.groups.forEach((_, id) => this.syncGroupTabs(id));
        }
    }

    createEditorPane(fileName, content = '') {
        return null;
    }

    async switchToNextTab() {
        if (this.tabOrder.length <= 1) return;

        const currentIndex = this.tabOrder.indexOf(this.activeTab);
        const nextIndex = (currentIndex + 1) % this.tabOrder.length;
        const nextTab = this.tabOrder[nextIndex];

        await this.activateTab(nextTab);
    }

    async switchToPreviousTab() {
        if (this.tabOrder.length <= 1) return;

        const currentIndex = this.tabOrder.indexOf(this.activeTab);
        const prevIndex = (currentIndex - 1 + this.tabOrder.length) % this.tabOrder.length;
        const prevTab = this.tabOrder[prevIndex];

        await this.activateTab(prevTab);
    }

    markTabAsModified(fileName) {
        const tabData = this.getTabByFileName(fileName);
        if (tabData && !tabData.modified) {
            tabData.modified = true;
            this.refreshTabLabels();
        }
    }

    markTabAsModifiedByUniqueKey(uniqueKey) {
        const tabData = this.tabs.get(uniqueKey);
        if (tabData && !tabData.modified) {
            tabData.modified = true;
            this.refreshTabLabels();
        }
    }

    markTabAsSaved(fileName) {
        const tabData = this.getTabByFileName(fileName);
        if (tabData && tabData.modified) {
            tabData.modified = false;
            this.refreshTabLabels();
        }
    }

    markTabAsSavedByUniqueKey(uniqueKey) {
        const tabData = this.tabs.get(uniqueKey);
        if (tabData && tabData.modified) {
            tabData.modified = false;
            this.refreshTabLabels();
        }
    }

    getActiveTab() {
        return this.activeTab;
    }

    getTabCount() {
        return this.tabs.size;
    }

    getAllTabs() {
        return Array.from(this.tabs.keys());
    }

    getModifiedTabs() {
        return Array.from(this.tabs.values())
            .filter(tab => tab.modified)
            .map(tab => tab.fileName);
    }

    async autoSaveModifiedTabs() {
        if (!window.electronAPI || typeof window.electronAPI.saveFile !== 'function') {
            logWarn('[TabManager][自动保存] saveFile API 不可用，跳过自动保存');
            return 0;
        }

        if (!this.monacoEditorManager) {
            this.tryGetEditorManagerReference();
        }

        const editorManager = this.monacoEditorManager;
        const modifiedEntries = Array.from(this.tabs.entries()).filter(([, tabData]) => {
            return tabData && tabData.modified && tabData.viewType !== 'pdf';
        });

        if (modifiedEntries.length === 0) {
            return 0;
        }

        let savedCount = 0;

        for (const [uniqueKey, tabData] of modifiedEntries) {
            const filePath = tabData.filePath;
            if (!filePath || typeof filePath !== 'string') {
                continue;
            }

            const editor = editorManager?.editors?.get(tabData.tabId) ||
                (editorManager?.currentEditor && editorManager.currentEditor.filePath === filePath ? editorManager.currentEditor : null);

            const content = editor?.getValue ? editor.getValue() : null;
            if (typeof content !== 'string') {
                continue;
            }

            try {
                await window.electronAPI.saveFile(filePath, content);
                if (typeof this.markTabAsSavedByUniqueKey === 'function') {
                    this.markTabAsSavedByUniqueKey(uniqueKey);
                } else if (typeof this.markTabAsSaved === 'function') {
                    this.markTabAsSaved(tabData.fileName);
                }
                savedCount += 1;
            } catch (error) {
                logError('[TabManager][自动保存] 保存失败:', { filePath, error });
            }
        }

        return savedCount;
    }

    closeAllTabs() {
        const modifiedTabs = this.getModifiedTabs();
        if (modifiedTabs.length > 0) {
            const result = confirm(`有 ${modifiedTabs.length} 个文件未保存，确定要关闭所有标签页吗？`);
            if (!result) return;
        }

        const tabsToClose = [...this.tabs.keys()];
        tabsToClose.forEach(fileName => {
            this.closeTab(fileName);
        });
    }

    closeOtherTabs() {
        if (!this.activeTab) return;

        const currentTab = this.activeTab;
        const tabsToClose = [...this.tabs.keys()].filter(fileName => fileName !== currentTab);

        const modifiedTabs = tabsToClose.filter(fileName => this.tabs.get(fileName).modified);
        if (modifiedTabs.length > 0) {
            const result = confirm(`有 ${modifiedTabs.length} 个文件未保存，确定要关闭其他标签页吗？`);
            if (!result) return;
        }

        tabsToClose.forEach(fileName => {
            this.closeTab(fileName);
        });
    }

    showWelcomePage() {
        logInfo('显示欢迎页面');

        const welcomeContainer = document.getElementById('welcome-container');
        const editorArea = document.querySelector('.editor-area');

        if (!welcomeContainer) {
            logError('欢迎页面容器未找到');
            return;
        }

        if (editorArea) {
            editorArea.style.display = 'none';
        }
        welcomeContainer.style.display = 'block';

        if (window.sidebarManager) {
            try {
                if (typeof window.sidebarManager.hideForWelcome === 'function') {
                    window.sidebarManager.hideForWelcome();
                } else if (typeof window.sidebarManager.disableResize === 'function') {
                    window.sidebarManager.disableResize();
                }
            } catch (e) { logWarn('隐藏侧边栏(欢迎页)失败:', e); }
        }

        welcomeContainer.innerHTML = this.getWelcomePageContent();

        this.setupWelcomeEventListeners(welcomeContainer);

        const welcomeTab = {
            fileName: 'Welcome',
            content: this.getWelcomePageContent(),
            modified: false,
            isWelcome: true
        };

        this.tabs.set('Welcome', welcomeTab);
        this.activeTab = 'Welcome';
    }

    getWelcomePageContent() {
        return `
            <div class="welcome-page">
                <div class="welcome-header">
                    <div class="welcome-logo">OICPP IDE</div>
                    <div class="welcome-subtitle">为 OIer 优化的 C++ 编程环境</div>
                    <div class="welcome-version">版本 1.0.2</div>
                </div>
                
                <div class="welcome-content">
                    <div class="welcome-section">
                        <h3>开始</h3>
                        <div class="welcome-actions">
                            <a href="#" class="welcome-action" data-action="open-folder">
                                <span class="icon">📁</span>
                                <span>打开文件夹</span>
                                <span class="shortcut">Ctrl+K</span>
                            </a>
                        </div>
                    </div>
                    
                    <div class="welcome-section">
                        <h3>最近打开</h3>
                        <div class="welcome-recent" id="welcome-recent">
                            <!-- 最近文件列表将动态生成 -->
                        </div>
                    </div>
                </div>
                
                <div class="welcome-footer">
                    <p>OICPP IDE - 为竞赛编程而生</p>
                    <p><a href="#">使用文档</a> | <a href="#">快捷键</a> | <a href="#">关于</a></p>
                </div>
            </div>
        `;
    }

    showWelcomeContent() {
        const editorArea = document.querySelector('.editor-area');
        if (editorArea) {
            editorArea.style.display = 'none';
        }

        let welcomeContainer = document.getElementById('welcome-container');
        if (!welcomeContainer) {
            welcomeContainer = document.createElement('div');
            welcomeContainer.id = 'welcome-container';
            welcomeContainer.innerHTML = this.getWelcomePageContent();

            const editorTerminalContainer = document.querySelector('.editor-terminal-container');
            if (editorTerminalContainer) {
                editorTerminalContainer.appendChild(welcomeContainer);
            } else {
                logError('未找到编辑器容器');
                return;
            }

            this.setupWelcomeEventListeners(welcomeContainer);
        }

        if (window.sidebarManager) {
            try {
                if (typeof window.sidebarManager.hideForWelcome === 'function') {
                    window.sidebarManager.hideForWelcome();
                } else if (typeof window.sidebarManager.disableResize === 'function') {
                    window.sidebarManager.disableResize();
                }
            } catch (e) { logWarn('隐藏侧边栏(欢迎页)失败:', e); }
        }

        welcomeContainer.style.display = 'block';
    }

    setupWelcomeEventListeners(container) {
        const actions = container.querySelectorAll('.welcome-action');
        actions.forEach(action => {
            action.addEventListener('click', (e) => {
                e.preventDefault();
                const actionType = e.currentTarget.dataset.action;
                this.handleWelcomeAction(actionType);
            });
        });

        this.loadRecentFiles(container);
    }

    async loadRecentFiles(container) {
        try {
            const recentFiles = await window.electronAPI.getRecentFiles();
            const recentContainer = container.querySelector('#welcome-recent');

            if (!recentContainer) return;

            if (!recentFiles || recentFiles.length === 0) {
                recentContainer.innerHTML = `
                    <div class="welcome-recent-item">
                        <span class="icon">📄</span>
                        <span>暂无最近文件</span>
                    </div>
                `;
                return;
            }

            recentContainer.innerHTML = recentFiles.map(file => `
                <div class="welcome-recent-item" data-path="${file.path}">
                    <span class="icon">📁</span>
                    <div class="file-info">
                        <span class="file-name">${file.name}</span>
                        <span class="file-path">${file.path}</span>
                    </div>
                </div>
            `).join('');

            const recentItems = recentContainer.querySelectorAll('.welcome-recent-item[data-path]');
            recentItems.forEach(item => {
                item.addEventListener('click', async (e) => {
                    const filePath = e.currentTarget.dataset.path;
                    if (filePath) {
                        const success = await window.electronAPI.openRecentFile(filePath);
                        if (!success) {
                            alert('无法打开文件，文件可能已被删除或移动。');
                        }
                    }
                });
            });
        } catch (error) {
            logError('加载最近文件失败:', error);
        }
    }

    handleWelcomeAction(actionType) {
        logInfo('欢迎页面操作:', actionType);

        switch (actionType) {
            case 'new-file':
                this.createNewCppFile();
                break;
            case 'open-file':
                if (window.oicppApp && window.oicppApp.openFile) {
                    window.oicppApp.openFile();
                }
                break;
            case 'open-folder':
                if (window.oicppApp && window.oicppApp.openFolder) {
                    window.oicppApp.openFolder();
                }
                break;
            case 'open-template':
                logInfo('从模板创建功能待实现');
                break;
            default:
                logInfo('未知的欢迎页面操作:', actionType);
        }
    }

    closeWelcomePage() {
        logInfo('关闭欢迎页面');

        const welcomeContainer = document.getElementById('welcome-container');
        const editorArea = document.querySelector('.editor-area');

        if (welcomeContainer) {
            welcomeContainer.style.display = 'none';
        }

        if (editorArea) {
            editorArea.style.display = 'block';
        }

        if (window.sidebarManager) {
            try {
                if (typeof window.sidebarManager.showForEditor === 'function') {
                    window.sidebarManager.showForEditor();
                } else if (typeof window.sidebarManager.enableResize === 'function') {
                    window.sidebarManager.enableResize();
                }
            } catch (e) { logWarn('恢复侧边栏(退出欢迎页)失败:', e); }
        }

        this.tabs.delete('Welcome');
        this.activeTab = null;
    }



    getSelectedText() {
        const activeTab = this.getTabByFileName(this.activeTab);
        if (activeTab && this.monacoEditorManager) {
            return this.monacoEditorManager.getSelectedText(activeTab.fileName);
        }
        return '';
    }

    insertText(text) {
        const activeTab = this.getTabByFileName(this.activeTab);
        if (activeTab && this.monacoEditorManager) {
            this.monacoEditorManager.insertText(activeTab.fileName, text);
        }
    }

    getAllFileNames() {
        return Array.from(this.tabs.values()).map(tabData => tabData.fileName);
    }

    getUnsavedFiles() {
        const unsavedFiles = [];
        for (const [uniqueKey, tabData] of this.tabs.entries()) {
            if (tabData.modified) {
                unsavedFiles.push(tabData.fileName);
            }
        }
        return unsavedFiles;
    }

    saveFile(fileName) {
        const tab = this.getTabByFileName(fileName);
        if (tab) {
            tab.modified = false;
            this.refreshTabLabels();

            if (this.monacoEditorManager) {
                this.monacoEditorManager.saveFile(fileName);
            }
        }
    }

    async saveAllFiles() {
        const tasks = [];
        for (const [uniqueKey, tab] of this.tabs.entries()) {
            if (tab?.viewType && tab.viewType !== 'code') {
                continue;
            }
            try {
                const tabId = tab.tabId;
                const filePath = tab.filePath;
                if (!filePath || !tabId) continue;
                const editor = this.monacoEditorManager?.editors?.get?.(tabId);
                const content = editor?.getValue ? editor.getValue() : (this.monacoEditorManager?.currentEditor?.getValue?.() || tab.content || '');
                if (window.electronAPI?.saveFile && typeof window.electronAPI.saveFile === 'function') {
                    tasks.push(
                        window.electronAPI.saveFile(filePath, content).then(() => {
                            this.markTabAsSavedByUniqueKey(uniqueKey);
                        }).catch((e) => {
                            (window.logWarn || console.warn)('保存文件失败:', filePath, e);
                        })
                    );
                } else {
                    this.markTabAsSavedByUniqueKey(uniqueKey);
                }
            } catch (e) {
                (window.logWarn || console.warn)('保存标签失败:', tab?.fileName, e);
            }
        }
        try { await Promise.allSettled(tasks); } catch (_) { }
    }

    openFileDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.cpp,.h,.txt,.in,.out,.ans';
        input.style.display = 'none';

        document.body.appendChild(input);
        input.click();

        input.addEventListener('change', (e) => {
            const files = e.target.files;
            if (files.length > 0) {
                const file = files[0];
                const fileName = file.name;

                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    this.openFile(fileName, content);
                };
                reader.readAsText(file);
            }

            document.body.removeChild(input);
        });
    }

    openFolderDialog() {
        const input = document.createElement('input');
        input.type = 'file';
        input.webkitdirectory = true;
        input.style.display = 'none';

        document.body.appendChild(input);
        input.click();

        input.addEventListener('change', (e) => {
            const files = e.target.files;
            const fileNames = Array.from(files).map(file => file.webkitRelativePath.split('/').pop());

            fileNames.forEach(fileName => {
                const file = Array.from(files).find(f => f.webkitRelativePath.endsWith(fileName));
                const reader = new FileReader();
                reader.onload = (e) => {
                    const content = e.target.result;
                    this.openFile(fileName, content);
                };
                reader.readAsText(file);
            });

            document.body.removeChild(input);
        });
    }

    createFileFromTemplate(templateName) {
        let content = '';
        switch (templateName) {
            case 'cpp':
                content = `#include <iostream>
using namespace std;

int main() {
    cout << "Hello, World!" << endl;
    return 0;
}
`;
                break;
            case 'header':
                content = `#ifndef _TEMPLATE_H
#define _TEMPLATE_H

void hello();

#endif
`;
                break;
            case 'source':
                content = `#include "template.h"
#include <iostream>
using namespace std;

void hello() {
    cout << "Hello from template!" << endl;
}
`;
                break;
            default:
                break;
        }

        const fileName = this.generateNewFileName();
        let tabId = tabData.tabId;
        if (!tabId && uniqueKey) {
            try {
                if (this.monacoEditorManager && this.monacoEditorManager.generateTabId) {
                    const fname = tabData.fileName || uniqueKey.split('/').pop();
                    tabId = this.monacoEditorManager.generateTabId(fname, uniqueKey);
                } else {
                    tabId = uniqueKey.replace(/[\/:]/g, '_'); // 兜底旧逻辑
                }
            } catch (_) {
                tabId = uniqueKey.replace(/[\/:]/g, '_');
            }
        }
    }

    displayWelcomePage() {
        if (this.tabs.has('Welcome')) {
            this.activateTab('Welcome');
            return;
        }

        const welcomeTab = {
            fileName: 'Welcome',
            content: this.getWelcomePageContent(),
            modified: false,
            isWelcome: true
        };

        this.tabs.set('Welcome', welcomeTab);

        this.updateTabsUI();

        this.activateTab('Welcome');
    }

    getWelcomePageContent() {
        return `
            <div class="welcome-page">
                <div class="welcome-header">
                    <div class="welcome-logo">OICPP IDE</div>
                    <div class="welcome-subtitle">为 OIer 优化的 C++ 编程环境</div>
                    <div class="welcome-version">版本 1.0.2</div>
                </div>
                
                <div class="welcome-content">
                    <div class="welcome-section">
                        <h3>开始</h3>
                        <div class="welcome-actions">
                            <a href="#" class="welcome-action" data-action="open-folder">
                                <span class="icon">📁</span>
                                <span>打开文件夹</span>
                                <span class="shortcut">Ctrl+K</span>
                            </a>
                        </div>
                    </div>
                    
                    <div class="welcome-section">
                        <h3>最近打开</h3>
                        <div class="welcome-recent" id="welcome-recent">
                            <div class="welcome-recent-item">
                                <span class="icon">📄</span>
                                <span>暂无最近文件</span>
                            </div>
                        </div>
                    </div>
                </div>
                
                <div class="welcome-footer">
                    <p>OICPP IDE - 为 OIer 优化的 C++ 编程环境</p>
                    <p>版本 1.0.2, Copyright (C) 2025 mywwzh.</p>
                </div>
            </div>
        `;
    }

    updateTabsUI() {
        this.groups.forEach((group) => {
            if (!group?.tabBar) {
                return;
            }
            group.tabBar.innerHTML = '';
            group.tabs?.forEach((tab) => {
                if (tab?.element instanceof Element) {
                    group.tabBar.appendChild(tab.element);
                    tab.element.dataset.groupId = group.id;
                }
            });
        });
    }

    updateTabTitle(oldName, newName) {
        const tab = this.getTabByFileName(oldName);
        if (!tab) {
            return;
        }

        const uniqueKey = this.findUniqueKeyByFileName(oldName);
        const usesFileNameKey = !tab.filePath && uniqueKey === oldName;
        const newUniqueKey = usesFileNameKey ? newName : uniqueKey;

        if (uniqueKey) {
            this.tabs.delete(uniqueKey);
        }

        tab.fileName = newName;

        if (tab.element) {
            tab.element.dataset.file = newName;
            if (usesFileNameKey && newUniqueKey) {
                tab.element.dataset.uniqueKey = newUniqueKey;
            }
        }

        if (newUniqueKey) {
            tab.uniqueKey = newUniqueKey;
            this.tabs.set(newUniqueKey, tab);
        }

        const index = this.tabOrder.indexOf(oldName);
        if (index !== -1) {
            this.tabOrder[index] = newName;
        }

        if (this.activeTab === oldName) {
            this.activeTab = newName;
        }

        if (usesFileNameKey && this.activeTabKey === uniqueKey) {
            this.activeTabKey = newUniqueKey;
        }

        if (usesFileNameKey && tab.groupId) {
            const group = this.groups.get(tab.groupId);
            if (group && group.tabs) {
                group.tabs.delete(uniqueKey);
                if (newUniqueKey) {
                    group.tabs.set(newUniqueKey, tab);
                }
                if (group.activeTabKey === uniqueKey) {
                    group.activeTabKey = newUniqueKey;
                }
            }
        }

        this.refreshTabLabels();
        logInfo('标签页标题已更新:', oldName, '->', newName);
    }

    closeTabByFileName(fileName, options = {}) {
        const tab = this.getTabByFileName(fileName);
        if (tab) {
            this.closeTab(fileName, options);
            logInfo('已关闭标签页:', fileName);
        }
    }

    updateTabPath(fileName, newPath) {
        const tab = this.getTabByFileName(fileName);
        if (tab) {
            tab.filePath = newPath;
            logInfo('标签页路径已更新:', fileName, '->', newPath);
            this.refreshTabLabels();
        }
    }


    updateTabPathBySource(oldPath, newPath) {
        try {
            if (!oldPath || !newPath) return;
            const norm = (p) => String(p).replace(/\\/g, '/');
            const oldKey = norm(oldPath);
            const newKey = norm(newPath);

            let tabData = this.tabs.get(oldKey) || null;
            let actualOldKey = oldKey;
            if (!tabData) {
                for (const [k, v] of this.tabs.entries()) {
                    if (norm(v.filePath || '') === oldKey) { tabData = v; actualOldKey = k; break; }
                }
            }
            if (!tabData) {
                logWarn('未找到需要更新路径的标签页，oldPath=', oldPath);
                return;
            }

            if (this.tabs.has(newKey) && newKey !== actualOldKey) {
                const dup = this.tabs.get(newKey);
                try {
                    if (dup && dup.element && dup.element.parentNode) {
                        dup.element.parentNode.removeChild(dup.element);
                    }
                } catch (_) { }
                this.tabs.delete(newKey);
            }

            this.tabs.delete(actualOldKey);
            const previousPath = tabData.filePath;
            tabData.filePath = newPath;
            tabData.uniqueKey = newKey;
            this.tabs.set(newKey, tabData);

            try {
                let tabEl = tabData.element;
                if (!tabEl && tabData.tabId) {
                    tabEl = document.querySelector(`.tab[data-tab-id="${tabData.tabId}"]`);
                }
                if (tabEl) {
                    tabEl.dataset.uniqueKey = newKey;
                    tabData.element = tabEl;
                }
            } catch (e) { logWarn('更新标签 DOM uniqueKey 失败:', e); }

            try {
                if (this.monacoEditorManager && tabData.tabId) {
                    if (typeof this.monacoEditorManager.updateTabFilePath === 'function') {
                        this.monacoEditorManager.updateTabFilePath(tabData.tabId, newPath);
                    } else {
                        const mm = this.monacoEditorManager;
                        try { mm.tabIdToFilePath && mm.tabIdToFilePath.set(tabData.tabId, newPath); } catch (_) { }
                        try { const ed = mm.editors && mm.editors.get(tabData.tabId); if (ed) ed.filePath = newPath; } catch (_) { }
                    }
                }
            } catch (e) { logWarn('同步 Monaco 文件路径失败:', e); }

            logInfo('标签页路径已重新绑定:', { oldPath, newPath, tabId: tabData.tabId, uniqueKey: newKey });
            this.refreshTabLabels();
            this.handleTabFileWatchRebind(previousPath, newPath, tabData);
        } catch (err) {
            logError('updateTabPathBySource 失败:', err);
        }
    }



    setFilePath(fileName, filePath) {
        const tab = this.getTabByFileName(fileName);
        if (tab) {
            tab.filePath = filePath;
            logInfo('文件路径已设置:', fileName, '->', filePath);
            this.refreshTabLabels();
        }
    }

    async createNewCppFile() {
        this.closeWelcomePage();

        if (window.sidebar && window.sidebar.panels && window.sidebar.panels.files) {
            const fileExplorer = window.sidebar.panels.files;
            if (fileExplorer && fileExplorer.createNewFile) {
                await fileExplorer.createNewFile();
                return;
            }
        }

        logError('TabManager: 文件管理器不可用，无法创建新文件');
        if (window.dialogManager) {
            try { logError('[DialogError]', { message: '请先打开一个工作区文件夹', from: 'TabManager.createNewCppFile' }); } catch (_) { }
            window.dialogManager.showError('请先打开一个工作区文件夹');
        }
    }

    updateAllEditorsSettings(settings) {
        if (!this.monacoEditorManager) {
            this.tryGetEditorManagerReference();
        }

        if (this.monacoEditorManager) {
            if (typeof this.monacoEditorManager.updateAllEditorsSettings === 'function') {
                try {
                    this.monacoEditorManager.updateAllEditorsSettings(settings);
                } catch (error) {
                    logError('TabManager: 通过 monacoEditorManager.updateAllEditorsSettings 更新设置失败:', error);
                }
            }
            else if (typeof this.monacoEditorManager.updateSettings === 'function') {
                try {
                    this.monacoEditorManager.updateSettings(settings);
                } catch (error) {
                    logError('TabManager: 通过 monacoEditorManager.updateSettings 更新设置失败:', error);
                }
            }
            else {
                logWarn('TabManager: monacoEditorManager 不支持 updateSettings 或 updateAllEditorsSettings 方法');
            }
        } else {
            logWarn('TabManager: monacoEditorManager 仍然不可用，无法更新编辑器设置');
            setTimeout(() => {
                if (this.tryGetEditorManagerReference()) {
                    logInfo('TabManager: 延迟重试成功，重新调用updateAllEditorsSettings');
                    this.updateAllEditorsSettings(settings);
                }
            }, 500);
        }


    }

    getCurrentTab() {
        return this.activeTab;
    }

    showEmptyState() {
        const welcomeContainer = document.getElementById('welcome-container');
        if (welcomeContainer) {
            welcomeContainer.style.display = 'none';
        }

        const editorArea = document.querySelector('.editor-area');
        if (editorArea) {
            editorArea.style.display = 'block';
            editorArea.innerHTML = '';
        }

        if (this.monacoEditorManager) {
            this.monacoEditorManager.currentEditor = null;
            this.monacoEditorManager.currentFilePath = null;
            this.monacoEditorManager.currentFileName = null;
        }

        if (window.sidebarManager && window.sidebarManager.enableResize) {
            window.sidebarManager.enableResize();
        }
    }
}

let tabManager;
document.addEventListener('DOMContentLoaded', () => {
    tabManager = new TabManager();
    window.tabManager = tabManager;
    logInfo('标签页管理器已初始化');
});
