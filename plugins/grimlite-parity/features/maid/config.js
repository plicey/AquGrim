// The Maid's configuration file (ticket #43). Reference: Grimoire/Tools/Maid/MaidConfig.cs (the 23
// fields, in its own order) and Grimoire/UI/Maid/MaidRemake.cs `saveConfig`/`ApplyConfig`
// (:1390-1550). The key names, the shape and the overlay semantics are the reference's own, because
// a renamed key means the user's existing config file stops loading.
//
// The overlay rule is the reference's `ApplyConfig`: a string is applied only when it is non-empty
// (`!string.IsNullOrEmpty`), a number only when the file carries it (`HasValue`), and a boolean is
// `config.X ?? current` - so a file that omits a box leaves that box as the user left it, and a file
// that carries `false` really turns the box off. That is what makes a partial file (its shipped
// template omits six keys) a patch rather than a reset.

// The 23 fields in MaidConfig's own declaration order, which is also the order the reference's own
// serialiser writes them in (Newtonsoft writes properties in declaration order).
const FIELDS = [
    'Target',
    'SkillList',
    'LockedZoneHandlerMaps',
    'SafeSkillList',
    'BuffStopAttackList',
    'AttackPriorityMonster',
    'SpecialMsg',
    'WhitelistMapMaps',
    'RelogDelay',
    'SkillDelay',
    'SafeSkillHP',
    'SpecialAct',
    'UltraBossExtra',
    'AntiCounter',
    'CopyWalk',
    'AttackPriority',
    'BuffStopAttack',
    'WaitSkill',
    'StopFailedGoto',
    'LockedZoneHandler',
    'WhitelistMap',
    'GlobalHotkey',
    'SafeSkill'
];

const NUMBERS = [
    'RelogDelay', 'SkillDelay', 'SafeSkillHP', 'SpecialAct', 'UltraBossExtra'
];

const BOOLEANS = [
    'AntiCounter', 'CopyWalk', 'AttackPriority', 'BuffStopAttack', 'WaitSkill',
    'StopFailedGoto', 'LockedZoneHandler', 'WhitelistMap', 'GlobalHotkey', 'SafeSkill'
];

// Resources/Plugins/Maid/Default.json verbatim, including the CRLF inside LockedZoneHandlerMaps
// (the file ships two map lines and the reference's own text box keeps them). It is the reference's
// template rather than a full config: it omits WhitelistMapMaps and the five combat keys, which is
// exactly why the overlay rule matters.
const DEFAULT_CONFIG = {
    Target: 'username',
    SkillList: '1,2,3,4',
    SkillDelay: 150,
    WaitSkill: false,
    StopFailedGoto: false,
    LockedZoneHandler: false,
    LockedZoneHandlerMaps: 'citadel-6666;m22;Left\r\ntercessuinotlim-6666',
    RelogDelay: 5000,
    GlobalHotkey: false,
    SafeSkill: false,
    SafeSkillList: '1,2',
    SafeSkillHP: 60,
    BuffStopAttack: false,
    BuffStopAttackList: '2,3',
    AttackPriority: false,
    AttackPriorityMonster: 'Defense Drone,Attack Drone',
    CopyWalk: false
};

/** A fresh copy of the shipped default, so a caller can edit one without touching the next. */
function defaults() {
    return Object.assign({}, DEFAULT_CONFIG);
}

function message(error) {
    return (error && error.message) || String(error);
}

/**
 * One config file's text as a patch over nothing: `{ok, config}` or `{ok: false, error}`. Only the
 * 23 known keys are read and each keeps its own type, because a wrong-typed value would be applied
 * by the overlay as if the user had typed it.
 */
function parse(text) {
    let loaded;
    try {
        loaded = JSON.parse(String(text === null || text === undefined ? '' : text));
    } catch (error) {
        return { ok: false, error: 'this is not a Maid config: ' + message(error) };
    }
    if (!loaded || typeof loaded !== 'object' || Array.isArray(loaded)) {
        return { ok: false, error: 'this is not a Maid config: it is not an object' };
    }
    const config = {};
    FIELDS.forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(loaded, key)) return;
        const value = loaded[key];
        if (value === null || value === undefined) return;
        if (NUMBERS.indexOf(key) !== -1) {
            const number = Number(value);
            if (isFinite(number)) config[key] = number;
            return;
        }
        if (BOOLEANS.indexOf(key) !== -1) {
            if (typeof value === 'boolean') config[key] = value;
            return;
        }
        config[key] = String(value);
    });
    return { ok: true, config: config };
}

/**
 * The other half of the round trip: every one of the 23 keys, indented, the way
 * `JsonConvert.SerializeObject(saveConfig(), Formatting.Indented)` writes the reference's file. A
 * key the state does not carry is written as null, so a file this app saved always loads back
 * whole.
 */
function serialise(config) {
    const state = config || {};
    const out = {};
    FIELDS.forEach(function (key) {
        out[key] = Object.prototype.hasOwnProperty.call(state, key) ? state[key] : null;
    });
    return JSON.stringify(out, null, 2) + '\n';
}

/**
 * `ApplyConfig` as one function: the file's own values over the current state, by the reference's
 * three rules - a non-empty string wins, a present number wins, a boolean is `??` (so `false` is a
 * real value and an absent key is not).
 */
function apply(config, current) {
    const out = Object.assign({}, current || {});
    const patch = config || {};
    Object.keys(patch).forEach(function (key) {
        if (FIELDS.indexOf(key) === -1) return;
        const value = patch[key];
        if (value === null || value === undefined) return;
        if (typeof value === 'boolean') {
            out[key] = value;
            return;
        }
        if (typeof value === 'number') {
            out[key] = isFinite(value) ? value : out[key];
            return;
        }
        const text = String(value);
        // `!string.IsNullOrEmpty`: an empty string is not a value the reference applies.
        if (text !== '') out[key] = text;
    });
    return out;
}

/** The window's own starting point: the shipped template over nothing. */
function stateFrom(config) {
    return apply(config || {}, defaults());
}

/**
 * A map list as the reference's two own forms parse it. `LockedMapForm.getMaps` (:34-72) strips
 * everything that is not a letter, digit, dash or semicolon, drops empty lines, and reads
 * `map;cell;pad`; a `-e` room becomes a fresh random 9999-99999, a `-0` (or `-`) room becomes `-1`,
 * and an unspecified cell or pad falls back to `Enter` / `Spawn`. `WhitelistMap.getMaps` reads the
 * same shape but defaults to `all`/`all`, drops the room suffix, and lowercases the map name.
 *
 * Answers [{map, cell, pad, raw}] in file order. The whitelist form's own list is what a caller
 * matches with `findMap`, so the separator it produces (`;`) is the reference's too.
 */
function parseMapList(text, options) {
    const opts = options || {};
    const locked = opts.locked === true;
    const clean = String(text === null || text === undefined ? '' : text)
        .replace(/[^a-zA-Z0-9\-;\r\n]/g, '');
    const out = [];
    clean.split(/\r\n|\n|\r/).forEach(function (line) {
        if (line === '') return;
        const parts = line.split(';');
        let map = parts[0];
        let cell = locked ? 'Enter' : 'all';
        let pad = locked ? 'Spawn' : 'all';
        if (locked) {
            if (map.indexOf('-') !== -1) {
                const room = map.split('-');
                if (room[1].indexOf('e') !== -1) room[1] = String(9999 + Math.floor(Math.random() * 90000));
                else if (room[1] === '0' || room[1] === '') room[1] = '1';
                map = room[0] + '-' + room[1];
            }
        } else if (map.indexOf('-') !== -1) {
            map = map.split('-')[0];
        }
        if (parts.length > 1 && parts[1] !== '') cell = parts[1];
        if (parts.length > 2 && parts[2] !== '') pad = parts[2];
        out.push({ map: locked ? map : map.toLowerCase(), cell: cell, pad: pad, raw: line });
    });
    return out;
}

/** Does a whitelist entry answer for the map the game reports? `WhitelistMap.getMaps` lowercases. */
function mapMatches(entry, map) {
    if (!entry) return false;
    const mine = String(map === null || map === undefined ? '' : map).toLowerCase();
    const roomless = mine.indexOf('-') === -1 ? mine : mine.split('-')[0];
    return String(entry.map).toLowerCase() === roomless;
}

/** The first entry that answers for this map, or null. */
function findMap(entries, map) {
    const list = entries || [];
    for (let i = 0; i < list.length; i++) {
        if (mapMatches(list[i], map)) return list[i];
    }
    return null;
}

/**
 * A configured skill list (`"1,2,3,4"`) as the reference splits it: by comma, empties dropped
 * (`Split(new[] {","}, StringSplitOptions.RemoveEmptyEntries)`).
 */
function skillList(text) {
    return String(text === null || text === undefined ? '' : text)
        .split(',').map(function (part) { return part.trim(); })
        .filter(function (part) { return part !== ''; });
}

/** `doPriorityAttack`'s own list: `tbAttPriority.Text.Split(',')`. */
function priorityList(text) {
    return String(text === null || text === undefined ? '' : text)
        .split(',').map(function (part) { return part.trim(); })
        .filter(function (part) { return part !== ''; });
}

module.exports = {
    FIELDS: FIELDS,
    NUMBERS: NUMBERS,
    BOOLEANS: BOOLEANS,
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    defaults: defaults,
    parse: parse,
    serialise: serialise,
    apply: apply,
    stateFrom: stateFrom,
    parseMapList: parseMapList,
    mapMatches: mapMatches,
    findMap: findMap,
    skillList: skillList,
    priorityList: priorityList
};
