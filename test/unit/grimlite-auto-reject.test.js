const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../../plugins/grimlite-parity');
const bridgeModel = require(root + '/bridge.js');

// Execute the actual callback body against live identity-bearing display doubles. Only AS3
// annotations are erased; compiling the SWF separately checks the ActionScript half.
function callback(game) {
  const source = fs.readFileSync(root + '/bridge/AquaBridge.as', 'utf8');
  const start = source.indexOf('private function aqRejectDrop(');
  const end = source.indexOf('// ---------------------------------------------------------------- reading and writing', start);
  const fn = source.slice(start, end).trim().replace('private function', 'function')
    .replace(/:(String|Object|Boolean|int|Error)\b/g, '');
  return vm.runInNewContext('(' + fn + ')', {
    game, world: () => game.world, String,
    getQualifiedClassName: clip => clip.kind,
    jsonError: error => JSON.stringify({ error: error.message })
  });
}
function classic() {
  const children = [];
  const game = { world: {}, litePreference: { data: { bCustomDrops: false } },
    ui: { dropStack: { get numChildren() { return children.length; },
      getChildAt: i => children[i], removeChild: clip => children.splice(children.indexOf(clip), 1) } },
    cleaned: 0, cleanDropStack() { this.cleaned++; } };
  return { game, children, reject: callback(game) };
}
function frame(id, kind = 'DFrame2MC') {
  return { kind, fData: { ItemID: id }, isClosing: false };
}

test('native rejection waits for classic rendering, removes all exact pending IDs and reflows', () => {
  const { game, children, reject } = classic();
  assert.strictEqual(reject('Sword', '7'), 'false');
  const other = frame(8); // Same displayed name/prefix must not determine rejection.
  const notice = frame(7, 'DFrameMC');
  const closing = Object.assign(frame(7), { isClosing: true });
  children.push(frame(7), frame(7), other, notice, closing, { kind: 'OtherNotice' });
  assert.strictEqual(reject('Sword', '7'), 'true');
  assert.deepStrictEqual(children.slice(0, 3), [other, notice, closing]);
  assert.strictEqual(children.length, 4);
  assert.strictEqual(game.cleaned, 1);
  assert.strictEqual(reject('Sword', '7'), 'false');
});

test('native custom rejection waits for the tray entry and passes the world item by identity', () => {
  const item = { ItemID: 7 };
  const invTree = { 7: item };
  const tray = [];
  const calls = [];
  const game = { world: { invTree }, litePreference: { data: { bCustomDrops: true } },
    cDropsUI: { invTree: tray, onBtNo(value) { calls.push(value); tray.splice(0, 1); } } };
  const reject = callback(game);
  assert.strictEqual(reject('Sword', '7'), 'false');
  tray.push({ ItemID: 7 });
  assert.strictEqual(reject('Sword', '7'), 'true');
  assert.strictEqual(calls[0], item);
  assert.strictEqual(invTree[7], item, 'server availability is not inventory deletion');
  assert.strictEqual(reject('Sword', '7'), 'false');
});

function sessionHarness(answer, immediate = false) {
  const filename = root + '/bot/session.js';
  const module = { exports: {} };
  let waits = 0;
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, require: createRequire(filename), Buffer,
    setTimeout: (fn, ms) => { waits++; return setTimeout(fn, immediate ? 0 : ms); }
  }, { filename });
  let observe;
  const calls = [];
  const channel = {
    attach: async () => ({ ok: true }),
    call: async (name, args) => {
      assert.ok(require(root + '/plugin.json').bridgeCallbacks.includes(name));
      calls.push({ name, args });
      const value = answer(name, args, calls.length);
      return { ok: true, value: typeof value === 'string' ? value : JSON.stringify(value) };
    }
  };
  const access = bridgeModel.createGameAccess({ bridge: channel });
  const session = module.exports.createSession({
    bridge: { attach: channel.attach, loaderCall: access.loaderCall },
    packets: { on: (name, fn) => { observe = fn; return () => {}; } }
  });
  return { session, calls, waits: () => waits, emit: items => observe({
    data: JSON.stringify({ b: { o: { cmd: 'dropItem', items } } })
  }) };
}

test('session reaches the native callback after relay delivery catches up and keeps DropStack', async () => {
  const { game, children, reject } = classic();
  const h = sessionHarness((name, args, count) => {
    assert.strictEqual(name, 'RejectDrop');
    if (count === 2) children.push(frame(7));
    return reject(...args);
  });
  const seen = [];
  h.session.onDrop(drop => seen.push(drop.ItemID));
  h.emit({ 7: { ItemID: 7, sName: 'Sword' }, 8: { ItemID: 8, sName: 'Keep' } });
  assert.deepStrictEqual(seen, [7, 8], 'all items in the packet reach rejection observers');
  await h.session.rejectDrop('Sword', 7);
  assert.strictEqual(h.calls.length, 2);
  assert.deepStrictEqual(h.calls[0].args, ['sword', '7']);
  assert.strictEqual(children.length, 0);
  assert.strictEqual(game.cleaned, 1);
  assert.strictEqual((await h.session.dropStack()).length, 2);
  await h.session.close();
});

test('missing UI retries are bounded, refusals propagate, and close stops retrying', async () => {
  const missing = sessionHarness(() => false, true);
  await assert.rejects(missing.session.rejectDrop('Sword', 7), /within 2000ms/);
  assert.strictEqual(missing.calls.length, 20);
  assert.strictEqual(missing.waits(), 20);
  const failed = sessionHarness(() => { throw new Error('native failure'); });
  await assert.rejects(failed.session.rejectDrop('Sword', 7), /native failure/);
  assert.strictEqual(failed.calls.length, 1);
  const closing = sessionHarness(() => false);
  const pending = closing.session.rejectDrop('Sword', 7);
  await new Promise(resolve => setTimeout(resolve, 5));
  await closing.session.close();
  await assert.rejects(pending, /session closed/);
  assert.strictEqual(closing.calls.length, 1);
});

test('RejectDrop ships as an allowed native callback in the compiled bridge', () => {
  assert.ok(require(root + '/plugin.json').bridgeCallbacks.includes('RejectDrop'));
  const raw = fs.readFileSync(root + '/assets/aqua-bridge.swf');
  const body = raw.subarray(0, 3).toString() === 'CWS'
    ? require('zlib').inflateSync(raw.subarray(8)) : raw.subarray(8);
  for (const name of ['RejectDrop', 'aqRejectDrop', 'DFrame2MC', 'onBtNo']) {
    assert.ok(body.includes(Buffer.from(name)), name + ' missing from built asset');
  }
});

test('session checks rejection authorization again before retrying', async () => {
  let enabled = true;
  const h = sessionHarness(() => { enabled = false; return false; }, true);
  await h.session.rejectDrop('Sword', 7, () => enabled);
  assert.strictEqual(h.calls.length, 1);
  await h.session.rejectDrop('Sword', 7, () => false);
  assert.strictEqual(h.calls.length, 1);
  await h.session.close();
});
