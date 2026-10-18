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
    store: store,
    timers: timers,
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

test('switching a toggle on sends the reference\'s own call for it', async () => {
  const run = createOptions();
  await run.feature.setToggle('infiniteRange', true);
  await run.feature.setToggle('provoke', true);
  await run.feature.setToggle('enemyMagnet', true);
  await run.feature.setToggle('hidePlayers', true);
  await run.feature.setToggle('skipCutscenes', true);

  // OptionsManager.SetInfiniteRange and its neighbours are Flash.Call(name, empty), i.e. the
  // zero-argument entry point the reference keeps apart from the one that takes arguments.
  assert.deepStrictEqual(run.calls.calls, [
    ['callGameFunction0', ['SetInfiniteRange']],
    ['callGameFunction0', ['SetProvokeMonsters']],
    ['callGameFunction0', ['SetEnemyMagnet']],
    ['callGameFunction0', ['DestroyPlayers']],
    ['callGameFunction0', ['SetSkipCutscenes']]
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

test('the loop re-applies the enabled toggles, and lag killer carries its own value either way', async () => {
  const run = createOptions();
  assert.deepStrictEqual(run.timers.running(), [], 'nothing runs while every toggle is off');

  await run.feature.setToggle('lagKiller', true);
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetLagKiller', 'True']]]);
  assert.strictEqual(run.timers.intervals.length, 1);
  assert.strictEqual(run.timers.intervals[0].ms, toggles.LOOP_MS);
  assert.strictEqual(toggles.LOOP_MS, 1000, 'OptionsManager.Timer ships at 1000 ms');

  await run.feature.setToggle('enemyMagnet', true);
  await run.feature.setToggle('hidePlayers', true);
  run.calls.calls.length = 0;
  // The first pass reaches the 1000 ms mark and skips the group (OptionsManager.cs:203-207:
  // delay, add, then `if (timer < 2000) continue`).
  await run.timers.pass();
  assert.deepStrictEqual(run.calls.calls, []);

  // The second pass reaches 2000 ms, so the group runs - in ApplySettings' own order, with
  // lag killer called either way (OptionsManager.cs:208-214).
  run.calls.calls.length = 0;
  await run.timers.pass();
  assert.deepStrictEqual(run.calls.calls, [
    ['callGameFunction0', ['SetEnemyMagnet']],
    ['callGameFunction0', ['DestroyPlayers']],
    ['callGameFunction', ['SetLagKiller', 'True']]
  ]);

  // Provoke is the reference's one per-pass call.
  await run.feature.setToggle('provoke', true);
  run.calls.calls.length = 0;
  await run.timers.pass();
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction0', ['SetProvokeMonsters']]]);

  await run.feature.setToggle('provoke', false);
  await run.feature.setToggle('enemyMagnet', false);
  await run.feature.setToggle('hidePlayers', false);
  run.calls.calls.length = 0;
  await run.feature.setToggle('lagKiller', false);
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetLagKiller', 'False']]]);
  assert.deepStrictEqual(run.timers.running(), [], 'the loop is given back when nothing needs it');
});

test('a toggle the reference never had an off call for sends nothing when switched off', async () => {
  // Root.cs:1264-1310 only sets the flag on untick for these five; the reference has no
  // "undo" call for them, so neither does this port (nothing invented in its place).
  for (const id of ['infiniteRange', 'provoke', 'enemyMagnet', 'hidePlayers', 'skipCutscenes']) {
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
  assert.deepStrictEqual(run.calls.calls, [['callGameFunction', ['SetWalkSpeed', '20']]]);

  await run.feature.setToggle('walkSpeed', false);
  assert.deepStrictEqual(run.timers.running(), []);
  await run.feature.stop();
});

test('a call the game refuses is reported as an answer, not as success', async () => {
  const run = createOptions({ result: { ok: false, error: 'no member SetEnemyMagnet at SetEnemyMagnet' } });
  await run.feature.setToggle('enemyMagnet', true);
  const state = run.feature.state();
  assert.strictEqual(state.enemyMagnet, true, 'the user\'s own choice is kept either way');
  assert.strictEqual(state.results.enemyMagnet.ok, false);
  assert.strictEqual(state.results.enemyMagnet.error, 'no member SetEnemyMagnet at SetEnemyMagnet');
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

test('a stored tick that no longer exists is ignored rather than fatal', async () => {
  const store = memoryStore({ toggles: { infiniteRange: true, somethingRemoved: true }, walkSpeed: 12 });
  const run = createOptions({ store: store });
  const state = run.feature.state();
  assert.strictEqual(state.infiniteRange, true);
  assert.strictEqual(state.walkSpeed, 12);
  assert.strictEqual(state.somethingRemoved, undefined);
  await run.feature.stop();
});

// The ticks persist, so a restart must not quietly start re-sending them after the user has
// pressed Stop applying: the choice to keep the loop stopped is the user's too. (The reference
// keeps this flag in memory because it is running-state there; here the ticks outlive the app, so
// the flag has to as well or the two disagree.)
test('the Stop applying choice is the user\'s own, and is remembered across a restart', async () => {
  const store = memoryStore(undefined);
  const first = createOptions({ store: store });
  await first.feature.setToggle('provoke', true);
  await first.feature.toggleApplying();
  assert.strictEqual(first.feature.state().applying, false);
  await first.feature.stop();

  const second = createOptions({ store: store });
  assert.strictEqual(second.feature.state().applying, false, 'a restart must not restart the loop by itself');
  assert.deepStrictEqual(second.timers.running(), [], 'nothing may be re-sent while it stays stopped');
  await second.feature.stop();

  // Starting it again is the user's call, and that choice persists in its turn.
  await second.feature.toggleApplying();
  assert.strictEqual(second.feature.state().applying, true);
  await second.feature.stop();

  const third = createOptions({ store: store });
  assert.strictEqual(third.feature.state().applying, true);
  assert.strictEqual(third.timers.running().length, 1, 'the tick that is on resumes when applying is on');
  await third.feature.stop();
});
