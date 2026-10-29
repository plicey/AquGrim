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
const maidZones = require('../../plugins/grimlite-parity/features/maid/zones.js');
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
  assert.strictEqual(state.keybindDefaults.grimliteMaid, undefined,
    'Grimlite ships no default hotkeys');
  const binding = state.keybinds.filter(function (one) { return one.id === 'grimliteMaid'; });
  assert.strictEqual(binding.length, 1, 'the Maid\'s window has its own binding');
  const menus = state.menus.map(function (contribute) { return contribute({ labels: {}, keybinds: {} }); });
  const flat = menus.reduce(function (all, group) { return all.concat(group); }, []);
  const entry = flat.filter(function (one) { return one.label === 'Maid'; });
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

// ------------------------------------------------------------------ the handler panel (#44)

/**
 * The slice of the plugin Host this half needs: somewhere to log, an IPC registry, and a tap whose
 * subscription is counted - the subscription itself is asserted below, because taking one at
 * activation is the thing this app forbids (test/unit/packet-logger.test.js).
 */
function fakeZoneHost(deps) {
  const opts = deps || {};
  const handlers = [];
  const listeners = [];
  const host = {
    pluginId: 'grimlite-parity',
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    log: function () {},
    getLocaleStrings: function () { return {}; },
    getStore: function () { return { get: function () {}, set: function () {} }; },
    ipc: {
      handle: function (channel, listener) { handlers.push({ channel: channel, listener: listener }); },
      handlers: handlers
    },
    featureWindows: [],
    registerFeatureWindows: function (defs) {
      defs.forEach(function (def) { host.featureWindows.push(def); });
    },
    windows: {
      openFeatureWindow: function (id) { return { id: id }; }
    },
    packets: {
      on: function (event, listener) {
        listeners.push(listener);
        return function () {
          const at = listeners.indexOf(listener);
          if (at !== -1) listeners.splice(at, 1);
        };
      },
      emit: function (frame) { listeners.slice().forEach(function (one) { one(frame); }); },
      subscribed: function () { return listeners.length; }
    },
    // The game access this half is handed when none is injected: a read that answers nothing and a
    // frame write that always takes, which is enough for a panel that makes no calls of its own.
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function () { return Promise.resolve({ ok: true, value: null }); }
    },
    opts: opts
  };
  return host;
}

test('the panel carries the reference\'s own combo and its two-part switch', async () => {
  // cmbSpecials.SelectedItem + chkSpecial.Checked, which UpdateSpecialHandler reads as a pair. The
  // two are kept apart because SetSpecialHandlerFromScript's Switch mode sets the selection and
  // deliberately leaves the box alone.
  const made = maidWindow.createFromHost(fakeZoneHost());
  const zones = made.zones;
  assert.deepStrictEqual(zones.names(),
    require('../../plugins/grimlite-parity/features/maid/zones.js').NAMES);
  assert.strictEqual(zones.active(), null, 'nothing is registered until the box is ticked');
  assert.strictEqual(zones.checked(), false);

  // Selecting alone registers nothing, which is the reference's own guard on the tick.
  zones.select('Auto Zone - Ultradage');
  assert.strictEqual(zones.selected(), 'Auto Zone - Ultradage');
  assert.strictEqual(zones.active(), null);
  // Ticking registers the selection; unticking unregisters it and leaves the selection where it is
  // (the reference's Stop path clears the box, not the combo).
  zones.enable(true);
  assert.strictEqual(zones.active(), 'Auto Zone - Ultradage');
  zones.enable(false);
  assert.strictEqual(zones.active(), null);
  assert.strictEqual(zones.selected(), 'Auto Zone - Ultradage');
  zones.enable(true);

  // The script door: Start (true), Stop (false), Switch (null = leave the box as it is).
  assert.strictEqual(zones.set('Gramiel P1', null), 'Gramiel P1', 'Switch keeps the box ticked');
  assert.strictEqual(zones.checked(), true, 'which is what "as it is" means here');
  assert.strictEqual(zones.set('Gramiel P2', false), null, 'Stop unregisters');
  assert.strictEqual(zones.set('Gramiel P2', true), 'Gramiel P2', 'Start registers');
  // A name the combo does not hold is the reference's own FindStringExact -1: nothing moves.
  assert.strictEqual(zones.set('Auto Zone - Utgarde', true), 'Gramiel P2');
  assert.strictEqual(zones.selected(), 'Gramiel P2');
  zones.enable(false);
  await made.maid.idle();
});

test('the panel is the one CmdSpecialHandler reaches, so a bot file can start a run', async () => {
  // The seam the engine is handed (main.js) is this object. What matters here is that the command's
  // own call shape - set(name, wanted) - is the one the panel answers, because that is what makes
  // SetSpecialHandlerFromScript real rather than a log line.
  const made = maidWindow.createFromHost(fakeZoneHost());
  const panel = made.zones;
  assert.strictEqual(typeof panel.set, 'function');
  assert.strictEqual(typeof panel.names, 'function');
  assert.deepStrictEqual(panel.set('Ultra Speaker DPS', true), 'Ultra Speaker DPS');
  const state = panel.state();
  assert.strictEqual(state.active, 'Ultra Speaker DPS');
  assert.strictEqual(state.checked, true);
  assert.strictEqual(state.selected, 'Ultra Speaker DPS');
  panel.set('Ultra Speaker DPS', false);
  await made.maid.idle();
});

test('a selected Speaker role uses the shared scheduler while Maid mode stays off', async () => {
  const host = fakeZoneHost();
  const calls = [];
  const values = {
    IsLoggedIn: true, Health: 100, Map: 'ultraspeaker', Cell: 'Boss',
    Position: ['100', '321'], HasTarget: false, IsMonsterAvailable: true,
    PlayersInMap: ['injured'], AttackMonster: true, UseSkill: true
  };
  let made = null;
  const game = {
    loaderCall: function (name, args) {
      calls.push({ name: name, args: args || [] });
      if (name === 'GetPlayerHealthPercentage') {
        if (made) made.zones.enable(false);
        return Promise.resolve(69);
      }
      return Promise.resolve(values[name]);
    },
    read: function () { return Promise.resolve({ value: null }); },
    sendServerFrame: function () { return true; },
    sleep: function () { return Promise.resolve(); }
  };
  made = maidWindow.createFromHost(host, { game: game, party: null });
  made.attach();
  // AntiCounter ships ticked and keeps its own subscription; switch it off so this test sees
  // only the selected handler's own tap.
  made.window.set({ config: { AntiCounter: false } });
  made.zones.set('Ultra Speaker LOO', true);
  await made.maid.idle();

  assert.strictEqual(made.maid.state().enabled, false,
    'the scheduler services the role without enabling Maid follow/combat');
  assert.ok(calls.some(function (one) { return one.name === 'AttackMonster' && one.args[0] === '*'; }),
    'the role acquires a target when none is set');
  assert.ok(calls.some(function (one) { return one.name === 'UseSkill' && one.args[0] === '2'; }),
    'LOO heals an injured party member with skill 2');
  assert.strictEqual(host.packets.subscribed(), 0,
    'stopping the selected handler releases its frame subscription and scheduler work');
});

test('the Auto Potion mode reaches waitSkill through the wired Maid scheduler', async () => {
  const calls = [];
  let skillReads = 0;
  const values = {
    IsLoggedIn: true, Map: 'yulgar', Cell: 'Enter', Health: 100, HealthMax: 100,
    PlayersInMap: ['master'], GetCellPlayers: true, HasTarget: true,
    GetInventoryItems: [{ sName: 'Felicitous Philtre', bEquip: 1, iQty: 1 }],
    UserID: 7, ForceUseSkill: true, UseSkill: true,
    SkillAvailable: function () { return ++skillReads === 1 ? 0 : 1; }
  };
  const game = {
    loaderCall: function (name, args) {
      calls.push({ name: name, args: args || [] });
      const value = values[name];
      return Promise.resolve(typeof value === 'function' ? value(args) : value);
    },
    read: function () { return Promise.resolve({ value: null }); },
    sendServerFrame: function () { return true; },
    sleep: function () { return Promise.resolve(); }
  };
  const made = maidWindow.createFromHost(fakeZoneHost(), { game: game, party: null });
  made.window.set({ config: {
    UltraBossExtra: maidZones.MODES.indexOf('Auto Potion'), RelogDelay: 0, SkillDelay: 1
  } });
  made.maid.setTarget('master');
  made.maid.setEnabled(true);
  await made.maid.tick();
  await made.maid.tick();
  assert.ok(calls.some(function (one) { return one.name === 'GetInventoryItems'; }));
  assert.ok(calls.some(function (one) { return one.name === 'ForceUseSkill' && one.args[0] === '5'; }),
    'an equipped, stocked potion without its aura forces skill 5');
  await made.maid.stop();
});

test('the Maid view exposes per-boss modes and applies their reference defaults', async () => {
  const made = maidWindow.createFromHost(fakeZoneHost());
  assert.deepStrictEqual(made.window.view().modes, maidZones.MODES,
    'the page gets the reference\'s mode names and order');

  const selected = made.window.set({ config: { UltraBossExtra: 2 } }).state.config;
  assert.strictEqual(selected.AttackPriority, true);
  assert.strictEqual(selected.AttackPriorityMonster, 'Ascended Solstice');
  assert.strictEqual(selected.SpecialMsg, 'sun converges');
  assert.strictEqual(selected.SpecialAct, 5);
  await made.maid.idle();
});

test('loading a boss mode applies its selector effects in the reference config order', () => {
  const made = maidWindow.createFromHost(fakeZoneHost());
  const loaded = made.window.load(JSON.stringify({
    UltraBossExtra: 2,
    AttackPriority: false,
    AttackPriorityMonster: 'file target',
    SpecialMsg: 'file phrase',
    SpecialAct: 4
  }));
  assert.strictEqual(loaded.ok, true);
  const state = made.window.config();
  assert.strictEqual(state.AttackPriority, false, 'the later config checkbox wins');
  assert.strictEqual(state.AttackPriorityMonster, 'Ascended Solstice',
    'the selector event runs after the target text is loaded');
  assert.strictEqual(state.SpecialMsg, 'sun converges',
    'the selector event runs after the phrase text is loaded');
  assert.strictEqual(state.SpecialAct, 4, 'the later skill value wins');
});

test('switching a handler on takes the tap with no window open, and off gives it back', () => {
  // The acceptance criterion is that a handler is driven by live frames. A panel switched on from a
  // bot command (CmdSpecialHandler) has nobody watching its form, so this half has to take the
  // subscription itself - which is also what makes the cleanup real rather than theoretical.
  const host = fakeZoneHost();
  const made = maidWindow.createFromHost(host);
  made.attach();
  assert.strictEqual(host.packets.subscribed(), 1,
    'PartyCmd ships ticked, so the form\'s handlers are alive from activation (MaidRemake.cs:100-105)');

  made.zones.set('Auto Zone - Ultradage', true);
  assert.strictEqual(host.packets.subscribed(), 1, 'one subscription serves both halves');

  // And it really is this half\'s frame that reaches the handler: the Ultradage walker answers an
  // event frame by walking, which needs the fake game behind the window.
  made.zones.set('Auto Zone - Ultradage', false);
  assert.strictEqual(host.packets.subscribed(), 1,
    'the party handlers stay alive for the session, so the tap is still held');
  made.zones.set('Gramiel P1', true);
  assert.strictEqual(host.packets.subscribed(), 1);
  made.unwatch(null);
  assert.strictEqual(host.packets.subscribed(), 1,
    'a registration outlives an unwatch that was never watching');
  made.zones.set('Gramiel P1', false);
  assert.strictEqual(host.packets.subscribed(), 1, 'and so does PartyCmd');
  made.window.set({ config: { AntiCounter: false } });
  made.window.set({ partyCmd: false });
  assert.strictEqual(host.packets.subscribed(), 0, 'unticking PartyCmd is what releases the tap');
  made.window.set({ partyCmd: true });
  assert.strictEqual(host.packets.subscribed(), 1, 'and ticking it takes the tap back');
});

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
  assert.ok(fixture.game.calls.some(function (one) {
    return one.name === 'read' && one.args[0] === maidWindow.PLAYERNAME_PATH;
  }));
  // No character signed in is a silent no-op, the reference's own `if (Player.IsLoggedIn)`.
  const blankGame = {
    loaderCall: function () { return Promise.resolve(false); },
    read: function () { return Promise.resolve({ value: null }); }
  };
  const blankMaid = maidModel.createMaid({
    game: blankGame,
    config: function () { return {}; },
    sleep: function () { return Promise.resolve(); },
    send: function () { return true; }
  });
  const blank = maidWindow.createMaidWindow({
    maid: blankMaid,
    game: blankGame,
    messages: {}
  });
  const refused = await blank.me();
  assert.strictEqual(refused.ok, true);
  assert.strictEqual(refused.silent, true);
  assert.strictEqual(blank.view().state.target, '');
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
  const known = maidWindow.CHANNELS.concat(['maidWatch', 'maidState', 'maidOpenMaps']);
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
  'players', 'partyCmd', 'partyCmdLabel', 'skillDelayMs', 'stopAttackRow',
  'lockedMapLink', 'whitelistMapLink', 'optionsGroup',
  'RelogDelay', 'SkillDelay', 'SafeSkill', 'SafeSkillList', 'SafeSkillHP', 'BuffStopAttack',
  'BuffStopAttackList', 'AttackPriority', 'AttackPriorityMonster', 'unfollow', 'stopAttack',
  'UltraBossExtra', 'SpecialMsg', 'SpecialAct', 'cbSpecialAnims',
  'GlobalHotkey', 'LockedZoneHandler', 'WhitelistMap', 'LockedZoneHandlerMaps',
  'WhitelistMapMaps', 'options', 'save', 'load', 'party', 'me', 'enableLabel',
  'targetLegend', 'combatLegend', 'keysLegend', 'optionsLegend', 'mapsLegend', 'configLegend',
  'specialLegend', 'ultraBossExtraLabel', 'specialMsgLabel', 'specialActLabel', 'specialAnimsLabel',
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
    body: element(),
    listeners: {},
    addEventListener: function (type, fn) {
      (document.listeners[type] = document.listeners[type] || []).push(fn);
    },
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
        state: { enabled: false, status: 'off', unfollow: false, stopAttack: false,
          specialAnims: true, target: '',
          config: Object.assign({}, maidZones.DESIGNER, config.defaults()), loadedFrom: null, missing: [] },
        presets: ['EC', 'LC'],
        modes: maidZones.MODES,
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
    players: function () { return Promise.resolve(['Kirin']); },
    openMaps: function () { return Promise.resolve({ ok: true }); },
    maps: function () { return Promise.resolve({ ok: true }); },
    onState: function (listener) { pushed = listener; return function () {}; }
  };

  vm.runInNewContext(script[1], {
    window: { aquastarMaid: api }, document: document,
    setInterval: function () { return 1; }, clearInterval: function () {}
  });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  await new Promise(function (resolve) { setTimeout(resolve, 0); });

  assert.ok(byId.state.textContent, 'the state line says what the scheduler is doing');
  assert.strictEqual(byId.state.className, 'off');
  // The state push repaints the line, which is what makes a key pressed elsewhere visible.
  pushed({ state: { enabled: true, status: 'stop attack is on', unfollow: true, stopAttack: true,
    specialAnims: true, target: 'kirin', config: Object.assign({}, maidZones.DESIGNER, config.defaults()),
    missing: [] }, fields: { all: config.FIELDS,
    numbers: config.NUMBERS, booleans: config.BOOLEANS }, messages: {}, presets: [] });
  assert.strictEqual(byId.state.textContent, 'stop attack is on');
  assert.strictEqual(byId.unfollow.checked, true, 'the Unfollow box follows the state');
  assert.strictEqual(byId.stopAttack.checked, true);
  assert.strictEqual(byId.cbSpecialAnims.checked, true);
  assert.deepStrictEqual(plain(byId.UltraBossExtra.children.map(function (option) { return option.textContent; })),
    maidZones.MODES);
  assert.strictEqual(byId.UltraBossExtra.value, '0');
  assert.strictEqual(byId.SpecialMsg.value, maidZones.DESIGNER.SpecialMsg);
  assert.strictEqual(byId.SpecialAct.value, String(maidZones.DESIGNER.SpecialAct));
  assert.strictEqual(byId.Target.value, 'kirin');
  // One change from the page reaches the window with the field it is about.
  const view = {
    state: { enabled: true, status: 'unfollowed', unfollow: true, stopAttack: true,
      specialAnims: true, target: 'kirin',
      config: Object.assign({}, maidZones.DESIGNER, config.defaults()), missing: [] },
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
  byId.UltraBossExtra.value = '2';
  (byId.UltraBossExtra.listeners.change || []).forEach(function (fn) { fn({}); });
  assert.deepStrictEqual(plain(drawn[drawn.length - 1]), { config: { UltraBossExtra: '2' } });
  byId.cbSpecialAnims.checked = false;
  (byId.cbSpecialAnims.listeners.change || []).forEach(function (fn) { fn({}); });
  assert.deepStrictEqual(plain(drawn[drawn.length - 1]), { specialAnims: false });
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
    'optionStopFailedGoto', 'optionWaitSkill', 'partyCommands', 'specials', 'specialAnims',
    'ultraBossExtra', 'specialMsg', 'specialAct'].forEach(function (key) {
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
test('enabling the Maid arms its own handlers, which is what makes them live', () => {
  // The Maid form's own two subscriptions (MaidRemake.cs:99 and :161, `Flash.FlashCall2 +=`,
  // inside cbEnablePlugin_CheckedChanged) are taken when the plugin's Enable box is ticked and
  // given back by stopMaid (:971-996). A handler that is never armed reads no frames, so this is
  // the difference between a ported handler and a dead one.
  const host = fakeZoneHost();
  const made = maidWindow.createFromHost(host);
  made.attach();
  assert.strictEqual(made.zones.maid(), false, 'the Maid is off until its box is ticked');

  made.zones.set('Gramiel P1', true);
  assert.strictEqual(made.zones.maid(), false,
    'an auto-zone handler is the Bot Manager\'s, not the Maid form\'s: it arms nothing of its own');

  made.window.set({ enabled: true });
  assert.strictEqual(made.zones.maid(), true, 'ticking Enable arms the Maid\'s own handlers');
  made.window.set({ enabled: false });
  assert.strictEqual(made.zones.maid(), false, 'and stopMaid disarms them again');
  made.zones.set('Gramiel P1', false);
  return made.maid.idle();
});

// ------------------------------------------------------------------ PartyCmd and the two map forms

test('PartyCmd ships ticked and gates both party chat and invitations', async () => {
  const host = fakeZoneHost();
  const made = maidWindow.createFromHost(host);
  made.attach();
  assert.strictEqual(made.window.view().state.partyCmd, true, 'cbPartyCmd.Checked = true');
  const invitation = { direction: 'toClient', data: JSON.stringify({ command: 'pi', pid: '5' }) };
  assert.ok(made.party.handleFrame(invitation), 'a ticked PartyCmd answers an invitation');
  made.window.set({ partyCmd: false });
  assert.strictEqual(made.party.enabled(), false);
  assert.strictEqual(made.party.handleFrame(invitation), null, 'unticked: no invitation answer');
  assert.strictEqual(made.handleFrame({
    direction: 'toClient', data: '%xt%zm%chatm%1%party~.join yulgar%'
  }), null, 'unticked: no party command either');
  made.window.set({ partyCmd: true });
  assert.ok(made.party.handleFrame(invitation));
});

test('.start and .stop take the same announce path as the Enable box', async () => {
  const host = fakeZoneHost();
  const made = maidWindow.createFromHost(host);
  made.attach();
  assert.strictEqual(made.zones.maid(), false);
  const start = await made.party.handleFrame({
    direction: 'toClient', data: '%xt%zm%chatm%1%party~.start%'
  });
  assert.strictEqual(start.ok, true);
  assert.strictEqual(made.maid.state().enabled, true, '.start turns the Maid on');
  assert.strictEqual(made.zones.maid(), true, 'through the same announce -> zones.setMaid path');
  await made.party.handleFrame({
    direction: 'toClient', data: '%xt%zm%chatm%1%party~.stop%'
  });
  assert.strictEqual(made.maid.state().enabled, false);
  assert.strictEqual(made.zones.maid(), false);
  await made.maid.settled();
});

test('the two map sub-windows register from the Maid and answer their own controls', async () => {
  const host = fakeZoneHost();
  const made = maidWindow.createFromHost(host);
  made.attach();
  const ids = host.featureWindows.map(function (one) { return one.id; });
  assert.ok(ids.indexOf(maidWindow.MAP_WINDOW_IDS.locked) !== -1);
  assert.ok(ids.indexOf(maidWindow.MAP_WINDOW_IDS.whitelist) !== -1);
  const locked = host.featureWindows.filter(function (one) {
    return one.id === maidWindow.MAP_WINDOW_IDS.locked;
  })[0];
  assert.ok(/maps\.html\?kind=locked$/.test(locked.url), 'the locked page is the map form');
  assert.ok(/preload_maps\.js$/.test(locked.config.webPreferences.preload));

  const window = made.window;
  const defaults = window.maps({ kind: 'locked', action: 'get' });
  assert.strictEqual(defaults.counter, 6, 'doomvault, doomvaultb, icewing, voidflibbi, voidnightbane, voidxyfrag');
  const whitelist = window.maps({ kind: 'whitelist', action: 'get' });
  assert.strictEqual(whitelist.counter, 4, 'the four shipped whitelist maps');
  const checked = window.maps({ kind: 'whitelist', action: 'check' });
  assert.ok(/in all cells/.test(checked.preview), 'an all-cell whitelist row says so');
  const set = window.maps({ kind: 'whitelist', action: 'set', text: 'Citadel-6666;all\r\nb' });
  assert.strictEqual(set.counter, 2);
  const added = window.maps({ kind: 'whitelist', action: 'add', piece: 'c;Enter;Spawn' });
  assert.ok(/\r\nc;Enter;Spawn$/.test(added.text));
  const cleared = window.maps({ kind: 'whitelist', action: 'clear' });
  assert.strictEqual(cleared.counter, 0);
  assert.strictEqual(cleared.text, '');
});

test('the window clamps the four numeric boxes and starts the preset combo blank', () => {
  const fixture = maidFixture();
  assert.strictEqual(fixture.window.view().state.preset, '', 'cmbPreset has no selection');
  const state = fixture.window.set({ config: { SkillDelay: 10, RelogDelay: 70000, SafeSkillHP: 0 } })
    .state.config;
  assert.strictEqual(state.SkillDelay, 50);
  assert.strictEqual(state.RelogDelay, 60000);
  assert.strictEqual(state.SafeSkillHP, 1);
  assert.strictEqual(fixture.window.preset('LC').view.state.preset, 'LC');
});

test('Save opens the folder without a pre-filled file name', async () => {
  let asked = null;
  const dialogs = maidWindow.createDialogs({
    messages: {},
    electron: function () {
      return {
        dialog: {
          showSaveDialog: function (owner, options) {
            asked = options;
            return Promise.resolve({ canceled: true });
          }
        }
      };
    }
  });
  await dialogs.save(null, '{}', { directory: '/tmp/aquastar-config', name: 'autoload.json' });
  assert.strictEqual(asked.defaultPath, '/tmp/aquastar-config',
    'btnSave_Click pre-fills InitialDirectory only');
});

test('unticking Global Hotkey unchecks Unfollow and StopAttack', () => {
  const calls = [];
  const keys = maidWindow.createKeys({
    maid: {
      state: function () { return {}; },
      toggleUnfollow: function () {}, toggleStopAttack: function () {},
      setUnfollow: function (on) { calls.push(['unfollow', on]); },
      setStopAttack: function (on) { calls.push(['stopAttack', on]); }
    },
    log: function () {},
    localShortcuts: { register: function () { return true; }, unregister: function () {} },
    globalShortcuts: { register: function () { return true; }, unregister: function () {} },
    accelerators: function () { return {}; }
  });
  keys.apply(true);
  assert.deepStrictEqual(calls, [], 'ticking the global box leaves the two boxes alone');
  keys.apply(false);
  assert.deepStrictEqual(calls, [['unfollow', false], ['stopAttack', false]],
    'cbEnableGlobalHotkey_CheckedChanged unticks both on the way out');
});

test('the constructor pre-fills the target from the signed-in character', async () => {
  const fixture = maidFixture();
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual(fixture.window.view().state.target, 'kirin');
  assert.ok(fixture.game.calls.some(function (one) { return one.name === 'read'; }));
});

test('enabling with the locked-zone box and no maps unticks it, otherwise it re-inits', () => {
  const empty = maidWindow.createFromHost(fakeZoneHost());
  empty.window.set({ config: { LockedZoneHandler: true, LockedZoneHandlerMaps: '' } });
  empty.window.set({ enabled: true });
  assert.strictEqual(empty.window.config().LockedZoneHandler, false,
    'MaidRemake.cs:230-233 unticks a handler with no alternative maps');
  empty.window.set({ enabled: false });

  const full = maidWindow.createFromHost(fakeZoneHost());
  full.window.set({ config: { LockedZoneHandler: true, LockedZoneHandlerMaps: 'a;Enter;Spawn' } });
  full.window.set({ enabled: true });
  assert.strictEqual(full.window.config().LockedZoneHandler, true, 'a non-empty list stays ticked');
  assert.strictEqual(full.zones.lockedIndex(), 0, 'and AlternativeMap.Init reset the round-robin');
  full.window.set({ enabled: false });
  return empty.maid.settled().then(function () { return full.maid.settled(); });
});

test('the page carries the reference labels, limits and startUI lockouts', () => {
  const source = fs.readFileSync(path.join(pluginRoot, 'features/maid/maid.html'), 'utf8');
  ['Goto Username:', 'Skill List:', 'Skill Delay:', 'AttackPriority:', 'skill action:',
    'Config : Default', 'PartyCmd', '[Auto accept any party invitation when checked]'
  ].forEach(function (text) {
    assert.ok(source.indexOf(text) !== -1, 'the page is missing ' + text);
  });
  assert.ok(/id="SkillDelay"[^>]*min="50"[^>]*max="60000"/.test(source));
  assert.ok(/id="RelogDelay"[^>]*max="60000"/.test(source));
  assert.ok(/id="SafeSkillHP"[^>]*min="1"[^>]*max="99"/.test(source));
  assert.strictEqual(source.indexOf('id="autoload"'), -1, 'the Autoload button is gone');
  assert.ok(/event\.key === 'r'/.test(source), 'the form reads bare R while it has focus');
  assert.ok(/INPUT\|TEXTAREA\|SELECT/.test(source), 'and is suppressed inside a box or combo');
  assert.ok(/drawStopwatch/.test(source), 'StopAttack carries the elapsed-time title');
});

test('Maid retries its target prefill when the window opens after login', async () => {
  let signedIn = false;
  const game = fakeGame({ 'world.myAvatar.objData.strUsername': 'Kirin' });
  game.loaderCall = async function () { return signedIn; };
  const maid = maidModel.createMaid({ game, sleep: async function () {} });
  const window = maidWindow.createMaidWindow({ maid, game });
  await window.prefillTarget();
  assert.strictEqual(maid.getTarget(), '');
  signedIn = true;
  await window.handle('maidView');
  assert.strictEqual(maid.getTarget(), 'kirin', 'login after plugin activation must initialize the master');
  window.set({ target: 'Other' });
  await window.handle('maidView');
  assert.strictEqual(maid.getTarget(), 'other', 'opening again preserves an explicit master');
});

test('Maid loaded and edited Target config reaches the scheduler master', async () => {
  const fixture = maidFixture();
  await fixture.window.prefillTarget();
  fixture.window.load('{"Target":"Other"}', 'maid.json');
  assert.strictEqual(fixture.maid.getTarget(), 'other', 'loading a config must update follow/combat gates');
  fixture.window.set({ config: { Target: 'Third' } });
  assert.strictEqual(fixture.maid.getTarget(), 'third');
});

test('Maid enable retries prefill after activation before login without opening its window', async () => {
  let signedIn = false;
  const game = fakeGame({ 'world.myAvatar.objData.strUsername': 'Kirin' });
  game.loaderCall = async function () { return signedIn; };
  const maid = maidModel.createMaid({ game, sleep: async function () {} });
  let starts = 0;
  maid.start = function () { starts++; };
  const window = maidWindow.createMaidWindow({ maid, game });
  await window.prefillTarget();
  signedIn = true;
  window.set({ enabled: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(starts, 1);
  assert.strictEqual(maid.getTarget(), 'kirin');
  window.set({ enabled: false });
});
