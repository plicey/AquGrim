// The seven option toggles the reference actually ships, transcribed from its own Options menu.
// Reference: Grimlite-Li 816d9cd, Grimoire/UI/Root.cs and Grimoire/Botting/OptionsManager.cs.
//
// Root.cs:983-992 adds nine items. Two of them are never shown - "Disable Animations"
// (Root.cs:1080) and "Enable Options" (Root.cs:1116) - so seven reach the user, in this order.
// Each is an opt-in: nothing here is on until the user ticks it, and the client never enables one
// on its own (spec #19: the option set ships whole, server-visible or not).
//
// `call` is the Flash call OptionsManager makes for that toggle and `loop` is where in
// ApplySettings (OptionsManager.cs:188-217) it is re-applied:
//
//   'each'   the pass body - provoke, which ApplySettings calls before its delay
//   'second'  the group behind OptionsManager's own 2000 ms gate, in that group's order
//   absent    a one-shot: Root.cs's handler and the property's setter call it once
//
// All seven calls are names the reference's own loader provides and the stock game does not; each
// has a body in that loader over paths the game does have, and game-calls.js runs that body when
// the game answers that it has no such member. Hide Players is the one whose body cannot be
// expressed that way and reports that instead of pretending (see game-calls.js NO_ROUTE).

const LOOP_MS = 1000;          // OptionsManager.Timer's own default (OptionsManager.cs:145)
const SECOND_PASS_MS = 2000;   // the delay gate in ApplySettings (OptionsManager.cs:205)

// numWalkSpeed: Minimum 1, Maximum 99, Value 8 (BotManager.Designer.cs:5480-5505). The Options
// menu's own box ships as "20" (Root.cs:1104) and the untick restores "8" via the handler's
// Flash.Call("SetWalkSpeed", "8") (BotManager.cs:1702); the 250 ms push is BotManager.cs:1699.
const WALK_SPEED = {
    id: 'walkSpeed',
    default: 20,
    restore: 8,
    min: 1,
    max: 99,
    intervalMs: 250
};

const TOGGLES = [
    { id: 'infiniteRange', label: 'Infinite Range', call: 'SetInfiniteRange', args: [] },
    { id: 'provoke', label: 'Provoke', call: 'SetProvokeMonsters', args: [], loop: 'each' },
    { id: 'enemyMagnet', label: 'Enemy Magnet', call: 'SetEnemyMagnet', args: [], loop: 'second' },
    {
        id: 'lagKiller',
        label: 'Lag Killer',
        call: 'SetLagKiller',
        // OptionsManager.SetLagKiller is the one call that carries its own value either way
        // (OptionsManager.cs:163) - Root.cs:1289 passes the new tick straight through, so this is
        // also the one toggle with a real off call. The loop reports a state rather than an action.
        args: function (on) { return [on ? 'True' : 'False']; },
        callAlways: true,
        loop: 'second'
    },
    {
        id: 'hidePlayers',
        label: 'Hide Players',
        call: 'DestroyPlayers',
        // The loader's body walks world.avatars and destroys the avatars that are not the player's
        // own. That map cannot be enumerated through the generic callbacks, so this is the one
        // toggle whose call has no route and reports the reason (game-calls.js NO_ROUTE).
        args: [], loop: 'second'
    },
    { id: 'skipCutscenes', label: 'Skip Cutscenes', call: 'SetSkipCutscenes', args: function (on) { return [on]; }, callAlways: true, loop: 'second' },
    {
        id: 'walkSpeed',
        label: 'Walkspeed',
        call: 'SetWalkSpeed',
        // The user's own number, from the value field beside the tick. The values are handed in
        // as they are held, so this table never reaches into the feature's state itself.
        args: function (on, values) { return [String(values.walkSpeed)]; },
        intervalMs: WALK_SPEED.intervalMs
    }
];

// The order ApplySettings re-applies the gated group in. Not the menu order: the loop's own
// (OptionsManager.cs:208-214).
const SECOND_PASS_ORDER = ['enemyMagnet', 'skipCutscenes', 'hidePlayers', 'lagKiller'];

function byId(id) {
    for (let i = 0; i < TOGGLES.length; i++) {
        if (TOGGLES[i].id === id) return TOGGLES[i];
    }
    return null;
}

/** Every toggle off: the state the client starts in and the one it never leaves on its own. */
function defaults() {
    const out = {};
    TOGGLES.forEach(function (toggle) { out[toggle.id] = false; });
    return out;
}

/** The arguments one call takes, given the toggle, its new state and the current values. */
function argsFor(toggle, on, values) {
    return typeof toggle.args === 'function' ? toggle.args(on, values) : toggle.args.slice();
}

module.exports = {
    TOGGLES: TOGGLES,
    SECOND_PASS_ORDER: SECOND_PASS_ORDER,
    WALK_SPEED: WALK_SPEED,
    LOOP_MS: LOOP_MS,
    SECOND_PASS_MS: SECOND_PASS_MS,
    byId: byId,
    defaults: defaults,
    argsFor: argsFor
};
