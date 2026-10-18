const windows = require('./windows.js');

const DEFAULTS = {
    grimliteParityPlaceholder: 'Alt+Shift+G',
    grimliteBotFile: 'Alt+Shift+B',
    grimliteBotManager: 'Alt+Shift+M',
    grimliteEyedropper: 'Alt+Shift+E',
    grimliteNotepad: 'Alt+Shift+N',
    grimliteAbout: 'Alt+Shift+A',
    grimliteParityDevTest: 'Alt+Shift+D',
    grimliteBank: 'Alt+Shift+K',
    // The reference's own action list carries "Show Loaders" (Hotkeys.cs:398); this port gives
    // it a default on a key no other binding of the app's or the plugin's own uses.
    grimliteLoaders: 'Alt+Shift+L',
    // The reference's own action list carries "Show Cosmetics form" (Hotkeys.cs:409). Its
    // bindings ship empty and its picker takes one key; this port gives the window a default on
    // a key no binding of the app's or the game plugin's own uses.
    grimliteCosmetics: 'Alt+Shift+C'
};

function register(host) {
    host.registerKeybindDefaults(DEFAULTS);
    host.registerKeybinds([
        {
            id: 'grimliteParityPlaceholder',
            action: function () {
                host.windows.openFeatureWindow(windows.PLACEHOLDER_WINDOW_ID);
            }
        },
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
            id: 'grimliteBotFile',
            action: function () {
                host.windows.openFeatureWindow(windows.BOT_FILE_WINDOW_ID);
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
        }
    ]);
}

module.exports = {
    register: register,
    DEFAULTS: DEFAULTS
};
