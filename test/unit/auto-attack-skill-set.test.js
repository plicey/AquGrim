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
    autoAttackPresets: { 'VOID HIGHLORD': { Boss: '2:SH>60;3,4' } }
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
