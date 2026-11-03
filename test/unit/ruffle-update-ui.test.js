const assert = require('assert');
const fs = require('fs');
const path = require('path');

test('Ruffle updater exposes stable and nightly channels without labelling every update as nightly', () => {
  const settings = fs.readFileSync(path.join(__dirname, '../../res/features/settings/settings.html'), 'utf8');
  const updater = fs.readFileSync(path.join(__dirname, '../../res/ruffleUpdate.js'), 'utf8');
  const english = fs.readFileSync(path.join(__dirname, '../../res/po/en-US.js'), 'utf8');

  assert.ok(updater.indexOf("LATEST_URL = 'https://api.github.com/repos/ruffle-rs/ruffle/releases/latest'") !== -1);
  assert.ok(updater.indexOf("channel === 'nightly' ? RELEASES_URL : LATEST_URL") !== -1);
  assert.ok(
    settings.indexOf("buildSelectOptionRow('ruffleUpdateChannel'") <
      settings.indexOf('return [heading, statusRow, updateChannelRow, updateRow, autoUpdateRow')
  );
  assert.ok(/ruffleUpdateLabel\s*:\s*"Update Ruffle"/.test(english));
  assert.ok(
    english.indexOf("Downloads Ruffle's self-hosted web build from its official GitHub nightly release") === -1
  );
});

test('Ruffle migration replaces Flash defaults and preserves later quality choices', () => {
  const vm = require('vm');
  const source = fs.readFileSync(path.join(__dirname, '../../res/keybindings.js'), 'utf8');
  const migration = source.slice(source.indexOf('function _migrateRuffleDefaults('), source.indexOf('function toggleRecording('));
  function migrate(saved) {
    let disk = saved === null ? null : JSON.stringify(saved);
    const context = {
      finalKeybinds: Object.assign({}, saved),
      constant: { defaultRenderMode: 'native' },
      _keybindSaveTarget: () => 'settings',
      fs: { existsSync: () => disk !== null, readFileSync: () => disk, writeFileSync: (_, data) => { disk = data; } },
      console
    };
    vm.runInNewContext(migration, context);
    context._migrateRuffleDefaults(saved || {});
    return JSON.parse(disk);
  }
  const first = migrate({ renderMode: 'flash', gameQuality: 'high', customUrl: 'saved' });
  assert.strictEqual(first.renderMode, 'ruffle');
  assert.strictEqual(first.gameQuality, 'low');
  assert.strictEqual(first.customUrl, 'saved');
  first.gameQuality = 'high';
  assert.strictEqual(migrate(first).gameQuality, 'high');
  assert.strictEqual(migrate(null).renderMode, 'ruffle');
});

test('pinned engine wins over downloaded stock Ruffle and refuses replacement', async () => {
  const os = require('os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aqugrim-engine-'));
  const updater = require('../../res/ruffleUpdate.js');
  try {
    const bundle = path.join(root, 'bundle');
    fs.mkdirSync(bundle);
    fs.writeFileSync(path.join(bundle, 'engine.json'), JSON.stringify({ name: 'Mugetsu Web', version: '1.6.0' }));
    fs.mkdirSync(path.join(root, 'ruffle-current'));
    fs.writeFileSync(path.join(root, 'ruffle-current', 'ruffle.js'), 'old stock build');
    const player = path.join(bundle, 'ruffle.js');
    const status = updater.getStatus(root, player);
    assert.strictEqual(status.pinned, true);
    assert.strictEqual(status.loaded.source, 'bundled');
    assert.strictEqual(status.loaded.version, 'Mugetsu Web 1.6.0');
    await assert.rejects(updater.downloadLatest(root, 'latest', player), /Update AquGrim/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
