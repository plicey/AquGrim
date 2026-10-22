// The in-game chrome strip (ticket #45), plugin half: the controls the reference draws above the
// game, in its own order and with its own words, and what each one does.
//
// Reference: Grimlite-Li 816d9cd, Grimoire/UI/Root.cs - splitContainer1 (a 27 px strip) holding
// chkStartBot, chkAutoAttack, cbPads, cbCells, btnGetCell and btnBank, above the Flash panel.
// Their x coordinates are the order a user reads (573, 644, 729, 814, 899, 918).
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const platform = require('../../res/platform');
const { createChrome, createFromHost, HEIGHT, PADS, DEFAULT_SKILLS } = require('../../plugins/grimlite-parity/features/chrome/chrome.js');
const skillPresets = require('../../plugins/grimlite-parity/features/chrome/skill-presets.js');
const engine = require('../../plugins/grimlite-parity/bot/engine.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const EMPTY_BOT = { Commands: [] };

function botWith(commands) {
  return { Commands: commands.map(function (name) { return catalog.makeCommand(name, {}); }) };
}

/**
 * A stand-in for what the strip reaches: this window's session (bot/session.js, the same shape
 * the engine runs against), the engine registry (#37) and the Bot Manager's document (#36).
 */
function harness(options) {
  options = options || {};
  const calls = [];
  const reads = options.reads || {};
  const answers = options.answers || {};
  const running = { value: !!options.running };
  const bot = { document: options.document || EMPTY_BOT };
  // Timers are injected everywhere: Auto Attack's own loop is 150 ms, and a real interval left
  // running would hold the test process open (it did, once) long after the assertions passed.
  const timers = options.timers || {
    setInterval: function () { return 1; },
    clearInterval: function () {}
  };

  // One member per session read the strip makes, each recorded. A read marked false in
  // options.reads refuses the way the loader surface does for a name it cannot answer.
  function member(name, value) {
    return function () {
      const args = Array.prototype.slice.call(arguments);
      calls.push({ call: name, args: args });
      if (reads[name] === false) return Promise.reject(new Error('no member ' + name + ' at world'));
      // An answer may be a value or a function of the arguments: several reads (the auras, the
      // cells) are asked for one name at a time and answer per name.
      if (typeof answers[name] === 'function') {
        return Promise.resolve(answers[name].apply(null, args));
      }
      if (answers[name] !== undefined) return Promise.resolve(answers[name]);
      return Promise.resolve(typeof value === 'function' ? value.apply(null, args) : value);
    };
  }

  const session = {
    signedIn: member('signedIn', true),
    cell: member('cell', 'battleon'),
    pad: member('pad', 'Spawn'),
    cells: member('cells', ['battleon', 'yulgar']),
    showBank: member('showBank', null),
    ready: member('ready', true),
    jump: member('jump', null),
    hasTarget: member('hasTarget', true),
    attackMonster: member('attackMonster', null),
    skillAvailable: member('skillAvailable', 0),
    useSkill: member('useSkill', null),
    forceUseSkill: member('forceUseSkill', null),
    className: member('className', 'No Class'),
    health: member('health', 100),
    healthMax: member('healthMax', 100),
    mana: member('mana', 100),
    manaMax: member('manaMax', 100),
    selfAura: member('selfAura', 0)
  };

  const chrome = createChrome({
    session: session,
    runtime: {
      start: function (key, document) {
        calls.push({ call: 'runtime.start', args: [key, document] });
        if (running.value) return Promise.resolve({ ok: false, error: engine.ERRORS.alreadyRunning });
        if (!Array.isArray(document.Commands) || !document.Commands.length) {
          return Promise.resolve({ ok: false, error: engine.ERRORS.empty });
        }
        if (answers.signedIn === false) {
          return Promise.resolve({ ok: false, error: engine.ERRORS.notSignedIn });
        }
        running.value = true;
        return Promise.resolve({ ok: true });
      },
      stop: function (key) {
        calls.push({ call: 'runtime.stop', args: [key] });
        running.value = false;
        return Promise.resolve({ ok: true, stopped: true });
      },
      state: function () {
        return {
          running: running.value, paused: false, index: 0, lastCommand: null,
          commands: (bot.document.Commands || []).length
        };
      }
    },
    windowKey: function () { return 'game-window-1'; },
    bot: function () { return bot.document; },
    presets: options.presets,
    openAutoSkillSet: options.openAutoSkillSet,
    messages: options.messages || {},
    log: function () {},
    sleep: function () { return Promise.resolve(); },
    timers: timers
  });

  return {
    chrome: chrome,
    calls: calls,
    running: running,
    bot: bot,
    session: session,
    runtime: {
      state: function () { return { running: running.value }; },
      start: function (key, document) {
        calls.push({ call: 'runtime.start', args: [key, document] });
        if (running.value) return Promise.resolve({ ok: false, error: engine.ERRORS.alreadyRunning });
        if (!Array.isArray(document.Commands) || !document.Commands.length) {
          return Promise.resolve({ ok: false, error: engine.ERRORS.empty });
        }
        if (answers.signedIn === false) {
          return Promise.resolve({ ok: false, error: engine.ERRORS.notSignedIn });
        }
        running.value = true;
        return Promise.resolve({ ok: true });
      },
      stop: function (key) {
        calls.push({ call: 'runtime.stop', args: [key] });
        running.value = false;
        return Promise.resolve({ ok: true, stopped: true });
      }
    },
    count: function (name) {
      return calls.filter(function (one) { return one.call === name; }).length;
    },
    argsFor: function (name) {
      const found = calls.filter(function (one) { return one.call === name; });
      return found.length ? found[found.length - 1].args : null;
    }
  };
}

// ------------------------------------------------------------------ registration and surfacing

test('the plugin registers a 27 px strip holding the reference controls, in its own order', async () => {
  const activated = await platform.activatePlugin({
    source: 'bundled',
    root: pluginRoot,
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  }, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: {
      startGameOrigin: function () { return Promise.resolve('http://127.0.0.1:41234'); },
      getGameWindow: function () { return null; },
      executeJavaScript: function () { return Promise.resolve(null); }
    }
  });
  const declared = activated.host._getState().gameChrome;
  assert.ok(declared, 'the parity plugin must declare the game window chrome strip');
  // splitContainer1.Size is 962x27 in Root.cs: the strip is the reference own height.
  assert.strictEqual(declared.height, 27);
  assert.strictEqual(HEIGHT, 27);
  const controls = declared.controls();
  assert.deepStrictEqual(controls.map(function (one) { return one.id; }),
    ['startBot', 'autoAttack', 'autoSkillSet', 'pad', 'cell', 'refreshCell', 'bank']);
  assert.deepStrictEqual(controls.map(function (one) { return one.label; }),
    ['Start Bot', 'Auto Attack', 'Skill Set', '', '', 'x', 'Bank']);
  assert.deepStrictEqual(controls.map(function (one) { return one.kind; }),
    ['check', 'check', 'button', 'select', 'select', 'button', 'button']);
  assert.ok(declared.menuLabel(), 'the game menu entry needs a label');
  assert.strictEqual(typeof declared.state, 'function');
  assert.strictEqual(typeof declared.action, 'function');
});

test('the toolbar Skill Set button opens the Auto Attack-only editor', async () => {
  let opened = 0;
  const h = harness({
    openAutoSkillSet: function () { opened += 1; return { ok: true, error: null }; }
  });
  const answer = await h.chrome.action('autoSkillSet', {});
  assert.strictEqual(answer.ok, true);
  assert.strictEqual(opened, 1);
});

test('the host wiring keeps the toolbar Skill Set callback', async () => {
  let opened = 0;
  const chrome = createFromHost({ log: function () {} }, {
    runtime: null,
    session: null,
    openAutoSkillSet: function () { opened += 1; return { ok: true, error: null }; }
  });
  const answer = await chrome.action('autoSkillSet', {});
  assert.strictEqual(answer.ok, true);
  assert.strictEqual(opened, 1);
});

test('the pad picker is the reference own list, in its own order', () => {
  assert.deepStrictEqual(PADS,
    ['Center', 'Spawn', 'Left', 'Right', 'Top', 'Bottom', 'Up', 'Down']);
});

test('the strip reads the live cell, pad and cell list, and its tick follows the engine', async () => {
  const h = harness();
  const state = await h.chrome.state();
  assert.strictEqual(state.values.cell, 'battleon');
  assert.strictEqual(state.values.pad, 'Spawn');
  assert.deepStrictEqual(state.options.cell, ['battleon', 'yulgar'],
    'the cell box is filled from World.Cells, which the reference reads on its own Click');
  assert.deepStrictEqual(state.options.pad, PADS);
  assert.strictEqual(state.values.startBot, false);
  h.running.value = true;
  assert.strictEqual((await h.chrome.state()).values.startBot, true,
    'the tick is the engine own running flag, not what was last clicked');
});

test('a game that cannot be read leaves the boxes empty and carries the reason', async () => {
  const h = harness({ answers: { signedIn: false } });
  const state = await h.chrome.state();
  assert.strictEqual(state.values.cell, '');
  assert.strictEqual(state.values.pad, '');
  assert.strictEqual(state.values.startBot, false);
  assert.ok(state.error, 'a refusal must travel with the view rather than being swallowed');
});

test('a cell list the game will not answer keeps the last one and waits to be asked again', async () => {
  // The reference fills its cell box from World.Cells when the user opens it and on the refresh
  // button, and its own cbCells_Click returns silently while nobody is logged in (Root.cs:392).
  // A page that redrew from a refusal every time the window was touched would be showing an error
  // the user did not ask for; the refresh control is where that refusal is reported.
  const h = harness();
  const filled = await h.chrome.action('refreshCell', {});
  assert.strictEqual(filled.ok, true);
  assert.deepStrictEqual(filled.view.options.cell, ['battleon', 'yulgar']);

  const broken = harness({ reads: { cells: false }, answers: { signedIn: true } });
  const refused = await broken.chrome.action('refreshCell', {});
  assert.strictEqual(refused.ok, false, 'the control the user pressed reports');
  assert.ok(/GetCells|no member/.test(refused.error), refused.error);
  const view = await broken.chrome.state();
  assert.strictEqual(view.error, null, 'and a passive redraw does not repeat it');
  assert.strictEqual(view.values.cell, 'battleon', 'the boxes still show where the character is');
});

// ------------------------------------------------------------------------------------ Start Bot

test('Start Bot refuses with the engine own words, and does not start', async () => {
  const empty = harness({ document: EMPTY_BOT });
  const refused = await empty.chrome.action('startBot', { checked: true });
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.error, engine.ERRORS.empty, 'the engine own text, not a copy of it');
  assert.strictEqual(empty.running.value, false);
  assert.strictEqual(refused.view.values.startBot, false, 'a refused tick stays off');

  const signedOut = harness({ document: botWith(['CmdBlank']), answers: { signedIn: false } });
  const out = await signedOut.chrome.action('startBot', { checked: true });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.error, engine.ERRORS.notSignedIn);

  const again = harness({ document: botWith(['CmdBlank']), running: true });
  const already = await again.chrome.action('startBot', { checked: true });
  assert.strictEqual(already.ok, false);
  assert.strictEqual(already.error, engine.ERRORS.alreadyRunning);
});

test('Start Bot starts the document the Bot Manager holds; unticking it stops that bot', async () => {
  const document = botWith(['CmdBlank']);
  const h = harness({ document: document });
  const started = await h.chrome.action('startBot', { checked: true });
  assert.strictEqual(started.ok, true);
  assert.deepStrictEqual(h.argsFor('runtime.start'), ['game-window-1', document]);
  assert.strictEqual(started.view.values.startBot, true);
  const stopped = await h.chrome.action('startBot', { checked: false });
  assert.strictEqual(stopped.ok, true);
  assert.strictEqual(stopped.view.values.startBot, false);
  assert.deepStrictEqual(h.argsFor('runtime.stop'), ['game-window-1']);
});

test('with no engine wired the strip refuses rather than looking like it started one', async () => {
  const h = harness();
  const noEngine = createChrome({ session: null, runtime: null, bot: function () { return EMPTY_BOT; } });
  const answer = await noEngine.action('startBot', { checked: true });
  assert.strictEqual(answer.ok, false);
  assert.ok(/bot engine/.test(answer.error), answer.error);
  h.chrome.stop();
});

// ---------------------------------------------------------------------------------- Auto Attack

test('Auto Attack refuses while the bot runs and when nobody is signed in', async () => {
  const busy = harness({ running: true });
  const refused = await busy.chrome.action('autoAttack', { checked: true });
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.error, engine.ERRORS.alreadyRunning);
  assert.strictEqual(refused.view.values.autoAttack, false);

  const out = harness({ answers: { signedIn: false } });
  const signedOut = await out.chrome.action('autoAttack', { checked: true });
  assert.strictEqual(signedOut.ok, false);
  assert.strictEqual(signedOut.error, engine.ERRORS.notSignedIn);
  assert.strictEqual(signedOut.view.values.autoAttack, false);
});

test('Auto Attack walks the reference own rotation: skills 1 to 4, wrapping', async () => {
  const h = harness({ answers: { hasTarget: true } });
  const started = await h.chrome.action('autoAttack', { checked: true });
  assert.strictEqual(started.ok, true);
  assert.strictEqual(started.view.values.autoAttack, true);
  for (let i = 0; i < DEFAULT_SKILLS.length; i++) {
    await h.chrome.tick();
    assert.deepStrictEqual(h.argsFor('useSkill'), [DEFAULT_SKILLS[i]],
      'a class with no combo casts through the plain name, as Skill.useSkill does');
  }
  await h.chrome.tick();
  assert.deepStrictEqual(h.argsFor('useSkill'), ['1'], 'the rotation wraps, as the reference does');
  assert.strictEqual(h.count('attackMonster'), 0, 'a live target is not re-attacked');
});

test('Auto Attack attacks with the reference own target string when nothing is targeted', async () => {
  const h = harness({ answers: { hasTarget: false } });
  await h.chrome.action('autoAttack', { checked: true });
  await h.chrome.tick();
  assert.deepStrictEqual(h.argsFor('attackMonster'), ['*']);
  // Nothing targeted after the attack: the pass ends without burning a skill, as its own
  // "if (!Player.HasTarget) continue;" does.
  assert.strictEqual(h.count('useSkill'), 0);
});

test('a refused skill is reported on the strip and the rotation keeps going', async () => {
  const h = harness({ reads: { useSkill: false } });
  await h.chrome.action('autoAttack', { checked: true });
  await h.chrome.tick();
  const state = await h.chrome.state();
  assert.ok(/skill 1/.test(state.values.autoAttackError || ''), JSON.stringify(state.values));
  assert.strictEqual(state.values.autoAttack, true, 'the loop keeps running; the refusal is shown');
});

test('Auto Attack waits out a preset skill\'s cooldown only when the preset says wait', async () => {
  const slept = [];
  const h = harness({ answers: { hasTarget: true, skillAvailable: 400 } });
  h.chrome.stop();
  const chrome = createChrome({
    session: h.session,
    runtime: h.runtime,
    windowKey: function () { return 'game-window-1'; },
    bot: function () { return EMPTY_BOT; },
    presets: {
      reload: function () {},
      forClass: function () {
        return [{ index: '1', safe: false, wait: true }];
      }
    },
    sleep: function (ms) { slept.push(ms); return Promise.resolve(); },
    timers: { setInterval: function () { return 1; }, clearInterval: function () {} },
    log: function () {}
  });
  await chrome.action('autoAttack', { checked: true });
  await chrome.tick();
  assert.deepStrictEqual(slept, [400], 'SkillAvailable ms are waited out, as the reference does');
  chrome.stop();
});

test('the fallback rotation casts without waiting, as the reference\'s default Skill rows do', async () => {
  const slept = [];
  const h = harness({ answers: { hasTarget: true, skillAvailable: 400 } });
  h.chrome.stop();
  const chrome = createChrome({
    session: h.session,
    runtime: h.runtime,
    windowKey: function () { return 'game-window-1'; },
    bot: function () { return EMPTY_BOT; },
    sleep: function (ms) { slept.push(ms); return Promise.resolve(); },
    timers: { setInterval: function () { return 1; }, clearInterval: function () {} },
    log: function () {}
  });
  await chrome.action('autoAttack', { checked: true });
  await chrome.tick();
  assert.deepStrictEqual(slept, [], 'no preset means no wait flag');
  chrome.stop();
});

test('the reference three class combos run before the rotation', async () => {
  const cases = [
    { className: 'Chrono Shadow', auras: { 'Rounds Empty': 1 }, skills: ['4', '1'] },
    { className: 'Chrono Shadow', mana: 10, auras: {}, skills: ['4', '1'] },
    { className: 'Arcana Invoker', auras: { 'End of the world': 15 }, skills: ['1'] },
    { className: 'Archmage', auras: { 'Arcane Sigil': 0 }, skills: ['4'] }
  ];
  for (let i = 0; i < cases.length; i++) {
    const one = cases[i];
    const h = harness({
      answers: {
        hasTarget: true,
        className: one.className,
        mana: one.mana === undefined ? 100 : one.mana,
        // Player.GetAuras(true, name) answers one name at a time, so the aura answers are per
        // name: a case names the aura its own condition reads.
        selfAura: function (name) {
          const auras = one.auras || {};
          return auras[name] === undefined ? 0 : auras[name];
        }
      }
    });
    await h.chrome.action('autoAttack', { checked: true });
    await h.chrome.tick();
    // Skill.useSkill forces a Chrono Shadow's cast and uses the plain name for every other class,
    // so the combo is whatever the two names record between them, in the order they were called.
    const cast = h.calls.filter(function (call) {
      return call.call === 'useSkill' || call.call === 'forceUseSkill';
    })
      .map(function (call) { return call.args[0]; });
    // The reference runs SpecialClassCombo and then still spends one slot of the rotation in the
    // same pass (Root.cs:1608-1624), which here is the 1-4 fallback's first skill.
    assert.deepStrictEqual(cast, one.skills.concat(['1']),
      one.className + ' should run its own combo before the rotation');
  }
});

test('ClientConfig SS.CLASS presets parse semicolons/commas, wait and the two safe checks', () => {
  assert.deepStrictEqual(skillPresets.parsePreset('1;2;3:SH>60;4'), [
    { index: '1', safe: false, wait: false },
    { index: '2', safe: false, wait: false },
    { index: '3', safe: true, isMp: false, op: '>', value: 60, wait: false },
    { index: '4', safe: false, wait: false }
  ]);
  assert.deepStrictEqual(skillPresets.parsePreset('1,2,3:SM<30,4'), [
    { index: '1', safe: false, wait: false },
    { index: '2', safe: false, wait: false },
    { index: '3', safe: true, isMp: true, op: '<', value: 30, wait: false },
    { index: '4', safe: false, wait: false }
  ]);
  // 'wait' is the reference's own trailing marker (2wait) and makes every normal row wait.
  assert.deepStrictEqual(skillPresets.parsePreset('3;2;1;2;4;2wait'), [
    { index: '3', safe: false, wait: true },
    { index: '2', safe: false, wait: true },
    { index: '1', safe: false, wait: true },
    { index: '2', safe: false, wait: true },
    { index: '4', safe: false, wait: true },
    { index: '2', safe: false, wait: true }
  ]);

  const config = skillPresets.parseConfig([
    'SS.VOID HIGHLORD=1:SH>60;2;3:SH>60;4',
    'ss.archpaladin=1,2:SH<60,3,4',
    'somethingElse=1;2'
  ].join('\n'));
  assert.deepStrictEqual(Object.keys(config).sort(), ['ARCHPALADIN', 'VOID HIGHLORD']);
  assert.strictEqual(config['VOID HIGHLORD'][0].safe, true);
  assert.strictEqual(config.ARCHPALADIN[1].op, '<');
});

test('Auto Attack runs the matching class preset and skips a safe skill whose condition is false', async () => {
  const preset = skillPresets.parsePreset('3:SH>60;2:SM<30');
  const h = harness({
    answers: { hasTarget: true, className: 'Void Highlord', health: 20, healthMax: 100, mana: 20 },
    presets: { reload: function () {}, forClass: function () { return preset; } }
  });
  await h.chrome.action('autoAttack', { checked: true });
  assert.deepStrictEqual(h.chrome.rotation(), preset, 'the matched class preset is the rotation');
  await h.chrome.tick();
  assert.strictEqual(h.count('useSkill'), 0, '20% HP does not satisfy SH>60');
  await h.chrome.tick();
  assert.deepStrictEqual(h.argsFor('useSkill'), ['2'], '20% mana satisfies SM<30');
  h.chrome.stop();
});

test('a preset with no match falls back to skills 1-4', async () => {
  const h = harness({
    answers: { hasTarget: true, className: 'No Class' },
    presets: { reload: function () {}, forClass: function () { return []; } }
  });
  await h.chrome.action('autoAttack', { checked: true });
  assert.deepStrictEqual(h.chrome.rotation().map(function (one) { return one.index; }),
    ['1', '2', '3', '4']);
  h.chrome.stop();
});

test('Auto Attack uses its own skill set before the class preset', async () => {
  const own = skillPresets.parsePreset('3:SH>70;4');
  const classPreset = skillPresets.parsePreset('1;2');
  const h = harness({
    answers: { hasTarget: true, className: 'Void Highlord' },
    presets: {
      reload: function () {},
      forClass: function () { return classPreset; },
      custom: function () { return own; }
    }
  });
  await h.chrome.action('autoAttack', { checked: true });
  assert.deepStrictEqual(h.chrome.rotation().map(function (one) { return one.index; }), ['3', '4']);
  assert.strictEqual(h.chrome.rotation()[0].safe, true);
  h.chrome.stop();
});

test('the preset source reads ClientConfig.cfg, with the store key winning over it', () => {
  const source = skillPresets.createPresetSource({
    files: ['/app/ClientConfig.cfg'],
    readFile: function () { return 'SS.VOID HIGHLORD=1;2\nSS.SHAMAN=1;2:SM>30'; },
    store: {
      read: function () {
        return { autoAttackPresets: { 'VOID HIGHLORD': '4:SH>60;1' } };
      }
    }
  });
  assert.deepStrictEqual(source.forClass('void highlord').map(function (one) { return one.index; }),
    ['4', '1'], 'the user\'s store edit is the one Auto Attack runs');
  assert.deepStrictEqual(source.forClass('Shaman').map(function (one) { return one.index; }),
    ['1', '2'], 'classes only in the file still work');
  assert.deepStrictEqual(source.forClass('Nobody'), []);

  const configured = skillPresets.createPresetSource({
    files: [],
    store: { read: function () { return {}; } },
    skillSet: function () { return '2:SH>50;4'; }
  });
  assert.deepStrictEqual(configured.custom().map(function (one) { return one.index; }), ['2', '4']);
  assert.strictEqual(configured.custom()[0].safe, true);
});

// ------------------------------------------------------------------- the cell and pad pickers

test('the refresh control reads the cells and the position, then re-issues the move', async () => {
  const h = harness();
  const answer = await h.chrome.action('refreshCell', {});
  assert.strictEqual(answer.ok, true);
  assert.deepStrictEqual(h.argsFor('jump'), ['battleon', 'Spawn'],
    'btnGetCell_Click re-issues MoveToCell(Player.Cell, Player.Pad)');
  assert.deepStrictEqual(answer.view.options.cell, ['battleon', 'yulgar']);
});

test('picking a cell moves there; picking a pad keeps the cell the character stands in', async () => {
  const h = harness();
  await h.chrome.action('cell', { value: 'yulgar' });
  assert.deepStrictEqual(h.argsFor('jump'), ['yulgar', 'Spawn']);

  const pad = harness();
  await pad.chrome.action('pad', { value: 'Left' });
  assert.deepStrictEqual(pad.argsFor('jump'), ['battleon', 'Left'],
    'cbPads_SelectedIndexChanged moves to the pad in the current cell');
});

test('the pickers and the refresh refuse while nobody is signed in, as the reference does', async () => {
  const h = harness({ answers: { signedIn: false } });
  const moved = await h.chrome.action('cell', { value: 'yulgar' });
  assert.strictEqual(moved.ok, false);
  assert.strictEqual(moved.error, engine.ERRORS.notSignedIn);
  assert.strictEqual(h.count('jump'), 0, 'nothing was moved');
  const refresh = await h.chrome.action('refreshCell', {});
  assert.strictEqual(refresh.ok, false);
  assert.deepStrictEqual(refresh.view.options.cell, [], 'and no cell list is offered');
});

test('the refresh refuses while the map is still loading, as its own guard does', async () => {
  const h = harness({ answers: { ready: false } });
  const answer = await h.chrome.action('refreshCell', {});
  assert.strictEqual(answer.ok, false);
  assert.ok(/loading/.test(answer.error), answer.error);
  assert.strictEqual(h.count('jump'), 0);
});

test('a cell list that cannot be read is reported rather than answered with an empty box', async () => {
  const h = harness({ reads: { cells: false } });
  const answer = await h.chrome.action('refreshCell', {});
  assert.strictEqual(answer.ok, false);
  assert.ok(/GetCells/.test(answer.error) || /no member/.test(answer.error), answer.error);
});

// ----------------------------------------------------------------------------------------- Bank

test('toolbar Bank opens the game Bank UI through the session', async () => {
  const h = harness();
  const answer = await h.chrome.action('bank', {});
  assert.strictEqual(answer.ok, true);
  assert.strictEqual(h.count('showBank'), 1);
});

test('an unknown control is refused by name rather than silently ignored', async () => {
  const h = harness();
  const answer = await h.chrome.action('nonsense', {});
  assert.strictEqual(answer.ok, false);
  assert.ok(/nonsense/.test(answer.error), answer.error);
});

test('the strip leaves no timer behind when it stops', async () => {
  const cleared = [];
  const made = [];
  const chrome = createChrome({
    session: null,
    runtime: {
      state: function () { return { running: false }; },
      start: function () { return Promise.resolve({ ok: true }); },
      stop: function () { return Promise.resolve({ ok: true }); }
    },
    bot: function () { return EMPTY_BOT; },
    timers: {
      setInterval: function () { made.push(42); return 42; },
      clearInterval: function (id) { cleared.push(id); }
    },
    log: function () {}
  });
  // With nobody signed in there is nothing to attack, so the timer is only started by a tick.
  const session = { signedIn: function () { return Promise.resolve(false); } };
  const signedOut = createChrome({
    session: session,
    runtime: {
      state: function () { return { running: false }; },
      start: function () { return Promise.resolve({ ok: true }); },
      stop: function () { return Promise.resolve({ ok: true }); }
    },
    bot: function () { return EMPTY_BOT; },
    timers: {
      setInterval: function () { made.push(7); return 7; },
      clearInterval: function (id) { cleared.push(id); }
    },
    log: function () {}
  });
  assert.strictEqual((await signedOut.action('autoAttack', { checked: true })).ok, false,
    'nothing is ticking while no character is signed in');
  chrome.stop();
  assert.deepStrictEqual(cleared, [], 'nothing was ticking, so nothing is cleared');
  assert.deepStrictEqual(made, []);
});

test('every game read the strip makes is a loader name the surface answers', () => {
  const source = fs.readFileSync(
    path.join(pluginRoot, 'features/chrome/chrome.js'), 'utf8');
  // The session members the strip reads, each of which is a loader name in bot/session.js rather
  // than a dot-path spelled out here.
  ['signedIn', 'cell', 'pad', 'cells', 'ready', 'jump', 'hasTarget', 'attackMonster',
    'skillAvailable', 'useSkill', 'className', 'mana', 'selfAura'].forEach(function (name) {
      assert.ok(source.indexOf("read('" + name + "'") !== -1 ||
        source.indexOf('read("' + name + '"') !== -1, 'the strip must read ' + name);
    });
  assert.strictEqual(source.indexOf('world.'), -1, 'no dot-path is spelled out here');
  assert.strictEqual(source.indexOf('loaderCall'), -1,
    'the strip reads through the session, not through the raw loader surface');
});

test('the strip keeps the reference controls and adds the Auto Attack skill editor', () => {
  const h = harness();
  const controls = h.chrome.controls();
  assert.strictEqual(controls.length, 7);
  assert.deepStrictEqual(controls.map(function (one) { return one.id; }),
    ['startBot', 'autoAttack', 'autoSkillSet', 'pad', 'cell', 'refreshCell', 'bank']);
  // A label from the locale catalog wins, so a translated build shows its own words.
  const localised = createChrome({
    messages: { startBot: 'Iniciar Bot', bank: 'Banco' },
    session: null, runtime: null
  });
  const labels = localised.controls().map(function (one) { return one.label; });
  assert.strictEqual(labels[0], 'Iniciar Bot');
  assert.strictEqual(labels[6], 'Banco');
});
