(function () {
    var stage = document.getElementById('stage');
    var surface = document.getElementById('surface');
    var renderScale = 100;

    function focusGame() {
      try {
        var player = surface.firstChild;
        if (!player || document.activeElement === player) return;
        // Ruffle handles keys through its shadow container. Focus it directly; focusing the
        // custom element can delegate to the hidden virtual keyboard instead.
        var container = player.shadowRoot && player.shadowRoot.getElementById('container');
        if (container) {
          container.setAttribute('tabindex', '0');
          container.focus({ preventScroll: true });
          return;
        }
        player.focus({ preventScroll: true });
      } catch (e) { /* the plugin owns the surface; nothing else to focus */ }
    }

    // A click on a toolbar control or a window switch can leave focus outside Ruffle. Reclaim it
    // on the first movement key so W/A/S/D is not swallowed while the player still looks focused.
    var movementKeys = { w: true, a: true, s: true, d: true };
    document.addEventListener('keydown', function (event) {
      if (!movementKeys[String(event.key || '').toLowerCase()] || event.ctrlKey || event.metaKey || event.altKey) return;
      if (document.getElementById('contextEditor')) return;
      var active = document.activeElement;
      var player = surface.firstChild;
      if (active === player) return;
      if (active && (active.isContentEditable || active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.tagName === 'SELECT')) return;
      focusGame();
    }, true);
    window.addEventListener('focus', focusGame);
    window.addEventListener('blur', function () {
      var player = surface.firstChild;
      var active = player && player.shadowRoot && player.shadowRoot.activeElement;
      // OS window switches do not reliably emit focusout inside Ruffle's shadow tree.
      if (active) active.blur();
      else if (player && document.activeElement === player) player.blur();
    });

    /** Render fewer pixels and let the browser scale the surface back to the stage. */
    function applyRenderScale(percent) {
      var pct = Number(percent);
      if (!isFinite(pct)) pct = 100;
      renderScale = Math.max(25, Math.min(100, Math.round(pct * 10) / 10));
      if (renderScale >= 100) {
        surface.style.width = '100%';
        surface.style.height = '100%';
        surface.style.transform = 'none';
        return;
      }
      var factor = renderScale / 100;
      surface.style.width = Math.max(1, stage.clientWidth * factor) + 'px';
      surface.style.height = Math.max(1, stage.clientHeight * factor) + 'px';
      surface.style.transform = 'scale(' + (1 / factor) + ')';
    }
    // Native menus and toolbar layout can resize the stage without a window resize event.
    new ResizeObserver(function () { applyRenderScale(renderScale); }).observe(stage);

    // Wait for sustained load; isolated asset-loading hitches must not blur the game.
    function adaptiveStep(state, fps) {
      if (!Number.isFinite(fps) || fps <= 0) { state.low = state.high = 0; return; }
      state.low = fps < 18 ? state.low + 1 : 0;
      state.high = fps > 23 ? state.high + 1 : 0;
      if (state.low >= 4 || state.high >= 8) {
        state.scale = Math.max(70, Math.min(100, state.scale + (state.low >= 4 ? -15 : 15)));
        state.low = state.high = 0;
      }
    }
    var adaptiveEnabled = new URLSearchParams(window.location.search).get('adaptive') === '1';
    if (adaptiveEnabled) {
      var adaptive = { scale: 100, low: 0, high: 0 };
      window.setInterval(function () {
        if (!adaptiveEnabled || document.hidden) { adaptive.low = adaptive.high = 0; return; }
        var player = surface.firstChild;
        if (!player || typeof player.getBridgeFps !== 'function') return;
        try {
          var before = adaptive.scale;
          adaptiveStep(adaptive, Number(player.getBridgeFps()));
          if (before !== adaptive.scale) applyRenderScale(adaptive.scale);
        } catch (e) { adaptive.low = adaptive.high = 0; }
      }, 1000);
    }

    // The chrome strip (ticket #45). The page knows nothing about a game: the platform answers
    // what to draw, from whatever the active plugin declared, and reports back what was pressed.
    // A page whose window has no strip - or a build with no chrome API at all - leaves the
    // surface filling the page, which is the layout this wrapper had before this ticket.
    var api = window.aquastarChrome;
    if (!api || typeof api.getView !== 'function') return;

    var strip = document.getElementById('chrome');
    var current = null;

    function el(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    var toastTimer = null;
    function toast(text, failed) {
      var box = document.getElementById('actionToast');
      if (!box || !text) return;
      window.clearTimeout(toastTimer);
      box.textContent = text;
      box.setAttribute('data-error', failed ? 'true' : 'false');
      box.hidden = false;
      toastTimer = window.setTimeout(function () { box.hidden = true; }, failed ? 8000 : 4500);
    }

    function send(id, args, notify) {
      return Promise.resolve(api.action(id, args || {})).then(function (result) {
        if (result && result.view) draw(result.view);
        var text = result && (result.error || result.message) || '';
        if (notify) toast(text, !!(result && result.error));
        else show(text);
        if (id !== 'autoSkillSet') focusGame();
      }, function (error) {
        var text = String(error && error.message ? error.message : error);
        if (notify) toast(text, true);
        else show(text);
        if (id !== 'autoSkillSet') focusGame();
      });
    }

    function show(text) {
      var box = document.getElementById('chromeStatus');
      if (box) box.textContent = text;
    }

    function openContextEditor(entry, button) {
      var previous = document.getElementById('contextEditor');
      if (previous) { previous.focus(); return; }
      var panel = el('div');
      panel.id = 'contextEditor';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', entry.label);
      var title = el('div', 'editor-title', entry.label);
      var presetName = el('input');
      presetName.type = 'text';
      presetName.placeholder = 'Preset name';
      presetName.setAttribute('aria-label', 'Preset name');
      presetName.style.cssText = 'width:120px;float:right;background:#272727;color:inherit;border:1px solid #3a3a44';
      var body = el('div', 'editor-body');
      var list = el('select');
      list.size = 8;
      list.setAttribute('aria-label', 'Presets');
      var text = el('textarea');
      text.spellcheck = false;
      text.setAttribute('aria-label', 'Skill rotation');
      var status = el('div', 'editor-status', 'Ctrl+S to save · Esc to close');
      status.setAttribute('role', 'status');
      panel.appendChild(presetName);
      panel.appendChild(title);
      body.appendChild(list);
      body.appendChild(text);
      panel.appendChild(body);
      panel.appendChild(status);
      var rect = button.getBoundingClientRect();
      panel.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 448)) + 'px';
      panel.style.top = rect.bottom + 4 + 'px';
      document.body.appendChild(panel);
      var state;
      var dirty = false;
      var busy = false;
      var pending = null;
      var drafts = Promise.resolve();
      function remember() {
        window.clearTimeout(pending);
        pending = null;
        drafts = drafts.then(function () {
          if (!dirty || !state) return true;
          var value = text.value;
          var name = state.selected === '__custom__' ? null : state.selected || null;
          return Promise.resolve(api.action(entry.id, {
            contextEditor: true, draft: true, className: state.className, name: name, text: value
          })).then(function (result) {
            if (!result || result.error || !result.editor) throw new Error(result && result.error || 'Could not remember draft.');
            state = result.editor;
            if (text.value === value) dirty = false;
            list.value = state.selected;
            status.textContent = 'Temporary draft · Re-enable Auto Attack to apply';
            return true;
          }).catch(function (error) { status.textContent = error.message || String(error); return false; });
        });
        return drafts;
      }
      async function close() {
        if (busy || !(await remember())) return;
        panel.remove();
        window.removeEventListener('mousedown', outside, true);
        window.removeEventListener('keydown', key);
        focusGame();
      }
      function outside(event) { if (!panel.contains(event.target)) close(); }
      function key(event) { if (event.key === 'Escape') { event.preventDefault(); close(); } }
      // Capture before the game can stop mouse events from bubbling.
      window.addEventListener('mousedown', outside, true);
      window.addEventListener('keydown', key);
      async function request(args) {
        if (busy) return;
        busy = true;
        if (!(await remember())) { busy = false; return; }
        list.disabled = text.disabled = true;
        return Promise.resolve(api.action(entry.id, Object.assign({ contextEditor: true }, args)))
          .then(function (result) {
            if (!result || result.error || !result.editor) throw new Error(result && result.error || 'Could not load editor.');
            state = result.editor;
            title.textContent = state.title;
            presetName.value = state.selected === '__custom__' ? '' : state.selected;
            while (list.firstChild) list.removeChild(list.firstChild);
            state.items.forEach(function (item) {
              var option = el('option', null, item.label);
              option.value = item.name;
              option.selected = item.name === state.selected;
              list.appendChild(option);
            });
            list.value = state.selected;
            text.value = state.text;
            dirty = false;
            status.textContent = args && args.save ? 'Saved · Re-enable Auto Attack to apply' : 'Ctrl+S to save · Esc to close';
          }).catch(function (error) {
            status.textContent = error.message || String(error);
            if (state) list.value = state.selected;
          }).then(function () { busy = false; list.disabled = text.disabled = !state; });
      }
      list.addEventListener('change', function () {
        request({ className: state.className, name: list.value });
      });
      text.addEventListener('input', function () {
        dirty = true;
        status.textContent = 'Temporary draft · Ctrl+S to save preset';
        window.clearTimeout(pending);
        pending = window.setTimeout(remember, 150);
      });
      panel.addEventListener('keydown', function (event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          if (busy || !state) return;
          var name = presetName.value.trim();
          if (!name) { presetName.focus(); status.textContent = 'Enter a preset name, then Ctrl+S'; return; }
          if (name) request({ className: state.className, save: true, name: name, text: text.value });
        }
      });
      request({}).then(function () { if (state) text.focus(); });
    }

    /** One control, drawn from its kind. Every one reports what it is; none is a dead button. */
    function control(entry, view) {
      var value = view.values ? view.values[entry.id] : undefined;
      if (entry.kind === 'select') {
        var select = el('select');
        select.id = 'chrome-' + entry.id;
        select.setAttribute('aria-label', entry.label || entry.id);
        if (entry.width) {
          select.style.width = entry.width + 'px';
          select.style.flex = '0 0 ' + entry.width + 'px';
        }
        function fill(view, selected) {
          var options = (view.options && view.options[entry.id]) || [];
          while (select.firstChild) select.removeChild(select.firstChild);
          if (!options.length && entry.placeholder) {
            select.appendChild(el('option', null, entry.placeholder));
            select.firstChild.value = '';
          }
          options.forEach(function (option) {
            var one = el('option', null, typeof option === 'object' ? option.label : option);
            one.value = typeof option === 'object' ? option.value : option;
            if (String(one.value) === String(selected)) one.selected = true;
            select.appendChild(one);
          });
          select.title = options.length ? (entry.label || '') : (entry.placeholder || '');
          if (entry.refreshOnFocus) {
            var button = strip.querySelector('[data-value-from="' + entry.id + '"]');
            if (button) button.disabled = !select.value;
          }
        }
        fill(view, value);
        if (entry.refreshOnFocus) {
          function refresh() {
            Promise.resolve(api.action(entry.id, { refresh: true })).then(function (result) {
              if (result.error) show(result.error);
              if (result.view) fill(result.view, select.value);
            }, function (error) { show(String(error.message || error)); });
          }
          select.addEventListener('focus', refresh);
          select.addEventListener('mousedown', refresh);
          select.refreshChoices = refresh;
        }
        select.addEventListener('change', function () {
          if (!entry.refreshOnFocus) send(entry.id, { value: select.value });
          focusGame();
        });
        return select;
      }
      if (entry.kind === 'check') {
        var label = el('label');
        var box = el('input');
        box.type = 'checkbox';
        box.id = 'chrome-' + entry.id;
        box.checked = value === true;
        box.addEventListener('change', function () {
          send(entry.id, { checked: box.checked });
          focusGame();
        });
        label.appendChild(box);
        label.appendChild(el('span', null, entry.label));
        return label;
      }
      var button = el('button', null, entry.label);
      button.id = 'chrome-' + entry.id;
      if (entry.contextEditor) {
        button.setAttribute('aria-haspopup', 'dialog');
        button.addEventListener('contextmenu', function (event) {
          event.preventDefault();
          openContextEditor(entry, button);
        });
      }
      if (entry.valueFrom) {
        button.setAttribute('data-value-from', entry.valueFrom);
        var source = document.getElementById('chrome-' + entry.valueFrom);
        button.disabled = !source || !source.value;
      }
      button.addEventListener('click', function () {
        var source = entry.valueFrom && document.getElementById('chrome-' + entry.valueFrom);
        if (button.disabled) return;
        if (entry.pendingLabel) {
          button.disabled = true;
          button.textContent = entry.pendingLabel;
        }
        send(entry.id, source ? { value: source.value } : {}, !!entry.pendingLabel).then(function () {
          button.textContent = entry.label;
          button.disabled = entry.valueFrom ? !source || !source.value : false;
        });
        if (entry.id !== 'autoSkillSet') focusGame();
      });
      return button;
    }

    /** The platform's render percentage, on the same strip as the plugin's controls. */
    function renderScaleControl() {
      var label = el('label', 'render-scale');
      label.appendChild(el('span', null, 'Scale'));
      var slider = el('input');
      slider.type = 'range';
      slider.min = '25';
      slider.max = '100';
      slider.step = 'any';
      slider.value = String(renderScale);
      slider.setAttribute('aria-label', 'Game render scale');
      var readout = el('output', null, Math.round(renderScale) + '%');
      var saveTimer = null;
      function commit() {
        window.clearTimeout(saveTimer);
        saveTimer = null;
        adaptiveEnabled = false;
        applyRenderScale(slider.value);
        if (typeof api.setRenderScale !== 'function') return;
        Promise.resolve(api.setRenderScale(renderScale)).catch(function (error) {
          show(String(error && error.message ? error.message : error));
        });
      }
      slider.addEventListener('input', function () {
        readout.textContent = Math.round(Number(slider.value)) + '%';
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(commit, 120);
      });
      slider.addEventListener('change', function () {
        commit();
        focusGame();
      });
      label.appendChild(slider);
      label.appendChild(readout);
      return label;
    }

    function draw(view) {
      var selected = {};
      (view && view.controls || []).forEach(function (entry) {
        var node = document.getElementById('chrome-' + entry.id);
        if (entry.refreshOnFocus && node) selected[entry.id] = node.value;
      });
      if (view) view.values = Object.assign({}, view.values, selected);
      current = view;
      // The strip is hidden and the surface keeps the whole page: that is the no-chrome mode the
      // screenshot and recording paths size their capture from.
      strip.style.display = view && view.enabled ? 'flex' : 'none';
      strip.style.height = view && view.enabled ? (view.height + 'px') : '0';
      if (view && view.renderScale !== undefined) applyRenderScale(view.renderScale);
      while (strip.firstChild) strip.removeChild(strip.firstChild);
      if (!view || !view.enabled) return;
      (view.controls || []).forEach(function (entry) {
        strip.appendChild(control(entry, view));
      });
      strip.appendChild(renderScaleControl());
      strip.appendChild(el('span', 'status', view.error || ''));
      strip.lastChild.id = 'chromeStatus';
      strip.lastChild.setAttribute('role', 'status');
      strip.lastChild.setAttribute('aria-live', 'polite');
      if (document.activeElement === document.body) focusGame();
    }

    window.addEventListener('focus', function () {
      Array.prototype.forEach.call(strip.querySelectorAll('select'), function (select) {
        if (select.refreshChoices) select.refreshChoices();
      });
    });

    if (typeof api.onView === 'function') {
      api.onView(function (view) { draw(view); });
    }
    Promise.resolve(api.getView()).then(draw, function (error) {
      // No strip is the safe answer: a page that cannot read the layout fills itself with game.
      current = null;
      strip.style.display = 'none';
      show(String(error && error.message ? error.message : error));
    });
})();
