// The login window's main-process half: the wiring a sandboxed page cannot do for itself.
//
// Two jobs. The first is the user's own credentials file: the reference reads
// Application.StartupPath + "\\CharSelect.cfg" (Root.cs:135), and here that is the app's data
// directory. It is the user's file, so it is read when they ask and there is no write path at all -
// this app never creates or rewrites one (spec Out of Scope).
//
// The second is the connection read the window follows. The stock game's ABC string pool does carry
// `sfc`, `isConnected` and `connectTo`, but a pool entry is not proof of a callable member (the
// two-condition rule in ../../bridge.js), so this reads the game's own connection object as a
// dot-path and hands back everything it could not learn as `connected: null`. The window treats that
// as `unknown` and stays usable, which is the honest answer until a live client confirms the path.
//
// Electron is reached at call time (require('electron') is the npm shim outside the app process).
const path = require('path');
const fs = require('fs');

const model = require('./login-model.js');
const loginWindow = require('./login-window.js');

// The game's own connection object, as the shipped SWF spells it. A dot-path read rather than a
// name: `world.sfc.isConnected` is a member chain, and the bridge answers "no member" when it is not.
const CONNECTION_PATH = 'world.sfc.isConnected';

/**
 * The window's connection reader, on the plugin's game access (../../bridge.js). Never throws and
 * never guesses: an answer it cannot read becomes an error, which the watch reports as unknown.
 *
 * @param {object} game the game access
 */
function connectionReader(game) {
    return function () {
        return Promise.resolve()
            .then(function () { return game.call('getGameObject', [CONNECTION_PATH]); })
            .then(function (value) {
                if (value === true) return { connected: true };
                if (value === false) return { connected: false };
                if (value && typeof value === 'object' && typeof value.error === 'string') {
                    return { connected: null, error: value.error };
                }
                return { connected: null, error: 'the game did not report a connection state' };
            }, function (error) {
                return { connected: null, error: (error && error.message) || String(error) };
            });
    };
}

/** The user's own copy of the reference's file, as text. Reading it writes nothing. */
function readCredentialsFile(filePath) {
    return function () {
        return Promise.resolve()
            .then(function () {
                return { text: fs.readFileSync(filePath, 'utf8'), error: null };
            }, function (error) {
                return { text: null, error: (error && error.message) || String(error) };
            });
    };
}

/**
 * The feature as the plugin uses it: the window on the plugin's game access, the credentials file
 * under the app's data directory, and the session's store. Everything injectable is injected so the
 * behaviour is testable without Electron, Flash or a real app.
 *
 * @param {object} host the plugin Host
 * @param {object} [deps] test seams
 */
function createFromHost(host, deps) {
    deps = deps || {};
    const game = deps.game || require('../../bridge.js').createGameAccess(host);
    const messages = (typeof host.getLocaleStrings === 'function' &&
        host.getLocaleStrings('loginMessages')) || {};
    const window = loginWindow.createLoginWindow({
        host: host,
        game: game,
        messages: messages,
        store: deps.store,
        // Usernames persist in the platform's namespaced store (never passwords); the file above
        // is the user's own CharSelect.cfg, read only.
        names: deps.names || host.getStore('login'),
        pluginId: host.pluginId,
        readCredentialsFile: deps.readCredentialsFile ||
            readCredentialsFile(path.join(host.appDataDirectory, loginWindow.CREDENTIALS_FILE)),
            readConnection: deps.readConnection || connectionReader(game)
    });
    // Root_Load reads the credentials file at startup; a first run with no file is silent.
    Promise.resolve(window.autoImport()).catch(function () {});
    // The window follows the session from the moment the plugin activates: the reference's list is
    // loaded at startup too (Root.cs:115), and a session that drops while nothing is open still
    // brings the list up.
    window.startSessionWatch({
        intervalMs: deps.intervalMs,
        every: deps.every,
        cancel: deps.cancel,
        open: function () {
            host.windows.openFeatureWindow(require('../../windows.js').LOGIN_WINDOW_ID);
        }
    });
    return window;
}

module.exports = {
    createFromHost: createFromHost,
    connectionReader: connectionReader,
    readCredentialsFile: readCredentialsFile,
    CONNECTION_PATH: CONNECTION_PATH
};
