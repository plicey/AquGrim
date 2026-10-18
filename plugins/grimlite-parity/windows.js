const path = require('path');
const url = require('url');

const featureRoot = path.join(__dirname, 'features');
const PLACEHOLDER_PAGE = path.join(featureRoot, 'placeholder', 'placeholder.html');
const PLACEHOLDER_WINDOW_ID = 'grimlite-parity-placeholder';
const BOT_FILE_PAGE = path.join(featureRoot, 'bot-file', 'bot-file.html');
const BOT_FILE_PRELOAD = path.join(featureRoot, 'bot-file', 'preload_bot_file.js');
const BOT_FILE_WINDOW_ID = 'grimlite-parity-bot-file';
const BANK_WINDOW_ID = 'grimlite-parity-bank';
const SETS_WINDOW_ID = 'grimlite-parity-sets';
const LOGIN_WINDOW_ID = 'grimlite-parity-char-select';
const NOTEPAD_WINDOW_ID = 'grimlite-parity-notepad';
const EYEDROPPER_WINDOW_ID = 'grimlite-parity-eyedropper';
const ABOUT_WINDOW_ID = 'grimlite-parity-about';
const DEVTEST_PAGE = path.join(featureRoot, 'devtest', 'devtest.html');
const DEVTEST_WINDOW_ID = 'grimlite-parity-devtest';
const COSMETICS_WINDOW_ID = 'grimlite-parity-cosmetics';
const LOGGER_WINDOW_ID = 'grimlite-parity-packet-logger';
const LOADERS_WINDOW_ID = 'grimlite-parity-loaders';
const SPAMMER_WINDOW_ID = 'grimlite-parity-packet-spammer';
const TAMPERER_WINDOW_ID = 'grimlite-parity-packet-tamperer';
const BOT_MANAGER_WINDOW_ID = 'grimlite-parity-bot-manager';
const OPTIONS_WINDOW_ID = 'grimlite-parity-options';
const HOTKEYS_WINDOW_ID = 'grimlite-parity-hotkeys';
const DROP_WINDOW_ID = 'grimlite-parity-drop';
// The id the Hotkeys window's own "Show Fast Travels" action already names
// (features/hotkeys/action-targets.js), so that action is inert only until this window registers.
const TRAVEL_WINDOW_ID = 'grimlite-parity-travels';

// Every one of these is a page inside this plugin: no Flash, no Node in the page, and IPC
// through its own sandbox-safe preload (docs/PLUGINS.md §4.7/§4.8).
function windowConfig(host, featureDir, preloadFile, size) {
    return {
        width: size.width,
        height: size.height,
        useContentSize: true,
        resizable: true,
        icon: host.getAppIconPath(),
        webPreferences: {
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
            preload: path.join(featureRoot, featureDir, preloadFile),
            plugins: false,
            contextIsolation: true
        }
    };
}

function pageUrl(featureDir, file) {
    return url.pathToFileURL(path.join(featureRoot, featureDir, file)).href;
}

function register(host, windowTitle) {
    host.registerFeatureWindows([
        {
            id: BOT_FILE_WINDOW_ID,
            title: function () {
                return windowTitle('botFile', 'Grimlite Parity - Bot File');
            },
            url: url.pathToFileURL(BOT_FILE_PAGE).href,
            config: windowConfig(host, 'bot-file', 'preload_bot_file.js', { width: 760, height: 620 })
        },
        {
            id: BANK_WINDOW_ID,
            title: function () {
                return windowTitle('bank', 'Grimlite Parity - Bank');
            },
            url: pageUrl('bank', 'bank.html'),
            // The reference's Bank form is a 194x151 client area; the app's own font needs a
            // little more room, so it opens a little larger and stays the smallest of these.
            config: windowConfig(host, 'bank', 'preload_bank.js', { width: 320, height: 300 })
        },
        {
            id: SETS_WINDOW_ID,
            title: function () {
                return windowTitle('sets', 'Grimlite Parity - Set');
            },
            url: pageUrl('sets', 'sets.html'),
            config: windowConfig(host, 'sets', 'preload_sets.js', { width: 700, height: 420 })
        },
        {
            id: PLACEHOLDER_WINDOW_ID,
            title: function () {
                return windowTitle('placeholder', 'Grimlite Parity - Placeholder');
            },
            url: url.pathToFileURL(PLACEHOLDER_PAGE).href,
            config: {
                width: 560,
                height: 460,
                useContentSize: true,
                resizable: true,
                icon: host.getAppIconPath(),
                webPreferences: {
                    nodeIntegration: false,
                    sandbox: true,
                    webviewTag: false,
                    plugins: false,
                    contextIsolation: true
                }
            }
        },
        {
            id: DEVTEST_WINDOW_ID,
            title: function () {
                return windowTitle('devtest', 'Dev Test');
            },
            url: url.pathToFileURL(DEVTEST_PAGE).href,
            config: windowConfig(host, 'devtest', 'preload_devtest.js', { width: 400, height: 560 })
        },
        {
            id: COSMETICS_WINDOW_ID,
            title: function () {
                return windowTitle('cosmetics', 'Grimlite Parity - SWF Cosmetics');
            },
            url: pageUrl('cosmetics', 'cosmetics.html'),
            // The reference's form is a 533x473 client area; the grid the port draws needs a
            // little more width for the full item names its boxes carry.
            config: windowConfig(host, 'cosmetics', 'preload_cosmetics.js', { width: 620, height: 620 })
        },
        {
            id: EYEDROPPER_WINDOW_ID,
            title: function () {
                return windowTitle('eyedropper', 'Grimlite Parity - Eye Dropper');
            },
            url: pageUrl('eyedropper', 'eyedropper.html'),
            config: windowConfig(host, 'eyedropper', 'preload_eyedropper.js', { width: 420, height: 480 })
        },
        {
            id: NOTEPAD_WINDOW_ID,
            title: function () {
                return windowTitle('notepad', 'Grimlite Parity - Notepad');
            },
            url: pageUrl('notepad', 'notepad.html'),
            config: windowConfig(host, 'notepad', 'preload_notepad.js', { width: 560, height: 420 })
        },
        {
            id: ABOUT_WINDOW_ID,
            title: function () {
                return windowTitle('about', 'Grimlite Parity - About');
            },
            url: pageUrl('about', 'about.html'),
            config: windowConfig(host, 'about', 'preload_about.js', { width: 520, height: 560 })
        },
        {
            // The reference's Char Select is a top-level menu whose items are the saved usernames
            // (Root.cs:1150-1152); a menu cannot say where the credentials are held or offer a
            // removal, so criterion 4 and the Remove half of criterion 5 get a window.
            id: LOGIN_WINDOW_ID,
            title: function () {
                return windowTitle('charSelect', 'Grimlite Parity - Char Select');
            },
            url: pageUrl('login', 'login.html'),
            config: windowConfig(host, 'login', 'preload_login.js', { width: 460, height: 480 })
        },
        {
            id: LOGGER_WINDOW_ID,
            title: function () {
                return windowTitle('packetLogger', 'Packet logger');
            },
            url: pageUrl('packets', 'logger.html'),
            config: windowConfig(host, 'packets', 'preload_logger.js', { width: 620, height: 520 })
        },
        {
            id: LOADERS_WINDOW_ID,
            title: function () {
                return windowTitle('loaders', 'Grimlite Parity - Loaders and grabbers');
            },
            url: pageUrl('loaders', 'loaders.html'),
            // The reference's own client size for Loaders.cs, which is a small tool window.
            config: windowConfig(host, 'loaders', 'preload_loaders.js', { width: 271, height: 367 })
        },
        {
            // PacketSpammer.Designer.cs is 348x242: a short list, a text box and the nine controls.
            id: SPAMMER_WINDOW_ID,
            title: function () {
                return windowTitle('packetSpammer', 'Packet spammer');
            },
            url: pageUrl('packets', 'spammer.html'),
            config: windowConfig(host, 'packets', 'preload_spammer.js', { width: 420, height: 400 })
        },
        {
            // PacketTamperer.Designer.cs is 561x492: two rich boxes, the four buttons and the filter.
            id: TAMPERER_WINDOW_ID,
            title: function () {
                return windowTitle('packetTamperer', 'Packet Tamperer');
            },
            url: pageUrl('packets', 'tamperer.html'),
            config: windowConfig(host, 'packets', 'preload_tamperer.js', { width: 640, height: 520 })
        },
        {
            // The editor: the reference's own window is the widest of them, because the eleven tabs
            // and the six lists share the form (BotManager.Designer.cs is 1004x631).
            id: BOT_MANAGER_WINDOW_ID,
            title: function () {
                return windowTitle('botManager', 'Bot Manager');
            },
            url: pageUrl('bot-manager', 'bot-manager.html'),
            config: windowConfig(host, 'bot-manager', 'preload_bot_manager.js', { width: 1004, height: 640 })
        },
        {
            // The reference has no Options form - its seven toggles are a menu (Root.cs:983-996) -
            // so this is the window the port puts them in, in the menu's own order.
            id: OPTIONS_WINDOW_ID,
            title: function () {
                return windowTitle('options', 'Options');
            },
            url: pageUrl('options', 'options.html'),
            config: windowConfig(host, 'options', 'preload_options.js', { width: 380, height: 380 })
        },
        {
            // Hotkeys.cs's own client area is 303x306 and its form is FixedSingle.
            id: HOTKEYS_WINDOW_ID,
            title: function () {
                return windowTitle('hotkeys', 'Hotkeys');
            },
            url: pageUrl('hotkeys', 'hotkeys.html'),
            config: windowConfig(host, 'hotkeys', 'preload_hotkeys.js', { width: 320, height: 330 })
        },
        {
            // DropUi.Designer.cs's own client area is 401x300; the reference asks for 401
            // width through ClientSize, which useContentSize makes the room the page gets.
            id: DROP_WINDOW_ID,
            title: function () {
                return windowTitle('drop', 'DropList');
            },
            url: pageUrl('drops', 'drops.html'),
            config: windowConfig(host, 'drops', 'preload_drops.js', { width: 401, height: 300 })
        },
        {
            // Travel.cs's own client area is 359x411; the port's page draws its two columns with
            // the app's font, so it opens a little wider than the reference's form.
            id: TRAVEL_WINDOW_ID,
            title: function () {
                return windowTitle('travels', 'Fast travels');
            },
            url: pageUrl('travel', 'travel.html'),
            config: windowConfig(host, 'travel', 'preload_travel.js', { width: 430, height: 470 })
        }
    ]);
}

module.exports = {
    register: register,
    // Every id this file registers, so a caller that has to look one up (the Hotkeys window's
    // action targets) reads the same list the registration uses instead of a second copy.
    WINDOW_IDS: [
        PLACEHOLDER_WINDOW_ID,
        BOT_FILE_WINDOW_ID,
        BANK_WINDOW_ID,
        SETS_WINDOW_ID,
        DEVTEST_WINDOW_ID,
        COSMETICS_WINDOW_ID,
        NOTEPAD_WINDOW_ID,
        EYEDROPPER_WINDOW_ID,
        ABOUT_WINDOW_ID,
        LOGGER_WINDOW_ID,
        LOADERS_WINDOW_ID,
        SPAMMER_WINDOW_ID,
        TAMPERER_WINDOW_ID,
        BOT_MANAGER_WINDOW_ID,
        OPTIONS_WINDOW_ID,
        HOTKEYS_WINDOW_ID,
        DROP_WINDOW_ID,
        TRAVEL_WINDOW_ID
    ],
    PLACEHOLDER_PAGE: PLACEHOLDER_PAGE,
    PLACEHOLDER_WINDOW_ID: PLACEHOLDER_WINDOW_ID,
    BOT_FILE_PAGE: BOT_FILE_PAGE,
    BOT_FILE_PRELOAD: BOT_FILE_PRELOAD,
    BOT_FILE_WINDOW_ID: BOT_FILE_WINDOW_ID,
    BANK_WINDOW_ID: BANK_WINDOW_ID,
    SETS_WINDOW_ID: SETS_WINDOW_ID,
    LOGIN_WINDOW_ID: LOGIN_WINDOW_ID,
    DEVTEST_PAGE: DEVTEST_PAGE,
    DEVTEST_WINDOW_ID: DEVTEST_WINDOW_ID,
    COSMETICS_WINDOW_ID: COSMETICS_WINDOW_ID,
    NOTEPAD_WINDOW_ID: NOTEPAD_WINDOW_ID,
    EYEDROPPER_WINDOW_ID: EYEDROPPER_WINDOW_ID,
    ABOUT_WINDOW_ID: ABOUT_WINDOW_ID,
    LOGGER_WINDOW_ID: LOGGER_WINDOW_ID,
    LOADERS_WINDOW_ID: LOADERS_WINDOW_ID,
    SPAMMER_WINDOW_ID: SPAMMER_WINDOW_ID,
    TAMPERER_WINDOW_ID: TAMPERER_WINDOW_ID,
    BOT_MANAGER_WINDOW_ID: BOT_MANAGER_WINDOW_ID,
    OPTIONS_WINDOW_ID: OPTIONS_WINDOW_ID,
    HOTKEYS_WINDOW_ID: HOTKEYS_WINDOW_ID,
    DROP_WINDOW_ID: DROP_WINDOW_ID,
    TRAVEL_WINDOW_ID: TRAVEL_WINDOW_ID
};
