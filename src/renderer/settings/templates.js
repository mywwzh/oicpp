const { ipcRenderer } = require('electron');

class TemplatesSettings {
    constructor() {
        this.settings = {
            cppTemplate: ''
        };
    this.snippets = [];
        
        this.init();
    }

    async init() {
        logInfo('初始化模板设置页面');
        const urlParams = new URLSearchParams(window.location.search);
        const themeFromUrl = urlParams.get('theme');
        if (themeFromUrl) {
            this.applyTheme(themeFromUrl);
        }
        await this.loadSettings();
        this.setupEventListeners();
        this.setupSidebarNavigation();
        this.setupThemeListener();
        await this.applyCurrentTheme();
        this.updateUI();
    }

    setupSidebarNavigation() {
        const sidebarItems = document.querySelectorAll('.sidebar-item');
        const sections = document.querySelectorAll('.settings-section');

        sidebarItems.forEach(item => {
            item.addEventListener('click', () => {
                sidebarItems.forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                sections.forEach(section => section.classList.remove('active'));
                
                const targetId = item.getAttribute('data-target');
                const targetSection = document.getElementById(targetId);
                if (targetSection) {
                    targetSection.classList.add('active');
                }
            });
        });
    }

    setupThemeListener() {
        if (window.electronIPC && window.electronIPC.on) {
            window.electronIPC.on('theme-changed', (event, theme) => {
                logInfo('代码模板设置页面收到主题变更:', theme);
                this.applyTheme(theme);
            });
        }
    }

    async applyCurrentTheme() {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const settings = await window.electronAPI.getAllSettings();
                if (settings && settings.theme) {
                    this.applyTheme(settings.theme);
                }
            }
        } catch (error) {
            logError('获取主题设置失败:', error);
        }
    }

    applyTheme(theme) {
        logInfo('应用主题到代码模板设置页面:', theme);
        
        document.body.setAttribute('data-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
    }

    setupEventListeners() {
        logInfo('设置事件监听器');
        
        const isMac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform || '');
        const modKey = (e) => (isMac ? e.metaKey : e.ctrlKey);

        const saveBtn = document.getElementById('save-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveSettings();
            });
        }
        
        const cancelBtn = document.getElementById('cancel-settings');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                this.closeWindow();
            });
        }
        
        const resetBtn = document.getElementById('reset-settings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetSettings();
            });
        }
        
        const previewBtn = document.getElementById('preview-template');
        if (previewBtn) {
            previewBtn.addEventListener('click', () => {
                this.showPreview();
            });
        }

        // 打开片段添加弹窗
        const addBtn = document.getElementById('add-snippet');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.openSnippetDialog(-1));
        }

        // 关闭片段弹窗
        const closeSnippetDialogBtn = document.getElementById('close-snippet-dialog');
        if (closeSnippetDialogBtn) {
            closeSnippetDialogBtn.addEventListener('click', () => {
                this.closeSnippetDialog();
            });
        }

        const cancelSnippetBtn = document.getElementById('cancel-snippet-btn');
        if (cancelSnippetBtn) {
            cancelSnippetBtn.addEventListener('click', () => {
                this.closeSnippetDialog();
            });
        }

        const confirmSnippetBtn = document.getElementById('confirm-snippet-btn');
        if (confirmSnippetBtn) {
            confirmSnippetBtn.addEventListener('click', () => {
                this.confirmSnippetDialog();
            });
        }

        // 点击弹窗遮罩关闭
        const snippetDialog = document.getElementById('snippet-dialog');
        if (snippetDialog) {
            snippetDialog.addEventListener('click', (e) => {
                if (e.target === snippetDialog) {
                    this.closeSnippetDialog();
                }
            });
        }

        // 弹窗内 Ctrl/Cmd+Enter 确认
        const snippetDialogContent = document.getElementById('snippet-dialog-content');
        if (snippetDialogContent) {
            snippetDialogContent.addEventListener('keydown', (e) => {
                if (modKey(e) && e.key === 'Enter') {
                    e.preventDefault();
                    this.confirmSnippetDialog();
                }
            });
        }
        
        const closePreviewBtn = document.getElementById('close-preview');
        if (closePreviewBtn) {
            closePreviewBtn.addEventListener('click', () => {
                this.closePreview();
            });
        }
        
        const previewDialog = document.getElementById('preview-dialog');
        if (previewDialog) {
            previewDialog.addEventListener('click', (e) => {
                if (e.target === previewDialog) {
                    this.closePreview();
                }
            });
        }
        
        const cppTemplateTextarea = document.getElementById('cpp-template');
        if (cppTemplateTextarea) {
            cppTemplateTextarea.addEventListener('input', (e) => {
                this.settings.cppTemplate = e.target.value;
                logInfo('模板内容已更新');
            });
            
            cppTemplateTextarea.addEventListener('keydown', (e) => {
                // macOS 使用 Cmd+S，Windows/Linux 使用 Ctrl+S
                if (modKey(e) && e.key === 's') {
                    e.preventDefault();
                    this.saveSettings();
                }
                
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const start = e.target.selectionStart;
                    const end = e.target.selectionEnd;
                    const value = e.target.value;
                    
                    e.target.value = value.substring(0, start) + '    ' + value.substring(end);
                    e.target.selectionStart = e.target.selectionEnd = start + 4;
                }
            });
        }

        // 监听全局键盘事件，支持 Cmd/Ctrl+S 在任意位置保存
        document.addEventListener('keydown', (e) => {
            if (modKey(e) && e.key === 's') {
                // 如果焦点在弹窗内的输入框，不触发全局保存
                const activeEl = document.activeElement;
                if (activeEl && activeEl.closest('#snippet-dialog')) {
                    return;
                }
                e.preventDefault();
                this.saveSettings();
            }
        });
    }


    async loadSettings() {
        try {
            logInfo('加载设置中...');
            
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const allSettings = await window.electronAPI.getAllSettings();
                if (allSettings) {
                    if (allSettings.cppTemplate) {
                        this.settings.cppTemplate = allSettings.cppTemplate;
                    }
                    if (Array.isArray(allSettings.codeSnippets)) {
                        this.snippets = allSettings.codeSnippets;
                    }
                    logInfo('从Electron API获取设置成功');
                }
            } else {
                logInfo('Electron API不可用，尝试使用ipcRenderer');
                
                const allSettings = await ipcRenderer.invoke('get-all-settings');
                if (allSettings) {
                    if (allSettings.cppTemplate) {
                        this.settings.cppTemplate = allSettings.cppTemplate;
                    }
                    if (Array.isArray(allSettings.codeSnippets)) {
                        this.snippets = allSettings.codeSnippets;
                    }
                    logInfo('从ipcRenderer获取设置成功');
                }
            }
            
            logInfo('模板设置加载完成:', this.settings);
        } catch (error) {
            logError('加载模板设置失败:', error);
            this.showMessage('加载设置失败，使用默认模板', 'error');
        }
    }

    updateUI() {
        logInfo('更新UI界面');
        
        const cppTemplateTextarea = document.getElementById('cpp-template');
        if (cppTemplateTextarea) {
            cppTemplateTextarea.value = this.settings.cppTemplate;
            logInfo('模板内容已加载到编辑器');
        } else {
            logError('找不到模板编辑器元素');
        }
        this.renderSnippets();
    }

    async saveSettings() {
        try {
            logInfo('保存设置中...');
            
            const cppTemplateTextarea = document.getElementById('cpp-template');
            if (!cppTemplateTextarea) {
                throw new Error('找不到模板编辑器');
            }
            
            const cppTemplate = cppTemplateTextarea.value.trim();
            
            // 允许文件模板为空，只要有关键词代码片段即可保存
            if (!cppTemplate && (!this.snippets || this.snippets.length === 0)) {
                this.showMessage('模板内容和代码片段不能同时为空，请至少填写一项', 'error');
                return;
            }
            
            const newSettings = {
                cppTemplate: cppTemplate,
                codeSnippets: this.snippets
            };
            
            logInfo('准备保存的设置:', newSettings);
            
            let result;
            if (window.electronAPI && window.electronAPI.updateSettings) {
                result = await window.electronAPI.updateSettings(newSettings);
            } else {
                result = await ipcRenderer.invoke('update-settings', newSettings);
            }
            
            if (result && result.success) {
                this.showMessage('模板设置保存成功！', 'success');
                logInfo('设置保存成功');
            } else {
                const errorMsg = result ? result.error : '未知错误';
                this.showMessage('保存设置失败：' + errorMsg, 'error');
                logError('保存设置失败:', errorMsg);
            }
            
        } catch (error) {
            logError('保存模板设置失败:', error);
            this.showMessage('保存设置失败：' + error.message, 'error');
        }
    }

    async resetSettings() {
        try {
            logInfo('重置设置中...');
            
            if (confirm('确定要重置模板为默认设置吗？这将丢失当前的自定义模板。')) {
                const defaultTemplate = '';
                this.settings.cppTemplate = defaultTemplate;
                this.snippets = [];
                
                const cppTemplateTextarea = document.getElementById('cpp-template');
                if (cppTemplateTextarea) {
                    cppTemplateTextarea.value = defaultTemplate;
                }
                
                const newSettings = { cppTemplate: defaultTemplate, codeSnippets: [] };
                
                let result;
                if (window.electronAPI && window.electronAPI.updateSettings) {
                    result = await window.electronAPI.updateSettings(newSettings);
                } else {
                    result = await ipcRenderer.invoke('update-settings', newSettings);
                }
                
                if (result && result.success) {
                    this.showMessage('模板与片段已重置为默认设置', 'success');
                    logInfo('设置重置成功');
                } else {
                    this.showMessage('重置设置失败：' + (result ? result.error : '未知错误'), 'error');
                }
            }
        } catch (error) {
            logError('重置设置失败:', error);
            this.showMessage('重置设置失败：' + error.message, 'error');
        }
    }

    // 打开片段添加/编辑弹窗
    openSnippetDialog(editIndex = -1) {
        const dialog = document.getElementById('snippet-dialog');
        if (!dialog) return;

        const kwEl = document.getElementById('snippet-dialog-keyword');
        const descEl = document.getElementById('snippet-dialog-desc');
        const contentEl = document.getElementById('snippet-dialog-content');

        // 如果是编辑模式，加载已有数据
        if (editIndex >= 0 && editIndex < this.snippets.length) {
            const item = this.snippets[editIndex];
            if (kwEl) kwEl.value = item.keyword || '';
            if (descEl) descEl.value = item.description || '';
            if (contentEl) contentEl.value = item.content || '';
            dialog.setAttribute('data-edit-index', editIndex);
            const titleEl = document.getElementById('snippet-dialog-title');
            if (titleEl) titleEl.textContent = '编辑代码片段';
        } else {
            if (kwEl) kwEl.value = '';
            if (descEl) descEl.value = '';
            if (contentEl) contentEl.value = '';
            dialog.removeAttribute('data-edit-index');
            const titleEl = document.getElementById('snippet-dialog-title');
            if (titleEl) titleEl.textContent = '添加代码片段';
        }

        dialog.style.display = 'block';
        // 自动聚焦到关键词输入框
        setTimeout(() => {
            if (kwEl) kwEl.focus();
        }, 100);
    }

    closeSnippetDialog() {
        const dialog = document.getElementById('snippet-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    confirmSnippetDialog() {
        const kwEl = document.getElementById('snippet-dialog-keyword');
        const descEl = document.getElementById('snippet-dialog-desc');
        const contentEl = document.getElementById('snippet-dialog-content');
        const keyword = (kwEl?.value || '').trim();
        const description = (descEl?.value || '').trim() || '用户代码片段';
        const content = (contentEl?.value || '').trim();

        if (!keyword) {
            this.showMessage('请输入片段关键词', 'warning');
            if (kwEl) kwEl.focus();
            return;
        }
        if (!content) {
            this.showMessage('请输入片段内容', 'warning');
            if (contentEl) contentEl.focus();
            return;
        }

        const dialog = document.getElementById('snippet-dialog');
        const editIndex = dialog ? parseInt(dialog.getAttribute('data-edit-index'), 10) : -1;

        if (Number.isFinite(editIndex) && editIndex >= 0 && editIndex < this.snippets.length) {
            // 编辑模式：更新已有片段
            this.snippets[editIndex] = { keyword, description, content };
            this.showMessage('片段已更新，点击保存写入设置', 'success');
        } else {
            // 添加模式：检查重复关键词
            const idx = this.snippets.findIndex(s => (s.keyword || '').toLowerCase() === keyword.toLowerCase());
            if (idx >= 0) {
                this.snippets[idx] = { keyword, description, content };
                this.showMessage('已覆盖同名片段，点击保存写入设置', 'success');
            } else {
                this.snippets.push({ keyword, description, content });
                this.showMessage('片段已添加，点击保存写入设置', 'success');
            }
        }

        this.closeSnippetDialog();
        this.renderSnippets();
    }

    renderSnippets() {
        const list = document.getElementById('snippets-list');
        if (!list) return;
        if (!this.snippets || this.snippets.length === 0) {
            list.innerHTML = '<div style="opacity:.8; font-size:12px; padding:6px;">暂无片段。点击上方添加模板按钮添加代码片段。</div>';
            return;
        }
        const rows = this.snippets.map((s, i) => {
            const k = this.escapeHtml(s.keyword || '');
            const d = this.escapeHtml(s.description || '');
            return `
                <div class="snippet-row" data-index="${i}" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--settings-border);">
                    <div style="flex:0 0 160px; font-weight:600;">${k}</div>
                    <div style="flex:1; opacity:.85;">${d}</div>
                    <button class="preview-btn" data-action="edit" style="background:#6c757d;">编辑</button>
                    <button class="preview-btn" data-action="delete" style="background:#dc3545;">删除</button>
                </div>`;
        }).join('');
        list.innerHTML = rows;
        list.querySelectorAll('button[data-action]')?.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const row = e.target.closest('.snippet-row');
                const idx = parseInt(row?.dataset.index || '-1', 10);
                const action = e.target.dataset.action;
                if (Number.isNaN(idx) || idx < 0) return;
                if (action === 'delete') {
                    this.snippets.splice(idx, 1);
                    this.renderSnippets();
                } else if (action === 'edit') {
                    this.openSnippetDialog(idx);
                }
            });
        });
    }

    escapeHtml(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    showPreview() {
        logInfo('显示模板预览');
        
        const cppTemplateTextarea = document.getElementById('cpp-template');
        if (!cppTemplateTextarea) {
            this.showMessage('找不到模板内容', 'error');
            return;
        }
        
        const templateContent = cppTemplateTextarea.value || '// 模板内容为空';
        
        const previewContent = document.getElementById('preview-content');
        if (previewContent) {
            previewContent.textContent = templateContent;
        }
        
        const previewDialog = document.getElementById('preview-dialog');
        if (previewDialog) {
            previewDialog.style.display = 'block';
        }
    }

    closePreview() {
        logInfo('关闭模板预览');
        
        const previewDialog = document.getElementById('preview-dialog');
        if (previewDialog) {
            previewDialog.style.display = 'none';
        }
    }

    showMessage(message, type = 'info') {
        logInfo(`显示消息: [${type}] ${message}`);
        
        const existingToast = document.querySelector('.message-toast');
        if (existingToast) {
            existingToast.remove();
        }
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-toast ${type}`;
        messageDiv.textContent = message;
        try {
            if (type === 'error') {
                const errObj = message instanceof Error ? message : new Error(String(message));
                logError('[TemplateSettingsToastError]', { message: String(message), stack: errObj.stack });
            }
        } catch (_) {}

        document.body.appendChild(messageDiv);
        
        requestAnimationFrame(() => {
            messageDiv.style.opacity = '1';
        });
        
        setTimeout(() => {
            messageDiv.style.opacity = '0';
            setTimeout(() => {
                if (messageDiv.parentNode) {
                    messageDiv.parentNode.removeChild(messageDiv);
                }
            }, 300);
        }, 3000);
    }

    closeWindow() {
        logInfo('关闭窗口');
        
        if (window.close) {
            window.close();
        } else {
            logWarn('window.close 不可用');
        }
    }
}

window.addEventListener('DOMContentLoaded', () => {
    logInfo('DOM加载完成，初始化模板设置');
    
    try {
        new TemplatesSettings();
    } catch (error) {
        logError('初始化模板设置失败:', error);
    }
});

window.TemplatesSettings = TemplatesSettings;
