const assert = require('assert');

const urls = require('../../plugins/adventure-quest-worlds/urls.js');
const session = require('../../plugins/adventure-quest-worlds/session.js');
const { applySessionRules } = require('../../res/platform/session-rules.js');

test('the loader is recognised on whichever origin serves it', () => {
  // In local-origin mode the same loader arrives as http://127.0.0.1:<port>/game/... .
  // Window classification, the Ruffle path and the capture permission all key off this.
  assert.strictEqual(urls.isLoaderUrl('http://127.0.0.1:40000/game/gamefiles/Loader4.swf?ver=b'), true);
  assert.strictEqual(urls.isLoaderUrl('http://127.0.0.1:40000/game/gamefiles/Loader_Spider.swf?ver=1'), true);
  assert.strictEqual(urls.isLoaderUrl('https://game.aq.com/game/gamefiles/Loader4.swf?ver=b'), true);
  assert.strictEqual(urls.isLoaderUrl('http://127.0.0.1:40000/game/not-a-loader.png'), false);
  assert.strictEqual(urls.isLoaderUrl('http://evil.example/game/gamefiles/Loader4.swf'), false,
    'a loose match inside a foreign path is not the game');
});

test('the AQW plugin mirrors its game hosts on loopback and routes its URLs through them', () => {
  const host = require('../../plugins/adventure-quest-worlds/game-origin.js');
  // The routes are the plugin's own business: the game host mirrored as-is ("/" preserves
  // the path, which is how game.aq.com/game/... keeps working), the two asset hosts mounted
  // under their own prefixes. Nothing here is the platform's to know.
  assert.deepStrictEqual(host.routes(), [
    { prefix: '/proxy/content/', origin: 'https://content.aq.com' },
    { prefix: '/proxy/account/', origin: 'https://account.aq.com' },
    { prefix: '/', origin: 'https://game.aq.com' }
  ]);

  assert.strictEqual(
    host.toServeFromOrigin('https://game.aq.com/game/gamefiles/Loader4.swf?ver=b', 'http://127.0.0.1:41000'),
    'http://127.0.0.1:41000/game/gamefiles/Loader4.swf?ver=b'
  );
  assert.strictEqual(
    host.toServeFromOrigin('https://content.aq.com/ui/hero.png', 'http://127.0.0.1:41000'),
    'http://127.0.0.1:41000/proxy/content/ui/hero.png'
  );
  assert.strictEqual(
    host.toServeFromOrigin('https://account.aq.com/Login', 'http://127.0.0.1:41000'),
    'http://127.0.0.1:41000/proxy/account/Login'
  );
  // Hosts the plugin does not mirror are left alone, not silently rewritten.
  assert.strictEqual(
    host.toServeFromOrigin('https://play.dragonfable.com/game/DFLoader.swf', 'http://127.0.0.1:41000'),
    'https://play.dragonfable.com/game/DFLoader.swf'
  );
  assert.strictEqual(host.toServeFromOrigin('file:///C:/custom.swf', 'http://127.0.0.1:41000'), 'file:///C:/custom.swf');
  assert.strictEqual(host.toServeFromOrigin('https://game.aq.com/x', ''), 'https://game.aq.com/x');
  // The Artix WAF answers 403 to a browser-shaped UA that is not the launcher's, so the
  // origin sends what the plugin's own UA policy says the launcher sends.
  assert.strictEqual(
    host.userAgent('Mozilla/5.0 (X11) AquaStar/2.0.0 Chrome/87.0.4280.141 Electron/11.5.0 Safari/537.36'),
    'Mozilla/5.0 (X11) Safari/537.36'
  );
});

test('AQW url catalog exposes loader, DF, and testing helpers', () => {
  assert.ok(urls.URLS.loader4.indexOf('Loader4.swf') !== -1);
  assert.ok(urls.URLS.dfLoader.indexOf('dragonfable.com') !== -1);
  const testing = urls.testingAQW();
  assert.ok(urls.isTestingAqwUrl(testing));
  assert.ok(urls.buildCharLookupUrl('Hero').indexOf('id=Hero') !== -1);
});

test('AQW session rules use Electron callback shapes', () => {
  const rules = session.createSessionRules();
  const artix = rules.filter(function (r) {
    return r.id === 'artix-ua';
  })[0];
  const swf = rules.filter(function (r) {
    return r.id === 'swf-log';
  })[0];
  assert.ok(artix && typeof artix.onBeforeSendHeaders === 'function');
  assert.ok(swf && typeof swf.onBeforeRequest === 'function');
  assert.strictEqual(swf.enabledWhen({ swfLog: true }), true);
  assert.strictEqual(swf.enabledWhen({ swfLog: false }), false);

  let headersOut = null;
  artix.onBeforeSendHeaders(
    { requestHeaders: {} },
    { defaultUserAgent: 'Mozilla/5.0 (X11) AquaStar/1 Chrome/87 Electron/11 Safari/537.36' },
    function (result) {
      headersOut = result;
    }
  );
  assert.strictEqual(headersOut.requestHeaders['User-Agent'], 'Mozilla/5.0 (X11) Safari/537.36');
  assert.strictEqual(headersOut.requestHeaders.artixmode, 'launcher');

  let cancelOut = null;
  const logged = [];
  swf.onBeforeRequest(
    { url: 'https://game.aq.com/game/x.swf' },
    {
      logLine: function (u) {
        logged.push(u);
      }
    },
    function (result) {
      cancelOut = result;
    }
  );
  assert.deepStrictEqual(cancelOut, { cancel: false });
  assert.deepStrictEqual(logged, ['https://game.aq.com/game/x.swf']);
});

test('applySessionRules registers matching Electron webRequest handlers', () => {
  const calls = [];
  const fakeSession = {
    webRequest: {
      onBeforeSendHeaders: function (filter, listener) {
        calls.push({ type: 'headers', filter: filter, listener: listener });
      },
      onBeforeRequest: function (filter, listener) {
        calls.push({ type: 'request', filter: filter, listener: listener });
      }
    }
  };
  applySessionRules(fakeSession, session.createSessionRules(), {
    defaultUserAgent: 'x',
    settings: { swfLog: true },
    logLine: function () {}
  });
  assert.ok(
    calls.some(function (c) {
      return c.type === 'headers';
    })
  );
  assert.ok(
    calls.some(function (c) {
      return c.type === 'request';
    })
  );
});

test('flashTrustUrlList includes primary and known game hosts', () => {
  const list = session.flashTrustUrlList('file:///custom.swf');
  assert.ok(list.indexOf('file:///custom.swf') !== -1);
  assert.ok(list.indexOf(urls.URLS.loader4) !== -1);
  assert.ok(list.indexOf(urls.URLS.dfLoader) !== -1);
});
