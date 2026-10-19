// The Bot Manager's controls that act on the running game (#36).
//
// Two measured facts decide how each one is served, and the second is why this is a file rather
// than a few inline calls in the page.
//
// 1. The reference client does not read the stock game for most of its own data. It ships its own
//    loader (Loader/grimoire.swf), implements a helper surface there, and Flash.Call drives THAT.
//    Our bridge loads the stock game and exposes one generic surface (getGameObject and friends),
//    so a name that lives only in the reference's loader answers "no member ... at world".
//    Measured by searching each SWF's decompressed bytes for the name with its u30 length prefix,
//    which is what makes it a constant-pool entry rather than a substring of a longer identifier
//    (a plain search wrongly finds Cell inside GetCellPlayers):
//
//      in the stock game : strFrame, strPad, strMapName, actions, active, Pad, Map
//      the loader only   : Cell, Position, RoomNumber, SetSpawnPoint, ReloadMap, HideConnMC,
//                          SetFPS, GetSkillName, GetInventoryItems, GetBankItems,
//                          UsedInventorySlots, IsLoggedIn
//
// 2. The reachable controls need the names the stock game does have, and the reference's own
//    loader reads the same ones: grimoire.game.Player.as resolves its cell from world.strFrame,
//    with pad and map alongside (docs/research/grimlite-bridge.md:256, state paths at :267). So a
//    dot-path read here is not a stand-in for the loader's call - it is the source that call reads.
//
// A control is therefore either a dot-path read the generic surface can walk, or it carries the
// one thing it is waiting for. Nothing is invented, and a control that cannot work says so rather
// than failing quietly: an empty cell box is indistinguishable from standing nowhere.

/** The dot-paths the generic bridge surface can walk, by the name the window asks for. */
const READS = {
    cell: 'world.strFrame',
    pad: 'world.strPad',
    map: 'world.strMapName'
};

function loaderOnly(name) {
    return 'the stock game has no "' + name + '": the reference serves it from its own loader ' +
        '(Loader/grimoire.swf), so this control waits on the bridge helper surface';
}

/**
 * The buttons that act on the game, keyed by the control id the sheet draws. A reachable button
 * carries the fields its read fills and the modifier branch the reference gives it
 * (btnCurrCell_Click, btnGetMapF_Click, btnCellSwap_Click); a blocked one carries the helper it
 * waits for.
 */
const GAME_BUTTONS = {
    // btnCurrCell_Click: fill the cell and pad boxes from where the player stands.
    btnCurrCell: {
        reads: ['cell', 'pad'],
        plain: { txtCell: 'cell', txtPad: 'pad' },
        alt: { append: { txtCell: 'cell', txtPad: 'pad' } }
    },
    // btnGetMapF_Click: the Hunt tab's Get. The plain branch reads map, cell and pad; ctrl appends
    // the literal "-[room]" and alt also appends the two cells (bot-manager.js's own transform).
    btnGetMapF: {
        reads: ['map', 'cell', 'pad'],
        plain: { tbMapF: 'map', tbCellF: 'cell', tbPadF: 'pad' }
    },

    // btnWalkCur_Click: Player.Position, which the loader composes for itself.
    btnWalkCur: { needs: 'Position' },
    // btnCellSwap_Click and its ">" twin: Player.Map + RoomNumber into the join box.
    btnCellSwap: { needs: 'RoomNumber' },
    button2: { needs: 'RoomNumber' },
    // btnSetSpawn2_Click, btnReloadMap_Click, btnHideLoading_Click, btnSetFPS_Click: each is one
    // Flash.Call into the loader's own surface.
    btnSetSpawn2: { needs: 'SetSpawnPoint' },
    btnReloadMap: { needs: 'ReloadMap' },
    btnHideLoading: { needs: 'HideConnMC' },
    btnSetFPS: { needs: 'SetFPS' },

    // Not a game read and not a loader helper either: btnSetLevel_Click hands a "levelUp" frame to
    // the client the way the server would. That path is the bridge's sendClientPacket, which is
    // still unverified against a live client (docs/FLASH_CHECKLIST.md, ticket #28).
    btnSetLevel: {
        why: 'the reference injects a "levelUp" frame as if the server had sent it; this window ' +
            'sends nothing yet - the bridge sendClientPacket path is unverified (ticket #28)'
    },
    // btnchangeName_Click and btnchangeGuild_Click keep a name locally, and the reference's own
    // join handler substitutes it for what the server sends. That handler is the bot engine
    // (ticket #37), so there is nothing for the window to set on its own.
    btnchangeName: {
        why: 'the reference keeps this name locally and its join handler substitutes it for what ' +
            'the server sends; that handler is the bot engine (ticket #37)'
    },
    btnchangeGuild: {
        why: 'the reference keeps this guild locally and its join handler substitutes it for what ' +
            'the server sends; that handler is the bot engine (ticket #37)'
    }
};

/** What a control is waiting for, in the words the window shows. */
function why(spec, id) {
    if (spec.why) return spec.why;
    if (spec.needs) return loaderOnly(spec.needs);
    return 'this control is not wired yet';
}

/** The variant a modifier selects, when the reference gives that branch its own behaviour. */
function variantOf(spec, modifiers) {
    const mods = modifiers || {};
    if (mods.alt && spec.alt) return spec.alt;
    if (mods.ctrl && spec.ctrl) return spec.ctrl;
    return null;
}

/** The control ids the sheet hands the page, so none of them is drawn as a dead button. */
function ids() {
    return Object.keys(GAME_BUTTONS);
}

module.exports = {
    READS: READS,
    GAME_BUTTONS: GAME_BUTTONS,
    why: why,
    variantOf: variantOf,
    ids: ids
};
