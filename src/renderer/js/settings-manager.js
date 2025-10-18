class SettingsManager {
    constructor() {
        this.settings = {
            compiler: {
                compilerPath: '',
                compilerOptions: '-std=c++14 -O2 -static',
                installPath: ''
            },
            editor: {
                font: 'Consolas, "Courier New", monospace',
                fontSize: 14,
                theme: 'dark',
                tabSize: 4,
                wordWrap: false,
                enableAutoCompletion: true,
                bracketMatching: true,
                highlightCurrentLine: true
            },
            templates: {
                cppTemplate: '',
                customTemplates: []
            },
            general: {
                autoSave: true,
                autoSaveInterval: 60000,
                showWelcomeScreen: true,
                language: 'zh-cn'
            }
        };

        this.callbacks = new Map(); // 设置变化回调
        this.isInitialized = false;

        this.init();
    }

    async init() {
        try {
            await this.loadSettings();
            this.setupIPC();
            this.isInitialized = true;
            logInfo('设置管理器初始化完成');
        } catch (error) {
            logError('设置管理器初始化失败:', error);
        }
    }

    setupIPC() {
        if (typeof require !== 'undefined') {
            try {
                const { ipcRenderer } = require('electron');

                ipcRenderer.on('settings-changed', (event, settingsType, newSettings) => {
                    this.handleSettingsChange(settingsType, newSettings);
                });

                ipcRenderer.on('all-settings-changed', (event, allSettings) => {
                    this.handleAllSettingsChange(allSettings);
                });

            } catch (error) {
                logWarn('IPC设置监听器初始化失败:', error);
            }
        }
    }

    async loadSettings() {
        try {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                const allSettings = await ipcRenderer.invoke('get-all-settings');
                if (allSettings) {
                    this.settings = this.mergeSettings(this.settings, allSettings);
                    logInfo('从主进程加载设置成功:', this.settings);
                    return;
                }
            }

            const savedSettings = localStorage.getItem('oicpp-all-settings');
            if (savedSettings) {
                this.settings = this.mergeSettings(this.settings, JSON.parse(savedSettings));
                logInfo('从localStorage加载设置成功:', this.settings);
            }

        } catch (error) {
            logError('加载设置失败:', error);
        }
    }

    mergeSettings(defaultSettings, savedSettings) {
        const merged = JSON.parse(JSON.stringify(defaultSettings));

        for (const key in savedSettings) {
            if (savedSettings.hasOwnProperty(key)) {
                if (typeof savedSettings[key] === 'object' && savedSettings[key] !== null && !Array.isArray(savedSettings[key])) {
                    merged[key] = { ...merged[key], ...savedSettings[key] };
                } else {
                    merged[key] = savedSettings[key];
                }
            }
        }
        return merged;
    }

    handleSettingsChange(settingsType, newSettings) {
        if (this.settings[settingsType]) {
            this.settings[settingsType] = { ...this.settings[settingsType], ...newSettings };
        } else {
            this.settings[settingsType] = newSettings;
        }
        localStorage.setItem('oicpp-all-settings', JSON.stringify(this.settings));

        if ((newSettings.font || newSettings.fontSize) && window.monacoEditorManager) {
            logInfo('检测到字体设置变更，通知Monaco编辑器管理器');
            setTimeout(() => {
                window.monacoEditorManager.updateAllEditorsSettings(newSettings);
            }, 50);
        }

        this.triggerCallbacks(settingsType, newSettings);

        logInfo(`设置已更新: ${settingsType}`, newSettings);
    }

    handleAllSettingsChange(allSettings) {
        this.settings = this.mergeSettings(this.settings, allSettings);

        localStorage.setItem('oicpp-all-settings', JSON.stringify(this.settings));

        for (const settingsType in allSettings) {
            this.triggerCallbacks(settingsType, allSettings[settingsType]);
        }

        logInfo('所有设置已更新:', this.settings);
    }

    triggerCallbacks(settingsType, newSettings) {
        const typeCallbacks = this.callbacks.get(settingsType);
        if (typeCallbacks) {
            typeCallbacks.forEach(callback => {
                try {
                    callback(newSettings);
                } catch (error) {
                    logError(`设置回调执行失败 (${settingsType}):`, error);
                }
            });
        }

        const globalCallbacks = this.callbacks.get('*');
        if (globalCallbacks) {
            globalCallbacks.forEach(callback => {
                try {
                    callback(settingsType, newSettings);
                } catch (error) {
                    logError('全局设置回调执行失败:', error);
                }
            });
        }
    }

    onSettingsChange(settingsType, callback) {
        if (!this.callbacks.has(settingsType)) {
            this.callbacks.set(settingsType, []);
        }
        this.callbacks.get(settingsType).push(callback);

        if (this.isInitialized && settingsType !== '*' && this.settings[settingsType]) {
            try {
                callback(this.settings[settingsType]);
            } catch (error) {
                logError('设置回调立即执行失败:', error);
            }
        }
    }

    offSettingsChange(settingsType, callback) {
        const callbacks = this.callbacks.get(settingsType);
        if (callbacks) {
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }

    getSettings(settingsType) {
        if (settingsType) {
            return this.settings[settingsType] || {};
        }
        return this.settings;
    }

    async updateSettings(settingsType, newSettings) {
        try {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                ipcRenderer.send('settings-updated', settingsType, newSettings);
            } else {
                this.handleSettingsChange(settingsType, newSettings);
            }
        } catch (error) {
            logError('更新设置失败:', error);
        }
    }

    async resetSettings(settingsType) {
        try {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                const result = await ipcRenderer.invoke('reset-settings', settingsType);
                return result;
            } else {
                const defaultSettings = this.getDefaultSettings();
                if (settingsType) {
                    this.handleSettingsChange(settingsType, defaultSettings[settingsType]);
                    return { success: true, settings: defaultSettings[settingsType] };
                } else {
                    this.handleAllSettingsChange(defaultSettings);
                    return { success: true, settings: defaultSettings };
                }
            }
        } catch (error) {
            logError('重置设置失败:', error);
            return { success: false, error: error.message };
        }
    }

    getDefaultSettings() {
        return {
            compiler: {
                compilerPath: '',
                compilerOptions: '-std=c++14 -O2 -static',
                installPath: ''
            },
            editor: {
                font: 'Consolas, "Courier New", monospace',
                fontSize: 14,
                theme: 'dark',
                tabSize: 4,
                wordWrap: false,
                autoCompletion: true,
                bracketMatching: true,
                highlightCurrentLine: true
            },
            templates: {
                cppTemplate: '',
                customTemplates: []
            },
            general: {
                autoSave: true,
                autoSaveInterval: 60000,
                showWelcomeScreen: true,
                language: 'zh-cn'
            }
        };
    }
}

if (typeof window !== 'undefined') {
    window.settingsManager = new SettingsManager();
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettingsManager;
}
