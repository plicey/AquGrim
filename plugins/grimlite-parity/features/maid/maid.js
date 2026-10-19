// The Maid's scheduler (ticket #43): the part that decides what to do, kept out of the window so
// it can be tested without Electron. Reference: Grimlite-Li 816d9cd, Grimoire/UI/Maid/MaidRemake.cs
// (cbEnablePlugin_CheckedChanged, the loop at :197-360) plus the handlers under
// Grimoire/Networking/Handlers/Maid/.
//
// The reference's loop, in its own order, is the specification here:
//
//   * a logged-out character waits, and a first join waits RelogDelay (waitForFirstJoin);
//   * a map reload is a pause, and so is onPause (set by pauseFollow, which the whitelist-map
//     handlers call);
//   * not in the target's map, or in it but not in their cell, means follow: chase the cell, or
//     goto the map. Five failed gotos with StopFailedGoto on stops the Maid;
//   * dead means SetSpawnPoint and start over;
//   * StopAttack cancels the target and the auto-attack, then optionally fires the buff list;
//   * the safe skill fires under its HP threshold before anything else;
//   * attack priority walks its own list first, then *;
//   * WaitSkill gates each skill on SkillAvailable before the next one is used.
//
// It runs ALONGSIDE the bot engine (#37) and the engine wins. The reference is single-scheduler
// and cannot answer this, so the parent spec's ruling governs: "the engine's current command takes
// priority for the skills Maid wants, and the collision is written to the log rather than resolved
// silently" (grilling round 11.10). This module observes the engine through one injected function,
// engineActivity() -> {count, command}, and yields the tick the engine has run a command since the
// last one, logging the collision once per command. No engine hook was needed and none was added.
//
// GAME ACCESS. Every read and call goes by the reference's own loader name through the injected
// game access, so nothing here re-derives a game path: a name the loader surface does not
// implement answers with its reason and the ticket that owns it.

// The loader helper names this module uses, as data, so a test can assert every one of them
// answers on the surface ticket #48 built (bot/session.js does the same for its own list).
const HELPERS = {
    // reads
    IsLoggedIn: true,
    Health: true,
    HealthMax: true,
    Map: true,
    Cell: true,
    HasTarget: true,
    PlayersInMap: true,
    PlayerByName: true,
    GetCellPlayers: true,
    SkillAvailable: true,
    IsMonsterAvailable: true,
    Class: true,
    State: true,
    GetCells: true,
    GetInventoryItems: true,
    // calls
    SetSpawnPoint: true,
    CancelAutoAttack: true,
    CancelTarget: true,
    Rest: true,
    AttackMonster: true,
    AttackMonsterByMonMapId: true,
    Jump: true,
    GoTo: true,
    UseSkill: true,
    EquipPotion: true,
    SetLagKiller: true,
    SetInfiniteRange: true,
    // The forced cast the Maid's own phrase handler arms (SpecialAct, ticket #44). The reference
    // forces the cast through ForceUseSkill rather than UseSkill, so both are named here.
    ForceUseSkill: true
};

// The names this module calls that the surface cannot drive, with the reason to show. It is empty
// and stays here because it is what a reader (and the scheduler test) checks a claim against:
// tickets #38 and #49 between them made every helper above answer - the last three by resolving
// their live ActionScript object inside the bridge movie's own domain rather than over the wire.
const BLOCKED = {};

// The one path read this module makes. It is not a duplicate of a loader row: the surface has no
// name that answers "what is my target called" (its GetMonstersInCell reshapes live monster objects
// and is a #38 row), and reading the target back is what tells an attack that took from one that
// silently did not. The field is the game's own: the reference loader's own GetMonstersInCell reads
// strMonName off the same objData.
const TARGET_NAME_PATH = 'world.myAvatar.target.objData.strMonName';

// ...and its companion: an attack the user asked for by MonMapID (`id.3`) is confirmed against the
// same objData's MonMapID, which is the field the reference's own doPriorityAttack compares
// (MaidRemake.cs:845). Comparing a name against an id would report a good attack as a failure.
const TARGET_ID_PATH = 'world.myAvatar.target.objData.MonMapID';

// The game's own map-load flag, the same path zones.js and bot/session.js read. The reference's
// World.IsMapLoading is this flag.
const MAP_LOADING_PATH = 'world.mapLoadInProgress';

// Player.State.InCombat, from Player.cs's own enum (Dead, Idle, InCombat).
const STATE_IN_COMBAT = 2;

// InventoryItem.EquippableCategories (Game/Data/InventoryItem.cs:13-30), which is the test the
// reference's equipEnrage makes through IsEquippable.
const EQUIPPABLE_CATEGORIES = [
    'Sword', 'Axe', 'Dagger', 'Gun', 'Bow', 'Mace', 'Polearm', 'Staff', 'Wand',
    'Class', 'Armor', 'Helm', 'Cape', 'Necklace', 'Misc', 'Item'
];

const ENRAGE_NAME = 'Scroll of Enrage';

// The reference's own waits, as they appear in its loop and in chaseTargetCell.
const TIMING = {
    mapLoadPollMs: 500,
    gotoWaitPollMs: 150,
    gotoWaitTries: 36,
    gotoWaitUntilTries: 15,
    gotoWaitUntilMs: 500,
    exitCombatMs: 100,
    chaseDelayMs: 800,
    chaseGoToDelayMs: 500,
    lockedZoneWaitMs: 500,
    lockedZoneWaitTries: 6,
    deadWaitMs: 500,
    enrageWaitMs: 1000,
    waitSkillAdvanceMs: 150,
    waitStepMs: 150,
    firstJoinPollMs: 2000
};

// The three numbers in the reference's own waitSkill (MaidRemake.cs:370-382): the cooldown wait is
// capped at 1500 ms, then twenty 50 ms polls decide whether the cast took.
const FORCE_WAIT_CAP_MS = 1500;
const FORCE_COOLDOWN_TRIES = 20;
const FORCE_COOLDOWN_POLL_MS = 50;

const STATUS = {
    off: 'off',
    waitingSignIn: 'waiting for a character to sign in',
    waitingJoin: 'waiting for the first join',
    reloading: 'paused: the map is reloading',
    paused: 'paused',
    unfollowed: 'unfollowed',
    stopped: 'stop attack is on',
    dead: 'respawned; waiting',
    following: 'following',
    fighting: 'fighting',
    collision: 'the bot engine has the current command'
};

function message(error) {
    return (error && error.message) || String(error);
}

/**
 * @param {object} deps
 * @param {object} deps.game      loader calls: loaderCall(name, args) plus read(path)
 * @param {() => object} deps.config  the live config state (config.js's apply() result)
 * @param {(line: string) => void} [deps.log]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {() => {count: number, command: string|null}} [deps.engineActivity]  the bot engine (#37)
 * @param {() => boolean} [deps.engineRunning]
 * @param {(frame: string) => boolean} [deps.send]  host.packets.send, for the goto frame
 * @param {() => boolean} [deps.specialsHolding] the per-boss handlers' own run locks (#44),
 *                              which is doPriorityAttack's first line
 */
function createMaid(deps) {
    deps = deps || {};
    const game = deps.game || {};
    const log = typeof deps.log === 'function' ? deps.log : function () {};
    const sleep = typeof deps.sleep === 'function'
        ? deps.sleep
        : function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    const configOf = typeof deps.config === 'function' ? deps.config : function () { return {}; };
    const engineActivity = typeof deps.engineActivity === 'function' ? deps.engineActivity : null;
    const engineRunning = typeof deps.engineRunning === 'function' ? deps.engineRunning : function () { return false; };
    const send = typeof deps.send === 'function' ? deps.send : function () { return false; };
    // Misc 2's non-packet actions share this scheduler rather than starting a second polling loop.
    const auxiliaryActive = typeof deps.auxiliaryActive === 'function' ? deps.auxiliaryActive : function () { return false; };
    const auxiliaryTick = typeof deps.auxiliaryTick === 'function' ? deps.auxiliaryTick : null;
    // taunt()'s own door (MaidRemake.cs:295-296): the rotation a `tc;` SpecialMsg starts lives with
    // the per-boss half (#44), which owns the SpecialMsg box and the cycle's own token. Injected
    // for the same reason the two run locks are: the scheduler does not own that state.
    const taunt = typeof deps.taunt === 'function' ? deps.taunt : function () { return null; };
    const specialCombo = typeof deps.specialCombo === 'function' ? deps.specialCombo : function () { return false; };
    const specialBalance = typeof deps.specialBalance === 'function' ? deps.specialBalance : function () { return null; };
    // Called once per loop pass, so the window can show a state that changes on its own (the
    // reference's own window is repainted by its loop for the same reason). Settable after the
    // fact, because the window that watches it is built around this scheduler.
    let onTick = typeof deps.onTick === 'function' ? deps.onTick : null;

    let enabled = false;
    let target = '';
    let unfollow = false;
    let stopAttack = false;
    let paused = false;         // the reference's onPause: set by the whitelist-map handlers
    let firstJoinDone = false;
    let gotoTries = 0;
    let skillIndex = 0;
    // The skill a phrase hit asked to force (MaidRemake.cs's `forceSkill`/`numSkillAct`): set by
    // armSkill from the AnimsMsgHandler subscription, spent by the next fighting pass.
    let forcedSkill = null;
    let safeIndex = 0;
    let buffIndex = 0;
    let collisions = 0;
    let lastCollision = null;
    let lastSeenCommands = 0;
    let status = STATUS.off;
    let lastNote = null;
    let running = false;
    let loop = null;
    // The enable-time game effects run asynchronously (the reference awaits them inside its own
    // box handler); `idle()` joins them so a caller can tell when the enable has settled.
    const effects = [];
    const missing = [];         // helper names the surface refused, with their reasons

    function queueEffect(promise) {
        const tracked = Promise.resolve(promise).catch(function (error) {
            log('maid: an enable effect failed (' + message(error) + ')');
        });
        effects.push(tracked);
        return tracked;
    }

    function fail(text) {
        lastNote = text;
        log('maid: ' + text);
        return { ok: false, error: text };
    }

    /** One loader call by the reference's own name. A refusal carries the surface's own words. */
    async function call(name, args) {
        if (!game || typeof game.loaderCall !== 'function') return fail('this app has no game bridge channel');
        try {
            return { ok: true, value: await game.loaderCall(name, args || []) };
        } catch (error) {
            if (HELPERS[name] && missing.indexOf(name) === -1) {
                missing.push(name);
                log('maid: ' + name + ' - ' + message(error));
            }
            return { ok: false, error: message(error) };
        }
    }

    /** The generic read the module needs once: see TARGET_NAME_PATH. */
    async function readPath(path) {
        if (!game || typeof game.read !== 'function') return { ok: false, error: 'no game bridge channel' };
        const answer = await game.read(path);
        if (!answer || answer.error) return { ok: false, error: (answer && answer.error) || 'the game did not answer' };
        return { ok: true, value: answer.value };
    }

    /** A boolean a loader helper answered, or null when it could not be established. */
    function asBool(answer) {
        if (!answer.ok) return null;
        return answer.value === true || answer.value === 'true' || answer.value === 1 || answer.value === '1';
    }

    /** One of the configured comma-separated skill lists, or the reference's own default. */
    function skills(key, fallback) {
        const config = configOf() || {};
        const raw = config[key];
        const parts = String(raw === undefined || raw === null ? '' : raw)
            .split(',').map(function (part) { return part.trim(); })
            .filter(function (part) { return part !== ''; });
        if (parts.length) return parts;
        return (fallback || []).slice();
    }

    function currentStatus() {
        if (!enabled) return STATUS.off;
        if (unfollow) return STATUS.unfollowed;
        if (stopAttack) return STATUS.stopped;
        return status;
    }

    function hasAuxiliaryWork() {
        try {
            return auxiliaryActive() === true;
        } catch (error) {
            return false;
        }
    }

    async function runAuxiliaryTick(context) {
        if (!hasAuxiliaryWork() || !auxiliaryTick) return null;
        try {
            return await auxiliaryTick(context || {});
        } catch (error) {
            log('maid: a scheduled handler failed (' + message(error) + ')');
            return null;
        }
    }

    /** Is the engine holding the current command? Answers the collision line when it is. */
    function engineCollision() {
        if (!engineActivity || !engineRunning()) return null;
        let activity;
        try {
            activity = engineActivity() || {};
        } catch (error) {
            return null;
        }
        const count = Number(activity.count) || 0;
        const command = activity.command === undefined ? null : activity.command;
        if (count === lastSeenCommands) return null;
        lastSeenCommands = count;
        if (command === lastCollision) return null;
        lastCollision = command;
        collisions++;
        return 'the bot engine is on ' + (command === null ? 'a command' : '[' + command + ']') +
            '; the Maid yields this tick';
    }

    // ------------------------------------------------------------------ the loop, one tick

    /**
     * One pass of the reference's while loop. Answers {ok, status} - never throws, because a
     * scheduler that throws takes the window's own loop down with it.
     */
    async function tick() {
        if (!enabled) {
            status = STATUS.off;
            if (!hasAuxiliaryWork()) return { ok: true, status: status };
            const scheduled = await runAuxiliaryTick({ maidEnabled: false });
            return { ok: true, status: status, scheduled: scheduled };
        }

        const collision = engineCollision();
        if (collision) {
            log('maid: ' + collision);
            status = STATUS.collision;
            return { ok: true, status: status, collision: collision };
        }

        // These effects belong to a selected Misc 2 handler, whose source polling loops are being
        // folded into the existing scheduler. Run them once per pass, before follow/stop-attack
        // branches can return early, just as the separate reference handlers did.
        const scheduled = await runAuxiliaryTick({ maidEnabled: true });

        const signedIn = asBool(await call('IsLoggedIn'));
        if (signedIn !== true) {
            status = STATUS.waitingSignIn;
            firstJoinDone = false;
            return { ok: true, status: status };
        }
        // The reference's waitForFirstJoin: wait out the loading screen first, then RelogDelay
        // (MaidRemake.cs:812-822, `while (cbEnablePlugin.Checked && World.IsMapLoading)`).
        if (!firstJoinDone) {
            await waitForFirstJoin();
            firstJoinDone = true;
            return { ok: true, status: STATUS.waitingJoin };
        }

        const map = await call('Map');
        const cell = await call('Cell');
        if (!map.ok || !cell.ok) {
            status = STATUS.reloading;
            return { ok: true, status: status, error: map.error || cell.error };
        }

        const inMap = await playerInMap();
        const inCell = await playerInCell();

        // The reference's chain runs the chase and the goto while onPause stands (`!onPause` gates
        // the combat branch, not the movement branches), which is why paused still gotos and
        // chases the target's cell.
        if (!unfollow && (inMap !== true || inCell !== true)) {
            status = STATUS.following;
            await follow(inMap === true);
            return { ok: true, status: status };
        }

        // The reference's own first line of the combat branch: `gotoTry = 0` (MaidRemake.cs:215).
        gotoTries = 0;

        if (paused) {
            status = STATUS.paused;
            return { ok: true, status: status };
        }

        const alive = await isAlive();
        if (alive === false) {
            await call('SetSpawnPoint');
            // MaidRemake.cs:220-224: SetSpawnPoint, 500 ms, then forceSkill = false.
            await sleep(TIMING.deadWaitMs);
            forcedSkill = null;
            skillIndex = 0;
            status = STATUS.dead;
            return { ok: true, status: status };
        }

        const config = configOf() || {};
        const health = await healthPercent();
        if (config.SafeSkill === true && health !== null && health < Number(config.SafeSkillHP)) {
            const list = skills('SafeSkillList', ['1', '2']);
            await use(list[safeIndex % list.length]);
            safeIndex = (safeIndex + 1) % list.length;
            await sleep(Number(config.SkillDelay) || TIMING.waitStepMs);
            status = STATUS.fighting;
            return { ok: true, status: status, cast: 'safe' };
        }

        if (stopAttack) {
            status = STATUS.stopped;
            if (asBool(await call('HasTarget')) === true) {
                await call('CancelAutoAttack');
                await call('CancelTarget');
            }
            if (config.BuffStopAttack === true) {
                const list = skills('BuffStopAttackList', ['2', '3']);
                await use(list[buffIndex % list.length]);
                buffIndex = (buffIndex + 1) % list.length;
            }
            await sleep(Number(config.SkillDelay) || TIMING.waitStepMs);
            return { ok: true, status: status };
        }

        status = STATUS.fighting;
        if (config.AttackPriority === true && forcedSkill === null) await priorityTarget();
        let hasTarget = asBool(await call('HasTarget')) === true;
        if (!hasTarget && !(scheduled && scheduled.wildcardAttempted === true)) {
            // `if (World.IsMonsterAvailable("*") && !Player.HasTarget)` (MaidRemake.cs:246).
            if (asBool(await call('IsMonsterAvailable', ['*'])) === true) {
                await attack('*');
                hasTarget = asBool(await call('HasTarget')) === true;
            }
        }

        // MaidRemake.cs:294-296 awaits SpecialCombo before asking taunt() inside HasTarget.
        if (hasTarget) {
            if (await specialCombo()) await waitSkill('5');
            const balance = await specialBalance(forcedSkill !== null);
            if (balance && balance.priorityAttack && config.AttackPriority === true) await priorityTarget();
            taunt();
        }

        // The reference's own forced cast (MaidRemake.cs:596-610): while `forceSkill` stands it
        // waits the skill out, forces it, clears the flag and pauses, instead of running the list.
        // `waitSkill` is its own helper: SkillAvailable capped at 1500 ms, force the cast, then up
        // to twenty 50 ms checks for the cooldown to appear, forcing once more if it never does.
        if (forcedSkill !== null) {
            // The reference's forced cast lives inside `if (Player.HasTarget)`, so no target means
            // the flag stands and nothing is cast.
            if (!hasTarget) return { ok: true, status: status, waiting: 'no target' };
            const slot = forcedSkill;
            forcedSkill = null;
            await waitSkill(slot);
            status = STATUS.fighting;
            return { ok: true, status: status, cast: slot, forced: true };
        }

        const list = skills('SkillList', ['1', '2', '3', '4']);
        const slot = list[skillIndex % list.length];
        if (config.WaitSkill === true) {
            // MaidRemake.cs:250-259: a self/buff skill (`tgt` is not "h") is cooldown-waited, then
            // FORCE-cast, then the index advances; a hostile skill is only waited/skipped.
            const aim = await skillAim(slot);
            if (aim !== 'h') {
                if (!hasTarget) return { ok: true, status: status, waiting: 'no target' };
                const ready = await call('SkillAvailable', [slot]);
                const cooldown = ready.ok ? Number(ready.value) : 0;
                if (isFinite(cooldown) && cooldown > 0) await sleep(cooldown);
                await force(slot);
                skillIndex = (skillIndex + 1) % list.length;
                await sleep(TIMING.waitSkillAdvanceMs);
                return { ok: true, status: status, cast: slot, forced: true };
            }
            const ready = await call('SkillAvailable', [slot]);
            if (!ready.ok || Number(ready.value) > 0 || !hasTarget) {
                await sleep(TIMING.waitStepMs);
                return { ok: true, status: status, waiting: ready.ok ? 'cooldown' : 'unknown' };
            }
        }
        // `if (Player.HasTarget)` (MaidRemake.cs:294): the skill list is never cast with no target.
        if (!hasTarget) return { ok: true, status: status, waiting: 'no target' };
        await use(slot);
        skillIndex = (skillIndex + 1) % list.length;
        await sleep(Number(config.SkillDelay) || TIMING.waitStepMs);
        return { ok: true, status: status, cast: slot };
    }

    /**
     * Attack one monster, by name or by the reference's own id.N MonMapID form (its
     * doPriorityAttack reads that prefix itself and calls the matching helper). Then read the
     * target back: a call that answered without the target changing is reported, not counted as an
     * attack that landed.
     */
    async function attack(what) {
        const name = String(what === null || what === undefined ? '' : what);
        // Player.AttackMonster's own prefix list (Player.cs:344-366): `id'`, `id.`, `id:` and
        // `id-` are the four spellings of "attack by MonMapID", and the separator is the split.
        const separator = ["id'", 'id.', 'id:', 'id-'].filter(function (prefix) {
            return name.indexOf(prefix) === 0;
        })[0];
        const byId = separator ? name.split(separator.charAt(2))[1] : null;
        const answer = byId
            ? await call('AttackMonsterByMonMapId', [byId])
            : await call('AttackMonster', [name]);
        if (!answer.ok) {
            lastNote = name + ': ' + answer.error;
            return answer;
        }
        const readBack = await readPath(byId ? TARGET_ID_PATH : TARGET_NAME_PATH);
        if (!readBack.ok) {
            lastNote = 'could not read the target back after attacking ' + name + ': ' + readBack.error;
            return { ok: false, error: lastNote, unanswered: true };
        }
        const got = String(readBack.value === null || readBack.value === undefined ? '' : readBack.value);
        if (byId) {
            if (got !== byId) {
                lastNote = 'the target\'s MonMapID is ' + (got || '(none)') + ', not ' + byId;
                return { ok: false, error: lastNote };
            }
            return { ok: true, value: got };
        }
        if (name !== '*' && got.toLowerCase().indexOf(name.toLowerCase()) === -1) {
            lastNote = 'the target is "' + got + '", not ' + name;
            return { ok: false, error: lastNote };
        }
        return { ok: true, value: got };
    }

    /**
     * The two run locks the per-boss handlers own (#44), read through an injected seam: `locktarget`
     * is set while Gramiel's drain or a counter-attack warning holds the target, and `balance` while
     * the crystal-HP walk has taken it. Neither flag lives here - they belong to the handlers that
     * set them - so the scheduler asks rather than assumes.
     */
    function specialsHolding() {
        const read = deps.specialsHolding;
        if (typeof read !== 'function') return false;
        try {
            return read() === true;
        } catch (error) {
            return false;
        }
    }

    /** The reference's doPriorityAttack: the first entry that is there gets the attack. */
    async function priorityTarget() {
        // The reference's own first line (MaidRemake.cs:838-840): `if (balance || locktarget)
        // return;`. While a handler holds the target the walk does not run at all - not even the
        // list walk, which is what the early return means.
        if (specialsHolding()) return { ok: true, held: true };
        const configured = configOf().AttackPriorityMonster;
        const entries = String(configured === undefined || configured === null ? '' : configured)
            .split(',').map(function (part) { return part.trim(); })
            .filter(function (part) { return part !== ''; });
        // The reference steps aside when its current target is already one of these
        // (MaidRemake.cs:854-856, the CSH no-autoattack case): it compares the target's own name
        // and MonMapID, and returns without attacking again. The two run-lock flags that guard the
        // walk as a whole are read at its top, above.
        const held = await readPath(TARGET_NAME_PATH);
        const heldName = held.ok && held.value !== null && held.value !== undefined
            ? String(held.value) : '';
        const heldMon = await readPath(TARGET_ID_PATH);
        const heldMapId = heldMon.ok && heldMon.value !== null && heldMon.value !== undefined
            ? String(heldMon.value) : '';
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            // The reference's own test: `StartsWith("id", OrdinalIgnoreCase) && Length > 3`
            // (MaidRemake.cs:851), and the id is everything after the prefix.
            const byId = entry.length > 3 && entry.slice(0, 2).toLowerCase() === 'id';
            const wantedId = byId ? entry.slice(3) : null;
            if (!byId && heldName && heldName.toLowerCase().indexOf(entry.toLowerCase()) !== -1) {
                return { ok: true, value: heldName, already: true };
            }
            if (byId && heldMapId && wantedId === heldMapId) {
                return { ok: true, value: heldMapId, already: true };
            }
            const answer = await attack(entry);
            if (answer.ok) return answer;
            lastNote = entry + ' is not here';
        }
        return { ok: false, error: lastNote };
    }

    /**
     * Use one skill of the rotation, by the reference loader's own UseSkill. When the bridge cannot
     * drive it the refusal is reported with the reason (ticket #38 owns the combat half), never as
     * a cast that happened.
     */
    async function use(slot) {
        // `useSkill` (MaidRemake.cs:384-392): a Chrono Shadow cast always goes through
        // ForceUseSkill, whatever the skill list's own wait branch decided.
        const klass = await call('Class');
        const csh = klass.ok && String(klass.value || '').toUpperCase().indexOf('CHRONO SHADOW') !== -1;
        const answer = await call(csh ? 'ForceUseSkill' : 'UseSkill', [String(slot)]);
        if (!answer.ok) lastNote = 'skill ' + slot + ': ' + answer.error;
        return answer;
    }

    /**
     * The reference's own waitSkill (MaidRemake.cs:370-382), which is how its forced cast lands:
     * read the cooldown, wait at most 1500 ms of it, force the skill, then poll twenty times at
     * 50 ms for the cooldown to appear and force once more if it never did. `useSkill(index, true)`
     * is Player.ForceUseSkill, and the second call is what tells "the cast was refused" from "the
     * skill never went on cooldown".
     */
    async function waitSkill(slot) {
        const first = await call('SkillAvailable', [String(slot)]);
        const cooldown = first.ok ? Number(first.value) : 0;
        await sleep(Math.min(isFinite(cooldown) ? cooldown : 0, FORCE_WAIT_CAP_MS));
        const forced = await force(slot);
        for (let i = 0; i < FORCE_COOLDOWN_TRIES; i++) {
            await sleep(FORCE_COOLDOWN_POLL_MS);
            const ready = await call('SkillAvailable', [String(slot)]);
            if (ready.ok && Number(ready.value) > 0) return forced;
        }
        return force(slot);
    }

    /** Player.ForceUseSkill, on its own log line so a refusal is never counted as a cast. */
    async function force(slot) {
        const answer = await call('ForceUseSkill', [String(slot)]);
        if (!answer.ok) lastNote = 'forced skill ' + slot + ': ' + answer.error;
        return answer;
    }

    async function isAlive() {
        const health = await call('Health');
        if (!health.ok) return null;
        if (health.value === null || health.value === undefined || health.value === '') return null;
        return Number(health.value) > 0;
    }

    async function healthPercent() {
        const now = await call('Health');
        const max = await call('HealthMax');
        if (!now.ok || !max.ok) return null;
        const top = Number(max.value);
        if (!isFinite(top) || top <= 0) return null;
        return Math.floor(Number(now.value) * 100 / top);
    }

    /** Is the master in this map? The loader's own PlayersInMap answers with world.areaUsers. */
    async function playerInMap() {
        if (!target) return false;
        const answer = await call('PlayersInMap');
        if (!answer.ok) return null;
        const value = answer.value;
        const names = Array.isArray(value) ? value
            : (value && typeof value === 'object'
                ? Object.keys(value).map(function (key) { return value[key]; })
                : []);
        for (let i = 0; i < names.length; i++) {
            const one = names[i];
            const name = one && typeof one === 'object' ? (one.strUsername || one.uoName || '') : one;
            if (String(name === null || name === undefined ? '' : name).toLowerCase() === target) return true;
        }
        return false;
    }

    /** Is the master in my cell? The loader's own GetCellPlayers, by name. */
    async function playerInCell() {
        if (!target) return false;
        const answer = await call('GetCellPlayers', [target]);
        if (!answer.ok) return null;
        return answer.value === true;
    }

    /**
     * Follow: chase the target's cell when they are in the map, otherwise goto them. The
     * reference's chaseTargetCell walks the target's cell and pad (PlayerByName, then MoveToCell's
     * Jump helper); its gotoTarget writes the raw cmd frame and waits for the map to change.
     */
    async function follow(inMap) {
        if (!target || unfollow) return { ok: true };
        const config = configOf() || {};
        if (inMap === true) {
            await chaseTargetCell();
            return { ok: true };
        }

        const written = await gotoTarget();
        // MaidRemake.cs:335-343: every pass that reaches the goto branch counts, whether the
        // frame was written or the relay was down.
        if (config.StopFailedGoto === true) {
            gotoTries++;
            if (gotoTries >= 5) {
                gotoTries = 0;
                stop('could not reach ' + target + ' five times, so the Maid stopped');
                return { ok: false, error: lastNote };
            }
        }
        await waitForMapLoad(config);
        // The reference's own post-goto chase (MaidRemake.cs:352-356).
        while (enabled && !unfollow && await playerInMap() === true) {
            if (await playerInCell() === true) break;
            await chaseTargetCell();
        }
        return { ok: written };
    }

    /** Player.ExitCombat: when in combat (or forced), refresh the cell and wait the delay out. */
    async function exitCombat(delayMs, force) {
        const state = await call('State');
        const inCombat = state.ok && Number(state.value) === STATE_IN_COMBAT;
        if (!inCombat && force !== true) return { ok: true, skipped: true };
        await sleep(TIMING.exitCombatMs);
        // Player.ExitCombat's own Cut1 branch, then its refreshCell fallback.
        const cells = await call('GetCells');
        const names = Array.isArray(cells.value) ? cells.value : [];
        if (names.indexOf('Cut1') !== -1) {
            await call('Jump', ['Cut1', 'Left']);
        } else {
            const cell = await call('Cell');
            const pad = await call('Pad');
            if (cell.ok) await call('Jump', [String(cell.value), pad.ok ? String(pad.value) : 'Spawn']);
        }
        await sleep(delayMs);
        return { ok: true };
    }

    /**
     * chaseTargetCell (:880-905): in combat first, then MoveToCell to the target's own cell and
     * pad; with no cell to walk to, GoToPlayer instead. Both paths exit combat first, which is
     * what keeps a chase from being swallowed by the fight it leaves behind.
     */
    async function chaseTargetCell() {
        const player = await call('PlayerByName', [target]);
        const where = player.ok ? player.value : null;
        const cell = where && where.strFrame ? String(where.strFrame) : '';
        const pad = where && where.strPad ? String(where.strPad) : 'Spawn';
        const mine = await call('Cell');
        const inCombat = await call('State');
        const fighting = inCombat.ok && Number(inCombat.value) === STATE_IN_COMBAT;
        if (fighting) await exitCombat(TIMING.chaseGoToDelayMs, true);
        if (cell && mine.ok && cell.toLowerCase() !== String(mine.value).toLowerCase()) {
            await call('Jump', [cell, pad]);
            await sleep(TIMING.chaseDelayMs);
            return { ok: true, moved: 'cell' };
        }
        await call('GoTo', [target]);
        await sleep(TIMING.chaseGoToDelayMs);
        return { ok: true, moved: 'goto' };
    }

    /**
     * gotoTarget (:907-917): leave combat first, and only when the target is somewhere else
     * entirely write the raw cmd frame, then wait for the map to change (BotUtilities.WaitUntil,
     * interval 500 ms, timeout 15 - so at most 7.5 s) and for the loading screen to end.
     */
    async function gotoTarget() {
        await exitCombat(1500, true);
        if (await playerInMap() === true) return true;
        const now = await call('Map');
        const currentmap = now.ok ? String(now.value) : '';
        const frame = '%xt%zm%cmd%1%goto%' + target + '%';
        const written = send(frame) === true;
        if (!written) log('maid: the relay has no live connection to goto ' + target + ' on');
        for (let i = 0; i < TIMING.gotoWaitUntilTries; i++) {
            const map = await call('Map');
            const changed = map.ok && String(map.value) !== currentmap;
            if (changed && !(await mapLoading())) break;
            await sleep(TIMING.gotoWaitUntilMs);
        }
        return written;
    }

    /** MaidRemake.cs:346-351: wait the loading screen out, and locked zones get 3 s more. */
    async function waitForMapLoad(config) {
        // 'wait loading screen before try to goto again (max: 5100 ms)'.
        for (let i = 0; i < TIMING.gotoWaitTries && !(await mapLoading()); i++) {
            await sleep(TIMING.gotoWaitPollMs);
        }
        while (enabled && await mapLoading()) await sleep(TIMING.mapLoadPollMs);
        if (config && config.LockedZoneHandler === true) {
            for (let i = 0; i < TIMING.lockedZoneWaitTries; i++) {
                if (await mapLoading()) break;
                await sleep(TIMING.lockedZoneWaitMs);
            }
        }
    }

    /** World.IsMapLoading, over the game's own mapLoadInProgress flag. */
    async function mapLoading() {
        const answer = await readPath(MAP_LOADING_PATH);
        return answer.ok && (answer.value === true || answer.value === 'true');
    }

    /** The reference's waitForFirstJoin (:812-822): loading first, then RelogDelay. */
    async function waitForFirstJoin() {
        while (enabled && await mapLoading()) await sleep(TIMING.firstJoinPollMs);
        if (!enabled) return;
        const delay = Number(configOf().RelogDelay);
        if (isFinite(delay) && delay > 0) await sleep(delay);
    }

    /**
     * The `tgt` field of one skill slot (world.actions.active), which is the reference's own
     * `skillproperties[skillIdx]["tgt"]`: 'h' is a hostile skill, anything else a self/buff one.
     * A slot the game cannot answer is treated as self, the reference's own null comparison.
     */
    async function skillAim(slot) {
        const index = Number(slot);
        if (!isFinite(index) || index < 0) return null;
        const answer = await readPath('world.actions.active.' + index + '.tgt');
        if (!answer.ok || answer.value === null || answer.value === undefined) return null;
        return String(answer.value).toLowerCase();
    }

    // ------------------------------------------------------------------ the loop

    async function run() {
        while (enabled || hasAuxiliaryWork()) {
            try {
                await tick();
                // An active Misc 2 handler may need servicing while the Maid checkbox is off.
                // Keep its cadence on this same scheduler, with no second timer/loop.
                if (!enabled && hasAuxiliaryWork()) await sleep(TIMING.waitStepMs);
            } catch (error) {
                log('maid: ' + message(error));
                await sleep(TIMING.waitStepMs);
            }
            if (onTick) {
                try {
                    onTick();
                } catch (error) {
                    log('maid: a state watcher threw (' + message(error) + ')');
                }
            }
        }
    }

    function setEnabled(on) {
        const next = on === true;
        if (next === enabled) return enabled;
        enabled = next;
        if (!enabled) {
            stop();
        } else {
            firstJoinDone = false;
            status = STATUS.waitingSignIn;
            enableEffects();
        }
        return enabled;
    }

    /**
     * cbEnablePlugin_CheckedChanged's own enable-time lines (:200-244): Lag Killer on, Infinite
     * Range applied once, and for every crystal/ultra mode (anything but None or Auto Potion)
     * the Scroll of Enrage is equipped and skill 5 forced a second later.
     */
    function enableEffects() {
        queueEffect(call('SetLagKiller', ['True']));
        queueEffect(call('SetInfiniteRange', []));
        const mode = Number((configOf() || {}).UltraBossExtra);
        if (isFinite(mode) && mode !== 0 && mode !== 1) queueEffect(equipEnrage());
    }

    /** equipEnrage (:393-406): the equippable, unequipped Scroll, then skill 5 after a second. */
    async function equipEnrage() {
        const bag = await call('GetInventoryItems');
        if (!bag.ok) return { ok: false, error: bag.error };
        const items = Array.isArray(bag.value) ? bag.value : [];
        const scroll = items.filter(function (item) {
            if (!item || typeof item !== 'object') return false;
            if (String(item.sName || '').toLowerCase() !== ENRAGE_NAME.toLowerCase()) return false;
            if (EQUIPPABLE_CATEGORIES.indexOf(String(item.sType || '')) === -1) return false;
            const equipped = item.bEquip === undefined ? item.IsEquipped : item.bEquip;
            return !(equipped === true || Number(equipped) === 1);
        })[0];
        if (!scroll) return { ok: true, equipped: false };
        await call('EquipPotion', [String(scroll.ItemID), scroll.sDesc, scroll.sFile, scroll.sName]);
        await sleep(TIMING.enrageWaitMs);
        await force('5');
        return { ok: true, equipped: true };
    }

    function ensureLoop() {
        if (running || !(enabled || hasAuxiliaryWork())) return loop;
        running = true;
        loop = Promise.resolve(run()).then(function () {
            running = false;
            // If a handler became active as the previous loop was exiting, do not lose its wake.
            if (enabled || hasAuxiliaryWork()) ensureLoop();
        }, function () {
            running = false;
            if (enabled || hasAuxiliaryWork()) ensureLoop();
        });
        return loop;
    }

    return {
        /** The whole visible state: what the window draws and what a test asserts on. */
        state: function () {
            return {
                enabled: enabled,
                target: target,
                unfollow: unfollow,
                stopAttack: stopAttack,
                paused: paused,
                status: currentStatus(),
                note: lastNote,
                engineRunning: engineRunning(),
                collisions: collisions,
                missing: missing.slice()
            };
        },

        setEnabled: setEnabled,
        toggleEnabled: function () { return setEnabled(!enabled); },
        running: function () { return enabled; },

        setTarget: function (name) {
            target = String(name === null || name === undefined ? '' : name).trim().toLowerCase();
            gotoTries = 0;
            return target;
        },
        getTarget: function () { return target; },

        // Unfollow and StopAttack are the reference's two own keys (cbUnfollow "Unfollow (R)",
        // cbStopAttack "StopAttack (T)"), plus a click in the window.
        setUnfollow: function (on) {
            unfollow = on === true;
            if (unfollow) paused = false;
            return unfollow;
        },
        toggleUnfollow: function () { return this.setUnfollow(!unfollow); },
        // cbStopAttack_CheckedChanged does three things the moment the box is ticked, whatever
        // the loop is doing: cancel the auto-attack, cancel the target, and rest.
        setStopAttack: function (on) {
            const next = on === true;
            if (next && !stopAttack) {
                Promise.resolve()
                    .then(function () { return call('CancelAutoAttack'); })
                    .then(function () { return call('CancelTarget'); })
                    .then(function () { return call('Rest'); })
                    .catch(function () {});
            }
            stopAttack = next;
            return stopAttack;
        },
        toggleStopAttack: function () { return this.setStopAttack(!stopAttack); },
        setPaused: function (on) {
            paused = on === true;
            return paused;
        },

        tick: tick,
        follow: follow,
        attack: attack,
        /** doPriorityAttack's own walk, for the CSH rotation's no-target branch. */
        priorityAttack: function () { return priorityTarget(); },
        use: use,
        /**
         * The Maid's own AnimsMsgHandler hands its phrase hit here (MaidRemake.cs:713-714): the
         * forced skill is `numSkillAct`, the box the mode's selection writes (SpecialAct, #44).
         * The next fighting pass spends it through waitSkill, which is the reference's order: the
         * handler only sets `forceSkill = true` and its loop does the cast.
         */
        armSkill: function (slot) {
            forcedSkill = slot === null || slot === undefined || slot === '' ? null : String(slot);
            return forcedSkill;
        },
        /** The Maid's own taunt cycle: yield to a new bot command, arm SpecialAct, then attack. */
        tauntCycleAttack: async function (monster, slot) {
            if (!enabled || paused || stopAttack) return { ok: false, deferred: true };
            const collision = engineCollision();
            if (collision) {
                log('maid: ' + collision);
                status = STATUS.collision;
                return { ok: false, deferred: true, collision: collision };
            }
            forcedSkill = String(slot);
            status = STATUS.fighting;
            const answer = await attack(monster);
            if (!answer.ok) forcedSkill = null;
            return answer;
        },
        /** The pass-by-pass watcher, for the window: see `onTick` above. */
        setOnTick: function (watcher) {
            onTick = typeof watcher === 'function' ? watcher : null;
            return onTick;
        },
        start: function () {
            setEnabled(true);
            if (running) return loop;
            return ensureLoop();
        },
        /** Wake the same loop when a Misc 2 handler starts or stops. */
        wake: ensureLoop,
        stop: stop,
        idle: function () { return loop || Promise.resolve(); },
        /** The loop plus the enable-time effects, so a caller can await a settled enable. */
        settled: function () {
            return Promise.all(effects.slice()).then(function () {
                return loop || Promise.resolve();
            }).then(function () { return undefined; });
        },
        collisions: function () { return collisions; },
        note: function () { return lastNote; }
    };

    function stop(why) {
        enabled = false;
        status = STATUS.off;
        firstJoinDone = false;
        forcedSkill = null;
        // stopMaid (:863-996) unticks Unfollow and clears onPause on the way out.
        unfollow = false;
        paused = false;
        gotoTries = 0;
        // OptionsManager.SetLagKiller(toggle) runs on both edges (:198-199), so stopping through
        // any door - the box, a party `.stop`, or five failed gotos - turns Lag Killer back off.
        queueEffect(call('SetLagKiller', ['False']));
        if (why) log('maid: ' + why);
    }
}

module.exports = {
    createMaid: createMaid,
    HELPERS: HELPERS,
    BLOCKED: BLOCKED,
    TIMING: TIMING,
    STATUS: STATUS,
    TARGET_NAME_PATH: TARGET_NAME_PATH,
    TARGET_ID_PATH: TARGET_ID_PATH,
    MAP_LOADING_PATH: MAP_LOADING_PATH,
    EQUIPPABLE_CATEGORIES: EQUIPPABLE_CATEGORIES,
    ENRAGE_NAME: ENRAGE_NAME
};
