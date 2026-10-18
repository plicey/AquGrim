// Feature windows of the parity plugin. The platform only knows how to open a registered
// feature window; sizes, preloads and pages are this plugin's business.

const path = require('path');
const url = require('url');

const featureRoot = path.join(__dirname, 'features');
const PLACEHOLDER_PAGE = path.join(featureRoot, 'placeholder', 'placeholder.html');
const PLACEHOLDER_WINDOW_ID = 'grimlite-parity-placeholder';
const LOGGER_PAGE = path.join(featureRoot, 'packets', 'logger.html');
const LOGGER_PRELOAD = path.join(featureRoot, 'packets', 'preload_logger.js');
const LOGGER_WINDOW_ID = 'grimlite-parity-packet-logger';

// Feature windows that show the game's traffic are plain HTML: no Flash, no plugin content.
const PLAIN_WINDOW = {
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    plugins: false,
    contextIsolation: true
};

function register(host, windowTitle) {
    host.registerFeatureWindows([{
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
            webPreferences: Object.assign({}, PLAIN_WINDOW)
        }
    }, {
        id: LOGGER_WINDOW_ID,
        title: function () {
            return windowTitle('packetLogger', 'Packet logger');
        },
        url: url.pathToFileURL(LOGGER_PAGE).href,
        config: {
            width: 620,
            height: 520,
            useContentSize: true,
            resizable: true,
            icon: host.getAppIconPath(),
            webPreferences: Object.assign({}, PLAIN_WINDOW, { preload: LOGGER_PRELOAD })
        }
    }]);
}

module.exports = {
    register: register,
    PLACEHOLDER_PAGE: PLACEHOLDER_PAGE,
    PLACEHOLDER_WINDOW_ID: PLACEHOLDER_WINDOW_ID,
    LOGGER_PAGE: LOGGER_PAGE,
    LOGGER_WINDOW_ID: LOGGER_WINDOW_ID,
    PLAIN_WINDOW: PLAIN_WINDOW
};
