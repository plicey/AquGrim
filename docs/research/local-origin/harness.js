// Electron 11.5.0 harness for ticket #15: boots the real AQW loader from the local gateway
// origin with PPAPI Flash, logs every request the client makes, and screenshots the window.
//
// Scratch artifact; nothing here ships. Run through run.sh, or directly:
//   node_modules/electron/dist/electron docs/research/local-origin/harness.js --gw=8488
// Flags: --gw=<port> gateway port, --relay=<port> local TCP relay, --relay-target=host:port,
//        --wait=<ms> observation window, --shots=<n>, --synth=0 to stop synthesising
//        gameversion, --swf=<path> entry SWF, --wmode=direct|opaque, --no-gpu, --out=<dir>.

const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { createGateway, parseArgs } = require('./gateway.js');
const flashTrust = require('nw-flash-trust');

const args = parseArgs(process.argv.slice(1));
const REPO = path.resolve(__dirname, '..', '..', '..');
const OUT = args.out ? path.resolve(args.out) : '/var/tmp/aq-origin/run';
const GW_PORT = Number(args.gw || 8488);
const RELAY_PORT = Number(args.relay || (GW_PORT + 1));
const RELAY_TARGET = String(args.relayTarget || 'sock7.aq.com:5593');
const WAIT_MS = Number(args.wait || 30000);
const WMODE = String(args.wmode || 'direct');
const USE_GPU = args.noGpu === undefined;
const SYNTH = args.synth === undefined ? true : (args.synth !== '0' && args.synth !== false);

fs.mkdirSync(OUT, { recursive: true });
const events = [];
const t0 = Date.now();
function stamp() { return ((Date.now() - t0) / 1000).toFixed(2).padStart(7) + 's'; }
function log(kind, message) {
    const line = '[' + stamp() + '] ' + kind + ' ' + message;
    events.push({ t: Number(((Date.now() - t0) / 1000).toFixed(2)), kind: kind, message: String(message) });
    console.log(line);
}
function clean(s) { return String(s).replace(/\0/g, '\\0').slice(0, 300); }

// --- PPAPI Flash registration, mirroring res/flash.js -------------------------------
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ppapi-flash-path', path.join(REPO, 'FlashPlayer', 'libpepflashplayer.so'));
app.commandLine.appendSwitch('ppapi-flash-version', '34.0.0.137');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
if (!USE_GPU) {
    app.commandLine.appendSwitch('disable-gpu');
    app.commandLine.appendSwitch('disable-gpu-compositing');
    app.disableHardwareAcceleration();
}
app.setPath('userData', path.join(OUT, 'userdata'));   // keep the real profile untouched

// --- local TCP relay (the #3 spike shape): policy locally, everything else upstream ---
function startRelay(port, target, onLog) {
    const parts = target.split(':');
    const tHost = parts[0];
    const tPort = Number(parts[1]);
    const POLICY = "<cross-domain-policy><allow-access-from domain='*' to-ports='*'/></cross-domain-policy>" + String.fromCharCode(0);
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
        client.on('data', function (d) {
            const text = d.toString('latin1');
            if (!sawGameTraffic && text.indexOf('policy-file-request') >= 0) {
                onLog('C->S-policy-request', clean(text));
                client.write(POLICY);
                onLog('S->C-policy', clean(POLICY));
                return;      // the real AQW servers keep the socket open after the policy too
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
    return new Promise(function (resolve) {
        server.on('error', function (e) { onLog('relay-error', e.message); resolve(null); });
        server.listen(port, '127.0.0.1', function () { resolve(server); });
    });
}

// --- main ----------------------------------------------------------------------------
app.whenReady().then(async function () {
    const trustPath = path.join(app.getPath('userData'), 'Pepper Data', 'Shockwave Flash', 'WritableRoot');
    const trust = flashTrust.initSync('aquastar-local-origin-spike', trustPath);
    trust.empty();
    ['http://127.0.0.1:' + GW_PORT, 'http://127.0.0.1:' + RELAY_PORT].forEach(function (u) {
        try { trust.add(u); } catch (e) { log('trust-error', u + ' ' + e.message); }
    });

    const relayLines = [];
    const relay = await startRelay(RELAY_PORT, RELAY_TARGET, function (kind, msg) {
        relayLines.push({ t: stamp(), kind: kind, message: msg });
        log('RELAY', kind + ' | ' + msg);
    });
    if (!relay) log('RELAY-ERROR', 'could not listen on ' + RELAY_PORT);

    const gw = createGateway({
        port: GW_PORT,
        synth: SYNTH,
        logFile: path.join(OUT, 'gateway.jsonl'),
        userAgent: args.ua || null,
        wrapper: path.join(__dirname, 'wrapper.html'),
        rewrite: { host: '127.0.0.1', port: RELAY_PORT },
        quiet: !!args.quietGw
    });
    await gw.start();
    log('gateway', gw.origin + ' | socket rewrite 127.0.0.1:' + RELAY_PORT + ' -> ' + RELAY_TARGET +
        ' | synth gameversion=' + SYNTH);

    // webRequest view: what the Flash plugin asks for, independent of the gateway's log.
    const seen = [];
    session.defaultSession.webRequest.onBeforeRequest(function (details, cb) {
        seen.push({ t: stamp(), url: details.url, type: details.resourceType, method: details.method });
        log('WEBREQ', details.resourceType + ' ' + details.method + ' ' + details.url);
        cb({});
    });
    session.defaultSession.webRequest.onCompleted(function (details) {
        log('WEBRES', details.statusCode + ' ' + details.url.slice(0, 180));
    });
    session.defaultSession.webRequest.onErrorOccurred(function (details) {
        log('WEBERR', details.error + ' ' + details.url.slice(0, 180));
    });

    const win = new BrowserWindow({
        width: 960, height: 530, useContentSize: true, show: true,
        webPreferences: {
            nodeIntegration: false, sandbox: false, contextIsolation: true,
            plugins: true, backgroundThrottling: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });
    win.webContents.on('console-message', function (e, level, message, line, source) {
        log('CONSOLE', 'L' + level + ' ' + message + (source ? ' @' + String(source).slice(-60) + ':' + line : ''));
    });
    win.webContents.on('did-fail-load', function (e, code, desc, url) { log('FAIL-LOAD', code + ' ' + desc + ' ' + url); });
    win.webContents.on('render-process-gone', function (e, details) { log('RENDER-GONE', JSON.stringify(details)); });
    win.webContents.on('plugin-crashed', function (e, name, version) { log('PLUGIN-CRASHED', name + ' ' + version); });
    app.on('child-process-gone', function (e, details) { log('CHILD-GONE', JSON.stringify(details)); });
    ipcMain.on('aq-page-error', function (e, msg) { log('PAGE-ERROR', msg); });

    const swfPath = args.swf || '/game/gamefiles/Loader4.swf?ver=b';
    const pageUrl = gw.origin + '/wrapper.html?swf=' + encodeURIComponent(gw.origin + swfPath) +
        '&base=' + encodeURIComponent(gw.origin + swfPath.replace(/[^/]*$/, '')) + '&wmode=' + WMODE;
    log('LOAD', pageUrl);
    await win.loadURL(pageUrl);

    const shots = [];
    const shotCount = Number(args.shots || 5);
    for (let i = 1; i <= shotCount; i++) {
        await new Promise(function (r) { setTimeout(r, Math.round(WAIT_MS / shotCount)); });
        try {
            const img = await win.webContents.capturePage();
            const png = img.toPNG();
            const p = path.join(OUT, 'shot' + i + '.png');
            fs.writeFileSync(p, png);
            const size = img.getSize();
            shots.push({ t: stamp(), file: p, bytes: png.length, width: size.width, height: size.height });
            log('SHOT', p + ' ' + size.width + 'x' + size.height + ' ' + png.length + 'b');
        } catch (e) { log('SHOT-ERROR', e.message); }
    }

    const summary = {
        harness: {
            origin: gw.origin, page: pageUrl, loaderPath: swfPath, wmode: WMODE,
            relayPort: RELAY_PORT, relayTarget: RELAY_TARGET, waitMs: WAIT_MS, synth: SYNTH,
            gpu: USE_GPU, electron: process.versions.electron, chrome: process.versions.chrome
        },
        webRequests: seen,
        gatewayCounters: gw.counters(),
        gatewayEntries: gw.entries,
        relay: relayLines,
        console: events.filter(function (e) { return e.kind === 'CONSOLE'; }),
        pageErrors: events.filter(function (e) { return e.kind === 'PAGE-ERROR'; }),
        shots: shots,
        events: events
    };
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
    log('SUMMARY', path.join(OUT, 'summary.json'));

    if (relay) relay.close();
    await gw.close();
    app.exit(0);
}).catch(function (e) {
    log('HARNESS-ERROR', (e && e.stack) || String(e));
    app.exit(1);
});
