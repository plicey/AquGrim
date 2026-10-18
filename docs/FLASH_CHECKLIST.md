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

## Packet spammer and tamperer (ticket #27) - needs a display, the network and an account

Same active plugin and the same **Settings → Packets → Steer game traffic through a local relay**
opt-in as the logger above: these two windows write through the relay, so with steering off their
Send actions report that nothing was written instead of pretending.

**Packet spammer** (Packets → Spammer):

- [ ] The window is titled **Packet spammer** and carries the reference's own nine controls: the
      list, the packet box, **Add**, **Remove**, **Clear**, **Load**, **Save**, the delay spinner,
      **Send once**, **Stop** and **Start**
- [ ] The delay spinner starts at 1000 and refuses to go below 100 or above 61000
- [ ] Type a frame and press Add (or Enter): it joins the list; **Remove** deletes the row that is
      selected, and does nothing with none selected
- [ ] **Save** opens a native dialog titled *Save spammer file*, filtered `*.xml`, starting in
      `%AppData%/AquaStar/Spammer`; a name with no extension is saved as `.xml`
- [ ] Open the saved file in a text editor: one line, `<autoer>`, one `<packet>` per row, then
      `<author>Author</author>` and `<spamspeed>` - the reference's own shape
- [ ] **Load** reads it back with the same packets and the same delay in the spinner
- [ ] Load a spammer file that came from a **reference** client (or a guide): the packets load and
      the listed speed arrives in the spinner
- [ ] **Start**: the selected row walks the list in order, one frame per delay, wrapping at the end
      (sign in and watch the game react, or watch Packets → Sniffer in a second window)
- [ ] While it runs, **Add / Remove / Clear / Load** are dead, and **Stop** is live
- [ ] **Stop** stops it: no further frames arrive, and the counter stops climbing
- [ ] **Send once** writes the text box exactly once and does not start the loop
- [ ] With the game window closed (or steering off), **Start** and **Send once** report that the
      frame was not written - they do not look like they worked
- [ ] Every frame the spammer sends shows up in Packets → Sniffer, on the **Client** side, once

**Packet Tamperer** (Packets → Tamperer):

- [ ] The window is titled **Packet Tamperer** with two checkboxes (**Capture from client**,
      **Capture from server**), the send box above the receive box, the **Filter by text** box and
      **Send to client / Send to server / Clear**
- [ ] Both switches start **clear of ticks**, and the receive box stays empty until one is ticked
- [ ] Tick only **Capture from client** and sign in: client frames appear as `From client: ...`
      lines, one per line with a blank line after each, and no server frames appear
- [ ] Untick it and tick only **Capture from server**: server frames appear as `From server: ...`
      and the client frames that already arrived are still there
- [ ] Tick both: both directions appear in the order they happened
- [ ] Untick both: capture stops (nothing new arrives) while everything captured stays on screen
- [ ] Type in **Filter by text**: only the matching lines are shown, case-insensitively; clear it
      and every captured line is still there (nothing was dropped)
- [ ] **Clear** empties the receive box and leaves the two switches where you put them
- [ ] Type an edited frame in the send box and press **Send to server**: the game acts on it, and a
      Sniffer window shows it on the **Client** side
- [ ] Press **Send to client**: the client receives it, and Sniffer shows it on the **Server** side
- [ ] With both buttons and an empty send box: both are dead, as in the reference
- [ ] Close the tamperer window while capturing: the Sniffer keeps working, and reopening the
      tamperer starts with both switches clear again

### What could not be checked here, and why

The spammer's and tamperer's sending has never been run against a live client from this machine:
there is no display, no account session and no relay steering in the test environment. What the
tests do cover is the whole data path over real sockets - a rewritten login response pointing at
the relay, a client socket, the relay's forwarding, and the injected frame arriving NUL-framed on
the right side and showing up on the tap afterwards.

Two behaviours a human has to judge:

- whether a frame injected with **Send to client** is accepted by the game's own client code
  (the reference does this through `sendClientPacket` in its private loader, which this port does
  not run; here the frame goes back down the socket the server itself would have spoken on).
- whether the reference's own file loader round-trips a file *this port* wrote with the same delay
  - its reader compares the literal string `"spamspeed"` against a digits test, so it resets its
  spinner to 2000 whatever the file says. The port's reader takes the file's value (see the note
  in `features/packets/spammer.js`).

---

## Grimlite Parity — Bank and Sets (ticket #29) — needs the real game and dialogs

**Blocked on the bridge growing the reference loader's call surface.** The bridge (#28, merged)
loads the *stock* game, and every call these two windows make is a name only the reference's own
loader carries. Checked against the decompressed game SWF `/var/tmp/aq-origin/game.swf` (and the
reference loader `Loader/grimoire.swf` to confirm each name is really its own), by exact ABC
string-pool membership plus at least one multiname reference - a pool entry nothing references is
a literal, not a callable member:

| Call this feature makes | What the window uses it for | In the stock game | In the reference loader |
|---|---|---|---|
| `GetInventoryItems` | the list Bank and Sets both work from | no | yes |
| `BankSlots` | the total half of Bank All's free-space gate | no (only inside `txtBankSlots`, `iMaxBankSlots` literals) | yes |
| `UsedBankSlots` | the used half of that gate | no | yes |
| `TransferToBank` | every transfer both Bank buttons make | no | yes |
| `Equip` | one equip per item of a set | no (a pool entry, but zero multiname references) | yes |

The reference carries more loader-only names than these - `GetBankItems` (read the bank),
`TransferToInventory` (withdraw), `BankSwap`, `GetBankItemByName`, `GetBankItemByName2`,
`ShowBank`, `GetBank`, `LoadBankItems`, `IsActionAvailable` (the equip lock),
`InventorySlots` and `UsedInventorySlots` - but none of them is reachable from BankForm.cs or
Set.cs, so a surface built for these two windows does not need them. BankForm.cs makes exactly five
calls: `Player.Inventory.Items` twice, `Player.Bank.TransferToBank` on each match, and
`Player.Bank.AvailableSlots` (`BankSlots` minus `UsedBankSlots`) once per non-AC item. Set.cs and
CmdEquipSet.cs add only `Player.Inventory.Items` and `Player.Equip`.

So today a transfer reports `no member TransferToBank at world - "TransferToBank" belongs to the
reference client's own loader...` instead of pretending to have moved something, and the adapter
starts working the day the bridge implements that surface, with no change to these windows.

**What the game does carry, for whoever implements that surface.** The stock game's own bank
machinery is differently named and real: `initBank`, `bankFromInv`, `bankToInv`,
`bankSwapInv`, `addToBank`, `removeFromBank`, `isItemInBank`, `isItemInInventory`,
`getBankItem`, `bankItems`, `bankArr`, `iBankCount`, `sendBankFromInvRequest`,
`sendBankToInvRequest`, `sendBankSwapInvRequest`, `toggleBank`, `bankHasRequested` and the
`world.bank.items` path - all verified in the pool with live references. The bank's *capacity*
is a UI-slot literal (`iMaxBankSlots`) and a server-driven count (`iBankCount`), not a call, so
the free-space gate "Bank All" needs has no direct equivalent and is the part that stays unverified
until the surface exists.

The window shells, the list model, the persistence and the set file format are covered by
`npm test`; these boxes are the live half.

- [ ] **Bank** transfers the chosen category, honouring the AC/non-AC choice, and does not touch
      equipped items or Treasure Potion
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

## Options and Hotkeys (ticket #34) - needs the real game and a display

The toggle set, its order, the walkspeed field and the whole hotkey vocabulary are covered offline
by `npm test` against the reference's own Options menu (Root.cs) and its `Hotkeys.cs` - the
persisted index is the order, so the order is part of the behaviour. What a human has to check is
everything only the real game and a real keyboard can show.

Active plugin **Grimlite Parity**, restart, then **Grimlite -> Options** (or **Alt+Shift+O**) and
**Grimlite -> Hotkeys** (or **Alt+Shift+H**).

**First, and important.** The seven option calls and the three game-reaching hotkey actions are
names the reference's own loader SWF provides and the **stock game does not carry**. Verified by
exact token match against the decompressed game SWF at `/var/tmp/aq-origin/game.swf` and the
reference loader at `/var/tmp/grimlite-src/Loader/grimoire.swf`:

    name                  stock game   reference loader   port routes it to
    SetInfiniteRange          -            yes            world.actions.active[i].range, i = 0..5
    SetProvokeMonsters        -            yes            world.aggroAllMon
    SetEnemyMagnet            -            yes            myAvatar.pMC x/y -> target.pMC x/y
    SetLagKiller              -            yes            world.visible
    DestroyPlayers            -            yes            (none - see below)
    SetSkipCutscenes          -            yes            mcExtSWF children, world.visible, showInterface
    SetWalkSpeed              -            yes            world.WALKSPEED
    CancelTarget              -            yes            world.cancelTarget, twice
    LoadHairShop              -            yes            world.sendLoadHairShopRequest
    LoadArmorCustomizer       -            yes            openArmorCustomize

The game carries lowercase cousins (`walkSpeed`, `cancelTarget`, `loadHairShop`,
`openArmorCustomize`), which are different members with different signatures and which the
reference never calls - nothing here substitutes one for the other.

**A loader-only name is not a dead end, because the loader is a renaming layer.** Read from its own
decompiled bodies (`/var/tmp/aq48/out-loader/scripts/grimoire/game/Settings.as`, `Player.as`,
`Shops.as`), each of these names stands for reads, writes and calls on paths the stock game **does**
carry (`world`, `actions.active[].range`, `aggroAllMon`, `myAvatar.pMC`, `mcExtSWF`,
`showInterface`, `WALKSPEED`, `cancelTarget`, `sendLoadHairShopRequest`, `openArmorCustomize` -
all exact runs in the decompressed game). So the port asks the game for the reference's own name
first and, when the game answers `no member <name>`, does what that loader body does through the
generic callbacks. The day a bridge implements the loader's surface, the game's own answer wins and
these routes are simply not reached.

The one exception is **Hide Players**: the loader's `DestroyPlayers` walks every entry of
`world.avatars` and destroys the ones that are not the player's own. The generic callbacks read and
write paths named in advance and cannot enumerate that map, so there is nothing honest to send for
it and the window reports the full reason instead. Whether the four toggles that now route really
work in a live client is what the boxes below are for.

- [ ] The Options window opens titled **Options**, listing all seven toggles in the reference's
      order: Infinite Range, Provoke, Enemy Magnet, Lag Killer, Hide Players, Skip Cutscenes,
      Walkspeed - and **every one of them unticked on a first run**
- [ ] Ticking **Infinite Range** and attacking a monster far away hits it; unticking sends no undo
      call (the reference has none) and the loop stops re-sending it
- [ ] Ticking **Provoke** makes monsters attack the character, and re-sends it on every pass
- [ ] Ticking **Enemy Magnet** pulls the target onto the character, and does nothing at all (no
      error) when nothing is targeted
- [ ] **Lag Killer** hides the game movie itself when ticked (`world.visible` goes false) and
      shows it again when unticked - the one toggle with a real off call
- [ ] **Skip Cutscenes** clears a running cutscene and gives the interface back
- [ ] Ticking **Hide Players** removes other players from the room - **or** shows the stated
      reason that the loader-only call has no route through the generic callbacks. Both outcomes
      are correct here; a tick that silently did nothing is not
- [ ] When the game does refuse a routed call, the window's status line shows that refusal
      (`no member <name> ... - and the game's own route to it failed: ...`) rather than a tick
      that quietly did nothing
- [ ] **Walkspeed**: the field shows **20** before it is ever touched (the reference's own
      default), the tick disables the field, and turning the tick off restores the game's own 8
- [ ] Typing a number while the tick is off only remembers it; the number goes out the moment the
      tick is on and keeps going out every 250 ms while it stays on
- [ ] The number field clamps to the reference's own 1..99 box
- [ ] **Stop applying** stops the re-send loop with the ticks left as they were; **Start applying**
      re-sends everything that is on, straight away
- [ ] The ticks and the walkspeed number survive an app restart and are still there when the
      window is closed and reopened
- [ ] The Hotkeys window opens titled **Hotkeys** with an **empty** list, a key picker and an
      action picker
- [ ] The key picker offers exactly Escape, Left, Up, Right, Down, D0-D9, A-Z, F1-F12, Alt, Tab,
      Shift - single keys only, no combination
- [ ] The action picker offers the reference's own 23 in order, from *Start/Stop Bot* to
      *Start/Stop AutoAttack*
- [ ] Picking a key and an action and pressing **Add** puts a row reading `<Key>: <Action>` (e.g.
      `D1: Show Notepad`) in the list, and pressing that key opens the target
- [ ] **Remove** gives the key back: pressing it afterwards does nothing
- [ ] Rebinding the **same** key to another action replaces the row instead of adding a second
- [ ] Binding a key the app already holds (F2, Ctrl+J, F11, F9, Alt+9, Alt+H / F1, Ctrl+F5) is
      refused with the owner named, not taken silently
- [ ] Binding bare **Alt** or **Shift** is refused with the reason (a bare modifier cannot be
      registered on its own)
- [ ] A key bound to an action whose window has not shipped yet (Show Bank, Show Maid, Show Fast
      Travels, Start/Stop Bot, ...) is **inert**: nothing opens, nothing throws, and the window
      says that window has not shipped
- [ ] **Minimize to tray** fires while another app has focus; every other binding fires only while
      AquaGrim does
- [ ] The bindings survive an app restart, in the order the list was built

### Options and hotkeys: what could not be checked here, and why

Everything above needs the game running against the real origin, plus a keyboard and a display;
this session has no display and must not boot Electron, so **not one of these calls has been run
against a live client**. The routes are transcribed one-for-one from the reference loader's own
decompiled bodies, and the game paths they read are all present in the decompressed game SWF, but
whether each does the right thing on a live session - in particular whether `world.visible` is the
flag Lag Killer wants, whether `actions.active` is the skill bar the range is set on, and whether
`myAvatar.target.pMC` is writeable from outside the game - is exactly what a human has to confirm.

Two further things a human should note:

- **Hide Players has no route** (`DestroyPlayers` needs to enumerate `world.avatars`, which the
  generic callbacks cannot do), so it reports the reason. If the bridge implements the loader's
  helper surface later, that toggle starts working with no change to this window.
- **Minimize to tray** is implemented as raising the app's main window. Electron has no tray toggle
  here, so this is the port's nearest equivalent, not the reference's own behaviour.

---

## Verification log

| Date | Who | Notes |
|------|-----|--------|
| 2026-03-24 | maintainer | Partial manual run on Example Companion / menus / basic flows — looked OK; not every box above was exercised |

---

## Grimlite Parity - Loaders and grabbers (ticket #31) - needs the real game

**All four loaders work; the grabbers read the game's own objects.** The loaders ask the
reference's own name first and then the stock game's own request, so every target has a route
that exists. Each name below was checked against the decompressed game SWF
`/var/tmp/aq-origin/game.swf` with the two-condition test the merged bridge.js documents: an exact
ABC string-pool entry *and* at least one multiname referencing it, because a pool entry nothing
references is a literal rather than a callable member (a plain substring search wrongly "finds"
`BankSlots` inside `txtBankSlots`).

| Loader | The reference's own call | In the stock game | What answers instead |
|---|---|---|---|
| `Load` (shop) | `ResetShopInfo`, `LoadShop` | absent | `world.sendLoadShopRequest` (pool entry, 1 reference) |
| `Load` (hair shop) | `LoadHairShop` | absent | `world.sendLoadHairShopRequest` (1 reference) |
| `Load` (armour customizer) | `LoadArmorCustomizer` | absent | `world.openArmorCustomize` (1 reference) |
| `Load` (quest) | `LoadQuest`, `LoadQuests` | absent | `world.getQuest`, `world.getQuests` (1 reference each) |
| `F Accept` | `Accept`, `IsInProgress` | `Accept` is a pool entry with **zero** references, `IsInProgress` is absent | `world.acceptQuest`, `world.isQuestInProgress` (1 reference each) |
| `Ghost` accept | `%xt%zm%acceptQuest%1%<id>%` (Quest.GhostAccept) | n/a - a frame, not a call | `sfc.sendString` (1 reference) |

The grabbers read the game's own objects, all verified the same way: `world.getInventory`,
`world.invTree`, `world.bankinfo`, `world.tempitems`, `world.questTree`, `world.shopinfo`,
`world.cells`, `world.strFrame` and `world.getMonstersByCell`.

**Equip SWF** reaches the game too: the reference's `SetEquip` is absent from the game, but the
line the reference keeps commented out beside it is not - `world.myAvatar.loadMovieAtES` is a pool
entry with four live references, and it is the same route ticket #30's Cosmetics window verified.

**Blocked on the bridge growing the reference loader's surface:** `GetInventoryItems`,
`GetBankItems`, `GetTempItems`, `GetQuestTree`, `LoadShop`, `LoadHairShop`, `LoadArmorCustomizer`,
`ResetShopInfo`, `LoadQuest`, `LoadQuests`, `Complete`, `IsInProgress`, `SetEquip`, `BankSlots`,
`UsedBankSlots` and `BuyItemQtyById`. All are absent from the game's pool and all are present in
the reference's own `Loader/grimoire.swf` with live references. Until that surface exists, a call
only it could serve reports the name it is waiting for rather than a value; because the loaders
ask the reference's name first, they start working the day it lands, with no change here.

The bot lists are no longer a stub: ticket #36's Bot Manager landed, so the grabbers'
list actions append to its document with the reference's own Contains guard and reach a
saved `.gbot`. With no bot open they still report that nothing is holding a list.

Rows, menus, search, the XML export, the list wiring and the window shell are covered by `npm test`;
these boxes are the live half and none can be ticked without a running client and a display.

- [ ] **Loaders/grabbers** opens from the Grimlite menu and from its own key binding, at the reference's own size, with the combo open on **Quest**
- [ ] The count box and **F Accept** are enabled only while the target is **Quest**, which is what `cbLoad_SelectedIndexChanged` does
- [ ] **Load** on Shop / Hair shop / Armour customizer opens that window in the game, and the status line names the path that served it
- [ ] **Load** on Quest with a count of 3 loads 3 consecutive ids; a comma list loads exactly as written; a non-numeric box is refused out loud (the reference refuses it silently)
- [ ] **F Accept** loads the batch and accepts only the quests the game does not already have in progress, after the reference's 1000ms wait and with its per-accept pacing
- [ ] **Ghost** checked sends the raw frame, and the quest arrives without the client's own accept animation
- [ ] Each of the eight grabbers fills the tree from a live client: shop items, quest ids, quest items with drop rates, inventory, temp inventory, bank, monsters, all monsters
- [ ] **Temp inventory** and **Bank** fill from a real client (both flatten a slot-keyed object, so a live client is what confirms the shape)
- [ ] The order combo is enabled only for quest and monster grabs, and it changes the row text: `Name - Id` against `Id - Name`, monsters by name against by `MonMapID`
- [ ] **Search** selects the first match, then steps through the rest and wraps past the last
- [ ] **Save** writes a `.xml` through the reference's own dialog ("Save grabber data", "XML files|*.xml"), the file opens in another XML tool, and double-clicking the tree loads it back
- [ ] Right-click menus appear only on rows that carry one, with the reference's own entries and order, and each entry does what it says
- [ ] **Equip SWF** puts the item's movie on the slot its category maps to (Cape `ba`, Pet `pe`, Armor/Class `co`, Helm `he`, Misc `mi`, anything else `Weapon`)
- [ ] **Buy This Item** reports the loader name it is waiting for (`BuyItemQtyById`) rather than appearing to buy anything
- [ ] **Add buy command** puts a `CmdBuy` with the shop, item and quantity the row carries into the Bot Manager's Commands list
- [ ] **Accept Quest**, **Complete Quest (Once)** and **Complete Quest (Maxed)** reach the game, and the status line names which path served each
- [ ] **Copy Bypass Packet** puts the reference's own JSON on the clipboard, and pasting it into the packet tamperer updates the quest's progress
- [ ] **Go to Wikipage** and **Search on Wiki** open in the app's own browser window rather than the system browser, with the name's spaces turned into `+`
- [ ] The bot list actions (**Add to both**, **Add to whitelist**, **Add to unbank list** and the three "Add all" aggregates) append to the **Bot Manager**'s own Drops, Items and Quests lists with the reference's Contains guard, and the rows survive a Save to `.gbot`
- [ ] **Copy all** and **Copy all Reqs** put the reference's own two lines on the clipboard, the second with its extra comma

## Grimlite Parity - Fast travels and the map bypasser (ticket #32) - needs the real game and a display

`features/travel/` is the reference's Tools -> **Fast travels** form. Its destinations, groups,
labels, map/cell/pad triples, shop ids and quest ids are data (`travel-data.js`), the join-or-walk
decision, the private-room suffix, the quest-progress frames and the bypasser are logic
(`travel.js`), and the page, window, menu entry and key binding are checked by `npm test` -
including that the page draws every button exactly once, and that the awe shop button the
reference keeps inside its own box is drawn at all.

Every game call it makes is a loader name the bridge's surface answers (#48). No helper here is
waiting on a bridge that does not exist; what cannot be checked without a running client is
whether the game acts on each call.

- [ ] **Fast travels** opens from the Grimlite menu and with Alt+Shift+T, and **Show Fast Travels** in the Hotkeys window runs the same action
- [ ] Every button in **Fast travels** moves the character: a destination in the map you are standing in walks to its cell without re-joining, and one in another map joins it
- [ ] The tercess destinations walk to tercess's own entry cell (`m22`/`Left`) first when you are elsewhere, and do not when you are already in tercess
- [ ] **Private** checked numbers the room (the map joins as `<map>-<number>`); unchecked joins the bare map, and the box's range is the reference's own (100000 opens it, 1000000 is the maximum)
- [ ] **Binky (doomvault)** fakes quest 20's progress before it joins - without it the room refuses entry
- [ ] **Awe Shop (museum)** opens the shop of the ticked enchantment type: Lucky 639, Thief 637, Hybrid 633, Healer 638, Fighter 635, Wizard 636
- [ ] **Ultraboss & Daily** asks the game for the reference's own sixteen quest ids
- [ ] **Bypass All** blanks the storyline fields the client has sent and says the reference's own message; a relog restores the original progression, which is what the message promises
- [ ] **DoomvaultB** fakes quest 20, sends the achievement frame to the **server**, fakes quest 27 and then enters the room - the one button whose frame is written to the server rather than handed to the client
- [ ] The four **Fast travels 2** buttons (Treetitanbattle, Ultradrakath, Tower of Doom 10, Necrodungeon) fake their quest's progress, wait, and then enter their room
- [ ] **Unlock** with a quest id the client does not hold loads it and waits for it; with one the game never sends it reports the id and injects nothing
- [ ] The generated packet is shown read-only, **Copy** puts the same text on the clipboard, and **Send** hands it to the client as a JSON frame
