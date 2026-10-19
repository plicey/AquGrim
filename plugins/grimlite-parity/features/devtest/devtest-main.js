// Main-process half of the Dev Test window: the call modes and the bridge call itself. The page is
// sandboxed and cannot require anything, so everything that touches the bridge happens here.
const { clipboard } = require('electron');

const callModes = require('./call-modes.js');

function register(host) {
    host.ipc.handle('devtestModes', function () {
        return callModes.MODES;
    });

    host.ipc.handle('devtestRun', function (_event, mode, path, args, argsEnabled) {
        const name = path == null ? '' : String(path).trim();
        if (!name) return { ok: false, error: 'name a function first' };

        // The window is a bridge client like any other feature: attach on first use, so opening
        // the game after the window still works.
        return Promise.resolve(host.bridge.attach()).then(function (attached) {
            if (!attached.ok) return attached;
            return callModes.run(
                mode,
                name,
                callModes.parseArgs(args, argsEnabled !== false),
                { call: function (callback, callArgs) { return host.bridge.call(callback, callArgs); } },
                // Get/Set Object writes, waits ~1 s and reads back, exactly as DevTest.cs does.
                { wait: function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); } }
            );
        });
    });

    host.ipc.handle('devtestFormat', function (_event, text) {
        return callModes.format(text);
    });

    host.ipc.handle('devtestCopy', function (_event, text) {
        clipboard.writeText(String(text == null ? '' : text));
        return true;
    });
}

module.exports = { register: register };
