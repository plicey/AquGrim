// The bot engine's injected game interface (ticket #37, spec #19 Seam 4). Expected values come
// from the reference client's OWN decompiled loader - grimoire/game/Player.as and World.as - which
// is the authority for what each helper name means. The path each helper body reads lives in the
// loader surface table (loader-surface.js, ticket #48), and this module asks for the names rather
// than repeating that table.
//
// So what this file asserts is the session's own contract: which names it asks for, what it does
// with the answers, and what it does when there is no answer at all.
const assert = require('assert');

const sessionModel = require('../../plugins/grimlite-parity/bot/session.js');
const surface = require('../../plugins/grimlite-parity/loader-surface.js');

// The loader surface as the bridge exposes it: answers per the reference's own helper name, and a
// name the surface does not implement refuses the way the real one does - naming the ticket that
// owns the gap rather than inventing a value.
function fakeBridge(answers) {
  const asked = [];
  const calls = [];
  return {
    asked: function () { return asked; },
    calls: calls,
    attach: function () { calls.push({ name: 'attach', args: [] }); return Promise.resolve({ ok: true }); },
    loaderCall: function (name, args) {
      asked.push(name);
      calls.push({ name: 'loaderCall', args: [name].concat(args || []) });
      if (Object.prototype.hasOwnProperty.call(answers, name)) {
        return Promise.resolve(answers[name]);
      }
      const row = surface.SURFACE[name];
      return Promise.reject(new Error('no helper named "' + name + '" is implemented: ' +
        ((row && row.why) || 'no row')));
    },
    // The two reads the session does itself, over the generic callbacks.
    call: function (name, args) {
      calls.push({ name: name, args: args });
      const key = args[0];
      if (Object.prototype.hasOwnProperty.call(answers, key)) {
        const answer = answers[key];
        if (answer === 'missing') {
          return Promise.resolve({ ok: false, error: 'no member ' + key.split('.').pop() + ' at ' + key });
        }
        return Promise.resolve({ ok: true, value: answer });
      }
      return Promise.resolve({ ok: true, value: 'null' });
    }
  };
}

test('IsLoggedIn is the helper the loader registers for exactly this question', async () => {
  // grimoire/game/Player.as: IsLoggedIn() = Root.Game.sfc != null && Root.Game.sfc.isConnected.
  const bridge = fakeBridge({ IsLoggedIn: 'true' });
  const session = sessionModel.createSession({ bridge: bridge });
  assert.strictEqual(await session.signedIn(), true);
  assert.deepStrictEqual(bridge.asked(), ['IsLoggedIn'], 'asked by the loader own name');
});

test('a game that answers no is not signed in, and that is a no rather than an error', async () => {
  const session = sessionModel.createSession({ bridge: fakeBridge({ IsLoggedIn: 'false' }) });
  assert.strictEqual(await session.signedIn(), false);

  // The loader's body guards its own null check on the socket: an absent socket answers null.
  const nulled = sessionModel.createSession({ bridge: fakeBridge({ IsLoggedIn: null }) });
  assert.strictEqual(await nulled.signedIn(), false, 'a null socket is nobody signed in');
});

test('a socket that exists but is not connected is nobody signed in', async () => {
  // The second half of the loader's own expression. A disconnected socket is exactly the state a
  // disconnect leaves behind, so answering true would mean the bot's auto-relogin branch never ran.
  // The surface reaches it as one walk (loader-surface.js: IsLoggedIn -> sfc.isConnected), which the
  // FLASH_CHECKLIST evidence records, so a false here is the game's own answer.
  const session = sessionModel.createSession({ bridge: fakeBridge({ IsLoggedIn: 'false' }) });
  assert.strictEqual(await session.signedIn(), false);
});

test('a bridge that cannot attach is a refusal, not a no', async () => {
  const refusing = {
    attach: function () { return Promise.resolve({ ok: false, error: 'no game window' }); },
    loaderCall: function () { throw new Error('must not be called'); },
    call: function () { throw new Error('must not be called'); }
  };
  const session = sessionModel.createSession({ bridge: refusing });
  await assert.rejects(function () { return session.signedIn(); }, /no game window/);

  const absent = sessionModel.createSession({ bridge: null });
  await assert.rejects(function () { return absent.signedIn(); }, new RegExp(sessionModel.ERRORS.noChannel));
});

test('Health, HealthMax, Mana and ManaMax are the helpers the loader registers', async () => {
  // grimoire/game/Player.as: all four read myAvatar.dataLeaf.int*, and one row per name is what the
  // surface holds. The session asks for the names; the paths are the table's business.
  const bridge = fakeBridge({ Health: 1234, HealthMax: 2000, Mana: 77, ManaMax: 90 });
  const session = sessionModel.createSession({ bridge: bridge });
  assert.strictEqual(await session.health(), 1234);
  assert.strictEqual(await session.healthMax(), 2000);
  assert.strictEqual(await session.mana(), 77);
  assert.strictEqual(await session.manaMax(), 90);
  assert.deepStrictEqual(bridge.asked(), ['Health', 'HealthMax', 'Mana', 'ManaMax']);
});

test('IsAlive is Health above zero, the loader own comparison', async () => {
  // grimoire/game/Player.as: IsAlive = Health > 0, and Health is the intHP read.
  const alive = sessionModel.createSession({ bridge: fakeBridge({ Health: 1 }) });
  assert.strictEqual(await alive.alive(), true);

  const dead = sessionModel.createSession({ bridge: fakeBridge({ Health: 0 }) });
  assert.strictEqual(await dead.alive(), false);
});

test('a health the game did not answer as a number is reported, not read as zero', async () => {
  const session = sessionModel.createSession({ bridge: fakeBridge({ Health: 'dead' }) });
  await assert.rejects(function () { return session.health(); }, /not a number/);

  // A helper that answered nothing at all is the same kind of refusal: an avatar that is not in
  // the world reads null, and reading that as 0 HP would look exactly like a death.
  const nothing = sessionModel.createSession({ bridge: fakeBridge({ Health: null }) });
  await assert.rejects(function () { return nothing.health(); }, /answered nothing/);
});

test('SetSpawnPoint, Rest and exit-combat are the loader own helper names', async () => {
  // grimoire/game/World.as: SetSpawnPoint is world.setSpawnPoint(world.strFrame, world.strPad);
  // Player.as: Rest is world.rest() and CancelTarget is world.cancelTarget(), twice.
  const bridge = fakeBridge({ SetSpawnPoint: undefined, Rest: undefined, CancelTarget: undefined });
  const session = sessionModel.createSession({ bridge: bridge });
  await session.setSpawnPoint();
  await session.rest();
  await session.exitCombat();
  assert.deepStrictEqual(bridge.asked(), ['SetSpawnPoint', 'Rest', 'CancelTarget']);
});

test('the in-game Bank button asks the loader to show the game bank UI', async () => {
  const bridge = fakeBridge({ ShowBank: undefined });
  const session = sessionModel.createSession({ bridge: bridge });
  await session.showBank();
  assert.deepStrictEqual(bridge.asked(), ['ShowBank']);
});

test('ready follows the game own map-load flag, which is what MapLoadComplete tests first', async () => {
  // grimoire/game/World.as: MapLoadComplete() returns False while world.mapLoadInProgress. The
  // surface refuses the name because its second half reads the loader's own display list (#41), so
  // the session reads the game's own flag: the half a reload trips, and the half the pause keys off.
  const loading = sessionModel.createSession({ bridge: fakeBridge({ 'world.mapLoadInProgress': 'true' }) });
  assert.strictEqual(await loading.ready(), false, 'a map in flight is not ready');

  const loaded = sessionModel.createSession({ bridge: fakeBridge({ 'world.mapLoadInProgress': 'false' }) });
  assert.strictEqual(await loaded.ready(), true);
});

test('a game with no map-load flag is ready, which is what the loader treats null as', async () => {
  const session = sessionModel.createSession({ bridge: fakeBridge({ 'world.mapLoadInProgress': 'missing' }) });
  assert.strictEqual(await session.ready(), true);
});

test('the character name comes from the field the loader itself assigns', async () => {
  // The surface refuses GetUsername: the reference loader holds the login it captured from its own
  // form (Root.as, ticket #35) rather than reading it from the game. The game keeps the character's
  // name at myAvatar.objData.strUsername - the very field Player.as line 455 writes - so that is
  // what {PLAYERNAME} reads here.
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
  // The module states what each reference name translates to, so a reader can check it against the
  // decompiled loader rather than trusting this file.
  const bodies = sessionModel.LOADER_BODIES;
  ['IsLoggedIn', 'Health', 'HealthMax', 'SetSpawnPoint', 'Rest', 'CancelTarget']
    .forEach(function (name) {
      assert.ok(bodies[name], name + ' has no recorded body');
      assert.ok(bodies[name].body, name + ' records no body');
      assert.strictEqual(bodies[name].helper, name,
        name + ' is one of the loader surface rows, so it is asked for by that name');
      assert.ok(surface.SURFACE[name], name + ' must be a name the surface answers');
      assert.ok(surface.implemented().indexOf(name) !== -1, name + ' must be implemented, not refused');
    });
  assert.ok(/isConnected/.test(bodies.IsLoggedIn.body));
  assert.ok(/setSpawnPoint/.test(bodies.SetSpawnPoint.body));
  // And the two the surface refuses are recorded as this module's own reads, with their reasons.
  assert.ok(/ticket #41/.test(bodies.MapLoadComplete.body));
  assert.ok(/ticket #35/.test(bodies.GetUsername.body));
  assert.strictEqual(bodies.MapLoadComplete.path, sessionModel.PATHS.mapLoading);
  assert.strictEqual(bodies.GetUsername.path, sessionModel.PATHS.name);
});

test('the session asks for the loader own names, not hand-rolled paths', async () => {
  // Ticket #48 put the reference loader's whole helper surface in one table (loader-surface.js),
  // one row per name, each row reaching the path that name's own decompiled body reads. A session
  // that spelled those paths out itself would be a second copy of that table, free to drift from
  // it, so the session asks by name instead.
  const bridge = fakeBridge({
    IsLoggedIn: 'true',
    Health: 1234,
    HealthMax: 2000,
    Mana: 77,
    ManaMax: 90
  });
  const session = sessionModel.createSession({ bridge: bridge });
  assert.strictEqual(await session.signedIn(), true);
  assert.strictEqual(await session.health(), 1234);
  assert.strictEqual(await session.healthMax(), 2000);
  assert.strictEqual(await session.mana(), 77);
  assert.strictEqual(await session.manaMax(), 90);
  assert.deepStrictEqual(bridge.asked(), ['IsLoggedIn', 'Health', 'HealthMax', 'Mana', 'ManaMax']);

  // And the reads it does own are the ones the surface has no row for: the two above, and
  // CurrentTargetId (#42), which the reference's own loader registers no name for either - its
  // body is Flash.GetGameObject("world.myAvatar.target.objData.MonMapID") and nothing more.
  assert.deepStrictEqual(Object.keys(sessionModel.PATHS).sort(), ['mapLoading', 'name', 'targetId']);
});

test('a helper the surface refuses is reported with the surface own reason', async () => {
  // Two of the loader's names are refused by the surface, each naming the ticket that owns it. That
  // reason has to reach the caller rather than being flattened into a no.
  assert.ok(surface.SURFACE.MapLoadComplete.why, 'MapLoadComplete names why it is refused');
  assert.ok(surface.SURFACE.GetUsername.why, 'GetUsername names why it is refused');

  // A name the surface does not carry at all refuses with the surface's own words, not a value.
  const bridge = fakeBridge({});
  const session = sessionModel.createSession({ bridge: bridge });
  await assert.rejects(function () { return session.health(); }, /no helper named "Health"/);
});

test('a window that is gone is a refusal that says so, not a transient pause', async () => {
  // The platform's bridge channel answers a no-game-window error when the window it was attached to
  // is gone (res/platform/bridge-channel.js). A bot has to tell that apart from a map still loading:
  // the first ends that window's bot, the second is a pause. The reason rides on the error.
  const refusing = {
    attach: function () { return Promise.resolve({ ok: false, error: 'no game window' }); },
    loaderCall: function () { return Promise.resolve(null); },
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
