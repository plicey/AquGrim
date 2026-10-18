// The Bot Manager's editing model (#36). Reference: Grimlite-Li 816d9cd,
// Grimoire/UI/BotManager.cs - the list switch (cbLists), the counters, MoveListItem /
// _MoveListBoxUp / _MoveListBoxDown, the Ctrl+D duplicate, the Ctrl+Shift+C and Ctrl+C
// clipboard shapes, the Ctrl+V paste, the wrapping search (btnSearchCmd_Click) and the label
// list. It edits the parsed document in place, so a save writes back the keys the file had.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bots = require('../../plugins/grimlite-parity/bot/bots.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');
const editor = require('../../plugins/grimlite-parity/bot/editor.js');

const FIXTURES = path.join(__dirname, '../fixtures/grimlite-bots');

function parse(name) {
  return bots.parseBot(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function typesOf(ed) {
  return ed.items().map((c) => catalog.classNameOf(c));
}

test('the editor opens on Commands and names every list the selector switches between', () => {
  const ed = editor.create(parse('plain.gbot').bot);
  assert.deepStrictEqual(ed.keys(), ['Commands', 'Skills', 'Quests', 'Drops', 'Boosts', 'Items']);
  assert.strictEqual(ed.selected, 'Commands', 'cbLists.SelectedIndex = 0');
  assert.deepStrictEqual(ed.counters(), { Commands: 3, Skills: 2, Quests: 0, Drops: 0, Boosts: 0, Items: 0 });
});

test('switching the selector changes the item list and the counters without touching the document', () => {
  const bot = parse('plain.gbot').bot;
  const before = JSON.stringify(bot);
  const ed = editor.create(bot);
  ed.selected = 'Skills';
  assert.strictEqual(ed.items(), bot.Skills);
  ed.selected = 'Drops';
  assert.strictEqual(ed.items(), bot.Drops);
  assert.strictEqual(JSON.stringify(bot), before, 'a list switch is a view, not an edit');
});

test('add appends, and insert-above puts the command at the selection', () => {
  const ed = editor.create(parse('plain.gbot').bot);
  const size = ed.items().length;
  ed.add(catalog.makeCommand('CmdDelay', { Delay: 500 }));
  assert.strictEqual(ed.items().length, size + 1);
  assert.strictEqual(catalog.classNameOf(ed.items()[size]), 'CmdDelay');

  ed.selected = 'Commands';
  ed.selection = [0];
  ed.add({ $type: catalog.fullType('CmdLogout') }, { insert: true });
  assert.strictEqual(catalog.classNameOf(ed.items()[0]), 'CmdLogout');
  assert.deepStrictEqual(ed.selection, [0]);
});

test('move walks one item and clamps at both ends, carrying the selection', () => {
  const ed = editor.create(parse('plain.gbot').bot);
  const before = typesOf(ed);
  ed.selection = [0];
  ed.move(-1);
  assert.deepStrictEqual(typesOf(ed), before, 'the first item cannot move up');
  assert.deepStrictEqual(ed.selection, [0]);

  ed.move(1);
  const moved = before.slice();
  moved.splice(1, 0, moved.shift());
  assert.deepStrictEqual(typesOf(ed), moved);
  assert.deepStrictEqual(ed.selection, [1], 'the selection follows the item');

  ed.selection = [ed.items().length - 1];
  ed.move(1);
  assert.deepStrictEqual(ed.selection, [ed.items().length - 1], 'the last item cannot move down');
});

test('move carries a multi-selection as one block', () => {
  const ed = editor.create(parse('plain.gbot').bot);
  const before = typesOf(ed);
  ed.selection = [0, 1];
  ed.move(-1);
  assert.deepStrictEqual(typesOf(ed), before, 'the first item pins the block');
  ed.move(1);
  assert.deepStrictEqual(typesOf(ed), [before[2], before[0], before[1]]);
  assert.deepStrictEqual(ed.selection, [1, 2]);
});

test('duplicate copies the selected block below itself and selects the copies', () => {
  const ed = editor.create(parse('plain.gbot').bot);
  ed.selection = [0, 1];
  const block = JSON.stringify(ed.items().slice(0, 2));
  ed.duplicate();
  assert.strictEqual(ed.items().length, 5);
  assert.strictEqual(JSON.stringify(ed.items().slice(2, 4)), block);
  assert.deepStrictEqual(ed.selection, [2, 3]);

  ed.duplicate();
  assert.strictEqual(ed.items().length, 7);
  assert.deepStrictEqual(ed.selection, [4, 5]);
});

test('remove takes out every selected index; clear takes the list, or all lists with all', () => {
  const ed = editor.create(parse('skill-sets.gbot').bot);
  const size = ed.items().length;
  ed.selection = [0, 2];
  ed.remove();
  assert.strictEqual(ed.items().length, size - 2);
  assert.deepStrictEqual(ed.selection, []);

  ed.clear();
  assert.strictEqual(ed.counters().Commands, 0);
  assert.strictEqual(ed.counters().Skills, 4, 'clear without the tickbox leaves the other lists');

  ed.add(catalog.makeCommand('CmdDelay'));
  ed.clear({ all: true });
  assert.deepStrictEqual(ed.counters(), { Commands: 0, Skills: 0, Quests: 0, Drops: 0, Boosts: 0, Items: 0 });
});

test('copy as text writes one display line per selected command, in list order', () => {
  const bot = parse('plain.gbot').bot;
  const ed = editor.create(bot);
  ed.selection = [2, 0, 1];
  const lines = ed.copyAsText().split('\n');
  assert.deepStrictEqual(lines, bot.Commands.map((c) => catalog.display(c)));
  assert.deepStrictEqual(lines, ['[START]', 'Join: [1x] ultradarkon-9099, Enter, Spawn', 'Goto label: START']);
});

test('copy as json writes a readable configuration and paste moves it to the lists', () => {
  const source = editor.create(parse('skill-sets.gbot').bot);
  source.selected = 'Drops';
  source.add('rusted key');
  source.selected = 'Commands';
  source.selection = [0, 1, 2];
  source.selected = 'Skills';
  source.selection = [0, 1, 2, 3];
  const clipboard = source.copyJson();
  const parsed = JSON.parse(clipboard);
  assert.strictEqual(parsed.$type, bots.CONFIGURATION_TYPE);
  assert.strictEqual(parsed.Drops.$values[0], 'rusted key');
  assert.strictEqual(parsed.Commands.$values.length, 3, 'the command list copies from its own selection');
  assert.strictEqual(parsed.Skills.$values.length, 4, 'each list copies from its own selection');

  const target = editor.create(parse('plain.gbot').bot);
  target.selection = [1];
  const size = target.items().length;
  assert.strictEqual(target.pasteJson(clipboard), true);
  assert.strictEqual(target.items().length, size + 3, 'the copied commands insert after the selection');
  assert.deepStrictEqual(typesOf(target).slice(2, 5), ['CmdEquipped', 'CmdSkillSet', 'CmdIndex']);
  assert.deepStrictEqual(target.object().Drops, ['rusted key']);
  assert.strictEqual(target.counters().Skills, 6, 'the other lists are appended, onto the two already there');
  target.pasteJson(clipboard);
  assert.deepStrictEqual(target.object().Drops, ['rusted key'], 'a drop already in the list is not added twice');
});

test('paste refuses anything that is not a bot, so the lists cannot be corrupted', () => {
  const ed = editor.create(parse('plain.gbot').bot);
  const before = JSON.stringify(ed.object());
  assert.strictEqual(ed.pasteJson('this is not a bot'), false);
  assert.strictEqual(JSON.stringify(ed.object()), before);
});

test('search walks the hits case-insensitively and wraps around the last one', () => {
  const bot = parse('plain.gbot').bot;
  const ed = editor.create(bot);
  assert.deepStrictEqual(bot.Commands.map((c) => catalog.display(c)),
    ['[START]', 'Join: [1x] ultradarkon-9099, Enter, Spawn', 'Goto label: START']);
  assert.strictEqual(ed.find('start'), 0);
  assert.strictEqual(ed.find('start'), 2, 'the same keyword walks to the next hit');
  assert.strictEqual(ed.find('start'), 0, 'and wraps around');
  assert.strictEqual(ed.find('nothing here'), null);
  assert.strictEqual(ed.find('label'), 2, 'a new keyword starts the walk again');
});

test('the label list is the CmdLabel commands in list order, in the reference display form', () => {
  const ed = editor.create(parse('plain.gbot').bot);
  assert.deepStrictEqual(ed.labels(), ['[START]']);
  ed.selection = [0];
  ed.remove();
  assert.deepStrictEqual(ed.labels(), []);
});

test('the property form and the raw editor write back to the same command', () => {
  const bot = parse('plain.gbot').bot;
  const ed = editor.create(bot);
  const index = 1;
  const original = bot.Commands[index];

  // The form only patches the keys it was given, so a key the file omitted stays omitted.
  assert.strictEqual(ed.replace(index, Object.assign({}, original, { Cell: 'r2' })), true);
  assert.strictEqual(bot.Commands[index].Cell, 'r2');
  assert.strictEqual(bot.Commands[index].$type, original.$type);
  assert.strictEqual(bot.Commands[index].Pad, 'Spawn');

  const raw = ed.replaceFromJson(index, JSON.stringify(Object.assign({}, bot.Commands[index], { Try: 3 })));
  assert.strictEqual(raw.ok, true);
  assert.strictEqual(bot.Commands[index].Try, 3);
  assert.strictEqual(catalog.display(bot.Commands[index]), 'Join: [3x] ultradarkon-9099, r2, Spawn');

  const refused = ed.replaceFromJson(index, '{ nonsense');
  assert.strictEqual(refused.ok, false);
  assert.ok(refused.error);
  assert.strictEqual(bot.Commands[index].Try, 3, 'an unreadable edit leaves the list alone');
});

test('a settings tick writes the configuration key the reference binds it to', () => {
  const bot = parse('plain.gbot').bot;
  const ed = editor.create(bot);
  ed.setSetting('BankOnStop', true);
  assert.strictEqual(bot.BankOnStop, true);
  ed.setSetting('WalkSpeed', 44);
  assert.strictEqual(bot.WalkSpeed, 44);
  assert.strictEqual(ed.setting('RestartUponDeath'), false, 'an untouched key reads the C# default');
  assert.strictEqual(bot.RestartUponDeath, undefined, 'and is not written into the document by a read');
  ed.setSetting('RestartUponDeath', true);
  assert.strictEqual(bot.RestartUponDeath, true);
});

test('loading a configuration replaces the lists, or appends with Merge', () => {
  const ed = editor.create(parse('plain.gbot').bot);
  const incoming = parse('skill-sets.gbot').bot;
  ed.applyConfiguration(incoming, { merge: false });
  assert.strictEqual(ed.counters().Commands, incoming.Commands.length);
  assert.strictEqual(ed.object().Skills.length, incoming.Skills.length);
  ed.applyConfiguration(incoming, { merge: true });
  assert.strictEqual(ed.counters().Commands, incoming.Commands.length * 2);
});

test('an edit saved back keeps the keys the file came with, and no others', () => {
  const text = fs.readFileSync(path.join(FIXTURES, 'plain.gbot'), 'utf8');
  const ed = editor.create(bots.parseBot(text).bot);
  ed.add(catalog.makeCommand('CmdDelay', { Delay: 1000 }));
  const out = bots.serializeBot(ed.object());
  assert.ok(out.indexOf('"Delay": 1000') !== -1);
  assert.ok(out.indexOf('"WalkSpeed": 20') !== -1, 'a key the file carried is written back');
  assert.strictEqual(text.indexOf('"BankOnStop"'), -1);
  assert.strictEqual(out.indexOf('"BankOnStop"'), -1,
    'a key absent because it equalled its default stays absent');
  assert.ok(out.indexOf('"$type": "' + catalog.fullType('CmdDelay') + '"') !== -1,
    'a command written here carries the type the reference resolves');
});
