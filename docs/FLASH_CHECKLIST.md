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

## Bot Manager (ticket #36) - needs a display, the reference client and a bot file

The sheet, the catalog, the document mechanics, the customiser and the tree are covered offline
by `npm test` (against the reference's own designer strings and its shipped corpus). What is left
for a human is everything WinForms drew: the tab layout, the generated form, the menus behind
right-click, and whether the file the window writes opens in the reference.

Active plugin **Grimlite Parity**, restart, then **Grimlite → Bot Manager** (or **Alt+Shift+M**).

- [ ] The window opens titled **Bot Manager**, about 1004x640, with the eleven tabs in the
      reference's own order: Combat, Map, Item, Quest, Misc, Misc 2, Options, Options 2, Hunt,
      Bots, Info
- [ ] Every tab holds the reference's controls with its own labels (Combat: the skill boxes and
      *Attack without animations*; Map: cell/pad and *Join Map SWF*; Quest: *Quest ID* with its
      *Add to whitelist*; Bots: the folder tree; Info: the author and description boxes)
- [ ] **Load bot** opens a native dialog; pick a `.gbot` and the left list fills with the file's
      commands, each row carrying the reference's own text (*Move to cell: x, y*, *Kill monster*,
      *Delay 500ms*, *Quest: 1234*, ...)
- [ ] The left selector switches Commands → Skills → Quests → Drops → Boosts → Items: the list and
      the six counters under it follow the switch, and the counters read the same numbers the
      reference shows (Commands is two lines: *Number of* / *Commands: n*)
- [ ] **Search** finds a command by its text, walks to the next hit on each press, and wraps from
      the last hit back to the first; a text that is not there leaves the selection alone
- [ ] Rows render in the reference's per-class colour; a command whose class has never been
      customised is #FFDCDCDC
- [ ] **Ctrl+Up / Ctrl+Down** move the selection (and a multi-selection as one block) and the list
      keeps the moved rows selected; at either end nothing moves
- [ ] **Ctrl+D**-style duplicate copies the selection directly below itself and selects the copies;
      **Delete** removes every selected row; **Clear** empties the current list, and with **all**
      ticked it empties all six
- [ ] **Ctrl+C** copies the selected commands as their display text, one per line, in list order
- [ ] **Remove** (and Ctrl+X) cuts the rows to the clipboard; the reference's whole-configuration
      copy and paste move a complete set of lists through the clipboard, and pasting something
      that is not a bot is refused rather than half-applied
- [ ] **Insert above:** a modifier-click on an add button puts the new command at the selection
      instead of at the end, and the list scrolls the new row into view
- [ ] **Variant toggle:** the same modifier on the add button flips the command's variant the
      reference flips (for example the quest command's reaccept flag)
- [ ] **Double-click** a row opens the generated property form for that command, titled with the
      command's own name and offering one row per member the reference's form offers (its skip
      list - Tag, Description1/2, $type, Text - is not shown)
- [ ] Editing a field and pressing OK writes back to the same row in the list; Cancel changes
      nothing; a value the member's type cannot take is reported instead of thrown
- [ ] **Raw Command Editor** from the form shows the command's own JSON; a valid edit replaces the
      command, and text that does not parse is reported and leaves the command untouched
- [ ] Every add button on every tab builds the command the reference builds from the fields beside
      it (Combat *Add skill* → a skill row; Map *Move to cell* → *Move to cell: 1, Left*; Item
      *Equip* → the item's name; Misc *Delay* → *Delay 500ms*)
- [ ] A list button fills the *other* lists the reference fills: *Add all skills* → every skill of
      the equipped class, *Whitelist* → the item whitelist, *Unbank list* → the unbanked items,
      *Boost* → the boosted items; adding the same entry twice does not duplicate the ones the
      reference dedupes
- [ ] A button whose field is empty contributes nothing (it does not append a half-built command)
- [ ] The Options and Options 2 tickboxes and number boxes write the `Configuration` keys the
      reference binds them to, immediately, and they survive **Save bot** → reopen
- [ ] Right-click the list: **Change Fonts** (colour customiser and size), **Multiline Toggle**,
      **Toggle Tabpages** and **Command Customizer** are all offered
- [ ] The command customiser lists the three extras (Index, Variable, ExtendedVariable) before the
      classes; a colour picked for one class paints that class's rows and no others; size is
      clamped to 20-100 and changes the row height and font together
- [ ] Colours, centring and size survive closing the window, and survive a restart
- [ ] The **Bots** tab shows the chosen folder's subfolders and its `.gbot` files, one level at a
      time (a folder expands to its own contents, not the whole tree); the root shows a count
- [ ] Selecting a folder in the tree shows the count for that folder; selecting a bot opens it
      (ctrl-click contributes it as a `CmdLoadBot` instead)
- [ ] **Add folder** makes a directory under the bots root; a name that would escape the root is
      refused; the chosen bots directory is remembered across restarts
- [ ] Drop a `.gbot` file onto the window: it opens the same way Load bot does; dropping two at
      once is ignored rather than picking one arbitrarily
- [ ] Save the edited bot, then open the same file in the reference client's Bot Manager: the
      commands, skills, quests and settings read the same, and a bot that came from Windows keeps
      its own line endings
- [ ] Save an untouched bot loaded from disk: the file has exactly the keys it came with (a key
      absent because it equalled the reference's default must not reappear)
- [ ] **Enable Bot / Disable Bot** writes the flag the reference writes; nothing here starts the
      engine - running a bot is ticket #37

### The controls that read the running game

The reference serves most of these from its own loader (Loader/grimoire.swf) rather than from the
stock game, and our bridge loads the stock game. Each name below was measured against both SWFs;
the reachable ones read the same dot-paths the reference's own loader reads, and the rest say
which helper they are waiting for instead of quietly returning nothing. Sign in before these.

- [ ] **Get current cell** (Map tab) puts the real cell in *Cell* and the pad in *Pad*; with Alt
      held it appends ",cell" / ",pad" to what is already there, like the reference
- [ ] **Get** (Hunt tab) fills *Map*, *Cell* and *Pad* from where the player is
- [ ] With Ctrl or Alt held, **Get** reports that the room number is not available instead of
      half-filling the box: that value comes from the reference's loader and the stock game has
      no equivalent
- [ ] **Current position**, the **<** / **>** join buttons, **Set Spawnpoint**, **Reload Map**,
      **Hide Loading** and **Set FPS** each say which helper they wait for, without throwing and
      without filling anything in
- [ ] **Set** (level) explains that it would inject a frame, which this window does not send yet
- [ ] The name and guild **Set** buttons explain that the substitution belongs to the bot engine
- [ ] **Test** (Options → the drop-sound list) makes the system alert sound
- [ ] With no game window open, any of the above reports that there is no game window
- [ ] With a game window open but **no character signed in**, a reachable read says the game
      reports nothing yet, rather than showing an empty cell

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

## Grimlite Parity - Cosmetics (ticket #30) - needs the real game

Open **Grimlite -> Cosmetics** (Alt+Shift+C). Every box below needs a logged-in character in a room
with other players: `npm test` covers the slot map, the file formats and every decision this window
makes, but not the game answering.

- [ ] The window opens with the reference's own grid - Helm, Armor, Class, Weapon, Off.H, Pet,
      Cape, Misc - each row a file box, a link box and a **Set** button
- [ ] The seven links read **Grab Helm / Grab Armor / Grab Class / Grab Wep / Grab Pet / Grab
      Cape / Grab Ground**; there is no Grab Off.H, as in the reference
- [ ] **Refresh** lists the room's players as `EntID: Name` with the first one selected; a player
      whose name the game has not sent does not appear as a blank row
- [ ] Refresh in an empty room reports the game's own answer instead of inventing rows
- [ ] **Grab** appends the chosen player's wear to the list as `Slot: file;link` lines, and does
      *not* touch the eight rows' boxes (the reference's handler only fills its list)
- [ ] Double-clicking a list row fills that row's own boxes; clicking the empty space does nothing
- [ ] Clicking a per-slot link fills only that link's row, and a box already holding something you
      typed is **kept**, not overwritten
- [ ] A row's **Set** puts that look on your character in game: the write is
      `world.myAvatar.loadMovieAtES`, the call the reference keeps commented out beside its own
      loader-only `SetEquip`
- [ ] A **Set** on a slot the game refuses (an item you do not own) reports the reason in the
      status line instead of looking like it worked
- [ ] **Equip All** applies every list row in order; **Equip Selected** applies only the selected
      ones, in list order; both report `n of m equipped`
- [ ] **Remove** drops the selected rows (the Delete key too); **Clear All** empties the list *and*
      all sixteen boxes
- [ ] **Save** opens a native dialog titled *Save Set*, filtered `*.gset`, starting in
      `%AppData%/AquaStar/Sets`; a name typed with no extension is saved as `.gset`
- [ ] **Load** opens the same dialog and the eight rows fill from the file
- [ ] A set file written by a **reference** client loads here, and a set saved here opens in the
      reference's own Cosmetics form with the same eight values
- [ ] A `.gset` the Sets window wrote for gear (Types Weapon / Class / Armor / Helm / Cape) loads
      without error, each name in its own box
- [ ] A file that is neither shape reports "not a Grimlite set" and leaves the grid alone
- [ ] With no game window open, Refresh and **Grab** report the bridge's own reason (no game
      window / the bridge does not register ...) rather than showing an empty room as if it were
      real
- [ ] The window is not Flash: it stays open when the game window closes, and after a game reload
      its Refresh works again without reopening it

### Cosmetics: what could not be checked here, and why

Verified against the shipped SWFs on this machine (decompressed string tables): the stock game
carries `world.uoTree`, `objData`, `eqp`, `world.myAvatar.loadMovieAtES` and `getItemByEquipSlot`,
and its own `eqp` entries carry `sFile`/`sLink`. The reference client's `GetEquip` and `SetEquip`
exist **only** in its own loader (`Loader/grimoire.swf`), which no AquaGrim user loads - that is why
this window reads the game's own wear store and writes through `loadMovieAtES`.

**No call in this window has been run against a live client.** Two things in particular need a
human:

- whether the `eqp` entries' own `sFile`/`sLink` are what `loadMovieAtES` wants back verbatim, or
  whether the reference's `ReplaceLink` strip (`x_skin.swf` -> `x`) is needed on the way in. The
  port sends what the wear store holds, so a look grabbed from a player goes back in unchanged.
- whether an `eqp` entry whose movie has not loaded reports `null` or throws, which decides whether
  a grab shows that slot as empty or as a refusal

---

## Verification log

| Date | Who | Notes |
|------|-----|--------|
| 2026-03-24 | maintainer | Partial manual run on Example Companion / menus / basic flows — looked OK; not every box above was exercised |
