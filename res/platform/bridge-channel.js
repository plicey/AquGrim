// The bridge channel: the platform's side of "read and write the game from the app".
//
// The mechanism (settled by research tickets #2 and #7, and by #8's resolution): a bridge SWF
// registers ExternalInterface callbacks on its own <object>, so the page can call them as methods
// on the element. The platform never talks to the movie itself - it injects a small page-side
// script into the game window and routes plugin calls through it. Nothing here names a game: the
// call surface arrives from the plugin's manifest.
//
// The bridge SWF must sit in the same origin as the game SWF or Chromium's PPAPI Flash denies
// every ApplicationDomain access (#2119/#2121); that same-origin arrangement is what the loopback
// game origin provides, and it is the plugin's business, not the platform's.

const CALLBACK_NAME_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// Names the page-side api uses on window. One word, no separators: it is injected as source.
const DEFAULT_WORLD_KEY = 'aquaBridge';

/**
 * The page-side half of the bridge, as source: it is injected into the game window with
 * executeJavaScript (the window's own origin, so it runs against the page that owns the <object>).
 * It finds the plugin element, waits for a callback the movie registers, and forwards calls.
 *
 * Written as a plain function body and stringified so the exact source is also readable in tests.
 * @param {{ worldKey?: string, probeNames?: string[] }} options
 */
function buildPageSource(options) {
  options = options || {};
  const worldKey = options.worldKey || DEFAULT_WORLD_KEY;
  const probes = Array.isArray(options.probeNames) ? options.probeNames : [];
  return [
    'window[' + JSON.stringify(worldKey) + '] = {',
    '  probeNames: ' + JSON.stringify(probes) + ',',
    '  element: function () {',
    '    var objects = document.getElementsByTagName("object");',
    '    for (var i = 0; i < objects.length; i++) {',
    '      if (objects[i].type === "application/x-shockwave-flash") return objects[i];',
    '    }',
    '    return null;',
    '  },',
    '  ready: function () {',
    '    var el = this.element();',
    '    if (!el) return false;',
    '    for (var i = 0; i < this.probeNames.length; i++) {',
    '      if (typeof el[this.probeNames[i]] !== "function") return false;',
    '    }',
    '    return true;',
    '  },',
    '  call: function (name, args) {',
    '    try {',
    '      var el = this.element();',
    '      if (!el) return { ok: false, error: "no Flash element in this page" };',
    '      if (typeof el[name] !== "function") {',
    '        return { ok: false, error: "the bridge does not register " + name };',
    '      }',
    '      var value = el[name].apply(el, args || []);',
    '      return { ok: true, value: value === undefined ? null : value };',
    '    } catch (error) {',
    '      return { ok: false, error: String(error && error.message ? error.message : error) };',
    '    }',
    '  }',
    '};'
  ].join('\n');
}

function isCallbackName(name) {
  return typeof name === 'string' && CALLBACK_NAME_RE.test(name);
}

/**
 * @param {object} deps
 * @param {() => object|null} deps.getGameWindow  the window holding the game, or null
 * @param {(webContents: object, source: string, label: string) => Promise<any>} deps.executeJavaScript
 * @param {number} [deps.readyTimeoutMs] how long to let the movie register its callbacks
 * @param {(msg: string) => void} [deps.log]
 */
function createBridgeChannel(deps) {
  deps = deps || {};
  const log = deps.log || function () {};
  const readyTimeoutMs = deps.readyTimeoutMs || 20000;
  const worldKey = deps.worldKey || DEFAULT_WORLD_KEY;
  let attached = null;   // { window, webContents }

  function target() {
    if (typeof deps.getGameWindow !== 'function') return null;
    const win = deps.getGameWindow();
    if (!win || win.isDestroyed() || !win.webContents) return null;
    return win;
  }

  function execute(win, source, label) {
    return Promise.resolve(deps.executeJavaScript(win.webContents, source, label));
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function ready(win) {
    return execute(win, 'window[' + JSON.stringify(worldKey) + '] ? window[' +
      JSON.stringify(worldKey) + '].ready() : false', 'Bridge readiness probe');
  }

  return {
    /**
     * Inject the page side and wait for the movie's callbacks to appear. Idempotent per window:
     * re-attaching to the same window does not inject a second script.
     * @returns {Promise<{ ok: boolean, error?: string }>}
     */
    attach: async function () {
      const win = target();
      if (!win) return { ok: false, error: 'no game window' };
      if (attached && attached.webContents === win.webContents && await ready(win)) {
        return { ok: true };
      }
      await execute(win, buildPageSource({
        worldKey: worldKey,
        probeNames: Array.isArray(deps.probeNames) ? deps.probeNames : []
      }), 'Bridge page side');

      const deadline = Date.now() + readyTimeoutMs;
      for (;;) {
        const current = target();
        if (!current || current.webContents !== win.webContents) {
          return { ok: false, error: 'the game window went away' };
        }
        if (await ready(win)) break;
        if (Date.now() >= deadline) {
          return {
            ok: false,
            error: 'the bridge movie did not register its callbacks within ' +
              readyTimeoutMs + 'ms: is the bridge SWF the game window loads?'
          };
        }
        await sleep(200);
      }
      attached = { window: win, webContents: win.webContents };
      log('bridge attached to ' + win.getURL());
      return { ok: true };
    },

    /**
     * Call a registered bridge callback. Never throws: a bridge that is absent, not attached yet
     * or otherwise unable to answer reports why, so a caller can show it.
     * @returns {Promise<{ ok: true, value: any } | { ok: false, error: string }>}
     */
    call: async function (name, args) {
      if (!isCallbackName(name)) {
        return { ok: false, error: 'not a bridge callback name: ' + JSON.stringify(name) };
      }
      const win = target();
      if (!win) return { ok: false, error: 'no game window' };
      const expression = 'window[' + JSON.stringify(worldKey) + '] ? window[' +
        JSON.stringify(worldKey) + '].call(' + JSON.stringify(name) + ', ' +
        JSON.stringify(Array.isArray(args) ? args : []) + ') : { ok: false, error: "the bridge ' +
        'page side is not attached" }';
      const result = await execute(win, expression, 'Bridge call ' + name);
      if (!result || typeof result !== 'object') {
        return { ok: false, error: 'the page returned no bridge result' };
      }
      return result;
    },

    /** The game window the channel is attached to, or null. */
    attachedWindow: function () {
      return attached ? attached.window : null;
    },

    /** @internal test seam */
    _worldKey: worldKey
  };
}

module.exports = {
  createBridgeChannel: createBridgeChannel,
  buildPageSource: buildPageSource,
  isCallbackName: isCallbackName,
  DEFAULT_WORLD_KEY: DEFAULT_WORLD_KEY
};
