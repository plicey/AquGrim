const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('game animation advances without compositor callbacks and cancels either path', () => {
  const native = new Map(), timers = new Map();
  let nextId = 0;
  const window = {
    requestAnimationFrame: callback => { const id = ++nextId; native.set(id, callback); return id; },
    cancelAnimationFrame: id => native.delete(id)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../res/game-timing.js'), 'utf8'), {
    window, Map, performance: { now: () => 123 },
    setTimeout: callback => { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id)
  });

  const calls = [];
  const id = window.requestAnimationFrame(time => calls.push(time));
  const lateNative = native.get(id);
  [...timers.values()][0]();
  lateNative(456);
  assert.deepStrictEqual(calls, [123], 'a stalled compositor must not stop the game or double-tick');
  assert.strictEqual(native.size + timers.size, 0);

  const visible = window.requestAnimationFrame(time => calls.push(time));
  const lateTimer = [...timers.values()][0];
  native.get(visible)(789);
  lateTimer();
  assert.deepStrictEqual(calls, [123, 789], 'native frames must cancel the timer fallback');
  assert.strictEqual(native.size + timers.size, 0);

  const cancelled = window.requestAnimationFrame(() => assert.fail('cancelled frame ran'));
  const cancelledNative = native.get(cancelled), cancelledTimer = [...timers.values()][0];
  window.cancelAnimationFrame(cancelled);
  cancelledNative(999);
  cancelledTimer();
  assert.strictEqual(native.size + timers.size, 0);
});
