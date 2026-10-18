// Sandboxed preload (Electron 11): may only require('electron').
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarDrops', {
    getMessages: function () {
        return ipcRenderer.invoke(CH('dropMessages'));
    },
    state: function () {
        return ipcRenderer.invoke(CH('dropState'));
    },
    watch: function () {
        return ipcRenderer.invoke(CH('dropWatch'));
    },
    take: function (names) {
        return ipcRenderer.invoke(CH('dropTake'), names);
    },
    reject: function (on) {
        return ipcRenderer.invoke(CH('dropReject'), on);
    },
    blacklist: function (names) {
        return ipcRenderer.invoke(CH('dropBlacklist'), names);
    },
    clear: function () {
        return ipcRenderer.invoke(CH('dropClear'));
    },
    onRows: function (listener) {
        ipcRenderer.on(CH('dropRows'), function (_event, rows) {
            listener(rows);
        });
    }
});
