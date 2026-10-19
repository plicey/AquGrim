// The Sets window's own logic (ticket #29). Reference: Grimoire/UI/Set.cs - class SetItem,
// class Item and interface ISetInterface at :282-305, the Add handler at :53-67 and Refresh at
// :150-198. The reference ships no Equip button on this form and its menu entry is hidden
// upstream, so the port keeps the document mechanics only.
//
// A .gset is a user document written where the user points the dialog, so this module only
// reads and writes its bytes; the window and the dialogs own the paths (set-dialogs.js).

const SET_ITEM_TYPE = 'Grimoire.UI.SetItem, Grimoire';
const SET_LIST_TYPE =
    'System.Collections.Generic.List`1[[Grimoire.UI.ISetInterface, Grimoire]], mscorlib';
const ENTRY_TYPE = 'Grimoire.UI.Item, Grimoire';

const ERRORS = {
    parse: 'This file is not a Grimlite set (.gset): it is not readable as a set.',
    outside: 'That set is not inside your sets folder.'
};

const ITEM_MESSAGES = {
    type: 'Please select Item type',
    ac: 'Please select AC or Non-AC'
};

// The item combo's five groups, in the reference's order, matched on the item's category.
const GROUPS = [
    { header: '[Weapons]', match: 'weapon' },
    { header: '[Classes]', match: 'Class' },
    { header: '[Armors]', match: 'Armor' },
    { header: '[Helmets]', match: 'Helm' },
    { header: '[Capes]', match: 'Cape' }
];

// InventoryItem.Weapons: every category the reference folds into the single "Weapon" type.
const WEAPON_CATEGORIES = ['Sword', 'Axe', 'Dagger', 'Gun', 'Bow', 'Mace', 'Polearm', 'Staff', 'Wand'];

/**
 * The entry a file stores for an inventory item: its name, and its category unless that
 * category is a weapon, which the reference writes as the single type "Weapon".
 */
function entryFor(item) {
    return {
        type: WEAPON_CATEGORIES.indexOf(item.category) !== -1 ? 'Weapon' : item.category,
        name: item.name
    };
}

/**
 * The combo's rows, in the reference's order: each group is preceded by a blank separator and
 * followed by one, which is the same blank the next group would add, so the list ends on its
 * last item. Only item rows carry an entry - the reference skips its separators, these cannot
 * be chosen at all.
 */
function inventoryRows(inventory) {
    const items = Array.isArray(inventory) ? inventory : [];
    const rows = [];
    GROUPS.forEach(function (group) {
        rows.push({ label: '', entry: null });
        rows.push({ label: group.header, entry: null });
        rows.push({ label: '', entry: null });
        items.forEach(function (item) {
            const matches = group.match === 'weapon'
                ? WEAPON_CATEGORIES.indexOf(item.category) !== -1
                : item.category === group.match;
            if (matches) rows.push({ label: item.name, entry: entryFor(item) });
        });
    });
    return rows;
}

/**
 * Read a .gset. Lenient like the reference's Newtonsoft reader: $type blocks are optional and
 * a bare array is as good as the $values wrapper, because a set written by hand or by an older
 * build must still open. Returns { ok, entries, error }.
 */
function parseSet(text) {
    if (typeof text !== 'string' || !text) {
        return { ok: false, entries: null, error: ERRORS.parse };
    }
    const source = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    let document;
    try {
        document = JSON.parse(source);
    } catch (error) {
        return { ok: false, entries: null, error: ERRORS.parse };
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
        return { ok: false, entries: null, error: ERRORS.parse };
    }

    const container = document.Set;
    let values = document.Set;
    if (container && typeof container === 'object' && !Array.isArray(container)) {
        values = container.$values;
    }
    if (!Array.isArray(values)) {
        return { ok: false, entries: null, error: ERRORS.parse };
    }

    const entries = [];
    for (let i = 0; i < values.length; i++) {
        const raw = values[i];
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
            return { ok: false, entries: null, error: ERRORS.parse };
        }
        if (typeof raw.Name !== 'string' || typeof raw.Type !== 'string') {
            return { ok: false, entries: null, error: ERRORS.parse };
        }
        entries.push({ type: raw.Type, name: raw.Name });
    }
    return { ok: true, entries: entries, error: null };
}

/**
 * Write a .gset the reference client can open: the same $type strings, the same key order
 * (Type then Name), two-space indentation, UTF-8 with no BOM and no trailing newline.
 */
function serializeSet(entries) {
    const values = (Array.isArray(entries) ? entries : []).map(function (entry) {
        return { $type: ENTRY_TYPE, Type: entry.type, Name: entry.name };
    });
    const document = { $type: SET_ITEM_TYPE };
    document.Set = { $type: SET_LIST_TYPE, $values: values };
    return JSON.stringify(document, null, 2);
}

/**
 * The Sets folder's contents: folders and .gset files, each with the path relative to the
 * folder, sorted so the listing is stable. A folder that does not exist yet is empty.
 */
function listSets(directory, fsModule) {
    const fs = fsModule || require('fs');
    const path = require('path');
    const found = [];
    let names;
    try {
        names = fs.readdirSync(directory);
    } catch (error) {
        return found;
    }
    names.forEach(function (name) {
        const full = path.join(directory, name);
        let stat;
        try {
            stat = fs.statSync(full);
        } catch (error) {
            return;
        }
        if (stat.isDirectory()) {
            // One level deep, as the reference's own tree walk does with SearchOption.TopDirectoryOnly.
            readdir(full).forEach(function (child) {
                if (/\.gset$/i.test(child)) {
                    found.push({ name: child, path: name + '/' + child });
                }
            });
        } else if (stat.isFile() && /\.gset$/i.test(name)) {
            found.push({ name: name, path: name });
        }
    });
    found.sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });
    return found;

    function readdir(target) {
        try {
            return fs.readdirSync(target);
        } catch (error) {
            return [];
        }
    }
}

module.exports = {
    SET_ITEM_TYPE: SET_ITEM_TYPE,
    SET_LIST_TYPE: SET_LIST_TYPE,
    ENTRY_TYPE: ENTRY_TYPE,
    ERRORS: ERRORS,
    GROUPS: GROUPS,
    WEAPON_CATEGORIES: WEAPON_CATEGORIES,
    entryFor: entryFor,
    inventoryRows: inventoryRows,
    parseSet: parseSet,
    serializeSet: serializeSet,
    listSets: listSets
};
