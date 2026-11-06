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
app.on('window-all-closed', () => {});
require('../res/flash').appendPerformanceSwitches(app);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => { console.error('Keyboard smoke timed out'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html');
            res.end(`<style>${fs.readFileSync(path.join(root, 'res/game_chrome.css'), 'utf8')}</style>
                <body><div id="chrome"></div><div id="stage"><div id="surface"></div></div>
                <script>
                window.drafts = [];
                window.aquastarChrome = {
                    getView: async () => ({enabled:true,height:27,controls:[
                        {id:'autoSkillSet',kind:'button',label:'Skills',contextEditor:true}]}),
                    action: async (id, args) => {
                        if (args.draft) drafts.push(args.text);
                        return {editor:{title:'Class',className:'Class',selected:'Farm',
                            text:args.text || '1;2',items:[{name:'Farm',label:'Farm'}]}};
                    }
                };
                </script>
                ${process.env.PROBE_STALL_RAF === '1' ? '<script>let frameId=0;window.requestAnimationFrame=()=>++frameId;window.cancelAnimationFrame=()=>{};</script>' : ''}
                <script src="/game-timing.js"></script><script src="/ruffle/ruffle.js"></script><script>
                window.p = RufflePlayer.newest().createPlayer();document.getElementById('surface').appendChild(p);
                window.ready = p.ruffle(1).load({url:'/probe.swf',autoplay:'on',
                    backgroundExecutionMode:'mainThread',preferredRenderer:'wgpu-webgl',
                    allowScriptAccess:true,unmuteOverlay:'hidden'});
                </script><script>${fs.readFileSync(path.join(root, 'res/game_chrome.js'), 'utf8')}</script>`);
            return;
        }
        const file = req.url === '/probe.swf'
            ? path.join(root, 'test/fixtures/keyboard/KeyboardProbe.swf')
            : req.url === '/game-timing.js' ? path.join(root, 'res/game-timing.js')
            : /^\/ruffle\/[^/]+\.(js|wasm)$/.test(req.url) ? path.join(engine, path.basename(req.url)) : null;
        if (!file) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', file.endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
        fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    // Exercise the production setting and Ruffle's visibility-driven fallback.
    for (const backgroundThrottling of [false, true]) {
        const win = new BrowserWindow({show:false,webPreferences:{backgroundThrottling}});
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
        await js(`document.getElementById('chrome-autoSkillSet').dispatchEvent(
            new MouseEvent('contextmenu', {bubbles:true,cancelable:true}));true`);
        await delay(100);
        assert.ok(await js("!!document.getElementById('contextEditor')"), 'skill editor must open');
        const point = await js(`const text=document.querySelector('#contextEditor textarea');
            text.value='4;3';text.dispatchEvent(new Event('input', {bubbles:true}));
            const rect=p.getBoundingClientRect();
            ({x:Math.round(rect.left+rect.width*.85),y:Math.round(rect.top+rect.height*.75)})`);
        win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});
        win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
        await delay(200);
        assert.strictEqual(await js("!!document.getElementById('contextEditor')"), false,
            'a real Ruffle click must dismiss the skill editor even when mousedown is suppressed');
        assert.strictEqual(await js('window.drafts.at(-1)'), '4;3', 'dismissal must preserve the draft');
        console.log('Ruffle click dismissed editor and preserved draft');
        await js('window.timerTicks = 0; setInterval(() => window.timerTicks++, 50); true');
        async function checkProgress(label) {
            const before = await js('[p.probeState().frames, window.timerTicks]');
            await delay(1500);
            const after = await js('[p.probeState().frames, window.timerTicks]');
            assert.ok(after[0] - before[0] >= 15, label + ': game frames must keep advancing');
            assert.ok(after[1] - before[1] >= 15, label + ': page timers must keep advancing');
            console.log(label, {backgroundThrottling, frames: after[0] - before[0], timers: after[1] - before[1]});
        }
        const cover = new BrowserWindow({...win.getBounds(), alwaysOnTop:true});
        await cover.loadURL('data:text/html,<body style="background:black">Cover</body>');
        cover.focus();
        await checkProgress('Covered/unfocused');
        cover.destroy();
        win.minimize();
        await delay(100);
        if (win.isMinimized()) await checkProgress('Minimized');
        else console.log('Minimize unavailable: run with a window manager to cover this case');
        win.restore();
        win.hide();
        await delay(100);
        assert.strictEqual(await js('document.hidden'), backgroundThrottling,
            'production keeps page visibility active; fallback must exercise hidden-tab execution');
        await checkProgress('Hidden');
        win.destroy();
    }
    clearTimeout(deadline);
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, {recursive:true,force:true});
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
