// Grimlite-Li parity, scaffold stage: the plugin exists, loads, and is selectable in
// Settings. Nothing game-specific is wired yet - the primary surface is a local page so
// the app has something to open while the game access below is still uninhabited.

const url = require('url');

const menus = require('./menus.js');
const keybinds = require('./keybinds.js');
const windows = require('./windows.js');
const botFile = require('./features/bot-file/bot-file.js');
const bankWindow = require('./features/bank/bank-window.js');
const setsWindow = require('./features/sets/sets-window.js');

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

    // Bot files are user documents: this window opens one from the user's own directory, shows
    // it and writes the edit back through the same dialog.
    botFile.createBotFileFeature(host).attach();

    // Bank and Sets (#29). Both draw their own window and reach the game only through the
    // injected game access in bridge.js, which is unwired until ticket #28 lands - until then
    // each transfer reports why rather than pretending to have moved anything.
    bankWindow.createFromHost(host).attach();
    setsWindow.createFromHost(host).attach();

    host.registerLocales({
        'en-US': require('./locales/en-US.js')
    });

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

    host.log('Grimlite Parity plugin activated (scaffold: placeholder surface only)');
}

module.exports = {
    activate: activate
};
