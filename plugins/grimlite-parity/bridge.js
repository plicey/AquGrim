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
// game: GetInventoryItems, TransferToBank, TransferToInventory, UsedBankSlots, IsActionAvailable
// and ~95 more are loader-only, while only 33 names are in both - among them Equip, Jump,
// BankSlots, State, Cell, Pad and Map (docs/research/grimlite-capabilities.md section 3). The
// bridge loads the *stock* game, so a loader-only name is one the game answers `no member ... at
// world` to until the bridge grows that surface itself.
//
// So every call goes through and reports what actually happened; nothing here invents a result,
// and a name the game cannot answer is annotated with what that means rather than left as a bare
// failure. That also keeps this adapter forward-compatible: the day the bridge implements the
// loader's surface, these calls start working with no change here.

const UNCHANNELLED = 'this app has no game bridge channel';

// The reference loader's own call names this module uses. Kept as data so the failure a user
// sees can explain itself, and so the list of what the bridge still owes is in one place.
const LOADER_ONLY = {
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

    return {
        readInventory: function () {
            return call('GetInventoryItems', []).then(function (value) {
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
            return call('BankSlots', []).then(function (total) {
                return call('UsedBankSlots', []).then(function (used) {
                    return { total: asNumber(total), used: asNumber(used) };
                }, function (error) {
                    log('bank usage unavailable: ' + error.message);
                    return { total: asNumber(total), used: null };
                });
            });
        },

        transferToBank: function (name) {
            return call('TransferToBank', [name]).then(function () {});
        },

        equipItem: function (name) {
            return call('Equip', [name]).then(function () {});
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
