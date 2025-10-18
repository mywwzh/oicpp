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

            if (settings.theme === 'light') {
                document.documentElement.style.setProperty('--bg-color', '#ffffff');
                document.documentElement.style.setProperty('--text-color', '#333333');
                document.documentElement.style.setProperty('--border-color', '#e1e1e1');
                document.documentElement.style.setProperty('--hover-bg', '#f5f5f5');
            } else {
                document.documentElement.style.setProperty('--bg-color', '#1e1e1e');
                document.documentElement.style.setProperty('--text-color', '#cccccc');
                document.documentElement.style.setProperty('--border-color', '#3c3c3c');
                document.documentElement.style.setProperty('--hover-bg', '#2d2d30');
            }
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
