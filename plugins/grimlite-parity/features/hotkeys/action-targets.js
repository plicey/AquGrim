// What each hotkey action reaches in THIS port. Reference: Grimoire/UI/Hotkeys.cs:34-124.
//
// Every one of the reference's twenty-three actions resolves to exactly one of three things:
//
//   a window      a feature window id, as this plugin registers it (windows.js and the feature
//                 tickets that add to it). The id is looked up against the plugin's own
//                 registration at press time, so an action whose window another ticket has not
//                 landed yet is inert instead of fatal.
//   a game call   the reference calls Flash directly (Cancel Target, the two shops).
//   the app       "Minimize to tray" and "Toggle Options" act on the app, not on a game or a
//                 window.
//
// An action with no entry here is one this port cannot do yet (the bot engine's Start/Stop, the
// Maid's, auto-attack, the launcher skin, the logs); pressing its key answers with that reason.

// Hotkeys.cs:408 has a "Show Bank" action and no action for any later window, so the Bank window
// is reachable from here and, say, Sets is not - that is the reference's own vocabulary.
const WINDOW_BY_ACTION = {
    'Show Bot': 'grimlite-parity-bot-manager',
    'Show Hotkeys': 'grimlite-parity-hotkeys',
    'Show Loaders': 'grimlite-parity-loaders',
    'Show Packet Logger': 'grimlite-parity-packet-logger',
    'Show Packet Spammer': 'grimlite-parity-packet-spammer',
    'Show Packet Tamperer': 'grimlite-parity-packet-tamperer',
    'Show Fast Travels': 'grimlite-parity-travels',
    'Show Maid': 'grimlite-parity-maid',
    'Show Bank': 'grimlite-parity-bank',
    'Show Cosmetics form': 'grimlite-parity-cosmetics',
    'Show Logs': 'grimlite-parity-logs',
    'Show Notepad': 'grimlite-parity-notepad',
    'Show DropUi': 'grimlite-parity-drop',
    'Show Swf Dev test': 'grimlite-parity-devtest'
};

// Actions that are the app's own business rather than a window's.
const APP_ACTIONS = {
    'Minimize to tray': 'showMainWindow',
    'Toggle Options': 'toggleOptions'
};

// The two shops and the target cancel: the reference calls Flash (Player.cs:328,
// Game/Data/Shop.cs:207,217). All three names are loader-only - checked by exact token match
// against the decompressed game SWF and the reference loader: the game carries no CancelTarget /
// LoadHairShop / LoadArmorCustomizer member, only the lowercase internals cancelTarget,
// sendLoadHairShopRequest and openArmorCustomize, which are different members with different
// signatures and which the reference never calls. Nothing here substitutes one for the other:
// the reference's own name is sent, and when the game says it has no such member, game-calls.js
// runs the loader body that name stands for through the generic callbacks.
const GAME_ACTIONS = {
    'Cancel Target': { call: 'CancelTarget', args: [] },
    'Load Hair shop': { call: 'LoadHairShop', args: ['1'] },
    'Load Armor Customizer': { call: 'LoadArmorCustomizer', args: [] }
};

module.exports = {
    WINDOW_BY_ACTION: WINDOW_BY_ACTION,
    APP_ACTIONS: APP_ACTIONS,
    GAME_ACTIONS: GAME_ACTIONS
};
