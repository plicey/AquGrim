const assert = require('assert');
const http = require('http');

const bodyService = require('../../res/platform/body-service.js');
const { matchesPattern } = require('../../res/platform/session-rules.js');

// A stand-in upstream. The login path answers with server rows, because that is the shape the
// client actually receives; every other path echoes what it was sent, so forwarding can be
// checked byte for byte.
function standInUpstream() {
  const requests = [];
  const server = http.createServer(function (req, res) {
    const chunks = [];
    req.on('data', function (c) { chunks.push(c); });
    req.on('end', function () {
      const body = Buffer.concat(chunks).toString();
      requests.push({ method: req.method, url: req.url, headers: req.headers, body: body });
      if (req.url.indexOf('/redirect') === 0) {
        res.writeHead(302, { Location: '/stayed-here' });
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Upstream': 'yes' });
      if (req.url.indexOf('/login/now') === 0) {
        res.end(JSON.stringify({
          bSuccess: 1,
          servers: [
            { sName: 'First', sIP: 'sock1.live.example', iPort: 5593 },
            { sName: 'Second', sIP: 'sock2.live.example', iPort: 5594 }
          ]
        }));
        return;
      }
      res.end(JSON.stringify({ url: req.url, method: req.method, body: body }));
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      resolve({ server: server, requests: requests, port: server.address().port });
    });
  });
}

// Reach the service the way the steering layer does: ask it for the loopback URL of a target.
function fetchThrough(service, target, options) {
  options = options || {};
  const url = service.urlFor({ url: target, method: options.method || 'GET' });
  const parsed = new URL(url);
  return new Promise(function (resolve, reject) {
    const req = http.request({
      host: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {}
    }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() });
      });
    });
    req.on('error', reject);
    req.end(options.body || undefined);
  });
}

function rawGet(port, path) {
  return new Promise(function (resolve, reject) {
    http.get({ host: '127.0.0.1', port: port, path: path }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }); });
    }).on('error', reject);
  });
}

function serviceWithLoginRule(extra) {
  return bodyService.createBodyService({
    matchesPattern: matchesPattern,
    rules: [Object.assign({
      id: 'steer-login',
      urls: ['*://127.0.0.1/login/*'],
      onResponseBody: function (context, body) {
        return body.toString()
          .replace('sock1.live.example', '127.0.0.1')
          .replace('"iPort":5593', '"iPort":8600')
          .replace('sock2.live.example', '127.0.0.1')
          .replace('"iPort":5594', '"iPort":8601');
      }
    }, extra || {})]
  });
}

test('body service serves a matched URL through loopback and replaces its body', async () => {
  const upstream = await standInUpstream();
  const target = 'http://127.0.0.1:' + upstream.port + '/login/now';
  const service = serviceWithLoginRule();
  const started = await service.start();
  try {
    assert.ok(started.port >= 1024, 'the service listens on an ephemeral loopback port');
    assert.ok(service.urlFor({ url: target }).indexOf('http://127.0.0.1:' + started.port + '/') === 0,
      'the loopback URL is the service\'s own: ' + service.urlFor({ url: target }));

    const out = await fetchThrough(service, target);
    assert.strictEqual(out.status, 200);
    assert.strictEqual(out.headers['x-upstream'], 'yes', 'upstream headers survive');
    assert.deepStrictEqual(JSON.parse(out.body), {
      bSuccess: 1,
      servers: [
        { sName: 'First', sIP: '127.0.0.1', iPort: 8600 },
        { sName: 'Second', sIP: '127.0.0.1', iPort: 8601 }
      ]
    }, 'the client receives the rewritten rows: ' + out.body);
    assert.strictEqual(out.headers['content-length'], String(Buffer.byteLength(out.body)),
      'the replacement is served whole, with a matching length');
    assert.strictEqual(upstream.requests.length, 1);
    assert.strictEqual(upstream.requests[0].url, '/login/now', 'the path is preserved upstream');
  } finally {
    await service.close();
    upstream.server.close();
  }
});

test('body service forwards a POST body and headers intact, then rewrites the response', async () => {
  const upstream = await standInUpstream();
  const credentials = JSON.stringify({ user: 'someone', pass: 'a-secret' });
  const seen = [];
  const service = serviceWithLoginRule({
    onResponseBody: function (context, body) {
      seen.push({ method: context.method, statusCode: context.statusCode, bytes: body.length });
      return body.toString().replace('sock1.live.example', '127.0.0.1');
    }
  });
  await service.start();
  try {
    const out = await fetchThrough(service, 'http://127.0.0.1:' + upstream.port + '/login/now?ran=0.5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: credentials
    });

    assert.strictEqual(upstream.requests.length, 1, 'exactly one upstream request');
    assert.strictEqual(upstream.requests[0].method, 'POST', 'the method is preserved');
    assert.strictEqual(upstream.requests[0].body, credentials, 'the request body reaches upstream');
    assert.strictEqual(upstream.requests[0].headers['content-type'], 'application/json');
    assert.strictEqual(upstream.requests[0].url, '/login/now?ran=0.5', 'the query is preserved');

    assert.deepStrictEqual(seen, [{ method: 'POST', statusCode: 200, bytes: JSON.stringify({
      bSuccess: 1,
      servers: [
        { sName: 'First', sIP: 'sock1.live.example', iPort: 5593 },
        { sName: 'Second', sIP: 'sock2.live.example', iPort: 5594 }
      ]
    }).length }], 'the rule sees the real response body the client would have received');
    assert.strictEqual(JSON.parse(out.body).servers[0].sIP, '127.0.0.1');
    assert.strictEqual(JSON.parse(out.body).servers[1].sIP, 'sock2.live.example',
      'only what the rule replaced changed');
  } finally {
    await service.close();
    upstream.server.close();
  }
});

test('body service refuses a URL no rule declared, without contacting anyone', async () => {
  const upstream = await standInUpstream();
  const service = serviceWithLoginRule();
  const started = await service.start();
  try {
    const refused = await rawGet(started.port, '/__aquastar-body?u=' +
      encodeURIComponent('http://127.0.0.1:' + upstream.port + '/secret'));
    assert.strictEqual(refused.status, 403, 'an undeclared URL is refused: ' + refused.body);
    assert.strictEqual(upstream.requests.length, 0, 'nothing was fetched on its behalf');

    assert.strictEqual((await rawGet(started.port, '/__aquastar-body?u=not-a-url')).status, 403);
    assert.strictEqual((await rawGet(started.port, '/__aquastar-body')).status, 403);
    assert.strictEqual((await rawGet(started.port, '/anything-else')).status, 404,
      'the service serves one route only, so it is not a general proxy');
    assert.strictEqual(upstream.requests.length, 0);
  } finally {
    await service.close();
    upstream.server.close();
  }
});

test('body service follows an upstream redirect itself so the client never leaves loopback', async () => {
  const upstream = await standInUpstream();
  const service = bodyService.createBodyService({
    matchesPattern: matchesPattern,
    rules: [{ id: 'steer-login', urls: ['*://127.0.0.1/*'], onResponseBody: function () {} }]
  });
  await service.start();
  try {
    const out = await fetchThrough(service, 'http://127.0.0.1:' + upstream.port + '/redirect');
    assert.strictEqual(out.status, 200, 'the redirect is resolved upstream-side: ' + out.body);
    assert.strictEqual(JSON.parse(out.body).url, '/stayed-here');
    assert.strictEqual(upstream.requests.length, 2, 'one request to the redirect, one to its target');
  } finally {
    await service.close();
    upstream.server.close();
  }
});

test('a rule that throws leaves the original body intact rather than an empty response', async () => {
  const upstream = await standInUpstream();
  const logged = [];
  const service = bodyService.createBodyService({
    matchesPattern: matchesPattern,
    onLog: function (line) { logged.push(line); },
    rules: [{
      id: 'steer-login',
      urls: ['*://127.0.0.1/login/*'],
      onResponseBody: function () { throw new Error('rewrite blew up'); }
    }]
  });
  await service.start();
  try {
    const out = await fetchThrough(service, 'http://127.0.0.1:' + upstream.port + '/login/now');
    assert.strictEqual(out.status, 200);
    assert.strictEqual(JSON.parse(out.body).bSuccess, 1,
      'a rule that throws must not destroy the response: ' + out.body);
    assert.strictEqual(JSON.parse(out.body).servers[0].sIP, 'sock1.live.example');
    assert.ok(logged.some(function (line) { return /rewrite blew up/.test(line); }),
      'the failure is reported: ' + JSON.stringify(logged));
  } finally {
    await service.close();
    upstream.server.close();
  }
});

test('body service refuses to start with a rule that has no URLs, and stops serving when closed', async () => {
  const service = bodyService.createBodyService({
    matchesPattern: matchesPattern, rules: [{ id: 'bad', onResponseBody: function () {} }] });
  const error = await service.start().then(function () { return null; }, function (e) { return e; });
  assert.ok(error && /URL/i.test(error.message), 'a rule without URLs declares nothing: ' + (error && error.message));
  await service.close();

  const upstream = await standInUpstream();
  const live = serviceWithLoginRule();
  const started = await live.start();
  await live.close();
  const after = await rawGet(started.port, '/__aquastar-body?u=' + encodeURIComponent('http://x/')).then(
    function () { return null; }, function (e) { return e; });
  assert.ok(after, 'the port is released on close');
  upstream.server.close();
});
