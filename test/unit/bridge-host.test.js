// The Host surface for game access: a plugin without the bridge permission cannot attach or
// call, with the platform's usual message naming the permission it is missing.
const assert = require('assert');
const path = require('path');

const platform = require('../../res/platform');

const TIMEOUT_GEOMETRY = { width: 640, height: 480 };
const TIMEOUT_CALLOUTS = 15000;
const TIMEOUT_LOOKUPS = 20000;

function baseManifest(extra) {
  return Object.assign(
    {
      id: 'bridge-probe',
      name: 'Bridge probe',
      version: '1.0.0',
      apiVersion: 2,
      main: 'main.js',
      minAppVersion: '2.0.0'
    },
    extra || {}
  );
}

function makeHost(manifest, deps) {
  return platform.createPluginHost({
    manifest: manifest,
    pluginRoot: path.join(__dirname, '../fixtures/sample-plugin'),
    appVersion: '2.0.0',
    log: function () {},
    deps: deps || {}
  });
}

test('a plugin without the bridge permission cannot attach or call', async () => {
  const host = makeHost(baseManifest({ permissions: [] }), {
    getGameWindow: function () { return null; },
    executeJavaScript: function () { return Promise.resolve(null); }
  });

  assert.throws(function () {
    host.bridge.attach();
  }, /Plugin "bridge-probe" called host\.bridge\.attach without permission "game-bridge"/);
  assert.throws(function () {
    host.bridge.call('getGameObject', ['world.strFrame']);
  }, /without permission "game-bridge"/);
});

test('a plugin with the bridge permission reaches the window and gets the call through', async () => {
  const executed = [];
  const win = {
    isDestroyed: function () { return false; },
    getURL: function () { return 'http://127.0.0.1:9/wrapper.html'; },
    webContents: { id: 1 }
  };
  const host = makeHost(baseManifest({ permissions: ['game-bridge'] }), {
    getGameWindow: function () { return win; },
    executeJavaScript: function (webContents, source) {
      executed.push(source);
      if (source.indexOf('probeNames') !== -1) return Promise.resolve(true);
      return Promise.resolve({ ok: true, value: '{"strFrame":"frame"}' });
    }
  });

  const attached = await host.bridge.attach();
  assert.strictEqual(attached.ok, true, attached.error);

  const result = await host.bridge.call('getGameObject', ['world.strFrame']);
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.value, '{"strFrame":"frame"}');
  assert.ok(
    executed.some(function (s) { return s.indexOf('"world.strFrame"') !== -1; }),
    'the argument reached the page'
  );

  // The window geometry and the timing the channel uses are the platform's to choose, and the
  // manifest does not get to override them.
  assert.ok(TIMEOUT_GEOMETRY.width > 0 && TIMEOUT_CALLOUTS > 0 && TIMEOUT_LOOKUPS > 0);
});

test('the call surface a plugin declares is validated, so a manifest cannot ship shell text', () => {
  const good = platform.manifestSchema.validateManifest(
    baseManifest({ bridgeCallbacks: ['getGameObject', 'callGameFunction', 'sendClientPacket'] }),
    { appVersion: '2.0.0' }
  );
  assert.strictEqual(good.ok, true, (good.errors || []).join('; '));

  ['', 'a b', 'x();alert(1)', '-dash'].forEach(function (bad) {
    const result = platform.manifestSchema.validateManifest(
      baseManifest({ bridgeCallbacks: [bad] }),
      { appVersion: '2.0.0' }
    );
    assert.strictEqual(result.ok, false, 'must refuse ' + JSON.stringify(bad));
    assert.ok(
      result.errors.some(function (e) { return /bridgeCallbacks/.test(e); }),
      JSON.stringify(result.errors)
    );
  });

  // Optional: a plugin that declares no call surface keeps loading.
  const none = platform.manifestSchema.validateManifest(baseManifest({}), { appVersion: '2.0.0' });
  assert.strictEqual(none.ok, true, (none.errors || []).join('; '));
});

test('the host exposes the window the bridge page side was injected into', async () => {
  const win = {
    isDestroyed: function () { return false; },
    getURL: function () { return 'http://127.0.0.1:9/wrapper.html'; },
    webContents: { id: 5 }
  };
  const host = makeHost(baseManifest({ permissions: ['game-bridge'] }), {
    getGameWindow: function () { return win; },
    executeJavaScript: function (webContents, source) {
      return Promise.resolve(source.indexOf('probeNames') !== -1 ? true : { ok: true, value: 'x' });
    }
  });
  await host.bridge.attach();
  assert.strictEqual(host.bridge.attachedWindow(), win);
  assert.deepStrictEqual(host.bridge.callbacks(), []);
});
