// The Bank and Sets pages' own wiring (ticket #29). The pages are the one part of these windows
// that a displayed window would otherwise be the only way to check, so they are driven here
// against a deliberately small stand-in for the DOM, with the bridge replaced by a recorder.
// What this catches is the page's own plumbing - element ids, the bridge calls it makes and
// their arguments - not the app's rendering; that stays on docs/FLASH_CHECKLIST.md.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const pluginRoot = path.join(__dirname, '../../plugins/grimlite-parity');

function element() {
  const el = {
    children: [],
    listeners: {},
    textContent: '',
    className: '',
    disabled: false,
    checked: false,
    // A real <select> reports its first option as selected; the pages rely on that.
    title: '',
    value: '',
    appendChild: function (child) {
      el.children.push(child);
      return child;
    },
    addEventListener: function (type, fn) {
      (el.listeners[type] = el.listeners[type] || []).push(fn);
    }
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

// The pages run in their own vm realm, so an object they pass out has that realm's prototypes
// and deepStrictEqual would compare prototypes rather than shapes.
function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Load a page, run its inline script, and hand back its elements and the recorder.
function loadPage(file, ids, bridge) {
  const source = fs.readFileSync(file, 'utf8');
  const script = /<script>([\s\S]*?)<\/script>/.exec(source);
  assert.ok(script, 'no inline script in ' + file);

  const byId = {};
  ids.forEach(function (id) { byId[id] = element(); });
  const document = {
    title: '',
    getElementById: function (id) {
      assert.ok(byId[id], file + ' asks for a #' + id + ' that does not exist');
      return byId[id];
    },
    createElement: function () { return element(); }
  };

  vm.runInNewContext(script[1], { window: { aquastarBank: bridge, aquastarSets: bridge }, document: document });
  return { byId: byId, document: document, bridge: bridge };
}

// The page loads asynchronously; one macrotask is enough for these promise chains.
function settled() {
  return new Promise(function (resolve) { setTimeout(resolve, 0); });
}

const BANK_IDS = ['category', 'ac', 'allExcept', 'status', 'categoryLabel', 'acLabel',
  'allExceptLabel', 'bank', 'bankAll'];
const SETS_IDS = ['item', 'setList', 'savedList', 'status', 'refresh', 'add', 'clear', 'save',
  'open', 'setHeading', 'savedHeading'];

test('the Bank page fills both lists from the window and names its controls', async () => {
  const asked = [];
  const page = loadPage(path.join(pluginRoot, 'features/bank/bank.html'), BANK_IDS, {
    getLists: function () {
      asked.push('getLists');
      return Promise.resolve({ categories: ['Sword', 'Class'], acChoices: ['ACs', 'Non-ACs'] });
    },
    getMessages: function () {
      asked.push('getMessages');
      return Promise.resolve({
        title: 'Bank', categoryLabel: 'What to bank (optional)', acLabel: 'AC or Non-AC',
        allExcept: 'Bank all except selected', bank: 'Bank', bankAll: 'Bank All',
        working: 'Banking...', done: 'Transferred {n} of {t} item(s).', failed: 'No.'
      });
    }
  });
  await settled();

  assert.deepStrictEqual(asked.sort(), ['getLists', 'getMessages']);
  assert.strictEqual(page.byId.categoryLabel.textContent, 'What to bank (optional)');
  assert.strictEqual(page.byId.acLabel.textContent, 'AC or Non-AC');
  assert.strictEqual(page.byId.allExceptLabel.textContent, 'Bank all except selected');
  assert.strictEqual(page.byId.bank.textContent, 'Bank');
  assert.strictEqual(page.byId.bankAll.textContent, 'Bank All');
  assert.strictEqual(page.document.title, 'Bank');

  // A blank row first (the reference's dialogs open with nothing selected), then the choices.
  assert.deepStrictEqual(page.byId.category.children.map(function (o) { return o.value; }),
    ['', 'Sword', 'Class']);
  assert.deepStrictEqual(page.byId.ac.children.map(function (o) { return o.value; }),
    ['', 'ACs', 'Non-ACs']);
});

test('the Bank page sends the chosen category, AC-ness and mode, and reports the counts', async () => {
  const sent = [];
  const page = loadPage(path.join(pluginRoot, 'features/bank/bank.html'), BANK_IDS, {
    getLists: function () { return Promise.resolve({ categories: ['Sword'], acChoices: ['ACs', 'Non-ACs'] }); },
    getMessages: function () {
      return Promise.resolve({ done: 'Transferred {n} of {t} item(s).', working: 'Banking...' });
    },
    bankCategory: function (selection) {
      sent.push(['bankCategory', selection]);
      return Promise.resolve({ transferred: 2, total: 2, error: null });
    },
    bankAll: function (selection) {
      sent.push(['bankAll', selection]);
      return Promise.resolve({ transferred: 0, total: 3, error: 'the game refused it' });
    }
  });
  await settled();

  page.byId.category.value = 'Sword';
  page.byId.ac.value = 'Non-ACs';
  page.byId.allExcept.checked = true;
  click(page.byId.bank);
  click(page.byId.bankAll);
  await settled();

  assert.deepStrictEqual(plain(sent), [
    ['bankCategory', { category: 'Sword', ac: false, allExcept: true }],
    ['bankAll', { category: 'Sword', ac: false, allExcept: true }]
  ]);
  // Completion is reported, and a run that did not finish says why instead of claiming success.
  assert.strictEqual(page.byId.status.textContent, 'the game refused it');
  assert.strictEqual(page.byId.status.className, 'err');
});

test('the Bank page refuses to run with nothing selected, in the reference\'s words', async () => {
  const sent = [];
  const page = loadPage(path.join(pluginRoot, 'features/bank/bank.html'), BANK_IDS, {
    getLists: function () { return Promise.resolve({ categories: [], acChoices: [] }); },
    getMessages: function () { return Promise.resolve({}); },
    // The window's own refusal, produced by the logic the page drives.
    bankCategory: function (selection) {
      sent.push(selection);
      return Promise.resolve({ transferred: 0, total: 0, error: 'Please select Item type' });
    }
  });
  await settled();

  click(page.byId.bank);
  await settled();

  // Nothing is preselected, so the blank row reaches the window as "no choice".
  assert.deepStrictEqual(plain(sent), [{ category: null, ac: null, allExcept: false }]);
  assert.strictEqual(page.byId.status.textContent, 'Please select Item type');
});

test('the Sets page lists saved sets, fills the item combo and adds the selection to the set', async () => {
  const page = loadPage(path.join(pluginRoot, 'features/sets/sets.html'), SETS_IDS, {
    getMessages: function () {
      return Promise.resolve({
        window: {
          title: 'Set', refresh: 'R', add: 'Add', clear: 'Clear', save: 'Save', load: 'Load',
          equip: 'Equip', setHeading: 'Set', savedHeading: 'Saved sets'
        },
        added: 'Added to the set.', saved: 'Saved.', loaded: 'Loaded.', cleared: 'Cleared.',
        equipped: 'Equipped {n} item(s).'
      });
    },
    inventoryRows: function () {
      return Promise.resolve({
        rows: [
          { label: '', entry: null },
          { label: '[Weapons]', entry: null },
          { label: '', entry: null },
          { label: 'Sword of Awe', entry: { type: 'Weapon', name: 'Sword of Awe' } }
        ],
        error: null
      });
    },
    list: function () {
      return Promise.resolve({ sets: [{ name: 'mine.gset', path: 'mine.gset' }] });
    },
    open: function () { return Promise.resolve({ canceled: true }); },
    save: function (entries) {
      page.saved = entries;
      return Promise.resolve({ canceled: false, path: '/tmp/x.gset', error: null });
    }
  });
  await settled();

  assert.strictEqual(page.byId.setHeading.textContent, 'Set');
  assert.strictEqual(page.byId.savedHeading.textContent, 'Saved sets');
  assert.strictEqual(page.byId.refresh.textContent, 'R');
  assert.deepStrictEqual(page.byId.savedList.children.map(function (li) { return li.textContent; }), ['mine.gset']);

  // The separators are present but cannot be chosen: the combo has one selectable row.
  assert.strictEqual(page.byId.item.children.filter(function (o) { return !o.disabled; }).length, 1);

  page.byId.item.value = '3';
  click(page.byId.add);
  await settled();
  assert.deepStrictEqual(page.byId.setList.children.map(function (li) { return li.textContent; }),
    ['[Weapon] : Sword of Awe']);

  click(page.byId.save);
  await settled();
  assert.deepStrictEqual(plain(page.saved), [{ type: 'Weapon', name: 'Sword of Awe' }]);
  assert.strictEqual(page.byId.status.textContent, 'Saved.');

  // Clear empties the list and takes Save out of reach with it.
  click(page.byId.clear);
  await settled();
  assert.deepStrictEqual(page.byId.setList.children, []);
  assert.strictEqual(page.byId.save.disabled, true);
  assert.strictEqual(/\.equip\b/.test(fs.readFileSync(
    path.join(pluginRoot, 'features/sets/sets.html'), 'utf8')), false,
    'the Sets page must carry no Equip control');
});

test('clicking a saved set opens it, and opening shows the file\'s own list', async () => {
  const asked = [];
  const page = loadPage(path.join(pluginRoot, 'features/sets/sets.html'), SETS_IDS, {
    getMessages: function () { return Promise.resolve({ window: {}, loaded: 'Loaded.' }); },
    inventoryRows: function () { return Promise.resolve({ rows: [], error: null }); },
    list: function () { return Promise.resolve({ sets: [{ name: 'mine.gset', path: 'nested/mine.gset' }] }); },
    open: function (target) {
      asked.push(target);
      return Promise.resolve({
        canceled: false, path: 'nested/mine.gset', error: null,
        entries: [
          { type: 'Weapon', name: 'Blinding Light of Destiny' },
          { type: 'Class', name: 'ArchPaladin' }
        ]
      });
    }
  });
  await settled();

  click(page.byId.savedList.children[0]);
  await settled();

  // A listing entry opens by its own path, and the set is shown as the file holds it.
  assert.deepStrictEqual(asked, ['nested/mine.gset']);
  assert.deepStrictEqual(page.byId.setList.children.map(function (li) { return li.textContent; }), [
    '[Weapon] : Blinding Light of Destiny',
    '[Class] : ArchPaladin'
  ]);
  assert.strictEqual(page.byId.status.textContent, 'Loaded.');
});
