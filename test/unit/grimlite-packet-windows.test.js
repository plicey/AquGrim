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

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const featureDir = path.join(pluginRoot, 'features/packets');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const SPAMMER_ID = 'grimlite-parity-packet-spammer';
const TAMPERER_ID = 'grimlite-parity-packet-tamperer';

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
      ids: ['packets', 'packet', 'remove', 'clear', 'add', 'load', 'save', 'delay', 'sendOnce', 'stop', 'start', 'status'] },
    { dir: 'packets', page: 'tamperer.html', preload: 'preload_tamperer.js', global: 'aquastarTamperer',
      ids: ['send', 'receive', 'filter', 'filterLabel', 'fromClient', 'fromServer', 'toServer', 'toClient', 'clear'] }
  ].forEach(function (spec) {
    const dir = path.join(pluginRoot, 'features', spec.dir);
    const html = fs.readFileSync(path.join(dir, spec.page), 'utf8');
    const preload = fs.readFileSync(path.join(dir, spec.preload), 'utf8');

    const bound = html.match(new RegExp('([A-Za-z0-9_]+)\\s*=\\s*window\\.' + spec.global));
    assert.ok(bound, spec.page + ' page never binds window.' + spec.global);
    const called = (html.match(new RegExp('\\b' + bound[1] + '\\.([A-Za-z0-9_]+)\\(', 'g')) || []).map(
      function (hit) { return hit.slice(bound[1].length + 1, -1); }
    );
    assert.ok(called.length > 0, spec.page + ' page never uses its bridge');
    const exposed = (preload.match(/^\s*([A-Za-z0-9_]+): function/gm) || []).map(function (line) {
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
    // A page whose inline script does not parse loads as a blank window.
    const blocks = html.match(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g) || [];
    assert.ok(blocks.length > 0, spec.page + ' has no inline script');
    blocks.forEach(function (block) {
      const source = block.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      assert.doesNotThrow(function () { new vm.Script(source); },
        spec.page + ' inline script does not parse');
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

  // Unticked: the tap is not subscribed at all, so nothing is read for a window that is not
  // capturing.
  assert.strictEqual(harness.tap.subscriberCount(), 0);
  await watch({ sender: window_ }, { fromClient: true, fromServer: false });
  assert.strictEqual(harness.tap.subscriberCount(), 1, 'a ticked switch subscribes the tap');
  harness.emit('toServer', '%xt%zm%from-client%');
  harness.emit('toClient', "<msg t='sys'>from-server</msg>");
  assert.deepStrictEqual(window_.sent.map(function (item) { return item.payload.text; }),
    ['From client: %xt%zm%from-client%\n\n'],
    'the client switch shows client traffic and nothing else');

  window_.sent.length = 0;
  await watch({ sender: window_ }, { fromClient: false, fromServer: true });
  assert.strictEqual(harness.tap.subscriberCount(), 1, 'still one subscription for two switches');
  harness.emit('toServer', '%xt%zm%hidden-now%');
  harness.emit('toClient', "<msg t='sys'>shown-now</msg>");
  assert.deepStrictEqual(window_.sent.map(function (item) { return item.payload.text; }), [
    'From client: %xt%zm%from-client%\n\nFrom server: <msg t=\'sys\'>shown-now</msg>\n\n'
  ], 'the server switch shows server traffic; the captured client frame is kept, not lost');

  // Both switches off releases the tap: the window is not reading traffic any more.
  await unwatch({ sender: window_ }, {});
  assert.strictEqual(harness.tap.subscriberCount(), 0, 'unticking both switches releases the tap');
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

// A closed tamperer window must not leave the tap subscribed: the reference unhooks its callbacks
// when a window goes away, and a subscription nobody reads is exactly what this port avoids.
test('closing the tamperer window releases the tap and clears its switches', async () => {
  const harness = tapHarness();
  const state = (await activateParity({
    getPacketTap: function () { return harness.tap; }
  })).host._getState();
  const watch = handlerFor(state, 'tampererWatch');
  const window_ = fakeWindow();

  await watch({ sender: window_ }, { fromClient: true, fromServer: true });
  assert.strictEqual(harness.tap.subscriberCount(), 1);
  assert.strictEqual(typeof window_.handlers.destroyed, 'function',
    'the window is watched for its own close');

  window_.destroyed = true;
  window_.handlers.destroyed();
  assert.strictEqual(harness.tap.subscriberCount(), 0, 'closing the window releases the tap');

  // Reopening starts from the reference's own state: both switches clear, nothing hooked.
  const fresh = fakeWindow();
  const again = await watch({ sender: fresh }, { fromClient: false, fromServer: false });
  assert.strictEqual(again.fromClient, false);
  assert.strictEqual(again.fromServer, false);
  assert.strictEqual(again.reading, false);
  assert.strictEqual(harness.tap.subscriberCount(), 0, 'unticked switches subscribe nothing');
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
