// The Maid window as the app surfaces it (ticket #43): its registration in the app's window
// conventions, its page/preload pair, the two keys' layer rule and the config file's own round
// trip through the window's IPC. The scheduler's own behaviour is in grmlite-maid-scheduler.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const url = require('url');
const vm = require('vm');

const platform = require('../../res/platform');
const maidWindow = require('../../plugins/grimlite-parity/features/maid/maid-window.js');
const maidModel = require('../../plugins/grimlite-parity/features/maid/maid.js');
const config = require('../../plugins/grimlite-parity/features/maid/config.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const MAID_WINDOW_ID = 'grimlite-parity-maid';

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

// The platform's own keybinds, read as source the way test/unit/game-menu.test.js does, because
// res/const.js reads Electron at load time.
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

// A stand-in for the two shortcut layers, which is all the Maid's keys need.
function fakeLayers() {
  const local = [];
  const global = [];
  return {
    local: local,
    global: global,
    localShortcuts: {
      register: function (accel, fn) { local.push({ accel: accel, fn: fn }); return true; },
      unregister: function (accel) {
        const at = local.findIndex(function (one) { return one.accel === accel; });
        if (at !== -1) local.splice(at, 1);
      }
    },
    globalShortcuts: {
      register: function (accel, fn) { global.push({ accel: accel, fn: fn }); return true; },
      unregister: function (accel) {
        const at = global.findIndex(function (one) { return one.accel === accel; });
        if (at !== -1) global.splice(at, 1);
      }
    }
  };
}

// ------------------------------------------------------------------ registration and surfacing

test('the Maid window is registered in the app\'s own window conventions', async () => {
  const activated = await activateParity();
  const windows = activated.host._getState().featureWindows;
  const found = windows.filter(function (one) { return one.id === MAID_WINDOW_ID; });
  assert.strictEqual(found.length, 1, 'the Maid window is registered once, under its own id');
  const target = found[0];
  const web = target.config.webPreferences;
  assert.strictEqual(web.sandbox, true, 'the Maid window is sandboxed');
  assert.strictEqual(web.plugins, false, 'the Maid window must not load Flash');
  assert.strictEqual(web.contextIsolation, true);
  assert.strictEqual(web.nodeIntegration, false);
  assert.strictEqual(target.config.useContentSize, true);
  const page = url.fileURLToPath(target.url);
  assert.ok(page.indexOf(pluginRoot) === 0, 'the page must live in the plugin');
  assert.ok(fs.existsSync(page), 'missing page file: ' + page);
  const preload = web.preload;
  assert.ok(typeof preload === 'string' && fs.existsSync(preload), 'the window needs a preload');
  const source = fs.readFileSync(preload, 'utf8');
  assert.ok(/require\((['"])electron\1\)/.test(source), 'the preload must require electron');
  assert.strictEqual(source.indexOf("require('../"), -1, 'the preload must stay self-contained');
  // The id is the one the Hotkeys window's own action already names, so that action reaches it.
  assert.ok(activated.host._getState().featureWindows.some(function (one) {
    return one.id === MAID_WINDOW_ID;
  }));
  const actionTargets = require('../../plugins/grimlite-parity/features/hotkeys/action-targets.js');
  assert.strictEqual(actionTargets.WINDOW_BY_ACTION['Show Maid'], MAID_WINDOW_ID,
    'the reference\'s own "Show Maid" action must reach this window');
});

test('the Maid window is reachable from a menu and from a keybind', async () => {
  const activated = await activateParity();
  const state = activated.host._getState();
  assert.ok(state.keybindDefaults.grimliteMaid, 'the Maid needs a default key');
  const binding = state.keybinds.filter(function (one) { return one.id === 'grimliteMaid'; });
  assert.strictEqual(binding.length, 1, 'the Maid\'s window has its own binding');
  const menus = state.menus.map(function (contribute) { return contribute({ labels: {}, keybinds: {} }); });
  const flat = menus.reduce(function (all, group) { return all.concat(group); }, []);
  const submenus = flat.reduce(function (all, one) { return all.concat(one.submenu || []); }, []);
  const entry = submenus.filter(function (one) { return one.label === 'Maid'; });
  assert.strictEqual(entry.length, 1, 'the Maid is a menu entry');
});

test('the Maid\'s own keys are unique, take nothing the app holds, and can move layer', async () => {
  const activated = await activateParity();
  const defaults = activated.host._getState().keybindDefaults;
  ['grimliteMaidUnfollow', 'grimliteMaidStopAttack'].forEach(function (id) {
    assert.strictEqual(typeof defaults[id], 'string', id + ' needs a default key');
    assert.ok(/\+/.test(defaults[id]), id + ' must carry a modifier');
    assert.strictEqual(platformKeybindValues().indexOf(defaults[id]), -1,
      id + ' would take the app\'s own ' + defaults[id]);
  });
  // No two of the plugin\'s defaults are the same key: the second registration would win and the
  // first window would lose its shortcut with nothing said about it.
  const seen = {};
  const clashes = [];
  Object.keys(defaults).forEach(function (id) {
    const key = defaults[id];
    if (typeof key !== 'string' || !key) return;
    if (seen[key]) clashes.push(seen[key] + ' and ' + id + ' both take ' + key);
    else seen[key] = id;
  });
  assert.deepStrictEqual(clashes, []);
});

// The reference's Global Hotkey box: ticked, the two keys work whichever window has focus;
// unticked, they are the form's own keys only (MaidRemake.cs:1026-1045).
test('the Global Hotkey box moves the Maid\'s two keys between the app\'s two layers', () => {
  const layers = fakeLayers();
  const flipped = [];
  const fake = {
    state: function () { return { unfollow: false, stopAttack: false }; },
    toggleUnfollow: function () { flipped.push('unfollow'); },
    toggleStopAttack: function () { flipped.push('stopAttack'); }
  };
  const keys = maidWindow.createKeys({
    maid: fake,
    log: function () {},
    localShortcuts: layers.localShortcuts,
    globalShortcuts: layers.globalShortcuts,
    accelerators: function () {
      return { grimliteMaidUnfollow: 'Alt+Shift+U', grimliteMaidStopAttack: 'Alt+Shift+X' };
    }
  });
  keys.apply(false);
  assert.strictEqual(keys.layer(), 'local');
  assert.deepStrictEqual(keys.registered().map(function (one) { return one.accel; }),
    ['Alt+Shift+U', 'Alt+Shift+X']);
  assert.strictEqual(layers.global.length, 0, 'nothing is app-wide until the box is ticked');
  // Pressing the local key runs the reference\'s own handler.
  layers.local[0].fn();
  assert.deepStrictEqual(flipped, ['unfollow']);

  keys.apply(true);
  assert.strictEqual(keys.layer(), 'global');
  assert.strictEqual(layers.local.length, 0, 'the local copies are released, not doubled');
  assert.strictEqual(layers.global.length, 2);
  layers.global[1].fn();
  assert.deepStrictEqual(flipped, ['unfollow', 'stopAttack']);

  // ...and back again, which the reference does on unticking the box.
  keys.apply(false);
  assert.strictEqual(keys.layer(), 'local');
  assert.strictEqual(layers.global.length, 0);
  assert.strictEqual(layers.local.length, 2);
  keys.uninstall();
  assert.strictEqual(layers.local.length, 0);
});

test('a key the app does not carry nothing for is left unbound rather than registered blind', () => {
  const layers = fakeLayers();
  const keys = maidWindow.createKeys({
    maid: { state: function () { return {}; }, toggleUnfollow: function () {}, toggleStopAttack: function () {} },
    log: function () {},
    localShortcuts: layers.localShortcuts,
    globalShortcuts: { register: function () { return false; }, unregister: function () {} },
    accelerators: function () { return { grimliteMaidUnfollow: 'Alt+Shift+U' }; }
  });
  const answer = keys.apply(true);
  assert.strictEqual(answer.ok, true);
  assert.strictEqual(keys.registered().length, 0,
    'a key the layer refused is reported, not counted as bound');
});

// ------------------------------------------------------------------ the config file and the window

function fakeGame(readings) {
  const calls = [];
  return {
    calls: calls,
    loaderCall: function (name, args) {
      calls.push({ name: name, args: args || [] });
      return Promise.resolve(true);
    },
    read: function (readPath) {
      calls.push({ name: 'read', args: [readPath] });
      if (readings && Object.prototype.hasOwnProperty.call(readings, readPath)) {
        return Promise.resolve({ value: readings[readPath], error: null });
      }
      return Promise.resolve({ value: null, error: 'no answer' });
    },
    sendServerFrame: function () { return true; }
  };
}

function maidFixture(deps) {
  const game = fakeGame({ 'world.myAvatar.objData.strUsername': 'Kirin' });
  const maid = maidModel.createMaid({
    game: game,
    config: function () { return window.config(); },
    log: function () {},
    sleep: function () { return Promise.resolve(); },
    send: function () { return true; }
  });
  const window = maidWindow.createMaidWindow({
    maid: maid,
    game: game,
    messages: { title: 'Maid Remake' },
    ...(deps || {})
  });
  return { game: game, maid: maid, window: window };
}

test('the window\'s own state is what the acceptance criteria name', () => {
  const fixture = maidFixture();
  const view = fixture.window.view();
  assert.strictEqual(view.state.enabled, false);
  assert.strictEqual(view.state.status, maidModel.STATUS.off);
  assert.strictEqual(view.state.unfollow, false);
  assert.strictEqual(view.state.stopAttack, false);
  assert.strictEqual(view.state.config.SkillList, config.defaults().SkillList,
    'the window starts on the shipped default');
  assert.deepStrictEqual(view.presets, require('../../plugins/grimlite-parity/features/maid/presets.js').names());
  assert.deepStrictEqual(view.fields.all, config.FIELDS);
  // Enable starts the scheduler; StopAttack shows in the state the page draws.
  const after = fixture.window.set({ enabled: true, stopAttack: true, target: 'Kirin' });
  assert.strictEqual(after.state.enabled, true);
  assert.strictEqual(after.state.stopAttack, true);
  assert.strictEqual(after.state.target, 'kirin');
  assert.strictEqual(after.state.config.Target, 'Kirin', 'the box keeps what the user typed');
  // ...and stopping ends its loop, so nothing keeps running after this test. The fixture's sleep
  // resolves immediately, so leaving it enabled would spin as fast as the event loop allows.
  fixture.window.set({ enabled: false, stopAttack: false });
  assert.strictEqual(fixture.window.view().state.enabled, false);
  return fixture.maid.idle();
});

test('the window applies a class preset over its own config', () => {
  const fixture = maidFixture();
  const answer = fixture.window.preset('LC');
  assert.strictEqual(answer.ok, true);
  assert.strictEqual(answer.view.state.config.SkillList, '1,2,4,1,2,4,3');
  assert.strictEqual(answer.view.state.config.SafeSkillList, '3');
  assert.strictEqual(answer.view.state.config.SafeSkill, true, 'LC assigns the carried heal flag');
  const missing = fixture.window.preset('nope');
  assert.strictEqual(missing.ok, false);
  assert.ok(/nope/.test(missing.error));
});

test('the config file round-trips through the window and is applied on autoload', () => {
  const directory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aquastar-maid-'));
  try {
    const fixture = maidFixture({ appDataDirectory: directory });
    assert.strictEqual(fixture.window.directory, path.join(directory, 'Config'));
    // No autoload file yet is the ordinary first run, not a failure.
    const empty = fixture.window.autoload();
    assert.strictEqual(empty.ok, true);
    assert.strictEqual(empty.applied, false);
    // Save writes the whole 23-key file beside the store the plugin keeps in appData.
    fixture.window.set({ config: { SkillList: '5,6', WaitSkill: true } });
    const saved = fixture.window.save();
    assert.strictEqual(saved.ok, true);
    assert.strictEqual(saved.path, path.join(directory, 'Config', 'autoload.json'));
    const written = fs.readFileSync(saved.path, 'utf8');
    assert.deepStrictEqual(Object.keys(JSON.parse(written)), config.FIELDS,
      'the file carries all 23 keys, the way the reference writes them');
    // A fresh window loads it back through the same overlay rule.
    const again = maidFixture({ appDataDirectory: directory });
    const applied = again.window.autoload();
    assert.strictEqual(applied.applied, true);
    assert.strictEqual(again.window.config().SkillList, '5,6');
    assert.strictEqual(again.window.config().WaitSkill, true);
    assert.strictEqual(again.window.view().state.loadedFrom, 'autoload.json');
    // A broken file is a refusal with a reason, and the window keeps what it had.
    fs.writeFileSync(path.join(directory, 'Config', 'autoload.json'), '{ not json');
    const refused = again.window.autoload();
    assert.strictEqual(refused.ok, false);
    assert.strictEqual(again.window.config().SkillList, '5,6', 'a bad file changes nothing');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the window\'s Me button reads the game\'s own name field', async () => {
  const fixture = maidFixture();
  const answer = await fixture.window.me();
  assert.strictEqual(answer.ok, true);
  assert.strictEqual(fixture.maid.getTarget(), 'kirin');
  assert.deepStrictEqual(fixture.game.calls.map(function (one) { return one.args[0]; }),
    [maidWindow.PLAYERNAME_PATH]);
  // No character signed in is a refusal, not an empty target.
  const blank = maidWindow.createMaidWindow({
    maid: fixture.maid,
    game: fakeGame({}),
    messages: {}
  });
  const refused = await blank.me();
  assert.strictEqual(refused.ok, false);
});

test('the window announces a config change so the keys can follow the Global Hotkey box', () => {
  const fixture = maidFixture();
  const seen = [];
  fixture.window.onConfigChange(function (patch, state) { seen.push([patch, state.GlobalHotkey]); });
  fixture.window.set({ config: { GlobalHotkey: true } });
  assert.strictEqual(seen.length, 1);
  assert.deepStrictEqual(seen[0][0].config, { GlobalHotkey: true });
  assert.strictEqual(seen[0][1], true);
  // An unrelated change is announced too, but a watch only acts on its own key.
  fixture.window.set({ config: { SkillList: '1' } });
  assert.strictEqual(seen.length, 2);
  fixture.window.set({ unfollow: true });
  assert.strictEqual(seen.length, 3);
});

test('the window\'s channels answer what its own preload exposes', async () => {
  const fixture = maidFixture();
  const preload = fs.readFileSync(path.join(pluginRoot, 'features/maid/preload_maid.js'), 'utf8');
  // Every channel the preload invokes exists in the window's own channel list.
  const invoked = (preload.match(/CH\('([a-zA-Z]+)'\)/g) || []).map(function (one) {
    return one.slice(4, -2);
  });
  const known = maidWindow.CHANNELS.concat(['maidWatch', 'maidState']);
  invoked.forEach(function (name) {
    assert.ok(known.indexOf(name) !== -1, 'the preload invokes unknown channel ' + name);
  });
  assert.ok(invoked.indexOf('maidWatch') !== -1, 'the page reads its view through maidWatch');
  assert.ok(invoked.indexOf('maidState') !== -1, 'the page watches the scheduler\'s own pushes');
  const view = await fixture.window.handle('maidView', null, []);
  assert.strictEqual(view.state.status, maidModel.STATUS.off);
  const words = await fixture.window.handle('maidMessages', null, []);
  assert.strictEqual(words.title, 'Maid Remake');
  const applied = await fixture.window.handle('maidSet', null, [{ unfollow: true }]);
  assert.strictEqual(applied.state.unfollow, true);
  assert.throws(function () { fixture.window.handle('maidNonsense', null, []); }, /maidNonsense/,
    'an unknown channel is a refusal that names itself');
});

// ------------------------------------------------------------------ the page

function element() {
  const el = {
    children: [],
    listeners: {},
    textContent: '',
    className: '',
    disabled: false,
    checked: false,
    value: '',
    title: '',
    appendChild: function (child) { el.children.push(child); return child; },
    addEventListener: function (type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    }
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return ''; },
    set: function (value) { if (value === '') el.children = []; }
  });
  return el;
}

// The page runs in its own vm realm, so an object it passes out carries that realm's prototypes
// and deepStrictEqual would compare prototypes rather than shapes (the same helper the Bank and
// Sets page tests use).
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const PAGE_IDS = ['enabled', 'state', 'note', 'loadedFrom', 'preset', 'Target', 'SkillList',
  'RelogDelay', 'SkillDelay', 'SafeSkill', 'SafeSkillList', 'SafeSkillHP', 'BuffStopAttack',
  'BuffStopAttackList', 'AttackPriority', 'AttackPriorityMonster', 'unfollow', 'stopAttack',
  'GlobalHotkey', 'LockedZoneHandler', 'WhitelistMap', 'LockedZoneHandlerMaps',
  'WhitelistMapMaps', 'options', 'save', 'load', 'autoload', 'party', 'me', 'enableLabel',
  'targetLegend', 'combatLegend', 'keysLegend', 'optionsLegend', 'mapsLegend', 'configLegend',
  'unfollowLabel', 'stopAttackLabel', 'globalLabel', 'keyHint', 'relogLabel', 'skillDelayLabel',
  'presetLabel', 'skillListLabel', 'safeSkillLabel', 'safeSkillHpLabel', 'buffLabel',
  'priorityLabel', 'lockedLabel', 'whitelistLabel', 'lockedMapsLabel', 'whitelistMapsLabel',
  'cbAntiCounter', 'cbCopyWalk', 'cbStopIf', 'cbWaitSkill'];

test('the Maid page parses, draws the state line and only calls what its preload exposes', async () => {
  const source = fs.readFileSync(path.join(pluginRoot, 'features/maid/maid.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(source);
  assert.ok(script, 'the page needs its inline script');
  assert.ok(source.indexOf('res/features/common/focus.css') !== -1, 'the page uses the shared focus style');

  const byId = {};
  PAGE_IDS.forEach(function (id) { byId[id] = element(); });
  const document = {
    title: '',
    activeElement: null,
    getElementById: function (id) {
      assert.ok(byId[id], 'the page asks for a #' + id + ' that does not exist');
      return byId[id];
    },
    createElement: function () { return element(); }
  };

  const drawn = [];
  let pushed = null;
  const api = {
    getView: function () {
      return Promise.resolve({
        state: { enabled: false, status: 'off', unfollow: false, stopAttack: false, target: '',
          config: config.defaults(), loadedFrom: null, missing: [] },
        presets: ['EC', 'LC'],
        messages: { title: 'Maid Remake', enable: 'Enable', unfollow: 'Unfollow (R)' },
        fields: { all: config.FIELDS, numbers: config.NUMBERS, booleans: config.BOOLEANS },
        parties: { enabled: true, commands: ['\u002etp', '\u002ejoin'] }
      });
    },
    getMessages: function () { return Promise.resolve({ title: 'Maid Remake' }); },
    getPresets: function () { return Promise.resolve({ names: [], values: [] }); },
    set: function (patch) { drawn.push(patch); return Promise.resolve({ state: {}, presets: [], fields: {}, messages: {} }); },
    preset: function () { return Promise.resolve({ ok: true, view: { state: {} } }); },
    me: function () { return Promise.resolve({ ok: true, view: { state: {} } }); },
    save: function () { return Promise.resolve({ ok: true }); },
    load: function () { return Promise.resolve({ ok: true }); },
    autoload: function () { return Promise.resolve({ ok: true, applied: false }); },
    onState: function (listener) { pushed = listener; return function () {}; }
  };

  vm.runInNewContext(script[1], { window: { aquastarMaid: api }, document: document });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });

  assert.ok(byId.state.textContent, 'the state line says what the scheduler is doing');
  assert.strictEqual(byId.state.className, 'off');
  // The state push repaints the line, which is what makes a key pressed elsewhere visible.
  pushed({ state: { enabled: true, status: 'stop attack is on', unfollow: true, stopAttack: true,
    target: 'kirin', config: config.defaults(), missing: [] }, fields: { all: config.FIELDS,
    numbers: config.NUMBERS, booleans: config.BOOLEANS }, messages: {}, presets: [] });
  assert.strictEqual(byId.state.textContent, 'stop attack is on');
  assert.strictEqual(byId.unfollow.checked, true, 'the Unfollow box follows the state');
  assert.strictEqual(byId.stopAttack.checked, true);
  assert.strictEqual(byId.Target.value, 'kirin');
  // One change from the page reaches the window with the field it is about.
  const view = {
    state: { enabled: true, status: 'unfollowed', unfollow: true, stopAttack: true, target: 'kirin',
      config: config.defaults(), missing: [] },
    fields: { all: config.FIELDS, numbers: config.NUMBERS, booleans: config.BOOLEANS },
    messages: {}, presets: [], parties: { enabled: false, commands: [] }
  };
  api.set = function (patch) {
    drawn.push(patch);
    // The window answers the new view, which is what the page redraws from.
    return Promise.resolve(Object.assign({}, view, { state: Object.assign({}, view.state, patch) }));
  };
  // Untick the Unfollow box: the page sends the box it changed, nothing else.
  pushed(view);
  byId.unfollow.checked = false;
  (byId.unfollow.listeners.change || []).forEach(function (fn) { fn({}); });
  assert.deepStrictEqual(plain(drawn[drawn.length - 1]), { unfollow: false });
  // The Enable box is the scheduler's own switch.
  byId.enabled.checked = true;
  (byId.enabled.listeners.change || []).forEach(function (fn) { fn({}); });
  assert.deepStrictEqual(plain(drawn[drawn.length - 1]), { enabled: true });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  // The party vocabulary the reference's own tooltip lists.
  assert.ok(byId.party.children.length > 0, 'the page lists the party commands');
});

test('every control the Maid page draws has its own id in the page', async () => {
  const source = fs.readFileSync(path.join(pluginRoot, 'features/maid/maid.html'), 'utf8');
  // The page reads its controls by id, so an id it asks for that the markup does not carry is a
  // broken window. This walks the ones the tests above do not touch through the same door.
  const asked = ['RelogDelay', 'SkillDelay', 'SafeSkillHP', 'WhitelistMapMaps', 'LockedZoneHandlerMaps',
    'AttackPriorityMonster', 'BuffStopAttackList', 'SafeSkillList', 'SkillList', 'Target'];
  asked.forEach(function (id) {
    assert.ok(new RegExp('id="' + id + '"').test(source), 'the markup is missing #' + id);
  });
  // The reference's own control words are in the catalog, not spelled only in the page.
  const words = require('../../plugins/grimlite-parity/locales/en-US.js').maidMessages;
  ['title', 'enable', 'unfollow', 'stopAttack', 'globalHotkey', 'save', 'load', 'autoload',
    'loadTitle', 'saveTitle', 'filterName', 'optionAntiCounter', 'optionCopyWalk',
    'optionStopFailedGoto', 'optionWaitSkill', 'partyCommands'].forEach(function (key) {
    assert.strictEqual(typeof words[key], 'string', 'maidMessages.' + key + ' is missing');
  });
  assert.strictEqual(words.unfollow, 'Unfollow (R)', 'the reference\'s own control text');
  assert.strictEqual(words.stopAttack, 'StopAttack (T)', 'the reference\'s own control text');
  assert.strictEqual(words.loadTitle, 'Load config');
  assert.strictEqual(words.filterName, 'Maid config');
});

test('the plugin\'s locale catalog and its template stay in step', () => {
  const en = require('../../plugins/grimlite-parity/locales/en-US.js');
  const template = require('../../plugins/grimlite-parity/locales/template.js');
  assert.deepStrictEqual(Object.keys(template.maidMessages).sort(),
    Object.keys(en.maidMessages).sort(), 'maidMessages must be in both');
  // The template is the catalogue's shape with empty strings (scripts/make-locale-templates.js),
  // so what has to match is the key list, and every key has a real English string behind it.
  assert.ok(Object.prototype.hasOwnProperty.call(template.windowTitles, 'maid'),
    'windowTitles.maid must be in both');
  assert.strictEqual(en.windowTitles.maid, 'Maid Remake');
  Object.keys(en.maidMessages).forEach(function (key) {
    assert.strictEqual(typeof en.maidMessages[key], 'string', 'maidMessages.' + key + ' must be text');
    assert.ok(en.maidMessages[key].length > 0, 'maidMessages.' + key + ' must not be empty');
  });
});
