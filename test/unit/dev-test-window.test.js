// The Dev Test window: type a function and arguments, call it, see the formatted result, with the
// reference's own call modes. The page is checked as the artifact it is, and the call modes are
// checked against the bridge by running them.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const PARITY = path.join(__dirname, '../../plugins/grimlite-parity');
const callModes = require(path.join(PARITY, 'features', 'devtest', 'call-modes.js'));

test('the reference\'s call modes are the three the window offers, in its own order', () => {
  const ids = callModes.MODES.map(function (mode) { return mode.id; });
  assert.deepStrictEqual(ids, ['grimoire', 'callFunction', 'getSetObject']);

  const labels = callModes.MODES.map(function (mode) { return mode.label; });
  assert.deepStrictEqual(labels, ['Grimoire', 'Call Func', 'Get/Set Object']);

  // The reference defaults to the first radio and to the path "world".
  assert.strictEqual(callModes.MODES[0].id, ids[0]);
});

test('arguments are split the way the reference splits them: on commas, or not at all', () => {
  // Grimlite: tbArgs.Text.Contains(',') ? Split(',') : new[] { tbArgs.Text }
  assert.deepStrictEqual(callModes.parseArgs('arg1,arg2'), ['arg1', 'arg2']);
  assert.deepStrictEqual(callModes.parseArgs('single'), ['single']);
  assert.deepStrictEqual(callModes.parseArgs(''), []);
  assert.deepStrictEqual(callModes.parseArgs('a,,b'), ['a', '', 'b']);
  // With the Args box unchecked, the reference passes no arguments at all.
  assert.deepStrictEqual(callModes.parseArgs('arg1,arg2', false), []);
});

test('each mode calls the bridge surface the reference\'s mode calls', async () => {
  const calls = [];
  const bridge = {
    call: function (name, args) {
      calls.push({ name: name, args: args });
      return Promise.resolve({ ok: true, value: 'r:' + name });
    }
  };

  // Grimoire: the bridge's own read, straight through.
  const read = await callModes.run('grimoire', 'world.strFrame', ['x'], bridge);
  assert.strictEqual(read.ok, true);
  assert.deepStrictEqual(calls.pop(), { name: 'getGameObject', args: ['world.strFrame'] });

  // Call Func: a function by path, with the arguments.
  const called = await callModes.run('callFunction', 'world.getQuestValue', ['3'], bridge);
  assert.strictEqual(called.ok, true);
  assert.deepStrictEqual(calls.pop(), {
    name: 'callGameFunction',
    args: ['world.getQuestValue', '3']
  });

  // The zero-argument case is the reference's separate callGameFunction0.
  await callModes.run('callFunction', 'world.maxLevel', [], bridge);
  assert.deepStrictEqual(calls.pop(), { name: 'callGameFunction0', args: ['world.maxLevel'] });

  // Get/Set Object: with a value given, it writes first and then reads the path back.
  await callModes.run('getSetObject', 'world.strFrame', ['hello'], bridge);
  assert.deepStrictEqual(calls.pop(), { name: 'getGameObject', args: ['world.strFrame'] });
  assert.deepStrictEqual(calls.pop(), { name: 'setGameObject', args: ['world.strFrame', 'hello'] });

  // With no value, it only reads.
  calls.length = 0;
  await callModes.run('getSetObject', 'world.strFrame', [], bridge);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].name, 'getGameObject');

  // The booleans the reference's own boxes convert, and nothing else.
  calls.length = 0;
  await callModes.run('getSetObject', 'world.flag', ['true'], bridge);
  assert.deepStrictEqual(calls[0], { name: 'setGameObject', args: ['world.flag', true] });
});

test('a failed bridge call is reported as the reference reports it, not thrown', async () => {
  const bridge = {
    call: function () { return Promise.resolve({ ok: false, error: 'the game is not loaded yet' }); }
  };
  const result = await callModes.run('grimoire', 'world', [], bridge);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'the game is not loaded yet');
});

test('the result is formatted as the reference\'s Format JSON button formats it', () => {
  assert.strictEqual(callModes.format('{"b":1,"a":[1,2]}'), '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}');
  // Not JSON: the reference shows what it had, unchanged.
  assert.strictEqual(callModes.format('not json'), 'not json');
  assert.strictEqual(callModes.pretty('{}'), '{}');
});

test('the window page offers the reference\'s controls, wired to the plugin API', () => {
  const page = fs.readFileSync(
    path.join(PARITY, 'features', 'devtest', 'devtest.html'),
    'utf8'
  );

  ['Function', 'Args', 'Call', 'Copy', 'Format JSON'].forEach(function (label) {
    assert.ok(page.indexOf(label) !== -1, 'the window must offer ' + label);
  });
  // The mode radios are built from the plugin's own list at runtime, so the page carries no
  // second copy of the reference's wording.
  assert.ok(/id="modes"/.test(page));
  assert.ok(
    fs.readFileSync(path.join(PARITY, 'features', 'devtest', 'devtest.js'), 'utf8')
      .indexOf('api.modes()') !== -1,
    'the page must take its modes from the plugin'
  );

  // The result box is where both Copy and Format act, and the args box has its enable box.
  assert.ok(/id="result"/.test(page));
  assert.ok(/id="argsEnabled"/.test(page));
  assert.ok(page.indexOf('value="world"') !== -1, 'the reference defaults Function to world');

  // Page-side work reaches the plugin only through the preload bridge: a sandboxed page has no
  // Node, and the bridge call itself is main-process work.
  const script = fs.readFileSync(path.join(PARITY, 'features', 'devtest', 'devtest.js'), 'utf8');
  assert.ok(script.indexOf('window.aquastarPlugin') !== -1, 'the page must use the plugin API bridge');
  assert.ok(script.indexOf('require(') === -1, 'a sandboxed page must not require anything');
  assert.ok(page.indexOf('nodeIntegration') === -1);
  // The preload may require electron and nothing else (Electron 11 sandboxed preloads).
  const preload = fs.readFileSync(
    path.join(PARITY, 'features', 'devtest', 'preload_devtest.js'),
    'utf8'
  );
  assert.ok(preload.indexOf("require('electron')") !== -1);
  const requires = preload.match(/require\(([^)]*)\)/g) || [];
  assert.deepStrictEqual(requires, ["require('electron')"], 'a sandboxed preload may only require electron');
});

test('the dev test window is registered in the app\'s window conventions and reachable', async () => {
  const platform = require('../../res/platform');
  const manifest = JSON.parse(fs.readFileSync(path.join(PARITY, 'plugin.json'), 'utf8'));
  const opened = [];
  const activated = await platform.activatePlugin(
    { root: PARITY, dir: PARITY, manifest: manifest, source: 'bundled' },
    {
      appVersion: '2.0.0',
      appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
      clearRequireCache: true,
      log: function () {},
      deps: {
        startGameOrigin: function () { return Promise.resolve('http://127.0.0.1:41234'); },
        openFeatureWindow: function (id) { opened.push(id); return {}; },
        getGameWindow: function () { return null; },
        executeJavaScript: function () { return Promise.resolve(null); }
      }
    }
  );

  const state = activated.host._getState();
  const devtest = state.featureWindows.filter(function (w) {
    return w.id === 'grimlite-parity-devtest';
  });
  assert.strictEqual(devtest.length, 1, 'one dev test window');
  assert.strictEqual(devtest[0].config.webPreferences.sandbox, true);
  assert.strictEqual(devtest[0].config.webPreferences.plugins, false, 'no Flash in this window');
  assert.strictEqual(devtest[0].config.webPreferences.contextIsolation, true);
  assert.ok(
    devtest[0].config.webPreferences.preload.indexOf('preload_devtest.js') !== -1,
    'the window needs its own preload to reach the plugin'
  );

  // The bridge is this plugin's, and the game it boots is the bridge SWF on the origin.
  assert.strictEqual(state.primaryGame.getUrl(), 'http://127.0.0.1:41234/game/aqua-bridge.swf');

  // Reachable from its own menu entry.
  const items = state.menus[0]({ labels: {}, keybinds: {} });
  const flat = [];
  (function walk(list) {
    (list || []).forEach(function (item) {
      if (item.submenu) walk(item.submenu);
      else if (item.click) flat.push(item);
    });
  })(items);
  const entry = flat.filter(function (item) {
    return /Dev Test/i.test(item.label || '');
  })[0];
  assert.ok(entry, 'the Grimlite menu must offer the Dev Test window');
  entry.click();
  assert.ok(opened.indexOf('grimlite-parity-devtest') !== -1, 'and open it');
});
