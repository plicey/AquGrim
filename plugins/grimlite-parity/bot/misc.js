// The pure rules behind the miscellaneous commands (#40). Reference: Grimlite-Li 816d9cd,
// Grimoire/Botting/Commands/Misc/*.cs. Everything here is a function of its arguments, so a
// handler in engine.js stays thin and every branch is testable without a game.
//
// Three of the reference's own rewrites live here, unchanged, because a bot authored against it
// depends on them:
//
//   * CmdPacket and CmdPacketDelay rewrite a frame before it goes out: {ROOM_ID}, {ROOM_NUMBER},
//     PLAYERNAME and {GETMAP} are substituted, a run of dashes collapses to one (its own regex is
//     "-{1,}"), and an "1e<digits>" stamp becomes a random number in [1001, 99999).
//   * a client-side frame that starts with "Level " is replaced wholesale by the levelUp JSON
//     the client's own chat handler expects, rather than being sent as written.
//   * CmdLoadBot resolves its path the way the reference resolves it - relative to the folder its
//     own Bots/ directory sits in. On Linux that folder is the bots directory the user chose
//     (Settings -> Bots directory), which is the adaptation the ticket asks for; see
//     resolveBotPath for why both spellings of a saved path land on the same file.

const path = require('path');

/** The reference's own Random.Next(1001, 99999), behind a seam a test can pin. */
function defaultRandom() {
    return {
        next: function (min, max) {
            return min + Math.floor(Math.random() * (max - min));
        }
    };
}

/** Fill a template's placeholders with the values that were actually read. */
function fill(text, pairs) {
    let out = text;
    pairs.forEach(function (pair) {
        if (pair[1] === undefined || pair[1] === null) return;
        out = out.split(pair[0]).join(String(pair[1]));
    });
    return out;
}

/**
 * CmdPacket's and CmdPacketDelay's own rewrite of one frame, in the reference's own order:
 *
 *   text.Replace("{ROOM_ID}", RoomId).Replace("{ROOM_NUMBER}", RoomNumber)
 *       .Replace("PLAYERNAME", Username).Replace("{GETMAP}", Map)
 *   while (text.Contains("--")) text = Regex("-{1,}").Replace(text, "-");
 *   text = Regex("(1e)[0-9]{1,}").Replace(text, Random.Next(1001, 99999));
 *
 * A value that could not be read is left as it was written, so a frame never carries an empty
 * field where the game's own answer belongs: the caller reports the read that failed instead.
 */
function packetText(text, values, random) {
    const source = String(text === null || text === undefined ? '' : text);
    const known = values || {};
    const rng = random || defaultRandom();
    let out = fill(source, [
        ['{ROOM_ID}', known.roomId],
        ['{ROOM_NUMBER}', known.roomNumber],
        ['PLAYERNAME', known.username],
        ['{GETMAP}', known.map]
    ]);
    while (out.indexOf('--') !== -1) out = out.replace(/-{1,}/g, '-');
    return out.replace(/1e[0-9]+/gi, function () { return String(rng.next(1001, 99999)); });
}

/**
 * The frame a client-side "Level n" packet becomes (CmdPacket's own branch):
 *
 *   {"t":"xt","b":{"r":-1,"o":{"cmd":"levelUp","intExpToLevel":"200000","intLevel":n}}}
 *
 * Anything that is not a level frame is handed back as null, so the caller sends it as written.
 */
function levelUpPacket(text) {
    const parts = String(text === null || text === undefined ? '' : text).split(' ');
    if (parts[0] !== 'Level' || !parts[1]) return null;
    return '{"t":"xt","b":{"r":-1,"o":{"cmd":"levelUp","intExpToLevel":"200000",' +
        '"intLevel":' + parts[1] + '}}}';
}

/**
 * CmdLoadBot's path, as the reference resolves it: 'if (File.Exists(path))' over the command's
 * own BotFilePath, which is relative to the process's directory because that is where its Bots/
 * folder sits.
 *
 * The counterpart of that directory here is the bots directory (Settings -> Bots directory,
 * default <appData>/Bots), so:
 *
 *   'Arcana/lovers.gbot'       -> <bots>/Arcana/lovers.gbot   (what this app's tree writes)
 *   'Bots/Arcana/lovers.gbot'  -> <bots>/Arcana/lovers.gbot   (what a Windows client wrote: its
 *                                path is relative to the folder ABOVE Bots/, and that folder IS
 *                                the bots directory here)
 *   '/home/player/other.gbot'  -> itself                      (absolute, used as it is)
 *
 * A relative path is tried as it stands first, because that is what the reference does with it,
 * and a path that is nowhere is null rather than an invention.
 *
 * @param {string} written the command's own BotFilePath
 * @param {string} root the bots directory
 * @param {(file: string) => boolean} exists
 * @returns {string|null} the file to read
 */
function resolveBotPath(written, root, exists) {
    const text = String(written === null || written === undefined ? '' : written).replace(/\\/g, '/');
    if (!text) return null;
    const file = function (candidate) {
        return candidate && typeof exists === 'function' && exists(candidate) ? candidate : null;
    };
    if (path.isAbsolute(text)) return file(text);
    const direct = file(text);
    if (direct) return direct;
    if (!root) return null;
    const inRoot = file(path.join(root, text));
    if (inRoot) return inRoot;
    const below = text.replace(/^Bots\//i, '');
    if (below !== text) return file(path.join(root, below));
    return null;
}

/** One clock reading, formatted the three ways CmdLog's own templates ask for. */
function times(now) {
    const two = function (value) { return value < 10 ? '0' + value : String(value); };
    const hours = now.getHours();
    const twelve = hours % 12 === 0 ? 12 : hours % 12;
    const stamp = two(hours) + ':' + two(now.getMinutes()) + ':' + two(now.getSeconds());
    return {
        plain: stamp,
        twelve: two(twelve) + ':' + two(now.getMinutes()) + ':' + two(now.getSeconds()) +
            (hours < 12 ? ' AM' : ' PM'),
        twentyFour: stamp
    };
}

/** The item a {ITEM: x} template names, by the loader's own field names (iQty / iStk). */
function itemOf(items, name) {
    const want = String(name === null || name === undefined ? '' : name);
    const list = Array.isArray(items) ? items : [];
    for (let i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].sName) === want) return list[i];
    }
    return null;
}

/** The faction a {REP ...: x} template names; one the player has none of reads as zeros. */
function factionOf(factions, name) {
    const want = String(name === null || name === undefined ? '' : name);
    const list = Array.isArray(factions) ? factions : [];
    for (let i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].sName) === want) return list[i];
    }
    return {};
}

function numberOr(value, fallback) {
    const number = Number(value);
    return isFinite(number) ? number : fallback;
}

/**
 * A refusal, carrying the surface own reason for the name that was refused.
 *
 * Two callers say the same thing differently. The real bridge rejects with the surface row's own
 * sentence already inside it (loader-surface.js's unsupported()), while a stand-in session - and
 * a bridge that has not learned the row yet - rejects in its own words. Both have to reach the log
 * with the reason a user can act on, so the reason is added only when it is not already there and
 * only when the row has one; an implemented name or an unknown one adds nothing.
 *
 * @param {string} said   what the refusal itself said
 * @param {object} [row]  the surface row for the name ({ why } when it cannot be answered)
 * @param {string} [name] the helper name, for the sentence
 */
function refusalText(said, row, name) {
    const why = row && row.why;
    if (!why || String(said).indexOf(why) !== -1) return String(said);
    return said + " - the surface own reason for " + name + ": " + why;
}

/**
 * CmdLog's own text: the template substitutions, then the backslash colour segments.
 *
 * Reference: 'string[] parts = filteredText.Split(backslash)' - the first part is the message and
 * each later part a colour; the message keeps its own '>...<' markers as colour slots, and the
 * pane is handed the message with every marker removed. Both shapes come back: 'marked' is what
 * a ModMessage pushes into the chat, 'plain' is what the log pane shows.
 *
 * A template whose value was not read is left as written (the caller reports the failed reads);
 * an item or faction the game does not have reads as the reference's own empty object - zeros.
 */
function logText(text, values) {
    const known = values || {};
    const items = known.items;
    const factions = known.factions;
    const clock = times(known.time instanceof Date ? known.time : new Date());
    let out = fill(String(text === null || text === undefined ? '' : text), [
        ['{USERNAME}', known.username],
        ['{MAP}', known.map],
        ['{ROOM_ID}', known.roomId],
        ['{ROOM_NUM}', known.roomNumber],
        ['{GOLD}', known.gold],
        ['{LEVEL}', known.level],
        ['{CELL}', known.cell],
        ['{PAD}', known.pad],
        ['{HEALTH}', known.health],
        ['{MANA}', known.mana],
        ['{TIME}', clock.plain],
        ['{TIME: 12}', clock.twelve],
        ['{TIME: 24}', clock.twentyFour]
    ]);
    out = out.replace(/\{ITEM:\s*(.*?)\}/gi, function (match, name) {
        const item = itemOf(items, name);
        return String(item ? numberOr(item.iQty, 0) : 0);
    });
    out = out.replace(/\{ITEM MAX:\s*(.*?)\}/gi, function (match, name) {
        const item = itemOf(items, name);
        return String(item ? numberOr(item.iStk, 0) : 0);
    });
    const rep = function (name, pick) {
        return String(pick(factionOf(factions, name)));
    };
    out = out.replace(/\{REP XP:\s*(.*?)\}/gi, function (match, name) {
        return rep(name, function (f) {
            return numberOr(f.iSpillRep, 0) + '/' + numberOr(f.iRepToRank, 0);
        });
    });
    out = out.replace(/\{REP CURRENT:\s*(.*?)\}/gi, function (match, name) {
        return rep(name, function (f) { return numberOr(f.iSpillRep, 0); });
    });
    out = out.replace(/\{REP REMAINING:\s*(.*?)\}/gi, function (match, name) {
        // Faction.RemainingRep is RequiredRep - Rep, over the same two fields.
        return rep(name, function (f) {
            return numberOr(f.iRepToRank, 0) - numberOr(f.iSpillRep, 0);
        });
    });
    out = out.replace(/\{REP REQUIRED:\s*(.*?)\}/gi, function (match, name) {
        return rep(name, function (f) { return numberOr(f.iRepToRank, 0); });
    });
    out = out.replace(/\{REP RANK:\s*(.*?)\}/gi, function (match, name) {
        return rep(name, function (f) { return numberOr(f.iRank, 0); });
    });
    out = out.replace(/\{REP TOTAL:\s*(.*?)\}/gi, function (match, name) {
        return rep(name, function (f) { return numberOr(f.iRep, 0); });
    });
    out = out.replace(/\{INT VALUE:\s*(.*?)\}/gi, function (match, name) {
        const held = (known.ints || {})[name];
        return held === undefined ? match : String(held);
    });

    const parts = out.split('\\');
    const message = parts[0];
    const colours = parts.slice(1);
    let colourIndex = 0;
    const marked = message.replace(/>(.*?)</g, function (match, raw) {
        const colour = colourIndex < colours.length ? colours[colourIndex++] : 'FFFFFF';
        return "<font color='#" + colour.replace(/^#+/, '') + "'>" + raw + '</font>';
    });
    return { plain: message.split('>').join('').split('<').join(''), marked: marked };
}

/**
 * Every helper name the miscellaneous commands ask the reference loader for. One list, asserted
 * against the surface's own implemented set by the tests, so a name the surface refuses cannot
 * reach a command without failing a test first.
 */
const LOADER_NAMES = [
    'Cell', 'ChangeGuild', 'ChangeName', 'GetFactions', 'GetInventoryItems', 'GoTo', 'Gold',
    'Level', 'Logout', 'Map', 'Pad', 'PlayersInMap', 'RoomId', 'RoomNumber', 'SetFPS'
];

module.exports = {
    packetText: packetText,
    levelUpPacket: levelUpPacket,
    resolveBotPath: resolveBotPath,
    logText: logText,
    refusalText: refusalText,
    LOADER_NAMES: LOADER_NAMES
};
