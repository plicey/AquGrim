// The Bot Manager window (#36): the reference's eleven tabs, its six lists and its editing
// conventions. The sheet it draws comes from the plugin's main process (bot/tabs.js, the
// transcription of BotManager.Designer.cs), so this file holds no control list of its own - it
// renders whatever the sheet says, wires the handlers by control id, and sends every edit to the
// document the main process holds.
//
// Dialogs are HTML because a sandboxed page has no window.open modal: the property form is the
// generated one (UserFriendlyCommandEditor.Show), reachable from it the raw JSON editor
// (RawCommandEditor), and the copy/paste box stands in for the system clipboard the reference
// reads and writes directly.
(function () {
  var api = window.aquastarBotManager;
  if (!api) { return; }

  var LIST_LABELS = ['Commands', 'Skills', 'Quests', 'Drops', 'Boosts', 'Items'];

  var sheet = null;
  var controlsById = {};
  var tabsById = {};
  var state = null;
  var multiline = false;
  var list = document.getElementById('list');
  var tabHost = document.getElementById('tabHost');

  var messages = {
    title: 'Bot Manager',
    load: 'Load bot',
    save: 'Save bot',
    ok: 'OK',
    cancel: 'Cancel',
    raw: 'Raw Command Editor',
    copy: 'Copy commands as text',
    copyHint: 'The reference puts this on the system clipboard.',
    paste: 'Paste',
    pasteHint: 'Paste a copied bot or command, then OK.',
    opened: 'Opened.',
    saved: 'Saved.',
    customizer: 'Command Customizer',
    fonts: 'Change Fonts',
    multiline: 'Multiline Toggle',
    tabpages: 'Toggle Tabpages',
    addFolder: 'Folder name',
    empty: 'No bot is open. Load one, or drop a .gbot on the list.',
    rowHint: 'Double-click a command to edit it. Ctrl+click inserts above; Alt+click takes the variant.',
    colour: 'Colour',
    centered: 'Centered',
    size: 'Commands size',
    saveSize: 'Save Size',
    numberOfBots: 'Number of Bots: ',
    folder: 'Folder'
  };

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  }

  function label(text, control, host) {
    var wrap = el('label', control.kind === 'tick' || control.kind === 'radio' ? 'tick' : 'inline');
    wrap.appendChild(control);
    if (text) wrap.appendChild(document.createTextNode(' ' + text));
    host.appendChild(wrap);
    return wrap;
  }

  function setStatus(text, bad) {
    var bar = document.getElementById('path');
    bar.textContent = text || '';
    bar.className = bad ? 'bad' : '';
  }

  // ---------------------------------------------------------------- the sheet

  function control(entry) {
    var node;
    switch (entry.kind) {
    case 'group':
      node = el('fieldset', 'group');
      node.appendChild(el('legend', null, entry.text || ''));
      (entry.children || []).forEach(function (child) { node.appendChild(control(child)); });
      return node;
    case 'split':
    case 'panel':
    case 'grid':
      node = el('div', entry.kind);
      (entry.children || []).forEach(function (child) { node.appendChild(control(child)); });
      return node;
    case 'button':
      node = el('button', 'sheet-button', entry.text || entry.id);
      node.id = entry.id;
      node.addEventListener('click', function (event) {
        press(entry.id, { alt: event.altKey, ctrl: event.ctrlKey || event.metaKey });
      });
      return node;
    case 'tick':
    case 'radio':
      node = el('input');
      node.type = entry.kind === 'tick' ? 'checkbox' : 'radio';
      if (entry.kind === 'radio') node.name = entry.id;
      node.id = entry.id;
      return label(entry.text, node, el('span'));
    case 'text':
      node = el('input', 'sheet-text');
      node.type = 'text';
      node.id = entry.id;
      node.placeholder = entry.text || '';
      return node;
    case 'number':
      node = el('input', 'sheet-number');
      node.type = 'number';
      node.id = entry.id;
      return node;
    case 'select':
      node = el('select', 'sheet-select');
      node.id = entry.id;
      (entry.options || []).forEach(function (option) {
        var item = el('option', null, option);
        item.value = option;
        node.appendChild(item);
      });
      return node;
    case 'label':
      return el('span', 'sheet-label', entry.text || '');
    case 'list':
      node = el('select', 'sheet-list');
      node.id = entry.id;
      node.multiple = true;
      node.size = 5;
      (entry.options || []).forEach(function (option) {
        var item = el('option', null, option);
        item.value = option;
        node.appendChild(item);
      });
      return node;
    case 'rtf':
      node = el('div', 'sheet-rtf', entry.text || '');
      node.id = entry.id;
      return node;
    case 'tree':
      node = el('ul', 'sheet-tree');
      node.id = entry.id;
      return node;
    default:
      node = el('div', 'sheet-unknown');
      node.id = entry.id;
      return node;
    }
  }

  function index(controls) {
    (controls || []).forEach(function (entry) {
      if (entry.id) { controlsById[entry.id] = entry; }
      index(entry.children);
    });
  }

  function buildSheet() {
    var bar = document.getElementById('tabs');
    (sheet.tabs || []).forEach(function (tab, position) {
      tabsById[tab.id] = tab;
      var button = el('button', 'tab', tab.title);
      button.id = 'tab-' + tab.id;
      button.addEventListener('click', function () { showTab(tab.id); });
      bar.appendChild(button);
      if (position === 0) { showTab(tab.id); }
    });
    // The left column's controls carry the reference's ids as well.
    index(sheet.column);
  }

  function showTab(id) {
    var tab = tabsById[id];
    if (!tab) return;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs .tab'), function (node) {
      node.classList.toggle('active', node.id === 'tab-' + id);
    });
    tabHost.textContent = '';
    var page = el('div', 'tabpage');
    (tab.controls || []).forEach(function (entry) { page.appendChild(control(entry)); });
    tabHost.appendChild(page);
    index(tab.controls);
    if (id === 'bots') { drawTree(); bindTreeControls(); }
    applyConfiguration();
    wires();
  }

  // ---------------------------------------------------------------- values

  function valuesFromSheet() {
    var values = {};
    Object.keys(controlsById).forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      if (node.type === 'checkbox' || node.type === 'radio') values[id] = node.checked;
      else values[id] = node.value;
    });
    values.lstDrops = textsOf('Drops');
    values.lstItems = textsOf('Items');
    values.lstBoosts = textsOf('Boosts');
    // cbBoosts shows the game's own server-use objects; the row carries one when it has it.
    values.cbBoostsSelected = rowAt('cbBoosts', 'Boosts');
    values.rbTemp = checked('rbTemp');
    values.cbJoinMapSwf = checked('cbJoinMapSwf');
    values.chkQuestItem = checked('chkQuestListItem');
    values.chkIsTempF = checked('chkIsTempF');
    values.cbBlankFirstF = checked('cbBlankFirstF');
    values.chkQAddToWhitelistItem = checked('chkQRewards');
    return values;
  }

  function checked(id) {
    var node = document.getElementById(id);
    return !!(node && node.checked);
  }

  function textsOf(key) {
    var rows = state && state.lists ? state.lists[key] : null;
    return (rows || []).map(function (row) { return row.text; });
  }

  function rowAt(id, key) {
    var node = document.getElementById(id);
    var rows = state && state.lists ? state.lists[key] : null;
    if (!rows || !rows.length) return null;
    var at = node && node.selectedIndex >= 0 ? node.selectedIndex : 0;
    var row = rows[at];
    return row ? { $type: 'Grimoire.Game.Data.InventoryItem, Grimoire', Name: row.text } : null;
  }

  function applyConfiguration() {
    if (!state || !state.configuration) return;
    Object.keys(controlsById).forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      var key = (sheet.settings || {})[id] || (sheet.numbers || {})[id];
      if (!key) return;
      var value = state.configuration[key];
      if (node.type === 'checkbox') node.checked = value === true;
      else if (value !== undefined && value !== null) node.value = String(value);
    });
    setValue('txtAuthor', state.author);
    setValue('txtDescription', state.description);
    setValue('txtSaved', state.tree ? state.tree.directory : '');
    var merge = document.getElementById('chkMerge');
    if (merge) merge.checked = state.merge === true;
    var selector = document.getElementById('cbLists');
    if (selector && state.selected) selector.value = state.selected;
    drawInfo();
  }

  function setValue(id, value) {
    var node = document.getElementById(id);
    if (node && value !== undefined && value !== null) node.value = String(value);
  }

  // ---------------------------------------------------------------- the list

  function drawList() {
    list.textContent = '';
    var rows = state && state.lists && state.lists[state.selected] ? state.lists[state.selected] : [];
    var selection = (state && state.selection) || [];
    rows.forEach(function (row, at) {
      var item = el('li', 'row');
      item.textContent = '[' + at + '] ' + row.text;
      item.style.color = '#' + hexOf(row.colour);
      if (row.centered) item.classList.add('centered');
      if (selection.indexOf(at) !== -1) item.classList.add('picked');
      item.dataset.index = String(at);
      list.appendChild(item);
    });
    if (!rows.length) list.appendChild(el('li', 'empty', messages.empty));
    drawCounters();
    drawStyle();
  }

  function hexOf(argb) {
    var value = String(argb || 'FFDCDCDC');
    return value.length === 8 ? value.slice(2) : value;
  }

  function drawCounters() {
    var host = document.getElementById('counters');
    host.textContent = '';
    LIST_LABELS.forEach(function (key) {
      var text = state && state.labels
        ? (key === 'Commands' ? state.labels.commands : state.labels[key.toLowerCase()])
        : key + ': 0';
      var node = el('span', 'counter' + (state && state.selected === key ? ' active' : ''),
        String(text).replace(/\n/g, ' '));
      node.addEventListener('click', function () { select(key); });
      host.appendChild(node);
    });
  }

  function select(key, selection) {
    return api.select(key, selection).then(applyState);
  }

  function drawStyle() {
    var style = state && state.style;
    var size = style && style.fontSize ? style.fontSize : 10;
    list.style.fontSize = Math.max(6, size) + 'px';
    if (style && style.font) document.body.style.fontFamily = style.font;
  }

  function selectionOf(index) {
    var current = (state && state.selection) || [];
    var at = current.indexOf(index);
    var out = current.slice();
    if (at === -1) out.push(index); else out.splice(at, 1);
    return out;
  }

  function applyState(next) {
    if (!next) return;
    state = Object.assign({}, state, next);
    if (next.clipboard !== undefined) api.clipboardWrite(next.clipboard);
    drawList();
    applyConfiguration();
    if (next.error) setStatus(next.error, true);
    else if (next.path) setStatus(messages.opened + ' ' + next.path, false);
    else if (next.clipboard !== undefined) setStatus(next.clipboard ? messages.copyHint : '', false);
  }

  // ---------------------------------------------------------------- buttons

  function press(id, modifiers) {
    if ((sheet.commandButtons || []).indexOf(id) !== -1) {
      return api.add(id, valuesFromSheet(), modifiers).then(applyState);
    }
    if ((sheet.listButtons || []).indexOf(id) !== -1) {
      return api.addList(id, valuesFromSheet(), modifiers).then(applyState);
    }
    if ((sheet.gameButtons || []).indexOf(id) !== -1) {
      return api.game(id, modifiers).then(function (result) {
        // A control the game cannot answer reports why; it never fills a field with nothing.
        if (!result || result.ok !== true) {
          setStatus((result && result.error) || 'the game did not answer', true);
          return;
        }
        fillFromGame(id, result.values, modifiers);
      });
    }
    switch (id) {
    case 'btnRemove': return api.key('remove').then(applyState);
    case 'btnClear': return api.key('clear', { all: checked('chkAll') }).then(applyState);
    case 'btnUp': return api.key('moveUp').then(applyState);
    case 'btnDown': return api.key('moveDown').then(applyState);
    case 'btnSearchCmd': return api.key('find', { text: value('txtSearchCmd') }).then(applyState);
    case 'btnSave': return save(true);
    case 'btnLoad': return api.load(null).then(applyState);
    case 'btnLoadCmd': return loadCommand();
    case 'btnStatementAdd': return api.add('btnStatementAdd', valuesFromSheet(), {}).then(applyState);
    case 'btnSetBotsDir': return api.chooseDirectory().then(function (result) { state = null; return applyState(result); });
    case 'btnSavedAdd': return addFolder();
    case 'btnSoundAdd': return addSound();
    case 'btnSoundDelete': return removeSound();
    // btnSoundTest_Click: the reference beeps five times to test the drop notification.
    case 'btnSoundTest': return api.beep();
    case 'lstLogText': return null;
    default: return Promise.resolve(null);
    }
  }

  function value(id) {
    var node = document.getElementById(id);
    return node ? node.value : '';
  }

  /**
   * Write a game read into the fields the control owns, using the reference's own branches: the
   * plain press replaces each box, the alt press appends to it (btnCurrCell_Click). The sheet
   * carries the mapping, so this never spells a control's behaviour out itself.
   */
  function fillFromGame(id, values, modifiers) {
    var spec = (sheet.gameRows || {})[id] || {};
    var branch = (modifiers && modifiers.alt && spec.alt) || (modifiers && modifiers.ctrl && spec.ctrl) || spec.plain || {};
    var set = branch.append || branch;
    var appending = !!branch.append;
    Object.keys(set).forEach(function (controlId) {
      var node = document.getElementById(controlId);
      if (!node) return;
      var next = values[set[controlId]];
      if (next === undefined || next === null) return;
      node.value = appending ? (node.value + ',' + next) : String(next);
    });
    setStatus(messages.read || 'Read from the game.', false);
  }

  function loadCommand() {
    return api.load(null).then(function (result) {
      if (!result || !result.path || result.canceled) return applyState(result);
      return api.add('btnLoadCmd', Object.assign(valuesFromSheet(), {
        loadFileName: result.path.replace(/^.*[\\/]/, ''),
        loadFilePath: result.path
      }), {}).then(applyState);
    });
  }

  function addSound() {
    var box = document.getElementById('txtSoundItem');
    var target = document.getElementById('lstSoundItems');
    if (!box || !target || !box.value) return Promise.resolve(null);
    var option = el('option', null, box.value);
    option.value = box.value;
    target.appendChild(option);
    box.value = '';
    return Promise.resolve(null);
  }

  function removeSound() {
    var target = document.getElementById('lstSoundItems');
    if (target && target.selectedIndex > -1) target.remove(target.selectedIndex);
    return Promise.resolve(null);
  }

  function save(ask) {
    return api.save({ path: state ? state.path : null, ask: ask === true }).then(applyState);
  }

  // ---------------------------------------------------------------- the Bots tab

  function bindTreeControls() {
    // lint: no-op; the tree's own controls are wired through press() like every other button.
  }

  function drawTree() {
    var host = document.getElementById('treeBots');
    if (!host || !state || !state.tree) return;
    host.textContent = '';
    var bots = document.getElementById('lblBots');
    if (bots) bots.textContent = messages.numberOfBots + state.tree.count;
    appendNodes(host, state.tree.nodes || [], []);
  }

  function appendNodes(host, nodes, pathSoFar) {
    nodes.forEach(function (node) {
      var path = pathSoFar.concat([node.name]);
      var item = el('li', node.type);
      var name = el('span', null, node.name);
      name.dataset.path = path.join('/');
      name.addEventListener('click', function (event) {
        event.stopPropagation();
        // treeBots_AfterSelect: a folder is a branch, a file is a bot. Ctrl+click adds a command.
        return api.treeSelect(path, event.ctrlKey || event.metaKey).then(function (next) {
          state = Object.assign({}, state, next);
          if (next.tree) { state.tree = next.tree; drawTree(); }
          drawList();
          if (next.error) setStatus(next.error, true);
          else setStatus(node.name, false);
        });
      });
      if (node.lazy) {
        name.addEventListener('dblclick', function (event) {
          event.stopPropagation();
          expand(path, item);
        });
      }
      item.appendChild(name);
      if (node.lazy) {
        var lazy = el('ul', 'lazy');
        lazy.appendChild(el('li', 'loading', node.lazy));
        item.appendChild(lazy);
      }
      host.appendChild(item);
    });
  }

  function expand(path, item) {
    return api.tree(path).then(function (result) {
      var old = item.querySelector('ul.lazy');
      if (old) item.removeChild(old);
      var nested = el('ul', 'nested');
      appendNodes(nested, result.nodes || [], path);
      item.appendChild(nested);
    });
  }

  function addFolder() {
    var box = document.getElementById('txtSavedAdd');
    var name = box && box.value ? box.value : window.prompt(messages.addFolder);
    if (!name) return Promise.resolve(null);
    return api.addFolder(name).then(function (next) {
      if (box) box.value = '';
      state = Object.assign({}, state, next, { tree: next });
      drawTree();
      if (next.error) setStatus(next.error, true);
      else setStatus(next.directory || '', false);
    });
  }

  function drawInfo() {
    var info = document.getElementById('rtbInfo');
    if (info && state && state.description) info.textContent = String(state.description);
  }

  // ---------------------------------------------------------------- dialogs

  function openModal(title) {
    document.getElementById('modalTitle').textContent = title;
    var body = document.getElementById('modalBody');
    body.textContent = '';
    document.getElementById('modal').hidden = false;
    document.getElementById('modalRaw').hidden = true;
    return body;
  }

  function closeModal() {
    document.getElementById('modal').hidden = true;
    document.getElementById('modalOk').onclick = null;
    document.getElementById('modalCancel').onclick = null;
    document.getElementById('modalRaw').hidden = true;
    document.getElementById('modalOk').textContent = messages.ok;
  }

  /** UserFriendlyCommandEditor.Show: one labelled box per key, plus the raw escape hatch. */
  function openForm(index) {
    return api.form(index).then(function (form) {
      if (!form.fields.length) return;
      var body = openModal(form.className || 'Command');
      var inputs = {};
      form.fields.forEach(function (field) {
        var row = el('div', 'field');
        row.appendChild(el('label', null, field.label));
        var input = el('input', 'sheet-text');
        input.value = field.value;
        input.dataset.key = field.key;
        row.appendChild(input);
        inputs[field.key] = input;
        body.appendChild(row);
      });
      document.getElementById('modalRaw').hidden = false;
      document.getElementById('modalRaw').onclick = function () {
        closeModal();
        openRaw(index, form.json);
      };
      document.getElementById('modalOk').onclick = function () {
        var values = {};
        Object.keys(inputs).forEach(function (key) { values[key] = inputs[key].value; });
        api.edit(index, values).then(function (next) { closeModal(); applyState(next); });
      };
      document.getElementById('modalCancel').onclick = closeModal;
      var first = form.fields[0];
      if (first && inputs[first.key]) inputs[first.key].focus();
    });
  }

  function openRaw(index, text) {
    openTransfer(messages.raw, text || '', function (value) {
      api.raw(index, value).then(function (next) {
        applyState(next);
        if (next.ok === false) setStatus(next.error, true);
      });
    });
  }

  function openTransfer(title, text, onOk) {
    document.getElementById('transferTitle').textContent = title;
    var box = document.getElementById('transferText');
    box.value = text || '';
    document.getElementById('transfer').hidden = false;
    document.getElementById('transferOk').onclick = function () {
      var value = box.value;
      document.getElementById('transfer').hidden = true;
      onOk(value);
    };
    document.getElementById('transferCancel').onclick = function () {
      document.getElementById('transfer').hidden = true;
    };
    box.focus();
  }

  /** Paste: the reference's Ctrl+V reads the system clipboard; the box stands in for it. */
  function openPaste() {
    return api.clipboardRead().then(function (text) {
      openTransfer(messages.paste, text, function (value) {
        api.key('paste', { text: value }).then(applyState);
      });
    });
  }

  // ---------------------------------------------------------------- right-click menu

  function openMenu() {
    var popup = document.getElementById('menuPopup');
    popup.textContent = '';
    var items = [
      [messages.fonts, openFonts],
      [messages.multiline, toggleMultiline],
      [messages.tabpages, toggleTabpages],
      [messages.customizer, openCustomizer]
    ];
    items.forEach(function (pair) {
      var item = el('button', 'menu-item', pair[0]);
      item.addEventListener('click', function () {
        popup.hidden = true;
        pair[1]();
      });
      popup.appendChild(item);
    });
    popup.hidden = false;
  }

  function openFonts() {
    var current = state && state.style && state.style.font ? state.style.font : 'Segoe UI';
    var family = window.prompt(messages.fonts, current);
    if (!family) return;
    api.style({ action: 'font', value: family }).then(applyState);
  }

  function toggleMultiline() {
    multiline = !multiline;
    list.classList.toggle('multiline', multiline);
  }

  function toggleTabpages() {
    var right = document.getElementById('right');
    right.hidden = !right.hidden;
  }

  /** CommandColorForm: a name to colour, a colour, a centring tick and the size slider. */
  function openCustomizer() {
    var names = (state && state.style && state.style.customisable) || [];
    var body = openModal(messages.customizer);
    var picker = el('select', 'sheet-select');
    names.forEach(function (name) {
      var option = el('option', null, name);
      option.value = name;
      picker.appendChild(option);
    });
    body.appendChild(picker);

    var colour = el('input');
    colour.type = 'color';
    var centered = el('input');
    centered.type = 'checkbox';
    var centeredLabel = el('label', 'tick');
    centeredLabel.appendChild(centered);
    centeredLabel.appendChild(document.createTextNode(' ' + messages.centered));
    body.appendChild(colour);
    body.appendChild(centeredLabel);

    var slider = el('input', 'size-slider');
    slider.type = 'range';
    slider.min = '20';
    slider.max = '100';
    slider.value = String(state && state.style ? state.style.commandsSize : 60);
    var sizeLabel = el('span', 'sheet-label', messages.size + ': ' + slider.value);
    slider.addEventListener('input', function () { sizeLabel.textContent = messages.size + ': ' + slider.value; });
    body.appendChild(slider);
    body.appendChild(sizeLabel);

    function sync() {
      colour.value = '#' + hexOf(currentColour(picker.value));
      centered.checked = currentCentered(picker.value);
    }
    picker.addEventListener('change', sync);
    sync();

    document.getElementById('modalOk').textContent = messages.saveSize;
    document.getElementById('modalOk').onclick = function () {
      api.style({ action: 'colour', name: picker.value, value: 'FF' + colour.value.replace('#', '').toUpperCase() })
        .then(function () { return api.style({ action: 'centered', name: picker.value, value: centered.checked }); })
        .then(function () { return api.style({ action: 'size', value: Number(slider.value) }); })
        .then(function (next) { closeModal(); applyState(next); });
    };
    document.getElementById('modalCancel').onclick = closeModal;
  }

  function currentColour(name) {
    var colours = (state && state.style && state.style.colours) || {};
    var key = (String(name).indexOf('Cmd') === 0 ? String(name).slice(3) : String(name)) + 'Color';
    return colours[key] || 'FFDCDCDC';
  }

  function currentCentered(name) {
    var flags = (state && state.style && state.style.centered) || {};
    var key = (String(name).indexOf('Cmd') === 0 ? String(name).slice(3) : String(name)) + 'Centered';
    return flags[key] === true;
  }

  // ---------------------------------------------------------------- wiring

  function wireList() {
    list.addEventListener('click', function (event) {
      var row = event.target.closest('li.row');
      if (!row) return;
      var index = Number(row.dataset.index);
      var current = (state && state.selection) || [];
      var next;
      if (event.shiftKey && current.length) {
        var from = Math.min(current[0], index);
        var to = Math.max(current[current.length - 1], index);
        next = [];
        for (var at = from; at <= to; at++) { next.push(at); }
      } else {
        next = selectionOf(index);
      }
      select(state ? state.selected : 'Commands', next);
    });

    list.addEventListener('dblclick', function (event) {
      var row = event.target.closest('li.row');
      // lstCommands_DoubleClick: with nothing to edit, the double-click opens a bot instead.
      if (row) openForm(Number(row.dataset.index));
      else api.load(null).then(applyState);
    });

    list.addEventListener('keydown', function (event) {
      if (!(event.ctrlKey || event.metaKey)) return;
      var action = null;
      if (event.key === 'ArrowUp') action = 'moveUp';
      else if (event.key === 'ArrowDown') action = 'moveDown';
      else if (event.key === 'Delete') action = 'remove';
      else if (event.key === 'd' || event.key === 'D') action = 'duplicate';
      else if (event.key === 'v' || event.key === 'V') { event.preventDefault(); openPaste(); return; }
      else if (event.key === 'c' || event.key === 'C') action = event.shiftKey ? 'copyAsText' : 'copyJson';
      else if (event.key === 's' || event.key === 'S') { event.preventDefault(); save(true); return; }
      else return;
      event.preventDefault();
      api.key(action).then(applyState);
    });

    ['dragover', 'drop'].forEach(function (type) {
      list.addEventListener(type, function (event) {
        event.preventDefault();
        if (type !== 'drop') { event.dataTransfer.dropEffect = 'copy'; return; }
        var files = [];
        Array.prototype.forEach.call(event.dataTransfer.files || [], function (file) { files.push(file.path); });
        api.drop(files).then(applyState);
      });
    });
  }

  function wireChrome() {
    document.getElementById('open').addEventListener('click', function () { api.load(null).then(applyState); });
    document.getElementById('save').addEventListener('click', function () { save(true); });
    document.getElementById('menu').addEventListener('click', function (event) {
      event.stopPropagation();
      openMenu();
    });
    document.addEventListener('click', function (event) {
      var popup = document.getElementById('menuPopup');
      if (!popup.hidden && !popup.contains(event.target)) popup.hidden = true;
    });
    var selector = document.getElementById('cbLists');
    if (selector) selector.addEventListener('change', function () { select(selector.value); });
  }

  /** The ticks and numbers that write Configuration straight away, and the two rename boxes. */
  function wires() {
    Object.keys(sheet.settings || {}).forEach(function (id) {
      var node = document.getElementById(id);
      if (!node || node.dataset.wired) return;
      node.dataset.wired = '1';
      node.addEventListener('change', function () {
        api.setting(sheet.settings[id], node.checked).then(applyState);
      });
    });
    Object.keys(sheet.numbers || {}).forEach(function (id) {
      var node = document.getElementById(id);
      if (!node || node.dataset.wired) return;
      node.dataset.wired = '1';
      node.addEventListener('change', function () {
        api.setting(sheet.numbers[id], Number(node.value)).then(applyState);
      });
    });
    var merge = document.getElementById('chkMerge');
    if (merge && !merge.dataset.wired) {
      merge.dataset.wired = '1';
      merge.addEventListener('change', function () { api.setting('Merge', merge.checked).then(function (next) { state = Object.assign({}, state, next); }); });
    }
    // chkEnableBot_CheckedChanged: the tick starts this window's bot and clears it stops it. A
    // refused start un-ticks itself and shows the reason, which is the reference's own refusal
    // path (an empty list, nobody signed in, one already running).
    var enable = document.getElementById('chkEnable');
    if (enable && !enable.dataset.wired) {
      enable.dataset.wired = '1';
      enable.addEventListener('change', function () {
        api.enable(enable.checked).then(function (next) {
          enable.checked = !!(next && next.enabled);
          state = Object.assign({}, state, next);
          if (next && next.error) setStatus(next.error, true);
          else setStatus(enable.checked ? messages.botStarted : messages.botStopped, false);
        });
      });
    }
    // The label list: a plain double-click fills the label box, ctrl jumps to the command.
    var labels = document.getElementById('lbLabels');
    if (labels && !labels.dataset.wired) {
      labels.dataset.wired = '1';
      labels.addEventListener('dblclick', function (event) {
        var node = event.target.closest('option') || labels.options[labels.selectedIndex];
        if (!node) return;
        api.key('label', { text: node.value, ctrl: event.ctrlKey || event.metaKey }).then(function (next) {
          applyState(next);
          if (next.label !== undefined) setValue('txtLabel', next.label);
        });
      });
    }
    var logText = document.getElementById('lstLogText');
    if (logText && !logText.dataset.wired) {
      logText.dataset.wired = '1';
      logText.addEventListener('dblclick', function () {
        var chosen = logText.options[logText.selectedIndex];
        if (!chosen) return;
        var box = document.getElementById('txtLog');
        box.value = (box.value ? box.value + ' ' : '') + chosen.value;
      });
    }
    ['txtAuthor', 'txtDescription'].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node || node.dataset.wired) return;
      node.dataset.wired = '1';
      node.addEventListener('change', function () { api.setting(id === 'txtAuthor' ? 'Author' : 'Description', node.value); });
    });
    drawLabelList();
  }

  function drawLabelList() {
    var labels = document.getElementById('lbLabels');
    if (!labels || !state || !state.labelsList) return;
    labels.textContent = '';
    (state.labelsList || []).forEach(function (text) {
      var option = el('option', null, text);
      option.value = text;
      labels.appendChild(option);
    });
  }

  // ---------------------------------------------------------------- boot

  api.sheet().then(function (loaded) {
    sheet = loaded;
    return api.messages();
  }).then(function (loaded) {
    messages = Object.assign(messages, loaded || {});
    document.getElementById('open').textContent = messages.load;
    document.getElementById('save').textContent = messages.save;
    document.getElementById('modalOk').textContent = messages.ok;
    document.getElementById('modalCancel').textContent = messages.cancel;
    document.getElementById('modalRaw').textContent = messages.raw;
    document.title = messages.title;
    buildSheet();
    wireList();
    wireChrome();
    return api.style({ action: 'read' });
  }).then(function (style) {
    state = style;
    drawList();
    applyConfiguration();
    setStatus(messages.empty + ' ' + messages.rowHint, false);
  }).catch(function (error) {
    setStatus(String(error && error.message ? error.message : error), true);
  });
})();
