// The three game-access permissions the parity plugin declares (spec #19). This ticket is
// the scaffold: the names exist, a manifest may declare them, and the platform says clearly
// which one a caller is missing.
const assert = require('assert');
const path = require('path');

const platform = require('../../res/platform');

const GAME_ACCESS = ['game-bridge', 'packet-tap', 'packet-send'];

function baseManifest(extra) {
  return Object.assign(
    {
      id: 'game-access-probe',
      name: 'Game access probe',
      version: '1.0.0',
      apiVersion: 2,
      main: 'main.js',
      minAppVersion: '2.0.0'
    },
    extra || {}
  );
}

function makeHost(manifest) {
  return platform.createPluginHost({
    manifest: manifest,
    pluginRoot: path.join(__dirname, '../fixtures/sample-plugin'),
    appVersion: '2.0.0',
    log: function () {}
  });
}

test('a manifest may declare the game access permissions, and the Host names the missing one', () => {
  const declared = platform.manifestSchema.validateManifest(baseManifest({ permissions: GAME_ACCESS }));
  assert.strictEqual(declared.ok, true, (declared.errors || []).join('; '));

  // An unknown permission is still a load failure, so the vocabulary stays closed.
  const typo = platform.manifestSchema.validateManifest(baseManifest({ permissions: ['packet-tapp'] }));
  assert.strictEqual(typo.ok, false);
  assert.ok(
    typo.errors.some(function (e) {
      return /Unknown permission: packet-tapp/.test(e);
    })
  );

  const host = makeHost(baseManifest({ permissions: [] }));
  GAME_ACCESS.forEach(function (permission) {
    assert.throws(function () {
      host.requirePermission('host.packets.listen', permission);
    }, /Plugin "game-access-probe" called host\.packets\.listen without permission "/);
  });

  const granted = makeHost(baseManifest({ permissions: ['packet-tap'] }));
  assert.strictEqual(granted.requirePermission('host.packets.listen', 'packet-tap'), undefined);
  assert.throws(function () {
    granted.requirePermission('host.packets.send', 'packet-send');
  }, /without permission "packet-send"/);
});
