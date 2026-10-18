// Which of this game's hosts are mirrored on loopback, and how one of its URLs maps onto
// them. The platform owns the origin itself and is told these routes; it knows no game.

const { launcherUserAgent } = require('./user-agent.js');

// Longest prefix wins. "/" preserves the game host's own paths; a "/proxy/<host>/" mount
// serves that host from the loopback root, which is how its asset URLs map onto the origin.
const ROUTES = [
    { prefix: '/proxy/content/', origin: 'https://content.aq.com' },
    { prefix: '/proxy/account/', origin: 'https://account.aq.com' },
    { prefix: '/', origin: 'https://game.aq.com' }
];

function routes() {
    return ROUTES.map(function (route) {
        return { prefix: route.prefix, origin: route.origin };
    });
}

/** The same path on the loopback origin, or the URL unchanged when it is not mirrored. */
function toServeFromOrigin(url, baseUrl) {
    if (!baseUrl || typeof url !== 'string') return url;
    let target;
    try {
        target = new URL(url);
    } catch (e) {
        return url;
    }
    const origin = target.protocol + '//' + target.host;
    for (let i = 0; i < ROUTES.length; i++) {
        const route = ROUTES[i];
        if (origin !== route.origin) continue;
        if (route.prefix === '/') return baseUrl + target.pathname + target.search;
        return baseUrl + route.prefix + target.pathname.slice(1) + target.search;
    }
    return url;
}

/** Upstream User-Agent for the mirrored hosts: this plugin's artix-ua policy (user-agent.js). */
function userAgent(receivedUserAgent) {
    return launcherUserAgent(receivedUserAgent);
}

module.exports = { routes: routes, toServeFromOrigin: toServeFromOrigin, userAgent: userAgent };

