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
      loads Loader4 on the loopback origin, which initializes and displays the current game SWF)
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
- [ ] **A newer game SWF still works:** with no code change, Loader4 boots on whatever file
      `api/data/gameversion` currently names
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

---

## Bot engine runtime and lifecycle (ticket #37) - needs a display, a real game and an account

Everything in this section is about a bot *running*. The loop, its ordering, the variables, the
refusals and the per-window registry are covered by `npm test` against injected fakes; nothing
below can be, because each box needs a live client to answer.

### A bot runs end to end

- [ ] Open a `.gbot`, tick **Enable Bot** (Bot Manager -> Info tab), and the character starts
      following the list: the first command's effect appears in the game within a couple of seconds
- [ ] The window's log shows the command being run, and **un-ticking** Enable Bot stops it at once
- [ ] A bot whose last command is **Stop bot** ends by itself and un-ticks
- [ ] A label + **Goto label** pair loops, and **Restart bot** starts the list over
- [ ] **Index Up / Down / Goto** land where the reference lands: Goto n resumes at command *n + 1*
      (the reference's own arithmetic), and a Goto past the end wraps to the top
- [ ] A statement that does not hold skips exactly the one command under it, and the command under
      it runs when the statement holds
- [ ] **Set Bot Delay** paces the commands after it, and a **Blank** does not wait the delay

### Variables and ints

- [ ] **Set variable** / **Update variable** substitute into a later command's field as `[name]`
- [ ] `{PLAYERNAME}` in a command's text becomes the character's own name
- [ ] An arithmetic value (`5*2+1`) is evaluated; a plain string is passed through untouched
- [ ] A reference to a variable that was never set is left as written and the log says
      `[Var Error] Key for [x] not found/Undefined`
- [ ] **Int 1..n** counts up and down, and **Int is / is not / equals** compare as they do upstream

### Lifecycle: reload, death, disconnect

- [ ] Walking through a map door pauses the bot and it resumes where it was once the map is up -
      the index does not move on while the map loads
- [ ] Dying with **Restart upon death** ticked restarts the list; unticked, the bot re-runs the
      command it died on
- [ ] The character respawns before the bot carries on (the reference waits for its own respawn
      point, up to ten one-second polls)
- [ ] Pulling the network out with **Auto Relogin** off stops the bot, and the log says
      `disconnected. Last cmd: [n]...`
- [ ] With **Auto Relogin** on, the character logs back in and the bot restarts from the top. This
      build has no relogin wired in yet (#35 pending), so today it logs
      `auto-relogin is on but no relogin is wired in yet (#35); stopping` and stops - that message
      is the expected result until #35 lands

### Windows

- [ ] Minimising the game window does not pause a running bot (the app already disables background
      throttling for game windows)
- [ ] Closing the game window stops that window's bot rather than leaving it polling
- [ ] Two game windows each run a bot, and each window's own Enable Bot tick and state belong to
      that window

### What could not be checked here, and why

The engine consumes an injected session (spec #19, Seam 4). Eight of its ten wants are asked for by
the reference loader's **own helper name** through the surface ticket #48 built
(`loader-surface.js`), which holds one row per name reaching the path that name's decompiled body
reads: `IsLoggedIn`, `Health`, `HealthMax`, `Mana`, `ManaMax`, `SetSpawnPoint`, `Rest`,
`CancelTarget`. Reading `grimoire/game/Player.as` and `World.as` beside that table is the check
that the session and the table agree.

The two the surface does **not** answer, and what this ticket does instead:

- **`MapLoadComplete`** - the loader's body reads `world.mapLoadInProgress` *and then* inspects its
  own display list ("the top child is not the connection movie"). The surface refuses it because
  ticket #41 owns that state, so the session's `ready()` reads the game's own
  `world.mapLoadInProgress` - the half a reload trips, and the half the loop's pause keys off. The
  display-list half is **not checked**, so a map that is loaded but still showing the connection
  movie would read as ready here.
- **`GetUsername`** - the reference loader holds the login it captured from its own login form
  (`Root.as`), which ticket #35 owns; it does not read the name out of the game. The session reads
  `world.myAvatar.objData.strUsername` instead, the field `Player.as` line 455 itself assigns, so
  `{PLAYERNAME}` still resolves to the character's name.

That is all a static check, not a live read: **no path and no helper has been exercised against a
real client**, so the first run is the milestone rather than a formality.

Two known limits to look for on that first run:

- **The bridge channel addresses one game window at a time.** `res/platform/bridge-channel.js`
  resolves its target as the most recently created window this plugin says is its game, so two game
  windows are currently read as one. The bot engine itself is per-window and tested as such
  (`test/unit/grimlite-bot-runtime.test.js`); when the channel can be scoped, only the caller of
  `createRuntimeManager` changes in `plugins/grimlite-parity/main.js`. The two-window box above
  cannot pass until then, and it is a bridge-channel property rather than a bot-engine one.
- **Auto-relogin is not wired** (#35). The bot honours the setting by naming the gap and stopping,
  rather than silently ignoring a tick the user set.

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
## Grimlite Parity - the aura, target and combat statements (ticket #42) - needs a display, a real game and an account

The aura statements read a cache the **packet tap** fills (`bot/auras.js`), not a game lookup: the
reference's `CmdPlayerAura*` read `AuraManager.SelfAura`, which its own packet handlers fill, and a
`GetAurasValue` call answers a frame stale. The remaining statements read three loader names the
surface answers (#48): `HasTarget`, `GetTargetHealth` and `State`; `Player.CurrentTargetId`, which
the loader registers no name for, is a read of the session's own.

The derivations, comparisons and expiry are covered by `npm test` against frames and fakes. What
needs a live client is whether the game's real frames have the shape these tests assume.

- [ ] Apply an aura in game (a potion, a class skill, or another player's buff) and a bot with **Player aura value equals** on its name lets the command under it run; drop the aura and it skips it
- [ ] **Target aura value equals/greater/less** answers for the monster you have targeted, and does not answer with your own stacks of the same name
- [ ] **Monster (ID) Aura duration is less than** holds at the boundary it reads (the reference skips only on `> x`), and skips when that monster has no aura by that name at all
- [ ] Gaining and losing an aura is seen within a tick: an aura applied and one that expires both change what the statement answers
- [ ] **Is has target** / **Is not has target** follow the target you set and clear in game
- [ ] **Target health greater/less than** hold at their own bound, and **between** needs a comma and holds strictly inside it
- [ ] The **Default** box decides **Target health** statements while nothing is targeted: `false` skips, anything else holds, and no health is read either way
- [ ] **Is in combat** answers yes only while the game shows you fighting (**Not in combat** is yes while dead and while idle)
- [ ] **Name equals** matches your character's name whatever the casing
- [ ] **Special Anims** (no skill box) holds on a comma-separated term of the last animation message the server sent, and **Special Anims** with a skill box reports the cast it cannot make rather than casting
- [ ] Walking through a map change drops the monster aura state (their ids belong to the map you left) and **clearAuras** takes your auras except the Fate/Sage/Body/Might/Elixir family, while a respawn takes all of them

## Combat and map commands (ticket #38) - needs a display, a real game and an account

Everything below is about a bot **fighting and moving**. The command bodies, the loader reads they
need, the waits and their timeouts are covered by `npm test` against injected fakes, with each
expectation named to the reference file it came from (`Grimoire/Botting/Commands/Combat/*.cs`,
`Map/*.cs`, and the reference loader's own `grimoire/game/Player.as` and `World.as`). None of the
boxes can be ticked without a live client, and two of them are the whole point of the section.

### Targeting by name and by monster id

- [ ] **Kill Gravelyn** targets her and the character fights: the target's health bar appears
- [ ] **Kill id:17** (or `id-17`, `id.17`, `id'17`) targets the monster whose `MonMapID` is 17,
      which is the branch `Player.cs AttackMonster` sends to `AttackMonsterByMonMapId`
- [ ] **Kill \*** fights whatever is in the cell, and does **not** re-target while a target is up
- [ ] A name no monster in the cell carries is reported in the log and the bot carries on with the
      next command rather than standing there

### Skills

- [ ] **Use Skill \*** with an index casts that skill at the current target, and leaves the
      character walking into range first unless the class is a Chrono Shadow
- [ ] **Use Skill [Wait]** waits out the cooldown the game reports and then casts
- [ ] **Use Skill [Force]** casts with nothing targeted
- [ ] A **Skill Set** command changes which skill the attack rotation starts from, which is the
      label row `[NAME]` in the Skills list (Bot.cs's `SkillSet`)
- [ ] A skill row the game refuses (a locked or unavailable skill) does not stop the fight
- [ ] A skill row whose **aura condition** is unmet is not cast, and the rotation moves past it;
      land the aura (a class skill or a potion) and the same row casts. An aura condition on a name
      containing "locked" is reported once and the row held back, which is the reference's own
      `GetAurasValue` path rather than the tapped cache (ticket #50)

### The fight and its exits

- [ ] **Attack \*** with **Use Skill** ticked attacks and then runs the skill set, not one or the other
- [ ] **Stop Attack** drops the target, and **Leave Combat** also jumps on the spot to break combat
- [ ] **Rest** sits the character down, and **Rest fully** waits until both bars are full
- [ ] **Rest** with **Exit Combat Before Rest** on jumps on the spot while the character is in combat
- [ ] **AntiCounter** reports that it is not applied (see below) rather than appearing to pause

### Map and movement

- [ ] **Join: necrodungeon-a, r22, Down** reaches that map and cell, and a non-numeric room
      (`-a`) is rolled into a number the way the reference rolls one
- [ ] A join whose map never matches ends with `could not reach <map> in N try(ies)` in the log
- [ ] **Join** with a `.swf` in the SWF box loads that map file (`World.LoadMap`) and waits for it
- [ ] **Move to cell** keeps jumping until the cell reads back, and sends nothing when already there
- [ ] **Start Jump between** moves the character on while the list carries on, and **Stop Cell Jump**
      cancels it
- [ ] **Set Spawnpoint** makes the character respawn where it stands (die and watch where you return)
- [ ] **Join: ...** (CmdTravel) joins when the map differs and only steps to the cell when it does not
- [ ] **Walk to: 250, 400** walks there; **Walk Randomly** picks its own point
- [ ] **Join yulgar** ends with the bot stopped, as the reference's own command does
- [ ] **Hunt** and **Quest Hunt** join their map and fight in it; **Follow kills: <name>** walks to
      the player with `GoTo` and fights what is there

### A saved bot runs unedited

- [ ] Open the reference's own `Resources/Bots/kill_with_monster_id.gbot` in the Bot Manager and
      run it: it joins `necrodungeon`, rolls a room, steps to `r22`, and fights by `KillPriority`
      `id-49,id-50`

### What could not be checked here, and why

**The two calls that point the avatar are made by the bridge movie, not from the page** (ticket
#49). The reference loader's own bodies are `world.setTarget(World.GetMonsterByName(name))` plus
`world.approachTarget()`, and `world.testAction(world.actions.active[i])`. Both game functions are
typed on **live AS3 objects** (`World.as` 8372 `setTarget(param1:*)`, 8705
`testAction(param1:Object,...)`), and every way into them returns one: `getMonster(id)` (8075),
`getMonstersByCell(cell)` (8128) and `getActionByRef(ref)` (9659) are all typed on live `Avatar`s
and action objects. **That is a limit on what can cross ExternalInterface, not on what the bridge can
do**: the game is loaded into the bridge movie's *own* `ApplicationDomain`
(`bridge/AquaBridge.as`), so a monster or action object resolved inside the movie is the game's own
object and can be handed to a game method there - the same in-domain arrangement the reference's
loader uses, and the mechanism the bridge's `sendClientPacket` already relies on.
So the movie registers `AttackMonster`, `AttackMonsterByMonMapId`, `UseSkill`, `ForceUseSkill`,
`CancelTargetSelf` and `SetTargetPvP`, each taking the primitive the reference's own signature takes
and doing the object plumbing itself; the loader surface rows call them by name, so no feature
changed. **The live cast itself is still unverified** - see the row below.

**What does work** is everything the fight is *decided* on. The monster reads are answered by
walking the game's own `Vector.<Avatar>` by index and reading primitive leaves off each entry - the
same eight-field projection `World.as GetMonstersInCell` performs, done a step earlier because here
the reshape has to happen on the far side of the wire - and `pMC` is probed with the bridge's own
`isNull` rather than carried: `IsMonsterAvailable`, `IsMonsterAvailableByMonMapID`,
`GetMonsterHealth`, `GetMonstersInCell` and `GetVisibleMonstersInCell` all answer, as do
`HasTarget`, `GetTargetHealth`, `SkillAvailable`, `AllSkillsAvailable`, `State`, `Cell`, `Pad`,
`Map`, `Position`, `Jump`, `Join`, `Rest`, `SetSpawnPoint`, `CancelTarget` and `CancelAutoAttack`.
So a bot's targeting **decisions** are live and correct; only the two calls that act on them are not,
and **a kill in this build therefore needs the character to be attacking already** (auto-attack on,
or the player's own click) - a fake success here would have been worse than the refusal.

- [ ] Confirm the refusal text reached the log rather than a silent no-op, and confirm the
      character was **not** moved by it
- [ ] With auto-attack on, run a `CmdKill` bot and confirm the rotation casts on cooldown and the
      `SkillDelay`/`WaitForSkill` settings pace it as they do in the reference

**Two more places this build reports rather than acts**, each because the option reaches something
the engine does not have yet, and none of them silently ignored:

- **AntiCounter** watches the reference's own packet tap for `prepares a counter attack` and the
  Counter Attack aura fading. This engine has no tap, so the log says so once and the fight runs
  without the pause.
- **CmdKillFor / CmdShortHunt / CmdQuestHunt** are wired for their map, join and kill halves, but
  their "until the item or quest is done" loops read the inventory (`GetInventoryItems`,
  `GetTempItems` - both answered) and, for a quest, the quest's own required items
  (`GetQuestTree` is refused: ticket #39). The loop is bounded and reports what it stopped short of
  rather than running all night, which matters more here than upstream because a kill this build
  cannot start is not a kill that can finish the loop.
- **CmdFollow** cannot follow a player's cell as they walk: that reads the `uotls` packet off the
  reference's own tap. It walks with `GoTo` and fights what is there, and says so once.

## Grimlite Parity - the Maid (ticket #43) - needs the real game, a display and an account

`features/maid/` is the reference's own party assistant. Its configuration file is checked by `npm test`
against the reference's own `Resources/Plugins/Maid/Default.json` (the 23 keys of `MaidConfig.cs`, in
its own order, and its overlay rule: a non-empty string wins, a present number wins, a boolean is
`?? current`), its scheduler against fakes (the loop's own order, the goto frame's exact text, the
safe-skill threshold, the priority list, `WaitSkill`'s gating, the death respawn, the five failed
gotos, and the engine-collision rule), its party vocabulary against `PartyChatHandler`'s seven
commands and `PartyInvitationHandler`'s one frame, and its window, menu entry, keybinding and two
keys against the app's own conventions. What no test can reach is whether the game acts on each
call, so that is what this section is for.

### The window and the file

- [ ] **Maid Remake** opens from the Grimlite menu, with Alt+Shift+R, and from **Show Maid** in the Hotkeys window
- [ ] The window opens on the reference's own shipped default: target `username`, skill list `1,2,3,4`, the two map lines, the attack-priority pair, and the six boxes the template omits left at their own defaults
- [ ] **Save** writes a 23-key JSON file with a `Maid config` filter, and **Load** reads one back; an **empty** string in the file ("SkillList": "") leaves the box as it was, a `false` really unticks it, and a missing key changes nothing
- [ ] The file lands in the app's data directory under `Config/`, beside the plugin's own store
- [ ] `Config/autoload.json` is applied when the plugin activates, and **Autoload** applies it again on demand; a file that is not JSON reports the parse error and changes nothing

### The keys and the state

- [ ] **Unfollow** toggles with Alt+Shift+U while the app has focus, and **StopAttack** with Alt+Shift+X; both boxes in the window move with them
- [ ] Untick **Global Hotkey** and neither key fires from another window; tick it and both do, whichever window has focus
- [ ] A key that is already taken by the app or another plugin is reported as unbound rather than silently swallowed
- [ ] The line above the form says `unfollowed` when Unfollow is ticked, `stop attack is on` when StopAttack is, `paused: the map is reloading` while a map loads, `following` and `fighting` while the loop moves, and `off` when Enable is unticked
- [ ] The line follows a key pressed in **another** window while the Maid's own window is open
- [ ] **Enable** starts the loop, unticking it stops it, and `.stop` / `.start` in party chat do the same from the game

### Following and fighting

- [ ] With the target in another map the character joins it and the log shows the reference's own frame `%xt%zm%cmd%1%goto%<name>%`; with the target in the map but another cell the character walks to that cell and pad without re-joining
- [ ] A target who is in the same map but whose cell and pad are unreadable is walked to with the loader's own `GoTo` rather than a frame
- [ ] **Stop goto after 5 failures** ticked stops the Maid after five failed gotos and says so; unticked it keeps trying
- [ ] **Use** with `if health<` fires the heal list below that percentage and the skill list otherwise; an empty heal list never heals whatever the box says
- [ ] **Buff If StopAttack** fires the buff list once per pass while StopAttack is on, and cancelling the attack and target happens the moment StopAttack is ticked
- [ ] **AttackPriority** walks its list in order (`id.N` goes to the by-id helper, and a target already held is not re-attacked), then the wildcard `*`
- [ ] **Wait** holds each skill until `SkillAvailable` says it is ready
- [ ] Dying sends the character to its spawn point and the loop picks up again
- [ ] **Skill Preset** fills the skill list, the heal list, its percentage, the buff list and the two boxes; **AI** and **AM** leave the heal list and its percentage alone, and the SafeSkill box follows the preset's own carried flag

### Per-boss handlers, Auto Zone and taunt cycles (ticket #44)

#### Run this branch without packaging

1. Close any running AquaStar window first. AquaStar has a single-instance lock, so an older
   installed copy could otherwise take focus instead of loading this checkout.
2. In a terminal run:

   ```sh
   cd /home/ammar/.codex/worktrees/integration-parity/aqugrim
   npm start -- --no-sandbox
   ```

   This runs Electron from the `codex/grimlite-parity` source checkout; it does not create an
   installer or run a build. The CLI flag is needed for this Linux source run because the npm
   Electron sandbox helper is not installed root-owned/setuid. It disables Chromium's sandbox for
   this test launch, so use it only for local validation. In **Settings → Plugins**, verify
   **Grimlite Parity** is selected as the active plugin; if not, select it, Save, and Restart. Sign
   in to AQW, open **Maid Remake** with **Alt+Shift+R** and **Bot Manager** with **Alt+Shift+M**,
   and keep the terminal open.

#### Start a Misc 2 handler

1. Copy [`docs/fixtures/maid-auto-zone-smoke.gbot`](fixtures/maid-auto-zone-smoke.gbot) somewhere
   writable. In the copy, replace both `Zone` values with the exact handler name you are testing
   (the default is **Auto Zone - Ultradage**). Leave `Mode: 0` and `Mode: 1` as they are.
2. In **Bot Manager → Load bot**, open that copy and tick **Enable Bot**. It starts the selected
   **Misc 2 → Special handlers** entry, waits three minutes, then stops it and the bot.
3. Repeat for each entry you can reach, in its matching live encounter. If you need to stop early,
   copy [`docs/fixtures/maid-handler-stop.gbot`](fixtures/maid-handler-stop.gbot), set its single
   `Zone` value to the active handler name, load it, and tick **Enable Bot**. Mark inaccessible
   encounters **NOT AVAILABLE** rather than travelling or spending anything you do not want to.

#### Test the taunt-cycle paths

1. In Bot Manager, load [`docs/fixtures/maid-bot-pause-probe.gbot`](fixtures/maid-bot-pause-probe.gbot)
   and tick **Enable Bot**. Its only action is a “Bot pause probe” log line every second. In an
   Ultra Speaker encounter, run the matching Speaker handler from **Misc 2**; check that the log
   pauses during a skill-5 taunt and resumes after it. Untick **Enable Bot** when done.
2. In Ultra Gramiel, load [`docs/fixtures/maid-tauntcycle-smoke.gbot`](fixtures/maid-tauntcycle-smoke.gbot)
   while **Gramiel** is present and set as the current target. Note the current target, tick
   **Enable Bot**, then check that skill 5 runs and the prior target is restored. The fixture stops
   its taunt cycle and bot after one minute.
3. For Maid's separate `tc;` path, untick Maid **Enable**, turn on **Special animation actions**,
   set **SpecialMsg** to `tc;2;Gramiel;12` and **SpecialAct** to `5`, then enable Maid in the Ultra
   Gramiel encounter. Confirm the Maid cycle uses skill 5 and yields while the bot has a command in
   flight. Restore your previous Maid settings afterward if you want to keep them.

#### Check the behavior

- [ ] **UltraBossExtra** selects each reference mode; changing a boss mode fills its SpecialMsg,
      SpecialAct and AttackPriority fields, and Save/Load preserves the choices
- [ ] **Auto Potion** uses the first equipped, stocked potion and waits for that potion's aura to
      expire before forcing skill 5. Skip if you do not want to consume a potion.
- [ ] On Ultra Gramiel, Maid balances the two Grace Crystals at the reference's 150 HP and 50 HP
      gates, and its forced-skill pass returns to the priority target. Test with both crystals
      alive: when one reaches 150 HP while the other is above 150 it switches sides; repeat at 50
      HP while the other is above 50.
- [ ] In Bot Manager → **Misc 2 → Special handlers**, test each entry one at a time using the
      three-minute fixture above. Check that its matching game event triggers the action. Mark an
      encounter **NOT AVAILABLE** if you cannot reach it:
      **Auto Zone - Ultradage**, **Auto Zone - Dark Carnax**, **Auto Zone - Astral Empyrean**,
      **Auto Zone - Astral Empyrean P1**, **Auto Zone - Astral Empyrean P2**,
      **Auto Zone - Queen Iona**, **Auto Zone - Colossal Vordred**, **Gramiel P1**, **Gramiel P2**,
      **Gramiel P3**, **Gramiel P4**, **Ultra Speaker DPS**, **Ultra Speaker LR**,
      **Ultra Speaker LOO**, **Ultra Speaker AP**.
- [ ] For Gramiel P1–P4, `defense shattering` acts on the selected crystal and that preset's odd/even
      turn. For Speaker DPS/LR/LOO/AP, the role follows `truth`/`listen`, moves to its assigned
      position, and heals below 70% only when that role has a heal.
- [ ] With the harmless pause-probe fixture running, a Speaker skill-5 taunt pauses its log during
      the cast and lets it resume afterward; a death/respawn returns the role to its start position.
- [ ] Maid `SpecialMsg` beginning `tc;` cycles with the configured **SpecialAct** and yields when
      the bot has a command in flight
- [ ] Bot Manager **Tauntcycle** uses skill 5, pauses/resumes only that window's bot, restores its
      previous target, and stops without stopping Maid's separate `tc;` cycle

#### What to send back

Reply with the status for these checks: mode/config and Auto Potion; each of the 15 Misc 2 names;
Gramiel crystal switching; Speaker pause/position/respawn; Maid `tc;`; and bot Tauntcycle target
restore. Use `PASS`, `FAIL`, or `NOT AVAILABLE` for each. For a failure, give the selected
handler/role, map, and expected versus actual result. Attach a screenshot only for a visual or
movement problem. If the terminal reports an error, include about 30 nearby lines. Do not send full
logs, account details, or edit/commit the checklist.

The Speaker and Gramiel reference loops run at their own intervals; this port services their
health, position and taunt work from the existing Maid scheduler instead of starting another
timer. Packet-driven animation reactions still run directly from each server frame.

### Beside the bot engine

- [ ] With a bot running in the Bot Manager, the Maid does not cast while the engine has a command in flight; the log says so once per command and the window's state line reads `the bot engine has the current command`
- [ ] Between the engine's commands the Maid works again, and starting a second bot does not stop it doing so

### Party chat

- [ ] `/p .join <map>` and `%xt%zm%cmd%1%goto%`-style party commands reach a Maid whose window has never been opened, while it is running
- [ ] `/p .tp tercessuinotlim-6666` first steps to `m22` / `Left`, and `.tp <map>` joins with `Enter` / `Spawn`
- [ ] `/p .acc 1,2` loads both quests and accepts them a second apart; `.turnin 1,2` completes them the same way
- [ ] `/p .target <name>` changes the master, `.stop` and `.start` switch the Maid
- [ ] A party invitation is accepted with `%xt%zm%gp%1%pa%<pid>%`, and with no live connection the log says the invitation went unanswered rather than pretending
- [ ] Ordinary party chat (no leading `.`) is ignored, and so is room chat

### What could not be checked here, and why

- **A cast actually landing**: the call is made now (ticket #49 - the bridge movie resolves the
  live action object in its own domain and hands it to `world.testAction`), so `UseSkill`,
  `ForceUseSkill`, `AttackMonster` and `AttackMonsterByMonMapId` all reach the game. What no
  offline test can show is that the game **accepts** the target and fires the skill - that needs a
  logged-in character, so it is the box above rather than a claim here. What *is* verifiable
  offline, and is tested, is that each callback takes the primitive the reference's own signature
  takes and that the surface asks for it by the reference's own name.
- **Boss calls landing in the live game**: the per-boss and auto-zone handlers are implemented,
  but only a logged-in character can confirm the game accepts each target and cast; use the checks
  above.

## Grimlite Parity - the miscellaneous commands (ticket #40) - needs a real game and an account

The commands the reference declares under `Grimoire/Botting/Commands/Misc/`: the ones with no game
dependency (beep, ping, blank, delay, load-bot, log, the spammer's own controls) and the ones that
steer the client (change name/guild, goto player, logout, packet helpers, provoke).

Their bodies, argument shapes, defaults, path resolution and refusals are covered by `npm test`
against fakes, and every game call they make is a loader name the bridge's surface answers (#48) -
the two that are not (`SetFPS`, and `AttackMonster` behind the taunt rotation) report the reason
instead of pretending. What needs a live client is whether the game acts on each call, and what the
two shell seams do when a user is watching: Electron's alert sound and the relay's write path.

- [ ] **Beep** and **Ping** make the system alert sound N times (10 by default), and **Ping** with *Pop msg* also logs the message
- [ ] **Send client message** pushes one line into the game's own chat, warning-coloured with *IsWarning*, and a colour in *HexColor* wraps the text in that font tag
- [ ] **Log** writes to the Bot Manager's log pane, **Log debug** to the debug pane, and a line containing `{CLEAR}` empties that pane and then appends itself
- [ ] The **Log** substitutions read the running game: `{MAP}`, `{ROOM_ID}`, `{ROOM_NUM}`, `{GOLD}`, `{LEVEL}`, `{CELL}`, `{PAD}`, `{HEALTH}`, `{MANA}`, `{TIME}`, `{ITEM: name}`, `{REP CURRENT: faction}` and `{INT VALUE: n}`; a name the game does not have reads as zeros rather than blanking the line
- [ ] **Mod message** on the same command pushes the coloured line into chat (one colour per backslash segment, FFFFFF where none is given)
- [ ] **Change name** and **Change guild** repaint the name plate, the portrait and the avatar's own objData, upper-cased, as the loader does; with no guild the command writes nothing
- [ ] **Goto player** reads the room's list *before* the goto, waits 500 ms when the player is already there, and otherwise polls until they walk in
- [ ] **Logout** signs the character out and the bot keeps running
- [ ] **Packet** sends *SpamTimes* frames *Delay* apart (1000 ms each by default) to the server or, with *ForClient*, to the client; a client-side `Level n` becomes the levelUp frame the client's chat handler expects
- [ ] **Packet delay** waits first and sends once, and with no *Delay* set it sends straight away (the class carries no default, unlike **Packet**)
- [ ] `{ROOM_ID}`, `{ROOM_NUMBER}`, `{GETMAP}` and `PLAYERNAME` are substituted, a run of dashes collapses to one, and an `1e<digits>` stamp becomes a random five-digit number
- [ ] A frame the relay will not take is reported ("the frame was not written"), not counted as sent
- [ ] **Packet spammer** adds, removes, clears, starts, stops, restarts and re-delays the Packet spammer window's own list; *GoPressTheGodDamnCorrectButton* does nothing, as it does upstream
- [ ] **Background packet** with *ADD* starts a frame going out on the command's own Delay (500 ms by default) and keeps going while the label is held and *Packet* is not empty; *STOP* with the same label takes it back; **Stop bot** ends it as well
- [ ] **Provoke** and **Toggle provoke** move the Options window's Provoke tick, and a refusal from the game reaches the bot's log
- [ ] **Load bot** with the path a bot file carries resolves the way the reference resolves it, so a bot saved on Windows (`Bots/Arcana/x.gbot`) opens here too; *PassDropList* (on by default) unions the old drops in, ignoring case, and *PassSkillPreset* (off by default) keeps the running skill set
- [ ] A path that is not there, a file that will not parse and a build with no reader each say which of the three it was
- [ ] **Return** goes back to the configuration and index the last **Load bot** pushed, and with nothing pushed it does nothing rather than failing
- [ ] **Set FPS** reports that the frame rate belongs to the reference's own stage, which this bridge cannot reach
- [ ] **Special handler** with a zone starts, stops or switches the matching auto-zone handler; with no zone it returns silently
- [ ] **Tauntcycle** pauses the selected bot engine, attacks the requested target, uses skill 5 when ready, then restores the prior target and pause state
- [ ] **Bank item list** does nothing at all, which is what its own `Execute` is
---

---

## Item and quest commands (ticket #39) - needs a display, a real game and an account

Everything in this section is about the *effect* of an item or quest command on a live server. The
commands' own ordering, their refusals, the arithmetic behind a maximum buy and a maximum turn-in,
and the tables they read the game through are all covered by `npm test`; what cannot be is whether
the game acts on what they send, because that needs a character and a shop that exists.

Every read and write here goes through the reference loader's own helper names
(`bot/items.js`'s `LOADER_BODIES`, asserted against `loader-surface.js` by test) or through the
four wants no loader name answers (`GAME_READS`, each recording the game source that proves the
path). Reading `grimoire/game/{Shops,Quests,Bank,Inventory}.as` beside those two tables is the
static check that they agree.

### Buying and loading a shop

- [ ] **Load Shop** (CmdLoad) with a shop id opens that shop in the game, and the log does not
      name a refused helper
- [ ] **Buy item** with a name buys that many: the bag gains the item, and a negative quantity
      buys as many as the stack and the character's currency allow
- [ ] **Buy item** with **ByID** buys the row with that item id *and* shop item id pair; a shop
      that has no such row logs `[MaxBuy] Buy skipped due to max/requirement not meet`
- [ ] **Buy item fast** (CmdBuyFast) buys without opening the shop first
- [ ] **Load travel shop** (CmdLoadTravel) opens a shop without moving the character out of
      combat first, which is the one difference from **Load Shop**
- [ ] Buying from a shop that takes merge materials, or from one that costs ACs, resolves its
      maximum against the right currency (gold against AC) - the audit trail of the buy is the
      character's own balance afterwards

### Selling and equipping

- [ ] **Sell** with a quantity sells that many; `0` sells the whole stack and a negative leaves
      that many behind
- [ ] **Equip** with an item's name wears it; with a forge enhancement's name (**Valiance**,
      **Praxis**, ...) it wears the item carrying that enhancement
- [ ] **Equip** with **Safe** ticked waits out combat before it wears the item
- [ ] **Equip** with a consumable's name (category **Item**) uses it through `EquipPotion` rather
      than wearing it as gear
- [ ] **Equip set** reports that this build reads a set from the Sets dialog rather than from
      beside the executable, and wears nothing - that message is the expected result

### Banking, drops and map items

- [ ] **Bank transfer** with an item in the bag banks it, and with **from bank** ticked takes it
      back out; a name on neither side logs `[Bank] <name> not found within your Bank/Inventory`
- [ ] **Bank swap** swaps only when the bag and the bank both hold their half of the pair
- [ ] **Get drop** takes the named drop and sends the frame the reference sends; its room comes
      from the loader's own `RoomId`, which a live client is what confirms
- [ ] **Get map item** with an id takes that item off the map and waits the reference's 1500 ms
- [ ] **Whitelist** On/Off/Toggle flips the pickup flag, and Add/Remove edit the drop list

### Quests

- [ ] **Accept quest** loads an unloaded quest, accepts it, and does not send the accept when the
      game already reports it in progress
- [ ] **Accept quest** with **ghost** checked sends the raw frame and the quest arrives without
      the client's own accept animation
- [ ] A one-shot quest whose counter is already satisfied is skipped and the log names it
- [ ] **Complete quest** once turns the quest in once; `-1` turns in as many as the counters allow
- [ ] A turn-in with **ReAccept** ghost-accepts the quest again after it leaves both states
- [ ] **Exit combat before quest** (Options) refreshes the cell and waits for the game's own
      state to leave combat before the turn-in goes out
- [ ] **Add quest list** / **Remove quest list** edit the Bot Manager's Quests list, and the rows
      survive a Save to `.gbot`

### What could not be checked here, and why

- **CmdBuyBack** is a stub that logs the reason. The reference drives its buy-back over
  account.aq.com's own HTML pages in a Windows-only namespace, which spec #19 puts out of scope as
  unreachable upstream, and the reference's own 60-file bot corpus references the command zero
  times. It has a handler so a file carrying one still opens, saves and runs.
- **SetEquip** stays refused on the surface. The reference writes one slot of `objData.eqp` - a
  live object graph a dot-path write cannot carry - and then swaps the movie clip. An item is worn
  through `world.sendEquipItemRequest` instead, which is the loader's own `Equip` row and what
  every equipping command here uses.
- **The exit-combat loop is bounded** at five one-second refreshes where the reference's is
  unbounded, so a window that went away mid-command reports what it saw rather than spinning the
  app. The message names the bound.
- **No helper and no path above has been exercised against a live client.** The first run on a
  real character is the milestone; the tables and their tests are what make a wrong path a
  reviewable claim rather than a guess.

## In-game chrome strip (ticket #45) - needs a display, a real game and an account

The reference draws a 27 px toolbar above its Flash panel (`splitContainer1`, `Root.cs:620`) with
six controls on it. This port draws the same strip as HTML above the surface, inside the wrapper
page the game SWF already loads through (`res/swf_wrapper.html`): a layout change, not a second
window and not a second compositing layer over a `wmode=direct` surface.

What `npm test` covers: the strip's height and the fact that the surface keeps the game's own size
with it up or down, the arithmetic of the toggle in both directions (including a window the user
resized while the strip was up, and a toggle that cannot be honoured on a page that has no strip
element), the capture region a screenshot uses, the six controls and their order, the three
refusals being the engine's own strings, the read-then-call sequence against a fake session, and
that every name the strip reads is one the loader surface answers.

What needs a real client: everything below.

### The strip and the surface

- [ ] The strip is above the game, 27 px tall, and the surface fills everything below it with no
      letterboxing, no clipped bottom edge and no stretched aspect
- [ ] The window opens at 960x557 with the strip up (960x530 of game plus the strip)
- [ ] Landing and refreshing a map does not move the strip or resize the surface
- [ ] With the strip hidden (see the menu toggle below) the window is exactly 960x530 and the
      game fills it exactly as it did before this ticket

### Start Bot

- [ ] Pressing **Start Bot** with the Bot Manager's command list empty leaves the tick off and
      the reason shown is the engine's own ("this bot has no commands: add some before starting
      it"), not a second wording invented by the strip
- [ ] Pressing **Start Bot** while not signed in leaves the tick off with the engine's own "no
      character is signed in" reason
- [ ] Pressing **Start Bot** while a bot already runs in this window leaves the tick on and says
      "a bot is already running in this window"
- [ ] With commands in the list and a character signed in, the tick starts that bot: the Bot
      Manager's own Enable tick follows, and the character begins to act
- [ ] Unticking **Start Bot** stops the bot, and the tick's state on reopening the strip matches
      whether the bot is really running (not what was last clicked)

### Auto Attack

- [ ] Ticking **Auto Attack** with nothing targeted attacks with the loader's own `*` and then
      fights; unticking it stops the loop
- [ ] Ticking it while not signed in, or while the bot is running, refuses with the engine's own
      wording and leaves the tick off
- [ ] The rotation casts 1, 2, 3, 4 and wraps, at roughly the reference's 150 ms pace
- [ ] A cast the game refuses (a skill not learned yet, a target that died between the read and
      the press) is shown on the strip and the rotation keeps going rather than stopping
- [ ] On a Chrono Shadow, Arcana Invoker or Archmage the class combo fires on its own condition
      and the skill is cast through the forced path where the reference forces it

### The cell and pad pickers

- [ ] The cell box lists the map's own cells after it is filled; an unfilled box is empty rather
      than full of stale names
- [ ] Picking a cell moves the character to that cell, on the pad the pad box shows, or `Spawn`
      when nothing is picked
- [ ] Picking a pad moves the character to that pad within the cell it is standing in
- [ ] The **x** refresh control refills the cell list, sets both boxes to where the character
      stands, and re-issues the move
- [ ] Both pickers and the refresh do nothing while nobody is signed in, and the refresh refuses
      while the map is still loading

### Bank

- [ ] **Bank** opens this plugin's Bank window, which is what the reference's `Player.Bank.Show()`
      is in this port

### The menu toggle

- [ ] The Game menu carries the strip's entry and it is a checkbox whose tick matches the layout
- [ ] Unticking it hides the strip and returns the window to exactly 960x530, with the game
      surface filling the window
- [ ] Ticking it again restores the strip and the size the window had while it was up
- [ ] Toggling twice never leaves a stale size (off then on then off lands on 960x530 both times)
- [ ] A window opened while the strip is hidden is plain-sized and its tick is off

### What could not be checked here, and why

- **No strip has been seen.** The Electron app cannot be started in this environment (PPAPI Flash
  and a real display are needed, and the app was never launched while this ticket was written), so
  every box above is unticked on purpose. What is asserted instead is the arithmetic and the data:
  the geometry, the capture rectangle, the controls, and the routing of each press into the engine
  or into the loader's own names.
- **The screenshot path excludes the strip** by construction: `res/instances.js` captures from
  below it (`captureRect`), and a window that is not the wrapper - a feature window, a Ruffle
  page - is not cut at all. That the capture looks right on screen is a display check.
- **A recording is of the window**, not of a rectangle inside its page:
  `res/features/capture/preload_capture.js` captures a `desktopCapturer` source by window title,
  so it follows the window's own size and does not go through `captureRect`. With the strip up the
  recording includes it; in the plain layout it does not. A recording that must show only the game
  is what the toggle is for, and the plain size stays exactly what the existing checklist expects.
- **The surface's own aspect** depends on the game's `scale` parameter, which this ticket does not
  touch: the wrapper still passes the plugin's own wrap config through.
