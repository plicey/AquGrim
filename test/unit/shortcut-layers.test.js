// The app's two shortcut layers (res/platform/shortcut-layers.js): the focus-scoped
// electron-localshortcut hook, the app-wide Electron globalShortcut hook, and the Wayland rule
// that substitutes the former for the latter because the app-wide key is accepted but never
// delivered there. The platform's own bindings and the plugins' app-wide ones share this.
const assert = require('assert');
const layers = require('../../res/platform/shortcut-layers.js');

test('a Wayland session uses the focus-scoped layer for app-wide shortcuts', () => {
  assert.strictEqual(layers.shouldUseLocalGlobalShortcuts({ XDG_SESSION_TYPE: 'wayland' }, 'linux'), true);
  assert.strictEqual(layers.shouldUseLocalGlobalShortcuts({ XDG_SESSION_TYPE: 'x11' }, 'linux'), false);
  assert.strictEqual(layers.shouldUseLocalGlobalShortcuts({}, 'linux'), false);
  // The rule is Linux's alone: Windows and macOS deliver globalShortcut normally.
  assert.strictEqual(layers.shouldUseLocalGlobalShortcuts({ XDG_SESSION_TYPE: 'wayland' }, 'win32'), false);
  assert.strictEqual(layers.shouldUseLocalGlobalShortcuts({ XDG_SESSION_TYPE: 'wayland' }, 'darwin'), false);
});

test('the focus-scoped global layer registers through electron-localshortcut', () => {
  const calls = [];
  const local = {
    // The library answers nothing on success in this Electron; that is still a binding.
    register: function (accelerator) { calls.push(['register', accelerator]); },
    unregister: function (accelerator) { calls.push(['unregister', accelerator]); }
  };
  const layer = layers.createGlobalLayer({ focusScoped: true, localShortcuts: local });
  assert.strictEqual(layer.kind, 'global');
  assert.strictEqual(layer.focusScoped, true, 'the caller can tell this is the fallback');
  assert.strictEqual(layer.register('Alt+Shift+U', function () {}), true);
  layer.unregister('Alt+Shift+U');
  assert.deepStrictEqual(calls, [['register', 'Alt+Shift+U'], ['unregister', 'Alt+Shift+U']]);
});

test('a session with an app-wide hook registers through Electron globalShortcut', () => {
  const calls = [];
  const globalShortcuts = {
    register: function (accelerator) { calls.push(['register', accelerator]); return true; },
    unregister: function (accelerator) { calls.push(['unregister', accelerator]); }
  };
  const layer = layers.createGlobalLayer({ focusScoped: false, globalShortcuts: globalShortcuts });
  assert.strictEqual(layer.kind, 'global');
  assert.strictEqual(layer.focusScoped, false);
  assert.strictEqual(layer.register('Alt+Shift+U', function () {}), true);
  layer.unregister('Alt+Shift+U');
  assert.deepStrictEqual(calls, [['register', 'Alt+Shift+U'], ['unregister', 'Alt+Shift+U']]);
});

test('a refused or throwing registration is reported, never counted as bound', () => {
  const refusedLocal = layers.createLocalLayer({
    localShortcuts: { register: function () { return false; }, unregister: function () {} }
  });
  assert.strictEqual(refusedLocal.register('Alt+Shift+U', function () {}), false);
  const refusedGlobal = layers.createGlobalLayer({
    focusScoped: false,
    globalShortcuts: {
      register: function () { throw new Error('the portal refused it'); },
      unregister: function () {}
    }
  });
  assert.strictEqual(refusedGlobal.register('Alt+Shift+U', function () {}), false);
  // Unregistering a key that never took is the ordinary shutdown path, not a throw.
  assert.doesNotThrow(function () { refusedGlobal.unregister('Alt+Shift+U'); });
});

test('the local layer keeps the Wayland marker the Maid reads', () => {
  const layer = layers.createLocalLayer({
    localShortcuts: { register: function () { return true; }, unregister: function () {} }
  });
  assert.strictEqual(layer.kind, 'local');
  assert.strictEqual(layer.focusScoped, true);
});
