// Sandboxed preload (Electron 11): may only require('electron'). The map sub-windows' own door:
// one view and one patch per action, the same shape the Maid window's preload uses.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarMaps', {
    get: function (kind) {
        return ipcRenderer.invoke(CH('maidMaps'), { kind: kind, action: 'get' });
    },
    set: function (kind, text) {
        return ipcRenderer.invoke(CH('maidMaps'), { kind: kind, action: 'set', text: text });
    },
    clear: function (kind) {
        return ipcRenderer.invoke(CH('maidMaps'), { kind: kind, action: 'clear' });
    },
    grab: function (kind) {
        return ipcRenderer.invoke(CH('maidMaps'), { kind: kind, action: 'grab' });
    },
    add: function (kind, piece) {
        return ipcRenderer.invoke(CH('maidMaps'), { kind: kind, action: 'add', piece: piece });
    },
    check: function (kind) {
        return ipcRenderer.invoke(CH('maidMaps'), { kind: kind, action: 'check' });
    }
});
