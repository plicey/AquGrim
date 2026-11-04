const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../../res/game_chrome.js'), 'utf8');
const step = vm.runInNewContext('(' + source.match(/function adaptiveStep\(state, fps\) \{[\s\S]*?\n    \}/)[0] + ')');

test('adaptive resolution ignores hitches, waits for recovery, and stays bounded', () => {
  const state = { scale: 100, low: 0, high: 0 };
  for (let i = 0; i < 3; i++) step(state, 12);
  step(state, 24);
  assert.strictEqual(state.scale, 100);
  for (let i = 0; i < 4; i++) step(state, 12);
  assert.strictEqual(state.scale, 85);
  for (let i = 0; i < 20; i++) step(state, 12);
  assert.strictEqual(state.scale, 70);
  for (let i = 0; i < 7; i++) step(state, 24);
  assert.strictEqual(state.scale, 70);
  step(state, 24);
  assert.strictEqual(state.scale, 85);
  for (let i = 0; i < 24; i++) step(state, 24);
  assert.strictEqual(state.scale, 100);
});

test('invalid FPS samples cannot lower resolution', () => {
  const state = { scale: 100, low: 3, high: 0 };
  for (const fps of [0, NaN, Infinity, -1]) step(state, fps);
  step(state, 12);
  assert.strictEqual(state.scale, 100);
  assert.strictEqual(state.low, 1);
});
