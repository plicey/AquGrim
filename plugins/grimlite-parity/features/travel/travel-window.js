// The Fast travels window's main-process half. The page draws the reference's controls and asks
// here for the groups and for one button to run; every decision lives in travel.js, and every game
// call goes through the injected game access (./game-access.js), never through this file.

const travel = require('./travel.js');
const data = require('./travel-data.js');

function createTravelWindow(deps) {
    deps = deps || {};
    const game = deps.game;
    const messages = Object.assign({}, travel.MESSAGES, deps.messages || {});

    function handle(channel, event, args) {
        void event;
        if (channel === 'travelGroups') {
            return Promise.resolve({
                groups: data.GROUPS,
                buttons: data.BUTTONS,
                private: data.PRIVATE,
                bypasser: data.BYPASSER,
                aweTypes: data.AWE_TYPES
            });
        }
        if (channel === 'travelRun') {
            return run(travel.runButton, [(args && args[0]) || '', (args && args[1]) || {}]);
        }
        if (channel === 'travelUnlock') {
            return run(travel.unlock, [(args && args[0]) || 0, {}]);
        }
        if (channel === 'travelSendPacket') {
            return run(travel.sendPacket, [(args && args[0]) || '']);
        }
        if (channel === 'travelMessages') {
            return Promise.resolve(messages);
        }
        throw new Error('[AquaStar:grimlite-parity] unknown travel channel "' + channel + '"');
    }

    // A window must never receive a rejection it cannot show: the game being unreachable is a
    // result the page reports like any other, with nothing travelled and nothing sent.
    function run(what, params) {
        return Promise.resolve()
            .then(function () { return what.apply(null, [game].concat(params)); })
            .catch(function (error) { return { error: (error && error.message) || String(error) }; });
    }

    function attach() {
        if (!deps.host) return;
        deps.host.ipc.handle('travelGroups', function (event) {
            return handle('travelGroups', event, []);
        });
        deps.host.ipc.handle('travelRun', function (event, id, options) {
            return handle('travelRun', event, [id, options]);
        });
        deps.host.ipc.handle('travelUnlock', function (event, questId) {
            return handle('travelUnlock', event, [questId]);
        });
        deps.host.ipc.handle('travelSendPacket', function (event, packet) {
            return handle('travelSendPacket', event, [packet]);
        });
        deps.host.ipc.handle('travelMessages', function (event) {
            return handle('travelMessages', event, []);
        });
        // Clipboard is main-process-only under sandbox:true / nodeIntegration:false, and the
        // reference's own Copy button is Clipboard.SetText (Travel.cs's btnCopyPacket_Click).
        deps.host.ipc.on('travelCopy', function (event, text) {
            void event;
            try {
                require('electron').clipboard.writeText(typeof text === 'string' ? text : '');
            } catch (error) {
                if (deps.host && typeof deps.host.log === 'function') {
                    deps.host.log('travel could not copy: ' + ((error && error.message) || error));
                }
            }
        });
    }

    return { handle: handle, attach: attach };
}

/** The window as the plugin uses it: the page's channels and the game access from the Host. */
function createFromHost(host, deps) {
    deps = deps || {};
    return createTravelWindow({
        host: host,
        game: deps.game || require('./game-access.js').createGameAccess(host),
        messages: (typeof host.getLocaleStrings === 'function' &&
            host.getLocaleStrings('travelMessages')) || {}
    });
}

module.exports = {
    createTravelWindow: createTravelWindow,
    createFromHost: createFromHost
};
