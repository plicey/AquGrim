// The Bot Manager's document mechanics (#36), reference Grimoire/UI/BotManager.cs: which list
// the selector switches between (cbLists), the live counters, Ctrl+Up/Down (_MoveListBoxUp/Down
// and the MoveListItem walk), Ctrl+D (the duplicate branch), the two clipboard shapes of Ctrl+C
// and Ctrl+Shift+C, the Ctrl+V paste and the search that walks its hits and wraps
// (btnSearchCmd_Click). It edits the parsed document in place - the document's own keys are the
// model - so a save writes back exactly the keys the file had (see bots.js).
//
// Selection is per list, because the reference has one listbox per list and each keeps its own
// selection while the selector changes which one is visible. The `selection` property reads and
// writes the visible list's, which is what a key handler touches.

const bots = require('./bots.js');
const catalog = require('./command-catalog.js');

// cbLists order (BotManager.Designer.cs): Commands, Skills, Quests, Drops, Boosts, Items.
const LIST_KEYS = ['Commands', 'Skills', 'Quests', 'Drops', 'Boosts', 'Items'];

// The lists the reference pastes by appending, and keeps unique while it does (Ctrl+V: Drops and
// Items are guarded by a Contains check, the others are not).
const APPEND_UNIQUE = { Drops: true, Items: true };

function listOf(document, key) {
    const value = document[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.$values)) return value.$values;
    return null;
}

/** An editor over one parsed .gbot document. The document is mutated, never rebuilt. */
function create(bot) {
    const document = bot && typeof bot === 'object' ? bot : {};
    const selections = {};
    let selected = 'Commands';

    function list() {
        const found = listOf(document, selected);
        if (found) return found;
        document[selected] = [];
        return document[selected];
    }

    /** The wanted indexes, or this list's own selection, clamped to what the list holds. */
    function selectionOf(items, wanted) {
        return (wanted || selections[currentKey()] || []).filter(function (index) {
            return typeof index === 'number' && index >= 0 && index < items.length;
        }).sort(function (a, b) { return a - b; });
    }

    function currentKey() {
        return selected;
    }

    function items() {
        return list();
    }

    function counters() {
        const counts = {};
        LIST_KEYS.forEach(function (key) {
            const found = listOf(document, key);
            counts[key] = found ? found.length : 0;
        });
        return counts;
    }

    /**
     * AddCommand(cmd, Insert): Insert puts the command at the selection, and at the end of the
     * list when nothing is selected, which is the reference's own clamp.
     */
    function add(command, options) {
        const opts = options || {};
        const target = list();
        const current = selections[currentKey()] || [];
        const at = opts.insert && current.length ? current[0] : target.length;
        target.splice(at, 0, command);
        selections[currentKey()] = [at];
        return at;
    }

    /**
     * The Ctrl+Up / Ctrl+Down branch: the selected items move one place as a block, and neither
     * end lets them past it. shortcut: the reference's two loops (_MoveListBoxUp/Down) re-read a
     * WinForms listbox index they have just mutated, so a multi-selection there is order-dependent
     * (and the down loop can index past the end); this moves the block, stably.
     */
    function move(direction) {
        const target = list();
        const indexes = selectionOf(target);
        if (!indexes.length) return false;
        if (direction !== -1 && direction !== 1) return false;
        const first = indexes[0];
        const last = indexes[indexes.length - 1];
        if (direction < 0 && first === 0) return false;
        if (direction > 0 && last >= target.length - 1) return false;
        const block = indexes.map(function (index) { return target[index]; });
        indexes.slice().reverse().forEach(function (index) {
            target.splice(index, 1);
        });
        const at = direction < 0 ? first - 1 : first + 1;
        target.splice.apply(target, [at, 0].concat(block));
        selections[currentKey()] = block.map(function (_, i) { return at + i; });
        return true;
    }

    /** The Ctrl+D branch: the selected block is copied and inserted below itself, and the copies
     * become the selection, so a second Ctrl+D doubles again. */
    function duplicate() {
        const target = list();
        const indexes = selectionOf(target);
        if (!indexes.length) return false;
        const at = indexes[0] + indexes.length;
        const block = indexes.map(function (index) { return target[index]; });
        target.splice.apply(target, [at, 0].concat(block));
        selections[currentKey()] = block.map(function (_, i) { return at + i; });
        return true;
    }

    /** btnRemove: every selected index, taken from the highest down. */
    function remove() {
        const target = list();
        const indexes = selectionOf(target);
        indexes.slice().reverse().forEach(function (index) {
            target.splice(index, 1);
        });
        selections[currentKey()] = [];
        return indexes.length;
    }

    /** btnClear: this list, or every list when the "all" tickbox is set. */
    function clear(options) {
        const opts = options || {};
        if (opts.all) {
            LIST_KEYS.forEach(function (key) {
                const found = listOf(document, key);
                if (found) found.length = 0;
                selections[key] = [];
            });
        } else {
            list().length = 0;
            selections[currentKey()] = [];
        }
    }

    /**
     * Ctrl+Shift+C: the selected commands as plain text, one per line, from the command list
     * whatever list is showing - the reference reads lstCommands.SelectedItems, so a selection
     * kept in the Commands list still copies while another list is visible.
     */
    function copyAsText() {
        const commands = listOf(document, 'Commands') || [];
        return selectionOf(commands, selections.Commands || []).map(function (index) {
            return catalog.display(commands[index]);
        }).join('\n');
    }

    /**
     * Ctrl+C: the selection of every list, as the Configuration document the writer produces.
     * The reference builds all six lists every time, so a list with nothing selected is copied
     * as an empty one rather than left out. That dialect is what makes the clipboard text both
     * pasteable here and saveable as a bot.
     */
    function copyJson() {
        const out = { $type: bots.CONFIGURATION_TYPE };
        LIST_KEYS.forEach(function (key) {
            const found = listOf(document, key) || [];
            const picked = key === selected
                ? selectionOf(found)
                : selectionOf(found, selections[key] || []);
            out[key] = picked.map(function (index) { return found[index]; });
        });
        return bots.serializeBot(out);
    }

    /**
     * Ctrl+V: parse the clipboard as a bot and merge it in. Commands insert after the selection,
     * the other lists are appended, and Drops/Items stay unique.
     */
    function pasteJson(text) {
        const parsed = bots.parseBot(text);
        if (!parsed.ok) return false;
        const incoming = parsed.bot;
        const commands = listOf(incoming, 'Commands') || [];
        const target = listOf(document, 'Commands') || (document.Commands = []);
        if (commands.length) {
            const current = selectionOf(target);
            const at = current.length ? current[0] + 1 : target.length;
            target.splice.apply(target, [at, 0].concat(commands));
            selections.Commands = commands.map(function (_, i) { return at + i; });
        }
        ['Skills', 'Quests', 'Boosts', 'Drops', 'Items'].forEach(function (key) {
            const incomingList = listOf(incoming, key) || [];
            if (!incomingList.length) return;
            const own = listOf(document, key) || (document[key] = []);
            incomingList.forEach(function (item) {
                if (APPEND_UNIQUE[key] && own.indexOf(item) !== -1) return;
                own.push(item);
            });
        });
        return true;
    }

    /**
     * btnSearchCmd_Click: filter the command list by the keyword (case-insensitive), then select
     * the next hit and wrap after the last one. A new keyword restarts the walk.
     */
    let keyword = null;
    let hits = [];
    let next = 0;

    function find(text) {
        const wanted = text === undefined || text === null ? '' : String(text);
        const commands = listOf(document, 'Commands') || [];
        if (wanted !== keyword) {
            keyword = wanted;
            next = 0;
            hits = [];
            commands.forEach(function (command, index) {
                if (catalog.rowText(command).toLowerCase().indexOf(wanted.toLowerCase()) !== -1) hits.push(index);
            });
        }
        if (!hits.length) return null;
        const hit = hits[next];
        next = next + 1 >= hits.length ? 0 : next + 1;
        selections.Commands = [hit];
        return hit;
    }

    /** GetAllCommands<CmdLabel>: the label list, in command-list order. */
    function labels() {
        const commands = listOf(document, 'Commands') || [];
        return commands.filter(function (command) {
            return catalog.classNameOf(command) === 'CmdLabel';
        }).map(function (command) {
            return catalog.display(command);
        });
    }

    /** Double-click / the generated form: replace one command where it stands. */
    function replace(index, command) {
        const target = list();
        if (!(index >= 0 && index < target.length) || !command || typeof command !== 'object') return false;
        target[index] = command;
        selections[currentKey()] = [index];
        return true;
    }

    /** The raw JSON escape hatch: the same replacement, refused loudly when it does not parse. */
    function replaceFromJson(index, text) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            return { ok: false, error: error.message || String(error) };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return { ok: false, error: 'a command is a JSON object' };
        }
        replace(index, parsed);
        return { ok: true, error: null };
    }

    /** A tickbox on one of the tabs: the reference writes the Configuration key straight away. */
    function setSetting(key, value) {
        document[key] = value;
    }

    function setting(key) {
        return bots.configuration(document)[key];
    }

    /** Load bot / ApplyConfiguration: chkMerge appends, otherwise every list is replaced. */
    function applyConfiguration(incoming, options) {
        const opts = options || {};
        LIST_KEYS.forEach(function (key) {
            const source = listOf(incoming, key) || [];
            if (!opts.merge) {
                // A copy, so appending under Merge cannot push onto the document it came from.
                document[key] = source.slice();
                return;
            }
            const own = listOf(document, key) || (document[key] = []);
            source.forEach(function (item) { own.push(item); });
        });
        LIST_KEYS.forEach(function (key) { selections[key] = []; });
    }

    const api = {
        keys: function () { return LIST_KEYS.slice(); },
        items: items,
        counters: counters,
        add: add,
        move: move,
        duplicate: duplicate,
        remove: remove,
        clear: clear,
        copyAsText: copyAsText,
        copyJson: copyJson,
        pasteJson: pasteJson,
        find: find,
        labels: labels,
        replace: replace,
        replaceFromJson: replaceFromJson,
        setSetting: setSetting,
        setting: setting,
        applyConfiguration: applyConfiguration,
        object: function () { return document; }
    };

    Object.defineProperty(api, 'selected', {
        get: currentKey,
        set: function (key) {
            if (LIST_KEYS.indexOf(key) === -1) {
                throw new Error('[AquGrim:grimlite-parity] not a bot list: ' + key);
            }
            selected = key;
            if (!selections[key]) selections[key] = [];
        }
    });

    Object.defineProperty(api, 'selection', {
        get: function () { return (selections[currentKey()] || []).slice(); },
        set: function (indexes) {
            selections[currentKey()] = (Array.isArray(indexes) ? indexes : [indexes]).slice();
        }
    });

    return api;
}

module.exports = {
    create: create,
    LIST_KEYS: LIST_KEYS
};
