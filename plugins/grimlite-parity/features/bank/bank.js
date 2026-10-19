// The Bank window's decisions (ticket #29). Reference: Grimoire/UI/BankForm.cs and
// BankForm.Designer.cs. This module is the whole of the window's logic, so the tests can drive
// it without a game: it never reaches Flash itself, it does the work through the injected
// bridge (see ../bridge.js).
//
// The reference's "bank all except selected" weapon branch is unreachable: when the combo holds
// "Weapons", a weapon's own category is never the literal "Weapons", so its second test
// (`i.Category != category`) matches and the item is banked by the ordinary branch. The result is
// that Weapons in except-mode means every matching item, weapons included, and that is what this
// reproduces.

const CATEGORIES = [
    'Weapons',
    'Sword',
    'Axe',
    'Dagger',
    'Gun',
    'Bow',
    'Mace',
    'Polearm',
    'Staff',
    'Wand',
    'Class',
    'Armor',
    'Helm',
    'Cape',
    'Item'
];

const WEAPON_CATEGORIES = ['Sword', 'Axe', 'Dagger', 'Gun', 'Bow', 'Mace', 'Polearm', 'Staff', 'Wand'];

const AC_CHOICES = ['ACs', 'Non-ACs'];

// The reference's own pacing: 70 ms between category transfers, 100 ms between Bank All ones.
const CATEGORY_DELAY_MS = 70;
const ALL_DELAY_MS = 100;

// The one item name the reference refuses in the category transfer (`Name.ToLower()`).
const NEVER_BANKED_BY_CATEGORY = 'treasure potion';

const MESSAGES = {
    category: 'Please select Item type',
    ac: 'Please select AC or Non-AC'
};

function isWeaponCategory(category) {
    return WEAPON_CATEGORIES.indexOf(category) !== -1;
}

/** The category combo's own validation: category first, then the AC choice. */
function validateCategory(selection) {
    const chosen = selection || {};
    if (!chosen.category) return MESSAGES.category;
    if (typeof chosen.ac !== 'boolean') return MESSAGES.ac;
    return null;
}

/** Bank All has no category, so it only ever asks for the AC choice. */
function validateAcChoice(selection) {
    const chosen = selection || {};
    return typeof chosen.ac === 'boolean' ? null : MESSAGES.ac;
}

/**
 * The reference's own filter, shared by both buttons' category branch: the chosen AC-ness, not
 * being worn, and not the treasure potion.
 */
function matchesable(item, isAc) {
    return item.isAcItem === isAc &&
        !item.isEquipped &&
        String(item.name).toLowerCase() !== NEVER_BANKED_BY_CATEGORY;
}

/**
 * Which items the Bank button would move, in inventory order. `allExcept` inverts the category
 * test - the Weapons entry meaning every weapon category, as it does in the reference - and
 * keeps the AC, worn and treasure-potion rules exactly as they are.
 */
function selectCategory(inventory, selection) {
    const chosen = selection || {};
    const items = Array.isArray(inventory) ? inventory : [];
    const isAc = chosen.ac === true;
    const allExcept = chosen.allExcept === true;

    return items.filter(function (item) {
        if (!matchesable(item, isAc)) return false;
        const isWeapons = chosen.category === 'Weapons';
        const inCategory = isWeapons
            ? isWeaponCategory(item.category)
            : item.category === chosen.category;
        if (!allExcept) return inCategory;
        // BankForm.cs: the "Weapons" special case tests `!wep.Contains`, which a weapon fails -
        // and then the fall-through `i.Category != "Weapons"` banks it anyway.
        return isWeapons ? true : !inCategory;
    }).map(function (item) {
        return item.name;
    });
}

/**
 * Move one name to the bank, waiting after every transfer (the reference delays inside its
 * loop, so the last item is followed by a wait too - the next click finds the server quiet).
 * A refusal from the game stops the run and is reported with what already moved, rather than
 * being dropped (the reference's async void handlers swallow it).
 */
async function transferAll(game, names, delayMs, sleep) {
    let transferred = 0;
    for (let i = 0; i < names.length; i++) {
        try {
            await game.transferToBank(names[i]);
        } catch (error) {
            return {
                transferred: transferred,
                total: names.length,
                error: (error && error.message) || String(error)
            };
        }
        transferred++;
        await sleep(delayMs);
    }
    return { transferred: transferred, total: names.length, error: null };
}

/**
 * The Bank button. Returns { transferred, total, error } - total being what was selected, so
 * the window can report completion.
 */
async function bankCategory(game, selection) {
    const chosen = selection || {};
    const refusal = validateCategory(chosen);
    if (refusal) return { transferred: 0, total: 0, error: refusal };

    const inventory = await game.readInventory();
    return transferAll(game, selectCategory(inventory, chosen), CATEGORY_DELAY_MS, game.sleep);
}

/**
 * The Bank All button: everything matching the AC choice. The reference gates the non-AC half
 * on free bank space, re-reading it before every item, and never gates the AC half.
 */
async function bankAll(game, selection) {
    const chosen = selection || {};
    const refusal = validateAcChoice(chosen);
    if (refusal) return { transferred: 0, total: 0, error: refusal };

    const inventory = await game.readInventory();
    const isAc = chosen.ac === true;
    const names = [];
    for (let i = 0; i < inventory.length; i++) {
        const item = inventory[i];
        if (item.isEquipped || item.isAcItem !== isAc) continue;
        if (!isAc) {
            const slots = await game.readBankSlots();
            // A known-full bank skips the item; an unknown count (`used: null`, which is what a
            // game that cannot report its usage gives) attempts it and lets the game decide,
            // rather than reporting a full bank it never measured.
            if (slots && slots.used !== null && slots.total - slots.used <= 0) continue;
        }
        names.push(item.name);
    }
    return transferAll(game, names, ALL_DELAY_MS, game.sleep);
}

module.exports = {
    CATEGORIES: CATEGORIES,
    WEAPON_CATEGORIES: WEAPON_CATEGORIES,
    AC_CHOICES: AC_CHOICES,
    CATEGORY_DELAY_MS: CATEGORY_DELAY_MS,
    ALL_DELAY_MS: ALL_DELAY_MS,
    MESSAGES: MESSAGES,
    validateCategory: validateCategory,
    validateAcChoice: validateAcChoice,
    selectCategory: selectCategory,
    bankCategory: bankCategory,
    bankAll: bankAll
};
