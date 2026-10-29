// Apply platform + plugin SessionRule objects to Electron's defaultSession.
// Register-once-per-process (v1 plugin switch = restart).
//
// Electron keeps ONE listener per webRequest event per session: a second call to
// session.webRequest.onBeforeRequest() silently replaces the first. Rules therefore
// never register their own listeners. This module registers a single listener per
// event (filtered by the union of all rule URL patterns) and fans each request out to
// every rule whose patterns match, in registration order.
//
// Response bodies: Electron 11 has no webRequest.filterResponseData (added in a later
// Electron line), so a body cannot be rewritten on the wire. A rule that declares
// onResponseBody instead hands its matched request to a body service (ctx.responseBody),
// which serves that URL from loopback with the replacement body. The rule stays inside the
// single onBeforeRequest listener, so one-listener-per-event still holds.

/**
 * Match an Electron/Chrome match pattern ("*://*.example.com/*", "<all_urls>") against a URL.
 * Supports scheme, host (exact / "*" / "*.suffix"), optional explicit port, path glob.
 */
function matchesPattern(pattern, url) {
    if (pattern === '<all_urls>') return /^(https?|wss?|ftp|file):/i.test(url);
    const m = /^(\*|[a-z][a-z0-9+.-]*):\/\/([^/]*)(\/.*)$/i.exec(pattern);
    if (!m) return false;
    const u = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)([^#]*)/i.exec(url);
    if (!u) return false;

    const scheme = u[1].toLowerCase();
    if (m[1] !== '*' && m[1].toLowerCase() !== scheme) return false;
    if (m[1] === '*' && scheme !== 'http' && scheme !== 'https') return false;

    // Explicit ports restrict loopback body rules to the declared service.
    const port = /:(\d+)$/.exec(m[2]);
    const actualPort = /:(\d+)$/.exec(u[2]);
    if (port && port[1] !== (actualPort ? actualPort[1] : (scheme === 'https' ? '443' : '80'))) return false;

    // Strip userinfo and port before comparing hosts.
    const host = u[2].replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase();
    const patHost = m[2].toLowerCase();
    if (patHost !== '*') {
        if (patHost.indexOf('*.') === 0) {
            const suffix = patHost.slice(2);
            if (host !== suffix && !host.endsWith('.' + suffix)) return false;
        } else if (host !== patHost.replace(/:\d+$/, '')) {
            return false;
        }
    }

    const pathRe = new RegExp('^' + m[3].split('*').map(function (part) {
        return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }).join('.*') + '$');
    return pathRe.test(u[3]);
}

function ruleMatches(rule, url) {
    for (let i = 0; i < rule.urls.length; i++) {
        if (matchesPattern(rule.urls[i], url)) return true;
    }
    return false;
}

function unionUrls(rules) {
    const seen = {};
    const list = [];
    rules.forEach(function (rule) {
        rule.urls.forEach(function (pattern) {
            if (!seen[pattern]) { seen[pattern] = true; list.push(pattern); }
        });
    });
    return list;
}

function applySessionRules(session, rules, ctx) {
    if (!session || !session.webRequest || !Array.isArray(rules)) return { responseBody: { engaged: [], unengaged: [] } };
    ctx = ctx || {};
    const settings = ctx.settings || {};

    const active = rules.filter(function (rule) {
        if (!rule || !Array.isArray(rule.urls) || rule.urls.length === 0) return false;
        if (typeof rule.enabledWhen === 'function' && !rule.enabledWhen(settings)) return false;
        return true;
    });

    const headerRules = active.filter(function (r) { return typeof r.onBeforeSendHeaders === 'function'; });
    const responseBodyRules = active.filter(function (r) { return typeof r.onResponseBody === 'function'; });

    // A body rule with no body service cannot steer, so it is reported rather than silently
    // left as a plain passthrough. Callers decide whether that is fatal (a relay must not
    // come up pretending it steers) - the layer only refuses to lie about it.
    const bodyService = ctx.responseBody && typeof ctx.responseBody.urlFor === 'function'
        ? ctx.responseBody
        : null;
    const report = { responseBody: { engaged: [], unengaged: [] } };
    responseBodyRules.forEach(function (rule) {
        if (bodyService) { report.responseBody.engaged.push(rule.id); return; }
        report.responseBody.unengaged.push(rule.id);
        if (typeof ctx.logLine === 'function') {
            ctx.logLine('[AquGrim] session rule "' + rule.id +
                '" needs a response body but none is available; the response is served unmodified');
        }
    });

    const requestRules = active.filter(function (r) {
        return typeof r.onBeforeRequest === 'function' || typeof r.onResponseBody === 'function';
    });

    if (headerRules.length) {
        session.webRequest.onBeforeSendHeaders({ urls: unionUrls(headerRules) }, function (details, callback) {
            const matching = headerRules.filter(function (rule) { return ruleMatches(rule, details.url); });
            let index = 0;
            (function next() {
                if (index >= matching.length) {
                    callback({ requestHeaders: details.requestHeaders });
                    return;
                }
                const rule = matching[index++];
                rule.onBeforeSendHeaders(details, ctx, function (result) {
                    result = result || {};
                    if (result.cancel) { callback({ cancel: true }); return; }
                    if (result.requestHeaders) details.requestHeaders = result.requestHeaders;
                    next();
                });
            })();
        });
    }

    if (requestRules.length) {
        session.webRequest.onBeforeRequest({ urls: unionUrls(requestRules) }, function (details, callback) {
            const matching = requestRules.filter(function (rule) { return ruleMatches(rule, details.url); });
            let index = 0;
            (function next() {
                if (index >= matching.length) {
                    callback({ cancel: false });
                    return;
                }
                const rule = matching[index++];
                if (typeof rule.onBeforeRequest !== 'function') {
                    // A body rule: route this request to the service that serves the replacement.
                    if (bodyService) {
                        callback({ redirectURL: bodyService.urlFor(details) });
                        return;
                    }
                    next();
                    return;
                }
                rule.onBeforeRequest(details, ctx, function (result) {
                    result = result || {};
                    // A cancel or redirect from any rule is final.
                    if (result.cancel || result.redirectURL) { callback(result); return; }
                    next();
                });
            })();
        });
    }

    return report;
}

module.exports = {
    applySessionRules: applySessionRules,
    matchesPattern: matchesPattern
};
