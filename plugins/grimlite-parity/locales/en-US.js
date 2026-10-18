exports.dialogMessages = {
    helpDetailExtra: function (k) {
        function expand(keyb) {
            if (Array.isArray(keyb)) return keyb.join(', ');
            return keyb || '';
        }
        return 'Grimlite Parity\n' +
            expand(k.grimliteEyedropper) + ' - Eye Dropper: read a colour off the screen\n' +
            expand(k.grimliteNotepad) + ' - Notepad\n' +
            expand(k.grimliteAbout) + ' - About this port and the reference it follows\n' +
            expand(k.grimliteParityPlaceholder) + ' - Parity placeholder window';
    }
};

exports.menuMessages = {
    grimliteMenu: 'Grimlite',
    grimliteEyedropper: 'Eye Dropper',
    grimliteNotepad: 'Notepad',
    grimliteAbout: 'About',
    grimlitePlaceholder: 'Parity placeholder window'
};

exports.windowTitles = {
    primary: 'AquaStar - Grimlite Parity',
    placeholder: 'Grimlite Parity - Placeholder',
    eyedropper: 'Grimlite Parity - Eye Dropper',
    notepad: 'Grimlite Parity - Notepad',
    about: 'Grimlite Parity - About'
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
