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
            submenu: [
                // Bot file first: it is the window that works on a document of the user's own,
                // like the reference's Bot Manager.
                {
                    label: labels.grimliteBotFile || 'Bot file',
                    accelerator: keybinds.grimliteBotFile,
                    registerAccelerator: false,
                    click: function () {
                        host.windows.openFeatureWindow(windows.BOT_FILE_WINDOW_ID);
                    }
                },
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
                },
                {
                    // The reference keeps this under Tools -> Swf Dev Test (Grimlite/UI/Root.cs).
                    label: labels.grimliteDevTest || 'Dev Test',
                    accelerator: keybinds.grimliteParityDevTest,
                    registerAccelerator: false,
                    click: function () {
                        host.windows.openFeatureWindow(windows.DEVTEST_WINDOW_ID);
                    }
                },
                // The reference's own Tools-menu words and order: Bank, then the Sets form it
                // keeps hidden (Root.cs:820-831). Hidden there or not, the form is reachable,
                // so it ships as a normal entry here.
                {
                    label: labels.grimliteBank || 'Bank',
                    accelerator: keybinds.grimliteBank,
                    registerAccelerator: false,
                    click: function () {
                        host.windows.openFeatureWindow(windows.BANK_WINDOW_ID);
                    }
                },
                {
                    label: labels.grimliteSets || 'Sets',
                    click: function () {
                        host.windows.openFeatureWindow(windows.SETS_WINDOW_ID);
                    }
                }
            ]
        }];
    });
}

module.exports = {
    register: register,
    PLACEHOLDER_WINDOW_ID: windows.PLACEHOLDER_WINDOW_ID,
    LOGGER_WINDOW_ID: windows.LOGGER_WINDOW_ID
};
