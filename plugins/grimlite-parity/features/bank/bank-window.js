// The Bank window's main-process half. The page draws the reference's controls and asks here
// for the two lists and for a transfer to run; every decision lives in bank.js, and every game
// call goes through the injected game access (../../bridge.js), never through this file.
const bank = require('./bank.js');

function createBankWindow(deps) {
    deps = deps || {};
    const game = deps.game;
    // The reference's refusals are the logic's own words; everything the page draws (labels,
    // status lines) arrives from the plugin's locale catalog through the same channel.
    function messages() {
        const supplied = typeof deps.messages === 'function' ? deps.messages() : deps.messages;
        return Object.assign({}, bank.MESSAGES, supplied || {});
    }

    function handle(channel, event, args) {
        void event;
        if (channel === 'bankCategories') {
            return Promise.resolve({
                categories: bank.CATEGORIES,
                acChoices: bank.AC_CHOICES
            });
        }
        if (channel === 'bankCategory') {
            return bankTransfer(bank.bankCategory, (args && args[0]) || {});
        }
        if (channel === 'bankAll') {
            return bankTransfer(bank.bankAll, (args && args[0]) || {});
        }
        if (channel === 'bankMessages') {
            return Promise.resolve(messages());
        }
        throw new Error('[AquaStar:grimlite-parity] unknown bank channel "' + channel + '"');
    }

    // A window must never receive a rejection it cannot show: the game being unreachable is a
    // result the page reports like any other, with nothing transferred.
    function bankTransfer(run, selection) {
        return Promise.resolve()
            .then(function () { return run(game, selection); })
            .catch(function (error) {
                return {
                    transferred: 0,
                    total: 0,
                    error: (error && error.message) || String(error)
                };
            });
    }

    function attach() {
        if (!deps.host) return;
        deps.host.ipc.handle('bankCategories', function (event) {
            return handle('bankCategories', event, []);
        });
        deps.host.ipc.handle('bankCategory', function (event, selection) {
            return handle('bankCategory', event, [selection]);
        });
        deps.host.ipc.handle('bankAll', function (event, selection) {
            return handle('bankAll', event, [selection]);
        });
        deps.host.ipc.handle('bankMessages', function (event) {
            return handle('bankMessages', event, []);
        });
    }

    return { handle: handle, attach: attach };
}

/** The window as the plugin uses it: the page's channels, and the game access from the Host. */
function createFromHost(host, deps) {
    deps = deps || {};
    return createBankWindow({
        host: host,
        game: deps.game || require('../../bridge.js').createGameAccess(host),
        messages: function () {
            return typeof host.getLocaleStrings === 'function' &&
                host.getLocaleStrings('bankMessages');
        }
    });
}

module.exports = {
    createBankWindow: createBankWindow,
    createFromHost: createFromHost
};
