// The steering rule (spec #19 / ticket #22): the client never fetches a server-list endpoint,
// so the live list arrives inside the login response body and the rewrite happens there. The
// rule is platform code built from a plugin's declaration, because the platform names no game:
// the URL, the row field names and the hosts are the declaring plugin's facts.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const platform = require('../../res/platform');
const packetLayer = require('../../res/platform/packet-layer.js');
const bodyService = require('../../res/platform/body-service.js');
const { createOriginProxy } = require('../../res/platform/origin-proxy.js');

const DECLARATION = {
  id: 'steer-login',
  settingKey: 'packetSteering',
  // The stand-in upstream runs on loopback, so the declaration matches loopback here. In the
  // game's own plugin the same field carries the live login URL.
  urls: ['*://127.0.0.1/*'],
  policyDomain: 'up.example',
  allowedHosts: ['*.up.example'],
  hostField: 'sIP',
  portField: 'iPort'
};

const LOGIN_BODY = JSON.stringify({
  bSuccess: 1,
  servers: [
    { sName: 'First', sIP: 'sock1.up.example', iPort: 5593 },
    { sName: 'Second', sIP: 'sock2.up.example', iPort: 5594 }
  ]
});

function manifest(extra) {
  return Object.assign({
    id: 'steering-probe',
    name: 'Steering probe',
    version: '1.0.0',
    apiVersion: 2,
    main: 'main.js',
    minAppVersion: '2.0.0'
  }, extra || {});
}

function makeHost(extra, deps) {
  return platform.createPluginHost({
    manifest: manifest(extra),
    pluginRoot: path.join(__dirname, '../fixtures/sample-plugin'),
    appVersion: '2.0.0',
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    log: function () {},
    deps: deps || {}
  });
}

// A stand-in upstream: the login path answers the response shape the client actually receives.
function standInUpstream(loginBody) {
  const server = http.createServer(function (req, res) {
    req.resume();
    req.on('end', function () {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(loginBody || LOGIN_BODY);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () { resolve({ server: server, port: server.address().port }); });
  });
}

function fakeSession() {
  const registered = { request: [], headers: [] };
  return {
    registered: registered,
    webRequest: {
      onBeforeRequest: function (filter, listener) { registered.request.push({ filter: filter, listener: listener }); },
      onBeforeSendHeaders: function (filter, listener) { registered.headers.push({ filter: filter, listener: listener }); }
    }
  };
}

function fetchThrough(service, target, method) {
  const parsed = new URL(service.urlFor({ url: target }));
  return new Promise(function (resolve, reject) {
    const req = http.request({ host: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search,
      method: method || 'GET' },
      function (res) {
        const chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () { resolve(Buffer.concat(chunks).toString()); });
      });
    req.on('error', reject);
    req.end();
  });
}

test('the Host records a steering declaration only for a plugin holding packet-tap', () => {
  const denied = makeHost({ permissions: [] });
  assert.throws(function () {
    denied.registerPacketSteering(DECLARATION);
  }, /without permission "packet-tap"/);

  const allowed = makeHost({ permissions: ['packet-tap'] });
  const recorded = allowed.registerPacketSteering(DECLARATION);
  assert.strictEqual(recorded, undefined);
  assert.deepStrictEqual(allowed._getState().packetSteering, [DECLARATION]);

  // A second declaration with the same id is refused, like every other registration point.
  assert.throws(function () {
    allowed.registerPacketSteering(DECLARATION);
  }, /Duplicate/);

  assert.throws(function () {
    allowed.registerPacketSteering({ id: 'incomplete' });
  }, /urls|required/i);
});

test('a steering declaration turns a login response into rows that point at the relay', async () => {
  const upstream = await standInUpstream();
  const session = fakeSession();
  const layer = packetLayer.createPacketLayer({
    declarations: [DECLARATION],
    session: session,
    ctx: { settings: { packetSteering: true } }
  });
  const started = await layer.start();
  try {
    assert.strictEqual(started.steering.engaged.length, 1, 'the rule engaged');
    assert.strictEqual(started.relay.running, true, 'the relay is up because steering is guaranteed');
    assert.strictEqual(started.relay.port, null,
      'no port is bound before a row needs one: a relay with nothing to serve holds no listener');

    // The layer hands its steering rules back instead of registering them, because Electron keeps
    // one listener per webRequest event: the boot path merges them into its single registration.
    assert.strictEqual(session.registered.request.length, 0,
      'the layer must not register a listener of its own');
    assert.strictEqual(started.rules.length, 1);
    assert.strictEqual(started.rules[0].id, 'steer-login');
    assert.strictEqual(typeof started.rules[0].onResponseBody, 'function');

    // Merged the way boot does it: one listener covers the platform rules and the steering rule.
    const merged = require('../../res/platform/session-rules.js').applySessionRules(
      session,
      platform.createPlatformSessionRules().concat(started.rules),
      { responseBody: started.responseBody, settings: { packetSteering: true } }
    );
    const { BLOCKED_HOST_PATTERNS } = require('../../res/platform/platform-rules.js');
    assert.strictEqual(session.registered.request.length, 1, 'one listener per event still holds');
    assert.deepStrictEqual(merged.responseBody.engaged, ['steer-login'], 'the steering rule is engaged');
    BLOCKED_HOST_PATTERNS.forEach(function (pattern) {
      assert.ok(session.registered.request[0].filter.urls.indexOf(pattern) !== -1,
        'ad blocking is still in the same listener: ' + pattern);
    });

    let blocked = null;
    session.registered.request[0].listener({ url: 'https://pagead2.doubleclick.net/ad.js' }, function (r) {
      blocked = r;
    });
    assert.deepStrictEqual(blocked, { cancel: true }, 'steering did not switch ad blocking off');
    const client = await fetchThrough(started.bodyService,
      'http://127.0.0.1:' + upstream.port + '/login/now');
    const rows = JSON.parse(client).servers;
    assert.strictEqual(rows.length, 2, 'every row the upstream sent is kept');
    rows.forEach(function (row) {
      assert.strictEqual(row.sIP, '127.0.0.1', 'the row points at loopback: ' + JSON.stringify(row));
      assert.strictEqual(row.sName, JSON.parse(LOGIN_BODY).servers[rows.indexOf(row)].sName, 'nothing else changed');
    });
    assert.notStrictEqual(rows[0].iPort, rows[1].iPort, 'each server keeps its own relay port');
    rows.forEach(function (row) {
      assert.ok(row.iPort >= 1024, 'the relay port is one Flash accepts a policy from');
    });

    // The relay now serves exactly the two real servers the response named, and nothing else.
    assert.deepStrictEqual(started.relay.targets(), [
      { host: 'sock1.up.example', port: 5593 },
      { host: 'sock2.up.example', port: 5594 }
    ]);
    assert.strictEqual(started.relay.targets().length, 2,
      'the child allowed no host outside the declaration');
  } finally {
    await layer.close();
    upstream.server.close();
  }
});

test('no relay comes up when the steering flag is off, and the reason is reported', async () => {
  const session = fakeSession();
  const logged = [];
  const layer = packetLayer.createPacketLayer({
    declarations: [DECLARATION],
    session: session,
    ctx: { settings: { packetSteering: false }, logLine: function (l) { logged.push(l); } }
  });
  const started = await layer.start();
  try {
    assert.deepStrictEqual(started.steering, { engaged: [], unengaged: ['steer-login'] });
    assert.strictEqual(started.relay.running, false, 'a relay that cannot steer must not come up');
    assert.strictEqual(started.relay.port, null);
    assert.ok(logged.some(function (l) { return /steer-login/.test(l); }),
      'the reason names the rule: ' + JSON.stringify(logged));
  } finally {
    await layer.close();
  }
});

test('local login POST stays on its origin and uses the packet rule on the upstream response', async () => {
  const runtime = require('../../res/platform/plugin-runtime.js');
  const seen = [];
  const upstream = http.createServer(function (req, res) {
    const chunks = [];
    req.on('data', function (chunk) { chunks.push(chunk); });
    req.on('end', function () {
      seen.push({ method: req.method, url: req.url, body: Buffer.concat(chunks).toString() });
      const body = LOGIN_BODY.replace(/\.up\.example/g, '.aq.com');
      res.writeHead(201, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    });
  });
  await new Promise(function (resolve) { upstream.listen(0, '127.0.0.1', resolve); });
  const upstreamOrigin = 'http://127.0.0.1:' + upstream.address().port;
  let started = null;
  runtime.clear();
  runtime.setDependencies({
    constant: {}, createOriginProxy: createOriginProxy,
    packetLayer: function () { return started; }
  });
  const baseUrl = await runtime.startGameOrigin({ routes: [
    { prefix: '/api/', origin: upstreamOrigin + '/game/api' },
    { prefix: '/', origin: upstreamOrigin }
  ] });
  const declaration = require('../../plugins/grimlite-parity/packets.js').steeringDeclarations(baseUrl)[0];
  // Only the fake upstream replaces the live host; local URLs must never match this rule.
  declaration.urls = declaration.urls.map(function (url) {
    return url.replace('*://game.aq.com', upstreamOrigin);
  });
  try {
    started = await packetLayer.createPacketLayer({
      declarations: [declaration], ctx: { settings: { packetSteering: true } }
    }).start();
    const session = fakeSession();
    require('../../res/platform/session-rules.js').applySessionRules(session, started.rules, {
      responseBody: started.responseBody
    });
    for (const alias of ['/game/api/login/now', '/api/login/now']) {
      const url = baseUrl + alias + '?probe=1';
      const posted = await new Promise(function (resolve, reject) {
        const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, function (res) {
          const chunks = [];
          res.on('data', function (chunk) { chunks.push(chunk); });
          res.on('end', function () {
            resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() });
          });
        });
        req.on('error', reject);
        req.end('{"username":"test","password":"fake"}');
      });
      assert.strictEqual(posted.status, 201);
      assert.strictEqual(posted.headers.location, undefined);
      assert.deepStrictEqual(seen[seen.length - 1], {
        method: 'POST', url: '/game/api/login/now?probe=1',
        body: '{"username":"test","password":"fake"}'
      });
      const rows = JSON.parse(posted.body).servers;
      assert.ok(rows.every(function (row) { return row.sIP === '127.0.0.1' && row.iPort >= 1024; }),
        'the original origin response must contain relay addresses');
      let result;
      session.registered.request[0].listener({ url: url }, function (answer) { result = answer; });
      assert.ok(!result.redirectURL, 'local login must never redirect to the body service');
    }
    assert.strictEqual(declaration.policyDomain, '127.0.0.1');
    await started.close();
    started = await packetLayer.createPacketLayer({
      declarations: [declaration], ctx: { settings: { packetSteering: false } }
    }).start();
    const untouched = await new Promise(function (resolve, reject) {
      http.get(baseUrl + '/api/login/now', function (res) {
        const chunks = [];
        res.on('data', function (chunk) { chunks.push(chunk); });
        res.on('end', function () {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
        });
      }).on('error', reject);
    });
    assert.strictEqual(untouched.status, 201);
    assert.strictEqual(untouched.body, LOGIN_BODY.replace(/\.up\.example/g, '.aq.com'));
    assert.strictEqual(started.relay.running, false);
  } finally {
    if (started) await started.close();
    await runtime.stopGameOrigin();
    runtime.setDependencies({ packetLayer: function () { return null; } });
    runtime.clear();
    await new Promise(function (resolve) { upstream.close(resolve); });
  }
});

test('the parity plugin declares its steering behind an opt-in flag and names no platform fact', () => {
  const declarations = require('../../plugins/grimlite-parity/packets.js').steeringDeclarations();
  assert.ok(Array.isArray(declarations) && declarations.length >= 1);
  const declaration = declarations[0];
  assert.strictEqual(declaration.settingKey, 'packetSteering');
  assert.ok(declaration.hostField && declaration.portField);
  assert.ok(declaration.urls.some(function (u) { return /login/.test(u); }),
    'the login response is the steering point: ' + JSON.stringify(declaration.urls));
  assert.ok(declaration.allowedHosts.length >= 1, 'the relay forwards only to declared hosts');
  assert.ok(declaration.policyDomain.indexOf('*') === -1, 'a wildcard policy is never declared');

  // Isolation: the declaration names the game, and it lives in the game's own plugin.
  const platformSource = fs.readFileSync(path.join(__dirname, '../../res/platform/packet-layer.js'), 'utf8');
  ['aq.com', 'artix', 'aqw'].forEach(function (name) {
    assert.strictEqual(platformSource.toLowerCase().indexOf(name), -1,
      'the platform must not name ' + name);
  });
});

// A human cannot check the boot wiring without a display, so the merge points are asserted here:
// the one-listener invariant depends on exactly one applySessionRules call carrying the steering
// rules, and the opt-in depends on the flag being read from settings.
test('the boot path merges steering into its single session-rule registration', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');

  // One registration into Electron, which is the invariant that matters: the platform applicator
  // is called from exactly one place, and every rule set reaches it through that one call.
  assert.strictEqual((main.match(/platform\.applySessionRules\(/g) || []).length, 1,
    'one registration call: a second would silently replace the first');
  assert.strictEqual((main.match(/session\.defaultSession\.webRequest\./g) || []).length, 0,
    'boot never registers a webRequest listener itself');
  assert.ok(/platform\.createPlatformSessionRules\(\)[\s\S]{0,120}concat\(pluginRules\)[\s\S]{0,120}concat\(packetRules\)/.test(main),
    'platform + plugin + steering rules share the one listener');
  assert.ok(/\.packetSteering \|\| \[\]/.test(main), 'the boot path reads the plugin declarations');
  assert.ok(/await applySessionRules\(\)/.test(main),
    'steering may bind a listener, so the window waits for it');
  assert.ok(/packetLayerState\s*=\s*null/.test(main), 'a refused layer is dropped, not half-used');
  assert.ok(/[AquGrim:packets]/.test(main), 'a refusal says so on the console');

  // The opt-in flag reaches the layer from settings, like every other platform flag.
  assert.ok(/packetSteering: keyb\.keybinds\.packetSteering/.test(main),
    'the steering flag is a setting, not a constant');
});

test('steering is all-or-nothing: one row outside the allowlist leaves the whole response real', async () => {
  const upstream = await http.createServer(function (req, res) {
    req.resume();
    req.on('end', function () {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        bSuccess: 1,
        servers: [
          { sName: 'Allowed', sIP: 'sock1.up.example', iPort: 5593 },
          { sName: 'Not allowed', sIP: 'somewhere.else.test', iPort: 5594 }
        ]
      }));
    });
  });
  await new Promise(function (resolve) { upstream.listen(0, '127.0.0.1', resolve); });

  const layer = packetLayer.createPacketLayer({
    declarations: [DECLARATION],
    ctx: { settings: { packetSteering: true }, logLine: function () {} }
  });
  const started = await layer.start();
  try {
    const client = await fetchThrough(started.bodyService,
      'http://127.0.0.1:' + upstream.address().port + '/login/now');
    const rows = JSON.parse(client).servers;
    assert.strictEqual(rows[0].sIP, 'sock1.up.example',
      'nothing is steered when any row cannot be: the client must not half-connect');
    assert.strictEqual(rows[1].sIP, 'somewhere.else.test');
    assert.deepStrictEqual(started.relay.targets(), [],
      'no listener was bound for a response that could not be steered');
  } finally {
    await layer.close();
    upstream.close();
  }
});

// The plugin's own activation is what a human would otherwise have to eyeball on a display: the
// declaration reaches the platform from a real activate() with the manifest's real permissions.
test('activating the parity plugin hands the platform exactly one steering declaration', async () => {
  const repoRoot = path.join(__dirname, '../..');
  const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  const discovered = platform.discoverPlugins({
    bundledDir: path.join(repoRoot, 'plugins'),
    appVersion: appVersion,
    log: function () {}
  });
  const plugin = discovered.plugins.filter(function (p) {
    return p.manifest.id === 'grimlite-parity';
  })[0];
  assert.ok(plugin, 'the parity plugin must be discovered: ' + discovered.errors.join('; '));

  const activated = await platform.activatePlugin(plugin, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: {
      openFeatureWindow: function () { return {}; },
      startGameOrigin: function () { return Promise.resolve('http://127.0.0.1:43123'); }
    }
  });
  const recorded = activated.host._getState().packetSteering;
  assert.strictEqual(recorded.length, 1, 'exactly one declaration, from a plugin holding packet-tap');
  assert.strictEqual(recorded[0].settingKey, 'packetSteering');
  assert.ok(recorded[0].urls.length >= 1);
  assert.deepStrictEqual(recorded[0].urls, ['*://game.aq.com/game/api/login/now*']);
  assert.strictEqual(recorded[0].policyDomain, '127.0.0.1');

  // And the opt-in is off until the player turns it on: default settings engage nothing.
  const defaults = activated.host._getState().optionDefaults || {};
  assert.strictEqual(defaults.packetSteering, false, 'steering is the player opt-in');

  const offered = (activated.host._getState().settingsSections || []).filter(function (section) {
    return (section.fields || []).some(function (field) { return field.key === 'packetSteering'; });
  });
  assert.strictEqual(offered.length, 1, 'the switch is reachable in Settings');

  // With the opt-in still off, the layer engages nothing and no relay appears.
  const layer = packetLayer.createPacketLayer({
    declarations: recorded,
    ctx: { settings: defaults, logLine: function () {} }
  });
  const started = await layer.start();
  try {
    assert.deepStrictEqual(started.steering.engaged, []);
    assert.strictEqual(started.relay.running, false);
    assert.strictEqual(started.rules.length, 0);
  } finally {
    await layer.close();
  }
});

// The refusal path is the ticket's point, so it must not leave anything listening behind: a body
// service bound before the relay refused would hold a loopback port nothing will ever close.
test('a refused relay leaves no loopback listener behind', async () => {
  const session = fakeSession();
  const built = [];
  const layer = packetLayer.createPacketLayer({
    declarations: [Object.assign({}, DECLARATION, { policyDomain: '*' })],
    session: session,
    ctx: { settings: { packetSteering: true }, logLine: function () {} },
    // The body service is injected the way the platform injects its own deps, so the test can prove
    // that a refusal never gets as far as binding a loopback port.
    createBodyService: function (options) {
      const service = bodyService.createBodyService(options);
      built.push(service);
      return service;
    }
  });
  const error = await layer.start().then(function () { return null; }, function (e) { return e; });
  assert.ok(error && /domain/.test(error.message), 'the relay refused: ' + (error && error.message));

  // Building the service is free; binding is not. The gates are checked before any listener opens,
  // so the service exists but never held a port.
  assert.strictEqual(built.length, 1, 'the layer composed its body service');
  built.forEach(function (service) {
    assert.strictEqual(service.port, null,
      'a refused layer must not leave a loopback port bound');
  });
  await layer.close();
});

test('login steering survives redirects to a URL outside the login pattern', async () => {
  const runtime = require('../../res/platform/plugin-runtime.js');
  const upstream = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/login' || req.url === '/redirected') {
      res.writeHead(307, { Location: req.url === '/login' ? '/redirected' : '/canonical' });
      res.end();
    } else res.end(LOGIN_BODY);
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamOrigin = 'http://127.0.0.1:' + upstream.address().port;
  let layer;
  runtime.clear();
  runtime.setDependencies({ constant: {}, createOriginProxy,
    packetLayer: () => layer });
  try {
    const baseUrl = await runtime.startGameOrigin({ routes: [{ prefix: '/', origin: upstreamOrigin }] });
    layer = await packetLayer.createPacketLayer({
      declarations: [Object.assign({}, DECLARATION, { urls: [upstreamOrigin + '/login*'] })],
      ctx: { settings: { packetSteering: true } }
    }).start();
    const body = await new Promise((resolve, reject) => {
      http.get(baseUrl + '/login', res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      }).on('error', reject);
    });
    assert.ok(JSON.parse(body).servers.every(row => row.sIP === '127.0.0.1'),
      'a redirected login must still send game traffic through the drop relay');
  } finally {
    if (layer) await layer.close();
    await runtime.stopGameOrigin();
    runtime.setDependencies({ packetLayer: () => null });
    runtime.clear();
    await new Promise(resolve => upstream.close(resolve));
  }
});
