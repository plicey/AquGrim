// Sandboxed preload (Electron 11): may require('electron') and nothing else.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarNotepad', {
    getMessages: function () {
        return ipcRenderer.invoke(CH('notepadMessages'));
    },
    // The two typed helpers read the game; the main process reports what it can see.
    skillDump: function () {
        return ipcRenderer.invoke(CH('notepadSkillDump'));
    },
    mapItemDump: function () {
        return ipcRenderer.invoke(CH('notepadMapItemDump'));
    },
    save: function (text) {
        return ipcRenderer.invoke(CH('notepadSave'), text);
    }
});
