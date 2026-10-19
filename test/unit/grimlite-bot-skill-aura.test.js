// The skill-readiness gate's aura condition (ticket #50): `Skill.hasaura` and the aura branch of
// the rotation CmdAttack and CmdKill share.
//
// Expected behaviour comes from the reference client's own sources, never from the module under
// test: Grimoire/Game/Data/Skill.cs (`hasaura`, `Compare`), Grimoire/Game/Player.cs (`GetAuras`),
// Grimoire/Botting/Commands/Combat/CmdKill.cs (the two lines that consult the predicate from a
// `[Wait]` row and from a plain one) and Grimoire/Game/AuraSystem.cs (the cache those reads land
// on). Four facts from them decide what is asserted here:
//
// 1. `hasaura` is a pure predicate over `aura` and the avatar's own stack count: a blank condition
//    is ready, and so is one whose operator it cannot find or whose split is not two parts - the
//    reference's own `return true`. That is upstream's shape for a row with no usable condition,
//    not a fallback this build invents, so it is reproduced.
// 2. The operator is the FIRST of `!=`, `>=`, `<=`, `=` the string contains, and the split is on
//    the whole operator with empty entries removed and no trimming, so a name that carries a space
//    misses the cache exactly as it misses the reference's dictionary.
// 3. `<=` compares with `<` (Skill.Compare's own body, which is not what its name suggests), and a
//    right-hand side that will not parse leaves the 0 `int.TryParse` leaves.
// 4. `Player.GetAuras(true, name)` is the tapped cache for a name that does not contain "locked"
//    and the loader's `GetAurasValue` for one that does. That lookup is refused by this bridge
//    (loader-surface.js, ticket #42), so a locked condition is a refusal this build reports - and
//    never an invitation to cast the row on a cache answer that is not the reference's.
const assert = require('assert');

const engineModel = require('../../plugins/grimlite-parity/bot/engine.js');
const sessionModel = require('../../plugins/grimlite-parity/bot/session.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');
const surface = require('../../plugins/grimlite-parity/loader-surface.js');

function command(className, properties) {
    return catalog.makeCommand(className, properties);
}

/** A skill row as the .gbot reader hands one over (Grimoire.Game.Data.Skill). */
function skillRow(properties) {
    return Object.assign({
        $type: 'Grimoire.Game.Data.Skill, Grimoire',
        Text: 'Nuke',
        Index: '2'
    }, properties || {});
}

/**
 * The engine's injected game interface (#37's session seam, spec #19 Seam 4), with the aura read
 * this ticket's gate makes: `selfAura(name)` is Player.GetAuras(true, name), so 0 is "the aura is
 * not on this character" and a rejection is "that read could not be made".
 */
function fakeSession(overrides) {
    const state = Object.assign({
        signedIn: true, alive: true, ready: true, username: 'Tester',
        className: 'Dragonslayer', hasTarget: true, skillAvailable: 0,
        targetHealth: 100, monsterAvailable: true,
        aura: {}, auraError: null
    }, overrides || {});
    const calls = [];
    function note(name, args) { calls.push({ name: name, args: args === undefined ? [] : args }); }
    function answer(name) {
        return function (arg) {
            note(name, arg === undefined ? [] : [arg]);
            const value = state[name];
            if (value instanceof Error) return Promise.reject(value);
            if (typeof value === 'function') return Promise.resolve(value(arg));
            return Promise.resolve(value);
        };
    }
    return {
        snapshot: state,
        calls: calls,
        asked: function (name) { return calls.filter(function (c) { return c.name === name; }); },
        signedIn: answer('signedIn'),
        alive: answer('alive'),
        ready: answer('ready'),
        username: answer('username'),
        className: answer('className'),
        hasTarget: answer('hasTarget'),
        targetHealth: answer('targetHealth'),
        monsterAvailable: answer('monsterAvailable'),
        skillAvailable: answer('skillAvailable'),
        attackMonster: function (name) { note('attackMonster', [name]); return Promise.resolve(); },
        useSkill: function (index) {
            note('useSkill', [index]);
            return state.useSkillError ? Promise.reject(state.useSkillError) : Promise.resolve();
        },
        forceUseSkill: function (index) {
            note('forceUseSkill', [index]);
            return Promise.resolve();
        },
        selfAura: function (name) {
            note('selfAura', [name]);
            if (state.auraError) return Promise.reject(state.auraError);
            const stacks = state.aura[name];
            return Promise.resolve(stacks === undefined ? 0 : stacks);
        }
    };
}

/** The engine as the plugin builds it, with pacing collapsed and the log kept. */
function engine(deps) {
    const options = deps || {};
    const waited = [];
    const records = [];
    const made = engineModel.createEngine({
        session: options.session || fakeSession(),
        sleep: function (ms) { waited.push(ms); return Promise.resolve(); },
        log: function (line) { records.push(line); }
    });
    made.waited = waited;
    made.records = records;
    return made;
}

/** A bot whose only command is the attack that runs the rotation over the rows given. */
function botOf(skills, properties) {
    return {
        Commands: [command('CmdAttack', Object.assign({ Monster: '*', UseSkill: true }, properties || {}))],
        Skills: skills
    };
}

// ------------------------------------------------------------------ the gate (Skill.hasaura)

test('a skill row whose aura condition is unmet is not cast', async () => {
    // CmdKill.cs: `if (!s.hasaura() && !s.waitCd) { Index++; continue; }` - the row is walked past.
    // The condition holds only when the character's own stacks satisfy it, and the reference reads
    // those from its tapped cache (Player.GetAuras(true, ...) -> AuraManager.SelfAura.GetValue).
    const session = fakeSession({ aura: { Chi: 0 } });
    const made = engine({ session: session });
    await made.start(botOf([skillRow({ aura: 'Chi>=3' })]));
    await made.tick();
    assert.deepStrictEqual(session.asked('selfAura'), [{ name: 'selfAura', args: ['Chi'] }],
        'the condition names an aura, and the name is the one the row wrote');
    assert.deepStrictEqual(session.asked('useSkill'), [], 'the row the character cannot use is skipped');
});

test('a skill row whose aura condition is met is cast, once per tick', async () => {
    // The same branch, with the stacks the condition asks for: `c >= t` holds at the bound.
    const session = fakeSession({ aura: { Chi: 3 } });
    const made = engine({ session: session });
    await made.start(botOf([skillRow({ aura: 'Chi>=3' })]));
    await made.tick();
    assert.deepStrictEqual(session.asked('useSkill')[0].args, ['2'], 'the row is cast, by its index');
});

test('a skill row with no aura condition casts without reading any aura at all', async () => {
    // `if (string.IsNullOrWhiteSpace(aura)) return true;` - and the read is not made, so a bot with
    // no aura conditions is exactly the bot it was before this ticket.
    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start(botOf([skillRow({})]));
    await made.tick();
    assert.deepStrictEqual(session.asked('useSkill')[0].args, ['2'], 'still cast');
    assert.deepStrictEqual(session.asked('selfAura'), [], 'and no aura was asked for');
    assert.deepStrictEqual(made.records, [], 'and nothing new is reported over a row with no condition');
});

test('the kill loop consults the same gate, which is the reference own call site', async () => {
    // CmdKill.cs:163 is where `s.hasaura()` was first written, and CmdKill shares the rotation with
    // CmdAttack. A row the aura does not permit is walked past there too - the command that decides
    // a fight must not reach for a skill the character cannot use.
    const session = fakeSession({ aura: { Chi: 0 } });
    // CmdKill now rotates until the target dies, as the reference does. This test has no combat
    // simulation, so the first aura read also ends the fake fight; otherwise it would run the
    // full runaway guard and allocate a call log for every pass.
    const readAura = session.selfAura;
    session.selfAura = function (name) {
        const answer = readAura(name);
        session.snapshot.hasTarget = false;
        return answer;
    };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdKill', { Monster: '*', rounds: 1 })],
        Skills: [skillRow({ aura: 'Chi>=1' })]
    });
    await made.tick();
    assert.deepStrictEqual(session.asked('selfAura'), [{ name: 'selfAura', args: ['Chi'] }]);
    assert.deepStrictEqual(session.asked('useSkill'), [], 'the unmet row is not cast in a kill either');
});

test('an aura read that cannot be made is reported and the row is not cast', async () => {
    // The load-bearing half of this ticket: the reference's answer needs the cache, and where the
    // cache cannot answer - no tap, or a name the reference serves from a lookup this bridge
    // refuses - the gate reports the reason and skips the row. It never falls back to "ready".
    const session = fakeSession({ auraError: new Error('auras come from the packet tap: this session has no packet tap') });
    const made = engine({ session: session });
    await made.start(botOf([skillRow({ aura: 'Chi>=3' })]));
    await made.tick();
    assert.deepStrictEqual(session.asked('useSkill'), [], 'a condition that cannot be read is not a ready row');
    assert.ok(made.records.some(function (line) {
        return /skill 2/.test(line) && /packet tap/.test(line);
    }), 'the reason reaches the log: ' + made.records.join(' | '));

    // And it is said once rather than on every tick of a rotation that keeps reaching the row.
    await made.tick();
    assert.strictEqual(made.records.filter(function (line) { return /packet tap/.test(line); }).length, 1,
        'the same refusal is not repeated');
});

test('a [Wait] row is cast even with the aura still missing, and waits out the 200ms', async () => {
    // CmdKill.cs's two later lines, which are the waitCd row's own bargain: `if (!s.hasaura() &&
    // !s.waitCd)` does not skip it, and `if (s.waitCd && !s.hasaura()) await Task.Delay(200)` gives
    // the aura a moment to land before the next pass. That is the reference's own choice for a row
    // the author marked, so it is not "falling back to ready" - the flag is what says cast anyway.
    const session = fakeSession({ aura: { Chi: 0 } });
    const made = engine({ session: session });
    await made.start(botOf([skillRow({ aura: 'Chi>=3', waitCd: true })]));
    await made.tick();
    assert.deepStrictEqual(session.asked('useSkill')[0].args, ['2'], 'a [Wait] row is cast either way');
    assert.ok(made.waited.indexOf(200) !== -1, 'and the missing aura is given 200ms: ' + made.waited);
});

// ------------------------------------------------------------------ the predicate's own rules

test('the operator is the first one the condition contains, in the reference own scan order', async () => {
    // Skill.hasaura: `!=`, then `>=`, then `<=`, then `=`. Reading `>=` as `=` would split the
    // condition on the wrong side and look for an aura named "Chi>", which no character has.
    const atBound = fakeSession({ aura: { Chi: 2 } });
    const met = engine({ session: atBound });
    await met.start(botOf([skillRow({ aura: 'Chi>=2' })]));
    await met.tick();
    assert.deepStrictEqual(atBound.asked('selfAura'), [{ name: 'selfAura', args: ['Chi'] }],
        'the name is the half before the operator');
    assert.deepStrictEqual(atBound.asked('useSkill')[0].args, ['2'], 'c >= t holds at the bound');

    const equal = fakeSession({ aura: { Chi: 2 } });
    const unequal = engine({ session: equal });
    await unequal.start(botOf([skillRow({ aura: 'Chi!=2' })]));
    await unequal.tick();
    assert.deepStrictEqual(equal.asked('useSkill'), [], 'c != t does not hold at the bound');
});

test('<= compares with <, which is what Skill.Compare writes', async () => {
    // `case "<=": return c < t;` - the reference's own body, and the row the boundary lands on is
    // the one a port that "fixed" it would differ on.
    const atBound = fakeSession({ aura: { Chi: 3 } });
    const met = engine({ session: atBound });
    await met.start(botOf([skillRow({ aura: 'Chi<=3' })]));
    await met.tick();
    assert.deepStrictEqual(atBound.asked('useSkill'), [], 'at the bound it does not hold');

    const below = fakeSession({ aura: { Chi: 2 } });
    const held = engine({ session: below });
    await held.start(botOf([skillRow({ aura: 'Chi<=3' })]));
    await held.tick();
    assert.deepStrictEqual(below.asked('useSkill')[0].args, ['2'], 'below it does');
});

test('a condition the reference cannot parse is ready, which is its own return true', async () => {
    // Skill.hasaura's three early `return true` branches: no operator in the string, and a split
    // that is not exactly two parts. Upstream those rows behave as unconditional ones, so they do
    // here - and none of them is a read that could have been made.
    const session = fakeSession({ aura: { Chi: 0 } });
    const made = engine({ session: session });
    await made.start(botOf([
        skillRow({ aura: 'Chi > 3' }),        // ">" is not an operator the reference knows
        skillRow({ Index: '3', aura: 'Chi>=2>=1' })  // three parts, so no comparison is made
    ]));
    await made.tick();
    await made.tick();
    assert.deepStrictEqual(session.asked('useSkill').map(function (a) { return a.args[0]; }), ['2', '3'],
        'both rows are cast');
    assert.deepStrictEqual(session.asked('selfAura'), [], 'and neither condition is read');
});

test('a condition whose operator leaves no name is ready, which is the empty-entry split', async () => {
    // `Split(new[] { op }, StringSplitOptions.RemoveEmptyEntries)` on "=3" yields one part, not
    // two, so the reference returns true - and a blank condition alongside it does the same.
    const session = fakeSession({ aura: {} });
    const made = engine({ session: session });
    await made.start(botOf([
        skillRow({ aura: '=3' }),
        skillRow({ Index: '3', aura: '   ' })
    ]));
    await made.tick();
    await made.tick();
    assert.deepStrictEqual(session.asked('useSkill').map(function (a) { return a.args[0]; }), ['2', '3'],
        'both are cast');
    assert.deepStrictEqual(session.asked('selfAura'), [], 'and there is no name to read');
});

test('equals and not-equals hold on the stack count, both ways round', async () => {
    // `case "=": return c == t;` and `case "!=": return c != t;` - and `=` is the operator a
    // condition with no other operator in it resolves to, which is why the scan order matters.
    const equal = fakeSession({ aura: { Chi: 2 } });
    const holds = engine({ session: equal });
    await holds.start(botOf([skillRow({ aura: 'Chi=2' })]));
    await holds.tick();
    assert.deepStrictEqual(equal.asked('useSkill')[0].args, ['2'], 'c == t holds');

    const other = fakeSession({ aura: { Chi: 2 } });
    const notEqual = engine({ session: other });
    await notEqual.start(botOf([skillRow({ aura: 'Chi!=3' })]));
    await notEqual.tick();
    assert.deepStrictEqual(other.asked('useSkill')[0].args, ['2'], 'c != t holds');

    const same = fakeSession({ aura: { Chi: 2 } });
    const skipped = engine({ session: same });
    await skipped.start(botOf([skillRow({ aura: 'Chi=3' })]));
    await skipped.tick();
    assert.deepStrictEqual(same.asked('useSkill'), [], 'a row the count does not equal is skipped');
});

test('a name is not trimmed, so a space in it misses the cache the way it misses the dictionary', async () => {
    // `this.aura.Split(new[] { op }, StringSplitOptions.RemoveEmptyEntries)` keeps the spaces around
    // the name, and AuraManager's own comparer is case-insensitive and space-exact. "Chi >=3"
    // therefore asks for the aura "Chi " - which is why the fake session answers 0 for it.
    const session = fakeSession({ aura: { Chi: 9 } });
    const made = engine({ session: session });
    await made.start(botOf([skillRow({ aura: 'Chi >=3' })]));
    await made.tick();
    assert.deepStrictEqual(session.asked('selfAura'), [{ name: 'selfAura', args: ['Chi '] }]);
    assert.deepStrictEqual(session.asked('useSkill'), [], 'and the condition does not hold');
});

test('a right-hand side that will not parse leaves the 0 int.TryParse leaves', async () => {
    // `int.TryParse(aura[1], out int t);` - a failed parse is not a failure to compare, it is a 0,
    // and the parse is C#'s: a trailing character, a decimal point and an out-of-range number all
    // fail where parseInt would take something from the first two and lose the third's magnitude.
    // "Chi>=abc" therefore asks `c >= 0`, which every stack count satisfies.
    for (const written of ['Chi>=abc', 'Chi>=3x', 'Chi>=3.5', 'Chi>=99999999999', 'Chi>=NaN']) {
        const session = fakeSession({ aura: {} });
        const made = engine({ session: session });
        await made.start(botOf([skillRow({ aura: written })]));
        await made.tick();
        assert.deepStrictEqual(session.asked('useSkill')[0].args, ['2'],
            '"' + written + '" parses to 0, so c >= 0 holds');
    }

    // And a value that does parse is compared as written, sign and all.
    const negative = fakeSession({ aura: {} });
    const made = engine({ session: negative });
    await made.start(botOf([skillRow({ aura: 'Chi>= -1' })]));
    await made.tick();
    assert.deepStrictEqual(negative.asked('useSkill')[0].args, ['2'], 'c >= -1 holds');
});

// ------------------------------------------------------------------ the seam (#42's own cache)

function rawFrame(payload) {
    return JSON.stringify({ t: 'xt', b: { r: -1, o: payload } });
}

function auraFrame(tInf, aura, cmd) {
    return rawFrame({
        cmd: cmd || 'aura+',
        tInf: tInf,
        a: [{ cmd: cmd || 'aura+', tInf: tInf, auras: [aura] }]
    });
}

function removalFrame(tInf, name) {
    return rawFrame({ cmd: 'aura-', tInf: tInf, a: [{ cmd: 'aura-', tInf: tInf, aura: { nam: name } }] });
}

function fakeTap() {
    const listeners = [];
    return {
        on: function (event, listener) {
            assert.strictEqual(event, 'frame');
            listeners.push(listener);
            return function () { listeners.splice(listeners.indexOf(listener), 1); };
        },
        emit: function (text) { listeners.slice().forEach(function (l) { l({ direction: 'toClient', data: Buffer.from(text, 'utf8') }); }); }
    };
}

/** The bridge the session talks to: loader names by name, and the paths it reads itself. */
function sessionBridge(answers) {
    const asked = [];
    return {
        asked: asked,
        attach: function () { return Promise.resolve({ ok: true }); },
        loaderCall: function (name, args) {
            asked.push({ name: name, args: args || [] });
            if (Object.prototype.hasOwnProperty.call(answers, name)) {
                const answer = answers[name];
                if (answer instanceof Error) return Promise.reject(answer);
                return Promise.resolve(answer);
            }
            const row = surface.SURFACE[name];
            return Promise.reject(new Error('"' + name + '" is refused: ' + ((row && row.why) || 'no row')));
        },
        call: function (name, args) {
            asked.push({ name: name, args: args || [] });
            const key = args[0];
            if (Object.prototype.hasOwnProperty.call(answers, key)) {
                return Promise.resolve({ ok: true, value: JSON.stringify(answers[key]) });
            }
            return Promise.resolve({ ok: true, value: 'null' });
        }
    };
}

const SELF = 777;

/** The session over the #42 cache, and the engine over that session. */
function liveBot(overrides) {
    const bridge = sessionBridge(Object.assign({
        IsLoggedIn: true, Health: 100, HealthMax: 100, Mana: 100, ManaMax: 100,
        UserID: SELF, Class: 'Dragonslayer', HasTarget: true
    }, overrides || {}));
    const tap = fakeTap();
    const session = sessionModel.createSession({ bridge: bridge, packets: tap, log: function () {} });
    const made = engine({ session: session });
    made.bridge = bridge;
    made.tap = tap;
    return made;
}

function castsOf(made) {
    return made.bridge.asked.filter(function (a) { return a.name === 'UseSkill'; });
}

test('the gate reads the tapped cache: a frame arms the row and a removal disarms it', async () => {
    // The end-to-end half: Player.GetAuras(true, name) is the cache ticket #42 fills from the
    // packet tap, reached through the session seam rather than read from the engine.
    const made = liveBot({});
    await made.start(botOf([skillRow({ aura: 'Chi>=3' })]));
    await made.tick();
    assert.deepStrictEqual(castsOf(made), [], 'nothing has announced that aura yet');

    made.tap.emit(auraFrame('p:' + SELF, { nam: 'Chi', val: 3, dur: 30, isNew: true }));
    await made.tick();
    assert.strictEqual(castsOf(made).length, 1, 'three stacks are what the condition asks for');

    made.tap.emit(removalFrame('p:' + SELF, 'Chi'));
    await made.tick();
    assert.strictEqual(castsOf(made).length, 1, 'and with the aura gone the row is skipped again');
});

test('an aura frame whose duration has already run out is read as absent', async () => {
    // PlayerAura.IsExpired: `Environment.TickCount >= ExpireTime`, and `dur` is seconds. A frame
    // that carries no duration left is a stack count the next read sees as 0 - the expiry half of
    // #42's derivation, reached here through the gate rather than by reading the cache directly.
    const made = liveBot({});
    await made.start(botOf([skillRow({ aura: 'Chi>=3' })]));
    made.tap.emit(auraFrame('p:' + SELF, { nam: 'Chi', val: 3, dur: 0, isNew: true }));
    await made.tick();
    assert.deepStrictEqual(castsOf(made), [], 'an expired aura is not a stack count');

    made.tap.emit(auraFrame('p:' + SELF, { nam: 'Chi', val: 3, dur: 30, isNew: true }));
    await made.tick();
    assert.strictEqual(castsOf(made).length, 1, 're-armed with a duration it holds again');
});

test('a condition on an aura the tap does not carry is refused, never answered from the cache', async () => {
    // Player.GetAuras routes a name containing "locked" to the loader's own GetAurasValue instead
    // of the cache, and that lookup is one this bridge refuses (#42, loader-surface.js). The gate
    // must report that refusal rather than read the cache for a name the reference would not.
    const made = liveBot({});
    await made.start(botOf([skillRow({ aura: 'Locked>=1' })]));
    made.tap.emit(auraFrame('p:' + SELF, { nam: 'Locked', val: 5, dur: 30, isNew: true }));
    await made.tick();
    assert.deepStrictEqual(castsOf(made), [], 'the cache is not the source for this name');
    assert.ok(made.bridge.asked.some(function (a) { return a.name === 'GetAurasValue'; }),
        'the read the reference would make is the one attempted');
    assert.ok(surface.SURFACE.GetAurasValue.why.indexOf('#42') !== -1,
        'and the surface owns the reason it is refused');
    assert.ok(made.records.some(function (line) { return /skill 2/.test(line) && /GetAurasValue/.test(line); }),
        'the refusal reaches the log: ' + made.records.join(' | '));
});

test('the session own aura read is the reference GetAuras, cache first and locked aside', async () => {
    // Player.GetAuras, as the session port it: `isSelf && !auraName.ContainsIgnoreCase("locked")`
    // is the cache, and anything else is the loader call. Asserted on the session itself so the
    // routing is pinned where it lives rather than only through the gate above.
    const made = liveBot({});
    made.tap.emit(auraFrame('p:' + SELF, { nam: 'Chi', val: 2, dur: 30, isNew: true }));
    assert.strictEqual(await made.session.selfAura('Chi'), 2);
    assert.strictEqual(await made.session.selfAura('chi'), 2, 'the cache folds case');
    assert.strictEqual(await made.session.selfAura('Nothing'), 0);
    await assert.rejects(function () { return made.session.selfAura('Locked'); },
        /GetAurasValue|refused/i, 'a locked name is the loader lookup, and that lookup is refused');
    assert.strictEqual(await made.session.selfAura('No Condition Here'), 0,
        'a name without "locked" in it is still the cache, and a cache miss is a 0');
});
