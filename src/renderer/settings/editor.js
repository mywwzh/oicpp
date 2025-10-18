class EditorSettings {
    constructor() {
        this.settings = {
            font: 'Consolas, "Courier New", monospace',
            fontSize: 14,
            theme: 'dark',
            tabSize: 4,
            wordWrap: false,
            foldingEnabled: true,
            stickyScrollEnabled: true,
            fontLigaturesEnabled: true,
            enableAutoCompletion: true,
            bracketMatching: true,
            highlightCurrentLine: true,
            autoSave: true,
            autoSaveInterval: 60000
        };
    }

    async init() {
        await this.loadSettings();

        await this.loadSystemFonts();

        this.setupEventListeners();

        this.setupThemeListener();

        this.applyTheme(this.settings.theme);

        this.updateUI();

        logInfo('EditorSettings 初始化完成');
    }

    setupEventListeners() {
        const saveBtn = document.getElementById('save-settings');
        logInfo('保存按钮元素:', saveBtn);
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                logInfo('保存按钮被点击');
                this.saveSettings();
            });
        } else {
            logError('找不到保存按钮元素 #save-settings');
        }

        document.getElementById('cancel-settings').addEventListener('click', () => {
            this.closeWindow();
        });

        const resetBtn = document.getElementById('reset-settings');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this.resetSettings();
            });
        }

        const closeFontDialogBtn = document.getElementById('close-font-dialog');
        if (closeFontDialogBtn) {
            closeFontDialogBtn.addEventListener('click', () => {
                this.closeFontDialog();
            });
        }

        this.setupRealTimePreview();

        const autoSaveCheckbox = document.getElementById('editor-auto-save-enabled');
        const autoSaveIntervalInput = document.getElementById('editor-auto-save-interval');
        if (autoSaveCheckbox && autoSaveIntervalInput) {
            autoSaveCheckbox.addEventListener('change', (e) => {
                this.toggleAutoSaveInterval(autoSaveIntervalInput, e.target.checked);
                this.notifyMainWindowPreview();
            });
            autoSaveIntervalInput.addEventListener('input', () => {
                this.notifyMainWindowPreview();
            });
        }

        const tabSizeInput = document.getElementById('editor-tab-size');
        if (tabSizeInput) {
            tabSizeInput.addEventListener('input', () => {
                this.notifyMainWindowPreview();
            });
        }
    }

    toggleAutoSaveInterval(inputElement, enabled) {
        if (!inputElement) return;
        inputElement.disabled = !enabled;
    }

    setupThemeListener() {
        if (window.electronIPC && window.electronIPC.on) {
            window.electronIPC.on('theme-changed', (event, theme) => {
                logInfo('编辑器设置页面收到主题变更:', theme);
                this.settings.theme = theme;
                this.applyTheme(theme);
                this.updateUI();
            });
        }
    }

    applyTheme(theme) {
        logInfo('应用主题到编辑器设置页面:', theme);

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

    setupRealTimePreview() {
        const fontSizeInput = document.getElementById('editor-font-size');
        logInfo('字体大小输入框元素:', fontSizeInput);
        if (fontSizeInput) {
            fontSizeInput.addEventListener('input', (e) => {
                const newFontSize = parseInt(e.target.value);
                logInfo('字体大小输入变化:', { oldValue: this.settings.fontSize, newValue: newFontSize });
                this.updatePreview();
                this.notifyMainWindowPreview();
            });
        } else {
            logError('未找到字体大小输入框元素');
        }

        const fontSelect = document.getElementById('editor-font');
        if (fontSelect) {
            fontSelect.addEventListener('change', (e) => {
                logInfo('字体选择变化:', { oldValue: this.settings.font, newValue: e.target.value });
                this.updatePreview();
                this.notifyMainWindowPreview();
            });
        }


    }

    updatePreview() {
        const currentSettings = this.collectSettings();
        const preview = document.querySelector('.settings-preview');
        if (preview) {
            preview.style.fontFamily = currentSettings.font;
            preview.style.fontSize = currentSettings.fontSize + 'px';
        }

        const codeExamples = document.querySelectorAll('.code-example, pre, code');
        codeExamples.forEach(element => {
            element.style.fontFamily = currentSettings.font;
            element.style.fontSize = currentSettings.fontSize + 'px';
        });
    }

    notifyMainWindowPreview() {
        try {
            const previewSettings = this.collectSettings();
            logInfo('实时预览设置变更:', previewSettings);

            clearTimeout(this.previewTimeout);
            this.previewTimeout = setTimeout(() => {
                if (window.electronAPI && window.electronAPI.sendSettingsPreview) {
                    logInfo('通过IPC发送预览设置到主进程');
                    window.electronAPI.sendSettingsPreview(previewSettings);
                } else {
                    logWarn('预览API (electronAPI.sendSettingsPreview) 不可用');
                }
            }, 150);

        } catch (error) {
            logWarn('实时预览通知失败:', error);
        }
    }
    async loadSettings() {
        try {
            let allSettings = null;

            if (window.electronAPI && window.electronAPI.getAllSettings) {
                try {
                    allSettings = await window.electronAPI.getAllSettings();
                    logInfo('通过electronAPI加载设置成功:', allSettings);
                } catch (apiError) {
                    logError('electronAPI加载失败:', apiError);
                }
            }

            if (!allSettings && typeof require !== 'undefined') {
                try {
                    const { ipcRenderer } = require('electron');
                    allSettings = await ipcRenderer.invoke('get-all-settings');
                    logInfo('通过ipcRenderer加载设置成功:', allSettings);
                } catch (ipcError) {
                    logError('ipcRenderer加载失败:', ipcError);
                }
            }

            if (allSettings) {
                this.settings = {
                    font: allSettings.font || 'Consolas',
                    fontSize: allSettings.fontSize || 14,
                    theme: allSettings.theme || 'dark',
                    tabSize: allSettings.tabSize || 4,
                    fontLigaturesEnabled: allSettings.fontLigaturesEnabled !== false,
                    foldingEnabled: allSettings.foldingEnabled !== false,
                    stickyScrollEnabled: allSettings.stickyScrollEnabled !== false,
                    autoSave: allSettings.autoSave !== false,
                    autoSaveInterval: typeof allSettings.autoSaveInterval === 'number' ? allSettings.autoSaveInterval : 60000
                };
                logInfo('编辑器设置加载完成:', this.settings);
            } else {
                logWarn('无法从主进程加载设置，使用默认设置');
                this.settings = {
                    font: 'Consolas',
                    fontSize: 14,
                    theme: 'dark',
                    tabSize: 4,
                    stickyScrollEnabled: true,
                    foldingEnabled: true,
                    autoSave: true,
                    autoSaveInterval: 60000
                };
            }
        } catch (error) {
            logError('加载编辑器设置失败:', error);
            this.settings = {
                font: 'Consolas',
                fontSize: 14,
                theme: 'dark',
                tabSize: 4,
                stickyScrollEnabled: true,
                foldingEnabled: true,
                autoSave: true,
                autoSaveInterval: 60000
            };
        }
    }

    async loadSystemFonts() {
        logInfo('开始加载系统字体');

        const fontSelect = document.getElementById('editor-font');
        if (!fontSelect) {
            logError('找不到字体选择器元素');
            return;
        }

        fontSelect.innerHTML = '<option value="">正在加载字体...</option>';

        let availableFonts = [];
        if (window.fontDetector) {
            try {
                if (typeof window.fontDetector.getAllAvailableFonts === 'function') {
                    availableFonts = await window.fontDetector.getAllAvailableFonts();
                    logInfo('通过异步方法检测到的系统字体:', availableFonts.length, '个');
                }

                if (availableFonts.length === 0 && typeof window.fontDetector.getAllAvailableFontsSync === 'function') {
                    availableFonts = window.fontDetector.getAllAvailableFontsSync();
                    logInfo('通过同步方法检测到的系统字体:', availableFonts.length, '个');
                }
            } catch (error) {
                logWarn('字体检测失败，使用默认字体列表:', error);
                availableFonts = this.getDefaultFontList();
            }
        } else {
            logWarn('字体检测器不可用，使用默认字体列表');
            availableFonts = this.getDefaultFontList();
        }

        fontSelect.innerHTML = '';

        availableFonts.forEach(font => {
            const option = document.createElement('option');
            option.value = font;
            option.textContent = font;

            option.style.fontFamily = `"${font}", monospace`;

            fontSelect.appendChild(option);
        });

        logInfo(`已加载 ${availableFonts.length} 个字体到选择器`);
    }

    getDefaultFontList() {
        return [
            'Consolas',
            'Monaco',
            'Menlo',
            'Fira Code',
            'Source Code Pro',
            'JetBrains Mono',
            'Cascadia Code',
            'Ubuntu Mono',
            'Roboto Mono',
            'Inconsolata',
            'Courier New',
            'Lucida Console',
            'DejaVu Sans Mono',
            'Arial',
            'Helvetica',
            'Times New Roman',
            'Georgia',
            'Verdana',
            'Microsoft YaHei',
            'SimSun',
            'monospace'
        ];
    }

    closeFontDialog() {
        const dialog = document.getElementById('font-download-dialog');
        if (dialog) {
            dialog.style.display = 'none';
        }
    }

    collectSettings() {
        const fontSelect = document.getElementById('editor-font');
        const themeSelect = document.getElementById('editor-theme');
        const fontSizeInput = document.getElementById('editor-font-size');

        const newSettings = {};

        if (fontSelect) newSettings.font = fontSelect.value;
        if (themeSelect) newSettings.theme = themeSelect.value;
        if (fontSizeInput) newSettings.fontSize = parseInt(fontSizeInput.value);
        const foldingCheckbox = document.getElementById('editor-folding');
        if (foldingCheckbox) newSettings.foldingEnabled = !!foldingCheckbox.checked;
        const stickyScrollCheckbox = document.getElementById('editor-sticky-scroll');
        if (stickyScrollCheckbox) newSettings.stickyScrollEnabled = !!stickyScrollCheckbox.checked;
        const ligaturesCheckbox = document.getElementById('editor-font-ligatures');
        if (ligaturesCheckbox) newSettings.fontLigaturesEnabled = !!ligaturesCheckbox.checked;
        const tabSizeInput = document.getElementById('editor-tab-size');
        if (tabSizeInput) {
            const parsedTabSize = parseInt(tabSizeInput.value, 10);
            if (!Number.isNaN(parsedTabSize) && parsedTabSize > 0) {
                newSettings.tabSize = parsedTabSize;
            }
        }
        const autoSaveCheckbox = document.getElementById('editor-auto-save-enabled');
        if (autoSaveCheckbox) {
            newSettings.autoSave = !!autoSaveCheckbox.checked;
        }
        const autoSaveIntervalInput = document.getElementById('editor-auto-save-interval');
        if (autoSaveIntervalInput) {
            const parsedInterval = parseInt(autoSaveIntervalInput.value, 10);
            if (!Number.isNaN(parsedInterval) && parsedInterval > 0) {
                newSettings.autoSaveInterval = parsedInterval * 1000;
            }
        }

        logInfo('收集到的设置:', newSettings);
        logInfo('字体大小输入框值:', fontSizeInput ? fontSizeInput.value : '未找到输入框');

        return newSettings;
    }

    async saveSettings() {
        clearTimeout(this.previewTimeout);
        try {
            const newSettings = this.collectSettings();

            if (newSettings.font && window.fontDetector) {
                logInfo('开始验证字体:', newSettings.font);
                const validatedFont = window.fontDetector.validateFont(newSettings.font);
                if (validatedFont !== newSettings.font) {
                    logInfo('字体验证失败，从', newSettings.font, '切换到', validatedFont);
                    newSettings.font = validatedFont;
                }
            }

            logInfo('即将保存的设置:', newSettings);

            logInfo('API可用性检查:', {
                electronAPI: !!window.electronAPI,
                updateSettings: !!(window.electronAPI && window.electronAPI.updateSettings),
                requireAvailable: typeof require !== 'undefined'
            });

            let result = null;

            if (window.electronAPI && window.electronAPI.updateSettings) {
                try {
                    result = await window.electronAPI.updateSettings(newSettings);
                    logInfo('通过electronAPI保存设置结果:', result);
                } catch (apiError) {
                    logError('electronAPI保存失败:', apiError);
                }
            }

            if (!result && typeof require !== 'undefined') {
                try {
                    const { ipcRenderer } = require('electron');
                    result = await ipcRenderer.invoke('update-top-level-settings', newSettings);
                    logInfo('通过ipcRenderer保存设置结果:', result);
                } catch (ipcError) {
                    logError('ipcRenderer保存失败:', ipcError);
                }
            }

            if (result && result.success) {
                logInfo('编辑器设置保存成功');

                const themeChanged = newSettings.theme && newSettings.theme !== this.settings.theme;
                logInfo('主题变化检测:', { oldTheme: this.settings.theme, newTheme: newSettings.theme, changed: themeChanged });

                Object.assign(this.settings, newSettings);

                if (themeChanged) {
                    this.showMessage('主题已更改，正在重启编辑器...', 'info');
                    setTimeout(() => {
                        if (window.electronAPI && window.electronAPI.relaunchApp) {
                            window.electronAPI.relaunchApp();
                        } else {
                            window.location.reload();
                        }
                    }, 1000);
                    return; // 不执行后续的关闭窗口操作
                }

                this.showMessage('编辑器设置保存成功！', 'success');


                const fontChanged = newSettings.font || newSettings.fontSize;
                const delay = fontChanged ? 1500 : 1000;

                setTimeout(() => {
                    this.closeWindow();
                }, delay);
            } else {
                const errorMsg = result ? (result.error || '未知错误') : '设置 API 不可用';
                this.showMessage('保存设置失败：' + errorMsg, 'error');
                logError('保存设置失败，详细信息:', {
                    result,
                    electronAPI: !!window.electronAPI,
                    updateSettings: !!(window.electronAPI && window.electronAPI.updateSettings),
                    requireAvailable: typeof require !== 'undefined'
                });
            }

        } catch (error) {
            logError('保存编辑器设置失败:', error);
            this.showMessage('保存设置失败：' + error.message, 'error');
        }
    }

    async resetSettings() {
        try {
            if (window.electronAPI && window.electronAPI.resetSettings) {
                const result = await window.electronAPI.resetSettings();
                if (result.success) {
                    await this.loadSettings();
                    this.updateUI();
                    this.showMessage('编辑器设置已重置为默认值', 'success');
                } else {
                    this.showMessage('重置设置失败：' + (result.error || '未知错误'), 'error');
                }
            } else {
                this.showMessage('设置 API 不可用', 'error');
            }
        } catch (error) {
            logError('重置设置失败:', error);
            this.showMessage('重置设置失败：' + error.message, 'error');
        }
    }

    updateUI() {
        const fontSelect = document.getElementById('editor-font');
        const fontSizeInput = document.getElementById('editor-font-size');
        const themeSelect = document.getElementById('editor-theme');
        const foldingCheckbox = document.getElementById('editor-folding');
        const stickyScrollCheckbox = document.getElementById('editor-sticky-scroll');
        const ligaturesCheckbox = document.getElementById('editor-font-ligatures');
        const tabSizeInput = document.getElementById('editor-tab-size');
        const autoSaveCheckbox = document.getElementById('editor-auto-save-enabled');
        const autoSaveIntervalInput = document.getElementById('editor-auto-save-interval');

        logInfo('更新UI，当前设置:', this.settings);
        logInfo('字体大小输入框:', fontSizeInput, '值:', this.settings.fontSize);

        if (fontSelect && this.settings.font) {
            let fontValue = this.settings.font;
            if (fontValue.includes(',')) {
                fontValue = fontValue.split(',')[0].trim().replace(/["']/g, '');
            }
            const options = Array.from(fontSelect.options);
            const matchingOption = options.find(option => option.value === fontValue);
            if (matchingOption) {
                fontSelect.value = fontValue;
            } else {
                fontSelect.value = 'Consolas';
            }
            logInfo('字体设置已更新:', fontSelect.value);
        }

        if (fontSizeInput && this.settings.fontSize) {
            fontSizeInput.value = this.settings.fontSize;
            logInfo('字体大小已更新:', fontSizeInput.value);
        }

        if (themeSelect && this.settings.theme) {
            themeSelect.value = this.settings.theme;
            logInfo('主题设置已更新:', themeSelect.value);
        }
        if (foldingCheckbox) {
            foldingCheckbox.checked = this.settings.foldingEnabled !== false;
        }
        if (stickyScrollCheckbox) {
            stickyScrollCheckbox.checked = this.settings.stickyScrollEnabled !== false;
        }
        if (ligaturesCheckbox) {
            ligaturesCheckbox.checked = this.settings.fontLigaturesEnabled !== false;
        }
        if (tabSizeInput) {
            const tabSize = Number.isFinite(this.settings.tabSize) ? this.settings.tabSize : 4;
            tabSizeInput.value = tabSize;
        }
        const autoSaveEnabled = this.settings.autoSave !== false;
        if (autoSaveCheckbox) {
            autoSaveCheckbox.checked = autoSaveEnabled;
        }
        if (autoSaveIntervalInput) {
            const intervalMs = Number.isFinite(this.settings.autoSaveInterval) && this.settings.autoSaveInterval > 0 ? this.settings.autoSaveInterval : 60000;
            autoSaveIntervalInput.value = Math.max(1, Math.round(intervalMs / 1000));
            this.toggleAutoSaveInterval(autoSaveIntervalInput, autoSaveEnabled);
        }
    }

    showMessage(message, type = 'info') {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message-toast ${type}`;
        messageDiv.textContent = message;
        messageDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 4px;
            color: white;
            font-weight: bold;
            z-index: 9999;
            opacity: 0;
            transition: opacity 0.3s;
        `;

        switch (type) {
            case 'success':
                messageDiv.style.backgroundColor = '#4CAF50';
                break;
            case 'error':
                messageDiv.style.backgroundColor = '#f44336';
                break;
            default:
                messageDiv.style.backgroundColor = '#2196F3';
        }

        try {
            if (type === 'error') {
                const errObj = message instanceof Error ? message : new Error(String(message));
                logError('[EditorSettingsToastError]', { message: String(message), stack: errObj.stack });
            }
        } catch (_) { }
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
        window.close();
    }
}

window.addEventListener('DOMContentLoaded', async () => {
    const editorSettings = new EditorSettings();
    await editorSettings.init();
});
