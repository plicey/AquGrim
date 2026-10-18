// The packet send path (spec #19 / ticket #27): writing a frame back through the relay is a
// permission of its own, because the risk is different from reading. The spammer and the tamperer
// are the tools that hold it; the logger never does.
//
// A tool that only sends cannot be told a connection id, because reading frames is what carries
// ids (the tap). So the layer writes on the live connection itself, and the frame it writes is
// visible to the tap afterwards, in the direction it was sent.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const path = require('path');

const platform = require('../../res/platform');
const packetLayer = require('../../res/platform/packet-layer.js');
const socketRelay = require('../../res/socketRelay.js');

const NUL = String.fromCharCode(0);

function manifest(permissions) {
  return {
    id: 'send-probe',
    name: 'Send probe',
    version: '1.0.0',
    apiVersion: 2,
    main: 'main.js',
    minAppVersion: '2.0.0',
    permissions: permissions || []
  };
}

function makeHost(permissions, deps) {
  return platform.createPluginHost({
    manifest: manifest(permissions),
    pluginRoot: path.join(__dirname, '../fixtures/sample-plugin'),
    appVersion: '2.0.0',
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    log: function () {},
    deps: deps || {}
  });
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

test('reading and writing game traffic are separate permissions, each naming its own method', () => {
  const sent = [];
  const tap = platform.createPacketTap();
  const wire = {
    getPacketTap: function () { return tap; },
    getPacketSender: function () {
      return function (direction, text) { sent.push(direction + ' ' + text); return true; };
    }
  };

  // Send without tap: the write works, and the read is refused by name.
  const sender = makeHost(['packet-send'], wire);
  assert.strictEqual(sender.packets.send({ direction: 'toServer', text: '%xt%zm%gar%1%2%w' }), true);
  assert.deepStrictEqual(sent, ['toServer %xt%zm%gar%1%2%w']);
  assert.throws(function () { sender.packets.on('frame', function () {}); },
    /called packets\.on without permission "packet-tap"/);

  // Tap without send: the logger's own surface, and nothing that writes.
  const reader = makeHost(['packet-tap'], wire);
  const seen = [];
  reader.packets.on('frame', function (frame) { seen.push(frame.direction); });
  tap.emit({ id: 1, direction: 'toClient', data: Buffer.from('apiOK') });
  assert.deepStrictEqual(seen, ['toClient']);
  assert.throws(function () { reader.packets.send({ direction: 'toServer', text: 'x' }); },
    /called packets\.send without permission "packet-send"/);
  assert.deepStrictEqual(sent, ['toServer %xt%zm%gar%1%2%w'], 'a refused send writes nothing');

  // A plugin holding neither gets both refusals, one per method.
  const none = makeHost([], wire);
  assert.throws(function () { none.packets.on('frame', function () {}); }, /packet-tap/);
  assert.throws(function () { none.packets.send({ direction: 'toClient', text: 'x' }); }, /packet-send/);
});

test('packets.send refuses a frame it cannot write, before anything reaches the wire', () => {
  const sent = [];
  const host = makeHost(['packet-send'], {
    getPacketSender: function () {
      return function (direction, text) { sent.push(direction + ' ' + text); return true; };
    }
  });

  // The reference's own two sides are the only directions that exist (Proxy.SendToServer /
  // SendToClient), and its send boxes are non-empty ("if (!string.IsNullOrEmpty(txtSend.Text))").
  ['sideways', '', null, undefined].forEach(function (direction) {
    assert.throws(function () {
      host.packets.send({ direction: direction, text: '%xt%zm%x%' });
    }, /toServer|toClient/);
  });
  [{ direction: 'toServer', text: '' }, { direction: 'toServer', text: 7 },
    { direction: 'toClient', text: null }].forEach(function (frame) {
    assert.throws(function () { host.packets.send(frame); }, /text/);
  });
  assert.throws(function () { host.packets.send({}); }, /toServer/,
    'an unnamed direction is refused before the text is looked at');
  assert.deepStrictEqual(sent, [], 'nothing refused reaches the wire');

  // A session that is not steering has no packet layer at all, and says so instead of
  // silently swallowing the frame.
  const unsteered = makeHost(['packet-send'], {});
  assert.throws(function () {
    unsteered.packets.send({ direction: 'toServer', text: '%xt%zm%x%' });
  }, /not steering game traffic/i);

  // A layer that is up but has nobody connected answers false: the frame was not written.
  const idle = makeHost(['packet-send'], { getPacketSender: function () { return function () { return false; }; } });
  assert.strictEqual(idle.packets.send({ direction: 'toServer', text: '%xt%zm%x%' }), false);
});

// The composition the app boots with, over real sockets: the login body steers the client at the
// relay, the relay carries its frames to the one tap, and an injected frame goes out NUL-framed
// and shows up on that tap in the direction it was sent.
const DECLARATION = {
  id: 'steer-login',
  settingKey: 'packetSteering',
  urls: ['*://127.0.0.1/*'],
  policyDomain: 'up.example',
  allowedHosts: ['127.0.0.1'],
  hostField: 'sIP',
  portField: 'iPort'
};

// The stand-in login upstream: it answers the response shape the client actually receives, with
// the live game server's address in the row the steering rewrites.
function standInUpstream(gamePort) {
  const server = http.createServer(function (req, res) {
    req.resume();
    req.on('end', function () {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        bSuccess: 1,
        servers: [{ sName: 'First', sIP: '127.0.0.1', iPort: gamePort }]
      }));
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () { resolve({ server: server, port: server.address().port }); });
  });
}

// The stand-in game server the rewritten row points at.
function standInGameServer() {
  const seen = [];
  const server = net.createServer(function (socket) {
    socket.on('data', function (d) { seen.push(d.toString('utf8')); });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ seen: seen, port: server.address().port, server: server });
    });
  });
}

function fetchThrough(service, target) {
  const parsed = new URL(service.urlFor({ url: target }));
  return new Promise(function (resolve, reject) {
    const req = http.request({ host: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search },
      function (res) {
        const chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { resolve(Buffer.concat(chunks).toString()); });
      });
    req.on('error', reject);
    req.end();
  });
}

test('an injected frame goes out NUL-framed on the side it was sent and lands on the tap', async () => {
  const gameServer = await standInGameServer();
  const upstream = await standInUpstream(gameServer.port);
  const tap = platform.createPacketTap();
  let started = null;
  let client = null;

  const host = makeHost(['packet-tap', 'packet-send'], {
    getPacketTap: function () { return tap; },
    getPacketSender: function () { return started ? started.send : null; }
  });
  const seen = [];
  host.packets.on('frame', function (frame) {
    seen.push(frame.direction + ' ' + frame.data.toString('utf8'));
  });

  const layer = packetLayer.createPacketLayer({
    declarations: [DECLARATION],
    ctx: { settings: { packetSteering: true } },
    onFrame: function (frame) { tap.emit(frame); }
  });

  try {
    started = await layer.start();
    assert.strictEqual(started.relay.running, true);
    assert.strictEqual(started.relay.port, null,
      'no port is bound before the login response names a server');

    const rewritten = JSON.parse(await fetchThrough(started.bodyService,
      'http://127.0.0.1:' + upstream.port + '/login/now'));
    const port = rewritten.servers[0].iPort;
    assert.strictEqual(rewritten.servers[0].sIP, '127.0.0.1');
    await delay(50);

    // Nobody is connected yet, so there is nothing to write on and the answer says so.
    assert.strictEqual(started.send('toServer', '%xt%zm%early%'), false);
    assert.strictEqual(host.packets.send({ direction: 'toServer', text: '%xt%zm%early%' }), false);

    client = net.createConnection({ host: '127.0.0.1', port: port });
    const atClient = [];
    client.on('data', function (d) { atClient.push(d.toString('utf8')); });
    await new Promise(function (resolve, reject) {
      client.on('connect', resolve);
      client.on('error', reject);
    });
    client.write('%xt%zm%hello%' + NUL);
    await delay(150);

    // A plugin holding packet-send alone never learns a connection id: the layer writes on the
    // live connection itself.
    assert.strictEqual(host.packets.send({ direction: 'toServer', text: '%xt%zm%injected%' }), true);
    await delay(150);
    assert.ok(gameServer.seen.join('').indexOf('%xt%zm%injected%' + NUL) >= 0,
      'the injected frame reaches the server NUL-framed: ' + JSON.stringify(gameServer.seen.join('')));
    assert.ok(seen.indexOf('toServer %xt%zm%injected%') !== -1,
      'the tap shows the injected frame afterwards, on the side it was sent: ' + JSON.stringify(seen));

    assert.strictEqual(host.packets.send({ direction: 'toClient', text: "<msg t='sys'>apiOK</msg>" }), true);
    await delay(150);
    assert.ok(atClient.join('').indexOf("<msg t='sys'>apiOK</msg>" + NUL) >= 0,
      'a frame sent to the client arrives at the client NUL-framed: ' + JSON.stringify(atClient.join('')));
    assert.ok(seen.indexOf("toClient <msg t='sys'>apiOK</msg>") !== -1,
      'the tap shows it too, and never backwards: ' + JSON.stringify(seen));

    // The client's own frames are still shown exactly once: injection adds to the tap, it does
    // not re-report what the client sent.
    assert.deepStrictEqual(seen.filter(function (line) {
      return line === 'toServer %xt%zm%hello%';
    }).length, 1, 'a client frame is reported once: ' + JSON.stringify(seen));

    client.destroy();
    client = null;
    await delay(100);
    assert.strictEqual(started.send('toServer', '%xt%zm%gone%'), false,
      'a disconnected client leaves nothing to write on');
  } finally {
    if (client) client.destroy();
    await layer.close();
    await new Promise(function (resolve) { upstream.server.close(resolve); });
    await new Promise(function (resolve) { gameServer.server.close(resolve); });
  }
});

test('the relay writes on the newest connection and refuses a side that is not one of the two', async () => {
  const seen = [];
  const upstreamSeen = [];
  const upstream = net.createServer(function (socket) {
    socket.on('data', function (d) { upstreamSeen.push(d.toString('utf8')); });
  });
  await new Promise(function (resolve) { upstream.listen(0, '127.0.0.1', resolve); });

  const relay = socketRelay.createRelay({
    allowedHosts: ['127.0.0.1'],
    policyDomain: 'game.example',
    onFrame: function (frame) { seen.push(frame.direction + ' ' + frame.data.toString('utf8')); }
  });
  const sockets = [];
  try {
    await relay.start({ steering: { engaged: ['steer-login'], unengaged: [] } });
    const port = await relay.targetPort({ host: '127.0.0.1', port: upstream.address().port });
    const connect = function () {
      const socket = net.createConnection({ host: '127.0.0.1', port: port });
      sockets.push(socket);
      return new Promise(function (resolve, reject) {
        socket.on('connect', resolve);
        socket.on('error', reject);
      });
    };

    assert.strictEqual(relay.sendLive('toServer', 'nobody'), false, 'no connection, nothing written');
    assert.strictEqual(relay.sendLive('sideways', 'x'), false, 'there are two sides, not three');

    await connect();
    assert.strictEqual(relay.sendLive('toServer', '%xt%zm%first-client%'), true);
    await delay(100);
    assert.strictEqual(sockets[0].destroyed, false);
    sockets[0].destroy();
    await delay(100);
    assert.strictEqual(relay.sendLive('toServer', '%xt%zm%no-client%'), false,
      'the closed connection is not written on');

    await connect();
    assert.strictEqual(relay.sendLive('toServer', '%xt%zm%second-client%'), true);
    await delay(100);
    assert.ok(upstreamSeen.join('').indexOf('%xt%zm%second-client%' + NUL) >= 0,
      'the live connection is the one written on: ' + JSON.stringify(upstreamSeen.join('')));
    assert.deepStrictEqual(seen, [
      'toServer %xt%zm%first-client%',
      'toServer %xt%zm%second-client%'
    ], 'every injected frame is on the tap, in order: ' + JSON.stringify(seen));
  } finally {
    sockets.forEach(function (socket) { socket.destroy(); });
    await relay.close();
    await new Promise(function (resolve) { upstream.close(resolve); });
  }
});

// A human cannot check the boot wiring without a display, so the merge points are asserted here
// the way the tap's are: the app hands the plugin host the running layer's send, and the layer
// exposes it as one call.
test('the boot path gives the plugin host the running layer\'s send path', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const wiring = main.match(/setDependencies\(\{([\s\S]*?)\}\);/);
  assert.ok(wiring, 'the boot path wires the plugin runtime\'s dependencies in one place');
  assert.ok(/packetSender/.test(wiring[1]), 'the boot path hands over a packet sender');
  // The layer is created after plugins activate (applySessionRules runs on the way to the first
  // window), so the sender must read the live layer at call time rather than close over it.
  assert.ok(/packetLayerState\s*\?[\s\S]{0,80}packetLayerState\.send/.test(wiring[1]),
    'the sender reads the running layer when it is called');

  const runtime = fs.readFileSync(path.join(__dirname, '../../res/platform/plugin-runtime.js'), 'utf8');
  assert.ok(/if \(deps\.packetSender\)/.test(runtime),
    'the runtime stores the sender the boot path handed over');
  assert.ok(/getPacketSender:\s*function/.test(runtime), 'and exposes it to the Host deps');

  const host = fs.readFileSync(path.join(__dirname, '../../res/platform/plugin-host.js'), 'utf8');
  assert.ok(/requirePermission\('packets\.send', 'packet-send'\)/.test(host),
    'packets.send is gated through requirePermission like every other guarded method');
});
