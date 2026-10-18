// The Fast travels window as the app surfaces it (ticket #32). Reference: Grimlite-Li's
// Grimoire/UI/Travel.cs, which Root.cs opens from Tools -> "Fast travels" (Root.cs:775) and
// Hotkeys.cs offers as its own action "Show Fast Travels" (Hotkeys.cs:402).
//
// The logic (which destination, which frame, which order) is covered by grimlite-travel.test.js
// against an injected game. What is covered here is the surfacing that logic is useless without:
// the registered window, the menu entry and keybind, and the page itself - driven against a
// deliberately small stand-in for the DOM, with the window's channels replaced by a recorder.
//
// One detail of the real thing is reproduced on purpose: the page is handed its groups through IPC,
// which copies them, so the payload a test feeds the page is JSON round-tripped here too. A page
// that matched a button to its group by object identity would pass with the original objects and
// draw nothing in a real window.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const url = require('url');
const vm = require('vm');

const platform = require('../../res/platform');
const travel = require('../../plugins/grimlite-parity/features/travel/travel.js');
const data = require('../../plugins/grimlite-parity/features/travel/travel-data.js');
const { createTravelWindow } = require('../../plugins/grimlite-parity/features/travel/travel-window.js');
const { createGameAccess } = require('../../plugins/grimlite-parity/features/travel/game-access.js');
const targets = require('../../plugins/grimlite-parity/features/hotkeys/action-targets.js');
const windows = require('../../plugins/grimlite-parity/windows.js');

const repoRoot = path.join(__dirname, '../..');
const pluginRoot = path.join(repoRoot, 'plugins/grimlite-parity');
const appVersion = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
const WINDOW_ID = 'grimlite-parity-travels';

function activateParity(deps) {
  return platform.activatePlugin({
    source: 'bundled',
    root: pluginRoot,
    manifest: JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'))
  }, {
    appVersion: appVersion,
    appDataDirectory: path.join(__dirname, '../tmp-plugin-data'),
    clearRequireCache: true,
    log: function () {},
    deps: deps || {}
  });
}

function grimliteItems(state) {
  return state.menus
    .map(function (contributor) {
      return contributor({ labels: { grimliteMenu: 'Grimlite' }, keybinds: {} });
    })
    .reduce(function (all, group) { return all.concat(group); }, [])
    .filter(function (menu) { return menu.label === 'Grimlite'; })
    .reduce(function (all, menu) { return all.concat(menu.submenu); }, []);
}

// ------------------------------------------------------------------ registration and surfacing

test('the Fast travels window is registered in the app\'s own window conventions', async () => {
  const activated = await activateParity();
  const found = activated.host._getState().featureWindows.filter(function (w) { return w.id === WINDOW_ID; });

  assert.strictEqual(found.length, 1, 'missing feature window ' + WINDOW_ID);
  const config = found[0].config;
  assert.strictEqual(config.webPreferences.sandbox, true, 'the window must be sandboxed');
  assert.strictEqual(config.webPreferences.plugins, false, 'the window must not load Flash');
  assert.strictEqual(config.webPreferences.contextIsolation, true, 'the window must isolate contexts');
  assert.strictEqual(config.webPreferences.nodeIntegration, false, 'the window must not expose Node');
  assert.strictEqual(config.useContentSize, true, 'the window sizes its content');
  assert.ok(/^file:\/\//.test(found[0].url), 'the window must be a local page');

  const page = url.fileURLToPath(found[0].url);
  assert.ok(page.indexOf(pluginRoot) === 0, 'the page must live in the plugin');
  assert.ok(fs.existsSync(page), 'missing page file: ' + page);
  assert.strictEqual(require('path').basename(page), 'travel.html');

  const preload = config.webPreferences.preload;
  assert.ok(typeof preload === 'string' && fs.existsSync(preload), 'the window needs a preload');
  const source = fs.readFileSync(preload, 'utf8');
  assert.ok(/require\((['"])electron\1\)/.test(source), 'a sandboxed preload may require electron');
  assert.strictEqual(source.indexOf("require('../"), -1, 'the preload must stay self-contained');

  // The id is also the one the Hotkeys window's own action targets, so "Show Fast Travels" stops
  // being inert the moment this window ships.
  assert.ok(windows.WINDOW_IDS.indexOf(WINDOW_ID) !== -1, 'the plugin must list the window it registers');
  assert.strictEqual(targets.WINDOW_BY_ACTION['Show Fast Travels'], WINDOW_ID);
});

test('the reference\'s own Tools entry opens it, and its own hotkey action does too', async () => {
  const opened = [];
  const activated = await activateParity({
    openFeatureWindow: function (id) { opened.push(id); return {}; }
  });
  const state = activated.host._getState();

  // Root.cs:775, word for word, and none of the other entries is allowed to claim it.
  const entries = grimliteItems(state).filter(function (item) { return item.label === 'Fast travels'; });
  assert.strictEqual(entries.length, 1, 'the Grimlite menu needs exactly one "Fast travels" entry');
  entries[0].click();
  assert.deepStrictEqual(opened, [WINDOW_ID]);

  // Hotkeys.cs:402's action, bound to a default of the plugin's own, opening the same window.
  const binding = state.keybinds.filter(function (k) { return k.id === 'grimliteFastTravels'; });
  assert.strictEqual(binding.length, 1, 'the reference\'s own action must be bindable');
  assert.strictEqual(typeof state.keybindDefaults.grimliteFastTravels, 'string');
  binding[0].action();
  assert.deepStrictEqual(opened, [WINDOW_ID, WINDOW_ID]);
});

// The app's own keys are read from res/const.js as source, the way test/unit/game-menu.test.js
// does, because that module reads Electron at load time.
test('the new default takes no key the app already holds', async () => {
  const activated = await activateParity();
  const key = activated.host._getState().keybindDefaults.grimliteFastTravels;
  const source = fs.readFileSync(path.join(repoRoot, 'res/const.js'), 'utf8');
  const block = source.slice(source.indexOf('const originalKeybinds'), source.indexOf('exports.originalKeybinds'));
  const appKeys = (block.match(/"[^"]+"/g) || []).map(function (quoted) { return quoted.slice(1, -1); });

  assert.ok(appKeys.indexOf('Alt+F') !== -1, 'the app\'s own keys must be found: ' + appKeys.join(', '));
  assert.strictEqual(appKeys.indexOf(key), -1, 'the window would take the app\'s own ' + key);
  // A modifier keeps the single-key bindings of the game plugin's own vocabulary free.
  assert.ok(/\+/.test(key), key + ' must keep a modifier');
});

// ------------------------------------------------------------------ the page and its preload

// A deliberately small stand-in for the DOM: enough for a page that builds elements, sets their
// text and listens for clicks, and no more. What this catches is the page's own plumbing - the
// controls it asks for, the calls it makes and their arguments - not the app's rendering.
function element() {
  const el = {
    children: [],
    listeners: {},
    textContent: '',
    className: '',
    disabled: false,
    checked: false,
    type: '',
    name: '',
    value: '',
    max: '',
    appendChild: function (child) {
      el.children.push(child);
      return child;
    },
    addEventListener: function (type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    }
  };
  return el;
}

function click(el) {
  (el.listeners.click || []).forEach(function (fn) { fn({}); });
}

// The pages run in their own vm realm, so a value they pass out has that realm's prototypes and a
// deepStrictEqual would compare prototypes rather than shapes.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Load the page, run its inline script, and hand back its elements and the recorder.
function loadPage(api) {
  const file = path.join(pluginRoot, 'features/travel/travel.html');
  const source = fs.readFileSync(file, 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(source);
  assert.ok(script, 'no inline script in travel.html');
  assert.doesNotThrow(function () { new vm.Script(script[1]); }, 'the page\'s inline script does not parse');

  // Every control the page reaches for is discovered from the page itself, and each one has to be
  // declared in the page's own markup: a getElementById that no element answers is a blank window.
  const used = (script[1].match(/getElementById\((['"])([^'"]+)\1\)/g) || []).map(function (hit) {
    return /(['"])([^'"]+)\1/.exec(hit)[2];
  });
  assert.ok(used.length >= 8, 'the page must draw itself out of the DOM: ' + used.join(', '));
  const byId = {};
  used.forEach(function (id) {
    assert.ok(source.indexOf('id="' + id + '"') !== -1, 'the page asks for #' + id + ', which it does not declare');
    byId[id] = element();
  });

  vm.runInNewContext(script[1], {
    window: { aquastarTravel: api },
    document: {
      title: '',
      getElementById: function (id) { return byId[id] || null; },
      createElement: function () { return element(); }
    }
  });
  return { byId: byId, document: { title: '' }, used: used };
}

// The page loads asynchronously: its words, then its tables, then the controls are wired.
function settled() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

// The window's own answer for the two lists, copied the way IPC copies it.
function groupPayload() {
  return JSON.parse(JSON.stringify({
    groups: data.GROUPS,
    buttons: data.BUTTONS,
    private: data.PRIVATE,
    aweTypes: data.AWE_TYPES,
    bypasser: data.BYPASSER
  }));
}

function fakeApi(answers) {
  answers = answers || {};
  const api = {
    calls: [],
    getMessages: function () {
      api.calls.push(['getMessages']);
      // The page runs in a real window with the plugin's own catalog; a page that only worked with
      // its fallback literals would be one whose strings never reach it.
      return Promise.resolve(answers.messages || require(path.join(pluginRoot, 'locales/en-US.js')).travelMessages);
    },
    getGroups: function () {
      api.calls.push(['getGroups']);
      return Promise.resolve(answers.groups || groupPayload());
    },
    run: function (id, options) {
      api.calls.push(['run', id, options]);
      return Promise.resolve((answers.run || {})[id] || { button: id, frames: [], error: null });
    },
    unlock: function (questId) {
      api.calls.push(['unlock', questId]);
      return Promise.resolve(answers.unlock || { packet: null, sent: false, error: null });
    },
    sendPacket: function (packet) {
      api.calls.push(['sendPacket', packet]);
      return Promise.resolve(answers.send || { packet: packet, sent: true, error: null });
    },
    copy: function (text) {
      api.calls.push(['copy', text]);
    }
  };
  return api;
}

// The buttons of one fieldset, in the order the page put them there.
function groupButtons(fieldset) {
  return fieldset.children.filter(function (child) {
    return typeof child.id === 'string' && child.id.indexOf('btn_') === 0;
  });
}

function idsOf(els) {
  return els.map(function (el) { return el.id.slice(4); });
}

test('the page draws every group in the column the reference puts it in, each button once', async () => {
  const api = fakeApi();
  const page = loadPage(api);
  await settled();
  await settled();

  // What the page asks for, in the order it asks: its words first, then the tables.
  assert.deepStrictEqual(api.calls.slice(0, 2), [['getMessages'], ['getGroups']]);

  // The two columns the designer lays out: grpTravel alone on the left (x=13), and the awe group,
  // Fast travels 2 and the bypasser down the right (x=183).
  const travels = page.byId.groupsLeft.children;
  const right = page.byId.groupsRight.children;
  assert.deepStrictEqual(travels.map(function (box) { return box.children[0].textContent; }),
    ['Fast travels']);
  // The awe group is the box the page's markup draws (its radio grid sits with its own button),
  // and the markup puts it below the bypasser - the designer's own order down the right column.
  assert.deepStrictEqual(right.map(function (box) { return box.children[0].textContent; }),
    ['Fast travels 2']);
  const markup = fs.readFileSync(path.join(pluginRoot, 'features/travel/travel.html'), 'utf8');
  assert.ok(/id="aweBox"/.test(markup), 'the awe group is its own box, outside the drawn columns');
  assert.ok(markup.indexOf('id="aweButtons"') > markup.indexOf('id="aweBox"'),
    'the shop button belongs inside the awe box, with the radio grid it is chosen in');
  assert.deepStrictEqual(idsOf(groupButtons(page.byId.aweButtons)), ['aweShop']);

  // Every button the window carries is drawn, exactly once, in the reference's own order.
  const drawn = idsOf(groupButtons(travels[0]))
    .concat(idsOf(groupButtons(page.byId.aweButtons))) // the awe group's own box…
    .concat(idsOf(groupButtons(right[0])));  // …then Fast travels 2
  assert.deepStrictEqual(drawn, data.BUTTONS.map(function (entry) { return entry.id; }));
  assert.strictEqual(new Set(drawn).size, drawn.length, 'no button may be drawn twice');

  // The group of the reference's own first box, button for button.
  assert.deepStrictEqual(idsOf(groupButtons(travels[0])),
    data.GROUPS[0].buttons.map(function (entry) { return entry.id; }));
  assert.deepStrictEqual(idsOf(groupButtons(page.byId.aweButtons)), ['aweShop']);
  assert.deepStrictEqual(idsOf(groupButtons(right[0])),
    data.GROUPS[2].buttons.map(function (entry) { return entry.id; }));

  // Each button says what the reference's own control says.
  const text = {};
  const all = groupButtons(travels[0]).concat(groupButtons(right[0]))
    .concat(groupButtons(page.byId.aweButtons));
  all.forEach(function (el) { text[el.id] = el.textContent; });
  assert.strictEqual(text.btn_tercess, 'Oblivion (tercess)');
  assert.strictEqual(text.btn_bypassAll, 'Bypass All');
  assert.strictEqual(text.btn_ultras, 'Ultraboss & Daily');
  assert.strictEqual(text.btn_aweShop, 'Awe Shop (museum)');
  assert.strictEqual(text.btn_doomvaultb, 'DoomvaultB');
  data.BUTTONS.forEach(function (entry) {
    assert.strictEqual(text['btn_' + entry.id], entry.label, entry.id + ' must keep the reference\'s own label');
  });
});

test('the page keeps the reference\'s own private box and enchantment grid', async () => {
  const api = fakeApi();
  const page = loadPage(api);
  await settled();
  await settled();

  // chkPriv with numPriv: the designer's own range and opening value, and the box starts off.
  assert.strictEqual(page.byId.privateToggle.checked, false);
  assert.strictEqual(Number(page.byId.privateNumber.value), 100000);
  assert.strictEqual(Number(page.byId.privateNumber.max), 1000000);

  // The two-column grid, in the designer's own order, with Lucky checked as it opens.
  const radios = page.byId.aweTypes.children.map(function (wrap) { return wrap.children[0]; });
  assert.deepStrictEqual(radios.map(function (r) { return r.value; }),
    data.AWE_TYPES.map(function (entry) { return entry.id; }));
  assert.deepStrictEqual(radios.map(function (r) { return r.checked; }),
    data.AWE_TYPES.map(function (entry) { return entry.checked; }));

  // A click carries the private box and the chosen shop type to the window.
  page.byId.privateToggle.checked = true;
  page.byId.privateNumber.value = '12345';
  click(page.byId.groupsLeft.children[0].children[1]); // Oblivion (tercess)
  await settled();
  assert.deepStrictEqual(plain(api.calls[api.calls.length - 1]),
    ['run', 'tercess', { isPrivate: true, privateNumber: 12345, aweType: 'lucky' }]);

  // The radio's own change event decides the shop: Thief, whose id the window's table carries.
  const thief = radios.filter(function (r) { return r.value === 'thief'; })[0];
  (thief.listeners.change || []).forEach(function (fn) { fn({}); });
  click(groupButtons(page.byId.aweButtons)[0]);
  await settled();
  assert.deepStrictEqual(plain(api.calls[api.calls.length - 1]),
    ['run', 'aweShop', { isPrivate: true, privateNumber: 12345, aweType: 'thief' }]);
});

test('the bypasser shows the packet the window generated, and copies and sends that one', async () => {
  const packet = travel.updateQuestPacket(20, 126);
  const api = fakeApi({ unlock: { packet: packet, sent: true, error: null } });
  const page = loadPage(api);
  await settled();
  await settled();

  // The real box hands its value over as a string (input[type=number]); the page parses it.
  page.byId.questId.value = '8956';
  click(page.byId.unlock);
  await settled();
  assert.deepStrictEqual(api.calls[api.calls.length - 1], ['unlock', 8956]);
  // The generated packet is shown, and it is the whole frame: what is copied is what is shown.
  assert.strictEqual(page.byId.packet.value, packet);
  // The reference's own packet box is read-only (Travel.cs's tbGeneratedPacket.ReadOnly).
  const markup = fs.readFileSync(path.join(pluginRoot, 'features/travel/travel.html'), 'utf8');
  assert.ok(/readonly/.test(markup.split('id="packet"')[1].slice(0, 24)), 'the packet box must be read-only');

  click(page.byId.copy);
  assert.deepStrictEqual(api.calls[api.calls.length - 1], ['copy', packet]);
  click(page.byId.send);
  await settled();
  assert.deepStrictEqual(api.calls[api.calls.length - 1], ['sendPacket', packet]);
});

test('a run the window refused is reported with its reason, never as a travel that happened', async () => {
  const api = fakeApi({
    run: { dage: { button: 'dage', frames: [], error: 'no member IsLoggedIn at sfc' } }
  });
  const page = loadPage(api);
  await settled();
  await settled();

  // The button is found by the label the page drew, not by a position in a group's row.
  function byLabel(page, label) {
    const drawn = page.byId.groupsLeft.children
      .concat(page.byId.groupsRight.children)
      .concat([page.byId.aweButtons])
      .reduce(function (all, box) { return all.concat(groupButtons(box)); }, []);
    return drawn.filter(function (el) { return el.textContent === label; })[0];
  }
  click(byLabel(page, 'Dage'));
  await settled();
  assert.strictEqual(api.calls[api.calls.length - 1][1], 'dage');
  assert.strictEqual(page.byId.status.textContent, 'no member IsLoggedIn at sfc');
  assert.strictEqual(page.byId.status.className, 'err');

  // A travel that did happen says which one, from the locale's own words.
  const joining = fakeApi({ run: {
    dage: { button: 'dage', action: 'join', map: 'underworld', cell: 's1', pad: 'Left', frames: [], error: null }
  } });
  const second = loadPage(joining);
  await settled();
  await settled();
  click(byLabel(second, 'Dage'));
  await settled();
  assert.strictEqual(second.byId.status.textContent, 'Joining underworld...');
  assert.strictEqual(second.byId.status.className, 'ok');

  // DoomvaultB with the relay off: the room is entered and its one server frame is not written,
  // so both halves are said, with the travel first because that is what the click was for.
  const half = fakeApi({ run: {
    doomvaultb: {
      button: 'doomvaultb', action: 'join', map: 'doomvaultb', cell: 'Enter', pad: 'Spawn',
      frames: [], error: 'The packet relay is off, so this frame was not sent: %xt%zm%setAchievement%'
    }
  } });
  const third = loadPage(half);
  await settled();
  await settled();
  click(byLabel(third, 'DoomvaultB'));
  await settled();
  assert.ok(/^Joining doomvaultb\.\.\. The packet relay is off/.test(third.byId.status.textContent),
    third.byId.status.textContent);
  assert.strictEqual(third.byId.status.className, 'err');
});

// ------------------------------------------------------------------ the window's channels

test('the window hands the page the two lists and runs one button, and never rejects', async () => {
  const calls = [];
  const game = {
    loaderCall: function (name, args) {
      calls.push([name, args]);
      return Promise.resolve(name === 'IsLoggedIn' ? true : null);
    },
    read: function (path) {
      calls.push(['read', path]);
      return Promise.resolve({ value: 'battleon', error: null });
    },
    sendClientFrame: function () { return Promise.resolve({ ok: true, error: null }); },
    sendServerFrame: function () { return Promise.resolve(true); },
    sleep: function () { return Promise.resolve(); }
  };
  // The window's own words, handed in the way its own createFromHost hands them.
  const locales = require(path.join(pluginRoot, 'locales/en-US.js'));
  const window = createTravelWindow({ game: game, messages: locales.travelMessages });

  const lists = await window.handle('travelGroups', null, []);
  assert.deepStrictEqual(lists.groups.map(function (group) { return group.id; }), ['travels', 'awe', 'travels2']);
  // The page cannot draw what it is not handed: every button travels with the group that owns it,
  // and the awe group's own shop button is among them.
  assert.deepStrictEqual(lists.buttons.map(function (entry) { return entry.id; }),
    data.BUTTONS.map(function (entry) { return entry.id; }));
  assert.ok(lists.buttons.every(function (entry) { return typeof entry.groupId === 'string'; }));
  assert.strictEqual(lists.buttons.filter(function (entry) { return entry.id === 'aweShop'; }).length, 1);
  assert.deepStrictEqual(lists.private, data.PRIVATE);
  assert.deepStrictEqual(lists.aweTypes, data.AWE_TYPES);

  const result = await window.handle('travelRun', null, ['dage', {}]);
  assert.strictEqual(result.action, 'join');
  assert.strictEqual(result.map, 'underworld');
  assert.deepStrictEqual(calls, [['IsLoggedIn', []], ['read', 'world.strMapName'], ['Join', ['underworld', 's1', 'Left']]]);

  // The window's own words come from the plugin's catalog, not from a second copy in the page.
  const messages = await window.handle('travelMessages', null, []);
  assert.strictEqual(messages.bypasser, locales.travelMessages.bypasser);
  assert.strictEqual(messages.bypassHint, locales.travelMessages.bypassHint);
  assert.strictEqual(messages.unlock, locales.travelMessages.unlock);
  assert.strictEqual(messages.title, locales.travelMessages.title);
  assert.strictEqual(messages.title, 'Fast travels');
  // The reference's own control words, which the page draws from these and nothing else.
  assert.strictEqual(messages.private, 'Private');
  assert.strictEqual(messages.aweGroup, 'Awe Enchantment Shop');
  assert.strictEqual(messages.bypasser, 'Map Bypasser');
  assert.strictEqual(messages.generatedPacket, 'Generated packet');
  assert.strictEqual(messages.copy, 'Copy');

  // A channel this window does not own is refused rather than answered with something plausible.
  assert.throws(function () { window.handle('travelNonsense'); }, /unknown travel channel/);
});

test('a window with no game to reach reports that, instead of a travel or a frame', async () => {
  // An app with no bridge channel at all (an older build): the window must say so, and must not
  // report a destination it never reached.
  const window = createTravelWindow({ game: createGameAccess({ log: function () {} }) });

  for (const id of ['dage', 'aweShop', 'ultras', 'bypassAll']) {
    const result = await window.handle('travelRun', null, [id, {}]);
    assert.strictEqual(result.error, 'this app has no game bridge channel', id);
    assert.strictEqual(result.action, undefined, id + ' must not report a travel it never made');
  }

  const unlock = await window.handle('travelUnlock', null, [8956]);
  assert.ok(/no game bridge channel/.test(unlock.error), unlock.error);
  assert.strictEqual(unlock.packet, undefined, 'a refusal must not look like a generated packet');

  const sent = await window.handle('travelSendPacket', null, ['{"t":"xt"}']);
  assert.strictEqual(sent.sent, false);
  assert.strictEqual(sent.error, 'this app has no game bridge channel');
});

test('each channel the page asks for is one the window answers', function () {
  const handlers = {};
  const window = createTravelWindow({
    game: { loaderCall: function () { return Promise.resolve(true); } },
    host: {
      ipc: {
        handle: function (channel, listener) { handlers[channel] = listener; },
        on: function (channel, listener) { handlers[channel] = listener; }
      }
    }
  });
  window.attach();

  // The page speaks through its preload; a preload call with no handler on the other side is a
  // button that silently does nothing, so the two lists are compared rather than trusted.
  const preload = fs.readFileSync(path.join(pluginRoot, 'features/travel/preload_travel.js'), 'utf8');
  const asked = (preload.match(/CH\('([^']+)'\)/g) || []).map(function (hit) {
    return /'([^']+)'/.exec(hit)[1];
  });
  assert.ok(asked.length >= 6, 'the preload must expose the page\'s calls: ' + asked.join(', '));
  asked.forEach(function (channel) {
    assert.strictEqual(typeof handlers[channel], 'function', 'nothing answers the preload\'s ' + channel);
  });

  // The one call that is a send rather than an invoke is the reference's own Copy button, and the
  // clipboard is main-process-only under a sandboxed window. Handing over anything at all - text,
  // or a page's own mistake - must not throw at a window that cannot report it.
  assert.strictEqual(typeof handlers.travelCopy, 'function');
  assert.doesNotThrow(function () { handlers.travelCopy({}, 'a packet'); });
  assert.strictEqual(handlers.travelCopy({}, ''), undefined);
  // A clipboard that is not there is logged rather than thrown: in this process there is no
  // Electron to write with, which is exactly the case the channel has to survive.
  assert.doesNotThrow(function () { handlers.travelCopy({}, null); });
});
