exports.dialogMessages = {
    helpDetailExtra: function (k) {
        function expand(keyb) {
            if (Array.isArray(keyb)) return keyb.join(', ');
            return keyb || '';
        }
        return 'Grimlite Parity\n' +
            expand(k.grimliteBotFile) + ' - Bot file window\n' +
            expand(k.grimliteBank) + ' - Bank window\n' +
            expand(k.grimliteParityPlaceholder) + ' - Parity placeholder window';
    }
};

exports.menuMessages = {
    grimliteMenu: 'Grimlite',
    grimliteBotFile: 'Bot file',
    grimliteBank: 'Bank',
    grimliteSets: 'Sets',
    grimlitePlaceholder: 'Parity placeholder window'
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
    placeholder: 'Grimlite Parity - Placeholder'
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
