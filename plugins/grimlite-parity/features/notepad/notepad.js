// Notepad window - IPC. The reference (Grimoire/UI/Notepad.cs) keeps the text in the control
// and only leaves the process for the two things that cannot be done in a page: the native
// save dialog, and reading the game for the two typed helpers.
const dumps = require('./dumps.js');
const { createGameSource } = require('./game-source.js');

// The save dialog comes from Electron at call time: outside the app process `require('electron')`
// resolves to the npm shim (a path string), so destructuring at load time would give undefined.
function showSaveDialog(owner, options) {
    const electron = require('electron');
    if (!electron || !electron.dialog) return Promise.resolve({ canceled: true });
    return electron.dialog.showSaveDialog(owner, options);
}

// The reference's SaveFileDialog filter, in the same order and with the same default index.
const SAVE_FILTERS = [
    { name: 'txt files', extensions: ['txt'] },
    { name: 'gbot files', extensions: ['gbot'] },
    { name: 'All files', extensions: ['*'] }
];

/**
 * @param {object} deps
 * @param {object} [deps.gameSource] skill/map-item source (see game-source.js)
 * @param {Function} [deps.showSaveDialog] Electron dialog.showSaveDialog, for tests
 * @param {Function} [deps.writeFile] fs.writeFileSync, for tests
 * @param {Function} deps.getMessages locale strings for this window
 */
function createNotepad(deps) {
    deps = deps || {};
    const source = deps.gameSource || createGameSource();
    const saveDialog = deps.showSaveDialog || showSaveDialog;
    const writeFile = deps.writeFile || require('fs').writeFileSync;
    const getMessages = deps.getMessages || function () { return {}; };

    function register(host) {
        const ipc = host.ipc;

        ipc.handle('notepadMessages', function () {
            return getMessages();
        });

        // The two typed helpers. Nothing is invented when the game cannot be read yet: the
        // dump says what it saw, which is the equipped class and the action list the bridge
        // reported (an empty list until ticket #28 lands).
        ipc.handle('notepadSkillDump', function () {
            return dumps.skillDump(source.equippedClass(), source.skillActions());
        });

        ipc.handle('notepadMapItemDump', function () {
            return dumps.mapItemDump(source.mapItems());
        });

        ipc.handle('notepadSave', async function (event, text) {
            const owner = deps.getWindow ? deps.getWindow(event) : undefined;
            const result = await saveDialog(owner, {
                // SaveFileDialog's own default title: the reference never sets one.
                title: 'Save As',
                filters: SAVE_FILTERS,
                properties: ['createDirectory', 'showOverwriteConfirmation']
            });
            if (!result || result.canceled || !result.filePath) return { canceled: true };
            try {
                // The reference writes the plain text of the box, not its rich markup.
                writeFile(result.filePath, String(text == null ? '' : text), 'utf8');
                return { saved: (getMessages().savedAs || 'Saved as {path}').replace('{path}', result.filePath) };
            } catch (error) {
                return { error: (getMessages().saveFailed || 'Could not save: {error}')
                    .replace('{error}', error && error.message ? error.message : String(error)) };
            }
        });
    }

    return { register: register, gameSource: source };
}

module.exports = { createNotepad: createNotepad, SAVE_FILTERS: SAVE_FILTERS };
