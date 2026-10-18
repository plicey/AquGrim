// Sandboxed preload (Electron 11): may require 'electron' and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarHotkeys', {
    view: function () {
        return ipcRenderer.invoke(CH('hotkeysView'));
    },
    bind: function (key, actionIndex) {
        return ipcRenderer.invoke(CH('hotkeysBind'), key, actionIndex);
    },
    clear: function (key) {
        return ipcRenderer.invoke(CH('hotkeysClear'), key);
    },
    save: function () {
        return ipcRenderer.invoke(CH('hotkeysSave'));
    },
    run: function (actionIndex) {
        return ipcRenderer.invoke(CH('hotkeysRun'), actionIndex);
    }
});
