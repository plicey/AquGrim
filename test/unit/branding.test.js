const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

test('visible app branding and stored data paths are AquGrim', () => {
  const pkg = require(path.join(ROOT, 'package.json'));
  const constant = fs.readFileSync(path.join(ROOT, 'res/const.js'), 'utf8');
  const menu = fs.readFileSync(path.join(ROOT, 'res/windows/menu.js'), 'utf8');
  const config = fs.readFileSync(path.join(ROOT, 'res/windows/config.js'), 'utf8');
  assert.ok(/const appDisplayName = "AquGrim"/.test(constant));
  assert.ok(/const appName\s+= "AquGrim"/.test(constant), 'stored data paths use the app name');
  assert.strictEqual(pkg.name, 'aquagrim');
  assert.strictEqual(pkg.productName, 'AquGrim');
  assert.ok(menu.indexOf('constant.appDisplayName || \'AquGrim\'') !== -1);
  assert.ok(config.indexOf("title: 'AquGrim - Settings'") !== -1);
});

test('the Grimlite-derived plugin displays as AquGrim without changing its id or paths', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'plugins/grimlite-parity/plugin.json'), 'utf8'));
  const words = require(path.join(ROOT, 'plugins/grimlite-parity/locales/en-US.js'));
  assert.strictEqual(manifest.id, 'grimlite-parity');
  assert.strictEqual(manifest.name, 'AquGrim');
  assert.strictEqual(manifest.author, 'AquGrim');
  assert.strictEqual(words.windowTitles.primary, 'AquGrim');
  assert.strictEqual(words.menuMessages.grimliteMenu, 'Client');
  assert.ok(words.dialogMessages.helpDetailExtra({}).indexOf('AquGrim') === 0);
});

test('provided game windows use AquGrim titles', () => {
  const aqw = require(path.join(ROOT, 'plugins/adventure-quest-worlds/locales/en-US.js'));
  assert.ok(String(aqw.remindersMessages.title).indexOf('AquGrim') === 0);
  assert.ok(String(aqw.todoMessages.title).indexOf('AquGrim') === 0);
  assert.ok(String(aqw.strategyMessages.title).indexOf('AquGrim') === 0);
  assert.ok(String(aqw.inventoryMessages.title).indexOf('AquGrim') === 0);
});

function settingsPaths(root) {
  const source = fs.readFileSync(path.join(ROOT, 'res/const.js'), 'utf8');
  const start = source.indexOf('var keybingJsonFileName');
  const end = source.indexOf('// The bundled web/WASM player', start);
  const context = {
    fs, path, exports: {}, console, appName: 'AquGrim',
    app: { getPath: () => root }, appDataDirectory: path.join(root, 'AquGrim'),
    appCurrentDirectory: path.join(root, 'portable')
  };
  require('vm').runInNewContext(source.slice(start, end), context);
  return context.exports;
}

test('runtime settings read the filename produced by the AquaStar migration', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aquagrim-settings-'));
  try {
    fs.mkdirSync(path.join(root, 'AquaStar'));
    fs.writeFileSync(path.join(root, 'AquaStar', 'aquastar.json'), JSON.stringify({ packetSteering: true }));
    require('../../res/instance-session').migrateLegacyData(root);
    const paths = settingsPaths(root);
    assert.strictEqual(paths.appdataJsonPath, path.join(root, 'AquGrim', 'aquagrim.json'));
    assert.ok(paths.listValidKeybindLocations.includes(paths.appdataJsonPath));
    assert.strictEqual(JSON.parse(fs.readFileSync(paths.appdataJsonPath)).packetSteering, true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('settings saved under the misspelled filename remain readable after the fix', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aquagrim-settings-'));
  try {
    fs.mkdirSync(path.join(root, 'AquGrim'));
    const old = path.join(root, 'AquGrim', 'aqugrim.json');
    const contents = JSON.stringify({ packetSteering: true, gameQuality: 'low' });
    fs.writeFileSync(old, contents);
    const paths = settingsPaths(root);
    assert.strictEqual(paths.appdataJsonPath, path.join(root, 'AquGrim', 'aquagrim.json'));
    assert.strictEqual(fs.readFileSync(paths.appdataJsonPath, 'utf8'), contents);
    assert.strictEqual(fs.readFileSync(old, 'utf8'), contents);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
