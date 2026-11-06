# Mugetsu inside AquGrim

AquGrim embeds a custom self-hosted JS/WebAssembly build of
[Mugetsu 1.6.0](https://github.com/mugetsu-aqw/mugetsu/tree/49eeabc9bd8743b90827ae988b0c9e0ad9f3ba06),
based on [Ruffle fda41800](https://github.com/ruffle-rs/ruffle/tree/fda41800ba47059dabec662585a388cf4dca8413).
The game stays in the existing Electron window with its toolbar, ExternalInterface bridge,
socket relay, and bot features. No native Mugetsu window or executable is used.

The web portability patch is `scripts/mugetsu/web-port.patch`. It replaces native clocks,
threaded work, and GPU synchronization where browsers require different implementations.
Rendering remains at the selected quality; optional adaptive resolution is separate and off
by default. Native parallel tessellation/command recording and native PGO are unavailable in
this sequential WASM build. Desktop Mugetsu benchmark results do not describe this build.

`res/ruffle/engine.json` identifies the source commits and SHA-256 of each shipped engine file.
A pinned engine takes precedence over downloaded stock Ruffle. Stock auto-updates are disabled
for this bundle; engine updates ship with AquGrim. Settings displays the engine version.

## Rebuild

Install Rust 1.99.0 with the `wasm32-unknown-unknown` target, Node 24, Java 17,
wasm-bindgen CLI 0.2.127, and Binaryen's `wasm-opt` on PATH. Then run:

```sh
bash scripts/build-mugetsu-web.sh
npm run dist-l
```

The script downloads exact pinned sources, applies Mugetsu's patches and the web portability
patch, builds optimized WASM and self-hosted JavaScript, validates the module, and installs it
in `res/ruffle`. Build work stays under the gitignored `work/mugetsu-web` directory.
Set `MUGETSU_WEB_WORK` to use another build directory. Compilation defaults to one job.

Mugetsu's changes are GPL-3.0; its license ships as `res/ruffle/LICENSE_MUGETSU`.
Original Ruffle license files are preserved. The public source commits above, Mugetsu's
`source/patches`, and AquGrim's web portability patch identify the code used by this build.

## Smoke test

```sh
env -u ELECTRON_RUN_AS_NODE node_modules/electron/dist/electron --no-sandbox plugins/grimlite-parity/scripts/smoke-engine.cjs
```

This uses a temporary profile and a hidden window. It checks GPU boot, all declared bridge
callbacks, and an advancing frame counter; its output includes a screenshot path. It loads the
login screen without credentials and leaves existing sessions alone. The test caught shared
index/vertex-buffer and base-vertex draw restrictions in WebGL. The port uses a separate index
arena and per-shape vertex bindings where required.

## Validation limits

Verified on 2026-11-03: optimized WGPU/WebGL login-screen rendering, all declared bridge
callbacks, 1,488 client tests, plugin smoke checks, and engine checksums in the Linux package.

Automated client checks do not measure gameplay FPS, room transitions, login persistence,
or every bot action. Verify those in a separate test session before claiming a performance
improvement. Do not restart an existing user session to run a smoke test.

## Keyboard and background regression check

```sh
env -u ELECTRON_RUN_AS_NODE -u WAYLAND_DISPLAY xvfb-run -a node_modules/electron/dist/electron --no-sandbox --ozone-platform=x11 scripts/smoke-keyboard.cjs
```

This uses a separate profile and display. It holds movement keys, moves focus away without
key-up, then presses the opposite directions. It verifies the movie receives deactivation,
movement recovers, skill keys still work, and game frames and page timers advance while the
window is covered, unfocused, or hidden. It tests both production background-throttling settings
and Ruffle's hidden-page fallback. Minimization is also checked when a window manager is
available; plain Xvfb reports that case as unavailable.
The fixture source and compiled movie are in `test/fixtures/keyboard/`; rebuild it with Apache
Flex targeting Flash 32, static runtime linking, and a frame rate of 24.

Mugetsu Web revision 2 sends activation/deactivation to WASM movies and clears held engine keys.
The wrapper enables `backgroundExecutionMode: "mainThread"`: a worker schedules game ticks when
hidden instead of Ruffle's default pause. These checks do not require a game account.

On Wayland, the compositor can stop animation callbacks even while Electron reports the
page as visible. `res/game-timing.js` waits 100 ms for a stalled compositor before
falling back to 60 Hz timer ticks. It keeps one native callback pending and returns to
compositor pacing when callbacks resume, so timers do not race healthy frames.
Run the smoke command with `PROBE_STALL_RAF=1` to
simulate a compositor that never delivers animation callbacks.
