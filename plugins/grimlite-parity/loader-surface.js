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
        // Map packets use uoName; World.uoTreeLeafSet also keys partial leaves by username.
        const name = player && (player.strUsername || player.uoName || keys[i]);
        if (typeof name === 'string' && name.toLowerCase() === want) return player;
    }
    return null;
}

/** Player.GetAccessLevel walks world.avatars, matching dataLeaf.strUsername. */
function avatarIn(avatars, username) {
    const want = String(username === null || username === undefined ? '' : username).toLowerCase();
    const keys = avatars && typeof avatars === 'object' ? Object.keys(avatars) : [];
    for (let i = 0; i < keys.length; i++) {
        const player = avatars[keys[i]];
        const leaf = player && player.dataLeaf;
        const name = leaf && typeof leaf.strUsername === 'string' ? leaf.strUsername : null;
        if (name && name.toLowerCase() === want) return player;
    }
    return null;
}

// ---------------------------------------------------------------- monsters (ticket #38)

/**
 * The monsters the game holds, read one *leaf* at a time.
 *
 * The loader walks `Root.Game.world.getMonstersByCell(cell)` in AS3 and never sends a monster
 * over its own bridge: `GetMonstersInCell` reshapes each one into eight fields and stringifies
 * *that*. The reason it has to is measured, not assumed. A monster is a live `Avatar` whose `pMC`
 * is a `MonsterMC` MovieClip - a display object, with a parent chain and children, which the
 * bridge's `JSON.stringify` cannot express (AquaBridge.as falls back to `String(value)` when it
 * throws). The game's own accessors take and return those live objects too: `getMonster(id)`,
 * `getMonstersByCell(cell)`, `getActionByRef(ref)` and `testAction(action)` are all typed on them
 * (World.as 8075, 8128, 9659, 8705), and the only member that reaches a monster by anything a
 * bridge could carry is the click handler, which is handed a MouseEvent.
 *
 * So this walks the collection by index and reads primitive leaves off each entry - the same
 * reshape the loader's own body performs, done a step earlier because here the reshape has to
 * happen on the far side of the wire. `visible` is read where the loader reads it (`pMC.visible`)
 * and `pMC` is probed with `isNull`, the bridge's own existence test, which is what the loader's
 * `if(_loc2_.pMC)` guard is about.
 */
const MONSTER_FIELDS = ['sRace', 'strMonName', 'MonID', 'MonMapID', 'iLvl', 'intState', 'intHP', 'intHPMax'];

/** A read that answers null for a member the game does not carry, rather than throwing. */
function soft(ctx, path) {
    return ctx.get(path).then(function (value) {
        return value === undefined ? null : value;
    }, function () { return null; });
}

/** One monster's eight fields, read from the leaves the loader's own projection copies. */
function readMonster(ctx, at) {
    const fields = MONSTER_FIELDS.map(function (field) {
        // world.monsters[i].objData.* and world.monsters[i].dataLeaf.*, the two objects the
        // loader's body reads its eight fields out of.
        const branch = field === 'sRace' || field === 'strMonName' ? 'objData' : 'dataLeaf';
        return soft(ctx, at + '.' + branch + '.' + field);
    });
    return Promise.all(fields).then(function (values) {
        const monster = {};
        MONSTER_FIELDS.forEach(function (field, i) { monster[field] = values[i]; });
        return monster;
    });
}

/** Whether a monster read back as anything at all, or is a slot this bridge cannot describe. */
function described(monster) {
    return MONSTER_FIELDS.some(function (field) {
        return monster[field] !== null && monster[field] !== undefined;
    });
}

/**
 * Every monster the game holds, one entry per slot: its cell, its eight fields, whether the client
 * has drawn it, and whether the fields read back at all.
 *
 * A collection that reports monsters while every one of them reads back blank is the one case this
 * refuses on. That is not an empty map - an empty map has no monsters to fail to read - it is this
 * bridge being unable to see into a `Vector.<Avatar>` whose members it cannot serialize, and the
 * difference matters more here than anywhere else in the surface: a respawn wait and a cell jump
 * both read an empty answer as "nothing to fight" and move on.
 */
function readAllMonsters(ctx) {
    return ctx.get('world.monsters.length').then(function (length) {
        const count = Number(length);
        if (!isFinite(count) || count <= 0) return [];
        const jobs = [];
        for (let i = 0; i < count; i++) {
            const at = 'world.monsters.' + i;
            jobs.push(Promise.all([
                soft(ctx, at + '.dataLeaf.strFrame'),
                readMonster(ctx, at),
                ctx.present(at + '.pMC'),
                soft(ctx, at + '.pMC.visible')
            ]).then(function (row) {
                return {
                    at: at,
                    frame: row[0] === null || row[0] === undefined ? null : String(row[0]),
                    monster: row[1],
                    hasClip: row[2],
                    visible: row[3] === true,
                    described: described(row[1])
                };
            }));
        }
        return Promise.all(jobs).then(function (rows) {
            if (rows.length && !rows.some(function (row) { return row.described; })) {
                throw new Error('the game reports ' + count + ' monster(s) but not one of them read ' +
                    'back over the bridge, so this is a bridge limit rather than an empty map');
            }
            return rows;
        });
    });
}

/** The same cell comparison the game's own getMonstersByCell makes (case-insensitive). */
function sameCell(a, b) {
    return String(a === null || a === undefined ? '' : a).toLowerCase() ===
        String(b === null || b === undefined ? '' : b).toLowerCase();
}

/**
 * The monsters in one cell: the game's own `getMonstersByCell` selection, done from here.
 *
 * The game filters `world.monsters` on `dataLeaf != null && dataLeaf.strFrame == cell`, so that is
 * the selection reproduced - and a monster the game holds but cannot describe (no dataLeaf, so
 * nothing this can read) is a refusal rather than a silent omission: an empty answer has to mean
 * "the cell is empty", which is exactly what a respawn wait reads it as.
 */
function monstersInCell(ctx, cell) {
    return readAllMonsters(ctx).then(function (rows) {
        return rows.filter(function (row) { return sameCell(row.frame, cell); })
            .map(function (row) { return row.monster; });
    });
}

/** The loader's GetMonsterByName: the first live, living monster whose name contains the want. */
function monsterByName(ctx, name) {
    const want = String(name === null || name === undefined ? '' : name).toLowerCase();
    return Promise.all([ctx.get('world.strFrame'), readAllMonsters(ctx)]).then(function (both) {
        const rows = both[1];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const named = row.monster.strMonName === null || row.monster.strMonName === undefined
                ? '' : String(row.monster.strMonName).toLowerCase();
            // World.as GetMonsterByName: `if(_loc2_.pMC)` then name contains (or "*"), then
            // `dataLeaf.intState > 0` - and the walk is over the player's own cell only.
            if (sameCell(row.frame, both[0]) && row.hasClip && Number(row.monster.intState) > 0 &&
                (want === '*' || named.indexOf(want) > -1)) {
                return row;
            }
        }
        return null;
    });
}

/** The loader's GetMonsterByMonMapId: the same walk, matched on dataLeaf.MonMapID instead. */
function monsterByMonMapId(ctx, id) {
    const want = String(id === null || id === undefined ? '' : id);
    return Promise.all([ctx.get('world.strFrame'), readAllMonsters(ctx)]).then(function (both) {
        const rows = both[1];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const monMapID = row.monster.MonMapID === null || row.monster.MonMapID === undefined
                ? '' : String(row.monster.MonMapID);
            if (sameCell(row.frame, both[0]) && row.hasClip && Number(row.monster.intState) > 0 &&
                (want === '*' || monMapID.indexOf(want) > -1)) {
                return row;
            }
        }
        return null;
    });
}

/** The loader's GetVisibleMonstersInCell: the player's own cell, drawn and living only. */
function visibleMonstersInCell(ctx) {
    return Promise.all([ctx.get('world.strFrame'), readAllMonsters(ctx)]).then(function (both) {
        return both[1].filter(function (row) {
            return sameCell(row.frame, both[0]) && row.hasClip && row.visible &&
                Number(row.monster.intState) > 0;
        }).map(function (row) { return row.monster; });
    });
}

/**
 * The game paths a read-only helper needs, and the writes and calls the rest make. Keyed by the
 * reference's own name, each row carrying the loader file it came from.
 */
const SURFACE = {
    // The monsters this bridge CAN answer (ticket #38). See monstersInCell below the table for
    // why this is a per-field walk rather than the one read the loader's body is.
    GetMonstersInCell: {
        compute: function (ctx, p) { return monstersInCell(ctx, p[0]); }
    },
    GetVisibleMonstersInCell: {
        // World.as: getMonstersByCell(world.strFrame), keeping only pMC != null && pMC.visible &&
        // intState > 0. The selection is the player's own cell, read here rather than passed in.
        compute: function (ctx) { return visibleMonstersInCell(ctx); }
    },
    IsMonsterAvailable: {
        compute: function (ctx, p) {
            return monsterByName(ctx, p[0]).then(function (row) { return row !== null; });
        }
    },
    IsMonsterAvailableByMonMapID: {
        compute: function (ctx, p) {
            return monsterByMonMapId(ctx, p[0]).then(function (row) { return row !== null; });
        }
    },
    GetMonsterHealth: {
        compute: function (ctx, p) {
            return monsterByName(ctx, p[0]).then(function (row) {
                // World.as dereferences the find without a null check; here a missing monster is a
                // refusal that names it, so a caller can tell it from a monster on 0 HP.
                if (row === null) throw new Error('no monster named "' + p[0] + '" is in this cell');
                return row.monster.intHP;
            });
        }
    },
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
            'to move, and the movie has no callback for this one: reach it by moving the avatar ' +
            'to the cell and pad instead (Jump), or ask for the callback the way ticket #49 added ' +
            'the six that needed one'
    },
    SetWalkSpeed: { set: 'world.WALKSPEED', value: function (p) { return parseInt(p[0], 10); } },
    // Keep legacy one-shot semantics, with originals retained on the native action objects.
    SetInfiniteRange: {
        compute: function (ctx, p) {
            return ctx.raw('SetInfiniteRangeEnabled', [p[0] !== false, p.length > 0]);
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
    // Share the bridge's native lifecycle watcher with the Options route.
    SetSkipCutscenes: {
        compute: function (ctx, p) {
            return ctx.raw('SetSkipCutscenesEnabled', [p[0] !== false]);
        }
    },
    SetTargetPlayer: { call: 'world.getAvatarByUserName' },
    // ---- the six live-object calls (ticket #49) ------------------------------------------
    //
    // These used to refuse here, and the refusal was correct about the constraint and wrong about
    // its reach: the objects they take (an Avatar for world.setTarget, an action object for
    // world.testAction) cannot cross ExternalInterface, but they never have to. The JSON boundary
    // is the page <-> bridge-movie hop, and the game's classes live in the bridge movie's own
    // ApplicationDomain (see AquaBridge.as loadGame), so an object resolved inside the movie IS
    // the game's object and can be handed to a game method there. Each row below therefore sends
    // the primitive the reference's own signature takes - the name, the MonMapID, the skill index
    // - and the bridge's callback of the same name does the object plumbing in-domain, which is
    // exactly what the reference's own loader does from inside that same domain.
    AttackMonster: {
        compute: function (ctx, p) { return ctx.raw('AttackMonster', [String(p[0])]); }
    },
    AttackMonsterByMonMapId: {
        compute: function (ctx, p) { return ctx.raw('AttackMonsterByMonMapId', [String(p[0])]); }
    },
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
                const player = avatarIn(avatars, p[0]);
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
    // Root.as:SetFPS - this.stg.frameRate = parseInt(param1). The game root is a display object,
    // so its own `stage` is the shared stage the wrapper and the game run on.
    SetFPS: { set: 'stage.frameRate', value: function (p) { return parseInt(p[0], 10); } },
    SetTitle: { why: 'the reference writes its own login movie chrome; the game has no equivalent' },
    SendMessage: { why: 'the reference writes into its own chat box; the game has no such member' },
    GetConnMC: { why: 'the reference reads its own connection dialog, which the game does not expose' },
    // Root.as:HideConnMC - Game.mcConnDetail.hideConn(), where Game is the game root.
    HideConnMC: { call: 'mcConnDetail.hideConn' },
    IsConnMCBackButtonVisible: { why: 'the reference reads its own connection dialog control' },
    Buff: { why: 'the reference writes god-mode values onto itself; not a game call' },
    DestroyPlayers: { why: 'the reference calls destroyAvatar per live avatar object' },
    SetEquip: { why: 'the reference writes a live equip entry and then swaps the clip; the ' +
        'clip half is loadMovieAtES (reachable), the entry half is a live object graph the ' +
        'bridge cannot carry, and world.sendEquipItemRequest is the game own way to wear it' },
    ChangeName: {
        compute: function (ctx, p) {
            const name = String(p[0]).toUpperCase();
            return Promise.all([
                ctx.set('world.myAvatar.pMC.pname.ti.text', name),
                ctx.set('world.ui.mcPortrait.strName.text', name),
                ctx.set('world.myAvatar.objData.strUsername', name),
                ctx.set('world.myAvatar.pMC.pAV.objData.strUsername', name)
            ]);
        }
    },
    ChangeGuild: {
        compute: function (ctx, p) {
            // The loader's own body is guarded by 'guild != null': no guild, no writes.
            return ctx.get('world.myAvatar.objData.guild').then(function (guild) {
                if (guild === null || guild === undefined) return null;
                const name = String(p[0]).toUpperCase();
                return Promise.all([
                    ctx.set('world.myAvatar.pMC.pname.tg.text', name),
                    ctx.set('world.myAvatar.objData.guild.Name', name),
                    ctx.set('world.myAvatar.pMC.pAV.objData.guild.Name', name)
                ]);
            });
        }
    },
    ChangeAccessLevel: { why: 'the reference styles its own name plate and sets iUpgDays' },
    // Player.as: one write, the colour, onto the plate's own text field.
    ChangeColorName: { set: 'world.myAvatar.pMC.pname.ti.textColor' },
    GetShops: { why: 'the reference keeps its own list of shops it has seen (LoadedShops)' },
    LoadBankItems: { why: 'the loader sends its own loadBank frame; ticket #29\'s window uses the game path' },
    // Player.as:MuteToggle - true unmutes, false mutes the chat box for five minutes.
    MuteToggle: {
        compute: function (ctx, p) {
            return truthy(p[0])
                ? ctx.call('chatF.unmuteMe', [])
                : ctx.call('chatF.muteMe', [300000]);
        }
    },
    // The one pair the reference never uses for its own statements: #42 derives aura state from
    // the packet tap instead (bot/auras.js), because the reference's statements read a cache the
    // frames fill rather than a lookup, and a lookup answers a packet stale. Kept named so a
    // caller that asks for them gets that reason rather than a bare "no member".
    GetAurasValue: {
        why: 'its body reads the avatar\'s live aura array one frame behind the game; the aura ' +
            'state is derived from the packet tap instead (bot/auras.js, ticket #42)'
    },
    AuraDuration: {
        why: 'its body reads the avatar\'s live aura array and the frame timestamp; the aura ' +
            'state and its remaining time come from the packet tap instead (bot/auras.js, #42)'
    },
    UseSkill: {
        compute: function (ctx, p) { return ctx.raw('UseSkill', [index(p[0])]); }
    },
    ForceUseSkill: {
        compute: function (ctx, p) { return ctx.raw('ForceUseSkill', [index(p[0])]); }
    },
    SetTargetPvP: {
        // The reference's C# passes null when its auto-target box is cleared
        // (`chkEnableAutoTarget.Checked ? dropPlayers.SelectedItem.ToString() : null`), so an
        // absent argument is sent as null rather than left undefined - "scan for anyone" and
        // "the player named this" are different scans, and the bridge branches on that.
        compute: function (ctx, p) {
            const name = p[0] === null || p[0] === undefined ? null : String(p[0]);
            return ctx.raw('SetTargetPvP', [name]);
        }
    },
    CancelTargetSelf: {
        compute: function (ctx) { return ctx.raw('CancelTargetSelf', []); }
    },
    MapLoadComplete: { why: 'the reference inspects its own display list; ticket #41 owns state' },
    RejectDrop: {
        compute: function (ctx, p) { return ctx.raw('RejectDrop', [String(p[0]), String(p[1])]); }
    },

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

    /**
     * The bridge's own existence probe (isNull), which is how a guard like the loader's
     * `if(_loc2_.pMC)` survives when the value itself cannot be read: the path answers whether a
     * member is there without trying to carry it.
     */
    function present(path) {
        return Promise.resolve(call('isNull', [path])).then(function (answer) {
            return answer !== true && answer !== 'true';
        });
    }

    /**
     * One of the bridge's own callbacks by name, for the helpers whose work the movie has to do
     * itself because the argument or the return value is a live ActionScript object (ticket #49).
     * `raw` rather than `call` because these are not game paths: the name is the callback, and
     * the plugin layer needs to see no difference between the two.
     */
    function raw(name, args) {
        return call(name, args);
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
                return Promise.resolve(row.compute({
                    get: get, call: invoke, set: write, present: present, raw: raw
                }, p));
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
