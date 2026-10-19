const windows = require('./windows.js');

// The reference's own menu bar (Root.cs:717-725): Bot, Tools, Packets, Options, Maid, Plugins,
// About, Char Select. The platform already owns a Tools menu, so the reference's Tools entries
// stay together under this plugin's own Grimlite menu rather than duplicating that label.
function register(host, windowTitle, deps) {
    deps = deps || {};
    host.registerMenus(function (ctx) {
        const labels = (ctx && ctx.labels) || {};
        const keybinds = (ctx && ctx.keybinds) || {};
        const visible = typeof deps.charSelectVisible === 'function'
            ? deps.charSelectVisible()
            : true;

        const menus = [{
            // Root.cs:329-332: the whole Bot menu opens BotManager.Instance.
            label: labels.grimliteBot || 'Bot',
            click: function () {
                host.windows.openFeatureWindow(windows.BOT_MANAGER_WINDOW_ID);
            }
        }, {
            // The reference's own navigation: Packets -> Sniffer, Spammer, Tamperer, in the order
            // Root.cs adds them. (Root.cs also adds an Interceptor, hidden upstream and unshipped.)
            label: labels.packetsMenu || 'Packets',
            submenu: [{
                label: labels.packetsSniffer || 'Sniffer',
                click: function () {
                    host.windows.openFeatureWindow(windows.LOGGER_WINDOW_ID);
                }
            }, {
                label: labels.packetsSpammer || 'Spammer',
                click: function () {
                    host.windows.openFeatureWindow(windows.SPAMMER_WINDOW_ID);
                }
            }, {
                label: labels.packetsTamperer || 'Tamperer',
                click: function () {
                    host.windows.openFeatureWindow(windows.TAMPERER_WINDOW_ID);
                }
            }]
        }, {
            // Root.cs:983-996 ships the seven toggles as an Options menu. This port draws them in
            // a window, which the reference's own menu entry opens instead.
            label: labels.grimliteOptions || 'Options',
            click: function () {
                host.windows.openFeatureWindow(windows.OPTIONS_WINDOW_ID);
            }
        }, {
            // Root.cs:1119-1127: the Maid is a top-level menu item.
            label: labels.grimliteMaid || 'Maid',
            click: function () {
                host.windows.openFeatureWindow(windows.MAID_WINDOW_ID);
            }
        }, {
            // Root.cs:1146-1152: About is its own top-level entry.
            label: labels.grimliteAbout || 'About',
            click: function () {
                host.windows.openFeatureWindow(windows.ABOUT_WINDOW_ID);
            }
        }];

        // Root.cs:167 hides the Char Select menu while the connection is up and shows it again on
        // every drop. The menu contributor is rebuilt from this live answer.
        if (visible) {
            const characters = typeof deps.characters === 'function' ? deps.characters() : [];
            const charSelectItems = (Array.isArray(characters) ? characters : []).map(function (character) {
                const username = typeof character === 'string' ? character :
                    (character && character.username);
                if (!username) return null;
                return {
                    label: String(username),
                    click: function () {
                        return typeof deps.selectCharacter === 'function'
                            ? deps.selectCharacter(String(username))
                            : host.windows.openFeatureWindow(windows.LOGIN_WINDOW_ID);
                    }
                };
            }).filter(Boolean);
            if (charSelectItems.length) charSelectItems.push({ type: 'separator' });
            charSelectItems.push({
                label: labels.grimliteCharSelectManage || 'Manage characters...',
                click: function () {
                    return typeof deps.openCharSelect === 'function'
                        ? deps.openCharSelect()
                        : host.windows.openFeatureWindow(windows.LOGIN_WINDOW_ID);
                }
            });
            menus.push({
                label: labels.grimliteCharSelect || 'Char Select',
                submenu: charSelectItems,
                click: function () {
                    return typeof deps.openCharSelect === 'function'
                        ? deps.openCharSelect()
                        : host.windows.openFeatureWindow(windows.LOGIN_WINDOW_ID);
                }
            });
        }

        // The reference's Tools entries, in their own order (Root.cs:747-763). The hidden Sets
        // entry and the extra Bot file window are deliberately absent; Logs is the reference's
        // own Tools -> Logs. Hotkeys remains here because the reference keeps it under Tools.
        menus.push({
            label: labels.grimliteMenu || 'Grimlite',
            submenu: [{
                label: labels.grimliteTravels || 'Fast travels',
                accelerator: keybinds.grimliteFastTravels,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.TRAVEL_WINDOW_ID);
                }
            }, {
                label: labels.grimliteLoaders || 'Loaders/grabbers',
                accelerator: keybinds.grimliteLoaders,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.LOADERS_WINDOW_ID);
                }
            }, {
                label: labels.grimliteHotkeys || 'Hotkeys',
                accelerator: keybinds.grimliteHotkeys,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.HOTKEYS_WINDOW_ID);
                }
            }, {
                label: labels.grimliteCosmetics || 'Cosmetics',
                accelerator: keybinds.grimliteCosmetics,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.COSMETICS_WINDOW_ID);
                }
            }, {
                label: labels.grimliteBank || 'Bank',
                accelerator: keybinds.grimliteBank,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.BANK_WINDOW_ID);
                }
            }, {
                label: labels.grimliteEyedropper || 'Eye Dropper',
                accelerator: keybinds.grimliteEyedropper,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.EYEDROPPER_WINDOW_ID);
                }
            }, {
                // Root.cs:843-850: Tools -> Logs, which opens LogForm.
                label: labels.grimliteLogs || 'Logs',
                accelerator: keybinds.grimliteLogs,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.LOGS_WINDOW_ID);
                }
            }, {
                label: labels.grimliteNotepad || 'Notepad',
                accelerator: keybinds.grimliteNotepad,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.NOTEPAD_WINDOW_ID);
                }
            }, {
                // Root.cs:927: the last visible Tools entry upstream.
                label: labels.grimliteDevTest || 'Swf Dev Test',
                accelerator: keybinds.grimliteParityDevTest,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.DEVTEST_WINDOW_ID);
                }
            }, {
                label: labels.grimliteDrop || 'Drop Ui',
                accelerator: keybinds.grimliteDrop,
                registerAccelerator: false,
                click: function () {
                    host.windows.openFeatureWindow(windows.DROP_WINDOW_ID);
                }
            }]
        });

        return menus;
    });
}

module.exports = {
    register: register,
    LOGGER_WINDOW_ID: windows.LOGGER_WINDOW_ID,
    SPAMMER_WINDOW_ID: windows.SPAMMER_WINDOW_ID,
    TAMPERER_WINDOW_ID: windows.TAMPERER_WINDOW_ID,
    TRAVEL_WINDOW_ID: windows.TRAVEL_WINDOW_ID,
    MAID_WINDOW_ID: windows.MAID_WINDOW_ID,
    LOGS_WINDOW_ID: windows.LOGS_WINDOW_ID
};
