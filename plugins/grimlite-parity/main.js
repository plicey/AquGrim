// Grimlite-Li parity. The plugin boots the game through its own loopback origin and loads the
// bridge SWF there: page, bridge and game share one origin, which is what lets the bridge put the
// game's classes in its own ApplicationDomain (docs/research/grimlite-bridge-spike.md).
//
// Same-origin is not an optimization. PPAPI Flash inside Chromium grants no local-trusted
// sandbox, so a bridge that loads the game cross-origin is denied every domain access. That is
// why the game is served from loopback here rather than from game.aq.com: a live game URL would
// mean a game with no bridge at all, so this plugin refuses to open one instead.

const gameOrigin = require('./game-origin.js');
const menus = require('./menus.js');
const keybinds = require('./keybinds.js');
const windows = require('./windows.js');

const BRIDGE_TITLE = 'AquaStar - Grimlite Parity';

/** The bridge SWF as the origin serves it, or '' when the origin is not up. */
function bridgeUrl(baseUrl) {
    return baseUrl ? baseUrl + gameOrigin.BRIDGE_PATH : '';
}

async function activate(host) {
    function windowTitle(key, fallback) {
        const titles = host.getLocaleStrings('windowTitles') || {};
        return titles[key] || fallback;
    }

    let baseUrl = '';
    try {
        baseUrl = await host.declareGameOrigin({
            routes: gameOrigin.routes(),
            files: gameOrigin.files(),
            // The plugin's hosts see loopback URLs, its UA policy matches the live ones.
            userAgent: gameOrigin.userAgent
        });
        host.log('game origin: ' + baseUrl);
    } catch (err) {
        host.log('game origin unavailable (' + (err && err.message ? err.message : err) +
            '): the bridge needs the game and itself on one origin, so no game window is opened');
    }

    host.setPrimaryGame({
        id: 'grimlite-parity-shell',
        // The bridge SWF is the movie the window loads; it owns the game's load from there.
        getUrl: function () { return bridgeUrl(baseUrl); },
        title: function () { return windowTitle('primary', BRIDGE_TITLE); },
        isGameUrl: function (candidate) {
            return !!candidate && candidate === bridgeUrl(baseUrl);
        },
        // Nothing here needs the wmode=direct wrapper for relative loads: the bridge resolves
        // every game path from its own base URL, and the game is served from its own origin.
        wrap: { preferDirectWmode: true, ruffleEligible: false },
        flashTrust: true
    });

    windows.register(host, windowTitle);
    menus.register(host, windowTitle);
    keybinds.register(host);

    // The Dev Test window's own IPC: the call modes and the bridge call, both main-process work
    // because the window is sandboxed.
    require('./features/devtest/devtest-main.js').register(host);

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

    host.log('Grimlite Parity activated; bridge at ' + (bridgeUrl(baseUrl) || '(no origin)'));
}

module.exports = {
    activate: activate
};
