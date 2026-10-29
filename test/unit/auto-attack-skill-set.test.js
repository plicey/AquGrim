const assert = require('assert');
const fs = require('fs');
const path = require('path');

const autoAttack = require('../../plugins/grimlite-parity/features/auto-attack/auto-attack-window.js');
const presets = require('../../plugins/grimlite-parity/features/chrome/skill-presets.js');

function memoryStore(value) {
  let current = value || {};
  return {
    read: function () { return JSON.parse(JSON.stringify(current)); },
    write: function (next) { current = JSON.parse(JSON.stringify(next)); return next; }
  };
}

test('the Auto Attack editor loads named class presets, applies drafts, and saves only on request', async () => {
  const store = memoryStore({
    autoAttackSkillSet: '1,2,4',
    autoAttackPresets: { 'VOID HIGHLORD': { Boss: '1;2' } }
  });
  const handlers = {};
  const host = {
    ipc: { handle: function (name, fn) { handlers[name] = fn; } }
  };
  const used = [];
  const source = presets.createPresetSource({ store: store, files: [] });
  autoAttack.createAutoAttackWindow({
    presets: source,
    className: function () { return 'Void Highlord'; },
    onUse: function (text) { used.push(text); }
  }).register(host);

  const start = await handlers.autoAttackSkillSetGet();
  assert.strictEqual(start.className, 'Void Highlord');
  assert.deepStrictEqual(start.presets.map(function (one) { return one.name; }), ['Boss']);
  assert.strictEqual(start.text, '', 'the old universal key is ignored');

  const loaded = await handlers.autoAttackPresetLoad(null, {
    className: 'Void Highlord', name: 'Boss'
  });
  assert.strictEqual(loaded.ok, true);
  assert.strictEqual(loaded.text, '1;2');
  assert.deepStrictEqual(used, ['1;2'], 'selecting a preset uses it immediately');

  const drafted = await handlers.autoAttackSkillSetDraft(null, {
    className: 'Void Highlord', name: 'Boss', text: '2:SH>60;3,4'
  });
  assert.strictEqual(drafted.text, '2:SH>60;3,4');
  assert.deepStrictEqual(used, ['1;2'], 'editing does not apply to the running rotation');

  const saved = await handlers.autoAttackPresetSave(null, {
    className: 'Void Highlord', name: 'Boss', text: '2:SH>60;3,4'
  });
  assert.strictEqual(saved.ok, true);
  assert.deepStrictEqual(store.read(), {
    autoAttackSkillSet: '1,2,4',
    autoAttackPresets: { 'VOID HIGHLORD': { Boss: '2:SH>60;3,4' } },
    autoAttackSelectedPresets: { 'VOID HIGHLORD': 'Boss' },
    autoAttackDrafts: { 'VOID HIGHLORD': { name: 'Boss', text: '2:SH>60;3,4' } }
  }, 'save stores the named class preset and leaves the old universal key untouched');
  assert.deepStrictEqual(used, ['1;2'], 'saving does not apply anything');

  await handlers.autoAttackPresetDelete(null, { className: 'Void Highlord', name: 'Boss' });
  assert.deepStrictEqual(store.read(), { autoAttackSkillSet: '1,2,4',
    autoAttackDrafts: { 'VOID HIGHLORD': { name: null, text: '2:SH>60;3,4' } } });

  await handlers.autoAttackSkillSetDefault(null, { className: 'Void Highlord' });
  assert.deepStrictEqual(used, ['1;2', ''], 'choosing Default applies the fallback');
});

test('the Auto Attack editor is a direct toolbar window with its own preload', () => {
  const root = path.join(__dirname, '../..');
  const windows = fs.readFileSync(path.join(root, 'plugins/grimlite-parity/windows.js'), 'utf8');
  const page = fs.readFileSync(path.join(root,
    'plugins/grimlite-parity/features/auto-attack/auto-attack.html'), 'utf8');
  const preload = fs.readFileSync(path.join(root,
    'plugins/grimlite-parity/features/auto-attack/preload_auto_attack.js'), 'utf8');
  assert.ok(windows.indexOf("'auto-attack', 'preload_auto_attack.js'") !== -1);
  assert.ok(page.indexOf('Auto Attack Skill Set') !== -1);
  assert.ok(page.indexOf('window.aquastarAutoAttack') !== -1);
  assert.ok(page.indexOf('Custom (unsaved)') !== -1);
  assert.ok(preload.indexOf('autoAttackPresetSave') !== -1);
  assert.ok(/require\((['"])electron\1\)/.test(preload));
  assert.ok(!/[^\w.]require\(['"](?!electron)/.test(preload), 'preloads may only require electron');
});

test('named selections restore by normalized class across switches and source recreation', () => {
  const store = memoryStore({ autoAttackPresets: {
    'VOID HIGHLORD': { Boss: '1;2', Farm: '3;4' },
    SHAMAN: { Farm: '2;4' }
  } });
  function fresh() { return presets.createPresetSource({ store: store, files: [] }); }
  const source = fresh();
  source.loadPreset(' Void Highlord ', 'boss');
  source.setDraft('Void Highlord', '4;4', 'Boss');
  source.savePreset('Void Highlord', 'Farm', '3;3');
  assert.strictEqual(source.draftFor('void highlord').text, '4;4', 'Save leaves the draft alone');
  assert.deepStrictEqual(store.read().autoAttackSelectedPresets, { 'VOID HIGHLORD': 'Boss' });
  assert.strictEqual(fresh().draftFor('void highlord').text, '4;4', 'editor text survives restart');
  source.loadPreset('shaman', 'farm');
  assert.strictEqual(source.draftFor('Void Highlord').name, 'Boss');
  assert.strictEqual(source.draftFor('Void Highlord').text, '4;4', 'each class retains its editor text');
  assert.strictEqual(source.draftFor('SHAMAN').text, '2;4');
  assert.strictEqual(source.draftFor('Nobody'), null);
  assert.strictEqual(fresh().draftFor('Shaman').name, 'Farm');
  source.setDraft('Shaman', '4;3', null);
  assert.strictEqual(source.draftFor('Shaman').text, '4;3', 'custom draft wins for this session');
  assert.strictEqual(fresh().draftFor('Shaman').text, '4;3', 'custom text survives restart');
  source.clearDraft(' shaman ');
  assert.strictEqual(source.draftFor('Shaman'), null);
  assert.strictEqual(fresh().draftFor('Shaman'), null, 'Default survives restart');
  assert.strictEqual(fresh().draftFor('Void Highlord').name, 'Boss', 'Default affects only its class');
});

test('Save alone never selects, and deleted or missing selections safely fall back', () => {
  const store = memoryStore();
  function fresh() { return presets.createPresetSource({ store: store, files: [] }); }
  const source = fresh();
  source.savePreset('Shaman', 'Farm', '2;3');
  assert.strictEqual(source.draftFor('Shaman'), null);
  assert.strictEqual(fresh().draftFor('Shaman'), null);
  source.loadPreset('Shaman', 'Farm');
  source.deletePreset('Shaman', 'Farm');
  assert.strictEqual(source.draftFor('Shaman').name, null, 'delete retains the existing transient text');
  assert.strictEqual(source.draftFor('Shaman').text, '2;3');
  assert.strictEqual(fresh().draftFor('Shaman').text, '2;3');
  source.savePreset('Shaman', 'Farm', '4');
  assert.strictEqual(fresh().draftFor('Shaman').name, null, 'recreating a deleted name does not select it');
  source.loadPreset('Shaman', 'Farm');
  source.setDraft('Shaman', '3;3', 'Farm');
  store.write({ autoAttackSelectedPresets: { SHAMAN: 'Farm' } });
  assert.strictEqual(source.draftFor('Shaman').name, null, 'externally missing preset unnames the draft');
  assert.strictEqual(source.draftFor('Shaman').text, '3;3', 'unsaved edits are preserved');
  assert.strictEqual(fresh().draftFor('Shaman').text, '3;3');
  source.savePreset('Shaman', 'Farm', '1');
  assert.strictEqual(fresh().draftFor('Shaman').name, null, 'stale selection was cleared');
});

test('ClientConfig selections work without a writable store and restore only while available', () => {
  let config = 'SS.SHAMAN=2;3';
  const store = memoryStore();
  function fresh(storage) {
    return presets.createPresetSource({ store: storage, files: ['ClientConfig.cfg'],
      readFile: function () { return config; } });
  }
  [undefined, { read: function () { return {}; } }].forEach(function (storage) {
    const source = fresh(storage);
    assert.strictEqual(source.loadPreset('Shaman', 'ClientConfig').text, '2;3');
    assert.throws(function () { source.savePreset('Shaman', 'Farm', '1'); }, /cannot save/);
    source.clearDraft('Shaman');
    assert.strictEqual(source.draftFor('Shaman'), null);
  });
  fresh(store).loadPreset('Shaman', 'ClientConfig');
  assert.strictEqual(fresh(store).draftFor('Shaman').name, 'ClientConfig');
  config = '';
  assert.strictEqual(fresh(store).draftFor('Shaman').name, null);
  config = 'SS.SHAMAN=4';
  assert.strictEqual(fresh(store).draftFor('Shaman').name, null, 'missing file selection stays cleared');
});

test('reopening the editor restores the remembered selection without applying or saving text', async () => {
  const store = memoryStore({ autoAttackPresets: { SHAMAN: { Farm: '2;3' } } });
  presets.createPresetSource({ store: store, files: [] }).loadPreset('Shaman', 'Farm');
  const handlers = {};
  const used = [];
  autoAttack.createAutoAttackWindow({
    presets: presets.createPresetSource({ store: store, files: [] }),
    className: function () { return 'Shaman'; },
    onUse: function (text) { used.push(text); }
  }).register({ ipc: { handle: function (name, fn) { handlers[name] = fn; } } });
  const state = await handlers.autoAttackSkillSetGet();
  assert.strictEqual(state.selected, 'Farm');
  assert.strictEqual(state.text, '2;3');
  await handlers.autoAttackPresetSave(null, { className: 'Shaman', name: 'Boss', text: '4' });
  assert.strictEqual((await handlers.autoAttackSkillSetGet()).selected, 'Farm');
  assert.deepStrictEqual(used, []);
  await handlers.autoAttackSkillSetDefault(null, { className: 'Shaman' });
  assert.strictEqual((await handlers.autoAttackSkillSetGet()).selected, null);
  assert.strictEqual(presets.createPresetSource({ store: store, files: [] }).draftFor('Shaman'), null);
});

test('selection persistence failures return IPC errors without changing the live rotation or draft', async () => {
  const store = memoryStore({ autoAttackPresets: { SHAMAN: { Farm: '2;3' } } });
  const source = presets.createPresetSource({ store: store, files: [] });
  const handlers = {};
  const used = [];
  autoAttack.createAutoAttackWindow({ presets: source,
    onUse: function (text) { used.push(text); }
  }).register({ ipc: { handle: function (name, fn) { handlers[name] = fn; } } });
  source.setDraft('Shaman', '4', null);
  const write = store.write;
  store.write = function () { throw new Error('disk full'); };
  assert.deepStrictEqual(await handlers.autoAttackPresetLoad(null, { className: 'Shaman', name: 'Farm' }),
    { ok: false, error: 'disk full' });
  assert.strictEqual(source.draftFor('Shaman').text, '4');
  store.write = write;
  source.loadPreset('Shaman', 'Farm');
  store.write = function () { throw new Error('disk full'); };
  assert.deepStrictEqual(await handlers.autoAttackSkillSetDefault(null, { className: 'Shaman' }),
    { ok: false, error: 'disk full' });
  assert.strictEqual(source.draftFor('Shaman').name, 'Farm');
  assert.deepStrictEqual(used, []);
});

test('step controls generate only parser-supported HP/MP percentages and preserve insertion boundaries', () => {
  const step = require('../../plugins/grimlite-parity/features/auto-attack/skill-step.js');
  ['1', '2', '3', '4'].forEach(function (skill) {
    assert.strictEqual(step.format(skill, '', '', ''), skill);
    ['SH', 'SM'].forEach(function (condition) {
      ['>=', '<=', '='].forEach(function (op) {
        ['0', '50', '100'].forEach(function (value) {
          assert.deepStrictEqual(presets.parsePreset(step.format(skill, condition, op, value)), [{
            index: skill, safe: true, isMp: condition === 'SM', op: op, value: Number(value), wait: false
          }]);
        });
      });
    });
  });
  ['', '-1', '1.5', '101', 'NaN', '50;4', '1e2'].forEach(function (value) {
    assert.throws(function () { step.format('2', 'SM', '<=', value); }, /percentage/);
  });
  assert.throws(function () { step.format('5', '', '', ''); }, /skill/);
  assert.throws(function () { step.format('1', 'TH', '>=', '50'); }, /HP or MP/);
  assert.throws(function () { step.format('1', 'SH', '>', '50'); }, /comparison/);
  [
    ['', 0, 0, '2:SM<=50', 8],
    ['1', 1, 1, '1;2:SM<=50', 10],
    ['1;4', 2, 2, '1;2:SM<=50;4', 11],
    ['1;4', 0, 1, '2:SM<=50;4', 8],
    ['1;4', 0, 3, '2:SM<=50', 8],
    ['1;  4', 2, 4, '1;2:SM<=50;4', 11],
    ['1,\n 4', 2, 2, '1,2:SM<=50\n 4', 10],
    ['1  4', 2, 2, '1 ;2:SM<=50; 4', 12]
  ].forEach(function (example) {
    const result = step.insert(example[0], example[1], example[2], '2:SM<=50');
    assert.strictEqual(result.text, example[3]);
    assert.strictEqual(result.caret, example[4]);
    assert.ok(presets.parsePreset(result.text).some(function (row) { return row.safe && row.isMp; }));
  });
});

test('Insert uses the editor input flow and Default failures leave its text intact', async () => {
  const vm = require('vm');
  const step = require('../../plugins/grimlite-parity/features/auto-attack/skill-step.js');
  const page = fs.readFileSync(path.join(__dirname,
    '../../plugins/grimlite-parity/features/auto-attack/auto-attack.html'), 'utf8');
  const nodes = {};
  function element() {
    return { value: '', dataset: {}, handlers: {}, options: [], selectedOptions: [{ dataset: {} }],
      addEventListener: function (name, fn) { this.handlers[name] = fn; },
      replaceChildren: function () { this.options = []; },
      appendChild: function (node) { this.options.push(node); },
      focus: function () {},
      setSelectionRange: function (start, end) { this.selectionStart = start; this.selectionEnd = end; },
      dispatchEvent: function (event) { this.handlers[event.type](event); }
    };
  }
  let timer;
  const drafts = [];
  let rejected = false;
  const api = {
    get: function () { return Promise.resolve({ className: 'Shaman', text: '1;4', presets: [] }); },
    draft: function (data) {
      drafts.push(data);
      return rejected ? Promise.reject(new Error('IPC unavailable')) : Promise.resolve({});
    },
    useDraft: function (data) {
      drafts.push(data);
      return rejected ? Promise.reject(new Error('IPC unavailable')) : Promise.resolve({ ok: false, error: 'disk full' });
    },
    useDefault: function () {
      return rejected ? Promise.reject(new Error('IPC unavailable')) : Promise.resolve({ ok: false, error: 'disk full' });
    }
  };
  vm.runInNewContext(page.match(/<script>([\s\S]*?)<\/script>/)[1], {
    window: { aquastarAutoAttack: api, autoAttackStep: step, addEventListener: function () {} },
    document: { getElementById: function (id) { return nodes[id] || (nodes[id] = element()); },
      createElement: element },
    Event: function (type) { this.type = type; },
    setTimeout: function (fn) { timer = fn; return 1; }, clearTimeout: function () { timer = null; }
  });
  await new Promise(setImmediate);
  nodes.stepSkill = element();
  nodes.stepSkill.value = '2';
  nodes.stepCondition.value = 'SM';
  nodes.stepComparator.value = '<=';
  nodes.stepThreshold.value = '50';
  nodes.stepCondition.handlers.change();
  assert.strictEqual(nodes.stepThreshold.disabled, false);
  nodes.skills.setSelectionRange(2, 2);
  nodes.insertStep.handlers.click();
  assert.strictEqual(nodes.skills.value, '1;2:SM<=50;4');
  assert.strictEqual(drafts.length, 0, 'insertion uses the existing debounce');
  timer();
  await new Promise(setImmediate);
  assert.strictEqual(drafts.length, 1);
  assert.strictEqual(drafts[0].text, nodes.skills.value);
  assert.strictEqual(drafts[0].className, 'Shaman');
  nodes.stepThreshold.value = '1.5';
  const before = nodes.skills.value;
  nodes.insertStep.handlers.click();
  assert.strictEqual(nodes.skills.value, before, 'invalid input never changes the draft');
  assert.ok(/percentage/.test(nodes.status.textContent));
  nodes.presets.value = '';
  nodes.presets.handlers.change();
  await new Promise(setImmediate);
  assert.strictEqual(nodes.skills.value, before);
  assert.strictEqual(nodes.status.textContent, 'disk full');
  rejected = true;
  nodes.presets.handlers.change();
  await new Promise(setImmediate);
  assert.strictEqual(nodes.skills.value, before);
  assert.strictEqual(nodes.status.textContent, 'IPC unavailable');
  nodes.skills.handlers.input();
  timer();
  await new Promise(setImmediate);
  assert.strictEqual(nodes.status.textContent, 'IPC unavailable', 'draft rejection is handled');
  nodes.presets.value = '__custom__';
  nodes.presets.handlers.change();
  await new Promise(setImmediate);
  assert.strictEqual(nodes.status.textContent, 'IPC unavailable', 'Use Draft rejection is handled');
  nodes.skills.value = '';
  nodes.useRotation.handlers.click();
  assert.strictEqual(nodes.status.textContent, 'Add at least one skill before using this rotation.');
  nodes.skills.value = before;
  nodes.useRotation.handlers.click();
  await new Promise(setImmediate);
  assert.strictEqual(nodes.status.textContent, 'IPC unavailable', 'apply button handles IPC errors');
  assert.strictEqual(drafts[drafts.length - 1].text, before, 'apply sends current editor text');
  assert.strictEqual(drafts[drafts.length - 1].className, 'Shaman');
  rejected = false;
  nodes.presets.handlers.change();
  await new Promise(setImmediate);
  assert.strictEqual(nodes.status.textContent, 'disk full', 'failed writes never show success');
  assert.strictEqual(nodes.skills.value, before);
  nodes.skills.value = '1;2;3;4';
  nodes.skills.setSelectionRange(2, 5);
  nodes.stepThreshold.value = '50';
  nodes.insertBlock.handlers.click();
  assert.strictEqual(nodes.skills.value, '1;if SM<=50 {\n2;3\n};4');
  const validBlock = nodes.skills.value;
  nodes.stepCondition.value = '';
  nodes.insertBlock.handlers.click();
  assert.strictEqual(nodes.skills.value, validBlock, 'block errors never mutate text');
  nodes.skills.value = '1;2;3;4';
  nodes.skills.setSelectionRange(2, 5);
  nodes.insertCooldown.handlers.click();
  assert.strictEqual(nodes.skills.value, '1;cooldown { 2;3 };4');
  nodes.waitDuration = element();
  nodes.waitDuration.value = '500';
  nodes.skills.setSelectionRange(0, 0);
  nodes.insertWait.handlers.click();
  assert.ok(nodes.skills.value.startsWith('wait 500ms;1;'));
  const validWait = nodes.skills.value;
  nodes.waitDuration.value = '60001';
  nodes.insertWait.handlers.click();
  assert.strictEqual(nodes.skills.value, validWait, 'invalid duration never mutates text');
  nodes.skills.setSelectionRange(0, 0);
  nodes.insertReady.handlers.click();
  assert.ok(nodes.skills.value.startsWith('ready 2;wait 500ms;'));
  assert.doesNotThrow(function () { presets.parsePreset(nodes.skills.value); });
  assert.ok(/class="block-builder"/.test(page));
  assert.ok(/class="wait-builder"/.test(page));
  assert.ok(/<details><summary>Syntax and behavior<\/summary>/.test(page));

});


test('disk-backed editor state survives store recreation per class without changing named presets', () => {
  const directory = fs.mkdtempSync(path.join(require('os').tmpdir(), 'auto-attack-drafts-'));
  const storage = require('../../res/platform/storage/namespaced-store.js');
  function fresh() {
    const store = storage.createNamespacedStore({ appDataDirectory: directory,
      pluginId: 'grimlite-parity' }).getStore(presets.STORE_NAMESPACE);
    return { store: store, source: presets.createPresetSource({ store: store, files: [] }) };
  }
  try {
    const first = fresh();
    first.source.savePreset('Shaman', 'Farm', '1;2');
    first.source.loadPreset('Shaman', 'Farm');
    first.source.setDraft(' shaman ', '3:SM<=50;4', 'Farm');
    first.source.setDraft('Mage', '4;3', null);
    const second = fresh();
    assert.strictEqual(second.source.draftFor('SHAMAN').name, 'Farm');
    assert.strictEqual(second.source.draftFor('Shaman').text, '3:SM<=50;4');
    assert.strictEqual(second.source.draftFor('mage').text, '4;3');
    assert.strictEqual(second.store.read().autoAttackPresets.SHAMAN.Farm, '1;2');
    second.source.savePreset('Shaman', 'Farm', '2;2');
    assert.strictEqual(fresh().source.draftFor('Shaman').text, '3:SM<=50;4', 'Save only updates the named preset');
    second.source.setDraft('Mage', '', null);
    assert.strictEqual(fresh().source.draftFor('Mage').text, '', 'empty editor text also survives');
    second.source.clearDraft('Shaman');
    assert.strictEqual(fresh().source.draftFor('Shaman'), null, 'Default survives store recreation');
    assert.strictEqual(fresh().source.draftFor('Mage').text, '', 'Default affects only its class');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('draft IPC write failures preserve accepted text and never apply the rejected rotation', async () => {
  const store = memoryStore();
  const source = presets.createPresetSource({ store: store, files: [] });
  source.setDraft('Shaman', '1;2', null);
  const handlers = {};
  const used = [];
  autoAttack.createAutoAttackWindow({ presets: source, onUse: function (text) { used.push(text); } })
    .register({ ipc: { handle: function (name, fn) { handlers[name] = fn; } } });
  store.write = function () { throw new Error('disk full'); };
  for (const channel of ['autoAttackSkillSetDraft', 'autoAttackSkillSetUseDraft']) {
    assert.deepStrictEqual(await handlers[channel](null, { className: 'Shaman', text: '4;3' }),
      { ok: false, error: 'disk full' });
    assert.strictEqual(source.draftFor('Shaman').text, '1;2');
    assert.strictEqual(presets.createPresetSource({ store: store, files: [] }).draftFor('Shaman').text, '1;2');
  }
  assert.deepStrictEqual(used, []);
});

test('Auto Attack parses blocks, cooldown skills and bounded waits without changing legacy rows', () => {
  assert.deepStrictEqual(presets.parsePreset('1; if SH<50 { 2;3:SM>=20 }; wait 500ms; ready 2; cooldown { 4;3 }'), [
    { index: '1', safe: false, wait: false },
    { type: 'if', isMp: false, op: '<', value: 50, skip: 4 },
    { index: '2', safe: false, wait: false },
    { index: '3', safe: true, isMp: true, op: '>=', value: 20, wait: false },
    { type: 'delay', ms: 500 }, { type: 'ready', index: '2' },
    { type: 'cooldown', index: '4' }, { type: 'cooldown', index: '3' }
  ]);
  assert.strictEqual(presets.parsePreset('wait;1;wait 1ms')[0].wait, true);
  ['if SH<50 { 1', 'if SH<50 1', 'if SH<50 {}', '1}', '{1}',
    'if SM>101 { 1 }', 'if SH<50 { if SM>20 { 1 } }', 'if SH<50 { 1 } else { 2 }',
    'cooldown { ready 1 }', 'cooldown { 5 }', 'wait 0ms', 'wait 60001ms',
    'wait -5ms', 'wait 1.5ms', 'ready 5', 'cooldown { 1 };garbage'].forEach(function (text) {
    assert.throws(function () { presets.parsePreset(text); }, Error, text);
  });
});

test('enhanced preset text survives recreation; malformed edits and saves never overwrite accepted state', () => {
  const store = memoryStore();
  const source = presets.createPresetSource({ store: store, files: [] });
  const text = '1;if SM>=30 { 2;wait 500ms;3 };ready 4;cooldown { 4 }';
  source.savePreset('Shaman', 'Boss', text);
  source.loadPreset('Shaman', 'Boss');
  const before = store.read();
  assert.throws(function () { source.setDraft('Shaman', 'if SH>50 { 1', null); }, /brace/);
  assert.throws(function () { source.savePreset('Shaman', 'Boss', 'cooldown { wait 1ms }'); }, /Cooldown/);
  assert.deepStrictEqual(store.read(), before);
  const restored = presets.createPresetSource({ store: store, files: [] }).draftFor('Shaman');
  assert.strictEqual(restored.name, 'Boss');
  assert.strictEqual(restored.text, text);
  assert.deepStrictEqual(restored.skills, presets.parsePreset(text));
});

test('block and wait builders validate before insertion and preserve surrounding steps', () => {
  const step = require('../../plugins/grimlite-parity/features/auto-attack/skill-step.js');
  const block = step.block('SH', '<=', '50', '2;3');
  assert.strictEqual(block, 'if SH<=50 {\n2;3\n}');
  const inserted = step.insert('1;2;3;4', 2, 5, block);
  assert.strictEqual(inserted.text, '1;if SH<=50 {\n2;3\n};4');
  assert.doesNotThrow(function () { presets.parsePreset(inserted.text); });
  assert.strictEqual(step.wait('500'), 'wait 500ms');
  assert.strictEqual(step.cooldown('2;3', '4'), 'cooldown { 2;3 }');
  assert.deepStrictEqual(presets.parsePreset(step.cooldown('2 3', '4')),
    [{ type: 'cooldown', index: '2' }, { type: 'cooldown', index: '3' }]);
  assert.throws(function () { step.cooldown('2:SH<50', '4'); }, /only skills/);
  assert.throws(function () { step.block('SH', '<=', '50', 'if SM>20 { 1 }'); }, /nested/);
  assert.throws(function () { step.insert('if SH<50 { 1;2 }', 11, 11, block); }, /nested/);
  assert.throws(function () { step.block('', '<=', '50', '2'); }, /HP or MP/);
  ['0', '60001', '1.5', '-1', ''].forEach(function (ms) {
    assert.throws(function () { step.wait(ms); }, /1 to 60000/);
  });
});
