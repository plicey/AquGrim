// What the tabs' controls do, reference Grimoire/UI/BotManager.cs. One place per behaviour:
//
//   COMMAND_BUTTONS  every control the reference wires to AddCommand, with the properties it
//                    builds and the modifier it honours (ctrl = insert above, alt = the variant)
//   SETTINGS         the tickboxes that write a Configuration key straight away
//   NUMBERS          the number boxes that do the same
//
// A builder returns the command object; the caller adds it to the list with the modifier options,
// which is how the reference separates "what the button makes" from "where it goes".

const catalog = require('./command-catalog.js');

// Text a reference textbox starts with; the reference compares against these before using the
// value, so a box the user never touched contributes nothing.
const PLACEHOLDER = {
    txtMonster: 'Monster (* = random)',
    txtKillFMon: 'Monster (* = random)',
    txtKillFQ: 'Quantity (* = any)',
    txtKillFItem: 'Item name',
    txtMonsterSkillCmd: 'Monster (* = random)',
    txtJoin: 'battleon-1e99',
    txtJoinCell: 'Enter',
    txtJoinPad: 'Spawn',
    tbMapF: 'battleon-1e99',
    tbCellF: 'Enter',
    tbPadF: 'Spawn',
    tbMonNameF: 'Monster (* = random)',
    tbItemNameF: 'Item name',
    tbItemQtyF: 'Quantity (* = any)',
    tbShopName: 'Shop Item Name',
    tbShopId: 'Shop Id',
    tbItemId: 'Item Id',
    tbShopItemId: 'Shop Item Id',
    txtLabel: 'Label name',
    txtPlayer: 'Player name',
    txtItem: 'Item name',
    txtWhitelist: 'Item name',
    txtSwapBank: 'Bank item name',
    txtSwapInv: 'Inventory item name',
    txtPacket: '%xt%zm%[packet]%',
    tbBSPacket: '%xt%zm%getMapItem%1%[mapItemId]%',
    tbBSLabel: 'Packet Name',
    tbLevel: 'Level',
    txtLog: 'Text',
    tbLoadMap: 'Map file (.swf)',
    tbMapSpoof: 'ThisIsCool',
    txtAuthor: 'Author',
    txtDescription: 'Description (Write in RTF)'
};

/** The box's value, or undefined while it still shows the placeholder the designer gave it. */
function field(values, id) {
    const value = values ? values[id] : undefined;
    if (value === undefined || value === null) return undefined;
    const text = String(value);
    if (!text.length) return undefined;
    if (PLACEHOLDER[id] !== undefined && text === PLACEHOLDER[id]) return undefined;
    return text;
}

/** The box's value, or the fallback the reference uses when it is empty. */
function fieldOr(values, id, fallback) {
    const value = field(values, id);
    return value === undefined ? fallback : value;
}

function number(values, id, fallback) {
    const value = field(values, id);
    if (value === undefined) return fallback;
    const parsed = Number(value);
    return isNaN(parsed) ? fallback : parsed;
}

/** "Monster (* = random)", empty, or "/id 123" all mean the wildcard the reference uses. */
function monster(values, id) {
    const value = field(values, id);
    if (value === undefined || value.length === 0) return '*';
    if (value.split(' ')[0] === '/id') return '*';
    return value;
}

function list(values, id) {
    const value = values ? values[id] : undefined;
    return Array.isArray(value) ? value : [];
}

function command(className, properties) {
    return catalog.makeCommand(className, properties);
}

const COMMAND_BUTTONS = {
    btnAttack: (v) => command('CmdAttack', { Monster: monster(v, 'txtMonster') }),
    btnKill: (v) => command('CmdKill', { Monster: monster(v, 'txtMonster') }),
    btnRest: () => command('CmdRest', {}),
    btnRestF: () => command('CmdRest', { Full: true }),
    btnKillF: function (v) {
        return command('CmdKillFor', {
            ItemType: v.rbTemp ? 1 : 0,
            Monster: monster(v, 'txtKillFMon'),
            ItemName: field(v, 'txtKillFItem') || '',
            Quantity: fieldOr(v, 'txtKillFQ', '*')
        });
    },
    btnUseSkillSet: (v) => command('CmdSkillSet', { Name: (field(v, 'txtSkillSet') || '').toUpperCase() }),
    btnLeaveCombat: () => command('CmdCancelTarget', { LeaveCombat: true }),
    btnStopAttack: () => command('CmdCancelTarget', {}),
    btnSkillCmd: function (v, mods) {
        const properties = {
            Index: fieldOr(v, 'numSkill', '1'),
            Wait: v.cbSkillCmdWait === true,
            Force: v.chkForceSkill === true,
            Monster: monster(v, 'txtMonsterSkillCmd')
        };
        return command('CmdUseSkill', properties);
    },
    btnSetSpawn: () => command('CmdSetSpawn', {}),
    btnWalk: (v) => command('CmdWalk', { X: fieldOr(v, 'numWalkX', '0'), Y: fieldOr(v, 'numWalkY', '0') }),
    btnWalkRdm: (v) => command('CmdWalk', {
        Type: 'Random',
        X: fieldOr(v, 'numWalkX', '0'),
        Y: fieldOr(v, 'numWalkY', '0')
    }),
    btnJump: function (v, mods) {
        const properties = {
            Cell: fieldOr(v, 'txtCell', 'Enter'),
            Pad: fieldOr(v, 'txtPad', 'Spawn')
        };
        return command(mods.alt ? 'CmdMoveToCell2' : 'CmdMoveToCell', properties);
    },
    btnJoin: function (v) {
        const properties = {
            Map: fieldOr(v, 'txtJoin', 'battleon-1e99'),
            Cell: fieldOr(v, 'txtJoinCell', 'Enter'),
            Pad: fieldOr(v, 'txtJoinPad', 'Spawn'),
            Try: number(v, 'numJoinTry', 1)
        };
        // The reference always assigns MapSwf (empty when the tickbox is off, which is what a
        // corpus CmdJoin looks like: 114 of the 115 carry no key at all). An empty string is the
        // property's C# initialiser, so leaving the key off keeps the file shaped as the corpus is.
        const swf = v.cbJoinMapSwf === true ? field(v, 'tbJoinMapSwf') : undefined;
        if (swf !== undefined && swf.indexOf('(.swf)') === -1) properties.MapSwf = swf;
        return command('CmdJoin', properties);
    },
    btnMapItem: (v) => command('CmdMapItem', { ItemId: number(v, 'numMapItem', 1) }),
    btnItem: function (v, mods) {
        const name = field(v, 'txtItem') || '';
        switch (field(v, 'cbItemCmds')) {
        case 'Sell':
            return command('CmdSell', { ItemName: name, Qty: mods.alt ? '0' : '1' });
        case 'Equip':
            return command('CmdEquip', { ItemName: name, Safe: true });
        case 'Unsafe Equip':
            return command('CmdEquip', { ItemName: name, Safe: false });
        case 'To bank from inv':
            return command('CmdBankTransfer', { ItemName: name, TransferFromBank: false });
        case 'To inv from bank':
            return command('CmdBankTransfer', { ItemName: name, TransferFromBank: true });
        case 'Equip Set':
            return command('CmdEquipSet', { ItemName: name });
        case 'Add to Whitelist':
            return command('CmdWhitelist', { ItemName: name, state: 3 });
        case 'Remove from Whitelist':
            return command('CmdWhitelist', { ItemName: name, state: 4 });
        default:
            return command('CmdGetDrop', { ItemName: name });
        }
    },
    btnSwap: (v) => command('CmdBankSwap', {
        InventoryItemName: field(v, 'txtSwapInv') || '',
        BankItemName: field(v, 'txtSwapBank') || ''
    }),
    btnWhitelistOn: () => command('CmdWhitelist', { state: 0 }),
    btnWhitelistOff: () => command('CmdWhitelist', { state: 1 }),
    btnWhitelistToggle: () => command('CmdWhitelist', { state: 2 }),
    btnLoadShop: (v) => command('CmdLoad', { ShopId: number(v, 'tbShopId', 0) }),
    btnBuy: function (v, mods) {
        const qty = mods.alt ? -1 : number(v, 'numBuyQty', 1);
        if (v.radBuyByID === true) {
            return command('CmdBuy', {
                ShopId: number(v, 'tbShopId', 0),
                ItemId: number(v, 'tbItemId', 0),
                ShopItemId: number(v, 'tbShopItemId', 0),
                Qty: qty,
                ByID: true
            });
        }
        return command('CmdBuy', {
            ItemName: field(v, 'tbShopName') || '',
            ShopId: number(v, 'tbShopId', 0),
            Qty: qty,
            ByID: false
        });
    },
    btnBuyFast: (v, mods) => command('CmdBuyFast', {
        ItemName: field(v, 'tbShopName') || '',
        Qty: mods.alt ? -1 : number(v, 'numBuyQty', 1)
    }),
    btnAddQuestList: (v) => command('CmdAddQuestList', {
        Id: number(v, 'numQuestListID', 1),
        ItemId: v.chkQuestListItem === true ? String(number(v, 'numQuestListItem', 1)) : null,
        SafeRelogin: v.chkReloginCompleteQuest === true
    }),
    btnRemoveQuestList: (v) => command('CmdRemoveQuestList', {
        Id: number(v, 'numQuestListID', 1),
        ItemId: v.chkQuestListItem === true ? String(number(v, 'numQuestListItem', 1)) : null,
        SafeRelogin: v.chkReloginCompleteQuest === true
    }),
    btnQuestComplete: function (v, mods) {
        return command('CmdCompleteQuest', {
            CompleteTry: mods.alt ? -1 : number(v, 'numEnsureTries', 1),
            Quest: questObject(v)
        });
    },
    btnQuestAccept: (v, mods) => command('CmdAcceptQuest', {
        Quest: questObject(v),
        ghostAccept: mods.alt === true
    }),
    btnClearVarInt: () => command('CmdClearTemp', {}),
    ButtonTC_Start: () => command('CmdTauntcycle', { type: 0 }),
    ButtonTC_Stop: () => command('CmdTauntcycle', { type: 1 }),
    btnFollowCmd: (v) => command('CmdFollow', { PlayerName: (field(v, 'tbFollowPlayer') || '').toLowerCase() }),
    btnAddLabel: (v) => command('CmdLabel', { Name: (field(v, 'txtLabel') || '').toUpperCase() }),
    btnGotoLabel: (v) => command('CmdGotoLabel', { Label: (field(v, 'txtLabel') || '').toUpperCase() }),
    btnGoto: (v) => command('CmdGotoPlayer', { PlayerName: field(v, 'txtPlayer') || '' }),
    btnSetInt: function (v, mods) {
        if (mods.alt) {
            return command('CmdInt2', {
                IntKey: field(v, 'txtSetInt') || '',
                Value: String(number(v, 'numSetInt', 0))
            });
        }
        return command('CmdInt', {
            Int: field(v, 'txtSetInt') || '',
            Value: number(v, 'numSetInt', 0),
            type: 0
        });
    },
    btnIncreaseInt: (v) => command('CmdInt', {
        Int: field(v, 'txtSetInt') || '',
        Value: number(v, 'numSetInt', 0),
        type: 1
    }),
    btnDecreaseInt: (v) => command('CmdInt', {
        Int: field(v, 'txtSetInt') || '',
        Value: number(v, 'numSetInt', 0),
        type: 2
    }),
    btnReturnCmd: () => command('CmdReturn', {}),
    btnGotoIndex: (v) => command('CmdIndex', {
        Type: 2,
        Index: number(v, 'numIndexCmd', 0),
        IndexString: ''
    }),
    btnGoUpIndex: (v) => command('CmdIndex', { Type: 0, Index: number(v, 'numIndexCmd', 0) }),
    btnGoDownIndex: (v) => command('CmdIndex', { Type: 1, Index: number(v, 'numIndexCmd', 0) }),
    btnProvokeOn: () => command('CmdProvoke', { Set: true }),
    btnProvokeOff: () => command('CmdProvoke', { Set: false }),
    btnBlank: () => command('CmdBlank3', { Text: '...', Alpha: 1, R: 220, G: 220, B: 220 }),
    btnStop: () => command('CmdStop', {}),
    btnRestart: () => command('CmdRestart', {}),
    btnLoadCmd: (v) => command('CmdLoadBot', {
        BotFileName: v.loadFileName || '',
        BotFilePath: v.loadFilePath || ''
    }),
    btnLogout: () => command('CmdLogout', {}),
    btnBeep: (v) => command('CmdBeep', { Times: number(v, 'numBeepTimes', 10) }),
    btnDelay: (v) => command('CmdDelay', { Delay: number(v, 'numDelay', 1500) }),
    btnStatementAdd: (v) => catalog.makeStatement(field(v, 'cbStatement') || '', field(v, 'txtStatement1'),
        field(v, 'txtStatement2')),
    btnPacket: (v) => command('CmdPacket', {
        Packet: field(v, 'txtPacket') || '',
        SpamTimes: number(v, 'numSpamTimes', 1),
        ForClient: false
    }),
    btnClientPacket: (v) => command('CmdPacket', {
        Packet: field(v, 'txtPacket') || '',
        SpamTimes: number(v, 'numSpamTimes', 1),
        ForClient: true
    }),
    btnSpecialStart: (v) => special(v, 0),
    btnSpecialStop: (v) => special(v, 1),
    btnSpecialSwitch: (v) => special(v, 2),
    btnBotDelay: (v) => command('CmdBotDelay', { Delay: number(v, 'numBotDelay', 100) }),
    btnBSAdd: (v) => command('CmdBackgroundPacket', {
        ActionW: 0,
        Label: field(v, 'tbBSLabel') || '',
        Packet: field(v, 'tbBSPacket') || '',
        Delay: number(v, 'numBSDelay', 1000)
    }),
    btnBSStop: (v) => command('CmdBackgroundPacket', {
        ActionW: 1,
        Label: field(v, 'tbBSLabel') || '',
        Packet: '-LEAVE ME BLANK-',
        Delay: 6969
    }),
    btnLog: (v) => command('CmdLog', { Text: field(v, 'txtLog') || '' }),
    btnLogDebug: (v) => command('CmdLog', { Text: field(v, 'txtLog') || '', Debug: true }),
    btnSetFPSCmd: (v) => command('CmdSetFPS', { FPS: number(v, 'numSetFPS', 30) }),
    btnSetLevelCmd: (v) => command('CmdPacket', {
        Packet: 'Level ' + (field(v, 'tbLevel') || ''),
        SpamTimes: 1,
        ForClient: true
    }),
    btnAddInfoMsg: (v) => command('CmdClientMessage', {
        Messages: field(v, 'inputMsgClient') || '',
        IsWarning: false
    }),
    btnAddWarnMsg: (v) => command('CmdClientMessage', {
        Messages: field(v, 'inputMsgClient') || '',
        IsWarning: true
    }),
    btnChangeNameCmd: (v) => command('CmdChange', { Guild: false, Text: field(v, 'txtUsername') || '' }),
    btnChangeGuildCmd: (v) => command('CmdChange', { Guild: true, Text: field(v, 'txtGuild') || '' }),
    btnAddCmdHunt: function (v, mods) {
        const itemName = field(v, 'tbItemNameF');
        const quantity = field(v, 'tbItemQtyF');
        if (itemName === undefined || quantity === undefined) return null;
        return command(mods.alt ? 'CmdQuestHunt' : 'CmdShortHunt', {
            Map: field(v, 'tbMapF') || '',
            Cell: field(v, 'tbCellF') || '',
            Pad: field(v, 'tbPadF') || '',
            ItemType: v.chkIsTempF === true ? 1 : 0,
            Monster: monster(v, 'tbMonNameF'),
            ItemName: itemName,
            Quantity: quantity,
            BlankFirst: v.cbBlankFirstF === true
        });
    }
};

function questObject(values) {
    const quest = { $type: 'Grimoire.Game.Data.Quest, Grimoire', QuestID: number(values, 'numQuestID', 1) };
    if (values.chkQuestItem === true) quest.ItemId = String(number(values, 'numQuestItem', 1));
    return quest;
}

// The Skill and Quest rows. Their Text is what the game's own GetSkillName would return, so it
// is only written when the caller has a name for the index (the bridge); a row added without the
// game carries the index alone and displays as the index, exactly as the reference's reader does
// for a skill whose Text the file omits.
const SKILL_TYPE = 'Grimoire.Game.Data.Skill, Grimoire';
const QUEST_TYPE = 'Grimoire.Game.Data.Quest, Grimoire';

function skillName(values, index) {
    const names = values && values.skillNames;
    if (!names) return undefined;
    const name = names[index];
    return name === undefined || name === null || name === '' ? undefined : String(name);
}

function skill(values, index, kind, mods) {
    const row = { $type: SKILL_TYPE, Index: String(index), Type: kind };
    const name = skillName(values, index);
    if (name !== undefined) row.Text = name;
    if (mods.alt) row.waitCd = true;
    return row;
}

function safeSkill(values) {
    const index = fieldOr(values, 'numSkill', '1');
    const row = skill(values, index, 1, {});
    row.SafeValue = number(values, 'numSafe', 60);
    // cbSafeType: 0 is "<= Lower than", 1 is ">= Greater than" (the designer's own order).
    row.SType = field(values, 'cbSafeType') === '>= Greater than' ? 1 : 0;
    row.IsSafeMp = values.chkSafeMp === true;
    return row;
}

function questRow(values) {
    const row = { $type: QUEST_TYPE, QuestID: number(values, 'numQuestListID', 1) };
    if (values.chkQuestListItem === true) row.ItemId = String(number(values, 'numQuestListItem', 1));
    row.SafeRelogin = values.chkReloginCompleteQuest === true;
    row.Text = row.ItemId === undefined ? String(row.QuestID) : row.QuestID + ':' + row.ItemId;
    return row;
}

// The buttons that put a row in one of the other five lists rather than a command in Commands.
// Each returns its instructions: { list, items, unique } - unique is the reference's own
// Contains guard (AddDrop / AddItem / AddQuest), which Drops and Items and Quests all have.
const LIST_BUTTONS = {
    btnAddSkill: (v, m) => [{ list: 'Skills', items: [skill(v, fieldOr(v, 'numSkill', '1'), 0, m)] }],
    btnAddSafe: (v) => [{ list: 'Skills', items: [safeSkill(v)] }],
    btnAllSkill: (v, m) => [{
        list: 'Skills',
        items: ['1', '2', '3', '4'].map(function (index) { return skill(v, index, 0, m); })
    }],
    btnWhitelist: (v) => [{ list: 'Drops', items: [field(v, 'txtWhitelist')], unique: true }],
    btnBoth: (v) => {
        const name = field(v, 'txtWhitelist');
        return [
            { list: 'Drops', items: [name], unique: true },
            { list: 'Items', items: [name], unique: true }
        ];
    },
    btnUnbanklst: (v) => [{ list: 'Items', items: [field(v, 'txtWhitelist')], unique: true }],
    btnQuestAdd: (v) => [{ list: 'Quests', items: [questRow(v)], unique: true }],
    btnBoost: (v) => {
        // cbBoosts shows the InventoryItem objects the game sent, so the caller hands the whole
        // row in; the reference adds the selected object itself.
        const selected = v && v.cbBoostsSelected;
        return selected && typeof selected === 'object' ? [{ list: 'Boosts', items: [selected] }] : [];
    }
};

function special(values, mode) {
    return command('CmdSpecialHandler', { Zone: fieldOr(values, 'cmbSpecials', ''), Mode: mode });
}

// Ticks that write Configuration straight away (the reference's *CheckedChanged handlers).
const SETTINGS = {
    chkBankOnStop: 'BankOnStop',
    chkPickup: 'EnablePickup',
    chkReject: 'EnableRejection',
    chkPickupAll: 'EnablePickupAll',
    chkPickupAcTag: 'EnablePickupAcTagged',
    chkRestartDeath: 'RestartUponDeath',
    chkRestartAFK: 'RestartOnAFK',
    chkRelog: 'AutoRelogin',
    chkRelogRetry: 'RelogRetryUponFailure',
    chkSkip: 'SkipDelayIndexIf',
    chkFollowOnly: 'FollowCheck',
    chkInfiniteRange: 'InfiniteAttackRange',
    chkProvoke: 'ProvokeMonsters',
    chkLag: 'LagKiller',
    chkMagnet: 'EnemyMagnet',
    chkHidePlayers: 'HidePlayers',
    chkSkipCutscenes: 'SkipCutscenes',
    chkDisableAnims: 'DisableAnimations',
    chkAFK: 'AFK',
    chkAntiCounter: 'AntiCounter',
    chkAllSkillsCD: 'WaitForAllSkills',
    chkSkillCD: 'WaitForSkill',
    chkExistQuest: 'ExitCombatBeforeQuest',
    chkExitRest: 'ExitCombatBeforeRest',
    chkHP: 'RestIfHp',
    chkMP: 'RestIfMp'
};

// Number boxes that write Configuration straight away.
const NUMBERS = {
    numSkillD: 'SkillDelay',
    numBotDelay: 'BotDelay',
    numRelogDelay: 'RelogDelay',
    numRest: 'RestHp',
    numRestMP: 'RestMp',
    numWalkSpeed: 'WalkSpeed',
    numOptionsTimer: 'optionDelay'
};

const STATEMENT_CATEGORIES = catalog.STATEMENT_TAGS;

function statementsIn(tag) {
    return catalog.STATEMENTS.filter(function (statement) { return statement.tag === tag; });
}

/**
 * Build the command a button contributes, or null when it contributes nothing yet (the
 * reference's own guards: a hunt with no item, a statement with no category).
 */
function build(id, values, modifiers) {
    const builder = COMMAND_BUTTONS[id];
    if (!builder) {
        throw new Error('[AquaStar:grimlite-parity] no command is wired to ' + id);
    }
    const mods = modifiers || {};
    return builder(values || {}, { alt: mods.alt === true, ctrl: mods.ctrl === true });
}

function buildStatement(className, values, modifiers) {
    return build('btnStatementAdd', Object.assign({}, values, { cbStatement: className }), modifiers);
}

/**
 * What a list button contributes: the rows it puts in which list. The reference's handlers build
 * these directly (AddSkill, AddDrop, AddItem, AddQuest); routing them through one table keeps the
 * "which button fills which list" knowledge next to the command builders instead of in the page.
 */
function buildList(id, values, modifiers) {
    const builder = LIST_BUTTONS[id];
    if (!builder) return [];
    const mods = modifiers || {};
    return builder(values || {}, { alt: mods.alt === true, ctrl: mods.ctrl === true })
        .filter(function (group) {
            return group && Array.isArray(group.items) && group.items.length && group.items[0] !== undefined;
        });
}

module.exports = {
    PLACEHOLDER: PLACEHOLDER,
    COMMAND_BUTTONS: COMMAND_BUTTONS,
    LIST_BUTTONS: LIST_BUTTONS,
    SETTINGS: SETTINGS,
    NUMBERS: NUMBERS,
    build: build,
    buildList: buildList,
    buildStatement: buildStatement,
    statementCategories: function () { return STATEMENT_CATEGORIES.slice(); },
    statementsIn: statementsIn
};
