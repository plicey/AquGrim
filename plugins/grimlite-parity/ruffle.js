// Use the same origin as login so packet steering gives both requests identical relay ports.
module.exports = function (baseUrl) {
    return {
        socket: {
            serversApi: baseUrl + '/game/api/data/servers',
            fallbackHosts: {
                'sock7.aq.com': [5588, 5589, 5591, 5592, 5593, 5594],
                'sock8.aq.com': [5588, 5589, 5590, 5591, 5593],
                'euro.aqw.artix.com': [5588],
                'asia.game.artix.com': [5588]
            },
            policyPort: 843,
            allowedHosts: ['*.aq.com', '*.artix.com']
        }
    };
};
