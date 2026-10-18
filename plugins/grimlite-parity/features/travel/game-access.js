// The one place this window asks the game for something. Every call is either a loader helper the
// bridge's own surface implements (ticket #48) or a dot-path read through the same channel, and
// nothing here invents a value for a call that did not answer.
//
// Why the loader names and not the game's: the reference calls its own loader, so Join, Jump,
// LoadShop, LoadQuest and LoadQuests are names this port asks for by the reference's own name and
// lets the surface resolve to the game path the loader's body reads. That is what keeps the two
// from drifting, and it is why a name the surface does not implement still refuses with the reason
// rather than with a bare "no member".
//
// Frames leave by two doors, and which one is used is the reference's own choice, not a
// convenience here:
//   * sendClientFrame is the bridge's sendClientPacket - a frame handed to the client as if the
//     server had sent it, which is how the reference fakes quest progress;
//   * sendServerFrame is the platform's relay (host.packets.send, packet-send), which is where the
//     reference writes its raw XT frame (Proxy.SendToServer -> Flash.SendPacket).

const UNCHANNELLED = 'this app has no game bridge channel';

/**
 * @param {object} host the plugin Host
 */
function createGameAccess(host) {
    const log = host && typeof host.log === 'function' ? function (msg) { host.log(msg); } : function () {};
    const channel = host && host.bridge;
    const packets = host && host.packets;
    const bridge = require('../../bridge.js');
    // The typed surface, from the plugin's own adapter rather than from the raw channel: it is
    // where a loader name resolves to the path that name's body reads.
    const game = bridge.createGameAccess(host);
    let attached = false;

    /** Attach once, and retry after a failure: the game window may open later, or reopen. */
    function ensure() {
        if (!channel || typeof channel.call !== 'function') {
            return Promise.reject(new Error(UNCHANNELLED));
        }
        if (attached) return Promise.resolve();
        if (typeof channel.attach !== 'function') {
            attached = true;
            return Promise.resolve();
        }
        return Promise.resolve(channel.attach()).then(function (result) {
            if (!result || !result.ok) {
                throw new Error((result && result.error) || 'the game bridge did not attach');
            }
            attached = true;
        });
    }

    /** A loader helper, by the reference's own name. A refusal names the helper and its reason. */
    function loaderCall(name, args) {
        return ensure().then(function () {
            return game.loaderCall(name, args || []);
        });
    }

    /** Read a dot-path. A refusal is a value the window shows, never a silent null. */
    function read(path) {
        return ensure().then(function () {
            return channel.call('getGameObject', [path]);
        }).then(function (result) {
            if (!result || !result.ok) {
                return { value: null, error: (result && result.error) || 'the game did not answer' };
            }
            return { value: decode(result.value), error: null };
        }, function (error) {
            return { value: null, error: (error && error.message) || String(error) };
        });
    }

    /** Write a dot-path. */
    function write(path, value) {
        return ensure().then(function () {
            return channel.call('setGameObject', [path, value]);
        }).then(function (result) {
            if (!result || !result.ok) {
                return { ok: false, error: (result && result.error) || 'the game did not answer' };
            }
            const written = decode(result.value);
            if (written && typeof written === 'object' && written.error) {
                return { ok: false, error: written.error };
            }
            return { ok: true, error: null };
        }, function (error) {
            return { ok: false, error: (error && error.message) || String(error) };
        });
    }

    // The bridge hands a movie's own JSON string back, and its error object for a path that threw.
    function decode(value) {
        if (typeof value !== 'string') return value === undefined ? null : value;
        try {
            return JSON.parse(value);
        } catch (error) {
            return value;
        }
    }

    function sleep(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    return {
        loaderCall: loaderCall,
        read: read,
        write: write,
        sleep: sleep,

        /** A frame handed to the client as if the server had sent it (sendClientPacket). */
        sendClientFrame: function (packet, type) {
            return ensure().then(function () {
                return channel.call('sendClientPacket', [String(packet), String(type || 'str')]);
            }).then(function (result) {
                if (!result || !result.ok) {
                    return { ok: false, error: (result && result.error) || 'the bridge did not answer' };
                }
                const answer = decode(result.value);
                if (answer && typeof answer === 'object' && answer.error) {
                    return { ok: false, error: answer.error };
                }
                return { ok: true, error: null };
            }, function (error) {
                return { ok: false, error: (error && error.message) || String(error) };
            });
        },

        /**
         * A raw frame written to the server through the relay (host.packets.send). The platform
         * answers whether it was written: false means nothing is steered right now, and that is
         * reported rather than retried, because the frame is neither queued nor invented.
         */
        sendServerFrame: function (packet) {
            if (!packets || typeof packets.send !== 'function') {
                log('travel: no relay to write ' + packet + ' through');
                return Promise.resolve(false);
            }
            try {
                return Promise.resolve(packets.send({ direction: 'toServer', text: String(packet) }) === true);
            } catch (error) {
                log('travel: could not write a frame to the server: ' +
                    ((error && error.message) || error));
                return Promise.resolve(false);
            }
        }
    };
}

module.exports = {
    createGameAccess: createGameAccess,
    UNCHANNELLED: UNCHANNELLED
};

