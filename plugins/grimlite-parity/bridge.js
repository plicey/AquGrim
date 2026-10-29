// The one place in this plugin that asks the game for something (spec #19, Seam 4). Every
// feature consumes an object of this shape and never reaches Flash, the Host or the SWF itself;
// under test, a plain object of the same shape satisfies it.
//
// It sits on ticket #28's bridge channel (`host.bridge.attach()` / `call(name, args)`), which is
// the *generic* layer: getGameObject, getGameObjectS, setGameObject, callGameFunction,
// callGameFunction0, isNull, sendClientPacket, pollEvents (see the bridge's manifest
// bridgeCallbacks). A feature wants "the inventory" or "equip this item", not a dot-path, so this
// module is where those wants become the game's own call names.
//
// Which names can answer is evidence, not guesswork. The reference calls a loader it ships
// (`Loader/grimoire.swf`), and 100 of the 146 names it uses exist only in that loader, not in the
// game (docs/research/grimlite-capabilities.md section 3). The bridge loads the *stock* game, so a
// loader-only name is one the game answers `no member ... at world` to until the bridge grows that
// surface itself.
//
// Which of this module's names are loader-only was then checked against the decompressed game SWF
// rather than taken from that count, and the check is stricter than a substring search: a name is
// callable only when it is an exact ABC string-pool entry *and* some multiname references it (a
// pool entry nothing references is a literal - a label, an id, a path - not a member anyone can
// call). By that test the game has none of GetInventoryItems, TransferToBank, TransferToInventory,
// UsedBankSlots, BankSlots or Equip: BankSlots appears only inside longer literals like
// `txtBankSlots` and `iMaxBankSlots`, and Equip is a pool entry with zero multiname references.
// The game's own bank machinery is differently named and reachable only as paths and packets
// (bankFromInv / bankToInv / sendBankFromInvRequest and world.bank.items), which is a design for
// the bridge ticket rather than something to guess at here.
//
// So every call goes through and reports what actually happened; nothing here invents a result,
// and a name the game cannot answer is annotated with what that means rather than left as a bare
// failure. That also keeps this adapter forward-compatible: the day the bridge implements the
// loader's surface, these calls start working with no change here.

const UNCHANNELLED = 'this app has no game bridge channel';

// The reference loader's typed surface (ticket #48): one row per helper name it registers, each
// row reaching the game paths that helper's own body reads. Built on top of the generic channel
// this module already drives, so no feature needs to know how a name maps to a path.
const loaderSurface = require('./loader-surface.js');

// The reference loader's own call names this module uses. Kept as data so the failure a user
// sees can explain itself, and so the list of what the bridge still owes is in one place.
//
// Only the names this module actually calls: a name nothing here calls would make the list claim
// more than the code does. The reference's own bank surface carries more loader-only names than
// these - GetBankItems, TransferToInventory, BankSwap, GetBankItemByName, IsActionAvailable and
// InventorySlots among them - but its BankForm reaches none of them: it reads only the inventory
// and gates Bank All on AvailableSlots (= BankSlots - UsedBankSlots). Those names belong to the
// follow-up bridge ticket, and the ticket #29 section of docs/FLASH_CHECKLIST.md lists them for it.
const LOADER_ONLY = {
    BankSlots: true,
    Equip: true,
    GetInventoryItems: true,
    TransferToBank: true,
    UsedBankSlots: true
};

const ERRORS = {
    unchannelled: UNCHANNELLED,
    /** A call the reference's own loader provides and the stock game does not. */
    loaderSurface: function (name) {
        return '"' + name + '" belongs to the reference client\'s own loader, not to the game, ' +
            'and the bridge does not implement that surface yet (see docs/FLASH_CHECKLIST.md)';
    }
};

/** The bridge callback for a game function: the loader keeps the zero-argument call separate. */
function callFor(args) {
    return args.length ? 'callGameFunction' : 'callGameFunction0';
}

/**
 * A bridge callback answers a JSON string (the SWF serialises with JSON.stringify, and answers
 * {"error": ...} for a call it cannot make). Parse it, and raise the game's own message when
 * that is what came back.
 */
function decode(answer) {
    if (typeof answer !== 'string' || answer === '') return null;
    let value;
    try {
        value = JSON.parse(answer);
    } catch (error) {
        // A value JSON cannot express is handed over already stringified; take it as it is.
        return answer;
    }
    if (value && typeof value === 'object' && typeof value.error === 'string') {
        throw new Error(value.error);
    }
    return value;
}

/**
 * The game's own "no member X at world" means X is not part of its surface. Name the reason
 * when the name is one the reference loader would have provided, keeping the game's own words:
 * they are the evidence, and the reason is what makes them actionable.
 */
function explain(name, error) {
    const message = (error && error.message) || String(error);
    // The bridge's own words for a name the game does not carry: `no member <name> at <path>`.
    if (LOADER_ONLY[name] && message.indexOf('no member ' + name) === 0) {
        return new Error(message + ' - ' + ERRORS.loaderSurface(name));
    }
    return new Error(message);
}

/** The two booleans an InventoryItem carries as 0/1 (the reference's own BoolConverter). */
function flag(value) {
    return value === 1 || value === true || value === '1' || value === 'true';
}

/** InventoryItem JSON -> the shape the features' logic is written against. */
function inventoryItem(raw) {
    return {
        id: Number(raw.ItemID),
        name: String(raw.sName || ''),
        category: String(raw.sType || ''),
        isAcItem: flag(raw.bCoins),
        isEquipped: flag(raw.bEquip)
    };
}

function asNumber(value) {
    const number = Number(value);
    return isFinite(number) ? number : 0;
}

/**
 * The game access the features consume.
 *
 * @param {object} host the plugin Host; `host.bridge` is the platform's channel
 */
function createGameAccess(host) {
    const log = (host && typeof host.log === 'function')
        ? function (msg) { host.log(msg); }
        : function () {};
    const channel = host && host.bridge;
    let attached = false;

    /** Attach once, and retry after a failure: the game window may open later, or reopen. */
    function ensure() {
        if (!channel || typeof channel.call !== 'function') {
            return Promise.reject(new Error(UNCHANNELLED));
        }
        if (attached) return Promise.resolve();
        if (typeof channel.attach !== 'function') {
            attached = true;
            return Promise.resolve();
        }
        return Promise.resolve(channel.attach()).then(function (result) {
            if (!result || !result.ok) {
                throw new Error((result && result.error) || 'the game bridge did not attach');
            }
            attached = true;
        });
    }

    /** Call one game function through the channel and hand back what the game answered. */
    function call(name, args) {
        return ensure().then(function () {
            return channel.call(callFor(args), [name].concat(args));
        }).then(function (result) {
            if (!result || !result.ok) {
                throw explain(name, (result && result.error) || 'the bridge could not call ' + name);
            }
            try {
                return decode(result.value);
            } catch (error) {
                throw explain(name, error);
            }
        }, function (error) {
            throw explain(name, error);
        });
    }

    /**
     * The loader surface (ticket #48), bound to the raw channel rather than to `call` above:
     * that one takes a game path and picks the callback for it, while the surface is handed the
     * callback it wants directly, because a helper's body decides which one it needs.
     */
    function surface() {
        return loaderSurface.createLoaderSurface(function (callback, callArgs) {
            return ensure().then(function () {
                return channel.call(callback, callArgs);
            }).then(function (result) {
                if (!result || !result.ok) {
                    throw new Error((result && result.error) || ('the bridge could not ' + callback));
                }
                return decode(result.value);
            });
        }, log);
    }

    return {
        /**
         * Call one of the reference loader's own helper names (ticket #48). This is the door for
         * a name the game does not carry: the surface knows the path that name's loader body
         * reads, so `GetBankItems` or `UsedBankSlots` answer where the game alone would refuse.
         *
         * @param {string} name the reference's own helper name
         * @param {Array} [args]
         * @returns {Promise<any>} what the game answered, or a rejection naming the reason
         */
        loaderCall: function (name, args) {
            return surface().call(name, args);
        },

        /** The loader surface itself, for a caller that wants to list or probe names. */
        loaderSurface: surface,

        /**
         * The two doors the bot's item and quest commands (ticket #39) reach the game through: the
         * reference loader's own names, and the generic callbacks by callback name. It is the same
         * pair this module already drives - the loader surface for the first, the raw channel for
         * the second - handed over in the shape bot/items.js consumes, so that module asks for
         * wants rather than for callbacks and never keeps a second copy of the surface's table.
         */
        botGame: function () {
            const loader = surface();
            return {
                helper: function (name, args) { return loader.call(name, args); },
                call: function (callback, callArgs) {
                    return ensure().then(function () {
                        return channel.call(callback, callArgs);
                    }).then(function (result) {
                        if (!result || !result.ok) {
                            throw new Error((result && result.error) || ('the bridge could not ' + callback));
                        }
                        return decode(result.value);
                    });
                }
            };
        },

        readInventory: function () {
            // Through the surface rather than the raw name: GetInventoryItems is the reference
            // loader's name, which the stock game answers "no member" to, while the surface knows
            // the path its body reads (world.myAvatar.items).
            return surface().call('GetInventoryItems', []).then(function (value) {
                const raw = Array.isArray(value) ? value : [];
                return raw.map(inventoryItem);
            });
        },

        /**
         * The bank's slots. BankSlots is the game's own; the used count is the reference
         * loader's UsedBankSlots, so when that cannot be read `used` is null rather than 0 -
         * "no room left" and "nobody knows" must not look the same to a caller deciding
         * whether to fill the bank.
         */
        readBankSlots: function () {
            const game = surface();
            return game.call('BankSlots', []).then(function (total) {
                return game.call('UsedBankSlots', []).then(function (used) {
                    return { total: asNumber(total), used: asNumber(used) };
                }, function (error) {
                    log('bank usage unavailable: ' + error.message);
                    return { total: asNumber(total), used: null };
                });
            });
        },

        transferToBank: function (name) {
            // The loader's TransferToBank takes the item's name and resolves it to the item object
            // before calling the game; the surface does exactly that.
            return surface().call('TransferToBank', [name]).then(function () {});
        },

        /**
         * Equip one inventory item by name. The reference resolves a name to the item and then
         * hands the game the item's *id* - its CmdEquip does exactly that, and the loader's Equip
         * parses the id - so this resolves first rather than passing a name into a call that
         * expects a number.
         */
        equipItem: function (name) {
            const want = String(name === null || name === undefined ? '' : name).toLowerCase();
            return surface().call('GetInventoryItems', []).then(function (value) {
                const raw = Array.isArray(value) ? value : [];
                const match = raw.filter(function (item) {
                    return String(item && item.sName || '').toLowerCase() === want;
                })[0];
                if (!match) throw new Error('no item named "' + name + '" in the inventory');
                return surface().call('Equip', [match.ItemID]);
            });
        },

        // Pacing is not game access, so it is real: a feature that waits keeps working whatever
        // the bridge is doing, and never waits on a game call that will not answer.
        sleep: function (ms) {
            return new Promise(function (resolve) { setTimeout(resolve, ms); });
        }
    };
}

module.exports = {
    createGameAccess: createGameAccess,
    ERRORS: ERRORS,
    LOADER_ONLY: LOADER_ONLY
};
