// The aura, target and combat statements (ticket #42). Expected behaviour comes from the
// reference client's own classes - Grimoire/Botting/Commands/Misc/Statements/Cmd* and the cache
// they read, Grimoire/Game/AuraSystem.cs - and from the packet handlers that feed that cache,
// Grimoire/Tools/Flash.cs (ProcessPacketFromServer, ProcessPext, ProcessPacketFromClient).
//
// Four facts from those sources decide what is asserted here:
//
// 1. The player's auras are not read from the game. The reference reads AuraManager.SelfAura, a
//    cache its packet handlers fill, and ticket #42 rules the tapped cache the source for the
//    target statements too, rather than a lookup that answers a packet stale.
// 2. The wire's `dur` is in SECONDS (AuraSystem.PlayerAura.Refresh multiplies by 1000) and every
//    number a bot compares is MILLISECONDS.
// 3. Monster caches are keyed by MonMapID, which is also what Player.CurrentTargetId reads.
// 4. The comparisons are the reference's own, including the ones that hold on their boundary and
//    the two clauses that are easy to read past: an absent monster aura answering 0, and the
//    target-health statements' own `Default` value when nothing is targeted.
//
// The tap, the session and the engine are fakes where a fake is enough; the aura cache is
// exercised directly, because that is the object under test.
const assert = require('assert');

const auras = require('../../plugins/grimlite-parity/bot/auras.js');
const statements = require('../../plugins/grimlite-parity/bot/statements-auras.js');
const engineModel = require('../../plugins/grimlite-parity/bot/engine.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');
const sessionModel = require('../../plugins/grimlite-parity/bot/session.js');
const surface = require('../../plugins/grimlite-parity/loader-surface.js');

// The two shapes the reference's handlers read: a raw server frame, whose payload sits at b.o
// (Flash.cs ProcessPacketFromServer), and the pext event, whose payload is params.dataObj (that
// is where ProcessPext reads moveToArea and clearAuras from).
function rawFrame(payload) {
  return JSON.stringify({ t: 'xt', b: { r: -1, o: payload } });
}

function pextFrame(payload) {
  return JSON.stringify({ params: { type: 'json', dataObj: payload } });
}

// What the tap hands over: a direction and the frame's bytes.
function fromServer(text) {
  return { direction: 'toClient', data: Buffer.from(text, 'utf8') };
}

function fromClient(text) {
  return { direction: 'toServer', data: Buffer.from(text, 'utf8') };
}

const SELF = 777;

const CHI = rawFrame({
  cmd: 'aura+',
  tInf: 'p:' + SELF,
  a: [{ cmd: 'aura+', tInf: 'p:' + SELF, auras: [{ nam: 'Chi', val: 2, dur: 10, isNew: true }] }]
});

function auraOf(name, value, duration, extra) {
  return Object.assign({ nam: name, val: value, dur: duration, isNew: true }, extra || {});
}

function auraFrame(tInf, aura, cmd) {
  return rawFrame({
    cmd: cmd || 'aura+',
    tInf: tInf,
    a: [{ cmd: cmd || 'aura+', tInf: tInf, auras: [aura] }]
  });
}

const SELF_KEY = 'p:' + SELF;

// A store with its clock under the test's own control, so expiry is asserted without waiting.
function store(clock) {
  return auras.createAuraStore({ now: function () { return clock ? clock.at : 0; } });
}

// The two reads a statement makes, over the keyed managers.
function selfValue(cache, name) { return cache.value(SELF_KEY, name); }
function selfRemaining(cache, name) { return cache.remaining(SELF_KEY, name); }

// ------------------------------------------------------------------ the cache (AuraSystem.cs)

test('an aura frame adds a self aura with the value the server sent', () => {
  const cache = store();
  cache.observe(fromServer(CHI));
  assert.strictEqual(selfValue(cache, 'Chi'), 2);
  // AuraSystem.PlayerAura.Refresh: ExpireTime = TickCount + duration * 1000, dur being seconds.
  assert.strictEqual(selfRemaining(cache, 'Chi'), 10000);
});

test('a self aura is matched case-insensitively, which is the cache own comparer', () => {
  // AuraSystem.cs builds its dictionary with StringComparer.OrdinalIgnoreCase.
  const cache = store();
  cache.observe(fromServer(CHI));
  assert.strictEqual(selfValue(cache, 'chi'), 2);
  assert.strictEqual(selfValue(cache, 'CHI'), 2);
  assert.strictEqual(selfRemaining(cache, 'chi'), 10000);
});

test('a plain aura+ with value one is a stack increment, not a new aura', () => {
  // Flash.cs: if (isNew || value != 1) ApplyAura else AuraIncrement.
  const cache = store();
  cache.observe(fromServer(CHI));
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Chi', 1, 10, { isNew: false }))));
  assert.strictEqual(selfValue(cache, 'Chi'), 3, 'the acknowledged stack went up by one');
});

test('a value other than one replaces the stack even on a frame that is not new', () => {
  // The same branch: value != 1 takes ApplyAura, which is the server resynchronising a stack.
  const cache = store();
  cache.observe(fromServer(CHI));
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Chi', 7, 10, { isNew: false }))));
  assert.strictEqual(selfValue(cache, 'Chi'), 7);
});

test('a stack for an aura the bot never saw created is created rather than throwing', () => {
  // Upstream AuraIncrement dereferences a null entry here, which a live game can produce. The
  // frame itself says the aura is on the target, so the entry starts at the stack it acknowledged.
  const cache = store();
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Chi', 1, 10, { isNew: false }))));
  assert.strictEqual(selfValue(cache, 'Chi'), 1);
});

test('a stack increment re-arms from the aura own duration, not from the frame beside it', () => {
  // AuraSystem.AuraIncrement calls aura.Refresh(aura.Duration) - the refresh overload that takes
  // no new duration. The frame's own `dur` is not used on that branch, so an acknowledgement that
  // carried a shorter one must not shorten an aura that is still running.
  const clock = { at: 0 };
  const cache = store(clock);
  cache.observe(fromServer(CHI));                        // Chi, 10 s
  clock.at = 3000;
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Chi', 1, 2, { isNew: false }))));
  assert.strictEqual(selfValue(cache, 'Chi'), 3, 'the stack went up');
  assert.strictEqual(selfRemaining(cache, 'Chi'), 10000,
    'the aura own 10 s, re-armed from now - not the 2 s the frame carried');
});

test('a fractional stack at or under one reads as one, the reference own clamp', () => {
  // AuraManager.GetValue: if (aura.Value <= 1) aura.Value = 1, and Player.GetAuras casts to int.
  const cache = store();
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Chi', 0.5, 10))));
  assert.strictEqual(selfValue(cache, 'Chi'), 1);
});

test('an aura nobody sent, or one that has expired, reads as zero', () => {
  const clock = { at: 0 };
  const cache = store(clock);
  assert.strictEqual(selfValue(cache, 'Chi'), 0, 'an aura nobody sent is zero');
  cache.observe(fromServer(CHI));
  assert.strictEqual(selfValue(cache, 'Chi'), 2);
  clock.at = 10000;
  assert.strictEqual(selfValue(cache, 'Chi'), 0, 'IsExpired is TickCount >= ExpireTime');
  assert.strictEqual(selfRemaining(cache, 'Chi'), 0);
});

test('aura- names the aura it removes, in the singular shape the reference reads', () => {
  // Flash.cs: cmd == "aura-" and action["aura"]["nam"] removes by name.
  const cache = store();
  cache.observe(fromServer(CHI));
  cache.observe(fromServer(rawFrame({
    cmd: 'aura-',
    a: [{ cmd: 'aura-', tInf: 'p:' + SELF, aura: { nam: 'Chi' } }]
  })));
  assert.strictEqual(selfValue(cache, 'Chi'), 0);
});

test('a removal that lists its auras is read too, as the game own handler reads it', () => {
  // World.as auraDataOnly: rem = resObj.auras != null ? resObj.auras : (resObj.aura != null ?
  // [resObj.aura] : []) - the two shapes carry the same field, so the same name comes out.
  const cache = store();
  cache.observe(fromServer(CHI));
  cache.observe(fromServer(rawFrame({
    cmd: 'aura-',
    a: [{ cmd: 'aura-', tInf: 'p:' + SELF, auras: [{ nam: 'Chi' }] }]
  })));
  assert.strictEqual(selfValue(cache, 'Chi'), 0);
});

test('another player aura is not the character own aura', () => {
  // Flash.cs compares tInf against the literal "p:<Player.UserID>" and ignores every other p:.
  const cache = store();
  cache.observe(fromServer(auraFrame('p:999', auraOf('Chi', 5, 10))));
  assert.strictEqual(selfValue(cache, 'Chi'), 0);
});

test('a monster aura is kept per monster, keyed by the MonMapID the wire carries', () => {
  // Flash.cs: tInf.StartsWith("m:") -> AuraManager.EnemyAura(targetId).
  const cache = store();
  cache.observe(fromServer(auraFrame('m:2', auraOf('Focus', 1, 4))));
  assert.strictEqual(cache.value('m:2', 'Focus'), 1);
  assert.strictEqual(cache.value('m:3', 'Focus'), 0, 'another monster is its own cache');
  assert.strictEqual(cache.remaining('m:2', 'Focus'), 4000, 'seconds on the wire, ms to a bot');
});

test('an aura frame whose action is the payload itself is read as well', () => {
  // The game's own handler reaches handleAuraEvent with the payload itself when b.o.cmd is the
  // aura command (World.as), and it carries the same fields - the same derivation one level up.
  const cache = store();
  cache.observe(fromServer(rawFrame({
    cmd: 'aura+', tInf: 'p:' + SELF, auras: [auraOf('Chi', 2, 10)]
  })));
  assert.strictEqual(selfValue(cache, 'Chi'), 2);
});

test('a map change drops every monster cache and prunes the expired player auras', () => {
  // Flash.cs, ProcessPext case "moveToArea": SelfAura.Update() + resetMonsterAura().
  const clock = { at: 0 };
  const cache = store(clock);
  cache.observe(fromServer(CHI));
  cache.observe(fromServer(auraFrame('m:2', auraOf('Focus', 1, 4))));
  clock.at = 10000;
  cache.observe(fromServer(pextFrame({ cmd: 'moveToArea', areaName: 'yulgar-1' })));
  assert.strictEqual(cache.value('m:2', 'Focus'), 0, 'every monster cache is dropped');
  assert.strictEqual(selfValue(cache, 'Chi'), 0, 'the expired player aura is pruned');
});

test('a map change keeps a player aura that has not expired', () => {
  const cache = store();
  cache.observe(fromServer(CHI));
  cache.observe(fromServer(pextFrame({ cmd: 'moveToArea', areaName: 'yulgar-1' })));
  assert.strictEqual(selfValue(cache, 'Chi'), 2);
});

test('a map change in the raw frame shape is seen too, which is what the tap carries', () => {
  const cache = store();
  cache.observe(fromServer(auraFrame('m:2', auraOf('Focus', 1, 4))));
  cache.observe(fromServer(rawFrame({ cmd: 'moveToArea', areaName: 'yulgar-1' })));
  assert.strictEqual(cache.value('m:2', 'Focus'), 0);
});

test('clearAuras keeps the five names the reference keeps and drops the rest', () => {
  // AuraManager.ClearAllAura: a name containing Fate, Sage, Body, Might or Elixir survives.
  const cache = store();
  ['Chi', 'Fate of the Void', 'Sage Tonic', 'Body and Soul', 'Mighty Elixir'].forEach(function (name) {
    cache.observe(fromServer(auraFrame('p:' + SELF, auraOf(name, 1, 60))));
    assert.strictEqual(selfValue(cache, name), 1, 'the aura arrived: ' + name);
  });
  cache.observe(fromServer(pextFrame({ cmd: 'clearAuras' })));
  assert.strictEqual(selfValue(cache, 'Chi'), 0);
  assert.strictEqual(selfValue(cache, 'Fate of the Void'), 1);
  assert.strictEqual(selfValue(cache, 'Sage Tonic'), 1);
  assert.strictEqual(selfValue(cache, 'Body and Soul'), 1);
  assert.strictEqual(selfValue(cache, 'Mighty Elixir'), 1, 'the keep-list match is case-insensitive');
});

test('a clear is the self cache own: a monster keeps its auras through both of them', () => {
  // Flash.cs only ever calls ClearAllAura on AuraManager.SelfAura - `case "clearAuras"` and
  // Player.initLogin - so monsterId's cache is not a thing either of those can reach.
  const cache = store();
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Chi', 1, 60))));
  cache.observe(fromServer(auraFrame('m:2', auraOf('Focus', 1, 60))));
  cache.observe(fromServer(pextFrame({ cmd: 'clearAuras' })));
  assert.strictEqual(selfValue(cache, 'Chi'), 0, 'the plain clear took the player aura');
  assert.strictEqual(cache.value('m:2', 'Focus'), 1, 'and left the monster cache alone');

  cache.observe(fromClient('%xt%zm%firstJoin%1%'));
  assert.strictEqual(selfValue(cache, 'Chi'), 0);
  assert.strictEqual(cache.value('m:2', 'Focus'), 1,
    'a forced clear is still SelfAura.ClearAllAura(true), not a clear of every keyed cache');
});

test('another player is a key the cache does not keep once the character is known', () => {
  // The reference has no per-player cache: `tInf != p:{Player.UserID}` is not self and does not
  // start with `m:`, so nothing is done with it at all. This cache is keyed by tInf, so the
  // equivalent is dropping the keys that are nobody the bot can ask about.
  const cache = store();
  cache.observe(fromServer(auraFrame('p:999', auraOf('Chi', 5, 10))));
  assert.strictEqual(cache.value('p:999', 'Chi'), 5, 'before the id is known it is held');
  cache.setSelf('p:' + SELF);
  assert.strictEqual(cache.value('p:999', 'Chi'), 0, 'once the id is known, another player goes');
  cache.observe(fromServer(auraFrame('p:999', auraOf('Chi', 5, 10))));
  assert.strictEqual(cache.value('p:999', 'Chi'), 0, 'and later frames for one are dropped');
  cache.observe(fromServer(CHI));
  assert.strictEqual(selfValue(cache, 'Chi'), 2, 'this character aura is kept');
});

test('a first join clears every aura, which is what the reference does on it', () => {
  // Flash.cs, ProcessPacketFromClient case "firstJoin": Player.initLogin() -> ClearAllAura(true).
  const cache = store();
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Fate of the Void', 1, 60))));
  assert.strictEqual(selfValue(cache, 'Fate of the Void'), 1);
  cache.observe(fromClient('  %xt%zm%firstJoin%1%  '));
  assert.strictEqual(selfValue(cache, 'Fate of the Void'), 0,
    'the force-clean clear is not the keep-list one');
});

test('a respawn clears them too, which is the effect the reference reaches for on one', () => {
  // Flash.cs, ProcessPacketFromClient case "resPlayerTimed": Flash.Call("ResetAura") with the
  // comment "Ensure remove all auras when respawn (aura might stuck when received packet loss)".
  // ResetAura is in neither SWF's string table and is not a name the loader registers, so the
  // effect the client asks for - every aura gone on a respawn - is what is done here.
  const cache = store();
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Fate of the Void', 1, 60))));
  assert.strictEqual(selfValue(cache, 'Fate of the Void'), 1);
  cache.observe(fromClient('%xt%zm%resPlayerTimed%1%'));
  assert.strictEqual(selfValue(cache, 'Fate of the Void'), 0,
    'a respawn clear is not the keep-list one either');
});

test('an animation message is kept lowercased, the way the anims handler keeps it', () => {
  // Grimoire/Networking/Handlers/HandlerSpecialAnims.cs: b.o.anims[].msg, lowercased, last wins.
  const cache = store();
  cache.observe(fromServer(rawFrame({ anims: [{ msg: 'The Earth Shakes' }, { msg: 'Resist!' }] })));
  assert.strictEqual(cache.lastAnimationMessage(), 'resist!');
  cache.consumeAnimation();
  assert.strictEqual(cache.lastAnimationMessage(), '', 'a match consumes it');
});

test('an aura msgOn text is kept, which is the aura half of the same trigger', () => {
  // Flash.cs: aura.msgOn appends to Configuration.LastAuraMessages.
  const cache = store();
  cache.observe(fromServer(auraFrame('p:' + SELF, auraOf('Chi', 1, 10, { msgOn: 'Chi flowing' }))));
  assert.deepStrictEqual(cache.lastAuraMessages(), ['Chi flowing']);
});

test('a frame that is not a game frame, or is malformed, is ignored rather than fatal', () => {
  const cache = store();
  cache.observe(fromServer("<msg t='sys'><body action='verChk'></body></msg>"));
  cache.observe(fromServer('%xt%zm%cmd%1%goto%bob%'));
  cache.observe(fromServer('{"unbalanced":'));
  cache.observe(fromServer(JSON.stringify({ t: 'xt', b: { r: -1, o: { cmd: 'nothing' } } })));
  cache.observe(null);
  assert.strictEqual(selfValue(cache, 'Chi'), 0);
  cache.observe(fromServer(CHI));
  assert.strictEqual(selfValue(cache, 'Chi'), 2, 'and a real frame still lands');
});

test('a frame handed over as text rather than bytes is read all the same', () => {
  const cache = store();
  cache.observe({ direction: 'toClient', data: CHI });
  assert.strictEqual(selfValue(cache, 'Chi'), 2);
});

// ------------------------------------------------------------------ the statements (Cmd*)

// The engine as the plugin builds it, over a fake session: the statements are handed the same
// context the engine hands its own handlers.
function engineWith(answers) {
  const asked = [];
  const records = [];
  const session = {};
  Object.keys(answers).forEach(function (name) {
    session[name] = function () {
      const args = Array.prototype.slice.call(arguments);
      asked.push({ name: name, args: args });
      const answer = answers[name];
      const value = typeof answer === 'function' ? answer.apply(null, args) : answer;
      return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
    };
  });
  const made = engineModel.createEngine({
    session: session,
    sleep: function () { return Promise.resolve(); },
    log: function (line) { records.push(line); }
  });
  made.asked = asked;
  made.records = records;
  return made;
}

function statement(className, value1, value2) {
  return catalog.makeStatement(className, value1, value2);
}

function botOf(commands) {
  // The loop's index setter wraps a value that reaches the end back to 0 (#37's own reproduction of
  // Bot.Index), so a list these assertions can hold an index in needs commands past the ones under
  // test - otherwise "skipped past the end" and "held at the first command" look the same.
  return { Commands: commands.concat([{ $type: 'Filler' }, { $type: 'Filler' }]) };
}

// The read one statement made, ignoring the engine's own per-tick reads (signedIn, alive, ready).
function readBy(made, name) {
  const found = made.asked.filter(function (a) { return a.name === name; });
  return found.length ? found[found.length - 1] : null;
}

// A session that answers every read these statements make, with per-test overrides.
function auraAnswers(overrides) {
  return Object.assign({
    signedIn: true,
    alive: true,
    ready: true,
    username: 'Tester',
    selfAura: 0,
    targetAura: 0,
    monsterAuraDuration: 0,
    hasTarget: true,
    targetHealth: 100,
    state: 1,
    lastAnimationMessage: '',
    consumeAnimation: undefined
  }, overrides || {});
}

test('the classes this ticket owns are exactly the handlers it registers', () => {
  const owned = [
    'CmdPlayerAuraEquals', 'CmdPlayerAuraGreaterThan', 'CmdPlayerAuraLessThan',
    'CmdTargetAuraEquals', 'CmdTargetAuraGreaterThan', 'CmdTargetAuraLessThan',
    'CmdTargetAuraDuration',
    'CmdHasTarget', 'CmdNotHasTarget',
    'CmdTargetHealthGreaterThan', 'CmdTargetHealthLessThan', 'CmdTargetHealthBetween',
    'CmdInCombat', 'CmdNotInCombat',
    'CmdSpecialAnims', 'CmdNameEquals', 'CmdDelayedAnims'
  ];
  assert.deepStrictEqual(Object.keys(statements.handlers).sort(), owned.slice().sort());
  const rows = catalog.STATEMENTS.map(function (row) { return row.className; });
  Object.keys(statements.handlers).filter(function (className) {
    return className !== 'CmdDelayedAnims';
  }).forEach(function (className) {
    assert.ok(rows.indexOf(className) !== -1, className + ' is not a statement the reference ships');
  });
});

test('a player aura equality holds or skips exactly where the reference does', async () => {
  // CmdPlayerAuraEquals: auraValue != x -> Index++ (which skips the command under the statement).
  const equal = engineWith(auraAnswers({ selfAura: 3 }));
  await equal.start(botOf([statement('CmdPlayerAuraEquals', 'Chi', '3'), { $type: 'x' }]));
  await equal.tick();
  assert.strictEqual(equal.index(), 1, 'equal holds');
  assert.deepStrictEqual(readBy(equal, 'selfAura'), { name: 'selfAura', args: ['Chi'] });

  const unequal = engineWith(auraAnswers({ selfAura: 3 }));
  await unequal.start(botOf([statement('CmdPlayerAuraEquals', 'Chi', '4'), { $type: 'x' }]));
  await unequal.tick();
  assert.strictEqual(unequal.index(), 2, 'unequal skips');
});

test('the stack comparisons are strict, which is how the reference skip reads', async () => {
  // CmdPlayerAuraGreaterThan: if (auraValue <= x) Index++ - so it holds only ABOVE x.
  const above = engineWith(auraAnswers({ selfAura: 5 }));
  await above.start(botOf([statement('CmdPlayerAuraGreaterThan', 'Chi', '4'), { $type: 'x' }]));
  await above.tick();
  assert.strictEqual(above.index(), 1);

  const atBound = engineWith(auraAnswers({ selfAura: 4 }));
  await atBound.start(botOf([statement('CmdPlayerAuraGreaterThan', 'Chi', '4'), { $type: 'x' }]));
  await atBound.tick();
  assert.strictEqual(atBound.index(), 2, 'the same stack is not greater than itself');

  // CmdPlayerAuraLessThan: if (auraValue >= x) Index++ - it holds only BELOW x.
  const below = engineWith(auraAnswers({ selfAura: 3 }));
  await below.start(botOf([statement('CmdPlayerAuraLessThan', 'Chi', '4'), { $type: 'x' }]));
  await below.tick();
  assert.strictEqual(below.index(), 1);

  const atBoundLess = engineWith(auraAnswers({ selfAura: 4 }));
  await atBoundLess.start(botOf([statement('CmdPlayerAuraLessThan', 'Chi', '4'), { $type: 'x' }]));
  await atBoundLess.tick();
  assert.strictEqual(atBoundLess.index(), 2);
});

test('the target aura statements read the target aura, not the player own', async () => {
  const made = engineWith(auraAnswers({ targetAura: 2 }));
  await made.start(botOf([statement('CmdTargetAuraEquals', 'Focus', '2'), { $type: 'x' }]));
  await made.tick();
  assert.strictEqual(made.index(), 1);
  assert.deepStrictEqual(readBy(made, 'targetAura'), { name: 'targetAura', args: ['Focus'] });

  const over = engineWith(auraAnswers({ targetAura: 4 }));
  await over.start(botOf([statement('CmdTargetAuraGreaterThan', 'Focus', '3'), { $type: 'x' }]));
  await over.tick();
  assert.strictEqual(over.index(), 1, 'the target forms take the same operator as the player ones');

  const overBound = engineWith(auraAnswers({ targetAura: 3 }));
  await overBound.start(botOf([statement('CmdTargetAuraGreaterThan', 'Focus', '3'), { $type: 'x' }]));
  await overBound.tick();
  assert.strictEqual(overBound.index(), 2, 'and they are strict at the boundary too');

  const less = engineWith(auraAnswers({ targetAura: 0 }));
  await less.start(botOf([statement('CmdTargetAuraLessThan', 'Focus', '1'), { $type: 'x' }]));
  await less.tick();
  assert.strictEqual(less.index(), 1, 'no aura is fewer stacks than one');
});

test('a monster aura duration compares in milliseconds and skips when there is no aura', async () => {
  // CmdTargetAuraDuration: if (CurrentDuration > x || CurrentDuration == 0) Index++ - x == 0
  // means "no such aura on that monster", which must not hold. Value2's own label says ms.
  const none = engineWith(auraAnswers({ monsterAuraDuration: 0 }));
  await none.start(botOf([statement('CmdTargetAuraDuration', 'Focus', '2000'), { $type: 'x' }]));
  none.commands()[0].targetId = 2;
  await none.tick();
  assert.strictEqual(none.index(), 2, 'no aura on that monster skips');
  assert.deepStrictEqual(readBy(none, 'monsterAuraDuration'), { name: 'monsterAuraDuration', args: [2, 'Focus'] });

  const under = engineWith(auraAnswers({ monsterAuraDuration: 1500 }));
  await under.start(botOf([statement('CmdTargetAuraDuration', 'Focus', '2000'), { $type: 'x' }]));
  under.commands()[0].targetId = 2;
  await under.tick();
  assert.strictEqual(under.index(), 1, '1500 ms left is under 2000 ms, which is what it asks');

  // The boundary holds: the statement skips only on `> x`, so the row is really at-most-the-value.
  const atBound = engineWith(auraAnswers({ monsterAuraDuration: 2000 }));
  await atBound.start(botOf([statement('CmdTargetAuraDuration', 'Focus', '2000'), { $type: 'x' }]));
  atBound.commands()[0].targetId = 2;
  await atBound.tick();
  assert.strictEqual(atBound.index(), 1, '2000 ms left is not more than 2000 ms');

  const over = engineWith(auraAnswers({ monsterAuraDuration: 2001 }));
  await over.start(botOf([statement('CmdTargetAuraDuration', 'Focus', '2000'), { $type: 'x' }]));
  over.commands()[0].targetId = 2;
  await over.tick();
  assert.strictEqual(over.index(), 2, 'one millisecond more skips it');
});

test('both operands of an aura statement may come from variables', async () => {
  // CmdPlayerAuraEquals: IsVar(Value1) ? Tempvariable[GetVar(Value1)] : Value1, for each value.
  const made = engineWith(auraAnswers({
    selfAura: function (name) { return name === 'Aura of Doom' ? 5 : 0; }
  }));
  await made.start(botOf([
    catalog.makeStatement('CmdSetVar', 'aura', 'Aura of Doom'),
    statement('CmdPlayerAuraEquals', '[aura]', '[stacks]'),
    { $type: 'x' }
  ]));
  await made.tick();
  made.vars().stacks = '5';
  await made.tick();
  assert.strictEqual(made.index(), 2, 'the name and the value both came from variables');
});

test('a value that is not an integer is zero, which is what int.TryParse leaves', async () => {
  // int.TryParse(AuraValue, out x) with x starting at 0: "two" fails and leaves 0 behind.
  const holds = engineWith(auraAnswers({ selfAura: 0 }));
  await holds.start(botOf([statement('CmdPlayerAuraEquals', 'Chi', 'two'), { $type: 'x' }]));
  await holds.tick();
  assert.strictEqual(holds.index(), 1, 'an unparseable value compares against zero');

  const skips = engineWith(auraAnswers({ selfAura: 2 }));
  await skips.start(botOf([statement('CmdPlayerAuraEquals', 'Chi', 'two'), { $type: 'x' }]));
  await skips.tick();
  assert.strictEqual(skips.index(), 2, 'two stacks is not zero');
});

test('Is has target and Is not has target read the loader own helper', async () => {
  const yes = engineWith(auraAnswers({ hasTarget: true }));
  await yes.start(botOf([statement('CmdHasTarget', '', ''), { $type: 'x' }]));
  await yes.tick();
  assert.strictEqual(yes.index(), 1);
  assert.deepStrictEqual(readBy(yes, 'hasTarget'), { name: 'hasTarget', args: [] });

  const no = engineWith(auraAnswers({ hasTarget: false }));
  await no.start(botOf([statement('CmdHasTarget', '', ''), { $type: 'x' }]));
  await no.tick();
  assert.strictEqual(no.index(), 2, 'no target skips the command under it');

  const not = engineWith(auraAnswers({ hasTarget: false }));
  await not.start(botOf([statement('CmdNotHasTarget', '', ''), { $type: 'x' }]));
  await not.tick();
  assert.strictEqual(not.index(), 1);

  const notYes = engineWith(auraAnswers({ hasTarget: true }));
  await notYes.start(botOf([statement('CmdNotHasTarget', '', ''), { $type: 'x' }]));
  await notYes.tick();
  assert.strictEqual(notYes.index(), 2);
});

test('Is in combat is state two, the third member of the reference own enum', async () => {
  // Player.State { Dead, Idle, InCombat } and the loader's State() is dataLeaf.intState.
  const fighting = engineWith(auraAnswers({ state: 2 }));
  await fighting.start(botOf([statement('CmdInCombat', '', ''), { $type: 'x' }]));
  await fighting.tick();
  assert.strictEqual(fighting.index(), 1);
  assert.deepStrictEqual(readBy(fighting, 'state'), { name: 'state', args: [] });

  const idle = engineWith(auraAnswers({ state: 1 }));
  await idle.start(botOf([statement('CmdInCombat', '', ''), { $type: 'x' }]));
  await idle.tick();
  assert.strictEqual(idle.index(), 2, 'idle is not in combat');

  const out = engineWith(auraAnswers({ state: 1 }));
  await out.start(botOf([statement('CmdNotInCombat', '', ''), { $type: 'x' }]));
  await out.tick();
  assert.strictEqual(out.index(), 1);

  const dead = engineWith(auraAnswers({ state: 0 }));
  await dead.start(botOf([statement('CmdNotInCombat', '', ''), { $type: 'x' }]));
  await dead.tick();
  assert.strictEqual(dead.index(), 1, 'dead is not in combat either');
});

test('a target health comparison holds on its boundary, as the reference writes it', async () => {
  // CmdTargetHealthGreaterThan: if (GetTargetHealth() < i) Index++ - holds at exactly i.
  const at = engineWith(auraAnswers({ targetHealth: 500 }));
  await at.start(botOf([statement('CmdTargetHealthGreaterThan', '500', 'true'), { $type: 'x' }]));
  await at.tick();
  assert.strictEqual(at.index(), 1);

  const below = engineWith(auraAnswers({ targetHealth: 499 }));
  await below.start(botOf([statement('CmdTargetHealthGreaterThan', '500', 'true'), { $type: 'x' }]));
  await below.tick();
  assert.strictEqual(below.index(), 2);

  // CmdTargetHealthLessThan: if (GetTargetHealth() > i) Index++.
  const less = engineWith(auraAnswers({ targetHealth: 500 }));
  await less.start(botOf([statement('CmdTargetHealthLessThan', '500', 'true'), { $type: 'x' }]));
  await less.tick();
  assert.strictEqual(less.index(), 1);

  const more = engineWith(auraAnswers({ targetHealth: 501 }));
  await more.start(botOf([statement('CmdTargetHealthLessThan', '500', 'true'), { $type: 'x' }]));
  await more.tick();
  assert.strictEqual(more.index(), 2);
});

test('with nothing targeted the statement own Default decides, rather than guessing', async () => {
  // CmdTargetHealthGreaterThan: if (!Player.HasTarget) { if (Default.ToLower() == "false")
  // Index++; return; } - and nothing is read from a target that is not there.
  const holds = engineWith(auraAnswers({ hasTarget: false }));
  await holds.start(botOf([statement('CmdTargetHealthGreaterThan', '500', 'true'), { $type: 'x' }]));
  await holds.tick();
  assert.strictEqual(holds.index(), 1, 'Default true holds with nothing targeted');
  assert.ok(!holds.asked.some(function (a) { return a.name === 'targetHealth'; }),
    'no health is read from a target that is not there');

  const skips = engineWith(auraAnswers({ hasTarget: false }));
  await skips.start(botOf([statement('CmdTargetHealthGreaterThan', '500', 'false'), { $type: 'x' }]));
  await skips.tick();
  assert.strictEqual(skips.index(), 2, 'Default false skips with nothing targeted');

  const ignored = engineWith(auraAnswers({ hasTarget: false }));
  await ignored.start(botOf([statement('CmdTargetHealthBetween', '100,900', 'true'), { $type: 'x' }]));
  await ignored.tick();
  assert.strictEqual(ignored.index(), 1, 'the between form takes the same branch');
});

test('a target health between holds only inside the open interval', async () => {
  const inside = engineWith(auraAnswers({ targetHealth: 500 }));
  await inside.start(botOf([statement('CmdTargetHealthBetween', '100,900', 'true'), { $type: 'x' }]));
  await inside.tick();
  assert.strictEqual(inside.index(), 1);

  const onEdge = engineWith(auraAnswers({ targetHealth: 900 }));
  await onEdge.start(botOf([statement('CmdTargetHealthBetween', '100,900', 'true'), { $type: 'x' }]));
  await onEdge.tick();
  assert.strictEqual(onEdge.index(), 2, 'the interval is exclusive at both ends');

  const noComma = engineWith(auraAnswers({ targetHealth: 500 }));
  await noComma.start(botOf([statement('CmdTargetHealthBetween', '500', 'true'), { $type: 'x' }]));
  await noComma.tick();
  assert.strictEqual(noComma.index(), 2, 'with no comma the reference skips without comparing');
});

test('Name equals compares the character name case-insensitively', async () => {
  // CmdNameEquals: Value1.Equals(Player.Username, StringComparison.OrdinalIgnoreCase).
  const yes = engineWith(auraAnswers({ username: 'Tester' }));
  await yes.start(botOf([statement('CmdNameEquals', 'tester', ''), { $type: 'x' }]));
  await yes.tick();
  assert.strictEqual(yes.index(), 1);

  const no = engineWith(auraAnswers({ username: 'Tester' }));
  await no.start(botOf([statement('CmdNameEquals', 'Someone', ''), { $type: 'x' }]));
  await no.tick();
  assert.strictEqual(no.index(), 2);

  // The reference compares the operands as they are: OrdinalIgnoreCase folds case and nothing
  // else, so a space the bot's own file carries is a mismatch, not something to trim away.
  const spaced = engineWith(auraAnswers({ username: 'Tester' }));
  await spaced.start(botOf([statement('CmdNameEquals', ' Tester ', ''), { $type: 'x' }]));
  await spaced.tick();
  assert.strictEqual(spaced.index(), 2, 'no trimming: String.Equals takes the strings it is given');
});

test('Special Anims holds on any of its comma-separated terms, and consumes the message', async () => {
  // CmdSpecialAnims with no skill index: skip while the last message does not match; on a match
  // let the command under it run and consume the trigger.
  const made = engineWith(auraAnswers({ lastAnimationMessage: 'the earth shakes' }));
  await made.start(botOf([statement('CmdSpecialAnims', 'resist, earth shakes', ''), { $type: 'x' }]));
  await made.tick();
  assert.strictEqual(made.index(), 1, 'the second term matches');
  assert.ok(made.asked.some(function (a) { return a.name === 'consumeAnimation'; }),
    'a match consumes the message so it cannot match forever');

  const noMatch = engineWith(auraAnswers({ lastAnimationMessage: 'something else' }));
  await noMatch.start(botOf([statement('CmdSpecialAnims', 'resist', ''), { $type: 'x' }]));
  await noMatch.tick();
  assert.strictEqual(noMatch.index(), 2);
  assert.ok(!noMatch.asked.some(function (a) { return a.name === 'consumeAnimation'; }),
    'nothing was consumed, so a later frame can still match');

  const blank = engineWith(auraAnswers({ lastAnimationMessage: 'the earth shakes' }));
  await blank.start(botOf([statement('CmdSpecialAnims', '  ', ''), { $type: 'x' }]));
  await blank.tick();
  assert.strictEqual(blank.index(), 2, 'with no term to look for it never holds');
});

test('Special Anims with a skill index casts through ForceUseSkill and never skips', async () => {
  // CmdSpecialAnims.cs: the skill branch is a bounded cooldown wait, a ForceUseSkill, a 150ms
  // delay, then one more force when the skill still reads as ready - and it never skips the
  // command under it. Ticket #49 is what makes the cast itself possible: the surface used to
  // refuse Player.ForceUseSkill because its argument is a live action object.
  // A skill that is on cooldown when the statement looks, and goes on cooldown for real once
  // forced - which is what tells the reference's own retry apart from its success path.
  let ready = 500;
  let casts = 0;
  const made = engineWith(auraAnswers({
    lastAnimationMessage: 'resist',
    skillAvailable: function () { return ready; },
    forceUseSkill: function () { casts++; ready = 4000; return true; }
  }));
  await made.start(botOf([statement('CmdSpecialAnims', 'resist', '3'), { $type: 'x' }]));
  await made.tick();
  assert.strictEqual(made.index(), 1, 'skill mode never skips');
  assert.deepStrictEqual(made.asked.filter(function (one) { return one.name === 'forceUseSkill'; })
    .map(function (one) { return one.args; }), [['3']],
    'a cast that lands leaves the skill cooling down, which is what stops the retry');
  assert.strictEqual(casts, 1, 'so it is forced exactly once');
  assert.ok(made.asked.some(function (one) { return one.name === 'skillAvailable'; }),
    'and its readiness is what gates the cast');
});

test('a read that cannot be established is reported, and never answers for the game', async () => {
  // The engine's contract is hold-or-skip; a statement that cannot be evaluated must take neither
  // branch silently, so it reports the reason and does not hold.
  const made = engineWith(auraAnswers({
    selfAura: function () { return new Error('the game bridge did not attach'); }
  }));
  await made.start(botOf([statement('CmdPlayerAuraEquals', 'Chi', '1'), { $type: 'x' }]));
  await made.tick();
  assert.strictEqual(made.index(), 2, 'it does not hold');
  assert.ok(made.records.some(function (line) { return /did not attach/.test(line); }),
    'and it says why: ' + made.records.join(' | '));
});

test('the engine registers these handlers under the classes the reference declares', () => {
  const made = engineWith(auraAnswers({}));
  Object.keys(statements.handlers).forEach(function (className) {
    assert.strictEqual(typeof made.handlers()[className], 'function', className + ' is registered');
  });
});

// ------------------------------------------------------------------ the session seam

// The session's bridge, in the shape host.bridge has: it answers by the reference loader's own
// name, and a name the surface refuses says so.
function fakeBridge(answers) {
  const asked = [];
  return {
    asked: function () { return asked; },
    attach: function () { return Promise.resolve({ ok: true }); },
    call: function (name, args) {
      asked.push({ name: name, args: args });
      const path = (args || [])[0];
      if (name === 'getGameObject' && Object.prototype.hasOwnProperty.call(answers, path)) {
        return Promise.resolve({ ok: true, value: JSON.stringify(answers[path]) });
      }
      return Promise.resolve({ ok: true, value: 'null' });
    },
    loaderCall: function (name, args) {
      asked.push({ name: name, args: (args || []).slice() });
      if (Object.prototype.hasOwnProperty.call(answers, name)) return Promise.resolve(answers[name]);
      const row = surface.SURFACE[name];
      return Promise.reject(new Error('no helper named "' + name + '" is implemented: ' +
        ((row && row.why) || 'no row')));
    }
  };
}

// The tap as the platform hands one over: subscribe, fan out, release.
function fakeTap() {
  const listeners = [];
  let released = 0;
  return {
    on: function (event, listener) {
      assert.strictEqual(event, 'frame');
      listeners.push(listener);
      return function () { released++; listeners.splice(listeners.indexOf(listener), 1); };
    },
    emit: function (frame) { listeners.slice().forEach(function (l) { l(frame); }); },
    listening: function () { return listeners.length; },
    released: function () { return released; }
  };
}

function sessionOver(answers, options) {
  const bridge = fakeBridge(answers);
  const tap = fakeTap();
  const session = sessionModel.createSession(Object.assign({
    bridge: bridge,
    packets: tap,
    log: function () {}
  }, options || {}));
  return { session: session, bridge: bridge, tap: tap };
}

function settle() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

test('the target, state and identity reads are the loader names the surface implements', async () => {
  const made = sessionOver({ HasTarget: true, GetTargetHealth: 777, State: 2, UserID: SELF });
  assert.strictEqual(await made.session.hasTarget(), true);
  assert.strictEqual(await made.session.targetHealth(), 777);
  assert.strictEqual(await made.session.state(), 2);
  assert.strictEqual(await made.session.selfId(), SELF);
  const names = made.bridge.asked().map(function (a) { return a.name; });
  ['HasTarget', 'GetTargetHealth', 'State', 'UserID'].forEach(function (name) {
    assert.ok(names.indexOf(name) !== -1, name + ' is a name the session asks for');
    assert.ok(surface.implemented().indexOf(name) !== -1, name + ' must be implemented by #48');
  });
});

test('the current target id is the read the reference own CurrentTargetId makes', async () => {
  // Player.CurrentTargetId => Flash.GetGameObject("world.myAvatar.target.objData.MonMapID"),
  // and the loader surface carries no name for it, so it is this module's own read.
  const made = sessionOver({
    HasTarget: true,
    'world.myAvatar.target.objData.MonMapID': 2
  });
  assert.strictEqual(await made.session.targetId(), 2);
});

test('with nothing targeted the id is null and the target aura is zero', async () => {
  // GetAurasValue returns 0 when there is no live target, which is the answer the reference
  // gives; the id itself is null rather than 0, because 0 is a monster id in no game.
  const made = sessionOver({ HasTarget: false, 'world.myAvatar.target.objData.MonMapID': null });
  assert.strictEqual(await made.session.targetId(), null);
  assert.strictEqual(await made.session.targetAura('Focus'), 0);
});

test('the session feeds its aura cache from the tap it subscribed to', async () => {
  const made = sessionOver({ UserID: SELF });
  assert.strictEqual(made.tap.listening(), 1, 'one subscription, taken when the session was made');
  await made.session.selfId();
  made.tap.emit(fromServer(CHI));
  await settle();
  assert.strictEqual(await made.session.selfAura('Chi'), 2);
  assert.strictEqual(await made.session.selfAura('Nothing'), 0);
});

test('an aura that arrives before the character id is known still lands', async () => {
  // The subscription is taken before login, so a p: frame can arrive while the id is still being
  // read. It is held until the id is known rather than being dropped or guessed at.
  const made = sessionOver({ UserID: SELF });
  made.tap.emit(fromServer(CHI));
  await settle();
  assert.strictEqual(await made.session.selfAura('Chi'), 2);
});

test('a monster aura duration is read from the tapped cache by monster id', async () => {
  const made = sessionOver({ UserID: SELF });
  made.tap.emit(fromServer(auraFrame('m:2', auraOf('Focus', 1, 4))));
  await settle();
  // 4 seconds on the wire, so 4000 ms when it arrived. A session's cache runs on the real clock
  // (the store's own clock is injected by the tests above), so the few milliseconds between the
  // frame and this read are already spent - the unit is what is asserted here, not an instant.
  const left = await made.session.monsterAuraDuration(2, 'Focus');
  assert.ok(left <= 4000 && left > 3900,
    'the wire own seconds became milliseconds, minus the time since the frame: ' + left);
  assert.strictEqual(await made.session.monsterAuraDuration(2, 'Nothing'), 0);
});

test('the animation message a statement reads is the one the tap saw', async () => {
  const made = sessionOver({ UserID: SELF });
  made.tap.emit(fromServer(rawFrame({ anims: [{ msg: 'Resist!' }] })));
  await settle();
  assert.strictEqual(await made.session.lastAnimationMessage(), 'resist!');
  await made.session.consumeAnimation();
  assert.strictEqual(await made.session.lastAnimationMessage(), '');
});

test('a window that goes away gives its tap subscription back', async () => {
  const made = sessionOver({});
  assert.strictEqual(made.tap.listening(), 1);
  await made.session.close();
  assert.strictEqual(made.tap.listening(), 0);
  assert.strictEqual(made.tap.released(), 1);
});

test('a session with no tap refuses the aura reads, naming what is missing', async () => {
  const session = sessionModel.createSession({ bridge: fakeBridge({}), log: function () {} });
  await assert.rejects(function () { return session.selfAura('Chi'); }, /packet tap/i);
  await assert.rejects(function () { return session.monsterAuraDuration(2, 'Focus'); }, /packet tap/i);
});

test('a tap that refuses to subscribe is a refusal here too, in the tap own words', async () => {
  const refusing = {
    on: function () { throw new Error('the packet tap is not available in this app session'); }
  };
  const session = sessionModel.createSession({
    bridge: fakeBridge({}),
    packets: refusing,
    log: function () {}
  });
  await assert.rejects(function () { return session.selfAura('Chi'); },
    /not available in this app session/);
});

test('a loader read that answers something which is not a number is a refusal, not a value', async () => {
  const session = sessionModel.createSession({
    bridge: fakeBridge({ State: 'not a state' }),
    packets: fakeTap(),
    log: function () {}
  });
  await assert.rejects(function () { return session.state(); }, /not a number/);

  const nothing = sessionModel.createSession({
    bridge: fakeBridge({ GetTargetHealth: null }),
    packets: fakeTap(),
    log: function () {}
  });
  await assert.rejects(function () { return nothing.targetHealth(); }, /answered nothing/);
});

test('a target id the game did not answer as a number is reported rather than read as zero', async () => {
  const made = sessionOver({ HasTarget: true, 'world.myAvatar.target.objData.MonMapID': 'soon' });
  await assert.rejects(function () { return made.session.targetId(); }, /not a number/);
});

test('every loader name and body this ticket relies on is recorded with its source', () => {
  const bodies = sessionModel.LOADER_BODIES;
  ['HasTarget', 'GetTargetHealth', 'State', 'UserID'].forEach(function (name) {
    assert.ok(bodies[name], name + ' has no recorded body in session.js');
    assert.ok(bodies[name].body, name + ' records no body');
    assert.strictEqual(bodies[name].helper, name, name + ' is asked for by the loader own name');
    assert.ok(surface.SURFACE[name], name + ' must be a name the surface answers');
    assert.ok(surface.implemented().indexOf(name) !== -1, name + ' must be implemented, not refused');
  });
  assert.ok(bodies.AuraCache, 'the aura cache records where its frames come from');
  assert.ok(/CurrentTargetId/.test(bodies.AuraCache.body), bodies.AuraCache.body);
});

test('the surface points its two aura lookups at the tap rather than at a path', async () => {
  // GetAurasValue and AuraDuration are the lookup calls the reference falls back to for the
  // *target* statements; ticket #42 rules the tapped cache the source for both, so they stay
  // refused, with a reason that says where the answer comes from instead.
  ['GetAurasValue', 'AuraDuration'].forEach(function (name) {
    assert.ok(surface.SURFACE[name].why, name + ' is refused');
    assert.strictEqual(surface.implemented().indexOf(name), -1,
      name + ' must not claim to be implemented');
    assert.ok(/tap/.test(surface.SURFACE[name].why),
      name + ' names the tap as its replacement: ' + surface.SURFACE[name].why);
  });
});

test('the plugin builds its bot sessions with the packet tap wired in', () => {
  // The aura statements are only as good as the wiring: a session created without the tap refuses
  // every aura read (and says so), which is a whole half of this ticket going missing while the
  // tests above still pass against their own fakes. So the plugin's own factory is read here.
  const source = require('fs').readFileSync(
    require('path').join(__dirname, '../../plugins/grimlite-parity/main.js'), 'utf8');
  const call = source.slice(source.indexOf('createSession: function'));
  const body = call.slice(0, call.indexOf('log: function (line)'));
  assert.ok(/packets:\s*host\.packets/.test(body),
    'the session factory must hand host.packets to createSession: ' + body);
  assert.ok(/createSession\(\{/.test(body), 'and it must be the session factory: ' + body);
});

test('repeated combat aura messages retain one entry per distinct match until consumed', () => {
  const cache = store();
  cache.setSelf(SELF_KEY);
  const frames = ['Chi applied', 'Focus applied'].map(message =>
    fromServer(auraFrame(SELF_KEY, auraOf('Chi', 2, 10, { msgOn: message }))));
  for (let block = 0; block < 3; block++) {
    for (let i = 0; i < 10000; i++) cache.observe(frames[i % frames.length]);
    assert.equal(cache.lastAuraMessages().length, 2,
      'repeated messages must not accumulate or increase each statement read');
    assert.deepStrictEqual(cache.lastAuraMessages(), ['Chi applied', 'Focus applied']);
  }
  const snapshot = cache.lastAuraMessages();
  snapshot.push('outside mutation');
  assert.equal(cache.lastAuraMessages().length, 2);
  cache.clearAuraMessages();
  assert.deepStrictEqual(cache.lastAuraMessages(), []);
  cache.observe(frames[0]);
  assert.deepStrictEqual(cache.lastAuraMessages(), ['Chi applied']);
});

test('the packet reader decodes the live SmartFox compressed-drop format and refuses invalid data', () => {
  const reader = require('../../plugins/grimlite-parity/bot/auras.js').frameText;
  const wire = require('fs').readFileSync(require('path').join(__dirname,
    '../fixtures/grimlite-drops/dropItem-compressed.txt'), 'utf8').trim();
  const payload = JSON.parse(reader(Buffer.from(wire))).b.o;
  assert.strictEqual(payload.cmd, 'dropItem');
  assert.strictEqual(payload.items[4713].sName, 'Unidentified 4');
  assert.strictEqual(reader('Zbroken'), '');
});
