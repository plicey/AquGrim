const windows = require('./windows.js');

// The reference's own navigation: Packets -> Sniffer opens the logger. The spammer and tamperer
// join this submenu with their own tickets.
function register(host, windowTitle) {
    host.registerMenus(function (ctx) {
        const labels = (ctx && ctx.labels) || {};
        const keybinds = (ctx && ctx.keybinds) || {};
        return [{
            label: labels.packetsMenu || 'Packets',
            submenu: [{
                label: labels.packetsSniffer || 'Sniffer',
                click: function () {
                    host.windows.openFeatureWindow(windows.LOGGER_WINDOW_ID);
                }
            }]
        }, {
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
    PLACEHOLDER_WINDOW_ID: windows.PLACEHOLDER_WINDOW_ID,
    LOGGER_WINDOW_ID: windows.LOGGER_WINDOW_ID
};
