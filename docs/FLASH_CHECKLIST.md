# Flash / plugin manual checklist

Automated tests (`npm test`, `npm run smoke:plugins`) cover contracts and assets. **PPAPI Flash and real window menus require a human run.**

Mark items with `[x]` when verified. Leave `[ ]` if not run yet.

## Before you start

- [ ] `npm install` (Electron 11.5.0)
- [ ] `npm start`
- [ ] Settings → General → Active plugin as needed → Save → **Restart**

---

## Example Companion

- [ ] Set active plugin to **Example Companion**, restart
- [ ] First window menu shows plugin entries (Example / Pages / Tools), not only Quit
- [ ] **BoxMover.swf** loads; click the window; arrow keys move the blue square
- [ ] **Alt+N** (or Example → New BoxMover) opens **exactly one** new game window from a game window **and** from a browser/inject-demo window
- [ ] Example → static rectangle.swf shows purple field + labeled square (no keyboard move)
- [ ] **Alt+E** dashboard: visits increment, sticky note saves, GitHub API fetch returns repo info
- [ ] **Alt+I** inject-demo: localized waiting text, then green “Injection OK…”
- [ ] **Alt+G / R / D** open the system browser (not an in-app GitHub window)
- [ ] **F1** Help: “AquaStar (app)” section + “Example Companion” section
- [ ] Settings → Language → Português → Restart: menus/dashboard/help in pt-BR

---

## Grimlite Parity (scaffold)

- [ ] Set active plugin to **Grimlite Parity**, restart
- [ ] The window opens the plugin's local placeholder page (no game is wired yet)
- [ ] Window menu shows the **Grimlite** entry → *Bot file*, *Eye Dropper*, *Notepad*, *About* and *Parity placeholder window*
- [ ] **Alt+Shift+B / E / N / A / G** open those five (exactly one each, from a game window and from a browser window)
- [ ] **F1** Help: platform section + "Grimlite Parity" section
- [ ] Settings → General lists *Grimlite Parity (bundled) · 0.1.0* in the active plugin picker
- [ ] Switch back to Adventure Quest Worlds, restart: AQW behaves exactly as before

---

## Grimlite Parity — bot files (ticket #24) — needs real dialogs and the reference client

File pickers and the reference client cannot run under `npm test`; the round trip itself is
covered there against the reference corpus (parse → save → byte-identical, 60/60).

- [ ] **Grimlite → Bot file** (Alt+Shift+B) opens the window with a dark, styled page
- [ ] **Open bot** shows a real native file dialog, titled *Load bot*, filtered to `*.gbot`
- [ ] Pick a bot from a folder several levels deep: it opens and is shown as the file's own text
- [ ] Close the plugin and reopen the window; **Open bot** starts in the folder last used
- [ ] Restart the app and reopen: the last-used folder is still remembered
- [ ] **Save bot** shows a real save dialog titled *Save bot*, starting in the same folder
- [ ] Save over the file you opened: the dialog warns about overwriting, and afterwards the
      file has only the lines you changed (a bot that came from Windows keeps its CRLF)
- [ ] Save with no extension typed: the file is written as `.gbot`
- [ ] Open the folder in the reference client (Grimlite-Li → Bot Manager → **Load bot**): the
      bot opens, its commands, skills, quests and settings read the same as before the edit
- [ ] Save a bot **from the reference client** and open it here: it opens, and *Save bot* over
      it leaves a byte-identical file
- [ ] Point the file dialog at a file that is not a bot (a `.txt` or `.json`): the window
      reports "not a readable bot" instead of showing an empty bot
- [ ] A bot with an RTF description saved by the reference shows readable text, not base64

## Grimlite Parity windows (ticket #25) - needs a display

Notepad (Grimlite → Notepad, Alt+Shift+N)

- [ ] The font list, the size box and the colour swatch change the selection (or what is typed next)
- [ ] Dropping a .txt file onto the sheet appends its text without disturbing the existing formatting
- [ ] **Ctrl+S** and **Save…** open a native dialog filtered *txt / gbot / all files*, and the file it writes holds the plain text shown in the sheet
- [ ] Typing the skill-dump word replaces the sheet with the lowercased equipped class name (no skill blocks yet: the class actions arrive with the bridge, ticket #28)
- [ ] Typing the map-item word replaces the sheet with the header and one [id] = name line per known id (nothing yet: the history starts empty until the game is read)
- [ ] Closing the window and reopening it does not leak the old text into a second window

Eye Dropper (Grimlite → Eye Dropper, Alt+Shift+E)

- [ ] Pressing on the button and releasing over a pixel prints #AARRGGBB / r, g, b / #RRGGBB for that pixel
- [ ] The line just picked fills the readout box in the captured colour, with black or white text per the reference brightness rule
- [ ] Each further pick appends a line to the history below
- [ ] Picking on a second monitor reads the right pixel (the display under the release point, not the primary)
- [ ] With a screen recorder or another capture running, a failed capture says so instead of printing a wrong colour

About (Grimlite → About, Alt+Shift+A)

- [ ] The version line shows the running app version, with the reference it follows named underneath
- [ ] Each of the seven credit links opens in the system browser; Kuzyph is listed without being clickable (it has no handler upstream)
- [ ] **Reload Game Movie** reloads the game window and reports that it did (with no game window open it says so instead)
- [ ] Reloading with the local origin on returns to the same loopback URL

## Grimlite Parity - the game bridge (#28)

Everything here needs live PPAPI Flash and a real login; none of it can be checked by the test
suite. The bridge's offline half (the call surface, the same-origin boot, the call modes, the
permission gate) is covered by `npm test`.

- [ ] Set active plugin to **Grimlite Parity**, restart
- [ ] The window shows the **game**, not a placeholder: the login screen renders (the bridge SWF
      loads the game SWF itself from the loopback origin)
- [ ] **Alt+Shift+D** (or Grimlite → Dev Test) opens the window: modes *Grimoire / Call Func /
      Get/Set Object*, Function defaulting to `world`, an Args box with its enable box, Call,
      Copy, Format JSON
- [ ] **Read:** mode *Grimoire*, Function `world.strFrame`, Call → the current cell comes back as
      JSON. Try `world.myAvatar.dataLeaf.intHP`, `world.strMapName`
- [ ] The game's classes are addressable, not merely lookup-able: with mode *Call Func*, Function
      `world.getQuestValue`, Args `1` → a JSON answer rather than an error about a missing member
- [ ] **Write:** mode *Get/Set Object*, Function `world.strFrame`, Args `Enter` → Call reports the
      value back. (A write to a displayed field is visible in the UI; a write to a state field is
      overwritten by the next server frame)
- [ ] **Format JSON** pretty-prints the result; **Copy** puts the result box on the clipboard
- [ ] **A newer game or loader still works:** with no code change, the window boots on whatever
      file `api/data/gameversion` currently names (that is what the bridge resolves at runtime)
- [ ] **Permission gate:** temporarily remove `"game-bridge"` from `plugins/grimlite-parity/plugin.json`,
      restart, open Dev Test, Call → the app reports the missing permission and the game window is
      unaffected. Restore the manifest afterwards
- [ ] **No game window:** close the game window, then Call from Dev Test → it reports that there is
      no game window rather than hanging or throwing
- [ ] Packet send (`sendClientPacket`) is **unverified**: the reference's `ExtHandler` signature
      could not be checked offline. The bridge tries the one-argument shape and falls back to the
      two-argument one; confirm against a live client which is right, then drop the other
      (`plugins/grimlite-parity/bridge/AquaBridge.as`, `aqSendClientPacket`)

## Packet logger (ticket #26) - needs a display, the network and an account

Active plugin **Grimlite Parity**, then Settings → Packets → tick **Steer game traffic through a
local relay** → Save → **Restart**. The logger reads the relay, so nothing appears until that
opt-in is on (and the window says so if you press Start without it).

- [ ] Window menu shows **Packets → Sniffer**; it opens one window titled **Packet logger**
- [ ] The window opens **stopped**; press Start and it says it is watching
- [ ] Sign in: the handshake frames appear, client and server rows interleaved in the order they
      happened, each labelled with its direction (the policy request, the verChk/apiOK pair, the
      account login frame)
- [ ] Move, fight or open a shop: those frames appear too, in both directions
- [ ] Type in **Filter**: only matching frames are listed; clear it and everything that arrived
      while it was narrowed is still there (nothing was dropped)
- [ ] **Copy**: the clipboard holds the lines as shown; **Clear** empties the list and the window
      keeps watching
- [ ] **Stop**: the list stops growing; **Start** resumes and frames continue, with no duplicate
      of anything already listed
- [ ] Open a second **Packets → Sniffer** window and Start it: each window shows each frame once,
      in order (no doubled rows, no lost rows)
- [ ] Close one of the two windows: the other keeps receiving. Close both, reopen one and Start:
      traffic resumes with no stale subscription
- [ ] Restart with the steering opt-in **off**: the window still says it is watching and simply
      stays empty, because the relay it reads is not running; turning the opt-in back on and
      restarting makes frames appear again
- [ ] Switch the active plugin back to **Adventure Quest Worlds**, restart: no Packets menu, and
      the game behaves exactly as before

---

## Grimlite Parity — Bank and Sets (ticket #29) — needs the real game and dialogs

**Blocked on ticket #28.** Everything below that touches the game is unreachable today: the
plugin's game access (`plugins/grimlite-parity/bridge.js`) reports "the game bridge is not
wired in this build (ticket #28) yet" for every call, and never pretends to have transferred or
equipped anything. The window shells, the list model, the persistence and the set file format
are covered by `npm test`; these boxes are the live half.

- [ ] With ticket #28 merged: **Bank** transfers the chosen category, honouring the AC/non-AC
      choice, and does not touch equipped items or Treasure Potion
- [ ] **Bank all except selected** moves everything outside the selection, and nothing in it
- [ ] **Bank All** with ACs moves AC items even when the bank is full; with non-ACs it stops
      when the bank fills, without an error
- [ ] A long transfer paces itself: the game accepts every move, and no "transaction already in
      progress" style rejection appears
- [ ] The window reports completion (how many of how many) when a transfer ends
- [ ] **Sets → Add** fills the combo with the five groups (Weapons, Classes, Armors, Helmets,
      Capes) and the separators cannot be picked
- [ ] **Save** writes a set where the dialog points, and a `.gset` written by **Grimlite-Li**
      (`Sets/` beside its exe) opens here and lists its items
- [ ] A set saved **here** opens in Grimlite-Li's own Sets form (Tools → Sets)
- [ ] **Equip** equips the set's items in order; an item not in the bag is skipped and
      reported, not fatal
- [ ] If the game refuses an equip, the sequence stops and the window says so rather than
      continuing as if it worked
- [ ] Closing either window and reopening it (**Grimlite → Bank** / **Sets**) restores its
      state, and the sets folder is the one last used

---

## Adventure Quest Worlds

- [ ] Switch active plugin to **Adventure Quest Worlds**, restart
- [ ] Game menu shows Game / Features / Pages
- [ ] Alt+N new AQW instance; Alt+1 DragonFable
- [ ] Alt+T Reminders / Alt+Y To-Do / Alt+I Inventory / Alt+U Strategy open and persist after restart
- [ ] F1 Help: platform section + Adventure Quest Worlds section
- [ ] Wiki / account pages load; WikiView still works on wiki hosts

---

## Platform regression (any active plugin)

- [ ] **F2** screenshot saves under Pictures / AquaStar Screenshots
- [ ] **Ctrl+J** screen recording starts/stops and saves WebM to the chosen path
- [ ] **Alt+9** Settings: General / Active plugin / Keybinds tabs; Language; save + restart still work
- [ ] **Alt+K** on an AQW Char Page (AQW plugin): hidden 4K capture window runs, then closes; image saved

---

## Local plugins (optional)

- [ ] Drop a copy of `plugins/_template` (renamed id) under `%AppData%/AquaStar/plugins/`
- [ ] Settings → enable local plugins → trust the plugin → select it → restart
- [ ] App loads that plugin’s primary URL; bundled AQW is not required for that session
- [ ] Disable / untrust and confirm it no longer activates

---

## Local game origin (ticket #23) - needs a display and the network

Set `"localOrigin": true` in `aquastar.json` (Settings → General → "Local game origin") and restart.

- [ ] Window opens and the game reaches the login screen: same rendering as before, no error page
- [ ] No request reaches any host other than `127.0.0.1`
- [ ] Five requests, none 404: `/wrapper.html`, `/game/gamefiles/Loader4.swf`, `/game/api/data/gameversion`, the game SWF it names, the title SWF it names
- [ ] Login works: the account POST is answered (no hang on "Authenticating Account Info")
- [ ] A version-payload outage does not wedge the boot: the loader retries and the window shows a failure rather than hanging
- [ ] Default (`"localOrigin"` absent or false) still boots from the live URLs, unchanged
- [ ] With a local SWF override or `customUrl` set, that URL still wins

---

## Packaging smoke

- [ ] `npm run smoke:plugins`
- [ ] Optional: `npm run pack` then confirm `plugins/adventure-quest-worlds` and `plugins/example-companion` exist under the unpacked app (`resources/app` or equivalent)

---

## Verification log

| Date | Who | Notes |
|------|-----|--------|
| 2026-03-24 | maintainer | Partial manual run on Example Companion / menus / basic flows — looked OK; not every box above was exercised |
