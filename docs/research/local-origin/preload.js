// Harness preload: forwards page-side errors to the main process so a failed embed shows up
// in the log, not only in a screenshot. Scratch artifact; not shipped.
const { ipcRenderer } = require('electron');

window.addEventListener('error', function (e) {
    try { ipcRenderer.send('aq-page-error', String(e.message || e.type) + ' @ ' + (e.filename || '')); } catch (err) {}
});
window.addEventListener('unhandledrejection', function (e) {
    try { ipcRenderer.send('aq-page-error', 'unhandledrejection: ' + String(e.reason)); } catch (err) {}
});
