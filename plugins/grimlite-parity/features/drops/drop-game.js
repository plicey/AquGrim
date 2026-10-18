// The three things this window asks the game for (ticket #33), each through the bridge's named
// surface (ticket #48) rather than a hand-rolled path.
//
//   the bag      GetInventoryItems -> world.myAvatar.items
//   the slots    InventorySlots   -> world.myAvatar.objData.iBagSlots
//                HouseSlots       -> world.myAvatar.objData.iHouseSlots
//   the house    GetHouseItems    -> world.myAvatar.houseitems
//   the room     RoomId           -> world.curRoom
//
// All five are loader names whose rows in loader-surface.js already reach the right path, so this
// file maps a want to a name and nothing more. A refusal is reported with the surface's own words:
// a read that failed is never turned into an empty inventory, because an empty inventory would
// read as "nothing is owned" and make a takeable item look blocked.

/** One loader surface call, as a value or a reason - never a throw. */
function readOne(surface, name, args) {
    return surface.call(name, args || []).then(function (value) {
        return { value: value, error: null };
    }, function (error) {
        return { value: null, error: (error && error.message) || String(error) };
    });
}

function asList(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.items)) return payload.items;
    if (payload && typeof payload === 'object') {
        return Object.keys(payload).map(function (key) { return payload[key]; })
            .filter(function (value) { return value && typeof value === 'object'; });
    }
    return [];
}

function asNumber(value) {
    const n = Number(value);
    return isFinite(n) ? n : null;
}

/**
 * @param {object} game an object with `loaderSurface()` (bridge.js's own game access), or a
 *                      stand-in with the same method
 */
function createDropGame(game) {
    function surface() {
        if (!game || typeof game.loaderSurface !== 'function') return null;
        try {
            return game.loaderSurface();
        } catch (error) {
            return null;
        }
    }

    function missing() {
        return Promise.reject(new Error('this app has no game bridge channel'));
    }

    return {
        /** The bag, as a list. A refusal rejects rather than answering an empty bag. */
        readInventory: function () {
            const api = surface();
            if (!api) return missing();
            return readOne(api, 'GetInventoryItems').then(function (answer) {
                if (answer.error) throw new Error(answer.error);
                return asList(answer.value);
            });
        },

        /**
         * The bag and house slot counts, as the game reports them. A count nobody could read is
         * null, not 0: the window decides whether an item is takeable, and 0 would block every
         * drop of a full game that simply could not answer.
         */
        readSlots: function () {
            const api = surface();
            if (!api) return missing();
            return Promise.all([
                readOne(api, 'InventorySlots'),
                readOne(api, 'HouseSlots')
            ]).then(function (answers) {
                return {
                    bag: answers[0].error ? null : asNumber(answers[0].value),
                    house: answers[1].error ? null : asNumber(answers[1].value)
                };
            });
        },

        /** The player's house inventory, for the house half of the takeable test. */
        readHouseItems: function () {
            const api = surface();
            if (!api) return missing();
            return readOne(api, 'GetHouseItems').then(function (answer) {
                if (answer.error) throw new Error(answer.error);
                return asList(answer.value);
            });
        },

        /** The room the player is in, which is the room DropStack's getDrop frame carries. */
        readRoomId: function () {
            const api = surface();
            if (!api) return missing();
            return readOne(api, 'RoomId').then(function (answer) {
                if (answer.error) throw new Error(answer.error);
                return answer.value === null || answer.value === undefined ? '' : String(answer.value);
            });
        }
    };
}

module.exports = {
    createDropGame: createDropGame,
    asList: asList
};
