// The bridge transport: a plugin names the call surface, the platform injects the page side
// into the game window and routes calls through it. Page-side logic is evaluated for real in a
// vm with a fake DOM, so the part that talks to Flash is checked, not mirrored.
const assert = require('assert');
const vm = require('vm');

const bridgeChannel = require('../../res/platform/bridge-channel.js');

function fakePage(options) {
  options = options || {};
  const calls = [];
  const element = {
    type: 'application/x-shockwave-flash'
  };
  // Register the whole surface the reference loader exposes, so a missing name is a choice.
  (options.callbacks || ['getGameObject', 'callGameFunction']).forEach(function (name) {
    element[name] = function () {
      calls.push({ name: name, args: Array.prototype.slice.call(arguments) });
      if (name === 'boom') throw new Error('flash exploded');
      return options.results && name in options.results ? options.results[name] : 'value-of-' + name;
    };
  });
  const document = {
    getElementsByTagName: function (tag) {
      if (tag === 'object') return options.noObject ? [] : [element];
      return [];
    },
    embeds: []
  };
  const sandbox = { document: document, JSON: JSON };
  sandbox.window = { location: { href: 'http://127.0.0.1:9/wrapper.html?swf=game.swf' } };
  vm.runInNewContext(bridgeChannel.buildPageSource({ worldKey: 'aquaBridge', probeNames: ['getGameObject'] }), sandbox);
  return { page: sandbox.window.aquaBridge, calls: calls, sandbox: sandbox };
}

test('the page side reports readiness only once the SWF registered the probe callback', () => {
  const waiting = fakePage({ callbacks: [] });
  assert.strictEqual(waiting.page.ready(), false, 'no callback yet: not ready');

  const live = fakePage();
  assert.strictEqual(live.page.ready(), true);

  const noElement = fakePage({ noObject: true });
  assert.strictEqual(noElement.page.ready(), false, 'no plugin element: not ready');
});

test('a page-side call passes the name and arguments to the SWF and returns its value', () => {
  const page = fakePage({
    results: { callGameFunction: '{"intHP":42}' }
  });

  // The page side runs in another realm, so compare its plain fields, not object identity.
  const read = page.page.call('getGameObject', ['world.strFrame']);
  assert.strictEqual(read.ok, true, read.error);
  assert.strictEqual(read.value, 'value-of-getGameObject');
  assert.deepStrictEqual(page.calls[0], { name: 'getGameObject', args: ['world.strFrame'] });

  // Several arguments and a non-string name are passed through in order, unquoted.
  const called = page.page.call('callGameFunction', ['world.getQuestValue', '3']);
  assert.strictEqual(called.ok, true, called.error);
  assert.strictEqual(called.value, '{"intHP":42}');
  assert.deepStrictEqual(page.calls[1], {
    name: 'callGameFunction',
    args: ['world.getQuestValue', '3']
  });
});

test('a call the SWF does not answer is an error result, never a thrown exception', () => {
  const page = fakePage();
  const missing = page.page.call('notRegistered', []);
  assert.strictEqual(missing.ok, false);
  assert.ok(/notRegistered/.test(missing.error), missing.error);
  assert.strictEqual(page.calls.length, 0, 'nothing was called');

  const throwing = fakePage({ callbacks: ['boom'] });
  const failed = throwing.page.call('boom', []);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.error, 'flash exploded');
});

test('the channel refuses a call when there is no game window, and names what it needs', async () => {
  const channel = bridgeChannel.createBridgeChannel({
    getGameWindow: function () { return null; },
    executeJavaScript: function () { throw new Error('must not be reached'); },
    log: function () {}
  });
  const call = await channel.call('getGameObject', ['world.strFrame']);
  assert.strictEqual(call.ok, false);
  assert.strictEqual(call.error, 'no game window');
});

test('the channel injects one page-side script and routes calls to the SWF element', async () => {
  const seen = [];
  const injected = [];
  const page = fakePage();
  const fakeWindow = {
    isDestroyed: function () { return false; },
    getURL: function () { return 'http://127.0.0.1:9/wrapper.html?swf=game.swf'; },
    webContents: { id: 7 }
  };
  const channel = bridgeChannel.createBridgeChannel({
    getGameWindow: function () { return fakeWindow; },
    log: function () {},
    executeJavaScript: function (webContents, source, label) {
      assert.strictEqual(webContents, fakeWindow.webContents);
      // The api definition is the one injection that declares the probe names it waits for.
      if (source.indexOf('probeNames') !== -1) {
        injected.push({ label: label, source: source });
        return Promise.resolve(true);
      }
      seen.push(source);
      // Stand in for the page: the injected api is invoked the way the source spells it.
      return Promise.resolve(page.page.call('getGameObject', ['world.strFrame']));
    }
  });

  const attached = await channel.attach();
  assert.strictEqual(attached.ok, true, attached.error);
  assert.strictEqual(injected.length, 1, 'exactly one page-side injection');
  assert.ok(injected[0].source.indexOf('aquaBridge') !== -1);

  const result = await channel.call('getGameObject', ['world.strFrame']);
  assert.strictEqual(result.ok, true, result.error);
  assert.strictEqual(result.value, 'value-of-getGameObject');
  assert.strictEqual(seen.length, 2, 'readiness probe, then the call');
  assert.ok(seen[1].indexOf('aquaBridge') !== -1, seen[1]);
  assert.ok(seen[1].indexOf('"world.strFrame"') !== -1, seen[1]);

  // A second attach is a no-op: the page-side api is already there.
  await channel.attach();
  assert.strictEqual(injected.length, 1);
});

test('a name that is not a plain callback name is refused before it reaches a page', async () => {
  let executed = 0;
  const win = {
    isDestroyed: function () { return false; },
    getURL: function () { return 'http://127.0.0.1:9/wrapper.html'; },
    webContents: { id: 3 }
  };
  const channel = bridgeChannel.createBridgeChannel({
    getGameWindow: function () { return win; },
    executeJavaScript: function () { executed++; return Promise.resolve(null); },
    log: function () {}
  });
  for (const bad of ['', 'a b', 'x();alert(1)', 'a-b', 7, null]) {
    const result = await channel.call(bad, []);
    assert.strictEqual(result.ok, false, 'refused: ' + String(bad));
  }
  assert.strictEqual(executed, 0, 'nothing reached the page');
});

test('attach reports a bridge that never registers its callbacks instead of hanging', async () => {
  const win = {
    isDestroyed: function () { return false; },
    getURL: function () { return 'http://127.0.0.1:9/wrapper.html'; },
    webContents: { id: 9 }
  };
  const channel = bridgeChannel.createBridgeChannel({
    getGameWindow: function () { return win; },
    readyTimeoutMs: 40,
    log: function () {},
    executeJavaScript: function (webContents, source) {
      if (source.indexOf('probeNames') !== -1) return Promise.resolve(true);   // api injected
      return Promise.resolve(false);                                          // never ready
    }
  });
  const attached = await channel.attach();
  assert.strictEqual(attached.ok, false);
  assert.ok(/callback/i.test(attached.error), attached.error);
});
