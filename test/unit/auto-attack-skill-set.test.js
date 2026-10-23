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
    autoAttackSelectedPresets: { 'VOID HIGHLORD': 'Boss' }
  }, 'save stores the named class preset and leaves the old universal key untouched');
  assert.deepStrictEqual(used, ['1;2'], 'saving does not apply anything');

  await handlers.autoAttackPresetDelete(null, { className: 'Void Highlord', name: 'Boss' });
  assert.deepStrictEqual(store.read(), { autoAttackSkillSet: '1,2,4' });

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
  assert.strictEqual(fresh().draftFor('void highlord').text, '1;2', 'only the name survives restart');
  source.loadPreset('shaman', 'farm');
  assert.strictEqual(source.draftFor('Void Highlord').name, 'Boss');
  assert.strictEqual(source.draftFor('Void Highlord').text, '1;2', 'one transient draft, not one per class');
  assert.strictEqual(source.draftFor('SHAMAN').text, '2;4');
  assert.strictEqual(source.draftFor('Nobody'), null);
  assert.strictEqual(fresh().draftFor('Shaman').name, 'Farm');
  source.setDraft('Shaman', '4;3', null);
  assert.strictEqual(source.draftFor('Shaman').text, '4;3', 'custom draft wins for this session');
  assert.strictEqual(fresh().draftFor('Shaman').text, '2;4', 'custom text is never persisted');
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
  assert.strictEqual(fresh().draftFor('Shaman'), null);
  source.savePreset('Shaman', 'Farm', '4');
  assert.strictEqual(fresh().draftFor('Shaman'), null, 'recreating a deleted name does not select it');
  source.loadPreset('Shaman', 'Farm');
  source.setDraft('Shaman', '3;3', 'Farm');
  store.write({ autoAttackSelectedPresets: { SHAMAN: 'Farm' } });
  assert.strictEqual(source.draftFor('Shaman').name, null, 'externally missing preset unnames the draft');
  assert.strictEqual(source.draftFor('Shaman').text, '3;3', 'unsaved edits are preserved');
  assert.strictEqual(fresh().draftFor('Shaman'), null);
  source.savePreset('Shaman', 'Farm', '1');
  assert.strictEqual(fresh().draftFor('Shaman'), null, 'stale selection was cleared');
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
  assert.strictEqual(fresh(store).draftFor('Shaman'), null);
  config = 'SS.SHAMAN=4';
  assert.strictEqual(fresh(store).draftFor('Shaman'), null, 'missing file selection stays cleared');
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
