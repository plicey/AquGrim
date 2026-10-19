// Sandboxed preload (Electron 11): may only require('electron').
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarTravel', {
    getGroups: function () {
        return ipcRenderer.invoke(CH('travelGroups'));
    },
    getMessages: function () {
        return ipcRenderer.invoke(CH('travelMessages'));
    },
    run: function (id, options) {
        return ipcRenderer.invoke(CH('travelRun'), id, options);
    },
    unlock: function (questId) {
        return ipcRenderer.invoke(CH('travelUnlock'), questId);
    },
    copy: function (text) {
        return ipcRenderer.send(CH('travelCopy'), text);
    }
});
