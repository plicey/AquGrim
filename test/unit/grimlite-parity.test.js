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
      startGameOrigin: function () {
        return Promise.resolve('http://127.0.0.1:41234');
      },
      openFeatureWindow: function (id) {
        opened.push(id);
        return {};
      }
    }
  });

  const state = activated.host._getState();

  // The primary surface is the bridge SWF on the plugin's own loopback origin: the game and the
  // bridge must share an origin for the bridge to reach the game's classes at all.
  const primaryUrl = state.primaryGame.getUrl();
  assert.strictEqual(primaryUrl, 'http://127.0.0.1:41234/game/aqua-bridge.swf');
  assert.strictEqual(state.primaryGame.isGameUrl(primaryUrl), true);
  assert.strictEqual(state.primaryGame.isGameUrl('https://example.com/other'), false);
  assert.strictEqual(state.primaryGame.isGameUrl('http://127.0.0.1:41234/game/other.swf'), false);

  // Feature windows, in the app's window conventions (sandboxed, no Flash, dark page). The
  // placeholder is the scaffold's; the packet logger (ticket #26) joins it.
  const windows = state.featureWindows.filter(function (w) {
    return w.id === PLACEHOLDER_ID;
  });
  assert.strictEqual(windows.length, 0, 'the scaffold placeholder is not part of the reference');
  assert.ok(state.featureWindows.length >= 1);
  const winConfig = state.featureWindows[0].config;
  assert.strictEqual(winConfig.webPreferences.sandbox, true);
  assert.strictEqual(winConfig.webPreferences.plugins, false);
  assert.strictEqual(winConfig.webPreferences.contextIsolation, true);
  assert.strictEqual(winConfig.webPreferences.nodeIntegration, false);
  assert.strictEqual(winConfig.useContentSize, true);

  // Its own menu entries, opening those windows and nothing else.
  assert.strictEqual(state.menus.length, 1);
  const items = state.menus[0]({ labels: {}, keybinds: {} });
  assert.ok(items.length >= 1);

  // Every entry of every submenu opens a window this plugin registered, and nothing else; the
  // placeholder the scaffold shipped stays reachable. No window id is listed here on purpose, so
  // adding a feature window means adding it to windows.js, never to this test.
  const registeredIds = state.featureWindows.map(function (w) { return w.id; });
  const entries = [];
  items.forEach(function (menu) {
    if (menu.submenu) {
      assert.ok(menu.submenu.every(function (item) { return typeof item.click === 'function'; }));
      entries.push.apply(entries, menu.submenu);
    } else {
      assert.strictEqual(typeof menu.click, 'function', menu.label + ' must open a window');
      entries.push(menu);
    }
  });
  entries.forEach(function (entry) { entry.click(); });

  assert.ok(opened.length > 0, 'the menu opens at least one registered window');
  opened.forEach(function (id) {
    assert.ok(registeredIds.indexOf(id) !== -1, 'menu opened an unregistered window: ' + id);
  });
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

test('the booted plugin hands its bot engine the shell seams the misc commands need', async () => {
  // The engine takes its seams by injection (#40), and main.js is where they are decided. A
  // CmdBeep whose sound is absent, or a CmdLoadBot whose file door is absent, is a command that
  // says so at run time rather than one that silently does nothing - both are correct answers, so
  // the only way to tell them apart is to boot the plugin and ask the engine it built. This boots
  // the real plugin against the real Host, then runs the two commands whose effect crosses the
  // shell: a beep (Electron's own alert sound) and a packet (host.packets, gated by packet-send).
  const gameWindow = {
    isDestroyed: function () { return false; },
    webContents: {},
    getURL: function () { return 'about:blank'; }
  };
  const activated = await platform.activatePlugin({
    manifest: manifest(),
    main: path.join(pluginRoot, 'main.js'),
    root: pluginRoot,
    source: 'bundled'
  }, {
    appVersion: appVersion,
    appDataDirectory: fs.mkdtempSync(path.join(require('os').tmpdir(), 'aquastar-wire-')),
    clearRequireCache: true,
    log: function () {},
    deps: {
      startGameOrigin: function () { return Promise.resolve('http://127.0.0.1:41234'); },
      openFeatureWindow: function () { return {}; },
      // A game window whose bridge answers: the engine refuses to start without one, and the
      // session reads through it before the first command runs.
      // One stable window: the channel compares the webContents it attached to against this call's
      // answer, so a fresh object per call would read as the window having gone away.
      getGameWindow: function () { return gameWindow; },
      // The bridge page side, answering the one question the engine asks before it starts:
      // IsLoggedIn (#35's session read). Everything else answers as a game with nothing to say.
      executeJavaScript: function (wc, source) {
        if (source.indexOf('.ready()') !== -1) return Promise.resolve(true);
        // The engine's own liveness reads before its first command: the loader surface's
        // `IsLoggedIn` row is a read of `sfc.isConnected` (loader-surface.js), and the session's
        // own `ready()` is a read of `world.mapLoadInProgress` (session.js PATHS) that must be
        // false for a bot to run rather than pause on a map that never finishes loading.
        if (source.indexOf('world.mapLoadInProgress') !== -1) {
          return Promise.resolve({ ok: true, value: 'false' });
        }
        return Promise.resolve({ ok: true, value: 'true' });
      }
    }
  });
  // The window's own Enable Bot channel is how a bot starts, so driving it is the booted path:
  // the plugin's runtime, its engine, and whatever seams main.js handed them.
  const handlers = {};
  activated.host._getState().ipcHandlers.forEach(function (entry) {
    handlers[entry.channel] = entry.listener;
  });
  const enableChannel = 'plugin:grimlite-parity:botManagerEnable';
  const addChannel = 'plugin:grimlite-parity:botManagerAdd';
  assert.ok(handlers[enableChannel], 'the Bot Manager must be reachable when the plugin boots');

  // Build the list through the window's own controls, which is how a user fills it: Stop ends
  // the bot on its own (the reference's CmdStop), so no timer outlives this test.
  assert.strictEqual(handlers[addChannel]({ sender: { id: 1 } }, 'btnStop', {}).refused, false);
  const enabled = await handlers[enableChannel]({ sender: { id: 1 } }, true);
  assert.strictEqual(enabled.enabled, true, enabled.error || 'the bot starts');
  await handlers[enableChannel]({ sender: { id: 1 } }, false);
  const state = await handlers['plugin:grimlite-parity:botManagerState']({ sender: { id: 1 } });
  assert.strictEqual(state.enabled, false, 'and stops again');
  assert.strictEqual(state.bot.running, false, 'its own running flag agrees');
});
