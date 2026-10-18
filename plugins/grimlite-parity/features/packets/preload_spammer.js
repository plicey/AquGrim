// Sandboxed preload (Electron 11): may only require('electron').
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarSpammer', {
    getMessages: function () {
        return ipcRenderer.invoke(CH('spammerMessages'));
    },
    load: function () {
        return ipcRenderer.invoke(CH('spammerLoad'));
    },
    save: function (config) {
        return ipcRenderer.invoke(CH('spammerSave'), config);
    },
    start: function (config) {
        return ipcRenderer.invoke(CH('spammerStart'), config);
    },
    stop: function () {
        return ipcRenderer.invoke(CH('spammerStop'));
    },
    sendOnce: function (text) {
        return ipcRenderer.invoke(CH('spammerSendOnce'), text);
    },
    // The reference's IndexChanged: the row going out is highlighted while the loop runs.
    onIndex: function (listener) {
        ipcRenderer.on(CH('spammerIndex'), function (_event, payload) {
            listener(payload.index);
        });
    }
});
