// The Cosmetics window's own logic (ticket #30). Reference: Grimoire/UI/CosmeticForm.cs with
// CosmeticForm.Designer.cs (the eight-row grid at y = 0/24/48/72/96/120/144/168, the seven grab
// links of tableLayoutPanel2, and the button words), Grimoire/Botting/CosmeticEquipment.cs (the
// EquipType <-> slot-code map, ToString, and the map's lack of an Off entry), and
// Grimoire/UI/Set.cs (the .gset document).
//
// A cosmetic set has only ever been the reference's own 24-line text file: its Sets/ folder holds
// those and .gset documents side by side, and the Cosmetics form reads and writes no other shape.
// Ticket #30 asks for the Sets window's shape, so this reader takes both and writes the .gset.

const SET_ITEM_TYPE = 'Grimoire.UI.SetItem, Grimoire';
const SET_LIST_TYPE =
    'System.Collections.Generic.List`1[[Grimoire.UI.ISetInterface, Grimoire]], mscorlib';
const ENTRY_TYPE = 'Grimoire.UI.Item, Grimoire';

const ERRORS = {
    slot: 'That is not one of the cosmetic slots.',
    set: 'This file is not a Grimlite set: it is not readable as one.',
    noWear: 'That player is not wearing anything the game would read.',
    notGrabbable: 'That slot has no grab link in the reference client.'
};

// The grid's rows, in the designer's own order. `code` is what each row's Set button sends:
// CosmeticForm.btnSet_Click's switch for the offhand and CosmeticEquipment._cosMap for the rest.
// `listLabel` is the EquipType name CosmeticEquipment.ToString prints in the list, which is why
// the Misc row lists as "Ground"; the offhand has no entry in that map, so it lists as nothing.
const ROWS = [
    { id: 'helm', label: 'Helm', code: 'he', listLabel: 'Helm' },
    { id: 'armor', label: 'Armor', code: 'co', listLabel: 'Armor' },
    { id: 'class', label: 'Class', code: 'ar', listLabel: 'Class' },
    { id: 'weapon', label: 'Weapon', code: 'Weapon', listLabel: 'Weapon' },
    { id: 'off', label: 'Off.H', code: 'Off', listLabel: null },
    { id: 'pet', label: 'Pet', code: 'pe', listLabel: 'Pet' },
    { id: 'cape', label: 'Cape', code: 'ba', listLabel: 'Cape' },
    { id: 'misc', label: 'Misc', code: 'mi', listLabel: 'Ground' }
];

// tableLayoutPanel2's own links, left to right. "Grab Wep" is the designer's text; the reference
// reads the row back out of it by replacing Wep with Weapon.
const GRAB_LINKS = [
    { row: 'helm', label: 'Grab Helm' },
    { row: 'armor', label: 'Grab Armor' },
    { row: 'class', label: 'Grab Class' },
    { row: 'weapon', label: 'Grab Wep' },
    { row: 'pet', label: 'Grab Pet' },
    { row: 'cape', label: 'Grab Cape' },
    { row: 'misc', label: 'Grab Ground' }
];

const BUTTONS = {
    grab: 'Grab',
    set: 'Set',
    equipAll: 'Equip All',
    equipSelected: 'Equip Selected',
    clearAll: 'Clear All',
    remove: 'Remove',
    save: 'Save',
    load: 'Load'
};

const WINDOW_TITLE = 'SWF Cosmetics';

// CosmeticEquipment._backMap, as the wear loop uses it: only the rows that map in the reference's
// own map, which is its _cosMap inverted. The game's eqp dictionary is keyed by these codes (its
// string table holds Weapon/he/ba/ar/co/pe/mi and no Off), and the offhand has no entry in that
// map, so CosmeticEquipment.Get drops an Off entry and there is no Grab Off.H link either.
const CODE_TO_ROW = {};
ROWS.forEach(function (row) {
    if (row.listLabel) CODE_TO_ROW[row.code] = row.id;
});

function rowById(id) {
    return ROWS.filter(function (row) { return row.id === id; })[0] || null;
}

/** The empties every one of the eight rows starts as. */
function emptyValues() {
    const values = {};
    ROWS.forEach(function (row) { values[row.id] = ''; });
    return values;
}

function join(file, link) {
    return String(file == null ? '' : file) + ';' + String(link == null ? '' : link);
}

/**
 * A row's value as its two boxes: the reference splits on ';' with no limit, so a link that
 * itself holds one keeps it.
 */
function sides(value) {
    const text = value == null ? '' : String(value);
    const at = text.indexOf(';');
    if (at === -1) return { file: text, link: '' };
    return { file: text.slice(0, at), link: text.slice(at + 1) };
}

/**
 * The player picker's rows, from the game's own player tree (world.uoTree, keyed by uid, each
 * avatar carrying objData). CosmeticForm fills its combo with World.Players, whose own row text is
 * PlayerInfo.ToString's "{EntID}: {Name}".
 */
function playerRows(tree) {
    if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return [];
    return Object.keys(tree).map(function (key) {
        const avatar = tree[key] || {};
        const objData = avatar.objData || avatar;
        const raw = objData.entID === undefined || objData.entID === null ? key : objData.entID;
        // PlayerInfo.EntID is an int; a uid that has not been given one yet arrives as the tree's
        // own key. One type keeps the picker's value and a read by hand the same thing.
        const id = /^\d+$/.test(String(raw)) ? Number(raw) : raw;
        const name = objData.uoName == null ? '' : String(objData.uoName);
        return { id: id, name: name, label: id + ': ' + name };
    }).filter(function (player) {
        return player.name !== '';
    });
}

/**
 * A player's wear as the list's rows: CosmeticEquipment.Get's own walk over the wear store, which
 * maps each key through _backMap, drops what it does not know, and sets the slot on each entry.
 * CosmeticEquipment.ToString is the row text. Each row keeps its own slot id as well as its
 * ToString text, because Equip and the per-slot links act on the slot the row came from and the
 * window's own list is the reference's text.
 */
function wearRows(wear) {
    if (!wear || typeof wear !== 'object' || Array.isArray(wear)) return [];
    const rows = [];
    ROWS.forEach(function (row) {
        // The offhand is not in CosmeticEquipment._backMap at all.
        if (!row.listLabel) return;
        const entry = wear[row.code];
        if (!entry || typeof entry !== 'object') return;
        const file = entry.sFile == null ? '' : String(entry.sFile);
        const link = entry.sLink == null ? '' : String(entry.sLink);
        // The reference adds a row for any entry its back map knows, empty boxes included.
        if (file === '' && link === '') return;
        rows.push({ row: row.id, label: row.listLabel, text: row.listLabel + ': ' + join(file, link) });
    });
    return rows;
}

/** One list row's text back into its parts, as the reference's own handlers parse it. */
function parseRow(text) {
    const source = text == null ? '' : String(text);
    const at = source.indexOf(':');
    if (at === -1) return null;
    const label = source.slice(0, at).trim();
    const row = ROWS.filter(function (candidate) { return candidate.listLabel === label; })[0];
    if (!row) return null;
    const value = source.slice(at + 1).trim();
    if (value === '') return null;
    const parts = sides(value);
    return { row: row.id, label: label, file: parts.file, link: parts.link };
}

/** The list minus the rows at `indexes`, as its own Remove loop does (bounding its indices). */
function removeRows(rows, indexes) {
    const list = Array.isArray(rows) ? rows.slice() : [];
    const drop = [];
    (Array.isArray(indexes) ? indexes : []).forEach(function (index) {
        const at = Number(index);
        if (!isNaN(at) && at >= 0 && at < list.length && drop.indexOf(at) === -1) drop.push(at);
    });
    return list.filter(function (row, index) {
        return drop.indexOf(index) === -1;
    });
}

/** Clear All: the reference empties the list and every one of the sixteen text boxes. */
function cleared() {
    return { rows: [], values: emptyValues() };
}

// ------------------------------------------------------------------ the set document

/**
 * A cosmetic set in the Sets window's own shape (Grimoire/UI/Set.cs): a SetItem whose Set is a
 * ISetInterface list of Type/Name items. Each filled row is one entry, in the grid's order, with
 * the row's label as the Type and its "file;link" as the Name - the shape's two fields, used so
 * that the round trip is lossless.
 */
function serializeSet(values) {
    const source = values || {};
    const entries = [];
    ROWS.forEach(function (row) {
        const value = source[row.id];
        if (value == null || String(value) === '') return;
        entries.push({ $type: ENTRY_TYPE, Type: row.listLabel || row.label, Name: String(value) });
    });
    const document = { $type: SET_ITEM_TYPE };
    document.Set = { $type: SET_LIST_TYPE, $values: entries };
    return JSON.stringify(document, null, 2);
}

// The reference's own 24 lines, in the order its save handler writes: a section label, then that
// slot's file and link lines, each section after the first preceded by a blank line.
const FILE_SECTIONS = [
    { label: 'Helmet:', row: 'helm', prefix: 'he', first: true },
    { label: 'Armor:', row: 'armor', prefix: 'co' },
    { label: 'Class:', row: 'class', prefix: 'ar' },
    { label: 'Weapon:', row: 'weapon', prefix: 'Weapon' },
    { label: 'Pet:', row: 'pet', prefix: 'pe' },
    { label: 'Cape:', row: 'cape', prefix: 'ba' },
    { label: 'Off:', row: 'off', prefix: 'off' },
    { label: 'Ground:', row: 'misc', prefix: 'mi' }
];

/** The 24 lines the reference's own btnSaveSet_Click builds, as one text. */
function serializeSetFile(values) {
    const source = values || {};
    const lines = [];
    FILE_SECTIONS.forEach(function (section) {
        const parts = sides(source[section.row]);
        if (!section.first) lines.push('');
        lines.push(section.label);
        lines.push(section.prefix + ' file:' + (parts.file || 'None'));
        lines.push(section.prefix + ' link:' + (parts.link || 'None'));
    });
    return lines.join('\r\n') + '\r\n';
}

/**
 * Read a set file, whichever of the two shapes it is: the reference's 24-line text (or the same
 * lines with the blanks lost, which its positional reader would misload), or a .gset document as
 * the Sets window writes it. Returns { values, unknown, error }.
 */
function parseSetFile(text) {
    const source = typeof text === 'string' && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    if (typeof source !== 'string') return { values: null, unknown: [], error: ERRORS.set };
    if (source.trim() === '') return { values: emptyValues(), unknown: [], error: null };

    const document = tryJson(source);
    if (document) return readDocument(document);
    return readLines(source);
}

function tryJson(text) {
    const trimmed = text.trim();
    if (trimmed.charAt(0) !== '{') return null;
    try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (error) {
        return null;
    }
}

/** A .gset: the SetItem the Sets window writes, read as that shape and no other. */
function readDocument(document) {
    if (document.Set === undefined) return { values: null, unknown: [], error: ERRORS.set };
    let values = document.Set;
    if (values && typeof values === 'object' && !Array.isArray(values)) values = values.$values;
    if (!Array.isArray(values)) return { values: null, unknown: [], error: ERRORS.set };

    const out = emptyValues();
    const unknown = [];
    for (let i = 0; i < values.length; i++) {
        const entry = values[i];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return { values: null, unknown: [], error: ERRORS.set };
        }
        if (typeof entry.Name !== 'string' || typeof entry.Type !== 'string') {
            return { values: null, unknown: [], error: ERRORS.set };
        }
        const row = ROWS.filter(function (candidate) {
            return candidate.listLabel === entry.Type || candidate.label === entry.Type;
        })[0];
        if (!row) {
            unknown.push(entry.Type);
            continue;
        }
        out[row.id] = entry.Name.indexOf(';') === -1 ? join(entry.Name, '') : entry.Name;
    }
    return { values: out, unknown: unknown, error: null };
}

/** The reference's own line file, read by its labels rather than by line number. */
function readLines(text) {
    const out = emptyValues();
    const fields = {};
    let current = null;
    text.split(/\r?\n/).forEach(function (line) {
        const label = line.trim();
        const section = FILE_SECTIONS.filter(function (candidate) {
            return candidate.label === label;
        })[0];
        if (section) {
            current = section.row;
            return;
        }
        const at = line.indexOf(':');
        if (at === -1 || !current) return;
        const name = line.slice(0, at).trim();
        const value = line.slice(at + 1);
        if (!/ file$| link$/.test(name)) return;
        fields[current] = fields[current] || {};
        fields[current][name.slice(-4).trim()] = value === 'None' ? '' : value;
    });

    const seen = Object.keys(fields);
    if (!seen.length) return { values: null, unknown: [], error: ERRORS.set };
    seen.forEach(function (row) {
        out[row] = join(fields[row].file, fields[row].link);
    });
    return { values: out, unknown: [], error: null };
}

module.exports = {
    SET_ITEM_TYPE: SET_ITEM_TYPE,
    SET_LIST_TYPE: SET_LIST_TYPE,
    ENTRY_TYPE: ENTRY_TYPE,
    ERRORS: ERRORS,
    ROWS: ROWS,
    GRAB_LINKS: GRAB_LINKS,
    BUTTONS: BUTTONS,
    WINDOW_TITLE: WINDOW_TITLE,
    CODE_TO_ROW: CODE_TO_ROW,
    FILE_SECTIONS: FILE_SECTIONS,
    rowById: rowById,
    emptyValues: emptyValues,
    join: join,
    sides: sides,
    playerRows: playerRows,
    wearRows: wearRows,
    parseRow: parseRow,
    removeRows: removeRows,
    cleared: cleared,
    serializeSet: serializeSet,
    serializeSetFile: serializeSetFile,
    parseSetFile: parseSetFile
};
