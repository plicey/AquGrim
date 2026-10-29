// The eleven tabs (#36): every control the reference's designer puts in them, and what each
// add-button contributes. Reference: Grimoire/UI/BotManager.Designer.cs for the sheet and
// Grimoire/UI/BotManager.cs for the handlers. The expected texts and the expected commands come
// from those two files, not from the sheet under test.
const assert = require('assert');

const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');
const sheet = require('../../plugins/grimlite-parity/bot/tabs.js');
const tabs = sheet.TABS;
const column = sheet.COLUMN;
const actions = require('../../plugins/grimlite-parity/bot/tab-actions.js');

const EXPECTED_TITLES = ['Combat', 'Map', 'Item', 'Quest', 'Misc', 'Misc 2', 'Options', 'Client',
  'Hunt', 'Bots', 'Info'];

function find(id) {
  let found = null;
  function walk(list) {
    list.forEach(function (control) {
      if (control.id === id) found = control;
      if (control.children) walk(control.children);
    });
  }
  tabs.forEach(function (tab) { walk(tab.controls); });
  walk(column);
  return found;
}

function textsOf(tab) {
  const out = [];
  (function walk(list) {
    list.forEach(function (control) {
      if (control.text) out.push(control.text);
      if (control.children) walk(control.children);
    });
  })(tab.controls);
  return out;
}

function inputs(overrides) {
  return Object.assign({
    txtMonster: '', txtKillFMon: '', txtKillFItem: '', txtKillFQ: '',
    txtSkillSet: '', numSkill: '', numSafe: '', txtMonsterSkillCmd: '',
    txtCell: '', txtPad: '', txtJoin: '', txtJoinCell: '', txtJoinPad: '',
    numWalkX: '', numWalkY: '', numMapItem: '', tbShopId: '', tbShopName: '', tbShopItemId: '',
    tbItemId: '', numBuyQty: '', txtWhitelist: '', txtSwapBank: '', txtSwapInv: '', txtItem: '',
    numQuestListID: '', numQuestListItem: '', numQuestID: '', numQuestItem: '', numEnsureTries: '',
    txtLabel: '', txtPlayer: '', txtSetInt: '', numSetInt: '', numIndexCmd: '',
    txtStatement1: '', txtStatement2: '', txtPacket: '', numSpamTimes: '', numDelay: '',
    numBotDelay: '', numBeepTimes: '', tbBSLabel: '', tbBSPacket: '', numBSDelay: '',
    numSetFPS: '', tbLevel: '', txtLog: '', txtSoundItem: '',
    tbMapF: '', tbCellF: '', tbPadF: '', tbMonNameF: '', tbItemNameF: '', tbItemQtyF: '',
    txtAuthor: '', txtDescription: '', cmbSpecials: '', cbStatement: '', cbItemCmds: '',
    lstDrops: [], lstItems: [], lstBoosts: []
  }, overrides || {});
}

test('the eleven tabs are present, titled as the reference titles them, and in its order', () => {
  assert.deepStrictEqual(tabs.map((t) => t.title), EXPECTED_TITLES);
  assert.deepStrictEqual(tabs.map((t) => t.id),
    ['combat', 'map', 'item', 'quest', 'misc', 'misc2', 'options', 'client', 'hunt', 'bots', 'info']);
});

test('each tab holds the controls the reference puts in it', () => {
  const combat = textsOf(tabs[0]);
  ['Specific Skill Set', 'Rest', 'Kill for items', 'Skill Command', 'Rest fully',
    'Kill for [KF]', 'Leave combat', 'Stop attack', 'Add skill', 'Safe skill'].forEach(function (t) {
    assert.ok(combat.indexOf(t) !== -1, 'Combat tab is missing "' + t + '"');
  });
  assert.ok(textsOf(tabs[1]).indexOf('Set Spawnpoint') !== -1, 'Map tab');
  assert.ok(textsOf(tabs[2]).indexOf('Buy fast') !== -1, 'Item tab');
  assert.ok(textsOf(tabs[3]).indexOf('Complete (cmd)') !== -1, 'Quest tab');
  assert.ok(textsOf(tabs[4]).indexOf('Clear VarInt') !== -1, 'Misc tab');
  assert.ok(textsOf(tabs[5]).indexOf('Overall \r\nDelay') !== -1, 'Misc 2 tab');
  assert.ok(textsOf(tabs[6]).indexOf('Options Timer') !== -1, 'Options tab');
  assert.ok(textsOf(tabs[7]).indexOf('Gender swap') !== -1, 'Client tab');
  assert.ok(textsOf(tabs[8]).indexOf('Add Command') !== -1, 'Hunt tab');
  assert.ok(textsOf(tabs[9]).indexOf('Number of Bots:') !== -1, 'Bots tab');
  assert.ok(textsOf(tabs[10]).indexOf('Test here') !== -1, 'Info tab');

  // The reference's Rest box rows: Rest / Rest fully, then "Rest if", then HP and MP.
  assert.deepStrictEqual(find('darkGroupBox19').children.map(function (control) { return control.id; }), [
    'btnRest', 'btnRestF', 'label12', 'chkHP', 'numRest', 'label10', 'chkMP', 'numRestMP', 'label11'
  ]);
  assert.ok(/once/i.test(find('btnRest').title), 'Rest is the one-shot command');
  assert.ok(/full/i.test(find('btnRestF').title), 'Rest fully is the full-rest command');

  // Every page keeps the designer's coordinates for every control, not just the Combat tab.
  tabs.forEach(function (tab) {
    assert.ok(tab.layout, tab.id + ' has a designer layout');
    assert.deepStrictEqual([tab.layout.width, tab.layout.height], [544, tab.id === 'bots' ? 314 : 298]);
    const missing = [];
    (function walk(list) {
      (list || []).forEach(function (control) {
        if (control.id && !tab.layout.positions[control.id]) missing.push(control.id);
        walk(control.children);
      });
    })(tab.controls);
    assert.deepStrictEqual(missing, [], tab.id + ' controls without a reference position');
  });

  assert.deepStrictEqual(find('cbCategories').options,
    ['Aura', 'Item', 'This player', 'Player', 'Map', 'Monster', 'Quest', 'Misc']);
  assert.deepStrictEqual(find('lstLogText').options.slice(0, 3), ['{USERNAME}', '{MAP}', '{GOLD}']);
  assert.deepStrictEqual(find('cmbSpecials').options.slice(0, 2),
    ['Auto Zone - Ultradage', 'Auto Zone - Dark Carnax']);
});

test('the reference list selector values are the six lists the editor switches between', () => {
  assert.deepStrictEqual(find('cbLists').options,
    ['Commands', 'Skills', 'Quests', 'Drops', 'Boosts', 'Items']);
  // The reference's three single-selection list boxes; the six bot lists are MultiExtended.
  ['lbLabels', 'lstLogText', 'lstSoundItems'].forEach(function (id) {
    assert.strictEqual(find(id).kind, 'list', id + ' is a ListBox');
    assert.strictEqual(find(id).single, true, id + ' is SelectionMode.One');
  });
  assert.strictEqual(find('numWalkSpeed').min, 1);
  assert.strictEqual(find('numWalkSpeed').max, 99);
  assert.strictEqual(find('txtDescription').multiline, true);
  assert.strictEqual(find('txtLog').multiline, true);
  assert.strictEqual(find('txtSavedDesc').multiline, true);
  assert.strictEqual(find('txtSavedDesc').readonly, true);
});

test('a command is built from the tab fields the reference reads', () => {
  assert.deepStrictEqual(actions.build('btnKill', inputs({ txtMonster: 'Dragon' }), {}),
    { $type: catalog.fullType('CmdKill'), Monster: 'Dragon' });
  assert.strictEqual(actions.build('btnKill', inputs({ txtMonster: 'Monster (* = random)' }), {}).Monster, '*');
  assert.strictEqual(actions.build('btnKill', inputs({}), {}).Monster, '*');

  assert.deepStrictEqual(actions.build('btnJump', inputs({ txtCell: 'r2' }), {}),
    { $type: catalog.fullType('CmdMoveToCell'), Cell: 'r2', Pad: 'Spawn' });
  assert.deepStrictEqual(actions.build('btnJoin', inputs({ txtJoin: 'battleon-1e99' }), {}),
    { $type: catalog.fullType('CmdJoin'), Map: 'battleon-1e99', Cell: 'Enter', Pad: 'Spawn', Try: 1 });
  // cbJoinMapSwf unchecked is the property's own initialiser, so no key is written; the map SWF
  // is written only when the tickbox is on and the box does not already hold the swf placeholder.
  assert.strictEqual(actions.build('btnJoin', inputs({ txtJoin: 'x' }), {}).MapSwf, undefined);
  assert.strictEqual(actions.build('btnJoin',
    inputs({ txtJoin: 'x', cbJoinMapSwf: true, tbJoinMapSwf: 'ChiralValley/map.swf' }), {}).MapSwf,
    'ChiralValley/map.swf');
  assert.strictEqual(actions.build('btnJoin',
    inputs({ txtJoin: 'x', cbJoinMapSwf: true, tbJoinMapSwf: 'ChiralValley/map(.swf)' }), {}).MapSwf,
    undefined, 'a box still holding the swf placeholder contributes nothing');
});

test('ctrl inserts above, and alt flips the variant the reference flips', () => {
  assert.strictEqual(actions.build('btnQuestAccept', inputs({ numQuestID: '8814' }), {}).ghostAccept, false);
  assert.strictEqual(actions.build('btnQuestAccept', inputs({ numQuestID: '8814' }), { alt: true }).ghostAccept,
    true, 'alt makes it a ghost accept');
  assert.strictEqual(actions.build('btnQuestComplete', inputs({ numQuestID: '8814' }), { alt: true }).CompleteTry,
    -1, 'alt completes as many as it can');
  assert.strictEqual(actions.build('btnItem', inputs({ txtItem: 'ore', cbItemCmds: 'Sell' }), {}).Qty, '1');
  assert.strictEqual(actions.build('btnItem', inputs({ txtItem: 'ore', cbItemCmds: 'Sell' }), { alt: true }).Qty, '0',
    'alt sells all of it');
  assert.strictEqual(actions.build('btnJump', inputs({ txtCell: 'r2' }), { alt: true }).$type,
    catalog.fullType('CmdMoveToCell2'), 'alt jumps a set of cells instead of walking to one');
  assert.strictEqual(actions.build('btnAddCmdHunt', inputs({ tbItemNameF: 'x', tbItemQtyF: '3' }), { alt: true }).$type,
    catalog.fullType('CmdQuestHunt'), 'alt uses the quest hunt');
  assert.deepStrictEqual(actions.build('btnSetInt', inputs({ txtSetInt: 'i' }), { alt: true }).map(function (cmd) {
    return cmd.$type;
  }), [catalog.fullType('CmdInt2'), catalog.fullType('CmdInt')],
  'alt sets an int from a resolvable value and then sets it too');
  assert.strictEqual(actions.build('btnWalkRdm', inputs({ numWalkX: '1' }), {}).Type, 'Random');
  assert.strictEqual(actions.build('btnWhitelistToggle', inputs({}), {}).state, 2);
  assert.strictEqual(actions.build('btnWhitelistOn', inputs({}), {}).state, 0);
  assert.strictEqual(actions.build('btnWhitelistOff', inputs({}), {}).state, 1);
});

test('every add-button the reference wires has a builder, and every builder has a button', () => {
  const ids = new Set();
  (function walk(list) {
    list.forEach(function (control) {
      ids.add(control.id);
      if (control.children) walk(control.children);
    });
  })(tabs.reduce((all, tab) => all.concat(tab.controls), []));
  (function walk(list) {
    list.forEach(function (control) {
      ids.add(control.id);
      if (control.children) walk(control.children);
    });
  })(column);

  Object.keys(actions.COMMAND_BUTTONS).forEach(function (id) {
    assert.ok(ids.has(id), 'tab-actions builds a command for a control no tab has: ' + id);
  });
  const wired = ['btnAttack', 'btnKill', 'btnRest', 'btnRestF', 'btnKillF', 'btnStop', 'btnRestart',
    'btnUseSkillSet', 'btnLeaveCombat', 'btnStopAttack', 'btnSkillCmd', 'btnSetSpawn', 'btnWalk',
    'btnWalkRdm', 'btnJump', 'btnJoin', 'btnMapItem', 'btnItem', 'btnSwap',
    'btnWhitelistOn', 'btnWhitelistOff', 'btnWhitelistToggle', 'btnLoadShop',
    'btnBuy', 'btnBuyFast', 'btnAddQuestList', 'btnRemoveQuestList',
    'btnQuestComplete', 'btnQuestAccept', 'btnClearVarInt', 'ButtonTC_Start', 'ButtonTC_Stop',
    'btnFollowCmd', 'btnAddLabel', 'btnGotoLabel', 'btnGoto', 'btnSetInt', 'btnIncreaseInt',
    'btnDecreaseInt', 'btnReturnCmd', 'btnGotoIndex', 'btnGoUpIndex', 'btnGoDownIndex',
    'btnProvokeOn', 'btnProvokeOff', 'btnBlank', 'btnLogout', 'btnBeep', 'btnDelay',
    'btnStatementAdd', 'btnPacket', 'btnClientPacket', 'btnSpecialStart', 'btnSpecialStop',
    'btnSpecialSwitch', 'btnBotDelay', 'btnBSAdd', 'btnBSStop', 'btnLog', 'btnLogDebug',
    'btnSetFPSCmd', 'btnSetLevelCmd', 'btnAddInfoMsg', 'btnAddWarnMsg', 'btnChangeNameCmd',
    'btnChangeGuildCmd', 'btnAddCmdHunt', 'btnLoadCmd'];
  wired.forEach(function (id) {
    assert.ok(actions.COMMAND_BUTTONS[id], 'no builder for ' + id);
  });

  // The buttons the reference points at the other five lists rather than at Commands.
  ['btnAddSkill', 'btnAddSafe', 'btnAllSkill', 'btnWhitelist', 'btnBoth', 'btnUnbanklst',
    'btnQuestAdd', 'btnBoost'].forEach(function (id) {
    assert.ok(actions.LIST_BUTTONS[id], 'no list builder for ' + id);
    assert.ok(ids.has(id), 'a list builder names a control no tab has: ' + id);
  });
});

test('a list button contributes the rows the reference puts in each of the other lists', () => {
  // Add skill: SkillType.Normal with the index box, the name only when the bridge has one.
  assert.deepStrictEqual(actions.buildList('btnAddSkill', inputs({ numSkill: '3' }), {}), [{
    list: 'Skills',
    items: [{ $type: 'Grimoire.Game.Data.Skill, Grimoire', Index: '3', Type: 0 }]
  }]);
  assert.deepStrictEqual(
    actions.buildList('btnAddSkill', inputs({ numSkill: '3', skillNames: { 3: 'Flux' } }), {})[0].items[0].Text,
    'Flux');
  assert.strictEqual(actions.buildList('btnAddSkill', inputs({ numSkill: '2' }), { alt: true })[0].items[0].waitCd,
    true, 'alt is the reference waitCd flag');

  // All: the four indices, in order, each a normal skill.
  assert.deepStrictEqual(actions.buildList('btnAllSkill', inputs({}), {})[0].items.map((s) => s.Index),
    ['1', '2', '3', '4']);

  // Safe skill: SkillType.Safe with the safe percentage, the HP/MP box and the comparison.
  assert.deepStrictEqual(actions.buildList('btnAddSafe', inputs({ numSkill: '5', numSafe: '70' }), {}), [{
    list: 'Skills',
    items: [{ $type: 'Grimoire.Game.Data.Skill, Grimoire', Index: '5', Type: 1, SafeValue: 70, SType: 0, IsSafeMp: false }]
  }]);
  assert.strictEqual(actions.buildList('btnAddSafe',
    inputs({ numSafe: '40', cbSafeType: '>= Greater than', chkSafeMp: true }), {})[0].items[0].SType, 1);
  assert.strictEqual(actions.buildList('btnAddSafe',
    inputs({ numSafe: '40', cbSafeType: '>= Greater than', chkSafeMp: true }), {})[0].items[0].IsSafeMp, true);

  // Add to whitelist / Add to Unbank list / Add to both: the Drops and Items string lists, each
  // guarded against a duplicate.
  assert.deepStrictEqual(actions.buildList('btnWhitelist', inputs({ txtWhitelist: 'rusted key' }), {}),
    [{ list: 'Drops', items: ['rusted key'], unique: true }]);
  assert.deepStrictEqual(actions.buildList('btnUnbanklst', inputs({ txtWhitelist: 'rusted key' }), {}),
    [{ list: 'Items', items: ['rusted key'], unique: true }]);
  assert.deepStrictEqual(actions.buildList('btnBoth', inputs({ txtWhitelist: 'rusted key' }), {}).map((g) => g.list),
    ['Drops', 'Items']);

  // Add to quest list: the Quest row, whose Text is "id" or "id:item".
  assert.deepStrictEqual(actions.buildList('btnQuestAdd', inputs({ numQuestListID: '8814' }), {}), [{
    list: 'Quests',
    items: [{ $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: 8814, SafeRelogin: false, Text: '8814' }],
    unique: true
  }]);
  assert.strictEqual(actions.buildList('btnQuestAdd',
    inputs({ numQuestListID: '8814', chkQuestListItem: true, numQuestListItem: '5', chkReloginCompleteQuest: true }),
    {})[0].items[0].Text, '8814:5');

  // Add Command's "Add to whitelist" fetches the item names into Drops first.
  assert.deepStrictEqual(actions.buildLists('btnAddCmdHunt',
    inputs({ tbItemNameF: 'ore, key', chkAddToWhitelistF: true }), {}),
    [{ list: 'Drops', items: ['ore', ' key'], unique: true, insensitive: true }]);
  assert.deepStrictEqual(actions.buildLists('btnAddCmdHunt', inputs({ tbItemNameF: 'ore' }), {}), []);

  // Add boost: the object the game sent, which is what the reference adds; nothing without one,
  // and nothing from a box the reference would have refused (an empty item name).
  const boost = { $type: 'Grimoire.Game.Data.InventoryItem, Grimoire', Name: 'Scroll of Might' };
  assert.deepStrictEqual(actions.buildList('btnBoost', inputs({ cbBoostsSelected: boost }), {}),
    [{ list: 'Boosts', items: [boost] }]);
  assert.deepStrictEqual(actions.buildList('btnBoost', inputs({}), {}), []);
  assert.deepStrictEqual(actions.buildList('btnWhitelist', inputs({}), {}), [],
    'the reference guards an empty item name out');
});

test('a settings control writes the Configuration key the reference binds it to', () => {
  const expected = {
    chkBankOnStop: 'BankOnStop', chkPickup: 'EnablePickup', chkReject: 'EnableRejection',
    chkPickupAll: 'EnablePickupAll', chkPickupAcTag: 'EnablePickupAcTagged',
    chkRestartDeath: 'RestartUponDeath', chkRestartAFK: 'RestartOnAFK', chkRelog: 'AutoRelogin',
    chkRelogRetry: 'RelogRetryUponFailure', chkSkip: 'SkipDelayIndexIf', chkFollowOnly: 'FollowCheck',
    chkInfiniteRange: 'InfiniteAttackRange', chkProvoke: 'ProvokeMonsters', chkLag: 'LagKiller',
    chkMagnet: 'EnemyMagnet', chkHidePlayers: 'HidePlayers', chkSkipCutscenes: 'SkipCutscenes',
    chkDisableAnims: 'DisableAnimations', chkAFK: 'AFK', chkAntiCounter: 'AntiCounter',
    chkAllSkillsCD: 'WaitForAllSkills', chkSkillCD: 'WaitForSkill',
    chkExistQuest: 'ExitCombatBeforeQuest', chkExitRest: 'ExitCombatBeforeRest',
    chkHP: 'RestIfHp', chkMP: 'RestIfMp', chkRespawnProvoke: 'respawnProvoke'
  };
  Object.keys(expected).forEach(function (id) {
    assert.strictEqual(actions.SETTINGS[id], expected[id], id);
  });
});

test('a numeric control writes the Configuration key the reference binds it to', () => {
  const expected = {
    numSkillD: 'SkillDelay', numBotDelay: 'BotDelay', numRelogDelay: 'RelogDelay',
    numRest: 'RestHp', numRestMP: 'RestMp', numWalkSpeed: 'WalkSpeed',
    numOptionsTimer: 'optionDelay'
  };
  Object.keys(expected).forEach(function (id) {
    assert.strictEqual(actions.NUMBERS[id], expected[id], id);
  });
});

test('the statement dropdown is the shipped catalog, grouped by its own category tags', () => {
  assert.deepStrictEqual(catalog.STATEMENT_TAGS, find('cbCategories').options);
  assert.strictEqual(actions.statementCategories().length, 8);
  const expected = catalog.STATEMENTS.filter((s) => s.tag === 'Map').map((s) => s.text);
  assert.deepStrictEqual(actions.statementsIn('Map').map((s) => s.text), expected);
  assert.ok(actions.statementsIn('Map').length >= 4);
  assert.strictEqual(catalog.STATEMENTS.length, 85, 'the shipped catalog has 85 rows');
});

test('a statement is built with the three fields the reference always carries', () => {
  assert.deepStrictEqual(actions.buildStatement('CmdCellIs', { txtStatement1: 'Enter' }, {}), {
    $type: 'Grimoire.Botting.Commands.Misc.Statements.CmdCellIs, Grimoire',
    Tag: 'Map',
    Text: 'Cell is',
    Value1: 'Enter',
    Value2: ''
  });
});
