const windows = require('./windows.js');

function register(host, windowTitle) {
    host.registerMenus(function (ctx) {
        const labels = (ctx && ctx.labels) || {};
        const keybinds = (ctx && ctx.keybinds) || {};
        return [{
            label: labels.grimliteMenu || 'Grimlite',
            submenu: [{
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
