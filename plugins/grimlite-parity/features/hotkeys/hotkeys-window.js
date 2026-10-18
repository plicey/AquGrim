// The Hotkeys window's main-process half (ticket #34). The page is sandboxed, so the list, the
// pickers' vocabulary and every bind/unbind cross this IPC edge.
//
// Reference: Grimoire/UI/Hotkeys.cs. Its three controls are a key combo (cbKeys), an action combo
// (cbActions) and Add / Remove / Save over a list (lstKeys). Add binds straight away, Remove gives
// the key back, and Save writes hotkeys.json. This port persists on every change instead of only
// on Save, so a binding cannot be lost by closing the window - Save stays as an explicit write and
// reports where it went.

function stringOf(value) {
    return value == null ? '' : String(value);
}

function createHotkeysWindow(deps) {
    deps = deps || {};
    const feature = deps.feature;
    const messages = deps.messages || {};

    function message(error) {
        return (error && error.message) || String(error);
    }

    /** Everything the page draws: the vocabulary, the picker's keys, the current bindings. */
    function view() {
        const model = feature.view();
        // What the reference's own list shows, one line per binding: its Text field.
        model.rows = model.bindings.map(function (record) {
            return {
                Text: record.Text,
                Key: record.Key,
                ActionIndex: record.ActionIndex,
                action: message(model.actions[record.ActionIndex])
            };
        });
        // The window's own words, so the page and the menu cannot drift apart on a translated
        // build. Empty binds before every save: the list is already persisted on each change.
        model.messages = messages;
        return model;
    }

    async function bind(key, actionIndex) {
        try {
            const answer = feature.bind(key, actionIndex);
            return Object.assign({}, answer, { view: view() });
        } catch (error) {
            return { ok: false, error: message(error), view: view() };
        }
    }

    function clear(key) {
        let cleared = false;
        try {
            cleared = feature.clear(key);
        } catch (error) {
            return { ok: false, error: message(error), view: view() };
        }
        return { ok: cleared, error: cleared ? null : 'nothing is bound to ' + stringOf(key), view: view() };
    }

    /** The reference's Save: the whole list is already persisted, so this reports where it went. */
    function save() {
        return { ok: true, error: null, saved: feature.list().length, view: view() };
    }

    /** Run an action, for the window's own affordance ("try it now"). */
    async function run(actionIndex) {
        try {
            const answer = await feature.runAction(actionIndex);
            return Object.assign({}, answer, { view: view() });
        } catch (error) {
            return { ok: false, error: message(error), view: view() };
        }
    }

    function handle(channel, args) {
        if (channel === 'hotkeysView') return Promise.resolve(view());
        if (channel === 'hotkeysBind') return bind(args && args[0], args && args[1]);
        if (channel === 'hotkeysClear') return Promise.resolve(clear(args && args[0]));
        if (channel === 'hotkeysSave') return Promise.resolve(save());
        if (channel === 'hotkeysRun') return run(args && args[0]);
        throw new Error('[AquaStar:grimlite-parity] unknown hotkeys channel "' + channel + '"');
    }

    function attachTo(host) {
        ['hotkeysView', 'hotkeysBind', 'hotkeysClear', 'hotkeysSave', 'hotkeysRun'].forEach(function (channel) {
            host.ipc.handle(channel, function () {
                return handle(channel, Array.prototype.slice.call(arguments, 1));
            });
        });
    }

    return { handle: handle, attachTo: attachTo, view: view };
}

module.exports = {
    createHotkeysWindow: createHotkeysWindow
};
