const assert = require('assert');
const fs = require('fs');
const net = require('net');
const path = require('path');
const WebSocket = require('ws');

const socketProxy = require('../../res/socketProxy.js');
const aqwRuffle = require('../../plugins/adventure-quest-worlds/ruffle.js');

test('relay host allowlist: exact hosts and *.suffix only, deny by default', () => {
  assert.strictEqual(socketProxy.isAllowedHost('sock8.aq.com'), false, 'deny all until a plugin declares hosts');
  socketProxy.allowHosts(['*.aq.com', '*.artix.com', 'localhost']);
  assert.strictEqual(socketProxy.isAllowedHost('sock8.aq.com'), true);
  assert.strictEqual(socketProxy.isAllowedHost('SOCK7.AQ.COM'), true);
  assert.strictEqual(socketProxy.isAllowedHost('euro.aqw.artix.com'), true);
  assert.strictEqual(socketProxy.isAllowedHost('aq.com'), true);
  assert.strictEqual(socketProxy.isAllowedHost('aq.com.evil.example'), false);
  assert.strictEqual(socketProxy.isAllowedHost('evilaq.com'), false);
  assert.strictEqual(socketProxy.isAllowedHost('192.168.0.1'), false);
  assert.strictEqual(socketProxy.isAllowedHost(''), false);
  assert.strictEqual(socketProxy.isAllowedHost(null), false);
});

test('the AQW plugin declares exactly the hosts its server list uses', () => {
  const allowed = aqwRuffle.socket.allowedHosts;
  Object.keys(aqwRuffle.socket.fallbackHosts).forEach(function (host) {
    const ok = allowed.some(function (p) {
      return p.indexOf('*.') === 0 ? host.endsWith('.' + p.slice(2)) : host === p;
    });
    assert.ok(ok, host + ' must be covered by allowedHosts');
  });
  assert.strictEqual(aqwRuffle.socket.policyPort, 843);
});

test('relay origin allowlist: only the app\'s own wrapper may open a tunnel', () => {
  // Browsers cannot forge Origin, so this is what stops a local web page from tunnelling
  // through the relay to the game's servers while a Ruffle session is running.
  assert.strictEqual(socketProxy.isAllowedOrigin('file://'), true, 'the app\'s wrapper is a file:// page');
  assert.strictEqual(socketProxy.isAllowedOrigin('FILE://'), true, 'case-insensitive');
  assert.strictEqual(socketProxy.isAllowedOrigin('https://evil.example'), false);
  assert.strictEqual(socketProxy.isAllowedOrigin('http://localhost:3000'), false, 'local web pages are still web pages');
  assert.strictEqual(socketProxy.isAllowedOrigin('null'), false, 'sandboxed iframes and data: URLs report null');
  assert.strictEqual(socketProxy.isAllowedOrigin(''), false, 'deny by default');
  assert.strictEqual(socketProxy.isAllowedOrigin(undefined), false, 'a client sending no Origin is refused');
});

test('relay forwards to an allowed host and refuses everything else', async () => {
  socketProxy.allowHosts(['localhost']);

  const echo = net.createServer(function (socket) {
    socket.on('data', function (d) {
      socket.write(d);
    });
  });
  await new Promise(function (resolve) {
    echo.listen(0, '127.0.0.1', resolve);
  });
  const echoPort = echo.address().port;

  await socketProxy.start();
  const open = function (query, origin) {
    return new Promise(function (resolve) {
      const opts = origin === null ? {} : { origin: origin === undefined ? 'file://' : origin };
      const ws = new WebSocket(socketProxy.proxyUrl + '/?' + query, opts);
      const result = { messages: [], closeCode: null };
      ws.on('open', function () {
        ws.send(Buffer.from('ping'));
      });
      ws.on('message', function (m) {
        result.messages.push(Buffer.from(m).toString());
        ws.close();
      });
      ws.on('close', function (code) {
        result.closeCode = code;
        resolve(result);
      });
      ws.on('error', function () {
        result.error = true;
        resolve(result);
      });
    });
  };

  try {
    const allowed = await open('host=localhost&port=' + echoPort);
    assert.deepStrictEqual(allowed.messages, ['ping'], 'allowed host is relayed');

    const origin = 'http://127.0.0.1:45213';
    assert.throws(() => socketProxy.allowOrigin('http://127.0.0.1:45213/path'));
    assert.throws(() => socketProxy.allowLocalPort(65536));
    socketProxy.allowOrigin(origin);
    socketProxy.allowLocalPort(echoPort);
    try {
      const local = await open('host=127.0.0.1&port=' + echoPort, origin);
      assert.deepStrictEqual(local.messages, ['ping']);
      socketProxy.removeLocalPort(echoPort);
      assert.strictEqual((await open('host=127.0.0.1&port=' + echoPort, origin)).closeCode, 1008);
      socketProxy.removeOrigin(origin);
      assert.strictEqual((await open('host=localhost&port=' + echoPort, origin)).closeCode, 1008);
    } finally {
      socketProxy.removeLocalPort(echoPort);
      socketProxy.removeOrigin(origin);
    }

    const refused = await open('host=example.org&port=80');
    assert.deepStrictEqual(refused.messages, []);
    assert.strictEqual(refused.closeCode, 1008, 'disallowed host is closed with policy violation');

    const missing = await open('host=localhost');
    assert.strictEqual(missing.closeCode, 1008, 'missing port is refused');

    const foreignOrigin = await open('host=localhost&port=' + echoPort, 'https://evil.example');
    assert.deepStrictEqual(foreignOrigin.messages, [], 'a foreign origin reaches nothing');
    assert.strictEqual(foreignOrigin.closeCode, 1008, 'foreign origin is closed with policy violation');

    const noOrigin = await open('host=localhost&port=' + echoPort, null);
    assert.strictEqual(noOrigin.closeCode, 1008, 'a client sending no Origin is refused');
  } finally {
    socketProxy.stop();
    await new Promise(function (resolve) {
      echo.close(resolve);
    });
  }
});

test('ruffle wrapper takes sockets from the plugin config and names no game', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../res/ruffle_wrapper.html'), 'utf8');
  assert.ok(html.indexOf("params.get('cfg')") !== -1);
  assert.ok(html.indexOf('socketCfg.serversApi') !== -1);
  ['aq.com', 'artix', 'dragonfable', 'DFLoader', 'AQW'].forEach(function (name) {
    assert.strictEqual(html.toLowerCase().indexOf(name.toLowerCase()), -1, 'wrapper must not mention ' + name);
  });
  const proxySrc = fs.readFileSync(path.join(__dirname, '../../res/socketProxy.js'), 'utf8');
  assert.strictEqual(/aq\.com|artix\.com/i.test(proxySrc), false);
});

test('Ruffle wrapper loads the bridge with low quality and server socket mappings', async () => {
  const vm = require('vm');
  const html = fs.readFileSync(path.join(__dirname, '../../res/ruffle_wrapper.html'), 'utf8');
  let script, loaded;
  const player = { ruffle: (version) => {
    assert.strictEqual(version, 1);
    return { load: (options) => { loaded = options; return Promise.resolve(); } };
  } };
  const query = new URLSearchParams({
    swf: 'http://127.0.0.1:1234/game/bridge.swf',
    proxy: 'ws://127.0.0.1:8191',
    cfg: JSON.stringify({ socket: { serversApi: '/servers', policyPort: 843 } })
  });
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    URL, URLSearchParams, console,
    window: { location: { search: '?' + query }, RufflePlayer: { newest: () => ({ createPlayer: () => player }) } },
    document: {
      createElement: () => ({}), head: { appendChild: (s) => { script = s; } },
      getElementById: () => ({ appendChild: (p) => assert.strictEqual(p, player) })
    },
    fetch: async () => ({ json: async () => [{ sIP: '127.0.0.1', iPort: '4321' }, { sIP: 'bad', iPort: -1 }] })
  });
  await script.onload();
  assert.strictEqual(loaded.quality, 'low');
  assert.strictEqual(loaded.backgroundExecutionMode, 'mainThread', 'hidden games must keep ticking');
  assert.strictEqual(loaded.base, 'http://127.0.0.1:1234/game/');
  assert.strictEqual(loaded.socketProxy.length, 2);
  assert.strictEqual(loaded.socketProxy[0].port, 4321);
  assert.strictEqual(loaded.socketProxy[0].host, '127.0.0.1');
  assert.strictEqual(loaded.socketProxy[1].port, 843);
});

test('concurrent client processes own separate socket relays', async () => {
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, ['-e', `
    const relay = require(${JSON.stringify(require.resolve('../../res/socketProxy.js'))});
    relay.start().then(() => process.send(relay.proxyUrl));
    process.on('message', () => { relay.stop(); process.disconnect(); });
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  const url = new Promise((resolve, reject) => {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', code => reject(new Error('child relay exited: ' + code)));
  });
  try {
    await socketProxy.start();
    assert.notStrictEqual(await url, socketProxy.proxyUrl,
      'the child must never reuse a relay with another process origin allowlist');
  } finally {
    socketProxy.stop();
    if (child.connected) child.send('stop');
    if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  }
});
