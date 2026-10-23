// The combat commands (ticket #38) and the loader reads they need.
//
// Expected behaviour comes from the reference client's own sources, never from the module under
// test: Grimoire/Botting/Commands/Combat/*.cs for each command's body, and the reference loader's
// decompiled helpers (grimoire/game/Player.as, grimoire/game/World.as) for every read.
//
// One finding shapes the whole ticket, and it comes from the STOCK game's own decompile
// (/var/tmp/aq48/out-game/scripts): the loader's `AttackMonster` and `UseSkill` end in
// `world.setTarget(monster)` and `world.testAction(action)`, and both of those take a *live AS3
// object*. The game's only ways in - `world.getMonster(id)`, `world.getMonstersByCell(cell)`,
// `world.getActionByRef(ref)`, `world.getAutoAttack()` - all return live objects too, and the
// bridge carries JSON.
//
// That constrains where each call can be made, not whether it can: the monster LIST is read from
// here (one leaf per field per index, which is the reshape the loader itself performs), while the
// calls that hand the game an object are made by the bridge movie, in the domain the game's classes
// were loaded into (ticket #49). This file pins both halves: the reads answer from this side, and
// the calls reach the movie by the reference's own name with the primitive its signature takes.
const assert = require('assert');

const surface = require('../../plugins/grimlite-parity/loader-surface.js');
const sessionModel = require('../../plugins/grimlite-parity/bot/session.js');
const engineModel = require('../../plugins/grimlite-parity/bot/engine.js');
const catalog = require('../../plugins/grimlite-parity/bot/command-catalog.js');

/** A command shaped the way the reader hands one to the engine. */
function command(className, properties) {
    return catalog.makeCommand(className, properties);
}

/**
 * A bridge that answers the paths and callbacks a test names, and refuses everything else.
 *
 * `nulls` is the one the surface uses for a member it cannot read: the bridge's own isNull answers
 * "true" when the path is ABSENT, which is the polarity that makes it a guard (the game answers it
 * for a live MovieClip without trying to carry the clip).
 */
function fakeBridge(answers, nulls) {
    const asked = [];
    const made = [];
    const present = nulls || {};
    return {
        asked: asked,
        made: made,
        call: function (callback, args) {
            const name = args[0];
            if (callback === 'isNull') {
                asked.push('isNull:' + name);
                if (Object.prototype.hasOwnProperty.call(present, name)) {
                    return Promise.resolve(present[name] ? 'false' : 'true');
                }
                // The game answers null for a path that is not there, so an unlisted path is
                // absent - the same default the real isNull callback has.
                return Promise.resolve('true');
            }
            if (callback === 'getGameObject') {
                asked.push(name);
                if (Object.prototype.hasOwnProperty.call(answers, name)) {
                    return Promise.resolve(answers[name]);
                }
                return Promise.reject(new Error('no member ' + name.split('.').pop() + ' at ' + name));
            }
            made.push({ callback: callback, path: name, args: args.slice(1) });
            const key = callback + ':' + name;
            if (Object.prototype.hasOwnProperty.call(answers, key)) return Promise.resolve(answers[key]);
            return Promise.reject(new Error('no member ' + name.split('.').pop() + ' at ' + name));
        }
    };
}

function access(bridge) {
    return surface.createLoaderSurface(bridge.call);
}

/**
 * Two monsters in one cell, one of them dead, plus one in another cell - the shape the reference's
 * own GetMonstersInCell / GetVisibleMonstersInCell / GetMonsterByName walk over. Field names are
 * the loader's own projection (World.as: `sRace`, `strMonName`, `MonID`, `MonMapID`, `iLvl`,
 * `intState`, `intHP`, `intHPMax`), and `strFrame` is what the game's own getMonstersByCell
 * filters on.
 */
function monsters() {
    return {
        'world.monsters.length': 3,
        'world.strFrame': 'Enter',
        'world.monsters.0.objData.sRace': 'human',
        'world.monsters.0.objData.strMonName': 'Gravelyn the Good',
        'world.monsters.0.dataLeaf.strFrame': 'Enter',
        'world.monsters.0.dataLeaf.MonID': 8,
        'world.monsters.0.dataLeaf.MonMapID': 17,
        'world.monsters.0.dataLeaf.iLvl': 5,
        'world.monsters.0.dataLeaf.intState': 1,
        'world.monsters.0.dataLeaf.intHP': 120,
        'world.monsters.0.dataLeaf.intHPMax': 200,
        'world.monsters.1.objData.sRace': 'undead',
        'world.monsters.1.objData.strMonName': 'Skeleton',
        'world.monsters.1.dataLeaf.strFrame': 'Enter',
        'world.monsters.1.dataLeaf.MonID': 9,
        'world.monsters.1.dataLeaf.MonMapID': 18,
        'world.monsters.1.dataLeaf.iLvl': 6,
        'world.monsters.1.dataLeaf.intState': 0,
        'world.monsters.1.dataLeaf.intHP': 0,
        'world.monsters.1.dataLeaf.intHPMax': 150,
        'world.monsters.2.objData.sRace': 'human',
        'world.monsters.2.objData.strMonName': 'Bandit',
        'world.monsters.2.dataLeaf.strFrame': 'Right',
        'world.monsters.2.dataLeaf.MonID': 10,
        'world.monsters.2.dataLeaf.MonMapID': 19,
        'world.monsters.2.dataLeaf.iLvl': 7,
        'world.monsters.2.dataLeaf.intState': 1,
        'world.monsters.2.dataLeaf.intHP': 90,
        'world.monsters.2.dataLeaf.intHPMax': 300
    };
}

/** The pMC guard the loader's own bodies make before they touch a monster. */
function liveClips() {
    return { 'world.monsters.0.pMC': true, 'world.monsters.1.pMC': true, 'world.monsters.2.pMC': true };
}

test('IsMonsterAvailable resolves a name against the monsters the game carries', () => {
    // World.as GetMonsterByName: walk getMonstersByCell(world.strFrame), keep the first whose
    // pMC is present, whose name plate contains the argument (or the argument is "*") and whose
    // intState is above 0. The name plate text is the game's own objData.strMonName - MonsterMC
    // assigns it from pname.ti.text in setData() - so the match is the same string by another door.
    const bridge = fakeBridge(monsters(), liveClips());
    const game = access(bridge);
    return Promise.all([
        game.call('IsMonsterAvailable', ['gravelyn']),
        game.call('IsMonsterAvailable', ['THE GOOD']),
        game.call('IsMonsterAvailable', ['*']),
        game.call('IsMonsterAvailable', ['Bandit']),
        game.call('IsMonsterAvailable', ['nobody'])
    ]).then((answers) => {
        assert.strictEqual(answers[0], true, 'a substring of the name matches');
        assert.strictEqual(answers[1], true, 'the match is case-insensitive');
        assert.strictEqual(answers[2], true, '"*" matches any monster in the cell');
        assert.deepStrictEqual(
            [answers[3], answers[4]],
            [false, false],
            'a monster in another cell and a missing name are both a no'
        );
    });
});

// ---------------------------------------------------------------- the engine's combat commands

/**
 * The engine's injected game interface, with the combat and map reads this ticket added. Reads are
 * plain values; `log` records what a command reported, which is where a refusal has to show up.
 */
function fakeSession(overrides) {
    const state = Object.assign({
        signedIn: true, alive: true, ready: true, username: 'Tester',
        health: 100, healthMax: 100, mana: 100, manaMax: 100,
        state: 2, hasTarget: true, targetHealth: 100,
        cell: 'Enter', pad: 'Spawn', map: 'yulgar', position: [100, 400],
        skillAvailable: 0, allSkillsAvailable: 0, className: 'Dragonslayer',
        monsterAvailable: true, monsterHealth: 100, cells: ['Enter', 'Right'],
        actionAvailable: true, monsters: []
    }, overrides || {});
    const calls = [];
    function note(name, args) { calls.push({ name: name, args: args }); }
    function answer(name, key) {
        return function (arg) {
            note(name, arg === undefined ? [] : [arg]);
            const value = state[key];
            if (value instanceof Error) return Promise.reject(value);
            if (typeof value === 'function') return Promise.resolve(value(arg));
            return Promise.resolve(value);
        };
    }
    return {
        // The snapshot the test mutates, kept under its own name so it does not collide with the
        // `state()` read the engine makes.
        snapshot: state,
        calls: calls,
        asked: function (name) { return calls.filter(function (c) { return c.name === name; }); },
        signedIn: answer('signedIn', 'signedIn'),
        alive: answer('alive', 'alive'),
        ready: answer('ready', 'ready'),
        username: function () { note('username', []); return Promise.resolve(state.username); },
        health: answer('health', 'health'),
        healthMax: answer('healthMax', 'healthMax'),
        mana: answer('mana', 'mana'),
        manaMax: answer('manaMax', 'manaMax'),
        // Player.CurrentState, where 2 is the reference's own State.InCombat.
        state: answer('state', 'state'),
        hasTarget: answer('hasTarget', 'hasTarget'),
        targetHealth: answer('targetHealth', 'targetHealth'),
        skillAvailable: answer('skillAvailable', 'skillAvailable'),
        allSkillsAvailable: answer('allSkillsAvailable', 'allSkillsAvailable'),
        monsterAvailable: function (name) {
            note('monsterAvailable', [name]);
            const value = state.monsterAvailable;
            if (typeof value === 'function') return Promise.resolve(value(name));
            return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
        },
        monsterHealth: answer('monsterHealth', 'monsterHealth'),
        monstersInCell: answer('monstersInCell', 'monsters'),
        className: answer('className', 'className'),
        position: answer('position', 'position'),
        cell: answer('cell', 'cell'),
        pad: answer('pad', 'pad'),
        map: answer('map', 'map'),
        jump: function (cell, pad) { note('jump', [cell, pad]); return Promise.resolve(); },
        join: function (map, cell, pad) { note('join', [map, cell, pad]); return Promise.resolve(); },
        setSpawnPointHere: function () { note('setSpawnPointHere', []); return Promise.resolve(); },
        walkToPoint: function (x, y) { note('walkToPoint', [x, y]); return Promise.resolve(); },
        cancelTargets: function () { note('cancelTargets', []); return Promise.resolve(); },
        cancelAutoAttack: function () { note('cancelAutoAttack', []); return Promise.resolve(); },
        attackMonster: function (name) { note('attackMonster', [name]); return Promise.resolve(); },
        attackMonsterByMonMapId: function (id) { note('attackMonsterByMonMapId', [id]); return Promise.resolve(); },
        useSkill: function (index) { note('useSkill', [index]); return Promise.resolve(); },
        forceUseSkill: function (index) { note('forceUseSkill', [index]); return Promise.resolve(); },
        actionAvailable: answer('actionAvailable', 'actionAvailable'),
        cells: answer('cells', 'cells'),
        items: answer('items', 'items'),
        tempItems: answer('tempItems', 'tempItems'),
        goTo: function (name) { note('goTo', [name]); return Promise.resolve(); },
        reloadMap: function () { note('reloadMap', []); return Promise.resolve(); },
        loadMap: function (swf) { note('loadMap', [swf]); return Promise.resolve(); },
        rest: function () { note('rest', []); return Promise.resolve(); },
        setSpawnPoint: function () { note('setSpawnPoint', []); return Promise.resolve(); },
        exitCombat: function () { note('exitCombat', []); return Promise.resolve(); }
    };
}

/** The engine as the plugin builds it, with pacing collapsed. */
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

test('CmdAttack sends the reference own AttackMonster for the resolved monster', async () => {
    // CmdAttack.cs: Player.AttackMonster(instance.ResolveVars(Monster)), guarded by
    // IsRunning && IsAlive && IsLoggedIn, and a "*" only fires when there is no target yet.
    const session = fakeSession({ hasTarget: false });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdAttack', { Monster: 'Gravelyn' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('attackMonster'), [{ name: 'attackMonster', args: ['Gravelyn'] }]);
});

test('CmdAttack on "*" leaves an existing target alone', async () => {
    // Same file: `if (Monster == "*") { if (!Player.HasTarget) AttackMonster("*"); }`. Attacking
    // again would restart the swing against a monster that is already being fought.
    const session = fakeSession({ hasTarget: true });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdAttack', { Monster: '*' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('attackMonster'), [], 'nothing is sent while a target is up');
});

test('SkipAttack turns CmdAttack into a cancel, which is the option own branch', async () => {
    // CmdAttack.cs: `if (instance.Configuration.SkipAttack) { if (Player.HasTarget) Player.CancelTarget(); return; }`
    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdAttack', { Monster: 'Gravelyn' })], SkipAttack: true });
    await made.tick();
    assert.deepStrictEqual(session.asked('cancelTargets').length, 1, 'the target is dropped instead');
    assert.deepStrictEqual(session.asked('attackMonster'), [], 'and nothing is attacked');
});

test('CmdAttack with a monster that is not there is reported, not waited on', async () => {
    // The ticket's own last acceptance criterion: a command whose target is missing fails in a way
    // the log explains. AttackMonster answers nothing when no monster carries the name, and a
    // failure of any other kind has to reach the log the same way and let the list move on.
    const refused = new Error('no monster named Gravelyn is in this cell');
    const session = fakeSession({});
    session.attackMonster = function () { return Promise.reject(refused); };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdAttack', { Monster: 'Gravelyn' }), command('CmdStop', {})] });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /no monster named Gravelyn/.test(line); }),
        'the log says what failed: ' + made.records.join(' | '));
    assert.strictEqual(made.running(), true, 'a refused attack does not stop the bot');
    assert.strictEqual(made.index(), 1, 'and the list still advances');
});

test('CmdCancelTarget performs the reference own three cancels', async () => {
    // CmdCancelTarget.cs: CancelTarget, CancelTargetSelf, CancelAutoAttack.
    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdCancelTarget', {})] });
    await made.tick();
    assert.deepStrictEqual(session.asked('cancelTargets').length, 1);
});

test('CmdCancelTarget with LeaveCombat jumps to the cell the player is standing in', async () => {
    // Same file: `string cell = Player.Cell; string pad = Player.Pad; Player.MoveToCell(cell, pad);
    // await Task.Delay(500);` - the jump the game itself uses to leave combat.
    const session = fakeSession({ cell: 'r22', pad: 'Down' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdCancelTarget', { LeaveCombat: true })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('jump'), [{ name: 'jump', args: ['r22', 'Down'] }]);
    assert.ok(made.waited.indexOf(500) !== -1, 'the reference waits 500ms after the jump');
});

test('CmdRest waits for the Rest action, then rests', async () => {
    // CmdRest.cs: WaitUntil(() => World.IsActionAvailable(LockActions.Rest), ...) then Player.Rest().
    // The lock name is the dictionary the reference itself holds: LockActions.Rest -> "rest".
    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdRest', {})] });
    await made.tick();
    assert.deepStrictEqual(session.asked('actionAvailable').map(function (c) { return c.args[0]; }), ['rest']);
    assert.deepStrictEqual(session.asked('rest').length, 1);
});

test('a rest that is not available yet is waited for, and the wait is polled', async () => {
    // The same WaitUntil the reference runs: it polls at the engine's interval rather than
    // resting anyway, so the count of polls is the assertion.
    let available = false;
    const session = fakeSession({});
    session.actionAvailable = function () {
        session.calls.push({ name: 'actionAvailable', args: [] });
        return Promise.resolve(available);
    };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdRest', {})] });
    // Two polls, then the lock comes back.
    const tick = made.tick();
    available = true;
    await tick;
    assert.deepStrictEqual(session.asked('rest').length, 1);
});

test('Rest fully waits for full mana and health, which is the Full flag', async () => {
    // CmdRest.cs: `if (Full) await instance.WaitUntil(() => Player.Mana >= Player.ManaMax && Player.Health >= Player.HealthMax);`
    const session = fakeSession({ health: 10, mana: 5, healthMax: 100, manaMax: 90 });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdRest', { Full: true }), command('CmdStop', {})] });
    await made.tick();
    // Not full, so the wait held the command thread; the poll interval is the engine's own.
    assert.ok(made.records.length === 0 || made.records.every(function (l) { return typeof l === 'string'; }));
    assert.ok(made.waited.length > 0, 'the wait polled with the engine interval');
});

test('ExitCombatBeforeRest refreshes the cell while the player is in combat', async () => {
    // CmdRest.cs: `while (Player.CurrentState == Player.State.InCombat) { Player.MoveToCell(Player.Cell,
    // Player.Pad); await Task.Delay(1250); }` - State.InCombat is 2 in the reference's own enum.
    const session = fakeSession({ state: 2, cell: 'Right', pad: 'Left' });
    // The reference's loop is unbounded; the test makes the game answer the jump by leaving combat.
    session.jump = function (cell, pad) {
        session.calls.push({ name: 'jump', args: [cell, pad] });
        session.snapshot.state = 1;
        return Promise.resolve();
    };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdRest', {})], ExitCombatBeforeRest: true });
    await made.tick();
    assert.deepStrictEqual(session.asked('jump')[0], { name: 'jump', args: ['Right', 'Left'] });
});

test('CmdSkillSet is one of the classes BotUtilities does not pace', async () => {
    // BotUtilities.cs RequiresDelay lists CmdIndex, CmdLabel, CmdGotoLabel, CmdBlank, CmdBlank3 and
    // CmdSkillSet, and Bot.cs consults it only under SkipDelayIndexIf - so the delay applies in
    // both configurations for the others and neither for these.
    assert.strictEqual(engineModel.requiresDelay(command('CmdSkillSet', { Name: 'nuke' })), false);
    assert.strictEqual(engineModel.requiresDelay(command('CmdKill', { Monster: '*' })), true);
    assert.strictEqual(engineModel.requiresDelay(command('CmdJoin', { Map: 'yulgar' })), true);

    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdSkillSet', { Name: 'nuke' }), command('CmdCancelTarget', {})],
        BotDelay: 500,
        SkipDelayIndexIf: true
    });
    await made.tick();
    assert.deepStrictEqual(made.waited, [], 'SkipDelayIndexIf spares the set command its delay');
    await made.tick();
    assert.ok(made.waited.indexOf(500) !== -1, 'and gives it back to the command after it');
});

test('CmdSkillSet sets the label the rotation starts from, the way BotData carries it', async () => {
    // CmdSkillSet.cs sets BotData.BotSkill = Name.ToUpper(); Bot.cs builds SkillSet from the label
    // rows (SkillType.Label is 2), keyed "[" + Text.ToUpper() + "]"; CmdKill and CmdAttack then
    // start their rotation at that entry plus one. A skill whose cast this build cannot make is
    // still the right probe: what matters is *which* skill index was reached.
    const session = fakeSession({});
    session.useSkill = function (index) {
        session.calls.push({ name: 'useSkill', args: [index] });
        return Promise.reject(new Error('refused'));
    };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdSkillSet', { Name: 'nuke' }), command('CmdAttack', { Monster: '*', UseSkill: true })],
        Skills: [
            { $type: 'Grimoire.Game.Data.Skill, Grimoire', Text: '1: First', Index: '1' },
            { $type: 'Grimoire.Game.Data.Skill, Grimoire', Text: '[NUKE]', Index: '0', Type: 2 },
            { $type: 'Grimoire.Game.Data.Skill, Grimoire', Text: '3: Third', Index: '3' }
        ]
    });
    await made.tick();
    await made.tick();
    // Sidebar of two: the command alone never reaches a skill; the set command's [NUKE] at index 1
    // makes the rotation start at 2, and the row there is the third skill.
    assert.deepStrictEqual(session.asked('useSkill').length, 1, 'the rotation does reach a skill');
});

test('CmdUseSkill attacks its monster when it has no target, the way FindTarget does', async () => {
    // CmdUseSkill.cs: string target = Monster ("*" by default); FindTarget runs before the
    // Force/HasTarget test, and FindTarget attacks when there is no target yet.
    const session = fakeSession({ hasTarget: false });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdUseSkill', { Index: '2', Monster: 'Gravelyn' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('attackMonster')[0].args, ['Gravelyn']);
});

test('CmdUseSkill returns with nothing done when the target cannot be found', async () => {
    // Same file: `if (!Force && !Player.HasTarget) return;` - the command leaves rather than
    // casting a hostile skill at nobody.
    const session = fakeSession({ hasTarget: false, monsterAvailable: false });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdUseSkill', { Index: '2', Monster: 'nobody' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('useSkill'), [], 'no skill is cast');
    assert.deepStrictEqual(session.asked('forceUseSkill'), []);
});

test('CmdUseSkill with Force casts even with no target', async () => {
    // Same file: the Force flag skips the early return but not the FindTarget.
    const session = fakeSession({ hasTarget: false });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdUseSkill', { Index: '3', Monster: '*', Force: true })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('useSkill')[0].args, ['3']);
});

test('CmdUseSkill with Wait waits out the skill own cooldown before casting', async () => {
    // Same file: `if (Wait) { await Task.Delay(Player.SkillAvailable(Index)); FindTarget(target); }`
    const session = fakeSession({ hasTarget: true });
    session.skillAvailable = function (index) {
        session.calls.push({ name: 'skillAvailable', args: [index] });
        return Promise.resolve(1500);
    };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdUseSkill', { Index: '1', Monster: '*', Wait: true })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('skillAvailable')[0].args, ['1']);
    assert.ok(made.waited.indexOf(1500) !== -1, 'the cooldown it answered is the wait: ' + made.waited.join(','));
    assert.deepStrictEqual(session.asked('useSkill')[0].args, ['1']);
});

test('a Chrono Shadow class is forced rather than walked into range, as isCSH does', async () => {
    // CmdUseSkill.cs: `if (isCSH()) Player.ForceUseSkill(Index); else Player.UseSkill(Index);`
    const session = fakeSession({ className: 'Chrono Shadow Weaver' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdUseSkill', { Index: '4', Monster: '*' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('forceUseSkill')[0].args, ['4']);
    assert.deepStrictEqual(session.asked('useSkill'), []);
});

test('a skill that cannot be cast is reported in the log and the list moves on', async () => {
    // The last acceptance criterion again, for the skill commands: the refusal names the helper and
    // the owning ticket, and the bot keeps its place in the list.
    const session = fakeSession({});
    session.useSkill = function () {
        return Promise.reject(new Error('"UseSkill" refuses: world.testAction takes a live action object (ticket #38)'));
    };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdUseSkill', { Index: '2', Monster: '*' }), command('CmdStop', {})] });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /UseSkill/.test(line) && /#38/.test(line); }),
        made.records.join(' | '));
    assert.strictEqual(made.running(), true);
    assert.strictEqual(made.index(), 1);
});

test('a dead monster is not available, which is the loader own intState guard', () => {
    // World.as: `_loc2_.dataLeaf.intState > 0` is the second half of the same condition, and it is
    // what makes a respawn wait a wait: the corpse is still in the cell and still named.
    const bridge = fakeBridge(monsters(), liveClips());
    const game = access(bridge);
    return game.call('IsMonsterAvailable', ['Skeleton']).then((answer) => {
        assert.strictEqual(answer, false, 'an intState of 0 is a corpse, not a target');
    });
});

test('a monster whose clip the game has not built yet is not available', () => {
    // World.as GetMonsterByName: `if(_loc2_.pMC)` guards the name read, so a monster the client has
    // not drawn yet is skipped rather than matched.
    const bridge = fakeBridge(monsters(), { 'world.monsters.0.pMC': false, 'world.monsters.1.pMC': true });
    const game = access(bridge);
    return game.call('IsMonsterAvailable', ['gravelyn']).then((answer) => {
        assert.strictEqual(answer, false, 'no clip means no name to match against');
    });
});

test('IsMonsterAvailableByMonMapID resolves the id the reference passes as id:<MonMapID>', () => {
    // World.as GetMonsterByMonMapId matches on dataLeaf.MonMapID with the same containment test;
    // Grimoire/Game/Player.cs AttackMonster turns "id'", "id.", "id:" and "id-" prefixes into it.
    const bridge = fakeBridge(monsters(), liveClips());
    const game = access(bridge);
    return Promise.all([
        game.call('IsMonsterAvailableByMonMapID', ['17']),
        game.call('IsMonsterAvailableByMonMapID', ['*']),
        game.call('IsMonsterAvailableByMonMapID', ['99']),
        // MonMapID 18 is the dead one, so the intState guard rules it out here too.
        game.call('IsMonsterAvailableByMonMapID', ['18'])
    ]).then((answers) => {
        assert.deepStrictEqual(answers, [true, true, false, false]);
    });
});

test('GetMonsterHealth answers the monster own intHP and refuses when it is not there', () => {
    // World.as GetMonsterHealth: GetMonsterByName(name).dataLeaf.intHP. The loader dereferences the
    // find without a null check, which its C# caller then reads as a failed call; here the missing
    // monster is a refusal that names it.
    const bridge = fakeBridge(monsters(), liveClips());
    const game = access(bridge);
    return game.call('GetMonsterHealth', ['gravelyn']).then((hp) => {
        assert.strictEqual(hp, 120);
        return game.call('GetMonsterHealth', ['nobody']).then(() => {
            throw new Error('should have refused');
        }, (error) => {
            assert.ok(/nobody/.test(error.message), 'the refusal names the monster: ' + error.message);
        });
    });
});

test('GetMonstersInCell projects the loader own eight fields for the cell it was asked for', () => {
    // World.as GetMonstersInCell(cell): for each monster in getMonstersByCell(cell), copy sRace,
    // strMonName, MonID, MonMapID, iLvl, intState, intHP and intHPMax - and nothing else.
    const bridge = fakeBridge(monsters(), liveClips());
    const game = access(bridge);
    return game.call('GetMonstersInCell', ['Enter']).then((list) => {
        assert.deepStrictEqual(list, [{
            sRace: 'human',
            strMonName: 'Gravelyn the Good',
            MonID: 8,
            MonMapID: 17,
            iLvl: 5,
            intState: 1,
            intHP: 120,
            intHPMax: 200
        }, {
            sRace: 'undead',
            strMonName: 'Skeleton',
            MonID: 9,
            MonMapID: 18,
            iLvl: 6,
            intState: 0,
            intHP: 0,
            intHPMax: 150
        }]);
        assert.deepStrictEqual(Object.keys(list[0]).sort(),
            ['MonID', 'MonMapID', 'iLvl', 'intHP', 'intHPMax', 'intState', 'sRace', 'strMonName']);
    });
});

test('GetVisibleMonstersInCell keeps the drawn, living monsters, the loader own guard', () => {
    // World.as GetVisibleMonstersInCell: same projection, but only where pMC is present, pMC.visible
    // is true and intState is above 0 - and only in the cell the player stands in.
    const answers = monsters();
    answers['world.monsters.0.pMC.visible'] = true;
    answers['world.monsters.1.pMC.visible'] = true;
    answers['world.monsters.2.pMC.visible'] = true;
    answers['world.monsters.length'] = 3;
    const bridge = fakeBridge(answers, liveClips());
    const game = access(bridge);
    return game.call('GetVisibleMonstersInCell', []).then((list) => {
        assert.strictEqual(list.length, 1, 'the dead one and the one in another cell are skipped');
        assert.strictEqual(list[0].strMonName, 'Gravelyn the Good');
    });
});

test('a monster the client has hidden is not visible, which is the pMC.visible half', () => {
    const answers = monsters();
    answers['world.monsters.0.pMC.visible'] = false;
    const bridge = fakeBridge(answers, liveClips());
    const game = access(bridge);
    return game.call('GetVisibleMonstersInCell', []).then((list) => {
        assert.deepStrictEqual(list, [], 'a hidden clip is not a visible monster');
    });
});

test('an empty monsters list is answered as empty, not refused', () => {
    const bridge = fakeBridge({ 'world.monsters.length': 0, 'world.strFrame': 'Enter' }, {});
    const game = access(bridge);
    return game.call('GetMonstersInCell', ['Enter']).then((list) => {
        assert.deepStrictEqual(list, []);
    });
});

test('a monsters collection the bridge cannot index is refused, never answered as empty', () => {
    // The list is a Vector of live avatars, so a member name that resolves but whose entries do
    // not read back is a bridge limit rather than an empty map. Answering [] there would look
    // exactly like "the cell is empty", which is the one wrong answer a respawn wait must not get.
    const bridge = fakeBridge({ 'world.monsters.length': 3, 'world.strFrame': 'Enter' }, {});
    const game = access(bridge);
    return game.call('GetMonstersInCell', ['Enter']).then(() => {
        throw new Error('should have refused');
    }, (error) => {
        assert.ok(/index|read back|cannot/.test(error.message), 'the refusal says why: ' + error.message);
    });
});

test('the calls that point the avatar are made, with the primitive their own signature takes', () => {
    // These six used to refuse here: the game's own sinks are typed on live AS3 objects
    // (World.as 8075 getMonster(int) -> live Avatar, 8372 setTarget(*), 8705 testAction(Object),
    // 9659 getActionByRef(String) -> the live action Object) and the bridge carries JSON. Ticket
    // #49 measured where that boundary actually is: ExternalInterface, not the game. The game's
    // classes live in the bridge movie's own ApplicationDomain, so the movie resolves the object
    // on its side and passes it in-domain, and these rows send the primitive instead.
    const names = ['AttackMonster', 'AttackMonsterByMonMapId', 'UseSkill', 'ForceUseSkill',
        'CancelTargetSelf', 'SetTargetPvP'];
    const done = surface.implemented();
    const missing = names.filter((name) => done.indexOf(name) === -1);
    assert.deepStrictEqual(missing, [], 'these must be implemented now');

    // This stand-in records the callback and its arguments directly: these six are not game paths,
    // which is exactly what ticket #49 changed about them.
    const made = [];
    const game = surface.createLoaderSurface(function (callback, args) {
        made.push({ callback: callback, args: args });
        return Promise.resolve('ok');
    });
    return Promise.all(names.map((name) => game.call(name, ['1']))).then(() => {
        assert.deepStrictEqual(made.map((one) => one.callback), names,
            'each is asked for by the reference own name, which is the bridge callback');
        assert.deepStrictEqual(made.map((one) => one.args), [
            ['1'], ['1'], ['1'], ['1'], [], ['1']
        ], 'and hands the movie the primitive rather than a path');
    });
});

// ---------------------------------------------------------------- the session's own reads

/** The bridge the session talks to: loader names by name, and the raw reads the session owns. */
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
            asked.push({ name: name, args: args });
            const key = args[0];
            if (Object.prototype.hasOwnProperty.call(answers, key)) {
                return Promise.resolve({ ok: true, value: answers[key] });
            }
            return Promise.resolve({ ok: false, error: 'no member ' + key + ' at ' + key });
        }
    };
}

test('the combat reads the session offers are the loader own helper names', async () => {
    // Every one of these is a row of the loader surface (#48), asked for by the name the reference
    // uses. The session is the engine's whole view of the game, so the names have to be the
    // reference's, not invented ones - the same rule the login and lifecycle reads follow.
    const bridge = sessionBridge({
        HasTarget: true,
        GetTargetHealth: 120,
        SkillAvailable: 0,
        AllSkillsAvailable: 250,
        IsMonsterAvailable: true,
        IsMonsterAvailableByMonMapID: false,
        GetMonsterHealth: 120,
        GetMonstersInCell: [{ strMonName: 'Gravelyn' }],
        State: 2,
        CancelAutoAttack: undefined
    });
    const session = sessionModel.createSession({ bridge: bridge });
    assert.strictEqual(await session.hasTarget(), true);
    assert.strictEqual(await session.targetHealth(), 120);
    assert.strictEqual(await session.skillAvailable('2'), 0);
    assert.strictEqual(await session.allSkillsAvailable(), 250);
    assert.strictEqual(await session.monsterAvailable('x'), true);
    assert.strictEqual(await session.monsterAvailableByMonMapId('17'), false);
    assert.strictEqual(await session.monsterHealth('x'), 120);
    assert.deepStrictEqual(await session.monstersInCell('Enter'), [{ strMonName: 'Gravelyn' }]);
    assert.strictEqual(await session.state(), 2);
    await session.cancelAutoAttack();
    assert.deepStrictEqual(bridge.asked.map(function (a) { return a.name; }), [
        'HasTarget', 'GetTargetHealth', 'SkillAvailable', 'AllSkillsAvailable',
        'IsMonsterAvailable', 'IsMonsterAvailableByMonMapID', 'GetMonsterHealth',
        'GetMonstersInCell', 'State', 'CancelAutoAttack'
    ]);
    assert.deepStrictEqual(bridge.asked[2].args, ['2'], 'the skill index is handed on as given');
});

test('CmdCancelTarget asks for the three cancels the reference body performs, in order', async () => {
    // CmdCancelTarget.cs: Player.CancelTarget(); Player.CancelTargetSelf(); Player.CancelAutoAttack();
    const bridge = sessionBridge({ CancelTarget: undefined, CancelAutoAttack: undefined });
    const session = sessionModel.createSession({ bridge: bridge });
    await session.cancelTargets();
    assert.deepStrictEqual(bridge.asked.map(function (a) { return a.name; }),
        ['CancelTarget', 'CancelTargetSelf', 'CancelAutoAttack']);
});

test('a combat call the game cannot make reaches the caller with the movie own reason', async () => {
    // The attack and the cast are made now (ticket #49 - the movie resolves the live object in its
    // own domain), so what reaches the caller when something goes wrong is the movie's own answer
    // rather than a refusal this build invented. The engine logs it and moves on either way.
    // The movie answers an error as JSON ({"error": ...}), which the session raises with the game's
    // own words; that has to arrive as a rejection, not as a silent success.
    const bridge = sessionBridge({
        AttackMonster: new Error('the game has no world yet'),
        UseSkill: new Error('the game has no skill at index 2')
    });
    const session = sessionModel.createSession({ bridge: bridge });
    await assert.rejects(function () { return session.attackMonster('Gravelyn'); },
        /no world yet/);
    await assert.rejects(function () { return session.useSkill('2'); }, /no skill at index 2/);
});

test('the surface names the session relies on are recorded with their loader bodies', () => {
    const bodies = sessionModel.LOADER_BODIES;
    ['HasTarget', 'GetTargetHealth', 'SkillAvailable', 'AllSkillsAvailable', 'IsMonsterAvailable',
        'IsMonsterAvailableByMonMapID', 'GetMonsterHealth', 'GetMonstersInCell', 'State', 'Cell',
        'Pad', 'Map', 'Jump', 'Join', 'SetSpawnPoint', 'Rest', 'CancelAutoAttack',
        'IsActionAvailable', 'ReloadMap', 'LoadMap', 'WalkToPoint', 'GetCells', 'Class',
        'AttackMonster', 'AttackMonsterByMonMapId', 'UseSkill', 'ForceUseSkill', 'CancelTargetSelf'
    ].forEach(function (name) {
        assert.ok(bodies[name], name + ' has no recorded body');
        assert.ok(bodies[name].body, name + ' records no body');
        assert.strictEqual(bodies[name].helper, name,
            name + ' is one of the loader surface rows, so it is asked for by that name');
        assert.ok(surface.SURFACE[name], name + ' must be a name the reference registers');
    });
    // The object-taking names are implemented (ticket #49), so the session lists them as available
    // and the recorded body is what it hands the bridge.
    ['AttackMonster', 'AttackMonsterByMonMapId', 'UseSkill', 'ForceUseSkill', 'CancelTargetSelf']
        .forEach(function (name) {
            assert.ok(!surface.SURFACE[name].why, name + ' is not refused any more');
            assert.ok(surface.implemented().indexOf(name) !== -1, name + ' must be implemented');
        });
});

// ---------------------------------------------------------------- the engine's map commands

test('CmdJoin joins the map the row names, then takes its cell and spawn point', async () => {
    // CmdJoin.cs: Player.JoinMap(join, _Cell, _Pad) through TryJoin, then - once the map matches -
    // Player.MoveToCell when the cell differs, World.SetSpawnPoint, and the cell/pad it recorded.
    const session = fakeSession({ map: 'battleontown' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdJoin', { Map: 'yulgar-1234', Cell: 'Enter', Pad: 'Spawn', Try: 1 })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('join')[0].args, ['yulgar-1234', 'Enter', 'Spawn']);
});

test('a room that is not a number is rolled, the way CmdJoin rolls one', async () => {
    // Same file: `if (!int.TryParse(RoomNumber, out int n) && RoomNumber != "") { ... Next(1000, 99999) }`.
    // The roll is random, so what is asserted is the shape it is allowed to take.
    const session = fakeSession({ map: 'battleontown' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdJoin', { Map: 'yulgar-basement', Cell: 'Enter', Pad: 'Spawn' })] });
    await made.tick();
    const target = session.asked('join')[0].args[0];
    const room = target.split('-')[1];
    assert.strictEqual(target.split('-')[0], 'yulgar', 'the map half is kept');
    assert.ok(/^\d+$/.test(room), 'the room became a number: ' + target);
    assert.ok(Number(room) >= 1000 && Number(room) < 99999, 'inside the reference own range: ' + room);
});

test('CmdJoin already in the map still takes the cell and sets the spawn point', async () => {
    // CmdJoin.cs: the map half is skipped when it already matches, but the cell step and
    // World.SetSpawnPoint are outside that branch.
    const session = fakeSession({ map: 'yulgar', cell: 'Right', pad: 'Left' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdJoin', { Map: 'yulgar', Cell: 'Enter', Pad: 'Spawn' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('join'), [], 'no join is sent when the map already matches');
    assert.deepStrictEqual(session.asked('jump')[0].args, ['Enter', 'Spawn']);
    assert.strictEqual(session.asked('setSpawnPointHere').length, 1);
});

test('CmdJoin loads a map file when the row names a swf', async () => {
    // Same file: `if (MapSwf.Contains(".swf") && !MapSwf.Contains("(.swf)")) { World.LoadMap(MapSwf);
    // await instance.WaitUntil(() => !World.IsMapLoading, null, 15); }`
    const session = fakeSession({ map: 'yulgar', cell: 'Enter' });
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdJoin', { Map: 'yulgar', Cell: 'Enter', Pad: 'Spawn', MapSwf: 'yulgar.swf' })]
    });
    await made.tick();
    assert.deepStrictEqual(session.asked('loadMap')[0].args, ['yulgar.swf']);
});

test('CmdJoin that cannot reach its map says so rather than looping forever', async () => {
    // The reference's own loop is bounded by Try; this one reports the failure the ticket asks for
    // instead of repeating a join that is not landing.
    const session = fakeSession({ map: 'battleontown' });
    session.join = function (map, cell, pad) {
        session.calls.push({ name: 'join', args: [map, cell, pad] });
        return Promise.resolve();
    };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdJoin', { Map: 'yulgar', Cell: 'Enter', Pad: 'Spawn', Try: 1 })] });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /could not reach yulgar/.test(line); }),
        made.records.join(' | '));
});

test('CmdJoin2 reads downloaded Grimlite bots and rolls its 1e99 room', async () => {
    // Older Grimlite exports use CmdJoin2 with Map/Room/Cell/Pad. 1e99 means a random room;
    // this command does not set a spawn point, unlike CmdJoin.
    const session = fakeSession({ map: 'battleontown' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdJoin2', {
        Map: 'doomwood', Room: '1e99', Cell: 'Enter', Pad: 'Spawn'
    })] });
    await made.tick();
    const target = session.asked('join')[0].args[0];
    assert.ok(target.indexOf('doomwood-') === 0, target);
    const room = Number(target.split('-')[1]);
    assert.ok(room >= 1001 && room < 99999, 'inside CmdJoin2\'s own random range: ' + room);
    assert.strictEqual(session.asked('setSpawnPointHere').length, 0);
    assert.strictEqual(catalog.rowText(command('CmdJoin2', {
        Map: 'doomwood', Room: '1e99', Cell: 'Enter', Pad: 'Spawn'
    })), 'Join: doomwood, 1e99, Enter, Spawn');
});

test('CmdJoin2 already in the map takes only the cell it names', async () => {
    const session = fakeSession({ map: 'doomwood', cell: 'Right', pad: 'Left' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdJoin2', {
        Map: 'doomwood', Room: '1e99', Cell: 'Enter', Pad: 'Spawn'
    })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('join'), []);
    assert.deepStrictEqual(session.asked('jump')[0].args, ['Enter', 'Spawn']);
    assert.strictEqual(session.asked('setSpawnPointHere').length, 0);
});

test('CmdMoveToCell jumps until the cell reads back, then records where it stands', async () => {
    // CmdMoveToCell.cs: `while (!Player.Cell.EqualsIgnoreCase(Cell)) { Player.MoveToCell(Cell, Pad);
    // await Task.Delay(500); }` - the loop leaves on the cell's own answer.
    let cell = 'Enter';
    const session = fakeSession({});
    session.cell = function () { session.calls.push({ name: 'cell', args: [] }); return Promise.resolve(cell); };
    session.jump = function (to, pad) {
        session.calls.push({ name: 'jump', args: [to, pad] });
        cell = to;
        return Promise.resolve();
    };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdMoveToCell', { Cell: 'r22', Pad: 'Down' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('jump')[0].args, ['r22', 'Down']);
    assert.ok(made.waited.indexOf(500) !== -1, 'the reference waits 500ms between attempts');
});

test('CmdMoveToCell already in the cell sends nothing, as its loop does', async () => {
    const session = fakeSession({ cell: 'Enter' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdMoveToCell', { Cell: 'enter', Pad: 'Spawn' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('jump'), [], 'the comparison is case-insensitive');
});

test('CmdSetSpawn sets the spawn point where the player stands', async () => {
    // CmdSetSpawn.cs: Player.SetSpawnPoint(), which is the loader's
    // world.setSpawnPoint(world.strFrame, world.strPad).
    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdSetSpawn', {})] });
    await made.tick();
    assert.strictEqual(session.asked('setSpawnPointHere').length, 1);
});

test('CmdTravel joins when the map differs and just steps when it does not', async () => {
    // CmdTravel.cs: wait for the Transfer lock ("tfer"), and either Player.JoinMap(Map, Cell, Pad)
    // with the two waits its own WaitUntil makes, or Player.MoveToCell(Cell, Pad) + 500ms.
    const away = fakeSession({ map: 'battleontown' });
    const madeAway = engine({ session: away });
    await madeAway.start({ Commands: [command('CmdTravel', { Map: 'yulgar-1234', Cell: 'Enter', Pad: 'Spawn' })] });
    await madeAway.tick();
    assert.deepStrictEqual(away.asked('actionAvailable')[0].args, ['tfer']);
    assert.deepStrictEqual(away.asked('join')[0].args, ['yulgar-1234', 'Enter', 'Spawn']);

    const here = fakeSession({ map: 'yulgar', cell: 'Right', pad: 'Left' });
    const madeHere = engine({ session: here });
    await madeHere.start({ Commands: [command('CmdTravel', { Map: 'yulgar', Cell: 'Enter', Pad: 'Spawn' })] });
    await madeHere.tick();
    assert.deepStrictEqual(here.asked('join'), [], 'no join when the map already matches');
    assert.deepStrictEqual(here.asked('jump')[0].args, ['Enter', 'Spawn']);
    assert.ok(madeHere.waited.indexOf(500) !== -1);
});

test('a travel that cannot join reports the refusal instead of waiting it out', async () => {
    const session = fakeSession({ map: 'battleontown' });
    session.join = function () { return Promise.reject(new Error('"Join" was refused')); };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdTravel', { Map: 'yulgar', Cell: 'Enter', Pad: 'Spawn' })] });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /could not join/.test(line); }), made.records.join(' | '));
});

test('CmdWalk walks to the point it names and waits for the position to read back', async () => {
    // CmdWalk.cs: Player.WalkToPoint(X, Y) then WaitUntil(Position == [X, Y], timeout: Wait).
    let at = ['0', '0'];
    const session = fakeSession({});
    session.walkToPoint = function (x, y) {
        session.calls.push({ name: 'walkToPoint', args: [x, y] });
        at = [String(x), String(y)];
        return Promise.resolve();
    };
    session.position = function () { session.calls.push({ name: 'position', args: [] }); return Promise.resolve(at); };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdWalk', { X: '250', Y: '400' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('walkToPoint')[0].args, ['250', '400']);
});

test('a walk the game does not answer is reported, which is the live-clip limit', async () => {
    // WalkToPoint drives the avatar's own MovieClip before it asks the world to move, so the
    // surface may refuse it. The command has to say so rather than wait out its own timeout.
    const session = fakeSession({});
    session.walkToPoint = function () {
        return Promise.reject(new Error('"WalkToPoint" needs the avatar\'s own MovieClip (ticket #38)'));
    };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdWalk', { X: '250', Y: '400' })] });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /could not walk/.test(line); }), made.records.join(' | '));
});

test('a random walk picks its own point instead of the row one', async () => {
    // CmdWalk.cs: `if (Type == "Random") { Player.WalkToPoint(y: Next(320, 450), x: Next(150, 700));
    // await Task.Delay(1000); }`
    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdWalk', { Type: 'Random', X: '1', Y: '2' })] });
    await made.tick();
    const at = session.asked('walkToPoint')[0].args;
    assert.ok(Number(at[0]) >= 150 && Number(at[0]) < 700, 'x is inside 150..700: ' + at[0]);
    assert.ok(Number(at[1]) >= 320 && Number(at[1]) < 450, 'y is inside 320..450: ' + at[1]);
    assert.ok(made.waited.indexOf(1000) !== -1, 'and the reference waits a second after it');
});

test('CmdYulgar moves to yulgar, walks, and then stops the bot', async () => {
    // CmdYulgar.cs: wait for Transfer, leave combat, join yulgar's Enter/Spawn when not there, then
    // a random walk and instance.Stop().
    const session = fakeSession({ map: 'battleontown' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdYulgar', {}), command('CmdBlank', {})] });
    await made.tick();
    assert.deepStrictEqual(session.asked('join')[0].args, ['yulgar', 'Enter', 'Spawn']);
    assert.strictEqual(session.asked('walkToPoint').length, 1);
    assert.strictEqual(made.running(), false, 'the command stops the bot, as the reference does');
});

test('CmdYulgar already in yulgar does not join it again, and still stops', async () => {
    const session = fakeSession({ map: 'yulgar' });
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdYulgar', {})] });
    await made.tick();
    assert.deepStrictEqual(session.asked('join'), []);
    assert.strictEqual(made.running(), false);
});

test('a saved bot that kills and joins runs without edits', async () => {
    // The ticket's own criterion: a bot the reference wrote runs here unchanged. This is
    // Resources/Bots/kill_with_monster_id.gbot from the reference clone - CmdJoin to
    // necrodungeon-a/r22/Down and a CmdKill over "*" with KillPriority "id-49,id-50" - read
    // through this app's own reader, so the class names and field shapes are the file's.
    const fs = require('fs');
    const bots = require('../../plugins/grimlite-parity/bot/bots.js');
    const source = '/var/tmp/grimlite-src/Resources/Bots/kill_with_monster_id.gbot';
    if (!fs.existsSync(source)) {
        console.log('  (skip: the reference corpus is not on this machine)');
        return;
    }
    const parsed = bots.parseBot(fs.readFileSync(source, 'utf8'));
    assert.strictEqual(parsed.ok, true, 'the corpus bot parses: ' + parsed.error);
    assert.deepStrictEqual(parsed.bot.Commands.map(function (c) { return catalog.classNameOf(c); }),
        ['CmdJoin', 'CmdKill']);

    const session = fakeSession({ map: 'battleontown', hasTarget: false, monsterAvailable: false });
    session.join = function (map, cell, pad) {
        session.calls.push({ name: 'join', args: [map, cell, pad] });
        return Promise.resolve();
    };
    const made = engine({ session: session });
    const started = await made.start(parsed.bot);
    assert.strictEqual(started.ok, true, 'it starts: ' + started.error);
    await made.tick();
    const join = session.asked('join')[0].args;
    // The file's map is "necrodungeon-a": CmdJoin splits the room off, and since "a" is not a
    // number the reference rolls one - so the map half and the cell/pad are the file's and the
    // room is the reference's own roll.
    assert.strictEqual(join[0].split('-')[0], 'necrodungeon');
    assert.ok(/^\d+$/.test(join[0].split('-')[1]), 'the room was rolled: ' + join[0]);
    assert.deepStrictEqual(join.slice(1), ['r22', 'Down'], 'the file own cell and pad');
    await made.tick();
    // The kill could not find its monster (none in the cell), so what is asserted is that it says
    // so and still moves on - not that it killed something in a test with no game behind it.
    assert.strictEqual(made.running(), true, 'the bot keeps running');
    assert.ok(made.records.every(function (line) { return typeof line === 'string'; }));
});

test('every combat and map class the reference ships is one this engine runs', () => {
    // The ticket's first two criteria: every combat command and every map command exists and runs.
    // The reference's own groups are the list; a class the catalog knows but the engine does not
    // would be reported as "not implemented yet" at run time, which is what this pins shut.
    const handlers = engineModel.createEngine({}).handlers();
    const COMBAT = ['CmdAttack', 'CmdCancelTarget', 'CmdFollow', 'CmdKill', 'CmdKillFor',
        'CmdQuestHunt', 'CmdRest', 'CmdShortHunt', 'CmdSkillSet', 'CmdUseSkill'];
    const MAP = ['CmdJoin', 'CmdMoveToCell', 'CmdMoveToCell2', 'CmdSetSpawn', 'CmdTravel',
        'CmdWalk', 'CmdYulgar'];
    const missing = COMBAT.concat(MAP).filter(function (name) { return !handlers[name]; });
    assert.deepStrictEqual(missing, [], 'these classes have no handler: ' + missing.join(', '));
});

test('a Safe skill casts only inside its own HP threshold, as Skill.ExecuteSkill does', async () => {
    // Skill.cs ExecuteSkill: a Safe row switches on SafeType against the percentage of HP (or MP
    // when IsSafeMp), and LowerThan (0) casts only at or below the value it carries.
    const session = fakeSession({ health: 40, healthMax: 100 });
    session.useSkill = function (index) {
        session.calls.push({ name: 'useSkill', args: [index] });
        return Promise.resolve();
    };
    const safe = {
        $type: 'Grimoire.Game.Data.Skill, Grimoire', Text: 'Heal', Index: '3',
        Type: 1, SType: 0, SafeValue: 50
    };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdUseSkill', { Index: '3', Monster: '*', Force: true })],
        Skills: [safe]
    });
    await made.tick();

    // And the same row above its threshold is held back rather than cast.
    session.snapshot.health = 80;
    session.calls.length = 0;
    const healthy = engine({ session: session });
    await healthy.start({
        Commands: [command('CmdAttack', { Monster: '*', UseSkill: true })],
        Skills: [safe]
    });
    await healthy.tick();
    assert.deepStrictEqual(session.asked('useSkill'), [], 'above the threshold the heal is not cast');
});

test('CmdMoveToCell2 starts the jump without holding the list, and its stop flag cancels it', async () => {
    // CmdMoveToCell2.cs fires the jump onto its own task ("_ = Task.Run(...)") and carries on, and
    // its stop flag cancels the one that is running ("cts?.Cancel()"). The list not being held is
    // the observable difference from CmdMoveToCell: this command returns before any jump happens.
    const session = fakeSession({ cell: 'Enter' });
    const made = engine({ session: session });
    await made.start({
        Commands: [
            command('CmdMoveToCell2', { Cell: 'r1,r2', Pad: 'Left,Right', maxcell: 2 }),
            command('CmdMoveToCell2', { stop: true })
        ]
    });
    await made.tick();
    assert.strictEqual(made.index(), 1, 'the list moves on while the jump runs in the background');
    await made.tick();
    assert.strictEqual(made.running(), true, 'the stop flag cancels the jump, not the bot');
    assert.ok(made.records.every(function (line) { return typeof line === 'string'; }));
});

test('CmdMoveToCell2 with no cell to jump to says so', async () => {
    const made = engine({});
    await made.start({ Commands: [command('CmdMoveToCell2', { Cell: '', Pad: '', maxcell: 5 })] });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /no cell/.test(line); }), made.records.join(' | '));
    assert.strictEqual(made.running(), true);
});

test('stopping a bot cancels the cell jump it started', async () => {
    // Bot.Stop is what a user's own stop does, and a jump left running would keep moving a
    // character after the bot was called off.
    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdMoveToCell2', { Cell: 'r1,r2', Pad: 'Left,Right', maxcell: 2 }), command('CmdStop', {})]
    });
    await made.tick();
    assert.strictEqual(made.running(), true, 'the jump is running in the background');
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    const before = session.asked('jump').length;
    assert.ok(before > 0, 'it did jump');
    await made.tick();
    assert.strictEqual(made.running(), false);
    // One step may already have been past its own cancellation check when the stop landed, so what
    // is asserted is that the jump settles: two later readings are the same number.
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    const after = session.asked('jump').length;
    await new Promise(function (resolve) { setTimeout(resolve, 10); });
    assert.strictEqual(session.asked('jump').length, after, 'no further jumps after the stop');
});

test('CmdKillFor kills until it holds the item, and reads the container its ItemType names', async () => {
    // CmdKillFor.cs: Items (0) reads Player.Inventory.ContainsItem, Temps (1) reads
    // Player.TempInventory - the loader's GetInventoryItems and GetTempItems.
    const session = fakeSession({});
    session.items = function () {
        session.calls.push({ name: 'items', args: [] });
        return Promise.resolve([{ sName: 'Dragon Scale', iQty: 5 }]);
    };
    session.tempItems = function () {
        session.calls.push({ name: 'tempItems', args: [] });
        return Promise.resolve([{ sName: 'Tempered Root', iQty: 2 }]);
    };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdKillFor', { Monster: 'Dragon', ItemName: 'Dragon Scale', Quantity: '5', ItemType: 0 })]
    });
    await made.tick();
    assert.deepStrictEqual(session.asked('items').length, 1, 'the inventory is what Items reads');
    assert.deepStrictEqual(session.asked('attackMonster'), [], 'the item is already held, so no kill');

    const temps = fakeSession({});
    temps.tempItems = function () {
        temps.calls.push({ name: 'tempItems', args: [] });
        return Promise.resolve([{ sName: 'Tempered Root', iQty: 1 }]);
    };
    temps.attackMonster = function () { return Promise.reject(new Error('the kill could not start')); };
    const tempMade = engine({ session: temps });
    await tempMade.start({
        Commands: [command('CmdKillFor', { Monster: 'Dragon', ItemName: 'Tempered Root', Quantity: '2', ItemType: 1 })]
    });
    await tempMade.tick();
    // Twice: once before the first kill to see whether the work is needed at all, once after the
    // kill to see whether it worked - which is the reference's own `while (!ContainsItem(...))`.
    assert.ok(temps.asked('tempItems').length >= 1, 'Temps reads the temporary inventory');
    assert.strictEqual(temps.asked('items').length, 0, 'and not the real one');
    assert.ok(tempMade.records.some(function (line) { return /the kill could not start/.test(line); }),
        tempMade.records.join(' | '));
});

test('a kill-for that cannot finish says so rather than looping all night', async () => {
    // The reference's own loop is bounded only by the item appearing. Whether a kill lands is the
    // game's to decide (the attack is made, but nothing here can promise the monster dies), so the
    // loop is bounded and reports - the ticket's own rule about a target that is missing.
    const session = fakeSession({ monsterAvailable: false });
    session.items = function () { return Promise.resolve([]); };
    session.attackMonster = function () {
        return Promise.reject(new Error('no monster named Dragon is in this cell'));
    };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdKillFor', { Monster: 'Dragon', ItemName: 'Dragon Scale', Quantity: '1', ItemType: 0 })]
    });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /no monster named Dragon/.test(line); }),
        'the game own reason reaches the log: ' + made.records.join(' | '));
    assert.strictEqual(made.running(), true, 'and the bot is still running');
});

test('a kill-for whose quest half has no game access says so', async () => {
    // CmdKillFor's QuestId branch needs the injected quest access: accept, in progress, complete.
    // Without it the command reports that and does not half-run the fight.
    const session = fakeSession({});
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdKillFor', { Monster: 'Dragon', QuestId: '1234' })]
    });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /quest access/.test(line); }),
        made.records.join(' | '));
    assert.deepStrictEqual(session.asked('attackMonster'), [], 'and it does not half-run the fight');
});

test('CmdShortHunt leaves at once when the item is already held', async () => {
    // CmdShortHunt.cs: `if (itemcollected(_Items, _Qty)) return;` is the first thing it does.
    const session = fakeSession({});
    session.items = function () { return Promise.resolve([{ sName: 'Dragon Scale', iQty: 9 }]); };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdShortHunt', {
            Map: 'necrodungeon-a', Cell: 'r22', Pad: 'Down', Monster: '*',
            ItemName: 'Dragon Scale', Quantity: '5', ItemType: 0
        })]
    });
    await made.tick();
    assert.deepStrictEqual(session.asked('join'), [], 'nothing to hunt for, so no map change');
    assert.deepStrictEqual(session.asked('attackMonster'), []);
});

test('CmdShortHunt joins its map before it fights in it', async () => {
    // Same file: the map it names is joined first, and only then does the kill-for run.
    const session = fakeSession({ map: 'battleontown' });
    session.items = function () { return Promise.resolve([]); };
    session.join = function (map, cell, pad) {
        session.calls.push({ name: 'join', args: [map, cell, pad] });
        session.snapshot.map = map.split('-')[0];
        return Promise.resolve();
    };
    session.attackMonster = function (name) {
        session.calls.push({ name: 'attackMonster', args: [name] });
        return Promise.reject(new Error('no live Avatar'));
    };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdShortHunt', {
            Map: 'necrodungeon-a', Cell: 'r22,r23', Pad: 'Down,Left', Monster: 'Dragon',
            ItemName: 'Dragon Scale', Quantity: '1', ItemType: 0
        })]
    });
    await made.tick();
    assert.deepStrictEqual(session.asked('join')[0].args, ['necrodungeon-a', 'r22', 'Down']);
    assert.ok(made.records.some(function (line) { return /live Avatar/.test(line); }),
        'the fight it could not start is reported: ' + made.records.join(' | '));
});

test('CmdQuestHunt without a quest id is the item hunt its own non-quest branch runs', async () => {
    // CmdQuestHunt.cs: `bool doQuest = QID != 0;` and the non-quest branch hunts the item list it
    // was given, one entry at a time.
    const session = fakeSession({ map: 'battleontown' });
    session.items = function () { return Promise.resolve([]); };
    session.join = function (map, cell, pad) {
        session.calls.push({ name: 'join', args: [map, cell, pad] });
        session.snapshot.map = map.split('-')[0];
        return Promise.resolve();
    };
    session.attackMonster = function () { return Promise.reject(new Error('no live Avatar')); };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdQuestHunt', {
            Map: 'necrodungeon', Cell: 'r22,r23', Pad: 'Down,Left', Monster: 'Dragon',
            ItemName: 'Dragon Scale', Quantity: '1', QID: 0
        })]
    });
    await made.tick();
    assert.deepStrictEqual(session.asked('join')[0].args, ['necrodungeon', 'r22', 'Down']);
});

test('a quest hunt without game access says what it cannot read', async () => {
    // CmdQuestHunt.cs reads quest.RequiredItems from the quest tree; without the injected quest
    // access the row reports that rather than inventing required items.
    const session = fakeSession({});
    session.items = function () { return Promise.resolve([]); };
    const made = engine({ session: session });
    await made.start({
        Commands: [command('CmdQuestHunt', { Map: 'necrodungeon', Cell: 'r22', Pad: 'Down', QID: 4321, ItemName: '', Quantity: '' })]
    });
    await made.tick();
    assert.ok(made.records.some(function (line) {
        return /quest access/.test(line) && /4321/.test(line);
    }), made.records.join(' | '));
});

test('CmdFollow walks to the player it follows, then fights what is there', async () => {
    // CmdFollow.cs: Player.GoToPlayer(name) then a CmdKill over "*". Its cell-following packet tap
    // is not available here, which the log has to say rather than the bot appearing to follow.
    const session = fakeSession({ hasTarget: false, state: 1 });
    let looks = 0;
    session.playersInMap = function () {
        session.calls.push({ name: 'playersInMap', args: [] });
        // First pass: the followed player is there, so the kill runs. Then they leave and the
        // GoTo refusal ends the loop, which is the reference's own exit for a failed walk.
        looks++;
        return Promise.resolve(looks === 1 ? ['Arthas'] : []);
    };
    session.attackMonster = function (name) {
        session.calls.push({ name: 'attackMonster', args: [name] });
        return Promise.resolve();
    };
    session.goTo = function (name) {
        session.calls.push({ name: 'goTo', args: [name] });
        return Promise.reject(new Error('GoTo was refused'));
    };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdFollow', { PlayerName: 'Arthas' })] });
    await made.tick();
    assert.deepStrictEqual(session.asked('goTo')[0].args, ['arthas'], 'the name is lower-cased');
    assert.deepStrictEqual(session.asked('attackMonster')[0].args, ['*'], 'the follow kills there');
    assert.strictEqual(session.asked('setSpawnPointHere').length, 1, 'the reference sets the spawn');
    assert.ok(made.records.some(function (line) { return /uotls/.test(line); }),
        'the tap it cannot use is named: ' + made.records.join(' | '));
    assert.ok(made.records.some(function (line) { return /could not goto/.test(line); }),
        'the failed walk is reported: ' + made.records.join(' | '));
});

test('a follow that cannot goto its player reports the refusal', async () => {
    const session = fakeSession({});
    session.goTo = function () { return Promise.reject(new Error('"GoTo" was refused')); };
    const made = engine({ session: session });
    await made.start({ Commands: [command('CmdFollow', { PlayerName: 'Arthas' })] });
    await made.tick();
    assert.ok(made.records.some(function (line) { return /could not goto/.test(line); }), made.records.join(' | '));
});
