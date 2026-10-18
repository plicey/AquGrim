// Feature windows of the parity plugin. The platform only knows how to open a registered
// feature window; sizes, preloads and pages are this plugin's business.

const path = require('path');
const url = require('url');

const featureRoot = path.join(__dirname, 'features');
const PLACEHOLDER_PAGE = path.join(featureRoot, 'placeholder', 'placeholder.html');
const PLACEHOLDER_WINDOW_ID = 'grimlite-parity-placeholder';
const DEVTEST_PAGE = path.join(featureRoot, 'devtest', 'devtest.html');
const DEVTEST_WINDOW_ID = 'grimlite-parity-devtest';

function register(host, windowTitle) {
    // Same conventions as the platform's own feature windows: sandboxed, no Flash (the window
    // only talks to the bridge, which runs in the game window), isolated, one preload each.
    function featureWindow(id, page, preload, titleKey, fallback, size) {
        const webPreferences = {
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
            plugins: false,
            contextIsolation: true
        };
        if (preload) webPreferences.preload = path.join(featureRoot, preload);
        return {
            id: id,
            title: function () { return windowTitle(titleKey, fallback); },
            url: url.pathToFileURL(page).href,
            config: {
                width: size[0],
                height: size[1],
                useContentSize: true,
                resizable: true,
                icon: host.getAppIconPath(),
                webPreferences: webPreferences
            }
        };
    }

    host.registerFeatureWindows([
        featureWindow(PLACEHOLDER_WINDOW_ID, PLACEHOLDER_PAGE, null,
            'placeholder', 'Grimlite Parity - Placeholder', [560, 460]),
        featureWindow(DEVTEST_WINDOW_ID, DEVTEST_PAGE, 'devtest/preload_devtest.js',
            'devtest', 'Dev Test', [400, 560])
    ]);
}

module.exports = {
    register: register,
    PLACEHOLDER_PAGE: PLACEHOLDER_PAGE,
    PLACEHOLDER_WINDOW_ID: PLACEHOLDER_WINDOW_ID,
    DEVTEST_PAGE: DEVTEST_PAGE,
    DEVTEST_WINDOW_ID: DEVTEST_WINDOW_ID
};
