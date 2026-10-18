// Sandboxed preload (Electron 11): require('electron') and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarAbout', {
    getInfo: function () {
        return ipcRenderer.invoke(CH('aboutInfo'));
    },
    openLink: function (url) {
        return ipcRenderer.invoke(CH('aboutOpenLink'), url);
    },
    reloadGame: function () {
        return ipcRenderer.invoke(CH('aboutReloadGame'));
    }
});
