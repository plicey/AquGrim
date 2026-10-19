// The logger window. Frames arrive on the preload bridge while the subscription is on; the filter
// decides what is drawn, never what is kept, so narrowing it and widening it again loses nothing.
//
// The bottom block is the reference's own embedded Spammer (PacketLogger.Designer.cs and
// btnSpam_Click/btnSendOnce_Click): the Spam button's own text is its switch, 0 times runs until
// Stop (the reference hands that list to its Spammer tool - here the main process loop) and N
// times is exactly N frames, each from the box and each followed by the delay.
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
  const banner = document.getElementById('banner');
  const spamButton = document.getElementById('spam');
  const sendOnceButton = document.getElementById('sendOnce');
  const sendBox = document.getElementById('textToSend');
  const spamDelayBox = document.getElementById('numSpamDelay');
  const spamTimesBox = document.getElementById('numSpamTimes');

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
    // btnStart_Click/btnStop_Click: Start goes dead while watching; Stop stays live. Copy and
    // Clear stay live too (btnCopy_Click/btnClear_Click) and do nothing with nothing to work on -
    // an empty copy, and a Clear of an empty box.
    startButton.classList.toggle('active', watching);
    startButton.disabled = watching;
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

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // The two spinners keep the designer's own bounds (both 0..2000) even when typed past them.
  function spinner(box) {
    const value = Math.floor(Number(box.value));
    if (!isFinite(value)) return 0;
    return Math.min(2000, Math.max(0, value));
  }

  async function spam() {
    if (spamButton.textContent === 'Spam') {
      // `if (textToSend.TextLength < 1) return;` - an empty box starts nothing.
      if (!sendBox.value.length) return;
      spamButton.textContent = 'Stop';
      sendOnceButton.disabled = true;
      const times = spinner(spamTimesBox);
      const delay = spinner(spamDelayBox);
      if (times > 0) {
        // The reference's own counted loop, `i = 1; while (i <= spamTimes && btnSpam.Text ==
        // "Stop")`: one frame from the box, one wait, exactly N times, with Stop read between
        // frames - which is why it can end early.
        let i = 1;
        while (i <= times && spamButton.textContent === 'Stop') {
          await api.send(sendBox.value);
          await wait(delay);
          i++;
        }
        spamButton.textContent = 'Spam';
        sendOnceButton.disabled = false;
      } else {
        // 0 means continuous: the reference hands its one-packet list to the Spammer tool.
        await api.spamStart({ text: sendBox.value, delay: delay });
      }
    } else {
      spamButton.textContent = 'Spam';
      sendOnceButton.disabled = false;
      await api.spamStop();
    }
  }

  async function sendOnce() {
    // btnSendOnce_Click: an empty box sends nothing, and the button is dead while the frame is
    // on its way.
    if (!sendBox.value.length || sendOnceButton.disabled) return;
    sendOnceButton.disabled = true;
    try {
      await api.send(sendBox.value);
    } finally {
      sendOnceButton.disabled = false;
    }
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

  spamButton.addEventListener('click', spam);
  sendOnceButton.addEventListener('click', sendOnce);

  filter.addEventListener('input', draw);

  // Steering is the player's opt-in (packets.js): with it off the tap carries nothing, and the
  // window says so rather than looking broken.
  api.steering().then(function (answer) {
    if (!answer || !answer.notice) return;
    banner.textContent = answer.notice;
    banner.classList.remove('hidden');
  }).catch(function () { /* the status line reports what went wrong */ });

  // Opening the window reads nothing: the reference hooks its callback on Start too, and only
  // then. Start subscribes, Stop releases the tap.
  draw();
})();
