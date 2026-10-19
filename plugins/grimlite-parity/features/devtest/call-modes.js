// The reference's three call modes (Grimlite/UI/DevTest.cs), as data the page and its preload both
// use. Each mode names the bridge callback it drives, so the page never spells a call out itself.
//
// The reference's own button logic is the specification:
//   Grimoire       -> Flash.Call2(fn, args)            read straight through the loader
//   Call Func      -> Flash.CallGameFunction2(fn, args) a function by dot-path
//   Get/Set Object -> Flash.SetGameObject(fn, value) then Flash.GetGameObject(fn)

const MODES = [
    { id: 'grimoire', label: 'Grimoire' },
    { id: 'callFunction', label: 'Call Func' },
    { id: 'getSetObject', label: 'Get/Set Object' }
];

// DevTest.cs's own wait between Flash.SetGameObject and the read-back: `await Task.Delay(1000)`.
const SETTLE_MS = 1000;

// DevTest.cs's two failure literals for a Get/Set read-back.
const CANNOT_CALL = "Can't call the function.";
const CANNOT_PROCESS = "Function called, but can't process its return.";

/**
 * Split the Args box the way the reference splits it: on commas when there is one, otherwise the
 * whole box is a single argument, and an empty box is no arguments at all.
 * @param {string} text
 * @param {boolean} [enabled] the reference's own Args checkbox
 */
function parseArgs(text, enabled) {
    if (enabled === false) return [];
    const raw = text == null ? '' : String(text);
    if (raw.length === 0) return [];
    return raw.indexOf(',') !== -1 ? raw.split(',') : [raw];
}

/** The reference converts exactly these two spellings to booleans before writing a value. */
function coerce(value) {
    if (value === 'true' || value === 'True') return true;
    if (value === 'false' || value === 'False') return false;
    return value;
}

/**
 * Run one mode against the bridge.
 * @param {string} mode one of MODES' ids
 * @param {string} path the Function box
 * @param {string[]} args already split by parseArgs
 * @param {{ call: (name: string, args: any[]) => Promise<object> }} bridge
 * @param {object} [options] { wait(ms) } - the delay between a write and its read-back; tests
 *   inject an immediate one, the app passes a real timer.
 * @returns {Promise<{ ok: boolean, value?: any, error?: string }>}
 */
function run(mode, path, args, bridge, options) {
    const parts = Array.isArray(args) ? args : [];
    const wait = (options && typeof options.wait === 'function') ? options.wait : function () { return Promise.resolve(); };
    if (mode === 'callFunction') {
        // The reference keeps a separate zero-argument entry point; so does the loader.
        return parts.length
            ? bridge.call('callGameFunction', [path].concat(parts))
            : bridge.call('callGameFunction0', [path]);
    }
    if (mode === 'getSetObject') {
        if (!parts.length) return readBack(bridge.call('getGameObject', [path]));
        // The reference writes, waits a moment, then reads the path back.
        return bridge.call('setGameObject', [path, coerce(parts[0])])
            .then(function () {
                return wait(SETTLE_MS);
            })
            .then(function () {
                return readBack(bridge.call('getGameObject', [path]));
            });
    }
    return bridge.call('getGameObject', [path]);
}

/** DevTest.cs's radGetGame branch: null is "Can't call"; an empty string is the other literal. */
function readBack(answer) {
    return Promise.resolve(answer).then(function (result) {
        if (!result || result.ok !== true) return result;
        if (result.value === null || result.value === undefined) {
            return { ok: false, error: CANNOT_CALL };
        }
        if (typeof result.value === 'string' && result.value.length < 1) {
            return { ok: false, error: CANNOT_PROCESS };
        }
        return result;
    });
}

/** Pretty-print JSON; anything else is shown as it came. The reference's Format JSON button. */
function format(text) {
    const raw = text == null ? '' : String(text);
    try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object') return raw;
        return JSON.stringify(parsed, null, 2);
    } catch (e) {
        return raw;
    }
}

module.exports = {
    MODES: MODES,
    SETTLE_MS: SETTLE_MS,
    CANNOT_CALL: CANNOT_CALL,
    CANNOT_PROCESS: CANNOT_PROCESS,
    parseArgs: parseArgs,
    coerce: coerce,
    run: run,
    format: format
};
