// The drop list window's main-process half (ticket #33). The page draws the reference's four
// columns and its four actions; every decision lives in drops.js, and every game read goes through
// the named surface in drop-game.js.
//
// Two halves feed this, and they are the two tickets this one is the meeting point of:
//   the tap   host.packets (ticket #26) says what dropped - a `dropItem` JSON frame, watched only
//             while a window is looking (the same subscription shape the packet logger uses);
//   the game  the bridge (tickets #28/#48) reads the bag, its slots and the room, which is what
//             decides whether the player can take a drop at all.

const drops = require('./drops.js');

const CHANNELS = [
    'dropMessages', 'dropState', 'dropWatch', 'dropUnwatch', 'dropTake',
    'dropReject', 'dropBlacklist', 'dropClear', 'dropSettle'
];

function createDropWindow(deps) {
    deps = deps || {};
    const packets = deps.packets;
    const game = deps.game;
    const messages = deps.messages || {};
    const log = typeof deps.log === 'function' ? deps.log : function () {};
    const confirmClear = typeof deps.confirmClear === 'function'
        ? deps.confirmClear
        : function () { return Promise.resolve(true); };

    const list = drops.createDropList({ now: deps.now });
    const watchers = [];
    let release = null;
    // One read of the bag and its slots per change, shared by every row: a frame is a burst of
    // drops and the reference reads the bag once per click, not once per row.
    let reads = null;

    /** The bag, its slots and the house, read once per view. A failed read is a reason, not zero. */
    function surroundings() {
        if (reads) return reads;
        reads = Promise.all([
            Promise.resolve().then(function () { return game.readInventory(); })
                .then(function (items) { return { items: items, error: null }; },
                    function (error) { return { items: [], error: message(error) }; }),
            Promise.resolve().then(function () { return game.readSlots(); })
                .then(function (slots) { return { slots: slots, error: null }; },
                    function (error) { return { slots: { bag: null, house: null }, error: message(error) }; }),
            Promise.resolve().then(function () { return game.readHouseItems(); })
                .then(function (items) { return { items: items, error: null }; },
                    function () { return { items: [], error: null }; })
        ]).then(function (answers) {
            return {
                items: answers[0].items,
                slots: answers[1].slots,
                house: answers[2].items,
                error: answers[0].error || answers[1].error
            };
        });
        return reads;
    }

    /** The bag is read again after every change: a take moves something in it. */
    function forget() {
        reads = null;
    }

    function message(error) {
        return (error && error.message) || String(error);
    }

    /** Everything the page draws: the rows, their takeable verdict, the count and the switches. */
    function view() {
        return surroundings().then(function (around) {
            const rows = list.rows().map(function (row) {
                // An unreadable bag leaves the verdict unknown (null) with the reason attached: an
                // item is never marked untakeable because the game could not be asked.
                const verdict = around.error
                    ? { ok: null, reason: around.error }
                    : drops.takeable(row, around.items, around.slots, around.house);
                return Object.assign({}, row, { takeable: verdict.ok, reason: verdict.reason });
            });
            return {
                rows: rows,
                count: list.count(),
                rejecting: list.rejecting(),
                blacklist: list.blacklisted(),
                messages: messages
            };
        });
    }

    /** Push the current view to every window that is watching; a closed one is dropped. */
    function announce() {
        return view().then(function (state) {
            watchers.slice().forEach(function (watcher) {
                if (watcher.isDestroyed && watcher.isDestroyed()) { drop(watcher); return; }
                watcher.send(channel(), state);
            });
            return state;
        }, function (error) {
            log('drops: could not build the row list (' + message(error) + ')');
        });
    }

    // webContents.send is not namespaced by the Host the way ipc.handle is, so the plugin names
    // its own channel the way the preload does.
    function channel() {
        return deps.channel || 'plugin:grimlite-parity:dropRows';
    }

    /** The frames this window reads: one subscription while at least one window is looking. */
    function follow() {
        if (watchers.length && !release) release = packets.on('frame', onFrame);
        if (!watchers.length && release) { release(); release = null; }
    }

    function onFrame(frame) {
        const text = frame && frame.direction === 'toClient' ? frameText(frame.data) : null;
        if (text === null) return;

        // The answer to a take: DropStack removes the row when the game says the item went in
        // (Flash.cs:690-693), and leaves it standing when it did not, so the user can try again.
        const settled = drops.parseGetDropFrame(text);
        if (settled) {
            if (list.settle(settled.id, settled.success)) {
                forget();
                announce();
            }
            return;
        }

        const drop = drops.parseDropFrame(text);
        if (!drop) return;
        const outcome = list.offer(drop);
        if (outcome !== drops.OUTCOMES.added) {
            log('drops: ' + outcome + ' ' + drop.name);
            return;
        }
        forget();
        announce();
    }

    function frameText(data) {
        if (typeof data === 'string') return data;
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf8');
        return String(data);
    }

    function watch(watcher) {
        if (!watcher || watchers.indexOf(watcher) !== -1) { follow(); return; }
        watchers.push(watcher);
        if (typeof watcher.once === 'function') {
            watcher.once('destroyed', function () { drop(watcher); });
        }
        follow();
    }

    // A closed window is not a reason to keep reading traffic: with no window left the tap is
    // released, so a drop list nobody is looking at costs nothing.
    function drop(watcher) {
        const at = watchers.indexOf(watcher);
        if (at !== -1) watchers.splice(at, 1);
        follow();
    }

    /**
     * Take the named rows. Each is gated the way the game gates a click: what the player cannot
     * take is reported with the game's own words, the list's 3 s cooldown is honoured, and only a
     * frame the relay actually took is counted as sent.
     */
    async function take(names) {
        const wanted = Array.isArray(names) ? names : [];
        const taken = [];
        const failed = [];
        if (!wanted.length) return { taken: taken, failed: failed };

        const around = await surroundings();
        if (around.error) {
            wanted.forEach(function (name) {
                failed.push({ name: name, reason: around.error });
            });
            return { taken: taken, failed: failed };
        }

        let room = '';
        try {
            room = await game.readRoomId();
        } catch (error) {
            failed.push({ name: wanted[0], reason: message(error) });
            return { taken: taken, failed: failed };
        }

        for (let i = 0; i < wanted.length; i++) {
            const name = wanted[i];
            const row = list.find(name);
            if (!row) {
                failed.push({ name: name, reason: 'not-held' });
                continue;
            }
            const verdict = drops.takeable(row, around.items, around.slots, around.house);
            if (!verdict.ok) {
                failed.push({ name: row.name, reason: verdict.reason });
                continue;
            }
            const gate = list.beginTake(row.id);
            if (!gate.ok) {
                failed.push({ name: row.name, reason: gate.reason });
                continue;
            }
            const sent = packets.send({
                direction: 'toServer',
                text: list.takeFrame(room, row.id)
            }) === true;
            if (!sent) {
                failed.push({ name: row.name, reason: 'the relay has no live connection to write on' });
                continue;
            }
            taken.push(row.name);
        }
        return { taken: taken, failed: failed };
    }

    function handle(channelName, event, args) {
        void event;
        const first = (args && args[0]);
        switch (channelName) {
        case 'dropMessages':
            return messages;
        case 'dropWatch':
            watch(event && event.sender);
            return view();
        case 'dropUnwatch':
            drop(event && event.sender);
            return { watching: false };
        case 'dropState':
            return view();
        case 'dropTake':
            return take(first).then(function (answer) {
                forget();
                return announce().then(function (state) {
                    return Object.assign({ taken: answer.taken, failed: answer.failed }, state || {});
                });
            });
        case 'dropReject':
            list.setRejecting(first === true);
            return announce();
        case 'dropBlacklist':
            return Promise.resolve(list.blacklist(first)).then(function (removed) {
                forget();
                return announce().then(function (state) {
                    return Object.assign({ blacklisted: removed }, state || {});
                });
            });
        case 'dropClear':
            // The reference's own confirmation, in front of the one destructive action.
            return Promise.resolve(confirmClear()).then(function (yes) {
                if (yes !== true) {
                    return view().then(function (state) {
                        return Object.assign({ cleared: false }, state);
                    });
                }
                list.clear();
                forget();
                return announce().then(function (state) {
                    return Object.assign({ cleared: true }, state || {});
                });
            });
        case 'dropSettle': {
            // The getDrop answer, when it arrives: a successful take takes the row out.
            const settled = list.settle(first && first.id, first && first.success === true);
            if (!settled) return Promise.resolve({ settled: false });
            forget();
            return announce().then(function () { return { settled: true }; });
        }
        default:
            throw new Error('[AquaStar:grimlite-parity] unknown drops channel "' + channelName + '"');
        }
    }

    function attach() {
        if (!deps.host) return;
        CHANNELS.forEach(function (name) {
            deps.host.ipc.handle(name, function (event) {
                return handle(name, event, Array.prototype.slice.call(arguments, 1));
            });
        });
    }

    return {
        handle: handle,
        attach: attach,
        channel: channel(),
        list: function () { return list; },
        offer: function (item) { return list.offer(item); },
        view: view,
        watching: function () { return watchers.length; },
        reading: function () { return release !== null; }
    };
}

/** The window as the plugin uses it: the page's channels, the tap, the game and the one dialog. */
function createFromHost(host, deps) {
    deps = deps || {};
    const electron = deps.electron || require('electron');
    return createDropWindow({
        host: host,
        // The reading half is the platform's tap (packet-tap); the writing half is the relay
        // (packet-send). The tap is subscribed only while a window is looking.
        packets: host.packets,
        game: deps.game || require('./drop-game.js').createDropGame(
            require('../../bridge.js').createGameAccess(host)),
        channel: 'plugin:' + host.pluginId + ':dropRows',
        messages: (typeof host.getLocaleStrings === 'function' &&
            host.getLocaleStrings('dropsMessages')) || {},
        // DropUi.btnClear_Click's own dialog: the reference's words, and a warning icon.
        confirmClear: function (owner) {
            const dialog = deps.showMessageBox || function (win, options) {
                return electron.dialog.showMessageBox(win, options);
            };
            return Promise.resolve(dialog(owner, {
                type: 'warning',
                buttons: [dropsConfirm().no, dropsConfirm().yes],
                defaultId: 1,
                cancelId: 0,
                title: dropsConfirm().title,
                message: dropsConfirm().message
            })).then(function (result) {
                // Electron's own showMessageBox answers {response}; the first button is the answer
                // the user picked, and the reference's own first button is "No".
                return !!result && result.response === 1;
            });
        },
        log: function (msg) { host.log(msg); }
    });

    // The reference's own dialog text (DropUi.btnClear_Click), read from the locale catalog so a
    // translated build gets its own words; the reference's are the fallback. A key a catalog
    // leaves out does not blank the English out - only a real string overrides it.
    function dropsConfirm() {
        const words = {
            title: 'Caution',
            message: 'This action will clear all Blacklist and Current drops within the UI.\n' +
                'Do you wish to proceed?',
            yes: 'Yes',
            no: 'No'
        };
        const given = deps.confirm || {};
        Object.keys(words).forEach(function (key) {
            if (typeof given[key] === 'string' && given[key] !== '') words[key] = given[key];
        });
        return words;
    }
}

module.exports = {
    createDropWindow: createDropWindow,
    createFromHost: createFromHost,
    CHANNELS: CHANNELS
};
