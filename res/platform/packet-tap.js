// The packet tap: one fan-out the platform's relay hands every frame it carries, so plugins that
// hold the packet-tap permission can read the game's traffic without owning a listener.
//
// The listener stays platform-owned on purpose. The relay notifies exactly one consumer - this
// tap - and subscribers come and go underneath it, which is what keeps a window that opens twice,
// or two windows at once, from producing doubled frames or a second listener.

// options: { onError(line) } - a subscriber that throws must not take the relay's data path with
// it, so the error is reported and the remaining subscribers still get the frame.
function createPacketTap(options) {
    options = options || {};
    const onError = typeof options.onError === 'function' ? options.onError : function () {};
    const listeners = [];

    function unsubscribe(listener) {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
    }

    return {
        /** Hand one relayed frame ({id, direction, data}) to every current subscriber. */
        emit: function (frame) {
            listeners.slice().forEach(function (listener) {
                try {
                    listener(frame);
                } catch (error) {
                    onError('a packet-tap subscriber threw (' +
                        (error && error.message ? error.message : error) + ')');
                }
            });
        },

        /**
         * Subscribe to every relayed frame in both directions. Returns the release. Subscribing
         * the same listener again is not a second subscription, so a window cannot double itself.
         */
        subscribe: function (listener) {
            if (typeof listener !== 'function') {
                throw new Error('[AquGrim:packets] the packet tap subscribes a function');
            }
            if (listeners.indexOf(listener) === -1) listeners.push(listener);
            return function off() { unsubscribe(listener); };
        },

        subscriberCount: function () { return listeners.length; }
    };
}

module.exports = {
    createPacketTap: createPacketTap
};
