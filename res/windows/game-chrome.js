// The game window's chrome strip (ticket #45, platform half).
//
// The strip is HTML above the Flash surface, inside the wrapper page the game SWF is loaded
// through (res/swf_wrapper.html): the wrapper already sizes the surface to whatever the page
// gives it, so this is a layout change and not a second window or a second compositing layer
// over a wmode=direct surface.
//
// What the platform owns is the geometry: how tall the strip is, what the window's content size
// is with it up and without it, what region a screenshot captures, and how the page is told to
// draw it. The controls themselves are the active plugin's data, handed over through the Host
// (registerGameChrome), because this platform names no game.

/**
 * The region a screenshot of a window captures: everything below the strip. With no strip up it
 * is the whole content area, which is what the screenshot path assumed before this ticket.
 * @param {number[]|{width: number, height: number}} size Electron's getContentSize, or the same
 *        numbers
 * @param {number} strip the strip's height, 0 when there is none
 */
function captureRect(size, strip) {
    const width = Number(size && (size.width !== undefined ? size.width : size[0])) || 0;
    const height = Number(size && (size.height !== undefined ? size.height : size[1])) || 0;
    const top = Math.max(0, Math.min(Number(strip) || 0, height));
    return { x: 0, y: top, width: width, height: Math.max(0, height - top) };
}

/**
 * @param {object} deps
 * @param {() => object|null} deps.declaration the active plugin's chrome declaration, or null
 * @param {() => {width: number, height: number}} deps.plain the game's own content size
 * @param {(win: object, size: {width: number, height: number}) => void} deps.resize
 * @param {(win: object, view: object) => void} deps.notify
 */
function createGameChrome(deps) {
    deps = deps || {};
    const resize = deps.resize || function (win, size) { win.setContentSize(size.width, size.height); };
    const notify = deps.notify || function (win, view) {
        if (win && win.webContents && !win.webContents.isDestroyed()) {
            win.webContents.send('gameChromeView', view);
        }
    };

    function declared() {
        try {
            return (typeof deps.declaration === 'function' ? deps.declaration() : null) || null;
        } catch (error) {
            // A plugin that went away must not take a window down with it: no strip is the
            // honest answer, and the game surface fills the window as it did before this ticket.
            return null;
        }
    }

    function plain() {
        const size = deps.plain ? deps.plain() : { width: 0, height: 0 };
        return { width: Number(size.width) || 0, height: Number(size.height) || 0 };
    }

    /** The strip's own height, 0 when no plugin asked for one. */
    function height() {
        const declaration = declared();
        const asked = declaration ? Number(declaration.height) : 0;
        return isFinite(asked) && asked > 0 ? Math.round(asked) : 0;
    }

    function available() {
        return !!declared() && height() > 0;
    }

    /**
     * Whether this window is showing the strip. Three things have to hold: the active plugin
     * declared one, this window's page is the wrapper a strip can be drawn in (res/instances.js
     * marks it), and the window has not been toggled off. The state is kept on the window itself,
     * so two game windows cannot move each other's layout and a closed window takes its own state
     * with it; a window nothing has toggled yet shows the strip, which is the plugin's default.
     *
     * A caller that passes no window gets no: there is no layout to describe yet, and answering
     * "enabled" for one would have a caller size something for a strip it cannot show.
     */
    function isEnabled(win) {
        if (!available() || !win) return false;
        // Only a window res/instances.js marked as the wrapper's own host may carry a strip. A
        // plugin's feature windows are built straight from BrowserWindow and never pass through
        // there, so they carry no marker: reading that as "a strip until told otherwise" would
        // hand every one of them a 27 px capture cut (the screenshot path runs on the focused
        // window, whichever it is).
        if (win.aquaStarChromeHost !== true) return false;
        return win.aquaStarChromeEnabled !== false;
    }

    /** How much of this window's content area the strip occupies right now. */
    function stripHeight(win) {
        return isEnabled(win) ? height() : 0;
    }

    /** This window's content size at the moment it is asked for: plain size plus the strip. */
    function contentSize(win) {
        const size = plain();
        return { width: size.width, height: size.height + stripHeight(win) };
    }

    /** The controls, as the plugin declares them now (its labels follow the merged locale). */
    function controls() {
        const declaration = declared();
        if (!declaration || typeof declaration.controls !== 'function') return [];
        const list = declaration.controls() || [];
        return list.map(function (control) {
            return { id: control.id, kind: control.kind, label: control.label };
        });
    }

    /** Everything the page needs to draw the strip, including the plugin's live values. */
    function pageView(win) {
        const view = {
            enabled: isEnabled(win),
            height: height(),
            controls: controls(),
            values: {},
            options: {}
        };
        const declaration = declared();
        if (!available() || !declaration || typeof declaration.state !== 'function') {
            return Promise.resolve(view);
        }
        return Promise.resolve()
            .then(function () { return declaration.state({ win: win }); })
            .then(function (state) {
                state = state || {};
                view.values = state.values || {};
                view.options = state.options || {};
                return view;
            }, function (error) {
                // A state read that refused is a strip with its boxes empty, never a window
                // without one: the reason is reported beside the values it could not fill.
                view.error = (error && error.message) || String(error);
                return view;
            });
    }

    /**
     * Show or hide the strip and move the window to match, keeping the game surface's own size:
     * off is the plain content size this app's screenshot and recording paths assume, on is the
     * size the window had while the strip was last up.
     * @returns {{enabled: boolean, height: number}}
     */
    function setEnabled(win, enabled) {
        // Nothing to show, or a page that cannot draw one: the answer describes this window's
        // layout, which is a strip of no height rather than the height the plugin asked for.
        if (!available() || !win || win.aquaStarChromeHost !== true) {
            return { enabled: false, height: 0 };
        }
        const on = !!enabled;
        const current = win.getContentSize();
        if (on) {
            win.aquaStarChromeEnabled = true;
            resize(win, win.aquaStarChromeSize ||
                { width: plain().width, height: plain().height + height() });
        } else {
            // Remember only a size that was the striped one: toggling off twice must not record
            // the plain size as the striped size and shrink the window on the way back.
            if (win.aquaStarChromeEnabled !== false) {
                win.aquaStarChromeSize = { width: current[0], height: current[1] };
            }
            win.aquaStarChromeEnabled = false;
            resize(win, plain());
        }
        const view = pageView(win);
        Promise.resolve(view).then(function (drawn) { notify(win, drawn); });
        return { enabled: on, height: height() };
    }

    /**
     * The game menu's entry for this window: a checkbox whose tick is the layout itself, so a
     * toggle from the menu and a toggle from anywhere else read back the same way.
     * @returns {object|null} an Electron menu item, or null when there is no strip to toggle
     */
    function menuItem(opts) {
        opts = opts || {};
        if (!available()) return null;
        // A window whose page has no strip element in it gets no entry either: a checkbox that
        // toggles nothing is worse than no checkbox, and the label would be about a layout this
        // window cannot have.
        if (!opts.win || opts.win.aquaStarChromeHost !== true) return null;
        const declaration = declared();
        const label = typeof declaration.menuLabel === 'function'
            ? declaration.menuLabel()
            : null;
        if (!label) return null;
        return {
            label: label,
            type: 'checkbox',
            checked: isEnabled(opts.win),
            click: function (item, focusedWin) {
                // The window the entry was built for, not whichever one has focus: a menu click
                // carries the focused window, and with two game windows open that is not
                // necessarily the one whose menu this is.
                setEnabled(opts.win || focusedWin, item ? item.checked !== false : false);
            }
        };
    }

    /**
     * Run one of the plugin's controls for the window that asked. Never throws: a control whose
     * action refused reports the reason, and the page redraws from the view beside it.
     */
    function dispatch(win, id, args) {
        const declaration = declared();
        if (!available() || !declaration || typeof declaration.action !== 'function') {
            return Promise.resolve({ ok: false, error: null, view: null });
        }
        return Promise.resolve()
            .then(function () { return declaration.action(String(id), args || {}, { win: win }); })
            .then(function (result) {
                return pageView(win).then(function (view) {
                    return {
                        ok: !!(result && result.ok),
                        error: (result && result.error) || null,
                        view: view
                    };
                });
            }, function (error) {
                return pageView(win).then(function (view) {
                    return { ok: false, error: (error && error.message) || String(error), view: view };
                });
            });
    }

    return {
        available: available,
        height: height,
        controls: controls,
        isEnabled: isEnabled,
        stripHeight: stripHeight,
        contentSize: contentSize,
        pageView: pageView,
        setEnabled: setEnabled,
        menuItem: menuItem,
        dispatch: dispatch
    };
}

// The one instance the platform itself uses. Built on first use, because the plugin runtime and
// the window configs are only meaningful inside the app.
let instance = null;

function gameChrome() {
    if (instance) return instance;
    instance = createGameChrome({
        declaration: function () {
            try {
                return require('../platform').pluginRuntime.getGameChrome();
            } catch (error) {
                return null;
            }
        },
        plain: function () { return require('./config.js').gameContentSize; },
        resize: function (win, size) { win.setContentSize(size.width, size.height); },
        notify: function (win, view) {
            if (win && win.webContents && !win.webContents.isDestroyed()) {
                win.webContents.send('gameChromeView', view);
            }
        }
    });
    return instance;
}

module.exports = {
    createGameChrome: createGameChrome,
    captureRect: captureRect,
    gameChrome: gameChrome
};
