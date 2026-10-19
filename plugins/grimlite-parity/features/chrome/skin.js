// Change Launcher Skin, the reference's hotkey action (Hotkeys.cs:98-101 -> Root.cs:1750-1766).
// It swaps the title for Artix Game Launcher, hides the menu bar and the toolbar above the game,
// and swaps back on the next press. This port has no alternate icon set, so the icon stays as it
// is; the title, menu and chrome strip are the visible skin.

const LAUNCHER_TITLE = 'Artix Game Launcher';

function createLauncherSkin(deps) {
    deps = deps || {};
    const getWindow = deps.getWindow || function () { return null; };
    const title = deps.title || function () { return 'AquaStar - Grimlite Parity'; };
    const chrome = deps.chrome || function () {};
    let launcher = false;

    function currentTitle() {
        return launcher ? LAUNCHER_TITLE : title();
    }

    function apply(win) {
        win.setTitle(currentTitle());
        if (typeof win.setMenuBarVisibility === 'function') {
            win.setMenuBarVisibility(!launcher);
        }
        chrome(win, !launcher);
    }

    return {
        title: currentTitle,
        launcher: function () { return launcher; },
        toggle: function () {
            const win = getWindow();
            if (!win || (win.isDestroyed && win.isDestroyed())) {
                return { ok: false, error: 'the game window is not open' };
            }
            launcher = !launcher;
            apply(win);
            return { ok: true, launcher: launcher, title: currentTitle() };
        }
    };
}

module.exports = {
    createLauncherSkin: createLauncherSkin,
    LAUNCHER_TITLE: LAUNCHER_TITLE
};
