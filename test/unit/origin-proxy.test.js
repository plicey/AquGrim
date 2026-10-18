const assert = require('assert');
const http = require('http');

const { createOriginProxy } = require('../../res/platform/origin-proxy.js');

// A stand-in upstream: a real loopback HTTP server, so the origin's forwarding is exercised
// over a real socket instead of a stub. Nothing here touches the network.
function startUpstream(handler) {
  return new Promise(function (resolve) {
    const seen = [];
    const server = http.createServer(function (req, res) {
      const chunks = [];
      req.on('data', function (c) {
        chunks.push(c);
      });
      req.on('end', function () {
        const entry = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks)
        };
        seen.push(entry);
        handler(entry, res);
      });
    });
    server.listen(0, '127.0.0.1', function () {
      resolve({
        origin: 'http://127.0.0.1:' + server.address().port,
        seen: seen,
        close: function () {
          return new Promise(function (done) {
            server.close(done);
          });
        }
      });
    });
  });
}

function request(url, opts) {
  return new Promise(function (resolve, reject) {
    const req = http.request(url, opts || {}, function (res) {
      const chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8')
        });
      });
    });
    req.on('error', reject);
    if (opts && opts.body) req.write(opts.body);
    req.end();
  });
}

function plain(body) {
  return function (entry, res) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(body + entry.url);
  };
}

test('local prefixes map to their upstream origin, path preserved onto loopback', async function () {
  const game = await startUpstream(plain('game:'));
  const assets = await startUpstream(plain('assets:'));
  const proxy = createOriginProxy({
    routes: [
      { prefix: '/proxy/content/', origin: assets.origin },
      { prefix: '/', origin: game.origin }
    ]
  });
  const origin = await proxy.listen(0);
  try {
    assert.strictEqual(origin, 'http://127.0.0.1:' + proxy.port);

    const loader = await request(origin + '/game/gamefiles/Loader4.swf?ver=b', {
      headers: { 'x-probe': 'kept' }
    });
    assert.strictEqual(loader.status, 200);
    assert.strictEqual(game.seen[0].url, '/game/gamefiles/Loader4.swf?ver=b');
    assert.strictEqual(loader.body, 'game:/game/gamefiles/Loader4.swf?ver=b');

    // A mount prefix maps onto the other origin's root, keeping the rest of the path.
    const asset = await request(origin + '/proxy/content/ui/hero.png');
    assert.strictEqual(assets.seen[0].url, '/ui/hero.png');
    assert.strictEqual(asset.body, 'assets:/ui/hero.png');

    // The upstream answers by Host, and the client's own headers reach it.
    assert.strictEqual(game.seen[0].headers.host, game.origin.replace('http://', ''));
    assert.strictEqual(game.seen[0].headers['x-probe'], 'kept');
  } finally {
    await proxy.close();
    await game.close();
    await assets.close();
  }
});
test('a POST body reaches the upstream unchanged, and upstream 3xx is followed here', async function () {
  // Expected values come from the reference local origin's field evidence: the client POSTs
  // its credentials to the game's login path (a GET-only origin left it hanging), and upstream
  // answers some game paths with a 3xx that must not walk the client off loopback.
  const upstream = await startUpstream(function (entry, res) {
    if (entry.url.indexOf('/game/old/') === 0) {
      res.writeHead(302, { Location: '/game/new/target.swf' });
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('body:' + entry.body.toString('utf8'));
  });
  const proxy = createOriginProxy({ routes: [{ prefix: '/', origin: upstream.origin }] });
  const origin = await proxy.listen(0);
  try {
    const posted = await request(origin + '/game/api/login/now?ran=0.5', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":"hero","password":"secret"}'
    });
    const login = upstream.seen.filter(function (e) {
      return e.url.indexOf('/game/api/login/now') === 0;
    })[0];
    assert.strictEqual(login.method, 'POST');
    assert.strictEqual(login.body.toString('utf8'), '{"username":"hero","password":"secret"}');
    assert.strictEqual(login.headers['content-type'], 'application/json');
    assert.strictEqual(login.headers['content-length'], '39');
    assert.strictEqual(posted.body, 'body:{"username":"hero","password":"secret"}');

    const redirected = await request(origin + '/game/old/Loader4.swf');
    assert.strictEqual(redirected.status, 200, 'the client never sees the 3xx');
    assert.strictEqual(redirected.body, 'body:');
    const hops = upstream.seen.map(function (e) {
      return e.url;
    });
    assert.deepStrictEqual(hops, [
      '/game/api/login/now?ran=0.5',
      '/game/old/Loader4.swf',
      '/game/new/target.swf'
    ]);
  } finally {
    await proxy.close();
    await upstream.close();
  }
});
test('an upstream outage surfaces instead of hanging, and a redirect loop never leaves loopback', async function () {
  // The version payload upstream is flaky: it answers 200, 302 and 404 minutes apart, and a
  // missing answer must not wedge the client. A 3xx the origin itself will not follow must not
  // be handed to the client either, or the client follows it off loopback.
  const upstream = await startUpstream(function (entry, res) {
    res.writeHead(301, { Location: entry.url });   // redirects to itself, forever
    res.end();
  });
  const proxy = createOriginProxy({ routes: [{ prefix: '/', origin: upstream.origin }] });
  const origin = await proxy.listen(0);
  let deadOrigin;
  let deadProxy;
  try {
    const looped = await request(origin + '/game/api/data/gameversion?ver=0.95');
    assert.ok(looped.status >= 300, 'the loop is not followed: ' + looped.status);
    assert.strictEqual(looped.headers.location, undefined, 'the client is never handed an upstream Location');
    assert.ok(upstream.seen.length <= 6, 'the loop is capped: ' + upstream.seen.length + ' hops');

    // Nothing is listening on this port: the origin must answer, not leave the request open.
    const dead = await startUpstream(plain('unused'));
    deadOrigin = dead.origin;
    await dead.close();
    deadProxy = createOriginProxy({ routes: [{ prefix: '/', origin: deadOrigin }] });
    const deadUrl = await deadProxy.listen(0);
    const failed = await request(deadUrl + '/game/api/data/gameversion');
    assert.strictEqual(failed.status, 502);
    assert.ok(failed.body.indexOf('upstream') !== -1, failed.body);
  } finally {
    await proxy.close();
    if (deadProxy) await deadProxy.close();
    await upstream.close();
  }
});
