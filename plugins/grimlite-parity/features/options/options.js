// The option toggles' main-process half: hold the user's own ticks, push each one into the game,
// and keep pushing the ones the reference keeps pushing on a loop.
//
// Reference: Grimoire/Botting/OptionsManager.cs. Its re-apply loop is why this file exists at all:
// the game drops most of these effects (a map reload, a respawn, a fresh action packet), so the
// reference re-sends them every second and, for the group behind its 2000 ms gate, every second
// pass. The two one-shot toggles are re-sent only when the user asks again.
//
// Nothing here decides for the user. A toggle moves only when a person moves it, and every call's
// answer is kept so a refusal can be shown instead of a tick that quietly did nothing.

const toggles = require('./toggles.js');
const { createGameCalls } = require('../../game-calls.js');

const STORE_NAMESPACE = 'options';

function defaultTimers() {
    return {
        setInterval: function (fn, ms) { return setInterval(fn, ms); },
        clearInterval: function (id) { clearInterval(id); }
    };
}

function clampWalkSpeed(value, fallback) {
    const number = Math.floor(Number(value));
    if (!isFinite(number)) return fallback;
    return Math.max(toggles.WALK_SPEED.min, Math.min(toggles.WALK_SPEED.max, number));
}

/**
 * @param {object} host the plugin Host (kept for logging)
 * @param {object} [deps]
 * @param {object} [deps.gameCalls] see game-calls.js
 * @param {object} [deps.store] host.getStore('options'), or a stand-in under test
 * @param {object} [deps.timers] setInterval/clearInterval, injected so tests need no wall clock
 */
function createOptionsFeature(host, deps) {
    deps = deps || {};
    const log = typeof deps.log === 'function'
        ? deps.log
        : (host && typeof host.log === 'function' ? function (m) { host.log(m); } : function () {});
    const gameCalls = deps.gameCalls || createGameCalls({ bridge: host && host.bridge, log: log });
    const store = deps.store || null;
    const timers = deps.timers || defaultTimers();

    let state = toggles.defaults();
    const values = { walkSpeed: toggles.WALK_SPEED.default };
    const results = {};
    let loop = null;
    let fastLoop = null;
    let pass = 0;
    // The reference's master switch over its own loop (OptionsManager.Start/Stop, which the
    // hidden "Enable Options" item and the "Toggle Options" hotkey both flip). Ticks and the
    // walkspeed value are the user's; so is this, and it has to be stored with them. The reference
    // can keep it in memory because *its* ticks reset on every launch (they are static bools), so
    // there is nothing to resume; here the ticks outlive the app, and a restart that quietly
    // re-sent them after the user pressed "Stop applying" would undo the user's own choice.
    let applying = true;

    function load() {
        if (!store) return;
        let stored;
        try {
            // readOrCreate, not read: the store's read throws while the file does not exist yet.
            stored = store.readOrCreate(function () { return {}; }) || {};
        } catch (error) {
            // A store that will not parse is not a reason for the window to lose its defaults.
            log('could not read the stored options (' + (error && error.message ? error.message : error) + ')');
            return;
        }
        const saved = stored.toggles && typeof stored.toggles === 'object' ? stored.toggles : {};
        toggles.TOGGLES.forEach(function (toggle) {
            if (saved[toggle.id] !== undefined) state[toggle.id] = saved[toggle.id] === true;
        });
        values.walkSpeed = clampWalkSpeed(stored.walkSpeed, values.walkSpeed);
        if (stored.applying !== undefined) applying = stored.applying === true;
    }

    function save() {
        if (!store) return;
        try {
            store.write({ toggles: state, walkSpeed: values.walkSpeed, applying: applying });
        } catch (error) {
            log('could not save the options (' + (error && error.message ? error.message : error) + ')');
        }
    }

    function anyOn() {
        return toggles.TOGGLES.some(function (toggle) { return state[toggle.id] === true; });
    }

    async function send(toggle, on) {
        const args = toggles.argsFor(toggle, on, values);
        const name = args.length ? 'callGameFunction' : 'callGameFunction0';
        const answer = await gameCalls.call(name, [toggle.call].concat(args));
        results[toggle.id] = { ok: answer.ok === true, error: answer.error || null };
        return results[toggle.id];
    }

    async function eachPass() {
        // ApplySettings' pass body: provoke while the tick is on (OptionsManager.cs:199-202).
        if (state.provoke) await send(toggles.byId('provoke'), true);
        pass += 1;
        // ...then its own gate: the group below runs on every second pass (OptionsManager.cs:205).
        if (pass % 2 !== 0) return;
        for (let i = 0; i < toggles.SECOND_PASS_ORDER.length; i++) {
            const toggle = toggles.byId(toggles.SECOND_PASS_ORDER[i]);
            // Lag killer is called with its current value every pass either way; the rest only
            // while their tick is on.
            const lagKiller = toggle.id === 'lagKiller';
            if (state[toggle.id] || lagKiller) await send(toggle, state[toggle.id] === true);
        }
    }

    async function fastPass() {
        if (!state.walkSpeed) return;
        await send(toggles.byId('walkSpeed'), true);
    }

    function startLoops() {
        if (!applying) return;
        if (anyOn() && !loop) {
            pass = 0;
            // The callback returns its own promise: setInterval does not care, and a test that
            // drives the loop by hand can wait for the pass it just started.
            loop = timers.setInterval(function () {
                return eachPass().catch(function (error) {
                    log('option loop failed: ' + (error && error.message ? error.message : error));
                });
            }, toggles.LOOP_MS);
        }
        if (state.walkSpeed && !fastLoop) {
            fastLoop = timers.setInterval(function () {
                return fastPass().catch(function (error) {
                    log('walkspeed loop failed: ' + (error && error.message ? error.message : error));
                });
            }, toggles.WALK_SPEED.intervalMs);
        }
    }

    function stopLoops() {
        if (loop) { timers.clearInterval(loop); loop = null; }
        if (fastLoop) { timers.clearInterval(fastLoop); fastLoop = null; }
    }

    /** The loops the current ticks ask for: the slow one while any toggle is on, the fast one
     * only while walkspeed is on (so a plain toggle going off does not stop the walkspeed push). */
    function settleLoops() {
        if (!applying) { stopLoops(); return; }
        if (!state.walkSpeed && fastLoop) { timers.clearInterval(fastLoop); fastLoop = null; }
        if (anyOn()) startLoops();
        else stopLoops();
    }

    /** The reference's Start/Stop over the option loop. The ticks stay as the user left them. */
    async function setApplying(wanted) {
        applying = wanted === true;
        save();
        settleLoops();
        if (!applying) return { ok: true, applying: false };
        // Start() applies the current state straight away, which is the one pass a user expects
        // to see the moment they switch it back on.
        const answer = await eachPassOnce();
        return { ok: answer.ok, error: answer.error || null, applying: true };
    }

    /** One immediate pass of everything currently on, in the loop's own order. */
    async function eachPassOnce() {
        if (state.provoke) await send(toggles.byId('provoke'), true);
        for (let i = 0; i < toggles.SECOND_PASS_ORDER.length; i++) {
            const toggle = toggles.byId(toggles.SECOND_PASS_ORDER[i]);
            if (state[toggle.id] || toggle.id === 'lagKiller') await send(toggle, state[toggle.id] === true);
        }
        if (state.walkSpeed) await send(toggles.byId('walkSpeed'), true);
        return { ok: true, error: null };
    }

    const feature = {
        /** Move one tick, and do what the reference does for that tick. */
        setToggle: async function (id, on) {
            const toggle = toggles.byId(id);
            if (!toggle) return { ok: false, error: 'no such option: ' + id };
            const wanted = on === true;
            state[id] = wanted;
            save();

            let answer = { ok: true, error: null };
            if (id === 'walkSpeed') {
                // BotManager.cs:1696-1702: on, the value goes out and a 250 ms loop keeps it there;
                // off, the reference restores its own 8.
                if (wanted) {
                    answer = await send(toggle, true);
                } else {
                    answer = await gameCalls.call('callGameFunction',
                        [toggle.call, String(toggles.WALK_SPEED.restore)]);
                    results[id] = { ok: answer.ok === true, error: answer.error || null };
                }
            } else if (wanted || toggle.callAlways) {
                // Root.cs calls these the moment the tick goes on. The five without an off call
                // in the reference send nothing on untick, so neither does this port.
                answer = await send(toggle, wanted);
            } else {
                results[id] = { ok: true, error: null };
            }

            settleLoops();
            return { ok: answer.ok === true, error: answer.error || null, state: state[id] };
        },

        /** The walkspeed field. Clamped to the reference's own 1..99 numeric box. */
        setWalkSpeed: async function (value) {
            values.walkSpeed = clampWalkSpeed(value, values.walkSpeed);
            save();
            // numWalkSpeed is disabled while the tick is on (BotManager.cs:1693), so a new number
            // only ever arrives while the tick is off: it is remembered and nothing is sent, which
            // is what Root.cs's own box does when the tick is unticked.
            return { ok: true, value: values.walkSpeed };
        },

        /** The "Toggle Options" action: the reference's OptionsManager Start/Stop. */
        toggleApplying: function () {
            return setApplying(!applying);
        },

        /** Everything the window needs to draw itself. */
        state: function () {
            const snapshot = { applying: applying, results: {} };
            toggles.TOGGLES.forEach(function (toggle) {
                snapshot[toggle.id] = state[toggle.id] === true;
                snapshot.results[toggle.id] = results[toggle.id] || { ok: true, error: null };
            });
            // The walkspeed tick and the walkspeed number are two different things for the window,
            // so the number wins the name the field has in the reference and the tick sits beside it.
            snapshot.walkSpeedOn = snapshot.walkSpeed;
            snapshot.walkSpeed = values.walkSpeed;
            return snapshot;
        },

        /**
         * Start the loops the stored state asks for. Called when the window opens, so a restart
         * resumes the user's own ticks (the reference re-applies nothing until it is running).
         */
        attach: function () {
            load();
            settleLoops();
            return feature;
        },

        /** Give the timers back: a plugin that is stopping must not leave a loop ticking. */
        stop: function () {
            stopLoops();
            return Promise.resolve();
        },

        /** @internal test seam */
        _loops: function () { return { loop: loop, fastLoop: fastLoop, pass: pass }; }
    };

    return feature;
}

module.exports = {
    createOptionsFeature: createOptionsFeature,
    STORE_NAMESPACE: STORE_NAMESPACE,
    clampWalkSpeed: clampWalkSpeed
};
