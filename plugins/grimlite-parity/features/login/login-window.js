// The quick-login window's main-process half (#35): the character list a user adds to, the one-click
// sign-in, and the notice that says where the credentials are held.
//
// The reference's own surface is a top-level "Char Select" menu whose items are the saved
// usernames (Root.cs:1150-1152, :153) and whose click calls AutoRelogin.Login(user, pass)
// (Root.cs:170-178). A menu with one item per character cannot say what it holds or offer a
// removal, which the acceptance criteria require, so the port is a window and the menu entry opens
// it. The credentials are the session's (login-model.js), so every decision stays testable without
// Flash and nothing here has a place to write them.
//
// The window's channels are the only way a page reaches the credentials, and the page is a
// sandboxed local file whose own script asks for nothing else. `loginList` answers usernames only -
// the reasoning is in login-model.js's list().
const model = require('./login-model.js');

// The reference's own file, in the user's application directory: it may be read, never written.
const CREDENTIALS_FILE = model.CREDENTIALS_FILE;

function createLoginWindow(deps) {
    deps = deps || {};
    const store = deps.store || model.createCredentialStore();
    const game = deps.game;
    const messages = deps.messages || {};
    let watch = null;
    // Whoever asked for the list is who the connection state is pushed to. Recorded from the IPC
    // event, like the packet logger's own watchers, so the platform keeps owning its windows and
    // this only remembers which of them is showing the list.
    const shownIn = [];

    function remember(sender) {
        if (!sender || shownIn.indexOf(sender) !== -1) return;
        shownIn.push(sender);
        if (typeof sender.once === 'function') {
            sender.once('destroyed', function () {
                const at = shownIn.indexOf(sender);
                if (at !== -1) shownIn.splice(at, 1);
            });
        }
    }

    /** Hand the session's state to every window that is showing the list. */
    function push(state) {
        const payload = { state: state, visible: state !== model.STATES.connected };
        const channel = 'plugin:' + (deps.pluginId || 'grimlite-parity') + ':loginConnection';
        shownIn.slice().forEach(function (sender) {
            try {
                sender.send(channel, payload);
            } catch (error) {
                // A window the user just closed is not a reason to stop following the session.
            }
        });
        return payload;
    }

    function list() {
        return {
            characters: store.list(),
            heldIn: model.HELD_IN,
            // The state the window draws on load, so a list that opened after a drop is right
            // without waiting for the next poll.
            connection: {
                state: watch ? watch.state() : model.STATES.unknown,
                visible: watch ? watch.visible() : true
            }
        };
    }

    function handle(channel, args) {
        args = args || [];
        if (channel === 'loginList') return Promise.resolve(list());
        if (channel === 'loginMessages') return Promise.resolve(messages);
        if (channel === 'loginAdd') {
            const username = String(args[0] == null ? '' : args[0]).trim();
            if (!username) {
                return Promise.resolve({ added: false, error: messages.usernameRequired });
            }
            store.add(username, args[1]);
            return Promise.resolve(Object.assign({ added: true, error: null }, list()));
        }
        if (channel === 'loginRemove') {
            const removed = store.remove(args[0]);
            return Promise.resolve(Object.assign(removed, list()));
        }
        if (channel === 'loginSignIn') {
            // A window must never receive a rejection it cannot draw: login-model.js answers a
            // result either way, and this only guards a game access that throws on its own.
            return Promise.resolve()
                .then(function () { return model.signIn(game, store, args[0]); })
                .catch(function (error) {
                    return {
                        signedIn: false,
                        username: args[0],
                        error: (error && error.message) || String(error)
                    };
                });
        }
        throw new Error('[AquaStar:grimlite-parity] unknown login channel "' + channel + '"');
    }

    function attach() {
        if (!deps.host) return;
        const ipc = deps.host.ipc;
        ipc.handle('loginList', function (event) {
            remember(event && event.sender);
            return handle('loginList');
        });
        ipc.handle('loginMessages', function () { return handle('loginMessages'); });
        ipc.handle('loginConnection', function (event) {
            remember(event && event.sender);
            return Promise.resolve(push(watch ? watch.state() : model.STATES.unknown));
        });
        // The user's own CharSelect.cfg: read when they ask for it, and never written.
        ipc.handle('loginImport', function () {
            return Promise.resolve()
                .then(function () { return deps.readCredentialsFile(); })
                .then(function (result) {
                    if (result.error) return { imported: 0, error: result.error };
                    const before = store.size();
                    store.adopt(model.parseCredentialsFile(result.text));
                    return Object.assign({
                        imported: store.size() - before,
                        skipped: 0,
                        error: null
                    }, list());
                }, function (error) {
                    return { imported: 0, error: (error && error.message) || String(error) };
                });
        });
        ipc.handle('loginAdd', function (event, username, password) {
            return handle('loginAdd', [username, password]);
        });
        ipc.handle('loginRemove', function (event, username) {
            return handle('loginRemove', [username]);
        });
        ipc.handle('loginSignIn', function (event, username) {
            return handle('loginSignIn', [username]);
        });
    }

    // The window follows the session: the list appears when the connection drops and hides when a
    // connection is established (Flash.cs:400-409). The read is the plugin's game access, and the
    // state is pushed to whichever login window is open.
    function startWatching(notify) {
        if (!watch) {
            watch = model.createConnectionWatch({
                read: deps.readConnection,
                // The raw state: the one shape the window is handed is built in push(), so a
                // caller cannot receive the payload and the state in two different shapes.
                onChange: notify
            });
        }
        return watch;
    }

    // The reference's own behaviour is its menu item: it becomes visible on a lost connection and
    // hides again on a live one (Root.cs:167, Flash.cs:400-409), and the list is what the user then
    // clicks. In window terms: the entry is always reachable (as the reference loads it at startup),
    // it opens itself on a *confirmed* drop, and the state is pushed to whatever window is open so
    // the list inside hides again on a reconnect.
    //
    // Only `lost` opens it. `unknown` is the state this app is in whenever the connection read
    // cannot answer - which is its state until a live client confirms the path - and auto-opening on
    // that would put a window in front of every user whose connection is in fact fine. The list
    // stays reachable by menu and hotkey either way, so nothing is lost by waiting for evidence. A
    // window the user opened is never closed underneath them; that is the one deliberate difference
    // here, and it only ever leaves a window open, never takes one away.
    //
    // The timer is injected because a test must not start one, and it is unref'd so a running app
    // can still exit with the poll in place.
    function startSessionWatch(options) {
        options = options || {};
        const every = options.every || setInterval;
        const cancel = options.cancel || clearInterval;
        const open = options.open;
        const notify = options.push || function () {};
        let opened = false;

        const session = startWatching(function (state) {
            const payload = push(state);
            notify(payload);
        });
        const handle = every(function () {
            // Returned so a caller - the app or a test - can wait for the tick it asked for.
            return session.poll().then(function (state) {
                if (state === model.STATES.lost && !opened) {
                    opened = true;
                    if (typeof open === 'function') open();
                }
                return state;
            });
        }, options.intervalMs || 5000);
        if (handle && typeof handle.unref === 'function') handle.unref();

        return { session: session, stop: function () { cancel(handle); } };
    }

    return {
        handle: handle,
        attach: attach,
        store: store,
        watch: function () { return watch; },
        startWatching: startWatching,
        startSessionWatch: startSessionWatch,
        list: list
    };
}

module.exports = {
    createLoginWindow: createLoginWindow,
    CREDENTIALS_FILE: CREDENTIALS_FILE
};
