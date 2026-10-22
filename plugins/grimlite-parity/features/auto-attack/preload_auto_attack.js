// Sandboxed preload for the Auto Attack-only skill set editor.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarAutoAttack', {
    get: function () { return ipcRenderer.invoke(CH('autoAttackSkillSetGet')); },
    draft: function (data) { return ipcRenderer.invoke(CH('autoAttackSkillSetDraft'), data); },
    loadPreset: function (data) { return ipcRenderer.invoke(CH('autoAttackPresetLoad'), data); },
    savePreset: function (data) { return ipcRenderer.invoke(CH('autoAttackPresetSave'), data); },
    deletePreset: function (data) { return ipcRenderer.invoke(CH('autoAttackPresetDelete'), data); },
    useDefault: function (data) { return ipcRenderer.invoke(CH('autoAttackSkillSetDefault'), data); },
    useDraft: function (data) { return ipcRenderer.invoke(CH('autoAttackSkillSetUseDraft'), data); }
});
