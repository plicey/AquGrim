const http = require('http');

// The response-body half of the shared session-rule layer.
//
// Why a service instead of an in-flight filter: Electron 11 has no webRequest.filterResponseData
// (it arrived in a later Electron line), so a response body cannot be rewritten on the wire on the
// pinned version. Instead the session-rule layer redirects a matched request to this loopback
// service, which fetches the real upstream itself, lets the owning rule replace the body, and
// serves the result. The client sees one response; the platform saw everything in it.
//
// Safety, because this carries a live session and a credential POST:
// - one route only (BODY_ROUTE); anything else is a 404. It is not a general proxy.
// - the target must match a URL a registered rule declared, or the request is refused without
//   contacting anyone. A local page or process that guesses the port gains nothing.
// - a rule that throws leaves the original body intact: a broken rewrite must not empty a
//   response the client depends on.
// - upstream redirects are followed here, so the client never leaves loopback.
// The session-rule layer keeps its single listener per event: this service owns no webRequest rule.

const BODY_ROUTE = '/__aquastar-body';
const MAX_REDIRECTS = 5;

function createBodyService(options) {
    options = options || {};
    const rules = Array.isArray(options.rules) ? options.rules.filter(Boolean) : [];
    const onLog = typeof options.onLog === 'function' ? options.onLog : function () {};
    const matchesPattern = typeof options.matchesPattern === 'function' ? options.matchesPattern : null;

    let server = null;
    let port = null;

    function patternMatches(pattern, target) {
        return matchesPattern ? matchesPattern(pattern, target) : false;
    }

    function ruleFor(target) {
        for (let i = 0; i < rules.length; i++) {
            if (rules[i].urls.some(function (pattern) { return patternMatches(pattern, target); })) {
                return rules[i];
            }
        }
        return null;
    }

    function requestUpstream(target, method, headers, body, redirects) {
        return new Promise(function (resolve, reject) {
            const parsed = new URL(target);
            const req = http.request({
                protocol: parsed.protocol,
                hostname: parsed.hostname,
                port: parsed.port || undefined,
                path: parsed.pathname + parsed.search,
                method: method,
                headers: headers
            }, function (res) {
                const chunks = [];
                res.on('data', function (chunk) { chunks.push(chunk); });
                res.on('end', function () {
                    const status = res.statusCode;
                    if (status >= 300 && status < 400 && res.headers.location) {
                        if (redirects >= MAX_REDIRECTS) {
                            reject(new Error('too many upstream redirects'));
                            return;
                        }
                        // A followed redirect is a fresh GET: the body and verb belong to the
                        // original request, and node derives the new Host from the new target.
                        const nextHeaders = Object.assign({}, headers);
                        delete nextHeaders.host;
                        delete nextHeaders['content-length'];
                        requestUpstream(new URL(res.headers.location, target).href, 'GET',
                            nextHeaders, null, redirects + 1).then(resolve, reject);
                        return;
                    }
                    resolve({ status: status, headers: res.headers, body: Buffer.concat(chunks) });
                });
            });
            req.on('error', reject);
            if (body && body.length) req.write(body);
            req.end();
        });
    }

    function serve(req, res, target) {
        const chunks = [];
        req.on('data', function (chunk) { chunks.push(chunk); });
        req.on('end', function () {
            const body = Buffer.concat(chunks);
            const headers = Object.assign({}, req.headers);
            delete headers.host;
            // The service is the client now; a stale length from the browser must not truncate.
            if (body.length) headers['content-length'] = String(body.length);

            requestUpstream(target, req.method, headers, body, 0).then(async function (upstream) {
                const rule = ruleFor(target);
                let served = upstream.body;
                if (rule) {
                    try {
                        // A rule may need to await something before it can answer (steering waits
                        // on a relay port), so a returned promise is resolved, not stringified.
                        const replacement = await rule.onResponseBody({
                            url: target,
                            method: req.method,
                            statusCode: upstream.status,
                            requestHeaders: req.headers,
                            responseHeaders: upstream.headers
                        }, served);
                        if (replacement !== undefined && replacement !== null) {
                            served = Buffer.isBuffer(replacement)
                                ? replacement
                                : Buffer.from(String(replacement), 'utf8');
                        }
                    } catch (error) {
                        onLog('body rule ' + rule.id + ' failed, serving the original body: ' +
                            (error && error.message ? error.message : error));
                    }
                }
                const outHeaders = Object.assign({}, upstream.headers);
                // A replacement may change length: never hand the client a stale one.
                delete outHeaders['content-length'];
                delete outHeaders['transfer-encoding'];
                outHeaders['content-length'] = String(served.length);
                res.writeHead(upstream.status, outHeaders);
                res.end(served);
            }).catch(function (error) {
                onLog('body service upstream failed for ' + String(target).slice(0, 120) + ': ' + error.message);
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('upstream failed');
            });
        });
    }

    function handle(req, res) {
        const requestUrl = new URL(req.url, 'http://127.0.0.1');
        if (requestUrl.pathname !== BODY_ROUTE) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not found');
            return;
        }
        const target = requestUrl.searchParams.get('u');
        if (typeof target !== 'string' || !ruleFor(target)) {
            onLog('body service refused a URL no rule declared: ' + String(target).slice(0, 120));
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('not declared');
            return;
        }
        serve(req, res, target);
    }

    return {
        get port() { return port; },

        // A rule whose patterns cannot be read declares nothing, so refuse it rather than
        // advertising a body service that would serve every request unmodified.
        start: function () {
            const undeclared = rules.filter(function (rule) {
                return !Array.isArray(rule.urls) || !rule.urls.length;
            }).map(function (rule) { return rule.id; });
            if (undeclared.length) {
                return Promise.reject(new Error(
                    'body service refuses to start: rule(s) ' + undeclared.join(', ') + ' declare no URLs'));
            }
            const created = http.createServer(function (req, res) { handle(req, res); });
            return new Promise(function (resolve, reject) {
                created.once('error', reject);
                created.listen(0, '127.0.0.1', function () {
                    created.removeListener('error', reject);
                    created.on('error', function (error) { onLog('body service listener failed: ' + error.message); });
                    server = created;
                    port = created.address().port;
                    onLog('body service listening on 127.0.0.1:' + port + ' for ' +
                        rules.map(function (rule) { return rule.id; }).join(', '));
                    resolve({ port: port });
                });
            });
        },

        /** The loopback URL the session-rule layer sends a matched request to. */
        urlFor: function (details) {
            if (!port) throw new Error('[AquGrim] body service is not started');
            return 'http://127.0.0.1:' + port + BODY_ROUTE + '?u=' + encodeURIComponent(details.url);
        },

        close: function () {
            const closing = server;
            server = null;
            port = null;
            if (!closing) return Promise.resolve();
            return new Promise(function (resolve) { closing.close(resolve); });
        }
    };
}

module.exports = {
    createBodyService: createBodyService,
    BODY_ROUTE: BODY_ROUTE
};
