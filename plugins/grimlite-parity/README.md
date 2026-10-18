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

The Notepad's `debugskill` and `mapitems` helpers read the equipped class and the map-item
history. Those reads land with the bridge (ticket #28); until then the source reports nothing
rather than a stand-in value, so a dump never claims state the app has not read.
The plugin boots the game from its own loopback origin and loads **the bridge** there: a small SWF
(`bridge/AquaBridge.as`, built to `assets/aqua-bridge.swf`) that loads the game SWF into its own
`ApplicationDomain` and registers the call surface the reference's features drive. Page, bridge
and game share one origin, which is what makes that domain access legal under PPAPI Flash at all
(`docs/research/grimlite-bridge-spike.md`).

Features so far: the **Dev Test** window (type a function and arguments, call it, see the
result, with the reference's own modes), the **packet logger** opened from Packets → Sniffer,
and the placeholder window the scaffold shipped.

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
itself; `npm test` drives a fake of the same shape. The file's header lists every method, the
game-side call each one needs, and the `InventoryItem` / world shapes it hands over. Until
ticket #28 wires the bridge channel, every method reports that it is unwired instead of
pretending to reach a game.

## Windows

- **Bot file** (Alt+Shift+B) — open, edit and save a `.gbot` (#24).
- **Bank** (Alt+Shift+K) — transfer by category and AC-ness, plus Bank All (#29).
- **Sets** — save, list, load, clear and equip `.gset` sets (#29).
- **Parity placeholder** (Alt+Shift+G).
