// The packet logger window's main-process half. The subscription itself lives in frames.js and is
// shared by every window that is watching, so a second window - or a second Start - is never a
// second listener; this only decides which windows watch and writes the window's clipboard.

const frames = require('./frames.js');

function createLoggerFeature(host) {
    let feed = null;
    // webContents.send is not namespaced by the Host the way ipc.handle is, so the plugin names
    // its own channel the way the preload does: plugin:<id>:packetFrame.
    const frameChannel = 'plugin:' + host.pluginId + ':packetFrame';

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

        register: function () {
            host.ipc.handle('packetsStart', function (event) {
                start(event.sender);
                return { watching: true };
            });
            host.ipc.handle('packetsStop', function (event) {
                stop(event.sender);
                return { watching: false };
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
