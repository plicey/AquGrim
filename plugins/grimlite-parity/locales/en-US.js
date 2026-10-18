exports.dialogMessages = {
    helpDetailExtra: function (k) {
        function expand(keyb) {
            if (Array.isArray(keyb)) return keyb.join(', ');
            return keyb || '';
        }
        return 'Grimlite Parity\n' +
            expand(k.grimliteParityPlaceholder) + ' - Parity placeholder window';
    }
};

exports.menuMessages = {
    grimliteMenu: 'Grimlite',
    grimlitePlaceholder: 'Parity placeholder window'
};

exports.windowTitles = {
    primary: 'AquaStar - Grimlite Parity',
    placeholder: 'Grimlite Parity - Placeholder'
};
