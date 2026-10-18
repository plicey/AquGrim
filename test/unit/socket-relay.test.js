const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');

const socketRelay = require('../../res/socketRelay.js');

const NUL = String.fromCharCode(0);

// A stand-in for the live game server: records every byte it is handed and answers verChk, so
// forwarding can be observed without touching the network. The four cases the parity spike proved
// by hand offline (policy answered, post-policy frame kept, forwarding, refusal) start this file.
function standInUpstream() {
  const seen = [];
  const server = net.createServer(function (socket) {
    socket.on('data', function (d) {
      seen.push(d.toString('latin1'));
      if (d.toString('latin1').indexOf('verChk') >= 0) {
        socket.write("<msg t='sys'><body action='apiOK' r='0'></body></msg>" + NUL);
      }
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, seen: seen, port: server.address().port });
    });
  });
}

function exchange(port, frames, settleMs) {
  return new Promise(function (resolve, reject) {
    const socket = net.createConnection({ host: '127.0.0.1', port: port });
    const got = [];
    socket.on('connect', function () {
      frames.forEach(function (frame) { socket.write(frame); });
    });
    socket.on('data', function (d) { got.push(d.toString('latin1')); });
    socket.on('error', reject);
    setTimeout(function () { socket.destroy(); resolve(got.join('')); }, settleMs || 250);
  });
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

const STEERED = { steering: { engaged: ['steer-login'], unengaged: [] } };

async function startedRelay(upstream, extra) {
  const relay = socketRelay.createRelay(Object.assign({
    allowedHosts: ['127.0.0.1'],
    policyDomain: 'game.example'
  }, extra || {}));
  await relay.start(STEERED);
  const port = await relay.targetPort({ host: '127.0.0.1', port: upstream.port });
  return { relay: relay, port: port };
}

test('relay answers the policy request with a NUL-terminated policy naming its own port', async () => {
  const upstream = await standInUpstream();
  const started = await startedRelay(upstream);
  try {
    const out = await exchange(started.port, ['<policy-file-request/>' + NUL]);
    assert.ok(out.indexOf('<cross-domain-policy>') >= 0, 'no policy in reply: ' + JSON.stringify(out));
    assert.ok(out.indexOf("domain='game.example'") >= 0, 'policy must gate on the allowed origin: ' + out);
    assert.ok(out.indexOf("to-ports='" + started.port + "'") >= 0, "to-ports must be the relay's own port: " + out);
    assert.strictEqual(out[out.length - 1], NUL, 'policy reply is not NUL terminated');
    assert.ok(started.port >= 1024, 'Flash only accepts a policy from a port at or above 1024');
  } finally {
    await started.relay.close();
    upstream.server.close();
  }
});

test('relay keeps a frame that arrived in the same chunk as the policy request', async () => {
  const upstream = await standInUpstream();
  const started = await startedRelay(upstream);
  try {
    const out = await exchange(started.port, [
      '<policy-file-request/>' + NUL + "<msg t='sys'><body action='verChk' r='0'><ver v='166'/></body></msg>" + NUL
    ], 400);
    assert.ok(out.indexOf('apiOK') >= 0, 'the frame after the policy must reach upstream: ' + JSON.stringify(out));
    assert.ok(upstream.seen.join('').indexOf('verChk') >= 0, 'upstream never saw the frame');
  } finally {
    await started.relay.close();
    upstream.server.close();
  }
});

test('relay shows both directions in order with frame boundaries preserved', async () => {
  const upstream = await standInUpstream();
  const frames = [];
  const started = await startedRelay(upstream, {
    onFrame: function (frame) { frames.push(frame.direction + ' ' + frame.data.toString('latin1')); }
  });
  try {
    await exchange(started.port, [
      "<msg t='sys'><body action='verChk' r='0'></body></msg>" + NUL + '%xt%zm%first%',
      'second%' + NUL
    ], 400);
    await delay(50);
    assert.deepStrictEqual(frames, [
      "toServer <msg t='sys'><body action='verChk' r='0'></body></msg>",
      'toServer %xt%zm%first%second%',
      "toClient <msg t='sys'><body action='apiOK' r='0'></body></msg>"
    ], 'frames must arrive in order, NUL-stripped, boundaries intact: ' + JSON.stringify(frames));
  } finally {
    await started.relay.close();
    upstream.server.close();
  }
});

test('relay send path writes a frame to either side of the open connection', async () => {
  const upstream = await standInUpstream();
  const started = await startedRelay(upstream);
  const client = net.createConnection({ host: '127.0.0.1', port: started.port });
  const toClient = [];
  client.on('data', function (d) { toClient.push(d.toString('latin1')); });
  try {
    await new Promise(function (resolve, reject) {
      client.on('connect', resolve);
      client.on('error', reject);
    });
    client.write('%xt%zm%hello%' + NUL);
    await delay(200);
    const connection = started.relay.connections()[0];
    assert.ok(connection, 'the relay must name the connection it is carrying');

    assert.strictEqual(started.relay.send(connection.id, 'toServer', '%xt%zm%injected%'), true);
    assert.strictEqual(started.relay.send(connection.id, 'toClient', '%xt%zm%incoming%'), true);
    await delay(200);

    assert.ok(upstream.seen.join('').indexOf('%xt%zm%injected%' + NUL) >= 0,
      'a frame sent to the server arrives NUL-framed: ' + JSON.stringify(upstream.seen.join('')));
    assert.ok(toClient.join('').indexOf('%xt%zm%incoming%' + NUL) >= 0,
      'a frame sent to the client arrives NUL-framed: ' + JSON.stringify(toClient.join('')));

    assert.strictEqual(started.relay.send(999999, 'toServer', 'x'), false, 'an unknown connection is refused');
    assert.strictEqual(started.relay.send(connection.id, 'sideways', 'x'), false, 'an unknown direction is refused');
  } finally {
    client.destroy();
    await started.relay.close();
    upstream.server.close();
  }
});

test('relay target table denies by default and refuses hosts outside the allowlist', async () => {
  const relay = socketRelay.createRelay({ allowedHosts: ['*.example'], policyDomain: 'game.example' });
  await relay.start(STEERED);
  await assert.rejects(function () { return relay.targetPort({ host: '127.0.0.1', port: 5593 }); },
    /not allowed/, 'a host outside the allowlist is refused');
  await assert.rejects(function () { return relay.targetPort({ host: 'example.evil.test', port: 5593 }); },
    /not allowed/, 'a suffix lookalike is refused');
  await assert.rejects(function () { return relay.targetPort({ host: 'sock7.example' }); },
    /host and a port/, 'a target needs both host and port');

  const first = await relay.targetPort({ host: 'SOCK7.EXAMPLE', port: 5593 });
  assert.strictEqual(await relay.targetPort({ host: 'sock7.example', port: 5593 }), first,
    'the same server keeps one port for the session');
  const second = await relay.targetPort({ host: 'sock8.example', port: 5593 });
  assert.notStrictEqual(second, first, 'a different server gets its own port');
  assert.deepStrictEqual(relay.targets(), [
    { host: 'sock7.example', port: 5593 },
    { host: 'sock8.example', port: 5593 }
  ]);
  await relay.close();
});

test('relay refuses to start when steering is not engaged, and names the rule', async () => {
  const relay = socketRelay.createRelay({ allowedHosts: ['*.example'], policyDomain: 'game.example' });
  const refused = await relay.start({ steering: { engaged: [], unengaged: ['steer-login'] } })
    .then(function () { return null; }, function (error) { return error; });

  assert.ok(refused, 'a relay that cannot steer must not come up');
  assert.ok(/steer-login/.test(refused.message), 'the refusal names the unengaged rule: ' + refused.message);
  assert.strictEqual(relay.port, null, 'nothing is bound after a refusal');
  assert.strictEqual(relay.isRunning(), false);
  await assert.rejects(function () { return relay.targetPort({ host: 'sock7.example', port: 1 }); },
    /has not started/, 'a refused relay serves no target');
  await relay.close();
});

test('relay refuses a wildcard policy domain, a missing domain, or an empty allowlist', async () => {
  const wildcard = socketRelay.createRelay({ allowedHosts: ['*.example'], policyDomain: '*' });
  const wildcardError = await wildcard.start(STEERED)
    .then(function () { return null; }, function (error) { return error; });
  assert.ok(wildcardError && /domain/.test(wildcardError.message),
    'a wildcard policy admits every SWF on the machine');
  await wildcard.close();

  const missing = socketRelay.createRelay({ allowedHosts: ['*.example'] });
  const missingError = await missing.start(STEERED)
    .then(function () { return null; }, function (error) { return error; });
  assert.ok(missingError && /domain/.test(missingError.message), 'no domain means no gate, so refuse');
  await missing.close();

  const open = socketRelay.createRelay({ allowedHosts: [], policyDomain: 'game.example' });
  const openError = await open.start(STEERED)
    .then(function () { return null; }, function (error) { return error; });
  assert.ok(openError && /allowlist/.test(openError.message), 'no allowlist means forward anywhere');
  await open.close();
});

test('the relay names no game and never serves a wildcard policy', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../res/socketRelay.js'), 'utf8');
  ['aq.com', 'artix', 'aqw', 'dragonfable'].forEach(function (name) {
    assert.strictEqual(source.toLowerCase().indexOf(name), -1, 'the relay must not mention ' + name);
  });
  assert.strictEqual(source.indexOf("domain='*'"), -1, 'the relay never serves a wildcard policy');
});

test('a client cannot choose a host: the listener port is the target, so there is no host parameter', async () => {
  const first = await standInUpstream();
  const second = await standInUpstream();
  const relay = socketRelay.createRelay({ allowedHosts: ['127.0.0.1'], policyDomain: 'game.example' });
  await relay.start(STEERED);
  const firstPort = await relay.targetPort({ host: '127.0.0.1', port: first.port });
  const secondPort = await relay.targetPort({ host: '127.0.0.1', port: second.port });
  try {
    assert.notStrictEqual(firstPort, secondPort);
    // Whatever a client says on the wire, it reaches only the server its port stands for.
    await exchange(firstPort, ['%xt%zm%only-first%' + NUL], 250);
    await exchange(secondPort, ['%xt%zm%only-second%' + NUL], 250);
    assert.ok(first.seen.join('').indexOf('only-first') >= 0);
    assert.strictEqual(first.seen.join('').indexOf('only-second'), -1,
      'the first target must never receive what was sent to the second');
    assert.ok(second.seen.join('').indexOf('only-second') >= 0);
    assert.strictEqual(second.seen.join('').indexOf('only-first'), -1);
  } finally {
    await relay.close();
    first.server.close();
    second.server.close();
  }
});

test('every listener is bound to loopback only, and closing releases the ports', async () => {
  const upstream = await standInUpstream();
  const started = await startedRelay(upstream);
  const port = started.port;
  try {
    // A connection from anywhere else is impossible: the listener bound 127.0.0.1, not 0.0.0.0.
    const nonLoopback = Object.keys(require('os').networkInterfaces()).reduce(function (found, name) {
      if (found) return found;
      (require('os').networkInterfaces()[name] || []).forEach(function (entry) {
        if (!found && entry.family === 'IPv4' && !entry.internal) found = entry.address;
      });
      return found;
    }, null);
    if (nonLoopback) {
      const refused = await new Promise(function (resolve) {
        const socket = net.createConnection({ host: nonLoopback, port: port });
        socket.on('connect', function () { socket.destroy(); resolve(false); });
        socket.on('error', function () { resolve(true); });
        setTimeout(function () { socket.destroy(); resolve(false); }, 1500);
      });
      assert.strictEqual(refused, true, 'the relay must not be reachable off loopback');
    }
  } finally {
    await started.relay.close();
    upstream.server.close();
  }

  const after = await new Promise(function (resolve) {
    const socket = net.createConnection({ host: '127.0.0.1', port: port });
    socket.on('connect', function () { socket.destroy(); resolve(false); });
    socket.on('error', function () { resolve(true); });
  });
  assert.strictEqual(after, true, 'closing the relay releases its ports');
});

test('a policy request split across chunks is still recognised, and a mid-frame chunk is not lost', async () => {
  const upstream = await standInUpstream();
  const started = await startedRelay(upstream);
  try {
    // Flash may write the request in pieces; the relay must not treat a partial one as game traffic.
    const out = await new Promise(function (resolve, reject) {
      const socket = net.createConnection({ host: '127.0.0.1', port: started.port });
      const got = [];
      socket.on('connect', function () {
        socket.write('<policy-file-');
        setTimeout(function () {
          socket.write('request/>' + NUL + "<msg t='sys'><body action='verChk' r='0'></body></msg>" + NUL);
        }, 60);
      });
      socket.on('data', function (d) { got.push(d.toString('latin1')); });
      socket.on('error', reject);
      setTimeout(function () { socket.destroy(); resolve(got.join('')); }, 450);
    });
    assert.ok(out.indexOf('<cross-domain-policy>') >= 0, 'the split request was still answered: ' + JSON.stringify(out));
    assert.ok(out.indexOf('apiOK') >= 0, 'and its following frame still reached upstream');
  } finally {
    await started.relay.close();
    upstream.server.close();
  }
});

test('the relay keeps no frame content of its own: frames are handed out, not accumulated', async () => {
  const upstream = await standInUpstream();
  const frames = [];
  const started = await startedRelay(upstream, {
    onFrame: function (frame) { frames.push(frame); }
  });
  try {
    await exchange(started.port, ['%xt%zm%a-long-frame-value%' + NUL], 300);
    assert.strictEqual(frames.length >= 1, true);
    // The frame carries exactly what crossed, with the NUL delimiter removed.
    assert.strictEqual(frames[0].data.toString('latin1'), '%xt%zm%a-long-frame-value%');
    assert.strictEqual(frames[0].data.indexOf(0), -1, 'the delimiter is not part of the frame');
    assert.strictEqual(typeof frames[0].id, 'number', 'every frame names its connection');
    assert.strictEqual(frames[0].direction, 'toServer');
  } finally {
    await started.relay.close();
    upstream.server.close();
  }
});
