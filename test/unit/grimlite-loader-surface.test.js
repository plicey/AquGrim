// Ticket #48: the reference loader's helper surface, answered by our bridge.
//
// The reference calls helper names its own loader registers (Loader/grimoire.swf) and roughly 100
// of which the stock game does not carry. Those names used to be unanswerable - the game replies
// "no member <name> at world" - and this module implements them as a table over the bridge's
// generic callbacks, so they answer with no rebuilt SWF.
//
// What is asserted here, and why each matters:
//   * the table covers every name the reference registers, checked against the loader's own
//     Externalizer.as init() captured as a fixture, so a feature ticket can assert a name exists
//     instead of discovering it does not;
//   * an implemented name reads the path its loader body reads - the mapping is the load-bearing
//     claim, and every expectation below names the loader file it came from;
//   * a name the surface cannot answer fails with the reason, never a bare "no member";
//   * nothing is invented: a name neither the game nor the reference has is refused as unknown.
//
// The fixture came from the decompiled loader, not from this code:
//   /var/tmp/aq48/out-loader/scripts/grimoire/Externalizer.as
//   /var/tmp/aq48/out-loader/scripts/grimoire/game/*.as

const assert = require('assert');
const path = require('path');
const surface = require('../../plugins/grimlite-parity/loader-surface.js');

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'grimlite-loader-surface', 'registered.json');

/**
 * A stand-in for the bridge: it answers the paths and calls a test named, and refuses everything
 * else in the movie's own words, so a typo in a path shows up as a failing expectation instead of
 * passing quietly.
 */
function fakeBridge(answers, calls) {
    const asked = [];
    const made = [];
    const bridge = {
        asked: asked,
        made: made,
        call: function (callback, args) {
            const name = args[0];
            if (callback === 'getGameObject') {
                asked.push(name);
                if (Object.prototype.hasOwnProperty.call(answers, name)) {
                    return Promise.resolve(answers[name]);
                }
                return Promise.reject(new Error('no member ' + name.split('.').pop() + ' at ' + name));
            }
            made.push({ callback: callback, path: name, args: args.slice(1) });
            if (Object.prototype.hasOwnProperty.call(calls, name)) {
                return Promise.resolve(calls[name]);
            }
            return Promise.reject(new Error('no member ' + name.split('.').pop() + ' at ' + name));
        }
    };
    return bridge;
}

function access(bridge) {
    return surface.createLoaderSurface(bridge.call);
}

test('the surface names every helper the reference loader registers', () => {
    const fixture = require(FIXTURE);
    const mine = surface.names();
    const missing = fixture.registered.filter((name) => mine.indexOf(name) === -1);
    // The seven generic callbacks are the bridge's own layer, which this ticket must not change
    // (the game already answers them); the fixture marks them so this check stays exact.
    const unaccounted = missing.filter((name) => fixture.generic.indexOf(name) === -1);
    assert.deepStrictEqual(unaccounted, [], 'the loader registers these and the surface omits them');
});

test('the surface invents no name the reference loader does not register', () => {
    const fixture = require(FIXTURE);
    const invented = surface.names().filter((name) => fixture.registered.indexOf(name) === -1);
    assert.deepStrictEqual(invented, [], 'these are not names the reference loader registers');
});

test('the implemented set is discoverable, so a feature ticket can assert what it needs', () => {
    const done = surface.implemented();
    ['GetInventoryItems', 'GetBankItems', 'BankSlots', 'UsedBankSlots', 'Health', 'Cell',
        'GetTempItems', 'HouseSlots', 'GetEquip', 'InventorySlots'].forEach((name) => {
        assert.ok(done.indexOf(name) !== -1, name + ' should be implemented');
    });
    assert.ok(done.length <= surface.names().length);
});

test('every read answers the path its own loader body reads', () => {
    // Each expectation is the return statement of that helper in
    // /var/tmp/aq48/out-loader/scripts/grimoire/game/*.as.
    const reads = {
        Cell: 'world.strFrame',
        Pad: 'world.strPad',
        Map: 'world.strMapName',
        Health: 'world.myAvatar.dataLeaf.intHP',
        HealthMax: 'world.myAvatar.dataLeaf.intHPMax',
        Mana: 'world.myAvatar.dataLeaf.intMP',
        ManaMax: 'world.myAvatar.dataLeaf.intMPMax',
        State: 'world.myAvatar.dataLeaf.intState',
        Level: 'world.myAvatar.dataLeaf.intLevel',
        Gold: 'world.myAvatar.objData.intGold',
        UserID: 'world.myAvatar.uid',
        CharID: 'world.myAvatar.objData.CharID',
        GetBankItems: 'world.bankinfo.items',
        BankSlots: 'world.myAvatar.objData.iBankSlots',
        UsedBankSlots: 'world.myAvatar.iBankCount',
        GetInventoryItems: 'world.myAvatar.items',
        InventorySlots: 'world.myAvatar.objData.iBagSlots',
        UsedInventorySlots: 'world.myAvatar.items.length',
        GetTempItems: 'world.myAvatar.tempitems',
        GetHouseItems: 'world.myAvatar.houseitems',
        HouseSlots: 'world.myAvatar.objData.iHouseSlots',
        GetItemTree: 'world.invTree',
        GetAvatars: 'world.avatars',
        Players: 'world.uoTree',
        PlayersInMap: 'world.areaUsers',
        PlayerData: 'world.myAvatar.objData',
        GetFactions: 'world.myAvatar.factions',
        GetTargetHealth: 'world.myAvatar.target.dataLeaf.intHP',
        RealAddress: 'objServerInfo.RealAddress',
        RealPort: 'objServerInfo.RealPort',
        ServerName: 'objServerInfo.sName'
    };
    const answers = {};
    Object.keys(reads).forEach((name) => { answers[reads[name]] = name; });
    const bridge = fakeBridge(answers, {});
    const game = access(bridge);
    const names = Object.keys(reads);
    return Promise.all(names.map((name) => game.call(name, []).then((value) => {
        assert.strictEqual(value, name, name + ' should read ' + reads[name]);
    }))).then(() => {
        const expectedPaths = names.map((name) => reads[name]);
        bridge.asked.forEach((asked) => {
            assert.ok(expectedPaths.indexOf(asked) !== -1, 'unexpected path read: ' + asked);
        });
    });
});

test('a read the loader shapes is shaped the same way here', () => {
    const bridge = fakeBridge({
        'world.myAvatar.dataLeaf.afk': 1,
        'world.myAvatar.objData.iUpgDays': 10,
        'world.myAvatar.objData.strClassName': 'dragonslayer',
        'world.myAvatar.objData.strGender': 'm',
        'world.curRoom': 42,
        'world.strAreaName': 'yokai-1234'
    }, {});
    const game = access(bridge);
    return Promise.all([
        game.call('IsAfk', []),
        game.call('IsMember', []),
        game.call('Class', []),
        game.call('Gender', []),
        game.call('RoomId', []),
        game.call('RoomNumber', [])
    ]).then((v) => {
        // Where the loader returns its own "True"/"False" strings, a JavaScript caller gets a
        // boolean: the quoting exists for its C# parser, not for a caller here.
        assert.strictEqual(v[0], true, 'IsAfk should be a boolean');
        assert.strictEqual(v[1], true, 'IsMember is iUpgDays >= 0');
        assert.strictEqual(v[2], 'DRAGONSLAYER', 'Class is upper-cased');
        assert.strictEqual(v[3], 'M', 'Gender is upper-cased');
        assert.strictEqual(v[4], '42', 'RoomId is a string of curRoom');
        assert.strictEqual(v[5], '1234', 'RoomNumber is the part after the dash');
    });
});

test('a call hands the game the arguments the loader shapes for it', () => {
    const bridge = fakeBridge({}, {
        'world.sendEquipItemRequest': 'ok',
        'world.moveToCell': 'ok',
        'world.tryQuestComplete': 'ok'
    });
    const game = access(bridge);
    return Promise.all([
        game.call('Equip', ['1234']),
        game.call('Jump', ['Enter']),
        game.call('Complete', ['99', 5, '-1', 'True'])
    ]).then(() => {
        const byPath = {};
        bridge.made.forEach((m) => { byPath[m.path] = m; });
        assert.deepStrictEqual(byPath['world.sendEquipItemRequest'].args,
            [{ ItemID: 1234 }], 'Equip parses its id');
        assert.deepStrictEqual(byPath['world.moveToCell'].args,
            ['Enter', 'Spawn'], 'Jump defaults the pad');
        assert.deepStrictEqual(byPath['world.tryQuestComplete'].args,
            [99, -1, true, 5], 'Complete reorders its four arguments');
    });
});

test('ShowBank calls the game own bank UI toggle', () => {
    const bridge = fakeBridge({}, { 'world.toggleBank': 'shown' });
    const game = access(bridge);
    return game.call('ShowBank', []).then(() => {
        assert.strictEqual(bridge.made[0].path, 'world.toggleBank');
        assert.deepStrictEqual(bridge.made[0].args, []);
    });
});

test('a transfer resolves the item by name, then hands the item object over', () => {
    // Bank.TransferToBank: Inventory.GetItemByName(name), then world.sendBankFromInvRequest(item).
    const inv = [{ sName: 'Sword', ItemID: 7, CharItemID: 70 }];
    const bridge = fakeBridge({ 'world.myAvatar.items': inv }, { 'world.sendBankFromInvRequest': 'ok' });
    const game = access(bridge);
    return game.call('TransferToBank', ['sword']).then(() => {
        assert.strictEqual(bridge.made[0].path, 'world.sendBankFromInvRequest');
        assert.strictEqual(bridge.made[0].args[0], inv[0], 'the item object itself is handed over');
    });
});

test('a transfer for an item the player does not have says so, and sends nothing', () => {
    const bridge = fakeBridge({ 'world.myAvatar.items': [] }, { 'world.sendBankFromInvRequest': 'ok' });
    const game = access(bridge);
    return game.call('TransferToBank', ['nothing']).then(() => {
        throw new Error('should have refused');
    }, (error) => {
        assert.ok(error.message.indexOf('nothing') !== -1, 'the refusal names the item');
        assert.strictEqual(bridge.made.length, 0, 'nothing should have been sent');
    });
});

test('a name the surface cannot answer fails with the reason, not a bare no member', () => {
    const game = access(fakeBridge({}, {}));
    // GetAurasValue is still refused - it reads live aura arrays, which is ticket #42's surface.
    // (This assertion used to name GetMonsterHealth, which ticket #38 implemented.)
    return game.call('GetAurasValue', []).then(() => {
        throw new Error('should have refused');
    }, (error) => {
        assert.ok(error.message.indexOf('loader') !== -1, 'the refusal says whose name it is');
        assert.ok(error.message.indexOf('#42') !== -1, 'the refusal says where that work lives');
        assert.ok(error.message.indexOf('no member') === -1, 'never a bare no member');
    });
});

test('a name neither the game nor the reference has is refused as unknown', () => {
    const game = access(fakeBridge({}, {}));
    return game.call('TeleportToPony', []).then(() => {
        throw new Error('should have refused');
    }, (error) => {
        assert.ok(error.message.indexOf('TeleportToPony') !== -1, 'the refusal names it');
    });
});

test('a path the game does not carry surfaces the game\'s own words', () => {
    const game = access(fakeBridge({}, {}));
    return game.call('Health', []).then(() => {
        throw new Error('should have refused');
    }, (error) => {
        assert.ok(error.message.indexOf('no member') === 0, 'the game\'s own message reaches the caller');
    });
});

test('an argument-less call goes through the zero-argument callback, as the loader keeps it', () => {
    const bridge = fakeBridge({}, { 'world.rest': 'ok', 'world.getQuests': 'ok' });
    const game = access(bridge);
    return Promise.all([game.call('Rest', []), game.call('GetQuests', ['1,2'])]).then(() => {
        assert.strictEqual(bridge.made[0].callback, 'callGameFunction0',
            'Rest takes no arguments and has its own callback');
        assert.strictEqual(bridge.made[1].callback, 'callGameFunction',
            'GetQuests takes an argument');
        assert.deepStrictEqual(bridge.made[1].args, [['1', '2']], 'GetQuests splits its list');
    });
});

test('a write goes through setGameObject with the value the loader parses', () => {
    const written = [];
    const game = surface.createLoaderSurface(function (callback, args) {
        if (callback === 'setGameObject') {
            written.push(args);
            return Promise.resolve(args[1]);
        }
        return Promise.resolve(null);
    });
    return game.call('SetWalkSpeed', ['30']).then(() => {
        assert.strictEqual(written.length, 1, 'one write');
        assert.strictEqual(written[0][0], 'world.WALKSPEED');
        assert.strictEqual(written[0][1], 30, 'the speed is parsed, as parseInt did');
    });
});

test('the skill readiness check reads every path the loader reads', () => {
    // IsSkillReady: the greater of the global cooldown left and this skill\'s own, both scaled by
    // the avatar\'s haste. A one-second cooldown that has just started should read about 1000.
    const bridge = fakeBridge({
        'world.actions.active.2.cd': 1000,
        'world.actions.active.2.ts': Date.now(),
        'world.GCD': 0,
        'world.GCDTS': Date.now(),
        'world.myAvatar.dataLeaf.sta.$tha': 0
    }, {});
    const game = access(bridge);
    return game.call('SkillAvailable', ['2']).then((value) => {
        assert.ok(typeof value === 'number' && value > 900 && value < 1100,
            'a just-started one-second cooldown reads about 1000, got ' + value);
    });
});

test('selectArrayObjects projects one field off each entry, as the loader does', () => {
    const bridge = fakeBridge({
        'world.myAvatar.items': [{ sName: 'Sword' }, { sName: 'Shield' }]
    }, {});
    const game = access(bridge);
    return game.call('selectArrayObjects', ['world.myAvatar.items', 'sName']).then((value) => {
        assert.deepStrictEqual(value, ['Sword', 'Shield']);
    });
});

test('a compute row can write, not only read and call', () => {
    // SetInfiniteRange is a compute row because its body is a loop over six writes. It used to
    // reach for a set the context did not expose and fail with "ctx.set is not a function" - a
    // compute row that cannot write is a hole in the surface, so this pins it.
    const written = [];
    const game = surface.createLoaderSurface(function (callback, args) {
        if (callback === 'setGameObject') {
            written.push(args);
            return Promise.resolve(args[1]);
        }
        return Promise.resolve('ok');
    });
    return game.call('SetInfiniteRange', []).then(() => {
        assert.strictEqual(written.length, 6, 'the loader writes slots 0 through 5');
        assert.deepStrictEqual(written.map((w) => w[0]), [
            'world.actions.active.0.range', 'world.actions.active.1.range',
            'world.actions.active.2.range', 'world.actions.active.3.range',
            'world.actions.active.4.range', 'world.actions.active.5.range'
        ]);
        written.forEach((w) => assert.strictEqual(w[1], 20000));
    });
});

test('the surface and the options adapter agree on the names they both route', () => {
    // Two tables describe the same loader bodies for the nine names the Options window uses.
    // They are allowed to exist, but they must not disagree: a name one routes and the other
    // refuses would give the app two answers for the same click.
    const calls = require('../../plugins/grimlite-parity/game-calls.js');
    const routed = Object.keys(calls.LOADER_ROUTE);
    const done = surface.implemented();
    const disagree = routed.filter((name) => done.indexOf(name) === -1);
    assert.deepStrictEqual(disagree, [],
        'these are routed by the options adapter and refused by the surface');
    const refused = Object.keys(calls.NO_ROUTE).filter((name) => done.indexOf(name) !== -1);
    assert.deepStrictEqual(refused, [],
        'these are refused by the options adapter and implemented by the surface');
});

// Ticket #39 put five more rows on the surface: the two quest reads its AcceptQuest and
// CompleteQuest need (Quests.as:GetQuestTree, :GetQuestValidationString behind IsAvailable and
// CanComplete) and the three shop writes its buying commands need (Shops.as:BuyItem, :BuyItemQty,
// :BuyItemQtyById). Each expectation below is the loader body it comes from.

test('GetQuestTree answers the tree as the list its loader body builds', () => {
  // Quests.as:GetQuestTree iterates Root.Game.world.questTree, clones each quest and pushes it,
  // so the answer is the tree's values as a list - the shape GetQuestTree returns in C#.
  const task = { QuestID: 31, sName: 'A task' };
  const bridge = fakeBridge({ 'world.questTree': { '31': task } }, {});
  const game = access(bridge);
  return game.call('GetQuestTree', []).then((tree) => {
    assert.deepStrictEqual(tree, [task], 'the tree keyed by id, as a list');
    assert.deepStrictEqual(bridge.asked, ['world.questTree']);
  });
});

test('IsAvailable answers the validation string emptiness, which is its own loader body', () => {
  // Quests.as:IsAvailable is GetQuestValidationString(id) == "" - so a quest that fails a check
  // is not available, and one the tree does not hold is 'Quest not found/loaded.'
  const bridge = fakeBridge({
    'world.questTree.31': { QuestID: 31, iSlot: -1, iLvl: 0, iClass: 0, FactionID: 0 },
    'world.myAvatar.objData.intLevel': 10
  }, {});
  const game = access(bridge);
  return game.call('IsAvailable', ['31']).then((available) => {
    assert.strictEqual(available, true, 'nothing fails, so the string is empty');
  }).then(() => {
    const missing = access(fakeBridge({ 'world.questTree.99': null }, {}));
    return missing.call('IsAvailable', ['99']).then((available) => {
      assert.strictEqual(available, false, 'a quest the tree does not hold is not available');
    });
  });
});

test('CanComplete is the validation string and the game own world.canTurnInQuest, both', () => {
  // Quests.as:CanComplete is world.canTurnInQuest(id) && GetQuestValidationString(id) == "".
  // Either half failing is a no, which is what makes the pair worth asserting separately.
  const quest = { QuestID: 31, iSlot: -1, iLvl: 0, iClass: 0, FactionID: 0 };
  const there = { 'world.questTree.31': quest, 'world.myAvatar.objData.intLevel': 10 };
  const both = access(fakeBridge(there, { 'world.canTurnInQuest': true }));
  return both.call('CanComplete', ['31']).then((done) => {
    assert.strictEqual(done, true);
  }).then(() => {
    const gameRefused = access(fakeBridge(there, { 'world.canTurnInQuest': false }));
    return gameRefused.call('CanComplete', ['31']);
  }).then((done) => {
    assert.strictEqual(done, false, 'the game own answer alone is enough to refuse');
  }).then(() => {
    const level = { QuestID: 31, iSlot: -1, iLvl: 60, iClass: 0, FactionID: 0 };
    const gate = access(fakeBridge({
      'world.questTree.31': level, 'world.myAvatar.objData.intLevel': 10
    }, { 'world.canTurnInQuest': true }));
    return gate.call('CanComplete', ['31']);
  }).then((done) => {
    assert.strictEqual(done, false, 'and so is the validation string alone');
  });
});

test('the validation string names the first requirement a quest fails, in the loader own words', () => {
  // Quests.as:GetQuestValidationString walks its checks in order and returns the sentence for the
  // first that fails. A level gate and an upgrade gate are the two cheapest to pin; the sentences
  // are the loader's own.
  // A quest gated above the character's level: the string is 'Unlocks at Level 60.', so the quest
  // is neither available nor completable.
  const gated = { QuestID: 31, iSlot: -1, iLvl: 60, iClass: 0, FactionID: 0 };
  const game = access(fakeBridge({
    'world.questTree.31': gated, 'world.myAvatar.objData.intLevel': 10
  }, {}));
  return game.call('IsAvailable', ['31']).then((available) => {
    assert.strictEqual(available, false, 'a level gate makes the string non-empty');
  }).then(() => {
    return game.call('CanComplete', ['31']);
  }).then((done) => {
    assert.strictEqual(done, false);
  }).then(() => {
    // A member-only quest on a free account: 'Upgrade is required for this quest!'.
    const member = { QuestID: 31, iSlot: -1, iLvl: 0, iClass: 0, FactionID: 0, bUpg: 1 };
    // The loader calls world.myAvatar.isUpgraded() as a method, so the fixture answers a call.
    const upgrades = access(fakeBridge({
      'world.questTree.31': member, 'world.myAvatar.objData.intLevel': 10
    }, { 'world.myAvatar.isUpgraded': false }));
    return upgrades.call('IsAvailable', ['31']);
  }).then((available) => {
    assert.strictEqual(available, false, 'the upgrade gate refuses too');
  });
});

test('BuyItemQty hands over the accept envelope the game own sendBuyItemRequestWithQuantity takes', () => {
  // Shops.as:BuyItemQty builds { accept: 1, iQty: qty, iSel: <the shop row> } and hands it over.
  const row = { sName: 'Iron Sword', ItemID: 7, iQty: 1, iStk: 10, iCost: 0 };
  const bridge = fakeBridge({ 'world.shopinfo.items': [row] },
    { 'world.sendBuyItemRequestWithQuantity': 'ok' });
  const game = access(bridge);
  return game.call('BuyItemQty', ['iron sword', '3']).then(() => {
    assert.strictEqual(bridge.made[0].path, 'world.sendBuyItemRequestWithQuantity');
    assert.deepStrictEqual(bridge.made[0].args[0], { accept: 1, iQty: 3, iSel: row });
  });
});

test('BuyItemQtyById matches on the id pair the loader matches on, and refuses when it misses', () => {
  // Shops.as:GetShopItemById compares ItemID and ShopItemID together.
  const row = { sName: 'Iron Sword', ItemID: 7, ShopItemID: 4, iQty: 1 };
  const other = { sName: 'Other', ItemID: 7, ShopItemID: 9, iQty: 1 };
  const bridge = fakeBridge({ 'world.shopinfo.items': [other, row] },
    { 'world.sendBuyItemRequestWithQuantity': 'ok' });
  const game = access(bridge);
  return game.call('BuyItemQtyById', ['2', '7', '4']).then(() => {
    assert.deepStrictEqual(bridge.made[0].args[0], { accept: 1, iQty: 2, iSel: row },
      'the row with both ids, not the one that shares only the item id');
  }).then(() => {
    const miss = access(fakeBridge({ 'world.shopinfo.items': [other] }, {}));
    return miss.call('BuyItemQtyById', ['1', '7', '4']);
  }).then(() => {
    throw new Error('should have refused');
  }, (error) => {
    assert.ok(error.message.indexOf('shop item id 4') !== -1, error.message);
  });
});

test('BuyItem resolves the row by name and sends the single buy request', () => {
  // Shops.as:BuyItem is GetShopItem(name) plus world.sendBuyItemRequest(row).
  const row = { sName: 'Iron Sword', ItemID: 7, ShopItemID: 4, iQty: 1 };
  const bridge = fakeBridge({ 'world.shopinfo.items': [row] },
    { 'world.sendBuyItemRequest': 'ok' });
  const game = access(bridge);
  return game.call('BuyItem', ['IRON SWORD']).then(() => {
    assert.strictEqual(bridge.made[0].path, 'world.sendBuyItemRequest');
    assert.strictEqual(bridge.made[0].args[0], row, 'the row itself is handed over');
  }).then(() => {
    const miss = access(fakeBridge({ 'world.shopinfo.items': [] }, {}));
    return miss.call('BuyItem', ['iron sword']);
  }).then(() => {
    throw new Error('should have refused');
  }, (error) => {
    assert.ok(error.message.indexOf('iron sword') !== -1, 'the refusal names the item');
  });
});
// ------------------------------------------------- the six live-object calls (ticket #49)

// These six used to refuse: each hands a live ActionScript object to the game, and this surface
// carries JSON. The measured answer is that the object never has to cross - the page<->movie
// boundary is ExternalInterface and the game's classes live in the bridge movie's own
// ApplicationDomain, so the bridge resolves the object on its own side and passes it in-domain.
// The rows therefore send the primitives and let the bridge do the plumbing, under the
// reference's own names, so a feature still asks for `AttackMonster` and nothing changes there.
const LIVE_OBJECT_CALLS = ['AttackMonster', 'AttackMonsterByMonMapId', 'UseSkill', 'ForceUseSkill',
    'CancelTargetSelf', 'SetTargetPvP'];

test('the six live-object calls are implemented rather than refused', () => {
    const done = surface.implemented();
    LIVE_OBJECT_CALLS.forEach((name) => {
        assert.ok(surface.names().indexOf(name) !== -1, name + ' is a name the reference registers');
        assert.ok(done.indexOf(name) !== -1, name + ' must be implemented, not refused');
        assert.ok(!surface.SURFACE[name].why, name + ' must not carry a refusal reason any more');
    });
});

test('each live-object call asks the bridge callback of the reference own name', () => {
    // The bridge registers one callback per name, and does the object resolution in AS3 - so the
    // row is the name itself and the argument is the primitive, never a path.
    // The stand-in here records the callback name directly rather than modelling a game path:
    // these rows are not paths, which is the whole point of them.
    const made = [];
    const bridge = {
        call: function (callback, args) {
            made.push({ callback: callback, args: args });
            return Promise.resolve('ok');
        }
    };
    const game = access(bridge);
    return Promise.all([
        game.call('AttackMonster', ['Gravelyn']),
        game.call('AttackMonsterByMonMapId', ['17']),
        game.call('UseSkill', ['2']),
        game.call('ForceUseSkill', ['2']),
        game.call('CancelTargetSelf', []),
        game.call('SetTargetPvP', ['someone'])
    ]).then(() => {
        assert.deepStrictEqual(made.map((one) => one.callback), LIVE_OBJECT_CALLS,
            'each row must reach the bridge under its own reference name');
        assert.deepStrictEqual(made.map((one) => one.args), [
            ['Gravelyn'], ['17'], ['2'], ['2'], [], ['someone']
        ], 'the primitive the loader takes must arrive unchanged, and nothing else');
    });
});

test('the PvP row sends the null the reference passes when its box is cleared', () => {
    // PvP.cs: `Player.SetTargetPvP(chkEnableAutoTarget.Checked ? dropPlayers.SelectedItem.ToString()
    // : null)`. A missing argument has to reach the movie as null, because that is the branch that
    // scans for anyone instead of for the named player.
    const made = [];
    const game = surface.createLoaderSurface(function (callback, args) {
        made.push({ callback: callback, args: args });
        return Promise.resolve('ok');
    });
    return game.call('SetTargetPvP', []).then(() => {
        assert.deepStrictEqual(made[0].args, [null], 'an absent name is sent as null');
    });
});

test('the refusals that remain are not the six', () => {
    // A name still refused has to say why in the reference's own terms; the six now answer.
    const refused = surface.names().filter((name) => surface.implemented().indexOf(name) === -1);
    assert.deepStrictEqual(LIVE_OBJECT_CALLS.filter((name) => refused.indexOf(name) !== -1), [],
        'these used to refuse and must not any more');
});

test('SetFPS writes the shared stage and HideConnMC hides the game connection dialog', () => {
    const made = [];
    const game = surface.createLoaderSurface(function (callback, args) {
        made.push({ callback: callback, args: args });
        return Promise.resolve('ok');
    });
    return Promise.all([game.call('SetFPS', ['60']), game.call('HideConnMC', [])]).then(() => {
        assert.deepStrictEqual(made[0].args, ['stage.frameRate', 60]);
        assert.deepStrictEqual(made[1], { callback: 'callGameFunction0', args: ['mcConnDetail.hideConn'] });
    });
});

test('GetAccessLevel matches the loader\'s dataLeaf username, not the tree username', () => {
    const bridge = fakeBridge({
        'world.avatars': {
            1: { uid: '7', dataLeaf: { strUsername: 'ModName' }, objData: { intAccessLevel: 60 } },
            2: { uid: '8', dataLeaf: { strUsername: 'Player' }, objData: { intAccessLevel: 0 } }
        }
    }, {});
    return access(bridge).call('GetAccessLevel', ['modname']).then((level) => {
        assert.strictEqual(level, 60);
    });
});
