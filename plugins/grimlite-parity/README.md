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

The Notepad's `debugskill` and `mapitems` helpers read the equipped class and the map-item
history. Those reads land with the bridge (ticket #28); until then the source reports nothing
rather than a stand-in value, so a dump never claims state the app has not read.
The plugin boots the game from its own loopback origin and loads **the bridge** there: a small SWF
(`bridge/AquaBridge.as`, built to `assets/aqua-bridge.swf`) that loads the game SWF into its own
`ApplicationDomain` and registers the call surface the reference's features drive. Page, bridge
and game share one origin, which is what makes that domain access legal under PPAPI Flash at all
(`docs/research/grimlite-bridge-spike.md`).

Features so far: the **Bot Manager**, the **Dev Test** window (type a function and arguments, call
it, see the result, with the reference's own modes), the **packet logger** opened from Packets →
Sniffer, the three display windows above, and the placeholder window the scaffold shipped.

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
