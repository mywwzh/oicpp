class UnifiedSettingsManager {
    constructor() {
        this.settings = this.getDefaultSettings();
        this.callbacks = new Map();
        this.isInitialized = false;
    }

    getDefaultSettings() {
        return {
            compilerPath: '',
            compilerArgs: '-std=c++14 -O2 -static',
            font: 'Consolas',
            fontSize: 14,
            theme: 'dark',
            tabSize: 4,
            enableAutoCompletion: true,
            cppTemplate: '',
            autoSave: true,
            autoSaveInterval: 60000,
            markdownMode: 'split',
            lastUpdateCheck: '1970-01-01',
            codeSnippets: [],
            windowOpacity: 1.0,
            backgroundImage: '',
            keybindings: {
                formatCode: 'Alt+Shift+S',
                showFunctionPicker: 'Ctrl+Shift+G',
                markdownPreview: 'Ctrl+Shift+V',
                renameSymbol: 'F2',
                deleteLine: 'Ctrl+D',
                duplicateLine: 'Ctrl+E',
                moveLineUp: 'Ctrl+Shift+Up',
                moveLineDown: 'Ctrl+Shift+Down',
                copy: 'Ctrl+C',
                paste: 'Ctrl+V',
                cut: 'Ctrl+X',
                compileCode: 'F9',
                runCode: 'F10',
                compileAndRun: 'F11',
                toggleDebug: 'F5',
                debugContinue: 'F6',
                debugStepOver: 'F7',
                debugStepInto: 'F8',
                debugStepOut: 'Shift+F8',
                cloudCompile: 'F12'
            }
        };
    }

    async init() {
        try {
            await this.loadSettings();
            this.setupIPC();
            this.isInitialized = true;
            logInfo('统一设置管理器初始化完成');
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
                    logInfo('从主进程加载设置成功');
                    return;
                }
            }
            
            const savedSettings = localStorage.getItem('oicpp-settings');
            if (savedSettings) {
                const parsed = JSON.parse(savedSettings);
                this.settings = this.mergeSettings(this.settings, parsed);
                logInfo('从localStorage加载设置成功');
            }
        } catch (error) {
            logError('加载设置失败:', error);
        }
    }

    mergeSettings(defaultSettings, savedSettings) {
        const merged = { ...defaultSettings };
        for (const [key, value] of Object.entries(savedSettings)) {
            merged[key] = value;
        }
        return merged;
    }

    handleSettingsChange(settingsType, newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        this.triggerCallbacks(settingsType, newSettings);
    }

    handleAllSettingsChange(allSettings) {
        this.settings = this.mergeSettings(this.getDefaultSettings(), allSettings);
        this.triggerCallbacks('all', this.settings);
    }

    triggerCallbacks(settingsType, newSettings) {
        const callbacks = this.callbacks.get(settingsType);
        if (callbacks) {
            callbacks.forEach(callback => {
                try {
                    callback(newSettings);
                } catch (error) {
                    logError('设置回调执行失败:', error);
                }
            });
        }
    }

    onSettingsChange(settingsType, callback) {
        if (!this.callbacks.has(settingsType)) {
            this.callbacks.set(settingsType, new Set());
        }
        this.callbacks.get(settingsType).add(callback);
    }

    offSettingsChange(settingsType, callback) {
        const callbacks = this.callbacks.get(settingsType);
        if (callbacks) {
            callbacks.delete(callback);
        }
    }

    getSettings(settingKey) {
        if (settingKey) {
            return this.settings[settingKey];
        }
        return this.settings;
    }

    async updateSettings(newSettings) {
        try {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                const allowedKeys = new Set([
                    'font','fontSize','theme','tabSize','enableAutoCompletion','foldingEnabled','stickyScrollEnabled','compilerPath','compilerArgs','testlibPath','codeSnippets','cppTemplate','fontLigaturesEnabled','autoSave','autoSaveInterval','windowOpacity','backgroundImage','markdownMode','keybindings'
                ]);
                const filtered = {};
                Object.keys(newSettings || {}).forEach(k=>{ if (allowedKeys.has(k)) filtered[k]=newSettings[k]; });
                const result = await ipcRenderer.invoke('update-settings', filtered);
                if (result && result.success) {
                    this.handleSettingsChange('settings', newSettings);
                    return { success: true };
                }
                return result;
            }
            
            this.handleSettingsChange('settings', newSettings);
            localStorage.setItem('oicpp-settings', JSON.stringify(this.settings));
            return { success: true };
        } catch (error) {
            logError('更新设置失败:', error);
            return { success: false, error: error.message };
        }
    }

    async resetSettings() {
        this.settings = this.getDefaultSettings();
        try {
            if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                const result = await ipcRenderer.invoke('reset-all-settings');
                return result;
            }
            
            localStorage.setItem('oicpp-settings', JSON.stringify(this.settings));
            return { success: true };
        } catch (error) {
            logError('重置设置失败:', error);
            return { success: false, error: error.message };
        }
    }

    getTemplate() {
        return this.settings.cppTemplate || this.getDefaultSettings().cppTemplate;
    }
    async updateTemplate(content) {
        return await this.updateSettings({ cppTemplate: content });
    }
}

let settingsManager = null;

function getSettingsManager() {
    if (!settingsManager) {
        settingsManager = new UnifiedSettingsManager();
    }
    return settingsManager;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        UnifiedSettingsManager,
        getSettingsManager
    };
}

if (typeof window !== 'undefined') {
    window.UnifiedSettingsManager = UnifiedSettingsManager;
    window.getSettingsManager = getSettingsManager;
    window.settingsManager = getSettingsManager();
}