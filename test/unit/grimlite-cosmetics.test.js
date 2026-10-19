// The Cosmetics window (ticket #30). The reference is Grimlite-Li: Grimoire/UI/CosmeticForm.cs
// with CosmeticForm.Designer.cs for the slot grid, the button words and the grab links,
// Grimoire/Botting/CosmeticEquipment.cs for the EquipType <-> slot-code map, and Grimoire/UI/Set.cs
// for the .gset document the Sets window writes.
//
// Which game calls this port makes was settled against the real SWFs on this machine, not guessed:
// the stock game (2.7 MB Game4000r5 build) contains `world.myAvatar.loadMovieAtES`, `getWearAtES`,
// `getItemByEquipSlot`, `eqp`, `uoTree`, `objData`, `uoName` and `entID`, while `GetEquip`,
// `SetEquip`, `Players` and `isNull` exist only in the reference's own loader
// (Loader/grimoire.swf). So the reads here go to the game's own wear store and the write is the
// exact call the reference keeps commented out beside its loader-only SetEquip:
// CallGameFunction("world.myAvatar.loadMovieAtES", slot, SWFFile, Link).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const url = require('url');
const vm = require('vm');

const platform = require('../../res/platform');
const cosmetics = require('../../plugins/grimlite-parity/features/cosmetics/cosmetics.js');
const { createGameAccess } = require('../../plugins/grimlite-parity/features/cosmetics/game-access.js');
const { createCosmeticsWindow } = require('../../plugins/grimlite-parity/features/cosmetics/cosmetics-window.js');
const { createCosmeticsDialogs } = require('../../plugins/grimlite-parity/features/cosmetics/cosmetics-dialogs.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const featureDir = path.join(pluginRoot, 'features/cosmetics');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const WINDOW_ID = 'grimlite-parity-cosmetics';

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

/** A stand-in for the window's game access: what it was asked, and what it answers. */
function fakeGame(answers) {
  const calls = [];
  answers = answers || {};
  return {
    calls: calls,
    readPlayers: function () {
      return Promise.resolve(answers.players || { players: [], error: null });
    },
    readWear: function (id) {
      calls.push({ readWear: id });
      return Promise.resolve(answers.wear || { wear: null, error: 'no wear' });
    },
    setSlot: function (code, file, link) {
      calls.push({ setSlot: [code, file, link] });
      const answer = answers.set || { ok: true, error: null };
      return Promise.resolve(typeof answer === 'function' ? answer(code, file, link) : answer);
    }
  };
}

function handlersFor(window) {
  const handlers = {};
  window.attachTo({ ipc: { handle: function (channel, listener) { handlers[channel] = listener; } } });
  return handlers;
}

// Fitz the reference's own bridge answers: a value the bridge JSON-decoded, or its refusal.
function ok(value) { return { ok: true, value: JSON.stringify(value) }; }

// ------------------------------------------------------------------ the slot grid

// CosmeticForm.Designer.cs lays the eight rows out at y = 0/24/48/72/96/120/144/168 with the
// labels Helm, Armor, Class, Weapon, Off.H, Pet, Cape, Misc. The codes are CosmeticForm's own
// btnSet_Click switch for Off ("Off") and CosmeticEquipment's _cosMap for the rest; the list
// labels are CosmeticEquipment.ToString's EquipType names, which is why the ground row is "Misc"
// in the grid and "Ground" in the list, and why there is no Off row in the list at all.
test('the grid is the reference\'s eight rows, with its labels and its slot codes', () => {
  assert.deepStrictEqual(
    cosmetics.ROWS.map(function (row) { return [row.id, row.label, row.code, row.listLabel]; }),
    [
      ['helm', 'Helm', 'he', 'Helm'],
      ['armor', 'Armor', 'co', 'Armor'],
      ['class', 'Class', 'ar', 'Class'],
      ['weapon', 'Weapon', 'Weapon', 'Weapon'],
      ['off', 'Off.H', 'Off', null],
      ['pet', 'Pet', 'pe', 'Pet'],
      ['cape', 'Cape', 'ba', 'Cape'],
      ['misc', 'Misc', 'mi', 'Ground']
    ]
  );
  // The designer's seven grab links, in the order tableLayoutPanel2 lays them out.
  assert.deepStrictEqual(
    cosmetics.GRAB_LINKS.map(function (link) { return link.label; }),
    ['Grab Helm', 'Grab Armor', 'Grab Class', 'Grab Wep', 'Grab Pet', 'Grab Cape', 'Grab Ground']
  );
  assert.deepStrictEqual(
    cosmetics.GRAB_LINKS.map(function (link) { return link.row; }),
    ['helm', 'armor', 'class', 'weapon', 'pet', 'cape', 'misc']
  );
  // The reference's own buttons, its own words.
  assert.deepStrictEqual(cosmetics.BUTTONS, {
    grab: 'Grab',
    set: 'Set',
    equipAll: 'Equip All',
    equipSelected: 'Equip Selected',
    clearAll: 'Clear All',
    remove: 'Remove',
    save: 'Save',
    load: 'Load'
  });
  assert.strictEqual(cosmetics.WINDOW_TITLE, 'SWF Cosmetics');
});

// Each row holds what the reference's own _data writes: "file;link", the two text boxes joined.
// The reference splits on ';' with no limit, so only the first one separates.
test('a slot value is its file and its link, joined and split on the first semicolon', () => {
  assert.strictEqual(cosmetics.join('Champion Headdress', 'championheaddress.swf'),
    'Champion Headdress;championheaddress.swf');
  assert.deepStrictEqual(cosmetics.sides('Champion Headdress;championheaddress.swf'), {
    file: 'Champion Headdress',
    link: 'championheaddress.swf'
  });
  assert.deepStrictEqual(cosmetics.sides('blod.swf'), { file: 'blod.swf', link: '' });
  assert.deepStrictEqual(cosmetics.sides('a;b;c'), { file: 'a', link: 'b;c' });
  assert.deepStrictEqual(cosmetics.sides(''), { file: '', link: '' });
  assert.deepStrictEqual(cosmetics.sides(null), { file: '', link: '' });
  assert.deepStrictEqual(cosmetics.emptyValues(), {
    helm: '', armor: '', class: '', weapon: '', off: '', pet: '', cape: '', misc: ''
  });
});

// ------------------------------------------------------------------ setting one slot

// CosmeticForm.cs's btnSet_Click sends the slot code and (file, link) - with the link through
// ReplaceLink(), the reference's own ".swf"/"_skin" strip. It sends them to its loader's SetEquip,
// which no AquaGrim user has; the game's own method of that name is "load movie at equip slot",
// which is the call the reference keeps commented out on the line beside it.
test('setting one row calls the game\'s own load-movie-at-slot, with that row\'s code', async () => {
  const game = fakeGame();
  const window = createCosmeticsWindow({ game: game });
  const handlers = handlersFor(window);

  assert.deepStrictEqual(await handlers.cosmeticSet({}, 'cape', 'ArchPaladin Cape;archpaladincape.swf'), {
    ok: true,
    error: null
  });
  assert.deepStrictEqual(game.calls, [{ setSlot: ['ba', 'ArchPaladin Cape', 'archpaladincape.swf'] }]);

  // The reference's own default branch: anything outside its named cases is the weapon.
  game.calls.length = 0;
  await handlers.cosmeticSet({}, 'weapon', 'Blinding Light of Destiny;blod.swf');
  assert.deepStrictEqual(game.calls, [{ setSlot: ['Weapon', 'Blinding Light of Destiny', 'blod.swf'] }]);

  // A row the window does not have is refused rather than sent with a made-up slot code.
  assert.deepStrictEqual(await handlers.cosmeticSet({}, 'nose', 'x'), {
    ok: false,
    error: cosmetics.ERRORS.slot
  });
});

// The write goes through the bridge's callGameFunction, with the arguments the reference's own
// commented-out line shows: ("world.myAvatar.loadMovieAtES", slot, SWFFile, Link) - the link as
// the wear store carries it, not through its ReplaceLink strip, because that is what the class
// holding this line does and what makes a value grabbed from a player go back in unchanged.
test('the slot write is the reference\'s own callGameFunction line', async () => {
  const calls = [];
  const access = createGameAccess({
    log: function () {},
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (name, args) {
        calls.push({ name: name, args: args });
        return Promise.resolve(ok('ok'));
      }
    }
  });

  assert.deepStrictEqual(await access.setSlot('ba', 'ArchPaladin Cape', 'archpaladincape.swf'), {
    ok: true,
    error: null
  });
  assert.deepStrictEqual(calls, [{
    name: 'callGameFunction',
    args: ['world.myAvatar.loadMovieAtES', 'ba', 'ArchPaladin Cape', 'archpaladincape.swf']
  }]);

  // Grab hands back what the game's own wear store holds, and a Set puts that back unchanged:
  // the two halves of the window have to agree on the same string, or a copied look would drift.
  const grabbed = cosmetics.wearRows({ ba: { sFile: 'ArchPaladin Cape', sLink: 'archpaladincape.swf' } });
  assert.deepStrictEqual(grabbed[0].text, 'Cape: ArchPaladin Cape;archpaladincape.swf');
  const value = grabbed[0].text.slice(grabbed[0].text.indexOf(': ') + 2);
  calls.length = 0;
  await access.setSlot('ba', cosmetics.sides(value).file, cosmetics.sides(value).link);
  assert.deepStrictEqual(calls[0].args[3], 'archpaladincape.swf');
});

// The reference wraps every one of these handlers in a bare catch, so a refusal is silent. This
// port reports it, and a refused write is never reported as applied.
test('a slot the game refuses says so instead of pretending it was set', async () => {
  const window = createCosmeticsWindow({
    game: fakeGame({ set: { ok: false, error: 'the bridge does not register callGameFunction' } })
  });
  const handlers = handlersFor(window);
  assert.deepStrictEqual(await handlers.cosmeticSet({}, 'helm', 'x.swf'), {
    ok: false,
    error: 'the bridge does not register callGameFunction'
  });
});

// ------------------------------------------------------------------ the player picker

// CosmeticForm.cs's Refresh fills the combo from World.Players and selects the first row when
// there is one; PlayerInfo.ToString is "{EntID}: {Name}", which is what the combo shows.
test('the picker lists the room\'s players in the reference\'s own row shape', () => {
  // world.uoTree is the game's own player tree, keyed by uid; every avatar carries objData.
  assert.deepStrictEqual(
    cosmetics.playerRows({
      12: { objData: { uoName: 'Zee', entID: 12 } },
      34: { objData: { uoName: 'Plicey', entID: 34 } }
    }),
    [
      { id: 12, name: 'Zee', label: '12: Zee' },
      { id: 34, name: 'Plicey', label: '34: Plicey' }
    ]
  );
  // The uid is the fallback when the game has not put an entity id on the avatar yet.
  assert.deepStrictEqual(cosmetics.playerRows({ 7: { objData: { uoName: 'Ammar' } } }), [
    { id: 7, name: 'Ammar', label: '7: Ammar' }
  ]);
  assert.deepStrictEqual(cosmetics.playerRows(null), []);
  assert.deepStrictEqual(cosmetics.playerRows('nonsense'), []);
});

test('the picker asks the game for its own player tree, and reports a refusal', async () => {
  const calls = [];
  const access = createGameAccess({
    log: function () {},
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (name, args) {
        calls.push({ name: name, args: args });
        return Promise.resolve(ok({ 12: { objData: { uoName: 'Zee', entID: 12 } } }));
      }
    }
  });
  assert.deepStrictEqual(await access.readPlayers(), {
    players: [{ id: 12, name: 'Zee', label: '12: Zee' }],
    error: null
  });
  assert.deepStrictEqual(calls, [{ name: 'getGameObject', args: ['world.uoTree'] }]);

  const refused = createGameAccess({
    log: function () {},
    bridge: {
      attach: function () { return Promise.resolve({ ok: false, error: 'no game window' }); },
      call: function () { throw new Error('must not be called when attaching failed'); }
    }
  });
  assert.deepStrictEqual(await refused.readPlayers(), { players: [], error: 'no game window' });
});

// ------------------------------------------------------------------ grabbing a look

// Grab reads one player's wear in a single read of the game's own wear store: objData.eqp, the
// dictionary whose keys are the slot codes (the codes CosmeticEquipment._backMap is built from).
test('a player\'s wear is read in one call, from the game\'s own equip store', async () => {
  const calls = [];
  const eqp = {
    he: { sFile: 'Champion Headdress', sLink: 'championheaddress.swf' },
    ba: { sFile: 'ArchPaladin Cape', sLink: 'archpaladincape.swf' }
  };
  const access = createGameAccess({
    log: function () {},
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (name, args) {
        calls.push({ name: name, args: args });
        return Promise.resolve(ok(eqp));
      }
    }
  });

  assert.deepStrictEqual(await access.readWear(34), { wear: eqp, error: null });
  assert.deepStrictEqual(calls, [{
    name: 'getGameObject',
    args: ['world.uoTree.34.objData.eqp']
  }]);
});

// CosmeticEquipment.Get maps each key through _backMap and drops anything it does not know, which
// is why a grab yields seven rows and never an Off.H one. The list rows are that class's own
// ToString, "{Slot}: {file};{link}".
test('Grab turns a wear into the reference\'s own list rows', () => {
  const wear = {
    he: { sFile: 'Champion Headdress', sLink: 'championheaddress.swf' },
    co: { sFile: "Void Highlord's Armor", sLink: 'voidhighlord_skin.swf' },
    ar: { sFile: 'Void Highlord', sLink: 'voidhighlord.swf' },
    Weapon: { sFile: 'Blinding Light of Destiny', sLink: 'blod.swf' },
    Off: { sFile: 'Something', sLink: 'something.swf' },
    pe: { sFile: 'Rogue', sLink: 'rogue.swf' },
    ba: { sFile: 'ArchPaladin Cape', sLink: 'archpaladincape.swf' },
    mi: { sFile: 'Moglin', sLink: 'moglin.swf' }
  };
  const rows = cosmetics.wearRows(wear);
  assert.deepStrictEqual(rows.map(function (row) { return row.text; }), [
    'Helm: Champion Headdress;championheaddress.swf',
    'Armor: Void Highlord\'s Armor;voidhighlord_skin.swf',
    'Class: Void Highlord;voidhighlord.swf',
    'Weapon: Blinding Light of Destiny;blod.swf',
    'Pet: Rogue;rogue.swf',
    'Cape: ArchPaladin Cape;archpaladincape.swf',
    'Ground: Moglin;moglin.swf'
  ]);
  // The grid order, not the wear object's own key order.
  assert.deepStrictEqual(rows.map(function (row) { return row.row; }),
    ['helm', 'armor', 'class', 'weapon', 'pet', 'cape', 'misc']);
  assert.ok(!rows.some(function (row) { return row.row === 'off'; }),
    'the reference\'s own back map has no Off, so Grab must not produce an Off row');

  // A missing or empty wear is no rows, not a row of blanks.
  assert.deepStrictEqual(cosmetics.wearRows(null), []);
  assert.deepStrictEqual(cosmetics.wearRows({}), []);
  // A wear entry with a file but no link is still a row: the reference reads both boxes.
  assert.deepStrictEqual(cosmetics.wearRows({ he: { sFile: 'X' } }).length, 1);
});

// The window's Grab fills the whole grid from the chosen player; a per-slot link fills that one row
// and, as the reference does, refuses to overwrite a value the user already typed there.
test('Grab fills the grid, and a per-slot link fills only its own row', async () => {
  const wear = { he: { sFile: 'Champion Headdress', sLink: 'championheaddress.swf' } };
  const game = fakeGame({ wear: { wear: wear, error: null } });
  const window = createCosmeticsWindow({ game: game });
  const handlers = handlersFor(window);

  const grabbed = await handlers.cosmeticGrab({}, 34);
  assert.strictEqual(grabbed.error, null);
  assert.deepStrictEqual(game.calls, [{ readWear: 34 }]);
  assert.deepStrictEqual(grabbed.rows, [
    { row: 'helm', label: 'Helm', text: 'Helm: Champion Headdress;championheaddress.swf' }
  ]);
  assert.deepStrictEqual(grabbed.values, { helm: 'Champion Headdress;championheaddress.swf' });

  const filled = await handlers.cosmeticGrabSlot({}, 34, 'helm', '');
  assert.deepStrictEqual(filled, {
    applied: true,
    text: 'Helm: Champion Headdress;championheaddress.swf',
    fields: { file: 'Champion Headdress', link: 'championheaddress.swf' },
    error: null
  });

  const kept = await handlers.cosmeticGrabSlot({}, 34, 'helm', 'Mine;mine.swf');
  assert.strictEqual(kept.applied, false, 'a value the user typed must survive the link click');

  // A row with no grab link can never be filled from a link click.
  const off = await handlers.cosmeticGrabSlot({}, 34, 'off', '');
  assert.strictEqual(off.applied, false);
  assert.strictEqual(off.error, cosmetics.ERRORS.notGrabbable);

  // Nothing to grab from: reported, not swallowed.
  const nothing = createCosmeticsWindow({
    game: fakeGame({ wear: { wear: null, error: null } })
  });
  const nothingHandlers = handlersFor(nothing);
  assert.deepStrictEqual(await nothingHandlers.cosmeticGrab({}, 34), { rows: [], values: {}, error: null });
  assert.deepStrictEqual(
    await nothingHandlers.cosmeticGrabSlot({}, 34, 'helm', ''),
    { applied: false, text: '', fields: { file: '', link: '' }, error: cosmetics.ERRORS.noWear }
  );
});

// ------------------------------------------------------------------ the list actions

// btnCopyAll_Click equips every row of the list; btnEquipSelected_Click equips the selection.
// Each row carries its own slot code, because a weapon's code is "Weapon" while every other row's
// is its _backMap code.
test('Equip All and Equip Selected set the rows they were given, in order', async () => {
  const game = fakeGame();
  const window = createCosmeticsWindow({ game: game });
  const handlers = handlersFor(window);

  const rows = [
    { row: 'helm', text: 'Helm: Champion Headdress;championheaddress.swf' },
    { row: 'weapon', text: 'Weapon: Blinding Light of Destiny;blod.swf' }
  ];
  assert.deepStrictEqual(await handlers.cosmeticEquip({}, rows), { applied: 2, error: null });
  assert.deepStrictEqual(game.calls, [
    { setSlot: ['he', 'Champion Headdress', 'championheaddress.swf'] },
    { setSlot: ['Weapon', 'Blinding Light of Destiny', 'blod.swf'] }
  ]);
  assert.deepStrictEqual(await handlers.cosmeticEquip({}, []), { applied: 0, error: null });
});

// A refusal stops the run and is reported with how far it got: the reference's async handlers drop
// the failure on the floor, and its list keeps claiming the rows were equipped.
test('a refused equip stops the run and reports what did not go out', async () => {
  const game = fakeGame({
    set: function (code) {
      return code === 'he' ? { ok: false, error: 'locked' } : { ok: true, error: null };
    }
  });
  const window = createCosmeticsWindow({ game: game });
  const handlers = handlersFor(window);
  assert.deepStrictEqual(
    await handlers.cosmeticEquip({}, [
      { row: 'helm', text: 'Helm: A;a.swf' },
      { row: 'cape', text: 'Cape: B;b.swf' }
    ]),
    { applied: 0, error: 'locked' }
  );
  assert.deepStrictEqual(game.calls, [{ setSlot: ['he', 'A', 'a.swf'] }]);
});

// The list is the window's own state, so Remove and Clear All are answered here rather than by the
// page: what actually leaves the list is what the page is told to drop. The reference removes the
// selected rows bottom-up and disposes the whole list, and Clear All also empties every text box.
test('Remove drops the rows it was given and Clear All empties the list and every field', () => {
  const rows = cosmetics.removeRows(
    [
      { row: 'helm', text: 'Helm: A;a.swf' },
      { row: 'cape', text: 'Cape: B;b.swf' },
      { row: 'pet', text: 'Pet: C;c.swf' }
    ],
    [0, 2]
  );
  assert.deepStrictEqual(rows, [{ row: 'cape', text: 'Cape: B;b.swf' }]);
  // Indices outside the list are ignored rather than throwing, as its own loop's bounds do.
  assert.deepStrictEqual(
    cosmetics.removeRows([{ row: 'cape', text: 'Cape: B;b.swf' }], [5, -1]),
    [{ row: 'cape', text: 'Cape: B;b.swf' }]
  );
  // Clear All clears both halves of the reference's own handler.
  assert.deepStrictEqual(cosmetics.cleared(), { rows: [], values: cosmetics.emptyValues() });
});

// ------------------------------------------------------------------ the set files

// A row's list text is what both the reference's list holds and what its store round-trips.
test('a list row text round-trips through the reference\'s own format', () => {
  assert.deepStrictEqual(cosmetics.parseRow('Helm: Champion Headdress;championheaddress.swf'), {
    row: 'helm',
    label: 'Helm',
    file: 'Champion Headdress',
    link: 'championheaddress.swf'
  });
  assert.deepStrictEqual(cosmetics.parseRow('Ground: Moglin;moglin.swf').row, 'misc');
  assert.strictEqual(cosmetics.parseRow(' '), null, 'the reference\'s own separator row');
  assert.strictEqual(cosmetics.parseRow('Nonsense: x'), null);
  assert.strictEqual(cosmetics.parseRow(''), null);
});

// The reference's CosmeticForm save writes 24 fixed lines with File.WriteAllLines - so CRLF, and
// the blank lines are the "\r\n" prefixes of the section labels - and its load reads them back by
// line number, wrapped in a bare catch. A file it wrote must load here.
const REFERENCE_SET_FILE = [
  'Helmet:',
  'he file:Champion Headdress',
  'he link:championheaddress.swf',
  '',
  'Armor:',
  "co file:Void Highlord's Armor",
  'co link:voidhighlord_skin.swf',
  '',
  'Class:',
  'ar file:Void Highlord',
  'ar link:voidhighlord.swf',
  '',
  'Weapon:',
  'Weapon file:Blinding Light of Destiny',
  'Weapon link:blod.swf',
  '',
  'Pet:',
  'pe file:Rogue',
  'pe link:rogue.swf',
  '',
  'Cape:',
  'ba file:ArchPaladin Cape',
  'ba link:archpaladincape.swf',
  '',
  'Off:',
  'off file:Offhand Thing',
  'off link:offhand.swf',
  '',
  'Ground:',
  'mi file:Moglin',
  'mi link:moglin.swf'
].join('\r\n');

test('the reference\'s own 24-line cosmetic file loads into the eight rows', () => {
  const parsed = cosmetics.parseSetFile(REFERENCE_SET_FILE);
  assert.strictEqual(parsed.error, null);
  assert.deepStrictEqual(parsed.values, {
    helm: 'Champion Headdress;championheaddress.swf',
    armor: "Void Highlord's Armor;voidhighlord_skin.swf",
    class: 'Void Highlord;voidhighlord.swf',
    weapon: 'Blinding Light of Destiny;blod.swf',
    off: 'Offhand Thing;offhand.swf',
    pet: 'Rogue;rogue.swf',
    cape: 'ArchPaladin Cape;archpaladincape.swf',
    misc: 'Moglin;moglin.swf'
  });
});

// Its reader is positional, so a file whose blank lines went missing loads into the wrong boxes;
// this reader goes by the label instead, which is the only way both forms load.
test('a cosmetic file with its blank lines stripped still loads by label', () => {
  const stripped = REFERENCE_SET_FILE.split('\r\n')
    .filter(function (line) { return line.trim() !== ''; })
    .join('\n');
  assert.strictEqual(cosmetics.parseSetFile(stripped).values.misc, 'Moglin;moglin.swf');
  // An empty file is no values, not a parse failure: the rows simply start blank.
  assert.deepStrictEqual(cosmetics.parseSetFile(''), {
    values: cosmetics.emptyValues(),
    unknown: [],
    error: null
  });
});

// The ticket asks for the Sets window's own file shape: the .gset document (SetItem over a
// ISetInterface list of Type/Name items) that Grimoire/UI/Set.cs writes. A cosmetic set has eight
// rows and .gset entries carry a Type and a Name, so the row's label is the Type and the rest of
// the row - its "file;link" - is the Name, which is what makes the round trip lossless.
test('a cosmetic set saves in the Sets window\'s file shape, and loads back unchanged', () => {
  const values = {
    helm: 'Champion Headdress;championheaddress.swf',
    armor: '',
    class: 'Void Highlord;voidhighlord.swf',
    weapon: '',
    off: '',
    pet: '',
    cape: '',
    misc: ''
  };
  const text = cosmetics.serializeSet(values);
  const document = JSON.parse(text);
  assert.strictEqual(document.$type, 'Grimoire.UI.SetItem, Grimoire');
  assert.strictEqual(
    document.Set.$type,
    'System.Collections.Generic.List`1[[Grimoire.UI.ISetInterface, Grimoire]], mscorlib'
  );
  // One entry per filled row, in the grid's own order, each as the reference's own Item.
  assert.deepStrictEqual(document.Set.$values, [
    {
      $type: 'Grimoire.UI.Item, Grimoire',
      Type: 'Helm',
      Name: 'Champion Headdress;championheaddress.swf'
    },
    {
      $type: 'Grimoire.UI.Item, Grimoire',
      Type: 'Class',
      Name: 'Void Highlord;voidhighlord.swf'
    }
  ]);
  assert.deepStrictEqual(cosmetics.parseSetFile(text).values, values);

  // A .gset the Sets window wrote for gear names loads too: a Type the grid has no row for is
  // reported rather than dropped into the wrong box.
  const gear = cosmetics.parseSetFile(JSON.stringify({
    $type: 'Grimoire.UI.SetItem, Grimoire',
    Set: {
      $type: 'System.Collections.Generic.List`1[[Grimoire.UI.ISetInterface, Grimoire]], mscorlib',
      $values: [
        { $type: 'Grimoire.UI.Item, Grimoire', Type: 'Weapon', Name: 'Blinding Light of Destiny' },
        { $type: 'Grimoire.UI.Item, Grimoire', Type: 'Cape', Name: 'ArchPaladin Cape' }
      ]
    }
  }));
  assert.strictEqual(gear.error, null);
  assert.strictEqual(gear.values.weapon, 'Blinding Light of Destiny;');
  assert.strictEqual(gear.values.cape, 'ArchPaladin Cape;');
  assert.deepStrictEqual(gear.unknown, []);

  const alien = cosmetics.parseSetFile(JSON.stringify({ Set: { $values: [{ Name: 'x', Type: 'Trinket' }] } }));
  assert.deepStrictEqual(alien.unknown, ['Trinket']);
  assert.deepStrictEqual(cosmetics.parseSetFile('{').error, cosmetics.ERRORS.set);
});

// The one place the two windows' vocabularies differ on the same document: the grid calls the
// ground slot "Misc" and the list calls it "Ground", because that is the reference's own split
// (the designer's label against CosmeticEquipment's EquipType). A .gset the Sets window wrote for
// an item whose category is Misc says "Misc", so both names have to mean the same row.
test('the Misc and Ground names are the same row in a set file, whichever window wrote it', () => {
  const fromSets = cosmetics.parseSetFile(JSON.stringify({
    Set: { $values: [{ $type: 'Grimoire.UI.Item, Grimoire', Type: 'Misc', Name: 'Moglin;moglin.swf' }] }
  }));
  assert.strictEqual(fromSets.error, null);
  assert.strictEqual(fromSets.values.misc, 'Moglin;moglin.swf');
  assert.deepStrictEqual(fromSets.unknown, []);

  // And what this window writes for that row is the list's own word, which the Sets window's
  // reader takes as the Type it stores.
  const written = JSON.parse(cosmetics.serializeSet({ misc: 'Moglin;moglin.swf' }));
  assert.strictEqual(written.Set.$values[0].Type, 'Ground');
  assert.deepStrictEqual(cosmetics.parseSetFile(JSON.stringify(written)).values.misc, 'Moglin;moglin.swf');
});

// The reference's save dialog starts in its Sets/ folder beside the exe and filters *.gset; the
// port starts in the same folder under the app's data directory. A cancelled dialog writes nothing.
test('Save and Load use the reference\'s own dialog shape, and a cancel touches nothing', async () => {
  const seen = [];
  const window = createCosmeticsWindow({
    game: fakeGame(),
    dialogs: {
      save: function (values) {
        seen.push({ save: values });
        return Promise.resolve({ canceled: true });
      },
      open: function () {
        seen.push({ open: true });
        return Promise.resolve({
          canceled: false,
          values: cosmetics.parseSetFile(REFERENCE_SET_FILE).values,
          error: null
        });
      }
    }
  });
  const handlers = handlersFor(window);

  const values = cosmetics.emptyValues();
  values.helm = 'A;a.swf';
  assert.deepStrictEqual(await handlers.cosmeticSave({}, values), { canceled: true });
  assert.deepStrictEqual(seen[0].save, values);

  const opened = await handlers.cosmeticLoad({});
  assert.strictEqual(opened.canceled, false);
  assert.strictEqual(opened.values.helm, 'Champion Headdress;championheaddress.swf');

  // A file that is not a set reports why, rather than clearing the grid.
  const broken = createCosmeticsWindow({
    game: fakeGame(),
    dialogs: {
      save: function () { return Promise.resolve({ canceled: true }); },
      open: function () {
        return Promise.resolve({ canceled: false, values: null, error: cosmetics.ERRORS.set });
      }
    }
  });
  const brokenHandlers = handlersFor(broken);
  const refused = await brokenHandlers.cosmeticLoad({});
  assert.strictEqual(refused.values, null);
  assert.strictEqual(refused.error, cosmetics.ERRORS.set);
});

// CosmeticForm.cs sets only InitialDirectory and Filter: the dialog titles stay at their own
// "Save As"/"Open", and neither dialog suggests a file name.
test('the cosmetic dialogs keep the reference titles and write the 24-line text', async () => {
  const asked = [];
  const written = [];
  const dialogs = createCosmeticsDialogs({
    store: null,
    defaultDirectory: '/sets',
    messages: { filterName: 'Grimoire sets' },
    showOpenDialog: function (owner, options) {
      asked.push({ open: options });
      return Promise.resolve({ canceled: true });
    },
    showSaveDialog: function (owner, options) {
      asked.push({ save: options });
      return Promise.resolve({ canceled: false, filePath: '/sets/mine.gset' });
    },
    writeText: function (file, text) { written.push([file, text]); }
  });

  await dialogs.open();
  const values = cosmetics.emptyValues();
  values.helm = 'A;a.swf';
  await dialogs.save(values);

  assert.strictEqual(asked[0].open.title, 'Open');
  assert.strictEqual(asked[0].open.defaultPath, '/sets');
  assert.deepStrictEqual(asked[0].open.filters,
    [{ name: 'Grimoire sets', extensions: ['gset'] }]);
  assert.strictEqual(asked[1].save.title, 'Save As');
  assert.strictEqual(asked[1].save.defaultPath, '/sets', 'no file name is suggested');

  // Exactly the 24-entry array's text, with the empty boxes written empty - the reference's
  // `?? "None"` never fires because a WinForms TextBox's Text is never null.
  assert.deepStrictEqual(written, [['/sets/mine.gset', cosmetics.serializeSetFile(values)]]);
  assert.ok(written[0][1].indexOf('he file:A\r\nhe link:a.swf\r\n\r\nArmor:') !== -1,
    written[0][1]);
  assert.ok(written[0][1].indexOf('co file:\r\nco link:\r\n') !== -1, written[0][1]);
});

// ------------------------------------------------------------------ the app surface

test('the window is registered in the app\'s own window conventions', async () => {
  const activated = await activateParity();
  const found = activated.host._getState().featureWindows.filter(function (w) {
    return w.id === WINDOW_ID;
  });
  assert.strictEqual(found.length, 1, 'missing feature window ' + WINDOW_ID);
  const config = found[0].config;
  assert.strictEqual(config.webPreferences.sandbox, true);
  assert.strictEqual(config.webPreferences.plugins, false);
  assert.strictEqual(config.webPreferences.contextIsolation, true);
  assert.strictEqual(config.webPreferences.nodeIntegration, false);
  assert.strictEqual(config.useContentSize, true);
  const page = url.fileURLToPath(found[0].url);
  assert.ok(page.indexOf(pluginRoot) === 0, 'the page must live in the plugin');
  assert.ok(fs.existsSync(page), 'missing page file: ' + page);
  const preload = config.webPreferences.preload;
  assert.ok(fs.existsSync(preload), 'missing preload: ' + preload);
  const source = fs.readFileSync(preload, 'utf8');
  assert.ok(source.indexOf("require('electron')") !== -1, 'the preload needs electron');
  assert.strictEqual(source.indexOf("require('../"), -1, 'the preload must stay self-contained');
});

// The reference keeps the window under Tools -> Cosmetics (Root.cs:805-812, "Cosmetics"), bound to
// its own action "Show Cosmetics form" (Hotkeys.cs:409). Its picker takes one key, and this plugin
// binds its own key rather than taking one the app or the game plugin already uses.
test('the menu opens the Cosmetics window and the reference\'s action can be bound to a key', async () => {
  const opened = [];
  const activated = await activateParity({
    openFeatureWindow: function (id) { opened.push(id); return {}; }
  });
  const state = activated.host._getState();
  const items = state.menus
    .map(function (contributor) {
      return contributor({ labels: { grimliteMenu: 'Grimlite' }, keybinds: {} });
    })
    .reduce(function (all, group) { return all.concat(group); }, [])
    .filter(function (menu) { return menu.label === 'Grimlite'; })[0]
    .submenu;

  const entry = items.filter(function (item) { return item.label === 'Cosmetics'; })[0];
  assert.ok(entry, 'the Grimlite menu must carry the reference\'s own word: ' +
    items.map(function (item) { return item.label; }).join(', '));
  entry.click();
  assert.deepStrictEqual(opened, [WINDOW_ID]);

  const binding = state.keybinds.filter(function (k) { return k.id === 'grimliteCosmetics'; });
  assert.strictEqual(binding.length, 1, 'Cosmetics needs its own keybind');
  binding[0].action();
  assert.deepStrictEqual(opened, [WINDOW_ID, WINDOW_ID]);
  assert.strictEqual(state.keybindDefaults.grimliteCosmetics, undefined,
    'Grimlite ships no default hotkeys');
  // Every menu entry this plugin contributes opens a window it registered, and nothing else.
  const registeredIds = state.featureWindows.map(function (w) { return w.id; });
  items.forEach(function (item) {
    opened.length = 0;
    item.click();
    opened.forEach(function (id) {
      assert.ok(registeredIds.indexOf(id) !== -1, item.label + ' opened an unregistered window: ' + id);
    });
  });
});

// A call a page makes that its preload does not expose is a button that does nothing, silently, so
// both halves are checked against each other as the plain text they are (#25's own check).
test('the page is the reference\'s own layout and calls only what its preload exposes', () => {
  const html = fs.readFileSync(path.join(featureDir, 'cosmetics.html'), 'utf8');
  const preload = fs.readFileSync(path.join(featureDir, 'preload_cosmetics.js'), 'utf8');

  const bound = html.match(/([A-Za-z0-9_]+)\s*=\s*window\.aquastarCosmetics/);
  assert.ok(bound, 'the page must bind window.aquastarCosmetics');
  const called = (html.match(new RegExp('\\b' + bound[1] + '\\.([A-Za-z0-9_]+)\\(', 'g')) || []).map(
    function (hit) { return hit.slice(bound[1].length + 1, -1); }
  );
  assert.ok(called.length > 0, 'the page never uses its bridge');
  const exposed = (preload.match(/^\s*([A-Za-z0-9_]+): function/gm) || []).map(function (line) {
    return line.trim().split(':')[0];
  });
  called.forEach(function (name) {
    assert.ok(exposed.indexOf(name) !== -1, 'the preload does not expose ' + name);
  });

  // Every row of the reference's grid, and every control its designer lays out.
  cosmetics.ROWS.forEach(function (row) {
    ['file', 'link', 'set'].forEach(function (part) {
      assert.ok(html.indexOf(part + '-' + row.id) !== -1, 'the page has no ' + part + '-' + row.id);
    });
  });
  cosmetics.GRAB_LINKS.forEach(function (link) {
    assert.ok(html.indexOf('grab-' + link.row) !== -1, 'the page has no grab link for ' + link.row);
  });
  ['players', 'refresh', 'grab', 'items', 'equipAll', 'equipSelected', 'clearAll', 'remove', 'save', 'load', 'status']
    .forEach(function (id) {
      assert.ok(html.indexOf('id="' + id + '"') !== -1, 'the page has no #' + id);
    });
  assert.ok(html.indexOf('res/features/common/focus.css') !== -1, 'needs the shared focus style');
  // A per-slot Grab appends its row to the list; Enter fills from the selection; Shift extends
  // the selection like SelectionMode.MultiExtended; Refresh always selects the first player.
  assert.ok(html.indexOf('result.text') !== -1, 'a per-slot grab must append its row');
  assert.ok(html.indexOf("event.key === 'Enter'") !== -1, 'Enter must fill from the selection');
  assert.ok(html.indexOf('event.shiftKey') !== -1, 'Shift must extend the selection');
  assert.strictEqual(/var keep = list\.filter/.test(html), false,
    'Refresh must not preserve the previous player');
  // A page whose inline script does not parse loads as a blank window; check it as JavaScript.
  const blocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
  assert.ok(blocks.length > 0, 'the page has no inline script');
  blocks.forEach(function (block) {
    const source = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    assert.doesNotThrow(function () { new vm.Script(source); }, 'the inline script does not parse');
  });
});

// Nothing here loads Flash or needs a permission the manifest does not declare: it is a page beside
// the game, like the reference's own form. The Host throws for a call whose permission is missing,
// so activating at all is that check.
test('the cosmetics window needs no permission the manifest does not declare', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  assert.strictEqual(manifest.permissions.indexOf('unsafe-renderer'), -1);
  assert.ok(manifest.permissions.indexOf('game-bridge') !== -1, 'the window reads the game through the bridge');
  const activated = await activateParity();
  assert.strictEqual(activated.host._getState().featureWindows.filter(function (w) {
    return w.id === WINDOW_ID;
  }).length, 1);
});
