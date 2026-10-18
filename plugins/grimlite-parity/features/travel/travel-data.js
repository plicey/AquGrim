// The Fast travels window's tables (ticket #32). Data, not code: every label, map, cell, pad and
// shop id below is the reference's own, read off Grimoire/UI/Travel.cs - the handlers for the
// triples, the designer's control tree for the groups and their order.
//
// Why a table: the window's whole surface is "which places exist", so the port's test can assert
// the reference's destinations one by one instead of trusting a screenshot.
//
// The reference reaches the game through its own loader, which is a renaming layer over the stock
// game (ticket #48): Player.Join is world.gotoTown(map, cell, pad), Player.Jump is
// world.moveToCell(cell, pad), Shops.Load is world.sendLoadShopRequest(id), Quests.Load is
// world.showQuests([id], "q"). Every one of those names is implemented in
// plugins/grimlite-parity/loader-surface.js, so nothing in this window waits on a helper the
// bridge does not carry.

// The client-side "fake quest progress" frame the reference injects. This is its own literal, and
// four places in the reference build the same shape (Travel.cs:813-823, BotManager.cs:2408-2417,
// Grabber.cs:572-579 and the shipped .gbot corpus), which is why it is built in one place here.
function questFrame(iValue, iSlot) {
    return '{"t":"xt","b":{"r":-1,"o":{"cmd":"updateQuest","iValue":' + iValue +
        ',"iIndex":' + iSlot + '}}}';
}

// Bypass All's own key list: the reference blanks one key per index, named "strQuests" for the
// first and "strQuests" + i for the rest, i running 1..7 - which is these seven keys.
const PROGRESS_PREFIX = 'world.myAvatar.objData.';
const PROGRESS_KEYS = [
    'strQuests', 'strQuests2', 'strQuests3', 'strQuests4', 'strQuests5', 'strQuests6', 'strQuests7'
];
const BLANK_CHARACTER = 'Z';

// The one raw frame to the server in this window: DoomvaultB's achievement (Travel.cs:817). It
// goes out through the relay rather than through the client, which is why it is not a questFrame.
const DOOMVAULT_ACHIEVEMENT = '%xt%zm%setAchievement%79%ia0%18%1%';

// A button's steps are the whole sequence the reference runs, in its own order, with the travel
// itself as one of them: the four "skip the gate" buttons send a frame, wait, then travel, and
// DoomvaultB interleaves a server frame between two client ones.
//   {quest: [iValue, iSlot]}  a client-side updateQuest frame
//   {server: '<frame>'}       a raw frame written to the server
//   {sleep: ms}               Task.Delay
//   {travel: true}            the map join or walk this button is for
const GROUPS = [
    {
        id: 'travels',
        // chkPriv "Private" with numPriv sit at the top of this group and number the room for
        // every button under them.
        label: 'Fast travels',
        // The designer's own columns: grpTravel is at x=13, both other boxes at x=183.
        column: 'left',
        private: true,
        buttons: [
            { id: 'tercess', label: 'Oblivion (tercess)', travel: { map: 'tercessuinotlim', cell: 'Enter', pad: 'Spawn' }, steps: [{ travel: true }] },
            { id: 'twins', label: 'Twins (tercess)', travel: { map: 'tercessuinotlim', cell: 'Twins', pad: 'Left' }, steps: [{ travel: true }] },
            { id: 'taro', label: 'VHL/Taro/Zee (tercess)', travel: { map: 'tercessuinotlim', cell: 'Taro', pad: 'Left' }, steps: [{ travel: true }] },
            { id: 'swindle', label: 'Swindle (tercess)', travel: { map: 'tercessuinotlim', cell: 'Swindle', pad: 'Left' }, steps: [{ travel: true }] },
            { id: 'nulgath', label: 'Nulgath / Skew (tercess)', travel: { map: 'tercessuinotlim', cell: 'Boss2', pad: 'Right' }, steps: [{ travel: true }] },
            { id: 'polish', label: 'Polish (tercess)', travel: { map: 'tercessuinotlim', cell: 'm12', pad: 'Top' }, steps: [{ travel: true }] },
            { id: 'carnage', label: 'Carnage / Ninja (tercess)', travel: { map: 'tercessuinotlim', cell: 'm4', pad: 'Top' }, steps: [{ travel: true }] },
            { id: 'lae', label: 'Lae (tercess)', travel: { map: 'tercessuinotlim', cell: 'm5', pad: 'Top' }, steps: [{ travel: true }] },
            // btnBinky_Click moves quest 20's progress first: without it the room refuses entry.
            {
                id: 'binky', label: 'Binky (doomvault)',
                travel: { map: 'doomvault', cell: 'r5', pad: 'Left' },
                steps: [{ quest: [20, 126] }, { travel: true }]
            },
            { id: 'dage', label: 'Dage', travel: { map: 'underworld', cell: 's1', pad: 'Left' }, steps: [{ travel: true }] },
            { id: 'escherion', label: 'Escherion', travel: { map: 'escherion', cell: 'Boss', pad: 'Left' }, steps: [{ travel: true }] },
            { id: 'klunk', label: 'Klunk (underworld)', travel: { map: 'underworld', cell: 'r11', pad: 'Left' }, steps: [{ travel: true }] },
            // btnUltras: no travel at all - it asks the game for the sixteen quests below.
            { id: 'ultras', label: 'Ultraboss & Daily', quests: true },
            // darkButton1, the group's last control, wired to chkBypass_clicked.
            { id: 'bypassAll', label: 'Bypass All', bypassAll: true }
        ]
    },
    {
        id: 'awe',
        // "Awe Enchantment Shop": a radio grid plus the one shop button, which loads the shop of
        // whichever radio is selected. The reference's museum join is commented out upstream
        // ("Staircase to hell"), so the shop opens from wherever the character stands.
        label: 'Awe Enchantment Shop',
        column: 'right',
        awe: true,
        buttons: [{ id: 'aweShop', label: 'Awe Shop (museum)', awe: true }]
    },
    {
        id: 'travels2',
        label: 'Fast travels 2',
        column: 'right',
        buttons: [
            // DoomvaultB is the longest: progress, an achievement frame to the server, the rest of
            // the progress, then the room - and it joins the map directly rather than through the
            // UI's ExecuteTravel, so it has no trailing wait.
            {
                id: 'doomvaultb', label: 'DoomvaultB',
                travel: { map: 'doomvaultb', cell: 'Enter', pad: 'Spawn' },
                steps: [
                    { quest: [20, 126] }, { sleep: 500 },
                    { server: DOOMVAULT_ACHIEVEMENT }, { sleep: 1000 },
                    { quest: [27, 127] }, { sleep: 500 },
                    { travel: true }
                ]
            },
            // The other four are SkipMap: one frame, a one-second wait, the travel, and then the
            // 1000 ms their own ExecuteTravel loop waits after every command.
            {
                id: 'treetitanbattle', label: 'Treetitanbattle',
                travel: { map: 'treetitanbattle', cell: 'Enter', pad: 'Spawn' },
                steps: [{ quest: [30, 196] }, { sleep: 1000 }, { travel: true }, { sleep: 1000 }]
            },
            {
                id: 'ultradrakath', label: 'Ultradrakath',
                travel: { map: 'ultradrakath', cell: 'Enter', pad: 'Spawn' },
                steps: [{ quest: [30, 182] }, { sleep: 1000 }, { travel: true }, { sleep: 1000 }]
            },
            {
                id: 'towerofdoom10', label: 'Tower of Doom 10',
                travel: { map: 'towerofdoom10', cell: 'Enter', pad: 'Spawn' },
                steps: [{ quest: [30, 159] }, { sleep: 1000 }, { travel: true }, { sleep: 1000 }]
            },
            {
                id: 'necrodungeon', label: 'Necrodungeon',
                travel: { map: 'necrodungeon', cell: 'Enter', pad: 'Spawn' },
                steps: [{ quest: [30, 77] }, { sleep: 1000 }, { travel: true }, { sleep: 1000 }]
            }
        ]
    }
];

// The tercess entry cell every tercess destination is reached through, and the map it belongs to:
// CreateJoinCommand walks there before it joins one of them.
const TERCESS = { map: 'tercessuinotlim', entry: { cell: 'm22', pad: 'Left' } };

// chkPriv + numPriv: unchecked joins the bare map, checked appends "-<number>" to it
// (CreateJoinCommand). The numeric box's range is the designer's own (Maximum 1000000, the value
// it opens with 100000).
const PRIVATE = { label: 'Private', value: 100000, max: 1000000 };

// darkGroupBox2, "Map Bypasser". Its labels are the reference's own control text; "Send" is this
// port's addition, because the reference sends the packet on Unlock and offers no way to re-send
// one that is already in the box.
const BYPASSER = {
    label: 'Map Bypasser',
    hint: 'Story Quest ID that required to unlock the map',
    unlock: 'Unlock',
    packetLabel: 'Generated packet',
    copy: 'Copy',
    send: 'Send'
};

// The enchantment types, in the order the designer lays them out in its two-column grid (row 0:
// Lucky, Thief; row 1: Hybrid, Healer; row 3: Fighter, Wizard - the designer's row 2 is empty).
// Each shop id is what AweTravel_Click's own ternary chain passes to CmdLoadTravel.
const AWE_TYPES = [
    { id: 'lucky', label: 'Lucky', shopId: 639, checked: true },
    { id: 'thief', label: 'Thief', shopId: 637, checked: false },
    { id: 'hybrid', label: 'Hybrid', shopId: 633, checked: false },
    { id: 'healer', label: 'Healer', shopId: 638, checked: false },
    { id: 'fighter', label: 'Fighter', shopId: 635, checked: false },
    { id: 'wizard', label: 'Wizard', shopId: 636, checked: false }
];

// btnUltras's own list, in its own order: three equipment quests, then the daily pair, then the
// weekly run.
const ULTRA_QUESTS = [
    8152, 8153, 8154, 9350, 9803, 1677, 1678,
    8653, 9091,
    8300, 8397, 8547, 8692, 8746, 9173, 10301
];

/** Every button in the window, the groups flattened - the page draws groups, the logic runs ids. */
function buttons() {
    return GROUPS.reduce(function (all, group) { return all.concat(group.buttons); }, []);
}

// Every tercess destination is reached through tercess's entry cell first, because the reference's
// CreateJoinCommand walks there whenever it is asked for tercess from somewhere else. Derived from
// the map rather than repeated on each row, so a new tercess button cannot forget it.
//
// groupId travels with each button for the same reason, from the other direction: the window hands
// the page the groups and the buttons as two separate lists (IPC copies them, so they share no
// objects), and a page that had to guess which group a button belongs to would draw it twice or
// not at all.
const BUTTONS = GROUPS.reduce(function (all, group) {
    return all.concat(group.buttons.map(function (entry) {
        const owned = Object.assign({}, entry, { groupId: group.id });
        if (!entry.travel || entry.travel.map !== TERCESS.map) return owned;
        return Object.assign(owned, { travel: Object.assign({ tercessEntry: true }, entry.travel) });
    }));
}, []);

/** One button by id, or null: the window refuses an id it does not carry. */
function button(id) {
    return BUTTONS.filter(function (entry) { return entry.id === id; })[0] || null;
}

module.exports = {
    GROUPS: GROUPS,
    BUTTONS: BUTTONS,
    PRIVATE: PRIVATE,
    BYPASSER: BYPASSER,
    AWE_TYPES: AWE_TYPES,
    ULTRA_QUESTS: ULTRA_QUESTS,
    TERCESS: TERCESS,
    PROGRESS_PREFIX: PROGRESS_PREFIX,
    PROGRESS_KEYS: PROGRESS_KEYS,
    BLANK_CHARACTER: BLANK_CHARACTER,
    DOOMVAULT_ACHIEVEMENT: DOOMVAULT_ACHIEVEMENT,
    questFrame: questFrame,
    buttons: buttons,
    button: button
};
