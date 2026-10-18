// Sandboxed preload (Electron 11): may require('electron') and nothing else. Every call the page
// makes is a namespaced IPC invoke; the rows, the menus, the game and the dialogs all live in the
// plugin's main process (features/loaders/loaders.js).
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarLoaders', {
    sheets: function () { return ipcRenderer.invoke(CH('loadersSheets')); },
    messages: function () { return ipcRenderer.invoke(CH('loadersMessages')); },
    grab: function (target, orderBy) { return ipcRenderer.invoke(CH('loadersGrab'), target, orderBy); },
    load: function (target, value, count, forceAccept, ghost) {
        return ipcRenderer.invoke(CH('loadersLoad'), target, value, count, forceAccept === true, ghost === true);
    },
    save: function () { return ipcRenderer.invoke(CH('loadersSave')); },
    open: function () { return ipcRenderer.invoke(CH('loadersOpen')); },
    menu: function (kind, context) { return ipcRenderer.invoke(CH('loadersMenu'), kind, context || {}); },
    act: function (action, payload) { return ipcRenderer.invoke(CH('loadersAct'), action, payload || {}); }
});
