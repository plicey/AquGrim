# Ruffle compatibility of the AquGrim automation bridge

Research date: 2026-11-03. Official Ruffle docs/source only; source snapshot: `7a5f3a15e35f61b11dbd9b83edd089851d20e792`. This is a static architectural assessment, not a game compatibility test or certification of the bundled/downloaded Ruffle build.

## Architectural answer

**The existing bridge channel cannot attach to the current Ruffle wrapper unchanged. Keep the AS3 bridge as the owner of live game access; provide a Ruffle-specific page transport using the retained player and `player.ruffle(1).callExternalInterface(name, ...args)`.** Ruffle implements the required ExternalInterface registration, shared application-domain selection, child SWF loading, dynamic property access and Function.apply mechanisms. That establishes the architecture's underlying mechanisms, not successful execution of AquaBridge → Loader4 → Game. There is no source-backed basis here to declare that chain incompatible or working.

## Proven integration blocker

Local `res/platform/bridge-channel.js` exclusively searches `document.getElementsByTagName("object")` for `type === "application/x-shockwave-flash"`, then probes and invokes methods on that element. Local `res/ruffle_wrapper.html` instead appends `ruffle.createPlayer()` to `#container`, retaining `player` only inside `startPlayer`. Ruffle's [PlayerElement contract](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/web/packages/core/src/public/player/player-element.ts) describes the created HTMLElement and its versioned API. **The channel cannot discover the player this wrapper creates:** it returns no element and cannot become ready. A transport integration is required before runtime compatibility can even be assessed.

## Mechanisms established by official source

- **ExternalInterface:** Ruffle's [AVM2 add_callback](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/core/src/avm2/globals/flash/external/external_interface.rs) checks availability and registers an AVM2 function; this is implemented, not an unsupported stub. The wrapper already sets `allowScriptAccess: true`, the documented prerequisite for page scripting ([official option docs](https://ruffle.rs/js-docs/master/interfaces/Config.BaseLoadOptions.html#allowScriptAccess)).
- **Versioned dispatch versus legacy dynamic methods:** [PlayerV1](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/web/packages/core/src/public/player/v1.ts#L181) defines `callExternalInterface(name, ...args)`; absent callbacks silently return `undefined`. [PlayerV1Impl](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/web/packages/core/src/internal/player/impl_v1.ts#L107) forwards to the internal dispatcher. Ruffle also [installs callback-named properties on the player element](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/web/packages/core/src/internal/player/ruffle-player-element.tsx#L42), so claiming dynamic callbacks are absent would be false. Its [public contract discourages these unversioned surfaces](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/web/packages/core/src/public/player/player-element.ts). Use versioned dispatch and explicit bridge readiness/response validation: the dispatcher existing, or returning `undefined`, does not prove callback registration or game readiness. In AquaBridge, callbacks register before the game root is captured.
- **Shared application domain:** [LoaderContext](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/core/src/avm2/globals/flash/system/LoaderContext.as) stores its supplied applicationDomain; [currentDomain](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/core/src/avm2/globals/flash/system/application_domain.rs#L37) returns the caller's domain. The [movie loader](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/core/src/loader.rs#L1689) uses the supplied domain, creating a child domain only when none is supplied. This matches AquaBridge's explicit `new LoaderContext(false, ApplicationDomain.currentDomain)`; this API is not an established blocker.
- **Child SWF and live object access:** [Loader.load](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/core/src/avm2/globals/flash/display/loader.rs) passes the context into asynchronous movie loading and exposes content. [AS3 property implementation](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/core/src/avm2/object/script_object.rs) implements dynamic reads/writes, including prototype reads and errors when creating forbidden sealed-object properties. [Function.apply](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/core/src/avm2/globals/function.rs#L78) invokes the function with a receiver and expanded Array arguments. These are the mechanisms behind AquaBridge's `walk`, property assignments, `resolveStatic`, and `owner[name].apply(owner, args)`; they do not guarantee any particular game member exists or is writable.
- **TCP:** [socketProxy configuration](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/web/packages/core/src/public/config/load-options.ts#L701) specifies host/port-to-WebSocket mappings. The [web backend](https://github.com/ruffle-rs/ruffle/blob/7a5f3a15e35f61b11dbd9b83edd089851d20e792/web/src/navigator.rs#L494) matches host and port exactly, fails unmatched connections, and exchanges binary WebSocket frames. Browser Ruffle therefore requires a WebSocket-to-TCP relay; `allowNetworking: 'all'` does not supply raw TCP. The local wrapper builds the documented `{host, port, proxyUrl}` entries only when both `proxy` and `cfg.socket` exist. Missing configuration produces `[]`; any attempted socket then has no matching route. Extra policy-port entries are not proof of policy-handshake compatibility.

## Untested runtime and acceptance gate

No Ruffle game/session was run. Still unproven: the selected build in Electron 11/Chromium 87; bridge registration and argument/result marshalling; Loader4's nested loading, stage/event timing, FlashVars and `Game.root` discovery; actual class/property/method semantics and automation mutations; HTTP origin/CORS behavior; and relay reachability, exact server mappings and successful game login/packet exchange. Loader source contains explicit reuse limitations; these are not proof that AquaBridge's fresh Loader fails. PPAPI-specific origin observations in AquaBridge comments are not Ruffle test evidence.

Before enabling Ruffle automation, require one end-to-end run on the exact distributed build: load **AquaBridge**, observe registered callbacks separately from game-ready, complete Loader4/login, read `Game.root.world`, perform a reversible property write and a function call through the bridge, and verify binary relay traffic to a configured game server. **Decision: adapt the JS transport; retain the AS3 bridge design; withhold an automation-support claim until those checks pass.** No implementation changes were made.

## Runtime probe performed by parent agent

On 2026-11-03 the bundled **Ruffle 0.7.1** was exercised in the collaborative Chromium preview, using the existing origin proxy and shipped `assets/aqua-bridge.swf`. This supersedes the static-only limitations above for the checks below, not for Electron or live gameplay.

- All **20** AquaBridge callbacks appeared as functions on `RUFFLE-PLAYER`; none were missing.
- `pollEvents` reported `loading the game loader` and `loader ready spiderloader::main`: AquaBridge successfully loaded Loader4.
- `getGameObjectS('spiderloader.main')` returned `"[class main]"`, demonstrating class lookup across the shared application domain.
- `GetSkipCutscenesStatus` returned structured JSON; disabling infinite range, walk speed, and cutscene skipping each returned `false` successfully.
- Injecting the **unchanged** `buildPageSource` returned `ready: false` and `no Flash element in this page`.
- Adding only a temporary, in-memory `document.querySelector('ruffle-player')` fallback to its element finder made `ready()` true and existing channel calls to `pollEvents`, `getGameObjectS`, and `GetSkipCutscenesStatus` succeed. Legacy callback properties therefore work in the shipped build; versioned dispatch is the documented API for a durable implementation.

**Result:** the actual AquGrim bridge executes under bundled Ruffle, and the page transport mismatch is reproduced and bypassed. Enabling it also requires plugin Ruffle eligibility and socket relay configuration. No bot/feature rewrite is indicated by these checks. No credentials were entered: `world` remained unavailable, so live inventory/combat/bot operations, server connection, and Electron 11 compatibility remain unverified. No production code was changed.

## Live session checks

After the user logged in, the temporary page was configured with 26 socket routes from the live server list and the existing WebSocket/TCP relay (temporary copy restricted to the test page's exact loopback origin). Ruffle reported `loaded Game` and `game root available`. The existing `bridge.js`, `loader-surface.js`, and `game-calls.js` modules were evaluated unchanged in the test page with a transport forwarding to Ruffle; these were live feature-adapter checks, not mocked results.

Passed:

- `IsLoggedIn` returned true; map/cell reads returned `battleon` / `Enter2`.
- Inventory adapter returned 22 valid normalized entries, matching `UsedInventorySlots`; bag capacity returned 120. The bank slot adapter returned `{total:120, used:0}` (not independently compared with the bank UI).
- Visible-monster enumeration executed successfully, returning zero in the current cell. This exercises the game-function invocation path, but does not test combat against a monster.
- Skill name/cooldown reads, target-state checks, and shared-domain `Game.root.world.WALKSPEED` access succeeded.
- Walk-speed callback changed 8 to 12 and restored 8. The existing legacy-name route also changed speed to 11 successfully, then restored the prior value.
- Infinite-range maintenance changed six action ranges to 20000; disabling restored all six original values exactly.
- Generic property write toggled world visibility and restored it.
- Existing cutscene-skip route armed its watcher; the original off state was restored. Actual cutscene playback/skipping was not exercised.
- Invalid property paths returned a structured error rather than a successful result.

All temporary setting changes were restored. The test server and relay remain running for the user's test page. This establishes live reads, writes, function dispatch, and several option controls under Ruffle; it does not establish full bot/combat/quest/bank-transfer coverage or Electron 11 support. No production implementation was changed.
