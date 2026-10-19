// The Bot Manager's per-command colours, centring flags and font size (#36), persisted in this
// plugin's own store. Reference: Grimoire/UI/BotManager.cs (GetColor/GetBoolCentered read
// `<Name>Color` / `<Name>Centered` out of config.cfg, BotManager_Load reads `font` and
// `CommandsSize`) and Grimoire/UI/CommandColorForm.cs (which names a command by its class minus
// "Cmd", and adds the three non-class names Index, Variable and ExtendedVariable).
//
// The reference keeps these in one flat config file; here they are one namespaced store under two
// maps, so a colour for a class this build does not know still round-trips.
const catalog = require('./command-catalog.js');

const STORE_NAMESPACE = 'botManager';
const DEFAULT_COLOUR = 'FFDCDCDC';
const DEFAULT_SIZE = 60;
// CommandColorForm.Designer.cs: trackBar1.Minimum = 20, Maximum = 100, Value = 60.
const MIN_SIZE = 20;
const MAX_SIZE = 100;
// The three combo entries the form adds before the classes. They colour the segments a command
// row is split into (DrawString: the command itself, its variable, the extended variable, index).
// The three names the reference's own combo lists before the classes (CommandColorForm_Load);
// everything else in the combo is a class, and a class's name is its own label.
const EXTRA_NAMES = ['Index', 'Variable', 'ExtendedVariable'];

/** The reference's own key for a name: its class minus "Cmd", plus the suffix (CommandColorForm). */
function storeKey(name) {
    const text = String(name == null ? '' : name);
    return text.slice(0, 3) === 'Cmd' ? text.slice(3) : text;
}

function create(deps) {
    deps = deps || {};
    const store = deps.store;
    const defaultBotsDirectory = deps.defaultBotsDirectory || '';
    let cache = null;

    function state() {
        if (cache) return cache;
        const empty = { colours: {}, centered: {}, commandsSize: DEFAULT_SIZE, font: '',
            botsDirectory: defaultBotsDirectory, ui: {} };
        if (!store) return (cache = empty);
        try {
            const read = store.readOrCreate(function () { return empty; }) || {};
            cache = {
                colours: read.colours && typeof read.colours === 'object' ? read.colours : {},
                centered: read.centered && typeof read.centered === 'object' ? read.centered : {},
                commandsSize: read.commandsSize,
                font: typeof read.font === 'string' ? read.font : '',
                botsDirectory: typeof read.botsDirectory === 'string' && read.botsDirectory
                    ? read.botsDirectory : defaultBotsDirectory,
                ui: read.ui && typeof read.ui === 'object' ? read.ui : {}
            };
        } catch (error) {
            // A store that will not parse is not a reason for the window to break: the reference's
            // Config.Load has the same problem and the same answer, the built-in default.
            cache = empty;
        }
        return cache;
    }

    function save() {
        if (!store) return;
        try {
            store.write(state());
        } catch (error) {
            // Persisting a style is a convenience; failing to is not worth refusing an edit over.
        }
    }

    function size() {
        const value = Number(state().commandsSize);
        if (!isFinite(value)) return DEFAULT_SIZE;
        return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(value)));
    }

    /** CommandColorForm_Load's combo: the three extras, then every IBotCommand type. */
    function customisable() {
        const names = EXTRA_NAMES.slice();
        Object.keys(catalog.GROUPS).forEach(function (className) { names.push(className); });
        catalog.STATEMENTS.forEach(function (row) { names.push(row.className); });
        return names;
    }

    return {
        colour: function (name) {
            const stored = state().colours[storeKey(name) + 'Color'];
            return typeof stored === 'string' && /^[0-9A-Fa-f]{6,8}$/.test(stored) ? stored.toUpperCase() : DEFAULT_COLOUR;
        },
        setColour: function (name, value) {
            state().colours[storeKey(name) + 'Color'] = String(value).toUpperCase();
            save();
        },
        centered: function (name) {
            return state().centered[storeKey(name) + 'Centered'] === true;
        },
        setCentered: function (name, value) {
            state().centered[storeKey(name) + 'Centered'] = value === true;
            save();
        },
        /** CommandColorForm's Random Colors: a random colour mixed halfway towards RGB. */
        randomColours: function (mixR, mixG, mixB) {
            const r = Number(mixR) || 0;
            const g = Number(mixG) || 0;
            const b = Number(mixB) || 0;
            const names = customisable();
            for (let i = 0; i < names.length; i++) {
                const red = Math.floor((Math.random() * 256 + r) / 2);
                const green = Math.floor((Math.random() * 256 + g) / 2);
                const blue = Math.floor((Math.random() * 256 + b) / 2);
                state().colours[storeKey(names[i]) + 'Color'] = 'FF' + [red, green, blue].map(function (n) {
                    return n.toString(16).padStart(2, '0');
                }).join('').toUpperCase();
            }
            save();
        },
        /** btnReloadColors_Click clears the form's caches; here that is the store cache. */
        reload: function () { cache = null; },
        /** Every colour the lists need, so a row never asks for one at a time. */
        colours: function () {
            const out = {};
            Object.keys(state().colours).forEach(function (name) { out[name] = state().colours[name]; });
            return out;
        },
        centeredFlags: function () {
            const out = {};
            Object.keys(state().centered).forEach(function (name) { out[name] = state().centered[name] === true; });
            return out;
        },
        commandsSize: size,
        setCommandsSize: function (value) {
            state().commandsSize = Number(value);
            save();
            return size();
        },
        /** BotManager_Load + trackBar1_Scroll: the item height and the font size it derives. */
        itemMetrics: function () {
            const raw = size();
            const itemHeight = raw / 4;
            return { itemHeight: itemHeight, fontSize: itemHeight - 6.5 };
        },
        fontFamily: function () {
            return state().font;
        },
        setFont: function (family) {
            state().font = family == null ? '' : String(family);
            save();
        },
        botsDirectory: function () {
            return state().botsDirectory;
        },
        /**
         * A control's own state, which is not part of a bot: the reference keeps chkMerge in the
         * form and never writes it into the file (Configuration has no such member).
         */
        ui: function (key) {
            return state().ui[key];
        },
        setUi: function (key, value) {
            state().ui[key] = value;
            save();
        },
        setBotsDirectory: function (directory) {
            state().botsDirectory = directory == null ? '' : String(directory);
            save();
        },
        customisableNames: customisable
    };
}

module.exports = {
    create: create,
    storeKey: storeKey,
    STORE_NAMESPACE: STORE_NAMESPACE,
    DEFAULT_COLOUR: DEFAULT_COLOUR,
    DEFAULT_SIZE: DEFAULT_SIZE,
    MIN_SIZE: MIN_SIZE,
    MAX_SIZE: MAX_SIZE,
    EXTRA_NAMES: EXTRA_NAMES
};
