// The chrome strip's IPC: the game window's page reads the strip it must draw and reports the
// controls the user pressed. Both ends are the platform's - the page is the platform's wrapper
// and the strip's contents come from the active plugin through the Host - so this lives beside
// the recording IPC rather than inside any plugin.
const { ipcMain, BrowserWindow } = require('electron');
const { gameChrome } = require('../windows/game-chrome.js');

function windowOf(event) {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win && !win.isDestroyed() ? win : null;
}

ipcMain.handle('getGameChromeView', function (event) {
    return gameChrome().pageView(windowOf(event));
});

ipcMain.handle('gameChromeAction', function (event, id, args) {
    return gameChrome().dispatch(windowOf(event), id, args);
});
