exports.dialogMessages = {
    helpDetailExtra: function (k) {
        function expand(keyb) {
            if (Array.isArray(keyb)) return keyb.join(', ');
            return keyb || '';
        }
        return 'Grimlite Parity\n' +
            expand(k.grimliteBotFile) + ' - Bot file: open and save a .gbot\n' +
            expand(k.grimliteBank) + ' - Bank window\n' +
            expand(k.grimliteBotManager) + ' - Bot Manager: the eleven-tab bot editor\n' +
            expand(k.grimliteEyedropper) + ' - Eye Dropper: read a colour off the screen\n' +
            expand(k.grimliteNotepad) + ' - Notepad\n' +
            expand(k.grimliteAbout) + ' - About this port and the reference it follows\n' +
            'Packets -> Sniffer - Packet logger (client and server traffic)\n' +
            expand(k.grimliteParityPlaceholder) + ' - Parity placeholder window\n' +
            expand(k.grimliteParityDevTest) + ' - Dev Test (call a game function)';
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
    grimliteSets: 'Sets',
    grimliteCosmetics: 'Cosmetics',
    grimlitePlaceholder: 'Parity placeholder window',
    grimliteDevTest: 'Dev Test',
    packetsMenu: 'Packets',
    packetsSniffer: 'Sniffer'
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
    sets: 'Grimlite Parity - Set',
    botManager: 'Bot Manager',
    placeholder: 'Grimlite Parity - Placeholder',
    eyedropper: 'Grimlite Parity - Eye Dropper',
    notepad: 'Grimlite Parity - Notepad',
    about: 'Grimlite Parity - About',
    charSelect: 'Grimlite Parity - Char Select',
    cosmetics: 'Grimlite Parity - SWF Cosmetics',
    devtest: 'Dev Test',
    packetLogger: 'Packet logger'
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
    read: 'Read from the game.'
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
