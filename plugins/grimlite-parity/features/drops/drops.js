// The drop list's own logic (ticket #33). Reference: Grimlite-Li 816d9cd,
// Grimoire/UI/DropUi.cs (+ .Designer.cs) for the window, Grimoire/Game/DropStack.cs for the stack
// and the getDrop frame, and Grimoire/Networking/Handlers/HandlerDropItem.cs for the frame this is
// fed by. The two flags come from Grimoire/Game/Data/InventoryItem.cs: bCoins -> IsAcItem,
// bUpg -> IsMemberOnly, both through its own BoolConverter (0/1 in the frame, bool in the model).
//
// Nothing here reaches Flash, a socket or a window. The frame parser, the list and the "can the
// player take it" test are pure, so they are driven straight from the fixtures under
// test/fixtures/grimlite-drops and need no running game.

const COOLDOWN_MS = 3000;   // DropStack's own 3 s per-item cooldown

// DFrame2MC.yClick's two notifications, word for word: the game's own words, so a row that cannot
// be taken reads the same here as the game would say it.
const FULL_BAG = 'Item Inventory Full!';
const FULL_MISC = 'Misc Inventory Full!';
const FULL_HOUSE = 'House Inventory Full!';

const OUTCOMES = {
    added: 'added',
    rejected: 'rejected',
    blacklisted: 'blacklisted'
};

/** The reference's own BoolConverter: the frame writes these as 0/1, a model may carry bools. */
function flag(value) {
    return value === 1 || value === true || value === '1' || value === 'true';
}

function number(value) {
    return typeof value === 'number' && isFinite(value) ? value : null;
}

function text(value) {
    return value === null || value === undefined ? '' : String(value);
}

// ------------------------------------------------ InvCat, the game's own inventory categories

// InvCat.MISC_TYPES, and its own numeric-meta exception: an "Item" whose sMeta is all digits is a
// stackable resource and counts as bag space rather than misc space.
const MISC_TYPES = ['Item', 'Note', 'Quest Item', 'Resource'];
const NUMERIC_META = /^\s*\d+\s*$/;
const HOUSE_TYPES = ['House', 'Wall Item', 'Floor Item', 'Guild'];

// A drop is read off the wire (sType / bCoins / bUpg / iQty, an InventoryItem) or off this list's
// own row (category / isAcItem / isMemberOnly / quantity); every test below takes either.
function typeOf(item) {
    return text(item && (item.category !== undefined ? item.category : item.sType));
}

function idOf(item) {
    return item && (item.id !== undefined ? item.id : item.ItemID);
}

function quantityOf(item) {
    return item && (item.quantity !== undefined ? item.quantity : item.iQty);
}

function isClass(item) {
    return item !== null && item !== undefined && typeOf(item) === 'Class';
}

/** InvCat.isMisc. */
function isMisc(item) {
    if (!item) return false;
    const type = typeOf(item);
    if (MISC_TYPES.indexOf(type) === -1) return false;
    return !(type === 'Item' && item.sMeta !== null && item.sMeta !== undefined &&
        NUMERIC_META.test(String(item.sMeta)));
}

/** InvCat.isHouse, and the game's own isHouseItem (Game.as:6885). */
function isHouse(item) {
    if (!item) return false;
    const house = item.bHouse;
    return house === 1 || house === true || house === '1' || HOUSE_TYPES.indexOf(typeOf(item)) !== -1;
}

/** InvCat.isBag: everything that is neither a class, a misc item nor a house item. */
function isBag(item) {
    return !!item && !isClass(item) && !isMisc(item) && !isHouse(item);
}

function countWhere(items, test) {
    return (Array.isArray(items) ? items : []).filter(test).length;
}

function owned(items, id) {
    const list = Array.isArray(items) ? items : [];
    for (let i = 0; i < list.length; i++) {
        if (list[i] && String(idOf(list[i])) === String(id)) return list[i];
    }
    return null;
}

/**
 * Whether this drop could go into the bag at all - DFrame2MC.yClick's own gate, which is
 * InvCat.isFullFor with the game's two notifications. The answer is the game's own words, so a
 * caller can show them rather than paraphrase them.
 *
 * A slot count nobody could read is not a full bag: "cannot take it" and "nobody knows" must not
 * look the same, so an unknown count answers takeable.
 *
 * @param {object} drop the row or the item
 * @param {Array} items the bag (world.myAvatar.items)
 * @param {{bag: number|null, house: number|null}} slots iBagSlots / iHouseSlots
 * @param {Array} [houseItems] world.myAvatar.houseitems
 * @returns {{ok: boolean, reason: string|null}}
 */
function takeable(drop, items, slots, houseItems) {
    const limits = slots || {};
    const house = Array.isArray(houseItems) ? houseItems : [];

    if (isHouse(drop)) {
        const houseSlots = number(limits.house);
        if (houseSlots === null) return { ok: true, reason: null };
        return house.length >= houseSlots
            ? { ok: false, reason: FULL_HOUSE }
            : { ok: true, reason: null };
    }
    // InvCat.isFullFor returns false for a class before it looks at anything else.
    if (isClass(drop)) return { ok: true, reason: null };

    const bagSlots = number(limits.bag);
    if (bagSlots === null) return { ok: true, reason: null };

    // A stack of this item with room left is never "full", whatever else the bag holds.
    const held = owned(items, idOf(drop));
    if (held && Number(quantityOf(held)) < Number(held.iStk)) return { ok: true, reason: null };

    if (isMisc(drop)) {
        // InvCat.isFullFor's own misc branch, unusual as it looks: it compares the number of misc
        // items already held against the whole bag's slots, not the bag's own contents. That is
        // the game's test, and it is the one that decides whether its own take button fires.
        if (!held && countWhere(items, isMisc) >= bagSlots) return { ok: false, reason: FULL_MISC };
        return { ok: true, reason: null };
    }
    if (countWhere(items, isBag) >= bagSlots) return { ok: false, reason: FULL_BAG };
    return { ok: true, reason: null };
}

// ------------------------------------------------ the frame

/**
 * One relaying frame as a drop, or null when it is not one.
 *
 * The shape is the reference's: a JSON envelope whose b.o.cmd is "dropItem" and whose b.o.items is
 * a map keyed by item id (Grimoire/Networking/JsonMessage.cs: DataObject is Object["b"]["o"]).
 * HandlerDropItem takes `items.First().Value` - the first entry and nothing else - so a frame
 * carrying several items offers exactly one, which is the reference's own behaviour and not a
 * limitation added here. "First" is document order, not key order: Newtonsoft's JObject walks the
 * properties as they were sent, while a JavaScript object orders integer-like keys ascending, so
 * the first entry is taken off the raw text rather than out of the parsed object.
 *
 * @param {string} frame the frame text, with its NUL terminator already stripped
 * @returns {{id: number, name: string, category: string, isAcItem: boolean,
 *            isMemberOnly: boolean, quantity: number}|null}
 */
function parseDropFrame(frame) {
    if (typeof frame !== 'string' || frame.charAt(0) !== '{') return null;
    let envelope;
    try {
        envelope = JSON.parse(frame);
    } catch (error) {
        // A frame that will not parse is not a drop; it is somebody else's traffic.
        return null;
    }
    const body = envelope && envelope.b && envelope.b.o ? envelope.b.o : null;
    if (!body || body.cmd !== 'dropItem') return null;
    const items = body.items;
    if (!items || typeof items !== 'object' || Array.isArray(items)) return null;

    const raw = firstEntry(frame, items);
    if (!raw || typeof raw !== 'object') return null;

    const row = toRow(raw);
    if (row.name === '' || row.id === null) return null;
    return row;
}

/**
 * The first entry of `items` in the order the frame carries them, or the object's own first key
 * when the text cannot be walked. The frame is only searched after "items" is found, so an item
 * object's own nested braces cannot be mistaken for the map.
 */
function firstEntry(frame, items) {
    const at = frame.indexOf('"items"');
    if (at !== -1) {
        const open = frame.indexOf('{', at);
        if (open !== -1) {
            const key = /^\s*"((?:[^"\\]|\\.)*)"\s*:/.exec(frame.slice(open + 1));
            if (key) {
                const value = extractObject(frame, open + 1 + key[0].length);
                if (value) {
                    try {
                        return JSON.parse(value);
                    } catch (error) {
                        // Fall through to the parsed object below.
                    }
                }
            }
        }
    }
    const keys = Object.keys(items);
    return keys.length ? items[keys[0]] : null;
}

/** The balanced `{...}` starting at (or after) `from`, or null when it never closes. */
function extractObject(text, from) {
    const start = text.indexOf('{', from);
    if (start === -1) return null;
    let depth = 0;
    let quoted = false;
    for (let i = start; i < text.length; i++) {
        const ch = text.charAt(i);
        if (quoted) {
            if (ch === '\\') i++;
            else if (ch === '"') quoted = false;
            continue;
        }
        if (ch === '"') { quoted = true; continue; }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return text.slice(start, i + 1);
        }
    }
    return null;
}

/**
 * One relaying frame as the answer to a take, or null when it is not one.
 *
 * The other half of the pair Flash.cs reads: case "getDrop" looks at `bSuccess`, and Game.as's own
 * case plays the frame out on 1 ("Item could not be added..." otherwise). The item is named by
 * `ItemID`, not by the items map a drop frame carries.
 *
 * @param {string} frame the frame text
 * @returns {{id: number|null, success: boolean}|null}
 */
function parseGetDropFrame(frame) {
    if (typeof frame !== 'string' || frame.charAt(0) !== '{') return null;
    let envelope;
    try {
        envelope = JSON.parse(frame);
    } catch (error) {
        return null;
    }
    const body = envelope && envelope.b && envelope.b.o ? envelope.b.o : null;
    if (!body || body.cmd !== 'getDrop') return null;
    const id = Number(body.ItemID);
    // An answer that names no item is not one this window can act on, so it is not an answer.
    if (!isFinite(id) || id <= 0) return null;
    return {
        id: id,
        // The reference's own test: `Convert.ToInt32(data.bSuccess) == 1`.
        success: Number(body.bSuccess) === 1
    };
}

/** An item off the wire or a list row, as the six fields this window draws. */
function toRow(item) {
    const id = idOf(item);
    const quantity = Number(quantityOf(item));
    return {
        id: id === null || id === undefined || id === '' ? null : Number(id),
        name: text(item && (item.name !== undefined ? item.name : item.sName)).trim(),
        category: typeOf(item),
        isAcItem: flag(item && (item.isAcItem !== undefined ? item.isAcItem : item.bCoins)),
        isMemberOnly: flag(item && (item.isMemberOnly !== undefined ? item.isMemberOnly : item.bUpg)),
        quantity: isFinite(quantity) && quantity > 0 ? quantity : 1
    };
}

// ------------------------------------------------ the list

/**
 * The stack the reference keeps in DropStack and draws in DropUi, as data: rows keyed by item id,
 * a quantity per row, a per-session name blacklist and a rejecting switch.
 *
 * options: { now() } - the clock the cooldown is measured against, injected so a test need not
 * wait three seconds.
 */
function createDropList(options) {
    const settings = options || {};
    const now = typeof settings.now === 'function' ? settings.now : function () { return Date.now(); };

    let rows = [];
    const blacklisted = [];
    const cooling = {};
    let rejecting = false;

    function indexOfName(name) {
        const want = text(name).toLowerCase();
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].name.toLowerCase() === want) return i;
        }
        return -1;
    }

    function indexOfId(id) {
        for (let i = 0; i < rows.length; i++) {
            if (String(rows[i].id) === String(id)) return i;
        }
        return -1;
    }

    return {
        /**
         * DropUi.AddItem: a blacklisted name is ignored, a name already on the list gains the new
         * quantity, and anything else becomes its own row. The check is case-insensitive, as the
         * reference's EqualsIgnoreCase is.
         */
        offer: function (item) {
            const row = toRow(item);
            if (row.name === '') return OUTCOMES.rejected;
            if (blacklisted.indexOf(row.name.toLowerCase()) !== -1) return OUTCOMES.blacklisted;
            if (rejecting) return OUTCOMES.rejected;

            const at = indexOfName(row.name);
            if (at !== -1) {
                rows[at].quantity += row.quantity;
                return OUTCOMES.added;
            }
            rows.push(row);
            return OUTCOMES.added;
        },

        /** The list as the window draws it: one entry per row, in the order they dropped. */
        rows: function () {
            return rows.map(function (row) { return Object.assign({}, row); });
        },

        /** DropUi.UpdateDropCount: the number of rows, not the number of items in them. */
        count: function () { return rows.length; },

        /** The row for a name, or null. Case-insensitive, as the reference's own lookups are. */
        find: function (name) {
            const at = indexOfName(name);
            return at === -1 ? null : Object.assign({}, rows[at]);
        },

        /** "Reject ingame drop": while it is on, nothing new is accepted (and nothing dropped). */
        setRejecting: function (on) { rejecting = on === true; },
        rejecting: function () { return rejecting; },

        /**
         * Reject & Blacklist: the selected names leave the list and are held for the session, so
         * the same item dropping again is not offered. Returns how many rows went.
         */
        blacklist: function (names) {
            const wanted = (Array.isArray(names) ? names : []).map(function (name) {
                return text(name).toLowerCase();
            });
            if (!wanted.length) return 0;
            let removed = 0;
            rows = rows.filter(function (row) {
                if (wanted.indexOf(row.name.toLowerCase()) === -1) return true;
                removed++;
                return false;
            });
            wanted.forEach(function (name) {
                if (blacklisted.indexOf(name) === -1) blacklisted.push(name);
            });
            return removed;
        },

        /** The names held for this session. */
        blacklisted: function () { return blacklisted.slice(); },

        /**
         * DropUi.clearDrop: the rows always. The blacklist goes only on the first confirmed
         * Clear (btnClear_Click calls clearDrop then blacklisted.Clear once); a later Clear drops
         * the rows and leaves the blacklist standing.
         */
        clear: function (withBlacklist) {
            rows = [];
            if (withBlacklist !== false) blacklisted.length = 0;
            Object.keys(cooling).forEach(function (key) { delete cooling[key]; });
        },

        /** DropStack.GetDrop's frame: `%xt%zm%getDrop%{roomId}%{itemId}%`. */
        takeFrame: function (roomId, id) {
            return '%xt%zm%getDrop%' + text(roomId) + '%' + text(id) + '%';
        },

        /**
         * The gate DropStack.GetDrop puts in front of its frame: an item not on the list is not
         * asked for, and one asked for in the last three seconds is still cooling down. The
         * attempt is recorded here (the reference records it once its frame is on its way).
         */
        beginTake: function (id) {
            if (indexOfId(id) === -1) return { ok: false, reason: 'not-held' };
            const key = String(id);
            const at = cooling[key];
            if (at !== undefined && now() - at < COOLDOWN_MS) return { ok: false, reason: 'cooling' };
            cooling[key] = now();
            return { ok: true, reason: null };
        },

        /**
         * The getDrop answer: a successful take takes the row out (Game.as case "getDrop" plays
         * the frame out on bSuccess == 1), a failed one leaves it standing for another try.
         */
        settle: function (id, success) {
            if (success !== true) return false;
            const at = indexOfId(id);
            if (at === -1) return false;
            rows.splice(at, 1);
            return true;
        }
    };
}

module.exports = {
    COOLDOWN_MS: COOLDOWN_MS,
    OUTCOMES: OUTCOMES,
    FULL_BAG: FULL_BAG,
    FULL_MISC: FULL_MISC,
    FULL_HOUSE: FULL_HOUSE,
    MISC_TYPES: MISC_TYPES,
    parseDropFrame: parseDropFrame,
    parseGetDropFrame: parseGetDropFrame,
    firstEntry: firstEntry,
    toRow: toRow,
    takeable: takeable,
    createDropList: createDropList
};
