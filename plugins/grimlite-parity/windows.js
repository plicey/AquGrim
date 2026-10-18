// Feature windows of the parity plugin. The platform only knows how to open a registered
// feature window; sizes, preloads and pages are this plugin's business.

const path = require('path');
const url = require('url');

const featureRoot = path.join(__dirname, 'features');
const PLACEHOLDER_PAGE = path.join(featureRoot, 'placeholder', 'placeholder.html');
const PLACEHOLDER_WINDOW_ID = 'grimlite-parity-placeholder';
const BOT_FILE_PAGE = path.join(featureRoot, 'bot-file', 'bot-file.html');
const BOT_FILE_PRELOAD = path.join(featureRoot, 'bot-file', 'preload_bot_file.js');
const BOT_FILE_WINDOW_ID = 'grimlite-parity-bot-file';
const BANK_PAGE = path.join(featureRoot, 'bank', 'bank.html');
const BANK_PRELOAD = path.join(featureRoot, 'bank', 'preload_bank.js');
const BANK_WINDOW_ID = 'grimlite-parity-bank';
const SETS_PAGE = path.join(featureRoot, 'sets', 'sets.html');
const SETS_PRELOAD = path.join(featureRoot, 'sets', 'preload_sets.js');
const SETS_WINDOW_ID = 'grimlite-parity-sets';

function register(host, windowTitle) {
    host.registerFeatureWindows([
    {
        id: BANK_WINDOW_ID,
        title: function () {
            return windowTitle('bank', 'Grimlite Parity - Bank');
        },
        url: url.pathToFileURL(BANK_PAGE).href,
        config: {
            // The reference's Bank form is a small 194x151 client area; the app's own font needs
            // a little more room, so it opens a little larger and stays a small window.
            width: 320,
            height: 300,
            useContentSize: true,
            icon: host.getAppIconPath(),
            webPreferences: {
                nodeIntegration: false,
                sandbox: true,
                webviewTag: false,
                plugins: false,
                contextIsolation: true,
                preload: BANK_PRELOAD
            }
        }
    },
    {
        id: SETS_WINDOW_ID,
        title: function () {
            return windowTitle('sets', 'Grimlite Parity - Set');
        },
        url: url.pathToFileURL(SETS_PAGE).href,
        config: {
            width: 700,
            height: 420,
            useContentSize: true,
            resizable: true,
            icon: host.getAppIconPath(),
            webPreferences: {
                nodeIntegration: false,
                sandbox: true,
                webviewTag: false,
                plugins: false,
                contextIsolation: true,
                preload: SETS_PRELOAD
            }
        }
    },
    {
        id: BOT_FILE_WINDOW_ID,
        title: function () {
            return windowTitle('botFile', 'Grimlite Parity - Bot File');
        },
        url: url.pathToFileURL(BOT_FILE_PAGE).href,
        config: {
            width: 760,
            height: 620,
            useContentSize: true,
            resizable: true,
            icon: host.getAppIconPath(),
            webPreferences: {
                nodeIntegration: false,
                sandbox: true,
                webviewTag: false,
                plugins: false,
                contextIsolation: true,
                preload: BOT_FILE_PRELOAD
            }
        }
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
    }
    ]);
}

module.exports = {
    register: register,
    PLACEHOLDER_PAGE: PLACEHOLDER_PAGE,
    PLACEHOLDER_WINDOW_ID: PLACEHOLDER_WINDOW_ID,
    BOT_FILE_PAGE: BOT_FILE_PAGE,
    BOT_FILE_PRELOAD: BOT_FILE_PRELOAD,
    BOT_FILE_WINDOW_ID: BOT_FILE_WINDOW_ID,
    BANK_PAGE: BANK_PAGE,
    BANK_PRELOAD: BANK_PRELOAD,
    BANK_WINDOW_ID: BANK_WINDOW_ID,
    SETS_PAGE: SETS_PAGE,
    SETS_PRELOAD: SETS_PRELOAD,
    SETS_WINDOW_ID: SETS_WINDOW_ID
};
