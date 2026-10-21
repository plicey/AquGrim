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

test('the Auto Attack skill editor stores its own rotation without touching Bot Manager data', async () => {
  const store = memoryStore({ autoAttackPresets: { 'VOID HIGHLORD': '1;2' } });
  const handlers = {};
  const host = {
    ipc: { handle: function (name, fn) { handlers[name] = fn; } }
  };
  autoAttack.createAutoAttackWindow({ store: store }).register(host);

  assert.deepStrictEqual(handlers.autoAttackSkillSetGet(), { text: '' });
  const saved = handlers.autoAttackSkillSetSave(null, '2:SH>60;3,4');
  assert.strictEqual(saved.ok, true);
  assert.deepStrictEqual(store.read(), {
    autoAttackPresets: { 'VOID HIGHLORD': '1;2' },
    autoAttackSkillSet: '2:SH>60;3,4'
  }, 'the class presets survive and no Skills list is written');

  const source = presets.createPresetSource({ store: store, files: [] });
  assert.deepStrictEqual(source.custom().map(function (one) { return one.index; }), ['2', '3', '4']);
  assert.strictEqual(source.custom()[0].safe, true);
  assert.deepStrictEqual(source.forClass('Void Highlord').map(function (one) { return one.index; }),
    ['1', '2'], 'class presets remain independent');
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
  assert.ok(/require\((['"])electron\1\)/.test(preload));
  assert.ok(!/[^\w.]require\(['"](?!electron)/.test(preload), 'preloads may only require electron');
});
