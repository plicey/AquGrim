// Quick login and auto-relogin (#35). The reference is Grimlite-Li: the char list is read out of
// CharSelect.cfg (Grimoire/UI/Root.cs:131-177), the menu item carrying it is hidden until a
// connection drops (Root.cs:167, driven from Grimlite/Tools/Flash.cs:400-409), and one click on an
// entry calls AutoRelogin.Login(user, pass) -> Flash.Call("FixLogin", user, pass)
// (Root.cs:170-178, Grimoire/Tools/AutoRelogin.cs:26-29). The expected values below come from that
// C# source, not from the code under test.
//
// The spec's Out of Scope is not optional here: the reference keeps those passwords in a plaintext
// .cfg and this port holds them in session memory instead, so the tests below also pin the
// "nothing reaches the disk" half of the acceptance criteria.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const model = require('../../plugins/grimlite-parity/features/login/login-model.js');

const pluginRoot = path.join(__dirname, '../../plugins/grimlite-parity');

// The page's own promises resolve on the microtask queue; one macrotask hop is enough to let every
// `.then` in the page settle before a test reads what it drew.
function settled() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function storeWith(entries) {
  const store = model.createCredentialStore();
  (entries || []).forEach(function (entry) { store.add(entry[0], entry[1]); });
  return store;
}

// A stand-in for the plugin's game access (../../bridge.js): records the named calls and answers
// the way the SWF does, so the sign-in path is checked without Flash.
function fakeGame(answers) {
  const calls = [];
  return {
    calls: calls,
    call: function (name, args) {
      calls.push({ name: name, args: args || [] });
      const answer = (answers || {})[name];
      if (answer && answer.reject) return Promise.reject(new Error(answer.reject));
      return Promise.resolve(answer === undefined ? null : answer);
    }
  };
}

// The reference's Config.Load/Get walk (Grimoire/Botting/Config.cs:38-72): keys are "0", "1", ...
// and the loop stops at the first index the file does not define.
test('a CharSelect.cfg the reference wrote is read back as its characters, in file order', () => {
  assert.deepStrictEqual(
    model.parseCredentialsFile('0=first,pass1\n1=second,pass2\n'),
    [{ username: 'first', password: 'pass1' }, { username: 'second', password: 'pass2' }]
  );
  // Windows line endings, and a password that itself carries a comma: the reference splits on the
  // first comma and keeps the rest as the password (Root.cs:147-149).
  assert.deepStrictEqual(
    model.parseCredentialsFile('0=user,pa,ss\r\n'),
    [{ username: 'user', password: 'pa,ss' }]
  );
});

// Root.cs catches the parse failure and stops reading (its `catch { i = -1; }`): a file whose
// first key is not 0, or a value with no comma, contributes the entries before it and no more.
test('a credentials file the reference would stop reading stops at the same point here', () => {
  assert.deepStrictEqual(model.parseCredentialsFile('1=second,pass2\n'), []);
  assert.deepStrictEqual(
    model.parseCredentialsFile('0=first,pass1\n1=nocomma\n2=third,pass3\n'),
    [{ username: 'first', password: 'pass1' }]
  );
  assert.deepStrictEqual(model.parseCredentialsFile(''), []);
  assert.deepStrictEqual(model.parseCredentialsFile(null), []);
});

test('a saved character is listed, and the list never hands its password back', () => {
  const store = storeWith([['first', 'pass1']]);
  const list = store.list();

  assert.deepStrictEqual(list, [{ username: 'first' }]);
  assert.strictEqual(JSON.stringify(list).indexOf('pass1'), -1, 'a listed character carries no secret');
  // The password is reachable only through the one call that signs in.
  assert.deepStrictEqual(store.credentialFor('first'), { username: 'first', password: 'pass1' });
  assert.strictEqual(store.credentialFor('nobody'), null);
});

// Root.cs's own item click matches by username, so a second entry for the same account would make
// which one a click signs in with depend on list order. One entry per username instead.
test('adding the same character twice replaces it rather than shadowing it', () => {
  const store = storeWith([['first', 'old'], ['second', 'pass2']]);
  store.add('first', 'new');

  assert.deepStrictEqual(store.list(), [{ username: 'first' }, { username: 'second' }]);
  assert.strictEqual(store.credentialFor('first').password, 'new');
});

test('removing a character removes its credentials from memory', () => {
  const store = storeWith([['first', 'pass1'], ['second', 'pass2']]);

  assert.deepStrictEqual(store.remove('first'), { removed: true });
  assert.deepStrictEqual(store.list(), [{ username: 'second' }]);
  assert.strictEqual(store.credentialFor('first'), null);
  // Nothing survives anywhere else in the store either: a removed password is not merely hidden.
  assert.strictEqual(
    store.snapshot().some(function (entry) { return entry.password === 'pass1'; }),
    false
  );
  assert.deepStrictEqual(store.remove('nobody'), { removed: false });
});

// The one structural claim the "credentials are not written to disk" criterion makes: the module
// that holds them has no way to write anything. The session-memory contract is a property of the
// shipped source, so it is checked on the shipped source.
test('the module holding the credentials cannot reach the disk', () => {
  const source = fs.readFileSync(path.join(pluginRoot, 'features/login/login-model.js'), 'utf8');
  ['fs', 'writeFile', 'electron', 'getStore', 'localStorage', 'appDataDirectory'].forEach(function (reach) {
    assert.strictEqual(source.indexOf(reach), -1, 'the credential module must not reach for ' + reach);
  });
});

// AutoRelogin.Login(user, pass) is one Flash call: Flash.Call("FixLogin", username, password)
// (Grimoire/Tools/AutoRelogin.cs:26-29), and the bot's own relogin uses the same one.
test('one click signs a character in through the reference own call, with no retyping', async () => {
  const game = fakeGame();
  const store = storeWith([['first', 'pass1']]);

  const result = await model.signIn(game, store, 'first');

  assert.deepStrictEqual(game.calls, [{ name: 'FixLogin', args: ['first', 'pass1'] }]);
  assert.deepStrictEqual(result, { signedIn: true, username: 'first', error: null });
  // The password crossed exactly once, to the game, and was not returned to the caller.
  assert.strictEqual(JSON.stringify(result).indexOf('pass1'), -1);
});

test('a character nobody saved is reported rather than signed in as somebody', async () => {
  const game = fakeGame();
  const result = await model.signIn(game, storeWith([]), 'ghost');

  assert.strictEqual(result.signedIn, false);
  assert.ok(result.error, 'an unknown character must say so');
  assert.deepStrictEqual(game.calls, [], 'nothing is sent for a character that is not held');
});

// FixLogin exists only in the reference's own loader: the stock game's ABC string pool has no such
// entry (checked against /var/tmp/aq-origin/game.swf; the loader's does). A refusal has to name the
// thing it is waiting for instead of looking like a failed password.
test('a refusal the game cannot answer names the helper it waits for', async () => {
  const game = fakeGame({ FixLogin: { reject: 'no member FixLogin at world' } });
  const result = await model.signIn(game, storeWith([['first', 'pass1']]), 'first');

  assert.strictEqual(result.signedIn, false);
  assert.ok(
    result.error.indexOf('no member FixLogin at world') !== -1,
    'the game own words are kept: ' + result.error
  );
  assert.ok(
    result.error.indexOf(model.ERRORS.loaderSurface('FixLogin')) !== -1,
    'the reason the name cannot answer is added: ' + result.error
  );
  assert.ok(/48/.test(result.error), 'and it names the ticket that unblocks it');
});

// Flash.cs:400-409: OnConnectionLost -> LoadCharSelect (visible), OnConnection -> HideCharSelect.
// Root_Load calls LoadCharSelect too (Root.cs:115), so the list starts visible and only a
// confirmed connection hides it.
test('the list shows when the connection drops and hides when it is established', () => {
  let answer = { connected: false };
  const seen = [];
  const watch = model.createConnectionWatch({
    read: function () { return Promise.resolve(answer); },
    onChange: function (state) { seen.push(state); }
  });

  assert.strictEqual(watch.visible(), true, 'it starts shown, as the reference loads it at startup');
  return watch.poll()
    .then(function () {
      assert.strictEqual(watch.state(), model.STATES.lost);
      assert.strictEqual(watch.visible(), true);
      answer = { connected: true };
      return watch.poll();
    })
    .then(function () {
      assert.strictEqual(watch.state(), model.STATES.connected);
      assert.strictEqual(watch.visible(), false, 'an established connection hides the list');
      answer = { connected: false };
      return watch.poll();
    })
    .then(function () {
      // Hidden on connect, shown again on the next drop: the transition is the trigger, and it
      // keeps firing every time the session drops.
      assert.deepStrictEqual(seen, [model.STATES.lost, model.STATES.connected, model.STATES.lost]);
    });
});

// A read that cannot answer is not a drop: the reference's own menu item stays as it was rather
// than flipping on a call that failed for its own reasons.
test('a connection read that cannot answer changes nothing and keeps the list usable', async () => {
  let answer = { connected: true };
  const watch = model.createConnectionWatch({
    read: function () { return Promise.resolve(answer); }
  });

  await watch.poll();
  assert.strictEqual(watch.visible(), false);

  answer = { connected: null, error: 'no member sfc at world' };
  await watch.poll();
  assert.strictEqual(watch.state(), model.STATES.unknown);
  assert.strictEqual(watch.visible(), true, 'with no answer the list is there to be used');

  // A reader that throws is the same as one that cannot answer, not a state to show as a drop.
  const throwing = model.createConnectionWatch({
    read: function () { throw new Error('the bridge is not attached'); }
  });
  await throwing.poll();
  assert.strictEqual(throwing.state(), model.STATES.unknown);
  assert.strictEqual(throwing.visible(), true);
});

// The rest of the reference's relogin sequence (AutoRelogin.cs:37-120) waits on loader-only names.
// They are pinned by name so the port cannot quietly pretend it performs them.
test('the relogin helpers this app still owes are named, and none of them is claimed as working', () => {
  ['FixLogin', 'ResetServers', 'AreServersLoaded', 'IsTemporarilyKicked', 'IsLoggedIn',
    'GetUsername', 'GetPassword'].forEach(function (name) {
    assert.strictEqual(
      model.LOADER_ONLY[name],
      true,
      name + ' exists only in the reference loader and must be reported as such'
    );
  });
  // Every name the module actually calls is one it also declares, so the list cannot drift.
  assert.strictEqual(model.LOGIN_CALLS.signIn, 'FixLogin');
  assert.ok(model.LOADER_ONLY[model.LOGIN_CALLS.signIn], 'the sign-in call is a declared loader name');
});

// The two literals the window shows, so "where are my credentials held" is answered by the UI and
// not only by this file.
test('the model says where credentials are held and what expiry means', () => {
  assert.ok(/memory/i.test(model.HELD_IN), 'the notice must name the holding place');
  assert.ok(/session/i.test(model.HELD_IN), 'and that it lasts for the session');
  assert.ok(/disk|file/i.test(model.HELD_IN), 'and that no file is written');
});

// ---- the window's own half (#35) ----
const loginWindow = require('../../plugins/grimlite-parity/features/login/login-window.js');
const loginMain = require('../../plugins/grimlite-parity/features/login/login-main.js');

// The window's channels, exactly as the page drives them (the preload in this feature).
function openWindow(deps) {
  const handled = {};
  const window = loginWindow.createLoginWindow(Object.assign({
    store: model.createCredentialStore(),
    messages: {},
    tap: function () {},
    host: { ipc: { handle: function (channel, listener) { handled[channel] = listener; } } }
  }, deps || {}));
  window.attach();
  return { window: window, handled: handled };
}

test('the window lists what is saved, adds a character and signs it in on one click', async () => {
  const game = fakeGame();
  const opened = openWindow({ game: game });

  assert.deepStrictEqual((await opened.handled.loginList()).characters, []);
  const added = await opened.handled.loginAdd({}, 'first', 'pass1');
  assert.strictEqual(added.added, true);
  assert.deepStrictEqual(added.characters, [{ username: 'first' }]);

  const result = await opened.handled.loginSignIn({}, 'first');
  assert.strictEqual(result.signedIn, true);
  assert.deepStrictEqual(game.calls, [{ name: 'FixLogin', args: ['first', 'pass1'] }]);
  // Nothing the page can ask for hands it the password back.
  assert.strictEqual(JSON.stringify(await opened.handled.loginList()).indexOf('pass1'), -1);
});

test('the window will not save a character with no name', async () => {
  const opened = openWindow({});
  const result = await opened.handled.loginAdd({}, '   ', 'pass1');

  assert.strictEqual(result.added, false);
  assert.deepStrictEqual((await opened.handled.loginList()).characters, []);
});

// Acceptance criterion 4: the UI states where they are held. The window answers with the notice
// itself, so the page draws what the model says rather than a string of its own.
test('the window tells the user where the credentials are held', async () => {
  const opened = openWindow({});
  const listing = await opened.handled.loginList();

  assert.strictEqual(listing.heldIn, model.HELD_IN);
  assert.ok(/memory/i.test(listing.heldIn));
  assert.ok(/nothing is written/i.test(listing.heldIn));
});

test('removing from the window takes the password with it', async () => {
  const opened = openWindow({});
  await opened.handled.loginAdd({}, 'first', 'pass1');
  const removed = await opened.handled.loginRemove({}, 'first');

  assert.strictEqual(removed.removed, true);
  assert.deepStrictEqual(removed.characters, []);
  assert.strictEqual(opened.window.store.credentialFor('first'), null);
});

// The user's own CharSelect.cfg is the user's file: this reads it, and offers no way to write one.
test('the reference own credentials file can be read, and is never written', async () => {
  const reads = [];
  const opened = openWindow({
    readCredentialsFile: function () {
      reads.push(1);
      return Promise.resolve({ text: '0=first,pass1\n1=second,pass2\n', error: null });
    }
  });

  const imported = await opened.handled.loginImport({});
  assert.strictEqual(imported.imported, 2);
  assert.deepStrictEqual(imported.characters, [{ username: 'first' }, { username: 'second' }]);
  assert.strictEqual(reads.length, 1);
});

test('a credentials file that cannot be read reports why and imports nothing', async () => {
  const opened = openWindow({
    readCredentialsFile: function () { return Promise.resolve({ text: null, error: 'ENOENT' }); }
  });
  const imported = await opened.handled.loginImport({});

  assert.strictEqual(imported.imported, 0);
  assert.ok(/ENOENT/.test(imported.error), imported.error);
});

// The window follows the session: the state is pushed to it, and the reference's own rule applies
// (Root.cs:167 hides it on a connection; Flash.cs:407-409 shows it on a loss).
test('a dropped connection shows the list, and a restored one hides it', async () => {
  let answer = { connected: true };
  const opened = openWindow({ readConnection: function () { return Promise.resolve(answer); } });
  const pushed = [];
  const watch = opened.window.startWatching(function (state) { pushed.push(state); });

  await watch.poll();
  assert.deepStrictEqual(pushed, [model.STATES.connected]);
  answer = { connected: false };
  await watch.poll();
  assert.deepStrictEqual(pushed, [model.STATES.connected, model.STATES.lost]);
});

// The main-process wiring: the credentials file path is the user's own application directory, and
// the connection read goes through the plugin's game access rather than Flash.
test('the feature reads the user own CharSelect.cfg and never names a write', () => {
  const source = fs.readFileSync(
    path.join(pluginRoot, 'features/login/login-main.js'),
    'utf8'
  );
  assert.ok(source.indexOf(model.CREDENTIALS_FILE) !== -1, 'it reads the reference own file name');
  ['writeFile', 'writeFileSync', 'appendFile', 'createWriteStream', 'mkdir'].forEach(function (write) {
    assert.strictEqual(source.indexOf(write), -1, 'it must not be able to ' + write);
  });
});

test('the connection read asks the game, and an answer it cannot give is unknown', async () => {
  const asked = [];
  const read = loginMain.connectionReader({
    call: function (name, args) {
      asked.push({ name: name, args: args });
      // The bridge hands back what the dot-path holds, so a connected session answers `true`.
      return Promise.resolve(true);
    }
  });

  assert.deepStrictEqual(await read(), { connected: true });
  // A dot-path read on the game, not a loader name: the game's own pool carries sfc/isConnected.
  assert.strictEqual(asked[0].name, 'getGameObject');
  assert.deepStrictEqual(asked[0].args, [loginMain.CONNECTION_PATH]);
  // The path is the game's own chain, spelled as the shipped SWF spells it.
  assert.strictEqual(loginMain.CONNECTION_PATH, 'world.sfc.isConnected');

  const broken = loginMain.connectionReader({
    call: function () { return Promise.reject(new Error('no member sfc at world')); }
  });
  const answer = await broken();
  assert.strictEqual(answer.connected, null);
  assert.ok(answer.error, 'a read that failed says so rather than reporting a drop');
});

// Criterion 2's other half: the list appears on its own when the connection drops, because the
// reference's list is a menu item that becomes visible at exactly that moment (Flash.cs:407-409).
// The timer is injected so no test starts a real one.
test('a drop opens the list by itself, and a live connection pushes the hidden state through', async () => {
  let answer = { connected: true };
  let tick = null;
  let opened = 0;
  const pushed = [];
  const opened2 = openWindow({ readConnection: function () { return Promise.resolve(answer); } });

  const session = opened2.window.startSessionWatch({
    every: function (fn) { tick = fn; return { unref: function () {} }; },
    cancel: function () {},
    open: function () { opened++; },
    push: function (state) { pushed.push(state); }
  });

  // Nothing opens while the session is up.
  await tick();
  assert.strictEqual(opened, 0);

  // Nor on a state nothing could answer: auto-opening there would put a window in front of every
  // user whose connection is in fact fine, because that is the state this app is in until the
  // connection read is confirmed against a live client.
  answer = { connected: null, error: 'no member sfc at world' };
  await tick();
  assert.strictEqual(opened, 0, 'an unverified read must not open a window by itself');

  answer = { connected: false };
  await tick();
  assert.strictEqual(opened, 1, 'a dropped session brings the list up');
  // What the window is handed is state and visibility together, so the page can draw either.
  assert.deepStrictEqual(pushed, [
    { state: model.STATES.connected, visible: false },
    { state: model.STATES.unknown, visible: true },
    { state: model.STATES.lost, visible: true }
  ]);

  // and it does not keep reopening a list that is already up.
  await tick();
  assert.strictEqual(opened, 1);

  // A reconnect arms the next drop: the reference's entry comes back on every loss, not once.
  answer = { connected: true };
  await tick();
  answer = { connected: false };
  await tick();
  assert.strictEqual(opened, 2, 'a later disconnect opens the list again');
  session.stop();
});

// The read that decides all of the above cannot be verified offline: the stock game's ABC pool
// carries sfc and isConnected, but a pool entry is not proof of a callable member. The path is
// therefore pinned here as this port's best-evidenced guess and reported unverified in
// docs/FLASH_CHECKLIST.md, and the states it does not answer leave the list visible.
test('the connection path this port reads is pinned, and no verified call is claimed for it', () => {
  assert.strictEqual(loginMain.CONNECTION_PATH, 'world.sfc.isConnected');
  const source = fs.readFileSync(path.join(pluginRoot, 'features/login/login-main.js'), 'utf8');
  assert.ok(/unverified|not proof/i.test(source), 'the source must say the read is unverified');
});

// Criterion 4 is a claim about the whole plugin, not just this window: nothing this feature ships
// may reach a store, a file write or an app-data path with a credential in hand.
test('no file in this feature can write anything to disk', () => {
  const files = ['login-model.js', 'login-window.js', 'login-main.js', 'preload_login.js', 'login.html'];
  files.forEach(function (name) {
    const source = fs.readFileSync(path.join(pluginRoot, 'features/login', name), 'utf8');
    ['writeFileSync', 'writeFile(', 'appendFileSync', 'createWriteStream'].forEach(function (write) {
      assert.strictEqual(source.indexOf(write), -1, name + ' must not write to disk (' + write + ')');
    });
  });
});

// The login page's own wiring (#35), driven against a small stand-in for the DOM with the preload
// replaced by a recorder - the same harness the Bank and Sets pages use. It catches element ids,
// the calls the page makes and their arguments; the rendering stays on docs/FLASH_CHECKLIST.md.
function domElement() {
  let text = '';
  const el = {
    children: [], listeners: {}, className: '', value: '', placeholder: '',
    appendChild: function (child) { el.children.push(child); return child; },
    addEventListener: function (type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); }
  };
  // Setting textContent empties the element, as the real DOM does: the page redraws its list by
  // clearing the list first, and a stand-in that merely overwrote the string would stack the rows.
  Object.defineProperty(el, 'textContent', {
    get: function () { return text; },
    set: function (next) { text = String(next); el.children.length = 0; }
  });
  return el;
}

function clickElement(el) {
  (el.listeners.click || []).forEach(function (fn) { fn({}); });
}

function loadLoginPage(bridge) {
  const file = path.join(pluginRoot, 'features/login/login.html');
  const source = fs.readFileSync(file, 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(source);
  assert.ok(script, 'the login page has no inline script');

  const ids = ['root', 'title', 'savedHeading', 'list', 'username', 'password', 'add', 'import',
    'notice', 'status'];
  const byId = {};
  ids.forEach(function (id) { byId[id] = domElement(); });
  const document = {
    title: '',
    getElementById: function (id) {
      assert.ok(byId[id], 'the login page asks for a #' + id + ' that does not exist');
      return byId[id];
    },
    createElement: function () { return domElement(); }
  };
  vm.runInNewContext(script[1], { window: { aquastarLogin: bridge }, document: document });
  return { byId: byId, document: document };
}

test('the login page draws the saved characters and names its controls', async () => {
  const page = loadLoginPage({
    getMessages: function () {
      return Promise.resolve({
        title: 'Char Select', savedHeading: 'Saved characters', add: 'Add',
        importFile: 'Read CharSelect.cfg', signIn: 'Sign in', remove: 'Remove',
        usernamePlaceholder: 'Username', passwordPlaceholder: 'Password'
      });
    },
    getList: function () {
      return Promise.resolve({
        characters: [{ username: 'first' }],
        heldIn: 'Held in memory for this session; nothing is written to a file.'
      });
    },
    signIn: function () { return Promise.resolve({ signedIn: true, username: 'first' }); },
    remove: function () { return Promise.resolve({ removed: true, characters: [] }); },
    importFile: function () { return Promise.resolve({ imported: 0 }); },
    onConnection: function () {}
  });
  await settled();

  assert.strictEqual(page.byId.title.textContent, 'Char Select');
  assert.strictEqual(page.byId.savedHeading.textContent, 'Saved characters');
  assert.strictEqual(page.byId.add.textContent, 'Add');
  assert.strictEqual(page.byId.import.textContent, 'Read CharSelect.cfg');
  assert.strictEqual(page.byId.username.placeholder, 'Username');
  assert.strictEqual(page.byId.password.placeholder, 'Password');
  assert.strictEqual(
    page.byId.notice.textContent,
    'Held in memory for this session; nothing is written to a file.'
  );
  // One saved character is one row carrying its username and a Sign in control.
  assert.strictEqual(page.byId.list.children.length, 1);
  const row = page.byId.list.children[0];
  assert.strictEqual(row.children[0].textContent, 'first');
  assert.strictEqual(row.children[1].textContent, 'Sign in');
});

// Root_Load reads CharSelect.cfg at startup. The window does the same read once on activation,
// silently: a first run with no file is not an error the user needs to see.
test('the credentials file is read at startup, and a missing one is silent', async () => {
  const reads = [];
  const opened = openWindow({
    readCredentialsFile: function () {
      reads.push(1);
      return Promise.resolve({'text': '0=first,pass1\n1=second,pass2\n', error: null});
    }
  });
  const imported = await opened.window.autoImport();
  assert.strictEqual(imported.imported, 2);
  assert.deepStrictEqual((await opened.handled.loginList()).characters,
    [{ username: 'first' }, { username: 'second' }]);

  const missing = openWindow({
    readCredentialsFile: function () { return Promise.resolve({ text: null, error: 'ENOENT' }); }
  });
  assert.deepStrictEqual(await missing.window.autoImport(), { imported: 0, error: null });
  assert.deepStrictEqual((await missing.handled.loginList()).characters, []);
});

// Usernames outlive the process; passwords do not. A name loaded from the store has no password
// until the user types one again, and signing in says so instead of sending an empty one.
test('usernames persist without passwords, and a name with no password cannot sign in', async () => {
  const saved = { usernames: [] };
  const names = {
    readOrCreate: function () { return saved; },
    write: function (state) { saved.usernames = state.usernames.slice(); }
  };
  const first = openWindow({ store: model.createCredentialStore(), names: names });
  await first.handled.loginAdd({}, 'first', 'pass1');
  assert.deepStrictEqual(saved.usernames, ['first']);
  assert.strictEqual(JSON.stringify(saved).indexOf('pass1'), -1, 'no password reaches the store');

  const game = fakeGame();
  const second = openWindow({ store: model.createCredentialStore(), names: names, game: game });
  assert.deepStrictEqual((await second.handled.loginList()).characters, [{ username: 'first' }]);
  const refused = await second.handled.loginSignIn({}, 'first');
  assert.strictEqual(refused.signedIn, false);
  assert.strictEqual(refused.error, model.ERRORS.noPassword);
  assert.deepStrictEqual(game.calls, []);

  await second.handled.loginAdd({}, 'first', 'pass2');
  assert.strictEqual((await second.handled.loginSignIn({}, 'first')).signedIn, true);
  assert.deepStrictEqual(game.calls, [{ name: 'FixLogin', args: ['first', 'pass2'] }]);
  assert.deepStrictEqual(saved.usernames, ['first'], 're-adding a name does not duplicate it');
});

test('clicking Sign in on a row hands the page that one username and draws the answer', async () => {
  const signedIn = [];
  const page = loadLoginPage({
    getMessages: function () { return Promise.resolve({ signIn: 'Sign in', signingIn: 'Signing in as {user}...' }); },
    getList: function () { return Promise.resolve({ characters: [{ username: 'first' }], heldIn: 'memory' }); },
    signIn: function (username) {
      signedIn.push(username);
      return Promise.resolve({ signedIn: false, username: username, error: 'no member FixLogin at world' });
    },
    remove: function () { return Promise.resolve({ characters: [] }); },
    importFile: function () { return Promise.resolve({}); },
    onConnection: function () {}
  });
  await settled();

  clickElement(page.byId.list.children[0].children[1]);
  await settled();

  assert.deepStrictEqual(signedIn, ['first']);
  // A refusal is shown with the game's own words, not swallowed: an unverified helper must not
  // look like a wrong password.
  assert.strictEqual(page.byId.status.textContent, 'no member FixLogin at world');
  assert.strictEqual(page.byId.status.className, 'error');
});

// The reference hides the list while connected and shows it again on every drop; the page follows
// the pushed state rather than leaving a dead list in front of a live session.
test('the page hides while connected and shows itself on every disconnect', async () => {
  let push = null;
  const page = loadLoginPage({
    getMessages: function () { return Promise.resolve({}); },
    getList: function () { return Promise.resolve({ characters: [], heldIn: '' }); },
    signIn: function () { return Promise.resolve({}); },
    remove: function () { return Promise.resolve({}); },
    importFile: function () { return Promise.resolve({}); },
    onConnection: function (callback) { push = callback; }
  });
  await settled();

  push({ state: 'connected', visible: false });
  assert.strictEqual(page.byId.root.hidden, true);
  push({ state: 'lost', visible: true });
  assert.strictEqual(page.byId.root.hidden, false);
  push({ state: 'connected', visible: false });
  assert.strictEqual(page.byId.root.hidden, true);
  push({ state: 'lost', visible: true });
  assert.strictEqual(page.byId.root.hidden, false, 'a second drop shows it again');
});

test('reading the reference own file reports how many characters came in', async () => {
  const page = loadLoginPage({
    getMessages: function () { return Promise.resolve({ imported: 'Imported {count} character(s).' }); },
    getList: function () { return Promise.resolve({ characters: [], heldIn: 'memory' }); },
    signIn: function () { return Promise.resolve({}); },
    remove: function () { return Promise.resolve({}); },
    importFile: function () {
      return Promise.resolve({ imported: 2, characters: [{ username: 'a' }, { username: 'b' }], error: null });
    },
    onConnection: function () {}
  });
  await settled();

  clickElement(page.byId.import);
  await settled();

  assert.strictEqual(page.byId.status.textContent, 'Imported 2 character(s).');
  assert.strictEqual(page.byId.list.children.length, 2);
});

// Criterion 4's other half, from the page's side: even if a password reached the page it would have
// nowhere to show it, and the one call the page makes that touches credentials takes a username
// only. Driven rather than grepped: the list is handed a character object that does carry a
// password, and the page must neither draw it nor pass it on.
test('the login page draws usernames only, even when it is handed more', async () => {
  const args = [];
  const page = loadLoginPage({
    getMessages: function () { return Promise.resolve({ signIn: 'Sign in' }); },
    getList: function () {
      return Promise.resolve({ characters: [{ username: 'first', password: 'pass1' }], heldIn: 'memory' });
    },
    signIn: function () {
      args.push(Array.prototype.slice.call(arguments));
      return Promise.resolve({ signedIn: true, username: 'first' });
    },
    remove: function () { return Promise.resolve({ characters: [] }); },
    importFile: function () { return Promise.resolve({}); },
    onConnection: function () {}
  });
  await settled();

  // What the row draws is the username and the two controls - never the field it was also given.
  const row = page.byId.list.children[0];
  const drawn = row.children.map(function (child) { return child.textContent; }).join('|');
  assert.strictEqual(drawn, 'first|Sign in|Remove');

  clickElement(row.children[1]);
  await settled();
  assert.deepStrictEqual(args, [['first']], 'the one-click call carries a username and nothing else');

  // And the only password the page handles is the one the user types into its own input.
  const source = fs.readFileSync(path.join(pluginRoot, 'features/login/login.html'), 'utf8');
  const reads = source.match(/\.password\b/g) || [];
  assert.deepStrictEqual(reads, [], 'no credential object is ever read for a password');
});
