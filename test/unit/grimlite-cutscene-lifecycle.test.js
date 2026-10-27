const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Execute actual AS3 callback bodies, stripping type annotations and identity casts only.
// Stock excerpts are pinned alongside this test; the watcher is read from production source.
const method = require('../helpers/as3-method.js');

const fixtures = path.join(__dirname, '../fixtures/grimlite-cutscene');
const stock = fs.readFileSync(path.join(fixtures, 'cutsceneHandler.as'), 'utf8');
const loaderSource = fs.readFileSync(path.join(fixtures, 'LoaderMC.as'), 'utf8');
const native = fs.readFileSync(path.join(__dirname, '../../plugins/grimlite-parity/bridge/AquaBridge.as'), 'utf8');

function scenario(realReadiness = false) {
  let listeners = [];
  const ext = { getChildAt(i) { return this.children[i]; }, children: [], get numChildren() { return this.children.length; }, addChild(child) { this.children.push(child); } };
  const g = {
    mcExtSWF: ext, ui: { visible: true },
    addEventListener(type, fn, capture, priority) {
      if (!listeners.some(entry => entry.fn === fn)) listeners.push({ fn, priority: priority || 0 });
    },
    removeEventListener(type, fn) { listeners = listeners.filter(entry => entry.fn !== fn); },
    world: { map: {}, mapLoadInProgress: false, mapEntered: true, visible: true, strFrame: 'Enter', strPad: 'Spawn', moveToCell(frame, pad) { this.strFrame = frame; this.strPad = pad; } },
    clearExternamSWF() { ext.children.length = 0; this.world.visible = true; this.ui.visible = true; },
    loadExternalSWF() { this.world.visible = false; this.ui.visible = false; this.ldrMC.history.cold = { ldr: contentLoader, dest: ext, evt: true }; }
  };
  const handler = { rootClass: g, baseChildren: 0, waitTicks: 0, polling: false, cutTimer: null,
    strFile: null, strFrame: 'Enter', strPad: 'Spawn', changeMap: false, cutFrame: 'Cut1', cutPad: 'Left',
    startPoll() { this.polling = true; }, onReadyPoll() {}, onCutTimer() {} };
  for (const name of ['isPending', 'showCutscene', 'transfer', 'fireCutscene', 'onOverlayPoll', 'cancel']) {
    handler[name] = method(stock, name, name === 'showCutscene' ? 'param1,param2,param3,param4' : 'param1');
  }
  g.world.cHandle = handler;
  const contentLoader = { content: { name: 'first-cutscene' }, contentLoaderInfo: { removeEventListener() {} } };
  let detached = false;
  const loader = g.ldrMC = { rootClass: g, history: {}, mcDest: ext, isEvent: true,
    parent: { removeChild() { detached = true; } }, onFileLoadComplete: method(loaderSource, 'onFileLoadComplete', 'param1') };
  const events = [];
  g.world.mapEventTrigger = event => events.push(event.cmd);
  const bridge = { game: g, skipCutscenes: false, skipRoot: null, skipScene: null, skipObserved: null,
    skipTransfers: 0, skipLast: 'off', toJson: JSON.stringify,
    walkSpeedEnabled: false, walkSpeed: 20, walkRoot: null,
    jsonError: error => JSON.stringify({ error: error.message }),
    aqSetWalkSpeedEnabled: method(native, 'aqSetWalkSpeedEnabled', 'enabled,speed'),
    onWalkSpeedFrame: method(native, 'onWalkSpeedFrame', 'event'),
    emit: (type, message) => events.push(message),
    aqSetSkipCutscenesEnabled: method(native, 'aqSetSkipCutscenesEnabled', 'enabled'),
    onSkipCutsceneFrame: method(native, 'onSkipCutsceneFrame', 'event') };
  // AS3 bound method closures retain their receiver when registered as listeners.
  bridge.onWalkSpeedFrame = bridge.onWalkSpeedFrame.bind(bridge);
  bridge.onSkipCutsceneFrame = bridge.onSkipCutsceneFrame.bind(bridge);
  handler.onOverlayPoll = handler.onOverlayPoll.bind(handler);
  if (realReadiness) {
    handler.loadedTick = 0;
    handler.startPoll = method(stock, 'startPoll');
    handler.onReadyPoll = method(stock, 'onReadyPoll', 'param1').bind(handler);
  }
  return { g, handler, bridge, events, contentLoader,
    count: () => listeners.length,
    tick() {
      for (const entry of listeners.slice().sort((a, b) => b.priority - a.priority)) {
        entry.fn(); // Flash snapshots dispatch: removal affects subsequent events only.
      }
    },
    complete() { loader.onFileLoadComplete({ target: { loader: contentLoader } }); assert.ok(detached); }
  };
}

test('native watcher cancels pending scenes and retains baseline external movie draining', () => {
  const run = scenario();
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.bridge.aqSetSkipCutscenesEnabled(true);
  assert.equal(run.count(), 1, 'rearming owns exactly one listener');
  for (let i = 0; i < 2; i++) {
    run.handler.showCutscene('new' + i + '.swf', false, 'Cut1', 'Left');
    run.tick();
    assert.equal(run.handler.isPending(), false);
    assert.equal(run.g.world.strFrame, 'Enter');
    assert.equal(Object.keys(run.g.ldrMC.history).length, 0, 'no loader was started');
  }
  run.g.mcExtSWF.children.push({ name: 'ordinary-shop' });
  run.g.world.visible = false;
  run.tick();
  assert.equal(run.g.mcExtSWF.numChildren, 0);
  assert.equal(run.g.world.visible, true);
  assert.equal(run.bridge.skipTransfers, 2, 'drain never transfers stale handler');
  assert.equal(run.bridge.skipLast, 'drained');
  run.bridge.aqSetSkipCutscenesEnabled(false);
  assert.equal(run.count(), 0);
  run.handler.showCutscene('disabled.swf', false, 'Cut1', 'Left');
  run.tick();
  assert.equal(run.handler.isPending(), true);
});

test('enable during cold load waits for INIT attachment, then restores destination after overlay callback', () => {
  const run = scenario();
  run.handler.showCutscene('first.swf', false, 'Cut1', 'Left');
  run.handler.fireCutscene();
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick();
  assert.equal(run.handler.isPending(), true, 'in-flight loader remains intact');
  assert.equal(run.g.world.visible, false);
  run.complete();
  assert.equal(run.g.mcExtSWF.numChildren, 1);
  assert.ok(run.events.includes('fileLoaded'));
  run.tick();
  assert.equal(run.g.world.strFrame, 'Enter', 'overlay never strands player in Cut1');
  assert.equal(run.g.world.strPad, 'Spawn');
  assert.equal(run.g.mcExtSWF.numChildren, 0);
  assert.equal(run.g.world.visible, true);
  assert.equal(run.g.ui.visible, true);
  assert.equal(run.handler.isPending(), false);
  assert.equal(run.count(), 1, 'transfer removed overlay callback, preserving watcher');
});

test('control reproduces old drain stranding Cut1; native transfer restores destination', () => {
  const run = scenario();
  run.handler.showCutscene('first.swf', false, 'Cut1', 'Left');
  run.handler.fireCutscene();
  run.complete();
  run.tick();
  assert.equal(run.g.world.strFrame, 'Cut1');
  run.g.clearExternamSWF();
  assert.equal(run.g.world.strFrame, 'Cut1', 'drain/show alone cannot restore destination');
  run.handler.transfer();
  assert.equal(run.g.world.strFrame, 'Enter');
});

for (const handlerKind of ['missing', 'unsupported', 'stale']) {
  test('direct playback and late enable drain every movie with ' + handlerKind + ' handler', () => {
    const run = scenario();
    if (handlerKind === 'missing') run.g.world.cHandle = null;
    if (handlerKind === 'unsupported') delete run.handler.isPending;
    run.g.mcExtSWF.children.push({ name: 'direct-action5' }, { name: 'second-movie' });
    run.g.world.visible = run.g.ui.visible = false;
    run.bridge.aqSetSkipCutscenesEnabled(true);
    run.tick();
    assert.equal(run.g.mcExtSWF.numChildren, 0);
    assert.equal(run.g.world.visible, true);
    assert.equal(run.g.ui.visible, true);
    assert.equal(run.bridge.skipTransfers, 0);
    assert.equal(run.bridge.skipLast, 'drained');
    assert.equal(run.count(), 1);
    run.g.mcExtSWF.children.push({ name: 'next-direct' });
    run.tick();
    assert.equal(run.g.mcExtSWF.numChildren, 0);
    run.bridge.aqSetSkipCutscenesEnabled(false);
    run.g.mcExtSWF.children.push({});
    run.tick();
    assert.equal(run.g.mcExtSWF.numChildren, 1);
  });
}

test('late enable after overlay ended pending still drains the displayed scene', () => {
  const run = scenario();
  run.handler.showCutscene('existing.swf', false, 'Cut1', 'Left');
  run.handler.fireCutscene();
  run.complete();
  run.tick();
  assert.equal(run.handler.isPending(), false);
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick();
  assert.equal(run.g.mcExtSWF.numChildren, 0);
  assert.equal(run.bridge.skipTransfers, 0, 'no stale destination guess');
});

test('watcher tolerates no world and reads a replacement world each frame', () => {
  const run = scenario();
  const world = run.g.world;
  run.g.world = null;
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick();
  assert.equal(run.count(), 1);
  run.g.world = world;
  run.handler.showCutscene('login.swf', false, 'Cut1', 'Left');
  run.tick();
  assert.equal(run.handler.isPending(), false);
});


test('pending cutscene waits for a map and completion of map loading before transfer', () => {
  const run = scenario();
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.handler.showCutscene('first-login.swf', false, 'Cut1', 'Left');
  run.g.world.map = null;
  run.tick();
  assert.equal(run.handler.isPending(), true, 'no destination transfer before map exists');
  assert.equal(run.count(), 1, 'watcher stays armed before map readiness');
  run.g.world.map = {};
  run.g.world.mapLoadInProgress = true;
  run.tick();
  assert.equal(run.handler.isPending(), true, 'map still loading: do not cancel the handler');
  run.g.world.mapLoadInProgress = false;
  run.tick();
  assert.equal(run.handler.isPending(), false);
  assert.equal(run.g.world.strFrame, 'Enter');
  assert.equal(run.g.world.strPad, 'Spawn');
});

test('native transfer preserves configured cross-map destination exactly once', () => {
  const run = scenario();
  const transfers = [];
  run.g.world.gotoTown = (...args) => transfers.push(args);
  run.handler.changeMap = true;
  run.handler.strMap = 'destination-42';
  run.handler.strFrame = 'AfterScene';
  run.handler.strPad = 'Right';
  run.handler.showCutscene('cross-map.swf', false, 'Cut1', 'Left');
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick();
  assert.deepStrictEqual(transfers, [['destination-42', 'AfterScene', 'Right']]);
  assert.equal(run.handler.isPending(), false);
  assert.equal(run.g.world.visible, true);
  assert.equal(run.g.ui.visible, true);
  run.tick();
  assert.equal(transfers.length, 1, 'stale handler never repeats the transfer');
});


test('tracked loader survives INIT removing history and overlay clearing pending before watcher', () => {
  const run = scenario();
  run.handler.showCutscene('race.swf', false, 'Cut1', 'Left');
  run.handler.fireCutscene();
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick(); // Observe the pending handler and its external loader before INIT.
  run.complete(); // INIT removes history, although downloading may continue until COMPLETE.
  run.handler.onOverlayPoll(); // Model game callback winning the broadcast frame race.
  assert.equal(run.handler.isPending(), false);
  assert.equal(run.g.world.strFrame, 'Cut1');
  run.tick();
  assert.equal(run.g.world.strFrame, 'Enter', 'associated displayed scene must transfer its destination');
  assert.equal(run.g.mcExtSWF.numChildren, 0);
  assert.equal(run.g.world.visible, true);
  assert.equal(run.g.ui.visible, true);
});


test('Flash snapshot dispatch cannot resurrect a canceled ready callback after skip transfer', () => {
  const run = scenario(true);
  let transfers = 0;
  let destinationTransfers = 0;
  const move = run.g.world.moveToCell;
  run.g.world.moveToCell = function (...args) { transfers++; if (args[0] === 'Enter') destinationTransfers++; return move.apply(this, args); };
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.handler.showCutscene('first-ready.swf', false, 'Cut1', 'Left');
  run.tick();
  // Either pre-load cancellation or an intact tracked load is safe; a canceled load is not.
  assert.ok(run.handler.isPending() || Object.keys(run.g.ldrMC.history).length === 0,
    'removed onReadyPoll still ran in the current Flash event and loaded a canceled scene');
  if (Object.keys(run.g.ldrMC.history).length) {
    assert.equal(transfers, 0, 'do not transfer before the current ready callback finishes starting its load');
    assert.strictEqual(run.bridge.skipScene.handler, run.handler,
      'same ENTER_FRAME associates the native handler before asynchronous INIT');
    run.complete();
  }
  run.tick();
  assert.equal(run.g.mcExtSWF.numChildren, 0, 'first cutscene must be skipped');
  assert.equal(run.g.world.strFrame, 'Enter', 'never leave a blank cutscene cell');
  assert.equal(run.g.world.visible, true);
  run.tick();
  assert.equal(destinationTransfers, 1, 'destination transfer occurs once, after game callbacks');
});

for (const change of ['world', 'map', 'handler', 'disable']) {
  test('tracked scene never transfers stale destination after changing ' + change, () => {
    const run = scenario();
    run.handler.showCutscene('tracked.swf', false, 'Cut1', 'Left');
    run.handler.fireCutscene();
    run.bridge.aqSetSkipCutscenesEnabled(true);
    run.tick();
    run.complete();
    run.handler.onOverlayPoll();
    let transfers = 0;
    run.handler.transfer = () => { transfers++; };
    if (change === 'world') run.g.world = { ...run.g.world };
    if (change === 'map') run.g.world.map = {};
    if (change === 'handler') run.g.world.cHandle = { isPending: () => false, transfer() { transfers++; } };
    if (change === 'disable') {
      run.bridge.aqSetSkipCutscenesEnabled(false);
      run.bridge.aqSetSkipCutscenesEnabled(true);
    }
    run.tick();
    assert.equal(transfers, 0);
    assert.equal(run.g.mcExtSWF.numChildren, 0, 'baseline removal does not require handler association');
  });
}

for (const extra of [false, true]) {
  test('native exit survives multiple external movies and non-event loading: extra=' + extra, () => {
    const run = scenario();
    run.handler.showCutscene('tracked.swf', false, 'Cut1', 'Left');
    run.handler.fireCutscene();
    run.g.ldrMC.history.cold.evt = false;
    run.bridge.aqSetSkipCutscenesEnabled(true);
    run.tick();
    run.complete();
    if (extra) run.g.mcExtSWF.children.push({ name: 'second' });
    run.tick();
    assert.equal(run.g.mcExtSWF.numChildren, 0);
    assert.equal(run.g.world.strFrame, 'Enter');
    assert.equal(run.bridge.skipTransfers, 1);
    assert.equal(run.bridge.skipLast, 'exited');
  });
}

test('cold load completed before first watcher frame still exits after pending resets', () => {
  const run = scenario();
  run.handler.showCutscene('cold.swf', false, 'Cut1', 'Left');
  run.handler.fireCutscene();
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.complete();
  run.tick();
  assert.equal(run.g.world.strFrame, 'Enter');
  assert.equal(run.g.mcExtSWF.numChildren, 0);
  assert.equal(run.bridge.skipTransfers, 1);
});

test('handler transition between frames associates an already displayed native scene', () => {
  const run = scenario();
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick();
  const next = { ...run.handler };
  for (const name of ['isPending', 'transfer', 'cancel']) next[name] = method(stock, name);
  run.g.world.cHandle = next;
  run.g.world.strFrame = 'Cut1';
  run.g.mcExtSWF.children.push({});
  run.tick();
  assert.equal(run.g.world.strFrame, 'Enter');
  assert.equal(run.bridge.skipTransfers, 1);
  run.tick();
  assert.equal(run.bridge.skipTransfers, 1);
});

test('captureGameRoot reattaches watcher and resets observed scene on root replacement', () => {
  const run = scenario();
  run.handler.showCutscene('old.swf', false, 'Cut1', 'Left');
  run.handler.fireCutscene();
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick();
  assert.ok(run.bridge.skipScene);
  const next = scenario();
  run.bridge.resolveStatic = () => next.g;
  run.bridge.stopGameRootWait = () => {};
  run.bridge.captureGameRoot = method(native, 'captureGameRoot');
  assert.equal(run.bridge.captureGameRoot(), true);
  assert.equal(run.count(), 1, 'only old overlay callback remains on old root');
  assert.equal(next.count(), 1, 'watcher attached once to replacement root');
  assert.equal(run.bridge.skipScene, null);
  assert.strictEqual(run.bridge.skipObserved.world, next.g.world);
  assert.strictEqual(run.bridge.skipObserved.handler, next.handler);
  next.g.mcExtSWF.children.push({ name: 'direct' });
  next.tick();
  assert.equal(run.bridge.skipTransfers, 0, 'replacement is not mistaken for a native scene transition');
  assert.equal(next.g.mcExtSWF.numChildren, 0);
  assert.equal(run.bridge.skipLast, 'drained');
});


test('native walk upkeep survives cell speed resets and world/root replacement, and off stops writing', () => {
  const run = scenario();
  const bridge = run.bridge;
  bridge.aqSetWalkSpeedEnabled(true, 37);
  bridge.aqSetWalkSpeedEnabled(true, 37);
  assert.strictEqual(run.count(), 1, 'rearming keeps one frame listener');
  for (let room = 0; room < 3; room++) {
    run.g.world = { WALKSPEED: 8 }; // World.cellSetup assigns intSpeed on every room change.
    run.tick(); // No JavaScript Options timer pass.
    assert.strictEqual(run.g.world.WALKSPEED, 37);
  }
  bridge.game = null;
  run.tick();
  const replacement = scenario();
  bridge.resolveStatic = () => replacement.g;
  bridge.stopGameRootWait = () => {};
  bridge.captureGameRoot = method(native, 'captureGameRoot');
  assert.strictEqual(bridge.captureGameRoot(), true);
  bridge.aqSetWalkSpeedEnabled(true, 53);
  assert.strictEqual(run.count(), 0, 'old root releases its listener');
  assert.strictEqual(replacement.count(), 1);
  replacement.g.world = { WALKSPEED: 8 };
  replacement.tick();
  assert.strictEqual(replacement.g.world.WALKSPEED, 53);
  for (const [input, expected] of [[0, 1], [500, 99], [42.9, 42]]) {
    bridge.aqSetWalkSpeedEnabled(true, input);
    assert.strictEqual(replacement.g.world.WALKSPEED, expected);
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.ok(JSON.parse(bridge.aqSetWalkSpeedEnabled(true, invalid)).error);
    assert.strictEqual(bridge.walkSpeed, 42, 'invalid values preserve the selection');
  }
  bridge.aqSetWalkSpeedEnabled(false, 42);
  assert.strictEqual(replacement.count(), 0);
  assert.strictEqual(replacement.g.world.WALKSPEED, 8);
  replacement.g.world.WALKSPEED = 12;
  replacement.tick();
  bridge.onWalkSpeedFrame({}); // A listener already in Flash's dispatch snapshot is harmless.
  assert.strictEqual(replacement.g.world.WALKSPEED, 12, 'off stops subsequent writes');
});


test('capturing a fresh game with untouched walkspeed off preserves the map default', () => {
  const run = scenario();
  const replacement = scenario();
  replacement.g.world.WALKSPEED = 13;
  run.bridge.resolveStatic = () => replacement.g;
  run.bridge.stopGameRootWait = () => {};
  run.bridge.captureGameRoot = method(native, 'captureGameRoot');
  assert.strictEqual(run.bridge.captureGameRoot(), true);
  replacement.tick();
  assert.strictEqual(replacement.g.world.WALKSPEED, 13);
  assert.strictEqual(replacement.count(), 0);
});
