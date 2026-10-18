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
const miscCommands = require('./misc-commands.js');
const miscRules = require('./misc.js');
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
 * @param {object} [deps.packets] host.packets (send)
 * @param {(count: number) => void} [deps.beep] the shell own alert sound
 * @param {(file: string) => string} [deps.readFile] reads a bot file for CmdLoadBot
 * @param {(file: string) => boolean} [deps.exists] whether that file is there
 * @param {() => string} [deps.botsDirectory] where a relative bot path resolves
 * @param {object} [deps.spammer] the spammer window own controls (#27)
 * @param {object} [deps.timers] setTimeout/clearTimeout, injected for tests
 * @param {(line: string) => void} [deps.logDebug] the Debug pane CmdLog writes to
 * @param {() => void} [deps.logClear] the CLEAR marker own action on that pane
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
    // Bot.Configurations / Bot.OldIndex / Bot.CurrentConfiguration: the stack a load-bot
    // pushes onto and CmdReturn pops from, keyed by the configuration the loop is in.
    const configurations = {};
    const oldIndexes = {};
    let currentConfiguration = 0;
    let background = null;  // the background packet labels, while one is held

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

    // ---------------------------------------------------------------- the misc commands' seams

    /**
     * The option toggles (#34), as much of them as CmdProvoke and CmdToggleProvoke need. The
     * reference reads and writes OptionsManager.ProvokeMonsters; this build hands the same want
     * to whatever the Options window wired in, and says so when nothing is.
     */
    function options() {
        const wired = deps.options;
        if (!wired) return {};
        return {
            setProvoke: function (on) {
                if (typeof wired.setProvoke === 'function') return wired.setProvoke(on);
                if (typeof wired.setToggle === 'function') return wired.setToggle('provoke', on);
                return false;
            },
            getProvoke: function () {
                if (typeof wired.getProvoke === 'function') return wired.getProvoke();
                if (typeof wired.state === 'function') return (wired.state() || {}).provoke === true;
                return false;
            }
        };
    }

    /** Where a CmdLoadBot path resolves: the bots directory the user chose (#36). */
    function botsDirectory() {
        if (typeof deps.botsDirectory === 'function') return deps.botsDirectory() || '';
        return typeof deps.botsDirectory === 'string' ? deps.botsDirectory : '';
    }

    /** CmdLoadBot's own path resolution (bot/misc.js), over the injected file system. */
    function resolveBotFile(written, root) {
        const exists = typeof deps.exists === 'function' ? deps.exists : function (file) {
            try {
                return require('fs').statSync(file).isFile();
            } catch (error) {
                return false;
            }
        };
        return miscRules.resolveBotPath(written, root, exists);
    }

    /**
     * CmdLoadBot's own body, less the parts this build has no system for (the bank and the quest
     * list are #39's). What it does keep is the whole of the reference's own hand-over: the
     * running configuration and index are pushed onto this engine's stack, the skill preset and
     * the drop list pass or do not, and the loop restarts at the top of the loaded list. The
     * stack is per engine, so one window's load-bot cannot move another window's bot.
     */
    function loadBot(loaded, opts) {
        const wanted = opts || {};
        const list = loaded && Array.isArray(loaded.Commands) ? loaded.Commands : [];
        if (!list.length) {
            return { ok: false, error: 'that bot has no commands, so the running one is kept' };
        }
        const previous = document;
        const previousConfig = config;
        configurations[currentConfiguration] = { document: previous, config: previousConfig };
        oldIndexes[currentConfiguration] = index;
        const oldSkills = wanted.PassSkillPreset && previousConfig &&
            Array.isArray(previousConfig.Skills) && previousConfig.Skills.length
            ? previousConfig.Skills : null;
        const oldDrops = wanted.PassDropList && previousConfig && Array.isArray(previousConfig.Drops)
            ? previousConfig.Drops : null;
        if (oldSkills !== null) loaded.Skills = oldSkills;
        if (oldDrops !== null) {
            // `new HashSet<string>(newConfiguration.Drops).UnionWith(oldDropList)`: the old
            // list is merged in, so nothing the running bot was picking up is dropped.
            const merged = (Array.isArray(loaded.Drops) ? loaded.Drops : []).slice();
            oldDrops.forEach(function (drop) {
                if (merged.indexOf(drop) === -1) merged.push(drop);
            });
            loaded.Drops = merged;
        }
        document = loaded;
        config = bots.configuration(loaded);
        index = -1;  // the loop's own increment makes that the top of the new list
        currentConfiguration++;
        return { ok: true };
    }

    /**
     * CmdReturn: `int i = --instance.CurrentConfiguration`, then the configuration and the index
     * it was left at come back. Nothing on the stack is a no-op, which is what the reference's
     * own try-and-swallow does with it.
     */
    function returnToPushed() {
        if (currentConfiguration <= 0) {
            return { ok: false, error: 'this bot has not loaded another one, so there is nothing to return to' };
        }
        currentConfiguration--;
        const entry = configurations[currentConfiguration];
        const at = oldIndexes[currentConfiguration];
        if (!entry || !entry.config || !Array.isArray(entry.config.Commands) ||
            !entry.config.Commands.length || !(at > -1)) {
            return { ok: false, error: 'the configuration it would return to is not on the stack' };
        }
        document = entry.document;
        config = entry.config;
        index = at;
        return { ok: true };
    }

    // ---------------------------------------------------------------- the command handlers

    /** What a handler is given. One object keeps the vocabulary readable. */
    function context() {
        return {
            session: session,
            sleep: sleep,
            log: log,
            resolve: resolve,
            vars: vars,
            ints: ints,
            read: read,
            waitUntil: waitUntil,
            index: readIndex,
            setIndex: setIndex,
            /** A statement that does not hold skips the one command under it (Index++). */
            skipNext: function () { return setIndex(index + 1); },
            options: options,
            /** The reference own Random, injected so a test can pin a 1e stamp. */
            random: deps.random || null,
            loadBot: loadBot,
            returnToPushed: returnToPushed,
            botsDirectory: botsDirectory,
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

    // The flow vocabulary this ticket owns. A class that is not here is reported by name and
    // skipped, so a bot never hangs on a command this build cannot run yet.
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
        }
    };

    // The miscellaneous commands (#40): one table, built with its own injected
    // dependencies. Only its Cmd* members are handlers; the rest of the object is state.
    const misc = miscCommands.createHandlers({
        session: session,
        sendPacket: deps.packets && typeof deps.packets.send === 'function'
            ? function (frame) { return deps.packets.send(frame); }
            : deps.sendPacket,
        beep: deps.beep,
        spammer: deps.spammer,
        timers: deps.timers,
        sleep: sleep,
        log: log,
        logDebug: deps.logDebug,
        logClear: deps.logClear,
        file: {
            resolve: function (written, root) { return resolveBotFile(written, root); },
            read: function (file) {
                if (typeof deps.readFile !== 'function') {
                    throw new Error('this build cannot read bot files from inside a running bot');
                }
                return deps.readFile(file);
            },
            parse: bots.parseBot
        }
    });
    Object.keys(misc).forEach(function (key) {
        if (key.indexOf('Cmd') === 0) handlers[key] = misc[key];
    });
    background = misc.background;

    // The state-reading statements (#41). They take the same (ctx, command) a handler here takes,
    // so they resolve their own fields and skip the command under them the same way. Merged rather
    // than inlined so that #42's own table is a second line here and nothing else.
    Object.assign(handlers, statements.HANDLERS);

    // ---------------------------------------------------------------- the loop

    function stop() {
        if (!running) return;
        running = false;
        paused = false;
        if (background && typeof background.labels !== 'undefined') {
            background.labels.length = 0;
            if (background.timer !== null && deps.timers && typeof deps.timers.clearTimeout === 'function') {
                deps.timers.clearTimeout(background.timer);
                background.timer = null;
            }
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
        /** The loaded configuration's own lists, which CmdLoadBot passes through. */
        skills: function () { return config && Array.isArray(config.Skills) ? config.Skills : []; },
        drops: function () { return config && Array.isArray(config.Drops) ? config.Drops : []; },
        /** The background packet labels being held, in the order they were added. */
        background: function () { return background || { labels: [] }; },
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
