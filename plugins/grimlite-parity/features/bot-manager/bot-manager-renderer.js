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
  // The ServerUse rows cbBoosts offered last (the objects the game sent), by option index.
  var boosts = [];
  // The Bots tab's tree: its root, count and one level of nodes (UpdateTree's own state).
  var botTreeState = null;
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
    folder: 'Folder',
    commandEditor: 'Command Editor',
    getInfo: 'Get Cell / Map / Pad',
    followPlaceholder: 'Player',
    authorised: 'Author',
    described: 'Description',
    botStarted: 'Bot started.',
    botStopped: 'Bot stopped.',
    noBoosts: 'No ServerUse items in the bag.',
    read: 'Read from the game.'
  };

  // The controls keep their own state while the form lives, as the reference's form does; the
  // page rebuilds a tab whenever it is shown, so what a user typed or ticked on it is put back.
  var remembered = {};

  function snapshot(node) {
    if (node.type === 'checkbox' || node.type === 'radio') return node.checked;
    if (node.tagName === 'SELECT') return node.multiple ? undefined : node.value;
    return node.value;
  }

  function restore(node, value) {
    if (value === undefined) return;
    if (node.type === 'checkbox' || node.type === 'radio') node.checked = value === true;
    else if (node.tagName === 'SELECT' && !node.multiple) node.value = String(value);
    else if (node.tagName !== 'SELECT') node.value = String(value);
  }

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

  function control(entry, groupName) {
    var node;
    switch (entry.kind) {
    case 'group':
      node = el('fieldset', 'group');
      node.appendChild(el('legend', null, entry.text || ''));
      (entry.children || []).forEach(function (child) {
        node.appendChild(control(child, entry.id));
      });
      return node;
    case 'split':
    case 'panel':
    case 'grid':
      node = el('div', entry.kind);
      (entry.children || []).forEach(function (child) {
        node.appendChild(control(child, groupName));
      });
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
      // WinForms groups radios by their container, so a pair in one group box is one choice.
      if (entry.kind === 'radio') node.name = groupName || entry.id;
      node.id = entry.id;
      node.checked = entry.checked === true;
      restore(node, remembered[entry.id]);
      return label(entry.text, node, el('span'));
    case 'text':
      node = el('input', 'sheet-text');
      node.type = 'text';
      node.id = entry.id;
      node.placeholder = entry.text || '';
      restore(node, remembered[entry.id]);
      return node;
    case 'number':
      node = el('input', 'sheet-number');
      node.type = 'number';
      node.id = entry.id;
      // The designer's own spinner values (BotManager.Designer.cs).
      if (entry.value !== undefined) node.value = String(entry.value);
      restore(node, remembered[entry.id]);
      return node;
    case 'select':
      node = el('select', 'sheet-select');
      node.id = entry.id;
      (entry.options || []).forEach(function (option) {
        var item = el('option', null, option);
        item.value = option;
        node.appendChild(item);
      });
      // cbItemCmds and cmbSpecials start with no selection (their designer sets no index).
      if (entry.unselected) node.selectedIndex = -1;
      restore(node, remembered[entry.id]);
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
      if (entry.editable) {
        node = el('textarea', 'sheet-rtf test-rtf');
        node.placeholder = entry.text || '';
      } else {
        node = el('div', 'sheet-rtf' + (entry.id === 'rtbInfo' ? ' info-pane' : ''));
        if (entry.text) node.textContent = entry.text;
      }
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
    (sheet.tabs || []).forEach(function (tab) {
      tabsById[tab.id] = tab;
      var button = el('button', 'tab', tab.title);
      button.id = 'tab-' + tab.id;
      button.addEventListener('click', function () { showTab(tab.id); });
      bar.appendChild(button);
    });
    // The left column's controls carry the reference's ids as well.
    index(sheet.column);
    // The constructor opens the Bots tab: `mainTabControl.SelectedIndex = 9`.
    showTab(((sheet.tabs || [])[9] || (sheet.tabs || [])[0] || {}).id);
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
    applyConfiguration();
    wires();
    syncRules();
    drawList();
    if (id === 'bots') { refreshTree(); }
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
    // cbBoosts shows the game's own server-use objects, so the selected one is the object the
    // game sent rather than a name rebuilt here.
    values.cbBoostsSelected = selectedBoost();
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

  function selectedBoost() {
    var node = document.getElementById('cbBoosts');
    if (!node || node.selectedIndex < 0) return null;
    var row = boosts[node.selectedIndex];
    return row && row.item ? row.item : null;
  }

  function applyConfiguration() {
    if (!state) return;
    var enableOptions = document.getElementById('chkEnableSettings');
    if (enableOptions) {
      var running = state.optionsRunning;
      if (running === undefined && sheet) running = sheet.optionsRunning;
      enableOptions.checked = running === true;
    }
    if (!state.configuration) return;
    Object.keys(controlsById).forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      var key = (sheet.settings || {})[id] || (sheet.numbers || {})[id];
      if (!key || key === 'Server') return;
      var value = state.configuration[key];
      if (node.type === 'checkbox') node.checked = value === true;
      else if (key === 'FollowName') {
        // tbFollowPlayer2.Text = config.FollowName == null ? "Player" : config.FollowName.
        node.value = value === undefined || value === null ? messages.followPlaceholder : String(value);
      } else if (node.tagName === 'SELECT') {
        // Remove the previous server entry this window added before the list is rebuilt.
        if (value === undefined || value === null) node.selectedIndex = -1;
        else node.value = String(value);
      } else if (value !== undefined && value !== null) node.value = String(value);
    });
    setValue('txtAuthor', state.author);
    setValue('txtDescription', state.description);
    // Save/Load's own labels read the document: config.Author ?? "Author", and the description
    // (already unzipped by bots.description) ?? "Description".
    setValue('txtSavedAuthor', state.author ? String(state.author) : messages.authorised);
    setValue('txtSavedDesc', state.description ? String(state.description) : messages.described);
    if (botTreeState) setValue('txtSaved', botTreeState.directory);
    applyServer();
    fillSoundList();
    drawBotsLabels();
    var merge = document.getElementById('chkMerge');
    if (merge) merge.checked = state.merge === true;
    var selector = document.getElementById('cbLists');
    if (selector && state.selected) selector.value = state.selected;
    drawInfo();
  }

  /** ApplyConfiguration selects the loaded Server by name (FindIndex over cbServers' items). */
  function applyServer() {
    var node = document.getElementById('cbServers');
    if (!node || !state || !state.configuration) return;
    var server = state.configuration.Server;
    var name = server && server.Name ? String(server.Name) : '';
    if (!name) { node.selectedIndex = -1; return; }
    var known = false;
    Array.prototype.forEach.call(node.options, function (option) {
      if (option.value === name) known = true;
    });
    if (!known) {
      // This build has no server list to offer; the loaded name still has to be visible, or a
      // save would drop a Server the file carried.
      var option = el('option', null, name);
      option.value = name;
      node.appendChild(option);
    }
    node.value = name;
  }

  /** lstSoundItems is NotifyUponDrop, and ApplyConfiguration refills it from the document. */
  function fillSoundList() {
    var node = document.getElementById('lstSoundItems');
    if (!node || !state || !state.configuration) return;
    var items = state.configuration.NotifyUponDrop;
    node.textContent = '';
    (Array.isArray(items) ? items : []).forEach(function (name) {
      var option = el('option', null, name);
      option.value = String(name);
      node.appendChild(option);
    });
  }

  // treeBots_AfterSelect's six labels, which live on the Bots tab itself (the footer repeats
  // them so they are visible from every tab).
  var BOT_LABELS = {
    lblCommands: 'commands', lblSkills: 'skills', lblQuests: 'quests',
    lblDrops: 'drops', lblBoosts: 'boosts', lblItems: 'items'
  };

  function drawBotsLabels() {
    if (!state || !state.labels) return;
    Object.keys(BOT_LABELS).forEach(function (id) {
      var node = document.getElementById(id);
      if (!node) return;
      node.textContent = state.labels[BOT_LABELS[id]];
      node.classList.add('counter-label');
    });
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
      // lstCommands_DrawItem puts the [n] in front only in colour mode, and never on a LabelLess
      // row; the other five lists are plain listboxes with neither index nor colours.
      var index = colourful() && state.selected === 'Commands' && row.showsIndex !== false
        ? '[' + at + '] ' : '';
      item.textContent = index + row.text;
      if (colourful()) item.style.color = '#' + hexOf(row.colour);
      if (colourful() && row.centered) item.classList.add('centered');
      if (selection.indexOf(at) !== -1) item.classList.add('picked');
      if (running() && state.selected === 'Commands' && state.bot && state.bot.index === at) {
        item.classList.add('current');
      }
      item.dataset.index = String(at);
      list.appendChild(item);
    });
    if (!rows.length) list.appendChild(el('li', 'empty', messages.empty));
    drawCounters();
     drawBotsLabels();
    drawStyle();
  }

  /** colorfulCommands, the Client tab's own tick (checked in the designer). */
  function colourful() {
    var node = document.getElementById('colorfulCommands');
    return node ? node.checked : remembered.colorfulCommands !== false;
  }

  /** Whether this window's bot is running (runtime.state's own flag). */
  function running() {
    return !!(state && state.bot && state.bot.running);
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

  function setEnabled(id, on) {
    var node = document.getElementById(id);
    if (node) node.disabled = !on;
  }

  /**
   * The reference's own enable/disable rules, each one a *CheckedChanged handler:
   * cbJoinMapSwf -> tbJoinMapSwf, radBuyByName -> the two id boxes and the name box,
   * chkQuestItem/chkQuestListItem -> their spinners, chkRelog -> chkAFK,
   * chkSpecial -> cmbSpecials, and a running bot -> the list buttons and single selection.
   */
  function syncRules() {
    setEnabled('tbJoinMapSwf', checked('cbJoinMapSwf'));
    var byName = checked('radBuyByName');
    setEnabled('tbShopItemName', byName);
    setEnabled('tbShopItemId', !byName);
    setEnabled('tbItemId', !byName);
    setEnabled('numQuestItem', checked('chkQuestItem'));
    setEnabled('numQuestListItem', checked('chkQuestListItem'));
    setEnabled('chkAFK', checked('chkRelog'));
    setEnabled('cmbSpecials', !checked('chkSpecial'));
    var busy = running();
    ['btnUp', 'btnDown', 'btnClear', 'btnRemove'].forEach(function (id) { setEnabled(id, !busy); });
  }

  var poll = null;

  /** Watch the runtime while the tick is on: the engine can stop on its own (an error, a stop). */
  function startPolling() {
    if (poll) return;
    poll = window.setInterval(refreshBotState, 1000);
  }

  function stopPolling() {
    if (!poll) return;
    window.clearInterval(poll);
    poll = null;
  }

  function refreshBotState() {
    return api.botState().then(function (next) {
      if (!next) return;
      var wasRunning = running();
      state = Object.assign({}, state, next);
      var enable = document.getElementById('chkEnable');
      if (enable) enable.checked = running();
      drawList();
      syncRules();
      if (wasRunning && !running()) {
        // The reference un-ticks chkSpecial when a run ends.
        stopPolling();
        var special = document.getElementById('chkSpecial');
        if (special) special.checked = false;
        syncRules();
      }
    });
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
    syncRules();
    if (next.error) setStatus(next.error, true);
    else if (next.path) setStatus(messages.opened + ' ' + next.path, false);
    else if (next.clipboard !== undefined) setStatus(next.clipboard ? messages.copyHint : '', false);
  }

  // ---------------------------------------------------------------- buttons

  function press(id, modifiers) {
    // ">" is the local half of the Map tab's cell/pad pair; it needs no game read.
    if (id === 'button2') {
      setValue('txtCell', value('txtJoinCell'));
      setValue('txtPad', value('txtJoinPad'));
      setStatus('Copied join cell and pad to Cell and Pad.', false);
      return Promise.resolve(null);
    }
    // Add Skill Set writes a label into the Skills list, not the Commands list the page is
    // usually showing. Say where it went so the reference's split workflow is not a silent click.
    if (id === 'btnAddSkillSet' || id === 'btnUseSkillSet') {
      var setName = value('txtSkillSet').trim();
      if (!setName) {
        setStatus('Type a skill set name first.', true);
        return Promise.resolve(null);
      }
      if (id === 'btnAddSkillSet') {
        return api.addList(id, valuesFromSheet(), modifiers).then(function (next) {
          applyState(next);
          setStatus('Added [' + setName.toUpperCase() +
            '] to Skills. Add the skills below that label, then press Use Skill Set.', false);
          return next;
        });
      }
      return api.add(id, valuesFromSheet(), modifiers).then(function (next) {
        applyState(next);
        setStatus('Added Skill Set: ' + setName.toUpperCase() + ' to Commands.', false);
        return next;
      });
    }
    if ((sheet.commandButtons || []).indexOf(id) !== -1) {
      return api.add(id, valuesFromSheet(), modifiers).then(applyState);
    }
    if ((sheet.listButtons || []).indexOf(id) !== -1) {
      return api.addList(id, valuesFromSheet(), modifiers).then(applyState);
    }
    if ((sheet.gameButtons || []).indexOf(id) !== -1) {
      // The boxes travel with the press: Player.GetMapItem reads numMapItem, and cbBoosts is
      // filled from the bag rather than from a value on the page.
      return api.game(id, Object.assign({}, modifiers, { fields: valuesFromSheet() })).then(function (result) {
        // A control the game cannot answer reports why; it never fills a field with nothing.
        if (!result || result.ok !== true) {
          setStatus((result && result.error) || 'the game did not answer', true);
          return;
        }
        if (result.state) applyState(result.state);
        if (id === 'cbBoosts') { fillBoosts(result.boosts || []); return; }
        // A control that acts without filling boxes (map item, access level, alignment, quest
        // whitelist) has no values; it must not be sent through the read-fill path.
        if (result.values) fillFromGame(id, result.values, modifiers);
        if (result.message) setStatus(result.message, false);
      });
    }
    switch (id) {
    case 'btnRemove': return api.key('remove').then(applyState);
    case 'btnClear': return api.key('clear', { all: checked('chkAll') }).then(applyState);
    case 'btnUp': return api.key('moveUp').then(applyState);
    case 'btnDown': return api.key('moveDown').then(applyState);
    case 'btnSearchCmd': return api.key('find', { text: value('txtSearchCmd') }).then(function (next) {
      applyState(next);
      // lblLabels_DoubleClick's commented-out TopIndex: the hit is scrolled into view.
      if (next && next.hit !== null && next.hit !== undefined) scrollToRow(next.hit);
      return next;
    });
    case 'btnSave': return save(true);
    case 'btnLoad': return api.load(null).then(applyState);
    case 'btnLoadCmd': return loadCommand();
    case 'btnStatementAdd': return api.add('btnStatementAdd', valuesFromSheet(), {}).then(applyState);
    case 'btnSetBotsDir': return api.chooseDirectory().then(function (result) {
      botTreeState = result;
      applyState(result);
      drawTree();
      return result;
    });
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

  /** cbBoosts: the ServerUse rows the game answered, each carrying the object it sent. */
  function fillBoosts(rows) {
    boosts = Array.isArray(rows) ? rows : [];
    var node = document.getElementById('cbBoosts');
    if (!node) return;
    node.textContent = '';
    boosts.forEach(function (boost, at) {
      var option = el('option', null, boost.name);
      option.value = String(at);
      node.appendChild(option);
    });
    node.selectedIndex = boosts.length ? 0 : -1;
    if (!boosts.length) setStatus(messages.noBoosts || 'No ServerUse items in the bag.', false);
  }

  /** Scroll the list to a row (the search hit). */
  function scrollToRow(index) {
    var row = list.querySelector('li.row[data-index="' + index + '"]');
    if (row) row.scrollIntoView({ block: 'nearest' });
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
    // lstSoundItems is Configuration.NotifyUponDrop: the document follows the list.
    return api.setting('NotifyUponDrop', soundNames()).then(applyState);
  }

  function removeSound() {
    var target = document.getElementById('lstSoundItems');
    if (target && target.selectedIndex > -1) target.remove(target.selectedIndex);
    return api.setting('NotifyUponDrop', soundNames()).then(applyState);
  }

  function soundNames() {
    var target = document.getElementById('lstSoundItems');
    if (!target) return [];
    return Array.prototype.map.call(target.options, function (option) { return option.value; });
  }

  function save(ask) {
    return api.save({ path: state ? state.path : null, ask: ask === true }).then(applyState);
  }

  // ---------------------------------------------------------------- the Bots tab

  function bindTreeControls() {
    // lint: no-op; the tree's own controls are wired through press() like every other button.
  }

  /**
  * tabControl1_Selected: opening the Bots tab fills txtSaved with the chosen directory and
  * calls UpdateTree. txtSaved is the tree's root, so a typed path re-lists from there.
  */
  function refreshTree() {
    return api.tree([], value('txtSaved')).then(function (result) {
      botTreeState = result;
      drawTree();
      applyConfiguration();
      return result;
    }).catch(function (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    });
  }

  function drawTree() {
    var host = document.getElementById('treeBots');
    if (!host || !botTreeState) return;
    host.textContent = '';
    var bots = document.getElementById('lblBots');
    if (bots) bots.textContent = messages.numberOfBots + botTreeState.count;
    appendNodes(host, botTreeState.nodes || [], []);
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
        return api.treeSelect(path, event.ctrlKey || event.metaKey, value('txtSaved')).then(function (next) {
          state = Object.assign({}, state, next);
          if (next.tree) { botTreeState = next.tree; drawTree(); }
          drawList();
          applyConfiguration();
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
    return api.tree(path, value('txtSaved')).then(function (result) {
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
    return api.addFolder(name, value('txtSaved')).then(function (next) {
      if (box) box.value = '';
      botTreeState = next;
      state = Object.assign({}, state, next);
      drawTree();
      if (next.error) setStatus(next.error, true);
      else setStatus(next.directory || '', false);
    });
  }

  function drawInfo() {
    var info = document.getElementById('rtbInfo');
    if (!info) return;
    var description = state && state.description ? String(state.description) : '';
    info.textContent = description ? richText(description) :
      'This is where information about a bot will be shown in RichTextFormat';
  }

  // A small RTF-to-text view. The reference hands rtbInfo.Rtf to WinForms, which Chromium does
  // not have; stripping the control words gives the same readable description and lets the Test
  // here box preview RTF without a converter dependency.
  function richText(value) {
    var text = String(value || '');
    if (!/^\s*\{\\rtf/i.test(text)) return text;
    return text
      .replace(/\\u(-?\d+)\??/g, function (_match, code) {
        var n = Number(code);
        return String.fromCharCode((n + 65536) % 65536);
      })
      .replace(/\\par[d]?\b/g, '\n')
      .replace(/\\line\b/g, '\n')
      .replace(/\\tab\b/g, '\t')
      .replace(/\\'[0-9a-f]{2}/gi, '')
      .replace(/\\[a-zA-Z]+-?\d* ?/g, '')
      .replace(/[{}]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ---------------------------------------------------------------- dialogs

  function openModal(title) {
    document.getElementById('modalTitle').textContent = title;
    var body = document.getElementById('modalBody');
    body.textContent = '';
    body.onkeydown = null;
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
      // UserFriendlyCommandEditor's own caption.
      var body = openModal(messages.commandEditor);
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
      // btnGetInfo exists only for a command that has a Cell, Map or Pad member, and it fills the
      // boxes those names match from the player's own cell, map and pad.
      if (form.fields.some(function (field) { return /^(cell|map|pad)$/i.test(field.key); })) {
        var getInfo = el('button', 'sheet-button', messages.getInfo);
        getInfo.type = 'button';
        getInfo.addEventListener('click', function () {
          api.game('btnGetInfo', {}).then(function (result) {
            if (!result || result.ok !== true) {
              setStatus((result && result.error) || 'the game did not answer', true);
              return;
            }
            form.fields.forEach(function (field) {
              var key = String(field.key).toLowerCase();
              if (key.indexOf('swf') !== -1 || key.indexOf('max') !== -1) return;
              var next = key.indexOf('cell') !== -1 ? result.values.cell
                : (key.indexOf('map') !== -1 ? result.values.map
                : (key.indexOf('pad') !== -1 ? result.values.pad : undefined));
              if (next !== undefined && next !== null && inputs[field.key]) inputs[field.key].value = String(next);
            });
          });
        });
        body.appendChild(getInfo);
      }
      document.getElementById('modalRaw').hidden = false;
      document.getElementById('modalRaw').onclick = function () {
        closeModal();
        openRaw(index, form.json);
      };
      var submit = function () {
        var values = {};
        Object.keys(inputs).forEach(function (key) { values[key] = inputs[key].value; });
        api.edit(index, values).then(function (next) { closeModal(); applyState(next); });
      };
      // txtCmd_KeyDown and the form's own handler: Enter is OK, Escape is Cancel.
      body.onkeydown = function (event) {
        if (event.target && event.target.tagName === 'BUTTON') return;
        if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
        else if (event.key === 'Enter' && !event.altKey) { event.preventDefault(); submit(); }
      };
      document.getElementById('modalOk').onclick = submit;
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
    // RawCommandEditor's own key handler: Ctrl+Enter submits, Escape cancels (Enter alone is a
    // newline in this box, which is what the reference's multiline txtCmd does).
    box.onkeydown = function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        document.getElementById('transferCancel').click();
      } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        document.getElementById('transferOk').click();
      }
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
      if (running()) {
        // selectionMode(SelectionMode.One) while the bot runs: one row, never a block.
        next = [index];
      } else if (event.shiftKey && current.length) {
        var from = Math.min(current[0], index);
        var to = Math.max(current[current.length - 1], index);
        next = [];
        for (var at = from; at <= to; at++) { next.push(at); }
      } else if (event.ctrlKey || event.metaKey) {
        // Ctrl toggles one row in or out of the selection.
        next = selectionOf(index);
      } else {
        // A plain click selects that row alone (MultiExtended's own behaviour).
        next = [index];
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
      else if (event.key === 'x' || event.key === 'X') {
        // Ctrl+X cuts; with nothing selected there is nothing to cut (and no clipboard write).
        if (!(state && state.selection && state.selection.length)) return;
        action = 'cut';
      } else if (event.key === 'c' || event.key === 'C') {
        // Ctrl+C and Ctrl+Shift+C are both guarded by SelectedList.SelectedIndex > -1 in the
        // reference: with no selection the press is a no-op and the clipboard is left alone.
        if (!(state && state.selection && state.selection.length)) return;
        action = event.shiftKey ? 'copyAsText' : 'copyJson';
      }
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
    // The left column is static markup, not a generated sheet control, so these buttons need
    // their own click wiring. Without it Remove, Clear, Up, Down and Find were dead controls.
    ['btnUp', 'btnDown', 'btnClear', 'btnRemove', 'btnSearchCmd'].forEach(function (id) {
      var node = document.getElementById(id);
      if (!node || node.dataset.wired) return;
      node.dataset.wired = '1';
      node.addEventListener('click', function () { press(id); });
    });
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
        // A tick writes its checked flag; a box or combo writes its value (FollowName, AutoZone,
        // Server - the three the reference reads when it generates a configuration).
        var value = node.type === 'checkbox' ? node.checked : node.value;
        api.setting(sheet.settings[id], value).then(applyState);
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
          else if (next && next.zoneError) setStatus(next.zoneError, true);
          else setStatus(enable.checked ? messages.botStarted : messages.botStopped, false);
          if (enable.checked) {
            // chkEnableBot_CheckedChanged ticks chkSpecial for the selected zone, which is what
            // registers the live handler for the run.
            var special = document.getElementById('chkSpecial');
            if (special && !special.checked && value('cmbSpecials')) special.checked = true;
            startPolling();
          } else {
            stopPolling();
            var tick = document.getElementById('chkSpecial');
            if (tick && tick.checked) tick.checked = false;
          }
          syncRules();
          drawList();
        });
      });
    }
    var enableOptions = document.getElementById('chkEnableSettings');
    if (enableOptions && !enableOptions.dataset.wired) {
      enableOptions.dataset.wired = '1';
      enableOptions.addEventListener('change', function () {
        api.enableOptions(enableOptions.checked).then(applyState);
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
    wireRemembered();
    wireStatements();
    wireBoosts();
    wireSaved();
    var testInfo = document.getElementById('richTextBox2');
    if (testInfo && !testInfo.dataset.wired) {
      testInfo.dataset.wired = '1';
      testInfo.addEventListener('input', function () {
        var info = document.getElementById('rtbInfo');
        if (info) info.textContent = richText(testInfo.value);
      });
    }
    var special = document.getElementById('chkSpecial');
    if (special && !special.dataset.wired) {
      special.dataset.wired = '1';
      special.addEventListener('change', function () { toggleSpecial(special); });
    }
    var colourful = document.getElementById('colorfulCommands');
    if (colourful && !colourful.dataset.wired) {
      colourful.dataset.wired = '1';
      colourful.addEventListener('change', function () { drawList(); });
    }
    drawLabelList();
  }

  /** Remember what a control holds, so a tab switch does not lose it (the reference has one form). */
  function wireRemembered() {
    Object.keys(controlsById).forEach(function (id) {
      var node = document.getElementById(id);
      if (!node || node.dataset.remembered) return;
      node.dataset.remembered = '1';
      ['input', 'change'].forEach(function (type) {
        node.addEventListener(type, function () {
          remembered[id] = snapshot(node);
          // A radio's siblings are part of the same choice.
          if (node.type === 'radio' && node.name) {
            Array.prototype.forEach.call(
              document.querySelectorAll('input[type="radio"][name="' + node.name + '"]'),
              function (other) { remembered[other.id] = other.checked; });
          }
          syncRules();
        });
      });
    });
  }

  /** cbCategories feeds cbStatement, and cbStatement feeds the two Value boxes (BM.cs:1413-1450). */
  function wireStatements() {
    var categories = document.getElementById('cbCategories');
    var statements = document.getElementById('cbStatement');
    var first = document.getElementById('txtStatement1');
    var second = document.getElementById('txtStatement2');
    if (!categories || !statements || categories.dataset.statements) return;
    categories.dataset.statements = '1';
    function fill() {
      statements.textContent = '';
      var tag = categories.value;
      if (!tag) return;
      (sheet.statements || []).forEach(function (statement) {
        if (statement.tag !== tag) return;
        var option = el('option', null, statement.text);
        option.value = statement.className;
        option.dataset.description1 = statement.description1 || '';
        option.dataset.description2 = statement.description2 || '';
        statements.appendChild(option);
      });
      statements.selectedIndex = -1;
    }
    categories.addEventListener('change', fill);
    statements.addEventListener('change', function () {
      var option = statements.options[statements.selectedIndex];
      if (!option) return;
      var one = option.dataset.description1 || '';
      var two = option.dataset.description2 || '';
      first.disabled = !one;
      second.disabled = !two;
      first.value = one;
      second.value = two;
    });
    if (categories.value) fill();
  }

  /** cbBoosts_Click: the combo repopulates from the bag's ServerUse items when it is opened. */
  function wireBoosts() {
    var node = document.getElementById('cbBoosts');
    if (!node || node.dataset.boosts) return;
    node.dataset.boosts = '1';
    node.addEventListener('mousedown', loadBoosts);
  }

  function loadBoosts() {
    return api.game('cbBoosts', { fields: valuesFromSheet() }).then(function (result) {
      if (!result || result.ok !== true) {
        setStatus((result && result.error) || 'the game did not answer', true);
        return;
      }
      fillBoosts(result.boosts || []);
    });
  }

  /** txtSaved_TextChanged: the box is the tree's root, so an edit re-lists from it. */
  function wireSaved() {
    var node = document.getElementById('txtSaved');
    if (!node || node.dataset.saved) return;
    node.dataset.saved = '1';
    node.addEventListener('change', refreshTree);
  }

  /** chkSpecial_CheckedChanged: requires login, then toggles the live handler and the combo. */
  function toggleSpecial(node) {
    syncRules();
    if (!node.checked) {
      api.special(value('cmbSpecials'), false);
      return;
    }
    // Player.IsLoggedIn: the game reports no cell until a character is in the world.
    api.game('btnGetInfo', {}).then(function (result) {
      if (!result || result.ok !== true) {
        node.checked = false;
        syncRules();
        setStatus((result && result.error) || 'sign in to the game first', true);
        return;
      }
      api.special(value('cmbSpecials'), true).then(function (answer) {
        if (answer && answer.ok === false) setStatus(answer.error, true);
      });
    });
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

  api.onOptionsState(function (running) {
    if (sheet) sheet.optionsRunning = running;
    if (state) state = Object.assign({}, state, { optionsRunning: running });
    applyConfiguration();
  });

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
