# Does the AQW client run when its game files come from a local origin?

Ticket: [#15](https://github.com/plicey/AquGrim/issues/15) - wayfinder research. The AFK (no-login) half.

**Verdict: yes for everything up to the account login, and the login screen renders from a local origin with no errors and zero 404s. The client POSTs its credentials to `api/login/now` through the local origin, and the real upstream answers it (a wrong password produces the real "username not found" message). The one thing still unproven is unchanged and needs an account: that the client's socket connect goes to the local relay after a successful login. In every run here the relay saw no connections, because no run ever got past credential validation.**

| Field | Value |
|-------|-------|
| **Environment** | Electron 11.5.0 (Chromium 87.0.4280.141), bundled `FlashPlayer/libpepflashplayer.so` (34.0.0.137), Linux x64 |
| **Date** | 2026-10-18 |
| **Artifacts** | `docs/research/local-origin/` (gateway, harness, relay, selftest, runner). Scratch; nothing here ships. |
| **Evidence** | `evidence-1-login-screen-from-local-origin.png`, `evidence-2-login-post-reaches-upstream.png`, `evidence-3-auth-spinner-with-get-only-gateway.png` |

## 1. What was built

The smallest thing that answers the question: a Node HTTP gateway that serves the game's own paths from `http://127.0.0.1:<port>` and proxies anything it does not have to `game.aq.com`, plus an Electron harness that loads `Loader4.swf` from that origin with PPAPI Flash and logs every request, console line and screenshot. Everything below was produced by running them; nothing is read from source alone.

Three pieces, because the spike needed to observe rather than just serve:

- `gateway.js` - mirrors `game.aq.com`'s paths (`/game/...`, `/proxy/content/...`, `/proxy/account/...`), serves `/wrapper.html` from the same origin as the SWF, serves a local `/crossdomain.xml`, follows upstream 3xx server-side so the client never leaves `127.0.0.1`, and logs every request with its status. It also has a `/__servers` route and an opt-in `--rewrite=<port>` that serves the server list with `sIP`/`iPort` substituted (the #3 rewrite, for the login half).
- `relay.js` - the #3 local TCP relay, extracted so it can be tested without Electron: answers `<policy-file-request/>` on the socket with a NUL-terminated policy and forwards everything else to a real AQW server, logging both directions.
- `harness.js` - Electron side: PPAPI Flash registration (same switches as `res/flash.js`), `nw-flash-trust` list, creates the game window (`plugins: true`, `sandbox: false`), logs `webRequest` traffic, console messages, page errors, and takes screenshots. Uses its own `userData` under `/var/tmp/aq-origin` so the real profile is untouched.
- `drive-probe.js` - drives the window over the DevTools protocol (no `xdotool` on this machine) to type into the login boxes and press Login. Used to find out what the login flow asks for without an account.

## 2. The boot, and what the client asks for

One run, `--synth=0` (pure passthrough; every byte came from the live upstream), loader requested at 0.28s, login screen up, four screenshots at 10s/21s/31s/41s, all four byte-identical:

| # | Request from the client | Status | Bytes |
|---|-------------------------|--------|-------|
| 1 | `/wrapper.html?swf=...%2Fgame%2Fgamefiles%2FLoader4.swf%3Fver%3Db` | 200 | 2358 |
| 2 | `/game/gamefiles/Loader4.swf?ver=b` | 200 | 1671 |
| 3 | `/game/api/data/gameversion?ver=0.95` | 200 | 98 |
| 4 | `/game/gamefiles/Game4000r5.swf?ver=R0048` | 200 | 2793035 |
| 5 | `/game/gamefiles/title/Generic2.swf?v=5.21` | 200 | 170976 |

That is the complete list. Five requests, no 404s, no request to any host other than `127.0.0.1`. The loader asks for `gameversion` with a cache-busting random and then builds the game SWF URL from the `sFile` it gets back, so the gateway does not need to know the revision - it just has to mirror the directory. `gameversion` also names the title art, which is the `title/Generic2.swf` request.

Two follow-on requests are safe for the same reason but were not exercised here: `api/data/clientvars` and `api/data/booklore` are on the client's own URL list (the SWF's string table carries `content.aq.api/data/clientvars?v=` beside the bank-data loader a few screens in) and would hit the same path-preserving route. `api/data/serversext` is **dead upstream**: it 302s to `/game/api/w3c/error.asp?aspxerrorpath=/game/api/data/serversext`, which is a 404 HTML error page, so a client that asks for it logs a failure regardless of the gateway.

The one thing that was not obvious from the outside: `api/data/gameversion` is **flaky upstream**. Repeated `curl` probes minutes apart answered `200 {"sFile":"Game4000r5.swf",...}`, `302 Object moved`, and `404`. That is why the gateway has `--synth`: with it on, a 404 for exactly that path is replaced with the body captured from a 200 response, so a run is reproducible when the endpoint is having a bad minute. Both modes were run. **The no-synth run is the one that proves the boot**, and it rendered the login screen.

## 3. The login screen renders, with no errors

From the `--synth=0` run, the 41s screenshot: `evidence-1-login-screen-from-local-origin.png`. Username and password fields, the Save checkboxes, the Login button, the Facebook button, "Create a free Account", the "Forgot your password?" and "Manage your account" links, the New Release banner and the hero artwork behind the panel. Every asset in that image came from `127.0.0.1`.

The client reported nothing at all:

- `pageErrors: []`
- exactly one console line in the whole run, the stock Electron "Insecure Content-Security-Policy" warning about the wrapper page (not about Flash, and not about the origin)
- no `did-fail-load`, no `plugin-crashed`, no `render-process-gone`, no `webRequest` error
- the SWF's own page-side `error` and `IOErrorEvent` paths never fired; the loader's `onGameError` and `failed:` strings never appeared

So the client does not validate its own origin in any way that stops it booting, and the loader's version check, game SWF load and title load all survive being served from loopback. That settles "does it boot normally".

## 4. The login POST, and where the runs stop

Runs were driven with deliberately wrong credentials (`drive-probe.js`, DevTools protocol mouse and key events into the boxes). This is where the useful constraints showed up, and where the run stops being able to prove the socket half.

**The client POSTs credentials to the gateway origin.** With a GET-only gateway the request was refused:

[gw] 501 POST /game/api/login/now?ran=0.22840831113439442 | gateway only proxies GET
[ 20.37s] WEBRES 501 http://127.0.0.1:8500/game/api/login/now?ran=0.22840831113439442

and the client sat on "Authenticating Account Info..." with a Cancel button and a spinner indefinitely (`evidence-3-auth-spinner-with-get-only-gateway.png`). It does not time out into a visible error, it just hangs. That is a gateway bug found by running it, not by reading it.

**With the POST proxied, the real upstream answered.** Gateway log entry for the same step:

{"method": "POST", "path": "/game/api/login/now?ran=0.6535482069726792", "status": 200, "bodyBytes": 48, "bytes": 103}

The client then rendered the real rejection, "The username you typed was not found. Please check your spelling and try again." (`evidence-2-login-post-reaches-upstream.png`). A direct `curl` with the same shape returns `{"bSuccess":0,"sMsg":"What? Try again."}` - so this is the real account API, reached through the local origin, with the credential POST passing through the gateway intact and the client's own error handling for it working.

**Where it stops.** No run reached the server list, so no run reached the socket. After a rejected login the client never asks for `api/data/servers` - across every run here that request is absent from both the gateway log and the `webRequest` log, and the relay logged zero connections (`relay: []`) in all of them. The client asks for the list, then connects, **after** the account API accepts the credentials. The SWF's string table shows the order the client itself logs: `[Game] server list refreshed`, `[Game] ERR server list refresh failed`, `[Game] ERR server list refresh IO:`, and the connect step comes after.

So the #3 gap is provably not reachable without an account: **the socket connect cannot be reached at all with wrong credentials.** That is the finding, and it narrows exactly what the human step has to observe.

## 5. What is proven, and what is not

| Claim | State |
|-------|-------|
| The AQW client boots from `http://127.0.0.1` with PPAPI Flash and renders the login screen normally | **Proven.** Screenshot, five 200s, no page errors, synthesis off |
| No origin validation, no blocked asset load, no CSP or plugin rejection for a local origin | **Proven** for everything up to login: zero errors of any kind |
| The exact set of files the client needs from the gateway | **Proven:** loader, `api/data/gameversion`, the game SWF it names, the title SWF it names. No 404s |
| The login POST crosses the local origin and the upstream answers it normally | **Proven:** the real rejection message rendered from a real upstream response |
| The client connects to the local relay (the socket rewrite) | **UNPROVEN.** Needs valid credentials. No run got past validation, so the relay saw no connections. Same open item #3 left |
| Whether `api/data/servers` is fetched and what the rewritten list looks like to the client | **UNPROVEN** for the same reason. The rewrite is mechanically verified (below), not client-verified |
| Same-origin bridge loading (#7) from a local-origin page | **UNPROVEN** - not attempted here; serving page and SWF from one origin is now known to be the easy part |

The #3 rewrite is mechanically verified without the client, through the harness itself: with the documented human command, `curl http://127.0.0.1:8488/game/api/data/servers` returned all 13 live entries with `sIP: 127.0.0.1` and `iPort: 8489` (the relay's port), and `--steer=0` leaves them genuine. So the list the client receives on a human run already points at the relay; what is unproven is only whether the client, holding that list, opens the socket.

## 6. Run it

    # offline checks first: relay policy handshake + gateway routes, no Electron, no account
    node docs/research/local-origin/selftest.js

    # boot the client from the local origin, headless, with a 90s window and screenshots
    bash docs/research/local-origin/run.sh --wait=90000 --shots=9

    # same, on a display a human can watch and type into (relay steering is on when
    # --relay is passed; --steer=0 keeps the real server list)
    bash docs/research/local-origin/run.sh --on-display=:0 --wait=600000 --shots=20 --gw=8488 --relay=8489

Output lands in `/var/tmp/aq-origin/run/`: `harness.log`, `gateway.jsonl` (one JSON object per request), `summary.json` (web requests, console, page errors, relay traffic, shot paths), `shotN.png`. The gateway also answers `/__status` (JSON counters plus the full request log), `/__control?synth=1|0` and `/__control?pause=1|0` to flip behaviour on a live run, and `/__reset` to clear the log.

Flags: `--gw=<port>`, `--relay=<port>`, `--relay-target=host:port`, `--wait=<ms>`, `--shots=<n>`, `--synth=0`, `--steer=0`, `--swf=<path>`, `--wmode=direct|opaque`, `--no-gpu`, `--out=<dir>`, `--on-display=:0`.

Steering is on by default in the harness: the client's own `api/data/servers` response already points at the relay. Pass `--steer=0` for a run that should see the real server list (the "does the client boot normally" question, which sections 2 and 3 were produced with).

## 7. Steps only a human with an account can do

This is login-and-report, not build-and-debug. Step 4 is the only step that can produce the missing evidence.

1. Run `node docs/research/local-origin/selftest.js`. All checks must pass. If any fail, stop - the relay or gateway is broken, not the game.
2. Run `bash docs/research/local-origin/run.sh --on-display=:0 --wait=600000 --shots=20 --gw=8488 --relay=8489`. A window opens showing the AQW login screen: hero artwork, Username and Password fields, a Login button. If it shows an error page or a black window, stop and send `/var/tmp/aq-origin/run/harness.log`.
3. Type a real account's username and password and click Login. Expect the "Authenticating Account Info" progress screen, then either the character list or the game.
4. **Watch the relay log while the client logs in.** In another terminal: `tail -f /var/tmp/aq-origin/run/harness.log | grep RELAY`. The line to look for is `RELAY connect | 127.0.0.1:<port>`, and right after it the client's own policy request:

       [  45.21s] RELAY connect | 127.0.0.1:53412
       [  45.23s] RELAY C->S-policy-request | <policy-file-request/>
       [  45.23s] RELAY S->C-policy | <cross-domain-policy><allow-access-from domain='*' to-ports='*'/>
       [  45.24s] RELAY C->S-game-traffic-opens-upstream | <msg t='sys'><body action='verChk' r='0'><ver v='166'/></body></msg>
       [  45.68s] RELAY S->C 74b | <msg t='sys'><body action='apiOK' r='0'></body></msg>

   That first `RELAY connect` line is the answer to ticket #15's second half. If it appears, the client connected to loopback. If the client reaches a character or a map with **no** `RELAY connect` line, the client ignored the rewritten list - the equal-and-opposite finding, and #8's design has to change. Either way, capture `harness.log`, `gateway.jsonl` and `summary.json`.
5. Check `curl -s http://127.0.0.1:8488/__status | head -c 400`. A login attempt adds a `POST /game/api/login/now` entry to `entries` and bumps the `200` counter; the relay connection log is the `relay` array in `summary.json`.
6. If chat or the character view fails but the socket connected, filter the gateway log by status: a `404` on a path under `/game/` is a file or API the gateway does not know to serve - the interesting kind of failure, because it names the missing route. Successfully proxied traffic shows `200`.
7. Quit the window (or Ctrl+C the runner): the harness writes `summary.json` and closes the relay and gateway. Send that file plus `harness.log`.

## 8. Honest limits of this spike

- **Scratch code.** Not wired into the app, not covered by `npm test`, not linted by the repo's config. `selftest.js` is the only automated check and it is deliberately offline.
- **Ports are ad hoc** (8488 gateway, 8489 relay by default) and there is no port allocation: two concurrent runs collide. The harness reports the collision rather than silently half-working.
- **The gateway has no origin check on its listeners.** Anything on this machine can `GET http://127.0.0.1:8488/game/...`, and anything can connect to the relay on 127.0.0.1. The only intentional narrowing is that the relay's policy hardcodes `domain='*'`, which is exactly as permissive as it sounds; a real implementation would narrow it and bind nothing but loopback. `res/socketProxy.js`'s `Origin` check does not apply here because the gateway is plain HTTP and its client is a plugin, not a web page.
- **The gateway is a pass-through for credentials**, so `harness.log` and `gateway.jsonl` sit next to real login traffic during a human run. It logs method, path, status and byte counts only - never the request body - and `selftest.js` asserts the log does not contain a credential body. Nothing else is written.
- **`--synth` is a workaround, not fidelity.** It replaces a 404 from a flaky upstream endpoint with a captured body; the run that proves the boot was the no-synth one, but a future run against a broken `gameversion` needs it or will show a loader error that is upstream's fault, not the gateway's.
- **3xx responses are followed server-side**, which suits this spike because the goal is that the client never leaves `127.0.0.1`. The app can only `redirectURL` a request; it cannot edit a response and cannot follow a redirect for Flash, so #8's real implementation has to decide where that difference matters.
- **Not tested:** Ruffle's path, the `.aq.com` UA policy, the ad-block rules, and same-origin `ApplicationDomain` loading (#7) from this origin. The last is the follow-up that would turn this gateway into #8's bridge host.

## 9. Addendum: the fake-login probe (AFK, 2026-10-18)

Edited the scratch gateway and harness to answer `/game/api/login/now` with a synthetic success
(`--fake-login=1`, `--fake-login-body=<file>`), so the post-login flow can be driven without an
account. Driven over the DevTools protocol (`--debug-port`).

**Result: the account gate is passable, and the client reaches a screen no earlier run could.**

| Step | Outcome |
|------|---------|
| `POST /game/api/login/now` answered `{"bSuccess":1,...}` through the local origin | Accepted. The client stops showing the rejection and moves on. |
| Client renders **Select a Server** ("aqspike, please select a server.") | Reached, reproducibly, with a 347-byte synthetic body |
| Client requests `api/data/servers` | **No.** Four runs, no request, with either the minimal or the full 16-field response |
| Relay connection | **No.** Still zero, so #15's second half stays unproven |

**What this narrows.** The socket connect is not blocked by the login *step* alone - a synthetic
success passes it - it is blocked by whatever the client does between accepting `bSuccess` and
fetching the server list. The server screen it renders is a placeholder ("Galanoth", FULL, red
crossed-out icon, "999,999 Players Adventuring Now") that appears without any list request, so the
client is waiting on something the fake response does not carry. Whether that is a token field, a
later call in the same response, or a GET the client only issues for a real session is the next
question, and it is answerable the same way: extend `fake-login-body` and re-run.

**Files.** `gateway.js` (`--fake-login`, `--fake-login-body`, `/__control?fakeLogin=1`) and
`harness.js` (`--fake-login`, `--fake-login-body`, `--debug-port`) are changed; `selftest.js`
still passes. The probe is deliberately opt-in and never on for a real run.


## 10. RESOLVED: the socket half, proven with a real login (2026-10-18)

A human run with a real account settled both open questions, and the answer overturns the earlier
assumption about where to steer.

### The client never fetches `api/data/servers`

| Evidence | Value |
|----------|-------|
| Requests for `/servers` in the logged-in run | **zero** (gateway log and `webRequest`, 198 requests total) |
| The login response | `POST /game/api/login/now` -> **2372 bytes** of real upstream JSON |
| What the client rendered | the live list (Twilly 632, Twig 256, Artix 1500 ...), matching the live upstream figures |
| Where it dialled | `172.16.0.2:50040 -> 172.65.204.220:5591` - **the real Sepulchure server**, not the relay |
| Relay connections | **zero** |

So the server list arrives **inside the login response**, and the client dials the address it finds
there. The `--steer` rewrite of `/game/api/data/servers` was steering a path this client never
takes - which is also why the earlier fake-login run showed a placeholder list: a synthetic response
with no server rows leaves it with nothing to dial.

### The proof, with the fix

`steerLoginBody()` rewrites every `{sIP, iPort}` row anywhere in the login response. Driving the
fake-login probe with one row `{sIP:'127.0.0.1', iPort:8589}` produced:

- the client rendered **"SPIKE-TEST - 1 Players Adventuring Now"** as a real selectable server, and
- clicking it made the client dial the relay:

```text
[47.92s] RELAY connect | 127.0.0.1:44922
[47.92s] RELAY C->S-policy-request | <policy-file-request/>
[47.92s] RELAY S->C-policy | <cross-domain-policy><allow-access-from domain='*' to-ports='*'/></cross-domain-policy>
[47.94s] RELAY connect | 127.0.0.1:44936
[47.94s] RELAY C->S-game-traffic-opens-upstream | <msg t='sys'><body action='verChk' r='0'><ver v='157' /></body></msg>
[48.06s] RELAY upstream-open | sock7.aq.com:5593
[48.51s] RELAY S->C 54b | <msg t='sys'><body action='apiOK' r='0'></body></msg>
[48.51s] RELAY C->S 166b | <msg t='sys'><body action='login' r='0'><login z='zone_master'>...
```

The full handshake runs through loopback: policy request, `verChk`, `apiOK`, then the client's own
SmartFox `login` frame. **Ticket #15 is proven** - the client connects to the relay and real game
traffic flows through it.

### Consequences for the map

- **#3's proxy is real.** The interception point is the login response body, not a server-list
  endpoint. The relay's 40 lines already handle this traffic (8 frames, 315 bytes, on the first try).
- **#8's bridge plan holds.** The game SWF is served same-origin from `127.0.0.1`, so #7's
  `ApplicationDomain` sharing applies as designed; nothing here needs cross-origin access.
- The credential exposure `grimlite-proxy.md` section 6 warns about is confirmed in the traffic:
  the `login` frame carries the password in cleartext (`<pword><![CDATA[...]]></pword>`).

`selftest.js` now covers the steering (`gateway steers server rows inside a login response`), using
`--upstream=` to run against a stub instead of the live API.

