// The Maid's frame-driven handlers (ticket #44): per-boss behaviour and the auto-zone handlers that
// move a party through a multi-part run. Reference: Grimlite-Li 816d9cd, one file per family under
// Grimoire/Networking/Handlers/ plus the Maid form's own packet subscriptions in
// Grimoire/UI/Maid/MaidRemake.cs.
//
// Packet-shaped behavior here is a REACTION TO A FRAME, which is this ticket's own acceptance
// criterion: a handler registers for a command and fires on the frame, the way the reference's
// Proxy.RegisterHandler / Flash.FlashCall2 subscriptions do. Effects that need live health, target,
// position, or monster state are serviced by the existing Maid scheduler; this module starts no
// timer or second polling loop.
//
// THE SET, which is the reference's own and is transcribed rather than summarised:
//
//   * the Bot Manager's Misc 2 combo, 15 entries (BotManager.Designer.cs:3464-3478) over nine
//     handler classes: 7 auto-zone walkers, the Gramiel taunt with four presets, and the Ultra
//     Speaker rotation with four roles;
//   * TWO of those files hold more than the class they are named after -
//     HandlerAutoZoneAstralEmpyreanP1.cs declares P1 *and* P2 (one abstract base plus two
//     one-line subclasses), and HandlerUltraSpeakerMechanics.cs declares DPS, LR, LOO and AP on
//     top of its base. Those are the entries easiest to miss, so HANDLED lists every class by the
//     file it is declared in;
//   * HandlerTaunterChampionDrakath.cs declares HandlerAutoZoneUltraDage (the reference
//     copy-pasted the file and renamed nothing) and is not in Grimoire.csproj, so Champion Drakath
//     has no handler of its own and nothing here invents one;
//   * the Maid form's own handlers, behind the five config keys ticket #43 carried and did not
//     read: UltraBossExtra/SpecialMsg/SpecialAct (the per-boss mode, its phrase list and the skill
//     it forces), AntiCounter, CopyWalk, and the whitelist and locked-zone map lists.
//
// THE CAST WALL IS DOWN (#38's finding, corrected by #49). #38 refused AttackMonster, UseSkill and
// ForceUseSkill on the finding that each hands the game a live ActionScript object a JSON bridge
// cannot carry. That was right about the constraint and wrong about where it bites: the JSON
// boundary is the page-to-movie hop, and the game's classes live in the movie's own
// ApplicationDomain, so the movie resolves the object itself and does the plumbing in-domain. The
// six names went live in #49, which is why every handler here makes the reference's own calls and
// expects them to land. A call that still fails is reported once per name in the surface's own
// words (see the report function below): a bridge that is not answering is a state the user has to
// be told about, not one a handler may paper over.
//
// HandlerUltraGramielTaunt's TauntLoop and HandlerUltraSpeakerMechanics' 50 ms ContinuousLoop are
// represented by schedulerTick below: it attacks the opposite Gramiel crystal, taunts until
// Vendetta, acquires `*` when the Speaker has no target, heals AP/LOO with skill 2 and LR with
// skill 3 below 70%, maintains Speaker position, and records death/respawn. Gramiel's upstream map
// guard is inverted, so its unattended effects run in Ultra Gramiel maps where the preset is
// useful. The source loops' cadence is replaced by the existing Maid scheduler's cadence.
//
// The reference's BotManager.Instance.ActiveBotEngine.paused = true around a taunt: the port
// settles engine-vs-Maid by yielding the tick (ticket #43's own rule), so no handler here reaches
// into the engine.

const auras = require('../../bot/auras.js');

// ------------------------------------------------------------------ the reference's own data

// cmbUltraBoss (MaidRemake.designer.cs:165-177), in its own order. None is index 0 and
// Auto Potion is 1, so a shipped file that carries UltraBossExtra: 2 means Asc.Solstice P1.
const MODES = [
    'None',
    'Auto Potion',
    'Asc.Solstice P1',
    'Asc.Solstice P2',
    'Asc.Midnight P1',
    'Asc.Midnight P2',
    'Ast.Empyrean P1',
    'Ast.Empyrean P2',
    'Gramiel L1',
    'Gramiel L2',
    'Gramiel R1',
    'Gramiel R2'
];

// What picking a mode writes into the form (MaidRemake.cs:1269-1320, cmbUltraBoss_SelectedIndex-
// Changed): the attack-priority list, the phrase list and the forced skill. The mode itself is only
// a counter and a phrase comparison, so selecting it is what arms the rest - and ApplyConfig sets
// the index, so the handler runs on every config load. None and Auto Potion write nothing, which is
// the reference's own empty branch.
const MODE_FILLS = {
    'Asc.Solstice P1': { AttackPriority: true, AttackPriorityMonster: 'Ascended Solstice', SpecialMsg: 'sun converges', SpecialAct: 5 },
    'Asc.Solstice P2': { AttackPriority: true, AttackPriorityMonster: 'Ascended Solstice', SpecialMsg: 'sun converges', SpecialAct: 5 },
    'Asc.Midnight P1': { AttackPriority: true, AttackPriorityMonster: 'Ascended Midnight', SpecialMsg: 'moon converges', SpecialAct: 5 },
    'Asc.Midnight P2': { AttackPriority: true, AttackPriorityMonster: 'Ascended Midnight', SpecialMsg: 'moon converges', SpecialAct: 5 },
    'Ast.Empyrean P1': { AttackPriority: true, AttackPriorityMonster: 'Astral Empyrean', SpecialMsg: 'behold our starfire', SpecialAct: 5 },
    'Ast.Empyrean P2': { AttackPriority: true, AttackPriorityMonster: 'Astral Empyrean', SpecialMsg: 'behold our starfire', SpecialAct: 5 },
    'Gramiel L1': { AttackPriority: true, AttackPriorityMonster: 'id.2,crystal', SpecialMsg: 'shattering', SpecialAct: 5 },
    'Gramiel L2': { AttackPriority: true, AttackPriorityMonster: 'id.2,crystal', SpecialMsg: 'shattering', SpecialAct: 5 },
    'Gramiel R1': { AttackPriority: true, AttackPriorityMonster: 'id.3,crystal', SpecialMsg: 'shattering', SpecialAct: 5 },
    'Gramiel R2': { AttackPriority: true, AttackPriorityMonster: 'id.3,crystal', SpecialMsg: 'shattering', SpecialAct: 5 }
};

// The form's own designer text for the two boxes the shipped template omits: tbSpecialMsg is
// 'converge,truth,resist,bleee' (designer :629) and numSkillAct is 5 (:678-682). A config that
// omits a key leaves the box as the designer left it, which is what the reference's overlay rule
// means; cbAntiCounter is ticked in the designer (:379), so an absent AntiCounter is ON, not off.
const DESIGNER = {
    SpecialMsg: 'converge,truth,resist,bleee',
    SpecialAct: 5,
    UltraBossExtra: 0,
    AntiCounter: true,
    CopyWalk: false
};

// cmbSpecials (BotManager.Designer.cs:3464-3478), in its own order: the auto-zone combo.
const NAMES = [
    'Auto Zone - Ultradage',
    'Auto Zone - Dark Carnax',
    'Auto Zone - Astral Empyrean',
    'Auto Zone - Astral Empyrean P1',
    'Auto Zone - Astral Empyrean P2',
    'Auto Zone - Queen Iona',
    'Auto Zone - Colossal Vordred',
    'Gramiel P1',
    'Gramiel P2',
    'Gramiel P3',
    'Gramiel P4',
    'Ultra Speaker DPS',
    'Ultra Speaker LR',
    'Ultra Speaker LOO',
    'Ultra Speaker AP'
];

// Every handler class the reference ships, by the file that declares it and the combo entry that
// reaches it. A class declared in a file named after a sibling is listed too: missing those is the
// under-delivery this table exists to prevent.
const HANDLED = {
    HandlerAutoZoneUltraDage: {
        zone: 'Auto Zone - Ultradage', file: 'HandlerAutoZoneUltraDage.cs'
    },
    HandlerAutoZoneDarkCarnax: {
        zone: 'Auto Zone - Dark Carnax', file: 'HandlerAutoZoneDarkCarnax.cs'
    },
    HandlerAutoZoneAstralEmpyrean: {
        zone: 'Auto Zone - Astral Empyrean', file: 'HandlerAutoZoneAstralEmpyrean.cs'
    },
    HandlerAutoZoneAstralEmpyreanP1: {
        zone: 'Auto Zone - Astral Empyrean P1', file: 'HandlerAutoZoneAstralEmpyreanP1.cs'
    },
    HandlerAutoZoneAstralEmpyreanP2: {
        zone: 'Auto Zone - Astral Empyrean P2', file: 'HandlerAutoZoneAstralEmpyreanP1.cs'
    },
    HandlerAutoZoneQueenIona: {
        zone: 'Auto Zone - Queen Iona', file: 'HandlerAutoZoneQueenIona.cs'
    },
    HandlerAutoZoneVordred: {
        zone: 'Auto Zone - Colossal Vordred', file: 'HandlerAutoZoneVordred.cs'
    },
    HandlerUltraGramielTaunt: {
        zone: 'Gramiel P1', file: 'HandlerUltraGramielTaunt.cs',
        presets: ['Gramiel P1', 'Gramiel P2', 'Gramiel P3', 'Gramiel P4']
    },
    HandlerUltraSpeakerDPS: {
        zone: 'Ultra Speaker DPS', file: 'HandlerUltraSpeakerMechanics.cs'
    },
    HandlerUltraSpeakerLR: {
        zone: 'Ultra Speaker LR', file: 'HandlerUltraSpeakerMechanics.cs'
    },
    HandlerUltraSpeakerLOO: {
        zone: 'Ultra Speaker LOO', file: 'HandlerUltraSpeakerMechanics.cs'
    },
    HandlerUltraSpeakerAP: {
        zone: 'Ultra Speaker AP', file: 'HandlerUltraSpeakerMechanics.cs'
    }
};

// These two base classes are declared alongside the concrete roles upstream. They add behavior
// inherited by the listed entries; they are not separate combo choices.
const HANDLED_BASES = {
    HandlerAutoZoneAstralEmpyreanBase: {
        file: 'HandlerAutoZoneAstralEmpyreanP1.cs',
        entries: ['Auto Zone - Astral Empyrean P1', 'Auto Zone - Astral Empyrean P2']
    },
    HandlerUltraSpeakerMechanics: {
        file: 'HandlerUltraSpeakerMechanics.cs',
        entries: ['Ultra Speaker DPS', 'Ultra Speaker LR', 'Ultra Speaker LOO', 'Ultra Speaker AP']
    }
};

// The astral walk is the same three points in the plain handler and in both presets.
const ASTRAL_ZONES = { A: ['708', '447'], B: ['287', '191'], other: ['461', '329'] };

// The Ultra Speaker rotation, verbatim (HandlerUltraSpeakerMechanics.cs:283-310, WhatAction):
// taunt fires skill 5 for that role after delay ms, zone/type move that role in or out of the
// zone, and index 15 wraps the counter back to 1 - on its own row, SPEAKER_WRAP below.
const SPEAKER_ROWS = [
    { taunt: 'LR', zone: null, type: null, delay: 0 },
    { taunt: 'LOO', zone: 'DPS', type: 'IN', delay: 0 },
    { taunt: 'AP', zone: 'DPS', type: 'OUT', delay: 0 },
    { taunt: 'LOO', zone: null, type: null, delay: 100 },
    { taunt: null, zone: 'LR', type: 'IN', delay: 0 },
    { taunt: 'LR', zone: 'LR', type: 'OUT', delay: 100 },
    { taunt: null, zone: null, type: null, delay: 0 },
    { taunt: 'LOO', zone: null, type: null, delay: 100 },
    { taunt: null, zone: 'AP', type: 'IN', delay: 0 },
    { taunt: 'AP', zone: 'AP', type: 'OUT', delay: 0 },
    { taunt: 'LR', zone: null, type: null, delay: 100 },
    { taunt: null, zone: 'LOO', type: 'IN', delay: 0 },
    { taunt: 'LOO', zone: 'LOO', type: 'OUT', delay: 100 },
    { taunt: null, zone: null, type: null, delay: 0 },
    { taunt: 'LR', zone: null, type: null, delay: 0 }
];

// The reference's own index 15 (:305-308): the counter goes back to 1 and the row it runs is row
// 1's shape with a *different* delay - 100 ms, not 0. A row of its own rather than a reuse of
// SPEAKER_ROWS[1], because that difference is the reference's, not a rounding.
const SPEAKER_WRAP = { taunt: 'LOO', zone: 'DPS', type: 'IN', delay: 100 };

// The Speaker's own constants (HandlerUltraSpeakerMechanics.cs:44-49 and :92-115): where it stands,
// where its zone is, the two phrases it rotates on, and the two heals the four roles carry.
const SPEAKER = {
    cell: 'Boss',
    map: 'ultraspeaker',
    start: ['100', '321'],
    zoneAt: ['203', '301'],
    phrases: ['truth', 'listen'],
    // SetForceSkill("5", step.delay) is the taunt the rotation hands to whichever role the row
    // names, so the index is the file's own literal rather than a per-role value.
    skill: '5'
};

// The coordinates, phrases and skill indices each combo entry carries, as data. `triggers` is each
// family's own HandledCommands (HandlerAutoZoneUltraDage.cs:9 and its four siblings, `{ "event" }`;
// HandlerAutoZoneAstralEmpyreanP1.cs:37, `{ "event", "ct" }`; HandlerUltraGramielTaunt.cs:35 and
// HandlerUltraSpeakerMechanics.cs:22, `{ "ct" }`), because that list is the packet event each
// handler fires on - which is this ticket's third acceptance criterion.
const SPECS = {
    'Auto Zone - Ultradage': {
        triggers: ['event'],
        zones: { A: ['107', '400'], B: ['843', '400'], other: ['503', '276'] }
    },
    'Auto Zone - Dark Carnax': {
        triggers: ['event'],
        zones: { A: ['860', '400'], B: ['49', '400'], other: ['426', '372'] }
    },
    'Auto Zone - Astral Empyrean': { triggers: ['event'], zones: ASTRAL_ZONES },
    'Auto Zone - Colossal Vordred': {
        triggers: ['event'],
        zones: { A: ['731', '461'], B: ['700', '321'], other: ['748', '372'] }
    },
    'Auto Zone - Queen Iona': {
        triggers: ['event'],
        // The auras are read after the reference's own half second (its Task.Delay(500)), and the
        // two spellings of each charge count for the same side (GetAuras(true, ...) twice).
        delayMs: 500,
        auras: {
            positive: ['Positive Charge', 'Negative Charge?'],
            negative: ['Negative Charge', 'Positive Charge?']
        },
        zones: {
            A: { positive: ['679', '339'], negative: ['272', '379'] },
            B: { positive: ['272', '379'], negative: ['679', '339'] },
            other: ['490', '320']
        }
    },
    'Auto Zone - Astral Empyrean P1': {
        triggers: ['event', 'ct'],
        zones: ASTRAL_ZONES,
        phrase: 'behold our starfire',
        parity: 'odd',
        monster: 'Astral Empyrean',
        skill: '5'
    },
    'Auto Zone - Astral Empyrean P2': {
        triggers: ['event', 'ct'],
        zones: ASTRAL_ZONES,
        phrase: 'behold our starfire',
        parity: 'even',
        monster: 'Astral Empyrean',
        skill: '5'
    },
    // Gramiel's four presets share one body upstream; what differs is the crystal id and the
    // parity of the defense-shattering count they act on.
    'Gramiel P1': { triggers: ['ct'], monId: '2', parity: 'odd' },
    'Gramiel P2': { triggers: ['ct'], monId: '2', parity: 'even' },
    'Gramiel P3': { triggers: ['ct'], monId: '3', parity: 'odd' },
    'Gramiel P4': { triggers: ['ct'], monId: '3', parity: 'even' },
    'Ultra Speaker DPS': { triggers: ['ct'], role: 'DPS' },
    'Ultra Speaker LR': { triggers: ['ct'], role: 'LR' },
    'Ultra Speaker LOO': { triggers: ['ct'], role: 'LOO' },
    'Ultra Speaker AP': { triggers: ['ct'], role: 'AP' }
};

// The Gramiel presets' shared values (HandlerUltraGramielTaunt.cs:54-210), in one place because
// the file has one body for all four. The orb is the preset's own side: P1/P2 left (id:2), P3/P4
// right (id:3).
['Gramiel P1', 'Gramiel P2', 'Gramiel P3', 'Gramiel P4'].forEach(function (name) {
    Object.assign(SPECS[name], {
        phrase: 'defense shattering',
        monster: 'Gramiel',
        grace: 'Grace Crystal',
        aura: 'Vendetta',
        skill: '5',
        orb: name === 'Gramiel P1' || name === 'Gramiel P2' ? 'id:2' : 'id:3',
        otherOrb: name === 'Gramiel P1' || name === 'Gramiel P2' ? 'id:3' : 'id:2'
    });
});

['Ultra Speaker DPS', 'Ultra Speaker LR', 'Ultra Speaker LOO', 'Ultra Speaker AP'].forEach(function (name) {
    Object.assign(SPECS[name], SPEAKER, { rotation: SPEAKER_ROWS });
});
// The two heals two of the four roles carry for any player under 70 per cent.
SPECS['Ultra Speaker AP'].heal = { skill: '2', roles: ['AP', 'LOO'] };
SPECS['Ultra Speaker LOO'].heal = { skill: '2', roles: ['AP', 'LOO'] };
SPECS['Ultra Speaker LR'].heal = { skill: '3', roles: ['LR'] };

// The reference's own random goto delay (WarningMsgHandler.cs:48, :55) and the private map it
// falls back to.
const SAFE_MAP = { name: 'whitemap', minMs: 750, maxMs: 1300 };

// The taunt sequence's own three numbers, which are the same in the two files that carry it
// (HandlerUltraGramielTaunt.cs:150-172, HandlerAutoZoneAstralEmpyreanP1.cs:137-160): at most three
// attempts, a 500 ms wait after the forced cast, and a 300 ms wait before re-reading Focus.
const TAUNT_ATTEMPTS = 3;
const TAUNT_FORCE_GAP_MS = 500;
const TAUNT_RECHECK_MS = 300;

// The Speaker's taunt spam: fifty pairs of UseSkill('5') with thirty milliseconds between the two
// casts of a pair (HandlerUltraSpeakerMechanics.cs:330-375), which is the loop's own bound.
const SPEAKER_TAUNT_PAIRS = 50;
const SPEAKER_TAUNT_GAP_MS = 30;

// The two reference loops are serviced by the existing Maid scheduler. These are the delays
// between the Gramiel loop's own availability branches; Speaker position/health work runs once
// per Maid pass instead of adding HandlerUltraSpeakerMechanics' separate 50 ms timer.
const GRAMIEL_POLL_MS = { orb: 1000, absent: 2000, grace: 1000, taunt: 5000 };

// How many passes a tc; cycle runs before it stops itself. The reference's own loop is open-ended
// (its CancellationToken comes from the form), so this is the one bound this build adds: at the
// shipped default line `tc;2;*;12` it is six seconds per pass for over eleven minutes of rotation.
const TAUNT_CYCLE_MAX_PASSES = 120;

// The game's own map-load flag. Not a loader name: the surface's MapLoadComplete row is a reason
// row (ticket #41 owns the display-list half) while world.mapLoadInProgress is the half a reload
// actually trips, which is the path bot/session.js reads for the same reason.
const MAP_LOADING_PATH = 'world.mapLoadInProgress';

// The field an attack by MonMapID is confirmed against, and the target's own name - the two the
// reference's doPriorityAttack reads off objData.
const TARGET_ID_PATH = 'world.myAvatar.target.objData.MonMapID';

function message(error) {
    return (error && error.message) || String(error);
}

/** A command property as a number, with the reference's own default when it is not one. */
function number(value, fallback) {
    const parsed = Number(value);
    return isFinite(parsed) ? parsed : fallback;
}

/** A frame's bytes as text, whether the tap handed over a Buffer or a string. */
function text(value) {
    if (typeof value === 'string') return value;
    if (value && typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.toString('utf8');
    return value === null || value === undefined ? '' : String(value);
}

/** Case-insensitive Contains, the reference's own extension (Extensions.cs:21-26). */
function contains(source, value) {
    const hay = String(source === null || source === undefined ? '' : source).toLowerCase();
    const needle = String(value === null || value === undefined ? '' : value).toLowerCase();
    if (hay === '' || needle === '') return false;
    return hay.indexOf(needle) !== -1;
}

/** An XT frame's arguments, as XtMessage splits them: on '%', leading empty field kept. */
function xtArguments(frame) {
    const body = String(frame === null || frame === undefined ? '' : frame);
    if (body.charAt(0) !== '%') return [];
    return body.split('%');
}

/**
 * XtMessage's own command, including its 'zm' special case (XtMessage.cs:16-22): the third field
 * unless that is 'zm', where a 'cmd' frame answers its fifth field and anything else its fourth.
 * The offset is handed back with it, because every argument index below depends on it.
 */
function xtCommand(fields) {
    const args = fields || [];
    if (args.length < 4) return { command: '', base: 2 };
    if (args[2] !== 'zm') return { command: args[2], base: 2 };
    if (args[3] === 'cmd') return { command: args.length > 5 ? args[5] : '', base: 3 };
    return { command: args[3], base: 3 };
}

/** The strFrame / strPad / tx / ty a uotls movement string carries. */
function movementOf(body) {
    const out = { cell: null, pad: null, x: null, y: null };
    String(body === null || body === undefined ? '' : body).split(',').forEach(function (part) {
        const at = part.indexOf(':');
        if (at === -1) return;
        const key = part.slice(0, at);
        const value = part.slice(at + 1);
        if (key === 'strFrame') out.cell = value;
        else if (key === 'strPad') out.pad = value;
        else if (key === 'tx') out.x = Number(value);
        else if (key === 'ty') out.y = Number(value);
    });
    return out;
}

/** The line the reference's own error dialog offers to write back (MaidRemake.cs:454). */
const TAUNT_EXAMPLE = 'tc;2;*;12;<order 1-4>(optional)';

/**
 * The taunt-cycle spec the reference's taunt() parses out of tbSpecialMsg
 * (MaidRemake.cs:409-462): 'tc;<cycle>;<monster>;<second>;<order 1-4>', with the defaults
 * cycle 2, monster *, second 12 and order -1, and the reference's own two error sentences.
 * Answers {ok, spec} or {ok: false, error, example}.
 */
function parseTauntCycle(line) {
    const raw = String(line === null || line === undefined ? '' : line);
    if (raw.slice(0, 3).toLowerCase() !== 'tc;') return { ok: false, error: 'not a taunt cycle' };
    const parts = raw.split(';');
    const spec = { cycle: 2, mon: '*', second: 12, order: -1 };
    if (parts.length > 1) {
        const cycle = Number(parts[1]);
        if (!isFinite(cycle) || parts[1].trim() === '') {
            return { ok: false, error: "Cycle isn't a valid number!", example: TAUNT_EXAMPLE };
        }
        spec.cycle = cycle;
    }
    if (parts.length > 2 && parts[2].trim() !== '') spec.mon = parts[2];
    if (parts.length > 3) {
        const second = Number(parts[3]);
        if (!isFinite(second)) {
            return { ok: false, error: "Seconds isn't a valid number!", example: TAUNT_EXAMPLE };
        }
        spec.second = second;
    }
    if (parts.length > 4) {
        const order = Number(parts[4]);
        // A non-numeric order is not an error upstream: its `!int.TryParse(...)` guard runs the
        // decrement instead, which lands on -1 - the reference's own "pick my party index" value.
        spec.order = isFinite(order) ? order : -1;
    }
    return { ok: true, spec: spec };
}

/**
 * @param {object} deps
 * @param {object} deps.game   the Maid's game access: loaderCall(name, args) plus read(path)
 * @param {object} [deps.maid]  the scheduler, for the three things a handler moves: setPaused,
 *                              setStopAttack and armSkill
 * @param {() => object} [deps.config] the live Maid config
 * @param {object} [deps.auras] the tapped aura store; a fresh one is made when absent
 * @param {(line: string) => void} [deps.log]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {() => number} [deps.random] 0..1, injected so a fallback map is testable
 */
function createZoneHandlers(deps) {
    deps = deps || {};
    const game = deps.game || {};
    const log = typeof deps.log === 'function' ? deps.log : function () {};
    const sleep = typeof deps.sleep === 'function'
        ? deps.sleep
        : function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
    const random = typeof deps.random === 'function' ? deps.random : Math.random;
    const store = deps.auras || auras.createAuraStore();
    const configOf = typeof deps.config === 'function' ? deps.config : function () { return {}; };
    const maid = deps.maid || null;
    // Said when the panel moves, so a caller that owns a tap can take or give up its subscription:
    // a handler that is registering reads frames, and one that is off reads none.
    const onChange = typeof deps.onChange === 'function' ? deps.onChange : function () {};

    // cmbSpecials' own state, and the frame handlers' own counters.
    let selected = null;   // cmbSpecials.SelectedItem, the combo's own selection
    let checked = false;   // chkSpecial.Checked, which is what registers the selection
    let maidOn = false;
    let specialAnimsOn = true;
    let selfKey = null;
    let sunCount = 0;
    let moonCount = 0;
    let crystalCount = 0;
    let maidCrystalCount = 0;
    let starfireCount = 0;      // shared by the two Astral Empyrean presets, as upstream's static
    let maidStarfireCount = 0;  // the Maid form's own counter, which is a second static upstream
    let speakerCounter = -1;
    let inZone = false;
    let lockedIndex = 0;        // AlternativeMap's own round-robin cursor
    let countering = false;     // the reference's own four-second counter warning
    let locktarget = false;     // Gramiel's drain, which holds the target for four seconds
    let currentMap = '';
    let scheduledName = null;
    let speakerConstructed = false;
    let speakerWasDead = false;
    let gramielNextPoll = 0;
    let gramielTauntRunning = false;
    let gramielRunGeneration = 0;
    const reported = {};        // a refusal is said once, not once per frame
    const cycles = new Map();   // the tc; rotations, by the key their caller filed them under

    /** A loader helper by the reference's own name. The refusal carries the surface's words. */
    function call(name, args) {
        if (!game || typeof game.loaderCall !== 'function') {
            return Promise.reject(new Error('this window has no game bridge channel'));
        }
        return Promise.resolve(game.loaderCall(name, args || []));
    }

    /** One dot-path read, for the map-load flag the surface only carries a reason row for. */
    function readPath(path) {
        if (!game || typeof game.read !== 'function') return Promise.resolve({ value: null });
        return Promise.resolve(game.read(path)).then(function (answer) {
            return answer && typeof answer === 'object' ? answer : { value: answer };
        }, function () { return { value: null }; });
    }

    /**
     * A call that could not be made is said once per name, with the surface's own reason: a
     * handler that fires on every animation frame would otherwise fill the log with one sentence.
     */
    function report(what, error) {
        const said = what + ': ' + message(error);
        if (reported[said]) return;
        reported[said] = true;
        log('maid: ' + said);
    }

    /** A loader call whose failure is reported once and does not stop the handler. */
    function attempt(name, args) {
        return call(name, args).then(function (value) {
            return { ok: true, value: value, helper: name };
        }, function (error) {
            report(name, error);
            return { ok: false, error: message(error), helper: name };
        });
    }

    /** A boolean a loader helper answered. */
    function truthy(answer) {
        return answer.ok && (answer.value === true || answer.value === 'true' || answer.value === 1);
    }

    /** Is the map still loading? The flag the reference's World.IsMapLoading reads. */
    function mapLoading() {
        return readPath(MAP_LOADING_PATH).then(function (answer) {
            return answer.value === true || answer.value === 'true';
        });
    }

    /** Player.GetAuras(true, name), which the reference serves from its tapped self-cache. */
    function selfStacks(name) {
        return attempt('UserID').then(function (id) {
            if (!id.ok) return 0;
            // The cache drops every other player's key once it knows which one is this
            // character's, the way bot/session.js's own selfId does (ticket #42).
            if (selfKey !== 'p:' + id.value) {
                selfKey = 'p:' + id.value;
                store.setSelf(selfKey);
            }
            return store.value(selfKey, name);
        });
    }

    /** Player.GetAuras(false, name): the target's stacks, keyed by its own MonMapID. */
    function targetStacks(name) {
        return readPath(TARGET_ID_PATH).then(function (answer) {
            if (answer.value === null || answer.value === undefined || answer.value === '') return 0;
            return store.value('m:' + answer.value, name);
        });
    }

    /** A config value, with the form's own designer value where the file has none. */
    function configured(key) {
        const value = (configOf() || {})[key];
        return value === undefined || value === null ? DESIGNER[key] : value;
    }

    // ---------------------------------------------------------------- movement and attacks

    /** Player.WalkToPoint, which the surface implements as the game's own moveRequest. */
    function walkTo(point) {
        if (!point) return Promise.resolve({ ok: false, error: 'this zone has no point' });
        return attempt('WalkToPoint', [String(point[0]), String(point[1])]);
    }

    /**
     * Player.AttackMonster(name), on its own log line. The reference's Player.cs splits the four
     * id.<n> spellings off to AttackMonsterByMonMapId, which is the helper the reference's own
     * loader registers for each.
     */
    function attackMonster(name) {
        const wanted = String(name);
        const prefix = ["id'", 'id.', 'id:', 'id-'].filter(function (one) {
            return wanted.indexOf(one) === 0;
        })[0];
        const helper = prefix ? 'AttackMonsterByMonMapId' : 'AttackMonster';
        const args = prefix ? [wanted.split(prefix.charAt(2))[1]] : [wanted];
        return attempt(helper, args);
    }

    /** World.IsMonsterAvailable(name), over the monster reads ticket #38 implemented. */
    function monsterThere(name) {
        return attempt('IsMonsterAvailable', [name]).then(truthy);
    }

    /** The live entries World.PlayersInMap and Position carry across the loader bridge. */
    function listValue(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) return parsed;
            } catch (error) {
                // The source is not JSON; the caller can still treat it as a list-shaped value.
            }
        }
        return [];
    }

    function positionValue(value) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                if (Array.isArray(parsed)) return parsed;
            } catch (error) {
                // The source is not JSON, so it is not a usable position tuple.
            }
        }
        return null;
    }

    function scheduledValue(context, key, helper) {
        if (context && Object.prototype.hasOwnProperty.call(context, key)) {
            return Promise.resolve({ ok: true, value: context[key] });
        }
        return attempt(helper);
    }

    /** The Speaker's former ContinuousLoop, one pass on the existing Maid scheduler. */
    async function speakerSchedulerTick(name, spec, context) {
        const signedIn = await scheduledValue(context, 'loggedIn', 'IsLoggedIn');
        if (!truthy(signedIn)) return { ok: true, loggedIn: false };
        const health = await scheduledValue(context, 'health', 'Health');
        const alive = context && typeof context.alive === 'boolean'
            ? context.alive : (health.ok && Number(health.value) > 0);
        let cell = null;
        if (!speakerConstructed) {
            speakerConstructed = true;
            if (!alive) {
                // The reference constructor sets _wasDead before ContinuousLoop starts, which
                // suppresses a death log for a character that was already dead on registration.
                speakerWasDead = true;
            } else {
                const map = await scheduledValue(context, 'map', 'Map');
                cell = await scheduledValue(context, 'cell', 'Cell');
                if (map.ok && String(map.value || '').toLowerCase() === SPEAKER.map &&
                    cell.ok && String(cell.value || '').toLowerCase() === SPEAKER.cell.toLowerCase()) {
                    await walkTo(SPEAKER.start);
                }
            }
        }
        if (!alive) {
            if (!speakerWasDead) log('💀💀💀 ' + spec.role + ' DIED 💀💀💀');
            speakerWasDead = true;
            return { ok: true, dead: true };
        }

        const resumed = speakerWasDead;
        if (resumed) {
            log('♻️ ' + spec.role + ' RESPAWNED - Repositioning to start');
            speakerWasDead = false;
            await walkTo(SPEAKER.start);
        }

        if (!cell) cell = await scheduledValue(context, 'cell', 'Cell');
        if (!cell.ok || String(cell.value || '').toLowerCase() !== SPEAKER.cell.toLowerCase()) {
            return { ok: true, resumed: resumed, cell: cell.value || '' };
        }

        let attacked = false;
        const target = await scheduledValue(context, 'hasTarget', 'HasTarget');
        if (!truthy(target)) {
            const available = await monsterThere('*');
            if (available) {
                await attackMonster('*');
                attacked = true;
            }
        }

        if (spec.heal) {
            const players = await attempt('PlayersInMap');
            const names = listValue(players.ok ? players.value : null);
            for (let i = 0; i < names.length; i++) {
                const player = names[i] && typeof names[i] === 'object'
                    ? (names[i].strUsername || names[i].uoName || '') : names[i];
                const percentage = await attempt('GetPlayerHealthPercentage', [String(player)]);
                if (percentage.ok && Number(percentage.value) < 70) {
                    await attempt('UseSkill', [spec.heal.skill]);
                    break;
                }
            }
        }

        const position = await attempt('Position');
        const point = positionValue(position.ok ? position.value : null);
        const wanted = inZone ? spec.zoneAt : spec.start;
        if (point && String(point[0]) !== String(wanted[0])) await walkTo(wanted);
        return { ok: true, wildcardAttempted: attacked, healed: !!spec.heal, resumed: resumed };
    }

    /** The Speaker's 50 ms auto-attack/position/heal loop now runs on Maid scheduler passes. */
    async function gramielSchedulerTick(name, spec, context) {
        const signedIn = await scheduledValue(context, 'loggedIn', 'IsLoggedIn');
        if (!truthy(signedIn)) return { ok: true, loggedIn: false };
        const map = await scheduledValue(context, 'map', 'Map');
        const mapName = map.ok ? String(map.value || '').toLowerCase() : '';
        // The reference's ContainsIgnoreCase guard is inverted: it waits on Ultra Gramiel itself.
        // The per-boss preset must do its unattended encounter work in that map.
        if (mapName.indexOf('ultragramiel') === -1) {
            gramielNextPoll = Date.now() + GRAMIEL_POLL_MS.absent;
            return { ok: true, map: mapName };
        }
        if (Date.now() < gramielNextPoll) return { ok: true, waiting: true };

        const available = await Promise.all([
            monsterThere(spec.orb), monsterThere(spec.otherOrb),
            monsterThere(spec.monster), monsterThere(spec.grace)
        ]);
        if (!available[0] && available[1]) {
            gramielNextPoll = Date.now() + GRAMIEL_POLL_MS.orb;
            await attackMonster(spec.otherOrb);
            return { ok: true, attacked: spec.otherOrb };
        }
        if (!available[2]) {
            gramielNextPoll = Date.now() + GRAMIEL_POLL_MS.absent;
            return { ok: true, waiting: 'Gramiel' };
        }
        if (available[3]) {
            gramielNextPoll = Date.now() + GRAMIEL_POLL_MS.grace;
            return { ok: true, waiting: 'Grace Crystal' };
        }

        gramielNextPoll = Date.now() + GRAMIEL_POLL_MS.taunt;
        const vendetta = await selfStacks(spec.aura);
        if (vendetta > 0) return { ok: true, waiting: 'Vendetta' };
        await attackMonster(spec.monster);
        if (!gramielTauntRunning) {
            gramielTauntRunning = true;
            let chain = Promise.resolve();
            for (let i = 0; i < TAUNT_ATTEMPTS; i++) {
                chain = chain.then(async function (done) {
                    if (done || generation !== gramielRunGeneration || !checked || selected !== name) return true;
                    if (await selfStacks(spec.aura) > 0) return true;
                    const wait = await attempt('SkillAvailable', [spec.skill]);
                    const cooldown = wait.ok ? Number(wait.value) : 0;
                    if (cooldown > 0) await sleep(cooldown);
                    await attempt('ForceUseSkill', [spec.skill]);
                    await sleep(TAUNT_FORCE_GAP_MS);
                    await attempt('UseSkill', [spec.skill]);
                    await sleep(TAUNT_RECHECK_MS);
                    return false;
                });
            }
            const generation = gramielRunGeneration;
            chain.then(function () {
                if (generation === gramielRunGeneration) gramielTauntRunning = false;
            }, function (error) {
                if (generation === gramielRunGeneration) gramielTauntRunning = false;
                log('maid: ' + message(error));
            });
        }
        return { ok: true, attacked: spec.monster, taunting: true };
    }

    /**
     * Polling-loop effects whose state is not carried in a game frame are serviced from the
     * existing Maid scheduler. Packet-shaped actions remain in handleFrame above.
     */
    async function schedulerTick(context) {
        const name = checked ? selected : null;
        const spec = name && SPECS[name];
        if (!spec || (!spec.role && !spec.monId)) return null;
        if (scheduledName !== name) {
            scheduledName = name;
            speakerConstructed = false;
            speakerWasDead = false;
            gramielNextPoll = 0;
            gramielTauntRunning = false;
        }
        if (spec.role) return speakerSchedulerTick(name, spec, context || {});
        return gramielSchedulerTick(name, spec, context || {});
    }

    /**
     * The reference's taunt sequence, whose order is the reference's own and was read off it
     * rather than assumed (HandlerUltraGramielTaunt.cs:150-172,
     * HandlerAutoZoneAstralEmpyreanP1.cs:137-160): ATTACK FIRST, then, three times at most, stop
     * when the target carries Focus, wait out SkillAvailable('5'), ForceUseSkill('5'), wait 500 ms,
     * UseSkill('5'), wait 300 ms and re-check. The attack is not conditioned on Focus, and the
     * Focus read sits inside the loop rather than before it.
     *
     * All three iterations, which is the reference's own bound, and the loop breaks the moment the
     * target carries Focus - the cast that made it stick is what the retries are for.
     */
    function taunt(spec, monster) {
        return attackMonster(monster).then(function (attacked) {
            if (!attacked.ok) {
                return { ok: false, attempts: 0, refused: [attacked.helper], error: attacked.error };
            }
            const refused = [];
            let attempts = 0;
            let chain = Promise.resolve();
            for (let i = 0; i < TAUNT_ATTEMPTS; i++) {
                chain = chain.then(function (done) {
                    if (done === 'focus') return done;
                    return targetStacks('Focus').then(function (stacks) {
                        if (stacks > 0) return 'focus';
                        attempts++;
                        // `if (wait > 0)`: the reference sleeps only while skill 5 is on cooldown.
                        return attempt('SkillAvailable', [spec.skill]).then(function (wait) {
                            const cooldown = wait.ok ? Number(wait.value) : 0;
                            return cooldown > 0 ? sleep(cooldown) : Promise.resolve();
                        }).then(function () {
                            return attempt('ForceUseSkill', [spec.skill]);
                        }).then(function (forced) {
                            if (!forced.ok && refused.indexOf('ForceUseSkill') === -1) {
                                refused.push('ForceUseSkill');
                            }
                            return sleep(TAUNT_FORCE_GAP_MS);
                        }).then(function () {
                            return attempt('UseSkill', [spec.skill]);
                        }).then(function (used) {
                            if (!used.ok && refused.indexOf('UseSkill') === -1) {
                                refused.push('UseSkill');
                            }
                            // 'Short delay before re-checking Focus', the reference's own 300 ms.
                            return sleep(TAUNT_RECHECK_MS);
                        }).then(function () { return null; });
                    });
                });
            }
            return chain.then(function (done) {
                return { ok: refused.length === 0, attempts: attempts, refused: refused,
                    focused: done === 'focus' };
            });
        });
    }

    // ---------------------------------------------------------------- the walkers

    /** An event frame's zone letter, or null when the frame is not one. */
    function zoneOf(payload) {
        if (!payload || payload.cmd !== 'event') return null;
        const args = payload.args;
        if (!args || typeof args !== 'object') return null;
        if (args.zoneSet === undefined || args.zoneSet === null) return null;
        return String(args.zoneSet);
    }

    /** Does this character carry any of a list of auras? Player.GetAuras(true, ...) > 0. */
    function anyAura(names) {
        return names.reduce(function (chain, name) {
            return chain.then(function (found) {
                if (found) return true;
                return selfStacks(name).then(function (stacks) { return stacks > 0; });
            });
        }, Promise.resolve(false));
    }

    /**
     * One of the walker handlers: A and B name a side and anything else is the reference's own
     * default branch. Queen Iona adds its charge read, which picks between the two pads.
     */
    function onZone(name, zone) {
        const spec = SPECS[name];
        if (!spec) return Promise.resolve(null);
        const delay = spec.delayMs ? sleep(spec.delayMs) : Promise.resolve();
        return delay.then(function () {
            if (!spec.auras) return walkTo(spec.zones[zone] || spec.zones.other);
            const spot = spec.zones[zone] || spec.zones.other;
            if (Array.isArray(spot)) return walkTo(spot);
            return anyAura(spec.auras.positive).then(function (positive) {
                if (positive) return walkTo(spot.positive);
                return anyAura(spec.auras.negative).then(function (negative) {
                    if (negative) return walkTo(spot.negative);
                    // Neither charge: the reference's own if/else-if falls through and moves
                    // nobody, which is the one branch that is deliberately not a walk.
                    return { ok: true, moved: false };
                });
            });
        }).then(function (answer) {
            return Object.assign({ zone: name, letter: zone }, answer || {});
        });
    }

    // ---------------------------------------------------------------- the per-boss handlers

    /** The animation messages one ct frame carries, lowercased, with the monId off tInf. */
    function animationsOf(payload) {
        if (!payload || !Array.isArray(payload.anims)) return [];
        return payload.anims.filter(function (one) { return one && typeof one.msg === 'string'; })
            .map(function (one) {
                const tInf = one.tInf === undefined || one.tInf === null ? '' : String(one.tInf);
                const parts = tInf.split(':');
                return { msg: one.msg, lower: one.msg.toLowerCase(), monId: parts.length > 1 ? parts[1] : '' };
            });
    }

    /** The reference's own monId guard: a frame that carries no id still counts on either side. */
    function monIdMatches(monId, wanted) {
        return monId === '' || monId === '0' || String(monId) === String(wanted);
    }

    /** count % 2 != 0 for the odd presets, count % 2 == 0 (and above zero) for the even ones. */
    function parityHolds(parity, count) {
        return parity === 'odd' ? count % 2 !== 0 : count % 2 === 0 && count > 0;
    }

    /** One Gramiel preset's reaction to a defense shattering (HandlerUltraGramielTaunt.cs:54-210). */
    function onGramiel(name, anim) {
        const spec = SPECS[name];
        if (!contains(anim.lower, spec.phrase)) return Promise.resolve(null);
        if (!monIdMatches(anim.monId, spec.monId)) return Promise.resolve(null);
        crystalCount++;
        if (!parityHolds(spec.parity, crystalCount)) {
            return Promise.resolve({ ok: true, acted: false, refused: [], crystal: crystalCount });
        }
        return Promise.all([
            monsterThere(spec.orb),
            monsterThere(spec.monster),
            monsterThere(spec.grace)
        ]).then(function (there) {
            // The orb is this side's own crystal: taunt it while it stands, whatever else is on
            // the field.
            if (there[0]) return taunt(spec, spec.orb);
            // Gramiel, but only with no Grace Crystal up and no Vendetta on this character.
            if (there[1] && !there[2]) {
                return selfStacks(spec.aura).then(function (stacks) {
                    if (stacks > 0) return { ok: true, acted: false, refused: [] };
                    return taunt(spec, spec.monster);
                });
            }
            return { ok: true, acted: false, refused: [] };
        }).then(function (answer) {
            // A taunt answer carries no `acted` of its own: making the reference's own calls is
            // acting, whether or not the cast behind them landed.
            const acted = Object.prototype.hasOwnProperty.call(answer, 'acted')
                ? answer.acted
                : true;
            return Object.assign({ ok: answer.ok === true, acted: acted, refused: answer.refused || [] },
                { crystal: crystalCount });
        });
    }

    /** One Astral Empyrean preset (HandlerAutoZoneAstralEmpyreanP1.cs:81-160). */
    function onStarfire(name, anim) {
        const spec = SPECS[name];
        if (!contains(anim.lower, spec.phrase)) return Promise.resolve(null);
        // The counter is the reference's own static, shared by the two preset instances and
        // incremented once per starfire whoever is reading it.
        starfireCount++;
        if (!parityHolds(spec.parity, starfireCount)) {
            return Promise.resolve({ ok: true, acted: false, refused: [], starfire: starfireCount });
        }
        return monsterThere(spec.monster).then(function (there) {
            if (!there) return { ok: true, acted: false, refused: [] };
            return taunt(spec, spec.monster);
        }).then(function (answer) {
            const acted = Object.prototype.hasOwnProperty.call(answer, 'acted')
                ? answer.acted
                : true;
            return Object.assign({ ok: answer.ok === true, acted: acted, refused: answer.refused || [] },
                { starfire: starfireCount });
        });
    }

    /** The row a Speaker counter lands on, with the reference's own wrap at 15. */
    function speakerRow(counter) {
        if (counter >= SPEAKER_ROWS.length) return { row: SPEAKER_WRAP, counter: 1 };
        return { row: SPEAKER_ROWS[counter] || SPEAKER_ROWS[0], counter: counter };
    }

    /**
     * SetForceSkill('5', delay) (:305-360): wait out skill 5's cooldown, then spam UseSkill('5')
     * with the reference's own 30 ms between the pair until Focus lands or its 50 pairs are spent.
     * The reference gates each pass on IsLoggedIn and IsAlive and abandons the taunt when either
     * fails; the same two reads are asked for here, and a read the bridge cannot answer is not
     * fatal to the taunt - the pass is still sent, because the reference sends it.
     */
    function speakerTaunt(spec, refused) {
        let chain = Promise.resolve();
        for (let pass = 0; pass < SPEAKER_TAUNT_PAIRS; pass++) {
            chain = chain.then(function (done) {
                if (done === 'done') return done;
                return signedInAlive().then(function (ok) {
                    if (!ok) return 'done';
                    return attempt('UseSkill', [spec.skill]).then(function (used) {
                        if (!used.ok && refused.indexOf('UseSkill') === -1) refused.push('UseSkill');
                        return sleep(SPEAKER_TAUNT_GAP_MS);
                    }).then(function () {
                        return attempt('UseSkill', [spec.skill]);
                    }).then(function (used) {
                        if (!used.ok && refused.indexOf('UseSkill') === -1) refused.push('UseSkill');
                        return targetStacks('Focus');
                    }).then(function (stacks) { return stacks > 0 ? 'done' : null; });
                });
            });
        }
        return chain.then(function (done) { return { ok: true, focused: done === 'done' }; });
    }

    /** Player.IsLoggedIn && Player.IsAlive, the gate the Speaker's taunt loop opens with. */
    function signedInAlive() {
        return Promise.all([attempt('IsLoggedIn'), attempt('Health')]).then(function (both) {
            if (both[0].ok && !truthy(both[0])) return false;
            // Player.IsAlive is `Health > 0`. A health the bridge cannot read is not a death, so a
            // failed read leaves the taunt running rather than stopping it on a missing answer.
            if (!both[1].ok) return true;
            return Number(both[1].value) > 0;
        });
    }

    /** One Ultra Speaker role's reaction to a truth or listen frame. */
    function onSpeaker(name, anim) {
        const spec = SPECS[name];
        const hit = spec.phrases.filter(function (phrase) { return contains(anim.lower, phrase); })[0];
        if (!hit) return Promise.resolve(null);
        speakerCounter++;
        const stepped = speakerRow(speakerCounter);
        speakerCounter = stepped.counter;
        const row = stepped.row;
        const answer = { ok: true, row: row, moved: 0 };
        const refused = [];
        let chain = Promise.resolve();
        if (row.zone === spec.role) {
            inZone = row.type === 'IN';
            chain = chain.then(function () {
                return walkTo(inZone ? spec.zoneAt : spec.start).then(function () {
                    answer.moved++;
                });
            });
        }
        // AP's own skill-2 triple, which the reference fires on ANY "OUT" row rather than only its
        // own (:247-256 is outside the zone-role test): 300 ms, then skill 2 three times with the
        // reference's own 100 ms between them.
        if (row.type === 'OUT' && spec.role === 'AP') {
            chain = chain.then(function () { return sleep(300); });
            for (let i = 0; i < 3; i++) {
                chain = chain.then(function () { return attempt('UseSkill', ['2']); });
                chain = chain.then(function () { return sleep(100); });
            }
        }
        // TAUNT (skill 5): SetForceSkill('5', step.delay) (:266-270). The reference's own body
        // (:305-360) waits the row's delay, waits out SkillAvailable('5'), then spams UseSkill('5')
        // thirty milliseconds apart until Focus lands or 50 pairs are spent.
        if (row.taunt === spec.role) {
            chain = chain.then(function () {
                const waited = row.delay > 0 ? sleep(row.delay) : Promise.resolve();
                return waited.then(function () {
                    return targetStacks('Focus').then(function (stacks) {
                        if (stacks > 0) return { ok: true, already: true };
                        return attempt('SkillAvailable', [spec.skill]).then(function (wait) {
                            const cooldown = wait.ok ? Number(wait.value) : 0;
                            const paused = cooldown > 0 ? sleep(cooldown) : Promise.resolve();
                            return paused.then(function () {
                                return speakerTaunt(spec, refused);
                            });
                        });
                    });
                });
            });
        }
        // LR fires skill 1 twice on every truth or listen, whichever row the table is on.
        if (spec.role === 'LR') {
            chain = chain.then(function () { return speakerCast('1', refused); });
            chain = chain.then(function () { return speakerCast('1', refused); });
        }
        return chain.then(function () {
            answer.refused = refused;
            answer.ok = refused.length === 0;
            return answer;
        });
    }

    /** One UseSkill on the Speaker's own log path, so a refusal is named rather than swallowed. */
    function speakerCast(skill, refused) {
        return attempt('UseSkill', [skill]).then(function (used) {
            if (!used.ok && refused.indexOf('UseSkill') === -1) refused.push('UseSkill');
            return used;
        });
    }

    // ---------------------------------------------------------------- the Maid's own handlers

    /**
     * The Maid form's AnimsMsgHandler + ultraBossHandler (MaidRemake.cs:674-730 and :1196-1267):
     * the phrase list from SpecialMsg decides whether a frame is this character's business, the
     * mode's own counter decides whether this one is its turn, and a hit arms the forced skill
     * SpecialAct names.
     */
    function onMaidAnims(payload) {
        const mode = MODES[Number(configured('UltraBossExtra')) || 0] || MODES[0];
        const phrases = String(configured('SpecialMsg')).toLowerCase()
            .split(',').map(function (one) { return one.trim(); })
            .filter(function (one) { return one !== ''; });
        const anims = animationsOf(payload);
        return anims.reduce(function (chain, anim) {
            return chain.then(function (done) {
                if (done) return done;
                const hit = phrases.filter(function (phrase) {
                    return contains(anim.lower, phrase);
                })[0];
                if (!hit) return null;
                return maidBoss(mode, anim).then(function (act) {
                    if (!act || !act.arm) return null;
                    const slot = String(configured('SpecialAct'));
                    if (maid && typeof maid.armSkill === 'function') maid.armSkill(slot);
                    return { ok: true, mode: mode, phrase: hit, arm: slot };
                });
            });
        }, Promise.resolve(null));
    }

    /**
     * ultraBossHandler's own body: the three counters, the two crystal modes' attack, and the
     * parity answer that decides whether this frame is the one to act on.
     */
    function maidBoss(mode, anim) {
        const lower = anim.lower;
        let chain = Promise.resolve();
        // if (msg.Contains("shattering")): the four crystal modes attack their own crystal first.
        if (contains(lower, 'shattering')) {
            const wanted = mode === 'Gramiel L1' || mode === 'Gramiel L2' ? '2'
                : (mode === 'Gramiel R1' || mode === 'Gramiel R2' ? '3' : null);
            if (wanted !== null) {
                if (anim.monId !== wanted) return Promise.resolve({ arm: false });
                maidCrystalCount++;
                chain = chain.then(function () { return attackMonster('id.' + anim.monId); });
            }
        }
        if (contains(lower, 'sun converge')) sunCount++;
        if (contains(lower, 'moon converge')) moonCount++;
        if (contains(lower, 'behold our starfire')) maidStarfireCount++;
        return chain.then(function () {
            switch (mode) {
            case 'Asc.Solstice P1': return { arm: sunCount % 2 !== 0 || !contains(lower, 'sun converge') };
            case 'Asc.Solstice P2': return { arm: sunCount % 2 === 0 || !contains(lower, 'sun converge') };
            case 'Asc.Midnight P1': return { arm: moonCount % 2 !== 0 || !contains(lower, 'moon converge') };
            case 'Asc.Midnight P2': return { arm: moonCount % 2 === 0 || !contains(lower, 'moon converge') };
            case 'Ast.Empyrean P1':
                return { arm: maidStarfireCount % 2 !== 0 || !contains(lower, 'behold our starfire') };
            case 'Ast.Empyrean P2':
                return { arm: maidStarfireCount % 2 === 0 || !contains(lower, 'behold our starfire') };
            case 'Gramiel L1':
            case 'Gramiel R1':
                return { arm: maidCrystalCount % 2 !== 0 || !contains(lower, 'shattering') };
            case 'Gramiel L2':
            case 'Gramiel R2':
                return { arm: maidCrystalCount % 2 === 0 || !contains(lower, 'shattering') };
            // None and Auto Potion (and a file carrying a mode this build does not know) arm on
            // every phrase hit, which is the reference's own `bool act = true` default.
            default: return { arm: true };
            }
        });
    }

    /**
     * AntiCounterHandler (MaidRemake.cs:732-810): the counter-attack warning stops the attack for
     * six seconds, a Counter Attack aura ending or Sun's Heat on this character stops it too, and
     * Gramiel's drain holds the target on him for four seconds.
     */
    function onAntiCounter(payload) {
        animationsOf(payload).forEach(function (anim) {
            if (!contains(anim.lower, 'prepares a counter attack')) return;
            const started = sleep(1500).then(function () {
                countering = true;
                setStopAttack(true);
                return sleep(6000);
            }).then(function () {
                countering = false;
                setStopAttack(false);
            });
            started.catch(function (error) { log('maid: ' + message(error)); });
        });
        return selfStacks("Sun's Heat").then(function (heat) {
            if (heat > 0 || countering) setStopAttack(true);
            else if (currentMap === 'ascendedeclipse') setStopAttack(false);
            if (!Array.isArray(payload.a)) return null;
            const actions = payload.a;
            for (let i = 0; i < actions.length; i++) {
                const action = actions[i] || {};
                const aura = action.aura;
                if (aura && String(aura.nam) === 'Counter Attack' && action.cmd === 'aura--') {
                    countering = false;
                    setStopAttack(false);
                    break;
                }
                if (!Array.isArray(action.auras)) continue;
                const drain = action.auras.filter(function (one) {
                    return one && contains(String(one.msgOn), 'Gramiel attempts to drain');
                })[0];
                if (!drain) continue;
                locktarget = true;
                const held = attackMonster('Gramiel').then(function () {
                    return sleep(4000);
                }).then(function () { locktarget = false; });
                held.catch(function (error) { log('maid: ' + message(error)); });
                break;
            }
            return null;
        });
    }

    /**
     * The whitelist's own decision, which the reference writes TWICE and NOT identically. The two
     * bodies are kept apart here because the difference is behavioural, not cosmetic:
     *
     *   CellJumperHandler.cs:55-80  on a uotls frame: in the configured cell, pauseFollow AND
     *                               cbStopAttack.Checked = true; out of it, resumeFollow AND
     *                               cbStopAttack.Checked = false; a map with no entry resumes the
     *                               follow only (its stop-attack line is commented out upstream).
     *   JoinMapHandler.cs:22-42     on the server's own join: the pause half only - it never
     *                               touches stop attack in either branch, and a map with no entry
     *                               clears cbStopAttack.Checked before resuming the follow.
     *
     * `kind` picks the body: 'cell' for the cell jumper, 'join' for the join handler.
     */
    function whitelistFromCell(cell, kind) {
        const config = require('./config.js');
        const entries = config.parseMapList(configured('WhitelistMapMaps'), {});
        return attempt('Map').then(function (answer) {
            const map = answer.ok ? String(answer.value || '').toLowerCase() : '';
            const entry = config.findMap(entries, map);
            if (!entry) {
                if (kind === 'join') setStopAttack(false);
                setPaused(false);
                return { ok: true, entry: null };
            }
            const wanted = String(entry.cell).toLowerCase();
            if (wanted === String(cell).toLowerCase() || wanted === 'all') {
                setPaused(true);
                if (kind !== 'join') setStopAttack(true);
            } else {
                setPaused(false);
                if (kind !== 'join') setStopAttack(false);
            }
            return { ok: true, entry: entry };
        });
    }

    /** CellJumperHandler (:1-88): the target moved, so jump after them and re-read the whitelist. */
    function onUotls(args, base) {
        const movement = movementOf(args[base + 3]);
        const who = String(args[base + 2] === undefined ? '' : args[base + 2]).trim().toLowerCase();
            return resetSpecials().then(function () {
            return mapLoading();
        }).then(function (loading) {
            if (loading || who === '') return null;
            // The reference's own master: cmbGotoUsername's text, which is the config's Target and
            // the scheduler's own master. A target the Maid dialog has moved past the config's
            // stale copy is still the master this reacts to, so the live one is asked first.
            const live = maid && typeof maid.getTarget === 'function' ? maid.getTarget() : '';
            const target = String(live || configured('Target') || '').trim().toLowerCase();
            if (who !== target) return null;
            const state = maidState();
            const unfollowed = state.unfollow === true;
            let chain = Promise.resolve();
            let whitelist = null;
            if (!unfollowed && movement.cell !== null && movement.pad !== null) {
                chain = chain.then(function () { return attempt('Jump', [movement.cell, movement.pad]); });
            }
            if (configured('WhitelistMap') === true && movement.cell !== null) {
                chain = chain.then(function () {
                    return whitelistFromCell(movement.cell, 'cell').then(function (answer) {
                        whitelist = answer;
                        return answer;
                    });
                });
            }
            // CopyWalkHandler (:12-63): walk to the point the target walked to, while the box is
            // ticked and the follow is not paused - the reference unregisters it on pauseFollow.
            if (configured('CopyWalk') === true && state.paused !== true) {
                if (movement.x && movement.y) {
                    chain = chain.then(function () {
                        return walkTo([String(movement.x), String(movement.y)]);
                    });
                }
            }
            return chain.then(function () {
                return { ok: true, cell: movement.cell, entry: whitelist ? whitelist.entry : null };
            });
        });
    }

    /** JoinMapHandler: the server's own 'You joined ' on a server frame. */
    function onJoined(args) {
        if (!contains(args.join('%'), 'You joined ')) return Promise.resolve(null);
        if (configured('WhitelistMap') !== true) return Promise.resolve(null);
        return attempt('Cell').then(function (answer) {
            if (!answer.ok) return null;
            return whitelistFromCell(answer.value, 'join');
        });
    }

    /**
     * WarningMsgHandler (:29-61): a locked zone is answered either with the next alternative map
     * or with a private whitemap, and a full room or a missing player with the private map only,
     * after the reference's own short random delay.
     */
    function onWarning(args, base) {
        const said = String(args[base + 2] === undefined ? '' : args[base + 2]);
        const locked = contains(said, 'Cannot goto to player in a Locked zone.');
        const busy = contains(said, 'Room join failed, destination room is full.');
        // The third branch is built from the reference's own target box (`cmbGotoUsername`), so the
        // name it looks for is the master's: `Player 'master' could not be found.` The scheduler's
        // live target is that box - a target the Maid dialog has moved past the config's stale copy
        // is still the master this reacts to - with the config's own value as the fallback, exactly
        // as onUotls reads it.
        const live = maid && typeof maid.getTarget === 'function' ? maid.getTarget() : '';
        const target = String(live || configured('Target') || '').trim().toLowerCase();
        const missing = contains(said, "Player '" + target + "' could not be found.");
        if (!locked && !busy && !missing) return Promise.resolve(null);
        return attempt('IsLoggedIn').then(function (signedIn) {
            if (!truthy(signedIn)) return null;
            return attempt('Map');
        }).then(function (answer) {
            if (answer === null) return null;
            // The reference's own branch order (:35-58): the locked-zone box is asked FIRST, and
            // only its else-if chain carries the `Player.Map != "whitemap"` guard.
            if (locked && configured('LockedZoneHandler') === true) {
                return delayBeforeMap().then(function () { return joinAlternative(); });
            }
            // `Player.Map != "whitemap"`: the game reports strMapName, which carries no room, but a
            // caller may hand the room-qualified strAreaName, so the room is stripped first (the
            // way config.mapMatches strips it). The reference compares the plain name either way.
            const raw = answer && answer.ok ? String(answer.value || '').toLowerCase() : '';
            const here = raw.indexOf('-') === -1 ? raw : raw.split('-')[0];
            if (here === SAFE_MAP.name) return { ok: true, held: true };
            return delayBeforeMap().then(function () { return joinSafeMap(); });
        });
    }

    /** The reference's own random 750-1300 ms wait before it leaves for another map. */
    function delayBeforeMap() {
        const span = SAFE_MAP.maxMs - SAFE_MAP.minMs;
        return sleep(SAFE_MAP.minMs + Math.floor(random() * span)).then(function () { return true; });
    }

    /** AlternativeMap.GetNext: the next configured map, round-robin, never out of range. */
    function joinAlternative() {
        const entries = require('./config.js').parseMapList(configured('LockedZoneHandlerMaps'),
            { locked: true });
        if (!entries.length) {
            log('maid: the locked-zone handler is on and no alternative map is configured');
            return { ok: false, error: 'the locked-map list is empty' };
        }
        if (lockedIndex >= entries.length) lockedIndex = 0;
        const entry = entries[lockedIndex];
        lockedIndex++;
        return attempt('Join', [entry.map, entry.cell, entry.pad]);
    }

    /** A private whitemap, which the reference falls back to whenever a goto is refused. */
    function joinSafeMap() {
        const room = 9999 + Math.floor(random() * 90000);
        return attempt('Join', [SAFE_MAP.name + '-' + room, 'Enter', 'Spawn']);
    }

    /**
     * resetSpecials (MaidRemake.cs:1004-1019), which the reference calls when the Maid is enabled
     * and from every uotls frame: the counters belonging to one part of a run are cleared once the
     * character is no longer standing in that part.
     */
    function resetSpecials() {
        return Promise.all([attempt('Map'), attempt('Cell')]).then(function (both) {
            currentMap = both[0].ok ? String(both[0].value).toLowerCase() : '';
            const cell = both[1].ok ? String(both[1].value).toLowerCase() : '';
            if (currentMap === 'ascendeclipse' && cell !== 'r3') {
                sunCount = 0;
                moonCount = 0;
            }
            if (currentMap === 'astralshrine' && cell !== 'r2') starfireCount = 0;
            if (currentMap === 'ultragramiel' && cell !== 'r2') crystalCount = 0;
            return counters();
        });
    }

    /**
     * The reference's taunt() (MaidRemake.cs:409-462), which its loop calls whenever it has a
     * target: a tc; line starts a cycle that pauses the engine, attacks, waits for skill 5 and
     * fires it, then puts the previous target back.
     *
     * `key` is what the caller files the run under, so a second tc; line can stop the first: the
     * reference builds one cycle per Maid and keeps its own CancellationToken for it. A line this
     * build cannot parse is refused with the dialog's own words rather than started.
     */
    function tauntCycle(key) {
        const line = String(configured('SpecialMsg') === undefined ? '' : configured('SpecialMsg'));
        const parsed = parseTauntCycle(line);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        const slot = key === undefined ? 'special' : String(key);
        // The reference guards the whole start with `tauntTask == null && World.IsMonsterAvailable(mon)`
        // (MaidRemake.cs:432). The first half is the one that has to be here: the fighting pass
        // reaches this on every tick, so without it a tc; line stacks a second rotation on the
        // next one. The second half needs no guard, because the rotation's own while condition is
        // `World.IsMonsterAvailable(mon)` - a cycle started with the monster absent exits at the
        // top of its first pass without attacking anything, which is what the reference does too.
        if (cycles.has(slot)) {
            return { ok: false, error: 'a taunt cycle is already running under ' + slot };
        }
        return startCycle(slot, parsed.spec);
    }

    /**
     * cycleTaunt (MaidRemake.cs:644-671), which is a paced attack loop: while the monster is still
     * there, hand off every `second / cycle` seconds - on the pass where the count reaches zero,
     * attack the monster and reset the count; on every pass, step the count down. The reference
     * debug-logs each pass, so the run keeps its own `log` of the paces it took.
     *
     * BOUNDED, deliberately: the reference holds a loop open until its token is cancelled, and this
     * build has no window to cancel it from when the Maid's form is closed mid-run. Each pass
     * schedules the next and stops at TAUNT_CYCLE_MAX_PASSES, and the run also stops itself the
     * moment the monster is gone - which is the reference's own while condition.
     */
    function startCycle(key, spec) {
        const cycle = Number(spec.cycle) || 2;
        const second = Number(spec.second) || 12;
        const step = Math.max(0, Math.floor((second / cycle) * 1000));
        let count = spec.order === -1 ? 0 : spec.order;
        if (count > cycle) count %= cycle;
        const run = { key: key, spec: spec, passes: 0, stopped: false, log: [] };
        cycles.set(key, run);
        /** One pass of the reference's while body, then the next one `step` ms later. */
        function pass() {
            if (run.stopped || cycles.get(key) !== run) return;
            run.passes++;
            monsterThere(spec.mon).then(function (there) {
                if (!there) {
                    run.stopped = true;
                    run.log.push('monster no longer detected, stopping taunt cycle');
                    return;
                }
                if (count <= 0) {
                    count = cycle;
                    run.log.push('forcing to taunt');
                    return attackMonster(spec.mon).then(function (attacked) {
                        if (!attacked.ok) return null;
                        return attempt('SkillAvailable', ['5']).then(function (wait) {
                            const cooldown = wait.ok ? Number(wait.value) : 0;
                            return cooldown > 0 ? sleep(cooldown) : Promise.resolve();
                        }).then(function () { return attempt('UseSkill', ['5']); });
                    });
                }
                run.log.push('count = ' + count);
                return null;
            }).then(function () {
                count--;
                if (run.stopped || run.passes >= TAUNT_CYCLE_MAX_PASSES) return;
                // The reference's own `await Task.Delay(second / cycle * 1000)`; a zero-length step
                // would spin, so the next pass is deferred through the injected sleep either way.
                return sleep(step).then(pass);
            }).catch(function (error) {
                run.stopped = true;
                log('maid: the taunt cycle stopped: ' + message(error));
            });
        }
        pass();
        return { ok: true, running: true, spec: spec, step: step, key: key };
    }

    /** ResetToken(false): a run this key owns stops where it is. */
    function stopCycle(key) {
        const run = cycles.get(key);
        if (!run) return { ok: false, error: 'no taunt cycle is running under ' + key };
        run.stopped = true;
        cycles.delete(key);
        return { ok: true, stopped: true, passes: run.passes };
    }

    // ---------------------------------------------------------------- the dispatcher

    /** One frame off the platform's tap, handed to whichever handlers are registered. */
    function handleFrame(frame) {
        if (!frame || frame.direction !== 'toClient') return Promise.resolve(null);
        const body = text(frame.data);
        if (body === '') return Promise.resolve(null);
        // The aura cache is filled from the same frames, which is where the reference's own
        // AuraManager gets them (#42). The port's stores are per consumer, so this one is the
        // Maid's; the implementation is the same auras.js the statements read.
        store.observe(frame);

        // chkSpecial.Checked gates the registered handler, which is what UpdateSpecialHandler
        // leaves behind: `active` is the pair, read once per frame so a switch mid-run takes hold
        // on the next frame rather than half a pass later.
        const active = checked ? selected : null;

        // XT first: the Maid's own map handlers read three of its commands, and a frame that
        // starts with '%' is one whatever else it contains.
        const parsed = xtCommand(xtArguments(body));
        const command = parsed.command.toLowerCase();
        if (maidOn && command === 'uotls') return onUotls(xtArguments(body), parsed.base);
        if (maidOn && command === 'server') return onJoined(xtArguments(body), parsed.base);
        if (maidOn && command === 'warning') return onWarning(xtArguments(body), parsed.base);

        let payload = null;
        try {
            payload = auras.payloadOf(JSON.parse(body));
        } catch (error) {
            payload = null;
        }
        if (!payload) return Promise.resolve(null);

        const zone = zoneOf(payload);
        const spec = active === null ? null : SPECS[active];
        const trigger = String(payload.cmd === undefined || payload.cmd === null ? '' : payload.cmd).toLowerCase();
        if (zone !== null && spec && spec.triggers.indexOf('event') !== -1) return onZone(active, zone);

        const anims = animationsOf(payload);
        let chain = Promise.resolve(null);
        if (spec && anims.length && spec.triggers.indexOf(trigger) !== -1) {
            anims.forEach(function (anim) {
                chain = chain.then(function (done) {
                    if (done) return done;
                    if (spec.monId) return onGramiel(active, anim);
                    if (spec.role) return onSpeaker(active, anim);
                    if (spec.phrase) return onStarfire(active, anim);
                    return null;
                });
            });
        }
        if (!maidOn) return chain;
        // The Maid's own two subscriptions (Flash.FlashCall2, MaidRemake.cs:98-99 and :160-161) see
        // every frame from the server rather than only the animation ones, which is why the counter
        // handler asks for its payload's own shape instead of an anims list.
        const counter = configured('AntiCounter') === false
            ? Promise.resolve(null)
            : onAntiCounter(payload);
        return chain.then(function (done) {
            return counter.then(function () {
                if (done) return done;
                if (!specialAnimsOn || !anims.length) return null;
                return onMaidAnims(payload);
            });
        });
    }

    function counters() {
        return {
            sun: sunCount, moon: moonCount, starfire: starfireCount, crystal: crystalCount,
            maidStarfire: maidStarfireCount, maidCrystal: maidCrystalCount,
            speaker: speakerCounter, inZone: inZone
        };
    }

    function currentActive() {
        return checked ? selected : null;
    }

    /** A newly registered handler gets its own instance counters and scheduler state. */
    function resetActiveHandler(previous, next) {
        if (previous === next) return;
        speakerCounter = -1;
        inZone = false;
        crystalCount = 0;
        speakerConstructed = false;
        speakerWasDead = false;
        gramielNextPoll = 0;
        gramielTauntRunning = false;
        gramielRunGeneration++;
        scheduledName = next;
    }

    function setPaused(on) {
        if (maid && typeof maid.setPaused === 'function') maid.setPaused(on === true);
    }

    function setStopAttack(on) {
        if (maid && typeof maid.setStopAttack === 'function') maid.setStopAttack(on === true);
    }

    /**
     * The scheduler's own state, whichever way the caller exposes it: the plugin's scheduler is a
     * function (maid.js `state()`), while a caller that wires the handlers to an object of its own
     * hands that object. Reading it tolerantly keeps both callers on one code path.
     */
    function maidState() {
        if (!maid) return {};
        const value = typeof maid.state === 'function' ? maid.state() : maid.state;
        return value && typeof value === 'object' ? value : {};
    }

    return {
        handleFrame: handleFrame,

        /**
         * cmbSpecials' own selection (SelectedIndex), which is one half of the panel: the other is
         * the tick. It does not register anything by itself - the reference's UpdateSpecialHandler
         * needs both, and keeping them apart is what lets Switch keep the box as it was.
         */
        select: function (zone) {
            const previous = currentActive();
            const name = zone === null || zone === undefined || zone === '' ? null : String(zone);
            selected = name !== null && SPECS[name] ? name : null;
            if (name !== null && selected === null) {
                log('maid: the combo has no auto-zone handler named ' + name);
            }
            resetActiveHandler(previous, currentActive());
            onChange();
            return selected;
        },
        /** chkSpecial.Checked. Turning it on registers the selected handler; off unregisters it. */
        enable: function (on) {
            const previous = currentActive();
            checked = on === true;
            if (checked && selected === null) {
                // The reference's own guard: UpdateSpecialHandler returns without registering when
                // the combo has no selection, so an empty combo is not a handler.
                log('maid: the auto-zone box is ticked with no handler selected');
            }
            resetActiveHandler(previous, currentActive());
            onChange();
            return checked;
        },
        checked: function () { return checked; },
        selected: function () { return selected; },
        active: function () { return checked ? selected : null; },
        /** The two loop families serviced by the existing Maid scheduler. */
        schedulerActive: function () {
            const spec = SPECS[checked ? selected : null];
            return !!(spec && (spec.role || spec.monId));
        },
        schedulerTick: schedulerTick,

        /**
         * SetSpecialHandlerFromScript (BotManager.cs:3442-3467), which is what CmdSpecialHandler
         * drives: select the combo entry, set the tick only when the mode has an opinion, then run
         * UpdateSpecialHandler. `wanted` is true (Start), false (Stop) or null (Switch: the box is
         * left as it is). A name the combo does not carry switches nothing, which is the
         * reference's own FindStringExact returning -1.
         */
        set: function (zone, wanted) {
            const previous = currentActive();
            const name = zone === null || zone === undefined || zone === '' ? null : String(zone);
            // The reference only moves the selection when FindStringExact finds it; a name the combo
            // does not carry leaves both the selection and the tick exactly where they were, and the
            // handler that stays registered is the one that was already selected.
            if (name === null || SPECS[name]) selected = name;
            if (wanted === true || wanted === false) checked = wanted;
            resetActiveHandler(previous, currentActive());
            onChange();
            return this.active();
        },
        /** chkSpecial.Checked plus cmbSpecials.SelectedIndex, as one call (the tick's own change). */
        setActive: function (zone) {
            return this.set(zone, zone === null || zone === undefined || zone === '' ? false : true);
        },

        /** The Maid's own boxes: the per-boss mode and the handlers behind its config keys. */
        setMaid: function (on) {
            maidOn = on === true;
            if (!maidOn) stopCycle('special');
            return maidOn;
        },
        maid: function () { return maidOn; },
        setSpecialAnims: function (on) {
            specialAnimsOn = on === true;
            return specialAnimsOn;
        },
        counters: counters,
        resetSpecials: resetSpecials,
        /** The two run-lock flags doPriorityAttack steps aside on (MaidRemake.cs:838-840). */
        holding: function () { return countering || locktarget; },
        tauntCycle: tauntCycle,
        stopCycle: stopCycle,
        /**
         * TauntCycle.StartTaunt (TauntCycle.cs:22-30), which is what CmdTauntcycle drives: the
         * rotation is filed under one key because the reference holds exactly one per process
         * (`TauntCycle.Instance`), and a second start while one runs is the reference's own
         * `if (_runningTask != null && !_runningTask.IsCompleted) return;`. `order` is already
         * resolved by the caller (CmdTauntcycle.cs resolves `order - 1` before this).
         */
        startTaunt: function (cycle, mon, second, order) {
            return startCycle('bot', { cycle: number(cycle, 2), mon: String(mon === undefined ? '*' : mon),
                second: number(second, 14), order: number(order, -1) });
        },
        /** TauntCycle.Dispose: the one run stops where it is. */
        stopTaunt: function () { return stopCycle('bot'); },
        /** The counters, in one frame, and a fresh copy so a caller cannot move them. */
        state: function () {
            return {
                active: checked ? selected : null, selected: selected, checked: checked,
                maid: maidOn, counters: counters(), map: currentMap
            };
        },

        /** The combo entries this build can start, which is what the panel offers. */
        names: function () { return NAMES.slice(); }
    };
}

/**
 * Every loader name these handlers ask for. Asserted against the surface in the test, the way
 * bot/misc.js and the Maid's own HELPERS table are, so a name that is only spelled here cannot pass
 * as one that works.
 */
const LOADER_NAMES = {
    // Movement, which the surface implements.
    WalkToPoint: true, Jump: true, Join: true,
    // The two taunt families and the Maid's crystal modes. The three casts on this list are the
    // six #49 lifted: on the movie's side of the boundary they are the reference's own bodies with
    // a primitive for an argument, so a handler calls them the way the reference does.
    AttackMonster: true, AttackMonsterByMonMapId: true, UseSkill: true, ForceUseSkill: true,
    SkillAvailable: true,
    // The reads: monster availability, character state/position, party health, and map.
    // Health is the Speaker taunt's own IsAlive gate (Player.IsAlive is `Health > 0`).
    IsMonsterAvailable: true, IsLoggedIn: true, Health: true, Map: true, Cell: true, UserID: true,
    Position: true, HasTarget: true, PlayersInMap: true, GetPlayerHealthPercentage: true
};

module.exports = {
    MODES: MODES,
    MODE_FILLS: MODE_FILLS,
    DESIGNER: DESIGNER,
    NAMES: NAMES,
    HANDLED: HANDLED,
    HANDLED_BASES: HANDLED_BASES,
    SPECS: SPECS,
    SPEAKER_ROWS: SPEAKER_ROWS,
    SPEAKER_WRAP: SPEAKER_WRAP,
    SPEAKER: SPEAKER,
    SPEAKER_TAUNT_PAIRS: SPEAKER_TAUNT_PAIRS,
    TAUNT_ATTEMPTS: TAUNT_ATTEMPTS,
    SAFE_MAP: SAFE_MAP,
    LOADER_NAMES: LOADER_NAMES,
    parseTauntCycle: parseTauntCycle,
    movementOf: movementOf,
    createZoneHandlers: createZoneHandlers
};
