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
    ['callGameFunction0', ['SetInfiniteRange']],
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
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetWalkSpeed', '20']]]);

  await run.feature.setToggle('walkSpeed', false);
  assert.deepStrictEqual(run.calls.calls.slice(1), [['callGameFunction', ['SetWalkSpeed', '8']]]);
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
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetWalkSpeed', '45']]]);
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

  // Pause remains explicit; Start immediately applies Provoke after checking readiness.
  await run.feature.setApplying(false);
  await run.feature.setApplying(true);
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction0', ['SetProvokeMonsters']]]);
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
  for (const id of ['infiniteRange', 'provoke', 'enemyMagnet', 'hidePlayers']) {
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
    ['callGameFunction', ['SetWalkSpeed', '20']]
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
  assert.ok(run.calls.calls.some(call => call[1][0] === 'SetWalkSpeed' && call[1][1] === '33'));
  await run.feature.setApplying(false);
  assert.deepStrictEqual(run.timers.running(), []);
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

test('selected values resume on restart while explicit pause is temporary', async () => {
  const store = memoryStore({ toggles: { provoke: true }, walkSpeed: 35, applying: false });
  const changes = [];
  const run = createOptions({ store, onApplyingChanged: running => changes.push(running) });
  assert.strictEqual(run.feature.state().applying, true, 'saved runtime flags are ignored');
  assert.deepStrictEqual(changes, [true]);
  await run.feature.setApplying(false);
  await run.feature.setToggle('skipCutscenes', true);
  assert.strictEqual(run.feature.state().applying, false, 'changing a tick respects explicit pause');
  assert.deepStrictEqual(run.timers.running(), []);
  assert.strictEqual(store.read().applying, undefined);
  await run.feature.setApplying(true);
  assert.deepStrictEqual(changes, [true, false, true]);
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
  assert.ok(run.calls.calls.some(call => call[1][0] === 'SetWalkSpeed' && call[1][1] === '33'));
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
  const writes = () => calls.filter(call => call[0] !== 'getGameObject' && call[1][0] !== 'SetWalkSpeed');
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
  assert.ok(calls.some(call => call[1][0] === 'SetWalkSpeed' && call[1][1] === '37'));
  await run.feature.stop();
});

test('restored Skip arms before readiness and untick/pause/stop disarm its native state', async () => {
  const run = createOptions({
    store: memoryStore({ toggles: { skipCutscenes: true } }),
    isReady: async () => false
  });
  await new Promise(setImmediate);
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetSkipCutscenes', true]]]);
  await run.feature.setApplying(false);
  assert.deepStrictEqual(run.calls.calls.at(-1), ['callGameFunction', ['SetSkipCutscenes', false]]);
  await run.feature.setApplying(true);
  assert.deepStrictEqual(run.calls.calls.at(-1), ['callGameFunction', ['SetSkipCutscenes', true]]);
  await run.feature.setToggle('skipCutscenes', false);
  assert.deepStrictEqual(run.calls.calls.at(-1), ['callGameFunction', ['SetSkipCutscenes', false]]);
  await run.feature.setToggle('skipCutscenes', true);
  await run.feature.stop();
  assert.deepStrictEqual(run.calls.calls.at(-1), ['callGameFunction', ['SetSkipCutscenes', false]]);
});

test('slow busy ticks drop while walkspeed continues and stop cancels remaining writes', async () => {
  let release;
  const entered = [];
  let reachedRange;
  const rangeEntered = new Promise(resolve => { reachedRange = resolve; });
  const run = createOptions({
    store: memoryStore({ toggles: { infiniteRange: true, skipCutscenes: true, walkSpeed: true } }),
    calls: { call: function (name, args) {
      entered.push(args[0]);
      if (args[0] === 'SetInfiniteRange') return new Promise(resolve => { release = resolve; reachedRange(); });
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
  assert.deepStrictEqual(entered, ['SetSkipCutscenes', 'SetInfiniteRange'].concat(Array(20).fill('SetWalkSpeed')),
    'slow ticks drop while the independent fast timer continues');
  await run.feature.setToggle('skipCutscenes', false);
  await run.feature.stop();
  const beforeStop = entered.slice();
  release({ ok: true });
  await pending;
  assert.deepStrictEqual(entered, beforeStop, 'stop cancels the remaining writes');
  await slow.fn();
  await fast.fn();
  assert.deepStrictEqual(entered, beforeStop, 'stale callbacks stay cancelled');
  assert.deepStrictEqual(run.timers.running(), []);
});

test('pause during readiness prevents writes and does not auto-resume on game readiness', async () => {
  let release;
  const run = createOptions({
    store: memoryStore({ toggles: { walkSpeed: true, skipCutscenes: true } }),
    isReady: () => new Promise(resolve => { release = resolve; })
  });
  const stale = run.timers.running().slice();
  const pending = stale[0].fn();
  await new Promise(setImmediate);
  await run.feature.setApplying(false);
  release(true);
  await pending;
  const pausedCalls = run.calls.calls.slice();
  assert.deepStrictEqual(pausedCalls.at(-1), ['callGameFunction', ['SetSkipCutscenes', false]]);
  await stale[0].fn();
  await stale[1].fn();
  assert.deepStrictEqual(run.calls.calls, pausedCalls);
  assert.strictEqual(run.feature.state().applying, false);
  assert.deepStrictEqual(run.timers.running(), []);
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
      if (args[0] === 'SetWalkSpeed') {
        return { ok: true, value: JSON.stringify({ error: 'no member SetWalkSpeed at SetWalkSpeed' }) };
      }
      assert.strictEqual(name, 'setGameObject');
      assert.strictEqual(args[0], 'world.WALKSPEED');
      world.WALKSPEED = args[1];
      writes.push(args[1]);
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
  assert.strictEqual(world.WALKSPEED, 8, 'explicit pause survives a room reset');
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
      if (args[0] === 'SetWalkSpeed') return { ok: true,
        value: '{"error":"no member SetWalkSpeed at SetWalkSpeed"}' };
      assert.strictEqual(name, 'setGameObject');
      assert.strictEqual(args[0], 'world.WALKSPEED');
      speed = args[1];
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
  assert.strictEqual(speed, 8, 'pause cancels stale fast ticks');
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
  await run.feature.setToggle('walkSpeed', false);
  assert.strictEqual(writes, 2, 'untick restores native speed');
  release({ ok: true });
  await pending;
  await fast.fn();
  assert.strictEqual(writes, 2, 'untick cancels stale ticks and no dropped ticks are queued');
  await run.feature.setToggle('walkSpeed', true);
  const resumed = run.timers.running().find(entry => entry.ms === toggles.WALK_SPEED.intervalMs);
  await resumed.fn();
  assert.strictEqual(writes, 4, 'retick resumes direct and periodic writes');
  await run.feature.stop();
  await resumed.fn();
  assert.strictEqual(writes, 4, 'stop cancels stale ticks');
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
