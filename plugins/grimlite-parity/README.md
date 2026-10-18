# Grimlite Parity

A second bundled game plugin: Grimlite-Li's user-facing surface (client-side tools, packet
tools, the bot engine) for Adventure Quest Worlds, kept out of the bundled game plugin so a
user who does not select it runs today's app unchanged.

The plugin loads, is selectable in Settings → General → Active plugin, and contributes its
menu, keybinds and feature windows. The primary surface is a local page because no
game-specific wiring exists yet.

The **packet logger** (Packets → Sniffer) subscribes to the platform's packet tap and shows
the game's traffic in both directions, with Copy, Clear, a filter and Start/Stop. It reads and
never writes: it holds `packet-tap`, not `packet-send`. Nothing arrives until the client's
traffic is steered through the relay (Settings → Packets), because the tap carries what the
relay carries.

The **packet spammer** (Packets → Spammer) is the write half: a saved list, a delay, Start/Stop and
Send once, with the reference's own file shape (`<autoer>` with `<packet>`, `<author>` and
`<spamspeed>`) read and written both ways, a file authored elsewhere included. It holds
`packet-send` and never subscribes to the tap, so a send-only tool needs no read permission at all.

The **Packet Tamperer** (Packets → Tamperer) shows one side while editing the other: two capture
switches that gate their own direction independently, a case-insensitive text filter, the send and
receive boxes, and **Send to server** / **Send to client** / **Clear**. It holds both permissions,
because it reads the tap and writes frames. An injected frame goes out NUL-framed on the side it
was sent and appears on the tap afterwards, so a Sniffer window sees it too.

Both write through `host.packets.send({ direction, text })`, which answers whether the frame went
out. `false` means there is no live connection (steering off, or the session between connections);
neither window hides that, and neither queues the frame for later.

Windows that need no game state come first (ticket #25): **Notepad** (rich text, font and
colour, drag-and-drop of text files, save through a native dialog, and the reference's two
typed helpers), **Eye Dropper** (a pixel printed as ARGB hex, decimal channels and RRGGBB)
and **About** (version, the reference's credit links, and a control that reloads the game
movie). `Grimlite` in the window menu opens all three.

The **Bot Manager** (Grimlite → Bot Manager, Alt+Shift+M) is the reference's editor window: its
eleven tabs and the controls it puts in each of them, the left list that switches between
commands, skills, quests, drops, boosts and items, the live counters under it, a search that
wraps, and the reference's editing keymap (move, duplicate, delete, copy as text, cut and paste,
insert above, flip a variant, double-click to edit). A command opens a form generated from its own
members, with the raw JSON behind it, and both write back to the list. The right-click menu
carries the per-command colour customiser, the font size, the multiline toggle, tabpage toggle and
the command customiser; colours, centring and size are stored per class in the plugin's own store.
The **Bots** tab is a one-level tree over the chosen bots folder that opens a `.gbot` on select
and accepts one dropped on the window.

The window edits the parsed document in place (`bot/bots.js`): a key that was absent because it
equalled the reference's default stays absent through a save, so a bot opened here and saved
unchanged is still the file the reference wrote. It builds and displays the command vocabulary -
the reference's own display text, form labels and construction - but does not execute it: running
a bot is the engine, ticket #37.

The controls that act on the running game are honest about a split that decides what this app can
read at all. The reference client does not read the stock game for most of its own data: it ships
its own loader (`Loader/grimoire.swf`), implements a helper surface there, and calls that. Our
bridge loads the stock game, so a name that lives only in the reference's loader answers "no
member ... at world". `bot/game-reads.js` records which controls those are, name by name. The
reachable ones - `Get current cell`, and `Get` on the Hunt tab - read `world.strFrame`,
`world.strPad` and `world.strMapName` through the generic bridge surface, which is the same
source the reference's own loader reads for its cell and pad. The rest report the helper they wait
for (`Position`, `RoomNumber`, `SetSpawnPoint`, `ReloadMap`, `HideConnMC`, `SetFPS`), or the
reason they are not wired (frame injection is the unverified `sendClientPacket` path, ticket #28;
the name and guild substitutions belong to the engine, ticket #37). No control silently does
nothing, because an empty cell box is indistinguishable from a real reading.

The Notepad's `debugskill` and `mapitems` helpers read the equipped class and the map-item
history. Those reads land with the bridge (ticket #28); until then the source reports nothing
rather than a stand-in value, so a dump never claims state the app has not read.
The plugin boots the game from its own loopback origin and loads **the bridge** there: a small SWF
(`bridge/AquaBridge.as`, built to `assets/aqua-bridge.swf`) that loads the game SWF into its own
`ApplicationDomain` and registers the call surface the reference's features drive. Page, bridge
and game share one origin, which is what makes that domain access legal under PPAPI Flash at all
(`docs/research/grimlite-bridge-spike.md`).

Features so far: the **Bot Manager**, the **Dev Test** window (type a function and arguments, call
it, see the result, with the reference's own modes), the three packet tools opened from Packets →
Sniffer / Spammer / Tamperer, the Bank and Sets windows, the three display windows above, and the
placeholder window the scaffold shipped.

The **Cosmetics** window (Grimlite → Cosmetics, Alt+Shift+C) is the reference's own grid: eight
rows (Helm, Armor, Class, Weapon, Off.H, Pet, Cape, Misc), each with a file box, a link box and a
**Set** button, the seven per-slot grab links above it, a player picker filled from the room, and
**Grab / Equip All / Equip Selected / Clear All / Remove / Save / Load**. A set saves in the same
`.gset` document the Sets window writes, and the reference's own 24-line file loads too.

It reaches the game through the bridge, and every read is a name the **stock game** actually
carries - `world.uoTree`, `objData.eqp` (the game's own wear store) and
`world.myAvatar.loadMovieAtES` for the write. That last one is the call the reference keeps
commented out beside its own `SetEquip`, because `SetEquip`/`GetEquip` exist only in the
reference's loader SWF, which no AquaGrim user loads. Nothing here invents a loader-only answer.

It declares `apiVersion: 2`, the `game-origin` / `flash-trust` permissions the boot needs, and the
game access permissions its later features use (`game-bridge`, `packet-tap`, `packet-send`; see
`docs/PLUGINS.md` sections 4.11 and 5). `bridgeCallbacks` names the call surface its bridge
registers.

Rebuilding the bridge needs an AS3 compiler but no root:

```sh
FLEX_HOME=<apache-flex-sdk> JDK_HOME=<jdk> sh plugins/grimlite-parity/bridge/build.sh
```

The header of that script carries the fetch recipe and the two environment variables mxmlc does
not derive for itself.

One active plugin per process still holds: select this plugin and restart to run it.

## Game access

`bridge.js` is the one place this plugin asks the game for anything. Every feature consumes an
object of its shape (`createGameAccess(host)`) and never reaches Flash, the Host or the SWF
itself; `npm test` drives a fake of the same shape.

It sits on the bridge channel #28 landed (`host.bridge.attach()` / `call(name, args)`), which is
the generic layer (`getGameObject`, `callGameFunction`, `setGameObject`, ...), so this module is
where a feature's want ("read the inventory", "equip this item") becomes the game's own call
name. Which of those names can answer is evidence, not guesswork: the reference calls a *loader*
it ships, and 100 of its 146 names exist only there. Which of *these* names are in that hundred was
then checked against the decompressed stock game itself, with a stricter test than the research
count used: a name counts only when it is an exact ABC string-pool entry **and** a multiname
references it. By that test the game answers none of `GetInventoryItems`, `TransferToBank`,
`TransferToInventory`, `UsedBankSlots`, `BankSlots` or `Equip` - `BankSlots` occurs only inside
longer literals (`txtBankSlots`, `iMaxBankSlots`), and `Equip` is a pool entry with zero
multiname references. The bridge loads the stock game, so each is answered `no member ... at
world`; this adapter passes that answer through and adds why, rather than inventing a result or
blocking the call outright - the day the bridge implements that surface, these calls start working
with no change here.

The game's own bank machinery is differently named and was verified the same way: `initBank`,
`bankFromInv`, `bankToInv`, `bankSwapInv`, `addToBank`, `removeFromBank`, `isItemInBank`,
`getBankItem`, `bankItems`, `bankArr`, `iBankCount`, the `sendBank*Request` senders and
`world.bank.items` are all in the pool with live references. None of them answers to the
reference's vocabulary, so reaching them is a design decision for the bridge ticket, not a rename
this module may make on its own.

**The bridge still owes the loader's surface** before Bank can transfer anything: see the ticket
#29 section of `docs/FLASH_CHECKLIST.md`.

## Windows

- **Bot file** (Alt+Shift+B) — open, edit and save a `.gbot` (#24).
- **Bank** (Alt+Shift+K) — transfer by category and AC-ness, plus Bank All (#29).
- **Sets** — save, list, load, clear and equip `.gset` sets (#29).
- **Parity placeholder** (Alt+Shift+G).

## Loaders and grabbers (#31)

`features/loaders/` is the reference's Tools -> Loaders/grabbers window: four loaders (hair shop,
shop, quest, armour customizer) with its quest-count control, its `F Accept` batch and its ghost
variant, and eight grabbers (shop items, quest ids, quest items with drop rates, inventory, temp
inventory, bank, monsters, all monsters) with search, name/id ordering, the reference's XML export
and its per-row and aggregate right-click menus.

It extends the game access above rather than adding a second adapter: `features/loaders/game.js`
exports `createGameAccess(bridge, log)` with the same attach-once and report-what-happened rules,
plus the reads and the loaders this window needs. Wiki links go through `host.windows.openUrl`,
so they open in the app's own browser window rather than the system browser the reference uses.

What each loader can reach, and what it is still waiting for, is tabulated in the ticket #31
section of `docs/FLASH_CHECKLIST.md`. The short version: all four loaders work by falling back to
the game's own request, every grabber reads a game object, and `Complete`, `SetEquip`,
`BuyItemQtyById` and the loader-only read names report themselves by name until the bridge grows
the reference loader's surface.

## Windows

 - **Bot file** (Alt+Shift+B) — open, edit and save a `.gbot` (#24).
 - **Bank** (Alt+Shift+K) — transfer by category and AC-ness, plus Bank All (#29).
 - **Sets** — save, list, load, clear and equip `.gset` sets (#29).
- **Loaders/grabbers** (Alt+Shift+L) — the four loaders, the eight grabbers and their menus (#31).
 - **Parity placeholder** (Alt+Shift+G).
