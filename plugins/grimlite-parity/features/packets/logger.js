// The packet logger window's main-process half. The subscription itself lives in frames.js and is
// shared by every window that is watching, so a second window - or a second Start - is never a
// second listener; this only decides which windows watch and writes the window's clipboard.
//
// The window's embedded Spammer block writes through the same path everything else does
// (packets.send - packet-send): its 0-times case is the continuous loop in spammer.js, and the
// counted case (exactly N frames) is driven by the page, the way the reference's own click
// handler drives it.

const frames = require('./frames.js');
const spammer = require('./spammer.js');
const steeringNotice = require('./steering-notice.js');

function createLoggerFeature(host) {
    let feed = null;
    // webContents.send is not namespaced by the Host the way ipc.handle is, so the plugin names
    // its own channel the way the preload does: plugin:<id>:packetFrame.
    const frameChannel = 'plugin:' + host.pluginId + ':packetFrame';

    /**
     * One frame into the relay. The Host throws when this session is not steering traffic at all
     * (there is no relay); to a window that is the same answer as a relay with nobody connected:
     * false, not written - the banner says why.
     */
    function write(frame) {
        try {
            return host.packets.send(frame) === true;
        } catch (error) {
            return false;
        }
    }

    /** One frame from the window's own box, to the server. An empty box sends nothing. */
    function send(text) {
        if (typeof text !== 'string' || !text.length) return false;
        return write({ direction: 'toServer', text: text });
    }

    // The reference's embedded Spammer hands its one-packet list to the tool the Spammer window
    // also drives (Spammer.Instance); this is that tool's loop for this window, and the window
    // that pressed Spam is the one whose close stops it.
    // numSpamDelay is the reference's 0..2000 (PacketLogger.Designer.cs), unlike the Spammer
    // window's 100..61000 numDelay.
    const spam = spammer.createSpammer({ send: write, minDelay: 0, maxDelay: 2000 });
    let spamWindow = null;

    function startSpam(watcher, config) {
        const settings = config || {};
        const text = typeof settings.text === 'string' ? settings.text : '';
        // The reference's own guard is the page's (`if (textToSend.TextLength < 1) return;`) and
        // holds here too: an empty box does not start a loop.
        if (!text.length) return { running: false };
        if (watcher && spamWindow !== watcher) {
            spamWindow = watcher;
            if (typeof watcher.once === 'function') {
                watcher.once('destroyed', function () {
                    if (spamWindow !== watcher) return;
                    spamWindow = null;
                    // A destroyed page cannot press Stop, so the loop ends with it.
                    spam.stop();
                });
            }
        }
        spam.start([text], settings.delay);
        return { running: spam.running() };
    }

    function start(watcher) {
        if (!feed) {
            feed = frames.createFrameFeed({
                packets: host.packets,
                deliver: function (target, frame) {
                    if (target.isDestroyed && target.isDestroyed()) { feed.stop(target); return; }
                    target.send(frameChannel, frame);
                },
                onLog: host.log
            });
        }
        if (feed.start(watcher)) {
            // A window the user closed is not a reason to keep reading traffic for it.
            watcher.once('destroyed', function () { feed.stop(watcher); });
        }
    }

    function stop(watcher) {
        if (feed) feed.stop(watcher);
    }

    return {
        frameChannel: frameChannel,
        feed: function () { return feed; },
        spam: function () { return spam; },

        register: function () {
            host.ipc.handle('packetsStart', function (event) {
                start(event.sender);
                return { watching: true };
            });
            host.ipc.handle('packetsStop', function (event) {
                stop(event.sender);
                return { watching: false };
            });
            host.ipc.handle('packetsSend', function (event, text) {
                void event;
                return { sent: send(text) };
            });
            host.ipc.handle('packetsSpamStart', function (event, config) {
                return startSpam(event.sender, config);
            });
            host.ipc.handle('packetsSpamStop', function () {
                // No-op with nothing running, the way the reference's Stop is.
                spam.stop();
                return { running: false };
            });
            // The tap and packets.send only carry anything while the game is steered through the
            // relay; the page says so instead of looking broken (and never turns it on itself).
            host.ipc.handle('packetsSteering', function () {
                return {
                    steering: steeringNotice.steeringEnabled(host),
                    notice: steeringNotice.notice(host)
                };
            });
            // Clipboard is main-process-only under sandbox:true / nodeIntegration:false.
            host.ipc.on('packetsCopy', function (event, text) {
                try {
                    require('electron').clipboard.writeText(typeof text === 'string' ? text : '');
                } catch (error) {
                    host.log('packet logger could not copy: ' + (error && error.message ? error.message : error));
                }
            });
        }
    };
}

module.exports = {
    createLoggerFeature: createLoggerFeature
};
