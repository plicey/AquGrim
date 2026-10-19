// The Hotkeys window (ticket #34). Reference: Grimlite-Li 816d9cd.
//
// Where every expected value below comes from:
//   Grimoire/UI/Hotkeys.cs:394-417   the action vocabulary, in order (the index IS the persisted
//                                    ActionIndex, so the order is part of the file format)
//   Grimoire/UI/Hotkeys.cs:328-384   the key picker's list: single keys only
//   Grimoire/UI/Hotkeys.cs:127-241   nothing ships bound; hotkeys.json is the whole state
//   Grimoire/UI/Hotkeys.cs:245-263   a bound key fires only while the app has focus, except
//                                    "Minimize to tray"
//   Grimoire/Tools/Hotkey.cs:5-38    the persisted record: Text, Key, ActionIndex
//
// The reference's picker offers bare Alt and Shift, which this app's shortcut layer cannot
// register on their own; binding one of those is refused with that reason rather than accepted
// and left inert.
const assert = require('assert');
const path = require('path');

const pluginRoot = path.join(__dirname, '../../plugins/grimlite-parity');
const hotkeysModule = require(path.join(pluginRoot, 'features/hotkeys/hotkeys.js'));
const actions = require(path.join(pluginRoot, 'features/hotkeys/actions.js'));

const ACTION_LABELS = [
  'Start/Stop Bot', 'Show Bot', 'Show Hotkeys', 'Show Loaders', 'Show Packet Logger',
  'Show Packet Spammer', 'Show Packet Tamperer', 'Show Fast Travels', 'Show Maid',
  'Start/Stop Maid', 'Change Launcher Skin', 'Cancel Target', 'Minimize to tray', 'Show Bank',
  'Show Cosmetics form', 'Show Logs', 'Show Notepad', 'Load Hair shop', 'Load Armor Customizer',
  'Toggle Options', 'Show DropUi', 'Show Swf Dev test', 'Start/Stop AutoAttack'
];

function memoryStore(initial) {
  let value = initial;
  return {
    read: function () { return value; },
    write: function (next) { value = next; return value; },
    readOrCreate: function (make) { if (value === undefined) value = make(); return value; }
  };
}

function fakeShortcuts() {
  const live = {};
  return {
    live: live,
    register: function (accelerator, fn) {
      if (live[accelerator]) return false; // the platform's layer refuses a double registration
      live[accelerator] = { fn: fn, fired: 0 };
      return true;
    },
    unregister: function (accelerator) { delete live[accelerator]; },
    // What a real keypress does.
    press: function (accelerator) {
      if (!live[accelerator]) return null;
      live[accelerator].fired++;
      return live[accelerator].fn();
    },
    keys: function () { return Object.keys(live); }
  };
}

function createHotkeys(deps) {
  deps = deps || {};
  const local = deps.shortcuts || fakeShortcuts();
  const global = deps.globalShortcuts || fakeShortcuts();
  const opened = deps.opened || [];
  const feature = hotkeysModule.createHotkeys({
    store: deps.store || memoryStore(undefined),
    localShortcuts: local,
    globalShortcuts: global,
    openWindow: function (id) { opened.push(id); return { ok: true, id: id }; },
    // The windows this plugin has registered right now (windows.js is the only list).
    windowIds: deps.windowIds || ['grimlite-parity-hotkeys', 'grimlite-parity-notepad',
      'grimlite-parity-devtest', 'grimlite-parity-packet-logger', 'grimlite-parity-logs'],
    takenKeys: deps.takenKeys || [],
    platform: deps.platform || {
      showMainWindow: function () { opened.push('main-window'); },
      toggleMainWindow: function () { opened.push('main-window-toggle'); }
    },
    gameCalls: deps.gameCalls || { call: function () { return Promise.resolve({ ok: true, value: null }); } },
    log: function () {}
  });
  return { feature: feature, local: local, global: global, opened: opened };
}

test('the action vocabulary is the reference\'s, in the reference\'s own order', () => {
  assert.deepStrictEqual(
    actions.ACTIONS.map(function (a) { return a.label; }),
    ACTION_LABELS
  );
  // The index is what a saved hotkey stores, so the order is the file format.
  actions.ACTIONS.forEach(function (action, index) {
    assert.strictEqual(actions.byIndex(index).label, action.label);
  });
  assert.strictEqual(actions.byIndex(23), null, 'the reference\'s unreachable 24th delegate is not shipped');
});

test('the key picker offers the reference\'s single keys, and nothing with a modifier', () => {
  assert.deepStrictEqual(actions.KEYS.slice(0, 5), ['Escape', 'Left', 'Up', 'Right', 'Down']);
  assert.deepStrictEqual(actions.KEYS.slice(5, 15), ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9']);
  assert.deepStrictEqual(actions.KEYS.slice(15, 16), ['A']);
  assert.deepStrictEqual(actions.KEYS.slice(-3), ['Alt', 'Tab', 'Shift']);
  assert.strictEqual(actions.KEYS.length, 5 + 10 + 26 + 12 + 3);
  // Single keys: no combination is offered, which is the reference's own constraint.
  actions.KEYS.forEach(function (key) {
    assert.strictEqual(key.indexOf('+'), -1, key + ' is not a single key');
  });
});

test('the reference\'s key names translate to what this app\'s shortcut layer takes', () => {
  assert.strictEqual(actions.acceleratorFor('D0'), '0');
  assert.strictEqual(actions.acceleratorFor('D9'), '9');
  assert.strictEqual(actions.acceleratorFor('A'), 'A');
  assert.strictEqual(actions.acceleratorFor('F5'), 'F5');
  assert.strictEqual(actions.acceleratorFor('Escape'), 'Escape');
  assert.strictEqual(actions.acceleratorFor('Left'), 'Left');
  // Bare modifiers cannot be registered on their own in Electron; that is a stated limit.
  assert.strictEqual(actions.acceleratorFor('Alt'), null);
  assert.strictEqual(actions.acceleratorFor('Shift'), null);
  assert.strictEqual(actions.acceleratorFor('Nope'), null);
});

test('the set ships empty, as it does upstream', () => {
  const run = createHotkeys();
  assert.deepStrictEqual(run.feature.list(), []);
  assert.deepStrictEqual(run.local.keys(), []);
  assert.deepStrictEqual(run.global.keys(), []);
});

test('binding a key stores the reference\'s record and installs it', () => {
  const run = createHotkeys();
  const bound = run.feature.bind('D1', 3);
  assert.strictEqual(bound.ok, true, bound.error);

  // Hotkey.cs's own shape: Text, Key (the .NET Keys name), ActionIndex.
  assert.deepStrictEqual(run.feature.list(), [
    { Text: 'D1: Show Loaders', Key: 'D1', ActionIndex: 3 }
  ]);
  assert.deepStrictEqual(run.local.keys(), ['1']);

  run.feature.bind('B', 1);
  assert.deepStrictEqual(run.feature.list(), [
    { Text: 'D1: Show Loaders', Key: 'D1', ActionIndex: 3 },
    { Text: 'B: Show Bot', Key: 'B', ActionIndex: 1 }
  ]);
  assert.deepStrictEqual(run.local.keys(), ['1', 'B']);
});

test('firing a bound key runs its action, and a key already bound is refused', async () => {
  const run = createHotkeys();
  run.feature.bind('N', 16); // Show Notepad, a window this plugin has
  await run.local.press('N');
  assert.deepStrictEqual(run.opened, ['grimlite-parity-notepad']);

  // Hotkeys.cs:395 refuses a key its hook already holds; this port refuses the duplicate.
  const again = run.feature.bind('N', 21); // Show Swf Dev test
  assert.strictEqual(again.ok, false);
  assert.ok(/already bound/.test(again.error), again.error);
  assert.strictEqual(run.feature.list().length, 1);
  assert.strictEqual(run.feature.list()[0].ActionIndex, 16);
  await run.local.press('N');
  assert.deepStrictEqual(run.opened, ['grimlite-parity-notepad', 'grimlite-parity-notepad']);
  assert.deepStrictEqual(run.local.keys(), ['N']);

  // Clearing gives the key back and takes the binding away.
  assert.strictEqual(run.feature.clear('N'), true);
  assert.deepStrictEqual(run.feature.list(), []);
  assert.deepStrictEqual(run.local.keys(), []);
  assert.strictEqual(await run.local.press('N'), null);
});

test('an action whose window has not shipped yet is inert, and says so', async () => {
  const run = createHotkeys({ windowIds: [] });
  // "Show Logs" is the reference's action 15; this port has no Logs window yet, so the action must
  // not throw when the key is pressed.
  run.feature.bind('K', 15);
  const result = await run.local.press('K');
  assert.strictEqual(result.ok, false);
  assert.ok(/not shipped/.test(result.error), result.error);
  assert.deepStrictEqual(run.opened, [], 'an unshipped window is never opened');

  // Every action in the vocabulary is reachable: pressing each one answers instead of throwing.
  for (let index = 0; index < ACTION_LABELS.length; index++) {
    const single = createHotkeys();
    single.feature.bind('F5', index);
    // Minimize to tray is the one action on the app-wide layer (the reference's focus exemption).
    const layer = index === 12 ? single.global : single.local;
    const answer = await layer.press('F5');
    assert.ok(answer && typeof answer === 'object', 'action ' + index + ' answered nothing');
  }
});

test('the actions this port can already do reach the game or the window they name', async () => {
  const calls = [];
  const run = createHotkeys({
    gameCalls: {
      call: function (name, args) { calls.push([name, args]); return Promise.resolve({ ok: true, value: null }); }
    }
  });

  // Cancel Target: Player.CancelTarget() -> Flash.Call("CancelTarget", empty).
  run.feature.bind('C', 11);
  await run.local.press('C');
  assert.deepStrictEqual(calls, [['callGameFunction0', ['CancelTarget']]]);

  // Load Hair shop: Shop.LoadHairShop(1) -> Flash.Call("LoadHairShop", "1") - and LoadHairShop is
  // loader-only: the stock game carries no LoadHairShop member, only locals.
  run.feature.bind('H', 17);
  await run.local.press('H');
  assert.deepStrictEqual(calls[1], ['callGameFunction', ['LoadHairShop', '1']]);

  // Load Armor Customizer: Shop.LoadArmorCustomizer() -> Flash.Call(name, empty).
  run.feature.bind('M', 18);
  await run.local.press('M');
  assert.deepStrictEqual(calls[2], ['callGameFunction0', ['LoadArmorCustomizer']]);

  // Show Bank: Hotkeys.cs:408 calls Player.Bank.Show(), the game's own bank UI.
  run.feature.bind('B', 13);
  await run.local.press('B');
  assert.deepStrictEqual(calls[3], ['callGameFunction0', ['ShowBank']]);

  // Show Hotkeys: the reference's own window, which this ticket ships.
  run.feature.bind('Q', 2);
  await run.local.press('Q');
  assert.deepStrictEqual(run.opened, ['grimlite-parity-hotkeys']);

  // Show Packet Logger: shipped by another ticket; it opens because it is registered.
  run.feature.bind('L', 4);
  await run.local.press('L');
  assert.deepStrictEqual(run.opened.slice(1), ['grimlite-parity-packet-logger']);

  // Minimize to tray: the reference's one focus-exempt action, so it goes on the app-wide layer.
  run.feature.bind('T', 12);
  assert.deepStrictEqual(run.global.keys(), ['T']);
  await run.global.press('T');
  assert.deepStrictEqual(run.opened.slice(-1), ['main-window-toggle']);
  // Toggle Options: the reference's Start()/Stop() over the option loop.
  const options = require(path.join(pluginRoot, 'features/options/options.js'));
  assert.strictEqual(typeof options.createOptionsFeature, 'function');
});

test('a key the app or the game plugin already uses is refused, not taken', () => {
  const run = createHotkeys({ takenKeys: [{ key: 'F2', owner: 'the app (Screenshot)' }] });
  const refused = run.feature.bind('F2', 1);
  assert.strictEqual(refused.ok, false);
  assert.ok(/Screenshot/.test(refused.error), refused.error);
  assert.deepStrictEqual(run.feature.list(), []);
  assert.deepStrictEqual(run.local.keys(), []);

  // A free key still works.
  assert.strictEqual(run.feature.bind('D7', 1).ok, true);
});

test('the live shell actions reach the bot, auto attack, Maid, launcher skin and log window', async () => {
  const done = [];
  const run = createHotkeys({
    platform: {
      toggleBot: function () { done.push('bot'); return { ok: true }; },
      toggleAutoAttack: function () { done.push('auto'); return { ok: true }; },
      toggleMaid: function () { done.push('maid'); return { ok: true }; },
      toggleLauncherSkin: function () { done.push('skin'); return { ok: true }; },
      toggleMainWindow: function () { done.push('tray'); return { ok: true }; }
    }
  });

  const cases = [[0, '1', 'bot'], [9, '2', 'maid'], [10, '3', 'skin'], [12, '4', 'tray'], [22, '5', 'auto']];
  for (const one of cases) {
    assert.strictEqual(run.feature.bind('D' + one[1], one[0]).ok, true);
    const layer = one[0] === 12 ? run.global : run.local;
    const answer = await layer.press(one[1]);
    assert.strictEqual(answer.ok, true, answer.error);
  }
  assert.deepStrictEqual(done, ['bot', 'maid', 'skin', 'tray', 'auto']);

  // Show Logs is action 15 and now has its own window.
  assert.strictEqual(run.feature.bind('L', 15).ok, true);
  await run.local.press('L');
  assert.ok(run.opened.indexOf('grimlite-parity-logs') !== -1);
});

test('a bare modifier is refused with the reason this app cannot register it', () => {
  const run = createHotkeys();
  const refused = run.feature.bind('Alt', 1);
  assert.strictEqual(refused.ok, false);
  assert.ok(/on its own|single key/i.test(refused.error), refused.error);
  assert.deepStrictEqual(run.feature.list(), []);
});

test('a shortcut layer that refuses a key is reported, and nothing is remembered', () => {
  const run = createHotkeys();
  run.local.register = function () { return false; };
  const refused = run.feature.bind('G', 1);
  assert.strictEqual(refused.ok, false);
  assert.ok(refused.error, 'a refusal must say something');
  assert.deepStrictEqual(run.feature.list(), []);
});

test('the bindings survive a restart', () => {
  const store = memoryStore(undefined);
  const first = createHotkeys({ store: store });
  first.feature.bind('D3', 20);
  first.feature.save();
  first.feature.uninstall();

  const second = createHotkeys({ store: store });
  second.feature.install();
  assert.deepStrictEqual(second.feature.list(), [{ Text: 'D3: Show DropUi', Key: 'D3', ActionIndex: 20 }]);
  assert.deepStrictEqual(second.local.keys(), ['3']);
});

test('what the window reads is what it writes: one list, the reference\'s records', async () => {
  const store = memoryStore(undefined);
  const run = createHotkeys({ store: store });
  await run.feature.bind('Z', 0);
  await run.feature.bind('X', 22);
  await run.feature.save();
  const model = run.feature.view();
  assert.deepStrictEqual(model.actions, ACTION_LABELS);
  assert.deepStrictEqual(model.keys, actions.KEYS);
  assert.deepStrictEqual(model.bindings, [
    { Text: 'Z: Start/Stop Bot', Key: 'Z', ActionIndex: 0 },
    { Text: 'X: Start/Stop AutoAttack', Key: 'X', ActionIndex: 22 }
  ]);
  // The store holds exactly the reference's array, so an exported set maps onto the same actions.
  assert.deepStrictEqual(store.read(), [
    { Text: 'Z: Start/Stop Bot', Key: 'Z', ActionIndex: 0 },
    { Text: 'X: Start/Stop AutoAttack', Key: 'X', ActionIndex: 22 }
  ]);
});

test('Add and Remove only change the list; Save is the one write', () => {
  const store = memoryStore([]);
  const run = createHotkeys({ store: store });
  run.feature.bind('D1', 3);
  assert.deepStrictEqual(store.read(), [], 'Add does not write the file');
  run.feature.clear('D1');
  assert.deepStrictEqual(store.read(), [], 'Remove does not write the file either');

  run.feature.bind('D1', 3);
  const saved = run.feature.save();
  assert.strictEqual(saved.ok, true);
  assert.deepStrictEqual(store.read(), [
    { Text: 'D1: Show Loaders', Key: 'D1', ActionIndex: 3 }
  ]);
});

test('the reference hotkeys.json is imported when the plugin store has no list yet', () => {
  const store = memoryStore(undefined);
  const read = [];
  const run = hotkeysModule.createHotkeys({
    store: store,
    hotkeysFile: '/app/hotkeys.json',
    readFile: function (file) {
      read.push(file);
      return JSON.stringify([
        { Text: 'D2: Show Hotkeys', Key: 'D2', ActionIndex: 2 },
        { Text: 'Q: not an action', Key: 'Q', ActionIndex: 99 }
      ]);
    },
    localShortcuts: fakeShortcuts(),
    globalShortcuts: fakeShortcuts(),
    openWindow: function () { return {}; },
    windowIds: [],
    takenKeys: [],
    log: function () {}
  });
  run.install();
  assert.deepStrictEqual(run.list(), [{ Text: 'D2: Show Hotkeys', Key: 'D2', ActionIndex: 2 }]);
  assert.deepStrictEqual(read, ['/app/hotkeys.json']);
  assert.deepStrictEqual(store.read(), undefined, 'importing does not write the plugin store');
});

test('a record the window cannot use is skipped rather than fatal', () => {
  const store = memoryStore([
    { Text: 'D1: Show Loaders', Key: 'D1', ActionIndex: 3 },
    { Text: '??', Key: 'D1', ActionIndex: 3 },
    { Text: 'Q: gone', Key: 'D2', ActionIndex: 99 },
    { Text: 'Alt: Show Bot', Key: 'Alt', ActionIndex: 1 },
    null
  ]);
  const run = createHotkeys({ store: store });
  run.feature.install();
  assert.deepStrictEqual(run.feature.list(), [{ Text: 'D1: Show Loaders', Key: 'D1', ActionIndex: 3 }]);
  assert.deepStrictEqual(run.local.keys(), ['1']);
});
