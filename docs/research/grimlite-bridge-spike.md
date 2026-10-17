# Bridge spike: ExternalInterface + ApplicationDomain in AquaGrim

| Field | Value |
|-------|-------|
| **Ticket** | [#7 Prove the ExternalInterface bridge end-to-end in AquaGrim](https://github.com/plicey/AquGrim/issues/7) |
| **Date** | 2026-10-17 |
| **Verdict** | **Works, with one hard correction to #2.** Page-to-SWF calls work. Loading the real game SWF into a shared `ApplicationDomain` works and exposes its 510 classes -- but **only when the game SWF is same-origin with the bridge SWF**. Cross-origin it fails with Error #2119 / #2121. Grimlite never hit this because a standalone Flash ActiveX host grants a local-trusted sandbox; PPAPI inside Chromium does not. |
| **Environment** | Electron 11.5.0 (Chromium 87.0.4280.141), bundled `FlashPlayer/libpepflashplayer.so` (version string 34.0.0.137), Linux x64 |
| **Artifacts** | AS3 sources and the runner live under `/var/tmp/aq-spike` (scratch; rebuild from the recipe below). Game SWF fetched from `game.aq.com/game/gamefiles/Game4000r5.swf`, loader from `Loader4.swf?ver=b`. |

## 1. Results

| # | Test | Result |
|---|------|--------|
| A | Page JS calls `ExternalInterface` callbacks registered by a SWF (page `file://`, SWF `file://`) | **Works.** `aqPing()` -> `pong`, `aqArg('hello')` -> `got:hello` |
| B | Same, page `file://`, SWF served from `http://127.0.0.1` | **Works.** Cross-origin page/SWF is fine -- `allowscriptaccess=always` is doing its job |
| C | Bridge SWF loads the **real game SWF cross-origin** (from `game.aq.com`) | **Fails.** `#2119` on any `ApplicationDomain` access, `#2121` on `content` |
| D | Bridge SWF loads the **real game SWF same-origin** (both from `127.0.0.1`), plain `LoaderContext` | **Works.** 509 classes enumerable, including `it.gotoandplay.smartfoxserver.handlers::ExtHandler` and `it.gotoandplay.smartfoxserver::SmartFoxClient` |
| E | Same-origin + `new LoaderContext(true, ApplicationDomain.currentDomain)` | **Works, and merges the game's classes into the bridge's own domain:** `currentHasSfs=true`, `currentTotal=510` (vs 1 without sharing) |
| F | Live object read/write (`world.strFrame`, root key enumeration) after the movie attaches to the stage | **Loads and attaches** (`attached:true`), root enumerable, but game internals are unpopulated because the client has not run its login handshake. `#1069` (property not found) is *not* a security error -- this is the expected state of a game SWF that never logged in. |

## 2. The correction this makes to #2

[#2](https://github.com/plicey/AquGrim/issues/2)'s resolution said a bridge SWF with a shared `ApplicationDomain` reaches game state, and that Artix's own `Loader4.swf` proves the pattern. Both remain true, but the resolution missed the constraint that decides whether it can work here:

- Artix's loader loads the game **from `game.aq.com`, onto `game.aq.com`** -- same origin, no domain bridge needed.
- Grimlite's `grimoire.swf` loads the game **cross-origin from a local file**, and works because Flash's standalone/ActiveX host puts it in a **local-trusted** sandbox where cross-domain content access is permitted.
- **PPAPI Flash inside Chromium does not grant that.** Test C shows the cross-origin load completing but every subsequent access denied (`#2119`/`#2121`). `Security.allowDomain('*')` on the *bridge* does not help: the check that fails belongs to the loaded content's own policy.

**Consequence for the map:** the bridge is no longer independently buildable. It needs the game SWF to be served from the same origin as the bridge SWF, which is exactly what the local relay/proxy from [#3](https://github.com/plicey/AquGrim/issues/3) can provide by serving game files from `127.0.0.1` instead of `game.aq.com`. **The bridge depends on the proxy.** That edge did not exist on the map before this spike and has now been recorded on [#8](https://github.com/plicey/AquGrim/issues/8).

Test E also settles a design question #2 left open: pass `ApplicationDomain.currentDomain` explicitly. Without it the game classes live in a child domain that must be addressed through `getDefinition`; with it they are first-class in the bridge's own domain.

## 3. The recipe (what actually works here)

### Toolchain

| Piece | Source |
|-------|--------|
| JDK 17 | `https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse` (tarball, no root needed) |
| Apache Flex SDK 4.16.1 | `https://archive.apache.org/dist/flex/4.16.1/binaries/apache-flex-sdk-4.16.1-bin.tar.gz` |
| `playerglobal.swc` | `https://fpdownload.macromedia.com/get/flashplayer/updaters/32/playerglobal32_0.swc`, placed at `<flex>/frameworks/libs/player/32.0/playerglobal.swc` |

**The gotcha that costs the most time:** `flex-config.xml` refers to `{playerglobalHome}`, and the SDK does **not** derive it. Compilation fails with `unable to open '{playerglobalHome}/32.0/playerglobal.swc'` until you export it:

```sh
export JAVA_HOME=<jdk>
export PATH="$JAVA_HOME/bin:$PATH"
export PLAYERGLOBAL_HOME=<flex>/frameworks/libs/player
"<flex>/bin/mxmlc" -target-player=32.0 -swf-version=32 \
  -default-size 960 530 -default-background-color=0x000000 -default-frame-rate=24 \
  -static-link-runtime-shared-libraries=true \
  -output out/bridge.swf src/Bridge.as
```

These are the same flags `plugins/example-companion/flash/build.bat` documents; only `PLAYERGLOBAL_HOME` was missing from it.

### Runtime

- `ppapi-flash-path` -> the repo's `FlashPlayer/libpepflashplayer.so`, `ppapi-flash-version` -> `34.0.0.137`, plus `no-sandbox` (all as `res/flash.js` already does).
- `nw-flash-trust` pointing at `userData/Pepper Data/Shockwave Flash/WritableRoot`, with the page origin added (`res/flash.js`'s pattern). A `file://` page needs the SWF's **directory** in the trust list (`file:///var/tmp/aq-spike/www`), not the file.
- The game window needs `plugins: true`, `sandbox: false` -- already the case in `res/windows/config.js`.

### AS3 gotchas

- An inline closure that contains `try`/`catch` **and** returns a value fails to compile ("Function does not return a value"). Use a named method.
- `ApplicationDomain.getQualifiedDefinitionNames()` returns `Vector.<String>`, not `Array`.
- `hasDefinition('a::B')` uses the `package::Class` form. `spiderloader::main` is a *loader* class and is absent from the game SWF's domain, so probing for it against `Game4000r5.swf` correctly returns `NODEF`.

## 4. Not settled here

- **The login handshake.** Live game state (`world.strFrame` and friends) was never populated because no character logged in. Reads against a live session are still unproven, and that needs an account.
- **Whether serving game files locally breaks the client.** The game may validate its own origin, and the token/session flow was not exercised.
- **Ruffle.** Untested; its `ExternalInterface` semantics differ and #3 already established there is nothing to intercept there.
- **Loaders vs game SWF.** The spike loaded `Game4000r5.swf` directly. In production the entry point is `Loader4.swf`, which does its own load; whether the bridge should wrap the loader or the game is an open design question for #8.
