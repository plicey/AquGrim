// Auto Attack's skill presets. Reference: Grimoire/UI/Root.cs:1515-1585 (getSkillPreset)
// and Tools/ClientConfig.cs: `SS.<CLASS>=...` in ClientConfig.cfg.
//
// A saved preset always has a class and a name. The editor can hold one unsaved draft for the
// detected class; selecting a preset loads that saved text into the draft and applies it at once.
// Edits stay in the draft and are read the next time Auto Attack is enabled. Save only writes the
// draft to its named preset; it does not reload or apply anything.
//
// Skills are separated by ';' (the reference's form) or ',' (common in hand-written configs).
// One safe condition may follow a skill: `3:SH>60` or `2:SM<30`. `wait` makes every normal skill
// wait out its own cooldown. With no draft, the caller falls back to skills 1-4.

const fs = require('fs');
const path = require('path');

const STORE_NAMESPACE = 'auto-attack';
const STORE_KEY = 'autoAttackPresets';
const SELECTION_KEY = 'autoAttackSelectedPresets';
const CONFIG_FILE = 'ClientConfig.cfg';
const FILE_PRESET_NAME = 'ClientConfig';
const DEFAULT_SKILLS = [
    { index: '1', safe: false, wait: false },
    { index: '2', safe: false, wait: false },
    { index: '3', safe: false, wait: false },
    { index: '4', safe: false, wait: false }
];

function defaultSkills() {
    return DEFAULT_SKILLS.map(function (skill) { return Object.assign({}, skill); });
}

/** One preset value into the skills the loop runs. */
function parsePreset(value) {
    let text = String(value === null || value === undefined ? '' : value);
    const wait = /wait/i.test(text);
    text = text.replace(/wait/gi, '');

    const skills = [];
    text.split(/[;,\r\n]/).forEach(function (part) {
        const token = part.trim();
        if (!token) return;
        const safe = /^([^:]+):\s*(SH|SM)\s*([<>]=?|=)\s*(\d+)$/i.exec(token);
        if (safe) {
            skills.push({
                index: safe[1].trim(),
                safe: true,
                isMp: safe[2].toUpperCase() === 'SM',
                op: safe[3],
                value: Number(safe[4]),
                wait: false
            });
            return;
        }
        const index = token.split(':')[0].trim();
        if (index) skills.push({ index: index, safe: false, wait: wait });
    });
    return skills;
}

/** The raw `SS.<CLASS>=...` values, before they are parsed into skill rows. */
function parseConfigValues(text) {
    const values = {};
    String(text === null || text === undefined ? '' : text).split(/\r?\n/).forEach(function (line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) === '#' || trimmed.charAt(0) === ';') return;
        const split = trimmed.indexOf('=');
        if (split === -1) return;
        const key = trimmed.slice(0, split).trim();
        if (!/^SS\./i.test(key)) return;
        const className = key.slice(3).trim().toUpperCase();
        const value = trimmed.slice(split + 1).trim();
        if (className && value) values[className] = value;
    });
    return values;
}

/** A ClientConfig.cfg text into { CLASS: [skills] }, keys upper-cased like the reference. */
function parseConfig(text) {
    const raw = parseConfigValues(text);
    const presets = {};
    Object.keys(raw).forEach(function (className) {
        const skills = parsePreset(raw[className]);
        if (skills.length) presets[className] = skills;
    });
    return presets;
}

function candidateFiles(appDataDirectory) {
    if (!appDataDirectory) return [];
    return [
        path.join(appDataDirectory, CONFIG_FILE),
        path.join(appDataDirectory, 'plugins', 'grimlite-parity', CONFIG_FILE)
    ];
}

function classKey(value) {
    return String(value === null || value === undefined ? '' : value).trim().toUpperCase();
}

function cleanName(value) {
    return String(value === null || value === undefined ? '' : value).trim();
}

function copyDraft(draft) {
    if (!draft) return null;
    return {
        className: draft.className,
        name: draft.name,
        text: draft.text,
        skills: parsePreset(draft.text)
    };
}

/**
 * @param {object} deps
 * @param {string} deps.appDataDirectory the app's data directory, where ClientConfig.cfg lives
 * @param {object} [deps.store] the plugin's auto-attack store (namespaced by the Host)
 * @param {Array<string>} [deps.files] explicit config paths, for tests
 * @param {Function} [deps.readFile] reader seam, for tests
 */
function createPresetSource(deps) {
    deps = deps || {};
    const store = deps.store || null;
    const files = Array.isArray(deps.files) ? deps.files : candidateFiles(deps.appDataDirectory);
    const readFile = deps.readFile || function (file) { return fs.readFileSync(file, 'utf8'); };
    let fileValues = {};
    let draft = null;

    function stored() {
        if (!store || typeof store.read !== 'function') return {};
        try { return store.read() || {}; } catch (error) { return {}; }
    }

    /** Only named class presets from the new nested store shape are read. */
    function storedPresets(className) {
        const tree = stored()[STORE_KEY];
        const node = tree && typeof tree === 'object' && !Array.isArray(tree)
            ? tree[classKey(className)] : null;
        if (!node || typeof node !== 'object' || Array.isArray(node)) return {};
        const out = {};
        Object.keys(node).forEach(function (name) {
            if (cleanName(name) && typeof node[name] === 'string') out[name] = node[name];
        });
        return out;
    }

    function rawForClass(className) {
        const key = classKey(className);
        const out = {};
        if (key && fileValues[key]) {
            out[FILE_PRESET_NAME] = { text: fileValues[key], stored: false };
        }
        const saved = storedPresets(key);
        Object.keys(saved).forEach(function (name) {
            out[name] = { text: saved[name], stored: true };
        });
        return out;
    }

    function presetList(className) {
        const raw = rawForClass(className);
        return Object.keys(raw).sort(function (a, b) {
            return a.toLowerCase().localeCompare(b.toLowerCase());
        }).map(function (name) {
            return {
                name: name,
                text: raw[name].text,
                stored: raw[name].stored,
                skills: parsePreset(raw[name].text)
            };
        });
    }

    function reload() {
        let text = null;
        for (let i = 0; i < files.length && text === null; i++) {
            try {
                text = readFile(files[i]);
            } catch (error) {
                // Try the next place the user may have put the file.
            }
        }
        fileValues = text === null ? {} : parseConfigValues(text);
        return presetList(draft && draft.className);
    }

    function writeStored(name, value) {
        if (!store || typeof store.write !== 'function') {
            throw new Error('this build cannot save Auto Attack presets');
        }
        const data = Object.assign({}, stored());
        const tree = data[STORE_KEY] && typeof data[STORE_KEY] === 'object' && !Array.isArray(data[STORE_KEY])
            ? Object.assign({}, data[STORE_KEY]) : {};
        const key = classKey(name.className);
        const existing = tree[key] && typeof tree[key] === 'object' && !Array.isArray(tree[key])
            ? Object.assign({}, tree[key]) : {};
        if (value === null) delete existing[name.preset];
        else existing[name.preset] = value;
        if (Object.keys(existing).length) tree[key] = existing;
        else delete tree[key];
        if (Object.keys(tree).length) data[STORE_KEY] = tree;
        else delete data[STORE_KEY];
        store.write(data);
    }

    function rememberedName(className) {
        const selections = stored()[SELECTION_KEY];
        return selections && typeof selections === 'object' && !Array.isArray(selections) &&
            typeof selections[classKey(className)] === 'string'
            ? selections[classKey(className)] : null;
    }

    function remember(className, name) {
        if (!store || typeof store.write !== 'function') return;
        const key = classKey(className);
        if (!key) return;
        const data = Object.assign({}, stored());
        const previous = data[SELECTION_KEY];
        const selections = previous && typeof previous === 'object' && !Array.isArray(previous)
            ? Object.assign({}, previous) : {};
        if (name) selections[key] = name;
        else delete selections[key];
        if (Object.keys(selections).length) data[SELECTION_KEY] = selections;
        else delete data[SELECTION_KEY];
        store.write(data);
    }

    function findName(className, name) {
        const wanted = cleanName(name).toLowerCase();
        if (!wanted) return null;
        const raw = rawForClass(className);
        return Object.keys(raw).find(function (one) {
            return one.toLowerCase() === wanted;
        }) || null;
    }

    function savePreset(className, name, text) {
        const key = classKey(className);
        const preset = cleanName(name);
        const value = String(text === null || text === undefined ? '' : text);
        if (!key) throw new Error('choose a class before saving');
        if (!preset) throw new Error('enter a preset name before saving');
        if (!value.trim()) throw new Error('enter a skill rotation before saving');
        // Saving "boss" over "Boss" updates that preset rather than creating a look-alike.
        const storedName = findName(key, preset) || preset;
        writeStored({ className: key, preset: storedName }, value);
        return presetList(key);
    }

    function deletePreset(className, name) {
        const key = classKey(className);
        const preset = findName(key, name);
        if (!preset) return presetList(key);
        writeStored({ className: key, preset: preset }, null);
        if (cleanName(rememberedName(key)).toLowerCase() === preset.toLowerCase()) remember(key, null);
        if (draft && draft.className === key &&
            String(draft.name || '').toLowerCase() === preset.toLowerCase()) draft.name = null;
        return presetList(key);
    }

    function setDraft(className, text, name) {
        draft = {
            className: classKey(className),
            name: cleanName(name) || null,
            text: String(text === null || text === undefined ? '' : text)
        };
        return copyDraft(draft);
    }

    function draftFor(className) {
        const key = classKey(className);
        if (draft && draft.className === key) {
            if (!draft.name || findName(key, draft.name)) return copyDraft(draft);
            remember(key, null);
            draft.name = null;
            return copyDraft(draft);
        }
        const remembered = rememberedName(key);
        const preset = findName(key, remembered);
        if (!preset) {
            if (remembered) remember(key, null);
            return null;
        }
        return setDraft(key, rawForClass(key)[preset].text, preset);
    }

    function clearDraft(className) {
        remember(className || (draft && draft.className), null);
        if (!className || (draft && draft.className === classKey(className))) draft = null;
        return null;
    }

    function loadPreset(className, name) {
        const key = classKey(className);
        const preset = findName(key, name);
        if (!preset) return null;
        const raw = rawForClass(key)[preset];
        remember(key, preset);
        return setDraft(key, raw.text, preset);
    }

    reload();

    return {
        reload: reload,
        presetList: presetList,
        rawForClass: rawForClass,
        savePreset: savePreset,
        deletePreset: deletePreset,
        loadPreset: loadPreset,
        setDraft: setDraft,
        draftFor: draftFor,
        clearDraft: clearDraft
    };
}

module.exports = {
    STORE_NAMESPACE: STORE_NAMESPACE,
    STORE_KEY: STORE_KEY,
    SELECTION_KEY: SELECTION_KEY,
    CONFIG_FILE: CONFIG_FILE,
    FILE_PRESET_NAME: FILE_PRESET_NAME,
    DEFAULT_SKILLS: DEFAULT_SKILLS,
    defaultSkills: defaultSkills,
    parsePreset: parsePreset,
    parseConfigValues: parseConfigValues,
    parseConfig: parseConfig,
    candidateFiles: candidateFiles,
    createPresetSource: createPresetSource
};
