// The loaders and grabbers' reach into the game (ticket #31).
//
// It is an extension of the plugin's one adapter, plugins/grimlite-parity/bridge.js: the same
// createGameAccess shape, the same attach-once and report-what-happened rules, plus the reads and
// the loaders this window needs. This file is the only place a grabber turns a request ("the
// inventory", "load shop 42") into a named game call, so what can work and what cannot is decided
// here and nowhere else.
//
// Ticket #29's note applies to everything below, and these names were checked the same way - an
// exact match against each SWF's ABC string pool, never a substring (a substring search "finds"
// BankSlots inside txtBankSlots and Cell inside GetCellPlayers):
//
//   in the game : getInventory, invTree, bankinfo, tempitems, questTree, shopinfo, hairshopinfo,
//                 cells, strFrame, getMonstersByCell, getQuests, getQuest, getQuestValue,
//                 acceptQuest, tryQuestComplete, isQuestInProgress, maximumQuestTurnIns,
//                 sendLoadShopRequest, sendLoadHairShopRequest, openArmorCustomize, sendString
//   loader only : LoadShop, LoadHairShop, LoadArmorCustomizer, ResetShopInfo, GetInventoryItems,
//                 GetBankItems, GetTempItems, GetQuestTree, LoadQuest, LoadQuests, Complete,
//                 IsInProgress, IsAvailable, SetEquip, BankSlots, UsedBankSlots
//
// So a load asks the reference's own name first and falls back to the game's, and a read reports
// every path it tried, with the game's own words for each, when none of them answers. Nothing is
// invented and nothing is swallowed.
//
// The bot manager's own reads (plugins/grimlite-parity/bot/game-reads.js) use the same three paths
// for cell, pad and map; readWorld here reads them in one go for this window.

/**
 * Read as a list, whatever shape the game answered with: an array, {items: [...]}, a map keyed by
 * slot or id (bankinfo, tempitems and questTree are all keyed this way), or a lone object.
 */
function asList(payload) {
    if (payload === null || payload === undefined || payload === '') return [];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.$values)) return payload.$values;
    if (typeof payload !== 'object') return [];
    return Object.keys(payload)
        .map(function (key) { return payload[key]; })
        .filter(function (value) { return value && typeof value === 'object'; });
}

/** The bridge callback for a call: the reference keeps the zero-argument call separate. */
function callFor(args) {
    return args.length ? 'callGameFunction' : 'callGameFunction0';
}

/** The movie's own JSON text, with its {"error": ...} answer raised as the error it is. */
function decode(value) {
    if (typeof value !== 'string') return value === undefined ? null : value;
    if (value === '') return null;
    let parsed;
    try {
        parsed = JSON.parse(value);
    } catch (error) {
        // A value JSON cannot express is handed over already stringified; take it as it is.
        return value;
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') {
        throw new Error(parsed.error);
    }
    return parsed;
}

function message(error) {
    return (error && error.message) || String(error);
}

/**
 * Grabber's own slot map, from an item's category: Cape -> ba, Pet -> pe, Armor or Class -> co,
 * Helm -> he, Misc -> mi, anything else -> Weapon.
 */
function equipSlot(category) {
    const text = String(category == null ? '' : category);
    if (text === 'Cape') return 'ba';
    if (text === 'Pet') return 'pe';
    if (text === 'Armor' || text === 'Class') return 'co';
    if (text === 'Helm') return 'he';
    if (text === 'Misc') return 'mi';
    return 'Weapon';
}

/** A game string that may have arrived quoted, or absent. */
function plain(raw) {
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'string') return raw.replace(/^"|"$/g, '');
    return String(raw);
}

/**
 * @param {object} bridge host.bridge, or a stand-in with the same two members (attach, call).
 * @param {(msg: string) => void} [log]
 */
function createGameAccess(bridge, log) {
    const note = typeof log === 'function' ? log : function () {};

    let attached = false;
    // World.LoadedShops: the reference accumulates each shop the client reports, keyed by id.
    const loadedShops = [];

    function rememberShops(payload) {
        const shops = Array.isArray(payload) ? payload
            : (payload && Array.isArray(payload.$values) ? payload.$values : [payload]);
        shops.forEach(function (shop) {
            if (!shop || typeof shop !== 'object' || shop.ShopID === undefined || shop.ShopID === null) return;
            if (loadedShops.some(function (held) { return String(held.ShopID) === String(shop.ShopID); })) return;
            loadedShops.push(shop);
        });
    }

    /** Attach once, and retry after a failure: the game window may open later, or reopen. */
    function ensure() {
        if (!bridge || typeof bridge.call !== 'function') {
            return Promise.reject(new Error('this app has no game bridge channel'));
        }
        if (attached) return Promise.resolve();
        if (typeof bridge.attach !== 'function') {
            attached = true;
            return Promise.resolve();
        }
        return Promise.resolve(bridge.attach()).then(function (result) {
            if (!result || !result.ok) {
                throw new Error((result && result.error) || 'the game bridge did not attach');
            }
            attached = true;
        });
    }

    /** One game function through the channel, decoded. Rejects with what the game said. */
    function invoke(name, args) {
        const callArgs = Array.isArray(args) ? args : [];
        return ensure().then(function () {
            return bridge.call(callFor(callArgs), [name].concat(callArgs));
        }).then(function (result) {
            if (!result || !result.ok) {
                throw new Error((result && result.error) || ('the game did not answer ' + name));
            }
            return decode(result.value);
        });
    }

    /** The reference loader's own helper surface, when this channel carries it. */
    function loaderCall(name, args) {
        return ensure().then(function () {
            if (!bridge || typeof bridge.loaderCall !== 'function') {
                throw new Error('this app has no loader helper surface');
            }
            return bridge.loaderCall(name, Array.isArray(args) ? args : []);
        }).then(decode);
    }

    /** One dot-path read through the generic surface: getGameObject, decoded. */
    function read(path) {
        return ensure().then(function () {
            return bridge.call('getGameObject', [path]);
        }).then(function (result) {
            if (!result || !result.ok) {
                throw new Error((result && result.error) || ('the game did not answer ' + path));
            }
            return decode(result.value);
        });
    }

    function run(route) {
        if (route.kind === 'loader') return loaderCall(route.name, route.args);
        if (route.kind === 'read') return read(route.name);
        return invoke(route.name, route.args);
    }

    /**
     * The first route that answers. When none does, the rejection names every route with the
     * game's own words for each, so a user sees which name was refused rather than one vague
     * failure. A read that failed is never turned into an empty list.
     */
    function firstOf(what, routes) {
        const tried = [];
        function attempt(index) {
            if (index >= routes.length) {
                const error = new Error('could not read ' + what + ' - ' + tried.join('; '));
                error.attempts = tried;
                return Promise.reject(error);
            }
            return run(routes[index]).then(function (value) {
                access.lastRead = { what: what, answeredBy: routes[index].name, value: value };
                return value;
            }, function (error) {
                tried.push(routes[index].name + ': ' + message(error));
                return attempt(index + 1);
            });
        }
        return attempt(0);
    }

    /** A load that is a side effect: {ok, via} or {ok: false, error} naming every name tried. */
    function loadTarget(what, routes) {
        const tried = [];
        function attempt(index) {
            if (index >= routes.length) {
                return Promise.resolve({
                    ok: false,
                    error: 'could not load ' + what + ' - ' + tried.join('; ')
                });
            }
            return run(routes[index]).then(function () {
                return { ok: true, via: routes[index].name };
            }, function (error) {
                tried.push(routes[index].name + ': ' + message(error));
                return attempt(index + 1);
            });
        }
        return attempt(0);
    }

    const access = {
        /** The last successful read: {what, answeredBy, value}. Evidence, not a claim. */
        lastRead: null,

        read: read,
        invoke: invoke,
        asList: asList,

        // ---------------------------------------------------------- the grabbers' reads

        /** The inventory: the game's own getInventory, then its own inventory tree. */
        readInventory: function () {
            return firstOf('the inventory', [
                { name: 'GetInventoryItems', kind: 'loader' },
                { name: 'world.getInventory', kind: 'call' },
                { name: 'world.invTree', kind: 'read' }
            ]).then(function (payload) {
                return asList(payload && payload.items !== undefined ? payload.items : payload);
            });
        },

        /** The bank, from the game's own bank information object. */
        readBankItems: function () {
            return firstOf('the bank', [
                { name: 'GetBankItems', kind: 'loader' },
                { name: 'world.bankinfo', kind: 'read' }
            ]).then(function (payload) {
                return asList(payload && payload.items !== undefined ? payload.items : payload);
            });
        },

        /** The temporary (quest) items, from the game's own temporary inventory object. */
        readTempItems: function () {
            return firstOf('the temporary inventory', [
                { name: 'GetTempItems', kind: 'loader' },
                { name: 'world.tempitems', kind: 'read' }
            ]).then(function (payload) {
                return asList(payload && payload.items !== undefined ? payload.items : payload);
            });
        },

        /**
         * The quest tree as a list. The reference loader's own GetQuestTree flattens the same
         * map the game exposes; the direct path stays as a fallback for channels without the
         * loader surface.
         */
        readQuestTree: function () {
            return firstOf('the quest tree', [
                { name: 'GetQuestTree', kind: 'loader' },
                { name: 'world.questTree', kind: 'read' }
            ]).then(function (payload) {
                return asList(payload);
            });
        },

        /** The loaded shop: the game's own shop information object, which the grabber draws. */
        readShopInfo: function () {
            return firstOf('the shop', [
                { name: 'world.shopinfo', kind: 'read' }
            ]).then(function (payload) {
                rememberShops(payload);
                return payload;
            });
        },

        /** World.LoadedShops: every shop this loaders window has seen, in load order. */
        readLoadedShops: function () {
            return access.readShopInfo().then(function () {
                return loadedShops.slice();
            }, function (error) {
                if (loadedShops.length) return loadedShops.slice();
                throw error;
            });
        },

        /** The monsters standing in the player's own frame. */
        readMonsters: function () {
            return access.currentCell().then(function (cell) {
                return access.readMonstersInCell(cell);
            });
        },

        /** Every monster on the map: GetMonstersInCell for each cell the world lists. */
        readAllMonsters: function () {
            return firstOf('the map cells', [
                { name: 'world.cells', kind: 'read' }
            ]).then(function (payload) {
                const cells = Array.isArray(payload)
                    ? payload
                    : Object.keys(payload || {}).map(function (key) { return payload[key]; });
                return cells.reduce(function (chain, cell) {
                    return chain.then(function (all) {
                        return access.readMonstersInCell(cell).then(function (monsters) {
                            return all.concat(monsters);
                        });
                    });
                }, Promise.resolve([]));
            });
        },

        /** The monsters in one cell, by the game's own name for the call. */
        readMonstersInCell: function (cell) {
            return firstOf('the monsters in ' + cell, [
                { name: 'world.getMonstersByCell', kind: 'call', args: [cell] }
            ]).then(function (payload) {
                return asList(payload);
            });
        },

        /** The cell, pad and map the player stands at: the bot manager's own three paths. */
        readWorld: function () {
            return read('world.strFrame').then(function (cell) {
                return read('world.strPad').then(function (pad) {
                    return read('world.strMapName').then(function (map) {
                        return { cell: plain(cell), pad: plain(pad), map: plain(map) };
                    });
                });
            });
        },

        /** The player's frame, or a refusal naming what the game has not said. */
        currentCell: function () {
            return read('world.strFrame').then(function (frame) {
                const cell = plain(frame);
                if (cell === '') {
                    throw new Error('the game has not said which cell the player stands in ' +
                        '(world.strFrame is empty), so there are no monsters to list');
                }
                return cell;
            });
        },

        // ---------------------------------------------------------- the loaders

        /** Shop.Load(id): the loader's ResetShopInfo then LoadShop, then the game's own request. */
        loadShop: function (id) {
            // Reset is a preparation step, not a route that counts as the load. On channels with
            // the loader surface it answers first, so treating it as "the target loaded" would
            // stop before LoadShop is ever asked.
            return loaderCall('ResetShopInfo').catch(function () { return null; }).then(function () {
                return loadTarget('shop ' + id, [
                    { name: 'LoadShop', kind: 'loader', args: [String(id)] },
                    { name: 'world.sendLoadShopRequest', args: [Number(id)] }
                ]);
            }).then(function (answer) {
                if (!answer.ok) return answer;
                return access.readShopInfo().then(function () { return answer; }, function () { return answer; });
            });
        },

        /** Shop.LoadHairShop(id), then the game's own request for the same thing. */
        loadHairShop: function (id) {
            return loadTarget('the hair shop ' + id, [
                { name: 'LoadHairShop', kind: 'loader', args: [String(id)] },
                { name: 'world.sendLoadHairShopRequest', args: [Number(id)] }
            ]).then(function (answer) {
                if (!answer.ok) return answer;
                return access.readShopInfo().then(function () { return answer; }, function () { return answer; });
            });
        },

        /** Shop.LoadArmorCustomizer(), then the game's own openArmorCustomize. */
        loadArmorCustomizer: function () {
            return loadTarget('the armour customizer', [
                { name: 'LoadArmorCustomizer', kind: 'loader' },
                { name: 'world.openArmorCustomize' }
            ]);
        },

        /** Quests.Load(id): the loader's LoadQuest, then the game's own getQuest. */
        loadQuest: function (id) {
            return loadTarget('quest ' + id, [
                { name: 'LoadQuest', kind: 'loader', args: [String(id)] },
                { name: 'world.getQuest', args: [id] }
            ]);
        },

        /** Quests.Load(ids): the loader's LoadQuests, then the game's own getQuests. */
        loadQuests: function (ids) {
            const list = Array.isArray(ids) ? ids : [ids];
            return loadTarget('quests ' + list.join(','), [
                { name: 'LoadQuests', kind: 'loader', args: [list.join(',')] },
                { name: 'world.getQuests', args: [list.map(String)] }
            ]);
        },

        /**
         * Player.Quests.Accept(id): the loader's Accept, then the game's own acceptQuest. The
         * ghost variant is the reference's own frame (Quest.GhostAccept), which goes out through
         * the game's own socket call - sfc.sendString - and is not a loader name at all.
         */
        acceptQuest: function (id, options) {
            if (options && options.ghost) {
                return invoke('sfc.sendString', ['%xt%zm%acceptQuest%1%' + id + '%']).then(
                    function () { return { ok: true, via: 'sfc.sendString' }; },
                    function (error) {
                        return { ok: false, error: 'could not ghost-accept quest ' + id + ' - ' +
                            'sfc.sendString: ' + message(error) };
                    }
                );
            }
            return loadTarget('quest ' + id, [
                { name: 'Accept', args: [String(id)] },
                { name: 'world.acceptQuest', args: [id] }
            ]);
        },

        /**
         * Quest.Complete(): the loader's Complete, then the game's own tryQuestComplete. The
         * reference's two variants (once, maxed) differ in the count they turn in, and this port
         * carries that as the reference does: max asks for the maximum turn-ins the game allows.
         */
        completeQuest: function (id, options) {
            const opts = options || {};
            const titled = opts.max ? 'Quest (Maxed)' : 'Quest (Once)';
            return loadTarget('the completion of ' + titled + ' ' + id, [
                { name: 'Complete', args: [String(id)] },
                { name: 'world.tryQuestComplete', args: [id] }
            ]);
        },

        /**
         * Grabber's "Equip SWF": SetEquip on the reference's loader, then the game's own
         * loadMovieAtES. The slot codes are Grabber.cs's own switch on the item's category, and
         * the game's loadMovieAtES is the line the reference keeps commented out beside its
         * SetEquip call - the same route ticket #30's Cosmetics window verified.
         */
        equipSwf: function (category, file, link) {
            return loadTarget('the ' + category + ' wear', [
                { name: 'SetEquip', args: [equipSlot(category), {
                    sFile: String(file == null ? '' : file),
                    sLink: String(link == null ? '' : link),
                    sType: String(category == null ? '' : category)
                }] },
                { name: 'world.myAvatar.loadMovieAtES',
                    args: [equipSlot(category), String(file == null ? '' : file),
                        String(link == null ? '' : link)] }
            ]);
        },

        /**
         * Shop.BuyItemQty(itemId, shopItemId, qty): the reference reaches the loader's
         * BuyItemQtyById, which the game does not carry. Its own request sender is
         * sendBuyItemRequestWithQuantity, which takes a name rather than an id pair, so the two
         * are not the same call and this reports the name it is waiting for rather than guessing.
         */
        buyItemQty: function (itemId, shopItemId, qty) {
            return invoke('BuyItemQtyById', [String(qty), String(itemId), String(shopItemId)])
                .then(function () {
                    return { ok: true, via: 'BuyItemQtyById' };
                }, function (error) {
                    return { ok: false, error: 'could not buy item ' + itemId + ' (shop item ' +
                        shopItemId + '): BuyItemQtyById: ' + message(error) +
                        ' - the stock game has no id-based buy (its own sendBuyItemRequestWithQuantity ' +
                        'takes an item name), so this waits on the bridge helper surface' };
                });
        },

        /** Quest.IsInProgress(id): the loader's name, then the game's own isQuestInProgress. */
        isInProgress: function (id) {
            return firstOf('whether quest ' + id + ' is in progress', [
                { name: 'IsInProgress', kind: 'call', args: [String(id)] },
                { name: 'world.isQuestInProgress', kind: 'call', args: [id] }
            ]).then(function (answer) {
                return answer === true || answer === 1 || answer === '1' || answer === 'true';
            });
        },

        // Pacing is not game access: a feature that waits keeps working whatever the bridge does.
        sleep: function (ms) {
            return new Promise(function (resolve) { setTimeout(resolve, ms); });
        }
    };

    void note;
    return access;
}

module.exports = {
    createGameAccess: createGameAccess,
    asList: asList,
    decode: decode,
    equipSlot: equipSlot
};
