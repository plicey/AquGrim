// Sandboxed preload (Electron 11): may only require('electron').
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarTamperer', {
    getMessages: function () {
        return ipcRenderer.invoke(CH('tampererMessages'));
    },
    // The banner the window shows while packet steering is off.
    steering: function () {
        return ipcRenderer.invoke(CH('tampererSteering'));
    },
    // Ticked capture switches: the main process subscribes the tap while either is on.
    watch: function (switches) {
        return ipcRenderer.invoke(CH('tampererWatch'), switches);
    },
    unwatch: function () {
        return ipcRenderer.invoke(CH('tampererUnwatch'));
    },
    setFilter: function (text) {
        return ipcRenderer.invoke(CH('tampererFilter'), text);
    },
    clear: function () {
        return ipcRenderer.invoke(CH('tampererClear'));
    },
    sendToServer: function (text) {
        return ipcRenderer.invoke(CH('tampererSendToServer'), text);
    },
    sendToClient: function (text) {
        return ipcRenderer.invoke(CH('tampererSendToClient'), text);
    },
    onCapture: function (listener) {
        ipcRenderer.on(CH('tampererCapture'), function (_event, payload) {
            listener(payload);
        });
    }
});
