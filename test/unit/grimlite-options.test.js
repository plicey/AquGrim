// The seven option toggles (ticket #34). Reference: Grimlite-Li 816d9cd.
//
// Where every expected value below comes from:
//   Grimoire/UI/Root.cs:983-996        the Options menu and its item order
//   Grimoire/UI/Root.cs:1007-1104      the item labels, and the walkspeed box's default "20"
//   Grimoire/UI/Root.cs:1264-1330      the handlers, which set a flag and (for some) call at once
//   Grimoire/Botting/OptionsManager.cs:157-169  the call each toggle makes, and its argument
//   Grimoire/Botting/OptionsManager.cs:188-217  the re-apply loop: 1000 ms per pass, provoke
//                                      every pass, the rest every second pass
//   Grimoire/UI/BotManager.cs:1691-1703 the walkspeed loop (250 ms) and its restore to "8"
//   Grimoire/UI/BotManager.Designer.cs:5480-5505  numWalkSpeed: Minimum 1, Maximum 99, Value 8
//
// None of the reference's own loader-only calls (SetInfiniteRange, SetProvokeMonsters,
// SetEnemyMagnet, SetLagKiller, DestroyPlayers, SetSkipCutscenes, SetWalkSpeed) exists in the
// stock game SWF; they go out through the bridge and a refusal is reported, never swallowed.
const assert = require('assert');
const path = require('path');

const pluginRoot = path.join(__dirname, '../../plugins/grimlite-parity');
const toggles = require(path.join(pluginRoot, 'features/options/toggles.js'));
const { createOptionsFeature } = require(path.join(pluginRoot, 'features/options/options.js'));
const gameCallsModule = require(path.join(pluginRoot, 'game-calls.js'));
const { createEngine } = require(path.join(pluginRoot, 'bot/engine.js'));
const { makeCommand } = require(path.join(pluginRoot, 'bot/command-catalog.js'));

// A recorder shaped like the plugin's game-call surface (game-calls.js).
function recorder(result) {
  const calls = [];
  return {
    calls: calls,
    call: function (name, args) {
      calls.push([name, (args || []).slice()]);
      return Promise.resolve(result || { ok: true, value: null });
    }
  };
}

function memoryStore(initial) {
  let value = initial;
  return {
    read: function () { return value; },
    write: function (next) { value = next; return value; },
    readOrCreate: function (make) { if (value === undefined) value = make(); return value; }
  };
}

function fakeTimers() {
  const intervals = [];
  return {
    intervals: intervals,
    setInterval: function (fn, ms) {
      intervals.push({ fn: fn, ms: ms, cleared: false });
      return intervals.length;
    },
    clearInterval: function (id) { intervals[id - 1].cleared = true; },
    // One pass of every interval still running; the options loop is a chain of passes, so this
    // is what "the loop came round again" means here. The callback hands back its own promise,
    // so the pass is finished by the time this returns.
    pass: function () {
      return intervals.reduce(function (chain, entry) {
        if (entry.cleared) return chain;
        return chain.then(function () { return entry.fn(); });
      }, Promise.resolve());
    },
    running: function () {
      return intervals.filter(function (entry) { return !entry.cleared; });
    }
  };
}

function createOptions(deps) {
  deps = deps || {};
  const calls = deps.calls || recorder(deps.result);
  const store = deps.store || memoryStore(undefined);
  const timers = deps.timers || fakeTimers();
  const feature = createOptionsFeature({ log: function () {} }, {
    gameCalls: calls,
    isReady: deps.productionReadiness ? undefined : deps.isReady || function () { return Promise.resolve(true); },
    store: store,
    timers: timers,
    onApplyingChanged: deps.onApplyingChanged,
    log: function () {}
  });
  feature.attach();
  return { feature: feature, calls: calls, store: store, timers: timers };
}

test('the seven shipped toggles are the reference\'s, in its order, and every one ships off', () => {
  assert.deepStrictEqual(
    toggles.TOGGLES.map(function (t) { return t.label; }),
    ['Infinite Range', 'Provoke', 'Enemy Magnet', 'Lag Killer', 'Hide Players', 'Skip Cutscenes',
      'Walkspeed']
  );
  // Which toggles the reference's own loop re-applies, and where. OptionsManager.ApplySettings
  // calls provoke on every pass and the rest only on the pass whose 2000 ms mark is reached;
  // Infinite Range and Walkspeed are called once, from their own handlers.
  assert.deepStrictEqual(
    toggles.TOGGLES.filter(function (t) { return t.loop === 'each'; }).map(function (t) { return t.id; }),
    ['provoke']
  );
  assert.deepStrictEqual(
    toggles.TOGGLES.filter(function (t) { return t.loop === 'second'; }).map(function (t) { return t.id; }),
    ['enemyMagnet', 'lagKiller', 'hidePlayers', 'skipCutscenes']
  );
  assert.deepStrictEqual(toggles.SECOND_PASS_ORDER, ['enemyMagnet', 'skipCutscenes', 'hidePlayers', 'lagKiller']);
  assert.deepStrictEqual(
    toggles.TOGGLES.filter(function (t) { return !t.loop; }).map(function (t) { return t.id; }),
    ['infiniteRange', 'walkSpeed']
  );

  const fresh = toggles.defaults();
  toggles.TOGGLES.forEach(function (toggle) {
    assert.strictEqual(fresh[toggle.id], false, toggle.id + ' must ship off');
  });

  // The two items the reference built and hid (Disable Animations, Enable Options) are not
  // shipped, and neither is anything the reference declares with no call site.
  const ids = toggles.TOGGLES.map(function (t) { return t.id; });
  ['disableAnimations', 'enableOptions', 'infMana', 'buff', 'afk', 'packet'].forEach(function (dead) {
    assert.strictEqual(ids.indexOf(dead), -1, dead + ' was not shipped as a user-facing toggle');
  });
  assert.strictEqual(toggles.byId('walkSpeed').label, 'Walkspeed');
  assert.strictEqual(toggles.byId('infiniteRange').label, 'Infinite Range');
});

test('the one-shot toggles send when changed; provoke and enemy magnet wait for the loop', async () => {
  const run = createOptions();
  await run.feature.setToggle('infiniteRange', true);
  await run.feature.setToggle('provoke', true);
  await run.feature.setToggle('enemyMagnet', true);
  await run.feature.setToggle('hidePlayers', true);
  await run.feature.setToggle('skipCutscenes', true);

  // Root.cs calls these as their CheckOnClick handlers run. Provoke and Enemy Magnet only set
  // their flag there; OptionsManager.ApplySettings sends those two (OptionsManager.cs:188-217).
  assert.deepStrictEqual(run.calls.calls, [
    ['callGameFunction', ['SetInfiniteRange', true]],
    ['callGameFunction0', ['DestroyPlayers']],
    ['callGameFunction', ['SetSkipCutscenes', true]]
  ]);
  await run.feature.stop();
});

test('walkspeed carries its own value, defaulting to the reference\'s, and restores the reference\'s 8', async () => {
  // Root.cs:1104 ships the box as "20"; BotManager.cs:1702 restores "8" when the tick is removed.
  assert.strictEqual(toggles.WALK_SPEED.default, 20);
  assert.strictEqual(toggles.WALK_SPEED.restore, 8);
  assert.strictEqual(toggles.WALK_SPEED.min, 1);
  assert.strictEqual(toggles.WALK_SPEED.max, 99);
  assert.strictEqual(toggles.WALK_SPEED.intervalMs, 250);

  const run = createOptions();
  assert.strictEqual(run.feature.state().walkSpeed, 20, 'the field ships at the reference value');
  await run.feature.setToggle('walkSpeed', true);
  assert.deepStrictEqual(run.calls.calls, [['SetWalkSpeedEnabled', [true, 20]]]);

  await run.feature.setToggle('walkSpeed', false);
  assert.deepStrictEqual(run.calls.calls.slice(1), [['SetWalkSpeedEnabled', [false, 20]]]);
  await run.feature.stop();
});

test('the walkspeed value is clamped to the reference\'s field, and only applies while the tick is on', async () => {
  const run = createOptions();
  // Off: the reference's own number field is the only thing that moves (BotManager.cs:1686-1688
  // sets OptionsManager.WalkSpeed and nothing else), so nothing reaches the game.
  await run.feature.setWalkSpeed(45);
  assert.strictEqual(run.feature.state().walkSpeed, 45);
  assert.deepStrictEqual(run.calls.calls, []);

  // On: the number the user left in the field goes out, and stays out.
  await run.feature.setToggle('walkSpeed', true);
  assert.deepStrictEqual(run.calls.calls, [['SetWalkSpeedEnabled', [true, 45]]]);
  assert.strictEqual(run.feature.state().walkSpeedOn, true);

  // numWalkSpeed is a 1..99 box, so a value outside it is clamped rather than pushed through -
  // which is what the WinForms control does to the text Root.cs parses into it.
  await run.feature.setWalkSpeed(500);
  assert.strictEqual(run.feature.state().walkSpeed, 99);
  await run.feature.setWalkSpeed(0);
  assert.strictEqual(run.feature.state().walkSpeed, 1);
  await run.feature.setWalkSpeed('not a number');
  assert.strictEqual(run.feature.state().walkSpeed, 1);
  await run.feature.stop();
});

test('OptionsManager starts stopped, and Start follows Grimlite\'s immediate/one-second/two-second cadence', async () => {
  const run = createOptions();
  assert.strictEqual(run.feature.state().applying, false);
  assert.deepStrictEqual(run.timers.running(), [], 'OptionsManager starts stopped');

  await run.feature.setToggle('lagKiller', true);
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetLagKiller', 'True']]]);
  await run.feature.setToggle('enemyMagnet', true);
  await run.feature.setToggle('hidePlayers', true);
  await run.feature.setToggle('provoke', true);
  run.calls.calls.length = 0;

  // Checked options stay active through lifecycle false; the first timer pass applies Provoke.
  await run.feature.setApplying(false);
  await run.feature.setApplying(true);
  assert.deepStrictEqual(run.calls.calls, []);
  assert.strictEqual(run.feature.state().applying, true);
  assert.strictEqual(run.timers.running().length, 1);
  assert.strictEqual(run.timers.running()[0].ms, toggles.LOOP_MS);
  assert.strictEqual(toggles.LOOP_MS, 1000, 'OptionsManager.Timer ships at 1000 ms');

  run.calls.calls.length = 0;
  // The first pass reaches 1000 ms and skips the group (OptionsManager.cs:203-207).
  await run.timers.pass();
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction0', ['SetProvokeMonsters']]]);

  // The second pass reaches 2000 ms and runs the gated group in ApplySettings' order.
  run.calls.calls.length = 0;
  await run.timers.pass();
  assert.deepStrictEqual(run.calls.calls, [
    ['callGameFunction0', ['SetProvokeMonsters']],
    ['callGameFunction0', ['SetEnemyMagnet']],
    ['callGameFunction0', ['DestroyPlayers']],
    ['callGameFunction', ['SetLagKiller', 'True']]
  ]);

  await run.feature.setToggle('provoke', false);
  await run.feature.setToggle('enemyMagnet', false);
  await run.feature.setToggle('hidePlayers', false);
  run.calls.calls.length = 0;
  await run.feature.setToggle('lagKiller', false);
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetLagKiller', 'False']]]);
  assert.strictEqual(run.timers.running().length, 1, 'Start keeps running until explicitly stopped');
  await run.feature.setApplying(false);
  assert.deepStrictEqual(run.timers.running(), [], 'Stop ends only the OptionsManager loop');
});

test('numOptionsTimer changes the loop delay while it runs', async () => {
  const run = createOptions();
  await run.feature.setApplying(true);
  assert.strictEqual(run.timers.running()[0].ms, 1000);
  assert.deepStrictEqual(run.feature.setTimer(500), { ok: true, timer: 500 });
  assert.strictEqual(run.timers.running().length, 1, 'the old interval is replaced');
  assert.strictEqual(run.timers.running()[0].ms, 500);
  await run.feature.setApplying(false);
});

test('Respawn Provoke suppresses the provoke call the Options loop would make', async () => {
  const run = createOptions();
  await run.feature.setToggle('provoke', true);
  run.feature.setRespawnProvoke(true);
  run.calls.calls.length = 0;
  await run.feature.setApplying(true);
  assert.deepStrictEqual(run.calls.calls, [], 'Start sends no provoke while Respawn Provoke is on');
  await run.timers.pass();
  assert.deepStrictEqual(run.calls.calls, []);
  await run.feature.setApplying(false);
});

test('a toggle the reference never had an off call for sends nothing when switched off', async () => {
  // Root.cs:1264-1310 only sets the flag on untick for these five; the reference has no
  // "undo" call for them, so neither does this port (nothing invented in its place).
  for (const id of ['provoke', 'enemyMagnet', 'hidePlayers']) {
    const run = createOptions();
    await run.feature.setToggle(id, true);
    run.calls.calls.length = 0;
    await run.feature.setToggle(id, false);
    assert.deepStrictEqual(run.calls.calls, [], id + ' has no off call upstream');
    // ...and with the loop gone quiet, a whole pass sends nothing at all.
    await run.timers.pass();
    assert.deepStrictEqual(run.calls.calls, [], id + ' is not re-applied once unticked');
    await run.feature.stop();
  }
});

test('the walkspeed loop keeps pushing the value while the tick is on, and lets go when it is off', async () => {
  const run = createOptions();
  await run.feature.setToggle('walkSpeed', true);
  const fast = run.timers.running().filter(function (entry) {
    return entry.ms === toggles.WALK_SPEED.intervalMs;
  });
  assert.strictEqual(fast.length, 1, 'the walkspeed loop runs at the reference\'s 250 ms');

  run.calls.calls.length = 0;
  await run.timers.pass();
  assert.deepStrictEqual(run.calls.calls, [
    ['SetWalkSpeedEnabled', [true, 20]]
  ], 'the independent fast clock maintains the selected speed');

  await run.feature.setToggle('walkSpeed', false);
  assert.deepStrictEqual(run.timers.running().filter(entry => entry.ms === toggles.WALK_SPEED.intervalMs), []);
  await run.feature.stop();
});

test('a call the game refuses is reported as an answer, not as success', async () => {
  const run = createOptions({ result: { ok: false, error: 'no member SetEnemyMagnet at SetEnemyMagnet' } });
  // Infinite Range is a one-shot setter in the reference; Enemy Magnet only sets a flag and is
  // sent by the running OptionsManager loop.
  await run.feature.setToggle('infiniteRange', true);
  const state = run.feature.state();
  assert.strictEqual(state.infiniteRange, true, 'the user\'s own choice is kept either way');
  assert.strictEqual(state.results.infiniteRange.ok, false);
  assert.strictEqual(state.results.infiniteRange.error, 'no member SetEnemyMagnet at SetEnemyMagnet');
  await run.feature.stop();
});

// Every name these toggles call is one the reference loader provides and the stock game does not,
// and the two-condition check that settles it (an exact string-pool entry that some multiname
// references) is done in the module's own header. What this pins is the other half: a refusal says
// WHY, in the words the plugin's shared adapter already uses, so a user is not left with a bare
// "it failed" for a call that cannot work until the bridge grows the loader's surface.
test('a loader-only option call is refused with the shared reason, not a bare failure', async () => {
  toggles.TOGGLES.forEach(function (toggle) {
    assert.strictEqual(gameCallsModule.LOADER_ONLY[toggle.call], true,
      toggle.call + ' must be listed as a loader-only name so a refusal explains itself');
  });

  // The reason is the plugin's shared one, so both paths cannot disagree about why it failed.
  const bridge = require(path.join(pluginRoot, 'bridge.js'));
  assert.strictEqual(gameCallsModule.explain('SetWalkSpeed', new Error('no member SetWalkSpeed at SetWalkSpeed')).error,
    'no member SetWalkSpeed at SetWalkSpeed - ' + bridge.ERRORS.loaderSurface('SetWalkSpeed'));
  // A name that is NOT loader-only keeps the game's own words and adds nothing.
  assert.deepStrictEqual(gameCallsModule.explain('somethingElse', new Error('no member somethingElse at world')),
    { ok: false, error: 'no member somethingElse at world' });
});

// The same, driven through the real module rather than a stand-in: a bridge that answers the game's
// own refusal, the way the SWF's JSON comes back over the channel.
//
// Hide Players is the one name the reference loader provides that has no route to a game path (its
// body enumerates a map the generic callbacks cannot enumerate), so it is the one that still
// reports the refusal. What must never happen is a refusal being reported as a tick that worked.
test('the real game-call module explains a loader-only refusal the port cannot route', async () => {
  const asked = [];
  const gameCalls = gameCallsModule.createGameCalls({
    log: function () {},
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (name, args) {
        asked.push([name, args.slice()]);
        return Promise.resolve({
          ok: true,
          value: '{"error":"no member DestroyPlayers at DestroyPlayers"}'
        });
      }
    }
  });

  const run = createOptions({ calls: gameCalls });
  await run.feature.setToggle('hidePlayers', true);
  const result = run.feature.state().results.hidePlayers;
  assert.strictEqual(result.ok, false, 'a refused call is never reported as success');
  assert.deepStrictEqual(asked, [['callGameFunction0', ['DestroyPlayers']]],
    'nothing may be sent in place of a guess');
  assert.ok(/^no member DestroyPlayers at DestroyPlayers/.test(result.error), result.error);
  assert.ok(/own loader/.test(result.error), 'the refusal must say why: ' + result.error);
  assert.ok(/world\.avatars/.test(result.error), 'and why there is no route: ' + result.error);
  await run.feature.stop();
});

// ...and the names that DO have a route are the reference loader's own body, run through the
// generic callbacks. Lag Killer reaches the game's visible flag; the reference's string decides
// which way (Settings.as: world.visible = param1 == "False").
test('the real game-call module routes a loader-only name onto the game path it names', async () => {
  const asked = [];
  const bridge = {
    attach: function () { return Promise.resolve({ ok: true }); },
    call: function (name, args) {
      asked.push([name, args.slice()]);
      if ((args || [])[0] === 'SetLagKiller') {
        return Promise.resolve({
          ok: true,
          value: '{"error":"no member SetLagKiller at SetLagKiller"}'
        });
      }
      return Promise.resolve({ ok: true, value: 'true' });
    }
  };

  const run = createOptions({ calls: gameCallsModule.createGameCalls({ bridge: bridge, log: function () {} }) });
  await run.feature.setToggle('lagKiller', true);
  const result = run.feature.state().results.lagKiller;
  assert.strictEqual(result.ok, true, 'the loader has a body for this name, so it can be done');
  assert.deepStrictEqual(asked, [
    ['callGameFunction', ['SetLagKiller', 'True']],
    ['setGameObject', ['world.visible', false]]
  ], 'the reference name first, then the body it stands for');
  await run.feature.stop();
});

test('the ticks and the walkspeed value survive a restart', async () => {
  const store = memoryStore(undefined);
  const first = createOptions({ store: store });
  await first.feature.setToggle('skipCutscenes', true);
  await first.feature.setWalkSpeed(35);
  await first.feature.stop();

  const second = createOptions({ store: store });
  const state = second.feature.state();
  assert.strictEqual(state.skipCutscenes, true);
  assert.strictEqual(state.walkSpeed, 35);
  assert.strictEqual(state.infiniteRange, false);
  await second.feature.stop();
});

test('a persisted walkspeed tick resumes its loop on launch', async () => {
  const run = createOptions({ store: memoryStore({ toggles: { walkSpeed: true }, walkSpeed: 33 }) });
  assert.strictEqual(run.feature.state().walkSpeedOn, true);
  assert.strictEqual(run.timers.running().length, 2);
  await run.timers.pass();
  assert.ok(run.calls.calls.some(call => call[0] === 'SetWalkSpeedEnabled' && call[1][0] === true && call[1][1] === 33));
  await run.feature.setApplying(false);
  assert.strictEqual(run.timers.running().length, 2, 'checked values retain their clocks');
  await run.feature.stop();
});

test('a stored tick that no longer exists is ignored rather than fatal', async () => {
  const store = memoryStore({ toggles: { infiniteRange: true, somethingRemoved: true }, walkSpeed: 12 });
  const run = createOptions({ store: store });
  const state = run.feature.state();
  assert.strictEqual(state.infiniteRange, true);
  assert.strictEqual(state.walkSpeed, 12);
  assert.strictEqual(state.somethingRemoved, undefined);
  await run.feature.stop();
});

test('selected values survive legacy applying changes and restart', async () => {
  const store = memoryStore({ toggles: { provoke: true }, walkSpeed: 35, applying: false });
  const changes = [];
  const run = createOptions({ store, onApplyingChanged: running => changes.push(running) });
  assert.strictEqual(run.feature.state().applying, true, 'saved runtime flags are ignored');
  assert.deepStrictEqual(changes, [true]);
  await run.feature.setApplying(false);
  assert.strictEqual(run.feature.state().applying, true);
  await run.feature.setToggle('skipCutscenes', true);
  assert.strictEqual(run.feature.state().applying, true, 'a selected tick can enable the compatibility flag');
  assert.strictEqual(run.timers.running().length, 1);
  assert.strictEqual(store.read().applying, undefined);
  await run.feature.setApplying(true);
  assert.deepStrictEqual(changes, [true], 'lifecycle false does not publish a false running indicator');
  await run.feature.stop();
  const restarted = createOptions({ store });
  assert.strictEqual(restarted.feature.state().applying, true);
  assert.strictEqual(restarted.feature.state().provoke, true);
  await restarted.feature.stop();
});

test('remembered selected options activate automatically and skip later cutscenes', async () => {
  const run = createOptions({ store: memoryStore({ toggles: {
    infiniteRange: true, skipCutscenes: true, walkSpeed: true
  }, walkSpeed: 33 }) });
  assert.strictEqual(run.feature.state().applying, true);
  await run.timers.pass();
  await run.timers.pass();
  assert.ok(run.calls.calls.some(call => call[1][0] === 'SetInfiniteRange'));
  assert.ok(run.calls.calls.some(call => call[0] === 'SetWalkSpeedEnabled' && call[1][0] === true && call[1][1] === 33));
  run.calls.calls.length = 0;
  await run.timers.pass();
  await run.timers.pass();
  assert.ok(run.calls.calls.some(call => call[1][0] === 'SetSkipCutscenes'), 'later cutscenes are skipped without a new tick');
  await run.feature.setToggle('skipCutscenes', false);
  run.calls.calls.length = 0;
  await run.timers.pass();
  await run.timers.pass();
  assert.ok(!run.calls.calls.some(call => call[1][0] === 'SetSkipCutscenes'));
  await run.feature.stop();
  assert.deepStrictEqual(run.timers.running(), []);
});

test('startup waits for a connected player, retries failed setters and recovers on a fresh game', async () => {
  let connected = false;
  let uid = null;
  let failRange = true;
  const calls = [];
  const run = createOptions({
    productionReadiness: true,
    store: memoryStore({ toggles: { infiniteRange: true, walkSpeed: true }, walkSpeed: 37 }),
    calls: { call: async function (name, args) {
      calls.push([name, args]);
      if (name === 'getGameObject') return { ok: true, value: args[0] === 'sfc.isConnected' ? connected : uid };
      if (args[0] === 'SetInfiniteRange' && failRange) return { ok: false, error: 'skills not ready' };
      return { ok: true };
    } }
  });
  const writes = () => calls.filter(call => call[0] !== 'getGameObject' && call[0] !== 'SetWalkSpeedEnabled');
  await run.timers.pass();
  assert.deepStrictEqual(writes(), []);
  connected = true;
  await run.timers.pass();
  assert.deepStrictEqual(writes(), [], 'socket readiness alone is too early');
  uid = 123;
  await run.timers.pass();
  await run.timers.pass();
  assert.strictEqual(run.feature.state().results.infiniteRange.ok, false);
  failRange = false;
  await run.timers.pass();
  await run.timers.pass();
  assert.strictEqual(run.feature.state().results.infiniteRange.ok, true, 'failed one-shot is retried');
  connected = false;
  calls.length = 0;
  await run.timers.pass();
  assert.deepStrictEqual(writes(), []);
  connected = true;
  uid = 456;
  await run.timers.pass();
  await run.timers.pass();
  assert.ok(writes().some(call => call[1][0] === 'SetInfiniteRange'));
  assert.ok(calls.some(call => call[0] === 'SetWalkSpeedEnabled' && call[1][0] === true && call[1][1] === 37));
  await run.feature.stop();
});

test('restored Skip arms before readiness, ignores pause, and only untick/stop disarm it', async () => {
  const run = createOptions({
    store: memoryStore({ toggles: { skipCutscenes: true } }),
    isReady: async () => false
  });
  await new Promise(setImmediate);
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetSkipCutscenes', true]]]);
  const lastSkip = () => run.calls.calls.filter(call => call[1][0] === 'SetSkipCutscenes').at(-1);
  await run.feature.setApplying(false);
  assert.deepStrictEqual(lastSkip(), ['callGameFunction', ['SetSkipCutscenes', true]],
    'pausing the re-apply loop leaves the passive watcher armed');
  await run.feature.setApplying(true);
  assert.deepStrictEqual(lastSkip(), ['callGameFunction', ['SetSkipCutscenes', true]]);
  await run.feature.setToggle('skipCutscenes', false);
  assert.deepStrictEqual(lastSkip(), ['callGameFunction', ['SetSkipCutscenes', false]]);
  await run.feature.setToggle('skipCutscenes', true);
  await run.feature.stop();
  assert.deepStrictEqual(lastSkip(), ['callGameFunction', ['SetSkipCutscenes', false]]);
});

test('slow busy ticks drop while walkspeed continues and stop cancels remaining writes', async () => {
  let release;
  const entered = [];
  let reachedRange;
  const rangeEntered = new Promise(resolve => { reachedRange = resolve; });
  const run = createOptions({
    store: memoryStore({ toggles: { infiniteRange: true, skipCutscenes: true, walkSpeed: true } }),
    calls: { call: function (name, args) {
      if (!args.length) return Promise.resolve({ ok: true, value: null });
      entered.push(name === 'SetWalkSpeedEnabled' ? name : args[0]);
      if (args[0] === 'SetInfiniteRange' && args[1] !== false) return new Promise(resolve => { release = resolve; reachedRange(); });
      return Promise.resolve({ ok: true });
    } }
  });
  const slow = run.timers.running().find(entry => entry.ms === toggles.LOOP_MS);
  const fast = run.timers.running().find(entry => entry.ms === toggles.WALK_SPEED.intervalMs);
  await slow.fn();
  entered.length = 0;
  const pending = slow.fn();
  await rangeEntered;
  assert.strictEqual(typeof release, 'function', 'the slow pass reaches its deferred write');
  for (let i = 0; i < 20; i++) { await slow.fn(); await fast.fn(); }
  assert.deepStrictEqual(entered, ['SetSkipCutscenes', 'SetInfiniteRange'].concat(Array(20).fill('SetWalkSpeedEnabled')),
    'slow ticks drop while the independent fast timer continues');
  await run.feature.setToggle('skipCutscenes', false);
  const stopping = run.feature.stop();
  release({ ok: true });
  await pending;
  await stopping;
  const beforeStop = entered.slice();
  assert.deepStrictEqual(entered, beforeStop, 'stop cancels the remaining writes');
  await slow.fn();
  await fast.fn();
  assert.deepStrictEqual(entered, beforeStop, 'stale callbacks stay cancelled');
  assert.deepStrictEqual(run.timers.running(), []);
});

test('applying=false during readiness preserves checked maintenance', async () => {
  let release;
  let defer = true;
  const run = createOptions({
    store: memoryStore({ toggles: { walkSpeed: true, skipCutscenes: true, provoke: true } }),
    isReady: () => defer ? new Promise(resolve => { release = resolve; }) : Promise.resolve(true)
  });
  const clocks = run.timers.running().slice();
  const pending = clocks[0].fn();
  await new Promise(setImmediate);
  await run.feature.setApplying(false);
  defer = false;
  release(true);
  await pending;
  assert.ok(run.calls.calls.some(call => call[1][0] === 'SetProvokeMonsters'));
  run.calls.calls.length = 0;
  await clocks[0].fn();
  await clocks[1].fn();
  assert.ok(run.calls.calls.some(call => call[0] === 'SetWalkSpeedEnabled'));
  assert.strictEqual(run.feature.state().applying, true);
  assert.strictEqual(run.timers.running().length, 2);
  await run.feature.stop();
});

test('no selected ticks means no bridge polling and native timers do not keep Node alive', async () => {
  const run = createOptions();
  await run.feature.setApplying(true);
  await run.timers.pass();
  await run.timers.pass();
  assert.deepStrictEqual(run.calls.calls, []);
  await run.feature.stop();
  const native = createOptionsFeature(null, {
    store: memoryStore({ toggles: { walkSpeed: true } }), gameCalls: recorder()
  }).attach();
  assert.strictEqual(native._loops().loop.hasRef(), false);
  assert.strictEqual(native._loops().fastLoop.hasRef(), false);
  await native.stop();
});

test('fast walkspeed ticks do not depend on slow readiness probes', async () => {
  let probes = 0;
  const run = createOptions({
    store: memoryStore({ toggles: { walkSpeed: true } }),
    isReady: async () => { probes++; return true; }
  });
  const slow = run.timers.running().find(entry => entry.ms === toggles.LOOP_MS);
  const fast = run.timers.running().find(entry => entry.ms === toggles.WALK_SPEED.intervalMs);
  await fast.fn();
  assert.strictEqual(run.calls.calls.length, 1, 'speed writes before the first slow probe');
  await slow.fn();
  for (let i = 0; i < 4; i++) await fast.fn();
  assert.strictEqual(probes, 1);
  assert.strictEqual(run.calls.calls.length, 5, 'only the fast clock maintains walkspeed');
  await run.feature.stop();
});

test('untick during readiness cancels Skip and a fresh tick starts automatic skipping', async () => {
  let release;
  let defer = true;
  const run = createOptions({
    store: memoryStore({ toggles: { skipCutscenes: true } }),
    isReady: () => defer ? new Promise(resolve => { release = resolve; }) : Promise.resolve(true)
  });
  const slow = run.timers.running()[0];
  const pending = slow.fn();
  await new Promise(setImmediate);
  await run.feature.setToggle('skipCutscenes', false);
  release(true);
  await pending;
  assert.deepStrictEqual(run.calls.calls.at(-1), ['callGameFunction', ['SetSkipCutscenes', false]], 'unticking disarms the watcher even while readiness is pending');
  defer = false;
  await run.feature.stop();

  const fresh = createOptions();
  await fresh.feature.setToggle('skipCutscenes', true);
  fresh.calls.calls.length = 0;
  await fresh.timers.pass();
  await fresh.timers.pass();
  assert.ok(fresh.calls.calls.some(call => call[1][0] === 'SetSkipCutscenes'));
  await fresh.feature.stop();
});

test('room speed resets recover even when readiness occupies every fast tick', async () => {
  let world = { WALKSPEED: 8, myAvatar: { uid: 123 } };
  let connected = true;
  let release;
  let defer = false;
  let probing;
  const writes = [];
  const calls = gameCallsModule.createGameCalls({ bridge: {
    attach: async () => ({ ok: true }),
    call: async function (name, args) {
      if (name === 'getGameObject') {
        if (args[0] === 'sfc.isConnected') {
          if (defer) await new Promise(resolve => { release = resolve; probing(); });
          return { ok: true, value: JSON.stringify(connected) };
        }
        assert.strictEqual(args[0], 'world.myAvatar.uid');
        return { ok: true, value: JSON.stringify(world.myAvatar.uid) };
      }
      assert.strictEqual(name, 'SetWalkSpeedEnabled');
      world.WALKSPEED = args[0] ? args[1] : 8;
      writes.push(world.WALKSPEED);
      return { ok: true, value: JSON.stringify(args[1]) };
    }
  } });
  const run = createOptions({ calls, productionReadiness: true,
    store: memoryStore({ toggles: { walkSpeed: true }, walkSpeed: 37 }) });
  const slow = run.timers.running().find(entry => entry.ms === toggles.LOOP_MS);
  const fast = run.timers.running().find(entry => entry.ms === toggles.WALK_SPEED.intervalMs);
  await slow.fn();
  await fast.fn();
  assert.strictEqual(world.WALKSPEED, 37, 'saved selection applies through the real route');
  world.WALKSPEED = 8;
  await fast.fn();
  assert.strictEqual(world.WALKSPEED, 37, 'normal room resets recover on the fast clock');
  defer = true;
  for (const replaceWorld of [false, true]) {
    if (replaceWorld) world = { WALKSPEED: 8, myAvatar: { uid: 456 } };
    else world.WALKSPEED = 8; // World.cellSetup resets the speed without disconnecting.
    const before = writes.length;
    const probeEntered = new Promise(resolve => { probing = resolve; });
    const pending = slow.fn();
    await probeEntered;
    for (let i = 0; i < 4; i++) await fast.fn();
    assert.strictEqual(writes.length, before + 4, 'fast ticks continue during the slow probe');
    release();
    release = null;
    await pending;
    assert.strictEqual(world.WALKSPEED, 37, 'the ready slow pass must recover a reset without a fast tick');
    assert.strictEqual(run.feature.state().walkSpeedOn, true);
  }
  defer = false;
  connected = false;
  world.WALKSPEED = 8;
  await slow.fn();
  await fast.fn();
  assert.strictEqual(world.WALKSPEED, 37, 'a false socket read does not block a callable setter');
  connected = true;
  world.myAvatar.uid = null;
  await slow.fn();
  await fast.fn();
  assert.strictEqual(world.WALKSPEED, 37, 'a missing avatar does not block a callable setter');
  world.myAvatar.uid = 456;
  await slow.fn();
  assert.strictEqual(world.WALKSPEED, 37);
  await run.feature.setApplying(false);
  world.WALKSPEED = 8;
  await slow.fn();
  await fast.fn();
  assert.strictEqual(world.WALKSPEED, 37, 'applying=false cannot suppress room recovery');
  await run.feature.stop();
});

test('walkspeed retries the real setter despite failed readiness and a pending slow probe', async () => {
  let speed = 8;
  let reply = 'false';
  let release;
  let defer = false;
  let probing;
  const calls = gameCallsModule.createGameCalls({ bridge: {
    attach: async () => ({ ok: true }),
    call: async (name, args) => {
      if (name === 'getGameObject') {
        if (defer) await new Promise(resolve => { release = resolve; probing(); });
        return { ok: true, value: reply };
      }
      assert.strictEqual(name, 'SetWalkSpeedEnabled');
      speed = args[0] ? args[1] : 8;
      return { ok: true, value: 'true' };
    }
  } });
  const run = createOptions({ calls, productionReadiness: true,
    store: memoryStore({ toggles: { walkSpeed: true }, walkSpeed: 37 }) });
  const slow = run.timers.running().find(entry => entry.ms === toggles.LOOP_MS);
  const fast = run.timers.running().find(entry => entry.ms === toggles.WALK_SPEED.intervalMs);
  for (const value of ['false', 'null', '{"error":"no member sfc at sfc.isConnected"}', 'true']) {
    reply = value;
    await slow.fn();
    speed = 8;
    await fast.fn();
    assert.strictEqual(speed, 37, 'room reset recovers with readiness reply ' + value);
  }
  defer = true;
  const probeEntered = new Promise(resolve => { probing = resolve; });
  const pending = slow.fn();
  await probeEntered;
  speed = 8;
  await fast.fn();
  assert.strictEqual(speed, 37, 'a pending readiness probe cannot starve walkspeed');
  await run.feature.setApplying(false);
  speed = 8;
  await fast.fn();
  assert.strictEqual(speed, 37, 'applying=false leaves the fast clock independent');
  defer = false;
  release();
  await pending;
  await run.feature.stop();
});

test('fast walkspeed drops busy ticks without queuing and respects untick and stop', async () => {
  let release;
  let writes = 0;
  let defer = true;
  const run = createOptions({
    store: memoryStore({ toggles: { walkSpeed: true } }),
    calls: { call: async (name, args) => {
      writes++;
      if (defer) return new Promise(resolve => { release = resolve; });
      return { ok: true };
    } }
  });
  const fast = run.timers.running().find(entry => entry.ms === toggles.WALK_SPEED.intervalMs);
  const pending = fast.fn();
  for (let i = 0; i < 20; i++) await fast.fn();
  assert.strictEqual(writes, 1, 'at most one fast write is in flight');
  defer = false;
  const untick = run.feature.setToggle('walkSpeed', false);
  assert.strictEqual(writes, 1, 'untick waits so an older enable cannot rearm upkeep');
  release({ ok: true });
  await Promise.all([pending, untick]);
  assert.strictEqual(writes, 2, 'untick restores native speed after the pending enable');
  await fast.fn();
  assert.strictEqual(writes, 2, 'untick cancels stale ticks and no dropped ticks are queued');
  await run.feature.setToggle('walkSpeed', true);
  const resumed = run.timers.running().find(entry => entry.ms === toggles.WALK_SPEED.intervalMs);
  await resumed.fn();
  assert.strictEqual(writes, 4, 'retick resumes direct and periodic writes');
  await run.feature.stop();
  await resumed.fn();
  assert.strictEqual(writes, 5, 'stop disarms native upkeep and cancels stale ticks');
});

test('Skip resume arms even while an older readiness probe is still blocked', async () => {
  let release;
  const run = createOptions({
    store: memoryStore({ toggles: { skipCutscenes: true } }),
    isReady: () => new Promise(resolve => { release = resolve; })
  });
  const pending = run.timers.running()[0].fn();
  await new Promise(setImmediate);
  await run.feature.setApplying(false);
  await run.feature.setApplying(true);
  assert.deepStrictEqual(run.calls.calls.at(-1), ['callGameFunction', ['SetSkipCutscenes', true]]);
  await run.feature.stop();
  assert.deepStrictEqual(run.calls.calls.at(-1), ['callGameFunction', ['SetSkipCutscenes', false]]);
  release(true);
  await pending;
  assert.deepStrictEqual(run.calls.calls.at(-1), ['callGameFunction', ['SetSkipCutscenes', false]]);
});

test('Skip enable and untick are serialized so a slow enable cannot outlive disable', async () => {
  let release;
  const entered = [];
  const run = createOptions({ calls: { call: async function (name, args) {
    entered.push(args[1]);
    if (args[1] === true) await new Promise(resolve => { release = resolve; });
    return { ok: true };
  } } });
  const enable = run.feature.setToggle('skipCutscenes', true);
  await new Promise(setImmediate);
  const disable = run.feature.setToggle('skipCutscenes', false);
  await new Promise(setImmediate);
  assert.deepStrictEqual(entered, [true], 'disable waits for the outstanding enable');
  release();
  await Promise.all([enable, disable]);
  assert.deepStrictEqual(entered, [true, false]);
  await run.feature.stop();
});


test('real engine stop preserves all checked options through readiness loss and recreated game recovery', async () => {
  let connected = false;
  let game = {};
  let uid = null;
  const attempts = [];
  const selected = Object.fromEntries(toggles.TOGGLES.map(t => [t.id, true]));
  const run = createOptions({ productionReadiness: true,
    store: memoryStore({ toggles: selected, walkSpeed: 37 }),
    calls: { call: async (name, args) => {
      if (name === 'getGameObject') return { ok: true,
        value: args[0] === 'sfc.isConnected' ? connected : uid };
      if (name === 'GetSkipCutscenesStatus') return { ok: true, value: {} };
      attempts.push(name === 'SetWalkSpeedEnabled' ? name : args[0]);
      if (!connected) return { ok: false, error: 'disconnected' };
      if (args[0] === 'DestroyPlayers') return { ok: false, error: 'NO_ROUTE DestroyPlayers' };
      game[name === 'SetWalkSpeedEnabled' ? name : args[0]] = args[1] === undefined ? true : args[1];
      return { ok: true };
    } }
  });
  const lifecycle = [];
  // main.js exposes these methods, deliberately no stop: exercise engine options().stop fallback.
  const engine = createEngine({
    session: { signedIn: async () => true, username: async () => 'Tester' },
    options: {
      setApplying: on => { lifecycle.push(on); return run.feature.setApplying(on); },
      setToggle: (id, on) => run.feature.setToggle(id, on),
      state: () => run.feature.state()
    }
  });
  await run.timers.pass();
  assert.strictEqual(run.feature.state().results.skipCutscenes.ok, false);
  assert.strictEqual(run.feature.state().results.walkSpeed.ok, false);
  for (const event of ['room', 'map', 'relogin']) {
    connected = true;
    uid = 123;
    assert.strictEqual((await engine.start({ Commands: [makeCommand('CmdBlank', {})] })).ok, true);
    engine.stop();
    assert.strictEqual(engine.running(), false);
    assert.deepStrictEqual(lifecycle.slice(-2), [true, false], 'real stop reaches the fallback');
    assert.strictEqual(run.feature.state().applying, true, 'checked clocks keep the indicator enabled');
    connected = false;
    uid = null;
    game = {}; // Recreated game loses all previously applied settings.
    attempts.length = 0;
    await run.timers.pass();
    assert.ok(attempts.includes('SetSkipCutscenes'), 'Skip arms before readiness');
    assert.ok(attempts.includes('SetWalkSpeedEnabled'), 'fast writes retry without readiness');
    assert.ok(!attempts.includes('SetInfiniteRange'), 'slow settings wait for the socket');
    connected = true;
    attempts.length = 0;
    await run.timers.pass();
    assert.ok(!attempts.includes('SetInfiniteRange'), 'socket alone is not player readiness');
    uid = 456;
    attempts.length = 0;
    await run.timers.pass();
    await run.timers.pass();
    for (const t of toggles.TOGGLES) {
      assert.ok(attempts.includes(t.id === 'walkSpeed' ? 'SetWalkSpeedEnabled' : t.call), event + ': retry ' + t.id);
      assert.strictEqual(run.feature.state()[t.id === 'walkSpeed' ? 'walkSpeedOn' : t.id], true);
      assert.strictEqual(run.feature.state().results[t.id].ok, t.id !== 'hidePlayers', t.id);
      if (t.id !== 'hidePlayers') assert.ok(game[t.id === 'walkSpeed' ? 'SetWalkSpeedEnabled' : t.call], event + ': restore ' + t.id);
    }
    assert.strictEqual(game.SetWalkSpeedEnabled, 37);
    assert.strictEqual(run.feature.state().results.hidePlayers.error, 'NO_ROUTE DestroyPlayers');
    assert.deepStrictEqual(run.store.read(), { toggles: selected, walkSpeed: 37 });
  }
  await run.feature.stop();
  attempts.length = 0;
  await run.timers.pass();
  assert.deepStrictEqual(attempts, []);
  assert.deepStrictEqual(run.store.read().toggles, selected);
});

test('rejected status and per-setting writes report errors without blocking later options', async () => {
  let reject = true;
  const writes = [];
  const selected = Object.fromEntries(toggles.TOGGLES.map(t => [t.id, true]));
  const run = createOptions({ store: memoryStore({ toggles: selected }),
    calls: { call: async (name, args) => {
      if (name === 'GetSkipCutscenesStatus') throw new Error('status rejected');
      writes.push(name === 'SetWalkSpeedEnabled' ? name : args[0]);
      if (reject && ['SetSkipCutscenes', 'SetProvokeMonsters', 'SetInfiniteRange', 'SetEnemyMagnet', 'DestroyPlayers', 'SetWalkSpeedEnabled'].includes(name === 'SetWalkSpeedEnabled' ? name : args[0])) throw new Error(args[0] + ' rejected');
      return { ok: true };
    } }
  });
  await new Promise(setImmediate);
  await run.timers.pass();
  await run.timers.pass();
  for (const t of toggles.TOGGLES) assert.ok(writes.includes(t.id === 'walkSpeed' ? 'SetWalkSpeedEnabled' : t.call), 'attempt ' + t.id);
  assert.strictEqual(run.feature.state().results.enemyMagnet.error, 'SetEnemyMagnet rejected');
  assert.strictEqual(run.feature.state().results.lagKiller.ok, true);
  reject = false;
  await run.timers.pass();
  await run.timers.pass();
  for (const t of toggles.TOGGLES) assert.strictEqual(run.feature.state().results[t.id].ok, true, t.id);
  await run.feature.stop();
});


test('real engine stop during pending Skip status preserves checks; feature teardown cancels remaining writes', async () => {
  let release;
  const writes = [];
  const selected = Object.fromEntries(toggles.TOGGLES.map(t => [t.id, true]));
  const run = createOptions({ store: memoryStore({ toggles: selected }),
    calls: { call: async (name, args) => {
      if (name === 'GetSkipCutscenesStatus') return new Promise(resolve => { release = resolve; });
      writes.push(args.slice());
      return { ok: true };
    } }
  });
  const engine = createEngine({
    session: { signedIn: async () => true, username: async () => 'Tester' },
    options: {
      setApplying: on => run.feature.setApplying(on),
      setToggle: (id, on) => run.feature.setToggle(id, on),
      state: () => run.feature.state()
    }
  });
  assert.strictEqual((await engine.start({ Commands: [makeCommand('CmdBlank', {})] })).ok, true);
  const pending = run.timers.running()[0].fn();
  await new Promise(setImmediate);
  assert.strictEqual(typeof release, 'function');
  engine.stop();
  assert.strictEqual(run.feature.state().applying, true);
  await run.feature.stop();
  assert.strictEqual(run.feature.state().applying, false);
  assert.ok(writes.some(args => args[0] === 'SetSkipCutscenes' && args[1] === false));
  const before = writes.slice();
  release({ ok: true, value: {} });
  await pending;
  await run.timers.pass();
  assert.deepStrictEqual(writes, before, 'pending status cannot resume writes after teardown');
  assert.deepStrictEqual(run.timers.running(), []);
});


test('main adapters preserve selected options and the Bot Manager walk value across real engine stop', async () => {
  const fs = require('fs');
  const os = require('os');
  const { createPluginHost } = require('../../res/platform/plugin-host.js');
  const runtimeModule = require(path.join(pluginRoot, 'bot/runtime.js'));
  const optionsModule = require(path.join(pluginRoot, 'features/options/options.js'));
  const managerModule = require(path.join(pluginRoot, 'features/bot-manager/bot-manager.js'));
  const originals = [runtimeModule.createRuntimeManager, optionsModule.createOptionsFeature, managerModule.createBotManager];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aqugrim-options-lifecycle-'));
  const timers = fakeTimers();
  let runtime, feature, manager;
  let speed = 8;
  const writes = [];
  const method = require('../helpers/as3-method.js');
  const native = fs.readFileSync(path.join(pluginRoot, 'bridge/AquaBridge.as'), 'utf8');
  const listeners = new Set();
  const movie = { world: {
    get WALKSPEED() { return speed; },
    set WALKSPEED(value) { speed = value; writes.push(['world.WALKSPEED', value]); }
  }, addEventListener: (type, fn) => listeners.add(fn), removeEventListener: (type, fn) => listeners.delete(fn) };
  const watcher = { game: movie, walkSpeedEnabled: false, walkSpeed: 20, walkRoot: null,
    toJson: JSON.stringify, jsonError: error => JSON.stringify({ error: error.message }),
    aqSetWalkSpeedEnabled: method(native, 'aqSetWalkSpeedEnabled', 'enabled,speed'),
    onWalkSpeedFrame: method(native, 'onWalkSpeedFrame', 'event') };
  watcher.onWalkSpeedFrame = watcher.onWalkSpeedFrame.bind(watcher);
  const nativeFrame = () => { for (const listener of listeners) listener({}); };
  const host = createPluginHost({
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8')),
    pluginRoot, appVersion: '2.0.0', appDataDirectory: directory,
    log: () => {}, deps: { startGameOrigin: async () => 'http://127.0.0.1:41234' }
  });
  // Only the Flash boundary is simulated; main.js supplies both real option adapters.
  host.bridge.attach = async () => ({ ok: true });
  host.bridge.call = async (name, args) => {
    let value = null;
    if (name === 'SetWalkSpeedEnabled') return { ok: true, value: watcher.aqSetWalkSpeedEnabled(args[0], args[1]) };
    if (name === 'getGameObject') value = args[0] === 'sfc.isConnected' ? true
      : args[0] === 'world.myAvatar.uid' ? 123 : args[0] === 'world.myAvatar.objData.strUsername' ? 'Tester' : null;
    else if (name === 'callGameFunction' || name === 'callGameFunction0') {
      value = { error: 'no member ' + args[0] + ' at world' };
    } else if (name === 'setGameObject') {
      writes.push(args.slice());
      if (args[0] === 'world.WALKSPEED') speed = args[1];
    }
    return { ok: true, value: JSON.stringify(value) };
  };
  runtimeModule.createRuntimeManager = deps => (runtime = originals[0](deps));
  optionsModule.createOptionsFeature = (owner, deps) => (feature = originals[1](owner, Object.assign({}, deps, { timers })));
  managerModule.createBotManager = deps => (manager = originals[2](deps));
  try {
    await require(path.join(pluginRoot, 'main.js')).activate(host);
    for (const toggle of toggles.TOGGLES) await feature.setToggle(toggle.id, true);
    await feature.setWalkSpeed(37);
    await timers.pass(); // Arm the native watcher with the selected number before resetting rooms.
    const selected = feature.state();
    const saved = JSON.parse(JSON.stringify(host.getStore('options').read()));
    const botFile = path.join(directory, 'default-options.gbot');
    fs.writeFileSync(botFile, JSON.stringify({ WalkSpeed: 8, Commands: [makeCommand('CmdBlank', {})] }));
    await manager.handle('botManagerLoad', null, [botFile]);
    assert.deepStrictEqual(host.getStore('options').read(), saved, 'loading bot defaults preserves user options');
    const engine = runtime.forWindow('game').engine;
    for (let cycle = 0; cycle < 2; cycle++) {
      assert.strictEqual((await engine.start(manager.bot())).ok, true);
      engine.stop();
      await new Promise(setImmediate);
      speed = 8; // World.cellSetup resets speed after the bot stops.
      nativeFrame(); // No JavaScript timer pass can restore this value.
      assert.strictEqual(listeners.size, 1, 'bot stop must not disarm native upkeep');
      assert.strictEqual(speed, 37, 'native frame reapplies speed after stop and room change');
      for (const toggle of toggles.TOGGLES) {
        const key = toggle.id === 'walkSpeed' ? 'walkSpeedOn' : toggle.id;
        assert.strictEqual(feature.state()[key], selected[key], key);
      }
      assert.deepStrictEqual(host.getStore('options').read(), saved, 'bot lifecycle must not rewrite saved selections');
    }
    // The Client tab sends the numeric value together with its walk checkbox.
    await manager.handle('botManagerSetting', null, ['WalkSpeedOn', { on: true, value: 53 }]);
    speed = 8;
    await timers.pass();
    assert.strictEqual(speed, 53, 'main must forward the Bot Manager walk value');
    assert.strictEqual(host.getStore('options').read().walkSpeed, 53);
    assert.strictEqual((await engine.start(manager.bot())).ok, true);
    engine.stop();
    speed = 8;
    nativeFrame();
    assert.strictEqual(speed, 53, 'the value selected in Bot Manager survives bot stop and another room');
    assert.strictEqual(host.getStore('options').read().walkSpeed, 53);
    assert.ok(writes.some(row => row[0] === 'world.WALKSPEED' && row[1] === 53));
  } finally {
    runtimeModule.createRuntimeManager = originals[0];
    optionsModule.createOptionsFeature = originals[1];
    managerModule.createBotManager = originals[2];
    if (runtime) for (const key of runtime.windows()) await runtime.windowClosed(key);
    if (feature) await feature.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
