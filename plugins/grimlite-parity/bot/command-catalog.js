// The bot vocabulary: every command and statement class the reference client declares, its
// display text (the C# ToString, which is what the list, the search and copy-as-text show) and
// the labels its generated property form uses. Reference: Grimlite-Li 816d9cd,
// Grimoire/Botting/Commands/**.cs plus Resources/statementcmds.txt (the shipped statement
// catalog the reference loads for its dropdown).
//
// The reference generates the property form from the command's own JSON keys and only labels
// them (UserFriendlyCommandEditor.Show), so the labels here are the only per-command knowledge
// the form needs. DISPLAY ports each class's ToString, because that text is user-visible: it is
// the list row, what search matches, and what copy-as-text puts on the clipboard.

const SUFFIX = ', Grimoire';
const ROOT = 'Grimoire.Botting.Commands.';

/** Short class name of a command object, e.g. "CmdJoin". */
function classNameOf(command) {
    const type = command && command.$type;
    if (typeof type !== 'string') return '';
    return type.split(',')[0].split('.').pop();
}

function fullType(className) {
    const group = GROUPS[className];
    if (!group) throw new Error('[AquaStar:grimlite-parity] unknown command class: ' + className);
    return ROOT + group + '.' + className + SUFFIX;
}

// Which namespace each class lives in, as the reference writes it. A .gbot that names the wrong
// namespace throws inside the client's deserialiser, so this table is what makes the writer safe.
const GROUPS = {
    CmdAttack: 'Combat', CmdCancelTarget: 'Combat', CmdFollow: 'Combat', CmdKill: 'Combat',
    CmdKillFor: 'Combat', CmdQuestHunt: 'Combat', CmdRest: 'Combat', CmdShortHunt: 'Combat',
    CmdSkillSet: 'Combat', CmdUseSkill: 'Combat',
    CmdBankSwap: 'Item', CmdBankTransfer: 'Item', CmdBuy: 'Item', CmdBuyBack: 'Item',
    CmdBuyFast: 'Item', CmdEquip: 'Item', CmdEquipSet: 'Item', CmdGetDrop: 'Item',
    CmdLoad: 'Item', CmdLoadTravel: 'Item', CmdMapItem: 'Item', CmdSell: 'Item',
    CmdWhitelist: 'Item',
    CmdJoin: 'Map', CmdMoveToCell: 'Map', CmdMoveToCell2: 'Map', CmdSetSpawn: 'Map',
    CmdTravel: 'Map', CmdWalk: 'Map', CmdYulgar: 'Map',
    CmdBackgroundPacket: 'Misc', CmdBankList: 'Misc', CmdBeep: 'Misc', CmdBlank: 'Misc',
    CmdBlank2: 'Misc', CmdBlank3: 'Misc', CmdBotDelay: 'Misc', CmdChange: 'Misc',
    CmdClearTemp: 'Misc', CmdClientMessage: 'Misc', CmdDelay: 'Misc', CmdGotoLabel: 'Misc',
    CmdGotoPlayer: 'Misc', CmdIndex: 'Misc', CmdInt: 'Misc', CmdInt2: 'Misc', CmdLabel: 'Misc',
    CmdLoadBot: 'Misc', CmdLog: 'Misc', CmdLogout: 'Misc', CmdPacket: 'Misc',
    CmdPacketDelay: 'Misc', CmdPacketSpammer: 'Misc', CmdProvoke: 'Misc', CmdRestart: 'Misc',
    CmdReturn: 'Misc', CmdSetFPS: 'Misc', CmdSpecialHandler: 'Misc', CmdStop: 'Misc',
    CmdTauntcycle: 'Misc', CmdToggleProvoke: 'Misc',
    CmdAcceptQuest: 'Quest', CmdAddQuestList: 'Quest', CmdCompleteQuest: 'Quest',
    CmdRemoveQuestList: 'Quest'
};

// CmdDelay hides the round numbers the author used; the reference adds one for display only.
const PRIVATE_DELAYS = [420, 69, 666, 6969, 1337, 1111, 2222, 3333, 4444, 5555, 6666, 7777, 8888, 9999, 10000];

function text(value) {
    return value === undefined || value === null ? '' : String(value);
}

function upper(value) {
    return text(value).toUpperCase();
}

// The skill name is a Flash call upstream (Skill.GetSkillName). Without the game the index is
// all a reader can show, so the port renders the index and leaves the name to the bridge.
function skillName(index) {
    return text(index);
}

function qtyOfBuy(qty) {
    return qty > 0 ? String(qty) : 'Ma';
}

// Port of each class's ToString. A missing class falls back to its name minus "Cmd", so an
// unknown command from a newer client still shows something and can still be edited as JSON.
const DISPLAY = {
    CmdAttack: (c) => 'Attack ' + text(c.Monster),
    CmdCancelTarget: (c) => (c.LeaveCombat ? 'Leave Combat' : 'Stop Attack'),
    CmdFollow: (c) => 'Follow kills: ' + text(c.PlayerName),
    CmdKill: (c) => 'Kill ' + text(c.Monster),
    CmdFollowKillPriority: null,
    CmdKillFor: function (c) {
        if (/^-?\d+$/.test(text(c.QuestId))) return 'KFQuest: [' + c.QuestId + '] [' + text(c.Monster) + ']';
        const kind = c.ItemType === 1 ? 'KFTemps' : 'KFItems';
        return kind + ': [' + text(c.ItemName) + ' ' + text(c.Quantity) + 'x] [' + text(c.Monster) + ']';
    },
    CmdRest: (c) => (c.Full ? 'Rest fully' : 'Rest'),
    CmdSkillSet: (c) => 'Skill Set: ' + text(c.Name),
    CmdUseSkill: (c) => 'Skill [' + text(c.Monster) + '] ' + (c.Wait ? '[Wait] ' : ' ') +
        (c.Force ? '[Force] ' : ' ') + text(c.Index) + ': ' + skillName(c.Index),
    CmdBankSwap: (c) => 'Bank swap {' + text(c.BankItemName) + ', ' + text(c.InventoryItemName) + '}',
    CmdBankTransfer: (c) => (c.TransferFromBank ? 'Bank -> Inv: ' : 'Inv -> Bank: ') + text(c.ItemName),
    CmdBuy: function (c) {
        const qty = qtyOfBuy(c.Qty);
        if (c.ByID) return 'Buy item [' + qty + 'x] ' + text(c.ItemId) + ' : ' + text(c.ShopItemId);
        return 'Buy item [' + qty + 'x] ' + text(c.ItemName);
    },
    CmdBuyBack: (c) => 'Buy back: ' + text(c.ItemName),
    CmdBuyFast: (c) => 'Buy item fast [' + qtyOfBuy(c.Qty) + 'x] : ' + text(c.ItemName),
    CmdEquip: (c) => (c.Safe ? 'Safe' : 'Unsafe') + ' Equip: ' + text(c.ItemName),
    CmdEquipSet: (c) => 'Equip Set: ' + text(c.ItemName),
    CmdGetDrop: (c) => 'Get drop: ' + text(c.ItemName),
    CmdLoad: (c) => 'Load Shop: ' + text(c.ShopId),
    CmdLoadTravel: (c) => 'Load Shop: ' + text(c.ShopId),
    CmdMapItem: (c) => 'Get map item: ' + text(c.ItemId),
    CmdSell: function (c) {
        const qty = text(c.Qty);
        const value = parseInt(qty, 10);
        if (value === 0 && qty.indexOf('[') === -1) return 'Sell (all): ' + text(c.ItemName);
        if (value < 0) return 'Sell (until): ' + text(c.ItemName) + ' x' + Math.abs(value);
        return 'Sell: ' + text(c.ItemName) + ' x' + qty;
    },
    CmdWhitelist: function (c) {
        const state = WHITELIST_STATES[c.state] || 'On';
        const withItem = state === 'Add' || state === 'Remove';
        return 'Whitelist ' + (withItem ? state + ': ' + text(c.ItemName) : state);
    },
    CmdJoin: (c) => 'Join: [' + text(c.Try) + 'x] ' + (text(c.MapSwf) ? '[SWF] ' : '') +
        text(c.Map) + ', ' + text(c.Cell) + ', ' + text(c.Pad),
    CmdMoveToCell: (c) => 'Move to cell: ' + text(c.Cell) + ', ' + text(c.Pad),
    CmdMoveToCell2: function (c) {
        if (c.stop) return 'Stop Cell Jump';
        if (c.target && c.target !== '*') return 'Start Jump and Find : ' + text(c.target);
        return 'Start Jump between : ' + text(c.Cell).split(',').join('|');
    },
    CmdSetSpawn: () => 'Set Spawnpoint',
    CmdTravel: (c) => 'Join: ' + text(c.Map) + ', ' + text(c.Cell) + ', ' + text(c.Pad),
    CmdWalk: (c) => (c.Type === 'Random' ? 'Walk Randomly' : 'Walk to: ' + text(c.X) + ', ' + text(c.Y)),
    CmdYulgar: () => 'Join yulgar',
    CmdBackgroundPacket: (c) => (c.ActionW === 1 ? 'Spammer [STOP]: ' : 'Spammer [ADD]: ') + text(c.Label),
    CmdBankList: () => 'Bank Item list',
    CmdBeep: (c) => 'Beep ' + text(c.Times) + ' Times ',
    // CmdBlank, CmdBlank2 and CmdBlank3 share one file; CmdBlank2 prints its Text.
    CmdBlank: () => '',
    CmdBlank2: (c) => text(c.Text),
    CmdBlank3: (c) => text(c.Text),
    CmdBotDelay: (c) => 'Set bot delay: ' + text(c.Delay),
    CmdChange: (c) => (c.Guild ? 'Guild: ' : 'Name: ') + text(c.Text),
    CmdClearTemp: () => 'Clear TempVar',
    CmdClientMessage: (c) => 'Send ' + (c.IsWarning ? 'warning' : 'info') + ' : ' + text(c.Messages),
    CmdDelay: function (c) {
        const delay = typeof c.Delay === 'number' ? c.Delay : 0;
        return 'Delay: ' + (PRIVATE_DELAYS.indexOf(delay) !== -1 ? delay + 1 : delay);
    },
    CmdGotoLabel: (c) => 'Goto label: ' + text(c.Label),
    CmdGotoPlayer: (c) => 'Goto player: ' + text(c.PlayerName),
    CmdIndex: function (c) {
        if (c.Type === 1) return 'Index down: ' + text(c.Index);
        if (c.Type === 0) return 'Index up: ' + text(c.Index);
        return 'Goto index: ' + (text(c.IndexString) || text(c.Index));
    },
    CmdInt: function (c) {
        if (c.type === 1) return 'Increase ' + text(c.Int) + ' by 1';
        if (c.type === 2) return 'Decrease ' + text(c.Int) + ' by 1';
        return 'Set ' + text(c.Int) + ': ' + text(c.Value);
    },
    CmdInt2: (c) => 'Set Int [' + text(c.IntKey) + '] : ' + text(c.Value),
    CmdLabel: (c) => '[' + upper(c.Name) + ']',
    CmdLoadBot: (c) => 'Load bot: ' + text(c.BotFileName),
    CmdLog: (c) => (text(c.Text).indexOf('{CLEAR}') !== -1 ? 'Clear ' : 'Log ') +
        (c.Debug ? 'Debug: ' : 'Script: ') + text(c.Text),
    CmdLogout: () => 'Logout',
    CmdPacket: (c) => (c.ForClient || c.Client ? 'To client' : 'To server') +
        ' [' + text(c.SpamTimes) + 'x]: ' + text(c.Packet),
    CmdPacketDelay: (c) => (c.Client ? 'Send delayed client packet: ' : 'Send delayed packet: ') + text(c.Packet),
    CmdPacketSpammer: function (c) {
        if (c.type === 0) return 'Add to P.S: ' + text(c.Packet);
        if (c.type === 1) return 'Remove from P.S: ' + text(c.Packet);
        if (c.type === 6) return 'Set P.S. Delay to: ' + text(c.Delay);
        return PACKET_SPAMMER_TYPES[c.type] + ' P.S.';
    },
    CmdProvoke: (c) => (c.Set ? 'Provoke ON' : 'Provoke OFF'),
    CmdRestart: () => 'Restart bot',
    CmdReturn: () => 'Return',
    CmdSetFPS: (c) => 'Set FPS: ' + text(c.FPS),
    CmdSpecialHandler: function (c) {
        const prefix = ['Special Start', 'Special Stop', 'Special Switch'][c.Mode] || 'Special';
        return c.Zone ? prefix + ': ' + c.Zone : prefix;
    },
    CmdStop: () => 'Stop bot',
    CmdTauntcycle: function (c) {
        const type = c.type === 0 ? 'Start' : 'Stop';
        if (c.type !== 0) return type + ' Tauntcycle';
        return type + ' Tauntcycle : ' + text(c.cycle) + 'T [' + text(c.target) + '] every ' +
            text(c.second) + 's ' + (c.order <= 0 || c.order === undefined ? 'Dynamic' : c.order);
    },
    CmdToggleProvoke: (c) => (c.Type === 0 ? 'Provoke Off' : c.Type === 1 ? 'Provoke On' : 'Provoke Toggle'),
    CmdAcceptQuest: (c) => (c.ghostAccept ? 'Ghost Accept: ' : 'Accept Quest: ') + questId(c.Quest),
    CmdAddQuestList: (c) => 'Add Quest list : ' + text(c.Id) +
        (c.ItemId === undefined || c.ItemId === null ? '' : ' ' + c.ItemId) +
        (c.SafeRelogin ? ' [SafeRelogin]' : ''),
    CmdCompleteQuest: function (c) {
        const quant = c.CompleteTry <= -1 ? 'Ma' : text(c.CompleteTry);
        const id = text(c.Quest && c.Quest.ItemId) && text(c.Quest.ItemId) !== '0'
            ? questId(c.Quest) + '^' + c.Quest.ItemId
            : questId(c.Quest);
        return 'Complete quest [' + quant + 'x]: ' + id + ' ' + (c.InBlank ? '[InBlank]' : '');
    },
    CmdRemoveQuestList: (c) => 'Remove Quest list : ' + text(c.Id) +
        (c.ItemId === undefined || c.ItemId === null ? '' : ' ' + c.ItemId) +
        (c.SafeRelogin ? ' [SafeRelogin]' : '')
};

const WHITELIST_STATES = ['On', 'Off', 'Toggle', 'Add', 'Remove'];
const PACKET_SPAMMER_TYPES = ['Add', 'Remove', 'Start', 'Stop', 'Clear', 'Restart', 'SetDelay',
    'GoPressTheGodDamnCorrectButton'];

function questId(quest) {
    if (!quest || typeof quest !== 'object') return '';
    const id = quest.QuestID !== undefined ? quest.QuestID : quest.Id;
    return id === undefined || id === null ? '' : String(id);
}

// Statement rows: [class, category tag, dropdown text, first label, second label]. These are the
// reference's own Resources/statementcmds.txt rows, which is the catalog its dropdown is built
// from; the text is what the command shows and what the category groups.
const STATEMENT_ROWS = [
    ['CmdCellIs', 'Map', 'Cell is', 'Cell', null],
    ['CmdCellIsNot', 'Map', 'Cell is not', 'Cell', null],
    ['CmdGoldGreaterThan', 'This player', 'Gold is greater than', 'Gold', null],
    ['CmdGoldLessThan', 'This player', 'Gold is less than', 'Gold', null],
    ['CmdHealthGreaterThan', 'This player', 'Health is greater than', 'Health', null],
    ['CmdHealthLessThan', 'This player', 'Health is less than', 'Health', null],
    ['CmdInBank', 'Item', 'Is in bank', 'Item name', 'Quantity (* = any)'],
    ['CmdInHouse', 'Item', 'Is in house', 'Item name', 'Quantity (* = any)'],
    ['CmdInCombat', 'This player', 'Is in combat', null, null],
    ['CmdNotInCombat', 'This player', 'Not in combat', null, null],
    ['CmdTargetHealthGreaterThan', 'This player', 'Target health greater than', 'Health', 'Default true/false'],
    ['CmdTargetHealthLessThan', 'This player', 'Target health less than', 'Health', 'Default true/false'],
    ['CmdTargetHealthBetween', 'This player', 'Target health between', 'StartHP,EndHP', 'Default true/false'],
    ['CmdInInventory', 'Item', 'Is in inventory', 'Item name', 'Quantity (* = any)'],
    ['CmdInTemp', 'Item', 'Is in temp inventory', 'Item name', 'Quantity (* = any)'],
    ['CmdEquipped', 'Item', 'Is equipped', 'Item name', null],
    ['CmdItemNotPickupable', 'Item', 'Has not dropped', 'Item name', null],
    ['CmdItemPickupable', 'Item', 'Has dropped', 'Item name', null],
    ['CmdIsMember', 'This player', 'Is Member', null, null],
    ['CmdIsNotMember', 'This player', 'Is Not Member', null, null],
    ['CmdLevelGreaterThan', 'This player', 'Level is greater than', 'Level', null],
    ['CmdLevelIs', 'This player', 'Level is', 'Level', null],
    ['CmdLevelLessThan', 'This player', 'Level is less than', 'Level', null],
    ['CmdManaGreaterThan', 'This player', 'Mana is greater than', 'Mana', null],
    ['CmdManaLessThan', 'This player', 'Mana is less than', 'Mana', null],
    ['CmdFactionRankGreaterThan', 'This player', 'Faction Rank is greater than', 'Faction', 'Rank'],
    ['CmdFactionRankLessThan', 'This player', 'Faction Rank is less than', 'Faction', 'Rank'],
    ['CmdMapIs', 'Map', 'Map is', 'Map name', null],
    ['CmdMapIsNot', 'Map', 'Map is not', 'Map name', null],
    ['CmdMonsterInRoom', 'Monster', 'Is in room', 'Monster name', null],
    ['CmdMonsterNotInRoom', 'Monster', 'Is not in room', 'Monster name', null],
    ['CmdMonsterHealthGreaterThan', 'Monster', 'Monster HP greater than', 'Monster name', 'Health'],
    ['CmdMonsterHealthLessThan', 'Monster', 'Monster HP less than', 'Monster name', 'Health'],
    ['CmdMonstersGreaterThan', 'Monster', 'Count is greater than', 'Monster count', null],
    ['CmdMonstersLessThan', 'Monster', 'Count is less than', 'Monster count', null],
    ['CmdNameEquals', 'This player', 'Name equals', 'Player name', null],
    ['CmdNotInBank', 'Item', 'Is not in bank', 'Item name', 'Quantity (* = any)'],
    ['CmdNotInHouse', 'Item', 'Is not in house', 'Item name', 'Quantity (* = any)'],
    ['CmdNotInInventory', 'Item', 'Is not in inventory', 'Item name', 'Quantity (* = any)'],
    ['CmdNotInTemp', 'Item', 'Is not in temp', 'Item name', 'Quantity (* = any)'],
    ['CmdNotEquipped', 'Item', 'Is not equipped', 'Item name', null],
    ['CmdListInInv', 'Item', 'All in List is in inventory', null, null],
    ['CmdPlayerInRoom', 'Player', 'Player is in room', 'Player name', null],
    ['CmdPlayerNotInRoom', 'Player', 'Player is not in room', 'Player name', null],
    ['CmdPlayerIsInCell', 'Player', 'Player is in cell', 'Player name', 'Cell name'],
    ['CmdPlayerIsNotInCell', 'Player', 'Player is not in cell', 'Player name', 'Cell name'],
    ['CmdPlayerIsNotInMyCell', 'Player', 'Player is not in my cell', 'Player name', null],
    ['CmdPlayerIsInMyCell', 'Player', 'Player is in my cell', 'Player name', null],
    ['CmdPlayersGreaterThan', 'Player', 'Count is greater than', 'Player count', null],
    ['CmdPlayersLessThan', 'Player', 'Count is less than', 'Player count', null],
    ['CmdPlayerInMyCellGreaterThan', 'Player', 'Player count is greater than [cell]', 'Player count', null],
    ['CmdPlayerInMyCellLessThan', 'Player', 'Player count is Less than [cell]', 'Player count', null],
    ['CmdQuestCompleted', 'Quest', 'Quest can be turned in', 'Quest ID', null],
    ['CmdQuestNotCompleted', 'Quest', 'Quest can not be turned in', 'Quest ID', null],
    ['CmdQuestAvailable', 'Quest', 'Quest is available', 'Quest ID', null],
    ['CmdQuestNotAvailable', 'Quest', 'Quest is not available', 'Quest ID', null],
    ['CmdQuestInProgress', 'Quest', 'Quest is in progress', 'Quest ID', null],
    ['CmdQuestNotInProgress', 'Quest', 'Quest is not in progress', 'Quest ID', null],
    ['CmdIntGreaterThan', 'Misc', 'Int greater than', 'Int', 'Value'],
    ['CmdIntLessThan', 'Misc', 'Int less than', 'Int', 'Value'],
    ['CmdIntIs', 'Misc', 'Int is', 'Int', 'Value'],
    ['CmdIntIsNot', 'Misc', 'Int is not', 'Int', 'Value'],
    ['CmdIntEqualInt', 'Misc', 'Int is equal to Int', 'Int1', 'Int2'],
    ['CmdIntNotEqualInt', 'Misc', 'Int is not equal to Int', 'Int1', 'Int2'],
    ['CmdVarEqualVar', 'Misc', 'Var is equal to Var', 'Var1', 'Var2'],
    ['CmdVarNotEqualVar', 'Misc', 'Var is not equal to Var', 'Var1', 'Var2'],
    ['CmdIsMaxStack', 'Item', 'Item is max in inventory', 'Item name', null],
    ['CmdIsNotMaxStack', 'Item', 'Item is not max in inventory', 'Item name', null],
    ['CmdSetVar', 'Misc', 'Set Temporary Variable', 'Variable Name', 'Value'],
    ['CmdUpdateVar', 'Misc', 'Update Temporary Variable', 'Variable Name', 'Value'],
    ['CmdNotInBankAndInvent', 'Item', 'Item is not in bank and inventory', 'Item name', 'Quantity (* = any)'],
    ['CmdInBankOrInvent', 'Item', 'Item is in bank or inventory', 'Item name', 'Quantity (* = any)'],
    ['CmdPlayersHPGreaterThan', 'Player', 'Health is greater than', 'Player name', 'Health in percentage'],
    ['CmdPlayersHPLessThan', 'Player', 'Health is less than', 'Player name', 'Health in percentage'],
    ['CmdHasTarget', 'This player', 'Is has target', null, null],
    ['CmdNotHasTarget', 'This player', 'Is not has target', null, null],
    ['CmdPlayerAuraEquals', 'Aura', 'Player aura value equals', 'Aura name', 'Aura value'],
    ['CmdPlayerAuraGreaterThan', 'Aura', 'Player aura value greater than', 'Aura name', 'Aura value'],
    ['CmdPlayerAuraLessThan', 'Aura', 'Player aura value less than', 'Aura name', 'Aura value'],
    ['CmdTargetAuraEquals', 'Aura', 'Target aura value equals', 'Aura name', 'Aura value'],
    ['CmdTargetAuraGreaterThan', 'Aura', 'Target aura value greater than', 'Aura name', 'Aura value'],
    ['CmdTargetAuraLessThan', 'Aura', 'Target aura value less than', 'Aura name', 'Aura value'],
    ['CmdSpecialAnims', 'Monster', 'Special Anims', 'Animation message', 'Skill to use'],
    ['CmdDelayedAnims', 'Monster', 'Delayed Anims', 'Animation message', 'Skill to use'],
    ['CmdTargetAuraDuration', 'Aura', 'Monster (ID) Aura duration is less than', 'Aura Name',
        'Duration remaining (in ms)']
];

// Availability note: a row whose class the reference build does not declare still exists in the
// shipped catalog (two renamed classes and one commented-out class), so the dropdown shows it and
// the client drops it on read. Missing ones are reported rather than silently hidden.
const STATEMENTS = STATEMENT_ROWS.map(function (row) {
    return {
        className: row[0],
        tag: row[1],
        text: row[2],
        description1: row[3],
        description2: row[4]
    };
});

const STATEMENT_TAGS = ['Aura', 'Item', 'This player', 'Player', 'Map', 'Monster', 'Quest', 'Misc'];

const STATEMENT_DISPLAY = {
    CmdCellIs: (c) => 'Cell is: ' + text(c.Value1),
    CmdCellIsNot: (c) => 'Cell is not: ' + text(c.Value1),
    CmdEquipped: (c) => 'Item is equipped: ' + text(c.Value1),
    CmdFactionRankGreaterThan: (c) => text(c.Value1) + ' Rank is greater than: ' + text(c.Value2),
    CmdFactionRankLessThan: (c) => text(c.Value1) + ' Rank is less than: ' + text(c.Value2),
    CmdGoldGreaterThan: (c) => 'Gold is greater than: ' + text(c.Value1),
    CmdGoldLessThan: (c) => 'Gold is less than: ' + text(c.Value1),
    CmdHasTarget: () => 'Is has target',
    CmdHealthGreaterThan: (c) => 'Health is greater than: ' + text(c.Value1),
    CmdHealthLessThan: (c) => 'Health is less than: ' + text(c.Value1),
    CmdInBank: (c) => 'Item is in bank: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdInBankOrInvent: (c) => 'Is in bank or invent: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdInCombat: () => 'Is in combat',
    CmdInHouse: (c) => 'Is in house: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdInInventory: (c) => 'Is in inventory: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdInTemp: (c) => 'Is in temp inventory: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdIntEqualInt: (c) => text(c.Value1) + ' == ' + text(c.Value2) + ' (Int)',
    CmdIntGreaterThan: (c) => text(c.Value1) + ' >= ' + text(c.Value2),
    CmdIntIs: (c) => text(c.Value1) + ' == ' + text(c.Value2) + ' (Value)',
    CmdIntIsNot: (c) => text(c.Value1) + ' != ' + text(c.Value2),
    CmdIntLessThan: (c) => text(c.Value1) + ' <= ' + text(c.Value2),
    CmdIntNotEqualInt: (c) => text(c.Value1) + ' != ' + text(c.Value2) + ' (Int)',
    CmdIsMaxStack: (c) => 'Is maxed out: ' + text(c.Value1),
    CmdIsMember: () => 'Is Member',
    CmdIsNotMaxStack: (c) => 'Is not maxed out: ' + text(c.Value1),
    CmdIsNotMember: () => 'Is Not Member',
    CmdItemNotPickupable: (c) => 'Item has not dropped: ' + text(c.Value1),
    CmdItemPickupable: (c) => 'Item has dropped: ' + text(c.Value1),
    CmdLevelGreaterThan: (c) => 'Level is greater than: ' + text(c.Value1),
    CmdLevelIs: (c) => 'Level is: ' + text(c.Value1),
    CmdLevelLessThan: (c) => 'Level is less than: ' + text(c.Value1),
    CmdListInInv: () => 'All in List is in inventory',
    CmdManaGreaterThan: (c) => 'Mana is greater than: ' + text(c.Value1),
    CmdManaLessThan: (c) => 'Mana is less than: ' + text(c.Value1),
    CmdMapIs: (c) => 'Map is: ' + text(c.Value1),
    CmdMapIsNot: (c) => 'Map is not: ' + text(c.Value1),
    CmdMonsterHealthGreaterThan: (c) => text(c.Value1) + "'s HP greater than: " + text(c.Value2),
    CmdMonsterHealthLessThan: (c) => text(c.Value1) + "'s HP less than: " + text(c.Value2),
    CmdMonsterInRoom: (c) => 'Monster is in room: ' + text(c.Value1),
    CmdMonsterNotInRoom: (c) => 'Monster is not in room: ' + text(c.Value1),
    CmdMonstersGreaterThan: (c) => 'Monster count is greater than: ' + text(c.Value1),
    CmdMonstersLessThan: (c) => 'Monster count is less than: ' + text(c.Value1),
    CmdNameEquals: (c) => 'Player name equals: ' + text(c.Value1),
    CmdNotEquipped: (c) => 'Item is not equipped: ' + text(c.Value1),
    CmdNotHasTarget: () => 'Is not has target',
    CmdNotInBank: (c) => 'Item is not in bank: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdNotInBankAndInvent: (c) => 'Is not in bank and invent: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdNotInCombat: () => 'Is not in combat',
    CmdNotInHouse: (c) => 'Item is not in house: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdNotInInventory: (c) => 'Item is not in inventory: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdNotInTemp: (c) => 'Item is not in temp inventory: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdPlayerAuraEquals: (c) => 'Player aura equals: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdPlayerAuraGreaterThan: (c) => 'Player aura greater than: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdPlayerAuraLessThan: (c) => 'Player aura less than: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdPlayersHPGreaterThan: (c) => (c.Value1 && c.Value2 ? c.Value1 + "'s HP greater than: " + c.Value2 + '%' : 'Player HP greater than: '),
    CmdPlayersHPLessThan: (c) => (c.Value1 && c.Value2 ? c.Value1 + "'s HP less than: " + c.Value2 + '%' : 'Player HP less than: '),
    CmdPlayerInMyCellGreaterThan: (c) => 'Player count greater than [cell]: ' + text(c.Value1),
    CmdPlayerInMyCellLessThan: (c) => 'Player count is less than [cell]: ' + text(c.Value1),
    CmdPlayerInRoom: (c) => 'Player is in room: ' + text(c.Value1),
    CmdPlayerIsInCell: (c) => 'Player is in cell: ' + text(c.Value1),
    CmdPlayerIsInMyCell: (c) => 'Player is in my cell: ' + text(c.Value1),
    CmdPlayerIsNotInCell: (c) => 'Player is not in cell: ' + text(c.Value1),
    CmdPlayerIsNotInMyCell: (c) => 'Player is not in my cell: ' + text(c.Value1),
    CmdPlayerNotInRoom: (c) => 'Player is not in room: ' + text(c.Value1),
    CmdPlayersGreaterThan: (c) => 'Player count is greater than: ' + text(c.Value1),
    CmdPlayersLessThan: (c) => 'Player count is less than: ' + text(c.Value1),
    CmdQuestAvailable: (c) => 'Quest is available:' + text(c.Value1),
    CmdQuestCompleted: (c) => 'Quest can be turned in: ' + text(c.Value1),
    CmdQuestInProgress: (c) => 'Quest is in progress: ' + text(c.Value1),
    CmdQuestNotAvailable: (c) => 'Quest is not available: ' + text(c.Value1),
    CmdQuestNotCompleted: (c) => 'Quest cannot be turned in: ' + text(c.Value1),
    CmdQuestNotInProgress: (c) => 'Quest is not in progress: ' + text(c.Value1),
    CmdSetVar: (c) => 'Variable ' + text(c.Value1) + ': ' + text(c.Value2),
    CmdSpecialAnims: (c) => 'Special Anims: ' + text(c.Value1) + (text(c.Value2) ? ' | Skill: ' + c.Value2 : ''),
    CmdTargetAuraDuration: function (c) {
        if (!c.targetId) return 'Monster (ID) Aura duration is less than ... ms';
        return "Aura '" + text(c.Value1) + "' on [id." + c.targetId + ']: < ' + text(c.Value2) + 'ms';
    },
    CmdTargetAuraEquals: (c) => 'Target aura equals: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdTargetAuraGreaterThan: (c) => 'Target aura greater than: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdTargetAuraLessThan: (c) => 'Target aura less than: ' + text(c.Value1) + ', ' + text(c.Value2),
    CmdTargetHealthBetween: (c) => 'Target health between: ' + text(c.Value1),
    CmdTargetHealthGreaterThan: (c) => 'Target health greater than: ' + text(c.Value1),
    CmdTargetHealthLessThan: (c) => 'Target health less than: ' + text(c.Value1),
    CmdUpdateVar: (c) => 'Update Variable ' + text(c.Value1) + ': ' + text(c.Value2),
    CmdVarEqualVar: (c) => text(c.Value1) + ' == ' + text(c.Value2) + ' [Var]',
    CmdVarNotEqualVar: (c) => text(c.Value1) + ' != ' + text(c.Value2) + ' [Var]'
};

// A statement the shipped catalog lists but this build has no class for still displays its own
// dropdown text (the reference reads Tag/Text straight out of the file), so the fallback is exact
// for those rows too.
function display(command) {
    const className = classNameOf(command);
    const known = DISPLAY[className] || STATEMENT_DISPLAY[className];
    if (known) return known(command);
    const row = STATEMENTS.filter(function (s) { return s.className === className; })[0];
    if (row) return row.text;
    // A command class this build does not know (a newer client's file): show its own Text, which
    // is what a statement without a class here has, and fall back to the bare class name.
    return text(command && command.Text) || className.replace(/^Cmd/, '');
}

// Skill.ToString: the reference strips a leading "1: " the game returned and picks the shape by
// the skill's own Type - Label is the plain Text, Safe prints the HP/MP gate, Normal the index.
function skillRow(skill) {
    // `name` is the skill's own Text when it has one - the shadowing bug that made this throw was
    // a local named `text`, which is also the module's string helper.
    let label = skill.Text === undefined || skill.Text === null ? null : String(skill.Text);
    if (label !== null && /^[1-4]: /.test(label)) label = label.slice(3);
    const name = label === null ? skillName(skill.Index) : label;
    let row;
    if (skill.Type === 2) row = name;
    else if (skill.Type === 1) {
        row = '[' + (skill.IsSafeMp ? 'MP' : 'HP') + ' ' + (skill.SType === 1 ? '>=' : '<=') + ' ' +
            text(skill.SafeValue) + '%] ' + text(skill.Index) + ': ' + name;
    } else if (skill.aura) {
        row = text(skill.Index) + ': ' + name + ' [Aura : ' + skill.aura + ']';
    } else {
        row = text(skill.Index) + ': ' + name;
    }
    return skill.waitCd ? '[Wait] ' + row : row;
}

// Quest.ToString: id, then ": itemId" when the quest carries one, then the relogin flag.
function questRow(quest) {
    return questId(quest) + (quest.ItemId === undefined || quest.ItemId === null ? '' : ': ' + quest.ItemId) +
        (quest.SafeRelogin ? ' [SafeRelogin]' : '');
}

/**
 * The text of one row in the list, whichever list is showing: the reference sets a DisplayMember
 * for boosts and items and relies on ToString for the rest.
 */
function rowText(item) {
    if (typeof item === 'string') return item;
    if (!item || typeof item !== 'object') return '';
    const type = typeof item.$type === 'string' ? item.$type : '';
    if (type.indexOf('Grimoire.Game.Data.Skill') !== -1) return skillRow(item);
    if (type.indexOf('Grimoire.Game.Data.Quest') !== -1) return questRow(item);
    if (type.indexOf('Grimoire.Game.Data.InventoryItem') !== -1) return text(item.Name);
    return display(item);
}

/** A command of the given class, with the reference's own values for the fields it always writes. */
function makeCommand(className, properties) {
    const bots = require('./bots.js');
    return bots.newCommand(fullType(className), properties);
}

/** A statement command: the three fields the reference always carries, in the same order. */
function makeStatement(className, value1, value2) {
    const row = STATEMENTS.filter(function (s) { return s.className === className; })[0];
    if (!row) throw new Error('[AquaStar:grimlite-parity] unknown statement: ' + className);
    const command = { $type: ROOT + 'Misc.Statements.' + className + SUFFIX, Tag: row.tag, Text: row.text };
    command.Value1 = value1 === undefined || value1 === null ? '' : String(value1);
    command.Value2 = value2 === undefined || value2 === null ? '' : String(value2);
    return command;
}

module.exports = {
    SUFFIX: SUFFIX,
    ROOT: ROOT,
    GROUPS: GROUPS,
    DISPLAY: DISPLAY,
    STATEMENTS: STATEMENTS,
    STATEMENT_TAGS: STATEMENT_TAGS,
    classNameOf: classNameOf,
    fullType: fullType,
    display: display,
    rowText: rowText,
    skillRow: skillRow,
    questRow: questRow,
    makeCommand: makeCommand,
    makeStatement: makeStatement
};
