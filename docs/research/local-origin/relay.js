// Local TCP relay for the #3 server-list rewrite: answers Flash's policy request locally
// and forwards NUL-framed game traffic to the real server, logging both directions.
//
// Extracted from harness.js so selftest.js can exercise it without Electron. Scratch
// artifact; nothing here ships.

const net = require('net');

const POLICY = "<cross-domain-policy><allow-access-from domain='*' to-ports='*'/></cross-domain-policy>" +
    String.fromCharCode(0);

function clean(s) { return String(s).replace(/\0/g, '\\0').slice(0, 300); }

// opts: { port, target: 'host:port', onLog(kind, message) }
function createRelay(opts) {
    const parts = String(opts.target).split(':');
    const tHost = parts[0];
    const tPort = Number(parts[1]);
    const onLog = opts.onLog || function () {};
    const server = net.createServer(function (client) {
        let upstream = null;
        let sawGameTraffic = false;
        onLog('connect', client.remoteAddress + ':' + client.remotePort);
        function openUpstream() {
            if (upstream) return;
            upstream = net.createConnection({ host: tHost, port: tPort });
            upstream.on('connect', function () { onLog('upstream-open', tHost + ':' + tPort); });
            upstream.on('data', function (d) {
                onLog('S->C ' + d.length + 'b', clean(d.toString('latin1')));
                client.write(d);
            });
            upstream.on('error', function (e) { onLog('upstream-error', e.message); client.destroy(); });
            upstream.on('close', function () { onLog('upstream-close', ''); client.destroy(); });
        }
        let servedPolicy = false;
        client.on('data', function (d) {
            let text = d.toString('latin1');
            if (!sawGameTraffic && text.indexOf('policy-file-request') >= 0) {
                onLog('C->S-policy-request', clean(text));
                client.write(POLICY);
                onLog('S->C-policy', clean(POLICY));
                servedPolicy = true;
                // The real AQW servers keep the socket after the policy, and Flash (or a
                // test) may put the next frame in the same TCP chunk. Keep whatever follows
                // the request instead of dropping it; a policy-only chunk leaves nothing.
                const after = text.indexOf('>');
                text = after === -1 ? '' : text.slice(after + 1);
                if (!text) return;
            }
            if (servedPolicy && !sawGameTraffic) {
                onLog('C->S-after-policy', clean(text));
            }
            sawGameTraffic = true;
            if (!upstream) {
                onLog('C->S-game-traffic-opens-upstream', clean(text));
                openUpstream();
            } else {
                onLog('C->S ' + d.length + 'b', clean(text));
            }
            upstream.write(d);
        });
        client.on('error', function () {});
        client.on('close', function () { onLog('client-close', ''); if (upstream) upstream.destroy(); });
    });
    return {
        port: Number(opts.port),
        target: String(opts.target),
        policy: POLICY,
        listen: function () {
            return new Promise(function (resolve, reject) {
                server.on('error', reject);
                server.listen(Number(opts.port), '127.0.0.1', function () { resolve(server); });
            });
        },
        close: function () {
            return new Promise(function (resolve) {
                if (!server.listening) { resolve(); return; }
                server.close(function () { resolve(); });
            });
        }
    };
}

module.exports = { createRelay: createRelay, POLICY: POLICY };
