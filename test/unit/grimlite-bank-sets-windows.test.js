// The Bank and Sets windows as the app hands them out (ticket #29): registered feature windows
// in the plugin's own conventions (sandboxed, no Flash, dark local pages), a menu entry each,
// and main-process channels that reach the logic and the dialogs. Everything that needs live
// game state is reported as unwired here rather than faked; the manual side is on
// docs/FLASH_CHECKLIST.md.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const url = require('url');

const platform = require('../../res/platform');
const { createBankWindow } = require('../../plugins/grimlite-parity/features/bank/bank-window.js');
const { createSetsWindow } = require('../../plugins/grimlite-parity/features/sets/sets-window.js');
const bridge = require('../../plugins/grimlite-parity/bridge.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

const WINDOW_IDS = ['grimlite-parity-bank', 'grimlite-parity-sets'];

function activateParity(deps) {
  return platform.activatePlugin({
    source: 'bundled',
    root: pluginRoot,
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  }, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: deps || {}
  });
}

test('the two windows are registered in the app\'s window conventions', async () => {
  const activated = await activateParity();
  const windows = activated.host._getState().featureWindows;

  WINDOW_IDS.forEach(function (id) {
    const found = windows.filter(function (w) { return w.id === id; });
    assert.strictEqual(found.length, 1, 'missing feature window ' + id);
    const config = found[0].config;
    assert.strictEqual(config.webPreferences.sandbox, true, id + ' must be sandboxed');
    assert.strictEqual(config.webPreferences.plugins, false, id + ' must not load Flash');
    assert.strictEqual(config.webPreferences.contextIsolation, true, id + ' must isolate contexts');
    assert.strictEqual(config.webPreferences.nodeIntegration, false, id + ' must not expose Node');
    assert.strictEqual(config.useContentSize, true, id + ' sizes its content');
    assert.ok(/^file:\/\//.test(found[0].url), id + ' must be a local page');
    const page = url.fileURLToPath(found[0].url);
    assert.ok(page.indexOf(pluginRoot) === 0, id + ' page must live in the plugin');
    assert.ok(fs.existsSync(page), 'missing page file: ' + page);
    const preload = url.fileURLToPath('file://' + found[0].config.webPreferences.preload);
    assert.ok(fs.existsSync(preload), 'missing preload: ' + preload);
    // A sandboxed preload may only require electron.
    const source = fs.readFileSync(preload, 'utf8');
    assert.ok(source.indexOf("require('electron')") !== -1, id + ' preload needs electron');
    assert.strictEqual(source.indexOf("require('../"), -1, id + ' preload must stay self-contained');
  });
});

test('the Grimlite menu gains Bank and Sets, each opening its own window', async () => {
  const opened = [];
  const activated = await activateParity({
    openFeatureWindow: function (id) {
      opened.push(id);
      return {};
    }
  });

  const state = activated.host._getState();
  const items = state.menus[0]({ labels: { grimliteMenu: 'Grimlite' }, keybinds: {} });
  const submenu = items[0].submenu;
  const labels = submenu.map(function (item) { return item.label; });
  // The reference's own Tools menu words: Bank, and the Sets form it keeps hidden.
  assert.ok(labels.indexOf('Bank') !== -1, 'no Bank entry: ' + labels.join(', '));
  assert.ok(labels.indexOf('Sets') !== -1, 'no Sets entry: ' + labels.join(', '));

  submenu.filter(function (item) { return item.label === 'Bank'; })[0].click();
  submenu.filter(function (item) { return item.label === 'Sets'; })[0].click();
  assert.deepStrictEqual(opened, WINDOW_IDS);
});

test('the reference\'s Show Bank hotkey action is bindable, and defaults to a key of its own', async () => {
  const fired = [];
  const activated = await activateParity({
    openFeatureWindow: function (id) {
      fired.push(id);
      return {};
    }
  });
  const state = activated.host._getState();

  const bank = state.keybinds.filter(function (binding) {
    return binding.id === 'grimliteBank';
  });
  assert.strictEqual(bank.length, 1, "the reference's Show Bank action must be bindable");
  assert.strictEqual(typeof state.keybindDefaults.grimliteBank, 'string');
  bank[0].action();
  assert.deepStrictEqual(fired, ['grimlite-parity-bank']);

  // The reference does not provide a Sets hotkey (the form is hidden upstream), so none here.
  assert.strictEqual(state.keybindDefaults.grimliteSets, undefined);
});

test('the Bank window reaches its logic through the window\'s own channels', async () => {
  const calls = [];
  const game = {
    readInventory: function () {
      calls.push('readInventory');
      return Promise.resolve([
        { id: 1, name: 'Sword of Awe', category: 'Sword', isAcItem: false, isEquipped: false }
      ]);
    },
    readBankSlots: function () { return Promise.resolve({ total: 10, used: 0 }); },
    transferToBank: function (name) {
      calls.push('transfer:' + name);
      return Promise.resolve();
    },
    sleep: function () { return Promise.resolve(); }
  };
  const window = createBankWindow({ game: game });

  assert.deepStrictEqual(await window.handle('bankCategories'), {
    categories: require(path.join(pluginRoot, 'features/bank/bank.js')).CATEGORIES,
    acChoices: require(path.join(pluginRoot, 'features/bank/bank.js')).AC_CHOICES
  });

  const result = await window.handle('bankCategory', null, [
    { category: 'Sword', ac: false, allExcept: false }
  ]);
  assert.deepStrictEqual(result, { transferred: 1, total: 1, error: null });
  assert.deepStrictEqual(calls, ['readInventory', 'transfer:Sword of Awe']);
});

test('a Bank window with no game access reports that, instead of pretending to transfer', async () => {
  // The scaffold's own game access: every call is unwired until ticket #28 lands.
  const game = bridge.createGameAccess({ log: function () {} });
  const window = createBankWindow({ game: game });

  const result = await window.handle('bankCategory', null, [
    { category: 'Sword', ac: false, allExcept: false }
  ]);
  assert.strictEqual(result.transferred, 0);
  assert.strictEqual(result.error, bridge.NOT_WIRED);
});

test('the Sets window lists, adds, saves, opens, clears and equips through its channels', async () => {
  const appData = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aquastar-setswin-'));
  const setsDir = path.join(appData, 'Sets');
  fs.mkdirSync(setsDir, { recursive: true });
  fs.copyFileSync(
    path.join(__dirname, '../fixtures/grimlite-sets/reference-set.gset'),
    path.join(setsDir, 'mine.gset')
  );

  const equipped = [];
  const game = {
    readInventory: function () {
      return Promise.resolve([
        { id: 1, name: 'Blinding Light of Destiny', category: 'Sword', isAcItem: false, isEquipped: false },
        { id: 2, name: 'ArchPaladin', category: 'Class', isAcItem: false, isEquipped: true },
        { id: 3, name: "Sepulchure's Armor", category: 'Armor', isAcItem: false, isEquipped: false }
      ]);
    },
    equipItem: function (name) {
      equipped.push(name);
      return Promise.resolve();
    }
  };
  const saved = [];
  const window = createSetsWindow({
    game: game,
    dialogs: {
      list: function () { return Promise.resolve([{ name: 'mine.gset', path: 'mine.gset' }]); },
      open: function () { return Promise.resolve({ canceled: true }); },
      openByPath: function (relative) {
        const file = path.join(setsDir, relative);
        return Promise.resolve({
          canceled: false, path: file,
          entries: require(path.join(pluginRoot, 'features/sets/sets.js'))
            .parseSet(fs.readFileSync(file, 'utf8')).entries,
          error: null
        });
      },
      save: function (entries) {
        saved.push(entries);
        return Promise.resolve({ canceled: false, path: path.join(setsDir, 'set.gset'), error: null });
      }
    }
  });

  assert.deepStrictEqual(await window.handle('listSets'), {
    sets: [{ name: 'mine.gset', path: 'mine.gset' }]
  });

  const added = await window.handle('setInventoryRows');
  assert.strictEqual(added.rows.filter(function (row) { return row.entry !== null; }).length, 3);

  const opened = await window.handle('openSet', null, ['mine.gset']);
  assert.strictEqual(opened.error, null);
  assert.deepStrictEqual(opened.entries.map(function (e) { return e.name; }), [
    'Blinding Light of Destiny', 'ArchPaladin', "Sepulchure's Armor"
  ]);

  const results = await window.handle('equipSet', null, [opened.entries]);
  assert.deepStrictEqual(equipped, ['Blinding Light of Destiny', "Sepulchure's Armor"]);
  assert.deepStrictEqual(results.skipped, ['ArchPaladin']);
  assert.strictEqual(results.error, null);

  const saveResult = await window.handle('saveSet', null, [opened.entries]);
  assert.strictEqual(saveResult.error, null);
  assert.strictEqual(saved.length, 1);

  // An unknown channel is refused rather than answered with something plausible.
  assert.throws(function () { window.handle('nonsense'); }, /unknown sets channel/);
});
