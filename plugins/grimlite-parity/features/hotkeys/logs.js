// The small log window that the reference reaches from Tools -> Logs (LogForm.cs). Its own list
// is the debug log; this port has one process-wide log, so this keeps a bounded tail of the lines
// the plugin writes and hands them to the sandboxed page.

const MAX_LINES = 2000;

function createLogFeature(options) {
    options = options || {};
    const limit = Number(options.maxLines) > 0 ? Math.floor(options.maxLines) : MAX_LINES;
    const lines = [];

    function append(text) {
        String(text === undefined || text === null ? '' : text)
            .split(/\r?\n/)
            .forEach(function (line) {
                lines.push(line);
            });
        if (lines.length > limit) lines.splice(0, lines.length - limit);
    }

    /** Copy every later host.log line into the window's tail. */
    function capture(host) {
        if (!host || typeof host.log !== 'function') return function () {};
        const original = host.log;
        host.log = function (message) {
            append(message);
            return original.apply(host, arguments);
        };
        return function () { host.log = original; };
    }

    function view() {
        return { lines: lines.slice() };
    }

    function clear() {
        lines.length = 0;
        return view();
    }

    function attach(host) {
        if (!host || !host.ipc) return feature;
        host.ipc.handle('logsView', function () { return view(); });
        host.ipc.handle('logsClear', function () { return clear(); });
        return feature;
    }

    const feature = {
        append: append,
        capture: capture,
        view: view,
        clear: clear,
        attach: attach
    };
    return feature;
}

module.exports = {
    createLogFeature: createLogFeature,
    MAX_LINES: MAX_LINES
};
