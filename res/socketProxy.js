const WebSocket = require('ws');
const net = require('net');

// Ruffle (running in a sandboxed renderer) can't open raw TCP sockets the way Flash's
// Socket class does, so games with raw-socket netcode need a local relay. Ruffle's own
// socketProxy config (built client-side in ruffle_wrapper.html) lists which (host, port)
// pairs get redirected here. The relay itself only forwards to hosts a plugin declared
// (wrap.ruffle.socket.allowedHosts): it listens on localhost, so without this any local web
// page could use it to reach arbitrary TCP endpoints.
const PROXY_HOST = '127.0.0.1';
let startPromise = null;

let wss = null;
// Hostname patterns the relay may connect to: exact hosts or "*.suffix". Empty = deny all.
let allowedHosts = [];
const localPorts = new Set();

function allowHosts(patterns) {
    (Array.isArray(patterns) ? patterns : []).forEach(function (pattern) {
        if (typeof pattern === 'string' && pattern && allowedHosts.indexOf(pattern) === -1) {
            allowedHosts.push(pattern.toLowerCase());
        }
    });
}

function isAllowedHost(host) {
    const name = String(host || '').toLowerCase();
    return allowedHosts.some(function (pattern) {
        if (pattern.indexOf('*.') === 0) {
            const suffix = pattern.slice(2);
            return name === suffix || name.endsWith('.' + suffix);
        }
        return name === pattern;
    });
}

// Origins allowed to open a tunnel. The relay listens on localhost, so any page on this
// machine can reach it; a browser cannot forge Origin, which is what makes this the gate.
// The app's own wrapper is a file:// page. "null" is refused on purpose: sandboxed iframes
// and data: URLs report it, so allowing it would hand the tunnel back to any web page.
// shortcut: any file:// page can still tunnel while Ruffle runs, since Origin carries no
// path; add a per-session token if that matters once this relay carries game traffic.
const ALLOWED_ORIGINS = ['file://'];

function allowOrigin(origin) {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' || parsed.hostname !== PROXY_HOST || parsed.origin !== origin) {
        throw new Error('relay origin must be an exact loopback HTTP origin');
    }
    if (ALLOWED_ORIGINS.indexOf(origin) === -1) ALLOWED_ORIGINS.push(origin);
}

function removeOrigin(origin) {
    const index = ALLOWED_ORIGINS.indexOf(origin);
    if (index > 0) ALLOWED_ORIGINS.splice(index, 1);
}

function allowLocalPort(port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid relay port');
    localPorts.add(port);
}

function isAllowedOrigin(origin) {
    return ALLOWED_ORIGINS.indexOf(String(origin || '').toLowerCase()) !== -1;
}

function start() {
    if (wss) return startPromise;
    // Each process owns its relay and origin allowlist.
    wss = new WebSocket.Server({ port: 0, host: PROXY_HOST, perMessageDeflate: false });
    startPromise = new Promise(function (resolve, reject) {
        wss.once('listening', resolve);
        wss.once('error', reject);
    });

    wss.on('connection', (ws, req) => {
        const u = new URL(req.url, 'http://localhost');
        const host = u.searchParams.get('host');
        const port = Number(u.searchParams.get('port'));

        if (!isAllowedOrigin(req.headers.origin)) {
            ws.close(1008, 'origin not allowed');
            return;
        }
        if (!host || !Number.isInteger(port) || port < 1 || port > 65535) {
            ws.close(1008, 'missing host or port');
            return;
        }
        if (!isAllowedHost(host) && !(host === PROXY_HOST && localPorts.has(port))) {
            ws.close(1008, 'host not allowed');
            return;
        }

        const tgt = net.createConnection({ port, host, noDelay: true });

        tgt.on('data', (d) => { if (ws.readyState === WebSocket.OPEN) ws.send(d); });
        tgt.on('close', () => ws.close());
        tgt.on('error', (e) => ws.close(1011, e.message));

        ws.on('message', (m) => tgt.write(m));
        ws.on('close', () => tgt.destroy());
        ws.on('error', () => tgt.destroy());
    });

    wss.on('error', (err) => {
        console.error('[AquGrim] Ruffle socket proxy error:', err);
    });
    return startPromise;
}

function stop() {
    if (!wss) return;
    wss.close();
    wss = null;
    startPromise = null;
}

exports.allowHosts = allowHosts;
exports.isAllowedHost = isAllowedHost;
exports.isAllowedOrigin = isAllowedOrigin;
exports.allowOrigin = allowOrigin;
exports.removeOrigin = removeOrigin;
exports.allowLocalPort = allowLocalPort;
exports.removeLocalPort = function (port) { localPorts.delete(port); };
exports.start = start;
exports.stop = stop;
Object.defineProperty(exports, 'proxyUrl', { get: function () {
    const address = wss && wss.address();
    if (!address) throw new Error('Socket relay is not listening');
    return 'ws://' + PROXY_HOST + ':' + address.port;
} });
