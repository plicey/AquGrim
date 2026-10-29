// The Sets window's own logic (ticket #29): the .gset format in both directions, the item
// combo's rows, the saved-set listing, and the equip sequence. Reference: Grimoire/UI/Set.cs
// (classes SetItem and Item, the Add handler, the Refresh handler, the save/load dialogs) and
// Grimoire/Botting/Commands/Item/CmdEquipSet.cs. Expected values come from that source.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const sets = require('../../plugins/grimlite-parity/features/sets/sets.js');
const { createSetDialogs } = require('../../plugins/grimlite-parity/features/sets/set-dialogs.js');

const FIXTURES = path.join(__dirname, '../fixtures/grimlite-sets');

function inventoryItem(name, category, isEquipped) {
  return {
    id: 1,
    name: name,
    category: category,
    isAcItem: false,
    isEquipped: !!isEquipped
  };
}

test('the .gset reader takes the reference\'s document shape', () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'reference-set.gset'), 'utf8');
  const parsed = sets.parseSet(text);

  assert.strictEqual(parsed.ok, true, parsed.error);
  assert.deepStrictEqual(parsed.entries, [
    { type: 'Weapon', name: 'Blinding Light of Destiny' },
    { type: 'Class', name: 'ArchPaladin' },
    { type: 'Armor', name: "Sepulchure's Armor" }
  ]);
});

test('a set the app writes is byte-for-byte the reference\'s own document', () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'reference-set.gset'), 'utf8');
  const parsed = sets.parseSet(text);
  assert.strictEqual(sets.serializeSet(parsed.entries), text);
});

test('the .gset writer names the reference\'s types, as the corpus does', () => {
  const document = JSON.parse(sets.serializeSet([{ type: 'Weapon', name: 'Sword of Awe' }]));
  assert.strictEqual(document.$type, 'Grimoire.UI.SetItem, Grimoire');
  assert.strictEqual(
    document.Set.$type,
    'System.Collections.Generic.List`1[[Grimoire.UI.ISetInterface, Grimoire]], mscorlib'
  );
  assert.deepStrictEqual(document.Set.$values, [{
    $type: 'Grimoire.UI.Item, Grimoire',
    Type: 'Weapon',
    Name: 'Sword of Awe'
  }]);
});

test('a set file with no type information still loads, as the reference tolerates', () => {
  const plain = sets.parseSet('{ "Set": { "$values": [{ "Type": "Class", "Name": "NoType" }] } }');
  assert.strictEqual(plain.ok, true, plain.error);
  assert.deepStrictEqual(plain.entries, [{ type: 'Class', name: 'NoType' }]);

  const bare = sets.parseSet('{ "Set": [{ "Type": "Helm", "Name": "Bare" }] }');
  assert.strictEqual(bare.ok, true, bare.error);
  assert.deepStrictEqual(bare.entries, [{ type: 'Helm', name: 'Bare' }]);
});

test('a file that is not a set is refused with a message the window can show', () => {
  const result = sets.parseSet('not json at all');
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.entries, null);
  assert.strictEqual(result.error, sets.ERRORS.parse);
  assert.strictEqual(sets.parseSet('').ok, false);
  assert.strictEqual(sets.parseSet('[1,2,3]').ok, false);
  // An empty set is a set, not an error: Clear then Save is a legitimate thing to do.
  assert.deepStrictEqual(sets.parseSet('{ "Set": { "$values": [] } }').entries, []);
});

test('Add turns an inventory item into the reference\'s entry, weapon categories folded to Weapon', () => {
  // Set.cs btnAdd_Click: the type is the item's category, except that every weapon category
  // is written as the single type "Weapon".
  assert.deepStrictEqual(sets.entryFor(inventoryItem('Blinding Light of Destiny', 'Sword')),
    { type: 'Weapon', name: 'Blinding Light of Destiny' });
  assert.deepStrictEqual(sets.entryFor(inventoryItem('Rusty Wand', 'Wand')),
    { type: 'Weapon', name: 'Rusty Wand' });
  assert.deepStrictEqual(sets.entryFor(inventoryItem('ArchPaladin', 'Class')),
    { type: 'Class', name: 'ArchPaladin' });
  assert.deepStrictEqual(sets.entryFor(inventoryItem('Moglin Cape', 'Cape')),
    { type: 'Cape', name: 'Moglin Cape' });
});

test('the item combo lists the reference\'s five groups in its order, headers not selectable', () => {
  const rows = sets.inventoryRows([
    inventoryItem('Blinding Light of Destiny', 'Sword'),
    inventoryItem('ArchPaladin', 'Class'),
    inventoryItem('Sepulchure\'s Armor', 'Armor'),
    inventoryItem('Golden Helm', 'Helm'),
    inventoryItem('Moglin Cape', 'Cape'),
    inventoryItem('Treasure Potion', 'Item')
  ]);

  assert.deepStrictEqual(rows.map(function (row) { return row.label; }), [
    '', '[Weapons]', '', 'Blinding Light of Destiny',
    '', '[Classes]', '', 'ArchPaladin',
    '', '[Armors]', '', "Sepulchure's Armor",
    '', '[Helmets]', '', 'Golden Helm',
    '', '[Capes]', '', 'Moglin Cape',
    '', '[Pets]', '', '', '[Necklaces]', '', '', '[Misc]', '', '', '[Earrings]', '', '', '[Amulets]', '',
    '', '[Belts]', '', '', '[Rings]', ''
  ]);
  // Only a real item can be added; the separators and headers are text.
  assert.deepStrictEqual(rows.filter(function (row) { return row.entry !== null; }).map(function (row) {
    return row.entry;
  }), [
    { type: 'Weapon', name: 'Blinding Light of Destiny' },
    { type: 'Class', name: 'ArchPaladin' },
    { type: 'Armor', name: "Sepulchure's Armor" },
    { type: 'Helm', name: 'Golden Helm' },
    { type: 'Cape', name: 'Moglin Cape' }
  ]);
  // Item and other non-equipped categories are not offered (the reference's own set of groups).
  assert.strictEqual(rows.some(function (row) { return row.label === 'Treasure Potion'; }), false);
});

test('the saved-set listing finds .gset files, folders included, and nothing else', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-sets-'));
  fs.writeFileSync(path.join(directory, 'beta.gset'), '{}');
  fs.writeFileSync(path.join(directory, 'Alpha.GSET'), '{}');
  fs.writeFileSync(path.join(directory, 'notes.txt'), 'not a set');
  fs.mkdirSync(path.join(directory, 'bosses'));
  fs.writeFileSync(path.join(directory, 'bosses', 'dage.gset'), '{}');

  assert.deepStrictEqual(sets.listSets(directory), [
    { name: 'Alpha.GSET', path: 'Alpha.GSET' },
    { name: 'beta.gset', path: 'beta.gset' },
    { name: 'dage.gset', path: 'bosses/dage.gset' }
  ]);
  // A missing folder is an empty list, not a crash: first run has no Sets directory yet.
  assert.deepStrictEqual(sets.listSets(path.join(directory, 'nowhere')), []);
});

test('the set dialogs use the reference\'s titles, filter and file extension', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-setdialogs-'));
  const asked = [];
  const dialogs = createSetDialogs({
    store: require('../../res/platform/storage/namespaced-store.js').createNamespacedStore({
      appDataDirectory: appData,
      pluginId: 'grimlite-parity'
    }).getStore('sets'),
    defaultDirectory: path.join(appData, 'Sets'),
    showOpenDialog: function (win, options) {
      asked.push(options);
      return Promise.resolve({ canceled: true });
    },
    showSaveDialog: function (win, options) {
      asked.push(options);
      return Promise.resolve({ canceled: true });
    }
  });

  await dialogs.open();
  await dialogs.save([{ type: 'Class', name: 'ArchPaladin' }]);

  assert.deepStrictEqual(asked[0], {
    title: 'Load Set',
    defaultPath: path.join(appData, 'Sets'),
    filters: [{ name: 'Grimoire sets', extensions: ['gset'] }],
    properties: ['openFile']
  });
  assert.strictEqual(asked[1].title, 'Save Set');
  assert.deepStrictEqual(asked[1].filters, [{ name: 'Grimoire sets', extensions: ['gset'] }]);
  assert.strictEqual(asked[1].defaultPath, path.join(appData, 'Sets', 'set.gset'));
});

test('saving and opening a set round-trips through the file system, and the folder is remembered', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-setdialogs-'));
  const home = path.join(appData, 'My Sets');
  fs.mkdirSync(home, { recursive: true });
  const written = path.join(home, 'paladin.gset');
  const dialogs = createSetDialogs({
    store: require('../../res/platform/storage/namespaced-store.js').createNamespacedStore({
      appDataDirectory: appData,
      pluginId: 'grimlite-parity'
    }).getStore('sets'),
    defaultDirectory: path.join(appData, 'Sets'),
    showOpenDialog: function () {
      return Promise.resolve({ canceled: false, filePaths: [written] });
    },
    // No extension on purpose: the reference's SaveFileDialog adds its default extension.
    showSaveDialog: function () {
      return Promise.resolve({ canceled: false, filePath: path.join(home, 'paladin') });
    }
  });

  const entries = [
    { type: 'Weapon', name: 'Blinding Light of Destiny' },
    { type: 'Class', name: 'ArchPaladin' }
  ];
  const saved = await dialogs.save(entries);
  assert.strictEqual(saved.canceled, false);
  assert.strictEqual(saved.path, written);
  assert.strictEqual(saved.error, null);

  const opened = await dialogs.open();
  assert.strictEqual(opened.canceled, false);
  assert.strictEqual(opened.path, written);
  assert.deepStrictEqual(opened.entries, entries);
  assert.strictEqual(opened.error, null);
});

test('a set file that cannot be read is reported, not thrown at the window', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-setdialogs-'));
  const bad = path.join(appData, 'broken.gset');
  fs.writeFileSync(bad, '} not json {');
  const dialogs = createSetDialogs({
    store: null,
    defaultDirectory: path.join(appData, 'Sets'),
    showOpenDialog: function () {
      return Promise.resolve({ canceled: false, filePaths: [bad] });
    }
  });

  const result = await dialogs.open();
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.entries, null);
  assert.strictEqual(result.error, sets.ERRORS.parse);
});

test('loading a set found by the listing needs no second dialog', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-setdialogs-'));
  const setsDir = path.join(appData, 'Sets');
  fs.mkdirSync(setsDir, { recursive: true });
  fs.copyFileSync(path.join(FIXTURES, 'reference-set.gset'), path.join(setsDir, 'mine.gset'));
  const dialogs = createSetDialogs({
    store: null,
    defaultDirectory: setsDir,
    showOpenDialog: function () {
      throw new Error('the listing must not open a dialog');
    }
  });

  const opened = await dialogs.openByPath('mine.gset');
  assert.strictEqual(opened.error, null);
  assert.strictEqual(opened.entries.length, 3);
  // A path that tries to leave the Sets folder is refused rather than followed.
  const escaped = await dialogs.openByPath('../outside.gset');
  assert.strictEqual(escaped.entries, null);
  assert.strictEqual(escaped.error, sets.ERRORS.outside);
});


test('snapshot keeps every equipped slot and round trips as an ordinary named gset', () => {
  const categories = sets.WEAPON_CATEGORIES.concat(['Class', 'Armor', 'Helm', 'Cape', 'Pet', 'Necklace', 'Misc', 'Earring', 'Amulet', 'Belt', 'Ring']);
  const inventory = categories.map((category) => inventoryItem(category, category, true));
  inventory.push(inventoryItem('Not worn', 'Cape', false), inventoryItem('Potion', 'Item', true));
  const entries = sets.equippedEntries(inventory);
  assert.strictEqual(entries.length, categories.length);
  assert.deepStrictEqual(sets.parseSet(sets.serializeSet(entries)).entries, entries);
  assert.throws(() => sets.equippedEntries([]), /No equipped/);
});

test('equip sends sequential paced ordinary requests, skips worn items and reports failures', async () => {
  const calls = [];
  const inventory = ['Class', 'Cape', 'Pet', 'Misc'].map((type) => inventoryItem(type, type, type === 'Class'));
  const game = {
    readInventory: async () => inventory,
    sleep: async (ms) => calls.push(ms),
    equipItem: async (name) => { calls.push(name); if (name === 'Pet') return false; if (name === 'Misc') throw new Error('restricted'); }
  };
  const entries = inventory.map(sets.entryFor).concat([{ type: 'Armor', name: 'Banked' }]);
  const result = await sets.equipSet(game, entries);
  assert.deepStrictEqual(calls, [1600, 'Cape', 1600, 'Pet', 1600, 'Misc']);
  assert.strictEqual(result.requested, 1);
  assert.strictEqual(result.skipped, 1);
  assert.strictEqual(result.failures.length, 3);
  assert.match(result.error, /Pet: Game did not accept/);
  assert.match(result.error, /Misc: restricted/);
  assert.match(result.error, /Banked: Not in inventory/);
  await assert.rejects(() => sets.equipSet(game, [{ name: 1 }]), /Select/);
});
