// The Bot Manager window's main-process half (#36): the per-command colours and font size the
// right-click menu persists, and the folder tree over the chosen bots directory. Expected values
// come from the reference's own code - Grimoire/UI/BotManager.cs (BotManager_Load, GetColor,
// UpdateTree, AddTreeNodes, treeBots_AfterSelect/AfterExpand) and Grimoire/UI/CommandColorForm.cs
// (the combo's contents, GetChecked, trackBar1_Scroll, btnSave) - not from the modules under test.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const settings = require('../../plugins/grimlite-parity/bot/display-settings.js');
const tree = require('../../plugins/grimlite-parity/bot/bot-tree.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');

// A store shaped like the platform's namespaced store, so this is the real persistence path.
function memoryStore() {
  let value = undefined;
  return {
    read: function () { if (value === undefined) throw new Error('no store file yet'); return JSON.parse(JSON.stringify(value)); },
    write: function (next) { value = JSON.parse(JSON.stringify(next)); return next; },
    readOrCreate: function (create) { if (value === undefined) value = create(); return JSON.parse(JSON.stringify(value)); }
  };
}

test('a command row uses the colour the reference reads for its class, ARGB hex on FF...', () => {
  const display = settings.create({ store: memoryStore() });
  assert.strictEqual(display.colour('CmdJoin'), 'FFDCDCDC', 'Config.Get(name + "Color") ?? "FFDCDCDC"');
  assert.strictEqual(display.centered('CmdJoin'), false, 'GetBoolCentered ?? "false"');

  display.setColour('CmdJoin', 'FF3A7FE0');
  assert.strictEqual(display.colour('CmdJoin'), 'FF3A7FE0');
  display.setCentered('CmdJoin', true);
  assert.strictEqual(display.centered('CmdJoin'), true);
});

test('the colour and centred keys are the class name without Cmd, suffixed (CommandColorForm)', () => {
  const store = memoryStore();
  const display = settings.create({ store: store });
  display.setColour('CmdKill', 'FF112233');
  display.setCentered('CmdKill', true);
  const state = store.read();
  assert.strictEqual(state.colours.KillColor, 'FF112233');
  assert.strictEqual(state.centered.KillCentered, true);
  // The three names that are not classes: they colour the variable and index segments of a row.
  display.setColour('Variable', 'FF00FF00');
  assert.strictEqual(store.read().colours.VariableColor, 'FF00FF00');
});

test('the font size is CommandsSize, and it lands on the item metrics the reference computes', () => {
  const display = settings.create({ store: memoryStore() });
  assert.strictEqual(display.commandsSize(), 60, 'c.Get("CommandsSize") ?? "60"');
  assert.strictEqual(display.fontFamily(), '');

  // BotManager_Load: itemHeight = int.Parse(value); font = itemHeight / 4 - 6.5; itemHeight /= 4.
  assert.deepStrictEqual(display.itemMetrics(), { itemHeight: 15, fontSize: 8.5 });
  display.setCommandsSize(100);
  assert.deepStrictEqual(display.itemMetrics(), { itemHeight: 25, fontSize: 18.5 });
  display.setFont('Arial');
  assert.strictEqual(display.fontFamily(), 'Arial');
});

test('a size outside the reference trackbar is clamped to the trackbar own range', () => {
  const display = settings.create({ store: memoryStore() });
  display.setCommandsSize(5);
  assert.strictEqual(display.commandsSize(), 20, 'trackBar1.Minimum = 20');
  display.setCommandsSize(500);
  assert.strictEqual(display.commandsSize(), 100, 'trackBar1.Maximum = 100');
});

test('the customiser offers every command class the reference enumerates, plus its three extras', () => {
  const display = settings.create({ store: memoryStore() });
  const names = display.customisableNames();
  assert.deepStrictEqual(names.slice(0, 3), ['Index', 'Variable', 'ExtendedVariable'],
    'comboBox1 adds these three before the classes');
  // Every IVBotCommand type: the command classes and the statement classes both implement it.
  assert.strictEqual(names.length, Object.keys(catalog.GROUPS).length + catalog.STATEMENTS.length + 3);
  assert.ok(names.indexOf('CmdJoin') !== -1);
  assert.ok(names.indexOf('CmdCellIs') !== -1, 'a statement is customisable too');
});

test('a store that will not parse falls back to the reference defaults instead of throwing', () => {
  const broken = { read: function () { throw new Error('bad json'); },
    write: function () { throw new Error('bad json'); },
    readOrCreate: function () { throw new Error('bad json'); } };
  const display = settings.create({ store: broken });
  assert.strictEqual(display.colour('CmdRest'), 'FFDCDCDC');
  assert.strictEqual(display.commandsSize(), 60);
  assert.doesNotThrow(function () { display.setColour('CmdRest', 'FF000000'); });
});

test('the folder tree lists one level at a time: folders, then this folder\'s .gbot files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-bottree-'));
  fs.mkdirSync(path.join(dir, 'Archmage'));
  fs.writeFileSync(path.join(dir, 'plain.gbot'), '{}');
  fs.writeFileSync(path.join(dir, 'not-a-bot.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'Archmage', 'nested.gbot'), '{}');

  const roots = tree.list(dir);
  assert.deepStrictEqual(roots, [
    { name: 'Archmage', type: 'folder', lazy: 'Loading...' },
    { name: 'plain.gbot', type: 'bot' }
  ], 'AddTreeNodes: folders first, each with a Loading... child, then *.gbot only');

  assert.deepStrictEqual(tree.list(path.join(dir, 'Archmage')), [{ name: 'nested.gbot', type: 'bot' }],
    'one level at a time: a folder\'s own contents, never the whole subtree');
  assert.deepStrictEqual(tree.list(path.join(dir, 'nope')), []);
  assert.strictEqual(tree.count(dir), 2, 'UpdateTree counts *.gbot across the whole subtree');
});

test('a tree selection is a path, and ctrl-click contributes a CmdLoadBot for it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-bottree-'));
  fs.mkdirSync(path.join(dir, 'Bots', 'Arcana'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'Bots', 'Arcana', 'lovers.gbot'), '{}');

  // treeBots_AfterSelect: Path.Combine(root, node.FullPath).
  const file = tree.resolve(dir, ['Bots', 'Arcana', 'lovers.gbot']);
  assert.strictEqual(file, path.join(dir, 'Bots', 'Arcana', 'lovers.gbot'));
  assert.strictEqual(tree.isBot(file), true);
  assert.strictEqual(tree.isBot(path.join(dir, 'Bots')), false);

  // The ctrl-click branch: "Bots" + the path below the root, and the file name beside it.
  assert.deepStrictEqual(tree.loadCommand(dir, file), {
    BotFileName: 'lovers.gbot',
    BotFilePath: path.join('Bots', 'Arcana', 'lovers.gbot')
  });
});

test('Add folder makes the directory under the root, and refuses to escape it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-bottree-'));
  assert.strictEqual(tree.addFolder(dir, 'Arcana'), path.join(dir, 'Arcana'));
  assert.strictEqual(fs.statSync(path.join(dir, 'Arcana')).isDirectory(), true);
  assert.strictEqual(tree.addFolder(dir, 'Arcana'), null, 'the reference only creates what is missing');
  assert.strictEqual(tree.addFolder(dir, ''), null);
  assert.strictEqual(tree.addFolder(dir, path.join('..', 'escape')), null,
    'a name that leaves the bots directory is refused');
  assert.strictEqual(fs.existsSync(path.join(path.dirname(dir), 'escape')), false);
});

test('the bots directory is remembered, and only the directory is', () => {
  const store = memoryStore();
  const display = settings.create({ store: store, defaultBotsDirectory: '/default/Bots' });
  assert.strictEqual(display.botsDirectory(), '/default/Bots', 'the reference falls back beside the exe');
  display.setBotsDirectory('/home/player/Bots');
  assert.strictEqual(display.botsDirectory(), '/home/player/Bots');
  assert.strictEqual(store.read().botsDirectory, '/home/player/Bots');
  assert.strictEqual(settings.STORE_NAMESPACE, 'botManager');
});
