// What the platform needs to steer this game's client onto the local relay. The client never
// fetches a server-list endpoint: the list arrives inside the POST /game/api/login/now response
// body, and the client dials the {sIP, iPort} rows it finds there. So the steering point is that
// response body, and the rewrite points every row at loopback.
//
// These are this game's facts (URLs, row field names, the hosts the relay may reach). The platform
// owns the mechanism and names none of it; see res/platform/packet-layer.js.

const urls = require('./urls.js');
const ruffle = require('./ruffle.js');

function steeringDeclarations() {
    return [{
        id: 'artix-steer-login',
        // Off by default: this carries the session through a local process, so it is the user's
        // call (Settings → Packet steering), not something the client does to itself.
        settingKey: 'packetSteering',
        urls: ['*://game.aq.com/game/api/login/now*'],
        // The policy Flash is answered with, and the only hosts traffic may reach onward.
        policyDomain: 'game.aq.com',
        allowedHosts: ruffle.socket.allowedHosts,
        hostField: 'sIP',
        portField: 'iPort'
    }];
}

module.exports = {
    steeringDeclarations: steeringDeclarations
};
