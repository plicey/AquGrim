// Open and save for .gset files, and the saved-set listing that makes Load not the only way in.
// Reference: Grimoire/UI/Set.cs :217-260 - title "Save Set"/"Load Set", filter
// "Grimoire sets|*.gset", default extension .gset, initial directory a Sets/ folder beside the
// exe (here: a plugin store, because AquaStar has no Sets/ folder beside the executable).
//
// A set is a user document like a bot, so the path always comes from a dialog the user
// answered or from the listing they clicked; the plugin only remembers which folder that was.
// Electron, the file system and the store are injected so this is testable without Electron.
const path = require('path');

const sets = require('./sets.js');

const STORE_NAMESPACE = 'sets';
const STORE_KEY = 'lastDirectory';
const EXTENSION = '.gset';

function createSetDialogs(deps) {
    deps = deps || {};
    const store = deps.store;
    const defaultDirectory = deps.defaultDirectory || '';
    const messages = deps.messages || {};
    const showOpenDialog = deps.showOpenDialog;
    const showSaveDialog = deps.showSaveDialog;
    const readText = deps.readText || function (file) { return require('fs').readFileSync(file, 'utf8'); };
    const writeText = deps.writeText || function (file, text) {
        const fs = require('fs');
        // A new user has no sets folder yet, and the reference's own save handler makes one.
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };
    const listSets = deps.listSets || sets.listSets;

    function remembered() {
        if (!store) return null;
        try {
            const state = store.read();
            const value = state && state[STORE_KEY];
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
        return {
            name: messages.filterName || 'Grimoire sets',
            extensions: [EXTENSION.slice(1)]
        };
    }

    /** Every set in the folder the user last used, so the window can list them. */
    function list() {
        return Promise.resolve(listSets(lastDirectory()));
    }

    function readEntries(file) {
        let text;
        try {
            text = readText(file);
        } catch (error) {
            return { entries: null, error: (error && error.message) || String(error) };
        }
        const parsed = sets.parseSet(text);
        return { entries: parsed.entries, error: parsed.error };
    }

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
            const read = readEntries(file);
            return { canceled: false, path: file, entries: read.entries, error: read.error };
        });
    }

    /**
     * Open one of the listed sets directly. The path is relative to the sets folder and is
     * confined to it: a listing entry must not become a way to read any file on the disk.
     */
    function openByPath(relativePath) {
        const directory = lastDirectory();
        const full = path.resolve(directory, String(relativePath));
        const root = path.resolve(directory);
        if (full.indexOf(root + path.sep) !== 0) {
            return Promise.resolve({ canceled: false, path: null, entries: null, error: sets.ERRORS.outside });
        }
        const read = readEntries(full);
        return Promise.resolve({ canceled: false, path: full, entries: read.entries, error: read.error });
    }

    function save(entries) {
        const suggested = path.join(lastDirectory(), 'set' + EXTENSION);
        return Promise.resolve(showSaveDialog(null, {
            title: messages.saveTitle || 'Save Set',
            defaultPath: suggested,
            filters: [filter()]
        })).then(function (result) {
            if (!result || result.canceled || !result.filePath) {
                return { canceled: true };
            }
            // The reference's SaveFileDialog adds its default extension when the user gives none.
            const file = path.extname(result.filePath) ? result.filePath : result.filePath + EXTENSION;
            remember(path.dirname(file));
            try {
                writeText(file, sets.serializeSet(entries));
            } catch (error) {
                return { canceled: false, path: file, error: (error && error.message) || String(error) };
            }
            return { canceled: false, path: file, error: null };
        });
    }

    return {
        list: list,
        open: open,
        openByPath: openByPath,
        save: save,
        lastDirectory: lastDirectory
    };
}

/**
 * The dialogs as the plugin uses them: the platform's namespaced store for the remembered
 * folder, Electron's own file dialogs, and a Sets/ folder under the app's data directory in
 * place of the reference's folder beside the executable.
 */
function createFromHost(host, deps) {
    deps = deps || {};
    const electron = function () { return deps.electron || require('electron'); };
    return createSetDialogs({
        store: host.getStore(STORE_NAMESPACE),
        defaultDirectory: path.join(
            host.persistentAppDataDirectory || host.appDataDirectory, 'Sets'),
        messages: messagesFrom(host),
        showOpenDialog: function (owner, options) {
            return electron().dialog.showOpenDialog(owner, options);
        },
        showSaveDialog: function (owner, options) {
            return electron().dialog.showSaveDialog(owner, options);
        }
    });
}

/** Dialog titles and the filter name, from the plugin's own locale catalog. */
function messagesFrom(host) {
    const strings = (typeof host.getLocaleStrings === 'function' &&
        host.getLocaleStrings('setsMessages')) || {};
    return {
        openTitle: strings.openTitle,
        saveTitle: strings.saveTitle,
        filterName: strings.filterName
    };
}

module.exports = {
    createSetDialogs: createSetDialogs,
    createFromHost: createFromHost,
    STORE_NAMESPACE: STORE_NAMESPACE,
    EXTENSION: EXTENSION
};
