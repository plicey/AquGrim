// Which of this game's hosts are mirrored on loopback, and how one of its URLs maps onto them.
// The platform owns the origin and is told these routes; it knows no game.
//
// Same-origin is not a preference here, it is the requirement: PPAPI Flash inside Chromium grants
// no local-trusted sandbox, so a bridge SWF that loads the game SWF from another origin is denied
// every ApplicationDomain access (#2119/#2121). Page, bridge and game must come from one origin,
// which is what this loopback origin provides.

const path = require('path');

// Same policy as the game plugin's: Artix Game Launcher 2.2.0's own UA shape. Kept here rather
// than shared across plugins because a second game may need a different one, and the platform
// deliberately has no opinion (it only hands a rule the browser's own UA).
function launcherUserAgent(rawUA) {
    return String(rawUA || '')
        .replace(/\s(?:Artix\S*|AquaStar|Chrome|Electron)\/\S+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

const GAME_HOST = 'https://game.aq.com';

// Where the bridge SWF is served. '/game/' is deliberate: the platform's wrapper passes the SWF's
// own directory as the movie's `base`, so the bridge sees exactly the same base the stock loader
// sees on the live host (sURL + 'gamefiles/'), and resolves the game's paths from the param rather
// than from a compiled-in URL.
const BRIDGE_PATH = '/game/aqua-bridge.swf';

// Longest prefix wins. "/" preserves the game host's own paths; a "/proxy/<host>/" mount serves
// that host from the loopback root, which is how its asset URLs map onto the origin.
const ROUTES = [
    { prefix: '/proxy/content/', origin: 'https://content.aq.com' },
    { prefix: '/proxy/account/', origin: 'https://account.aq.com' },
    { prefix: '/', origin: GAME_HOST }
];

function routes() {
    return ROUTES.map(function (route) {
        return { prefix: route.prefix, origin: route.origin };
    });
}

/**
 * Local files the origin answers itself, keyed by the path it serves them at.
 *
 * Only the bridge SWF: the platform's own wrapper page is already served from this origin (it is
 * what startGameOrigin mounts), and it passes the SWF's own origin as the movie's `base`, so the
 * bridge resolves the game's paths on loopback with no page of our own to maintain. Page, bridge
 * and game then share one origin, which is the requirement the bridge rests on.
 */
function files() {
    const files = {};
    files[BRIDGE_PATH] = bridgeSwfPath();
    return files;
}

function bridgeSwfPath() {
    // A locally rebuilt bridge wins, so a developer can iterate without a build step in the app.
    const local = process.env.AQUASTAR_BRIDGE_SWF;
    return local || path.join(__dirname, 'assets', 'aqua-bridge.swf');
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

/** Upstream User-Agent for the mirrored hosts: this client's own launcher policy. */
function userAgent(receivedUserAgent) {
    return launcherUserAgent(receivedUserAgent);
}

module.exports = {
    GAME_HOST: GAME_HOST,
    BRIDGE_PATH: BRIDGE_PATH,
    routes: routes,
    files: files,
    bridgeSwfPath: bridgeSwfPath,
    toServeFromOrigin: toServeFromOrigin,
    userAgent: userAgent
};
