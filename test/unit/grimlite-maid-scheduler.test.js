// The Maid's scheduler and its party half (ticket #43), driven against fakes: no test here may
// touch Flash. The loop's order and its own waits are the reference's (Grimoire/UI/Maid/
// MaidRemake.cs:197-360); the party vocabulary and the invitation answer are its two handlers'
// (Grimoire/Networking/Handlers/Maid/PartyChatHandler.cs, PartyInvitationHandler.cs).
const assert = require('assert');

const config = require('../../plugins/grimlite-parity/features/maid/config.js');
const party = require('../../plugins/grimlite-parity/features/maid/party.js');
const maidModel = require('../../plugins/grimlite-parity/features/maid/maid.js');
const { createLoaderSurface } = require('../../plugins/grimlite-parity/loader-surface.js');

// A game stand-in: a table of loader answers and a record of every call the scheduler made.
function fakeGame(answers) {
  const calls = [];
  const table = Object.assign({}, answers || {});
  return {
    calls: calls,
    // How many times one helper was called.
    count: function (name) {
      return calls.filter(function (one) { return one.name === name; }).length;
    },
    set: function (name, value) { table[name] = value; },
    // The arguments of the last call to one helper, which is what an assertion reads.
    payload: function (name) {
      const found = calls.filter(function (one) { return one.name === name; }).pop();
      return found ? found.args : null;
    },
    loaderCall: function (name, args) {
      calls.push({ name: name, args: args || [] });
      if (!Object.prototype.hasOwnProperty.call(table, name)) {
        return Promise.reject(new Error('no member ' + name + ' at the loader'));
      }
      const value = table[name];
      return Promise.resolve(typeof value === 'function' ? value(args) : value);
    },
    read: function (path) {
      calls.push({ name: 'read', args: [path] });
      if (!Object.prototype.hasOwnProperty.call(table, path)) {
        return Promise.resolve({ value: null, error: null });
      }
      return Promise.resolve({ value: table[path], error: null });
    }
  };
}

function fakeMaid(game, options) {
  const opts = options || {};
  const logs = [];
  const sent = [];
  const maid = maidModel.createMaid({
    game: game,
    config: function () { return opts.config || config.stateFrom({}); },
    log: function (line) { logs.push(line); },
    sleep: opts.sleep || function () { return Promise.resolve(); },
    send: function (frame) { sent.push(frame); return opts.writes === false ? false : true; },
    engineActivity: opts.engineActivity,
    engineRunning: opts.engineRunning,
    specialsHolding: opts.specialsHolding,
    specialCombo: opts.specialCombo,
    specialBalance: opts.specialBalance,
    taunt: opts.taunt
  });
  return { maid: maid, logs: logs, sent: sent };
}

// The map and cell a settled character stands in, so a test only says what it is about.
function standing(extra) {
  return Object.assign({
    IsLoggedIn: true, Map: 'yulgar', Cell: 'Enter', PlayersInMap: ['master'], GetCellPlayers: true,
    HasTarget: false, Health: 100, HealthMax: 100
  }, extra || {});
}

// The first tick after enabling is the reference's own waitForFirstJoin (it consumes the RelogDelay
// and answers). These tests set RelogDelay to 0, so the second tick is the first real pass.
async function settledTicks(fake, count) {
  await fake.maid.tick();
  let answer = null;
  for (let i = 0; i < (count === undefined ? 1 : count); i++) answer = await fake.maid.tick();
  return answer;
}

test('every loader helper the maid uses is one the surface names and implements', () => {
  // The table is asserted against the surface ticket #48 built, the way bot/session.js does, so a
  // name that is only spelled here cannot pass as one that works.
  const surface = createLoaderSurface(function () { return Promise.resolve(null); }, function () {});
  const implemented = surface.implemented();
  const named = surface.names();
  const unimplemented = Object.keys(maidModel.HELPERS).filter(function (name) {
    return implemented.indexOf(name) === -1;
  });
  // Ticket #49 made the last three answer: the attack and the cast hand the game a live object, and
  // the bridge movie resolves that object in its own ApplicationDomain rather than over the wire.
  // So the maid's whole helper list is live, and the declared-and-blocked table is now empty.
  assert.deepStrictEqual(unimplemented, [], 'every helper the maid calls must be implemented');
  ['AttackMonster', 'AttackMonsterByMonMapId', 'UseSkill'].forEach(function (name) {
    assert.ok(named.indexOf(name) !== -1, name + ' is a name the reference registers');
  });
  assert.deepStrictEqual(Object.keys(maidModel.BLOCKED), [],
    'nothing the maid calls is blocked any more');
});

test('the maid follows its target with the reference\'s own goto frame', async () => {
  const game = fakeGame({
    IsLoggedIn: true, Map: 'yulgar', Cell: 'Enter', PlayersInMap: ['someoneelse'],
    Health: 100, HealthMax: 100
  });
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0 }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  const first = await fake.maid.tick();
  assert.strictEqual(first.status, maidModel.STATUS.waitingJoin,
    'the first tick is the reference\'s wait for the first join');
  const second = await fake.maid.tick();
  assert.strictEqual(second.status, maidModel.STATUS.following);
  assert.deepStrictEqual(fake.sent, ['%xt%zm%cmd%1%goto%master%'],
    'the goto frame must be the reference\'s own');
});

test('the maid chases its target\'s cell when they share the map', async () => {
  const game = fakeGame(standing({
    // The target is in this map but not in this cell, which is the reference's own chase
    // condition (MaidRemake.cs:206): isPlayerInMyRoom && !isPlayerInMyCell.
    GetCellPlayers: false,
    PlayerByName: { strFrame: 'Battleon', strPad: 'Left' }
  }));
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0 }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.deepStrictEqual(game.payload('Jump'), ['Battleon', 'Left'],
    'the chase is the reference\'s own MoveToCell helper, with its cell and pad');
  assert.strictEqual(fake.sent.length, 0, 'a chase inside the map writes no frame');
});

test('an unfollowed maid does not chase, and the same-map follow falls back to GoTo', async () => {
  const game = fakeGame(standing({ PlayerByName: null, GetCellPlayers: false }));
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0 }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.strictEqual(fake.maid.state().status, maidModel.STATUS.following);
  assert.strictEqual(game.count('GoTo'), 1, 'with no cell to walk to, the loader GoTo is used');
  assert.strictEqual(fake.sent.length, 0, 'a walk inside the map writes no frame');

  // Unfollowed: the reference guards the whole chase on `!cbUnfollow.Checked` (MaidRemake.cs:206,
  // :342), so the maid stays exactly where it is and never walks or writes a frame.
  const idle = fakeGame(standing({ PlayerByName: null, GetCellPlayers: false }));
  const stay = fakeMaid(idle, { config: config.stateFrom({ RelogDelay: 0 }) });
  stay.maid.setTarget('master');
  stay.maid.setUnfollow(true);
  stay.maid.setEnabled(true);
  await settledTicks(stay);
  assert.strictEqual(idle.count('GoTo'), 0, 'an unfollowed maid does not walk');
  assert.strictEqual(stay.sent.length, 0, 'and writes nothing');
  assert.strictEqual(stay.maid.state().status, maidModel.STATUS.unfollowed);
});

test('the maid stops after five failed gotos when StopFailedGoto is on', async () => {
  const game = fakeGame({
    IsLoggedIn: true, Map: 'yulgar', Cell: 'Enter', PlayersInMap: [],
    Health: 100, HealthMax: 100
  });
  const fake = fakeMaid(game, {
    config: config.stateFrom({ RelogDelay: 0, StopFailedGoto: true, SkillDelay: 0 }),
    writes: false
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake, 5);
  assert.strictEqual(fake.maid.running(), false, 'five failed gotos stop the maid');
  assert.ok(fake.logs.join('\n').indexOf('five times') !== -1, 'the stop is said, not silent');
  // With the box off the same failures keep it running, which is the reference's own default.
  const patient = fakeMaid(game, {
    config: config.stateFrom({ RelogDelay: 0, StopFailedGoto: false, SkillDelay: 0 }),
    writes: false
  });
  patient.maid.setTarget('master');
  patient.maid.setEnabled(true);
  await settledTicks(patient, 6);
  assert.strictEqual(patient.maid.running(), true);
});

test('StopAttack cancels the attack and fires the buff list, the reference\'s own side effects', async () => {
  const game = fakeGame(standing({ HasTarget: true }));
  const fake = fakeMaid(game, {
    config: config.stateFrom({ RelogDelay: 0, BuffStopAttack: true, BuffStopAttackList: '2,3' })
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  fake.maid.setStopAttack(true);
  // cbStopAttack_CheckedChanged does its three calls the moment the box is ticked; that is a
  // promise chain, so one turn of the event loop is enough to see it.
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual(game.count('CancelAutoAttack'), 1);
  assert.strictEqual(game.count('CancelTarget'), 1);
  assert.strictEqual(game.count('Rest'), 1);
  game.calls.length = 0;
  const answer = await fake.maid.tick();
  assert.strictEqual(answer.status, maidModel.STATUS.stopped);
  assert.strictEqual(game.count('CancelAutoAttack'), 1, 'the loop keeps the attack cancelled');
  assert.deepStrictEqual(game.payload('UseSkill'), ['2'], 'the buff list fires, one step per tick');
  // The buff list is the reference's own `Buff If StopAttack` box: off means no buff at all.
  const quiet = fakeMaid(game, {
    config: config.stateFrom({ RelogDelay: 0, BuffStopAttack: false, BuffStopAttackList: '2,3' })
  });
  quiet.maid.setTarget('master');
  quiet.maid.setEnabled(true);
  await settledTicks(quiet);
  quiet.maid.setStopAttack(true);
  game.calls.length = 0;
  await quiet.maid.tick();
  assert.strictEqual(game.count('UseSkill'), 0);
});

test('the safe skill fires under its own threshold and the attack list otherwise', async () => {
  const game = fakeGame(standing({ Health: 40, HasTarget: true }));
  const fake = fakeMaid(game, {
    config: config.stateFrom({
      RelogDelay: 0, SafeSkill: true, SafeSkillHP: 60, SafeSkillList: '1,2', SkillDelay: 0
    })
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.deepStrictEqual(game.payload('UseSkill'), ['1'], 'the heal list goes first');
  game.calls.length = 0;
  await fake.maid.tick();
  assert.deepStrictEqual(game.payload('UseSkill'), ['2'], 'and steps through its own list');
  // Healthy again: the attack list takes over. The reference gates the heal on a non-empty heal
  // list as well as the box, so an empty SafeSkillList means no heal whatever the box says.
  game.set('Health', 100);
  game.calls.length = 0;
  await fake.maid.tick();
  assert.deepStrictEqual(game.payload('UseSkill'), ['1'], 'the skill list starts at its own 1');
  const noHeal = fakeMaid(game, {
    config: config.stateFrom({
      RelogDelay: 0, SafeSkill: true, SafeSkillHP: 60, SafeSkillList: '', SkillDelay: 0
    })
  });
  noHeal.maid.setTarget('master');
  noHeal.maid.setEnabled(true);
  await settledTicks(noHeal);
  assert.deepStrictEqual(game.payload('UseSkill'), ['1'], 'an empty heal list is the attack list');
});

test('AttackPriority walks its own list before the wildcard', async () => {
  const game = fakeGame(standing({
    HasTarget: false,
    AttackMonster: true,
    'world.myAvatar.target.objData.strMonName': '',
    'world.myAvatar.target.objData.MonMapID': ''
  }));
  // The helper sets the game's own target, the way the reference's `world.setTarget` does
  // (Player.cs:344-366), so `HasTarget` answers true on the next read - which is what keeps the
  // wildcard from being sent on top of a priority target.
  game.set('AttackMonsterByMonMapId', function () {
    game.set('HasTarget', true);
    game.set('world.myAvatar.target.objData.strMonName', 'Boss');
    game.set('world.myAvatar.target.objData.MonMapID', '3');
    return true;
  });
  const fake = fakeMaid(game, {
    config: config.stateFrom({
      RelogDelay: 0, AttackPriority: true, AttackPriorityMonster: 'id.3,Boss', SkillDelay: 0
    })
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.deepStrictEqual(game.payload('AttackMonsterByMonMapId'), ['3'],
    'an id.N entry goes to the reference\'s own by-id helper, without the prefix');
  assert.strictEqual(game.calls.filter(function (one) { return one.name === 'AttackMonster'; }).length,
    0, 'the wildcard is not sent when the priority target took');
  // Nothing in the priority list answers: the fallback below is the wildcard's own test.
  const empty = fakeGame(standing({ HasTarget: false, AttackMonster: true }));
  const fallback = fakeMaid(empty, {
    config: config.stateFrom({
      RelogDelay: 0, AttackPriority: true, AttackPriorityMonster: 'id.3,Boss', SkillDelay: 0
    })
  });
  fallback.maid.setTarget('master');
  fallback.maid.setEnabled(true);
  await settledTicks(fallback);
  assert.strictEqual(empty.count('AttackMonsterByMonMapId'), 1,
    'the by-id entry is tried first');
  assert.deepStrictEqual(empty.calls.filter(function (one) { return one.name === 'AttackMonster'; })
    .map(function (one) { return one.args[0]; }), ['Boss', '*'],
    'the list is walked in order and the wildcard is the last resort');
});

test('AttackPriority steps aside when the target it already holds is the one it wants', async () => {
  // The reference's own early return (MaidRemake.cs:854-856): the CSH no-autoattack case, where a
  // held target matching the list is not attacked again.
  const game = fakeGame(standing({
    HasTarget: true,
    AttackMonster: true,
    AttackMonsterByMonMapId: true,
    'world.myAvatar.target.objData.strMonName': 'Defense Drone',
    'world.myAvatar.target.objData.MonMapID': '3'
  }));
  const fake = fakeMaid(game, {
    config: config.stateFrom({
      RelogDelay: 0, AttackPriority: true, AttackPriorityMonster: 'id.3,Defense Drone', SkillDelay: 0
    })
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.strictEqual(game.count('AttackMonsterByMonMapId'), 0, 'the held id is not re-attacked');
  assert.strictEqual(game.count('AttackMonster'), 0, 'nor is the held name');
});

test('the wildcard attack is the last resort and a target that did not change is reported', async () => {
  const game = fakeGame(standing({
    HasTarget: false,
    AttackMonster: true,
    'world.myAvatar.target.objData.strMonName': 'Slime'
  }));
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0, SkillDelay: 0 }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.deepStrictEqual(game.payload('AttackMonster'), ['*']);
  assert.ok(fake.maid.note() === null || !/not /.test(fake.maid.note()),
    'the wildcard does not compare names');
  assert.deepStrictEqual(game.calls.filter(function (one) { return one.name === 'read'; })[0].args,
    [maidModel.TARGET_NAME_PATH], 'the read-back is the one documented path read');
});

test('WaitSkill gates the next skill on the game\'s own cooldown answer', async () => {
  const game = fakeGame(standing({ HasTarget: true, SkillAvailable: 250 }));
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0, WaitSkill: true }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  const answer = await fake.maid.tick();
  assert.strictEqual(answer.waiting, 'cooldown');
  assert.strictEqual(game.count('UseSkill'), 0, 'a skill on cooldown is not cast');
  // A ready skill is cast and the rotation moves on.
  game.set('SkillAvailable', 0);
  game.calls.length = 0;
  await fake.maid.tick();
  assert.deepStrictEqual(game.payload('UseSkill'), ['1']);
});

test('a dead character is sent to its spawn point and the maid carries on', async () => {
  const game = fakeGame(standing({ Health: 0 }));
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0 }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.strictEqual(fake.maid.state().status, maidModel.STATUS.dead);
  assert.strictEqual(game.count('SetSpawnPoint'), 1);
  assert.strictEqual(game.count('UseSkill'), 0);
});

test('a map that is loading is a pause, not a follow', async () => {
  const game = fakeGame({ IsLoggedIn: true, Health: 100, HealthMax: 100 });
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0 }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await fake.maid.tick();
  const answer = await fake.maid.tick();
  assert.strictEqual(answer.status, maidModel.STATUS.reloading,
    'the map and the cell being unreadable is the reference\'s own map-loading wait');
  assert.strictEqual(fake.sent.length, 0);
});

test('a logged-out character waits and the loop says so', async () => {
  const game = fakeGame({ IsLoggedIn: false });
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0 }) });
  fake.maid.setEnabled(true);
  const answer = await fake.maid.tick();
  assert.strictEqual(answer.status, maidModel.STATUS.waitingSignIn);
  assert.strictEqual(game.count('Map'), 0, 'nothing is read before a character is in');
});

test('the maid yields to the bot engine and logs the collision once per command', async () => {
  const game = fakeGame(standing({}));
  const activity = { count: 3, command: 'CmdKill' };
  const fake = fakeMaid(game, {
    config: config.stateFrom({ RelogDelay: 0 }),
    engineActivity: function () { return activity; },
    engineRunning: function () { return true; }
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  const first = await fake.maid.tick();
  assert.strictEqual(first.status, maidModel.STATUS.collision);
  assert.strictEqual(game.calls.length, 0,
    'the engine holds the current command, so the maid touches nothing this tick');
  assert.ok(fake.logs.join('\n').indexOf('CmdKill') !== -1, 'the collision names the command');
  const again = await fake.maid.tick();
  assert.strictEqual(again.collision, undefined, 'the same command is logged once, not per tick');
  assert.strictEqual(fake.maid.collisions(), 1);
  // A new command is a new collision.
  activity.count = 4;
  activity.command = 'CmdAttack';
  await fake.maid.tick();
  assert.strictEqual(fake.maid.collisions(), 2);
  assert.strictEqual(fake.maid.state().engineRunning, true);
  assert.strictEqual(fake.maid.state().status, maidModel.STATUS.collision);
});

test('a stopped engine is not a collision, and neither is a silent one', async () => {
  const game = fakeGame(standing({ HasTarget: true }));
  let running = false;
  const activity = { count: 0, command: null };
  const fake = fakeMaid(game, {
    config: config.stateFrom({ RelogDelay: 0, SkillDelay: 0 }),
    engineActivity: function () { return activity; },
    engineRunning: function () { return running; }
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.strictEqual(fake.maid.collisions(), 0);
  assert.strictEqual(fake.maid.state().engineRunning, false);
  // With the engine on but no new command since the last tick, the maid still has its turn.
  running = true;
  game.calls.length = 0;
  await fake.maid.tick();
  assert.strictEqual(fake.maid.collisions(), 0, 'no new command means no collision');
  assert.ok(game.calls.length > 0, 'the maid keeps working between the engine\'s commands');
});

test('a Maid tc; turn arms SpecialAct through the shared scheduler', async () => {
  const game = fakeGame(standing({
    HasTarget: true, AttackMonster: true, SkillAvailable: 0, UseSkill: true, ForceUseSkill: true
  }));
  game.set(maidModel.TARGET_NAME_PATH, 'Gramiel');
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0, SkillDelay: 0 }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await fake.maid.tick();
  const queued = await fake.maid.tauntCycleAttack('Gramiel', '4');
  assert.strictEqual(queued.ok, true);
  const result = await fake.maid.tick();
  assert.strictEqual(result.cast, '4');
  assert.deepStrictEqual(game.payload('AttackMonster'), ['Gramiel']);
  assert.deepStrictEqual(game.payload('ForceUseSkill'), ['4']);
  assert.strictEqual(game.calls.some(function (one) {
    return one.name === 'UseSkill' && one.args[0] === '5';
  }), false, 'the Maid cycle uses the selected SpecialAct, not the bot cycle skill');
  await fake.maid.stop();
});

test('a Maid tc; turn yields to a new bot command before attacking', async () => {
  const game = fakeGame(standing({ HasTarget: true }));
  const activity = { count: 1, command: 'CmdKill' };
  const fake = fakeMaid(game, {
    engineActivity: function () { return activity; },
    engineRunning: function () { return true; }
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  const answer = await fake.maid.tauntCycleAttack('Gramiel', '4');
  assert.strictEqual(answer.deferred, true);
  assert.strictEqual(game.count('AttackMonster'), 0);
  assert.ok(fake.logs.some(function (line) { return /CmdKill/.test(line); }));
  await fake.maid.stop();
});

test('the maid\'s visible state says whether it is paused, unfollowed or holding a stop', async () => {
  const game = fakeGame(standing({}));
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0 }) });
  fake.maid.setTarget('Master');
  assert.strictEqual(fake.maid.getTarget(), 'master', 'the name is kept lowercase as the game spells it');
  assert.strictEqual(fake.maid.state().enabled, false);
  assert.strictEqual(fake.maid.state().status, maidModel.STATUS.off, 'off is the resting state');
  fake.maid.setEnabled(true);
  assert.strictEqual(fake.maid.state().enabled, true);
  assert.strictEqual(fake.maid.state().status, maidModel.STATUS.waitingSignIn);
  fake.maid.setUnfollow(true);
  assert.strictEqual(fake.maid.state().unfollow, true);
  assert.strictEqual(fake.maid.state().status, maidModel.STATUS.unfollowed,
    'unfollow outranks the loop\'s own word for what it is doing');
  fake.maid.setUnfollow(false);
  fake.maid.setStopAttack(true);
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  await fake.maid.tick();
  assert.strictEqual(fake.maid.state().status, maidModel.STATUS.stopped);
  fake.maid.setStopAttack(false);
  fake.maid.setPaused(true);
  assert.strictEqual(fake.maid.state().paused, true);
  assert.strictEqual((await fake.maid.tick()).status, maidModel.STATUS.paused);
  fake.maid.toggleEnabled();
  assert.strictEqual(fake.maid.state().enabled, false);
  assert.strictEqual(fake.maid.state().status, maidModel.STATUS.off);
});

test('the two keys toggle the two states, whichever way the window or the key asks', () => {
  const game = fakeGame(standing({}));
  const fake = fakeMaid(game, { config: config.stateFrom({}) });
  assert.strictEqual(fake.maid.toggleUnfollow(), true);
  assert.strictEqual(fake.maid.state().unfollow, true);
  assert.strictEqual(fake.maid.toggleUnfollow(), false);
  assert.strictEqual(fake.maid.toggleStopAttack(), true);
  assert.strictEqual(fake.maid.state().stopAttack, true);
  assert.strictEqual(fake.maid.toggleStopAttack(), false);
  // The reference's own checkbox names: Unfollow (R) and StopAttack (T).
  assert.ok(/Unfollow/.test(require('fs').readFileSync(
    require('path').join(__dirname, '../../plugins/grimlite-parity/features/maid/maid.html'), 'utf8')));
});

test('a skill the game could not answer is reported, never counted as a cast that happened', async () => {
  const game = fakeGame(standing({ HasTarget: true }));
  // This stand-in answers only the names it was given, so UseSkill is refused by it. The point is
  // unchanged whatever the reason: the maid reports the failure into its note and its state rather
  // than returning a cast. (UseSkill itself is implemented - ticket #49.)
  const fake = fakeMaid(game, { config: config.stateFrom({ RelogDelay: 0, SkillDelay: 0 }) });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  const answer = await settledTicks(fake);
  assert.strictEqual(answer.ok, true, 'the loop keeps running past a refused skill');
  assert.strictEqual(answer.cast, '1');
  assert.ok(/UseSkill/.test(fake.maid.note()), 'the note names the helper: ' + fake.maid.note());
  assert.ok(fake.maid.state().missing.indexOf('UseSkill') !== -1,
    'the state carries the names the surface refused');
});

// ------------------------------------------------------------------ the party vocabulary

function fakeParty(options) {
  const opts = options || {};
  const calls = [];
  const frames = [];
  const state = { target: '', enabled: false };
  const answers = opts.answers || {};
  const half = party.createParty({
    game: {
      loaderCall: function (name, args) {
        calls.push({ name: name, args: args || [] });
        if (answers[name] === false) return Promise.reject(new Error('no member ' + name));
        return Promise.resolve(true);
      }
    },
    send: function (frame) { frames.push(frame); return opts.writes === false ? false : true; },
    state: function () { return state; },
    setState: function (patch) { Object.assign(state, patch); },
    log: function () {},
    sleep: function () { return Promise.resolve(); }
  });
  return { party: half, calls: calls, frames: frames, state: state };
}

test('a party chat line is read the way PartyChatHandler reads it', () => {
  assert.deepStrictEqual(party.parseLine('.join foo'),
    { command: '.join', argument: 'foo', line: '.join foo' });
  assert.strictEqual(party.parseLine('plain chat'), null, 'only a .-prefixed line is a command');
  assert.strictEqual(party.parseLine('.nonsense x'), null);
  assert.deepStrictEqual(party.COMMANDS,
    ['.tp', '.join', '.acc', '.turnin', '.target', '.stop', '.start']);
  // XtMessage splits the frame on '%' and keeps the leading empty field.
  const args = party.xtArguments('%xt%zm%chatm%32123%party~.stop%player%2049%');
  assert.deepStrictEqual(args.slice(0, 5), ['', 'xt', 'zm', 'chatm', '32123']);
  assert.strictEqual(party.xtCommand(args), 'chatm');
  assert.strictEqual(party.xtCommand(party.xtArguments('%xt%chatm%1%party~.stop%')), 'chatm',
    'the reference\'s own two spellings of the same frame');
  assert.strictEqual(party.partyField(args), 'party~.stop');
  assert.strictEqual(party.partyField(args.slice(0, 3)), null);
});

test('.join and .tp join the map through the loader\'s own name', async () => {
  const join = fakeParty();
  await join.party.run(party.parseLine('.join yulgar-1234'));
  assert.deepStrictEqual(join.calls[0], { name: 'Join', args: ['yulgar-1234'] });

  const tp = fakeParty();
  await tp.party.run(party.parseLine('.tp tercessuinotlim-6666'));
  assert.deepStrictEqual(tp.calls[0], { name: 'Jump', args: ['m22', 'Left'] },
    'the reference\'s own exception: tercessuinotlim first steps to m22 / Left');
  assert.deepStrictEqual(tp.calls[1], { name: 'Join', args: ['tercessuinotlim-6666', 'Enter', 'Spawn'] });

  const plain = fakeParty();
  await plain.party.run(party.parseLine('.tp yulgar'));
  assert.deepStrictEqual(plain.calls.map(function (one) { return one.name; }), ['Join']);
});

test('.acc and .turnin walk their quest ids the way the reference does', async () => {
  const acc = fakeParty();
  await acc.party.run(party.parseLine('.acc 1,2'));
  assert.deepStrictEqual(acc.calls.map(function (one) { return one.name; }),
    ['GetQuests', 'Accept', 'Accept']);
  assert.deepStrictEqual(acc.calls[0].args, ['1,2'], 'GetQuests takes the whole list, as the reference passes it');
  assert.deepStrictEqual(acc.calls[1].args, ['1']);
  assert.deepStrictEqual(acc.calls[2].args, ['2']);

  const one = fakeParty();
  await one.party.run(party.parseLine('.acc 42'));
  assert.deepStrictEqual(one.calls.map(function (call) { return call.name; }), ['GetQuests', 'Accept']);

  const turnin = fakeParty();
  await turnin.party.run(party.parseLine('.turnin 7,8,9'));
  assert.deepStrictEqual(turnin.calls.map(function (call) { return call.name; }),
    ['Complete', 'Complete', 'Complete']);
  assert.deepStrictEqual(turnin.calls.map(function (call) { return call.args[0]; }), ['7', '8', '9']);
});

test('.target, .stop and .start move the maid\'s own state', async () => {
  const fake = fakeParty();
  await fake.party.run(party.parseLine('.target Kirin'));
  assert.strictEqual(fake.state.target, 'Kirin');
  await fake.party.run(party.parseLine('.stop'));
  assert.strictEqual(fake.state.enabled, false);
  await fake.party.run(party.parseLine('.start'));
  assert.strictEqual(fake.state.enabled, true);
  // A command with no argument answers with what it needs, rather than joining an empty map.
  const bare = await fake.party.run(party.parseLine('.join'));
  assert.strictEqual(bare.ok, false);
  assert.deepStrictEqual(fake.calls, [], 'nothing is sent for a command that cannot run');
});

test('a party chat frame off the tap runs the command, and other frames are ignored', async () => {
  const fake = fakeParty();
  const handled = await fake.party.handleFrame({
    direction: 'toClient',
    data: '%xt%zm%chatm%32123%party~.join yulgar%player%2049%0%0%'
  });
  assert.deepStrictEqual(fake.calls.map(function (one) { return one.name; }), ['Join']);
  assert.strictEqual(handled.kind, 'command');
  assert.strictEqual(handled.ok, true);
  // PartyChatHandler is an IXtMessageHandler, so it only ever saw the client's own frames.
  assert.strictEqual(await fake.party.handleFrame({
    direction: 'toServer', data: '%xt%zm%chatm%1%party~.join x%'
  }), null);
  // Room chat is not party chat, and a party line without the dot is not a command.
  assert.strictEqual(await fake.party.handleFrame({
    direction: 'toClient', data: '%xt%zm%chatm%1%room~.join x%'
  }), null);
  assert.strictEqual(await fake.party.handleFrame({
    direction: 'toClient', data: '%xt%zm%chatm%1%party~hello%'
  }), null);
  assert.strictEqual(await fake.party.handleFrame({ direction: 'toClient', data: 'not a frame' }), null);
  assert.strictEqual(await fake.party.handleFrame(null), null);
  assert.deepStrictEqual(fake.calls.length, 1, 'only the one real command ran');
});

test('a party invitation is answered with the reference\'s own frame', async () => {
  const fake = fakeParty();
  const answer = await fake.party.handleFrame({
    direction: 'toClient',
    data: JSON.stringify({ command: 'pi', pid: '12345' })
  });
  assert.strictEqual(answer.kind, 'invitation');
  assert.strictEqual(answer.ok, true);
  assert.deepStrictEqual(fake.frames, ['%xt%zm%gp%1%pa%12345%']);
  // A frame that is not an invitation is not answered.
  assert.strictEqual(await fake.party.handleFrame({
    direction: 'toClient', data: '{"command":"moveToArea"}'
  }), null);
  assert.strictEqual(await fake.party.handleFrame({ direction: 'toClient', data: '{"pid":"9"}' }), null);
  // The relay answers whether it wrote the frame; false means the invitation went unanswered.
  const dead = fakeParty({ writes: false });
  const refused = await dead.party.handleFrame({
    direction: 'toClient', data: JSON.stringify({ command: 'pi', pid: '7' })
  });
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.frame, '%xt%zm%gp%1%pa%7%');
  assert.deepStrictEqual(dead.frames, ['%xt%zm%gp%1%pa%7%'], 'the frame is reported, not queued');
});

test('a party command the game refuses answers with the reason instead of a value', async () => {
  const fake = fakeParty({ answers: { Join: false } });
  const answer = await fake.party.run(party.parseLine('.join nowhere'));
  assert.strictEqual(answer.ok, false);
  assert.ok(/no member Join/.test(answer.error), 'the game\'s own words are kept: ' + answer.error);
  // A bracketed quest list still answers what the first entries did before the refusal.
  const partial = fakeParty({ answers: { Complete: false } });
  const half = await partial.party.run(party.parseLine('.turnin 1,2'));
  assert.strictEqual(half.ok, false);
  assert.deepStrictEqual(half.completed, []);
});
test('the priority walk steps aside while a per-boss handler holds the target', async () => {
  // The reference's own first line in doPriorityAttack (MaidRemake.cs:838-840): `if (balance ||
  // locktarget) return;`. `locktarget` belongs to two of the per-boss handlers (#44) - the
  // counter-attack warning and Gramiel's drain - and `balance` to the crystal-HP walk. The walk
  // therefore has to ask the handler half before it attacks anything, and the two flags are read
  // through a seam because the scheduler does not own them.
  const game = fakeGame(standing({
    HasTarget: false,
    AttackMonster: true,
    'world.myAvatar.target.objData.strMonName': '',
    'world.myAvatar.target.objData.MonMapID': ''
  }));
  let holding = false;
  const fake = fakeMaid(game, {
    config: config.stateFrom({
      RelogDelay: 0, AttackPriority: true, AttackPriorityMonster: 'id.3,Boss', SkillDelay: 0
    }),
    specialsHolding: function () { return holding; }
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.strictEqual(game.count('AttackMonsterByMonMapId'), 1,
    'with nothing holding, the walk runs: its own first entry is attacked');

  // The drain holds the target on Gramiel for four seconds; while it does, the walk is silent.
  // (The wildcard below is the loop's own separate line in the reference, deliberately outside
  // doPriorityAttack, so it is not what this guard covers - and during a real drain the held
  // target means it does not fire anyway.)
  holding = true;
  game.calls.length = 0;
  await settledTicks(fake);
  assert.strictEqual(game.count('AttackMonsterByMonMapId'), 0,
    'while the target is held the walk does not run: the early return is before the list');
  assert.deepStrictEqual(game.calls.filter(function (one) {
    return one.name === 'AttackMonster';
  }).map(function (one) { return one.args[0]; }).filter(function (name) { return name === 'Boss'; }),
    [], 'nor does it reach the list\'s own later entries');
});
test('the fighting pass starts the tc; cycle the reference starts there', async () => {
  // MaidRemake.cs:294-296, inside the loop's own `if (Player.HasTarget)` branch, in this order:
  // `await SpecialCombo(); if (tauntTask == null) taunt();`. `taunt()` is the only thing that
  // reads a `tc;` SpecialMsg and starts the rotation, so a fighting pass that never reaches it
  // leaves the whole taunt-cycle feature unreachable however complete its own body is.
  const game = fakeGame(standing({
    HasTarget: true, IsMonsterAvailable: true, AttackMonster: true,
    SkillAvailable: 0, UseSkill: true
  }));
  const calls = [];
  const fake = fakeMaid(game, {
    config: config.stateFrom({ RelogDelay: 0, SkillDelay: 0, SpecialMsg: 'tc;2;Gramiel;12' }),
    taunt: function () { calls.push('taunt'); return { ok: true, running: true }; }
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.deepStrictEqual(calls, ['taunt'],
    'the fighting pass asks the taunt once, the way the reference does while no cycle runs');
  await fake.maid.stop();
});

test('Auto Potion runs its skill-5 wait inside the target branch before taunt', async () => {
  const waits = [];
  const order = [];
  let cooldownReads = 0;
  const game = fakeGame(standing({
    HasTarget: true,
    SkillAvailable: function () { return ++cooldownReads === 1 ? 2300 : 1; },
    ForceUseSkill: true,
    UseSkill: true
  }));
  const fake = fakeMaid(game, {
    config: config.stateFrom({ RelogDelay: 0, SkillDelay: 0 }),
    sleep: function (ms) { waits.push(ms); return Promise.resolve(); },
    specialCombo: function () { order.push('special'); return true; },
    taunt: function () { order.push('taunt'); }
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await settledTicks(fake);
  assert.deepStrictEqual(order, ['special', 'taunt'], 'the reference awaits SpecialCombo before taunt');
  assert.deepStrictEqual(game.payload('ForceUseSkill'), ['5'], 'Auto Potion forces skill 5');
  assert.deepStrictEqual(waits.slice(0, 2), [1500, 50], 'waitSkill caps cooldown then polls after 50 ms');
  await fake.maid.stop();

  const noTarget = fakeMaid(fakeGame(standing({ HasTarget: false, AttackMonster: true })), {
    config: config.stateFrom({ RelogDelay: 0 }),
    specialCombo: function () { throw new Error('Auto Potion requires a target'); }
  });
  noTarget.maid.setTarget('master');
  noTarget.maid.setEnabled(true);
  await settledTicks(noTarget);
  await noTarget.maid.stop();
});

test('a crystal balance force-skill pass reselects the priority target before casting', async () => {
  const game = fakeGame(standing({
    HasTarget: true, AttackMonster: true, AttackMonsterByMonMapId: true,
    SkillAvailable: 0, ForceUseSkill: true
  }));
  const balanceCalls = [];
  const fake = fakeMaid(game, {
    config: config.stateFrom({
      RelogDelay: 0, SkillDelay: 0, AttackPriority: true, AttackPriorityMonster: 'Boss'
    }),
    specialBalance: function (forceSkill) {
      balanceCalls.push(forceSkill);
      return forceSkill ? { priorityAttack: true } : null;
    }
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await fake.maid.tick();
  fake.maid.armSkill('5');
  await fake.maid.tick();
  assert.deepStrictEqual(balanceCalls, [true]);
  assert.deepStrictEqual(game.payload('AttackMonster'), ['Boss'],
    'the Maid reselects priority after releasing the crystal hold');
  assert.deepStrictEqual(game.payload('ForceUseSkill'), ['5']);
  await fake.maid.stop();
});

test('a SpecialAct waits for a target and suppresses AttackPriority until its forced cast', async () => {
  const game = fakeGame(standing({
    HasTarget: false, IsMonsterAvailable: true, AttackMonster: true,
    AttackMonsterByMonMapId: true, SkillAvailable: 0, UseSkill: true, ForceUseSkill: true
  }));
  const fake = fakeMaid(game, {
    config: config.stateFrom({
      RelogDelay: 0, SkillDelay: 0, AttackPriority: true,
      AttackPriorityMonster: 'Boss', SkillList: '1'
    })
  });
  fake.maid.setTarget('master');
  fake.maid.setEnabled(true);
  await fake.maid.tick();
  fake.maid.armSkill('5');
  await fake.maid.tick();
  const bossAttacks = function () {
    return game.calls.filter(function (one) {
      return one.name === 'AttackMonster' && one.args[0] === 'Boss';
    }).length;
  };
  assert.strictEqual(game.count('ForceUseSkill'), 0,
    'the phrase action remains armed until the reference has a target');
  assert.strictEqual(bossAttacks(), 0,
    'AttackPriority is skipped while forceSkill is waiting to be spent');

  game.set('HasTarget', true);
  await fake.maid.tick();
  assert.strictEqual(bossAttacks(), 0,
    'a pending forced action still suppresses the configured priority walk');
  assert.strictEqual(game.count('ForceUseSkill'), 2,
    'waitSkill forces once, then retries after twenty cooldown checks');
  await fake.maid.stop();
});

test('the existing Maid scheduler services active Misc 2 handlers without enabling Maid mode', async () => {
  let active = true;
  let passes = 0;
  const maid = maidModel.createMaid({
    game: fakeGame(standing()),
    sleep: function () { return Promise.resolve(); },
    auxiliaryActive: function () { return active; },
    auxiliaryTick: function () {
      passes++;
      active = false;
      return Promise.resolve({ ok: true });
    }
  });
  assert.strictEqual(maid.state().enabled, false, 'the ordinary Maid checkbox stays off');
  maid.wake();
  await maid.idle();
  assert.strictEqual(passes, 1, 'one existing-scheduler pass services the active handler');
  assert.strictEqual(maid.state().enabled, false, 'handler service does not start Maid follow/combat');
});
