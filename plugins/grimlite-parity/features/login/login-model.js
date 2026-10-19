// Quick login and auto-relogin: the part that decides things (#35).
//
// The reference is Grimlite-Li. Its char list is read from CharSelect.cfg, a plaintext file of
// "index=username,password" lines (Grimoire/UI/Root.cs:131-163, Config.Load at
// Grimoire/Botting/Config.cs:38-72); its menu item is hidden while the connection is up
// (Root.cs:167, driven from Grimoire/Tools/Flash.cs:400-409); and one click on an entry calls
// AutoRelogin.Login(user, pass), which is Flash.Call("FixLogin", user, pass)
// (Root.cs:170-178, Grimoire/Tools/AutoRelogin.cs:26-29).
//
// Two of those are mechanism, not surface, and the spec's Out of Scope rules on one of them: the
// reference's plaintext .cfg is not ported. Credentials live in this process's memory for the
// session and are never written anywhere - which is why this module has no way to reach a disk, a
// store or Electron at all. The user's own CharSelect.cfg may be READ, because that file is the
// user's, not this app's; nothing here writes one.
//
// The rest of the reference's relogin sequence (AutoRelogin.cs:37-120) waits on names that exist
// only in the reference's own loader - FixLogin, ResetServers, AreServersLoaded, IsTemporarilyKicked
// - verified by exact ABC string-pool membership against the shipped game SWF: every one of them is
// absent there and present in Loader/grimoire.swf. The stock game's pool does carry `sfc`,
// `isConnected` and `connectTo`, but a pool entry is not proof of a callable member (ticket #29's
// bridge.js states the two-condition rule), so nothing here claims the connection state works until
// a live client says so: a read that cannot answer is reported as unknown, never as a drop.

// Where the reference keeps its characters, in the user's own words.
const CREDENTIALS_FILE = 'CharSelect.cfg';

// The one thing the app must tell the user rather than leave to inference.
const HELD_IN = 'Credentials are held in this app\'s memory for this session only. Nothing is written to a file, and they are gone when the app exits.';

const STATES = {
    connected: 'connected',
    lost: 'lost',
    unknown: 'unknown'
};

// The reference loader's own relogin surface, by name. Kept as data so what this port still owes is
// one list rather than a scattering of failures.
const LOADER_ONLY = {
    FixLogin: true,
    ResetServers: true,
    AreServersLoaded: true,
    IsTemporarilyKicked: true,
    IsLoggedIn: true,
    GetUsername: true,
    GetPassword: true
};

const LOGIN_CALLS = {
    signIn: 'FixLogin'
};

const ERRORS = {
    unknownCharacter: function (username) {
        return 'no saved character named "' + username + '"';
    },
    /** A name the reference's own loader provides and the stock game does not. */
    loaderSurface: function (name) {
        return '"' + name + '" belongs to the reference client\'s own loader, not to the game, and the ' +
            'bridge does not implement that surface yet (ticket #48)';
    },
    /** A username kept from a previous session has no password until the user types one. */
    noPassword: 'Enter the password again for this session.'
};

/**
 * Read the reference's own CharSelect.cfg format: keys "0", "1", ... and values
 * "username,password". Root.cs walks the indices in order and stops at the first one the file does
 * not define - and its `catch { i = -1; }` means a value it cannot split stops the walk too. The
 * password is everything after the first comma, so a password containing one survives.
 *
 * @param {string} text the file's own text
 * @returns {Array<{username: string, password: string}>} in file order, possibly empty
 */
function parseCredentialsFile(text) {
    if (typeof text !== 'string' || text === '') return [];
    const values = {};
    text.split(/\r?\n/).forEach(function (line) {
        const split = line.indexOf('=');
        if (split === -1) return;
        const key = line.slice(0, split);
        if (key === '' || /^\s+$/.test(key)) return;
        values[key] = line.slice(split + 1);
    });

    const characters = [];
    for (let index = 0; ; index++) {
        const value = values[String(index)];
        if (value === undefined) break;
        const comma = value.indexOf(',');
        // The reference's Split(',')[1] throws on a value without a comma and its catch stops the
        // walk; the entries already read are kept, which is what this returns.
        if (comma === -1) break;
        characters.push({
            username: value.slice(0, comma),
            password: value.slice(comma + 1)
        });
    }
    return characters;
}

/**
 * The session's characters. Credentials are held in this closure alone: there is no store, no file
 * and no dependency that could reach one, and `list()` returns usernames only so a window can draw
 * the list without ever being handed a secret.
 */
function createCredentialStore() {
    const held = [];

    function indexOfCharacter(username) {
        for (let i = 0; i < held.length; i++) {
            if (held[i].username === username) return i;
        }
        return -1;
    }

    return {
        /** Add a character, or replace the credentials of one already held. */
        add: function (username, password) {
            const character = { username: String(username), password: String(password) };
            const at = indexOfCharacter(character.username);
            if (at === -1) held.push(character);
            else held[at] = character;
            return { username: character.username };
        },

        /** Adopt characters read from the user's own file; nothing is persisted by doing so. */
        adopt: function (characters) {
            (characters || []).forEach(function (character) {
                if (character && character.username) {
                    const at = indexOfCharacter(character.username);
                    if (at === -1) held.push({ username: character.username, password: character.password });
                }
            });
            return this.list();
        },

        /** What a window may draw: usernames, and no password anywhere in the answer. */
        list: function () {
            return held.map(function (character) { return { username: character.username }; });
        },

        /** The credentials for one character, for the one caller that signs in. */
        credentialFor: function (username) {
            const at = indexOfCharacter(username);
            if (at === -1) return null;
            return { username: held[at].username, password: held[at].password };
        },

        /** Remove a character and its password with it. */
        remove: function (username) {
            const at = indexOfCharacter(username);
            if (at === -1) return { removed: false };
            held.splice(at, 1);
            return { removed: true };
        },

        /** Everything held, for the tests that prove a removed password is really gone. */
        snapshot: function () {
            return held.map(function (character) {
                return { username: character.username, password: character.password };
            });
        },

        size: function () { return held.length; }
    };
}

/**
 * Sign one character in. The reference's whole one-click path is one call - FixLogin(user, pass) -
 * so that is all this does; a name the game cannot answer is reported with the reason it cannot,
 * rather than looking like a rejected password.
 *
 * @param {{ call: (name: string, args: Array) => Promise }} game the game access (../../bridge.js)
 * @param {object} store the session's credentials
 * @param {string} username the entry the user clicked
 */
function signIn(game, store, username) {
    const character = store.credentialFor(username);
    if (!character) {
        return Promise.resolve({
            signedIn: false,
            username: username,
            error: ERRORS.unknownCharacter(username)
        });
    }
    if (!character.password) {
        return Promise.resolve({
            signedIn: false,
            username: character.username,
            error: ERRORS.noPassword
        });
    }
    return Promise.resolve()
        .then(function () {
            return game.call(LOGIN_CALLS.signIn, [character.username, character.password]);
        })
        .then(function () {
            // The answer is deliberately only that it happened: the password stays inside this
            // call and never travels back out to a window.
            return { signedIn: true, username: character.username, error: null };
        })
        .catch(function (error) {
            const message = (error && error.message) || String(error);
            return {
                signedIn: false,
                username: character.username,
                error: /^no member /.test(message) || LOADER_ONLY[LOGIN_CALLS.signIn]
                    ? message + ' - ' + ERRORS.loaderSurface(LOGIN_CALLS.signIn)
                    : message
                };
        });
}

/**
 * The reference shows its char list whenever the connection is down: Root_Load loads it at startup
 * (Root.cs:115), OnConnectionLost loads it again (Flash.cs:407-409) and OnConnection hides it
 * (Flash.cs:403-406). The stock game exposes no verified "am I connected" member, so the read is
 * injected and every answer it cannot give - null, a thrown error, an error report - is `unknown`.
 * An unknown state shows the list: a player whose session actually dropped must still be able to
 * click their character, and a list that is visible when it need not be costs nothing.
 */
function createConnectionWatch(deps) {
    deps = deps || {};
    const read = deps.read;
    const onChange = typeof deps.onChange === 'function' ? deps.onChange : function () {};
    let state = STATES.unknown;

    function visible() {
        return state !== STATES.connected;
    }

    return {
        state: function () { return state; },
        visible: visible,

        /** Read the session's connection state once and report a change if there was one. */
        poll: function () {
            const previous = state;
            return Promise.resolve()
                .then(function () { return read(); })
                .then(function (answer) {
                    if (!answer || answer.error) return STATES.unknown;
                    if (answer.connected === true) return STATES.connected;
                    if (answer.connected === false) return STATES.lost;
                    return STATES.unknown;
                }, function () {
                    return STATES.unknown;
                })
                .then(function (next) {
                    state = next;
                    if (next !== previous) onChange(next);
                    return state;
                });
        }
    };
}

module.exports = {
    CREDENTIALS_FILE: CREDENTIALS_FILE,
    HELD_IN: HELD_IN,
    STATES: STATES,
    LOADER_ONLY: LOADER_ONLY,
    LOGIN_CALLS: LOGIN_CALLS,
    ERRORS: ERRORS,
    parseCredentialsFile: parseCredentialsFile,
    createCredentialStore: createCredentialStore,
    signIn: signIn,
    createConnectionWatch: createConnectionWatch
};
