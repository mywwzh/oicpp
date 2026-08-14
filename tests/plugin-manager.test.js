const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const PluginManager = require('../src/plugin-manager');

function createFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oicpp-plugins-'));
    const userRoot = path.join(root, 'user');
    const bundledRoot = path.join(root, 'bundled');
    fs.mkdirSync(userRoot, { recursive: true });
    fs.mkdirSync(bundledRoot, { recursive: true });
    return {
        root,
        userRoot,
        bundledRoot,
        statePath: path.join(root, 'plugin-state.json')
    };
}

function writePlugin(root, folder, manifest, source = 'module.exports = { activate() {} };') {
    const pluginRoot = path.join(root, folder);
    fs.mkdirSync(pluginRoot, { recursive: true });
    fs.writeFileSync(path.join(pluginRoot, 'plugin.json'), JSON.stringify(manifest), 'utf8');
    fs.writeFileSync(path.join(pluginRoot, 'index.js'), source, 'utf8');
}

test('discovers valid plugins and returns runtime source', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    writePlugin(fixture.userRoot, 'hello', {
        id: 'sample.hello',
        name: 'Hello',
        version: '1.0.0',
        main: 'index.js'
    });

    const manager = new PluginManager(fixture);
    assert.equal(manager.list().length, 1);
    assert.equal(manager.list()[0].enabled, true);
    assert.match(manager.getRuntimePlugins()[0].source, /activate/);
});

test('rejects entry paths outside the plugin directory', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    writePlugin(fixture.userRoot, 'escape', {
        id: 'sample.escape',
        name: 'Escape',
        main: '../index.js'
    });

    const plugin = new PluginManager(fixture).list()[0];
    assert.equal(plugin.valid, false);
    assert.match(plugin.error, /inside the plugin directory/);
});

test('persists enabled state', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    writePlugin(fixture.userRoot, 'hello', {
        id: 'sample.hello',
        name: 'Hello',
        main: 'index.js'
    });

    const manager = new PluginManager(fixture);
    manager.setEnabled('sample.hello', false);
    const reloaded = new PluginManager(fixture);
    assert.equal(reloaded.list()[0].enabled, false);
    assert.equal(reloaded.getRuntimePlugins().length, 0);
});

test('reports duplicate ids without loading the duplicate', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    const manifest = { id: 'sample.same', name: 'Same', main: 'index.js' };
    writePlugin(fixture.userRoot, 'first', manifest);
    writePlugin(fixture.bundledRoot, 'second', manifest);

    const plugins = new PluginManager(fixture).list();
    assert.equal(plugins.filter((plugin) => plugin.valid).length, 1);
    assert.match(plugins.find((plugin) => !plugin.valid).error, /Duplicate plugin id/);
});

test('skips an oversized entry without blocking other plugins', (t) => {
    const fixture = createFixture();
    t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
    writePlugin(fixture.userRoot, 'large', {
        id: 'sample.large',
        name: 'Large',
        main: 'index.js'
    }, `${'x'.repeat(2 * 1024 * 1024)}\n`);
    writePlugin(fixture.userRoot, 'small', {
        id: 'sample.small',
        name: 'Small',
        main: 'index.js'
    });

    const manager = new PluginManager({ ...fixture, logger: { warn() {} } });
    assert.deepEqual(manager.getRuntimePlugins().map((plugin) => plugin.id), ['sample.small']);
});
