// The packet tap (spec #19 / ticket #26): reading relayed game frames is a Host permission of
// its own, separate from writing, because a read-only tool must not need write access. The
// listener stays platform-owned - the relay hands its frames to one tap and plugins subscribe
// to that fan-out, so no plugin can add or replace a listener.
const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');

const platform = require('../../res/platform');
const { createPluginHost } = require('../../res/platform/plugin-host.js');
const socketRelay = require('../../res/socketRelay.js');

const NUL = String.fromCharCode(0);

function makeHost(permissions, deps) {
  return createPluginHost({
    manifest: {
      id: 'tap-probe',
      name: 'Tap probe',
      version: '1.0.0',
      apiVersion: 2,
      main: 'main.js',
      minAppVersion: '2.0.0',
      permissions: permissions || []
    },
    pluginRoot: path.join(__dirname, '../fixtures/sample-plugin'),
    appVersion: '2.0.0',
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    log: function () {},
    deps: deps || {}
  });
}

function frame(direction, text) {
  return { id: 1, direction: direction, data: Buffer.from(text, 'utf8') };
}

test('the tap hands every subscriber the relay frames once, in the order they arrived', () => {
  const tap = platform.createPacketTap();
  const first = [];
  const second = [];
  tap.subscribe(function (f) { first.push(f.direction + ' ' + f.data.toString()); });
  tap.subscribe(function (f) { second.push(f.data.toString()); });

  tap.emit(frame('toServer', '%xt%zm%first%'));
  tap.emit(frame('toClient', "<msg t='sys'/>"));

  assert.deepStrictEqual(first, ['toServer %xt%zm%first%', "toClient <msg t='sys'/>"],
    'both directions arrive, in the order the relay saw them');
  assert.deepStrictEqual(second, ['%xt%zm%first%', "<msg t='sys'/>"],
    'every subscriber sees every frame once');
  assert.strictEqual(tap.subscriberCount(), 2);
});

test('subscribing the same listener twice keeps one subscription and one copy per frame', () => {
  const tap = platform.createPacketTap();
  const seen = [];
  const listener = function (f) { seen.push(f.data.toString()); };

  const offFirst = tap.subscribe(listener);
  const offSecond = tap.subscribe(listener);
  assert.strictEqual(tap.subscriberCount(), 1, 'a repeated subscribe is not a second listener');

  tap.emit(frame('toServer', 'once'));
  assert.deepStrictEqual(seen, ['once']);

  offSecond();
  tap.emit(frame('toServer', 'after'));
  assert.deepStrictEqual(seen, ['once'], 'either handle releases the one subscription');
  assert.strictEqual(tap.subscriberCount(), 0);
  offFirst();
  assert.strictEqual(tap.subscriberCount(), 0, 'releasing twice is harmless');
});

test('the tap refuses a listener that is not a function', () => {
  const tap = platform.createPacketTap();
  assert.throws(function () { tap.subscribe(null); }, /function/i);
  assert.strictEqual(tap.subscriberCount(), 0);
});

test('packets.on is refused without packet-tap, and the refusal leaves other subscriptions alone', () => {
  const tap = platform.createPacketTap();
  const deps = { getPacketTap: function () { return tap; } };

  const allowed = makeHost(['packet-tap'], deps);
  const delivered = [];
  const off = allowed.packets.on('frame', function (f) { delivered.push(f.data.toString()); });
  assert.strictEqual(typeof off, 'function', 'subscribing hands back the release');

  const denied = makeHost([], deps);
  assert.throws(function () { denied.packets.on('frame', function () {}); },
    /called packets\.on without permission "packet-tap"/);
  assert.strictEqual(tap.subscriberCount(), 1, 'the refusal must not disturb the other subscription');

  tap.emit(frame('toClient', 'still here'));
  assert.deepStrictEqual(delivered, ['still here']);
  off();
  assert.strictEqual(tap.subscriberCount(), 0);
});

test('packets.on names the events it knows and refuses a tap that was never wired', () => {
  const tap = platform.createPacketTap();
  const host = makeHost(['packet-tap'], { getPacketTap: function () { return tap; } });
  assert.throws(function () { host.packets.on('send', function () {}); }, /frame/);
  assert.strictEqual(tap.subscriberCount(), 0, 'an unknown event subscribes nobody');

  const unwired = makeHost(['packet-tap'], {});
  assert.throws(function () { unwired.packets.on('frame', function () {}); }, /tap/i);
});

// The composition the app boots with, over a real socket: the relay hands the tap what it
// carries, the tap fans it out, and a plugin's subscription sees the game's own handshake in both
// directions. Only the upstream is a stand-in; nothing in the data path is faked.
test('a tapped relay shows a plugin the handshake in both directions, in order', async () => {
  const upstream = net.createServer(function (socket) {
    socket.on('data', function (chunk) {
      if (chunk.toString('latin1').indexOf('verChk') !== -1) {
        socket.write("<msg t='sys'><body action='apiOK' r='0'></body></msg>" + NUL);
      }
    });
  });
  await new Promise(function (resolve) { upstream.listen(0, '127.0.0.1', resolve); });

  const tap = platform.createPacketTap();
  const relay = socketRelay.createRelay({
    allowedHosts: ['127.0.0.1'],
    policyDomain: 'game.example',
    onFrame: function (frame) { tap.emit(frame); }
  });
  const host = makeHost(['packet-tap'], { getPacketTap: function () { return tap; } });
  const seen = [];
  host.packets.on('frame', function (frame) {
    seen.push(frame.direction + ' ' + frame.data.toString('utf8'));
  });

  let client = null;
  try {
    await relay.start({ steering: { engaged: ['steer-login'], unengaged: [] } });
    const port = await relay.targetPort({ host: '127.0.0.1', port: upstream.address().port });
    client = net.createConnection({ host: '127.0.0.1', port: port });
    const answered = [];
    client.on('data', function (chunk) { answered.push(chunk.toString('latin1')); });
    await new Promise(function (resolve, reject) {
      client.on('connect', resolve);
      client.on('error', reject);
    });
    client.write('<policy-file-request/>' + NUL);
    client.write("<msg t='sys'><body action='verChk' r='0'><ver v='166'/></body></msg>" + NUL);
    client.write('%xt%zm%moveToCell%yulgar-1%Enter%Spawn%' + NUL);
    await new Promise(function (resolve) { setTimeout(resolve, 400); });

    assert.ok(answered.join('').indexOf('<cross-domain-policy>') !== -1,
      'the relay still answers the policy request');
    assert.deepStrictEqual(seen, [
      "toServer <msg t='sys'><body action='verChk' r='0'><ver v='166'/></body></msg>",
      'toServer %xt%zm%moveToCell%yulgar-1%Enter%Spawn%',
      "toClient <msg t='sys'><body action='apiOK' r='0'></body></msg>"
    ], 'both directions, in order, NUL terminators stripped: ' + JSON.stringify(seen));
  } finally {
    if (client) client.destroy();
    await relay.close();
    upstream.close();
  }
});

// A human cannot check the boot wiring without a display, so the merge points are asserted here,
// the way the steering wiring is: one tap exists, the relay hands it both directions, and the
// plugin host is given that same tap.
test('the boot path feeds the relay into one platform tap and hands it to the plugin host', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  assert.strictEqual((main.match(/createPacketTap\(/g) || []).length, 1,
    'the app owns exactly one tap');
  assert.strictEqual((main.match(/onFrame:/g) || []).length, 1,
    'relay frames have exactly one consumer');
  assert.ok(/onFrame:[\s\S]{0,80}packetTap\.emit\(frame\)/.test(main),
    'the relay hands its frames to that tap, and nothing else consumes them');
  assert.strictEqual((main.match(/packetLayer\.createPacketLayer\(/g) || []).length, 1,
    'one packet layer: a second would be a second relay');
  assert.ok(/packetTap:\s*packetTap/.test(main), 'the boot path injects the tap');

  const runtime = fs.readFileSync(path.join(__dirname, '../../res/platform/plugin-runtime.js'), 'utf8');
  assert.ok(/getPacketTap:\s*function/.test(runtime),
    'the host deps expose the tap to plugins');
});
