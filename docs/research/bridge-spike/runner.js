const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const flashTrust = require('/home/ammar/.codex/worktrees/757d/aqugrim/node_modules/nw-flash-trust');

const args = process.argv.slice(1);
function pick(k) { const f = args.filter(function (a) { return a.indexOf(k + '=') === 0; })[0]; return f ? f.slice(k.length + 1) : null; }
const PAGE_SWF = pick('page') || 'bridge6.swf';
const TARGET = pick('swf') || 'http://127.0.0.1:8899/game.swf';
const SHARE = args.indexOf('share') >= 0 ? '1' : '0';

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('ppapi-flash-path', '/home/ammar/.codex/worktrees/757d/aqugrim/FlashPlayer/libpepflashplayer.so');
app.commandLine.appendSwitch('ppapi-flash-version', '34.0.0.137');
function log() { console.log.apply(console, arguments); }

const server = http.createServer(function (req, res) {
  const p = path.join('/var/tmp/aq-spike/www', decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(p)) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'application/x-shockwave-flash', 'Access-Control-Allow-Origin': '*' });
  res.end(fs.readFileSync(p));
});

app.whenReady().then(async function () {
  await new Promise(r => server.listen(8899, '127.0.0.1', r));
  const tm = flashTrust.initSync('aq-spike', path.join(app.getPath('userData'), 'Pepper Data', 'Shockwave Flash', 'WritableRoot'));
  tm.empty();
  ['http://127.0.0.1:8899', 'file:///var/tmp/aq-spike/www', 'https://game.aq.com'].forEach(function (u) { try { tm.add(u); } catch (e) {} });
  const win = new BrowserWindow({ width: 960, height: 530, show: false,
    webPreferences: { nodeIntegration: false, sandbox: false, contextIsolation: true, plugins: true, backgroundThrottling: false } });
  win.webContents.on('console-message', function (e, level, message) { if (String(message).indexOf('[spike]') >= 0) log('PAGE ' + message); });
  const url = 'http://127.0.0.1:8899/bridge6.html?swf=' + encodeURIComponent(TARGET) + '&share=' + SHARE;
  log('TARGET=' + TARGET + ' SHARE=' + SHARE);
  await win.loadURL(url);
  await new Promise(r => setTimeout(r, 12000));
  async function callJs(expr) {
    try { return await win.webContents.executeJavaScript('(function(){var el=document.getElementById("movie"); if(!el) return "NO_EL"; ' + expr + '})()'); }
    catch (e) { return 'THREW:' + e.message; }
  }
  log('REPORT ' + await callJs('return typeof el.aqReport==="function" ? el.aqReport() : "no aqReport";'));
  log('LIVEREAD ' + await callJs('return typeof el.aqGet==="function" ? el.aqGet("world.strFrame") : "no aqGet";'));
  log('KEYS ' + await callJs('return typeof el.aqKeys==="function" ? el.aqKeys("") : "no aqKeys";'));
  log('SETPROBE ' + await callJs('return typeof el.aqSet==="function" ? el.aqSet("aqProbe","written") : "no aqSet";'));
  log('GETPROBE ' + await callJs('return typeof el.aqGet==="function" ? el.aqGet("aqProbe") : "no aqGet";'));
  app.exit(0);
});
