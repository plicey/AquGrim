// The Hotkeys window's main-process half: the one list of bindings, the actions they run, and the
// two places a key can be installed.
// Reference: Grimlite-Li 816d9cd, Grimoire/UI/Hotkeys.cs.
//
// Three of the reference's own behaviours are carried over deliberately:
//
//   * the set ships EMPTY (Hotkeys.cs:127). A saved `hotkeys.json` is the whole state, and nothing
//     is bound until the user binds it;
//   * a bound key fires only while this app has focus, except "Minimize to tray" (Hotkeys.cs:245 -
//     263). The app's local shortcut layer is that same focus-scoped hook, so every binding goes
//     there and Minimize to tray alone goes on the app-wide one, which is this port's nearest
//     equivalent of "works even unfocused";
//   * a key another feature already holds is refused rather than stolen. The reference tests its
//     own hook's list (Hotkeys.cs:395); here the app's keys and the game plugin's are handed in,
//     because they belong to the platform and to the other plugin, not to this one.
//
// An action whose window has not shipped yet answers with that reason. It is inert, never fatal:
// the reference's vocabulary is bigger than any single build's window set.

const actions = require('./actions.js');
const targets = require('./action-targets.js');

const STORE_NAMESPACE = 'hotkeys';

// The reference's one focus-exempt action, so the one binding that goes app-wide.
const GLOBAL_ACTION_LABEL = 'Minimize to tray';

/**
 * @param {object} deps
 * @param {object} deps.store host.getStore('hotkeys')
 * @param {object} deps.localShortcuts register(accelerator, fn) / unregister(accelerator) on the
 *                                     app's focused window
 * @param {object} deps.globalShortcuts the same, app-wide
 * @param {Function} deps.openWindow host.windows.openFeatureWindow
 * @param {Array<string>} deps.windowIds the feature windows the plugin has registered right now
 * @param {Array<{key: string, owner: string}>} deps.takenKeys keys the app or the game plugin holds
 * @param {object} deps.platform the app-wide actions this port can reach
 * @param {object} deps.gameCalls see game-calls.js
 * @param {object} [deps.options] the options feature, for the "Toggle Options" action
 */
function createHotkeys(deps) {
    deps = deps || {};
    const store = deps.store || null;
    const localShortcuts = deps.localShortcuts || null;
    const globalShortcuts = deps.globalShortcuts || null;
    const openWindow = deps.openWindow || function () { return { ok: false, error: 'no window host' }; };
    const windowIds = Array.isArray(deps.windowIds) ? deps.windowIds.slice() : [];
    const takenKeys = Array.isArray(deps.takenKeys) ? deps.takenKeys.slice() : [];
    const platform = deps.platform || {};
    const gameCalls = deps.gameCalls || { call: function () { return Promise.resolve({ ok: false, error: 'no game bridge in this build' }); } };
    const options = deps.options || null;
    const log = typeof deps.log === 'function' ? deps.log : function () {};

    const installed = {};   // accelerator -> the record that holds it
    let bindings = [];      // the reference's own list, in the user's order

    function load() {
        if (!store) return [];
        let stored;
        try {
            stored = store.read();
        } catch (error) {
            // No file yet is the ordinary first run, not a failure.
            return [];
        }
        return Array.isArray(stored) ? stored : [];
    }

    function save() {
        if (!store) return;
        try {
            store.write(bindings);
        } catch (error) {
            log('could not save the hotkeys (' + (error && error.message ? error.message : error) + ')');
        }
    }

    function usable(record) {
        if (!record || typeof record !== 'object') return false;
        if (typeof record.Key !== 'string' || !actions.acceleratorFor(record.Key)) return false;
        return actions.byIndex(record.ActionIndex) !== null;
    }

    function layerFor(record) {
        return actions.byIndex(record.ActionIndex).label === GLOBAL_ACTION_LABEL
            ? globalShortcuts
            : localShortcuts;
    }

    function uninstallOne(record) {
        const accelerator = actions.acceleratorFor(record.Key);
        if (!accelerator || !installed[accelerator]) return;
        const layer = layerFor(installed[accelerator]);
        if (layer && typeof layer.unregister === 'function') layer.unregister(accelerator);
        delete installed[accelerator];
    }

    function uninstallAll() {
        Object.keys(installed).forEach(function (accelerator) {
            uninstallOne(installed[accelerator]);
        });
    }

    function installOne(record) {
        const accelerator = actions.acceleratorFor(record.Key);
        const layer = layerFor(record);
        if (!layer || typeof layer.register !== 'function') {
            return { ok: false, error: 'this app has no shortcut layer to bind to' };
        }
        if (!layer.register(accelerator, function () { return feature.run(accelerator); })) {
            return { ok: false, error: 'the shortcut layer refused ' + accelerator };
        }
        installed[accelerator] = record;
        return { ok: true };
    }

    /** The binding a key currently holds, if any. */
    function bindingFor(key) {
        for (let i = 0; i < bindings.length; i++) {
            if (bindings[i].Key === key) return bindings[i];
        }
        return null;
    }

    async function callGame(call, args) {
        const answer = await gameCalls.call(call, args);
        return { ok: answer.ok === true, error: answer.error || null, done: call };
    }

    /**
     * Run one action. Answers {ok, error} - never throws, because a keypress must not be able to
     * take the app down, and the reference's vocabulary includes windows no build has yet.
     */
    async function runAction(actionIndex) {
        const action = actions.byIndex(actionIndex);
        if (!action) return { ok: false, error: 'no action at index ' + actionIndex };
        const label = action.label;

        const game = targets.GAME_ACTIONS[label];
        if (game) {
            return callGame(game.args.length ? 'callGameFunction' : 'callGameFunction0',
                [game.call].concat(game.args));
        }

        const appAction = targets.APP_ACTIONS[label];
        if (appAction === 'toggleOptions') {
            if (options && typeof options.toggleApplying === 'function') {
                const answer = await options.toggleApplying();
                return { ok: true, done: appAction, error: answer.ok ? null : answer.error };
            }
            return { ok: true, done: null, error: label + ': the option loop is not wired in this window' };
        }
        if (appAction) {
            if (typeof platform[appAction] !== 'function') {
                return { ok: true, done: null, error: label + ': this app has no ' + appAction + ' action' };
            }
            return { ok: true, done: platform[appAction]() };
        }

        const target = targets.WINDOW_BY_ACTION[label];
        if (!target) return { ok: false, error: label + ': this build has no action for it yet' };
        if (windowIds.indexOf(target) === -1) {
            return { ok: false, error: label + ': this window has not shipped yet' };
        }
        return { ok: true, done: openWindow(target) };
    }

    const feature = {
        /** Run the action a key is bound to, or nothing when the key holds no binding. */
        run: function (accelerator) {
            const record = installed[accelerator];
            if (!record) return { ok: false, error: 'nothing is bound to ' + accelerator };
            return Promise.resolve(runAction(record.ActionIndex)).catch(function (error) {
                return { ok: false, error: error && error.message ? error.message : String(error) };
            });
        },

        /** Bind one key to one action, replacing whatever that key held. */
        bind: function (key, actionIndex) {
            const name = String(key == null ? '' : key);
            const action = actions.byIndex(actionIndex);
            if (!action) return { ok: false, error: 'no action at index ' + actionIndex };
            if (actions.KEYS.indexOf(name) === -1) {
                return { ok: false, error: name + ' is not one of the keys this picker offers' };
            }
            const accelerator = actions.acceleratorFor(name);
            if (!accelerator) {
                return { ok: false, error: name + ' cannot be bound on its own: this app\'s shortcut ' +
                    'layer takes a single key, and a bare modifier is not one' };
            }
            const previous = bindingFor(name);
            if (!previous) {
                const held = takenKeys.filter(function (entry) {
                    return entry && entry.key === accelerator;
                })[0];
                if (held) return { ok: false, error: accelerator + ' is already used by ' + held.owner };
            }
            const record = {
                Text: actions.labelFor(name, actionIndex),
                Key: name,
                ActionIndex: actionIndex
            };
            // Move it first: a rebind and a fresh bind take the same key the same way.
            if (previous) uninstallOne(previous);
            const installAnswer = installOne(record);
            if (!installAnswer.ok) return installAnswer;
            bindings = previous
                ? bindings.map(function (item) { return item.Key === name ? record : item; })
                : bindings.concat([record]);
            save();
            return { ok: true, binding: record };
        },

        /** Give a key back, and forget its binding. */
        clear: function (key) {
            const name = String(key == null ? '' : key);
            const record = bindingFor(name);
            if (!record) return false;
            uninstallOne(record);
            bindings = bindings.filter(function (item) { return item.Key !== name; });
            save();
            return true;
        },

        /** Install what is stored. Called at activation, like the reference's LoadHotkeys. */
        install: function () {
            const stored = load();
            const seen = {};
            bindings = stored.filter(function (record) {
                if (!usable(record) || seen[record.Key]) return false;
                seen[record.Key] = true;
                return true;
            });
            if (bindings.length !== stored.length) {
                log('ignored ' + (stored.length - bindings.length) + ' hotkey record(s) this build cannot use');
            }
            bindings.forEach(function (record) {
                const answer = installOne(record);
                if (!answer.ok) log('could not install ' + record.Key + ': ' + answer.error);
            });
            return feature.list();
        },

        /** Give every key back. */
        uninstall: uninstallAll,

        list: function () {
            return bindings.map(function (record) {
                return { Text: record.Text, Key: record.Key, ActionIndex: record.ActionIndex };
            });
        },

        /** Everything the window draws: the vocabulary, the picker's keys and the bindings. */
        view: function () {
            return {
                actions: actions.ACTIONS.map(function (action) { return action.label; }),
                keys: actions.KEYS.slice(),
                bindings: feature.list(),
                taken: takenKeys.map(function (entry) { return { key: entry.key, owner: entry.owner }; })
            };
        },

        /** Run an action by index, for the window's own affordances and for tests. */
        runAction: runAction,

        /** @internal test seam */
        _installed: function () { return Object.assign({}, installed); }
    };

    return feature;
}

module.exports = {
    createHotkeys: createHotkeys,
    STORE_NAMESPACE: STORE_NAMESPACE,
    GLOBAL_ACTION_LABEL: GLOBAL_ACTION_LABEL
};
