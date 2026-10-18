// About window - the version line, the reference credits and the reload control.
// Reference: Grimoire/UI/AboutForm.cs (version label, credit Process.Start targets, and
// btnLoadSWF_Click re-initialising the game movie).
const credits = require('./credits.js');
const reload = require('./reload.js');

// Reached at call time: outside the app process require('electron') is the npm shim.
function electronApi() {
    const electron = require('electron');
    return electron && electron.shell ? electron : null;
}

/**
 * @param {object} deps
 * @param {string} deps.appVersion running app version, shown in the reference's shape
 * @param {Function} [deps.getWindows] BrowserWindow.getAllWindows, for tests
 * @param {Function} [deps.openExternal] shell.openExternal, for tests
 * @param {Function} [deps.isGameUrl] the platform's game-window classifier
 * @param {Function} [deps.getMessages] locale strings for this window
 */
function createAbout(deps) {
    deps = deps || {};
    const getMessages = deps.getMessages || function () { return {}; };
    const openExternal = deps.openExternal || function (url) {
        const electron = electronApi();
        return electron ? electron.shell.openExternal(url) : null;
    };
    const getWindows = deps.getWindows || function () {
        const electron = electronApi();
        return electron ? electron.BrowserWindow.getAllWindows() : [];
    };

    function register(host) {
        host.ipc.handle('aboutInfo', function () {
            return {
                version: credits.versionLine(deps.appVersion),
                reference: credits.referenceLine(),
                links: credits.creditLinks(),
                messages: getMessages()
            };
        });

        // Only the links the window was shown are openable; the page cannot hand over an
        // arbitrary URL.
        host.ipc.handle('aboutOpenLink', function (event, url) {
            const allowed = credits.creditLinks().filter(function (link) {
                return link.url === url;
            });
            if (!allowed.length) return { opened: false };
            openExternal(url);
            return { opened: true };
        });

        // The reference disables the bot and logs out first; there is no bot here yet, so this
        // is the reload the button promises.
        host.ipc.handle('aboutReloadGame', function () {
            const count = reload.gameMovie({
                windows: getWindows(),
                isGameUrl: deps.isGameUrl,
                onError: function (error, win) {
                    host.log('could not reload a game window (' + (win && win.id) + '): ' +
                        (error && error.message ? error.message : error));
                }
            });
            return { reloaded: count, none: count === 0 };
        });
    }

    return { register: register };
}

module.exports = { createAbout: createAbout };
