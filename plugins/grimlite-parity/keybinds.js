const windows = require('./windows.js');

const DEFAULTS = {
    grimliteParityPlaceholder: 'Alt+Shift+G',
    grimliteBotFile: 'Alt+Shift+B',
    grimliteEyedropper: 'Alt+Shift+E',
    grimliteNotepad: 'Alt+Shift+N',
    grimliteAbout: 'Alt+Shift+A',
    grimliteParityDevTest: 'Alt+Shift+D',
    // The reference's own hotkey action list has "Show Bank" (Hotkeys.cs:408) and no Sets
    // action at all, so Bank is bindable and Sets is a menu entry only.
    grimliteBank: 'Alt+Shift+K'
};

function register(host) {
    host.registerKeybindDefaults(DEFAULTS);
    host.registerKeybinds([{
        id: 'grimliteParityPlaceholder',
        action: function () {
            host.windows.openFeatureWindow(windows.PLACEHOLDER_WINDOW_ID);
        }
    }, {
        id: 'grimliteEyedropper',
        action: function () {
            host.windows.openFeatureWindow(windows.EYEDROPPER_WINDOW_ID);
        }
    }, {
        id: 'grimliteNotepad',
        action: function () {
            host.windows.openFeatureWindow(windows.NOTEPAD_WINDOW_ID);
        }
    }, {
        id: 'grimliteAbout',
        action: function () {
            host.windows.openFeatureWindow(windows.ABOUT_WINDOW_ID);
        }
    }, {
        id: 'grimliteBotFile',
        action: function () {
            host.windows.openFeatureWindow(windows.BOT_FILE_WINDOW_ID);
        }
    }, {
        id: 'grimliteParityDevTest',
        action: function () {
            host.windows.openFeatureWindow(windows.DEVTEST_WINDOW_ID);
        }
    }, {
        id: 'grimliteBank',
        action: function () {
            host.windows.openFeatureWindow(windows.BANK_WINDOW_ID);
        }
    }]);
}

module.exports = {
    register: register,
    DEFAULTS: DEFAULTS
};
