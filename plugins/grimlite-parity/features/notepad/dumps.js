// The Notepad's two hidden helpers, typed into the text box (Grimlite-Li Grimoire/UI/Notepad.cs:
// richTextBox1_TextChanged). Both are plain text builders so they can be tested without a window.

// Notepad.cs skips a property whose name contains "desc" or "auras" (.NET Contains is
// case-sensitive, so "sDesc" is kept) and prints every other one as "<name>:<value>, ".
function skipProperty(name) {
    return name.indexOf('desc') !== -1 || name.indexOf('auras') !== -1;
}

function propertyValue(value) {
    // Newtonsoft's JValue.ToString() prints a primitive as it reads; objects and arrays are
    // printed as their JSON, which is what makes the dump useful for the aura lists.
    if (value === null || typeof value === 'undefined') return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/**
 * The `debugskill` helper: the equipped class lowercased, then every action's properties.
 * @param {string} className equipped class as the game reports it
 * @param {Array<Object>} actions `world.actions.active` as an array of objects
 */
function skillDump(className, actions) {
    let text = String(className || '').toLowerCase();
    const list = Array.isArray(actions) ? actions : [];
    for (let i = 0; i < list.length; i++) {
        text += '\r\nSkill-' + i + '\r\n';
        const action = list[i] || {};
        Object.keys(action)
            .sort()
            .forEach(function (name) {
                if (skipProperty(name)) return;
                text += name + ':' + propertyValue(action[name]) + ', ';
            });
    }
    return text;
}

/**
 * The `mapitems` helper: the map-item ids the client has seen, in the order it holds them.
 * @param {Array<Array>} entries `[id, name]` pairs, a missing name printed as null
 */
function mapItemDump(entries) {
    const lines = (Array.isArray(entries) ? entries : []).map(function (entry) {
        const pair = Array.isArray(entry) ? entry : [entry, null];
        const value = pair[1] === null || typeof pair[1] === 'undefined' ? 'null' : pair[1];
        return '[' + pair[0] + '] = ' + value;
    });
    return 'Player map items :\n' + lines.join('\n');
}

/**
 * Which helper a keystroke asks for, if any. The reference tests `debugskill` first and
 * replaces the box, so a text holding both gets the skill dump.
 * @param {string} text current contents of the box
 * @returns {'skill'|'mapitems'|null}
 */
function helperFor(text) {
    const value = String(text || '');
    if (value.indexOf('debugskill') !== -1) return 'skill';
    if (value.indexOf('mapitems') !== -1) return 'mapitems';
    return null;
}

module.exports = {
    skillDump: skillDump,
    mapItemDump: mapItemDump,
    helperFor: helperFor
};
