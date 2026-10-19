// The Maid's auto-zone handlers (ticket #44), driven against fakes: no test here may touch Flash.
//
// Reference: Grimlite-Li, Grimoire/UI/BotManager.cs `UpdateSpecialHandler` (:3346-3430, the combo
// and its 15 entries) and one file per family under Grimoire/Networking/Handlers/:
// HandlerAutoZoneUltraDage.cs, HandlerAutoZoneDarkCarnax.cs, HandlerAutoZoneAstralEmpyrean.cs,
// HandlerAutoZoneAstralEmpyreanP1.cs (which holds P1 **and** P2),
// HandlerAutoZoneQueenIona.cs, HandlerAutoZoneVordred.cs, HandlerUltraGramielTaunt.cs (P1-P4) and
// HandlerUltraSpeakerMechanics.cs (DPS, LR, LOO, AP).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const zones = require('../../plugins/grimlite-parity/features/maid/zones.js');
const surface = require('../../plugins/grimlite-parity/loader-surface.js');

const REFERENCE_ROOTS = [
  process.env.GRIMLITE_CORPUS,
  '/var/tmp/grimlite-src',
  '/var/tmp/aq-origin/ref/Grimlite-Li-master'
].filter(Boolean);

function referenceFile(relative) {
  for (let i = 0; i < REFERENCE_ROOTS.length; i++) {
    const candidate = path.join(REFERENCE_ROOTS[i], relative);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// A game stand-in: a table of loader answers and a record of every call the handler made. A name
// the table carries answers; anything else refuses in the surface's own words, so a call this
// build cannot drive reaches the log with the reason the surface wrote for it (#38/#49).
function fakeGame(answers) {
  const calls = [];
  const table = Object.assign({}, answers || {});
  const bridge = {
    call: function (callback, args) {
      const name = args[0];
      if (callback === 'getGameObject') {
        if (Object.prototype.hasOwnProperty.call(table, name)) return Promise.resolve(table[name]);
        return Promise.reject(new Error('no member ' + String(name).split('.').pop() + ' at ' + name));
      }
      // The six calls #49 moved onto the movie's side of the boundary are not paths: the callback
      // name IS the handle's name (loader-surface.js ctx.raw), so the fake answers by callback -
      // which is also what the real bridge does.
      if (Object.prototype.hasOwnProperty.call(table, callback)) return Promise.resolve(table[callback]);
      // A game call: the table may answer by path, and the name the loader surface asked for is
      // the last member of that path, so `world.moveRequest` is answered by `moveRequest`.
      const member = String(name).split('.').pop();
      if (Object.prototype.hasOwnProperty.call(table, member)) return Promise.resolve(table[member]);
      return Promise.reject(new Error('no member ' + member + ' at ' + name));
    }
  };
  const loader = surface.createLoaderSurface(bridge.call, function () {});
  return {
    calls: calls,
    set: function (name, value) { table[name] = value; },
    count: function (name) {
      return calls.filter(function (one) { return one.name === name; }).length;
    },
    payload: function (name) {
      const found = calls.filter(function (one) { return one.name === name; }).pop();
      return found ? found.args : null;
    },
    loaderCall: function (name, args) {
      calls.push({ name: name, args: args || [] });
      if (Object.prototype.hasOwnProperty.call(table, name)) {
        const value = table[name];
        return Promise.resolve(typeof value === 'function' ? value(args) : value);
      }
      return loader.call(name, args || []);
    },
    // One dot-path read, the way features/maid/game-access.js exposes it. The surface\'s own rows
    // for the two target fields are not loader names, so a handler that reads them goes through
    // here rather than through loaderCall.
    read: function (path) {
      calls.push({ name: 'read', args: [path], path: path });
      const member = String(path).split('.').pop();
      if (Object.prototype.hasOwnProperty.call(table, member)) return { value: table[member] };
      return { value: null };
    }
  };
}

function runtime(game, options) {
  const opts = options || {};
  const logs = [];
  const slept = [];
  const made = zones.createZoneHandlers({
    game: game,
    log: function (line) { logs.push(line); },
    sleep: opts.sleep || function (ms) { slept.push(ms); return Promise.resolve(); },
    random: opts.random,
    setTimeout: opts.setTimeout,
    clearTimeout: opts.clearTimeout,
    config: opts.config,
    maid: opts.maid,
    auras: opts.auras
  });
  return { zones: made, logs: logs, slept: slept, game: game };
}

/** One JSON frame the way the relay delivers it: the game's own `{t, b:{o}}` envelope. */
function jsonFrame(payload, direction) {
  return {
    direction: direction || 'toClient',
    data: JSON.stringify({ t: 'xt', b: { r: -1, o: payload } })
  };
}

/**
 * Let a handler's own fire-and-forget chain finish. The injected sleep resolves immediately, so
 * the work is all microtasks plus whatever the chain scheduled; a bounded number of turns of the
 * event loop is enough and, unlike a spin, it lets the runtime breathe (a tight loop over resolved
 * promises starves timers and has OOMed this suite before).
 */
async function settle(made) {
  for (let i = 0; i < SETTLE_TURNS; i++) {
    await new Promise(function (resolve) { setTimeout(resolve, 0); });
  }
  return made;
}

const SETTLE_TURNS = 8;

function controlledTimers() {
  const timers = [];
  return {
    setTimeout: function (fn, ms) {
      const timer = { fn: fn, ms: ms, active: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: function (timer) { timer.active = false; },
    pending: function () { return timers.filter(function (timer) { return timer.active; }); },
    runNext: function () {
      const timer = timers.filter(function (one) { return one.active; })[0];
      assert.ok(timer, 'a cycle wait is scheduled');
      timer.active = false;
      timer.fn();
    }
  };
}

function nextTurn() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

/** An `event` frame with a zone letter, which is the auto-zone trigger. */
function zoneFrame(zone) {
  return jsonFrame({ cmd: 'event', args: { zoneSet: zone } });
}

/** A `ct` frame carrying one animation message, which is the taunt families' trigger. */
function animFrame(msg, tInf) {
  const anim = { msg: msg };
  if (tInf !== undefined) anim.tInf = tInf;
  return jsonFrame({ cmd: 'ct', anims: [anim] });
}

/**
 * An aura frame, in the shape the game's own `aura+` carries it: the payload names the `tInf`
 * and holds the aura rows, which is what bot/auras.js reads (ticket #42).
 */
function auraFrame(name, tInf, isNew) {
  return jsonFrame({
    cmd: 'aura+',
    a: [{ cmd: 'aura+', tInf: tInf, auras: [{ nam: name, val: 1, dur: 30, isNew: isNew === true }] }]
  });
}

// ------------------------------------------------------------------ the set the reference ships

test('the auto-zone combo carries the reference\'s own 15 entries, in its own order', () => {
  assert.deepStrictEqual(zones.NAMES, [
    'Auto Zone - Ultradage',
    'Auto Zone - Dark Carnax',
    'Auto Zone - Astral Empyrean',
    'Auto Zone - Astral Empyrean P1',
    'Auto Zone - Astral Empyrean P2',
    'Auto Zone - Queen Iona',
    'Auto Zone - Colossal Vordred',
    'Gramiel P1',
    'Gramiel P2',
    'Gramiel P3',
    'Gramiel P4',
    'Ultra Speaker DPS',
    'Ultra Speaker LR',
    'Ultra Speaker LOO',
    'Ultra Speaker AP'
  ]);
});

test('the entry list is the reference\'s own designer file, read where the reference is', () => {
  const file = referenceFile('Grimoire/UI/BotManager.Designer.cs');
  if (!file) return; // the reference clone is not on this machine
  const source = fs.readFileSync(file, 'utf8');
  const block = source.slice(source.indexOf('this.cmbSpecials.Items.AddRange'),
    source.indexOf('this.cmbSpecials.Location'));
  const listed = (block.match(/"[^"]+"/g) || []).map(function (one) { return one.slice(1, -1); });
  assert.deepStrictEqual(zones.NAMES, listed,
    'the combo the reference draws is the set this build must carry');
});

test('every handler in every file the reference ships is one this build runs', () => {
  // The families that share one file upstream are the ones easiest to under-deliver: the file
  // named after one handler holds several. Each class in these files is checked by name.
  const shared = {
    'Grimoire/Networking/Handlers/HandlerAutoZoneAstralEmpyreanP1.cs':
      ['HandlerAutoZoneAstralEmpyreanP1', 'HandlerAutoZoneAstralEmpyreanP2'],
    'Grimoire/Networking/Handlers/HandlerUltraGramielTaunt.cs':
      ['HandlerUltraGramielTaunt'],
    'Grimoire/Networking/Handlers/HandlerUltraSpeakerMechanics.cs':
      ['HandlerUltraSpeakerDPS', 'HandlerUltraSpeakerLR', 'HandlerUltraSpeakerLOO',
        'HandlerUltraSpeakerAP']
  };
  Object.keys(shared).forEach(function (relative) {
    const file = referenceFile(relative);
    if (!file) return;
    const source = fs.readFileSync(file, 'utf8');
    const declared = (source.match(/class\s+(Handler\w+)/g) || [])
      .map(function (one) { return one.split(/\s+/)[1]; });
    shared[relative].forEach(function (name) {
      assert.ok(declared.indexOf(name) !== -1,
        name + ' is a class ' + relative + ' declares, so the fixture has gone stale');
      assert.ok(zones.HANDLED[name],
        name + ' is a handler the reference ships and this build does not carry');
      const entry = zones.HANDLED[name];
      assert.ok(zones.NAMES.indexOf(entry.zone) !== -1,
        name + ' must be reachable from the combo, as ' + entry.zone);
      assert.strictEqual(entry.file, path.basename(relative),
        name + ' records the file it came from');
    });
  });
});

test('every class declared in the registered Misc 2 handler files maps to a combo entry', () => {
  const files = [
    'HandlerAutoZoneUltraDage.cs',
    'HandlerAutoZoneDarkCarnax.cs',
    'HandlerAutoZoneAstralEmpyrean.cs',
    'HandlerAutoZoneAstralEmpyreanP1.cs',
    'HandlerAutoZoneQueenIona.cs',
    'HandlerAutoZoneVordred.cs',
    'HandlerUltraGramielTaunt.cs',
    'HandlerUltraSpeakerMechanics.cs'
  ];
  let checked = 0;
  files.forEach(function (basename) {
    const file = referenceFile('Grimoire/Networking/Handlers/' + basename);
    if (!file) return;
    const source = fs.readFileSync(file, 'utf8');
    const declared = (source.match(/class\s+(Handler\w+)/g) || [])
      .map(function (one) { return one.split(/\s+/)[1]; });
    declared.forEach(function (name) {
      const entry = zones.HANDLED[name] || (zones.HANDLED_BASES && zones.HANDLED_BASES[name]);
      assert.ok(entry, name + ' is declared in ' + basename + ' and needs explicit coverage');
      assert.strictEqual(entry.file, basename, name + ' keeps its source file');
      const reachable = entry.entries || [entry.zone].concat(entry.presets || []);
      assert.ok(reachable.length > 0, name + ' must reach at least one Misc 2 entry');
      reachable.forEach(function (zone) {
        assert.ok(zones.NAMES.indexOf(zone) !== -1,
          name + ' reaches a missing Misc 2 entry: ' + zone);
      });
      checked++;
    });
  });
  assert.strictEqual(checked, 14, 'the source files currently declare 14 handler classes including shared bases');
});

test('the single-handler files are carried too, and Champion Drakath is named as the reference has it', () => {
  const files = {
    'HandlerAutoZoneUltraDage': 'Auto Zone - Ultradage',
    'HandlerAutoZoneDarkCarnax': 'Auto Zone - Dark Carnax',
    'HandlerAutoZoneAstralEmpyrean': 'Auto Zone - Astral Empyrean',
    'HandlerAutoZoneQueenIona': 'Auto Zone - Queen Iona',
    'HandlerAutoZoneVordred': 'Auto Zone - Colossal Vordred'
  };
  Object.keys(files).forEach(function (name) {
    assert.ok(zones.HANDLED[name], name + ' is a handler the reference ships');
    assert.strictEqual(zones.HANDLED[name].zone, files[name]);
  });
  // HandlerTaunterChampionDrakath.cs declares the same class name as HandlerAutoZoneUltraDage.cs
  // (the reference's own copy-paste) and is not in the .csproj, so Champion Drakath has no
  // handler of its own: the combo entry that reaches its coordinates is the Ultradage one.
  const declared = fs.existsSync(path.join(__dirname, '..', '..', 'plugins')) &&
    referenceFile('Grimoire/Networking/Handlers/HandlerTaunterChampionDrakath.cs');
  if (declared) {
    const source = fs.readFileSync(declared, 'utf8');
    assert.ok(/class\s+HandlerAutoZoneUltraDage/.test(source),
      'the Champion Drakath file declares the Ultradage class, which is why there is no third file');
  }
  assert.ok(!Object.keys(zones.HANDLED).some(function (name) { return /Drakath/.test(name); }),
    'no invented Champion Drakath handler: the reference has none');
});

// ------------------------------------------------------------------ the coordinates, as data

// The reference's taunt-cycle line and its own two error sentences, checked against `taunt()`
// (MaidRemake.cs:409-462) and against the class the bot command drives (TauntCycle.cs:22-60),
// which is what a `tc;` SpecialMsg means in this build.
test('a tc; line parses with the reference\'s defaults and its own error sentences', () => {
  assert.deepStrictEqual(zones.parseTauntCycle('tc;4;Gramiel;20;3'),
    { ok: true, spec: { cycle: 4, mon: 'Gramiel', second: 20, order: 3 } });
  // Every field after the prefix is optional, and each default is the reference's own.
  assert.deepStrictEqual(zones.parseTauntCycle('tc;3;*'),
    { ok: true, spec: { cycle: 3, mon: '*', second: 12, order: -1 } });
  // An empty monster field keeps the wildcard, which is its own `IsNullOrWhiteSpace` guard.
  assert.deepStrictEqual(zones.parseTauntCycle('tc;2; ;12').spec.mon, '*');
  // The cycle default of 2 is unreachable upstream: the `StartsWith("tc;")` guard means the line
  // always has a second field, and an empty one fails `int.TryParse` before the default is read.
  assert.deepStrictEqual(zones.parseTauntCycle('tc;'),
    { ok: false, error: "Cycle isn't a valid number!", example: 'tc;2;*;12;<order 1-4>(optional)' });
  // The two sentences the reference's dialog shows, verbatim, with the example it offers to write.
  const badCycle = zones.parseTauntCycle('tc;notanumber');
  assert.strictEqual(badCycle.ok, false);
  assert.strictEqual(badCycle.error, "Cycle isn't a valid number!");
  assert.strictEqual(badCycle.example, 'tc;2;*;12;<order 1-4>(optional)');
  const badSeconds = zones.parseTauntCycle('tc;2;*;soon');
  assert.strictEqual(badSeconds.error, "Seconds isn't a valid number!");
  // A line that is not a tc; line at all is not a taunt cycle.
  assert.strictEqual(zones.parseTauntCycle('converge,truth').ok, false);
});

test('a tc; SpecialMsg starts the reference\'s own paced cycle', async () => {
  const timers = controlledTimers();
  const made = maidRuntime({ IsMonsterAvailable: true }, { SpecialMsg: 'tc;2;Gramiel;12;1' }, timers);
  const answer = made.zones.tauntCycle();
  assert.strictEqual(answer.ok, true);
  assert.deepStrictEqual(answer.spec, { cycle: 2, mon: 'Gramiel', second: 12, order: 1 });
  assert.strictEqual(answer.running, true, 'the rotation runs: its two calls are live (#49)');
  assert.strictEqual(answer.step, 6000, 'every second/cycle seconds, which is the reference\'s own');
  await nextTurn();
  assert.strictEqual(timers.pending()[0].ms, 6000, 'the initial order waits one cycle interval');
  timers.runNext();
  await nextTurn();
  // The cycle\'s own body: the first pass forces the taunt, and every pass attacks the monster
  // before stepping the count down (MaidRemake.cs:655-668).
  assert.ok(made.game.count('IsMonsterAvailable') >= 1, 'the loop\'s own while condition is read');
  assert.deepStrictEqual(made.game.payload('AttackMonster'), ['Gramiel']);
  assert.deepStrictEqual(made.game.payload('UseSkill'), ['5'],
    'skill 5, which is the index the cycle hard-codes');
  assert.strictEqual(timers.pending()[0].ms, 6000, 'and the pace is the reference\'s own second/cycle');
  made.zones.stopCycle(answer.key);
  assert.strictEqual(timers.pending().length, 0, 'stopping clears the pending timer');
  // A line that is not one is refused with the parse\'s own words rather than started.
  const plain = maidRuntime({}, { SpecialMsg: 'sun converges' });
  assert.strictEqual(plain.zones.tauntCycle().ok, false);
});

test('a tc; cycle stops when the monster is gone, and on its own ask', async () => {
  // The reference\'s own while condition: World.IsMonsterAvailable(mon) failing ends the loop.
  const goneTimers = controlledTimers();
  const gone = maidRuntime({ IsMonsterAvailable: false }, { SpecialMsg: 'tc;2;Gramiel;12' }, goneTimers);
  gone.zones.tauntCycle();
  await nextTurn();
  assert.strictEqual(gone.game.count('AttackMonster'), 0, 'nothing to attack means nothing is attacked');
  assert.ok(gone.game.count('IsMonsterAvailable') >= 1);
  assert.strictEqual(goneTimers.pending().length, 0, 'a disappeared monster leaves no wait timer');

  const timers = controlledTimers();
  const made = maidRuntime({ IsMonsterAvailable: true }, { SpecialMsg: 'tc;2;Gramiel;12' }, timers);
  const started = made.zones.tauntCycle();
  const stopped = made.zones.stopCycle(started.key);
  assert.strictEqual(stopped.ok, true);
  await nextTurn();
  const after = made.game.count('AttackMonster');
  await nextTurn();
  assert.strictEqual(made.game.count('AttackMonster'), after,
    'a stopped cycle makes no further passes');
  assert.strictEqual(timers.pending().length, 0, 'cancellation leaves no timer behind');
  assert.strictEqual(made.zones.stopCycle(started.key).ok, false,
    'and stopping one that is not running says so rather than reporting a stop');
});

test('a disappeared monster releases the cycle key for the next encounter', async () => {
  const timers = controlledTimers();
  const made = maidRuntime({ IsMonsterAvailable: false }, { SpecialMsg: 'tc;2;Gramiel;12' }, timers);
  const first = made.zones.tauntCycle('encounter');
  assert.strictEqual(first.ok, true);
  await nextTurn();
  assert.strictEqual(timers.pending().length, 0);

  made.game.set('IsMonsterAvailable', true);
  const next = made.zones.tauntCycle('encounter');
  assert.strictEqual(next.ok, true, 'the next encounter can start under the same key');
  await nextTurn();
  assert.strictEqual(made.game.count('AttackMonster'), 1);
  made.zones.stopCycle('encounter');
  assert.strictEqual(timers.pending().length, 0);
});

test('a cycle timer error releases its key for a later start', async () => {
  const made = maidRuntime({ IsMonsterAvailable: true }, { SpecialMsg: 'tc;2;Gramiel;12' }, {
    setTimeout: function () { throw new Error('timer unavailable'); },
    clearTimeout: function () {}
  });
  assert.strictEqual(made.zones.tauntCycle('timer-error').ok, true);
  await nextTurn();
  assert.ok(made.logs.some(function (line) { return line.indexOf('timer unavailable') !== -1; }));
  assert.strictEqual(made.zones.tauntCycle('timer-error').ok, true,
    'an error cannot strand the rotation key');
  made.zones.stopCycle('timer-error');
});

test('an omitted taunt order uses this character\'s position in PlayersInMap', async () => {
  const timers = controlledTimers();
  const made = maidRuntime({
    IsMonsterAvailable: true,
    PlayersInMap: ['leader', 'PeArL', 'third'],
    strUsername: 'pearl'
  }, { SpecialMsg: 'tc;2;*;12' }, timers);
  const started = made.zones.tauntCycle();
  assert.strictEqual(started.ok, true);
  await nextTurn();
  assert.strictEqual(made.game.count('PlayersInMap'), 1);
  assert.deepStrictEqual(made.game.calls.filter(function (one) { return one.name === 'read'; })
    .map(function (one) { return one.args[0]; }), ['world.myAvatar.objData.strUsername']);
  assert.strictEqual(made.game.count('AttackMonster'), 0,
    'the second party member waits one cycle interval before their first taunt');
  timers.runNext();
  await nextTurn();
  assert.strictEqual(made.game.count('AttackMonster'), 1);
  made.zones.stopCycle(started.key);

  const explicitTimers = controlledTimers();
  const explicit = maidRuntime({
    IsMonsterAvailable: true, PlayersInMap: ['leader', 'pearl'], strUsername: 'pearl'
  }, { SpecialMsg: 'tc;2;*;12;1' }, explicitTimers);
  const ordered = explicit.zones.tauntCycle();
  assert.strictEqual(ordered.spec.order, 1);
  await nextTurn();
  assert.strictEqual(explicit.game.count('PlayersInMap'), 0,
    'an explicit order avoids the party-position lookup');
  assert.strictEqual(explicit.game.calls.filter(function (one) { return one.name === 'read'; }).length, 0);
  assert.strictEqual(explicit.game.count('AttackMonster'), 0);
  explicitTimers.runNext();
  await nextTurn();
  assert.strictEqual(explicit.game.count('AttackMonster'), 1);
  explicit.zones.stopCycle(ordered.key);
});

test('a tc; cycle continues past 120 passes and cancellation clears its timer', async () => {
  const timers = controlledTimers();
  const made = maidRuntime({ IsMonsterAvailable: true }, {}, timers);
  const started = made.zones.startTaunt(1, 'Gramiel', 1, 0);
  assert.strictEqual(started.step, 1000);
  await nextTurn();
  for (let pass = 0; pass < 121; pass++) {
    timers.runNext();
    await nextTurn();
  }
  const stopped = made.zones.stopTaunt();
  assert.ok(stopped.passes > 120, 'the reference has no pass-count cutoff');
  assert.strictEqual(timers.pending().length, 0, 'cancellation removes the only pending handle');
  const attacks = made.game.count('AttackMonster');
  await nextTurn();
  assert.strictEqual(made.game.count('AttackMonster'), attacks, 'a cancelled run cannot restart itself');
});

test('picking a mode writes the priority list, the phrase list and the skill it forces', () => {
  // cmbUltraBoss_SelectedIndexChanged (:1269-1320), read as data so the selection and the handler
  // cannot drift apart. Every key it writes is one the config file already carries.
  const config = require('../../plugins/grimlite-parity/features/maid/config.js');
  assert.strictEqual(zones.MODE_FILLS.None, undefined, 'None writes nothing, which is its own branch');
  assert.strictEqual(zones.MODE_FILLS['Auto Potion'], undefined, 'and so does Auto Potion');
  const keys = ['AttackPriorityMonster', 'AttackPriority', 'SpecialMsg', 'SpecialAct'];
  Object.keys(zones.MODE_FILLS).forEach(function (mode) {
    assert.ok(zones.MODES.indexOf(mode) !== -1, mode + ' is a mode cmbUltraBoss carries');
    const written = zones.MODE_FILLS[mode];
    Object.keys(written).forEach(function (key) {
      assert.ok(keys.indexOf(key) !== -1, mode + ' writes ' + key + ', which the form does not own');
      assert.ok(config.FIELDS.indexOf(key) !== -1,
        mode + ' writes ' + key + ', which is not a config file field');
    });
  });
  assert.deepStrictEqual(zones.MODE_FILLS['Gramiel L1'],
    { AttackPriority: true, AttackPriorityMonster: 'id.2,crystal', SpecialMsg: 'shattering', SpecialAct: 5 });
  assert.deepStrictEqual(zones.MODE_FILLS['Gramiel R2'],
    { AttackPriority: true, AttackPriorityMonster: 'id.3,crystal', SpecialMsg: 'shattering', SpecialAct: 5 });
  assert.strictEqual(zones.MODE_FILLS['Asc.Solstice P1'].SpecialMsg, 'sun converges');
  assert.strictEqual(zones.MODE_FILLS['Asc.Midnight P1'].SpecialMsg, 'moon converges');
  assert.strictEqual(zones.MODE_FILLS['Ast.Empyrean P1'].SpecialMsg, 'behold our starfire');
});

test('Auto Potion uses the first equipped potion with stock and its matching self aura', async () => {
  const store = require('../../plugins/grimlite-parity/bot/auras.js').createAuraStore();
  const items = [
    { sName: 'Potent Malice', bEquip: 0, iQty: 3 },
    { sName: 'Felicitous Philtre', bEquip: 1, iQty: 0 },
    { sName: 'Potent Honor', bEquip: 1, iQty: 2 }
  ];
  const game = fakeGame({ UserID: 7, GetInventoryItems: items });
  const made = runtime(game, {
    auras: store,
    config: function () { return { UltraBossExtra: zones.MODES.indexOf('Auto Potion') }; }
  });
  assert.strictEqual(await made.zones.autoPotionNeeded(), true,
    'the equipped, stocked Potent potion needs its shared self aura');
  assert.strictEqual(game.count('GetInventoryItems'), 1);

  store.observe(auraFrame('Potent Honor Malice', 'p:7', true));
  assert.strictEqual(await made.zones.autoPotionNeeded(), false,
    'the matching self aura suppresses another skill-5 cast');

  items.unshift({ sName: 'Felicitous Philtre', bEquip: 1, iQty: 1 });
  assert.strictEqual(await made.zones.autoPotionNeeded(), true,
    'the first qualifying item decides which aura is checked');

  const disabled = runtime(game, { config: function () { return { UltraBossExtra: 0 }; } });
  assert.strictEqual(await disabled.zones.autoPotionNeeded(), false,
    'other Maid modes do not query Auto Potion state');
  assert.strictEqual(zones.MODES.indexOf('Auto Potion'), 1,
    'Auto Potion remains selectable in the user-facing mode list');
});

test('every coordinate table is the reference\'s own values', () => {
  const ud = zones.SPECS['Auto Zone - Ultradage'];
  assert.deepStrictEqual(ud.zones, { A: ['107', '400'], B: ['843', '400'], other: ['503', '276'] });
  const dc = zones.SPECS['Auto Zone - Dark Carnax'];
  assert.deepStrictEqual(dc.zones, { A: ['860', '400'], B: ['49', '400'], other: ['426', '372'] });
  const ae = zones.SPECS['Auto Zone - Astral Empyrean'];
  assert.deepStrictEqual(ae.zones, { A: ['708', '447'], B: ['287', '191'], other: ['461', '329'] });
  const vo = zones.SPECS['Auto Zone - Colossal Vordred'];
  assert.deepStrictEqual(vo.zones, { A: ['731', '461'], B: ['700', '321'], other: ['748', '372'] });
  const io = zones.SPECS['Auto Zone - Queen Iona'];
  assert.strictEqual(io.delayMs, 500, 'Queen Iona waits half a second before it reads auras');
  assert.deepStrictEqual(io.zones, {
    A: { positive: ['679', '339'], negative: ['272', '379'] },
    B: { positive: ['272', '379'], negative: ['679', '339'] },
    other: ['490', '320']
  });
  assert.deepStrictEqual(io.auras.positive, ['Positive Charge', 'Negative Charge?']);
  assert.deepStrictEqual(io.auras.negative, ['Negative Charge', 'Positive Charge?']);
  // The two Astral Empyrean presets differ in one bit and share one file upstream.
  assert.deepStrictEqual(zones.SPECS['Auto Zone - Astral Empyrean P1'].zones,
    zones.SPECS['Auto Zone - Astral Empyrean'].zones);
  assert.strictEqual(zones.SPECS['Auto Zone - Astral Empyrean P1'].phrase, 'behold our starfire');
  assert.strictEqual(zones.SPECS['Auto Zone - Astral Empyrean P1'].monster, 'Astral Empyrean');
  assert.strictEqual(zones.SPECS['Auto Zone - Astral Empyrean P1'].skill, '5');
  assert.strictEqual(zones.SPECS['Auto Zone - Astral Empyrean P1'].parity, 'odd');
  assert.strictEqual(zones.SPECS['Auto Zone - Astral Empyrean P2'].parity, 'even');
});

test('the Gramiel presets carry the crystal ids, sides and parity the reference hard-codes', () => {
  assert.strictEqual(zones.SPECS['Gramiel P1'].monId, '2');
  assert.strictEqual(zones.SPECS['Gramiel P2'].monId, '2');
  assert.strictEqual(zones.SPECS['Gramiel P3'].monId, '3');
  assert.strictEqual(zones.SPECS['Gramiel P4'].monId, '3');
  assert.strictEqual(zones.SPECS['Gramiel P1'].parity, 'odd');
  assert.strictEqual(zones.SPECS['Gramiel P2'].parity, 'even');
  assert.strictEqual(zones.SPECS['Gramiel P3'].parity, 'odd');
  assert.strictEqual(zones.SPECS['Gramiel P4'].parity, 'even');
  ['Gramiel P1', 'Gramiel P2', 'Gramiel P3', 'Gramiel P4'].forEach(function (name) {
    assert.strictEqual(zones.SPECS[name].phrase, 'defense shattering');
    assert.strictEqual(zones.SPECS[name].skill, '5');
    assert.strictEqual(zones.SPECS[name].monster, 'Gramiel');
    assert.strictEqual(zones.SPECS[name].grace, 'Grace Crystal');
    assert.strictEqual(zones.SPECS[name].aura, 'Vendetta');
  });
});

test('the Speaker rotation is the reference\'s own 15 rows, verbatim', () => {
  const table = zones.SPECS['Ultra Speaker DPS'].rotation;
  assert.deepStrictEqual(table, [
    { taunt: 'LR', zone: null, type: null, delay: 0 },
    { taunt: 'LOO', zone: 'DPS', type: 'IN', delay: 0 },
    { taunt: 'AP', zone: 'DPS', type: 'OUT', delay: 0 },
    { taunt: 'LOO', zone: null, type: null, delay: 100 },
    { taunt: null, zone: 'LR', type: 'IN', delay: 0 },
    { taunt: 'LR', zone: 'LR', type: 'OUT', delay: 100 },
    { taunt: null, zone: null, type: null, delay: 0 },
    { taunt: 'LOO', zone: null, type: null, delay: 100 },
    { taunt: null, zone: 'AP', type: 'IN', delay: 0 },
    { taunt: 'AP', zone: 'AP', type: 'OUT', delay: 0 },
    { taunt: 'LR', zone: null, type: null, delay: 100 },
    { taunt: null, zone: 'LOO', type: 'IN', delay: 0 },
    { taunt: 'LOO', zone: 'LOO', type: 'OUT', delay: 100 },
    { taunt: null, zone: null, type: null, delay: 0 },
    { taunt: 'LR', zone: null, type: null, delay: 0 }
  ]);
  ['Ultra Speaker DPS', 'Ultra Speaker LR', 'Ultra Speaker LOO', 'Ultra Speaker AP'].forEach(function (name) {
    assert.strictEqual(zones.SPECS[name].cell, 'Boss');
    assert.deepStrictEqual(zones.SPECS[name].start, ['100', '321']);
    assert.deepStrictEqual(zones.SPECS[name].zoneAt, ['203', '301']);
    assert.deepStrictEqual(zones.SPECS[name].phrases, ['truth', 'listen']);
  });
  assert.deepStrictEqual(zones.SPECS['Ultra Speaker AP'].heal, { skill: '2', roles: ['AP', 'LOO'] });
  assert.deepStrictEqual(zones.SPECS['Ultra Speaker LR'].heal, { skill: '3', roles: ['LR'] });
});

// ------------------------------------------------------------------ the trigger: live frames

test('an Ultradage zone frame walks the party where the reference walks it', async () => {
  const game = fakeGame({});
  const made = runtime(game);
  made.zones.setActive('Auto Zone - Ultradage');
  const answered = await made.zones.handleFrame(zoneFrame('A'));
  assert.strictEqual(answered && answered.zone, 'Auto Zone - Ultradage');
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['107', '400']);
  await made.zones.handleFrame(zoneFrame('B'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['843', '400']);
  await made.zones.handleFrame(zoneFrame('Z'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['503', '276'],
    'any other letter is the reference\'s own default branch');
});

test('a frame that is not the active handler\'s trigger moves nobody', async () => {
  const game = fakeGame({});
  const made = runtime(game);
  assert.strictEqual(await made.zones.handleFrame(zoneFrame('A')), null,
    'nothing is registered until a handler is started');
  made.zones.setActive('Auto Zone - Ultradage');
  // The next clause is the false case; a frame with no handler at all is answered here too.
  assert.strictEqual(await made.zones.handleFrame(animFrame('behold our starfire')), null);
  assert.strictEqual(await made.zones.handleFrame({ direction: 'toServer', data: '{"t":"xt"}' }), null,
    'the client\'s own frames are not the server\'s');
  assert.strictEqual(game.count('WalkToPoint'), 0);
});

test('an auto-zone event and Maid animation handlers both process the same frame', async () => {
  const made = maidRuntime({}, {
    AntiCounter: true, UltraBossExtra: 0, SpecialMsg: 'flare', SpecialAct: 4
  });
  made.zones.setActive('Auto Zone - Ultradage');
  const answer = await made.zones.handleFrame(jsonFrame({
    cmd: 'event', args: { zoneSet: 'A' },
    anims: [{ msg: 'flare' }, { msg: 'the boss prepares a counter attack' }]
  }));
  assert.ok(made.game.payload('WalkToPoint'), 'the selected auto-zone handler still walks');
  assert.deepStrictEqual(made.maid.armed, ['4'], 'the Maid animation listener still arms its skill');
  assert.deepStrictEqual(made.slept, [1500, 6000], 'AntiCounter sees the warning in the same frame');
  assert.ok(Array.isArray(answer), 'the frame result retains both successful handlers');
  assert.ok(answer.some(function (one) { return one && one.zone === 'Auto Zone - Ultradage'; }));
  assert.ok(answer.some(function (one) { return one && one.arm === '4'; }));
});

test('each family fires on its own HandledCommands, which is the packet event it registers for', async () => {
  // The plain walkers answer `event` only, so a ct frame moves nobody.
  const walker = runtime(fakeGame({}));
  walker.zones.setActive('Auto Zone - Colossal Vordred');
  await walker.zones.handleFrame(animFrame('anything at all'));
  assert.strictEqual(walker.game.count('WalkToPoint'), 0, 'a walker is not a ct handler');
  await walker.zones.handleFrame(zoneFrame('A'));
  assert.deepStrictEqual(walker.game.payload('WalkToPoint'), ['731', '461']);

  // The Gramiel presets answer `ct` only: an event frame is not theirs.
  const gramiel = runtime(tauntableGame());
  gramiel.zones.setActive('Gramiel P1');
  assert.strictEqual(await gramiel.zones.handleFrame(zoneFrame('A')), null,
    'a zone frame is not a ct handler\'s trigger');
  assert.strictEqual(gramiel.game.count('IsMonsterAvailable'), 0);

  // The two Astral Empyrean presets answer BOTH, which is the file's own declaration.
  const astral = runtime(tauntableGame());
  astral.zones.setActive('Auto Zone - Astral Empyrean P1');
  await astral.zones.handleFrame(zoneFrame('B'));
  assert.deepStrictEqual(astral.game.payload('WalkToPoint'), ['287', '191']);
  const starfire = await astral.zones.handleFrame(animFrame('behold our starfire'));
  assert.strictEqual(starfire.acted, true, 'and the same instance answers ct');

  // A Speaker role answers `ct` on the two phrases, not on any other message.
  const speaker = runtime(fakeGame({ UserID: 7 }));
  speaker.zones.setActive('Ultra Speaker DPS');
  assert.strictEqual(await speaker.zones.handleFrame(animFrame('nothing of the sort')), null);
});

test('the Queen Iona handler reads the charge auras after its own half second', async () => {
  const game = fakeGame({ UserID: 7 });
  const made = runtime(game);
  made.zones.setActive('Auto Zone - Queen Iona');
  await made.zones.handleFrame(zoneFrame('A'));
  assert.strictEqual(made.slept[0], 500, 'the reference waits 500 ms before it reads auras');
  assert.strictEqual(game.count('WalkToPoint'), 0, 'with no charge there is nothing to do');

  made.zones.handleFrame(auraFrame('Positive Charge', 'p:7', true));
  await made.zones.handleFrame(zoneFrame('A'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['679', '339']);
  await made.zones.handleFrame(zoneFrame('B'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['272', '379'],
    'the same charge walks to the other pad when the zone flips');

  // The reversed name counts as the opposite charge, which is the reference's own two reads.
  const other = runtime(fakeGame({ UserID: 7 }));
  other.zones.setActive('Auto Zone - Queen Iona');
  other.zones.handleFrame(auraFrame('Negative Charge?', 'p:7', true));
  await other.zones.handleFrame(zoneFrame('A'));
  assert.deepStrictEqual(other.game.payload('WalkToPoint'), ['679', '339']);

  const plain = runtime(fakeGame({ UserID: 7 }));
  plain.zones.setActive('Auto Zone - Queen Iona');
  plain.zones.handleFrame(auraFrame('Positive Charge?', 'p:7', true));
  await plain.zones.handleFrame(zoneFrame('Z'));
  assert.deepStrictEqual(plain.game.payload('WalkToPoint'), ['490', '320'],
    'the default zone walks its own point whatever the charge');
});

// ------------------------------------------------------------------ the two taunt families

/**
 * A game whose monster reads answer, so a taunt family gets past its availability checks. The
 * answers are keyed by LOADER NAME (`IsLoggedIn`, `Map`), which is the name a handler asks for and
 * the name the surface would resolve; a keyed answer stands in for whatever path the row reads.
 */
function tauntableGame(extra) {
  return fakeGame(Object.assign({
    UserID: 7,
    IsMonsterAvailable: true,
    IsLoggedIn: true,
    Map: 'yulgar',
    // The six calls #49 moved onto the movie's side of the JSON boundary are answered here the way
    // the real surface answers them: `raw` dispatches by callback NAME, so the fake answers by the
    // same name and the handler\'s own path is what is exercised.
    AttackMonster: true,
    AttackMonsterByMonMapId: true,
    UseSkill: true,
    ForceUseSkill: true,
    SkillAvailable: 0
  }, extra || {}));
}

test('the taunt runs the reference\'s own three attempts, and stops the moment Focus lands', async () => {
  // HandlerUltraGramielTaunt.cs:150-172 and HandlerAutoZoneAstralEmpyreanP1.cs:137-160 are the same
  // loop: attack first, then up to three passes of (Focus? stop : SkillAvailable, ForceUseSkill,
  // 500 ms, UseSkill, 300 ms). The end-to-end version of it lives in #49, so what this pins is the
  // bound and the order rather than a refusal that no longer exists.
  const game = tauntableGame();
  const made = runtime(game);
  made.zones.setActive('Gramiel P1');
  const first = await made.zones.handleFrame(animFrame('defense shattering', 'id:2'));
  assert.strictEqual(first.acted, true, 'the first shattering is P1\'s own turn');
  assert.deepStrictEqual(first.refused, [], 'and every call it makes is one the bridge answers');
  // The orb is up in this fixture, so the taunt attacked the crystal and cast at it three times.
  assert.deepStrictEqual(game.payload('AttackMonsterByMonMapId'), ['2'],
    'the crystal is attacked by the reference\'s own id.<n> spelling');
  assert.strictEqual(game.count('ForceUseSkill'), zones.TAUNT_ATTEMPTS,
    'one forced cast per attempt, up to the reference\'s own three');
  assert.strictEqual(game.count('UseSkill'), zones.TAUNT_ATTEMPTS,
    'and one plain cast each time, in the reference\'s own order');
  assert.ok(made.slept.indexOf(500) !== -1, 'the 500 ms between the forced and the plain cast');
  assert.ok(made.slept.indexOf(300) !== -1, 'and the 300 ms before re-reading Focus');
  // The casts really are the reference's own two, in its own order: force, then plain.
  const casts = game.calls.filter(function (one) {
    return one.name === 'ForceUseSkill' || one.name === 'UseSkill';
  }).map(function (one) { return one.name; });
  assert.deepStrictEqual(casts.slice(0, 2), ['ForceUseSkill', 'UseSkill']);
  assert.deepStrictEqual(game.payload('ForceUseSkill'), ['5'],
    'skill 5, the index the two taunt files hard-code');
});

test('a target that already carries Focus stops the taunt before a single cast', async () => {
  // The reference reads Focus inside the loop and breaks on the first pass that finds it, which is
  // what stops a second preset from re-taunting a boss the party has already turned.
  const game = tauntableGame();
  // The aura frame below is keyed by `m:2`, so the character\'s own target has to be that crystal
  // for the read to land on it - which is the state the attack at the top of the loop leaves.
  game.set('MonMapID', '2');
  const made = runtime(game);
  made.zones.setActive('Gramiel P1');
  // The aura arrives off the tap before the shattering frame does (#42's store).
  made.zones.handleFrame(auraFrame('Focus', 'm:2', true));
  const answer = await made.zones.handleFrame(animFrame('defense shattering', 'id:2'));
  assert.ok(answer && answer.acted === true, 'the attack is still made: it comes before the read');
  assert.deepStrictEqual(game.payload('AttackMonsterByMonMapId'), ['2']);
  assert.strictEqual(game.count('UseSkill'), 0, 'but Focus means nothing is cast');
  assert.strictEqual(game.count('ForceUseSkill'), 0);
});

test('a Gramiel preset attacks its own crystal on its own parity, and the other side never fires', async () => {
  const game = tauntableGame();
  const made = runtime(game);
  made.zones.setActive('Gramiel P1');
  // P1 is the left-side odd preset: the first shattering on crystal 2 is its turn. The attack is
  // made whatever the cast does after it, so `ok` is false only because the taunt's own cast is
  // refused - which is exactly what the answer says.
  const first = await made.zones.handleFrame(animFrame('defense shattering', 'id:2'));
  assert.ok(first && first.acted === true, 'the first shattering is P1\'s own turn');
  assert.deepStrictEqual(first.refused, [],
    'every call this taunt makes is one the bridge answers (#49 lifted the six casts)');
  assert.deepStrictEqual(game.payload('AttackMonsterByMonMapId'), ['2'],
    'the crystal is attacked by the reference\'s own id.<n> spelling');
  // The second is P2\'s, so P1 stands down...
  const second = await made.zones.handleFrame(animFrame('defense shattering', 'id:2'));
  assert.strictEqual(second.acted, false, 'the even count belongs to the other instance');
  assert.strictEqual(game.count('AttackMonsterByMonMapId'), 1);
  // ...and the other crystal is never this preset\'s business at all.
  await made.zones.handleFrame(animFrame('defense shattering', 'id:3'));
  assert.strictEqual(game.count('AttackMonsterByMonMapId'), 1,
    'P1 is the left preset and crystal 3 is the right one');
  assert.deepStrictEqual(made.zones.counters().crystal, 2, 'only its own side counts');
});

test('a Gramiel preset prefers its orb, then Gramiel with no Grace Crystal and no Vendetta', async () => {
  // The orb is gone, Grace Crystal is up: nothing to do.
  const grace = fakeGame({
    UserID: 7,
    IsMonsterAvailable: function (args) { return args[0] !== 'id:3'; }
  });
  const waiting = runtime(grace);
  waiting.zones.setActive('Gramiel P3');
  const held = await waiting.zones.handleFrame(animFrame('defense shattering', 'id:3'));
  assert.strictEqual(held.acted, false);
  assert.strictEqual(grace.count('AttackMonster'), 0, 'a Grace Crystal means stay off Gramiel');

  // Grace gone, this character has no Vendetta: Gramiel is the target.
  const open = fakeGame({
    UserID: 7,
    IsMonsterAvailable: function (args) { return args[0] === 'Gramiel'; }
  });
  const going = runtime(open);
  going.zones.setActive('Gramiel P3');
  await going.zones.handleFrame(animFrame('defense shattering', 'id:3'));
  assert.deepStrictEqual(open.payload('AttackMonster'), ['Gramiel']);

  // Vendetta up: he is left alone.
  const done = fakeGame({
    UserID: 7,
    IsMonsterAvailable: function (args) { return args[0] === 'Gramiel'; }
  });
  const finished = runtime(done);
  finished.zones.setActive('Gramiel P3');
  finished.zones.handleFrame(auraFrame('Vendetta', 'p:7', true));
  await finished.zones.handleFrame(animFrame('defense shattering', 'id:3'));
  assert.strictEqual(done.count('AttackMonster'), 0, 'Vendetta on this character ends the taunt');
});

test('the two Astral Empyrean presets alternate on one shared starfire counter', async () => {
  const game = tauntableGame();
  const made = runtime(game);
  made.zones.setActive('Auto Zone - Astral Empyrean P1');
  const odd = await made.zones.handleFrame(animFrame('Behold our starfire!'));
  assert.strictEqual(odd.acted, true,
    'the first starfire is P1\'s own turn, whatever the message\'s case');
  assert.deepStrictEqual(game.payload('AttackMonster'), ['Astral Empyrean']);
  const even = await made.zones.handleFrame(animFrame('behold our starfire'));
  assert.strictEqual(even.acted, false);
  assert.deepStrictEqual(made.zones.counters().starfire, 2,
    'one counter, shared, incremented whoever reads it');

  // The other instance acts on the even counts of the same counter, which is what the shared
  // static upstream means.
  const other = runtime(tauntableGame());
  other.zones.setActive('Auto Zone - Astral Empyrean P2');
  other.zones.handleFrame(animFrame('behold our starfire'));
  const second = await other.zones.handleFrame(animFrame('behold our starfire'));
  assert.strictEqual(second.acted, true, 'the second starfire is P2\'s');
  assert.deepStrictEqual(other.game.payload('AttackMonster'), ['Astral Empyrean']);
});

test('the two Astral Empyrean presets walk the same three points the plain handler does', async () => {
  const game = fakeGame({});
  const made = runtime(game);
  made.zones.setActive('Auto Zone - Astral Empyrean P2');
  await made.zones.handleFrame(zoneFrame('A'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['708', '447']);
  await made.zones.handleFrame(zoneFrame('B'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['287', '191']);
  await made.zones.handleFrame(zoneFrame('other'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['461', '329']);
});

test('the Ultra Speaker rotation is walked by the role each row names', async () => {
  const game = fakeGame({ UserID: 7 });
  const made = runtime(game);
  made.zones.setActive('Ultra Speaker AP');
  // AP's own rows are the table's 8 (`zone: AP`, IN) and 9 (`taunt: AP, zone: AP`, OUT): the
  // ninth frame is AP's IN, and the tenth its OUT - the frames before those move nobody.
  const frames = [];
  for (let i = 0; i < 9; i++) frames.push(await made.zones.handleFrame(animFrame('truth')));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['203', '301'],
    'row 8 is AP\'s own IN, which walks it to the reference\'s zone point');
  assert.strictEqual(made.zones.counters().inZone, true);

  const tenth = await made.zones.handleFrame(animFrame('truth'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['100', '321'],
    'row 9 is AP\'s own OUT, which walks it back to the reference\'s start point');
  assert.deepStrictEqual(tenth.row, { taunt: 'AP', zone: 'AP', type: 'OUT', delay: 0 });
  assert.ok(game.count('UseSkill') >= 3, 'AP fires skill 2 three times on its own OUT row');
  assert.ok(made.slept.indexOf(300) !== -1, 'after the reference\'s own 300 ms');

  // The DPS's own rows are 1 (`zone: DPS`, IN) and 2 (`taunt: AP, zone: DPS`, OUT): AP answers
  // row 2 with the skill-2 triple alone - its zone rule is gated on the role the row names.
  const dpsRow = runtime(fakeGame({ UserID: 7 }));
  dpsRow.zones.setActive('Ultra Speaker AP');
  await dpsRow.zones.handleFrame(animFrame('truth'));
  await dpsRow.zones.handleFrame(animFrame('truth'));
  assert.strictEqual(dpsRow.zones.counters().inZone, false,
    'a DPS zone row does not move AP\'s own zone flag');
  await dpsRow.zones.handleFrame(animFrame('truth'));
  assert.strictEqual(dpsRow.game.count('WalkToPoint'), 0, 'and it does not walk AP either');
  // The zone rule's skill-2 triple, plus the row's own taunt: `taunt: 'AP'`, so skill 5 is
  // spammed on top of it - which is what upstream's two separate `step.zoneType == "OUT" &&
  // _role == AP` and `skillRole == _role` tests mean. The spam is the reference's own bound of
  // fifty pairs (HandlerUltraSpeakerMechanics.cs:330-375), one UseSkill each side of a 30 ms wait.
  assert.strictEqual(dpsRow.game.count('UseSkill'), 3 + zones.SPEAKER_TAUNT_PAIRS * 2,
    'the skill-2 triple and the row\'s own fifty-pair taunt');
  assert.ok(dpsRow.slept.indexOf(30) !== -1, 'the taunt pair\'s own 30 ms');
});

test('the Ultra Speaker counter wraps where the reference wraps it, on the same row', async () => {
  const game = fakeGame({ UserID: 7 });
  const made = runtime(game);
  made.zones.setActive('Ultra Speaker LR');
  for (let i = 0; i < 16; i++) await made.zones.handleFrame(animFrame('truth'));
  assert.strictEqual(made.zones.counters().speaker, 1,
    'index 15 wraps the counter back to 1, which is the reference\'s own case');
  // The wrap row (:305-308) is row 1's shape with the reference's *own* 100 ms delay. It zones
  // the DPS in and taunts for LOO, neither of which is this role; LR only fires its own skill 1s,
  // two per truth or listen, on every one of the 16 frames.
  // 32 from those two-per-frame skill 1s, plus the four skill-5 taunts its own rows fire (rows 0,
  // 5, 10 and 14), each of which is the reference's own fifty-pair spam.
  assert.strictEqual(game.count('UseSkill'), 32 + 4 * zones.SPEAKER_TAUNT_PAIRS * 2,
    'LR fires skill 1 twice per frame, plus skill 5 on the four rows it taunts');
  assert.ok(made.slept.indexOf(100) !== -1, 'the wrap row\'s own 100 ms, not row 1\'s 0');
});

test('switching Misc 2 entries gives each handler its own rotation and zone state', async () => {
  const made = runtime(fakeGame({ UserID: 7 }));
  made.zones.setActive('Ultra Speaker DPS');
  await made.zones.handleFrame(animFrame('truth'));
  await made.zones.handleFrame(animFrame('truth'));
  assert.strictEqual(made.zones.counters().speaker, 1);
  assert.strictEqual(made.zones.counters().inZone, true);

  made.zones.setActive('Ultra Speaker AP');
  assert.strictEqual(made.zones.counters().speaker, -1,
    'the newly constructed role handler starts at its own counter -1');
  assert.strictEqual(made.zones.counters().inZone, false,
    'and its own zone flag starts outside');
  await made.zones.handleFrame(animFrame('truth'));
  assert.deepStrictEqual(made.zones.counters().speaker, 0,
    'the first frame after selection is row zero for the new handler');

  made.zones.setActive('Gramiel P1');
  assert.strictEqual(made.zones.counters().crystal, 0,
    'a fresh Gramiel preset starts its per-instance shatter parity over');
});

test('a truth or listen frame is taken by the role the row names, and only then', async () => {
  const game = fakeGame({ UserID: 7 });
  const made = runtime(game);
  made.zones.setActive('Ultra Speaker DPS');
  // Row 0 is the LR taunt, so this frame is not the DPS's: nothing moves and nothing is cast.
  await made.zones.handleFrame(animFrame('truth'));
  assert.strictEqual(game.count('WalkToPoint'), 0, 'row 0 names LR, not the DPS');
  await made.zones.handleFrame(animFrame('listen carefully'));
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['203', '301'],
    'row 1 is DPS\'s own IN on the DPS zone, which walks it to the reference\'s zone point');
  assert.strictEqual(made.zones.counters().inZone, true);
  await made.zones.handleFrame(animFrame('something else entirely'));
  assert.strictEqual(game.count('WalkToPoint'), 1,
    'a frame with neither phrase is not this handler\'s trigger at all');
});

test('the Speaker scheduler acquires an untargeted monster and heals by role below 70 percent', async () => {
  const cases = [
    { role: 'Ultra Speaker DPS', heal: null },
    { role: 'Ultra Speaker LR', heal: '3' },
    { role: 'Ultra Speaker LOO', heal: '2' },
    { role: 'Ultra Speaker AP', heal: '2' }
  ];
  for (let i = 0; i < cases.length; i++) {
    const game = fakeGame({
      IsLoggedIn: true,
      Health: 100,
      Map: 'ultraspeaker',
      Cell: 'Boss',
      Position: ['100', '321'],
      IsMonsterAvailable: true,
      HasTarget: false,
      PlayersInMap: ['injured'],
      GetPlayerHealthPercentage: function (args) { return args[0] === 'injured' ? 69 : 100; },
      AttackMonster: true,
      UseSkill: true
    });
    const made = runtime(game);
    made.zones.setActive(cases[i].role);
    assert.ok(made.zones.schedulerActive(), cases[i].role + ' needs scheduler service while selected');
    await made.zones.schedulerTick();
    assert.deepStrictEqual(game.payload('AttackMonster'), ['*'],
      cases[i].role + ' attacks * when it has no target');
    if (cases[i].heal) {
      assert.deepStrictEqual(game.payload('UseSkill'), [cases[i].heal],
        cases[i].role + ' heals below 70 percent with its own support skill');
    } else {
      assert.strictEqual(game.count('UseSkill'), 0, 'DPS has no low-health heal');
    }
  }

  const boundary = fakeGame({
    IsLoggedIn: true, Health: 100, Cell: 'Boss', Position: ['100', '321'], HasTarget: true,
    PlayersInMap: ['at-boundary'],
    GetPlayerHealthPercentage: function () { return 70; },
    UseSkill: true
  });
  const atSeventy = runtime(boundary);
  atSeventy.zones.setActive('Ultra Speaker AP');
  await atSeventy.zones.schedulerTick();
  assert.strictEqual(boundary.count('UseSkill'), 0, '70 percent is not below the reference threshold');
});

test('the Speaker scheduler maintains its zone point and handles death and respawn', async () => {
  const game = fakeGame({
    IsLoggedIn: true, Health: 100, Map: 'ultraspeaker', Cell: 'Boss',
    Position: ['150', '321'], HasTarget: true, WalkToPoint: true
  });
  const made = runtime(game);
  made.zones.setActive('Ultra Speaker DPS');
  await made.zones.schedulerTick();
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['100', '321'],
    'the idle role is kept at its reference start point');

  await made.zones.handleFrame(animFrame('truth'));
  await made.zones.handleFrame(animFrame('truth'));
  assert.strictEqual(made.zones.counters().inZone, true, 'the packet row moves the DPS into its zone');
  game.set('Position', ['100', '321']);
  await made.zones.schedulerTick();
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['203', '301'],
    'the scheduler keeps the role at the active zone point after a displacement');

  game.set('Health', 0);
  await made.zones.schedulerTick();
  await made.zones.schedulerTick();
  assert.strictEqual(made.logs.filter(function (line) { return /DPS DIED/.test(line); }).length, 1,
    'death is logged once while the character remains dead');

  game.set('Health', 100);
  game.set('Position', ['203', '301']);
  await made.zones.schedulerTick();
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['100', '321'],
    'respawn repositions to the reference start point before maintaining its role position');
  assert.ok(made.logs.some(function (line) { return /DPS RESPAWNED/.test(line); }));
});

test('a Speaker handler created alive in Ultra Speaker walks to its start point immediately', async () => {
  const game = fakeGame({
    IsLoggedIn: true, Health: 100, Map: 'ultraspeaker', Cell: 'Boss',
    Position: ['100', '321'], HasTarget: true, WalkToPoint: true
  });
  const made = runtime(game);
  made.zones.setActive('Ultra Speaker LOO');
  await made.zones.schedulerTick();
  assert.deepStrictEqual(game.payload('WalkToPoint'), ['100', '321'],
    'the handler constructor walks immediately even when Position already has the start x');

  const dead = fakeGame({
    IsLoggedIn: true, Health: 0, Map: 'ultraspeaker', Cell: 'Boss', WalkToPoint: true
  });
  const deadAtStart = runtime(dead);
  deadAtStart.zones.setActive('Ultra Speaker LR');
  await deadAtStart.zones.schedulerTick();
  assert.strictEqual(deadAtStart.logs.some(function (line) { return /LR DIED/.test(line); }), false,
    'a handler constructed while dead has already set the reference _wasDead flag');
  dead.set('Health', 100);
  await deadAtStart.zones.schedulerTick();
  assert.deepStrictEqual(dead.payload('WalkToPoint'), ['100', '321'],
    'the first live pass logs respawn and returns to the role start point');
  assert.ok(deadAtStart.logs.some(function (line) { return /LR RESPAWNED/.test(line); }));
});

test('the Gramiel scheduler attacks the remaining crystal and taunts until Vendetta', async () => {
  const fallback = fakeGame({
    IsLoggedIn: true, Map: 'ultragramiel-17',
    IsMonsterAvailable: function (args) { return args[0] === 'id:3'; },
    AttackMonsterByMonMapId: true
  });
  const left = runtime(fallback);
  left.zones.setActive('Gramiel P1');
  await left.zones.schedulerTick();
  assert.deepStrictEqual(fallback.payload('AttackMonsterByMonMapId'), ['3'],
    'when crystal 2 is gone, P1 attacks the still-living opposite crystal 3');

  const taunter = fakeGame({
    UserID: 7, IsLoggedIn: true, Map: 'ultragramiel-1', SkillAvailable: 0,
    IsMonsterAvailable: function (args) { return args[0] === 'Gramiel'; },
    AttackMonster: true, UseSkill: true, ForceUseSkill: true
  });
  const made = runtime(taunter);
  made.zones.setActive('Gramiel P3');
  await made.zones.schedulerTick();
  await settle(made);
  assert.deepStrictEqual(taunter.payload('AttackMonster'), ['Gramiel'],
    'with no crystals or Grace Crystal, the preset acquires Gramiel');
  assert.strictEqual(taunter.count('ForceUseSkill'), zones.TAUNT_ATTEMPTS,
    'skill 5 is forced up to three times while Vendetta is absent');
  assert.strictEqual(taunter.count('UseSkill'), zones.TAUNT_ATTEMPTS,
    'each forced cast is followed by the reference plain cast');
  const firstPollCount = taunter.count('IsMonsterAvailable');
  await made.zones.schedulerTick();
  assert.strictEqual(taunter.count('IsMonsterAvailable'), firstPollCount,
    'the reference waits five seconds after a taunt pass before checking again');

  const dead = fakeGame({
    UserID: 7, IsLoggedIn: true, Health: 0, Map: 'ultragramiel-1', SkillAvailable: 0,
    IsMonsterAvailable: function (args) { return args[0] === 'Gramiel'; },
    AttackMonster: true, UseSkill: true, ForceUseSkill: true
  });
  const deadCharacter = runtime(dead);
  deadCharacter.zones.setActive('Gramiel P1');
  await deadCharacter.zones.schedulerTick();
  await settle(deadCharacter);
  assert.strictEqual(dead.count('ForceUseSkill'), zones.TAUNT_ATTEMPTS,
    'the reference TauntLoop has no IsAlive guard on its three-cast worker');
});

// ------------------------------------------------------------------ the Maid's own handlers

/** The Maid's two arms, as the window hands them over. */
function fakeMaid() {
  const state = { unfollow: false, paused: false, stopAttack: false };
  const armed = [];
  return {
    state: state,
    armed: armed,
    setPaused: function (on) { state.paused = on === true; },
    setStopAttack: function (on) { state.stopAttack = on === true; },
    armSkill: function (slot) { armed.push(slot); }
  };
}

function maidRuntime(answers, config, options) {
  const maid = fakeMaid();
  // IsLoggedIn and Map answer by their own loader names, which is what the surface looks the game
  // up for; the fake in this file serves name-keyed answers, so the two are named rather than
  // spelled as the dot-paths their rows read.
  // The six cast-and-attack calls are answered too, because in the real build they are: #49 put
  // them on the movie's side of the boundary, so a Maid handler that forces a skill calls one that
  // answers rather than one that refuses.
  const made = runtime(fakeGame(Object.assign({
    UserID: 7, IsLoggedIn: true, SkillAvailable: 0,
    AttackMonster: true, AttackMonsterByMonMapId: true, UseSkill: true, ForceUseSkill: true
  }, answers || {})), Object.assign({
    config: function () { return config || {}; },
    maid: maid
  }, options || {}));
  made.zones.setMaid(true);
  made.maid = maid;
  return made;
}

test('the Maid\'s own phrase list arms the skill the mode names', async () => {
  const made = maidRuntime({}, {
    UltraBossExtra: 2, SpecialMsg: 'sun converges', SpecialAct: 5
  });
  const answer = await made.zones.handleFrame(animFrame('The sun converges now'));
  assert.ok(answer && answer.arm === '5', 'a phrase hit arms SpecialAct');
  assert.deepStrictEqual(made.maid.armed, ['5']);
  // A frame with no phrase of the list is not this character\'s business.
  const other = await made.zones.handleFrame(animFrame('nothing of the sort'));
  assert.strictEqual(other, null);
  assert.deepStrictEqual(made.maid.armed, ['5']);
});

test('a boss result does not suppress later boss or Maid animation records in its packet', async () => {
  const made = maidRuntime({ IsMonsterAvailable: true }, {
    AntiCounter: true, UltraBossExtra: 0,
    SpecialMsg: 'defense shattering,prepares a counter attack', SpecialAct: 4
  });
  made.zones.setActive('Gramiel P1');
  const answer = await made.zones.handleFrame(jsonFrame({
    cmd: 'ct', anims: [
      { msg: 'defense shattering', tInf: 'id:2' },
      { msg: 'defense shattering', tInf: 'id:2' },
      { msg: 'the boss prepares a counter attack' }
    ]
  }));
  assert.strictEqual(made.zones.counters().crystal, 2,
    'the active boss handler sees both matching records after its first successful result');
  assert.deepStrictEqual(made.maid.armed, ['4', '4', '4'],
    'the Maid listener handles every matching animation record');
  assert.deepStrictEqual(made.slept.slice().sort(function (a, b) { return a - b; }),
    [300, 300, 300, 500, 500, 500, 1500, 6000],
    'boss and AntiCounter subscriptions both finish their own waits');
  assert.ok(Array.isArray(answer), 'all non-null handler results are preserved');
  assert.ok(answer.some(function (one) { return one && one.crystal === 1; }));
  assert.ok(answer.some(function (one) { return one && one.crystal === 2; }));
  assert.strictEqual(answer.filter(function (one) { return one && one.arm === '4'; }).length, 3);
});

test('the Special Anims tick gates the Maid\'s per-boss animation handler', async () => {
  const made = maidRuntime({}, {
    UltraBossExtra: 2, SpecialMsg: 'sun converges', SpecialAct: 5
  });
  made.zones.setSpecialAnims(false);
  assert.strictEqual(await made.zones.handleFrame(animFrame('sun converges')), null);
  assert.deepStrictEqual(made.maid.armed, [], 'an unticked handler does not arm a forced cast');
  made.zones.setSpecialAnims(true);
  const answer = await made.zones.handleFrame(animFrame('sun converges'));
  assert.ok(answer && answer.arm === '5');
  assert.deepStrictEqual(made.maid.armed, ['5']);
});

test('the Maid\'s mode counts its own phrase and lets only its own parity through', async () => {
  // cmbUltraBoss's own index 2 is 'Asc.Solstice P1' (the designer's list starts None, Auto Potion),
  // and index 3 is P2 - the two that share the sun counter.
  assert.strictEqual(zones.MODES[2], 'Asc.Solstice P1');
  assert.strictEqual(zones.MODES[3], 'Asc.Solstice P2');
  const made = maidRuntime({}, {
    UltraBossExtra: 2, SpecialMsg: 'sun converges', SpecialAct: 5
  });
  const first = await made.zones.handleFrame(animFrame('sun converges'));
  assert.ok(first && first.arm === '5', 'Asc.Solstice P1 takes the odd counts');
  const second = await made.zones.handleFrame(animFrame('sun converges'));
  assert.strictEqual(second, null, 'the even count is the other preset\'s');
  const third = await made.zones.handleFrame(animFrame('sun converges'));
  assert.ok(third, 'and the third is P1\'s again');
  assert.strictEqual(made.zones.counters().sun, 3);

  // The sibling preset is the mirror image on the same counter, which is what the four
  // pairs of modes upstream mean (P1 odd, P2 even).
  const even = maidRuntime({}, {
    UltraBossExtra: 3, SpecialMsg: 'sun converges', SpecialAct: 5
  });
  assert.strictEqual(await even.zones.handleFrame(animFrame('sun converges')), null);
  assert.ok(await even.zones.handleFrame(animFrame('sun converges')),
    'Asc.Solstice P2 takes the even counts');

  // A mode whose phrase is not in the frame leaves the other counter alone.
  const moon = maidRuntime({}, {
    UltraBossExtra: 4, SpecialMsg: 'moon converges', SpecialAct: 5
  });
  await moon.zones.handleFrame(animFrame('moon converges'));
  assert.strictEqual(moon.zones.counters().moon, 1);
  assert.strictEqual(moon.zones.counters().sun, 0);
});

test('the crystal modes act on their own crystal id and count only their own side', async () => {
  const made = maidRuntime({}, {
    UltraBossExtra: 8, SpecialMsg: 'shattering', SpecialAct: 5
  });
  const left = await made.zones.handleFrame(animFrame('defense shattering', 'id:2'));
  assert.ok(left, 'Gramiel L1 acts on crystal 2');
  assert.deepStrictEqual(made.game.payload('AttackMonsterByMonMapId'), ['2']);
  const right = await made.zones.handleFrame(animFrame('defense shattering', 'id:3'));
  assert.strictEqual(right, null, 'and never on crystal 3');
  assert.strictEqual(made.zones.counters().maidCrystal, 1);
  // The right-hand mode is the same shape on the other crystal.
  const righty = maidRuntime({}, {
    UltraBossExtra: 10, SpecialMsg: 'shattering', SpecialAct: 5
  });
  await righty.zones.handleFrame(animFrame('defense shattering', 'id:3'));
  assert.deepStrictEqual(righty.game.payload('AttackMonsterByMonMapId'), ['3']);
});

test('the Maid\'s AntiCounter stops the attack on the warning and starts it again after it', async () => {
  const made = maidRuntime({}, { AntiCounter: true });
  // The reference's own two waits ('await Task.Delay(1500)' then 6000, :745-757), and the state it
  // is in while each one runs: still attacking through the first, stopped through the second.
  await made.zones.handleFrame(animFrame('the boss prepares a counter attack'));
  assert.deepStrictEqual(made.slept, [1500, 6000],
    'the reference waits 1500 ms, stops, then waits 6000 ms and starts again');
  assert.strictEqual(made.maid.state.stopAttack, false, 'and it is attacking again afterwards');
  assert.strictEqual(made.zones.holding(), false);

  // The intermediate state, read while the waits are still in flight: the attack is only stopped
  // after the first 1500 ms, which is the delay's whole point.
  const maid = fakeMaid();
  const game = fakeGame({ UserID: 7 });
  const held = [];
  const pending = [];
  const made2 = zones.createZoneHandlers({
    game: game,
    log: function () {},
    sleep: function (ms) {
      held.push({ ms: ms, stopped: maid.state.stopAttack });
      return new Promise(function (resolve) { pending.push(resolve); });
    },
    config: function () { return { AntiCounter: true }; },
    maid: maid
  });
  made2.setMaid(true);
  const frame = made2.handleFrame(animFrame('the boss prepares a counter attack'));
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.deepStrictEqual(held, [{ ms: 1500, stopped: false }],
    'the first wait happens with the attack still on');
  pending.shift()(undefined);
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual(maid.state.stopAttack, true, 'the attack is stopped after the 1500 ms');
  assert.strictEqual(made2.holding(), true, 'the counter warning holds the priority target');
  await made2.resetSpecials();
  assert.strictEqual(made2.holding(), true,
    'an unrelated movement-triggered counter reset does not clear the warning lock');
  assert.deepStrictEqual(held[1], { ms: 6000, stopped: true },
    'and the 6000 ms wait runs with it stopped');
  pending.shift()(undefined);
  // The stop-and-start chain is fire-and-forget upstream too (`Task.Run`), so the frame does not
  // wait for it: one turn of the loop is what lets its last step land.
  await frame;
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual(maid.state.stopAttack, false, 'the function exits with the attack back on');

  // A Counter Attack aura ending starts it again, which is the reference's own second path.
  made.maid.state.stopAttack = true;
  await made.zones.handleFrame(jsonFrame({
    cmd: 'ct', a: [{ cmd: 'aura--', aura: { nam: 'Counter Attack' } }]
  }));
  assert.strictEqual(made.maid.state.stopAttack, false);
});

test('AntiCounter off means the warning is not read at all, which is the tick box\'s own job', async () => {
  const made = maidRuntime({}, { AntiCounter: false });
  await made.zones.handleFrame(animFrame('prepares a counter attack'));
  assert.strictEqual(made.slept.length, 0, 'the reference only subscribes while the box is ticked');
});

test('Gramiel\'s drain holds the target, which is what the priority walk steps aside for', async () => {
  const made = maidRuntime({}, { AntiCounter: true });
  await made.zones.handleFrame(jsonFrame({
    cmd: 'ct',
    a: [{ cmd: 'aura+', auras: [{ msgOn: 'Gramiel attempts to drain your life!' }] }]
  }));
  assert.deepStrictEqual(made.game.payload('AttackMonster'), ['Gramiel']);
  assert.strictEqual(made.zones.holding(), true, 'the reference holds the target for four seconds');
});

test('Gramiel drain locks before its target attack is allowed to resolve', async () => {
  let resolveAttack;
  const made = maidRuntime({
    AttackMonster: function () {
      return new Promise(function (resolve) { resolveAttack = resolve; });
    }
  }, { AntiCounter: true });
  made.zones.handleFrame(jsonFrame({
    cmd: 'ct', a: [{ cmd: 'aura+', auras: [{ msgOn: 'Gramiel attempts to drain your life!' }] }]
  }));
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual(typeof resolveAttack, 'function', 'the target attack is still in flight');
  assert.strictEqual(made.zones.holding(), true,
    'locktarget is set before awaiting AttackMonster, as AntiCounterHandler does');
  resolveAttack(true);
});

// ------------------------------------------------------------------ the Maid's map handlers

/** A `uotls` frame for one player\'s movement, as the game writes it. */
function uotlsFrame(who, movement) {
  return { direction: 'toClient', data: '%xt%uotls%-1%' + who + '%' + movement + '%' };
}

test('the cell jumper follows the target\'s own jump and jumps past anyone else', async () => {
  const made = maidRuntime({}, { Target: 'master', WhitelistMap: false, CopyWalk: false });
  await made.zones.handleFrame(uotlsFrame('someoneelse', 'strFrame:r1,strPad:Left'));
  assert.strictEqual(made.game.count('Jump'), 0, 'another player\'s jump is not the target\'s');
  await made.zones.handleFrame(uotlsFrame('master', 'mvts:-1,px:0,strPad:Spawn,strFrame:Enter'));
  assert.deepStrictEqual(made.game.payload('Jump'), ['Enter', 'Spawn'],
    'the cell and pad the movement string carries');
});

test('an unfollowed Maid does not chase, which is the reference\'s own guard', async () => {
  const made = maidRuntime({}, { Target: 'master' });
  made.maid.state.unfollow = true;
  await made.zones.handleFrame(uotlsFrame('master', 'strFrame:r2,strPad:Right'));
  assert.strictEqual(made.game.count('Jump'), 0);
});

test('the CopyWalk box walks to the point the target walked to, and nothing without one', async () => {
  const made = maidRuntime({}, { Target: 'master', CopyWalk: true });
  await made.zones.handleFrame(uotlsFrame('master', 'sp:8,tx:714,ty:356,strFrame:r1'));
  assert.deepStrictEqual(made.game.payload('WalkToPoint'), ['714', '356']);
  // The reference\'s own two zero checks: a movement with no point is not a walk.
  await made.zones.handleFrame(uotlsFrame('master', 'sp:8,tx:0,ty:0,strFrame:r1'));
  assert.strictEqual(made.game.count('WalkToPoint'), 1);
});

test('the whitelist map pauses the follow in the cell it names and resumes out of it', async () => {
  const made = maidRuntime({ Map: 'battleunderb' }, {
    Target: 'master',
    WhitelistMap: true,
    WhitelistMapMaps: 'battleunderb;Enter;Spawn'
  });
  const pinned = await made.zones.handleFrame(uotlsFrame('master', 'strFrame:Enter,strPad:Spawn'));
  assert.strictEqual(pinned.entry.map, 'battleunderb');
  assert.strictEqual(made.maid.state.paused, true, 'in the configured cell the follow pauses');
  assert.strictEqual(made.maid.state.stopAttack, true, 'and the attack stops with it');
  await made.zones.handleFrame(uotlsFrame('master', 'strFrame:r1,strPad:Left'));
  assert.deepStrictEqual(made.game.payload('Jump'), ['r1', 'Left']);
  assert.strictEqual(made.maid.state.paused, false, 'out of it both resume');
  assert.strictEqual(made.maid.state.stopAttack, false);

  // A map with no entry resumes the follow, which is the reference\'s own else branch.
  const elsewhere = maidRuntime({ Map: 'yulgar' }, {
    Target: 'master', WhitelistMap: true, WhitelistMapMaps: 'battleunderb;Enter;Spawn'
  });
  elsewhere.maid.state.paused = true;
  const none = await elsewhere.zones.handleFrame(uotlsFrame('master', 'strFrame:Enter,strPad:Spawn'));
  assert.strictEqual(none.entry, null);
  assert.strictEqual(elsewhere.maid.state.paused, false);
});

test('the whitelist also answers on the server\'s own joined message', async () => {
  const made = maidRuntime({ Map: 'newbie', Cell: 'all' }, {
    WhitelistMap: true, WhitelistMapMaps: 'newbie;all'
  });
  const joined = await made.zones.handleFrame({
    direction: 'toClient', data: '%xt%server%-1%You joined newbie-1234%'
  });
  assert.strictEqual(made.maid.state.paused, true, 'the "all" cell pauses wherever it lands');
  assert.ok(joined);
  const quiet = await made.zones.handleFrame({
    direction: 'toClient', data: '%xt%server%-1%something else entirely%'
  });
  assert.strictEqual(quiet, null);
});

test('the locked-zone warning joins the next alternative map, round-robin', async () => {
  const made = maidRuntime({ IsLoggedIn: true, Map: 'yulgar' }, {
    LockedZoneHandler: true,
    LockedZoneHandlerMaps: 'citadel-6666;m22;Left\r\ntercessuinotlim-0'
  }, { random: function () { return 0; } });
  await made.zones.handleFrame({
    direction: 'toClient', data: '%xt%warning%-1%Cannot goto to player in a Locked zone.%'
  });
  assert.deepStrictEqual(made.game.payload('Join'), ['citadel-6666', 'm22', 'Left']);
  assert.strictEqual(made.slept[0], 750, 'the reference waits its own random 750-1300 ms');
  await made.zones.handleFrame({
    direction: 'toClient', data: '%xt%warning%-1%Cannot goto to player in a Locked zone.%'
  });
  assert.deepStrictEqual(made.game.payload('Join'),
    ['tercessuinotlim-1', 'Enter', 'Spawn'],
    'the second line is the next map, with the reference\'s own -0 room rule (a -0 becomes -1)');
});

test('with the locked-zone box off a refusal becomes a private whitemap', async () => {
  // The fake answers the loader's own name (`Map`), which is what the handler asks for; the
  // whitemap guard is the one branch that reads it back.
  const made = maidRuntime({ IsLoggedIn: true, Map: 'yulgar' },
    { LockedZoneHandler: false, Target: 'master' }, { random: function () { return 0.5; } });
  await made.zones.handleFrame({
    direction: 'toClient', data: '%xt%warning%-1%Player \'master\' could not be found.%'
  });
  assert.deepStrictEqual(made.game.payload('Join'), ['whitemap-54999', 'Enter', 'Spawn']);
  // Already in a whitemap: the reference holds rather than joining another one. The Target is the
  // name the third branch looks for, so the message is built from it, as the reference builds it.
  const held = maidRuntime({ IsLoggedIn: true, Map: 'whitemap-1' }, { Target: 'master' });
  await held.zones.handleFrame({
    direction: 'toClient', data: '%xt%warning%-1%Room join failed, destination room is full.%'
  });
  assert.strictEqual(held.game.count('Join'), 0);
});

test('a refusal that names neither of the two cases is left alone', async () => {
  const made = maidRuntime({ IsLoggedIn: true, Map: 'yulgar' }, {});
  assert.strictEqual(await made.zones.handleFrame({
    direction: 'toClient', data: '%xt%warning%-1%something else entirely%'
  }), null);
  assert.strictEqual(made.game.count('Join'), 0);
  assert.strictEqual(made.slept.length, 0);
});

test('resetSpecials clears the counter of the part a character has left', async () => {
  const game = fakeGame({ UserID: 7 });
  const made = runtime(game, { config: function () { return {}; } });
  made.zones.setMaid(true);
  game.set('Map', 'ultragramiel');
  game.set('Cell', 'r2');
  await made.zones.handleFrame(uotlsFrame('someone', 'strFrame:r2'));
  assert.strictEqual(made.zones.counters().crystal, 0);
});

// ------------------------------------------------------------------ the calls, and what a refusal says

test('a call the bridge cannot make is reported once per name, in the surface\'s own words', async () => {
  // The calls themselves live in #49: AttackMonster, UseSkill and ForceUseSkill are the movie's
  // own bodies now, so this handler makes them the way the reference does. What is still worth
  // pinning is the failure path, because a bridge that is not attached must not look like a
  // handler that quietly did nothing.
  //
  // The fake answers nothing at all, so each call lands on the real surface row and rejects with
  // the reason that row carries for a member the game does not have. The Gramiel drain is the
  // path that makes an attack on every matching frame, so two frames is what proves the report is
  // once per name rather than once per frame.
  const made = runtime(fakeGame({}), { config: function () { return {}; } });
  made.zones.setMaid(true);
  const drain = jsonFrame({
    cmd: 'ct', a: [{ cmd: 'aura+', auras: [{ msgOn: 'Gramiel attempts to drain your life!' }] }]
  });
  await made.zones.handleFrame(drain);
  await made.zones.handleFrame(drain);
  const said = made.logs.filter(function (line) { return /^maid: AttackMonster:/.test(line); });
  assert.strictEqual(said.length, 1,
    'one sentence per name, not one per frame: ' + made.logs.join(' | '));
  assert.ok(/no member|not able|bridge/.test(said[0]),
    'and the sentence is the bridge\'s own, not a rewritten one: ' + said[0]);
});

test('every loader name these handlers ask for is one the surface names', () => {
  const surface = require('../../plugins/grimlite-parity/loader-surface.js');
  const named = surface.names();
  const done = surface.implemented();
  Object.keys(zones.LOADER_NAMES).forEach(function (name) {
    assert.ok(named.indexOf(name) !== -1, name + ' is not a name the reference loader registers');
    // Every one of them answers: #49 moved the last three (the casts) onto the movie's side of the
    // boundary, so a handler here is complete rather than one that reports what it cannot do.
    assert.ok(done.indexOf(name) !== -1,
      name + ' is a name these handlers depend on, and the surface does not implement it');
  });
  // And the three the ticket's own body was written against are named here so that a surface
  // that regressed them fails loudly rather than at the first boss.
  ['AttackMonster', 'AttackMonsterByMonMapId', 'UseSkill', 'ForceUseSkill'].forEach(function (name) {
    assert.ok(done.indexOf(name) !== -1, name + ' is one of the calls a boss handler makes');
  });
});
test('a running rotation is not started twice, which is the reference\'s own guard', async () => {
  // `if (tauntTask == null && World.IsMonsterAvailable(mon))` (MaidRemake.cs:432) sits around the
  // whole start, and the fighting pass reaches taunt() on every single pass - so without the guard
  // a tc; line would start a second rotation on the very next tick and the two would stack.
  const timers = controlledTimers();
  const made = maidRuntime({ IsMonsterAvailable: true }, { SpecialMsg: 'tc;2;Gramiel;12' }, timers);
  const first = made.zones.tauntCycle('pass');
  assert.strictEqual(first.ok, true);
  const again = made.zones.tauntCycle('pass');
  assert.strictEqual(again.ok, false, 'a second start under the same key is refused');
  assert.strictEqual(again.running, undefined);
  assert.ok(/running/.test(again.error), 'and the refusal names the reason: ' + again.error);
  // The refusal is not fatal to the running cycle: it is still there and still attacking.
  await nextTurn();
  assert.ok(made.game.count('AttackMonster') >= 1, 'the first rotation kept running');
  made.zones.stopCycle('pass');
  assert.strictEqual(timers.pending().length, 0);
  assert.strictEqual(made.zones.tauntCycle('pass').ok, true,
    'and once it stops the same key can start a fresh one');
  made.zones.stopCycle('pass');
});

test('disabling the Maid stops its own taunt cycle but leaves the bot cycle alone', () => {
  const timers = controlledTimers();
  const made = maidRuntime({ IsMonsterAvailable: true }, { SpecialMsg: 'tc;2;Gramiel;12' }, timers);
  assert.strictEqual(made.zones.tauntCycle().ok, true);
  assert.strictEqual(made.zones.startTaunt(2, 'Gramiel', 12, -1).ok, true);
  made.zones.setMaid(false);
  const maidCycle = made.zones.stopCycle('special');
  const botCycle = made.zones.stopCycle('bot');
  assert.strictEqual(maidCycle.ok, false, 'the Maid disable already canceled its own cycle');
  assert.strictEqual(botCycle.ok, true, 'CmdTauntcycle owns a separate stop path');
  assert.strictEqual(timers.pending().length, 0, 'both cancellation paths release their timer handles');
});
