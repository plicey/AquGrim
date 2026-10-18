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
const { createFromHost } = require('../../bot/bot-dialogs.js');

// UserFriendlyCommandEditor.Show's skip list. A statement's own Text is skipped too (the
// reference compares the key against the statement row's Text), because on a statement it is the
// row's label rather than something the author edits.
const FORM_SKIP = ['Tag', 'Description1', 'Description2', '$type', 'Text'];

function createBotManager(deps) {
    deps = deps || {};
    const dialogs = deps.dialogs || createFromHost(deps.host, deps);
    const fs = deps.fs || require('fs');
    const readText = deps.readText || function (file) { return fs.readFileSync(file, 'utf8'); };
    const clipboard = deps.clipboard || {
        // Electron is reached at call time: outside the app, require('electron') is the npm shim.
        write: function (value) { require('electron').clipboard.writeText(String(value)); },
        read: function () { return require('electron').clipboard.readText(); }
    };
    const settings = displaySettings.create({
        store: deps.store,
        defaultBotsDirectory: deps.defaultBotsDirectory || ''
    });

    let botDocument = {};
    let editor = editorModel.create(botDocument);
    let currentPath = null;
    let loaded = false;

    function resetDocument(bot, file) {
        botDocument = bot;
        editor = editorModel.create(botDocument);
        currentPath = file || null;
        loaded = true;
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
            description: bots.description(botDocument),
            author: configuration.Author === null || configuration.Author === undefined ? '' : configuration.Author,
            merge: settings.ui('Merge') === true
        }, extra || {});
    }

    /** Load bot / a dropped file / a tree selection: parse, then ApplyConfiguration. */
    function loadFile(file) {
        let text;
        try {
            text = readText(file);
        } catch (error) {
            return { error: error.message || String(error) };
        }
        const parsed = bots.parseBot(text);
        if (!parsed.ok) return { error: parsed.error };
        apply(parsed.bot, file);
        return null;
    }

    /** ApplyConfiguration: chkMerge appends, otherwise every list is replaced. */
    function apply(bot, file) {
        if (loaded && settings.ui('Merge') === true) {
            editor.applyConfiguration(bot, { merge: true });
            currentPath = file || currentPath;
            return;
        }
        resetDocument(bot, file);
        editor.applyConfiguration(botDocument, { merge: false });
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
            let text = key;
            let value = command[key];
            // The shipped catalog leaves some descriptions out; where it does, the reference's
            // own label ends up empty (Value2) or falls back to the key (Value1).
            if (key === 'Value1' && row) text = row.description1 || key;
            if (key === 'Value2' && row) text = row.description2 || '';
            if (key === 'Quest') {
                text = 'Quest ID';
                value = command.Quest ? command.Quest.QuestID : '';
            }
            fields.push({
                key: key, label: text,
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
                if (command.Quest) command.Quest.QuestID = Number(values[key]);
                return;
            }
            command[key] = values[key];
        });
        return view({ refused: false });
    }

    function loadDialog() {
        return Promise.resolve(dialogs.open(null)).then(function (result) {
            if (!result || result.canceled) return { canceled: true };
            if (result.error) return view({ canceled: false, error: result.error });
            apply(result.bot, result.path);
            currentPath = result.path;
            return view({ canceled: false, error: null });
        });
    }

    function save(options) {
        const where = options || {};
        if (!loaded) return Promise.resolve({ canceled: true });
        // A save that already knows its file (the tab's Save bot, a tree load) writes back to it;
        // the header's Save and Ctrl+S ask, because the reference's own Ctrl+S always asks.
        if (where.path && where.ask !== true) {
            try {
                fs.mkdirSync(path.dirname(where.path), { recursive: true });
                fs.writeFileSync(where.path, bots.serializeBot(botDocument, { eol: eolOf(where.path) }));
                currentPath = where.path;
                return Promise.resolve(view({ canceled: false, path: where.path, error: null }));
            } catch (error) {
                return Promise.resolve(view({ canceled: false, path: null, error: error.message || String(error) }));
            }
        }
        return Promise.resolve(dialogs.save(null, botDocument, { path: where.path || currentPath }))
            .then(function (result) {
                if (!result || result.canceled) return { canceled: true };
                if (result.error) return view({ canceled: false, path: null, error: result.error });
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
    function tree(segments) {
        const root = settings.botsDirectory() || deps.defaultBotsDirectory || '';
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
        const command = actions.build(id, values, modifiers);
        // btnAddCmdHunt refuses a hunt with no item, exactly as its handler returns early.
        if (!command) return view({ refused: true });
        editor.add(command, { insert: !!(modifiers && modifiers.ctrl) });
        return view({ refused: false });
    }

    function addList(id, values, modifiers) {
        const groups = actions.buildList(id, values, modifiers);
        if (!groups.length) return view({ refused: true });
        // AddDrop / AddItem / AddQuest guard with Contains; AddSkill does not, which is why the
        // builder says which ones are unique rather than this loop assuming it.
        const back = editor.selected;
        groups.forEach(function (group) {
            editor.selected = group.list;
            const list = editor.items();
            group.items.forEach(function (item) {
                if (group.unique && list.indexOf(item) !== -1) return;
                list.push(item);
            });
        });
        editor.selected = back;
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
        case 'paste': editor.pasteJson(String(options.text == null ? '' : options.text)); break;
        case 'find': return Object.assign({ hit: editor.find(options.text) }, view());
        case 'label': return labelKey(options);
        default:
            throw new Error('[AquaStar:grimlite-parity] unknown bot manager key "' + action + '"');
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
        case 'read': break;
        default:
            throw new Error('[AquaStar:grimlite-parity] unknown bot manager style action "' + options.action + '"');
        }
        return view();
    }

    function drop(files) {
        // lstCommands_DragDrop returns without doing anything for more than one file.
        if (!Array.isArray(files) || files.length !== 1) return view({ refused: true });
        const failure = loadFile(files[0]);
        return view(Object.assign({ refused: false, canceled: false }, failure || { error: null }));
    }

    function treeSelect(segments, ctrl) {
        const root = settings.botsDirectory() || deps.defaultBotsDirectory || '';
        const file = botTree.resolve(root, Array.isArray(segments) ? segments : []);
        if (!botTree.isBot(file)) return view({ refused: true });
        if (ctrl) {
            // The ctrl-click branch: a CmdLoadBot for the file, at the selection, and no load.
            const reference = botTree.loadCommand(root, file);
            editor.add(catalog.makeCommand('CmdLoadBot', reference), { insert: true });
            return view({ refused: false, inserted: reference });
        }
        const failure = loadFile(file);
        return view(Object.assign({ refused: false }, failure || { error: null }));
    }

    function addFolder(name) {
        const root = settings.botsDirectory() || deps.defaultBotsDirectory || '';
        const made = botTree.addFolder(root, name);
        return Object.assign(tree([]), made
            ? { error: null }
            : { error: message('addFolderFailed', 'That folder could not be added.') });
    }

    const feature = {
        /** The parsed document's own editor, which is what the window's tests drive. */
        editor: function () { return editor; },
        store: function () { return deps.store; },
        settings: settings,

        handle: function (channel, event, args) {
            void event;
            const argv = args || [];
            switch (channel) {
            case 'botManagerSheet':
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
                    settings: actions.SETTINGS,
                    numbers: actions.NUMBERS
                };
            case 'botManagerStatements':
                return { tags: catalog.STATEMENT_TAGS, statements: statements() };
            case 'botManagerMessages':
                return message('all', {}) || {};
            case 'botManagerLoad':
                if (argv[0]) {
                    const failure = loadFile(argv[0]);
                    return view(Object.assign({ canceled: false }, failure || { error: null }));
                }
                return loadDialog();
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
                else editor.setSetting(argv[0], argv[1]);
                return view();
            case 'botManagerStyle':
                return styleAction(argv[0] || {});
            case 'botManagerTree':
                return tree(argv[0]);
            case 'botManagerChooseDirectory':
                return chooseDirectory();
            case 'botManagerAddFolder':
                return addFolder(argv[0]);
            case 'botManagerTreeSelect':
                return treeSelect(argv[0], argv[1] === true);
            case 'botManagerDrop':
                return drop(argv[0] || []);
            case 'botManagerCopy':
                clipboard.write(String(argv[0] == null ? '' : argv[0]));
                return true;
            case 'botManagerPaste':
                return String(clipboard.read() == null ? '' : clipboard.read());
            default:
                throw new Error('[AquaStar:grimlite-parity] unknown bot manager channel "' + channel + '"');
            }
        },

        register: function (host) {
            const channels = ['botManagerSheet', 'botManagerStatements', 'botManagerMessages',
                'botManagerLoad', 'botManagerSave', 'botManagerAdd', 'botManagerAddList',
                'botManagerSelect', 'botManagerKey', 'botManagerForm', 'botManagerEdit',
                'botManagerRaw', 'botManagerSetting', 'botManagerStyle', 'botManagerTree',
                'botManagerChooseDirectory', 'botManagerAddFolder', 'botManagerTreeSelect',
                'botManagerDrop', 'botManagerCopy', 'botManagerPaste'];
            channels.forEach(function (channel) {
                host.ipc.handle(channel, function (event) {
                    const rest = Array.prototype.slice.call(arguments, 1);
                    return feature.handle(channel, event, rest);
                });
            });
        }
    };

    return feature;
}

module.exports = {
    createBotManager: createBotManager,
    FORM_SKIP: FORM_SKIP
};
