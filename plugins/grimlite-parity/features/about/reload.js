// AboutForm.cs's btnLoadSWF_Click re-initialises the game movie (InitFlashMovie with the field
// the user typed). This port reloads each window the platform already classifies as this
// plugin's game, which also covers the local-origin form of the URL and any window opened from
// the chrome later. `isGameUrl` is the platform's classifier, handed in rather than guessed.

/**
 * @param {object} deps
 * @param {Array} deps.windows BrowserWindow.getAllWindows()
 * @param {(url: string) => boolean} deps.isGameUrl the platform's game-window classifier
 * @param {(error: Error, win: object) => void} [deps.onError] called when one reload throws
 * @returns {number} how many game windows were reloaded
 */
function gameMovie(deps) {
    deps = deps || {};
    const windows = Array.isArray(deps.windows) ? deps.windows : [];
    let reloaded = 0;
    windows.forEach(function (win) {
        if (!win || !win.webContents) return;
        const url = win.aquaStarSwfUrl || win.webContents.getURL();
        if (!deps.isGameUrl || !deps.isGameUrl(url)) return;
        try {
            win.webContents.reload();
            reloaded++;
        } catch (error) {
            if (typeof deps.onError === 'function') deps.onError(error, win);
        }
    });
    return reloaded;
}

module.exports = { gameMovie: gameMovie };
