// Sandboxed preload (Electron 11): may only require('electron'). The window drives the list, the
// one-click sign-in and the import of the user's own file; the credentials themselves never leave
// the main process, and this preload is handed usernames only.
const { contextBridge, ipcRenderer } = require('electron');

const P = 'plugin:grimlite-parity:';

contextBridge.exposeInMainWorld('aquastarLogin', {
  getList: () => ipcRenderer.invoke(P + 'loginList'),
  getMessages: () => ipcRenderer.invoke(P + 'loginMessages'),
  importFile: () => ipcRenderer.invoke(P + 'loginImport'),
  add: (username, password) => ipcRenderer.invoke(P + 'loginAdd', username, password),
  remove: (username) => ipcRenderer.invoke(P + 'loginRemove', username),
  signIn: (username) => ipcRenderer.invoke(P + 'loginSignIn', username),
  onConnection: (listener) => ipcRenderer.on(P + 'loginConnection', (_e, state) => listener(state))
});
