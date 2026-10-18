// Local origin for a plugin's game: serves the game's own paths from http://127.0.0.1:<port>
// and forwards everything it does not have to that path's upstream origin. The plugin names
// the hosts (routes: local prefix -> upstream origin); the platform names no game.
//
// Why it exists: PPAPI Flash inside Chromium grants no local-trusted sandbox, so a bridge SWF
// cannot load the game SWF cross-origin - the loaded content's own policy denies it. Serving
// page and SWF from one loopback origin is what makes a same-origin bridge legal.

const http = require('http');
const https = require('https');
const fs = require('fs');

const MAX_REDIRECTS = 5;

function upstreamFor(routes, pathname) {
    let best = null;
    (routes || []).forEach(function (route) {
        if (!route || typeof route.prefix !== 'string' || typeof route.origin !== 'string') return;
        if (pathname.indexOf(route.prefix) !== 0) return;
        if (!best || route.prefix.length > best.prefix.length) best = route;
    });
    if (!best) return null;
    // "/proxy/content/" mounts that origin at its root; "/" is a plain host mirror.
    const rest = best.prefix === '/' ? pathname : pathname.slice(best.prefix.length - 1);
    return { origin: best.origin, path: rest };
}

function createOriginProxy(opts) {
    opts = opts || {};
    const routes = opts.routes || [];
    // Local files the origin answers itself (the page that embeds the game): served from the
    // game's own origin so page and SWF are same-origin, which a file:// page is not.
    const files = opts.files || {};
    const log = opts.log || function () {};
    let publishedPort = null;

    function forward(req, res, target, body, depth) {
        const headers = Object.assign({}, req.headers);
        delete headers['accept-encoding'];
        // The body is re-framed by the upstream request itself; a forwarded chunked header
        // would describe framing that no longer applies.
        delete headers['transfer-encoding'];
        headers.host = target.host;   // upstreams answer by Host, not by the loopback address
        if (body && body.length) headers['content-length'] = String(body.length);
        const transport = target.protocol === 'https:' ? https : http;
        const upstream = transport.request(target, { method: req.method, headers: headers }, function (upRes) {
            const chunks = [];
            upRes.on('data', function (c) {
                chunks.push(c);
            });
            upRes.on('end', function () {
                const out = Buffer.concat(chunks);
                const location = upRes.headers.location;
                if (location && upRes.statusCode >= 300 && upRes.statusCode < 400 && depth < MAX_REDIRECTS) {
                    let next;
                    try {
                        next = new URL(location, target).toString();
                    } catch (e) {
                        next = null;
                    }
                    if (next) {
                        log('redirect ' + upRes.statusCode + ' ' + target.pathname + ' -> ' + next);
                        forward(req, res, new URL(next), body, depth + 1);
                        return;
                    }
                }
                const outHeaders = Object.assign({}, upRes.headers);
                delete outHeaders['content-encoding'];
                delete outHeaders['content-length'];
                delete outHeaders['transfer-encoding'];
                if (upRes.statusCode >= 300 && upRes.statusCode < 400) {
                    // The client may only ever talk to loopback: it never gets a Location.
                    delete outHeaders.location;
                    log('unfollowed redirect ' + upRes.statusCode + ' ' + target.pathname);
                }
                res.writeHead(upRes.statusCode, outHeaders);
                res.end(out);
            });
        });
        upstream.on('error', function (error) {
            // Surface the failure to the client instead of leaving the request hanging.
            log('upstream error ' + target.hostname + ': ' + error.message);
            if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('local origin upstream error: ' + error.message);
        });
        if (body && body.length) upstream.write(body);
        upstream.end();
    }

    const server = http.createServer(function (req, res) {
        const requested = new URL(req.url, 'http://127.0.0.1');
        const filePath = files[decodeURIComponent(requested.pathname)];
        if (filePath && (req.method === 'GET' || req.method === 'HEAD')) {
            try {
                const body = fs.readFileSync(filePath);
                res.writeHead(200, {
                    'Content-Type': 'text/html; charset=utf-8',
                    'Content-Length': body.length,
                    'Cache-Control': 'no-store'
                });
                res.end(req.method === 'HEAD' ? undefined : body);
            } catch (error) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('local origin cannot read ' + filePath + ': ' + error.message);
            }
            return;
        }
        const chunks = [];
        req.on('data', function (c) {
            chunks.push(c);
        });
        req.on('end', function () {
            const body = Buffer.concat(chunks);
            const url = new URL(req.url, 'http://127.0.0.1');
            const route = upstreamFor(routes, decodeURIComponent(url.pathname));
            if (!route) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('no local origin route for ' + url.pathname);
                return;
            }
            const target = new URL(route.origin + route.path + url.search);
            // The request body is read once and reused across redirect hops: the login flow
            // POSTs credentials, and a GET-only origin leaves the client hanging.
            forward(req, res, target, body.length ? body : null, 0);
        });
    });

    return {
        get port() {
            return publishedPort;
        },
        listen: function (port) {
            return new Promise(function (resolve, reject) {
                server.on('error', reject);
                server.listen(port || 0, '127.0.0.1', function () {
                    publishedPort = server.address().port;
                    resolve('http://127.0.0.1:' + server.address().port);
                });
            });
        },
        close: function () {
            return new Promise(function (resolve) {
                server.close(function () {
                    resolve();
                });
            });
        }
    };
}

module.exports = { createOriginProxy: createOriginProxy };
