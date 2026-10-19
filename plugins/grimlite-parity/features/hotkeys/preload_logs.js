// Sandboxed preload (Electron 11): may require 'electron' and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarLogs', {
    view: function () {
        return ipcRenderer.invoke(CH('logsView'));
    },
    clear: function () {
        return ipcRenderer.invoke(CH('logsClear'));
    }
});
