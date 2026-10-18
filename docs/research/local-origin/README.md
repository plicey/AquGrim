# Local-origin spike artifacts

Throwaway sources for the spike recorded in [../grimlite-local-origin.md](../grimlite-local-origin.md)
(ticket [#15](https://github.com/plicey/AquaGrim/issues/15)). Not wired into the app; nothing here ships.

| File | Role |
|------|------|
| `gateway.js` | Serves the game's paths from `http://127.0.0.1:<port>` and proxies the rest to `game.aq.com`. Logs every request. Routes: `/__status`, `/__control`, `/__servers`, `/__reset`, `/crossdomain.xml`. |
| `harness.js` | Electron 11.5.0 harness: PPAPI Flash, Flash trust list, own `userData`, webRequest/console/page-error capture, screenshots. |
| `relay.js` | Local TCP relay: answers Flash's policy request, forwards NUL-framed traffic to a real AQW server, logs both directions. |
| `wrapper.html` | Page-side wrapper for the object tag, served from the gateway origin so page and SWF share one origin. |
| `preload.js` | Forwards page errors to the harness log. |
| `selftest.js` | Offline checks for the relay handshake and the gateway routes. No Electron, no account. |
| `run.sh` | One boot: starts Xvfb if needed, runs the harness, tees the log. |
| `drive-probe.js` | Drives the window over the DevTools protocol (no `xdotool` here). Used to probe the login POST; not needed for a manual run. |

## Run it

    node docs/research/local-origin/selftest.js                # offline, all checks must pass
    bash docs/research/local-origin/run.sh --wait=90000 --shots=9        # headless boot
    bash docs/research/local-origin/run.sh --on-display=:0 --wait=600000 --shots=20 --gw=8488 --relay=8489

Output in `/var/tmp/aq-origin/run/`: `harness.log`, `gateway.jsonl`, `summary.json`, `shotN.png`.
Flags: `--gw=<port>` `--relay=<port>` `--relay-target=host:port` `--wait=<ms>` `--shots=<n>`
`--synth=0` `--steer=0` `--swf=<path>` `--wmode=direct|opaque` `--no-gpu` `--out=<dir>`.

`--wait` and `--shots` exist for the human run: the login step needs the window to stay open and
several screenshots to show what happened. `--steer=0` keeps the real server list, for when the question
is "does the client boot normally" rather than "does it connect to loopback".

## The relay, in one line

Flash asks `<policy-file-request/>` on the game port; the relay answers with a NUL-terminated
`<cross-domain-policy>` and then keeps the socket, so the client's next frame (`verChk`) opens the
real upstream and both directions are logged. That is the `RELAY connect` line the human run looks for.
