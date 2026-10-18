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
// A refusal that means *this window is gone* - rather than the game being busy or a path not
// resolving - carries `windowGone: true`. The engine ends that window's bot on it, and treats
// every other refusal as something to wait out; that is the difference between a closed window
// and a map that is still loading, and it is not a distinction a message can be parsed for.
//
// WHERE THE PATHS COME FROM. The reference reads this state through a loader it ships
// (`Loader/grimoire.swf`), which is a *renaming layer* over the stock game: each helper body is
// one or two reads on `Root.Game...`. Its decompiled source is the authority for every path below
// and was read for each one (grimoire/game/Player.as, grimoire/game/World.as):
//
//   IsLoggedIn   Root.Game.sfc.isConnected == true
//   State        Root.Game.world.myAvatar.dataLeaf.intState
//   Health       Root.Game.world.myAvatar.dataLeaf.intHP        (IsAlive is Health > 0)
//   HealthMax    Root.Game.world.myAvatar.dataLeaf.intHPMax
//   Mana/ManaMax Root.Game.world.myAvatar.dataLeaf.intMP / intMPMax
//   MapLoadComplete  Root.Game.world.mapLoadInProgress is False, and the top child is not the
//                    connection movie
//   SetSpawnPoint    Root.Game.world.setSpawnPoint(world.strFrame, world.strPad)
//   Rest             Root.Game.world.rest()
//   Logout           Root.Game.logout()
//
// Those are game paths and game calls, so the bridge (#28) reaches every one of them with its
// generic getGameObject/callGameFunction pair - which is what this module uses. It does not call
// the loader's own names (`IsLoggedIn`, `State`, `Health`...): those are registered only inside
// the reference's loader, and #29's table in docs/FLASH_CHECKLIST.md is the check that the stock
// game does not answer them (exact ABC pool entry plus a multiname reference).
//
// The one thing the loader says that a dot-path cannot express is MapLoadComplete's second half,
// "the top child is not the connection movie"; `mapLoadInProgress` is the part that covers a
// reload, and it is the part the engine's pause keys off.

const PATHS = {
    // sfc is the socket and isConnected is what the loader's IsLoggedIn tests. It hangs off the
    // game root (Root.Game.sfc), not off world - the bridge's paths are rooted at that same
    // object, so this is `sfc.isConnected` and not `world.sfc.isConnected`. Read as one path: the
    // bridge's walk answers null for a missing parent, so this single read is the loader's whole
    // condition (`sfc != null && sfc.isConnected == true`) without serialising the socket itself.
    socket: 'sfc.isConnected',
    avatar: 'world.myAvatar',
    hp: 'world.myAvatar.dataLeaf.intHP',
    hpMax: 'world.myAvatar.dataLeaf.intHPMax',
    mp: 'world.myAvatar.dataLeaf.intMP',
    mpMax: 'world.myAvatar.dataLeaf.intMPMax',
    name: 'world.myAvatar.objData.strUsername',
    mapLoading: 'world.mapLoadInProgress'
};

// The loader's own translations, for the log and for tests: each name the reference calls, and
// the game path or call the loader's body actually performs.
const LOADER_BODIES = {
    IsLoggedIn: { path: PATHS.socket, body: 'Root.Game.sfc != null && Root.Game.sfc.isConnected == true' },
    State: { path: 'world.myAvatar.dataLeaf.intState', body: 'myAvatar.dataLeaf.intState' },
    Health: { path: PATHS.hp, body: 'myAvatar.dataLeaf.intHP' },
    HealthMax: { path: PATHS.hpMax, body: 'myAvatar.dataLeaf.intHPMax' },
    Mana: { path: PATHS.mp, body: 'myAvatar.dataLeaf.intMP' },
    ManaMax: { path: PATHS.mpMax, body: 'myAvatar.dataLeaf.intMPMax' },
    SetSpawnPoint: { call: 'world.setSpawnPoint', body: 'world.setSpawnPoint(world.strFrame, world.strPad)' },
    Rest: { call: 'world.rest', body: 'world.rest()' },
    Logout: { call: 'world.logout', body: 'Root.Game.logout()' },
    CancelTarget: { call: 'world.cancelTarget', body: 'world.cancelTarget()' },
    CancelAutoAttack: { call: 'world.cancelAutoAttack', body: 'world.cancelAutoAttack()' },
    MapLoadComplete: { path: PATHS.mapLoading, body: 'world.mapLoadInProgress == false' }
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

    async function attach() {
        if (!bridge) throw refusal(ERRORS.noChannel);
        const attached = await bridge.attach();
        if (!attached || attached.ok !== true) {
            throw refusal((attached && attached.error) || 'the game bridge did not attach');
        }
    }

    /** Read one dot-path. A refusal rejects; nothing here answers with a default. */
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

    /** Call one game function by the path the loader's body calls. */
    async function callPath(path, args) {
        await attach();
        const list = args || [];
        const name = list.length ? 'callGameFunction' : 'callGameFunction0';
        const answer = await bridge.call(name, [path].concat(list));
        if (!answer || answer.ok !== true) {
            throw refusal((answer && answer.error) || ('the bridge could not call ' + path));
        }
        const value = decode(answer.value);
        if (value && typeof value === 'object' && typeof value.error === 'string') {
            throw refusal(value.error);
        }
        return value;
    }

    /**
     * A number at a path. A path that did not resolve answers null - the avatar is not in the
     * world yet, or the game is between maps - and that is a refusal, not a zero: reading it as 0
     * HP would look exactly like a death and send the bot down its respawn branch over a reload.
     */
    function numberPath(path) {
        return readPath(path).then(function (value) {
            if (value === null || value === undefined || value === '') {
                throw refusal(path + ' did not resolve, so the game has no number there yet');
            }
            const number = Number(value);
            if (!isFinite(number)) {
                throw refusal(path + ' is not a number the game answered (' +
                    JSON.stringify(value) + ')');
            }
            return number;
        });
    }

    const session = {
        /** Playable.isLoggedIn's own body: a live socket. A missing socket path is a no. */
        signedIn: function () {
            return readPath(PATHS.socket).then(function (value) {
                // The loader writes the game's own booleans as true/false; anything the game
                // answers that is not a live connection is a no, and a path that did not resolve
                // is a no too (walk answers null for a missing socket).
                return value === true || value === 1 || value === 'true';
            }, function (error) {
                if (error && error.windowGone === true) throw error;
                if (/no member /.test(message(error))) return false;
                throw error;
            });
        },

        /** IsAlive is Health > 0, and Health is myAvatar.dataLeaf.intHP. */
        alive: function () { return numberPath(PATHS.hp).then(function (hp) { return hp > 0; }); },

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

        /** MapLoadComplete's first half, which is the half a reload trips. */
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

        health: function () { return numberPath(PATHS.hp); },
        healthMax: function () { return numberPath(PATHS.hpMax); },
        mana: function () { return numberPath(PATHS.mp); },
        manaMax: function () { return numberPath(PATHS.mpMax); },

        // Each of these is the loader's own body, translated.
        setSpawnPoint: function () { return callPath(LOADER_BODIES.SetSpawnPoint.call, []); },
        rest: function () { return callPath(LOADER_BODIES.Rest.call, []); },
        exitCombat: function () { return callPath(LOADER_BODIES.CancelTarget.call, []); },

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
