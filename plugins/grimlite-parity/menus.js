const windows = require('./windows.js');

function register(host, windowTitle) {
    host.registerMenus(function (ctx) {
        const labels = (ctx && ctx.labels) || {};
        const keybinds = (ctx && ctx.keybinds) || {};
        return [{
            label: labels.grimliteMenu || 'Grimlite',
            submenu: [
                // Eye Dropper above Notepad, as Root.cs orders its Tools menu.
                {
                    label: labels.grimliteEyedropper || 'Eye Dropper',
                    accelerator: keybinds.grimliteEyedropper,
                    registerAccelerator: false,
                    click: function () {
                        host.windows.openFeatureWindow(windows.EYEDROPPER_WINDOW_ID);
                    }
                },
                {
                    label: labels.grimliteNotepad || 'Notepad',
                    accelerator: keybinds.grimliteNotepad,
                    registerAccelerator: false,
                    click: function () {
                        host.windows.openFeatureWindow(windows.NOTEPAD_WINDOW_ID);
                    }
                },
                { type: 'separator' },
                {
                    label: labels.grimliteAbout || 'About',
                    accelerator: keybinds.grimliteAbout,
                    registerAccelerator: false,
                    click: function () {
                        host.windows.openFeatureWindow(windows.ABOUT_WINDOW_ID);
                    }
                },
                {
                    label: labels.grimlitePlaceholder || 'Parity placeholder window',
                    accelerator: keybinds.grimliteParityPlaceholder,
                    registerAccelerator: false,
                    click: function () {
                        host.windows.openFeatureWindow(windows.PLACEHOLDER_WINDOW_ID);
                    }
                }
            ]
        }];
    });
}

module.exports = {
    register: register,
    PLACEHOLDER_WINDOW_ID: windows.PLACEHOLDER_WINDOW_ID
};
