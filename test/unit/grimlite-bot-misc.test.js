// The miscellaneous commands (ticket #40). Expected behaviour comes from the reference client's
// own classes - Grimlite-Li 816d9cd, Grimoire/Botting/Commands/Misc/*.cs - and from the loader
// bodies those commands call (the decompiled loader: Externalizer.as and game/*.as).
//
// Two rules decide the shape of this file:
//   * every command the reference declares under Misc/ is either executed or reported with the
//     reason it is not, so 'every command exists and runs' is asserted by walking the whole set;
//   * the commands with no game dependency work with no game at all, which is measured by
//     counting what the session was asked for rather than by reading the code.
const assert = require('assert');

const engineModel = require('../../plugins/grimlite-parity/bot/engine.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');
const misc = require('../../plugins/grimlite-parity/bot/misc.js');
const surface = require('../../plugins/grimlite-parity/loader-surface.js');

function command(className, properties) {
  return catalog.makeCommand(className, properties);
}

function bot(commands, settings) {
  return Object.assign({ Commands: commands }, settings || {});
}

// The injected game interface (spec #19, Seam 4). Every answer is recorded, so 'this command
// read nothing from the game' is a measurement. The loader names come back the way the surface
// answers them; a name nobody answered refuses in the surface's own words.
function fakeSession(overrides) {
  const opts = overrides || {};
  const state = Object.assign({ signedIn: true, alive: true, username: 'Tester',
    ready: true, players: [] }, opts.state || {});
  const session = {
    state: state,
    calls: [],
    answers: Object.assign({ RoomId: '3', RoomNumber: '1234', Map: 'battleon' }, opts.answers || {}),
    loaderCall: function (name, args) {
      session.calls.push({ name: 'loader', args: [name].concat(args || []) });
      if (name === 'PlayersInMap') return Promise.resolve(state.players);
      if (name === 'GoTo') return Promise.resolve(true);
      if (Object.prototype.hasOwnProperty.call(session.answers, name)) {
        return Promise.resolve(session.answers[name]);
      }
      return Promise.reject(new Error('no helper named "' + name + '" is implemented'));
    },
    signedIn: function () { session.calls.push({ name: 'signedIn' }); return Promise.resolve(state.signedIn); },
    alive: function () { session.calls.push({ name: 'alive' }); return Promise.resolve(state.alive); },
    ready: function () { session.calls.push({ name: 'ready' }); return Promise.resolve(state.ready); },
    username: function () { session.calls.push({ name: 'username' }); return Promise.resolve(state.username); },
    health: function () { return Promise.resolve(100); },
    healthMax: function () { return Promise.resolve(100); },
    mana: function () { return Promise.resolve(100); },
    manaMax: function () { return Promise.resolve(100); },
    setSpawnPoint: function () { return Promise.resolve(); },
    rest: function () { return Promise.resolve(); },
    exitCombat: function () { return Promise.resolve(); },
    clientMessage: function (type, text, sender) {
      session.calls.push({ name: 'clientMessage', args: [type, text, sender] });
      return Promise.resolve();
    }
  };
  return session;
}

// The engine as the plugin builds it, with pacing and timers collapsed and every injected seam
// recording what it was asked for.
function engine(options) {
  const opts = options || {};
  const rec = { records: [], debug: [], cleared: [], sent: [], beeps: [], waited: [], spammer: [],
    timers: [], setProvoke: [], options: {} };
  const made = engineModel.createEngine({
    session: opts.session === undefined ? fakeSession() : opts.session,
    relogin: opts.relogin,
    options: opts.options === undefined ? {
      setProvoke: function (on) { rec.setProvoke.push(on); return true; },
      getProvoke: function () { return opts.provokeNow === true; }
    } : opts.options,
    packets: { send: function (frame) { rec.sent.push(frame); return opts.accept !== false; } },
    beep: function (count) { rec.beeps.push(count); },
    readFile: opts.readFile,
    exists: opts.exists,
    botsDirectory: opts.botsDirectory,
    spammer: opts.spammer === undefined ? {
      add: function (text) { rec.spammer.push({ action: 'add', text: text }); return true; },
      remove: function (text) { rec.spammer.push({ action: 'remove', text: text }); return true; },
      clear: function () { rec.spammer.push({ action: 'clear' }); return true; },
      start: function () { rec.spammer.push({ action: 'start' }); return true; },
      stop: function () { rec.spammer.push({ action: 'stop' }); return true; },
      restart: function () { rec.spammer.push({ action: 'restart' }); return true; },
      setDelay: function (ms) { rec.spammer.push({ action: 'setDelay', ms: ms }); return true; }
    } : opts.spammer,
    timers: {
      setTimeout: function (fn, ms) { rec.timers.push({ fn: fn, ms: ms }); return rec.timers.length; },
      clearTimeout: function (id) { rec.timers.push({ cleared: id }); }
    },
    // The auto-zone panel (#44), which the plugin shell wires and a test here may stand in for.
    specialHandler: opts.specialHandler,
    sleep: function (ms) { rec.waited.push(ms); return Promise.resolve(); },
    log: function (line) { rec.records.push(line); },
    logDebug: function (line) { rec.debug.push(line); },
    logClear: function () { rec.cleared.push('clear'); }
  });
  Object.keys(rec).forEach(function (key) { made[key] = rec[key]; });
  return made;
}

/** Run one command through the loop the way the reference's Activate does. */
async function run(made, className, properties, settings) {
  await made.start(bot([command(className, properties || {}), command('CmdStop', {})], settings));
  await made.tick();
  return made;
}

/** The loader calls a session was asked for, by helper name. */
function loaderNames(session) {
  return session.calls.filter(function (call) { return call.name === 'loader'; })
    .map(function (call) { return call.args[0]; });
}

// ------------------------------------------------------------------ the set, and the no-op rows

test('every miscellaneous class the reference declares is one this engine executes', () => {
  // Everything under Grimoire/Botting/Commands/Misc/ that is a command rather than a statement.
  const classes = ['CmdBackgroundPacket', 'CmdBankList', 'CmdBeep', 'CmdBlank', 'CmdBlank2',
    'CmdBlank3', 'CmdBotDelay', 'CmdChange', 'CmdClearTemp', 'CmdClientMessage', 'CmdDelay',
    'CmdGotoLabel', 'CmdGotoPlayer', 'CmdIndex', 'CmdInt', 'CmdInt2', 'CmdLabel', 'CmdLoadBot',
    'CmdLog', 'CmdLogout', 'CmdPacket', 'CmdPacketDelay', 'CmdPacketSpammer', 'CmdPing',
    'CmdProvoke', 'CmdRestart', 'CmdReturn', 'CmdSetFPS', 'CmdSpecialHandler', 'CmdStop',
    'CmdTauntcycle', 'CmdToggleProvoke'];
  const made = engine();
  const missing = classes.filter(function (className) { return !made.handlers()[className]; });
  assert.deepStrictEqual(missing, [], 'the reference ships these and the engine does not run them');
  classes.forEach(function (className) {
    assert.strictEqual(catalog.GROUPS[className], 'Misc', className + ' is a Misc command class');
    assert.ok(catalog.DISPLAY[className], className + ' carries its own reference ToString');
  });
});

test('CmdPing is a class the reference declares, and shows its own ToString', () => {
  assert.strictEqual(catalog.GROUPS.CmdPing, 'Misc');
  assert.strictEqual(catalog.display({ $type: catalog.fullType('CmdPing'), Count: 10, PopMsg: false }),
    'Ping: 10x beep ', 'the trailing space is the reference own string');
  assert.strictEqual(catalog.display({ $type: catalog.fullType('CmdPing'), Count: 3, PopMsg: true }),
    'Ping: 3x beep and pop msg');
});

test('CmdBankList executes nothing, which is what the reference own Execute is', async () => {
  const session = fakeSession();
  const made = await run(engine({ session: session }), 'CmdBankList', {});
  assert.deepStrictEqual(loaderNames(session), [], 'its own body is empty, so it reads nothing');
  assert.strictEqual(made.records.filter(function (l) { return /not implemented/.test(l); }).length, 0);
});

test('the commands with no game dependency run with no game at all', async () => {
  const session = fakeSession();
  const made = engine({ session: session });
  await made.start(bot([
    command('CmdBlank', {}),
    command('CmdBlank2', { Text: 'x' }),
    command('CmdBlank3', { Text: 'y' }),
    command('CmdInt', { Int: 'n', Value: 2, type: 0 }),
    command('CmdInt2', { IntKey: 'm', Value: '3' }),
    command('CmdClearTemp', {}),
    command('CmdDelay', { Delay: 10 }),
    command('CmdBotDelay', { Delay: 0 }),
    command('CmdBankList', {}),
    command('CmdBeep', { Times: 2 }),
    command('CmdPing', { Count: 1, PopMsg: false }),
    command('CmdStop', {})
  ]));
  const before = session.calls.length;
  for (let i = 0; i < 20 && made.running(); i++) await made.tick();
  assert.strictEqual(made.running(), false, 'the list runs to its own stop');
  // The loop's own liveness reads are the only calls a bot of these commands makes. Anything
  // else is a game dependency leaking into a command the reference gives none.
  const seen = session.calls.slice(before).filter(function (call) {
    return ['signedIn', 'alive', 'ready'].indexOf(call.name) === -1;
  });
  assert.deepStrictEqual(seen, [], 'these commands must not reach the game: ' + JSON.stringify(seen));
  assert.deepStrictEqual(made.beeps, [2, 1]);
  assert.deepStrictEqual(made.waited, [10]);
});

test('CmdBeep beeps Times times, and its default is the reference own 10', async () => {
  assert.deepStrictEqual((await run(engine(), 'CmdBeep', {})).beeps, [10]);
  assert.deepStrictEqual((await run(engine(), 'CmdBeep', { Times: 0 })).beeps, [0],
    'a loop for i < 0 runs no times');
  assert.deepStrictEqual((await run(engine(), 'CmdBeep', { Times: 3 })).beeps, [3]);
});

test('CmdPing beeps Count times and says so only when it is asked to pop its message', async () => {
  const quiet = await run(engine(), 'CmdPing', {});
  assert.deepStrictEqual(quiet.beeps, [10], 'Count defaults to 10');
  assert.strictEqual(quiet.records.filter(function (l) { return /ping/i.test(l); }).length, 1);
  const pop = await run(engine(), 'CmdPing', { Count: 2, PopMsg: true });
  assert.deepStrictEqual(pop.beeps, [2]);
  assert.ok(pop.records.some(function (l) { return /pop msg/i.test(l); }), pop.records.join('|'));
});

// ------------------------------------------------------------------ steering the client

test('CmdChange asks the loader for the helper the reference registers, name or guild', async () => {
  const named = fakeSession();
  await run(engine({ session: named }), 'CmdChange', { Guild: false, Text: 'Neo' });
  assert.deepStrictEqual(loaderNames(named), ['ChangeName']);
  assert.deepStrictEqual(named.calls.filter(function (c) { return c.name === 'loader'; })[0].args,
    ['ChangeName', 'Neo']);

  const guild = fakeSession();
  await run(engine({ session: guild }), 'CmdChange', { Guild: true, Text: 'Knights' });
  assert.deepStrictEqual(loaderNames(guild), ['ChangeGuild']);
});

test('a helper the loader surface refuses is reported with its own reason, never as success', async () => {
  // The session is a stand-in that answers only the names it was given, so this is the shape a
  // surface refusal takes on the way to the bot's log.
  const session = fakeSession();
  const made = await run(engine({ session: session }), 'CmdChange', { Text: 'Neo' });
  assert.ok(made.records.some(function (l) { return /ChangeName/.test(l) && /no helper/.test(l); }),
    made.records.join('|'));
});

test('CmdLogout is the one root call the loader registers for it', async () => {
  const session = fakeSession();
  const made = await run(engine({ session: session }), 'CmdLogout', {});
  assert.deepStrictEqual(loaderNames(session), ['Logout']);
  assert.strictEqual(made.running(), true, 'logging out does not stop the bot');
});

test('CmdGotoPlayer goes first and then waits, over the list it read before the goto', async () => {
  // Player.GoToPlayer(name); if (playersInMap contains name) delay(500) else WaitUntil(..., 40).
  const session = fakeSession({ state: { players: ['other', 'Target'] } });
  const fixed = session.loaderCall;
  session.loaderCall = function (name, args) {
    return fixed(name, args);
  };
  const made = await run(engine({ session: session }), 'CmdGotoPlayer', { PlayerName: 'Target' });
  assert.deepStrictEqual(loaderNames(session), ['PlayersInMap', 'GoTo'],
    'the list is read once, before the goto, and is never re-read on this branch');
  assert.deepStrictEqual(session.calls.filter(function (c) { return c.name === 'loader'; })[1].args,
    ['GoTo', 'Target']);
  assert.deepStrictEqual(made.waited, [500], 'a player already in the map is waited out once');
});


test('CmdGotoPlayer polls until a player it is waiting for arrives, then stops', async () => {
  const session = fakeSession({ state: { players: [] } });
  const made = engine({ session: session });
  let seen = 0;
  session.loaderCall = (function (original) {
    return function (name, args) {
      if (name === 'PlayersInMap') {
        seen++;
        // The third read finds them, which is what a player walking into the map looks like.
        session.state.players = seen >= 3 ? ['Latecomer'] : [];
      }
      return original(name, args);
    };
  })(session.loaderCall.bind(session));
  await run(made, 'CmdGotoPlayer', { PlayerName: 'Latecomer' });
  assert.strictEqual(seen, 3, 'the list is read once up front and twice by the poll, which stops');
  assert.strictEqual(made.running(), true, 'and the bot walks on to its next command');
  // WaitUntil's own loop sleeps only after a try that failed - the try that finds the player
  // exits without a wait - so one failed try is one 1000 ms interval (BotUtilities.WaitUntil).
  assert.deepStrictEqual(made.waited, [1000], 'WaitUntil sleeps one interval per failed try');
});

test('CmdGotoPlayer resolves a variable name the way the reference does', async () => {
  const session = fakeSession({ state: { players: ['Friend'] } });
  const made = engine({ session: session });
  await made.start(bot([
    catalog.makeStatement('CmdSetVar', 'who', 'Friend'),
    command('CmdGotoPlayer', { PlayerName: '[who]' }),
    command('CmdStop', {})
  ]));
  await made.tick();
  await made.tick();
  assert.deepStrictEqual(session.calls.filter(function (c) { return c.name === 'loader'; })[1].args,
    ['GoTo', 'Friend']);
});

test('CmdClientMessage pushes one chat line with the reference own six arguments', async () => {
  const session = fakeSession();
  await run(engine({ session: session }), 'CmdClientMessage',
    { Messages: 'hello', IsWarning: true, HexColor: 'FFC0CB', SenderName: 'SERVER' });
  assert.deepStrictEqual(session.calls.filter(function (c) { return c.name === 'clientMessage'; })[0].args,
    ['warning', "<font color='#FFC0CB'>hello</font>", 'SERVER']);

  // MsgType is its own field and is resolved; IsWarning wins over it; no colour adds no tag.
  const plain = fakeSession();
  await run(engine({ session: plain }), 'CmdClientMessage', { Messages: 'hi', MsgType: 'moderator' });
  assert.deepStrictEqual(plain.calls.filter(function (c) { return c.name === 'clientMessage'; })[0].args,
    ['moderator', 'hi', 'SERVER']);
});

test('CmdProvoke sets provoke, and CmdToggleProvoke follows its own Type', async () => {
  const off = await run(engine(), 'CmdProvoke', { Set: false });
  assert.deepStrictEqual(off.setProvoke, [false]);
  const on = await run(engine(), 'CmdProvoke', { Set: true });
  assert.deepStrictEqual(on.setProvoke, [true]);

  assert.deepStrictEqual((await run(engine(), 'CmdToggleProvoke', { Type: 0 })).setProvoke, [false]);
  assert.deepStrictEqual((await run(engine(), 'CmdToggleProvoke', { Type: 1 })).setProvoke, [true]);
  // Type 2 (or anything else) is the opposite of what is on now.
  assert.deepStrictEqual((await run(engine({ provokeNow: true }), 'CmdToggleProvoke', {})).setProvoke,
    [false], 'on becomes off');
  assert.deepStrictEqual((await run(engine({ provokeNow: false }), 'CmdToggleProvoke', {})).setProvoke,
    [true], 'off becomes on');
});

test('a provoke the Options window cannot answer is reported, not an unhandled rejection', async () => {
  // The real seam is the Options feature (#34), whose setToggle reaches the game and answers
  // { ok, error }. In a bot that refusal has to reach the log; an unhandled rejection would kill
  // the loop or vanish into the console.
  const refused = engine({
    options: {
      setProvoke: function () { return Promise.resolve({ ok: false, error: 'Hide Players has no route' }); },
      getProvoke: function () { return false; }
    }
  });
  await run(refused, 'CmdProvoke', { Set: true });
  assert.ok(refused.records.some(function (l) {
    return /CmdProvoke/.test(l) && /Hide Players has no route/.test(l);
  }), 'the window own reason reaches the log: ' + refused.records.join('|'));

  const threw = engine({
    options: { setProvoke: function () { return Promise.reject(new Error('the bridge is not attached')); } }
  });
  await run(threw, 'CmdToggleProvoke', { Type: 1 });
  assert.ok(threw.records.some(function (l) {
    return /CmdToggleProvoke/.test(l) && /not attached/.test(l);
  }), 'a rejected toggle is reported too: ' + threw.records.join('|'));

  // No options seam at all - the plugin wired one, but a build that did not must say so rather
  // than reporting a tick that never moved.
  const none = await run(engine({ options: null }), 'CmdProvoke', { Set: true });
  assert.ok(none.records.some(function (l) { return /no option toggles wired/.test(l); }),
    'a build with no toggles says so: ' + none.records.join('|'));
});

// ------------------------------------------------------------------ the packet-shaped helpers

test('a packet gets the reference own substitutions: rooms, name, map, dashes and the 1e stamp', () => {
  const random = { next: function (min) { return min; } };
  assert.strictEqual(
    misc.packetText('%.%{ROOM_ID}%{ROOM_NUMBER}%{GETMAP}%PLAYERNAME%a----b%1e777%',
      { roomId: '7', roomNumber: '99', map: 'yokai', username: 'Neo' }, random),
    '%.%7%99%yokai%Neo%a-b%1001%');
  assert.strictEqual(misc.packetText('1e', {}, random), '1e', 'the stamp needs its digits');
  assert.strictEqual(misc.packetText('1e9', {}, { next: function () { return 4242; } }), '4242');
  // A value that was not read is left as written rather than sent as a blank field.
  assert.strictEqual(misc.packetText('a{ROOM_ID}b', {}), 'a{ROOM_ID}b');
});

test('a client-side "Level n" frame becomes the reference own levelUp JSON', () => {
  assert.strictEqual(misc.levelUpPacket('Level 30'),
    '{"t":"xt","b":{"r":-1,"o":{"cmd":"levelUp","intExpToLevel":"200000","intLevel":30}}}');
  assert.strictEqual(misc.levelUpPacket('%xt%zm%gar%'), null, 'anything else is sent as written');
  assert.strictEqual(misc.levelUpPacket('Level'), null);
});

test('CmdPacket sends SpamTimes frames, one delay apart, to the side it was told', async () => {
  const made = await run(engine(), 'CmdPacket', { Packet: '%xt%zm%gar%', SpamTimes: 3, Delay: 250 });
  assert.deepStrictEqual(made.sent, [
    { direction: 'toServer', text: '%xt%zm%gar%' },
    { direction: 'toServer', text: '%xt%zm%gar%' },
    { direction: 'toServer', text: '%xt%zm%gar%' }
  ]);
  assert.deepStrictEqual(made.waited.slice(0, 3), [250, 250, 250]);

  const client = await run(engine(), 'CmdPacket', { Packet: 'x', ForClient: true });
  assert.deepStrictEqual(client.sent, [{ direction: 'toClient', text: 'x' }],
    'ForClient or Client sends to the client; SpamTimes defaults to 1');
});

test('CmdPacket resolves its frame through the engine own variables first', async () => {
  const made = engine();
  await made.start(bot([
    catalog.makeStatement('CmdSetVar', 'p', '%r%[id]%'),
    command('CmdInt', { Int: 'id', Value: 12, type: 0 }),
    command('CmdPacket', { Packet: '[p]' }),
    command('CmdStop', {})
  ]));
  await made.tick();
  await made.tick();
  await made.tick();
  assert.deepStrictEqual(made.sent, [{ direction: 'toServer', text: '%r%12%' }]);
});

test('CmdPacket rewrites a level frame it sends to the client', async () => {
  const made = await run(engine(), 'CmdPacket', { Packet: 'Level 55', ForClient: true });
  assert.strictEqual(made.sent[0].text, misc.levelUpPacket('Level 55'));
});

test('CmdPacketDelay waits first and sends once, which is the reference own order', async () => {
  const made = await run(engine(), 'CmdPacketDelay', { Packet: 'x', Delay: 700 });
  assert.deepStrictEqual(made.sent, [{ direction: 'toServer', text: 'x' }]);
  assert.deepStrictEqual(made.waited.slice(0, 1), [700],
    'the delay comes first, before anything reaches the relay');

  const client = await run(engine(), 'CmdPacketDelay', { Packet: 'x', Delay: 700, Client: true });
  assert.deepStrictEqual(client.sent, [{ direction: 'toClient', text: 'x' }]);
});

test('the two packet classes keep their own Delay defaults, which differ upstream', async () => {
  // CmdPacket's own initialiser is 1000; CmdPacketDelay carries none, so a file without the key
  // sends straight away. Sharing one default would make one of the two behave unlike the client
  // it says it is, which is the whole point of the ticket.
  assert.deepStrictEqual((await run(engine(), 'CmdPacket', { Packet: 'x', SpamTimes: 2 })).waited,
    [1000, 1000], 'CmdPacket paces itself 1000 ms by default');
  assert.deepStrictEqual((await run(engine(), 'CmdPacketDelay', { Packet: 'x' })).waited, [],
    'CmdPacketDelay waits nothing when its Delay is not set');
});

test('a frame the relay will not take is reported, not counted as sent', async () => {
  const made = await run(engine({ accept: false }), 'CmdPacket', { Packet: 'x' });
  assert.deepStrictEqual(made.sent, [{ direction: 'toServer', text: 'x' }], 'the write was attempted');
  assert.ok(made.records.some(function (l) { return /CmdPacket/.test(l) && /not written/.test(l); }),
    'a refused write says so: ' + made.records.join('|'));
});

test('a bot that is not signed in does not run its packet loop', async () => {
  // Player.IsLoggedIn is one of the three conditions CmdPacket's own while loop tests.
  const session = fakeSession({ state: { signedIn: false } });
  const made = engine({ session: session });
  const started = await made.start(bot([command('CmdPacket', { Packet: 'x', SpamTimes: 5 })]));
  assert.strictEqual(started.ok, false, 'the engine refuses to start at all while signed out');
  assert.deepStrictEqual(made.sent, []);
});

test('CmdPacketSpammer drives the spammer window, one action per CommandType', async () => {
  const cases = [
    [{ type: 0, Packet: 'p' }, { action: 'add', text: 'p' }],
    [{ type: 1, Packet: 'p' }, { action: 'remove', text: 'p' }],
    [{ type: 2 }, { action: 'start' }],
    [{ type: 3 }, { action: 'stop' }],
    [{ type: 4 }, { action: 'clear' }],
    [{ type: 5 }, { action: 'restart' }],
    [{ type: 6, Delay: 500 }, { action: 'setDelay', ms: 500 }]
  ];
  for (const item of cases) {
    const made = await run(engine(), 'CmdPacketSpammer', item[0]);
    assert.deepStrictEqual(made.spammer, [item[1]], JSON.stringify(item[0]));
  }
  // GoPressTheGodDamnCorrectButton has no branch in the reference either.
  const none = await run(engine(), 'CmdPacketSpammer', { type: 7 });
  assert.deepStrictEqual(none.spammer, []);
  assert.ok(none.records.some(function (l) { return /CmdPacketSpammer/.test(l); }),
    'a no-op says so instead of pretending: ' + none.records.join('|'));

  const noWindow = await run(engine({ spammer: null }), 'CmdPacketSpammer', { type: 2 });
  assert.ok(noWindow.records.some(function (l) { return /no Packet spammer/.test(l); }),
    'no spammer window is reported: ' + noWindow.records.join('|'));
});

// ------------------------------------------------------------------ background packets

test('CmdBackgroundPacket holds its label and sends on the pace it was given', async () => {
  const made = await run(engine(), 'CmdBackgroundPacket',
    { ActionW: 0, Label: 'bs', Packet: 'p', Delay: 500 });
  assert.deepStrictEqual(made.sent, [{ direction: 'toServer', text: 'p' }], 'the first frame is at once');
  assert.deepStrictEqual(made.background().labels, ['bs']);
  const pending = made.timers.filter(function (t) { return t.fn; });
  assert.strictEqual(pending.length, 1);
  assert.strictEqual(pending[0].ms, 500, 'the wait between frames is the command own Delay');
  pending[0].fn();
  assert.strictEqual(made.sent.length, 2, 'the next frame goes out on the tick it was paced for');
  assert.strictEqual(made.timers.filter(function (t) { return t.fn; }).length, 2, 'and it keeps its pace');
  made.stop();
  const after = made.timers.filter(function (t) { return t.fn; }).length;
  made.timers[made.timers.length - 3].fn();
  assert.strictEqual(made.sent.length, 2, 'a stopped bot sends nothing more');
  assert.strictEqual(made.timers.filter(function (t) { return t.fn; }).length, after);
});

test('a STOP takes the label back, and the loop guards itself on both ends', async () => {
  const made = engine();
  await made.start(bot([
    command('CmdBackgroundPacket', { ActionW: 0, Label: 'bs', Packet: 'p', Delay: 100 }),
    command('CmdBackgroundPacket', { ActionW: 1, Label: 'bs', Packet: '-LEAVE ME BLANK-', Delay: 6969 }),
    command('CmdStop', {})
  ]));
  await made.tick();
  assert.deepStrictEqual(made.background().labels, ['bs']);
  await made.tick();
  assert.deepStrictEqual(made.background().labels, [], 'RemoveAll takes every copy of the label');
  assert.strictEqual(made.sent.length, 1, 'the STOP itself sends nothing');

  // Packet != null guards the loop: a command with no packet holds its label and sends nothing.
  const nulled = await run(engine(), 'CmdBackgroundPacket', { ActionW: 0, Label: 'bs', Packet: null });
  assert.deepStrictEqual(nulled.sent, []);
  assert.deepStrictEqual(nulled.background().labels, ['bs']);
});

// ------------------------------------------------------------------ load-bot and return

test('CmdLoadBot resolves a path the way the reference does, adapted for a Linux layout', () => {
  const root = '/home/player/Bots';
  const files = ['/home/player/Bots/Arcana/lovers.gbot', '/home/player/Bots/top.gbot',
    '/home/player/Bots/Arcana/ref.gbot', '/absolute/elsewhere.gbot'];
  const exists = function (file) { return files.indexOf(file) !== -1; };

  // What this app's own tree writes: the path below the bots directory.
  assert.strictEqual(misc.resolveBotPath('Arcana/lovers.gbot', root, exists),
    '/home/player/Bots/Arcana/lovers.gbot');
  assert.strictEqual(misc.resolveBotPath('top.gbot', root, exists), '/home/player/Bots/top.gbot');
  // What a Windows client writes: relative to the folder its Bots/ sits in, which is the same
  // root here, so both spellings have to land on the same file.
  assert.strictEqual(misc.resolveBotPath('Bots/Arcana/ref.gbot', root, exists),
    '/home/player/Bots/Arcana/ref.gbot');
  assert.strictEqual(misc.resolveBotPath('Bots\\Arcana\\ref.gbot', root, exists),
    '/home/player/Bots/Arcana/ref.gbot', 'a Windows separator is the same path');
  // Absolute wins over the root, and a path that is nowhere is null rather than an invention.
  assert.strictEqual(misc.resolveBotPath('/absolute/elsewhere.gbot', root, exists),
    '/absolute/elsewhere.gbot');
  assert.strictEqual(misc.resolveBotPath('nope.gbot', root, exists), null);
  assert.strictEqual(misc.resolveBotPath('', root, exists), null);
});

test('CmdLoadBot loads the file, pushes the running one and starts the new list from the top', async () => {
  const loaded = { Commands: [command('CmdBlank', {}), command('CmdStop', {})],
    Drops: { $type: 'System.Collections.Generic.List', $values: ['New Drop'] } };
  const files = { '/home/player/Bots/Arcana/lovers.gbot': JSON.stringify(loaded) };
  const made = engine({
    botsDirectory: function () { return '/home/player/Bots'; },
    exists: function (file) { return Object.prototype.hasOwnProperty.call(files, file); },
    readFile: function (file) { return files[file]; }
  });
  await made.start(bot([
    command('CmdLoadBot', { BotFileName: 'lovers.gbot', BotFilePath: 'Arcana/lovers.gbot' }),
    command('CmdStop', {})
  ], { Drops: ['Old Drop'] }));
  await made.tick();
  assert.deepStrictEqual(made.commands().map(catalog.classNameOf), ['CmdBlank', 'CmdStop'],
    'the loaded configuration is the one the loop now walks');
  assert.strictEqual(made.index(), 0, 'Index = -1 and the loop own increment puts it at the top');
  assert.deepStrictEqual(made.drops(), ['New Drop', 'Old Drop'],
    'PassDropList defaults true, so the old drops are unioned in');
});

test('a merged drop list is a HashSet with the reference own case-insensitive comparer', async () => {
  // `new HashSet<string>(drops, StringComparer.OrdinalIgnoreCase).UnionWith(old)`: a drop the
  // new list already carries in different case is the same drop, so it is not added twice.
  const loaded = { Commands: [command('CmdStop', {})], Drops: ['Fire Staff', 'new drop'] };
  const files = { '/b/x.gbot': JSON.stringify(loaded) };
  const made = engine({
    botsDirectory: function () { return '/b'; },
    exists: function (file) { return Object.prototype.hasOwnProperty.call(files, file); },
    readFile: function (file) { return files[file]; }
  });
  await made.start(bot([command('CmdLoadBot', { BotFilePath: 'x.gbot' })],
    { Drops: ['FIRE STAFF', 'New Drop', 'Something Else'] }));
  await made.tick();
  assert.deepStrictEqual(made.drops(), ['Fire Staff', 'new drop', 'Something Else']);
});

test('CmdLoadBot keeps the old skills only when PassSkillPreset asks for them', async () => {
  const skills = [{ $type: 'Grimoire.Game.Data.Skill, Grimoire', Index: '1' }];
  const files = { '/b/x.gbot': JSON.stringify({ Commands: [command('CmdStop', {})] }) };
  const seams = {
    botsDirectory: function () { return '/b'; },
    exists: function (file) { return Object.prototype.hasOwnProperty.call(files, file); },
    readFile: function (file) { return files[file]; }
  };
  const keep = engine(Object.assign({}, seams));
  await keep.start(bot([command('CmdLoadBot', { BotFilePath: 'x.gbot', PassSkillPreset: true })],
    { Skills: skills }));
  await keep.tick();
  assert.deepStrictEqual(keep.skills(), skills, 'PassSkillPreset keeps the running set');

  const drop = engine(Object.assign({}, seams));
  await drop.start(bot([command('CmdLoadBot', { BotFilePath: 'x.gbot' })], { Skills: skills }));
  await drop.tick();
  assert.deepStrictEqual(drop.skills(), [],
    'otherwise the loaded configuration has only its own set, and this one has none');
});

test('CmdLoadBot reports a file it cannot reach or read instead of pretending it loaded', async () => {
  const missing = engine({
    botsDirectory: function () { return '/b'; },
    exists: function () { return false; },
    readFile: function () { return null; }
  });
  await run(missing, 'CmdLoadBot', { BotFilePath: 'gone.gbot' });
  assert.ok(missing.records.some(function (l) { return /gone.gbot/.test(l); }),
    'a file that is not there is named: ' + missing.records.join('|'));

  const broken = engine({
    botsDirectory: function () { return '/b'; },
    exists: function () { return true; },
    readFile: function () { return 'not json at all'; }
  });
  await run(broken, 'CmdLoadBot', { BotFilePath: 'bad.gbot' });
  assert.ok(broken.records.some(function (l) { return /not a Grimlite bot/.test(l); }),
    'a file that will not parse gives the reader own reason: ' + broken.records.join('|'));

  // The build itself reads bot files (the plugin wires an fs reader); a build without one has
  // to say that rather than reporting a path it never looked for.
  const noReader = engine({
    botsDirectory: function () { return '/b'; },
    exists: function (file) { return file === '/b/x.gbot'; },
    readFile: null
  });
  await run(noReader, 'CmdLoadBot', { BotFilePath: 'x.gbot' });
  assert.ok(noReader.records.some(function (l) { return /cannot read bot files/.test(l); }),
    'a build with no file reader says so: ' + noReader.records.join('|'));
});

test('CmdReturn goes back to the configuration the last load-bot pushed', async () => {
  const files = { '/b/x.gbot': JSON.stringify({ Commands: [command('CmdReturn', {}), command('CmdStop', {})] }) };
  const made = engine({
    botsDirectory: function () { return '/b'; },
    exists: function (file) { return Object.prototype.hasOwnProperty.call(files, file); },
    readFile: function (file) { return files[file]; }
  });
  await made.start(bot([command('CmdLoadBot', { BotFilePath: 'x.gbot' }), command('CmdStop', {})],
    { Drops: [] }));
  await made.tick();
  assert.deepStrictEqual(made.commands().map(catalog.classNameOf), ['CmdReturn', 'CmdStop']);
  await made.tick();
  assert.deepStrictEqual(made.commands().map(catalog.classNameOf), ['CmdLoadBot', 'CmdStop'],
    'the old configuration is back');
  assert.strictEqual(made.index(), 1, 'and the index it was left at comes back with it');
});

test('CmdReturn with nothing on the stack is a no-op, not a crash', async () => {
  // The reference's own Execute is wrapped in a try, and Bot.Configurations[-1] throws inside it.
  const made = await run(engine(), 'CmdReturn', {});
  assert.strictEqual(made.running(), true, 'the bot walks on');
  assert.strictEqual(made.index(), 1);
});

// ------------------------------------------------------------------ CmdLog

test('CmdLog substitutes the reference own templates', async () => {
  const session = fakeSession({ answers: {
    Map: 'yokai', RoomId: '3', RoomNumber: '1234', Gold: 500, Level: 42, Cell: 'Enter',
    Pad: 'Spawn', Health: 900, Mana: 300,
    GetInventoryItems: [{ sName: 'Sword', iQty: 2, iStk: 99 }],
    GetFactions: [{ sName: 'Good', iRep: 10, iRepToRank: 50, iRank: 3, iSpillRep: 4 }]
  } });
  const made = engine({ session: session });
  await made.start(bot([
    command('CmdInt', { Int: 'n', Value: 9, type: 0 }),
    command('CmdLog', { Text: '{MAP} {ROOM_ID}-{ROOM_NUM} {LEVEL} {GOLD} {CELL} {PAD} ' +
      '{HEALTH} {MANA} {ITEM: Sword} {ITEM MAX: Sword} {REP XP: Good} {REP CURRENT: Good} ' +
      '{REP REMAINING: Good} {REP REQUIRED: Good} {REP RANK: Good} {REP TOTAL: Good} ' +
      '{INT VALUE: n} {USERNAME}' }),
    command('CmdStop', {})
  ]));
  await made.tick();
  await made.tick();
  const line = made.records.filter(function (l) { return /yokai/.test(l); })[0];
  assert.strictEqual(line, 'yokai 3-1234 42 500 Enter Spawn 900 300 2 99 4/50 4 46 50 3 10 9 Tester');
});

test('CmdLog sends its output to the pane its own Debug flag names, and {CLEAR} is logged literally', async () => {
  const script = await run(engine(), 'CmdLog', { Text: 'plain' });
  assert.ok(script.records.some(function (l) { return l === 'plain'; }), script.records.join('|'));
  assert.deepStrictEqual(script.debug, []);

  const debug = await run(engine(), 'CmdLog', { Text: 'quiet', Debug: true });
  assert.ok(debug.debug.some(function (l) { return l === 'quiet'; }), debug.debug.join('|'));
  assert.strictEqual(debug.records.filter(function (l) { return l === 'quiet'; }).length, 0);

  const cleared = await run(engine(), 'CmdLog', { Text: '{CLEAR}' });
  assert.deepStrictEqual(cleared.cleared, [],
    'CmdLog.Clear is never set from Text, so the pane is not cleared');
  assert.ok(cleared.records.some(function (l) { return l.indexOf('{CLEAR}') !== -1; }),
    'and then appends that very text, which is what the reference own pane does: ' +
    cleared.records.join('|'));
});

test('CmdLog colours what lies between its own markers, one colour per backslash segment', () => {
  const marked = misc.logText('a>b<c\\FF0000', {});
  assert.strictEqual(marked.plain, 'abc', 'the pane gets the text without the markers');
  assert.strictEqual(marked.marked, "a<font color='#FF0000'>b</font>c");
  const uncoloured = misc.logText('x>y<z', {});
  assert.strictEqual(uncoloured.marked, "x<font color='#FFFFFF'>y</font>z",
    'a segment with no colour of its own is the reference own FFFFFF');
});

test('a refusal carries the surface own reason once, however the refusal was worded', () => {
  const row = { why: 'the reference sets the SWF stage frame rate' };
  // The bridge's own rejection already ends with the row's reason (loader-surface.js
  // unsupported()), so adding it again would print it twice.
  const carried = 'SetFPS is not implemented: the reference sets the SWF stage frame rate';
  assert.strictEqual(misc.refusalText(carried, row, 'SetFPS'), carried);
  // A refusal that does not carry it - a stand-in, or a name the surface has no row for - gets it.
  assert.strictEqual(misc.refusalText('no helper named "SetFPS" is implemented', row, 'SetFPS'),
    'no helper named "SetFPS" is implemented - the surface own reason for SetFPS: ' +
    'the reference sets the SWF stage frame rate');
  assert.strictEqual(misc.refusalText('a helper is missing', undefined, 'Whatever'),
    'a helper is missing', 'a name with no reason row adds nothing');
  assert.strictEqual(misc.refusalText('a helper is missing', { get: 'world.strFrame' }, 'Whatever'),
    'a helper is missing', 'a row that answers adds nothing either');
});

// ------------------------------------------------------------------ what this loop cannot do

test('a command whose own call this build cannot make says so and names the owner', async () => {
  const fps = await run(engine(), 'CmdSetFPS', { FPS: 30 });
  assert.ok(fps.records.some(function (l) { return /CmdSetFPS/.test(l) && /stage|frame rate/.test(l); }),
    'CmdSetFPS carries the surface own reason: ' + fps.records.join('|'));

  const taunt = await run(engine(), 'CmdTauntcycle', { type: 0 });
  assert.ok(taunt.records.some(function (l) { return /taunt/i.test(l) && /handler wired/.test(l); }),
    'CmdTauntcycle reports a window with no taunt-cycle handler: ' + taunt.records.join('|'));
});

test('CmdTauntcycle starts and stops the rotation the reference starts there', async () => {
  // TauntCycle.cs:22-60, which the Misc 2 buttons and the .gbot file both reach: StartTaunt
  // resolves a dynamic order from the character's own place in the map's player list, then runs
  // the rotation; Stop cancels it. The rotation itself is the maid half's (#44), handed in the
  // way SetSpecialHandlerFromScript hands the auto-zone panel: an accessor, because the engine
  // is built before the maid it drives.
  const started = [];
  const panel = {
    startTaunt: function (cycle, mon, second, count) {
      started.push({ cycle: cycle, mon: mon, second: second, count: count });
      return { ok: true, running: true };
    },
    stopTaunt: function () { started.push({ stop: true }); return { ok: true, stopped: true }; }
  };
  const session = fakeSession({ state: { players: ['master', 'me'], username: 'me' } });
  const specialHandler = function () { return panel; };
  const made = await run(engine({ session: session, specialHandler: specialHandler }),
    'CmdTauntcycle', { type: 0, cycle: 4, target: 'Gramiel', second: 20, order: -1 });
  assert.deepStrictEqual(started, [{ cycle: 4, mon: 'Gramiel', second: 20, count: 1 }],
    'order <= 0 resolves to this character\'s own index in the player list');
  assert.ok(made.records.some(function (l) { return /CmdTauntcycle/.test(l) && /Gramiel/.test(l); }),
    'and the shape is reported: ' + made.records.join('|'));

  started.length = 0;
  await run(engine({ session: session, specialHandler: specialHandler }),
    'CmdTauntcycle', { type: 1 });
  assert.deepStrictEqual(started, [{ stop: true }], 'Stop cancels the rotation');
});

test('a special handler with no zone is the reference own silent return', async () => {
  const made = await run(engine(), 'CmdSpecialHandler', { Mode: 0 });
  assert.deepStrictEqual(made.records.filter(function (l) { return /SpecialHandler/.test(l); }), []);
});

test('CmdSpecialHandler drives the auto-zone panel the way SetSpecialHandlerFromScript does', async () => {
  // BotManager.cs:3442-3467: find the combo entry by exact name, set `chkSpecial.Checked` only when
  // the mode has an opinion (Switch passes null, so the box is left as it is), then run
  // UpdateSpecialHandler. The panel itself is features/maid/zones.js and is handed in as a seam, so
  // what this measures is the command's own three branches.
  const set = [];
  const panel = {
    names: function () { return ['Auto Zone - Ultradage', 'Gramiel P1']; },
    set: function (zone, wanted) { set.push({ zone: zone, wanted: wanted }); return zone; }
  };
  // The seam is the accessor the shell passes, which reads the panel when a command runs.
  const accessor = { specialHandler: function () { return panel; } };
  const withPanel = function () { return engine(accessor); };

  await run(withPanel(), 'CmdSpecialHandler', { Zone: 'Auto Zone - Ultradage', Mode: 0 });
  await run(withPanel(), 'CmdSpecialHandler', { Zone: 'Gramiel P1', Mode: 2 });
  assert.deepStrictEqual(set, [
    { zone: 'Auto Zone - Ultradage', wanted: true },
    { zone: 'Gramiel P1', wanted: null }
  ], 'Start enables, Stop disables, Switch leaves the box as it was');

  // Stop, and the same panel call with the box turned off.
  set.length = 0;
  await run(withPanel(), 'CmdSpecialHandler', { Zone: 'Gramiel P1', Mode: 1 });
  assert.deepStrictEqual(set, [{ zone: 'Gramiel P1', wanted: false }]);

  // A name the combo does not carry leaves the selection alone, but the reference still changes
  // the checkbox and runs UpdateSpecialHandler on that existing selection.
  set.length = 0;
  const unknown = await run(withPanel(), 'CmdSpecialHandler', { Zone: 'Auto Zone - Utgarde', Mode: 1 });
  assert.deepStrictEqual(set, [{ zone: 'Auto Zone - Utgarde', wanted: false }],
    'the stale name still sends Stop to the current selection');
  assert.ok(unknown.records.some(function (l) { return /existing selection/.test(l); }),
    'and reports what it affected: ' + unknown.records.join('|'));

  // With no panel wired the command reports that too, rather than looking like it worked.
  const bare = await run(engine(), 'CmdSpecialHandler', { Zone: 'Gramiel P1', Mode: 0 });
  assert.ok(bare.records.some(function (l) { return /no auto-zone panel wired/.test(l); }),
    'a window without the panel says so: ' + bare.records.join('|'));
});

test('every loader name these commands ask for is one the surface answers', () => {
  const done = surface.implemented();
  const refused = misc.LOADER_NAMES.filter(function (name) { return done.indexOf(name) === -1; });
  assert.deepStrictEqual(refused, [], 'the engine asks for names the surface refuses: ' + refused);
  // And the one ask the surface refuses on purpose: its own reason has to survive to the log.
  assert.deepStrictEqual(misc.REFUSED_NAMES, ['SetFPS']);
  assert.ok(surface.SURFACE.SetFPS.why, 'SetFPS stays a reason row: the bridge has no stage path');
  assert.ok(surface.SURFACE.ChangeName && done.indexOf('ChangeName') !== -1,
    'the name setters are rows the surface itself carries (#40 owns their commands)');
  assert.ok(done.indexOf('ChangeGuild') !== -1);
  assert.ok(done.indexOf('ChangeColorName') !== -1);
});
