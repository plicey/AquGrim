# Grimlite parity: remaining work

This is the draft follow-up to the merged integration PR #47. PR #47 cannot be reopened; this branch tracks the remaining 1:1 work while the alpha stays usable.

## Known user-facing gaps

- Loader-only paths still refuse where the stock game has no route: `RejectDrop`, `SetFPS`, the Bot Manager `RoomNumber` branch, and the live monster-name fill.
- Packet tools keep one spammer loop per window; Grimlite shares a single `Spammer.Instance`.
- The packaged 0.0.1 alpha is named AquGrim, but the game-window title and several platform strings still say AquaStar.
- Remaining parity details are tracked in [issue #19](https://github.com/plicey/AquGrim/issues/19) and its audit comment.

## Verification still owed

- Launch the packaged AppImage and run the manual Flash checklist.
- Verify bot combat, hunts, Maid handlers, packet tools, Bank/Cosmetics/Sets, and Char Select against a live game session.
- Re-run the 0.0.1 AppImage smoke path after any follow-up fix.

