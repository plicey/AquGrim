# Grilling rounds for #9, #10 and #11

Draft prepared for HITL review on 2026-10-18. Nothing here is answered: these are the questions a human has to answer. Round 1 is answerable in one sitting; round 2 items are recorded but must not be asked until the question they depend on is answered.

Sources are the research documents on `research/grimlite-parity`: `grimlite-capabilities.md` (146 Flash call names, 33 packet shapes, 151 command classes; section 5 is the ranked ban-prone set), `grimlite-ui-surface.md` (34 windows, BotManager's 11 tabs), `grimlite-file-formats.md` (the .gbot dialect, the .cfg family, the read/write/execute verdict), `grimlite-proxy.md` and `grimlite-bridge-spike.md` (what game access costs).

Caveat on provenance: the reference clone `/tmp/grimlite-full` was **not present** on the machine this draft was written on, so nothing below was re-checked against the C#. Every citation is the research document, and the research documents' own line numbers point at the clone.

Format: **Q** = the question, **Recommended** = the answer meant to be accepted with a 'yes', **Evidence** = the finding that makes it a real decision, **Depends on** = an earlier question that must be answered first.

---

## #9 - Parity matrix: port, adapt, or drop for every Grimlite feature

The ticket's four explicit axes (hotkey map, .dll plugin API, chrome placement, Windows-only mechanisms) turn out not to be the hard ones. One finding subsumes them: `grimlite-capabilities.md` section 3 measures that 100 of the 146 call names exist **only** in Grimlite's own `Loader/grimoire.swf` and not in the game SWF, so every option toggle and the whole skill surface sit behind the client-origin work (task #15), not behind a design choice. The matrix rows below are the ones where a human has to call it.

### Round 1

**9.1 Credential contract.** AquaGrim stores no AQW credentials today; auto-relogin needs the password in a form it can hand to the bridge. Which contract?

- (a) keep the password in main-process memory for the session only, never written to disk, and use it only when auto-relogin fires (recommended);
- (b) store it at rest with Electron safeStorage (libsecret on Linux), keyed per account, and say so in the UI;
- (c) drop auto-relogin and every feature that needs the password.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` section 2.6, row 'Session credentials and user id' - `GetUsername`/`GetPassword` are loader-only names, and `AutoRelogin.Login(user, pass)` is the caller. `grimlite-proxy.md` section 6: the SFS `<login>` template carries the password in cleartext and calls it 'the largest security consideration in the whole design'. `grimlite-file-formats.md` section 9: Grimlite's own `CharSelect.cfg` is a plaintext `username,password` file, and 'AquaGrim stores no AQW credentials and must not inherit this'.
**Depends on:** 15.1 (whether game files can be served from a local origin at all). Record the answer now; it cannot be implemented before 15.1.

**9.2 The ban-risk position, stated once and applied everywhere.** Which line does the product hold?

- (a) port only what the server cannot distinguish from normal play (attack, skills, rest, join/jump/walk, drops, bank, shop, quests, inventory, cosmetics) and drop what changes what the server observes about you (infinite range, provoke, respawn provoke, enemy magnet, walk speed, skill cooldown/range/mana rewriting, buff, ghost accept, fake updateQuest, genderSwap, setAchievement, the Doom Vault B shortcut) (recommended);
- (b) port the ban-prone set as well, behind an explicit per-feature risk confirmation.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` section 5 is a ranked list of exactly these capabilities with sources, e.g. infinite range = 'Classic detectable advantage' (`OptionsManager.cs:157`), provoke = 'Changes combat AI in a server-visible way' (`OptionsManager.cs:159,184-186`), walk speed = 'Movement is normally server-validated'.

**9.3 DPS meter and the damage readout.** The parser exists but was never registered, and its window ships hidden.

- (a) drop it - the parser's source was disabled in the reference, so nothing establishes that the combat packet carries what the parser expects (recommended);
- (b) port it, off by default, fed by `sarsa`, and label it experimental.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` section 2.7, row 'DPS readout from combat packets': 'not registered; logging only' (`HandlerSkills.cs:48-90`, absent from the registrations at `Proxy.cs:269`). `grimlite-ui-surface.md` section 1.1: the DPS Meter menu entry is `Visible? no` (`Root.cs:889`).

**9.4 The windows that ship unreachable or unfinished.** Port or drop, as a group?

- (a) drop the hidden ones: Packet Interceptor (needs `ConnectTo`, a name in neither SWF's string table), the PvP skill panel (cooldown/range setters), Command Node Editor, the Set form (both of its on-disk formats), the WinForms command-colour editor, the CEF BrowserForm;
- (b) drop those and also drop the free ones (Logs, Notepad, Eye Dropper, the raw and per-command editors, the XML dump from the grabbers) (recommended);
- (c) keep everything, rebuilt.

**Recommended:** (b) minus the extra drop - i.e. keep the free ones, which costs nothing (the list in (b) is the recommended retention set).
**Evidence:** `grimlite-ui-surface.md` section 1.1 marks Sets, Change Server, DPS Meter, NodeEditor, PvP and Packet Interceptor `Visible? no`; section 3 marks BrowserForm dead ('no menu entry reaches it and the single call site is commented out') and Skill Preset empty. `grimlite-file-formats.md` section 10 lists `Sets/` in both of its formats, `config.cfg` and `MapConfig.cfg` under 'files that must not be ported'. `grimlite-capabilities.md` section 6 item 2 marks `ConnectTo` and `ResetAura` UNVERIFIED ('in neither SWF string table').

**9.5 The developer windows.** Do the call console and raw views become a documented developer mode?

- (a) yes - one hidden Developer section holding Swf Dev Test (arbitrary call, get/set object, format JSON), the packet views and the raw command editor (recommended);
- (b) no - drop the console that hands the user the whole bridge.

**Recommended:** (a).
**Evidence:** `grimlite-ui-surface.md` section 3 shows Swf Dev Test is visible in Grimlite's menu (`Root.cs:918`) while the packet tools vary; `grimlite-capabilities.md` section 7 records that the platform already has no game access exposed to plugins, which is ticket #8's subject - a developer surface is the cheapest way to keep that honest.

**9.6 Where the client chrome lands.** Grimlite puts its menu bar and a 27 px toolbar inside the game window (Start Bot, Auto Attack, cell and pad pickers, Bank) plus a char-select dropdown and a launcher-skin toggle.

- (a) a separate app window that owns the chrome, with a checkable Game-menu item to show or hide it, so the game window's geometry stays what screenshot and recording already assume and a bot can run while the game window is closed (recommended);
- (b) a toolbar overlaid inside the game window, matching Grimlite's layout but putting app chrome over the SWF.

**Recommended:** (a).
**Evidence:** `grimlite-ui-surface.md` section 1.2 (the 27 px `splitContainer1` and its six controls), section 1.5 (the skin toggle rebrands window and tray), section 10 (AquaGrim's game window is 960x530 and 'there is no in-page bot panel'). The answer feeds ticket #12, the client UI shell.

**9.7 The three client-side display toggles.** Lag killer, hide players, skip cutscenes. Two are a Flash call; hide players is not - it calls `DestroyPlayers` **and** filters the server's own user-data packets.

- (a) ship lag killer and skip cutscenes as plain display options, and put hide-players behind the same disclosure as the risk set because it rewrites packets (recommended);
- (b) ship all three as plain display options;
- (c) drop all three.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` section 2.7, row 'Hide players (destroy avatars)': 'DestroyPlayers, plus XT `retrieveUserData(s)` filtering ... XML and XT' (`OptionsManager.cs:113-122,165,212-213`; `HandlerPlayers.cs:18-25`), while lag killer and skip cutscenes are the only two rows in that table rated 'mild'.

**9.8 Access level: read, write, or neither.** The access-level *buttons* (Member, Moderator, Non-Mem) live in BotManager's Client tab; the only read that any shipped feature needs is staff detection.

- (a) drop the write buttons, keep the read, because anti-mod is what makes it useful (recommended);
- (b) keep both.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` section 2.6, row 'Access level of a player, for staff detection' (`GetAccessLevel`, 'used at BotManager.cs:3217-3259') and the same section's 'Change name colour or access level' row, marked 'ban-prone'. `grimlite-ui-surface.md` section 2.9, Access group.

**9.9 Where the Maid config launcher lives.** In Grimlite it is a form field on the Maid window.

- (a) a Maid-window button that opens the config, exactly as Grimlite's Save/Load do (recommended);
- (b) a Settings sub-page, which is more native but splits Maid's settings away from the panel that uses them.

**Recommended:** (a).
**Evidence:** `grimlite-file-formats.md` section 8: the Save/Load dialogs are hardcoded to a `Config` folder next to the exe, with a fixed `autoload.json` filename and the loaded file shown in the group box caption. Grimlite's maid UI is `gbConfig` 'Config : Default', Save, Load (`grimlite-ui-surface.md` section 5).

**9.10 Does the first run say what this is?** Porting Grimlite turns AquaGrim into a botting-capable client.

- (a) one line in the README and the About window, in the voice of the MOTIVATION.MD the repo already ships (recommended);
- (b) no notice.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` section 5 is a ranked ban-prone inventory for the very features being ported.

### Round 2 for #9

**9.11 Infinite range, provoke, respawn provoke, enemy magnet, walk speed.** Recommended: drop under 9.2(a); port any of them only under 9.2(b).
**Evidence:** `grimlite-capabilities.md` section 5 names each: 'Classic detectable advantage' (`OptionsManager.cs:157`), 'Monsters target the player on respawn' (`OptionsManager.cs:159,184-186`), 'Pulls monsters toward the player' (`:161`), 'Movement is normally server-validated' (`:169`).
**Depends on:** 9.2.

**9.12 Skill cooldown, range and mana rewriting, plus buff.** Recommended: drop. Grimlite itself votes this way - its PvP window that drives the setters is hidden, and the handler that rewrites skill range is not registered.
**Evidence:** `grimlite-capabilities.md` section 5: '`SetSkillCooldown`, `SetSkillRange`, `SetSkillMana` ... Direct combat-stat manipulation'; the `Buff` row ('Sets haste 50 percent and refills mana') is directly below it; the dead 20000-range rewrite is `HandlerSkills.cs:18-45`, 'not registered (`Proxy.cs:269`)'.
**Depends on:** 9.2.

**9.13 Ghost accept and fake `updateQuest`.** Recommended: drop both.
**Evidence:** `grimlite-capabilities.md` section 5: ghost accept is 'Server action with no UI counterpart' (`Quest.cs:228-231`); the iValue bypass is 'Client-injected quest progress ... present in the shipped .gbot corpus'.
**Depends on:** 9.2. Second-order effect to settle when it is asked: ghost accept is an alt-click variant of Add in BotManager (`grimlite-ui-surface.md` section 2.11), so dropping it removes a BotManager affordance.

**9.14 Identity and account-state writes.** Recommended: drop gender swap, name/guild/colour/access-level spoofing, `setEquip` appearance overrides and `setAchievement`.
**Evidence:** `grimlite-capabilities.md` section 5: 'Masquerade, easy to misread as a permissions bug' and 'Direct account-state write'. The cosmetic half is the awkward part - same client-side mechanism, visible in the Cosmetics window (`grimlite-ui-surface.md` section 3) - so it needs its own yes/no inside this answer.
**Depends on:** 9.2.

**9.15 Slow-down-warning suppression.** Recommended: drop.
**Evidence:** `grimlite-capabilities.md` section 5: 'Hides the server's rate-limit warning while the bot runs ... The user loses the one signal the server sends' (`HandlerWarnings.cs:19-22`), and section 6 item 6: 'there is no primary source for what the server enforces', so a port cannot replace it with a documented rate cap.
**Depends on:** 9.2.

**9.16 Map spoofing and the member-flag bypass.** Recommended: drop both.
**Evidence:** `grimlite-capabilities.md` section 5: map spoofing is 'Client-side deception with a UI effect, and it mislabels the map', and the bypass 'Grays out the client's own gating'. The spoof also rewrites `world.strAreaName`, so it would corrupt a value the rest of the port reads (`grimlite-capabilities.md` section 2.2).
**Depends on:** 9.2.

**9.17 Buy-back over HTTP with in-game credentials.** Recommended: drop.
**Evidence:** `grimlite-capabilities.md` section 5: 'Logs into account.aq.com with GetUsername and GetPassword and buys items back ... Credential handling plus an out-of-band session', and the inventory row for it ends 'and it keeps the account password in the client'.
**Depends on:** 9.2 (and 9.1 if the answer is 9.2(b)).

**9.18 The packet tools: sniffer, spammer, tamperer.** Recommended: sniffer (read-only) in the developer section, tamperer with an explicit warning, spammer out entirely.
**Evidence:** `grimlite-capabilities.md` section 5: the spammer sends 'an operator-chosen packet list on a fixed delay ... Server-visible rate pattern', and `CmdPacket` makes 'the bot format ... a packet injector by design'. `grimlite-ui-surface.md` section 3 shows the Packet logger window carries its own inline spammer row.
**Depends on:** 9.2, plus #3's proxy actually working (its end-to-end step is UNVERIFIED, `grimlite-proxy.md` section 'What could not be determined').

**9.19 AFK logout, restart-on-AFK, restart-on-death, overall bot delay.** Recommended: port restart-on-death and the overall delay; keep the AFK logout, which is the cautious direction; drop the restart-on-AFK variant.
**Evidence:** `grimlite-capabilities.md` section 5: 'Anti-AFK logout or bot restart ... Not an exploit, but the inverse (keeping a session alive unattended) is'. Both flags are per-bot fields (`RestartOnAFK`, `RestartUponDeath`, `BotDelay` in `grimlite-file-formats.md` section 3), so the port inherits the toggle either way.
**Depends on:** 10.9 (what a running bot does when the game goes away).

**9.20 The hotkey map.** Recommended: port the action vocabulary into AquaGrim's existing per-plugin keybind recorder, keep Alt+T / Alt+Y / Alt+I / Alt+U / F2 / Ctrl+J / F11 / Ctrl+F5 as they are, and add app-level actions (start-stop bot, start-stop Maid, show Bot Manager, minimize to tray, cancel target) only through globalShortcut.
**Evidence:** `grimlite-ui-surface.md` section 4.1: nothing ships by default and the file is read only when it exists, so the parity item is the action list, not a key list; section 4.2: 'Single keys only - no Ctrl or Shift combinations'; section 10 lists AquaGrim's existing bindings. Repo constraint: promotion to globalShortcut is only needed where the SWF eats key events first.
**Depends on:** 9.6 (a 'show the chrome' hotkey needs the chrome to exist).

---

## #10 - Bot engine: data model, execution semantics, and the v1 command set

Three of the ticket's six bullets are already settled by research: the command inventory is measured (151 `class Cmd*` declarations, 148 `IBotCommand` implementations, and a 60-file corpus census in `grimlite-file-formats.md` section 2), the file format is portable in both directions (`grimlite-file-formats.md` section 10), and execution is blocked on the bridge, not on the format ('Execute them - blocked; this is the real finding'). What is left is product taste and risk, below.

### Round 1

**10.1 Concurrency.** Grimlite is single-client by construction; AquaGrim allows several game windows.

- (a) one bot per game window, with cell/pad placeholders such as `{ROOM_ID}` resolving against the window the bot is running in, at send time (recommended);
- (b) one bot per app, other windows refusing to start.

**Recommended:** (a).
**Evidence:** `grimlite-file-formats.md` section 9, row 'Packet-cmd variables': `{ROOM_ID}`, `{ROOM_NUMBER}`, `{GETMAP}`, `PLAYERNAME` are substituted at send time from the running client (`CmdPacket.cs:58-61`) - a single frozen room id would make a stored bot wrong for any second window.

**10.2 Where the engine runs.**

- (a) the main process, one engine task per game window, fed by IPC from a renderer-side editor (recommended);
- (b) inside each game window's renderer, which can call the SWF directly.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` section 4 contrasts the two: 'state lives in the UI process in Grimlite; AquaStar keeps it in main-process modules'. `grimlite-file-formats.md` section 11 puts the bot store and file dialogs in the main process, and the game renderer already carries the capture preload.

**10.3 Byte-fidelity of `.gbot` files.** Reading and re-writing a bot can lose data: a field absent because it equalled a C# default is indistinguishable from a field the authoring build never had, and the corpus carries two keys (`DropDelay`, 12 files; `ReloginEvery`, 1 file) that current Grimlite does not have at all.

- (a) keep the parsed object and mutate keys in place; AquaGrim never re-serializes from a normalized model (recommended);
- (b) accept the loss in exchange for a clean internal model.

**Recommended:** (a).
**Evidence:** `grimlite-file-formats.md` section 1 and section 10: 'read to write to read is lossy unless you preserve the original key set ... Recommend keeping the parsed object and mutating it rather than re-serializing from a normalized model'.

**10.4 What the editor does with a command this build cannot run.** The corpus exercises 61 of the 148 implementations; the rest of the set is what a user's own bot may contain.

- (a) show the command as unsupported, preserve its JSON verbatim, and refuse to start that bot until the user removes or replaces it (recommended);
- (b) refuse to open the file at all;
- (c) start anyway and silently skip it, changing the script's meaning.

**Recommended:** (a).
**Evidence:** `grimlite-file-formats.md` section 10: 'a $type naming a type absent from Grimoire.exe throws during deserialization and surfaces as a MessageBox', and section 10's read list: 'a port that implements only what the corpus exercises will fail on any community bot that uses the other half'.

**10.5 Live editing and run visibility in v1.**

- (a) no debugger and no breakpoints in v1: the user can stop and restart, and the currently executing command is highlighted (recommended);
- (b) the editor is read-only while a bot runs.

**Recommended:** (a).
**Evidence:** `grimlite-ui-surface.md` section 2 describes the editor as a plain ordered list with Add/Remove/Up/Down and no run position, and `grimlite-file-formats.md` section 11 leaves AquaGrim's editor shape open - so this is a call, not a port.

**10.6 The aura statements, which need packet state rather than a Flash call.**

- (a) in the first slice, back `CmdPlayerAura*` and `CmdTargetAura*` with the Flash call and document them as one packet staler; switch them to the packet cache when the proxy lands (recommended);
- (b) hold the engine until the packet layer exists so they behave exactly as in Grimlite.

**Recommended:** (a) with the difference documented.
**Evidence:** `grimlite-capabilities.md` section 2.9's closing caveat: the aura statements 'read the `AuraManager` caches, which are only filled by the `aura+` and `aura-` packet tap ... not by a Flash call. A bridge that only exposes `GetAurasValue` gives those statements a different, often one-packet-stale, source than Grimlite's'.

**10.7 Where bot files live.**

- (a) the user's own directories of `.gbot` files, opened and saved through native dialogs, with only the last used directory in the plugin store (recommended);
- (b) import bots into the plugin store, which breaks the drop-in relationship with an existing Grimlite folder.

**Recommended:** (a).
**Evidence:** `grimlite-file-formats.md` section 11: the store's adapter is 'JSON.parse on read and JSON.stringify on write', and 'a plain getStore(\'bots\') holding the current bot is the wrong model; a dialog.showOpenDialog/showSaveDialog pair over the user's own botsDir is the right one, with the store reserved for last used directory'.

**10.8 File naming for bots AquaGrim saves.** Recommended: offer `.gbot` as the default extension and do not enforce it, so a file AquaGrim writes opens in Grimlite and vice versa. **Evidence:** `grimlite-file-formats.md` section 10: writing a Grimlite-openable bot needs exact `$type` strings, integer enums, the four `DefaultValueHandling.Include` fields and UTF-8 without BOM; a writer that emits every known field is read back identically.

**10.9 Failure handling.** Recommended: on disconnect, pause and wait for the game to return if auto-relogin is on, otherwise stop and say why; on death and on map reload, consult the bot's own flags (`RestartUponDeath`) rather than an app-wide default; never start a bot automatically because the app launched.
**Evidence:** `grimlite-capabilities.md` section 2.6, row 'Auto-relogin preserves the toggle state across the login' (`Bot.cs:244-268`), and `grimlite-file-formats.md` section 3 where `AutoRelogin`, `RelogRetryUponFailure`, `RestartUponDeath` and `RestartOnAFK` are all per-bot fields. Landmines the answer has to cover: a dropped relay can push the client into the game's BlueBox HTTP fallback rather than failing (`grimlite-proxy.md` section 6), and the reference relogs the client around the proxy switch instead of splicing a live connection.
**Depends on:** 10.1 (per window or per app decides what 'stop' means).

### Round 2 for #10 (both depend on #15, the client-origin proof)

**10.10 The first command slice.** Recommended split:

- v1 = very command type in the corpus except the 7 that need the packet layer - that is 54 types covering 1,611 of the corpus's 1,686 command occurrences (the two packet commands plus the five aura-cache statements, 75 occurrences, are the entire proxy-gated delta);
- v1 additionally uses the bridge form wherever a command has both a bridge form and a raw-packet form (accept quest, get drop, get map item, load bank);
- v2 = those 7 types plus the remaining ~87 implementations the corpus never exercises, added by user report;
- `CmdProvoke` (6 occurrences) is in the corpus but is dropped by 9.2, so the ban decision has to land before this list is frozen.

**Evidence:** `grimlite-file-formats.md` section 2 is the occurrence census (228 `CmdGotoLabel`, 169 `CmdLabel`, 145 `CmdBlank3`, 115 `CmdJoin`, 101 `CmdRestart`, 99 `CmdShortHunt`, then a long tail; 13 types occur once). The bridge/packet duality for those four commands is `grimlite-capabilities.md` section 2.3 ('Accept a quest' `Accept(questId)` vs 'Ghost accept' raw XT) and section 2.4 ('Bank view, listing and load ... XML or XT', 'Pick up a map item ... XML or XT').
**Depends on:** 15.1 and 9.2, and on 10.1 for whether a slice is per window.

**10.11 The second file format, and what the first slice is tested against.** Recommended: treat the comma-separated skill-list string (the `SkillList` field, default `1,2,3,4`) as a small format of its own with a validator that reports bad tokens, alongside the `.gbot` reader. For testing, use the 60-file corpus as fixtures and require a reader that survives all of them plus a byte-identical re-write for the ones this slice covers. **Evidence:** `grimlite-file-formats.md` section 11: 'A reader that survives all 60 and re-emits byte-identical output for the ones without legacy keys is done'; `grimlite-uysurface.md` section 2.11 shows the engine hands the string to a naive parser while class presets remain hardcoded C#.
**Depends on:** 10.10. Note the corpus itself is not on this machine - it lives in the reference clone under the resources bot folder, so someone has to fetch it before the fixture requirement is real.

---

## #11 - Maid: per-boss behaviour scope and config format

One finding decides this ticket's shape. `grimlite-capabilities.md` section 6 item 9: the per-boss handlers 'hard-code coordinates and message strings' - x and y pairs and text such as 'behold our starfire', 'defense shattering' and 'prepares a counter attack' - so 'a port inherits maintenance of those strings'. The Maid itself does not exist in AquaGrim today; this is new game-specific code, not a migration.

### Round 1

**11.1 How much per-boss maintenance is accepted?**

- (a) build the handler table as data (keyword strings and coordinate pairs in a data file, not in code), ship the handlers whose data is verified, and review the trickiest triggers later (recommended);
- (b) ship only the generic Maid (follow, target, party, whitelist map, locked-zone handler) and add per-boss handlers only on request;
- (c) ship every handler and accept that a game update can invalidate them.

**Recommended:** (a).
**Evidence:** `grimlite-capabilities.md` section 6 item 9; section 2.8 shows the families that carry the strings (`HandlerAutoZone*` for six bosses plus Astral Empyrean P1/P2, `HandlerUltraGramielTaunt`, `HandlerUltraSpeakerMechanics`), and the last of those is described as '50-attempt taunt spam' with baked-in coordinates.

**11.2 How a boss script reaches the user.** Recommended: ship the boss configs as data inside the plugin and auto-load the one matching the current zone, with a visible indication of which one is active (Grimlite's own mechanism is one fixed auto-load file per install). **Evidence:** `grimlite-file-formats.md` section 8: `Config/autoload.json`, a fixed filename, silent no-op when missing, and the picked file shown in the group-box caption. Note the release notes call this file 'autoload.cfg' while the code reads 'autoload.json' - a port should follow the code.

**11.3 Maid ships as a feature of the bundled AQW plugin, not as its own plugin.** Recommended: yes - it is game-specific, and the platform-isolation test forbids the platform naming game concepts. **Evidence:** the repo's plugin contract (`docs/PLUGINS.md`, `res/windows/config.js` for platform windows vs a plugin's own feature windows) and the AQW plugin's existing per-feature stores and seeded defaults.

**11.4 Party interaction.** Maid auto-accepts party invitations, runs a party-chat command vocabulary, and sends marks to the party. Recommended: scope this to the Maid's own function (it accepts invites because following a party is what it is for) and leave general chat behaviour alone. **Evidence:** `grimlite-capabilities.md` section 2.8: 'Maid: auto-accept party invites' (raw XT `gp%1%pa%{pid}%` on JSON `pi`) and 'party-chat command bot (.tp .join .acc .turnin .target .stop .start)'. Mute/unmute exists as a Flash call (`MuteToggle`, section 2.6) and the two can collide, which is the thing this question settles.

**11.5 Maid config storage.** Recommended: the Maid config lives in the plugin's store, with the schema's null-tolerant fields preserved, including its 'absent means leave the control as it is' behaviour, because that is what lets shipped presets work as overlays. **Evidence:** `grimlite-file-formats.md` section 8: 23 properties, all nullable, applied string-only-`if (!string.IsNullOrEmpty(...))`, numerics only if present, bools `?? cbX.Checked`; and the shipped template carries a raw CRLF inside a string value.

**11.6 The stop-attack signal.** In Grimlite it is a deep-pink label, a magenta checkbox and a red strip on the main window. Recommended: a status line in the Maid panel (text, not colour alone, so a theme cannot swallow it) and no sound alerts. **Evidence:** `grimlite-ui-surface.md` section 5: `lbStopAttackBg` turns DeepPink, the checkbox turns Magenta, `maidStrip` turns `Color.FromArgb(240,50,50)`; sound alerts are an option group elsewhere in the app.

**11.7 First-slice boss handlers.** Recommended: the first slice covers the zone-walk-plus-transfer families (the six auto-zone entries plus Astral Empyrean P1/P2), and leaves the taunt-driven bosses (Gramiel, Speaker) for the next slice, where the strings and coordinates from 11.1 are already in data. Per-boss overrides become their own slice. **Evidence:** the ticket's family list; `grimlite-capabilities.md` section 2.8 for what each handler does; `grimlite-ui-surface.md` section 2.9 for the `cmbSpecials` list a port would replace.

**11.8 Can the engine and the Maid land in either order?** Recommended: yes - they are separate schedulers over the same two seams (the engine runs an ordered command list, the Maid reacts to events and re-derives work from the current target), so either ships first once the bridge and packet seams exist. **Evidence:** the ticket frames Maid as 'a packet-driven assistant rather than a .gbot script', and `grimlite-capabilities.md` section 2.8 shows it is driven by `uotls`, `ct`, `pi` and `warning` events rather than a command list.
**Depends on:** 10.1 and 10.2.

### Round 2 for #11

**11.9 Per-boss overrides, and where they are edited.** Recommended: a per-boss config keyed by zone, with its own window rather than controls inside the Maid panel. **Evidence:** `grimlite-capabilities.md` section 2.8 shows Grimlite's presets are C# code and not user files (`ClassPreset`, `MaidConfig` preset strings), and `grimlite-ui-surface.md` section 5 lists the five shipped Maid presets sitting beside sibling `.gbot` files. **Depends on:** 11.1 and 11.2.

**11.10 How much of a boss handler is configurable by the user.** Recommended: expose the numbers and strings that get retuned (coordinates, trigger keywords, cycle lengths) and keep the decision logic in code. **Evidence:** `grimlite-capabilities.md` section 6 item 9: 'Per-boss handlers hard-code coordinates and message strings ... A port inherits maintenance of those strings'. **Depends on:** 11.1.

---

## Cross-ticket notes for whoever runs these

- Every #10 and the sharpest #9 questions are gated by wayfinder task #15 (client-local origin), which `grimlite-bridge-spike.md` calls 'the single unproven thing the plan rests on' - cross-origin `ApplicationDomain` access fails with #2119/#2121, and #7's map entry says the same. #15 has a sibling dependency on #3's proxy, which is at test-15 anyway.
- `res/socketProxy.js` performs no origin check on incoming WebSocket connections (`grimlite-proxy.md` section 7, item 2), so any local page could tunnel to AQW while a proxy is running. #13 fixed only the WebSocket relay's Origin gate for the game wrapper; the TCP listener this work needs inherits the same question. Not a question for the human: a mitigation, to state in the answer's implementation note.
- `grimlite-capabilities.md` section 4 lists the mechanisms that must differ in AquaGrim: ActiveX calls become the bridge, the EasyHook clock patch, the Win32 low-level keyboard hook becomes Electron globalShortcut, WinForms cross-thread marshalling becomes the main/renderer split, and the proxy moves out of the game process.
- Sibling grilling ticket #8 (where parity code lives and how plugins see game access) decides API shape, not product direction, so it does not have to be answered first; the matrix's 'destination' column is only notional until it lands.

