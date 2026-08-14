const fs = require('fs');
const path = require('path');

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const MAX_PLUGIN_SOURCE_BYTES = 2 * 1024 * 1024;

class PluginManager {
    constructor(options = {}) {
        this.appVersion = String(options.appVersion || '0.0.0');
        this.userRoot = path.resolve(options.userRoot || path.join(process.cwd(), '.oicpp', 'plugins'));
        this.bundledRoot = options.bundledRoot ? path.resolve(options.bundledRoot) : null;
        this.statePath = path.resolve(options.statePath || path.join(path.dirname(this.userRoot), 'plugin-state.json'));
        this.logger = options.logger || console;
        this.ensureUserRoot();
        this.state = this.loadState();
    }

    ensureUserRoot() {
        fs.mkdirSync(this.userRoot, { recursive: true });
    }

    loadState() {
        try {
            if (!fs.existsSync(this.statePath)) {
                return { disabled: [] };
            }
            const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
            return {
                disabled: Array.isArray(parsed.disabled)
                    ? parsed.disabled.filter((id) => typeof id === 'string')
                    : []
            };
        } catch (error) {
            this.logger.warn?.('[Plugins] Failed to read plugin state:', error?.message || error);
            return { disabled: [] };
        }
    }

    saveState() {
        fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
        const temporaryPath = `${this.statePath}.tmp`;
        fs.writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
        fs.renameSync(temporaryPath, this.statePath);
    }

    getRoots() {
        const roots = [{ path: this.userRoot, builtin: false }];
        if (this.bundledRoot && this.bundledRoot !== this.userRoot) {
            roots.push({ path: this.bundledRoot, builtin: true });
        }
        return roots;
    }

    discover() {
        const plugins = [];
        const seenIds = new Set();

        for (const root of this.getRoots()) {
            if (!fs.existsSync(root.path)) continue;

            let entries = [];
            try {
                entries = fs.readdirSync(root.path, { withFileTypes: true });
            } catch (error) {
                plugins.push(this.createInvalidPlugin(root, path.basename(root.path), error));
                continue;
            }

            for (const entry of entries) {
                if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
                const pluginRoot = path.join(root.path, entry.name);
                const plugin = this.readPlugin(pluginRoot, root.builtin, entry.name);

                if (plugin.valid && seenIds.has(plugin.id)) {
                    plugin.valid = false;
                    plugin.error = `Duplicate plugin id: ${plugin.id}`;
                } else if (plugin.valid) {
                    seenIds.add(plugin.id);
                }
                plugins.push(plugin);
            }
        }

        return plugins.sort((left, right) => left.name.localeCompare(right.name));
    }

    readPlugin(pluginRoot, builtin, folderName) {
        const manifestPath = path.join(pluginRoot, 'plugin.json');
        try {
            if (!fs.existsSync(manifestPath)) {
                throw new Error('plugin.json is missing');
            }

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const id = String(manifest.id || '').trim();
            if (!PLUGIN_ID_PATTERN.test(id)) {
                throw new Error('id must match /^[a-z0-9][a-z0-9._-]{1,63}$/');
            }

            const main = String(manifest.main || 'index.js').trim();
            const entryPath = this.resolvePluginFile(pluginRoot, main);
            if (path.extname(entryPath).toLowerCase() !== '.js') {
                throw new Error('main must point to a .js file');
            }
            if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
                throw new Error(`entry file not found: ${main}`);
            }

            return {
                id,
                name: String(manifest.name || id),
                version: String(manifest.version || '0.0.0'),
                description: String(manifest.description || ''),
                author: this.normalizeAuthor(manifest.author),
                main,
                contributes: this.normalizeContributes(manifest.contributes),
                engines: this.normalizeEngines(manifest.engines),
                builtin,
                enabled: !this.state.disabled.includes(id),
                valid: true,
                error: '',
                folderName,
                pluginRoot,
                entryPath
            };
        } catch (error) {
            return this.createInvalidPlugin({ path: path.dirname(pluginRoot), builtin }, folderName, error);
        }
    }

    resolvePluginFile(pluginRoot, relativePath) {
        if (!relativePath || path.isAbsolute(relativePath)) {
            throw new Error('main must be a relative path');
        }
        const resolvedRoot = path.resolve(pluginRoot);
        const resolvedFile = path.resolve(resolvedRoot, relativePath);
        const relative = path.relative(resolvedRoot, resolvedFile);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
            throw new Error('main must stay inside the plugin directory');
        }
        return resolvedFile;
    }

    normalizeAuthor(author) {
        if (typeof author === 'string') return author;
        if (author && typeof author === 'object') return String(author.name || '');
        return '';
    }

    normalizeEngines(engines) {
        if (!engines || typeof engines !== 'object') return {};
        return { oicpp: typeof engines.oicpp === 'string' ? engines.oicpp : '' };
    }

    normalizeContributes(contributes) {
        const commands = Array.isArray(contributes?.commands)
            ? contributes.commands
                .filter((item) => item && typeof item.command === 'string' && typeof item.title === 'string')
                .map((item) => ({ command: item.command, title: item.title }))
            : [];
        const pluginMenu = Array.isArray(contributes?.menus?.plugins)
            ? contributes.menus.plugins
                .filter((item) => item && typeof item.command === 'string')
                .map((item) => ({ command: item.command, group: String(item.group || '') }))
            : [];
        return { commands, menus: { plugins: pluginMenu } };
    }

    createInvalidPlugin(root, folderName, error) {
        return {
            id: '',
            name: folderName,
            version: '',
            description: '',
            author: '',
            main: '',
            contributes: { commands: [], menus: { plugins: [] } },
            engines: {},
            builtin: !!root.builtin,
            enabled: false,
            valid: false,
            error: error?.message || String(error),
            folderName,
            pluginRoot: path.join(root.path, folderName),
            entryPath: ''
        };
    }

    toPublicPlugin(plugin) {
        const { pluginRoot, entryPath, ...publicPlugin } = plugin;
        return publicPlugin;
    }

    list() {
        return this.discover().map((plugin) => this.toPublicPlugin(plugin));
    }

    getRuntimePlugins() {
        const runtimePlugins = [];
        for (const plugin of this.discover()) {
            if (!plugin.valid || !plugin.enabled) continue;
            try {
                const stat = fs.statSync(plugin.entryPath);
                if (stat.size > MAX_PLUGIN_SOURCE_BYTES) {
                    throw new Error(`Plugin ${plugin.id} exceeds the 2 MB source limit`);
                }
                runtimePlugins.push({
                    ...this.toPublicPlugin(plugin),
                    appVersion: this.appVersion,
                    source: fs.readFileSync(plugin.entryPath, 'utf8')
                });
            } catch (error) {
                this.logger.warn?.(`[Plugins] Skipping ${plugin.id}:`, error?.message || error);
            }
        }
        return runtimePlugins;
    }

    setEnabled(id, enabled) {
        const plugin = this.discover().find((item) => item.valid && item.id === id);
        if (!plugin) {
            throw new Error(`Plugin not found: ${id}`);
        }

        const disabled = new Set(this.state.disabled);
        if (enabled) disabled.delete(id);
        else disabled.add(id);
        this.state.disabled = Array.from(disabled).sort();
        this.saveState();
        return this.toPublicPlugin({ ...plugin, enabled: !!enabled });
    }
}

module.exports = PluginManager;
module.exports.PLUGIN_ID_PATTERN = PLUGIN_ID_PATTERN;
