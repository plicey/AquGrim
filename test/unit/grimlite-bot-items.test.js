// The item and quest commands (ticket #39). Expected behaviour comes from the reference's own
// command classes - Grimoire/Botting/Commands/Item/*.cs and .../Quest/*.cs - and from the loader
// bodies their calls end up in (the reference loader's grimoire/game/*.as). Nothing here is
// asserted against the port; every expectation names the reference file it came from.
//
// The handlers consume an injected game access (bot/items.js), so the whole vocabulary is covered
// without Flash and without a window. The fake answers by the reference loader's own helper name
// through loaderCall, and by callback name through call, and refuses anything else the way
// loader-surface.js does - so a handler reaching for a name this build cannot answer fails here.
const assert = require('assert');

const items = require('../../plugins/grimlite-parity/bot/items.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');
const surface = require('../../plugins/grimlite-parity/loader-surface.js');

function command(className, properties) {
  return catalog.makeCommand(className, properties);
}

// The game as the bridge exposes it: loader names, generic paths and calls, and a frame sink.
function fakeGame(answers, options) {
  const opts = options || {};
  const known = answers || {};
  const calls = [];
  const frames = [];
  const game = {
    calls: calls,
    frames: frames,
    loaderCall: function (name, args) {
      calls.push({ door: 'loaderCall', name: name, args: args || [] });
      // Voices the real surface's answers: a name it refuses is refused with its own reason, and
      // a name it implements answers - null unless the test scripted something else, which is what
      // makes a handler asking for a name this build cannot answer fail here rather than in the
      // game. A name the reference loader does not carry at all is named, so no path is invented.
      if (!Object.prototype.hasOwnProperty.call(surface.SURFACE, name)) {
        return Promise.reject(new Error('no helper named "' + name + '" is implemented'));
      }
      if (surface.implemented().indexOf(name) === -1) {
        return Promise.reject(new Error('"' + name + '" is part of the reference client\'s own ' +
          'loader rather than the game, and this bridge does not implement it: ' +
          ((surface.SURFACE[name] && surface.SURFACE[name].why) || '')));
      }
      const answer = Object.prototype.hasOwnProperty.call(known, name) ? known[name] : null;
      // A function answer is called, so a test can script state that changes under the bot.
      return Promise.resolve(typeof answer === 'function' ? answer(args || []) : answer);
    },
    call: function (callback, args) {
      calls.push({ door: 'call', name: callback, args: args || [] });
      const key = callback + ':' + (args && args[0]);
      if (Object.prototype.hasOwnProperty.call(known, key)) {
        return Promise.resolve({ ok: true, value: JSON.stringify(known[key]) });
      }
      if (Object.prototype.hasOwnProperty.call(known, args[0])) {
        return Promise.resolve({ ok: true, value: JSON.stringify(known[args[0]]) });
      }
      return Promise.resolve({ ok: true, value: 'null' });
    },
    sendFrame: function (direction, text) {
      frames.push({ direction: direction, text: text });
      // False is the platform's own "the relay has no live connection" answer.
      return opts.relay === false ? false : true;
    },
    answers: known,
    asked: function () {
      return calls.filter(function (c) { return c.door === 'loaderCall'; })
        .map(function (c) { return c.name; });
    },
    argsFor: function (name) {
      const hit = calls.filter(function (c) { return c.door === 'loaderCall' && c.name === name; })[0];
      return hit ? hit.args : null;
    },
    paths: function () {
      return calls.filter(function (c) { return c.door === 'call' && c.name === 'getGameObject'; })
        .map(function (c) { return c.args[0]; });
    }
  };
  return game;
}

// A handler run with the context the engine builds, so the assertions are on real runs.
async function run(className, properties, answers, options) {
  const opts = options || {};
  const game = opts.game || fakeGame(answers, opts);
  const slept = [];
  const logs = [];
  const config = opts.config || {};
  const access = items.createAccess({
    loaderCall: game.loaderCall,
    call: game.call,
    sendFrame: game.sendFrame,
    sleep: function (ms) { slept.push(ms); return Promise.resolve(); },
    log: function (line) { logs.push(line); },
    config: config
  });
  const handler = items.handlers(access)[className];
  assert.strictEqual(typeof handler, 'function', className + ' has no handler');
  const context = {
    sleep: function (ms) { slept.push(ms); return Promise.resolve(); },
    log: function (line) { logs.push(line); },
    resolve: function (value) { return String(value === undefined || value === null ? '' : value); },
    config: function () { return config; },
    setConfig: function (key, value) { config[key] = value; },
    running: function () { return opts.running === undefined ? true : opts.running; }
  };
  if (opts.setEntries) context.setEntries = opts.setEntries;
  const outcome = await handler(context, command(className, properties));
  return { outcome: outcome, slept: slept, logs: logs, config: config, access: access, game: game };
}


// ---------------------------------------------------------------------------- the vocabulary

test('every item and quest command class the reference declares has a handler', () => {
  const table = items.handlers(items.createAccess({}));
  const wanted = Object.keys(catalog.GROUPS).filter(function (className) {
    return catalog.GROUPS[className] === 'Item' || catalog.GROUPS[className] === 'Quest';
  });
  const missing = wanted.filter(function (className) { return !table[className]; });
  assert.deepStrictEqual(missing, [], 'these are declared and unhandled');
  assert.ok(wanted.length >= 17, 'expected the full Item and Quest vocabulary, found ' + wanted.length);
});

test('the one item command spec #19 puts out of scope is refused by name, not skipped', () => {
  // CmdBuyBack drives AutoBuyBack over account.aq.com's own pages (Grimoire/Tools/Buyback). Spec
  // #19 puts that path out of scope as unreachable upstream, and the reference corpus references
  // the command zero times. It still has a handler, so a file carrying one opens, saves and runs,
  // and the row says where the reference goes instead of failing silently.
  const table = items.handlers(items.createAccess({}));
  assert.strictEqual(typeof table.CmdBuyBack, 'function');
  return table.CmdBuyBack({ log: function (line) { assert.ok(/buy-back/i.test(line), line); assert.ok(/account/.test(line), line); } },
    command('CmdBuyBack', { ItemName: 'Iron Sword' }));
});

test('every loader name the handlers ask for is one the surface implements', () => {
  // Same rule as bot/session.js: a name is either answered through the reference loader's own
  // surface, or it is not used at all. A handler reaching for a name the surface refuses would
  // fail at runtime with a reason nobody running a bot could act on.
  const answered = surface.implemented();
  const used = Object.keys(items.LOADER_BODIES);
  assert.ok(used.length > 0);
  used.forEach(function (name) {
    assert.ok(name, 'a recorded body needs a name');
    assert.ok(surface.SURFACE[name], name + ' is not a name the reference loader registers');
    assert.ok(answered.indexOf(name) !== -1,
      name + ' must be implemented, not refused: ' +
      ((surface.SURFACE[name] && surface.SURFACE[name].why) || 'no reason recorded'));
    assert.ok(items.LOADER_BODIES[name].body, name + ' records no loader body');
  });
});

test('the item access reaches the game through loaderCall and the generic callbacks only', async () => {
  // One door, and the door is the bridge: no handler may reach the game any other way, and each
  // want lands on exactly the callback its row records.
  const game = fakeGame({
    IsLoggedIn: true,
    'world.shopinfo.items': [{ sName: 'Iron Sword', ItemID: 1, iQty: 1, iStk: 10, iCost: 0 }]
  });
  const access = items.createAccess({
    loaderCall: game.loaderCall, call: game.call, sleep: function () { return Promise.resolve(); }
  });
  assert.strictEqual(await access.ask('IsLoggedIn', []), true);
  await access.shopItems();
  assert.deepStrictEqual(game.paths(), ['world.shopinfo.items'],
    'a GAME_READS path goes through getGameObject with the path the row records');
  const calls = game.calls.filter(function (c) { return c.door === 'call'; });
  assert.deepStrictEqual(calls[0], {
    door: 'call', name: 'getGameObject', args: ['world.shopinfo.items']
  });
  // Zero-argument game functions use callGameFunction0, with arguments callGameFunction - the
  // split the reference loader itself makes (Flash.CallGameFunction2 vs CallGameFunction0).
  game.calls.length = 0;
  await access.questProgress(7);
  await access.maximumTurnIns(31);
  assert.strictEqual(game.calls[0].name, 'callGameFunction');
  assert.deepStrictEqual(game.calls[0].args, ['world.getQuestValue', '7']);
  assert.deepStrictEqual(game.calls[1].args, ['world.maximumQuestTurnIns', '31']);
  assert.deepStrictEqual(game.paths(), [], 'a call row never goes through a path');
});

test('the generic reads the handlers make are recorded with their evidence', () => {
  // The wants no loader name answers live in GAME_READS, each with the game source that proves the
  // path or the call - so a reader can check the claim rather than trust it.
  const reads = Object.keys(items.GAME_READS);
  assert.ok(reads.length > 0);
  reads.forEach(function (name) {
    const row = items.GAME_READS[name];
    assert.ok(row.path || row.call, name + ' has neither a path nor a call');
    assert.ok(row.body, name + ' records no evidence');
  });
  ['shopItems', 'questValue', 'maximumTurnIns', 'drops', 'coins'].forEach(function (name) {
    assert.ok(reads.indexOf(name) !== -1, name + ' should be a recorded read');
  });
});

test('the routes that are not loader names are recorded with why they are not', () => {
  // ExitCombat, GetDrop and GhostAccept have no helper in the reference loader. Each is a frame or
  // a composition, and each is written down rather than worked around quietly.
  ['ExitCombat', 'GetDrop', 'GhostAccept'].forEach(function (name) {
    const why = items.OWN_ROUTES[name];
    assert.ok(why, name + ' has no recorded reason');
    assert.ok(why.length > 40, name + ' records a reason too short to act on');
  });
  assert.ok(/frame/.test(items.OWN_ROUTES.GetDrop), 'the drop route says it is a frame');
  assert.ok(/frame/.test(items.OWN_ROUTES.GhostAccept), 'the ghost accept says it is a frame');
});

test('a want that is in neither table is refused rather than answered', async () => {
  const access = items.createAccess({
    loaderCall: function () { throw new Error('must not be called'); },
    call: function () { throw new Error('must not be called'); }
  });
  await assert.rejects(function () { return access.ask('TeleportToPony', []); }, /TeleportToPony/);
});

// ---------------------------------------------------------------------------- buying and loading

// A shop with one row, and a bag that grows when the item is bought, so a wait can be seen to end.
function shopGame(options) {
  const opts = options || {};
  const bag = opts.bag ? opts.bag.slice() : [];
  return fakeGame({
    IsLoggedIn: true,
    IsActionAvailable: true,
    IsShopLoaded: true,
    State: 1,
    LoadShop: function () { return null; },
    BuyItemQty: function (args) {
      bag.push({ sName: args[0], ItemID: 1, iQty: (Number(args[1]) || 0) });
      return null;
    },
    BuyItemQtyById: function () {
      bag.push({ sName: 'Iron Sword', ItemID: 1, iQty: 1 });
      return null;
    },
    'world.shopinfo.items': [{ sName: 'Iron Sword', ItemID: 1, iQty: 1, iStk: 10, iCost: 0 }],
    GetInventoryItems: function () { return bag.slice(); },
    GetInventoryItemByName: function (args) {
      const want = String(args[0]).toLowerCase();
      return bag.slice().filter(function (i) {
        return String(i.sName).toLowerCase() === want;
      })[0] || null;
    }
  }, opts);
}

test('CmdBuy sends the name and quantity the reference sends, after the shop load it always makes', async () => {
  // CmdBuy.cs: the buy and load-shop locks (timeout 3), out of combat, Shop.Load, WaitUntil
  // IsShopLoaded (interval 500), then Shop.BuyItemQty(name, qty).
  const game = shopGame();
  const r = await run('CmdBuy', { ShopId: 12, ItemName: 'Iron Sword', Qty: 3 }, null, { game: game });
  assert.deepStrictEqual(game.asked(), [
    'IsActionAvailable', 'IsActionAvailable', 'State', 'IsLoggedIn', 'LoadShop', 'IsShopLoaded',
    'GetInventoryItemByName', 'BuyItemQty', 'GetInventoryItemByName'
  ], 'the reference order, and nothing else');
  assert.deepStrictEqual(game.argsFor('BuyItemQty'), ['Iron Sword', '3'],
    'Shop.BuyItemQty hands over the name and the quantity as a string');
  assert.deepStrictEqual(game.argsFor('LoadShop'), ['12']);
  assert.deepStrictEqual(r.logs, []);
});

test('CmdBuy polls IsShopLoaded at the reference interval until the shop answers', async () => {
  // instance.WaitUntil(() => Shop.IsShopLoaded, interval: 500) - the interval CmdBuy names is the
  // one it is polled at, and the wait only spends a poll when the shop has not answered yet.
  let polls = 0;
  const game = fakeGame({
    IsLoggedIn: true,
    IsActionAvailable: true,
    LoadShop: function () { return null; },
    IsShopLoaded: function () { polls++; return polls > 1; },
    GetInventoryItems: function () { return []; },
    GetInventoryItemByName: function () { return null; },
    BuyItemQty: function () { return null; },
    'world.shopinfo.items': [{ sName: 'Iron Sword', ItemID: 1, iQty: 1, iStk: 10, iCost: 0 }]
  });
  const r = await run('CmdBuy', { ShopId: 3, ItemName: 'Iron Sword', Qty: 1 }, null, { game: game });
  assert.ok(r.slept.indexOf(500) !== -1, 'the poll interval is the reference 500: ' +
    JSON.stringify(r.slept));
  assert.ok(polls >= 2, 'the wait ran until the shop answered');
});

test('CmdBuy by id sends the id triple, and resolves its maximum from the shop row it names', async () => {
  // Shop.cs:BuyItemQty(itemId, shopItemId, qty) -> Flash.Call("BuyItemQtyById", qty, itemId,
  // shopItemId) - that argument order, which is the one the loader body re-reads.
  const game = shopGame();
  await run('CmdBuy', { ShopId: 1, ByID: true, ItemId: 77, ShopItemId: 4, Qty: 2 }, null, { game: game });
  assert.deepStrictEqual(game.argsFor('BuyItemQtyById'), ['2', '77', '4']);

  // A negative quantity means "as many as possible" (Shop.MaximumShopBuys), and by id that needs
  // the row: iStk 10 with nothing owned and iQty 1 is ten buys.
  const max = shopGame();
  await run('CmdBuy', { ShopId: 1, ByID: true, ItemId: 1, ShopItemId: 0, Qty: -1 }, null, { game: max });
  assert.deepStrictEqual(max.argsFor('BuyItemQtyById'), ['10', '1', '0'],
    'MaximumShopBuys was resolved before the buy went out');
});

test('a maximum buy the shop cannot satisfy is skipped in the reference own words', async () => {
  // Shop.BuyItemQty logs "[MaxBuy] Buy skipped due to max/requirement not meet" and returns
  // without sending anything when MaximumShopBuys comes back 0.
  const game = shopGame({ bag: [{ sName: 'Iron Sword', ItemID: 1, iQty: 10 }] });
  const r = await run('CmdBuy', { ShopId: 1, ItemName: 'Iron Sword', Qty: -1 }, null, { game: game });
  assert.strictEqual(game.argsFor('BuyItemQty'), null, 'nothing may be bought');
  assert.ok(r.logs.some(function (line) {
    return line === '[MaxBuy] Buy skipped due to max/requirement not meet';
  }), JSON.stringify(r.logs));
});

test('CmdBuyFast buys without loading a shop, which is the whole difference between the two', async () => {
  // CmdBuyFast.cs: one lock (buyItem, timeout 3), out of combat, Shop.BuyItemQty - no LoadShop and
  // no IsShopLoaded wait.
  const game = shopGame();
  await run('CmdBuyFast', { ItemName: 'Iron Sword', Qty: 1 }, null, { game: game });
  assert.strictEqual(game.asked().indexOf('LoadShop'), -1, 'CmdBuyFast never loads a shop');
  assert.strictEqual(game.asked().indexOf('IsShopLoaded'), -1);
  assert.deepStrictEqual(game.argsFor('BuyItemQty'), ['Iron Sword', '1']);
});

test('CmdLoad waits both locks and exits combat; CmdLoadTravel waits one and does not', async () => {
  // CmdLoad.cs and CmdLoadTravel.cs are the same Shop.Load with two different prologues. That
  // difference is the point of having both, so it is what is asserted.
  const load = shopGame();
  await run('CmdLoad', { ShopId: 5 }, null, { game: load });
  assert.deepStrictEqual(load.asked().slice(0, 3), ['IsActionAvailable', 'IsActionAvailable', 'State'],
    'CmdLoad takes both locks, then asks the game whether it is in combat');
  assert.strictEqual(load.argsFor('LoadShop')[0], '5');

  const travel = shopGame();
  await run('CmdLoadTravel', { ShopId: 5 }, null, { game: travel });
  assert.deepStrictEqual(travel.asked().slice(0, 3), ['IsActionAvailable', 'IsLoggedIn', 'LoadShop'],
    'CmdLoadTravel waits the loadShop lock only');
  assert.strictEqual(travel.asked().indexOf('Jump'), -1, 'and never moves the character');
  assert.strictEqual(travel.argsFor('LoadShop')[0], '5');
});

// ---------------------------------------------------------------------------- selling

test('CmdSell sells the whole stack for 0, leaves N behind for -N, and the count otherwise', async () => {
  // CmdSell.cs -> Shop.SellItem(name, qty): 0 becomes the whole stack, -N leaves N behind, and a
  // positive number is taken as written.
  async function sell(qty, held) {
    const game = shopGame({ bag: [{ sName: 'Iron Sword', ItemID: 1, iQty: held }] });
    const r = await run('CmdSell', { ItemName: 'Iron Sword', Qty: qty }, null, { game: game });
    return { game: game, r: r };
  }

  const all = await sell('0', 7);
  assert.deepStrictEqual(all.game.argsFor('SellItem'), ['Iron Sword', '7']);
  const leave = await sell('-3', 7);
  assert.deepStrictEqual(leave.game.argsFor('SellItem'), ['Iron Sword', '4']);
  const some = await sell('2', 7);
  assert.deepStrictEqual(some.game.argsFor('SellItem'), ['Iron Sword', '2']);

  // The reference's own guard is `qty > 0` after the adjustment, so "leave more than is held"
  // sends nothing rather than a negative quantity.
  const impossible = await sell('-9', 7);
  assert.strictEqual(impossible.game.argsFor('SellItem'), null);
  assert.ok(impossible.r.logs.length > 0, 'the refusal says so rather than failing silently');
});

test('CmdSell never sells a name the bag does not hold', async () => {
  // InventoryItem item = Player.Inventory.Items.FirstOrDefault(...); if (item != null) - the whole
  // body is under that test, so an absent name is a no-op and must not reach Shop.SellItem.
  const game = shopGame();
  await run('CmdSell', { ItemName: 'Ghost Blade', Qty: '1' }, null, { game: game });
  assert.strictEqual(game.argsFor('SellItem'), null);
});

test('CmdSell reads its quantity as text, the way the reference forces the field to be written', async () => {
  // CmdSell.Qty is a string with DefaultValueHandling.Include, so a saved file always carries one
  // and int.Parse is handed the resolved text. A command with no Qty is therefore 1, not 0.
  const game = shopGame({ bag: [{ sName: 'Iron Sword', ItemID: 1, iQty: 7 }] });
  await run('CmdSell', { ItemName: 'Iron Sword' }, null, { game: game });
  assert.deepStrictEqual(game.argsFor('SellItem'), ['Iron Sword', '1']);
});

// ---------------------------------------------------------------------------- equipping

test('CmdEquip resolves a forge name before the item that is literally named the same', async () => {
  // CmdEquip.cs's four steps run in order, and that order decides what is worn when more than one
  // step could match. The bag here satisfies step 4 as well, so the answer pins step 1.
  const bag = [
    { sName: 'Awe Blade', ItemID: 11, sType: 'Sword', iEnh: 70752 },
    { sName: 'Valiance', ItemID: 12, sType: 'Sword', iEnh: 999 }
  ];
  const game = fakeGame({
    'GetInventoryItems': bag,
    IsLoggedIn: true,
    Equip: function () { return null; }
  });
  await run('CmdEquip', { ItemName: 'Valiance' }, null, { game: game });
  assert.deepStrictEqual(game.argsFor('Equip'), ['11'],
    'the forge enum name wins over the item named Valiance');

  // Step 4 on its own: a name no forge or enhancement carries equips the item of that name.
  const plain = fakeGame({
    'GetInventoryItems': bag.map(function (item) { return Object.assign({}, item, { iEnh: 0 }); }),
    Equip: function () { return null; },
    IsLoggedIn: true
  });
  await run('CmdEquip', { ItemName: 'valiance sword' }, null, { game: plain });
  assert.strictEqual(plain.argsFor('Equip'), null, 'nothing carries that name, so nothing is sent');
});

test('CmdEquip wears a potion through EquipPotion and anything else through Equip', async () => {
  // CmdEquip.cs: `if (item.Category == "Item") Player.EquipPotion(...) else Player.Equip(item.Id)`.
  let worn = false;
  const game = fakeGame({
    'GetInventoryItems': function () {
      return [{ sName: 'Mana Potion', ItemID: 5, sType: 'Item', sDesc: 'Restores MP',
        sFile: 'mana.swf', bEquip: worn ? 1 : 0 }];
    },
    EquipPotion: function () { worn = true; return null; }
  });
  await run('CmdEquip', { ItemName: 'Mana Potion' }, null, { game: game });
  assert.deepStrictEqual(game.argsFor('EquipPotion'),
    ['5', 'Restores MP', 'mana.swf', 'Mana Potion']);
  assert.strictEqual(game.argsFor('Equip'), null, 'a category Item never goes through Equip');
});

test('CmdEquip stops once the game reports the item worn, and reports when it never does', async () => {
  // The reference loops until IsEquipped with no bound. Over a bridge a window that went away
  // mid-command would spin the app, so this build stops at EQUIP_TRIES and says what it saw.
  let worn = false;
  const ok = fakeGame({
    'GetInventoryItems': function () {
      return [{ sName: 'Awe Blade', ItemID: 11, sType: 'Sword', bEquip: worn ? 1 : 0 }];
    },
    Equip: function () { worn = true; return null; }
  });
  const done = await run('CmdEquip', { ItemName: 'Awe Blade' }, null, { game: ok });
  assert.strictEqual(ok.calls.filter(function (c) { return c.name === 'Equip'; }).length, 1,
    'one send is enough once the game agrees');
  assert.deepStrictEqual(done.logs, []);

  const never = fakeGame({
    'GetInventoryItems': [{ sName: 'Awe Blade', ItemID: 11, sType: 'Sword', bEquip: 0 }],
    Equip: function () { return null; }
  });
  const failed = await run('CmdEquip', { ItemName: 'Awe Blade' }, null, { game: never });
  assert.strictEqual(never.calls.filter(function (c) { return c.name === 'Equip'; }).length,
    items.EQUIP_TRIES, 'the loop is bounded at the number this module declares');
  assert.ok(failed.logs.join(' ').indexOf(String(items.EQUIP_TRIES)) !== -1,
    JSON.stringify(failed.logs));
});

test('CmdEquip with Safe waits out combat and the equip lock; without Safe it does neither', async () => {
  // CmdEquip.cs's `if (Safe)` block: leave combat, then WaitUntil IsActionAvailable(EquipItem).
  const unsafe = fakeGame({
    'GetInventoryItems': [{ sName: 'Awe Blade', ItemID: 11, sType: 'Sword', bEquip: 0 }],
    Equip: function () { return null; }
  });
  await run('CmdEquip', { ItemName: 'Awe Blade' }, null, { game: unsafe });
  assert.strictEqual(unsafe.asked().indexOf('IsActionAvailable'), -1,
    'an unsafe equip never asks for the lock');

  let fighting = true;
  let worn = false;
  const safe = fakeGame({
    'GetInventoryItems': function () {
      return [{ sName: 'Awe Blade', ItemID: 11, sType: 'Sword', bEquip: worn ? 1 : 0 }];
    },
    IsActionAvailable: true,
    IsLoggedIn: true,
    // In combat once, then out, so the reference's own one-second refresh loop is exercised and
    // still ends - the second pass finds the character out of combat and goes straight to the lock.
    State: function () { const was = fighting; fighting = false; return was ? 2 : 1; },
    Equip: function () { worn = true; return null; }
  });
  const r = await run('CmdEquip', { ItemName: 'Awe Blade', Safe: true }, null, { game: safe });
  const order = safe.asked();
  const asked = order.indexOf('State');
  assert.deepStrictEqual(order.slice(asked, asked + 4), ['State', 'Cell', 'Pad', 'Jump'],
    'Safe asks the game whether it is in combat, then refreshes the cell if it is: ' +
    JSON.stringify(order));
  assert.ok(r.slept.indexOf(1000) !== -1, 'at the reference interval of one second');
  assert.ok(order.indexOf('Equip') > order.indexOf('IsActionAvailable'),
    'and only then sends the equip: ' + JSON.stringify(order));
});

test('an item that is not equippable is refused by name rather than sent', async () => {
  // InventoryItem.EquippableCategories is what all four resolution steps filter on, so a row whose
  // category is not on that list can never be the target - and the command says so.
  const game = fakeGame({
    'GetInventoryItems': [{ sName: 'Dragon Runestone', ItemID: 9, sType: 'Resource' }]
  });
  const r = await run('CmdEquip', { ItemName: 'Dragon Runestone' }, null, { game: game });
  assert.strictEqual(game.argsFor('Equip'), null);
  assert.ok(r.logs.some(function (line) { return line.indexOf('Dragon Runestone') !== -1; }),
    JSON.stringify(r.logs));
});

test('CmdEquipSet says where this build reads a set from, rather than wearing something similar', async () => {
  // CmdEquipSet.cs reads a .gset from Application.StartupPath. This build has no handle on the
  // reference's own folder, so entries have to come from the Sets dialog's read; without them the
  // command must not guess, because a guess wears the wrong gear.
  const game = fakeGame({
    'GetInventoryItems': [{ sName: 'Awe Blade', ItemID: 11, sType: 'Sword' }]
  });
  const r = await run('CmdEquipSet', { ItemName: 'Sets/red.gset' }, null, { game: game });
  assert.strictEqual(game.argsFor('Equip'), null, 'nothing may be worn without the set');
  assert.ok(r.logs.join(' ').indexOf('Sets dialog') !== -1, JSON.stringify(r.logs));
});

test('CmdEquipSet wears the entries the Sets dialog read, and skips the ones the bag cannot match', async () => {
  const game = fakeGame({
    'GetInventoryItems': [
      { sName: 'Awe Blade', ItemID: 11, sType: 'Sword', bEquip: 0 },
      { sName: 'Dragon Runestone', ItemID: 9, sType: 'Resource' }
    ],
    IsActionAvailable: true,
    IsLoggedIn: true,
    Equip: function () { return null; }
  });
  const r = await run('CmdEquipSet', { ItemName: 'red.gset' }, null, {
    game: game, setEntries: [{ name: 'Awe Blade' }, { name: 'Missing Cape' }, { name: 'Dragon Runestone' }]
  });
  assert.deepStrictEqual(game.argsFor('Equip'), ['11'], 'only the entry the bag can wear is sent');
  assert.ok(r.logs.join(' ').indexOf('Missing Cape') !== -1, JSON.stringify(r.logs));
  assert.ok(r.logs.join(' ').indexOf('Dragon Runestone') !== -1, JSON.stringify(r.logs));
});

// ---------------------------------------------------------------------------- banking

// A bag and a bank that actually move items, so a transfer's own wait can be seen to end.
function bankGame(options) {
  const opts = options || {};
  const bag = opts.bag ? opts.bag.slice() : [];
  const bank = opts.bank ? opts.bank.slice() : [];
  function find(list, name) {
    const want = String(name).toLowerCase();
    return list.filter(function (i) {
      return String(i.sName).toLowerCase() === want;
    })[0] || null;
  }
  return fakeGame({
    IsLoggedIn: true,
    GetInventoryItemByName: function (args) { return find(bag, args[0]); },
    GetBankItemByName: function (args) { return find(bank, args[0]); },
    TransferToBank: function (args) {
      const item = find(bag, args[0]);
      if (item) { bag.splice(bag.indexOf(item), 1); bank.push(item); }
      return null;
    },
    TransferToInventory: function (args) {
      const item = find(bank, args[0]);
      if (item) { bank.splice(bank.indexOf(item), 1); bag.push(item); }
      return null;
    },
    BankSwap: function () { return null; }
  }, opts);
}

test('CmdBankTransfer into the bank exits combat first, then waits on the bag at 200 ms', async () => {
  // CmdBankTransfer.cs: ExitCombat(2000) before anything else, then Player.Bank.TransferToBank and
  // instance.WaitUntil(() => !Player.Inventory.ContainsItem(name, '*'/qty), interval: 200).
  const game = bankGame({ bag: [{ sName: 'Iron Sword', ItemID: 1, iQty: 1 }] });
  const r = await run('CmdBankTransfer', { ItemName: 'Iron Sword' }, null, { game: game });
  assert.strictEqual(game.asked()[0], 'State', 'combat is asked about before the transfer');
  assert.strictEqual(game.asked().indexOf('TransferToBank'), 2,
    'the item is looked up in the bag, then the transfer goes out');
  assert.deepStrictEqual(r.slept, [],
    'out of combat, ExitCombat(2000) moves nothing and waits nothing - its delay is the ' +
    'in-combat path only');
});

test('CmdBankTransfer in combat moves out first and waits the reference 2000 ms', async () => {
  // Player.ExitCombat: only a character the game reports as InCombat is moved, and then it waits
  // its own 100 ms, refreshes the cell and waits the caller's delay.
  const game = bankGame({ bag: [{ sName: 'Iron Sword', ItemID: 1, iQty: 1 }] });
  game.answers.State = 2;
  const r = await run('CmdBankTransfer', { ItemName: 'Iron Sword' }, null, { game: game });
  assert.deepStrictEqual(game.asked().slice(0, 4), ['State', 'Cell', 'Pad', 'Jump'],
    'the refresh is the loader own Jump on the cell the character stands in');
  assert.deepStrictEqual(r.slept, [100, 2000], 'then the reference own two waits, in order');
});

test('CmdBankTransfer from the bank moves the other way, on the flag', async () => {
  // The same body: if the bank holds the name, Player.Bank.TransferFromBank - the loader's
  // TransferToInventory - and the wait is for the bag to gain it instead of lose it.
  const game = bankGame({ bank: [{ sName: 'Iron Sword', ItemID: 1, iQty: 1 }] });
  await run('CmdBankTransfer', { ItemName: 'Iron Sword', TransferFromBank: true }, null, { game: game });
  assert.ok(game.asked().indexOf('TransferToInventory') !== -1, JSON.stringify(game.asked()));
  assert.strictEqual(game.asked().indexOf('TransferToBank'), -1, 'only one direction is taken');
});

test('a bank transfer whose item is on neither side logs the reference line and sends nothing', async () => {
  // The reference's own else branch: LogForm.Instance.devDebug('[Bank] {ItemName} not found
  // within your ' + (TransferFromBank ? 'Bank' : 'Inventory')).
  const toBank = await run('CmdBankTransfer', { ItemName: 'Ghost Blade' }, null, { game: bankGame() });
  assert.strictEqual(toBank.game.asked().indexOf('TransferToBank'), -1);
  assert.ok(toBank.logs.some(function (line) {
    return line === '[Bank] Ghost Blade not found within your Inventory';
  }), JSON.stringify(toBank.logs));

  const fromBank = await run('CmdBankTransfer', { ItemName: 'Ghost Blade', TransferFromBank: true },
    null, { game: bankGame() });
  assert.ok(fromBank.logs.some(function (line) {
    return line === '[Bank] Ghost Blade not found within your Bank';
  }), JSON.stringify(fromBank.logs));
});

test('CmdBankSwap needs both names before it swaps, and one missing means no swap at all', async () => {
  // CmdBankSwap.cs: if the bank holds the bank name and the bag holds the inventory name, then
  // Player.Bank.Swap(inv, bank), then WaitUntil the same test stops holding.
  const both = bankGame({
    bag: [{ sName: 'Iron Sword', ItemID: 1, iQty: 1 }],
    bank: [{ sName: 'Steel Blade', ItemID: 2, iQty: 1 }]
  });
  await run('CmdBankSwap', { InventoryItemName: 'Iron Sword', BankItemName: 'Steel Blade' },
    null, { game: both });
  assert.deepStrictEqual(both.argsFor('BankSwap'), ['Iron Sword', 'Steel Blade'],
    'the loader name takes the inventory item first, the bank item second');

  const half = bankGame({ bag: [{ sName: 'Iron Sword', ItemID: 1, iQty: 1 }] });
  const r = await run('CmdBankSwap', { InventoryItemName: 'Iron Sword', BankItemName: 'Steel Blade' },
    null, { game: half });
  assert.strictEqual(half.argsFor('BankSwap'), null, 'nothing is swapped without both names');
  assert.ok(r.logs.length > 0, 'and the refusal is logged');
});

// ---------------------------------------------------------------------------- drops and map items

test('CmdGetDrop sends the game own frame, with the room the loader answers', async () => {
  // DropStack.cs:GetDrop resolves the name against the drop stack, then sends
  // %xt%zm%getDrop%<room>%<itemId>% through the proxy. RoomId is a loader name, so it is asked
  // for by that name rather than spelled out, and the id comes from the tree the game files
  // drops in (world.invTree).
  const frame = '%xt%zm%getDrop%';
  const game = fakeGame({
    RoomId: '12345',
    'world.invTree': { '7': { sName: 'Iron Sword', ItemID: 7 } }
  });
  const r = await run('CmdGetDrop', { ItemName: 'Iron Sword' }, null, { game: game });
  assert.deepStrictEqual(game.frames, [{ direction: 'toServer', text: frame + '12345%7%' }]);
  assert.ok(r.slept.indexOf(500) !== -1, 'the reference waits 500 ms after the frame');
});

test('CmdGetDrop refuses a name no drop carries rather than sending a frame for nothing', async () => {
  const game = fakeGame({ RoomId: '1', 'world.invTree': {} });
  await assert.rejects(function () {
    return run('CmdGetDrop', { ItemName: 'Ghost Blade' }, null, { game: game });
  }, /Ghost Blade/);
  assert.deepStrictEqual(game.frames, [], 'no frame may be sent for a name nothing answers');
});

test('a drop frame with no live relay is a refusal rather than a silent success', async () => {
  // The platform's packet path answers false when the relay has no connection, and a bot waiting on
  // a frame that never went out looks exactly like a game that refused it.
  const game = fakeGame({ RoomId: '1', 'world.invTree': { '7': { sName: 'Iron Sword', ItemID: 7 } } },
    { relay: false });
  await assert.rejects(function () {
    return run('CmdGetDrop', { ItemName: 'Iron Sword' }, null, { game: game });
  }, /relay/);
});

test('CmdMapItem waits the map-item lock, takes the item, then waits 1500 ms', async () => {
  // CmdMapItem.cs: WaitUntil(IsActionAvailable(GetMapItem)), Player.GetMapItem(ItemId), then
  // Task.Delay(1500).
  const game = fakeGame({
    IsLoggedIn: true, IsActionAvailable: true, GetMapItem: function () { return null; }
  });
  const r = await run('CmdMapItem', { ItemId: 42 }, null, { game: game });
  assert.deepStrictEqual(game.argsFor('GetMapItem'), ['42']);
  assert.strictEqual(game.asked()[0], 'IsActionAvailable', 'the lock comes first');
  assert.ok(r.slept.indexOf(1500) !== -1);
});

// ---------------------------------------------------------------------------- the pickup whitelist

test('CmdWhitelist On, Off and Toggle drive EnablePickup, Toggle reading the current value', async () => {
  // CmdWhitelist.cs's State enum is zero-based On, Off, Toggle, Add, Remove, and only the first
  // three touch EnablePickup - the other two edit the Drops list.
  const on = await run('CmdWhitelist', { state: 0 }, null, { config: { EnablePickup: false } });
  assert.strictEqual(on.config.EnablePickup, true);
  const off = await run('CmdWhitelist', { state: 1 }, null, { config: { EnablePickup: true } });
  assert.strictEqual(off.config.EnablePickup, false);
  const flipped = await run('CmdWhitelist', { state: 2 }, null, { config: { EnablePickup: false } });
  assert.strictEqual(flipped.config.EnablePickup, true);
  assert.strictEqual(flipped.config.Drops, undefined, 'a toggle never edits the drop list');
});

test('CmdWhitelist Add and Remove edit the drop list, and Add twice does not double it', async () => {
  // Configuration.Drops is the reference's own list. Add puts the name on it (without duplicating
  // a name already there) and Remove takes the name off it.
  const added = await run('CmdWhitelist', { state: 3, ItemName: 'Iron Sword' }, null,
    { config: { Drops: ['Steel Blade'] } });
  assert.deepStrictEqual(added.config.Drops, ['Steel Blade', 'Iron Sword']);

  const again = await run('CmdWhitelist', { state: 3, ItemName: 'Iron Sword' }, null,
    { config: { Drops: ['Iron Sword'] } });
  assert.deepStrictEqual(again.config.Drops, ['Iron Sword']);

  const removed = await run('CmdWhitelist', { state: 4, ItemName: 'Iron Sword' }, null,
    { config: { Drops: ['Iron Sword', 'Steel Blade'] } });
  assert.deepStrictEqual(removed.config.Drops, ['Steel Blade']);
});

test('CmdWhitelist keeps whatever shape the document held for Drops', async () => {
  // The reference's own files wrap their lists as { $values: [...] }, and a command that wrote a
  // bare array there would not round-trip through the reader.
  const wrapped = await run('CmdWhitelist', { state: 3, ItemName: 'Iron Sword' }, null,
    { config: { Drops: { $values: ['Steel Blade'] } } });
  assert.deepStrictEqual(wrapped.config.Drops, { $values: ['Steel Blade', 'Iron Sword'] });
});

// ---------------------------------------------------------------------------- quests

// A quest tree with one quest, and the reads a quest command makes. Every quest command resolves
// its row out of the tree the loader's own GetQuestTree answers (world.questTree).
function questGame(quest, options) {
  const opts = options || {};
  const state = opts.state || {};
  const row = Object.assign({
    QuestID: 31, sName: 'A Test Quest', turnin: [], reward: [], iSlot: 0, iValue: 0, bOnce: 0
  }, quest || {});
  if (opts.unloaded) state.tree = [];
  const answers = {
    IsLoggedIn: true,
    // GetQuestTree is the loader's own name for world.questTree as a list, so it is asked for by
    // that name - the surface knows the path its body reads. A quest that has not been loaded is
    // simply absent from that list, which is exactly what HasQuest reads.
    GetQuestTree: function () { return state.tree || [row]; },
    IsInProgress: function () { return state.inProgress === true; },
    CanComplete: function () { return state.canComplete === true; },
    LoadQuest: function () { state.loaded = true; state.tree = [row]; return null; },
    Accept: function () { state.accepted = true; return null; },
    Complete: function (args) { state.completed = args; return null; },
    GetInventoryItems: function () { return state.bag || []; },
    GetTempItems: function () { return state.temp || []; },
    'world.maximumQuestTurnIns': 3,
    'world.getQuestValue': state.progress === undefined ? 0 : state.progress
  };
  const game = fakeGame(answers, opts);
  game.state = state;
  return game;
}

test('CmdAcceptQuest loads the quest, waits for it, then accepts twice at most', async () => {
  // CmdAcceptQuest.cs: if the quest is not loaded, Load then WaitUntil(HasQuest) timeout 3; then
  // the while loop - !IsInProgress && IsLoggedIn && IsRunning && i < 2 - Accept and 600 ms.
  const game = questGame({}, { unloaded: true });
  await run('CmdAcceptQuest', { Quest: { QuestID: 31 } }, null, { game: game });
  assert.strictEqual(game.state.loaded, true, 'an unloaded quest is loaded');
  assert.strictEqual(game.argsFor('LoadQuest')[0], '31');
  assert.strictEqual(game.calls.filter(function (c) { return c.name === 'Accept'; }).length,
    items.ACCEPT_TRIES, 'the reference caps its own attempts at two, and neither took');
});

test('CmdAcceptQuest stops accepting as soon as the game reports the quest in progress', async () => {
  // The loop's own first term: the reference accepts only while the quest is NOT in progress. A
  // quest the tree already holds is never loaded, and the first accept that takes ends the loop -
  // the second pass sees the game's answer and sends nothing.
  let inProgress = false;
  const game = questGame({});
  game.answers.IsInProgress = function () { return inProgress; };
  game.answers.Accept = function () { inProgress = true; return null; };
  await run('CmdAcceptQuest', { Quest: { QuestID: 31 } }, null, { game: game });
  assert.strictEqual(game.calls.filter(function (c) { return c.name === 'Accept'; }).length, 1,
    'the second pass sees it in progress and stops');
  assert.strictEqual(game.calls.filter(function (c) { return c.name === 'LoadQuest'; }).length, 0,
    'a quest already in progress is not loaded at all');
});

test('CmdAcceptQuest skips a one-shot quest whose slot is already satisfied', async () => {
  // Quest.IValue <= Player.Quests.progress(Quest.ISlot) && Quest.ISlot != 0 && IsNotRepeatable -
  // the reference's own three-part guard, and the log line it writes when it holds.
  const game = questGame({ iSlot: 7, iValue: 10, bOnce: 1 }, { state: { progress: 10 } });
  const r = await run('CmdAcceptQuest', { Quest: { QuestID: 31 } }, null, { game: game });
  assert.strictEqual(game.calls.filter(function (c) { return c.name === 'Accept'; }).length, 0);
  assert.ok(r.logs.some(function (line) { return /Skipping quest/.test(line) && /31/.test(line); }),
    JSON.stringify(r.logs));
  assert.ok(r.logs.some(function (line) { return /10\/10/.test(line); }),
    'the reference prints progress/value: ' + JSON.stringify(r.logs));
});

test('a one-shot quest whose slot is not yet satisfied is accepted, and a repeatable one always is', async () => {
  // The same guard, each of its three terms given a chance to fail: progress below the value,
  // a zero slot, and a repeatable quest.
  const behind = questGame({ iSlot: 7, iValue: 10, bOnce: 1 }, { state: { progress: 3 } });
  await run('CmdAcceptQuest', { Quest: { QuestID: 31 } }, null, { game: behind });
  assert.ok(behind.calls.some(function (c) { return c.name === 'Accept'; }), 'progress below value');

  const noSlot = questGame({ iSlot: 0, iValue: 10, bOnce: 1 }, { state: { progress: 99 } });
  await run('CmdAcceptQuest', { Quest: { QuestID: 31 } }, null, { game: noSlot });
  assert.ok(noSlot.calls.some(function (c) { return c.name === 'Accept'; }), 'a zero slot never skips');

  const repeatable = questGame({ iSlot: 7, iValue: 10, bOnce: 0 }, { state: { progress: 99 } });
  await run('CmdAcceptQuest', { Quest: { QuestID: 31 } }, null, { game: repeatable });
  assert.ok(repeatable.calls.some(function (c) { return c.name === 'Accept'; }),
    'a repeatable quest is never skipped');
});

test('CmdAcceptQuest says when the tree holds no such quest, rather than accepting nothing', async () => {
  const game = questGame({}, { unloaded: true });
  game.answers.LoadQuest = function () { return null; };
  game.state.tree = [];
  const r = await run('CmdAcceptQuest', { Quest: { QuestID: 31 } }, null, { game: game });
  assert.strictEqual(game.calls.filter(function (c) { return c.name === 'Accept'; }).length, 0);
  assert.ok(r.logs.some(function (line) { return /not found/.test(line); }), JSON.stringify(r.logs));
});

test('ghost accept sends the reference frame and waits, without touching the loader', async () => {
  // Quest.GhostAccept: %xt%zm%acceptQuest%1%{Id}% through the socket, then Task.Delay(600). The
  // loader's Accept is never called on that path.
  const game = questGame({});
  const r = await run('CmdAcceptQuest', { Quest: { QuestID: 31 }, ghostAccept: true }, null,
    { game: game });
  assert.deepStrictEqual(game.frames, [{ direction: 'toServer', text: '%xt%zm%acceptQuest%1%31%' }]);
  assert.strictEqual(game.calls.filter(function (c) { return c.name === 'Accept'; }).length, 0);
  assert.ok(r.slept.indexOf(600) !== -1, 'the reference waits 600 ms after the frame');
});

test('CmdCompleteQuest turns in once, and -1 or less means as many as the game allows', async () => {
  // CmdCompleteQuest.cs: CompleteTry defaults to 1; -1 or less sets max, which Quest.Complete
  // turns into getMax() before the loader Complete call.
  const once = questGame({});
  await run('CmdCompleteQuest', { Quest: { QuestID: 31 }, CompleteTry: 1 }, null, { game: once });
  assert.deepStrictEqual(once.state.completed, ['31', '1', '-1', 'False'],
    'the loader Complete(id, qty, itemId, autoSelect) argument order');

  // A quest with no required items: Quest.getMax starts at its own 10000, the loop never lowers
  // it, and Math.Max(alt, complete) keeps the 10000 - which is exactly what the reference sends.
  const bare = questGame({});
  await run('CmdCompleteQuest', { Quest: { QuestID: 31 }, CompleteTry: -1 }, null, { game: bare });
  assert.deepStrictEqual(bare.state.completed, ['31', '10000', '-1', 'False'],
    'the reference own starting 10000 stands when nothing lowers it');
});

test('Quest.getMax counts the required items the bag and the temp bag hold, per turn-in', async () => {
  // Quest.getMax: for each RequiredItems row, owned / required, the smallest wins; a row marked
  // temporary is looked for in Player.TempInventory. Then Math.Max with the game's own answer.
  const quest = {
    QuestID: 31,
    reqd: [
      { ItemID: 5, iQty: 2 },
      { ItemID: 6, iQty: 1, bTemp: 1 }
    ]
  };
  const game = questGame(quest, {
    state: { bag: [{ sName: 'Bone', ItemID: 5, iQty: 9 }], temp: [{ sName: 'Fang', ItemID: 6, iQty: 11 }] }
  });
  await run('CmdCompleteQuest', { Quest: { QuestID: 31 }, CompleteTry: -1 }, null, { game: game });
  assert.deepStrictEqual(game.state.completed, ['31', '4', '-1', 'False'],
    'floor(9/2) = 4 beats floor(11/1) = 11, and 4 beats the game own 3');
});

test('CmdCompleteQuest carries the quest own ItemId when it has one, and -1 when it does not', async () => {
  // Quest.Complete: with an ItemId it is handed over; without one the loader default '-1' stands.
  const withId = questGame({});
  await run('CmdCompleteQuest', { Quest: { QuestID: 31, ItemId: '9001' }, CompleteTry: 1 }, null,
    { game: withId });
  assert.deepStrictEqual(withId.state.completed, ['31', '1', '9001', 'False']);
});

test('CmdCompleteQuest holds provoke off across the turn-in and puts it back', async () => {
  // `bool provokeMons = Configuration.ProvokeMonsters; if (provokeMons) ... = false;` around the
  // completion, and the value restored after it - including when the completion itself failed.
  const on = await run('CmdCompleteQuest', { Quest: { QuestID: 31 } }, null,
    { config: { ProvokeMonsters: true } });
  assert.strictEqual(on.config.ProvokeMonsters, true, 'the reference puts the value back');

  const off = await run('CmdCompleteQuest', { Quest: { QuestID: 31 } }, null,
    { config: { ProvokeMonsters: false } });
  assert.strictEqual(off.config.ProvokeMonsters, false);
});

test('CmdCompleteQuest refreshes the cell when ExitCombatBeforeQuest, then waits out the state', async () => {
  // `if (instance.Configuration.ExitCombatBeforeQuest) { Player.refreshCell(); await WaitUntil(
  // () => Player.CurrentState != Player.State.InCombat); await Task.Delay(1000); }`.
  let fighting = true;
  const game = questGame({});
  game.answers.State = function () { const was = fighting; fighting = false; return was ? 2 : 1; };
  const r = await run('CmdCompleteQuest', { Quest: { QuestID: 31 } }, null,
    { game: game, config: { ExitCombatBeforeQuest: true } });
  const order = game.asked();
  assert.deepStrictEqual(order.slice(order.indexOf('Cell'), order.indexOf('Cell') + 3),
    ['Cell', 'Pad', 'Jump'], 'the cell is refreshed first');
  assert.ok(order.indexOf('Complete') > order.indexOf('Jump'), 'and the turn-in follows');
  assert.ok(r.slept.indexOf(1000) !== -1, 'then the reference own 1000 ms');
});

test('CmdCompleteQuest ReAccept waits for the quest to leave both states, then ghost accepts', async () => {
  // `await WaitUntil(() => !Quest.IsInProgress && !Quest.CanComplete, interval: 400, timeout: 5);
  // Quest.GhostAccept();` - and the BotDelay branch is skipped entirely on that path.
  const game = questGame({}, { state: { inProgress: false, canComplete: false } });
  const r = await run('CmdCompleteQuest', { Quest: { QuestID: 31 }, ReAccept: true }, null,
    { game: game, config: { BotDelay: 0 } });
  assert.deepStrictEqual(game.frames, [{ direction: 'toServer', text: '%xt%zm%acceptQuest%1%31%' }]);
  assert.strictEqual(r.slept.indexOf(1100), -1, 'the ReAccept path never waits the BotDelay branch');
});

test('CmdCompleteQuest without ReAccept waits 1100 minus BotDelay, and nothing above 1000', async () => {
  // `int delay = instance.Configuration.BotDelay <= 1000 ? 1100-instance.Configuration.BotDelay : 0;`
  const quick = await run('CmdCompleteQuest', { Quest: { QuestID: 31 } }, null,
    { config: { BotDelay: 100 } });
  assert.ok(quick.slept.indexOf(1000) !== -1, JSON.stringify(quick.slept));

  // Above 1000 the expression is 0, which is the reference's own Task.Delay(0): a wait that is
  // real but empty, and never a negative one.
  const slow = await run('CmdCompleteQuest', { Quest: { QuestID: 31 } }, null,
    { config: { BotDelay: 5000 } });
  assert.deepStrictEqual(slow.slept, [0], 'a BotDelay above 1000 waits nothing extra');
  assert.ok(slow.slept.every(function (ms) { return ms >= 0; }), 'never a negative wait');
});

// ---------------------------------------------------------------------------- the quest list commands

test('CmdAddQuestList ghost accepts, then adds the row when the id is not already listed', async () => {
  // CmdAddQuestList.cs: a Quest row is built and ghost-accepted; then, only if no row with that
  // id is already in Configuration.Quests, it is added (and the quest list restarted).
  const game = questGame({});
  const empty = await run('CmdAddQuestList', { Id: 31, ItemId: '9001', SafeRelogin: true }, null,
    { game: game, config: { Quests: [] } });
  assert.deepStrictEqual(game.frames, [{ direction: 'toServer', text: '%xt%zm%acceptQuest%1%31%' }],
    'the ghost accept is the first thing the command does');
  assert.deepStrictEqual(empty.config.Quests, [
    { $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 31, ItemId: '9001', SafeRelogin: true }
  ]);

  const again = await run('CmdAddQuestList', { Id: 31, ItemId: '9001' }, null, {
    game: questGame({}),
    config: { Quests: [{ $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 31 }] }
  });
  assert.strictEqual(again.config.Quests.length, 1, 'an id already listed is not added twice');
});

test('CmdRemoveQuestList matches all three fields, which is stricter than its Add twin', async () => {
  // CmdRemoveQuestList.cs removes the row where Id AND ItemId AND SafeRelogin all match. The
  // reference's own file only ever reaches that line when an id is listed, so the strictness is
  // what is asserted: a row that differs in either other field stays.
  const listed = [
    { $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 31, ItemId: '9001', SafeRelogin: true },
    { $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 31, ItemId: '9002' },
    { $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 32, ItemId: '9001', SafeRelogin: true }
  ];
  const exact = await run('CmdRemoveQuestList', { Id: 31, ItemId: '9001', SafeRelogin: true }, null,
    { config: { Quests: listed.slice() } });
  assert.deepStrictEqual(exact.config.Quests.map(function (q) { return q.QuestID + ':' + q.ItemId; }),
    ['31:9002', '32:9001'],
    'only the row matching all three fields goes');
});

test('the quest list commands keep whatever shape the document held for Quests', async () => {
  const wrapped = await run('CmdRemoveQuestList', { Id: 31, ItemId: '9001' }, null,
    { config: { Quests: { $values: [{ $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 31, ItemId: '9001' }] } } });
  assert.deepStrictEqual(wrapped.config.Quests, { $values: [] });
});

// ---------------------------------------------------------------------------- the engine seam

test('a saved bot carrying item and quest commands runs end to end on the engine', async () => {
  // The engine dispatches the vocabulary this module registers (engine.js's extraHandlers), so a
  // file the reference saved - CmdBuy, CmdAcceptQuest, CmdDelay, CmdStop - runs in the loop.
  const engineModel = require('../../plugins/grimlite-parity/bot/engine.js');
  const game = shopGame({});
  const access = items.createAccess({
    loaderCall: game.loaderCall,
    call: game.call,
    sendFrame: game.sendFrame,
    sleep: function () { return Promise.resolve(); }
  });
  const logs = [];
  const engine = engineModel.createEngine({
    session: {
      signedIn: function () { return Promise.resolve(true); },
      alive: function () { return Promise.resolve(true); },
      ready: function () { return Promise.resolve(true); },
      username: function () { return Promise.resolve('Tester'); },
      health: function () { return Promise.resolve(100); },
      healthMax: function () { return Promise.resolve(100); },
      mana: function () { return Promise.resolve(100); },
      manaMax: function () { return Promise.resolve(100); }
    },
    handlers: items.handlers(access),
    sleep: function () { return Promise.resolve(); },
    log: function (line) { logs.push(line); }
  });
  const bot = {
    Commands: [
      command('CmdBuy', { ShopId: 1, ItemName: 'Iron Sword', Qty: 1 }),
      command('CmdStop', {})
    ]
  };
  const started = await engine.start(bot);
  assert.strictEqual(started.ok, true, JSON.stringify(started));
  await engine.run();
  assert.ok(game.argsFor('BuyItemQty'), 'the buy reached the game through the engine');
  assert.ok(engine.dispatched().some(function (row) { return row.className === 'CmdBuy'; }));
  assert.strictEqual(logs.filter(function (line) { return /not implemented yet/.test(line); }).length,
    0, 'no item command may be reported as unimplemented: ' + JSON.stringify(logs));
});

// ---------------------------------------------------------------------------- provoking

test('provoke is off while a wrapped transaction is running, and a command that is not wrapped leaves it alone', async () => {
  // BotUtilities.cs:pauseProvoke - ProvokeMonsters is set false for the using-block and restored to
  // the value it found on Dispose. CmdBuyFast, CmdLoad, CmdSell and CmdEquip wrap their work in
  // one, because provoking mid-purchase pulls a monster onto the character; CmdBuy does not.
  const during = [];
  const game = shopGame({ bag: [{ sName: 'Iron Sword', ItemID: 1, iQty: 7 }] });
  const config = { ProvokeMonsters: true };
  game.answers.SellItem = function () { during.push(config.ProvokeMonsters); return null; };
  await run('CmdSell', { ItemName: 'Iron Sword', Qty: '1' }, null, { game: game, config: config });
  assert.deepStrictEqual(during, [false], 'CmdSell sells with provoke off');
  assert.strictEqual(config.ProvokeMonsters, true, 'and puts it back');

  const buyConfig = { ProvokeMonsters: true };
  const buyGame = shopGame({});
  buyGame.answers.BuyItemQty = function () { during.push(buyConfig.ProvokeMonsters); return null; };
  await run('CmdBuy', { ShopId: 1, ItemName: 'Iron Sword', Qty: 1 }, null,
    { game: buyGame, config: buyConfig });
  assert.strictEqual(during[1], true, 'CmdBuy is not one of the wrapped commands');
});
