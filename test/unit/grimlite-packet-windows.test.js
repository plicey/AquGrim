// The spammer and tamperer windows (spec #19 / ticket #27): the write half of the packet layer as
// the plugin ships it - two sandboxed pages, their own preloads and the main-process modules
// behind them. Everything the pages draw is checked against the reference's own control text
// (Grimoire/UI/PacketSpammer.cs, PacketTamperer.cs at 816d9cd), and every IPC call a page makes is
// checked against what its preload exposes.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const platform = require('../../res/platform');
const { createNamespacedStore } = require('../../res/platform/storage/namespaced-store.js');
const spammer = require('../../plugins/grimlite-parity/features/packets/spammer.js');
const framesApi = require('../../plugins/grimlite-parity/features/packets/frames.js');
const steeringNotice = require('../../plugins/grimlite-parity/features/packets/steering-notice.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const featureDir = path.join(pluginRoot, 'features/packets');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const SPAMMER_ID = 'grimlite-parity-packet-spammer';
const TAMPERER_ID = 'grimlite-parity-packet-tamperer';
const SETTING_NAME = 'Steer game traffic through a local relay';

async function activateParity(deps) {
  const discovered = platform.discoverPlugins({
    bundledDir: path.join(repoRoot, 'plugins'),
    appVersion: appVersion,
    log: function () {}
  });
  const plugin = discovered.plugins.filter(function (p) {
    return p.manifest.id === 'grimlite-parity';
  })[0];
  assert.ok(plugin, 'the parity plugin must be discovered: ' + discovered.errors.join('; '));
  return platform.activatePlugin(plugin, {
    appVersion: appVersion,
    appDataDirectory: fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-packetwin-')),
    clearRequireCache: true,
    log: function () {},
    deps: Object.assign({
      openFeatureWindow: function () { return {}; },
      getPacketTap: function () { return platform.createPacketTap(); },
      getPacketSender: function () { return function () { return true; }; }
    }, deps || {})
  });
}

function handlerFor(state, name) {
  const handler = state.ipcHandlers.filter(function (item) {
    return item.channel === 'plugin:grimlite-parity:' + name;
  })[0];
  assert.ok(handler, 'the plugin must register the ' + name + ' handler');
  return handler.listener;
}

// A stand-in for an Electron WebContents, of which these windows use send/once/isDestroyed.
function fakeWindow() {
  return {
    sent: [],
    handlers: {},
    destroyed: false,
    on: function (name, handler) { this.handlers[name] = handler; },
    once: function (name, handler) { this.handlers[name] = handler; },
    isDestroyed: function () { return this.destroyed; },
    send: function (channel, payload) { this.sent.push({ channel: channel, payload: payload }); },
    getURL: function () { return 'file:///packets.html'; }
  };
}

// The platform's own tap, so a capture is observed end to end rather than by a stand-in.
function tapHarness() {
  const tap = platform.createPacketTap();
  return {
    tap: tap,
    emit: function (direction, text) {
      tap.emit({ id: 1, direction: direction, data: Buffer.from(text, 'utf8') });
    }
  };
}

test('the two windows are the app\'s own kind: sandboxed pages, no Flash, each with a preload', async () => {
  const activated = await activateParity();
  const windows = activated.host._getState().featureWindows;

  [[SPAMMER_ID, 'spammer.html'], [TAMPERER_ID, 'tamperer.html']].forEach(function (pair) {
    const found = windows.filter(function (w) { return w.id === pair[0]; });
    assert.strictEqual(found.length, 1, 'missing feature window ' + pair[0] + ': ' +
      JSON.stringify(windows.map(function (w) { return w.id; })));
    const config = found[0].config;
    assert.strictEqual(config.webPreferences.sandbox, true, pair[0] + ' must be sandboxed');
    assert.strictEqual(config.webPreferences.plugins, false, pair[0] + ' must not load Flash');
    assert.strictEqual(config.webPreferences.contextIsolation, true, pair[0] + ' isolates contexts');
    assert.strictEqual(config.webPreferences.nodeIntegration, false, pair[0] + ' must not expose Node');
    assert.strictEqual(config.useContentSize, true, pair[0] + ' sizes its content');
    assert.strictEqual(config.alwaysOnTop, true, pair[0] + ' is TopMost in the reference designer');
    assert.ok(found[0].url.indexOf(pair[1]) !== -1, pair[0] + ' serves its own page: ' + found[0].url);
    assert.ok(fs.existsSync(require('url').fileURLToPath(found[0].url)), 'missing page ' + pair[1]);
    const preload = config.webPreferences.preload;
    assert.ok(typeof preload === 'string' && fs.existsSync(preload), pair[0] + ' needs a preload');
    const preloadSource = fs.readFileSync(preload, 'utf8');
    assert.ok(/require\((['"])electron\1\)/.test(preloadSource),
      'a sandboxed preload may only require electron: ' + preload);
    assert.strictEqual(preloadSource.indexOf('../../../'), -1,
      'a sandboxed preload reaches nothing project-local');
  });

  // The reference's own window titles.
  assert.strictEqual(
    windows.filter(function (w) { return w.id === SPAMMER_ID; })[0].title(), 'Packet spammer');
  assert.strictEqual(
    windows.filter(function (w) { return w.id === TAMPERER_ID; })[0].title(), 'Packet Tamperer');
});

test('the Packets menu carries the reference\'s own three tools, in the reference\'s order', async () => {
  const opened = [];
  const activated = await activateParity({
    openFeatureWindow: function (id) { opened.push(id); return {}; }
  });
  const state = activated.host._getState();
  const menus = [].concat.apply([], state.menus.map(function (contributor) {
    return contributor({ labels: {}, keybinds: {} });
  }));
  const packets = menus.filter(function (menu) { return menu.label === 'Packets'; })[0];
  assert.ok(packets, 'the reference groups its packet tools under Packets');
  // Root.cs adds Sniffer, Spammer, Tamperer in that order (Interceptor is hidden upstream and
  // stays unshipped here).
  assert.deepStrictEqual(packets.submenu.map(function (item) { return item.label; }),
    ['Sniffer', 'Spammer', 'Tamperer']);

  packets.submenu.forEach(function (item) { item.click(); });
  assert.deepStrictEqual(opened, [
    'grimlite-parity-packet-logger', SPAMMER_ID, TAMPERER_ID
  ]);

  // Every menu entry this plugin contributes still opens a window it registered, and nothing else.
  const registeredIds = state.featureWindows.map(function (w) { return w.id; });
  menus.forEach(function (menu) {
    if (!menu.submenu) return;
    menu.submenu.forEach(function (item) {
      opened.length = 0;
      item.click();
      opened.forEach(function (id) {
        assert.ok(registeredIds.indexOf(id) !== -1, item.label + ' opened an unregistered window: ' + id);
      });
    });
  });
});

// A page calling a bridge method its preload does not expose does nothing at all, silently.
test('each page draws the reference\'s controls and calls only what its preload exposes', () => {
  [
    { dir: 'packets', page: 'spammer.html', preload: 'preload_spammer.js', global: 'aquastarSpammer',
      ids: ['banner', 'packets', 'packet', 'remove', 'clear', 'add', 'load', 'save', 'delay', 'sendOnce', 'stop', 'start', 'status'] },
    { dir: 'packets', page: 'tamperer.html', preload: 'preload_tamperer.js', global: 'aquastarTamperer',
      ids: ['banner', 'send', 'receive', 'filter', 'filterLabel', 'fromClient', 'fromServer', 'toServer', 'toClient', 'clear', 'status'] },
    // The sniffer keeps its script beside the page (logger_renderer.js), so the page is markup and
    // its own script is checked where it lives.
    { dir: 'packets', page: 'logger.html', preload: 'preload_logger.js', global: 'aquastarPacketLogger',
      script: 'logger_renderer.js',
      ids: ['banner', 'frames', 'empty', 'toolbar', 'clear', 'copy', 'stop', 'start', 'filter', 'status',
        'spammerLabel', 'textToSend', 'numSpamDelay', 'ms', 'numSpamTimes', 'x', 'spam', 'sendOnce'] }
  ].forEach(function (spec) {
    const dir = path.join(pluginRoot, 'features', spec.dir);
    const html = fs.readFileSync(path.join(dir, spec.page), 'utf8');
    const preload = fs.readFileSync(path.join(dir, spec.preload), 'utf8');
    const scripts = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).map(
      function (block) {
        return block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      }
    );
    if (spec.script) {
      assert.ok(html.indexOf(spec.script) !== -1, spec.page + ' must load ' + spec.script);
      scripts.push(fs.readFileSync(path.join(dir, spec.script), 'utf8'));
    }
    const source = html + '\n' + scripts.join('\n');

    const bound = source.match(new RegExp('([A-Za-z0-9_]+)\\s*=\\s*window\\.' + spec.global));
    assert.ok(bound, spec.page + ' page never binds window.' + spec.global);
    const called = (source.match(new RegExp('\\b' + bound[1] + '\\.([A-Za-z0-9_]+)\\(', 'g')) || []).map(
      function (hit) { return hit.slice(bound[1].length + 1, -1); }
    );
    assert.ok(called.length > 0, spec.page + ' page never uses its bridge');
    const exposed = (preload.match(/^\s*([A-Za-z0-9_]+):\s*(?:function|\()/gm) || []).map(function (line) {
      return line.trim().split(':')[0];
    });
    called.forEach(function (name) {
      assert.ok(exposed.indexOf(name) !== -1,
        spec.preload + ' does not expose ' + name + ' (has ' + exposed.join(', ') + ')');
    });

    spec.ids.forEach(function (id) {
      assert.ok(html.indexOf('id="' + id + '"') !== -1, spec.page + ' has no #' + id);
    });
    assert.ok(html.indexOf('res/features/common/focus.css') !== -1,
      spec.page + ' needs the shared focus style');
    // A page whose script does not parse loads as a blank window.
    assert.ok(scripts.length > 0, spec.page + ' has no script');
    scripts.forEach(function (block) {
      assert.doesNotThrow(function () { new vm.Script(block); },
        spec.page + ' script does not parse');
    });
  });
});

test('the spammer window keeps and loads the reference\'s own list, and remembers its folder', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-spammer-')),
    file = path.join(appData, 'elsewhere.xml');
  fs.copyFileSync(path.join(__dirname, '../fixtures/grimlite-spammer/elsewhere.xml'), file);

  const asked = [];
  const store = createNamespacedStore({
    appDataDirectory: appData,
    pluginId: 'grimlite-parity'
  }).getStore('spammer');
  const window_ = require('../../plugins/grimlite-parity/features/packets/spammer-window.js')
    .createSpammerWindow({
      packets: { send: function () { return true; } },
      store: store,
      defaultDirectory: path.join(appData, 'Spammer'),
      messages: {},
      showOpenDialog: function (win, options) {
        asked.push(options);
        return Promise.resolve({ canceled: false, filePaths: [file] });
      },
      showSaveDialog: function (win, options) {
        asked.push(options);
        return Promise.resolve({ canceled: false, filePath: path.join(appData, 'saved') });
      }
    });

  const loaded = await window_.handle('spammerLoad', { sender: fakeWindow() }, []);
  assert.strictEqual(loaded.canceled, false);
  assert.strictEqual(loaded.error, null);
  assert.deepStrictEqual(loaded.packets, [
    '%xt%zm%aggroMon%1%2%3%', '%xt%zm%gar%1%2%w%', "<msg t='sys'>A & B</msg>"
  ], 'a list authored elsewhere loads whole');
  assert.strictEqual(loaded.delay, 750);
  assert.strictEqual(asked[0].title, 'Load spammer file', 'the reference\'s own dialog title');
  assert.deepStrictEqual(asked[0].filters, [{ name: 'XML files', extensions: ['xml'] }]);
  assert.strictEqual(asked[0].defaultPath, path.join(appData, 'Spammer'),
    'the first dialog starts in the default folder');

  const saved = await window_.handle('spammerSave', { sender: fakeWindow() },
    [{ packets: loaded.packets, delay: loaded.delay }]);
  assert.strictEqual(saved.canceled, false);
  assert.strictEqual(saved.path, path.join(appData, 'saved.xml'), 'a missing extension is added');
  // The dialog opens again where the last one left the user, which is what the store is for.
  const second = await window_.handle('spammerLoad', { sender: fakeWindow() }, []);
  assert.strictEqual(second.canceled, false);
  assert.strictEqual(asked[2].defaultPath, path.dirname(saved.path));

  // What was written reads back as the same list: the reference's own file shape, round-tripped.
  const written = fs.readFileSync(saved.path, 'utf8');
  const again = spammer.parseFile(written);
  assert.strictEqual(again.ok, true, again.error);
  assert.deepStrictEqual(again.packets, loaded.packets);
  assert.strictEqual(again.delay, 750);
});

test('a file the spammer cannot read is reported to the window, never loaded as an empty list', async () => {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'aquastar-spammer-bad-'));
  const file = path.join(appData, 'broken.xml');
  fs.writeFileSync(file, '<autoer><packet>unterminated');
  const window_ = require('../../plugins/grimlite-parity/features/packets/spammer-window.js')
    .createSpammerWindow({
      packets: { send: function () { return true; } },
      messages: {},
      showOpenDialog: function () { return Promise.resolve({ canceled: false, filePaths: [file] }); }
    });

  const result = await window_.handle('spammerLoad', { sender: fakeWindow() }, []);
  assert.strictEqual(result.canceled, false);
  assert.strictEqual(result.packets, undefined, 'an unreadable file is not a list');
  assert.ok(/XML/i.test(result.error), result.error);
});

test('the spammer window drives the loop through the send path, and reports what went out', async () => {
  const sent = [];
  const window_ = require('../../plugins/grimlite-parity/features/packets/spammer-window.js')
    .createSpammerWindow({
      packets: {
        send: function (frame) {
          sent.push(frame.direction + ' ' + frame.text);
          return sent.length !== 2;   // one frame the relay will not take, to see it reported
        }
      },
      messages: {},
      showOpenDialog: function () { return Promise.resolve({ canceled: true }); },
      showSaveDialog: function () { return Promise.resolve({ canceled: true }); }
    });

  const started = await window_.handle('spammerStart', { sender: fakeWindow() },
    [{ packets: ['a', 'b'], delay: 100 }]);
  assert.strictEqual(started.started, true);
  assert.strictEqual(started.running, true);
  // Three frames at the reference's own 100 ms floor: two waits, so the delay is exercised.
  await new Promise(function (resolve) { setTimeout(resolve, 260); });
  const stopped = await window_.handle('spammerStop', { sender: fakeWindow() }, []);
  assert.strictEqual(stopped.running, false);
  assert.ok(stopped.sent >= 2, 'the loop sent: ' + JSON.stringify(stopped));
  assert.strictEqual(stopped.failed, 1, 'the frame the relay would not take is counted, not hidden');
  assert.deepStrictEqual(sent.slice(0, 3), ['toServer a', 'toServer b', 'toServer a'],
    'the loop walks the list in order and wraps');

  // Send once writes exactly one frame, from the box, and never starts the loop.
  const once = await window_.handle('spammerSendOnce', { sender: fakeWindow() }, ['%xt%zm%once%']);
  assert.strictEqual(once.sent, true);
  assert.strictEqual(sent[sent.length - 1], 'toServer %xt%zm%once%');
});

// Through the plugin's own registration, which is what the page actually talks to: Start watches
// the window that pressed it, and the row going out is pushed to that window alone.
test('a Start from the page walks the list, tells that window which row is going out, and stops', async () => {
  const sent = [];
  const state = (await activateParity({
    getPacketSender: function () {
      return function (direction, text) { sent.push(direction + ' ' + text); return true; };
    }
  })).host._getState();
  const start = handlerFor(state, 'spammerStart');
  const stop = handlerFor(state, 'spammerStop');
  const window_ = fakeWindow();
  const other = fakeWindow();

  const started = await start({ sender: window_ }, { packets: ['a', 'b'], delay: 100 });
  assert.strictEqual(started.running, true);
  await new Promise(function (resolve) { setTimeout(resolve, 260); });
  await stop({ sender: window_ });

  assert.deepStrictEqual(sent.slice(0, 3), ['toServer a', 'toServer b', 'toServer a'],
    'the loop walks the list in order and wraps: ' + JSON.stringify(sent));
  const indexes = window_.sent.filter(function (item) {
    return item.channel === 'plugin:grimlite-parity:spammerIndex';
  }).map(function (item) { return item.payload.index; });
  assert.deepStrictEqual(indexes.slice(0, 3), [0, 1, 0],
    'IndexChanged tells the sending window which row is going out: ' + JSON.stringify(indexes));
  assert.strictEqual(other.sent.length, 0, 'a window that did not press Start is not written to');

  // A window that closes stops being written to, and the loop itself keeps the list it was given.
  window_.destroyed = true;
  await start({ sender: other }, { packets: ['c'], delay: 100 });
  await new Promise(function (resolve) { setTimeout(resolve, 120); });
  await stop({ sender: other });
  assert.ok(sent.indexOf('toServer c') !== -1);
  assert.strictEqual(window_.sent.filter(function (item) {
    return item.channel === 'plugin:grimlite-parity:spammerIndex';
  }).length, indexes.length, 'a destroyed window is not written to');
});

test('the tamperer window captures per switch and sends each side through the same path', async () => {
  const harness = tapHarness();
  const sent = [];
  const state = (await activateParity({
    getPacketTap: function () { return harness.tap; },
    getPacketSender: function () {
      return function (direction, text) {
        sent.push(direction + ' ' + text);
        return true;
      };
    }
  })).host._getState();
  const watch = handlerFor(state, 'tampererWatch');
  const unwatch = handlerFor(state, 'tampererUnwatch');
  const sendToServer = handlerFor(state, 'tampererSendToServer');
  const sendToClient = handlerFor(state, 'tampererSendToClient');
  const window_ = fakeWindow();

  // The Maid's party handlers hold one baseline subscription for the session; the tamperer adds
  // its own only when a switch is ticked.
  const base = harness.tap.subscriberCount();
  await watch({ sender: window_ }, { fromClient: true, fromServer: false });
  assert.strictEqual(harness.tap.subscriberCount(), base + 1, 'a ticked switch subscribes the tap');
  harness.emit('toServer', '%xt%zm%from-client%');
  harness.emit('toClient', "<msg t='sys'>from-server</msg>");
  assert.deepStrictEqual(window_.sent.map(function (item) { return item.payload.text; }),
    ['From client: %xt%zm%from-client%\n\n'],
    'the client switch shows client traffic and nothing else');

  window_.sent.length = 0;
  await watch({ sender: window_ }, { fromClient: false, fromServer: true });
  assert.strictEqual(harness.tap.subscriberCount(), base + 1, 'still one tamperer subscription for two switches');
  harness.emit('toServer', '%xt%zm%hidden-now%');
  harness.emit('toClient', "<msg t='sys'>shown-now</msg>");
  assert.deepStrictEqual(window_.sent.map(function (item) { return item.payload.text; }), [
    'From client: %xt%zm%from-client%\n\nFrom server: <msg t=\'sys\'>shown-now</msg>\n\n'
  ], 'the server switch shows server traffic; the captured client frame is kept, not lost');

  // Both switches off releases the tap: the window is not reading traffic any more.
  await unwatch({ sender: window_ }, {});
  assert.strictEqual(harness.tap.subscriberCount(), base, 'unticking both switches releases the tamperer tap');
  harness.emit('toServer', '%xt%zm%after%');
  assert.strictEqual(window_.sent.length, 1, 'nothing arrives after the switches go off');

  // The two send actions write their own side, through packets.send (packet-send).
  assert.deepStrictEqual(await sendToServer({ sender: window_ }, '%xt%zm%edited%'), { sent: true });
  assert.deepStrictEqual(await sendToClient({ sender: window_ }, "<msg t='sys'>edited</msg>"), { sent: true });
  assert.deepStrictEqual(sent, [
    'toServer %xt%zm%edited%',
    'toClient <msg t=\'sys\'>edited</msg>'
  ]);

  // A closed window takes itself out of the watchers; the capture state stays as the user left it.
  window_.destroyed = true;
  harness.emit('toServer', '%xt%zm%ignored%');
  assert.strictEqual(window_.sent.length, 1, 'a destroyed window is not written to');
});

// PacketTamperer.cs filters as frames arrive, before they are appended: the client side uses
// Contains (case-sensitive) and the server side OrdinalIgnoreCase. A frame that does not match is
// not kept at all, so widening the filter later shows nothing retroactively.
test('the tamperer filter is applied when a frame arrives, with the reference\'s own casing', async () => {
  const harness = tapHarness();
  const state = (await activateParity({
    getPacketTap: function () { return harness.tap; },
    getPacketSender: function () { return function () { return true; }; }
  })).host._getState();
  const watch = handlerFor(state, 'tampererWatch');
  const setFilter = handlerFor(state, 'tampererFilter');
  const window_ = fakeWindow();

  await watch({ sender: window_ }, { fromClient: true, fromServer: true });
  await setFilter({ sender: window_ }, 'MiXeD');
  harness.emit('toServer', '%xt%zm%mixed-case%');
  harness.emit('toClient', "<msg t='sys'>MIXED-case</msg>");
  assert.deepStrictEqual(window_.sent.map(function (item) { return item.payload.text; }), [
    'From server: <msg t=\'sys\'>MIXED-case</msg>\n\n'
  ], 'client traffic is case-sensitive, the server side is not: ' +
    JSON.stringify(window_.sent.map(function (item) { return item.payload.text; })));

  harness.emit('toServer', '%xt%zm%MiXeD-once%');
  assert.strictEqual(window_.sent[1].payload.text,
    'From server: <msg t=\'sys\'>MIXED-case</msg>\n\nFrom client: %xt%zm%MiXeD-once%\n\n',
    'a client frame matching the exact casing is appended after what was already kept');
});

// The reference form is hidden on close, so its loop keeps its Stop button. Here the page is
// destroyed: leaving the loop sending would be an invisible spammer with no way to stop it.
test('a closed spammer window stops its loop instead of sending invisibly', async () => {
  const sent = [];
  const state = (await activateParity({
    getPacketSender: function () {
      return function (direction, text) { sent.push(direction + ' ' + text); return true; };
    }
  })).host._getState();
  const start = handlerFor(state, 'spammerStart');
  const window_ = fakeWindow();

  const started = await start({ sender: window_ }, { packets: ['a'], delay: 100 });
  assert.strictEqual(started.running, true);
  await new Promise(function (resolve) { setTimeout(resolve, 120); });
  const before = sent.length;
  assert.ok(before > 0, 'the loop sent before the window closed');

  window_.destroyed = true;
  window_.handlers.destroyed();
  await new Promise(function (resolve) { setTimeout(resolve, 160); });
  assert.strictEqual(sent.length, before, 'a loop whose window is gone must stop sending');
});

// A closed tamperer window must not leave the tap subscribed: the reference unhooks its callbacks
// when a window goes away, and a subscription nobody reads is exactly what this port avoids.
test('closing the tamperer window releases the tap and clears its switches', async () => {
  const harness = tapHarness();
  const state = (await activateParity({
    getPacketTap: function () { return harness.tap; }
  })).host._getState();
  const watch = handlerFor(state, 'tampererWatch');
  const window_ = fakeWindow();
  const base = harness.tap.subscriberCount();

  await watch({ sender: window_ }, { fromClient: true, fromServer: true });
  assert.strictEqual(harness.tap.subscriberCount(), base + 1);
  assert.strictEqual(typeof window_.handlers.destroyed, 'function',
    'the window is watched for its own close');

  window_.destroyed = true;
  window_.handlers.destroyed();
  assert.strictEqual(harness.tap.subscriberCount(), base, 'closing the window releases the tamperer tap');

  // Reopening starts from the reference's own state: both switches clear, nothing hooked.
  const fresh = fakeWindow();
  const again = await watch({ sender: fresh }, { fromClient: false, fromServer: false });
  assert.strictEqual(again.fromClient, false);
  assert.strictEqual(again.fromServer, false);
  assert.strictEqual(again.reading, false);
  assert.strictEqual(harness.tap.subscriberCount(), base, 'unticked switches subscribe nothing');
  harness.emit('toServer', '%xt%zm%nothing%');
  assert.strictEqual(fresh.sent.length, 0);
});

// The two permissions are separate on purpose, and each tool gets exactly the surface it holds.
test('a plugin holding send but not tap, or tap but not send, gets its own surface', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  ['packet-tap', 'packet-send'].forEach(function (permission) {
    assert.ok(manifest.permissions.indexOf(permission) !== -1,
      'the plugin declares both, because it ships tools on both sides: ' + permission);
  });

  // The spammer is the write-only tool: its window half never subscribes to the tap.
  const spammerSource = ['spammer.js', 'spammer-window.js'].map(function (file) {
    return fs.readFileSync(path.join(featureDir, file), 'utf8');
  }).join('\n');
  assert.strictEqual(/packets\.on\(/.test(spammerSource), false,
    'the spammer sends and never reads: it must not need packet-tap');
  assert.ok(/packets\.send\(/.test(spammerSource), 'the spammer sends through packets.send');

  // The tamperer needs both, and says so rather than drawing a dead window: without the tap its
  // watch call throws the Host's own refusal, which the page reports.
  const tampererSource = ['tamperer.js', 'tamperer-window.js'].map(function (file) {
    return fs.readFileSync(path.join(featureDir, file), 'utf8');
  }).join('\n');
  assert.ok(/packets\.on\(/.test(tampererSource) && /packets\.send\(/.test(tampererSource),
    'the tamperer reads and writes');

  const noTap = platform.createPluginHost({
    manifest: Object.assign({}, manifest, { permissions: manifest.permissions.filter(function (p) {
      return p !== 'packet-tap';
    }) }),
    pluginRoot: pluginRoot,
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    log: function () {},
    deps: { getPacketSender: function () { return function () { return true; }; } }
  });
  assert.strictEqual(noTap.packets.send({ direction: 'toServer', text: '%xt%zm%x%' }), true,
    'send without tap is allowed: that is the spammer\'s own surface');
  assert.throws(function () { noTap.packets.on('frame', function () {}); },
    /without permission "packet-tap"/);

  const noSend = platform.createPluginHost({
    manifest: Object.assign({}, manifest, { permissions: manifest.permissions.filter(function (p) {
      return p !== 'packet-send';
    }) }),
    pluginRoot: pluginRoot,
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    log: function () {},
    deps: { getPacketTap: function () { return platform.createPacketTap(); } }
  });
  assert.strictEqual(typeof noSend.packets.on('frame', function () {}), 'function',
    'tap without send is allowed: that is the logger\'s own surface');
  assert.throws(function () { noSend.packets.send({ direction: 'toServer', text: '%xt%zm%x%' }); },
    /without permission "packet-send"/);
});

test('the packet windows need no permission the manifest does not declare', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  assert.strictEqual(manifest.permissions.indexOf('unsafe-renderer'), -1,
    'these windows need no unsafe renderer: they load no Flash');
  const activated = await activateParity();
  const state = activated.host._getState();
  [SPAMMER_ID, TAMPERER_ID].forEach(function (id) {
    assert.strictEqual(state.featureWindows.filter(function (w) { return w.id === id; }).length, 1,
      'activating registers ' + id + '; a missing permission would have thrown first');
  });
});

// The pages' own wiring, driven against a deliberately small DOM stand-in (the same shape the
// Bank/Sets page tests use) with the preload bridge replaced by a recorder. What this catches is
// the pages' own plumbing - ids, the bridge calls and their arguments, the buttons' states - not
// the app's rendering; that stays on docs/FLASH_CHECKLIST.md.
const LOGGER_PAGE_IDS = ['banner', 'frames', 'empty', 'status', 'filter', 'start', 'stop', 'copy',
  'clear', 'spam', 'sendOnce', 'textToSend', 'numSpamDelay', 'numSpamTimes'];
const SPAMMER_PAGE_IDS = ['banner', 'packets', 'packet', 'delay', 'remove', 'clear', 'add', 'load',
  'save', 'sendOnce', 'stop', 'start', 'status'];
const TAMPERER_PAGE_IDS = ['banner', 'send', 'receive', 'filter', 'filterLabel', 'fromClient',
  'fromClientLabel', 'fromServer', 'fromServerLabel', 'toServer', 'toClient', 'clear', 'status'];

function pageElement() {
  const el = {
    children: [],
    listeners: {},
    _text: '',
    className: '',
    disabled: false,
    checked: false,
    value: '',
    scrollTop: 0,
    appendChild: function (child) { el.children.push(child); return child; },
    append: function () {
      Array.prototype.slice.call(arguments).forEach(function (child) { el.children.push(child); });
    },
    addEventListener: function (type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    },
    classList: {
      classes: {},
      toggle: function (name, on) { el.classList.classes[name] = on; },
      remove: function (name) { delete el.classList.classes[name]; }
    }
  };
  // The pages clear a list by assigning an empty text; a real element drops its children then.
  Object.defineProperty(el, 'textContent', {
    get: function () { return el._text; },
    set: function (value) {
      el._text = value;
      if (value === '') el.children = [];
    }
  });
  return el;
}

function click(el) {
  (el.listeners.click || []).forEach(function (fn) { fn({}); });
}

// The pages run in their own vm realm, so an object they pass out has that realm's prototypes and
// deepStrictEqual would compare prototypes rather than shapes.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function pageSettled() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

// Wait (bounded) for something the page reaches asynchronously.
async function until(condition, tries) {
  for (let i = 0; i < (tries || 50); i++) {
    if (condition()) return true;
    await pageSettled();
  }
  return condition();
}

// Load one of the three packet pages and run its own script(s): the inline one where the page has
// it, and the renderer file where the page keeps it beside the markup.
function loadPacketPage(page, ids, globals, renderer) {
  const file = path.join(featureDir, page);
  const byId = {};
  ids.forEach(function (id) { byId[id] = pageElement(); });
  const document = {
    title: '',
    getElementById: function (id) {
      assert.ok(byId[id], file + ' asks for a #' + id + ' that does not exist');
      return byId[id];
    },
    createElement: function () { return pageElement(); }
  };
  const html = fs.readFileSync(file, 'utf8');
  const scripts = (html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || []).map(
    function (block) {
      return block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    }
  );
  if (renderer) scripts.push(fs.readFileSync(path.join(featureDir, renderer), 'utf8'));
  const realm = {
    window: globals,
    document: document,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout
  };
  scripts.forEach(function (source) { vm.runInNewContext(source, realm); });
  return { byId: byId, document: document };
}

function loggerBridge(overrides) {
  return Object.assign({
    onFrame: function () {},
    steering: function () { return Promise.resolve({ steering: true, notice: '' }); },
    start: function () { return Promise.resolve({ watching: true }); },
    stop: function () { return Promise.resolve({ watching: false }); },
    copy: function () {},
    send: function () { return Promise.resolve({ sent: true }); },
    spamStart: function () { return Promise.resolve({ running: true }); },
    spamStop: function () { return Promise.resolve({ running: false }); }
  }, overrides || {});
}

test('the sniffer\'s own Spammer block sends N frames, or runs until Stop at 0', async () => {
  const calls = [];
  const page = loadPacketPage('logger.html', LOGGER_PAGE_IDS, {
    aquastarPacketLogger: loggerBridge({
      send: function (text) { calls.push(['send', text]); return Promise.resolve({ sent: true }); },
      spamStart: function (config) {
        calls.push(['spamStart', plain(config)]);
        return Promise.resolve({ running: true });
      },
      spamStop: function () { calls.push(['spamStop']); return Promise.resolve({ running: false }); }
    }),
    AquaStarPacketFrames: framesApi
  }, 'logger_renderer.js');
  await pageSettled();

  page.byId.textToSend.value = '%xt%zm%gar%1%2%w%';
  page.byId.numSpamDelay.value = '0';
  page.byId.numSpamTimes.value = '3';
  page.byId.spam.textContent = 'Spam';
  click(page.byId.spam);
  assert.strictEqual(page.byId.spam.textContent, 'Stop', 'Spam becomes Stop while it runs');
  assert.strictEqual(page.byId.sendOnce.disabled, true, 'Send Once is dead while the block spams');
  await until(function () { return page.byId.spam.textContent === 'Spam'; });
  assert.deepStrictEqual(plain(calls.filter(function (call) { return call[0] === 'send'; })), [
    ['send', '%xt%zm%gar%1%2%w%'],
    ['send', '%xt%zm%gar%1%2%w%'],
    ['send', '%xt%zm%gar%1%2%w%']
  ], 'N times is exactly N frames, each from the box: ' + JSON.stringify(plain(calls)));
  assert.strictEqual(calls.filter(function (call) { return call[0] === 'spamStart'; }).length, 0,
    'a counted run is the page\'s own, never the continuous loop\'s');
  assert.strictEqual(page.byId.sendOnce.disabled, false, 'and Send Once is live again after it');

  // 0 times is the reference's continuous case: the one-packet list goes to the Spammer tool.
  page.byId.numSpamTimes.value = '0';
  page.byId.numSpamDelay.value = '1000';
  const before = calls.length;
  click(page.byId.spam);
  await pageSettled();
  assert.deepStrictEqual(plain(calls.slice(before)),
    [['spamStart', { text: '%xt%zm%gar%1%2%w%', delay: 1000 }]],
    'the box and the delay go to the loop, and the page sends nothing itself');
  assert.strictEqual(page.byId.spam.textContent, 'Stop');
  assert.strictEqual(page.byId.sendOnce.disabled, true);

  click(page.byId.spam);   // Stop
  await pageSettled();
  assert.strictEqual(page.byId.spam.textContent, 'Spam');
  assert.deepStrictEqual(plain(calls.slice(-1)), [['spamStop']],
    'Stop is told to the loop, which owns the pacing');
  assert.strictEqual(page.byId.sendOnce.disabled, false);

  // An empty box starts nothing at all (`if (textToSend.TextLength < 1) return;`).
  page.byId.textToSend.value = '';
  const quiet = calls.length;
  click(page.byId.spam);
  await pageSettled();
  assert.strictEqual(calls.length, quiet);
  assert.strictEqual(page.byId.spam.textContent, 'Spam');
});

test('the sniffer\'s Send Once sends one frame and is dead while it is on its way', async () => {
  const sent = [];
  let release = null;
  const page = loadPacketPage('logger.html', LOGGER_PAGE_IDS, {
    aquastarPacketLogger: loggerBridge({
      send: function (text) {
        sent.push(text);
        return new Promise(function (resolve) { release = resolve; });
      }
    }),
    AquaStarPacketFrames: framesApi
  }, 'logger_renderer.js');
  await pageSettled();

  page.byId.textToSend.value = '%xt%zm%once%';
  click(page.byId.sendOnce);
  assert.deepStrictEqual(sent, ['%xt%zm%once%']);
  assert.strictEqual(page.byId.sendOnce.disabled, true,
    'the button is dead while the frame is on its way');
  click(page.byId.sendOnce);   // a second press while it waits sends nothing more
  assert.deepStrictEqual(sent, ['%xt%zm%once%']);

  release({ sent: true });
  await pageSettled();
  assert.strictEqual(page.byId.sendOnce.disabled, false);
  assert.deepStrictEqual(sent, ['%xt%zm%once%'], 'send once writes exactly one frame');

  // And an empty box sends nothing (`if (textToSend.TextLength > 0)`).
  page.byId.textToSend.value = '';
  click(page.byId.sendOnce);
  await pageSettled();
  assert.deepStrictEqual(sent, ['%xt%zm%once%']);
});

test('the sniffer\'s Copy hands over raw frames, and only Start goes dead', async () => {
  const copied = [];
  let frameListener = null;
  const page = loadPacketPage('logger.html', LOGGER_PAGE_IDS, {
    aquastarPacketLogger: loggerBridge({
      onFrame: function (listener) { frameListener = listener; },
      copy: function (text) { copied.push(text); }
    }),
    AquaStarPacketFrames: framesApi
  }, 'logger_renderer.js');
  await pageSettled();

  assert.strictEqual(page.byId.start.disabled, false);
  assert.strictEqual(page.byId.stop.disabled, false, 'Stop is live before Start too');
  assert.strictEqual(page.byId.copy.disabled, false);
  assert.strictEqual(page.byId.clear.disabled, false);

  // Copy and Clear with nothing there do nothing (btnCopy_Click's own length test).
  click(page.byId.copy);
  click(page.byId.clear);
  await pageSettled();
  assert.deepStrictEqual(copied, [], 'copying an empty box puts nothing on the clipboard');

  click(page.byId.start);
  await pageSettled();
  assert.strictEqual(page.byId.start.disabled, true, 'Start goes dead while watching');
  assert.strictEqual(page.byId.stop.disabled, false);
  assert.strictEqual(page.byId.copy.disabled, false, 'Copy stays live with nothing captured');

  frameListener({ direction: 'toServer', text: '%xt%zm%gar%1%2%w%' });
  frameListener({ direction: 'toClient', text: "<msg t='sys'>hi</msg>" });
  click(page.byId.copy);
  assert.deepStrictEqual(copied, ['%xt%zm%gar%1%2%w%\n<msg t=\'sys\'>hi</msg>'],
    'the clipboard is the frames as they arrived, one per line, with no direction prefix');

  click(page.byId.stop);
  await pageSettled();
  assert.strictEqual(page.byId.start.disabled, false);
  assert.strictEqual(page.byId.stop.disabled, false, 'Stop is live even with nothing to stop');
  click(page.byId.clear);   // and Clear empties what was captured
  assert.strictEqual(page.byId.frames.children.length, 0);
});

// packets.send throws when the session is not steering at all (the banner's own case). A window
// turns that into the same answer as a relay with nobody connected - not written - so a button
// never sticks and the page can report it.
test('a refused relay is reported as not written by all three windows, never thrown at a page', async () => {
  const refusal = function () {
    throw new Error('this app session is not steering game traffic');
  };

  const state = (await activateParity({
    getPacketSender: function () { return refusal; }
  })).host._getState();
  assert.deepStrictEqual(await handlerFor(state, 'packetsSend')({}, '%xt%zm%once%'), { sent: false },
    'the sniffer answers, and the frame was not written');

  const spammerWindow = require('../../plugins/grimlite-parity/features/packets/spammer-window.js')
    .createSpammerWindow({
      packets: { send: refusal },
      messages: {},
      showOpenDialog: function () { return Promise.resolve({ canceled: true }); },
      showSaveDialog: function () { return Promise.resolve({ canceled: true }); }
    });
  assert.deepStrictEqual(
    await spammerWindow.handle('spammerSendOnce', { sender: fakeWindow() }, ['%xt%zm%once%']),
    { sent: false, failed: 1 }, 'the spammer answers: not sent, and counts it');
  await spammerWindow.handle('spammerStart', { sender: fakeWindow() }, [{ packets: ['a'], delay: 100 }]);
  await new Promise(function (resolve) { setTimeout(resolve, 120); });
  const stopped = await spammerWindow.handle('spammerStop', { sender: fakeWindow() }, []);
  assert.ok(stopped.failed >= 2,
    'the loop counted every refused frame and kept going: ' + JSON.stringify(stopped));

  const tampererWindow = require('../../plugins/grimlite-parity/features/packets/tamperer-window.js')
    .createTampererWindow({
      packets: { send: refusal },
      channel: 'plugin:grimlite-parity:tampererCapture',
      messages: {}
    });
  assert.deepStrictEqual(
    await tampererWindow.handle('tampererSendToServer', { sender: fakeWindow() }, ['%xt%zm%once%']),
    { sent: false }, 'the tamperer answers: not written');
});

// The 0-times case is the reference's Spammer tool, which in this port is the logger's own loop in
// the main process: one frame at a time, through packet-send, until Stop or the window's close.
test('the sniffer\'s 0-times Spammer runs until Stop, through the send path', async () => {
  const sent = [];
  const sender = function (direction, text) {
    sent.push(direction + ' ' + text);
    return true;
  };
  const activate = function () {
    return activateParity({ getPacketSender: function () { return sender; } })
      .then(function (activated) { return activated.host._getState(); });
  };
  let state = await activate();
  let start = handlerFor(state, 'packetsSpamStart');
  let stop = handlerFor(state, 'packetsSpamStop');
  const window_ = fakeWindow();

  const started = await start({ sender: window_ }, { text: '%xt%zm%gar%1%2%w%', delay: 100 });
  assert.strictEqual(started.running, true);
  await new Promise(function (resolve) { setTimeout(resolve, 120); });
  await stop({ sender: window_ });
  assert.ok(sent.length >= 1, 'the loop wrote: ' + JSON.stringify(sent));
  assert.ok(sent.every(function (line) { return line === 'toServer %xt%zm%gar%1%2%w%'; }),
    'every frame is the same one-packet list, to the server: ' + JSON.stringify(sent));

  // The window that started it is watched: closing it ends the loop rather than sending invisibly.
  state = await activate();
  start = handlerFor(state, 'packetsSpamStart');
  stop = handlerFor(state, 'packetsSpamStop');
  await start({ sender: window_ }, { text: '%xt%zm%once-more%', delay: 100 });
  await new Promise(function (resolve) { setTimeout(resolve, 120); });
  const before = sent.length;
  window_.destroyed = true;
  window_.handlers.destroyed();
  await new Promise(function (resolve) { setTimeout(resolve, 160); });
  assert.strictEqual(sent.length, before, 'a loop whose window closed stops sending');

  // An empty box starts nothing (the page's own guard holds in the window half too).
  const none = await start({ sender: fakeWindow() }, { text: '', delay: 100 });
  assert.strictEqual(none.running, false);
  await stop({ sender: fakeWindow() });
});

test('the spammer page clears its list before the Load dialog and holds Send once while it waits', async () => {
  let releaseLoad = null;
  let releaseSend = null;
  const page = loadPacketPage('spammer.html', SPAMMER_PAGE_IDS, {
    aquastarSpammer: {
      getMessages: function () { return Promise.resolve({}); },
      onIndex: function () {},
      steering: function () { return Promise.resolve({ notice: '' }); },
      load: function () { return new Promise(function (resolve) { releaseLoad = resolve; }); },
      save: function () { return Promise.resolve({ canceled: true }); },
      start: function () { return Promise.resolve({ running: true }); },
      stop: function () { return Promise.resolve({ running: false, sent: 0, failed: 0 }); },
      sendOnce: function () { return new Promise(function (resolve) { releaseSend = resolve; }); }
    }
  });
  await pageSettled();

  page.byId.packet.value = '%xt%zm%a%';
  click(page.byId.add);
  assert.strictEqual(page.byId.packets.children.length, 1, 'the box added its packet to the list');

  click(page.byId.load);
  // btnLoad_Click: `lstPackets.Items.Clear();` runs before LoadConfig opens its dialog.
  assert.strictEqual(page.byId.packets.children.length, 0, 'the list is cleared before the dialog');
  releaseLoad({ canceled: true });
  await pageSettled();
  assert.strictEqual(page.byId.packets.children.length, 0, 'a cancelled dialog leaves it empty');

  // btnSend_Click: the button is dead while its frame is on its way, and a second press waits.
  page.byId.packet.value = '%xt%zm%once%';
  click(page.byId.sendOnce);
  assert.strictEqual(page.byId.sendOnce.disabled, true);
  click(page.byId.sendOnce);
  releaseSend({ sent: true });
  await pageSettled();
  assert.strictEqual(page.byId.sendOnce.disabled, false);
});

test('the tamperer page disables only the button that is sending, and Clear is always live', async () => {
  const calls = [];
  let release = null;
  const page = loadPacketPage('tamperer.html', TAMPERER_PAGE_IDS, {
    aquastarTamperer: {
      getMessages: function () {
        return Promise.resolve({
          title: 'Packet Tamperer', captureFromClient: 'Capture from client',
          captureFromServer: 'Capture from server', filterByText: 'Filter by text',
          sendToServer: 'Send to server', sendToClient: 'Send to client', clear: 'Clear'
        });
      },
      onCapture: function () {},
      steering: function () { return Promise.resolve({ notice: '' }); },
      watch: function () { return Promise.resolve({ reading: true }); },
      unwatch: function () { return Promise.resolve({ reading: false }); },
      setFilter: function () {},
      clear: function () { calls.push(['clear']); return Promise.resolve({ text: '' }); },
      sendToServer: function (text) {
        calls.push(['toServer', text]);
        return new Promise(function (resolve) { release = resolve; });
      },
      sendToClient: function (text) {
        calls.push(['toClient', text]);
        return Promise.resolve({ sent: true });
      }
    }
  });
  await pageSettled();

  // An empty box sends nothing at all, on either side (`if (!string.IsNullOrEmpty(txtSend.Text))`).
  click(page.byId.toServer);
  click(page.byId.toClient);
  await pageSettled();
  assert.deepStrictEqual(calls, [], 'an empty box sends nothing');
  assert.strictEqual(page.byId.clear.disabled, false, 'Clear is live with nothing captured');

  page.byId.send.value = '%xt%zm%edited%';
  click(page.byId.toServer);
  assert.strictEqual(page.byId.toServer.disabled, true, 'the button that is sending is dead');
  assert.strictEqual(page.byId.toClient.disabled, false, 'the other side stays live');
  release({ sent: true });
  await pageSettled();
  assert.strictEqual(page.byId.toServer.disabled, false);
  assert.deepStrictEqual(plain(calls), [['toServer', '%xt%zm%edited%']]);

  // btnClear_Click has no guard: clearing an empty box is nothing, and it stays live.
  page.byId.receive.value = '';
  click(page.byId.clear);
  await pageSettled();
  assert.deepStrictEqual(plain(calls.slice(-1)), [['clear']]);
  assert.strictEqual(page.byId.clear.disabled, false);
});

// Steering is the player's opt-in (`packetSteering`, off by default): with it off the relay is not
// there, so each of the three windows says so - naming the setting and the restart - instead of
// looking broken. None of them turns it on.
test('each packet window says when packet steering is off, and none of them turns it on', async () => {
  const settingsHost = function (settings) {
    return { getPlatformSettings: function () { return settings; } };
  };
  assert.strictEqual(steeringNotice.steeringEnabled(settingsHost({})), false,
    'a settings map without the key is the setting\'s own default');
  assert.strictEqual(steeringNotice.steeringEnabled(settingsHost({ packetSteering: true })), true);
  assert.strictEqual(steeringNotice.notice(settingsHost({ packetSteering: true })), '',
    'there is nothing to say while the relay is up');
  const notice = steeringNotice.notice(settingsHost({ packetSteering: false }));
  assert.notStrictEqual(notice.indexOf(SETTING_NAME), -1,
    'the banner names the setting exactly: ' + notice);
  assert.ok(/\brestart\b/i.test(notice), 'and says a restart applies it: ' + notice);

  // Each window's own channel carries the notice, from the plugin's own registration.
  const state = (await activateParity()).host._getState();
  const channels = ['packetsSteering', 'spammerSteering', 'tampererSteering'];
  for (let i = 0; i < channels.length; i++) {
    const answer = await handlerFor(state, channels[i])({});
    assert.ok(answer.notice && answer.notice.indexOf(SETTING_NAME) !== -1,
      channels[i] + ' must carry the notice: ' + JSON.stringify(answer));
  }

  // Each page has somewhere to put it and asks for it, and the three window halves read the
  // setting only through steering-notice.js: nothing here writes it.
  [
    { page: 'logger.html', script: 'logger_renderer.js' },
    { page: 'spammer.html' },
    { page: 'tamperer.html' }
  ].forEach(function (spec) {
    const html = fs.readFileSync(path.join(featureDir, spec.page), 'utf8');
    const source = html + (spec.script
      ? fs.readFileSync(path.join(featureDir, spec.script), 'utf8') : '');
    assert.ok(html.indexOf('id="banner"') !== -1, spec.page + ' needs a banner for the notice');
    assert.ok(/\.steering\s*\(/.test(source), spec.page + ' must ask for the notice');
  });
  ['logger.js', 'spammer-window.js', 'tamperer-window.js'].forEach(function (file) {
    const source = fs.readFileSync(path.join(featureDir, file), 'utf8');
    assert.strictEqual(/packetSteering/.test(source), false,
      file + ' reads the setting only through steering-notice.js');
  });

  // One page end to end: the notice reaches the banner it drew for it.
  const page = loadPacketPage('logger.html', LOGGER_PAGE_IDS, {
    aquastarPacketLogger: loggerBridge({
      steering: function () { return Promise.resolve({ steering: false, notice: notice }); }
    }),
    AquaStarPacketFrames: framesApi
  }, 'logger_renderer.js');
  await pageSettled();
  assert.strictEqual(page.byId.banner.textContent, notice, 'the page puts the notice in its banner');
});
