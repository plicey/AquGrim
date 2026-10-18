// The aura cache, fed by the packet tap (ticket #42).
//
// The reference never reads the player's auras out of the game: its packet handlers fill
// Grimoire/Game/AuraSystem.cs as frames arrive, and its statements read that cache. Three facts
// make this a module of its own rather than a few lines in the session:
//
// 1. The derivation is the reference's own, and it is not obvious. Flash.cs ProcessPacketFromServer
//    walks `b.o.a[]`; a removal names its aura in the SINGULAR slot (`action.aura.nam`) while an add
//    names it in a list (`action.auras[]`); an add is an increment only when `isNew` is false AND
//    the value is exactly 1; and for the player it counts only frames whose `tInf` is literally
//    `p:<Player.UserID>` - another player's auras belong to that player, not to us.
// 2. Every aura is keyed by the `tInf` the frame carried - `p:<uid>` or `m:<MonMapID>` - because
//    that is exactly how the wire names whose aura it is, and it is also how the reference's monster
//    caches are keyed (AuraManager.EnemyAura(monsterId)). A target read therefore has an id to look
//    up rather than a guess to make.
// 3. The wire and the cache disagree about units. `dur` arrives in SECONDS and every number a bot
//    compares is in MILLISECONDS, because PlayerAura.Refresh does `TickCount + duration * 1000` and
//    RemainingTime() hands back the milliseconds that are left. Getting this wrong by 1000x is the
//    classic failure for these statements, so both units are named at every boundary here.
//
// Two frame shapes carry the same payloads, and both are read: the raw server frame, whose payload
// sits at `b.o` (where ProcessPacketFromServer reads it), and the `pext` event, whose payload is
// `params.dataObj` (where ProcessPext reads moveToArea and clearAuras from). Which is which is
// decided by the frame's own text the way the reference decides it, not by which direction it went:
// a frame carrying `%xt%zm%` is a client command.
//
// What is deliberately NOT here: `aura++` and `aura+p`. The game's own handler applies those, but
// the reference's cache knows only `aura+` and `aura-`, so this does too - parity is the point.

/** The two aura commands the reference's cache handles. */
const ADD = 'aura+';
const REMOVE = 'aura-';

/** The client commands that ask for a clean slate: Player.initLogin, and the respawn ResetAura. */
const CLIENT_CLEARS = { firstJoin: true, resPlayerTimed: true };

/** AuraManager.ClearAllAura's keep-list: a name containing one of these survives a plain clear. */
const KEEP = ['fate', 'sage', 'body', 'might', 'elixir'];

/** A frame's bytes as text, whether the tap handed over a Buffer or a string. */
function text(value) {
    if (typeof value === 'string') return value;
    if (value && typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) return value.toString('utf8');
    return value === null || value === undefined ? '' : String(value);
}

/**
 * The client command a frame carries, or null. The reference's own test (Root.as PacketReceived:
 * `param1.params.message.indexOf("%xt%zm%") > -1`) and its own field index (ProcessPacketFromClient:
 * `packet.Split('%')[3]`) are both reproduced here, prefix and all.
 */
function clientCommand(body) {
    const at = body.indexOf('%xt%zm%');
    if (at === -1) return null;
    const parts = body.slice(at).split('%');
    return parts[3] || null;
}

/** The payload of a JSON frame, in either of the two shapes that carry one. */
function payloadOf(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const fromFrame = parsed.b && parsed.b.o;
    if (fromFrame && typeof fromFrame === 'object') return fromFrame;
    const fromExt = parsed.params && parsed.params.dataObj;
    if (fromExt && typeof fromExt === 'object') return fromExt;
    return null;
}

/** The aura actions a payload holds: its `a[]` list, plus itself when it is one. */
function actionsOf(payload) {
    const list = Array.isArray(payload.a) ? payload.a.slice() : [];
    // A payload that carries an aura of its own is an action in its own right - the game's own
    // handler reaches handleAuraEvent with the payload itself for those (World.as).
    if ((payload.auras || payload.aura) && (payload.cmd === ADD || payload.cmd === REMOVE)) {
        list.unshift(payload);
    }
    return list;
}

/** The names a removal action names: the singular slot the reference reads, and the list beside it. */
function removedNames(action) {
    const names = [];
    if (action.aura && typeof action.aura.nam === 'string') names.push(action.aura.nam);
    if (Array.isArray(action.auras)) {
        action.auras.forEach(function (one) {
            if (one && typeof one.nam === 'string') names.push(one.nam);
        });
    }
    return names;
}

/**
 * The aura state the game has reported, in the shape AuraManager holds it, keyed by `tInf`.
 *
 * @param {object} [deps]
 * @param {() => number} [deps.now] the clock, injected so expiry is testable without waiting
 */
function createAuraStore(deps) {
    deps = deps || {};
    const now = deps.now || function () { return Date.now(); };

    /** One map per `tInf`: `p:<uid>` for a player, `m:<MonMapID>` for a monster. */
    const managers = new Map();

    // Which `p:` key is this character's own, once the session has read its UserID. Auras arrive
    // before that, because the tap is subscribed at login, so this starts unknown and is filled in.
    let self = null;

    /**
     * The character this session is playing. The reference's keys are `p:<Player.UserID>` and
     * `m:<MonMapID>` and nothing else: a `p:` frame for anybody else is another player's aura,
     * which the reference drops on sight, so any cache held under one is let go here too.
     */
    function setSelf(key) {
        self = key === null || key === undefined || key === '' ? null : String(key);
        Array.from(managers.keys()).forEach(function (one) {
            if (one.indexOf('p:') === 0 && one !== self) managers.delete(one);
        });
    }

    /**
     * The manager(s) a SelfAura-scoped command lands on. Before the character's id is known the
     * only `p:` caches there can be are this avatar's own, so an early one lands on those.
     */
    function selfManagers() {
        if (self) {
            const found = managers.get(self);
            return found ? [found] : [];
        }
        return Array.from(managers.keys())
            .filter(function (one) { return one.indexOf('p:') === 0; })
            .map(function (one) { return managers.get(one); });
    }

    function managerFor(key) {
        let found = managers.get(key);
        if (!found) {
            found = new Map();
            managers.set(key, found);
        }
        return found;
    }

    /** PlayerAura.Refresh: the wire's seconds become an absolute time in milliseconds. */
    function apply(manager, name, value, duration) {
        const seconds = Number(duration);
        const expiry = now() + seconds * 1000;
        const key = String(name).toLowerCase();
        const found = manager.get(key);
        if (found) {
            found.value = Number(value);
            found.duration = seconds;
            found.expiry = expiry;
            // The wire's own spelling is kept for the log, not for matching: keys are folded.
            found.name = String(name);
        } else {
            manager.set(key, {
                name: String(name), value: Number(value), duration: seconds, expiry: expiry
            });
        }
    }

    /**
     * AuraIncrement: one more stack. Its refresh takes no duration - it re-arms the entry with the
     * duration that aura already carries (`aura.Refresh(aura.Duration)`), not with whatever the
     * acknowledgement frame carried - so the stack's own duration is what is used here too.
     */
    function increment(manager, name, duration) {
        const key = String(name).toLowerCase();
        const found = manager.get(key);
        if (!found) {
            // Upstream dereferences a null entry here (a live game can send the increment before
            // its own aura+, which is how that bug bites). The frame still says the aura is on the
            // target, so the entry starts at the stack it acknowledged, with the only duration
            // this frame carries.
            manager.set(key, {
                name: String(name), value: 1, duration: Number(duration),
                expiry: now() + Number(duration) * 1000
            });
            return;
        }
        found.value = Number(found.value) + 1;
        found.expiry = now() + Number(found.duration) * 1000;
    }

    /** IsExpired: TickCount >= ExpireTime. */
    function live(entry) {
        return !!entry && now() < entry.expiry;
    }

    /** AuraManager.GetValue, including its clamp and the (int) its caller applies. */
    function valueOf(manager, name) {
        if (!manager) return 0;
        const found = manager.get(String(name).toLowerCase());
        if (!live(found)) return 0;
        const stack = Number(found.value);
        return Math.trunc(stack <= 1 ? 1 : stack);
    }

    /** AuraManager.GetRemainingTime, in milliseconds, floored at zero. */
    function remainingOf(manager, name) {
        if (!manager) return 0;
        const found = manager.get(String(name).toLowerCase());
        if (!found) return 0;
        const left = found.expiry - now();
        return left > 0 ? left : 0;
    }

    /** One add, per Flash.cs's own two branches. */
    function add(manager, aura) {
        const name = aura && aura.nam;
        if (typeof name !== 'string' || !name.length) return;
        // `double value = aura["val"]?.Value<double>() ?? 1;` and `int duration = (int)aura["dur"]`.
        const stack = aura.val === undefined || aura.val === null ? 1 : Number(aura.val);
        const duration = aura.dur === undefined || aura.dur === null ? 0 : Number(aura.dur);
        if (aura.isNew === true || stack !== 1) apply(manager, name, stack, duration);
        else increment(manager, name, duration);
    }

    /** AuraManager.Update: drop what has expired, in every manager. */
    function prune() {
        managers.forEach(function (manager) {
            Array.from(manager.keys()).forEach(function (key) {
                if (!live(manager.get(key))) manager.delete(key);
            });
        });
    }

    /**
     * ClearAllAura. The reference only ever calls it on `AuraManager.SelfAura` - `clearAuras` in
     * ProcessPext, and `initLogin` on a first join - so a monster's cache is not touched by either.
     * `forceClean` takes every aura; otherwise a name containing Fate, Sage, Body, Might or Elixir
     * survives.
     */
    function clear(forced) {
        selfManagers().forEach(function (manager) {
            Array.from(manager.keys()).forEach(function (key) {
                if (forced) {
                    manager.delete(key);
                    return;
                }
                const name = String(manager.get(key).name).toLowerCase();
                const kept = KEEP.some(function (part) { return name.indexOf(part) !== -1; });
                if (!kept) manager.delete(key);
            });
        });
    }

    let lastAnims = '';
    const auraMessages = [];

    /**
     * Hand one tapped frame over. Anything that is not an aura frame for this cache is ignored: a
     * frame that is not JSON, a game other than this one, a command the reference does not handle.
     *
     * @param {{direction?: string, data?: any}} frame what the platform's tap delivers
     */
    function observe(frame) {
        if (!frame) return;
        const body = text(frame.data);
        if (!body) return;

        const command = clientCommand(body);
        if (command !== null) {
            // Player.initLogin (on "firstJoin") and the respawn ResetAura call both exist to make
            // sure no aura is left behind when a character arrives or comes back. What the client
            // asks for there is a clean slate, so that is what the cache does - and it is not the
            // keep-list clear that `clearAuras` performs.
            if (CLIENT_CLEARS[command]) clear(true);
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(body);
        } catch (error) {
            return;   // an XML frame, a debug line, or a payload the tap caught mid-flight
        }
        const payload = payloadOf(parsed);
        if (!payload) return;

        if (Array.isArray(payload.anims)) {
            // HandlerSpecialAnims: anims[].msg, lowercased, the last one to arrive wins.
            payload.anims.forEach(function (one) {
                if (one && typeof one.msg === 'string' && one.msg.length) {
                    lastAnims = one.msg.toLowerCase();
                }
            });
        }
        if (payload.cmd === 'moveToArea') {
            // ProcessPext: SelfAura.Update() + resetMonsterAura() - the expired auras go, and every
            // monster's cache goes with them, because those ids belong to the map being left.
            prune();
            Array.from(managers.keys()).forEach(function (key) {
                if (key.indexOf('m:') === 0) managers.delete(key);
            });
        } else if (payload.cmd === 'clearAuras') {
            clear(false);
        }

        actionsOf(payload).forEach(function (one) {
            if (!one || (one.cmd !== ADD && one.cmd !== REMOVE)) return;
            const key = String(one.tInf === null || one.tInf === undefined ? '' : one.tInf);
            if (!key) return;
            // `if (tInf == $"p:{Player.UserID}") ... else if (tInf.StartsWith("m:"))`: anything
            // else - another player's aura, or a shape that is neither - is not this character's.
            if (key.indexOf('p:') === 0 && self !== null && key !== self) return;
            if (one.cmd === REMOVE) {
                const manager = managers.get(key);
                if (manager) removedNames(one).forEach(function (name) { manager.delete(name.toLowerCase()); });
                return;
            }
            if (!Array.isArray(one.auras)) return;
            const manager = managerFor(key);
            one.auras.forEach(function (aura) {
                if (!aura) return;
                if (typeof aura.msgOn === 'string' && aura.msgOn.length) auraMessages.push(aura.msgOn);
                add(manager, aura);
            });
        });
    }

    return {
        observe: observe,
        setSelf: setSelf,

        /** One keyed manager's value and remaining time, in the units a statement compares. */
        value: function (tInf, name) { return valueOf(managers.get(String(tInf)), name); },
        remaining: function (tInf, name) { return remainingOf(managers.get(String(tInf)), name); },

        lastAnimationMessage: function () { return lastAnims; },
        consumeAnimation: function () { lastAnims = ''; },
        lastAuraMessages: function () { return auraMessages.slice(); }
    };
}

module.exports = {
    createAuraStore: createAuraStore,
    KEEP: KEEP,
    CLIENT_CLEARS: CLIENT_CLEARS,
    clientCommand: clientCommand,
    payloadOf: payloadOf
};
