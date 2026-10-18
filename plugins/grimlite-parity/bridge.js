// The one place in this plugin that asks the game for something (spec #19, Seam 4). Every
// feature consumes an object of this shape and never reaches Flash, the Host or the SWF itself;
// what satisfies it later is ticket #28's bridge channel, and what satisfies it under test is a
// plain object. The methods are named for what a feature wants ("read the inventory", "equip
// this item"), not for the bridge mechanism, so the call surface can grow behind them.
//
// The game-side names each method needs are recorded next to it, from the reference's own call
// list (docs/research/grimlite-capabilities.md, section 2.4); nothing here calls them yet.
//
// THE INTERFACE #28 MUST SATISFY - plugins/grimlite-parity/bridge.js, createGameAccess(host):
//
//   readInventory()            -> Promise<Item[]>      Flash "GetInventoryItems"
//   readBankSlots()            -> Promise<{total,used}> Flash "BankSlots" / "UsedBankSlots"
//   transferToBank(name)       -> Promise<void>        Flash "TransferToBank"
//   transferToInventory(name)  -> Promise<void>        Flash "TransferToInventory"
//   equipItem(name)            -> Promise<void>        Flash "Equip"
//   readWorld()                -> Promise<World>       "Cell"/"Pad"/"Map"/"State", "IsActionAvailable"
//   moveToCell(cell, pad)      -> Promise<void>        Flash "Jump"
//   sleep(ms)                  -> Promise<void>        (the pacing the reference gets from Task.Delay)
//
// Item is an InventoryItem as its own JSON decoder yields it: { id, name, category, isAcItem,
// isEquipped, ... } from ItemID / sName / sType / bCoins / bEquip. World is { cell, pad, map,
// state } where state is 0 dead / 1 idle / 2 in combat (Player.State) and `equipAvailable` is
// World.IsActionAvailable("equipItem") (LockedActions.EquipItem).

const NOT_WIRED = 'the game bridge is not wired in this build (ticket #28) yet';

/**
 * The game access the features consume. Until the bridge channel exists every call reports that
 * it is unwired (a rejection, so an awaiting caller cannot mistake it for a result) instead of
 * pretending to reach a game that is not there.
 *
 * @param {object} host the plugin Host, used for logging only until the bridge lands
 */
function createGameAccess(host) {
    const log = (host && typeof host.log === 'function')
        ? function (msg) { host.log(msg); }
        : function () {};

    function unwired(method) {
        log('game access not wired: ' + method);
        return Promise.reject(new Error(NOT_WIRED));
    }

    return {
        readInventory: function () { return unwired('readInventory'); },
        readBankSlots: function () { return unwired('readBankSlots'); },
        transferToBank: function () { return unwired('transferToBank'); },
        transferToInventory: function () { return unwired('transferToInventory'); },
        equipItem: function () { return unwired('equipItem'); },
        readWorld: function () { return unwired('readWorld'); },
        moveToCell: function () { return unwired('moveToCell'); },
        // Pacing is not game access, so it is real: a feature that waits keeps working after the
        // bridge lands, and never waits for a game call that will not answer.
        sleep: function (ms) {
            return new Promise(function (resolve) { setTimeout(resolve, ms); });
        }
    };
}

module.exports = {
    createGameAccess: createGameAccess,
    NOT_WIRED: NOT_WIRED
};
