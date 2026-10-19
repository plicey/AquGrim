// Open and save for .gbot files. A bot is a user document, not app state: the path always comes
// from a dialog the user answered, and the plugin only remembers which directory they were in.
// The reference's own dialogs are the model - title "Load bot"/"Save bot", filter
// "Grimoire bots|*.gbot", default extension .gbot, initial directory next to the exe (here: a
// plugin store, because AquaStar has no Bots/ folder beside the executable).
//
// Electron, the file system and the store are injected so this module is testable without
// Electron; res/platform's real dialog and namespaced store are wired in by main.js.
const path = require('path');

const bots = require('./bots.js');

const STORE_NAMESPACE = 'bots';
const STORE_KEY = 'lastDirectory';
const EXTENSION = '.gbot';

function createBotDialogs(deps) {
    deps = deps || {};
    const store = deps.store;
    const defaultDirectory = deps.defaultDirectory || '';
    const messages = deps.messages || {};
    const showOpenDialog = deps.showOpenDialog;
    const showSaveDialog = deps.showSaveDialog;
    const readText = deps.readText || function (file) { return require('fs').readFileSync(file, 'utf8'); };
    const writeText = deps.writeText || function (file, text) {
        const fs = require('fs');
        // A new user has no bot directory yet and the reference has no dialog that makes one.
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };

    function remembered() {
        if (!store) return null;
        try {
            const state = store.read();
            const value = state && state[STORE_KEY];
            return typeof value === 'string' && value ? value : null;
        } catch (error) {
            // A store that will not parse must not stop the user opening a bot.
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
            // BotManager.cs's own filter string: "Grimoire bots|*.gbot".
            name: messages.filterName || 'Grimoire bots',
            extensions: [EXTENSION.slice(1)]
        };
    }

    function open(owner, options) {
        options = options || {};
        const defaultPath = options.directory || lastDirectory();
        return Promise.resolve(showOpenDialog(owner, {
            title: messages.openTitle || 'Load bot',
            defaultPath: defaultPath,
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
                return { canceled: false, path: file, bot: null, error: error.message || String(error) };
            }
            const parsed = bots.parseBot(text);
            if (!parsed.ok) {
                return { canceled: false, path: file, bot: null, error: parsed.error };
            }
            return { canceled: false, path: file, bot: parsed.bot, error: null };
        });
    }

    function save(owner, bot, options) {
        options = options || {};
        const suggested = options.path || path.join(lastDirectory(), options.fileName || 'bot' + EXTENSION);
        return Promise.resolve(showSaveDialog(owner, {
            title: messages.saveTitle || 'Save bot',
            defaultPath: suggested,
            filters: [filter()]
        })).then(function (result) {
            if (!result || result.canceled || !result.filePath) {
                return { canceled: true };
            }
            const file = path.extname(result.filePath) ? result.filePath : result.filePath + EXTENSION;
            remember(path.dirname(file));
            // The line ending is the file's own: a bot the reference saved on Windows is CRLF,
            // and rewriting an edited file with LF would show as a whole-file diff.
            try {
                writeText(file, bots.serializeBot(bot, { eol: eolOf(file) }));
            } catch (error) {
                return { canceled: false, path: file, error: error.message || String(error) };
            }
            return { canceled: false, path: file, error: null };
        });
    }

    function eolOf(file) {
        try {
            const existing = readText(file);
            return existing.indexOf('\r\n') !== -1 ? '\r\n' : '\n';
        } catch (error) {
            return '\n';
        }
    }

    return {
        open: open,
        save: save,
        lastDirectory: lastDirectory
    };
}


/**
 * The dialogs as the plugin uses them: the platform's namespaced store for the remembered
 * directory, Electron's own file dialogs, and a directory under the app's data folder in place
 * of the reference's Bots/ beside the executable. The electron dependency is injectable so this
 * wiring is testable without Electron.
 */
function createFromHost(host, deps) {
    deps = deps || {};
    const electron = deps.electron || require('electron');
    return createBotDialogs({
        store: host.getStore(STORE_NAMESPACE),
        defaultDirectory: path.join(host.appDataDirectory, 'Bots'),
        messages: messagesFrom(host),
        showOpenDialog: function (owner, options) {
            return electron.dialog.showOpenDialog(owner, options);
        },
        showSaveDialog: function (owner, options) {
            return electron.dialog.showSaveDialog(owner, options);
        }
    });
}

/** Dialog titles and the filter name, from the plugin's own locale catalog. */
function messagesFrom(host) {
    const strings = (typeof host.getLocaleStrings === 'function' &&
        host.getLocaleStrings('botFileMessages')) || {};
    return {
        openTitle: strings.openTitle,
        saveTitle: strings.saveTitle,
        filterName: strings.filterName
    };
}

module.exports = {
    createBotDialogs: createBotDialogs,
    createFromHost: createFromHost,
    STORE_NAMESPACE: STORE_NAMESPACE,
    EXTENSION: EXTENSION
};
