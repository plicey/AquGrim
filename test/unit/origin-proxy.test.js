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
