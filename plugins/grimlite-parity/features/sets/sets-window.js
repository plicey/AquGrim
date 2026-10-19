// The Sets window's main-process half. The page shows the file's list, the inventory combo and
// the four buttons; every decision lives in sets.js and set-dialogs.js, and every game call
// goes through the injected game access (../../bridge.js).
const sets = require('./sets.js');
const { createFromHost: createDialogsFromHost } = require('./set-dialogs.js');

function createSetsWindow(deps) {
    deps = deps || {};
    const game = deps.game;
    const dialogs = deps.dialogs;

    function handle(channel, event, args) {
        void event;
        if (channel === 'listSets') {
            return dialogs.list().then(function (found) { return { sets: found }; });
        }
        if (channel === 'setInventoryRows') {
            return guard(function () {
                return Promise.resolve(game.readInventory()).then(function (inventory) {
                    return { rows: sets.inventoryRows(inventory), error: null };
                });
            });
        }
        if (channel === 'openSet') {
            const target = args && args[0];
            return target ? dialogs.openByPath(target) : dialogs.open();
        }
        if (channel === 'saveSet') {
            return Promise.resolve(dialogs.save((args && args[0]) || []))
                .catch(function (error) { return { canceled: false, path: null, error: message(error) }; });
        }
        if (channel === 'setMessages') {
            return Promise.resolve(deps.messages || {});
        }
        throw new Error('[AquaStar:grimlite-parity] unknown sets channel "' + channel + '"');
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
        deps.host.ipc.handle('setMessages', function (event) {
            return handle('setMessages', event, []);
        });
    }

    return { handle: handle, attach: attach };
}

/** The window as the plugin uses it: the page's channels, Electron's dialogs and the game access. */
function createFromHost(host, deps) {
    deps = deps || {};
    return createSetsWindow({
        host: host,
        game: deps.game || require('../../bridge.js').createGameAccess(host),
        dialogs: deps.dialogs || createDialogsFromHost(host, deps),
        messages: (typeof host.getLocaleStrings === 'function' &&
            host.getLocaleStrings('setsMessages')) || {}
    });
}

module.exports = {
    createSetsWindow: createSetsWindow,
    createFromHost: createFromHost
};
