// The one place this window asks the game for something. Every call is a name the stock AQW SWF
// was verified to carry, not a name from the reference's own loader: the loader's GetEquip/SetEquip
// exist only in Loader/grimoire.swf, which no AquaGrim user loads, while the game itself carries
// world.uoTree, objData.eqp (its own wear store, keyed by the slot codes CosmeticEquipment._cosMap
// also uses) and world.myAvatar.loadMovieAtES, the game's "load a movie at this equip slot".
//
// The write is the reference's own line, the one it keeps commented out beside its loader call:
// CallGameFunction("world.myAvatar.loadMovieAtES", slot, SWFFile, Link).
//
// The bridge is injected, so every feature that reads the game can be tested without Flash. Its
// two members are the platform's Host API (res/platform/plugin-host.js: host.bridge.attach/call).

/**
 * @param {object} deps
 * @param {object} deps.bridge host.bridge, or a stand-in with the same two methods
 * @param {(msg: string) => void} [deps.log]
 */
function createGameAccess(deps) {
    deps = deps || {};
    const bridge = deps.bridge;
    const log = deps.log || function () {};

    function message(error) {
        return (error && error.message) || String(error);
    }

    /** Attach, then read a dot-path. A refusal anywhere is a value, never a throw. */
    async function read(path) {
        if (!bridge) return { value: null, error: 'the game bridge is not available' };
        let attached;
        try {
            attached = await bridge.attach();
        } catch (error) {
            return { value: null, error: message(error) };
        }
        if (!attached || !attached.ok) {
            return { value: null, error: (attached && attached.error) || 'the bridge did not attach' };
        }
        let answer;
        try {
            answer = await bridge.call('getGameObject', [path]);
        } catch (error) {
            return { value: null, error: message(error) };
        }
        if (!answer || !answer.ok) {
            // The bridge reports a name the game does not have as an error, and that is the honest
            // answer here: a read that failed is not an empty result.
            log('cosmetics: reading ' + path + ' failed: ' + ((answer && answer.error) || 'no answer'));
            return { value: null, error: (answer && answer.error) || 'the game did not answer' };
        }
        return { value: decode(answer.value), error: null };
    }

    // The bridge hands back the movie's own JSON string (AquaBridge.as toJson), and its error
    // object for a path that threw. A caller that wants the difference reads the error it got.
    function decode(value) {
        if (typeof value !== 'string') return value === undefined ? null : value;
        try {
            return JSON.parse(value);
        } catch (error) {
            return value;
        }
    }

    return {
        /** The room's players, as the picker's rows. */
        readPlayers: async function () {
            const read1 = await read('world.uoTree');
            if (read1.error) return { players: [], error: read1.error };
            return { players: require('./cosmetics.js').playerRows(read1.value), error: null };
        },

        /** One player's wear, as the game's own equip store holds it. */
        readWear: async function (id) {
            const read1 = await read('world.uoTree.' + id + '.objData.eqp');
            if (read1.error) return { wear: null, error: read1.error };
            const wear = read1.value;
            if (!wear || typeof wear !== 'object' || Array.isArray(wear)) {
                return { wear: null, error: null };
            }
            return { wear: wear, error: null };
        },

        /**
         * Set one slot. The reference sends its loader a link it has stripped of ".swf"/"_skin"
         * (ReplaceLink, Extensions.cs:33) and a file name it has not; the game's own loadMovieAtES
         * is named for the pair as the wear store carries it, so both go as written.
         */
        setSlot: async function (code, file, link) {
            if (!bridge) return { ok: false, error: 'the game bridge is not available' };
            const args = ['world.myAvatar.loadMovieAtES', code, String(file == null ? '' : file),
                String(link == null ? '' : link)];
            let attached;
            try {
                attached = await bridge.attach();
            } catch (error) {
                return { ok: false, error: message(error) };
            }
            if (!attached || !attached.ok) {
                return { ok: false, error: (attached && attached.error) || 'the bridge did not attach' };
            }
            let answer;
            try {
                answer = await bridge.call('callGameFunction', args);
            } catch (error) {
                return { ok: false, error: message(error) };
            }
            if (!answer || !answer.ok) {
                return { ok: false, error: (answer && answer.error) || 'the game did not answer' };
            }
            // A call the movie itself refused comes back as its error object, not a thrown error.
            const value = decode(answer.value);
            if (value && typeof value === 'object' && value.error) {
                return { ok: false, error: message(value.error) };
            }
            return { ok: true, error: null };
        }
    };
}

module.exports = {
    createGameAccess: createGameAccess
};
