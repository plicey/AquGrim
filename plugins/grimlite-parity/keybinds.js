const windows = require('./windows.js');

const DEFAULTS = {
    grimliteParityPlaceholder: 'Alt+Shift+G',
    grimliteBotFile: 'Alt+Shift+B',
    grimliteBotManager: 'Alt+Shift+M',
    grimliteEyedropper: 'Alt+Shift+E',
    grimliteNotepad: 'Alt+Shift+N',
    grimliteAbout: 'Alt+Shift+A',
    grimliteParityDevTest: 'Alt+Shift+D'
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
        }
    ]);
}

module.exports = {
    register: register,
    DEFAULTS: DEFAULTS
};
