// The Maid's class presets (ticket #43), as data. Reference: Grimoire/Tools/Maid/ClassPreset.cs,
// wired to the window's `cmbPreset` combo (MaidRemake.designer.cs:228-241, the combo's own order;
// MaidRemake.cs cmbPreset_SelectedIndexChanged:1318-1365, the switch).
//
// The reference's presets are C# methods that write the form's text boxes, so their whole content
// is what they set, and what they do NOT write keeps its previous value: AI and AM set neither the
// heal skill nor its percentage, so a preset applied after another one leaves the previous heal
// threshold standing. `heal` is the same shape of fact and worse - it is a **static field** on
// ClassPreset (`static bool heal = true`, :11), so a preset that never assigns it inherits whatever
// the last assigning preset left, and only LC, AI, CSH and CSH v2 ever assign it. That is why the
// table below carries `heal: null` for the ten presets that do not assign it, and why `apply`
// threads the carried value through rather than inventing one per preset.
//
// The dose of the effect is the reference's too: cbClear releases the two check boxes and cbSet
// re-ticks them from the carried `heal`, so BuffStopAttack ends up true for every preset and
// SafeSkill ends up whatever the carried flag says.

// `skills`        tbSkillList.Text, verbatim (including the 0 step CSH uses)
// `safeSkillList` tbHealSkill.Text; null when the preset does not write it (AI, AM)
// `safeSkillHP`   numHealthPercent.Value; null when the preset does not write it (AI, AM)
// `buffSkillList` tbBuffSkill.Text, verbatim
// `waitSkill`     cbWaitSkill.Checked
// `heal`          ClassPreset's own static `heal`; null when the method does not assign it

const ALL = [
    {
        name: 'EC',
        skills: '4,3,2,1,2,1,2,1,2',
        safeSkillList: '',
        safeSkillHP: 60,
        buffSkillList: '3',
        waitSkill: true,
        heal: null
    },
    {
        name: 'LC',
        skills: '1,2,4,1,2,4,3',
        safeSkillList: '3',
        safeSkillHP: 60,
        buffSkillList: '',
        waitSkill: false,
        heal: true
    },
    {
        name: 'LOO',
        skills: '2,1,3,4',
        safeSkillList: '',
        safeSkillHP: 60,
        buffSkillList: '1,2,3',
        waitSkill: false,
        heal: null
    },
    {
        name: 'SC',
        skills: '3,1,2,4',
        safeSkillList: '',
        safeSkillHP: 60,
        buffSkillList: '2,3',
        waitSkill: false,
        heal: null
    },
    {
        name: 'DOT',
        skills: '3,2,1,2,4,2',
        safeSkillList: '',
        safeSkillHP: 75,
        buffSkillList: '',
        waitSkill: true,
        heal: null
    },
    {
        name: 'AP',
        skills: '1,2,3',
        safeSkillList: '2',
        safeSkillHP: 60,
        buffSkillList: '2',
        waitSkill: false,
        heal: null
    },
    {
        name: 'AI',
        // AI and AM write only the skill list and the buff list: the heal skill and its
        // percentage keep whatever the form already had.
        skills: '2,3,4',
        safeSkillList: null,
        safeSkillHP: null,
        buffSkillList: '5',
        waitSkill: false,
        heal: false
    },
    {
        name: 'AM',
        skills: '2,3,1',
        safeSkillList: null,
        safeSkillHP: null,
        buffSkillList: '5',
        waitSkill: false,
        heal: null
    },
    {
        name: 'CCMD',
        skills: '1,1,1,1,3',
        safeSkillList: '2',
        safeSkillHP: 75,
        buffSkillList: '',
        waitSkill: true,
        heal: null
    },
    {
        name: 'SSOT',
        skills: '4,2,3,1,2',
        safeSkillList: '',
        safeSkillHP: 60,
        buffSkillList: '',
        waitSkill: true,
        heal: null
    },
    {
        name: 'NCM',
        skills: '1,2,4,1,2,1,3',
        safeSkillList: '',
        safeSkillHP: 60,
        buffSkillList: '',
        waitSkill: true,
        heal: null
    },
    {
        name: 'TK',
        skills: '1,2,1,4,1,3',
        safeSkillList: '',
        safeSkillHP: 60,
        buffSkillList: '',
        waitSkill: true,
        heal: null
    },
    {
        name: 'CSH',
        skills: '3,2,3,3,0,3,3,4,1',
        safeSkillList: '',
        safeSkillHP: 80,
        buffSkillList: '5',
        waitSkill: true,
        heal: false
    },
    {
        name: 'CSH v2',
        skills: '3,2,3,2,3,4,1',
        safeSkillList: '',
        safeSkillHP: 80,
        buffSkillList: '5',
        waitSkill: true,
        heal: false
    }
];

/** The combo's own order, which is the reference's own. */
function names() {
    return ALL.map(function (preset) { return preset.name; });
}

/** One preset by the name the combo shows, or null. */
function byName(name) {
    const wanted = String(name === null || name === undefined ? '' : name);
    for (let i = 0; i < ALL.length; i++) {
        if (ALL[i].name === wanted) return ALL[i];
    }
    return null;
}


/**
 * Apply one preset over a config state, as cmbPreset_SelectedIndexChanged does: cbClear, the
 * preset's own writes, then cbSet.
 *
 * Two subtleties are the reference's rather than the port's:
 *   * the preset's own `heal` assignment (or the absence of one) is carried by `ClassPreset.heal`
 *     across calls, so the carried value is a parameter here and the updated one is answered back;
 *   * a text box the preset writes as Empty is cleared, and the reference's own ApplyConfig is not
 *     involved - the box is written directly - so the two "clear" writes are held in `clears`
 *     rather than routed through the file's overlay (which treats '' as "leave it").
 *
 * Answers {config, heal} - the new state and the flag to carry into the next call.
 */
function applyTo(preset, current, carriedHeal) {
    const state = Object.assign({}, current || {});
    const heal = preset && preset.heal !== null && preset.heal !== undefined
        ? preset.heal === true
        : (carriedHeal === undefined ? true : carriedHeal === true);
    if (!preset) return { config: state, heal: heal };

    state.SkillList = preset.skills;
    state.BuffStopAttackList = preset.buffSkillList;
    state.WaitSkill = preset.waitSkill === true;
    if (preset.safeSkillList !== null && preset.safeSkillList !== undefined) state.SafeSkillList = preset.safeSkillList;
    if (typeof preset.safeSkillHP === 'number') state.SafeSkillHP = preset.safeSkillHP;
    // cbSet: BuffStopAttack is re-ticked for every preset, SafeSkill follows the carried flag.
    state.BuffStopAttack = true;
    state.SafeSkill = heal;
    return { config: state, heal: heal };
}

/**
 * The same thing as a config patch, for a caller that applies it through `config.apply`: only the
 * keys the preset really writes, with the carried heal values made explicit. `''` stays out, because
 * `config.apply` reads an empty string as "leave the box as it is" - which is exactly what the
 * reference's own ApplyConfig does with a file, and exactly what a preset does NOT do. Use
 * `applyTo` when the cleared boxes have to be cleared.
 */
function patch(preset, carriedHeal) {
    const out = {};
    if (!preset) return out;
    out.SkillList = preset.skills;
    out.BuffStopAttackList = preset.buffSkillList;
    out.WaitSkill = preset.waitSkill === true;
    out.BuffStopAttack = true;
    out.SafeSkill = preset.heal !== null && preset.heal !== undefined
        ? preset.heal === true
        : carriedHeal === undefined ? true : carriedHeal === true;
    if (preset.safeSkillList !== null && preset.safeSkillList !== undefined && preset.safeSkillList !== '') {
        out.SafeSkillList = preset.safeSkillList;
    }
    if (typeof preset.safeSkillHP === 'number') out.SafeSkillHP = preset.safeSkillHP;
    return out;
}

module.exports = {
    ALL: ALL,
    names: names,
    byName: byName,
    patch: patch,
    applyTo: applyTo
};
