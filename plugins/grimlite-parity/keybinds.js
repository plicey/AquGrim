const windows = require('./windows.js');

const DEFAULTS = {
    grimliteParityPlaceholder: 'Alt+Shift+G',
    grimliteEyedropper: 'Alt+Shift+E',
    grimliteNotepad: 'Alt+Shift+N',
    grimliteAbout: 'Alt+Shift+A'
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
        }
    ]);
}

module.exports = {
    register: register,
    DEFAULTS: DEFAULTS
};
