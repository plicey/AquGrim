// Sandboxed preload (Electron 11): may require 'electron' and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarOptions', {
    view: function () {
        return ipcRenderer.invoke(CH('optionsView'));
    },
    set: function (id, on) {
        return ipcRenderer.invoke(CH('optionsSet'), id, on);
    },
    setWalkSpeed: function (value) {
        return ipcRenderer.invoke(CH('optionsWalkSpeed'), value);
    },
    toggleApplying: function () {
        return ipcRenderer.invoke(CH('optionsToggleApplying'));
    }
});
