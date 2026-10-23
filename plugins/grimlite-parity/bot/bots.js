// The .gbot file format, both directions. Reference: Grimlite-Li 816d9cd,
// Grimoire/Botting/Configuration.cs and Grimoire/UI/BotManager.cs (see
// docs/research/grimlite-file-formats.md). A .gbot is Newtonsoft.Json output with
// TypeNameHandling.All: every object carries a $type, every list is a $type/$values wrapper,
// enums are zero-based integers, and a key the file omits means "the C# default".
//
// Files are user documents, so the parsed object *is* the document: an edit mutates it and a
// save writes it back with the keys it already had. Nothing is rebuilt from a normalised model,
// because a key that was absent only because it equalled its default cannot be told apart from
// a key an older build never had. The corpus carries DropDelay and ReloginEvery, which current
// Grimlite ignores on read; a rewrite from a normalised model would silently delete them.

const CONFIGURATION_TYPE = 'Grimoire.Botting.Configuration, Grimoire';

// The wrapper $type of each list field. Constant per key across the whole reference corpus,
// which is why the writer can re-attach one it was not given. The grave accent in each is the
// .NET generic marker.
const GENERIC = String.fromCharCode(96);
function listType(element) {
    return 'System.Collections.Generic.List' + GENERIC + '1[[' + element + ']], mscorlib';
}

const LIST_TYPES = {
    Commands: listType('Grimoire.Botting.IBotCommand, Grimoire'),
    Skills: listType('Grimoire.Game.Data.Skill, Grimoire'),
    Quests: listType('Grimoire.Game.Data.Quest, Grimoire'),
    Boosts: listType('Grimoire.Game.Data.InventoryItem, Grimoire'),
    Drops: listType('System.String, mscorlib'),
    Items: listType('System.String, mscorlib'),
    NotifyUponDrop: listType('System.String, mscorlib')
};

const LIST_KEYS = Object.keys(LIST_TYPES);

// Command members carrying [JsonProperty(DefaultValueHandling = DefaultValueHandling.Include)].
// These are written even at their default, so a bot authored here is shaped like one the
// reference wrote; every other member is omitted while it equals its default, as Newtonsoft
// does. shortcut: this table transcribes one grep for the attribute at 816d9cd; it needs
// revisiting only if upstream adds an eighth forced member.
const WRITE_ALWAYS = {
    'Grimoire.Botting.Commands.Item.CmdSell, Grimoire': { Qty: '1' },
    // CmdMoveToCell2 is the jump-between-cells command; CmdMoveToCell carries only Cell and Pad.
    'Grimoire.Botting.Commands.Map.CmdMoveToCell2, Grimoire': { stop: false, maxcell: 5 },
    'Grimoire.Botting.Commands.Misc.CmdLoadBot, Grimoire': { PassDropList: true, PassSkillPreset: false },
    'Grimoire.Botting.Commands.Quest.CmdAcceptQuest, Grimoire': { ghostAccept: false },
    'Grimoire.Botting.Commands.Quest.CmdCompleteQuest, Grimoire': { ReAccept: false }
};

// Configuration properties in C# declaration order, with the value a reader must assume when
// the file omits the key. The two non-zero numbers are the reason the table exists at all:
// SkillDelay and optionDelay are initialisers, so an absent key is not 0.
const CONFIGURATION_FIELDS = [
    ['Commands', []],
    ['Skills', []],
    ['Quests', []],
    ['Author', null],
    ['Description', null],
    ['Boosts', []],
    ['Drops', []],
    ['Server', null],
    ['SkillDelay', 150],
    ['ExitCombatBeforeRest', false],
    ['ExitCombatBeforeQuest', false],
    ['EnablePickup', false],
    ['EnableRejection', false],
    ['EnablePickupAll', false],
    ['EnablePickupAcTagged', false],
    ['AutoRelogin', false],
    ['RelogDelay', 0],
    ['RelogRetryUponFailure', false],
    ['BotDelay', 0],
    ['WaitForAllSkills', false],
    ['WaitForSkill', false],
    ['SkipDelayIndexIf', false],
    ['InfiniteAttackRange', false],
    ['ProvokeMonsters', false],
    ['optionDelay', 500],
    ['respawnProvoke', false],
    ['EnemyMagnet', false],
    ['UseSkillZeroAutomatically', false],
    ['LagKiller', false],
    ['HidePlayers', false],
    ['SkipCutscenes', false],
    ['keepLagKiller', false],
    ['DisableAnimations', false],
    ['WalkSpeed', 0],
    ['NotifyUponDrop', []],
    ['RestIfMp', false],
    ['RestIfHp', false],
    ['RestMp', 0],
    ['RestHp', 0],
    ['RestartUponDeath', false],
    ['RestartOnAFK', false],
    ['Items', []],
    ['Packet', false],
    ['BankOnStop', false],
    ['AFK', false],
    ['AntiCounter', false],
    ['SkipAttack', false],
    ['FollowCheck', false],
    ['FollowName', null],
    ['RelogUponItemBuyFailure', null],
    ['AutoZone', null]
];

const ERRORS = {
    parse: 'This file is not a Grimlite bot (.gbot): it is not readable as a bot configuration.'
};

/** A list field in the shape the reference writes it: keyed by field name, never by $type. */
function wrapList(fieldKey, values) {
    const type = LIST_TYPES[fieldKey];
    if (!type) {
        throw new Error('[AquGrim:grimlite-parity] not a list field of a bot: ' + fieldKey);
    }
    return { $type: type, $values: Array.isArray(values) ? values : [] };
}

/**
 * Parse a .gbot. Lenient on purpose: the reference skips members it does not know
 * (MissingMemberHandling.Ignore) and so does this, so a bot an older or a newer build wrote
 * still opens. The list wrappers are unwrapped in place, and $type values stay put as the
 * ordinary properties they are to a JS reader.
 */
function parseBot(text) {
    if (typeof text !== 'string') return { ok: false, error: ERRORS.parse, bot: null };
    // A BOM or a trailing newline is not what the reference writes, but neither is worth
    // refusing a file over.
    const source = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
    let bot;
    try {
        bot = JSON.parse(source);
    } catch (error) {
        return { ok: false, error: ERRORS.parse, bot: null };
    }
    if (!bot || typeof bot !== 'object' || Array.isArray(bot)) {
        return { ok: false, error: ERRORS.parse, bot: null };
    }
    LIST_KEYS.forEach(function (key) {
        const field = bot[key];
        if (field && typeof field === 'object' && Array.isArray(field.$values)) {
            bot[key] = field.$values;
        }
    });
    return { ok: true, error: null, bot: bot };
}

/**
 * Write a .gbot the reference client can open: byte-exact $type strings, enums as the integers
 * they already are, UTF-8 with no BOM and no trailing newline. The eol option echoes the line
 * ending the file came in with, because the reference writes through .NET: a bot saved on
 * Windows is CRLF, and both line endings are in the corpus.
 */
function serializeBot(bot, options) {
    const opts = options || {};
    const document = bot && typeof bot === 'object' ? bot : {};
    const out = {};
    Object.keys(document).forEach(function (key) {
        const value = document[key];
        if (LIST_KEYS.indexOf(key) !== -1 && Array.isArray(value)) {
            out[key] = wrapList(key, value);
        } else {
            out[key] = value;
        }
    });
    const json = JSON.stringify(out, null, 2);
    return opts.eol && opts.eol !== '\n' ? json.split('\n').join(opts.eol) : json;
}

/**
 * The configuration a reader should act on: the document's own values, with the C# defaults
 * filled in for the keys the file omitted. A view for callers, never a thing to save - writing
 * it back would add every key the file deliberately left out.
 */
function configuration(bot) {
    const document = bot && typeof bot === 'object' ? bot : {};
    const config = {};
    CONFIGURATION_FIELDS.forEach(function (field) {
        const key = field[0];
        const fallback = field[1];
        const stored = document[key];
        if (stored === undefined) {
            config[key] = Array.isArray(fallback) ? [] : fallback;
        } else if (Array.isArray(fallback) && !Array.isArray(stored)) {
            config[key] = stored && Array.isArray(stored.$values) ? stored.$values : [];
        } else {
            config[key] = stored;
        }
    });
    return config;
}

/**
 * A bot's description as text. The reference stores plain text when that is shorter than
 * base64, and base64(gzip(text)) when it is not, deciding which on read by trying to decode
 * (DocConvert.IsBase64Encoded, then Unzip). Both shapes are in the corpus, so try the
 * compressed one first and fall back to the text.
 */
function description(bot) {
    const stored = bot && typeof bot === 'object' ? bot.Description : null;
    if (typeof stored !== 'string' || !stored) return '';
    const decoded = inflateBase64(stored);
    return decoded === null ? stored : decoded;
}

function inflateBase64(text) {
    // The reference's own shape: base64 only, and it must inflate to UTF-8.
    if (!/^[A-Za-z0-9+/=\s]+$/.test(text) || text.replace(/\s/g, '').length % 4 !== 0) return null;
    try {
        const zlib = require('zlib');
        return zlib.gunzipSync(Buffer.from(text, 'base64')).toString('utf8');
    } catch (error) {
        return null;
    }
}

/** Build a command of the given type, shaped the way the reference writes one. */
function newCommand(type, properties) {
    const forced = WRITE_ALWAYS[type] || {};
    const command = { $type: type };
    Object.keys(properties || {}).forEach(function (key) {
        command[key] = properties[key];
    });
    Object.keys(forced).forEach(function (key) {
        if (command[key] === undefined) command[key] = forced[key];
    });
    return command;
}

module.exports = {
    CONFIGURATION_TYPE: CONFIGURATION_TYPE,
    LIST_TYPES: LIST_TYPES,
    LIST_KEYS: LIST_KEYS,
    WRITE_ALWAYS: WRITE_ALWAYS,
    CONFIGURATION_FIELDS: CONFIGURATION_FIELDS,
    ERRORS: ERRORS,
    wrapList: wrapList,
    parseBot: parseBot,
    serializeBot: serializeBot,
    configuration: configuration,
    description: description,
    newCommand: newCommand
};
