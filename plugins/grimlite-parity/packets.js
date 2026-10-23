// What the platform needs to steer this client onto the local relay (res/platform/packet-layer.js).
//
// The client never fetches a server-list endpoint: the list arrives inside the POST
// /game/api/login/now response body, and the client dials the {sIP, iPort} rows it finds there.
// The steering point is therefore that response body, and the rewrite points every row at loopback.
//
// These are this game's facts. The platform owns the mechanism and names none of them, which is why
// the declaration lives here and not in res/.

function steeringDeclarations(baseUrl) {
    return [{
        id: 'artix-steer-login',
        // Off by default: this carries the session through a local process, so it is the player's
        // call (Settings → Grimlite → Steer game traffic), not something done to them silently.
        settingKey: 'packetSteering',
        urls: ['*://game.aq.com/game/api/login/now*'],
        // The policy Flash is answered with, and the only hosts traffic may reach onward.
        policyDomain: baseUrl ? new URL(baseUrl).hostname : 'game.aq.com',
        allowedHosts: ['*.aq.com', '*.artix.com'],
        hostField: 'sIP',
        portField: 'iPort'
    }];
}

module.exports = {
    steeringDeclarations: steeringDeclarations
};
