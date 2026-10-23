// The Bot Manager window driving the engine (ticket #37). The window's Enable Bot tick is the
// reference's chkEnableBot: it starts the bot when it ticks and stops it when it clears, and a
// refused start un-ticks itself and shows why. The engine behind it is the per-window runtime, so
// what this file checks is that the control reaches THAT window's bot and reports its own state.
//
// The reference has one window and one engine; spec #19 rules one independent bot per window, so
// the expected behaviour here is the spec's, not the reference's.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const manager = require('../../plugins/grimlite-parity/features/bot-manager/bot-manager.js');

const FIXTURES = path.join(__dirname, '../fixtures/grimlite-bots');

// A runtime that records what a window asked for and answers what it was told to.
function fakeRuntime(answers) {
  const calls = [];
  const perWindow = {};
  return {
    calls: calls,
    perWindow: perWindow,
    start: function (key, bot) {
      calls.push({ name: 'start', key: key, commands: (bot.Commands || []).length });
      const answer = (answers || {})[key];
      if (answer && answer.start) return Promise.resolve(answer.start);
      perWindow[key] = true;
      return Promise.resolve({ ok: true });
    },
    stop: function (key) {
      calls.push({ name: 'stop', key: key });
      perWindow[key] = false;
      return Promise.resolve({ ok: true, stopped: true });
    },
    state: function (key) {
      return { running: !!perWindow[key], paused: false, index: 0, lastCommand: null, commands: 3 };
    }
  };
}

function window(overrides) {
  const deps = Object.assign({
    store: {
      readOrCreate: function (create) { return create(); },
      read: function () { return {}; },
      write: function (next) { return next; }
    },
    defaultBotsDirectory: '',
    message: function () { return {}; },
    dialogs: {
      open: function () { return Promise.resolve({ canceled: true }); },
      save: function () { return Promise.resolve({ canceled: true }); }
    }
  }, overrides || {});
  return manager.createBotManager(deps);
}

// A window with a bot open in it, the way the Open control opens one.
async function openedBot(overrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-botmgr-engine-'));
  const feature = window(Object.assign({ defaultBotsDirectory: dir }, overrides || {}));
  const copy = path.join(dir, 'plain.gbot');
  fs.writeFileSync(copy, fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8'));
  await feature.handle('botManagerLoad', null, [copy]);
  return feature;
}

test('ticking Enable Bot starts this window\'s bot on the document the window is holding', async () => {
  const runtime = fakeRuntime();
  const feature = await openedBot({ runtime: runtime, windowKey: 'win-a' });
  const state = await feature.handle('botManagerEnable', null, [true]);
  assert.strictEqual(state.error, null, 'a start that worked reports no error');
  assert.strictEqual(state.enabled, true, 'the tick stays on');
  // plain.gbot holds three commands: a label, a join and a goto.
  assert.deepStrictEqual(runtime.calls, [{ name: 'start', key: 'win-a', commands: 3 }]);
});

test('clearing the tick stops the bot and leaves no error behind', () => {
  const runtime = fakeRuntime();
  const feature = window({ runtime: runtime, windowKey: 'win-a' });
  return Promise.resolve(feature.handle('botManagerEnable', null, [false])).then(function (state) {
    assert.strictEqual(state.enabled, false);
    assert.strictEqual(state.error, null);
    assert.deepStrictEqual(runtime.calls, [{ name: 'stop', key: 'win-a' }]);
  });
});

test('a refused start leaves the tick off and hands the refusal to the window', () => {
  // The engine's own refusals: an empty list, nobody signed in, one already running.
  const runtime = fakeRuntime({ 'win-a': { start: { ok: false, error: 'no character is signed in' } } });
  const feature = window({ runtime: runtime, windowKey: 'win-a' });
  return Promise.resolve(feature.handle('botManagerEnable', null, [true])).then(function (state) {
    assert.strictEqual(state.enabled, false, 'a refused tick is un-ticked');
    assert.strictEqual(state.error, 'no character is signed in');
  });
});

test('a window with no engine wired refuses out loud rather than ticking on nothing', () => {
  const feature = window();
  return Promise.resolve(feature.handle('botManagerEnable', null, [true])).then(function (state) {
    assert.strictEqual(state.enabled, false);
    assert.ok(/no bot engine/i.test(state.error), state.error);
  });
});

test('stopping the bot turns the live zone handler off when a zone is selected', async () => {
  const runtime = fakeRuntime();
  const zones = [];
  const feature = window({
    runtime: runtime,
    windowKey: 'win-a',
    specialHandler: function () {
      return { set: function (zone, on) { zones.push([zone, on]); return { ok: true }; } };
    }
  });
  await feature.handle('botManagerSetting', null, ['AutoZone', 'Auto Zone - Dark Carnax']);
  await feature.handle('botManagerEnable', null, [true]);
  await feature.handle('botManagerEnable', null, [false]);
  assert.deepStrictEqual(zones, [
    ['Auto Zone - Dark Carnax', true],
    ['Auto Zone - Dark Carnax', false]
  ]);
});

test('the state read reports this window\'s bot, and says so when there is no engine', () => {
  const runtime = fakeRuntime();
  const feature = window({ runtime: runtime, windowKey: 'win-a' });
  return Promise.resolve(feature.handle('botManagerState', null, [])).then(function (state) {
    assert.strictEqual(state.bot.running, false, 'nothing started yet');
    assert.strictEqual(state.enabled, false);
  }).then(function () {
    const bare = window();
    return Promise.resolve(bare.handle('botManagerState', null, [])).then(function (state) {
      assert.strictEqual(state.bot, null, 'no engine means no bot state to invent');
      assert.strictEqual(state.enabled, false);
    });
  });
});

test('two windows asking are two bots, each keyed by the window that asked', async () => {
  // The key comes from the caller when the window can say who it is, so a second window cannot
  // start, stop or read the first one's bot.
  const runtime = fakeRuntime();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-botmgr-engine-'));
  const feature = window({
    defaultBotsDirectory: dir,
    runtime: runtime,
    windowKeyFor: function (event) { return event && event.sender ? 'win-' + event.sender.id : 'default'; }
  });
  const copy = path.join(dir, 'plain.gbot');
  fs.writeFileSync(copy, fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8'));
  await feature.handle('botManagerLoad', null, [copy]);
  await feature.handle('botManagerEnable', { sender: { id: 1 } }, [true]);
  await feature.handle('botManagerEnable', { sender: { id: 2 } }, [true]);
  assert.deepStrictEqual(runtime.calls, [
    { name: 'start', key: 'win-1', commands: 3 },
    { name: 'start', key: 'win-2', commands: 3 }
  ]);
  const first = await feature.handle('botManagerState', { sender: { id: 1 } }, []);
  const second = await feature.handle('botManagerState', { sender: { id: 2 } }, []);
  assert.strictEqual(first.bot.running, true);
  assert.strictEqual(second.bot.running, true);
  await feature.handle('botManagerEnable', { sender: { id: 1 } }, [false]);
  assert.strictEqual((await feature.handle('botManagerState', { sender: { id: 1 } }, [])).bot.running, false,
    'the first window stopped its own bot');
  assert.strictEqual((await feature.handle('botManagerState', { sender: { id: 2 } }, [])).bot.running, true,
    'and the second window\'s bot is untouched');
});
