# Grimlite Parity

A second bundled game plugin: Grimlite-Li's user-facing surface (client-side tools, packet
tools, the bot engine) for Adventure Quest Worlds, kept out of the bundled game plugin so a
user who does not select it runs today's app unchanged.

Scaffold stage: the plugin loads, is selectable in Settings → General → Active plugin, and
contributes its menu, keybind, one placeholder window and the **packet logger** (Packets →
Sniffer): it subscribes to the platform's packet tap and shows the game's traffic in both
directions, with Copy, Clear, a filter and Start/Stop. The primary surface is a local page
because no game-specific wiring exists yet.

The logger reads and never writes: it holds `packet-tap`, not `packet-send`. Nothing arrives
until the client's traffic is steered through the relay (Settings → Packets), because the tap
carries what the relay carries.

It declares `apiVersion: 2` and the game access permissions its later features use
(`game-bridge`, `packet-tap`, `packet-send`; see `docs/PLUGINS.md` section 5).

One active plugin per process still holds: select this plugin and restart to run it.
