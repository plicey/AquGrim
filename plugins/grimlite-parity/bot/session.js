// The narrow game interface the bot engine consumes (spec #19, Seam 4). One module, one shape:
// the engine talks to this and nothing else, and under test a plain object of the same shape
// satisfies it - which is what lets the whole loop be covered without Flash.
//
// THE INTERFACE. Every member returns a Promise. A read answers the value; a read that cannot be
// established *rejects* with the reason, so a caller can tell "no" from "cannot tell" - a
// distinction the reference never needs, because its own loader always answers.
//
//   signedIn()      -> boolean  a character is connected
//   alive()         -> boolean  that character is above 0 HP
//   username()      -> string   its name, for {PLAYERNAME}
//   ready()         -> boolean  the game can be driven (no reload in flight)
//   health()        -> number   current HP          healthMax() -> number
//   mana()          -> number   current MP          manaMax()   -> number
//   setSpawnPoint() -> void     stand at the respawn point, after a death
//   rest()          -> void     sit to restore HP/MP
//   exitCombat()    -> void     leave combat when the bot stops
//
// The state-reading statements (tickets #41, #42) widened it; these are #42's own, and every one
// of them is a loader name the surface answers except the target id, which is named where it is
// read below:
//
//   hasTarget()                  -> boolean  this character has a live target (HasTarget)
//   targetHealth()               -> number   that target's HP (GetTargetHealth)
//   targetId()                   -> number|null  its MonMapID, or null when nothing is targeted
//   state()                      -> number   Player.State: 0 Dead, 1 Idle, 2 InCombat (State)
//   selfId()                     -> number   this character's id, which aura frames are keyed by
//   selfAura(name)               -> number   tapped stack count of one aura on this character
//   targetAura(name)             -> number   the same for the current target
//   monsterAuraDuration(id, name)-> number   ms left of one aura on one monster, 0 for none
//   lastAnimationMessage()       -> string   the last anims[].msg the tap saw, lowercased
//   consumeAnimation()           -> void     clear it, which is what a matching statement does
//   close()                      -> void     give this window's tap subscription back
//
// The four aura reads are the tap's, not the game's: see bot/auras.js for where each number is
// derived from, and why the wire's seconds become milliseconds on the way in.
//
// A refusal that means *this window is gone* - rather than the game being busy or a path not
// resolving - carries `windowGone: true`. The engine ends that window's bot on it, and treats
// every other refusal as something to wait out; that is the difference between a closed window
// and a map that is still loading, and it is not a distinction a message can be parsed for.
//
// WHERE THE ANSWERS COME FROM. The reference reads this state through a loader it ships
// (`Loader/grimoire.swf`), which is a *renaming layer* over the stock game: each helper body is
// one or two reads and calls on `Root.Game...`, and the stock game does not carry those names.
// Ticket #48 read every one of those decompiled bodies and put the result in one table,
// `loader-surface.js` - one row per name, each row reaching the path or call that name's own body
// performs. So this module asks for the loader's own names through `bridge.loaderCall` rather
// than spelling the paths out again; a second copy of that table here would be free to drift from
// the first, and the first is the one with the decompiled source beside it.
//
// The names, and the row each one resolves to (loader-surface.js):
//
//   IsLoggedIn       sfc.isConnected          (Root.Game.sfc != null && sfc.isConnected)
//   Health/HealthMax world.myAvatar.dataLeaf.intHP / intHPMax   (IsAlive is Health > 0)
//   Mana/ManaMax     world.myAvatar.dataLeaf.intMP / intMPMax
//   SetSpawnPoint    world.setSpawnPoint(world.strFrame, world.strPad)
//   Rest             world.rest()
//   CancelTarget     world.cancelTarget(), twice, in the loader's own order
//   HasTarget        world.myAvatar.target.dataLeaf.intHP > 0
//   GetTargetHealth  world.myAvatar.target.dataLeaf.intHP
//   State            world.myAvatar.dataLeaf.intState
//   UserID           world.myAvatar.uid  - the id an aura frame's `p:` prefix is compared with
//
// TWO WANTS THE SURFACE DOES NOT ANSWER, and both for a real reason rather than an oversight, so
// neither is worked around by inventing a path here:
//
//   MapLoadComplete  the loader's body reads `world.mapLoadInProgress` *and then* inspects its own
//                    display list ("the top child is not the connection movie"), which is state
//                    ticket #41 owns. This module's `ready()` therefore reads the game's own
//                    `world.mapLoadInProgress` - the half a reload trips, and the half the engine's
//                    pause keys off - and says plainly that the display-list half is not checked.
//   GetUsername      the reference loader holds the login it captured from its own login form
//                    (Root.Username), not something it reads out of the game; ticket #35 owns it.
//                    This module reads the game's own `world.myAvatar.objData.strUsername` instead,
//                    which is the same name the loader itself assigns to that field (Player.as
//                    line 455), so `{PLAYERNAME}` still resolves to the character's name.

const PATHS = {
    // The two reads above, and nothing else: everything the surface answers goes through it.
    name: 'world.myAvatar.objData.strUsername',
    mapLoading: 'world.mapLoadInProgress',
    // Player.CurrentTargetId's own body exactly: Flash.GetGameObject(
    // "world.myAvatar.target.objData.MonMapID"). The loader registers no name for it, so unlike
    // every other read here there is nothing to ask by name - which is why it is written out, and
    // why it is written out once, here.
    targetId: 'world.myAvatar.target.objData.MonMapID'
};

// The loader's own translations, for the log and for tests: each name the reference calls, what
// this module asks for, and where the answer comes from.
const LOADER_BODIES = {
    IsLoggedIn: { helper: 'IsLoggedIn', body: 'Root.Game.sfc != null && Root.Game.sfc.isConnected == true' },
    Health: { helper: 'Health', body: 'myAvatar.dataLeaf.intHP' },
    HealthMax: { helper: 'HealthMax', body: 'myAvatar.dataLeaf.intHPMax' },
    Mana: { helper: 'Mana', body: 'myAvatar.dataLeaf.intMP' },
    ManaMax: { helper: 'ManaMax', body: 'myAvatar.dataLeaf.intMPMax' },
    SetSpawnPoint: { helper: 'SetSpawnPoint', body: 'world.setSpawnPoint(world.strFrame, world.strPad)' },
    Rest: { helper: 'Rest', body: 'world.rest()' },
    Logout: { helper: 'Logout', body: 'Root.Game.logout()' },
    CancelTarget: { helper: 'CancelTarget', body: 'world.cancelTarget() twice' },
    CancelAutoAttack: { helper: 'CancelAutoAttack', body: 'world.cancelAutoAttack()' },
    HasTarget: { helper: 'HasTarget', body: 'world.myAvatar.target.dataLeaf.intHP > 0' },
    GetTargetHealth: { helper: 'GetTargetHealth', body: 'world.myAvatar.target.dataLeaf.intHP' },
    State: { helper: 'State', body: 'world.myAvatar.dataLeaf.intState, cast to Player.State' },
    UserID: { helper: 'UserID', body: 'world.myAvatar.uid - the id an aura frame is keyed by' },
    // The whole aura state, and the one read that is not a loader name. Both recorded so a reader
    // can check this module against the reference rather than trusting it.
    AuraCache: {
        helper: 'GetAurasValue / AuraDuration',
        body: 'AuraManager.SelfAura and AuraManager.EnemyAura(MonMapID), filled from the frames ' +
            'Flash.cs ProcessPacketFromServer and ProcessPext read; the target id itself is ' +
            'Player.CurrentTargetId -> world.myAvatar.target.objData.MonMapID'
    },
    // Not on the surface: see the two named above.
    GetUsername: { path: PATHS.name, body: 'the game own objData.strUsername; the loader holds its own copy (ticket #35)' },
    MapLoadComplete: { path: PATHS.mapLoading, body: 'world.mapLoadInProgress == false; the display-list half is ticket #41' }
};

const ERRORS = {
    noChannel: 'this app has no game bridge channel'
};

// The platform's bridge channel says this when the window it was attached to is gone
// (res/platform/bridge-channel.js). It is the one refusal a bot must not wait out.
const WINDOW_GONE = /no game window|the game window went away/i;

function message(error) {
    return (error && error.message) || String(error);
}

/** A refusal, marked when it means the window itself is gone rather than the game being busy. */
function refusal(text) {
    const error = new Error(text);
    if (WINDOW_GONE.test(text)) error.windowGone = true;
    return error;
}

/** The bridge answers a JSON string, and its own error object for a path that did not resolve. */
function decode(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
}

/**
 * The session over the platform's bridge channel (`host.bridge.attach()` / `call`, #28).
 *
 * @param {object} deps
 * @param {object} deps.bridge host.bridge, or a stand-in with the same two methods
 * @param {(msg: string) => void} [deps.log]
 */
function createSession(deps) {
    deps = deps || {};
    const bridge = deps.bridge;
    const log = deps.log || function () {};

    // The tapped aura state (bot/auras.js). Subscribed once, when this session is made, so a frame
    // that arrives between two calls is not missed: the reference's cache is filled the same way,
    // by a handler registered for the session's whole life rather than around each read.
    const auras = require('./auras.js').createAuraStore();
    let tapFailure = null;
    let release = null;
    if (deps.packets && typeof deps.packets.on === 'function') {
        try {
            release = deps.packets.on('frame', function (frame) { auras.observe(frame); });
        } catch (error) {
            // A plugin without packet-tap, or an app session that is not steering traffic: the
            // reason is kept and handed to whoever asks for an aura, rather than swallowed - a
            // zero here would be indistinguishable from "the aura is gone".
            tapFailure = message(error);
        }
    } else {
        tapFailure = 'this session has no packet tap, so no aura state is being observed';
    }

    /** The tap, or a refusal naming what is missing. */
    function tapped() {
        if (tapFailure) throw refusal('auras come from the packet tap: ' + tapFailure);
        return auras;
    }

    async function attach() {
        if (!bridge) throw refusal(ERRORS.noChannel);
        const attached = await bridge.attach();
        if (!attached || attached.ok !== true) {
            throw refusal((attached && attached.error) || 'the game bridge did not attach');
        }
    }

    /** Read one dot-path of this module's own (the two the surface does not answer). */
    async function readPath(path) {
        await attach();
        const answer = await bridge.call('getGameObject', [path]);
        if (!answer || answer.ok !== true) {
            throw refusal((answer && answer.error) || ('the bridge did not answer ' + path));
        }
        const value = decode(answer.value);
        if (value && typeof value === 'object' && typeof value.error === 'string') {
            throw refusal(value.error);
        }
        return value;
    }

    /**
     * Ask the loader surface for one of the reference's own helper names. The surface owns the
     * loader body for that name (loader-surface.js, ticket #48), so nothing here re-derives a path
     * from it. A refusal - a name the surface does not implement, or the game refusing the read -
     * rejects with the reason, marked when it means the window is gone.
     */
    async function loaderCall(name, args) {
        // Attach first, for the same reason the raw reads do: the surface answers over the same
        // channel, and a channel that is not attached has no game window to ask.
        await attach();
        if (typeof bridge.loaderCall !== 'function') {
            throw refusal('this bridge does not expose the loader surface (ticket #48): ' + name);
        }
        try {
            return await bridge.loaderCall(name, args || []);
        } catch (error) {
            throw refusal(message(error));
        }
    }

    /**
     * A number a helper answered. A helper that answered nothing - null, undefined or an empty
     * string, which is what a walk over an avatar that is not in the world yields - is a refusal,
     * not a zero: reading it as 0 HP would look exactly like a death and send the bot down its
     * respawn branch over a reload.
     */
    function numberFrom(name, promise) {
        return promise.then(function (value) {
            if (value === null || value === undefined || value === '') {
                throw refusal(name + ' answered nothing, so the game has no number there yet');
            }
            const number = Number(value);
            if (!isFinite(number)) {
                throw refusal(name + ' is not a number the game answered (' +
                    JSON.stringify(value) + ')');
            }
            return number;
        });
    }

    const session = {
        /** Player.IsLoggedIn's own body: a live socket. A missing socket is a no, not an error. */
        signedIn: function () {
            return loaderCall('IsLoggedIn').then(function (value) {
                // The loader writes the game's own booleans as true/false; anything the game
                // answers that is not a live connection is a no, and a path that did not resolve
                // is a no too (walk answers null for a missing socket).
                return value === true || value === 1 || value === 'true';
            }, function (error) {
                if (error && error.windowGone === true) throw error;
                throw error;
            });
        },

        /** IsAlive is Health > 0, and Health is myAvatar.dataLeaf.intHP. */
        alive: function () {
            return numberFrom('Health', loaderCall('Health')).then(function (hp) { return hp > 0; });
        },

        username: function () {
            return readPath(PATHS.name).then(function (value) {
                return value === null || value === undefined ? '' : String(value);
            }, function (error) {
                // {PLAYERNAME} is a convenience inside a bot's own text: an unreadable name leaves
                // it empty and says so, rather than failing a run over it.
                log('the character name could not be read: ' + message(error));
                return '';
            });
        },

        /**
         * MapLoadComplete's first half, which is the half a reload trips. Its second half - "the
         * top child is not the connection movie" - reads the loader's own display list, which is
         * ticket #41's, so this answers on the part it can honestly answer on.
         */
        ready: function () {
            return readPath(PATHS.mapLoading).then(function (value) {
                // A missing flag means the map is not loading; anything else is the flag's value,
                // and the game writes it as a Boolean.
                return value !== true && value !== 1 && value !== 'true';
            }, function (error) {
                if (/no member /.test(message(error))) return true;
                throw error;
            });
        },

        health: function () { return numberFrom('Health', loaderCall('Health')); },
        healthMax: function () { return numberFrom('HealthMax', loaderCall('HealthMax')); },
        mana: function () { return numberFrom('Mana', loaderCall('Mana')); },
        manaMax: function () { return numberFrom('ManaMax', loaderCall('ManaMax')); },

        // Each of these is one row of the loader surface, asked for by the reference's own name.
        setSpawnPoint: function () { return loaderCall('SetSpawnPoint'); },
        rest: function () { return loaderCall('Rest'); },
        exitCombat: function () { return loaderCall('CancelTarget'); },

        /** Player.HasTarget: the loader's own helper, which is intHP > 0 on the target. */
        hasTarget: function () {
            return loaderCall('HasTarget').then(function (value) {
                return value === true || value === 1 || value === 'true';
            });
        },

        /** Player.GetTargetHealth: GetTargetHealth through the loader surface. */
        targetHealth: function () { return numberFrom('GetTargetHealth', loaderCall('GetTargetHealth')); },

        /** Player.CurrentState: the loader's State, whose 2 is Player.State.InCombat. */
        state: function () { return numberFrom('State', loaderCall('State')); },

        /**
         * Player.CurrentTargetId, and the one read the loader registers no name for, so it is
         * this module's own path (PATHS.targetId, Player.cs line 240 exactly).
         *
         * Nothing targeted answers null rather than 0: a walk over an absent target gives null,
         * and 0 is a MonMapID a monster could have, so reading it as a number would key the aura
         * cache on a monster that is not there. A value that is not a number is a refusal.
         */
        targetId: function () {
            return readPath(PATHS.targetId).then(function (value) {
                if (value === null || value === undefined) return null;
                const number = Number(value);
                if (!isFinite(number)) {
                    throw refusal('CurrentTargetId is not a number the game answered (' +
                        JSON.stringify(value) + ')');
                }
                return number;
            });
        },

        /**
         * The loader's UserID: the id an aura frame's `p:` prefix is compared with, and the one
         * piece of the aura cache's own key that is not on the wire. Read here and handed to the
         * cache, so a `p:` frame for anybody else is dropped rather than kept under a key nothing
         * will ever look up.
         */
        selfId: async function () {
            const id = await numberFrom('UserID', loaderCall('UserID'));
            // A session with no tap has no cache to key, and that gap is the aura reads' refusal
            // to make rather than this one's: the id itself was read all the same.
            if (!tapFailure) auras.setSelf('p:' + id);
            return id;
        },

        /**
         * Player.GetAuras(true, name) for a name outside its own "locked" special case: the tapped
         * cache's value, in stacks (auras.js). A tap that is not there is a refusal naming what is
         * missing, never a zero - zero is what "the stack is gone" reads as.
         */
        selfAura: async function (name) {
            const store = tapped();
            const id = await session.selfId();
            return store.value('p:' + id, name);
        },

        /**
         * Player.GetAuras(false, name) - the target's stacks, from the same cache, keyed by the
         * target's own MonMapID. With nothing targeted the answer is 0, which is exactly what the
         * reference's GetAurasValue returns in that case rather than an error.
         */
        targetAura: async function (name) {
            const store = tapped();
            if (!(await session.hasTarget())) return 0;
            const id = await session.targetId();
            if (id === null || id === undefined) return 0;
            return store.value('m:' + id, name);
        },

        /**
         * AuraManager.EnemyAura(id).GetRemainingTime(name), in milliseconds-removed: the monster's
         * own id is the statement's targetId field, so it is handed in rather than read here.
         */
        monsterAuraDuration: async function (id, name) {
            return tapped().remaining('m:' + id, name);
        },

        /** Configuration.LastAnimationMessage, which the tap's anims handler fills (auras.js). */
        lastAnimationMessage: async function () { return tapped().lastAnimationMessage(); },
        consumeAnimation: async function () { tapped().consumeAnimation(); },

        /**
         * Give this window's tap subscription back. The bot is per window and its subscription
         * outlives every call on it, so the window's own close is where it is released - a
         * subscription that is never released is the leak the platform's release return exists
         * to prevent.
         */
        close: async function () {
            if (typeof release === 'function') {
                const off = release;
                release = null;
                off();
            }
        },

        /** The loader's bodies, exposed so the window and the tests can name their source. */
        bodies: function () { return LOADER_BODIES; }
    };

    return session;
}

module.exports = {
    createSession: createSession,
    PATHS: PATHS,
    LOADER_BODIES: LOADER_BODIES,
    ERRORS: ERRORS
};
