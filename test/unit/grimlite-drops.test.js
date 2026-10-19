// The drop list window (ticket #33). Reference: Grimlite-Li 816d9cd, Grimoire/UI/DropUi.cs and
// DropUi.Designer.cs (the window: the four columns, Take Drop, Reject ingame drop, Reject &
// Blacklist, Clear), Grimoire/Game/DropStack.cs (the stack, the getDrop frame, the 3 s cooldown)
// and Grimoire/Networking/Handlers/HandlerDropItem.cs (the dropItem frame it is fed by).
//
// The frame half is the platform's tap (ticket #26) and the detail half is the bridge (ticket
// #28/#48); this file drives both with stand-ins, so the whole window is checked without a game.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const url = require('url');

const platform = require('../../res/platform');
const drops = require('../../plugins/grimlite-parity/features/drops/drops.js');
const { createDropWindow } = require('../../plugins/grimlite-parity/features/drops/drop-window.js');
const dropWindowModule = require('../../plugins/grimlite-parity/features/drops/drop-window.js');
const { createDropGame } = require('../../plugins/grimlite-parity/features/drops/drop-game.js');
const bridgeModule = require('../../plugins/grimlite-parity/bridge.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const fixtures = path.join(__dirname, '../fixtures/grimlite-drops');
const reference = require(path.join(fixtures, 'reference.json'));
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;

const DROP_WINDOW_ID = 'grimlite-parity-drop';

// An item object in the shape the game's own invTree holds (Game.as case "dropItem": the frame's
// item, carrying the fields DropUi reads - sName, sType, bCoins, bUpg, iQty - and the two
// InvCat.isFullFor needs to decide whether the player can take it).
function item(over) {
  return Object.assign({
    ItemID: 10414,
    sName: 'Blinding Light of Destiny',
    sType: 'Sword',
    bCoins: 0,
    bUpg: 0,
    iQty: 1,
    iStk: 1
  }, over || {});
}

/** A stand-in for the tap: `on('frame', fn)` hands frames over, so emit drives the window. */
function fakeTap() {
  const listeners = [];
  return {
    sends: [],
    subscribers: function () { return listeners.length; },
    on: function (event, listener) {
      assert.strictEqual(event, 'frame');
      listeners.push(listener);
      return function off() {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
    send: function (frame) {
      this.sends.push(frame);
      return true;
    },
    emit: function (direction, text) {
      listeners.slice().forEach(function (listener) {
        listener({ id: 1, direction: direction, data: Buffer.from(text, 'utf8') });
      });
    }
  };
}

/** A stand-in for the WebContents a feature window is. */
function fakeWindow() {
  return {
    sent: [],
    handlers: {},
    destroyed: false,
    on: function (name, handler) { this.handlers[name] = handler; },
    once: function (name, handler) { this.handlers[name] = handler; },
    isDestroyed: function () { return this.destroyed; },
    send: function (channel, payload) { this.sent.push({ channel: channel, payload: payload }); },
    getURL: function () { return 'file:///drops.html'; }
  };
}

/** The window with every dependency injected: no Electron, no game, no socket. */
function build(options) {
  const opts = options || {};
  const tap = opts.tap || fakeTap();
  const opened = [];
  const inventory = opts.inventory || [];
  const window = createDropWindow({
    packets: tap,
    game: opts.game || {
      readInventory: function () { return Promise.resolve(inventory); },
      readSlots: function () {
        return Promise.resolve({ bag: 100, house: 100 });
      },
      readHouseItems: function () { return Promise.resolve([]); },
      readRoomId: function () { return Promise.resolve('battleon-1234'); }
    },
    messages: { title: 'DropList' },
    // Clear is the one action the reference puts a dialog in front of.
    confirmClear: opts.confirmClear || function () { return Promise.resolve(true); },
    showRejectInfo: opts.showRejectInfo || function () { return Promise.resolve(); },
    channel: 'plugin:grimlite-parity:dropRows',
    now: opts.now,
    log: function (msg) { opened.push(msg); }
  });
  return { window: window, tap: tap, log: opened };
}

test('a drop frame is read the way the reference reads it', () => {
  // Every frame in the fixture is one the client saw: the item is right there under items, keyed
  // by item id, and the client takes the first entry ("items.First().Value").
  reference.frames.forEach(function (entry) {
    const parsed = drops.parseDropFrame(entry.frame);
    // The take answers carry `taken` instead of `item`: they are the other half of the pair, and
    // the test below reads them. Neither half is ever read as the other.
    if (entry.taken) {
      assert.strictEqual(parsed, null, entry.why + ': a take answer is not a drop');
      return;
    }
    if (!entry.item) {
      assert.strictEqual(parsed, null, entry.why + ': should not be read as a drop');
      return;
    }
    assert.ok(parsed, entry.why + ': should read as a drop');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed)), entry.item, entry.why);
  });
});

test('a drop frame names one item even when it carries several', () => {
  // The fixture file carries two items in one frame; the reference takes the first and nothing
  // else, so a second item in the same frame is not a second row.
  const both = fs.readFileSync(path.join(fixtures, 'dropItem.json'), 'utf8');
  const parsed = drops.parseDropFrame(both);
  assert.strictEqual(parsed.id, 10414);
  assert.strictEqual(drops.parseDropFrame(both).name, 'Blinding Light of Destiny');
});

test('a frame that is not a drop is never read as one', () => {
  [
    '',
    'not json at all',
    '{"b":{"o":{"cmd":"dropItem"}}}',
    '{"b":{"o":{"cmd":"dropItem","items":null}}}',
    '{"b":{"o":{"cmd":"dropItem","items":{}}}}',
    '{"b":{"o":{"cmd":"dropItem","items":{"1":null}}}}',
    '{"b":{"o":{"cmd":"dropItem","items":{"1":{"ItemID":"","sName":""}}}}}',
    '[]'
  ].forEach(function (text) {
    assert.strictEqual(drops.parseDropFrame(text), null, 'read a drop out of: ' + text);
  });
});

test('the answer to a take is read the way the reference reads it', () => {
  // Flash.cs:690-693's own case: `Convert.ToInt32(data.bSuccess) == 1` removes the item.
  reference.frames.filter(function (entry) { return entry.taken; }).forEach(function (entry) {
    assert.deepStrictEqual(
      JSON.parse(JSON.stringify(drops.parseGetDropFrame(entry.frame))), entry.taken, entry.why);
  });

  [
    '',
    'not json',
    '{"b":{"o":{"cmd":"dropItem"}}}',
    '{"b":{"o":{"cmd":"getDrop","ItemID":0,"bSuccess":1}}}',
    '%xt%zm%getDrop%battleon-1%10414%'
  ].forEach(function (text) {
    assert.strictEqual(drops.parseGetDropFrame(text), null, 'read an answer out of: ' + text);
  });

  // A drop frame is not an answer to a take, and the other way round: the two never cross.
  assert.strictEqual(drops.parseGetDropFrame(reference.frames[0].frame), null);
  assert.strictEqual(drops.parseDropFrame(reference.frames[4].frame), null);
});

test('a drop appears with its name, quantity, category and both flags', () => {
  const list = drops.createDropList({});
  const outcome = list.offer(drops.parseDropFrame(reference.frames[1].frame));

  assert.strictEqual(outcome, 'added');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(list.rows())), [{
    id: 5315,
    name: 'Mystic Parchment',
    category: 'Item',
    isAcItem: true,
    isMemberOnly: true,
    quantity: 3
  }]);
  // DropUi.UpdateDropCount: the label counts the list's rows, not the items in them.
  assert.strictEqual(list.count(), 1);
});

test('the same item dropping again adds to its quantity, not to the row count', () => {
  const list = drops.createDropList({});
  list.offer(item({ ItemID: 7, sName: 'Bone Dust', sType: 'Item', bCoins: 0, bUpg: 0, iQty: 2 }));
  const outcome = list.offer(item({ ItemID: 7, sName: 'bone dust', sType: 'Item', bCoins: 0, bUpg: 0, iQty: 3 }));

  assert.strictEqual(outcome, 'added');
  assert.strictEqual(list.count(), 1);
  assert.strictEqual(list.rows()[0].quantity, 5);
  // The row keeps the name it was first seen under, as the reference's own row does.
  assert.strictEqual(list.rows()[0].name, 'Bone Dust');
});

test('reject stops accepting drops', () => {
  const list = drops.createDropList({});
  list.setRejecting(true);
  assert.strictEqual(list.offer(item({ ItemID: 8, sName: 'Anything' })), 'rejected');
  assert.strictEqual(list.count(), 0);

  list.setRejecting(false);
  assert.strictEqual(list.offer(item({ ItemID: 8, sName: 'Anything' })), 'added');
  assert.strictEqual(list.count(), 1);
});

test('reject and blacklist stops that item being offered again in this session', () => {
  const list = drops.createDropList({});
  list.offer(item({ ItemID: 9, sName: 'Trash Drop' }));
  list.offer(item({ ItemID: 10, sName: 'Keeper' }));

  const removed = list.blacklist(['Trash Drop']);
  assert.strictEqual(removed, 1);
  assert.strictEqual(list.count(), 1);

  // The name is the key, case-insensitively, as the reference's own list comparison is.
  assert.strictEqual(list.offer(item({ ItemID: 9, sName: 'trash drop' })), 'blacklisted');
  assert.strictEqual(list.count(), 1);
  assert.deepStrictEqual(list.rows().map(function (r) { return r.name; }), ['Keeper']);
});

test('Take Drop sends the reference\'s own frame, once per item', () => {
  const list = drops.createDropList({});
  list.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny' }));

  // DropStack.GetDrop: `%xt%zm%getDrop%{World.RoomId}%{itemId}%` to the server.
  const frame = list.takeFrame('battleon-1234', 10414);
  assert.strictEqual(frame, '%xt%zm%getDrop%battleon-1234%10414%');
});

test('a take is refused while the item is cooling down, and allowed after three seconds', () => {
  let clock = 1000;
  const list = drops.createDropList({ now: function () { return clock; } });
  list.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny' }));

  assert.deepStrictEqual(list.beginTake(10414), { ok: true, reason: null });
  assert.deepStrictEqual(list.beginTake(10414), { ok: false, reason: 'cooling' });

  clock += 2999;
  assert.deepStrictEqual(list.beginTake(10414), { ok: false, reason: 'cooling' });
  clock += 1;
  assert.deepStrictEqual(list.beginTake(10414), { ok: true, reason: null });
});

test('a take for an item the list no longer holds sends nothing', () => {
  const list = drops.createDropList({});
  assert.deepStrictEqual(list.beginTake(10414), { ok: false, reason: 'not-held' });
});

test('a successful take removes the row; a failed one leaves it for another try', () => {
  const list = drops.createDropList({});
  list.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny' }));

  // Game.as case "getDrop": bSuccess == 1 plays the frame out, anything else leaves it standing
  // (Flash.cs:690-693 removes it from the stack on success only).
  assert.strictEqual(list.settle(10414, false), false);
  assert.strictEqual(list.count(), 1);
  assert.strictEqual(list.settle(10414, true), true);
  assert.strictEqual(list.count(), 0);

  // The id is a number once parsed and a string when it arrives from a page: both settle.
  list.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny' }));
  assert.strictEqual(list.settle('10414', true), true);
  assert.strictEqual(list.count(), 0);
});

test('Clear empties the list and the blacklist', () => {
  const list = drops.createDropList({});
  list.offer(item({ ItemID: 9, sName: 'Trash Drop' }));
  list.blacklist(['Trash Drop']);
  list.offer(item({ ItemID: 10, sName: 'Keeper' }));

  list.clear();
  assert.strictEqual(list.count(), 0);
  assert.deepStrictEqual(list.rows(), []);
  // The reference's Clear clears `blacklisted` too, so the item is offered again afterwards.
  assert.strictEqual(list.offer(item({ ItemID: 9, sName: 'Trash Drop' })), 'added');
});

test('an item the player cannot take is marked so, in the game\'s own words', () => {
  const bagFull = [];
  const miscFull = [];
  for (let i = 0; i < 100; i++) {
    bagFull.push(item({ ItemID: 1000 + i, sName: 'Bag ' + i, sType: 'Sword' }));
    miscFull.push(item({ ItemID: 2000 + i, sName: 'Misc ' + i, sType: 'Note' }));
  }

  // DFrame2MC.yClick's own gate: InvCat.isFullFor(items, item, iBagSlots).
  assert.deepStrictEqual(drops.takeable(item({ sType: 'Sword' }), bagFull, { bag: 100, house: 100 }),
    { ok: false, reason: 'Item Inventory Full!' });
  assert.deepStrictEqual(drops.takeable(item({ sType: 'Note' }), miscFull, { bag: 100, house: 100 }),
    { ok: false, reason: 'Misc Inventory Full!' });

  // InvCat.isFullFor's misc branch counts the *misc* items already held, against the bag's own
  // slot count - so a bag full of weapons does not block a misc drop in the game's own logic,
  // and neither does this. The same fact the other way round: a note is not bag space either.
  assert.deepStrictEqual(drops.takeable(item({ sType: 'Note' }), bagFull, { bag: 100, house: 100 }),
    { ok: true, reason: null });
  assert.deepStrictEqual(drops.takeable(item({ sType: 'Sword' }), miscFull, { bag: 100, house: 100 }),
    { ok: true, reason: null });

  // A stack with room is not full: the game tests the owned stack before the bag.
  const stacks = [item({ ItemID: 10414, sName: 'Arrow', sType: 'Item', iQty: 1, iStk: 99 })];
  assert.deepStrictEqual(drops.takeable(item({ ItemID: 10414, sType: 'Item' }), stacks, { bag: 1, house: 1 }),
    { ok: true, reason: null });

  // Classes are never blocked by a full bag (InvCat.isFullFor returns false for them).
  assert.deepStrictEqual(drops.takeable(item({ sType: 'Class' }), bagFull, { bag: 100, house: 100 }),
    { ok: true, reason: null });

  // A house item is gated on the house slots instead, and says so in the game's words.
  assert.deepStrictEqual(
    drops.takeable(item({ sType: 'House' }), [], { bag: 0, house: 1 }, [item({ ItemID: 5 })]),
    { ok: false, reason: 'House Inventory Full!' });
  assert.deepStrictEqual(
    drops.takeable(item({ sType: 'House' }), [], { bag: 0, house: 2 }, [item({ ItemID: 5 })]),
    { ok: true, reason: null });
});

test('a slot count nobody could read leaves the item takeable rather than wrongly blocked', () => {
  // "cannot take it" and "nobody knows" must not look the same: an unknown bag is not a full bag.
  assert.deepStrictEqual(drops.takeable(item({ sType: 'Sword' }), [], { bag: null, house: null }),
    { ok: true, reason: null });
});

test('the window hands the page its list, its count and its two switches', async () => {
  const built = build({});
  const state = await built.window.handle('dropState');
  assert.strictEqual(state.count, 0);
  assert.deepStrictEqual(state.rows, []);
  assert.strictEqual(state.rejecting, false);
  assert.strictEqual(state.messages.title, 'DropList');

  built.window.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny' }));
  const after = await built.window.handle('dropState');
  assert.strictEqual(after.count, 1);
  assert.strictEqual(after.rows[0].name, 'Blinding Light of Destiny');
  assert.strictEqual(after.rows[0].takeable, true);
  assert.strictEqual(after.rows[0].reason, null);
});

test('a drop frame on the tap becomes a row in the window that is watching', async () => {
  const tap = fakeTap();
  const built = build({ tap: tap });
  const watcher = fakeWindow();
  await built.window.handle('dropWatch', { sender: watcher });
  assert.strictEqual(tap.subscribers(), 1, 'watching means one subscription');

  const drop = reference.frames[0];
  tap.emit('toClient', drop.frame);
  await new Promise(function (resolve) { setTimeout(resolve, 0); });

  const sent = watcher.sent.filter(function (item_) { return item_.channel === built.window.channel; });
  assert.ok(sent.length >= 1, 'the window is told what dropped');
  const last = sent[sent.length - 1].payload;
  assert.strictEqual(last.count, 1);
  assert.strictEqual(last.rows[0].name, 'Blinding Light of Destiny');
  assert.strictEqual(last.rows[0].category, 'Sword');

  // The client's own traffic is not a drop: an XT frame changes nothing.
  const before = watcher.sent.length;
  tap.emit('toServer', reference.frames[3].frame);
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual(watcher.sent.length, before);
});

test('a take the game confirms takes the row out; one it refuses leaves it standing', async () => {
  const tap = fakeTap();
  const built = build({ tap: tap });
  const watcher = fakeWindow();
  await built.window.handle('dropWatch', { sender: watcher });
  built.window.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny' }));
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual((await built.window.handle('dropState')).count, 1);

  // bSuccess == 0: the row stays, so the user can try again (Game.as leaves the button live).
  tap.emit('toClient', reference.frames[5].frame);
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual((await built.window.handle('dropState')).count, 1, 'a failed take keeps the row');

  // bSuccess == 1: the item is in the bag, and the row goes without another click.
  tap.emit('toClient', reference.frames[4].frame);
  await new Promise(function (resolve) { setTimeout(resolve, 0); });
  assert.strictEqual((await built.window.handle('dropState')).count, 0, 'a confirmed take removes the row');
});

test('Take Drop sends one frame per selected row, and reports what the game would not take', async () => {
  const tap = fakeTap();
  const built = build({ tap: tap });
  built.window.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny' }));
  built.window.offer(item({ ItemID: 5315, sName: 'Mystic Parchment', sType: 'Item' }));

  const result = await built.window.handle('dropTake', {}, [['Blinding Light of Destiny', 'Mystic Parchment']]);
  assert.deepStrictEqual(tap.sends, [
    { direction: 'toServer', text: '%xt%zm%getDrop%battleon-1234%10414%' },
    { direction: 'toServer', text: '%xt%zm%getDrop%battleon-1234%5315%' }
  ]);
  assert.deepStrictEqual(result.taken, ['Blinding Light of Destiny', 'Mystic Parchment']);
  assert.deepStrictEqual(result.failed, []);

  // The cooldown is the list's own: the same item cannot be asked for twice in a row.
  const again = await built.window.handle('dropTake', {}, [['Blinding Light of Destiny']]);
  assert.deepStrictEqual(again.taken, []);
  assert.strictEqual(again.failed.length, 1);
  assert.strictEqual(again.failed[0].reason, 'cooling');
  assert.strictEqual(tap.sends.length, 2, 'nothing was sent for the cooling item');
});

test('a full bag does not pre-gate a take: the reference asks the game anyway', async () => {
  const tap = fakeTap();
  const full = [];
  for (let i = 0; i < 100; i++) full.push(item({ ItemID: 1000 + i, sName: 'Bag ' + i, sType: 'Sword' }));
  const built = build({ tap: tap, inventory: full });
  built.window.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny', sType: 'Sword' }));

  const state = await built.window.handle('dropState');
  assert.strictEqual(state.rows[0].takeable, false);
  assert.strictEqual(state.rows[0].reason, 'Item Inventory Full!');

  const result = await built.window.handle('dropTake', {}, [['Blinding Light of Destiny']]);
  // DropUi.btnTakeDrop_Click calls DropStack.GetDrop for the row and lets the game refuse it;
  // the window's bag check is not allowed to block a take the reference would send.
  assert.deepStrictEqual(tap.sends, [
    { direction: 'toServer', text: '%xt%zm%getDrop%battleon-1234%10414%' }
  ]);
  assert.deepStrictEqual(result.taken, ['Blinding Light of Destiny']);
  assert.deepStrictEqual(result.failed, []);
});

test('the window with no game access says so rather than offering a take it cannot make', async () => {
  const built = build({
    tap: fakeTap(),
    game: {
      readInventory: function () { return Promise.reject(new Error('this app has no game bridge channel')); },
      readSlots: function () { return Promise.reject(new Error('this app has no game bridge channel')); },
      readHouseItems: function () { return Promise.reject(new Error('this app has no game bridge channel')); },
      readRoomId: function () { return Promise.reject(new Error('this app has no game bridge channel')); }
    }
  });
  built.window.offer(item({ ItemID: 10414, sName: 'Blinding Light of Destiny' }));

  const state = await built.window.handle('dropState');
  assert.strictEqual(state.rows[0].takeable, null, 'unknown is not "cannot take"');
  assert.ok(/no game bridge/.test(state.rows[0].reason), state.rows[0].reason);

  const result = await built.window.handle('dropTake', {}, [['Blinding Light of Destiny']]);
  assert.strictEqual(result.failed.length, 1);
  assert.ok(/no game bridge/.test(result.failed[0].reason), result.failed[0].reason);
});

test('Reject the ingame drop stops the list accepting them, and reaches the page', async () => {
  const built = build({});
  built.window.offer(item({ ItemID: 9, sName: 'Trash Drop' }));

  const on = await built.window.handle('dropReject', {}, [true]);
  assert.strictEqual(on.rejecting, true);

  // A drop arriving now is not offered: that is what "stops accepting drops" means here.
  built.window.offer(item({ ItemID: 10, sName: 'Later Drop' }));
  const state = await built.window.handle('dropState');
  assert.deepStrictEqual(state.rows.map(function (r) { return r.name; }), ['Trash Drop']);

  await built.window.handle('dropReject', {}, [false]);
  built.window.offer(item({ ItemID: 10, sName: 'Later Drop' }));
  assert.strictEqual((await built.window.handle('dropState')).count, 2);
});

test('Reject and Blacklist removes the selected rows and holds the names for the session', async () => {
  const built = build({});
  built.window.offer(item({ ItemID: 9, sName: 'Trash Drop' }));
  built.window.offer(item({ ItemID: 10, sName: 'Keeper' }));

  const answer = await built.window.handle('dropBlacklist', {}, [['Trash Drop']]);
  assert.strictEqual(answer.blacklisted, 1);
  assert.deepStrictEqual(answer.rows.map(function (r) { return r.name; }), ['Keeper']);

  // It is held for the session: the same name arriving again is not offered.
  built.window.offer(item({ ItemID: 9, sName: 'Trash Drop' }));
  assert.strictEqual((await built.window.handle('dropState')).count, 1);
});

test('Clear asks only until the first Yes, then clears the rows without the blacklist', async () => {
  const asked = [];
  let answer = false;
  const built = build({
    confirmClear: function () { asked.push(true); return Promise.resolve(answer); },
    tap: fakeTap()
  });
  built.window.offer(item({ ItemID: 9, sName: 'Trash Drop' }));

  const refused = await built.window.handle('dropClear');
  assert.strictEqual(asked.length, 1, 'the user is asked before anything is emptied');
  assert.strictEqual(refused.cleared, false);
  assert.strictEqual(refused.count, 1);

  answer = true;
  const cleared = await built.window.handle('dropClear');
  assert.strictEqual(asked.length, 2);
  assert.strictEqual(cleared.cleared, true);
  assert.strictEqual(cleared.count, 0);

  // A later Clear is rows only: no dialog, and a name held for the session stays held.
  built.window.list().blacklist(['Keeper']);
  built.window.offer(item({ ItemID: 9, sName: 'Trash Drop' }));
  built.window.offer(item({ ItemID: 10, sName: 'Keeper' }));
  const later = await built.window.handle('dropClear');
  assert.strictEqual(asked.length, 2, 'the confirmation is a one-time dialog');
  assert.strictEqual(later.cleared, true);
  assert.strictEqual(later.count, 0);
  assert.ok(built.window.list().blacklisted().indexOf('keeper') !== -1,
    'a later Clear leaves the blacklist standing');
  // ...so the blacklisted name is still refused when it drops again.
  built.window.offer(item({ ItemID: 10, sName: 'Keeper' }));
  assert.strictEqual((await built.window.handle('dropState')).count, 0);
});

// DropUi.RejectIngameDrop_Checkedchanged shows one information box, on the first tick only.
test('ticking Reject ingame drop shows the reference information box once', async () => {
  const shown = [];
  const built = build({
    showRejectInfo: function () { shown.push(dropWindowModule.REJECT_INFO); return Promise.resolve(); }
  });
  await built.window.handle('dropReject', {}, [true]);
  assert.deepStrictEqual(shown, [
    'This option will not override Reject drop & whitelist system from bot manager'
  ]);
  await built.window.handle('dropReject', {}, [false]);
  await built.window.handle('dropReject', {}, [true]);
  assert.strictEqual(shown.length, 1, 'the box is shown once per session');
});

test('the drop window is the app\'s own kind: a sandboxed page, no Flash, its own preload', async () => {
  const activated = await platform.activatePlugin({
    source: 'bundled',
    root: pluginRoot,
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  }, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: {
      openFeatureWindow: function () { return {}; },
      getPacketTap: function () { return platform.createPacketTap(); },
      getPacketSender: function () { return function () { return true; }; }
    }
  });
  const windows = activated.host._getState().featureWindows;
  const found = windows.filter(function (w) { return w.id === DROP_WINDOW_ID; });
  assert.strictEqual(found.length, 1, 'missing the drop window: ' +
    JSON.stringify(windows.map(function (w) { return w.id; })));

  const config = found[0].config;
  assert.strictEqual(config.webPreferences.sandbox, true);
  assert.strictEqual(config.webPreferences.plugins, false);
  assert.strictEqual(config.webPreferences.contextIsolation, true);
  assert.strictEqual(config.webPreferences.nodeIntegration, false);
  assert.strictEqual(config.useContentSize, true);
  const page = url.fileURLToPath(found[0].url);
  assert.ok(page.indexOf(pluginRoot) === 0 && fs.existsSync(page), 'missing page: ' + page);
  const preload = config.webPreferences.preload;
  assert.ok(fs.existsSync(preload), 'missing preload: ' + preload);
  const source = fs.readFileSync(preload, 'utf8');
  assert.ok(/require\((['"])electron\1\)/.test(source), 'the preload may only require electron');
  assert.strictEqual(source.indexOf("require('../"), -1, 'the preload stays self-contained');

  // The reference's own words for the window, and the menu and hotkey action it reaches it from.
  assert.strictEqual(found[0].title(), 'DropList');
  const state = activated.host._getState();
  const items = state.menus
    .map(function (contributor) {
      return contributor({ labels: { grimliteMenu: 'Grimlite' }, keybinds: {} });
    })
    .reduce(function (all, group) { return all.concat(group); }, [])
    .filter(function (menu) { return menu.label === 'Grimlite'; })
    .reduce(function (all, menu) { return all.concat(menu.submenu); }, []);
  const entry = items.filter(function (i) { return i.label === 'Drop Ui'; });
  assert.strictEqual(entry.length, 1, 'the menu needs the reference\'s own Drop Ui entry (has ' +
    items.map(function (i) { return i.label; }).join(', ') + ')');

  const opened = [];
  const openedState = await platform.activatePlugin({
    source: 'bundled',
    root: pluginRoot,
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  }, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: {
      openFeatureWindow: function (id) { opened.push(id); return {}; },
      getPacketTap: function () { return platform.createPacketTap(); },
      getPacketSender: function () { return function () { return true; }; }
    }
  });
  const live = openedState.host._getState();
  live.menus
    .map(function (contributor) {
      return contributor({ labels: { grimliteMenu: 'Grimlite' }, keybinds: {} });
    })
    .reduce(function (all, group) { return all.concat(group); }, [])
    .filter(function (menu) { return menu.label === 'Grimlite'; })
    .reduce(function (all, menu) { return all.concat(menu.submenu); }, [])
    .filter(function (i) { return i.label === 'Drop Ui'; })[0].click();
  assert.strictEqual(opened.length, 1, 'the entry opens exactly one window');
  assert.strictEqual(opened[0], DROP_WINDOW_ID);

  const binding = live.keybinds.filter(function (k) { return k.id === 'grimliteDrop'; });
  assert.strictEqual(binding.length, 1, 'the reference\'s own "Show DropUi" action must be bindable');
  assert.strictEqual(live.keybindDefaults.grimliteDrop, undefined,
    'Grimlite ships no default hotkeys');
  opened.length = 0;
  binding[0].action();
  assert.deepStrictEqual(opened, [DROP_WINDOW_ID]);
});

test('the drop window reaches its model through the window\'s own channels, and its own only', async () => {
  const built = build({});
  assert.throws(function () { built.window.handle('nonsense'); }, /unknown drops channel/);

  const state = await built.window.handle('dropState');
  assert.ok(Array.isArray(state.rows));
  assert.strictEqual(typeof state.count, 'number');
  assert.ok(state.messages);
});

test('the drop window\'s game reads go through the reference loader\'s own names', async () => {
  // The adapter is a mapping from a want to a name, and the names are the reference loader's
  // (ticket #48's surface). This drives the real surface with a stand-in bridge, so a name that
  // drifts or a path this test does not expect shows up here rather than in a live client.
  const bridge = bridgeModule.createGameAccess({
    log: function () {},
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (callback, args) {
        const answers = {
          'world.myAvatar.items': [item({ ItemID: 10414, sName: 'Blinding Light of Destiny', sType: 'Sword' })],
          'world.myAvatar.objData.iBagSlots': 100,
          'world.myAvatar.objData.iHouseSlots': 25,
          'world.myAvatar.houseitems': [item({ ItemID: 77, sName: 'Chair' })],
          'world.curRoom': 'battleon-1234'
        };
        if (Object.prototype.hasOwnProperty.call(answers, args[0])) {
          return Promise.resolve({ ok: true, value: JSON.stringify(answers[args[0]]) });
        }
        return Promise.resolve({ ok: false, error: 'no member ' + args[0] + ' at ' + args[0] });
      }
    }
  });
  const game = createDropGame(bridge);

  const inventory = await game.readInventory();
  assert.deepStrictEqual(inventory.map(function (i) { return i.sName; }), ['Blinding Light of Destiny']);
  assert.deepStrictEqual(await game.readSlots(), { bag: 100, house: 25 });
  assert.deepStrictEqual((await game.readHouseItems()).map(function (i) { return i.sName; }), ['Chair']);
  assert.strictEqual(await game.readRoomId(), 'battleon-1234');

  // A slot the game will not answer for is null, not 0: an unknown count must not read as a
  // full bag and block every drop.
  const refusing = createDropGame(bridgeModule.createGameAccess({
    log: function () {},
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (callback, args) {
        if (args[0] === 'world.myAvatar.objData.iBagSlots') {
          return Promise.resolve({ ok: true, value: JSON.stringify(50) });
        }
        return Promise.resolve({ ok: false, error: 'no member ' + args[0] });
      }
    }
  }));
  assert.deepStrictEqual(await refusing.readSlots(), { bag: 50, house: null });

  // A read that fails rejects: an empty inventory would read as "nothing is owned", which would
  // make a stack look unstackable and block a takeable drop.
  await assert.rejects(function () { return refusing.readInventory(); }, /no member/);
});
