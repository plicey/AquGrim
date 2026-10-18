# Grimlite Parity

A second bundled game plugin: Grimlite-Li's user-facing surface (client-side tools, packet
tools, the bot engine) for Adventure Quest Worlds, kept out of the bundled game plugin so a
user who does not select it runs today's app unchanged.

Scaffold stage: the plugin loads, is selectable in Settings → General → Active plugin, and
contributes its menu, keybind and one placeholder window. The primary surface is a local
page because no game-specific wiring exists yet.

It declares `apiVersion: 2` and the game access permissions its later features use
(`game-bridge`, `packet-tap`, `packet-send`; see `docs/PLUGINS.md` section 5).

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
