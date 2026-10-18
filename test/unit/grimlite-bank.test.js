// The Bank window's decisions (ticket #29). Reference: Grimoire/UI/BankForm.cs and
// BankForm.Designer.cs. Every expected value below is read off that C# source: the two combo
// item lists, the treasure-potion exclusion, the 70 ms / 100 ms pacing, and both branches of
// each transfer.
const assert = require('assert');

const bank = require('../../plugins/grimlite-parity/features/bank/bank.js');

// A hand-made inventory item in the shape the plugin's game access hands over (InventoryItem:
// ItemID / sName / sType / bCoins / bEquip, see plugins/grimlite-parity/bridge.js).
function item(id, name, category, isAcItem, isEquipped) {
  return {
    id: id,
    name: name,
    category: category,
    isAcItem: !!isAcItem,
    isEquipped: !!isEquipped
  };
}

const INVENTORY = [
  item(1, 'Blinding Light of Destiny', 'Sword', true, false),
  item(2, 'Sword of Awe', 'Sword', false, false),
  item(3, 'Broad Axe', 'Axe', false, false),
  item(4, 'Rusty Dagger', 'Dagger', false, true),
  item(5, 'ArchPaladin', 'Class', false, false),
  item(6, 'Treasure Potion', 'Item', false, false),
  item(7, 'Moglin Cape', 'Cape', false, false),
  item(8, 'Battle Potion', 'Item', true, false)
];

function fakeGame(options) {
  const opts = options || {};
  const calls = [];
  const banked = [];
  const waits = [];
  // Each entry answers one read, and the last one is the bank forever: a bank that fills up
  // stops moving non-AC items.
  const slots = (opts.slots || []).slice();
  let read = 0;
  return {
    calls: calls,
    banked: banked,
    waits: waits,
    // Pacing is the game access's own, so the fake records what the feature asked for.
    sleep: function (ms) {
      waits.push(ms);
      return Promise.resolve();
    },
    readInventory: function () {
      calls.push('readInventory');
      return Promise.resolve(opts.inventory || INVENTORY);
    },
    transferToBank: function (name) {
      calls.push('transfer:' + name);
      if (opts.failOn === name) return Promise.reject(new Error('the game refused it'));
      banked.push(name);
      return Promise.resolve();
    },
    readBankSlots: function () {
      calls.push('readBankSlots');
      const next = slots[Math.min(read, slots.length - 1)];
      read++;
      return Promise.resolve(next || { total: 100, used: 0 });
    }
  };
}

test('the bank window offers the reference\'s categories and AC choices', () => {
  assert.deepStrictEqual(bank.CATEGORIES, [
    'Weapons', 'Sword', 'Axe', 'Dagger', 'Gun', 'Bow', 'Mace', 'Polearm', 'Staff', 'Wand',
    'Class', 'Armor', 'Helm', 'Cape', 'Item'
  ]);
  assert.deepStrictEqual(bank.AC_CHOICES, ['ACs', 'Non-ACs']);
  assert.deepStrictEqual(bank.WEAPON_CATEGORIES, [
    'Sword', 'Axe', 'Dagger', 'Gun', 'Bow', 'Mace', 'Polearm', 'Staff', 'Wand'
  ]);
  // The reference's two waits: 70 ms per category transfer, 100 ms per Bank All transfer.
  assert.strictEqual(bank.CATEGORY_DELAY_MS, 70);
  assert.strictEqual(bank.ALL_DELAY_MS, 100);
});

test('Bank asks for the category first and the AC choice second, in the reference\'s words', () => {
  assert.strictEqual(bank.validateCategory({}), 'Please select Item type');
  assert.strictEqual(bank.validateCategory({ category: 'Sword' }), 'Please select AC or Non-AC');
  assert.strictEqual(bank.validateCategory({ category: 'Sword', ac: false }), null);
  assert.strictEqual(bank.validateCategory({ category: 'Sword', ac: true }), null);

  // Bank All only ever asks for the AC choice.
  assert.strictEqual(bank.validateAcChoice({}), 'Please select AC or Non-AC');
  assert.strictEqual(bank.validateAcChoice({ ac: true }), null);
  assert.strictEqual(bank.validateAcChoice({ ac: false }), null);
});

test('Bank picks the chosen category, in the AC-ness and equipped state the reference filters on', () => {
  assert.deepStrictEqual(
    bank.selectCategory(INVENTORY, { category: 'Sword', ac: false, allExcept: false }),
    ['Sword of Awe']
  );
  assert.deepStrictEqual(
    bank.selectCategory(INVENTORY, { category: 'Class', ac: false, allExcept: false }),
    ['ArchPaladin']
  );
  // Weapons is not a category of its own: it is every weapon category.
  assert.deepStrictEqual(
    bank.selectCategory(INVENTORY, { category: 'Weapons', ac: false, allExcept: false }),
    ['Sword of Awe', 'Broad Axe']
  );
  // The equipped dagger would be a weapon transfer, and is skipped for being worn.
  assert.strictEqual(
    bank.selectCategory(INVENTORY, { category: 'Weapons', ac: false, allExcept: false })
      .indexOf('Rusty Dagger'),
    -1
  );
  // AC weapons need the AC choice.
  assert.deepStrictEqual(
    bank.selectCategory(INVENTORY, { category: 'Weapons', ac: true, allExcept: false }),
    ['Blinding Light of Destiny']
  );
  // The treasure potion is excluded from the category transfer, never from Bank All.
  assert.deepStrictEqual(
    bank.selectCategory(INVENTORY, { category: 'Item', ac: false, allExcept: false }),
    []
  );
});

test('bank all except selected moves everything outside the selection', () => {
  assert.deepStrictEqual(
    bank.selectCategory(INVENTORY, { category: 'Sword', ac: false, allExcept: true }),
    ['Broad Axe', 'ArchPaladin', 'Moglin Cape']
  );
  // Outside the weapon categories, with the treasure potion still excluded.
  assert.deepStrictEqual(
    bank.selectCategory(INVENTORY, { category: 'Weapons', ac: false, allExcept: true }),
    ['ArchPaladin', 'Moglin Cape']
  );
  assert.deepStrictEqual(
    bank.selectCategory(INVENTORY, { category: 'Weapons', ac: true, allExcept: true }),
    ['Battle Potion']
  );
});

test('a transfer waits 70 ms per item, so the server is not asked for a burst', async () => {
  const game = fakeGame({});
  const result = await bank.bankCategory(game, { category: 'Weapons', ac: false, allExcept: false });

  assert.deepStrictEqual(game.banked, ['Sword of Awe', 'Broad Axe']);
  assert.deepStrictEqual(game.waits, [70, 70]);
  assert.deepStrictEqual(result, { transferred: 2, total: 2, error: null });
});

test('Bank reads the inventory at the moment it runs, like the reference does', async () => {
  const game = fakeGame({ inventory: [item(9, 'Fresh Sword', 'Sword', false, false)] });
  const result = await bank.bankCategory(game, { category: 'Sword', ac: false, allExcept: false });
  assert.deepStrictEqual(game.banked, ['Fresh Sword']);
  assert.deepStrictEqual(result, { transferred: 1, total: 1, error: null });
});

test('Bank refuses a run whose choices are missing, before it touches the game', async () => {
  const game = fakeGame({});
  const result = await bank.bankCategory(game, { ac: false });
  assert.deepStrictEqual(result, { transferred: 0, total: 0, error: 'Please select Item type' });
  assert.deepStrictEqual(game.calls, []);

  const noAc = await bank.bankAll(fakeGame({}), {});
  assert.deepStrictEqual(noAc, { transferred: 0, total: 0, error: 'Please select AC or Non-AC' });
});

test('Bank All moves every item matching the AC choice, including the treasure potion', async () => {
  const game = fakeGame({});
  const result = await bank.bankAll(game, { ac: false });

  assert.deepStrictEqual(game.banked, [
    'Sword of Awe', 'Broad Axe', 'ArchPaladin', 'Treasure Potion', 'Moglin Cape'
  ]);
  assert.deepStrictEqual(game.waits, [100, 100, 100, 100, 100]);
  assert.deepStrictEqual(result, { transferred: 5, total: 5, error: null });
});

test('Bank All with ACs moves AC items even when the bank has no room left', async () => {
  // The reference's AC branch never consults AvailableSlots: AC items live in their own space.
  const game = fakeGame({ slots: [{ total: 100, used: 100 }] });
  const result = await bank.bankAll(game, { ac: true });

  assert.deepStrictEqual(game.banked, ['Blinding Light of Destiny', 'Battle Potion']);
  assert.deepStrictEqual(result, { transferred: 2, total: 2, error: null });
});

test('Bank All stops moving non-AC items once the bank is full', async () => {
  // Room for one more, then none: the non-AC half of Bank All is gated on free slots, and the
  // reference re-reads that before every item.
  const game = fakeGame({ slots: [{ total: 10, used: 9 }, { total: 10, used: 10 }] });
  const result = await bank.bankAll(game, { ac: false });

  assert.deepStrictEqual(game.banked, ['Sword of Awe']);
  assert.deepStrictEqual(game.waits, [100]);
  assert.deepStrictEqual(result, { transferred: 1, total: 1, error: null });
});

test('a transfer that fails reports what it managed before it failed', async () => {
  const game = fakeGame({ failOn: 'Broad Axe' });
  const result = await bank.bankCategory(game, { category: 'Weapons', ac: false, allExcept: false });

  assert.deepStrictEqual(game.banked, ['Sword of Awe']);
  assert.strictEqual(result.transferred, 1);
  assert.strictEqual(result.total, 2);
  assert.strictEqual(result.error, 'the game refused it');
});
