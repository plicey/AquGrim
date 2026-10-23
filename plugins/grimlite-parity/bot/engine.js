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

// Class names older Grimlite/Grimoire files still carry. They run through the modern handler
// with the same meaning; the two quest commands moved their id into a Quest object.
const LEGACY_ALIASES = {
    CmdAcceptQuest2: 'CmdAcceptQuest',
    CmdCompleteQuest2: 'CmdCompleteQuest',
    CmdBotDelay2: 'CmdBotDelay',
    CmdStopBotWithMessage: 'CmdStop'
};

const LEGACY_QUEST_COMMANDS = {
    CmdAcceptQuest2: true,
    CmdCompleteQuest2: true
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
 * @param {object} [deps.handlers]   a second vocabulary to dispatch: the feature tickets' own
 *                                   command classes (items and quests today), keyed the same way.
 *                                   A key the engine already handles is left alone, so a feature
 *                                   table can never replace the loop's own behaviour.
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
 * @param {(text: string) => void} [deps.popup] the shell own modal, for CmdPing
 * @param {(line: string) => void} [deps.log]
 */
function createEngine(deps) {
    deps = deps || {};
    const session = deps.session;
    const sleep = deps.sleep || function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };
    const log = deps.log || function () {};
    // The item and quest access (#39), for the flow commands that need a quest row or an accept
    // rather than a whole command. Absent in a build with no game access, in which case the
    // quest branches report that rather than pretending to run.
    const game = deps.game || null;
    const now = typeof deps.now === 'function' ? deps.now : function () { return Date.now(); };

    let running = false;
    let paused = false;
    let externallyPaused = false;
    let index = 0;
    let document = null;      // the parsed .gbot, mutated the way the editor mutates it
    let editorControls = {};  // the form-only values (invent on start, quest delay, auto-correct)
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
    // CmdStop carries KeepLagkiller, which Bot.Stop applies after the bot has stopped.
    let keepLagKiller = false;
    // The drop frame subscription Bot.Start adds and Bot.Stop releases.
    let dropRelease = null;
    // The quest-list background loop and the initial ghost-accept pass each hold their own token.
    let questListToken = null;
    let questInitToken = null;
    const questFailures = {};
    // The 10-second CheckBoosts gate (Bot.cs's _boostDelayCounter).
    let boostCheckedAt = 0;
    // CmdDelayedAnims' background task, and the pause it holds while it runs.
    const delayed = { pending: false };
    // DropStack.GetDrop's three-second per-item cooldown.
    const dropCooldowns = {};

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
        return String(value).split('[').join('').split(']').join('').split("'").join('');
    }

    /**
     * Bot.ResolveVars: substitute {PLAYERNAME}, then walk [key] references up to five depths,
     * then evaluate the result if it is arithmetic. A key that is not defined is left as written
     * and reported, which is what the reference does (AppendDebug "Key for [x] not found").
     */
    function resolve(value) {
        let result = String(value === undefined || value === null ? '' : value)
            .replace(/\{PLAYERNAME\}/g, username);
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
        const wired = deps.options || {};
        return {
            setProvoke: function (on) {
                if (typeof wired.setProvoke === 'function') return wired.setProvoke(on);
                if (typeof wired.setToggle === 'function') return wired.setToggle('provoke', on);
                return undefined;
            },
            getProvoke: function () {
                if (typeof wired.getProvoke === 'function') return wired.getProvoke();
                if (typeof wired.state === 'function') return (wired.state() || {}).provoke === true;
                return false;
            },
            /** The reference's OptionsManager.Start/Stop. */
            setApplying: function (on) {
                if (typeof wired.setApplying === 'function') return wired.setApplying(on);
                if (typeof wired.start === 'function' && on === true) return wired.start();
                if (typeof wired.stop === 'function' && on === false) return wired.stop();
                return undefined;
            },
            stop: function () {
                if (typeof wired.stop === 'function') return wired.stop();
                if (typeof wired.setApplying === 'function') return wired.setApplying(false);
                return undefined;
            },
            state: function () {
                if (typeof wired.state === 'function') return wired.state() || {};
                return {};
            },
            setToggle: function (id, on) {
                if (typeof wired.setToggle === 'function') return wired.setToggle(id, on);
                return undefined;
            },
            /** OptionsManager.DisableAnimations, which CmdKill's AntiCounter flips. */
            getDisableAnimations: function () {
                if (typeof wired.getDisableAnimations === 'function') {
                    return wired.getDisableAnimations() === true;
                }
                return (options().state() || {}).disableAnimations === true;
            },
            setDisableAnimations: function (on) {
                if (typeof wired.setDisableAnimations === 'function') return wired.setDisableAnimations(on);
                if (typeof wired.setToggle === 'function') return wired.setToggle('disableAnimations', on);
                return undefined;
            },
            /** OptionsManager.SetLagKiller, which Bot.Stop restores from keepLagKiller. */
            setLagKiller: function (on) {
                if (typeof wired.setLagKiller === 'function') return wired.setLagKiller(on);
                if (typeof wired.setToggle === 'function') return wired.setToggle('lagKiller', on);
                return undefined;
            }
        };
    }

    /** One line of the reference's timestamped debug output, in local time. */
    function timestamp() {
        const at = new Date(now());
        const two = function (value) { return value < 10 ? '0' + value : String(value); };
        return '[' + two(at.getHours()) + ':' + two(at.getMinutes()) + ':' + two(at.getSeconds()) + ']';
    }

    /** A real macrotask yield, so an immediate test sleep cannot starve the app's timers. */
    function nextTask() {
        const set = deps.timers && typeof deps.timers.setTimeout === 'function'
            ? deps.timers.setTimeout : setTimeout;
        return new Promise(function (resolve) { set(resolve, 0); });
    }

    /** A quest row's id (QuestID in a .gbot, Id on an older writer). */
    function questIdOf(row) {
        if (!row || typeof row !== 'object') return null;
        const raw = row.QuestID === undefined || row.QuestID === null ? row.Id : row.QuestID;
        const id = Number(raw);
        return isFinite(id) ? id : null;
    }

    /** The request counter CmdStop checks before it stops. */
    function truthy(value) {
        return value === true || value === 1 || value === '1' || value === 'true' ||
            value === 'True';
    }

    // ---------------------------------------------------------------- start / stop preloads

    /** Editor-only start option; a running bot gets it from the document, never from config. */
    function inventOnStart() {
        if (editorControls.inventOnStart !== undefined) return editorControls.inventOnStart !== false;
        return !(document && document.InventOnStart === false);
    }

    /** The Bot Manager's numQuestDelay, carried on the document. */
    function questDelay() {
        if (editorControls.questDelay !== undefined) {
            const live = Number(editorControls.questDelay);
            if (isFinite(live) && live >= 0) return live;
        }
        const raw = document && (document.QuestDelay !== undefined
            ? document.QuestDelay : document.numQuestDelay);
        if (raw === undefined || raw === null || raw === '') return 1000;
        const value = Number(raw);
        return isFinite(value) && value >= 0 ? value : 1000;
    }

    /** BotManager's UnBankItems: the Items list goes back to the inventory before Start. */
    async function unbankOnStart() {
        const names = config && Array.isArray(config.Items) ? config.Items : [];
        if (!names.length || !inventOnStart()) return;
        if (!game || typeof game.transferToInventory !== 'function') return;
        for (let i = 0; i < names.length && running; i++) {
            try {
                await game.transferToInventory(String(names[i]));
            } catch (error) {
                reportOnce('unbank:' + names[i], 'could not unbank ' + names[i] + ': ' + message(error));
            }
            await sleep(200);
        }
    }

    /** The command classes BotUtilities.LoadBankItems scans for. */
    const BANK_COMMANDS = {
        CmdBankSwap: true, CmdBankTransfer: true, CmdInBank: true, CmdNotInBank: true,
        CmdInBankOrInvent: true, CmdNotInBankAndInvent: true, CmdBankList: true
    };

    /** BotUtilities.LoadBankItems: ask the bank to load when a bank command needs it. */
    async function loadBankItems() {
        if (!game || typeof game.bankItems !== 'function') return;
        const needs = commands().some(function (command) {
            return BANK_COMMANDS[catalog.classNameOf(command)] === true;
        });
        if (!needs) return;
        try {
            await game.bankItems();
        } catch (error) {
            reportOnce('bank-preload', 'could not load the bank: ' + message(error));
        }
    }

    /** Every quest id BotUtilities.LoadAllQuests collects from the command list. */
    function referencedQuestIds() {
        const ids = [];
        function add(id) {
            const value = Number(id);
            if (isFinite(value) && value !== 0 && ids.indexOf(value) === -1) ids.push(value);
        }
        commands().forEach(function (command) {
            const name = catalog.classNameOf(command);
            if (name === 'CmdAcceptQuest' || name === 'CmdCompleteQuest' ||
                name === 'CmdAcceptQuest2' || name === 'CmdCompleteQuest2') {
                const quest = command.Quest;
                add(quest && typeof quest === 'object' ? questIdOf(quest) :
                    (command.QuestID === undefined ? command.QuestId : command.QuestID));
            } else if (name === 'CmdAddQuestList') {
                add(command.Id);
            } else if (name === 'CmdQuestHunt') {
                add(command.QID);
            }
        });
        const rows = config && Array.isArray(config.Quests) ? config.Quests : [];
        rows.forEach(function (row) { add(questIdOf(row)); });
        return ids;
    }

    /**
     * BotUtilities.LoadAllQuests: load the quests the bot's commands name, in batches of 30,
     * while the loop is paused. Quests already in the tree are skipped, as upstream does.
     */
    async function loadAllQuests() {
        if (!game || typeof game.getQuests !== 'function') return;
        const wanted = referencedQuestIds();
        if (!wanted.length) return;
        let loaded = [];
        if (typeof game.questTree === 'function') {
            try {
                const tree = await game.questTree();
                loaded = (Array.isArray(tree) ? tree : []).map(questIdOf);
            } catch (error) {
                // A tree that cannot be read is not a reason to skip the load: the load is what
                // makes it readable in the first place.
            }
        }
        const list = wanted.filter(function (id) { return loaded.indexOf(id) === -1; });
        if (!list.length) return;
        const wasPaused = paused;
        paused = true;
        try {
            for (let i = 0; i < list.length && running; i += 30) {
                const batch = list.slice(i, i + 30);
                await game.getQuests(batch);
                await sleep(600);
            }
            const last = list[list.length - 1];
            for (let i = 0; i < 150 && running; i++) {
                let there = false;
                try {
                    there = (await game.hasQuest(last)) === true;
                } catch (error) {
                    there = false;
                }
                if (there) break;
                await sleep(100);
            }
        } catch (error) {
            reportOnce('quest-preload', 'could not load the quests this bot names: ' + message(error));
        } finally {
            if (!questInitToken) paused = wasPaused;
        }
    }

    /** Bot.initQuestList: ghost-accept four or more, otherwise accept each unstarted quest. */
    function startInitQuestList() {
        const rows = config && Array.isArray(config.Quests) ? config.Quests.slice() : [];
        if (!rows.length) return;
        if (!game || typeof game.hasQuest !== 'function' || typeof game.ghostAccept !== 'function') {
            reportOnce('quest-init', 'this build has no quest access, so the quest list cannot be started');
            return;
        }
        if (questInitToken) questInitToken.cancelled = true;
        const token = { cancelled: false };
        questInitToken = token;
        Promise.resolve().then(async function () {
            paused = true;
            try {
                await sleep(100);
                const total = rows.length;
                for (let i = 0; i < rows.length && !token.cancelled && running; i++) {
                    const id = questIdOf(rows[i]);
                    if (id === null) continue;
                    let has = false;
                    for (let wait = 0; wait < 15 && !token.cancelled; wait++) {
                        try {
                            has = (await game.hasQuest(id)) === true;
                        } catch (error) {
                            has = false;
                        }
                        if (has) break;
                        await sleep(500);
                    }
                    const label = String((rows[i] && (rows[i].sName || rows[i].Name)) || id);
                    if (total >= 4) {
                        log('Accepting Quest (Ghost) : ' + label + ' [' + (i + 1) + '/' + total + ']');
                        await sleep(600);
                        try {
                            await game.ghostAccept(id);
                        } catch (error) {
                            reportOnce('ghost:' + id, 'could not ghost-accept quest ' + id + ': ' + message(error));
                        }
                    } else {
                        let active = false;
                        try {
                            active = (await game.isInProgress(id)) === true;
                        } catch (error) {
                            active = false;
                        }
                        if (!active) {
                            log('Accepting Quest : ' + label + ' [' + (i + 1) + '/' + total + ']');
                            await sleep(1000);
                            try {
                                await game.accept(id);
                            } catch (error) {
                                reportOnce('accept:' + id, 'could not accept quest ' + id + ': ' + message(error));
                            }
                        } else {
                            log('Quest [' + (i + 1) + '/' + total + ']: ' + label + ' Alr accepted');
                        }
                    }
                }
            } finally {
                if (questInitToken === token) {
                    questInitToken = null;
                    paused = false;
                }
            }
        }).catch(function (error) {
            if (questInitToken === token) {
                questInitToken = null;
                paused = false;
            }
            log('starting the quest list failed: ' + message(error));
        });
    }

    /** Bot.StopQuestList. */
    function stopQuestList() {
        if (questListToken) questListToken.cancelled = true;
        questListToken = null;
        if (questInitToken) questInitToken.cancelled = true;
        questInitToken = null;
    }

    /**
     * Bot.StartQuestList: turn in the first quest that can be completed, retry five times, and
     * ghost-accept it again after a successful turn-in. The send is the item access's own
     * Complete, whose default quantity is the one the reference's Quest.Complete() uses.
     */
    function startQuestList() {
        if (questListToken) stopQuestList();
        const rows = config && Array.isArray(config.Quests) ? config.Quests.slice() : [];
        if (!rows.length) return;
        if (!game || typeof game.canComplete !== 'function' || typeof game.complete !== 'function') {
            reportOnce('quest-list', 'this build has no quest access, so the quest list cannot run');
            return;
        }
        const token = { cancelled: false };
        questListToken = token;
        Object.keys(questFailures).forEach(function (key) { delete questFailures[key]; });
        rows.forEach(function (row) {
            const id = questIdOf(row);
            if (id !== null) questFailures[String(id)] = 0;
        });
        log('QuestList Started');
        Promise.resolve().then(async function () {
            while (running && !token.cancelled) {
                const signed = await read('signedIn');
                if (!(signed.ok && signed.value === true)) break;
                let found = null;
                for (let i = 0; i < rows.length; i++) {
                    const id = questIdOf(rows[i]);
                    if (id === null) continue;
                    let done = false;
                    try {
                        done = (await game.canComplete(id)) === true;
                    } catch (error) {
                        done = false;
                    }
                    if (done) {
                        found = { row: rows[i], id: id };
                        break;
                    }
                }
                const delay = questDelay();
                await sleep(delay);
                if (token.cancelled || !running) break;
                if (!found) {
                    await nextTask();
                    continue;
                }
                const id = found.id;
                let qty = 1;
                if (found.row && found.row.SafeRelogin === true &&
                    typeof game.maximumTurnIns === 'function') {
                    qty = await game.maximumTurnIns(id).catch(function () { return 1; });
                }
                const itemId = found.row ? found.row.ItemId : undefined;
                try {
                    await game.complete(id, qty, itemId);
                } catch (error) {
                    reportOnce('complete:' + id, 'could not complete quest ' + id + ': ' + message(error));
                }
                await sleep(delay);
                let still = false;
                try {
                    still = (await game.canComplete(id)) === true;
                } catch (error) {
                    still = false;
                }
                if (still) {
                    const f = Number(questFailures[String(id)] || 0);
                    if (f >= 5) {
                        if (typeof game.logout === 'function') {
                            await game.logout().catch(function () {});
                        }
                        log(timestamp() + ' Failed to complete quest [' + id + '] ' + f + ' times.');
                    } else {
                        questFailures[String(id)] = f + 1;
                    }
                } else {
                    questFailures[String(id)] = 0;
                    // QuestCompleted -> OnQuestCompleted: ghost-accept it again after 600ms.
                    await sleep(600);
                    if (typeof game.ghostAccept === 'function' && running && !token.cancelled) {
                        await game.ghostAccept(id).catch(function (error) {
                            reportOnce('reaccept:' + id, 'could not ghost-accept quest ' + id +
                                ' again: ' + message(error));
                        });
                    }
                }
                await nextTask();
            }
        }).catch(function (error) {
            log('the quest list stopped: ' + message(error));
        }).then(function () {
            if (questListToken === token) questListToken = null;
        });
    }

    /** Bot.CheckBoosts: every ten seconds, use each configured boost that is not active. */
    async function checkBoosts() {
        const boosts = config && Array.isArray(config.Boosts) ? config.Boosts : [];
        if (!boosts.length || now() - boostCheckedAt < 10000) return;
        boostCheckedAt = now();
        if (!game || typeof game.hasActiveBoost !== 'function' ||
            typeof game.useBoost !== 'function') {
            reportOnce('boosts', 'this build has no boost access, so configured boosts cannot be used');
            return;
        }
        for (let i = 0; i < boosts.length && running; i++) {
            const boost = boosts[i] || {};
            const name = boost.sName === undefined
                ? (boost.Name === undefined ? '' : boost.Name) : boost.sName;
            const id = boost.ItemID === undefined ? boost.Id : boost.ItemID;
            if (!name || id === undefined || id === null) continue;
            try {
                if (!(await game.hasActiveBoost(String(name)))) {
                    await game.useBoost(id);
                }
            } catch (error) {
                reportOnce('boost:' + name, 'could not use boost ' + name + ': ' + message(error));
            }
        }
    }

    // ---------------------------------------------------------------- resting before a command

    /** Bot.RestHealth / RestMana: restore one bar when it is at or below its threshold. */
    async function restBar(kind) {
        const isHp = kind === 'hp';
        const current = await read(isHp ? 'health' : 'mana');
        const maximum = await read(isHp ? 'healthMax' : 'manaMax');
        if (!current.ok || !maximum.ok) {
            reportOnce('rest-' + kind, 'could not read the ' + kind + ' needed to decide whether to rest');
            return;
        }
        const max = Number(maximum.value);
        if (!(max > 0)) return;
        const threshold = isHp ? Number(config.RestHp) || 0 : Number(config.RestMp) || 0;
        if (Number(current.value) / max > threshold / 100) return;

        const wasProvoking = config.ProvokeMonsters === true;
        if (wasProvoking) config.ProvokeMonsters = false;
        try {
            if (config.ExitCombatBeforeRest) {
                const cell = await read('cell');
                const pad = await read('pad');
                if (cell.ok && pad.ok) await readN('jump', [cell.value, pad.value]);
                await sleep(2000);
            }
            const rested = await read('rest');
            if (!rested.ok) {
                reportOnce('rest-call', 'could not rest: ' + rested.error);
                return;
            }
            await waitUntil(async function () {
                const nowValue = await read(isHp ? 'health' : 'mana');
                return nowValue.ok && Number(nowValue.value) >= max;
            }, {});
        } finally {
            if (wasProvoking) config.ProvokeMonsters = true;
        }
    }

    /** Bot.Activate's two pre-command rest checks, Hp first and then Mp. */
    async function automaticRest() {
        if (config.RestIfHp) await restBar('hp');
        if (running && config.RestIfMp) await restBar('mp');
    }

    // ---------------------------------------------------------------- drops

    /** The frame's item is AC-tagged (InventoryItem.bCoins). */
    function isAcDrop(drop) {
        return truthy(drop.bCoins) || truthy(drop.IsAcItem);
    }

    function dropName(drop) {
        return String(drop.sName === undefined ? (drop.Name === undefined ? '' : drop.Name) : drop.sName).trim();
    }

    /** World.DropStack.GetDrop: the room frame, with the reference's three-second cooldown. */
    async function pickupDrop(id) {
        const key = String(id);
        const at = Number(dropCooldowns[key] || 0);
        if (now() - at < 3000) return;
        dropCooldowns[key] = now();
        let room = null;
        if (game && typeof game.roomId === 'function') {
            try {
                room = await game.roomId();
            } catch (error) {
                room = null;
            }
        }
        if (room === null) {
            const readRoom = await read('roomId');
            if (!readRoom.ok) {
                reportOnce('drop-room', 'could not pick up drop ' + id + ': ' + readRoom.error);
                return;
            }
            room = readRoom.value;
        }
        if (typeof deps.packets !== 'object' || typeof deps.packets.send !== 'function') {
            reportOnce('drop-send', 'could not pick up drop ' + id + ': this build has no packet path');
            return;
        }
        try {
            const sent = deps.packets.send({
                direction: 'toServer',
                text: '%xt%zm%getDrop%' + String(room) + '%' + String(id) + '%'
            });
            if (sent === false) throw new Error('the relay is not connected');
        } catch (error) {
            reportOnce('drop-send:' + id, 'could not pick up drop ' + id + ': ' + message(error));
        }
    }

    /** Bot.OnItemDropped plus the dropItem rejection in Flash.cs. */
    async function handleDrop(drop) {
        if (!running || !drop) return;
        const name = dropName(drop);
        const dropConfig = config;
        const shouldReject = function () {
            return running && config === dropConfig && config.EnableRejection &&
                config.Drops && !pushes(config.Drops);
        };
        const pushes = function (list) {
            return (Array.isArray(list) ? list : []).some(function (entry) {
                return String(entry).toLowerCase() === name.toLowerCase();
            });
        };
        const id = drop.ItemID === undefined ? drop.Id : drop.ItemID;

        if (config.NotifyUponDrop && pushes(config.NotifyUponDrop) && typeof deps.beep === 'function') {
            deps.beep(10);
        }
        if (config.EnablePickupAll) {
            if (id !== undefined && id !== null) await pickupDrop(id);
        } else if (config.EnablePickup && config.Drops && pushes(config.Drops)) {
            if (id !== undefined && id !== null) await pickupDrop(id);
        }
        if (config.EnablePickupAcTagged && isAcDrop(drop) && id !== undefined && id !== null) {
            await pickupDrop(id);
        }
        if (shouldReject()) {
            if (session && typeof session.rejectDrop === 'function' && id !== undefined && id !== null) {
                try {
                    await session.rejectDrop(name.toLowerCase(), id, shouldReject);
                } catch (error) {
                    reportOnce('drop-reject', 'the drop rejection was refused: ' + message(error));
                }
            }
        }
    }

    function subscribeDrops() {
        if (dropRelease || !session || typeof session.onDrop !== 'function') return;
        dropRelease = session.onDrop(function (drop) {
            handleDrop(drop).catch(function (error) {
                log('handling a drop failed: ' + message(error));
            });
        });
    }

    function unsubscribeDrops() {
        if (typeof dropRelease !== 'function') {
            dropRelease = null;
            return;
        }
        const off = dropRelease;
        dropRelease = null;
        off();
    }

    /** The carried items, from the window's game access when there is one. */
    async function inventoryRows() {
        if (game && typeof game.inventoryItems === 'function') {
            try {
                return await game.inventoryItems();
            } catch (error) {
                reportOnce('inventory', 'could not read the inventory: ' + message(error));
                return [];
            }
        }
        let list = await read('inventory');
        if (!list.ok) list = await read('items');
        return list.ok && Array.isArray(list.value) ? list.value : [];
    }

    /** BotManager.BankingItems, which CmdStop runs when BankOnStop is ticked. */
    async function bankItemsOnStop() {
        const list = await inventoryRows();
        const wanted = config && Array.isArray(config.Items) ? config.Items : [];
        for (let i = 0; i < list.length && running; i++) {
            const item = list[i] || {};
            const name = dropName(item);
            const category = String(item.sType === undefined ? item.category || '' : item.sType);
            const keep = truthy(item.bEquip) || !isAcDrop(item) || category === 'Class' ||
                name.toLowerCase() === 'treasure potion' ||
                wanted.indexOf(name) === -1;
            if (keep) continue;
            if (game && typeof game.transferToBank === 'function') {
                try {
                    await game.transferToBank(name);
                } catch (error) {
                    log('could not bank ' + name + ': ' + message(error));
                    continue;
                }
            }
            log('Transferred to Bank: ' + name);
        }
        log('Banked all AC Items in Items list');
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
        else botSkill = '';  // CmdLoadBot.cs: BotData.BotSkill = null when no preset is passed
        if (oldDrops !== null) {
            // `new HashSet<string>(newConfiguration.Drops, StringComparer.OrdinalIgnoreCase)
            // .UnionWith(oldDropList)`: the old list is merged in, so nothing the running bot was
            // picking up is dropped, and a drop named in different case is the same drop.
            const merged = (Array.isArray(loaded.Drops) ? loaded.Drops : []).slice();
            oldDrops.forEach(function (drop) {
                const seen = merged.some(function (held) {
                    return String(held).toLowerCase() === String(drop).toLowerCase();
                });
                if (!seen) merged.push(drop);
            });
            loaded.Drops = merged;
        }
        document = loaded;
        config = bots.configuration(loaded);
        index = -1;  // the loop's own increment makes that the top of the new list
        currentConfiguration++;
        // CmdLoadBot.cs reloads both caches and restarts the quest list against the new document.
        loadBankItems();
        loadAllQuests();
        startQuestList();
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
        botSkill = '';  // CmdReturn.cs: BotData.BotSkill = null
        loadBankItems();
        loadAllQuests();
        startQuestList();
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
            options: options,
            /** The reference own Random, injected so a test can pin a 1e stamp. */
            random: deps.random || null,
            loadBot: loadBot,
            returnToPushed: returnToPushed,
            botsDirectory: botsDirectory,
            config: function () { return config; },
            setConfig: function (key, value) { setConfig(document, config, key, value); },
            /** CmdDelayedAnims' own `instance.paused`, which holds the loop but not running. */
            pauseFor: function (on) { paused = on === true; },
            delayed: delayed,
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

    /**
     * A CmdInt* statement's int key: the reference first resolves a [name] through the string
     * variables, then uses the resulting text as the Configuration.Tempvalues key.
     */
    function intKey(value) {
        const written = String(value === undefined || value === null ? '' : value);
        if (!isVar(value)) return written;
        const key = getVar(value);
        return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : written;
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
     * The name is all the movie needs: it resolves the live Avatar itself and hands it to
     * world.setTarget (ticket #49). What comes back is reported as a reason for the caller to log
     * - never swallowed, never faked.
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
            let needed = Number(qty) || 1;
            // ClientConfig.AutoCorrect: an Item's own MaxStack is the ceiling, except Class items.
            const stack = Number(item.iStk === undefined ? item.MaxStack : item.iStk);
            const category = String(item.sType === undefined ? item.Category || '' : item.sType);
            if (editorControls.autoCorrect !== false && category !== 'Class' && isFinite(stack) && stack > 0 && needed > stack) {
                needed = stack;
            }
            return have >= needed;
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
    /** Is the tapped "Counter Attack" state up? A session without the tap says so once. */
    async function counterIsActive() {
        if (!session || typeof session.counterActive !== 'function') {
            reportOnce('anticounter-tap', 'AntiCounter needs the packet tap, which this session ' +
                'does not carry; the fight runs without its pause');
            return false;
        }
        const answer = await read('counterActive');
        return answer.ok && answer.value === true;
    }

    /** The previous DisableAnimations setting, or null when this build has no such seam. */
    function animationSeam() {
        const wired = deps.options || {};
        if (typeof wired.getDisableAnimations === 'function' &&
            typeof wired.setDisableAnimations === 'function') {
            return { get: function () { return wired.getDisableAnimations() === true; },
                set: function (on) { return wired.setDisableAnimations(on); } };
        }
        const state = typeof wired.state === 'function' ? wired.state() || {} : {};
        if (Object.prototype.hasOwnProperty.call(state, 'disableAnimations') &&
            typeof wired.setToggle === 'function') {
            return { get: function () { return state.disableAnimations === true; },
                set: function (on) { return wired.setToggle('disableAnimations', on); } };
        }
        return null;
    }

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

        let restoreAnimations = null;
        if (opts.antiCounter) {
            const seam = animationSeam();
            if (seam) {
                const previous = seam.get();
                await seam.set(false);
                restoreAnimations = function () { return seam.set(previous); };
            } else {
                reportOnce('anticounter-anims', 'AntiCounter could not change the animation ' +
                    'setting; this build has no DisableAnimations seam');
            }
        }

        try {
            const attacked = await attackMonster(opts.monster);
            if (!attacked.ok) return attacked.error;

            const list = config && Array.isArray(config.Skills) ? config.Skills : [];
            // CmdKill.cs rotates the whole set while the target lives; the reference has no round
            // count. `untilDead` is that loop, and the cap is only a runaway guard that reports.
            const untilDead = opts.untilDead === true;
            const rounds = untilDead ? Infinity : (opts.rounds === undefined ? 1 : opts.rounds);
            let round = 0;
            let countered = false;
            if (list.length && rounds > 0) {
                for (; round < (untilDead ? KILL_ROUND_CAP : rounds); round++) {
                    if (!running) break;
                    if (opts.antiCounter && await counterIsActive()) {
                        // The reference's handler: cancel the swing and the target as soon as the
                        // counter is announced, and leave them cancelled until the aura fades.
                        await read('cancelAutoAttack');
                        await read('cancelTargets');
                        for (let wait = 0; wait < 40 && running; wait++) {
                            if (!(await counterIsActive())) break;
                            await sleep(1000);
                        }
                        countered = true;
                        break;
                    }
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
                if (untilDead && round >= KILL_ROUND_CAP) {
                    return 'the target survived ' + KILL_ROUND_CAP + ' rotation pass(es), so the kill was stopped';
                }
            }
            if (countered) return undefined;

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
        } finally {
            if (restoreAnimations) {
                try {
                    await restoreAnimations();
                } catch (error) {
                    log('could not restore the animation setting: ' + message(error));
                }
            }
        }
    }
    /**
     * CmdKillFor's quest mode: accept until in progress, then kill until CanComplete. The two
     * questions are the loader's own and the accept is the same call CmdAcceptQuest uses.
     */
    async function killForQuest(questId, killOptions, delayAfter) {
        let accepted = false;
        for (let tries = 0; tries < QUEST_ACCEPT_TRIES && running; tries++) {
            const inProgress = await read1('questInProgress', String(questId));
            if (inProgress.ok && inProgress.value === true) { accepted = true; break; }
            if (!game || typeof game.accept !== 'function') {
                return 'killing for quest #' + questId + ' needs this build\'s quest access';
            }
            try {
                await game.accept(questId);
            } catch (error) {
                return 'could not accept quest #' + questId + ': ' + message(error);
            }
            await sleep(1000);
        }
        if (!accepted) {
            const again = await read1('questInProgress', String(questId));
            if (!(again.ok && again.value === true)) {
                return 'quest #' + questId + ' never entered progress';
            }
        }
        for (let round = 0; round < HUNT_SAFETY_ROUNDS && running; round++) {
            const done = await read1('questCanComplete', String(questId));
            if (done.ok && done.value === true) return undefined;
            const reason = await killOnce(killOptions);
            if (reason) return reason;
            await sleep(delayAfter);
        }
        const done = await read1('questCanComplete', String(questId));
        if (done.ok && done.value === true) return undefined;
        return 'quest #' + questId + ' still cannot be completed after ' +
            HUNT_SAFETY_ROUNDS + ' kill(s)';
    }

    // A feature ticket's own vocabulary (#38-#42), dispatched after this table. Kept apart so the
    // loop's flow commands cannot be shadowed by a feature that happens to name one the same.
    const extraHandlers = deps.handlers && typeof deps.handlers === 'object' ? deps.handlers : {};

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
                const resolved = varOf(written);
                // int.TryParse: an optional sign and digits, whitespace around them, Int32 only.
                const text = String(resolved).trim();
                const parsed = /^[+-]?\d+$/.test(text) ? Number(text) : NaN;
                if (Number.isInteger(parsed) && Math.abs(parsed) <= 2147483647) amount = parsed;
            }
            // Older files omit Type on the Goto form, which is the default and so was dropped
            // when the file was written. An omitted member therefore means Goto (2), not Up (0).
            const writtenType = command.Type;
            const type = writtenType === undefined || writtenType === null || writtenType === ''
                ? 2 : Number(writtenType) || 0;
            // CmdIndex.cs: Down adds (n - 1) only when that is positive AND the result is still
            // inside the list; Up subtracts (n + 1) only when the result stays at or above zero.
            // Neither branch uses the Index setter, so neither wraps.
            if (type === 1) {
                const step = amount - 1;
                if (step > 0 && index + step < commands().length) index += step;
            } else if (type === 0) {
                const step = amount + 1;
                if (step > 0 && index - step > -1) index -= step;
            } else {
                setIndex(amount - 1);
            }
        },
        CmdRestart: function () { index = -1; },
        CmdStop: async function (ctx, command) {
            if (config && config.BankOnStop) await bankItemsOnStop();
            keepLagKiller = command && command.KeepLagkiller === true;
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

        CmdSetVar: async function (ctx, command) {
            const key = String(command.Value1);
            let value = String(command.Value2 === undefined ? '' : command.Value2);
            const needsInventory = /^\{(weapon|class|nr10|helm|cape)\}$/.test(key) ||
                /\.qty$/i.test(value);
            const rows = needsInventory ? await inventoryRows() : [];
            const itemName = function (item) {
                return item ? String(item.sName === undefined
                    ? (item.Name === undefined ? '' : item.Name) : item.sName) : '';
            };
            const category = function (item) {
                return item ? String(item.sType === undefined
                    ? (item.category === undefined ? '' : item.category) : item.sType) : '';
            };
            const equipped = function (item) { return truthy(item && item.bEquip); };
            const quantity = function (item) {
                return item ? Number(item.iQty === undefined ? item.Quantity : item.iQty) || 0 : 0;
            };
            const first = function (test) {
                for (let i = 0; i < rows.length; i++) if (test(rows[i])) return rows[i];
                return null;
            };
            const WEAPONS = ['Sword', 'Axe', 'Dagger', 'Gun', 'Bow', 'Mace', 'Polearm', 'Staff', 'Wand'];
            if (key === '{weapon}') {
                const item = first(function (one) {
                    return WEAPONS.indexOf(category(one)) !== -1 && equipped(one);
                });
                value = item ? itemName(item) : 'Error';
            } else if (key === '{class}') {
                const item = first(function (one) {
                    return category(one) === 'Class' && equipped(one);
                });
                value = item ? itemName(item) : '';
            } else if (key === '{nr10}') {
                const item = first(function (one) {
                    return category(one) === 'Class' && quantity(one) < 300000;
                });
                value = item ? itemName(item) : 'Error';
            } else if (key === '{helm}') {
                const item = first(function (one) {
                    return category(one) === 'Helm' && equipped(one);
                });
                value = item ? itemName(item) : 'Error';
            } else if (key === '{cape}') {
                const item = first(function (one) {
                    return category(one) === 'Cape' && equipped(one);
                });
                value = item ? itemName(item) : 'Error';
            }
            if (/\.qty$/i.test(value)) {
                const base = value.replace(/\.qty$/i, '');
                const item = first(function (one) {
                    return itemName(one).toLowerCase() === base.toLowerCase();
                });
                value = item ? String(quantity(item)) : '0';
            } else if (value.indexOf('[') !== -1 && command.skipScan !== true) {
                value = resolve(value);
            }
            vars[key] = value;
        },
        CmdUpdateVar: function (ctx, command) {
            const key = String(command.Value1);
            if (Object.prototype.hasOwnProperty.call(vars, key)) vars[key] = command.Value2;
            else ctx.skipNext();
        },

        // The variable and integer statements (the reference's Misc.Statements int/var rows). A
        // failing one advances the index by one, which skips the command under it.
        CmdIntIs: function (ctx, command) {
            const left = ints[intKey(command.Value1)];
            const right = intOperand(command.Value2);
            if (left !== right) ctx.skipNext();
        },
        CmdIntIsNot: function (ctx, command) {
            const left = ints[intKey(command.Value1)];
            const right = intOperand(command.Value2);
            if (left === right) ctx.skipNext();
        },
        CmdIntGreaterThan: function (ctx, command) {
            const left = ints[intKey(command.Value1)];
            const right = intOperand(command.Value2);
            // CmdIntGreaterThan upstream asks "less than" and skips when that holds, so the row's
            // own text ("Int Greater Than") and its comparison disagree - reproduced as written.
            if (left < right) ctx.skipNext();
        },
        CmdIntLessThan: function (ctx, command) {
            const left = ints[intKey(command.Value1)];
            const right = intOperand(command.Value2);
            // CmdIntLessThan likewise asks "greater than" (ToString: "{V1} <= {V2}").
            if (left > right) ctx.skipNext();
        },
        CmdIntEqualInt: function (ctx, command) {
            const left = ints[intKey(command.Value1)];
            const right = ints[intKey(command.Value2)];
            if (String(left) !== String(right)) ctx.skipNext();
        },
        CmdIntNotEqualInt: function (ctx, command) {
            const left = ints[intKey(command.Value1)];
            const right = ints[intKey(command.Value2)];
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
            // CmdKill.cs rotates the whole skill set while the target lives; the caller only wraps
            // it for item/quest conditions (CmdKillFor and the hunts).
            const reason = await killOnce({
                monster: varOf(command.Monster),
                killPriority: command.KillPriority,
                antiCounter: command.AntiCounter === true,
                untilDead: true
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
                while (running) {
                    const state = await read('state');
                    if (!state.ok) {
                        reportOnce('rest-state', 'could not read the combat state to leave it');
                        break;
                    }
                    if (Number(state.value) !== 2) break;
                    const cell = await read('cell');
                    const pad = await read('pad');
                    await readN('jump', [cell.ok ? cell.value : '', pad.ok ? pad.value : '']);
                    await sleep(1250);
                    await nextTask();
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
                const index = String(resolve(command.Index));
                // `if (Skill.isBuff(Index)) Player.ForceUseSkill(Index);` - only a buff can be
                // cast without a target in this branch.
                if (session && typeof session.isBuffSkill === 'function') {
                    const buff = await read1('isBuffSkill', index);
                    if (buff.ok && buff.value === true) {
                        const cast = await read1('forceUseSkill', index);
                        return cast.ok ? undefined : cast.error;
                    }
                }
                return undefined;
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

        CmdJoin2: async function (ctx, command) {
            // Older Grimlite revisions serialize joins as CmdJoin2 with a separate Room. Its
            // 1e99 sentinel means "roll a room", the cell is entered after the map, and unlike
            // CmdJoin it does not set the spawn point here.
            const mapName = String(varOf(command.Map));
            const roomValue = varOf(command.Room);
            const rawRoom = String(roomValue === undefined ? '' : roomValue);
            const room = rawRoom === '1e99' ? String(randomJoin2Room()) : rawRoom;
            const cell = String(varOf(command.Cell));
            const pad = String(varOf(command.Pad));
            const here = await read('map');
            if (!(here.ok && String(here.value).toLowerCase() === mapName.toLowerCase())) {
                const joined = await tryJoin(mapName, room, cell, pad);
                if (!joined.ok) return joined.error;
            }
            const arrived = await read('map');
            if (!(arrived.ok && String(arrived.value).toLowerCase() === mapName.toLowerCase())) {
                return 'could not reach ' + mapName;
            }
            const at = await read('cell');
            if (!(at.ok && String(at.value).toLowerCase() === cell.toLowerCase())) {
                await readN('jump', [cell, pad]);
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
            while (running) {
                const here = await read('cell');
                if (here.ok && String(here.value).toLowerCase() === String(cell).toLowerCase()) return undefined;
                if (!here.ok) return 'could not read the cell to move from: ' + here.error;
                const moved = await readN('jump', [String(cell), String(pad)]);
                if (!moved.ok) return 'could not move to ' + cell + ': ' + moved.error;
                await sleep(500);
                await nextTask();
            }
            return 'the bot stopped before it reached ' + cell;
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

        CmdYulgar: async function (_ctx, _command) {
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
            // CmdKillFor.cs: kill until the item (or the quest) is done. The reference's own loop
            // has no bound; the safety cap below only exists so a session that never changes can
            // report instead of spinning forever in this process.
            const monster = varOf(command.Monster);
            const questId = parseInt(String(command.QuestId === undefined ? '' : command.QuestId), 10);
            const delayAfter = Number(command.DelayAfterKill === undefined ? 500 : command.DelayAfterKill) || 0;
            const killOptions = {
                monster: monster,
                killPriority: command.KillPriority,
                antiCounter: command.AntiCounter === true,
                untilDead: true
            };

            // The quest mode: accept until it is in progress, then kill until CanComplete.
            if (!isNaN(questId)) {
                return await killForQuest(questId, killOptions, delayAfter);
            }

            const itemType = Number(command.ItemType) || 0;
            const names = varOf(command.ItemName).trim();
            const quantities = varOf(command.Quantity);
            const start = await collected(names, quantities, itemType);
            if (!start.ok) return 'could not read the inventory: ' + start.error;
            if (start.value) return undefined;
            for (let round = 0; round < HUNT_SAFETY_ROUNDS && running; round++) {
                const reason = await killOnce(killOptions);
                if (reason) return reason;
                await sleep(delayAfter);
                const now = await collected(names, quantities, itemType);
                if (!now.ok) return 'could not read the inventory: ' + now.error;
                if (now.value) return undefined;
            }
            return 'stopped after ' + HUNT_SAFETY_ROUNDS + ' kill(s) without ' + names + ' ' + quantities + 'x';
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
            for (let round = 0; round < HUNT_SAFETY_ROUNDS && running; round++) {
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
            const questId = parseInt(String(command.QuestId === undefined ? '' : command.QuestId), 10);
            const delayAfter = command.DelayAfterKill === undefined ? 50 : command.DelayAfterKill;
            if (!isNaN(questId)) {
                return await killForQuest(questId, {
                    monster: varOf(command.Monster),
                    killPriority: command.KillPriority,
                    antiCounter: command.AntiCounter === true,
                    untilDead: true
                }, delayAfter);
            }
            // The reference runs its cell lock in the background while the kill-for runs: it walks
            // the cells it was given and waits out a monster in one before moving on.
            const token = { cancelled: false };
            runCellJump(ctx, token, cells, pads, cells.length, String(varOf(command.Monster)));
            const reason = await huntRounds(command, items, qty, itemType, varOf(command.Monster),
                delayAfter, command.KillPriority, command.AntiCounter);
            token.cancelled = true;
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
                    const named = String(names[i]).trim();
                    if (/^[0-9]+$/.test(named) && game && typeof game.getMapItem === 'function') {
                        // CmdQuestHunt's own branch: a numeric item name is a map item id.
                        try {
                            await game.getMapItem(Number(named));
                        } catch (error) {
                            return 'could not get map item ' + named + ': ' + message(error);
                        }
                        await waitUntil(async function () {
                            const now = await collected(names[i], quantities[i] === undefined ? '1' : quantities[i], itemType);
                            return now.ok && now.value === true;
                        }, {});
                        continue;
                    }
                    const reason = await huntRounds(command, names[i],
                        quantities[i] === undefined ? '1' : quantities[i], itemType,
                        monsters[i] === undefined ? '*' : monsters[i], 50, command.KillPriority,
                        command.AntiCounter);
                    if (reason) return reason;
                }
                return undefined;
            }
            if (!game || typeof game.quest !== 'function') {
                return 'quest hunt #' + qid + ' needs this build\'s quest access';
            }
            let row = await game.quest(qid).catch(function () { return null; });
            if (!row && typeof game.loadQuest === 'function') {
                try {
                    await game.loadQuest(qid);
                } catch (error) {
                    return 'could not load quest #' + qid + ': ' + message(error);
                }
                for (let tries = 0; tries < QUEST_ACCEPT_TRIES && !row && running; tries++) {
                    row = await game.quest(qid).catch(function () { return null; });
                    if (row) break;
                    await sleep(200);
                }
            }
            if (!row) return 'quest #' + qid + ' is not loaded, so its required items cannot be read';
            const slot = Number(row.iSlot === undefined ? row.ISlot : row.iSlot) || 0;
            const value = Number(row.iValue === undefined ? row.IValue : row.iValue) || 0;
            const oneShot = row.bOnce === true || row.IsNotRepeatable === true;
            if (slot > 0 && oneShot && typeof game.questProgress === 'function') {
                const progress = await game.questProgress(slot).catch(function () { return 0; });
                if (Number(progress) >= value) return undefined;
            }
            const inProgress = await Promise.resolve(game.isInProgress(qid)).catch(function () { return false; });
            if (!(inProgress === true)) {
                try {
                    await game.accept(qid);
                } catch (error) {
                    return 'could not accept quest #' + qid + ': ' + message(error);
                }
                await waitUntil(async function () {
                    const now = await Promise.resolve(game.isInProgress(qid)).catch(function () { return false; });
                    return now === true;
                }, {});
            } else if (typeof game.ghostAccept === 'function') {
                await game.ghostAccept(qid).catch(function () {});
            }
            const required = Array.isArray(row.reqd) ? row.reqd
                : (Array.isArray(row.RequiredItems) ? row.RequiredItems : []);
            const monsters = String(varOf(command.Monster)).split(',');
            for (let i = 0; i < required.length && running; i++) {
                const need = required[i] || {};
                const name = String(need.sName === undefined ? (need.Name === undefined ? '' : need.Name) : need.sName);
                const quantity = String(need.iQty === undefined ? (need.Quantity === undefined ? '1' : need.Quantity) : need.iQty);
                if (!name) continue;
                const held = await collected(name, quantity, Number(need.bTemp) === 1 || need.bTemp === true ? 1 : 0);
                if (held.ok && held.value) continue;
                const joined = await readN('join', [written, String(cells[0]), String(pads[0])]);
                if (!joined.ok) return 'could not reach ' + mapName + ': ' + joined.error;
                await waitUntil(async function () {
                    const now = await read('map');
                    return now.ok && String(now.value).toLowerCase() === mapName;
                }, {});
                const writtenItem = String(items.split(',')[i] === undefined ? '' : items.split(',')[i]).trim();
                if (/^[0-9]+$/.test(writtenItem) && typeof game.getMapItem === 'function') {
                    try {
                        await game.getMapItem(Number(writtenItem));
                    } catch (error) {
                        return 'could not get map item ' + writtenItem + ': ' + message(error);
                    }
                } else {
                    const reason = await huntRounds(command, name, quantity,
                        Number(need.bTemp) === 1 || need.bTemp === true ? 1 : 0,
                        monsters[i] === undefined || monsters[i] === '' ? '*' : monsters[i], 50,
                        command.KillPriority, command.AntiCounter);
                    if (reason) return reason;
                }
            }
            await sleep(500);
            const canComplete = await Promise.resolve(game.canComplete(qid)).catch(function () { return false; });
            if (canComplete === true && typeof game.complete === 'function') {
                await game.complete(qid).catch(function (error) {
                    log('quest #' + qid + ' complete failed: ' + message(error));
                });
                await waitUntil(async function () {
                    const now = await Promise.resolve(game.isInProgress(qid)).catch(function () { return false; });
                    return now === false;
                }, { interval: 600, timeout: 5 });
            }
            return undefined;
        },

        CmdFollow: async function (ctx, command) {
            // CmdFollow.cs: while the followed player is present, set the spawn and kill; when they
            // leave the map, step to Blank, wait out combat, GoToPlayer and count the tries out at
            // MaxGotoTry. The uotls tap that follows their cell live is not in this engine, so the
            // coarser GoTo loop is what runs and says so once.
            const who = String(varOf(command.PlayerName)).toLowerCase();
            const written = command.MaxGotoTry;
            const maxTry = written === 0 ? 999 : (written === undefined ? 5 : (Number(written) || 5));
            let gotoTry = 0;
            let following = true;
            let gotoDelay = 2000;
            reportOnce('follow-tap', 'following a player reads their cell off the uotls packet, ' +
                'which this engine has no tap for; the bot walks with GoTo and fights what it finds there');
            // The reference's own loop condition includes `&& (following && !WaitForever)`, so a
            // WaitForever tick stops the loop before its first pass. That is upstream behaviour.
            while (running && following && command.WaitForever !== true) {
                const alive = await read('alive');
                if (!(alive.ok && alive.value === true)) {
                    await sleep(1000);
                    continue;
                }
                const signed = await read('signedIn');
                if (!(signed.ok && signed.value === true)) break;
                const listed = await read('playersInMap');
                const names = (listed.ok && Array.isArray(listed.value) ? listed.value : []).map(function (name) {
                    return String(name).toLowerCase();
                });
                if (names.indexOf(who) === -1) {
                    await readN('jump', ['Blank', '']);
                    await waitUntil(async function () {
                        const state = await read('state');
                        return !(state.ok && Number(state.value) === 2);
                    }, {});
                    await sleep(gotoDelay);
                    const went = await read1('goTo', who);
                    if (!went.ok) return 'could not goto ' + who + ': ' + went.error;
                    gotoTry++;
                    following = gotoTry < maxTry;
                    gotoDelay = command.WaitForever === true && !following ? 10000 : 2000;
                } else {
                    gotoTry = 0;
                    await read('setSpawnPointHere');
                    const reason = await killOnce({
                        monster: '*',
                        killPriority: command.KillPriority,
                        antiCounter: command.AntiCounter === true,
                        untilDead: true
                    });
                    if (reason) return reason;
                }
                await sleep(500);
            }
            return following ? undefined : 'could not find ' + who + ' after ' + maxTry + ' goto(s)';
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
        // The auto-zone panel (#44): CmdSpecialHandler drives the Misc 2 combo through this, the
        // same way SetSpecialHandlerFromScript does. Absent in a build without the Maid's panel,
        // in which case the command reports that rather than appearing to switch a handler.
        specialHandler: deps.specialHandler,
        popup: deps.popup,
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

    // The aura, target and combat statements (#42), merged second and deliberately. The two tables
    // overlap in exactly one name, CmdNameEquals: the reference reads Player.Username, which #42's
    // ticket owns, and #41 registers it too. The ticket's own ruling is that the later ticket takes
    // it, and merging this table last is how that reads in code - the body that runs is the one
    // written against the reference's own `Equals(..., OrdinalIgnoreCase)`, which compares the
    // operands as they are rather than trimming them first.
    Object.assign(handlers, require('./statements-auras.js').handlers);
    /** How many kills one hunt command attempts before it reports rather than loops forever. */
    const HUNT_ROUNDS = 10;
    /** A runaway guard for CmdKill's own unbounded rotation; the reference has no bound. */
    const KILL_ROUND_CAP = 10000;
    /** The hunt loops are unbounded upstream; this is the safety valve that reports instead. */
    const HUNT_SAFETY_ROUNDS = 1000;
    /** How many one-second accept attempts CmdKillFor makes before giving up on a quest. */
    const QUEST_ACCEPT_TRIES = 10;
    /** And how many map joins, which is the reference's own Try shape for a hunt. */
    const HUNT_JOIN_ROUNDS = 3;

    /** The kill half both hunt commands share: kill once, then look at the item again. */
    async function huntRounds(command, names, quantities, itemType, monster, delay, killPriority, antiCounter) {
        for (let round = 0; round < HUNT_SAFETY_ROUNDS && running; round++) {
            const reason = await killOnce({
                monster: monster === undefined || monster === '' ? '*' : monster,
                killPriority: killPriority,
                antiCounter: antiCounter === true,
                untilDead: true
            });
            if (reason) return reason;
            const done = await collected(names, quantities, itemType);
            if (!done.ok) return 'could not read the inventory: ' + done.error;
            if (done.value) return undefined;
            await sleep(Number(delay) || 0);
        }
        return 'stopped after ' + HUNT_SAFETY_ROUNDS + ' kill(s) without ' + names + ' ' + quantities + 'x';
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

    /** CmdJoin2's own Room sentinel uses Random.Next(1001, 99999). */
    function randomJoin2Room() {
        return 1001 + Math.floor(Math.random() * (99999 - 1001));
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

    /** BotUtilities.StopCommands: take back the quest rows the bot's CmdAddQuestList added. */
    function removeQuestListEntries() {
        const rows = config && Array.isArray(config.Quests) ? config.Quests : null;
        if (!rows) return;
        commands().forEach(function (command) {
            if (catalog.classNameOf(command) !== 'CmdAddQuestList') return;
            const at = rows.findIndex(function (row) {
                return Number(questIdOf(row)) === Number(command.Id) &&
                    String(row && row.ItemId === undefined ? '' : row.ItemId) ===
                    String(command.ItemId === undefined ? '' : command.ItemId) &&
                    truthy(row && row.SafeRelogin) === truthy(command.SafeRelogin);
            });
            if (at !== -1) rows.splice(at, 1);
        });
    }

    /** OptionsManager.SetLagKiller(Configuration.Instance.keepLagKiller). */
    function applyKeepLagKiller() {
        // The reference's default keepLagKiller=false has nothing to restore, and a test seam
        // without a lag-killer method must not turn Stop into a game call.
        if (keepLagKiller !== true &&
            !(deps.options && typeof deps.options.setLagKiller === 'function')) return;
        const wired = options();
        let answer;
        try {
            answer = typeof wired.setLagKiller === 'function'
                ? wired.setLagKiller(keepLagKiller) : undefined;
            if (answer === undefined && session && typeof session.loaderCall === 'function') {
                answer = session.loaderCall('SetLagKiller', [keepLagKiller ? 'True' : 'False']);
            }
        } catch (error) {
            log('could not restore lag killer: ' + message(error));
            return;
        }
        Promise.resolve(answer).catch(function (error) {
            log('could not restore lag killer: ' + message(error));
        });
    }

    /** Put back the option ticks auto-relogin found, then start OptionsManager again. */
    async function restoreOptions(snapshot) {
        const wired = options();
        const ids = ['infiniteRange', 'provoke', 'lagKiller', 'skipCutscenes', 'enemyMagnet'];
        for (let i = 0; i < ids.length; i++) {
            if (snapshot && typeof snapshot[ids[i]] === 'boolean') {
                try {
                    await wired.setToggle(ids[i], snapshot[ids[i]]);
                } catch (error) {
                    log('could not restore option ' + ids[i] + ': ' + message(error));
                }
            }
        }
        if (typeof wired.setApplying === 'function') {
            try {
                await wired.setApplying(true);
            } catch (error) {
                log('could not start the options loop again: ' + message(error));
            }
        }
    }

    function stop() {
        externallyPaused = false;
        if (!running) return;
        running = false;
        paused = false;
        stopQuestList();
        unsubscribeDrops();
        if (misc && typeof misc.stopBackground === 'function') misc.stopBackground();
        removeQuestListEntries();
        // CmdMoveToCell2's background jump holds the engine's own cancellation token, and the
        // reference's Stop is what a stopped bot expects to end it.
        if (jump.token) {
            jump.token.cancelled = true;
            jump.token = null;
        }
        const wired = options();
        try {
            if (typeof wired.stop === 'function') {
                Promise.resolve(wired.stop()).catch(function () {});
            }
        } catch (error) {
            // OptionsManager.Stop is sync in the reference; a seam that throws must not keep the
            // rest of Stop from running.
        }
        applyKeepLagKiller();
        if (session && typeof session.exitCombat === 'function') {
            Promise.resolve().then(function () { return session.exitCombat(); }).catch(function () {});
        }
    }

    /** The reference's death block: respawn, wait for it, then follow the bot's own setting. */
    async function handleDeath() {
        const wired = options();
        try {
            await wired.stop();
        } catch (error) {
            // OptionsManager.Stop before respawn; a refusal is not a reason to stay dead.
        }
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
        if (typeof wired.setApplying === 'function') {
            try {
                await wired.setApplying(true);
            } catch (error) {
                log('could not restart the options loop after respawning: ' + message(error));
            }
        }
    }

    /** The reference's relogin block: relog in and start over, or stop. */
    async function handleDisconnect() {
        log(timestamp() + ' Disconnected. Last cmd: [' + index + ']' +
            (lastCommand === null ? '' : lastCommand));
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
        stopQuestList();
        if (misc && typeof misc.stopBackground === 'function') misc.stopBackground();
        if (game && typeof game.clearShops === 'function') {
            try {
                await game.clearShops();
            } catch (error) {
                log('could not clear the loaded shops: ' + message(error));
            }
        }
        const wired = options();
        const snapshot = wired.state();
        try {
            if (typeof wired.stop === 'function') await wired.stop();
            await deps.relogin(config_);
        } catch (error) {
            log('auto-relogin failed: ' + message(error));
            stop();
            return;
        }
        if (!running) return;
        index = 0;
        loadAllQuests();
        loadBankItems();
        startQuestList();
        log(timestamp() + ' Relogin success.');
        await restoreOptions(snapshot);
    }

    async function tick() {
        if (!running) return { ok: false, error: ERRORS.stopped };
        if (externallyPaused || paused) {
            await sleep(PAUSE_POLL_MS);
            return { ok: true, paused: true };
        }

        const signed = await read('signedIn');
        const alive = await read('alive');

        if (signed.ok && signed.value === true && alive.ok && alive.value === false) {
            await handleDeath();
        }

        if (signed.ok && signed.value === false) {
            await handleDisconnect();
            if (!running) return { ok: true, stopped: true };
        }

        // The reference does not pause the whole loop on a map reload: commands that need the map
        // wait for it themselves. Only a window that has gone away ends the bot.
        const ready = await read('ready');
        if (!ready.ok && ready.windowGone) {
            log('the game window went away; stopping this window\'s bot: ' + ready.error);
            stop();
            return { ok: true, stopped: true };
        }
        if (!ready.ok || ready.value !== true) {
            reportOnce('map-load', 'the map is reloading; commands that need it will wait');
        }

        // Bot.Activate rests before every command, Hp first and then Mp.
        if (config && (config.RestIfHp || config.RestIfMp)) await automaticRest();
        if (!running) return { ok: true, stopped: true };

        const at = readIndex();
        const command = commands()[at];
        if (!command) {
            log('nothing to run at ' + at + '; starting from the top');
            index = 0;
            return { ok: true };
        }
        lastCommand = catalog.rowText(command);

        const originalName = catalog.classNameOf(command);
        let className = LEGACY_ALIASES[originalName] || originalName;
        let dispatchedCommand = command;
        if (LEGACY_QUEST_COMMANDS[originalName]) {
            dispatchedCommand = Object.assign({}, command, {
                Quest: command.Quest && typeof command.Quest === 'object'
                    ? command.Quest : { QuestID: command.QuestID }
            });
        } else if (originalName === 'CmdStopBotWithMessage' && command.Message) {
            log(String(command.Message));
        }
        dispatched.push({ index: at, className: originalName });
        // The engine's own flow vocabulary first, then whatever a feature ticket registered.
        const handler = handlers[className] || extraHandlers[className];
        if (!handler) {
            log(className + ' is not implemented yet (#38-#42); skipping it');
        } else {
            const outcome = await Promise.resolve(handler(context(), dispatchedCommand));
            if (typeof outcome === 'string') log(className + ': ' + outcome);
        }

        if (!running) return { ok: true, stopped: true };

        const delay = config ? Number(config.BotDelay) || 0 : 0;
        const skipGate = config && config.SkipDelayIndexIf;
        if (delay > 0 && (!skipGate || requiresDelay(command))) await sleep(delay);
        if (!running) return { ok: true, stopped: true };

        // Bot.CheckBoosts sits after the delay and before the index increment.
        if (config && Array.isArray(config.Boosts) && config.Boosts.length) await checkBoosts();

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
    async function start(bot, editor) {
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
        editorControls = editor && typeof editor === 'object' ? editor : {};
        config = parsed;
        index = 0;
        running = true;
        paused = false;
        externallyPaused = false;
        lastCommand = null;
        dispatched = [];
        botSkill = '';
        keepLagKiller = false;
        boostCheckedAt = now();
        delayed.pending = false;
        Object.keys(dropCooldowns).forEach(function (key) { delete dropCooldowns[key]; });
        subscribeDrops();

        // Bot.Start's preloads, in its own order: the quests the commands name, the bank a bank
        // command needs, the quest list, and then the options manager. LoadAllQuests and
        // LoadBankItems are async void upstream, so Start does not wait for them.
        await unbankOnStart();
        loadAllQuests();
        loadBankItems();
        startInitQuestList();
        if (config && Array.isArray(config.Quests) && config.Quests.length) startQuestList();
        const wired = options();
        if (typeof wired.setApplying === 'function') {
            try {
                Promise.resolve(wired.setApplying(true)).catch(function (error) {
                    log('could not start the options loop: ' + message(error));
                });
            } catch (error) {
                log('could not start the options loop: ' + message(error));
            }
        }
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
        paused: function () { return paused || externallyPaused; },
        setPaused: function (on) {
            const previous = externallyPaused;
            externallyPaused = on === true;
            return previous;
        },
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
        handlers: function () { return handlers; },
        /** The feature vocabulary this engine was given, if any. */
        extraHandlers: function () { return extraHandlers; }
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
