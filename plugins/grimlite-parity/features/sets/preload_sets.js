// Sandboxed preload (Electron 11): may only require('electron').
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarSets', {
    list: function () {
        return ipcRenderer.invoke(CH('listSets'));
    },
    inventoryRows: function () {
        return ipcRenderer.invoke(CH('setInventoryRows'));
    },
    open: function (path) {
        return ipcRenderer.invoke(CH('openSet'), path || null);
    },
    save: function (entries) {
        return ipcRenderer.invoke(CH('saveSet'), entries);
    },
    equip: function (entries) {
        return ipcRenderer.invoke(CH('equipSet'), entries);
    },
    getMessages: function () {
        return ipcRenderer.invoke(CH('setMessages'));
    }
});
