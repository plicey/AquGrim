// Keeping the game's automatic basic attack off (#73). The game restarts the swing when an
// action is acknowledged (World.as getActionResult calls testAction(getAutoAttack()), and
// showActionResult starts autoActionTimer for the attack's own ack), so a single cancel is
// undone a moment later. The Auto Attack toolbar and a running bot with DisableAutoBasicAttack
// both clear it on this cadence instead.

/** chkAutoAttack's own interval (Task.Delay(150) at the top of its loop). */
const KEEP_CLEAR_MS = 150;

/**
 * One pass of the shared policy: when the caller's own setting says the basic attack must stay
 * off, ask the session to clear it. `read` is the caller's session read (name -> {ok, error}),
 * so each caller keeps its own error handling and window checks.
 * @returns {Promise<{ok: boolean, value?: any, error?: string}>|null} null when it may run
 */
function keepOff(read, disabled) {
    return disabled ? read('cancelAutoAttack') : null;
}

module.exports = {
    KEEP_CLEAR_MS: KEEP_CLEAR_MS,
    keepOff: keepOff
};
