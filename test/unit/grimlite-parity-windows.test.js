// The parity plugin's small surfacing windows (ticket #25): Notepad, Eye Dropper and About.
// The reference is Grimlite-Li (Grimoire/UI/Notepad.cs, EyeDropper.cs, AboutForm.cs); the
// expected values below are computed from that C# source, not from the code under test.
const assert = require('assert');

const notepadDumps = require('../../plugins/grimlite-parity/features/notepad/dumps.js');

// Notepad.cs richTextBox1_TextChanged: the equipped class lowercased on line 1, then one
// "Skill-<i>" block per action, whose properties are printed in name order as
// "<name>:<value>, " with any name containing "desc" or "auras" left out.
test('the notepad skill dump matches the reference format, skipping desc and auras names', () => {
  const dump = notepadDumps.skillDump('Void Highlord', [
    { desc: 'not printed', skillID: 1, cooldown: 2, name: 'x', auras: [] },
    { sDesc: 'kept: .NET Contains is case-sensitive', range: 5 }
  ]);
  assert.strictEqual(
    dump,
    'void highlord' +
      '\r\nSkill-0\r\n' +
      'cooldown:2, name:x, skillID:1, ' +
      '\r\nSkill-1\r\n' +
      'range:5, sDesc:kept: .NET Contains is case-sensitive, '
  );
});

test('the notepad skill dump prints only the class name when the game returns no actions', () => {
  assert.strictEqual(notepadDumps.skillDump('Void Highlord', []), 'void highlord');
  assert.strictEqual(notepadDumps.skillDump('Void Highlord', null), 'void highlord');
  assert.strictEqual(notepadDumps.skillDump('', null), '');
});

test('the notepad skill dump prints an object value as JSON and skips any name containing auras', () => {
  // "auras2" is skipped because .NET Contains("auras") matches inside the name, and the
  // array-valued field that is kept is printed as JSON.
  assert.strictEqual(
    notepadDumps.skillDump('Paladin', [{ auras2: ['a', 'b'], perks: ['a', 'b'], tag: { k: 1 }, none: null }]),
    'paladin' + '\r\nSkill-0\r\n' + 'none:null, perks:["a","b"], tag:{"k":1}, '
  );
});

// Notepad.cs mapitems branch: "Player map items :" then one "[id] = value" per known id,
// with a missing value printed as null (Root.SaveRecentMapItemMerged writes that same shape).
test('the notepad map-item dump lists the ids it is given', () => {
  assert.strictEqual(
    notepadDumps.mapItemDump([[23725, 'Balmblossom (battleon)'], [7, null]]),
    'Player map items :\n[23725] = Balmblossom (battleon)\n[7] = null'
  );
});

test('the notepad map-item dump is just the header when nothing is known yet', () => {
  assert.strictEqual(notepadDumps.mapItemDump([]), 'Player map items :\n');
  assert.strictEqual(notepadDumps.mapItemDump(null), 'Player map items :\n');
});
