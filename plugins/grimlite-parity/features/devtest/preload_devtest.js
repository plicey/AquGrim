// Sandboxed preload for the Dev Test window: it may require 'electron' and nothing else, so the
// call modes and the bridge live in the plugin's main process and this only forwards.
const { contextBridge, ipcRenderer } = require('electron');

const CH = function (name) {
    return 'plugin:grimlite-parity:' + name;
};

contextBridge.exposeInMainWorld('aquastarPlugin', {
    pluginId: 'grimlite-parity',
    modes: function () {
        return ipcRenderer.invoke(CH('devtestModes'));
    },
    run: function (mode, path, args, argsEnabled) {
        return ipcRenderer.invoke(CH('devtestRun'), mode, path, args, argsEnabled);
    },
    format: function (text) {
        return ipcRenderer.invoke(CH('devtestFormat'), text);
    },
    copy: function (text) {
        return ipcRenderer.invoke(CH('devtestCopy'), text);
    }
});
