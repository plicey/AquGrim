// The packet tamperer (spec #19 / ticket #27). Reference: Grimoire/UI/PacketTamperer.cs at 816d9cd.
//
// The reference hooks two different sources - the client's packets through one Flash callback and
// the server's through another - and each checkbox adds or removes its own hook. Ported as it
// stands: two switches, each gating its own direction, and neither one showing the other's traffic.
//
// What it shows is the reference's own line shape: "From client: " / "From server: " then the
// frame, with a blank line after it. What it keeps is everything that was captured; the filter
// decides what is drawn, so widening it again loses nothing.

const LABELS = {
    title: 'Packet Tamperer',
    captureFromClient: 'Capture from client',
    captureFromServer: 'Capture from server',
    filterByText: 'Filter by text',
    sendToServer: 'Send to server',
    sendToClient: 'Send to client',
    clear: 'Clear',
    fromClient: 'From client',
    fromServer: 'From server'
};

// The frame's own text, the way the logger reads it (packets.on hands over {id, direction, data}).
function frameText(frame) {
    if (!frame) return '';
    const data = frame.data;
    if (typeof data === 'string') return data;
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) return data.toString('utf8');
    return data == null ? '' : String(data);
}

function linePrefix(direction) {
    return (direction === 'toServer' ? LABELS.fromClient : LABELS.fromServer) + ': ';
}

/**
 * The window's own state and actions. options: { send(frame) -> bool }.
 * The capture switches live here, not in the window: a frame is only kept when its direction's
 * switch is ticked, which is what makes the two switches independent.
 */
function createCapture(options) {
    const settings = options || {};
    const send = settings.send;
    const captured = [];
    let fromClient = false;
    let fromServer = false;
    let filter = '';

    function wanted(direction) {
        return direction === 'toServer' ? fromClient : fromServer;
    }

    // PacketTamperer.cs filters at capture time, on the packet text alone: the client side uses
    // Contains (case-sensitive), the server side OrdinalIgnoreCase. Widening the filter later
    // shows only what was appended from then on, which is what the reference box does too.
    function matches(direction, text) {
        if (filter === '') return true;
        if (direction === 'toServer') return text.indexOf(filter) !== -1;
        return text.toLowerCase().indexOf(filter.toLowerCase()) !== -1;
    }

    function write(direction, text) {
        if (typeof text !== 'string' || !text.length) return false;
        return send({ direction: direction, text: text }) === true;
    }

    return {
        /** One relayed frame: kept only when this direction's switch is ticked. */
        accept: function (frame) {
            if (!frame || !wanted(frame.direction)) return false;
            const text = frameText(frame);
            if (!text || !matches(frame.direction, text)) return false;
            captured.push({ direction: frame.direction, text: text });
            return true;
        },

        /** What the receive box draws, one captured frame per line, filter applied. */
        lines: function () {
            return captured.map(function (entry) {
                return linePrefix(entry.direction) + entry.text;
            });
        },

        /**
         * What the receive box holds: every captured line, then a blank line - the reference's
         * `AppendText(text + Environment.NewLine + Environment.NewLine)`. The filter is a view and
         * does not reach here; Clear is what empties the box.
         */
        text: function () {
            if (!captured.length) return '';
            return captured.map(function (entry) {
                return linePrefix(entry.direction) + entry.text + '\n\n';
            }).join('');
        },

        clear: function () { captured.length = 0; },

        setFilter: function (value) { filter = value == null ? '' : String(value); },
        filter: function () { return filter; },

        setCaptureFromClient: function (on) { fromClient = on === true; },
        setCaptureFromServer: function (on) { fromServer = on === true; },
        captureFromClient: function () { return fromClient; },
        captureFromServer: function () { return fromServer; },

        sendToServer: function (text) { return write('toServer', text); },
        sendToClient: function (text) { return write('toClient', text); }
    };
}

module.exports = {
    createCapture: createCapture,
    frameText: frameText,
    linePrefix: linePrefix,
    LABELS: LABELS
};
