const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '../../..');
const build = process.env.MUGETSU_WEB_DIR || path.join(root, 'res/ruffle');
const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'aqugrim-engine-smoke-'));
app.setPath('userData', profile);
require(root + '/res/flash').appendPerformanceSwitches(app);
app.commandLine.appendSwitch('no-sandbox');
const errors = [];
const expected = require(root + '/plugins/grimlite-parity/plugin.json').bridgeCallbacks;
const deadline = setTimeout(() => { console.error('SMOKE timeout', errors); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  const game = require(root + '/plugins/grimlite-parity/game-origin');
  const files = game.files();
  for (const name of fs.readdirSync(build).filter(n => /\.(js|wasm)$/.test(n))) files['/ruffle/' + name] = path.join(build, name);
  const html = path.join(profile, 'smoke.html');
  fs.writeFileSync(html, `<!doctype html><style>html,body,ruffle-player{margin:0;width:100%;height:100%;display:block}</style><body><script src="/ruffle/ruffle.js"></script><script>
  window.loaded=false;window.failure='';
  const p=window.RufflePlayer.newest().createPlayer();document.body.appendChild(p);
  p.ruffle(1).load({url:'/game/aqua-bridge.swf',preferredRenderer:'wgpu-webgl',allowScriptAccess:true,autoplay:'on',unmuteOverlay:'hidden',splashScreen:false,quality:'high'}).then(()=>window.loaded=true).catch(e=>window.failure=String(e));
  </script>`);
  files['/smoke.html'] = html;
  const origin = require(root + '/res/platform/origin-proxy').createOriginProxy({routes:game.routes(),files,userAgent:game.userAgent});
  const base = await origin.listen();
  const win = new BrowserWindow({show:false,width:960,height:550,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message', (_event, ...args) => { const text = _event.message || args.map(v => typeof v === 'string' ? v : '').join(' '); if (/panic|error|wgpu|renderer|Render backend/i.test(text)) { errors.push(text.slice(0,1000)); console.log(text.slice(0,1000)); } });
  await win.loadURL(base + '/smoke.html');
  const timer = setInterval(async () => {
    try {
      const state = await win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('ruffle-player');return {loaded:window.loaded,failure:window.failure,callback:typeof p.getBridgeFps,fps:typeof p.getBridgeFps==='function'?p.getBridgeFps():null,canvas:!!p.shadowRoot?.querySelector('canvas'),missing:${JSON.stringify(expected)}.filter(name=>typeof p[name]!=='function')}})()`);
      if (state.failure) throw new Error(state.failure);
      if (state.loaded && Number(state.fps)>0 && state.canvas && state.missing.length===0) {
        clearInterval(timer); clearTimeout(deadline);
        await new Promise(resolve => setTimeout(resolve, 6000));
        state.fpsAfterLoad = await win.webContents.executeJavaScript("Number(document.querySelector('ruffle-player').getBridgeFps())");
        fs.writeFileSync(path.join(profile,'smoke.png'), (await win.webContents.capturePage()).toPNG());
        console.log('SMOKE '+JSON.stringify({state,errors,screenshot:path.join(profile,'smoke.png')}));
        const gpu = errors.some(e => e.includes('Used renderer: wgpu-webgl'));
        app.exit(!gpu || state.fpsAfterLoad <= 0 || errors.some(e=>/panicked|RuntimeError|Ruffle load failed/.test(e))?1:0);
      }
    } catch(e) { console.error(e.message); app.exit(1); }
  },1000);
}).catch(error => { console.error(error); app.exit(1); });
