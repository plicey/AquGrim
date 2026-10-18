# Grilling rounds for #9, #10 and #11

Draft for the human. Nothing below is answered: each item is a question plus the answer that is meant to be accepted with a plain “yes”. Round 1 items are meant to be answered in one sitting; round 2 items are recorded but must not be asked until the question they depend on is answered.

Sources: `docs/research/grimlite-capabilities.md`, `grimlite-ui-surface.md`, `grimlite-file-formats.md`, `grimlite-proxy.md`, `grimlite-bridge-spike.md` (all on `research/grimlite-parity`), plus the tickets #1, #9, #10, #11.

How the claims below were checked, so the reader knows what is second-hand and what is not:

- The reference clone the research documents read (`/tmp/grimlite-full`, a working tree at `816d9cd` with local edits) **did not exist on this machine**. Rather than quote the research documents second-hand, I fetched upstream as a tarball (no git command was run) into `/var/tmp/aq-origin/ref/`. `Grimoire/Program.cs` there reads `Li 1.9.3b` / `10-10-2026` - the same version and date the research documents record - so it is the same code minus the uncommitted edits. Findings re-read against that tree are marked **(re-checked)**.
- One re-checked finding **corrects** the research rather than confirming it: `CmdBlank3`. It is called out in 10.1.
- Everything not marked **(re-checked)** is the research document's finding, cited by document and section rather than re-verified here.

Verification commands, if someone wants to re-run them: a `.gbot` census over `Resources/Bots/**` (60 files, 1,687 command occurrences, 61 distinct leaves); `JSON.parse` over the five Maid configs under `Resources/Bots/Ultra Boss/Eclipse/Maid/` and `Resources/Plugins/Maid/Default.json`; `diff` between `HandlerTaunterChampionDrakath.cs` and `HandlerAutoZoneUltraDage.cs`; and reads of `Bot.cs`, `CmdBlank.cs`, `CmdIndex.cs`, `CmdRestart.cs`, `HandlerAutoZone*.cs`, `HandlerUltraSpeakerMechanics.cs`, `MaidRemake.cs` and `BotManager.cs`.

One structural note for whoever applies this: the reference source I read has **no** `HandlerAutoZoneAstralEmpyreanP2.cs` - `HandlerAutoZoneAstralEmpyreanP2` is a second class inside `HandlerAutoZoneAstralEmpyreanP1.cs` (line 178), and the special-handler combo still offers it as a separate entry. So the 'seven auto-zone handlers' of 11.1 are seven entries and six files.

---

## #9 — Parity matrix: port, adapt, or drop for every Grimlite feature

The report's four explicit axes (hotkey map, .dll plugin API, chrome placement, Windows-only mechanisms) turn out not to be the hard ones. One finding subsumes them: `grimlite-capabilities.md` §3 measures that 100 of the 146 call names exist **only** in Grimlite's own `Loader/grimoire.swf` and not in the game SWF, so every option toggle and the whole skill surface sit behind the client-origin proof (task #15) rather than behind a design choice. The questions below are the rows where a human has to call it.

### Round 1

**9.1 Credentials and auto-relogin.** AquaGrim stores no AQW credentials today. Auto-relogin needs the account password in a form the client can use, and a bridge SWF reads it from the movie when asked. Which contract?

- (a) **Session memory only** — the password is kept in the main process while the app runs, passed to the bridge when it is needed, never written to disk, and cleared on quit. Auto-relogin works, nothing is at rest. (recommended)
- (b) **At rest, encrypted** — stored per account through Electron `safeStorage` (libsecret on Linux), with a plain statement in Settings that the password is stored and how to delete it.
- (c) **Out** — no auto-relogin and no other feature that needs the password.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` §2.6 has row “Session credentials and user id” behind `GetUsername`/`GetPassword`, `AutoRelogin.Login(user, pass)` is the caller (§2.8), and the same doc's §5 warns the reference “keeps the account password in the client”. `grimlite-file-formats.md` §9: Grimlite's own `CharSelect.cfg` is plaintext `username,password`, and “AquaGrim stores no AQW credentials and must not inherit this”. `grimlite-proxy.md` §6: the SFS `<login>` template carries the password in cleartext and calls this “the largest security consideration in the whole design” — so on the proxy path the password is visible to the relay no matter which option is chosen.
**Depends on:** nothing to answer, but (a) is only implementable once task #15 proves the client runs from a local origin.

**9.2 The ban-risk line, drawn once.**

- (a) **Port only what the server cannot distinguish from normal play** (attack, skills, rest, join / jump / walk, drops, bank, shop, quests, inventory, cosmetics) and **drop what changes what the server sees** (infinite range, provoke, respawn provoke, enemy magnet, walk speed, `SetSkillCooldown`/`SetSkillRange`/`SetSkillMana`, buff, ghost accept, fake `updateQuest`, `genderSwap`, `setAchievement`, the Doom Vault B shortcut, buy-back over HTTP). (recommended)
- (b) Port the second list too, each behind its own risk confirmation.

**Recommended:** (a). This one answer settles 9.4, 9.5, 9.7, the round-2 drops below (9.13 to 9.16) and the first slice of #10, and it is the sentence the parity matrix is supposed to record.
**Evidence:** `grimlite-capabilities.md` §5 is a ranked list of exactly these capabilities with sources: infinite range “Classic detectable advantage” (`OptionsManager.cs:157`), provoke “Changes combat AI in a server-visible way” (`OptionsManager.cs:159,184-186`), walk speed “Movement is normally server-validated” (`:169`), skill stats “Direct combat-stat manipulation” (`Player.cs:285,290,295`).

**9.3 Split the options toggles.** The report asks for one verdict per toggle. Grouping them by mechanism is the smallest honest answer:

- (a) **Ship as plain client options:** lag killer, skip cutscenes, disable animations, FPS cap and the member/moderator/non-member client controls — these change nothing the server can see. **Ship behind a risk note:** hide players, which calls `DestroyPlayers` *and* filters the server's own user-data packets. **Drop:** infinite range, provoke, respawn provoke, enemy magnet, walk speed. (recommended)
- (b) Ship every toggle behind one “risky” switch, with the note printed once.
- (c) Ship only the plain ones and omit the toggle group entirely.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` §2.7 rates lag killer and skip cutscenes “mild”, hide players “mild” but implemented as “DestroyPlayers, plus XT `retrieveUserData(s)` filtering” (`HandlerPlayers.cs:18-25`), and disables animations is dead code (“body is commented out”). `grimlite-ui-surface.md` §6 records where these live in the UI (`Root.cs` Options menu plus BotManager's Options and Client tabs).

**9.4 The skill-set surface — keep it small or keep it whole.** In the reference this is four groups on one tab (`grimlite-ui-surface.md` §2.2): a Skill Set builder, an ordered Skill List with delay and a “targeted” flag, a Size/Timing group that *rewrites* skill cooldowns and ranges, and an Auto Attack loop with per-class combos. It is the same surface that 9.2 decides, seen from the UI.

- (a) Keep the Skill Set builder (named, ordered, with per-skill safe gates) and the Auto Attack loop; leave out the Timing group entirely, because it is the `SetSkillCooldown`/`SetSkillRange` path. (recommended)
- (b) Drop the whole combat-skill surface and keep only Maid's skill list.
- (c) Keep all four groups.

**Recommended:** (a). Note for whoever writes the matrix: what is left is one window, not four.
**Evidence:** `grimlite-ui-surface.md` §2.2: Skill Set (`txtSkillSet`, `btnAddSkillSet`, `btnUseSkillSet`), Skill List (`numSkill`, `btnAddSkill`, `btnAddSafe`, `numSkillD`, `chkUseSkillTargeted`), Size/Timing, and Auto Attack with `SpecialClassCombo` for three classes (`Root.cs:1638-1663`). `grimlite-capabilities.md` §2.1 names the calls behind each: `SetSkillCooldown`/`SetSkillRange`/`SetSkillMana` are “ban-prone”.

**9.5 Chat, notices and the rest of the Client tab.** `CmdLog` can push lines into the game's own chat (`chatF.pushMsg`), and the same tab carries account-level writes (name, colour, access level, gender) plus the Map Spoofer.

- (a) Keep the local log window; do not write into the game's chat, because a bot that talks in chat is visibly a bot; drop the account-level writes and the spoofer. (recommended)
- (b) Keep the chat push as a logging convenience, keep the identity controls.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` §2.6, row “Own chat lines and local notices” (`callGameFunction2("chatF.pushMsg", ...)`, `CmdClientMessage.cs:51-53`). `grimlite-ui-surface.md` §2.9 lists the identity controls, the Map Spoofer and the access-level buttons in the same region.

**9.6 The DPS meter.** The parser exists but is not registered, and its window ships hidden.

- (a) Leave it out. (recommended)
- (b) Port it as an experimental, off-by-default panel fed by the combat packet.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` §2.7, row “DPS readout from combat packets”: “not registered; logging only”, and it is absent from the registrations at `Proxy.cs:269`. `grimlite-ui-surface.md` §1.1: the DPS Meter entry is `Visible? no` (`Root.cs:889`).

**9.7 Packet tools and the packet commands: three levels.**

- (a) Smallest set: **logger** in read-only mode plus **tamperer** behind a warning, both in a developer section; no **spammer**. Consequence to accept: `.gbot` files that contain `CmdPacket` (56 occurrences in the shipped corpus) or `CmdBackgroundPacket` cannot run those commands — the editor shows them as unsupported (10.4) rather than dropping them silently. (recommended)
- (b) Logger and tamperer only; also drop the spammer *and* leave the packet commands list frozen at “not supported”.
- (c) Keep the spammer too.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` §2.8, row “Packet spammer (list of packets, fixed delay)” is “`Proxy.SendToServer` in a loop” (`Spammer.cs:28-54`), and §5 flags server-visible rate patterns and puts `CmdPacket` (“the bot format is a packet injector by design”) in the same class. `grimlite-file-formats.md` §2 measures `CmdPacket` at 56 occurrences — second only to the control-flow commands among non-label commands — so this decision materially changes what the shipped corpus can run. A second, narrower signal in the same direction: the packet-logger window carries its own inline spammer row (`grimlite-ui-surface.md` §3), so the tool ships in two places.

**9.8 The identity, appearance and cosmetic surface.** One mechanism (client-side appearance overrides) covers the cosmetics window, the `SetEquip` path, the `genderSwap` packet and the member-flag bypass, so it needs one verdict rather than four.

- (a) Keep **cosmetic overrides** (what the user sees on their own screen — weapons, armour, pets, ground) and drop **social identity** (name, guild tag, name colour, access level, gender), the **Map Spoofer** and the **member-flag bypass** together, as one answer. (recommended)
- (b) Keep the social half behind a warning; drop the map spoofer and the member bypass.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` §5, rows “Name, guild, colour, access level, gender and SetEquip spoofing” and “Member-flag bypass” (and §2.2 for the spoofer, which rewrites `world.strAreaName`). **(re-checked, correcting the draft)** the shipped tree contains **no** `.gset` files at all — the `Sets/` directory is created on demand by the app and is empty in a clean clone — so nothing that ships today depends on cosmetics being ported; the reference's `Resources/Bots/**` is 60 `.gbot` files plus the five Maid configs. Dropping the social half therefore costs no shipped artefact.

**9.9 Windows that ship unreachable or unfinished.** Port, rebuild, or drop?

- (a) Rebuild the ones that still make sense — the raw and per-command editors, the shop/quest/monster grabbers with their XML dump, the fast-travel buttons, the command-colour and eye-dropper tools, and the Swf Dev Test call console (useful precisely because the bridge is new and undocumented). Drop **Packet Interceptor** and **PvP** (they drive the packet and skill-stat paths that 9.2 and 9.7 drop), the **Command Node Editor**, the **CEF BrowserForm** and its Discord button (dead code), and the **AutoBuyBack** buy-back path. (recommended)
- (b) Drop everything that ships hidden or empty, including the dev console.

**Recommended:** (a).
**Evidence:** `grimlite-ui-surface.md` §1.1 marks Sets, Change Server, DPS Meter, NodeEditor, PvP and Packet Interceptor `Visible? no`; §3 marks BrowserForm dead (“the single call site is commented out”). `grimlite-capabilities.md` §6.2: `ConnectTo` (Packet Interceptor) is in neither SWF's string table, i.e. UNVERIFIED as a real function. `grimlite-file-formats.md` §6: `CmdEquipSet` joins the path as `Application.StartupPath + ItemName` with no separator, which is why Sets move and break.

**9.10 The hotkey map.** Grimlite ships no hotkeys by default; the parity item is the *action* vocabulary, not a key list.

- (a) Keep single-key per-plugin keybinds exactly as AquaGrim has them, do **not** import the launcher-skin, panel and access-level toggles, and add new bindings only where the SWF eats the key before the app sees it. (recommended)
- (b) Import every action from the reference, including the skin toggle and the panel toggles.

**Recommended:** (a).
**Evidence:** `grimlite-ui-surface.md` §4.1–4.3: nothing ships by default, the picker allows single keys only, and the action list carries the skin toggle and the panel toggles. **(re-checked)** the reference keyboard hook is a `WH_KEYBOARD_LL` low-level hook (`Tools/KeyboardHook.cs`), which is the Windows-only mechanism the ticket asks about; Electron's equivalent is `globalShortcut`, and this repo already keeps the keys Flash would swallow there (F2 screenshot, Ctrl+J record; `res/const.js` `originalKeybinds`), with the plugin contributing its own single-key defaults (`plugins/adventure-quest-worlds/keybinds.js`).

**9.11 Where the client chrome lands.** Grimlite draws its menu bar, a 27 px toolbar and a char-select dropdown inside the game window.

- (a) A **separate window** that owns all of it, shown by a **checkable** Game-menu item, so the game window can be hidden or closed while a bot runs; the in-game dropdown keeps the console, screenshot, fullscreen and recording only. (recommended)
- (b) The same toolbar overlaid inside the game window.
- (c) Separate window but not toggleable.

**Recommended:** (a). Consequences to state in the answer: chrome in a separate window needs the game window to stay alive when it is not shown, and the client-side kill switch is Ctrl+F5, so no new “stop everything” key is needed.
**Evidence:** `grimlite-ui-surface.md` §1.2 (the 27 px toolbar: Start Bot, Auto Attack, cell and pad combos, refresh-cell, Bank), §1.4 (char-select), §1.5 (launcher skin), §10 (this repo's in-game menu is the plugin's Game menu plus AquaStar and Tools). The visible surface in the game window is `docs/FLASH_CHECKLIST.md`'s business — keep it unchanged.

**9.12 The .dll plugin API, and the first-run statement.** Grimlite loads `.NET` assemblies implementing `IGrimoirePlugin`. AquaGrim already has a manifest plugin host (one active plugin per process, full Node trust after a prompt).

- (a) Drop the .dll API and do **not** promise a JS equivalent in this effort — plugins are already the extension mechanism; and put **one sentence** in the readme and About stating that this build is aimed at the game's own rules and the user takes the risk. (recommended)
- (b) Add a plugin-contributed tools menu so third-party code can add bot commands later.

**Recommended:** (a).
**Evidence:** `grimlite-ui-surface.md` §8: the menu is a `GrimoirePluginEntry` assembly loader and “has nothing in common with AquaStar's manifest-based plugin host, worth calling out explicitly so the parity matrix does not try to map them one to one”. `docs/PLUGINS.md` plus the map's “Settled” section cover the plugin contract. The risk statement matters because §5 of `grimlite-capabilities.md` is a ranked list of exactly the features being ported.

### Round 2 for #9

**9.13 Ghost accept and fake quest progress.** Recommended under 9.2(a): **drop both**.
**Evidence:** `grimlite-capabilities.md` §5: ghost accept, “Server action with no UI counterpart” (`Quest.cs:228-231`); the `updateQuest` bypass — client-injected progress “present in the shipped .gbot corpus”. **Depends on:** 9.2. Side effect to settle when it is asked: ghost accept is an alt-click variant of Add in the reference's editor (`grimlite-ui-surface.md` §2.11), so dropping it removes an editor affordance, not just a command.

**9.14 AFK logout, restart-on-AFK, restart-on-death.** Recommended under 9.2(a): **drop the restart-on-AFK and the in-game chat variant**; **keep the AFK logout** (it is the cautious direction and is provably what the option is for).
**Evidence:** `grimlite-capabilities.md` §5: “Anti-AFK logout or bot restart … Not an exploit, but the inverse (keeping a session alive unattended) is” (`HandlerAFK.cs:18-37`). **Depends on:** 10.7.

**9.15 Slow-down-warning suppression.** Recommended under 9.2(a): **drop**.
**Evidence:** `grimlite-capabilities.md` §5: “The user loses the one signal the server sends” (`HandlerWarnings.cs:19-22`), and §6.6 says “there is no primary source for what the server enforces”, so a port has nothing to replace it with. **Depends on:** 9.2.

**9.16 Packet views inside the bot manager and packet-logger windows.** Recommended under 9.7(a): **not implemented** (they all need a live proxy), and the reason is printed in the window. **Evidence:** `grimlite-capabilities.md` §2.8 (the spammer, the background packet, `CmdPacket`); `grimlite-file-formats.md` §10 puts the packet seam behind the relay, which is UNVERIFIED end-to-end (`grimlite-proxy.md`, “What could not be determined”). **Depends on:** 9.7, and on #3.

**9.17 The bot editor's tab layout.** Recommended: **full-size tabs (11 tabs), no compact width and no safe UI mode**, because this repo's windows are single-purpose and fixed size (settings 640x680 today). Cost to accept: a user on a 1366x768 screen has to scroll the tab strip. **Evidence:** `grimlite-ui-surface.md` §2.1 lists the reference's 11 tabs and §2.11 its list-editing shortcut conventions; `res/windows/config.js` fixes this repo's window sizes. **Depends on:** 9.4 (the skill surface) and 9.6 (the DPS meter), since those decide how many tabs exist.

**9.18 The Windows-only mechanisms, and what replaces each.** The report asks this explicitly, and the answer is mostly “nothing, and nothing needs to”: the ActiveX `CallFunction` transport becomes the bridge SWF, the `WH_KEYBOARD_LL` hook becomes Electron `globalShortcut` (already used here for the keys Flash swallows), WinForms cross-thread marshalling becomes the main/renderer split, and **the EasyHook `GetSystemTime` EOL patch and the CEF `BrowserForm` have no replacement** because neither does anything in this build. **Recommended:** record them as dropped-with-reason in the matrix, and note that the clock patch is the one item whose absence a user might notice (it forces the client's clock to a fixed year). **Evidence:** `grimlite-capabilities.md` §6.1–6.2 is the mechanism table (ActiveX, EasyHook, the keyboard hook, `Control.Invoke` marshalling, `MessageBox`/`Console.Beep`/`Process.Start` side effects); §1.1: the CEF form has no menu entry and its single call site is commented out. **Depends on:** 9.12.
---

## #10 — Bot engine: data model, execution semantics, and the v1 command set

Three of the ticket's six bullets are already settled by research: the command inventory is measured, the file format is portable both ways (`grimlite-file-formats.md` §10), and execution is blocked on the bridge rather than on the format. What needs a human is below. I re-read the reference's engine loop to make the options concrete **(re-checked)**.

### Round 1

**10.1 The execution model.** A bot is an ordered list walked by an index, with two concurrency hazards in the reference: a background packet spammer that runs on its own task alongside the walk, and an `async void` handler set that fires on packet arrival. Recommended shape:

- (a) One **index walk** with cancellation, evaluated as a plain loop that awaits each command, with an explicit scope (10.2) that disposes all timers, handlers and IXes when the window closes or the map reloads. The quest list, if kept, is a term in that same scope rather than a second loop. (recommended)
- (b) A fresh per-tick evaluator, which is what the reference effectively approximates and what makes cancellation hard to reason about.

**Recommended:** (a). One correction to the research, on which this answer depends: **`CmdBlank3` is a real command in current upstream and it executes nothing.** It is a coloured spacer (`Text`, `Alpha`, `R`, `G`, `B`) that the editor inserts to lay a script out, and `BotUtilities.RequiresDelay` excludes it from the bot-delay gate, i.e. it consumes an index and does nothing else. Its 145 occurrences in the shipped corpus are load-bearing layout, so the port keeps it as a stored, runnable no-op that carries its text and colour. Dropping it as dead code would silently re-flow every community bot that uses it. **(re-checked)**
**Evidence (re-checked):** the walk lives in `Grimoire/Botting/Bot.cs` `Activate()` — `Index` plus `lastCommand`, `while (paused) await Task.Delay(100)` before dispatch, `await cmd.Execute(this)`, an optional `BotDelay` gate with `SkipDelayIndexIf`, then `Index++`; `IndexChanged` is what the UI redraws from. `CmdIndex.Execute` moves the index with three modes (`Up`, `Down`, `Goto`, plus `IndexString` variable substitution), `CmdRestart` sets `Index = -1`. The block commands are the correction above: one file, three classes, three empty `Execute` bodies.

**10.2 Concurrency and ownership.** Grimlite is single-client by construction; this app allows several game windows.

- (a) One bot per game window, each with its own engine scope; starting a second bot in a second window is allowed and the per-window globals (safe cell, spawn, the current room id inside a joined command) resolve in the running window's context. (recommended)
- (b) One bot per app, with all other windows refusing to start.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` §10, row “WinForms form singletons used as the data model by handlers”: “state lives in the UI process in Grimlite; AquaStar keeps it in main-process modules”. **(re-checked)** the reference is per-process by construction: `OptionsManager` is a `static` class holding the options and the login username/password (`OptionsManager.cs:15-40`), and the game state hangs off static types, so there is no per-window state to inherit.

**10.3 Where the current command lives.** The shortest answer that keeps 95.6% of the shipped corpus working.

- (a) Index plus a **labelled command list**; the engine keeps one integer and `CmdGotoLabel` resolves through a label table to a stable command id. Labels are resolved once at load, so a label can point forward and a bot that is currently loaded is unaffected by a label later in the list. (recommended)
- (b) Keep raw list positions, exactly as the reference does.

**Recommended:** (a).
**Evidence (re-checked):** the corpus counts are `CmdGotoLabel` 228 and `CmdLabel` 169 — the two most frequent commands by a wide margin — and `CmdRestart` 101, `CmdIndex` 14. The reference's `CmdRestart` sets `Index = -1` and the loop then increments to 0, so “restart” means “run command 0”.

**10.4 What the bot does when the game changes under it.** The reference handles this in one place: the main loop checks `Player.IsLoggedIn` and `Player.IsAlive` each pass, re-enables provoke-and-friends around a death, and on disconnect either auto-relogins (restoring the toggles it had turned off, then resetting `Index = 0`) or stops. A port needs its own answer for the same three cases:

- (a) **Map reload:** treat it as a pause, not a restart; the next command that touches the map re-resolves the cell/pad. **Character death:** keep the reference's behaviour — walk the index either back one step or to 0 depending on the bot's own `RestartUponDeath`. **Disconnect:** see 10.5. (recommended)
- (b) On any of the three, stop the bot and say why.
- (c) Stop the bot on map reload and death only if the bot's own file says so.

**Recommended:** (a).
**Evidence (re-checked):** `Grimoire/Botting/Bot.cs`: on death — `World.SetSpawnPoint()`, wait until alive again (10 s timeout), then `Index = Configuration.RestartUponDeath ? 0 : Index - 1`; on `!Player.IsLoggedIn` — it snapshots every options toggle, stops them, calls `AutoRelogin.Login(Configuration.Server, Configuration.RelogDelay, _ctsBot, Configuration.RelogRetryUponFailure)`, then re-applies the toggles and resets `Index = 0`; if auto-relogin is off it calls `Stop()` and returns. `grimlite-file-formats.md` §3 lists `RestartUponDeath`, `RelogRetryUponFailure`, `AutoRelogin`, `RelogDelay` as per-bot fields. `grimlite-proxy.md` §6: a dropped relay can push the client into the game's BlueBox HTTP fallback rather than failing, so “disconnect” is not one event. The reference's “restore every toggle after relogin” step disappears under 9.2(a), which is a simplification worth recording.

**10.5 Auto-relogin, safe cell and lag killer: which engine owns them.**

- (a) Auto-relogin is a **setting** (a server to return to and a delay) plus the engine's reaction to a disconnect; the safe cell is what the engine does before a join; lag killer stays off while any bot or Maid is running. (recommended)
- (b) Each of the three is a command the user puts in their bot file.

**Recommended:** (a).
**Evidence:** `grimlite-file-formats.md` §7 puts `safeCell` in `ClientConfig.cfg` (a global), `AutoRelogin`/`RelogDelay` in the bot file, and **(re-checked)** the reference's Maid form calls `OptionsManager.SetLagKiller(toggle)` on enable/disable (`MaidRemake.cs:131`), i.e. lag killer is already treated as an engine-level side effect rather than a user choice at run time.

**10.6 Where bot files live and how they get there.**

- (a) A user-chosen folder of `.gbot` files, opened through the real Open/Save dialogs, with the folder and the last-used set stored per user (not per bot file); import/export is a file copy the user can do themselves. (recommended)
- (b) A managed library where a bot is imported before it can be used.

**Recommended:** (a).
**Evidence:** `grimlite-file-formats.md` §6 and §11: the reference's folder tree is the filesystem, enumerated one level at a time, and the recommendation is explicitly “a `showOpenDialog`/`showSaveDialog` pair over the user's own folder” because the store’s adapter is `JSON.stringify(value, null, 4)` — convenient for app state, wrong for a user document.

**10.7 A running bot when its window closes.**

- (a) Close the window and the engine scope is cancelled and the game window keeps running; the bot's file stays as it was, with the index discarded. (recommended)
- (b) Blocks the close until the bot is stopped by hand.

**Recommended:** (a).
**Evidence:** `grimlite-ui-surface.md` §1.5 and §1.3: the reference's tray icon and its “minimise to tray” hotkey exist precisely so the main window can be hidden while work continues; that is a layering fact, not a product choice. **Depends on:** 9.11, since the chrome window is where a bot is visible when the game window is hidden.

**10.8 What the engine does about a command it cannot run.** The first slice is the census in 10.10 minus what 9.2 and 9.7 drop. A community bot that uses one of the other ~87 implementations will load and then meet a command this build cannot execute.

- (a) **Refuse up front.** The loader reports every unsupported command in the file, by name and position, and the bot will not start until the user removes or replaces them. Nothing runs half a script. (recommended)
- (b) **Run what it can** and stop at the first unsupported command, with the index and the command named in the log.

**Recommended:** (a): a bot that silently skips a step farms the wrong thing for an hour, whereas the loader already has the whole file to inspect before anything moves. **Evidence (re-checked):** 148 `IBotCommand` implementations exist while the 60 shipped bots use 61 types, so unsupported commands are the normal case for third-party bots, not an edge case. **Depends on:** 9.2 and 9.7.

**10.9 The aura predicates, and where they get their numbers.** The reference's `CmdPlayerAura*` and `CmdTargetAura*` read the packet-accumulated cache, not the Flash call.

- (a) In this version they read the Flash call (`GetAurasValue`), accept that the value can be one packet stale, and document it; upgrade to the packet cache when the relay lands. (recommended)
- (b) Leave quiet; they are not a day-one blocker.
- (c) Do not implement aura predicates yet.

**Recommended:** (a) if the aura rows are in the first version at all; otherwise (c).
**Evidence:** `grimlite-capabilities.md` §2.9 closing caveat, and §2.5: the `GetAurasValue`/`AuraDuration` rows are the only aura reads that exist without the packet tap.

### Round 2 for #10

**10.10 The command list, in order, with the counts from the shipped corpus.** The census below is the priority order itself. I re-ran it over the reference's shipped bots **(re-checked)**: 60 files, 1,687 command occurrences, 61 distinct leaves.

| Rank | Commands | Occurrences | Verdict under 9.2(a) |
|---|---|---:|---|
| 1 | `CmdGotoLabel` 228, `CmdLabel` 169, `CmdBlank3` 145, `CmdRestart` 101 | 643 | keep |
| 2 | `CmdJoin` 115, `CmdMoveToCell` 37, `CmdSetSpawn` 11, `CmdMapItem` 2 | 165 | keep |
| 3 | `CmdShortHunt` 99, `CmdUseSkill` 83, `CmdKillFor` 63, `CmdKill` 13, `CmdAttack` 5, `CmdRest` 1 | 264 | keep (see 9.4 for the skill groups) |
| 4 | statements: `CmdNotInInventory` 92, `CmdCellIs` 35, `CmdSetVar` 30, `CmdInInventory` 18, `CmdNotInBankAndInvent` 12, `CmdVarEqualVar` 12, `CmdMapIsNot` 12, `CmdMapIs` 11, `CmdMonstersLessThan` 11, `CmdHealthGreaterThan` 9, `CmdIntIs` 9, `CmdUpdateVar` 9, `CmdEquipped` 4, `CmdMonstersGreaterThan` 3, `CmdPlayerNotInRoom` 3, `CmdTargetHealthLessThan` 2, `CmdQuestCompleted` 2, `CmdHealthLessThan`, `CmdInBank`, `CmdNotInTemp`, `CmdTargetHealthBetween`, `CmdNotEquipped`, `CmdNotHasTarget` | 288 | keep (one command per statement) |
| 5 | `CmdBuy` 29, `CmdEquip` 23, `CmdBankTransfer` 6 | 58 | keep |
| 6 | `CmdAcceptQuest` 53, `CmdCompleteQuest` 52 | 105 | keep, bridge form |
| 7 | `CmdDelay` 47, `CmdStop` 13, `CmdIndex` 14, `CmdInt` 2, `CmdLog` 1, `CmdLogout` 1, `CmdBeep` 5, `CmdGetDrop` 1, `CmdClearTemp` 1 | 85 | keep |
| — | `CmdPacket` 56, `CmdBackgroundPacket` 2, aura predicates 17 | 75 | **dropped by 9.7 / deferred by 10.9** |

**Recommended:** the ships-first set is rank 1 to rank 6 — every command above except the packet group and the aura predicates, which is **54 of 61 command types and 1,612 of 1,687 occurrences (95.6%)**. The remaining seven types are one command each (`CmdMonsterHealthLessThan`, `CmdLog`, `CmdHealthLessThan`, `CmdPlayerAuraGreaterThan`, `CmdGetDrop`, `CmdLogout`, `CmdInBank`, `CmdNotInTemp`, `CmdRest`, `CmdClearTemp`, `CmdTargetHealthBetween`, `CmdNotEquipped`, `CmdNotHasTarget`, `CmdBackgroundPacket`, `CmdPacket`) plus the aura family. The second slice is the rest of the ~148-command set — the commands the shipped corpus never uses, added by user report.
**Evidence (re-checked):** `Resources/Bots/**` census above; `grimlite-file-formats.md` §2 reproduces the same ranking. The proxy-dependent types are exactly the seven: `CmdPacket` 56, `CmdPlayerAuraLessThan` 7, `CmdPlayerAuraEquals` 4, `CmdTargetAuraLessThan` 3, `CmdBackgroundPacket` 2, `CmdTargetAuraGreaterThan` 2, `CmdPlayerAuraGreaterThan` 1.
**Depends on:** 9.2 and 9.7.

**10.11 The attack-and-kill core, in more detail than one row.** `CmdShortHunt`, `CmdKill`, `CmdKillFor` and `CmdAttack` are where the engine's taste shows.

- (a) Port them as the reference has them: monster by name or `*`, an item-and-quantity target, the whitelist toggle, the priority field, the three wait behaviours (`WaitForSkill`, `WaitForAllSkills`), the 3 s per-item drop cooldown. Leave out the packet-shaped escapes (`CmdPacket` inside a kill loop is the `aggroMon`/`crafting` path). (recommended)
- (b) Ship only `CmdAttack`/`CmdKill` first and add `CmdShortHunt` later.

**Recommended:** (a). **Depends on:** 10.10 (the slice that includes them) and 10.4.

**10.12 The four file-level defaults that are easy to get wrong.** Recommended: port them literally, and write them out rather than inferring them: `SkillDelay = 150` and `optionDelay = 500` are **non-zero initializers**, `CmdLoadBot.PassDropList` and `CmdLoadBot.PassSkillPreset` and `CmdCompleteQuest.ReAccept` and `CmdAcceptQuest.ghostAccept` are the fields marked `DefaultValueHandling.Include` (written even when default), and the `Quest` JSON key is `QuestID`, not `Id`. **Evidence:** `grimlite-file-formats.md` §1 and §3. **Depends on:** 10.6.

**10.13 The skills list is a second file format, and it is the one the app can write today.** Recommended: the comma-separated skill-list string (with the `wait` / safe-gate syntax shared by the Maid's heal list and the class presets) gets its own parser with validation, because it is the most likely format to be hand-edited and the reference's parser has positional bugs (`SH>60` is read as offset-2 operator plus offset-3 number, and `wait` is stripped by substring replacement). **Evidence:** `grimlite-file-formats.md` §7 (`SS.<CLASS>` grammar, the `eq`/`Contains` traps) and §8 (Maid's `SkillList` default `1,2,3,4`). **Depends on:** 10.10.

**10.14 The editor's editing conventions.** Recommended: port the list-editing shortcuts that the corpus workflows depend on (`Ctrl+Up`/`Ctrl+Down`, `Ctrl+Delete`, `Ctrl+D`, copy-as-plain-text, copy/paste as a whole configuration, drag a file onto the list, double-click to edit, `Ctrl`-click to insert above, `Alt`-click for the ghost variant), because they are the difference between editing a 700-line list and fighting it. **Evidence:** `grimlite-ui-surface.md` §2.11 lists exactly these; `grimlite-file-formats.md` §1 confirms the clipboard and the file use the same serializer settings, so the clipboard format is a real sub-format. **Depends on:** 9.17 and 10.6.

---

## #11 — Maid: per-boss behaviour scope and config format

One finding decides this ticket's shape: the boss handlers are not data, they are code with hard-coded coordinates and message strings, so “port Maid” means owning a maintenance burden that a game update can invalidate (`grimlite-capabilities.md` §6 item 9). I re-read the handlers to make the size of that burden concrete **(re-checked)**. Counts from the reference source: 7 auto-zone handlers, 2 taunt-driven handler families (`HandlerUltraGramielTaunt`, 4 presets; `HandlerUltraSpeakerMechanics`, 4 roles), and 1 dead one.

One correction to the research before the questions: `grimlite-capabilities.md` §6.2 says the three ultra handlers are not compiled, then corrects itself in a later pass and says they are (“Grimoire.csproj:205, :209, :437, :461”). It also says `HandlerTaunterChampionDrakath` is byte-identical to `HandlerAutoZoneUltraDage`; I confirmed that with `diff` **(re-checked)** — they are identical files — so Champion Drakath has no handler of its own and no separate decision to make.

### Round 1

**11.1 Which boss handlers have to exist before the feature is worth shipping.**

- (a) **Zone-position only, first.** Ship the seven auto-zone handlers — Ultra Dage, Dark Carnax, Astral Empyrean, Astral Empyrean P1, Astral Empyrean P2, Queen Iona, Colossal Vordred. They are the same shape: on the zone event, walk to a hard-coded (x, y) per zone letter; Queen Iona adds an aura check. The taunt families (Gramiel P1–P4, Ultra Speaker DPS/LR/LOO/AP) come in a second slice, because they carry the timings. (recommended)
- (b) Everything at once, this feature's whole point.
- (c) Ship nothing boss-specific; keep the generic follow-and-attack assistant only.

**Recommended:** (a).
**Evidence (re-checked):** `HandlerAutoZoneUltraDage.cs` is the whole shape — `case "A" -> WalkToPoint("107","400")`, `case "B" -> WalkToPoint("843","400")`, default `("503","276")`; Dark Carnax is `("860","400")`/`("49","400")`/`("426","372")`; Astral Empyrean `("708","447")`/`("287","191")`/`("461","329")`; Vordred `("731","461")`/`("700","321")`/`("748","372")`; Queen Iona adds `Player.GetAuras(true, "Positive Charge")` and a `("679","339")`/`("272","379")` swap; `HandlerUltraSpeakerMechanics` is far heavier (a 50-attempt taunt spam, message matching on `truth`/`listen`, skills chosen per mechanic).

**11.2 The field the reference writes but never reads back.** Every shipped Maid config carries all 23 fields; the template shipped for users carries 17, so six of them exist only in the per-boss files - `SpecialMsg` and `UltraBossExtra` among them. `UltraBossExtra` is written on every save (`cmbUltraBoss.SelectedIndex`) but never applied by `ApplyConfig`, so a user who loads a config that selects a boss preset silently gets `None`.

- (a) **Apply it or drop it.** Apply the boss preset on load so a config means what it says; a field written and never read is the one option not worth carrying. (recommended)
- (b) Carry the write-only field across as-is, preserving the reference exactly.

**Recommended:** (a).
**Evidence (re-checked):** the five configs under `Resources/Bots/Ultra Boss/Eclipse/Maid/**` each have all 23 fields; `Resources/Plugins/Maid/Default.json` has 17 and is missing `SpecialMsg`, `WhitelistMapMaps`, `SpecialAct`, `UltraBossExtra`, `AntiCounter` and `WhitelistMap`. In `MaidRemake.cs`, `saveConfig()` writes `UltraBossExtra = cmbUltraBoss.SelectedIndex`, while the `ApplyConfig` paths set every other field and never that one. This corrects an earlier reading of mine: the shipped configs are valid JSON; only the field wiring is asymmetric.

**11.2a The shipped template disagrees with the shipped configs.** `Resources/Plugins/Maid/Default.json` is a 17-field template that no compiled C# reads (no `Default.json` literal exists in the `.cs` tree), so a user who copies it gets six fields absent. Harmless under the overlay semantics, but the template and the per-boss files do not describe the same thing. Recorded as a matrix line, not as a question.

**11.3 The parts of the boss handlers that are not “walk to a coordinate”.** The taunt families do three things: match a message from the fight, walk, and fire a skill (often 1 or 2). Match the behaviour contract to what this repo can already do:

- (a) Package the per-boss knowledge as **data** the user can correct without a rebuild — the coordinate pairs, the trigger phrases, the skill indices and the targeting pattern — and keep the *decision* logic in code, one handler per family. (recommended)
- (b) Keep them as code, one method per boss, and take game updates as bugs.
- (c) Define the whole thing as a config schema, with no code per boss at all.

**Recommended:** (a). If the answer is (c) the port should say so explicitly and accept that a user-authored schema is a second product.
**Evidence (re-checked):** `HandlerUltraSpeakerMechanics.cs` matches `msgLower.Contains("truth")` / `"listen"`, walks to `("100","321")` and to `ZONE_OUT_X`/`DEFAULT_X`, and calls `Player.UseSkill("2")`/`("3")` in one branch and `("5")` in another, with `Player.SkillAvailable("5")` as the gate; `MaidRemake.cs` contains the phrase list (`"sun converges"`, `"moon converges"`, `"behold our starfire"`, `"shattering"`) plus a `tc;2;*;12;` syntax and a `bleeee` control message. None of it is user-visible data today.

**11.4 Maid's config: which of its fields follow a character, and which are per-install.**

- (a) **Per-install:** the whitelist-map list, the locked-zone alternatives, the master target (Maid is single-client), and the reload delay. **Per character:** the skill list, the safe/heal skill and its HP threshold, the buff-under-stop-attack skills, the monster priority list, and the anti-counter switch. One file, two sections. (recommended)
- (b) All per-install, in one flat file like the reference.
- (c) All per character, one file per character.

**Recommended:** (a).
**Evidence:** `grimlite-file-formats.md` §8 lists the 23 fields and the overlay semantics (absent means “leave as it is”), and the same doc's §11 says anything AquaGrim writes should go through the plugin store with a namespace and an alias. The repo already has the per-install/per-character split as a working example: reminders and To-Do are seeded from a plugin default and stored with aliases (`plugins/adventure-quest-worlds/plugin.json`, `storeAliases`), not one file per character. **(re-checked)** the shipped configs show the strongest per-install candidates — `WhitelistMapMaps` and `LockedZoneHandlerMaps` are the same in every shipped file — while `SafeSkillHP`, `AttackPriorityMonster` and `SpecialMsg` differ per file.

**11.5 How the user picks a config, and what happens on start.**

- (a) One config file per install, loaded automatically, with the save/load pair available for variants the user wants to keep by hand; no new UI beyond a name and the two buttons. (recommended)
- (b) A named preset list with a selector, so a user can hold several variants and switch.

**Recommended:** (a). **(b) is right if and only if the answer to 11.1 is (b) or (c)** — the boss-specific files only multiply when the handlers do.
**Evidence:** `grimlite-file-formats.md` §8: the reference's mechanism is a fixed `autoload.json` plus a manual Save/Load pair with the loaded file name shown in the group box caption; the shipped `Eclipse/Maid/*.json` files are variants of exactly this.

**11.6 The master-to-maid relationship, and what Maid may send.** The reference's Maid talks back to the game: it accepts party invites, and reacts to party chat commands written by the human (`.tp`, `.join`, `.acc`, `.turnin`, `.target`, `.start`, `.stop`).

- (a) Keep the party-chat vocabulary, since it is the human talking to their own assistant, and keep auto-accepting invites; but **do not** send chat or notices from the port, and do **not** whisper other players. (recommended)
- (b) Drop the party-chat vocabulary, keep auto-accept.
- (c) Keep it all, including outbound chat.

**Recommended:** (a).
**Evidence (re-checked):** `PartyInvitationHandler.cs` answers a JSON `pi` with `%xt%zm%gp%1%pa%{pid}%`; `PartyChatHandler.cs` parses message argument 4 with a `party~` prefix and switches on the leading `.`; the one outbound command in Maid is `%xt%zm%cmd%1%goto%{targetUsername}%` (`MaidRemake.cs:901`). `grimlite-capabilities.md` §2.6 marks the chat-write call as “M existing in both SWFs but the full path does not”, i.e. UNVERIFIED.

**11.7 Maid and the bot engine: one scheduler or two.**

- (a) **Two schedulers over one seam.** Maid is packet-driven and event-shaped (its state is “the current target and the last message”), the engine is a command list; they share the login/relogin handling and the bridge, not the loop. Running both at once is a deliberate case, not an accident. (recommended)
- (b) Express Maid as a bot file, so there is one mechanism.

**Recommended:** (a).
**Evidence:** the ticket's own framing, “it is a packet-driven assistant rather than a .gbot script”, and **(re-checked)** the reference's Maid has no command list at all: its loop is a `while` over the current target with membership and go-to retries, registered packet handlers for `uotls`, `ct`, `pi` and `warning`, and a `Flash.FlashCall2` subscription.

**11.8 The stop-attack indicator, and Maid's place in the chrome.** Maid's reference UI encodes “stop attacking” as a colour change across three different controls (a label, a checkbox and a strip on the main window), and the automation is deliberately visible.

- (a) Keep a visible state in the port's Maid window — the same state, expressed as a status the window shows persistently, not a flashing colour — and keep the logged-out/disabled distinction from the reference. (recommended)
- (b) No indicator; the engine state is only visible in logs.

**Recommended:** (a). **Evidence:** `grimlite-ui-surface.md` §5: `lbStopAttackBg` turns DeepPink, the Stop Attack checkbox turns Magenta, `maidStrip` turns `Color.FromArgb(240,50,50)`; the window title also becomes `Maid Remake (hh:mm:ss)` while StopAttack is running. **Depends on:** 9.11, for where that strip lands in a window that is no longer Grimlite's chrome.

---

### Round 2 for #11

**11.9 Per-boss overrides and their editor.** Recommended: expose the retuned numbers and trigger phrases of 11.3 in the window that owns the boss handler, and ship the five presets from the reference as editable starting points.
**Evidence:** `grimlite-capabilities.md` §2.8 shows the reference class presets are C# code (`ClassPreset`) that cannot be extended without a rebuild - the thing this answer changes. **Depends on:** 11.1 and 11.3.

**11.10 Whether Maid and the bot engine may run at once, and what wins.** Recommended: they may run together, with the engine's current command taking priority for the skills Maid wants, and the collision written to the log rather than resolved silently.
**Evidence:** both drive skills through the same calls (`UseSkill`, `ForceUseSkill`), and the reference’s Maid fires on packet arrival while the engine walks a list, so the shared resource is real. **Depends on:** 11.7 and 10.2.

---

## Cross-ticket notes for whoever runs these

**#10 and the sharpest #9 questions are gated by wayfinder task #15, not by this batch.** The client-local-origin proof is the single unproven thing the plan rests on: cross-origin `ApplicationDomain` access fails with #2119 / #2121, so the bridge cannot be built until the relay serves the game files from 127.0.0.1 (`grimlite-bridge-spike.md` §4, and the map #7 entry). Nine of the twelve #9 questions are client-side and mostly unblocked; the options, packet and engine questions are not.

**#8 is a sibling grilling ticket and is not in this batch.** It decides API shape rather than product direction, so it does not have to precede these answers - but the matrix “where it lands” column stays notional until it lands.

**Suggested order for one sitting.** 9.1, 9.2, 9.12 first (credential contract, the ban-risk line, and whether the .dll API is replaced), then 9.3 to 9.11 (surface calls), then 10.1 to 10.9 (engine semantics), then 11.1 to 11.8 (Maid shape) - and stop after 11.1 if the answer there is (c), because that retires 11.2 through 11.10.

**One item that is not a question but will bite.** `grimlite-proxy.md` §7 item 2: the existing socket relay performs no origin check on incoming WebSocket connections, so any local page can tunnel to AQW while a proxy is running. #13 closed the origin gate for the game wrapper; the TCP listener this work adds inherits the same exposure. An implementation note, not a decision for the human.

**Citation convention.** Every Evidence line names the research document and section, and the reference file where that document traced it. Line numbers of the form `File.cs:123` come from the research documents, whose clone carries local edits on top of the commit; my own re-checks are marked **(re-checked)** and cite the file name rather than a line.
