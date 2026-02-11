class BackupSettings {
    constructor() {
        this.settings = {
            autoBackupSettings: false,
            theme: 'dark'
        };
        this._saving = false;
        this.init();
    }

    async init() {
        const urlParams = new URLSearchParams(window.location.search);
        const themeFromUrl = urlParams.get('theme');
        if (themeFromUrl) {
            this.applyTheme(themeFromUrl);
        }
        await this.loadSettings();
        this.setupEventListeners();
        this.setupThemeListener();
        this.updateUI();
        this.latestInfoEl = document.getElementById('latest-backup-info');
        this.refreshLatestBackupInfo();
    }

    setupThemeListener() {
        if (window.electronIPC && window.electronIPC.on) {
            window.electronIPC.on('theme-changed', (_event, theme) => {
                this.applyTheme(theme);
            });
        }

        if (window.electronIPC && window.electronIPC.on) {
            window.electronIPC.on('settings-imported', (_event, allSettings) => {
                if (allSettings && typeof allSettings.autoBackupSettings === 'boolean') {
                    this.settings.autoBackupSettings = allSettings.autoBackupSettings;
                    this.updateUI();
                }
            });
        }
    }

    applyTheme(theme) {
        this.settings.theme = theme || 'dark';
        document.body.setAttribute('data-theme', this.settings.theme);
        document.documentElement.setAttribute('data-theme', this.settings.theme);
    }

    setupEventListeners() {
        const saveBtn = document.getElementById('save-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveSettings();
            });
        }

        const cancelBtn = document.getElementById('cancel-settings');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', () => {
                window.close();
            });
        }

        const backupBtn = document.getElementById('backup-now');
        if (backupBtn) {
            backupBtn.addEventListener('click', async () => {
                await this.backupNow();
            });
        }

        const syncBtn = document.getElementById('sync-settings');
        if (syncBtn) {
            syncBtn.addEventListener('click', async () => {
                await this.syncFromCloud();
            });
        }
    }

    async loadSettings() {
        try {
            let allSettings = null;
            if (window.electronAPI && window.electronAPI.getAllSettings) {
                allSettings = await window.electronAPI.getAllSettings();
            } else if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                allSettings = await ipcRenderer.invoke('get-all-settings');
            }

            if (allSettings) {
                this.settings.autoBackupSettings = allSettings.autoBackupSettings === true;
                if (allSettings.theme) {
                    this.applyTheme(allSettings.theme);
                }
            }
        } catch (error) {
            logError('加载设置备份配置失败:', error);
        }
    }

    updateUI() {
        const autoBackupCheckbox = document.getElementById('auto-backup-settings');
        if (autoBackupCheckbox) {
            autoBackupCheckbox.checked = this.settings.autoBackupSettings === true;
        }
    }

    updateLatestInfoText(text) {
        if (this.latestInfoEl) {
            this.latestInfoEl.textContent = text;
        }
    }

    async refreshLatestBackupInfo() {
        if (!this.latestInfoEl) return;
        if (!window.electronAPI?.getSettingsBackupInfo) {
            this.updateLatestInfoText('最近备份：--');
            return;
        }
        const result = await window.electronAPI.getSettingsBackupInfo();
        if (!result || !result.success) {
            const error = result?.error || 'UNKNOWN';
            if (error === 'NOT_LOGGED_IN') {
                this.updateLatestInfoText('最近备份：未登录');
            } else if (error === 'NO_BACKUP') {
                this.updateLatestInfoText('最近备份：暂无');
            } else {
                this.updateLatestInfoText('最近备份：获取失败');
            }
            return;
        }

        const info = result.info || {};
        const timeLabel = info.displayTime || info.timestampRaw || '未知时间';
        const deviceName = info.deviceName || '未知设备';
        this.updateLatestInfoText(`最近备份：${timeLabel}（${deviceName}）`);
    }

    collectSettings() {
        const autoBackupCheckbox = document.getElementById('auto-backup-settings');
        return {
            autoBackupSettings: !!autoBackupCheckbox?.checked
        };
    }

    async saveSettings() {
        if (this._saving) return;
        this._saving = true;
        try {
            const newSettings = this.collectSettings();
            let result = null;
            if (window.electronAPI && window.electronAPI.updateSettings) {
                result = await window.electronAPI.updateSettings(newSettings);
            } else if (typeof require !== 'undefined') {
                const { ipcRenderer } = require('electron');
                result = await ipcRenderer.invoke('update-settings', newSettings);
            }

            if (result && result.success) {
                this.settings.autoBackupSettings = newSettings.autoBackupSettings;
                this.showMessage('设置备份设置已保存', 'success');
                if (newSettings.autoBackupSettings) {
                    await this.backupNow(true);
                }
            } else {
                const errorMsg = result?.error || '未知错误';
                this.showMessage('保存设置失败：' + errorMsg, 'error');
            }
        } catch (error) {
            this.showMessage('保存设置失败：' + error.message, 'error');
        } finally {
            this._saving = false;
        }
    }

    async backupNow(silent = false) {
        if (!window.electronAPI?.backupSettingsToCloud) {
            if (!silent) this.showMessage('备份功能不可用', 'error');
            return false;
        }

        const result = await window.electronAPI.backupSettingsToCloud();
        if (!result || !result.success) {
            const error = result?.error || '备份失败';
            if (error === 'NOT_LOGGED_IN') {
                this.showMessage('请先登录', 'warning');
            } else if (error === 'NO_SETTINGS') {
                if (!silent) this.showMessage('没有可备份的设置', 'warning');
            } else {
                if (!silent) this.showMessage(`备份设置失败：${error}`, 'error');
            }
            return false;
        }

        if (!silent) {
            this.showMessage('设置已备份到云空间', 'success');
        }
        this.refreshLatestBackupInfo();
        return true;
    }

    async syncFromCloud() {
        if (!window.electronAPI?.getSettingsBackupInfo || !window.electronAPI?.syncSettingsFromCloud) {
            this.showMessage('同步功能不可用', 'error');
            return false;
        }

        const infoResult = await window.electronAPI.getSettingsBackupInfo();
        if (!infoResult || !infoResult.success) {
            logInfo('获取云端备份信息失败:', infoResult);
            const error = infoResult?.error || '同步失败';
            if (error === 'NOT_LOGGED_IN') {
                this.showMessage('请先登录', 'warning');
            } else if (error === 'NO_BACKUP') {
                this.showMessage('云空间没有找到备份', 'warning');
            } else {
                this.showMessage('获取云端备份失败', 'error');
            }
            return false;
        }

        const info = infoResult.info || {};
        const timeLabel = info.displayTime || info.timestampRaw || '未知时间';
        const deviceName = info.deviceName || '未知设备';
        const confirmText = `是否使用${timeLabel}在${deviceName}上备份的设置文件覆盖当前设置？`;
        const confirmed = await this.confirmDialog('同步设置', confirmText);
        if (!confirmed) {
            return false;
        }

        const syncResult = await window.electronAPI.syncSettingsFromCloud();
        if (!syncResult || !syncResult.success) {
            const error = syncResult?.error || '同步失败';
            if (error === 'NOT_LOGGED_IN') {
                this.showMessage('请先登录', 'warning');
            } else if (error === 'NO_BACKUP') {
                this.showMessage('云空间没有找到备份', 'warning');
            } else if (error === 'EMPTY_BACKUP') {
                this.showMessage('恢复失败：EMPTY_BACKUP', 'error');
            } else if (error === 'INVALID_BACKUP') {
                this.showMessage('云端备份文件格式无效', 'error');
            } else {
                this.showMessage(`同步设置失败：${error}`, 'error');
            }
            return false;
        }

        await this.loadSettings();
        this.updateUI();
        this.showMessage('已从云空间同步设置', 'success');
        this.refreshLatestBackupInfo();
        return true;
    }

    async confirmDialog(title, message) {
        if (window.dialogManager?.showConfirmDialog) {
            return await window.dialogManager.showConfirmDialog(title, message);
        }
        return window.confirm(message);
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
}

window.addEventListener('DOMContentLoaded', () => {
    new BackupSettings();
});
