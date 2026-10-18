const path = require('path');
const url = require('url');

const featureRoot = path.join(__dirname, 'features');
const PLACEHOLDER_PAGE = path.join(featureRoot, 'placeholder', 'placeholder.html');
const PLACEHOLDER_WINDOW_ID = 'grimlite-parity-placeholder';
const BOT_FILE_PAGE = path.join(featureRoot, 'bot-file', 'bot-file.html');
const BOT_FILE_PRELOAD = path.join(featureRoot, 'bot-file', 'preload_bot_file.js');
const BOT_FILE_WINDOW_ID = 'grimlite-parity-bot-file';
const NOTEPAD_WINDOW_ID = 'grimlite-parity-notepad';
const EYEDROPPER_WINDOW_ID = 'grimlite-parity-eyedropper';
const ABOUT_WINDOW_ID = 'grimlite-parity-about';
const DEVTEST_PAGE = path.join(featureRoot, 'devtest', 'devtest.html');
const DEVTEST_WINDOW_ID = 'grimlite-parity-devtest';

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
    DEVTEST_PAGE: DEVTEST_PAGE,
    DEVTEST_WINDOW_ID: DEVTEST_WINDOW_ID,
    NOTEPAD_WINDOW_ID: NOTEPAD_WINDOW_ID,
    EYEDROPPER_WINDOW_ID: EYEDROPPER_WINDOW_ID,
    ABOUT_WINDOW_ID: ABOUT_WINDOW_ID
};
