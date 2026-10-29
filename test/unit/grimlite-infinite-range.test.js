const assert = require('assert');
const fs = require('fs');
const path = require('path');
const method = require('../helpers/as3-method');
const { createGameCalls } = require('../../plugins/grimlite-parity/game-calls');
const { createOptionsFeature } = require('../../plugins/grimlite-parity/features/options/options');
const { createLoaderSurface } = require('../../plugins/grimlite-parity/loader-surface');
const source = fs.readFileSync(path.join(__dirname, '../../plugins/grimlite-parity/bridge/AquaBridge.as'), 'utf8');

function native() {
  const listeners = new Set();
  const g = { world: { actions: { active: [0, 7, 34, 120, 600, 900].map(range => ({ range })) } },
    addEventListener(type, fn) { listeners.add(fn); }, removeEventListener(type, fn) { listeners.delete(fn); } };
  const b = { game: g, rangeEnabled: false, rangeRoot: null, rangeOriginals: [],
    toJson: JSON.stringify, jsonError: e => JSON.stringify({ error: e.message }) };
  for (const [name, args] of [['aqSetInfiniteRangeEnabled', 'enabled,maintain'], ['applyInfiniteRange', ''], ['restoreInfiniteRange', ''], ['onInfiniteRangeFrame', 'event']]) {
    b[name] = method(source, name, args).bind(b);
  }
  return { b, g, tick() { for (const fn of listeners) fn(); }, listeners };
}

test('Infinite Range checkbox sends a real off call', async () => {
  const calls = [];
  const feature = createOptionsFeature(null, { gameCalls: { call: async (name, args) => { calls.push([name, args]); return { ok: true }; } },
    timers: { setInterval() { return 1; }, clearInterval() {} } });
  await feature.setToggle('infiniteRange', true);
  await feature.setToggle('infiniteRange', false);
  assert.deepStrictEqual(calls, [['callGameFunction', ['SetInfiniteRange', true]], ['callGameFunction', ['SetInfiniteRange', false]]]);
  await feature.stop();
});

test('native ranges restore by action identity across reapply, replacements and off/on', () => {
  const { b, g, tick, listeners } = native();
  const old = g.world.actions.active.slice();
  assert.equal(JSON.parse(b.aqSetInfiniteRangeEnabled(true, true)), true);
  b.aqSetInfiniteRangeEnabled(true, true);
  const fresh = { range: 333 };
  g.world.actions.active = [fresh, old[2], null];
  tick();
  assert.equal(fresh.range, 20000);
  const untouched = { range: 777 };
  g.world.actions.active[1] = untouched; // Untick before another frame.
  b.aqSetInfiniteRangeEnabled(false, true);
  assert.equal(fresh.range, 333);
  assert.equal(untouched.range, 777);
  assert.deepStrictEqual(old.map(a => a.range), [0, 7, 34, 120, 600, 900]);
  assert.equal(listeners.size, 0);
  b.aqSetInfiniteRangeEnabled(true, true);
  b.aqSetInfiniteRangeEnabled(false, true);
  assert.equal(untouched.range, 777);
});

test('legacy game-call and loader callers remain one-shot and retain originals for later off', async () => {
  const { b, g, tick, listeners } = native();
  const bridge = { call: async (name, args) => {
    assert.equal(name, 'SetInfiniteRangeEnabled');
    return { ok: true, value: b.aqSetInfiniteRangeEnabled(...args) };
  } };
  const calls = createGameCalls({ bridge });
  assert.equal((await calls.call('callGameFunction0', ['SetInfiniteRange'])).ok, true);
  assert.equal(listeners.size, 0);
  const fresh = { range: 321 };
  g.world.actions.active[0] = fresh;
  tick();
  assert.equal(fresh.range, 321);
  const surface = createLoaderSurface(async (name, args) => JSON.parse((await bridge.call(name, args)).value));
  await surface.call('SetInfiniteRange', []);
  await calls.call('callGameFunction', ['SetInfiniteRange', false]);
  assert.equal(fresh.range, 321);
});

test('Options normal reapply and stop restore current class ranges through the real adapter', async () => {
  const { b, g, listeners } = native();
  const ticks = [];
  const calls = createGameCalls({ bridge: { call: async (name, args) => {
    if (name === 'SetInfiniteRangeEnabled') return { ok: true, value: b.aqSetInfiniteRangeEnabled(...args) };
    return { ok: true, value: 'null' };
  } } });
  const feature = createOptionsFeature(null, { gameCalls: calls, isReady: async () => true,
    timers: { setInterval(fn) { ticks.push(fn); return ticks.length; }, clearInterval() {} } });
  await feature.setToggle('infiniteRange', true);
  const original = g.world.actions.active[0];
  const replacement = { range: 17.5 };
  g.world.actions.active[0] = replacement;
  await ticks[0]();
  await ticks[0]();
  assert.equal(original.range, 0);
  assert.equal(replacement.range, 20000);
  await feature.setToggle('infiniteRange', false);
  assert.equal(replacement.range, 17.5);
  await ticks[0]();
  assert.equal(replacement.range, 17.5);
  await feature.setToggle('infiniteRange', true);
  await feature.stop();
  assert.equal(replacement.range, 17.5);
  assert.equal(listeners.size, 0);
});

test('missing native range support reports failure without a destructive fallback', async () => {
  const attempted = [];
  const calls = createGameCalls({ bridge: { call: async (name, args) => {
    attempted.push([name, args]); return { ok: false, error: 'unsupported callback' };
  } } });
  const result = await calls.call('callGameFunction', ['SetInfiniteRange', false]);
  assert.equal(result.ok, false);
  assert.match(result.error, /unsupported callback/);
  assert.deepStrictEqual(attempted, [['SetInfiniteRangeEnabled', [false, true]]]);
});

test('native range maintenance waits for skills and transfers between game roots', () => {
  const { b, g, tick, listeners } = native();
  g.world.actions = null;
  b.aqSetInfiniteRangeEnabled(true, true);
  g.world.actions = { active: [{ range: 45 }] };
  tick();
  const old = g.world.actions.active[0];
  const replacement = { range: 88 };
  const nextListeners = new Set();
  b.game = { world: { actions: { active: [replacement] } },
    addEventListener(type, fn) { nextListeners.add(fn); }, removeEventListener(type, fn) { nextListeners.delete(fn); } };
  b.aqSetInfiniteRangeEnabled(true, true);
  assert.equal(listeners.size, 0);
  assert.equal(old.range, 45);
  assert.equal(replacement.range, 20000);
  b.aqSetInfiniteRangeEnabled(false, true);
  assert.equal(replacement.range, 88);
  assert.equal(nextListeners.size, 0);
});

test('in-place native range refresh replaces the saved original without per-frame allocation', () => {
  const { b, g, tick } = native();
  b.aqSetInfiniteRangeEnabled(true, true);
  const records = b.rangeOriginals.slice();
  g.world.actions.active[2].range = 143;
  tick();
  assert.equal(g.world.actions.active[2].range, 20000);
  assert.equal(b.rangeOriginals[2].range, 143);
  for (let i = 0; i < 20; i++) tick();
  assert.ok(b.rangeOriginals.every((record, i) => record === records[i]));
  b.aqSetInfiniteRangeEnabled(false, true);
  assert.equal(g.world.actions.active[2].range, 143);
  assert.ok(b.rangeOriginals.length <= 6);
  b.aqSetInfiniteRangeEnabled(true, true);
  g.world.actions.active[2].range = 179; // Untick before the next maintenance frame.
  b.aqSetInfiniteRangeEnabled(false, true);
  assert.equal(g.world.actions.active[2].range, 179);
  b.aqSetInfiniteRangeEnabled(true, true);
  const pool = b.rangeOriginals.slice();
  for (let i = 0; i < 30; i++) {
    const retired = g.world.actions.active.slice();
    g.world.actions.active = [1, 2, 3, 4, 5, 6].map(range => ({ range }));
    tick();
    assert.ok(retired.every(action => action.range !== 20000));
    assert.ok(b.rangeOriginals.every(record => pool.includes(record)));
    assert.equal(b.rangeOriginals.length, 6);
    g.world.actions.active.reverse();
    tick();
  }
  b.aqSetInfiniteRangeEnabled(false, true);
  assert.deepStrictEqual(g.world.actions.active.map(action => action.range), [6, 5, 4, 3, 2, 1]);
});

test('sustained native range maintenance bounds records and listeners across class changes', () => {
  const { b, g, tick, listeners } = native();
  for (let block = 0; block < 3; block++) {
    for (let i = 0; i < 10000; i++) {
      const retired = g.world.actions.active;
      g.world.actions.active = [1, 2, 3, 4, 5, 6].map(range => ({ range }));
      b.aqSetInfiniteRangeEnabled(true, true);
      tick();
      assert.ok(retired.every(action => action.range !== 20000));
    }
    assert.equal(b.rangeOriginals.length, 6);
    assert.equal(listeners.size, 1);
  }
  b.aqSetInfiniteRangeEnabled(false, true);
  assert.equal(listeners.size, 0);
  assert.ok(b.rangeOriginals.every(record => record.action === null));
});
