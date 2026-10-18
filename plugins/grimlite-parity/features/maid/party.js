// The Maid's party half (ticket #43): the vocabulary it reads off party chat and answers, and the
// invitation it accepts. Reference: Grimoire/Networking/Handlers/Maid/PartyChatHandler.cs and
// PartyInvitationHandler.cs, both registered on the client's own traffic.
//
// The two frames are the reference's own:
//   XT `chatm`  Arguments[4] is `<type>~<text>`; only `party` with a '.'-prefixed line is a
//               command, and the seven it knows are .tp .join .acc .turnin .target .stop .start.
//   JSON `pi`   a party invitation, answered with `%xt%zm%gp%1%pa%<pid>%` written to the server.
//
// This module reads frames and hands back what it did; it writes nothing itself. The one frame it
// answers with goes through the injected send, which is the plugin's single packet path (#27), and
// a send that answers false means there was no live connection - reported, never queued.
//
// Every game call goes by the loader's own name through the injected game access (#48), so nothing
// here re-derives a game path.

const COMMANDS = ['.tp', '.join', '.acc', '.turnin', '.target', '.stop', '.start'];

// The reference's own waits (PartyChatHandler.cs): a second between GetQuests and Accept, and a
// second between each Accept or Complete of a list.
const QUEST_GAP_MS = 1000;

function message(error) {
    return (error && error.message) || String(error);
}

/** One tap frame's text, whichever shape the relay hands it in. */
function frameText(data) {
    if (typeof data === 'string') return data;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf8');
    if (data === null || data === undefined) return '';
    return String(data);
}

/**
 * An XT frame's arguments, as XtMessage splits them: on '%', with the leading empty field kept
 * (`%xt%zm%chatm%...` answers ['', 'xt', 'zm', 'chatm', ...]). Answers [] for anything else.
 */
function xtArguments(frame) {
    const text = String(frame === null || frame === undefined ? '' : frame);
    if (text.charAt(0) !== '%') return [];
    return text.split('%');
}

/**
 * The command of an XT frame, as XtMessage.Command resolves it: the third field, unless that is
 * `zm`, in which case it is the fourth - so both `%xt%chatm%...` and `%xt%zm%chatm%...` are chat.
 */
function xtCommand(args) {
    const fields = args || [];
    if (fields.length < 3) return '';
    if (fields[2] !== 'zm') return fields[2];
    return fields.length > 3 ? fields[3] : '';
}

/**
 * The party field of a chat frame: the argument carrying the `<type>~<text>` payload.
 *
 * The reference reads a fixed index (Arguments[4]); this reads whichever argument carries the
 * payload, because the tap sees the frame as the server wrote it and the port cannot take a fixed
 * index for granted the way the reference's own parser could. The test that follows is the
 * reference's: the type is `party` and the text starts with '.'.
 */
function partyField(args) {
    const fields = args || [];
    for (let i = 0; i < fields.length; i++) {
        if (String(fields[i]).indexOf('~') !== -1 && String(fields[i]).split('~')[0] === 'party') {
            return String(fields[i]);
        }
    }
    return null;
}

/** A JSON frame's body, or null when the text is not one. */
function jsonBody(text) {
    const raw = String(text === null || text === undefined ? '' : text).trim();
    if (raw.charAt(0) !== '{') return null;
    try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        return null;
    }
}

/** `qid` as the reference splits it: `Contains(",")` decides between one id and a list. */
function questIds(text) {
    const raw = String(text === null || text === undefined ? '' : text).trim();
    if (raw === '') return [];
    return raw.split(',').map(function (part) { return part.trim(); })
        .filter(function (part) { return part !== ''; });
}

/**
 * One party line as the handler reads it: `{command, argument}` or null when the line is not a
 * command the reference knows. Only '.'-prefixed lines are commands at all.
 */
function parseLine(text) {
    const line = String(text === null || text === undefined ? '' : text);
    if (line.charAt(0) !== '.') return null;
    const parts = line.split(' ');
    const command = parts[0].toLowerCase();
    if (COMMANDS.indexOf(command) === -1) return null;
    return { command: command, argument: line.slice(command.length).trim(), line: line };
}

/**
 * @param {object} deps
 * @param {object} deps.game   loader calls: loaderCall(name, args)
 * @param {(frame: string) => boolean} [deps.send]  the plugin's one packet path (#27)
 * @param {() => object} [deps.state]   the Maid's own state, for .target/.stop/.start
 * @param {(patch: object) => void} [deps.setState]
 * @param {(line: string) => void} [deps.log]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 */
function createParty(deps) {
    deps = deps || {};
    const game = deps.game || {};
    const send = typeof deps.send === 'function' ? deps.send : function () { return false; };
    const log = typeof deps.log === 'function' ? deps.log : function () {};
    const sleep = typeof deps.sleep === 'function'
        ? deps.sleep
        : function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    const setState = typeof deps.setState === 'function' ? deps.setState : function () {};
    const stateOf = typeof deps.state === 'function' ? deps.state : function () { return {}; };
    let invitationFrame = null;
    let answered = 0;

    /** One loader call by the reference's own name; a refusal carries its own words. */
    function call(name, args) {
        if (!game || typeof game.loaderCall !== 'function') {
            return Promise.resolve({ ok: false, error: 'this app has no game bridge channel' });
        }
        return Promise.resolve()
            .then(function () { return game.loaderCall(name, args || []); })
            .then(function (value) { return { ok: true, value: value }; },
                function (error) { return { ok: false, error: message(error) }; });
    }

    /**
     * Run one parsed line. Answers what it did, so a caller (and a test) can say which half ran
     * without reading the game. Never throws: a party line is not worth a dropped subscription.
     */
    async function run(parsed) {
        if (!parsed) return { ok: false, error: 'not a command' };
        const argument = parsed.argument;
        switch (parsed.command) {
        case '.tp': {
            if (!argument) return { ok: false, error: '.tp needs a map' };
            const map = argument.split(' ')[0];
            // The reference's own exception: a jump into tercessuinotlim first steps to m22.
            if (map.indexOf('tercessuinotlim') !== -1) {
                const moved = await call('Jump', ['m22', 'Left']);
                if (!moved.ok) return { ok: false, error: moved.error };
            }
            const joined = await call('Join', [map, 'Enter', 'Spawn']);
            return joined.ok
                ? { ok: true, command: '.tp', map: map }
                : { ok: false, command: '.tp', error: joined.error };
        }
        case '.join': {
            if (!argument) return { ok: false, error: '.join needs a map' };
            const joined = await call('Join', [argument]);
            return joined.ok
                ? { ok: true, command: '.join', map: argument }
                : { ok: false, command: '.join', error: joined.error };
        }
        case '.acc': {
            const ids = questIds(argument);
            if (!ids.length) return { ok: false, error: '.acc needs a quest id' };
            const loaded = await call('GetQuests', [ids.join(',')]);
            if (!loaded.ok) return { ok: false, command: '.acc', error: loaded.error };
            if (ids.length > 1) await sleep(QUEST_GAP_MS);
            const taken = [];
            for (let i = 0; i < ids.length; i++) {
                const accepted = await call('Accept', [ids[i]]);
                if (!accepted.ok) return { ok: false, command: '.acc', id: ids[i], error: accepted.error, accepted: taken };
                taken.push(ids[i]);
                if (ids.length > 1) await sleep(QUEST_GAP_MS);
            }
            return { ok: true, command: '.acc', accepted: taken };
        }
        case '.turnin': {
            const ids = questIds(argument);
            if (!ids.length) return { ok: false, error: '.turnin needs a quest id' };
            const done = [];
            for (let i = 0; i < ids.length; i++) {
                const completed = await call('Complete', [ids[i]]);
                if (!completed.ok) return { ok: false, command: '.turnin', id: ids[i], error: completed.error, completed: done };
                done.push(ids[i]);
                if (ids.length > 1) await sleep(QUEST_GAP_MS);
            }
            return { ok: true, command: '.turnin', completed: done };
        }
        case '.target': {
            if (!argument) return { ok: false, error: '.target needs a username' };
            setState({ target: argument });
            return { ok: true, command: '.target', target: argument };
        }
        case '.stop':
            setState({ enabled: false });
            return { ok: true, command: '.stop' };
        case '.start':
            setState({ enabled: true });
            return { ok: true, command: '.start' };
        default:
            return { ok: false, error: 'no such command: ' + parsed.command };
        }
    }

    /**
     * Answer a party invitation the way PartyInvitationHandler does: the `pid` the invitation
     * carries, written back as `%xt%zm%gp%1%pa%<pid>%`. A send that answers false is reported.
     */
    function acceptInvitation(pid) {
        const id = String(pid === null || pid === undefined ? '' : pid);
        if (id === '') return { ok: false, error: 'the invitation carries no pid' };
        invitationFrame = '%xt%zm%gp%1%pa%' + id + '%';
        const written = send(invitationFrame) === true;
        if (!written) {
            log('maid: the relay has no live connection to accept the party invitation');
            return { ok: false, frame: invitationFrame, error: 'no live connection' };
        }
        answered++;
        log('maid: accepted the party invitation from ' + id);
        return { ok: true, frame: invitationFrame, pid: id };
    }

    /**
     * One frame off the tap. Only the client's own direction is read, which is where the reference
     * saw both of these. Answers the result, or null when the frame says nothing to this half.
     */
    function handleFrame(frame) {
        if (!frame || frame.direction !== 'toClient') return null;
        const text = frameText(frame.data);
        if (text === '') return null;

        const body = jsonBody(text);
        if (body) {
            // PartyInvitationHandler's own test: the frame's command is `pi`, and the party id is
            // in `pid`. The reference reads the same field twice (its `owner` mirrors `pid`).
            if (body.command !== undefined && String(body.command).toLowerCase() === 'pi' && body.pid !== undefined) {
                return Object.assign({ kind: 'invitation' }, acceptInvitation(body.pid));
            }
            return null;
        }

        const args = xtArguments(text);
        if (xtCommand(args).toLowerCase() !== 'chatm') return null;
        const field = partyField(args);
        if (field === null) return null;
        const payload = field.split('~');
        if (payload[0] !== 'party') return null;
        const line = payload.length > 1 ? payload[1] : '';
        const parsed = parseLine(line);
        if (!parsed) return null;
        log('maid: party command ' + parsed.line);
        return Promise.resolve(run(parsed)).then(function (result) {
            return Object.assign({ kind: 'command', line: parsed.line }, result);
        }).catch(function (error) {
            return { kind: 'command', line: parsed.line, ok: false, error: message(error) };
        });
    }

    return {
        handleFrame: handleFrame,
        run: run,
        acceptInvitation: acceptInvitation,
        parseLine: parseLine,
        commands: function () { return COMMANDS.slice(); },
        state: function () {
            return {
                answers: answered,
                invitationFrame: invitationFrame,
                target: (stateOf() || {}).target || ''
            };
        }
    };
}

module.exports = {
    createParty: createParty,
    COMMANDS: COMMANDS,
    QUEST_GAP_MS: QUEST_GAP_MS,
    parseLine: parseLine,
    partyField: partyField,
    xtArguments: xtArguments,
    xtCommand: xtCommand,
    jsonBody: jsonBody,
    questIds: questIds,
    frameText: frameText
};
