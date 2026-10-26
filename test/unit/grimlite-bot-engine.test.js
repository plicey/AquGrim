// The bot engine runtime and lifecycle (ticket #37). Expected behaviour comes from the
// reference's own loop - Grimoire/Botting/Bot.cs (Activate, Index, Start/Stop), BotUtilities.cs
// (WaitUntil, RequiresDelay) and the Cmd* classes under Grimoire/Botting/Commands/Misc/** - not
// from the module under test.
//
// The engine consumes an injected game interface (spec #19, Seam 4): the session reads and the
// relogin are fakes here, so every rule below is asserted without Flash and without a window.
const assert = require('assert');

const engineModel = require('../../plugins/grimlite-parity/bot/engine.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');
const items = require('../../plugins/grimlite-parity/bot/items.js');

function command(className, properties) {
  return catalog.makeCommand(className, properties);
}

// A bot document shaped like a .gbot: the engine reads a Configuration view of it.
function bot(commands, settings) {
  return Object.assign({ Commands: commands }, settings || {});
}

// The injected game interface. Every answer is a plain value; `script` makes a read change over
// time, which is how death, disconnect and a reload are driven in these tests.
function fakeSession(overrides) {
  const state = Object.assign({
    attached: true,
    signedIn: true,
    alive: true,
    username: 'Tester',
    health: 100,
    healthMax: 100,
    mana: 100,
    manaMax: 100
  }, overrides || {});
  const calls = [];
  const session = {
    state: state,
    calls: calls,
    attached: function () { calls.push('attached'); return Promise.resolve(state.attached); },
    signedIn: function () { calls.push('signedIn'); return Promise.resolve(state.signedIn); },
    alive: function () { calls.push('alive'); return Promise.resolve(state.alive); },
    // `ready` false is a reload in flight; `windowClosed` is the window going away for good.
    ready: function () {
      calls.push('ready');
      if (state.windowClosed === true) {
        // The way the session reports it: a refusal, marked as the window being gone rather than
        // the game being busy. See bot/session.js's own note on `windowGone`.
        const gone = new Error('the game window went away');
        gone.windowGone = true;
        return Promise.reject(gone);
      }
      return Promise.resolve(state.ready === undefined ? state.attached : state.ready);
    },
    username: function () { return Promise.resolve(state.username); },
    health: function () { return Promise.resolve(state.health); },
    healthMax: function () { return Promise.resolve(state.healthMax); },
    mana: function () { return Promise.resolve(state.mana); },
    manaMax: function () { return Promise.resolve(state.manaMax); },
    setSpawnPoint: function () { calls.push('setSpawnPoint'); return Promise.resolve(); },
    rest: function () { calls.push('rest'); return Promise.resolve(); },
    exitCombat: function () { calls.push('exitCombat'); return Promise.resolve(); }
  };
  return session;
}

// The engine as the plugin builds it, with pacing collapsed so a test does not wait.
function engine(deps) {
  const options = deps || {};
  const waited = [];
  const records = [];
  const made = engineModel.createEngine({
    session: options.session || fakeSession(),
    relogin: options.relogin,
    options: options.options,
    game: options.game,
    handlers: options.handlers,
    // Delays are recorded rather than slept: the assertion is on the pacing the reference asks
    // for, and a real wait would only make the suite slow.
    sleep: function (ms) { waited.push(ms); return Promise.resolve(); },
    log: function (message) { records.push(message); }
  });
  made.waited = waited;
  made.records = records;
  return made;
}

function legacy(type, properties) {
  return Object.assign({ $type: type + ', Grimoire' }, properties || {});
}

function questAccess() {
  const accepted = [];
  const completed = [];
  const inProgress = {};
  return {
    accepted: accepted,
    completed: completed,
    sleep: function () { return Promise.resolve(); },
    log: function () {},
    hasQuest: function () { return Promise.resolve(true); },
    quest: function () { return Promise.resolve({ iSlot: 0 }); },
    isInProgress: function (id) { return Promise.resolve(inProgress[String(id)] === true); },
    accept: function (id) {
      accepted.push(Number(id));
      inProgress[String(id)] = true;
      return Promise.resolve();
    },
    actionAvailable: function () { return Promise.resolve(true); },
    waitUntil: async function (condition) {
      for (let tries = 0; tries < 20; tries++) {
        if (await condition()) return;
      }
    },
    complete: function (id) {
      completed.push(Number(id));
      return Promise.resolve();
    }
  };
}

test('a bot with nothing in it is refused, the way the reference refuses it', async () => {
  const made = engine();
  const started = await made.start(bot([]));
  assert.strictEqual(started.ok, false, 'an empty command list must not start');
  assert.ok(/no commands|empty/i.test(started.error), 'the refusal says why: ' + started.error);
  assert.strictEqual(made.running(), false);
  assert.strictEqual(made.index(), 0);
});

test('a bot is refused while no character is signed in', async () => {
  const made = engine({ session: fakeSession({ signedIn: false }) });
  const started = await made.start(bot([command('CmdStop', {})]));
  assert.strictEqual(started.ok, false);
  assert.ok(/signed in|logged in/i.test(started.error), 'the refusal says why: ' + started.error);
  assert.strictEqual(made.running(), false);
});

test('a bot already running is refused rather than started twice', async () => {
  const made = engine();
  const started = await made.start(bot([command('CmdRestart', {})]));
  assert.strictEqual(started.ok, true);
  const again = await made.start(bot([command('CmdStop', {})]));
  assert.strictEqual(again.ok, false);
  assert.ok(/already running/i.test(again.error), 'the refusal says why: ' + again.error);
});

test('an external cycle pause holds the bot index until it restores the prior pause state', async () => {
  const made = engine();
  await made.start(bot([command('CmdBlank', {}), command('CmdStop', {})]));
  assert.strictEqual(made.setPaused(true), false, 'the cycle records that the engine was not paused');
  const before = made.index();
  const held = await made.tick();
  assert.strictEqual(held.paused, true);
  assert.strictEqual(made.index(), before, 'a paused engine does not dispatch its next command');
  assert.strictEqual(made.paused(), true);
  assert.strictEqual(made.setPaused(false), true);
  await made.tick();
  assert.strictEqual(made.index(), before + 1, 'resuming lets the bot continue');
  made.stop();
});

test('the list is walked by index, in order, one command per pass', async () => {
  const made = engine();
  const order = [];
  await made.start(bot([
    command('CmdBlank', {}),
    command('CmdBlank2', { Text: 'second' }),
    command('CmdBlank3', { Text: 'third' }),
    command('CmdStop', {})
  ]));
  for (let i = 0; i < 4; i++) {
    order.push(made.index());
    await made.tick();
  }
  assert.deepStrictEqual(order, [0, 1, 2, 3], 'Activate walks the list by index');
  assert.strictEqual(made.running(), false, 'CmdStop stops the bot');
});

test('Index Goto lands on the command it names, which is n - 1 plus the loop increment', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdIndex', { Type: 2, Index: 2, IndexString: '' }),
    command('CmdBlank', {}),
    command('CmdRestart', {})
  ]));
  await made.tick();
  assert.strictEqual(made.index(), 2, 'Goto 2 dispatches the command at index 2 next');
});

test('Index Goto past the end wraps to the start, which is the reference own clamp', async () => {
  const made = engine();
  await made.start(bot([command('CmdIndex', { Type: 2, Index: 9, IndexString: '' }), command('CmdBlank', {})]));
  await made.tick();
  // Index = 9 - 1 = 8; the setter wraps that to 0 because 8 is not below the count, and then
  // the loop's own Index++ lands on 1.
  assert.strictEqual(made.index(), 1, 'the Index setter wraps a value past the count');
});

test('Index Down moves forward by the count asked for', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdIndex', { Type: 1, Index: 3, IndexString: '' }),
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    command('CmdBlank', {})
  ]));
  await made.tick();
  // Down n at index i: Index += (n - 1) when n - 1 > 0, then the loop's Index++ -> i + n.
  assert.strictEqual(made.index(), 3);
});

test('Index Up moves back by the count asked for', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    command('CmdIndex', { Type: 0, Index: 2, IndexString: '' }),
    command('CmdBlank', {})
  ]));
  made.setIndex(3);
  await made.tick();
  // Up n at index i: Index -= (n + 1), then the loop's Index++ -> i - n.
  assert.strictEqual(made.index(), 1);
});

test('Index without a Type defaults to upstream Up (zero)', async () => {
  const made = engine();
  const jump = command('CmdIndex', { Index: 2 });
  await made.start(bot([
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    jump,
    command('CmdBlank', {})
  ]));
  made.setIndex(3);
  await made.tick();
  assert.strictEqual(made.index(), 1, 'omitted enum Type is Up, so index 3 moves up two');
  assert.strictEqual(catalog.rowText(jump), 'Index up: 2');
});

test('a label is a no-op and a goto finds it by name, case-insensitively', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdGotoLabel', { Label: 'loop' }),
    command('CmdBlank', {}),
    command('CmdLabel', { Name: 'LOOP' }),
    command('CmdStop', {})
  ]));
  await made.tick();
  // GotoLabel sets the index of the matching CmdLabel; the loop's Index++ then makes execution
  // resume at the command *after* the label, which is what the reference's loop does.
  assert.strictEqual(made.index(), 3, 'the goto lands on the label and the loop passes it');
  assert.strictEqual(made.commands()[2].Name, 'LOOP', 'it matched the label case-insensitively');
});

test('a goto to a label that is not there falls through to the next command', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdGotoLabel', { Label: 'missing' }),
    command('CmdRestart', {})
  ]));
  await made.tick();
  assert.strictEqual(made.index(), 1, 'FindIndex returns -1 and the index is left alone');
});

test('Restart sets the index to -1 so the loop increment puts it back at 0', async () => {
  const made = engine();
  await made.start(bot([command('CmdBlank', {}), command('CmdRestart', {})]));
  await made.tick();
  made.setIndex(1);
  await made.tick();
  assert.strictEqual(made.index(), 0, 'CmdRestart sets Index = -1; Index++ makes it 0');
});

test('a statement that fails skips the command under it', async () => {
  const made = engine();
  const ran = [];
  await made.start(bot([
    catalog.makeStatement('CmdIntIs', 'counter', '1'),
    command('CmdLabel', { Name: 'GUARDED' }),
    command('CmdStop', {})
  ]));
  made.ints().counter = 0;
  await made.tick();
  // CmdIntIs: counter != 1 -> instance.Index++, then the loop's Index++ -> the guarded label is
  // skipped and the command after it runs.
  assert.strictEqual(made.index(), 2, 'the failing statement advanced the index by two');
  void ran;
});

test('a statement that passes leaves the next command to run', async () => {
  const made = engine();
  await made.start(bot([
    catalog.makeStatement('CmdIntIs', 'counter', '1'),
    command('CmdBlank', {}),
    command('CmdStop', {})
  ]));
  made.ints().counter = 1;
  await made.tick();
  assert.strictEqual(made.index(), 1, 'the passing statement does not move the index itself');
});

test('ints are set, raised and lowered, and CmdInt2 takes a resolved value', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdInt', { Int: 'counter', Value: 5, type: 0 }),
    command('CmdInt', { Int: 'counter', Value: 0, type: 1 }),
    command('CmdInt', { Int: 'counter', Value: 0, type: 2 }),
    command('CmdInt2', { IntKey: 'other', Value: '[counter] + 2' }),
    command('CmdStop', {})
  ]));
  await made.tick();
  assert.strictEqual(made.ints().counter, 5, 'type 0 is Set');
  await made.tick();
  assert.strictEqual(made.ints().counter, 6, 'type 1 is Increase by one');
  await made.tick();
  assert.strictEqual(made.ints().counter, 5, 'type 2 is Decrease by one');
  await made.tick();
  assert.strictEqual(made.ints().other, 7, 'CmdInt2 resolves its value first');
});

test('an int the bot never set is created at 0 before it is touched', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdInt', { Int: 'fresh', Value: 0, type: 1 }),
    command('CmdStop', {})
  ]));
  await made.tick();
  assert.strictEqual(made.ints().fresh, 1, 'Tempvalues.Add(Int, 0) then ++');
});

test('variables are set, updated, cleared, and Update on a missing one skips a command', async () => {
  const made = engine();
  await made.start(bot([
    catalog.makeStatement('CmdSetVar', 'target', 'Darkon'),
    catalog.makeStatement('CmdUpdateVar', 'target', 'Nulgath'),
    catalog.makeStatement('CmdUpdateVar', 'absent', 'x'),
    command('CmdLabel', { Name: 'SKIPPED' }),
    command('CmdClearTemp', {}),
    command('CmdStop', {})
  ]));
  await made.tick();
  assert.strictEqual(made.vars().target, 'Darkon');
  await made.tick();
  assert.strictEqual(made.vars().target, 'Nulgath', 'Update replaces the value');
  await made.tick();
  assert.strictEqual(made.index(), 4, 'Update on a key that is absent advances the index by two');
  assert.strictEqual(made.vars().target, 'Nulgath', 'clearing is the next pass');
  await made.tick();
  assert.deepStrictEqual(made.vars(), {}, 'CmdClearTemp clears every variable');
  assert.deepStrictEqual(made.ints(), {}, 'CmdClearTemp clears every int too');
});

test('a variable referenced in [brackets] is substituted, five depths deep', async () => {
  const made = engine();
  await made.start(bot([
    catalog.makeStatement('CmdSetVar', 'a', '[b]'),
    catalog.makeStatement('CmdSetVar', 'b', 'plain'),
    command('CmdStop', {})
  ]));
  await made.tick();
  assert.strictEqual(made.vars().a, '[b]', 'an unresolvable key is left as it was written');
  await made.tick();
  assert.strictEqual(made.resolve('[a]'), 'plain', 'the substitution walks the depth');
});

test('{PLAYERNAME} resolves to the signed-in character', async () => {
  const made = engine({ session: fakeSession({ username: 'Arthas' }) });
  await made.start(bot([command('CmdStop', {})]));
  assert.strictEqual(made.resolve('{PLAYERNAME}'), 'Arthas');
});

test('a whole string that is arithmetic is evaluated, as the reference evaluates it', async () => {
  const made = engine();
  await made.start(bot([catalog.makeStatement('CmdSetVar', 'n', '2'), command('CmdStop', {})]));
  await made.tick();
  assert.strictEqual(made.resolve('[n] * 3 + 1'), '7', 'operator precedence in the resolved expression');
  assert.strictEqual(made.resolve('5 / 2'), '2', 'DataTable.Compute divides ints as ints');
  assert.strictEqual(made.resolve('5.0 / 2'), '2.5');
});

test('a string that is not arithmetic is handed back untouched', async () => {
  const made = engine();
  await made.start(bot([command('CmdStop', {})]));
  assert.strictEqual(made.resolve('Darkon the Conductor'), 'Darkon the Conductor');
});

test('CmdDelay waits for the delay it was given, and the bot delay follows it', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdDelay', { Delay: 1500 }),
    command('CmdStop', {})
  ], { BotDelay: 250 }));
  await made.tick();
  assert.deepStrictEqual(made.waited, [1500, 250],
    'the command delay first, then Configuration.BotDelay');
});

test('the bot delay is skipped for the commands the reference marks as not needing it', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdLabel', { Name: 'X' }),
    command('CmdGotoLabel', { Label: 'X' }),
    command('CmdStop', {})
  ], { BotDelay: 250, SkipDelayIndexIf: true }));
  await made.tick();
  await made.tick();
  assert.deepStrictEqual(made.waited, [], 'a label and a goto are not paced');
});

test('CmdBotDelay sets the delay the following commands are paced with', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdBotDelay', { Delay: 40 }),
    command('CmdBlank', {}),
    command('CmdStop', {})
  ]));
  await made.tick();
  assert.deepStrictEqual(made.waited, [40], 'the delay the command set paces that same tick');
  await made.tick();
  assert.deepStrictEqual(made.waited, [40, 40], 'and every tick after it, until it is changed');
});

test('the loop continues during a map reload and commands wait for the map themselves', async () => {
  const session = fakeSession();
  const made = engine({ session: session });
  await made.start(bot([
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    command('CmdStop', {})
  ]));
  await made.tick();
  const before = made.index();
  assert.strictEqual(before, 1);

  // A reload does not pause the list: commands that need the map are the ones that wait.
  session.state.attached = false;
  await made.tick();
  assert.strictEqual(made.paused(), false, 'a reload is not the bot pause');
  assert.strictEqual(made.index(), before + 1, 'the list moved on while the map reloaded');
  assert.strictEqual(made.running(), true, 'the bot keeps running');
  assert.ok(made.records.some(function (line) { return /map is reloading/.test(line); }),
    'the reload is reported once: ' + made.records.join(' | '));

  session.state.attached = true;
  await made.tick();
  assert.strictEqual(made.paused(), false);
  const continuedAt = made.dispatched()[made.dispatched().length - 1].index;
  assert.strictEqual(continuedAt, before + 1, 'and it runs the next command, not the reloaded one');
});

test('death waits for the respawn, then follows the bot own restart-on-death setting', async () => {
  const session = fakeSession();
  const made = engine({ session: session });
  await made.start(bot([
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    command('CmdBlank', {}),
    command('CmdStop', {})
  ], { RestartUponDeath: false }));
  await made.tick();
  await made.tick();
  assert.strictEqual(made.index(), 2);

  session.state.alive = false;
  await made.tick();
  assert.notStrictEqual(session.calls.indexOf('setSpawnPoint'), -1,
    'World.SetSpawnPoint() is called first');
  const ran = made.dispatched().slice(2).map(function (entry) { return entry.index; });
  // The death block steps back one, and the same pass then runs the command at that index.
  assert.deepStrictEqual(ran, [1], 'RestartUponDeath false -> Index = Index - 1');

  session.state.alive = true;
  const made2 = engine({ session: fakeSession() });
  await made2.start(bot([
    command('CmdBlank', {}), command('CmdBlank', {}), command('CmdStop', {})
  ], { RestartUponDeath: true }));
  await made2.tick();
  made2.session.state.alive = false;
  await made2.tick();
  const restarted = made2.dispatched().slice(1).map(function (entry) { return entry.index; });
  assert.deepStrictEqual(restarted, [0], 'RestartUponDeath true -> Index = 0, mid-pass');
});

test('a disconnect stops the bot when its own auto-relogin is off', async () => {
  const session = fakeSession();
  let relogins = 0;
  const made = engine({ session: session, relogin: function () { relogins++; return Promise.resolve(); } });
  await made.start(bot([command('CmdBlank', {}), command('CmdStop', {})], { AutoRelogin: false }));
  session.state.signedIn = false;
  await made.tick();
  assert.strictEqual(relogins, 0, 'no relogin is attempted when the setting is off');
  assert.strictEqual(made.running(), false, 'Stop() is called');
});

test('a disconnect relogs in and restarts the list when its own auto-relogin is on', async () => {
  const session = fakeSession();
  let relogins = 0;
  const made = engine({
    session: session,
    relogin: function (config) {
      relogins++;
      assert.strictEqual(config.AutoRelogin, true, 'the bot own setting is what decides');
      session.state.signedIn = true;
      return Promise.resolve({ ok: true });
    }
  });
  await made.start(bot([command('CmdBlank', {}), command('CmdBlank', {}), command('CmdStop', {})],
    { AutoRelogin: true }));
  made.setIndex(2);
  session.state.signedIn = false;
  await made.tick();
  assert.strictEqual(relogins, 1, 'AutoRelogin.Login is awaited once');
  // A successful relogin resets the index to 0 and the same pass runs the first command.
  assert.deepStrictEqual(made.dispatched().map(function (e) { return e.index; }), [0],
    'a successful relogin starts the list over, mid-pass');
  assert.strictEqual(made.running(), true, 'the bot keeps running');
});

test('closing the game window stops its bot, and only its bot', async () => {
  const mine = engine({ session: fakeSession({ alive: true }) });
  const other = engine({ session: fakeSession() });
  await mine.start(bot([command('CmdBlank', {}), command('CmdBlank', {})]));
  await other.start(bot([command('CmdBlank', {}), command('CmdBlank', {})]));

  mine.session.state.attached = false;
  mine.session.state.windowClosed = true;
  await mine.tick();
  assert.strictEqual(mine.running(), false, 'a closed window stops that window\'s bot');
  assert.strictEqual(other.running(), true, 'the other window\'s bot is untouched');
});

test('stop() ends the bot on demand and is safe to call twice', async () => {
  const made = engine();
  await made.start(bot([command('CmdBlank', {}), command('CmdBlank', {})]));
  assert.strictEqual(made.running(), true);
  await made.stop();
  assert.strictEqual(made.running(), false);
  await made.stop();
  assert.strictEqual(made.running(), false);
  assert.strictEqual(made.paused(), false, 'Stop clears the pause the reference clears too');
});

test('two engines share no state at all: separate lists, indexes, variables and ints', async () => {
  const a = engine();
  const b = engine();
  await a.start(bot([
    catalog.makeStatement('CmdSetVar', 'who', 'a'),
    command('CmdInt', { Int: 'n', Value: 1, type: 0 }),
    command('CmdBlank', {}),
    command('CmdStop', {})
  ]));
  await b.start(bot([
    catalog.makeStatement('CmdSetVar', 'who', 'b'),
    command('CmdInt', { Int: 'n', Value: 9, type: 0 }),
    command('CmdBlank', {}),
    command('CmdStop', {})
  ]));
  await a.tick();
  await b.tick();
  assert.strictEqual(a.vars().who, 'a');
  assert.strictEqual(b.vars().who, 'b');
  await a.tick();
  await b.tick();
  assert.strictEqual(a.ints().n, 1);
  assert.strictEqual(b.ints().n, 9);
  await a.tick();
  assert.strictEqual(a.index(), 3);
  assert.strictEqual(b.index(), 2, 'one engine advancing does not move the other');
  assert.strictEqual(a.running(), true);
  assert.strictEqual(b.running(), true);
});

test('a command this build cannot execute yet is reported by name, not run silently', async () => {
  const made = engine();
  await made.start(bot([command('CmdKill', { Monster: 'Darkon' }), command('CmdStop', {})]));
  await made.tick();
  assert.ok(made.records.some(function (line) { return line.indexOf('CmdKill') !== -1; }),
    'the log names the command that has no implementation yet');
  assert.strictEqual(made.running(), true, 'the bot keeps walking instead of hanging on it');
});

test('the legacy commands in downloaded reputation scripts run through their modern handlers', async () => {
  const access = questAccess();
  const made = engine({ game: access, handlers: items.handlers(access) });
  const document = bot([
    legacy('Grimoire.Botting.Commands.Quest.CmdAcceptQuest2', { QuestID: '916' }),
    legacy('Grimoire.Botting.Commands.Quest.CmdAcceptQuest2', { QuestID: '922' }),
    legacy('Grimoire.Botting.Commands.Quest.CmdCompleteQuest2', { QuestID: '922' }),
    legacy('Grimoire.Botting.Commands.Quest.CmdCompleteQuest2', { QuestID: '916' }),
    legacy('Grimoire.Botting.Commands.Misc.CmdBotDelay2', { Delay: '1000' }),
    legacy('Grimoire.Botting.Commands.Misc.CmdStopBotWithMessage', { Message: 'Bot Done!, :)' })
  ]);
  await made.start(document);
  for (let step = 0; step < 6; step++) await made.tick();
  assert.deepStrictEqual(access.accepted, [916, 922]);
  assert.deepStrictEqual(access.completed, [922, 916]);
  assert.strictEqual(document.BotDelay, 1000);
  assert.strictEqual(made.running(), false);
  assert.ok(made.records.indexOf('Bot Done!, :)') !== -1, 'the stop message reaches the log');
});

test('the flow commands the engine owns are exactly the ones it can execute', () => {
  const made = engine();
  assert.ok(Object.keys(made.handlers()).length > 0);
  const statements = catalog.STATEMENTS.map(function (row) { return row.className; });
  Object.keys(made.handlers()).forEach(function (className) {
    assert.ok(catalog.GROUPS[className] !== undefined || statements.indexOf(className) !== -1,
      className + ' is not a command class the reference declares');
  });
});

test('auto reject respects padded mixed-case whitelist names and its original run guard', async () => {
  const session = fakeSession();
  let onDrop;
  const rejected = [];
  session.onDrop = function (fn) { onDrop = fn; return function () {}; };
  session.rejectDrop = async function (name, id, guard) { rejected.push({ name, id, guard }); };
  const made = engine({ session });
  const doc = bot([command('CmdRestart', {})], { EnableRejection: true, Drops: ['Sword'] });
  await made.start(doc);
  onDrop({ ItemID: 1, sName: '  sWoRd  ' });
  assert.strictEqual(rejected.length, 0);
  onDrop({ ItemID: 2, sName: '  Junk  ' });
  assert.strictEqual(rejected.length, 1);
  assert.strictEqual(rejected[0].name, 'junk');
  assert.strictEqual(rejected[0].guard(), true);
  made.drops().push('JUNK');
  assert.strictEqual(rejected[0].guard(), false, 'a newly whitelisted drop cancels retries');
  made.drops().pop();
  assert.strictEqual(rejected[0].guard(), true);
  made.stop();
  assert.strictEqual(rejected[0].guard(), false);
  await made.start(doc);
  assert.strictEqual(rejected[0].guard(), false, 'restart cannot revive an older rejection');
  made.stop();
});
