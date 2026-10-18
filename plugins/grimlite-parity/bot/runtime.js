// One independent bot per game window (#37, spec #19's concurrency ruling).
//
// The reference is single-client by construction - its engine is a singleton and its variable
// dictionaries are static - so it cannot answer what two windows do to each other. Spec #19 rules
// it: N windows means N independent bots, with no cross-window state and no coordination. This
// module is that ruling made concrete: a registry keyed by the game window the caller is acting
// for, each entry owning its own engine, session and document.
//
// Nothing here is shared between entries. The engine keeps its variables, ints, index and running
// flag per instance (see engine.js), so a second bot cannot see or move the first one's state.
//
// The one thing that is NOT per-window today is the game access itself: the platform's bridge
// channel (#28, res/platform/bridge-channel.js) resolves the game window per call as "the most
// recently created window this plugin says is its game", so two bots in two windows read the same
// window's state. That is a bridge-channel property, not a bot-engine one; this module takes the
// session per window so the day the channel can be scoped, only the caller of createRuntime
// changes. It is named in docs/FLASH_CHECKLIST.md under this ticket.

/**
 * The registry of per-window bots.
 *
 * @param {object} deps
 * @param {(key: string) => object} deps.createSession  the injected game session for that window
 * @param {(key: string) => object} [deps.createGame]   the item and quest access for that window
 *                                                      (bot/items.js); without one those commands
 *                                                      report that this window has no game access
 * @param {(ms: number) => Promise<void>} [deps.sleep]  pacing, shared by every entry
 * @param {(line: string) => void} [deps.log]
 */
const items = require('./items.js');

function createRuntimeManager(deps) {
    deps = deps || {};
    const entries = new Map();

    function keyOf(key) {
        return key === undefined || key === null || key === '' ? 'default' : String(key);
    }

    /** The entry for one window, made on first use. */
    function forWindow(key) {
        const id = keyOf(key);
        let entry = entries.get(id);
        if (entry) return entry;

        const engine = require('./engine.js').createEngine({
            session: deps.createSession(id),
            // The item and quest vocabulary (#39), built on this window's own game access so a
            // command acts on the game the bot is driving rather than on whichever one is nearest.
            handlers: deps.createGame ? items.handlers(deps.createGame(id)) : {},
            sleep: deps.sleep,
            log: deps.log
        });
        entry = {
            key: id,
            engine: engine,
            document: null,
            /** The loop's own promise while it runs, so a caller can wait for it to end. */
            loop: null
        };
        entries.set(id, entry);
        return entry;
    }

    /**
     * Start this window's bot on the document it was given. The document is the parsed .gbot
     * itself, so a command that writes a Configuration key (CmdBotDelay) edits the very document
     * the editor is holding - the reference behaves the same way with the form's own copy.
     */
    async function start(key, bot) {
        const entry = forWindow(key);
        // One wording for this refusal: the engine's own ERRORS.alreadyRunning, so a window says
        // the same thing whichever layer caught it.
        if (entry.engine.running()) {
            return { ok: false, error: require('./engine.js').ERRORS.alreadyRunning };
        }
        const result = await entry.engine.start(bot);
        if (!result.ok) return result;
        entry.document = bot;
        // The loop runs on its own; nothing awaits it except the tests and stop().
        entry.loop = Promise.resolve(entry.engine.run()).catch(function (error) {
            if (deps.log) deps.log('the bot loop ended: ' + ((error && error.message) || error));
        });
        return result;
    }

    /** Stop this window's bot, on demand or because its window is going away. */
    async function stop(key) {
        const id = keyOf(key);
        const entry = entries.get(id);
        if (!entry) return { ok: true, stopped: false };
        entry.engine.stop();
        if (entry.loop) {
            await entry.loop;
            entry.loop = null;
        }
        return { ok: true, stopped: true };
    }

    /**
     * The window is gone. Its bot stops and its state is dropped: a new window gets a new bot,
     * and nothing from the closed one can leak into it.
     */
    async function windowClosed(key) {
        const id = keyOf(key);
        if (!entries.has(id)) return { ok: true, stopped: false };
        await stop(id);
        entries.delete(id);
        return { ok: true, stopped: true };
    }

    /** What the window shows: this bot's own running flag, pause, index and current command. */
    function state(key) {
        const entry = entries.get(keyOf(key));
        if (!entry) {
            return { running: false, paused: false, index: 0, lastCommand: null, commands: 0 };
        }
        return {
            running: entry.engine.running(),
            paused: entry.engine.paused(),
            index: entry.engine.index(),
            lastCommand: entry.engine.lastCommand(),
            commands: entry.engine.commands().length
        };
    }

    /** Await the window's loop ending; a test's way to let a bot finish. */
    function idle(key) {
        const entry = entries.get(keyOf(key));
        return entry && entry.loop ? entry.loop : Promise.resolve();
    }

    return {
        forWindow: forWindow,
        start: start,
        stop: stop,
        windowClosed: windowClosed,
        state: state,
        idle: idle,
        /** The windows that have a bot entry, for a caller reporting on them. */
        windows: function () { return Array.from(entries.keys()); }
    };
}

module.exports = {
    createRuntimeManager: createRuntimeManager
};
