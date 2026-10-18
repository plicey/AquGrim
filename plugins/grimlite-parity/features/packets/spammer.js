// The packet spammer (spec #19 / ticket #27). Reference: Grimoire/UI/PacketSpammer.cs and
// Grimoire/Tools/Spammer.cs at 816d9cd.
//
// The file shape is the reference's own: an <autoer> root whose <packet> children are the list,
// beside <author> and <spamspeed>. Its writer (XmlWriter.Create(path)) writes one line, no XML
// declaration, and the whole document; its reader (XElement.Load(...).Nodes()) walks the root's
// own children only, which is why an element nested deeper is not a list entry here either.
//
// One reference defect is not ported: its LoadConfig assigns `item.Name` - the literal string
// "spamspeed" - to a temporary and then tests THAT for digits, so every load resets the delay
// spinner to 2000 and a saved speed never comes back. The file's value is plainly the delay, and a
// user who saves a list expects the same speed back, so this reader takes it (2000 stays the
// fallback for a value that is absent or not a number, which is what the reference's own test was
// reaching for).
//
// Sending goes through the injected `send`, which is host.packets.send (packet-send); nothing here
// decides how a frame reaches the game.

const xml = require('./xml.js');

const ROOT = 'autoer';
const PACKET = 'packet';
const SPEED = 'spamspeed';
const AUTHOR = 'author';
// The reference's own placeholder: SaveConfig always writes <author>Author</author>.
const AUTHOR_PLACEHOLDER = 'Author';
// DarkNumericUpDown numDelay: Minimum 100, Maximum 61000, Value 1000.
const DELAY_MIN_MS = 100;
const DELAY_MAX_MS = 61000;
const DELAY_DEFAULT_MS = 1000;
// LoadConfig's own fallback for a <spamspeed> that is not all digits.
const FALLBACK_DELAY_MS = 2000;

const ERRORS = {
    parse: 'That file is not a readable spammer file (XML errors).'
};

// PacketSpammer.InitializeComponent's own control words, top to bottom and left to right:
// the delay spinner (no label of its own), Remove, Clear, Add, Load, Save, Send once, Stop, Start.
const LABELS = {
    title: 'Packet spammer',
    remove: 'Remove',
    clear: 'Clear',
    add: 'Add',
    load: 'Load',
    save: 'Save',
    sendOnce: 'Send once',
    stop: 'Stop',
    start: 'Start',
    // The two dialogs' own titles and filter, from SaveConfig/LoadConfig.
    saveTitle: 'Save spammer file',
    loadTitle: 'Load spammer file',
    filterName: 'XML files'
};

function clampDelay(value) {
    const number = Number(value);
    if (!isFinite(number)) return FALLBACK_DELAY_MS;
    return Math.min(DELAY_MAX_MS, Math.max(DELAY_MIN_MS, Math.round(number)));
}

/** The reference's own reader, over the text of a file. */
function parseFile(text) {
    const document = xml.parse(text);
    const root = xml.child(document, ROOT);
    if (!root) {
        return { ok: false, error: ERRORS.parse, packets: [], delay: FALLBACK_DELAY_MS };
    }

    const packets = xml.childrenNamed(root, PACKET).map(function (element) {
        return element.text;
    });
    const speed = xml.child(root, SPEED);
    // `text.All(char.IsDigit)` - the reference's own test, applied to the value it meant to read.
    const raw = speed ? speed.text.trim() : '';
    const delay = /^[0-9]+$/.test(raw) ? clampDelay(Number(raw)) : FALLBACK_DELAY_MS;
    return { ok: true, error: null, packets: packets, delay: delay };
}

/** The reference's own writer, as text: one line, no declaration, list then author then speed. */
function serializeFile(config) {
    const settings = config || {};
    const packets = Array.isArray(settings.packets) ? settings.packets : [];
    const delay = clampDelay(settings.delay == null ? DELAY_DEFAULT_MS : settings.delay);
    const body = packets.map(function (packet) {
        return '<' + PACKET + '>' + xml.escapeText(packet) + '</' + PACKET + '>';
    }).join('');
    return '\uFEFF<' + ROOT + '>' + body +
        '<' + AUTHOR + '>' + AUTHOR_PLACEHOLDER + '</' + AUTHOR + '>' +
        '<' + SPEED + '>' + delay + '</' + SPEED + '>' +
        '</' + ROOT + '>';
}

/**
 * The spam loop (Spammer.Spam), with its pacing injected so a test drives it: the list is sent in
 * order from its first entry, wrapping forever, one frame then one wait; IndexChanged is raised
 * with the entry about to go out, before the frame does.
 *
 * options: { send(frame) -> bool, sleep(ms) -> Promise, onIndex(index) }
 */
function createSpammer(options) {
    const settings = options || {};
    const send = settings.send;
    const sleep = settings.sleep || function (ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };
    const onIndex = typeof settings.onIndex === 'function' ? settings.onIndex : function () {};

    let running = false;
    let sent = 0;
    let failed = 0;

    function write(text) {
        const written = send({ direction: 'toServer', text: text }) === true;
        if (written) sent++;
        else failed++;
        return written;
    }

    return {
        start: function (packets, delay) {
            const list = Array.isArray(packets) ? packets.slice() : [];
            // `if (lstPackets.Items.Count > 0)`: an empty list does not start, and does not touch
            // whatever is already running.
            if (!list.length) return false;
            this.stop();
            running = true;
            const wait = clampDelay(delay == null ? DELAY_DEFAULT_MS : delay);

            (async function loop() {
                let index = 0;
                while (running) {
                    if (index >= list.length) index = 0;
                    onIndex(index);
                    write(list[index++]);
                    await sleep(wait);
                }
            })();
            return true;
        },

        stop: function () {
            running = false;
        },

        running: function () { return running; },
        sentCount: function () { return sent; },

        /** How many frames the relay would not take: there was no live connection to write on. */
        failedCount: function () { return failed; },

        /**
         * Send once: exactly one frame, to the server, from the window's own text box. The
         * reference's own guard is a length test (`if (txtPacket.TextLength > 0)`), and its answer
         * to a frame the relay will not take is not a frame either.
         */
        sendOnce: function (text) {
            if (typeof text !== 'string' || !text.length) return false;
            return write(text);
        }
    };
}

module.exports = {
    parseFile: parseFile,
    serializeFile: serializeFile,
    clampDelay: clampDelay,
    createSpammer: createSpammer,
    ERRORS: ERRORS,
    LABELS: LABELS,
    DELAY_MIN_MS: DELAY_MIN_MS,
    DELAY_MAX_MS: DELAY_MAX_MS,
    DELAY_DEFAULT_MS: DELAY_DEFAULT_MS,
    FALLBACK_DELAY_MS: FALLBACK_DELAY_MS,
    AUTHOR_PLACEHOLDER: AUTHOR_PLACEHOLDER
};
