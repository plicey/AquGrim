// The reference's hotkey action vocabulary and its key picker, transcribed.
// Reference: Grimlite-Li 816d9cd, Grimoire/UI/Hotkeys.cs.
//
// Two facts make this file a data file rather than code:
//
//   1. The INDICES ARE THE FILE FORMAT. A saved hotkey stores ActionIndex (Hotkey.cs's
//      {Text, Key, ActionIndex}), so the order below is what a `hotkeys.json` from the reference
//      means. Nothing may be reordered or inserted except at the end.
//   2. The reference's key list is single keys only (Hotkeys.cs:328-384) - no Ctrl or Shift
//      combination is offered - because its picker is a plain list of one key each.
//
// Two of the keys the reference offers, bare Alt and Shift, cannot be registered on their own by
// this app's shortcut layer; acceleratorFor() answers null for them so the window refuses the
// binding with that reason instead of accepting a key that would never fire.

const ACTIONS = [
    { label: 'Start/Stop Bot' },
    { label: 'Show Bot' },
    { label: 'Show Hotkeys' },
    { label: 'Show Loaders' },
    { label: 'Show Packet Logger' },
    { label: 'Show Packet Spammer' },
    { label: 'Show Packet Tamperer' },
    { label: 'Show Fast Travels' },
    { label: 'Show Maid' },
    { label: 'Start/Stop Maid' },
    { label: 'Change Launcher Skin' },
    { label: 'Cancel Target' },
    { label: 'Minimize to tray' },
    { label: 'Show Bank' },
    { label: 'Show Cosmetics form' },
    { label: 'Show Logs' },
    { label: 'Show Notepad' },
    { label: 'Load Hair shop' },
    { label: 'Load Armor Customizer' },
    { label: 'Toggle Options' },
    { label: 'Show DropUi' },
    { label: 'Show Swf Dev test' },
    { label: 'Start/Stop AutoAttack' }
];

// Hotkeys.cs:328-384, in that order.
const KEYS = [].concat(
    ['Escape', 'Left', 'Up', 'Right', 'Down'],
    ['D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8', 'D9'],
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''),
    ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
    ['Alt', 'Tab', 'Shift']
);

// Bare modifiers have no standalone accelerator in Electron: `toKeyEvent('Alt')` yields a bare
// altKey flag, which never compares equal to a real keypress.
const BARE_MODIFIERS = { Alt: true, Shift: true, Control: true, Ctrl: true, Meta: true };

/**
 * The accelerator this app's shortcut layer registers for a reference key name, or null when the
 * name is not one this app can bind on its own.
 * @param {string} key a name from KEYS
 * @returns {string|null}
 */
function acceleratorFor(key) {
    const name = key == null ? '' : String(key);
    if (BARE_MODIFIERS[name]) return null;
    const digit = /^D([0-9])$/.exec(name);
    if (digit) return digit[1];
    return KEYS.indexOf(name) === -1 ? null : name;
}

function byIndex(index) {
    const number = Number(index);
    if (!isFinite(number) || number < 0 || number >= ACTIONS.length) return null;
    return ACTIONS[number];
}

/** The window title of the reference's action, as Hotkeys.cs builds its Text field. */
function labelFor(key, actionIndex) {
    const action = byIndex(actionIndex);
    return action ? key + ': ' + action.label : String(key);
}

module.exports = {
    ACTIONS: ACTIONS,
    KEYS: KEYS,
    acceleratorFor: acceleratorFor,
    byIndex: byIndex,
    labelFor: labelFor
};
