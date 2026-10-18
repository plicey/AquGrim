// Sandboxed preload (Electron 11): may require 'electron' and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarCosmetics', {
    rows: function () {
        return ipcRenderer.invoke(CH('cosmeticRows'));
    },
    grabLinks: function () {
        return ipcRenderer.invoke(CH('cosmeticGrabLinks'));
    },
    buttons: function () {
        return ipcRenderer.invoke(CH('cosmeticButtons'));
    },
    getMessages: function () {
        return ipcRenderer.invoke(CH('cosmeticMessages'));
    },
    players: function () {
        return ipcRenderer.invoke(CH('cosmeticPlayers'));
    },
    grab: function (id) {
        return ipcRenderer.invoke(CH('cosmeticGrab'), id);
    },
    grabSlot: function (id, row, current) {
        return ipcRenderer.invoke(CH('cosmeticGrabSlot'), id, row, current);
    },
    setSlot: function (row, value) {
        return ipcRenderer.invoke(CH('cosmeticSet'), row, value);
    },
    equip: function (rows) {
        return ipcRenderer.invoke(CH('cosmeticEquip'), rows);
    },
    remove: function (rows, indexes) {
        return ipcRenderer.invoke(CH('cosmeticRemove'), rows, indexes);
    },
    clear: function () {
        return ipcRenderer.invoke(CH('cosmeticClear'));
    },
    save: function (values) {
        return ipcRenderer.invoke(CH('cosmeticSave'), values);
    },
    load: function () {
        return ipcRenderer.invoke(CH('cosmeticLoad'));
    }
});
