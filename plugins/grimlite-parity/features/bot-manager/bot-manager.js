// The Bot Manager window's main-process half (#36). The page (bot-manager-renderer.js) draws the
// reference's eleven tabs and its six lists; everything the page cannot do lives here: the sheet
// it draws from, the catalog, the parsed document - a user's file, so the platform's own dialogs
// and this plugin's store decide where it comes from and goes - and the folder tree.
//
// The document is the parsed file, mutated in place (bot/bots.js). Nothing here rebuilds it, so a
// save writes back exactly the keys the file had: a key absent because it equalled its default
// must not reappear, which is the whole point of holding the parsed object rather than a model.
const path = require('path');

const bots = require('../../bot/bots.js');
const catalog = require('../../bot/command-catalog.js');
const editorModel = require('../../bot/editor.js');
const tabs = require('../../bot/tabs.js');
const actions = require('../../bot/tab-actions.js');
const displaySettings = require('../../bot/display-settings.js');
const botTree = require('../../bot/bot-tree.js');
const gameReads = require('../../bot/game-reads.js');
const { createFromHost } = require('../../bot/bot-dialogs.js');

// UserFriendlyCommandEditor.Show's skip list. Text is not in it: on an ordinary command Text is
// a member the author edits (CmdLog, CmdBlank2, CmdClientMessage), and only on a statement row is
// it the row's label rather than something the form should offer (the reference's own comparison
// against the statement row's Text).
const FORM_SKIP = ['Tag', 'Description1', 'Description2', '$type'];

// The Bot Manager controls whose state is the window's rather than a Configuration member.
const SPECIAL_SETTINGS = ['InventOnStart', 'QuestDelay', 'AutoCorrect', 'AntiMod', 'AntiModStopBot',
    'AntiModLogout', 'WalkSpeedOn', 'SaveProgress', 'SaveProgressMinutes', 'GenderSwap', 'ToggleMute',
    'MapSpoofName', 'MapSpoofer'];

// The class an InventoryItem row carries in a .gbot (bots.js's LIST_TYPES names it for a list).
const INVENTORY_ITEM_TYPE = 'Grimoire.Game.Data.InventoryItem, Grimoire';
// Grimoire.Game.Data.InventoryItem's own JsonProperty names (InventoryItem.cs): the keys the
// reference's object serialises, so a boost keeps the shape the reference would have written.
const ITEM_KEYS = ['iEnh', 'iQty', 'sDesc', 'iStk', 'iLvl', 'bCoins', 'sLink', 'sFile', 'bEquip',
    'bUpg', 'bTemp', 'iCost', 'sType', 'ItemID', 'sName', 'ShopItemID', 'iRate'];

function createBotManager(deps) {
    deps = deps || {};
    const dialogs = deps.dialogs || createFromHost(deps.host, deps);
    // The engine, per window, injected: `run` is the per-window runtime (#37) and gives this
    // window its own bot with its own variables, ints and index. A window handed no runtime
    // refuses to start rather than pretending to, so the control is never a silent no-op.
    const runtime = deps.runtime || null;
    const options = deps.options || null;
    const windowKey = deps.windowKey || 'default';
    // Which window a request is for. One independent bot per game window (spec #19) means the
    // runtime is keyed by the window the caller is acting for, so `windowKeyFor` can derive it
    // from the IPC event; a build with a single window falls back to the fixed key.
    const windowKeyFor = deps.windowKeyFor || function () { return windowKey; };
    const fs = deps.fs || require('fs');
    const readText = deps.readText || function (file) { return fs.readFileSync(file, 'utf8'); };
    const clipboard = deps.clipboard || {
        // Electron is reached at call time: outside the app, require('electron') is the npm shim.
        write: function (value) { require('electron').clipboard.writeText(String(value)); },
        read: function () { return require('electron').clipboard.readText(); }
    };
    // The settings instance, injected: the plugin shell also builds one (the engine's CmdLoadBot
    // resolves a relative path against the same bots directory), and two instances would each
    // cache their own copy of the store - so a directory the user picked in this window would not
    // reach the running bot until the app restarted. A caller that passes nothing gets its own,
    // which is what a test and a single-window build want.
    const settings = deps.settings || displaySettings.create({
        store: deps.store,
        defaultBotsDirectory: deps.defaultBotsDirectory || ''
    });

    let botDocument = {};
    let editor = editorModel.create(botDocument);
    let currentPath = null;
    let loaded = false;
    let optionsWatchers = [];
    // The Bot Manager's own editor-only controls. None of these is a Configuration member, so
    // they live here rather than in the document: a save must not add keys a .gbot never had.
    const ui = {
        inventOnStart: true,
        questDelay: 1000,
        autoCorrect: true,
        saveProgress: false,
        saveProgressMinutes: 60,
        antiMod: true,
        antiModStopBot: true,
        antiModLogout: true
    };
    let saveTimer = null;
    let antiModRelease = null;
    let spoofRelease = null;
    let realArea = null;

    function optionsRunning() {
        try {
            return !!(options && options.state && options.state().applying === true);
        } catch (error) {
            return false;
        }
    }

    function optionsWalkSpeed() {
        try {
            return !!(options && options.state && options.state().walkSpeedOn === true);
        } catch (error) {
            return false;
        }
    }

    function watchOptionsWindow(event) {
        const sender = event && event.sender;
        if (sender && optionsWatchers.indexOf(sender) === -1) optionsWatchers.push(sender);
    }

    function optionsStateChanged(running) {
        const channel = 'plugin:' + ((deps.host && deps.host.pluginId) || 'grimlite-parity') +
            ':botManagerOptionsState';
        optionsWatchers = optionsWatchers.filter(function (sender) {
            if (sender.isDestroyed && sender.isDestroyed()) return false;
            try {
                sender.send(channel, running === true);
                return true;
            } catch (error) {
                return false;
            }
        });
    }

    /** The editor-only values the engine reads: none of them is written into a .gbot. */
    function editorOptions() {
        return ui;
    }

    function currentKey() {
        return typeof deps.currentWindowKey === 'function' ? deps.currentWindowKey() : windowKeyFor(null);
    }

    function logDebug(line) {
        if (typeof deps.logDebug === 'function') deps.logDebug(line);
    }

    /** One tap frame's text, whichever shape the relay hands it in. */
    function frameText(data) {
        if (typeof data === 'string') return data;
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf8');
        if (data === null || data === undefined) return '';
        return String(data);
    }

    function jsonFrame(data) {
        const text = frameText(data).trim();
        if (text.charAt(0) !== '{') return null;
        try {
            return JSON.parse(text);
        } catch (error) {
            return null;
        }
    }

    const STAFF_COLOURS = { 30: 'Dark Green', 40: 'Light Green', 50: 'Purple', 60: 'Yellow', 100: 'Dark Green' };

    /** AntiMODHandler: any access level at or above 30 is staff. */
    function staffFound(username, accessLevel) {
        const level = Number(accessLevel);
        const name = String(username === undefined || username === null ? '' : username);
        if (!name || !isFinite(level) || level < 30) return;
        const colour = STAFF_COLOURS[level] || 'Unknown';
        const line = '==> [STAFF  | ' + level + '/' + colour + ' | ' + name + '] <==';
        const strip = new Array(line.length + 1).join('-');
        logDebug(strip + '\n ' + line + ' \n' + strip);
        // modAction(): the two boxes decide what seeing a staff member does.
        if (ui.antiModStopBot && runtime) {
            try {
                Promise.resolve(runtime.stop(currentKey())).then(syncAntiMod, function () {});
            } catch (error) {
                logDebug('could not stop the bot: ' + ((error && error.message) || error));
            }
        }
        if (ui.antiModLogout) {
            callLoader('Logout').catch(function (error) {
                logDebug('could not log out: ' + ((error && error.message) || error));
            });
        }
    }

    function observeAntiMod(frame) {
        if (!ui.antiMod || !botRunning(currentKey())) return;
        const packet = jsonFrame(frame && frame.data);
        if (!packet || !packet.params || packet.params.type !== 'json') return;
        const data = packet.params.dataObj;
        if (!data) return;
        if (data.cmd === 'initUserDatas') {
            const rows = data.a && (Array.isArray(data.a) ? data.a : data.a.$values);
            (Array.isArray(rows) ? rows : []).forEach(function (row) {
                const player = row && row.data ? row.data : row;
                if (player) staffFound(player.strUsername, player.intAccessLevel);
            });
        } else if (data.cmd === 'uotls' && data.unm) {
            callLoader('GetAccessLevel', [data.unm]).then(function (level) {
                staffFound(data.unm, level);
            }).catch(function () {});
        }
    }

    /** Anti-mod listens only while this window's bot runs, as toggleAntiMod does. */
    function syncAntiMod() {
        const on = ui.antiMod && botRunning(currentKey());
        if (on && !antiModRelease && deps.packets && typeof deps.packets.on === 'function') {
            antiModRelease = deps.packets.on('frame', observeAntiMod);
        } else if (!on && antiModRelease) {
            antiModRelease();
            antiModRelease = null;
        }
    }

    function syncSaveProgress() {
        if (saveTimer && typeof saveTimer !== 'number') {
            try { saveTimer.unref(); } catch (error) { /* a browser timer has no unref */ }
        }
        if (saveTimer) {
            (deps.clearInterval || clearInterval)(saveTimer);
            saveTimer = null;
        }
        if (!ui.saveProgress) return;
        const minutes = isFinite(ui.saveProgressMinutes) && ui.saveProgressMinutes > 0
            ? ui.saveProgressMinutes : 60;
        saveTimer = (deps.setInterval || setInterval)(function () {
            callLoader('IsLoggedIn').then(function (signed) {
                if (signed !== true) return null;
                return callLoader('Logout');
            }).then(function (done) {
                if (done === null) return;
                logDebug('[' + new Date().toTimeString().slice(0, 8) + '] Progress saved.');
            }).catch(function (error) {
                logDebug('Progress save failed: ' + ((error && error.message) || error));
            });
        }, minutes * 60000);
        if (saveTimer && typeof saveTimer !== 'number' && typeof saveTimer.unref === 'function') {
            saveTimer.unref();
        }
    }

    /** chkGender_CheckedChanged: both directions of the tick send a swap. */
    function genderSwap() {
        return Promise.all([callLoader('UserID'), callLoader('Gender')]).then(function (answers) {
            const gender = String(answers[1] || '').toUpperCase() === 'M' ? 'F' : 'M';
            const packet = JSON.stringify({
                t: 'xt',
                b: { r: -1, o: {
                    cmd: 'genderSwap', bitSuccess: 1, gender: gender, intCoins: 0,
                    uid: String(answers[0]), strHairFileName: '', HairID: '', strHairName: ''
                } }
            });
            return callChannel('sendClientPacket', [packet, 'xt']);
        }).then(function (answer) {
            return answer && answer.ok ? { ok: true } : { ok: false, error: (answer && answer.error) || 'the game did not answer' };
        });
    }

    /** World.spoofMap: write world.strAreaName, then ask the game to redraw the area name. */
    function observeArea(frame) {
        if (!ui.mapSpoofing) return;
        const packet = jsonFrame(frame && frame.data);
        const data = packet && packet.params && packet.params.dataObj;
        // Flash.ProcessPext keeps realmap current from every moveToArea frame.
        if (data && data.cmd === 'moveToArea' && data.areaName) realArea = String(data.areaName);
    }

    function setMapSpoofer(on, name) {
        ui.mapSpoofing = on;
        ui.mapSpoofName = String(name === undefined || name === null ? (ui.mapSpoofName || 'ThisIsCool') : name);
        if (on) {
            if (!spoofRelease && deps.packets && typeof deps.packets.on === 'function') {
                spoofRelease = deps.packets.on('frame', observeArea);
            }
            return callChannel('getGameObject', ['world.strAreaName']).then(function (area) {
                realArea = area.ok && area.value !== undefined ? String(area.value) : null;
                return callChannel('setGameObject', ['world.strAreaName', ui.mapSpoofName]);
            }).then(function (written) {
                if (!written.ok) return written;
                return callChannel('callGameFunction0', ['updateAreaName']);
            });
        }
        if (spoofRelease) {
            spoofRelease();
            spoofRelease = null;
        }
        if (realArea === null) return Promise.resolve({ ok: true });
        return callChannel('setGameObject', ['world.strAreaName', realArea]).then(function (written) {
            if (!written.ok) return written;
            return callChannel('callGameFunction0', ['updateAreaName']);
        });
    }

    /** One special control's own action; the caller turns a refusal into the window's status. */
    function specialSetting(name, value) {
        switch (name) {
        case 'InventOnStart': ui.inventOnStart = value === true; return Promise.resolve({ ok: true });
        case 'QuestDelay': {
            const delay = Number(value);
            ui.questDelay = isFinite(delay) && delay > 0 ? delay : 1000;
            return Promise.resolve({ ok: true });
        }
        case 'AutoCorrect': ui.autoCorrect = value === true; return Promise.resolve({ ok: true });
        case 'AntiMod':
        case 'AntiModStopBot':
        case 'AntiModLogout':
            ui[name.charAt(0).toLowerCase() + name.slice(1)] = value === true;
            syncAntiMod();
            return Promise.resolve({ ok: true });
        case 'WalkSpeedOn':
            if (!options || typeof options.setToggle !== 'function') {
                return Promise.resolve({ ok: false, error: 'the Options loop is not wired in this build' });
            }
            return Promise.resolve(value && value.value !== undefined && typeof options.setWalkSpeed === 'function'
                ? options.setWalkSpeed(Number(value.value))
                : null).then(function () {
                return options.setToggle('walkSpeed', value === true || (value && value.on === true));
            });
        case 'SaveProgress':
            ui.saveProgress = value === true;
            syncSaveProgress();
            return Promise.resolve({ ok: true });
        case 'SaveProgressMinutes': {
            const minutes = Number(value);
            ui.saveProgressMinutes = isFinite(minutes) && minutes > 0 ? minutes : 60;
            syncSaveProgress();
            return Promise.resolve({ ok: true });
        }
        case 'GenderSwap': return genderSwap();
        case 'ToggleMute':
            // Player.ToggleMute(!checked): ticking "Toggle Mute" mutes the chat box.
            return callLoader('MuteToggle', [value !== true]).then(function () {
                return { ok: true };
            });
        case 'MapSpoofName':
            ui.mapSpoofName = String(value === undefined || value === null ? '' : value);
            return Promise.resolve({ ok: true });
        case 'MapSpoofer':
            return setMapSpoofer(value && value.on === true, value && value.name);
        default:
            return Promise.resolve({ ok: false, error: 'no such editor control: ' + name });
        }
    }

    function enableOptions(enabled, event) {
        watchOptionsWindow(event);
        if (!options || typeof options.setApplying !== 'function') {
            return Promise.resolve(view({ error: 'the Options loop is not wired in this build' }));
        }
        let answer;
        try {
            answer = options.setApplying(enabled === true);
        } catch (error) {
            return Promise.resolve(view({ error: (error && error.message) || String(error) }));
        }
        return Promise.resolve(answer).then(function (result) {
            const running = optionsRunning();
            return view({ optionsRunning: running, error: result && result.ok === false ? result.error : null });
        }, function (error) {
            return view({ optionsRunning: optionsRunning(), error: (error && error.message) || String(error) });
        });
    }

    function resetDocument(bot, file) {
        botDocument = bot;
        editor = editorModel.create(botDocument);
        currentPath = file || null;
        loaded = true;
    }

    /**
     * chkEnableBot_CheckedChanged, in this port's words. The reference refuses on an empty list
     * and on nobody signed in, and `ActiveBotEngine`'s setter refuses while one is already
     * running; all three are the engine's own refusals, so this asks it and reports what it said.
     *
     * `enabled` is the tickbox's own start-vs-stop switch: Start() when it turns on, Stop() when
     * it turns off. Nothing is remembered across a failed start - a refused tick is un-ticked, as
     * the reference un-ticks it.
     */
    function enableBot(enabled, event) {
        const key = windowKeyFor(event);
        if (!runtime) {
            return Promise.resolve(view({
                enabled: false,
                error: 'no bot engine is wired in this build (#37)'
            }));
        }
        if (enabled === false) {
            return Promise.resolve(runtime.stop(key)).then(function () {
                // The reference's stop unticks its live zone handler when one is selected.
                if (botDocument.AutoZone) specialZone(botDocument.AutoZone, false);
                syncAntiMod();
                return view({ enabled: false, error: null });
            });
        }
        return Promise.resolve(runtime.start(key, botDocument, editorOptions())).then(function (result) {
            if (!result || result.ok !== true) {
                // A refused start leaves the tick off; the reason is what the window shows.
                return view({ enabled: false, error: (result && result.error) || 'the bot did not start' });
            }
            // chkEnableBot_CheckedChanged unticks Hide players once anti-mod is running.
            if (ui.antiMod) editor.setSetting('HidePlayers', false);
            syncAntiMod();
            // chkEnableBot_CheckedChanged: with a zone selected the start switches the live
            // handler on (`if (cmbSpecials.SelectedIndex != -1 && !chkSpecial.Checked)
            // chkSpecial.Checked = true`). A build without the panel is told, not shown a tick.
            const zone = botDocument.AutoZone ? specialZone(botDocument.AutoZone, true) : null;
            return view({ enabled: true, error: null,
                zoneError: zone && zone.ok !== true ? zone.error : null });
        }, function (error) {
            return view({ enabled: false, error: (error && error.message) || String(error) });
        });
    }

    /** The customiser's own values, plus the metrics a list row is drawn with (BotManager_Load). */
    function style() {
        const metrics = settings.itemMetrics();
        return {
            colours: settings.colours(),
            centered: settings.centeredFlags(),
            commandsSize: settings.commandsSize(),
            itemHeight: metrics.itemHeight,
            fontSize: metrics.fontSize,
            font: settings.fontFamily(),
            customisable: settings.customisableNames()
        };
    }

    /** Everything the page redraws from: counters, the six labels, every list and the values. */
    function view(extra) {
        const counters = editor.counters();
        const configuration = bots.configuration(botDocument);
        const lists = {};
        editor.keys().forEach(function (key) {
            const items = Array.isArray(botDocument[key]) ? botDocument[key] : [];
            lists[key] = items.map(function (item) {
                const className = catalog.classNameOf(item);
                return {
                    text: catalog.rowText(item),
                    // lstCommands_DrawItem prints the row's [n] unless its class is one of the
                    // LabelLess ones (and never for a statement).
                    showsIndex: catalog.showsIndex(item),
                    // A row's colour is keyed by its class without the Cmd (CommandColorForm names
                    // it that way); a row that is not a command takes the variable colour, which
                    // is the segment colour the reference's draw handler uses for its values.
                    colour: settings.colour(className || 'Variable'),
                    centered: className ? settings.centered(className) : false
                };
            });
        });
        return Object.assign({
            path: currentPath,
            selected: editor.selected,
            selection: editor.selection,
            counters: counters,
            // treeBots_AfterSelect's six labels: the command one is two lines there.
            labels: {
                commands: 'Number of\nCommands: ' + counters.Commands,
                skills: 'Skills: ' + counters.Skills,
                quests: 'Quests: ' + counters.Quests,
                drops: 'Drops: ' + counters.Drops,
                boosts: 'Boosts: ' + counters.Boosts,
                items: 'Items: ' + counters.Items
            },
            lists: lists,
            labelsList: editor.labels(),
            style: style(),
            configuration: configuration,
            optionsRunning: optionsRunning(),
            optionsWalkSpeed: optionsWalkSpeed(),
            description: bots.description(botDocument),
            author: configuration.Author === null || configuration.Author === undefined ? '' : configuration.Author,
            merge: settings.ui('Merge') === true
        }, extra || {});
    }

    /** Load bot / a dropped file / a tree selection: parse, then ApplyConfiguration. */
    function loadFile(file, key) {
        let text;
        try {
            text = readText(file);
        } catch (error) {
            return { error: error.message || String(error) };
        }
        const parsed = bots.parseBot(text);
        if (!parsed.ok) return { error: parsed.error };
        apply(parsed.bot, file, key);
        return null;
    }

    /**
     * ApplyConfiguration: chkMerge appends and anything else replaces - and a merge while a bot is
     * running replaces too (the reference's own `!chkMerge.Checked || ActiveBotEngine.IsRunning`,
     * which clears the lists either way). The configuration the file carries reaches the form in
     * both modes: the boxes take the loaded file's values even when the lists were appended to.
     */
    function apply(bot, file, key) {
        const merge = loaded && settings.ui('Merge') === true && !botRunning(key);
        if (merge) {
            editor.applyConfiguration(bot, { merge: true });
            applyConfigurationValues(bot);
            applyNotifyUponDrop(bot);
            currentPath = file || currentPath;
            return;
        }
        resetDocument(bot, file);
        editor.applyConfiguration(botDocument, { merge: false });
    }

    /** Is the bot that belongs to this window's game window running? */
    function botRunning(key) {
        if (!runtime) return false;
        try {
            return runtime.state(key === undefined ? windowKey : key).running === true;
        } catch (error) {
            return false;
        }
    }

    /**
     * The configuration keys this window's own controls carry (the tickboxes and spinners of
     * tab-actions' two maps, which is exactly what ApplyConfiguration moves onto the form).
     */
    const CONFIGURATION_KEYS = (function () {
        const keys = [];
        [actions.SETTINGS, actions.NUMBERS].forEach(function (map) {
            Object.keys(map).forEach(function (id) {
                if (keys.indexOf(map[id]) === -1) keys.push(map[id]);
            });
        });
        return keys;
    })();

    /** ApplyConfiguration's own assignments, in the document the merge is appending to. */
    function applyConfigurationValues(bot) {
        const config = bots.configuration(bot);
        CONFIGURATION_KEYS.forEach(function (key) {
            if (config[key] === undefined) return;
            // numWalkSpeed.Value = (config.WalkSpeed <= 0) ? 8 : config.WalkSpeed.
            const value = key === 'WalkSpeed' && !(config.WalkSpeed > 0) ? 8 : config[key];
            editor.setSetting(key, value);
            // numOptionsTimer_ValueChanged: loading a bot moves the loop's own delay too.
            if (key === 'optionDelay' && options && typeof options.setTimer === 'function') {
                options.setTimer(Number(value));
            }
            if (key === 'respawnProvoke' && options && typeof options.setRespawnProvoke === 'function') {
                options.setRespawnProvoke(value === true);
            }
        });
    }

    /** ApplyConfiguration appends NotifyUponDrop to lstSoundItems when it merges. */
    function applyNotifyUponDrop(bot) {
        const incoming = Array.isArray(bot.NotifyUponDrop) ? bot.NotifyUponDrop : [];
        const own = Array.isArray(botDocument.NotifyUponDrop) ? botDocument.NotifyUponDrop : [];
        if (incoming.length) botDocument.NotifyUponDrop = own.concat(incoming);
    }

    function statements() {
        return catalog.STATEMENTS.map(function (row) {
            return {
                className: row.className, tag: row.tag, text: row.text,
                description1: row.description1, description2: row.description2
            };
        });
    }

    /** UserFriendlyCommandEditor.Show: one labelled box per key, in the command's own key order. */
    function form(index) {
        const command = editor.items()[index];
        if (!command) return { fields: [] };
        const className = catalog.classNameOf(command);
        const row = catalog.STATEMENTS.filter(function (s) { return s.className === className; })[0];
        const fields = [];
        Object.keys(command).forEach(function (key) {
            if (FORM_SKIP.indexOf(key) !== -1) return;
            // A statement's Text is its own dropdown label, so the form leaves it alone.
            if (key === 'Text' && row) return;
            let text = key;
            let value = command[key];
            // The shipped catalog leaves some descriptions out, and where it does the label ends
            // up empty (the reference assigns the description straight onto the DarkLabel, and a
            // null description is no text). A box holding exactly the description is the form's
            // own placeholder: it opens empty (tbText == lblText ? "" : tbText).
            if (key === 'Value1' && row) {
                text = row.description1 || '';
                if (value !== undefined && String(value) === text) value = '';
            }
            if (key === 'Value2' && row) {
                text = row.description2 || '';
                if (value !== undefined && String(value) === text) value = '';
            }
            if (key === 'Quest') {
                text = 'Quest ID';
                value = command.Quest ? command.Quest.QuestID : '';
            }
            fields.push({
                key: key, label: text,
                // The box's own type, which is what the OK has to write back as.
                type: typeof command[key] === 'boolean' ? 'bool'
                    : (typeof command[key] === 'number' ? 'number' : 'text'),
                value: value === undefined || value === null ? '' : String(value)
            });
        });
        // The raw editor opens on the command's own JSON - RawCommandEditor.Show(content), where
        // content is JsonConvert.SerializeObject(obj, Formatting.Indented).
        return { fields: fields, className: className, json: JSON.stringify(command, null, 2) };
    }

    /** The form's OK: patch the keys it showed and leave every other key where it was. */
    function edit(index, values) {
        const command = editor.items()[index];
        if (!command) return view({ refused: true });
        Object.keys(values || {}).forEach(function (key) {
            // The reference writes the Quest row's id back into the row it came from.
            if (key === 'Quest') {
                if (command.Quest) {
                    const id = Number(values[key]);
                    if (isFinite(id)) command.Quest.QuestID = id;
                }
                return;
            }
            if (!(key in command)) return;
            const typed = fromField(command[key], values[key]);
            if (typed !== undefined) command[key] = typed;
        });
        return view({ refused: false });
    }

    /**
     * UserFriendlyCommandEditor.Show deserialises the boxes back into the command's own typed
     * members (JsonConvert.DeserializeObject(text, obj.GetType())), so a bool box writes a bool:
     * "false" stays false rather than the string. A text its own type cannot parse is a failed
     * deserialisation there - and there the field is left as it was.
     */
    function fromField(current, value) {
        const raw = value === undefined || value === null ? '' : String(value).trim();
        if (typeof current === 'boolean') {
            if (raw.toLowerCase() === 'true') return true;
            if (raw.toLowerCase() === 'false') return false;
            return undefined;
        }
        if (typeof current === 'number') {
            const parsed = Number(raw);
            return isFinite(parsed) ? parsed : undefined;
        }
        return value === undefined || value === null ? '' : value;
    }

    function loadDialog(key) {
        return Promise.resolve(dialogs.open(null)).then(function (result) {
            if (!result || result.canceled) return { canceled: true };
            if (result.error) return view({ canceled: false, error: result.error });
            apply(result.bot, result.path, key);
            currentPath = result.path;
            return view({ canceled: false, error: null });
        });
    }

    /**
     * GenerateConfiguration writes `(Server)cbServers.SelectedItem`, so a bot's Server member is
     * an object with the server's name in it. Writing a bare string there would be a shape the
     * reference's own deserialiser refuses, so the name is wrapped (and dropped when empty).
     */
    function setServer(name) {
        const text = name === undefined || name === null ? '' : String(name);
        if (!text) {
            delete botDocument.Server;
            return;
        }
        botDocument.Server = { $type: 'Grimoire.Game.Data.Server, Grimoire', Name: text };
    }

    /**
     * chkSpecial_CheckedChanged: the box toggles the live auto-zone handler through
     * UpdateSpecialHandler, which lives with the handlers themselves (features/maid/zones.js).
     * The shell hands that panel in the way the engine receives it; a build without one says so.
     */
    function specialZone(zone, enabled) {
        const panel = typeof deps.specialHandler === 'function' ? deps.specialHandler() : null;
        if (!panel || typeof panel.set !== 'function') {
            return { ok: false, error: 'this window has no live zone handler wired (ticket #44)' };
        }
        const name = zone === undefined || zone === null ? '' : String(zone);
        if (!name) return { ok: false, error: 'choose a zone first' };
        try {
            return { ok: true, value: panel.set(name, enabled === true) };
        } catch (error) {
            return { ok: false, error: (error && error.message) || String(error) };
        }
    }

    function save(options) {
        const where = options || {};
        // A save that already knows its file (the tab's Save bot, a tree load) writes back to it;
        // the header's Save and Ctrl+S ask, because the reference's own Ctrl+S always asks.
        if (where.path && where.ask !== true) {
            try {
                fs.mkdirSync(path.dirname(where.path), { recursive: true });
                fs.writeFileSync(where.path, bots.serializeBot(botDocument, { eol: eolOf(where.path) }));
                currentPath = where.path;
                return Promise.resolve(view({ canceled: false, path: where.path, error: null }));
            } catch (error) {
                // btnSave_Click's own words: "Unable to save bot: " + ex.Message.
                return Promise.resolve(view({ canceled: false, path: null,
                    error: 'Unable to save bot: ' + (error.message || String(error)) }));
            }
        }
        return Promise.resolve(dialogs.save(null, botDocument, { path: where.path || currentPath }))
            .then(function (result) {
                if (!result || result.canceled) return { canceled: true };
                if (result.error) {
                    return view({ canceled: false, path: null, error: 'Unable to save bot: ' + result.error });
                }
                currentPath = result.path;
                return view({ canceled: false, path: result.path, error: null });
            });
    }

    /** The line ending the file came in with: both are in the reference's own corpus. */
    function eolOf(file) {
        try {
            return readText(file).indexOf('\r\n') !== -1 ? '\r\n' : '\n';
        } catch (error) {
            return '\n';
        }
    }

    /** treeBots: the chosen directory, its subtree count, and one level of nodes. */
    function tree(segments, directory) {
        // txtSaved is the tree's root (UpdateTree reads the box); the chosen directory stands in
        // for it when the box has not been typed into.
        const root = directory || settings.botsDirectory() || deps.defaultBotsDirectory || '';
        const wanted = Array.isArray(segments) ? segments : [];
        return {
            directory: root,
            count: botTree.count(root),
            // A folder expands one level; the root lists the same way, with no parent node.
            nodes: wanted.length ? botTree.list(botTree.resolve(root, wanted)) : botTree.roots(root),
            path: wanted
        };
    }

    function chooseDirectory() {
        if (typeof deps.showOpenDialog !== 'function') return Promise.resolve(tree([]));
        return Promise.resolve(deps.showOpenDialog(null, {
            title: message('chooseDirectoryTitle', 'Choose your bots directory'),
            defaultPath: settings.botsDirectory() || deps.defaultBotsDirectory || '',
            properties: ['openDirectory', 'createDirectory']
        })).then(function (result) {
            if (result && !result.canceled && result.filePaths && result.filePaths.length) {
                settings.setBotsDirectory(result.filePaths[0]);
            }
            return tree([]);
        });
    }

    function message(key, fallback) {
        const strings = (typeof deps.message === 'function' ? deps.message() : deps.message) || {};
        return strings[key] || fallback;
    }

    function add(id, values, modifiers) {
        const built = actions.build(id, values, modifiers);
        // btnAddCmdHunt refuses a hunt with no item, exactly as its handler returns early.
        if (!built) return view({ refused: true });
        // A builder may contribute more than one command (btnSkillCmd's alt branch adds the four
        // skills), so the answer is read as a list either way.
        const commands = Array.isArray(built) ? built : [built];
        commands.forEach(function (command) {
            editor.add(command, { insert: !!(modifiers && modifiers.ctrl) });
        });
        // The other lists the same press writes (btnKillF's whitelist).
        fillLists(actions.buildLists(id, values, modifiers));
        return view({ refused: false });
    }

    /**
     * Put the groups a builder returns into their lists. AddDrop / AddItem / AddQuest guard with
     * Contains (OrdinalIgnoreCase, the reference's own comparison); AddSkill does not, which is
     * why the builder says which groups are unique rather than this loop assuming it.
     */
    function fillLists(groups) {
        const back = editor.selected;
        groups.forEach(function (group) {
            editor.selected = group.list;
            const list = editor.items();
            group.items.forEach(function (item) {
                const duplicate = group.unique && list.some(function (existing) {
                    return group.insensitive
                        ? String(existing).toLowerCase() === String(item).toLowerCase()
                        : existing === item;
                });
                if (duplicate) return;
                list.push(item);
            });
        });
        editor.selected = back;
    }

    function addList(id, values, modifiers) {
        const groups = actions.buildList(id, values, modifiers);
        if (!groups.length) return view({ refused: true });
        fillLists(groups);
        return view({ refused: false });
    }

    function key(action, options) {
        switch (action) {
        case 'moveUp': editor.move(-1); break;
        case 'moveDown': editor.move(1); break;
        case 'duplicate': editor.duplicate(); break;
        case 'remove': editor.remove(); break;
        case 'clear': editor.clear({ all: options.all === true }); break;
        case 'copyAsText': return Object.assign({ clipboard: editor.copyAsText() }, view());
        case 'copyJson': return Object.assign({ clipboard: editor.copyJson() }, view());
        // Ctrl+X: the same configuration text as Ctrl+C, then the selection goes.
        case 'cut': {
            const clipboard = editor.copyJson();
            editor.remove();
            return Object.assign({ clipboard: clipboard }, view());
        }
        case 'paste': editor.pasteJson(String(options.text == null ? '' : options.text)); break;
        case 'find': return Object.assign({ hit: editor.find(options.text) }, view());
        case 'label': return labelKey(options);
        default:
            throw new Error('[AquGrim:grimlite-parity] unknown bot manager key "' + action + '"');
        }
        return view();
    }

    /** lbLabels_DoubleClick: ctrl jumps to the label's command, plain fills the label box. */
    function labelKey(options) {
        const wanted = String(options.text == null ? '' : options.text);
        if (options.ctrl !== true) return Object.assign({ label: wanted.replace(/^\[|\]$/g, '') }, view());
        const commands = Array.isArray(botDocument.Commands) ? botDocument.Commands : [];
        const hit = commands.findIndex(function (command) {
            return catalog.display(command).indexOf(wanted) !== -1;
        });
        editor.selected = 'Commands';
        if (hit !== -1) editor.selection = [hit];
        return Object.assign({ hit: hit === -1 ? null : hit }, view());
    }

    function styleAction(options) {
        switch (options.action) {
        case 'colour': settings.setColour(options.name, options.value); break;
        case 'centered': settings.setCentered(options.name, options.value); break;
        case 'size': settings.setCommandsSize(options.value); break;
        case 'font': settings.setFont(options.value); break;
        case 'random': settings.randomColours(options.r, options.g, options.b); break;
        case 'reload': settings.reload(); break;
        case 'read': break;
        default:
            throw new Error('[AquGrim:grimlite-parity] unknown bot manager style action "' + options.action + '"');
        }
        return view();
    }

    function drop(files, key) {
        // lstCommands_DragDrop returns without doing anything for more than one file.
        if (!Array.isArray(files) || files.length !== 1) return view({ refused: true });
        const failure = loadFile(files[0], key);
        return view(Object.assign({ refused: false, canceled: false }, failure || { error: null }));
    }

    /**
     * The bridge hands back a JSON string (AquaBridge.toJson). A member the game does not have
     * arrives as {"error": "no member ..."} on a call that itself succeeded - which is exactly the
     * answer that must not be mistaken for an empty value, so it is checked first.
     */
    function parseValue(raw, name) {
        const parsed = decodeValue(raw).parsed;
        const failure = memberError(parsed);
        if (failure) return { error: failure };
        if (parsed === null || parsed === undefined) {
            // The path exists and is empty: the game has not logged in or drawn it yet. Saying so
            // keeps an empty box from looking like a real reading.
            return { error: 'the game reports no ' + name + ' yet (no character in the world?)' };
        }
        return { value: parsed };
    }

    /** Read the named dot-paths through the generic surface, one call each, first failure wins. */
    function readGame(names) {
        const bridge = deps.bridge;
        if (!bridge) return Promise.resolve({ ok: false, error: 'this window has no game bridge' });
        return Promise.resolve(bridge.attach()).then(function (attached) {
            if (!attached || attached.ok !== true) {
                return { ok: false, error: (attached && attached.error) || 'the game bridge is not attached' };
            }
            const values = {};
            return names.reduce(function (chain, name) {
                return chain.then(function (state) {
                    if (!state.ok) return state;
                    return Promise.resolve(bridge.call('getGameObject', [gameReads.READS[name]]))
                        .then(function (result) {
                            if (!result || result.ok !== true) {
                                return { ok: false, error: (result && result.error) ||
                                    ('the bridge did not answer ' + name) };
                            }
                            const read = parseValue(result.value, name);
                            if (read.error) return { ok: false, error: read.error };
                            state.values[name] = read.value;
                            return state;
                        });
                });
            }, Promise.resolve({ ok: true, values: values })).then(function (state) {
                return state.ok ? { ok: true, values: state.values } : state;
            });
        });
    }

    /**
     * A control that acts on the game. A reachable one reads through the generic surface; the
     * rest report the helper they wait for, so a press is never a silent no-op.
     */
    function gameAction(id, modifiers) {
        // btnGetMapF_Click: the ctrl branch appends the literal "-[room]" and the alt branch also
        // appends the current cells; both transforms happen before the page fills the boxes.
        if (id === 'btnGetMapF') {
            return readGame(['map', 'cell', 'pad']).then(function (result) {
                if (!result.ok) return result;
                const mods = modifiers || {};
                const fields = mods.fields || {};
                if (mods.alt === true || mods.ctrl === true) {
                    result.values.map = String(result.values.map) + '-[room]';
                }
                if (mods.alt === true) {
                    result.values.cell = String(fields.tbCellF || '') + ',' + result.values.cell;
                    result.values.pad = String(fields.tbPadF || '') + ',' + result.values.pad;
                }
                return result;
            });
        }
        if (GAME_ACTIONS[id]) {
            let answer;
            try {
                answer = GAME_ACTIONS[id]((modifiers && modifiers.fields) || {});
            } catch (error) {
                return Promise.resolve({ ok: false, error: (error && error.message) || String(error) });
            }
            return Promise.resolve(answer).catch(function (error) {
                return { ok: false, error: (error && error.message) || String(error) };
            });
        }
        const spec = gameReads.GAME_BUTTONS[id];
        if (!spec) return Promise.resolve({ ok: false, error: 'not a game control: ' + id });
        const variant = gameReads.variantOf(spec, modifiers);
        if (variant && (variant.needs || variant.why)) {
            return Promise.resolve({ ok: false, error: gameReads.why(variant, id) });
        }
        if (!spec.reads) return Promise.resolve({ ok: false, error: gameReads.why(spec, id) });
        return readGame(spec.reads);
    }

    /**
     * The three controls game-reads.js does not own, each with its reference body:
     *
     *   btnMapItemExe  Player.GetMapItem((int)numMapItem.Value) - loader-surface.js's own route
     *                  for GetMapItem, which is world.getMapItem(id)
     *   btnGetInfo     UserFriendlyCommandEditor's "Get Cell / Map / Pad" helper: Player.Cell,
     *                  Player.Map and Player.Pad, three dot-path reads (game-reads.READS)
     *   cbBoosts       cbBoosts_Click: the bag's ServerUse rows, through the same path the loader
     *                  surface's GetInventoryItems reads (world.myAvatar.items)
     */
    const GAME_ACTIONS = {
        btnMapItemExe: function (fields) {
            const id = Number(fields.numMapItem);
            // The spinner's own minimum is 1; a box with nothing usable in it is refused.
            if (!isFinite(id) || id <= 0) {
                return Promise.resolve({ ok: false, error: 'give the map item an id first' });
            }
            return callChannel('callGameFunction', ['world.getMapItem', id]).then(function (answer) {
                return answer.ok
                    ? { ok: true }
                    : { ok: false, error: answer.error };
            });
        },
        btnGetInfo: function () { return readGame(['cell', 'map', 'pad']); },
        cbBoosts: function () { return readServerUse(); },

        // These loader helpers were already implemented by the bridge after game-reads.js was
        // written. Route them through the same loader surface instead of refusing them.
        btnWalkCur: function () {
            return callLoader('Position').then(function (position) {
                return { ok: true, values: { x: position && position[0], y: position && position[1] } };
            });
        },
        btnCellSwap: function (fields) {
            return Promise.all([callLoader('Map'), callLoader('RoomNumber')]).then(function (answers) {
                return {
                    ok: true,
                    values: {
                        join: String(answers[0] || '') + '-' + String(answers[1] || ''),
                        cell: fields.txtCell,
                        pad: fields.txtPad
                    }
                };
            });
        },
        btnSetSpawn2: function () {
            return callLoader('SetSpawnPoint').then(function () {
                return Promise.all([callLoader('Cell'), callLoader('Pad')]);
            }).then(function (where) {
                // btnSetSpawn2_Click's own confirmation, sent to the client as %xt%server%.
                return callChannel('sendClientPacket', [
                    '%xt%server%-1%Spawnpoint set: ' + where[0] + ', ' + where[1] + '%', 'str'
                ]);
            }).then(function (answer) {
                return answer.ok ? { ok: true } : { ok: false, error: answer.error };
            });
        },
        btnReloadMap: function () {
            return callLoader('ReloadMap').then(function () {
                return { ok: true };
            });
        },
        btnHideLoading: function () {
            return callLoader('HideConnMC').then(function () { return { ok: true }; });
        },
        btnSetFPS: function (fields) {
            const fps = Number(fields.numSetFPS);
            if (!isFinite(fps) || fps <= 0) return Promise.resolve({ ok: false, error: 'give the FPS box a number first' });
            return callLoader('SetFPS', [fps]).then(function () { return { ok: true }; });
        },
        btnchangeName: function (fields) {
            return callLoader('ChangeName', [String(fields.txtUsername || '')]).then(function () {
                return { ok: true };
            });
        },
        btnchangeGuild: function (fields) {
            return callLoader('ChangeGuild', [String(fields.txtGuild || '')]).then(function () {
                return { ok: true };
            });
        },
        btnSetLevel: function (fields) {
            const level = String(fields.tbLevel === undefined ? '' : fields.tbLevel).trim();
            if (!/^[0-9]+$/.test(level)) return { ok: false, error: 'type a level number first' };
            const packet = '{"t":"xt","b":{"r":-1,"o":{"cmd":"levelUp","intExpToLevel":"2000","intLevel":' + level + '}}}';
            return callChannel('sendClientPacket', [packet, 'xt']).then(function (answer) {
                return answer.ok ? { ok: true }
                    : { ok: false, error: answer.error };
            });
        },

        // btnQAddToWhitelist_Click: load the quest, then add its rewards and/or requirements to
        // Drops. The quest row is the loader's GetQuestTree row, the same one the item commands use.
        btnQAddToWhitelist: async function (fields) {
            const id = Number(fields.numQQuestId);
            const game = deps.game;
            if (!isFinite(id) || id <= 0) return { ok: false, error: 'give the quest an id first' };
            if (!game || typeof game.loadQuest !== 'function') {
                return { ok: false, error: 'this window has no quest access' };
            }
            try {
                await game.loadQuest(id);
            } catch (error) {
                return { ok: false, error: (error && error.message) || String(error) };
            }
            let row = null;
            for (let tries = 0; tries < 20 && !row; tries++) {
                row = await game.quest(id).catch(function () { return null; });
                if (!row) await new Promise(function (resolve) { setTimeout(resolve, 200); });
            }
            if (!row) return { ok: false, error: 'quest #' + id + ' did not load' };
            const names = [];
            function collect(list) {
                (Array.isArray(list) ? list : []).forEach(function (item) {
                    const name = item && (item.sName === undefined ? item.Name : item.sName);
                    if (name) names.push(String(name));
                });
            }
            if (fields.chkQRewards) collect(row.rewards || row.Rewards);
            if (fields.chkQRequirements) collect(row.reqd || row.RequiredItems);
            if (!names.length) {
                return { ok: false, error: 'the quest has no rewards or requirements to add' };
            }
            fillLists([{ list: 'Drops', items: names, unique: true, insensitive: true }]);
            return { ok: true, message: 'added ' + names.length + ' quest item/items to Drops', state: view() };
        },

        // btnLoadMap_Click: World.LoadMap(tbLoadMap.Text), when a .swf name was typed.
        btnLoadMap: function (fields) {
            const map = String(fields.tbLoadMap || '').trim();
            if (!/\.swf$/i.test(map) || /\(\.swf\)/.test(map)) {
                return Promise.resolve({ ok: false, error: 'type a .swf map name first' });
            }
            return callChannel('callGameFunction', ['world.loadMap', map]).then(function (answer) {
                return answer.ok ? { ok: true, message: 'loading ' + map }
                    : { ok: false, error: answer.error };
            });
        },

        // Player.ChangeAccessLevel: the loader's own visible fields. Filters are live objects the
        // generic bridge cannot carry; colour and upgrade/access fields are enough to show the
        // change in the client and are what the reference writes beside them.
        btnSetMem: function () { return setAccess('Member'); },
        btnSetNonMem: function () { return setAccess('Non Member'); },
        btnSetModerator: function () { return setAccess('Moderator'); },

        // The four alignment buttons are the reference's own updateQuest frames.
        btnSetGood: function () { return sendServerFrame('%xt%zm%updateQuest%218701%41%1%'); },
        btnSetEvil: function () { return sendServerFrame('%xt%zm%updateQuest%218701%41%2%'); },
        btnSetChaos: function () { return sendServerFrame('%xt%zm%updateQuest%218701%41%3%'); },
        btnSetUndecided: function () { return sendServerFrame('%xt%zm%updateQuest%218701%41%5%'); }
    };

    /** The field bindings for the action rows above; the page's read-fill path uses these. */
    const ACTION_ROWS = {
        btnWalkCur: { plain: { numWalkX: 'x', numWalkY: 'y' } },
        btnCellSwap: { plain: { txtJoin: 'join', txtJoinCell: 'cell', txtJoinPad: 'pad' } }
    };

    function callLoader(name, args) {
        if (typeof deps.loaderCall !== 'function') {
            return Promise.reject(new Error('this window has no loader surface'));
        }
        return Promise.resolve(deps.loaderCall(name, args || []));
    }

    function setAccess(level) {
        const colour = level === 'Member' ? 9229823 : level === 'Moderator' ? 16698168 : 16777215;
        const writes = [
            ['world.myAvatar.pMC.pname.ti.textColor', colour]
        ];
        if (level === 'Member') writes.push(['world.myAvatar.objData.iUpgDays', 30],
            ['world.myAvatar.objData.iUpg', 1]);
        else if (level === 'Non Member') writes.push(['world.myAvatar.objData.iUpgDays', -1],
            ['world.myAvatar.objData.iUpg', 0]);
        else writes.push(['world.myAvatar.objData.intAccessLevel', 60]);
        return writes.reduce(function (chain, pair) {
            return chain.then(function (state) {
                if (!state.ok) return state;
                return callChannel('setGameObject', pair).then(function (answer) {
                    return answer.ok ? state : { ok: false, error: answer.error };
                });
            });
        }, Promise.resolve({ ok: true })).then(function (state) {
            return state.ok ? { ok: true, message: 'access level set to ' + level } : state;
        });
    }

    function sendServerFrame(text) {
        if (typeof deps.sendFrame !== 'function') {
            return { ok: false, error: 'this window has no packet relay' };
        }
        const sent = deps.sendFrame({ direction: 'toServer', text: text });
        return sent ? { ok: true, message: 'sent ' + text }
            : { ok: false, error: 'the client is not connected to the relay' };
    }

    /** A read's own value, with a member error kept apart from a value JSON cannot carry. */
    function decodeValue(raw) {
        try {
            return { parsed: JSON.parse(String(raw)) };
        } catch (error) {
            // A value JSON cannot express; the bridge stringifies those, so take it as it came.
            return { parsed: raw };
        }
    }

    function memberError(parsed) {
        if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') return parsed.error;
        return null;
    }

    /** One generic bridge call, as {ok} or {ok:false,error} - a void call has no value to read. */
    function callChannel(name, args) {
        const bridge = deps.bridge;
        if (!bridge) return Promise.resolve({ ok: false, error: 'this window has no game bridge' });
        return Promise.resolve(bridge.attach()).then(function (attached) {
            if (!attached || attached.ok !== true) {
                return { ok: false, error: (attached && attached.error) || 'the game bridge is not attached' };
            }
            return Promise.resolve(bridge.call(name, args)).then(function (result) {
                if (!result || result.ok !== true) {
                    return { ok: false, error: (result && result.error) || ('the bridge did not answer ' + name) };
                }
                const decoded = decodeValue(result.value);
                const failure = memberError(decoded.parsed);
                if (failure) return { ok: false, error: failure };
                return { ok: true, value: decoded.parsed };
            });
        });
    }

    /**
     * cbBoosts_Click: Player.Inventory.Items.Where(i => i.Category == "ServerUse"). Category is
     * the sType member, and the row keeps the reference class's own JSON keys, so what the button
     * then adds to Boosts is the item the game sent rather than a name alone.
     */
    function readServerUse() {
        return callChannel('getGameObject', ['world.myAvatar.items']).then(function (answer) {
            if (!answer.ok) return answer;
            const rows = Array.isArray(answer.value) ? answer.value : [];
            const boosts = rows.filter(function (row) {
                return row && (row.sType === 'ServerUse' || row.Category === 'ServerUse');
            }).map(function (row) {
                const item = { $type: INVENTORY_ITEM_TYPE };
                ITEM_KEYS.forEach(function (key) {
                    if (row[key] !== undefined) item[key] = row[key];
                });
                const name = item.sName === undefined || item.sName === null ? '' : String(item.sName);
                return {
                    name: name || (item.ItemID === undefined ? '' : String(item.ItemID)),
                    item: item
                };
            });
            return { ok: true, boosts: boosts };
        });
    }

    /**
     * btnSoundTest_Click: five Console.Beep()s - the notification test for the drop-sound list.
     * Electron's own alert sound is the equivalent; there is no game involved, so it does not go
     * through the bridge.
     */
    function beep(count) {
        const times = count === undefined ? 5 : count;
        const shell = deps.shell || require('electron').shell;
        for (let i = 0; i < times; i++) shell.beep();
        return { ok: true };
    }

    function treeSelect(segments, ctrl, directory, key) {
        const root = directory || settings.botsDirectory() || deps.defaultBotsDirectory || '';
        const file = botTree.resolve(root, Array.isArray(segments) ? segments : []);
        if (!botTree.isBot(file)) return view({ refused: true });
        if (ctrl) {
            // The ctrl-click branch: a CmdLoadBot for the file, at the selection, and no load.
            const reference = botTree.loadCommand(root, file);
            editor.add(catalog.makeCommand('CmdLoadBot', reference), { insert: true });
            return view({ refused: false, inserted: reference });
        }
        const failure = loadFile(file, key);
        return view(Object.assign({ refused: false }, failure || { error: null }));
    }

    function addFolder(name, directory) {
        const root = directory || settings.botsDirectory() || deps.defaultBotsDirectory || '';
        const made = botTree.addFolder(root, name);
        return Object.assign(tree([], root), made
            ? { error: null }
            : { error: message('addFolderFailed', 'That folder could not be added.') });
    }

    const feature = {
        /** The parsed document's own editor, which is what the window's tests drive. */
        editor: function () { return editor; },
        // The document the window is editing, for the other features that write into a bot's own
        // lists (the grabbers' Add to both / whitelist / unbank and Add to quest list, #31). A
        // getter, because loading a bot replaces the document rather than editing it in place.
        bot: function () { return botDocument; },
        store: function () { return deps.store; },
        settings: settings,

        handle: function (channel, event, args) {
            const argv = args || [];
            switch (channel) {
            case 'botManagerSheet':
                watchOptionsWindow(event);
                return {
                    tabs: tabs.TABS,
                    column: tabs.COLUMN,
                    placeholders: actions.PLACEHOLDER,
                    tags: catalog.STATEMENT_TAGS,
                    statements: statements(),
                    customisable: settings.customisableNames(),
                    // The ids that decide where a press goes: the reference's own handler wiring,
                    // so the page never has to spell a control's behaviour out itself.
                    commandButtons: Object.keys(actions.COMMAND_BUTTONS),
                    listButtons: Object.keys(actions.LIST_BUTTONS),
                    // The ids that act on the running game, and the reasons the ones that cannot
                    // are waiting. The page draws them either way; none is a dead button. The
                    // three this window serves itself (GAME_ACTIONS) travel with them.
                    gameButtons: gameReads.ids().concat(Object.keys(GAME_ACTIONS)),
                    // The reachable controls' own field branches, so the page fills the boxes the
                    // reference fills rather than guessing at them.
                    gameRows: Object.assign(gameReads.ids().reduce(function (out, id) {
                        const spec = gameReads.GAME_BUTTONS[id];
                        if (spec.reads) {
                            out[id] = {};
                            ['plain', 'alt', 'ctrl'].forEach(function (branch) {
                                if (spec[branch]) out[id][branch] = spec[branch];
                            });
                        }
                        return out;
                    }, {}), ACTION_ROWS),
                    settings: actions.SETTINGS,
                    numbers: actions.NUMBERS,
                    optionsRunning: optionsRunning()
                };
            case 'botManagerStatements':
                return { tags: catalog.STATEMENT_TAGS, statements: statements() };
            case 'botManagerMessages':
                return message('all', {}) || {};
            case 'botManagerLoad':
                if (argv[0]) {
                    const failure = loadFile(argv[0], windowKeyFor(event));
                    return view(Object.assign({ canceled: false }, failure || { error: null }));
                }
                return loadDialog(windowKeyFor(event));
            case 'botManagerPickBot':
                // btnLoadCmd_Click: the dialog chooses a bot to embed as a CmdLoadBot; it does
                // not load that bot into this window.
                return Promise.resolve(dialogs.open(null, { title: 'Select bot to load' })).then(function (result) {
                    if (!result || result.canceled || !result.path) return { canceled: true };
                    const root = settings.botsDirectory() || deps.defaultBotsDirectory || '';
                    const made = botTree.loadCommand(root, result.path);
                    return {
                        canceled: false, path: result.path,
                        fileName: made.BotFileName, filePath: made.BotFilePath
                    };
                });
            case 'botManagerSave':
                return save(argv[0]);
            case 'botManagerAdd':
                return add(argv[0], argv[1], argv[2]);
            case 'botManagerAddList':
                return addList(argv[0], argv[1], argv[2]);
            case 'botManagerSelect':
                editor.selected = argv[0];
                if (argv[1]) editor.selection = argv[1];
                return view();
            case 'botManagerKey':
                return key(argv[0], argv[1] || {});
            case 'botManagerForm':
                return form(argv[0]);
            case 'botManagerEdit':
                return edit(argv[0], argv[1]);
            case 'botManagerRaw': {
                const result = editor.replaceFromJson(argv[0], argv[1]);
                return Object.assign({ ok: result.ok, error: result.error }, view());
            }
            case 'botManagerSetting':
                // chkMerge is a control of this window, not a member of a bot: the reference
                // keeps it in the form and reads it when a configuration is applied.
                if (argv[0] === 'Merge') settings.setUi('Merge', argv[1] === true);
                // The server combo holds a Server object in Configuration, not its name.
                else if (argv[0] === 'Server') setServer(argv[1]);
                else if (argv[0] === 'optionDelay') {
                    editor.setSetting('optionDelay', Number(argv[1]));
                    if (options && typeof options.setTimer === 'function') options.setTimer(Number(argv[1]));
                }
                else if (argv[0] === 'respawnProvoke') {
                    editor.setSetting('respawnProvoke', argv[1] === true);
                    if (options && typeof options.setRespawnProvoke === 'function') {
                        options.setRespawnProvoke(argv[1] === true);
                    }
                }
                else if (SPECIAL_SETTINGS.indexOf(argv[0]) !== -1) {
                    return specialSetting(argv[0], argv[1]).then(function (answer) {
                        return view({ error: answer && answer.ok === false ? answer.error : null });
                    }, function (error) {
                        return view({ error: (error && error.message) || String(error) });
                    });
                } else editor.setSetting(argv[0], argv[1]);
                return view();
            case 'botManagerOptionsEnable':
                return enableOptions(argv[0], event);
            case 'botManagerEnable':
                return enableBot(argv[0], event);
            case 'botManagerState':
                watchOptionsWindow(event);
                syncAntiMod();
                return (function () {
                    if (!runtime) return view({ bot: null, enabled: false });
                    const state = runtime.state(windowKeyFor(event));
                    return view({ bot: state, enabled: state.running });
                })();
            case 'botManagerStyle':
                return styleAction(argv[0] || {});
            case 'botManagerTree':
                return tree(argv[0], argv[1]);
            case 'botManagerChooseDirectory':
                return chooseDirectory();
            case 'botManagerAddFolder':
                return addFolder(argv[0], argv[1]);
            case 'botManagerTreeSelect':
                return treeSelect(argv[0], argv[1] === true, argv[2], windowKeyFor(event));
            case 'botManagerGame':
                return gameAction(argv[0], argv[1]);
            // chkSpecial_CheckedChanged: the live zone handler, which belongs to the Maid
            // window's panel (ticket #44). The shell hands that panel in the same way the engine
            // receives it; a build without one is told so rather than shown a silent tick.
            case 'botManagerSpecial':
                return specialZone(argv[0], argv[1] === true);
            case 'botManagerBeep':
                return beep();
            case 'botManagerDrop':
                return drop(argv[0] || [], windowKeyFor(event));
            case 'botManagerCopy':
                clipboard.write(String(argv[0] == null ? '' : argv[0]));
                return true;
            case 'botManagerPaste':
                return String(clipboard.read() == null ? '' : clipboard.read());
            case 'botManagerOpenLink': {
                const target = String(argv[0] == null ? '' : argv[0]);
                let parsed;
                try {
                    parsed = new URL(target);
                } catch (error) {
                    return { ok: false, error: 'not a link: ' + target };
                }
                if (['http:', 'https:', 'mailto:'].indexOf(parsed.protocol) === -1) {
                    return { ok: false, error: 'this link cannot be opened: ' + target };
                }
                const shell = deps.shell || require('electron').shell;
                return Promise.resolve(shell.openExternal(target)).then(function () {
                    return { ok: true };
                }, function (error) {
                    return { ok: false, error: (error && error.message) || String(error) };
                });
            }
            default:
                throw new Error('[AquGrim:grimlite-parity] unknown bot manager channel "' + channel + '"');
            }
        },

        register: function (host) {
            const channels = ['botManagerSheet', 'botManagerStatements', 'botManagerMessages',
                'botManagerLoad', 'botManagerSave', 'botManagerAdd', 'botManagerAddList',
                'botManagerSelect', 'botManagerKey', 'botManagerForm', 'botManagerEdit',
                'botManagerRaw', 'botManagerSetting', 'botManagerOptionsEnable', 'botManagerStyle', 'botManagerTree',
                'botManagerChooseDirectory', 'botManagerAddFolder', 'botManagerTreeSelect',
                'botManagerDrop', 'botManagerCopy', 'botManagerPaste', 'botManagerGame',
                'botManagerBeep', 'botManagerEnable', 'botManagerState', 'botManagerSpecial',
                'botManagerOpenLink', 'botManagerPickBot'];
            channels.forEach(function (channel) {
                host.ipc.handle(channel, function (event) {
                    const rest = Array.prototype.slice.call(arguments, 1);
                    return feature.handle(channel, event, rest);
                });
            });
        },
        optionsStateChanged: optionsStateChanged,
        /** Chrome's Start Bot drives the same engine; this keeps anti-mod's watch in step. */
        engineStateChanged: function () { syncAntiMod(); },
        /** The editor-only values a second Start path (the chrome strip) must hand the engine. */
        editorOptions: editorOptions
    };

    return feature;
}

module.exports = {
    createBotManager: createBotManager,
    FORM_SKIP: FORM_SKIP
};
