// What the three packet windows say when packet steering is off. The tap and packets.send only
// carry anything while the game is steered through the local relay, and steering is the player's
// opt-in (plugins/grimlite-parity/packets.js declares where; the setting itself is
// `packetSteering`, off by default). Nothing here turns it on: it only says so.
//
// The setting's own name and place are the Settings window's (locales/en-US.js
// settingsMessages.optionLabels.packetSteering, under the plugin's "Packets" section).

const SETTING_KEY = 'packetSteering';
const SETTING_NAME = 'Steer game traffic through a local relay';
const NOTICE = 'Packet steering is off, so the tap carries nothing. Turn on "' + SETTING_NAME +
    '" in Settings \u2192 AquGrim \u2192 Packets and restart AquGrim to apply.';

function steeringEnabled(host) {
    try {
        const settings = (host && typeof host.getPlatformSettings === 'function' &&
            host.getPlatformSettings()) || {};
        // The same test the platform's packet layer uses (`!!settings[declaration.settingKey]`),
        // so the banner agrees with whether the relay is actually steering this session.
        return !!settings[SETTING_KEY];
    } catch (error) {
        // A host that cannot report its settings is taken as off: the banner is the safe side.
        return false;
    }
}

/** The banner text for a window whose traffic the relay carries, or '' while steering is on. */
function notice(host) {
    return steeringEnabled(host) ? '' : NOTICE;
}

module.exports = {
    SETTING_KEY: SETTING_KEY,
    SETTING_NAME: SETTING_NAME,
    NOTICE: NOTICE,
    steeringEnabled: steeringEnabled,
    notice: notice
};
