const windows = require('./windows.js');

function register(host, windowTitle) {
    host.registerMenus(function (ctx) {
        const labels = (ctx && ctx.labels) || {};
        const keybinds = (ctx && ctx.keybinds) || {};
        return [{
            label: labels.grimliteMenu || 'Grimlite',
            submenu: [{
                label: labels.grimliteBotFile || 'Bot file',
                accelerator: keybinds.grimliteBotFile,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.BOT_FILE_WINDOW_ID);
                }
            }, {
                // The reference's own order on the Tools menu: Bank, then the Sets form it keeps
                // hidden (Root.cs:820-831). Hidden there or not, the form is reachable, so it
                // ships as a normal entry here.
                label: labels.grimliteBank || 'Bank',
                accelerator: keybinds.grimliteBank,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.BANK_WINDOW_ID);
                }
            }, {
                label: labels.grimliteSets || 'Sets',
                click: function () {
                    host.windows.openFeatureWindow(windows.SETS_WINDOW_ID);
                }
            }, {
                label: labels.grimlitePlaceholder || 'Parity placeholder window',
                accelerator: keybinds.grimliteParityPlaceholder,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.PLACEHOLDER_WINDOW_ID);
                }
            }]
        }];
    });
}

module.exports = {
    register: register,
    PLACEHOLDER_WINDOW_ID: windows.PLACEHOLDER_WINDOW_ID
};
