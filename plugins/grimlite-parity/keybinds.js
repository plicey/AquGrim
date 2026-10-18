const windows = require('./windows.js');

const DEFAULTS = {
    grimliteParityPlaceholder: 'Alt+Shift+G',
    grimliteBotFile: 'Alt+Shift+B',
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
        id: 'grimliteBotFile',
        action: function () {
            host.windows.openFeatureWindow(windows.BOT_FILE_WINDOW_ID);
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
