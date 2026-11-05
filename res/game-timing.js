(function () {
    const request = window.requestAnimationFrame.bind(window);
    const cancel = window.cancelAnimationFrame.bind(window);
    const pending = new Map();

    // Wayland can stop animation callbacks while Electron still reports the page as visible.
    window.requestAnimationFrame = function (callback) {
        let id;
        const finish = function (timestamp) {
            if (!pending.has(id)) return;
            clearTimeout(pending.get(id));
            pending.delete(id);
            cancel(id);
            callback(timestamp);
        };
        id = request(finish);
        pending.set(id, setTimeout(function () { finish(performance.now()); }, 1000 / 60));
        return id;
    };

    window.cancelAnimationFrame = function (id) {
        clearTimeout(pending.get(id));
        pending.delete(id);
        cancel(id);
    };
})();
