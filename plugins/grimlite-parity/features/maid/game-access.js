// The one place the Maid asks the game for something. Every call is a loader helper the bridge's
// own surface implements (ticket #48) or a dot-path read through the same channel, and nothing here
// invents a value for a call that did not answer.
//
// The frames leave by the relay (host.packets.send, packet-send), which is the same single packet
// path the rest of the plugin uses (#27): the Maid's goto frame and its party-invitation answer
// both go through it, and a false answer is reported rather than queued.

const bridge = require('../../bridge.js');

function message(error) {
    return (error && error.message) || String(error);
}

/** The bridge hands a movie's own JSON string back; a value JSON cannot express arrives as text. */
function decode(answer) {
    if (typeof answer !== 'string' || answer === '') return answer;
    try {
        return JSON.parse(answer);
    } catch (error) {
        return answer;
    }
}

/**
 * @param {object} host the plugin Host
 */
function createMaidGameAccess(host) {
    const log = host && typeof host.log === 'function' ? function (msg) { host.log(msg); } : function () {};
    const channel = host && host.bridge;
    const packets = host && host.packets;
    const game = bridge.createGameAccess(host);
    let attached = false;

    function ensure() {
        if (!channel || typeof channel.call !== 'function') {
            return Promise.reject(new Error('this app has no game bridge channel'));
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

    return {
        /**
         * One loader helper, by the reference's own name. A refusal keeps the surface's own words
         * (it names the reason and the ticket that owns the name), which is what the loop reports.
         */
        loaderCall: function (name, args) {
            return ensure().then(function () {
                return game.loaderCall(name, args || []);
            });
        },

        /** One dot-path read, for a caller that needs a single field. */
        read: function (path) {
            return ensure().then(function () {
                return channel.call('getGameObject', [path]);
            }).then(function (result) {
                if (!result || !result.ok) {
                    return { value: null, error: (result && result.error) || 'the game did not answer' };
                }
                return { value: decode(result.value), error: null };
            }, function (error) {
                return { value: null, error: message(error) };
            });
        },

        /**
         * A raw frame to the server through the relay. False means nothing is steered right now;
         * that is reported to the caller rather than retried.
         */
        sendServerFrame: function (frame) {
            if (!packets || typeof packets.send !== 'function') {
                log('maid: there is no relay to write ' + frame + ' through');
                return false;
            }
            try {
                return packets.send({ direction: 'toServer', text: String(frame) }) === true;
            } catch (error) {
                log('maid: could not write a frame to the server: ' + message(error));
                return false;
            }
        },

        sleep: function (ms) {
            return new Promise(function (resolve) { setTimeout(resolve, ms); });
        }
    };
}

module.exports = {
    createMaidGameAccess: createMaidGameAccess
};
