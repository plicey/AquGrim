// The reference loader's helper surface, implemented on our side of the bridge (ticket #48).
//
// The reference client does not call the stock game for most of its data. It ships its own loader
// (`Loader/grimoire.swf`) and its C# calls that loader's helper names. We load the stock game, so
// those names used to be unanswerable: the game replies "no member <name> at world".
//
// That loader is no longer a black box. Decompiled with FFDec it is 14 classes, and its call
// surface is registered in one place (`Externalizer.as init()`, ~156 addCallback lines). Reading
// it settles what the names are: a RENAMING LAYER over the stock game. Nearly every body is a
// short read or call against game paths the game does have, for example
//
//   GetBankItems()      -> world.bankinfo.items          (game/Data/Bank.as)
//   BankSlots()         -> world.myAvatar.objData.iBankSlots
//   UsedBankSlots()     -> world.myAvatar.iBankCount
//   GetInventoryItems() -> world.myAvatar.items
//   Health()            -> world.myAvatar.dataLeaf.intHP  (game/Data/Player.as)
//   Cell()              -> world.strFrame
//
// so each name is a path, not a reimplementation of game logic. That is what makes this table
// possible: the surface is data over the bridge's generic callbacks (getGameObject,
// callGameFunction, callGameFunction0, setGameObject), with a small compute step for the few
// helpers whose bodies do arithmetic over more than one read.
//
// Scope. Every name `Externalizer.as` registers is present here, so a feature ticket can assert
// the name it needs and get either a working call or the reason it cannot work - never a bare
// "no member". A row marked `why` is honest about being unimplemented; nothing is faked.
//
// Two deliberate differences from the loader, neither user-facing:
//   * The loader returns strings it has hand-quoted (`"\"" + strFrame + "\""`) because its C#
//     side parses them. Here a caller is JavaScript, so a read returns the value.
//   * The loader returns "True"/"False" strings for booleans. Here they are booleans.
//
// Provenance: `/var/tmp/aq48/out-loader/scripts/grimoire/` (the reference's loader, decompiled)
// and `/var/tmp/grimlite-src` (its C# call sites). Paths were checked against the decompressed
// stock game SWF by exact string-pool run match, not substring.

/** A read that should answer a boolean rather than the loader's "True"/"False" string. */
function truthy(value) {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'True';
}

/** Compare the way the loader does: case-insensitively, with spaces removed (its aura match). */
function loose(value) {
    return String(value === null || value === undefined ? '' : value).toLowerCase().replace(/ /g, '');
}

/** The item in a list whose sName matches, or null - the loader's GetItemByName, in JS. */
function byName(list, name) {
    const want = String(name === null || name === undefined ? '' : name).toLowerCase();
    const items = Array.isArray(list) ? list : (list && typeof list === 'object' ? Object.keys(list).map(function (k) { return list[k]; }) : []);
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item && typeof item.sName === 'string' && item.sName.toLowerCase() === want) return item;
    }
    return null;
}

/** Walk world.uoTree (the game's own player map) for a username; the loader's lookups, in JS. */
function playerIn(tree, username) {
    const want = String(username === null || username === undefined ? '' : username).toLowerCase();
    const keys = tree && typeof tree === 'object' ? Object.keys(tree) : [];
    for (let i = 0; i < keys.length; i++) {
        const player = tree[keys[i]];
        if (player && typeof player.strUsername === 'string' && player.strUsername.toLowerCase() === want) return player;
    }
    return null;
}

/**
 * The game paths a read-only helper needs, and the writes and calls the rest make. Keyed by the
 * reference's own name, each row carrying the loader file it came from.
 */
const SURFACE = {
    // ---- reads: one path each (loader game/Data/*.as) ------------------------------------
    IsLoggedIn: { get: 'sfc.isConnected' },
    Cell: { get: 'world.strFrame' },
    Pad: { get: 'world.strPad' },
    Map: { get: 'world.strMapName' },
    State: { get: 'world.myAvatar.dataLeaf.intState' },
    Health: { get: 'world.myAvatar.dataLeaf.intHP' },
    HealthMax: { get: 'world.myAvatar.dataLeaf.intHPMax' },
    Mana: { get: 'world.myAvatar.dataLeaf.intMP' },
    ManaMax: { get: 'world.myAvatar.dataLeaf.intMPMax' },
    Level: { get: 'world.myAvatar.dataLeaf.intLevel' },
    IsAfk: { get: 'world.myAvatar.dataLeaf.afk', map: truthy },
    Gold: { get: 'world.myAvatar.objData.intGold' },
    IsMember: { get: 'world.myAvatar.objData.iUpgDays', map: function (v) { return Number(v) >= 0; } },
    UserID: { get: 'world.myAvatar.uid' },
    CharID: { get: 'world.myAvatar.objData.CharID' },
    PlayerData: { get: 'world.myAvatar.objData' },
    GetFactions: { get: 'world.myAvatar.factions' },
    Class: { get: 'world.myAvatar.objData.strClassName', map: upper },
    Gender: { get: 'world.myAvatar.objData.strGender', map: upper },
    GetEquip: { get: function (p) { return 'world.avatars.' + p[0] + '.objData.eqp'; } },
    GetTargetHealth: { get: 'world.myAvatar.target.dataLeaf.intHP' },
    GetAvatars: { get: 'world.avatars' },
    Players: { get: 'world.uoTree' },
    PlayersInMap: { get: 'world.areaUsers' },
    RoomId: { get: 'world.curRoom', map: function (v) { return String(v); } },
    RoomNumber: { get: 'world.strAreaName', map: function (v) { return String(v).split('-')[1]; } },
    GetBankItems: { get: 'world.bankinfo.items' },
    BankSlots: { get: 'world.myAvatar.objData.iBankSlots' },
    UsedBankSlots: { get: 'world.myAvatar.iBankCount' },
    GetInventoryItems: { get: 'world.myAvatar.items' },
    InventorySlots: { get: 'world.myAvatar.objData.iBagSlots' },
    UsedInventorySlots: { get: 'world.myAvatar.items.length' },
    GetTempItems: { get: 'world.myAvatar.tempitems' },
    GetHouseItems: { get: 'world.myAvatar.houseitems' },
    HouseSlots: { get: 'world.myAvatar.objData.iHouseSlots' },
    GetItemTree: { get: 'world.invTree' },
    RealAddress: { get: 'objServerInfo.RealAddress' },
    RealPort: { get: 'objServerInfo.RealPort' },
    ServerName: { get: 'objServerInfo.sName' },
    GetSkillCooldown: { get: function (p) { return 'world.actions.active.' + index(p[0]) + '.cd'; } },

    // ---- calls: the game's own method, with the loader's argument shaping -----------------
    CancelAutoAttack: { call: 'world.cancelAutoAttack' },
    // Player.as calls it twice, in that order. Not a typo in the loader, so not one here either.
    CancelTarget: {
        compute: function (ctx) {
            return ctx.call('world.cancelTarget', []).then(function () {
                return ctx.call('world.cancelTarget', []);
            });
        }
    },
    Rest: { call: 'world.rest' },
    GoTo: { call: 'world.goto' },
    Jump: { call: 'world.moveToCell', args: function (p) { return [p[0], p[1] === undefined ? 'Spawn' : p[1]]; } },
    Join: { call: 'world.gotoTown', args: function (p) { return [p[0], p[1] === undefined ? 'Enter' : p[1], p[2] === undefined ? 'Spawn' : p[2]]; } },
    Equip: { call: 'world.sendEquipItemRequest', args: function (p) { return [{ ItemID: parseInt(p[0], 10) }]; } },
    EquipPotion: { call: 'world.equipUseableItem', args: function (p) { return [{ ItemID: parseInt(p[0], 10), sDesc: p[1], sFile: p[2], sName: p[3] }]; } },
    GetMapItem: { call: 'world.getMapItem', args: function (p) { return [parseInt(p[0], 10)]; } },
    Logout: { call: 'logout' },
    ReloadMap: { call: 'world.reloadCurrentMap' },
    LoadMap: { call: 'world.loadMap' },
    SetSpawnPoint: { call: 'world.setSpawnPoint', args: function () { return []; } },
    SetMapQuestVal: { call: 'world.setMapQuestVal', args: function () { return []; } },
    Accept: { call: 'world.acceptQuest', args: function (p) { return [parseInt(p[0], 10)]; } },
    Complete: { call: 'world.tryQuestComplete', args: function (p) { return [parseInt(p[0], 10), parseInt(p[2] === undefined ? '-1' : p[2], 10), String(p[3]) === 'True', p[1] === undefined ? 1 : p[1]]; } },
    LoadQuest: { call: 'world.showQuests', args: function (p) { return [[String(p[0])], 'q']; } },
    LoadQuests: { call: 'world.showQuests', args: function (p) { return [String(p[0]).split(','), 'q']; } },
    GetQuests: { call: 'world.getQuests', args: function (p) { return [String(p[0]).split(',')]; } },
    LoadShop: { call: 'world.sendLoadShopRequest', args: function (p) { return [parseInt(p[0], 10)]; } },
    LoadHairShop: { call: 'world.sendLoadHairShopRequest', args: function (p) { return [parseInt(p[0], 10)]; } },
    // Shops.as calls Root.Game.openArmorCustomize(): a member of the game root, not of world.
    LoadArmorCustomizer: { call: 'openArmorCustomize', args: function () { return []; } },
    GetBank: { call: 'getBank', args: function () { return []; } },
    ShowBank: { call: 'world.toggleBank', args: function () { return []; } },
    SetProvokeMonsters: { call: 'world.aggroAllMon', args: function () { return []; } },
    WalkToPoint: {
        call: 'world.moveRequest',
        args: function (p) {
            return [{
                mc: null, tx: parseInt(p[0], 10), ty: parseInt(p[1], 10), sp: NaN
            }];
        },
        why: 'the loader drives the avatar\'s own MovieClip (pMC.walkTo) before asking the world ' +
            'to move, and a live clip cannot travel through the bridge as JSON'
    },
    SetWalkSpeed: { set: 'world.WALKSPEED', value: function (p) { return parseInt(p[0], 10); } },
    // Settings.as: while i <= 5, world.actions.active[i].range = 20000.
    SetInfiniteRange: {
        compute: function (ctx) {
            const jobs = [];
            for (let i = 0; i <= 5; i++) jobs.push(ctx.set('world.actions.active.' + i + '.range', 20000));
            return Promise.all(jobs);
        }
    },
    // Settings.as: the target's own clip is put where the player's is, but only where there IS a
    // target - the loader's body is guarded by a null test, so this is too.
    SetEnemyMagnet: {
        compute: function (ctx) {
            return ctx.get('world.myAvatar.target').then(function (target) {
                if (target === null || target === undefined) return null;
                return Promise.all([
                    ctx.get('world.myAvatar.pMC.x'),
                    ctx.get('world.myAvatar.pMC.y')
                ]).then(function (xy) {
                    return Promise.all([
                        ctx.set('world.myAvatar.target.pMC.x', xy[0]),
                        ctx.set('world.myAvatar.target.pMC.y', xy[1])
                    ]);
                });
            });
        }
    },
    // Settings.as: world.visible = (arg == "False"). The comparison is the loader's own: "True"
    // means hidden, because hiding the game movie is what lag killing is.
    SetLagKiller: {
        set: 'world.visible',
        value: function (p) { return String(p[0]) === 'False'; }
    },
    // Settings.as: drain mcExtSWF, show the game, show its interface. The loader's own while loop
    // is unbounded; this bounds it and reports rather than spinning the app.
    SetSkipCutscenes: {
        compute: function (ctx) {
            const LIMIT = 100;
            let tries = 0;
            function next() {
                return ctx.get('mcExtSWF.numChildren').then(function (children) {
                    if (!children) return null;
                    if (tries >= LIMIT) {
                        throw new Error('mcExtSWF still had children after ' + LIMIT +
                            ' tries, so this cutscene could not be cleared');
                    }
                    tries++;
                    return ctx.call('mcExtSWF.removeChildAt', [0]).then(next);
                });
            }
            return next().then(function () {
                return ctx.set('world.visible', true);
            }).then(function () {
                return ctx.call('showInterface', []);
            });
        }
    },
    SetTargetPlayer: { call: 'world.getAvatarByUserName' },
    AttackMonster: { call: 'world.setTarget' },
    AttackMonsterByMonMapId: { call: 'world.setTarget' },
    SetSkillCooldown: { set: function (p) { return 'world.actions.active.' + index(p[0]) + '.cd'; } },
    SetSkillRange: { set: function (p) { return 'world.actions.active.' + index(p[0]) + '.range'; } },
    SetSkillMana: { set: function (p) { return 'world.actions.active.' + index(p[0]) + '.mp'; } },
    TransferToBank: {
        compute: function (ctx, p) {
            return ctx.get('world.myAvatar.items').then(function (items) {
                const item = byName(items, p[0]);
                if (!item) throw new Error('no item named "' + p[0] + '" in the inventory');
                return ctx.call('world.sendBankFromInvRequest', [item]);
            });
        }
    },
    TransferToInventory: {
        compute: function (ctx, p) {
            return ctx.get('world.bankinfo.items').then(function (items) {
                const item = byName(items, p[0]);
                if (!item) throw new Error('no item named "' + p[0] + '" in the bank');
                return ctx.call('world.sendBankToInvRequest', [item]);
            });
        }
    },
    BankSwap: {
        compute: function (ctx, p) {
            return Promise.all([ctx.get('world.myAvatar.items'), ctx.get('world.bankinfo.items')])
                .then(function (both) {
                    const inv = byName(both[0], p[0]);
                    const bank = byName(both[1], p[1]);
                    if (!inv) throw new Error('no item named "' + p[0] + '" in the inventory');
                    if (!bank) throw new Error('no item named "' + p[1] + '" in the bank');
                    return ctx.call('world.sendBankSwapInvRequest', [bank, inv]);
                });
        }
    },
    SellItem: {
        compute: function (ctx, p) {
            return ctx.get('world.myAvatar.items').then(function (items) {
                const item = byName(items, p[0]);
                if (!item) throw new Error('no item named "' + p[0] + '" in the inventory');
                return ctx.call('world.sendSellItemRequest', [item]);
            });
        }
    },
    UseBoost: {
        compute: function (ctx, p) {
            const id = parseInt(p[0], 10);
            return ctx.get('world.myAvatar.items').then(function (items) {
                const list = Array.isArray(items) ? items : [];
                for (let i = 0; i < list.length; i++) {
                    if (Number(list[i].ItemID) === id) return ctx.call('world.sendUseItemRequest', [list[i]]);
                }
                throw new Error('no item with id ' + id + ' in the inventory');
            });
        }
    },
    GetBankItemByName: {
        compute: function (ctx, p) {
            return ctx.get('world.bankinfo.items').then(function (items) { return byName(items, p[0]); });
        }
    },
    GetInventoryItemByName: {
        compute: function (ctx, p) {
            return ctx.get('world.myAvatar.items').then(function (items) { return byName(items, p[0]); });
        }
    },

    // ---- computed: a few reads (or a read and arithmetic), then no call -------------------
    Position: {
        compute: function (ctx) {
            return Promise.all([ctx.get('world.myAvatar.pMC.x'), ctx.get('world.myAvatar.pMC.y')]);
        }
    },
    HasTarget: {
        compute: function (ctx) {
            return ctx.get('world.myAvatar.target.dataLeaf.intHP').then(function (hp) {
                return Number(hp) > 0;
            });
        }
    },
    GetCells: {
        compute: function (ctx) {
            return ctx.get('world.map.currentScene.labels').then(function (labels) {
                const list = Array.isArray(labels) ? labels : [];
                return list.map(function (label) { return label && label.name; });
            });
        }
    },
    IsInProgress: {
        get: function (p) { return 'world.isQuestInProgress(' + parseInt(p[0], 10) + ')'; },
        why: 'a call, not a path: the game answers world.isQuestInProgress(id)',
        compute: function (ctx, p) {
            return ctx.call('world.isQuestInProgress', [parseInt(p[0], 10)]);
        }
    },
    IsAvailable: {
        compute: function (ctx, p) {
            return questValidation(ctx, p[0]).then(function (why) { return why === ''; });
        }
    },
    CanComplete: {
        compute: function (ctx, p) {
            const id = parseInt(p[0], 10);
            // The loader writes the game's own canTurnInQuest and the validation string in one
            // &&, which short-circuits: a quest that fails validation never reaches the game
            // call at all. Kept in that order, because the first half is the decisive one.
            return questValidation(ctx, p[0]).then(function (why) {
                if (why !== '') return false;
                return ctx.call('world.canTurnInQuest', [id]).then(function (turnIn) {
                    return truthy(turnIn);
                });
            });
        }
    },
    GetQuestTree: {
        compute: function (ctx) {
            return ctx.get('world.questTree').then(function (tree) {
                const keys = tree && typeof tree === 'object' ? Object.keys(tree) : [];
                return keys.map(function (key) { return tree[key]; })
                    .filter(function (quest) { return quest && typeof quest === 'object'; });
            });
        }
    },
    BuyItem: {
        compute: function (ctx, p) {
            return shopItem(ctx, p[0]).then(function (item) {
                return ctx.call('world.sendBuyItemRequest', [item]);
            });
        }
    },
    BuyItemQty: {
        compute: function (ctx, p) {
            return shopItem(ctx, p[0]).then(function (item) {
                return ctx.call('world.sendBuyItemRequestWithQuantity',
                    [{ accept: 1, iQty: parseInt(p[1], 10), iSel: item }]);
            });
        }
    },
    BuyItemQtyById: {
        compute: function (ctx, p) {
            const itemId = parseInt(p[1], 10);
            const shopItemId = parseInt(p[2], 10);
            return ctx.get('world.shopinfo.items').then(function (items) {
                const list = Array.isArray(items) ? items : [];
                const item = list.filter(function (one) {
                    return one && Number(one.ItemID) === itemId && Number(one.ShopItemID) === shopItemId;
                })[0];
                if (!item) {
                    throw new Error('no shop item with item id ' + itemId + ' and shop item id ' +
                        shopItemId + ' is in the loaded shop');
                }
                return ctx.call('world.sendBuyItemRequestWithQuantity',
                    [{ accept: 1, iQty: parseInt(p[0], 10), iSel: item }]);
            });
        }
    },
    PlayerByName: {
        compute: function (ctx, p) {
            return ctx.get('world.uoTree').then(function (tree) { return playerIn(tree, p[0]); });
        }
    },
    GetCellPlayers: {
        compute: function (ctx, p) {
            return Promise.all([ctx.get('world.uoTree'), ctx.get('world.strFrame')]).then(function (both) {
                const player = playerIn(both[0], p[0]);
                return !!player && loose(player.strFrame) === loose(both[1]);
            });
        }
    },
    CheckCellPlayer: {
        compute: function (ctx, p) {
            return ctx.get('world.uoTree').then(function (tree) {
                const player = playerIn(tree, p[0]);
                return !!player && loose(player.strFrame) === loose(p[1]);
            });
        }
    },
    CheckPlayerInMyCell: {
        compute: function (ctx, p) {
            return ctx.get('world.uoTree').then(function (tree) {
                const player = playerIn(tree, p[0]);
                return !!player && loose(player.strFrame) === loose(tree && tree.myAvatar ? tree.myAvatar.strFrame : '');
            });
        }
    },
    GetPlayerHealth: {
        compute: function (ctx, p) {
            return ctx.get('world.uoTree').then(function (tree) {
                const player = playerIn(tree, p[0]);
                return player ? Number(player.intHP) : 100;
            });
        }
    },
    GetPlayerHealthPercentage: {
        compute: function (ctx, p) {
            return ctx.get('world.uoTree').then(function (tree) {
                const player = playerIn(tree, p[0]);
                if (!player) return 100;
                const max = Number(player.intHPMax) || 0;
                return max > 0 ? Math.round(Number(player.intHP) / max * 100) : 100;
            });
        }
    },
    GetAccessLevel: {
        compute: function (ctx, p) {
            return ctx.get('world.avatars').then(function (avatars) {
                const player = playerIn(avatars, p[0]);
                return player ? Number(player.objData && player.objData.intAccessLevel) : undefined;
            });
        }
    },
    HasActiveBoost: {
        compute: function (ctx, p) {
            const what = String(p[0] === null || p[0] === undefined ? '' : p[0]).toLowerCase();
            const field = what.indexOf('gold') > -1 ? 'iBoostG'
                : (what.indexOf('xp') > -1 ? 'iBoostXP'
                    : (what.indexOf('rep') > -1 ? 'iBoostRep' : (what.indexOf('class') > -1 ? 'iBoostCP' : null)));
            if (!field) return Promise.resolve(false);
            return ctx.get('world.myAvatar.objData.' + field).then(function (v) { return Number(v) > 0; });
        }
    },
    SkillAvailable: {
        compute: function (ctx, p) { return skillReady(ctx, p[0]); }
    },
    AllSkillsAvailable: {
        compute: function (ctx) {
            return Promise.all([1, 2, 3, 4].map(function (slot) { return skillReady(ctx, slot); }))
                .then(function (all) { return Math.max.apply(null, all); });
        }
    },
    GetSkillName: {
        get: function (p) { return 'world.actions.active.' + index(p[0]) + '.nam'; }
    },
    IsActionAvailable: {
        compute: function (ctx, p) {
            return ctx.get('world.lock.' + p[0]).then(function (lock) {
                if (!lock) return true;
                return Date.now() - Number(lock.ts) >= Number(lock.cd);
            });
        }
    },
    ItemIsInTemp: {
        compute: function (ctx, p) {
            return ctx.get('world.myAvatar.tempitems').then(function (items) {
                const item = byName(items, p[0]);
                if (!item) return false;
                return String(p[1]) === '*' ? true : Number(item.iQty) >= parseInt(p[1], 10);
            });
        }
    },
    IsShopLoaded: {
        compute: function (ctx) {
            return ctx.get('world.shopinfo.items').then(function (items) {
                return !!(items && (Array.isArray(items) ? items.length : Object.keys(items).length));
            });
        }
    },
    ResetShopInfo: { set: 'world.shopinfo', value: function () { return null; } },

    // ---- named, but the loader's own state or movie chrome rather than a game call ---------
    GetUsername: { why: 'the reference loader holds the login it captured; ticket #35 owns this' },
    GetPassword: { why: 'the reference loader holds the login it captured; ticket #35 owns this' },
    Login: { why: 'the reference loader drives its own login flow; ticket #35 owns this' },
    FixLogin: { why: 'the reference loader drives its own login flow; ticket #35 owns this' },
    Connect: { why: 'the reference loader connects for itself; ticket #35 owns this' },
    ResetServers: { why: 'the reference loader clears its own server list; ticket #35 owns this' },
    AreServersLoaded: { why: 'the reference loader reads its own server list; ticket #35 owns this' },
    IsTemporarilyKicked: { why: 'the reference loader reads its own login movie; ticket #35 owns this' },
    SetFPS: { why: 'the reference sets the SWF stage frame rate; the bridge has no stage path' },
    SetTitle: { why: 'the reference writes its own login movie chrome; the game has no equivalent' },
    SendMessage: { why: 'the reference writes into its own chat box; the game has no such member' },
    GetConnMC: { why: 'the reference reads its own connection dialog, which the game does not expose' },
    HideConnMC: { why: 'the reference hides its own connection dialog, not the game\'s' },
    IsConnMCBackButtonVisible: { why: 'the reference reads its own connection dialog control' },
    Buff: { why: 'the reference writes god-mode values onto itself; not a game call' },
    DestroyPlayers: { why: 'the reference calls destroyAvatar per live avatar object' },
    // Player.as:SetEquip writes objData.eqp[slot] and then calls loadMovieAtES on the
    // live avatar clip. The second half is reachable (the Cosmetics window uses it) but the
    // first is not: objData.eqp is a live object graph, and writing one slot of it through a
    // dot-path cannot carry the entry shape the game expects. An item is worn by asking the
    // game to wear it - world.sendEquipItemRequest, the Equip row above - which is what every
    // equipping command in this port does.
    SetEquip: { why: 'the reference writes a live equip entry and then swaps the clip; the ' +
        'clip half is loadMovieAtES (reachable), the entry half is a live object graph the ' +
        'bridge cannot carry, and world.sendEquipItemRequest is the game own way to wear it' },
    ChangeName: { why: 'the reference paints its own name plates; not a game read' },
    ChangeGuild: { why: 'the reference paints its own guild tags; not a game read' },
    ChangeAccessLevel: { why: 'the reference styles its own name plate and sets iUpgDays' },
    ChangeColorName: { why: 'the reference sets a text colour on its own name plate' },
    GetShops: { why: 'the reference keeps its own list of shops it has seen (LoadedShops)' },
    LoadBankItems: { why: 'the loader sends its own loadBank frame; ticket #29\'s window uses the game path' },
    MuteToggle: { why: 'the reference mutes its own chat box; not a game call' },
    UseSkill: { why: 'the reference checks readiness, walks the avatar and calls testAction; ticket #38 owns combat' },
    ForceUseSkill: { why: 'the reference calls world.testAction for one skill; ticket #38 owns combat' },
    SetTargetPvP: { why: 'the reference scans live avatars for a same-cell PvP target; ticket #38 owns combat' },
    CancelTargetSelf: { why: 'the reference compares two live avatar objects; ticket #38 owns combat' },
    GetAurasValue: { why: 'the reference reads live aura arrays off the avatar; ticket #42 owns auras' },
    AuraDuration: { why: 'the reference reads live aura arrays off the avatar; ticket #42 owns auras' },
    GetMonstersInCell: { why: 'the reference reshapes live monster objects; ticket #38 owns combat' },
    GetVisibleMonstersInCell: { why: 'the reference reshapes live monster objects; ticket #38 owns combat' },
    GetMonsterHealth: { why: 'the reference reshapes a live monster object; ticket #38 owns combat' },
    IsMonsterAvailable: { why: 'the reference scans live monsters by name; ticket #38 owns combat' },
    IsMonsterAvailableByMonMapID: { why: 'the reference scans live monsters by MonMapID; ticket #38 owns combat' },
    MapLoadComplete: { why: 'the reference inspects its own display list; ticket #41 owns state' },
    RejectDrop: { why: 'the reference walks its own drop stack UI; ticket #33 owns drops' },

    // ---- the generic array accessors, which sit beside the other generic callbacks --------
    getArrayObject: {
        compute: function (ctx, p) {
            return ctx.get(String(p[0]) + '.' + index(p[1]));
        }
    },
    setArrayObject: {
        set: function (p) { return String(p[0]) + '.' + index(p[1]); },
        value: function (p) { return p[2]; }
    },
    selectArrayObjects: {
        compute: function (ctx, p) {
            const prop = String(p[1]);
            return ctx.get(p[0]).then(function (list) {
                const items = Array.isArray(list) ? list : [];
                return items.map(function (item) { return item === null || item === undefined ? null : item[prop]; });
            });
        }
    }
};

function upper(value) {
    return String(value === null || value === undefined ? '' : value).toUpperCase();
}

function index(value) {
    const n = parseInt(value, 10);
    return isFinite(n) ? String(n) : '0';
}

/**
 * Quests.as:GetQuestValidationString, in JS: the first requirement a quest fails, as the sentence
 * the loader writes, or the empty string when nothing fails. The loader's own checks, in its order:
 * the daily/monthly achievement, the upgrade gate, the quest-slot progress, the level, the class
 * points and the faction reputation. The last check - required items - is the one this port leaves
 * to the game: it is world.canTurnInQuest's own business (World.as walks the same turnin list), and
 * CanComplete below asks it directly rather than counting the bag a second time.
 */
/**
 * Quests.as:GetQuestValidationString, in JS: the first requirement a quest fails, as the sentence
 * the loader writes, or the empty string when nothing fails. The loader's own checks, in its own
 * order: the daily/monthly achievement, the upgrade gate, the quest-slot progress, the level, the
 * class points and the faction reputation. The last check - required items - is the one this port
 * leaves to the game: it is world.canTurnInQuest's own business (World.as walks the same turnin
 * list), and CanComplete below asks it directly rather than counting the bag a second time.
 *
 * The quest row is read once and then checked against, which is what the loader does with its own
 * _loc10_ local. That matters here more than it does there: every read below is a round trip out
 * of the renderer, and the loader's own body spends one.
 */
function questValidation(ctx, rawId) {
    const id = parseInt(rawId, 10);
    return ctx.get('world.questTree.' + id).then(function (quest) {
        if (quest === null || quest === undefined) return 'Quest not found/loaded.';
        const checks = [
            // The daily/monthly achievement: sField and iIndex name the counter to read.
            function () {
                if (quest.sField == null || quest.iIndex == null) return null;
                return ctx.call('world.getAchievement', [quest.sField, quest.iIndex])
                    .then(function (value) {
                        if (Number(value) === 0) return null;
                        return quest.sField === 'im0'
                            ? 'Monthly Quests are only available once per month.'
                            : 'Daily Quests are only available once per day.';
                    });
            },
            // bUpg: member-only quests, gated on the avatar's own isUpgraded().
            function () {
                if (!truthy(quest.bUpg)) return null;
                return ctx.call('world.myAvatar.isUpgraded', []).then(function (upgraded) {
                    return truthy(upgraded) ? null : 'Upgrade is required for this quest!';
                });
            },
            // iSlot: a one-shot quest whose counter has not reached iValue - 1 is not unlocked.
            function () {
                const slot = Number(quest.iSlot);
                if (!(slot >= 0)) return null;
                return ctx.call('world.getQuestValue', [slot]).then(function (value) {
                    const progress = Number(value) || 0;
                    const wanted = (Number(quest.iValue) || 0) - 1;
                    return progress < wanted ? 'Quest has not been unlocked!' : null;
                });
            },
            // iLvl against the avatar's own level.
            function () {
                const level = Number(quest.iLvl) || 0;
                if (level <= 0) return null;
                return ctx.get('world.myAvatar.objData.intLevel').then(function (mine) {
                    return level > (Number(mine) || 0) ? 'Unlocks at Level ' + level + '.' : null;
                });
            },
            // iClass/iReqCP: class points on a specific class, reported as its rank.
            function () {
                const classId = Number(quest.iClass) || 0;
                if (classId <= 0) return null;
                return Promise.all([
                    ctx.call('world.myAvatar.getCPByID', [classId]),
                    questRank(ctx, Number(quest.iReqCP)),
                    ctx.get('arrRanks')
                ]).then(function (both) {
                    const required = Number(quest.iReqCP) || 0;
                    if ((Number(both[0]) || 0) >= required) return null;
                    return rankSentence(ctx, both[1], required, both[2],
                        String(quest.sClass || ''), ' Class Points on ');
                });
            },
            // FactionID/iReqRep: reputation, reported the same way. FactionID 1 is the
            // unaligned faction, which the game does not gate on.
            function () {
                const factionId = Number(quest.FactionID) || 0;
                if (factionId <= 1) return null;
                return Promise.all([
                    ctx.call('world.myAvatar.getRep', [factionId]),
                    questRank(ctx, Number(quest.iReqRep)),
                    ctx.get('arrRanks')
                ]).then(function (both) {
                    const required = Number(quest.iReqRep) || 0;
                    if ((Number(both[0]) || 0) >= required) return null;
                    return rankSentence(ctx, both[1], required, both[2],
                        String(quest.sFaction || ''), ' Reputation for ');
                });
            }
        ];
        // The loader returns the sentence of the first check that fails, and '' when none do.
        return checks.reduce(function (chain, check) {
            return chain.then(function (why) {
                if (why) return why;
                return check();
            });
        }, Promise.resolve(null)).then(function (why) { return why || ''; });
    });
}

/**
 * Root.Game.getRankFromPoints, asked of the game by that name rather than counted here: the
 * reference loader calls the game's own function for both the class-point and the reputation
 * rank, so this does too. arrRanks (the table the function indexes) is read separately, because
 * the message the loader writes subtracts the rank's own floor from the requirement.
 */
function questRank(ctx, points) {
    return ctx.call('getRankFromPoints', [points]).then(function (rank) {
        const value = Number(rank);
        return isFinite(value) && value > 0 ? value : 1;
    });
}

/**
 * The two sentences the loader writes for a rank gate, which differ only in the phrase between
 * the shortfall and the name: "Requires 500 Class Points on Sword, Rank 3." against
 * "Requires Sword, Rank 3." when the requirement lands exactly on the rank's own floor.
 */
function rankSentence(ctx, rank, required, ranks, what, phrase) {
    const floor = Array.isArray(ranks) ? Number(ranks[rank - 1]) || 0 : 0;
    const missing = required - floor;
    return missing > 0
        ? 'Requires ' + missing + phrase + what + ', Rank ' + rank + '.'
        : 'Requires ' + what + ', Rank ' + rank + '.';
}

/**
 * Root.Game.getRankFromPoints, asked of the game by that name rather than counted here: the
 * reference loader calls the game's own function for both the class-point and the reputation
 * rank, so this does too. arrRanks (the table the function indexes) is still read separately,
 * because the message the loader writes subtracts the rank's own floor from the requirement.
 */
function questRank(ctx, points) {
    return ctx.call('getRankFromPoints', [points]).then(function (rank) {
        const value = Number(rank);
        return isFinite(value) && value > 0 ? value : 1;
    });
}

/**
 * Shops.as:GetShopItem - the loaded shop's row whose sName matches, case-insensitively, or a
 * refusal naming the item. BuyItem and BuyItemQty are both this lookup plus one game call.
 */
function shopItem(ctx, rawName) {
    const want = String(rawName === null || rawName === undefined ? '' : rawName).toLowerCase();
    return ctx.get('world.shopinfo.items').then(function (items) {
        const list = Array.isArray(items) ? items : [];
        for (let i = 0; i < list.length; i++) {
            const item = list[i];
            if (item && String(item.sName || '').toLowerCase() === want) return item;
        }
        throw new Error('no item named "' + rawName + '" is in the loaded shop');
    });
}

/**
 * The loader's IsSkillReady, in JS: the greater of the global cooldown left and this skill's own,
 * both scaled by the avatar's haste. Two paths feed it, and the skill's own needs a third read.
 */
function skillReady(ctx, slot) {
    const at = 'world.actions.active.' + index(slot);
    return Promise.all([
        ctx.get(at + '.cd'),
        ctx.get(at + '.ts'),
        ctx.get('world.GCD'),
        ctx.get('world.GCDTS'),
        ctx.get('world.myAvatar.dataLeaf.sta.$tha')
    ]).then(function (v) {
        const haste = 1 - Math.min(Math.max(Number(v[4]), -1), 0.5);
        const now = Date.now();
        const cooldown = Math.round(Number(v[0]) * haste) - (now - Number(v[1]));
        const global = Number(v[2]) - (now - Number(v[3]));
        return Math.max(global < 0 ? 0 : global, cooldown < 0 ? 0 : cooldown);
    });
}

/** Every name this module answers, whether by doing the work or by explaining why not. */
function names() {
    return Object.keys(SURFACE).sort();
}

/** The names that actually do something, as opposed to naming a reason. */
function implemented() {
    const out = [];
    Object.keys(SURFACE).forEach(function (name) {
        if (!SURFACE[name].why || SURFACE[name].compute || SURFACE[name].get || SURFACE[name].call || SURFACE[name].set) {
            out.push(name);
        }
    });
    return out.sort();
}

/**
 * Bind the table to a bridge. The one dependency is a function of the shape
 * `(callbackName, args) => Promise<value>` that raises the movie's own error when it refuses -
 * bridge.js already has one, and the table uses nothing else.
 *
 * @param {(callback: string, args: Array) => Promise<any>} call the generic bridge call
 * @param {(msg: string) => void} [log]
 */
function createLoaderSurface(call, log) {
    const note = typeof log === 'function' ? log : function () {};

    /** Read a dot-path through the bridge's own read callback. */
    function get(path) {
        return call('getGameObject', [path]).then(function (value) {
            return value === undefined ? null : value;
        }, function (error) {
            note('loader surface: ' + path + ' did not answer: ' + error.message);
            throw error;
        });
    }

    /** Call a game function by dot-path, zero-argument calls through their own callback. */
    function invoke(path, args) {
        const callback = args && args.length ? 'callGameFunction' : 'callGameFunction0';
        return call(callback, args && args.length ? [path].concat(args) : [path]);
    }

    /** Write a value at a dot-path, which is what setGameObject is for. */
    function write(path, value) {
        return call('setGameObject', [path, value]);
    }

    function unsupported(name, row) {
        return Promise.reject(new Error('"' + name + '" is part of the reference client\'s own ' +
            'loader rather than the game, and this bridge does not implement it: ' + row.why));
    }

    return {
        names: names,
        implemented: implemented,
        has: function (name) { return Object.prototype.hasOwnProperty.call(SURFACE, name); },

        /**
         * The whole point: ask for a helper by the reference's own name.
         * @returns {Promise<any>} what the game answered, or a rejection naming the reason
         */
        call: function (name, args) {
            const row = SURFACE[name];
            if (!row) {
                const known = implemented();
                return Promise.reject(new Error('no helper named "' + name + '" - this bridge ' +
                    'implements the reference loader\'s surface; a name it does not have is not ' +
                    'one this can answer (' + known.length + ' are implemented, from ' + names().length + ' named)'));
            }
            const p = Array.isArray(args) ? args : [];
            // A row that does nothing but explain itself is a refusal with a reason. A row with a
            // `why` *and* an implementation is one with a caveat, which is a note, not a refusal.
            if (!row.compute && !row.get && !row.call && !row.set) return unsupported(name, row);
            if (row.compute) {
                return Promise.resolve(row.compute({ get: get, call: invoke, set: write }, p));
            }
            if (row.get) {
                const path = typeof row.get === 'function' ? row.get(p) : row.get;
                return get(path).then(function (value) {
                    return row.map ? row.map(value) : value;
                });
            }
            if (row.set) {
                const path = typeof row.set === 'function' ? row.set(p) : row.set;
                const value = typeof row.value === 'function' ? row.value(p) : value_default(p);
                return write(path, value);
            }
            const args2 = typeof row.args === 'function' ? row.args(p) : p;
            return invoke(row.call, args2);
        },
    };
}

function value_default(p) {
    return p.length > 1 ? p[1] : p[0];
}

module.exports = {
    SURFACE: SURFACE,
    createLoaderSurface: createLoaderSurface,
    names: names,
    implemented: implemented
};
