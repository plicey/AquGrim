// Sandboxed preload (Electron 11): may only require('electron').
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

// The Maid window's own door (ticket #43). The page is sandboxed, so the config, the scheduler and
// the game all live on the main side; what crosses here is one view, one patch per change, and the
// scheduler's own state pushes.
contextBridge.exposeInMainWorld('aquastarMaid', {
    getView: function () {
        return ipcRenderer.invoke(CH('maidWatch'));
    },
    getMessages: function () {
        return ipcRenderer.invoke(CH('maidMessages'));
    },
    getPresets: function () {
        return ipcRenderer.invoke(CH('maidPresets'));
    },
    set: function (patch) {
        return ipcRenderer.invoke(CH('maidSet'), patch);
    },
    preset: function (name) {
        return ipcRenderer.invoke(CH('maidPreset'), name);
    },
    me: function () {
        return ipcRenderer.invoke(CH('maidMe'));
    },
    players: function () {
        return ipcRenderer.invoke(CH('maidPlayers'));
    },
    openMaps: function (kind) {
        return ipcRenderer.invoke(CH('maidOpenMaps'), kind);
    },
    maps: function (request) {
        return ipcRenderer.invoke(CH('maidMaps'), request);
    },
    save: function () {
        return ipcRenderer.invoke(CH('maidSave'));
    },
    load: function () {
        return ipcRenderer.invoke(CH('maidLoad'));
    },
    autoload: function () {
        return ipcRenderer.invoke(CH('maidAutoload'));
    },
    // The scheduler's own pushes while the window is open, so the state line is never stale.
    onState: function (listener) {
        if (typeof listener !== 'function') return function () {};
        const handler = function (event, payload) {
            void event;
            listener(payload);
        };
        ipcRenderer.on(CH('maidState'), handler);
        return function () { ipcRenderer.removeListener(CH('maidState'), handler); };
    }
});
