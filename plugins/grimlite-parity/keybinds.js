const windows = require('./windows.js');

const DEFAULTS = {
    grimliteParityPlaceholder: 'Alt+Shift+G',
    grimliteBotFile: 'Alt+Shift+B',
    grimliteBotManager: 'Alt+Shift+M',
    grimliteEyedropper: 'Alt+Shift+E',
    grimliteNotepad: 'Alt+Shift+N',
    grimliteAbout: 'Alt+Shift+A',
    // The reference ships its hotkeys EMPTY (Grimoire/UI/Root.cs only loads them from a user
    // config), so every default here is this port's own choice; H was already taken by the
    // Hotkeys window (#34), so Char Select keeps the family's next free letter.
    grimliteCharSelect: 'Alt+Shift+S',
    grimliteParityDevTest: 'Alt+Shift+D',
    grimliteBank: 'Alt+Shift+K',
    // The reference's own action list carries "Show Loaders" (Hotkeys.cs:398); this port gives
    // it a default on a key no other binding of the app's or the plugin's own uses.
    grimliteLoaders: 'Alt+Shift+L',
    // The reference's own action list carries "Show Cosmetics form" (Hotkeys.cs:409). Its
    // bindings ship empty and its picker takes one key; this port gives the window a default on
    // a key no binding of the app's or the game plugin's own uses.
    grimliteCosmetics: 'Alt+Shift+C',
    // The reference's Options menu and Hotkeys window are menu entries upstream with no shortcut
    // of their own; this port gives each a key on the Alt+Shift family it already uses, so nothing
    // the app or the game plugin holds is taken. Not K: that is this plugin's own Bank entry.
    grimliteOptions: 'Alt+Shift+O',
    grimliteHotkeys: 'Alt+Shift+H',
    // The reference's own "Show DropUi" action (Hotkeys.cs:415). Not I: the platform already
    // holds Alt+Shift+I (res/keybindings.js:187).
    grimliteDrop: 'Alt+Shift+P',
    // The reference's own action list carries "Show Fast Travels" (Hotkeys.cs:402). Alt+Shift+T
    // takes nothing: the app holds no plain Alt+T and the game plugin's own reminders entry is
    // Alt+T, which this family leaves alone.
    grimliteFastTravels: 'Alt+Shift+T'
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
            // The reference's own action list has no Char Select entry: its char list is a menu,
            // not a hotkey (Hotkeys.cs has no Char Select action). This port gives the window a
            // default on a key no binding of the app's or the game plugin's own uses.
            id: 'grimliteCharSelect',
            action: function () {
                host.windows.openFeatureWindow(windows.LOGIN_WINDOW_ID);
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
        }
    ]);
}

module.exports = {
    register: register,
    DEFAULTS: DEFAULTS
};
