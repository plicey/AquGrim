// The app's two shortcut layers, in one place. The platform's own keys (res/keybindings.js) and
// the bundled plugin's app-wide bindings (the Hotkeys window's Minimize to tray) have to agree
// about what "app-wide" means on this session.
//
// electron-localshortcut fires while one of this app's windows has focus; Electron's
// globalShortcut fires wherever the user is. On Wayland the global hook goes through the
// GlobalShortcuts portal, which asks the user to approve every shortcut - and on desktops that do
// not serve the portal, Electron accepts the registration and then never delivers the key.
// App-window shortcuts already reach the focused game, so a Wayland session gets the focus-scoped
// layer in place of the app-wide one. That is the nearest equivalent this app can offer, and the
// platform's own F2/Ctrl+J already work that way.

/** Whether this session has to use the focus-scoped layer for app-wide shortcuts. */
function shouldUseLocalGlobalShortcuts(env, platform) {
    const variables = env || process.env;
    const name = platform || process.platform;
    return name === 'linux' && variables.XDG_SESSION_TYPE === 'wayland';
}

const usesLocalGlobalShortcuts = shouldUseLocalGlobalShortcuts();

/**
 * electron-localshortcut registered on every app window: a key fires while one of them has focus.
 * Both factories answer whether the registration took; the local layer returns true when the
 * library's own register() answers nothing, which is how this Electron reports success.
 */
function createLocalLayer(deps) {
    const options = deps || {};
    const shortcuts = options.localShortcuts || require('electron-localshortcut');
    return {
        kind: 'local',
        focusScoped: true,
        register: function (accelerator, handler) {
            try {
                return shortcuts.register(accelerator, handler) !== false;
            } catch (error) {
                return false;
            }
        },
        unregister: function (accelerator) {
            try {
                shortcuts.unregister(accelerator);
            } catch (error) {
                // A key that was never registered is not a failure.
            }
        }
    };
}

/**
 * The app-wide layer, or the focus-scoped one where the app-wide hook cannot be delivered (see
 * above). `focusScoped` says which one the caller got, so a window can say so in its log.
 */
function createGlobalLayer(deps) {
    const options = deps || {};
    const focusScoped = options.focusScoped === undefined
        ? usesLocalGlobalShortcuts
        : options.focusScoped === true;
    if (focusScoped) {
        const layer = createLocalLayer(options);
        layer.kind = 'global';
        return layer;
    }
    const electron = options.electron || require('electron');
    const shortcuts = options.globalShortcuts || electron.globalShortcut;
    return {
        kind: 'global',
        focusScoped: false,
        register: function (accelerator, handler) {
            try {
                return shortcuts.register(accelerator, handler);
            } catch (error) {
                return false;
            }
        },
        unregister: function (accelerator) {
            try {
                shortcuts.unregister(accelerator);
            } catch (error) {
                // A key that was never registered is not a failure.
            }
        }
    };
}

module.exports = {
    shouldUseLocalGlobalShortcuts: shouldUseLocalGlobalShortcuts,
    usesLocalGlobalShortcuts: usesLocalGlobalShortcuts,
    createLocalLayer: createLocalLayer,
    createGlobalLayer: createGlobalLayer
};
