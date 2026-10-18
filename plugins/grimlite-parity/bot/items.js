// The item and quest commands (ticket #39): buying, selling, equipping, banking, dropping and
// using items, and the four quest commands, in the variants the reference offers.
//
// Reference: Grimoire/Botting/Commands/Item/*.cs and .../Quest/*.cs, with the helpers those files
// call (Grimoire/Game/Data/{Shop,Quests,Quest,Inventory,Bank,InventoryItem,TempInventory}.cs and
// Grimoire/Game/{Player,World,DropStack}.cs).
//
// ONE DOOR, AND ITS NAMES ARE EVIDENCE. Every game read and write goes through ask(), and every
// name ask() accepts is in one of the two tables below:
//
//   LOADER_BODIES  the reference loader's own helper names, asked for by that name through the
//                  bridge's loaderCall (ticket #48's surface). Each row records the loader body
//                  the name stands for; a test asserts each is on surface.implemented().
//   GAME_READS     the wants no loader name answers, read through the generic callbacks. Each row
//                  records the game source that proves the path or the call, so a reader can check
//                  it rather than trust it.
//
// This is the same split bot/session.js makes for the same reason: the surface is the door for
// every name it carries, and a module that needs a want it does not carry says so in one place
// with its evidence, rather than spelling paths out wherever a command happens to need one.
//
// Three of the reference's wants have no loader helper at all, and each is handled by naming the
// route rather than faking a result: see OWN_ROUTES.

const surface = require('../loader-surface.js');

/**
 * The reference loader's own helper names this module asks for, with the body each one stands for
 * in the reference's own decompiled loader (grimoire/game/*.as). A test asserts every name here is
 * on the surface's implemented list, so a name this build cannot answer is a build-time failure
 * rather than something a user meets halfway through a bot.
 */
const LOADER_BODIES = {
    IsLoggedIn: { body: 'Root.Game.sfc != null && sfc.isConnected' },
    IsActionAvailable: { body: 'world.lock[action] against the clock, in World.as' },
    State: { body: 'world.myAvatar.dataLeaf.intState - the game own Dead/Idle/InCombat' },
    Cell: { body: 'world.strFrame' },
    Pad: { body: 'world.strPad' },
    Jump: { body: 'world.moveToCell(cell, pad)' },
    Gold: { body: 'world.myAvatar.objData.intGold' },
    LoadShop: { body: 'Shop.Load -> ResetShopInfo then world.sendLoadShopRequest' },
    IsShopLoaded: { body: 'world.shopinfo not null and shopinfo.items.length > 0' },
    BuyItemQty: { body: 'Shop.BuyItemQty(name, qty) -> world.sendBuyItemRequestWithQuantity' },
    BuyItemQtyById: { body: 'Shop.BuyItemQtyById(qty, itemId, shopItemId)' },
    SellItem: { body: 'Shop.SellItem - the item resolved by name, then the sell request' },
    GetInventoryItems: { body: 'world.myAvatar.items' },
    GetInventoryItemByName: { body: 'Inventory.GetItemByName - the case-insensitive name match' },
    GetBankItemByName: { body: 'Bank.GetItemByName - the case-insensitive name match' },
    GetBankItems: { body: 'world.bankinfo.items' },
    GetTempItems: { body: 'world.myAvatar.tempitems' },
    TransferToBank: { body: 'Inventory.GetItemByName then world.sendBankFromInvRequest' },
    TransferToInventory: { body: 'Bank.GetItemByName then world.sendBankToInvRequest' },
    BankSwap: { body: 'both names resolved, then world.sendBankSwapInvRequest(bank, inv)' },
    Equip: { body: 'world.sendEquipItemRequest({ItemID: id})' },
    EquipPotion: { body: 'world.equipUseableItem({ItemID, sDesc, sFile, sName})' },
    GetMapItem: { body: 'world.getMapItem(id)' },
    RoomId: { body: 'World.as:RoomId -> world.curRoom.toString(), the room the drop frame names' },
    Accept: { body: 'world.acceptQuest(id)' },
    Complete: { body: 'world.tryQuestComplete(id, itemId, bool, qty)' },
    LoadQuest: { body: 'world.showQuests([id], "q")' },
    IsInProgress: { body: 'world.isQuestInProgress(id)' },
    CanComplete: { body: 'world.canTurnInQuest(id) with the validation string' },
    IsAvailable: { body: 'the validation string, empty when the quest is available' },
    GetQuestTree: { body: 'world.questTree as a list' }
};

/**
 * The wants the loader surface does not carry, and the route to each. Every row names the game
 * source that proves it, so this table is checkable rather than a claim.
 *
 * Nothing here duplicates loader-surface.js: that table describes the reference loader's names,
 * and these are the four questions no name in it answers.
 */
const GAME_READS = {
    // The shop rows a maximum buy resolves: which item, what it stacks to, what it costs and what
    // it consumes. Shops.as reads exactly this path (GetShopItem / MaximumShopBuys in Shop.cs).
    shopItems: { path: 'world.shopinfo.items', body: 'world.shopinfo.items (Shops.as:GetShopItem)' },
    // World.cs:getQuestValue - the counter a one-shot quest's iSlot is compared against, and
    // Quests.as:progress is literally Flash.CallGameFunction2("world.getQuestValue", slot).
    questValue: { call: 'world.getQuestValue', body: 'World.as:getQuestValue(slot)' },
    // Quest.cs:getMaxCall - Flash.CallGameFunction2("world.maximumQuestTurnIns", Id).
    maximumTurnIns: { call: 'world.maximumQuestTurnIns', body: 'World.as:maximumQuestTurnIns(id)' },
    // The inventory tree, keyed by ItemID, which is where the game files a drop as it arrives:
    // Game.as's dropItem case writes world.invTree[dID] before the drop stack is drawn from it.
    // World.DropStack's own list is renderer state the reference keeps in C#; this tree is the
    // game's copy of the same facts.
    drops: { path: 'world.invTree', body: 'world.invTree (Game.as dropItem case)' },
    // Player.Coins: Flash.GetGameObject("world.myAvatar.objData.intCoins").
    coins: { path: 'world.myAvatar.objData.intCoins', body: 'Player.cs:Coins -> objData.intCoins' }
};

/**
 * The three wants no loader helper answers and no path reaches: each needs a frame sent through
 * the packet path. Records rather than refusals - the frame the reference sends is sent here too.
 */
const OWN_ROUTES = {
    ExitCombat: 'Player.ExitCombat and Player.refreshCell both move the character to the cell it ' +
        'already stands in (MoveToCell(Cell, Pad) -> Flash.Call("Jump")), and the loader registers ' +
        'neither name, so both are the loader own Jump on Cell and Pad - ExitCombat keeping the ' +
        'game State gate and the two waits the reference wraps around it',
    GetDrop: 'DropStack.cs:GetDrop builds %xt%zm%getDrop%<room>%<itemId>% and sends it through the ' +
        'proxy, and no loader name sends a frame, so the room comes from the loader RoomId and the ' +
        'id from the inventory tree the game files drops in, and the frame goes through the ' +
        'packet path',
    GhostAccept: 'Quest.GhostAccept sends %xt%zm%acceptQuest%1%<id>% through the socket, so a ' +
        'ghost accept is a frame and not a loader name'
};


const ERRORS = {
    noGame: 'this bot has no game access, so an item or quest command cannot run',
    noPackets: 'this build has no packet path, so a frame cannot be sent'
};

// How many times a handler re-sends something the game has to acknowledge before it gives up and
// says so. The reference loops until the game reports the item worn or the quest accepted, with no
// bound, because over ActiveX the game always answers; over a bridge a window that went away
// mid-command would spin the app, so this stops and reports what it saw.
const EQUIP_TRIES = 5;
const EQUIP_RETRY_MS = 200;
const ACCEPT_TRIES = 2;

// Player.ExitCombat's own first wait, before it moves. A property of the reference, not a knob.
const EXIT_COMBAT_MS = 100;

// CmdEquip's Safe loop refreshes the cell every second while the game reports combat, and the
// reference leaves it unbounded. A window that went away mid-command would spin the app, so this
// stops and says what it saw, the same way the equip loop above does.
const COMBAT_TRIES = 5;

function message(error) {
    return (error && error.message) || String(error);
}

function lower(value) {
    return String(value === null || value === undefined ? '' : value).toLowerCase();
}

function truthy(value) {
    return value === true || value === 1 || value === '1' || value === 'true' || value === 'True';
}

/** A payload that may be an array, an {items} object or a map keyed by id, as a list. */
function asList(payload) {
    if (payload === null || payload === undefined || payload === '') return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.$values)) return payload.$values;
    if (Array.isArray(payload.items)) return payload.items;
    if (typeof payload !== 'object') return [];
    return Object.keys(payload).map(function (key) { return payload[key]; })
        .filter(function (value) { return value && typeof value === 'object'; });
}

/** The item in a list whose sName matches, case-insensitively - the reference's own lookup. */
function byName(list, name) {
    const want = lower(name);
    const items = asList(list);
    for (let i = 0; i < items.length; i++) {
        if (lower(items[i].sName) === want) return items[i];
    }
    return null;
}

function qtyOf(item) {
    if (!item) return 0;
    return Number(item.iQty === undefined ? item.Quantity : item.iQty) || 0;
}

/** InventoryItem.EquippableCategories, which is what every equip path filters on. */
const EQUIPPABLE = ['Sword', 'Axe', 'Dagger', 'Gun', 'Bow', 'Mace', 'Polearm', 'Staff', 'Wand',
    'Class', 'Armor', 'Helm', 'Cape', 'Necklace', 'Misc', 'Item'];

function categoryOf(item) {
    if (!item) return '';
    return String(item.sType === undefined ? item.category : item.sType);
}

function isEquippable(item) {
    return EQUIPPABLE.indexOf(categoryOf(item)) !== -1;
}

// InventoryItem.forgeID and InventoryItem.EnhancementNames. CmdEquip resolves a name against these
// before it falls back to the plain item name, and that order decides what gets worn.
const FORGE_IDS = {
    ForgeCape: 71406, Lament: 71543, Penitence: 71542, Vainglory: 70968, Absolution: 70969,
    Avarice: 70970, ForgeHelm: 71537, Hearty: 81467, Examen: 71539, Anima: 71541, Pneuma: 71540,
    Vim: 71538, ForgeWeapon: 70753, Praxis: 76979, Dauntless: 76980, Ravenous: 83500,
    Acheron: 71628, Elysium: 71629, Smite: 70751, Valiance: 70752, Arcana: 70991, Lacerate: 70750
};

const ENHANCEMENT_NAMES = {
    'Luck Spiral Carve': 52368, 'Luck Awe Blast': 52369, 'Luck Health Vamp': 52370,
    'Luck Mana Vamp': 52371, 'Luck Powerword Die': 52372
};

/** The forge enum name CmdEquip tries first, matched case-insensitively as Enum.TryParse does. */
function forgeId(raw) {
    const keys = Object.keys(FORGE_IDS);
    for (let i = 0; i < keys.length; i++) {
        if (lower(keys[i]) === lower(raw)) return FORGE_IDS[keys[i]];
    }
    return null;
}

function enhancementId(raw) {
    const keys = Object.keys(ENHANCEMENT_NAMES);
    for (let i = 0; i < keys.length; i++) {
        if (lower(keys[i]) === lower(raw)) return ENHANCEMENT_NAMES[keys[i]];
    }
    return null;
}

/** The item CmdEquip's four steps resolve to, or null: forge name, enhancement name, id, name. */
function pickEquipTarget(bag, raw) {
    const equippable = asList(bag).filter(isEquippable);
    function byEnhancement(id) {
        return equippable.filter(function (item) { return Number(item.iEnh) === id; })[0];
    }

    const forge = forgeId(raw);
    if (forge !== null) {
        const match = byEnhancement(forge);
        if (match) return match;
    }
    const enhancement = enhancementId(raw);
    if (enhancement !== null) {
        const match = byEnhancement(enhancement);
        if (match) return match;
    }
    if (/^-?[0-9]+$/.test(String(raw))) {
        const match = byEnhancement(parseInt(String(raw), 10));
        if (match) return match;
    }
    return equippable.filter(function (item) { return lower(item.sName) === lower(raw); })[0] || null;
}

/**
 * The game access the item and quest commands run on. It is a narrow interface and nothing else: a
 * plain object of the same shape satisfies it under test, which is what lets every branch in the
 * handlers be covered without Flash. Under the plugin it is built over the bridge channel, so both
 * doors below reach the live game.
 *
 * @param {object} deps
 * @param {(name:string, args:Array)=>Promise<any>} [deps.loaderCall]  the reference loader surface
 * @param {(callback:string, args:Array)=>Promise<any>} [deps.call]    the generic bridge callbacks
 * @param {(direction:string, text:string)=>boolean} [deps.sendFrame]  the packet path (packet-send)
 * @param {(ms:number)=>Promise<void>} [deps.sleep]
 * @param {(line:string)=>void} [deps.log]
 * @param {object} [deps.config]  a configuration to act on when no context supplies one
 */
function createAccess(deps) {
    deps = deps || {};
    const loaderCall = deps.loaderCall;
    const call = deps.call;
    const sleep = deps.sleep || function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };
    const log = deps.log || function () {};

    /**
     * One want, by the name that owns it. A name in LOADER_BODIES goes through the loader surface
     * (the reference's own helper); a name in GAME_READS goes through the generic callbacks (the
     * path or call the row records). A name in neither is a programming error, and says so.
     */
    function ask(name, args) {
        const passed = args || [];
        if (LOADER_BODIES[name]) {
            if (typeof loaderCall !== 'function') {
                return Promise.reject(new Error(ERRORS.noGame));
            }
            return Promise.resolve(loaderCall(name, passed));
        }
        const read = GAME_READS[name];
        if (read) {
            if (typeof call !== 'function') {
                return Promise.reject(new Error(ERRORS.noGame));
            }
            // The two shapes a caller hands back: the bridge's own {ok, value} answer, and the
            // decoded value itself (botGame.call, which unwraps on the way out). Both are accepted
            // here so this module is built against the door rather than against one of its returns.
            if (read.path) {
                return Promise.resolve(call('getGameObject', [read.path])).then(function (answer) {
                    const unwrapped = unwrap(answer, read.path);
                    if (!unwrapped.ok) {
                        throw new Error(unwrapped.error || ('the game did not answer ' + read.path));
                    }
                    return unwrapped.value;
                });
            }
            const callback = passed.length ? 'callGameFunction' : 'callGameFunction0';
            return Promise.resolve(call(callback, [read.call].concat(passed)))
                .then(function (answer) {
                    const unwrapped = unwrap(answer, read.call);
                    if (!unwrapped.ok) {
                        throw new Error(unwrapped.error || ('the game did not answer ' + read.call));
                    }
                    return unwrapped.value;
                });
        }
        return Promise.reject(new Error('no want named "' + name + '" - it is in neither ' +
            'LOADER_BODIES nor GAME_READS, so nothing here answers it'));
    }

    /** The bridge hands a JSON string, and its own {"error": ...} for a path that did not resolve. */
    function decode(value) {
        if (typeof value !== 'string') return value === undefined ? null : value;
        let parsed;
        try {
            parsed = JSON.parse(value);
        } catch (error) {
            return value;
        }
        if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
            throw new Error(parsed.error);
        }
        return parsed;
    }

    /**
     * The value behind an answer, whichever shape the door returned it in: the bridge's own
     * {ok, value} envelope, or an already-decoded value. A value the game could not express is
     * handed over already stringified, and the game's own {"error": ...} is raised by name.
     */
    function unwrap(answer, what) {
        const wrapped = answer && typeof answer === 'object' && typeof answer.ok === 'boolean';
        const raw = wrapped ? answer.value : answer;
        if (wrapped && !answer.ok) {
            return { ok: false, error: answer.error || ('the game did not answer ' + what) };
        }
        try {
            return { ok: true, value: decode(raw) };
        } catch (error) {
            return { ok: false, error: message(error) };
        }
    }

    /** A want as a value-or-reason, for a caller deciding rather than failing. */
    function attempt(name, args) {
        return ask(name, args).then(function (value) {
            return { ok: true, value: value };
        }, function (error) {
            return { ok: false, error: message(error) };
        });
    }

    /** The loader names this build answers, so a caller can say what it is waiting for. */
    function implementedNames() {
        return surface.implemented();
    }

    /**
     * World.IsActionAvailable(action): the reference's own lock check before a transaction. The
     * surface computes it from world.lock, so a lock the game has not set is available.
     */
    function actionAvailable(action) {
        return attempt('IsActionAvailable', [action]).then(function (answered) {
            return answered.ok ? answered.value !== false : false;
        });
    }

    /** BotUtilities.WaitUntil: poll until it holds, or until the count of waits runs out. */
    function waitUntil(condition, options) {
        const opts = options || {};
        const interval = opts.interval === undefined ? 1000 : opts.interval;
        const timeout = opts.timeout === undefined ? 15 : opts.timeout;
        let iterations = 0;
        function step() {
            return Promise.resolve(condition()).then(function (done) {
                if (done || (iterations >= timeout && timeout !== -1)) return;
                iterations++;
                return sleep(interval).then(step);
            });
        }
        return step();
    }

    const access = {
        sleep: sleep,
        log: log,
        ask: ask,
        attempt: attempt,
        implementedNames: implementedNames,
        actionAvailable: actionAvailable,
        waitUntil: waitUntil,
        config: deps.config,
        sendFrame: deps.sendFrame,

        // ------------------------------------------------------------------ the item reads

        inventoryItems: function () {
            return ask('GetInventoryItems', []).then(asList);
        },
        inventoryItem: function (name) {
            return ask('GetInventoryItemByName', [name]);
        },
        bankItems: function () {
            return ask('GetBankItems', []).then(asList);
        },
        bankItem: function (name) {
            return ask('GetBankItemByName', [name]);
        },
        tempItems: function () {
            return ask('GetTempItems', []).then(asList);
        },
        inInventory: function (name) {
            return ask('GetInventoryItemByName', [name]).then(function (item) { return !!item; });
        },
        coins: function () {
            return ask('coins', []).then(function (value) { return Number(value) || 0; },
                function () { return 0; });
        },
        gold: function () {
            return ask('Gold', []).then(function (value) { return Number(value) || 0; },
                function () { return 0; });
        },

        /** Shop.IsShopLoaded. */
        shopLoaded: function () {
            return ask('IsShopLoaded', []).then(function (value) { return value === true; });
        },

        /** Shop.Load(id), then the wait the caller asks for. */
        loadShop: function (id, options) {
            const opts = options || {};
            return ask('LoadShop', [String(id)]).then(function () {
                return waitUntil(function () { return access.shopLoaded(); }, {
                    interval: opts.interval === undefined ? 500 : opts.interval,
                    timeout: opts.timeout === undefined ? 15 : opts.timeout
                });
            });
        },

        /** The loaded shop's rows: every buy below resolves a name or an id against these. */
        shopItems: function () {
            return ask('shopItems', []).then(asList);
        },

        // ------------------------------------------------------------------ the quest reads

        isInProgress: function (id) {
            return ask('IsInProgress', [String(id)]).then(function (value) { return value === true; });
        },
        canComplete: function (id) {
            return ask('CanComplete', [String(id)]).then(function (value) { return value === true; });
        },
        isAvailable: function (id) {
            return ask('IsAvailable', [String(id)]).then(function (value) { return value === true; });
        },
        questTree: function () {
            return ask('GetQuestTree', []).then(asList);
        },
        questProgress: function (slot) {
            return ask('questValue', [String(slot)]).then(function (value) { return Number(value) || 0; });
        },
        maximumTurnIns: function (id) {
            return ask('maximumTurnIns', [String(id)]).then(function (value) {
                return Number(value) || 0;
            }, function () { return 0; });
        },

        /**
         * Player.Quests.HasQuest(id): the reference reads its own cache of the quest tree, which is
         * the list the loader's GetQuestTree answers. A quest is "loaded" exactly when the tree
         * holds a row for it - which is what CmdAcceptQuest waits for after its Load, and the two
         * are different questions from whether the quest is in progress.
         */
        hasQuest: function (id) {
            return access.quest(id).then(function (row) { return !!row; });
        },

        /** The quest row the tree holds for an id, or null. */
        quest: function (id) {
            return access.questTree().then(function (tree) {
                const wanted = String(id);
                return tree.filter(function (row) {
                    return row && String(row.QuestID) === wanted;
                })[0] || null;
            });
        },

        /** The drops the game has filed, which is what CmdGetDrop's name resolves against. */
        dropItems: function () {
            return ask('drops', []).then(asList);
        },

        /** World.RoomId: the room a frame names, which the reference's own World.cs reads. */
        roomId: function () {
            return ask('RoomId', []).then(function (value) { return String(value === null || value === undefined ? '' : value); });
        },

        /** In combat, as the game's own dataLeaf state says (State.InCombat is 2). */
        inCombat: function () {
            return ask('State', []).then(function (value) { return Number(value) === 2; },
                function () { return false; });
        },

        // ------------------------------------------------------------------ the writes

        accept: function (id) { return ask('Accept', [String(id)]); },
        complete: function (id, qty, itemId) {
            return ask('Complete', [String(id), String(qty === undefined ? 1 : qty),
                itemId === undefined || itemId === null ? '-1' : String(itemId), 'False']);
        },
        loadQuest: function (id) { return ask('LoadQuest', [String(id)]); },
        equip: function (id) { return ask('Equip', [String(id)]); },
        equipPotion: function (id, desc, file, name) {
            return ask('EquipPotion', [String(id), String(desc || ''), String(file || ''), String(name || '')]);
        },
        getMapItem: function (id) { return ask('GetMapItem', [String(id)]); },
        transferToBank: function (name) { return ask('TransferToBank', [name]); },
        transferToInventory: function (name) { return ask('TransferToInventory', [name]); },
        bankSwap: function (invName, bankName) { return ask('BankSwap', [invName, bankName]); },
        sellItem: function (name, qty) { return ask('SellItem', [name, String(qty)]); },

        /**
         * Player.refreshCell (OWN_ROUTES): a move to the cell the character already stands in,
         * which is what Player.MoveToCell(Cell, Pad) is - the loader's own Jump on Cell and Pad.
         * The loader registers no refreshCell of its own.
         */
        refreshCell: function () {
            return Promise.all([ask('Cell', []), ask('Pad', [])]).then(function (both) {
                return ask('Jump', [String(both[0]), String(both[1])]);
            });
        },

        /**
         * Player.ExitCombat(delay = 1000, force = false) (OWN_ROUTES): it does nothing unless the
         * game says the character is in combat (or the caller forces it), and when it does act it
         * waits 100 ms, refreshes the cell, then waits out the caller's delay. The state read is
         * the loader's own State name, so the gate is the game's answer rather than a guess here.
         */
        exitCombat: function (delay, force) {
            const ms = delay === undefined ? 1000 : delay;
            return access.inCombat().then(function (fighting) {
                if (!fighting && force !== true) return null;
                return sleep(100).then(function () { return access.refreshCell(); }).then(function () {
                    return sleep(ms);
                });
            });
        },

        /**
         * World.DropStack.GetDrop(name) (OWN_ROUTES): resolve the name, then hand the id back for
         * the caller to send. A name no drop carries is a refusal that names it.
         */
        dropByName: function (name) {
            return access.dropItems().then(function (drops) {
                const wanted = lower(name);
                const drop = drops.filter(function (row) {
                    return lower(row && (row.sName || row.Name)) === wanted;
                })[0];
                if (!drop) {
                    throw new Error('no drop named "' + name + '" has been seen here, so there is ' +
                        'nothing to take');
                }
                return Number(drop.ItemID === undefined ? drop.Id : drop.ItemID);
            });
        },

        /**
         * Send one frame through the packet path. False means the relay had no live connection,
         * which is reported rather than retried: the frame was neither queued nor invented.
         */
        send: function (direction, text) {
            const sendFrame = access.sendFrame;
            if (typeof sendFrame !== 'function') {
                return Promise.reject(new Error(ERRORS.noPackets));
            }
            return Promise.resolve(sendFrame(direction, text)).then(function (sent) {
                if (sent === false) {
                    throw new Error('the relay is not connected, so this frame was not sent: ' + text);
                }
                return true;
            });
        },

        /**
         * Quest.GhostAccept (OWN_ROUTES): the reference's own frame, which goes out through the
         * socket rather than through a helper. With no packet path there is nothing to send, and
         * that is a refusal rather than a silent success - a bot waiting on an accept that never
         * went out looks exactly like a game that refused it.
         */
        ghostAccept: function (id) {
            return access.send('toServer', '%xt%zm%acceptQuest%1%' + id + '%');
        }
    };

    return access;
}


// ---------------------------------------------------------------------------- the reference maths

/**
 * Shop.cs:GetShopItemData(itemID, shopItemID) - the by-id lookup a ByID buy resolves its maximum
 * against. The reference's own match is the ItemID and, when a ShopItemID is given, that too; a
 * zero ShopItemID means "any row carrying this ItemID".
 */
async function shopItemById(access, itemId, shopItemId) {
    const rows = asList(await access.shopItems());
    const wanted = Number(itemId);
    const wantedShopItem = Number(shopItemId) || 0;
    return rows.filter(function (row) {
        return Number(row && row.ItemID) === wanted &&
            (wantedShopItem === 0 || Number(row && row.ShopItemID) === wantedShopItem);
    })[0] || null;
}

/**
 * Shop.cs:MaximumShopBuys - the room the stack leaves, the currency the cost eats into and the
 * merge materials the recipe needs, in the reference's own order, with its own last word.
 */
async function maximumShopBuys(access, shopItem) {
    if (!shopItem) return 0;
    if (String(shopItem.sES) === 'ar') return 1;

    const inventory = asList(await access.inventoryItems());
    const owned = inventory.filter(function (item) {
        return Number(item.ItemID) === Number(shopItem.ItemID);
    })[0];
    const perBuy = Number(shopItem.iQty) || 1;
    const stackRemaining = owned
        ? (Number(shopItem.iStk) || 0) - qtyOf(owned)
        : (Number(shopItem.iStk) || 0);
    const stackLimit = Math.floor(stackRemaining / perBuy);
    if (stackLimit < 1) return 0;

    let maxBuys = stackLimit;

    const cost = Number(shopItem.iCost) || 0;
    if (cost > 0) {
        // bCoins == 1 is the AC cost, which the reference reads off the avatar's own intCoins;
        // anything else is gold, which the loader's Gold name answers.
        const held = truthy(shopItem.bCoins) ? await access.coins() : await access.gold();
        maxBuys = Math.min(maxBuys, Math.floor(held / cost));
    }

    const turnin = shopItem.turnin;
    if (Array.isArray(turnin) && turnin.length) {
        for (let i = 0; i < turnin.length; i++) {
            const need = turnin[i];
            const material = inventory.filter(function (item) {
                return Number(item.ItemID) === Number(need.ItemID);
            })[0];
            if (!material) return 0;
            const materialLimit = Math.floor(qtyOf(material) / (Number(need.iQty) || 1));
            if (materialLimit === 0) return 0;
            maxBuys = Math.min(maxBuys, materialLimit);
        }
    }

    return Math.min(maxBuys * perBuy, 100000);
}

/**
 * Quest.cs:getMax - for every required item, how many turn-ins the held quantity allows, then the
 * game's own maximumQuestTurnIns as a floor, which is the reference's own Math.Max at the end.
 */
async function maximumTurnIns(access, id) {
    let complete = 10000;
    const quest = await access.quest(id).catch(function () { return null; });
    const required = (quest && (quest.reqd || quest.RequiredItems)) || [];
    if (Array.isArray(required) && required.length) {
        const inventory = asList(await access.inventoryItems());
        const temp = asList(await access.tempItems().catch(function () { return []; }));
        for (let i = 0; i < required.length; i++) {
            const need = required[i];
            const where = truthy(need.bTemp) ? temp : inventory;
            const held = where.filter(function (item) {
                return Number(item.ItemID) === Number(need.ItemID);
            })[0];
            const perTurnIn = Number(need.iQty === undefined ? need.Quantity : need.iQty) || 1;
            complete = Math.min(complete, Math.floor(qtyOf(held) / perTurnIn));
        }
    }
    return Math.max(await access.maximumTurnIns(id), complete);
}

/** CmdEquip's own IsEquipped: an inventory row carrying the same id and the worn flag. */
async function isEquipped(access, itemId) {
    const bag = await access.inventoryItems().catch(function () { return []; });
    return asList(bag).some(function (item) {
        return Number(item.ItemID) === Number(itemId) && truthy(item.bEquip);
    });
}

/** Inventory.GetItemByName through the access, as the item or null. */
async function itemByName(access, name) {
    return access.inventoryItem(name).catch(function () { return null; });
}

/** The value a command was written with, resolved the way the engine resolves variables. */
function resolved(ctx, value) {
    return typeof ctx.resolve === 'function' ? ctx.resolve(value)
        : String(value === undefined || value === null ? '' : value);
}

/** A number out of a value that may be a string or a variable reference. */
function number(value, fallback) {
    const parsed = parseInt(String(value), 10);
    return isNaN(parsed) ? fallback : parsed;
}

/** The configuration a handler acts on: the context's own, or the access's. */
function configOf(ctx, access) {
    const live = typeof ctx.config === 'function' ? ctx.config() : null;
    return live || access.config || {};
}

function setConfig(ctx, access, key, value) {
    if (typeof ctx.setConfig === 'function') ctx.setConfig(key, value);
    else configOf(ctx, access)[key] = value;
}

function listOf(config, key) {
    const value = config && config[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.$values)) return value.$values;
    return [];
}

/** Put a list back where it came from, wrapped the way the document had it. */
function writeList(config, key, list) {
    if (Array.isArray(config[key])) config[key] = list;
    else if (config[key] && Array.isArray(config[key].$values)) config[key].$values = list;
    else config[key] = list;
    return list;
}

function dropsOf(config) {
    return listOf(config, 'Drops');
}

function questsOf(config) {
    return listOf(config, 'Quests');
}

/**
 * The id of a row in Configuration.Quests. The reference's Quest.Id is the int behind
 * [JsonProperty("QuestID")], so a row read out of a document carries it as QuestID; Id is accepted
 * too, because .gbot files from older writers put it there.
 */
function questIdOf(row) {
    if (!row || typeof row !== 'object') return NaN;
    const raw = row.QuestID === undefined || row.QuestID === null ? row.Id : row.QuestID;
    return Number(raw);
}

/** The Quest row a quest-list command writes: the shape the reference's own file carries. */
function questRow(id, itemId, safeRelogin) {
    const quest = { $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: id };
    if (itemId !== undefined && itemId !== null) quest.ItemId = String(itemId);
    if (safeRelogin) quest.SafeRelogin = true;
    return quest;
}

/**
 * What the reference's own WaitUntil asks before a transaction may run: still running, still
 * signed in. RunSync's third term - alive - is the engine's own business (it is what its death
 * branch acts on), so it is not asked again here.
 */
async function readiness(ctx, access) {
    if (typeof ctx.running === 'function' && !ctx.running()) return;
    const answered = await access.attempt('IsLoggedIn', []);
    if (answered.ok && answered.value === false) {
        throw new Error('the character is not signed in any more');
    }
}


// ---------------------------------------------------------------------------- the handlers

/**
 * The handlers, keyed by the class name the engine dispatches on. Each one is the reference's own
 * command class, in that class's own order, with its own refusals reproduced as a log line rather
 * than a thrown error - a command that cannot do its thing must not end the bot.
 *
 * @param {object} access the game access createAccess builds
 */
function handlers(access) {
    const sleep = access.sleep;

    /** The lock wait the reference's own WaitUntil makes before a transaction may start. */
    function waitForLock(options) {
        const opts = options || {};
        return access.waitUntil(function () { return access.actionAvailable(opts.action); },
            { interval: opts.interval === undefined ? 1000 : opts.interval,
                timeout: opts.timeout === undefined ? 15 : opts.timeout });
    }

    /**
     * BotUtilities.pauseProvoke: the reference's own using-block, which turns ProvokeMonsters off
     * for the length of a transaction and puts the value it found back afterwards. CmdBuyFast,
     * CmdLoad, CmdSell and CmdEquip all wrap their work in one, because provoking while a shop or
     * the bag is talking to the server is how a bot pulls a monster's attention mid-purchase.
     */
    async function pauseProvoke(ctx, body) {
        const config = configOf(ctx, access);
        const was = config.ProvokeMonsters;
        setConfig(ctx, access, 'ProvokeMonsters', false);
        try {
            return await body();
        } finally {
            setConfig(ctx, access, 'ProvokeMonsters', was);
        }
    }

    /** Out of combat, with a refusal logged rather than swallowed or thrown at the bot. */
    function leaveCombat(what, delay) {
        return access.exitCombat(delay).catch(function (error) {
            access.log(what + ': leaving combat failed: ' + message(error));
        });
    }

    /**
     * CmdEquip.Safe and CmdCompleteQuest's own wait: refresh the cell while the game reports
     * combat, one refresh a second, then hand back whether the character came out of it.
     */
    async function waitOutCombat(what) {
        for (let tries = 0; tries < COMBAT_TRIES; tries++) {
            if (!(await access.inCombat())) return true;
            await access.refreshCell();
            await sleep(1000);
        }
        access.log(what + ': the game still reports combat after ' + COMBAT_TRIES +
            ' refreshes; continuing rather than looping');
        return false;
    }

    return {
        // ------------------------------------------------------------------ buying

        CmdBuy: async function (ctx, command) {
            // CmdBuy.cs, in its own order: the buy and load-shop locks, out of combat, Load, wait
            // for the shop, then the buy - by id when ByID, by name otherwise - and a wait for the
            // bag to change, with the two different two-second timeouts it picks between.
            await access.waitUntil(function () {
                return Promise.all([access.actionAvailable('buyItem'), access.actionAvailable('loadShop')])
                    .then(function (both) { return both[0] && both[1]; });
            }, { timeout: 3 });
            await leaveCombat('CmdBuy', 2000);
            await readiness(ctx, access);
            // Shop.Load, then its own wait: the reference loads before it reads the bag, because
            // the row a maximum buy needs only exists once the shop has answered.
            await access.loadShop(number(command.ShopId, 0), { interval: 500 });

            const itemName = resolved(ctx, command.ItemName);
            const before = itemName ? await itemByName(access, itemName) : null;
            let qty = number(command.Qty, 1);

            if (command.ByID) {
                if (qty < 0) {
                    qty = await maximumShopBuys(access,
                        await shopItemById(access, command.ItemId, command.ShopItemId));
                    if (qty === 0) {
                        ctx.log('[MaxBuy] Buy skipped due to max/requirement not meet');
                        return;
                    }
                }
                await access.ask('BuyItemQtyById', [String(qty), String(number(command.ItemId, 0)),
                    String(number(command.ShopItemId, 0))]);
            } else {
                if (qty < 0) {
                    qty = await maximumShopBuys(access, byName(await access.shopItems(), itemName));
                    if (qty === 0) {
                        ctx.log('[MaxBuy] Buy skipped due to max/requirement not meet');
                        return;
                    }
                }
                await access.ask('BuyItemQty', [itemName, String(qty)]);
            }

            if (itemName) {
                await access.waitUntil(function () {
                    return itemByName(access, itemName).then(function (now) {
                        return before ? !!now && qtyOf(now) !== qtyOf(before) : !!now;
                    });
                }, { timeout: 2 });
            }
        },

        CmdBuyFast: async function (ctx, command) {
            // CmdBuyFast.cs: no shop load at all - the one lock, out of combat, then the buy.
            await access.waitUntil(function () { return access.actionAvailable('buyItem'); }, { timeout: 3 });
            await pauseProvoke(ctx, async function () {
                await leaveCombat('CmdBuyFast', 2000);
                await readiness(ctx, access);

                const itemName = resolved(ctx, command.ItemName);
                let qty = number(command.Qty, 1);
                if (qty < 0) {
                    qty = await maximumShopBuys(access, byName(await access.shopItems(), itemName));
                    if (qty === 0) {
                        ctx.log('[MaxBuy] Buy skipped due to max/requirement not meet');
                        return;
                    }
                }
                await access.ask('BuyItemQty', [itemName, String(qty)]);
            });
        },

        CmdLoad: async function (ctx, command) {
            // CmdLoad.cs: both locks, out of combat, Load, wait for the shop.
            await pauseProvoke(ctx, async function () {
                await access.waitUntil(function () {
                    return Promise.all([access.actionAvailable('buyItem'),
                        access.actionAvailable('loadShop')])
                        .then(function (both) { return both[0] && both[1]; });
                }, { timeout: 3 });
                await leaveCombat('CmdLoad');
                await readiness(ctx, access);
                await access.loadShop(number(command.ShopId, 0), { timeout: 3 });
            });
        },

        CmdLoadTravel: async function (ctx, command) {
            // CmdLoadTravel.cs has its own WaitUntil: the loadShop lock only, and no exit combat.
            await waitForLock({ action: 'loadShop' });
            await readiness(ctx, access);
            await access.loadShop(number(command.ShopId, 0));
        },

        // ------------------------------------------------------------------ selling

        CmdSell: async function (ctx, command) {
            // CmdSell.cs: the sell lock, the item by name, out of combat, then Shop.SellItem with
            // the two quantities it derives - 0 is the whole stack, -N leaves N behind.
            const itemName = resolved(ctx, command.ItemName);
            const qty = number(resolved(ctx, command.Qty), 1);
            await waitForLock({ action: 'sellItem' });

            const item = await itemByName(access, itemName);
            if (!item) {
                ctx.log('CmdSell: no item named "' + itemName + '" is in the inventory, so nothing was sold');
                return;
            }
            await pauseProvoke(ctx, async function () {
                await leaveCombat('CmdSell', 2000);
                await readiness(ctx, access);

                const held = qtyOf(item);
                const selling = qty <= 0 ? qty + held : qty;
                if (selling <= 0) {
                    ctx.log('CmdSell: "' + itemName + '" holds ' + held + ' and the command asks to ' +
                        (qty === 0 ? 'sell nothing' : 'leave ' + Math.abs(qty) + ' behind') +
                        ', so nothing was sold');
                    return;
                }
                await access.sellItem(itemName, selling);
                await access.waitUntil(function () {
                    return itemByName(access, itemName).then(function (now) {
                        return !now || qtyOf(now) !== held;
                    });
                }, { timeout: 3 });
            });
        },

        // ------------------------------------------------------------------ equipping

        CmdEquip: async function (ctx, command) {
            // CmdEquip.cs: the four resolution steps, then the loop - which waits out combat and
            // waits on the equip lock when the command is Safe, and equips once per pass.
            const raw = resolved(ctx, command.ItemName);
            const item = pickEquipTarget(await access.inventoryItems(), raw);
            if (!item) {
                ctx.log('CmdEquip: no equippable item matching "' + raw + '" is in the inventory');
                return;
            }

            for (let tries = 0; tries < EQUIP_TRIES; tries++) {
                if (await isEquipped(access, item.ItemID)) return;
                if (typeof ctx.running === 'function' && !ctx.running()) return;
                // The reference's using-block is inside the loop, so provoke is off for each pass
                // and back on between them - which is what its own indentation says.
                await pauseProvoke(ctx, async function () {
                    if (command.Safe) {
                        await waitOutCombat('CmdEquip');
                        await waitForLock({ action: 'equipItem' });
                    }
                    await readiness(ctx, access);
                    if (categoryOf(item) === 'Item') {
                        await access.equipPotion(item.ItemID, item.sDesc, item.sFile, item.sName);
                    } else {
                        await access.equip(item.ItemID);
                    }
                });
                await sleep(EQUIP_RETRY_MS);
            }
            if (!(await isEquipped(access, item.ItemID))) {
                ctx.log('CmdEquip: "' + item.sName + '" was sent ' + EQUIP_TRIES +
                    ' times and the game still does not report it worn');
            }
        },

        CmdEquipSet: async function (ctx, command) {
            // CmdEquipSet.cs reads a .gset from beside the executable and equips each entry in it.
            // This build has no path into the reference's own folder - a .gset is a user document
            // read where the user pointed the Sets dialog - so the entries have to come from that
            // read, and without them the command says so rather than wearing whatever shares a name.
            const name = resolved(ctx, command.ItemName);
            const entries = Array.isArray(ctx.setEntries) ? ctx.setEntries : null;
            if (!entries) {
                ctx.log('CmdEquipSet: "' + name + '" is a set file, and this build reads one where ' +
                    'the user pointed the Sets dialog rather than from beside the executable, so ' +
                    'no entries are available to wear');
                return;
            }
            const bag = asList(await access.inventoryItems());
            for (let i = 0; i < entries.length; i++) {
                const match = bag.filter(function (candidate) {
                    return lower(candidate.sName) === lower(entries[i].name) && isEquippable(candidate);
                })[0];
                if (!match) {
                    ctx.log('CmdEquipSet: "' + entries[i].name + '" is not an equippable item in the bag');
                    continue;
                }
                if (await isEquipped(access, match.ItemID)) continue;
                await waitOutCombat('CmdEquipSet');
                await waitForLock({ action: 'equipItem' });
                await readiness(ctx, access);
                await access.equip(match.ItemID);
            }
        },

        // ------------------------------------------------------------------ banking

        CmdBankTransfer: async function (ctx, command) {
            // CmdBankTransfer.cs: out of combat first, then one direction only - from the bank when
            // TransferFromBank, into it otherwise - with a 200ms wait for the bag to agree, and the
            // reference's own log line when neither side holds the name.
            const fromBank = command.TransferFromBank === true || command.TransferFromBank === 'true' ||
                command.TransferFromBank === 1;
            const itemName = resolved(ctx, command.ItemName);
            await leaveCombat('CmdBankTransfer', 2000);

            if (fromBank) {
                if (!(await access.bankItem(itemName).catch(function () { return null; }))) {
                    ctx.log('[Bank] ' + itemName + ' not found within your Bank');
                    return;
                }
                await access.transferToInventory(itemName);
                await access.waitUntil(function () { return access.inInventory(itemName); },
                    { interval: 200 });
                return;
            }

            if (!(await itemByName(access, itemName))) {
                ctx.log('[Bank] ' + itemName + ' not found within your Inventory');
                return;
            }
            await access.transferToBank(itemName);
            await access.waitUntil(function () {
                return access.inInventory(itemName).then(function (there) { return !there; });
            }, { interval: 200 });
        },

        CmdBankSwap: async function (ctx, command) {
            // CmdBankSwap.cs: the swap only runs when both names are held - bank item and bag item -
            // and then waits until the same test stops holding.
            const bankName = resolved(ctx, command.BankItemName);
            const invName = resolved(ctx, command.InventoryItemName);
            const held = function () {
                return Promise.all([
                    access.bankItem(bankName).catch(function () { return null; }),
                    access.inventoryItem(invName).catch(function () { return null; })
                ]).then(function (both) { return !!both[0] && !!both[1]; });
            };
            if (!(await held())) {
                ctx.log('[Bank] the swap needs both "' + invName + '" in the inventory and "' +
                    bankName + '" in the bank, and one of them is not there');
                return;
            }
            await access.bankSwap(invName, bankName);
            await access.waitUntil(function () { return held().then(function (both) { return !both; }); });
        },

        // ------------------------------------------------------------------ drops and map items

        CmdGetDrop: async function (ctx, command) {
            // CmdGetDrop.cs -> World.DropStack.GetDrop(name), then a 500ms wait. The frame is the
            // game's own, so the name is resolved against the drops the game has filed first.
            const itemName = resolved(ctx, command.ItemName);
            const itemId = await access.dropByName(itemName);
            // The room the frame names comes from the same loader name the reference's World.RoomId
            // reads, so nothing here spells a path the surface already answers.
            const room = await access.roomId();
            await access.send('toServer', '%xt%zm%getDrop%' + room + '%' + itemId + '%');
            await sleep(500);
        },

        CmdMapItem: async function (ctx, command) {
            // CmdMapItem.cs: the map-item lock, Player.GetMapItem(id), then 1500ms.
            await waitForLock({ action: 'getMapItem' });
            await readiness(ctx, access);
            await access.getMapItem(number(command.ItemId, 0));
            await sleep(1500);
        },

        CmdBuyBack: function (ctx, command) {
            // CmdBuyBack.cs drives AutoBuyBack over account.aq.com's own HTML pages - a login and a
            // page walk in the reference's Windows-only Buyback namespace. Spec #19 puts that path
            // out of scope ("the unreachable ... buy-back path"), and the reference corpus
            // references the command zero times. It is kept here so a file that carries one still
            // opens, saves and runs: the row exists, it is editable, and it reports the reason.
            ctx.log('CmdBuyBack: "' + resolved(ctx, command.ItemName) + '" asks for the reference\'s ' +
                'buy-back pages on account.aq.com, which spec #19 puts out of scope as unreachable ' +
                'upstream; the item has to be bought back in the game window');
        },

        CmdWhitelist: async function (ctx, command) {
            // CmdWhitelist.cs: On/Off/Toggle drive Configuration.EnablePickup and Add/Remove edit
            // Configuration.Drops - the State enum is zero-based in that order.
            const config = configOf(ctx, access);
            const itemName = resolved(ctx, command.ItemName);
            const state = number(command.state, 0);
            if (state === 0) setConfig(ctx, access, 'EnablePickup', true);
            else if (state === 1) setConfig(ctx, access, 'EnablePickup', false);
            else if (state === 2) setConfig(ctx, access, 'EnablePickup', !config.EnablePickup);
            else if (state === 3) {
                const held = dropsOf(config);
                if (!held.filter(function (name) { return lower(name) === lower(itemName); }).length) {
                    writeList(config, 'Drops', held.concat([itemName]));
                }
            } else if (state === 4) {
                writeList(config, 'Drops', dropsOf(config).filter(function (name) {
                    return lower(name) !== lower(itemName);
                }));
            }
        },

        // ------------------------------------------------------------------ quests

        CmdAcceptQuest: async function (ctx, command) {
            // CmdAcceptQuest.cs: load the quest when it is not loaded and wait for it, skip a
            // one-shot whose slot is already satisfied, ghost-accept when asked, otherwise up to
            // two Accept attempts with 600ms after each.
            const id = number(command.Quest && command.Quest.QuestID, 0);
            // HasQuest, not IsInProgress: the reference loads the quest to get its row into the
            // tree, and the wait is for the row to arrive. A quest already in progress but absent
            // from the tree would still be loaded.
            if (!(await access.hasQuest(id).catch(function () { return false; }))) {
                await access.loadQuest(id).catch(function (error) {
                    access.log('CmdAcceptQuest: loading quest ' + id + ' failed: ' + message(error));
                });
                await access.waitUntil(function () {
                    return access.hasQuest(id).catch(function () { return false; });
                }, { timeout: 3 });
            }

            const quest = await access.quest(id).catch(function () { return null; });
            if (!quest) {
                ctx.log('[Quest] Failed to accept, Quest not found/loaded');
                return;
            }

            const slot = Number(quest.iSlot === undefined ? quest.ISlot : quest.iSlot) || 0;
            const value = Number(quest.iValue === undefined ? quest.IValue : quest.iValue) || 0;
            const oneShot = truthy(quest.bOnce === undefined ? quest.IsNotRepeatable : quest.bOnce);
            if (slot !== 0 && oneShot) {
                const progress = await access.questProgress(slot).catch(function () { return 0; });
                if (value <= progress) {
                    ctx.log('[Quest] Skipping quest since requirement satisfied (' + id + ' - ' +
                        slot + ') : ' + progress + '/' + value);
                    return;
                }
            }

            if (command.ghostAccept === true) {
                await access.ghostAccept(id);
                await sleep(600);
                return;
            }

            for (let attempt = 0; attempt < ACCEPT_TRIES; attempt++) {
                if (await access.isInProgress(id)) return;
                if (typeof ctx.running === 'function' && !ctx.running()) return;
                await access.accept(id);
                await sleep(600);
            }
        },

        CmdCompleteQuest: async function (ctx, command) {
            // CmdCompleteQuest.cs: wait for the turn-in lock, hold provoke down across the turn-in,
            // step out of combat when the bot asks for it, then Quest.Complete with the count the
            // command carries - -1 or less meaning the maximum the game allows.
            const config = configOf(ctx, access);
            const id = number(command.Quest && command.Quest.QuestID, 0);
            const itemId = command.Quest && command.Quest.ItemId;
            await waitForLock({ action: 'tryQuestComplete' });

            const provoke = config.ProvokeMonsters;
            if (provoke) setConfig(ctx, access, 'ProvokeMonsters', false);
            try {
                if (config.ExitCombatBeforeQuest) {
                    // Player.refreshCell() rather than ExitCombat: the reference moves first and
                    // only then waits for the state to change, then delays its own 1000 ms.
                    await access.refreshCell().catch(function (error) {
                        access.log('CmdCompleteQuest: refreshing the cell failed: ' + message(error));
                    });
                    await access.waitUntil(function () {
                        return access.inCombat().then(function (fighting) { return !fighting; });
                    });
                    await sleep(1000);
                }

                const tries = number(command.CompleteTry, 1);
                const qty = tries <= -1 || command.SafeRelogin
                    ? await maximumTurnIns(access, id)
                    : tries;
                await access.complete(id, qty, itemId);
            } finally {
                if (provoke) setConfig(ctx, access, 'ProvokeMonsters', true);
            }

            if (command.ReAccept) {
                await access.waitUntil(function () {
                    return Promise.all([
                        access.isInProgress(id).catch(function () { return true; }),
                        access.canComplete(id).catch(function () { return true; })
                    ]).then(function (both) { return !both[0] && !both[1]; });
                }, { interval: 400, timeout: 5 });
                await access.ghostAccept(id);
                return;
            }
            const delay = Number(config.BotDelay) || 0;
            await sleep(delay <= 1000 ? 1100 - delay : 0);
        },

        CmdAddQuestList: async function (ctx, command) {
            // CmdAddQuestList.cs: ghost-accept the quest, then add it to Configuration.Quests when
            // the same id is not already there.
            const config = configOf(ctx, access);
            const id = number(command.Id, 0);
            await access.ghostAccept(id);
            const held = questsOf(config);
            if (!held.filter(function (row) { return questIdOf(row) === id; }).length) {
                writeList(config, 'Quests', held.concat([questRow(id, command.ItemId, command.SafeRelogin)]));
            }
        },

        CmdRemoveQuestList: async function (ctx, command) {
            // CmdRemoveQuestList.cs matches on all three fields, which is stricter than the guard
            // its Add twin uses - reproduced as written.
            const config = configOf(ctx, access);
            const id = number(command.Id, 0);
            const wanted = questRow(id, command.ItemId, command.SafeRelogin);
            writeList(config, 'Quests', questsOf(config).filter(function (row) {
                return !(questIdOf(row) === id &&
                    String(row && row.ItemId) === String(wanted.ItemId) &&
                    truthy(row && row.SafeRelogin) === truthy(wanted.SafeRelogin));
            }));
        }
    };
}


module.exports = {
    createAccess: createAccess,
    handlers: handlers,
    LOADER_BODIES: LOADER_BODIES,
    GAME_READS: GAME_READS,
    OWN_ROUTES: OWN_ROUTES,
    ERRORS: ERRORS,
    // The piece helpers, so a caller and a test can check each one on its own.
    asList: asList,
    byName: byName,
    qtyOf: qtyOf,
    categoryOf: categoryOf,
    isEquippable: isEquippable,
    questRow: questRow,
    questIdOf: questIdOf,
    drops: dropsOf,
    questList: questsOf,
    maximumShopBuys: maximumShopBuys,
    shopItemById: shopItemById,
    maximumTurnIns: maximumTurnIns,
    pickEquipTarget: pickEquipTarget,
    EQUIP_TRIES: EQUIP_TRIES,
    ACCEPT_TRIES: ACCEPT_TRIES,
    COMBAT_TRIES: COMBAT_TRIES
};
