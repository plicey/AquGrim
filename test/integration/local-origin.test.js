const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { createPluginHost } = require('../../res/platform/plugin-host.js');
const { createOriginProxy } = require('../../res/platform/origin-proxy.js');
const gameOrigin = require('../../plugins/adventure-quest-worlds/game-origin.js');

const REPO = path.join(__dirname, '../..');

function get(url) {
  return new Promise(function (resolve, reject) {
    http.get(url, function (res) {
      const chunks = [];
      res.on('data', function (c) {
        chunks.push(c);
      });
      res.on('end', function () {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    }).on('error', reject);
  });
}

// The whole chain the platform promises a game plugin, offline: the plugin's own routes are
// declared through a real PluginHost, the platform's origin serves them on loopback, and a
// stand-in upstream sees the game's real paths. No Electron, no live network.
test('a declared game origin serves the game paths the plugin names, from loopback', async function () {
  const upstreamSeen = [];
  const upstream = http.createServer(function (req, res) {
    upstreamSeen.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
    res.end('game bytes');
  });
  await new Promise(function (resolve) {
    upstream.listen(0, '127.0.0.1', resolve);
  });
  const upstreamOrigin = 'http://127.0.0.1:' + upstream.address().port;

  let startedProxy = null;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(REPO, 'plugins/adventure-quest-worlds/plugin.json'), 'utf8')
  );
  const routes = gameOrigin.routes().map(function (route) {
    return { prefix: route.prefix, origin: upstreamOrigin };
  });
  const host = createPluginHost({
    manifest: manifest,
    pluginRoot: path.join(REPO, 'plugins/adventure-quest-worlds'),
    appVersion: '1.2.3',
    appDataDirectory: path.join(REPO, 'test/tmp-plugin-data'),
    deps: {
      startGameOrigin: function (declared) {
        const proxy = createOriginProxy({
          routes: declared.routes,
          files: { '/wrapper.html': path.join(REPO, 'res/swf_wrapper.html') }
        });
        startedProxy = proxy;
        return proxy.listen(0);
      }
    }
  });

  try {
    const baseUrl = await host.declareGameOrigin({ routes: routes });
    assert.strictEqual(baseUrl.indexOf('http://127.0.0.1:'), 0);

    // The loader the plugin points its window at, and the version payload beside it.
    const loader = await get(baseUrl + '/game/gamefiles/Loader4.swf?ver=b');
    assert.strictEqual(loader.status, 200);
    assert.strictEqual(loader.body, 'game bytes');

    // The page that embeds the game comes from the same origin as the game, not file://.
    const wrapper = await get(baseUrl + '/wrapper.html?swf=%2Fgame%2Fgamefiles%2FLoader4.swf');
    assert.strictEqual(wrapper.status, 200);
    assert.ok(
      wrapper.body.indexOf('application/x-shockwave-flash') !== -1,
      'the platform wrapper page is served here'
    );
    assert.ok(upstreamSeen.indexOf('/wrapper.html?swf=%2Fgame%2Fgamefiles%2FLoader4.swf') === -1);

    // Path preserved, query intact, and only the game path was ever fetched upstream.
    assert.deepStrictEqual(upstreamSeen, ['/game/gamefiles/Loader4.swf?ver=b']);
  } finally {
    if (startedProxy) await startedProxy.close();
    await new Promise(function (resolve) {
      upstream.close(resolve);
    });
  }
});
