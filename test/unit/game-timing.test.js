const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function clock() {
  let now = 0, nextId = 0;
  const native = new Map(), timers = new Map();
  const window = {
    requestAnimationFrame: callback => { const id = ++nextId; native.set(id, callback); return id; },
    cancelAnimationFrame: id => native.delete(id)
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../res/game-timing.js'), 'utf8'), {
    window, Map, performance: { now: () => now },
    setTimeout: (callback, delay) => {
      const id = ++nextId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id)
  });
  return {
    window, native, timers,
    advance(target) {
      while ([...timers.values()].some(timer => timer.at <= target)) {
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        now = timer.at;
        timers.delete(id);
        timer.callback();
      }
      now = target;
    },
    frame(time, timestamp = time) {
      now = time;
      const callbacks = [...native.entries()];
      callbacks.forEach(([id, callback]) => {
        if (!native.delete(id)) return;
        callback(timestamp);
      });
    }
  };
}

for (const hz of [30, 50, 60, 144]) {
  test('game animation follows a healthy ' + hz + ' Hz compositor without extra timer frames', () => {
    const c = clock(), times = [];
    let id;
    function frame(time) { times.push(time); id = c.window.requestAnimationFrame(frame); }
    id = c.window.requestAnimationFrame(frame);
    for (let index = 1; index <= hz; index++) {
      const time = index * 1000 / hz;
      c.advance(time);
      c.frame(time);
    }
    c.window.cancelAnimationFrame(id);
    assert.strictEqual(times.length, hz, 'healthy compositor must not compete with synthetic frames');
    assert.ok(times.every((time, index) => time === (index + 1) * 1000 / hz));
    assert.strictEqual(c.native.size + c.timers.size, 0);
  });
}

test('stalled game animation keeps 60 Hz fallback and one outstanding compositor request', () => {
  const c = clock(), times = [];
  let id;
  function frame(time) { times.push(time); id = c.window.requestAnimationFrame(frame); }
  id = c.window.requestAnimationFrame(frame);
  c.advance(99);
  assert.deepStrictEqual(times, [], 'short compositor delays must not trigger synthetic frames');
  c.advance(1000);
  assert.ok(times.length >= 54 && times.length <= 55, 'fallback must sustain 60 Hz after the watchdog');
  assert.strictEqual(times[0], 100);
  assert.strictEqual(c.native.size, 1, 'stalled native callbacks must not accumulate');
  assert.strictEqual(c.timers.size, 1);
  c.window.cancelAnimationFrame(id);
  assert.strictEqual(c.native.size + c.timers.size, 0);
});

test('resuming the compositor restores native cadence without backwards timestamps', () => {
  const c = clock(), times = [];
  let id;
  function frame(time) { times.push(time); id = c.window.requestAnimationFrame(frame); }
  id = c.window.requestAnimationFrame(frame);
  c.advance(150);
  const count = times.length;
  c.frame(151, 140);
  assert.strictEqual(times.length, count, 'stale compositor timestamps must not reach the game');
  for (const time of [160, 180, 200, 220, 240]) {
    c.advance(time);
    c.frame(time);
  }
  assert.deepStrictEqual(times.slice(count), [160, 180, 200, 220, 240]);
  c.window.cancelAnimationFrame(id);
  assert.strictEqual(c.native.size + c.timers.size, 0);
});

test('cancellation and the losing frame path cannot deliver a callback twice', () => {
  for (const winner of ['native', 'timer', 'cancel']) {
    const c = clock(), times = [];
    const id = c.window.requestAnimationFrame(time => times.push(time));
    const native = [...c.native.values()][0];
    const timer = [...c.timers.values()][0].callback;
    if (winner === 'native') c.frame(20);
    else if (winner === 'timer') c.advance(100);
    else c.window.cancelAnimationFrame(id);
    native(200);
    timer();
    assert.deepStrictEqual(times, winner === 'cancel' ? [] : [winner === 'native' ? 20 : 100]);
    assert.strictEqual(c.native.size + c.timers.size, 0);
  }
});

test('frame batches preserve cancellation, callback order, and next-frame scheduling', () => {
  const c = clock(), calls = [];
  c.window.requestAnimationFrame(time => {
    calls.push(['first', time]);
    c.window.cancelAnimationFrame(cancelled);
    c.window.requestAnimationFrame(next => calls.push(['next', next]));
  });
  const cancelled = c.window.requestAnimationFrame(() => assert.fail('cancelled sibling ran'));
  c.window.requestAnimationFrame(time => calls.push(['last', time]));
  assert.strictEqual(c.native.size, 1);
  c.frame(20);
  assert.deepStrictEqual(calls, [['first', 20], ['last', 20]]);
  c.frame(40);
  assert.deepStrictEqual(calls, [['first', 20], ['last', 20], ['next', 40]]);
  assert.strictEqual(c.native.size + c.timers.size, 0);
});

test('a throwing animation callback does not prevent the other callbacks from running', () => {
  const c = clock(), error = new Error('frame failed');
  let ran = false;
  c.window.requestAnimationFrame(() => { throw error; });
  c.window.requestAnimationFrame(() => { ran = true; });
  c.frame(20);
  assert.strictEqual(ran, true);
  assert.throws(() => c.advance(20), value => value === error);
});
