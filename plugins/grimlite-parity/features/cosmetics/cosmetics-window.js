// The Cosmetics window's main-process half. The page draws the reference's own grid and holds the
// list; every decision that needs the game, a file or the slot map lives here, in cosmetics.js,
// and in cosmetics-dialogs.js. The window is sandboxed, so all of it crosses this IPC edge.
const cosmetics = require('./cosmetics.js');
const { createFromHost: createDialogsFromHost } = require('./cosmetics-dialogs.js');

function createCosmeticsWindow(deps) {
    deps = deps || {};
    const game = deps.game;
    const dialogs = deps.dialogs;

    function message(error) {
        return (error && error.message) || String(error);
    }

    async function setSlot(rowId, value) {
        const row = cosmetics.rowById(rowId);
        if (!row) return { ok: false, error: cosmetics.ERRORS.slot };
        const parts = cosmetics.sides(value);
        try {
            return await game.setSlot(row.code, parts.file, parts.link);
        } catch (error) {
            return { ok: false, error: message(error) };
        }
    }

    function handle(channel, args) {
        if (channel === 'cosmeticRows') return Promise.resolve(cosmetics.ROWS);
        if (channel === 'cosmeticGrabLinks') return Promise.resolve(cosmetics.GRAB_LINKS);
        if (channel === 'cosmeticButtons') return Promise.resolve(cosmetics.BUTTONS);
        if (channel === 'cosmeticMessages') return Promise.resolve(deps.messages || {});
        if (channel === 'cosmeticPlayers') return guardPlayers();
        if (channel === 'cosmeticGrab') return grab(args && args[0]);
        if (channel === 'cosmeticGrabSlot') return grabSlot(args && args[0], args && args[1], args && args[2]);
        if (channel === 'cosmeticSet') return setThen(args && args[0], args && args[1]);
        if (channel === 'cosmeticEquip') return equip(args && args[0]);
        if (channel === 'cosmeticRemove') return Promise.resolve(cosmetics.removeRows(args && args[0], args && args[1]));
        if (channel === 'cosmeticClear') return Promise.resolve(cosmetics.cleared());
        if (channel === 'cosmeticSave') return dialogs.save(args && args[0]);
        if (channel === 'cosmeticLoad') return load();
        throw new Error('[AquaStar:grimlite-parity] unknown cosmetics channel "' + channel + '"');
    }

    // ------------------------------------------------------------------ the picker

    async function guardPlayers() {
        try {
            return await game.readPlayers();
        } catch (error) {
            return { players: [], error: message(error) };
        }
    }

    async function wear(id) {
        try {
            return await game.readWear(id);
        } catch (error) {
            return { wear: null, error: message(error) };
        }
    }

    // Grab: CosmeticForm.cs's btnGrabCosm_Click, which appends the chosen player's whole wear to
    // the list, bracketed by a single-space separator row.
    //
    // That separator is a defect and is not copied. The reference's own Equip All casts every row
    // to CosmeticEquipment before equipping it (btnCopyAll_Click), so with a separator in the list
    // it equips the rows before the first separator and then throws on it into a bare catch - the
    // same for Equip Selected, whose first separator row is not selectable at all. Here the rows
    // are plain data, so all of them equip and the behaviour is the one the ticket asks for.
    //
    // The worn values come back with the rows so the window can fill its eight boxes from them:
    // ticket #30 asks Grab to fill the slot fields, and a per-slot link or a double-click fills
    // one row at a time from the same read.
    async function grab(id) {
        const read = await wear(id);
        if (read.error) return { rows: [], values: {}, error: read.error };
        const rows = cosmetics.wearRows(read.wear);
        const values = {};
        rows.forEach(function (row) {
            values[row.row] = row.text.slice(row.text.indexOf(': ') + 2);
        });
        return { rows: rows, values: values, error: null };
    }

    // The per-slot links: one row's value, and only when that row is still empty (or already holds
    // the same file), which is the guard the reference's own link handler applies per slot.
    async function grabSlot(id, rowId, current) {
        const row = cosmetics.rowById(rowId);
        if (!row || !row.listLabel) {
            return { applied: false, text: '', fields: cosmetics.sides(''), error: cosmetics.ERRORS.notGrabbable };
        }
        const read = await wear(id);
        if (read.error) {
            return { applied: false, text: '', fields: cosmetics.sides(''), error: read.error };
        }
        const found = cosmetics.wearRows(read.wear).filter(function (candidate) {
            return candidate.row === rowId;
        })[0];
        if (!found) {
            return { applied: false, text: '', fields: cosmetics.sides(''), error: cosmetics.ERRORS.noWear };
        }
        const held = cosmetics.sides(current);
        const next = cosmetics.sides(found.text.slice(found.text.indexOf(': ') + 2));
        // The reference compares the box it is about to overwrite: an empty box, or one already
        // holding this same file, is filled; anything else the user typed is left alone.
        if (held.file !== '' && held.file !== next.file) {
            return { applied: false, text: found.text, fields: next, error: null };
        }
        return { applied: true, text: found.text, fields: next, error: null };
    }

    // ------------------------------------------------------------------ the list's actions

    // A Set button applies one row. The reference's own handler is silent about a refusal; here
    // the window is told, so a button that did nothing does not look like one that worked.
    async function setThen(rowId, value) {
        return setSlot(rowId, value);
    }

    // Equip All and Equip Selected: the list's rows, in file order, each through its own slot code.
    async function equip(rows) {
        const list = Array.isArray(rows) ? rows : [];
        let applied = 0;
        for (let i = 0; i < list.length; i++) {
            const entry = list[i] || {};
            const parsed = entry.text ? cosmetics.parseRow(entry.text) : entry;
            const row = parsed && parsed.row ? cosmetics.rowById(parsed.row) : null;
            if (!row) continue;
            const value = parsed.file === undefined ? entry.value || '' : cosmetics.join(parsed.file, parsed.link);
            const parts = cosmetics.sides(value);
            let answer;
            try {
                answer = await game.setSlot(row.code, parts.file, parts.link);
            } catch (error) {
                answer = { ok: false, error: message(error) };
            }
            if (!answer || !answer.ok) {
                // The run stops where the game stopped refusing: what did not go out is not applied.
                return { applied: applied, error: (answer && answer.error) || 'the game did not answer' };
            }
            applied++;
        }
        return { applied: applied, error: null };
    }

    async function load() {
        const opened = await dialogs.open();
        if (opened.canceled) return { canceled: true };
        if (opened.error || !opened.values) {
            return { canceled: false, values: null, error: opened.error || cosmetics.ERRORS.set };
        }
        return { canceled: false, values: opened.values, path: opened.path, error: null };
    }

    function attachTo(host) {
        [
            'cosmeticRows', 'cosmeticGrabLinks', 'cosmeticButtons', 'cosmeticMessages',
            'cosmeticPlayers', 'cosmeticGrab', 'cosmeticGrabSlot', 'cosmeticSet', 'cosmeticEquip',
            'cosmeticRemove', 'cosmeticClear', 'cosmeticSave', 'cosmeticLoad'
        ].forEach(function (channel) {
            host.ipc.handle(channel, function (event) {
                void event;
                return handle(channel, Array.prototype.slice.call(arguments, 1));
            });
        });
    }

    return { handle: handle, attachTo: attachTo };
}

/** The window as the plugin uses it: the page's channels, the game access, the dialogs. */
function createFromHost(host, deps) {
    deps = deps || {};
    const window = createCosmeticsWindow({
        game: deps.game || require('./game-access.js').createGameAccess({
            bridge: host.bridge,
            log: function (msg) { host.log(msg); }
        }),
        dialogs: deps.dialogs || createDialogsFromHost(host, deps),
        messages: (typeof host.getLocaleStrings === 'function' &&
            host.getLocaleStrings('cosmeticsMessages')) || {}
    });
    window.attachTo(host);
    return window;
}

module.exports = {
    createCosmeticsWindow: createCosmeticsWindow,
    createFromHost: createFromHost
};
