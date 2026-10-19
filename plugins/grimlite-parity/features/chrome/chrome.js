// The game window's chrome strip (ticket #45): the controls the reference draws above the Flash
// surface, in its own order and with its own words.
//
// Reference: Grimlite-Li 816d9cd, Grimoire/UI/Root.cs. The reference splits its client window into
// a 27 px strip (splitContainer1, Size 962x27) and the Flash panel below it, and puts six controls
// in the strip. Their own coordinates are the order a user reads:
//
//   chkStartBot   "Start Bot"      x=573
//   chkAutoAttack "Auto Attack"    x=644
//   cbPads                         x=729  (Items: Center, Spawn, Left, Right, Top, Bottom, Up, Down)
//   cbCells                        x=814  (filled from World.Cells, no text of its own)
//   btnGetCell    "x"              x=899  (refresh: refill the cells and re-issue the move)
//   btnBank       "Bank"           x=918  (Player.Bank.Show())
//
// The layout is the platform's: it sizes the window, draws the box and gives the surface the
// remainder (res/windows/game-chrome.js, res/swf_wrapper.html). This module is the game-specific
// half - the controls, their labels and what each one does - handed over through the Host.
//
// Every game call is a loader name the surface (#48) answers, asked for by that name: the same
// rule the rest of this plugin follows, so a name this build cannot answer refuses with its reason
// rather than with a bare "no member". The two casts (UseSkill, ForceUseSkill) went from refused
// to answered in ticket #49, which the strip needs no change for: it asks for the name either way.

const engine = require('../../bot/engine.js');
const skillPresets = require('./skill-presets.js');

/** splitContainer1's own height in Root.cs, which is the strip's height here. */
const HEIGHT = 27;

// cbPads.Items, in the reference's own order (Root.cs:698-706).
const PADS = ['Center', 'Spawn', 'Left', 'Right', 'Top', 'Bottom', 'Up', 'Down'];

// chkAutoAttack's own fallback rotation, when the class carries no skill preset (Root.cs:1601).
const DEFAULT_SKILLS = skillPresets.DEFAULT_SKILLS.map(function (skill) { return skill.index; });

// The three class combos chkAutoAttack runs before its rotation (SpecialClassCombo, Root.cs:1643).
// Each row is the reference's own class match and its own condition over the auras and the mana.
const CLASS_COMBOS = [
    {
        match: 'chrono shadow',
        // SpecialClassCombo's own three tests are not the same test: the first is a Contains
        // against the lower-cased class (Root.cs:1644), the other two are Equals (Root.cs:1653,
        // 1663). A class whose name merely starts with "Arcana Invoker" is not that class there.
        equals: false,
        when: function (auras, mana) { return auras('Rounds Empty') === 1 || mana < 15; },
        skills: ['4', '1']
    },
    {
        match: 'arcana invoker',
        equals: true,
        when: function (auras) {
            return auras('XX - Judgement') === 1 || auras('End of the world') >= 15 ||
                (auras('XXI - The World') === 0 && auras('0 - The Fool') === 0);
        },
        skills: ['1']
    },
    {
        match: 'archmage',
        equals: true,
        when: function (auras) {
            return (auras('Arcane Flux') === 1 && auras('Corporeal Ascension') === 0) ||
                auras('Arcane Sigil') === 0;
        },
        skills: ['4']
    }
];

// The auras the class combos above compare, so one pass of the loop reads each of them once.
const COMBO_AURAS = ['Rounds Empty', 'XX - Judgement', 'End of the world', 'XXI - The World',
    '0 - The Fool', 'Arcane Flux', 'Corporeal Ascension', 'Arcane Sigil'];

// chkAutoAttack's own interval (Task.Delay(150) at the top of its loop).
const TICK_MS = 150;

const ERRORS = {
    unknownControl: function (id) { return 'this strip has no control "' + id + '"'; },
    noEngine: 'no bot engine is wired in this build (#37), so the strip has nothing to start',
    noSession: 'this window has no game session to read the world through',
    mapLoading: 'the map is still loading, so the cell list cannot be read yet'
};

function message(error) {
    return (error && error.message) || String(error);
}

/**
 * @param {object} deps
 * @param {object} deps.runtime the engine registry (#37), keyed by game window
 * @param {Function} deps.windowKey the game window the strip is acting for
 * @param {Function} deps.bot the document the Bot Manager is editing, which Start Bot runs
 * @param {Function|object} deps.session the game session this window reads through (bot/session.js),
 *        or a getter for it: the strip asks each time, because a window's session is made with the
 *        bot registry's entry rather than at activation
 * @param {object|Function} [deps.messages] locale strings, or a getter read at draw time (the
 *        platform merges a plugin's catalog after activate(), so the getter is what a translated
 *        build needs)
 * @param {object} [deps.timers] setInterval/clearInterval, injected so tests need no wall clock
 */
function createChrome(deps) {
    deps = deps || {};
    // The labels are read when they are drawn, never captured: this plugin registers its catalog
    // during activate() and the platform merges it afterwards (main.js), so a strip built at
    // activation would hold the fallbacks forever in every language.
    function messages() {
        const told = typeof deps.messages === 'function' ? deps.messages() : deps.messages;
        return told || {};
    }
    const log = typeof deps.log === 'function' ? deps.log : function () {};
    const timers = deps.timers || {
        setInterval: function (fn, ms) { return setInterval(fn, ms); },
        clearInterval: function (id) { clearInterval(id); }
    };
    const sleep = deps.sleep || function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };

    let autoAttack = false;
    let autoAttackError = null;
    let autoStep = 0;
    let rotation = skillPresets.defaultSkills();
    let timer = null;
    // The list cbCells is filled from, kept between reads so the page can still offer it while the
    // character is between cells; the reference keeps its own in the combo box itself.
    let cells = [];

    function session() {
        try {
            return (typeof deps.session === 'function' ? deps.session() : deps.session) || null;
        } catch (error) {
            return null;
        }
    }

    function windowKey() {
        try {
            return (typeof deps.windowKey === 'function' ? deps.windowKey() : deps.windowKey) || 'game';
        } catch (error) {
            return 'game';
        }
    }

    /** One read of the game through the session, with a refusal handed back rather than thrown. */
    function read(name, args) {
        const game = session();
        if (!game || typeof game[name] !== 'function') {
            return Promise.resolve({ value: null, error: ERRORS.noSession });
        }
        let called;
        try {
            called = Array.isArray(args) ? game[name].apply(game, args) : game[name]();
        } catch (error) {
            return Promise.resolve({ value: null, error: message(error) });
        }
        return Promise.resolve(called).then(function (value) {
            return { value: value, error: null };
        }, function (error) {
            return { value: null, error: message(error) };
        });
    }

    /** Whether a character is signed in, in the engine's own words when it is not. */
    function signedIn() {
        return read('signedIn').then(function (answer) {
            if (answer.error) return { ok: null, error: answer.error };
            return { ok: answer.value === true, error: engine.ERRORS.notSignedIn };
        });
    }

    function controls() {
        const words = messages();
        return [
            { id: 'startBot', kind: 'check', label: words.startBot || 'Start Bot' },
            { id: 'autoAttack', kind: 'check', label: words.autoAttack || 'Auto Attack' },
            { id: 'pad', kind: 'select', label: words.pad || '' },
            { id: 'cell', kind: 'select', label: words.cell || '' },
            { id: 'refreshCell', kind: 'button', label: words.refreshCell || 'x' },
            { id: 'bank', kind: 'button', label: words.bank || 'Bank' }
        ];
    }

    /** Whether this window's bot is running, which is what the Start Bot tick shows. */
    function botState() {
        const runtime = deps.runtime;
        if (!runtime || typeof runtime.state !== 'function') return false;
        return !!runtime.state(windowKey()).running;
    }

    function cellText(value) {
        return value === null || value === undefined ? '' : String(value);
    }

    /**
     * Everything the strip draws. Both boxes are empty when the game cannot be read: that is how
     * the reference shows nobody is in the world, and the reason travels beside them rather than
     * being swallowed.
     */
    async function state() {
        const alive = await signedIn();
        const values = {
            startBot: botState(),
            autoAttack: autoAttack,
            autoAttackError: autoAttackError,
            cell: '',
            pad: ''
        };
        const options = { cell: cells.slice(), pad: PADS };
        if (alive.ok !== true) {
            return { values: values, options: options, error: alive.error || null };
        }
        // The cell box fills the way cbCells_Click fills it: from the game's own cell list, on
        // this redraw and on the refresh button (Root.cs:392, Root.cs:1715). A list the game will
        // not answer leaves the last one in the box and is reported by the control the user
        // pressed (the refresh below), not by every redraw - which is what its own silent early
        // return while nobody is logged in amounts to.
        const here = await Promise.all([read('cell'), read('pad'), readCells()]);
        values.cell = cellText(here[0].value);
        values.pad = cellText(here[1].value);
        return {
            values: values,
            options: { cell: cells.slice(), pad: PADS },
            error: here[0].error || here[1].error || null
        };
    }

    /**
     * Start Bot and Auto Attack are the reference's two checkboxes: ticking Start Bot starts this
     * window's bot on the document the Bot Manager holds, and unticking it stops it. The three
     * refusals are the engine's own (#37) - this hands the press over and reports what it said.
     */
    async function startBot(checked) {
        const runtime = deps.runtime;
        if (!runtime) return { ok: false, error: ERRORS.noEngine };
        if (checked !== true) {
            return Promise.resolve(runtime.stop(windowKey())).then(function () {
                return { ok: true, error: null };
            }, function (error) {
                return { ok: false, error: message(error) };
            });
        }
        return Promise.resolve(runtime.start(windowKey(), deps.bot())).then(function (answer) {
            return { ok: !!(answer && answer.ok), error: (answer && answer.error) || null };
        }, function (error) {
            return { ok: false, error: message(error) };
        });
    }

    // ------------------------------------------------------------------- Auto Attack

    /** Player.GetAuras(true, name) for the class combos; an unreadable aura counts as none. */
    async function aura(name) {
        const answer = await read('selfAura', [name]);
        const value = Number(answer.value);
        return isFinite(value) ? value : 0;
    }

    /** SpecialClassCombo: this class's own skills when its own condition holds, else none. */
    async function classCombo() {
        const answer = await read('className');
        const name = String(answer.value || '').toLowerCase();
        const found = CLASS_COMBOS.filter(function (combo) {
            return combo.equals ? name === combo.match : name.indexOf(combo.match) !== -1;
        })[0];
        if (!found) return null;
        const read_ = {};
        const auras = COMBO_AURAS.map(function (one) { return aura(one); });
        const values = await Promise.all(auras);
        COMBO_AURAS.forEach(function (one, i) { read_[one] = values[i]; });
        const manaAnswer = await read('mana');
        const mana = Number(manaAnswer.value);
        return found.when(function (one) { return read_[one] || 0; }, isFinite(mana) ? mana : 0)
            ? found.skills
            : null;
    }

    /**
     * The reference's own per-skill cast: wait out the skill's cooldown, then use it. A cast the
     * game refuses is reported, and one refused cast does not end the rotation - the reference's
     * loop keeps going whatever a cast does.
     */
    async function cast(index, waitForCooldown) {
        if (waitForCooldown === true) {
            const wait = await read('skillAvailable', [index]);
            const ms = Number(wait.value);
            if (isFinite(ms) && ms > 0) await sleep(ms);
        }
        // Skill.useSkill: a Chrono Shadow casts forced, everyone else plain (Skill.cs:106-115).
        // The engine's CmdUseSkill makes the same choice for the same reason (#38), so a rotation
        // and a bot command cast through one name rather than two.
        const name = await read('className');
        const forced = String(name.value || '').toLowerCase().indexOf('chrono shadow') !== -1;
        const used = forced
            ? await read('forceUseSkill', [index])
            : await read('useSkill', [index]);
        if (used.error) {
            autoAttackError = 'skill ' + index + ': ' + used.error;
            log(autoAttackError);
        } else {
            autoAttackError = null;
        }
    }

    /** Skill.ExecuteSkill's Safe branch: the condition decides whether this slot casts at all. */
    async function safeAllows(skill) {
        const currentName = skill.isMp ? 'mana' : 'health';
        const maxName = skill.isMp ? 'manaMax' : 'healthMax';
        const answers = await Promise.all([read(currentName), read(maxName)]);
        const now = Number(answers[0].value);
        const max = Number(answers[1].value);
        if (answers[0].error || answers[1].error || !isFinite(now) || !isFinite(max) || max <= 0) {
            autoAttackError = 'skill ' + skill.index + ': ' +
                (answers[0].error || answers[1].error || 'the game reports no health or mana percentage');
            log(autoAttackError);
            return false;
        }
        const percent = now / max * 100;
        if (skill.op === '>' || skill.op === '>=') return percent >= skill.value;
        if (skill.op === '<' || skill.op === '<=') return percent <= skill.value;
        return percent === skill.value;
    }

    /** The class's own SS.CLASS preset, reloaded when Auto Attack starts. */
    async function rotationForClass() {
        if (!deps.presets || typeof deps.presets.forClass !== 'function') return [];
        if (typeof deps.presets.reload === 'function') deps.presets.reload();
        const answer = await read('className');
        if (answer.error) return [];
        return deps.presets.forClass(answer.value) || [];
    }

    /**
     * One pass of chkAutoAttack's own loop: attack when nothing is targeted, run the class combo,
     * then one step of the rotation. Driven by the interval below, and directly by the tests.
     */
    async function tick() {
        if (!autoAttack) return;
        const alive = await signedIn();
        if (alive.ok !== true) {
            // The reference's loop condition: not signed in ends it, and the box goes back off.
            autoAttack = false;
            stopTimer();
            return;
        }
        const target = await read('hasTarget');
        if (target.value !== true) {
            const attack = await read('attackMonster', ['*']);
            if (attack.error) {
                autoAttackError = attack.error;
                log(autoAttackError);
            }
            const again = await read('hasTarget');
            if (again.value !== true) return;
        }
        const combo = await classCombo();
        if (combo) {
            for (let i = 0; i < combo.length; i++) await cast(combo[i], true);
            await sleep(200);
        }
        const skill = rotation[autoStep];
        autoStep = (autoStep + 1) % Math.max(1, rotation.length);
        if (!skill) return;
        if (skill.safe === true && !(await safeAllows(skill))) return;
        await cast(skill.index, skill.wait === true);
    }

    function startTimer() {
        if (timer) return;
        timer = timers.setInterval(function () {
            Promise.resolve(tick()).catch(function (error) {
                log('auto attack stopped: ' + message(error));
            });
        }, TICK_MS);
    }

    function stopTimer() {
        if (!timer) return;
        timers.clearInterval(timer);
        timer = null;
    }

    async function autoAttackToggle(checked) {
        if (checked !== true) {
            autoAttack = false;
            stopTimer();
            return { ok: true, error: null };
        }
        // chkAutoAttack_CheckedChanged's own two refusals: the bot is running, or nobody is signed
        // in. Both come from the engine's vocabulary so the strip and the editor say one thing.
        if (botState()) return { ok: false, error: engine.ERRORS.alreadyRunning };
        const alive = await signedIn();
        if (alive.ok !== true) return { ok: false, error: alive.error || engine.ERRORS.notSignedIn };
        const preset = await rotationForClass();
        rotation = preset.length ? preset : skillPresets.defaultSkills();
        autoAttack = true;
        autoAttackError = null;
        autoStep = 0;
        startTimer();
        return { ok: true, error: null };
    }

    /** The hotkey action: tick or untick the same box the strip draws. */
    async function toggleAutoAttack() {
        return action('autoAttack', { checked: !autoAttack });
    }

    // -------------------------------------------------------- the cell and pad pickers

    /** Fill the cell box the way its own Click handler does, from the loader's GetCells. */
    function readCells() {
        return read('cells').then(function (answer) {
            if (answer.error) return answer;
            const list = Array.isArray(answer.value) ? answer.value : [];
            cells = list.map(function (one) { return String(one); })
                .filter(function (one) { return !!one; });
            return { value: cells, error: null };
        });
    }

    /**
     * btnGetCell_Click: refill the cell list, set both boxes to where the character stands, and
     * re-issue the move - which is how the reference nudges a character that came out of a cell.
     */
    async function refreshCell() {
        const alive = await signedIn();
        if (alive.ok !== true) return { ok: false, error: alive.error || engine.ERRORS.notSignedIn };
        const ready = await read('ready');
        if (ready.value === false) return { ok: false, error: ERRORS.mapLoading };
        const filled = await readCells();
        if (filled.error) return { ok: false, error: filled.error };
        const here = await Promise.all([read('cell'), read('pad')]);
        const cell = cellText(here[0].value);
        if (!cell) return { ok: false, error: here[0].error || 'the game reports no cell to stand in' };
        const moved = await read('jump', [cell, cellText(here[1].value) || 'Spawn']);
        return { ok: !moved.error, error: moved.error };
    }

    /**
     * cbCells_SelectedIndexChanged and cbPads_SelectedIndexChanged: move to the picked cell with
     * the picked pad, or to the picked pad in the cell the character is already standing in.
     */
    async function moveTo(pick) {
        const alive = await signedIn();
        if (alive.ok !== true) return { ok: false, error: alive.error || engine.ERRORS.notSignedIn };
        const here = await Promise.all([read('cell'), read('pad')]);
        const cell = pick.cell ? String(pick.cell) : cellText(here[0].value);
        const pad = pick.pad ? String(pick.pad) : (cellText(here[1].value) || 'Spawn');
        if (!cell) return { ok: false, error: here[0].error || 'the game reports no cell to move to' };
        const moved = await read('jump', [cell, pad]);
        return { ok: !moved.error, error: moved.error };
    }

    /** One control pressed. Answers {ok, error, view}; the page redraws from the view. */
    async function action(id, args) {
        const picked = args || {};
        let answer;
        try {
            if (id === 'startBot') answer = await startBot(picked.checked);
            else if (id === 'autoAttack') answer = await autoAttackToggle(picked.checked);
            else if (id === 'cell') answer = await moveTo({ cell: picked.value });
            else if (id === 'pad') answer = await moveTo({ pad: picked.value });
            else if (id === 'refreshCell') answer = await refreshCell();
            else if (id === 'bank') {
                const shown = await read('showBank');
                answer = { ok: !shown.error, error: shown.error };
            } else return { ok: false, error: ERRORS.unknownControl(id), view: await state() };
        } catch (error) {
            answer = { ok: false, error: message(error) };
        }
        return Object.assign({}, answer, { view: await state() });
    }

    return {
        controls: controls,
        state: state,
        action: action,
        /** One pass of the Auto Attack loop, the seam the tests drive. */
        tick: tick,
        /** Give the loop back: a plugin that stops must not leave a timer ticking. */
        stop: function () { autoAttack = false; stopTimer(); },
        autoAttack: function () { return autoAttack; },
        toggleAutoAttack: toggleAutoAttack,
        /** One Auto Attack rotation, for the tests and for a window that wants to show it. */
        rotation: function () { return rotation.map(function (skill) { return Object.assign({}, skill); }); },
        /** @internal test seam */
        _cells: function () { return cells.slice(); }
    };
}

/**
 * The strip as the plugin uses it: the engine registry (#37), the document the Bot Manager holds
 * (#36), and this window's own session - the same one its bot runs against, so the strip and the
 * bot never disagree about which game they are looking at.
 *
 * @param {object} host the plugin Host
 * @param {object} deps {runtime, windowKey, bot, messages, session, log}
 */
function createFromHost(host, deps) {
    deps = deps || {};
    const runtime = deps.runtime;
    const windowKey = deps.windowKey || function () { return 'game'; };
    return createChrome({
        runtime: runtime,
        windowKey: windowKey,
        bot: deps.bot || function () { return {}; },
        session: deps.session || function () {
            // The window's own bot entry owns the session (bot/runtime.js), and asking for a
            // window a bot has not run in yet makes that entry: the strip and a later bot then
            // read the same game through one session rather than two. A second session here would
            // subscribe to the packet tap a second time and hold an aura cache of its own, which
            // is the drift the whole per-window registry exists to prevent.
            if (!runtime || typeof runtime.forWindow !== 'function') return null;
            const entry = runtime.forWindow(windowKey());
            return entry && entry.engine ? entry.engine.session : null;
        },
        messages: deps.messages || {},
        log: deps.log || function (line) { host.log('chrome: ' + line); },
        presets: deps.presets,
        sleep: deps.sleep,
        timers: deps.timers
    });
}

module.exports = {
    createChrome: createChrome,
    createFromHost: createFromHost,
    HEIGHT: HEIGHT,
    PADS: PADS,
    DEFAULT_SKILLS: DEFAULT_SKILLS,
    COMBO_AURAS: COMBO_AURAS,
    TICK_MS: TICK_MS,
    ERRORS: ERRORS,
    skillPresets: skillPresets
};
