// The game-access adapter that now sits on ticket #28's real bridge channel (spec #19, Seam 4).
// The channel is platform code; this module is the one place the parity plugin turns a feature's
// request ("read the inventory", "equip this item") into a named game call, so the test drives a
// fake channel and asserts the calls and the parsing, not the Flash underneath.
const assert = require('assert');

const bridge = require('../../plugins/grimlite-parity/bridge.js');

// A stand-in for host.bridge: records what the adapter asked for and answers like the SWF does
// (a JSON *string* from the callback, wrapped by the channel).
function fakeChannel(answers) {
  const calls = [];
  let attaches = 0;
  return {
    calls: calls,
    attaches: function () { return attaches; },
    attach: function () {
      attaches++;
      return Promise.resolve({ ok: true });
    },
    call: function (name, args) {
      calls.push({ name: name, args: args });
      const answer = (answers && answers[args[0]]) !== undefined ? answers[args[0]] : 'null';
      if (answer && answer.fail) return Promise.resolve({ ok: false, error: answer.fail });
      return Promise.resolve({ ok: true, value: answer });
    }
  };
}

function fakeHost(channel) {
  return { log: function () {}, bridge: channel };
}

test('a game call goes over the bridge channel as the reference names it', async () => {
  const channel = fakeChannel({ Equip: '"ok"' });
  const game = bridge.createGameAccess(fakeHost(channel));

  await game.equipItem('Sword of Awe');

  // Zero-argument calls use the bridge's own zero-argument entry point, as the reference does.
  assert.deepStrictEqual(channel.calls[0], {
    name: 'callGameFunction',
    args: ['Equip', 'Sword of Awe']
  });
});

test('the inventory is read through the reference\'s own call and normalised', async () => {
  // GetInventoryItems answers the InventoryItem JSON: ItemID / sName / sType / bCoins / bEquip,
  // with the two booleans written as the 0/1 the reference's BoolConverter reads.
  const channel = fakeChannel({
    GetInventoryItems: JSON.stringify([
      { ItemID: 42, sName: 'Blinding Light of Destiny', sType: 'Sword', bCoins: 1, bEquip: 0 },
      { ItemID: 43, sName: 'ArchPaladin', sType: 'Class', bCoins: 0, bEquip: 1 }
    ])
  });
  const game = bridge.createGameAccess(fakeHost(channel));

  assert.deepStrictEqual(await game.readInventory(), [
    { id: 42, name: 'Blinding Light of Destiny', category: 'Sword', isAcItem: true, isEquipped: false },
    { id: 43, name: 'ArchPaladin', category: 'Class', isAcItem: false, isEquipped: true }
  ]);
});

test('the bank counts come back as numbers, from the call that reports each', async () => {
  const channel = fakeChannel({ BankSlots: '100', UsedBankSlots: '37' });
  const game = bridge.createGameAccess(fakeHost(channel));

  assert.deepStrictEqual(await game.readBankSlots(), { total: 100, used: 37 });
  assert.deepStrictEqual(channel.calls.map(function (c) { return c.args[0]; }).sort(),
    ['BankSlots', 'UsedBankSlots']);
});

test('a transfer asks the game for it by name, and hands back nothing invented', async () => {
  const channel = fakeChannel({ TransferToBank: 'null' });
  const game = bridge.createGameAccess(fakeHost(channel));

  assert.strictEqual(await game.transferToBank('Sword of Awe'), undefined);
  assert.deepStrictEqual(channel.calls[0], {
    name: 'callGameFunction',
    args: ['TransferToBank', 'Sword of Awe']
  });
});

test('an error the game itself reports is surfaced, not swallowed', async () => {
  // The SWF answers {"error": ...} for a call it cannot make: a name the game does not carry, a
  // path that is absent, or a game that never loaded. The caller must see that text - and when
  // the name is one only the reference loader carries, the reason comes with it.
  const channel = fakeChannel({
    GetInventoryItems: JSON.stringify({ error: 'no member GetInventoryItems at world' })
  });
  const game = bridge.createGameAccess(fakeHost(channel));

  await assert.rejects(function () { return game.readInventory(); }, function (error) {
    return error.message.indexOf('no member GetInventoryItems at world') === 0 &&
      error.message.indexOf(bridge.ERRORS.loaderSurface('GetInventoryItems')) !== -1;
  });

  // Any other refusal is handed through untouched: this adapter does not editorialise a game
  // that failed for its own reasons.
  const other = bridge.createGameAccess(fakeHost(fakeChannel({
    GetInventoryItems: JSON.stringify({ error: 'the game is not loaded yet' })
  })));
  await assert.rejects(function () { return other.readInventory(); }, function (error) {
    return error.message === 'the game is not loaded yet';
  });
});

test('a bridge that will not attach, and an app with no channel, both report why', async () => {
  const refusing = {
    attach: function () {
      return Promise.resolve({
        ok: false,
        error: 'the bridge movie did not register its callbacks within 20000ms'
      });
    },
    call: function () { throw new Error('must not be reached'); }
  };
  const game = bridge.createGameAccess(fakeHost(refusing));
  await assert.rejects(function () { return game.readInventory(); }, function (error) {
    return /did not register its callbacks/.test(error.message);
  });

  // An app older than the bridge has no host.bridge at all: report it rather than throwing.
  const noChannel = bridge.createGameAccess({ log: function () {} });
  await assert.rejects(function () { return noChannel.equipItem('x'); }, function (error) {
    return error.message === bridge.ERRORS.unchannelled;
  });
});

test('the channel is attached once, and a failed attach is retried rather than cached', async () => {
  let attaches = 0;
  let allow = false;
  const flaky = {
    attach: function () {
      attaches++;
      return Promise.resolve(allow ? { ok: true } : { ok: false, error: 'no game window yet' });
    },
    call: function () { return Promise.resolve({ ok: true, value: 'null' }); }
  };
  const game = bridge.createGameAccess(fakeHost(flaky));

  await assert.rejects(function () { return game.readBankSlots(); });
  assert.strictEqual(attaches, 1);

  // The game window opens later: the next attempt attaches again and works.
  allow = true;
  assert.deepStrictEqual(await game.readBankSlots(), { total: 0, used: 0 });
  assert.strictEqual(attaches, 2);

  // and once attached, further calls reuse the attachment.
  await game.readBankSlots();
  assert.strictEqual(attaches, 2);
});

test('sleep is real pacing, not a game call', async () => {
  const channel = fakeChannel({});
  const game = bridge.createGameAccess(fakeHost(channel));
  const started = Date.now();
  await game.sleep(15);
  assert.ok(Date.now() - started >= 10, 'sleep must actually wait');
  assert.deepStrictEqual(channel.calls, [], 'pacing must not reach the game');
});

test('the adapter exposes only what this plugin\'s features ask for', () => {
  const game = bridge.createGameAccess(fakeHost(fakeChannel({})));
  assert.deepStrictEqual(Object.keys(game).sort(), [
    'equipItem', 'readBankSlots', 'readInventory', 'sleep', 'transferToBank'
  ]);
});

// What the bridge still owes, pinned so the list cannot drift silently: every call name above
// that lives in the reference's own loader and not in the stock game, verified by exact
// ABC string-pool membership against the decompressed game SWF (see the ticket #29 section of
// docs/FLASH_CHECKLIST.md for the check and the result per name).
test('the loader-only list is exactly the names this module calls', () => {
  // Verified against the decompressed game SWF: each of these is absent from the stock game's ABC
  // string pool (or, for Equip, present with zero multiname references, so a literal and not a
  // member) and present in the reference loader's. Names the reference carries but this module
  // never calls - GetBankItems, TransferToInventory, BankSwap, IsActionAvailable - are not here,
  // because the list would then claim more than the code asks for.
  assert.deepStrictEqual(Object.keys(bridge.LOADER_ONLY).sort(), [
    'BankSlots', 'Equip', 'GetInventoryItems', 'TransferToBank', 'UsedBankSlots'
  ]);
});

test('an equip the game cannot answer is annotated with the loader reason too', async () => {
  // Equip is the one loader-only name the Sets window calls: the game carries the letters as a
  // UI label but no member answers to it, so the failure has to explain itself the same way.
  const channel = fakeChannel({ Equip: JSON.stringify({ error: 'no member Equip at world' }) });
  const game = bridge.createGameAccess(fakeHost(channel));

  await assert.rejects(function () { return game.equipItem('Sword of Awe'); }, function (error) {
    return error.message.indexOf('no member Equip at world') === 0 &&
      error.message.indexOf(bridge.ERRORS.loaderSurface('Equip')) !== -1;
  });
});
