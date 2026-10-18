exports.dialogMessages = {
    helpDetailExtra: function (k) {
        function expand(keyb) {
            if (Array.isArray(keyb)) return keyb.join(', ');
            return keyb || '';
        }
        return 'Grimlite Parity\n' +
            expand(k.grimliteBotFile) + ' - Bot file: open and save a .gbot\n' +
            expand(k.grimliteBank) + ' - Bank window\n' +
            expand(k.grimliteEyedropper) + ' - Eye Dropper: read a colour off the screen\n' +
            expand(k.grimliteNotepad) + ' - Notepad\n' +
            expand(k.grimliteAbout) + ' - About this port and the reference it follows\n' +
            expand(k.grimliteParityPlaceholder) + ' - Parity placeholder window\n' +
            expand(k.grimliteParityDevTest) + ' - Dev Test (call a game function)';
    }
};

exports.menuMessages = {
    grimliteMenu: 'Grimlite',
    grimliteBotFile: 'Bot file',
    grimliteEyedropper: 'Eye Dropper',
    grimliteNotepad: 'Notepad',
    grimliteAbout: 'About',
    grimliteBank: 'Bank',
    grimliteSets: 'Sets',
    grimlitePlaceholder: 'Parity placeholder window',
    grimliteDevTest: 'Dev Test'
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
    placeholder: 'Grimlite Parity - Placeholder',
    eyedropper: 'Grimlite Parity - Eye Dropper',
    notepad: 'Grimlite Parity - Notepad',
    about: 'Grimlite Parity - About',
    devtest: 'Dev Test'
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
