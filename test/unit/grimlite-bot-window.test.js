// The bot file's own window and IPC (#24): the smallest surface that makes the reader, the
// writer and both dialogs reachable - open a bot, see it, edit it, save it back. The Bot
// Manager (#36) replaces this window; it is not this ticket's job to be that editor.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const platform = require('../../res/platform');
const { createBotFileFeature } = require('../../plugins/grimlite-parity/features/bot-file/bot-file.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const FIXTURES = path.join(__dirname, '../fixtures/grimlite-bots');

// A real host, so the permission gate and the namespaced store are the platform's own.
async function activatedHost() {
  const activated = await platform.activatePlugin({
    manifest: require(path.join(pluginRoot, 'plugin.json')),
    main: path.join(pluginRoot, 'main.js'),
    root: pluginRoot,
    source: 'bundled'
  }, {
    appVersion: JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version,
    appDataDirectory: fs.mkdtempSync(path.join(require('os').tmpdir(), 'aquastar-botwin-')),
    clearRequireCache: true,
    log: function () {},
    deps: {}
  });
  return activated.host;
}

test('the manifest declares the permission the remembered bot directory needs', () => {
  const manifest = require(path.join(pluginRoot, 'plugin.json'));
  assert.ok(manifest.permissions.indexOf('persistent-store') !== -1,
    'the last-used directory is a store, so the manifest must ask for one');
  const result = platform.manifestSchema.validateManifest(manifest, {
    appVersion: JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version
  });
  assert.strictEqual(result.ok, true, (result.errors || []).join('; '));
});

test('opening through the feature returns the document, ready to edit and save back', async () => {
  const host = await activatedHost();
  const opened = [];
  const feature = createBotFileFeature(host, {
    dialogs: {
      open: function () {
        opened.push('open');
        return Promise.resolve({ canceled: false, path: path.join(FIXTURES, 'plain.gbot'),
          bot: require(path.join(pluginRoot, 'bot/bots.js')).parseBot(
            fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8')).bot, error: null });
      },
      save: function (owner, bot) {
        opened.push({ save: bot });
        return Promise.resolve({ canceled: false, path: '/tmp/saved.gbot', error: null });
      }
    }
  });

  const result = await feature.handle('openBot', null, [null]);
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.path, path.join(FIXTURES, 'plain.gbot'));
  assert.ok(result.text.indexOf('"$type": "Grimoire.Botting.Configuration, Grimoire"') !== -1);
  assert.strictEqual(opened[0], 'open');

  // what the window shows is what is on disk, so edits start from the file's own bytes
  assert.strictEqual(result.text, fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8'));
});

test('saving an edited document goes through the dialogs and the writer', async () => {
  const host = await activatedHost();
  let saved = null;
  const feature = createBotFileFeature(host, {
    dialogs: {
      open: function () { return Promise.resolve({ canceled: true }); },
      save: function (owner, bot) {
        saved = bot;
        return Promise.resolve({ canceled: false, path: '/tmp/edited.gbot', error: null });
      }
    }
  });

  const text = fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8').replace('"WalkSpeed": 20', '"WalkSpeed": 44');
  const result = await feature.handle('saveBot', null, [text]);
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.path, '/tmp/edited.gbot');
  assert.strictEqual(result.error, null);
  assert.strictEqual(saved.WalkSpeed, 44);
  assert.strictEqual(saved.$type, 'Grimoire.Botting.Configuration, Grimoire');
});

test('a text the window has that is not a bot is refused with the reader message', async () => {
  const host = await activatedHost();
  let saveCalled = false;
  const feature = createBotFileFeature(host, {
    dialogs: {
      open: function () { return Promise.resolve({ canceled: true }); },
      save: function () { saveCalled = true; return Promise.resolve({ canceled: true }); }
    }
  });

  const result = await feature.handle('saveBot', null, ['this is not json']);
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.error, require(path.join(pluginRoot, 'bot/bots.js')).ERRORS.parse);
  assert.strictEqual(saveCalled, false, 'an unreadable document must not reach the file system');
});

test('cancelling reaches the window as a cancellation, not as an error', async () => {
  const host = await activatedHost();
  const feature = createBotFileFeature(host, {
    dialogs: {
      open: function () { return Promise.resolve({ canceled: true }); },
      save: function () { return Promise.resolve({ canceled: true }); }
    }
  });
  const text = fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8');
  assert.deepStrictEqual(await feature.handle('openBot', null, [null]), { canceled: true });
  assert.deepStrictEqual(await feature.handle('saveBot', null, [text]), { canceled: true });
});

test('the window reaches the feature only through its own namespaced channels', async () => {
  const host = await activatedHost();
  const channels = host._getState().ipcHandlers.map(function (h) { return h.channel; });
  assert.ok(channels.indexOf('plugin:grimlite-parity:openBot') !== -1);
  assert.ok(channels.indexOf('plugin:grimlite-parity:saveBot') !== -1);
  assert.ok(channels.indexOf('plugin:grimlite-parity:getBotFileMessages') !== -1);

  // and the page's preload only requires electron, as a sandboxed preload must
  const preload = fs.readFileSync(
    path.join(pluginRoot, 'features/bot-file/preload_bot_file.js'), 'utf8');
  assert.ok(preload.indexOf("require('electron')") !== -1);
  assert.strictEqual(preload.indexOf("require('../../"), -1, 'no project requires in a sandboxed preload');
});
