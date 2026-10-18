// The option toggles and the hotkeys call the game by the reference's own name, which is a want
// the plugin's one named-call adapter (bridge.js, ticket #29) does not expose: that module answers
// readInventory / readBankSlots / transferToBank / equipItem, the four things the Bank and Sets
// windows ask for. This is the same resolution for a different want, kept beside the feature that
// needs it, and it reuses bridge.js's own explanation so a refusal reads the same wherever it is
// asked from.
//
// Which names these are is checked, not guessed. Every call below was checked by exact token
// match (the string pool) against the decompressed stock game SWF at /var/tmp/aq-origin/game.swf
// and against the reference's own loader at /var/tmp/grimlite-src/Loader/grimoire.swf:
//
//   name                  game  loader
//   SetInfiniteRange       -     yes
//   SetProvokeMonsters     -     yes
//   SetEnemyMagnet         -     yes
//   SetLagKiller           -     yes
//   DestroyPlayers         -     yes
//   SetSkipCutscenes       -     yes
//   SetWalkSpeed           -     yes
//   CancelTarget           -     yes      (the game has lowercase cancelTarget, an internal)
//   LoadHairShop           -     yes      (the game has lowercase loadHairShop, an internal)
//   LoadArmorCustomizer    -     yes      (the game has lowercase openArmorCustomize)
//
// A name absent from the game's pool entirely has no multiname that could reference it, so the
// two-condition test bridge.js documents settles all ten at once: these are loader-only. The
// lowercase cousins are the trap a substring search falls into - they match "Cancel" and "Hair"
// by accident and are different members with different signatures. Nothing here substitutes one
// for the other.
//
// What loader-only does NOT mean is "cannot be done". The loader is a renaming layer: its own
// decompiled bodies (see LOADER_ROUTE below) show each of these names standing for reads, writes
// and calls on game paths that the generic callbacks reach. So the port sends the reference's name
// first, and when the game answers that it has no such member it does what the loader's body does.
// Only DestroyPlayers, whose body enumerates a map no generic callback can enumerate, is left with
// nothing to send; that one says so in full (see NO_ROUTE).
//
// The bridge hands back the movie's own reply as a JSON string, and a name the loaded movie does
// not implement comes back as {"error":"..."} rather than as a value. A refusal is never reported
// as success, and never swallowed.

const { ERRORS: BRIDGE_ERRORS } = require('./bridge.js');

// The names this module calls that the reference loader provides and the stock game does not.
// bridge.js keeps its own list for the names *it* calls; this is the list for these calls, so the
// two modules together say what the bridge still owes without either claiming the other's.
const LOADER_ONLY = {
    SetInfiniteRange: true,
    SetProvokeMonsters: true,
    SetEnemyMagnet: true,
    SetLagKiller: true,
    DestroyPlayers: true,
    SetSkipCutscenes: true,
    SetWalkSpeed: true,
    CancelTarget: true,
    LoadHairShop: true,
    LoadArmorCustomizer: true
};

// How many times SetSkipCutscenes will empty the external movie before giving up. The loader's own
// body is a while loop with no bound; against a live movie a child that will not come out would
// spin the app, so the port stops and says so instead.
const CUTSCENE_TRIES = 100;

// The reference client's loader is a RENAMING LAYER, not a second implementation: each of the ten
// names above has a body in it that reads and calls paths the stock game does carry. Its own
// decompiled bodies (Grimoire/game/Settings.as, Player.as, Shops.as) are transcribed below, so a
// name the game cannot answer still does what the reference does - through the generic callbacks
// the bridge does expose - instead of doing nothing at all.
//
// Order matters: the reference's own name is always asked for first, and a route runs only when
// the game answered that it has no such member. The day the bridge implements the loader's surface
// the game's own answer wins and these routes simply stop being reached.
//
// The step helper is what a route is handed: get(path), set(path, value), call(path, args),
// call0(path). A route that throws is reported as a failure, never as success.
const LOADER_ROUTE = {
    // Settings.as:SetInfiniteRange - while i <= 5, world.actions.active[i].range = 20000.
    SetInfiniteRange: async function (g) {
        for (let i = 0; i <= 5; i++) {
            await g.set('world.actions.active.' + i + '.range', 20000);
        }
    },

    // Settings.as:SetProvokeMonsters - world.aggroAllMon().
    SetProvokeMonsters: function (g) {
        return g.call0('world.aggroAllMon');
    },

    // Settings.as:SetEnemyMagnet - the target's own movie is put where the player's is, and only
    // where there IS a target: the loader's body is guarded by a null test.
    SetEnemyMagnet: async function (g) {
        const target = await g.get('world.myAvatar.target');
        if (target == null) return null;
        const x = await g.get('world.myAvatar.pMC.x');
        const y = await g.get('world.myAvatar.pMC.y');
        await g.set('world.myAvatar.target.pMC.x', x);
        await g.set('world.myAvatar.target.pMC.y', y);
        return null;
    },

    // Settings.as:SetLagKiller - world.visible = (param1 == "False"). The argument is the
    // reference's own string, so "True" hides the game movie (visible = false), which is what lag
    // killing is; "False" shows it again. The comparison is the loader's own, not its inverse.
    SetLagKiller: function (g, args) {
        return g.set('world.visible', String(args[0]) === 'False');
    },

    // Settings.as:SetWalkSpeed - world.WALKSPEED = parseInt(param1).
    SetWalkSpeed: function (g, args) {
        return g.set('world.WALKSPEED', parseInt(String(args[0]), 10));
    },

    // Settings.as:SetSkipCutscenes - empty the external movie, show the game, show its interface.
    SetSkipCutscenes: async function (g) {
        for (let tries = 0; tries < CUTSCENE_TRIES; tries++) {
            const children = await g.get('mcExtSWF.numChildren');
            if (!children) break;
            await g.call('mcExtSWF.removeChildAt', [0]);
            if (tries === CUTSCENE_TRIES - 1) {
                throw new Error('mcExtSWF still had children after ' + CUTSCENE_TRIES +
                    ' tries, so this cutscene could not be cleared');
            }
        }
        await g.set('world.visible', true);
        return g.call0('showInterface');
    },

    // Player.as:CancelTarget - world.cancelTarget() twice, in that order.
    CancelTarget: async function (g) {
        await g.call0('world.cancelTarget');
        return g.call0('world.cancelTarget');
    },

    // Shops.as:LoadHairShop - world.sendLoadHairShopRequest(parseInt(param1)).
    LoadHairShop: function (g, args) {
        return g.call('world.sendLoadHairShopRequest', [parseInt(String(args[0]), 10)]);
    },

    // Shops.as:LoadArmorCustomizer - Root.Game.openArmorCustomize().
    LoadArmorCustomizer: function (g) {
        return g.call0('openArmorCustomize');
    }
};

// The one name with a body but no route. Settings.as:DestroyPlayers walks world.avatars and
// destroys every entry that is not the player's own - a map whose keys the caller does not know in
// advance and cannot learn from a child count, an array length or any other path the generic
// surface can read. Reading and writing named paths cannot enumerate it, so there is nothing
// honest to send and the refusal says exactly why rather than guessing at a name.
const NO_ROUTE = {
    DestroyPlayers: 'the loader walks every entry of world.avatars and destroys the ones that are ' +
        'not the player\'s own, and the generic callbacks can only read and write paths that are ' +
        'named in advance - they cannot enumerate that map, so there is no route to send here'
};

/**
 * The game's own "no member X at world" means X is not part of its surface. When X is one of the
 * reference loader's names, say so in the same words bridge.js uses, so the two paths cannot
 * disagree about why a call failed.
 */
function explain(name, error) {
    const message = (error && error.message) || String(error);
    if (LOADER_ONLY[name] && message.indexOf('no member ' + name) === 0) {
        return { ok: false, error: message + ' - ' + BRIDGE_ERRORS.loaderSurface(name) };
    }
    return { ok: false, error: message };
}

/**
 * Turn one bridge answer into a result a feature can show.
 * @param {string} text the movie's reply, as the bridge received it
 * @returns {{ok: true, value: any} | {ok: false, error: string}}
 */
function unwrap(text) {
    if (text == null) return { ok: true, value: null };
    const raw = String(text);
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        // Not JSON at all: the movie answered something this port cannot read, which is not the
        // same as "it worked".
        return { ok: false, error: 'the game answered something that is not JSON: ' + raw.slice(0, 120) };
    }
    if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string' && parsed.error) {
        return { ok: false, error: parsed.error };
    }
    return { ok: true, value: parsed === undefined ? null : parsed };
}

/**
 * The named-call surface the option toggles and the hotkeys use. A missing bridge is an error the
 * caller can show, not a crash.
 *
 * @param {object} opts
 * @param {object} opts.bridge `host.bridge` (attach/call)
 * @param {(msg: string) => void} [opts.log]
 */
function createGameCalls(opts) {
    opts = opts || {};
    const bridge = opts.bridge;
    const log = typeof opts.log === 'function' ? opts.log : function () {};
    const bridgeCall = opts.bridgeCall || function (name, args) {
        if (!bridge || typeof bridge.call !== 'function') {
            return Promise.resolve({ ok: false, error: 'no game bridge in this build' });
        }
        return bridge.call(name, args);
    };

    /** One step of a route, in the shape a route's body takes. */
    function step() {
        function send(callback, args) {
            return bridgeCall(callback, args).then(function (answer) {
                if (!answer || answer.ok === false) {
                    throw new Error((answer && answer.error) || 'the bridge answered nothing');
                }
                const result = unwrap(answer.value);
                if (!result.ok) throw new Error(result.error);
                return result.value;
            });
        }
        return {
            get: function (path) { return send('getGameObject', [path]); },
            set: function (path, value) { return send('setGameObject', [path, value]); },
            call: function (path, args) { return send('callGameFunction', [path].concat(args || [])); },
            call0: function (path) { return send('callGameFunction0', [path]); }
        };
    }

    /** Is this the game saying it has no such member at all? */
    function missingMember(name, error) {
        const message = (error && error.message) || String(error);
        return message.indexOf('no member ' + name) === 0;
    }

    return {
        unwrap: unwrap,

        /** Attach if needed, then call a bridge callback. Never rejects. */
        call: async function (name, args) {
            if (bridge && typeof bridge.attach === 'function') {
                let attached;
                try {
                    attached = await bridge.attach();
                } catch (error) {
                    attached = { ok: false, error: error && error.message ? error.message : String(error) };
                }
                if (attached && attached.ok === false) return attached;
            }
            let answer;
            try {
                answer = await bridgeCall(name, Array.isArray(args) ? args : []);
            } catch (error) {
                return { ok: false, error: error && error.message ? error.message : String(error) };
            }
            if (!answer || answer.ok === false) {
                return { ok: false, error: (answer && answer.error) || 'the bridge answered nothing' };
            }
            const result = unwrap(answer.value);
            if (result.ok) return result;
            // The call name is the second argument of callGameFunction*: that is the game member
            // this asked for, and the one a loader-only explanation is about.
            const asked = Array.isArray(args) && args.length ? args[0] : name;

            // The game has no such member. Where the reference's own loader has a body for this
            // name, do what that body does, through the generic callbacks. A refusal because the
            // game could not do something else is NOT the same thing and never reaches here.
            const routeFn = LOADER_ROUTE[asked];
            if (routeFn && missingMember(asked, result.error)) {
                let routed;
                try {
                    routed = await routeFn(step(), Array.isArray(args) ? args.slice(1) : []);
                } catch (error) {
                    // Both halves are reported: the reason the reference's own name was not used,
                    // and what went wrong on the way the reference's loader does it instead.
                    const why = explain(asked, result.error);
                    return {
                        ok: false,
                        error: why.error + ' - and the game\'s own route to it failed: ' +
                            ((error && error.message) || String(error))
                    };
                }
                log(asked + ' is not in the game; used the reference loader\'s own route instead');
                return { ok: true, value: routed === undefined ? null : routed, via: 'route' };
            }

            const refused = explain(asked, result.error);
            if (NO_ROUTE[asked] && missingMember(asked, result.error)) {
                return { ok: false, error: refused.error + ' - ' + NO_ROUTE[asked] };
            }
            log(asked + ' refused: ' + refused.error);
            return refused;
        }
    };
}

module.exports = {
    createGameCalls: createGameCalls,
    unwrap: unwrap,
    explain: explain,
    LOADER_ONLY: LOADER_ONLY,
    LOADER_ROUTE: LOADER_ROUTE,
    NO_ROUTE: NO_ROUTE
};
