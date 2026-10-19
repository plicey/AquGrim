// About window - the version line, the reference credits and the reload control.
// Reference: Grimoire/UI/AboutForm.cs (version label, credit Process.Start targets, and
// btnLoadSWF_Click re-initialising the game movie).
const credits = require('./credits.js');
const reload = require('./reload.js');
const path = require('path');
const fs = require('fs');

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
        // The reference's tbGameSWF field holds a path relative to the executable and passes it to
        // InitFlashMovie. This app's one game-SWF override is the platform's managed file in its
        // data directory, so that is the only path this field accepts: the check below keeps the
        // box from becoming an arbitrary-file read.
        const managedSwf = deps.customSwfPath ||
            path.join(host.appDataDirectory || '', 'custom-game.swf');
        const game = deps.game || require('../../bridge.js').createGameAccess(host);

        host.ipc.handle('aboutInfo', function () {
            return {
                version: credits.versionLine(),
                port: credits.portLine(deps.appVersion),
                teams: credits.teams(),
                prose: credits.CREDITS_PROSE,
                swfPath: managedSwf,
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

        // AboutForm.btnLoadSWF_Click: check the path, log out, then re-initialise the movie. The
        // only path this accepts is the platform's own custom-game.swf, so a typed string cannot
        // point the game at a file the user did not choose in Settings.
        host.ipc.handle('aboutLoadSwf', function (event, candidate) {
            void event;
            const wanted = String(candidate == null ? '' : candidate).trim() || managedSwf;
            if (path.resolve(wanted) !== path.resolve(managedSwf)) {
                return { loaded: 0, status: 'Use Settings - Custom SWF File to choose a different game SWF.' };
            }
            if (!fs.existsSync(path.resolve(managedSwf))) {
                return { loaded: 0, status: 'File not found.' };
            }
            const logout = typeof game.loaderCall === 'function'
                ? Promise.resolve().then(function () { return game.loaderCall('Logout', []); })
                    .catch(function (error) {
                        // A session that cannot be logged out must not stop the reload; the reload
                        // is what the button promises, and the game window goes back to the loader
                        // either way.
                        host.log('about: could not log out before the reload: ' +
                            ((error && error.message) || error));
                    })
                : Promise.resolve();
            return logout.then(function () {
                const count = reload.gameMovie({
                    windows: getWindows(),
                    isGameUrl: deps.isGameUrl,
                    onError: function (error, win) {
                        host.log('could not reload a game window (' + (win && win.id) + '): ' +
                            (error && error.message ? error.message : error));
                    }
                });
                return { loaded: count, status: count ? '' : 'No game window is open.' };
            });
        });
    }

    return { register: register };
}

module.exports = { createAbout: createAbout };
