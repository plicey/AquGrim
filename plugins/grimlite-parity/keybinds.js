const windows = require('./windows.js');

const DEFAULTS = {
    grimliteParityPlaceholder: 'Alt+Shift+G'
};

function register(host) {
    host.registerKeybindDefaults(DEFAULTS);
    host.registerKeybinds([{
        id: 'grimliteParityPlaceholder',
        action: function () {
            host.windows.openFeatureWindow(windows.PLACEHOLDER_WINDOW_ID);
        }
    }]);
}

module.exports = {
    register: register,
    DEFAULTS: DEFAULTS
};
