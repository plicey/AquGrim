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
const botRuntime = require('./bot/runtime.js');
const botSession = require('./bot/session.js');
const loaders = require('./features/loaders/loaders.js');
const spammerWindow = require('./features/packets/spammer-window.js');
const tampererWindow = require('./features/packets/tamperer-window.js');

const resRoot = path.join(__dirname, '..', '..', 'res');

const createNotepad = require('./features/notepad/notepad.js').createNotepad;
const createEyedropper = require('./features/eyedropper/eyedropper.js').createEyedropper;
const createAbout = require('./features/about/about.js').createAbout;
const createCosmetics = require('./features/cosmetics/cosmetics-window.js').createFromHost;
const createOptionsWindow = require('./features/options/options-window.js').createFromHost;
const createTravelWindow = require('./features/travel/travel-window.js').createFromHost;
const { createHotkeys } = require('./features/hotkeys/hotkeys.js');
const { createHotkeysWindow } = require('./features/hotkeys/hotkeys-window.js');
const { createGameCalls } = require('./game-calls.js');

const BRIDGE_TITLE = 'AquaStar - Grimlite Parity';

/** The bridge SWF as the origin serves it, or '' when the origin is not up. */
function bridgeUrl(baseUrl) {
    return baseUrl ? baseUrl + gameOrigin.BRIDGE_PATH : '';
}

/**
 * The app's own shortcut layers, as the two members hotkeys.js takes. electron-localshortcut
 * registers on every app window and fires while one has focus; electron's globalShortcut fires
 * wherever the user is. Both answer whether the registration took, which is what the window reports
 * when a key cannot be bound.
 */
function localShortcuts() {
    return {
        register: function (accelerator, handler) {
            const electronLocalshortcut = require('electron-localshortcut');
            electronLocalshortcut.register(accelerator, handler);
            return true;
        },
        unregister: function (accelerator) {
            require('electron-localshortcut').unregister(accelerator);
        }
    };
}

function globalShortcuts() {
    return {
        register: function (accelerator, handler) {
            return require('electron').globalShortcut.register(accelerator, handler);
        },
        unregister: function (accelerator) {
            require('electron').globalShortcut.unregister(accelerator);
        }
    };
}

/**
 * The keys this app and the game plugin already hold, so a hotkey cannot take one
 * (Hotkeys.cs:395 refuses a key its own hook already has; the port's equivalent is these).
 *
 * The list is read live from what the platform merged for this session, so a user's own keybinding
 * edits are respected, and it names the owner the user sees rather than an internal id.
 */
function takenKeys(host) {
    const out = [];
    let settings = {};
    try {
        settings = (typeof host.getPlatformSettings === 'function' && host.getPlatformSettings()) || {};
    } catch (error) {
        settings = {};
    }
    const owners = {
        about: 'the app (About)',
        fullscreen: 'the app (Fullscreen)',
        sshot: 'the app (Screenshot)',
        reload: 'the app (Reload)',
        reloadCache: 'the app (Reload and clear cache)',
        forward: 'the app (Forward)',
        backward: 'the app (Back)',
        help: 'the app (Help)',
        settings: 'the app (Settings)',
        record: 'the app (Record)'
    };
    Object.keys(owners).forEach(function (id) {
        const value = settings[id];
        if (typeof value === 'string' && value) out.push({ key: value, owner: owners[id] });
        else if (Array.isArray(value)) {
            value.forEach(function (one) {
                if (typeof one === 'string' && one) out.push({ key: one, owner: owners[id] });
            });
        }
    });
    return out;
}

/**
 * The reference's "Minimize to tray" action (Hotkeys.cs:90-93) shows the app's main window and
 * brings it forward. Electron has no tray toggle of its own here, so the port's nearest equivalent
 * is to raise the window that is already open.
 */
function showMainWindow() {
    const electron = require('electron');
    const windows = electron.BrowserWindow.getAllWindows().filter(function (win) {
        return win && !win.isDestroyed() && !win.getParentWindow();
    });
    const win = windows.length ? windows[0] : null;
    if (!win) return { ok: false, error: 'the app has no window to show' };
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true };
}

async function activate(host) {
    function windowTitle(key, fallback) {
        const titles = host.getLocaleStrings('windowTitles') || {};
        return titles[key] || fallback;
    }

    // The engine's per-window registry (#37). One independent bot per game window, each with its
    // own session, variables, ints and index: the reference is a singleton because it is
    // single-client, and spec #19 overrides that for this app.
    //
    const runtime = botRuntime.createRuntimeManager({
        // `packets` is the platform's tap (#26), and it is what the aura statements read: the
        // reference's own aura cache is filled by its packet handlers, not by a game lookup
        // (ticket #42, bot/auras.js). The session subscribes once and the runtime gives the
        // subscription back when that window's bot entry is dropped.
        createSession: function () {
            return botSession.createSession({
                bridge: host.bridge,
                packets: host.packets,
                log: host.log
            });
        },
        log: function (line) { host.log('bot: ' + line); }
    });

    // What a bot is filed under: the game window the bridge channel is bound to, and `game` while
    // it is not bound to one yet. A bot's variables, ints and index belong to the game it drives,
    // so the key is that window and not the window the button was pressed in.
    //
    // Resolved once and then kept: a key that changed under a running bot would lose its own
    // state, and today the channel can only address one game window at a time anyway
    // (res/platform/bridge-channel.js picks the most recently created one, so two game windows are
    // driven as one). That limit is the channel's, and it is named in docs/FLASH_CHECKLIST.md under
    // this ticket; the runtime itself is per-window and tested so, so when the channel can be
    // scoped this function is the only thing that changes.
    let botWindowKey = null;
    function gameWindowKey() {
        // Once bound, stay bound: a start and its later stop have to land on the same bot. While
        // nothing is bound yet the key is re-resolved, so the first press after the game window
        // appears picks it up rather than sticking on the placeholder forever.
        if (botWindowKey && botWindowKey !== 'game') return botWindowKey;
        const bridge = host.bridge;
        const win = bridge && typeof bridge.attachedWindow === 'function' ? bridge.attachedWindow() : null;
        botWindowKey = win && !win.isDestroyed() ? 'game-window-' + win.id : 'game';
        return botWindowKey;
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
    // Loaders and grabbers (#31): the reference's Tools -> Loaders/grabbers window. Its rows, its
    // menus and its four loaders are all main-process work, because the page is sandboxed.
    // The write half (#27): both windows send through host.packets.send (packet-send). The
    // spammer never reads, so it needs packet-tap for nothing; the tamperer reads through the same
    // tap the logger does, which is why it holds both permissions.
    spammerWindow.createFromHost(host).attach();
    tampererWindow.createFromHost(host).attach();
    // Bot files are user documents: this window opens one from the user's own directory, shows
    // it and writes the edit back through the same dialog.
    botFile.createBotFileFeature(host).attach();
    // The Dev Test window's own IPC: the call modes and the bridge call, both main-process work
    // because the window is sandboxed.
    require('./features/devtest/devtest-main.js').register(host);

    // Char Select (#35): the session's credentials, the one-click sign-in and the window that
    // follows the connection. This plugin's window follows this plugin's game, so the list shows
    // itself while the session is down and hides itself while it is up (Flash.cs:400-409).
    require('./features/login/login-main.js').createFromHost(host);

    // Bank and Sets (#29). Both draw their own window and reach the game only through the
    // injected game access in bridge.js, which sits on this plugin's bridge channel (ticket #28).
    bankWindow.createFromHost(host).attach();
    setsWindow.createFromHost(host).attach();
    // The Bot Manager's main-process half: the sheet, the parsed document, the two dialogs and the
    // folder tree, all of which a sandboxed page cannot reach for itself.
    const botManager = require('./features/bot-manager/bot-manager.js').createBotManager({
        host: host,
        // The engine (#37): the window's Enable Bot tick starts and stops this bot, and the window
        // reads its own running flag, pause and index back for its log. The bot's state is keyed by
        // the game window it drives, so a bot belongs to its game rather than to the button.
        runtime: runtime,
        windowKeyFor: gameWindowKey,
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
    });
    botManager.register(host);

    // Loaders and grabbers (#31): the reference's Tools -> Loaders/grabbers window. Its rows, its
    // menus and its four loaders are all main-process work, because the page is sandboxed. Its
    // "Add to both / whitelist / unbank / quest list" entries append to the Bot Manager's own
    // lists, so they are handed that window's live document rather than a copy of it.
    loaders.createFromHost(host, {
        botLists: loaders.createBotLists({ bot: botManager.bot() })
    }).attachTo(host);

    // The Cosmetics window (#30): a page beside the game that reads the room's players and their
    // wear through the bridge and writes one slot at a time. It holds game-bridge, which the
    // manifest already declares; nothing here needs a new permission.
    createCosmetics(host);

    // Options and Hotkeys (#34). The option toggles are the user's own opt-in and the reference
    // re-sends most of them on a loop, so the feature owns two timers (OptionsManager.cs:188-217);
    // the hotkeys own the binding list and put each key on one of the app's two shortcut layers.
    const gameCalls = createGameCalls({
        bridge: host.bridge,
        log: function (msg) { host.log(msg); }
    });
    const optionsWindow = createOptionsWindow(host, {
        gameCalls: gameCalls,
        // The ticks and the walkspeed value are the user's own and outlive the window.
        store: host.getStore('options'),
        log: function (msg) { host.log(msg); }
    });
    const hotkeys = createHotkeys({
        store: host.getStore('hotkeys'),
        // A bound key fires only while this app has focus, except "Minimize to tray"
        // (Hotkeys.cs:245-263): electron-localshortcut is the focus-scoped hook, globalShortcut the
        // app-wide one, so each binding goes on the layer the reference's own rule asks for.
        localShortcuts: localShortcuts(host),
        globalShortcuts: globalShortcuts(host),
        openWindow: function (id) { return host.windows.openFeatureWindow(id); },
        windowIds: windows.WINDOW_IDS,
        // Keys the app and the game plugin already hold: the reference refuses a key its own hook
        // already has (Hotkeys.cs:395), and here the equivalent is these.
        takenKeys: takenKeys(host),
        platform: { showMainWindow: showMainWindow },
        gameCalls: gameCalls,
        options: optionsWindow.feature,
        log: function (msg) { host.log(msg); }
    });
    hotkeys.install();
    createHotkeysWindow({
        feature: hotkeys,
        messages: host.getLocaleStrings('hotkeysMessages') || {}
    }).attachTo(host);

    // Fast travels and the map bypasser (#32): the reference's Tools -> Fast travels form. Every
    // game call goes through the plugin's own loader-name adapter (features/travel/game-access.js)
    // and the generic bridge callbacks underneath it, so nothing here touches Flash itself.
    createTravelWindow(host).attach();

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
