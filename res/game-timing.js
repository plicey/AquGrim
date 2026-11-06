(function () {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Map();
    let nextId = 0;
    let nativeId = null;
    let timerId = null;
    let stalled = false;
    let lastTimestamp = -Infinity;

    function stop() {
        if (nativeId !== null) cancel(nativeId);
        clearTimeout(timerId);
        nativeId = timerId = null;
        stalled = false;
    }

    function deliver(timestamp) {
        lastTimestamp = timestamp;
        const ids = Array.from(pending.keys());
        ids.forEach(function (id) {
            const callback = pending.get(id);
            if (!callback) return;
            pending.delete(id);
            try {
                callback(timestamp);
            } catch (error) {
                setTimeout(function () { throw error; }, 0);
            }
        });
        if (!pending.size) stop();
    }

    function schedule() {
        if (!pending.size) return;
        if (nativeId === null) {
            const id = request(function (timestamp) {
                if (nativeId !== id) return;
                nativeId = null;
                clearTimeout(timerId);
                timerId = null;
                stalled = false;
                // A resumed compositor may carry a timestamp older than the last timer tick.
                if (timestamp > lastTimestamp) deliver(timestamp);
                schedule();
            });
            nativeId = id;
        }
        if (timerId === null) {
            // Give a healthy compositor room; racing every refresh produces extra, uneven ticks.
            const id = setTimeout(function () {
                if (timerId !== id) return;
                timerId = null;
                stalled = true;
                deliver(performance.now());
                schedule();
            }, stalled ? 1000 / 60 : 100);
            timerId = id;
        }
    }

    window.requestAnimationFrame = function (callback) {
        const id = ++nextId;
        pending.set(id, callback);
        schedule();
        return id;
    };

    window.cancelAnimationFrame = function (id) {
        pending.delete(id);
        if (!pending.size) stop();
    };
})();
