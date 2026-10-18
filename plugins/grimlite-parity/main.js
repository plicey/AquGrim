// Grimlite-Li parity. The plugin exists, loads, and is selectable in Settings; the primary
// surface is a local page until the bridge ticket (#28) gives the game something to drive.
// The small surfacing windows (Notepad, Eye Dropper, About) are the windows that need no
// game state, so they land first.

const path = require('path');
const url = require('url');

const menus = require('./menus.js');
const keybinds = require('./keybinds.js');
const windows = require('./windows.js');

const resRoot = path.join(__dirname, '..', '..', 'res');

const createNotepad = require('./features/notepad/notepad.js').createNotepad;
const createEyedropper = require('./features/eyedropper/eyedropper.js').createEyedropper;
const createAbout = require('./features/about/about.js').createAbout;

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

    // The three windows: each owns its own main-process module (a page plus a sandbox-safe
    // preload), so a window only ever registers the IPC it uses.
    const messages = function (namespace) {
        return host.getLocaleStrings(namespace) || {};
    };
    createEyedropper({
        getMessages: function () { return messages('eyedropperMessages'); }
    }).register(host);
    createNotepad({
        getMessages: function () { return messages('notepadMessages'); }
    }).register(host);
    createAbout({
        appVersion: host.appVersion,
        getMessages: function () { return messages('aboutMessages'); },
        // "the game movie" is whatever the platform calls this plugin's game window right now,
        // cached per window when it was opened (res/instances.js).
        isGameUrl: function (candidate) {
            try {
                return require(path.join(resRoot, 'platform')).pluginRuntime.isGameUrl(candidate);
            } catch (error) {
                return false;
            }
        }
    }).register(host);

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
