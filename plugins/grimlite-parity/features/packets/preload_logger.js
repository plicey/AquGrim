// Handlers under contextIsolation: the window drives Start/Stop, its embedded Spammer block and
// the steering notice, and never reaches the relay itself.
const { contextBridge, ipcRenderer } = require('electron');

const P = 'plugin:grimlite-parity:';

contextBridge.exposeInMainWorld('aquastarPacketLogger', {
  start: () => ipcRenderer.invoke(P + 'packetsStart'),
  stop: () => ipcRenderer.invoke(P + 'packetsStop'),
  copy: (text) => ipcRenderer.send(P + 'packetsCopy', text),
  // The embedded Spammer block: one frame (Send Once and the counted run), or the continuous run
  // the main process owns.
  send: (text) => ipcRenderer.invoke(P + 'packetsSend', text),
  spamStart: (config) => ipcRenderer.invoke(P + 'packetsSpamStart', config),
  spamStop: () => ipcRenderer.invoke(P + 'packetsSpamStop'),
  steering: () => ipcRenderer.invoke(P + 'packetsSteering'),
  onFrame: (listener) => ipcRenderer.on(P + 'packetFrame', (_event, frame) => listener(frame))
});
