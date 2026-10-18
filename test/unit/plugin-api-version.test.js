// apiVersion 2: the additive platform capabilities a newer plugin declares, and the clean
// refusal an app that does not support them gives such a plugin.
const assert = require('assert');

const platform = require('../../res/platform');
const schema = platform.manifestSchema;

function manifest(extra) {
  return Object.assign(
    {
      id: 'versioned-plugin',
      name: 'Versioned',
      version: '1.0.0',
      apiVersion: 1,
      main: 'main.js',
      minAppVersion: '2.0.0'
    },
    extra || {}
  );
}

test('manifest schema accepts apiVersion 1 and 2, and names a version it cannot run', () => {
  assert.strictEqual(schema.validateManifest(manifest({ apiVersion: 2 })).ok, true);
  assert.strictEqual(schema.validateManifest(manifest({ apiVersion: 1 })).ok, true);

  const future = schema.validateManifest(manifest({ apiVersion: 3 }));
  assert.strictEqual(future.ok, false);
  assert.deepStrictEqual(future.errors, ['apiVersion 3 is not supported (this app supports 1 and 2)']);

  const missing = schema.validateManifest(manifest({ apiVersion: undefined }));
  assert.strictEqual(missing.ok, false);
  assert.deepStrictEqual(missing.errors, ['apiVersion is required']);
});

test('the legacy unprefixed IPC names stay exactly what apiVersion 1 sees', () => {
  const { createPluginHost } = require('../../res/platform/plugin-host.js');
  const path = require('path');

  function channelsFor(apiVersion) {
    const recorded = [];
    const host = createPluginHost({
      manifest: manifest({ apiVersion: apiVersion, unprefixedIpc: true }),
      pluginRoot: path.join(__dirname, '../fixtures/sample-plugin'),
      legacyIpc: true,
      deps: {
        ipcHandle: function (channel) {
          recorded.push(channel);
        }
      }
    });
    host.ipc.handle('getReminders', function () {
      return {};
    });
    return recorded[0];
  }

  assert.strictEqual(channelsFor(1), 'getReminders');
  // apiVersion 2 is a newer generation: the back-compat channel names are not part of it.
  assert.strictEqual(channelsFor(2), 'plugin:versioned-plugin:getReminders');
});
