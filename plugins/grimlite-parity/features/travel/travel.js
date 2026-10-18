// The Fast travels window's decisions (ticket #32). Reference: Grimoire/UI/Travel.cs. This module
// is the whole of the window's logic, so the tests drive it without a game: it never touches Flash
// itself, it does the work through the injected adapter (features/travel/game-access.js).
//
// Three things the reference does are reproduced rather than reinterpreted:
//   * every button runs through the bot engine's CmdTravel, whose same-map branch is a walk to the
//     cell - so a destination in the map you are standing in does not re-join it;
//   * the private checkbox suffixes "-<number>" to the map, and CmdTravel compares its own target
//     against world.strMapName verbatim, so a character inside room "x-12345" asking for plain "x"
//     joins plain "x";
//   * that same verbatim compare is why the same-map test strips the suffix from its own target
//     and not from what the game reports.
//
// Frames go to two different places on purpose. A quest-progress frame is handed to the *client*
// (the bridge's sendClientPacket), which is how the reference fakes progress it never earned. The
// DoomvaultB achievement frame is written to the *server* through the relay, because that is where
// Travel.cs writes it.

const data = require('./travel-data.js');

const MESSAGES = {
    notLoggedIn: 'Log in to the game first.',
    unknownButton: 'no such destination',
    notQuest: 'The game has not sent that quest, so there is nothing to unlock.',
    noPacket: 'There is no packet to send yet.',
    // The relay answers whether it wrote a frame; false means nothing is steered, so the frame
    // went nowhere. That is reported rather than left looking sent.
    notSteered: 'The packet relay is off, so this frame was not sent: '
};

// The reference's own waits: SkipMap waits a second between its frame and the map, and both
// ExecuteTravel loops wait a second after each command. btnUnlockMap polls eight times at 500 ms.
const QUEST_LOAD_TRIES = 8;
const QUEST_LOAD_WAIT_MS = 500;

function message(error) {
    return (error && error.message) || String(error);
}

/** The reference's request type: a frame starting with a brace is json, everything else str. */
function frameType(packet) {
    return String(packet).charAt(0) === '{' ? 'json' : 'str';
}

/** The map part of a name that may carry a private-room suffix (CmdTravel's own split). */
function baseMap(map) {
    const name = String(map == null ? '' : map);
    return name.indexOf('-') === -1 ? name : name.split('-')[0];
}

/** ISlot as the reference's own getter reads it: null and -1 both mean slot 0. */
function slotOf(quest) {
    if (!quest || quest.iSlot === null || quest.iSlot === undefined) return 0;
    const slot = Number(quest.iSlot);
    if (!isFinite(slot) || slot === -1) return 0;
    return slot;
}

/** The reference's frame for one quest's progress, or null when there is no value to fake. */
function bypassPacket(quest) {
    if (!quest || quest.iValue === null || quest.iValue === undefined) return null;
    return data.questFrame(Number(quest.iValue), slotOf(quest));
}

function updateQuestPacket(iValue, iSlot) {
    return data.questFrame(iValue, iSlot);
}

/** The map name a button's travel reaches, with the private-room suffix when it is ticked. */
function targetMap(travel, options) {
    const opts = options || {};
    return opts.isPrivate ? travel.map + '-' + opts.privateNumber : travel.map;
}

/** Is the character already standing in the map this join is for? (CmdTravel's own compare.) */
async function inMap(game, map) {
    const answer = await game.read('world.strMapName');
    if (answer && answer.error) throw new Error(answer.error);
    return String((answer && answer.value) || '').toLowerCase() === baseMap(map).toLowerCase();
}

/**
 * One travel: walk there when the character is already in the map, join it otherwise. Answers what
 * it did, so the window can report it.
 */
async function go(game, spec) {
    const map = targetMap(spec, spec);
    const already = await inMap(game, map);
    if (already) {
        await game.loaderCall('Jump', [spec.cell, spec.pad]);
        return { action: 'move', map: baseMap(map), cell: spec.cell, pad: spec.pad, error: null };
    }
    await game.loaderCall('Join', [map, spec.cell, spec.pad]);
    return { action: 'join', map: map, cell: spec.cell, pad: spec.pad, error: null };
}

/** Hand one frame to the client, the way the reference fakes quest progress. */
function sendClientPacket(game, packet, type) {
    return Promise.resolve(game.sendClientFrame(packet, type || frameType(packet)));
}

/** Send a generated packet on its own: the window's own Send button. */
async function sendPacket(game, packet) {
    const frame = String(packet == null ? '' : packet);
    if (!frame) return { packet: null, sent: false, error: MESSAGES.noPacket };
    const answer = await game.sendClientFrame(frame, frameType(frame));
    if (!answer || answer.ok === false) {
        return {
            packet: frame,
            sent: false,
            error: message(answer && answer.error) || 'the frame was not sent'
        };
    }
    return { packet: frame, sent: true, error: null };
}

/**
 * The buttons that inject a frame before they travel (Binky and the four in Fast travels 2): the
 * reference's own bodies, in its own order, with its own waits. A sleep step is a real wait, and
 * the travel step is the join the button exists for.
 */
async function runSteps(game, steps, options) {
    const frames = [];
    const unwritten = [];
    let travelled = null;
    for (const step of steps) {
        if (step.quest) {
            const packet = updateQuestPacket(step.quest[0], step.quest[1]);
            await sendClientPacket(game, packet);
            frames.push(packet);
        } else if (step.server) {
            // The one frame that leaves the machine: the relay writes it to the server.
            const written = await game.sendServerFrame(step.server);
            frames.push(step.server);
            if (written !== true) unwritten.push(step.server);
        } else if (step.sleep) {
            await game.sleep(step.sleep);
        } else if (step.travel) {
            travelled = await go(game, {
                map: options.map,
                cell: options.cell,
                pad: options.pad,
                isPrivate: options.isPrivate,
                privateNumber: options.privateNumber
            });
        }
    }
    return { frames: frames, travel: travelled, unwritten: unwritten };
}

/** The Map Bypasser's Unlock: read the quest the id names, then hand its packet to the client. */
async function unlock(game, questId, options) {
    void options;
    const id = String(questId);
    const path = 'world.questTree.' + id;
    let answer = await game.read(path);
    let waited = 0;
    // The reference loads the quest when the tree does not hold it, then polls for it: the client
    // is told to ask the server, and the answer arrives as a frame.
    if (!answer || !answer.value) {
        await game.loaderCall('LoadQuest', [id]);
        while ((!answer || !answer.value) && waited < QUEST_LOAD_TRIES) {
            await game.sleep(QUEST_LOAD_WAIT_MS);
            waited++;
            answer = await game.read(path);
        }
    }
    if (answer && answer.error) return { packet: null, sent: false, error: answer.error };

    const packet = bypassPacket(answer && answer.value);
    if (!packet) {
        return { packet: null, sent: false, error: MESSAGES.notQuest + ' (' + id + ')' };
    }
    const sent = await sendPacket(game, packet);
    return { packet: packet, sent: sent.sent, error: sent.error };
}

/**
 * Bypass All: overwrite every quest-progress field with a same-length run of Z, which is what the
 * reference's own bypasses() does. A field the game has not sent is skipped rather than created,
 * and a refused write stops the run and is reported - the reference swallows both.
 */
async function bypassAll(game, options) {
    void options;
    const blanked = [];
    const skipped = [];
    for (const key of data.PROGRESS_KEYS) {
        const path = data.PROGRESS_PREFIX + key;
        const answer = await game.read(path);
        if (answer && answer.error) { skipped.push(key); continue; }
        const value = answer && answer.value;
        // Nothing to blank, and nothing to invent: a field the game has not sent is left alone.
        if (value === null || value === undefined) { skipped.push(key); continue; }
        const text = String(value);
        const written = await game.write(path, new Array(text.length + 1).join(data.BLANK_CHARACTER));
        if (!written || written.ok === false) {
            return {
                blanked: blanked,
                skipped: skipped.concat(data.PROGRESS_KEYS.slice(data.PROGRESS_KEYS.indexOf(key))),
                message: null,
                error: message(written && written.error) || ('the game refused a write to ' + path)
            };
        }
        blanked.push({ key: key, length: text.length });
    }
    return {
        blanked: blanked,
        skipped: skipped,
        message: 'All storyline are bypassed, if u want to restore the original progression. ' +
            'Please relogin',
        error: null
    };
}

/** One button, by id: what the page's own click runs. */
async function runButton(game, id, options) {
    const spec = data.button(id);
    const opts = options || {};
    if (!spec) {
        return { button: id, error: MESSAGES.unknownButton + ': "' + id + '"' };
    }

    try {
        const answer = await game.loaderCall('IsLoggedIn', []);
        if (!answer) return { button: id, frames: [], error: MESSAGES.notLoggedIn };

        if (spec.bypassAll) {
            const result = await bypassAll(game, opts);
            return {
                button: id,
                blanked: result.blanked,
                skipped: result.skipped,
                message: result.message,
                error: result.error
            };
        }
        if (spec.quests) {
            const ids = data.ULTRA_QUESTS.map(String);
            await game.loaderCall('LoadQuests', [ids.join(',')]);
            return { button: id, loaded: ids, error: null };
        }
        if (spec.awe) {
            const fallback = data.AWE_TYPES.filter(function (entry) { return entry.checked; })[0];
            const result = await aweShop(game, opts.aweType || (fallback && fallback.id));
            return { button: id, shopId: result.shopId, error: result.error };
        }

        // The tercess entry walk the reference does before it joins one of them.
        if (spec.travel && spec.travel.tercessEntry) {
            const here = await game.read('world.strMapName');
            if (here && here.error) return { button: id, frames: [], error: here.error };
            if (String((here && here.value) || '').toLowerCase() !== data.TERCESS.map) {
                await game.loaderCall('Jump', [data.TERCESS.entry.cell, data.TERCESS.entry.pad]);
            }
        }

        const steps = spec.steps || (spec.travel ? [{ travel: true }] : []);
        const run = await runSteps(game, steps, Object.assign({
            map: spec.travel && spec.travel.map,
            cell: spec.travel && spec.travel.cell,
            pad: spec.travel && spec.travel.pad
        }, opts));
        // A frame the relay did not write is not a failure of the travel, so it is reported
        // beside it rather than instead of it: the room was entered, the frame did not go out.
        const unwritten = run.unwritten.length
            ? MESSAGES.notSteered + run.unwritten.join(' ')
            : null;
        if (!run.travel) {
            return { button: id, frames: run.frames, error: unwritten };
        }
        return {
            button: id,
            action: run.travel.action,
            map: run.travel.map,
            cell: run.travel.cell,
            pad: run.travel.pad,
            frames: run.frames,
            error: unwritten
        };
    } catch (error) {
        return { button: id, frames: [], error: message(error) };
    }
}

/** One enchantment type's shop: LoadShop with the id AweTravel_Click's own chain picks. */
async function aweShop(game, typeId) {
    const type = data.AWE_TYPES.filter(function (entry) { return entry.id === typeId; })[0];
    if (!type) return { shopId: null, error: 'no such enchantment type: "' + typeId + '"' };
    try {
        await game.loaderCall('LoadShop', [String(type.shopId)]);
        return { shopId: type.shopId, error: null };
    } catch (error) {
        return { shopId: type.shopId, error: message(error) };
    }
}

// The reference loader's names this window calls. Asserted against loader-surface.js by the test,
// so a name that falls out of that table fails here rather than at a click.
const LOADER_NAMES = ['IsLoggedIn', 'Join', 'Jump', 'LoadShop', 'LoadQuest', 'LoadQuests'];

module.exports = {
    MESSAGES: MESSAGES,
    LOADER_NAMES: LOADER_NAMES,
    QUEST_LOAD_TRIES: QUEST_LOAD_TRIES,
    QUEST_LOAD_WAIT_MS: QUEST_LOAD_WAIT_MS,
    frameType: frameType,
    baseMap: baseMap,
    slotOf: slotOf,
    bypassPacket: bypassPacket,
    updateQuestPacket: updateQuestPacket,
    sendPacket: sendPacket,
    go: go,
    unlock: unlock,
    bypassAll: bypassAll,
    aweShop: aweShop,
    runButton: runButton
};
