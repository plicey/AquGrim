// Sandboxed preload (Electron 11): may only require('electron').
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarBotFile', {
    openBot: function () {
        return ipcRenderer.invoke(CH('openBot'));
    },
    saveBot: function (text, path) {
        return ipcRenderer.invoke(CH('saveBot'), text, path);
    },
    getMessages: function () {
        return ipcRenderer.invoke(CH('getBotFileMessages'));
    }
});
