// Fast travels and the map bypasser (ticket #32). Reference: Grimoire/UI/Travel.cs, its designer,
// and the decompiled loader under /var/tmp/aq48/out-loader/scripts/grimoire/. Every expected value
// below is read off those sources: the labels verbatim, the map/cell/pad triplets from each
// handler, the shop ids from AweTravel_Click's own ternary chain, the quest list from btnUltras,
// and the game path each call reaches (the loader is a renaming layer, so a helper name stands for
// the path its decompiled body reads - that is what loader-surface.js carries).
//
// The adapter is injected, so the whole window runs without Flash or a game: the stand-in below
// records the reference's own helper names, which is what these tests assert.
const assert = require('assert');

const travel = require('../../plugins/grimlite-parity/features/travel/travel.js');
const data = require('../../plugins/grimlite-parity/features/travel/travel-data.js');
const loaderSurface = require('../../plugins/grimlite-parity/loader-surface.js');

// The names the real adapter can answer, taken from the table ticket #48 built rather than
// restated here: a stand-in that answered a name the real surface does not would make these tests
// pass against a call the app cannot make.
const IMPLEMENTED = loaderSurface.implemented();
// The reads a helper returns for a fake that has not been told otherwise. A call answers nothing;
// IsLoggedIn answers true, because a logged-in client is the ordinary case this window runs in and
// the tests that care about the other one say so.
const DEFAULT_ANSWERS = { IsLoggedIn: true };

// A stand-in for features/travel/game-access.js. It answers the loader names the way the loader's
// own bodies do, so a test that passes here is a test that would pass against the real surface.
function fakeGame(options) {
  const opts = options || {};
  const game = {
    calls: [],
    reads: [],
    writes: [],
    frames: [],
    waits: [],
    // loaderCall(name, args) -> value. A name the real surface does not implement refuses with the
    // game's own words, which is what the real one reports.
    loaderCall: function (name, args) {
      game.calls.push({ name: name, args: args });
      if (IMPLEMENTED.indexOf(name) === -1) {
        return Promise.reject(new Error('no member ' + name + ' at world'));
      }
      const plan = (opts.loader || {})[name];
      if (plan === undefined) return Promise.resolve(DEFAULT_ANSWERS[name] === undefined ? null : DEFAULT_ANSWERS[name]);
      if (typeof plan === 'function') return Promise.resolve(plan(args));
      if (plan && plan.fail) return Promise.reject(new Error(plan.fail));
      return Promise.resolve(plan && Object.prototype.hasOwnProperty.call(plan, 'value') ? plan.value : plan);
    },
    read: function (path) {
      game.reads.push(path);
      if ((opts.failReads || []).indexOf(path) !== -1) {
        return Promise.resolve({ value: null, error: 'no member at ' + path });
      }
      const values = opts.values || {};
      return Promise.resolve(Object.prototype.hasOwnProperty.call(values, path)
        ? { value: values[path], error: null }
        : { value: null, error: null });
    },
    write: function (path, value) {
      game.writes.push({ path: path, value: value });
      if ((opts.failWrites || []).indexOf(path) !== -1) {
        return Promise.resolve({ ok: false, error: 'the game refused a write to ' + path });
      }
      return Promise.resolve({ ok: true });
    },
    // The client-frame door: the bridge's sendClientPacket.
    sendClientFrame: function (packet, type) {
      game.frames.push({ packet: packet, type: type });
      if (opts.failSend) return Promise.resolve({ ok: false, error: 'the bridge did not attach' });
      return Promise.resolve({ ok: true });
    },
    // The server-frame door: the relay, in the direction the reference writes a raw XT frame to.
    sendServerFrame: function (packet) {
      game.frames.push({ packet: packet, direction: 'toServer' });
      if (opts.failServerSend) return Promise.resolve(false);
      return Promise.resolve(true);
    },
    sleep: function (ms) {
      game.waits.push(ms);
      return Promise.resolve();
    }
  };
  return game;
}

function names(game) {
  return game.calls.map(function (call) { return call.name; });
}

function button(id) {
  const found = data.BUTTONS.filter(function (entry) { return entry.id === id; });
  assert.strictEqual(found.length, 1, 'no such button in the data: ' + id);
  return found[0];
}

// --------------------------------------------------------------------------- the destination table

test('every destination group the reference ships is present, with its buttons in the reference\'s own order', () => {
  assert.deepStrictEqual(data.GROUPS.map(function (group) { return group.label; }), [
    'Fast travels', 'Awe Enchantment Shop', 'Fast travels 2'
  ]);

  // The designer stacks the first group by y-coordinate: Oblivion first, the tercess cells after
  // it, then Binky/Dage/Escherion/Klunk, then the group's own Ultraboss and Bypass All.
  assert.deepStrictEqual(data.GROUPS[0].buttons.map(function (b) { return b.label; }), [
    'Oblivion (tercess)', 'Twins (tercess)', 'VHL/Taro/Zee (tercess)', 'Swindle (tercess)',
    'Nulgath / Skew (tercess)', 'Polish (tercess)', 'Carnage / Ninja (tercess)', 'Lae (tercess)',
    'Binky (doomvault)', 'Dage', 'Escherion', 'Klunk (underworld)', 'Ultraboss & Daily',
    'Bypass All'
  ]);
  assert.deepStrictEqual(data.GROUPS[1].buttons.map(function (b) { return b.label; }), [
    'Awe Shop (museum)'
  ]);
  assert.deepStrictEqual(data.GROUPS[2].buttons.map(function (b) { return b.label; }), [
    'DoomvaultB', 'Treetitanbattle', 'Ultradrakath', 'Tower of Doom 10', 'Necrodungeon'
  ]);

  // The private-instance control belongs to the first group only (chkPriv + numPriv sit in
  // grpTravel), and the map bypasser is the fourth box the designer draws.
  assert.strictEqual(data.GROUPS[0].private, true);
  assert.strictEqual(data.GROUPS[1].private, undefined);
  assert.strictEqual(data.GROUPS[2].private, undefined);
  assert.deepStrictEqual(
    { label: data.PRIVATE.label, value: data.PRIVATE.value, max: data.PRIVATE.max },
    { label: 'Private', value: 100000, max: 1000000 }
  );
  assert.strictEqual(data.BYPASSER.label, 'Map Bypasser');
  assert.strictEqual(data.BYPASSER.hint, 'Story Quest ID that required to unlock the map');
  assert.strictEqual(data.BYPASSER.unlock, 'Unlock');
  assert.strictEqual(data.BYPASSER.packetLabel, 'Generated packet');
  assert.strictEqual(data.BYPASSER.copy, 'Copy');
});

test('every travel button carries the map, cell and pad its own handler passes', () => {
  const expected = {
    tercess: ['tercessuinotlim', 'Enter', 'Spawn'],
    twins: ['tercessuinotlim', 'Twins', 'Left'],
    taro: ['tercessuinotlim', 'Taro', 'Left'],
    swindle: ['tercessuinotlim', 'Swindle', 'Left'],
    nulgath: ['tercessuinotlim', 'Boss2', 'Right'],
    polish: ['tercessuinotlim', 'm12', 'Top'],
    carnage: ['tercessuinotlim', 'm4', 'Top'],
    lae: ['tercessuinotlim', 'm5', 'Top'],
    dage: ['underworld', 's1', 'Left'],
    escherion: ['escherion', 'Boss', 'Left'],
    klunk: ['underworld', 'r11', 'Left'],
    binky: ['doomvault', 'r5', 'Left']
  };
  Object.keys(expected).forEach(function (id) {
    const spec = button(id).travel;
    assert.deepStrictEqual([spec.map, spec.cell, spec.pad], expected[id], id);
  });

  // Everything tercess is reached through tercess's own entry cell first, because the reference's
  // CreateJoinCommand walks there before it joins one of them.
  assert.strictEqual(button('tercess').travel.tercessEntry, true);
  assert.strictEqual(button('nulgath').travel.tercessEntry, true);
  assert.strictEqual(button('dage').travel.tercessEntry, undefined);
});

test('every button says which group owns it, so the page can draw it exactly once', () => {
  // The window hands the page the groups and the buttons as two lists, and IPC copies them: they
  // share no objects, so the page cannot match a button to a group by identity. Each button
  // carries a group and a column instead, and every group has at least one button in it.
  data.GROUPS.forEach(function (group) {
    assert.strictEqual(group.column === 'left' || group.column === 'right', true,
      group.id + ' needs the column the designer puts it in');
    const own = data.BUTTONS.filter(function (entry) { return entry.groupId === group.id; });
    assert.deepStrictEqual(own.map(function (entry) { return entry.id; }),
      group.buttons.map(function (entry) { return entry.id; }), group.id);
  });
  // The reference lays the form out in two columns: grpTravel alone on the left (x=13), the awe
  // group, Fast travels 2 and the bypasser down the right (x=183).
  assert.deepStrictEqual(data.GROUPS.map(function (group) { return group.column; }),
    ['left', 'right', 'right']);
  // The flat list is the groups' own order, so the page draws and tests in one order.
  assert.deepStrictEqual(data.BUTTONS.map(function (entry) { return entry.id; }),
    data.GROUPS.reduce(function (all, group) {
      return all.concat(group.buttons.map(function (entry) { return entry.id; }));
    }, []));
  // The awe group's own button is the member the page has to keep out of the group's button row.
  assert.strictEqual(data.button('aweShop').awe, true);
});

// --------------------------------------------------------------------------- fast travels

test('a destination in another map joins it, and one in the current map walks', async () => {
  const away = fakeGame({ values: { 'world.strMapName': 'battleon' } });
  assert.deepStrictEqual(await travel.runButton(away, 'dage', {}), {
    button: 'dage', action: 'join', map: 'underworld', cell: 's1', pad: 'Left',
    frames: [], error: null
  });
  // The login probe is the reference's own guard (ExecuteTravel: `if (!Player.IsLoggedIn) return`).
  assert.deepStrictEqual(away.calls, [
    { name: 'IsLoggedIn', args: [] },
    { name: 'Join', args: ['underworld', 's1', 'Left'] }
  ]);

  const here = fakeGame({ values: { 'world.strMapName': 'underworld' } });
  assert.deepStrictEqual(await travel.runButton(here, 'klunk', {}), {
    button: 'klunk', action: 'move', map: 'underworld', cell: 'r11', pad: 'Left',
    frames: [], error: null
  });
  assert.deepStrictEqual(here.calls, [
    { name: 'IsLoggedIn', args: [] },
    { name: 'Jump', args: ['r11', 'Left'] }
  ]);
});

test('a tercess destination walks to the tercess entry cell first', async () => {
  const game = fakeGame({ values: { 'world.strMapName': 'battleon' } });
  await travel.runButton(game, 'nulgath', {});

  assert.deepStrictEqual(game.calls, [
    { name: 'IsLoggedIn', args: [] },
    { name: 'Jump', args: ['m22', 'Left'] },
    { name: 'Join', args: ['tercessuinotlim', 'Boss2', 'Right'] }
  ]);

  // Already in tercess: no entry walk, and the destination is the cell the character is standing
  // in the same map as. The reference runs every button through the bot engine's CmdTravel, whose
  // same-map branch is a MoveToCell.
  const inside = fakeGame({ values: { 'world.strMapName': 'tercessuinotlim' } });
  assert.deepStrictEqual(await travel.runButton(inside, 'twins', {}), {
    button: 'twins', action: 'move', map: 'tercessuinotlim', cell: 'Twins', pad: 'Left',
    frames: [], error: null
  });
  assert.deepStrictEqual(names(inside), ['IsLoggedIn', 'Jump']);
});

test('the private checkbox numbers the room, as the reference suffixes the map', async () => {
  const game = fakeGame({ values: { 'world.strMapName': 'battleon' } });
  const result = await travel.go(game, {
    map: 'doomvaultb', cell: 'Enter', pad: 'Spawn', isPrivate: true, privateNumber: 12345
  });
  assert.strictEqual(result.map, 'doomvaultb-12345');
  assert.deepStrictEqual(game.calls, [
    { name: 'Join', args: ['doomvaultb-12345', 'Enter', 'Spawn'] }
  ]);

  const plain = fakeGame({ values: { 'world.strMapName': 'battleon' } });
  await travel.go(plain, { map: 'tercessuinotlim', cell: 'Enter', pad: 'Spawn' });
  assert.deepStrictEqual(plain.calls[plain.calls.length - 1], {
    name: 'Join', args: ['tercessuinotlim', 'Enter', 'Spawn']
  });

  // A room number on the current map is a different map name, so joining is what happens - and
  // the tercess entry walk happens too, since that compare is against the numbered name as well.
  const inside = fakeGame({ values: { 'world.strMapName': 'tercessuinotlim-12345' } });
  const there = await travel.go(inside, { map: 'tercessuinotlim', cell: 'Taro', pad: 'Left' });
  assert.strictEqual(there.action, 'join');
  // go() is the one travel, not a button: the tercess entry walk belongs to the button that
  // asked (the reference's own CreateJoinCommand), so only the join is here.
  assert.deepStrictEqual(names(inside), ['Join']);
});

test('a travel refuses to guess when the client is not logged in or the game will not answer', async () => {
  const offline = fakeGame({ loader: { IsLoggedIn: false } });
  const refused = await travel.runButton(offline, 'dage', {});
  assert.strictEqual(refused.error, travel.MESSAGES.notLoggedIn);
  assert.deepStrictEqual(offline.calls.map(function (c) { return c.name; }), ['IsLoggedIn']);

  // A game that cannot be read is never treated as standing in an empty map.
  const mute = fakeGame({ failReads: ['world.strMapName'] });
  const unreadable = await travel.runButton(mute, 'dage', {});
  assert.ok(/world\.strMapName/.test(unreadable.error), unreadable.error);
  assert.deepStrictEqual(names(mute), ['IsLoggedIn']);
});

// --------------------------------------------------------------------------- awe enchantment shop

test('the enchantment group holds the reference\'s six types, each selected with its own shop id', () => {
  assert.deepStrictEqual(data.AWE_TYPES, [
    { id: 'lucky', label: 'Lucky', shopId: 639, checked: true },
    { id: 'thief', label: 'Thief', shopId: 637, checked: false },
    { id: 'hybrid', label: 'Hybrid', shopId: 633, checked: false },
    { id: 'healer', label: 'Healer', shopId: 638, checked: false },
    { id: 'fighter', label: 'Fighter', shopId: 635, checked: false },
    { id: 'wizard', label: 'Wizard', shopId: 636, checked: false }
  ]);
});

test('each enchantment type opens its own shop, from wherever the character stands', async () => {
  for (const type of data.AWE_TYPES) {
    const game = fakeGame({ loader: { IsLoggedIn: true } });
    assert.deepStrictEqual(await travel.aweShop(game, type.id), { shopId: type.shopId, error: null }, type.id);
    // The reference's museum join is commented out upstream ("Staircase to hell"), so only the
    // shop is loaded - its own CmdLoadTravel with the id the ternary chain picked.
    assert.deepStrictEqual(game.calls, [{ name: 'LoadShop', args: [String(type.shopId)] }], type.id);
  }

  const unknown = await travel.aweShop(fakeGame({ loader: { IsLoggedIn: true } }), 'sorcerer');
  assert.ok(/sorcerer/.test(unknown.error), unknown.error);
});

// --------------------------------------------------------------------------- the map bypasser

test('the generated packet is the reference\'s own literal, built from the quest\'s own values', () => {
  assert.strictEqual(
    travel.updateQuestPacket(20, 126),
    '{"t":"xt","b":{"r":-1,"o":{"cmd":"updateQuest","iValue":20,"iIndex":126}}}'
  );
  assert.strictEqual(
    travel.bypassPacket({ iValue: 27, iSlot: 127 }),
    '{"t":"xt","b":{"r":-1,"o":{"cmd":"updateQuest","iValue":27,"iIndex":127}}}'
  );
  // The reference's own ISlot getter maps null and -1 to 0...
  assert.ok(travel.bypassPacket({ iValue: 5, iSlot: null }).indexOf('"iIndex":0}') !== -1);
  assert.ok(travel.bypassPacket({ iValue: 5, iSlot: -1 }).indexOf('"iIndex":0}') !== -1);
  // ...and a quest with no progress value at all is no packet, rather than a malformed frame.
  assert.strictEqual(travel.bypassPacket({ iSlot: 3 }), null);
  assert.strictEqual(travel.bypassPacket(null), null);
});

test('unlock turns a quest id into its packet and hands it to the client as a JSON frame', async () => {
  const game = fakeGame({
    loader: { IsLoggedIn: true },
    values: { 'world.questTree.8956': { iValue: 20, iSlot: 126 } }
  });
  const result = await travel.unlock(game, 8956, {});

  assert.strictEqual(result.packet, travel.updateQuestPacket(20, 126));
  assert.strictEqual(result.sent, true);
  assert.strictEqual(result.error, null);
  // The reference picks the type from the packet: a brace means json (Proxy.SendToClient).
  assert.deepStrictEqual(game.frames, [
    { packet: travel.updateQuestPacket(20, 126), type: 'json' }
  ]);
  // It was already on the quest tree, so nothing had to be loaded. Unlock is the window's own
  // button rather than an ExecuteTravel command, so it carries no login probe of its own.
  assert.deepStrictEqual(game.calls, []);
});

test('a quest the client does not hold is loaded first, then waited for', async () => {
  const game = fakeGame({ loader: { IsLoggedIn: true } });
  // The tree answers only on the third look, which is what the reference's own wait is for.
  let looks = 0;
  const games = fakeGame({ loader: { IsLoggedIn: true } });
  game.read = function (path) {
    game.reads.push(path);
    if (path === 'world.questTree.8956') {
      looks++;
      return Promise.resolve(looks >= 3
        ? { value: { iValue: 30, iSlot: 159 }, error: null }
        : { value: null, error: null });
    }
    return games.read(path);
  };
  game.loaderCall = games.loaderCall;
  game.calls = games.calls;

  const result = await travel.unlock(game, 8956, {});
  assert.strictEqual(result.packet, travel.updateQuestPacket(30, 159));
  assert.strictEqual(result.sent, true);
  assert.deepStrictEqual(game.calls, [{ name: 'LoadQuest', args: ['8956'] }]);
  assert.deepStrictEqual(game.waits, [500, 500]);
});

test('a quest the game never sends is reported, and nothing is injected', async () => {
  const game = fakeGame({ loader: { IsLoggedIn: true } });
  const result = await travel.unlock(game, 4242, {});

  assert.strictEqual(result.packet, null);
  assert.strictEqual(result.sent, false);
  assert.ok(/4242/.test(result.error), result.error);
  assert.deepStrictEqual(game.frames, []);
  // The reference waits eight times at half a second each, then gives up.
  assert.strictEqual(game.waits.length, 8);
  assert.deepStrictEqual(game.waits.filter(function (ms) { return ms !== 500; }), []);
});

test('the generated packet can be sent on its own, which is what the window\'s own button does', async () => {
  const game = fakeGame({});
  const packet = travel.updateQuestPacket(20, 126);
  assert.deepStrictEqual(await travel.sendPacket(game, packet), { packet: packet, sent: true, error: null });
  assert.deepStrictEqual(game.frames, [{ packet: packet, type: 'json' }]);

  // An empty box is not a packet, and a refused send says so instead of looking sent.
  assert.ok(/packet/i.test((await travel.sendPacket(fakeGame({}), '')).error));
  const refused = await travel.sendPacket(fakeGame({ failSend: true }), packet);
  assert.strictEqual(refused.sent, false);
  assert.strictEqual(refused.error, 'the bridge did not attach');
});

test('bypass all blanks every quest-progress field, and says which ones it could not read', async () => {
  const game = fakeGame({
    loader: { IsLoggedIn: true },
    values: {
      'world.myAvatar.objData.strQuests': '2;0;0;0',
      'world.myAvatar.objData.strQuests2': '1;1',
      'world.myAvatar.objData.strQuests3': ''
    }
  });
  const result = await travel.bypassAll(game);

  assert.deepStrictEqual(result.blanked, [
    { key: 'strQuests', length: 7 },
    { key: 'strQuests2', length: 3 },
    { key: 'strQuests3', length: 0 }
  ]);
  // strQuests4..7 are absent from objData, so nothing is written over a field the game has not
  // sent yet - the reference's own read would throw there.
  assert.deepStrictEqual(result.skipped, ['strQuests4', 'strQuests5', 'strQuests6', 'strQuests7']);
  assert.deepStrictEqual(game.writes, [
    { path: 'world.myAvatar.objData.strQuests', value: 'ZZZZZZZ' },
    { path: 'world.myAvatar.objData.strQuests2', value: 'ZZZ' },
    // An empty field is overwritten with an empty string, which is what new String('Z', 0) is.
    { path: 'world.myAvatar.objData.strQuests3', value: '' }
  ]);
  // The reference's own completion message, which is also where it says a relog restores it.
  assert.strictEqual(result.message,
    'All storyline are bypassed, if u want to restore the original progression. Please relogin');
  assert.strictEqual(result.error, null);
});

test('a write the game refuses is reported with what it managed, not swallowed', async () => {
  const game = fakeGame({
    loader: { IsLoggedIn: true },
    values: {
      'world.myAvatar.objData.strQuests': 'ab',
      'world.myAvatar.objData.strQuests2': 'cd'
    },
    failWrites: ['world.myAvatar.objData.strQuests2']
  });
  const result = await travel.bypassAll(game);

  assert.deepStrictEqual(result.blanked, [{ key: 'strQuests', length: 2 }]);
  assert.strictEqual(result.error, 'the game refused a write to world.myAvatar.objData.strQuests2');
  assert.notStrictEqual(result.message, undefined);
});

// --------------------------------------------------------------------------- fast travels 2

test('the skip-a-gate buttons send their frames in order and then travel', async () => {
  const game = fakeGame({ loader: { IsLoggedIn: true }, values: { 'world.strMapName': 'battleon' } });
  const result = await travel.runButton(game, 'doomvaultb', {});

  assert.strictEqual(result.error, null);
  // DoomvaultB is the longest: progress, an achievement frame to the server, the rest of the
  // progress, then the room.
  assert.deepStrictEqual(game.frames, [
    { packet: travel.updateQuestPacket(20, 126), type: 'json' },
    { packet: data.DOOMVAULT_ACHIEVEMENT, direction: 'toServer' },
    { packet: travel.updateQuestPacket(27, 127), type: 'json' }
  ]);
  assert.deepStrictEqual(names(game), ['IsLoggedIn', 'Join']);
  assert.deepStrictEqual(game.waits, [500, 1000, 500]);

  // The reference's other four are one frame, a one-second wait, then the map.
  const titan = fakeGame({ loader: { IsLoggedIn: true }, values: { 'world.strMapName': 'battleon' } });
  await travel.runButton(titan, 'treetitanbattle', {});
  assert.deepStrictEqual(titan.frames, [{ packet: travel.updateQuestPacket(30, 196), type: 'json' }]);
  assert.deepStrictEqual(titan.calls, [
    { name: 'IsLoggedIn', args: [] },
    { name: 'Join', args: ['treetitanbattle', 'Enter', 'Spawn'] }
  ]);
  // SkipMap's wait before the travel, and ExecuteTravel's own after it.
  assert.deepStrictEqual(titan.waits, [1000, 1000]);
});

test('a skip button honours the private checkbox like the reference\'s own room suffix', async () => {
  const game = fakeGame({ loader: { IsLoggedIn: true }, values: { 'world.strMapName': 'battleon' } });
  await travel.runButton(game, 'necrodungeon', { isPrivate: true, privateNumber: 99 });
  assert.deepStrictEqual(game.calls[game.calls.length - 1], {
    name: 'Join', args: ['necrodungeon-99', 'Enter', 'Spawn']
  });
});

test('a frame the relay did not write is reported, rather than left looking sent', async () => {
  // DoomvaultB is the one button whose frame leaves the machine. With the packet relay off there is
  // nothing to write it through: the room is still entered, and the frame is the part that failed.
  const game = fakeGame({
    loader: { IsLoggedIn: true },
    values: { 'world.strMapName': 'battleon' },
    failServerSend: true
  });
  const result = await travel.runButton(game, 'doomvaultb', {});

  assert.strictEqual(result.action, 'join');
  assert.strictEqual(result.map, 'doomvaultb');
  assert.ok(result.error.indexOf(data.DOOMVAULT_ACHIEVEMENT) !== -1, result.error);
  assert.ok(/relay is off/i.test(result.error), result.error);
  // The client-side frames of the same button were still handed to the client, and are still shown.
  assert.deepStrictEqual(game.frames.map(function (frame) { return frame.packet; }), [
    travel.updateQuestPacket(20, 126),
    data.DOOMVAULT_ACHIEVEMENT,
    travel.updateQuestPacket(27, 127)
  ]);

  // With the relay writing, the same button reports nothing at all.
  const wired = fakeGame({ loader: { IsLoggedIn: true }, values: { 'world.strMapName': 'battleon' } });
  assert.strictEqual((await travel.runButton(wired, 'doomvaultb', {})).error, null);
});

test('Ultraboss & Daily loads the reference\'s own sixteen quest ids', async () => {
  const game = fakeGame({ loader: { IsLoggedIn: true } });
  const result = await travel.runButton(game, 'ultras', {});

  assert.deepStrictEqual(data.ULTRA_QUESTS, [
    8152, 8153, 8154, 9350, 9803, 1677, 1678,
    8653, 9091,
    8300, 8397, 8547, 8692, 8746, 9173, 10301
  ]);
  assert.deepStrictEqual(result.loaded, data.ULTRA_QUESTS.map(String));
  assert.deepStrictEqual(game.calls, [
    { name: 'IsLoggedIn', args: [] },
    { name: 'LoadQuests', args: [data.ULTRA_QUESTS.join(',')] }
  ]);
});

test('an unknown button is refused rather than answered with something plausible', async () => {
  const game = fakeGame({ loader: { IsLoggedIn: true } });
  const result = await travel.runButton(game, 'teleport-me-anywhere', {});
  assert.ok(/teleport-me-anywhere/.test(result.error), result.error);
  // An id the window does not carry is refused before anything is asked of the game.
  assert.deepStrictEqual(game.calls, []);
});

// --------------------------------------------------------------------------- the surface this needs

test('every helper this window calls is one the bridge surface actually implements', () => {
  // The names are the reference's own; loader-surface.js is the table ticket #48 built. If one of
  // these ever falls out of it, this window would refuse with the surface's reason rather than
  // work - so the names are asserted against the real table, not against this file's own list.
  const implemented = loaderSurface.implemented();
  travel.LOADER_NAMES.forEach(function (name) {
    assert.ok(loaderSurface.names().indexOf(name) !== -1, name + ' is not in the loader surface');
    assert.ok(implemented.indexOf(name) !== -1, name + ' is in the surface but not implemented');
  });
});
