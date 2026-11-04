// Run under Xvfb: this switches visibility on an isolated test window.
const { app, BrowserWindow } = require('electron');
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..');
const engine = process.env.PROBE_ENGINE || path.join(root, 'res/ruffle');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'keyboard-smoke-'));
app.setPath('userData', profile);
require('../res/flash').appendPerformanceSwitches(app);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Keyboard smoke timed out'); app.exit(1); }, 30000);
app.whenReady().then(async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end(`<body><div id="stage"><div id="surface"></div></div><script src="/ruffle/ruffle.js"></script><script>
                window.p = RufflePlayer.newest().createPlayer();document.getElementById('surface').appendChild(p);
                window.ready = p.ruffle(1).load({url:'/probe.swf',autoplay:'on',
                    backgroundExecutionMode:'mainThread',preferredRenderer:'wgpu-webgl',
                    allowScriptAccess:true,unmuteOverlay:'hidden'});
                </script><script>${fs.readFileSync(path.join(root, 'res/game_chrome.js'), 'utf8')}</script>`);
            return;
        }
        const file = req.url === '/probe.swf'
            ? path.join(root, 'test/fixtures/keyboard/KeyboardProbe.swf')
            : /^\/ruffle\/[^/]+\.(js|wasm)$/.test(req.url) ? path.join(engine, path.basename(req.url)) : null;
        if (!file) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const win = new BrowserWindow({show:false,webPreferences:{backgroundThrottling:true}});
    const js = code => win.webContents.executeJavaScript(code);
    await win.loadURL('http://127.0.0.1:' + server.address().port);
    await js('window.ready');
    win.show();win.focus();
    await delay(1000);
    await js(`p.probeKey('keyDown',87);p.probeKey('keyDown',68);
        p.tabIndex=0;p.focus();
        const input=document.createElement('input');document.body.appendChild(input);
        input.focus();p.focus();
        p.probeKey('keyDown',87);p.probeKey('keyDown',68);
        window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));true`);
    const state = await js(`p.probeKey('keyDown',83);p.probeKey('keyDown',65);
        p.probeKey('keyUp',49);p.probeState()`);
    console.log('Keyboard state:', JSON.stringify(state));
    assert.strictEqual(state.skills, 1);
    assert.strictEqual(state.x, -1, 'stale right key must not cancel left movement after losing focus');
    assert.strictEqual(state.y, 1, 'stale up key must not cancel down movement after losing focus');
    assert.ok(state.deactivations > 0, 'the movie must receive deactivation');
    win.showInactive();
    await delay(100);
    win.hide();
    await delay(100);
    assert.strictEqual(await js('document.hidden'), true, 'exercise actual hidden-tab execution');
    const before = await js('p.probeState().frames');
    await delay(1500);
    const after = await js('p.probeState().frames');
    assert.ok(after - before >= 15, 'game frames must keep advancing while minimized/hidden');
    console.log('Hidden game frames advanced:', after - before);
    clearTimeout(deadline);
    win.destroy();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, {recursive:true,force:true});
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
