// The bot engine runtime and lifecycle (#37): a port of the reference client's own loop -
// Grimoire/Botting/Bot.cs (Activate, Start, Stop, the Index property, ResolveVars),
// BotUtilities.cs (WaitUntil, RequiresDelay) and the flow commands under
// Grimoire/Botting/Commands/Misc/**.
//
// Three facts decide the shape:
//
// 1. Upstream the engine is a singleton whose variable and integer dictionaries are *static*
//    (Configuration.Tempvalues/Tempvariable) because the client is single-client by
//    construction. Spec #19 makes this app's rule one independent bot per game window, so every
//    piece of that state is per-engine here and nothing in this module is shared between
//    instances.
// 2. Every game read goes through an injected session (spec #19, Seam 4), so the loop is
//    testable without Flash. The names the reference uses for this are its own loader's, not the
//    stock game's (IsLoggedIn, State, MapLoadComplete, SetSpawnPoint, ReloadMap - see #29's
//    table in docs/FLASH_CHECKLIST.md), so none of them appears in this file: the session reports
//    what it could establish, and a signal it cannot establish is a reason, never a default.
// 3. The list is walked by index and the index is a *setter* upstream: a value at or past the end
//    wraps to 0. That is what makes CmdRestart work (it sets -1 and the loop's increment makes
//    that 0), so it is reproduced here rather than cleaned up.

const bots = require('./bots.js');
const catalog = require('./command-catalog.js');
// The state-reading statements (#41) live in their own module: #42 adds its own table beside it,
// and a union of two tables is a one-line change where one long inline object is not.
const statements = require('./statements.js');

/** The reference's own pacing constants: WaitUntil's default interval and the pause poll. */
const DEFAULT_INTERVAL_MS = 1000;
const PAUSE_POLL_MS = 100;
const PAUSE_NEEDED = 'the game is not ready yet (loading a map, or no character in the world)';

const ERRORS = {
    empty: 'this bot has no commands: add some before starting it',
    notSignedIn: 'no character is signed in: sign in before starting a bot',
    alreadyRunning: 'a bot is already running in this window',
    noSession: 'this window has no game session to run a bot against',
    stopped: 'the bot is not running'
};

/** Configuration keys whose value the engine writes back to the document it was started with. */
function setConfig(document, config, key, value) {
    config[key] = value;
    if (document && typeof document === 'object') document[key] = value;
}

// RequiresDelay (BotUtilities.cs): the classes the reference does *not* pause BotDelay after.
// CmdBlank2 is deliberately absent - upstream lists CmdBlank and CmdBlank3 only.
const NO_DELAY = {
    CmdIndex: true,
    CmdLabel: true,
    CmdGotoLabel: true,
    CmdBlank: true,
    CmdBlank3: true,
    CmdSkillSet: true
};

function requiresDelay(command) {
    const className = catalog.classNameOf(command);
    if (NO_DELAY[className]) return false;
    // A statement is not paced either; they are the Misc.Statements namespace.
    const type = (command && command.$type) || '';
    return type.indexOf('Misc.Statements.') === -1;
}

function message(error) {
    return (error && error.message) || String(error);
}

/**
 * The arithmetic half of ResolveVars: the reference hands the string to DataTable.Compute, whose
 * contract is what matters here - two integer operands divide as integers, otherwise the result
 * is a double. Anything that is not that grammar is handed back untouched.
 */
const ARITHMETIC = /^[0-9+\-*/%.()\s]+$/;

function evaluate(input) {
    if (!ARITHMETIC.test(input) || !/[0-9]/.test(input)) return null;
    const tokens = input.match(/\d+(?:\.\d+)?|[-+*/%()]/g);
    if (!tokens || tokens.join('') !== input.replace(/\s+/g, '')) return null;
    let at = 0;

    function peek() { return tokens[at]; }
    function take() { return tokens[at++]; }
    function number() {
        const token = take();
        if (token === undefined) throw new Error('operand expected');
        if (token === '(') {
            const value = sum();
            if (take() !== ')') throw new Error('unbalanced parentheses');
            return value;
        }
        if (token === '-') return negate(number());
        if (!/^\d/.test(token)) throw new Error('operand expected');
        return { value: Number(token), integer: token.indexOf('.') === -1 };
    }
    function negate(value) {
        return { value: -value.value, integer: value.integer };
    }
    function combine(left, operator, right) {
        const both = left.integer && right.integer;
        let value;
        if (operator === '+') value = left.value + right.value;
        else if (operator === '-') value = left.value - right.value;
        else if (operator === '*') value = left.value * right.value;
        else if (operator === '%') value = left.value % right.value;
        // Integer division truncates toward zero, as C# does; floats divide as floats.
        else value = both ? Math.trunc(left.value / right.value) : left.value / right.value;
        return { value: value, integer: both };
    }
    function product() {
        let left = number();
        while (peek() === '*' || peek() === '/' || peek() === '%') {
            left = combine(left, take(), number());
        }
        return left;
    }
    function sum() {
        let left = product();
        while (peek() === '+' || peek() === '-') {
            left = combine(left, take(), product());
        }
        return left;
    }
    try {
        const result = sum();
        if (at !== tokens.length) return null;
        return String(result.value);
    } catch (error) {
        return null;
    }
}

/**
 * The bot engine.
 *
 * @param {object} deps
 * @param {object} deps.session      the injected game session (spec Seam 4); see session.js
 * @param {(config: object) => Promise<any>} [deps.relogin]  the reference's AutoRelogin.Login
 * @param {(options: object) => Promise<any>} [deps.options] the reference's OptionsManager
 * @param {(ms: number) => Promise<void>} [deps.sleep]       pacing, injected so tests do not wait
 * @param {(line: string) => void} [deps.log]
 */
function createEngine(deps) {
    deps = deps || {};
    const session = deps.session;
    const sleep = deps.sleep || function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };
    const log = deps.log || function () {};

    let running = false;
    let paused = false;
    let index = 0;
    let document = null;      // the parsed .gbot, mutated the way the editor mutates it
    let config = null;        // the Configuration view: the document plus the C# defaults
    const vars = {};          // Configuration.Tempvariable, per engine
    const ints = {};          // Configuration.Tempvalues, per engine
    let username = '';
    let lastCommand = null;
    let dispatched = [];       // what the loop actually ran, for the window and for tests

    function commands() {
        const list = config && config.Commands;
        return Array.isArray(list) ? list : [];
    }

    /**
     * The reference's Index property: a value at or past the end wraps to 0. Read through this
     * too, because CmdIndex Up can push the index negative and upstream that is an index outside
     * the list - here it wraps to the start and says so, rather than throwing mid-run.
     */
    function indexOf(value) {
        return value < commands().length ? value : 0;
    }

    function readIndex() {
        const count = commands().length;
        if (index < 0 || index >= count) {
            if (count) log('the index (' + index + ') is outside the list; starting from the top');
            return 0;
        }
        return index;
    }

    function setIndex(value) {
        index = indexOf(value);
        return index;
    }

    // ---------------------------------------------------------------- variables and ints

    /** Bot.IsVar: the reference's own test for "this is a variable reference". */
    function isVar(value) {
        return /\[[^\]]*\]/.test(String(value));
    }

    /** Bot.GetVar: the key inside the brackets, with quotes stripped. */
    function getVar(value) {
        return String(value).replace(/[\[\]']+/g, '');
    }

    /**
     * Bot.ResolveVars: substitute {PLAYERNAME}, then walk [key] references up to five depths,
     * then evaluate the result if it is arithmetic. A key that is not defined is left as written
     * and reported, which is what the reference does (AppendDebug "Key for [x] not found").
     */
    function resolve(value) {
        let result = String(value === undefined || value === null ? '' : value)
            .replace('{PLAYERNAME}', username);
        for (let depth = 0; depth < 5; depth++) {
            const previous = result;
            result = result.replace(/\[(.*?)\]/g, function (match, key) {
                if (Object.prototype.hasOwnProperty.call(vars, key)) return String(vars[key]);
                if (Object.prototype.hasOwnProperty.call(ints, key)) return String(ints[key]);
                log('[Var Error] Key for ' + match + ' not found/Undefined');
                return match;
            });
            if (previous === result) break;
        }
        const evaluated = evaluate(result);
        return evaluated === null ? result : evaluated;
    }

    // ---------------------------------------------------------------- the session reads

    /**
     * A read that cannot be established is a reason, not a value. An argument-carrying read (the
     * statements of #41 ask the loader about a name, a cell or a quest id) is passed through as
     * the session member's own arguments.
     */
    function read(name, args) {
        if (!session || typeof session[name] !== 'function') {
            return Promise.resolve({ ok: false, error: ERRORS.noSession });
        }
        return Promise.resolve().then(function () {
            return session[name].apply(session, Array.isArray(args) ? args : []);
        })
            .then(function (value) { return { ok: true, value: value }; },
                function (error) {
                    // The session marks a refusal that means the window is gone, so the loop can
                    // tell it from a map still loading without reading its message.
                    return {
                        ok: false,
                        error: message(error),
                        windowGone: !!(error && error.windowGone === true)
                    };
                });
    }

    /**
     * BotUtilities.WaitUntil: poll until the condition holds, while the prerequisite holds, for
     * at most `timeout` iterations of `interval` milliseconds (a timeout of -1 never gives up).
     * The reference's default prerequisite is "running, signed in and alive".
     */
    async function waitUntil(condition, options) {
        const opts = options || {};
        const interval = opts.interval === undefined ? DEFAULT_INTERVAL_MS : opts.interval;
        const timeout = opts.timeout === undefined ? 15 : opts.timeout;
        const prerequisite = opts.prerequisite || async function () {
            if (!running) return false;
            const signed = await read('signedIn');
            const alive = await read('alive');
            return signed.ok && signed.value === true && alive.ok && alive.value === true;
        };
        let iterations = 0;
        while ((await prerequisite()) && !(await condition()) && (iterations < timeout || timeout === -1)) {
            await sleep(interval);
            iterations++;
        }
    }

    // ---------------------------------------------------------------- the command handlers

    /** What a handler is given. One object keeps the vocabulary readable. */
    function context() {
        return {
            session: session,
            sleep: sleep,
            log: log,
            resolve: resolve,
            // Bot.IsVar / Bot.GetVar, which the statement classes call directly: an operand in
            // [brackets] is a variable reference, anything else is a literal, and that rule is
            // the reference's own test rather than ResolveVars' substitution.
            isVar: isVar,
            getVar: getVar,
            vars: vars,
            ints: ints,
            read: read,
            waitUntil: waitUntil,
            index: readIndex,
            setIndex: setIndex,
            /** A statement that does not hold skips the one command under it (Index++). */
            skipNext: function () { return setIndex(index + 1); },
            config: function () { return config; },
            setConfig: function (key, value) { setConfig(document, config, key, value); },
            stop: stop,
            running: function () { return running; }
        };
    }

    /** One integer out of a value that may be a literal, a variable or an int reference. */
    function intOperand(value) {
        const raw = isVar(value) ? (vars[getVar(value)] !== undefined ? vars[getVar(value)] : value) : value;
        const parsed = parseInt(String(raw), 10);
        return isNaN(parsed) ? null : parsed;
    }

    // ---------------------------------------------------------------- combat and map (#38)

    // CmdSkillSet.cs writes BotData.BotSkill, and CmdAttack/CmdKill read it back to find the label
    // their rotation starts from. Upstream that is a static field, which is fine for a client that
    // is single-client by construction; spec #19's rule is one bot per window, so it is per engine.
    let botSkill = '';
    // The reference's skill cursors: CmdKill's is static and deliberately survives a restart,
    // CmdAttack's is per-instance.
    const skill = { kill: 0, lastBotSkill: '', attack: 0 };
    // CmdMoveToCell2 starts a background jump and its stop flag cancels it. Upstream that is a
    // static CancellationTokenSource; here it belongs to this engine and stop() cancels it too.
    const jump = { token: null };
    const reported = {};

    /** One line per thing this build cannot do, so a long run does not repeat itself. */
    function reportOnce(key, line) {
        if (reported[key]) return;
        reported[key] = true;
        log(line);
    }

    /** The reference's IsVar/GetVar pair, for a command's own fields. */
    function varOf(value) {
        if (!isVar(value)) return value === undefined || value === null ? '' : String(value);
        const key = getVar(value);
        return vars[key] === undefined ? value : vars[key];
    }

    /** A session read that takes an argument, reported the way the no-argument reads are. */
    function read1(name, arg) {
        if (!session || typeof session[name] !== 'function') {
            return Promise.resolve({ ok: false, error: ERRORS.noSession });
        }
        return Promise.resolve().then(function () { return session[name](arg); })
            .then(function (value) { return { ok: true, value: value }; }, function (error) {
                return {
                    ok: false,
                    error: message(error),
                    windowGone: !!(error && error.windowGone === true)
                };
            });
    }

    /** The same, over a list of arguments. */
    function readN(name, args) {
        if (!session || typeof session[name] !== 'function') {
            return Promise.resolve({ ok: false, error: ERRORS.noSession });
        }
        return Promise.resolve().then(function () { return session[name].apply(session, args || []); })
            .then(function (value) { return { ok: true, value: value }; }, function (error) {
                return {
                    ok: false,
                    error: message(error),
                    windowGone: !!(error && error.windowGone === true)
                };
            });
    }

    /**
     * Player.AttackMonster: an "id..." name is a MonMapID, anything else is the monster's name.
     * The call is the one thing this build cannot make (its argument is a live Avatar), so the
     * refusal is returned as a reason for the caller to log - never swallowed, never faked.
     */
    function attackMonster(name) {
        const text = String(name === undefined || name === null ? '' : name);
        const byId = /^id['.:-](.*)$/i.exec(text);
        return byId
            ? read1('attackMonsterByMonMapId', byId[1])
            : read1('attackMonster', text);
    }

    /** The skill set Bot.cs builds from its own Skills list: the label rows, by upper-cased text. */
    function skillSet() {
        const out = {};
        const list = config && Array.isArray(config.Skills) ? config.Skills : [];
        list.forEach(function (entry, i) {
            if (entry && Number(entry.Type) === 2 && entry.Text !== undefined) {
                out[String(entry.Text).toUpperCase()] = i;
            }
        });
        return out;
    }

    /** BotData.SkillSet["[" + BotSkill + "]"] + 1, or 0 when the set has no such label. */
    function labelStart() {
        const found = skillSet()['[' + String(botSkill || '').toUpperCase() + ']'];
        return found === undefined ? 0 : found + 1;
    }

    /**
     * Skill.ExecuteSkill: a Safe row casts only while its own HP (or MP) threshold holds, and the
     * equipped class decides how the cast goes - Skill.cs forces for a Chrono Shadow and walks
     * into range otherwise.
     */
    async function executeSkill(entry) {
        if (entry && Number(entry.Type) === 1) {
            const want = Number(entry.SafeValue) || 0;
            const isMp = entry.IsSafeMp === true || entry.IsSafeMp === 'True';
            const now = await read(isMp ? 'mana' : 'health');
            const max = await read(isMp ? 'manaMax' : 'healthMax');
            if (!now.ok || !max.ok || !Number(max.value)) {
                return { ok: false, error: now.ok ? 'no maximum to compare against' : now.error };
            }
            const percent = Number(now.value) / Number(max.value) * 100;
            const type = Number(entry.SType) || 0;
            const passes = type === 0 ? percent <= want : (type === 1 ? percent >= want : percent === want);
            if (!passes) return { ok: true, skipped: true };
        }
        const klass = await read('className');
        const method = klass.ok && String(klass.value).toLowerCase() === 'chrono shadow'
            ? 'forceUseSkill'
            : 'useSkill';
        return read1(method, String(entry && entry.Index));
    }

    /**
     * Skill.hasaura, against the aura state #42 caches.
     *
     * A row with no condition is ready, and so is one whose condition the reference cannot parse -
     * `string.IsNullOrWhiteSpace(aura)`, no operator among `!=`, `>=`, `<=`, `=`, or a split on
     * that operator that is not exactly two parts: all three are `return true` in the reference's
     * own body. Everything else is a comparison against THIS character's own stacks
     * (`Player.GetAuras(true, aura[0])`), which the reference serves from the cache its packet
     * handlers fill and this build reads through the session seam (bot/auras.js, ticket #42).
     *
     * A read that cannot be made is a reason, never a ready row: the reference consults its cache
     * for every one of these, so a build that cannot consult it holds the row back and says why.
     * Casting on a condition nobody could evaluate is the silent no-op this gate exists to stop.
     */
    async function hasAura(entry) {
        const written = entry && entry.aura !== undefined && entry.aura !== null
            ? String(entry.aura) : '';
        if (!written.trim()) return true;

        // The reference's own scan order, and the first hit wins: "Chi!=2" is `!=`, not `=`.
        const op = written.indexOf('!=') !== -1 ? '!='
            : written.indexOf('>=') !== -1 ? '>='
                : written.indexOf('<=') !== -1 ? '<='
                    : written.indexOf('=') !== -1 ? '=' : null;
        if (op === null) return true;
        const parts = written.split(op).filter(function (one) { return one.length > 0; });
        if (parts.length !== 2) return true;

        const told = await read1('selfAura', parts[0]);
        if (!told.ok) {
            reportOnce('skill-aura:' + parts[0] + ':' + told.error,
                'skill ' + String(entry && entry.Index) + ' has the aura condition "' + written +
                '"; that read was refused, so the condition cannot be honoured: ' + told.error);
            return false;
        }
        // `int.TryParse(aura[1], out int t)` leaves its 0 behind when the value will not parse,
        // and it is strict: "3x" and "3.5" are its 0, not the 3 parseInt would take from them,
        // and a value outside Int32 fails rather than saturating.
        const value = parts[1].trim();
        const parsed = /^[+-]?\d+$/.test(value) ? Number(value) : NaN;
        const wanted = Number.isInteger(parsed) && Math.abs(parsed) <= 2147483647 ? parsed : 0;
        const stacks = Number(told.value);
        const count = isFinite(stacks) ? stacks : 0;
        // The four cases as Compare writes them - including `<=` comparing with `<`, which is the
        // reference's own body rather than what its operator reads as.
        if (op === '>=') return count >= wanted;
        if (op === '<=') return count < wanted;
        if (op === '=') return count === wanted;
        return count !== wanted;
    }

    /** Move the rotation's cursor the way the reference does at the end of one cast. */
    function advance(which, count, start) {
        if (which === 'kill') skill.kill = skill.kill < count ? skill.kill + 1 : start;
        else skill.attack = skill.attack < count ? skill.attack + 1 : start;
    }

    /**
     * The rotation CmdAttack and CmdKill share, one row per call. Faithful to the reference's own
     * cursors: kill's survives across runs and only resets when the skill set changes, the label
     * row sends the cursor back to the set's start, and a row whose aura condition is not met is
     * skipped when it is not a wait-cd row.
     */
    async function rotateSkills(which, options) {
        const opts = options || {};
        const list = config && Array.isArray(config.Skills) ? config.Skills : [];
        if (!list.length) return;
        const start = labelStart();
        const count = list.length - 1;
        if (which === 'kill') {
            if (skill.kill > count) skill.kill = start;
            if (skill.lastBotSkill !== botSkill) {
                if (start !== 0) skill.kill = start;
                skill.lastBotSkill = botSkill;
            }
        } else if (skill.attack > count || skill.attack < start) {
            skill.attack = start;
        }
        const entry = list[which === 'kill' ? skill.kill : skill.attack];
        if (!entry) return;
        if (Number(entry.Type) === 2) {
            if (which === 'kill') skill.kill = start;
            else skill.attack = start;
            return;
        }
        if (!(await hasAura(entry)) && !entry.waitCd) {
            advance(which, count, start);
            return;
        }
        if (opts.waitForSkill || entry.waitCd) {
            const ready = await read1('skillAvailable', String(entry.Index));
            if (ready.ok) await sleep(Math.max(0, Number(ready.value) || 0));
        }
        const cast = await executeSkill(entry);
        if (!cast.ok) {
            reportOnce('skill:' + String(entry.Index) + ':' + cast.error,
                'skill ' + entry.Index + ' could not be cast: ' + cast.error);
        }
        if (entry.waitCd && !(await hasAura(entry))) await sleep(200);
        advance(which, count, start);
    }

    /** The four monster-specific re-targets CmdKill performs before each skill. */
    const KILL_SPECIALS = {
        escherion: 'Staff of Inversion',
        'commander gallaeon': 'hydra crew',
        vath: 'Stalagbite',
        'ultra avatar tyndarius': 'Ultra Fire Orb'
    };

    async function killSpecials(monster) {
        const wanted = KILL_SPECIALS[String(monster || '').toLowerCase()];
        if (!wanted) return;
        const there = await read1('monsterAvailable', wanted);
        if (there.ok && there.value === true) await attackMonster(wanted);
    }

    /**
     * Inventory.ContainsItem, in the reference's own shape: a name and a quantity, where "*" is
     * "any" and a quantity that is not a number is treated as one stack.
     */
    function holdsItem(list, name, qty) {
        const want = String(name === undefined || name === null ? '' : name).trim().toLowerCase();
        const items = Array.isArray(list) ? list : [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item) continue;
            const itemName = String(item.sName === undefined ? item.Name || '' : item.sName).toLowerCase();
            if (itemName !== want) continue;
            if (String(qty) === '*') return true;
            const have = Number(item.iQty === undefined ? item.Quantity : item.iQty) || 0;
            return have >= (Number(qty) || 1);
        }
        return false;
    }

    /**
     * CmdKillFor's own test: every name in the list, against its own quantity. The reference reads
     * the inventory for Items and the temporary inventory for Temps (ItemType 1), which is the
     * loader's GetInventoryItems / GetTempItems - both of which the surface answers (#48).
     */
    async function collected(names, quantities, itemType) {
        const list = await read(itemType === 1 ? 'tempItems' : 'items');
        if (!list.ok) return { ok: false, error: list.error };
        const names2 = String(names === undefined ? '' : names).split(',');
        const qty = String(quantities === undefined ? '' : quantities).split(',');
        const every = names2.every(function (entry, i) {
            return holdsItem(list.value, entry, qty[i] === undefined ? '*' : qty[i]);
        });
        return { ok: true, value: every };
    }

    /** CmdKill's KillPriority: the first name on the list that is in the cell wins. */
    async function killPriority(list) {
        const wanted = String(list || '').split(',').map(function (part) { return part.trim(); })
            .filter(function (part) { return part.length; });
        for (let i = 0; i < wanted.length; i++) {
            const there = await read1('monsterAvailable', wanted[i]);
            if (there.ok && there.value === true) {
                await attackMonster(wanted[i]);
                return;
            }
        }
    }

    /**
     * The body CmdKill, CmdKillFor and both hunt commands share: wait for the monster, attack it,
     * rotate the set while it lives, then make sure the target is dropped. Returns a reason when
     * something in it could not be carried through, so the caller can log it; a refusal here is
     * never a hang, which is the ticket's own last acceptance criterion.
     */
    async function killOnce(options) {
        const opts = options || {};
        if (config && config.SkipAttack) {
            if ((await read('hasTarget')).value === true) await read('cancelTargets');
            return 'SkipAttack is on: the target was dropped instead of attacked';
        }

        // "waiting monster to respawn for 3s" - the reference's own comment and its own timeout.
        await waitUntil(async function () {
            const there = await read1('monsterAvailable', opts.monster);
            return there.ok && there.value === true;
        }, { timeout: 3 });

        if (config && config.WaitForAllSkills) {
            const ready = await read('allSkillsAvailable');
            if (ready.ok) await sleep(Math.max(0, Number(ready.value) || 0));
        }
        if (!running) return 'the bot stopped';
        const alive = await read('alive');
        const signed = await read('signedIn');
        if (!(alive.ok && alive.value === true) || !(signed.ok && signed.value === true)) {
            return 'there is no living, signed-in character to attack with';
        }

        if (opts.antiCounter) {
            // The reference watches its own packet tap for "prepares a counter attack" and for the
            // Counter Attack aura fading. This engine has no tap, so the option is reported rather
            // than half-honoured: a pause that never happens would look like a stuck bot.
            reportOnce('anticounter', 'AntiCounter watches the animation packets, which this ' +
                'engine has no tap for yet; the fight runs without its pause');
        }

        const attacked = await attackMonster(opts.monster);
        if (!attacked.ok) return attacked.error;

        const list = config && Array.isArray(config.Skills) ? config.Skills : [];
        const rounds = opts.rounds === undefined ? 1 : opts.rounds;
        if (list.length && rounds > 0) {
            for (let round = 0; round < rounds; round++) {
                if (!running) break;
                const signedNow = await read('signedIn');
                const target = await read('hasTarget');
                const hp = await read('targetHealth');
                if (!(signedNow.ok && signedNow.value === true)) break;
                if (!(target.ok && target.value === true)) break;
                if (!hp.ok || !(Number(hp.value) > 0)) break;
                await killSpecials(opts.monster);
                if (opts.killPriority) await killPriority(opts.killPriority);
                await sleep(Number(config.SkillDelay) || 0);
                await rotateSkills('kill', { waitForSkill: !!(config && config.WaitForSkill) });
            }
        }

        // "timeout increased to 40 for Autoattack/empty skills users" - the reference's own note.
        await waitUntil(async function () {
            const target = await read('hasTarget');
            return !(target.ok && target.value === true);
        }, { timeout: 40 });
        const still = await read('hasTarget');
        if (still.ok && still.value === true) {
            await read('cancelTargets');
            return 'the target did not die, so it was dropped for the next command';
        }
        return undefined;
    }

    // ---------------------------------------------------------------- combat and map handlers

    const handlers = {
        CmdBlank: function () {},
        CmdBlank2: function () {},
        CmdBlank3: function () {},

        CmdLabel: function () {},
        CmdGotoLabel: function (ctx, command) {
            const wanted = resolve(command.Label);
            const found = commands().findIndex(function (candidate) {
                return catalog.classNameOf(candidate) === 'CmdLabel' &&
                    String(candidate.Name || '').toLowerCase() === String(wanted).toLowerCase();
            });
            if (found > -1) setIndex(found);
            return found > -1 ? undefined : 'no label named ' + wanted + ' in this bot';
        },

        CmdIndex: function (ctx, command) {
            let amount = Number(command.Index) || 0;
            const written = command.IndexString;
            if (written && String(written).length) {
                const resolved = isVar(written) ? (vars[getVar(written)] !== undefined
                    ? vars[getVar(written)] : written) : written;
                const parsed = parseInt(String(resolved), 10);
                if (!isNaN(parsed)) amount = parsed;
            }
            const type = Number(command.Type) || 0;
            if (type === 1) setIndex(indexOf(index + (amount - 1)));          // Down
            else if (type === 0) setIndex(indexOf(index - (amount + 1)));    // Up
            else setIndex(amount - 1);                                       // Goto
        },
        CmdRestart: function () { index = -1; },
        CmdStop: function (ctx, command) {
            // CmdStop's KeepLagkiller is the option toggles (#34) and its BankOnStop banks the
            // AC items in the bot's own Items list (the loader's TransferToBank / GetInventoryItems,
            // both of which the surface now answers). Neither is wired into this loop yet, so the
            // log names them rather than pretending to have honoured them.
            if (command && (command.KeepLagkiller || (config && config.BankOnStop))) {
                log('CmdStop: KeepLagkiller (#34) and BankOnStop are not applied by this loop yet');
            }
            stop();
        },

        CmdDelay: function (ctx, command) { return sleep(Number(command.Delay) || 0); },
        CmdBotDelay: function (ctx, command) { ctx.setConfig('BotDelay', Number(command.Delay) || 0); },

        CmdInt: function (ctx, command) {
            const key = String(command.Int);
            if (!Object.prototype.hasOwnProperty.call(ints, key)) ints[key] = 0;
            const type = Number(command.type) || 0;
            if (type === 1) ints[key]++;
            else if (type === 2) ints[key]--;
            else ints[key] = Number(command.Value) || 0;
        },
        CmdInt2: function (ctx, command) {
            const parsed = parseInt(resolve(command.Value), 10);
            // The reference returns early when the value is not an int: nothing is written.
            if (isNaN(parsed)) return 'CmdInt2: "' + resolve(command.Value) + '" is not an int';
            ints[String(command.IntKey)] = parsed;
        },
        CmdClearTemp: function () {
            Object.keys(vars).forEach(function (key) { delete vars[key]; });
            Object.keys(ints).forEach(function (key) { delete ints[key]; });
        },

        CmdSetVar: function (ctx, command) {
            const key = String(command.Value1);
            const written = String(command.Value2 === undefined ? '' : command.Value2);
            // CmdSetVar's own conveniences read the inventory ({weapon}, {class}, {nr10},
            // {helm}, {cape} and ".qty"), which the reference serves from its loader's
            // GetInventoryItems. That helper is now on the surface (#48) but this loop holds no
            // game access of its own beyond the session, so the value is left as written and the
            // reason is reported rather than a stand-in item name being invented.
            if (/^\{(weapon|class|nr10|helm|cape)\}$/.test(key) || /\.qty$/i.test(written)) {
                log('CmdSetVar: "' + (/\.qty$/i.test(written) ? written : key) + '" reads the ' +
                    'inventory (the loader\'s GetInventoryItems), which this loop cannot reach yet');
            }
            vars[key] = written.indexOf('[') !== -1 ? resolve(written) : written;
        },
        CmdUpdateVar: function (ctx, command) {
            const key = String(command.Value1);
            if (Object.prototype.hasOwnProperty.call(vars, key)) vars[key] = command.Value2;
            else ctx.skipNext();
        },

        // The variable and integer statements (the reference's Misc.Statements int/var rows). A
        // failing one advances the index by one, which skips the command under it.
        CmdIntIs: function (ctx, command) {
            const left = ints[String(isVar(command.Value1) ? getVar(command.Value1) : command.Value1)];
            const right = intOperand(command.Value2);
            if (left !== right) ctx.skipNext();
        },
        CmdIntIsNot: function (ctx, command) {
            const left = ints[String(isVar(command.Value1) ? getVar(command.Value1) : command.Value1)];
            const right = intOperand(command.Value2);
            if (left === right) ctx.skipNext();
        },
        CmdIntGreaterThan: function (ctx, command) {
            const left = ints[String(isVar(command.Value1) ? getVar(command.Value1) : command.Value1)];
            const right = intOperand(command.Value2);
            // CmdIntGreaterThan upstream asks "less than" and skips when that holds, so the row's
            // own text ("Int Greater Than") and its comparison disagree - reproduced as written.
            if (left < right) ctx.skipNext();
        },
        CmdIntLessThan: function (ctx, command) {
            const left = ints[String(isVar(command.Value1) ? getVar(command.Value1) : command.Value1)];
            const right = intOperand(command.Value2);
            // CmdIntLessThan likewise asks "greater than" (ToString: "{V1} <= {V2}").
            if (left > right) ctx.skipNext();
        },
        CmdIntEqualInt: function (ctx, command) {
            const left = ints[String(isVar(command.Value1) ? getVar(command.Value1) : command.Value1)];
            const right = ints[String(isVar(command.Value2) ? getVar(command.Value2) : command.Value2)];
            if (String(left) !== String(right)) ctx.skipNext();
        },
        CmdIntNotEqualInt: function (ctx, command) {
            const left = ints[String(isVar(command.Value1) ? getVar(command.Value1) : command.Value1)];
            const right = ints[String(isVar(command.Value2) ? getVar(command.Value2) : command.Value2)];
            if (!(String(left) !== String(right))) ctx.skipNext();
        },
        CmdVarEqualVar: function (ctx, command) {
            if (resolve(command.Value1) !== resolve(command.Value2)) ctx.skipNext();
        },
        CmdVarNotEqualVar: function (ctx, command) {
            if (resolve(command.Value1) === resolve(command.Value2)) ctx.skipNext();
        },

        // ---- Combat (CmdAttack, CmdCancelTarget, CmdKill, CmdRest, CmdSkillSet, CmdUseSkill) ----

        CmdAttack: async function (ctx, command) {
            // CmdAttack.cs. SkipAttack short-circuits into a cancel; otherwise the attack is sent
            // while running/alive/signed in, and a "*" only fires when nothing is targeted yet.
            if (config && config.SkipAttack) {
                if ((await read('hasTarget')).value === true) await read('cancelTargets');
                return 'SkipAttack is on: the target was dropped instead of attacked';
            }
            const alive = await read('alive');
            const signed = await read('signedIn');
            const monster = resolve(command.Monster);
            // The "*" branch skips the attack when something is already targeted; it does NOT skip
            // the skill rotation below, which upstream sits outside the if/else entirely.
            let failed = null;
            if (!running || !(alive.ok && alive.value === true) || !(signed.ok && signed.value === true)) {
                failed = 'not attacking: the character is not running, alive and signed in';
            } else if (String(monster) === '*') {
                const target = await read('hasTarget');
                if (!(target.ok && target.value === true)) {
                    const attacked = await attackMonster(monster);
                    if (!attacked.ok) failed = attacked.error;
                }
            } else {
                const attacked = await attackMonster(monster);
                if (!attacked.ok) failed = attacked.error;
            }
            if (command.UseSkill) await rotateSkills('attack', {});
            return failed;
        },

        CmdKill: async function (ctx, command) {
            // CmdKill.cs. The kill itself is one body; the loop around it is the caller's, because
            // a bot that kills "for" an item or a quest is a different command (#39/#41).
            const reason = await killOnce({
                monster: varOf(command.Monster),
                killPriority: command.KillPriority,
                antiCounter: command.AntiCounter === true,
                rounds: 1
            });
            return reason;
        },

        CmdCancelTarget: async function (ctx, command) {
            // CmdCancelTarget.cs: the three cancels, then a jump on the spot with LeaveCombat.
            await read('cancelTargets');
            if (command && command.LeaveCombat) {
                const cell = await read('cell');
                const pad = await read('pad');
                const moved = await readN('jump', [cell.ok ? cell.value : '', pad.ok ? pad.value : '']);
                if (!moved.ok) return 'could not leave combat: ' + moved.error;
                await sleep(500);
            }
            return undefined;
        },

        CmdRest: async function (ctx, command) {
            // CmdRest.cs: wait for the Rest lock, optionally leave combat first, rest, and wait for
            // full bars when the row asks for a full rest. LockActions.Rest is "rest".
            await waitUntil(async function () {
                const ready = await read1('actionAvailable', 'rest');
                return ready.ok && ready.value === true;
            }, {});
            if (config && config.ExitCombatBeforeRest) {
                // "while (Player.CurrentState == Player.State.InCombat)": State.InCombat is 2.
                for (let guard = 0; guard < 10; guard++) {
                    const state = await read('state');
                    if (!state.ok || Number(state.value) !== 2) break;
                    const cell = await read('cell');
                    const pad = await read('pad');
                    await readN('jump', [cell.ok ? cell.value : '', pad.ok ? pad.value : '']);
                    await sleep(1250);
                }
            }
            const rested = await read('rest');
            if (!rested.ok) return 'could not rest: ' + rested.error;
            if (command && command.Full) {
                await waitUntil(async function () {
                    const mana = await read('mana');
                    const manaMax = await read('manaMax');
                    const health = await read('health');
                    const healthMax = await read('healthMax');
                    if (!mana.ok || !manaMax.ok || !health.ok || !healthMax.ok) return true;
                    return Number(mana.value) >= Number(manaMax.value) &&
                        Number(health.value) >= Number(healthMax.value);
                }, {});
            }
            return undefined;
        },

        CmdSkillSet: function (ctx, command) {
            // CmdSkillSet.cs: BotData.BotSkill = Name.ToUpper(). The rotation reads it back through
            // labelStart, so the whole point is that this is state and not an action.
            botSkill = String(command.Name || '').toUpperCase();
        },

        CmdUseSkill: async function (ctx, command) {
            // CmdUseSkill.cs. FindTarget runs first; then a non-forced command with no target
            // leaves; then the optional cooldown wait; then the cast, forced for a Chrono Shadow.
            const monster = varOf(command.Monster === undefined ? '*' : command.Monster);
            if (config && config.SkipAttack) {
                if ((await read('hasTarget')).value === true) await read('cancelTargets');
                return 'SkipAttack is on: the target was dropped instead of the skill being cast';
            }
            await findTarget(monster);
            if (command.Force !== true) {
                const target = await read('hasTarget');
                if (!(target.ok && target.value === true)) {
                    return 'no "' + monster + '" to cast at, so nothing was cast';
                }
            }
            const index = resolve(command.Index);
            if (command.Wait) {
                const ready = await read1('skillAvailable', String(index));
                if (ready.ok) await sleep(Math.max(0, Number(ready.value) || 0));
                await findTarget(monster);
            }
            const klass = await read('className');
            const forced = klass.ok && String(klass.value).toLowerCase().indexOf('chrono shadow') > -1;
            const cast = forced
                ? await read1('forceUseSkill', String(index))
                : await read1('useSkill', String(index));
            return cast.ok ? undefined : cast.error;
        },

        // ---- Map (CmdJoin, CmdMoveToCell, CmdSetSpawn, CmdTravel, CmdWalk, CmdYulgar) ------

        CmdJoin: async function (ctx, command) {
            // CmdJoin.cs: a map may carry its own room ("yulgar-1234"), a non-numeric room becomes
            // a random one, the join is retried Try times, and a map that matches afterwards gets
            // the cell step and the spawn point. A MapSwf loads a local map file instead.
            const cell = varOf(command.Cell);
            const pad = varOf(command.Pad);
            const written = String(varOf(command.Map));
            const mapName = written.indexOf('-') !== -1 ? written.split('-')[0] : written;
            let room = written.indexOf('-') !== -1 ? written.split('-')[1] : '';
            if (room !== '' && !/^\d+$/.test(room)) room = String(randomRoom());

            const here = await read('map');
            let tries = Number(command.Try) || 1;
            if (!(here.ok && String(here.value).toLowerCase() === mapName.toLowerCase())) {
                while (tries > 0) {
                    const now = await read('map');
                    if (now.ok && String(now.value).toLowerCase() === mapName.toLowerCase()) break;
                    const joined = await tryJoin(mapName, room, cell, pad);
                    if (!joined.ok) return joined.error;
                    tries--;
                }
            }

            const arrived = await read('map');
            if (!(arrived.ok && String(arrived.value).toLowerCase() === mapName.toLowerCase())) {
                return 'could not reach ' + mapName + ' in ' + (Number(command.Try) || 1) + ' try(ies)';
            }
            const at = await read('cell');
            if (!(at.ok && String(at.value).toLowerCase() === String(cell).toLowerCase())) {
                await readN('jump', [String(cell), String(pad)]);
                await sleep(500);
            }
            await read('setSpawnPointHere');

            const swf = String(command.MapSwf === undefined ? '' : command.MapSwf);
            if (swf.indexOf('.swf') !== -1 && swf.indexOf('(.swf)') === -1) {
                const loaded = await read1('loadMap', swf);
                if (!loaded.ok) return 'could not load ' + swf + ': ' + loaded.error;
                await waitUntil(async function () {
                    const ready = await read('ready');
                    return ready.ok && ready.value === true;
                }, {});
            }
            return undefined;
        },

        CmdTravel: async function (ctx, command) {
            // CmdTravel.cs: wait for the transfer lock, then join when the map differs, otherwise
            // just step to the cell it names.
            await waitUntil(async function () {
                const ready = await read1('actionAvailable', 'tfer');
                return ready.ok && ready.value === true;
            }, {});
            const wanted = String(varOf(command.Map)).split('-')[0];
            const here = await read('map');
            const cell = varOf(command.Cell);
            const pad = varOf(command.Pad);
            if (!(here.ok && String(here.value).toLowerCase() === wanted.toLowerCase())) {
                const state = await read('state');
                if (Number(state.value) === 2) {
                    // "if in combat, jump on the spot until it drops" - the same refreshCell idea.
                    const at = await read('cell');
                    const on = await read('pad');
                    await readN('jump', [at.ok ? at.value : '', on.ok ? on.value : '']);
                    await waitUntil(async function () {
                        const now = await read('state');
                        return !(Number(now.value) === 2);
                    }, {});
                }
                const joined = await readN('join', [String(varOf(command.Map)), String(cell), String(pad)]);
                if (!joined.ok) return 'could not join ' + varOf(command.Map) + ': ' + joined.error;
                await waitUntil(async function () {
                    const now = await read('map');
                    return now.ok && String(now.value).toLowerCase() === wanted.toLowerCase();
                }, {});
                await waitUntil(async function () {
                    const ready = await read('ready');
                    return ready.ok && ready.value === true;
                }, { timeout: 40 });
                return undefined;
            }
            const moved = await readN('jump', [String(cell), String(pad)]);
            if (!moved.ok) return 'could not move to ' + cell + ': ' + moved.error;
            await sleep(500);
            return undefined;
        },

        CmdMoveToCell: async function (ctx, command) {
            // CmdMoveToCell.cs: `while (!Player.Cell.EqualsIgnoreCase(Cell)) { MoveToCell; Delay 500 }`
            // - the loop has no other exit, so the engine's own running flag is the bound here.
            const cell = varOf(command.Cell);
            const pad = varOf(command.Pad);
            for (let guard = 0; guard < 20 && running; guard++) {
                const here = await read('cell');
                if (here.ok && String(here.value).toLowerCase() === String(cell).toLowerCase()) return undefined;
                const moved = await readN('jump', [String(cell), String(pad)]);
                if (!moved.ok) return 'could not move to ' + cell + ': ' + moved.error;
                await sleep(500);
            }
            return undefined;
        },

        CmdSetSpawn: async function () {
            // CmdSetSpawn.cs: Player.SetSpawnPoint().
            const set = await read('setSpawnPointHere');
            return set.ok ? undefined : 'could not set the spawn point: ' + set.error;
        },

        CmdWalk: async function (ctx, command) {
            // CmdWalk.cs: a Random walk picks 150..700 by 320..450 and waits a second; otherwise the
            // command walks to the point it names and waits for the position to read back as that
            // point, up to its own Wait (5000ms by default).
            let x = varOf(command.X);
            let y = varOf(command.Y);
            if (String(command.Type) === 'Random') {
                x = String(150 + Math.floor(Math.random() * 550));
                y = String(320 + Math.floor(Math.random() * 130));
                const walked = await readN('walkToPoint', [x, y]);
                if (!walked.ok) return 'could not walk to ' + x + ',' + y + ': ' + walked.error;
                await sleep(1000);
                return undefined;
            }
            const walked = await readN('walkToPoint', [String(x), String(y)]);
            if (!walked.ok) return 'could not walk to ' + x + ',' + y + ': ' + walked.error;
            await waitUntil(async function () {
                const at = await read('position');
                if (!at.ok || !Array.isArray(at.value)) return false;
                return String(at.value[0]) === String(x) && String(at.value[1]) === String(y);
            }, { timeout: Number(command.Wait) || 5000 });
            return undefined;
        },

        CmdYulgar: async function (ctx, command) {
            // CmdYulgar.cs: wait for the transfer lock, leave combat, join yulgar's Enter/Spawn if
            // that is not where the player is, walk somewhere random, and stop the bot.
            await waitUntil(async function () {
                const ready = await read1('actionAvailable', 'tfer');
                return ready.ok && ready.value === true;
            }, {});
            const state = await read('state');
            if (Number(state.value) === 2) {
                const cell = await read('cell');
                const pad = await read('pad');
                await readN('jump', [cell.ok ? cell.value : '', pad.ok ? pad.value : '']);
                await sleep(1250);
            }
            const here = await read('map');
            if (!(here.ok && String(here.value).toLowerCase() === 'yulgar')) {
                const joined = await readN('join', ['yulgar', 'Enter', 'Spawn']);
                if (!joined.ok) return 'could not join yulgar: ' + joined.error;
                await waitUntil(async function () {
                    const now = await read('map');
                    return now.ok && String(now.value).toLowerCase() === 'yulgar';
                }, {});
                await waitUntil(async function () {
                    const ready = await read('ready');
                    return ready.ok && ready.value === true;
                }, { timeout: 40 });
            }
            const x = String(150 + Math.floor(Math.random() * 550));
            const y = String(320 + Math.floor(Math.random() * 130));
            await readN('walkToPoint', [x, y]);
            stop();
            return undefined;
        },

        CmdMoveToCell2: function (ctx, command) {
            // CmdMoveToCell2.cs jumps cells in a background task while the bot's list carries on,
            // which is why it is this engine's one deliberate no-op beyond reporting: a bot that
            // waits for its own background jump is the other command (CmdMoveToCell). The stop flag
            // cancels the jump the earlier CmdMoveToCell2 started.
            if (command.stop) {
                if (jump.token) {
                    jump.token.cancelled = true;
                    jump.token = null;
                    return undefined;
                }
                return 'no cell jump is running to stop';
            }
            const list = String(varOf(command.Cell)).split(',')
                .map(function (part) { return part.trim(); })
                .filter(function (part) { return part.length; });
            if (!list.length) return 'this cell jump names no cell to jump to';
            const pads = String(varOf(command.Pad)).split(',');
            const maxcell = Math.min(Number(command.maxcell) || 5, list.length);
            const target = String(varOf(command.target === undefined ? '*' : command.target));
            if (jump.token) jump.token.cancelled = true;
            const token = { cancelled: false };
            jump.token = token;
            runCellJump(ctx, token, list, pads, maxcell, target);
            return 'cell jump started over ' + maxcell + ' cell(s); the list continues without waiting';
        },

        CmdKillFor: async function (ctx, command) {
            // CmdKillFor.cs: kill until the item (or the quest) is done. The loop is bounded here
            // because this build cannot guarantee a kill lands - see the note in killOnce - and a
            // bound that is reported reads better than a bot that silently runs all night.
            const monster = varOf(command.Monster);
            const questId = parseInt(String(command.QuestId === undefined ? '' : command.QuestId), 10);
            if (!isNaN(questId)) {
                return 'killing for a quest (#' + questId + ') needs the quest reads of ticket #39; ' +
                    'the kill itself is wired, the "until the quest is complete" half is not';
            }
            const itemType = Number(command.ItemType) || 0;
            const names = varOf(command.ItemName).trim();
            const quantities = varOf(command.Quantity);
            const start = await collected(names, quantities, itemType);
            if (!start.ok) return 'could not read the inventory: ' + start.error;
            if (start.value) return undefined;
            let last = null;
            for (let round = 0; round < HUNT_ROUNDS && running; round++) {
                last = await killOnce({
                    monster: monster,
                    killPriority: command.KillPriority,
                    antiCounter: command.AntiCounter === true,
                    rounds: 1
                });
                if (last) break;
                const now = await collected(names, quantities, itemType);
                if (!now.ok) return 'could not read the inventory: ' + now.error;
                if (now.value) break;
                await sleep(Number(command.DelayAfterKill === undefined ? 500 : command.DelayAfterKill) || 0);
            }
            const done = await collected(names, quantities, itemType);
            if (done.ok && done.value) return undefined;
            if (last) return last;
            return 'stopped after ' + HUNT_ROUNDS + ' kill(s) without ' + names + ' ' + quantities + 'x';
        },

        CmdShortHunt: async function (ctx, command) {
            // CmdShortHunt.cs: check the item first and leave if it is already there, join the map
            // while it does not match, then run the kill-for.
            const items = varOf(command.ItemName);
            const qty = varOf(command.Quantity);
            const itemType = Number(command.ItemType) || 0;
            const start = await collected(items, qty, itemType);
            if (!start.ok) return 'could not read the inventory: ' + start.error;
            if (start.value) return undefined;

            const written = String(varOf(command.Map)).toLowerCase();
            const mapName = written.split('-')[0];
            const cells = String(varOf(command.Cell)).split(',');
            const pads = String(varOf(command.Pad)).split(',');
            for (let round = 0; round < HUNT_JOIN_ROUNDS && running; round++) {
                const here = await read('map');
                if (here.ok && String(here.value).toLowerCase() === mapName) break;
                if (command.BlankFirst) {
                    const state = await read('state');
                    if (Number(state.value) === 2) await read('cancelTargets');
                }
                const joined = await readN('join', [written, String(cells[0]), String(pads[0])]);
                if (!joined.ok) return 'could not reach ' + mapName + ': ' + joined.error;
                await waitUntil(async function () {
                    const now = await read('map');
                    return now.ok && String(now.value).toLowerCase() === mapName;
                }, {});
            }
            const arrived = await read('map');
            if (!(arrived.ok && String(arrived.value).toLowerCase() === mapName)) {
                return 'could not reach ' + mapName + ' to hunt in';
            }
            // The reference also holds the cells it was given while the kill runs. That is another
            // background task (CmdMoveToCell2's shape), so the hunt here fights where it landed.
            const reason = await huntRounds(command, items, qty, itemType, varOf(command.Monster),
                command.DelayAfterKill === undefined ? 50 : command.DelayAfterKill, command.KillPriority,
                command.AntiCounter);
            return reason;
        },

        CmdQuestHunt: async function (ctx, command) {
            // CmdQuestHunt.cs is the quest chain version of CmdShortHunt: load the quest, accept it,
            // read its required items off the quest itself, then hunt each of them. Which items a
            // quest needs is a quest read, and those belong to #39/#41 (the surface refuses
            // GetQuestTree for exactly that reason), so the required-item half is reported rather
            // than guessed at from the row's own columns.
            const qid = Number(command.QID) || 0;
            const items = varOf(command.ItemName);
            const qty = varOf(command.Quantity);
            const itemType = Number(command.ItemType) || 0;
            const start = await collected(items, qty, itemType);
            if (!start.ok) return 'could not read the inventory: ' + start.error;
            if (start.value) return undefined;

            const written = String(varOf(command.Map)).toLowerCase();
            const mapName = written.split('-')[0];
            const cells = String(varOf(command.Cell)).split(',');
            const pads = String(varOf(command.Pad)).split(',');
            if (!qid) {
                // Without a quest this is the non-quest branch of the same file: the item list it
                // was given, hunted one by one.
                const names = items.split(',');
                const quantities = qty.split(',');
                const monsters = String(varOf(command.Monster)).split(',');
                for (let i = 0; i < names.length && running; i++) {
                    const done = await collected(names[i], quantities[i] === undefined ? '1' : quantities[i], itemType);
                    if (!done.ok || done.value) continue;
                    const joined = await readN('join', [written, String(cells[0]), String(pads[0])]);
                    if (!joined.ok) return 'could not reach ' + mapName + ': ' + joined.error;
                    await waitUntil(async function () {
                        const now = await read('map');
                        return now.ok && String(now.value).toLowerCase() === mapName;
                    }, {});
                    const reason = await huntRounds(command, names[i],
                        quantities[i] === undefined ? '1' : quantities[i], itemType,
                        monsters[i] === undefined ? '*' : monsters[i], 50, command.KillPriority,
                        command.AntiCounter);
                    if (reason) return reason;
                }
                return undefined;
            }
            return 'quest hunt #' + qid + ' reads the quest\'s own required items, which is the ' +
                'quest surface of ticket #39; its map, cell and kill halves are wired';
        },

        CmdFollow: async function (ctx, command) {
            // CmdFollow.cs: while the player follows, if the followed player is not in the map then
            // step to Blank, GoToPlayer, and count the tries out at MaxGotoTry; otherwise set the
            // spawn point and kill whatever is targeted. The packet tap that moves the bot to a
            // followed player's cell as they walk (uotls) is not available in this build, so the
            // follow is the coarser GoTo + kill loop and says so.
            const who = String(varOf(command.PlayerName)).toLowerCase();
            const maxTry = Number(command.MaxGotoTry) || 999;
            let gotoTry = 0;
            for (let round = 0; round < HUNT_ROUNDS && running; round++) {
                const alive = await read('alive');
                if (!(alive.ok && alive.value === true)) {
                    await sleep(1000);
                    continue;
                }
                const here = await read('map');
                void here;
                if (gotoTry >= maxTry) {
                    return 'could not find ' + who + ' after ' + maxTry + ' goto(s)';
                }
                reportOnce('follow-tap', 'following a player reads their cell off the uotls ' +
                    'packet, which this engine has no tap for; the bot walks with GoTo and fights ' +
                    'what it finds there');
                const went = await read1('goTo', who);
                if (!went.ok) return 'could not goto ' + who + ': ' + went.error;
                gotoTry++;
                await read('setSpawnPointHere');
                const reason = await killOnce({
                    monster: '*',
                    killPriority: command.KillPriority,
                    antiCounter: command.AntiCounter === true,
                    rounds: 1
                });
                if (reason) return reason;
                await sleep(500);
                if (command.WaitForever === true) continue;
                return undefined;
            }
            return undefined;
        }
    };

    // The state-reading statements (#41). They take the same (ctx, command) a handler here takes,
    // so they resolve their own fields and skip the command under them the same way. Merged rather
    // than inlined so that #42's own table is a second line here and nothing else.
    Object.assign(handlers, statements.HANDLERS);

    // The aura, target and combat statements (#42), merged second and deliberately. The two tables
    // overlap in exactly one name, CmdNameEquals: the reference reads Player.Username, which #42's
    // ticket owns, and #41 registers it too. The ticket's own ruling is that the later ticket takes
    // it, and merging this table last is how that reads in code - the body that runs is the one
    // written against the reference's own `Equals(..., OrdinalIgnoreCase)`, which compares the
    // operands as they are rather than trimming them first.
    Object.assign(handlers, require('./statements-auras.js').handlers);
    /** How many kills one hunt command attempts before it reports rather than loops forever. */
    const HUNT_ROUNDS = 10;
    /** And how many map joins, which is the reference's own Try shape for a hunt. */
    const HUNT_JOIN_ROUNDS = 3;

    /** The kill half both hunt commands share: kill once, then look at the item again. */
    async function huntRounds(command, names, quantities, itemType, monster, delay, killPriority, antiCounter) {
        for (let round = 0; round < HUNT_ROUNDS && running; round++) {
            const reason = await killOnce({
                monster: monster === undefined || monster === '' ? '*' : monster,
                killPriority: killPriority,
                antiCounter: antiCounter === true,
                rounds: 1
            });
            if (reason) return reason;
            const done = await collected(names, quantities, itemType);
            if (!done.ok) return 'could not read the inventory: ' + done.error;
            if (done.value) return undefined;
            await sleep(Number(delay) || 0);
        }
        return 'stopped after ' + HUNT_ROUNDS + ' kill(s) without ' + names + ' ' + quantities + 'x';
    }

    /**
     * CmdMoveToCell2's background jump: step through the cells, and while a monster it was told to
     * find is in the cell, wait it out instead of moving on. It stops on the engine's own running
     * flag or on the token the stop flag cancelled.
     */
    function runCellJump(ctx, token, list, pads, maxcell, target) {
        Promise.resolve().then(async function () {
            let i = 0;
            while (!token.cancelled && running) {
                // A real macrotask yield, on an unbounded loop. Awaiting an already-resolved promise
                // only drains a microtask, and a session whose reads answer immediately (a stubbed
                // one, or a game path that resolves without touching the wire) would spin here
                // without ever letting the app's own timers run - which is how this ticket's turn
                // ran the process out of memory once.
                await new Promise(function (resolve) { setTimeout(resolve, 0); });
                if (target !== '' && target !== '*') {
                    const there = await read1('monsterAvailable', target);
                    if (there.ok && there.value === true) {
                        await waitUntil(async function () {
                            const now = await read1('monsterAvailable', target);
                            return !(now.ok && now.value === true);
                        }, {});
                        continue;
                    }
                }
                const cell = list[i];
                const pad = pads[i] === undefined ? 'Left' : pads[i];
                const here = await read('cell');
                if (!(here.ok && String(here.value) === String(cell))) await readN('jump', [cell, pad]);
                // "This loop is needed to wait init monster loaded from clientside, otherwise it
                // will keep jumping nonstop" - the reference's own comment, and its own 50ms poll.
                await waitUntil(async function () {
                    const there = await read1('monsterAvailable', '*');
                    return there.ok && there.value === true;
                }, { interval: 50 });
                i++;
                if (i >= maxcell) i = 0;
            }
        }).catch(function (error) {
            ctx.log('the cell jump stopped: ' + message(error));
        });
    }

    /**
     * CmdUseSkill's own FindTarget: "*" attacks only when nothing is targeted, a name is attacked
     * outright. The refusal is not swallowed - the command reports it the way the attack does.
     */
    async function findTarget(monster) {
        if (String(monster) === '*') {
            const target = await read('hasTarget');
            if (target.ok && target.value === true) return;
        }
        await attackMonster(monster);
    }

    /** CmdJoin's own room roll for a non-numeric room: new Random().Next(1000, 99999). */
    function randomRoom() {
        return 1000 + Math.floor(Math.random() * (99999 - 1000));
    }

    /**
     * CmdJoin's TryJoin: a safe cell first when the player is in combat, then the join with the
     * room, then the two waits its own body makes - 5s for the map and 40s for the reload.
     *
     * The safe cell is a client setting upstream (ClientConfig C_SAFE_CELL, "safeCell"); this app
     * has no such setting, so when the player is in combat the join is still attempted, which is
     * what the reference does when its own safe cell is unset.
     */
    async function tryJoin(mapName, room, cell, pad) {
        const state = await read('state');
        if (Number(state.value) === 2) {
            const at = await read('cell');
            const on = await read('pad');
            await readN('jump', [at.ok ? at.value : '', on.ok ? on.value : '']);
            await waitUntil(async function () {
                const now = await read('state');
                return !(Number(now.value) === 2);
            }, { timeout: 10 });
            await sleep(1500);
        }
        const joined = await readN('join', [String(mapName) + (String(room).length ? '-' + room : ''),
            String(cell), String(pad)]);
        if (!joined.ok) return joined;
        await waitUntil(async function () {
            const now = await read('map');
            return now.ok && String(now.value).toLowerCase() === String(mapName).toLowerCase();
        }, { timeout: 5 });
        await waitUntil(async function () {
            const ready = await read('ready');
            return ready.ok && ready.value === true;
        }, { timeout: 40 });
        return { ok: true };
    }

    // ---------------------------------------------------------------- the loop

    function stop() {
        if (!running) return;
        running = false;
        paused = false;
        // CmdMoveToCell2's background jump holds the engine's own cancellation token, and the
        // reference's Stop is what a stopped bot expects to end it.
        if (jump.token) {
            jump.token.cancelled = true;
            jump.token = null;
        }
        if (deps.options && typeof deps.options.stop === 'function') {
            Promise.resolve(deps.options.stop()).catch(function () {});
        }
        if (session && typeof session.exitCombat === 'function') {
            Promise.resolve().then(function () { return session.exitCombat(); }).catch(function () {});
        }
        // The reference stops, clears its pause, and pulls the character out of combat.
    }

    /** The reference's death block: respawn, wait for it, then follow the bot's own setting. */
    async function handleDeath() {
        if (session && typeof session.setSpawnPoint === 'function') {
            try {
                await session.setSpawnPoint();
            } catch (error) {
                // SetSpawnPoint is one of the loader surface's own rows (#48), so a session that
                // cannot set it has a reason worth reading - an unattached bridge, a window that
                // went away - and the wait below still runs, as the reference's own block does.
                log('death: could not set the spawn point: ' + message(error));
            }
        }
        await waitUntil(async function () {
            const alive = await read('alive');
            return alive.ok && alive.value === true;
        }, {
            prerequisite: async function () {
                if (!running) return false;
                const signed = await read('signedIn');
                return signed.ok && signed.value === true;
            },
            timeout: 10
        });
        await sleep(1000);
        // RestartUponDeath -> 0, otherwise one step back (the loop's own increment undoes it).
        index = config && config.RestartUponDeath ? 0 : indexOf(index - 1);
    }

    /** The reference's relogin block: relog in and start over, or stop. */
    async function handleDisconnect() {
        log('disconnected. Last cmd: [' + index + ']' + (lastCommand === null ? '' : lastCommand));
        if (!(config && config.AutoRelogin)) {
            stop();
            return;
        }
        const config_ = config;
        if (typeof deps.relogin !== 'function') {
            // Auto-relogin is a setting this build cannot honour without the relogin ticket (#35):
            // stopping is the honest answer, not a silently ignored setting.
            log('auto-relogin is on but no relogin is wired in yet (#35); stopping');
            stop();
            return;
        }
        await deps.relogin(config_);
        if (!running) return;
        index = 0;
        log('relogin success.');
    }

    async function tick() {
        if (!running) return { ok: false, error: ERRORS.stopped };

        const signed = await read('signedIn');
        const alive = await read('alive');

        if (signed.ok && signed.value === true && alive.ok && alive.value === false) {
            await handleDeath();
        }

        if (signed.ok && signed.value === false) {
            await handleDisconnect();
            if (!running) return { ok: true, stopped: true };
        }

        // A reload, or a character that is not in the world: a pause, with the index held. A
        // window that has gone away for good is not a pause - it is the end of that window's bot.
        const ready = await read('ready');
        if (!ready.ok || ready.value !== true) {
            if (!ready.ok && ready.windowGone) {
                log('the game window went away; stopping this window\'s bot: ' + ready.error);
                stop();
                return { ok: true, stopped: true };
            }
            paused = true;
            if (!ready.ok) log('paused: ' + ready.error);
            else log('paused: ' + PAUSE_NEEDED);
            await sleep(PAUSE_POLL_MS);
            return { ok: true, paused: true };
        }
        paused = false;

        const at = readIndex();
        const command = commands()[at];
        if (!command) {
            log('nothing to run at ' + at + '; starting from the top');
            index = 0;
            return { ok: true };
        }
        lastCommand = catalog.rowText(command);

        const className = catalog.classNameOf(command);
        dispatched.push({ index: at, className: className });
        const handler = handlers[className];
        if (!handler) {
            log(className + ' is not implemented yet (#38-#42); skipping it');
        } else {
            const outcome = await Promise.resolve(handler(context(), command));
            if (typeof outcome === 'string') log(className + ': ' + outcome);
        }

        if (!running) return { ok: true, stopped: true };

        const delay = config ? Number(config.BotDelay) || 0 : 0;
        const skipGate = config && config.SkipDelayIndexIf;
        if (delay > 0 && (!skipGate || requiresDelay(command))) await sleep(delay);
        if (!running) return { ok: true, stopped: true };

        setIndex(index + 1);
        return { ok: true };
    }

    /** The reference's Activate loop, over tick(). Cancellation is the running flag. */
    async function run() {
        while (running) {
            await tick();
        }
    }

    /**
     * Bot.Start, plus the two refusals the reference's UI makes before it (chkEnableBot_CheckedChanged:
     * an empty list or nobody signed in, and ActiveBotEngine's own "already running").
     * @returns {Promise<{ok: boolean, error?: string}>}
     */
    async function start(bot) {
        if (running) return { ok: false, error: ERRORS.alreadyRunning };
        const parsed = bots.configuration(bot);
        const list = Array.isArray(parsed.Commands) ? parsed.Commands : [];
        if (!list.length) return { ok: false, error: ERRORS.empty };
        if (!session) return { ok: false, error: ERRORS.noSession };

        const signed = await read('signedIn');
        if (!signed.ok) return { ok: false, error: signed.error };
        if (signed.value !== true) return { ok: false, error: ERRORS.notSignedIn };

        const name = await read('username');
        username = name.ok && name.value !== null && name.value !== undefined ? String(name.value) : '';

        document = bot;
        config = parsed;
        index = 0;
        running = true;
        paused = false;
        lastCommand = null;
        dispatched = [];
        return { ok: true };
    }

    return {
        start: start,
        stop: stop,
        run: run,
        /** One pass of the loop, the seam the tests drive. */
        tick: tick,
        /** The injected session, so a caller can hand its own reads back to the window. */
        session: session,
        running: function () { return running; },
        paused: function () { return paused; },
        index: function () { return index; },
        setIndex: setIndex,
        /** The commands the loop has run, in order: the reference keeps only the last. */
        dispatched: function () { return dispatched; },
        lastCommand: function () { return lastCommand; },
        /** The reference keeps its index private; a test that has to place the bot needs it. */
        commands: commands,
        vars: function () { return vars; },
        ints: function () { return ints; },
        resolve: resolve,
        waitUntil: waitUntil,
        /** The classes this engine executes; everything else is reported by name. */
        handlers: function () { return handlers; }
    };
}

module.exports = {
    createEngine: createEngine,
    ERRORS: ERRORS,
    NO_DELAY: NO_DELAY,
    requiresDelay: requiresDelay,
    evaluate: evaluate,
    DEFAULT_INTERVAL_MS: DEFAULT_INTERVAL_MS,
    PAUSE_POLL_MS: PAUSE_POLL_MS
};
