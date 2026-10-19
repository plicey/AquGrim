// What the Notepad's helpers read from the game, behind one small seam. Notepad.cs goes
// straight to Flash (`world.actions.active`, Player.recentMapItem); here the game access lands
// with the bridge ticket (#28), so today this seam is how the window asks and gets nothing.
// It reports nothing rather than a stand-in value, so a dump never claims game state the app
// has not read.

function createGameSource() {
    let source = null;

    function read(name, fallback) {
        if (!source || typeof source[name] !== 'function') return fallback;
        try {
            const value = source[name]();
            return value === null || typeof value === 'undefined' ? fallback : value;
        } catch (error) {
            // A game that is reloading or logged out is not a reason for the window to break.
            return fallback;
        }
    }

    return {
        /** Point the seam at a bridge-backed provider (`{equippedClass, skillActions, mapItems}`). */
        attach: function (provider) {
            source = provider || null;
            return source;
        },

        equippedClass: function () {
            return String(read('equippedClass', '') || '');
        },

        skillActions: function () {
            const actions = read('skillActions', []);
            return Array.isArray(actions) ? actions : [];
        },

        /** `[id, name]` pairs, lowest id first (the order MapItemLog.txt is merged in). */
        mapItems: function () {
            const items = read('mapItems', {});
            if (Array.isArray(items)) return items;
            if (!items || typeof items !== 'object') return [];
            return Object.keys(items)
                .map(function (id) { return [Number(id), items[id]]; })
                .sort(function (a, b) { return a[0] - b[0]; });
        }
    };
}

module.exports = { createGameSource: createGameSource };
