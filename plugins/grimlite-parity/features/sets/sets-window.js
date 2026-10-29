// The Sets window's main-process half. The page shows the file's list, the inventory combo and
// the controls; every decision lives in sets.js and set-dialogs.js, and every game call
// goes through the injected game access (../../bridge.js).
const sets = require('./sets.js');
const { createFromHost: createDialogsFromHost } = require('./set-dialogs.js');

function createSetsWindow(deps) {
    deps = deps || {};
    const game = deps.game;
    const dialogs = deps.dialogs;
    let equipping = false;

    function handle(channel, event, args) {
        void event;
        if (channel === 'listSets') {
            return guard(async function () { return { sets: await dialogs.list() }; });
        }
        if (channel === 'setInventoryRows') {
            return guard(async function () {
                if (dialogs.bindAccount) await dialogs.bindAccount();
                return Promise.resolve(game.readInventory()).then(function (inventory) {
                    return { rows: sets.inventoryRows(inventory), error: null };
                });
            });
        }
        if (channel === 'openSet') {
            const target = args && args[0];
            return guard(function () { return target ? dialogs.openByPath(target) : dialogs.open(); });
        }
        if (channel === 'saveSet') {
            return Promise.resolve(dialogs.save((args && args[0]) || []))
                .catch(function (error) { return { canceled: false, path: null, error: message(error) }; });
        }
        if (channel === 'saveEquippedSet') {
            return guard(async function () {
                const owner = deps.account ? await deps.account() : null;
                const entries = sets.equippedEntries(await game.readInventory());
                if (deps.account && (!owner || await deps.account() !== owner)) throw new Error('Account changed. Save the equipped set again.');
                const result = await dialogs.save(entries, true);
                return Object.assign({}, result, !result.canceled && !result.error ? { entries: entries } : {});
            });
        }
        if (channel === 'equipSet' || channel === 'equipSavedSet') {
            if (equipping) return Promise.resolve({ error: 'An equip sequence is already running.' });
            equipping = true;
            return guard(async function () {
                const owner = deps.account ? await deps.account() : null;
                if (deps.account && !owner) throw new Error('Log in to the game before equipping sets.');
                let entries = args && args[0];
                if (channel === 'equipSavedSet') {
                    if (typeof entries !== 'string' || !entries) throw new Error('Select a saved set.');
                    const opened = await dialogs.openByPath(entries);
                    if (opened.error) throw new Error(opened.error);
                    if (deps.account && !entries.startsWith((await deps.account()) + ':')) throw new Error('Account changed. Select the set again.');
                    entries = opened.entries;
                }
                const equipGame = deps.account ? Object.assign({}, game, {
                    equipItem: async function (name) {
                        if (await deps.account() !== owner) throw new Error('Account changed. Select the set again.');
                        return game.equipItem(name);
                    }
                }) : game;
                return sets.equipSet(equipGame, entries);
            })
                .finally(function () { equipping = false; });
        }
        if (channel === 'setMessages') {
            return Promise.resolve(typeof deps.messages === 'function' ? deps.messages() : deps.messages || {});
        }
        throw new Error('[AquGrim:grimlite-parity] unknown sets channel "' + channel + '"');
    }

    function message(error) {
        return (error && error.message) || String(error);
    }

    // The game being unreachable is a result the window reports, not a rejection it cannot show.
    function guard(run) {
        return Promise.resolve()
            .then(run)
            .catch(function (error) { return { error: message(error) }; });
    }

    function attach() {
        if (!deps.host) return;
        deps.host.ipc.handle('listSets', function (event) {
            return handle('listSets', event, []);
        });
        deps.host.ipc.handle('setInventoryRows', function (event) {
            return handle('setInventoryRows', event, []);
        });
        deps.host.ipc.handle('openSet', function (event, target) {
            return handle('openSet', event, [target]);
        });
        deps.host.ipc.handle('saveSet', function (event, entries) {
            return handle('saveSet', event, [entries]);
        });
        ['saveEquippedSet', 'equipSet'].forEach(function (channel) {
            deps.host.ipc.handle(channel, function (event, entries) { return handle(channel, event, [entries]); });
        });
        deps.host.ipc.handle('setMessages', function (event) {
            return handle('setMessages', event, []);
        });
    }

    return { handle: handle, attach: attach };
}

/** The window as the plugin uses it: the page's channels, Electron's dialogs and the game access. */
function createFromHost(host, deps) {
    deps = deps || {};
    const game = deps.game || require('../../bridge.js').createGameAccess(host);
    const account = deps.account || require('./set-dialogs.js').createAccountSource(game);
    return createSetsWindow({
        host: host,
        account: account,
        game: game,
        dialogs: deps.dialogs || createDialogsFromHost(host, deps),
        messages: function () {
            return (typeof host.getLocaleStrings === 'function' && host.getLocaleStrings('setsMessages')) || {};
        }
    });
}

module.exports = {
    createSetsWindow: createSetsWindow,
    createFromHost: createFromHost
};
