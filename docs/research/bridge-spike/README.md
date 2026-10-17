# Bridge spike artifacts

Throwaway sources for the spike recorded in [../grimlite-bridge-spike.md](../grimlite-bridge-spike.md). Not wired into the app; nothing here is shipped.

| File | Role |
|------|------|
| `Bridge.as` | The bridge SWF. Registers `ExternalInterface` callbacks and loads the game SWF into a shared `ApplicationDomain`. Compiled with Flex `mxmlc` (recipe in the report). |
| `bridge.html` | Page-side wrapper. Creates the `<object>` and passes `swf` / `share` via `flashvars`. |
| `runner.js` | Electron 11.5.0 harness. Registers PPAPI Flash, writes the `nw-flash-trust` list, serves `www/` on 127.0.0.1:8899, then drives the probes. |

Run it by serving the compiled `bridge.swf` plus a copy of the game SWF from one origin on 127.0.0.1:8899 and executing `runner.js` with Electron. Serving both from the *same* origin is the point -- cross-origin access is denied, see section 2 of the report.
