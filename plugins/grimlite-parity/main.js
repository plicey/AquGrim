// Grimlite-Li parity. The plugin boots the game through its own loopback origin and loads the
// bridge SWF there: page, bridge and game share one origin, which is what lets the bridge put the
// game's classes in its own ApplicationDomain (docs/research/grimlite-bridge-spike.md).
//
// Same-origin is not an optimization. PPAPI Flash inside Chromium grants no local-trusted
// sandbox, so a bridge that loads the game cross-origin is denied every domain access. That is
// why the game is served from loopback here rather than from game.aq.com: a live game URL would
// mean a game with no bridge at all, so this plugin refuses to open one instead.

const path = require('path');

const gameOrigin = require('./game-origin.js');
const menus = require('./menus.js');
const keybinds = require('./keybinds.js');
const windows = require('./windows.js');
const botFile = require('./features/bot-file/bot-file.js');
const bankWindow = require('./features/bank/bank-window.js');
const setsWindow = require('./features/sets/sets-window.js');
const logger = require('./features/packets/logger.js');

const resRoot = path.join(__dirname, '..', '..', 'res');

const createNotepad = require('./features/notepad/notepad.js').createNotepad;
const createEyedropper = require('./features/eyedropper/eyedropper.js').createEyedropper;
const createAbout = require('./features/about/about.js').createAbout;
const createCosmetics = require('./features/cosmetics/cosmetics-window.js').createFromHost;

const BRIDGE_TITLE = 'AquaStar - Grimlite Parity';

/** The bridge SWF as the origin serves it, or '' when the origin is not up. */
function bridgeUrl(baseUrl) {
    return baseUrl ? baseUrl + gameOrigin.BRIDGE_PATH : '';
}

async function activate(host) {
    function windowTitle(key, fallback) {
        const titles = host.getLocaleStrings('windowTitles') || {};
        return titles[key] || fallback;
    }

    let baseUrl = '';
    try {
        baseUrl = await host.declareGameOrigin({
            routes: gameOrigin.routes(),
            files: gameOrigin.files(),
            // The plugin's hosts see loopback URLs, its UA policy matches the live ones.
            userAgent: gameOrigin.userAgent
        });
        host.log('game origin: ' + baseUrl);
    } catch (err) {
        host.log('game origin unavailable (' + (err && err.message ? err.message : err) +
            '): the bridge needs the game and itself on one origin, so no game window is opened');
    }

    host.setPrimaryGame({
        id: 'grimlite-parity-shell',
        // The bridge SWF is the movie the window loads; it owns the game's load from there.
        getUrl: function () { return bridgeUrl(baseUrl); },
        title: function () { return windowTitle('primary', BRIDGE_TITLE); },
        isGameUrl: function (candidate) {
            return !!candidate && candidate === bridgeUrl(baseUrl);
        },
        // Nothing here needs the wmode=direct wrapper for relative loads: the bridge resolves
        // every game path from its own base URL, and the game is served from its own origin.
        wrap: { preferDirectWmode: true, ruffleEligible: false },
        flashTrust: true
    });

    windows.register(host, windowTitle);
    menus.register(host, windowTitle);
    keybinds.register(host);
    // The packet logger is this plugin's reading half of the platform tap: it subscribes, and
    // never writes a frame (that needs packet-send, which only the spammer and tamperer hold).
    logger.createLoggerFeature(host).register();

    // Bot files are user documents: this window opens one from the user's own directory, shows
    // it and writes the edit back through the same dialog.
    botFile.createBotFileFeature(host).attach();
    // The Dev Test window's own IPC: the call modes and the bridge call, both main-process work
    // because the window is sandboxed.
    require('./features/devtest/devtest-main.js').register(host);

    // Bank and Sets (#29). Both draw their own window and reach the game only through the
    // injected game access in bridge.js, which sits on this plugin's bridge channel (ticket #28).
    bankWindow.createFromHost(host).attach();
    setsWindow.createFromHost(host).attach();
    // The Bot Manager's main-process half: the sheet, the parsed document, the two dialogs and the
    // folder tree, all of which a sandboxed page cannot reach for itself.
    require('./features/bot-manager/bot-manager.js').createBotManager({
        host: host,
        store: host.getStore(require('./bot/display-settings.js').STORE_NAMESPACE),
        // The reference puts its Bots/ folder beside the executable (Application.StartupPath); here
        // that is the app's own data directory, beside the store the plugin already keeps there.
        defaultBotsDirectory: path.join(host.appDataDirectory, 'Bots'),
        message: function () { return host.getLocaleStrings('botManagerMessages') || {}; },
        showOpenDialog: function (owner, options) {
            return require('electron').dialog.showOpenDialog(owner, options);
        },
        // The controls that act on the running game read through the generic bridge surface. A
        // name the stock game does not have reports the helper it waits for instead of a value.
        bridge: host.bridge
    }).register(host);

    // The Cosmetics window (#30): a page beside the game that reads the room's players and their
    // wear through the bridge and writes one slot at a time. It holds game-bridge, which the
    // manifest already declares; nothing here needs a new permission.
    createCosmetics(host);

    host.registerLocales({
        'en-US': require('./locales/en-US.js')
    });

    // The three windows: each owns its own main-process module (a page plus a sandbox-safe
    // preload), so a window only ever registers the IPC it uses.
    const messages = function (namespace) {
        return host.getLocaleStrings(namespace) || {};
    };
    createEyedropper({
        getMessages: function () { return messages('eyedropperMessages'); }
    }).register(host);
    createNotepad({
        getMessages: function () { return messages('notepadMessages'); },
        // The dialog belongs to the window that asked for it, so it is modal to that window.
        getWindow: function (event) {
            const electron = require('electron');
            return electron && electron.BrowserWindow && event && event.sender
                ? electron.BrowserWindow.fromWebContents(event.sender)
                : undefined;
        }
    }).register(host);
    createAbout({
        appVersion: host.appVersion,
        getMessages: function () { return messages('aboutMessages'); },
        // "the game movie" is whatever the platform calls this plugin's game window right now,
        // cached per window when it was opened (res/instances.js).
        isGameUrl: function (candidate) {
            try {
                return require(path.join(resRoot, 'platform')).pluginRuntime.isGameUrl(candidate);
            } catch (error) {
                return false;
            }
        }
    }).register(host);

    // Steering carries the session through a local process, so it is the player's opt-in rather
    // than something the client does to itself. The declaration is this game's facts: the platform
    // owns the mechanism and knows none of them (res/platform/packet-layer.js).
    host.registerOptionDefaults({ packetSteering: false });
    host.registerSettingsSection({
        id: 'grimlite-packets',
        titleKey: 'packets',
        title: 'Packets',
        order: 30,
        fields: [{ key: 'packetSteering', type: 'boolean' }]
    });
    host.registerPacketSteering(require('./packets.js').steeringDeclarations()[0]);

    host.log('Grimlite Parity activated; bridge at ' + (bridgeUrl(baseUrl) || '(no origin)'));
}

module.exports = {
    activate: activate
};
