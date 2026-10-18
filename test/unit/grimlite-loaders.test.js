// Loaders and grabbers (ticket #31). The reference is Grimlite-Li 816d9cd:
// Grimoire/UI/Loaders.cs (the window and the loader targets) and Grimoire/Tools/Grabber.cs
// (the eight grabbers, their rows and their context menus). Every expected string below is
// computed from that C# source, never taken from the code under test.
//
// The game side is what decides what can work at all. The reference's own loader SWF
// (Loader/grimoire.swf) implements most of the names its C# calls and the stock game does not
// have them, so the reads here go through the game's own objects and calls instead. Which names
// exist where was checked by decompressing both SWFs:
//
//   python3 -c "import zlib;d=open('/var/tmp/aq-origin/game.swf','rb').read();print(zlib.decompress(d[8:]).find(b'getInventory')>=0)"
//   python3 -c "import zlib;d=open('/var/tmp/grimlite-src/Loader/grimoire.swf','rb').read();print(zlib.decompress(d[8:]).find(b'GetQuestTree')>=0)"
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const platform = require('../../res/platform');
const grabbers = require('../../plugins/grimlite-parity/features/loaders/grabbers.js');
const xml = require('../../plugins/grimlite-parity/features/loaders/xml.js');
const game = require('../../plugins/grimlite-parity/features/loaders/game.js');
const loaders = require('../../plugins/grimlite-parity/features/loaders/loaders.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const LOADERS_WINDOW_ID = 'grimlite-parity-loaders';

function activateParity(deps) {
  return platform.activatePlugin({
    source: 'bundled',
    root: pluginRoot,
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  }, {
    appVersion: JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: deps || {}
  });
}

// A bridge stub in the shape res/platform/bridge-channel.js answers with: a call resolves to
// { ok, value } where the value is the movie's own JSON text, an error text included.
function bridgeStub(byName) {
  const calls = [];
  return {
    calls: calls,
    call: function (name, args) {
      calls.push({ name: name, args: args });
      const key = args && args.length ? name + ':' + args[0] : name;
      const answer = byName[key] !== undefined ? byName[key] : byName[name];
      if (answer === undefined) {
        return Promise.resolve({ ok: false, error: 'no member ' + args[0] + ' at ' });
      }
      return Promise.resolve({ ok: true, value: JSON.stringify(answer) });
    }
  };
}

function rowsOf(target, payload, options) {
  return grabbers.buildRows(target, payload, options || {});
}

function texts(rows) {
  return rows.map(function (row) { return row.text; });
}

function actions(menu) {
  return menu.map(function (item) { return item.label; });
}

function feature(deps) {
  return loaders.createLoadersFeature(null, Object.assign({
    openUrl: function () {},
    clipboard: { writeText: function () {} },
    game: game.createGameAccess(bridgeStub({}))
  }, deps || {}));
}

// ---------------------------------------------------------------- the reference's own controls

test('the loaders and grabbers combos carry the reference\'s own entries, in its own order', () => {
  assert.deepStrictEqual(grabbers.LOAD_TARGETS.map(function (t) { return t.label; }), [
    'Hair shop', 'Shop', 'Quest', 'Armor customizer'
  ]);
  assert.deepStrictEqual(grabbers.GRAB_TARGETS.map(function (t) { return t.label; }), [
    'Shop items', 'Quest IDs', 'Quest items, drop rates', 'Inventory items',
    'Temp inventory items', 'Bank items', 'Monsters', 'All Monsters'
  ]);
  assert.deepStrictEqual(grabbers.ORDER_BY, ['Name', 'Id']);

  // Loaders.cs's constructor sets cbLoad.SelectedIndex = 2, so the window opens on Quest.
  assert.strictEqual(grabbers.LOAD_TARGETS[grabbers.LOAD_DEFAULT_INDEX].id, 'quest');

  // cbGrab_SelectedIndexChanged enables the order combo on `enableGrabOn = {"Monster","Quest"}`,
  // matched with IndexOf(..., OrdinalIgnoreCase) >= 0.
  assert.deepStrictEqual(
    grabbers.GRAB_TARGETS.filter(function (t) { return grabbers.orderable(t.label); })
      .map(function (t) { return t.label; }),
    ['Quest IDs', 'Quest items, drop rates', 'Monsters', 'All Monsters']
  );
  ['Hair shop', 'Shop', 'Shop items', 'Inventory items', 'Temp inventory items', 'Bank items']
    .forEach(function (label) {
      assert.strictEqual(grabbers.orderable(label), false, label + ' must not offer ordering');
    });
});

test('the quest-count control expands ids the way btnLoad expands them', () => {
  // "quests += questId + (i < increament - 1 && increament != 1 ? "," : "")"
  assert.strictEqual(grabbers.questList(5, 1), '5');
  assert.strictEqual(grabbers.questList(5, 2), '5,6');
  assert.strictEqual(grabbers.questList(5, 3), '5,6,7');
  assert.strictEqual(grabbers.questList(100, 30).split(',').length, 30);
  assert.strictEqual(grabbers.questList(5, 0), '');
});

test('a comma list reaches the game only when every part is digits (LoadQuests)', () => {
  // LoadQuests: source.All(s => s.All(char.IsDigit)) - anything else is refused, and silently.
  assert.deepStrictEqual(grabbers.parseQuestList('5,6,7'), [5, 6, 7]);
  assert.deepStrictEqual(grabbers.parseQuestList('5'), [5]);
  assert.strictEqual(grabbers.parseQuestList('5,a'), null);
  assert.strictEqual(grabbers.parseQuestList('5, 6'), null);
  assert.strictEqual(grabbers.parseQuestList(''), null);
});

test('descriptions shorten at 32 characters with three dots, as Shorten does', () => {
  assert.strictEqual(grabbers.shorten('short', 32), 'short');
  assert.strictEqual(grabbers.shorten('x'.repeat(32), 32), 'x'.repeat(32));
  assert.strictEqual(grabbers.shorten('x'.repeat(33), 32), 'x'.repeat(32) + '...');
  assert.strictEqual(grabbers.shorten(null, 32), '');
});

// ---------------------------------------------------------------- the grabber rows

test('an inventory grab builds the reference\'s rows, fields and enhancement names', () => {
  const payload = {
    items: [
      { ItemID: 123, sName: 'Sword of Testing', iQty: 2, iStk: 10, bCoins: '1', sType: 'Sword',
        iLvl: 5, sDesc: 'A blade long enough to be shortened', sFile: 'sword.swf', sLink: 'link',
        bEquip: '1', iEnh: 70752, CharItemID: 55 },
      { ItemID: 7, sName: 'Tiny Rock', iQty: 1, iStk: 99, bCoins: 0, sType: 'Item', iLvl: 1,
        sDesc: 'Small', iEnh: 0 }
    ]
  };

  // GrabItems runs on OrderBy(Name) whatever the combo says.
  const rows = rowsOf('inventoryItems', payload);
  assert.deepStrictEqual(texts(rows), ['Sword of Testing (123)', 'Tiny Rock (7)']);

  assert.deepStrictEqual(texts(rows[0].children), [
    'ID: 123',
    'Char item id: 55',
    'Quantity: 2/10',
    'AC tagged: True',
    'Category: Sword',
    'Level: 5',
    'Description: A blade long enough to be shorte...',
    'sFile: sword.swf',
    'sLink: link',
    // 70752 is forgeID.Valiance; the reference prefers its own name table, then the enum.
    'Enhancement: Valiance',
    'Enhancement ID: 70752'
  ]);

  // 'Item' is neither a weapon nor an equippable non-weapon: no sFile block, no enhancement.
  assert.deepStrictEqual(texts(rows[1].children), [
    'ID: 7', 'Char item id: 0', 'Quantity: 1/99', 'AC tagged: False', 'Category: Item',
    'Level: 1', 'Description: Small'
  ]);

  // The five Luck ids come from EnhancementNames and win over the forge enum.
  const luck = rowsOf('inventoryItems', {
    items: [{ ItemID: 1, sName: 'A', iQty: 1, iStk: 1, sType: 'Sword', sDesc: '', iEnh: 52369 }]
  });
  assert.ok(texts(luck[0].children).indexOf('Enhancement: Luck Awe Blast') !== -1);
});

test('temp and bank grabs read their own payloads in their own shapes', () => {
  // TempItem rows are named "{Name} [{Quantity}/{MaxStack}]", ordered by name.
  const temp = rowsOf('tempItems', {
    '1': { ItemID: 9, sName: 'Quest Dew', iQty: 3, iStk: 20 },
    '0': { ItemID: 8, sName: 'Alpha Dew', iQty: 1, iStk: 20 }
  });
  assert.deepStrictEqual(texts(temp), ['Alpha Dew [1/20]', 'Quest Dew [3/20]']);
  assert.deepStrictEqual(texts(temp[1].children), ['ID: 9', 'Quantity: 3/20']);

  const bank = rowsOf('bankItems', {
    items: [{ ItemID: 4, sName: 'Banked Blade', iQty: 1, iStk: 1, bCoins: '1', sType: 'Sword',
      iLvl: 1, sDesc: '', iEnh: 0 }]
  });
  assert.deepStrictEqual(texts(bank), ['Banked Blade (4)']);
  assert.ok(texts(bank[0].children).indexOf('AC tagged: True') !== -1);
});

test('a shop grab builds the shop, its location and its item rows', () => {
  const payload = {
    ShopID: 42, sName: 'Yulgar\'s Inn', Location: 'Battleon',
    items: [
      { ItemID: 11, ShopItemID: 900, sName: 'Iron Sword', iQty: 1, iStk: 1, iCost: 100,
        bCoins: '0', sType: 'Sword', iLvl: 2, sDesc: 'Plain', sFile: 'a.swf', sLink: 'b' },
      { ItemID: 12, ShopItemID: 901, sName: 'Two Potions', iQty: 2, iStk: 10, iCost: 5,
        bCoins: '1', sType: 'Misc', iLvl: 1, sDesc: 'Pair' }
    ]
  };
  const rows = rowsOf('shopItems', payload);
  assert.deepStrictEqual(texts(rows), ['Yulgar\'s Inn']);
  assert.deepStrictEqual(texts(rows[0].children), ['ID: 42', 'Location: Battleon', 'Items']);
  const items = rows[0].children[2];
  // A stack over one is shown with " x{Quantity}".
  assert.deepStrictEqual(texts(items.children), ['Iron Sword', 'Two Potions x2']);
  assert.deepStrictEqual(texts(items.children[0].children), [
    'Shop item ID: 900', 'ID: 11', 'Cost: 100 Gold', 'Category: Sword', 'Level: 2',
    'Description: Plain', 'Stack: 1/1', 'sFile: a.swf', 'sLink: b'
  ]);
  assert.ok(texts(items.children[1].children).indexOf('Cost: 5 AC') !== -1);
});

test('quest grabs list ids in the chosen order and skip a zero id', () => {
  const payload = {
    '10': { QuestID: 10, sName: 'Beta Quest', iSlot: 0, iValue: 0 },
    '11': { QuestID: 11, sName: 'Alpha Quest', iSlot: 3, iValue: 7, sDesc: 'Do a thing',
      RequiredItems: [{ ItemID: 5, sName: 'Rock', iQty: 3, bTemp: '1', sDesc: 'A rock' }],
      reward: [{ ItemID: 6, sName: 'Prize', iQty: 1, iRate: '100', sType: 'Sword',
        sDesc: 'Nice', sFile: 'p.swf', sLink: 'l' }],
      oRewards: { '1': { '6': { sName: 'Prize', sType: 'Sword', sDesc: 'Nice',
        sFile: 'p.swf', sLink: 'l' } } } },
    '0': { QuestID: 0, sName: 'Not a quest' }
  };

  assert.deepStrictEqual(texts(rowsOf('questIds', payload, { orderBy: 'Name' })), [
    'Alpha Quest - 11', 'Beta Quest - 10'
  ]);
  assert.deepStrictEqual(texts(rowsOf('questIds', payload, { orderBy: 'Id' })), [
    '10 - Beta Quest', '11 - Alpha Quest'
  ]);

  const quests = rowsOf('questItems', payload, { orderBy: 'Name' });
  assert.deepStrictEqual(texts(quests), ['Alpha Quest - 11', 'Beta Quest - 10']);
  assert.deepStrictEqual(texts(quests[0].children), [
    'iSlot: 3', 'iValue: 7', 'Description: Do a thing', 'Required items', 'Rewards'
  ]);
  assert.deepStrictEqual(texts(quests[0].children[3].children), ['Rock x3']);
  assert.deepStrictEqual(texts(quests[0].children[3].children[0].children), [
    'ID: 5', 'Temporary: Yes', 'Description: A rock'
  ]);
  assert.deepStrictEqual(texts(quests[0].children[4].children[0].children), [
    'ID: 6', 'Drop chance: Guaranteed', 'Category: Sword', 'Description: Nice',
    'sFile: p.swf', 'sLink: l'
  ]);
  // iSlot 0 and iValue 0 are the reference's own "nothing to show" case.
  assert.deepStrictEqual(texts(quests[1].children), ['Description: ']);

  // A drop chance that is not 100 prints as a percentage.
  const partial = rowsOf('questItems', {
    '9': { QuestID: 9, sName: 'Lucky', sDesc: '', reward: [{ ItemID: 6, sName: 'Prize',
      iQty: 1, iRate: '12.5' }], oRewards: { '1': { '6': { sName: 'Prize',
      sType: 'Misc', sDesc: '' } } } }
  });
  assert.ok(texts(partial[0].children[1].children[0].children)
    .indexOf('Drop chance: 12.5%') !== -1);
});

test('monster grabs order by name or mon map id, dedupe by map id and name the cell', () => {
  const payload = [
    { strMonName: 'Zombie', Cell: 'r1', MonID: 5, MonMapID: 44, sRace: 'Undead', iLvl: 3,
      intHP: 50, intHPMax: 100 },
    { strMonName: '  Ant  ', Cell: 'r1', MonID: 6, MonMapID: 55, sRace: 'Insect', iLvl: 2,
      intHP: 10, intHPMax: 10 },
    { strMonName: 'Zombie (sibling)', Cell: 'r1', MonID: 5, MonMapID: 44, sRace: 'Undead',
      iLvl: 3, intHP: 50, intHPMax: 100 }
  ];
  // GrabMonsters groups by MonMapID and takes the first of each group.
  assert.deepStrictEqual(texts(rowsOf('monsters', payload, { orderBy: 'Name' })), ['Ant', 'Zombie']);
  assert.deepStrictEqual(texts(rowsOf('monsters', payload, { orderBy: 'Id' })), ['Zombie', 'Ant']);
  assert.deepStrictEqual(texts(rowsOf('monsters', payload)[0].children), [
    'ID: 6', 'MonMapID: 55', 'Race: Insect', 'Level: 2', 'Health: 10/10'
  ]);
  // GrabAllMonsters names the cell and orders by MonMapID on 'Id'.
  assert.deepStrictEqual(texts(rowsOf('allMonsters', payload, { orderBy: 'Id' })), [
    'Zombie (r1)', 'Zombie (sibling) (r1)', 'Ant (r1)'
  ]);
});

test('search walks the tree in order, case-insensitively, and cycles like the reference', () => {
  const rows = rowsOf('questIds', {
    '1': { QuestID: 1, sName: 'Alpha' },
    '2': { QuestID: 2, sName: 'Beta' }
  }, { orderBy: 'Name' });
  const flat = grabbers.flatten(rows);
  assert.deepStrictEqual(flat.map(function (node) { return node.text; }), ['Alpha - 1', 'Beta - 2']);

  assert.deepStrictEqual(grabbers.findMatches(rows, 'a'), [0, 1]);
  assert.deepStrictEqual(grabbers.findMatches(rows, 'BETA'), [1]);
  assert.deepStrictEqual(grabbers.findMatches(rows, 'nothing here'), []);
  // A blank keyword matches nothing, as btnSearchGrab_Click returns early on IsNullOrWhiteSpace.
  assert.deepStrictEqual(grabbers.findMatches(rows, '   '), []);

  // Past the last match it starts again at the first.
  assert.strictEqual(grabbers.nextMatch(2, 0), 1);
  assert.strictEqual(grabbers.nextMatch(2, 1), 0);
  assert.strictEqual(grabbers.nextMatch(0, 0), -1);
});

// ---------------------------------------------------------------- the XML the reference writes

test('the export writes the reference\'s TreeView document, padded the way SaveNodes pads', () => {
  const text = xml.toXml([
    { text: 'A Shop', tag: '42', children: [
      { text: 'ID: 42' },
      { text: 'no colon here' },
      { text: 'a:b:c', children: [] }
    ] }
  ]);

  // XmlTextWriter(Encoding.ASCII, Formatting.Indented), WriteStartDocument, WriteRaw("\r\n").
  assert.ok(text.indexOf('<?xml version="1.0" encoding="us-ascii"?>\r\n\r\n<TreeView>\r\n') === 0,
    'declaration, blank line, root: ' + JSON.stringify(text.slice(0, 64)));
  assert.ok(text.indexOf('<n t="A Shop" tg="42">') !== -1, text);
  // for (int times = Split(':')[0].Length; 9 > times; times++) toadd += " ";
  assert.ok(text.indexOf('    <n t="ID:        42" />') !== -1,
    'a colon text pads its first part to nine columns: ' + text);
  // No colon at all is the writer's catch: the text goes out untouched.
  assert.ok(text.indexOf('<n t="no colon here" />') !== -1, text);
  // Split(':')[1] drops everything after a second colon.
  assert.ok(text.indexOf('<n t="a:        b" />') !== -1, text);
  assert.ok(/<\/TreeView>\s*$/.test(text), 'the root closes last: ' + text);

  // XmlTextWriter escapes attribute values, so a name with markup survives a round trip.
  const escaped = xml.toXml([{ text: 'Rock & Roll "deluxe"' }]);
  assert.ok(escaped.indexOf('t="Rock &amp; Roll &quot;deluxe&quot;"') !== -1, escaped);
});

test('a document the reference wrote loads back here node for node, tags included', () => {
  // A hand-made stand-in for a reference export: both of the writer's shapes (self-closed and
  // explicitly closed), a tg attribute, and the padded colon text.
  const referenceFile = [
    '<?xml version="1.0" encoding="us-ascii"?>',
    '',
    '<TreeView>',
    '  <n t="Yulgar\'s Inn">',
    '    <n t="ID:       42" tg="42" />',
    '    <n t="Items">',
    '      <n t="Iron Sword" />',
    '    </n>',
    '  </n>',
    '</TreeView>'
  ].join('\r\n');

  assert.deepStrictEqual(xml.fromXml(referenceFile), [{
    text: 'Yulgar\'s Inn',
    children: [
      { text: 'ID:       42', tag: '42', children: [] },
      { text: 'Items', children: [{ text: 'Iron Sword', children: [] }] }
    ]
  }]);

  // What this window writes, it reads back - escaping and padding included.
  const own = xml.toXml([{ text: 'a:b:c', children: [{ text: 'Rock & Roll "x"' }] }]);
  assert.deepStrictEqual(xml.fromXml(own), [
    { text: 'a:        b', children: [{ text: 'Rock & Roll "x"', children: [] }] }
  ]);
});

test('a file that is not a TreeView export is refused rather than half-read', () => {
  assert.throws(function () { xml.fromXml('<?xml version="1.0"?><Other><n t="x"/></Other>'); },
    /TreeView/);
  assert.throws(function () { xml.fromXml('not xml at all'); }, /XML|TreeView/);
  assert.throws(function () { xml.fromXml(''); }, /XML|TreeView/);
});

// ---------------------------------------------------------------- the game side

test('the reads go to the game\'s own objects and calls, which exist in the stock game SWF', async () => {
  const inventory = { items: [{ ItemID: 3, sName: 'Rock', iQty: 1, iStk: 5, sType: 'Item', iLvl: 1 }] };
  const bridge = bridgeStub({
    'callGameFunction0:world.getInventory': inventory,
    'getGameObject:world.questTree': { '10': { QuestID: 10, sName: 'Q' } },
    'getGameObject:world.shopinfo': { ShopID: 1, sName: 'S', items: [] },
    'getGameObject:world.strFrame': 'r1',
    'callGameFunction:world.getMonstersByCell': [{ strMonName: 'Rat', MonMapID: 3, Cell: 'r1' }],
    'getGameObject:world.cells': ['r1', 'r2']
  });
  const access = game.createGameAccess(bridge);

  assert.deepStrictEqual(await access.readInventory(), inventory.items);
  assert.deepStrictEqual(await access.readQuestTree(), [{ QuestID: 10, sName: 'Q' }]);
  assert.deepStrictEqual((await access.readShopInfo()).ShopID, 1);
  assert.deepStrictEqual(await access.readMonsters(), [{ strMonName: 'Rat', MonMapID: 3, Cell: 'r1' }]);
  assert.deepStrictEqual(await access.readAllMonsters(), [
    { strMonName: 'Rat', MonMapID: 3, Cell: 'r1' },
    { strMonName: 'Rat', MonMapID: 3, Cell: 'r1' }
  ]);

  assert.deepStrictEqual(bridge.calls.map(function (c) { return c.name + ':' + c.args[0]; }), [
    'callGameFunction0:world.getInventory',
    'getGameObject:world.questTree',
    'getGameObject:world.shopinfo',
    'getGameObject:world.strFrame',
    'callGameFunction:world.getMonstersByCell',
    'getGameObject:world.cells',
    'callGameFunction:world.getMonstersByCell',
    'callGameFunction:world.getMonstersByCell'
  ]);
  // The cell comes from the world, and goes into the call as the game's own argument.
  assert.deepStrictEqual(bridge.calls[4].args, ['world.getMonstersByCell', 'r1']);
  // World.GetAllMonsters walks Cells in the order the world lists them.
  assert.deepStrictEqual(bridge.calls[6].args, ['world.getMonstersByCell', 'r1']);
  assert.deepStrictEqual(bridge.calls[7].args, ['world.getMonstersByCell', 'r2']);
});

test('a read falls back to the game\'s other object when the first one refuses', async () => {
  const bridge = bridgeStub({
    // world.getInventory answers {error}, which is how the bridge reports a failing movie call.
    'callGameFunction0:world.getInventory': { error: 'no member getInventory at world.' },
    // The fallback is a member name the game SWF itself carries (its inventory tree), where
    // world.myAvatar.objData.items is a path only the reference's loader would have made.
    'getGameObject:world.invTree': { '0': { ItemID: 3, sName: 'Rock' } }
  });
  const access = game.createGameAccess(bridge);
  assert.deepStrictEqual(await access.readInventory(), [{ ItemID: 3, sName: 'Rock' }]);
  assert.strictEqual(access.lastRead.answeredBy, 'world.invTree');
});

test('a read that nobody answers reports every attempt\'s own words, never an empty list', async () => {
  const access = game.createGameAccess(bridgeStub({}));
  await assert.rejects(function () { return access.readQuestTree(); },
    function (error) {
      assert.ok(/world\.questTree/.test(error.message), error.message);
      assert.ok(/world\.getQuests/.test(error.message), error.message);
      return true;
    });
});

test('a loaded target asks the reference\'s own name first, then the game\'s own request', async () => {
  const bridge = bridgeStub({ 'callGameFunction:world.sendLoadShopRequest': null });
  const access = game.createGameAccess(bridge);

  const result = await access.loadShop(42);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.via, 'world.sendLoadShopRequest');
  assert.deepStrictEqual(bridge.calls.map(function (c) { return c.name + ':' + c.args[0]; }), [
    // Shop.Load resets the shop info first, then loads.
    'callGameFunction0:ResetShopInfo',
    'callGameFunction:LoadShop',
    'callGameFunction:world.sendLoadShopRequest'
  ]);
  assert.deepStrictEqual(bridge.calls[2].args, ['world.sendLoadShopRequest', 42]);
});

test('every loader target has the game-side call the stock SWF actually has', async () => {
  const reached = {};
  const bridge = {
    call: function (name, args) {
      reached[args[0]] = (reached[args[0]] || 0) + 1;
      // The reference's loader-only names answer nothing, exactly as the stock game does today.
      const known = ['world.sendLoadShopRequest', 'world.sendLoadHairShopRequest',
        'world.openArmorCustomize', 'world.getQuests', 'world.getQuest'];
      if (known.indexOf(args[0]) === -1) {
        return Promise.resolve({ ok: false, error: 'no member ' + args[0] + ' at ' });
      }
      return Promise.resolve({ ok: true, value: 'null' });
    }
  };
  const access = game.createGameAccess(bridge);

  assert.strictEqual((await access.loadHairShop(7)).via, 'world.sendLoadHairShopRequest');
  assert.strictEqual((await access.loadArmorCustomizer()).via, 'world.openArmorCustomize');
  assert.strictEqual((await access.loadQuest(10)).via, 'world.getQuest');
  assert.strictEqual((await access.loadQuests([10, 11])).via, 'world.getQuests');
  assert.strictEqual(reached['world.sendLoadHairShopRequest'], 1);
  assert.strictEqual(reached['world.openArmorCustomize'], 1);
});

test('a target nothing answers reports both names, and the game\'s own words', async () => {
  const access = game.createGameAccess(bridgeStub({}));
  const result = await access.loadArmorCustomizer();
  assert.strictEqual(result.ok, false);
  assert.ok(/LoadArmorCustomizer/.test(result.error), result.error);
  assert.ok(/openArmorCustomize/.test(result.error), 'both names are reported: ' + result.error);
});

test('accepting a quest uses the game\'s own call, and the ghost variant its raw packet', async () => {
  const bridge = bridgeStub({
    'callGameFunction:world.acceptQuest': null,
    'callGameFunction:sfc.sendString': null
  });
  const access = game.createGameAccess(bridge);

  // The loader's Accept is asked first and the game's own acceptQuest answers, so the
  // successful call is the second one.
  assert.strictEqual((await access.acceptQuest(77)).ok, true);
  assert.deepStrictEqual(bridge.calls[1].args, ['world.acceptQuest', 77]);

  // Quest.GhostAccept sends the same packet the reference sends, through the game's own socket.
  const ghost = await access.acceptQuest(77, { ghost: true });
  assert.strictEqual(ghost.ok, true);
  assert.deepStrictEqual(bridge.calls[2].args, ['sfc.sendString', '%xt%zm%acceptQuest%1%77%']);
});

test('completing a quest tries the reference\'s call and reports what the game answers', async () => {
  const bridge = bridgeStub({ 'callGameFunction:world.tryQuestComplete': null });
  const access = game.createGameAccess(bridge);
  const result = await access.completeQuest(10, { max: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.via, 'world.tryQuestComplete');
  // The reference's own Complete is loader-only today, so it is tried and its answer is dropped.
  assert.strictEqual(bridge.calls[0].args[0], 'Complete');
  assert.deepStrictEqual(bridge.calls[1].args, ['world.tryQuestComplete', 10]);

  const nothing = await game.createGameAccess(bridgeStub({})).completeQuest(10, {});
  assert.strictEqual(nothing.ok, false);
  assert.ok(/Complete/.test(nothing.error) && /tryQuestComplete/.test(nothing.error), nothing.error);
});

// ---------------------------------------------------------------- the context menus

test('each row carries the reference\'s context menu, in its own order and words', () => {
  const labels = function (kind, ctx) {
    return actions(grabbers.menu(kind, ctx || {}));
  };

  // Grabber.Wiki(string item), used for monsters and temp items.
  assert.deepStrictEqual(labels('wikiName'), [
    'Go to Wikipage', 'Search on Wiki', 'Copy To Clipboard'
  ]);
  // Grabber.Wiki(ShopInfo).
  assert.deepStrictEqual(labels('shop'), ['Go to Wikipage', 'Search on Wiki', 'Load Shop']);
  // Grabber.Wiki(InventoryItem, shop): the two buy rows exist only inside a shop grab.
  assert.deepStrictEqual(labels('shopItem', { shopId: 42 }), [
    'Go to Wikipage', 'Search on Wiki', 'Buy This Item', 'Add buy command'
  ]);
  assert.deepStrictEqual(labels('shopItem', {}), ['Go to Wikipage', 'Search on Wiki']);
  // Grabber.MenuItem(InventoryItem).
  assert.deepStrictEqual(labels('item'), [
    'Add to both', 'Add to whitelist', 'Add to unbank list', 'Copy item name to clipboard',
    'Go to Wikipage', 'Search on Wiki'
  ]);
  // Grabber.MenuQuest: the last two need the quest's own required-items list.
  assert.deepStrictEqual(labels('quest', { requiredItems: [] }), [
    'Add to quest list', 'Accept Quest', 'Complete Quest (Once)', 'Load Quest',
    'Complete Quest (Maxed)', 'Copy all Reqs', 'Copy Bypass Packet'
  ]);
  assert.deepStrictEqual(labels('quest', {}), [
    'Add to quest list', 'Accept Quest', 'Complete Quest (Once)', 'Load Quest',
    'Complete Quest (Maxed)'
  ]);
  // Grabber.MenuItems(List<InventoryItem>): the group menus.
  assert.deepStrictEqual(labels('aggregate'), [
    'Add all to both', 'Add all to whitelist', 'Add all to unbank list', 'Search all on Wiki',
    'Copy all'
  ]);
});

test('the bypass packet is the reference\'s own JSON, byte for byte', () => {
  assert.strictEqual(grabbers.bypassPacket({ iValue: 7, iSlot: 3 }),
    '{"t":"xt","b":{"r":-1,"o":{"cmd":"updateQuest","iValue":7,"iIndex":3}}}');
});

// ---------------------------------------------------------------- the actions

test('a wiki action opens in the app\'s browser window, never the system browser', async () => {
  const opened = [];
  const instance = feature({ openUrl: function (url, mode) { opened.push([url, mode]); } });

  await instance.act('wikiPage', { name: 'Sword ofTesting' });
  await instance.act('wikiSearch', { name: 'Sword of Testing' });
  assert.deepStrictEqual(opened, [
    ['https://aqwwiki.wikidot.com/Sword+ofTesting', 'new-window'],
    ['https://aqwwiki.wikidot.com/search:site/q/Sword+of+Testing', 'new-window']
  ]);
});

test('copy actions put the reference\'s own text on the clipboard', async () => {
  const written = [];
  const instance = feature({ clipboard: { writeText: function (text) { written.push(text); } } });

  await instance.act('copy', { text: 'Rock' });
  await instance.act('copyBypass', { iValue: 1, iSlot: 2 });
  // MenuItems' "Copy all": one quoted pair per line, no comma between them.
  await instance.act('copyAll', { names: ['Rock', 'Dew'], quantities: [3, 1] });
  // MenuQuest's "Copy all Reqs": a comma between the two lines, as the reference writes it.
  await instance.act('copyAllReqs', { names: ['Rock', 'Dew'], quantities: [3, 1] });

  assert.deepStrictEqual(written, [
    'Rock',
    '{"t":"xt","b":{"r":-1,"o":{"cmd":"updateQuest","iValue":1,"iIndex":2}}}',
    '"ItemName" : "Rock,Dew"\n"Quantity" : "3,1"',
    '"ItemName" : "Rock,Dew",\n"Quantity" : "3,1"'
  ]);
});

test('single-item actions reach the game and the bot lists in the reference\'s own order', async () => {
  const done = [];
  const gameStub = {
    loadShop: function (id) { done.push(['loadShop', id]); return Promise.resolve({ ok: true }); },
    loadQuest: function (id) { done.push(['loadQuest', id]); return Promise.resolve({ ok: true }); },
    acceptQuest: function (id, opts) { done.push(['acceptQuest', id, opts]); return Promise.resolve({ ok: true }); },
    completeQuest: function (id, opts) { done.push(['completeQuest', id, opts]); return Promise.resolve({ ok: true }); }
  };
  const lists = [];
  const instance = feature({
    game: gameStub,
    botLists: {
      addDrops: function (names) { lists.push(['drops', names]); return { added: names.length, wired: true }; },
      addItems: function (names) { lists.push(['items', names]); return { added: names.length, wired: true }; },
      addQuests: function (rows) { lists.push(['quests', rows]); return { added: rows.length, wired: true }; },
      addCommands: function (commands) { lists.push(['commands', commands]); return { added: commands.length, wired: true }; }
    }
  });

  await instance.act('loadShop', { id: 42 });
  await instance.act('loadQuest', { id: 10 });
  await instance.act('acceptQuest', { id: 10 });
  await instance.act('completeQuest', { id: 10, max: false, autoSelect: true });
  await instance.act('completeQuest', { id: 10, max: true });
  await instance.act('addToBoth', { names: ['Rock'] });
  await instance.act('addToWhitelist', { names: ['Rock'] });
  await instance.act('addToUnbank', { names: ['Rock'] });
  await instance.act('addQuest', { id: 10 });
  await instance.act('addBuyCommand', {
    shopId: 42, itemId: 11, itemName: 'Iron Sword', shopItemId: 900, qty: 1
  });

  assert.deepStrictEqual(done, [
    ['loadShop', 42],
    ['loadQuest', 10],
    ['acceptQuest', 10, { ghost: false }],
    ['completeQuest', 10, { max: false, autoSelect: true }],
    ['completeQuest', 10, { max: true, autoSelect: false }]
  ]);
  // AddDrop/AddItem order: "both" adds the drop first, then the item; the whitelist is the drop
  // list and the unbank list is the item list (BotManager.AddDrop / AddItem / AddQuest).
  assert.deepStrictEqual(lists.map(function (l) { return l[0]; }),
    ['drops', 'items', 'drops', 'items', 'quests', 'commands']);
  assert.deepStrictEqual(lists[5][1], [{
    $type: 'Grimoire.Botting.Commands.Item.CmdBuy, Grimoire',
    ItemName: 'Iron Sword', ItemId: 11, ShopId: 42, ShopItemId: 900, Qty: 1
  }]);
});

test('the aggregate actions send every name to the lists and every search to the browser', async () => {
  const opened = [];
  const lists = [];
  const instance = feature({
    openUrl: function (url) { opened.push(url); },
    botLists: {
      addDrops: function (names) { lists.push(['drops'].concat(names)); },
      addItems: function (names) { lists.push(['items'].concat(names)); },
      addQuests: function () {},
      addCommands: function () {}
    }
  });

  await instance.act('searchAllOnWiki', { names: ['Rock', 'Dew'] });
  assert.deepStrictEqual(opened, [
    'https://aqwwiki.wikidot.com/search:site/q/Rock',
    'https://aqwwiki.wikidot.com/search:site/q/Dew'
  ]);

  await instance.act('addAllToBoth', { names: ['Rock', 'Dew'] });
  assert.deepStrictEqual(lists, [['drops', 'Rock', 'Dew'], ['items', 'Rock', 'Dew']]);
});

// The bot lists live in the Bot Manager's document (#36), which is not in this build. The seam
// reports that in words instead of claiming to have added a row nobody kept.
// shortcut: wire this to #36's lists when the Bot Manager lands; until then it is honest.
test('a bot list action says plainly when no list is wired yet', async () => {
  const instance = feature();
  const result = await instance.act('addToBoth', { names: ['Rock'] });
  assert.strictEqual(result.ok, false);
  assert.ok(/bot/i.test(result.error), result.error);
  assert.strictEqual(typeof loaders.createBotLists().addDrops, 'function');
});

// Grabber.Wiki(InventoryItem, shop)'s "Equip SWF" and "Buy This Item": the two rows whose
// reference call is a name only the reference's own loader carries.
test('equipping a row goes through the game\'s own slot call when the loader refuses', async () => {
  const calls = [];
  const bridge = {
    call: function (name, args) {
      calls.push({ name: name, args: args });
      // SetEquip is the reference's own name and the loader's alone. The game's own
      // loadMovieAtES answers instead: it is in the game's pool with four live references.
      if (args[0] === 'SetEquip') {
        return Promise.resolve({ ok: false, error: 'no member SetEquip at world' });
      }
      return Promise.resolve({ ok: true, value: 'null' });
    }
  };
  const access = game.createGameAccess(bridge);

  // Grabber.cs's own slot map, from the item's category.
  assert.strictEqual((await access.equipSwf('Armor', 'a.swf', 'link')).ok, true);
  assert.deepStrictEqual(calls[1].args,
    ['world.myAvatar.loadMovieAtES', 'co', 'a.swf', 'link']);
  await access.equipSwf('Cape', 'b.swf', 'l');
  assert.strictEqual(calls[3].args[1], 'ba');
  await access.equipSwf('Helm', 'c.swf', 'l');
  assert.strictEqual(calls[5].args[1], 'he');
  await access.equipSwf('Pet', 'd.swf', 'l');
  assert.strictEqual(calls[7].args[1], 'pe');
  await access.equipSwf('Misc', 'e.swf', 'l');
  assert.strictEqual(calls[9].args[1], 'mi');
  await access.equipSwf('Sword', 'f.swf', 'l');
  assert.strictEqual(calls[11].args[1], 'Weapon');
});

// The window's own action for those two rows.
test('a row\'s Equip SWF is acted on, and Buy This Item names what it is waiting for', async () => {
  // The real game access, over a bridge that answers only the game's own call: so both of these
  // assertions are about the shipped module, not about a stub standing in for it.
  const calls = [];
  const instance = feature({
    game: game.createGameAccess({
      call: function (name, args) {
        calls.push(args[0]);
        if (args[0] === 'world.myAvatar.loadMovieAtES') {
          return Promise.resolve({ ok: true, value: 'null' });
        }
        return Promise.resolve({ ok: false, error: 'no member ' + args[0] + ' at world' });
      }
    })
  });

  const result = await instance.act('equipSwf', { category: 'Armor', file: 'a.swf', link: 'l' });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.via, 'world.myAvatar.loadMovieAtES');
  assert.ok(calls.indexOf('SetEquip') !== -1, 'the reference\'s own name is tried first');

  // Shop.BuyItemQty -> Flash.Call("BuyItemQtyById"), which the stock game does not carry.
  const buy = await instance.act('buyNow', { itemId: 11, shopItemId: 900, qty: 1 });
  assert.strictEqual(buy.ok, false);
  assert.ok(/BuyItemQtyById/.test(buy.error), buy.error);
});

// The bot lists live in the Bot Manager's document (#36, merged). The seam takes the document
// the window is editing and adds the same rows BotManager.AddDrop/AddItem/AddQuest/AddCommand add,
// with the reference's own Contains guards.
test('the bot lists add to the Bot Manager\'s document, unique and in its own shape', () => {

  // The document starts with a wrapped Drops list (what a .gbot file holds) and no Items key at
  // all, which is what a list the reference's own listbox has never held looks like.
  const document = { Drops: { $values: ['Rock'] }, Items: [] };
  const lists = loaders.createBotLists({ bot: document });
  const held = function (key) {
    return document[key].$values || document[key];
  };

  assert.strictEqual(lists.addDrops(['Rock', 'Dew']).added, 1);
  assert.strictEqual(lists.addItems(['Rock']).added, 1);
  assert.strictEqual(lists.addQuests([{ Id: 10, Text: '10' }]).added, 1);
  assert.strictEqual(lists.addCommands([{ $type: 'CmdBuy' }]).added, 1);
  assert.deepStrictEqual(held('Drops'), ['Rock', 'Dew']);
  assert.deepStrictEqual(held('Items'), ['Rock']);
  assert.deepStrictEqual(held('Quests'), [{ Id: 10, Text: '10' }]);
  assert.deepStrictEqual(held('Commands'), [{ $type: 'CmdBuy' }]);

  // AddDrop and AddItem guard with Contains (BotManager.cs:2134/2229), and AddQuest's guard is
  // the same one on the Quest object, whose ToString is its id.
  assert.strictEqual(lists.addDrops(['Rock']).added, 0);
  assert.strictEqual(lists.addQuests([{ Id: 10, Text: '10' }]).added, 0);
  // AddCommand has no guard at all: the reference appends whatever it is given.
  assert.strictEqual(lists.addCommands([{ $type: 'CmdBuy' }]).added, 1);
  // A list the document never held is created empty rather than refused.
  assert.strictEqual(lists.addItems(['Dew']).added, 1);
  assert.deepStrictEqual(held('Items'), ['Rock', 'Dew']);
});

// The window's own wiring: the lists a grabber writes into are the Bot Manager's document, so a
// grabbed item reaches a saved .gbot rather than a copy nobody sees.
test('the loaders feature writes its list actions into the bot document it is given', async () => {
  const bot = { Drops: [] };
  const instance = feature({ botLists: loaders.createBotLists({ bot: bot }) });

  const result = await instance.act('addToBoth', { names: ['Rock'] });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.added, 1);
  assert.deepStrictEqual(bot.Drops, ['Rock']);

  // And a bot with no document behind it still says so rather than failing silently.
  const orphan = feature();
  assert.strictEqual((await orphan.act('addToBoth', { names: ['Rock'] })).ok, false);
});

// ---------------------------------------------------------------- the window's channels

test('the parity plugin registers the loaders window in the app\'s window conventions', async () => {
  const activated = await activateParity();
  const found = activated.host._getState().featureWindows.filter(function (w) {
    return w.id === LOADERS_WINDOW_ID;
  });
  assert.strictEqual(found.length, 1, 'missing feature window ' + LOADERS_WINDOW_ID);
  const config = found[0].config;
  assert.strictEqual(config.webPreferences.sandbox, true);
  assert.strictEqual(config.webPreferences.plugins, false);
  assert.strictEqual(config.webPreferences.contextIsolation, true);
  assert.strictEqual(config.webPreferences.nodeIntegration, false);
  assert.strictEqual(config.useContentSize, true);
  // The reference's own client size for Loaders.cs.
  assert.strictEqual(config.width, 271);
  assert.strictEqual(config.height, 367);
  assert.ok(fs.existsSync(require('url').fileURLToPath(found[0].url)));
  const preload = fs.readFileSync(config.webPreferences.preload, 'utf8');
  assert.ok(/require\((['"])electron\1\)/.test(preload));
  assert.ok(!/[^\w.]require\(['"](?!electron)/.test(preload), 'a sandboxed preload may only require electron');

  // The page and its inline script parse, and its bridge calls are all exposed by the preload.
  const html = fs.readFileSync(require('url').fileURLToPath(found[0].url), 'utf8');
  assert.ok(html.indexOf('res/features/common/focus.css') !== -1, 'the app\'s shared focus style');
  const bound = html.match(/([A-Za-z0-9_]+)\s*=\s*window\.aquastarLoaders/);
  assert.ok(bound, 'the page must bind window.aquastarLoaders');
  const exposed = (preload.match(/^\s*([A-Za-z0-9_]+): function/gm) || []).map(function (line) {
    return line.trim().split(':')[0];
  });
  ['grab', 'load', 'save', 'open', 'act', 'messages'].forEach(function (name) {
    assert.ok(exposed.indexOf(name) !== -1, 'the preload must expose ' + name);
  });
  (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).forEach(function (block) {
    const source = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    assert.doesNotThrow(function () { new (require('vm').Script)(source); });
  });
});

test('the grab channel hands back the rows the page draws, and refusals say why', async () => {
  const instance = feature({
    game: game.createGameAccess(bridgeStub({
      'callGameFunction0:world.getInventory': { items: [
        { ItemID: 3, sName: 'Rock', iQty: 1, iStk: 5, sType: 'Item', iLvl: 1, sDesc: '' }
      ] }
    }))
  });

  const grabbed = await instance.handle('loadersGrab', [null, 'inventoryItems', 'Name']);
  assert.strictEqual(grabbed.ok, true);
  assert.deepStrictEqual(texts(grabbed.rows), ['Rock (3)']);
  // Each row carries the menu kind its context needs, so the page never invents a menu.
  assert.strictEqual(grabbed.rows[0].menu, 'item');

  const refused = await instance.handle('loadersGrab', [null, 'bankItems', 'Name']);
  assert.strictEqual(refused.ok, false);
  assert.ok(/bankinfo|getBank/.test(refused.error), refused.error);

  const unknown = await instance.handle('loadersGrab', [null, 'nope', 'Name']);
  assert.strictEqual(unknown.ok, false);
  assert.ok(/nope/.test(unknown.error), unknown.error);
});

test('the load channel drives each target, the quest count and the ghost variant', async () => {
  const calls = [];
  const access = {
    loadShop: function (id) { calls.push(['shop', id]); return Promise.resolve({ ok: true }); },
    loadHairShop: function (id) { calls.push(['hairShop', id]); return Promise.resolve({ ok: true }); },
    loadArmorCustomizer: function () { calls.push(['armorCustomizer']); return Promise.resolve({ ok: true }); },
    loadQuest: function (id) { calls.push(['quest', id]); return Promise.resolve({ ok: true }); },
    loadQuests: function (ids) { calls.push(['quests', ids]); return Promise.resolve({ ok: true }); },
    isInProgress: function (id) { return Promise.resolve(inProgress.indexOf(id) !== -1); },
    acceptQuest: function (id, opts) {
      calls.push(['accept', id, opts.ghost]);
      return Promise.resolve(opts.ghost
        ? { ok: false, error: 'no member sfc.sendString at ' }
        : { ok: true });
    },
    sleep: function () { return Promise.resolve(); }
  };
  let inProgress = [];
  const instance = feature({ game: access });

  await instance.handle('loadersLoad', [null, 'shop', '42', 1, false, false]);
  assert.deepStrictEqual(calls.pop(), ['shop', 42]);
  await instance.handle('loadersLoad', [null, 'hairShop', '7', 1, false, false]);
  assert.deepStrictEqual(calls.pop(), ['hairShop', 7]);
  await instance.handle('loadersLoad', [null, 'armorCustomizer', '', 1, false, false]);
  assert.deepStrictEqual(calls.pop(), ['armorCustomizer']);

  // A single id with the count control: LoadQuests gets the expanded list, like btnLoad does.
  await instance.handle('loadersLoad', [null, 'quest', '10', 3, false, false]);
  assert.deepStrictEqual(calls.pop(), ['quests', [10, 11, 12]]);
  // A comma list is not expanded.
  await instance.handle('loadersLoad', [null, 'quest', '4,5', 3, false, false]);
  assert.deepStrictEqual(calls.pop(), ['quests', [4, 5]]);

  // F Accept: load the batch, then accept what the game says is not already in progress.
  inProgress = [11];
  const accepted = await instance.handle('loadersLoad', [null, 'quest', '10', 3, true, false]);
  assert.strictEqual(accepted.ok, true);
  assert.deepStrictEqual(calls.shift(), ['quests', [10, 11, 12]]);
  assert.deepStrictEqual(calls, [['accept', 10, false], ['accept', 12, false]]);

  // Ghost goes through the packet path, and its refusal is reported rather than swallowed.
  calls.length = 0;
  const ghost = await instance.handle('loadersLoad', [null, 'quest', '10', 1, true, true]);
  assert.strictEqual(ghost.ok, false);
  assert.ok(/sfc\.sendString/.test(ghost.error), ghost.error);
  assert.deepStrictEqual(calls, [['quests', [10]], ['accept', 10, true]]);

  // A non-numeric box is the reference's own silent refusal, reported as such.
  calls.length = 0;
  const refused = await instance.handle('loadersLoad', [null, 'quest', 'abc', 1, false, false]);
  assert.strictEqual(refused.ok, false);
  assert.deepStrictEqual(calls, []);
});

test('save writes the XML through the reference\'s save dialog, and open reads it back', async () => {
  const written = [];
  const asked = [];
  const instance = feature({
    game: game.createGameAccess(bridgeStub({
      'getGameObject:world.shopinfo': { ShopID: 42, sName: 'A Shop', Location: 'Here', items: [
        { ItemID: 11, ShopItemID: 900, sName: 'Iron Sword', iQty: 1, iStk: 1, iCost: 1,
          bCoins: '0', sType: 'Sword', iLvl: 1, sDesc: '', sFile: 'a', sLink: 'b' }
      ] }
    })),
    dialogs: {
      save: function (options) {
        asked.push(options);
        return Promise.resolve({ canceled: false, filePath: '/tmp/grab.xml' });
      },
      open: function (options) {
        asked.push(options);
        return Promise.resolve({ canceled: false, filePaths: ['/tmp/grab.xml'] });
      }
    },
    writeText: function (file, text) { written.push([file, text]); },
    readText: function () { return written[0][1]; }
  });

  // Save with nothing grabbed is refused, not written as an empty document.
  const empty = await instance.handle('loadersSave', [null]);
  assert.strictEqual(empty.ok, false);
  assert.strictEqual(written.length, 0);

  await instance.handle('loadersGrab', [null, 'shopItems', 'Name']);
  const saved = await instance.handle('loadersSave', [null]);
  assert.strictEqual(saved.ok, true);
  // The reference's own dialog: title "Save grabber data", filter "XML files|*.xml".
  assert.strictEqual(asked[0].title, 'Save grabber data');
  assert.deepStrictEqual(asked[0].filters, [{ name: 'XML files', extensions: ['xml'] }]);
  assert.strictEqual(written[0][0], '/tmp/grab.xml');
  assert.ok(written[0][1].indexOf('<n t="A Shop">') !== -1);

  const reopened = await instance.handle('loadersOpen', [null]);
  assert.strictEqual(reopened.ok, true);
  assert.strictEqual(reopened.rows.length, 1);
  assert.deepStrictEqual(texts(reopened.rows[0].children), ['ID:        42', 'Location:  Here', 'Items']);
});

test('a cancelled dialog reports cancelled and writes nothing', async () => {
  const instance = feature({
    game: game.createGameAccess(bridgeStub({
      'getGameObject:world.shopinfo': { ShopID: 1, sName: 'S', items: [] }
    })),
    dialogs: {
      save: function () { return Promise.resolve({ canceled: true }); },
      open: function () { return Promise.resolve({ canceled: true }); }
    },
    writeText: function () { throw new Error('must not write'); },
    readText: function () { throw new Error('must not read'); }
  });
  await instance.handle('loadersGrab', [null, 'shopItems', 'Name']);
  assert.deepStrictEqual(await instance.handle('loadersSave', [null]), { ok: false, canceled: true });
  assert.deepStrictEqual(await instance.handle('loadersOpen', [null]), { ok: false, canceled: true });
});
