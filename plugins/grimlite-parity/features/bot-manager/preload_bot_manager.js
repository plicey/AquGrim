// Sandboxed preload (Electron 11): may require('electron') and nothing else. Every call the page
// makes is a namespaced IPC invoke; the sheet, the catalog and the document live in the plugin's
// main process (bot-manager.js).
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarBotManager', {
    sheet: function () { return ipcRenderer.invoke(CH('botManagerSheet')); },
    messages: function () { return ipcRenderer.invoke(CH('botManagerMessages')); },
    load: function (file) { return ipcRenderer.invoke(CH('botManagerLoad'), file || null); },
    save: function (options) { return ipcRenderer.invoke(CH('botManagerSave'), options || null); },
    add: function (id, values, modifiers) {
        return ipcRenderer.invoke(CH('botManagerAdd'), id, values, modifiers || {});
    },
    addList: function (id, values, modifiers) {
        return ipcRenderer.invoke(CH('botManagerAddList'), id, values, modifiers || {});
    },
    select: function (list, selection) {
        return ipcRenderer.invoke(CH('botManagerSelect'), list, selection);
    },
    key: function (action, options) {
        return ipcRenderer.invoke(CH('botManagerKey'), action, options || {});
    },
    form: function (index) { return ipcRenderer.invoke(CH('botManagerForm'), index); },
    edit: function (index, values) { return ipcRenderer.invoke(CH('botManagerEdit'), index, values); },
    raw: function (index, text) { return ipcRenderer.invoke(CH('botManagerRaw'), index, text); },
    setting: function (key, value) { return ipcRenderer.invoke(CH('botManagerSetting'), key, value); },
    style: function (options) { return ipcRenderer.invoke(CH('botManagerStyle'), options || {}); },
    tree: function (segments) { return ipcRenderer.invoke(CH('botManagerTree'), segments || []); },
    chooseDirectory: function () { return ipcRenderer.invoke(CH('botManagerChooseDirectory')); },
    addFolder: function (name) { return ipcRenderer.invoke(CH('botManagerAddFolder'), name); },
    treeSelect: function (segments, ctrl) {
        return ipcRenderer.invoke(CH('botManagerTreeSelect'), segments, ctrl === true);
    },
    game: function (id, modifiers) {
        return ipcRenderer.invoke(CH('botManagerGame'), id, modifiers || {});
    },
    beep: function () { return ipcRenderer.invoke(CH('botManagerBeep')); },
    drop: function (files) { return ipcRenderer.invoke(CH('botManagerDrop'), files || []); },
    // The native clipboard is main-process work; this window has no Node.
    clipboardWrite: function (text) { return ipcRenderer.invoke(CH('botManagerCopy'), text); },
    clipboardRead: function () { return ipcRenderer.invoke(CH('botManagerPaste')); },
    // The engine's two controls (#37): the Enable Bot tick starts and stops this window's bot,
    // and the state read is what the window draws the tick and the log from.
    enable: function (on) { return ipcRenderer.invoke(CH('botManagerEnable'), on === true); },
    botState: function () { return ipcRenderer.invoke(CH('botManagerState')); },
    enableOptions: function (on) { return ipcRenderer.invoke(CH('botManagerOptionsEnable'), on === true); },
    onOptionsState: function (listener) {
        if (typeof listener !== 'function') return function () {};
        const handler = function (event, running) {
            void event;
            listener(running === true);
        };
        ipcRenderer.on(CH('botManagerOptionsState'), handler);
        return function () { ipcRenderer.removeListener(CH('botManagerOptionsState'), handler); };
    }
});
