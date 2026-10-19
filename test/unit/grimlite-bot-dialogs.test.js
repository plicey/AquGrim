// Open and save for .gbot files (#24). A bot is a user document, so the path always comes from
// a dialog the user answered; the plugin only remembers where they were last. Electron's dialog
// and the store are injected, so this runs without Electron; the store is the platform's real
// namespaced one over a temp directory, which is what makes "the directory persists" a real claim.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createNamespacedStore } = require('../../res/platform/storage/namespaced-store.js');
const bots = require('../../plugins/grimlite-parity/bot/bots.js');
const { createBotDialogs } = require('../../plugins/grimlite-parity/bot/bot-dialogs.js');

const FIXTURES = path.join(__dirname, '../fixtures/grimlite-bots');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-botdialogs-'));
}

function storeIn(appData) {
  return createNamespacedStore({ appDataDirectory: appData, pluginId: 'grimlite-parity' }).getStore('bots');
}

// One temp appData per case: the store and the default directory always belong together.
function makeDialogs(overrides, appData) {
  const dir = appData || tempDir();
  const deps = Object.assign({
    store: storeIn(dir),
    defaultDirectory: path.join(dir, 'Bots'),
    messages: { openTitle: 'Load bot', saveTitle: 'Save bot', filterName: 'Grimlite bots' }
  }, overrides || {});
  return { dialogs: createBotDialogs(deps), appData: dir };
}

test('opening a bot returns the parsed document and remembers the directory it came from', async () => {
  const asked = [];
  const made = makeDialogs({
    showOpenDialog: function (win, options) {
      asked.push(options);
      return Promise.resolve({ canceled: false, filePaths: [path.join(FIXTURES, 'plain.gbot')] });
    }
  });

  const result = await made.dialogs.open(null);
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.path, path.join(FIXTURES, 'plain.gbot'));
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.bot.Commands.length, 3);

  // the reference's own open dialog: title, filter and default extension
  assert.deepStrictEqual(asked, [{
    title: 'Load bot',
    defaultPath: path.join(made.appData, 'Bots'),
    filters: [{ name: 'Grimlite bots', extensions: ['gbot'] }],
    properties: ['openFile']
  }]);
  assert.strictEqual(made.dialogs.lastDirectory(), FIXTURES);

  // a second dialog opens where the first one left the user, in this process and the next
  await made.dialogs.open(null);
  assert.strictEqual(asked[1].defaultPath, FIXTURES);
});

test('the last-used directory survives a restart, and a first run starts at the default', () => {
  const appData = tempDir();
  const first = makeDialogs({}, appData);
  assert.strictEqual(first.dialogs.lastDirectory(), path.join(appData, 'Bots'));

  storeIn(appData).write({ lastDirectory: path.join(appData, 'My Bots') });
  const afterRestart = makeDialogs({}, appData);
  assert.strictEqual(afterRestart.dialogs.lastDirectory(), path.join(appData, 'My Bots'));
});

test('a corrupt remembered directory is ignored rather than opened', () => {
  const appData = tempDir();
  storeIn(appData).write({ lastDirectory: 42 });
  const made = makeDialogs({}, appData);
  assert.strictEqual(made.dialogs.lastDirectory(), path.join(appData, 'Bots'));
});

test('cancelling changes nothing: no bot, no error, no write, no remembered directory', async () => {
  const appData = tempDir();
  const made = makeDialogs({
    showOpenDialog: function () { return Promise.resolve({ canceled: true, filePaths: [] }); },
    showSaveDialog: function () { return Promise.resolve({ canceled: true }); }
  }, appData);

  assert.deepStrictEqual(await made.dialogs.open(null), { canceled: true });
  assert.deepStrictEqual(await made.dialogs.save(null, { $type: bots.CONFIGURATION_TYPE }), { canceled: true });
  assert.strictEqual(made.dialogs.lastDirectory(), path.join(appData, 'Bots'));
  assert.deepStrictEqual(fs.readdirSync(appData).filter(function (f) { return /\.gbot$/.test(f); }), []);
});

test('an unreadable file comes back as the error to show, with the path it came from', async () => {
  const appData = tempDir();
  const dir = path.join(appData, 'somewhere');
  fs.mkdirSync(dir);
  const broken = path.join(dir, 'broken.gbot');
  fs.writeFileSync(broken, '{ "Commands": ');
  const made = makeDialogs({ showOpenDialog: function () {
    return Promise.resolve({ canceled: false, filePaths: [broken] });
  } }, appData);

  const result = await made.dialogs.open(null);
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.path, broken);
  assert.strictEqual(result.bot, null);
  assert.strictEqual(result.error, bots.ERRORS.parse);
  assert.strictEqual(made.dialogs.lastDirectory(), dir, 'a file the user chose is still where they were');

  // valid JSON that is not a bot is the same error, not a silent empty bot
  const notABot = path.join(dir, 'notes.json');
  fs.writeFileSync(notABot, '[1, 2, 3]');
  const other = makeDialogs({ showOpenDialog: function () {
    return Promise.resolve({ canceled: false, filePaths: [notABot] });
  } }, tempDir());
  const wrong = await other.dialogs.open(null);
  assert.strictEqual(wrong.error, bots.ERRORS.parse);
  assert.strictEqual(wrong.bot, null);
});

test('a file that cannot be read at all is reported, not thrown at the caller', async () => {
  const missing = path.join(tempDir(), 'missing.gbot');
  const made = makeDialogs({
    showOpenDialog: function () {
      return Promise.resolve({ canceled: false, filePaths: [missing] });
    }
  }, tempDir());
  const result = await made.dialogs.open(null);
  assert.strictEqual(result.canceled, false);
  assert.ok(result.error && /ENOENT|no such file/i.test(result.error), result.error);
  assert.strictEqual(result.bot, null);
});

test('saving writes through the reference-format writer and remembers where', async () => {
  const appData = tempDir();
  const dir = path.join(appData, 'My Bots');
  const target = path.join(dir, 'my bot.gbot');
  const asked = [];
  const made = makeDialogs({
    showSaveDialog: function (win, options) {
      asked.push(options);
      return Promise.resolve({ canceled: false, filePath: target });
    }
  }, appData);

  const text = fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8');
  const result = await made.dialogs.save(null, bots.parseBot(text).bot);
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.error, null);
  assert.strictEqual(result.path, target);
  assert.strictEqual(fs.readFileSync(target, 'utf8'), text, 'byte-exact for a bot that came from a file');

  assert.strictEqual(asked[0].title, 'Save bot');
  assert.deepStrictEqual(asked[0].filters, [{ name: 'Grimlite bots', extensions: ['gbot'] }]);
  // no path given: the dialog opens in the remembered directory, as the reference's does
  assert.strictEqual(asked[0].defaultPath, path.join(made.appData, 'Bots', 'bot.gbot'));
  assert.strictEqual(made.dialogs.lastDirectory(), dir, 'and the directory the user chose is remembered');
});

test('saving a file that did not exist gives it the extension the reference uses', async () => {
  const dir = tempDir();
  const made = makeDialogs({
    showSaveDialog: function () {
      return Promise.resolve({ canceled: false, filePath: path.join(dir, 'no-extension') });
    }
  }, dir);
  const bot = bots.parseBot(fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8')).bot;
  const result = await made.dialogs.save(null, bot);

  assert.strictEqual(result.path, path.join(dir, 'no-extension.gbot'));
  assert.strictEqual(fs.existsSync(path.join(dir, 'no-extension')), false, 'no extensionless twin');
  assert.strictEqual(bots.parseBot(fs.readFileSync(result.path, 'utf8')).ok, true, 'what it wrote parses');
});

test('an edit to a bot that came from a CRLF file is saved back as CRLF', async () => {
  const appData = tempDir();
  const dir = path.join(appData, 'elsewhere');
  fs.mkdirSync(dir);
  const target = path.join(dir, 'windows.gbot');
  const crlf = fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8').split('\n').join('\r\n');
  fs.writeFileSync(target, crlf);

  const made = makeDialogs({ showSaveDialog: function () {
    return Promise.resolve({ canceled: false, filePath: target });
  } }, appData);
  const bot = bots.parseBot(crlf).bot;
  bot.WalkSpeed = 25;
  await made.dialogs.save(null, bot, { path: target });

  const written = fs.readFileSync(target, 'utf8');
  assert.ok(written.indexOf('"WalkSpeed": 25') !== -1, 'the edit is in the file');
  assert.strictEqual(/[^\r]\n/.test(written), false, 'still CRLF throughout');
  assert.strictEqual(bots.parseBot(written).bot.WalkSpeed, 25);
});

test('an edited bot keeps the path it was opened from when the user saves over it', async () => {
  const appData = tempDir();
  const dir = path.join(appData, 'My Bots');
  fs.mkdirSync(dir);
  const target = path.join(dir, 'edit-me.gbot');
  fs.copyFileSync(path.join(FIXTURES, 'legacy-keys.gbot'), target);

  const made = makeDialogs({
    showOpenDialog: function () { return Promise.resolve({ canceled: false, filePaths: [target] }); },
    showSaveDialog: function () { return Promise.resolve({ canceled: false, filePath: target }); }
  }, appData);
  const opened = await made.dialogs.open(null);
  opened.bot.WalkSpeed = 30;
  const saved = await made.dialogs.save(null, opened.bot, { path: opened.path });

  assert.strictEqual(saved.path, target);
  const written = bots.parseBot(fs.readFileSync(target, 'utf8')).bot;
  assert.strictEqual(written.WalkSpeed, 30);
  assert.strictEqual(written.DropDelay, 250, 'the legacy keys are still there after an edit');
  assert.strictEqual(written.SomethingNobodyKnows.nested.length, 3);
});

test('a save that fails to write is reported, not swallowed', async () => {
  const made = makeDialogs({
    showSaveDialog: function () { return Promise.resolve({ canceled: false, filePath: '/nope/x.gbot' }); },
    writeText: function () { throw new Error('EACCES: permission denied'); }
  }, tempDir());
  const result = await made.dialogs.save(null, { $type: bots.CONFIGURATION_TYPE });
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.path, '/nope/x.gbot');
  assert.ok(/EACCES/.test(result.error), result.error);
});

test('opening a directory instead of a file is refused without touching the store', async () => {
  const appData = tempDir();
  const dir = path.join(appData, 'My Bots');
  fs.mkdirSync(dir);
  const made = makeDialogs({ showOpenDialog: function () {
    return Promise.resolve({ canceled: false, filePaths: [dir] });
  } }, appData);
  const result = await made.dialogs.open(null);
  assert.strictEqual(result.bot, null);
  assert.ok(result.error, 'a directory must not read as an empty bot');
  assert.strictEqual(made.dialogs.lastDirectory(), appData, 'the containing directory is remembered');
});
