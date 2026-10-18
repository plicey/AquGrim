// Grimlite-Li parity, scaffold stage: the plugin exists, loads, and is selectable in
// Settings. Nothing game-specific is wired yet - the primary surface is a local page so
// the app has something to open while the game access below is still uninhabited.

const url = require('url');

const menus = require('./menus.js');
const keybinds = require('./keybinds.js');
const windows = require('./windows.js');
const logger = require('./features/packets/logger.js');

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
    // The packet logger is this plugin's reading half of the platform tap: it subscribes, and
    // never writes a frame (that needs packet-send, which only the spammer and tamperer hold).
    logger.createLoggerFeature(host).register();

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
