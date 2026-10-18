// Feature windows of the parity plugin. The platform only knows how to open a registered
// feature window; sizes, preloads and pages are this plugin's business.

const path = require('path');
const url = require('url');

const featureRoot = path.join(__dirname, 'features');
const PLACEHOLDER_PAGE = path.join(featureRoot, 'placeholder', 'placeholder.html');
const PLACEHOLDER_WINDOW_ID = 'grimlite-parity-placeholder';

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
            webPreferences: {
                nodeIntegration: false,
                sandbox: true,
                webviewTag: false,
                plugins: false,
                contextIsolation: true
            }
        }
    }]);
}

module.exports = {
    register: register,
    PLACEHOLDER_PAGE: PLACEHOLDER_PAGE,
    PLACEHOLDER_WINDOW_ID: PLACEHOLDER_WINDOW_ID
};
