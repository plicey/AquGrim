// Dev Test window: type a function and arguments, call it, see the result, with the reference's
// own call modes. Report-only: the reference's page-side debug window (Grimlite/UI/DevTest.cs).
(function () {
  var api = window.aquastarPlugin;
  var fn = document.getElementById('fn');
  var args = document.getElementById('args');
  var argsEnabled = document.getElementById('argsEnabled');
  var result = document.getElementById('result');
  var status = document.getElementById('status');
  var mode = 'grimoire';

  function setStatus(text, bad) {
    status.textContent = text || '';
    status.className = bad ? 'status bad' : 'status';
  }

  // Modes, from the plugin, so the page and the preload cannot drift apart.
  api.modes().then(function (modes) {
    var host = document.getElementById('modes');
    modes.forEach(function (item) {
      var label = document.createElement('label');
      var radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'mode';
      radio.value = item.id;
      radio.checked = item.id === mode;
      radio.addEventListener('change', function () {
        if (radio.checked) mode = item.id;
      });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(' ' + item.label));
      host.appendChild(label);
    });
  });

  argsEnabled.addEventListener('change', function () {
    args.disabled = !argsEnabled.checked;
  });

  document.getElementById('call').addEventListener('click', function () {
    setStatus('calling...');
    api.run(mode, fn.value, args.value, argsEnabled.checked).then(function (out) {
      if (out && out.ok) {
        // The loader answers strings; show them as they came, the way the reference does.
        result.value = out.value === null ? 'null' : String(out.value);
        setStatus('');
      } else {
        setStatus((out && out.error) || 'the call failed', true);
      }
    }).catch(function (error) {
      setStatus(String(error && error.message ? error.message : error), true);
    });
  });

  document.getElementById('copy').addEventListener('click', function () {
    if (!result.value.length) return;
    api.copy(result.value);
    setStatus('copied');
  });

  document.getElementById('format').addEventListener('click', function () {
    result.value = api.format(result.value);
  });
})();
