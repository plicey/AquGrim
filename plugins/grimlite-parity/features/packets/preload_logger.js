// Handlers under contextIsolation: the window drives Start/Stop and asks for the frame channel
// map, and never reaches the relay itself.
const { contextBridge, ipcRenderer } = require('electron');

const P = 'plugin:grimlite-parity:';

contextBridge.exposeInMainWorld('aquastarPacketLogger', {
  start: () => ipcRenderer.invoke(P + 'packetsStart'),
  stop: () => ipcRenderer.invoke(P + 'packetsStop'),
  copy: (text) => ipcRenderer.send(P + 'packetsCopy', text),
  onFrame: (listener) => ipcRenderer.on(P + 'packetFrame', (_event, frame) => listener(frame))
});
