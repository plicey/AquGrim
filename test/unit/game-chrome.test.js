// The game window's chrome strip (ticket #45), platform half: the layout the active plugin asks
// for. The strip's controls belong to the plugin that declares them and are tested with it
// (grimlite-chrome.test.js); what is the platform's own is the geometry - how tall the strip is,
// what size the window is with it up and without it, and what the screenshot path excludes.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { createGameChrome, captureRect } = require('../../res/windows/game-chrome.js');
const { createPluginHost } = require('../../res/platform/plugin-host.js');

const PLAIN = { width: 960, height: 530 };
const REPO = path.join(__dirname, '../..');

const DECLARATION = {
  height: 27,
  controls: function () { return [{ id: 'bank', kind: 'button', label: 'Bank' }]; },
  state: function () { return { values: {} }; },
  action: function () { return { ok: true, error: null }; }
};

/**
 * The chrome instance with its two side effects recorded, over a window that keeps its own
 * content size so a toggle's arithmetic can be read back the way a user would see it.
 */
function harness(declaration) {
  const resized = [];
  const notified = [];
  // A game window opens with the strip already up when the plugin declares one, so that is the
  // size the harness starts its window at (res/windows/config.js adds the strip to the config).
  const opening = declaration
    ? { width: PLAIN.width, height: PLAIN.height + Number(declaration.height) }
    : { width: PLAIN.width, height: PLAIN.height };
  const win = {
    id: 7,
    _size: opening,
    // What res/instances.js sets: this page is the wrapper the strip is drawn in.
    aquaStarChromeHost: true,
    isDestroyed: function () { return false; },
    getContentSize: function () { return [this._size.width, this._size.height]; }
  };
  const chrome = createGameChrome({
    declaration: function () { return declaration; },
    plain: function () { return PLAIN; },
    resize: function (target, size) {
      resized.push({ id: target.id, size: size });
      target._size = { width: size.width, height: size.height };
    },
    notify: function (target, view) { notified.push({ id: target.id, view: view }); }
  });
  return { chrome: chrome, win: win, resized: resized, notified: notified };
}

test('a plugin that declares no chrome leaves the game window at the size the screenshot path assumes', () => {
  const plain = harness(null);
  assert.strictEqual(plain.chrome.available(), false);
  assert.strictEqual(plain.chrome.height(), 0);
  // No window, no layout to describe: a caller that has not named one is not told "enabled".
  assert.strictEqual(plain.chrome.isEnabled(), false);
  assert.strictEqual(plain.chrome.isEnabled(plain.win), false);
  assert.deepStrictEqual(plain.chrome.contentSize(plain.win), PLAIN);
  assert.strictEqual(plain.chrome.stripHeight(plain.win), 0);
  // Nothing to show means nothing to toggle: no resize, no page message.
  assert.deepStrictEqual(plain.chrome.setEnabled(plain.win, true), { enabled: false, height: 0 });
  assert.deepStrictEqual(plain.resized, []);
  assert.deepStrictEqual(plain.notified, []);
});

test('the strip takes its height from the plugin and the game surface keeps its own', () => {
  const on = harness(DECLARATION);
  assert.strictEqual(on.chrome.available(), true);
  assert.strictEqual(on.chrome.height(), 27);
  // The surface is plain-sized whether the strip is up or not; the window is what grows.
  assert.deepStrictEqual(on.chrome.contentSize(on.win), { width: 960, height: 557 });
  assert.strictEqual(on.chrome.stripHeight(on.win), 27);
  const rect = captureRect({ width: 960, height: 557 }, on.chrome.stripHeight(on.win));
  assert.deepStrictEqual(rect, { x: 0, y: 27, width: 960, height: 530 },
    'the default capture region is the surface, not the window');
});

test('the render scale is per-window, bounded, and travels with the page view', async () => {
  const on = harness(DECLARATION);
  assert.strictEqual(on.chrome.renderScale(on.win), 100, 'the game starts at full resolution');
  assert.strictEqual(on.chrome.setRenderScale(on.win, 52.4), 52.4, 'the slider is continuous');
  const view = await on.chrome.pageView(on.win);
  assert.strictEqual(view.renderScale, 52.4, 'the wrapper can apply the saved scale when it redraws');
  assert.strictEqual(on.chrome.setRenderScale(on.win, 1), 25, 'a quarter resolution is the floor');
  assert.strictEqual(on.chrome.setRenderScale(on.win, 101), 100, 'and 100% is the ceiling');
  assert.strictEqual(on.chrome.setRenderScale(on.win, 'nonsense'), 100);
});

test('toggling returns the window to exactly the plain size and back, and says so on the page', async () => {
  const on = harness(DECLARATION);
  assert.deepStrictEqual(on.chrome.setEnabled(on.win, false), { enabled: false, height: 27 });
  assert.deepStrictEqual(on.win._size, PLAIN, 'chrome off is the plain size the checklist expects');
  assert.strictEqual(on.chrome.stripHeight(on.win), 0);
  assert.strictEqual(on.chrome.isEnabled(on.win), false);
  // The page is told when the dispatch has finished, so it can draw the strip's own status.
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.strictEqual(on.notified[0].view.enabled, false);
  assert.strictEqual(on.notified[0].view.height, 27);
  assert.deepStrictEqual(on.notified[0].view.controls, DECLARATION.controls());

  assert.deepStrictEqual(on.chrome.setEnabled(on.win, true), { enabled: true, height: 27 });
  assert.deepStrictEqual(on.win._size, { width: 960, height: 557 }, 'and back to the striped size');
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.strictEqual(on.notified[1].view.enabled, true);
  assert.deepStrictEqual(on.resized.map(function (one) { return one.size; }),
    [PLAIN, { width: 960, height: 557 }]);
});

test('a size the user dragged while the strip was up comes back with it', () => {
  const on = harness(DECLARATION);
  on.win._size = { width: 1200, height: 700 };
  on.chrome.setEnabled(on.win, false);
  assert.deepStrictEqual(on.win._size, PLAIN);
  on.chrome.setEnabled(on.win, true);
  assert.deepStrictEqual(on.win._size, { width: 1200, height: 700 });
});

test('one window\'s strip does not move another\'s', () => {
  const on = harness(DECLARATION);
  const other = { id: 8, _size: { width: 960, height: 557 }, aquaStarChromeHost: true,
    isDestroyed: function () { return false; },
    getContentSize: function () { return [this._size.width, this._size.height]; } };
  on.chrome.setEnabled(on.win, false);
  assert.strictEqual(on.chrome.isEnabled(on.win), false);
  assert.strictEqual(on.chrome.isEnabled(other), true);
  assert.deepStrictEqual(on.chrome.contentSize(other), { width: 960, height: 557 });
  // The state lives on the window itself, so a window that goes away takes its own layout with
  // it and a new one starts striped.
  assert.strictEqual(on.chrome.isEnabled({ id: 9, aquaStarChromeHost: true,
    isDestroyed: function () { return false; } }), true);
});

test('the capture region is the whole window when no strip is up', () => {
  assert.deepStrictEqual(captureRect({ width: 960, height: 530 }, 0),
    { x: 0, y: 0, width: 960, height: 530 });
});

test('a game window whose page cannot draw a strip keeps the plain size, strip or not', () => {
  const on = harness(DECLARATION);
  // res/instances.js marks each window with whether it loaded the wrapper page. A Ruffle page or
  // a bare SWF has no strip element, so a strip there would push the surface down with nothing
  // above it: the window keeps the game's own size exactly, which is what the screenshot and
  // recording paths assume.
  const bare = { id: 11, _size: PLAIN, aquaStarChromeHost: false,
    isDestroyed: function () { return false; },
    getContentSize: function () { return [this._size.width, this._size.height]; } };
  assert.strictEqual(on.chrome.isEnabled(bare), false);
  assert.strictEqual(on.chrome.stripHeight(bare), 0);
  assert.deepStrictEqual(on.chrome.contentSize(bare), PLAIN);
  assert.deepStrictEqual(on.chrome.setEnabled(bare, true), { enabled: false, height: 0 });
  assert.deepStrictEqual(bare._size, PLAIN, 'and it is not resized by a toggle it cannot honour');
  // The same plugin, the same time: the window that did load the wrapper still carries it.
  assert.strictEqual(on.chrome.stripHeight(on.win), 27);
});

test('a window nothing marked as a strip host is not captured 27 px short', () => {
  const on = harness(DECLARATION);
  // A plugin's own feature windows (res/windows/feature-window-controller.js) are built straight
  // from BrowserWindow and never pass through res/instances.js, so they carry no marker at all.
  // The screenshot path runs on whatever window is focused, so an unmarked window has to read as
  // "no strip" rather than as "a strip until told otherwise": its capture region must stay the
  // whole content area, exactly as it was before this ticket.
  const feature = { id: 21, isDestroyed: function () { return false; },
    getContentSize: function () { return [480, 700]; } };
  assert.strictEqual(on.chrome.isEnabled(feature), false);
  assert.strictEqual(on.chrome.stripHeight(feature), 0);
  assert.deepStrictEqual(captureRect(feature.getContentSize(), on.chrome.stripHeight(feature)),
    { x: 0, y: 0, width: 480, height: 700 });
  // The game window that did load the wrapper is unaffected by that default.
  assert.strictEqual(on.chrome.stripHeight(on.win), 27);
});

test('the window that loads the wrapper opens tall enough for the strip; the other one does not', () => {
  const src = fs.readFileSync(path.join(REPO, 'res', 'instances.js'), 'utf8');
  const config = fs.readFileSync(path.join(REPO, 'res', 'windows', 'config.js'), 'utf8');
  // The only page that can draw a strip is the wrapper, so the window that loads it is the one
  // that opens taller. The decision is made where the embed branch is already known.
  assert.ok(/aquaStarChromeHost/.test(src), 'a window says whether its page can carry a strip');
  assert.ok(/gameChrome\(\)\.height\(\)/.test(src), 'the strip height comes from the plugin');
  assert.ok(/wrappedForChrome/.test(src), 'and only a wrapped page counts');
  // The plain size stays one number in one place, and the window config itself never adds a
  // strip: a config that did would make every game window taller, wrapper or not.
  assert.ok(/gameContentSize/.test(config));
  const configSrc = config.slice(config.indexOf('function _getWinConfig'),
    config.indexOf('Lazy getters'));
  assert.strictEqual(/gameChrome/.test(configSrc), false,
    'the config knows no strip; res/instances.js adds it to the window that can carry one');
});

test('the host takes a chrome strip only when it can actually be drawn', () => {
  function declare(declaration) {
    const host = createPluginHost({
      manifest: {
        id: 'chrome-fixture',
        name: 'Chrome fixture',
        version: '1.0.0',
        apiVersion: 2,
        main: 'main.js',
        permissions: []
      },
      pluginRoot: REPO,
      deps: {}
    });
    return function () { return host.registerGameChrome(declaration); };
  }
  const good = declare(DECLARATION);
  assert.doesNotThrow(good);
  assert.throws(declare(null), /registerGameChrome expects a declaration/);
  assert.throws(declare({ height: 0, controls: DECLARATION.controls, state: DECLARATION.state, action: DECLARATION.action }),
    /positive height/);
  assert.throws(declare({ height: 27, controls: function () { return []; },
    state: DECLARATION.state, action: DECLARATION.action }),
    /at least one control/);
  assert.throws(declare({ height: 27, controls: function () { return [{ kind: 'button', label: 'X' }]; },
    state: DECLARATION.state, action: DECLARATION.action }),
    /control needs an id/);
  assert.throws(declare({ height: 27, controls: function () { return [{ id: 'x' }]; },
    state: DECLARATION.state, action: DECLARATION.action }),
    /needs a label/);
  assert.throws(declare({ height: 27, controls: DECLARATION.controls, state: DECLARATION.state }),
    /action/);
});

test('a picker the reference draws without text is a control with no label, and still a control', () => {
  function declare(declaration) {
    const host = createPluginHost({
      manifest: {
        id: 'chrome-fixture', name: 'Chrome fixture', version: '1.0.0', apiVersion: 2,
        main: 'main.js', permissions: []
      },
      pluginRoot: REPO,
      deps: {}
    });
    return function () { return host.registerGameChrome(declaration); };
  }
  // cbPads and cbCells carry no text of their own in Root.cs (Root.cs:673-706): their options are
  // their labels. A button with no text is a dead control, so that one is still refused.
  const picker = {
    height: 27,
    controls: function () { return [{ id: 'pad', kind: 'select', label: '' }]; },
    state: DECLARATION.state,
    action: DECLARATION.action
  };
  assert.doesNotThrow(declare(picker));
  assert.throws(declare({
    height: 27,
    controls: function () { return [{ id: 'bank', kind: 'button', label: '' }]; },
    state: DECLARATION.state,
    action: DECLARATION.action
  }), /needs a label/);
  assert.throws(declare({
    height: 27,
    controls: function () { return [{ id: 'a', kind: 'select', label: '' }, { id: 'a', kind: 'select', label: '' }]; },
    state: DECLARATION.state,
    action: DECLARATION.action
  }), /Duplicate chrome control/);
});

test('the wrapper page carries the strip above the surface and asks the platform for it', () => {
  const page = fs.readFileSync(path.join(REPO, 'res', 'swf_wrapper.html'), 'utf8');
  assert.ok(page.indexOf('id="chrome"') !== -1, 'the strip is a box of its own');
  assert.ok(page.indexOf('id="stage"') !== -1, 'and the surface is its sibling, not its parent page');
  assert.ok(page.indexOf("getElementById('stage')") !== -1 || page.indexOf('getElementById("stage")') !== -1,
    'the movie is created inside the surface box');
  assert.ok(page.indexOf('aquastarChrome') !== -1, 'the page reads the platform API, not a game');
  // A page with no strip in it must not ask for one: the same wrapper serves plugins that want none.
  assert.ok(page.indexOf('view.enabled') !== -1 || page.indexOf('view && view.enabled') !== -1);
  assert.ok(page.indexOf('type="range"') === -1 || page.indexOf("slider.type = 'range'") !== -1,
    'the render scale is a slider');
  assert.ok(page.indexOf("slider.min = '25'") !== -1 && page.indexOf("slider.max = '100'") !== -1);
  assert.ok(page.indexOf("slider.step = 'any'") !== -1, 'the slider has no percentage snapping');
  assert.ok(page.indexOf('saveTimer = window.setTimeout(commit, 120)') !== -1,
    'dragging debounces the scale application');
  assert.ok(page.indexOf("surface.style.transform = 'scale('") !== -1,
    'the smaller backing surface is scaled back up to fill the stage');
  assert.ok(page.indexOf('api.setRenderScale') !== -1, 'the slider stores its value per window');
  assert.ok(page.indexOf('obj.tabIndex = 0') !== -1, 'the Flash object can take keyboard focus');
  assert.ok(page.indexOf('function focusGame()') !== -1, 'the toolbar can return focus to the game');
  assert.ok(page.indexOf('focusGame();') !== -1);
});


test('chrome passes generic choice metadata and values to the wrapper', async () => {
  const controls = [
    { id: 'saved', kind: 'select', label: 'Saved', refreshOnFocus: true, width: 130, placeholder: 'Empty' },
    { id: 'apply', kind: 'button', label: 'Apply', valueFrom: 'saved' }
  ];
  const h = harness(Object.assign({}, DECLARATION, {
    controls: () => controls,
    state: () => ({ options: { saved: [{ label: 'file', value: 'folder/file' }] } })
  }));
  const view = await h.chrome.pageView(h.win);
  assert.deepStrictEqual(view.controls, controls);
  assert.deepStrictEqual(view.options.saved, [{ label: 'file', value: 'folder/file' }]);
});

test('wrapper refreshes saved choices without equipping, and applies only on button click', async () => {
  const vm = require('vm');
  const nodes = [];
  function node(tag) {
    const n = { tag: tag, children: [], style: {}, events: {}, value: '', attributes: {},
      appendChild: function (child) {
        this.children.push(child);
        if (this.tag === 'select' && (this.children.length === 1 || child.selected)) this.value = child.value;
      },
      removeChild: function (child) { this.children.splice(this.children.indexOf(child), 1); },
      addEventListener: function (event, fn) { this.events[event] = fn; },
      setAttribute: function (key, value) { this.attributes[key] = value; },
      focus: function () {},
      querySelectorAll: function () { return this.children.filter(n => n.tag === 'select'); },
      querySelector: function () { return this.children.find(n => n.attributes['data-value-from'] === 'saved'); }
    };
    Object.defineProperty(n, 'firstChild', { get: () => n.children[0] });
    Object.defineProperty(n, 'lastChild', { get: () => n.children[n.children.length - 1] });
    nodes.push(n);
    return n;
  }
  ['chrome', 'stage', 'surface'].forEach(id => { node('div').id = id; });
  const controls = [
    { id: 'saved', kind: 'select', label: 'Saved', refreshOnFocus: true, width: 130, placeholder: 'Empty' },
    { id: 'apply', kind: 'button', label: 'Equip', valueFrom: 'saved' }
  ];
  let choices = [{ label: 'farm.gset', value: 'folder/farm.gset' }];
  const view = () => ({ enabled: true, height: 27, controls: controls, options: { saved: choices } });
  const calls = [];
  const events = {};
  const page = fs.readFileSync(path.join(REPO, 'res/swf_wrapper.html'), 'utf8');
  vm.runInNewContext(page.match(/<script>([\s\S]*?)<\/script>/)[1], {
    URLSearchParams: URLSearchParams, URL: URL,
    document: { createElement: node, getElementById: id => nodes.find(n => n.id === id && (id.indexOf('chrome-') !== 0 || nodes.find(n => n.id === 'chrome').children.includes(n))) },
    window: { location: { search: '?swf=https://example.com/game.swf' },
      addEventListener: (name, fn) => { events[name] = fn; },
      aquastarChrome: { getView: async () => view(), action: async (id, args) => {
        calls.push({ id: id, args: args }); return { view: view() };
      } }
    }
  });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  await flush();
  const strip = nodes.find(n => n.id === 'chrome');
  const select = strip.children.find(n => n.id === 'chrome-saved');
  assert.strictEqual(select.style.width, '130px');
  select.events.change();
  assert.strictEqual(calls.length, 0);
  choices = [{ label: 'boss.gset', value: 'boss.gset' }];
  select.events.focus();
  await flush();
  assert.strictEqual(select.value, 'boss.gset');
  assert.strictEqual(calls[0].id, 'saved');
  assert.strictEqual(calls[0].args.refresh, true);
  strip.children.find(n => n.id === 'chrome-apply').events.click();
  await flush();
  assert.strictEqual(calls[1].id, 'apply');
  assert.strictEqual(calls[1].args.value, 'boss.gset');
  choices = [];
  events.focus();
  await flush();
  const button = strip.children.find(n => n.id === 'chrome-apply');
  assert.strictEqual(button.disabled, true);
});

test('toolbar carries in-app progress labels and completion feedback through dispatch', async () => {
  const h = harness(Object.assign({}, DECLARATION, {
    controls: () => [{ id: 'apply', kind: 'button', label: 'Apply', pendingLabel: 'Applying…' }],
    action: () => ({ ok: true, message: 'Finished.' })
  }));
  assert.strictEqual((await h.chrome.pageView(h.win)).controls[0].pendingLabel, 'Applying…');
  assert.strictEqual((await h.chrome.dispatch(h.win, 'apply', {})).message, 'Finished.');
});

test('toolbar button shows progress and reports success or failure in an expiring toast', async () => {
  const source = fs.readFileSync(path.join(REPO, 'res/swf_wrapper.html'), 'utf8');
  const start = source.indexOf('    var toastTimer =');
  const end = source.indexOf("    /** The platform's render percentage", start);
  let finish;
  let status = '';
  let expire;
  let duration;
  const toast = { hidden: true, setAttribute(key, value) { this[key] = value; } };
  const nodes = { actionToast: toast };
  const context = {
    api: { action: () => new Promise(resolve => { finish = resolve; }) },
    window: { clearTimeout() {}, setTimeout(fn, ms) { expire = fn; duration = ms; } },
    document: { getElementById: id => nodes[id] || null },
    focusGame() {}, draw() {},
    el(tag, klass, text) {
      return { textContent: text, disabled: false, handlers: {},
        addEventListener(name, fn) { this.handlers[name] = fn; } };
    }
  };
  nodes.chromeStatus = { set textContent(value) { status = value; } };
  require('vm').runInNewContext(source.slice(start, end), context);
  const button = context.control({ id: 'apply', label: 'Apply', pendingLabel: 'Applying…' }, {});
  button.handlers.click();
  assert.strictEqual(button.textContent, 'Applying…');
  assert.strictEqual(button.disabled, true);
  assert.strictEqual(status, '', 'progress does not crowd the toolbar');
  finish({ ok: true, message: 'Finished.' });
  await new Promise(setImmediate);
  assert.strictEqual(toast.textContent, 'Finished.');
  assert.strictEqual(toast.hidden, false);
  assert.strictEqual(toast['data-error'], 'false');
  assert.strictEqual(duration, 4500);
  expire();
  assert.strictEqual(toast.hidden, true);
  assert.strictEqual(button.disabled, false);
  button.handlers.click();
  finish({ ok: false, error: 'Could not apply.' });
  await new Promise(setImmediate);
  assert.strictEqual(toast.textContent, 'Could not apply.');
  assert.strictEqual(toast['data-error'], 'true');
  assert.strictEqual(duration, 8000);
  assert.strictEqual(status, '');
  assert.strictEqual(button.disabled, false);
});

test('chrome passes context editor declarations and responses through dispatch', async () => {
  const editor = { title: 'Presets', selected: 'Farm', text: '2;4', items: [] };
  const h = harness(Object.assign({}, DECLARATION, {
    controls: () => [{ id: 'edit', kind: 'button', label: 'Edit', contextEditor: true }],
    action: () => ({ ok: true, editor: editor })
  }));
  assert.strictEqual((await h.chrome.pageView(h.win)).controls[0].contextEditor, true);
  assert.deepStrictEqual((await h.chrome.dispatch(h.win, 'edit', { contextEditor: true })).editor, editor);
});

test('popover closes after remembering temporary edits without native dialogs', async () => {
  const source = fs.readFileSync(path.join(REPO, 'res/swf_wrapper.html'), 'utf8');
  const calls = [];
  const nodes = [];
  function el(tag, className, text) {
    const node = { tag, className, textContent: text, value: '', style: {}, children: [], events: {},
      setAttribute() {}, focus() {}, contains() { return false; },
      appendChild(child) { this.children.push(child); },
      removeChild(child) { this.children.splice(this.children.indexOf(child), 1); },
      addEventListener(name, fn) { this.events[name] = fn; },
      remove() { this.removed = true; }
    };
    Object.defineProperty(node, 'firstChild', { get: () => node.children[0] });
    nodes.push(node);
    return node;
  }
  const events = {};
  const scope = {
    el, focusGame() {}, document: { body: el('body'), getElementById: () => null },
    window: { innerWidth: 800, clearTimeout() {}, setTimeout() { return 1; },
      addEventListener(name, fn) { events[name] = fn; }, removeEventListener() {} },
    api: { action: async (id, args) => {
      calls.push(args);
      return { editor: { title: 'Class', className: 'Class', selected: 'Farm',
        text: args.text || '1;2', items: [{ name: 'Farm', label: 'Farm' }] } };
    } }
  };
  require('vm').runInNewContext(source.slice(source.indexOf('    function openContextEditor'),
    source.indexOf('    /** One control, drawn')), scope);
  scope.openContextEditor({ id: 'edit', label: 'Skills' }, {
    getBoundingClientRect: () => ({ left: 10, bottom: 27 })
  });
  await new Promise(setImmediate);
  const text = nodes.find(node => node.tag === 'textarea');
  text.value = '4;3';
  text.events.input();
  events.keydown({ key: 'Escape', preventDefault() {} });
  await new Promise(setImmediate);
  assert.strictEqual(calls[1].draft, true);
  assert.strictEqual(calls[1].text, '4;3');
  assert.strictEqual(nodes.find(node => node.id === 'contextEditor').removed, true);
});
