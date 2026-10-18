// PluginHost facade. Records capability registrations and enforces manifest
// permissions. Electron wiring (webRequest, BrowserWindow, ipcMain) is injected
// later by PR 2+; PR 1 keeps this module testable under plain Node.

const path = require('path');
const { fileURLToPath } = require('url');
const schema = require('./manifest-schema.js');

const PLATFORM_RESERVED_KEYBIND_IDS = {
    settings: true,
    fullscreen: true,
    sshot: true,
    record: true,
    reload: true,
    reloadCache: true,
    help: true,
    about: true,
    forward: true,
    backward: true
};

function createPermissionError(pluginId, method, permission) {
    return new Error(
        '[AquaStar:plugins] Plugin "' + pluginId + '" called ' + method +
        ' without permission "' + permission + '"'
    );
}

function createPluginHost(options) {
    if (!options || !options.manifest || !options.pluginRoot) {
        throw new Error('createPluginHost requires manifest and pluginRoot');
    }

    const manifest = options.manifest;
    const pluginId = manifest.id;
    const permissions = {};
    (manifest.permissions || []).forEach(function (perm) {
        permissions[perm] = true;
    });

    const state = {
        primaryGame: null,
        gameOrigin: null,
        launches: [],
        sessionRules: [],
        packetSteering: [],
        navigationHooks: null,
        featureWindows: [],
        browserPreload: null,
        keybindDefaults: {},
        keybinds: [],
        menus: [],
        menuProviders: null,
        locales: {},
        settingsSections: [],
        optionDefaults: {},
        trustedFlashUrls: [],
        ipcHandlers: [],
        ipcListeners: [],
        stores: {}
    };
    const deps = Object.assign({}, options.deps || {});
    const log = typeof options.log === 'function'
        ? options.log
        : function (msg) { console.log('[AquaStar:plugins] ' + msg); };

    const bridgeChannel = require('./bridge-channel.js').createBridgeChannel({
        // The window the platform opened for this plugin's own game: the only page whose
        // <object> is the bridge's. Resolved per call, so a window that reopened is picked up.
        getGameWindow: function () {
            if (typeof deps.getGameWindow === 'function') return deps.getGameWindow();
            return null;
        },
        executeJavaScript: function (webContents, source, label) {
            if (typeof deps.executeJavaScript !== 'function') {
                return Promise.resolve(null);
            }
            return deps.executeJavaScript(webContents, source, label);
        },
        probeNames: Array.isArray(manifest.bridgeCallbacks) ? manifest.bridgeCallbacks : [],
        log: function (msg) { log('bridge: ' + msg); }
    });

    // Auto-wire main-process IPC + namespaced JSON stores when running under Electron.
    try {
        const electron = require('electron');
        if (electron.ipcMain) {
            if (typeof deps.ipcHandle !== 'function') {
                deps.ipcHandle = function (channel, listener) {
                    electron.ipcMain.handle(channel, listener);
                };
            }
            if (typeof deps.ipcOn !== 'function') {
                deps.ipcOn = function (channel, listener) {
                    electron.ipcMain.on(channel, listener);
                };
            }
            if (typeof deps.ipcRemoveHandler !== 'function') {
                deps.ipcRemoveHandler = function (channel) {
                    if (typeof electron.ipcMain.removeHandler === 'function') {
                        electron.ipcMain.removeHandler(channel);
                    }
                };
            }
        }
    } catch (e) { /* unit tests without Electron */ }

    if (typeof deps.createStore !== 'function' && options.appDataDirectory) {
        try {
            const nsFactory = require('./storage/namespaced-store.js').createNamespacedStore({
                appDataDirectory: options.appDataDirectory,
                pluginId: pluginId,
                aliases: manifest.storeAliases || null
            });
            deps.createStore = function (ns) {
                return nsFactory.getStore(ns);
            };
        } catch (e) {
            log('namespaced-store unavailable: ' + (e && e.message ? e.message : e));
        }
    }

    function requirePermission(method, permission) {
        if (!permissions[permission]) {
            throw createPermissionError(pluginId, method, permission);
        }
    }

    function assertUniqueIds(list, item, label) {
        for (let i = 0; i < list.length; i++) {
            if (list[i].id === item.id) {
                throw new Error(
                    '[AquaStar:plugins] Duplicate ' + label + ' id "' + item.id +
                    '" in plugin "' + pluginId + '"'
                );
            }
        }
    }

    function resolveChannel(channel, opts) {
        opts = opts || {};
        // Unprefixed channel names need BOTH the loader's grant (bundled plugins only) and the
        // plugin's own request in its manifest. The host never decides from a plugin id.
        const legacyBundled = options.legacyIpc === true &&
            manifest.unprefixedIpc === true &&
            manifest.apiVersion === 1;
        if (opts.raw === true) return channel;
        if (legacyBundled) return channel;
        return 'plugin:' + pluginId + ':' + channel;
    }

    function urlAllowedByFetchAllowlist(url) {
        const list = manifest.fetchAllowlist;
        if (!Array.isArray(list) || list.length === 0) return false;
        for (let i = 0; i < list.length; i++) {
            const pattern = list[i];
            if (pattern === url) return true;
            if (pattern.slice(-1) === '*' && url.indexOf(pattern.slice(0, -1)) === 0) {
                return true;
            }
        }
        return false;
    }

    function hostPathInsidePlugin(relativePath) {
        if (schema.hasPathEscape(relativePath)) {
            throw new Error(
                '[AquaStar:plugins] scriptRelativePath must stay inside the plugin root'
            );
        }
        const resolved = path.resolve(options.pluginRoot, relativePath);
        const rootResolved = path.resolve(options.pluginRoot);
        const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
        if (resolved !== rootResolved && resolved.indexOf(prefix) !== 0) {
            throw new Error(
                '[AquaStar:plugins] scriptRelativePath escaped plugin root'
            );
        }
        return resolved;
    }

    // docs/PLUGINS.md §4.3: navigation hooks run only for hosts the manifest names
    // (exact hostname match). Pages inside the plugin root are the plugin's own files.
    function injectionAllowed(url) {
        let parsed;
        try {
            parsed = new URL(url);
        } catch (error) {
            return false;
        }
        if (parsed.protocol === 'file:') {
            const root = path.resolve(options.pluginRoot);
            let filePath;
            try {
                filePath = path.resolve(fileURLToPath(parsed));
            } catch (error) {
                return false;
            }
            return filePath === root || filePath.indexOf(root + path.sep) === 0;
        }
        const host = parsed.hostname.toLowerCase();
        if (!host) return false;
        const patterns = manifest.injectHostPatterns || [];
        for (let i = 0; i < patterns.length; i++) {
            if (String(patterns[i]).toLowerCase() === host) return true;
        }
        log('injection skipped for host "' + host + '" (not in injectHostPatterns)');
        return false;
    }

    const host = {
        appVersion: options.appVersion || '0.0.0',
        appRootPath: options.appRootPath || '',
        appDataDirectory: options.appDataDirectory || '',
        pluginId: pluginId,
        pluginRoot: options.pluginRoot,
        pluginDataDirectory: options.pluginDataDirectory ||
            path.join(options.appDataDirectory || '', 'plugins', pluginId),

        /**
         * Gate a Host method on a manifest permission, naming the missing one. Every
         * guarded Host method goes through this, so a plugin without the permission gets
         * the same message wherever it calls from.
         */
        requirePermission: function (method, permission) {
            requirePermission(method, permission);
        },

        getStore: function (ns) {
            requirePermission('getStore', 'persistent-store');
            if (typeof ns !== 'string' || !ns) {
                throw new Error('[AquaStar:plugins] getStore requires a namespace string');
            }
            if (state.stores[ns]) return state.stores[ns];
            if (typeof deps.createStore === 'function') {
                state.stores[ns] = deps.createStore(ns, host);
                return state.stores[ns];
            }
            // Placeholder until PR 7a wires namespaced-store.
            const memory = { value: undefined };
            state.stores[ns] = {
                read: function () { return memory.value; },
                write: function (value) { memory.value = value; return value; },
                readOrCreate: function (createValue) {
                    if (memory.value === undefined) memory.value = createValue();
                    return memory.value;
                }
            };
            return state.stores[ns];
        },

        registerKeybindDefaults: function (defs) {
            if (!defs || typeof defs !== 'object') {
                throw new Error('[AquaStar:plugins] registerKeybindDefaults expects an object');
            }
            Object.keys(defs).forEach(function (key) {
                state.keybindDefaults[key] = defs[key];
            });
        },

        registerOptionDefaults: function (defs) {
            if (!defs || typeof defs !== 'object') {
                throw new Error('[AquaStar:plugins] registerOptionDefaults expects an object');
            }
            Object.keys(defs).forEach(function (key) {
                state.optionDefaults[key] = defs[key];
            });
        },

        registerKeybinds: function (bindings) {
            if (!Array.isArray(bindings)) {
                throw new Error('[AquaStar:plugins] registerKeybinds expects an array');
            }
            bindings.forEach(function (binding) {
                if (!binding || typeof binding.id !== 'string') {
                    throw new Error('[AquaStar:plugins] keybind requires id');
                }
                if (PLATFORM_RESERVED_KEYBIND_IDS[binding.id]) {
                    throw new Error(
                        '[AquaStar:plugins] keybind id "' + binding.id +
                        '" is reserved for the platform'
                    );
                }
                assertUniqueIds(state.keybinds, binding, 'keybind');
                state.keybinds.push(binding);
            });
        },

        registerMenus: function (contributor) {
            if (typeof contributor !== 'function') {
                throw new Error('[AquaStar:plugins] registerMenus expects a function');
            }
            state.menus.push(contributor);
        },

        registerMenuPages: function (providers) {
            if (!providers || typeof providers !== 'object') {
                throw new Error('[AquaStar:plugins] registerMenuPages expects an object');
            }
            if (providers.appUsefulPages != null &&
                typeof providers.appUsefulPages !== 'function') {
                throw new Error(
                    '[AquaStar:plugins] registerMenuPages.appUsefulPages expects a function'
                );
            }
            if (providers.gameMenuPages != null &&
                typeof providers.gameMenuPages !== 'function') {
                throw new Error(
                    '[AquaStar:plugins] registerMenuPages.gameMenuPages expects a function'
                );
            }
            const next = state.menuProviders
                ? Object.assign({}, state.menuProviders)
                : {};
            if (typeof providers.appUsefulPages === 'function') {
                next.appUsefulPages = providers.appUsefulPages;
            }
            if (typeof providers.gameMenuPages === 'function') {
                next.gameMenuPages = providers.gameMenuPages;
            }
            state.menuProviders = next;
        },

        registerFeatureWindows: function (windows) {
            if (!Array.isArray(windows)) {
                throw new Error('[AquaStar:plugins] registerFeatureWindows expects an array');
            }
            windows.forEach(function (winDef) {
                if (!winDef || typeof winDef.id !== 'string') {
                    throw new Error('[AquaStar:plugins] feature window requires id');
                }
                const cfg = winDef.config || {};
                const needsUnsafe =
                    cfg.webSecurity === false ||
                    (cfg.webPreferences && cfg.webPreferences.webSecurity === false) ||
                    (cfg.webPreferences && cfg.webPreferences.plugins === true);
                if (needsUnsafe) requirePermission('registerFeatureWindows', 'unsafe-renderer');
                assertUniqueIds(state.featureWindows, winDef, 'feature window');
                state.featureWindows.push(winDef);
            });
        },

        /**
         * Preload script for the platform's browser windows (the pages a plugin links to, such
         * as a wiki). Path is relative to the plugin root. Runs in sandboxed renderers, so it
         * may only require('electron'). Requires permission inject-scripts.
         */
        registerBrowserPreload: function (relativePath) {
            requirePermission('registerBrowserPreload', 'inject-scripts');
            if (typeof relativePath !== 'string' || !relativePath) {
                throw new Error('[AquaStar:plugins] registerBrowserPreload expects a relative path');
            }
            state.browserPreload = hostPathInsidePlugin(relativePath);
        },

        registerSessionRules: function (rules) {
            requirePermission('registerSessionRules', 'web-request');
            if (!Array.isArray(rules)) {
                throw new Error('[AquaStar:plugins] registerSessionRules expects an array');
            }
            rules.forEach(function (rule) {
                if (!rule || typeof rule.id !== 'string') {
                    throw new Error('[AquaStar:plugins] session rule requires id');
                }
                assertUniqueIds(state.sessionRules, rule, 'session rule');
                state.sessionRules.push(rule);
            });
        },

        /**
         * Declare where this plugin's client takes its server list and how the rows are shaped, so
         * the platform can steer the client onto the local relay (res/platform/packet-layer.js).
         * The platform owns the mechanism and knows no game: every game-specific fact (URL, row
         * field names, reachable hosts, policy domain) is the declaration's. Reading game traffic
         * needs packet-tap; writing it needs packet-send.
         */
        registerPacketSteering: function (declaration) {
            requirePermission('registerPacketSteering', 'packet-tap');
            if (!declaration || typeof declaration !== 'object' || Array.isArray(declaration)) {
                throw new Error('[AquaStar:plugins] registerPacketSteering expects a declaration object');
            }
            if (typeof declaration.id !== 'string' || !declaration.id) {
                throw new Error('[AquaStar:plugins] packet steering declaration requires id');
            }
            if (!Array.isArray(declaration.urls) || !declaration.urls.length) {
                throw new Error('[AquaStar:plugins] packet steering declaration requires urls');
            }
            if (typeof declaration.hostField !== 'string' || typeof declaration.portField !== 'string') {
                throw new Error('[AquaStar:plugins] packet steering declaration requires hostField and portField');
            }
            if (typeof declaration.policyDomain !== 'string' || !declaration.policyDomain) {
                throw new Error('[AquaStar:plugins] packet steering declaration requires policyDomain');
            }
            if (!Array.isArray(declaration.allowedHosts) || !declaration.allowedHosts.length) {
                throw new Error('[AquaStar:plugins] packet steering declaration requires allowedHosts');
            }
            assertUniqueIds(state.packetSteering, declaration, 'packet steering declaration');
            state.packetSteering.push(declaration);
        },

        registerNavigationHooks: function (hooks) {
            hooks = hooks || {};
            if (typeof hooks.onDidFinishLoad === 'function') {
                requirePermission('registerNavigationHooks', 'inject-scripts');
                const hook = hooks.onDidFinishLoad;
                hooks = Object.assign({}, hooks, {
                    onDidFinishLoad: function (ctx) {
                        if (!ctx || !injectionAllowed(ctx.url)) return undefined;
                        return hook(ctx);
                    }
                });
            }
            state.navigationHooks = hooks;
        },

        registerLaunches: function (entries) {
            if (!Array.isArray(entries)) {
                throw new Error('[AquaStar:plugins] registerLaunches expects an array');
            }
            entries.forEach(function (entry) {
                if (!entry || typeof entry.id !== 'string' || typeof entry.getUrl !== 'function') {
                    throw new Error('[AquaStar:plugins] launch requires id and getUrl()');
                }
                assertUniqueIds(state.launches, entry, 'launch');
                state.launches.push(entry);
            });
        },

        setPrimaryGame: function (cfg) {
            if (!cfg || typeof cfg.id !== 'string' || typeof cfg.getUrl !== 'function') {
                throw new Error('[AquaStar:plugins] setPrimaryGame requires id and getUrl()');
            }
            if (typeof cfg.isGameUrl !== 'function') {
                throw new Error('[AquaStar:plugins] setPrimaryGame requires isGameUrl()');
            }
            state.primaryGame = cfg;
        },

        /**
         * Serve this plugin's game paths from a loopback origin and answer with its base URL.
         * routes: [{ prefix, origin }] - longest matching prefix wins, path preserved.
         * files: optional { "/path": absoluteFile } - local files the origin answers itself, which
         * is how a plugin serves the page and SWF that must share the game's origin.
         * userAgent: optional (received) => sent policy for the plugin's own hosts, which the
         * loopback URLs it sees would otherwise never match.
         */
        declareGameOrigin: function (declaration) {
            requirePermission('declareGameOrigin', 'game-origin');
            declaration = declaration || {};
            const routes = declaration && declaration.routes;
            if (!Array.isArray(routes) || !routes.length || !routes.every(function (route) {
                if (!route || typeof route.prefix !== 'string' || !route.prefix) return false;
                if (typeof route.origin !== 'string') return false;
                try {
                    const protocol = new URL(route.origin).protocol;
                    return protocol === 'http:' || protocol === 'https:';
                } catch (e) { return false; }
            })) {
                throw new Error(
                    '[AquaStar:plugins] declareGameOrigin expects routes: [{ prefix, origin }]'
                );
            }
            if (state.gameOrigin) {
                throw new Error(
                    '[AquaStar:plugins] game origin already declared by plugin "' + pluginId + '"'
                );
            }
            let files = {};
            if (declaration.files != null) {
                if (typeof declaration.files !== 'object' || Array.isArray(declaration.files)) {
                    throw new Error('[AquaStar:plugins] declareGameOrigin files must be an object');
                }
                Object.keys(declaration.files).forEach(function (servedPath) {
                    const target = declaration.files[servedPath];
                    if (servedPath.charAt(0) !== '/' || typeof target !== 'string' || !target) {
                        throw new Error(
                            '[AquaStar:plugins] declareGameOrigin files must map "/path" to an absolute file'
                        );
                    }
                    files[servedPath] = target;
                });
            }
            if (typeof deps.startGameOrigin !== 'function') {
                throw new Error('[AquaStar:plugins] game origin not wired');
            }
            state.gameOrigin = { routes: routes, files: files };
            return Promise.resolve(deps.startGameOrigin({
                routes: routes,
                files: files,
                userAgent: typeof declaration.userAgent === 'function' ? declaration.userAgent : null,
                pluginId: pluginId
            }))
                .then(function (baseUrl) {
                    state.gameOrigin.baseUrl = baseUrl;
                    return baseUrl;
                });
        },

        trustFlashUrls: function (urls) {
            requirePermission('trustFlashUrls', 'flash-trust');
            if (!Array.isArray(urls)) {
                throw new Error('[AquaStar:plugins] trustFlashUrls expects an array');
            }
            state.trustedFlashUrls = state.trustedFlashUrls.concat(urls);
            if (typeof deps.trustFlashUrls === 'function') {
                deps.trustFlashUrls(urls);
            }
        },

        registerLocales: function (catalog) {
            if (!catalog || typeof catalog !== 'object') {
                throw new Error('[AquaStar:plugins] registerLocales expects an object');
            }
            Object.keys(catalog).forEach(function (localeId) {
                state.locales[localeId] = catalog[localeId];
            });
        },

        /**
         * The game bridge: the plugin's own call surface on the game window's movie, driven from
         * the page side (res/platform/bridge-channel.js). Gated on `game-bridge`: a plugin that has
         * not declared it cannot attach, and cannot call.
         *
         * `call` never throws for a bridge that is absent or slow - it reports why, so a feature
         * window can show the reason instead of dying.
         */
        bridge: {
            attach: function () {
                requirePermission('host.bridge.attach', 'game-bridge');
                return bridgeChannel.attach();
            },
            call: function (name, args) {
                requirePermission('host.bridge.call', 'game-bridge');
                return bridgeChannel.call(name, args);
            },
            attachedWindow: function () {
                requirePermission('host.bridge.attachedWindow', 'game-bridge');
                return bridgeChannel.attachedWindow();
            },
            /** The callback names this plugin's bridge registers (its manifest's declaration). */
            callbacks: function () {
                requirePermission('host.bridge.callbacks', 'game-bridge');
                return Array.isArray(manifest.bridgeCallbacks) ? manifest.bridgeCallbacks.slice() : [];
            }
        },

        getPlatformSettings: function () {
            if (typeof deps.getPlatformSettings === 'function') {
                return deps.getPlatformSettings();
            }
            try {
                const keyb = require('../keybindings.js');
                if (keyb.keybinds && typeof keyb.keybinds === 'object') {
                    return Object.assign({}, options.platformSettings || {}, keyb.keybinds);
                }
            } catch (e) { /* ignore */ }
            return options.platformSettings || {};
        },

        /**
         * Read a UTF-8 file confined to the plugin root (no ".." escape).
         * Prefer this over raw fs for plugin assets.
         */
        readPluginText: function (relativePath) {
            if (schema.hasPathEscape(relativePath)) {
                throw new Error('[AquaStar:plugins] readPluginText path escapes plugin root');
            }
            const fs = require('fs');
            const full = path.resolve(options.pluginRoot, relativePath);
            const rootResolved = path.resolve(options.pluginRoot);
            const prefix = rootResolved.endsWith(path.sep) ? rootResolved : rootResolved + path.sep;
            if (full !== rootResolved && full.indexOf(prefix) !== 0) {
                throw new Error('[AquaStar:plugins] readPluginText escaped plugin root');
            }
            return fs.readFileSync(full, 'utf8');
        },

        /** Active app locale id (e.g. en-US). */
        getLocaleId: function () {
            try {
                const locale = require('../locale.js');
                if (typeof locale.getLang === 'function') return locale.getLang() || 'en-US';
                return 'en-US';
            } catch (e) {
                return 'en-US';
            }
        },

        /**
         * Merged locale strings for a namespace (plugin + platform).
         * Example: host.getLocaleStrings('dashboardMessages')
         */
        getLocaleStrings: function (namespace) {
            try {
                const locale = require('../locale.js');
                if (!namespace) return locale.strings || {};
                return (locale.strings && locale.strings[namespace]) || {};
            } catch (e) {
                return {};
            }
        },

        /** Absolute path to the app window icon (for feature BrowserWindows). */
        getAppIconPath: function () {
            try {
                return require('../const.js').iconPath;
            } catch (e) {
                return path.join(options.appRootPath || '', 'Icon', 'Icon_1024.png');
            }
        },

        registerSettingsSection: function (section) {
            if (!section || typeof section !== 'object') {
                throw new Error('[AquaStar:plugins] registerSettingsSection expects an object');
            }
            state.settingsSections.push(section);
        },

        ipc: {
            handle: function (channel, listener, opts) {
                const resolved = resolveChannel(channel, opts);
                state.ipcHandlers.push({ channel: resolved, listener: listener });
                if (typeof deps.ipcHandle === 'function') {
                    deps.ipcHandle(resolved, listener);
                }
            },
            on: function (channel, listener, opts) {
                const resolved = resolveChannel(channel, opts);
                state.ipcListeners.push({ channel: resolved, listener: listener });
                if (typeof deps.ipcOn === 'function') {
                    deps.ipcOn(resolved, listener);
                }
            },
            removeHandler: function (channel, opts) {
                const resolved = resolveChannel(channel, opts);
                state.ipcHandlers = state.ipcHandlers.filter(function (item) {
                    return item.channel !== resolved;
                });
                if (typeof deps.ipcRemoveHandler === 'function') {
                    deps.ipcRemoveHandler(resolved);
                }
            }
        },

        net: {
            fetchText: function (url, fetchOpts) {
                requirePermission('net.fetchText', 'net-fetch');
                if (!urlAllowedByFetchAllowlist(url)) {
                    return Promise.resolve({
                        ok: false,
                        error: 'URL not in fetchAllowlist'
                    });
                }
                if (typeof deps.fetchText === 'function') {
                    return deps.fetchText(url, fetchOpts);
                }
                return Promise.resolve({ ok: false, error: 'net.fetchText not wired' });
            }
        },

        /**
         * Game traffic (apiVersion 2). Reading it is a permission of its own, separate from
         * writing, because a read-only tool must not need write access: a plugin that only wants
         * the logger holds packet-tap and never touches packet-send.
         *
         * The listener is the platform's (res/platform/packet-tap.js): the relay hands its frames
         * to one tap and this subscribes to it, so subscribing twice, from two windows or from
         * two plugins, cannot produce a second listener or a doubled frame.
         */
        packets: {
            /**
             * Subscribe to every relayed frame in both directions. Only 'frame' is an event, and
             * it carries {id, direction, data} with the frame's NUL terminator already stripped.
             * Returns the release, so a window that closes - or a plugin that stops watching -
             * gives its subscription back.
             */
            on: function (event, listener) {
                requirePermission('packets.on', 'packet-tap');
                if (event !== 'frame') {
                    throw new Error('[AquaStar:plugins] packets.on knows one event, "frame" (got "' +
                        event + '")');
                }
                if (typeof listener !== 'function') {
                    throw new Error('[AquaStar:plugins] packets.on expects a listener function');
                }
                const tap = typeof deps.getPacketTap === 'function' ? deps.getPacketTap() : null;
                if (!tap || typeof tap.subscribe !== 'function') {
                    throw new Error('[AquaStar:plugins] the packet tap is not available in this app ' +
                        'session: game traffic is not being steered');
                }
                return tap.subscribe(listener);
            },

            /**
             * Write one frame back through the relay: {direction: 'toServer' | 'toClient',
             * text}. Needs packet-send, which is a different permission from packet-tap on
             * purpose - the logger reads and never writes.
             *
             * Returns whether the frame was written. False means there is no live connection to
             * write on (nothing steered yet, or the client is between connections); the frame is
             * neither queued nor invented, so a caller that must send says so to the user.
             */
            send: function (frame) {
                requirePermission('packets.send', 'packet-send');
                const candidate = frame || {};
                if (candidate.direction !== 'toServer' && candidate.direction !== 'toClient') {
                    throw new Error('[AquaStar:plugins] packets.send writes one of two directions, ' +
                        '"toServer" or "toClient" (got "' + candidate.direction + '")');
                }
                if (typeof candidate.text !== 'string' || !candidate.text.length) {
                    throw new Error('[AquaStar:plugins] packets.send expects the frame text');
                }
                const send = typeof deps.getPacketSender === 'function' ? deps.getPacketSender() : null;
                if (typeof send !== 'function') {
                    throw new Error('[AquaStar:plugins] this app session is not steering game ' +
                        'traffic, so there is no relay to write a frame through');
                }
                return send(candidate.direction, candidate.text) === true;
            }
        },

        windows: {
            openPrimaryGame: function (opts) {
                if (typeof deps.openPrimaryGame === 'function') {
                    return deps.openPrimaryGame(opts);
                }
                throw new Error('[AquaStar:plugins] windows.openPrimaryGame not wired');
            },
            openLaunch: function (launchId) {
                if (typeof deps.openLaunch === 'function') {
                    return deps.openLaunch(launchId);
                }
                throw new Error('[AquaStar:plugins] windows.openLaunch not wired');
            },
            openFeatureWindow: function (featureId) {
                if (typeof deps.openFeatureWindow === 'function') {
                    return deps.openFeatureWindow(featureId);
                }
                throw new Error('[AquaStar:plugins] windows.openFeatureWindow not wired');
            },
            openUrl: function (url, mode) {
                if (typeof deps.openUrl === 'function') {
                    return deps.openUrl(url, mode || 'new-window');
                }
                throw new Error('[AquaStar:plugins] windows.openUrl not wired');
            },
            openExternal: function (url) {
                if (typeof deps.openExternal === 'function') {
                    return deps.openExternal(url);
                }
                // Fallback for tests / unwired hosts
                try {
                    return require('electron').shell.openExternal(url);
                } catch (e) {
                    throw new Error('[AquaStar:plugins] windows.openExternal not wired');
                }
            },
            spawnHelperProcess: function (spawnOpts) {
                requirePermission('windows.spawnHelperProcess', 'spawn-helper-process');
                if (!spawnOpts || !spawnOpts.scriptRelativePath) {
                    throw new Error(
                        '[AquaStar:plugins] spawnHelperProcess requires scriptRelativePath'
                    );
                }
                const scriptPath = hostPathInsidePlugin(spawnOpts.scriptRelativePath);
                if (typeof deps.spawnHelperProcess === 'function') {
                    return deps.spawnHelperProcess({
                        scriptPath: scriptPath,
                        args: spawnOpts.args
                    });
                }
                return { scriptPath: scriptPath, stub: true };
            }
        },

        log: log,

        /** @internal test/PR2 inspection */
        _getState: function () { return state; }
    };

    return host;
}

module.exports = {
    createPluginHost: createPluginHost,
    PLATFORM_RESERVED_KEYBIND_IDS: PLATFORM_RESERVED_KEYBIND_IDS
};
