// Sandboxed preload (Electron 11): require('electron') and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarEyedropper', {
    getMessages: function () {
        return ipcRenderer.invoke(CH('eyedropperMessages'));
    },
    // `point` is where the pick was made, in DIP: the page knows it from the mouse event the
    // main process never sees.
    pick: function (point) {
        return ipcRenderer.invoke(CH('eyedropperPick'), point);
    }
});
