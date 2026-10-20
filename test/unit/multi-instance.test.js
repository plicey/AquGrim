const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const instanceSession = require('../../res/instance-session.js');

test('the main instance uses the one shared app-data configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-instance-test-'));
  const paths = {};
  const app = {
    getPath: function (name) { return name === 'appData' ? root : ''; },
    setPath: function (name, value) { paths[name] = value; }
  };
  const state = instanceSession.configure(app, ['electron', '.']);
  assert.strictEqual(state.appData, path.join(root, 'AquaStar'));
  assert.strictEqual(state.userData, state.appData);
  assert.strictEqual(state.persistentAppData, state.appData);
  assert.strictEqual(paths.userData, state.userData);
  assert.strictEqual(app.aquaStarDataDirectory, state.appData);
  assert.strictEqual(app.aquaStarPersistentDataDirectory, state.appData);
  assert.ok(fs.existsSync(state.userData));
  fs.rmSync(root, { recursive: true, force: true });
});

test('an extra instance starts from a temporary copy of the main instance', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-instance-test-'));
  const seeded = path.join(root, 'AquaStar');
  fs.mkdirSync(path.join(seeded, 'Cache'), { recursive: true });
  fs.writeFileSync(path.join(seeded, 'aquastar.json'), '{"activePluginId":"grimlite-parity"}');
  fs.writeFileSync(path.join(seeded, 'Cookies'), 'session');
  const app = {
    getPath: function () { return root; },
    setPath: function () {}
  };
  const state = instanceSession.configure(app, ['electron', '.', instanceSession.INSTANCE_FLAG]);
  assert.strictEqual(state.persistentAppData, seeded);
  assert.notStrictEqual(state.appData, seeded);
  assert.strictEqual(state.userData, state.appData);
  assert.strictEqual(app.aquaStarDataDirectory, state.appData);
  assert.strictEqual(app.aquaStarPersistentDataDirectory, seeded);
  assert.ok(state.userData.indexOf('aquagrim-instance-') !== -1);
  assert.ok(fs.existsSync(state.userData));
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(state.appData, 'aquastar.json'), 'utf8')),
    { activePluginId: 'grimlite-parity' }, 'settings are cloned from main');
  assert.strictEqual(fs.readFileSync(path.join(state.appData, 'Cookies'), 'utf8'), 'session',
    'the login database is cloned from main');
  assert.ok(!fs.existsSync(path.join(state.appData, 'Cache')), 'cache is not cloned');
  instanceSession.cleanup();
  assert.ok(!fs.existsSync(state.userData));

  const second = instanceSession.configure(app, ['electron', '.', instanceSession.INSTANCE_FLAG]);
  assert.notStrictEqual(second.userData, state.userData);
  instanceSession.cleanup();
  fs.rmSync(root, { recursive: true, force: true });
});

test('launching a second instance uses the unnamed session flag', () => {
  let seen = null;
  const fakeChild = { unref: function () { seen.unrefed = true; } };
  const result = instanceSession.launch({
    appPath: '/app',
    argv: ['electron', '/app', '--no-sandbox'],
    defaultApp: true,
    execPath: '/electron',
    spawn: function (executable, args, options) {
      seen = { executable: executable, args: args, options: options };
      return fakeChild;
    }
  });
  assert.deepStrictEqual(result.args, ['/app', instanceSession.INSTANCE_FLAG, '--no-sandbox']);
  assert.strictEqual(seen.executable, '/electron');
  assert.strictEqual(seen.options.detached, true);
  assert.strictEqual(seen.unrefed, true);
});

test('an AppImage instance launches through the AppImage itself', () => {
  let seen = null;
  instanceSession.launch({
    appImage: '/tmp/AquaGrim.AppImage',
    execPath: '/tmp/.mount/AquaGrim/aquastar',
    defaultApp: false,
    spawn: function (executable, args) {
      seen = { executable: executable, args: args };
      return { unref: function () {} };
    }
  });
  assert.strictEqual(seen.executable, '/tmp/AquaGrim.AppImage');
  assert.deepStrictEqual(seen.args, [instanceSession.INSTANCE_FLAG]);
});

test('sessions are configured before the instance lock is requested', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  assert.ok(main.indexOf('instanceSession.configure') < main.indexOf('requestSingleInstanceLock'));
  assert.strictEqual(main.indexOf("profile.name"), -1);
  assert.ok(fs.readFileSync(path.join(__dirname, '../../res/windows/menu.js'), 'utf8')
    .indexOf('instanceSession.launch') !== -1);
});

test('plugin configuration follows the temp copy while file-save folders stay persistent', () => {
  const root = path.join(__dirname, '../..');
  const constant = fs.readFileSync(path.join(root, 'res/const.js'), 'utf8');
  const host = fs.readFileSync(path.join(root, 'res/platform/plugin-host.js'), 'utf8');
  const main = fs.readFileSync(path.join(root, 'plugins/grimlite-parity/main.js'), 'utf8');
  assert.ok(constant.indexOf('app.aquaStarDataDirectory || persistentAppDataDirectory') !== -1);
  assert.ok(host.indexOf('persistentAppDataDirectory:') !== -1);
  assert.ok(main.indexOf("host.persistentAppDataDirectory || host.appDataDirectory, 'Bots'") !== -1);
});
