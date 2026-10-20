const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const instanceSession = require('../../res/instance-session.js');

test('the main instance uses the one shared app-data configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-instance-test-'));
  const paths = {};
  const state = instanceSession.configure({
    getPath: function (name) { return name === 'appData' ? root : ''; },
    setPath: function (name, value) { paths[name] = value; }
  }, ['electron', '.']);
  assert.strictEqual(state.appData, path.join(root, 'AquaStar'));
  assert.strictEqual(state.userData, state.appData);
  assert.strictEqual(paths.userData, state.userData);
  assert.ok(fs.existsSync(state.userData));
  fs.rmSync(root, { recursive: true, force: true });
});

test('an extra instance gets a temporary unnamed session and shares app data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-instance-test-'));
  const app = {
    getPath: function () { return root; },
    setPath: function () {}
  };
  const state = instanceSession.configure(app, ['electron', '.', instanceSession.INSTANCE_FLAG]);
  assert.strictEqual(state.appData, path.join(root, 'AquaStar'));
  assert.notStrictEqual(state.userData, state.appData);
  assert.ok(state.userData.indexOf('aquagrim-instance-') !== -1);
  assert.ok(fs.existsSync(state.userData));
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
