// The Options and Hotkeys windows as the app surfaces them (ticket #34). The reference is
// Grimlite-Li, whose toggles are an Options menu (Root.cs:983-996) and whose bindings live in
// Grimoire/UI/Hotkeys.cs; this port puts each in an app feature window, so what is checked here is
// the surfacing: registration, menu, keybinds and the page/preload pair.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const url = require('url');
const vm = require('vm');

const platform = require('../../res/platform');
const toggles = require('../../plugins/grimlite-parity/features/options/toggles.js');
const actions = require('../../plugins/grimlite-parity/features/hotkeys/actions.js');
const { createOptionsWindow } = require('../../plugins/grimlite-parity/features/options/options-window.js');
const { createHotkeysWindow } = require('../../plugins/grimlite-parity/features/hotkeys/hotkeys-window.js');
const menusModule = require('../../plugins/grimlite-parity/menus.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const OPTIONS_WINDOW_ID = 'grimlite-parity-options';
const HOTKEYS_WINDOW_ID = 'grimlite-parity-hotkeys';
const LOGS_WINDOW_ID = 'grimlite-parity-logs';
const WINDOW_IDS = [OPTIONS_WINDOW_ID, HOTKEYS_WINDOW_ID, LOGS_WINDOW_ID];

// res/const.js reads Electron at load time, so its platform keybinds are read as source - the same
// way test/unit/game-menu.test.js does - and this is the list the app already holds.
function platformKeybindValues() {
  const source = fs.readFileSync(path.join(repoRoot, 'res/const.js'), 'utf8');
  const block = source.slice(
    source.indexOf('const originalKeybinds'),
    source.indexOf('exports.originalKeybinds')
  );
  const values = [];
  (block.match(/"[^"]+"/g) || []).forEach(function (quoted) { values.push(quoted.slice(1, -1)); });
  return values;
}

function activateParity(deps) {
  return platform.activatePlugin({
    source: 'bundled',
    root: pluginRoot,
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  }, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: deps || {}
  });
}

function handlersFor(window) {
  const handlers = {};
  window.attachTo({ ipc: { handle: function (channel, listener) { handlers[channel] = listener; } } });
  return handlers;
}

// A stand-in for the options feature: what the window asks it, and what it answers.
function fakeFeature(answers) {
  const calls = [];
  answers = answers || {};
  const state = Object.assign({ applying: false, results: {} }, answers.state || {});
  toggles.TOGGLES.forEach(function (toggle) {
    if (state[toggle.id] === undefined) state[toggle.id] = false;
  });
  return {
    calls: calls,
    state: function () {
      // `walkSpeed` is two things in this window, as it is in the reference: the tick's id and the
      // number the field holds. The number wins, so the default goes in after the tick flags.
      const out = Object.assign({}, state);
      out.walkSpeedOn = state.walkSpeed === true;
      out.walkSpeed = typeof state.walkSpeedNumber === 'number'
        ? state.walkSpeedNumber : toggles.WALK_SPEED.default;
      return out;
    },
    setToggle: function (id, on) {
      calls.push({ setToggle: [id, on] });
      state[id] = on;
      const answer = answers.set || { ok: true, error: null };
      return Promise.resolve(answer);
    },
    setWalkSpeed: function (value) {
      calls.push({ setWalkSpeed: value });
      state.walkSpeedNumber = Number(value);
      return Promise.resolve({ ok: true, value: Number(value) });
    }
  };
}

// ------------------------------------------------------------------ registration and surfacing

test('the Options and Hotkeys windows are registered in the app\'s own window conventions', async () => {
  const activated = await activateParity();
  const windows = activated.host._getState().featureWindows;

  WINDOW_IDS.forEach(function (id) {
    const found = windows.filter(function (w) { return w.id === id; });
    assert.strictEqual(found.length, 1, 'missing feature window ' + id);
    const config = found[0].config;
    assert.strictEqual(config.webPreferences.sandbox, true, id + ' must be sandboxed');
    assert.strictEqual(config.webPreferences.plugins, false, id + ' must not load Flash');
    assert.strictEqual(config.webPreferences.contextIsolation, true, id + ' must isolate contexts');
    assert.strictEqual(config.webPreferences.nodeIntegration, false, id + ' must not expose Node');
    assert.strictEqual(config.useContentSize, true, id + ' sizes its content, like the platform\'s');
    const page = url.fileURLToPath(found[0].url);
    assert.ok(page.indexOf(pluginRoot) === 0, id + ' page must live in the plugin');
    assert.ok(fs.existsSync(page), 'missing page file: ' + page);
    const preload = config.webPreferences.preload;
    assert.ok(typeof preload === 'string' && fs.existsSync(preload), id + ' needs a preload');
    const source = fs.readFileSync(preload, 'utf8');
    assert.ok(/require\((['"])electron\1\)/.test(source), id + ' preload must require electron');
    assert.strictEqual(source.indexOf("require('../"), -1, id + ' preload must stay self-contained');
  });
});

// The reference has a top-level Options menu and keeps Hotkeys under Tools. The platform already
// has a Tools menu, so Hotkeys stays under this plugin's Grimlite menu. Both must open a registered
// window; the window ids are deliberately not listed here.
test('the menus open the Options and Hotkeys windows, and only registered ones', async () => {
  const opened = [];
  const activated = await activateParity({
    openFeatureWindow: function (id) { opened.push(id); return {}; }
  });
  const state = activated.host._getState();
  const top = state.menus
    .map(function (contributor) {
      return contributor({ labels: {}, keybinds: {} });
    })
    .reduce(function (all, group) { return all.concat(group); }, []);
  const options = top.filter(function (menu) { return menu.label === 'Options'; });
  const client = top.filter(function (menu) { return menu.label === 'Client'; })[0];
  const items = options.concat((client && client.submenu) || []);

  assert.deepStrictEqual(top.map(function (menu) { return menu.label; }),
    ['Bot', 'Packets', 'Options', 'Maid', 'About', 'Char Select', 'Client'],
    'the reference order, with its Tools entries in this plugin\'s own menu');
  const tools = (client && client.submenu || []).map(function (item) { return item.label; });
  ['Bot file', 'Parity placeholder window', 'Sets'].forEach(function (hidden) {
    assert.strictEqual(tools.indexOf(hidden), -1, hidden + ' must not have a visible entry');
  });
  ['Logs', 'Hotkeys', 'Bank', 'Loaders/grabbers'].forEach(function (kept) {
    assert.ok(tools.indexOf(kept) !== -1, 'the remaining tools stay reachable: ' + kept);
  });

  const labels = items.map(function (item) { return item.label; });
  ['Options', 'Hotkeys'].forEach(function (label) {
    assert.ok(labels.indexOf(label) !== -1, 'menu is missing ' + label + ' (has ' + labels.join(', ') + ')');
  });

  const registered = state.featureWindows.map(function (w) { return w.id; });
  ['grimlite-parity-bot-file', 'grimlite-parity-placeholder'].forEach(function (id) {
    assert.strictEqual(registered.indexOf(id), -1, id + ' must not be a registered surface');
  });
  items.forEach(function (item) {
    if (['Options', 'Hotkeys'].indexOf(item.label) === -1) return;
    opened.length = 0;
    item.click();
    assert.strictEqual(opened.length, 1, item.label + ' must open exactly one window');
    assert.ok(registered.indexOf(opened[0]) !== -1, item.label + ' opened an unregistered window: ' + opened[0]);
  });

  // The plugin still registers both actions for Settings, even though it ships no default keys.
  ['grimliteOptions', 'grimliteHotkeys'].forEach(function (id) {
    const binding = state.keybinds.filter(function (k) { return k.id === id; });
    assert.strictEqual(binding.length, 1, id + ' needs its own keybind');
    assert.strictEqual(state.keybindDefaults[id], undefined, id + ' ships unbound');
    opened.length = 0;
    binding[0].action();
    assert.strictEqual(opened.length, 1, id + ' must open one window');
    assert.ok(registered.indexOf(opened[0]) !== -1, id + ' opened an unregistered window: ' + opened[0]);
  });
});

test('the Char Select top-level entry follows the connection', () => {
  let visible = true;
  let contributor = null;
  const host = {
    windows: { openFeatureWindow: function () { return {}; } },
    registerMenus: function (contribute) { contributor = contribute; }
  };
  menusModule.register(host, function () { return 'title'; }, {
    charSelectVisible: function () { return visible; }
  });
  assert.ok(contributor({ labels: {}, keybinds: {} })
    .some(function (menu) { return menu.label === 'Char Select'; }));
  visible = false;
  assert.strictEqual(contributor({ labels: {}, keybinds: {} })
    .some(function (menu) { return menu.label === 'Char Select'; }), false);
});

test('Char Select has a one-click sign-in item for each saved username', () => {
  const selected = [];
  let contributor = null;
  const host = {
    windows: { openFeatureWindow: function () { return {}; } },
    registerMenus: function (contribute) { contributor = contribute; }
  };
  menusModule.register(host, function () { return 'title'; }, {
    charSelectVisible: function () { return true; },
    characters: function () { return [{ username: 'mira' }, { username: 'kai' }]; },
    selectCharacter: function (username) { selected.push(username); }
  });

  const menu = contributor({ labels: {}, keybinds: {} })
    .filter(function (item) { return item.label === 'Char Select'; })[0];
  const accounts = menu.submenu.filter(function (item) { return item.type !== 'separator'; });
  assert.deepStrictEqual(accounts.map(function (item) { return item.label; }),
    ['mira', 'kai', 'Manage characters...']);
  accounts[0].click();
  assert.deepStrictEqual(selected, ['mira']);
});

// Grimlite ships no hotkeys of its own, and the platform's defaults stay untouched.
test('the plugin contributes no default accelerators and takes nothing from the app', async () => {
  const activated = await activateParity();
  const defaults = activated.host._getState().keybindDefaults;
  const platformKeys = platformKeybindValues();
  assert.ok(platformKeys.indexOf('F2') !== -1, 'the app\'s own keys must be found: ' + platformKeys.join(', '));
  assert.ok(platformKeys.indexOf('Ctrl+J') !== -1, 'the app\'s own keys must be found');
  // Grimlite ships no global hotkeys; the two Maid form keys are the safe Electron adaptation.
  assert.deepStrictEqual(defaults, {
    grimliteMaidUnfollow: 'Alt+Shift+U',
    grimliteMaidStopAttack: 'Alt+Shift+X'
  });
  Object.keys(defaults).forEach(function (id) {
    assert.strictEqual(platformKeys.indexOf(defaults[id]), -1, id + ' steals an app key');
  });
});

// ------------------------------------------------------------------ the pages

// A page whose inline script does not parse loads as a blank window, and a page that calls a
// preload member that does not exist is a button that silently does nothing.
test('each page is the reference\'s own vocabulary and calls only what its preload exposes', () => {
  const pages = [
    { dir: 'options', html: 'options.html', preload: 'preload_options.js', bridge: 'aquastarOptions' },
    { dir: 'hotkeys', html: 'hotkeys.html', preload: 'preload_hotkeys.js', bridge: 'aquastarHotkeys' }
  ];

  pages.forEach(function (page) {
    const file = path.join(pluginRoot, 'features', page.dir, page.html);
    const html = fs.readFileSync(file, 'utf8');
    const preload = fs.readFileSync(path.join(pluginRoot, 'features', page.dir, page.preload), 'utf8');

    const bound = html.match(new RegExp('([A-Za-z0-9_]+)\\s*=\\s*window\\.' + page.bridge));
    assert.ok(bound, page.html + ' must bind window.' + page.bridge);
    const called = (html.match(new RegExp('\\b' + bound[1] + '\\.([A-Za-z0-9_]+)\\(', 'g')) || []).map(
      function (hit) { return hit.slice(bound[1].length + 1, -1); }
    );
    assert.ok(called.length > 0, page.html + ' never uses its bridge');
    const exposed = (preload.match(/^\s*([A-Za-z0-9_]+): function/gm) || []).map(function (line) {
      return line.trim().split(':')[0];
    });
    called.forEach(function (name) {
      assert.ok(exposed.indexOf(name) !== -1, page.preload + ' does not expose ' + name);
    });

    const blocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
    assert.ok(blocks.length > 0, page.html + ' has no inline script');
    blocks.forEach(function (block) {
      const source = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      assert.doesNotThrow(function () { new vm.Script(source); },
        page.html + ' inline script does not parse');
    });
    assert.ok(html.indexOf('res/features/common/focus.css') !== -1,
      page.html + ' needs the shared focus style');
  });
});

// ------------------------------------------------------------------ the windows' own halves

test('the options window serves the reference\'s toggles in its order, with the walkspeed field', async () => {
  const feature = fakeFeature();
  const handlers = handlersFor(createOptionsWindow({ feature: feature, messages: {} }));

  const view = await handlers.optionsView({});
  assert.deepStrictEqual(
    view.toggles.map(function (t) { return t.label; }),
    ['Infinite Range', 'Provoke', 'Enemy Magnet', 'Lag Killer', 'Hide Players', 'Skip Cutscenes',
      'Walkspeed'],
    'the window must offer the reference\'s own set, in its order'
  );
  view.toggles.forEach(function (t) {
    assert.strictEqual(t.on, false, t.id + ' must draw unticked: every toggle is the user\'s opt-in');
  });
  assert.strictEqual(view.walkSpeed, toggles.WALK_SPEED.default, 'the field ships at the reference value');
  assert.strictEqual(view.walkSpeedMin, toggles.WALK_SPEED.min);
  assert.strictEqual(view.walkSpeedMax, toggles.WALK_SPEED.max);
  assert.strictEqual(view.applying, undefined, 'the Options window has no master start/stop control');

  await handlers.optionsSet({}, 'lagKiller', true);
  await handlers.optionsWalkSpeed({}, 33);
  assert.deepStrictEqual(feature.calls, [
    { setToggle: ['lagKiller', true] },
    { setWalkSpeed: 33 }
  ]);
  assert.strictEqual(handlers.optionsToggleApplying, undefined);
  const html = fs.readFileSync(path.join(pluginRoot, 'features/options/options.html'), 'utf8');
  assert.ok(!/Stop applying|Start applying/.test(html), 'AquaGrim must not add a button Grimlite does not show');
});

test('an option the game refused reaches the window as a refusal, not as a tick that worked', async () => {
  const feature = fakeFeature({
    set: { ok: false, error: 'no member SetLagKiller at SetLagKiller' }
  });
  const handlers = handlersFor(createOptionsWindow({ feature: feature, messages: {} }));
  const answer = await handlers.optionsSet({}, 'lagKiller', true);
  assert.strictEqual(answer.ok, false);
  assert.ok(/no member SetLagKiller/.test(answer.error), answer.error);
  assert.strictEqual(answer.view.results.lagKiller, undefined,
    'the fake feature reports no results; the window must not invent one');
});

test('the hotkeys window offers the reference\'s pickers and stores its record shape', async () => {
  // The window draws what the feature says and writes back through it, so the feature is a stand-in
  // that keeps the reference's own record shape.
  const store = [];
  const feature = {
    view: function () {
      return {
        actions: actions.ACTIONS.map(function (a) { return a.label; }),
        keys: actions.KEYS.slice(),
        bindings: store.map(function (r) { return { Text: r.Text, Key: r.Key, ActionIndex: r.ActionIndex }; }),
        taken: []
      };
    },
    list: function () { return feature.view().bindings; },
    bind: function (key, actionIndex) {
      store.push({ Text: actions.labelFor(key, actionIndex), Key: key, ActionIndex: actionIndex });
      return { ok: true };
    },
    clear: function (key) {
      const before = store.length;
      for (let i = store.length - 1; i >= 0; i--) if (store[i].Key === key) store.splice(i, 1);
      return store.length !== before;
    },
    runAction: function (actionIndex) { return Promise.resolve({ ok: true, done: actionIndex }); }
  };
  const handlers = handlersFor(createHotkeysWindow({ feature: feature, messages: {} }));

  const fresh = await handlers.hotkeysView({});
  assert.deepStrictEqual(fresh.bindings, [], 'the set ships empty, as it does upstream');
  assert.deepStrictEqual(fresh.actions, actions.ACTIONS.map(function (a) { return a.label; }));
  assert.deepStrictEqual(fresh.keys, actions.KEYS);

  const bound = await handlers.hotkeysBind({}, 'D4', 16);
  assert.strictEqual(bound.ok, true, bound.error);
  assert.deepStrictEqual(bound.view.bindings,
    [{ Text: 'D4: Show Notepad', Key: 'D4', ActionIndex: 16 }]);

  const cleared = await handlers.hotkeysClear({}, 'D4');
  assert.strictEqual(cleared.ok, true);
  assert.deepStrictEqual(cleared.view.bindings, []);
  assert.strictEqual((await handlers.hotkeysClear({}, 'D4')).ok, false, 'clearing a free key says so');
});

// Nothing here loads Flash or needs a permission the manifest does not declare: the option calls go
// through the bridge, which the manifest already holds, and the hotkeys need none at all. The Host
// throws for a call whose permission is missing, so activating at all is that check.
test('the two windows need no permission the manifest does not declare', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  assert.strictEqual(manifest.permissions.indexOf('unsafe-renderer'), -1);
  assert.ok(manifest.permissions.indexOf('game-bridge') !== -1, 'the toggles call the game');
  assert.ok(manifest.permissions.indexOf('persistent-store') !== -1, 'the ticks and bindings persist');
  const activated = await activateParity();
  WINDOW_IDS.forEach(function (id) {
    assert.strictEqual(
      activated.host._getState().featureWindows.filter(function (w) { return w.id === id; }).length,
      1
    );
  });
});

// The hotkeys page takes its own words from the locale; the empty-list and save-count lines the
// reference does not have are gone.
test('the hotkeys page takes its words from the locale', async () => {
  const locales = require(path.join(pluginRoot, 'locales/en-US.js'));
  const hotkeyFeature = {
    view: function () { return { actions: [], keys: [], bindings: [], taken: [] }; },
    list: function () { return []; }
  };
  const hotkeyHandlers = handlersFor(createHotkeysWindow({
    feature: hotkeyFeature, messages: locales.hotkeysMessages
  }));

  const hotkeysView = await hotkeyHandlers.hotkeysView({});
  assert.strictEqual(hotkeysView.messages.add, 'Add');
  assert.strictEqual(hotkeysView.messages.remove, 'Remove');
  assert.strictEqual(hotkeysView.messages.save, 'Save');
  assert.strictEqual(hotkeysView.messages.empty, undefined);

  // ...and the page no longer draws text the reference does not have.
  const hotkeysHtml = fs.readFileSync(path.join(pluginRoot, 'features/hotkeys/hotkeys.html'), 'utf8');
  ['Nothing is bound yet.', 'Select a binding first.', 'Saved $1 binding(s).'].forEach(function (text) {
    assert.strictEqual(hotkeysHtml.indexOf(text), -1, 'the page must not add ' + text);
  });
});

test('the plugin registers only the Maid form keys as defaults', async () => {
  const activated = await activateParity();
  const defaults = activated.host._getState().keybindDefaults;
  assert.deepStrictEqual(defaults, {
    grimliteMaidUnfollow: 'Alt+Shift+U',
    grimliteMaidStopAttack: 'Alt+Shift+X'
  }, 'Grimlite hotkeys ship empty; the two Maid form keys are the safe Electron adaptation');
});
