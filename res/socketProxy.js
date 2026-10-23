const WebSocket = require('ws');
const net = require('net');

// Ruffle (running in a sandboxed renderer) can't open raw TCP sockets the way Flash's
// Socket class does, so games with raw-socket netcode need a local relay. Ruffle's own
// socketProxy config (built client-side in ruffle_wrapper.html) lists which (host, port)
// pairs get redirected here. The relay itself only forwards to hosts a plugin declared
// (wrap.ruffle.socket.allowedHosts): it listens on localhost, so without this any local web
// page could use it to reach arbitrary TCP endpoints.
const PROXY_HOST = '127.0.0.1';
const PROXY_PORT = 8191;

let wss = null;
// Hostname patterns the relay may connect to: exact hosts or "*.suffix". Empty = deny all.
let allowedHosts = [];

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

function isAllowedOrigin(origin) {
    return ALLOWED_ORIGINS.indexOf(String(origin || '').toLowerCase()) !== -1;
}

function start() {
    if (wss) return;
    wss = new WebSocket.Server({ port: PROXY_PORT, host: PROXY_HOST, perMessageDeflate: false });

    wss.on('connection', (ws, req) => {
        const u = new URL(req.url, 'http://localhost');
        const host = u.searchParams.get('host');
        const port = Number(u.searchParams.get('port'));

        if (!isAllowedOrigin(req.headers.origin)) {
            ws.close(1008, 'origin not allowed');
            return;
        }
        if (!host || !port) {
            ws.close(1008, 'missing host or port');
            return;
        }
        if (!isAllowedHost(host)) {
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
}

function stop() {
    if (!wss) return;
    wss.close();
    wss = null;
}

exports.allowHosts = allowHosts;
exports.isAllowedHost = isAllowedHost;
exports.isAllowedOrigin = isAllowedOrigin;
exports.start = start;
exports.stop = stop;
exports.proxyUrl = 'ws://' + PROXY_HOST + ':' + PROXY_PORT;
