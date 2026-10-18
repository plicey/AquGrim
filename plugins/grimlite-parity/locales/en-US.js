exports.dialogMessages = {
    helpDetailExtra: function (k) {
        function expand(keyb) {
            if (Array.isArray(keyb)) return keyb.join(', ');
            return keyb || '';
        }
        return 'Grimlite Parity\n' +
            expand(k.grimliteBotFile) + ' - Bot file: open and save a .gbot\n' +
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
    botManager: 'Bot Manager',
    placeholder: 'Grimlite Parity - Placeholder',
    eyedropper: 'Grimlite Parity - Eye Dropper',
    notepad: 'Grimlite Parity - Notepad',
    about: 'Grimlite Parity - About',
    devtest: 'Dev Test',
    packetLogger: 'Packet logger'
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
    addFolderFailed: 'That folder could not be added.'
};
