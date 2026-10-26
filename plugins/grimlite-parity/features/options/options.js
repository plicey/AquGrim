// The option toggles' main-process half: hold the user's own ticks, push each one into the game,
// and keep pushing the ones the reference keeps pushing on a loop.
//
// Selected values resume on launch and are retried as the game becomes ready. Explicit pause
// remains temporary; only the user's ticks and walkspeed value are saved.

const toggles = require('./toggles.js');
const { createGameCalls } = require('../../game-calls.js');

const STORE_NAMESPACE = 'options';

function defaultTimers() {
    return {
        setInterval: function (fn, ms) {
            const timer = setInterval(fn, ms);
            timer.unref();
            return timer;
        },
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
    let generation = 0;
    let busy = false;
    let fastBusy = false;
    let stopped = false;
    let manuallyPaused = false;
    const isReady = deps.isReady || async function () {
        const connected = await gameCalls.call('getGameObject', ['sfc.isConnected']);
        if (!connected.ok || connected.value !== true) return false;
        // The socket connects before the player has loaded; callbacks alone are not readiness.
        const player = await gameCalls.call('getGameObject', ['world.myAvatar.uid']);
        return player.ok && Number(player.value) > 0;
    };
    // OptionsManager.Timer: numOptionsTimer_ValueChanged writes it; the default is 1000.
    let timerMs = toggles.LOOP_MS;
    // BotManager's "Respawn Provoke": the reference's loop skips provoke while it is ticked.
    let respawnProvoke = false;
    // The hotkey and Bot Manager still explicitly start/stop this runtime state.
    let applying = false;

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
    }

    function save() {
        if (!store) return;
        try {
            store.write({ toggles: state, walkSpeed: values.walkSpeed });
        } catch (error) {
            log('could not save the options (' + (error && error.message ? error.message : error) + ')');
        }
    }

    let skipQueue = Promise.resolve();

    async function send(toggle, on) {
        const args = toggles.argsFor(toggle, on, values);
        const name = args.length ? 'callGameFunction' : 'callGameFunction0';
        const invoke = function () { return gameCalls.call(name, [toggle.call].concat(args)); };
        const answer = await (toggle.id === 'skipCutscenes'
            ? (skipQueue = skipQueue.then(invoke, invoke)) : invoke());
        results[toggle.id] = { ok: answer.ok === true, error: answer.error || null };
        return results[toggle.id];
    }

    // Logs only transitions, so the Logs window shows where a scene stalled without per-frame noise.
    let lastSkipStatus = '';
    async function pollSkipStatus() {
        if (!state.skipCutscenes) return;
        const answer = await gameCalls.call('GetSkipCutscenesStatus', []);
        const text = answer.ok ? JSON.stringify(answer.value) : 'error: ' + answer.error;
        if (text === lastSkipStatus) return;
        lastSkipStatus = text;
        log('skip cutscenes status ' + text);
    }

    function hasSelection() {
        return toggles.TOGGLES.some(function (toggle) { return state[toggle.id]; });
    }

    function notifyApplying() {
        if (typeof deps.onApplyingChanged !== 'function') return;
        try {
            deps.onApplyingChanged(applying);
        } catch (error) {
            log('could not update the options running state (' +
                (error && error.message ? error.message : error) + ')');
        }
    }

    async function fastPass() {
        if (fastBusy || stopped || !applying || !state.walkSpeed) return;
        fastBusy = true;
        try {
            // Readiness reads can fail or stall while world.WALKSPEED is still writable.
            await send(toggles.byId('walkSpeed'), true);
        } finally {
            fastBusy = false;
        }
    }

    async function runPass(initial) {
        if (busy || stopped || !applying || !hasSelection()) return;
        busy = true;
        const current = generation;
        function active() { return !stopped && applying && current === generation; }
        try {
            // Arm before socket/avatar readiness so first-login cutscenes are covered.
            if (state.skipCutscenes) await send(toggles.byId('skipCutscenes'), true);
            if (!active()) return;
            const available = await isReady();
            if (!active() || !available || !hasSelection()) return;
            await pollSkipStatus();
            if (state.provoke && !respawnProvoke) await send(toggles.byId('provoke'), true);
            if (initial) return;
            pass += 1;
            if (!active() || pass % 2 !== 0) return;
            // Infinite Range is a one-shot upstream, but fresh games and skills replace it.
            const ids = ['infiniteRange'].concat(toggles.SECOND_PASS_ORDER).filter(id => id !== 'skipCutscenes');
            for (let i = 0; i < ids.length && active(); i++) {
                const toggle = toggles.byId(ids[i]);
                if (state[toggle.id] || toggle.id === 'lagKiller') {
                    await send(toggle, state[toggle.id] === true);
                }
            }
        } finally {
            busy = false;
        }
    }

    function startOptionsLoop() {
        if (loop) return;
        pass = 0;
        loop = timers.setInterval(function () {
            return runPass().catch(function (error) {
                log('option loop failed: ' + (error && error.message ? error.message : error));
            });
        }, timerMs);
    }

    function stopOptionsLoop() {
        if (loop) { timers.clearInterval(loop); loop = null; }
    }

    function settleWalkSpeedLoop() {
        if (applying && !stopped && state.walkSpeed && !fastLoop) {
            fastLoop = timers.setInterval(function () {
                return fastPass().catch(function (error) {
                    log('walkspeed loop failed: ' + (error && error.message ? error.message : error));
                });
            }, toggles.WALK_SPEED.intervalMs);
        } else if ((!applying || stopped || !state.walkSpeed) && fastLoop) {
            timers.clearInterval(fastLoop);
            fastLoop = null;
        }
    }

    /** Pause and resume both clocks without changing selected values. */
    function settleLoops() {
        if (applying) startOptionsLoop();
        else stopOptionsLoop();
        settleWalkSpeedLoop();
    }

    /** The reference's OptionsManager.Start/Stop. Ticks stay as the user left them. */
    async function setApplying(wanted) {
        const next = wanted === true;
        manuallyPaused = !next;
        if (next) stopped = false;
        if (applying === next) return { ok: true, applying: applying };
        applying = next;
        generation += 1;
        settleLoops();
        notifyApplying();
        // Pausing the loop only pauses its re-apply rounds; Skip is a passive watcher and stays
        // armed while its tick is on. Resuming re-asserts it for a bridge that reconnected.
        const skipResult = applying && state.skipCutscenes && !stopped
            ? await send(toggles.byId('skipCutscenes'), true) : { ok: true };
        if (!applying) return { ok: skipResult.ok, error: skipResult.error || null, applying: false };
        // ApplySettings starts with its Provoke check, then waits before its next pass.
        await runPass(true);
        const answer = !skipResult.ok ? skipResult : state.provoke && !respawnProvoke
            ? results.provoke || { ok: true } : { ok: true };
        return { ok: answer.ok, error: answer.error || null, applying: applying };
    }

    const feature = {
        /** Move one tick, and do what the reference does for that tick. */
        setToggle: async function (id, on) {
            const toggle = toggles.byId(id);
            if (!toggle) return { ok: false, error: 'no such option: ' + id };
            const wanted = on === true;
            state[id] = wanted;
            save();
            if (wanted && !manuallyPaused && !stopped && !applying) {
                applying = true;
                settleLoops();
                notifyApplying();
            }

            let answer = { ok: true, error: null };
            if (id === 'skipCutscenes') {
                answer = await send(toggle, wanted && !stopped);
            } else if (id === 'walkSpeed') {
                // BotManager.cs:1696-1702: on, the value goes out and a 250 ms loop keeps it there;
                // off, the reference restores its own 8.
                if (wanted) {
                    answer = await send(toggle, true);
                } else {
                    answer = await gameCalls.call('callGameFunction',
                        [toggle.call, String(toggles.WALK_SPEED.restore)]);
                    results[id] = { ok: answer.ok === true, error: answer.error || null };
                }
                // The saved tick owns the fast loop as well as checkbox changes.
                settleWalkSpeedLoop();
            } else if (id === 'provoke' || id === 'enemyMagnet') {
                // OptionsManager's setters only set these two flags. ApplySettings sends them
                // while its loop runs (OptionsManager.cs:188-217).
                results[id] = { ok: true, error: null };
            } else if (wanted || toggle.callAlways) {
                // Root.cs calls these the moment the tick goes on. The five without an off call
                // in the reference send nothing on untick, so neither does this port.
                answer = await send(toggle, wanted);
            } else {
                results[id] = { ok: true, error: null };
            }

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

        /** The Bot Manager's "Enable options without starting" checkbox. */
        setApplying: setApplying,

        /** numOptionsTimer_ValueChanged: the loop's own delay, live while it runs. */
        setTimer: function (value) {
            const ms = Number(value);
            timerMs = isFinite(ms) && ms >= 100 && ms <= 10000 ? Math.round(ms) : 1000;
            if (loop) {
                generation += 1;
                stopOptionsLoop();
                startOptionsLoop();
            }
            return { ok: true, timer: timerMs };
        },

        /** chkRespawnProvoke_CheckedChanged and ApplySettings' own guard. */
        setRespawnProvoke: function (on) {
            respawnProvoke = on === true;
            return { ok: true, respawnProvoke: respawnProvoke };
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

        /** Resume only selected values; no running flag or migration is needed. */
        attach: function () {
            load();
            stopped = false;
            if (!manuallyPaused) {
                applying = hasSelection();
                settleLoops();
                if (applying) notifyApplying();
            }
            if (state.skipCutscenes) {
                send(toggles.byId('skipCutscenes'), true).catch(error => log('could not arm Skip Cutscenes: ' + error.message));
            }
            return feature;
        },

        /** Give the timers back: a plugin that is stopping must not leave a loop ticking. */
        stop: function () {
            stopped = true;
            generation += 1;
            stopOptionsLoop();
            if (fastLoop) { timers.clearInterval(fastLoop); fastLoop = null; }
            const wasApplying = applying;
            applying = false;
            if (wasApplying) notifyApplying();
            return state.skipCutscenes || results.skipCutscenes
                ? send(toggles.byId('skipCutscenes'), false) : Promise.resolve();
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
