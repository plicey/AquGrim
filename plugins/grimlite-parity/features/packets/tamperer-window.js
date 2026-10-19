// The tamperer window's main-process half. The page draws the reference's controls; the capture
// switches, the filter and the two send actions live in tamperer.js, and every frame goes out
// through host.packets.send (packet-send).
//
// Reading is the platform tap, the same one the packet logger subscribes to. The reference hooks
// its Flash callback when a checkbox is ticked and unhooks it when it is unticked, so the
// subscription here follows the switches: one subscription while either is ticked, released when
// the last one goes off. The switches themselves sit in tamperer.js, which is what makes each of
// them gate only its own direction.
const tamperer = require('./tamperer.js');
const steeringNotice = require('./steering-notice.js');

function createTampererWindow(deps) {
    deps = deps || {};
    const packets = deps.packets;
    const labels = Object.assign({}, tamperer.LABELS, deps.messages || {});
    // The banner the window shows while steering is off: with no relay there is nothing to read
    // and nowhere to write. A caller that says nothing has nothing to say.
    const steering = typeof deps.steering === 'function' ? deps.steering : function () { return ''; };

    let release = null;
    const watchers = [];

    const capture = tamperer.createCapture({
        // packets.send throws when this session is not steering traffic at all; the window reports
        // that the same way as a relay with nobody connected: not written.
        send: function (frame) {
            try {
                return packets.send(frame);
            } catch (error) {
                return false;
            }
        }
    });

    function watching() {
        return capture.captureFromClient() || capture.captureFromServer();
    }

    function follow() {
        if (watching() && !release) release = packets.on('frame', announce);
        else if (!watching() && release) { release(); release = null; }
    }

    // One captured frame redraws the box: the reference appends to its rich text control, so the
    // window shows the whole text it has, in the shape it was captured (tamperer.text()).
    function announce(frame) {
        if (!capture.accept(frame)) return;
        const text = capture.text();
        watchers.slice().forEach(function (watcher) {
            if (watcher.isDestroyed && watcher.isDestroyed()) return;
            watcher.send(deps.channel, { text: text });
        });
    }

    function handle(channel, event, args) {
        void event;
        if (channel === 'tampererMessages') return Promise.resolve(labels);
        if (channel === 'tampererSteering') return Promise.resolve({ notice: steering() });
        if (channel === 'tampererWatch') {
            const wanted = (args && args[0]) || {};
            if (event && event.sender && watchers.indexOf(event.sender) === -1) {
                watchers.push(event.sender);
                event.sender.once('destroyed', function () { drop(event.sender); });
            }
            capture.setCaptureFromClient(wanted.fromClient === true);
            capture.setCaptureFromServer(wanted.fromServer === true);
            follow();
            return Promise.resolve({
                fromClient: capture.captureFromClient(),
                fromServer: capture.captureFromServer(),
                reading: release !== null
            });
        }
        if (channel === 'tampererUnwatch') {
            capture.setCaptureFromClient(false);
            capture.setCaptureFromServer(false);
            follow();
            return Promise.resolve({ reading: false });
        }
        if (channel === 'tampererFilter') {
            capture.setFilter((args && args[0]) || '');
            return Promise.resolve({ filter: capture.filter(), lines: capture.lines() });
        }
        if (channel === 'tampererClear') {
            capture.clear();
            return Promise.resolve({ text: '' });
        }
        if (channel === 'tampererSendToServer') {
            return Promise.resolve({ sent: capture.sendToServer((args && args[0]) || '') });
        }
        if (channel === 'tampererSendToClient') {
            return Promise.resolve({ sent: capture.sendToClient((args && args[0]) || '') });
        }
        throw new Error('[AquaStar:grimlite-parity] unknown tamperer channel "' + channel + '"');
    }

    // A closed window is not a reason to keep reading traffic: with no window left, the tap is
    // released and the switches go back to clear, so reopening starts from the reference's own
    // state (both unticked, nothing hooked).
    function drop(watcher) {
        const index = watchers.indexOf(watcher);
        if (index !== -1) watchers.splice(index, 1);
        if (watchers.length) return;
        capture.setCaptureFromClient(false);
        capture.setCaptureFromServer(false);
        follow();
    }

    function attach() {
        if (!deps.host) return;
        const host = deps.host;
        [
            'tampererMessages', 'tampererSteering', 'tampererWatch', 'tampererUnwatch',
            'tampererFilter', 'tampererClear', 'tampererSendToServer', 'tampererSendToClient'
        ].forEach(function (name) {
            host.ipc.handle(name, function (event) {
                return handle(name, event, Array.prototype.slice.call(arguments, 1));
            });
        });
    }

    return {
        handle: handle,
        attach: attach,
        capture: function () { return capture; },
        reading: function () { return release !== null; }
    };
}

/** The window as the plugin uses it: the page's channel and the Host's own packet surface. */
function createFromHost(host, deps) {
    deps = deps || {};
    return createTampererWindow({
        host: host,
        // Reading is the tap (packet-tap), writing is packets.send (packet-send): this window is
        // the one tool that needs both, which is the reference's own split too (its tamperer hooks
        // the sniffer's callbacks and sends from the same box).
        packets: host.packets,
        channel: 'plugin:' + host.pluginId + ':tampererCapture',
        // Off means the relay is not there, both to read through and to write through.
        steering: function () { return steeringNotice.notice(host); },
        messages: (typeof host.getLocaleStrings === 'function' &&
            host.getLocaleStrings('tampererMessages')) || {}
    });
}

module.exports = {
    createTampererWindow: createTampererWindow,
    createFromHost: createFromHost
};
