exports.dialogMessages = {
    helpDetailExtra: function (k) {
        function expand(keyb) {
            if (Array.isArray(keyb)) return keyb.join(', ');
            return keyb || '';
        }
        return 'Grimlite Parity\n' +
            'Packets -> Sniffer - Packet logger (client and server traffic)\n' +
            expand(k.grimliteParityPlaceholder) + ' - Parity placeholder window';
    }
};

exports.menuMessages = {
    grimliteMenu: 'Grimlite',
    grimlitePlaceholder: 'Parity placeholder window',
    packetsMenu: 'Packets',
    packetsSniffer: 'Sniffer'
};

exports.windowTitles = {
    primary: 'AquaStar - Grimlite Parity',
    placeholder: 'Grimlite Parity - Placeholder',
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
