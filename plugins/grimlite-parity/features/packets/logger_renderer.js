// The logger window. Frames arrive on the preload bridge while the subscription is on; the filter
// decides what is drawn, never what is kept, so narrowing it and widening it again loses nothing.
(function () {
  const api = window.aquastarPacketLogger;
  const framesApi = window.AquaStarPacketFrames;
  const frames = [];
  let watching = false;
  let failure = '';

  const list = document.getElementById('frames');
  const empty = document.getElementById('empty');
  const status = document.getElementById('status');
  const filter = document.getElementById('filter');
  const startButton = document.getElementById('start');
  const stopButton = document.getElementById('stop');
  const copyButton = document.getElementById('copy');
  const clearButton = document.getElementById('clear');

  function shown(frame) { return framesApi.matchesFilter(frame, filter.value); }

  function row(frame) {
    const item = document.createElement('li');
    item.className = frame.direction === 'toServer' ? 'toServer' : 'toClient';
    const direction = document.createElement('span');
    direction.className = 'direction';
    direction.textContent = framesApi.directionLabel(frame.direction);
    const text = document.createElement('span');
    text.className = 'text';
    text.textContent = frame.text;
    item.append(direction, text);
    return item;
  }

  function draw() {
    list.textContent = '';
    let hidden = 0;
    frames.forEach(function (frame) {
      if (shown(frame)) list.appendChild(row(frame));
      else hidden++;
    });
    const visible = frames.length - hidden;
    empty.classList.toggle('hidden', visible > 0);
    empty.textContent = frames.length
      ? (hidden ? hidden + ' frame(s) hidden by the filter' : '')
      : (watching ? 'Watching. Frames appear here as the client and the server exchange them.'
        : 'Press Start to watch the game\u2019s traffic.');
    status.textContent = failure || (watching
      ? 'Watching \u2014 ' + frames.length + ' frame(s)' + (hidden ? ', ' + hidden + ' hidden by the filter' : '')
      : 'Stopped. The tap is released; nothing is being read.');
    status.classList.toggle('watching', watching);
    startButton.classList.toggle('active', watching);
    startButton.disabled = watching;
    stopButton.disabled = !watching;
    copyButton.disabled = visible === 0;
    clearButton.disabled = frames.length === 0;
    if (visible) list.scrollTop = list.scrollHeight;
  }

  api.onFrame(function (frame) {
    if (!frame || typeof frame.text !== 'string') return;
    frames.push({ direction: frame.direction, text: frame.text });
    // Draw incrementally: a chatty session must not re-render the whole list on every frame.
    if (shown(frame)) list.appendChild(row(frame));
    draw();
  });

  function start() {
    watching = true;
    failure = '';
    draw();
    // A start that fails is worth saying out loud: the usual cause is that the client's traffic
    // is not being steered through the relay, and the window would otherwise just look broken.
    api.start().catch(function (error) {
      watching = false;
      failure = 'Could not read traffic: ' + ((error && error.message) || error);
      draw();
    });
  }

  function stop() {
    watching = false;
    draw();
    api.stop().catch(function () { /* the window stays stopped either way */ });
  }

  startButton.addEventListener('click', start);
  stopButton.addEventListener('click', stop);

  clearButton.addEventListener('click', function () {
    frames.length = 0;
    draw();
  });

  copyButton.addEventListener('click', function () {
    const text = framesApi.copyText(frames, filter.value);
    if (text) api.copy(text);
  });

  filter.addEventListener('input', draw);

  // Opening the window reads nothing: the reference hooks its callback on Start too, and only
  // then. Start subscribes, Stop releases the tap.
  draw();
})();
