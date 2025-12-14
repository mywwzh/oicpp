(function () {
    'use strict';
    document.addEventListener('DOMContentLoaded', async function () {
        try {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                const settings = await window.electronAPI.getAllSettings();
                logInfo('启动时加载的设置:', settings);

                applySettingsToUI(settings);

                if (window.electronIPC && window.electronIPC.on) {
                    window.electronIPC.on('settings-changed', (event, settingsType, newSettings) => {
                        logInfo('收到设置变化通知:', newSettings);
                        applySettingsToUI(newSettings);
                    });

                    window.electronIPC.on('settings-loaded', (event, allSettings) => {
                        logInfo('收到设置加载完成通知:', allSettings);
                        applySettingsToUI(allSettings);
                    });

                    window.electronIPC.on('settings-reset', (event, allSettings) => {
                        logInfo('收到设置重置通知:', allSettings);
                        applySettingsToUI(allSettings);
                    });

                    window.electronIPC.on('settings-imported', (event, allSettings) => {
                        logInfo('收到设置导入通知:', allSettings);
                        applySettingsToUI(allSettings);
                    });
                }
            }
        } catch (error) {
            logError('设置初始化失败:', error);
        }
    });

    function applySettingsToUI(settings) {
        if (!settings) return;

        if (settings.theme) {
            logInfo('应用主题到设置页面:', settings.theme);
            document.body.setAttribute('data-theme', settings.theme);
            document.documentElement.setAttribute('data-theme', settings.theme);
        }

        if (settings.font || settings.fontSize) {
            let fontFamily = settings.font || 'Consolas';
            const fontSize = settings.fontSize || 14;

            if (window.fontDetector && settings.font) {
                const validatedFont = window.fontDetector.validateFont(settings.font);
                if (validatedFont !== settings.font) {
                    fontFamily = validatedFont;
                    if (window.electronAPI && window.electronAPI.updateSettings) {
                        window.electronAPI.updateSettings({ font: validatedFont }).catch(err => {
                            logError('更新字体设置失败:', err);
                        });
                    }
                }
            }

            const editorElements = document.querySelectorAll('.monaco-editor, .monaco-editor-container');
            editorElements.forEach(element => {
                if (settings.font) element.style.fontFamily = fontFamily;
                if (settings.fontSize) element.style.fontSize = fontSize + 'px';
            });

            const breadcrumbEls = document.querySelectorAll('.folder-picker-breadcrumb');
            breadcrumbEls.forEach(el => {
                if (settings.fontSize) el.style.fontSize = fontSize + 'px';
                if (settings.font) el.style.fontFamily = fontFamily;
            });

            document.documentElement.style.setProperty('--editor-font-family', fontFamily);
            document.documentElement.style.setProperty('--editor-font-size', fontSize + 'px');
        }

        if (settings.backgroundImage !== undefined) {
            if (settings.backgroundImage) {
                let bgPath = settings.backgroundImage.replace(/\\/g, '/');
                if (!bgPath.startsWith('http') && !bgPath.startsWith('file://')) {
                    if (bgPath.startsWith('/')) {
                        bgPath = 'file://' + bgPath;
                    } else {
                        bgPath = 'file:///' + bgPath;
                    }
                }
                
                document.body.style.backgroundImage = `url('${bgPath}')`;
                document.body.style.backgroundSize = 'cover';
                document.body.style.backgroundRepeat = 'no-repeat';
                document.body.style.backgroundPosition = 'center';
                document.body.classList.add('has-custom-bg');

                let styleEl = document.getElementById('custom-bg-style');
                if (!styleEl) {
                    styleEl = document.createElement('style');
                    styleEl.id = 'custom-bg-style';
                    document.head.appendChild(styleEl);
                }
                styleEl.textContent = `
                    body.has-custom-bg .main-container,
                    body.has-custom-bg .editor-container,
                    body.has-custom-bg .monaco-editor-container,
                    body.has-custom-bg .editor-group,
                    body.has-custom-bg .editor-area,
                    body.has-custom-bg .monaco-editor,
                    body.has-custom-bg .monaco-editor-background,
                    body.has-custom-bg .monaco-editor .margin {
                        background-color: transparent !important;
                    }
                    
                    body.has-custom-bg .main-container {
                        background-color: transparent !important;
                    }
                    body.has-custom-bg[data-theme="light"] .main-container {
                        background-color: transparent !important;
                    }

                    body.has-custom-bg .editor-container {
                        background-color: rgba(30, 30, 30, 0.85) !important;
                    }
                    body.has-custom-bg[data-theme="light"] .editor-container {
                        background-color: rgba(255, 255, 255, 0.85) !important;
                    }
                    
                    body.has-custom-bg .sidebar {
                        background-color: rgba(37, 37, 38, 0.4) !important;
                    }
                    body.has-custom-bg[data-theme="light"] .sidebar {
                        background-color: rgba(243, 243, 243, 0.4) !important;
                    }

                    body.has-custom-bg .sidebar-icons,
                    body.has-custom-bg .sidebar-panel,
                    body.has-custom-bg .panel-content,
                    body.has-custom-bg .panel-header,
                    body.has-custom-bg .file-tree,
                    body.has-custom-bg .sidebar-resizer {
                        background-color: transparent !important;
                        background: transparent !important;
                    }
                    
                    body.has-custom-bg .samples-content,
                    body.has-custom-bg .compare-content,
                    body.has-custom-bg .debug-content {
                        background-color: transparent !important;
                        background: transparent !important;
                    }
                    
                    body.has-custom-bg .markdown-preview-container,
                    body.has-custom-bg .markdown-body {
                        background-color: transparent !important;
                        background: transparent !important;
                    }
                    
                    body.has-custom-bg .titlebar {
                        background-color: rgba(50, 50, 51, 0.8) !important;
                    }
                    body.has-custom-bg[data-theme="light"] .titlebar {
                        background-color: rgba(243, 243, 243, 0.8) !important;
                    }
                `;
            } else {
                document.body.style.backgroundImage = '';
                document.body.classList.remove('has-custom-bg');
                const styleEl = document.getElementById('custom-bg-style');
                if (styleEl) styleEl.remove();
            }
        }

        const event = new CustomEvent('settings-applied', {
            detail: settings
        });
        document.dispatchEvent(event);
    }

    window.applySettings = applySettingsToUI;
    window.getCurrentSettings = async function () {
        try {
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                return await window.electronAPI.getAllSettings();
            }
            return {};
        } catch (error) {
            logError('获取当前设置失败:', error);
            return {};
        }
    };

    window.updateSettings = async function (newSettings) {
        try {
            if (window.electronAPI && window.electronAPI.updateSettings) {
                const result = await window.electronAPI.updateSettings(newSettings);
                if (result.success) {
                    logInfo('设置更新成功');
                    return true;
                } else {
                    logError('设置更新失败:', result.error);
                    return false;
                }
            }
            return false;
        } catch (error) {
            logError('更新设置失败:', error);
            return false;
        }
    };

    logInfo('设置初始化脚本已加载');
})();
