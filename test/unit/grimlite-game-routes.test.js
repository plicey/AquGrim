// The ten game calls the Options and Hotkeys windows make are names the reference's own loader
// provides and the stock game does not carry. The reference material upgrade (the loader's own
// decompiled bodies) settles what that means: the loader is a RENAMING LAYER over the game, and
// each of those names has a body reading and calling paths the game does have.
//
// Expected values below are transcribed from those bodies, one for one:
//   /var/tmp/aq48/out-loader/scripts/grimoire/game/Settings.as   SetInfiniteRange, SetProvokeMonsters,
//                                                               SetEnemyMagnet, SetLagKiller,
//                                                               DestroyPlayers, SetSkipCutscenes,
//                                                               SetWalkSpeed
//   /var/tmp/aq48/out-loader/scripts/grimoire/game/Player.as    CancelTarget, SetWalkSpeed
//   /var/tmp/aq48/out-loader/scripts/grimoire/game/Shops.as     LoadHairShop, LoadArmorCustomizer
//
// So the port asks the game for the reference's name first - if a future bridge implements that
// surface, that answer wins - and when the game answers "no member <name>", it does what the
// loader's own body does, through the generic callbacks the bridge does expose.
const assert = require('assert');
const path = require('path');

const pluginRoot = path.join(__dirname, '../../plugins/grimlite-parity');
const gameCallsModule = require(path.join(pluginRoot, 'game-calls.js'));

// A bridge that behaves like the stock game behind the real bridge: it answers the game's own
// paths (whatever a test says they hold), and for each of the reference loader's ten names it
// answers the game's own "no member <name>" - which is exactly the situation being tested.
function fakeBridge(answers) {
    const calls = [];
    return {
        calls: calls,
        attach: function () { return Promise.resolve({ ok: true }); },
        call: function (name, args) {
            calls.push([name, (args || []).slice()]);
            const key = (args || [])[0];
            // A test may say what the game answers even for one of the ten names, which is how
            // "a bridge that has grown the loader's surface" is written.
            const value = answers ? answers(key, args) : undefined;
            if (value !== undefined) {
                return Promise.resolve({ ok: true, value: JSON.stringify(value) });
            }
            if (gameCallsModule.LOADER_ONLY[key]) {
                return Promise.resolve({
                    ok: true,
                    value: JSON.stringify({ error: 'no member ' + key + ' at ' + key })
                });
            }
            return Promise.resolve({ ok: true, value: JSON.stringify(null) });
        }
    };
}

function gameCalls(bridge) {
    return gameCallsModule.createGameCalls({ bridge: bridge, log: function () {} });
}

/** Everything the port asked, without the first attempt at the reference's own name. */
function route(calls) {
    return calls.slice(1);
}

test('Infinite Range becomes the six action ranges the loader sets', async () => {
    // Settings.as:SetInfiniteRange: while(i <= 5) world.actions.active[i].range = 20000.
    const bridge = fakeBridge();
    const answer = await gameCalls(bridge).call('callGameFunction0', ['SetInfiniteRange']);
    assert.strictEqual(answer.ok, true, answer.error);
    assert.deepStrictEqual(route(bridge.calls), [
        ['setGameObject', ['world.actions.active.0.range', 20000]],
        ['setGameObject', ['world.actions.active.1.range', 20000]],
        ['setGameObject', ['world.actions.active.2.range', 20000]],
        ['setGameObject', ['world.actions.active.3.range', 20000]],
        ['setGameObject', ['world.actions.active.4.range', 20000]],
        ['setGameObject', ['world.actions.active.5.range', 20000]]
    ]);
});

test('Provoke becomes the game own aggro call', async () => {
    // Settings.as:SetProvokeMonsters: world.aggroAllMon().
    const bridge = fakeBridge();
    await gameCalls(bridge).call('callGameFunction0', ['SetProvokeMonsters']);
    assert.deepStrictEqual(route(bridge.calls), [['callGameFunction0', ['world.aggroAllMon']]]);
});

test('Enemy Magnet moves the target onto the player, and does nothing with no target', async () => {
    // Settings.as:SetEnemyMagnet: read myAvatar.pMC.x/.y, write them to target.pMC.x/.y, and only
    // when there is a target at all.
    const withTarget = fakeBridge(function (key) {
        if (key === 'world.myAvatar.target') return { id: 7 };
        if (key === 'world.myAvatar.pMC.x') return 120.5;
        if (key === 'world.myAvatar.pMC.y') return 340;
    });
    await gameCalls(withTarget).call('callGameFunction0', ['SetEnemyMagnet']);
    assert.deepStrictEqual(route(withTarget.calls), [
        ['getGameObject', ['world.myAvatar.target']],
        ['getGameObject', ['world.myAvatar.pMC.x']],
        ['getGameObject', ['world.myAvatar.pMC.y']],
        ['setGameObject', ['world.myAvatar.target.pMC.x', 120.5]],
        ['setGameObject', ['world.myAvatar.target.pMC.y', 340]]
    ]);

    const noTarget = fakeBridge(function (key) {
        if (key === 'world.myAvatar.target') return null;
    });
    const answer = await gameCalls(noTarget).call('callGameFunction0', ['SetEnemyMagnet']);
    assert.strictEqual(answer.ok, true, answer.error);
    assert.deepStrictEqual(route(noTarget.calls), [['getGameObject', ['world.myAvatar.target']]]);
});

test('Lag Killer hides the game movie itself, and the value decides which way', async () => {
    // Settings.as:SetLagKiller: world.visible = (param1 == "False"), so "True" hides the game.
    const on = fakeBridge();
    await gameCalls(on).call('callGameFunction', ['SetLagKiller', 'True']);
    assert.deepStrictEqual(route(on.calls), [['setGameObject', ['world.visible', false]]]);

    const off = fakeBridge();
    await gameCalls(off).call('callGameFunction', ['SetLagKiller', 'False']);
    assert.deepStrictEqual(route(off.calls), [['setGameObject', ['world.visible', true]]]);
});

test('Walkspeed writes the game own WALKSPEED as a number', async () => {
    // Settings.as:SetWalkSpeed: world.WALKSPEED = parseInt(param1).
    const bridge = fakeBridge();
    await gameCalls(bridge).call('callGameFunction', ['SetWalkSpeed', '33']);
    assert.deepStrictEqual(route(bridge.calls), [['setGameObject', ['world.WALKSPEED', 33]]]);
});

test('Skip Cutscenes empties the external movie, then shows the game again', async () => {
    // Settings.as:SetSkipCutscenes: remove every child of mcExtSWF, world.visible = true,
    // showInterface().
    let children = 2;
    const bridge = fakeBridge(function (key) {
        if (key === 'mcExtSWF.numChildren') return children--;
    });
    const answer = await gameCalls(bridge).call('callGameFunction0', ['SetSkipCutscenes']);
    assert.strictEqual(answer.ok, true, answer.error);
    assert.deepStrictEqual(route(bridge.calls), [
        ['getGameObject', ['mcExtSWF.numChildren']],
        ['callGameFunction', ['mcExtSWF.removeChildAt', 0]],
        ['getGameObject', ['mcExtSWF.numChildren']],
        ['callGameFunction', ['mcExtSWF.removeChildAt', 0]],
        ['getGameObject', ['mcExtSWF.numChildren']],
        ['setGameObject', ['world.visible', true]],
        ['callGameFunction0', ['showInterface']]
    ]);
});

test('a cutscene that will not empty is reported rather than looped on forever', async () => {
    // The loop is the loader's own while (numChildren > 0); against a live movie a child that
    // cannot be removed must not hang the app, so the port bounds it and says what happened.
    const bridge = fakeBridge(function (key) {
        if (key === 'mcExtSWF.numChildren') return 3;   // never drops
    });
    const answer = await gameCalls(bridge).call('callGameFunction0', ['SetSkipCutscenes']);
    assert.strictEqual(answer.ok, false);
    assert.ok(/cutscene|mcExtSWF/i.test(answer.error), answer.error);
    const removals = route(bridge.calls).filter(function (one) {
        return one[0] === 'callGameFunction' && one[1][0] === 'mcExtSWF.removeChildAt';
    });
    assert.strictEqual(removals.length, 100, 'the loop must stop at its bound');
});

test('Cancel Target calls the game own cancelTarget twice, as the loader does', async () => {
    // Player.as:CancelTarget: world.cancelTarget() twice.
    const bridge = fakeBridge();
    await gameCalls(bridge).call('callGameFunction0', ['CancelTarget']);
    assert.deepStrictEqual(route(bridge.calls), [
        ['callGameFunction0', ['world.cancelTarget']],
        ['callGameFunction0', ['world.cancelTarget']]
    ]);
});

test('the two shops send the requests the loader sends', async () => {
    // Shops.as: world.sendLoadHairShopRequest(parseInt(param1)) and openArmorCustomize().
    const hair = fakeBridge();
    await gameCalls(hair).call('callGameFunction', ['LoadHairShop', '1']);
    assert.deepStrictEqual(route(hair.calls), [
        ['callGameFunction', ['world.sendLoadHairShopRequest', 1]]
    ]);

    const armor = fakeBridge();
    await gameCalls(armor).call('callGameFunction0', ['LoadArmorCustomizer']);
    assert.deepStrictEqual(route(armor.calls), [['callGameFunction0', ['openArmorCustomize']]]);
});

test('Hide Players is the one name with no route, and says why instead of guessing', async () => {
    // Settings.as:DestroyPlayers iterates world.avatars and destroys every avatar that is not the
    // player's own. The generic surface reads and writes named paths; it cannot enumerate a map, so
    // this one has no route and the refusal carries the reason instead.
    assert.notStrictEqual(gameCallsModule.NO_ROUTE.DestroyPlayers, undefined,
        'the one name without a route must say so, with its reason');
    assert.ok(/world\.avatars/.test(gameCallsModule.NO_ROUTE.DestroyPlayers),
        gameCallsModule.NO_ROUTE.DestroyPlayers);

    const bridge = fakeBridge();
    const answer = await gameCalls(bridge).call('callGameFunction0', ['DestroyPlayers']);
    assert.strictEqual(answer.ok, false);
    assert.ok(/DestroyPlayers/.test(answer.error), answer.error);
    assert.ok(/own loader/.test(answer.error), 'the refusal keeps the shared reason: ' + answer.error);
    assert.deepStrictEqual(route(bridge.calls), [], 'nothing may be sent in place of a guess');
});

test('a name the game does answer is used as it is, route or no route', async () => {
    // The bridge may implement the loader's surface later; when the game answers, that answer is
    // the truth and the route must not fire on top of it.
    const bridge = fakeBridge(function (key) {
        if (key === 'SetWalkSpeed') return 'ok';
    });
    const answer = await gameCalls(bridge).call('callGameFunction', ['SetWalkSpeed', '20']);
    assert.deepStrictEqual(answer, { ok: true, value: 'ok' });
    assert.deepStrictEqual(bridge.calls, [['callGameFunction', ['SetWalkSpeed', '20']]]);
});

test('a route that fails is reported with both halves, never as success', async () => {
    // The reference's name is refused by the game and the port's own route to the game's path
    // fails too: the user is told both, so the reason is not lost behind the second failure.
    const calls = [];
    const bridge = {
        attach: function () { return Promise.resolve({ ok: true }); },
        call: function (name, args) {
            calls.push([name, (args || []).slice()]);
            const key = (args || [])[0];
            if (name === 'setGameObject') {
                return Promise.resolve({ ok: true, value: JSON.stringify({ error: 'no object at ' + key }) });
            }
            return Promise.resolve({
                ok: true,
                value: JSON.stringify({ error: 'no member ' + key + ' at ' + key })
            });
        }
    };
    const answer = await gameCalls(bridge).call('callGameFunction', ['SetWalkSpeed', '20']);
    assert.strictEqual(answer.ok, false);
    assert.ok(/^no member SetWalkSpeed at SetWalkSpeed/.test(answer.error), answer.error);
    assert.ok(/own loader/.test(answer.error), answer.error);
    assert.ok(/no object at world\.WALKSPEED/.test(answer.error), 'the route failure: ' + answer.error);
});

test('every route is one of the names the loader provides and the game does not', () => {
    // A route exists for a name BECAUSE the game cannot answer it; a route for a name the game
    // already answers would be dead code claiming otherwise.
    const routed = Object.keys(gameCallsModule.LOADER_ROUTE).sort();
    assert.deepStrictEqual(routed, [
        'CancelTarget', 'LoadArmorCustomizer', 'LoadHairShop', 'SetEnemyMagnet', 'SetInfiniteRange',
        'SetLagKiller', 'SetProvokeMonsters', 'SetSkipCutscenes', 'SetWalkSpeed'
    ]);
    routed.concat(Object.keys(gameCallsModule.NO_ROUTE)).forEach(function (name) {
        assert.strictEqual(gameCallsModule.LOADER_ONLY[name], true,
            name + ' must be listed as a loader-only name');
    });
    // Every name the options and hotkeys actually ask for is accounted for, one way or the other.
    const toggles = require(path.join(pluginRoot, 'features/options/toggles.js'));
    const targets = require(path.join(pluginRoot, 'features/hotkeys/action-targets.js'));
    const asked = toggles.TOGGLES.map(function (toggle) { return toggle.call; })
        .concat(Object.keys(targets.GAME_ACTIONS).map(function (label) {
            return targets.GAME_ACTIONS[label].call;
        }));
    asked.forEach(function (name) {
        const known = gameCallsModule.LOADER_ROUTE[name] !== undefined ||
            gameCallsModule.NO_ROUTE[name] !== undefined;
        assert.ok(known, name + ' is asked for but neither routed nor explained');
    });
});
