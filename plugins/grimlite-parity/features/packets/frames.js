// The logger's half of the tap: one subscription shared by every window that is watching, plus
// the two pure pieces the window needs (frame text, and the filter).
//
// The platform owns the listener (res/platform/packet-tap.js) and hands frames over; this keeps
// the windows that display them. Start adds a window, Stop removes it, and the subscription is
// taken when the first window watches and released when the last one stops - which is what makes
// a second window, or a second Start, harmless: a frame is delivered once per watching window.
//
// UMD like the game plugin's core/list-state.js: the main process and the window both load it.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.AquaStarPacketFrames = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    // Frames are UTF-8 text on the wire (NUL is framing only): both reference readers decode UTF-8.
    function toFrameText(data) {
        if (typeof data === 'string') return data;
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf8');
        return String(data);
    }

    // Which side a frame belongs to, in the reference's own words: its sniffer hooks
    // "packetFromClient" and its tamperer prints "From client:" / "From server:".
    function directionLabel(direction) {
        return direction === 'toServer' ? 'Client' : 'Server';
    }

    // Case-insensitive, the way the reference's tamperer filter is
    // (PacketTamperer.cs: `packet.IndexOf(tbFilter.Text, StringComparison.OrdinalIgnoreCase) >= 0`).
    // It selects what is drawn, never what is kept, so widening it again shows what was hidden.
    function matchesFilter(frame, pattern) {
        const needle = String(pattern == null ? '' : pattern).trim().toLowerCase();
        if (!needle) return true;
        return toFrameText(frame && frame.text).toLowerCase().indexOf(needle) !== -1;
    }

    function visibleFrames(frames, pattern) {
        return (Array.isArray(frames) ? frames : []).filter(function (frame) {
            return matchesFilter(frame, pattern);
        });
    }

    // What Copy puts on the clipboard: the reference's own one-frame-per-line shape, with the
    // direction it already shows per row kept on the line, and the current filter respected.
    function copyText(frames, pattern) {
        return visibleFrames(frames, pattern).map(function (frame) {
            return directionLabel(frame.direction) + ': ' + toFrameText(frame.text);
        }).join('\n');
    }

    // options: { packets: host.packets, deliver(watcher, {direction, text}), onLog(line) }
    function createFrameFeed(options) {
        options = options || {};
        const packets = options.packets;
        const deliver = typeof options.deliver === 'function' ? options.deliver : function () {};
        const onLog = typeof options.onLog === 'function' ? options.onLog : function () {};
        const watchers = [];
        let release = null;

        function fanOut(frame) {
            const entry = { direction: frame.direction, text: toFrameText(frame.data) };
            watchers.slice().forEach(function (watcher) {
                try {
                    deliver(watcher, entry);
                } catch (error) {
                    // A window that closed between the frame and the write is not a reason to stop
                    // showing traffic in the others.
                    onLog('packet logger dropped a window it could not write to (' +
                        (error && error.message ? error.message : error) + ')');
                    stop(watcher);
                }
            });
        }

        function start(watcher) {
            if (!watcher) throw new Error('[Grimlite Parity] the logger needs a window to send frames to');
            if (watchers.indexOf(watcher) !== -1) return false;
            watchers.push(watcher);
            if (!release) release = packets.on('frame', fanOut);
            return true;
        }

        function stop(watcher) {
            const index = watchers.indexOf(watcher);
            if (index !== -1) watchers.splice(index, 1);
            if (!watchers.length && release) {
                release();
                release = null;
            }
        }

        return {
            start: start,
            stop: stop,
            started: function () { return release !== null; },
            watching: function (watcher) { return watchers.indexOf(watcher) !== -1; }
        };
    }

    return {
        toFrameText: toFrameText,
        directionLabel: directionLabel,
        matchesFilter: matchesFilter,
        visibleFrames: visibleFrames,
        copyText: copyText,
        createFrameFeed: createFrameFeed
    };
});
