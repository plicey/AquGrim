// The spammer window's main-process half. The page draws the reference's controls and asks here
// for the saved list, for the loop's Start/Stop and for a single frame; the loop itself lives in
// spammer.js and every frame goes through host.packets.send (packet-send), never through a socket.
//
// The file shape is a user document, so the path always comes from a dialog they answered; the
// plugin only remembers which directory that was, the way the bot and set dialogs do.
const path = require('path');

const spammer = require('./spammer.js');

const STORE_NAMESPACE = 'spammer';
const STORE_KEY = 'lastDirectory';
const EXTENSION = '.xml';

function createSpammerWindow(deps) {
    deps = deps || {};
    const packets = deps.packets;
    const store = deps.store;
    const defaultDirectory = deps.defaultDirectory || '';
    const messages = deps.messages || {};
    // The page's own words: the reference's control text is the fallback, the plugin's locale
    // catalog overrides it (see LABELS in spammer.js).
    const labels = Object.assign({}, spammer.LABELS, messages);
    const showOpenDialog = deps.showOpenDialog;
    const showSaveDialog = deps.showSaveDialog;
    const readText = deps.readText || function (file) { return require('fs').readFileSync(file, 'utf8'); };
    const writeText = deps.writeText || function (file, text) {
        // The reference writes with XmlWriter.Create(file), which is UTF-8 with its BOM: the
        // serialised text already carries it, and a file here is bytes, not a decoded string.
        require('fs').writeFileSync(file, Buffer.from(text, 'utf8'));
    };

    function remembered() {
        if (!store) return null;
        try {
            const state = store.read();
            const value = state && state[STORE_KEY];
            return typeof value === 'string' && value ? value : null;
        } catch (error) {
            // A store that will not parse must not stop the user opening a list.
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

    const watchers = [];

    const loop = spammer.createSpammer({
        send: function (frame) { return packets.send(frame); },
        // The reference raises IndexChanged before each send so its list highlights the row going
        // out (PacketSpammer.IndexChanged). The loop lives here, so the index is pushed to the
        // window on its own channel.
        onIndex: function (index) {
            watchers.slice().forEach(function (watcher) {
                if (watcher.isDestroyed && watcher.isDestroyed()) return;
                watcher.send(deps.indexChannel, { index: index });
            });
        }
    });

    function open(owner) {
        return Promise.resolve(showOpenDialog(owner, {
            title: labels.loadTitle,
            defaultPath: remembered() || defaultDirectory,
            filters: [{ name: labels.filterName, extensions: [EXTENSION.slice(1)] }],
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
                return { canceled: false, path: file, error: message(error) };
            }
            const loaded = spammer.parseFile(text);
            if (!loaded.ok) return { canceled: false, path: file, error: loaded.error };
            return { canceled: false, path: file, error: null, packets: loaded.packets, delay: loaded.delay };
        });
    }

    function save(owner, config) {
        const chosen = config || {};
        return Promise.resolve(showSaveDialog(owner, {
            title: labels.saveTitle,
            defaultPath: path.join(remembered() || defaultDirectory, 'spammer' + EXTENSION),
            filters: [{ name: labels.filterName, extensions: [EXTENSION.slice(1)] }]
        })).then(function (result) {
            if (!result || result.canceled || !result.filePath) return { canceled: true };
            const file = path.extname(result.filePath) ? result.filePath : result.filePath + EXTENSION;
            remember(path.dirname(file));
            try {
                writeText(file, spammer.serializeFile(chosen));
            } catch (error) {
                return { canceled: false, path: file, error: message(error) };
            }
            return { canceled: false, path: file, error: null };
        });
    }

    function message(error) {
        return (error && error.message) || String(error);
    }

    function handle(channel, event, args) {
        void event;
        if (channel === 'spammerMessages') {
            return Promise.resolve(labels);
        }
        // No owner: the reference builds its dialogs ownerless (`new OpenFileDialog()` then
        // `ShowDialog()`), so they are not modal to the window that opened them.
        if (channel === 'spammerLoad') return open(undefined);
        if (channel === 'spammerSave') return save(undefined, (args && args[0]) || {});
        if (channel === 'spammerStart') {
            const config = (args && args[0]) || {};
            const started = loop.start(config.packets, config.delay);
            return Promise.resolve({ running: loop.running(), started: started });
        }
        if (channel === 'spammerStop') {
            loop.stop();
            return Promise.resolve({ running: false, sent: loop.sentCount(), failed: loop.failedCount() });
        }
        if (channel === 'spammerSendOnce') {
            const ok = loop.sendOnce((args && args[0]) || '');
            return Promise.resolve({ sent: ok, failed: loop.failedCount() });
        }
        throw new Error('[AquaStar:grimlite-parity] unknown spammer channel "' + channel + '"');
    }

    function attach() {
        if (!deps.host) return;
        const host = deps.host;
        host.ipc.handle('spammerMessages', function (event) { return handle('spammerMessages', event, []); });
        host.ipc.handle('spammerLoad', function (event) {
            watch(event.sender);
            return handle('spammerLoad', event, []);
        });
        host.ipc.handle('spammerSave', function (event, config) { return handle('spammerSave', event, [config]); });
        host.ipc.handle('spammerStart', function (event, config) {
            watch(event.sender);
            return handle('spammerStart', event, [config]);
        });
        host.ipc.handle('spammerStop', function (event) { return handle('spammerStop', event, []); });
        host.ipc.handle('spammerSendOnce', function (event, text) {
            return handle('spammerSendOnce', event, [text]);
        });
    }

    // The window that is sending is the one told which row is going out (IndexChanged); it stops
    // being told when it closes.
    function watch(watcher) {
        if (!watcher || watchers.indexOf(watcher) !== -1) return;
        watchers.push(watcher);
        if (typeof watcher.once === 'function') {
            watcher.once('destroyed', function () {
                const index = watchers.indexOf(watcher);
                if (index !== -1) watchers.splice(index, 1);
            });
        }
    }

    return { handle: handle, attach: attach, loop: function () { return loop; }, STORE_NAMESPACE: STORE_NAMESPACE };
}

/** The window as the plugin uses it: the page's channels, Electron's dialogs, the plugin's store. */
function createFromHost(host, deps) {
    deps = deps || {};
    const electron = deps.electron || require('electron');
    return createSpammerWindow({
        host: host,
        // The relay's write path, gated by packet-send inside the Host: nothing here touches a
        // socket, and the spammer never subscribes to the tap.
        packets: host.packets,
        store: host.getStore(STORE_NAMESPACE),
        // The reference has no Spammer/ folder beside the exe; here it is the app's own data
        // directory, beside the store the plugin already keeps there.
        defaultDirectory: path.join(host.appDataDirectory, 'Spammer'),
        indexChannel: 'plugin:' + host.pluginId + ':spammerIndex',
        messages: (typeof host.getLocaleStrings === 'function' &&
            host.getLocaleStrings('spammerMessages')) || {},
        showOpenDialog: function (owner, options) {
            return electron.dialog.showOpenDialog(owner, options);
        },
        showSaveDialog: function (owner, options) {
            return electron.dialog.showSaveDialog(owner, options);
        }
    });
}

module.exports = {
    createSpammerWindow: createSpammerWindow,
    createFromHost: createFromHost,
    STORE_NAMESPACE: STORE_NAMESPACE,
    EXTENSION: EXTENSION
};
