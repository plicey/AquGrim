exports.dialogMessages = {
    helpDetailExtra: function (k) {
        function expand(keyb) {
            if (Array.isArray(keyb)) return keyb.join(', ');
            return keyb || '';
        }
        return 'Grimlite Parity\n' +
            expand(k.grimliteBotFile) + ' - Bot file: open and save a .gbot\n' +
            expand(k.grimliteBank) + ' - Bank window\n' +
            expand(k.grimliteLoaders) + ' - Loaders and grabbers: load a shop, a quest or\n' +
            '                the armour customizer, and grab live game data into a tree\n' +
            expand(k.grimliteBotManager) + ' - Bot Manager: the eleven-tab bot editor\n' +
            expand(k.grimliteEyedropper) + ' - Eye Dropper: read a colour off the screen\n' +
            expand(k.grimliteNotepad) + ' - Notepad\n' +
            expand(k.grimliteAbout) + ' - About this port and the reference it follows\n' +
            'Packets -> Sniffer - Packet logger (client and server traffic)\n' +
            'Packets -> Spammer - Packet spammer (repeat a saved list)\n' +
            'Packets -> Tamperer - Packet Tamperer (edit and inject a frame)\n' +
            expand(k.grimliteParityPlaceholder) + ' - Parity placeholder window\n' +
            expand(k.grimliteParityDevTest) + ' - Dev Test (call a game function)\n' +
            expand(k.grimliteOptions) + ' - Options: the reference\'s own option toggles\n' +
            expand(k.grimliteHotkeys) + ' - Hotkeys: bind one key to one action\n' +
            expand(k.grimliteDrop) + ' - Drop Ui: what has dropped, and taking it\n' +
            expand(k.grimliteFastTravels) + ' - Fast travels: the destination buttons and the map bypasser\n' +
            expand(k.grimliteMaid) + ' - Maid Remake: the party assistant (Alt+Shift+U unfollow, Alt+Shift+X stop attack)';
    }
};

exports.menuMessages = {
    grimliteMenu: 'Grimlite',
    grimliteBotFile: 'Bot file',
    grimliteBotManager: 'Bot Manager',
    grimliteEyedropper: 'Eye Dropper',
    grimliteNotepad: 'Notepad',
    grimliteAbout: 'About',
    grimliteCharSelect: 'Char Select',
    grimliteBank: 'Bank',
    grimliteLoaders: 'Loaders/grabbers',
    grimliteSets: 'Sets',
    grimliteCosmetics: 'Cosmetics',
    grimliteOptions: 'Options',
    grimliteHotkeys: 'Hotkeys',
    grimliteDrop: 'Drop Ui',
    grimliteTravels: 'Fast travels',
    grimlitePlaceholder: 'Parity placeholder window',
    grimliteDevTest: 'Dev Test',
    packetsMenu: 'Packets',
    packetsSniffer: 'Sniffer',
    packetsSpammer: 'Spammer',
    packetsTamperer: 'Tamperer'
};

// The bot file window and the dialogs it opens. Titles match the reference's own dialogs
// ("Load bot" / "Save bot", filter "Grimoire bots|*.gbot").
exports.botFileMessages = {
    title: 'Bot file',
    open: 'Open bot',
    save: 'Save bot',
    revert: 'Revert',
    opened: 'Opened. Edits are saved back through Save bot.',
    saved: 'Saved.',
    unchanged: 'Nothing to revert to.',
    notABot: 'That file is not a readable bot.',
    openTitle: 'Load bot',
    saveTitle: 'Save bot',
    filterName: 'Grimlite bots'
};

exports.windowTitles = {
    primary: 'AquaStar - Grimlite Parity',
    botFile: 'Grimlite Parity - Bot File',
    bank: 'Grimlite Parity - Bank',
    loaders: 'Grimlite Parity - Loaders and grabbers',
    sets: 'Grimlite Parity - Set',
    botManager: 'Bot Manager',
    placeholder: 'Grimlite Parity - Placeholder',
    eyedropper: 'Grimlite Parity - Eye Dropper',
    notepad: 'Grimlite Parity - Notepad',
    about: 'Grimlite Parity - About',
    charSelect: 'Grimlite Parity - Char Select',
    cosmetics: 'Grimlite Parity - SWF Cosmetics',
    options: 'Options',
    hotkeys: 'Hotkeys',
    drop: 'DropList',
    travels: 'Fast travels',
    maid: 'Maid Remake',
    devtest: 'Dev Test',
    packetLogger: 'Packet logger',
    packetSpammer: 'Packet spammer',
    packetTamperer: 'Packet Tamperer'
};

// The Bank window (ticket #29). The reference's own labels, verbatim from
// Grimoire/UI/BankForm.Designer.cs: "What to bank (optional)", "AC or Non-AC", "Bank all
// except selected", "Bank", "Bank All". The two refusals are the logic's.
exports.bankMessages = {
    title: 'Bank',
    categoryLabel: 'What to bank (optional)',
    acLabel: 'AC or Non-AC',
    allExcept: 'Bank all except selected',
    bank: 'Bank',
    bankAll: 'Bank All',
    working: 'Banking...',
    done: 'Transferred {n} of {t} item(s).',
    failed: 'That transfer did not run.'
};

// The Sets window (ticket #29). The reference's own control words from
// Grimoire/UI/Set.Designer.cs: "Add", "Clear", "Save", "Load", and its "R" refresh glyph.
exports.setsMessages = {
    window: {
        title: 'Set',
        refresh: 'R',
        add: 'Add',
        clear: 'Clear',
        save: 'Save',
        load: 'Load',
        equip: 'Equip',
        setHeading: 'Set',
        savedHeading: 'Saved sets'
    },
    added: 'Added to the set.',
    cleared: 'Cleared.',
    saved: 'Saved.',
    loaded: 'Loaded.',
    equipped: 'Equipped {n} item(s).',
    openTitle: 'Load Set',
    saveTitle: 'Save Set',
    filterName: 'Grimoire sets'
};

// Read by the Settings window (see res/features/settings/settings.html): the smoke keys the
// platform looks for live under settingsMessages, like the bundled game plugin's.
exports.settingsMessages = {
    labels: {},
    optionLabels: {
        packetSteering: 'Steer game traffic through a local relay'
    },
    optionHints: {
        packetSteering: 'Points the game at a local relay, so the packet tools can see the game\'s own ' +
            'traffic. The relay answers Flash\'s policy request itself and forwards to the real ' +
            'servers; nothing is modified. While this is on, the account password crosses the local ' +
            'relay in plaintext, exactly as it already crosses the network. Restart to apply.'
    },
    settingsSections: {
        packets: 'Packets'
    }
};

exports.notepadMessages = {
    hint: 'Drop a text file here to append it. Type debugskill for the equipped class\'s skill actions, or mapitems for the known map-item ids.',
    noGame: 'Nothing to dump yet: the game is not being read.',
    saveTitle: 'Save notepad',
    savedAs: 'Saved to {path}',
    saveFailed: 'Could not save: {error}'
};

exports.eyedropperMessages = {
    capturing: 'Reading the screen…',
    captureFailed: 'Could not read the screen.',
    hint: 'Click the button, then the pixel you want.'
};

exports.aboutMessages = {
    reloadHint: 'Reloads the game movie, like the reference\'s Load Game SWF.'
};

// The Bot Manager window: the reference's own control captions are the sheet's (bot/tabs.js);
// these are the strings that window draws itself - its chrome, its four right-click entries and
// the labels of the generated dialogs.
exports.botManagerMessages = {
    title: 'Bot Manager',
    load: 'Load bot',
    save: 'Save bot',
    ok: 'OK',
    cancel: 'Cancel',
    raw: 'Raw Command Editor',
    copy: 'Copy commands as text',
    copyHint: 'Copied. Use Ctrl+V in this window to put it back.',
    paste: 'Paste',
    pasteHint: 'Paste a copied bot or command, then OK.',
    opened: 'Opened.',
    saved: 'Saved.',
    customizer: 'Command Customizer',
    fonts: 'Change Fonts',
    multiline: 'Multiline Toggle',
    tabpages: 'Toggle Tabpages',
    addFolder: 'Folder name',
    numberOfBots: 'Number of Bots: ',
    empty: 'No bot is open. Load one, or drop a .gbot on the list.',
    rowHint: 'Double-click a command to edit it. Ctrl+click inserts above; Alt+click takes the variant.',
    colour: 'Colour',
    centered: 'Centered',
    size: 'Commands size',
    saveSize: 'Save Size',
    chooseDirectoryTitle: 'Choose your bots directory',
    addFolderFailed: 'That folder could not be added.',
    read: 'Read from the game.',
    botStarted: 'Bot started.',
    botStopped: 'Bot stopped.'
};

// The Cosmetics window (ticket #30). The slot labels, the list's own row words and the button
// words are the reference's; only the sentences a page needs are written here.
exports.cosmeticsMessages = {
    title: 'SWF Cosmetics',
    loadSet: 'Load Set',
    saveSet: 'Save Set',
    filterName: 'Grimoire sets',
    grabLinks: {
        helm: 'Grab Helm',
        armor: 'Grab Armor',
        class: 'Grab Class',
        weapon: 'Grab Wep',
        pet: 'Grab Pet',
        cape: 'Grab Cape',
        misc: 'Grab Ground'
    }
};

// The Options window (ticket #34). The seven toggle labels and "Walkspeed" are the reference's
// own (Root.cs:1007-1104); the rest is what a page needs to explain itself.
exports.optionsMessages = {
    title: 'Options',
    walkSpeed: 'Walkspeed',
    start: 'Start applying',
    stop: 'Stop applying',
    stopped: 'The option loop is stopped. Ticks are remembered and sent again when it starts.'
};

// The Hotkeys window (ticket #34). Hotkeys.cs's own words are Save / Add / Remove and the
// window title "Hotkeys"; its two combos carry the vocabulary in actions.js.
exports.hotkeysMessages = {
    title: 'Hotkeys',
    add: 'Add',
    remove: 'Remove',
    save: 'Save',
    saved: 'Saved $1 binding(s).',
    empty: 'Nothing is bound yet.',
    selectFirst: 'Select a binding first.'
};

// The drop list window (ticket #33). Every word is the reference's own control text from
// DropUi.Designer.cs - the four column headers, its three buttons, its tickbox and its count
// label - plus the one dialog DropUi.btnClear_Click puts in front of Clear.
exports.dropsMessages = {
    title: 'DropList',
    name: 'Name',
    qty: 'Qty',
    category: 'Category',
    flags: 'AC | Member',
    take: 'Take Drop',
    blacklist: 'Reject & Blacklist',
    clear: 'Clear',
    rejectInGame: 'Reject ingame drop',
    count: 'Drop count :',
    pickFirst: 'Select a drop first.',
    working: 'Taking...',
    taken: 'Took {n} drop(s).',
    rejectedN: 'Held {n} name(s) for this session.',
    cleared: 'Cleared.',
    confirmTitle: 'Caution',
    confirmMessage: 'This action will clear all Blacklist and Current drops within the UI.\n' +
        'Do you wish to proceed?',
    confirmYes: 'Yes',
    confirmNo: 'No'
};

// The Fast travels window (ticket #32). Its control words are the reference's own
// (Grimoire/UI/Travel.cs: "Private", "Awe Enchantment Shop", "Map Bypasser", "Story Quest ID that
// required to unlock the map", "Unlock", "Generated packet", "Copy"); the sentences a page needs
// to report itself are written here.
exports.travelMessages = {
    title: 'Fast travels',
    private: 'Private',
    aweGroup: 'Awe Enchantment Shop',
    bypasser: 'Map Bypasser',
    bypassHint: 'Story Quest ID that required to unlock the map',
    generatedPacket: 'Generated packet',
    unlock: 'Unlock',
    copy: 'Copy',
    send: 'Send',
    working: 'Working...',
    joining: 'Joining {map}...',
    walking: 'Walking to {cell} in {map}...',
    questsLoaded: 'Asked the game for {n} quest(s).',
    shopOpened: 'Opened shop {id}.',
    bypassed: 'Storyline bypassed.',
    copied: 'Copied.',
    done: 'Done.',
    failed: 'That did not run.'
};

// The Loaders and grabbers window (ticket #31). The dialog title and the filter are the
// reference's own (Loaders.cs:141-147); the control words are in the page, which draws them.
exports.loadersMessages = {
    openTitle: 'Load grabber data',
    nothingToSave: 'Nothing has been grabbed yet, so there is nothing to save.'
};

// The packet spammer (ticket #27). Every word is the reference's own control text
// (PacketSpammer.InitializeComponent) and its two dialog titles (SaveConfig/LoadConfig).
exports.spammerMessages = {
    title: 'Packet spammer',
    add: 'Add',
    remove: 'Remove',
    clear: 'Clear',
    load: 'Load',
    save: 'Save',
    start: 'Start',
    stop: 'Stop',
    sendOnce: 'Send once',
    loadTitle: 'Load spammer file',
    saveTitle: 'Save spammer file',
    filterName: 'XML files'
};

// The packet tamperer (ticket #27), word for word from PacketTamperer.Designer.cs.
exports.tampererMessages = {
    title: 'Packet Tamperer',
    captureFromClient: 'Capture from client',
    captureFromServer: 'Capture from server',
    filterByText: 'Filter by text',
    sendToServer: 'Send to server',
    sendToClient: 'Send to client',
    clear: 'Clear'
};

// The Char Select window (#35). The reference's own list is a menu of usernames; this port draws it
// as a window so it can say where the credentials are held and offer a removal.
exports.loginMessages = {
    title: 'Char Select',
    savedHeading: 'Saved characters',
    empty: 'No characters saved yet.',
    usernamePlaceholder: 'Username',
    passwordPlaceholder: 'Password',
    add: 'Add',
    added: 'Saved for this session.',
    usernameRequired: 'Enter a username first.',
    addFailed: 'Could not save that character.',
    signIn: 'Sign in',
    signingIn: 'Signing in as {user}...',
    signedIn: 'Signed in as {user}.',
    signInFailed: 'The game did not accept the sign-in.',
    remove: 'Remove',
    importFile: 'Read CharSelect.cfg',
    imported: 'Imported {count} character(s).',
    connected: 'Connected.',
    disconnected: 'Connection lost.'
};

// The Maid window (#43). Its control words are the reference's own, verbatim from
// MaidRemake.designer.cs's Text assignments; the two dialog titles and the filter are its own
// Save/Load pair, and the party line is its own PartyCmd tooltip. `option<Key>` names the option
// boxes the page builds, so a translation can carry each one's own words.
exports.maidMessages = {
    title: 'Maid Remake',
    enable: 'Enable',
    target: 'Goto Username',
    me: 'Me',
    combat: 'Combat',
    keys: 'Keys',
    options: 'Options',
    maps: 'Maps',
    config: 'Config',
    unfollow: 'Unfollow (R)',
    stopAttack: 'StopAttack (T)',
    globalHotkey: 'Global Hotkey',
    keyHint: 'With Global Hotkey ticked, Unfollow and StopAttack work whichever window has focus.',
    // MaidRemake.designer.cs's own box words, in its own spelling (including its capitalisation).
    optionAntiCounter: 'Anti Counter',
    optionCopyWalk: 'Copy Walk',
    optionStopFailedGoto: 'Stop goto after 5 failures',
    optionWaitSkill: 'Wait',
    optionSafeSkill: 'Use',
    optionBuffStopAttack: 'Buff If StopAttack',
    save: 'Save',
    load: 'Load',
    autoload: 'Autoload',
    loadTitle: 'Load config',
    saveTitle: 'Save config',
    filterName: 'Maid config',
    working: 'Working...',
    canceled: 'Canceled.',
    saved: 'Saved.',
    loaded: 'Loaded.',
    autoloaded: 'Autoload applied.',
    noAutoload: 'There is no autoload config yet.',
    presetApplied: 'Preset {name} applied.',
    missing: 'The game cannot answer',
    notSignedIn: 'No character is signed in.',
    // The reference's own PartyCmd tooltip, in its own words.
    partyCommands: 'Party chat commands: '
};

// The in-game chrome strip (ticket #45). The control words are the reference's own, verbatim from
// Root.cs's designer (Root.cs:635, 647, 660, 672); the two list boxes carry no text upstream, so
// their own labels stay empty and their options are their words. `menu` labels the Game-menu
// entry that hides and restores the strip: upstream the same toggle is its hotkey action "Change
// Launcher Skin" (Hotkeys.cs:405-408), which hides the whole menu bar and toolbar at once.
exports.chromeMessages = {
    startBot: 'Start Bot',
    autoAttack: 'Auto Attack',
    pad: '',
    cell: '',
    refreshCell: 'x',
    bank: 'Bank',
    menu: 'Client toolbar'
};
