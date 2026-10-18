// A bot runs end to end (ticket #37's first acceptance criterion). This drives the real chain -
// the runtime, its engine, the session and the bridge call surface - against a stand-in for the
// game, so "it runs at all" is asserted rather than assumed.
//
// The stand-in answers what the game would answer, through the same two callbacks the bridge
// exposes (getGameObject for a path, callGameFunction0 for a call), and the session is the real
// session module. So the paths this exercises are the paths the plugin itself will use.
const assert = require('assert');

const runtimeModel = require('../../plugins/grimlite-parity/bot/runtime.js');
const sessionModel = require('../../plugins/grimlite-parity/bot/session.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');

// The game as the bridge would see it: dot-paths and calls, answered from one object.
function fakeGame(options) {
  const opts = options || {};
  const state = {
    'sfc.isConnected': 'true',
    'world.myAvatar.objData.strUsername': '"Tester"',
    'world.myAvatar.dataLeaf.intHP': '100',
    'world.myAvatar.dataLeaf.intHPMax': '100',
    'world.mapLoadInProgress': 'false'
  };
  const called = [];
  const bridge = {
    attach: function () { return Promise.resolve({ ok: true }); },
    call: function (name, args) {
      if (name === 'getGameObject') {
        const path = args[0];
        if (Object.prototype.hasOwnProperty.call(state, path)) {
          return Promise.resolve({ ok: true, value: state[path] });
        }
        // The bridge walks a missing chain to null rather than throwing.
        return Promise.resolve({ ok: true, value: 'null' });
      }
      called.push({ name: name, args: args });
      return Promise.resolve({ ok: true, value: 'undefined' });
    }
  };
  return { bridge: bridge, state: state, called: called, opts: opts };
}

// The runtime as main.js builds it, with pacing collapsed so the test does not wait.
function runtimeWith(game) {
  const records = [];
  return runtimeModel.createRuntimeManager({
    createSession: function () {
      // The session a window gets takes its bridge from the manager, the way main.js's does.
      return sessionModel.createSession({ bridge: game.bridge, log: function () {} });
    },
    sleep: function () { return Promise.resolve(); },
    log: function (line) { records.push(line); }
  });
}

function command(className, properties) {
  return catalog.makeCommand(className, properties);
}

test('a bot built from flow statements ends, on demand and on its own stop', async () => {
  // A goto that loops once, an int that counts the pass, a label, and a stop - the flow vocabulary
  // the ticket owns, ending by itself.
  const game = fakeGame();
  const manager = runtimeWith(game);
  const started = await manager.start('game', {
    Commands: [
      catalog.makeStatement('CmdSetVar', 'who', '{PLAYERNAME}'),
      command('CmdInt', { Int: 'n', Value: 0, type: 0 }),
      command('CmdLabel', { Name: 'TOP' }),
      command('CmdInt', { Int: 'n', type: 1 }),
      catalog.makeStatement('CmdIntLessThan', 'n', '3'),
      command('CmdGotoLabel', { Label: 'TOP' }),
      command('CmdStop', {})
    ]
  });
  assert.strictEqual(started.ok, true, started.error);
  await manager.idle('game');
  const state = manager.state('game');
  assert.strictEqual(state.running, false, 'the bot stopped when it reached its own stop');
  // command-catalog's own row text for CmdStop, which is the reference's ToString.
  assert.strictEqual(state.lastCommand, 'Stop bot', 'the row it last ran is what the window shows');
  // The goto really looped, and it looped the reference's own number of times. CmdIntLessThan's
  // Execute asks "is n GREATER than 3" and skips when that holds, so despite its row reading
  // "Int Lesser Than" it lets the body run while n <= 3:
  //   n=1 -> 1>3 no, jump; n=2 -> no, jump; n=3 -> no, jump; n=4 -> 4>3 yes, fall through to stop.
  // So the counter it stopped with is 4, and the loop body ran four times - a number only
  // repetition can produce, and the off-by-one is the reference's, not this port's.
  assert.strictEqual(manager.forWindow('game').engine.ints().n, 4,
    'the loop ran its body four times before falling through to the stop');
});

test('the engine reaches the game through the session the plugin injects', async () => {
  // Bot.Stop's own exit-combat call, which is the one game call a blank run makes.
  const game = fakeGame();
  const manager = runtimeWith(game);
  // A bot with no stop walks its list forever, which is what the reference does; this one ends.
  await manager.start('game', { Commands: [command('CmdBlank', {}), command('CmdStop', {})] });
  await manager.idle('game');
  assert.deepStrictEqual(game.called.map(function (c) { return c.args[0]; }), ['world.cancelTarget'],
    'a blank command calls nothing, and the stop pulls the character out of combat');

  // And the same call when the window's own tick stops it rather than the bot reaching CmdStop.
  const second = fakeGame();
  const manager2 = runtimeWith(second);
  await manager2.start('game', { Commands: [command('CmdBlank', {})] });
  await manager2.stop('game');
  assert.deepStrictEqual(second.called.map(function (c) { return c.args[0]; }),
    ['world.cancelTarget'], 'stopping pulls the character out of combat, as the reference does');
});

test('a window with no sign-in refuses the start and names what is missing', async () => {
  const game = fakeGame();
  game.state['sfc.isConnected'] = 'false';
  const manager = runtimeWith(game);
  const refused = await manager.start('game', { Commands: [command('CmdBlank', {})] });
  assert.strictEqual(refused.ok, false);
  assert.ok(/sign in/i.test(refused.error), refused.error);
});
