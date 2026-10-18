// The Maid window's main-process half (ticket #43). The page is sandboxed, so every read, every
// key and every game call crosses this IPC edge; the decisions live in ./maid.js and the file
// format in ./config.js.
//
// Reference: Grimoire/UI/Maid/MaidRemake.cs, whose own window is one form of Enable, the target
// box, the skill list, the two keys (Unfollow, StopAttack), the Global Hotkey box, the option
// boxes, the class-preset picker and a Save/Load pair over a Config folder with a fixed
// autoload.json. Its class presets are C# (Tools/Maid/ClassPreset.cs), so they ship here as data.
//
// THE CONFIG FILE IS THE REFERENCE'S OWN. Same 23 key names, same overlay semantics (an absent
// field leaves the box as it is), same fixed Config/autoload.json applied on activation, and the
// same manual Save/Load pair over a user-chosen file. Upstream that folder sits beside the
// executable; here it is the app's own data directory beside the store the plugin already keeps
// there, because a packaged app has no writable folder beside its binary.

const fs = require('fs');
const path = require('path');
const config = require('./config.js');
const maidModel = require('./maid.js');
const presets = require('./presets.js');
const partyModel = require('./party.js');

// The channels this window's own handle() answers. The state push and the watch channel are
// attached separately, because they are about a window being open rather than about one call.
const CHANNELS = [
    'maidView', 'maidMessages', 'maidPresets', 'maidSet', 'maidPreset', 'maidMe',
    'maidSave', 'maidLoad', 'maidAutoload'
];

// The game's own name field, which is where the reference gets the character it is playing
// (`btnMe` sets the target to `Player.Username`). The loader's own GetUsername holds the login it
// captured (ticket #35), so this reads the game's field that the loader itself writes into.
const PLAYERNAME_PATH = 'world.myAvatar.objData.strUsername';

/** The reference's own Config folder, under the app's data directory. */
function configDirectory(appDataDirectory) {
    return path.join(appDataDirectory, 'Config');
}

function message(error) {
    return (error && error.message) || String(error);
}

/**
 * @param {object} deps
 * @param {object} deps.host        the plugin Host (ipc, log, appDataDirectory, bridge)
 * @param {object} deps.maid        the scheduler (./maid.js)
 * @param {object} [deps.party]     the party half (./party.js), absent when there is no tap
 * @param {object} [deps.messages]  the window's words, from the plugin's locale catalog
 * @param {object} [deps.dialogs]   {open, save} - the user's own file dialogs
 * @param {() => object} [deps.game]  a dot-path reader, for the Me button
 */
function createMaidWindow(deps) {
    deps = deps || {};
    const maid = deps.maid;
    const party = deps.party || null;
    const messages = deps.messages || {};
    const log = typeof deps.log === 'function' ? deps.log : function () {};
    const directory = configDirectory(deps.appDataDirectory || '.');
    const dialogs = deps.dialogs || null;
    const game = deps.game || null;
    let state = config.stateFrom(config.defaults());
    let loadedFrom = null;
    let carriedHeal = true;      // ClassPreset.cs's own static `heal`, carried across presets
    const onChange = [];

    /** Everything the page draws, from the scheduler's own state. */
    function view() {
        const live = maid.state();
        return {
            state: Object.assign({}, live, { config: Object.assign({}, state), loadedFrom: loadedFrom }),
            presets: presets.names(),
            messages: messages,
            fields: { all: config.FIELDS, numbers: config.NUMBERS, booleans: config.BOOLEANS },
            parties: { enabled: party !== null, commands: partyModel.COMMANDS }
        };
    }

    /** Tell the listeners the config moved, so a key can follow the Global Hotkey box. */
    function announce(patch) {
        onChange.slice().forEach(function (listener) {
            try {
                listener(patch, Object.assign({}, state));
            } catch (error) {
                log('maid: a config watcher threw (' + message(error) + ')');
            }
        });
    }

    /** One change from the page: config fields, one of the two keys, the target, or Enable. */
    function set(patch) {
        const change = patch || {};
        const before = Object.assign({}, state);
        if (Object.prototype.hasOwnProperty.call(change, 'config')) {
            const next = change.config || {};
            Object.keys(next).forEach(function (key) {
                if (config.FIELDS.indexOf(key) === -1) return;
                const value = next[key];
                if (typeof value === 'string' && value === '' && config.NUMBERS.indexOf(key) === -1) {
                    // A box the user cleared is a real edit of the file, not a value the overlay
                    // is asked to ignore: the reference's own ApplyConfig rule is about files.
                    state[key] = '';
                    return;
                }
                if (config.NUMBERS.indexOf(key) !== -1) {
                    const number = Number(value);
                    if (isFinite(number)) state[key] = number;
                    return;
                }
                if (config.BOOLEANS.indexOf(key) !== -1) {
                    state[key] = value === true || value === 'true';
                    return;
                }
                state[key] = String(value);
            });
        }
        if (Object.prototype.hasOwnProperty.call(change, 'target')) {
            const name = String(change.target === null || change.target === undefined ? '' : change.target);
            maid.setTarget(name);
            state.Target = name;
        }
        if (Object.prototype.hasOwnProperty.call(change, 'unfollow')) maid.setUnfollow(change.unfollow === true);
        if (Object.prototype.hasOwnProperty.call(change, 'stopAttack')) maid.setStopAttack(change.stopAttack === true);
        if (Object.prototype.hasOwnProperty.call(change, 'enabled')) {
            // The window's own Enable box drives the same switch the hotkey and the party
            // commands do, and starting runs the loop; stopping ends it.
            const on = change.enabled === true;
            maid.setEnabled(on);
            if (on) maid.start();
        }
        announce(change, before);
        return view();
    }

    /**
     * One of the reference's class presets, applied over the current state. ClassPreset.cs writes
     * the form's own boxes, so this writes the state the same way and carries its static `heal`.
     */
    function preset(name) {
        const chosen = presets.byName(name);
        if (!chosen) return { ok: false, error: 'no preset named "' + name + '"' };
        const answer = presets.applyTo(chosen, state, carriedHeal);
        state = answer.config;
        carriedHeal = answer.heal;
        announce({ config: { SkillList: chosen.skills } }, {});
        log('maid: preset ' + chosen.name + ' applied');
        return { ok: true, view: view() };
    }

    /** The reference's own autoload.json, applied at activation exactly as AutoLoadConfig does. */
    function autoload() {
        const file = path.join(directory, 'autoload.json');
        let text;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch (error) {
            // No file yet is the ordinary first run, not a failure: the reference's own
            // AutoLoadConfig returns silently when the path does not exist.
            return { ok: true, applied: false, path: file };
        }
        const parsed = config.parse(text);
        if (!parsed.ok) {
            log('maid: ' + file + ' was not applied: ' + parsed.error);
            return { ok: false, applied: false, path: file, error: parsed.error };
        }
        state = config.apply(parsed.config, state);
        loadedFrom = path.basename(file);
        announce({ config: parsed.config }, {});
        log('maid: autoloaded ' + file);
        return { ok: true, applied: true, path: file };
    }

    function save(requested) {
        const target = requested || path.join(directory, 'autoload.json');
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.writeFileSync(target, config.serialise(state));
        } catch (error) {
            return { ok: false, error: 'could not save the config: ' + message(error) };
        }
        loadedFrom = path.basename(target);
        log('maid: saved ' + target);
        return { ok: true, path: target, view: view() };
    }

    function load(text, name) {
        const parsed = config.parse(text);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        state = config.apply(parsed.config, state);
        loadedFrom = name || null;
        announce({ config: parsed.config }, {});
        return { ok: true, view: view() };
    }

    /** The reference's own btnMe: the target becomes the character being played. */
    function me() {
        if (!game || typeof game.read !== 'function') {
            return Promise.resolve({ ok: false, error: 'this app has no game bridge channel' });
        }
        return Promise.resolve(game.read(PLAYERNAME_PATH)).then(function (answer) {
            const name = answer && answer.value ? String(answer.value) : '';
            if (!name) {
                return { ok: false, error: (answer && answer.error) || 'no character is signed in' };
            }
            return Object.assign(set({ target: name }), { ok: true });
        }, function (error) {
            return { ok: false, error: message(error) };
        });
    }

    function handle(channel, event, args) {
        void event;
        const first = args && args[0];
        switch (channel) {
        case 'maidView':
            return Promise.resolve(view());
        case 'maidMessages':
            return Promise.resolve(messages);
        case 'maidPresets':
            return Promise.resolve({ names: presets.names(), values: presets.ALL });
        case 'maidSet':
            return Promise.resolve(set(first));
        case 'maidPreset':
            return Promise.resolve(preset(first));
        case 'maidMe':
            return me();
        case 'maidSave':
            if (!dialogs || typeof dialogs.save !== 'function') return Promise.resolve(save(null));
            return Promise.resolve(dialogs.save(null, config.serialise(state), {
                directory: directory,
                name: 'autoload.json'
            })).then(function (answer) {
                if (answer && answer.canceled) return { ok: true, canceled: true, view: view() };
                if (answer && answer.error) return { ok: false, error: answer.error };
                loadedFrom = answer && answer.path ? path.basename(answer.path) : loadedFrom;
                return { ok: true, path: answer && answer.path, view: view() };
            });
        case 'maidLoad':
            if (!dialogs || typeof dialogs.open !== 'function') {
                return Promise.resolve({ ok: false, error: 'this app has no file dialog' });
            }
            return Promise.resolve(dialogs.open(null, { directory: directory })).then(function (answer) {
                if (answer && answer.canceled) return { ok: true, canceled: true, view: view() };
                if (answer && answer.error) return { ok: false, error: answer.error };
                return Object.assign(load(answer && answer.text, answer && answer.path
                    ? path.basename(answer.path) : null), { view: view() });
            });
        case 'maidAutoload':
            return Promise.resolve(Object.assign(autoload(), { view: view() }));
        default:
            throw new Error('[AquaStar:grimlite-parity] unknown maid channel "' + channel + '"');
        }
    }

    function attach() {
        if (!deps.host) return;
        const host = deps.host;
        CHANNELS.forEach(function (name) {
            host.ipc.handle(name, function (event) {
                return handle(name, event, Array.prototype.slice.call(arguments, 1));
            });
        });
    }

    return {
        handle: handle,
        attach: attach,
        view: view,
        set: set,
        preset: preset,
        autoload: autoload,
        save: save,
        load: load,
        me: me,
        config: function () { return Object.assign({}, state); },
        /** Watch the config, so a key can follow the Global Hotkey box. */
        onConfigChange: function (listener) {
            if (typeof listener === 'function') onChange.push(listener);
            return function () {
                const at = onChange.indexOf(listener);
                if (at !== -1) onChange.splice(at, 1);
            };
        },
        directory: directory
    };
}

/** The user's own Save/Load pair, as the reference's two file dialogs. */
function createDialogs(deps) {
    deps = deps || {};
    const electronFor = deps.electron || function () { return require('electron'); };
    const words = deps.messages || {};
    return {
        open: function (owner, options) {
            const electron = electronFor();
            return Promise.resolve(electron.dialog.showOpenDialog(owner, {
                title: words.loadTitle || 'Load config',
                defaultPath: (options && options.directory) || undefined,
                filters: [{ name: words.filterName || 'Maid config', extensions: ['json'] }],
                properties: ['openFile']
            })).then(function (answer) {
                if (!answer || answer.canceled || !answer.filePaths || !answer.filePaths.length) {
                    return { canceled: true };
                }
                const file = answer.filePaths[0];
                try {
                    return { canceled: false, path: file, text: fs.readFileSync(file, 'utf8') };
                } catch (error) {
                    return { canceled: false, path: file, error: message(error) };
                }
            });
        },
        save: function (owner, text, options) {
            const electron = electronFor();
            const directory = (options && options.directory) || undefined;
            return Promise.resolve(electron.dialog.showSaveDialog(owner, {
                title: words.saveTitle || 'Save config',
                defaultPath: directory && options.name ? path.join(directory, options.name) : directory,
                filters: [{ name: words.filterName || 'Maid config', extensions: ['json'] }]
            })).then(function (answer) {
                if (!answer || answer.canceled || !answer.filePath) return { canceled: true };
                try {
                    fs.writeFileSync(answer.filePath, String(text));
                } catch (error) {
                    return { canceled: false, path: answer.filePath, error: message(error) };
                }
                return { canceled: false, path: answer.filePath };
            });
        }
    };
}

/**
 * The Maid's own two keys: Unfollow and StopAttack. The reference has a KeyDown handler on its own
 * form for both while it has focus, and one LowLevelKeyboardHook for the same two keys app-wide
 * once its Global Hotkey box is ticked.
 *
 * Here that is the app's two shortcut layers, injected exactly as the Hotkeys window (#34) takes
 * them, and the choice between them is the`Global Hotkey` box. Both keys are the plugin's own
 * keybind ids, so they are rebindable from the app's Settings like any other binding, and the
 * accelerators are read from what the app merged for this session rather than from a second copy
 * of the defaults.
 */
function createKeys(deps) {
    deps = deps || {};
    const maid = deps.maid;
    const log = typeof deps.log === 'function' ? deps.log : function () {};
    const local = deps.localShortcuts || null;
    const global = deps.globalShortcuts || null;
    const ids = deps.ids || {};
    const accelerators = deps.accelerators || function () { return {}; };
    let onLayer = null;
    let registered = [];

    // The reference's own two handlers (MaidRemake.hotkey / globalHotkey): each key flips its box.
    const bindings = {};
    bindings[ids.unfollow || 'grimliteMaidUnfollow'] = function () {
        maid.toggleUnfollow();
        log('maid: unfollow is ' + (maid.state().unfollow ? 'on' : 'off'));
    };
    bindings[ids.stopAttack || 'grimliteMaidStopAttack'] = function () {
        maid.toggleStopAttack();
        log('maid: stop attack is ' + (maid.state().stopAttack ? 'on' : 'off'));
    };

    function release() {
        registered.forEach(function (one) {
            try {
                one.layer.unregister(one.accel);
            } catch (error) {
                // A key that was never registered is not a failure.
            }
        });
        registered = [];
        onLayer = null;
    }

    /** Put both keys on the layer the Global Hotkey box asks for, and only on that one. */
    function apply(isGlobal) {
        const want = isGlobal === true ? 'global' : 'local';
        if (onLayer === want) return { ok: true, layer: want, registered: registered.length };
        release();
        const layer = (want === 'global' ? global : local) || null;
        if (!layer || typeof layer.register !== 'function') {
            log('maid: this app session has no ' + want + ' shortcut layer to put the keys on');
            return { ok: false, error: 'no ' + want + ' shortcut layer' };
        }
        const keys = accelerators() || {};
        Object.keys(bindings).forEach(function (id) {
            const accel = keys[id];
            if (typeof accel !== 'string' || !accel) {
                log('maid: ' + id + ' has no key bound, so it is left alone');
                return;
            }
            let took;
            try {
                took = layer.register(accel, bindings[id]);
            } catch (error) {
                log('maid: could not put ' + id + ' on ' + accel + ': ' + message(error));
                return;
            }
            if (took === false) {
                log('maid: ' + accel + ' is already taken, so ' + id + ' is not bound app-wide');
                return;
            }
            registered.push({ id: id, accel: accel, layer: layer });
        });
        onLayer = want;
        return { ok: true, layer: want, registered: registered.length };
    }

    return {
        bindings: bindings,
        apply: apply,
        uninstall: release,
        layer: function () { return onLayer; },
        registered: function () { return registered.slice(); }
    };
}

/**
 * The window as the plugin uses it: the scheduler over the plugin's game access, the party half
 * over the platform tap, the two keys on the app's shortcut layers, and the autoload applied at
 * activation the way the reference's form applies it in its own constructor.
 */
function createFromHost(host, deps) {
    deps = deps || {};
    const bridge = deps.game || require('./game-access.js').createMaidGameAccess(host);
    const log = function (line) { host.log(line); };
    const words = (typeof host.getLocaleStrings === 'function' &&
        host.getLocaleStrings('maidMessages')) || {};

    // The scheduler is made first, but its `config` reads the window's live state, which is why
    // the window is built before the scheduler runs anything: the arrow closes over `window`.
    let window = null;
    const maid = deps.maid || maidModel.createMaid({
        game: bridge,
        config: function () { return window ? window.config() : {}; },
        log: log,
        engineActivity: deps.engineActivity,
        engineRunning: deps.engineRunning,
        send: function (frame) { return bridge.sendServerFrame(frame); },
        onTick: deps.onTick
    });
    const party = deps.party === null ? null : (deps.party || partyModel.createParty({
        game: bridge,
        send: function (frame) { return bridge.sendServerFrame(frame); },
        state: function () { return maid.state(); },
        setState: function (patch) {
            if (patch.target !== undefined) maid.setTarget(patch.target);
            if (patch.enabled !== undefined) {
                maid.setEnabled(patch.enabled === true);
                if (patch.enabled === true) maid.start();
            }
        },
        log: log
    }));

    let watchers = [];
    let release = null;
    function broadcast(payload) {
        watchers.slice().forEach(function (watcher) {
            if (watcher.isDestroyed && watcher.isDestroyed()) return;
            try {
                watcher.send('plugin:' + host.pluginId + ':maidState', payload);
            } catch (error) {
                log('maid: could not write to a window (' + message(error) + ')');
            }
        });
    }

    window = deps.window || createMaidWindow({
        host: host,
        appDataDirectory: host.appDataDirectory,
        maid: maid,
        party: party,
        game: bridge,
        messages: words,
        dialogs: deps.dialogs || createDialogs({ electron: deps.electron, messages: words }),
        log: log
    });

    /**
     * The party half's one subscription. Nothing is subscribed at activation, which is this app's
     * own rule for a tap (test/unit/packet-logger.test.js: opening or activating subscribes
     * nothing); the Maid reads party chat while a window is looking or while it is running, which
     * is the same shape the drop list uses, plus the running half because the reference answers
     * party commands whether or not anybody has its form in front of them.
     */
    function followTap() {
        const want = party !== null && (watchers.length > 0 || maid.running());
        if (want && !release) {
            release = host.packets.on('frame', function (frame) {
                try {
                    party.handleFrame(frame);
                } catch (error) {
                    log('maid: a party frame could not be read: ' + message(error));
                }
            });
        } else if (!want && release) {
            release();
            release = null;
        }
        return !!release;
    }

    const defaults = require('../../keybinds.js').DEFAULTS;
    const keys = deps.keys || createKeys({
        maid: maid,
        log: log,
        localShortcuts: deps.localShortcuts,
        globalShortcuts: deps.globalShortcuts,
        // The user's own rebindings win over the plugin's defaults: the platform merges them into
        // what it hands a plugin (`host.getPlatformSettings()`), the way the Hotkeys window reads
        // them, so a key the user changed in Settings is the key that fires here too.
        accelerators: deps.accelerators || function () {
            let merged = {};
            try {
                merged = (typeof host.getPlatformSettings === 'function' && host.getPlatformSettings()) || {};
            } catch (error) {
                merged = {};
            }
            const out = {};
            Object.keys(defaults).forEach(function (id) {
                out[id] = typeof merged[id] === 'string' && merged[id] ? merged[id] : defaults[id];
            });
            return out;
        }
    });

    // The Global Hotkey box decides which layer the two keys sit on, and flipping it moves them.
    window.onConfigChange(function (patch, state) {
        if (patch && patch.config && Object.prototype.hasOwnProperty.call(patch.config, 'GlobalHotkey')) {
            keys.apply(state.GlobalHotkey === true);
        }
    });
    // Enable starts the loop and the tap together; the scheduler's own stop ends both.
    window.onConfigChange(function () { followTap(); });
    // The reference's own state is shown and it changes on its own: the loop repaints its form for
    // the same reason, and a key pressed in another window has to move this one's boxes too. The
    // same pass is what lets the tap follow the Maid's running flag.
    if (typeof maid.setOnTick === 'function') {
        maid.setOnTick(function () {
            broadcast(window.view());
            followTap();
        });
    }

    return {
        window: window,
        maid: maid,
        party: party,
        keys: keys,
        attach: function () {
            window.attach();
            host.ipc.handle('maidWatch', function (event) {
                const sender = event && event.sender;
                if (sender && watchers.indexOf(sender) === -1) {
                    watchers.push(sender);
                    if (typeof sender.once === 'function') {
                        sender.once('destroyed', function () { unwatch(sender); });
                    }
                }
                followTap();
                return window.view();
            });
            // The autoload the reference applies in its own window's constructor.
            window.autoload();
            keys.apply(window.config().GlobalHotkey === true);
            followTap();
            return this;
        },
        /** A window that went away is not a reason to keep reading traffic. */
        unwatch: function (watcher) {
            const at = watchers.indexOf(watcher);
            if (at !== -1) watchers.splice(at, 1);
            followTap();
        },
        /** Whether the party half is reading the tap right now. */
        following: function () { return !!release; },
        followTap: followTap,
        broadcast: broadcast,
        /** One frame off the platform tap, for the party half. */
        handleFrame: function (frame) { return party ? party.handleFrame(frame) : null; }
    };
}

module.exports = {
    createMaidWindow: createMaidWindow,
    createFromHost: createFromHost,
    createDialogs: createDialogs,
    createKeys: createKeys,
    configDirectory: configDirectory,
    CHANNELS: CHANNELS,
    PLAYERNAME_PATH: PLAYERNAME_PATH
};
