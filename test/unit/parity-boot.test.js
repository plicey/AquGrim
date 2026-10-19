// The parity plugin must boot the real game from its own loopback origin, with the bridge SWF
// served from that same origin - same-origin is what makes the bridge legal at all (#7/#8).
// A real origin proxy and a stand-in upstream, so the chain is exercised over sockets.
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');

const { createPluginHost } = require('../../res/platform/plugin-host.js');
const { createOriginProxy } = require('../../res/platform/origin-proxy.js');

const REPO = path.join(__dirname, '../..');
const PARITY = path.join(REPO, 'plugins/grimlite-parity');

function get(url) {
  return new Promise(function (resolve, reject) {
    http.get(url, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    }).on('error', reject);
  });
}

test('the parity plugin boots the game from its own origin, with the bridge served there too', async function () {
  const upstreamSeen = [];
  const upstream = http.createServer(function (req, res) {
    upstreamSeen.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/x-shockwave-flash' });
    res.end('CWS');
  });
  await new Promise(function (resolve) { upstream.listen(0, '127.0.0.1', resolve); });
  const upstreamOrigin = 'http://127.0.0.1:' + upstream.address().port;

  const manifest = JSON.parse(fs.readFileSync(path.join(PARITY, 'plugin.json'), 'utf8'));
  let proxy = null;
  const host = createPluginHost({
    manifest: manifest,
    pluginRoot: PARITY,
    appVersion: '2.0.0',
    appDataDirectory: path.join(REPO, 'test/tmp-plugin-data'),
    log: function () {},
    deps: {
      startGameOrigin: function (declared) {
        proxy = createOriginProxy({
          routes: declared.routes,
          files: declared.files,
          log: function () {}
        });
        return proxy.listen(0);
      },
      getGameWindow: function () { return null; },
      executeJavaScript: function () { return Promise.resolve(null); }
    }
  });

  const bridgeModule = require(path.join(PARITY, 'game-origin.js'));
  const routes = bridgeModule.routes().map(function (route) {
    return { prefix: route.prefix, origin: upstreamOrigin };
  });
  const files = bridgeModule.files();
  assert.ok(files && Object.keys(files).length, 'the plugin must serve the bridge SWF itself');
  Object.keys(files).forEach(function (localPath) {
    assert.ok(fs.existsSync(files[localPath]), 'missing file for ' + localPath);
  });

  let baseUrl = '';
  try {
    baseUrl = await host.declareGameOrigin({ routes: routes, files: files });
    assert.strictEqual(baseUrl.indexOf('http://127.0.0.1:'), 0, baseUrl);

    // The bridge SWF is served from the same origin as Loader4 and the game's own paths: that is
    // the property the whole bridge rests on.
    const bridgePath = Object.keys(files)[0];
    const bridge = await get(baseUrl + bridgePath);
    assert.strictEqual(bridge.status, 200, 'the bridge SWF must be served from the origin');
    assert.ok(bridge.body.length > 500, 'a real movie, not a placeholder');
    assert.ok(
      /^CWS|^FWS|^ZWS/.test(bridge.body.toString('latin1').slice(0, 3)),
      'served bytes must be a SWF'
    );
    assert.strictEqual(
      bridge.headers['content-type'],
      'application/x-shockwave-flash',
      'Flash is served its own content type, not the page one'
    );

    // Loader4 comes from the same origin, proxied upstream alongside the bridge.
    const loader = await get(baseUrl + '/game/gamefiles/Loader4.swf?ver=b');
    assert.strictEqual(loader.status, 200);
    assert.ok(upstreamSeen.indexOf('/game/gamefiles/Loader4.swf?ver=b') !== -1);
    assert.ok(baseUrl.indexOf('127.0.0.1') !== -1);
  } finally {
    if (proxy) await proxy.close();
    // The stand-in upstream is the test's own server: leaving it listening keeps the whole
    // suite's process alive after the last test, so it closes here.
    await new Promise(function (resolve) { upstream.close(resolve); });
  }
});

test('the bridge starts Artix Loader4 so it can initialize the current game', function () {
  const source = fs.readFileSync(path.join(PARITY, 'bridge/AquaBridge.as'), 'utf8');

  // Loader4 performs startup and resolves the current game file itself. Loading Game*.swf
  // directly leaves it on its first frame without the login screen.
  assert.ok(/gamefiles\/Loader4\.swf\?ver=b/.test(source), 'the bridge must start Loader4');
  assert.ok(!/api\/data\/gameversion/.test(source), 'the bridge must not bypass Loader4 startup');
  assert.ok(!/Game\d+r\d+\.swf/.test(source), 'the current game file stays runtime-selected');

  // The base comes from where the movie itself was served, because the platform's wrapper passes
  // `base` as an <object> param and not as a flashvar: a bridge that read it from
  // loaderInfo.parameters would never find the game.
  assert.ok(
    /loaderInfo\.url/.test(source),
    'the bridge must derive its base from its own URL, not from a parameter'
  );
  assert.ok(
    !/parameters\s*&&\s*params\.base|params\.base/.test(source),
    'the wrapper does not deliver base as a flashvar'
  );

  // Sharing the domain explicitly is the load-bearing half of the mechanism.
  assert.ok(
    /new LoaderContext\(\s*false\s*,\s*ApplicationDomain\.currentDomain\s*\)/.test(source),
    'Loader4 must share the bridge\'s ApplicationDomain'
  );
  assert.ok(/addChild\(gameLoader\)[\s\S]*?gameLoader\.load/.test(source),
    'Loader4 must be on stage when it starts');
  assert.ok(/new Timer\(1000\)/.test(source) && /TimerEvent\.TIMER/.test(source) &&
    !/TIMER_COMPLETE|onGameRootTimeout/.test(source),
    'the bridge must keep waiting for Game until the user signs in');
  assert.ok(/loader\['Game'\]/.test(source), 'the bridge must attach to Loader4\'s Game root');

  // One event channel back to the plugin, and the reference loader's call names.
  ['getGameObject', 'getGameObjectS', 'setGameObject', 'callGameFunction',
    'callGameFunction0', 'isNull', 'sendClientPacket'].forEach(function (name) {
    assert.ok(source.indexOf('\'' + name + '\'') !== -1, 'the bridge must register ' + name);
  });
});

test('the bridge movie performs the six live-object calls in its own domain', function () {
  // Ticket #49. Each of these hands the game a live AS3 object, which cannot cross
  // ExternalInterface - so the movie has to resolve it and make the call itself, in the domain the
  // game's classes were loaded into. The source is checked here, and the built asset below is
  // checked for the same names, so neither half can land without the other.
  const source = fs.readFileSync(path.join(PARITY, 'bridge/AquaBridge.as'), 'utf8');

  ['AttackMonster', 'AttackMonsterByMonMapId', 'UseSkill', 'ForceUseSkill', 'CancelTargetSelf',
    'SetTargetPvP'].forEach(function (name) {
    assert.ok(source.indexOf("addCallback('" + name + "'") !== -1,
      'the bridge must register the callback ' + name);
  });

  // The object plumbing is the movie's own: it resolves through the game's accessors and calls the
  // game's own sinks, which is what makes the object the game's rather than a copy.
  assert.ok(/getMonstersByCell/.test(source),
    'the monster is resolved through the game own accessor, not by walking members by hand');
  assert.ok(/\.setTarget\(/.test(source) && /\.approachTarget\(\)/.test(source),
    'setTarget then approachTarget are the two calls the loader makes, in that order');
  // The order is the loader's own (Player.as 242): target first, then walk to it. Reversed, the
  // avatar walks toward whatever was targeted before.
  const body = source.slice(source.indexOf('aqAttackMonster('), source.indexOf('aqAttackMonsterByMonMapId('));
  assert.ok(body.indexOf('.setTarget(') !== -1 && body.indexOf('.approachTarget()') !== -1 &&
    body.indexOf('.setTarget(') < body.indexOf('.approachTarget()'),
    'AttackMonster must set the target before it approaches');
  assert.ok(/\.testAction\(/.test(source) && /actions\.active\[/.test(source),
    'the skill is the live entry of world.actions.active, handed to world.testAction');

  // The caroling early return (World.as 8374) and the bUntargetSelf preference (8381) live inside
  // world.setTarget, not in the loader - so calling setTarget is what reproduces them, and writing
  // the target member directly is what would lose them.
  assert.ok(/addCallback\('AttackMonster', aqAttackMonster\)/.test(source),
    'the attack goes through a named callback, which is where the plumbing lives');

  // The loader's own guards, which only exist on the game's side of this call: setTarget's
  // caroling-map early return and the user's bUntargetSelf preference are World.as 8374 and 8381,
  // reached by calling setTarget rather than by assigning myAvatar.target directly.
  assert.ok(!/myAvatar\.target\s*=\s*monster/.test(source),
    'the target is set through world.setTarget, which is where the game keeps its own guards');
});

test('the built bridge asset carries the call surface the manifest declares', function () {
  const asset = path.join(PARITY, 'assets/aqua-bridge.swf');
  assert.ok(fs.existsSync(asset), 'the bridge SWF must ship with the plugin');

  const zlib = require('zlib');
  const raw = fs.readFileSync(asset);
  const body = raw.slice(0, 3).toString('latin1') === 'CWS' ? zlib.inflateSync(raw.slice(8)) : raw.slice(8);
  const text = body.toString('latin1');

  const manifest = JSON.parse(fs.readFileSync(path.join(PARITY, 'plugin.json'), 'utf8'));
  assert.ok(
    Array.isArray(manifest.bridgeCallbacks) && manifest.bridgeCallbacks.length,
    'the manifest must declare the call surface the platform gates'
  );
  manifest.bridgeCallbacks.forEach(function (name) {
    assert.ok(text.indexOf(name) !== -1, 'built bridge does not register ' + name);
  });
  assert.ok(text.indexOf('Loader4.swf?ver=b') !== -1 && text.indexOf('game root available') !== -1,
    'the built bridge must start Loader4 and wait for its initialized Game root');
});
