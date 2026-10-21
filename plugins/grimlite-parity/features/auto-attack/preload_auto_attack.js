// Sandboxed preload for the Auto Attack-only skill set editor.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarAutoAttack', {
    get: function () { return ipcRenderer.invoke(CH('autoAttackSkillSetGet')); },
    save: function (text) { return ipcRenderer.invoke(CH('autoAttackSkillSetSave'), text); }
});
