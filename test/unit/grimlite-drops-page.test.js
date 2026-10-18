// The drop page's own wiring (ticket #33). The page is the one part of this window that a
// displayed window would otherwise be the only way to check, so it is driven here against a
// deliberately small stand-in for the DOM, with the preload's bridge replaced by a recorder.
// What this catches is the page's own plumbing - element ids, the controls it draws, the calls it
// makes and their arguments - not the app's rendering; that stays on docs/FLASH_CHECKLIST.md.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const featureDir = path.join(__dirname, '../../plugins/grimlite-parity/features/drops');

function element(tag) {
  const el = {
    tagName: tag || 'div',
    children: [],
    listeners: {},
    textContent: '',
    className: '',
    checked: false,
    dataset: {},
    attributes: {},
    setAttribute: function (name, value) { el.attributes[name] = String(value); },
    appendChild: function (child) { el.children.push(child); return child; },
    addEventListener: function (type, fn) { (el.listeners[type] = el.listeners[type] || []).push(fn); },
    querySelectorAll: function () { return []; }
  };
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return ''; },
    set: function (value) { if (value === '') el.children = []; }
  });
  return el;
}

function click(el) {
  (el.listeners.click || []).forEach(function (fn) { fn({}); });
}

// The pages run in their own vm realm, so an object they pass out has that realm's prototypes.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const IDS = ['list', 'rows', 'count', 'reject', 'rejectLabel', 'status', 'take', 'blacklist',
  'clear', 'thName', 'thQty', 'thCategory', 'thFlags'];

function loadPage(bridge) {
  const source = fs.readFileSync(path.join(featureDir, 'drops.html'), 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(source);
  assert.ok(script, 'no inline script in drops.html');

  const byId = {};
  IDS.forEach(function (id) { byId[id] = element(); });
  const headers = ['thName', 'thQty', 'thCategory', 'thFlags'].map(function (id) { return byId[id]; });
  const document = {
    title: '',
    getElementById: function (id) {
      assert.ok(byId[id], 'drops.html asks for a #' + id + ' that does not exist');
      return byId[id];
    },
    createElement: function (tag) { return element(tag); },
    querySelectorAll: function (selector) { return selector === 'thead th' ? headers : []; }
  };
  vm.runInNewContext(script[1], { window: { aquastarDrops: bridge }, document: document, Object: Object });
  return { byId: byId, document: document, headers: headers };
}

function settled() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

function row(over) {
  return Object.assign({
    id: 10414,
    name: 'Blinding Light of Destiny',
    category: 'Sword',
    isAcItem: false,
    isMemberOnly: false,
    quantity: 1,
    takeable: true,
    reason: null
  }, over || {});
}

// A recorder for the preload surface: every call the page makes, and the answers it gets.
function fakeApi(state) {
  const calls = [];
  let onRows = function () {};
  return {
    calls: calls,
    pushRows: function (next) { onRows(next); },
    getMessages: function () {
      calls.push('getMessages');
      return Promise.resolve({
        title: 'DropList', name: 'Name', qty: 'Qty', category: 'Category',
        flags: 'AC | Member', take: 'Take Drop', blacklist: 'Reject & Blacklist',
        clear: 'Clear', rejectInGame: 'Reject ingame drop', count: 'Drop count :',
        pickFirst: 'Select a drop first.', taken: 'Took {n} drop(s).',
        cleared: 'Cleared.', rejectedN: 'Held {n} name(s) for this session.'
      });
    },
    state: function () { calls.push('state'); return Promise.resolve(state()); },
    watch: function () { calls.push('watch'); return Promise.resolve(state()); },
    take: function (names) {
      calls.push({ take: names });
      return Promise.resolve({ taken: names, failed: [] });
    },
    reject: function (on) {
      calls.push({ reject: on });
      return Promise.resolve(state());
    },
    blacklist: function (names) {
      calls.push({ blacklist: names });
      return Promise.resolve({ blacklisted: names.length });
    },
    clear: function () {
      calls.push('clear');
      return Promise.resolve({ cleared: true, rows: [], count: 0 });
    },
    onRows: function (listener) { onRows = listener; }
  };
}

test('the drop page draws the reference\'s four columns and the count from its own label', async () => {
  const api = fakeApi(function () { return { rows: [row({}), row({ id: 2, name: 'Quest Item', category: 'Quest Item', quantity: 3, isAcItem: true, isMemberOnly: true })], count: 2, rejecting: false, messages: {} }; });
  const page = loadPage(api);
  await settled();

  assert.deepStrictEqual(plain(page.byId.thName.textContent), 'Name');
  assert.deepStrictEqual(plain(page.byId.thQty.textContent), 'Qty');
  assert.deepStrictEqual(plain(page.byId.thCategory.textContent), 'Category');
  assert.deepStrictEqual(plain(page.byId.thFlags.textContent), 'AC | Member');
  // DropUi's own two buttons and tickbox, word for word.
  assert.strictEqual(page.byId.take.textContent, 'Take Drop');
  assert.strictEqual(page.byId.blacklist.textContent, 'Reject & Blacklist');
  assert.strictEqual(page.byId.clear.textContent, 'Clear');
  assert.strictEqual(page.byId.rejectLabel.textContent, 'Reject ingame drop');
  assert.strictEqual(page.document.title, 'DropList');

  // The count is the reference's own label plus the list's own count.
  assert.strictEqual(page.byId.count.textContent, 'Drop count : 2');

  // Two rows, each with its four cells: the AC | Member cell is the reference's own words.
  const rows = page.byId.rows.children;
  assert.strictEqual(rows.length, 2);
  const cells = rows[1].children.map(function (td) { return td.textContent; });
  assert.deepStrictEqual(plain(cells), ['Quest Item', '3', 'Quest Item', 'AC | Yes']);
  const free = rows[0].children.map(function (td) { return td.textContent; });
  assert.deepStrictEqual(plain(free), ['Blinding Light of Destiny', '1', 'Sword', 'No | Free']);
});

test('a row the player cannot take is drawn as blocked, with the game\'s own reason on it', async () => {
  const api = fakeApi(function () {
    return {
      rows: [row({})
        , row({ id: 2, name: 'Full Bag Drop', takeable: false, reason: 'Item Inventory Full!' })],
      count: 2,
      rejecting: false,
      messages: {}
    };
  });
  const page = loadPage(api);
  await settled();

  const rows = page.byId.rows.children;
  assert.strictEqual(rows[0].className, '', 'a takeable row is not marked');
  assert.strictEqual(rows[1].className, 'blocked', 'a row that cannot be taken is marked');
  // The marker carries the reason the game itself gave, not a paraphrase of it.
  assert.strictEqual(rows[1].children[0].attributes['data-reason'], 'Item Inventory Full!');
  assert.strictEqual(rows[1].children[0].textContent, 'Full Bag Drop');
  // An unknown verdict is not drawn as blocked: the game could not be asked.
  assert.strictEqual(rows[0].children[0].attributes['data-reason'], undefined);
});

test('Take Drop asks for the rows the user selected, and nothing when none is', async () => {
  const api = fakeApi(function () { return { rows: [row({})], count: 1, rejecting: false, messages: {} }; });
  const page = loadPage(api);
  await settled();

  click(page.byId.take);
  await settled();
  assert.deepStrictEqual(plain(api.calls.filter(function (c) { return c.take; })), [],
    'nothing is asked for while nothing is selected');
  assert.strictEqual(page.byId.status.textContent, 'Select a drop first.');
  assert.strictEqual(page.byId.status.className, 'err');

  // Selecting the row (FullRowSelect: a plain click takes exactly it) makes the same click take.
  click(page.byId.rows.children[0]);
  assert.strictEqual(page.byId.rows.children[0].className, 'selected');
  const asked = [];
  api.take = function (names) {
    asked.push(names);
    // The window answers with what it took and the rows as they now stand, which is how a taken
    // row leaves the page without a second round trip.
    return Promise.resolve({ taken: names, failed: [], rows: [], count: 0, rejecting: false });
  };
  click(page.byId.take);
  await settled();
  assert.deepStrictEqual(asked, [['Blinding Light of Destiny']]);
  assert.strictEqual(page.byId.status.textContent, 'Took 1 drop(s).');
  assert.strictEqual(page.byId.rows.children.length, 0, 'the taken row is gone');
});

test('a partial answer never blanks the list', async () => {
  const api = fakeApi(function () { return { rows: [row({})], count: 1, rejecting: false, messages: {} }; });
  const page = loadPage(api);
  await settled();
  click(page.byId.rows.children[0]);

  // A result that reports only what happened is not a new list.
  api.take = function () { return Promise.resolve({ taken: ['Blinding Light of Destiny'], failed: [] }); };
  click(page.byId.take);
  await settled();
  assert.strictEqual(page.byId.rows.children.length, 1, 'the row is still drawn');
  assert.strictEqual(page.byId.status.textContent, 'Took 1 drop(s).');
});

test('a take the game refused is reported with the reason, not as a success', async () => {
  const api = fakeApi(function () { return { rows: [row({})], count: 1, rejecting: false, messages: {} }; });
  const page = loadPage(api);
  await settled();
  click(page.byId.rows.children[0]);
  api.take = function () {
    return Promise.resolve({ taken: [], failed: [{ name: 'Blinding Light of Destiny', reason: 'Item Inventory Full!' }] });
  };
  click(page.byId.take);
  await settled();

  assert.strictEqual(page.byId.status.textContent, 'Blinding Light of Destiny: Item Inventory Full!');
  assert.strictEqual(page.byId.status.className, 'err');
});

test('the reject tickbox and the two other buttons reach the window', async () => {
  const api = fakeApi(function () { return { rows: [row({})], count: 1, rejecting: false, messages: {} }; });
  const page = loadPage(api);
  await settled();

  page.byId.reject.checked = true;
  (page.byId.reject.listeners.change || []).forEach(function (fn) { fn({}); });
  await settled();
  assert.deepStrictEqual(plain(api.calls.filter(function (c) { return c.reject !== undefined; })),
    [{ reject: true }]);

  click(page.byId.rows.children[0]);
  click(page.byId.blacklist);
  await settled();
  assert.deepStrictEqual(plain(api.calls.filter(function (c) { return c.blacklist; })),
    [{ blacklist: ['Blinding Light of Destiny'] }]);

  click(page.byId.clear);
  await settled();
  assert.ok(api.calls.indexOf('clear') !== -1, 'Clear reaches the window (which asks first)');
  assert.strictEqual(page.byId.status.textContent, 'Cleared.');
});

test('a row that has gone stops being selected, whichever way it went', async () => {
  let current = { rows: [row({}), row({ id: 2, name: 'Other' })], count: 2, rejecting: false, messages: {} };
  const api = fakeApi(function () { return current; });
  const page = loadPage(api);
  await settled();

  click(page.byId.rows.children[1]);
  assert.strictEqual(page.byId.rows.children[1].className, 'selected');

  // A push from the window: the taken row is gone, and so is its selection.
  current = { rows: [row({})], count: 1, rejecting: false, messages: {} };
  api.pushRows(current);
  await settled();
  assert.strictEqual(page.byId.rows.children.length, 1);
  assert.strictEqual(page.byId.rows.children[0].className, '');
});

test('the page asks the window to watch only when it is loaded', async () => {
  const api = fakeApi(function () { return { rows: [], count: 0, rejecting: false, messages: {} }; });
  loadPage(api);
  await settled();
  // A page that never registers for rows is a list that silently stops updating.
  assert.ok(api.calls.indexOf('watch') !== -1, 'the page subscribes to the window\'s rows');
  assert.ok(api.calls.indexOf('getMessages') !== -1, 'the page reads its own words');
});

test('the preload exposes exactly what the page asks for, and nothing else', () => {
  const source = fs.readFileSync(path.join(featureDir, 'preload_drops.js'), 'utf8');
  const page = fs.readFileSync(path.join(featureDir, 'drops.html'), 'utf8');
  const used = [];
  const calls = /api\.([A-Za-z]+)\(/g;
  let match = calls.exec(page);
  while (match) { used.push(match[1]); match = calls.exec(page); }
  assert.ok(used.length >= 7, 'the page uses the api');
  used.forEach(function (name) {
    assert.ok(new RegExp('\\b' + name + ':').test(source),
      'the page calls api.' + name + ' and the preload does not expose it');
  });
  // And the other way round: nothing is exposed that no page uses.
  const exposed = [];
  const declared = /\n\s{4}([A-Za-z]+):/g;
  let found = declared.exec(source);
  while (found) { exposed.push(found[1]); found = declared.exec(source); }
  assert.deepStrictEqual(exposed.slice().sort(), used.slice().sort(),
    'the preload and the page disagree about the surface');
});
