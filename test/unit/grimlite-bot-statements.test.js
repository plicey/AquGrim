// The statements that read game state (ticket #41). Expected behaviour comes from the reference's
// own classes, one at a time - Grimoire/Botting/Commands/Misc/Statements/*.cs - and from the
// helper bodies in its own loader (/var/tmp/aq48/out-loader/scripts/grimoire/game/*.as, see
// loader-surface.js). Several of these classes compare in a direction their own row text does not
// state (gold, level, monster HP, the player counts), and the item statements run a second,
// name-based branch after an id-based one, which is why an id never reads as a hit there. Those are
// reproduced rather than tidied: a bot in the wild was written against what the code does.
//
// The statements run through the real engine, the way a bot does: the engine is handed an injected
// session (spec #19, Seam 4), so a statement and the command under it are asserted without Flash
// and without a window.
const assert = require('assert');

const engineModel = require('../../plugins/grimlite-parity/bot/engine.js');
const statements = require('../../plugins/grimlite-parity/bot/statements.js');
const sessionModel = require('../../plugins/grimlite-parity/bot/session.js');
const surface = require('../../plugins/grimlite-parity/loader-surface.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');

// The class names this ticket owns. Two of the player-HP rows are named after the class the
// reference declares - CmdPlayersHPGreaterThan / CmdPlayersHPLessThan, which is what a .gbot's
// $type carries - rather than after the file they sit in upstream.
const OWNED = [
  'CmdCellIs', 'CmdCellIsNot', 'CmdMapIs', 'CmdMapIsNot',
  'CmdEquipped', 'CmdNotEquipped', 'CmdItemPickupable', 'CmdItemNotPickupable',
  'CmdInInventory', 'CmdNotInInventory', 'CmdInTemp', 'CmdNotInTemp', 'CmdInBank', 'CmdNotInBank',
  'CmdInBankOrInvent', 'CmdNotInBankAndInvent', 'CmdIsMaxStack', 'CmdIsNotMaxStack', 'CmdListInInv',
  'CmdQuestAvailable', 'CmdQuestNotAvailable', 'CmdQuestInProgress', 'CmdQuestNotInProgress',
  'CmdQuestCompleted', 'CmdQuestNotCompleted',
  'CmdGoldGreaterThan', 'CmdGoldLessThan', 'CmdLevelIs', 'CmdLevelGreaterThan', 'CmdLevelLessThan',
  'CmdHealthGreaterThan', 'CmdHealthLessThan', 'CmdManaGreaterThan', 'CmdManaLessThan',
  'CmdPlayersHPGreaterThan', 'CmdPlayersHPLessThan',
  'CmdIsMember', 'CmdIsNotMember', 'CmdFactionRankGreaterThan', 'CmdFactionRankLessThan',
  'CmdInHouse', 'CmdNotInHouse',
  'CmdPlayerInRoom', 'CmdPlayerNotInRoom', 'CmdPlayerIsInCell', 'CmdPlayerIsNotInCell',
  'CmdPlayerIsInMyCell', 'CmdPlayerIsNotInMyCell', 'CmdPlayersGreaterThan', 'CmdPlayersLessThan',
  'CmdPlayerInMyCellGreaterThan', 'CmdPlayerInMyCellLessThan', 'CmdNameEquals',
  'CmdMonsterInRoom', 'CmdMonsterNotInRoom', 'CmdMonsterHealthGreaterThan',
  'CmdMonsterHealthLessThan', 'CmdMonstersGreaterThan', 'CmdMonstersLessThan'
];

// The reads the session answers, as this ticket widened it (#41). A read a test did not set is a
// refusal too, so a statement that asks for the wrong one is caught rather than answered with
// undefined.
const READS = [
  'cell', 'map', 'gold', 'level', 'isMember', 'health', 'healthMax', 'mana', 'manaMax',
  'playerHealthPercentage', 'inventory', 'bank', 'tempInventory', 'house', 'factions',
  'playersInMap', 'playerInCell', 'playerInMyCell', 'questAvailable', 'questInProgress',
  'questCanComplete', 'monsterInRoom', 'monsterByMonMapId', 'monsterHealth', 'visibleMonsters',
  'dropStack'
];

// A game that answers what the test set. A value is the answer, an Error is a refusal (which is how
// a read that cannot be established reaches a statement), a function is computed from its args.
function fakeSession(answers) {
  const given = Object.assign({
    signedIn: true, alive: true, ready: true, username: 'Tester',
    health: 100, healthMax: 100, mana: 100, manaMax: 100
  }, answers || {});
  const asked = [];
  const session = { asked: asked, given: given };
  function reader(name) {
    return function () {
      asked.push({ name: name, args: Array.prototype.slice.call(arguments) });
      const answer = given[name];
      if (answer instanceof Error) return Promise.reject(answer);
      if (typeof answer === 'function') return Promise.resolve(answer(Array.prototype.slice.call(arguments)));
      return Promise.resolve(answer);
    };
  }
  Object.keys(given).forEach(function (name) { session[name] = reader(name); });
  READS.filter(function (name) { return !(name in given); }).forEach(function (name) {
    session[name] = function () {
      asked.push({ name: name, args: Array.prototype.slice.call(arguments) });
      return Promise.reject(new Error('this fake session does not answer ' + name));
    };
  });
  return session;
}

function command(className, properties) {
  return catalog.makeCommand(className, properties);
}

// The engine as the plugin builds it, with pacing collapsed.
function engine(session) {
  const records = [];
  const made = engineModel.createEngine({
    session: session,
    sleep: function () { return Promise.resolve(); },
    log: function (line) { records.push(line); }
  });
  made.records = records;
  return made;
}

// One statement over a three-command list, one tick in. What the statement did is the index: 1 is
// "it held, the command under it is next", 2 is "it did not hold, that command was skipped" - the
// reference's own Index++ for a statement that does not hold.
async function after(session, statement, extra) {
  const made = engine(session);
  const bot = Object.assign({
    Commands: [statement, command('CmdBlank2', {}), command('CmdBlank3', {})]
  }, extra || {});
  const started = await made.start(bot);
  assert.strictEqual(started.ok, true, started.error);
  await made.tick();
  return made;
}

async function holds(session, statement) {
  const made = await after(session, statement);
  return made.index() === 1;
}

function logs(made, pattern, className) {
  return made.records.some(function (line) {
    return line.indexOf(className) !== -1 && pattern.test(line);
  });
}

const SWORD = { ItemID: 1, sName: 'Rusty Sword', sType: 'Sword', iQty: 3, iStk: 10, bEquip: 0 };
const CAPE = { ItemID: 2, sName: 'Worn Cape', sType: 'Cape', iQty: 1, iStk: 5, bEquip: 1 };
const POTION = { ItemID: 3, sName: 'Treasure Potion', sType: 'Item', iQty: 5, iStk: 5, bEquip: 0 };

test('cell and map statements compare the loader own values, ignoring case', async () => {
  // CmdCellIs: "!(value).EqualsIgnoreCase(Player.Cell)" -> Index++ when it does not match, so it
  // holds on a match.
  assert.strictEqual(await holds(fakeSession({ cell: 'yulgar' }),
    catalog.makeStatement('CmdCellIs', 'yulgar')), true);
  assert.strictEqual(await holds(fakeSession({ cell: 'yulgar' }),
    catalog.makeStatement('CmdCellIs', 'YULGAR')), true, 'the reference compares ignoring case');
  assert.strictEqual(await holds(fakeSession({ cell: 'yulgar' }),
    catalog.makeStatement('CmdCellIs', 'battleon')), false);

  assert.strictEqual(await holds(fakeSession({ cell: 'yulgar' }),
    catalog.makeStatement('CmdCellIsNot', 'yulgar')), false);
  assert.strictEqual(await holds(fakeSession({ cell: 'yulgar' }),
    catalog.makeStatement('CmdCellIsNot', 'battleon')), true);

  // CmdMapIs: a value carrying a "-" is compared on what is before it, so "yulgar-1" is map yulgar.
  assert.strictEqual(await holds(fakeSession({ map: 'yulgar' }),
    catalog.makeStatement('CmdMapIs', 'yulgar-1')), true);
  assert.strictEqual(await holds(fakeSession({ map: 'yulgar' }),
    catalog.makeStatement('CmdMapIs', 'yulgar')), true);
  assert.strictEqual(await holds(fakeSession({ map: 'yulgar' }),
    catalog.makeStatement('CmdMapIs', 'battleon')), false);
  assert.strictEqual(await holds(fakeSession({ map: 'yulgar' }),
    catalog.makeStatement('CmdMapIsNot', 'yulgar-1')), false);
  assert.strictEqual(await holds(fakeSession({ map: 'yulgar' }),
    catalog.makeStatement('CmdMapIsNot', 'battleon')), true);
});

test('a value written as a variable is resolved before it is compared', async () => {
  // An [unset] key is left as written by ResolveVars, so it matches no cell.
  assert.strictEqual(await holds(fakeSession({ cell: 'battleon' }),
    catalog.makeStatement('CmdCellIs', '[wanted]')), false);

  const made = engine(fakeSession({ cell: 'battleon' }));
  await made.start({
    Commands: [
      catalog.makeStatement('CmdSetVar', 'wanted', 'battleon'),
      catalog.makeStatement('CmdCellIs', '[wanted]'),
      command('CmdBlank2', {})
    ]
  });
  await made.tick();
  await made.tick();
  assert.strictEqual(made.index(), 2, 'the variable the first command set is what the statement compared');
});

test('equipped statements read the item own bEquip flag', async () => {
  const inventory = [SWORD, CAPE];
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdEquipped', 'Worn Cape')), true);
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdEquipped', 'worn cape')), true, 'the name match ignores case');
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdEquipped', 'Rusty Sword')), false);
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdEquipped', 'Not Carried')), false);
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdNotEquipped', 'Rusty Sword')), true);
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdNotEquipped', 'Worn Cape')), false);
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdNotEquipped', 'Not Carried')), true);
});

test('inventory statements compare the name and the quantity the way ContainsItem does', async () => {
  const inventory = [SWORD, POTION];
  function has(name, qty) {
    return holds(fakeSession({ inventory: inventory }),
      catalog.makeStatement('CmdInInventory', name, qty));
  }
  assert.strictEqual(await has('Rusty Sword', '2'), true, '3 in the stack is at least 2');
  assert.strictEqual(await has('Rusty Sword', '3'), true);
  assert.strictEqual(await has('Rusty Sword', '4'), false);
  // An empty quantity is int.TryParse's false, which the reference answers with a bare yes.
  assert.strictEqual(await has('Rusty Sword', ''), true);
  // "*" is int.TryParse's false as well, so it is the same bare yes rather than a quantity.
  assert.strictEqual(await has('Rusty Sword', '*'), true);
  assert.strictEqual(await has('Nothing At All', '*'), false);

  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdNotInInventory', 'Nothing At All', '*')), true);
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdNotInInventory', 'Rusty Sword', '4')), true,
    'not enough in the stack is not in the inventory');
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdNotInInventory', 'Rusty Sword', '3')), false);
});

test('an item field holding an id still goes through the name branch, which is what the reference does', async () => {
  // CmdInInventory's own body: when both fields parse as ints it checks ContainsItem(id, qty) and
  // then - whichever way that went - checks ContainsItem(name, qty) as well. A name that is a
  // number matches no item, so the second branch decides and an id never reads as a hit.
  const inventory = [SWORD];
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdInInventory', '1', '3')), false,
    'item id 1 with 3 in the stack: the reference skips anyway, on its own name branch');

  // CmdNotInInventory's body skips on the id branch before the name branch is reached.
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdNotInInventory', '1', '3')), false);
  assert.strictEqual(await holds(fakeSession({ inventory: inventory }),
    catalog.makeStatement('CmdNotInInventory', '1', '9')), true,
    'the id branch missed and the name branch missed too, so it is not in the inventory');
});

test('the quantity is compared at the item own stack, as Auto Correct does', async () => {
  // ClientConfig.AutoCorrect reads the Bot Manager's own "Auto Correct Quantity" tick, which the
  // reference's designer ships checked: a quantity above the item's own stack is compared at the
  // stack. POTION stacks to 5 and holds 5, so a request for 9 is satisfied by the reference.
  assert.strictEqual(await holds(fakeSession({ inventory: [POTION] }),
    catalog.makeStatement('CmdInInventory', 'Treasure Potion', '9')), true);

  // A Class is the one category the reference does not clamp, so the same request fails there.
  const classItem = { ItemID: 4, sName: 'Warrior', sType: 'Class', iQty: 5, iStk: 5 };
  assert.strictEqual(await holds(fakeSession({ inventory: [classItem] }),
    catalog.makeStatement('CmdInInventory', 'Warrior', '9')), false);

  // The reference's bank has no such correction: it compares what was asked for, verbatim.
  assert.strictEqual(await holds(fakeSession({ bank: [POTION] }),
    catalog.makeStatement('CmdInBank', 'Treasure Potion', '9')), false);
  // The temp inventory does have it.
  assert.strictEqual(await holds(fakeSession({ tempInventory: [POTION] }),
    catalog.makeStatement('CmdInTemp', 'Treasure Potion', '9')), true);
});

test('temp inventory and bank statements compare their own lists', async () => {
  const temp = [{ ItemID: 7, sName: 'Napalm', iQty: 2, iStk: 20 }];
  assert.strictEqual(await holds(fakeSession({ tempInventory: temp }),
    catalog.makeStatement('CmdInTemp', 'Napalm', '2')), true);
  assert.strictEqual(await holds(fakeSession({ tempInventory: temp }),
    catalog.makeStatement('CmdInTemp', 'Napalm', '3')), false);
  assert.strictEqual(await holds(fakeSession({ tempInventory: temp }),
    catalog.makeStatement('CmdNotInTemp', 'Napalm', '3')), true);
  assert.strictEqual(await holds(fakeSession({ tempInventory: temp }),
    catalog.makeStatement('CmdNotInTemp', 'Napalm', '2')), false);

  const bank = [{ ItemID: 8, sName: 'Iron Ore', iQty: 40, iStk: 100 }];
  assert.strictEqual(await holds(fakeSession({ bank: bank }),
    catalog.makeStatement('CmdInBank', 'Iron Ore', '40')), true);
  assert.strictEqual(await holds(fakeSession({ bank: bank }),
    catalog.makeStatement('CmdInBank', 'Iron Ore', '*')), true,
    'the reference own bank check treats a quantity it cannot parse as any');
  assert.strictEqual(await holds(fakeSession({ bank: bank }),
    catalog.makeStatement('CmdInBank', 'Iron Ore', '41')), false);
  assert.strictEqual(await holds(fakeSession({ bank: bank }),
    catalog.makeStatement('CmdNotInBank', 'Iron Ore', '41')), true);
  assert.strictEqual(await holds(fakeSession({ bank: bank }),
    catalog.makeStatement('CmdNotInBank', 'Iron Ore', '*')), false);
});

test('the bank-or-inventory pair asks both lists, as the reference asks them', async () => {
  const inventory = [SWORD];
  const bank = [{ ItemID: 9, sName: 'Banked Blade', iQty: 1, iStk: 1 }];
  const both = { inventory: inventory, bank: bank };

  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdInBankOrInvent', 'Banked Blade', '1')), true);
  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdInBankOrInvent', 'Rusty Sword', '1')), true);
  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdInBankOrInvent', 'Nothing', '1')), false);

  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdNotInBankAndInvent', 'Nothing', '1')), true);
  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdNotInBankAndInvent', 'Banked Blade', '1')), false);
  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdNotInBankAndInvent', 'Rusty Sword', '1')), false);

  // Both id fields parse, so both lists are asked by ItemID instead of by name.
  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdInBankOrInvent', '9', '1')), true);
  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdNotInBankAndInvent', '9', '1')), false);
  assert.strictEqual(await holds(fakeSession(both),
    catalog.makeStatement('CmdInBankOrInvent', '99', '1')), false);
});

test('max-stack statements compare the quantity against the item own stack', async () => {
  assert.strictEqual(await holds(fakeSession({ inventory: [POTION] }),
    catalog.makeStatement('CmdIsMaxStack', 'Treasure Potion')), true, '5 of 5 is maxed');
  assert.strictEqual(await holds(fakeSession({ inventory: [SWORD] }),
    catalog.makeStatement('CmdIsMaxStack', 'Rusty Sword')), false);
  assert.strictEqual(await holds(fakeSession({ inventory: [SWORD] }),
    catalog.makeStatement('CmdIsMaxStack', 'Nothing')), false, 'an item not carried is not maxed');
  assert.strictEqual(await holds(fakeSession({ inventory: [SWORD] }),
    catalog.makeStatement('CmdIsNotMaxStack', 'Rusty Sword')), true);
  assert.strictEqual(await holds(fakeSession({ inventory: [POTION] }),
    catalog.makeStatement('CmdIsNotMaxStack', 'Treasure Potion')), false);
  assert.strictEqual(await holds(fakeSession({ inventory: [SWORD] }),
    catalog.makeStatement('CmdIsNotMaxStack', 'Nothing')), true);
});

test('the list statement checks the running bot own Items list, which is what the reference reads', async () => {
  const held = await after(fakeSession({ inventory: [SWORD, CAPE] }),
    catalog.makeStatement('CmdListInInv'), { Items: ['Rusty Sword', 'Worn Cape'] });
  assert.strictEqual(held.index(), 1, 'both items are carried, so the statement holds');

  const missing = await after(fakeSession({ inventory: [SWORD] }),
    catalog.makeStatement('CmdListInInv'), { Items: ['Rusty Sword', 'Worn Cape'] });
  assert.strictEqual(missing.index(), 2, 'one of the two is not carried, so it skips');

  // TrueForAll on an empty list is true: the reference holds, so it holds here.
  const empty = await after(fakeSession({ inventory: [] }),
    catalog.makeStatement('CmdListInInv'), { Items: [] });
  assert.strictEqual(empty.index(), 1);
});

test('quest statements ask the loader own names, with the quest id as its text', async () => {
  const session = fakeSession({ questAvailable: true, questInProgress: false });
  assert.strictEqual(await holds(session, catalog.makeStatement('CmdQuestAvailable', '102')), true);
  assert.strictEqual(await holds(session, catalog.makeStatement('CmdQuestInProgress', '102')), false);
  assert.deepStrictEqual(session.asked[session.asked.length - 1],
    { name: 'questInProgress', args: ['102'] }, 'the loader takes the quest id as text');

  assert.strictEqual(await holds(fakeSession({ questAvailable: true }),
    catalog.makeStatement('CmdQuestNotAvailable', '102')), false);
  assert.strictEqual(await holds(fakeSession({ questAvailable: false }),
    catalog.makeStatement('CmdQuestNotAvailable', '102')), true);
  assert.strictEqual(await holds(fakeSession({ questInProgress: true }),
    catalog.makeStatement('CmdQuestInProgress', '102')), true);
  assert.strictEqual(await holds(fakeSession({ questInProgress: true }),
    catalog.makeStatement('CmdQuestNotInProgress', '102')), false);
  assert.strictEqual(await holds(fakeSession({ questInProgress: false }),
    catalog.makeStatement('CmdQuestNotInProgress', '102')), true);

  // "can be turned in" is CanComplete, which the surface refuses until #39 lands: the statement
  // reports that rather than answering a made-up yes.
  const cantTell = fakeSession({
    questCanComplete: new Error('CanComplete is not implemented: quests are ticket #39')
  });
  const made = await after(cantTell, catalog.makeStatement('CmdQuestCompleted', '102'));
  assert.strictEqual(made.index(), 2);
  assert.ok(logs(made, /cannot be evaluated/, 'CmdQuestCompleted'), made.records.join('|'));

  assert.strictEqual(await holds(fakeSession({ questCanComplete: true }),
    catalog.makeStatement('CmdQuestCompleted', '102')), true);
  assert.strictEqual(await holds(fakeSession({ questCanComplete: true }),
    catalog.makeStatement('CmdQuestNotCompleted', '102')), false);
  assert.strictEqual(await holds(fakeSession({ questCanComplete: false }),
    catalog.makeStatement('CmdQuestNotCompleted', '102')), true);
});

test('a quest id that is not a number is reported rather than compared', async () => {
  const made = await after(fakeSession({ questAvailable: true }),
    catalog.makeStatement('CmdQuestAvailable', '[q]'));
  assert.strictEqual(made.index(), 2);
  assert.ok(logs(made, /cannot be evaluated/, 'CmdQuestAvailable'), made.records.join('|'));
});

test('gold, level and mana compare in the direction the reference compares them', async () => {
  // CmdGoldGreaterThan skips on "Gold <= value", so it holds on strictly greater.
  assert.strictEqual(await holds(fakeSession({ gold: 101 }),
    catalog.makeStatement('CmdGoldGreaterThan', '100')), true);
  assert.strictEqual(await holds(fakeSession({ gold: 100 }),
    catalog.makeStatement('CmdGoldGreaterThan', '100')), false);
  // CmdGoldLessThan skips on "Gold >= value", so it holds on strictly less.
  assert.strictEqual(await holds(fakeSession({ gold: 99 }),
    catalog.makeStatement('CmdGoldLessThan', '100')), true);
  assert.strictEqual(await holds(fakeSession({ gold: 100 }),
    catalog.makeStatement('CmdGoldLessThan', '100')), false);

  assert.strictEqual(await holds(fakeSession({ level: 50 }),
    catalog.makeStatement('CmdLevelIs', '50')), true);
  assert.strictEqual(await holds(fakeSession({ level: 51 }),
    catalog.makeStatement('CmdLevelIs', '50')), false);
  // CmdLevelGreaterThan skips on "Level < value": the bound is inclusive, not strict.
  assert.strictEqual(await holds(fakeSession({ level: 50 }),
    catalog.makeStatement('CmdLevelGreaterThan', '50')), true);
  assert.strictEqual(await holds(fakeSession({ level: 49 }),
    catalog.makeStatement('CmdLevelGreaterThan', '50')), false);
  // CmdLevelLessThan skips on "Level >= value", so it holds on strictly less.
  assert.strictEqual(await holds(fakeSession({ level: 49 }),
    catalog.makeStatement('CmdLevelLessThan', '50')), true);
  assert.strictEqual(await holds(fakeSession({ level: 50 }),
    catalog.makeStatement('CmdLevelLessThan', '50')), false);

  assert.strictEqual(await holds(fakeSession({ mana: 60 }),
    catalog.makeStatement('CmdManaGreaterThan', '59')), true);
  assert.strictEqual(await holds(fakeSession({ mana: 59 }),
    catalog.makeStatement('CmdManaGreaterThan', '59')), false);
  assert.strictEqual(await holds(fakeSession({ mana: 58 }),
    catalog.makeStatement('CmdManaLessThan', '59')), true);
  assert.strictEqual(await holds(fakeSession({ mana: 59 }),
    catalog.makeStatement('CmdManaLessThan', '59')), false);
});

test('a gold, level or mana value that is not a number is reported, not guessed at', async () => {
  const made = await after(fakeSession({ gold: 5 }), catalog.makeStatement('CmdGoldGreaterThan', 'lots'));
  assert.strictEqual(made.index(), 2);
  assert.ok(logs(made, /cannot be evaluated/, 'CmdGoldGreaterThan'), made.records.join('|'));

  const level = await after(fakeSession({ level: 5 }), catalog.makeStatement('CmdLevelIs', '[lvl]'));
  assert.strictEqual(level.index(), 2);
  assert.ok(logs(level, /cannot be evaluated/, 'CmdLevelIs'), level.records.join('|'));

  const mana = await after(fakeSession({ mana: 5, manaMax: 0 }),
    catalog.makeStatement('CmdManaGreaterThan', '1'));
  assert.strictEqual(mana.index(), 1, 'the value parses, so the read is what decides');
});

test('health statements compare the absolute value, and a percent against the truncated percent', async () => {
  function health(hp, healthMax, value, className) {
    return holds(fakeSession({ health: hp, healthMax: healthMax }),
      catalog.makeStatement(className || 'CmdHealthGreaterThan', value));
  }
  assert.strictEqual(await health(101, 200, '100'), true);
  assert.strictEqual(await health(100, 200, '100'), false);

  // 1 of 3 is 33.33%, and the reference's own "(hp * 100) / HealthMax" is an int division, so the
  // percent it compares is 33 - not 33.33 and not 34.
  assert.strictEqual(await health(1, 3, '33%'), false, '33 is not above 33');
  assert.strictEqual(await health(1, 3, '32%'), true);
  assert.strictEqual(await health(2, 3, '66%', 'CmdHealthLessThan'), true,
    '2 of 3 is 66, which is at most 66');
  assert.strictEqual(await health(2, 3, '65%', 'CmdHealthLessThan'), false, '66 is not at most 65');
  assert.strictEqual(await health(99, 100, '100', 'CmdHealthLessThan'), true);
  // The reference's own "skips when playerHP > value", so an equal reading holds.
  assert.strictEqual(await health(100, 100, '100', 'CmdHealthLessThan'), true);

  // A percent against a maximum of zero is the reference's own divide: reported rather than read as
  // a hundred.
  const made = await after(fakeSession({ health: 0, healthMax: 0 }),
    catalog.makeStatement('CmdHealthGreaterThan', '10%'));
  assert.strictEqual(made.index(), 2);
  assert.ok(logs(made, /cannot be evaluated/, 'CmdHealthGreaterThan'), made.records.join('|'));

  // A comparison value that is not a number at all is the same report.
  const bad = await after(fakeSession({ health: 50, healthMax: 100 }),
    catalog.makeStatement('CmdHealthGreaterThan', 'half'));
  assert.strictEqual(bad.index(), 2);
  assert.ok(logs(bad, /cannot be evaluated/, 'CmdHealthGreaterThan'), bad.records.join('|'));

  // A Trailing "%" on its own is int.Parse's throw upstream, and the same report here.
  const percentOnly = await after(fakeSession({ health: 50, healthMax: 100 }),
    catalog.makeStatement('CmdHealthGreaterThan', '%'));
  assert.strictEqual(percentOnly.index(), 2);
});

test('another player own health is compared as the percentage the loader answers', async () => {
  const session = fakeSession({ playerHealthPercentage: 42 });
  assert.strictEqual(await holds(session, catalog.makeStatement('CmdPlayersHPGreaterThan', 'Bob', '40')), true);
  assert.strictEqual(await holds(session, catalog.makeStatement('CmdPlayersHPGreaterThan', 'Bob', '42')), false);
  assert.strictEqual(await holds(session, catalog.makeStatement('CmdPlayersHPLessThan', 'Bob', '43')), true);
  assert.strictEqual(await holds(session, catalog.makeStatement('CmdPlayersHPLessThan', 'Bob', '42')), false);
  assert.deepStrictEqual(session.asked[session.asked.length - 1],
    { name: 'playerHealthPercentage', args: ['Bob'] }, 'the loader takes the player name');

  // The loader own default for a player it does not find is 100, and the statement compares that.
  assert.strictEqual(await holds(fakeSession({ playerHealthPercentage: 100 }),
    catalog.makeStatement('CmdPlayersHPGreaterThan', 'Absent', '99')), true);

  const bad = await after(fakeSession({ playerHealthPercentage: 50 }),
    catalog.makeStatement('CmdPlayersHPGreaterThan', 'Bob', 'half'));
  assert.strictEqual(bad.index(), 2);
  assert.ok(logs(bad, /cannot be evaluated/, 'CmdPlayersHPGreaterThan'), bad.records.join('|'));
});

test('member, faction and house statements read their own fields', async () => {
  assert.strictEqual(await holds(fakeSession({ isMember: true }), catalog.makeStatement('CmdIsMember')), true);
  assert.strictEqual(await holds(fakeSession({ isMember: false }), catalog.makeStatement('CmdIsMember')), false);
  assert.strictEqual(await holds(fakeSession({ isMember: false }), catalog.makeStatement('CmdIsNotMember')), true);
  assert.strictEqual(await holds(fakeSession({ isMember: true }), catalog.makeStatement('CmdIsNotMember')), false);

  // The game keys myAvatar.factions by faction id and the reference own Faction class reads sName
  // and iRank out of the entries (Grimoire/Game/Data/Faction.cs).
  const factions = {
    1: { FactionID: 1, sName: 'Good', iRank: 5 },
    2: { FactionID: 2, sName: 'Evil', iRank: 1 }
  };
  assert.strictEqual(await holds(fakeSession({ factions: factions }),
    catalog.makeStatement('CmdFactionRankGreaterThan', 'good', '4')), true);
  assert.strictEqual(await holds(fakeSession({ factions: factions }),
    catalog.makeStatement('CmdFactionRankGreaterThan', 'Good', '5')), true, 'the bound is inclusive');
  assert.strictEqual(await holds(fakeSession({ factions: factions }),
    catalog.makeStatement('CmdFactionRankGreaterThan', 'Good', '6')), false);
  assert.strictEqual(await holds(fakeSession({ factions: factions }),
    catalog.makeStatement('CmdFactionRankLessThan', 'Evil', '1')), false);
  assert.strictEqual(await holds(fakeSession({ factions: factions }),
    catalog.makeStatement('CmdFactionRankLessThan', 'Evil', '2')), true);
  // A faction the player has no rank in is the reference own "?? new Faction()", rank 0.
  assert.strictEqual(await holds(fakeSession({ factions: factions }),
    catalog.makeStatement('CmdFactionRankGreaterThan', 'Unknown', '0')), true);
  assert.strictEqual(await holds(fakeSession({ factions: factions }),
    catalog.makeStatement('CmdFactionRankGreaterThan', 'Unknown', '1')), false);

  const house = [{ ItemID: 11, sName: 'Cozy Chair', iQty: 2, iStk: 9 }];
  assert.strictEqual(await holds(fakeSession({ house: house }),
    catalog.makeStatement('CmdInHouse', 'Cozy Chair', '2')), true);
  assert.strictEqual(await holds(fakeSession({ house: house }),
    catalog.makeStatement('CmdInHouse', 'Cozy Chair', '3')), false);
  assert.strictEqual(await holds(fakeSession({ house: house }),
    catalog.makeStatement('CmdInHouse', 'Cozy Chair', '*')), true);
  assert.strictEqual(await holds(fakeSession({ house: house }),
    catalog.makeStatement('CmdNotInHouse', 'Cozy Chair', '3')), true);
  assert.strictEqual(await holds(fakeSession({ house: house }),
    catalog.makeStatement('CmdNotInHouse', 'Cozy Chair', '*')), false);
});

test('a house quantity that is neither a number nor a star is reported', async () => {
  // The reference own house check is int.Parse, which throws on anything else; here it is a report.
  const made = await after(fakeSession({ house: [{ ItemID: 11, sName: 'Cozy Chair', iQty: 2 }] }),
    catalog.makeStatement('CmdInHouse', 'Cozy Chair', 'some'));
  assert.strictEqual(made.index(), 2);
  assert.ok(logs(made, /cannot be evaluated/, 'CmdInHouse'), made.records.join('|'));
});

test('player-in-room and player-in-cell statements ask the loader own helpers', async () => {
  const players = ['Bob', 'Alice'];
  assert.strictEqual(await holds(fakeSession({ playersInMap: players }),
    catalog.makeStatement('CmdPlayerInRoom', 'bob')), true);
  assert.strictEqual(await holds(fakeSession({ playersInMap: players }),
    catalog.makeStatement('CmdPlayerInRoom', 'Carl')), false);
  assert.strictEqual(await holds(fakeSession({ playersInMap: players }),
    catalog.makeStatement('CmdPlayerNotInRoom', 'Carl')), true);
  assert.strictEqual(await holds(fakeSession({ playersInMap: players }),
    catalog.makeStatement('CmdPlayerNotInRoom', 'Bob')), false);

  const cellSession = fakeSession({ playerInCell: true });
  assert.strictEqual(await holds(cellSession, catalog.makeStatement('CmdPlayerIsInCell', 'Bob', 'yulgar')), true);
  assert.deepStrictEqual(cellSession.asked[cellSession.asked.length - 1],
    { name: 'playerInCell', args: ['Bob', 'yulgar'] }, 'CheckCellPlayer takes the name then the cell');
  assert.strictEqual(await holds(fakeSession({ playerInCell: false }),
    catalog.makeStatement('CmdPlayerIsInCell', 'Bob', 'yulgar')), false);
  assert.strictEqual(await holds(fakeSession({ playerInCell: false }),
    catalog.makeStatement('CmdPlayerIsNotInCell', 'Bob', 'yulgar')), true);
  assert.strictEqual(await holds(fakeSession({ playerInCell: true }),
    catalog.makeStatement('CmdPlayerIsNotInCell', 'Bob', 'yulgar')), false);

  const mine = fakeSession({ playerInMyCell: true });
  assert.strictEqual(await holds(mine, catalog.makeStatement('CmdPlayerIsInMyCell', 'Bob')), true);
  assert.deepStrictEqual(mine.asked[mine.asked.length - 1],
    { name: 'playerInMyCell', args: ['Bob'] }, 'GetCellPlayers takes the name alone');
  assert.strictEqual(await holds(fakeSession({ playerInMyCell: false }),
    catalog.makeStatement('CmdPlayerIsInMyCell', 'Bob')), false);
  assert.strictEqual(await holds(fakeSession({ playerInMyCell: false }),
    catalog.makeStatement('CmdPlayerIsNotInMyCell', 'Bob')), true);
  assert.strictEqual(await holds(fakeSession({ playerInMyCell: true }),
    catalog.makeStatement('CmdPlayerIsNotInMyCell', 'Bob')), false);
});

test('the player count statements compare the count of the map the game lists', async () => {
  const three = ['Bob', 'Alice', 'Carl'];
  assert.strictEqual(await holds(fakeSession({ playersInMap: three }),
    catalog.makeStatement('CmdPlayersGreaterThan', '2')), true);
  assert.strictEqual(await holds(fakeSession({ playersInMap: three }),
    catalog.makeStatement('CmdPlayersGreaterThan', '3')), false, 'the bound is inclusive');
  assert.strictEqual(await holds(fakeSession({ playersInMap: three }),
    catalog.makeStatement('CmdPlayersLessThan', '4')), true);
  assert.strictEqual(await holds(fakeSession({ playersInMap: three }),
    catalog.makeStatement('CmdPlayersLessThan', '3')), false);

  // int.TryParse's false is not a failed statement upstream: the skip simply does not happen.
  assert.strictEqual(await holds(fakeSession({ playersInMap: three }),
    catalog.makeStatement('CmdPlayersGreaterThan', 'many')), true);
  assert.strictEqual(await holds(fakeSession({ playersInMap: three }),
    catalog.makeStatement('CmdPlayersLessThan', 'many')), true);
});

test('the in-my-cell count asks about every player in the room, against the cell I stand in', async () => {
  // CmdPlayerInMyCellGreaterThan walks World.PlayersInMap and asks CheckCellPlayer(name, Player.Cell)
  // for each of them, so the statement reads the player's own cell once and then one answer per
  // player.
  const session = fakeSession({
    cell: 'yulgar',
    playersInMap: ['Bob', 'Alice'],
    playerInCell: function (args) { return args[0] === 'Bob'; }
  });
  const made = await after(session, catalog.makeStatement('CmdPlayerInMyCellGreaterThan', '0'));
  assert.strictEqual(made.index(), 1, 'one player is in my cell, which is greater than 0');
  const asked = session.asked.filter(function (call) { return call.name === 'playerInCell'; });
  assert.deepStrictEqual(asked.map(function (call) { return call.args; }),
    [['Bob', 'yulgar'], ['Alice', 'yulgar']], 'each player is asked about, in the cell I stand in');

  const one = { cell: 'yulgar', playersInMap: ['Bob'], playerInCell: true };
  assert.strictEqual(await holds(fakeSession(one),
    catalog.makeStatement('CmdPlayerInMyCellGreaterThan', '1')), false, 'the bound is inclusive');
  assert.strictEqual(await holds(fakeSession(one),
    catalog.makeStatement('CmdPlayerInMyCellLessThan', '2')), true);
  assert.strictEqual(await holds(fakeSession(one),
    catalog.makeStatement('CmdPlayerInMyCellLessThan', '1')), false);
});

test('name equals compares the character name the loader holds, ignoring case', async () => {
  assert.strictEqual(await holds(fakeSession({ username: 'Tester' }),
    catalog.makeStatement('CmdNameEquals', 'tester')), true);
  assert.strictEqual(await holds(fakeSession({ username: 'Tester' }),
    catalog.makeStatement('CmdNameEquals', 'Someone')), false);
});

test('the monster statements ask the reference own names and report what the surface says', async () => {
  // IsMonsterAvailable, GetMonsterHealth and GetVisibleMonstersInCell are all composed from live
  // monster objects, which is ticket #38's. The statement asks for them anyway, so the day #38
  // lands it works with no change here - and until then the refusal is the reason it reports.
  function refuses() { return new Error('not implemented: the reference scans live monsters; ticket #38 owns combat'); }
  const cases = [
    ['CmdMonsterInRoom', 'Darkon', null],
    ['CmdMonsterNotInRoom', 'Darkon', null],
    ['CmdMonsterHealthGreaterThan', 'Darkon', '100'],
    ['CmdMonsterHealthLessThan', 'Darkon', '100'],
    ['CmdMonstersGreaterThan', '1', null],
    ['CmdMonstersLessThan', '1', null]
  ];
  for (const entry of cases) {
    const session = fakeSession({
      monsterInRoom: refuses(), monsterByMonMapId: refuses(), monsterHealth: refuses(),
      visibleMonsters: refuses()
    });
    const made = await after(session, catalog.makeStatement(entry[0], entry[1], entry[2]));
    assert.strictEqual(made.index(), 2, entry[0] + ' cannot be told, so it skips the command under it');
    assert.ok(logs(made, /cannot be evaluated/, entry[0]), entry[0] + ': ' + made.records.join('|'));
    assert.ok(made.records.some(function (line) {
      return line.indexOf(entry[0]) !== -1 && /#38/.test(line);
    }), entry[0] + ' must name the ticket that owns the gap: ' + made.records.join('|'));
  }

  // And the comparisons themselves, once there are answers.
  assert.strictEqual(await holds(fakeSession({ monsterInRoom: true }),
    catalog.makeStatement('CmdMonsterInRoom', 'Darkon')), true);
  assert.strictEqual(await holds(fakeSession({ monsterInRoom: false }),
    catalog.makeStatement('CmdMonsterInRoom', 'Darkon')), false);
  assert.strictEqual(await holds(fakeSession({ monsterInRoom: false }),
    catalog.makeStatement('CmdMonsterNotInRoom', 'Darkon')), true);
  assert.strictEqual(await holds(fakeSession({ monsterInRoom: true }),
    catalog.makeStatement('CmdMonsterNotInRoom', 'Darkon')), false);
  assert.strictEqual(await holds(fakeSession({ monsterHealth: 100 }),
    catalog.makeStatement('CmdMonsterHealthGreaterThan', 'Darkon', '100')), true,
    'the bound is inclusive: the reference skips on health < value');
  assert.strictEqual(await holds(fakeSession({ monsterHealth: 99 }),
    catalog.makeStatement('CmdMonsterHealthGreaterThan', 'Darkon', '100')), false);
  assert.strictEqual(await holds(fakeSession({ monsterHealth: 99 }),
    catalog.makeStatement('CmdMonsterHealthLessThan', 'Darkon', '100')), true);
  // 100 at a bound of 100 holds: the reference skips only on health > value.
  assert.strictEqual(await holds(fakeSession({ monsterHealth: 100 }),
    catalog.makeStatement('CmdMonsterHealthLessThan', 'Darkon', '100')), true);
  assert.strictEqual(await holds(fakeSession({ visibleMonsters: [{ sRace: 'A' }, { sRace: 'B' }] }),
    catalog.makeStatement('CmdMonstersGreaterThan', '1')), true);
  assert.strictEqual(await holds(fakeSession({ visibleMonsters: [{ sRace: 'A' }, { sRace: 'B' }] }),
    catalog.makeStatement('CmdMonstersGreaterThan', '2')), false);
  assert.strictEqual(await holds(fakeSession({ visibleMonsters: [{ sRace: 'A' }] }),
    catalog.makeStatement('CmdMonstersLessThan', '2')), true);
  assert.strictEqual(await holds(fakeSession({ visibleMonsters: [{ sRace: 'A' }] }),
    catalog.makeStatement('CmdMonstersLessThan', '1')), false);
});

test('a monster named by MonMapID asks the id helper, which is the reference own routing', async () => {
  // World.IsMonsterAvailable switches on the name's prefix: id'12, id.12, id:12 and id-12 all ask
  // IsMonsterAvailableByMonMapID with the id instead of the name.
  const session = fakeSession({ monsterInRoom: true, monsterByMonMapId: false });
  assert.strictEqual(await holds(session, catalog.makeStatement('CmdMonsterInRoom', "id'12")), false);
  assert.strictEqual(session.asked[session.asked.length - 1].name, 'monsterByMonMapId');
  assert.deepStrictEqual(session.asked[session.asked.length - 1].args, ['12']);

  const plain = fakeSession({ monsterInRoom: true, monsterByMonMapId: false });
  assert.strictEqual(await holds(plain, catalog.makeStatement('CmdMonsterInRoom', 'Darkon')), true);
  assert.strictEqual(plain.asked[plain.asked.length - 1].name, 'monsterInRoom');

  // GetMonsterHealth has no id routing: it is always the name.
  const health = fakeSession({ monsterHealth: 5 });
  assert.strictEqual(await holds(health,
    catalog.makeStatement('CmdMonsterHealthLessThan', "id'12", '10')), true);
  assert.strictEqual(health.asked[health.asked.length - 1].name, 'monsterHealth');
  assert.deepStrictEqual(health.asked[health.asked.length - 1].args, ["id'12"]);
});

test('a dropped-item statement reports that the drop list is not readable here', async () => {
  // World.DropStack is the reference's own list, filled from the game's dropItem frames. It is not
  // state this bridge reads, so the read refuses - naming where the list comes from - and the
  // statement reports the reason rather than answering a no.
  const session = fakeSession({
    dropStack: new Error("the reference own drop list, fed by dropItem frames; ticket #33 owns drops")
  });
  const made = await after(session, catalog.makeStatement('CmdItemPickupable', 'Gold'));
  assert.strictEqual(made.index(), 2);
  assert.ok(logs(made, /cannot be evaluated/, 'CmdItemPickupable'), made.records.join('|'));
  assert.ok(logs(made, /#33/, 'CmdItemPickupable'), made.records.join('|'));

  const not = await after(session, catalog.makeStatement('CmdItemNotPickupable', 'Gold'));
  assert.strictEqual(not.index(), 2);

  // And the comparison itself, once the list can be read.
  assert.strictEqual(await holds(fakeSession({ dropStack: [{ sName: 'Gold' }] }),
    catalog.makeStatement('CmdItemPickupable', 'gold')), true);
  assert.strictEqual(await holds(fakeSession({ dropStack: [{ sName: 'Gold' }] }),
    catalog.makeStatement('CmdItemPickupable', 'Silver')), false);
  assert.strictEqual(await holds(fakeSession({ dropStack: [{ sName: 'Gold' }] }),
    catalog.makeStatement('CmdItemNotPickupable', 'Silver')), true);
  assert.strictEqual(await holds(fakeSession({ dropStack: [{ sName: 'Gold' }] }),
    catalog.makeStatement('CmdItemNotPickupable', 'gold')), false);
});

test('a read that cannot be established is reported, and the guarded command is not run on a guess', async () => {
  const session = fakeSession({ cell: new Error('the game window went away') });
  const made = await after(session, catalog.makeStatement('CmdCellIs', 'yulgar'));
  assert.strictEqual(made.index(), 2, 'the command under the statement is skipped');
  assert.ok(logs(made, /cannot be evaluated/, 'CmdCellIs'), made.records.join('|'));
  assert.ok(logs(made, /game window went away/, 'CmdCellIs'), made.records.join('|'));
});

test('every statement this ticket owns has a handler and a row to edit it with', () => {
  OWNED.forEach(function (className) {
    const row = catalog.STATEMENTS.filter(function (s) { return s.className === className; })[0];
    assert.ok(row, className + ' has no catalog row, so it could not be added or edited');
    assert.ok(row.text, className + ' has no row text');
    assert.ok(statements.HANDLERS[className], className + ' has no handler');
    assert.strictEqual(typeof catalog.display(catalog.makeStatement(className, 'a', 'b')), 'string',
      className + ' must display as a row');
    assert.strictEqual(catalog.makeStatement(className, 'a', 'b').$type,
      'Grimoire.Botting.Commands.Misc.Statements.' + className + ', Grimoire',
      className + ' must write the class the reference declares');
  });
  assert.deepStrictEqual(Object.keys(statements.HANDLERS).sort(), OWNED.slice().sort(),
    'the table holds exactly the statements this ticket owns');
});

test('the engine merges the table, and the statements it does not own stay unimplemented', async () => {
  const made = engine(fakeSession({}));
  OWNED.forEach(function (className) {
    assert.strictEqual(typeof made.handlers()[className], 'function', className + ' is not registered');
  });
  // #42's own: a handler here would take that ticket's work.
  ['CmdPlayerAuraEquals', 'CmdTargetAuraEquals', 'CmdInCombat', 'CmdNotInCombat', 'CmdHasTarget',
    'CmdNotHasTarget', 'CmdTargetHealthGreaterThan', 'CmdSpecialAnims', 'CmdSetVar', 'CmdUpdateVar',
    'CmdIntIs', 'CmdVarEqualVar'].forEach(function (className) {
    assert.strictEqual(made.handlers()[className] === undefined ||
      statements.HANDLERS[className] === undefined, true,
      className + ' belongs to another ticket');
  });
  OWNED.forEach(function (className) {
    assert.strictEqual(statements.HANDLERS[className] !== undefined, true);
  });
});

test('the engine runs them: the command under a holding statement runs and is skipped otherwise', async () => {
  const made = engine(fakeSession({ cell: 'yulgar' }));
  await made.start({
    Commands: [
      catalog.makeStatement('CmdCellIs', 'yulgar'),
      catalog.makeStatement('CmdSetVar', 'ran', 'yes'),
      catalog.makeStatement('CmdCellIs', 'battleon'),
      catalog.makeStatement('CmdSetVar', 'skipped', 'yes'),
      command('CmdStop', {})
    ]
  });
  for (let i = 0; i < 8 && made.running(); i++) await made.tick();
  assert.strictEqual(made.vars().ran, 'yes', 'the command under a holding statement ran');
  assert.strictEqual(made.vars().skipped, undefined,
    'the command under a statement that did not hold was skipped');
});

// ---------------------------------------------------------------------------- the session

// The loader surface as the bridge exposes it: an answer per helper name, and the surface own
// refusal - naming the ticket that owns the gap - for a name it does not implement.
function fakeBridge(answers) {
  const asked = [];
  return {
    asked: function () { return asked; },
    attach: function () { return Promise.resolve({ ok: true }); },
    loaderCall: function (name, args) {
      asked.push({ name: name, args: args || [] });
      if (Object.prototype.hasOwnProperty.call(answers, name)) return Promise.resolve(answers[name]);
      const row = surface.SURFACE[name];
      return Promise.reject(new Error('no helper named "' + name + '" is implemented: ' +
        ((row && row.why) || 'no row')));
    }
  };
}

test('the session reads the new state by the loader own names, one row each', async () => {
  const answers = {
    Cell: 'yulgar', Map: 'yulgar', Gold: 1234, Level: 42, IsMember: true,
    GetPlayerHealthPercentage: 55, GetInventoryItems: [], GetBankItems: [], GetTempItems: [],
    GetHouseItems: [], GetFactions: [], PlayersInMap: ['Bob'],
    CheckCellPlayer: true, GetCellPlayers: true, IsAvailable: true, IsInProgress: false,
    IsMonsterAvailable: true, IsMonsterAvailableByMonMapID: false, GetMonsterHealth: 100,
    GetVisibleMonstersInCell: []
  };
  const bridge = fakeBridge(answers);
  const session = sessionModel.createSession({ bridge: bridge });

  assert.strictEqual(await session.cell(), 'yulgar');
  assert.strictEqual(await session.map(), 'yulgar');
  assert.strictEqual(await session.gold(), 1234);
  assert.strictEqual(await session.level(), 42);
  assert.strictEqual(await session.isMember(), true);
  assert.strictEqual(await session.playerHealthPercentage('Bob'), 55);
  assert.deepStrictEqual(await session.inventory(), []);
  assert.deepStrictEqual(await session.bank(), []);
  assert.deepStrictEqual(await session.tempInventory(), []);
  assert.deepStrictEqual(await session.house(), []);
  assert.deepStrictEqual(await session.factions(), []);
  assert.deepStrictEqual(await session.playersInMap(), ['Bob']);
  assert.strictEqual(await session.playerInCell('Bob', 'yulgar'), true);
  assert.strictEqual(await session.playerInMyCell('Bob'), true);
  assert.strictEqual(await session.questAvailable('102'), true);
  assert.strictEqual(await session.questInProgress('102'), false);
  assert.strictEqual(await session.monsterInRoom('Darkon'), true);
  assert.strictEqual(await session.monsterByMonMapId('12'), false);
  assert.strictEqual(await session.monsterHealth('Darkon'), 100);
  assert.deepStrictEqual(await session.visibleMonsters(), []);

  assert.deepStrictEqual(bridge.asked().map(function (call) { return call.name; }), [
    'Cell', 'Map', 'Gold', 'Level', 'IsMember', 'GetPlayerHealthPercentage',
    'GetInventoryItems', 'GetBankItems', 'GetTempItems', 'GetHouseItems', 'GetFactions',
    'PlayersInMap', 'CheckCellPlayer', 'GetCellPlayers', 'IsAvailable', 'IsInProgress',
    'IsMonsterAvailable', 'IsMonsterAvailableByMonMapID', 'GetMonsterHealth',
    'GetVisibleMonstersInCell'
  ], 'every read is the reference loader own name, in the order it was read');
  assert.deepStrictEqual(bridge.asked()[12].args, ['Bob', 'yulgar'], 'CheckCellPlayer takes name, cell');
  assert.deepStrictEqual(bridge.asked()[14].args, ['102'], 'the quest id goes as the loader own text');
  assert.deepStrictEqual(bridge.asked()[19].args, [], 'GetVisibleMonstersInCell takes no arguments');
});

test('a session read that cannot be established refuses rather than answering a default', async () => {
  // An avatar that is not in the world reads null down the paths behind these helpers, which is not
  // the same as an empty inventory or a cell with no name.
  const nothing = sessionModel.createSession({ bridge: fakeBridge({ GetInventoryItems: null, Cell: null }) });
  await assert.rejects(function () { return nothing.inventory(); }, /answered nothing/);
  await assert.rejects(function () { return nothing.cell(); }, /answered nothing/);

  // A list the game did not answer with a list is a refusal too, not an empty list.
  const wrongShape = sessionModel.createSession({ bridge: fakeBridge({ GetBankItems: 'nope' }) });
  await assert.rejects(function () { return wrongShape.bank(); }, /not a list/);

  const wrong = sessionModel.createSession({ bridge: fakeBridge({ IsMember: 'maybe', Gold: 'lots' }) });
  await assert.rejects(function () { return wrong.isMember(); }, /not a yes or a no/);
  await assert.rejects(function () { return wrong.gold(); }, /not a number/);

  // A name the surface refuses carries the surface own reason, ticket and all.
  const refused = sessionModel.createSession({ bridge: fakeBridge({}) });
  await assert.rejects(function () { return refused.monsterHealth('Darkon'); }, /#38/);
  await assert.rejects(function () { return refused.questCanComplete('102'); }, /#39/);
  await assert.rejects(function () { return refused.visibleMonsters(); }, /#38/);

  // And the drop list is this client's own rather than the game's: it says where it would come from.
  await assert.rejects(function () { return refused.dropStack(); }, /#33/);
  await assert.rejects(function () { return refused.dropStack(); }, /dropItem/);
});

test('a name the loader answers empty is a refusal for a name, not an empty string to compare', async () => {
  // The loader quotes the strings it answers ("yulgar"), and the game answers a string it has not
  // set as null. Neither is a cell a character stands in, so the read reports rather than comparing.
  const quoted = sessionModel.createSession({ bridge: fakeBridge({ Cell: '"battleon"' }) });
  assert.strictEqual(await quoted.cell(), 'battleon', 'the loader own quoting is stripped');

  const empty = sessionModel.createSession({ bridge: fakeBridge({ Cell: null }) });
  await assert.rejects(function () { return empty.cell(); }, /answered nothing/);
});

test('every loader name the session asks for is implemented, or refused with its ticket', () => {
  const bodies = sessionModel.LOADER_BODIES;
  Object.keys(bodies).forEach(function (name) {
    const row = bodies[name];
    assert.ok(row.body, name + ' records no loader body');
    if (row.path) {
      assert.ok(row.reason === undefined || typeof row.reason === 'string', name + ' reason');
      return;
    }
    const key = row.helper || name;
    const surfaceRow = surface.SURFACE[key];
    // A read whose answer is this client's own rather than the game's - the reference keeps the
    // list itself - has no row on the loader surface, so its reason has to name what owns it.
    if (!surfaceRow) {
      assert.ok(typeof row.reason === 'string' && /#\d+/.test(row.reason),
        name + ' has no row on the loader surface and no reason naming its owner');
      return;
    }
    const implemented = surfaceRow.compute || surfaceRow.get || surfaceRow.call || surfaceRow.set;
    if (!implemented) {
      assert.ok(/#\d+/.test(surfaceRow.why),
        name + ' is refused without naming the ticket that owns it');
    } else {
      assert.ok(surface.implemented().indexOf(key) !== -1, name + ' is neither implemented nor refused');
    }
  });

  // The names this ticket widened the session with, each recorded with the body it comes from.
  ['Cell', 'Map', 'Gold', 'Level', 'IsMember', 'GetInventoryItems', 'GetBankItems', 'GetTempItems',
    'GetHouseItems', 'GetFactions', 'PlayersInMap', 'CheckCellPlayer', 'GetCellPlayers',
    'GetPlayerHealthPercentage', 'IsAvailable', 'IsInProgress', 'CanComplete', 'IsMonsterAvailable',
    'IsMonsterAvailableByMonMapID', 'GetMonsterHealth', 'GetVisibleMonstersInCell']
    .forEach(function (name) {
      assert.ok(bodies[name], name + ' is missing from the session own table');
    });

  // And the three whose bodies live in this client rather than in the game are recorded as such.
  ['DropStack', 'MapLoadComplete', 'GetUsername'].forEach(function (name) {
    assert.ok(bodies[name], name + ' is missing from the session own table');
    assert.ok(bodies[name].path || bodies[name].reason,
      name + ' must say where its answer comes from instead of the game');
  });
});
