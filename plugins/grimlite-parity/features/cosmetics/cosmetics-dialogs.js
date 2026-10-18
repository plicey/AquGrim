// Open and save for a cosmetic set. The reference's dialogs are the model (CosmeticForm.cs:339-373):
// title "Save Set"/"Load Set", filter "Grimoire sets|*.gset", and a Sets/ folder beside the exe as
// the starting point (here: a Sets/ folder under the app's data directory).
//
// A set is the user's own document, so nothing here picks a path by itself: what it remembers is
// only the folder the user last used. Electron and the store are injected so this is testable.
const path = require('path');

const cosmetics = require('./cosmetics.js');

const STORE_NAMESPACE = 'sets';
const STORE_KEY = 'lastDirectory';
const EXTENSION = '.gset';

function createCosmeticsDialogs(deps) {
    deps = deps || {};
    const store = deps.store;
    const defaultDirectory = deps.defaultDirectory || '';
    const messages = deps.messages || {};
    const showOpenDialog = deps.showOpenDialog;
    const showSaveDialog = deps.showSaveDialog;
    const readText = deps.readText || function (file) { return require('fs').readFileSync(file, 'utf8'); };
    const writeText = deps.writeText || function (file, text) {
        const fs = require('fs');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };

    function remembered() {
        if (!store) return null;
        try {
            const value = store.read()[STORE_KEY];
            return typeof value === 'string' && value ? value : null;
        } catch (error) {
            // A store that will not parse must not stop the user opening a set.
            return null;
        }
    }

    function remember(directory) {
        if (!store || !directory) return;
        try {
            // readOrCreate, not read: the store's read throws while the file does not exist yet,
            // and the first save is exactly when it does not.
            const state = store.readOrCreate(function () { return {}; }) || {};
            state[STORE_KEY] = directory;
            store.write(state);
        } catch (error) {
            // Remembering is a convenience; failing to is not worth refusing a save over.
        }
    }

    function lastDirectory() {
        return remembered() || defaultDirectory;
    }

    function filter() {
        return { name: messages.filterName || 'Grimoire sets', extensions: [EXTENSION.slice(1)] };
    }

    /** Open a set, and hand back the rows it holds. A file that will not read is an error, not
     *  a grid of empties: the reference clears every box before it finds out. */
    function open() {
        return Promise.resolve(showOpenDialog(null, {
            title: messages.openTitle || 'Load Set',
            defaultPath: lastDirectory(),
            filters: [filter()],
            properties: ['openFile']
        })).then(function (result) {
            if (!result || result.canceled || !result.filePaths || !result.filePaths.length) {
                return { canceled: true };
            }
            const file = result.filePaths[0];
            remember(path.dirname(file));
            let text;
            try {
                text = readText(file);
            } catch (error) {
                return { canceled: false, path: file, values: null, error: (error && error.message) || String(error) };
            }
            const parsed = cosmetics.parseSetFile(text);
            return { canceled: false, path: file, values: parsed.values, error: parsed.error };
        });
    }

    /** Save the eight rows in the Sets window's own file shape. A cancel writes nothing. */
    function save(values) {
        const suggested = path.join(lastDirectory(), 'set' + EXTENSION);
        return Promise.resolve(showSaveDialog(null, {
            title: messages.saveTitle || 'Save Set',
            defaultPath: suggested,
            filters: [filter()]
        })).then(function (result) {
            if (!result || result.canceled || !result.filePath) return { canceled: true };
            const file = path.extname(result.filePath) ? result.filePath : result.filePath + EXTENSION;
            remember(path.dirname(file));
            try {
                // UTF-8, no BOM, no trailing newline: the bytes the Sets window writes.
                writeText(file, cosmetics.serializeSet(values));
            } catch (error) {
                return { canceled: false, path: file, error: (error && error.message) || String(error) };
            }
            return { canceled: false, path: file, error: null };
        });
    }

    return { open: open, save: save, lastDirectory: lastDirectory };
}

/** The dialogs as the plugin uses them: Electron's own, on the remembered folder. */
function createFromHost(host, deps) {
    deps = deps || {};
    const electron = deps.electron || require('electron');
    const strings = (typeof host.getLocaleStrings === 'function' &&
        host.getLocaleStrings('cosmeticsMessages')) || {};
    return createCosmeticsDialogs({
        store: host.getStore(STORE_NAMESPACE),
        defaultDirectory: path.join(host.appDataDirectory, 'Sets'),
        messages: { openTitle: strings.loadSet, saveTitle: strings.saveSet, filterName: strings.filterName },
        showOpenDialog: function (owner, options) { return electron.dialog.showOpenDialog(owner, options); },
        showSaveDialog: function (owner, options) { return electron.dialog.showSaveDialog(owner, options); }
    });
}

module.exports = {
    createCosmeticsDialogs: createCosmeticsDialogs,
    createFromHost: createFromHost,
    STORE_NAMESPACE: STORE_NAMESPACE,
    EXTENSION: EXTENSION
};
