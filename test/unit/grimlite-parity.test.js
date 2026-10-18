// The parity plugin scaffold (spec #19): it loads as a bundled plugin, boots the app with a
// local placeholder page because nothing game-specific is wired yet, and contributes its own
// menu entry and one feature window.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const platform = require('../../res/platform');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const PLACEHOLDER_ID = 'grimlite-parity-placeholder';

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
}

test('the parity plugin manifest validates on this app and declares apiVersion 2', () => {
  const raw = manifest();
  const result = platform.manifestSchema.validateManifest(raw, { appVersion: appVersion });
  assert.strictEqual(result.ok, true, (result.errors || []).join('; '));
  assert.strictEqual(raw.apiVersion, 2);
  assert.ok(
    platform.manifestSchema.SUPPORTED_API_VERSIONS.indexOf(raw.apiVersion) !== -1,
    'the app must support the api version the plugin declares'
  );
  ['game-bridge', 'packet-tap', 'packet-send'].forEach(function (permission) {
    assert.ok(raw.permissions.indexOf(permission) !== -1, 'manifest must declare ' + permission);
  });
});

test('the parity plugin is discovered as a bundled plugin and activates', async () => {
  const discovered = platform.discoverPlugins({
    bundledDir: path.join(repoRoot, 'plugins'),
    appVersion: appVersion,
    log: function () {}
  });
  const plugin = discovered.plugins.filter(function (p) {
    return p.manifest.id === 'grimlite-parity';
  })[0];
  assert.ok(plugin, 'bundled parity plugin not discovered: ' + discovered.errors.join('; '));
  assert.strictEqual(plugin.source, 'bundled');

  const opened = [];
  const activated = await platform.activatePlugin(plugin, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: {
      openFeatureWindow: function (id) {
        opened.push(id);
        return {};
      }
    }
  });

  const state = activated.host._getState();

  // The app quits without a primary URL, so the scaffold boots a local page of its own.
  const primaryUrl = state.primaryGame.getUrl();
  assert.ok(primaryUrl.indexOf('file://') === 0, 'primary surface must be a local page');
  assert.strictEqual(state.primaryGame.isGameUrl(primaryUrl), true);
  assert.strictEqual(state.primaryGame.isGameUrl('https://example.com/other'), false);
  assert.ok(primaryUrl.indexOf(pluginRoot.replace(/\\/g, '/')) !== -1);

  // One feature window, in the app's window conventions (sandboxed, no Flash, dark page).
  const windows = state.featureWindows.filter(function (w) {
    return w.id === PLACEHOLDER_ID;
  });
  assert.strictEqual(windows.length, 1);
  const winConfig = windows[0].config;
  assert.strictEqual(winConfig.webPreferences.sandbox, true);
  assert.strictEqual(winConfig.webPreferences.plugins, false);
  assert.strictEqual(winConfig.webPreferences.contextIsolation, true);
  assert.strictEqual(winConfig.webPreferences.nodeIntegration, false);
  assert.strictEqual(winConfig.useContentSize, true);

  // Its own menu entries; the placeholder is still reachable from the same menu (#25 added the
  // Eye Dropper, Notepad and About entries above it).
  assert.strictEqual(state.menus.length, 1);
  const items = state.menus[0]({ labels: {}, keybinds: {} });
  assert.strictEqual(items.length, 1);
  assert.ok(Array.isArray(items[0].submenu) && items[0].submenu.length >= 1);
  items[0].submenu.forEach(function (entry) {
    if (typeof entry.click === 'function') entry.click();
  });
  assert.ok(opened.indexOf(PLACEHOLDER_ID) !== -1, 'the placeholder window must stay reachable');
});

test('an app older than the plugin refuses it at discovery, and still loads the others', () => {
  const older = platform.discoverPlugins({
    bundledDir: path.join(repoRoot, 'plugins'),
    appVersion: '1.12.2',
    log: function () {}
  });
  const ids = older.plugins.map(function (p) {
    return p.manifest.id;
  });

  assert.strictEqual(ids.indexOf('grimlite-parity'), -1, 'an unsupported plugin must not activate');
  assert.ok(ids.indexOf('adventure-quest-worlds') !== -1, 'existing bundled plugins keep loading');
  assert.ok(ids.indexOf('example-companion') !== -1, 'existing bundled plugins keep loading');

  const refusal = older.errors.filter(function (e) {
    return /grimlite-parity/.test(e);
  });
  assert.strictEqual(refusal.length, 1);
  assert.ok(/apiVersion 2 is not supported|minAppVersion 2\.0\.0/.test(refusal[0]), refusal[0]);
  assert.ok(/Invalid manifest in /.test(refusal[0]), refusal[0]);
});

test('selecting the parity plugin makes it the active plugin, and the default stays the bundled one', () => {
  const discovered = platform.discoverPlugins({
    bundledDir: path.join(repoRoot, 'plugins'),
    appVersion: appVersion,
    log: function () {}
  });

  const chosen = platform.selectPlugin(discovered.plugins, { activePluginId: 'grimlite-parity' });
  assert.strictEqual(chosen.selected.manifest.id, 'grimlite-parity');
  assert.strictEqual(chosen.bundledDefault.manifest.id, 'adventure-quest-worlds');

  // Nothing selected: the bundled default, so today's users are unaffected.
  assert.strictEqual(platform.selectPlugin(discovered.plugins, {}).selected.manifest.id, 'adventure-quest-worlds');
});
