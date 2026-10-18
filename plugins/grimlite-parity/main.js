// Grimlite-Li parity, scaffold stage: the plugin exists, loads, and is selectable in
// Settings. Nothing game-specific is wired yet - the primary surface is a local page so
// the app has something to open while the game access below is still uninhabited.

const url = require('url');

const menus = require('./menus.js');
const keybinds = require('./keybinds.js');
const windows = require('./windows.js');

function activate(host) {
    const placeholderUrl = url.pathToFileURL(windows.PLACEHOLDER_PAGE).href;

    function windowTitle(key, fallback) {
        const titles = host.getLocaleStrings('windowTitles') || {};
        return titles[key] || fallback;
    }

    host.setPrimaryGame({
        id: 'grimlite-parity-shell',
        getUrl: function () { return placeholderUrl; },
        title: function () { return windowTitle('primary', 'AquaStar - Grimlite Parity'); },
        isGameUrl: function (candidate) { return candidate === placeholderUrl; }
    });

    windows.register(host, windowTitle);
    menus.register(host, windowTitle);
    keybinds.register(host);

    host.registerLocales({
        'en-US': require('./locales/en-US.js')
    });

    host.log('Grimlite Parity plugin activated (scaffold: placeholder surface only)');
}

module.exports = {
    activate: activate
};
