// The aura, target and combat statements (ticket #42), as one table the engine merges in.
//
// Each handler is the body of the reference's own class under
// Grimoire/Botting/Commands/Misc/Statements/, and each carries its source beside it, because
// several of these read the opposite way round from their name: the skip condition is what the C#
// actually writes, and a port that "fixes" it to match the label changes what a bot does. The
// ones worth naming:
//
//   CmdPlayerAuraGreaterThan   skips on `aura <= x`, so it holds only strictly above
//   CmdPlayerAuraLessThan      skips on `aura >= x`, so it holds only strictly below
//   CmdTargetAuraDuration      skips on `ms > x || ms == 0`, so the row ("less than") holds AT x
//   CmdTargetHealth*           hold AT their bound (they skip on `<` and `>` respectively)
//   CmdTargetHealthBetween     an OPEN interval, and no comma at all means skip
//
// Four shared behaviours, in one place:
//
//   * An aura comes from the tapped cache (auras.js), which is where the reference's own handlers
//     put it, and never from a game read: `Player.GetAuras` is `AuraManager.SelfAura` for a name
//     that is not "locked" and a `GetAurasValue` call for anything else, and ticket #42 rules the
//     cache the source for the target statements too rather than the lookup reading the avatar's
//     live array one frame stale. Both lookup names stay refused in loader-surface.js, with a
//     reason that points here.
//   * Every duration comparison is in MILLISECONDS (auras.js derives them from the wire's
//     seconds, which is the unit the cache stores).
//   * A read that cannot be established is a reason, never a value: the statement reports it and
//     does not hold, so the command under it never runs on a game this build could not read.
//   * A statement's own Default operand (CmdTargetHealth*'s Value2) decides the branch when there
//     is no target, exactly as the reference writes it, and nothing is read from a target that is
//     not there.
//
/** The reference's int.TryParse: a value that will not parse leaves the caller's 0 in place. */
function asInt(value) {
    const parsed = parseInt(String(value), 10);
    return isNaN(parsed) ? 0 : parsed;
}

/**
 * Cmd*'s own operand rule: `IsVar(Value) ? Tempvariable[GetVar(Value)] : Value`. A variable that
 * has never been set is left as written rather than resolving to undefined.
 */
function operand(ctx, value) {
    if (!ctx.isVar(value)) return value;
    const key = ctx.getVar(value);
    const vars = ctx.vars;
    return Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : value;
}

function message(error) {
    return (error && error.message) || String(error);
}

/**
 * One session read, or the reason it could not be made. A refusal is *returned*, never thrown:
 * the engine's contract for a statement handler is a string to say why it did not hold.
 *
 * @param {object} ctx the engine's context
 * @param {string} what what the statement was asking for, for the log
 * @param {string} member the session member the read goes through
 * @param {Array} [args] its own arguments
 * @returns {Promise<{ok: true, value: any} | {ok: false, why: string}>}
 */
async function read(ctx, what, member, args) {
    const session = ctx.session;
    const fn = session && session[member];
    if (typeof fn !== 'function') {
        return { ok: false, why: what + ': this session cannot be asked to ' + member };
    }
    try {
        return { ok: true, value: await fn.apply(session, args || []) };
    } catch (error) {
        return { ok: false, why: what + ': ' + message(error) };
    }
}

/** The same read, as a number the statement can compare. */
async function number(ctx, what, member, args) {
    const answer = await read(ctx, what, member, args);
    if (!answer.ok) return answer;
    const value = Number(answer.value);
    if (!isFinite(value)) {
        return { ok: false, why: what + ' is not a number the session answered (' +
            JSON.stringify(answer.value) + ')' };
    }
    return { ok: true, value: value };
}

/**
 * A read that could not be established: report the reason, and move past the command under the
 * statement too. The index below a statement is what the reference moves to skip its command, so
 * leaving it alone would run a command the statement could not decide about - the one outcome
 * worse than not holding.
 */
function unreadable(ctx, answer) {
    ctx.skipNext();
    return answer.why;
}

// CmdPlayerAuraEquals / GreaterThan / LessThan: `Player.GetAuras(true, Aura)` - this character's
// own stacks, which the reference serves from its tapped cache - against int.TryParse(Value2).
function playerAura(holds) {
    return async function (ctx, command) {
        const name = operand(ctx, command.Value1);
        const wanted = operand(ctx, command.Value2);
        const told = await number(ctx, 'Player aura "' + name + '"', 'selfAura', [name]);
        if (!told.ok) return unreadable(ctx, told);
        if (!holds(told.value, asInt(wanted))) ctx.skipNext();
        return undefined;
    };
}

// CmdTargetAuraEquals / GreaterThan / LessThan: the same call with `false` -
// `Player.GetAuras(false, Aura)` is the target's aura, not this character's.
function targetAura(holds) {
    return async function (ctx, command) {
        const name = operand(ctx, command.Value1);
        const wanted = operand(ctx, command.Value2);
        const told = await number(ctx, 'Target aura "' + name + '"', 'targetAura', [name]);
        if (!told.ok) return unreadable(ctx, told);
        if (!holds(told.value, asInt(wanted))) ctx.skipNext();
        return undefined;
    };
}

/** Player.HasTarget, the loader's own helper (its body is the target's intHP > 0). */
async function hasTarget(ctx) {
    const answer = await read(ctx, 'Is has target', 'hasTarget', []);
    if (!answer.ok) return answer;
    const value = answer.value;
    return { ok: true, value: value === true || value === 1 || value === 'true' };
}

/**
 * The target-health statements' shared prologue: a live target, or the statement's own Default.
 *
 * @returns {Promise<{decided: boolean, skip?: boolean, health?: number, why?: string}>}
 */
async function targetHealth(ctx, command) {
    const targeted = await hasTarget(ctx);
    if (!targeted.ok) return { decided: true, why: targeted.why };
    if (!targeted.value) {
        // `if (!Player.HasTarget) { if (Default.ToLower() == "false") Index++; return; }`
        const fallback = operand(ctx, command.Value2);
        const written = fallback === undefined || fallback === null ? '' : String(fallback);
        return { decided: true, skip: written.toLowerCase() === 'false' };
    }
    const health = await number(ctx, 'Target health', 'targetHealth', []);
    if (!health.ok) return { decided: true, why: health.why };
    return { decided: false, health: health.value };
}

const handlers = {
    // ---- auras ----------------------------------------------------------------------------
    CmdPlayerAuraEquals: playerAura(function (aura, x) { return aura === x; }),
    // `if (auraValue <= x) Index++`
    CmdPlayerAuraGreaterThan: playerAura(function (aura, x) { return aura > x; }),
    // `if (auraValue >= x) Index++`
    CmdPlayerAuraLessThan: playerAura(function (aura, x) { return aura < x; }),
    CmdTargetAuraEquals: targetAura(function (aura, x) { return aura === x; }),
    CmdTargetAuraGreaterThan: targetAura(function (aura, x) { return aura > x; }),
    CmdTargetAuraLessThan: targetAura(function (aura, x) { return aura < x; }),

    CmdTargetAuraDuration: async function (ctx, command) {
        // `int CurrentDuration = AuraManager.EnemyAura(targetId).GetRemainingTime(AuraName);`
        // `int.TryParse(TargetDuration, out int x);`   ("x = 0 means aura not active")
        // `if (CurrentDuration > x || CurrentDuration == 0) instance.Index++;`
        //
        // GetRemainingTime is MILLISECONDS (PlayerAura.Refresh: TickCount + dur * 1000) and the
        // row's own label says so ("< {Value2}ms"). The `== 0` clause is the reference's way of
        // saying "that aura is not on that monster", so a missing aura must not hold - otherwise
        // a bot reads a spell that was never cast as one that is about to expire.
        const name = ctx.resolve(command.Value1);
        const wanted = asInt(ctx.resolve(command.Value2));
        const id = Number(command.targetId) || 0;
        const left = await number(ctx, 'Aura duration on monster ' + id,
            'monsterAuraDuration', [id, name]);
        if (!left.ok) return unreadable(ctx, left);
        if (left.value > wanted || left.value === 0) ctx.skipNext();
        return undefined;
    },

    // ---- targets and combat ----------------------------------------------------------------
    CmdHasTarget: async function (ctx) {
        // if (!Player.HasTarget) Index++
        const answer = await hasTarget(ctx);
        if (!answer.ok) return unreadable(ctx, answer);
        if (!answer.value) ctx.skipNext();
        return undefined;
    },
    CmdNotHasTarget: async function (ctx) {
        // if (Player.HasTarget) Index++
        const answer = await hasTarget(ctx);
        if (!answer.ok) return unreadable(ctx, answer);
        if (answer.value) ctx.skipNext();
        return undefined;
    },
    CmdInCombat: async function (ctx) {
        // Player.State { Dead, Idle, InCombat } and the loader's State is dataLeaf.intState, so
        // `if (Player.CurrentState != Player.State.InCombat) Index++` compares with 2.
        const state = await number(ctx, 'State', 'state', []);
        if (!state.ok) return unreadable(ctx, state);
        if (state.value !== 2) ctx.skipNext();
        return undefined;
    },
    CmdNotInCombat: async function (ctx) {
        // if (Player.CurrentState == Player.State.InCombat) Index++
        const state = await number(ctx, 'State', 'state', []);
        if (!state.ok) return unreadable(ctx, state);
        if (state.value === 2) ctx.skipNext();
        return undefined;
    },

    CmdTargetHealthGreaterThan: async function (ctx, command) {
        // `int.TryParse(CheckHealth, out int i);` `if (Player.GetTargetHealth() < i) Index++;`
        const found = await targetHealth(ctx, command);
        if (found.why) return unreadable(ctx, found);
        if (found.decided) { if (found.skip) ctx.skipNext(); return undefined; }
        if (found.health < asInt(operand(ctx, command.Value1))) ctx.skipNext();
        return undefined;
    },
    CmdTargetHealthLessThan: async function (ctx, command) {
        // `if (Player.GetTargetHealth() > i) Index++;`
        const found = await targetHealth(ctx, command);
        if (found.why) return unreadable(ctx, found);
        if (found.decided) { if (found.skip) ctx.skipNext(); return undefined; }
        if (found.health > asInt(operand(ctx, command.Value1))) ctx.skipNext();
        return undefined;
    },
    CmdTargetHealthBetween: async function (ctx, command) {
        // `if (CheckHealth.Contains(",")) { ... if (health > s && health < e) return; } Index++;`
        // - an interval with neither end included, and a value with no comma skips uncompared.
        const found = await targetHealth(ctx, command);
        if (found.why) return unreadable(ctx, found);
        if (found.decided) { if (found.skip) ctx.skipNext(); return undefined; }
        const written = String(operand(ctx, command.Value1));
        if (written.indexOf(',') !== -1) {
            const bounds = written.split(',');
            const inside = found.health > asInt(bounds[0]) && found.health < asInt(bounds[1]);
            if (inside) return undefined;
        }
        ctx.skipNext();
        return undefined;
    },

    // ---- this player and the field ---------------------------------------------------------
    CmdNameEquals: async function (ctx, command) {
        // `(IsVar(Value1) ? Tempvariable[GetVar(Value1)] : Value1).Equals(Player.Username,
        // StringComparison.OrdinalIgnoreCase)` - folded. Player.Username is the reference's own
        // loader's GetUsername (#35); this build asks the session, which reads the field the
        // loader itself assigns that name to, and which is the same read {PLAYERNAME} uses.
        const wanted = operand(ctx, command.Value1);
        const answer = await read(ctx, 'Name equals', 'username', []);
        if (!answer.ok) return unreadable(ctx, answer);
        const actual = answer.value === null || answer.value === undefined ? '' : String(answer.value);
        if (String(wanted).toLowerCase() !== actual.toLowerCase()) ctx.skipNext();
        return undefined;
    },

    CmdSpecialAnims: async function (ctx, command) {
        // Two modes. With no skill index it is a plain conditional: skip while the last animation
        // message has not appeared, consume the message on a match. With one it casts that skill
        // through Player.ForceUseSkill and never skips. That call used to be refused by the loader
        // surface (its argument is a live action object); ticket #49 made it answer, so this casts
        // for real rather than reporting a cast it could not make.
        const raw = ctx.resolve(command.Value1);
        const terms = String(raw === undefined || raw === null ? '' : raw).toLowerCase()
            .split(',')
            .map(function (one) { return one.trim(); })
            .filter(function (one) { return one.length > 0; });
        const skill = String(ctx.resolve(command.Value2) || '').trim();

        const seen = await read(ctx, 'Special Anims', 'lastAnimationMessage', []);
        if (!seen.ok) return unreadable(ctx, seen);
        const last = String(seen.value === undefined || seen.value === null ? '' : seen.value)
            .toLowerCase();
        const matched = last.length > 0 && terms.some(function (term) {
            return last.indexOf(term) !== -1;
        });

        if (skill.length) {
            if (!matched) return undefined;
            await read(ctx, 'Special Anims', 'consumeAnimation', []);
            // The reference's own body: wait the cooldown out in bounded steps (three tries, each
            // never longer than a second), force the cast, then re-read the readiness - a skill
            // still ready after the cast did not fire, and is forced exactly once more.
            let attempts = 3;
            while (attempts-- > 0) {
                const ready = await read(ctx, 'Special Anims', 'skillAvailable', [skill]);
                if (!ready.ok) return 'CmdSpecialAnims could not tell whether skill ' + skill +
                    ' is ready: ' + ready.why;
                if (Number(ready.value) <= 0) break;
                await ctx.sleep(Math.min(Number(ready.value), 1000));
            }
            const cast = await read(ctx, 'Special Anims', 'forceUseSkill', [skill]);
            if (!cast.ok) return 'CmdSpecialAnims could not cast skill ' + skill + ': ' + cast.why;
            await ctx.sleep(150);
            const after = await read(ctx, 'Special Anims', 'skillAvailable', [skill]);
            if (after.ok && Number(after.value) <= 0) {
                const retry = await read(ctx, 'Special Anims', 'forceUseSkill', [skill]);
                if (!retry.ok) return 'CmdSpecialAnims could not cast skill ' + skill + ': ' + retry.why;
            }
            return undefined;
        }
        if (!matched) {
            ctx.skipNext();
            return undefined;
        }
        await read(ctx, 'Special Anims', 'consumeAnimation', []);
        return undefined;
    },

    CmdDelayedAnims: async function (ctx, command) {
        // CmdSpecialAnims.cs:124-219 - a matching animation or aura schedules one background task
        // that waits delayPreskill, pauses the bot, waits out the skill's cooldown (at most 1.5s),
        // attacks the target and force-casts the skill. A task already pending swallows the match.
        const raw = ctx.resolve(command.Value1);
        const terms = String(raw === undefined || raw === null ? '' : raw).toLowerCase()
            .split(',')
            .map(function (one) { return one.trim(); })
            .filter(function (one) { return one.length > 0; });
        const skill = String(ctx.resolve(command.Value2) || '').trim();
        if (!skill || ctx.delayed.pending) return undefined;

        const seen = await read(ctx, 'Delayed Anims', 'lastAnimationMessage', []);
        if (!seen.ok) return unreadable(ctx, seen);
        const last = String(seen.value === undefined || seen.value === null ? '' : seen.value)
            .toLowerCase();
        const matched = last.length > 0 && terms.some(function (term) {
            return last.indexOf(term) !== -1;
        });
        const auraAnswer = await read(ctx, 'Delayed Anims', 'lastAuraMessages', []);
        const auraMessages = auraAnswer.ok && Array.isArray(auraAnswer.value) ? auraAnswer.value : [];
        const auramatch = terms.some(function (term) {
            return auraMessages.some(function (message) {
                return term.indexOf(String(message)) !== -1;
            });
        });
        if (!matched && !auramatch) return undefined;

        if (matched) {
            await read(ctx, 'Delayed Anims', 'consumeAnimation', []);
        }
        if (auramatch) {
            await read(ctx, 'Delayed Anims', 'clearAuraMessages', []);
        }

        const target = String(ctx.resolve(command.target === undefined ? '*' : command.target));
        const delay = Math.max(0, Number(command.delayPreskill) || 0);
        ctx.delayed.pending = true;
        Promise.resolve().then(async function () {
            try {
                await ctx.sleep(delay);
                if (!ctx.running()) return;
                ctx.pauseFor(true);
                const ready = await read(ctx, 'Delayed Anims', 'skillAvailable', [skill]);
                const wait = ready.ok ? Math.min(Math.max(0, Number(ready.value) || 0), 1500) : 0;
                await ctx.sleep(wait);
                if (!ctx.running()) return;
                await read(ctx, 'Delayed Anims', 'attackMonster', [target]);
                await read(ctx, 'Delayed Anims', 'forceUseSkill', [skill]);
            } finally {
                ctx.pauseFor(false);
                ctx.delayed.pending = false;
            }
        }).catch(function (error) {
            ctx.log('CmdDelayedAnims stopped: ' + message(error));
        });
        return undefined;
    }
};

module.exports = {
    handlers: handlers,
    asInt: asInt,
    operand: operand
};
