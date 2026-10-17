# How AquaGrim reads and writes AQW game state from outside the SWF

| Field | Value |
|-------|-------|
| **Ticket** | [#2 How AquaGrim reads and writes AQW game state from outside the SWF](https://github.com/plicey/AquGrim/issues/2) |
| **Date** | 2026-10-17 |
| **Verdict** | **Feasible with caveats.** Ship a small bridge SWF that re-embeds the game loader in the *same* ApplicationDomain and registers `ExternalInterface` callbacks; drive it from the page side of `res/swf_wrapper.html`, never from the main process. |
| **Reference implementation** | Froztt13/Grimlite-Li @ `816d9cd` (/tmp/grimlite-full); jib-akbr/Grimlite-Li (/tmp/grimlite-probe-2, `jib/master` = `Loader/grimoire.swf` 33,112 bytes) |
| **AquaStar side** | working tree /home/ammar/.codex/worktrees/757d/aqugrim, Electron 11.5.0 + PPAPI Flash (Chromium 87.0.4280.141) |
| **Evidence grade** | Grimlite loader decompiled to ActionScript; live AQW loader and game SWF downloaded and decompiled; Chromium 87 source read at the tag; one local FFDec build experiment. Nothing here is inferred from a README. |

## 0. Verdict in one table

| Candidate mechanism | Works in Electron 11.5.0 + PPAPI? | Verdict |
|---|---|---|
| Bridge SWF that loads the game **into `ApplicationDomain.currentDomain`** and registers `ExternalInterface` callbacks (Grimlite's design) | Yes - this is the mechanism Grimlite proves, and both the wrapper and the stock AQW loader already satisfy its preconditions | **Recommended** |
| Call methods on the game's own `<object>` element from the page | No, not for game state - the stock loader/game does not register the needed callbacks | Not viable |
| `executeJavaScriptSafely` from the main process as the bridge transport | Yes as transport, but it can only reach the page, and only on page-load events | Use as half of the bridge, not the bridge |
| A native-process shim (`res/platform/helper-process.js`) | Yes for a *second* SWF process, no for the game window's live movie | Not viable for live state |

---

## 1. What Grimlite actually does (primary source: decompiled `Loader/grimoire.swf`)

The ticket's premise is confirmed and sharpened. Grimlite's bridge is not "an ExternalInterface file in the app directory" - it is a **loader SWF that owns the load and registers callbacks itself**.

```
grimoire.swf  (CWS/zlib, 29,126 bytes -> 48,546 bytes inflated, SWF version 43)
  14 exported scripts, all readable as ActionScript
```

Reproduce: `python3 -c "import zlib;d=open('Loader/grimoire.swf','rb').read();print(zlib.decompress(d[8:]))"`, then `ffdec-cli -export script`. The four load-bearing facts:

**1.1 Same-ApplicationDomain load.** `Root.as` loads the game with an explicit context and keeps the domain:

```actionscript
this.loader.load(new URLRequest(this.sURL + "gamefiles/" + this.sFile));
...
Game = this.stg.addChildAt(param1.currentTarget.content, 0);
GameDomain = LoaderInfo(param1.target).applicationDomain;      // Loader/grimoire.swf -> grimoire.Root.as:141
```

The default `LoaderContext.applicationDomain` is `ApplicationDomain.currentDomain` (Adobe, *LoaderContext* - "the default value is the current application domain"), so pointing at the same domain is the default. `GameDomain` is then used to *find classes by name*:

```actionscript
_gameClass = Root.GameDomain.getDefinition(getQualifiedClassName(Root.Game)) as Class;   // grimoire.Caller.as:26
_loc3_ = Class(Root.GameDomain.getDefinition("it.gotoandplay.smartfoxserver.handlers.ExtHandler"));  // grimoire.Caller.as:124
```

That `ExtHandler` lookup is what makes `sendClientPacket` work, and it only resolves if the bridge shares the game's domain. **The shared ApplicationDomain is the load-bearing part, not the `Loader` object or the `LoaderInfo`.**

**1.2 The callback surface registered on the movie.** `Externalizer.init` registers 156 names in one place - `addCallback` at `grimoire.Externalizer.as:21-174`, inside `init` at `:19-177` - plus a debug line at `:177`. The ones that define the bridge shape:

| Callback | Grimlite source | Notes |
|---|---|---|
| `getGameObject(path)` | grimoire.Caller.as:17-20 | `JSON.stringify` of a dot-path read from live `Root.Game` |
| `getGameObjectS(path)` | grimoire.Caller.as:22-30 | same but resolved through `GameDomain.getDefinition` (static/class access) |
| `setGameObject(path, value)` | grimoire.Caller.as:32-38 | dot-path write |
| `callGameFunction(path, ...args)` | grimoire.Caller.as:52-59 | invokes a function by dot-path |
| `callGameFunction0(path)` | grimoire.Caller.as:61-68 | zero-arg variant |
| `getArrayObject` / `setArrayObject` / `selectArrayObjects` | grimoire.Caller.as:40-50, :70-87 | array-indexed read/write and projection |
| `sendClientPacket(packet, type)` | grimoire.Caller.as:118-143 | `xml`/`json`/`str` into `ExtHandler.handleMessage`; constructs `it.gotoandplay.smartfoxserver.handlers.ExtHandler` via `GameDomain` |
| `isNull(path)` | grimoire.Caller.as:106-116 | existence probe |
| `debug`, `progress`, `connection`, `modifyServers`, `getServers`, `getServers2`, `packetFromClient`, `packetFromServer`, `pext`, `currentConnDetail` | grimoire.Externalizer.as:14-17; grimoire.Root.as:113, :193, :199, :205, :218, :267, :372, :379, :383 | **SWF to host** direction |

The SWF-to-host direction matters: Grimlite learns about packets from inside the movie, not by sniffing sockets. `Root.PacketReceived` inspects `param1.params.message` and routes to `packetFromClient` or `packetFromServer` (`grimoire.Root.as:375-385`). **A bridge that is read/write but not event-driven sees stale state between reads.**

**1.3 The host side is a POSIX-incompatible ActiveX call, but the wire format is portable.** `Flash.Call` builds an XML envelope and calls `AxShockwaveFlash.CallFunction`:

```csharp
req.Append($"<invoke name=\"{function}\" returntype=\"xml\"><arguments>...");
string result = flash.CallFunction(req.ToString());          // Grimoire/Tools/Flash.cs:163-171
XElement.Parse(HttpUtility.HtmlDecode(...))                    // :209-219
```

The host also implements the `FlashCall` event handler for the reverse direction (`Grimoire/Tools/Flash.cs:79-100`, :372-471). None of this is Electron-shaped, but **the envelope is Flash's own, not Grimlite's** (see 2.3), so it transfers.

**1.4 Cross-domain permission is granted inside the movie, in code.** `Security.allowDomain("*")` appears in both Grimlite's loader and in Artix's stock loader - see 3.2. Grimlite never relies on a `crossdomain.xml` for this: movies are loaded with `Loader`, which does not consult the policy file the way `URLLoader`/socket connections do, and both movies explicitly open themselves up.

**1.5 Grimlite's own distribution.** `Loader/grimoire.swf` is a *shipped asset in the repo* (29126 bytes on master, 33112 on `jib/master`), selected by `ClientConfig.cfg`'s `flash=Loader/grimoire.swf` and injected by path in `Grimoire/UI/Root.cs:112`. Grimlite redistributes nothing remotely loaded for the bridge itself - except the game, which it still fetches from `game.aq.com` at runtime (`grimoire.Root.as:83`, :107). **This is the licence-relevant precedent: the shim is AquaStar's own code; the game stays remote.**

---

## 2. What a Flash movie can expose to the page under PPAPI in Chromium 87

### 2.1 The scriptable object, confirmed at the tag

The chain that makes `ExternalInterface.addCallback` visible as methods on the DOM element, read from Chromium 87.0.4280.141:

| Step | Source | Behaviour |
|---|---|---|
| Element asks the plugin for its scriptable object | `third_party/blink/renderer/core/html/html_plugin_element.cc` (`HTMLPlugInElement::PluginWrapper`, ~line 356-393) | returns `plugin->ScriptableObject(isolate)` |
| Container delegates to the web plugin | `third_party/blink/renderer/core/exported/web_plugin_container_impl.cc:722-737` (`ScriptableObject`) | returns `web_plugin_->V8ScriptableObject(isolate)` |
| Pepper instance builds it from the *private* interface | `content/renderer/pepper/pepper_webplugin_impl.cc:166-178` (`V8ScriptableObject`) | `instance_->GetInstanceObject(isolate)`, cached in `instance_object_` |
| That call needs `PPB_Instance_Private` | `content/renderer/pepper/pepper_plugin_instance_impl.cc:1232-1241` (`GetInstanceObject`) | `if (LoadPrivateInterface()) return plugin_private_interface_->GetInstanceObject(...)` |
| Which requires the private permission | `ppapi/shared_impl/ppapi_permissions.h:16-58`, `ppapi/proxy/interface_list.cc:268-270` | `AddPPB(PPB_INSTANCE_PRIVATE_INTERFACE_0_1, ..., PERMISSION_PRIVATE)`; Flash is granted it (`PERMISSION_PRIVATE` is in the Flash-enabled set) and the API is exported by `ppapi/c/private/ppb_instance_private.h:62-95` (`GetWindowObject`, `GetOwnerElementObject`, `ExecuteScript`) |
| Property reads and calls route through the plugin's `PPP_Class` | `content/renderer/pepper/plugin_object.cc:207-249` (`GetPropertyOrMethod`, `Call`) | `HasProperty`/`GetProperty`/`HasMethod` on the PPP class |

So "call the method on the `<object>`" is a real PPAPI feature, not an ActiveX quirk being emulated. Confirmed empirically in the shipped binary: `FlashPlayer/libpepflashplayer.so` contains `flash/platform/pepper/pep_scriptable_object.cpp` and the full Flash method table `CallFunction, FlashVersion, GetVariable, SetVariable, SetReturnValue, TCallFunction, ...` (strings in `FlashPlayer/libpepflashplayer.so`, offset ~12640600).

### 2.2 It is called as a method on the element, in JavaScript

Flash Player injects the page-side glue. Extracted verbatim from `FlashPlayer/libpepflashplayer.so` (offset ~13152900):

```javascript
function __flash__addCallback(instance, name) {
  instance[name] = function () {
    return eval(instance.CallFunction("<invoke name=\""+name+"\" returntype=\"javascript\">" + __flash__argumentsToXML(arguments,0) + "</invoke>"));
  }
}
function __flash__request(name) {
   return "<invoke name=\""+name+"\" returntype=\"javascript\">" + __flash__argumentsToXML(arguments,1) + "</invoke>";
}
```

Two consequences worth stating because they are easy to get wrong:

1. **The element is the call target** - `instance` is the `<object>`, so `document.querySelector('object').aquaGetGameObject('world.myAvatar.dataLeaf.intHP')` is literally how it works. This is also what `plugins/adventure-quest-worlds/features/charpage/print.js:58` already assumes when it probes for `document.getElementsByTagName("object")[0]`.
2. **The host's own `CallFunction` uses the same envelope.** Both directions are the same XML vocabulary, JSON-on-strings convention, and `<invoke ... returntype="xml">` shape - exactly what `Grimoire/Tools/Flash.cs:163-171` builds.

### 2.3 Argument and return encoding

Flash's injected `__flash__toXML`/`__flash__argumentsToXML` (same binary, offset ~13151663) is the encoder the page side applies automatically. Practical rules for a shim:

| Direction | Wire form |
|---|---|
| JS to SWF argument | wrapped by `__flash__toXML`: `string` -> `<string>`, `number` -> `<number>`, `boolean` -> `<true/>`/`<false/>`, array -> `<array><property id="i">`, object -> `<object><property id="k">`, null -> `<null/>` |
| SWF return value | a SWF callback returns an AS3 value; `ExternalInterface` converts it. Strings arrive as strings |
| Escaping | Flash 14+ escapes strings with JSON conventions (the binary ships that warning text): `"\n"`, `"\\"`, `"\""`. Grimlite's own `Caller.toJson` (`grimoire.Caller.as:161-289`) is a hand-rolled JSON encoder for the same reason - **return `JSON.stringify(...)` from every shim callback and parse it page-side, so the transport never has to carry structured data** |

---

## 3. Does a shim SWF have to do the loading? (the design question the ticket asks)

### 3.1 The live loader, decompiled

`https://game.aq.com/game/gamefiles/Loader4.swf?ver=b` (fetched 2026-10-17, HTTP 200, 1,671 bytes, CWS SWF version 43, one class `spiderloader.main`):

```actionscript
public function frame1() : void {
   _stage = stage;
   Security.allowDomain("*");                                             // Loader4.swf -> spiderloader.main.as:54
   Security.allowInsecureDomain("*");                                     // :55
   ...
   this.GetVersion();                                                     // :65
}
internal function LoadGame() : * {
   this.titleDomain = new ApplicationDomain();                             // :99   (NOT currentDomain)
   this.swfLoader = new Loader();                                          // :100
   this.swfRequest = new URLRequest(this.sURL + "gamefiles/" + this.gameFile + "?ver=" + _loc1_);  // :101
   this.swfLoader.load(this.swfRequest, new LoaderContext(false, ApplicationDomain.currentDomain)); // :104
}
internal function onGameComplete(param1:Event) : * {
   stage.addChildAt(MovieClip(param1.currentTarget.content), 0);            // :110
   Game = Object(param1.currentTarget.content).root;                       // :113
   for (_loc2_ in root.loaderInfo.parameters) Game.params[_loc2_] = root.loaderInfo.parameters[_loc2_];  // :114-118
   ...
   Game.titleDomain = this.titleDomain;                                    // :128
}
```

Three things fall out of this and they shape the whole design:

- **The stock loader already puts the game in `ApplicationDomain.currentDomain`** (`spiderloader.main.as:104`) and then reaches the movie's root through `Object(content).root` (`:113`). It does not need `getDefinitionByName`. So the *game* is reachable from the loader's domain by construction.
- **The version and file name are resolved at runtime** from `api/data/gameversion` (`:73`, `:78-84`; live response on 2026-10-17 was `{"sFile":"Game4000r5.swf","sVersion":"R0048",...}`). Nothing in AquaStar needs to hard-code the game file name.
- **`root.loaderInfo.parameters` is how FlashVars reach the game** (`:114-118`). A shim can therefore inject or read FlashVars by controlling what reaches the loader's `loaderInfo` - the same channel the Char Page path already relies on (`plugins/adventure-quest-worlds/features/charpage/lab/characterB-lab.html:425-437`).

### 3.2 The live game, decompiled

`Game4000r5.swf` (fetched 2026-10-17, 2,793,035 bytes CWS, 5,253,057 bytes inflated):

```
509 AS3 classes (ffdec-cli -dumpAS3)
flash.external / ExternalInterface / addCallback present            (string table offsets ~34605, ~35665-35666)
class ExternalCalls  (the game's own JS bridge class)               (dumpAS3 index 10)
class ExternalCallsWeb                                              (index 38)
```

The game does have its own JS bridge (`ExternalCalls` with `webCall`, `callJSFunction`, `getQueryString`, `setToken`, `setGameObject`, plus the Facebook methods `fbLogin`, `fbLogout`, `showFeedDialog`), but the string table shows it is a **one-way, whitelisted, Facebook/embed-oriented** facility, not a game-state API:

```
ExternalCalls / isWeb / sourceID / isFBSource / conn / webCall
ExternalCallsWeb / setGameObject / showFeedDialog / fbLogin / fbLoginWithPermissions
fbLogout / getFBUser / showIt / callJSFunction / getQueryString / setToken / setUpPayment
logQuestProgress / onQuestTrackError / onQuestTrackSecurityError / getGroup
```

```text
FBID4Security: Blocked non-whitelisted JS function call:  window.location.search.substring
```

That last string is the deciding evidence: the game ships a **whitelist and a security log for JS calls**, and its JS surface is for its own web-embed use. It is not a documented extension point, and there is no `addCallback` for `getGameObject`/`callGameFunction`/`sendClientPacket` in the game's string table. **Conclusion: AquaGrim cannot get game state by calling methods on the stock `<object>`; the callbacks have to be registered by a shim that shares the game's ApplicationDomain.** (UNVERIFIED: the exact contents of the whitelist, because FFDec exported `ExternalCalls.as` empty at 0 bytes - see section 8.)

### 3.3 What the wrapper already permits (no platform change needed to start)

`res/swf_wrapper.html` already sets every parameter the bridge needs:

| Parameter | Where | Value |
|---|---|---|
| `allowscriptaccess` | res/swf_wrapper.html:40 | `always` |
| `allownetworking` | res/swf_wrapper.html:45 | `all` |
| `base` | res/swf_wrapper.html:44 | SWF's own origin + directory, so relative loads resolve against `game.aq.com` |
| `wmode` | res/swf_wrapper.html:19, :37 | `direct` by default, per-plugin override |
| `plugins` | res/windows/config.js:38 | `true` on game/main windows |
| `sandbox` | res/windows/config.js:32 | `false` on game/main windows |
| Flash trust | res/flash.js:86-103, plugins/adventure-quest-worlds/session.js:40-47 | `nw-flash-trust` list seeded with the loader, DF loader, testing loader and the primary URL |
| Page hooks | res/instances.js:208-226 | `did-finish-load` forwards to the plugin with `executeJavaScriptSafely` and `isGameWindow` |

So `allowscriptaccess=always` is already correct, and the wrapper is the natural place to add the bridge's page side - it is the only script that ever sees the `<object>`.

### 3.4 Two gaps the bridge has to close

**Gap A - the callback surface does not exist.** `ExternalInterface.addCallback` is what creates callable methods on the element (2.2). Grimlite's whole API comes from callbacks its own SWF registers; stubbing that from the page is impossible, because the page cannot add methods to a movie it does not control.

**Gap B - the game window's preload is the capture preload.** `res/windows/config.js:34-35` gives game windows `res/features/capture/preload_capture.js`, which implements screen recording only (`preload_capture.js:1-150`, `ipcRenderer.on('record', ...)`). There is no page-side bridge object, and `host.registerBrowserPreload` (`res/platform/plugin-host.js:291-297`) applies to *browser* windows, not game windows. `docs/PLUGINS.md:386` maps `inject-scripts` to `registerNavigationHooks`, and the navigation runner is gated to non-game windows by the plugin itself (`plugins/adventure-quest-worlds/injections/navigation.js:29`: `if (ctx.isGameWindow) return;`).

**Correction to propagate:** `docs/PLUGINS.md:211`, `:235`, `docs/design/plugin-architecture.md:617` and `:862` all claim the Host refuses injection when the page host is outside `injectHostPatterns`. As of this tree that enforcement **does not exist**: `injectHostPatterns` is validated only in `res/platform/manifest-schema.js:153-157`, and no runtime module reads it (`rg -n 'injectHostPatterns' --glob '*.js'` returns only `manifest-schema.js` and one test fixture, `test/unit/plugin-host-permissions.test.js:72`). The plugin's own `if (ctx.isGameWindow) return` is what keeps injection off the game window today.

---

## 4. The recommended design: one shim SWF, loaded through the existing custom-SWF slot

### 4.1 Mechanism

```text
main process                      renderer (res/swf_wrapper.html)                 Flash
------------                      ------------------------------                  -----
wrapSwfUrl(shim.swf)   --->  <object data=.../aqua-bridge.swf>
                              |  page listens for __flash__ callbacks
                              |  (shim registers ExternalInterface.addCallback)
                              v
                           shim: Loader.load(gameLoaderUrl,
                                    new LoaderContext(false, ApplicationDomain.currentDomain))
                                                                        |
                           shim: Game = Object(content).root  <--------+
                           shim.getGameObject(path)  -> JSON.stringify
                           shim.callGameFunction(...)              (same domain -> reaches Game)
                           shim.sendClientPacket(...)  -> GameDomain.getDefinition(
                                                            "it.gotoandplay.smartfoxserver.handlers.ExtHandler")
                           shim: sfc events -> ExternalInterface.call("aquaPacket", ...)
```

Every arrow in that diagram is a mechanism verified above: the same-domain load (3.1 line 104), the root hole (3.1 line 113), the callback registration (2.2), the `ExtHandler` domain lookup (1.1), and the event direction (1.2/1.4).

### 4.2 Why this beats the alternatives

| Alternative | Why not |
|---|---|
| Call the stock `<object>` directly | The game registers no game-state callbacks (3.2) |
| Main process drives the game window over CDP | Electron 11 exposes no first-class "invoke plugin method" API; the scriptable object is a renderer-side V8 object reachable only through `executeJavaScript`, and the game window has no bridge object to call |
| Ruffle instead of PPAPI | `res/ruffle_wrapper.html:86` passes `allowScriptAccess: true` and Ruffle does expose `ExternalInterface`, but Ruffle cannot run the AQW client (render mode is the opt-in `res/const.js:197-205`, `wrapRuffleUrl` at `:135-142`), and the goal is game state from the real client |
| A second Electron process with its own Flash instance | `res/platform/helper-process.js` exists, but a second process has its own Flash instance and its own copy of the game - it cannot see the live game window's state |

### 4.3 Minimal bridge surface worth building

Start at six callbacks. Everything else in Grimlite's ~160 is derivable from these plus events, and Grimlite's own architecture proves the split works: `getGameObject`/`setGameObject`/`callGameFunction` are the generic layer, and `Player`/`World`/`Quests`/`Bank`/`Shops`/`Inventory` are conveniences written on top of it (`grimoire.game.Player.as:19-120` reads `Root.Game.world.strFrame`, `.myAvatar.dataLeaf.intHP`, `.myAvatar.objData.intGold`).

| # | Callback | Why it is in the minimum |
|---|---|---|
| 1 | `getGameObject(path):String` | The only read primitive needed. JSON string out |
| 2 | `setGameObject(path, value):void` | The write primitive |
| 3 | `callGameFunction(path, ...args):String` | Reaches anything the two above cannot (methods, not properties) |
| 4 | `isNull(path):String` | Distinguishes "absent" from "null" without throwing - Grimlite keeps it separate for exactly that reason (`grimoire.Caller.as:106-116`) |
| 5 | `sendClientPacket(packet, type):void` | Packet injection; needs the `ExtHandler` domain lookup (1.1) |
| 6 | `aquaPacket(direction, packet):void` (SWF to page) | The event half. Without it the bridge is poll-only, and Grimlite's own features (aura tracking, drop handling, map change) are driven by these events (`grimoire.Root.as:375-385`) |

State paths worth targeting first, all confirmed present in the live game's string table: `world.strFrame` (cell), `world.strPad`, `world.strMapName`, `world.myAvatar.dataLeaf` (`intHP`, `intHPMax`, `intMP`, `intState`, `intLevel`, `afk` is UNVERIFIED), `world.myAvatar.objData` (`intGold`, `iUpgDays`), `world.uoTree` (other players), `world.actions.active` (skills). **These names are read from the shipped `Game4000r5.swf` string table, not from Grimlite** - but they are also what Grimlite reads (`grimoire.game.Player.as`), so the two agree.

### 4.4 Where the shim SWF comes from

The repo already has three distinct SWF production paths; any of them can host the shim, and none needs a new toolchain:

| Path | Precedent | Fits the shim? |
|---|---|---|
| Flex `mxmlc` from `.as` | `plugins/example-companion/flash/build.bat:13-21` plus `flash/README.md:5-18` (target-player 32.0, swf-version 32, `playerglobal.swc`) | **Yes** - the shim is one small AS3 class; this is the documented path for plugin SWFs. Requires `FLEX_HOME` (not present in this tree - UNVERIFIED here) |
| FFDec import into a base SWF | `plugins/adventure-quest-worlds/features/charpage/empty-scene/build-empty-scene.ps1:23-45` (import scripts, then `-header -set version 15 ...`) | **Only for editing existing classes** - see the experiment below |
| Hand-written minimal SWF | not present in the tree | No reason to; two paths already exist |

**Local experiment (performed for this ticket):** `ffdec-cli -importScript <base.swf> <out.swf> <srcDir>` on a copy of `plugins/adventure-quest-worlds/features/charpage/empty-scene/vendor/swf2png-item-base.swf` succeeded (exit 0, 68,963-byte output) but **did not add the new class**: `Bridge`, `aquaGetGameObject`, `addCallback`, `ExternalInterface` are all absent from the output's ABC block after `-decompress`. FFDec's `-importScript` replaces scripts that exist in the base movie's class list; it is not a compiler. So the Empty Scene build works because its classes (`Main`, `Load.LoadController`, `Network.Render`, ...) already exist in `swf2png-item-base.swf`, which is a different situation from adding a brand-new bridge class.

### 4.5 Not redistributing AQW code

The shim loads the game by URL at runtime, exactly as the stock loader does (`spiderloader.main.as:73`, :101). Grimlite ships its loader asset but still fetches the game from `game.aq.com` (`grimoire.Root.as:83`, :107). Nothing in the recommended design copies, patches or redistributes Artix binaries - so the existing live-URL machinery keeps doing its job:

| Piece | File | Role |
|---|---|---|
| Live loader discovery | plugins/adventure-quest-worlds/launcher-config.js:10-116 | reads `artix.com/gamelauncher` -> `AppLaunch.js` -> `gameWindows.aqw.url`, validates, caches 24h |
| URL validation | plugins/adventure-quest-worlds/urls.js:41-70 | `LOADER_URL_RE`, `setLoaderUrl`, `isLoaderUrl` (any `Loader<N>.swf`) |
| Primary game registration | plugins/adventure-quest-worlds/main.js:76-88 | `host.setPrimaryGame({ getUrl: urls.loaderUrl(), ... })` |
| Platform override | res/customSwf.js:13-63, res/const.js:276-291 | `custom-game.swf` beats `customUrl` beats the plugin URL |

**The shim should read the loader URL from the same source the plugin already trusts**, so a Loader4 -> Loader5 move keeps working. Two ways to wire that, both already supported: the shim fetches `https://game.aq.com/game/api/data/gameversion` and composes the URL itself (what `spiderloader.main.as:73` does, and what makes the shim independent of AquaStar), or the page passes the current loader URL in as a FlashVar (simpler, and FlashVars are known to work on Chromium 87 - `characterB-lab.html:425-437`).

### 4.6 Security permissions and the trust list

| Requirement | Detail | Source |
|---|---|---|
| `allowscriptaccess=always` on the shim's own embed | Already the wrapper's default | res/swf_wrapper.html:40 |
| Flash trust entry for the shim's URL | Required: the wrapper serves the shim from `file://` via `wrapSwfUrl`, and the platform's trust list is built by the plugin's `flashTrustUrlList`; a new URL has to be added there | res/flash.js:118-130 (`refreshTrust`), plugins/adventure-quest-worlds/session.js:40-47 |
| A second `Security.allowDomain` | The shim must call `Security.allowDomain("*")` like both reference loaders do, so the page and the loaded game can talk to it | grimoire.Root.as:80; spiderloader.main.as:54-55 |
| `Loader` needs no policy file for this | The stock loader loads `game.aq.com` content from `game.aq.com` with default `checkPolicyFile=false` (`spiderloader.main.as:104`); AquaStar's own Empty Scene loader sets `checkPolicyFile = false` and `allowCodeImport = true` explicitly | plugins/adventure-quest-worlds/features/charpage/empty-scene/scripts/Load/LoadController.as:26-30 |
| The AQW `crossdomain.xml` is not sufficient on its own | Fetched 2026-10-17: `site-control permitted-cross-domain-policies="master-only"`, listing `www.aq.com`, `game.aq.com`, `*.aqworlds.com`, `*.aq.com` - **no wildcard**, so a `file://` wrapper is not covered by it. The `Security.allowDomain("*")` calls inside the movies are what make the arrangement work | https://game.aq.com/crossdomain.xml |

---

## 5. Failure modes and how they land

| Failure | Likelihood | Effect | Mitigation |
|---|---|---|---|
| Artix moves Loader4 -> Loader5 | Already happened once (Loader3 -> Loader4, per plugins/adventure-quest-worlds/urls.js:17-19) | Shim stops if it hard-codes the URL | Read the live URL as in 4.5; `launcher-config.js` already validates and caches it |
| Game SWF internals change (`world.myAvatar.dataLeaf.*`) | Routine, every content patch | Named-path callbacks return `null`/throw | The generic `getGameObject`/`isNull` pair degrades safely; keep convenience paths out of the minimum (4.3). `Game4000r5.swf` was `R0048" - versioned, not stable-API |
| Another loader layer appears | Possible - AquaStar already ships `Loader_Spider.swf` as a testing variant (plugins/adventure-quest-worlds/urls.js:20) | The shim must nest through whatever the entry point does | The shim should mirror Grimlite (own the single load) rather than assume a fixed depth: read `api/data/gameversion` itself |
| The game ends up **not** in the shim's domain | Low but fatal if it happens | Every callback returns errors | The stock loader already targets `ApplicationDomain.currentDomain` (`spiderloader.main.as:104`); the shim's job is simply not to override it. If Artix changed this, the shim would have to load the *game file* itself instead of the loader |
| FlashVars do not reach the game | Low - two working precedents | Login/session params missing | Follow `characterB-lab.html:425-437`: pass both the `flashvars` attribute and the query string |
| PPAPI Flash is dropped (Electron 12+) | Not now | Bridge dies with the game | Documented constraint (AGENTS.md "Critical constraints"); Ruffle is the migration path and exposes `ExternalInterface` differently (UNVERIFIED here) |

### 5.1 ToS and ban risk

This is the sharpest caveat and it is a policy judgement, not a technical one.

The read side (1, 2, 3, 4 in 4.3) observes state the client already has. The write side is asymmetric:

| Capability | Risk | Note |
|---|---|---|
| `getGameObject`, `isNull`, `aquaPacket` | Low | Local reads and local events |
| `setGameObject` on display/UI fields | Low | Same class of thing as the existing UI injections |
| `callGameFunction` on gameplay functions | Medium | This is what Grimlite's bot commands call (`Flash.CallGameFunction` -> `Root.Game.*`); it is automation of the game client |
| `sendClientPacket` | **Highest** | Grimlite's own source carries the warning at Grimoire/Tools/Flash.cs:52: *"Be careful when using this method. Incorrect use of this method may cause you to be kicked (or banned, although very unlikely)."* The packet layer is also where Grimlite's ban-adjacent features live (the `iUpg = 10`, `iUpgDays = 999` member spoof at Grimoire/Tools/Flash.cs:288-289) |

**Recommendation:** build the shim with callbacks 1-4 and the event channel. Treat `sendClientPacket` (5) as a separate, explicitly-gated decision, and do not ship the server-list rewrite or member spoof in any form. This keeps the bridge to "read and observe what the client already knows", which is the same scope as AquaStar's existing screenshots and Char Page capture.

---

## 6. Open questions the proof ticket should answer

| # | Question | How to settle it |
|---|---|---|
| 1 | Does `ExternalInterface.addCallback` produce a callable method on the `<object>` under this exact PPAPI build? | Load the shim in the wrapper, `executeJavaScriptSafely` a call to `document.querySelector('object').aquaGetGameObject('world.strFrame')` and read the reply |
| 2 | Is the page-side `instance` the `<object>` and not an inner `<embed>`? | Same call, tried against both `object` and `embed` |
| 3 | Do the game's classes actually resolve in the shim's domain? | `getGameObjectS("...ExtHandler")` or the `ExtHandler` construction in `sendClientPacket` |
| 4 | What exactly is in `ExternalCalls`' whitelist? | Re-export with a raised `decompilationTimeout` (see 8) or read `WebCall`-adjacent ABC methods |
| 5 | Does `wmode=direct` interfere with the page-side scriptable object? | Compare `wrapSwfUrl` default against `{wmode:'opaque'}` (the Char Page screenshots already use the direct path) |
| 6 | Does the game still see FlashVars when the shim, not the game, was embedded with them? | Pass a marker var through the shim and read it from a `getGameObject` callback |

---

## 7. What AquaGrim has today, mapped to what the bridge needs

| Bridge need | Today | Change required |
|---|---|---|
| `allowscriptaccess=always` | res/swf_wrapper.html:40 | none |
| `allownetworking=all` | res/swf_wrapper.html:45 | none |
| Plugins enabled, no sandbox on game windows | res/windows/config.js:32, :38 | none |
| SWF substitution point | res/customSwf.js:13-63, res/const.js:276-291, manifest `customSwfAliases` | none, but the shim needs its own trust entry |
| Live loader URL | plugins/adventure-quest-worlds/launcher-config.js:10-116, urls.js:41-70 | none |
| Page-side control of the game window | res/instances.js:208-226 forwards `did-finish-load` only; the plugin's hook returns early for game windows (injections/navigation.js:29) | **Yes** - either lift that early return for this case, or put the page side in the wrapper |
| A page-side API object in the game window | res/windows/config.js:34-35 gives game windows the capture preload only | **Yes** - a bridge preload, or wrapper-resident code |
| A callable method on the element | none exists | **Yes** - this is the shim SWF |
| Event stream from the movie | none | **Yes** - `ExternalInterface.call` from the shim (1.2) |
| A supported way for a plugin to ask the platform for game state | none | Later; see [#8](https://github.com/plicey/AquGrim/issues/8) |

---

## 8. Verification commands and limitations

Everything below was run on 2026-10-17 in this worktree. Paths with no prefix are this repo; `/tmp/grimlite-full`, `/tmp/grimlite-probe-2`, `/tmp/ffdec`, `/tmp/ch87_*` are scratch.

```bash
# Grimlite loader -> ActionScript (the four load-bearing claims in section 1)
python3 -c "import zlib;d=open('/tmp/grimlite-full/Loader/grimoire.swf','rb').read();open('/tmp/grimoire_uncompressed.swf','wb').write(d[:8]+zlib.decompress(d[8:]))"
/tmp/ffdec/jdk-17.0.20.1+1-jre/bin/java -jar /tmp/ffdec/app/ffdec-cli.jar -export script /tmp/ffdec/out /tmp/grimlite-full/Loader/grimoire.swf
# -> 14/14 scripts; Caller.as, Externalizer.as, Root.as, game/*.as

# jib-akbr's newer loader, for currency
cd /tmp/grimlite-probe-2 && git show jib/master:Loader/grimoire.swf > /tmp/jibswf/grimoire-jib.swf   # 33,112 bytes, diff -stat vs master

# Live AQW loader and game, decompiled
curl -s -o /tmp/Loader4.swf 'https://game.aq.com/game/gamefiles/Loader4.swf?ver=b'                  # 1,671 bytes
curl -s -o /tmp/Game4000r5.swf 'https://game.aq.com/game/gamefiles/Game4000r5.swf?ver=R0048'        # 2,793,035 bytes
/tmp/ffdec/.../ffdec-cli.jar -export script /tmp/ffdec/out4 /tmp/Loader4.swf                        # spiderloader.main.as
/tmp/ffdec/.../ffdec-cli.jar -dumpAS3 /tmp/Game4000r5.swf > /tmp/game_as3_dump.txt                  # 509 classes, ExternalCalls at index 10

# Chromium 87 sources at the tag Electron 11.5.0 pins
curl -s 'https://chromium.googlesource.com/chromium/src/+/refs/tags/87.0.4280.141/content/renderer/pepper/pepper_webplugin_impl.cc?format=TEXT' | base64 -d
# plus html_plugin_element.cc, web_plugin_container_impl.cc, pepper_plugin_instance_impl.cc,
#      plugin_object.cc, interface_list.cc, ppapi_permissions.h, ppapi/c/private/ppb_instance_private.h
curl -s https://raw.githubusercontent.com/electron/electron/v11.5.0/DEPS | grep -A2 chromium_version   # -> 87.0.4280.141

# Flash Player's injected page-side glue, from the shipped binary
python3 - <<'EOF'
import re
d=open('FlashPlayer/libpepflashplayer.so','rb').read()
print(sorted(set(m.group(0).decode() for m in re.finditer(rb'__flash__[A-Za-z]+', d))))
EOF
# -> ['__flash__addCallback','__flash__argumentsToXML','__flash__arrayToXML','__flash__escapeXML',
#     '__flash__objectToXML','__flash__removeCallback','__flash__request','__flash__toXML']
```

**Known limitations, stated rather than papered over:**

| Limitation | Impact |
|---|---|
| FFDec `-export script` produced an **empty (0-byte) `ExternalCalls.as`** for the game SWF at a 60s per-method timeout | The game's JS whitelist contents are **UNVERIFIED**; the class's existence, name, and neighbouring strings are verified |
| No Flex SDK (`mxmlc`, `playerglobal.swc`) in this container | The Flex build path is documented in-repo (`plugins/example-companion/flash/README.md:5-18`) but was **not executed** here; the FFDec path was executed and is shown not to compile new classes |
| No Electron/Flash runtime was launched | Every claim about runtime behaviour is from source (Chromium, Flash binary, AS3) - the browser-level mechanism is proven from source, the **end-to-end call is not**; that is the proof ticket's job |
| `world.myAvatar.dataLeaf.afk` | Not found in the game string table by exact match; Grimlite reads it (`grimoire.game.Player.as:91-94`) - **UNVERIFIED** |
| Ruffle's `ExternalInterface` semantics under `res/ruffle_wrapper.html` | Not investigated; out of scope for this ticket |
| Grimlite's `Grimoire/FlashTools/*` layer | Confirmed dead code by the sibling file-formats doc and not re-checked here |
