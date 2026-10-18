// The statements that read game state (ticket #41): one handler per reference class under
// Grimoire/Botting/Commands/Misc/Statements/**, each class's own Execute body being the spec.
//
// The engine's contract is the reference's own: a statement that does not hold advances the index
// by one, which skips the single command under it (ctx.skipNext()). So a handler returns either
// nothing - the statement held - or a string, which is the reason it could not be told at all.
// A statement nobody could evaluate skips the command under it as well, and says why: the
// alternative is running a guarded command on a condition nobody answered, which is the one thing
// the ticket's fourth criterion rules out.
//
// Three things about these classes are easy to get wrong, and all three are reproduced:
//
//   * Direction. Several classes skip around a comparison that reads the other way from their own
//     row text - gold, level, monster HP, the player counts, the health pairs - so e.g.
//     CmdLevelGreaterThan holds at *or above* its value while CmdLevelLessThan holds strictly
//     below. Each handler's comment names the comparison its class actually writes.
//   * The item statements run a second, name-based branch after an id-based one, so an item field
//     holding a number falls through to a name that matches nothing. Reproduced, not tidied.
//   * Quantities are compared at the item's own stack, which is ClientConfig.AutoCorrect reading
//     the Bot Manager's "Auto Correct Quantity" tick; the reference ships that tick checked, and
//     it is the inventory and the temp inventory that apply it, never the bank or the house.
//
// Where the reference uses int.TryParse (the player and monster counts, the monster's health) a
// value it cannot parse leaves 0 and the comparison runs against that, so the statement holds.
// Where it uses int.Parse or a JSON field (the gold, level, mana and quest ids, the house quantity)
// an unparseable value is a throw upstream, and here it is the "cannot be evaluated" report.
//
// Every read goes through ctx.read, which is the session (bot/session.js) - the one place in this
// plugin that touches the game. Nothing here spells a game path out, and nothing invents a value.

const ERRORS = {
    /** The ticket's own criterion: a condition that cannot be evaluated reports that. */
    cannotTell: 'cannot be evaluated'
};

function message(error) {
    return (error && error.message) || String(error);
}

/** The reference's own EqualsIgnoreCase (Extensions.cs): ordinal, ignoring case. */
function sameText(a, b) {
    return String(a === null || a === undefined ? '' : a).trim().toLowerCase() ===
        String(b === null || b === undefined ? '' : b).trim().toLowerCase();
}

/** A value the reference hands to int.Parse: digits, or nothing at all. */
function integer(value) {
    const raw = String(value === null || value === undefined ? '' : value).trim();
    if (!/^-?\d+$/.test(raw)) return null;
    return parseInt(raw, 10);
}

/** The reference's own bool-as-0/1 item fields (the InventoryItem BoolConverter). */
function flag(value) {
    return value === 1 || value === true || value === '1' || value === 'true';
}

/** The item in a list whose sName matches, or null: the loader's GetItemByName, in one place. */
function byName(list, name) {
    const entries = Array.isArray(list) ? list : [];
    for (let i = 0; i < entries.length; i++) {
        if (entries[i] && sameText(entries[i].sName, name)) return entries[i];
    }
    return null;
}

function byId(list, id) {
    const entries = Array.isArray(list) ? list : [];
    for (let i = 0; i < entries.length; i++) {
        if (entries[i] && Number(entries[i].ItemID) === id) return entries[i];
    }
    return null;
}

/** The entry's own fields (ItemBase.cs): iQty is the stack it holds, iStk the stack it can hold. */
function quantity(item) {
    const qty = Number(item && item.iQty);
    return isFinite(qty) ? qty : 0;
}

function stack(item) {
    const size = Number(item && item.iStk);
    return isFinite(size) ? size : 0;
}

/**
 * Inventory.ContainsItem(name, quantity): a quantity above the item's own stack is compared at the
 * stack, and a Class is the one category that is never clamped. A quantity the reference cannot
 * parse is int.TryParse's false, which answers a bare yes on any hit - which is also why "*" is not
 * a special case anywhere except the bank's and the house's own checks.
 */
function inventoryContains(list, name, quantityText, exemptCategory) {
    const item = byName(list, name);
    if (!item) return false;
    const wanted = integer(quantityText);
    if (wanted === null) return true;
    const clamped = exemptCategory && sameText(item.sType, exemptCategory)
        ? wanted
        : Math.min(wanted, stack(item));
    return quantity(item) >= clamped;
}

/** Inventory.ContainsItem(id, quantity): the same clamp, by ItemID. */
function inventoryContainsById(list, id, wanted) {
    const item = byId(list, id);
    if (!item) return false;
    return quantity(item) >= Math.min(wanted, stack(item));
}

/** Bank.ContainsItem(id, quantity): by ItemID, unclamped, which is what the bank's own check is. */
function bankContainsById(list, id, wanted) {
    const item = byId(list, id);
    if (!item) return false;
    return quantity(item) >= wanted;
}

/** Inventory.ContainsMaxItem(name): carried, and at its own stack. */
function inventoryMaxed(list, name) {
    const item = byName(list, name);
    if (!item) return false;
    return quantity(item) >= stack(item);
}

/** Bank.ContainsItem(name, quantity): "*" or an unparseable quantity is any (Int32.TryParse). */
function bankContains(list, name, quantityText) {
    const item = byName(list, name);
    if (!item) return false;
    const wanted = integer(quantityText);
    if (wanted === null) return true;
    return quantity(item) >= wanted;
}

/**
 * House.ContainsItem(name, quantity): "*" is any, and anything else is int.Parse, which is a throw
 * for a quantity that is not a number. Here it is the report the caller returns.
 * @returns {boolean|null} null when the quantity cannot be parsed at all
 */
function houseContains(list, name, quantityText) {
    const item = byName(list, name);
    if (!item) return false;
    const raw = String(quantityText === null || quantityText === undefined ? '' : quantityText).trim();
    if (raw === '*') return true;
    const wanted = integer(raw);
    if (wanted === null) return null;
    return quantity(item) >= wanted;
}

/** Faction.Rank for the named faction, or 0 - the reference's own "?? new Faction()". */
function factionRank(factions, name) {
    // The game keys myAvatar.factions by faction id, so the loader's own JSON is an object rather
    // than a list; a helper that has already reshaped it to a list is the other shape answers come
    // in. Both are the same entries, so both are searched.
    const entries = Array.isArray(factions) ? factions
        : (factions && typeof factions === 'object' ? Object.keys(factions).map(function (key) {
            return factions[key];
        }) : []);
    for (let i = 0; i < entries.length; i++) {
        if (entries[i] && sameText(entries[i].sName, name)) return Number(entries[i].iRank) || 0;
    }
    return 0;
}

/** World.IsMonsterAvailable's own prefix switch: id'12, id.12, id:12 and id-12 all ask by id. */
function monsterIdOf(name) {
    const match = /^id['.:-](.*)$/.exec(String(name === null || name === undefined ? '' : name));
    return match ? match[1] : null;
}

/** CmdMapIs's own "yulgar-1" handling: what is before the first hyphen. */
function mapNameOf(value) {
    const text = String(value === null || value === undefined ? '' : value);
    return text.indexOf('-') !== -1 ? text.split('-')[0] : text;
}

function cannotTell(className, detail) {
    return ERRORS.cannotTell + ': ' + className + ' ' + detail;
}

/**
 * A statement that could not be evaluated at all. It skips the command under it, the same as a
 * statement that did not hold, because the alternative is running that command on a condition
 * nobody answered - and it returns the reason, which is what the engine logs.
 */
function report(ctx, className, detail) {
    ctx.skipNext();
    return cannotTell(className, detail);
}

function refused(ctx, className, readName, error) {
    return report(ctx, className, 'read "' + readName + '" and the game did not answer it: ' +
        message(error));
}

/**
 * The shape almost every statement here has: read one value, decide, and skip the command under
 * the statement when the answer is no. `holds` answers true when the statement holds, or returns
 * a string when the read answered but the comparison has nothing to work with.
 *
 * @param {string} className the class the report names
 * @param {string} readName  the session read it needs
 * @param {Function} holds   (value, ctx, command) => boolean | string
 * @param {Function} [argsOf] (ctx, command) => {args} | {error} for a read that takes arguments
 */
function compared(className, readName, holds, argsOf) {
    return async function (ctx, command) {
        let args;
        if (argsOf) {
            const asked = argsOf(ctx, command);
            if (asked && asked.error) return report(ctx, className, asked.error);
            args = asked && asked.args;
        }
        const answer = await ctx.read(readName, args);
        if (!answer.ok) return refused(ctx, className, readName, answer.error);
        const outcome = holds(answer.value, ctx, command);
        if (typeof outcome === 'string') return report(ctx, className, outcome);
        if (outcome !== true) ctx.skipNext();
        return undefined;
    };
}

/** A quest id as the loader's own classes take it: int.Parse, passed on as text. */
function questArgs(ctx, command) {
    const raw = ctx.resolve(command.Value1);
    const id = integer(raw);
    if (id === null) return { error: 'has no quest id to ask about (' + JSON.stringify(raw) + ')' };
    return { args: [String(id)] };
}

/**
 * CmdHealthGreaterThan and CmdHealthLessThan. Both branches - the percentage one and the absolute
 * one - hold the same way round, which is why they are one factory: the percent the reference
 * compares is its own "(hp * 100) / HealthMax" in *integers*, so 1 of 3 HP is 33% and not 33.33 or
 * 34. A health maximum of 0 is a divide by zero upstream, which here is a report: a statement that
 * throws mid-run is worse than one that says it could not tell.
 */
function healthStatement(className, holds) {
    return async function (ctx, command) {
        const raw = ctx.resolve(command.Value1);
        const asPercent = /%$/.test(String(raw).trim());
        const target = integer(asPercent ? String(raw).trim().slice(0, -1) : raw);
        if (target === null) {
            return report(ctx, className, 'has no health to compare (' + JSON.stringify(raw) + ')');
        }
        const health = await ctx.read('health');
        if (!health.ok) return refused(ctx, className, 'health', health.error);
        if (!asPercent) {
            if (holds(Number(health.value), target) !== true) ctx.skipNext();
            return undefined;
        }
        const healthMax = await ctx.read('healthMax');
        if (!healthMax.ok) return refused(ctx, className, 'healthMax', healthMax.error);
        const max = Number(healthMax.value);
        if (!max) {
            return report(ctx, className, 'is a percentage and the game answered a health maximum of ' +
                JSON.stringify(healthMax.value) + ', so there is no percentage to compare');
        }
        const current = Math.trunc((Number(health.value) * 100) / max);
        if (holds(current, target) !== true) ctx.skipNext();
        return undefined;
    };
}

/** CmdPlayersHPGreaterThan and its less-than twin: the loader's own percentage for a name. */
function playerHealthStatement(className, holds) {
    return function (ctx, command) {
        const name = ctx.resolve(command.Value1);
        const target = integer(ctx.resolve(command.Value2));
        if (target === null) {
            return Promise.resolve(report(ctx, className, 'has no percentage to compare (' +
                JSON.stringify(ctx.resolve(command.Value2)) + ')'));
        }
        return compared(className, 'playerHealthPercentage', function (percent) {
            return holds(Number(percent), target);
        }, function () { return { args: [name] }; })(ctx, command);
    };
}

/** CmdPlayerIsInCell / CmdPlayerIsNotInCell: the loader's CheckCellPlayer(name, cell). */
function playerCellStatement(className, holds) {
    return compared(className, 'playerInCell', function (answer) {
        return holds(answer === true);
    }, function (ctx, command) {
        const name = ctx.resolve(command.Value1);
        const cell = ctx.resolve(command.Value2);
        if (String(cell).trim() === '') {
            return { error: 'has no cell to look for ' + JSON.stringify(name) + ' in' };
        }
        return { args: [name, cell] };
    });
}

/** CmdPlayerInMyCellGreaterThan / LessThan: a count of the room, asked one player at a time. */
function playersInMyCellStatement(className, holds) {
    return async function (ctx, command) {
        const target = integer(ctx.resolve(command.Value1));
        if (target === null) {
            return report(ctx, className, 'has no count to compare (' +
                JSON.stringify(ctx.resolve(command.Value1)) + ')');
        }
        // The reference reads Player.Cell for every player it asks about, so it is read once here.
        const cell = await ctx.read('cell');
        if (!cell.ok) return refused(ctx, className, 'cell', cell.error);
        const players = await ctx.read('playersInMap');
        if (!players.ok) return refused(ctx, className, 'playersInMap', players.error);
        const names = Array.isArray(players.value) ? players.value : [];
        let count = 0;
        for (let i = 0; i < names.length; i++) {
            const answer = await ctx.read('playerInCell', [String(names[i]), String(cell.value)]);
            if (!answer.ok) return refused(ctx, className, 'playerInCell', answer.error);
            if (answer.value === true) count++;
        }
        if (holds(count, target) !== true) ctx.skipNext();
        return undefined;
    };
}

/** CmdMonsterInRoom / CmdMonsterNotInRoom, with the reference's own id routing. */
function monsterInRoomStatement(className, holds) {
    return async function (ctx, command) {
        const name = ctx.resolve(command.Value1);
        const id = monsterIdOf(name);
        const readName = id === null ? 'monsterInRoom' : 'monsterByMonMapId';
        const answer = await ctx.read(readName, id === null ? undefined : [id]);
        if (!answer.ok) return refused(ctx, className, readName, answer.error);
        if (holds(answer.value === true) !== true) ctx.skipNext();
        return undefined;
    };
}

/**
 * The item statements: a read of one list, then the reference's own check on it. The check is
 * handed the resolved name and quantity, and the engine's own ctx after them, so a check that
 * cannot work with the quantity can report that rather than compare against a stand-in.
 */
function itemStatement(className, readName, holds) {
    return compared(className, readName, function (list, ctx, command) {
        return holds(list, ctx.resolve(command.Value1), ctx.resolve(command.Value2), ctx);
    });
}

const HANDLERS = {
    // ------------------------------------------------------------------ cell and map
    // CmdCellIs skips when the value does not equal Player.Cell ignoring case, so it holds on a
    // match; CmdCellIsNot is its mirror.
    CmdCellIs: compared('CmdCellIs', 'cell', function (cell, ctx, command) {
        return sameText(ctx.resolve(command.Value1), cell);
    }),
    CmdCellIsNot: compared('CmdCellIsNot', 'cell', function (cell, ctx, command) {
        return !sameText(ctx.resolve(command.Value1), cell);
    }),
    // CmdMapIs compares "what is before the first hyphen" against Player.Map, which is what a bot
    // written as "yulgar-1" is asking about.
    CmdMapIs: compared('CmdMapIs', 'map', function (map, ctx, command) {
        return sameText(mapNameOf(ctx.resolve(command.Value1)), map);
    }),
    CmdMapIsNot: compared('CmdMapIsNot', 'map', function (map, ctx, command) {
        return !sameText(mapNameOf(ctx.resolve(command.Value1)), map);
    }),

    // ------------------------------------------------------------------ items
    // CmdEquipped: the carried item's own bEquip flag, and an item that is not carried is not
    // equipped. CmdNotEquipped is its mirror.
    CmdEquipped: itemStatement('CmdEquipped', 'inventory', function (list, name) {
        return flag((byName(list, name) || {}).bEquip);
    }),
    CmdNotEquipped: itemStatement('CmdNotEquipped', 'inventory', function (list, name) {
        return !flag((byName(list, name) || {}).bEquip);
    }),

    // CmdItemPickupable: World.DropStack.Contains(name), which matches an entry's own Name ignoring
    // case. The list is the reference's own and refuses until #33 gives it a source.
    CmdItemPickupable: itemStatement('CmdItemPickupable', 'dropStack', function (list, name) {
        return byName(list, name) !== null;
    }),
    CmdItemNotPickupable: itemStatement('CmdItemNotPickupable', 'dropStack', function (list, name) {
        return byName(list, name) === null;
    }),

    // CmdInInventory's own two branches: when both fields parse as ints it checks by ItemID, and
    // then - whichever way that went - checks by name as well, where a numeric name matches
    // nothing. So an item field holding a number never reads as a hit. Reproduced as written.
    CmdInInventory: itemStatement('CmdInInventory', 'inventory', function (list, name, qty) {
        const id = integer(name);
        const wanted = integer(qty);
        if (id !== null && wanted !== null && !inventoryContainsById(list, id, wanted)) return false;
        return inventoryContains(list, name, qty, 'Class');
    }),
    // CmdNotInInventory: the same two branches, skipping on either hit.
    CmdNotInInventory: itemStatement('CmdNotInInventory', 'inventory', function (list, name, qty) {
        const id = integer(name);
        const wanted = integer(qty);
        if (id !== null && wanted !== null && inventoryContainsById(list, id, wanted)) return false;
        return !inventoryContains(list, name, qty, 'Class');
    }),

    // CmdInTemp: the temp inventory's own check, which clamps at the stack for every category.
    CmdInTemp: itemStatement('CmdInTemp', 'tempInventory', function (list, name, qty) {
        return inventoryContains(list, name, qty, null);
    }),
    CmdNotInTemp: itemStatement('CmdNotInTemp', 'tempInventory', function (list, name, qty) {
        return !inventoryContains(list, name, qty, null);
    }),

    CmdInBank: itemStatement('CmdInBank', 'bank', function (list, name, qty) {
        return bankContains(list, name, qty);
    }),
    CmdNotInBank: itemStatement('CmdNotInBank', 'bank', function (list, name, qty) {
        return !bankContains(list, name, qty);
    }),

    // CmdInBankOrInvent holds in either list; CmdNotInBankAndInvent only when both say no.
    CmdInBankOrInvent: async function (ctx, command) {
        const name = ctx.resolve(command.Value1);
        const qty = ctx.resolve(command.Value2);
        const id = integer(name);
        const wanted = integer(qty);
        const bank = await ctx.read('bank');
        if (!bank.ok) return refused(ctx, 'CmdInBankOrInvent', 'bank', bank.error);
        const inventory = await ctx.read('inventory');
        if (!inventory.ok) return refused(ctx, 'CmdInBankOrInvent', 'inventory', inventory.error);
        const byNumber = id !== null && wanted !== null;
        const inBank = byNumber
            ? bankContainsById(bank.value, id, wanted)
            : bankContains(bank.value, name, qty);
        const inInventory = byNumber
            ? inventoryContainsById(inventory.value, id, wanted)
            : inventoryContains(inventory.value, name, qty, 'Class');
        if (!(inBank || inInventory)) ctx.skipNext();
        return undefined;
    },
    CmdNotInBankAndInvent: async function (ctx, command) {
        const name = ctx.resolve(command.Value1);
        const qty = ctx.resolve(command.Value2);
        const id = integer(name);
        const wanted = integer(qty);
        const bank = await ctx.read('bank');
        if (!bank.ok) return refused(ctx, 'CmdNotInBankAndInvent', 'bank', bank.error);
        const inventory = await ctx.read('inventory');
        if (!inventory.ok) return refused(ctx, 'CmdNotInBankAndInvent', 'inventory', inventory.error);
        const byNumber = id !== null && wanted !== null;
        const inBank = byNumber
            ? bankContainsById(bank.value, id, wanted)
            : bankContains(bank.value, name, qty);
        const inInventory = byNumber
            ? inventoryContainsById(inventory.value, id, wanted)
            : inventoryContains(inventory.value, name, qty, 'Class');
        if (inBank || inInventory) ctx.skipNext();
        return undefined;
    },

    CmdIsMaxStack: itemStatement('CmdIsMaxStack', 'inventory', function (list, name) {
        return inventoryMaxed(list, name);
    }),
    CmdIsNotMaxStack: itemStatement('CmdIsNotMaxStack', 'inventory', function (list, name) {
        return !inventoryMaxed(list, name);
    }),

    // CmdListInInv reads Configuration.Instance.Items - the bot's own Items list, which the
    // reference's Bot Manager fills from its form - and asks the inventory for each entry with a
    // quantity of "1". TrueForAll over an empty list is true, so an empty list holds.
    CmdListInInv: async function (ctx, command) {
        const answer = await ctx.read('inventory');
        if (!answer.ok) return refused(ctx, 'CmdListInInv', 'inventory', answer.error);
        const items = (ctx.config() && ctx.config().Items) || [];
        const list = Array.isArray(items) ? items : [];
        const all = list.every(function (name) {
            return inventoryContains(answer.value, name, '1', 'Class');
        });
        if (all !== true) ctx.skipNext();
        return undefined;
    },

    // ------------------------------------------------------------------ quests
    CmdQuestAvailable: compared('CmdQuestAvailable', 'questAvailable', function (available) {
        return available === true;
    }, questArgs),
    CmdQuestNotAvailable: compared('CmdQuestNotAvailable', 'questAvailable', function (available) {
        return available !== true;
    }, questArgs),
    CmdQuestInProgress: compared('CmdQuestInProgress', 'questInProgress', function (progress) {
        return progress === true;
    }, questArgs),
    CmdQuestNotInProgress: compared('CmdQuestNotInProgress', 'questInProgress', function (progress) {
        return progress !== true;
    }, questArgs),
    // "can be turned in" is the loader's CanComplete, which the surface refuses until #39 lands.
    // Asked for by name anyway, so the day it lands the statement works with no change here.
    CmdQuestCompleted: compared('CmdQuestCompleted', 'questCanComplete', function (complete) {
        return complete === true;
    }, questArgs),
    CmdQuestNotCompleted: compared('CmdQuestNotCompleted', 'questCanComplete', function (complete) {
        return complete !== true;
    }, questArgs),

    // ------------------------------------------------------------------ gold, level, mana
    // CmdGoldGreaterThan skips on "Gold <= value", so it holds strictly above; CmdGoldLessThan
    // skips on "Gold >= value" and holds strictly below.
    CmdGoldGreaterThan: compared('CmdGoldGreaterThan', 'gold', function (gold, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return Number(gold) > want;
    }),
    CmdGoldLessThan: compared('CmdGoldLessThan', 'gold', function (gold, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return Number(gold) < want;
    }),

    CmdLevelIs: compared('CmdLevelIs', 'level', function (level, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return Number(level) === want;
    }),
    // CmdLevelGreaterThan skips on "Level < value", so it holds at or above the value.
    CmdLevelGreaterThan: compared('CmdLevelGreaterThan', 'level', function (level, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return Number(level) >= want;
    }),
    // CmdLevelLessThan skips on "Level >= value", so it holds strictly below.
    CmdLevelLessThan: compared('CmdLevelLessThan', 'level', function (level, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return Number(level) < want;
    }),

    // CmdManaGreaterThan skips on "Mana <= value" and CmdManaLessThan on "Mana >= value".
    CmdManaGreaterThan: compared('CmdManaGreaterThan', 'mana', function (mana, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return Number(mana) > want;
    }),
    CmdManaLessThan: compared('CmdManaLessThan', 'mana', function (mana, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return Number(mana) < want;
    }),

    // ------------------------------------------------------------------ health
    // CmdHealthGreaterThan holds strictly above; CmdHealthLessThan holds at or below ("skips when
    // hp > value"). Both compare a bare number as HP and a "%"-suffixed one as the truncated
    // percentage of HealthMax.
    CmdHealthGreaterThan: healthStatement('CmdHealthGreaterThan', function (value, target) {
        return value > target;
    }),
    CmdHealthLessThan: healthStatement('CmdHealthLessThan', function (value, target) {
        return value <= target;
    }),

    // The player rows: the loader's own percentage for a name, compared strictly in each direction.
    CmdPlayersHPGreaterThan: playerHealthStatement('CmdPlayersHPGreaterThan', function (percent, target) {
        return percent > target;
    }),
    CmdPlayersHPLessThan: playerHealthStatement('CmdPlayersHPLessThan', function (percent, target) {
        return percent < target;
    }),

    // ------------------------------------------------------------------ membership, faction, house
    CmdIsMember: compared('CmdIsMember', 'isMember', function (member) {
        return member === true;
    }),
    CmdIsNotMember: compared('CmdIsNotMember', 'isMember', function (member) {
        return member !== true;
    }),

    // CmdFactionRankGreaterThan skips on "rank < target" and holds at or above it; the less-than
    // twin skips on "rank >= target" and holds strictly below.
    CmdFactionRankGreaterThan: compared('CmdFactionRankGreaterThan', 'factions', function (factions, ctx, command) {
        const want = integer(ctx.resolve(command.Value2));
        if (want === null) return unreadable(command.Value2);
        return factionRank(factions, ctx.resolve(command.Value1)) >= want;
    }),
    CmdFactionRankLessThan: compared('CmdFactionRankLessThan', 'factions', function (factions, ctx, command) {
        const want = integer(ctx.resolve(command.Value2));
        if (want === null) return unreadable(command.Value2);
        return factionRank(factions, ctx.resolve(command.Value1)) < want;
    }),

    CmdInHouse: itemStatement('CmdInHouse', 'house', function (list, name, qty, ctx) {
        const contains = houseContains(list, name, qty);
        if (contains === null) return unreadable(qty);
        return contains;
    }),
    CmdNotInHouse: itemStatement('CmdNotInHouse', 'house', function (list, name, qty, ctx) {
        const contains = houseContains(list, name, qty);
        if (contains === null) return unreadable(qty);
        return contains === false;
    }),

    // ------------------------------------------------------------------ players
    // CmdPlayerInRoom searches the names the game lists for the map; the not-in-room twin skips on
    // a hit.
    CmdPlayerInRoom: compared('CmdPlayerInRoom', 'playersInMap', function (players, ctx, command) {
        const name = ctx.resolve(command.Value1);
        return (Array.isArray(players) ? players : []).some(function (entry) {
            return sameText(entry, name);
        });
    }),
    CmdPlayerNotInRoom: compared('CmdPlayerNotInRoom', 'playersInMap', function (players, ctx, command) {
        const name = ctx.resolve(command.Value1);
        return !(Array.isArray(players) ? players : []).some(function (entry) {
            return sameText(entry, name);
        });
    }),

    CmdPlayerIsInCell: playerCellStatement('CmdPlayerIsInCell', function (inCell) { return inCell; }),
    CmdPlayerIsNotInCell: playerCellStatement('CmdPlayerIsNotInCell', function (inCell) { return !inCell; }),
    CmdPlayerIsInMyCell: compared('CmdPlayerIsInMyCell', 'playerInMyCell', function (inCell) {
        return inCell === true;
    }, function (ctx, command) { return { args: [ctx.resolve(command.Value1)] }; }),
    CmdPlayerIsNotInMyCell: compared('CmdPlayerIsNotInMyCell', 'playerInMyCell', function (inCell) {
        return inCell !== true;
    }, function (ctx, command) { return { args: [ctx.resolve(command.Value1)] }; }),

    // CmdPlayersGreaterThan skips on "Count <= value" and holds strictly above; the less-than twin
    // skips on "Count >= value" and holds strictly below. Both guard on int.TryParse, so a value
    // that is not a number never skips - the statement holds, which is the reference's own answer.
    CmdPlayersGreaterThan: compared('CmdPlayersGreaterThan', 'playersInMap', function (players, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        const count = (Array.isArray(players) ? players : []).length;
        return want === null || count > want;
    }),
    CmdPlayersLessThan: compared('CmdPlayersLessThan', 'playersInMap', function (players, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        const count = (Array.isArray(players) ? players : []).length;
        return want === null || count < want;
    }),

    // The count of the room that stands in the cell I am in. The reference asks CheckCellPlayer
    // once per player in World.PlayersInMap, against its own Player.Cell.
    CmdPlayerInMyCellGreaterThan: playersInMyCellStatement('CmdPlayerInMyCellGreaterThan',
        function (count, target) { return count > target; }),
    CmdPlayerInMyCellLessThan: playersInMyCellStatement('CmdPlayerInMyCellLessThan',
        function (count, target) { return count < target; }),

    // CmdNameEquals compares against Player.Username, which the loader holds; the session reads the
    // game's own field for it (session.js).
    CmdNameEquals: compared('CmdNameEquals', 'username', function (name, ctx, command) {
        return sameText(ctx.resolve(command.Value1), name);
    }),

    // ------------------------------------------------------------------ monsters
    // IsMonsterAvailable, GetMonsterHealth and GetVisibleMonstersInCell are composed from live
    // monster objects, which the surface refuses until #38 lands. Asked for by name anyway, so the
    // day it lands these work with no change here; until then the refusal is the report.
    CmdMonsterInRoom: monsterInRoomStatement('CmdMonsterInRoom', function (available) { return available; }),
    CmdMonsterNotInRoom: monsterInRoomStatement('CmdMonsterNotInRoom', function (available) { return !available; }),

    // CmdMonsterHealthGreaterThan skips on "health < value" and holds at or above it; the less-than
    // twin skips on "health > value" and holds at or below. Both read the value through
    // int.TryParse, so one that is not a number leaves 0 and the comparison runs against that.
    CmdMonsterHealthGreaterThan: compared('CmdMonsterHealthGreaterThan', 'monsterHealth', function (health, ctx, command) {
        return Number(health) >= (integer(ctx.resolve(command.Value2)) || 0);
    }, function (ctx, command) {
        return { args: [ctx.resolve(command.Value1)] };
    }),
    CmdMonsterHealthLessThan: compared('CmdMonsterHealthLessThan', 'monsterHealth', function (health, ctx, command) {
        return Number(health) <= (integer(ctx.resolve(command.Value2)) || 0);
    }, function (ctx, command) {
        return { args: [ctx.resolve(command.Value1)] };
    }),

    // CmdMonstersGreaterThan skips on "Count <= value" and holds strictly above; the less-than twin
    // skips on "Count >= value" and holds strictly below. Both use int.Parse, so a value that is not
    // a number is a report here rather than a comparison against a stand-in.
    CmdMonstersGreaterThan: compared('CmdMonstersGreaterThan', 'visibleMonsters', function (monsters, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return (Array.isArray(monsters) ? monsters : []).length > want;
    }),
    CmdMonstersLessThan: compared('CmdMonstersLessThan', 'visibleMonsters', function (monsters, ctx, command) {
        const want = integer(ctx.resolve(command.Value1));
        if (want === null) return unreadable(command.Value1);
        return (Array.isArray(monsters) ? monsters : []).length < want;
    })
};

/** The detail a comparison with no number to compare reports; the caller adds the class name. */
function unreadable(value) {
    return 'has no number to compare (' + JSON.stringify(String(value)) + ')';
}

module.exports = {
    ERRORS: ERRORS,
    HANDLERS: HANDLERS,
    // The helpers, for the tests that check a comparison without an engine in the way.
    sameText: sameText,
    integer: integer,
    mapNameOf: mapNameOf,
    monsterIdOf: monsterIdOf
};
