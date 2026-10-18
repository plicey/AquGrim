// Sandboxed preload (Electron 11): may only require('electron').
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarBank', {
    getLists: function () {
        return ipcRenderer.invoke(CH('bankCategories'));
    },
    getMessages: function () {
        return ipcRenderer.invoke(CH('bankMessages'));
    },
    bankCategory: function (selection) {
        return ipcRenderer.invoke(CH('bankCategory'), selection);
    },
    bankAll: function (selection) {
        return ipcRenderer.invoke(CH('bankAll'), selection);
    }
});
