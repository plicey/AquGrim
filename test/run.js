const path = require('path');

const tests = [];
global.test = function (name, fn) {
  tests.push({ name: name, fn: fn });
};

[
  './unit/list-state.test.js',
  './unit/reset-time.test.js',
  './unit/feature-window-controller.test.js',
  './unit/focus-style.test.js',
  './unit/ruffle-update-ui.test.js',
  './unit/wikiview-injection.test.js',
  './unit/charpage-lab.test.js',
  './unit/game-menu.test.js',
  './unit/menu-isolation.test.js',
  './unit/inventory-locales.test.js',
  './unit/plugin-locales.test.js',
  './unit/plugin-settings-ui.test.js',
  './unit/settings-layout.test.js',
  './unit/settings-merge.test.js',
  './unit/preload-bridge.test.js',
  './unit/example-companion.test.js',
  './unit/plugin-isolation-polish.test.js',
  './unit/release-staging.test.js',
  './unit/web-build.test.js',
  './unit/web-preview.test.js',
  './unit/pages-workflow.test.js',
  './unit/plugin-loader.test.js',
  './unit/local-plugin-require-gate.test.js',
  './unit/plugin-host-permissions.test.js',
  './unit/plugin-api-version.test.js',
  './unit/grimlite-bot-file.test.js',
  './unit/grimlite-bot-corpus.test.js',
  './unit/grimlite-bot-dialogs.test.js',
  './unit/grimlite-bot-window.test.js',
  './unit/grimlite-bot-editor.test.js',
  './unit/grimlite-bot-tabs.test.js',
  './unit/grimlite-bot-manager.test.js',
  './unit/grimlite-bot-manager-window.test.js',
  './unit/grimlite-bot-manager-game-reads.test.js',
  './unit/grimlite-login.test.js',
  './unit/plugin-game-access.test.js',
  './unit/grimlite-parity.test.js',
  './unit/bridge-channel.test.js',
  './unit/bridge-host.test.js',
  './unit/dev-test-window.test.js',
  './unit/grimlite-parity-windows.test.js',
  './unit/grimlite-loaders.test.js',
  './unit/grimlite-loader-surface.test.js',
  './unit/parity-boot.test.js',
  './unit/plugin-runtime.test.js',
  './unit/flash-trust.test.js',
  './unit/keybind-dispatcher.test.js',
  './unit/aqw-adapter-boot.test.js',
  './unit/aqw-session-urls.test.js',
  './unit/aqw-user-agent.test.js',
  './unit/aqw-keybind-urls.test.js',
  './unit/aqw-launcher-config.test.js',
  './unit/session-rules-multiplex.test.js',
  './unit/socket-proxy.test.js',
  './unit/origin-proxy.test.js',
  './unit/socket-relay.test.js',
  './unit/body-service.test.js',
  './unit/packet-steering.test.js',
  './unit/packet-tap.test.js',
  './unit/packet-logger.test.js',
  './unit/packet-send.test.js',
  './unit/grimlite-spammer.test.js',
  './unit/grimlite-tamperer.test.js',
  './unit/grimlite-packet-windows.test.js',
  './unit/aqw-charpage-print.test.js',
  './unit/platform-isolation.test.js',
  './unit/locale-templates.test.js',
  './unit/aqw-navigation.test.js',
  './unit/aqw-menus.test.js',
  './unit/namespaced-store.test.js',
  './unit/settings-resolve.test.js',
  './unit/pack-plugins.test.js',
  './unit/grimlite-cosmetics.test.js',
  './unit/grimlite-bot-engine.test.js',
  './unit/grimlite-bot-runtime.test.js',
  './unit/grimlite-bot-session.test.js',
  './unit/grimlite-bot-manager-engine.test.js',
  './unit/grimlite-bot-e2e.test.js',
  './unit/grimlite-bot-misc.test.js',
  './integration/json-store.test.js',
  './integration/local-origin.test.js',
  './unit/grimlite-bank.test.js',
  './unit/grimlite-sets.test.js',
  './unit/grimlite-bank-sets-windows.test.js',
  './unit/grimlite-bank-sets-pages.test.js',
  './unit/grimlite-bridge.test.js',
  './unit/grimlite-options.test.js',
  './unit/grimlite-hotkeys.test.js',
  './unit/grimlite-options-hotkeys-windows.test.js',
  './unit/grimlite-game-routes.test.js'
].forEach((file) => require(path.join(__dirname, file)));

(async () => {
  let failed = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log('✓ ' + item.name);
    } catch (error) {
      failed++;
      console.error('✗ ' + item.name + '\n' + (error.stack || error));
    }
  }
  console.log(tests.length + ' tests, ' + failed + ' failed');
  process.exitCode = failed ? 1 : 0;
})();
