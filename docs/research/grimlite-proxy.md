# Can AquaGrim intercept the game's socket traffic?

Ticket: [#3](https://github.com/plicey/AquGrim/issues/3) - wayfinder research.

**Verdict: yes on the Flash path, and the hard part is not the interception - it is getting the client to 127.0.0.1 and keeping it there. The reference implementation the ticket describes is stale: on Grimlite-Li master the TCP listener is dead code and packet interception runs through a patched SWF plus ExternalInterface, not a local TCP proxy. The proxy design is real, but it lives in Proxy_Backup.cs, which is not compiled into the shipped binary.**

Three things below are proven by a live run rather than read from source:

1. PPAPI Flash's own HTTP requests are visible to `session.webRequest.onBeforeRequest`, and a `redirectURL` result is honoured by the plugin. Tested with Electron 11.5.0 and the bundled `FlashPlayer/libpepflashplayer.so`, loading `res/swf_wrapper.html`.
2. The AQW servers answer `<policy-file-request/>` **on the game port itself**, with `allow-access-from domain='*' to-ports='*'`. Port 843 is dead on all three host names.
3. A ~40-line Node TCP relay on 127.0.0.1, serving that same policy locally, completes a real round trip to `sock7.aq.com:5593` - see the spike below.

---

## 1. What the reference actually does

The ticket describes `Grimoire/Networking/Proxy.cs` + `Handlers/HandlerPolicy.cs` + the `iPort` injection in `Grimoire/Tools/Flash.cs`. On `Froztt13/Grimlite-Li@816d9cd` only the third of those is on the live path.

| Piece | State at `816d9cd` | Evidence |
|-------|--------------------|----------|
| `TcpListener` on loopback | Present, never started | `Grimoire/Networking/Proxy.cs:69`; the only start call is commented out at `Grimoire/UI/Root.cs:111` |
| `ListenerPort` | Assigned a free port that nothing listens on | `Grimoire/Program.cs:27` and `FindAvailablePort` in the same file |
| `Proxy_Backup.cs` - the working proxy (policy rewrite, dual pump, NUL frame splitter) | Not compiled | no `Proxy_Backup` entry in `Grimoire.csproj`; the project lists files explicitly (`Grimoire.csproj:455` includes `Networking\Proxy.cs`) |
| `HandlerPolicy.cs` (rewrites `to-ports` in a relayed policy) | Compiled but never registered | `Grimoire.csproj:445`; the only registration is commented out at `Grimoire/Networking/Proxy.cs:290` |
| `iPort`/`sIP` injection | Live in `ModifyServerList`, reachable only from `modifyServers` and `getServers` - and the shipped SWF never sends `modifyServers` | `Grimoire/Tools/Flash.cs:305-306`, `:91-92`, `:421-422`; the `Loader/grimoire.swf` string table has `getServers`/`getServers2` and zero occurrences of `modify` |
| Real packet interception | SWF to host `ExternalInterface` calls | `Grimoire/UI/Root.cs:297-298`; `Flash.cs:451-461` handles `packetFromClient`/`packetFromServer` and **replaces** `args[0]` with the processed packet |
| Outbound injection | Back through the SWF, not through a socket | `Proxy.SendToServer` to `Flash.SendPacket` to `sfc.sendString` (`Grimoire/Networking/Proxy.cs:240`); `SendToClient` to `Flash.Call('sendClientPacket', ...)` (`Proxy.cs:253`, `Flash.cs:63-66`) |

So the sniffer, spammer and tamperer on master work because the client runs a **modified loader**. `Loader/grimoire.swf` is a CWS SWF whose string table contains `packetFromClient`, `packetFromServer`, `sendClientPacket`, `callGameFunction`, `RealAddress` and `RealPort`; that loader hands every packet to the host and sends back whatever the host returns. The 36 files under `Grimoire/Networking/Handlers/` are registered dynamically at runtime (for example `Proxy.Instance.RegisterHandler(handler)` at `Grimoire/Tools/Flash.cs:522`); the static lists at `Proxy.cs:268-292` are mostly commented out.

The TCP proxy design the ticket describes is real, just one generation back:

- `Grimoire/Networking/Proxy_Backup.cs:175-192` - on the first connection, read the client's `<policy-file-request/>`, connect upstream, forward it, take the policy back, rewrite it (`ModifyDomainPolicy`, lines 199-205), send it to the client, close, and accept a fresh connection.
- `Proxy_Backup.cs:203` sets `allow-access-from/@to-ports` to the local listener port so the client may open the **second** connection back to the same local port.
- `Proxy_Backup.cs:164,177` recover the real destination through `Flash.Call<string>('RealAddress')` and `Flash.Call<int>('RealPort')` - the values written into the server list at `Flash.cs:304-305` just before `sIP` becomes `127.0.0.1`.
- `Grimoire/GameProxy/CaptureProxy.cs` is the same idea, used by the Packet Interceptor window: a listener on a fixed 5588 (`CaptureProxy.cs:22,44`), destination from the server dropdown, then `Player.Logout()` to `AutoRelogin.Login(user, pass)` to `Flash.Call('ConnectTo', '127.0.0.1')` (`Grimoire/UI/PacketInterceptor.cs:81-85`). It drives the client to loopback through the SWF's own `ConnectTo`, not through the server list.

The consequence for AquaGrim: the server-list rewrite is the only door available, because AquaGrim has no patched SWF and cannot produce one. That is exactly the question the ticket asks.

## 2. What AquaGrim already has

| Capability | Where | Usable here? |
|------------|-------|--------------|
| Cancel or redirect an HTTP request | `res/platform/session-rules.js:105-112` | Yes - this is the server-list rewrite |
| Local WebSocket-to-TCP relay with host allowlist | `res/socketProxy.js` (`allowHosts` :17, `isAllowedHost` :25, `start` :36, port 8191 at :11) | Not for PPAPI Flash - it speaks **WebSocket**, Flash's `Socket`/`XMLSocket` speak raw TCP |
| Relay startup | `res/instances.js:76-82`, only when `renderMode === 'ruffe'` and the plugin declared `wrap.ruffle.socket` | Ruffle path only |
| Precise socket targets | `plugins/adventure-quest-worlds/ruffle.js:6-20` (`serversApi`, `fallbackHosts`, `policyPort`, `allowedHosts`) | Yes, already declared |
| Same config plumbed to the page | `res/ruffle_wrapper.html:31-35,60,93` | Ruffle only |
| Flash embed with networking on | `res/swf_wrapper.html:45` (`allownetworking: all`), `:40` (`allowscriptaccess: always`) | Already correct |
| User-supplied SWF | `res/customSwf.js` (`custom-game.swf`) | Relevant to the security section |

The gap is a **TCP** listener. Nothing in the platform binds loopback and speaks raw TCP except `res/platform/helper-process.js` (the `spawn-helper-process` path used by Char Page Studio) or a plugin requiring `net` directly - bundled plugins are plain CommonJS with full Node, as `docs/PLUGINS.md` states in its mental-model section.

## 3. Rewriting the server list

The list to rewrite is `https://game.aq.com/game/api/data/servers`. Live on 2026-10-17 it returned 13 entries:

| `sIP` | `iPort` values |
|-------|----------------|
| `sock7.aq.com` | 5588, 5589, 5591, 5592, 5593, 5594 |
| `sock8.aq.com` | 5588, 5589, 5590, 5591, 5593 |
| `euro.aqw.artix.com` | 5588 |
| `asia.game.artix.com` | 5588 |

`plugins/adventure-quest-worlds/ruffle.js:11-14` already records the same host/port pairs as fallbacks, so the plugin already knows this set.

**Proven: PPAPI Flash's traffic goes through the session rules and a redirect is obeyed.** With Electron 11.5.0, the bundled `libpepflashplayer.so` (reported as 34.0.0.137), `no-sandbox`, and `res/swf_wrapper.html?swf=Loader4.swf`, a rule returning `{redirectURL: 'http://127.0.0.1:8482/gameversion'}` for `api/data/gameversion` produced this log:

```
[T] REDIRECT gameversion -> local
[T] LOCAL HTTP /gameversion
[T] LOCAL HTTP /crossdomain.xml     <- Flash then asked for a URL policy file
[T] requests seen by webRequest: 21 (Loader4.swf, api/data/gameversion, Game4000r5.swf, title/Generic2.swf, ...)
```

The loader consumed the redirected body and went on to load the game SWF, so the redirect survived the plugin's own HTTP stack. Note the `/crossdomain.xml` hit: a cross-origin redirect makes Flash check a **URL** policy file on the new host, so the local HTTP responder must serve one. `allow-access-from domain='*' to-ports='*'` was enough for the loader to continue.

That is the good news about the list, and it is only half the story. The game fetches the list itself - the Game4000r5 string table carries `api/data/serversext` and `api/data/servers` beside `[Game] server list refreshed` - and then logs `[Game] serial connecting to: <sIP>:<iPort>`.

**Not proven: that the game SWF, given a rewritten list, opens its socket to the local port.** Reaching that state needs a logged-in account, which this run did not have; the probe stopped at the account login page. Treat the end-to-end step as **UNVERIFIED**. It is the first thing a spike should confirm, and the reference's own escape hatch (`Flash.Call('ConnectTo', '127.0.0.1')`, `Grimoire/UI/PacketInterceptor.cs:85`) is not available to an unpatched SWF.

One design consequence follows from the reference. With `sIP` rewritten to 127.0.0.1, something must remember the real target, because an unpatched SWF will not be told `RealAddress`/`RealPort` - `Flash.cs:304-305` is what injects those attributes, and the patched loader reads them back at `Proxy_Backup.cs:164`. Two options: give each server entry its own local port and key the target off the accepted port, or keep an upstream table and pick the entry on first connect. Grimlite does the latter, and it only works because it controls the SWF.

## 4. What the client then requires

All of this follows from Adobe's socket documentation plus live probes of the AQW servers.

**The policy handshake.** Adobe's ActionScript 3 developer guide (Loading data, Connecting to sockets) says Flash Player looks for a socket policy file on port 843 and on the same port as the main socket connection. The search order is: check port 843 for a master policy; if one exists, check whether its meta-policy forbids serving policy from the target port and whether it carries a matching `allow-access-from`; otherwise ask the target port. The `Socket` class reference is blunt about the requirement: in Flash Player 9.0.124.0 and later a socket policy file is required for **any** socket connection, including a connection to the same host that served the SWF.

Live probes of the three host names:

| Target | Result |
|--------|--------|
| `sock7.aq.com:843`, `sock8.aq.com:843`, `euro.aqw.artix.com:843` | TCP connects, then EOF with no bytes - there is no master policy to inherit |
| `sock7.aq.com:5593`, `sock8.aq.com:5588`, `euro.aqw.artix.com:5588` with `<policy-file-request/>` + NUL | `<cross-domain-policy><allow-access-from domain='*' to-ports='*' /></cross-domain-policy>` + NUL |

The game is authorised by a policy served from the **game port**, not from 843. That is exactly the case `Proxy_Backup.cs:175-192` handles, and the reason `policyPort: 843` in `plugins/adventure-quest-worlds/ruffle.js:17` is not the port that matters.

**What the local policy must say.** Adobe, same page: a socket policy file has the same syntax as a URL policy file except that it must also specify the ports to which it grants access, in a `to-ports` attribute. And: when served from a port below 1024 it may grant access to any ports, but from port 1024 or higher it may grant access **only to ports 1024 and higher**.

| Requirement | Detail |
|-------------|--------|
| Shape | XML terminated by a **NUL byte**: `<cross-domain-policy><allow-access-from domain='<origin>' to-ports='<port>' /></cross-domain-policy>` + NUL |
| Port | The listener must be on a port at or above 1024, otherwise a same-port policy cannot grant access to itself |
| What changes | Only the `to-ports` value. The upstream policy grants `'*'`, which is useless once the target is 127.0.0.1. Both `Grimoire/Networking/Handlers/HandlerPolicy.cs:20` and `Proxy_Backup.cs:203` make exactly that one edit |
| Connection lifetime | Adobe: do not reuse one connection for a policy request and a main connection; close after sending the policy, or Flash will close it. My live probe found the real server doing the **opposite**, serving the policy then continuing on the same socket for `verChk`. A proxy must tolerate both: answer the policy, and only treat the socket as a game connection if more frames follow |
| `domain=` | `'*'` authorises every SWF on the machine. The game runs from `game.aq.com`, so `domain='game.aq.com'` is the narrow value |

Whether a local `file://` custom SWF (`res/customSwf.js`) can use sockets at all is **UNVERIFIED**; Adobe states that content in the local-with-filesystem sandbox cannot use sockets, and only the trust list in `res/flash.js:110-124` decides which side of that line an override lands on.

**URLLoader policy checks and allowNetworking.** The loader and the game both use `URLLoader` (both string tables). Those are ordinary HTTP requests, so they pass through `res/platform/session-rules.js` like anything else - that is the proven part above. `allownetworking` is already `all` in `res/swf_wrapper.html:45`, so no change is needed. The notable interaction runs the other way: a redirect to 127.0.0.1 makes the SWF cross an origin boundary, so Flash asks for a URL policy file at the new host, which is the `/crossdomain.xml` request in the probe.

## 5. Framing and mutation

Framing is **NUL-delimited, not length-prefixed**. Live against `sock7.aq.com:5593`:

| Framing sent | Response |
|--------------|----------|
| `<msg ...>` + NUL | `<msg t='sys'><body action='apiOK' r='0'></body></msg>` + NUL |
| 2-byte big-endian length prefix + body | empty; the socket sat until timeout |
| 4-byte big-endian length prefix + body | empty; the socket sat until timeout |

This matches both reference readers: `Grimoire/Networking/GrimoireClient.cs:156-170` accumulates until byte 0, then decodes UTF-8 and raises `MessageReceived`, and `CaptureProxy.cs` uses `if (b > 0) cpacket.Add(b)` with the NUL as the terminator in its else branch. Both also re-append the NUL before writing (`GrimoireClient.cs:83-94`), so a proxy must strip and re-add it.

Three packet families, dispatched on the first byte (`Grimoire/Networking/Proxy.cs:213-233`, the `CreateMessage` splitter behind the type switch at `:179`, and the same shape in the SWF's `ProcessPacket`):

| Family | First byte | Command extraction | Example commands in the reference |
|--------|-----------|--------------------|-----------------------------------|
| XT | `%` | `Split('%')[2]`, or `[3]`/`[5]` when the middle token is `zm`/`cmd` (`XtMessage.cs`) | `uotls`, `chatm`, `warning`, `server`, `tfer`, `pi` |
| JSON | `{` | `b.o.cmd` (`JsonMessage.cs`) | `getQuests`, `loadShop`, `dropItem`, `ccqr` |
| XML | `<` | `body/@action`, or the literal `policy` when the text contains `cross-domain-policy` (`XmlMessage.cs`) | SFS system traffic: `verChk`, `login`, `policy` |

Events that must be visible in **both** directions for a useful layer:

- up: the `verChk`/`login` handshake, then `moveToCell`, `getMapItem`, `gar`, `acceptQuest`, `updateQuest`, `cmd` (`Flash.cs:481-547`, `ProcessPacketFromClient`)
- down: SFS system replies, `loginResponse` (`Grimoire/Networking/Handlers/HandlerLogin.cs:17`), `uotls`, `ct`, `addItems`, `dropItem`, `warning`, `server`, `resTimed` (`Flash.cs:550` onwards, plus the handler command table across `Grimoire/Networking/Handlers/`)

**Mutation is in-place string surgery** in the reference: `XtMessage.ToString()` re-joins the `%`-split array, `XmlMessage.ToString()` returns `Body.OuterXml`, `JsonMessage.ToString()` re-serialises compact JSON. A Node version can do the same on the raw string, with one caveat: the JSON reference re-parses and re-serialises through `JObject`, so key order and number formatting after a rewrite become the implementation's problem.

**Rate is a non-issue.** A local Node relay forwarding NUL-terminated frames moved **100,000 frames in 308 ms** (about 325k frames/s) with **0.28 ms** of added loopback round-trip latency, using the same `net` module and per-frame split loop `res/socketProxy.js` already uses. The game ticks in tens of milliseconds. For scale, direct `verChk` round trips to `sock7.aq.com` measured 420-437 ms from this machine, so the network dominates the relay by three orders of magnitude.

## 6. Auth and session behaviour

**Credentials cross the wire in cleartext.** The Game4000r5 string table contains the SFS login template `<login z='...'><nick><![CDATA[...]]></nick><pword><![CDATA[...]]></pword></login>`. A local relay therefore sees the account password. This is the largest security consideration in the whole design.

**The client tolerates reconnects.** The loader exposes `OnConnectionLost`, `OnConnection`, `IsTemporarilyKicked`, `FixLogin`, `ResetServers`, `AreServersLoaded` and `Connect` (grimoire loader string table), the host side of that flow is `Grimoire/Tools/AutoRelogin.cs:13-35`, and the host reacts at `Grimoire/Tools/Flash.cs:400-409` by returning to char select.

**A dropped proxy can move the client off the proxy rather than failing.** The game SWF implements the SmartFox BlueBox HTTP-polling fallback: `CONNECTION_MODE_HTTP`, `blueBoxIpAddress`, `blueBoxPort`, `BlueBox/HttpBox.do`, `tryBlueBoxConnection`, and the log line `Socket connection failed. Trying BlueBox`. A server-list rewrite changes `sIP`/`iPort` only and does not touch `blueBoxIpAddress`, so a proxy that drops the socket may push the client into an unproxied transport instead of erroring. Design around it: refuse to start rather than half-work, or rewrite the BlueBox config too.

**The reference relogs the client around the switch** rather than splicing a live connection (`Grimoire/UI/PacketInterceptor.cs:83-85`: logout, login, `ConnectTo('127.0.0.1')`). The same advice holds here: engage the proxy on the next connect, not mid-session.

## 7. Security: who else can reach the listener

The listener is on loopback and carries credentials, so the threat is any other local process **and any web page the user has open**, which can reach 127.0.0.1 freely; the same-origin policy does not stop a fetch or WebSocket to loopback.

Two lessons from code already in this repo:

1. **`res/socketProxy.js` denies by default and says why** (`socketProxy.js:5-10`: it listens on localhost, so without the allowlist any local web page could use it to reach arbitrary TCP endpoints). The allowlist matches exact hosts or `*.suffix`, and unmatched hosts are closed with code 1008 (`:44-51`). `test/unit/socket-proxy.test.js` locks this in, including the `aq.com.evil.example` and `evilaq.com` cases.
2. **It does not check the caller's origin.** The connection handler reads only `host` and `port` from the query string (`:40-42`) and never inspects `Origin` or `Referer`. With `allowedHosts: ['*.aq.com','*.artix.com']`, any local web page can open `ws://127.0.0.1:8191/?host=sock7.aq.com&port=5593` and tunnel TCP to AQW. The allowlist bounds where a caller can go, not who may ask. Worth flagging separately from this ticket, because under Ruffle it is the only gate.

For a Flash-facing TCP listener the gate is the policy file, and it is weaker than an allowlist:

| Policy served | Who can connect |
|---------------|-----------------|
| `domain='*'` | Every SWF on the machine in any Flash-enabled browser, plus any other local Flash app |
| `domain='game.aq.com'` | Only SWFs whose origin is `game.aq.com`, which in practice means the real game |
| served from a port at or above 1024 | Can only grant access to ports at or above 1024 (Adobe), which bounds where the connection may land |

Note the asymmetry: anything that speaks raw TCP - a Python script, netcat - ignores the policy file entirely, because the policy only constrains Flash. So the policy is not a local access control. The practical controls are to serve the narrowest `domain` that works, bind one loopback address, keep the target allowlist in the platform using the existing `allowedHosts` pattern, and never log or buffer credentials.

## The smallest proxy spike

This is the run that produced the evidence in sections 3 to 5, trimmed to the minimum that proves one real packet round trip. It listens on 127.0.0.1, answers the policy locally the way the game server does, and relays everything else to a real AQW server. Node, no dependencies, shaped like `res/socketProxy.js`.

```js
// spike: 127.0.0.1:<port> -> sock7.aq.com:5593, both directions visible, policy served locally
const net = require('net');
const TARGET = { host: 'sock7.aq.com', port: 5593 };
const TARGET_PORT = '5593';   // the port the list entry claimed; needed by to-ports
const POLICY = "<cross-domain-policy><allow-access-from domain='game.aq.com' to-ports='" +
    TARGET_PORT + "'/></cross-domain-policy>\0";

net.createServer((client) => {
    let up = null, upBuf = Buffer.alloc(0), clBuf = Buffer.alloc(0);
    const drain = (buf, cb) => { let i; while ((i = buf.indexOf(0)) !== -1) { cb(buf.slice(0, i).toString()); buf = buf.slice(i + 1); } return buf; };
    const openUp = () => {
        if (up) return;
        up = net.createConnection({ host: TARGET.host, port: TARGET.port, noDelay: true });
        up.on('data', (d) => { client.write(d); upBuf = drain(Buffer.concat([upBuf, d]), (m) => console.log('S->C', m)); });
        up.on('error', () => client.destroy());
        up.on('close', () => client.destroy());
    };
    client.on('data', (d) => {
        clBuf = Buffer.concat([clBuf, d]);
        if (clBuf.slice(0, 21).toString().startsWith('<policy-file-request')) {
            client.write(POLICY); client.end();   // Flash reopens a fresh connection after this
            return;
        }
        openUp();
        clBuf = drain(clBuf, (m) => console.log('C->S', m));
        up.write(d);
    });
    client.on('close', () => up && up.destroy());
    client.on('error', () => up && up.destroy());
}).listen(8192, '127.0.0.1');
```

Observed output when driven with the policy request followed by a `verChk` frame:

```
C->S "<policy-file-request/>"
S->C "<cross-domain-policy><allow-access-from domain='game.aq.com' to-ports='5593'/>..."
C->S "<msg t='sys'><body action='verChk' r='0'><ver v='166' /></body></msg>"
S->C "<msg t='sys'><body action='apiOK' r='0'></body></msg>"
```

Two deliberate simplifications, both of the `shortcut:` kind: the policy is served even on a connection that later carries game frames (the real server does this, while Adobe documents closing - handle both), and `to-ports` is hardcoded to the claimed port rather than the listener's own port. A real implementation replaces both with the listener's port and a target table.

What the spike does **not** include is the one remaining unknown: driving the real client to this listener through a rewritten `api/data/servers`. Change `TARGET_PORT` to the listener port, rewrite `sIP` to `127.0.0.1` and `iPort` to `8192` in the list, and watch for the `C->S` policy line. That single line is the proof the whole design turns on.

## The same layer under Ruffle

Ruffle removes the policy problem and adds a plumbing problem, and most of the plumbing already exists.

- **No policy handshake.** Both bundled Ruffle cores (`res/ruffle/172de42e6619eac8f371.wasm` and `878d548199cddef07035.wasm`) contain **zero** occurrences of `policy-file-request`, `cross-domain-policy` or `to-ports`, even though they implement both socket stacks (`ruffle_core::avm1::globals::xml_socket`, `ruffle_core::avm2::globals::flash::net::socket`). There is nothing to answer.
- **The relay is a WebSocket-to-TCP bridge and it is already wired.** Ruffle routes sockets through `addSocketProxy(host, port, proxyUrl)`; the wasm's failure strings are `Missing WebSocket proxy for host` and `Failed to create WebSocket, reason`. `res/instances.js:76-82` starts `res/socketProxy.js` when `renderMode === 'ruffe'`, and `res/ruffle_wrapper.html:48-70` builds the mapping from the plugin's `wrap.ruffle.socket` config, fetching `serversApi` and registering every `(sIP, iPort)` pair at `:60`.
- **So on the Ruffle path there is nothing to intercept.** The server list is already the source of truth: AQW's targets are pre-registered from `https://game.aq.com/game/api/data/servers`, and a host that is not registered cannot be dialled at all. That is a stronger position than the Flash path, where the client must first be steered to loopback.
- **Framing is identical.** Ruffle implements `Socket`/`XMLSocket` and passes bytes through untouched, so the NUL-delimited framing of section 5 is unchanged and the interception layer works with no modification.
- **`policyPort: 843` in the plugin config is inert under Ruffle.** `res/ruffle_wrapper.html:35` adds it to every host's port set, so the relay will connect to `sock7.aq.com:843` happily, but Ruffle never performs the handshake. Harmless today, not load-bearing.
- **The blocker is SWF patching.** Grimlite's richest hooks (`packetFromClient`/`packetFromServer`) need a modified SWF. Ruffle runs the game bytecode as-is and exposes no bytecode-patching API, and nothing in this repo patches SWFs either. A Ruffle-side layer is limited to what a proxy can do from outside - read, mutate, re-frame - which is what section 5 describes, minus the host-side privileged calls the reference enjoys.
- **Ruffle is opt-in per launch.** `res/instances.js:76` wraps the SWF only when render mode is Ruffle and the entry is eligible, so with `renderMode: 'flash'` this whole path is dormant and `socketProxy.start()` is never reached.

| | PPAPI Flash | Ruffle |
|---|---|---|
| Transport | raw TCP from the plugin | WebSocket to `res/socketProxy.js` (`ws://127.0.0.1:8191`) |
| Policy file | required, served on the target port; 843 is dead upstream | not implemented at all |
| Steering the client to loopback | rewrite `api/data/servers` through `redirectURL` | already done from `serversApi` into `socketProxy[]`, deny by default |
| Extra config needed | a TCP listener, a policy responder, a target table | `wrap.ruffle.socket`, already present in `plugins/adventure-quest-worlds/ruffle.js` |
| Highest-value hooks | proxy-visible only, no SWF patching | proxy-visible only |

## What could not be determined

- **UNVERIFIED** - that the game SWF actually opens its socket to a rewritten 127.0.0.1 entry. Needs a logged-in account; the probe stopped at the login page. The whole design hangs on this one step.
- **UNVERIFIED** - whether session or protocol level interception can replace the list response in place instead of by redirect. An `interceptBufferProtocol('https', ...)` probe registered after `app.whenReady()` intercepted nothing (`intercepted=0`), which may mean the scheme was already claimed rather than that it cannot work. `redirectURL` is the proven path.
- **UNVERIFIED** - whether a local `file://` custom SWF (`res/customSwf.js`) can use sockets under the Flash trust list in `res/flash.js:110-124`.
- **UNVERIFIED** - the BlueBox fallback's exact trigger conditions. The strings and the `Socket connection failed. Trying BlueBox` path are in the game SWF, but which failures engage it, and whether `blueBoxPort` still has a live endpoint, were not exercised.
- **UNVERIFIED** - whether the game uses `flash.net.Socket` or `XMLSocket`. The SWF string table has no `XMLSocket` but carries `Socket`, `byteBuffer`, `socketChunk`, `writeToSocket` and `handleSocketData`, which points at the binary `Socket` (SmartFox 1.x). Adobe's policy rules apply to both, so the design does not depend on the answer.
- **Outside this ticket** - `res/socketProxy.js` performs no `Origin` check on incoming WebSocket connections, so any local web page can tunnel to `*.aq.com`/`*.artix.com` while a Ruffle session is running. Flagged because it is the same class of exposure this ticket is about.

