// The bot engine's injected game interface (ticket #37, spec #19 Seam 4). Every path asserted
// below is what the reference client's OWN loader body reads for the call of the same name; the
// decompiled loader is the authority - grimoire/game/Player.as and grimoire/game/World.as - so the
// expected path comes from there, not from this module.
const assert = require('assert');

const sessionModel = require('../../plugins/grimlite-parity/bot/session.js');

// A stand-in for host.bridge. `answers` maps a dot-path (or a call path) to what the movie said;
// a value of `missing` makes the bridge report the game's own "no member" error for it.
function fakeBridge(answers) {
  const calls = [];
  return {
    calls: calls,
    attach: function () { calls.push({ name: 'attach', args: [] }); return Promise.resolve({ ok: true }); },
    call: function (name, args) {
      calls.push({ name: name, args: args });
      const key = args[0];
      if (Object.prototype.hasOwnProperty.call(answers, key)) {
        const answer = answers[key];
        if (answer === 'missing') {
          return Promise.resolve({ ok: false, error: 'no member ' + key.split('.').pop() + ' at ' + key });
        }
        if (answer && answer.bridgeError) return Promise.resolve({ ok: false, error: answer.bridgeError });
        return Promise.resolve({ ok: true, value: answer });
      }
      return Promise.resolve({ ok: true, value: 'null' });
    }
  };
}

test('IsLoggedIn maps to the socket the loader itself tests', async () => {
  // grimoire/game/Player.as: IsLoggedIn() = Root.Game.sfc != null && Root.Game.sfc.isConnected.
  // The bridge roots its paths at that same game object, so both halves of that expression are
  // one walk from it; reads go through `sfc.isConnected` rather than serialising the socket.
  const bridge = fakeBridge({ 'sfc.isConnected': 'true' });
  const session = sessionModel.createSession({ bridge: bridge });
  assert.strictEqual(await session.signedIn(), true);
  assert.strictEqual(bridge.calls[1].args[0], 'sfc.isConnected',
    'the loader reads Root.Game.sfc.isConnected');
});

test('a game with no socket is not signed in, and that is a no rather than an error', async () => {
  const session = sessionModel.createSession({ bridge: fakeBridge({ 'sfc.isConnected': 'missing' }) });
  assert.strictEqual(await session.signedIn(), false);

  // The bridge's walk answers null for a socket that is not there, which the loader guards
  // against with its own `sfc != null`.
  const nulled = sessionModel.createSession({ bridge: fakeBridge({ 'sfc.isConnected': 'null' }) });
  assert.strictEqual(await nulled.signedIn(), false, 'a null socket is nobody signed in');
});

test('a bridge that cannot attach is a refusal, not a no', async () => {
  const refusing = {
    attach: function () { return Promise.resolve({ ok: false, error: 'no game window' }); },
    call: function () { throw new Error('must not be called'); }
  };
  const session = sessionModel.createSession({ bridge: refusing });
  await assert.rejects(function () { return session.signedIn(); }, /no game window/);

  const absent = sessionModel.createSession({ bridge: null });
  await assert.rejects(function () { return absent.signedIn(); }, new RegExp(sessionModel.ERRORS.noChannel));
});

test('Health, HealthMax, Mana and ManaMax are the loader dataLeaf reads', async () => {
  // grimoire/game/Player.as: Health/HealthMax/Mana/ManaMax all read myAvatar.dataLeaf.int*.
  const bridge = fakeBridge({
    'world.myAvatar.dataLeaf.intHP': '1234',
    'world.myAvatar.dataLeaf.intHPMax': '2000',
    'world.myAvatar.dataLeaf.intMP': '77',
    'world.myAvatar.dataLeaf.intMPMax': '90'
  });
  const session = sessionModel.createSession({ bridge: bridge });
  assert.strictEqual(await session.health(), 1234);
  assert.strictEqual(await session.healthMax(), 2000);
  assert.strictEqual(await session.mana(), 77);
  assert.strictEqual(await session.manaMax(), 90);
  assert.deepStrictEqual(bridge.calls.filter(function (c) { return c.name === 'getGameObject'; })
    .map(function (c) { return c.args[0]; }), [
      'world.myAvatar.dataLeaf.intHP',
      'world.myAvatar.dataLeaf.intHPMax',
      'world.myAvatar.dataLeaf.intMP',
      'world.myAvatar.dataLeaf.intMPMax'
    ]);
});

test('IsAlive is Health above zero, the loader own comparison', async () => {
  // grimoire/game/Player.as: IsAlive = Health > 0, and Health is the intHP read.
  const alive = sessionModel.createSession({
    bridge: fakeBridge({ 'world.myAvatar.dataLeaf.intHP': '1' })
  });
  assert.strictEqual(await alive.alive(), true);

  const dead = sessionModel.createSession({
    bridge: fakeBridge({ 'world.myAvatar.dataLeaf.intHP': '0' })
  });
  assert.strictEqual(await dead.alive(), false);
});

test('a health the game did not answer as a number is reported, not read as zero', async () => {
  const session = sessionModel.createSession({
    bridge: fakeBridge({ 'world.myAvatar.dataLeaf.intHP': '"dead"' })
  });
  await assert.rejects(function () { return session.health(); }, /not a number/);
});

test('SetSpawnPoint calls the game the way the loader body calls it', async () => {
  // grimoire/game/World.as: setSpawnPoint(world.strFrame, world.strPad). The arguments are the
  // cell and pad, which is what the loader passes rather than a point of its own.
  const bridge = fakeBridge({ 'world.setSpawnPoint': 'undefined' });
  const session = sessionModel.createSession({ bridge: bridge });
  await session.setSpawnPoint();
  const call = bridge.calls.filter(function (c) { return c.name === 'callGameFunction0'; })[0];
  assert.deepStrictEqual(call.args, ['world.setSpawnPoint']);
});

test('Rest and exit-combat are the loader own game calls too', async () => {
  const bridge = fakeBridge({ 'world.rest': 'undefined', 'world.cancelTarget': 'undefined' });
  const session = sessionModel.createSession({ bridge: bridge });
  await session.rest();
  await session.exitCombat();
  const paths = bridge.calls.filter(function (c) { return c.name.indexOf('callGameFunction') === 0; })
    .map(function (c) { return c.args[0]; });
  assert.deepStrictEqual(paths, ['world.rest', 'world.cancelTarget']);
});

test('ready follows the game own map-load flag, which is what MapLoadComplete tests first', async () => {
  // grimoire/game/World.as: MapLoadComplete() returns False while world.mapLoadInProgress.
  const loading = sessionModel.createSession({ bridge: fakeBridge({ 'world.mapLoadInProgress': 'true' }) });
  assert.strictEqual(await loading.ready(), false, 'a map in flight is not ready');

  const loaded = sessionModel.createSession({ bridge: fakeBridge({ 'world.mapLoadInProgress': 'false' }) });
  assert.strictEqual(await loaded.ready(), true);
});

test('a game with no map-load flag is ready, which is what the loader treats null as', async () => {
  const session = sessionModel.createSession({ bridge: fakeBridge({ 'world.mapLoadInProgress': 'missing' }) });
  assert.strictEqual(await session.ready(), true);
});

test('the character name comes from the path the loader reads for Player.Username', async () => {
  const bridge = fakeBridge({ 'world.myAvatar.objData.strUsername': '"Arthas"' });
  const session = sessionModel.createSession({ bridge: bridge });
  assert.strictEqual(await session.username(), 'Arthas');
  assert.strictEqual(bridge.calls[1].args[0], 'world.myAvatar.objData.strUsername');
});

test('a name that cannot be read leaves {PLAYERNAME} empty and logs it, not a failed run', async () => {
  const lines = [];
  const session = sessionModel.createSession({
    bridge: fakeBridge({ 'world.myAvatar.objData.strUsername': 'missing' }),
    log: function (line) { lines.push(line); }
  });
  assert.strictEqual(await session.username(), '');
  assert.ok(lines.some(function (l) { return /name could not be read/.test(l); }), lines.join('|'));
});

test('every loader body the session relies on is recorded with its source', () => {
  // The module states what each reference name translates to, so a reader can check it against
  // the decompiled loader rather than trusting this file.
  const bodies = sessionModel.LOADER_BODIES;
  ['IsLoggedIn', 'Health', 'HealthMax', 'SetSpawnPoint', 'Rest', 'Logout', 'MapLoadComplete']
    .forEach(function (name) {
      assert.ok(bodies[name], name + ' has no recorded body');
      assert.ok(bodies[name].body, name + ' records no body');
    });
  assert.ok(/isConnected/.test(bodies.IsLoggedIn.body));
  assert.ok(/setSpawnPoint/.test(bodies.SetSpawnPoint.body));
});

test('a socket that exists but is not connected is nobody signed in', async () => {
  // grimoire/game/Player.as: IsLoggedIn is `Root.Game.sfc != null && Root.Game.sfc.isConnected
  // == true`. A socket object that is still in the game but has dropped its connection is exactly
  // the state a disconnect leaves behind, so reading only `sfc` would report a dropped session as
  // a live one and the bot's own auto-relogin branch would never run.
  const bridge = fakeBridge({ sfc: '[object Socket]', 'sfc.isConnected': 'false' });
  const session = sessionModel.createSession({ bridge: bridge });
  assert.strictEqual(await session.signedIn(), false);
  assert.strictEqual(bridge.calls[1].args[0], 'sfc.isConnected',
    'the second half of the loader body is what decides it');

  const live = fakeBridge({ sfc: '[object Socket]', 'sfc.isConnected': 'true' });
  assert.strictEqual(await sessionModel.createSession({ bridge: live }).signedIn(), true);
});

test('a number the game did not answer is a refusal, not a zero', async () => {
  // A null read means the path did not resolve (no avatar yet, a map in flight). Reporting that
  // as 0 HP would look like a death and send the bot down its respawn branch over a reload.
  const bridge = fakeBridge({ sfc: 'true', 'sfc.isConnected': 'true' });
  const session = sessionModel.createSession({ bridge: bridge });
  await assert.rejects(function () { return session.health(); }, /not a number|did not/);
});

test('a window that is gone is a refusal that says so, not a transient pause', async () => {
  // The platform's bridge channel answers `no game window` when the window it was attached to is
  // gone (res/platform/bridge-channel.js). A bot has to tell that apart from a map still loading:
  // the first ends that window's bot, the second is a pause. The reason is carried on the error.
  const refusing = {
    attach: function () { return Promise.resolve({ ok: false, error: 'no game window' }); },
    call: function () { return Promise.resolve({ ok: false, error: 'no game window' }); }
  };
  const session = sessionModel.createSession({ bridge: refusing });
  await assert.rejects(function () { return session.ready(); }, function (error) {
    return error.windowGone === true;
  });
  await assert.rejects(function () { return session.signedIn(); }, function (error) {
    return error.windowGone === true;
  });
});
