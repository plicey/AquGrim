const socketRelay = require('../socketRelay.js');
const { createBodyService } = require('./body-service.js');
const sessionRules = require('./session-rules.js');

// The packet layer: a plugin declares what to steer and how to recognise it, and the platform
// composes the three pieces that make game traffic observable -
//
//   1. a steering declaration becomes a session rule whose response body is replaced;
//   2. the replaced rows point at the relay, which answers Flash's policy request and forwards
//      NUL-framed traffic upstream, exposing both directions;
//   3. the response body is served by a loopback body service, because Electron 11 cannot filter
//      a response body in flight (see body-service.js).
//
// The platform names no game: every game-specific fact (the URL, the row field names, the hosts
// the relay may reach, the policy domain) arrives in the declaration. That is also what keeps the
// isolation test green while a game-specific rewrite happens.
//
// Refuse-to-start is the contract, not a nicety: the client's HTTP-polling fallback is not
// steered, so a session whose steering is not engaged can be carried by an unsteered transport.
// start() therefore reports which declarations did not engage and brings no relay up for them.

function createPacketLayer(options) {
    options = options || {};
    const declarations = (Array.isArray(options.declarations) ? options.declarations : []).filter(Boolean);
    const ctx = options.ctx || {};
    const settings = ctx.settings || {};
    const onLog = typeof options.onLog === 'function'
        ? options.onLog
        : (typeof ctx.logLine === 'function' ? ctx.logLine : function () {});
    const allowedHosts = [];
    let relay = null;
    let bodyService = null;
    let closed = false;

    function enabled(declaration) {
        if (typeof declaration.enabledWhen === 'function') return !!declaration.enabledWhen(settings);
        if (declaration.settingKey) return !!settings[declaration.settingKey];
        return true;
    }

    // The steering declaration becomes one of the layer's ordinary session rules, so it rides
    // the single listener per event instead of registering one of its own.
    function sessionRuleFor(declaration) {
        return {
            id: declaration.id,
            urls: declaration.urls.slice(),
            onResponseBody: function (context, body) {
                return rewrite(context, body, declaration);
            }
        };
    }

    async function rewrite(context, body, declaration) {
        const parsed = JSON.parse(body.toString());
        const rows = collectRows(parsed, declaration);
        if (!rows.length) return undefined;   // nothing to steer: serve the real response untouched
        // All or nothing. If a single row names a host this declaration does not allow, nothing is
        // rewritten and no listener is bound: a client holding a partly steered list would dial some
        // servers directly and others through the relay, which is worse than not steering at all.
        const steerable = rows.every(function (row) {
            return socketRelay.matchesHost(declaration.allowedHosts || [], row.host.toLowerCase());
        });
        if (!steerable) {
            onLog('packet layer: ' + declaration.id + ' left the response untouched, because a server ' +
                'row names a host outside the declared allowlist');
            return undefined;
        }
        const ports = [];
        for (let i = 0; i < rows.length; i++) {
            ports.push(await relay.targetPort({ host: rows[i].host, port: rows[i].port }));
        }
        rows.forEach(function (row, index) {
            row.owner[declaration.hostField] = socketRelay.RELAY_HOST;
            row.owner[declaration.portField] = ports[index];
        });
        onLog('packet layer steered ' + rows.length + ' server row(s) to ' + socketRelay.RELAY_HOST);
        return Buffer.from(JSON.stringify(parsed), 'utf8');
    }

    // Wherever the rows sit in the response, find them by the fields the declaration names.
    function collectRows(value, declaration, found) {
        found = found || [];
        if (Array.isArray(value)) {
            value.forEach(function (item) { collectRows(item, declaration, found); });
            return found;
        }
        if (!value || typeof value !== 'object') return found;
        const host = value[declaration.hostField];
        const port = value[declaration.portField];
        if (typeof host === 'string' && host && port != null) {
            found.push({ owner: value, host: host, port: Number(port) });
            return found;
        }
        Object.keys(value).forEach(function (key) { collectRows(value[key], declaration, found); });
        return found;
    }

    function declarationAllowedHosts() {
        declarations.forEach(function (declaration) {
            (declaration.allowedHosts || []).forEach(function (pattern) {
                if (allowedHosts.indexOf(pattern) === -1) allowedHosts.push(pattern);
            });
        });
        return allowedHosts;
    }

    // A relay serves one policy domain, so several declarations collapse to the first one that
    // can steer; a declaration that cannot engage does not get a relay at all.
    function policyDomain(engaged) {
        for (let i = 0; i < declarations.length; i++) {
            if (engaged.indexOf(declarations[i].id) !== -1) return declarations[i].policyDomain;
        }
        return '';
    }

    return {
        /**
         * Compose relay + body service + session rules, then report what engaged. Nothing here
         * throws on a declaration that cannot steer: the report is the mechanism, and callers that
         * must not run unsteered (a relay) simply do not come up for it.
         */
        start: async function () {
            const engaged = [];
            const unengaged = [];
            declarations.forEach(function (declaration) {
                (enabled(declaration) ? engaged : unengaged).push(declaration.id);
            });
            const steering = { engaged: engaged, unengaged: unengaged };

            // Injecting the body service keeps its construction (and so its bind) visible to tests,
            // which is how "a refusal binds nothing" is checked without Electron.
            bodyService = (typeof options.createBodyService === 'function' ? options.createBodyService : createBodyService)({
                matchesPattern: sessionRules.matchesPattern,
                rules: declarations.filter(function (d) { return enabled(d); }).map(sessionRuleFor),
                onLog: onLog
            });

            relay = socketRelay.createRelay({
                allowedHosts: declarationAllowedHosts(),
                policyDomain: policyDomain(engaged),
                onFrame: options.onFrame,
                onLog: onLog
            });

            let relayRunning = false;
            let rules = [];

            if (engaged.length) {
                try {
                    // The relay's gates are checked first, and they bind nothing: a refusal must not
                    // leave a loopback port open. It is never allowed to come up pretending it steers
                    // while the client could fall back to an unsteered transport.
                    await relay.start({ steering: steering });
                    await bodyService.start();
                    relayRunning = true;
                    rules = declarations.filter(function (d) { return enabled(d); }).map(sessionRuleFor);
                } catch (error) {
                    // Late failures (a port that cannot be bound) still release whatever was bound.
                    await relay.close();
                    await bodyService.close();
                    throw error;
                }
            } else {
                unengaged.forEach(function (id) {
                    onLog('packet layer: steering is off for rule ' + id + ', so no relay is started');
                });
            }

            const state = {
                steering: steering,
                // The steering rules are handed back rather than registered here: Electron keeps one
                // listener per webRequest event, so the boot path merges these into its single
                // applySessionRules call. Registering here would silently replace ad blocking.
                rules: rules,
                responseBody: bodyService,
                relay: {
                    get running() { return relayRunning; },
                    get port() { return relayRunning ? relay.port : null; },
                    get connections() { return relayRunning ? relay.connections() : []; },
                    send: function (id, direction, frame) {
                        return relayRunning ? relay.send(id, direction, frame) : false;
                    },
                    targets: function () { return relayRunning ? relay.targets() : []; }
                },
                bodyService: bodyService,
                close: close
            };

            // The write path a plugin reaches through host.packets.send (packet-send). A plugin
            // that never reads the tap is never told a connection id, so this writes on the
            // connection carrying the session, and the frame lands on the tap like any other.
            // Returning false is the answer when there is nothing to write on, never a throw:
            // a window asks again the moment a client connects.
            state.send = function (direction, frame) {
                return relayRunning ? relay.sendLive(direction, frame) : false;
            };
            return state;
        },

        close: close
    };

    async function close() {
        if (closed) return;
        closed = true;
        if (relay) await relay.close();
        if (bodyService) await bodyService.close();
    }
}

module.exports = {
    createPacketLayer: createPacketLayer
};
