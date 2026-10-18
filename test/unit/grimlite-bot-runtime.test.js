// One independent bot per game window (ticket #37, spec #19's concurrency ruling). The engine's
// own loop is covered in grimlite-bot-engine.test.js; this file is the registry around it - what a
// second window can and cannot see, and what happens to a bot when its window goes away.
//
// The reference cannot answer any of this: it is single-client, its engine is a singleton and its
// variable dictionaries are static. The spec's ruling is the expected behaviour here.
const assert = require('assert');

const runtimeModel = require('../../plugins/grimlite-parity/bot/runtime.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');

function command(className, properties) {
  return catalog.makeCommand(className, properties);
}

// One session per window, the way the manager asks for them. Each records what was asked of it.
function sessions() {
  const made = {};
  function createSession(key) {
    const state = { attached: true, signedIn: true, alive: true, windowClosed: false };
    const session = {
      key: key,
      state: state,
      calls: [],
      attached: function () { session.calls.push('attached'); return Promise.resolve(state.attached); },
      signedIn: function () { session.calls.push('signedIn'); return Promise.resolve(state.signedIn); },
      alive: function () { session.calls.push('alive'); return Promise.resolve(state.alive); },
      ready: function () {
        session.calls.push('ready');
        if (state.windowClosed) {
          const gone = new Error('the game window went away');
          gone.windowGone = true;
          return Promise.reject(gone);
        }
        return Promise.resolve(state.attached);
      },
      username: function () { return Promise.resolve('Tester'); },
      health: function () { return Promise.resolve(100); },
      healthMax: function () { return Promise.resolve(100); },
      mana: function () { return Promise.resolve(100); },
      manaMax: function () { return Promise.resolve(100); },
      setSpawnPoint: function () { return Promise.resolve(); },
      rest: function () { return Promise.resolve(); },
      exitCombat: function () { return Promise.resolve(); },
      // The session's own release (#42): a window that closes gives its tap subscription back.
      close: function () { session.calls.push('close'); return Promise.resolve(); }
    };
    made[key] = session;
    return session;
  }
  return { createSession: createSession, sessions: made };
}

function runtime(deps) {
  const made = sessions();
  const records = [];
  const manager = runtimeModel.createRuntimeManager(Object.assign({
    createSession: made.createSession,
    sleep: function () { return new Promise(function (resolve) { setTimeout(resolve, 0); }); },
    log: function (line) { records.push(line); }
  }, deps || {}));
  return { manager: manager, sessions: made.sessions, records: records };
}

// A bot that runs to its own end: two blanks and a stop.
function shortBot(settings) {
  return Object.assign({
    Commands: [command('CmdBlank', {}), command('CmdBlank', {}), command('CmdStop', {})]
  }, settings || {});
}

test('a window with no bot reports an empty state rather than a share of another window\'s', () => {
  const r = runtime();
  assert.deepStrictEqual(r.manager.state('never-started'), {
    running: false, paused: false, index: 0, lastCommand: null, commands: 0
  });
});

test('a bot runs to the end of its list and stops, and the window reports it stopped', async () => {
  const r = runtime();
  const started = await r.manager.start('win-a', shortBot());
  assert.strictEqual(started.ok, true);
  await r.manager.idle('win-a');
  const state = r.manager.state('win-a');
  assert.strictEqual(state.running, false, 'CmdStop ends it');
  assert.strictEqual(state.commands, 3, 'the window reports its own command count');
});

test('each window gets its own session: two windows never share one', async () => {
  const r = runtime();
  await r.manager.start('win-a', shortBot());
  await r.manager.start('win-b', shortBot());
  assert.notStrictEqual(r.sessions['win-a'], r.sessions['win-b']);
  assert.strictEqual(r.sessions['win-a'].key, 'win-a');
  assert.strictEqual(r.sessions['win-b'].key, 'win-b');
  await r.manager.idle('win-a');
  await r.manager.idle('win-b');
});

test('stopping one window leaves the other window\'s bot running', async () => {
  const r = runtime();
  await r.manager.start('win-a', { Commands: [command('CmdDelay', { Delay: 50 }), command('CmdStop', {})] });
  await r.manager.start('win-b', { Commands: [command('CmdDelay', { Delay: 50 }), command('CmdStop', {})] });
  await r.manager.stop('win-a');
  assert.strictEqual(r.manager.state('win-a').running, false);
  assert.strictEqual(r.manager.state('win-b').running, true, 'the other window is untouched');
  await r.manager.stop('win-b');
});

test('a window that is already running its bot refuses a second start', async () => {
  const r = runtime();
  await r.manager.start('win-a', { Commands: [command('CmdDelay', { Delay: 30 }), command('CmdStop', {})] });
  const again = await r.manager.start('win-a', shortBot());
  assert.strictEqual(again.ok, false);
  assert.ok(/already running/i.test(again.error), 'the refusal says why: ' + again.error);
  await r.manager.stop('win-a');
});

test('two windows run two bots at once, each with its own index', async () => {
  const r = runtime();
  await r.manager.start('win-a', {
    Commands: [command('CmdBlank', {}), command('CmdBlank', {}), command('CmdBlank', {}), command('CmdStop', {})]
  });
  await r.manager.start('win-b', {
    Commands: [command('CmdBlank', {}), command('CmdBlank', {}), command('CmdStop', {})]
  });
  await r.manager.idle('win-a');
  await r.manager.idle('win-b');
  assert.strictEqual(r.manager.state('win-a').commands, 4);
  assert.strictEqual(r.manager.state('win-b').commands, 3);
  assert.strictEqual(r.manager.state('win-a').running, false);
  assert.strictEqual(r.manager.state('win-b').running, false);
  assert.deepStrictEqual(r.manager.windows().sort(), ['win-a', 'win-b']);
});

test('closing a window stops its bot and drops its state entirely', async () => {
  const r = runtime();
  await r.manager.start('win-a', { Commands: [command('CmdDelay', { Delay: 50 }), command('CmdStop', {})] });
  await r.manager.start('win-b', { Commands: [command('CmdDelay', { Delay: 50 }), command('CmdStop', {})] });

  await r.manager.windowClosed('win-a');
  assert.strictEqual(r.manager.state('win-a').running, false, 'that window\'s bot is stopped');
  assert.ok(r.sessions['win-a'].calls.indexOf('close') !== -1,
    'and its session gave its own subscriptions back (#42: the packet tap); ' +
    r.sessions['win-a'].calls.join(','));
  assert.strictEqual(r.manager.state('win-b').running, true, 'the other window keeps running');
  assert.strictEqual(r.sessions['win-b'].calls.indexOf('close'), -1,
    'the window that is still open keeps its subscription');
  assert.deepStrictEqual(r.manager.windows(), ['win-b'], 'the closed window has no entry left');
  await r.manager.windowClosed('win-b');
});

test('closing a window is safe when it never ran a bot, and twice over', async () => {
  const r = runtime();
  const first = await r.manager.windowClosed('never-started');
  assert.strictEqual(first.stopped, false, 'nothing to stop');
  await r.manager.start('win-a', shortBot());
  await r.manager.windowClosed('win-a');
  const second = await r.manager.windowClosed('win-a');
  assert.strictEqual(second.stopped, false, 'the entry is already gone');
});

test('a new window after a close gets a new bot, not the closed one\'s state', async () => {
  const r = runtime();
  await r.manager.start('win-a', { Commands: [command('CmdInt', { Int: 'n', Value: 7, type: 0 }), command('CmdStop', {})] });
  await r.manager.idle('win-a');
  assert.strictEqual(r.manager.forWindow('win-a').engine.ints().n, 7);

  await r.manager.windowClosed('win-a');
  const fresh = r.manager.forWindow('win-a');
  assert.deepStrictEqual(fresh.engine.ints(), {}, 'the int the closed window set is gone');
  assert.strictEqual(fresh.engine.running(), false);
});

test('a minimised window is not a closed one: its bot keeps running', async () => {
  // Nothing in the runtime reacts to a minimised window, and nothing polls visibility: the bot's
  // only inputs are the session and stop(). The check is that the loop does not depend on any
  // window state at all, which is what makes minimising safe.
  const r = runtime();
  await r.manager.start('win-a', {
    Commands: [command('CmdDelay', { Delay: 30 }), command('CmdBlank', {}), command('CmdStop', {})]
  });
  assert.strictEqual(r.manager.state('win-a').running, true, 'still running while minimised');
  await r.manager.idle('win-a');
  assert.strictEqual(r.manager.state('win-a').commands, 3);
});

test('the runtime hands each window its own bot, and no window a shared one', () => {
  const r = runtime();
  assert.notStrictEqual(r.manager.forWindow('a').engine, r.manager.forWindow('b').engine);
  assert.strictEqual(r.manager.forWindow('a').engine, r.manager.forWindow('a').engine);
  assert.deepStrictEqual(r.manager.windows().sort(), ['a', 'b']);
});

test('a window key that is absent or empty falls back to one default bot, not many', async () => {
  const r = runtime();
  await r.manager.start(undefined, shortBot());
  await r.manager.idle(undefined);
  assert.deepStrictEqual(r.manager.windows(), ['default']);
  assert.strictEqual(r.sessions['default'].key, 'default');
});

test('a bot that writes a Configuration key edits the document it was started with', async () => {
  const r = runtime();
  const document = { Commands: [command('CmdBotDelay', { Delay: 40 }), command('CmdStop', {})] };
  await r.manager.start('win-a', document);
  await r.manager.idle('win-a');
  assert.strictEqual(document.BotDelay, 40,
    'CmdBotDelay writes Configuration.BotDelay, which is the document the editor holds');
});

test('the seams a misc command needs reach the engine the plugin actually runs', async () => {
  // The engine takes its shell seams by injection (#40). A manager that does not pass them on
  // builds an engine whose CmdBeep beeps nothing, whose CmdPacket frames go nowhere and whose
  // CmdLoadBot cannot read a file - the commands would look wired while doing nothing, which is
  // the one failure a user cannot see. So the manager forwards what it is given: no seam here
  // means the command says so rather than pretending.
  const sent = [];
  const beeps = [];
  const r = runtime({
    packets: { send: function (frame) { sent.push(frame); return true; } },
    beep: function (count) { beeps.push(count); },
    readFile: function () { return JSON.stringify({ Commands: [command('CmdStop', {})] }); },
    exists: function (file) { return file === '/b/x.gbot'; },
    botsDirectory: function () { return '/b'; },
    timers: { setTimeout: function () { return 1; }, clearTimeout: function () {} }
  });
  await r.manager.start('win-a', {
    Commands: [
      command('CmdBeep', { Times: 2 }),
      command('CmdPacket', { Packet: 'hello' }),
      command('CmdLoadBot', { BotFilePath: 'x.gbot' }),
      command('CmdStop', {})
    ]
  });
  await r.manager.idle('win-a');
  assert.deepStrictEqual(beeps, [2], 'CmdBeep reaches the injected sound');
  assert.deepStrictEqual(sent, [{ direction: 'toServer', text: 'hello' }],
    'CmdPacket writes through the injected relay');
});
