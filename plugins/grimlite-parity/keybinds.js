const windows = require('./windows.js');

// Grimlite ships no hotkeys of its own: Hotkeys.cs starts from an empty hotkeys.json and the
// user's own file is the whole set. The platform still has its own defaults, and the menu and
// keybind actions below stay registered so a user can assign them without this plugin taking a
// key by default.
const DEFAULTS = {
    grimliteMaidUnfollow: 'Alt+Shift+U',
    grimliteMaidStopAttack: 'Alt+Shift+X'
};

function register(host) {
    host.registerKeybindDefaults(DEFAULTS);
    host.registerKeybinds([
        {
            id: 'grimliteEyedropper',
            action: function () {
                host.windows.openFeatureWindow(windows.EYEDROPPER_WINDOW_ID);
            }
        },
        {
            id: 'grimliteNotepad',
            action: function () {
                host.windows.openFeatureWindow(windows.NOTEPAD_WINDOW_ID);
            }
        },
        {
            id: 'grimliteAbout',
            action: function () {
                host.windows.openFeatureWindow(windows.ABOUT_WINDOW_ID);
            }
        },
        {
            id: 'grimliteBotManager',
            action: function () {
                host.windows.openFeatureWindow(windows.BOT_MANAGER_WINDOW_ID);
            }
        },
        {
            id: 'grimliteParityDevTest',
            action: function () {
                host.windows.openFeatureWindow(windows.DEVTEST_WINDOW_ID);
            }
        },
        {
            // The reference's own hotkey action list has "Show Bank" (Hotkeys.cs:408) and no
            // Sets action at all, so Bank is bindable and Sets is a menu entry only.
            id: 'grimliteBank',
            action: function () {
                host.windows.openFeatureWindow(windows.BANK_WINDOW_ID);
            }
        },
        {
            // The reference's own action list, index 3: "Show Loaders".
            id: 'grimliteLoaders',
            action: function () {
                host.windows.openFeatureWindow(windows.LOADERS_WINDOW_ID);
            }
        },
        {
            id: 'grimliteCosmetics',
            action: function () {
                host.windows.openFeatureWindow(windows.COSMETICS_WINDOW_ID);
            }
        },
        {
            id: 'grimliteOptions',
            action: function () {
                host.windows.openFeatureWindow(windows.OPTIONS_WINDOW_ID);
            }
        },
        {
            id: 'grimliteHotkeys',
            action: function () {
                host.windows.openFeatureWindow(windows.HOTKEYS_WINDOW_ID);
            }
        },
        {
            // The reference's own action list, index 20: "Show DropUi".
            id: 'grimliteDrop',
            action: function () {
                host.windows.openFeatureWindow(windows.DROP_WINDOW_ID);
            }
        },
        {
            id: 'grimliteFastTravels',
            action: function () {
                host.windows.openFeatureWindow(windows.TRAVEL_WINDOW_ID);
            }
        },
        {
            // The reference's own action list, in its own words: "Show Maid" (Hotkeys.cs:411).
            id: 'grimliteMaid',
            action: function () {
                host.windows.openFeatureWindow(windows.MAID_WINDOW_ID);
            }
        }
    ]);
}

module.exports = {
    register: register,
    DEFAULTS: DEFAULTS
};
