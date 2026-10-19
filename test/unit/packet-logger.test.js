// The packet logger (spec #19 / ticket #26): the first user-facing packet tool, and the plugin
// half of the tap. Start and stop control the subscription, and the window is a view over frames
// the platform already owns - so a second window, or a second start, cannot double a frame.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const platform = require('../../res/platform');
const feed = require('../../plugins/grimlite-parity/features/packets/frames.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const FRAME_CHANNEL = 'plugin:grimlite-parity:packetFrame';

// A stand-in for the platform's tap (res/platform/packet-tap.js). It counts subscriptions, which
// is the whole point of the ticket: the feed reaches it through host.packets.on, the plugin's own
// tests through it directly, and both must land on one subscription.
function standInTap() {
  const listeners = [];
  const tap = {
    subscribes: 0,
    releases: 0,
    listeners: listeners,
    subscribe: function (listener) {
      this.subscribes++;
      listeners.push(listener);
      const self = this;
      return function off() {
        self.releases++;
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
    on: function (event, listener) {
      assert.strictEqual(event, 'frame', 'the tap carries one event, frame');
      return tap.subscribe(listener);
    },
    emit: function (frame) { listeners.slice().forEach(function (l) { l(frame); }); }
  };
  return tap;
}

function sink(name) {
  return {
    name: name,
    sent: [],
    send: function (channel, payload) { this.sent.push({ channel: channel, payload: payload }); }
  };
}

test('the logger feed subscribes once and releases when the last window stops', () => {
  const tap = standInTap();
  const delivered = [];
  const first = sink('first');
  const second = sink('second');
  const loggerFeed = feed.createFrameFeed({
    packets: tap,
    deliver: function (target, frame) { delivered.push(target.name + ' ' + frame.direction); }
  });

  assert.strictEqual(loggerFeed.started(), false, 'nothing subscribes before Start');
  loggerFeed.start(first);
  assert.strictEqual(tap.subscribes, 1);
  assert.strictEqual(loggerFeed.started(), true);

  // A second start, from the same window or another one, is not a second listener.
  loggerFeed.start(first);
  loggerFeed.start(second);
  assert.strictEqual(tap.subscribes, 1, 'one subscription for every window that watches');
  assert.strictEqual(loggerFeed.watching(first) && loggerFeed.watching(second), true,
    'both windows are watching');

  tap.emit({ id: 1, direction: 'toServer', data: Buffer.from('%xt%zm%moveToCell%') });
  assert.deepStrictEqual(delivered, ['first toServer', 'second toServer'],
    'each watching window gets the frame exactly once');

  loggerFeed.stop(first);
  assert.strictEqual(tap.releases, 0, 'stopping one window does not unsubscribe the other');
  loggerFeed.stop(second);
  assert.strictEqual(tap.releases, 1, 'Stop releases the subscription');
  assert.strictEqual(loggerFeed.started(), false);

  tap.emit({ id: 1, direction: 'toClient', data: Buffer.from('ignored') });
  assert.strictEqual(delivered.length, 2, 'a released feed delivers nothing');

  loggerFeed.stop(second);
  assert.strictEqual(tap.releases, 1, 'stopping again is harmless');
});

test('a frame reaches the logger as direction and text, with nothing added or dropped', () => {
  const tap = standInTap();
  const loggerFeed = feed.createFrameFeed({
    packets: tap,
    deliver: function (target, frame) { target.send(FRAME_CHANNEL, frame); }
  });
  const window_ = sink('window');
  loggerFeed.start(window_);

  tap.emit({ id: 7, direction: 'toClient', data: Buffer.from("<msg t='sys'><body action='apiOK'/></msg>") });
  tap.emit({ id: 7, direction: 'toServer', data: Buffer.from('%xt%zm%gar%1%2%w') });

  assert.deepStrictEqual(window_.sent, [
    { channel: FRAME_CHANNEL, payload: { direction: 'toClient', text: "<msg t='sys'><body action='apiOK'/></msg>" } },
    { channel: FRAME_CHANNEL, payload: { direction: 'toServer', text: '%xt%zm%gar%1%2%w' } }
  ], 'the window sees both directions, in order, text intact: ' + JSON.stringify(window_.sent));
});

async function activatedPlugin(deps) {
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
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: Object.assign({ openFeatureWindow: function () { return {}; } }, deps || {})
  });
}

function handlerFor(state, name) {
  const handler = state.ipcHandlers.filter(function (item) {
    return item.channel === 'plugin:grimlite-parity:' + name;
  })[0];
  assert.ok(handler, 'the plugin must register the ' + name + ' handler');
  return handler.listener;
}

// A stand-in for the frame's sender: an Electron WebContents, of which the plugin uses send(),
// isDestroyed() and once('destroyed').
function fakeWindow() {
  return {
    sent: [],
    handlers: {},
    destroyed: false,
    on: function (name, handler) { this.handlers[name] = handler; },
    once: function (name, handler) { this.handlers[name] = handler; },
    isDestroyed: function () { return this.destroyed; },
    send: function (channel, payload) { this.sent.push({ channel: channel, payload: payload }); },
    getURL: function () { return 'file:///logger.html'; }
  };
}

test('the plugin contributes the packet logger window under the reference\'s own menu entry', async () => {
  const tap = standInTap();
  const opened = [];
  const activated = await activatedPlugin({
    getPacketTap: function () { return tap; },
    openFeatureWindow: function (id) { opened.push(id); return {}; }
  });
  const state = activated.host._getState();

  const logger = state.featureWindows.filter(function (w) {
    return w.id === 'grimlite-parity-packet-logger';
  })[0];
  assert.ok(logger, 'the logger window must be registered: ' +
    JSON.stringify(state.featureWindows.map(function (w) { return w.id; })));
  assert.strictEqual(logger.title(), 'Packet logger', 'the reference calls this window "Packet logger"');
  assert.ok(/packets[\\/]logger\.html$/.test(logger.url), 'the window serves its own page: ' + logger.url);

  // Feature windows that do not need Flash: sandboxed, no plugin, files read by the preload only.
  assert.strictEqual(logger.config.webPreferences.sandbox, true);
  assert.strictEqual(logger.config.webPreferences.plugins, false);
  assert.strictEqual(logger.config.webPreferences.nodeIntegration, false);
  assert.strictEqual(logger.config.webPreferences.contextIsolation, true);

  // One Packets menu, the reference's own words, opening exactly that window.
  const items = [].concat.apply([], state.menus.map(function (contributor) {
    return contributor({ labels: {}, keybinds: {} });
  }));
  const packets = items.filter(function (item) { return item.label === 'Packets'; })[0];
  assert.ok(packets, 'the reference groups its packet tools under Packets');
  const sniffer = packets.submenu.filter(function (item) { return item.label === 'Sniffer'; })[0];
  assert.ok(sniffer, 'the reference opens the logger from Packets -> Sniffer');
  const before = tap.subscribes;
  sniffer.click();
  assert.deepStrictEqual(opened, ['grimlite-parity-packet-logger']);

  assert.strictEqual(tap.subscribes, before, 'opening the logger adds no subscription: Start does');
});

test('Start and Stop on the logger window control the one subscription', async () => {
  const tap = standInTap();
  const activated = await activatedPlugin({ getPacketTap: function () { return tap; } });
  const state = activated.host._getState();
  const start = handlerFor(state, 'packetsStart');
  const stop = handlerFor(state, 'packetsStop');
  const window_ = fakeWindow();

  const base = tap.subscribes;
  start({ sender: window_ });
  assert.strictEqual(tap.subscribes, base + 1);
  tap.emit({ id: 1, direction: 'toClient', data: Buffer.from('first') });
  tap.emit({ id: 1, direction: 'toServer', data: Buffer.from('second') });
  assert.deepStrictEqual(window_.sent.map(function (item) { return item.payload.text; }), ['first', 'second']);
  assert.ok(window_.sent.every(function (item) { return item.channel === FRAME_CHANNEL; }));
  assert.deepStrictEqual(window_.sent.map(function (item) { return item.payload.direction; }),
    ['toClient', 'toServer'], 'direction travels with the frame');

  start({ sender: window_ });
  assert.strictEqual(tap.subscribes, base + 1, 'a second Start is not a second listener');

  stop({ sender: window_ });
  assert.strictEqual(tap.releases, 1, 'Stop releases the subscription');
  tap.emit({ id: 1, direction: 'toClient', data: Buffer.from('after stop') });
  assert.strictEqual(window_.sent.length, 2, 'nothing arrives after Stop');
});

test('two logger windows share one subscription and each sees every frame once', async () => {
  const tap = standInTap();
  const activated = await activatedPlugin({ getPacketTap: function () { return tap; } });
  const state = activated.host._getState();
  const start = handlerFor(state, 'packetsStart');
  const stop = handlerFor(state, 'packetsStop');
  const first = fakeWindow();
  const second = fakeWindow();

  const base = tap.subscribes;
  start({ sender: first });
  start({ sender: second });
  assert.strictEqual(tap.subscribes, base + 1, 'two windows, one listener');

  tap.emit({ id: 1, direction: 'toServer', data: Buffer.from('once') });
  assert.strictEqual(first.sent.length, 1, 'no duplicate frames for the first window');
  assert.strictEqual(second.sent.length, 1, 'no duplicate frames for the second window');

  stop({ sender: first });
  assert.strictEqual(tap.releases, 0, 'the second window is still watching');
  tap.emit({ id: 1, direction: 'toServer', data: Buffer.from('still') });
  assert.strictEqual(first.sent.length, 1, 'a stopped window receives nothing');
  assert.strictEqual(second.sent.length, 2);

  stop({ sender: second });
  assert.strictEqual(tap.releases, 1);
});

// The sniffer itself reads through packet-tap; its embedded Spammer is the one write path, and it
// goes through packet-send exactly like the separate Spammer window.
test('the logger reads through packet-tap and its embedded Spammer writes through packet-send', async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  assert.ok(manifest.permissions.indexOf('packet-tap') !== -1, 'the logger reads through packet-tap');
  assert.ok(manifest.permissions.indexOf('packet-send') !== -1,
    'packet-send is declared for the spammer and tamperer, which are separate tickets');

  const logger = fs.readFileSync(path.join(pluginRoot, 'features/packets/logger.html'), 'utf8');
  assert.ok(/Clear/.test(logger) && /Copy/.test(logger), 'the reference window has Copy and Clear');
  const source = ['frames.js', 'logger.js', 'preload_logger.js'].map(function (file) {
    return fs.readFileSync(path.join(pluginRoot, 'features/packets', file), 'utf8');
  }).join('\n');
  assert.ok(/packets\.send/.test(source),
    'the embedded Spammer writes through host.packets.send');
});
test('the filter narrows what is drawn without losing a frame, and clears case-insensitively', () => {
  const captured = [
    { direction: 'toServer', text: '%xt%zm%moveToCell%yulgar-1%Enter%Spawn%' },
    { direction: 'toClient', text: "<msg t='sys'><body action='apiOK' r='0'></body></msg>" },
    { direction: 'toServer', text: '%xt%zm%MoveToCell%extra%' }
  ];

  assert.deepStrictEqual(feed.visibleFrames(captured, ''), captured, 'an empty filter shows everything');
  assert.deepStrictEqual(feed.visibleFrames(captured, '   '), captured, 'whitespace is not a filter');

  const narrowed = feed.visibleFrames(captured, 'movetocell');
  assert.strictEqual(narrowed.length, 2, 'both directions are searched, case-insensitively');
  assert.strictEqual(narrowed[0].text, captured[0].text, 'filtering reorders nothing');

  assert.deepStrictEqual(feed.visibleFrames(captured, 'apiOK').length, 1);
  assert.deepStrictEqual(feed.visibleFrames(captured, 'nothing-matches-this'), []);
  // The frames themselves are untouched: the filter is a view, so widening it loses nothing.
  assert.deepStrictEqual(feed.visibleFrames(captured, ''), captured);
  assert.deepStrictEqual(captured.map(function (f) { return f.text; }),
    ['%xt%zm%moveToCell%yulgar-1%Enter%Spawn%',
      "<msg t='sys'><body action='apiOK' r='0'></body></msg>",
      '%xt%zm%MoveToCell%extra%']);
});

test('Copy hands over the raw frames one per line, as the reference does', () => {
  const captured = [
    { direction: 'toServer', text: '%xt%zm%gar%1%2%w' },
    { direction: 'toClient', text: "apiOK" },
    { direction: 'toServer', text: '%xt%zm%moveToCell%' }
  ];

  assert.strictEqual(feed.copyText(captured, ''),
    '%xt%zm%gar%1%2%w\napiOK\n%xt%zm%moveToCell%',
    'the reference prints one raw frame per line');
  assert.strictEqual(feed.copyText(captured, 'm'),
    '%xt%zm%gar%1%2%w\n%xt%zm%moveToCell%',
    'Copy respects the filter, like anything else the window shows');
  assert.strictEqual(feed.copyText([], ''), '', 'an empty list copies nothing');
  assert.strictEqual(feed.copyText(captured.map(function (f) {
    return { direction: f.direction, text: Buffer.from(f.text, 'utf8') };
  }), ''), '%xt%zm%gar%1%2%w\napiOK\n%xt%zm%moveToCell%',
  'a buffer frame copies the same raw text the window shows');
});

test('each direction has its own name, so a frame is never ambiguous', () => {
  assert.strictEqual(feed.directionLabel('toServer'), 'Client',
    'a frame the client sent is the client\'s');
  assert.strictEqual(feed.directionLabel('toClient'), 'Server',
    'a frame the client received came from the server');
  assert.notStrictEqual(feed.directionLabel('toServer'), feed.directionLabel('toClient'));
});

test('frame text survives a buffer, a string and anything else the wire hands over', () => {
  assert.strictEqual(feed.toFrameText(Buffer.from('%xt%zm%gar%1%2%w', 'utf8')), '%xt%zm%gar%1%2%w');
  assert.strictEqual(feed.toFrameText('already text'), 'already text');
  // The reference decodes every frame as UTF-8 (GrimoireClient.cs accumulates to the NUL and
  // decodes), so multi-byte content must come through intact rather than mangled byte-wise.
  assert.strictEqual(feed.toFrameText(Buffer.from('caf\u00e9 \u4f60\u597d', 'utf8')), 'caf\u00e9 \u4f60\u597d');
});
