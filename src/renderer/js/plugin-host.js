(function () {
    'use strict';

    const API_VERSION = 1;

    class OICPPPluginHost {
        constructor() {
            this.commands = new Map();
            this.plugins = new Map();
            this.disposables = new Map();
            this.statusItems = new Map();
            this.loadingPluginId = null;
            this.initialized = false;
        }

        t(key, fallback) {
            const value = window.i18n?.t?.(key);
            return value && value !== key ? value : fallback;
        }

        async init() {
            if (this.initialized) return;
            this.initialized = true;
            await this.reload();
        }

        async reload() {
            await this.deactivateAll();
            this.commands.clear();
            this.plugins.clear();
            this.renderPluginCommands([]);

            if (!window.electronAPI?.getRuntimePlugins) {
                this.showMessage(this.t('plugins.apiUnavailable', 'Plugin API is unavailable'), 'error');
                return;
            }

            let runtimePlugins = [];
            try {
                runtimePlugins = await window.electronAPI.getRuntimePlugins();
            } catch (error) {
                this.showMessage(`${this.t('plugins.loadFailed', 'Failed to load plugins')}: ${error?.message || error}`, 'error');
                return;
            }

            for (const plugin of runtimePlugins) {
                await this.activatePlugin(plugin);
            }
            this.renderPluginCommands(runtimePlugins.filter((plugin) => this.plugins.has(plugin.id)));
        }

        async activatePlugin(plugin) {
            const pluginId = plugin.id;
            const module = { exports: {} };
            const subscriptions = [];
            this.loadingPluginId = pluginId;

            try {
                const factory = new Function('module', 'exports', 'oicpp', `${plugin.source}\n//# sourceURL=oicpp-plugin://${pluginId}/${plugin.main}`);
                const api = this.createApi(plugin, subscriptions);
                factory(module, module.exports, api);
                const exported = module.exports || {};
                if (typeof exported.activate === 'function') {
                    await exported.activate(api);
                }
                this.plugins.set(pluginId, { manifest: plugin, exported });
                this.disposables.set(pluginId, subscriptions);
                logInfo(`[Plugins] Activated ${pluginId}`);
            } catch (error) {
                this.disposeAll(subscriptions);
                logError(`[Plugins] Failed to activate ${pluginId}`, error);
                this.showMessage(`${plugin.name}: ${error?.message || error}`, 'error');
            } finally {
                this.loadingPluginId = null;
            }
        }

        createApi(plugin, subscriptions) {
            const registerDisposables = (...disposables) => {
                for (const disposable of disposables) {
                    if (!disposable || typeof disposable.dispose !== 'function') {
                        throw new Error('subscriptions only accepts objects with dispose()');
                    }
                    if (!subscriptions.includes(disposable)) subscriptions.push(disposable);
                }
                return disposables[0];
            };

            const ui = Object.freeze({
                showMessage: (message, type = 'info') => this.showMessage(message, type),
                setStatusBarText: (text, options = {}) => {
                    const disposable = this.setStatusBarText(plugin.id, text, options);
                    return registerDisposables(disposable);
                },
                clearStatusBarText: () => this.clearStatusBarText(plugin.id)
            });

            const getActiveDocument = () => this.getActiveDocument();

            return Object.freeze({
                apiVersion: API_VERSION,
                app: Object.freeze({
                    version: String(plugin.appVersion || ''),
                    getVersion: () => String(plugin.appVersion || ''),
                    getLocale: () => window.i18n?.getCurrentLanguage?.() || 'zh-cn'
                }),
                plugin: Object.freeze({
                    id: plugin.id,
                    name: plugin.name,
                    version: plugin.version,
                    builtin: !!plugin.builtin
                }),
                subscriptions: Object.freeze({ push: registerDisposables }),
                commands: Object.freeze({
                    registerCommand: (commandId, handler, metadata = {}) => {
                        this.assertPluginCommand(plugin.id, commandId);
                        if (typeof handler !== 'function') throw new Error('command handler must be a function');
                        if (this.commands.has(commandId)) throw new Error(`command is already registered: ${commandId}`);
                        this.commands.set(commandId, { pluginId: plugin.id, handler, metadata });
                        return registerDisposables({ dispose: () => this.commands.delete(commandId) });
                    },
                    executeCommand: (commandId, ...args) => this.executeCommand(commandId, ...args)
                }),
                workspace: Object.freeze({
                    getActiveFilePath: () => window.oicppApp?.getActiveFilePath?.() || null,
                    getText: () => window.oicppApp?.editorManager?.currentEditor?.getValue?.() || '',
                    getSelectedText: () => window.tabManager?.getSelectedText?.() || '',
                    getActiveDocument,
                    insertText: (text) => window.tabManager?.insertText?.(String(text ?? '')),
                    replaceText: (text) => {
                        const editor = window.oicppApp?.editorManager?.currentEditor;
                        if (!editor?.setValue) return false;
                        editor.setValue(String(text ?? ''));
                        return true;
                    }
                }),
                window: ui,
                ui,
                env: Object.freeze({
                    openExternal: (url) => window.electronAPI?.openExternal?.(String(url || ''))
                }),
                storage: Object.freeze({
                    get: (key, fallback = null) => this.storageGet(plugin.id, key, fallback),
                    set: (key, value) => this.storageSet(plugin.id, key, value),
                    delete: (key) => this.storageDelete(plugin.id, key)
                }),
                log: Object.freeze({
                    info: (...args) => logInfo(`[Plugin:${plugin.id}]`, ...args),
                    warn: (...args) => logWarn(`[Plugin:${plugin.id}]`, ...args),
                    error: (...args) => logError(`[Plugin:${plugin.id}]`, ...args)
                })
            });
        }

        assertPluginCommand(pluginId, commandId) {
            if (typeof commandId !== 'string' || !commandId.startsWith(`${pluginId}.`)) {
                throw new Error(`command id must start with "${pluginId}."`);
            }
        }

        async executeCommand(commandId, ...args) {
            const command = this.commands.get(commandId);
            if (!command) {
                this.showMessage(`${this.t('plugins.commandMissing', 'Plugin command is unavailable')}: ${commandId}`, 'warning');
                return undefined;
            }
            try {
                return await command.handler(...args);
            } catch (error) {
                logError(`[Plugins] Command failed: ${commandId}`, error);
                this.showMessage(`${commandId}: ${error?.message || error}`, 'error');
                return undefined;
            }
        }

        renderPluginCommands(plugins) {
            const container = document.getElementById('plugin-command-items');
            const empty = document.getElementById('plugin-command-empty');
            if (!container) return;
            container.replaceChildren();

            const items = [];
            for (const plugin of plugins) {
                const commandTitles = new Map((plugin.contributes?.commands || []).map((item) => [item.command, item.title]));
                const configuredMenuItems = plugin.contributes?.menus?.plugins || [];
                const menuItems = configuredMenuItems.length
                    ? configuredMenuItems
                    : (plugin.contributes?.commands || []).map((command) => ({ command: command.command, group: '' }));
                for (const menuItem of menuItems) {
                    items.push({
                        plugin,
                        command: menuItem.command,
                        title: commandTitles.get(menuItem.command) || menuItem.command,
                        group: menuItem.group || ''
                    });
                }
            }
            items.sort((left, right) => left.group.localeCompare(right.group) || left.title.localeCompare(right.title));

            for (const item of items) {
                const element = document.createElement('div');
                element.className = 'menu-dropdown-item plugin-command-item';
                element.dataset.pluginCommand = item.command;
                const title = document.createElement('span');
                title.textContent = item.title;
                const pluginName = document.createElement('span');
                pluginName.className = 'menu-shortcut';
                pluginName.textContent = item.plugin.name;
                element.append(title, pluginName);
                element.addEventListener('click', (event) => {
                    event.stopPropagation();
                    this.executeCommand(item.command);
                });
                container.appendChild(element);
            }

            if (empty) empty.style.display = items.length ? 'none' : 'flex';
        }

        async showManager() {
            let plugins = [];
            try {
                plugins = await window.electronAPI.listPlugins();
            } catch (error) {
                this.showMessage(`${this.t('plugins.listFailed', 'Failed to list plugins')}: ${error?.message || error}`, 'error');
                return;
            }

            document.querySelector('.plugin-manager-overlay')?.remove();
            const overlay = document.createElement('div');
            overlay.className = 'plugin-manager-overlay';
            const dialog = document.createElement('section');
            dialog.className = 'plugin-manager-dialog';
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('aria-modal', 'true');

            const header = document.createElement('header');
            header.className = 'plugin-manager-header';
            const heading = document.createElement('div');
            const title = document.createElement('h2');
            title.textContent = this.t('plugins.managerTitle', 'Plugin Manager');
            const description = document.createElement('p');
            description.textContent = this.t('plugins.managerDescription', 'Enable or disable locally installed plugins.');
            heading.append(title, description);
            const close = document.createElement('button');
            close.className = 'plugin-manager-close';
            close.type = 'button';
            close.title = this.t('dialog.close', 'Close');
            close.setAttribute('aria-label', close.title);
            close.textContent = '\u00d7';
            header.append(heading, close);

            const list = document.createElement('div');
            list.className = 'plugin-manager-list';
            if (!plugins.length) {
                const empty = document.createElement('p');
                empty.className = 'plugin-manager-empty';
                empty.textContent = this.t('plugins.noneInstalled', 'No plugins are installed.');
                list.appendChild(empty);
            }

            for (const plugin of plugins) {
                list.appendChild(this.createPluginRow(plugin));
            }

            const footer = document.createElement('footer');
            footer.className = 'plugin-manager-footer';
            const openFolder = document.createElement('button');
            openFolder.type = 'button';
            openFolder.textContent = this.t('plugins.openFolder', 'Open Plugin Folder');
            const reload = document.createElement('button');
            reload.type = 'button';
            reload.className = 'primary';
            reload.textContent = this.t('plugins.reload', 'Reload Plugins');
            footer.append(openFolder, reload);

            dialog.append(header, list, footer);
            overlay.appendChild(dialog);
            document.body.appendChild(overlay);

            const dismiss = () => overlay.remove();
            close.addEventListener('click', dismiss);
            overlay.addEventListener('click', (event) => {
                if (event.target === overlay) dismiss();
            });
            openFolder.addEventListener('click', () => window.electronAPI.openPluginsDirectory());
            reload.addEventListener('click', async () => {
                reload.disabled = true;
                await this.reload();
                dismiss();
                this.showMessage(this.t('plugins.reloaded', 'Plugins reloaded'), 'success');
            });
        }

        createPluginRow(plugin) {
            const row = document.createElement('article');
            row.className = `plugin-manager-row${plugin.valid ? '' : ' invalid'}`;
            const details = document.createElement('div');
            details.className = 'plugin-manager-details';
            const titleLine = document.createElement('div');
            titleLine.className = 'plugin-manager-title-line';
            const name = document.createElement('strong');
            name.textContent = plugin.name;
            const version = document.createElement('span');
            version.textContent = plugin.version ? `v${plugin.version}` : '';
            titleLine.append(name, version);
            if (plugin.builtin) {
                const badge = document.createElement('span');
                badge.className = 'plugin-manager-badge';
                badge.textContent = this.t('plugins.builtin', 'Built-in');
                titleLine.appendChild(badge);
            }
            const description = document.createElement('p');
            description.textContent = plugin.error || plugin.description || plugin.id;
            details.append(titleLine, description);
            row.appendChild(details);

            const toggle = document.createElement('input');
            toggle.type = 'checkbox';
            toggle.className = 'plugin-manager-toggle';
            toggle.checked = !!plugin.enabled;
            toggle.disabled = !plugin.valid;
            toggle.title = plugin.enabled
                ? this.t('plugins.disable', 'Disable plugin')
                : this.t('plugins.enable', 'Enable plugin');
            toggle.addEventListener('change', async () => {
                toggle.disabled = true;
                try {
                    await window.electronAPI.setPluginEnabled(plugin.id, toggle.checked);
                    await this.reload();
                    this.showMessage(this.t('plugins.restartNotRequired', 'Plugin state applied'), 'success');
                } catch (error) {
                    toggle.checked = !toggle.checked;
                    this.showMessage(error?.message || error, 'error');
                } finally {
                    toggle.disabled = false;
                }
            });
            row.appendChild(toggle);
            return row;
        }

        storageKey(pluginId, key) {
            if (typeof key !== 'string' || !key.trim()) throw new Error('storage key must be a non-empty string');
            return `oicpp.plugin.${pluginId}.${key}`;
        }

        storageGet(pluginId, key, fallback) {
            const raw = localStorage.getItem(this.storageKey(pluginId, key));
            if (raw === null) return fallback;
            try { return JSON.parse(raw); } catch (_) { return fallback; }
        }

        storageSet(pluginId, key, value) {
            localStorage.setItem(this.storageKey(pluginId, key), JSON.stringify(value));
            return value;
        }

        storageDelete(pluginId, key) {
            localStorage.removeItem(this.storageKey(pluginId, key));
        }

        showMessage(message, type = 'info') {
            const allowed = new Set(['info', 'success', 'warning', 'error']);
            window.oicppApp?.showMessage?.(String(message ?? ''), allowed.has(type) ? type : 'info');
        }

        getActiveDocument() {
            const editorManager = window.oicppApp?.editorManager;
            const editor = editorManager?.currentEditor;
            if (!editor?.getValue) return null;
            const filePath = window.oicppApp?.getActiveFilePath?.() || null;
            const name = editor.fileName
                || editorManager.currentFileName
                || (filePath ? String(filePath).split(/[\\/]/).pop() : '')
                || 'untitled';
            const languageId = editor.getModel?.()?.getLanguageId?.()
                || editorManager.getLanguageFromFileName?.(name)
                || '';
            return {
                filePath,
                name,
                languageId,
                content: editor.getValue(),
                selectionText: window.tabManager?.getSelectedText?.() || ''
            };
        }

        setStatusBarText(pluginId, text, options = {}) {
            this.clearStatusBarText(pluginId);
            const alignment = options.alignment === 'left' ? 'left' : 'right';
            const target = document.querySelector(alignment === 'left' ? '.status-left' : '.status-right');
            if (!target) throw new Error('status bar is unavailable');

            const element = document.createElement('span');
            element.className = 'status-item plugin-status-item';
            element.dataset.pluginId = pluginId;
            element.textContent = String(text ?? '');
            element.title = String(options.tooltip || text || '');
            const priority = Number(options.priority);
            if (Number.isFinite(priority)) element.style.order = String(-priority);
            if (typeof options.command === 'string' && options.command) {
                element.classList.add('clickable');
                element.addEventListener('click', () => this.executeCommand(options.command));
            }
            target.appendChild(element);
            this.statusItems.set(pluginId, element);

            return {
                dispose: () => {
                    if (this.statusItems.get(pluginId) === element) this.statusItems.delete(pluginId);
                    element.remove();
                }
            };
        }

        clearStatusBarText(pluginId) {
            const element = this.statusItems.get(pluginId);
            if (!element) return false;
            this.statusItems.delete(pluginId);
            element.remove();
            return true;
        }

        disposeAll(disposables) {
            for (const disposable of [...disposables].reverse()) {
                try { disposable.dispose(); } catch (error) { logWarn('[Plugins] Dispose failed', error); }
            }
        }

        async deactivateAll() {
            for (const [pluginId, plugin] of this.plugins) {
                try {
                    if (typeof plugin.exported?.deactivate === 'function') {
                        await plugin.exported.deactivate();
                    }
                } catch (error) {
                    logWarn(`[Plugins] Failed to deactivate ${pluginId}`, error);
                }
                this.disposeAll(this.disposables.get(pluginId) || []);
                this.clearStatusBarText(pluginId);
            }
            this.disposables.clear();
        }
    }

    window.oicppPluginHost = new OICPPPluginHost();
})();
