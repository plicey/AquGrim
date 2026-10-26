const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Execute actual AS3 callback bodies, stripping type annotations and identity casts only.
// Stock excerpts are pinned alongside this test; the watcher is read from production source.
function method(source, name, args) {
  const start = source.indexOf('{', source.indexOf('function ' + name + '('));
  assert.ok(start >= 0, name);
  let end = start + 1, depth = 1;
  while (depth) { const c = source[end++]; if (c === '{') depth++; if (c === '}') depth--; }
  const body = source.slice(start + 1, end - 1)
    .replace(/\b(var\s+\w+):(?:\*|\w+)/g, '$1')
    .replace(/\s+as MovieClip/g, '')
    .replace(/catch\s*\((\w+):Error\)/g, 'catch($1)')
    .replace(/MovieClip\(parent\)/g, 'this.parent');
  return vm.runInNewContext('(function(' + (args || '') + '){with(this){' + body + '}})', {
    trace() {}, Loader: value => value, Boolean,
    Event: { ENTER_FRAME: 'frame', INIT: 'init', COMPLETE: 'complete' },
    TimerEvent: { TIMER: 'timer' }, ProgressEvent: { PROGRESS: 'progress' },
    IOErrorEvent: { IO_ERROR: 'io' }, SecurityErrorEvent: { SECURITY_ERROR: 'security' }
  });
}
const fixtures = path.join(__dirname, '../fixtures/grimlite-cutscene');
const stock = fs.readFileSync(path.join(fixtures, 'cutsceneHandler.as'), 'utf8');
const loaderSource = fs.readFileSync(path.join(fixtures, 'LoaderMC.as'), 'utf8');
const native = fs.readFileSync(path.join(__dirname, '../../plugins/grimlite-parity/bridge/AquaBridge.as'), 'utf8');

function scenario() {
  let listeners = [];
  const ext = { children: [], get numChildren() { return this.children.length; }, addChild(child) { this.children.push(child); } };
  const g = {
    mcExtSWF: ext, ui: { visible: true },
    addEventListener(type, fn, capture, priority) {
      if (!listeners.some(entry => entry.fn === fn)) listeners.push({ fn, priority: priority || 0 });
    },
    removeEventListener(type, fn) { listeners = listeners.filter(entry => entry.fn !== fn); },
    world: { map: {}, mapLoadInProgress: false, visible: true, strFrame: 'Enter', strPad: 'Spawn', moveToCell(frame, pad) { this.strFrame = frame; this.strPad = pad; } },
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
  const bridge = { game: g, skipCutscenes: false, skipRoot: null, toJson: JSON.stringify,
    emit: (type, message) => events.push(message),
    aqSetSkipCutscenesEnabled: method(native, 'aqSetSkipCutscenesEnabled', 'enabled'),
    onSkipCutsceneFrame: method(native, 'onSkipCutsceneFrame', 'event') };
  // AS3 bound method closures retain their receiver when registered as listeners.
  bridge.onSkipCutsceneFrame = bridge.onSkipCutsceneFrame.bind(bridge);
  handler.onOverlayPoll = handler.onOverlayPoll.bind(handler);
  return { g, handler, bridge, events,
    count: () => listeners.length,
    tick() {
      for (const entry of listeners.slice().sort((a, b) => b.priority - a.priority)) {
        if (listeners.includes(entry)) entry.fn();
      }
    },
    complete() { loader.onFileLoadComplete({ target: { loader: contentLoader } }); assert.ok(detached); }
  };
}

test('native watcher cancels first/new cutscenes before load and leaves ordinary external movies alone', () => {
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
  assert.equal(run.g.mcExtSWF.numChildren, 1);
  assert.equal(run.g.world.visible, false, 'stale handler does not close ordinary external content');
  run.bridge.aqSetSkipCutscenesEnabled(false);
  assert.equal(run.count(), 0);
  run.handler.showCutscene('disabled.swf', false, 'Cut1', 'Left');
  run.tick();
  assert.equal(run.handler.isPending(), true);
});

test('enable during cold load waits for actual completion, then transfers before stock overlay callback', () => {
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

test('unsupported public handler reports failure and removes watcher without clearing content', () => {
  const run = scenario();
  delete run.handler.isPending;
  run.g.mcExtSWF.children.push({ name: 'ordinary' });
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick();
  assert.equal(run.count(), 0);
  assert.equal(run.g.mcExtSWF.numChildren, 1);
  assert.match(run.events[0], /does not support isPending\/transfer/);
});

test('already displayed scene is left alone when pending has ended', () => {
  const run = scenario();
  run.handler.showCutscene('existing.swf', false, 'Cut1', 'Left');
  run.handler.fireCutscene();
  run.complete();
  run.tick();
  assert.equal(run.handler.isPending(), false);
  run.bridge.aqSetSkipCutscenesEnabled(true);
  run.tick();
  assert.equal(run.g.mcExtSWF.numChildren, 1);
  assert.equal(run.g.world.strFrame, 'Cut1', 'never guess a stale destination');
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
