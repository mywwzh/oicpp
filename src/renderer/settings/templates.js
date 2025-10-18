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
        await this.loadSettings();
        this.setupEventListeners();
        this.setupThemeListener();
        await this.applyCurrentTheme();
        this.updateUI();
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
        
        if (theme === 'light') {
            document.documentElement.style.setProperty('--bg-color', '#ffffff');
            document.documentElement.style.setProperty('--text-color', '#333333');
            document.documentElement.style.setProperty('--border-color', '#e1e1e1');
            document.documentElement.style.setProperty('--hover-bg', '#f5f5f5');
            document.documentElement.style.setProperty('--input-bg', '#ffffff');
            document.documentElement.style.setProperty('--button-bg', '#0066cc');
            document.documentElement.style.setProperty('--button-hover', '#004499');
        } else {
            document.documentElement.style.setProperty('--bg-color', '#1e1e1e');
            document.documentElement.style.setProperty('--text-color', '#cccccc');
            document.documentElement.style.setProperty('--border-color', '#3c3c3c');
            document.documentElement.style.setProperty('--hover-bg', '#2d2d30');
            document.documentElement.style.setProperty('--input-bg', '#2d2d30');
            document.documentElement.style.setProperty('--button-bg', '#0e639c');
            document.documentElement.style.setProperty('--button-hover', '#1177bb');
        }
    }

    setupEventListeners() {
        logInfo('设置事件监听器');
        
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

        const addBtn = document.getElementById('add-snippet');
        if (addBtn) {
            addBtn.addEventListener('click', () => this.addSnippetFromInputs());
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
                if (e.ctrlKey && e.key === 's') {
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
            
            if (!cppTemplate) {
                this.showMessage('模板内容不能为空', 'error');
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
                
                setTimeout(() => {
                    this.closeWindow();
                }, 1500);
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

    addSnippetFromInputs() {
        const kwEl = document.getElementById('snippet-keyword');
        const descEl = document.getElementById('snippet-desc');
        const contentEl = document.getElementById('snippet-content');
        const keyword = (kwEl?.value || '').trim();
        const description = (descEl?.value || '').trim() || '用户代码片段';
        const content = (contentEl?.value || '').trim();
        if (!keyword) {
            this.showMessage('请输入片段关键词', 'warning');
            return;
        }
        if (!content) {
            this.showMessage('请输入片段内容', 'warning');
            return;
        }
        const idx = this.snippets.findIndex(s => (s.keyword || '').toLowerCase() === keyword.toLowerCase());
        const item = { keyword, description, content };
        if (idx >= 0) this.snippets[idx] = item; else this.snippets.push(item);
        this.showMessage('片段已添加到列表，点击“保存”写入设置', 'success');
        if (contentEl) contentEl.value = '';
        this.renderSnippets();
    }

    renderSnippets() {
        const list = document.getElementById('snippets-list');
        if (!list) return;
        if (!this.snippets || this.snippets.length === 0) {
            list.innerHTML = '<div style="opacity:.8; font-size:12px; padding:6px;">暂无片段。可在上方添加，例如关键词 sgt，描述“用户代码片段”，内容填入你的线段树。</div>';
            return;
        }
        const rows = this.snippets.map((s, i) => {
            const k = this.escapeHtml(s.keyword || '');
            const d = this.escapeHtml(s.description || '');
            return `
                <div class="snippet-row" data-index="${i}" style="display:flex; align-items:center; gap:8px; padding:6px 0; border-bottom:1px solid var(--border-color);">
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
                    const item = this.snippets[idx];
                    const kwEl = document.getElementById('snippet-keyword');
                    const descEl = document.getElementById('snippet-desc');
                    const contentEl = document.getElementById('snippet-content');
                    if (kwEl) kwEl.value = item.keyword || '';
                    if (descEl) descEl.value = item.description || '';
                    if (contentEl) contentEl.value = item.content || '';
                    this.showMessage('已加载到上方表单，修改后再次点击“添加片段”以覆盖，然后保存设置', 'info');
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
