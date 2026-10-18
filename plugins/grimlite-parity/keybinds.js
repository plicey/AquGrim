const windows = require('./windows.js');

const DEFAULTS = {
    grimliteParityPlaceholder: 'Alt+Shift+G',
    grimliteBotFile: 'Alt+Shift+B'
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
    }]);
}

module.exports = {
    register: register,
    DEFAULTS: DEFAULTS
};
