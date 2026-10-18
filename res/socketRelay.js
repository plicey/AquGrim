const net = require('net');

// Local TCP relay behind the platform's login-response steering: it answers Flash's own policy
// request, then forwards NUL-framed game traffic upstream, exposing both directions to whoever
// owns the relay. One loopback port is bound per real server it has been given, so the client's
// choice of server survives the rewrite.
//
// Gates, and what each is worth over raw TCP:
// - the policy `domain` is the only gate Flash itself enforces, and '*' would admit every SWF on
//   the machine, so a concrete domain is required and a wildcard is refused.
// - allowedHosts bounds where traffic may go (exact hosts or '*.suffix'); empty means deny all.
// - start() validates those gates and the steering report before anything is bound, so a relay
//   that cannot steer does not exist rather than half-working: the client's HTTP-polling fallback
//   is not steered, so an unsteered transport would carry the session instead.
// res/socketProxy.js gates on the caller's Origin because its peer is a browser. This listener's
// peer is Flash speaking raw TCP, which sends no Origin; the policy domain is its equivalent.

const RELAY_HOST = '127.0.0.1';
const NUL = Buffer.from([0]);
const POLICY_REQUEST = '<policy-file-request/>';

function matchesHost(patterns, host) {
    return patterns.some(function (pattern) {
        if (pattern.indexOf('*.') === 0) {
            const suffix = pattern.slice(2);
            return host === suffix || host.endsWith('.' + suffix);
        }
        return host === pattern;
    });
}

// Peel NUL-delimited frames off a chunk, carrying any unterminated tail into the next one.
function splitFrames(buffer, carry, onFrame) {
    const data = carry ? Buffer.concat([carry, buffer]) : buffer;
    let start = 0;
    for (let i = 0; i < data.length; i++) {
        if (data[i] !== 0) continue;
        const frame = data.slice(start, i);
        start = i + 1;
        if (frame.length) onFrame(frame);
    }
    return start < data.length ? data.slice(start) : null;
}

// options: { allowedHosts, policyDomain, onFrame({id, direction, data}), onLog(line) }
function createRelay(options) {
    options = options || {};
    const allowedHosts = (Array.isArray(options.allowedHosts) ? options.allowedHosts : [])
        .filter(function (pattern) { return typeof pattern === 'string' && pattern; })
        .map(function (pattern) { return pattern.toLowerCase(); });
    const policyDomain = typeof options.policyDomain === 'string' ? options.policyDomain.trim() : '';
    const onFrame = typeof options.onFrame === 'function' ? options.onFrame : function () {};
    const onLog = typeof options.onLog === 'function' ? options.onLog : function () {};

    let running = false;
    let nextConnectionId = 1;
    const targets = [];
    const connections = new Map();

    function targetFor(host, port) {
        for (let i = 0; i < targets.length; i++) {
            if (targets[i].host === host && targets[i].port === port) return targets[i];
        }
        return null;
    }

    function policyFor(listenPort) {
        return "<cross-domain-policy><allow-access-from domain='" + policyDomain +
            "' to-ports='" + listenPort + "'/></cross-domain-policy>\0";
    }

    function upstreamFor(state) {
        if (state.upstream || state.closed) return state.upstream;
        const upstream = net.createConnection({
            host: state.target.host,
            port: state.target.port,
            noDelay: true
        });
        state.upstream = upstream;
        upstream.on('connect', function () {
            state.upstreamReady = true;
            state.carry.forEach(function (frame) { upstream.write(Buffer.concat([frame, NUL])); });
            state.carry = [];
        });
        upstream.on('data', function (chunk) {
            state.fromUpstream = splitFrames(chunk, state.fromUpstream, function (frame) {
                onFrame({ id: state.id, direction: 'toClient', data: frame });
            });
            // Bytes pass through untouched: framing is the client's, not ours.
            state.client.write(chunk);
        });
        upstream.on('error', function (error) {
            onLog('relay upstream ' + state.target.host + ':' + state.target.port + ' failed: ' + error.message);
            state.client.destroy();
        });
        upstream.on('close', function () { state.client.destroy(); });
        return upstream;
    }

    function toServer(state, frame) {
        onFrame({ id: state.id, direction: 'toServer', data: frame });
        const upstream = upstreamFor(state);
        if (!upstream) return;   // the connection closed while this frame was in flight
        if (state.upstreamReady) upstream.write(Buffer.concat([frame, NUL]));
        else state.carry.push(frame);
    }

    function onClientData(state, chunk) {
        let data = state.fromClient ? Buffer.concat([state.fromClient, chunk]) : chunk;
        state.fromClient = null;
        if (!state.policyServed && data.indexOf(POLICY_REQUEST) === 0) {
            const end = data.indexOf(0);
            if (end === -1) { state.fromClient = data; return; }   // policy request still arriving
            state.policyServed = true;
            state.client.write(policyFor(state.target.listenPort));
            // Real game servers keep the socket after the policy, and Flash may put its first
            // frame in the same chunk as the request: keep whatever followed it.
            data = data.slice(end + 1);
        }
        if (!data.length) return;
        state.fromClient = splitFrames(data, null, function (frame) { toServer(state, frame); });
    }

    function handleClient(client, target) {
        const state = {
            id: nextConnectionId++,
            client: client,
            target: target,
            upstream: null,
            upstreamReady: false,
            carry: [],
            fromClient: null,
            fromUpstream: null,
            policyServed: false,
            closed: false
        };
        connections.set(state.id, state);
        onLog('relay connection ' + state.id + ' -> ' + target.host + ':' + target.port);
        client.on('data', function (chunk) { onClientData(state, chunk); });
        client.on('error', function () {});
        client.on('close', function () {
            state.closed = true;
            connections.delete(state.id);
            if (state.upstream) state.upstream.destroy();
        });
    }

    function bindTarget(target) {
        const server = net.createServer(function (client) { handleClient(client, target); });
        return new Promise(function (resolve, reject) {
            server.once('error', reject);
            server.listen(0, RELAY_HOST, function () {
                server.removeListener('error', reject);
                server.on('error', function (error) {
                    onLog('relay listener on port ' + target.listenPort + ' failed: ' + error.message);
                });
                target.server = server;
                target.listenPort = server.address().port;
                onLog('relay serves ' + target.host + ':' + target.port + ' on ' +
                    RELAY_HOST + ':' + target.listenPort);
                resolve(target.listenPort);
            });
        });
    }

    return {
        get port() { return targets.length ? targets[0].listenPort : null; },

        isRunning: function () { return running; },

        // Validate every condition that makes steering trustworthy, then allow traffic. Nothing
        // binds here; targets are declared afterwards with targetPort(). The rejection is the
        // point: it is how the platform declines to run a relay that cannot steer.
        start: function (context) {
            context = context || {};
            if (!policyDomain || policyDomain.indexOf('*') !== -1) {
                return Promise.reject(new Error('relay refuses to start: it needs a concrete policy ' +
                    'domain (got "' + (policyDomain || '') + "'); a wildcard policy admits every SWF " +
                    'on this machine'));
            }
            if (!allowedHosts.length) {
                return Promise.reject(new Error(
                    'relay refuses to start: no host allowlist, so it would forward anywhere'));
            }
            const steering = context.steering || null;
            const unengaged = (steering && steering.unengaged) || [];
            if (unengaged.length) {
                return Promise.reject(new Error('relay refuses to start: steering is not engaged ' +
                    'for rule(s) ' + unengaged.join(', ') + ', and the client would fall back to an ' +
                    'unsteered transport'));
            }
            if (!steering || !steering.engaged || !steering.engaged.length) {
                return Promise.reject(new Error(
                    'relay refuses to start: no rule steers the client to it'));
            }
            running = true;
            onLog('relay started, steering engaged for ' + steering.engaged.join(', '));
            return Promise.resolve({ started: true });
        },

        // Declare the real server a rewritten row points at and resolve the loopback port that
        // serves it. One port per server, so the relay knows which endpoint a connection meant;
        // repeating a declaration reuses the port.
        targetPort: function (endpoint) {
            if (!endpoint || typeof endpoint.host !== 'string' || !endpoint.host || endpoint.port == null) {
                return Promise.reject(new Error('[AquaStar] relay target needs a host and a port'));
            }
            const host = endpoint.host.toLowerCase();
            const port = Number(endpoint.port);
            if (!matchesHost(allowedHosts, host)) {
                return Promise.reject(new Error('[AquaStar] relay target ' + host + ' is not allowed'));
            }
            if (!running) {
                return Promise.reject(new Error('[AquaStar] relay has not started, so it serves no target'));
            }
            const existing = targetFor(host, port);
            if (existing && existing.listenPort) return Promise.resolve(existing.listenPort);
            const target = existing || { host: host, port: port, listenPort: null, server: null };
            if (!existing) targets.push(target);
            return bindTarget(target);
        },

        targets: function () {
            return targets.map(function (target) {
                return { host: target.host, port: target.port };
            });
        },

        connections: function () {
            const list = [];
            connections.forEach(function (state) {
                list.push({ id: state.id, host: state.target.host, port: state.target.port });
            });
            return list;
        },

        // Write one frame back out, NUL-framed, on the given side of an open connection.
        send: function (id, direction, frame) {
            const state = connections.get(id);
            if (!state) return false;
            if (direction !== 'toServer' && direction !== 'toClient') return false;
            const bytes = Buffer.isBuffer(frame) ? frame : Buffer.from(String(frame), 'utf8');
            if (direction === 'toClient') { state.client.write(Buffer.concat([bytes, NUL])); return true; }
            const upstream = upstreamFor(state);
            if (!upstream) return false;   // closed between the lookup and the write
            if (state.upstreamReady) upstream.write(Buffer.concat([bytes, NUL]));
            else state.carry.push(bytes);
            return true;
        },

        close: function () {
            running = false;
            connections.forEach(function (state) {
                if (state.upstream) state.upstream.destroy();
                state.client.destroy();
            });
            connections.clear();
            const closers = targets.map(function (target) {
                const server = target.server;
                target.server = null;
                target.listenPort = null;
                if (!server) return Promise.resolve();
                return new Promise(function (resolve) { server.close(resolve); });
            });
            targets.length = 0;
            return Promise.all(closers);
        }
    };
}

module.exports = {
    createRelay: createRelay,
    matchesHost: matchesHost,
    RELAY_HOST: RELAY_HOST
};
