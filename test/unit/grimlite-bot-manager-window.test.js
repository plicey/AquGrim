// The Bot Manager window's main-process half (#36). Everything the page cannot do itself lives
// here: reading the sheet and the command catalog, building a command from the controls the user
// used, holding the parsed document, and reaching the file system, the dialogs and the store.
// Expected values come from the reference (Grimoire/UI/BotManager.cs and its designer): the
// counter strings, the AddCommand/Insert rule, the ctrl-click tree branch, the drag-and-drop
// guard, and the keymap handlers transcribed in bot/editor.js.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const bots = require('../../plugins/grimlite-parity/bot/bots.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');
const settings = require('../../plugins/grimlite-parity/bot/display-settings.js');
const manager = require('../../plugins/grimlite-parity/features/bot-manager/bot-manager.js');

const FIXTURES = path.join(__dirname, '../fixtures/grimlite-bots');

function memoryStore() {
  let value = undefined;
  return {
    read: function () { if (value === undefined) throw new Error('no store file yet'); return JSON.parse(JSON.stringify(value)); },
    write: function (next) { value = JSON.parse(JSON.stringify(next)); return next; },
    readOrCreate: function (create) { if (value === undefined) value = create(); return JSON.parse(JSON.stringify(value)); }
  };
}

function fixture(name) {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf8');
}

// The window as the plugin wires it, with the disk and the dialogs standing in for themselves.
function window(overrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-botmgr-'));
  const store = (overrides && overrides.store) || memoryStore();
  const deps = Object.assign({
    store: store,
    defaultBotsDirectory: dir,
    message: function () { return {}; },
    readText: function (file) { return fs.readFileSync(file, 'utf8'); },
    showOpenDialog: function () { return Promise.resolve({ canceled: true }); },
    showSaveDialog: function () { return Promise.resolve({ canceled: true }); },
    dialogs: {
      open: function () { return Promise.resolve({ canceled: true }); },
      save: function () { return Promise.resolve({ canceled: true }); }
    }
  }, overrides || {});
  return { feature: manager.createBotManager(deps), dir: dir, store: store };
}

// A bot on disk, opened the way the window's Open control does it.
function opened(name, overrides) {
  const w = window((overrides || {}).deps || {});
  const copy = path.join(w.dir, name);
  fs.writeFileSync(copy, fixture(name));
  // The Host's ipc.handle wraps whatever the feature returns, so a synchronous answer arrives as a
  // resolved promise at the page; the tests await it the same way.
  return Promise.resolve(w.feature.handle('botManagerLoad', null, [copy])).then(function (state) {
    return { feature: w.feature, dir: w.dir, store: w.store, state: state };
  });
}

test('the page gets the sheet and the statement catalog it has to draw', () => {
  const w = window();
  const sheet = w.feature.handle('botManagerSheet', null, []);
  assert.strictEqual(sheet.tabs.length, 11, 'the reference has eleven tabs');
  assert.deepStrictEqual(sheet.tabs.map((t) => t.title),
    ['Combat', 'Map', 'Item', 'Quest', 'Misc', 'Misc 2', 'Options', 'Client', 'Hunt', 'Bots', 'Info']);
  assert.ok(Array.isArray(sheet.column) && sheet.column.length, 'the left column travels with them');
  assert.deepStrictEqual(sheet.placeholders.txtMonster, 'Monster (* = random)');
  assert.deepStrictEqual(sheet.tags, catalog.STATEMENT_TAGS);
  assert.strictEqual(sheet.statements.length, 85);
  assert.strictEqual(sheet.optionsRunning, false, 'OptionsManager starts stopped like Grimlite');
  const hasOptionsControl = (control) => control.id === 'chkEnableSettings'
    ? control.text.replace(/\r\n/g, '\n') === 'Enable options\nwithout starting'
    : (control.children || []).some(hasOptionsControl);
  assert.ok(sheet.tabs.some((tab) => (tab.controls || []).some(hasOptionsControl)),
  'the reference exposes its loop control in Bot Manager');
  // The customiser's list, so the page can render it without the catalog.
  assert.deepStrictEqual(sheet.customisable.slice(0, 3), ['Index', 'Variable', 'ExtendedVariable']);
});

test('opening a bot gives the lists, the counters and the reference counter strings', async () => {
  const o = await opened('plain.gbot');
  const state = o.state;
  assert.strictEqual(state.canceled, false);
  assert.strictEqual(state.error, null);
  assert.deepStrictEqual(state.counters, { Commands: 3, Skills: 2, Quests: 0, Drops: 0, Boosts: 0, Items: 0 });
  // treeBots_AfterSelect: the six labels, with the command label split over two lines.
  assert.deepStrictEqual(state.labels, {
    commands: 'Number of\nCommands: 3', skills: 'Skills: 2', quests: 'Quests: 0',
    drops: 'Drops: 0', boosts: 'Boosts: 0', items: 'Items: 0'
  });
  assert.deepStrictEqual(state.lists.Commands.map((row) => row.text),
    ['[START]', 'Join: [1x] ultradarkon-9099, Enter, Spawn', 'Goto label: START']);
  assert.deepStrictEqual(state.lists.Skills.map((row) => row.text), ['1: Shackle', "2: Highlord's Gaze"],
    'Skill.ToString, which is what lstSkills shows');
  assert.strictEqual(state.selected, 'Commands');
  // The tab controls read the document's own values, with the C# defaults filled in.
  assert.strictEqual(state.configuration.SkillDelay, 150, 'the C# initialiser, absent from the file');
  assert.strictEqual(state.configuration.WalkSpeed, 20, 'the value the file carries');
  assert.strictEqual(state.author, '', 'txtAuthor is the file\'s own Author key');
});

test('a cancelled open is a cancellation, and a broken file is the reader message', async () => {
  const w = window();
  assert.deepStrictEqual(await w.feature.handle('botManagerLoad', null, [null]), { canceled: true });

  const file = path.join(w.dir, 'broken.gbot');
  fs.writeFileSync(file, 'not a bot');
  const state = await w.feature.handle('botManagerLoad', null, [file]);
  assert.strictEqual(state.canceled, false);
  assert.strictEqual(state.error, bots.ERRORS.parse);
  assert.strictEqual(state.counters.Commands, 0, 'a refused file leaves the previous document alone');
});

test('an add-button builds the command the reference builds and appends it', async () => {
  const o = await opened('plain.gbot');
  const state = await o.feature.handle('botManagerAdd', null, ['btnKill', { txtMonster: 'Dragon' }, {}]);
  assert.strictEqual(state.counters.Commands, 4);
  assert.strictEqual(o.feature.editor().items()[3].Monster, 'Dragon');

  // Insert (ctrl) and the variant (alt) are separate modifiers on the same button.
  await o.feature.handle('botManagerSelect', null, ['Commands', [0]]);
  const inserted = await o.feature.handle('botManagerAdd',
    null, ['btnJump', { txtCell: 'r2' }, { alt: true, ctrl: true }]);
  assert.strictEqual(catalog.classNameOf(o.feature.editor().items()[0]), 'CmdMoveToCell2');
  assert.deepStrictEqual(inserted.selection, [0]);
  assert.strictEqual(inserted.selected, 'Commands');
});

test('a button that needs a field it has not got contributes nothing', async () => {
  const o = await opened('plain.gbot');
  const before = o.feature.editor().items().length;
  const killFor = await o.feature.handle('botManagerAdd', null, ['btnKillF', { txtKillFItem: '' }, {}]);
  assert.strictEqual(o.feature.editor().items().length, before,
    'Kill for with no item adds nothing');
  assert.strictEqual(killFor.refused, true, 'and the page is told it did nothing');

  // btnAddCmdHunt is the one command button the reference guards: no item name, no command.
  const hunt = await o.feature.handle('botManagerAdd', null, ['btnAddCmdHunt', {}, {}]);
  assert.strictEqual(o.feature.editor().items().length, before);
  assert.strictEqual(hunt.refused, true, 'the page is told the button did nothing');
});

test('Kill for keeps its untouched quantity wildcard and whitelists the item', async () => {
  // The page shows "Quantity (* = any)" as a placeholder, so an untouched box sends no value.
  // The reference reads that visible text as "*", so the command and its Drops entry both stay.
  const o = await opened('plain.gbot');
  const state = await o.feature.handle('botManagerAdd', null, ['btnKillF', {
    txtKillFItem: 'Dragon Scale', txtKillFQ: '', txtKillFMon: '',
    rbItems: true, rbTemp: false, chkAddToWhiteList: true
  }, {}]);
  assert.strictEqual(state.refused, false);
  const last = o.feature.editor().items().pop();
  assert.strictEqual(catalog.classNameOf(last), 'CmdKillFor');
  assert.strictEqual(last.ItemType, 0, 'Items is the normal inventory');
  assert.strictEqual(last.Quantity, '*');
  assert.deepStrictEqual(o.feature.editor().object().Drops, ['Dragon Scale']);
});

test('a list button fills one of the other five lists, deduped where the reference dedupes', async () => {
  const o = await opened('plain.gbot');
  await o.feature.handle('botManagerAddList', null, ['btnWhitelist', { txtWhitelist: 'rusted key' }, {}]);
  assert.deepStrictEqual(o.feature.editor().object().Drops, ['rusted key']);
  await o.feature.handle('botManagerAddList', null, ['btnWhitelist', { txtWhitelist: 'rusted key' }, {}]);
  assert.deepStrictEqual(o.feature.editor().object().Drops, ['rusted key'], 'AddDrop checks Contains first');

  const both = await o.feature.handle('botManagerAddList', null, ['btnBoth', { txtWhitelist: 'gold' }, {}]);
  assert.deepStrictEqual(o.feature.editor().object().Items, ['gold']);
  assert.strictEqual(both.lists.Items[0].text, 'gold');

  const skills = await o.feature.handle('botManagerAddList', null, ['btnAddSafe',
    { numSkill: '5', numSafe: '70', cbSafeType: '>= Greater than' }, {}]);
  assert.strictEqual(skills.counters.Skills, 3);
  assert.strictEqual(skills.lists.Skills[2].text, '[HP >= 70%] 5: 5',
    'Skill.ToString with the index as the name until the bridge can read one');
});

test('Add Skill Set creates the label row, and Use Skill Set adds its command', async () => {
  const o = await opened('plain.gbot');

  const added = await o.feature.handle('botManagerAddList', null,
    ['btnAddSkillSet', { txtSkillSet: 'Nuke' }, {}]);
  assert.ok(added.lists.Skills.some(function (row) { return row.text === '[NUKE]'; }),
    'the label row belongs in Skills: ' + JSON.stringify(added.lists.Skills));

  const used = await o.feature.handle('botManagerAdd', null,
    ['btnUseSkillSet', { txtSkillSet: 'Nuke' }, {}]);
  assert.ok(used.lists.Commands.some(function (row) { return row.text === 'Skill Set: NUKE'; }),
    'Use Skill Set writes CmdSkillSet into Commands: ' + JSON.stringify(used.lists.Commands));
});

test('the keymap reaches the same document the buttons do', async () => {
  const o = await opened('plain.gbot');
  await o.feature.handle('botManagerSelect', null, ['Commands', [0]]);
  await o.feature.handle('botManagerKey', null, ['moveDown', {}]);
  assert.strictEqual(catalog.classNameOf(o.feature.editor().items()[1]), 'CmdLabel');

  const copied = await o.feature.handle('botManagerKey', null, ['copyAsText', {}]);
  assert.strictEqual(copied.clipboard, '[START]');

  const json = await o.feature.handle('botManagerKey', null, ['copyJson', {}]);
  assert.strictEqual(JSON.parse(json.clipboard).$type, bots.CONFIGURATION_TYPE);

  const pasted = await o.feature.handle('botManagerKey', null, ['paste', { text: json.clipboard }]);
  assert.strictEqual(pasted.counters.Commands, 4, 'the copied command lands after the selection');

  const duplicated = await o.feature.handle('botManagerKey', null, ['duplicate', {}]);
  assert.strictEqual(duplicated.counters.Commands, 5);
  const removed = await o.feature.handle('botManagerKey', null, ['remove', {}]);
  assert.strictEqual(removed.counters.Commands, 4);

  const found = await o.feature.handle('botManagerKey', null, ['find', { text: 'label' }]);
  assert.strictEqual(found.selection.length, 1);
  assert.strictEqual(found.selected, 'Commands', 'search always looks at the command list');

  const cleared = await o.feature.handle('botManagerKey', null, ['clear', { all: true }]);
  assert.deepStrictEqual(cleared.counters, { Commands: 0, Skills: 0, Quests: 0, Drops: 0, Boosts: 0, Items: 0 });
});

test('switching the list is a view of the same document', async () => {
  const o = await opened('plain.gbot');
  const state = await o.feature.handle('botManagerSelect', null, ['Skills', [1]]);
  assert.strictEqual(state.selected, 'Skills');
  assert.deepStrictEqual(state.selection, [1]);
  assert.strictEqual(state.lists.Skills[1].text, "2: Highlord's Gaze");
  assert.strictEqual(state.counters.Commands, 3, 'the counters are the whole document');
});

test('the property form and the raw editor write back, and a bad edit is refused', async () => {
  const o = await opened('plain.gbot');
  await o.feature.handle('botManagerSelect', null, ['Commands', [1]]);

  // The form the page draws is generated from the command's own keys; the edit comes back as one
  // object per key, and only those keys are written.
  const form = await o.feature.handle('botManagerForm', null, [1]);
  assert.deepStrictEqual(form.fields.map((f) => f.key),
    ['$type', 'Map', 'Cell', 'Pad', 'Try'].slice(1), 'the form skips $type, as Show() does');
  assert.strictEqual(form.fields[0].label, 'Map');
  assert.strictEqual(form.fields[0].value, 'ultradarkon-9099');

  const edited = await o.feature.handle('botManagerEdit', null, [1, { Map: 'bloodtitan' }]);
  assert.strictEqual(o.feature.editor().items()[1].Map, 'bloodtitan');
  assert.strictEqual(o.feature.editor().items()[1].Try, 1, 'a key the form did not touch is kept');
  assert.strictEqual(edited.lists.Commands[1].text, 'Join: [1x] bloodtitan, Enter, Spawn');

  const raw = await o.feature.handle('botManagerRaw', null, [1, JSON.stringify({ $type: catalog.fullType('CmdDelay'), Delay: 500 })]);
  assert.strictEqual(raw.ok, true);
  assert.strictEqual(catalog.classNameOf(o.feature.editor().items()[1]), 'CmdDelay');

  const refused = await o.feature.handle('botManagerRaw', null, [1, '{ nonsense']);
  assert.strictEqual(refused.ok, false);
  assert.ok(refused.error);
  assert.strictEqual(catalog.classNameOf(o.feature.editor().items()[1]), 'CmdDelay');
});

test('a statement form states the two labels the shipped catalog gives it', async () => {
  const o = await opened('skill-sets.gbot');
  await o.feature.handle('botManagerSelect', null, ['Commands', [0]]);
  const form = await o.feature.handle('botManagerForm', null, [0]);
  assert.deepStrictEqual(form.fields.map((f) => f.label), ['Item name', ''],
    'a statement with no second description gets an empty label, as the reference builds it');
  assert.strictEqual(form.fields[0].key, 'Value1');
});

test('a tab tickbox writes the Configuration key the reference binds it to, straight away', async () => {
  const o = await opened('plain.gbot');
  const state = await o.feature.handle('botManagerSetting', null, ['BankOnStop', true]);
  assert.strictEqual(o.feature.editor().object().BankOnStop, true);
  assert.strictEqual(state.configuration.BankOnStop, true);
  await o.feature.handle('botManagerSetting', null, ['WalkSpeed', 44]);
  assert.strictEqual(o.feature.editor().object().WalkSpeed, 44);
});

test('the Bot Manager Options checkbox controls the same loop as Grimlite and reflects hotkey changes', async () => {
  let applying = false;
  let feature;
  const options = {
    state: function () { return { applying: applying }; },
    setApplying: function (running) {
      applying = running === true;
      feature.optionsStateChanged(applying);
      return Promise.resolve({ ok: true, applying: applying });
    }
  };
  const sent = [];
  const sender = {
    isDestroyed: function () { return false; },
    send: function (channel, running) { sent.push({ channel: channel, running: running }); }
  };
  const w = window({ options: options, host: { pluginId: 'grimlite-parity' } });
  feature = w.feature;

  const sheet = feature.handle('botManagerSheet', { sender: sender }, []);
  assert.strictEqual(sheet.optionsRunning, false);
  const started = await feature.handle('botManagerOptionsEnable', { sender: sender }, [true]);
  assert.strictEqual(started.optionsRunning, true);
  assert.deepStrictEqual(sent, [{
    channel: 'plugin:grimlite-parity:botManagerOptionsState', running: true
  }]);

  // Grimlite's Toggle Options hotkey also moves the checkbox through OptionsManager.StateChanged.
  feature.optionsStateChanged(false);
  assert.strictEqual(sent[1].running, false);
});

test('the tabs read and write the same configuration the file has, defaults included', async () => {
  const o = await opened('legacy-keys.gbot');
  assert.strictEqual(o.state.configuration.DropDelay > 0 || o.state.configuration.DropDelay === undefined, true,
    'a key the current reference ignores still travels with the document');
  const saved = await o.feature.handle('botManagerSave', null, [{ path: path.join(o.dir, 'out.gbot') }]);
  assert.strictEqual(saved.error, null);
  const written = fs.readFileSync(path.join(o.dir, 'out.gbot'), 'utf8');
  assert.ok(written.indexOf('"DropDelay"') !== -1, 'it is written back, not normalised away');
});

test('the folder tree: the chosen directory, its count, one level at a time, and a bot on select', async () => {
  const w = window();
  fs.mkdirSync(path.join(w.dir, 'Arcana'));
  fs.writeFileSync(path.join(w.dir, 'Arcana', 'lovers.gbot'), fixture('plain.gbot'));
  fs.writeFileSync(path.join(w.dir, 'first.gbot'), fixture('skill-sets.gbot'));

  const listed = await w.feature.handle('botManagerTree', null, []);
  assert.strictEqual(listed.directory, w.dir, 'the store remembers no other directory yet');
  assert.strictEqual(listed.count, 2, 'Number of Bots counts every *.gbot below the root');
  assert.deepStrictEqual(listed.nodes.map((n) => n.name), ['Arcana', 'first.gbot']);
  assert.strictEqual(listed.nodes[0].lazy, 'Loading...');

  const expanded = await w.feature.handle('botManagerTree', null, [['Arcana']]);
  assert.deepStrictEqual(expanded.nodes.map((n) => n.name), ['lovers.gbot']);

  // Selecting a file loads it; ctrl-clicking adds a CmdLoadBot for it instead.
  const selected = await w.feature.handle('botManagerTreeSelect', null, [['first.gbot'], false]);
  assert.strictEqual(selected.counters.Commands, 3, 'skill-sets.gbot is on disk, so it opened');

  const ctrl = await w.feature.handle('botManagerTreeSelect', null, [['Arcana', 'lovers.gbot'], true]);
  const last = ctrl.lists.Commands[ctrl.lists.Commands.length - 1];
  assert.strictEqual(last.text, 'Load bot: lovers.gbot');
  const command = oLoadCommand(w.feature);
  assert.strictEqual(command.BotFileName, 'lovers.gbot');
  assert.strictEqual(command.BotFilePath, path.join('Bots', 'Arcana', 'lovers.gbot'));
  assert.strictEqual(catalog.classNameOf(command), 'CmdLoadBot');

  // Add folder makes it under the root and the count follows. A name that climbs out is refused.
  const added = await w.feature.handle('botManagerAddFolder', null, ['New Farm']);
  assert.strictEqual(fs.statSync(path.join(w.dir, 'New Farm')).isDirectory(), true);
  assert.strictEqual(added.error, null);
  const escaped = await w.feature.handle('botManagerAddFolder', null, [path.join('..', 'out')]);
  assert.ok(escaped.error, 'a folder outside the bots directory is refused');
});

function oLoadCommand(feature) {
  const commands = feature.editor().items();
  return commands.filter((c) => catalog.classNameOf(c) === 'CmdLoadBot').pop();
}

test('choosing another bots directory remembers it and re-lists from there', async () => {
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-otherbots-'));
  fs.writeFileSync(path.join(other, 'far.gbot'), fixture('plain.gbot'));
  const w = window({
    showOpenDialog: function (owner, options) {
      assert.ok(options.properties.indexOf('openDirectory') !== -1,
        'FolderBrowserDialog: a directory picker');
      return Promise.resolve({ canceled: false, filePaths: [other] });
    }
  });
  const chosen = await w.feature.handle('botManagerChooseDirectory', null, []);
  assert.strictEqual(chosen.directory, other);
  assert.strictEqual(chosen.count, 1);
  assert.deepStrictEqual(chosen.nodes.map((n) => n.name), ['far.gbot']);
  // The next window opens on the remembered directory, as ClientConfig C_BOTS_DIR does.
  const again = window({ store: w.store });
  assert.strictEqual((await again.feature.handle('botManagerTree', null, [])).directory, other);
});

test('dropping a bot file on the list loads it, and two files at once are ignored', async () => {
  const o = await opened('plain.gbot');
  const dropped = await o.feature.handle('botManagerDrop', null, [[path.join(FIXTURES, 'skill-sets.gbot')]]);
  assert.strictEqual(dropped.counters.Commands, 3);
  assert.strictEqual(dropped.error, null);

  const before = o.feature.editor().items().length;
  const many = await o.feature.handle('botManagerDrop', null, [['a.gbot', 'b.gbot']]);
  assert.strictEqual(many.refused, true, 'lstCommands_DragDrop: more than one file, nothing happens');
  assert.strictEqual(o.feature.editor().items().length, before);

  const missing = await o.feature.handle('botManagerDrop', null, [[path.join(o.dir, 'nope.gbot')]]);
  assert.ok(missing.error);
});

test('Merge appends instead of replacing, which is the reference chkMerge tickbox', async () => {
  const o = await opened('plain.gbot');
  await o.feature.handle('botManagerSetting', null, ['Merge', true]);
  await o.feature.handle('botManagerDrop', null, [[path.join(FIXTURES, 'skill-sets.gbot')]]);
  assert.strictEqual(o.feature.editor().items().length, 6);
});

test('a command row carries the colour and centring the customiser saved for its class', async () => {
  const o = await opened('plain.gbot');
  await o.feature.handle('botManagerStyle', null, [{ action: 'colour', name: 'CmdJoin', value: 'FF3A7FE0' }]);
  await o.feature.handle('botManagerStyle', null, [{ action: 'centered', name: 'CmdJoin', value: true }]);
  const styled = await o.feature.handle('botManagerStyle', null, [{ action: 'size', value: 100 }]);
  assert.strictEqual(styled.style.itemHeight, 25);
  assert.strictEqual(styled.style.fontSize, 18.5);
  assert.strictEqual(styled.lists.Commands[1].colour, 'FF3A7FE0');
  assert.strictEqual(styled.lists.Commands[1].centered, true);
  assert.strictEqual(styled.lists.Commands[0].colour, 'FFDCDCDC', 'an untouched class keeps the default');

  // And they persist: a second window sees them.
  const again = window({ store: o.store });
  await again.feature.handle('botManagerLoad', null, [path.join(FIXTURES, 'plain.gbot')]);
  const state = await again.feature.handle('botManagerStyle', null, [{ action: 'read' }]);
  assert.strictEqual(state.style.colours.JoinColor, 'FF3A7FE0');
  assert.strictEqual(state.style.commandsSize, 100);
});

test('saving goes through the dialogs and the writer, and a bad path is reported', async () => {
  const saves = [];
  const o = await opened('plain.gbot', { deps: { dialogs: {
    open: function () { return Promise.resolve({ canceled: true }); },
    save: function (owner, bot, options) { saves.push(options); return Promise.resolve({ canceled: false, path: '/tmp/out.gbot', error: null }); }
  } } });
  const saved = await o.feature.handle('botManagerSave', null, []);
  assert.strictEqual(saved.path, '/tmp/out.gbot');
  assert.strictEqual(saves.length, 1);

  // A fresh Bot Manager holds an empty document, and the reference's Save writes it: building a
  // bot from nothing is the ordinary way a bot starts.
  const fresh = window({ dialogs: {
    open: function () { return Promise.resolve({ canceled: true }); },
    save: function (owner, bot, options) {
      saves.push(options);
      return Promise.resolve({ canceled: false, path: '/tmp/new.gbot', error: null });
    }
  } });
  const nothing = await fresh.feature.handle('botManagerSave', null, []);
  assert.strictEqual(nothing.path, '/tmp/new.gbot', 'a fresh document can be saved');
  assert.strictEqual(saves.length, 2);
});

test('the window reaches its page only through its own namespaced channels', async () => {
  const w = window();
  const registered = [];
  w.feature.register({ ipc: { handle: function (channel) { registered.push(channel); } } });
  assert.deepStrictEqual(registered.slice().sort(), [
    'botManagerAdd', 'botManagerAddFolder', 'botManagerAddList', 'botManagerChooseDirectory',
    'botManagerBeep', 'botManagerCopy', 'botManagerDrop', 'botManagerGame', 'botManagerPaste',
    'botManagerEdit', 'botManagerForm', 'botManagerKey', 'botManagerLoad', 'botManagerMessages',
    'botManagerRaw', 'botManagerSave', 'botManagerSelect', 'botManagerSetting', 'botManagerSheet',
    'botManagerStatements', 'botManagerStyle', 'botManagerTree', 'botManagerTreeSelect',
    'botManagerEnable', 'botManagerOptionsEnable', 'botManagerSpecial', 'botManagerState',
    'botManagerOpenLink', 'botManagerPickBot'
  ].sort());

  const featureRoot = path.join(__dirname, '../../plugins/grimlite-parity/features/bot-manager');
  const page = fs.readFileSync(path.join(featureRoot, 'bot-manager.html'), 'utf8');
  assert.ok(page.indexOf('bot-manager-renderer.js') !== -1, 'the page loads its own renderer');
  const renderer = fs.readFileSync(path.join(featureRoot, 'bot-manager-renderer.js'), 'utf8');
  assert.ok(renderer.indexOf('aquastarBotManager') !== -1, 'the renderer uses the preload bridge');
  assert.strictEqual(renderer.indexOf('require('), -1, 'a sandboxed page requires nothing itself');
  const preload = fs.readFileSync(path.join(__dirname, '../../plugins/grimlite-parity/features/bot-manager/preload_bot_manager.js'), 'utf8');
  assert.ok(preload.indexOf("require('electron')") !== -1);
  assert.strictEqual(preload.indexOf("require('../.."), -1, 'no project requires in a sandboxed preload');
});

test('the static left-column buttons are wired to the editor actions', () => {
  const renderer = fs.readFileSync(path.join(__dirname,
    '../../plugins/grimlite-parity/features/bot-manager/bot-manager-renderer.js'), 'utf8');
  ['btnUp', 'btnDown', 'btnClear', 'btnRemove', 'btnSearchCmd'].forEach(function (id) {
    assert.ok(renderer.indexOf("'" + id + "'") !== -1,
      id + ' must be bound to a press action');
  });
  assert.ok(/\['btnUp', 'btnDown', 'btnClear', 'btnRemove', 'btnSearchCmd'\]/.test(renderer),
    'the static column buttons are wired together');
});

test('the bots directory this window shows is the one the bot engine resolves against', async () => {
  // The engine's CmdLoadBot resolves a relative path against the bots directory (#40), and this
  // window is where the user picks that directory. Two settings objects would each cache their own
  // copy of the store, so a directory chosen here would not reach a running bot; the plugin hands
  // this window the instance the engine already uses, and this asserts the seam carries it.
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-sharedbots-'));
  fs.writeFileSync(path.join(elsewhere, 'far.gbot'), fixture('plain.gbot'));
  const shared = settings.create({ store: memoryStore(), defaultBotsDirectory: '/default' });
  const w = window({ settings: shared });
  // A directory the engine's own instance holds is the directory this window lists - not the
  // default the window was given alongside it, which is what a second instance would use.
  shared.setBotsDirectory(elsewhere);
  const tree = w.feature.handle('botManagerTree', null, []);
  assert.strictEqual(tree.directory, elsewhere,
    'the window lists the directory the shared instance holds: ' + JSON.stringify(tree));
  // And conversely: a directory the window's own control sets is the one the engine would resolve
  // against, because both read the one instance.
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-sharedbots2-'));
  const w2 = window({
    settings: shared,
    showOpenDialog: function () { return Promise.resolve({ canceled: false, filePaths: [other] }); }
  });
  await w2.feature.handle('botManagerChooseDirectory', null, []);
  assert.strictEqual(shared.botsDirectory(), other,
    'the tree control writes the instance the engine resolves against');
});

test('the editor-only Client tab values travel with Start without entering the bot file', async () => {
  const starts = [];
  const w = window({
    runtime: {
      start: function (key, bot, editor) { starts.push(editor); return Promise.resolve({ ok: true }); },
      state: function () { return { running: true }; },
      stop: function () { return Promise.resolve({ ok: true }); }
    },
    currentWindowKey: function () { return 'game-window-1'; }
  });
  await w.feature.handle('botManagerSetting', null, ['InventOnStart', false]);
  await w.feature.handle('botManagerSetting', null, ['QuestDelay', 250]);
  await w.feature.handle('botManagerSetting', null, ['AutoCorrect', false]);
  await w.feature.handle('botManagerEnable', null, [true]);
  assert.strictEqual(starts.length, 1);
  assert.strictEqual(starts[0].inventOnStart, false);
  assert.strictEqual(starts[0].questDelay, 250);
  assert.strictEqual(starts[0].autoCorrect, false);
  assert.strictEqual(w.feature.bot().InventOnStart, undefined,
    'the save must not grow an InventOnStart key the reference never writes');
  assert.strictEqual(w.feature.bot().QuestDelay, undefined);
});

test('anti-mod watches staff frames only while a bot runs, then stops and logs out', async () => {
  let listener = null;
  const loggedOut = [];
  const stopped = [];
  const w = window({
    runtime: {
      start: function () { return Promise.resolve({ ok: true }); },
      state: function () { return { running: true }; },
      stop: function (key) { stopped.push(key); return Promise.resolve({ ok: true }); }
    },
    currentWindowKey: function () { return 'game-window-1'; },
    packets: {
      on: function (event, fn) {
        assert.strictEqual(event, 'frame');
        listener = fn;
        return function () { listener = null; };
      }
    },
    loaderCall: function (name) {
      if (name === 'Logout') loggedOut.push(name);
      return Promise.resolve(true);
    },
    logDebug: function () {}
  });
  await w.feature.handle('botManagerEnable', null, [true]);
  assert.ok(listener, 'starting a bot with anti-mod on subscribes to the tap');
  listener({ data: JSON.stringify({ params: { type: 'json', dataObj: {
    cmd: 'initUserDatas',
    a: [{ data: { strUsername: 'NotStaff', intAccessLevel: 10 } }]
  } } }) });
  assert.deepStrictEqual(stopped, [], 'an access level under 30 is not staff');
  listener({ data: JSON.stringify({ params: { type: 'json', dataObj: {
    cmd: 'initUserDatas',
    a: [{ data: { strUsername: 'StaffName', intAccessLevel: 60 } }]
  } } }) });
  assert.deepStrictEqual(stopped, ['game-window-1']);
  assert.deepStrictEqual(loggedOut, ['Logout']);
});

test('an Info link opens in the browser, and only web or mail links do', async () => {
  const opened = [];
  const w = window({ shell: { openExternal: function (url) { opened.push(url); return Promise.resolve(); } } });
  const web = await w.feature.handle('botManagerOpenLink', null, ['https://example.com/guide']);
  assert.deepStrictEqual(web, { ok: true });
  assert.deepStrictEqual(opened, ['https://example.com/guide']);
  const local = await w.feature.handle('botManagerOpenLink', null, ['file:///etc/passwd']);
  assert.strictEqual(local.ok, false);
  assert.deepStrictEqual(opened, ['https://example.com/guide'], 'a local file is refused');
});

test('Load (cmd) picks a file without loading it, and writes the reference relative path', async () => {
  const w = window({
    dialogs: {
      open: function () { return Promise.resolve({ canceled: false, path: path.join(w.dir, 'sub', 'x.gbot') }); },
      save: function () { return Promise.resolve({ canceled: true }); }
    }
  });
  const picked = await w.feature.handle('botManagerPickBot', null, []);
  assert.deepStrictEqual(picked, {
    canceled: false, path: path.join(w.dir, 'sub', 'x.gbot'),
    fileName: 'x.gbot', filePath: path.join('Bots', 'sub', 'x.gbot')
  });
});
