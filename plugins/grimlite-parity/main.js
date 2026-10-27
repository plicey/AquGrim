// Grimlite-Li parity. The plugin boots the game through its own loopback origin and loads the
// bridge SWF there. The bridge runs Artix's Loader4 on that origin, so page, bridge, loader and
// game share one origin and the bridge can reach the initialized Game root in its ApplicationDomain.
//
// Same-origin is not an optimization. PPAPI Flash inside Chromium grants no local-trusted
// sandbox, so a bridge that loads the game cross-origin is denied every domain access. That is
// why the loader and game are served from loopback rather than from game.aq.com: a live game URL
// would mean a game with no bridge at all, so this plugin refuses to open one instead.

const fs = require('fs');
const path = require('path');

const gameOrigin = require('./game-origin.js');
const menus = require('./menus.js');
const keybinds = require('./keybinds.js');
const windows = require('./windows.js');
const bankWindow = require('./features/bank/bank-window.js');
const logger = require('./features/packets/logger.js');
const botRuntime = require('./bot/runtime.js');
const botSession = require('./bot/session.js');
const itemsModel = require('./bot/items.js');
const loaders = require('./features/loaders/loaders.js');
const spammerWindow = require('./features/packets/spammer-window.js');
const tampererWindow = require('./features/packets/tamperer-window.js');

const resRoot = path.join(__dirname, '..', '..', 'res');

const createNotepad = require('./features/notepad/notepad.js').createNotepad;
const autoAttackWindow = require('./features/auto-attack/auto-attack-window.js');
const createEyedropper = require('./features/eyedropper/eyedropper.js').createEyedropper;
const createAbout = require('./features/about/about.js').createAbout;
const createCosmetics = require('./features/cosmetics/cosmetics-window.js').createFromHost;
const createOptionsWindow = require('./features/options/options-window.js').createFromHost;
const createDropWindow = require('./features/drops/drop-window.js').createFromHost;
const createTravelWindow = require('./features/travel/travel-window.js').createFromHost;
const maidWindow = require('./features/maid/maid-window.js');
const { createHotkeys } = require('./features/hotkeys/hotkeys.js');
const { createHotkeysWindow } = require('./features/hotkeys/hotkeys-window.js');
const { createGameCalls } = require('./game-calls.js');
const chromeFeature = require('./features/chrome/chrome.js');
const skillPresets = require('./features/chrome/skill-presets.js');
const launcherSkin = require('./features/chrome/skin.js');
const logsFeature = require('./features/hotkeys/logs.js');

const BRIDGE_TITLE = 'AquGrim';
const LOGIN_PAGE = path.join('features', 'login', 'login.html');

// Electron keeps no reference of its own to a Tray: letting this go would take the icon away.
let appTray = null;

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

/** Electron's main-process module, or null when this is not an Electron process (tests). */
function electronRuntime() {
    try {
        const electron = require('electron');
        return electron && electron.BrowserWindow ? electron : null;
    } catch (error) {
        return null;
    }
}

function allWindows() {
    const electron = electronRuntime();
    if (!electron) return [];
    return electron.BrowserWindow.getAllWindows().filter(function (win) {
        return win && !win.isDestroyed();
    });
}

/** The shell's game window: the one the plugin declared as its primary surface. */
function mainWindow() {
    try {
        const runtime = require(path.join(resRoot, 'platform')).pluginRuntime;
        const win = runtime.getGameWindow();
        if (win && !win.isDestroyed()) return win;
    } catch (error) {
        // No platform runtime yet; the window list below is the fallback.
    }
    const windows = allWindows().filter(function (win) { return !win.getParentWindow(); });
    return windows.length ? windows[0] : null;
}

/** The reference's "Show Main Window" action: restore, show and focus the game window. */
function showMainWindow() {
    const win = mainWindow();
    if (!win) return { ok: false, error: 'the app has no window to show' };
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true };
}

/** "Minimize to tray": hide a visible window, bring a hidden or minimized one back. */
function toggleMainWindow() {
    const win = mainWindow();
    if (!win) return { ok: false, error: 'the app has no window to toggle' };
    if (win.isVisible() && !win.isMinimized()) {
        win.hide();
        return { ok: true, hidden: true };
    }
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return { ok: true, hidden: false };
}

/** Rebuild the game windows' menus after the Char Select entry's visibility changed. */
function refreshGameMenus() {
    try {
        const runtime = require(path.join(resRoot, 'platform')).pluginRuntime;
        const instances = require(path.join(resRoot, 'instances.js'));
        allWindows().forEach(function (win) {
            const url = win.aquaStarSwfUrl || (win.webContents && win.webContents.getURL());
            if (url && runtime.isGameUrl(url)) instances.applyWindowMenu(win, url);
        });
    } catch (error) {
        // A window between construction and its menu is not a reason to stop following a session.
    }
}

function loginWindows() {
    return allWindows().filter(function (win) {
        try {
            const url = String(win.webContents && win.webContents.getURL ? win.webContents.getURL() : '')
                .replace(/\\/g, '/');
            return url.indexOf(LOGIN_PAGE.replace(/\\/g, '/')) !== -1;
        } catch (error) {
            return false;
        }
    });
}

function showLoginWindows(visible) {
    loginWindows().forEach(function (win) {
        if (visible) {
            if (win.isMinimized()) win.restore();
            win.show();
        } else {
            win.hide();
        }
    });
}

/** The tray icon, whose click is the same minimize/restore toggle as the hotkey. */
function installTray(host) {
    const electron = electronRuntime();
    if (!electron || typeof electron.Tray !== 'function') return null;
    try {
        const tray = new electron.Tray(host.getAppIconPath());
        tray.setToolTip('AquGrim');
        tray.on('click', function () { toggleMainWindow(); });
        appTray = tray;
        return tray;
    } catch (error) {
        if (host && typeof host.log === 'function') {
            host.log('tray unavailable: ' + ((error && error.message) || error));
        }
        return null;
    }
}

async function activate(host) {
    // Start recording before anything else logs: the Logs window is the reference's own debug log,
    // and it has to contain what happened before the window was opened.
    const logs = logsFeature.createLogFeature();
    logs.capture(host);
    logs.attach(host);

    function windowTitle(key, fallback) {
        const titles = host.getLocaleStrings('windowTitles') || {};
        return titles[key] || fallback;
    }

    // The reference's Char Select entry is hidden while a connection is up and shown again on a
    // drop (Root.cs:167, Flash.cs:400-409). The menu contributor reads this live value.
    let charSelectVisible = true;
    const skin = launcherSkin.createLauncherSkin({
        getWindow: mainWindow,
        title: function () { return windowTitle('primary', BRIDGE_TITLE); },
        chrome: function (win, visible) {
            try {
                require(path.join(resRoot, 'windows', 'game-chrome.js')).gameChrome()
                    .setEnabled(win, visible);
            } catch (error) {
                // A window without the wrapper page has no strip to move.
            }
        }
    });

    // The engine's per-window registry (#37). One independent bot per game window, each with its
    // own session, variables, ints and index: the reference is a singleton because it is
    // single-client, and spec #19 overrides that for this app.
    //
    // The shell seams the misc commands need (#40) ride along from here, because the plugin shell
    // is what owns them: the relay is host.packets (packet-send, the same path the spammer window
    // writes through), the alert sound is Electron's own, bot files are the user's, and the bots
    // directory is the one the Bot Manager already uses.
    //
    // A seam that is absent is left absent on purpose: the engine then says which command it
    // cannot carry out rather than appearing to run one that does nothing.
    // The same default the Bot Manager declares below, hoisted so the two cannot drift: a
    // CmdLoadBot that resolved against one directory while the tree listed another would be a
    // file the user can see and the engine cannot reach.
    const defaultBotsDirectory = path.join(
        host.persistentAppDataDirectory || host.appDataDirectory, 'Bots');
    // And the directory the user actually chose, which is the Bot Manager's own setting: a bot
    // saved from the tree with a relative path resolves against the same root the tree lists.
    const botSettings = require('./bot/display-settings.js').create({
        store: host.getStore(require('./bot/display-settings.js').STORE_NAMESPACE),
        defaultBotsDirectory: defaultBotsDirectory
    });
    // The Options window's feature (#34), which the engine's provoke commands move. It is built
    // further down, beside its own window; the holder exists so the two can be wired in either
    // order without one reaching into the other's binding before it is set.
    let optionsFeature = null;
    let botManager = null;
    let maid = null;
    let chrome = null;
    let loginFeature = null;
    // The auto-zone panel (#44), which lives with the Maid window beside its own handlers and is
    // read by CmdSpecialHandler through the accessor below. Held here for the same reason as the
    // options feature: the engine is built before the window that owns it.
    let zonePanel = null;
    // What the bot session reads the game through. The session wants both halves of the bridge:
    // the platform's raw channel (`attach()`, `call(name, args)` - #28) for the two paths it owns
    // itself, and this plugin's game access (bridge.js) for the loader's own helper names (#48),
    // which is where `loaderCall` lives. Every other feature is handed the game access alone and
    // never needs the raw channel; a bot does, so the two are put together here once rather than
    // the session growing a second way to reach the game.
    const gameAccess = require('./bridge.js').createGameAccess(host);
    const botBridge = Object.assign({}, host.bridge, { loaderCall: gameAccess.loaderCall });
    const runtimeDependencies = {
        // The session reads the game through `botBridge` (the raw channel plus #48's loader
        // surface, above); `packets` is the platform's tap (#26), which the aura statements read:
        // the reference's own aura cache is filled by its packet handlers, not by a game lookup
        // (ticket #42, bot/auras.js). It subscribes once, and the runtime gives the subscription
        // back when that window's bot entry is dropped.
        createSession: function () {
            return botSession.createSession({ bridge: botBridge, packets: host.packets, log: host.log });
        },
        log: function (line) { host.log('bot: ' + line); },
        packets: host.packets,
        beep: function (count) {
            const times = count === undefined ? 1 : Math.max(0, Number(count) || 0);
            const shell = require('electron').shell;
            for (let i = 0; i < times; i++) shell.beep();
        },
        botsDirectory: function () { return botSettings.botsDirectory() || defaultBotsDirectory; },
        exists: function (file) { return require('fs').existsSync(file); },
        readFile: function (file) { return require('fs').readFileSync(file, 'utf8'); },
        // CmdProvoke / CmdToggleProvoke move the Options window's own Provoke tick (#34), which is
        // the same want the reference reads out of OptionsManager.ProvokeMonsters. That window is
        // built below, so this reads the holder above rather than the binding it will hold.
        options: {
            setToggle: function (id, on) {
                if (!optionsFeature) return false;
                return optionsFeature.setToggle(id, on);
            },
            setApplying: function (running) {
                if (!optionsFeature) return Promise.resolve({ ok: false, error: 'options are not ready' });
                return optionsFeature.setApplying(running);
            },
            state: function () { return optionsFeature ? optionsFeature.state() : {}; }
        },
        popup: function (message) {
            const electron = require('electron');
            const owner = mainWindow();
            const options = { type: 'info', message: String(message) };
            return owner
                ? electron.dialog.showMessageBox(owner, options)
                : electron.dialog.showMessageBox(options);
        },
        // CmdSpecialHandler drives the Bot Manager's Misc 2 "Auto Zone" combo (#44) through the
        // handler panel, which the Maid window owns and which is built below. An accessor rather
        // than the panel itself for the same reason as `options` above: the engine is made first.
        specialHandler: function () { return zonePanel; },
        // The item and quest commands' own access (#39), built per window from the same game
        // access the session uses. The frames the drop and ghost-accept paths need are a raw send
        // through the relay, which is the same packet-send permission the packet tools hold.
        createGame: function () {
            return itemsModel.createAccess({
                loaderCall: gameAccess.loaderCall,
                call: gameAccess.call,
                sendFrame: function (direction, text) {
                    return host.packets.send({ direction: direction, text: text });
                },
                log: function (line) { host.log('bot: ' + line); }
            });
        },
        // The item and quest handlers (#39) are a second dispatch table: the engine's own table
        // wins where the two overlap, which the engine states and tests.
        handlers: itemsModel.handlers
    };
    const runtime = botRuntime.createRuntimeManager(runtimeDependencies);

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
        title: function () { return skin.title(); },
        isGameUrl: function (candidate) {
            return !!candidate && candidate === bridgeUrl(baseUrl);
        },
        // Nothing here needs the wmode=direct wrapper for relative loads: the bridge resolves
        // every game path from its own base URL, and the game is served from its own origin.
        wrap: { preferDirectWmode: true, ruffleEligible: false },
        flashTrust: true
    });

    windows.register(host, windowTitle);
    menus.register(host, windowTitle, {
        charSelectVisible: function () { return charSelectVisible; },
        characters: function () {
            const listed = loginFeature && loginFeature.list();
            return listed && Array.isArray(listed.characters) ? listed.characters : [];
        },
        openCharSelect: function () {
            return host.windows.openFeatureWindow(windows.LOGIN_WINDOW_ID);
        },
        selectCharacter: function (username) {
            if (!loginFeature || typeof loginFeature.handle !== 'function') {
                return host.windows.openFeatureWindow(windows.LOGIN_WINDOW_ID);
            }
            return Promise.resolve(loginFeature.handle('loginSignIn', [username])).then(function (answer) {
                if (!answer || !answer.signedIn) {
                    host.log('Char Select sign-in failed for ' + username + ': ' +
                        ((answer && answer.error) || 'no result'));
                }
                return answer;
            });
        }
    });
    keybinds.register(host);
    // The packet logger reads from the platform tap. Its embedded Spammer writes through
    // host.packets.send (packet-send); the tamperer also reads the tap and sends through packet-send.
    logger.createLoggerFeature(host).register();
    // Loaders and grabbers (#31): the reference's Tools -> Loaders/grabbers window. Its rows, its
    // menus and its four loaders are all main-process work, because the page is sandboxed.
    // The write half (#27): both windows send through host.packets.send (packet-send). The
    // spammer never reads, so it needs packet-tap for nothing; the tamperer reads through the same
    // tap the logger does, which is why it holds both permissions.
    spammerWindow.createFromHost(host).attach();
    tampererWindow.createFromHost(host).attach();
    // The Dev Test window's own IPC: the call modes and the bridge call, both main-process work
    // because the window is sandboxed.
    require('./features/devtest/devtest-main.js').register(host);

    // Char Select (#35): the session's credentials, the one-click sign-in and the window that
    // follows the connection. This plugin's window follows this plugin's game, so the list shows
    // itself while the session is down and hides itself while it is up (Flash.cs:400-409).
    let lastConnection = 'unknown';
    function applyCharSelectState(state) {
        const visible = state !== 'connected';
        if (state === 'connected') showLoginWindows(false);
        else if (state === 'lost' && lastConnection !== 'lost') {
            // The reference brings the list up on every drop, not only the first one.
            showLoginWindows(true);
        }
        const listed = loginFeature && loginFeature.list();
        const usernames = listed && Array.isArray(listed.characters)
            ? listed.characters.map(function (character) { return character.username; }).join('\0')
            : '';
        if (visible !== charSelectVisible || usernames !== charSelectNames) {
            charSelectVisible = visible;
            charSelectNames = usernames;
            refreshGameMenus();
        }
        lastConnection = state;
    }
    let charSelectNames = null;
    loginFeature = require('./features/login/login-main.js').createFromHost(host, {
        every: function (tick, ms) {
            const handle = setInterval(function () {
                Promise.resolve().then(tick).then(applyCharSelectState, function () {
                    applyCharSelectState('unknown');
                });
            }, ms);
            return handle;
        }
    });
    if (typeof loginFeature.attach === 'function') loginFeature.attach(host);
    if (typeof loginFeature.relogin === 'function') {
        runtimeDependencies.relogin = function (config) { return loginFeature.relogin(config); };
    }
    // Root_Load reads CharSelect.cfg once at startup (Root.cs:131-163). The credentials stay in
    // the session's memory; only the usernames become visible to the window.
    try {
        const credentials = fs.readFileSync(path.join(host.appDataDirectory, 'CharSelect.cfg'), 'utf8');
        loginFeature.store.adopt(require('./features/login/login-model.js').parseCredentialsFile(credentials));
    } catch (error) {
        // No user file is the ordinary case; nothing is created in its place.
    }

    // Bank (#29) draws its own window and reaches the game only through the injected game access
    // in bridge.js, which sits on this plugin's bridge channel (ticket #28).
    bankWindow.createFromHost(host).attach();
    const equipmentSets = require('./features/sets/sets-window.js').createFromHost(host);
    equipmentSets.attach();
    // The Bot Manager's main-process half: the sheet, the parsed document, the two dialogs and the
    // folder tree, all of which a sandboxed page cannot reach for itself.
    botManager = require('./features/bot-manager/bot-manager.js').createBotManager({
        host: host,
        // The engine (#37): the window's Enable Bot tick starts and stops this bot, and the window
        // reads its own running flag, pause and index back for its log. The bot's state is keyed by
        // the game window it drives, so a bot belongs to its game rather than to the button.
        runtime: runtime,
        windowKeyFor: gameWindowKey,
        store: host.getStore(require('./bot/display-settings.js').STORE_NAMESPACE),
        // The very settings instance the engine resolves paths with, so the directory this
        // window's tree shows and the directory a CmdLoadBot reads are one value.
        settings: botSettings,
        // The reference puts its Bots/ folder beside the executable (Application.StartupPath); here
        // that is the app's own data directory, beside the store the plugin already keeps there.
        defaultBotsDirectory: defaultBotsDirectory,
        message: function () { return host.getLocaleStrings('botManagerMessages') || {}; },
        showOpenDialog: function (owner, options) {
            return require('electron').dialog.showOpenDialog(owner, options);
        },
        // The controls that act on the running game read through the generic bridge surface. A
        // name the stock game does not have reports the helper it waits for instead of a value.
        bridge: host.bridge,
        loaderCall: gameAccess.loaderCall,
        // The Bot Manager's Client tab reads the game's own staff frames and the area packet.
        packets: host.packets,
        currentWindowKey: gameWindowKey,
        logDebug: function (line) { logs.append(line); },
        // The Bot Manager's quest whitelist button and its alignment packets need the same game
        // access and relay the bot engine uses; they are not generic dot-path reads.
        game: runtimeDependencies.createGame(),
        sendFrame: function (frame) { return host.packets.send(frame); },
        specialHandler: function () { return zonePanel; },
        options: {
            state: function () { return optionsFeature ? optionsFeature.state() : { applying: false }; },
            setApplying: function (running) {
                return optionsFeature
                    ? optionsFeature.setApplying(running)
                    : Promise.resolve({ ok: false, error: 'options are not ready' });
            },
            setToggle: function (id, on) {
                return optionsFeature
                    ? optionsFeature.setToggle(id, on)
                    : Promise.resolve({ ok: false, error: 'options are not ready' });
            },
            setWalkSpeed: function (value) {
                return optionsFeature
                    ? optionsFeature.setWalkSpeed(value)
                    : Promise.resolve({ ok: false, error: 'options are not ready' });
            },
            setTimer: function (ms) {
                return optionsFeature
                    ? optionsFeature.setTimer(ms)
                    : { ok: false, error: 'options are not ready' };
            },
            setRespawnProvoke: function (on) {
                return optionsFeature
                    ? optionsFeature.setRespawnProvoke(on)
                    : { ok: false, error: 'options are not ready' };
            }
        }
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
        log: function (msg) { host.log(msg); },
        onApplyingChanged: function (running) {
            if (botManager) botManager.optionsStateChanged(running);
        }
    });
    optionsFeature = optionsWindow.feature;

    // The reference's four app actions that move another live surface (Hotkeys.cs:34-124). The
    // windows they drive are built later in this activation, so each reads its holder at press
    // time rather than capturing null now.
    function toggleBot() {
        if (!botManager) return Promise.resolve({ ok: false, error: 'the Bot Manager is not ready' });
        const key = gameWindowKey();
        const running = !!(runtime.state(key) || {}).running;
        if (running) {
            return Promise.resolve(runtime.stop(key)).then(function (answer) {
                return { ok: true, stopped: true, error: (answer && answer.error) || null };
            });
        }
        return Promise.resolve(runtime.start(key, botManager.bot())).then(function (answer) {
            return Object.assign({}, answer, { ok: !!(answer && answer.ok) });
        });
    }

    function toggleAutoAttack() {
        if (!chrome) return Promise.resolve({ ok: false, error: 'the game chrome is not ready' });
        return chrome.toggleAutoAttack();
    }

    function toggleMaid() {
        if (!maid || !maid.maid) return { ok: false, error: 'the Maid window is not ready' };
        const on = !maid.maid.running();
        maid.maid.setEnabled(on);
        if (on) maid.maid.start();
        return { ok: true, enabled: on };
    }

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
        platform: {
            showMainWindow: showMainWindow,
            toggleMainWindow: toggleMainWindow,
            toggleBot: toggleBot,
            toggleAutoAttack: toggleAutoAttack,
            toggleMaid: toggleMaid,
            toggleLauncherSkin: function () { return skin.toggle(); }
        },
        // The reference loads hotkeys.json from Application.StartupPath; here that is the app's
        // data directory. The store is still the list this window saves.
        hotkeysFile: path.join(host.appDataDirectory, 'hotkeys.json'),
        gameCalls: gameCalls,
        options: optionsWindow.feature,
        log: function (msg) { host.log(msg); }
    });
    hotkeys.install();
    createHotkeysWindow({
        feature: hotkeys,
        messages: host.getLocaleStrings('hotkeysMessages') || {}
    }).attachTo(host);

    // The drop list (#33): the tap says what dropped, the bridge says whether it can be taken,
    // and the window is the user's hand on both. Its tap subscription is taken when the window
    // opens and released when it closes, so a list nobody is watching costs nothing.
    createDropWindow(host, {
        // The reference's own dialog text, so a translated build can carry its own.
        confirm: (function () {
            const strings = host.getLocaleStrings('dropsMessages') || {};
            return {
                title: strings.confirmTitle,
                message: strings.confirmMessage,
                yes: strings.confirmYes,
                no: strings.confirmNo
            };
        }())
    }).attach();

    // Fast travels and the map bypasser (#32): the reference's Tools -> Fast travels form. Every
    // game call goes through the plugin's own loader-name adapter (features/travel/game-access.js)
    // and the generic bridge callbacks underneath it, so nothing here touches Flash itself.
    createTravelWindow(host).attach();

    // The Maid (#43): the reference's party assistant. It runs its own scheduler beside the bot
    // engine, which is why it is handed the engine runtime's own per-window state rather than a
    // private copy of it: when both want the character at once the engine's current command wins,
    // and the collision is written to the log (grilling 11.10).
    //
    // Its party half reads the platform tap (#26), and it takes that subscription the way this app
    // requires one to be taken: nothing is subscribed at activation (test/unit/packet-logger.test.js
    // asserts that for the plugin as a whole). It follows while its own window is open, and while
    // the Maid is running, because the reference answers party chat with nobody watching its form.
    maid = maidWindow.createFromHost(host, {
        localShortcuts: localShortcuts(host),
        globalShortcuts: globalShortcuts(host),
        engineRunning: function () { return !!(runtime.state(gameWindowKey()) || {}).running; },
        engineActivity: function () {
            const state = runtime.state(gameWindowKey()) || {};
            return { count: state.commands, command: state.lastCommand };
        },
        pauseBotEngine: function (on) { return runtime.setPaused(gameWindowKey(), on); }
    });
    maid.attach();
    // The handlers the auto-zone combo switches on, handed to CmdSpecialHandler through the seam
    // the engine was given above. The Maid's own boxes (#44's five config keys) travel with it:
    // the phrase list and the per-boss mode are the form's, and the handlers read them live.
    zonePanel = maid.zones;

    host.registerLocales({
        'en-US': require('./locales/en-US.js')
    });

    // The in-game chrome strip (ticket #45): the reference's own toolbar above the Flash surface.
    // The platform owns the strip's box, its height and the window geometry that goes with it
    // (res/windows/game-chrome.js); what is declared here is the game-specific half - the six
    // controls, their words and what each one does - because the platform names no game.
    //
    // Start Bot runs the document the Bot Manager holds through the same per-window engine the Bot
    // Manager's own tick drives (#36), so the three refusals are the engine's own words (#37) and
    // the strip never re-implements a check the engine already makes.
    const autoAttackPresets = skillPresets.createPresetSource({
        appDataDirectory: host.appDataDirectory,
        store: host.getStore(skillPresets.STORE_NAMESPACE)
    });
    chrome = chromeFeature.createFromHost(host, {
        equipmentSets: equipmentSets,
        runtime: runtime,
        windowKey: gameWindowKey,
        bot: function () { return botManager.bot(); },
        editor: function () { return botManager.editorOptions(); },
        onEngineChange: function () { botManager.engineStateChanged(); },
        // Named Auto Attack presets, with ClientConfig.cfg as the read-only legacy source.
        presets: autoAttackPresets,
        // Read live: this plugin's catalog is merged into the platform's after activate().
        messages: function () { return host.getLocaleStrings('chromeMessages') || {}; },
        log: function (line) { host.log('chrome: ' + line); },
        openAutoSkillSet: function () {
            host.windows.openFeatureWindow(windows.AUTO_ATTACK_WINDOW_ID);
            return { ok: true, error: null };
        }
    });
    host.registerGameChrome({
        height: chromeFeature.HEIGHT,
        controls: function () { return chrome.controls(); },
        state: function () { return chrome.state(); },
        action: function (id, args) { return chrome.action(id, args); },
        menuLabel: function () { return (host.getLocaleStrings('chromeMessages') || {}).menu || 'Game chrome'; }
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
    autoAttackWindow.createFromHost(host, {
        presets: autoAttackPresets,
        className: function () {
            try {
                const entry = runtime.forWindow(gameWindowKey());
                const session = entry && entry.engine ? entry.engine.session : null;
                return session && typeof session.className === 'function'
                    ? Promise.resolve(session.className()).catch(function () { return ''; })
                    : '';
            } catch (error) {
                return '';
            }
        },
        onUse: function (text) {
            if (chrome) chrome.useSkillText(text);
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
    host.registerPacketSteering(require('./packets.js').steeringDeclarations(baseUrl)[0]);

    installTray(host);
    host.log('AquGrim activated; bridge at ' + (bridgeUrl(baseUrl) || '(no origin)'));
}

module.exports = {
    activate: activate
};
