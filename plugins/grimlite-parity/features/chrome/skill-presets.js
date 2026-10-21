// Auto Attack's per-class rotations. Reference: Grimoire/UI/Root.cs:1515-1585 (getSkillPreset)
// and Tools/ClientConfig.cs: the lines are `SS.<CLASS>=...` in ClientConfig.cfg. The reference
// separates skills with ';'; the same parser accepts ',' because ClientConfig values are often
// written that way by hand.
//
// A skill may carry one safe condition: `3:SH>60` casts skill 3 only above 60% health, and
// `2:SM<30` only below 30% mana. `wait` anywhere in the value makes every normal skill wait out
// its own cooldown, exactly as the reference's Replace("wait", "") does. With no matching class
// the caller falls back to skills 1-4.
//
// Where the user edits them: the same ClientConfig.cfg in the app data directory, or the
// `autoAttackPresets` object in the plugin's `auto-attack` store
// (aquastar.grimlite-parity.auto-attack.json). Both are read at startup and store values win.

const fs = require('fs');
const path = require('path');

const STORE_NAMESPACE = 'auto-attack';
const STORE_KEY = 'autoAttackPresets';
const SKILL_SET_KEY = 'autoAttackSkillSet';
const CONFIG_FILE = 'ClientConfig.cfg';
const DEFAULT_SKILLS = [
    { index: '1', safe: false, wait: false },
    { index: '2', safe: false, wait: false },
    { index: '3', safe: false, wait: false },
    { index: '4', safe: false, wait: false }
];

function defaultSkills() {
    return DEFAULT_SKILLS.map(function (skill) { return Object.assign({}, skill); });
}

/** One `SS.<CLASS>` value into the skills the loop runs. */
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

/** A ClientConfig.cfg text into { CLASS: [skills] }, keys upper-cased like the reference. */
function parseConfig(text) {
    const presets = {};
    String(text === null || text === undefined ? '' : text).split(/\r?\n/).forEach(function (line) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.charAt(0) === '#' || trimmed.charAt(0) === ';') return;
        const split = trimmed.indexOf('=');
        if (split === -1) return;
        const key = trimmed.slice(0, split).trim();
        if (!/^SS\./i.test(key)) return;
        const className = key.slice(3).trim().toUpperCase();
        if (!className) return;
        const skills = parsePreset(trimmed.slice(split + 1));
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

/**
 * @param {object} deps
 * @param {string} deps.appDataDirectory the app's data directory, where the reference keeps cfg
 * @param {object} [deps.store] the plugin's auto-attack store (namespaced by the Host)
 * @param {Array<string>} [deps.files] explicit config paths, for tests
 * @param {Function} [deps.readFile] reader seam, for tests
 */
function createPresetSource(deps) {
    deps = deps || {};
    const store = deps.store || null;
    const files = Array.isArray(deps.files) ? deps.files : candidateFiles(deps.appDataDirectory);
    const readFile = deps.readFile || function (file) { return fs.readFileSync(file, 'utf8'); };
    let presets = {};
    let autoSkills = [];

    function stored() {
        if (!store || typeof store.read !== 'function') return {};
        try { return store.read() || {}; } catch (error) { return {}; }
    }

    function configuredSkillSet() {
        if (typeof deps.skillSet === 'function') return deps.skillSet();
        if (typeof deps.skillSet === 'string') return deps.skillSet;
        const data = stored();
        return data && typeof data[SKILL_SET_KEY] === 'string' ? data[SKILL_SET_KEY] : '';
    }

    function storePresets() {
        if (!store || typeof store.read !== 'function') return {};
        let stored;
        try {
            stored = store.read();
        } catch (error) {
            return {};
        }
        const values = stored && stored[STORE_KEY] && typeof stored[STORE_KEY] === 'object'
            ? stored[STORE_KEY]
            : (stored && typeof stored === 'object' ? stored : {});
        const out = {};
        Object.keys(values).forEach(function (key) {
            if (key === STORE_KEY) return;
            const className = key.replace(/^SS\./i, '').trim().toUpperCase();
            if (!className || typeof values[key] !== 'string') return;
            const skills = parsePreset(values[key]);
            if (skills.length) out[className] = skills;
        });
        return out;
    }

    function reload() {
        let fileText = null;
        for (let i = 0; i < files.length && fileText === null; i++) {
            try {
                fileText = readFile(files[i]);
            } catch (error) {
                // Try the next place the user may have put the file.
            }
        }
        presets = fileText === null ? {} : parseConfig(fileText);
        Object.assign(presets, storePresets());
        autoSkills = parsePreset(configuredSkillSet());
        return presets;
    }

    reload();

    return {
        reload: reload,
        presets: function () { return Object.assign({}, presets); },
        forClass: function (className) {
            const key = String(className === null || className === undefined ? '' : className)
                .trim().toUpperCase();
            const found = presets[key];
            return found ? found.map(function (skill) { return Object.assign({}, skill); }) : [];
        },
        custom: function () {
            return autoSkills.map(function (skill) { return Object.assign({}, skill); });
        },
        setCustom: function (text) {
            if (!store || typeof store.write !== 'function') return [];
            const data = Object.assign({}, stored());
            data[SKILL_SET_KEY] = String(text == null ? '' : text);
            store.write(data);
            reload();
            return this.custom();
        },
        rawCustom: function () {
            return String(configuredSkillSet() || '');
        }
    };
}

module.exports = {
    STORE_NAMESPACE: STORE_NAMESPACE,
    STORE_KEY: STORE_KEY,
    SKILL_SET_KEY: SKILL_SET_KEY,
    CONFIG_FILE: CONFIG_FILE,
    DEFAULT_SKILLS: DEFAULT_SKILLS,
    defaultSkills: defaultSkills,
    parsePreset: parsePreset,
    parseConfig: parseConfig,
    candidateFiles: candidateFiles,
    createPresetSource: createPresetSource
};
