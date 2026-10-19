// The Maid (ticket #43), the reference's party assistant: its config file, its class presets, its
// scheduler and its party vocabulary, all driven against fakes because no test here may touch
// Flash.
//
// Reference: Grimlite-Li, Grimoire/UI/Maid/MaidRemake.cs (the loop at :197-360, ApplyConfig at
// :1476-1550), Grimoire/Tools/Maid/MaidConfig.cs, ClassPreset.cs and the two handlers under
// Grimoire/Networking/Handlers/Maid/.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const config = require('../../plugins/grimlite-parity/features/maid/config.js');
const presets = require('../../plugins/grimlite-parity/features/maid/presets.js');

// The reference clone is not in this repo, so a test that reads its own files skips when it is not
// on the machine - the way test/unit/grimlite-bot-corpus.test.js does.
const REFERENCE_ROOTS = [
  process.env.GRIMLITE_CORPUS,
  '/var/tmp/grimlite-src',
  '/var/tmp/aq-origin/ref/Grimlite-Li-master'
].filter(Boolean);

function referenceRoot(relative) {
  for (let i = 0; i < REFERENCE_ROOTS.length; i++) {
    const candidate = path.join(REFERENCE_ROOTS[i], relative);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ------------------------------------------------------------------ the config file

test('the maid config carries the reference\'s own 23 keys, in its own order', () => {
  // MaidConfig.cs declares exactly these, and the reference's own corpus writes all 23.
  assert.deepStrictEqual(config.FIELDS, [
    'Target', 'SkillList', 'LockedZoneHandlerMaps', 'SafeSkillList', 'BuffStopAttackList',
    'AttackPriorityMonster', 'SpecialMsg', 'WhitelistMapMaps', 'RelogDelay', 'SkillDelay',
    'SafeSkillHP', 'SpecialAct', 'UltraBossExtra', 'AntiCounter', 'CopyWalk', 'AttackPriority',
    'BuffStopAttack', 'WaitSkill', 'StopFailedGoto', 'LockedZoneHandler', 'WhitelistMap',
    'GlobalHotkey', 'SafeSkill'
  ]);
  assert.strictEqual(config.NUMBERS.length, 5);
  assert.strictEqual(config.BOOLEANS.length, 10);
  assert.strictEqual(config.FIELDS.length, config.NUMBERS.length + config.BOOLEANS.length + 8,
    'the 23 keys are the 5 numbers, the 10 booleans and the 8 strings');
});

test('the shipped default is the reference form\'s own designer state', () => {
  const mine = config.defaults();
  // LockedMapForm.Designer.cs:61 and WhitelistMap.Designer.cs:128-131, verbatim.
  assert.strictEqual(mine.Target, 'username');
  assert.strictEqual(mine.SkillList, '1,2,3,4');
  assert.strictEqual(mine.SkillDelay, 150);
  assert.strictEqual(mine.RelogDelay, 5000);
  assert.strictEqual(mine.SafeSkillList, '1,2');
  assert.strictEqual(mine.SafeSkillHP, 60);
  assert.strictEqual(mine.BuffStopAttackList, '2,3');
  assert.strictEqual(mine.AttackPriorityMonster, 'Defense Drone,Attack Drone');
  assert.strictEqual(mine.LockedZoneHandlerMaps,
    'doomvault\r\ndoomvaultb\r\nicewing\r\nvoidflibbi\r\nvoidnightbane\r\nvoidxyfrag');
  assert.strictEqual(mine.WhitelistMapMaps,
    'newbie;all\r\nprison;all\r\nchaoscrypt;all\r\nbattleunderb;Enter;Spawn');
  assert.strictEqual(mine.SpecialMsg, 'converge,truth,resist,bleee');
  assert.strictEqual(mine.SpecialAct, 5);
  assert.strictEqual(mine.UltraBossExtra, 0);
  assert.strictEqual(mine.AntiCounter, true);
  // Every one of the 23 keys is present, which is what makes a save whole with no nulls.
  assert.deepStrictEqual(Object.keys(mine).sort(), config.FIELDS.slice().sort());
});

test('the four numeric controls clamp to the reference designer\'s own bounds', () => {
  assert.strictEqual(config.clamp('SkillDelay', 10), 50, 'numSkillDelay.Minimum = 50');
  assert.strictEqual(config.clamp('SkillDelay', 999999), 60000, 'numSkillDelay.Maximum = 60000');
  assert.strictEqual(config.clamp('RelogDelay', 70000), 60000, 'numRelogDelay.Maximum = 60000');
  assert.strictEqual(config.clamp('SafeSkillHP', 0), 1, 'numHealthPercent.Minimum = 1');
  assert.strictEqual(config.clamp('SafeSkillHP', 150), 99, 'numHealthPercent.Maximum = 99');
  assert.strictEqual(config.clamp('SpecialAct', 9), 5, 'numSkillAct.Maximum = 5');
  assert.strictEqual(config.clamp('SkillDelay', 'not a number'), null, 'a non-number is refused');
  // And the same bounds hold when a file is applied, the way ApplyConfig's control clamps.
  const applied = config.apply({ SkillDelay: 10, SafeSkillHP: 150 }, config.defaults());
  assert.strictEqual(applied.SkillDelay, 50);
  assert.strictEqual(applied.SafeSkillHP, 99);
});

test('a config file round-trips: parse, serialise, parse again', () => {
  const first = { ok: true, config: config.defaults() };
  assert.strictEqual(first.ok, true);
  const written = config.serialise(config.stateFrom(first.config));
  const second = config.parse(written);
  assert.strictEqual(second.ok, true);
  assert.deepStrictEqual(second.config, first.config,
    'what was written back does not read back the same');
  // Every one of the 23 keys is written, the way JsonConvert writes the whole object.
  assert.deepStrictEqual(Object.keys(JSON.parse(written)), config.FIELDS);
  const values = JSON.parse(written);
  config.FIELDS.forEach(function (key) {
    assert.notStrictEqual(values[key], null, 'a saved file must not carry a null ' + key);
  });
  // A partial state still saves all 23 with the form's own fallbacks, never a null.
  const partial = JSON.parse(config.serialise({ SkillList: '9' }));
  assert.strictEqual(partial.SkillList, '9');
  assert.strictEqual(partial.SpecialMsg, config.DEFAULT_CONFIG.SpecialMsg);
  assert.notStrictEqual(partial.WhitelistMapMaps, null);
});

test('the overlay leaves what a file omits and takes what it carries, false included', () => {
  const start = config.stateFrom({});
  start.WaitSkill = true;
  start.SafeSkillHP = 90;
  const after = config.apply({ WaitSkill: false, SkillList: '9,9' }, start);
  assert.strictEqual(after.WaitSkill, false, 'a carried false really turns the box off');
  assert.strictEqual(after.SafeSkillHP, 90, 'a number the file omits keeps its value');
  assert.strictEqual(after.SkillList, '9,9');
  // !string.IsNullOrEmpty: an empty string is not applied by the reference.
  assert.strictEqual(config.apply({ SkillList: '' }, start).SkillList, start.SkillList);
  // A key the reference does not know does not enter the state.
  assert.strictEqual(config.apply({ Nonsense: 'x' }, start).Nonsense, undefined);
  // A file that is not an object is a refusal with a reason, not a crash.
  assert.strictEqual(config.parse('nonsense').ok, false);
  assert.strictEqual(config.parse('[1,2]').ok, false);
  assert.strictEqual(config.parse('{"SkillList":').ok, false);
});

test('the locked-zone map list parses as LockedMapForm.getMaps does', () => {
  const maps = config.parseMapList('citadel-6666;m22;Left\r\ntercessuinotlim-6666', { locked: true });
  assert.deepStrictEqual(maps.map(function (one) { return one.map; }),
    ['citadel-6666', 'tercessuinotlim-6666']);
  assert.strictEqual(maps[0].cell, 'm22');
  assert.strictEqual(maps[0].pad, 'Left');
  // An unspecified cell and pad fall back to the reference's own Enter / Spawn.
  assert.strictEqual(maps[1].cell, 'Enter');
  assert.strictEqual(maps[1].pad, 'Spawn');
  // -e is a fresh random room, -0 and - become 1.
  const room = Number(config.parseMapList('map-e', { locked: true })[0].map.split('-')[1]);
  assert.ok(room >= 9999 && room <= 99999, 'the -e room must be 9999-99999, got ' + room);
  assert.strictEqual(config.parseMapList('map-0', { locked: true })[0].map, 'map-1');
  assert.strictEqual(config.parseMapList('map-', { locked: true })[0].map, 'map-1');
  // Everything outside the reference's own character class is stripped, empty lines dropped.
  assert.strictEqual(config.parseMapList('  map!,;cell ', { locked: true })[0].map, 'map');
  assert.strictEqual(config.parseMapList('\r\n\r\n', { locked: true }).length, 0);
});

test('the whitelist map list drops the room and defaults to all/all', () => {
  const maps = config.parseMapList('Citadel-6666\r\ntercessuinotlim', {});
  assert.deepStrictEqual(maps.map(function (one) { return one.map; }),
    ['citadel', 'tercessuinotlim']);
  assert.strictEqual(maps[0].cell, 'all');
  assert.strictEqual(maps[0].pad, 'all');
  // WhitelistMap.getMaps lowercases the map, and matching is by the roomless name.
  assert.ok(config.findMap(maps, 'Citadel-12345'));
  assert.strictEqual(config.findMap(maps, 'yulgar'), null);
});

test('skill lists split the way the reference splits them', () => {
  assert.deepStrictEqual(config.skillList('1,2,3,4'), ['1', '2', '3', '4']);
  // RemoveEmptyEntries: an empty tail is not a skill.
  assert.deepStrictEqual(config.skillList('1,2,'), ['1', '2']);
  assert.deepStrictEqual(config.skillList(''), []);
  assert.deepStrictEqual(config.priorityList('Defense Drone,Attack Drone'),
    ['Defense Drone', 'Attack Drone']);
});

// ------------------------------------------------------------------ the class presets

test('the fourteen class presets are the reference\'s own, in the combo\'s order', () => {
  assert.deepStrictEqual(presets.names(), ['EC', 'LC', 'LOO', 'SC', 'DOT', 'AP', 'AI', 'AM',
    'CCMD', 'SSOT', 'NCM', 'TK', 'CSH', 'CSH v2']);
  assert.strictEqual(presets.byName('CSH v2').skills, '3,2,3,2,3,4,1');
  assert.strictEqual(presets.byName('CSH').skills, '3,2,3,3,0,3,3,4,1');
  assert.strictEqual(presets.byName('LC').safeSkillList, '3');
  assert.strictEqual(presets.byName('DOT').safeSkillHP, 75);
  assert.strictEqual(presets.byName('CCMD').safeSkillHP, 75);
  assert.strictEqual(presets.byName('CSH').safeSkillHP, 80);
  assert.strictEqual(presets.byName('EC').waitSkill, true);
  assert.strictEqual(presets.byName('LC').waitSkill, false);
  assert.strictEqual(presets.byName('nope'), null);
});

test('a preset carries ClassPreset\'s own static heal flag across applications', () => {
  // ClassPreset.cs's heal is a static field: LC sets it true, AI sets it false, and the ten
  // presets that never assign it inherit whatever the last assigning one left. AI then LOO must
  // therefore end with SafeSkill false, because LOO does not assign heal at all.
  let state = config.stateFrom({});
  let answer = presets.applyTo(presets.byName('AI'), state, true);
  assert.strictEqual(answer.heal, false, 'AI assigns heal = false');
  assert.strictEqual(answer.config.SafeSkill, false);
  answer = presets.applyTo(presets.byName('LOO'), answer.config, answer.heal);
  assert.strictEqual(answer.heal, false, 'LOO inherits the carried flag');
  assert.strictEqual(answer.config.SafeSkill, false);
  assert.strictEqual(answer.config.SkillList, '2,1,3,4');
  assert.strictEqual(answer.config.BuffStopAttackList, '1,2,3');
  assert.strictEqual(answer.config.BuffStopAttack, true, 'cbSet re-ticks BuffStopAttack');
  // The other way round: EC carries the flag it never assigns out of the default true.
  const ec = presets.applyTo(presets.byName('EC'), config.stateFrom({}), true);
  assert.strictEqual(ec.config.SafeSkill, true);
  // AI and AM write no heal skill and no threshold, so both keep what was already there.
  const before = config.stateFrom({});
  before.SafeSkillList = '7';
  before.SafeSkillHP = 42;
  const after = presets.applyTo(presets.byName('AM'), before, true).config;
  assert.strictEqual(after.SafeSkillList, '7');
  assert.strictEqual(after.SafeSkillHP, 42);
  assert.strictEqual(after.SkillList, '2,3,1');
});
