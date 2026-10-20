const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const profiles = require('../../res/profiles.js');

test('profile flags resolve to safe, separate instance names', () => {
  assert.strictEqual(profiles.fromArgs(['electron', '.']), profiles.DEFAULT_PROFILE);
  assert.strictEqual(profiles.fromArgs(['electron', '.', '--profile=Account Two']), 'account-two');
  assert.strictEqual(profiles.fromArgs(['electron', '.', '--profile', 'Healer']), 'healer');
  assert.throws(() => profiles.fromArgs(['electron', '.', '--profile']), /needs an instance name/);
  assert.throws(() => profiles.normalize('../escape'), /cannot contain slashes/);
});

test('a named profile isolates Electron userData while appData stays shared', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-profile-'));
  const paths = {};
  const state = profiles.configure({
    getPath: function (name) { return name === 'appData' ? root : ''; },
    setPath: function (name, value) { paths[name] = value; }
  }, ['electron', '.', '--profile=second'], {});
  assert.strictEqual(state.appData, path.join(root, 'AquaStar'));
  assert.strictEqual(state.userData, path.join(root, 'AquaStar', 'profiles', 'second'));
  assert.strictEqual(paths.userData, state.userData);
  assert.ok(fs.existsSync(state.userData));
  fs.rmSync(root, { recursive: true, force: true });
});

test('another instance gets the next unused account profile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aquagrim-profile-next-'));
  fs.mkdirSync(path.join(root, 'profiles', 'account-2'), { recursive: true });
  assert.strictEqual(profiles.createNext(root), 'account-3');
  assert.ok(fs.existsSync(path.join(root, 'profiles', 'account-3')));
  fs.rmSync(root, { recursive: true, force: true });
});

test('launching a second instance carries its profile and sandbox flag', () => {
  let seen = null;
  const fakeChild = { unref: function () { seen.unrefed = true; } };
  const result = profiles.launch('Account Two', {
    appPath: '/app',
    argv: ['electron', '/app', '--no-sandbox'],
    defaultApp: true,
    execPath: '/electron',
    spawn: function (executable, args, options) {
      seen = { executable: executable, args: args, options: options };
      return fakeChild;
    }
  });
  assert.deepStrictEqual(result.args, ['/app', '--profile=account-two', '--no-sandbox']);
  assert.strictEqual(seen.executable, '/electron');
  assert.strictEqual(seen.options.detached, true);
  assert.strictEqual(seen.unrefed, true);
});

test('an AppImage instance launches through the AppImage itself', () => {
  let seen = null;
  profiles.launch('second', {
    appImage: '/tmp/AquaGrim.AppImage',
    execPath: '/tmp/.mount/AquaGrim/aquastar',
    defaultApp: false,
    spawn: function (executable, args) {
      seen = { executable: executable, args: args };
      return { unref: function () {} };
    }
  });
  assert.strictEqual(seen.executable, '/tmp/AquaGrim.AppImage');
  assert.deepStrictEqual(seen.args, ['--profile=second']);
});

test('profiles are configured before the instance lock is requested', () => {
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  assert.ok(main.indexOf('profiles.configure') < main.indexOf('requestSingleInstanceLock'));
  assert.ok(fs.readFileSync(path.join(__dirname, '../../res/windows/menu.js'), 'utf8')
    .indexOf('profiles.launch') !== -1);
});
