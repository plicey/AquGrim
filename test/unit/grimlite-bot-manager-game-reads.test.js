// The Bot Manager's own controls that act on the running game (#36), and the split that decides
// how each one is served.
//
// The reference client does not read the stock game for most of its own data: it ships its own
// loader (Loader/grimoire.swf), implements a helper surface there, and Flash.Call drives THAT.
// Our bridge loads the stock game and exposes one generic surface, so a name that lives only in
// the reference's loader answers "no member ... at world".
//
// Every name below was measured against both ABC constant pools - as the name with its u30 length
// prefix, which is what makes it a pool entry rather than a substring of a longer identifier
// (a plain substring search wrongly "finds" Cell inside GetCellPlayers):
//
//   in the stock game (Game4000r5) : world.strFrame, world.strPad, world.strMapName,
//                                    world.actions.active
//   the reference's loader only    : Cell, Position, RoomNumber, SetSpawnPoint, ReloadMap,
//                                    HideConnMC, SetFPS, GetSkillName, GetInventoryItems,
//                                    GetBankItems, IsLoggedIn
//
// A control here therefore either reads a dot-path the generic surface can walk, or is listed
// with the helper call it is waiting for. Nothing is invented and nothing is swallowed.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const gameReads = require('../../plugins/grimlite-parity/bot/game-reads.js');
const actions = require('../../plugins/grimlite-parity/bot/tab-actions.js');
const tabs = require('../../plugins/grimlite-parity/bot/tabs.js');
const manager = require('../../plugins/grimlite-parity/features/bot-manager/bot-manager.js');

const FEATURE = path.join(__dirname, '../../plugins/grimlite-parity/features/bot-manager');
const RENDERER = fs.readFileSync(path.join(FEATURE, 'bot-manager-renderer.js'), 'utf8');

// A store that keeps nothing; this slice never needs a file.
function memoryStore() {
  let value;
  return {
    read: function () { if (value === undefined) throw new Error('empty'); return JSON.parse(JSON.stringify(value)); },
    write: function (next) { value = JSON.parse(JSON.stringify(next)); return next; },
    readOrCreate: function (create) { if (value === undefined) value = create(); return JSON.parse(JSON.stringify(value)); }
  };
}

function window(overrides) {
  const deps = Object.assign({
    store: memoryStore(),
    defaultBotsDirectory: '',
    message: function () { return {}; },
    dialogs: {
      open: function () { return Promise.resolve({ canceled: true }); },
      save: function () { return Promise.resolve({ canceled: true }); }
    }
  }, overrides || {});
  return manager.createBotManager(deps);
}

test('a reachable read names the dot-path the stock game really has', () => {
  assert.deepStrictEqual(gameReads.READS, {
    cell: 'world.strFrame',
    pad: 'world.strPad',
    map: 'world.strMapName'
  });
});

test('every button the sheet draws builds something, reads the game, or says why not', () => {
  // The invariant that keeps a control from being decorative: any button with no builder, no
  // game read and no handler in the page would silently do nothing when pressed.
  const press = RENDERER.slice(RENDERER.indexOf('function press('));
  const switchBlock = press.slice(0, press.indexOf('function value('));
  const sheet = window().handle('botManagerSheet', null, []);
  const wired = Object.keys(actions.COMMAND_BUTTONS)
    .concat(Object.keys(actions.LIST_BUTTONS))
    .concat(sheet.gameButtons || []);

  const buttons = [];
  tabs.TABS.forEach(function (tab) {
    (function walk(controls) {
      (controls || []).forEach(function (control) {
        if (control.kind === 'button') buttons.push(control.id);
        walk(control.children);
      });
    })(tab.controls);
  });
  assert.ok(buttons.length >= 40, 'the sheet still declares its buttons');

  const silent = buttons.filter(function (id) {
    return wired.indexOf(id) === -1 && switchBlock.indexOf("'" + id + "'") === -1;
  });
  assert.deepStrictEqual(silent, [], 'these buttons would silently do nothing');
});

test('an action-only game control is not sent through the read-fill path', () => {
  assert.ok(/if \(result\.values\)/.test(RENDERER),
    'the page must only fill boxes when the action returned values');
});

test('the access-level and alignment buttons act instead of doing nothing', async () => {
  const sent = [];
  const calls = [];
  const feature = window({
    sendFrame: function (frame) { sent.push(frame); return true; },
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (name, args) {
        calls.push([name, args]);
        return Promise.resolve({ ok: true, value: 'null' });
      }
    }
  });

  const alignment = await feature.handle('botManagerGame', null, ['btnSetGood', {}]);
  assert.strictEqual(alignment.ok, true);
  assert.deepStrictEqual(sent, [{ direction: 'toServer', text: '%xt%zm%updateQuest%218701%41%1%' }]);

  const member = await feature.handle('botManagerGame', null, ['btnSetMem', {}]);
  assert.strictEqual(member.ok, true);
  assert.ok(calls.some(function (one) {
    return one[0] === 'setGameObject' && one[1][0] === 'world.myAvatar.pMC.pname.ti.textColor';
  }), JSON.stringify(calls));
  assert.ok(calls.some(function (one) {
    return one[0] === 'setGameObject' && one[1][0] === 'world.myAvatar.objData.iUpgDays' && one[1][1] === 30;
  }), JSON.stringify(calls));
});

test('Load Map and Add item whitelist reach their reference actions', async () => {
  const calls = [];
  const feature = window({
    game: {
      loadQuest: function (id) { calls.push(['loadQuest', id]); return Promise.resolve(); },
      quest: function (id) {
        calls.push(['quest', id]);
        return Promise.resolve({ rewards: [{ sName: 'Reward' }], reqd: [{ sName: 'Requirement' }] });
      }
    },
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (name, args) {
        calls.push([name, args]);
        return Promise.resolve({ ok: true, value: 'null' });
      }
    }
  });

  const loaded = await feature.handle('botManagerGame', null,
    ['btnLoadMap', { fields: { tbLoadMap: 'yulgar-1.swf' } }]);
  assert.strictEqual(loaded.ok, true);
  assert.ok(calls.some(function (one) {
    return one[0] === 'callGameFunction' && one[1][0] === 'world.loadMap' && one[1][1] === 'yulgar-1.swf';
  }), JSON.stringify(calls));

  const added = await feature.handle('botManagerGame', null, ['btnQAddToWhitelist', {
    fields: { numQQuestId: '123', chkQRewards: true, chkQRequirements: true }
  }]);
  assert.strictEqual(added.ok, true, added.error);
  assert.ok(added.state.lists.Drops.some(function (row) { return row.text === 'Reward'; }));
  assert.ok(added.state.lists.Drops.some(function (row) { return row.text === 'Requirement'; }));
});

test('a reachable control reads through the generic surface and reports the values', async () => {
  const calls = [];
  const feature = window({
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function (name, args) {
        calls.push({ name: name, args: args });
        const path = args[0];
        const answer = { 'world.strFrame': 'Enter', 'world.strPad': 'Spawn', 'world.strMapName': 'battleon' };
        return Promise.resolve({ ok: true, value: JSON.stringify(answer[path]) });
      }
    }
  });

  const result = await feature.handle('botManagerGame', null, ['btnCurrCell', {}]);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.values, { cell: 'Enter', pad: 'Spawn' });
  assert.deepStrictEqual(calls, [
    { name: 'getGameObject', args: ['world.strFrame'] },
    { name: 'getGameObject', args: ['world.strPad'] }
  ]);
});

test('a "no member" answer is reported, never swallowed into a blank field', async () => {
  // The shape the bridge really produces: the call succeeds and its own value carries the error
  // (AquaBridge.toJson wraps a thrown member error as {"error":...}).
  const feature = window({
    bridge: {
      attach: function () { return Promise.resolve({ ok: true }); },
      call: function () {
        return Promise.resolve({ ok: true, value: JSON.stringify({ error: 'no member strFrame at world' }) });
      }
    }
  });
  const result = await feature.handle('botManagerGame', null, ['btnCurrCell', {}]);
  assert.strictEqual(result.ok, false);
  assert.ok(/no member strFrame/.test(result.error), result.error);
  assert.strictEqual(result.values, undefined, 'a failed read must not hand back fields');
});

test('a bridge that cannot answer at all says so instead of reading as empty', async () => {
  const feature = window({
    bridge: { attach: function () { return Promise.resolve({ ok: false, error: 'no game window' }); } }
  });
  const result = await feature.handle('botManagerGame', null, ['btnCurrCell', {}]);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.error, 'no game window');
});

test('a control that needs the reference loader names the exact helper call it waits for', async () => {
  const feature = window();
  const expected = {
    btnHideLoading: 'HideConnMC',
    btnSetFPS: 'SetFPS'
  };
  for (const id of Object.keys(expected)) {
    const result = await feature.handle('botManagerGame', null, [id, {}]);
    assert.strictEqual(result.ok, false, id + ' cannot read without the helper surface');
    assert.ok(result.error.indexOf(expected[id]) !== -1,
      id + ' must name ' + expected[id] + ', got: ' + result.error);
  }
});

test('the sheet hands the page the game controls and their reasons, so none is a dead button', () => {
  const feature = window();
  const sheet = feature.handle('botManagerSheet', null, []);
  assert.ok(Array.isArray(sheet.gameButtons), 'the page learns which ids act on the game');
  Object.keys(gameReads.GAME_BUTTONS).forEach(function (id) {
    assert.ok(sheet.gameButtons.indexOf(id) !== -1, id + ' travels with the sheet');
  });
  assert.ok(RENDERER.indexOf('gameButtons') !== -1, 'the page reads that list');
});

test('loader-backed controls act through the loader surface instead of reporting a reason', async () => {
  const calls = [];
  const feature = window({
    loaderCall: function (name, args) {
      calls.push([name, args || []]);
      if (name === 'Position') return Promise.resolve([12, 34]);
      if (name === 'Map') return Promise.resolve('yulgar');
      if (name === 'RoomNumber') return Promise.resolve('1');
      return Promise.resolve(true);
    }
  });

  const walked = await feature.handle('botManagerGame', null, ['btnWalkCur', {}]);
  assert.deepStrictEqual(walked.values, { x: 12, y: 34 });

  const swapped = await feature.handle('botManagerGame', null,
    ['btnCellSwap', { fields: { txtCell: 'Enter', txtPad: 'Spawn' } }]);
  assert.deepStrictEqual(swapped.values, { join: 'yulgar-1', cell: 'Enter', pad: 'Spawn' });

  assert.strictEqual((await feature.handle('botManagerGame', null, ['btnSetSpawn2', {}])).ok, true);
  assert.strictEqual((await feature.handle('botManagerGame', null, ['btnReloadMap', {}])).ok, true);
  assert.ok(calls.some(function (one) { return one[0] === 'SetSpawnPoint'; }));
  assert.ok(calls.some(function (one) { return one[0] === 'ReloadMap'; }));
});
