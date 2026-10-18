// The loaders and grabbers (ticket #31). Reference: Grimlite-Li 816d9cd,
// Grimoire/UI/Loaders.cs (the targets and the quest count) and Grimoire/Tools/Grabber.cs
// (the eight grabbers, their rows and their context menus).
//
// Pure: payloads in, rows out. Everything that needs the game, the clipboard, a file or a
// window lives in loaders.js, so the row shapes can be checked against the C# strings directly.
//
// A row is { text, children, menu?, context?, tag? }. `menu` names the context menu the row
// carries in the reference (its ContextMenuStrip) and `context` is what building that menu
// needs, so the page never invents a menu of its own.

const WIKI = 'https://aqwwiki.wikidot.com/';
const WIKI_SEARCH = WIKI + 'search:site/q/';

// The reference replaces literal spaces with '+' before handing the name to the wiki
// (`item.Replace(" ", "+")` in every one of its menu builders).
function wikiUrl(name) {
    return WIKI + String(name == null ? '' : name).replace(/ /g, '+');
}

function wikiSearchUrl(name) {
    return WIKI_SEARCH + String(name == null ? '' : name).replace(/ /g, '+');
}

// cbLoad.Items.
const LOAD_TARGETS = [
    { id: 'hairShop', label: 'Hair shop' },
    { id: 'shop', label: 'Shop' },
    { id: 'quest', label: 'Quest' },
    { id: 'armorCustomizer', label: 'Armor customizer' }
];

// cbGrab.Items. `source` is the read in game.js that fills it, in the reference's order.
const GRAB_TARGETS = [
    { id: 'shopItems', label: 'Shop items', source: 'readShopInfo', menu: 'shop' },
    { id: 'questIds', label: 'Quest IDs', source: 'readQuestTree', orderable: true },
    { id: 'questItems', label: 'Quest items, drop rates', source: 'readQuestTree', orderable: true },
    { id: 'inventoryItems', label: 'Inventory items', source: 'readInventory' },
    { id: 'tempItems', label: 'Temp inventory items', source: 'readTempItems' },
    { id: 'bankItems', label: 'Bank items', source: 'readBankItems' },
    { id: 'monsters', label: 'Monsters', source: 'readMonsters', orderable: true },
    { id: 'allMonsters', label: 'All Monsters', source: 'readAllMonsters', orderable: true }
];

const ORDER_BY = ['Name', 'Id'];

// Loaders.cs's constructor: cbLoad.SelectedIndex = 2.
const LOAD_DEFAULT_INDEX = 2;

// cbGrab_SelectedIndexChanged: `enableGrabOn = {"Monster","Quest"}` with
// IndexOf(..., StringComparison.OrdinalIgnoreCase) >= 0.
function orderable(label) {
    const value = String(label == null ? '' : label).toLowerCase();
    return value.indexOf('monster') !== -1 || value.indexOf('quest') !== -1;
}

/**
 * btnLoad's count expansion: `quests += questId + (i < increament - 1 && increament != 1 ? "," : "")`.
 * The reference only calls this for count > 0; at 1 it produces a bare id.
 */
function questList(firstId, count) {
    let out = '';
    let id = Number(firstId);
    for (let i = 0; i < Number(count); i++) {
        out += id + (i < count - 1 && count !== 1 ? ',' : '');
        id++;
    }
    return out;
}

/**
 * LoadQuests: `source.All(s => s.All(char.IsDigit))`, then Select(int.Parse). Anything else is
 * refused - and the reference refuses it silently.
 */
function parseQuestList(text) {
    const parts = String(text == null ? '' : text).split(',');
    if (!parts.length || parts.some(function (part) { return !/^[0-9]+$/.test(part); })) return null;
    return parts.map(function (part) { return parseInt(part, 10); });
}

/** Grabber.Shorten: over the limit is the first `max` characters plus three dots. */
function shorten(text, max) {
    if (text === null || text === undefined || text === '') return '';
    const value = String(text);
    return value.length > max ? value.substring(0, max) + '...' : value;
}

// The reference's BoolConverter reads "1"/"true" as true; these payloads carry either.
function truthy(value) {
    return value === true || value === 1 || value === '1' || value === 'true';
}

// The reference's own bool printing: `$\"AC tagged: {item.IsAcItem}\"` is C# bool ToString.
function csBool(value) {
    return truthy(value) ? 'True' : 'False';
}

function yesNo(value) {
    return truthy(value) ? 'Yes' : 'No';
}

// InventoryItem.EquippableCategories / Weapons / EquippableNonWeapon.
const WEAPONS = ['Sword', 'Axe', 'Dagger', 'Gun', 'Bow', 'Mace', 'Polearm', 'Staff', 'Wand'];
const EQUIPPABLE_NON_WEAPON = ['Class', 'Armor', 'Helm', 'Cape', 'Pet', 'Misc'];

function isWeapon(category) { return WEAPONS.indexOf(category) !== -1; }

function isEquippableNonItem(category) { return EQUIPPABLE_NON_WEAPON.indexOf(category) !== -1; }

// InventoryItem.EnhancementNames - the five Luck ids, which win over the forge enum.
const ENHANCEMENT_NAMES = {
    52368: 'Luck Spiral Carve', 52369: 'Luck Awe Blast', 52370: 'Luck Health Vamp',
    52371: 'Luck Mana Vamp', 52372: 'Luck Powerword Die'
};

// InventoryItem.forgeID.
const FORGE_IDS = {
    71406: 'ForgeCape', 71543: 'Lament', 71542: 'Penitence', 70968: 'Vainglory',
    70969: 'Absolution', 70970: 'Avarice', 71537: 'ForgeHelm', 81467: 'Hearty',
    71539: 'Examen', 71541: 'Anima', 71540: 'Pneuma', 71538: 'Vim', 70753: 'ForgeWeapon',
    76979: 'Praxis', 76980: 'Dauntless', 83500: 'Ravenous', 71628: 'Acheron',
    71629: 'Elysium', 70751: 'Smite', 70752: 'Valiance', 70991: 'Arcana',
    70750: 'Lacerate'
};

/** The reference's `Enhancement: {enhName ?? "Unknown"}`. */
function enhancementName(id) {
    const key = Number(id) || 0;
    return ENHANCEMENT_NAMES[key] || FORGE_IDS[key] || 'Unknown';
}

/** A payload that may be an array, a {items} object or a map keyed by id, as a list. */
function asList(payload) {
    if (payload === null || payload === undefined) return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.$values)) return payload.$values;
    if (typeof payload !== 'object') return [];
    return Object.keys(payload)
        .map(function (key) { return payload[key]; })
        .filter(function (value) { return value && typeof value === 'object'; });
}

function nameOf(item) {
    // InventoryItem, TempItem and Monster all trim their name on read.
    return String(item.sName === undefined || item.sName === null ? '' : item.sName).trim();
}

function node(text, extra) {
    return Object.assign({ text: text, children: [] }, extra || {});
}

function itemContext(item, extra) {
    return Object.assign({
        itemId: item.ItemID,
        name: nameOf(item),
        shopItemId: item.ShopItemID,
        category: item.sType,
        isAcItem: truthy(item.bCoins),
        cost: Number(item.iCost) || 0,
        qty: Number(item.iQty) || 0,
        file: item.sFile,
        link: item.sLink,
        equippable: isWeapon(item.sType) || isEquippableNonItem(item.sType)
    }, extra || {});
}

// ---------------------------------------------------------------- the eight grabbers

function grabShopItems(tree, payload) {
    const shops = asList(payload).slice().sort(function (a, b) {
        return String(a.sName) < String(b.sName) ? -1 : String(a.sName) > String(b.sName) ? 1 : 0;
    });
    const shopsOnly = Array.isArray(payload) ? shops : [payload];
    shopsOnly.forEach(function (shop) {
        if (!shop) return;
        const shopNode = node(String(shop.sName === undefined ? '' : shop.sName),
            { menu: 'shop', context: { id: shop.ShopID, name: shop.sName } });
        shopNode.children.push(node('ID: ' + shop.ShopID));
        shopNode.children.push(node('Location: ' + (shop.Location === undefined ? '' : shop.Location)));
        const items = asList({ items: shop.items });
        if (items.length) {
            const group = node('Items');
            items.forEach(function (item) {
                const row = node(nameOf(item) + (Number(item.iQty) > 1 ? ' x' + item.iQty : ''),
                    { menu: 'shopItem', context: itemContext(item, { shopId: shop.ShopID }) });
                row.children.push(node('Shop item ID: ' + item.ShopItemID));
                row.children.push(node('ID: ' + item.ItemID));
                row.children.push(node('Cost: ' + item.iCost + ' ' + (truthy(item.bCoins) ? 'AC' : 'Gold')));
                row.children.push(node('Category: ' + (item.sType === undefined ? '' : item.sType)));
                row.children.push(node('Level: ' + item.iLvl));
                row.children.push(node('Description: ' + shorten(item.sDesc, 32)));
                row.children.push(node('Stack: ' + item.iQty + '/' + item.iStk));
                if (isEquippableNonItem(item.sType) || isWeapon(item.sType)) {
                    row.children.push(node('sFile: ' + (item.sFile === undefined ? '' : item.sFile)));
                    row.children.push(node('sLink: ' + (item.sLink === undefined ? '' : item.sLink)));
                }
                group.children.push(row);
            });
            shopNode.children.push(group);
        }
        tree.push(shopNode);
    });
    return tree;
}

// Grabber.GrabItems, which GrabInventoryItems and GrabBankItems both call.
function grabItems(payload, menu) {
    return asList(payload)
        .slice()
        .sort(function (a, b) {
            return nameOf(a).toLowerCase() < nameOf(b).toLowerCase() ? -1
                : nameOf(a).toLowerCase() > nameOf(b).toLowerCase() ? 1 : 0;
        })
        .map(function (item) {
            const row = node(nameOf(item) + ' (' + item.ItemID + ')',
                { menu: menu || 'item', context: itemContext(item) });
            row.children.push(node('ID: ' + item.ItemID));
            row.children.push(node('Char item id: ' + (Number(item.CharItemID) || 0)));
            row.children.push(node('Quantity: ' + item.iQty + '/' + item.iStk));
            row.children.push(node('AC tagged: ' + csBool(item.bCoins)));
            row.children.push(node('Category: ' + (item.sType === undefined ? '' : item.sType)));
            row.children.push(node('Level: ' + item.iLvl));
            row.children.push(node('Description: ' + shorten(item.sDesc, 32)));
            if (isEquippableNonItem(item.sType) || isWeapon(item.sType)) {
                row.children.push(node('sFile: ' + (item.sFile === undefined ? '' : item.sFile)));
                row.children.push(node('sLink: ' + (item.sLink === undefined ? '' : item.sLink)));
                row.children.push(node('Enhancement: ' + enhancementName(item.iEnh)));
                row.children.push(node('Enhancement ID: ' + (Number(item.iEnh) || 0)));
            }
            return row;
        });
}

function grabTempItems(payload) {
    return asList(payload).slice().sort(function (a, b) {
        return nameOf(a).toLowerCase() < nameOf(b).toLowerCase() ? -1
            : nameOf(a).toLowerCase() > nameOf(b).toLowerCase() ? 1 : 0;
    }).map(function (item) {
        const row = node(nameOf(item) + ' [' + item.iQty + '/' + item.iStk + ']',
            { menu: 'wikiName', context: { name: nameOf(item) } });
        row.children.push(node('ID: ' + item.ItemID));
        row.children.push(node('Quantity: ' + item.iQty + '/' + item.iStk));
        return row;
    });
}

function questText(quest, orderBy) {
    return orderBy === 'Id'
        ? quest.QuestID + ' - ' + quest.sName
        : quest.sName + ' - ' + quest.QuestID;
}

function requiredItemRow(item) {
    const row = node(nameOf(item) + (Number(item.iQty) > 1 ? ' x' + item.iQty : ''),
        { menu: 'item', context: { itemId: item.ItemID, name: nameOf(item), qty: Number(item.iQty) || 0,
            isTemporary: truthy(item.bTemp) } });
    row.children.push(node('ID: ' + item.ItemID));
    row.children.push(node('Temporary: ' + yesNo(item.bTemp)));
    row.children.push(node('Description: ' + shorten(item.sDesc, 32)));
    return row;
}

function rewardRow(reward, quest) {
    const row = node(nameOf(reward) + (Number(reward.iQty) > 1 ? ' x' + reward.iQty : ''),
        { menu: 'item', context: { itemId: reward.ItemID, name: nameOf(reward),
            qty: Number(reward.iQty) || 0 } });
    row.children.push(node('ID: ' + reward.ItemID));
    row.children.push(node('Drop chance: ' + (String(reward.iRate).indexOf('100') !== -1
        ? 'Guaranteed' : reward.iRate + '%')));
    // quest.oRewards: the reward's own item record, matched by name.
    const detail = oRewardsOf(quest).filter(function (item) {
        return item.sName === reward.sName;
    })[0];
    if (detail) {
        row.children.push(node('Category: ' + (detail.sType === undefined ? '' : detail.sType)));
        row.children.push(node('Description: ' + shorten(detail.sDesc, 32)));
        if (detail.sFile && detail.sLink) {
            row.menu = 'itemBase';
            row.context = Object.assign({}, row.context, { file: detail.sFile, link: detail.sLink,
                category: detail.sType });
            row.children.push(node('sFile: ' + detail.sFile));
            row.children.push(node('sLink: ' + detail.sLink));
        }
    }
    return row;
}

/** Quest.oRewards: the raw object's per-slot item dictionaries flattened, by name. */
function oRewardsOf(quest) {
    const raw = quest.oRewards;
    if (!raw || typeof raw !== 'object') return [];
    const out = [];
    Object.keys(raw).forEach(function (slot) {
        const group = raw[slot];
        if (!group || typeof group !== 'object') return;
        Object.keys(group).forEach(function (key) {
            const item = group[key];
            if (item && typeof item === 'object') out.push(item);
        });
    });
    return out;
}

function grabQuests(payload, orderBy, idsOnly) {
    const quests = asList(payload).slice().sort(function (a, b) {
        if (orderBy === 'Id') return (Number(a.QuestID) || 0) - (Number(b.QuestID) || 0);
        return String(a.sName) < String(b.sName) ? -1 : String(a.sName) > String(b.sName) ? 1 : 0;
    });

    return quests.filter(function (quest) {
        return Number(quest.QuestID) !== 0;
    }).map(function (quest) {
        const required = Array.isArray(quest.RequiredItems) ? quest.RequiredItems : [];
        const row = node(questText(quest, orderBy), {
            menu: 'quest',
            context: { questId: quest.QuestID, iValue: quest.iValue, iSlot: quest.iSlot,
                requiredItems: (quest.RequiredItems === null || quest.RequiredItems === undefined)
                    ? null : required.map(function (item) {
                        return { name: nameOf(item), quantity: Number(item.iQty) || 0 };
                    }) }
        });
        if (idsOnly) return row;

        if (Number(quest.iSlot) > 0) row.children.push(node('iSlot: ' + quest.iSlot));
        if (Number(quest.iValue) > 0) row.children.push(node('iValue: ' + quest.iValue));
        row.children.push(node('Description: ' + shorten(quest.sDesc, 32)));

        if (required.length) {
            const group = node('Required items', { menu: 'aggregate',
                context: { items: required.map(function (item) {
                    return { name: nameOf(item), quantity: Number(item.iQty) || 0 };
                }) } });
            required.forEach(function (item) { group.children.push(requiredItemRow(item)); });
            row.children.push(group);
        }

        const rewards = Array.isArray(quest.reward) ? quest.reward : [];
        if (rewards.length) {
            const group = node('Rewards', { menu: 'aggregate',
                context: { items: rewards.map(function (reward) {
                    return { name: nameOf(reward), quantity: Number(reward.iQty) || 0 };
                }) } });
            rewards.forEach(function (reward) { group.children.push(rewardRow(reward, quest)); });
            row.children.push(group);
        }
        return row;
    });
}

function grabMonsters(payload, orderBy, all) {
    let list = asList(payload);
    if (!all) {
        // World.AvailableMonsters: GroupBy(MonMapID) then First of each group.
        const seen = {};
        list = list.filter(function (monster) {
            const key = String(monster.MonMapID);
            if (seen[key]) return false;
            seen[key] = true;
            return true;
        });
    }
    return list.slice().sort(function (a, b) {
        if (orderBy === 'Id') return (Number(a.MonMapID) || 0) - (Number(b.MonMapID) || 0);
        return nameOf(a) < nameOf(b) ? -1 : nameOf(a) > nameOf(b) ? 1 : 0;
    }).map(function (monster) {
        const cell = monster.Cell === undefined ? monster.cell : monster.Cell;
        const row = node(nameOf(monster) + (all ? ' (' + cell + ')' : ''),
            { menu: 'wikiName', context: { name: nameOf(monster) } });
        row.children.push(node('ID: ' + monster.MonID));
        row.children.push(node('MonMapID: ' + monster.MonMapID));
        row.children.push(node('Race: ' + (monster.sRace === undefined ? '' : monster.sRace)));
        row.children.push(node('Level: ' + monster.iLvl));
        row.children.push(node('Health: ' + monster.intHP + '/' + monster.intHPMax));
        return row;
    });
}

function rowsFor(target, payload, options) {
    const orderBy = options && options.orderBy === 'Id' ? 'Id' : 'Name';
    if (target === 'shopItems') return grabShopItems([], payload);
    if (target === 'questIds') return grabQuests(payload, orderBy, true);
    if (target === 'questItems') return grabQuests(payload, orderBy, false);
    if (target === 'inventoryItems') return grabItems(payload, 'item');
    if (target === 'bankItems') return grabItems(payload, 'item');
    if (target === 'tempItems') return grabTempItems(payload);
    if (target === 'monsters') return grabMonsters(payload, orderBy, false);
    if (target === 'allMonsters') return grabMonsters(payload, orderBy, true);
    return null;
}

/** The rows for one grab target, or a throw naming the target nobody knows. */
function buildRows(target, payload, options) {
    const rows = rowsFor(target, payload, options || {});
    if (rows === null) throw new Error('unknown grab target "' + target + '"');
    return rows;
}

// ---------------------------------------------------------------- search and the menus

/** Every node in the tree, parents before their children - the order CollectGrabSearchNodes walks. */
function flatten(rows) {
    const out = [];
    (function walk(list) {
        (list || []).forEach(function (row) {
            out.push(row);
            if (row.children && row.children.length) walk(row.children);
        });
    })(rows);
    return out;
}

/** Indices into flatten(rows) of every node whose text contains the keyword, case-insensitively. */
function findMatches(rows, keyword) {
    const needle = String(keyword == null ? '' : keyword);
    if (!needle.trim()) return [];
    const lower = needle.toLowerCase();
    const out = [];
    flatten(rows).forEach(function (row, index) {
        if (String(row.text).toLowerCase().indexOf(lower) !== -1) out.push(index);
    });
    return out;
}

/**
 * The reference's cycling search: it steps to the next match and wraps past the last one.
 * `current` is -1 before the first search on a keyword.
 */
function nextMatch(count, current) {
    if (!count) return -1;
    const next = Number(current) + 1;
    return next >= count || next < 0 ? 0 : next;
}

/** Grabber's own bypass packet for a quest (MenuQuest's Copy Bypass Packet). */
function bypassPacket(quest) {
    return '{"t":"xt","b":{"r":-1,"o":{"cmd":"updateQuest","iValue":' + quest.iValue +
        ',"iIndex":' + quest.iSlot + '}}}';
}

/** MenuItems / MenuQuest's "Copy all" pair of lines; `comma` is their one difference. */
function nameQuantityText(context, comma) {
    const items = (context && context.items) || [];
    const names = items.map(function (item) { return item.name; }).join(',');
    const quantities = items.map(function (item) { return item.quantity; }).join(',');
    return '"ItemName" : "' + names + '"' + (comma ? ',' : '') + '\n' +
        '"Quantity" : "' + quantities + '"';
}

function namesOf(context) {
    return ((context && context.items) || []).map(function (item) { return item.name; });
}

function quantitiesOf(context) {
    return ((context && context.items) || []).map(function (item) { return item.quantity; });
}

/**
 * The context menu for a row, exactly as the reference builds it. `kind` is the row's own menu
 * name and `context` what the row carries, so the page never has to know a menu's shape.
 */
function menu(kind, context) {
    const ctx = context || {};
    const name = ctx.name === undefined ? '' : ctx.name;
    if (kind === 'wikiName') {
        return [
            { label: 'Go to Wikipage', action: 'wikiPage', payload: { name: name } },
            { label: 'Search on Wiki', action: 'wikiSearch', payload: { name: name } },
            { label: 'Copy To Clipboard', action: 'copy', payload: { text: name } }
        ];
    }
    if (kind === 'shop') {
        return [
            { label: 'Go to Wikipage', action: 'wikiPage', payload: { name: name } },
            { label: 'Search on Wiki', action: 'wikiSearch', payload: { name: name } },
            { label: 'Load Shop', action: 'loadShop', payload: { id: ctx.id } }
        ];
    }
    if (kind === 'shopItem') {
        const items = [
            { label: 'Go to Wikipage', action: 'wikiPage', payload: { name: name } },
            { label: 'Search on Wiki', action: 'wikiSearch', payload: { name: name } }
        ];
        if (ctx.equippable) {
            items.push({ label: 'Equip SWF', action: 'equipSwf', payload: ctx });
        }
        if (ctx.shopId !== undefined && ctx.shopId !== null) {
            items.push({ label: ctx.isAcItem && Number(ctx.cost) > 0
                ? 'Buy This Item (warning costing ACs)'
                : 'Buy This Item', action: 'buyNow', payload: ctx });
            items.push({ label: 'Add buy command', action: 'addBuyCommand', payload: ctx });
        }
        return items;
    }
    if (kind === 'item' || kind === 'itemBase') {
        const items = [
            { label: 'Add to both', action: 'addToBoth', payload: { names: [name] } },
            { label: 'Add to whitelist', action: 'addToWhitelist', payload: { names: [name] } },
            { label: 'Add to unbank list', action: 'addToUnbank', payload: { names: [name] } },
            { label: 'Copy item name to clipboard', action: 'copy', payload: { text: name } },
            { label: 'Go to Wikipage', action: 'wikiPage', payload: { name: name } },
            { label: 'Search on Wiki', action: 'wikiSearch', payload: { name: name } }
        ];
        if (kind === 'itemBase') {
            items.push({ label: 'Equip SWF', action: 'equipSwf', payload: ctx });
        }
        return items;
    }
    if (kind === 'quest') {
        const id = ctx.questId;
        const items = [
            { label: 'Add to quest list', action: 'addQuest', payload: { id: id } },
            { label: 'Accept Quest', action: 'acceptQuest', payload: { id: id } },
            { label: 'Complete Quest (Once)', action: 'completeQuest',
                payload: { id: id, max: false, autoSelect: true } },
            { label: 'Load Quest', action: 'loadQuest', payload: { id: id } },
            { label: 'Complete Quest (Maxed)', action: 'completeQuest',
                payload: { id: id, max: true, autoSelect: false } }
        ];
        if (Array.isArray(ctx.requiredItems)) {
            items.push({ label: 'Copy all Reqs', action: 'copyAllReqs',
                payload: { names: ctx.requiredItems.map(function (i) { return i.name; }),
                    quantities: ctx.requiredItems.map(function (i) { return i.quantity; }) } });
            items.push({ label: 'Copy Bypass Packet', action: 'copyBypass',
                payload: { iValue: ctx.iValue, iSlot: ctx.iSlot } });
        }
        return items;
    }
    if (kind === 'aggregate') {
        // The reference's own three adders all call AddDrops, including the unbank one - a
        // defect it ships (Grabber.AddDrops / AddDrops / AddDrops in MenuItems). Kept as it is.
        return [
            { label: 'Add all to both', action: 'addAllToBoth',
                payload: { names: namesOf(ctx), quantities: quantitiesOf(ctx) } },
            { label: 'Add all to whitelist', action: 'addAllToWhitelist',
                payload: { names: namesOf(ctx), quantities: quantitiesOf(ctx) } },
            { label: 'Add all to unbank list', action: 'addAllToUnbank',
                payload: { names: namesOf(ctx), quantities: quantitiesOf(ctx) } },
            { label: 'Search all on Wiki', action: 'searchAllOnWiki',
                payload: { names: namesOf(ctx) } },
            { label: 'Copy all', action: 'copyAll',
                payload: { names: namesOf(ctx), quantities: quantitiesOf(ctx) } }
        ];
    }
    return [];
}

module.exports = {
    LOAD_TARGETS: LOAD_TARGETS,
    GRAB_TARGETS: GRAB_TARGETS,
    ORDER_BY: ORDER_BY,
    LOAD_DEFAULT_INDEX: LOAD_DEFAULT_INDEX,
    orderable: orderable,
    questList: questList,
    parseQuestList: parseQuestList,
    shorten: shorten,
    asList: asList,
    enhancementName: enhancementName,
    buildRows: buildRows,
    flatten: flatten,
    findMatches: findMatches,
    nextMatch: nextMatch,
    bypassPacket: bypassPacket,
    nameQuantityText: nameQuantityText,
    menu: menu,
    wikiUrl: wikiUrl,
    wikiSearchUrl: wikiSearchUrl
};
