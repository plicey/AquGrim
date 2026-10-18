// Feature windows of the parity plugin. The platform only knows how to open a registered
// feature window; sizes, preloads and pages are this plugin's business.

const path = require('path');
const url = require('url');

const featureRoot = path.join(__dirname, 'features');
const PLACEHOLDER_PAGE = path.join(featureRoot, 'placeholder', 'placeholder.html');
const PLACEHOLDER_WINDOW_ID = 'grimlite-parity-placeholder';

const NOTEPAD_WINDOW_ID = 'grimlite-parity-notepad';
const EYEDROPPER_WINDOW_ID = 'grimlite-parity-eyedropper';
const ABOUT_WINDOW_ID = 'grimlite-parity-about';

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
    NOTEPAD_WINDOW_ID: NOTEPAD_WINDOW_ID,
    EYEDROPPER_WINDOW_ID: EYEDROPPER_WINDOW_ID,
    ABOUT_WINDOW_ID: ABOUT_WINDOW_ID
};
