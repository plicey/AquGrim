#!/usr/bin/env node
'use strict';
// Local-origin gateway for ticket #15: serves the AQW game files, and the game's own API
// calls, from http://127.0.0.1:<port> so the client boots from a local origin.
//
// Scratch artifact: nothing here ships. The run that used it is recorded in
// ../grimlite-local-origin.md; driving instructions are in ./README.md.
//
// Routes (path is preserved upstream, so the local origin mirrors game.aq.com's layout):
//   /game/...           -> https://game.aq.com/game/...    (SWFs, api/data/*, api/login/*)
//   /proxy/content/...  -> https://content.aq.com/...      (assets)
//   /proxy/account/...  -> https://account.aq.com/...
//   /crossdomain.xml    -> local URL policy
//   /wrapper.html       -> --wrapper=<file>, served here so page and SWF share one origin
//   /__status           -> counters + full request log as JSON
//   /__servers          -> the live server list with sIP/iPort rewritten to --rewrite=<port>
//   /__control?synth=1  -> flip gameversion synthesis at runtime (human-driven runs)
//   /__reset            -> clear the log
// Upstream 3xx responses are followed here (up to 5 hops) so the client only ever talks to
// 127.0.0.1. Anything not matched is proxied to game.aq.com verbatim, so a 404 in the log
// is upstream's answer rather than a gateway gap.

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// local prefix -> upstream origin; path is kept as-is (game.aq.com/game/... == /game/...).
const HOST_ROUTES = [
    { prefix: '/proxy/content/', origin: 'https://content.aq.com' },
    { prefix: '/proxy/account/', origin: 'https://account.aq.com' },
    { prefix: '/game/', origin: 'https://game.aq.com' }
];

// --synth only. Exactly what /game/api/data/gameversion returned on 2026-10-18; the live
// endpoint answers 404 to plain GETs (see the report). Without --synth a 404 passes through.
const SYNTH_GAMEVERSION = JSON.stringify({
    sFile: 'Game4000r5.swf',
    sTitle: 'Festival of Witches!',
    sBG: 'Generic2.swf',
    sVersion: 'R0048'
});

const MIME = {
    '.swf': 'application/x-shockwave-flash',
    '.html': 'text/html; charset=utf-8',
    '.xml': 'text/xml; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
};

function parseArgs(argv) {
    const out = {};
    for (const a of argv) {
        const m = /^--([A-Za-z0-9-]+)(?:=(.*))?$/.exec(a);
        if (!m) continue;
        out[m[1].replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] =
            m[2] === undefined ? true : m[2];
    }
    return out;
}

function extOf(p) {
    const i = p.lastIndexOf('.');
    return i === -1 ? '' : p.slice(i);
}

function upstreamFor(pathname) {
    for (const r of HOST_ROUTES) {
        if (pathname.indexOf(r.prefix) === 0) {
            if (r.prefix === '/proxy/content/' || r.prefix === '/proxy/account/') {
                return { origin: r.origin, path: pathname.slice(r.prefix.length - 1) };
            }
            return { origin: r.origin, path: pathname };
        }
    }
    return { origin: 'https://game.aq.com', path: pathname };
}

// Map an absolute upstream URL back onto this origin, so a redirect we do not follow does
// not walk the client off 127.0.0.1.
function localize(absUrl, selfOrigin) {
    let u;
    try { u = new URL(absUrl); } catch (e) { return null; }
    if (u.hostname === 'game.aq.com') return selfOrigin + u.pathname + u.search;
    if (u.hostname === 'content.aq.com') return selfOrigin + '/proxy/content' + u.pathname + u.search;
    if (u.hostname === 'account.aq.com') return selfOrigin + '/proxy/account' + u.pathname + u.search;
    return null;
}

function createGateway(opts) {
    const port = Number(opts.port || 8488);
    const selfOrigin = 'http://127.0.0.1:' + port;
    const allowDomain = opts.allowDomain || '*';
    const quiet = !!opts.quiet;
    const rewrite = opts.rewrite || null;   // {host, port} for /__servers
    const logStream = opts.logFile ? fs.createWriteStream(opts.logFile, { flags: 'a' }) : null;
    const entries = [];
    const counters = Object.create(null);
    const controls = { synth: !!opts.synth, paused: false };

    function record(entry) {
        entries.push(entry);
        const key = entry.synth ? 'SYNTH' : String(entry.status);
        counters[key] = (counters[key] || 0) + 1;
        if (logStream) logStream.write(JSON.stringify(entry) + '\n');
        if (!quiet) {
            console.log('[gw] ' + (entry.synth ? 'SYNTH ' : '') + entry.status + ' ' + entry.method + ' ' +
                entry.path +
                (entry.note ? ' | ' + entry.note : '') +
                (entry.hops && entry.hops.length ? ' | via ' + entry.hops.length + ' redirect(s)' : '') +
                (entry.escape ? ' | ESCAPES-TO ' + entry.escape : '') +
                (entry.bytes != null ? ' | ' + entry.bytes + 'b' : ''));
        }
    }

    // No to-ports: this is a URL policy file, not a socket policy file.
    const POLICY = '<?xml version="1.0"?>\n<cross-domain-policy>\n' +
        '    <site-control permitted-cross-domain-policies="all"/>\n' +
        '    <allow-access-from domain="' + allowDomain + '"/>\n' +
        '</cross-domain-policy>\n';

    function sendLocal(res, body, type, meta) {
        record(Object.assign({ method: 'GET', status: 200, bytes: body.length, local: true }, meta));
        res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
        res.end(body);
    }

    function fetchUpstream(url, cb) {
        const target = new URL(url);
        const headers = { host: target.host, 'accept-encoding': 'identity', 'cache-control': 'no-cache' };
        if (opts.userAgent) headers['user-agent'] = opts.userAgent;
        const req = https.request(target, { method: 'GET', headers: headers }, function (r) {
            const chunks = [];
            r.on('data', function (c) { chunks.push(c); });
            r.on('end', function () { cb(null, r.statusCode, r.headers, Buffer.concat(chunks)); });
        });
        req.on('error', function (e) { cb(e); });
        req.end();
    }

    // The #3 rewrite: keep every real entry, point sIP/iPort at the local relay. Served as a
    // body because session.webRequest can redirect a URL but cannot edit a response.
    function serveRewrittenServers(res) {
        fetchUpstream('https://game.aq.com/game/api/data/servers', function (err, status, headers, body) {
            if (err || status !== 200) {
                record({ method: 'GET', path: '/__servers', status: err ? 'ERR' : status, note: 'upstream list fetch failed' });
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('servers fetch failed');
                return;
            }
            let list;
            try { list = JSON.parse(body.toString('utf8')); } catch (e) {
                record({ method: 'GET', path: '/__servers', status: 502, note: 'upstream not JSON' });
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('servers not JSON');
                return;
            }
            const out = list.map(function (s) {
                return Object.assign({}, s, { sIP: rewrite.host, iPort: rewrite.port });
            });
            const payload = Buffer.from(JSON.stringify(out));
            record({ method: 'GET', path: '/__servers', status: 200, bytes: payload.length, local: true,
                note: rewrite.host + ':' + rewrite.port + ' substituted into ' + out.length + ' entries' });
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            res.end(payload);
        });
    }

    function proxy(req, res, route) {
        const u = new URL(req.url, selfOrigin);
        const startUrl = route.origin + route.path + u.search;
        const entry = {
            method: req.method,
            path: decodeURIComponent(new URL(startUrl).pathname) + u.search,
            status: null
        };
        follow(startUrl, 0);

        function follow(url, depth) {
            const target = new URL(url);
            const headers = {};
            for (const k of Object.keys(req.headers)) {
                if (k === 'host' || k === 'connection' || k === 'accept-encoding' || k === 'content-length') continue;
                headers[k] = req.headers[k];
            }
            headers.host = target.host;               // the upstream answers by Host, not by IP
            headers['accept-encoding'] = 'identity';
            if (opts.userAgent) headers['user-agent'] = opts.userAgent;

            const upstream = https.request(target, { method: req.method, headers: headers }, function (upRes) {
                const status = upRes.statusCode;
                const loc = upRes.headers.location;
                if (loc && status >= 300 && status < 400 && depth < 5) {
                    upRes.resume();
                    const next = new URL(loc, url).toString();
                    entry.hops = (entry.hops || []).concat([{ status: status, to: next }]);
                    follow(next, depth + 1);
                    return;
                }
                entry.status = status;
                if (loc) {
                    const abs = new URL(loc, url).toString();
                    const mapped = localize(abs, selfOrigin);
                    entry.note = mapped ? 'redirect rewritten to local origin' : 'redirect to unmapped host';
                    if (!mapped) entry.escape = abs;
                }
                if (controls.synth && /(^|\/)api\/data\/gameversion$/.test(target.pathname) && status === 404) {
                    upRes.resume();
                    const body = Buffer.from(SYNTH_GAMEVERSION);
                    record(Object.assign(entry, { status: 200, bytes: body.length, synth: true,
                        note: 'upstream 404 replaced with captured body' }));
                    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
                    res.end(body);
                    return;
                }
                const outHeaders = {};
                for (const k of Object.keys(upRes.headers)) {
                    if (k === 'etag' || k === 'last-modified' || k === 'expires' || k === 'content-encoding' ||
                        k === 'content-length' || k === 'transfer-encoding') continue;
                    outHeaders[k] = upRes.headers[k];
                }
                if (outHeaders.location) {
                    const mapped = localize(outHeaders.location, selfOrigin);
                    if (mapped) outHeaders.location = mapped;
                }
                if (!outHeaders['content-type'] && MIME[extOf(target.pathname)]) {
                    outHeaders['content-type'] = MIME[extOf(target.pathname)];
                }
                outHeaders['cache-control'] = 'no-store';   // a repeat run must exercise the gateway again
                entry.bytes = 0;
                res.writeHead(status, outHeaders);
                upRes.on('data', function (c) { entry.bytes += c.length; });
                upRes.on('end', function () { record(entry); });
                upRes.pipe(res);
            });
            upstream.on('error', function (e) {
                record(Object.assign(entry, { status: 'ERR', error: e.message }));
                if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('gateway upstream error: ' + e.message);
            });
            upstream.end();
        }
    }

    const server = http.createServer(function (req, res) {
        const u = new URL(req.url, selfOrigin);
        const pathname = decodeURIComponent(u.pathname);

        if (pathname === '/crossdomain.xml' || pathname === '/policy.xml') {
            sendLocal(res, POLICY, 'text/plain; charset=utf-8', { path: pathname, note: 'allowDomain=' + allowDomain });
            return;
        }
        if (pathname === '/__status') {
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify({ origin: selfOrigin, counters: counters, count: entries.length,
                controls: controls, entries: entries }));
            return;
        }
        if (pathname === '/__control') {
            if (u.searchParams.get('synth') !== null) controls.synth = u.searchParams.get('synth') === '1';
            if (u.searchParams.get('pause') !== null) controls.paused = u.searchParams.get('pause') === '1';
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(JSON.stringify(controls));
            return;
        }
        if (pathname === '/__reset') {
            entries.length = 0;
            for (const k of Object.keys(counters)) delete counters[k];
            sendLocal(res, Buffer.from('ok'), 'text/plain', { path: pathname });
            return;
        }
        if (pathname === '/__servers') {
            if (!rewrite) { res.writeHead(404); res.end('no --rewrite configured'); return; }
            serveRewrittenServers(res);
            return;
        }
        if (opts.wrapper && pathname === '/wrapper.html') {
            sendLocal(res, fs.readFileSync(opts.wrapper), MIME['.html'], { path: pathname });
            return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
            record({ method: req.method, path: pathname + u.search, status: 501, local: true,
                note: 'gateway only proxies GET' });
            res.writeHead(501, { 'Content-Type': 'text/plain' });
            res.end('gateway only proxies GET');
            return;
        }
        if (controls.paused) {
            record({ method: req.method, path: pathname + u.search, status: 503, local: true, note: 'paused' });
            res.writeHead(503, { 'Content-Type': 'text/plain' });
            res.end('gateway paused');
            return;
        }
        proxy(req, res, upstreamFor(pathname));
    });

    return {
        origin: selfOrigin,
        port: port,
        controls: controls,
        start: function () {
            return new Promise(function (resolve, reject) {
                server.on('error', reject);
                server.listen(port, '127.0.0.1', function () { resolve(selfOrigin); });
            });
        },
        close: function () {
            return new Promise(function (resolve) {
                if (logStream) logStream.end();
                server.close(function () { resolve(); });
            });
        },
        entries: entries,
        counters: function () { return counters; }
    };
}

module.exports = { createGateway: createGateway, parseArgs: parseArgs, SYNTH_GAMEVERSION: SYNTH_GAMEVERSION };

if (require.main === module) {
    const args = parseArgs(process.argv.slice(2));
    const gw = createGateway({
        port: args.port || 8488,
        allowDomain: args.allowDomain || '*',
        synth: !!args.synth,
        quiet: !!args.quiet,
        logFile: args.logFile || null,
        userAgent: args.userAgent || null,
        wrapper: args.wrapper ? path.resolve(args.wrapper) : null,
        rewrite: args.rewrite ? { host: '127.0.0.1', port: Number(args.rewrite) } : null
    });
    gw.start().then(function (origin) {
        console.log('[gw] listening on ' + origin + (args.synth ? ' (--synth)' : ''));
        process.on('SIGINT', function () { gw.close().then(function () { process.exit(0); }); });
    }).catch(function (e) {
        console.error('[gw] failed to start: ' + e.message);
        process.exit(1);
    });
}
