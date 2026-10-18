// The Options window's main-process half (ticket #34). The page is sandboxed, so every move of a
// tick and every read of the game crosses this IPC edge.
//
// Reference: Grimlite-Li's Options menu (Grimoire/UI/Root.cs:983-996) and OptionsManager. The
// reference draws its toggles as a menu, so this is the window the port puts them in instead: one
// checkbox each, in the reference's own order, plus the Walkspeed tick and the number field that
// belongs to it.

const toggles = require('./toggles.js');

function createOptionsWindow(deps) {
    deps = deps || {};
    const feature = deps.feature;
    const messages = deps.messages || {};

    function message(error) {
        return (error && error.message) || String(error);
    }

    /** Everything the page draws: the labels in order, the walkspeed field, the current state. */
    function view() {
        const state = feature.state();
        return {
            toggles: toggles.TOGGLES.map(function (toggle) {
                // The one entry that owns a number box as well as a tick is Walkspeed (its submenu
                // carries the value in the reference). The page draws it in its own row rather than
                // in the plain list, so it is never on screen twice.
                return {
                    id: toggle.id,
                    label: toggle.label,
                    on: state[toggle.id] === true,
                    field: toggle.id === toggles.WALK_SPEED.id
                };
            }),
            walkSpeed: state.walkSpeed,
            walkSpeedOn: state.walkSpeedOn,
            walkSpeedMin: toggles.WALK_SPEED.min,
            walkSpeedMax: toggles.WALK_SPEED.max,
            applying: state.applying,
            results: state.results,
            messages: messages
        };
    }

    /** Move one tick. A refusal comes back as the answer, never as a thrown error. */
    async function set(id, on) {
        try {
            const answer = await feature.setToggle(id, on);
            return Object.assign({}, answer, { view: view() });
        } catch (error) {
            return { ok: false, error: message(error), view: view() };
        }
    }

    async function setSpeed(value) {
        try {
            await feature.setWalkSpeed(value);
            return { ok: true, error: null, view: view() };
        } catch (error) {
            return { ok: false, error: message(error), view: view() };
        }
    }

    /** The reference's own Start/Stop over the option loop (OptionsManager.Start/Stop). */
    async function toggleApplying() {
        try {
            const answer = await feature.toggleApplying();
            return { ok: answer.ok === true, error: answer.error || null, view: view() };
        } catch (error) {
            return { ok: false, error: message(error), view: view() };
        }
    }

    function handle(channel, args) {
        if (channel === 'optionsView') return Promise.resolve(view());
        if (channel === 'optionsSet') return set(args && args[0], args && args[1]);
        if (channel === 'optionsWalkSpeed') return setSpeed(args && args[0]);
        if (channel === 'optionsToggleApplying') return toggleApplying();
        throw new Error('[AquaStar:grimlite-parity] unknown options channel "' + channel + '"');
    }

    function attachTo(host) {
        [
            'optionsView', 'optionsSet', 'optionsWalkSpeed', 'optionsToggleApplying'
        ].forEach(function (channel) {
            host.ipc.handle(channel, function () {
                return handle(channel, Array.prototype.slice.call(arguments, 1));
            });
        });
    }

    return { handle: handle, attachTo: attachTo, view: view };
}

/** The window as the plugin uses it: the feature, the page's own words, the channels. */
function createFromHost(host, deps) {
    deps = deps || {};
    const feature = deps.feature || require('./options.js').createOptionsFeature(host, deps);
    feature.attach();
    const window = createOptionsWindow({
        feature: feature,
        messages: (typeof host.getLocaleStrings === 'function' &&
            host.getLocaleStrings('optionsMessages')) || {}
    });
    window.attachTo(host);
    window.feature = feature;
    return window;
}

module.exports = {
    createOptionsWindow: createOptionsWindow,
    createFromHost: createFromHost
};
