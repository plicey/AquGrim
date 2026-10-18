// Loaders and grabbers (ticket #31). Reference: Grimlite-Li 816d9cd, Grimoire/UI/Loaders.cs
// (the window and its loaders) and Grimoire/Tools/Grabber.cs (the eight grabbers, their rows and
// their context menus). The row shapes and the menus are in grabbers.js; this file is the half
// that needs the game, the clipboard, the dialogs or a file.
//
// Every dependency is injected, so the whole window is testable without Flash, a dialog or a
// clipboard: game (features/loaders/game.js), openUrl (the app's browser window), clipboard,
// dialogs, writeText/readText and botLists.

const grabbers = require('./grabbers.js');
const xml = require('./xml.js');

const ERRORS = {
    noRows: 'Nothing has been grabbed yet, so there is nothing to save.',
    noLists: 'The bot lists live in the Bot Manager\'s own document, and no window here is ' +
        'holding one yet.'
};

// The reference's own save dialog (Loaders.cs btnSave_Click): an OpenFileDialog whose title is
// "Save grabber data" and whose filter is "XML files|*.xml".
const SAVE_TITLE = 'Save grabber data';
const FILTER = { name: 'XML files', extensions: ['xml'] };

/**
 * The bot lists, as the grabber's own actions use them. The reference writes into the Bot
 * Manager's four list boxes (BotManager.AddDrop / AddItem / AddQuest / AddCommand). No window in
 * this build is holding a bot document yet, so the default reports that in words rather than
 * claiming to have added a row nobody kept. When the Bot Manager's lists are reachable, an
 * object of this shape is what gets injected here.
 */
function createBotLists() {
    function unwired() {
        return { added: 0, wired: false, reason: ERRORS.noLists };
    }
    return {
        addDrops: unwired,
        addItems: unwired,
        addQuests: unwired,
        addCommands: unwired
    };
}

/** MenuItems' "Copy all" and MenuQuest's "Copy all Reqs" from the row contexts they carry. */
function namesQuantities(payload) {
    const names = Array.isArray(payload && payload.names) ? payload.names : [];
    const quantities = Array.isArray(payload && payload.quantities) ? payload.quantities : [];
    return { items: names.map(function (name, index) {
        return { name: name, quantity: quantities[index] };
    }) };
}

/** BotManager.AddDrop: the name, and nothing when the list already holds it. */
function text(name) {
    return String(name == null ? '' : name);
}

function createLoadersFeature(host, deps) {
    deps = deps || {};
    const game = deps.game;
    const openUrl = deps.openUrl || function () {};
    const clipboard = deps.clipboard || { writeText: function () {} };
    // The two dialogs are modal to the window that asked for them, so the owner window travels
    // with each call rather than being read from shared state.
    const dialogs = deps.dialogs || null;
    const writeText = deps.writeText || function (file, body) { require('fs').writeFileSync(file, body); };
    const readText = deps.readText || function (file) { return require('fs').readFileSync(file, 'utf8'); };
    const botLists = deps.botLists || createBotLists();
    const messages = deps.messages || {};

    // The rows the window is showing. Save writes this tree, not a fresh grab: the reference's
    // btnSave_Click writes treeGrabbed, which is whatever the user last grabbed.
    let rows = [];

    function failure(error) {
        return { ok: false, error: (error && error.message) || String(error) };
    }

    /** A row's menu payload needs the quest's own required items for its last two entries. */
    function rowsFor(target, orderBy) {
        const spec = grabbers.GRAB_TARGETS.filter(function (item) { return item.id === target; })[0];
        if (!spec) throw new Error('unknown grab target "' + target + '"');
        return game[spec.source]().then(function (payload) {
            return grabbers.buildRows(target, payload, { orderBy: orderBy });
        });
    }

    async function grab(target, orderBy) {
        try {
            rows = await rowsFor(target, orderBy);
            return { ok: true, rows: rows, target: target, orderBy: orderBy };
        } catch (error) {
            // A grab that failed leaves the last tree standing, as the reference's own empty
            // catch does, so a Save after a refused grab still writes what the user can see.
            return failure(error);
        }
    }

    // ------------------------------------------------------------------ the loaders

    /**
     * btnLoad_Click: the four targets, and for Quest either a comma list or one id expanded by
     * the count control. btnForceAccept_Click_1 is the same loop with F Accept, which loads the
     * batch and then accepts whatever the game does not already have in progress.
     */
    async function loadTarget(target, value, count, forceAccept, ghost) {
        const box = text(value).trim();
        if (target === 'armorCustomizer') {
            return game.loadArmorCustomizer();
        }
        if (target === 'quest') {
            // LoadQuests: a comma list goes through as it is, one id expands through numTQuests.
            const expanded = box.indexOf(',') !== -1
                ? grabbers.parseQuestList(box)
                : expand(Number(box), Number(count));
            if (!expanded) {
                // The reference refuses this silently; a window that did nothing looks broken.
                return { ok: false, error: 'That is not a quest id (or a comma separated list of ids).' };
            }
            if (!forceAccept) return game.loadQuests(expanded);

            const loaded = await game.loadQuests(expanded);
            if (!loaded.ok) return loaded;
            // acceptBatchAsync: wait 1000ms for the tree, then accept each not already in progress.
            await game.sleep(1000);
            const refused = [];
            for (let i = 0; i < expanded.length; i++) {
                let inProgress = false;
                try {
                    inProgress = await game.isInProgress(expanded[i]);
                } catch (error) {
                    refused.push('quest ' + expanded[i] + ': ' + ((error && error.message) || error));
                    continue;
                }
                if (inProgress) continue;
                const accepted = await game.acceptQuest(expanded[i], { ghost: ghost === true });
                if (!accepted.ok) refused.push((accepted.error || 'refused'));
                if (ghost !== true) await game.sleep(400);
            }
            if (refused.length) return { ok: false, error: refused.join('; ') };
            return { ok: true, via: loaded.via };
        }

        const id = Number(box);
        if (!box || !isFinite(id)) {
            return { ok: false, error: 'That is not a ' + target + ' id.' };
        }
        if (target === 'shop') return game.loadShop(id);
        if (target === 'hairShop') return game.loadHairShop(id);
        return { ok: false, error: 'unknown loader target "' + target + '"' };
    }

    /** btnLoad's own expansion of one id through the count control. */
    function expand(id, count) {
        if (!isFinite(id) || id <= 0) return null;
        const times = Number(count);
        if (!isFinite(times) || times < 1) return null;
        return grabbers.questList(id, times).split(',').map(function (part) {
            return parseInt(part, 10);
        });
    }

    // ------------------------------------------------------------------ the file half

    /**
     * btnSave_Click: the tree the window is showing, through the reference's own dialog. A
     * cancelled dialog writes nothing, and an empty tree is refused rather than written as an
     * empty document.
     */
    async function save(owner) {
        if (!rows.length) return { ok: false, error: messages.nothingToSave || ERRORS.noRows };
        if (!dialogs || typeof dialogs.save !== 'function') {
            return { ok: false, error: 'this window cannot open a save dialog here' };
        }
        const result = await dialogs.save({ title: SAVE_TITLE, filters: [FILTER] }, owner);
        if (!result || result.canceled) return { ok: false, canceled: true };
        const file = result.filePath;
        if (!file) return { ok: false, error: 'the save dialog gave no file name' };
        try {
            writeText(file, xml.toXml(rows));
        } catch (error) {
            return failure(error);
        }
        return { ok: true, path: file };
    }

    /** btnSave_Click's other half: a file this window wrote, loaded back into the tree. */
    async function open(owner) {
        if (!dialogs || typeof dialogs.open !== 'function') {
            return { ok: false, error: 'this window cannot open a file dialog here' };
        }
        const result = await dialogs.open({
            title: messages.openTitle || 'Load grabber data',
            filters: [FILTER],
            properties: ['openFile']
        }, owner);
        if (!result || result.canceled) return { ok: false, canceled: true };
        const file = (result.filePaths || [])[0];
        if (!file) return { ok: false, error: 'the dialog gave no file name' };
        let body;
        try {
            body = readText(file);
        } catch (error) {
            return failure(error);
        }
        try {
            rows = xml.fromXml(body);
        } catch (error) {
            return failure(error);
        }
        return { ok: true, rows: rows, path: file };
    }

    // ------------------------------------------------------------------ the row actions

    /**
     * The context menus' actions, one name per menu entry. Wiki links go through the app's own
     * browser window: the reference calls Process.Start, which hands them to whatever the
     * machine has as a default browser, and this app already has a window for a page.
     */
    async function act(action, payload) {
        const data = payload || {};
        const names = (Array.isArray(data.names) ? data.names : [data.name]).map(text)
            .filter(function (name) { return name.length; });
        switch (action) {
        case 'wikiPage':
            names.forEach(function (name) { openUrl(grabbers.wikiUrl(name), 'new-window'); });
            return { ok: true };
        case 'wikiSearch':
            names.forEach(function (name) { openUrl(grabbers.wikiSearchUrl(name), 'new-window'); });
            return { ok: true };
        case 'searchAllOnWiki':
            names.forEach(function (name) { openUrl(grabbers.wikiSearchUrl(name), 'new-window'); });
            return { ok: true };
        case 'copy':
            clipboard.writeText(text(data.text === undefined ? data.name : data.text));
            return { ok: true };
        case 'copyBypass':
            clipboard.writeText(grabbers.bypassPacket({ iValue: data.iValue, iSlot: data.iSlot }));
            return { ok: true };
        case 'copyAll':
            clipboard.writeText(grabbers.nameQuantityText(namesQuantities(data), false));
            return { ok: true };
        case 'copyAllReqs':
            clipboard.writeText(grabbers.nameQuantityText(namesQuantities(data), true));
            return { ok: true };
        case 'addToBoth':
            return addBoth(names);
        case 'addToWhitelist':
            return listResult(botLists.addDrops(names), names.length);
        case 'addToUnbank':
            return listResult(botLists.addItems(names), names.length);
        case 'addAllToBoth':
            return addBoth(names);
        case 'addAllToWhitelist':
            return listResult(botLists.addDrops(names), names.length);
        case 'addAllToUnbank':
            return listResult(botLists.addItems(names), names.length);
        case 'addQuest':
            return listResult(botLists.addQuests([questRow(data.id)]), 1);
        case 'addBuyCommand':
            return listResult(botLists.addCommands([buyCommand(data)]), 1);
        case 'equipSwf':
            return game.equipSwf(data.category, data.file, data.link);
        case 'buyNow':
            return game.buyItemQty(Number(data.itemId), Number(data.shopItemId), Number(data.qty) || 1);
        case 'loadShop':
            return game.loadShop(Number(data.id));
        case 'loadQuest':
            return game.loadQuest(Number(data.id));
        case 'acceptQuest':
            return game.acceptQuest(Number(data.id), { ghost: false });
        case 'completeQuest':
            return game.completeQuest(Number(data.id), {
                max: data.max === true,
                autoSelect: data.autoSelect === true
            });
        default:
            return { ok: false, error: 'unknown grabber action "' + action + '"' };
        }
    }

    /** AddDrop then AddItem, in that order - the reference's own "Add to both". */
    async function addBoth(names) {
        const drops = botLists.addDrops(names);
        if (drops && drops.wired === false) return listResult(drops, names.length);
        return listResult(botLists.addItems(names), names.length);
    }

    /**
     * A list action's own answer. A seam with no list behind it reports that in words instead of
     * claiming to have added a row nobody kept.
     */
    function listResult(result, wanted) {
        if (result && result.wired === false) {
            return { ok: false, error: ERRORS.noLists };
        }
        return { ok: true, added: (result && result.added) === undefined ? wanted : result.added };
    }

    /** BotManager.AddQuest's own row: {Id, ItemId, SafeRelogin, Text}. */
    function questRow(id) {
        return {
            $type: 'Grimoire.Game.Data.Quest, Grimoire',
            Id: Number(id),
            ItemId: null,
            SafeRelogin: false,
            Text: String(id)
        };
    }

    /** BotManager's CmdBuy, as the reference builds it from a shop row. */
    function buyCommand(data) {
        return {
            $type: 'Grimoire.Botting.Commands.Item.CmdBuy, Grimoire',
            ItemName: text(data.itemName),
            ItemId: Number(data.itemId),
            ShopId: Number(data.shopId),
            ShopItemId: Number(data.shopItemId),
            Qty: Number(data.qty) || 1
        };
    }

    function menuFor(kind, context) {
        return grabbers.menu(kind, context);
    }

    // ------------------------------------------------------------------ the window's channels

    function handle(channel, args, owner) {
        const argv = Array.isArray(args) ? args : [];
        switch (channel) {
        case 'loadersGrab':
            return grab(argv[1], argv[2]);
        case 'loadersLoad':
            return loadTarget(argv[1], argv[2], argv[3], argv[4], argv[5]);
        case 'loadersSave':
            return save(owner);
        case 'loadersOpen':
            return open(owner);
        case 'loadersMessages':
            return Promise.resolve(messages);
        case 'loadersSheets':
            return Promise.resolve({
                loadTargets: grabbers.LOAD_TARGETS,
                grabTargets: grabbers.GRAB_TARGETS,
                orderBy: grabbers.ORDER_BY,
                defaultLoadIndex: grabbers.LOAD_DEFAULT_INDEX
            });
        case 'loadersMenu':
            return Promise.resolve(menuFor(argv[1], argv[2]));
        case 'loadersAct':
            return act(argv[1], argv[2]);
        default:
            throw new Error('[AquaStar:grimlite-parity] unknown loaders channel "' + channel + '"');
        }
    }

    return {
        handle: handle,
        // Every channel this window uses, registered where the plugin registers them, so a
        // window only ever announces the IPC it actually has.
        attachTo: function (host) {
            ['loadersSheets', 'loadersMessages', 'loadersGrab', 'loadersLoad', 'loadersSave',
                'loadersOpen', 'loadersMenu', 'loadersAct'].forEach(function (channel) {
                host.ipc.handle(channel, function (event) {
                    const rest = Array.prototype.slice.call(arguments, 1);
                    // The two dialogs are modal to the window that asked for them, so its own
                    // BrowserWindow travels with the call.
                    return handle(channel, rest, ownerOf(event));
                });
            });
        },
        act: act,
        grab: grab,
        save: save,
        open: open,
        loadTarget: loadTarget,
        rows: function () { return rows; }
    };
}

/**
 * The BrowserWindow an IPC event came from, or undefined when there is none - which Electron
 * reads as "no parent window". A dialog then opens unowned rather than not at all.
 */
function ownerOf(event) {
    try {
        const electron = require('electron');
        return electron && electron.BrowserWindow && event && event.sender
            ? electron.BrowserWindow.fromWebContents(event.sender)
            : undefined;
    } catch (error) {
        return undefined;
    }
}

/** The feature as the plugin uses it: the game access, the browser window, the clipboard. */
function createFromHost(host, deps) {
    deps = deps || {};
    const electron = deps.electron || require('electron');
    return createLoadersFeature(host, Object.assign({
        game: deps.game || require('./game.js').createGameAccess(host.bridge, function (msg) {
            host.log(msg);
        }),
        openUrl: deps.openUrl || function (url, mode) { host.windows.openUrl(url, mode); },
        clipboard: deps.clipboard || {
            writeText: function (value) { electron.clipboard.writeText(String(value)); }
        },
        dialogs: deps.dialogs || {
            // The dialog belongs to the window that asked for it, so it is modal to that window
            // rather than to the app (the same pattern the Notepad window uses).
            save: function (options, owner) {
                return electron.dialog.showSaveDialog(owner, options);
            },
            open: function (options, owner) {
                return electron.dialog.showOpenDialog(owner, options);
            }
        },
        messages: deps.messages || host.getLocaleStrings('loadersMessages') || {}
    }, deps));
}

module.exports = {
    createLoadersFeature: createLoadersFeature,
    createFromHost: createFromHost,
    createBotLists: createBotLists,
    ERRORS: ERRORS,
    SAVE_TITLE: SAVE_TITLE,
    FILTER: FILTER
};
