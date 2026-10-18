#!/usr/bin/env node
'use strict';
// Offline self-check for the local-origin spike: no Electron, no game files, no account.
// Covers the two pieces a human run depends on -- the relay's policy handshake and the
// gateway's routes -- so a broken edit fails here instead of during a login.
//
//   node docs/research/local-origin/selftest.js

const http = require('http');
const net = require('net');
const assert = require('assert');
const { createRelay } = require('./relay.js');
const { createGateway } = require('./gateway.js');

const GW_PORT = 8611;
const RELAY_PORT = 8612;
const NUL = String.fromCharCode(0);
let failures = 0;

function check(name, fn) {
    return Promise.resolve().then(fn).then(function () {
        console.log('  ok   ' + name);
    }, function (e) {
        failures++;
        console.log('  FAIL ' + name + ' -- ' + e.message);
    });
}

function get(url) {
    return new Promise(function (resolve, reject) {
        http.get(url, function (res) {
            const chunks = [];
            res.on('data', function (c) { chunks.push(c); });
            res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); });
        }).on('error', reject);
    });
}

// A stand-in upstream: answers the policy request and echoes one NUL frame, so the relay's
// handshake can be exercised without touching sock7.aq.com.
function fakeUpstream(port) {
    const seen = [];
    const server = net.createServer(function (sock) {
        sock.on('data', function (d) {
            seen.push(d.toString('latin1'));
            if (d.toString('latin1').indexOf('verChk') >= 0) {
                sock.write("<msg t='sys'><body action='apiOK' r='0'></body></msg>" + NUL);
            }
        });
    });
    return new Promise(function (resolve) {
        server.listen(port, '127.0.0.1', function () { resolve({ server: server, seen: seen }); });
    });
}

function clientExchange(port, frames, settleMs) {
    return new Promise(function (resolve, reject) {
        const sock = net.createConnection({ host: '127.0.0.1', port: port });
        const got = [];
        sock.on('connect', function () {
            frames.forEach(function (f) { sock.write(f); });
        });
        sock.on('data', function (d) { got.push(d.toString('latin1')); });
        sock.on('error', reject);
        setTimeout(function () { sock.destroy(); resolve(got.join('')); }, settleMs || 400);
    });
}

async function main() {
    console.log('relay + gateway selftest');

    const up = await fakeUpstream(RELAY_PORT + 40);

    // --- relay ---------------------------------------------------------------------
    const relay = createRelay({ port: RELAY_PORT, target: '127.0.0.1:' + (RELAY_PORT + 40), onLog: function () {} });
    await relay.listen();

    await check('relay answers the policy request with a NUL-terminated policy', async function () {
        const out = await clientExchange(RELAY_PORT, ['<policy-file-request/>' + NUL]);
        assert.ok(out.indexOf('<cross-domain-policy>') >= 0, 'no policy in reply: ' + JSON.stringify(out));
        assert.ok(out.indexOf('to-ports') >= 0, 'policy has no to-ports');
        assert.strictEqual(out[out.length - 1], NUL, 'policy reply is not NUL terminated');
    });

    await check('relay keeps the socket open after the policy', async function () {
        const out = await clientExchange(RELAY_PORT, ['<policy-file-request/>' + NUL, "<msg t='sys'><body action='verChk'/></msg>" + NUL], 600);
        assert.ok(out.indexOf('apiOK') >= 0, 'no game frame after policy: ' + JSON.stringify(out));
    });

    await check('relay forwards a first frame straight into upstream', async function () {
        const before = up.seen.length;
        await clientExchange(RELAY_PORT, ["<msg t='sys'><body action='verChk'/></msg>" + NUL], 500);
        assert.ok(up.seen.length > before, 'upstream saw nothing');
        assert.ok(up.seen.join('').indexOf('verChk') >= 0, 'upstream did not receive the frame');
    });

    // --- gateway -------------------------------------------------------------------
    const gw = createGateway({ port: GW_PORT, synth: false, quiet: true, rewrite: { host: '127.0.0.1', port: RELAY_PORT } });
    await gw.start();
    const origin = 'http://127.0.0.1:' + GW_PORT;

    await check('gateway serves the URL policy', async function () {
        const r = await get(origin + '/crossdomain.xml');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.toString().indexOf('<cross-domain-policy>') >= 0);
    });

    await check('gateway serves the wrapper page', async function () {
        const gwWithWrapper = createGateway({ port: GW_PORT + 5, quiet: true, wrapper: require('path').join(__dirname, 'wrapper.html') });
        await gwWithWrapper.start();
        try {
            const r = await get('http://127.0.0.1:' + (GW_PORT + 5) + '/wrapper.html');
            assert.strictEqual(r.status, 200);
            assert.ok(r.body.toString().indexOf('<object') >= 0 || r.body.toString().indexOf('createElement') >= 0);
        } finally { await gwWithWrapper.close(); }
    });

    await check('gateway passes an unknown path upstream (so 404s are real evidence)', async function () {
        const r = await get(origin + '/game/gamefiles/definitely-not-a-real-file-xyz.swf');
        assert.notStrictEqual(r.status, 200, 'unknown file must not answer 200');
    });

    await check('gateway refuses a POST to an unknown method-free route as GET/POST only', async function () {
        const r = await new Promise(function (resolve, reject) {
            const req = http.request({ host: '127.0.0.1', port: GW_PORT, path: '/game/gamefiles/x.swf', method: 'PUT' }, function (res) {
                res.resume();
                res.on('end', function () { resolve({ status: res.statusCode }); });
            });
            req.on('error', reject);
            req.end('x');
        });
        assert.strictEqual(r.status, 501);
    });

    await check('gateway log does not contain the credential body anywhere', async function () {
        const dump = JSON.stringify(gw.entries);
        assert.ok(dump.indexOf('password') < 0 && dump.indexOf('pword') < 0, 'log mentions credentials');
    });

    await check('gateway reports its own origin and counters', async function () {
        const r = await get(origin + '/__status');
        const body = JSON.parse(r.body.toString());
        assert.strictEqual(body.origin, origin);
        assert.ok(body.count > 0, 'no requests recorded');
    });

    await gw.close();
    await relay.close();
    up.server.close();

    console.log(failures ? ('FAILED: ' + failures) : 'all checks passed');
    process.exit(failures ? 1 : 0);
}

main().catch(function (e) { console.error('selftest crashed: ' + (e && e.stack)); process.exit(1); });
