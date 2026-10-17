# Grimlite-Li user-facing surface

Inventory of everything a Grimlite-Li user can see or touch, taken from the C# source
rather than from the readme. This is the input for the follow-up issue
"Parity matrix: port, adapt, or drop for every Grimlite feature".

| Field | Value |
|-------|--------|
| Reference repo | `Froztt13/Grimlite-Li` |
| Commit read | `816d9cd` (tag `v1.9.3`, 2026-10-15) |
| Source tree used | `/tmp/grimlite-full` (working tree has uncommitted local edits on top of that commit) |
| Secondary ref | `/tmp/grimlite-probe-2` - `origin/master` (Froztt13) vs `jib/master` (jib-akbr fork) diff |
| Version string | `Program.cs:14` `Version = "Li 1.9.3b"`, `Program.cs:15` `ReleaseDate = "10-10-2026"` |
| Target repo | AquaStar working tree, Electron 11.5.0 + PPAPI Flash |

Every claim below carries a path plus a symbol or line from the file it came from.
Anything not confirmed by reading code is marked **UNVERIFIED**.

Two tree quirks worth knowing before you go looking:

- `Grimoire/BotManager.Designer.cs` and `Grimoire/UI/BotManager.Designer.cs` are both tracked
  duplicates (`git ls-files`), as are `Grimoire/BankForm.Designer.cs` and
  `Grimoire/UI/BankForm.Designer.cs`. The project only compiles the `Grimoire/UI/` copies
  (`Grimoire.csproj:488`, `Grimoire.csproj:494`). Line numbers differ between the copies, so every
  citation here uses the `Grimoire/UI/` file.
- The reference tree is a working tree with local edits (the in-repo changelog stops at v1.7.3,
  `Resources/Notes/changelog.txt`, while `Program.cs:14` says 1.9.3b), so a line number is valid
  for commit `816d9cd` plus those edits.

---

## 1. The shell: Root - the main window

Grimlite is a single WinForms window (`Grimoire/UI/Root.cs:25`, `class Root : Form`) that hosts the
Flash ActiveX player plus a menu bar and a one-row toolbar.

| Item | What the user sees / does | Where | Config |
|---|---|---|---|
| Window | Title "Grimlite Li", starts centred | `Root.cs:1168`, `Root.cs:1167` | - |
| Max size clamp | `MaximizedBounds` = current screen working area, set on Load | `Root.cs:102` | - |
| Custom chrome | Drag on the menu bar moves the window via `WM_NCLBUTTONDOWN` / `HT_CAPTION` | `Root.cs:1341` `MenuMain_MouseDown` | - |
| Custom resize | Manual `WM_NCHITTEST` edge and corner hit-testing (borderless look) | `Root.cs:1351` `WndProc` | - |
| Window style | `WS_MINIMIZEBOX` / `WS_SYSMENU` / `WS_SIZEBOX` OR-ed into `CreateParams` | `Root.cs:1441`-`1447` | - |
| Flash surface | `gameContainer` Panel (docked fill, starts at y=27) holds the `AxShockwaveFlash` player built by `InitFlashMovie` | `Root.cs:590`-`594`, `Root.cs:196`, `Root.cs:300` | `ClientConfig.cfg` key `flash` (`Root.cs:112`) |
| Missing-SWF placeholder | If the SWF path is absent: "Game SWF not configured. / Place your game SWF at 'Loader\grimoire.swf' relative to the exe, or add 'flash=Loader\grimoire.swf' to ClientConfig.cfg." plus a **Choose SWF...** button | `Root.cs:228`, `Root.cs:242` | `Root.cs:262` writes `flash=Loader\grimoire.swf` |
| Close behaviour | On close: uninstall all hotkeys, merge the map-item log, dispose the keyboard hook, stop the proxy, dispose the colour form, hide and dispose the tray icon | `Root.cs:181`-`195` (`Root_FormClosing`) | writes `MapItemLog.txt` (`Root.cs:187`) |

### 1.1 Menu bar

Built at `Root.cs:717`-`726` in this order: **Bot | Tools | Packets | Options | Maid | Plugins |
About | Char Select**. Labels: `Root.cs:742` (Bot), `Root.cs:767` (Tools), `Root.cs:941` (Packets),
`Root.cs:996` (Options), `Root.cs:1126` (Maid), `Root.cs:1135` (Plugins), `Root.cs:1143` (About),
`Root.cs:1152` (Char Select).

| Menu / item | What it does | Handler | Visible? |
|---|---|---|---|
| Bot | opens Bot Manager | `Root.cs:742` to `329` `botToolStripMenuItem_Click` | yes |
| Tools, Fast travels | opens Travel | `Root.cs:776` to `334` | yes |
| Tools, Loaders/grabbers | opens Loaders | `Root.cs:785` to `339` | yes |
| Tools, Hotkeys | opens Hotkeys | `Root.cs:794` to `344` | yes |
| Tools, Plugin manager | opens PluginManager | `Root.cs:803` to `349` | yes |
| Tools, Cosmetics | opens CosmeticForm | `Root.cs:812` to `1200` | yes |
| Tools, Bank | opens BankForm | `Root.cs:821` to `1205` | yes |
| Tools, Sets | opens Set form | `Root.cs:830` to `1210` | **no** - `Root.cs:831` |
| Tools, Eye Dropper | opens EyeDropper | `Root.cs:840` to `1249` | yes |
| Tools, Logs | opens LogForm | `Root.cs:849` to `1254` | yes |
| Tools, Notepad | opens Notepad | `Root.cs:858` to `1259` | yes |
| Tools, Change Server (combo `changeServerList`) | pick a server, logs out then `AutoRelogin.Login(server, 3000, ensureSuccess:false)` | `Root.cs:869`, `Root.cs:1234` | **no** - `Root.cs:870` |
| Tools, DPS Meter | opens DPSForm | `Root.cs:888` to `1483` | **no** - `Root.cs:889` |
| Tools, commandeditornode | opens NodeEditor | `Root.cs:898` to `1488` | **no** - `Root.cs:899` |
| Tools, PvP | opens PvP | `Root.cs:908` to `1735` | **no** - `Root.cs:909` |
| Tools, Swf Dev Test | opens DevTest | `Root.cs:918` to `1745` | yes |
| Tools, Drop Ui | opens DropUi | `Root.cs:927` to `1769` | yes |
| Packets, Sniffer | opens PacketLogger | `Root.cs:949` to `354` | yes |
| Packets, Spammer | opens PacketSpammer | `Root.cs:958` to `359` | yes |
| Packets, Tamperer | opens PacketTamperer | `Root.cs:967` to `364` | yes |
| Packets, Interceptor | opens PacketInterceptor | `Root.cs:976` to `1740` | **no** - `Root.cs:977` |
| Options, Infinite Range | `CheckOnClick` toggle into `OptionsManager.InfiniteRange` | `Root.cs:1007`, `Root.cs:1264` | yes |
| Options, Provoke | toggle | `Root.cs:1019`, `Root.cs:1271` | yes |
| Options, Enemy Magnet | toggle | `Root.cs:1031`, `Root.cs:1278` | yes |
| Options, Lag Killer | toggle | `Root.cs:1043`, `Root.cs:1285` | yes |
| Options, Hide Players | toggle | `Root.cs:1055`, `Root.cs:1293` | yes |
| Options, Skip Cutscenes | toggle | `Root.cs:1067`, `Root.cs:1300` | yes |
| Options, Disable Animations | toggle | `Root.cs:1079`, `Root.cs:1308` | **no** - `Root.cs:1080` |
| Options, Walkspeed (+ text box, default "20") | ticking pushes the number into BotManager's walk-speed field and enables it | `Root.cs:1094`, `Root.cs:1104`, `Root.cs:1320`-`1330` | yes |
| Options, Enable Options | toggle mirrored with BotManager `chkEnableSettings` | `Root.cs:1115`, `Root.cs:1315` | **no** - `Root.cs:1116` |
| Maid | opens MaidRemake | `Root.cs:1127` to `1770` | yes |
| Plugins | dropdown filled by `MenuMain.ItemAdded` (`Root.cs:1465`) and `ItemRemoved` (`Root.cs:1470`) | `Root.cs:1131`-`1135` | yes (empty without plugins) |
| About | opens AboutForm | `Root.cs:1143` to `1704` | yes |
| Char Select | per-character quick login, see 1.4 | `Root.cs:1152` | hidden until a char list loads (`Root.cs:167`) |

### 1.2 Client-side toolbar next to the game

`splitContainer1`, 27 px tall, docked over the top of the game area (`Root.cs:620`). Controls are
added at `Root.cs:607`-`613`:

| Control | Text | Position | Behaviour | Source |
|---|---|---|---|---|
| `chkStartBot` | "Start Bot" | x=573 | Ticks BotManager's `chkEnable`; refuses to tick with an empty command list or when logged out | `Root.cs:647`, `Root.cs:1684` |
| `chkAutoAttack` | "Auto Attack" | x=644 | Starts the client-side skill loop using the class preset; refuses if not logged in or if the bot is running | `Root.cs:659`, `Root.cs:1588` |
| `cbPads` | fixed items Center, Spawn, Left, Right, Top, Bottom, Up, Down | x=729 | Picking a pad moves the character to (selected cell, that pad) | `Root.cs:691`-`699`, `Root.cs:1513` |
| `cbCells` | cell list, `MaxDropDownItems = 25` | x=814 | Filled from `World.Cells` on click (needs login); picking a cell moves there | `Root.cs:680`, `Root.cs:685`, `Root.cs:392`, `Root.cs:1503` |
| `btnGetCell` | "x" (18x21) | x=899 | Refreshes the cell list, selects current cell and pad, re-moves to it | `Root.cs:635`, `Root.cs:1709` |
| `btnBank` | "Bank" | x=918 | `Player.Bank.Show()` | `Root.cs:672`, `Root.cs:1498` |

There is **no** access-level control in this toolbar. The member/moderator/non-member buttons live in
BotManager, Client tab, Access group (`BotManager.Designer.cs:4693`; handlers `BotManager.cs:2419`-
`2426`). `ClientConfig.C_ACCESS_LEVEL` is declared (`Tools/ClientConfig.cs:16`) and never read
anywhere; it is dead.

### 1.3 Tray icon

| Item | Behaviour | Source |
|---|---|---|
| `nTray` NotifyIcon | Text "GrimLite", `Visible = true` at design time | `Root.cs:481`-`484` |
| Click | `ShowForm(Root.Instance)`: toggles the main window, hiding it when visible and restoring it when minimised | `Root.cs:1244`, `Root.cs:371`-`384` |
| Icon swap | The Artix Game Launcher skin swaps the tray icon too | `Root.cs:1756` |
| Shutdown | Icon hidden and disposed on close | `Root.cs:191`-`193` |

### 1.4 Char-select dropdown

| Item | Behaviour | Source |
|---|---|---|
| `menuCharSelect` | Top-level menu item, hidden by default, one child per saved character | `Root.cs:167`, `Root.cs:1152` |
| `CharSelect.cfg` | Keys `0`, `1`, ... with values `username,password`; read once, cached in `chars` | `Root.cs:131`-`163` |
| Click a character | `AutoRelogin.Login(username, password)` | `Root.cs:170` |
| Auto show/hide | Shown when Flash reports `connection` `OnConnectionLost`; hidden on `OnConnection` | `Tools/Flash.cs:404`-`408`, `Root.cs:165` |

### 1.5 Artix Game Launcher skin toggle

`ToggleLauncherSkin` (`Root.cs:1750`-`1768`) flips the whole window between disguise and normal:
title becomes "Artix Game Launcher", window and tray icon become `Properties.Resources.Artix`,
`splitContainer1` (the entire menu bar and client toolbar) is hidden, and the window height drops by
the menu bar height. Toggling back restores "Grimlite Li", `GrimoireIcon`, and the toolbar. It is
reachable from Hotkeys, action "Change Launcher Skin" (`Hotkeys.cs:75`).

### 1.6 Controls that are wired but never parented

Declared, styled and given handlers, but no `Controls.Add` or `Items.Add` reference exists anywhere
(grep for the identifier in `Grimoire/UI/Root.cs` finds only the declaration, the initialiser, the
property block and the handler). They cannot be clicked:

| Item | Text | Evidence |
|---|---|---|
| `btnMin`, `btnMax`, `btnExit` | "🗕", "🗖", "x" | `Root.cs:562`, `Root.cs:533`, `Root.cs:548`; handlers `Root.cs:1458`, `Root.cs:1453`, `Root.cs:1436`; only `gameContainer`, `splitContainer1` and `MenuMain` are added (`Root.cs:1160`-`1162`) |
| `panel1` | empty 200x100 panel | `Root.cs:566`-`572` |
| `startToolStripMenuItem` / `stopToolStripMenuItem` | "Start" / "Stop" (Stop starts disabled) | `Root.cs:492`, `Root.cs:502`; enable/disable logic in `BotStateChanged` `Root.cs:1224`-`1230` |
| `managerToolStripMenuItem` | "Manager" | `Root.cs:511` |
| `loadBotToolStripMenuItem` | "Load bot", calls `botManager.btnLoad_Click` | `Root.cs:520`, `Root.cs:1493` |
| `MenuMain` | invisible MenuStrip, text "pluginHolder", hosts plugin-contributed items (`ItemAdded` / `ItemRemoved`) | `Root.cs:583`-`586` |
| `EggsForm` | static `Form` field; when non-null, `ShowForm` substitutes it for whatever form was requested | `Root.cs:369`, `Root.cs:373`; nothing in the tree ever assigns it (grep) |
| `btnReloadBank_Click` | sends `%xt%zm%loadBank%<room>%All%` | `Root.cs:1730`; no control references the handler (grep) |
| `Root_KeyPress` | empty body | `Root.cs:1478` |

### 1.7 Client-side auto-attack

Ticked by `chkAutoAttack`. Reads the equipped class, looks up a skill preset, and runs the skills on
a loop; bails out if the bot is running or the player is logged out (`Root.cs:1588`-`1636`). Three
classes get hardcoded combos: "chrono shadow", "arcana invoker", "archmage"
(`Root.cs:1638` `SpecialClassCombo`, `Root.cs:1644`, `1653`, `1663`).

Skill presets come from `ClientConfig.cfg` keys `SS.<CLASSNAME>` (`Root.cs:1523`-`1586`,
`getSkillPreset`). Grammar: `;` separates skills; `:` attaches a safe gate written as `SH>60`,
`SH<60` or `SM>30` (HP or MP, greater-than or less-than); a bare `wait` token anywhere in the
string makes every normal skill wait for cooldown. Shipped presets are in the repository's
`ClientConfig.cfg` (11 lines, for example `SS.VOID HIGHLORD=1:SH>60;2;3:SH>60;4` and
`SS.DRAGON OF TIME=3;2;1;2;4;2wait`). An empty preset falls back to a single skill "1"
(`Root.cs:1599`-`1602`).

---

## 2. BotManager - the bot editor

`Grimoire/UI/BotManager.cs` (3723 lines) and `Grimoire/UI/BotManager.Designer.cs` (5759 lines).
Window title " Bot" (`BotManager.Designer.cs:5545`). Right-click menu: Change Fonts, Multiline
Toggle, Toggle Tabpages, Command Customizer (`BotManager.Designer.cs:5494`-`5529`; wired at
`BotManager.cs:2436`, `2718`, `2723`, `2728`).

### 2.1 Layout

| Region | Contents | Source |
|---|---|---|
| Left column | One listbox switched by `cbLists`: Commands, Skills, Quests, Drops, Boosts, Items (`BotManager.Designer.cs:5360`-`5366`; switch handler `BotManager.cs:838`). Above it `chkEnable` "Enable Bot", `btnRemove` "Remove", `btnUp` "▲", `btnDown` "▼", `btnClear` "Clear", `chkAll` "all" (`BotManager.cs:823`) | `BotManager.Designer.cs:5444`-`5465` |
| Search | `txtSearchCmd` "Command Text" plus `btnSearchCmd` "Find", wraps around hits (`BotManager.cs:2838`) | `BotManager.Designer.cs:4866`-`4877` |
| Tab host | `mainTabControl` with 11 tabs, added at `BotManager.Designer.cs:887`-`897` | see below |
| Counters | `lblCommands`, `lblSkills`, `lblQuests`, `lblDrops`, `lblBoosts`, `lblItems` live counts, plus `lblBots` | `BotManager.Designer.cs:1717`-`1722`, `1700` |

| Tab | Label | Line |
|---|---|---|
| `tabCombat` | Combat | `BotManager.Designer.cs:931` |
| `tabMap` | Map | `1573` |
| `tabItem` | Item | `1871` |
| `tabQuest` | Quest | `2338` |
| `tabMisc` | Misc | `2798` |
| `tabMisc2` | Misc 2 | `3407` |
| `tabOptions` | Options | `3810` |
| `tabOptions2` | Client | `4344` |
| `tabHunt` | Hunt | `4878` |
| `tabBots` | Bots | `5035` |
| `tabInfo` | Info | `5209` |

### 2.2 Combat tab

| Group | Controls | Source |
|---|---|---|
| Skill Set | `txtSkillSet` "Skill Set Name", `btnAddSkillSet` "Add Skill Set" (writes a `CmdSkillSet` named `[NAME]`), `btnUseSkillSet` "Use Skill Set" | `Designer.cs:2931`, `2922`, `2912`; `BotManager.cs:3558`, `3570` |
| Rest | `chkHP` "HP <=", `chkMP` "MP <=", `numRest`, `numRestMP`, "Rest if", "%" twice, `btnRest` "Rest", `btnRestF` "Rest fully" | `Designer.cs:3109`, `3082`, `2993`, `2962`, `2972` |
| Kill for items | `rbItems` "Items", `rbTemp` "Temp items", `txtKillFMon` "Monster (* = random)", `txtKillFItem` "Item name", `txtKillFQ` "Quantity (* = any)", `chkAddToWhiteList` "add to Whitelist", `btnKillF` "Kill for [KF]" | `Designer.cs:3303`, `3290`, `3278`, `3268`, `3258`, `2892`, `3313` |
| Skill Command | `btnLeaveCombat` "Leave combat", `btnStopAttack` "Stop attack", `numSkillCmd`, `cbSkillCmdWait` "Wait", `txtMonsterSkillCmd`, `btnSkillCmd` "Add (cmd)", `chkForceSkill` "Force" | `Designer.cs:1210`, `1215`; `BotManager.cs:3667`, `3672`, `3194` |
| Other combat | `chkSkillCD` "Wait for skill to cooldown", `chkAllSkillsCD` "Wait for all skills to cool down", `chkExistQuest` "Exit combat before completing quest", `chkExitRest` "Exit combat before resting", `btnAttack` "Attack", `btnKill` "Kill", `txtMonster` "Monster (* = random)" | `Designer.cs:2983`, `3250`, `3055`, `3240`, `3022`, `3032`, `3322` |
| Skill editor | `numSkill`, `btnAddSkill` "Add skill", `btnAddSafe` "Safe skill", `btnAllSkill` "All", `numSafe`, `chkSafeMp` "MP", `cbSafeType`, `numSkillD` with `label13` "Skill delay" plus "ms", `chkUseSkillTargeted` "Targeted", "When HP or ... %" | `Designer.cs:3204`, `3184`, `2853`, `2943`, `3043`, `2843` |
| Drops-per counter | `darkCheckBox1` "Get drops per" plus `darkTextBox1` "5" and "kills" | `Designer.cs:2881`, `2872`, `2864` |

### 2.3 Map tab

| Group | Controls | Source |
|---|---|---|
| Position | `txtCell` "Cell", `txtPad` "Pad", `btnCellSwap` "<", `button2` ">", `btnJump` "Jump", `btnCurrCell` "Get current cell", `btnCurrBlank` "Jump Blank" | `Designer.cs:3523`, `3513`, `3484`, `3474`, `3494`, `3504`, `3362` |
| Walking | `btnSetSpawn` "Set Spawnpoint", `btnWalkRdm` "Walk Randomly", `btnWalkCur` "Current position", `btnWalk` "Walk to" with `numWalkX` / `numWalkY` | `Designer.cs:3374`, `3386`, `3398`, `3408` |
| Join | `txtJoin` "battleon-1e99", `txtJoinCell` "Enter", `txtJoinPad` "Spawn", `btnJoin` "Join map", `numJoinTry` "Join attempt(s)", `cbJoinMapSwf` with `tbJoinMapSwf` "(.swf)" | Map tab, `BotManager.Designer.cs:1245`-`1252` |

### 2.4 Item tab

| Group | Contents | Source |
|---|---|---|
| Map Item | `numMapItem`, `btnMapItem` "Cmd", `btnMapItemExe` "Get" | Item tab |
| Options | `chkInventOnStart`, `chkPickupAll`, `chkPickup`, `chkReject`, `chkPickupAcTag`, `chkBankOnStop` | Item tab |
| Shop | `radBuyByName` / `radBuyByID`, `tbShopId`, `tbShopItemId`, `tbItemId`, `numBuyQty` "Qty", `btnLoadShop` "Load (cmd)", `tbShopItemName`, `btnBuy` "Buy item", `btnBuyFast` "Buy fast" | Item tab |
| Whitelist | `btnWhitelistToggle` "Toggle", `btnWhitelistOn` "On", `btnWhitelistOff` "Off", `txtWhitelist` | Item tab |
| Adds | `btnBoost` "Add boost" plus `cbBoosts`, `btnSwap` "Bank swap" plus `txtSwapInv` / `txtSwapBank`, `btnWhitelist` "Add to whitelist", `btnBoth` "Add to both", `btnUnbanklst` "Add to Unbank list", `txtItem`, `btnItem` "Add command" | Item tab |
| `cbItemCmds` | Get drop, Sell, Equip, Unsafe Equip, To bank from inv, To inv from bank, Equip Set, Add to Whitelist, Remove from Whitelist | `BotManager.Designer.cs:2310`-`2319` |

### 2.5 Quest tab

| Group | Contents | Source |
|---|---|---|
| Grabber | `numQQuestId`, `btnQAddToWhitelist`, `chkQRequirements` "Requirments", `chkQRewards` "Rewards" | Quest tab |
| Quest List | `chkReloginCompleteQuest`, `numQuestListID`, `numQuestDelay`, `btnAddQuestList` "Add (cmd)", `chkQuestListItem`, `numQuestListItem`, `btnRemoveQuestList` "Remove (cmd)", `btnQuestAdd` | Quest tab |
| Quest | `numQuestID`, `chkQuestItem`, `numQuestItem`, `btnQuestComplete`, `btnQuestAccept`, `numEnsureTries` | Quest tab |

### 2.6 Misc tab

| Group | Contents | Source |
|---|---|---|
| Variables | `btnClearVarInt` "Clear Var&Int" | Misc tab |
| Tauntcycle | `ButtonTC_Start`, `ButtonTC_Stop` | Misc tab |
| Follow and Kills | `btnFollowCmd` "Follow", `tbFollowPlayer` | Misc tab |
| Labels | `lbLabels` with `btnAddLabel`, `btnGotoLabel`, `txtLabel` | Misc tab |
| Bot Control | `btnStop` "Stop bot", `btnRestart` "Restart" | Misc tab |
| Player | `txtPlayer`, `btnGoto` | Misc tab |
| Temp Integer | `txtSetInt`, `btnSetInt`, `numSetInt`, `btnIncreaseInt` "++", `btnDecreaseInt` "--" | Misc tab |
| Index | `numIndexCmd`, `btnGotoIndex`, `btnGoUpIndex` "++", `btnGoDownIndex` "--" | Misc tab |
| Actions | `btnReturnCmd`, `btnProvokeOn` "On", `btnProvokeOff` "Off", `btnBlank`, `btnLogout`, `btnBeep` "Play Sound" plus `numBeepTimes`, `btnDelay` plus `numDelay` | Misc tab |
| Statements | `txtStatement1`, `txtStatement2`, `cbStatement`, `btnStatementAdd`, `cbCategories` = Aura, Item, This player, Player, Map, Monster, Quest, Misc | `BotManager.Designer.cs:3335`-`3343` |
| Packet | `txtPacket` `%xt%zm%[packet]%`, `btnClientPacket`, `btnPacket` | Misc tab |
| Load bot | `btnLoadCmd` "Load bot (command)" | Misc tab |

The statement dropdown is filled from 85 classes under `Grimoire/Botting/Commands/Misc/Statements/`
(84 condition classes plus `StatementCommand.cs`); the eight categories map onto them by
reflection. The shipped `Resources/statementcmds.txt` is only a serialiser stub, not user-facing.

### 2.7 Misc 2 tab

| Group | Contents | Source |
|---|---|---|
| Special handlers | `cmbSpecials` (Auto Zone - Ultradage, Dark Carnax, Astral Empyrean, Astral Empyrean P1, Astral Empyrean P2, Queen Iona, Colossal Vordred; Gramiel P1 to P4; Ultra Speaker DPS, LR, LOO, AP), `chkSpecial`, `btnSpecialStart`, `btnSpecialStop`, `btnSpecialSwitch` | `BotManager.Designer.cs:3465`-`3480` |
| Bot Delay | `label3` "Overall Delay", `btnBotDelay`, `numBotDelay`, `chkRestartAFK`, `chkRestartDeath`, `chkSkip` | Misc 2 tab |
| Save / Load | `txtAuthor`, `splitContainer3`, `txtDescription` "Description (Write in RTF)", `chkMerge` | Misc 2 tab |
| Packet Spammer | `tbBSPacket`, `tbBSLabel`, `numBSDelay`, `btnBSAdd`, `btnBSStop` | Misc 2 tab |

### 2.8 Options tab

| Control | Text | Behaviour | Source |
|---|---|---|---|
| `chkAntiCounter` | "Anti counter attack" | - | Options tab |
| `chkFollowOnly` | "Follow" plus `tbFollowPlayer2` "Player name" | disabled while options run | `BotManager.cs:3501` |
| `chkWalkSpeed` plus `numWalkSpeed` | "Walk speed" | feeds `OptionsManager.WalkSpeed` | Options tab |
| `lstLogText`, `txtLog`, "Viable Log References" | double-clicking a reference appends it into the text box | `BotManager.cs:2293` | Options tab |
| `btnLog` "Log Script", `btnLogDebug` "Log Debug" | append `CmdLog` commands | `BotManager.cs:2172` | Options tab |
| `label6` "Options Timer" plus `numOptionsTimer` | range 100-10000, step 10, default **500**; writes `OptionsManager.Timer` | `BotManager.Designer.cs:4019`, `BotManager.cs:2256` | `Designer.cs:3785` |
| `chkEnableSettings` | "Enable options without starting" | Starts and Stops `OptionsManager`; mirrors Root's hidden Enable Options item | `BotManager.cs:3500`, `1726` |
| `chkDisableAnims` | "Disable player anims" | - | Options tab |
| Sound alert | `txtSoundItem`, `btnSoundAdd` "Add", `btnSoundDelete` "Delete", `btnSoundTest` "Test", `lstSoundItems`, label "If any of the following items are dropped, play a sound" | `tooltip` at `Designer.cs:4104` |
| Flash toggles | `chkSkipCutscenes`, `chkHidePlayers`, `chkLag`, `chkMagnet`, `chkProvoke`, `chkInfiniteRange`, `chkRespawnProvoke` | - | Options tab |
| Auto relogin | `chkAFK` "Relogin on AFK", `cbServers`, `chkRelogRetry` "Relog again if in battleon", `chkRelog` "Auto relogin", `numRelogDelay`, "Delay before starting the bot" | - | `BotManager.Designer.cs:4210`, `4235` |

Options are implemented by `Grimoire/Botting/OptionsManager.cs`: `InfMana` (`:39`), `Buff` (`:61`),
`ProvokeMonsters` (`:67`), `EnemyMagnet` (`:73`), `LagKiller` (`:79`), `SkipCutscenes`
(`:85`), `AFK` (`:91`), `DisableAnimations` (`:100`), `HidePlayers` (`:113`),
`InfiniteRange` (`:124`), `WalkSpeed` (default 8, `:245`), `Timer` (default 1000, `:145`),
`Packet` (`:147`), `LoginUsername` / `LoginPassword` (`:27`-`33`), `RespawnProvoke`
(`:184`). Flash calls: `SetInfiniteRange`, `SetProvokeMonsters`, `SetEnemyMagnet`,
`SetLagKiller`, `DestroyPlayers`, `SetSkipCutscenes`, `SetWalkSpeed` (`:157`-`169`). A
two-second `ApplySettings` loop re-applies them (`:188`-`217`) while `IsRunning`.

### 2.9 Client tab

| Group | Contents | Source |
|---|---|---|
| Load Map | `tbLoadMap` "Map file (.swf)", `btnLoadMap` "Load" | Client tab |
| FPS | `numSetFPS`, `btnSetFPS` "Set", `btnSetFPSCmd` "(cmd)" | Client tab |
| Level | `numSetLevel`, `tbLevel` "Level", `btnSetLevel` "Set", `btnSetLevelCmd` "(cmd)" | Client tab |
| Others | `chkSaveProgress` "Relogin every" plus `numSaveProgress` "minutes", `btnHideLoading` "Hide Loading" (`Flash.Call2("HideConnMC")`, `BotManager.cs:3627`), `btnReloadMap` "Reload Map" (`World.ReloadMap()`, `BotManager.cs:3587`), `btnSetSpawn2` "Set Spawnpoint" | Client tab |
| `colorfulCommands` | "Enable custom commands (CPU intensive)", turns on per-command colouring in the list | `BotManager.cs:2556` |
| Anti Mod | `chkAntiMod` "Enable" with tooltip "Auto stop and logout when you see any staff/mod.", `chkAMStopBot` "Stop Bot", `chkAMLogout` "Logout" | `BotManager.cs:3189` |
| Cosmetic toggles | `chkGender` "Gender swap" (`genderSwap` packet, `BotManager.cs:3603`), `chkCorrection` "Auto Correct Quantity" (tooltip `BotManager.cs:3705`) | Client tab |
| Map Spoofer | `tbMapSpoof` "ThisIsCool", `chkMapSpoofer` "Enable Spoofer", IDs only | `BotManager.cs:3708`-`3721` |
| Messages | `inputMsgClient` "Hello World!", `btnAddInfoMsg` "Add Info", `btnAddWarnMsg` "Add Warning" | Client tab |
| Access | `chkToggleMute` "Toggle Mute" (`Player.ToggleMute`, `BotManager.cs:2431`), `btnSetMem` "Member", `btnSetModerator` "Moderator", `btnSetNonMem` "Non-Mem" into `Player.ChangeAccessLevel` | `BotManager.cs:2419`-`2426` |
| Alignment | Chaos, Undecided, Good, Evil | Client tab |
| Name / guild | `txtUsername` "Username" with `btnchangeName` "Set" and `btnChangeNameCmd` "(cmd)"; `txtGuild` "Guild" with `btnchangeGuild` and `btnChangeGuildCmd` | Client tab |

### 2.10 Hunt, Bots and Info tabs

| Tab | Contents | Source |
|---|---|---|
| Hunt | label "Reworked To The max"; `tbMonNameF` "Monster (* = random)", `tbItemNameF` "Item name", `tbItemQtyF` "Quantity (* = any)", `chkIsTempF` "is Temp", `chkAddToWhitelistF` "add to Whitelist", `cbBlankFirstF` "Blank first before join", `tbMapF` "battleon-1e99", `tbCellF` "Enter", `tbPadF` "Spawn", `btnGetMapF` "Get", `btnAddCmdHunt` "Add Command", label "Short Hunting" | `BotManager.Designer.cs:4888`-`5011` |
| Bots | `treeBots` directory browser, `btnSetBotsDir` "Set" (folder picker, writes `ClientConfig.C_BOTS_DIR`), `txtSaved`, `btnSavedAdd` "Add folder", `txtSavedAuthor` "Author", `txtSavedDesc` "Description" | `BotManager.cs:3612`-`3624`, `Designer.cs:5035` onwards |
| Info | `rtbInfo` (RTF bot description), `richTextBox2` "Test here" | `BotManager.Designer.cs:5209` onwards |

The Bots tab rebuilds its tree whenever it is selected (`BotManager.cs:2263`-`2277`).

### 2.11 BotManager keyboard shortcuts

`lstBoxs_KeyPress` (`BotManager.cs:1734`-`1830`):

| Keys | Action |
|---|---|
| Ctrl+Up / Ctrl+Down | Move the selected item one position |
| Ctrl+Delete | Same as pressing Remove |
| Ctrl+D | Duplicate the selected items below the selection |
| Ctrl+Shift+C | Copy selected commands as plain text, one per line |
| Ctrl+C | Copy the selection as a `.gbot` JSON `Configuration` (all lists) |
| Ctrl+V | Paste ASCII config; commands insert after the selected index |
| Ctrl+click an add button | Insert above the current selection |
| Alt+click an add button | Toggle the variant, for example normal vs ghost Accept Quest (`BotManager.cs:993`, `1009`, `1022`, `1279`-`1282`) |
| Double-click a command | Open the Command Editor (`BotManager.cs:680`) |
| Drop a `.gbot` on the list | Load it (`BotManager.cs:2315`, `2327`) |

The user-facing copy of these is the readme's Shortcuts section (`readme.md:12`-`19`).

### 2.12 BotManager cosmetic debris

Dead or near-dead controls kept in the designer: `checkBox1` "Placeholder", a stray unticked checkbox
(`BotManager.Designer.cs:5484`); `chkBuffup` (`Designer.cs:5490`); `darkLabeldevNotes`;
`numSpamTimes` is added to the Misc tab (`Designer.cs:2770`) and reads as an unlabelled spinner.
Separately, `BotManager.cs:3511` sets a tooltip for `chkAntiMod` from the `chkUseSkillTargeted`
hover handler, which reads as a copy-paste mistake (**UNVERIFIED**).

---

## 3. Auxiliary windows

All paths are under `Grimoire/UI/` unless noted. "Config" lists files the window reads or writes.

| Window (title) | File | What the user sees and does | Config |
|---|---|---|---|
| About | `AboutForm.cs` and `.Designer.cs`, title "About" | Version line `Version {Program.Version} ({Program.ReleaseDate})`; credit links for Froztt13 GitHub, Vicinity4519 (jib-akbr is commented out), Dropbox, 0zl/cat, wispie, two MPGH profiles, Ko-fi/Zee; a `tbGameSWF` field with **Load SWF** that re-inits the game movie | `AboutForm.cs:17`, `31`-`81`, `103`-`120` |
| Bank | `BankForm.cs`, title " Bank" | combo1 "What to bank (optional)" (Weapons, Sword, ..., Class, Armor), combo2 "AC or Non-AC", `checkBox1` "Bank all except selected", `button1` "Bank", `button2` "Bank All"; transfers run with 70 ms / 100 ms delays | `BankForm.cs:36`-`41`, `85`-`98`; no config file |
| Cosmetics | `CosmeticForm.cs`, title "SWF Cosmetics" | Player combo (room players), `btnGrabCosm` "Grab"; per-slot "Grab Helm/Armor/Wep/Pet/Cape/Class/Ground" links; text boxes for Helm, Armor, Class, Weapon, Pet, Cape, "Off.H", "Misc" each with a "Set" button; `btnCopyAll` "Equip All", `btnEquipSelected` "Equip Selected", `btnClear` "Clear All", `btnRemove` "Remove", `btnRefresh` refresh glyph, `btnSaveSet` / `btnLoadSet` | `CosmeticForm.Designer.cs:109`-`758`; sets in `Sets` next to the exe, `*.gset` (`CosmeticForm.cs:339`, `350`) |
| Colors (Command Customizer) | `CommandColorForm.cs`, title "Colors" | Combo with Index, Variable, ExtendedVariable plus every `IBotCommand` type name discovered by reflection; **Set Color of Selected**, **Set Selected to Centered**, **Save Size** (writes `lstCommandsFontSize`), **Random Colors based on RGB**, refresh, "Reload Colors", `txtRGB` | `CommandColorForm.cs:37`-`52`, `26`, `62`-`102`; writes `config.cfg` keys `<Name>Color` (ARGB hex) and `<Name>Centered` (bool) |
| DPS Meter | `DPSForm.cs`, title "DPS Form", `chart1` column chart, "Your DPS:" | fed by the damage handler `Networking/Handlers/HandlerSkills.cs:48`-`82` | none; menu entry hidden (`Root.cs:889`) |
| Drop Ui | `DropUi.cs`, title "DropList" | Columns Name / Qty / Category / "AC | Member"; `lblCount` "Drop count : 0"; `cbRejectDrop` "Reject ingame drop" (sets `Player.isRejectingAllDrop`); `btnTakedrop` "Take Drop"; "Reject & Blacklist"; "Clear" with a Yes/No warning dialog | `DropUi.Designer.cs:58`-`115`, `DropUi.cs:182`-`216`; the blacklist is in-memory only (`:17`) |
| Dev Test | `DevTest.cs`, title "Dev Test" | Function and Args boxes, **Call**, radios Grimoire / Call Func / Get-Set Object, **Copy**, **Format JSON** | `DevTest.Designer.cs:55`-`188` |
| Eye Dropper | `EyeDropper.cs`, title " Eye Dropper" | Captures a colour and prints it as `#AARRGGBB`, `r, g, b` and `#RRGGBB` | `EyeDropper.Designer.cs:52`-`89` |
| Heheh (egg) | `Egg.cs`, title "Heheh..." | Maximised Astolfo image; clicking spawns another Egg window | `Egg.cs:16`-`25`; no caller anywhere (grep), dead |
| Hotkeys | `Hotkeys.cs`, title "Hotkeys" | see section 4 | `hotkeys.json` |
| Loaders | `Loaders.cs`, title "Loaders and grabbers" | see 3.2 | XML dump via Save dialog (`Loaders.cs:141`-`208`) |
| Debug Log | `LogForm.cs`, title "Debug Log" | Tabs **Debug, Script, Chat**. `tabLogDrops` is declared and fully configured (`LogForm.cs:483`-`493`) but never added to `tabLogs.Controls`, which adds only Debug, Script and Chat (`:390`-`392`), so the Drops log is unreachable. Buttons Clear, Save, Start, Stop; right-click Change Font / Change Color; Start toggles `IsDebugLoggingEnabled` and a TraceListener | `LogForm.cs:168`-`300`; `logDebugSwf` gate at `:144` |
| Notepad | `Notepad.cs`, title "Notepad" | Rich text box, right-click Font / Color, drag-drop of text files, Ctrl+S save dialog (txt / gbot / all). Typing `debugskill` dumps the equipped class's skill actions; typing `mapitems` dumps the known map-item IDs | `Notepad.cs:89`-`166` |
| Packet Interceptor | `PacketInterceptor.cs`, title "Packet Interceptor" | Server combo plus Connect / Disconnect (runs a real `CaptureProxy` to 127.0.0.1:5588), packet list, counters, Clear, `chkLogPackets` "Log Packets", send box with Send to Client / Send to Server | `PacketInterceptor.cs:66`-`135`; menu hidden (`Root.cs:977`) |
| Packet logger | `PacketLogger.cs`, title "Packet logger" | Start hooks `Flash.FlashCall` and prints `packetFromClient` traffic; Stop, Copy, Clear; separate "Spammer" row with a text box, `numSpamTimes` times `numSpamDelay` ms, **Spam** (toggles to "Stop") and **Send Once** | `PacketLogger.cs:63`-`75`, `156`-`400` |
| Packet spammer | `PacketSpammer.cs`, title "Packet spammer" | Packet list, text box, Add / Clear / Load / Save, delay, Start / Stop, Send once, Remove | `PacketSpammer.cs:117`-`170`; XML root `<autoer>` with `<packet>` entries |
| Packet Tamperer | `PacketTamperer.cs`, title "Packet Tamperer" | Two rich text boxes (send / receive), `tbFilter` "Filter by text", **Send to server**, **Send to client**, **Clear**, `chkFromClient` "Capture from client", `chkFromServer` "Capture from server" | `PacketTamperer.cs:80`-`141`, `Designer.cs:245`-`297` |
| Plugin Manager | `PluginManager.cs`, title "Plugin Manager" | Plugins folder tree, "Loaded plugins" list, "Unload selected plugin", description box, "Plugin created by:", "Load plugin" with browse and Load, loads .NET DLLs implementing `IGrimoirePlugin` | `PluginManager.cs:43`, `65`-`179`; interface at `Tools/Plugins/IGrimoirePlugin.cs` |
| PvP | `PvP.cs`, title "PvP" | "Skill Hack": cooldown Index and Value plus Set (`Player.SetSkillCooldown`), range Index and Value plus Set (`Player.SetSkillRange`); "Auto Target": player combo plus "Lock" (`Player.SetTargetPvP`) | `PvP.cs:43`, `56`, `79`-`82`; menu hidden (`Root.cs:909`) |
| Raw Command Editor | `RawCommandEditor.cs`, title "Raw Command Editor" | Static `Show` dialog: OK / Cancel plus a JSON text box | `RawCommandEditor.cs:9` |
| Command Editor | `UserFriendlyCommandEditor.cs`, title "Command Editor" | Per-command form built by reflection: one labelled text box per property, OK / Cancel, "Raw Command Editor" button, "Get Cell / Map / Pad" helpers | `UserFriendlyCommandEditor.cs:82`-`200` |
| Command Node Editor | `CommandNodeEditor.cs` (`NodeEditor`), title "Command Node Editor" | Drag command classes from the list onto a canvas; nodes are draggable and resizable with an X button and the Delete key | `CommandNodeEditor.cs:31`-`147`; menu hidden (`Root.cs:899`) |
| Set | `Set.cs`, title "Set" | List of saved sets, inventory combo, Save / Add / refresh / Load / Clear | `Set.cs:88`-`259`; `Sets` next to the exe, `*.gset` |
| Skill Preset | `SkillPreset.cs`, title "Skill Preset" | Empty form, no controls | `SkillPreset.cs:13`; dead |
| Fast travels | `Travel.cs`, title "Fast travels" | see 3.1 | none |
| Browser form | `BrowserForm.cs`, title "BrowserForm" | CefSharp browser with Back / Forward / URL box / Go and a Discord button; no menu entry reaches it and the single call site is commented out | `BrowserForm.Designer.cs:11`, `Tools/Grabber.cs:798`; dead |

### 3.1 Fast travels (`Travel.cs`)

| Group | Buttons | Source |
|---|---|---|
| Fast travels | Dage, Escherion, Klunk (underworld), Binky (doomvault), Nulgath / Skew (tercess), Swindle (tercess), VHL/Taro/Zee (tercess), Twins (tercess), Oblivion (tercess), Polish (tercess), Lae (tercess), Carnage / Ninja (tercess); `chkPriv` "Private" with `numPriv` | `Travel.cs:258`-`556` |
| Awe Enchantment Shop | Awe Shop (museum), Lucky, Hybrid, Healer, Fighter, Thief, Wizard | `Travel.cs:457`-`556` |
| Fast travels 2 | DoomvaultB, Ultraboss & Daily, Necrodungeon, Tower of Doom 10, Ultradrakath, Treetitanbattle | `Travel.cs:565`-`619` |
| Map Bypasser | "Story Quest ID that required to unlock the map", Unlock, "Bypass All", read-only "Generated packet" plus Copy | `Travel.cs:635`-`701`, `902` |

### 3.2 Loaders and grabbers (`Loaders.cs`)

| Group | Controls | Source |
|---|---|---|
| Loaders | `cbLoad` = Hair shop, Shop, Quest, Armor customizer; `txtLoaders`; `numTQuests` (1-30); `btnForceAccept` "F Accept"; `cbGhost` "Ghost" | `Loaders.cs:370`-`374`, `479`, `534` |
| Grabbers | `cbGrab` = Shop items, Quest IDs, Quest items, drop rates, Inventory items, Temp inventory items, Bank items, Monsters, All Monsters; `txtSearchGrab` "Search"; `btnSearchGrab` "Search"; `btnGrab` "Grab"; `cbOrderBy` = Name, Id; `btnSave` "Save" (XML) | `Loaders.cs:398`-`406`, `516`-`519`, `421`-`454` |
| Right-click menus | Item, shop, quest and monster context menus: Go to Wikipage, Search on Wiki, Copy To Clipboard, Load Shop, Equip SWF, Add buy command, Buy This Item (with an AC-cost warning variant), Add to quest list, Accept Quest, Complete Quest (Once), Complete Quest (Maxed), Load Quest, Copy all Reqs, Copy Bypass Packet; aggregate menus: Add all to both, Add all to whitelist, Add all to unbank list, Search all on Wiki, Copy all | `Tools/Grabber.cs:356`-`800` |

Wiki searches open the system browser (`Grabber.cs:796` `Process.Start`).

---

## 4. Hotkeys

### 4.1 What ships by default

Nothing. `InstalledHotkeys` starts empty (`Hotkeys.cs:127`) and is only filled from
`hotkeys.json` when that file exists (`Hotkeys.cs:226`-`241`). `LoadHotkeys` is called from
`Root.cs:113` at startup. Save writes the whole list back as JSON (`Hotkeys.cs:221`-`223`). So the
exact hotkey set is whatever the user created; what matters for parity is the action vocabulary.

### 4.2 Keys the picker offers

`cbKeys` (`Hotkeys.cs:328`-`384`): Escape, Left, Up, Right, Down, D0-D9, A-Z, F1-F12, Alt, Tab,
Shift. **Single keys only - no Ctrl or Shift combinations.**

### 4.3 Actions

`cbActions` (`Hotkeys.cs:394`-`417`), in order. The index is what gets persisted as
`ActionIndex`, so the order is part of the file format:

| # | Label | Effect |
|---|---|---|
| 0 | Start/Stop Bot | toggles `Root.chkStartBot` |
| 1 | Show Bot | `BotManager` |
| 2 | Show Hotkeys | this window |
| 3 | Show Loaders | `Loaders` |
| 4 | Show Packet Logger | `PacketLogger` |
| 5 | Show Packet Spammer | `PacketSpammer` |
| 6 | Show Packet Tamperer | `PacketTamperer` |
| 7 | Show Fast Travels | `Travel` |
| 8 | Show Maid | `MaidRemake` |
| 9 | Start/Stop Maid | toggles Maid's Enable box |
| 10 | Change Launcher Skin | `ToggleLauncherSkin()` |
| 11 | Cancel Target | `Player.CancelTarget()` |
| 12 | Minimize to tray | shows the main window; the only action that works without focus |
| 13 | Show Bank | `Player.Bank.Show()` |
| 14 | Show Cosmetics form | `CosmeticForm` |
| 15 | Show Logs | `LogForm` |
| 16 | Show Notepad | `Notepad` |
| 17 | Load Hair shop | `Shop.LoadHairShop(1)` |
| 18 | Load Armor Customizer | `Shop.LoadArmorCustomizer()` |
| 19 | Toggle Options | `OptionsManager.Start()` / `Stop()` |
| 20 | Show DropUi | `DropUi` |
| 21 | Show Swf Dev test | `DevTest` |
| 22 | Start/Stop AutoAttack | toggles `Root.chkAutoAttack` |
| 23 | (no label) | a 24th delegate exists that only runs a debug comment (`Hotkeys.cs:121`-`124`) and has no combo entry, so it is unreachable |

### 4.4 How the key hook works

| Piece | Behaviour | Source |
|---|---|---|
| `KeyboardHook` | One shared global `WH_KEYBOARD_LL` hook; fires only for keys in `TargetedKeys` | `Tools/KeyboardHook.cs:15`-`70` |
| `Hotkey.Install` / `Uninstall` | Add or remove the key from `TargetedKeys` | `Tools/Hotkey.cs` |
| Focus filter | A bound key only fires while this app has focus, except "Minimize to tray" | `Hotkeys.cs:245`-`252`, `254`-`263` |
| Second hook | `LowLevelKeyboardHook` is a separate `WH_KEYBOARD_LL` class used only by Maid's global hotkey | `Tools/LowLevelKeyboardHook.cs:6`-`65` |
| Maid R / T | Maid's own KeyDown handler toggles Unfollow on R and StopAttack on T while the Maid window has focus | `MaidRemake.cs:92`, `1050`-`1070` |
| Maid global R / T | with "Global Hotkey" ticked, the same two keys work app-wide through the second hook | `MaidRemake.cs:1026`-`1042`, `1071`-`1088` |

Readme shortcut list (`readme.md:12`-`19`): Ctrl+C copy as .gbot, Ctrl+V paste, Ctrl+S save as
.gbot, Ctrl+Up/Down move command, Ctrl+Add insert above, Alt+Add toggle variant, double-click open
editor. Ctrl+D and Ctrl+Delete exist in code (`BotManager.cs:1751`, `1738`) but are not in the
readme.

---

## 5. Maid (auto-follow and auto-skill)

`Grimoire/UI/Maid/MaidRemake.cs` plus `MaidRemake.designer.cs`, title "Maid Remake"
(`MaidRemake.cs:96`), which becomes "Maid Remake (hh:mm:ss)" while StopAttack is running
(`MaidRemake.cs:1188`).

| Group | Contents | Source |
|---|---|---|
| Header | Enable, Goto Username (`cmbGotoUsername`), Skill List (`tbSkillList` default `1,2,3,4`), Skill Delay with "ms", Skill Preset link | `MaidRemake.designer.cs:100`-`130`, `578`, `257` |
| Options | Ultra Boss w/ Extra (`cmbUltraBoss` = None, Auto Potion, Asc.Solstice P1/P2, Asc.Midnight P1/P2, Ast.Empyrean P1/P2, Gramiel L1/L2/R1/R2), Whitelist Map link, Locked Zone Handler link, "Stop goto after 5 failures", Relog Delay | `designer.cs:150`-`276`, `165`-`177` |
| Hotkey toggles | `cbUnfollow` "Unfollow (R)", `cbStopAttack` "StopAttack (T)", `cbEnableGlobalHotkey` "Global Hotkey" | `designer.cs:329`, `340`, `350` |
| Advanced Options | Anti Counter, Copy Walk, Use heal ("Use", `tbHealSkill` default `1,2`, "if health<", `numHealthPercent`), AttackPriority (`tbAttPriority` default "Defense Drone,Attack Drone"), Buff If StopAttack (`tbBuffSkill` default `2,3`), PartyCmd | `designer.cs:374`-`512` |
| Activation | PartyCmd checkbox, special message box (`tbSpecialMsg` default "converge,truth,resist,bleee"), "msg:", skill action combo, "me" button | `designer.cs:599`-`691` |
| Config | `gbConfig` "Config : Default", Save, Load | `designer.cs:620`, `308`, `318` |
| Special Anims | group box plus `cbSpecialAnims` "skill action:" | `designer.cs:642`, `653` |
| StopAttack indicator | `lbStopAttackBg` turns DeepPink, `cbStopAttack` background turns Magenta, and the main window's `maidStrip` turns `Color.FromArgb(240,50,50)` | `MaidRemake.cs:1136`-`1153` |

Sub-windows: `Maid/WhitelistMap/WhitelistMap.cs`, title "Whitelist Map", "Here's the whitelisted map(s)
that don't need Maid to help you", Add To List, Get Current Map, [Check], [Clear], counter, default text
`newbie;all` (`WhitelistMap.Designer.cs:61`-`194`). And `Maid/LockedMapHandle/LockedMapForm.cs`,
title "Alternative Map(s)", "Here's the map(s) you'll try to join ... when your target is in locked
zone", Add To List, Get Current Map, [Check], [Clear], default list `doomvault`, `doomvaultb`,
`icewing`, `voidflibbi`, `voidnightbane`, `voidxyfrag` (`LockedMapForm.Designer.cs:61`-`193`).

Config files: Save and Load are JSON (`MaidRemake.cs:1419`-`1468`), default folder `Config` next
to the exe, filter "Maid config|*.json". On construction, `AutoLoadConfig` (`:1470`-`1481`)
silently applies `Config/autoload.json` when present. `ApplyConfig` (`:1483` onwards) maps the
schema in `Tools/Maid/MaidConfig.cs:3`-`29`: `Target`, `SkillList`, `LockedZoneHandlerMaps`,
`SafeSkillList`, `BuffStopAttackList`, `AttackPriorityMonster`, `SpecialMsg`,
`WhitelistMapMaps`, `RelogDelay`, `SkillDelay`, `SafeSkillHP`, `SpecialAct`,
`UltraBossExtra`, `AntiCounter`, `CopyWalk`, `AttackPriority`, `BuffStopAttack`,
`WaitSkill`, `StopFailedGoto`, `LockedZoneHandler`, `WhitelistMap`, `GlobalHotkey`,
`SafeSkill`.

### 5.1 The autoload.cfg question

The jib-akbr v1.9.3c release notes say "Maid will load autoload.cfg". The code in both branches loads
`autoload.json`:

- `git grep -i autoload` on `jib/master` returns only `MaidRemake.cs:93` (the call) and
  `MaidRemake.cs:1484` / `1487` (the function and the `autoload.json` path).
- The same on `origin/master`: `MaidRemake.cs:95`, `1470`, `1473`.
- The feature is already in the Froztt13 snapshot read here (`MaidRemake.cs:1470`-`1481`), so it is
  not new in v1.9.3c either.
- The game SWF's string table contains no `autoload` and no `cfg` strings at all (0 hits for
  `grep -i 'autoload|cfg'` over the inflated string dump), so the SWF is not reading it.

Conclusion: the release note and the code disagree on the file name. The file a user has to create is
`Config/autoload.json`, matching `MaidConfig`. Treat "autoload.cfg" as an error in the release notes
unless a later commit changes it.

---

## 6. Options surface as a whole

Two places control the same toggles: the hidden-by-default Options menu (`Root.cs:983`) and
BotManager's Options and Client tabs. With "Enable options without starting", the `ApplySettings` loop
keeps pushing state into the game every ~2 s (`OptionsManager.cs:188`-`217`; `Timer` default
1000 ms in code, UI default 500 ms at `BotManager.Designer.cs:4019`).

The option set is not stored in a config file: the toggles are saved into the bot file, i.e.
`Configuration` fields applied by BotManager `SaveConfiguration` / `ApplyConfiguration`
(`BotManager.cs:284`-`345`, `442`-`485`), and the per-run values live only in
`OptionsManager`'s statics.

---

## 7. Config files

All are relative to `Application.StartupPath` unless noted.

| File | Purpose | Written by | Read by |
|---|---|---|---|
| `ClientConfig.cfg` | App-level client settings and skill presets | `Root.cs:262` (`flash`), `BotManager.cs:3624` (`botsDir`) | loaded at `Tools/ClientConfig.cs:9`; keys used: `SS.<CLASS>` (`Root.cs:1528`), `flash` (`Root.cs:112`), `botsDir` (`BotManager.cs:1902`, `2268`), `safeCell` (`CmdJoin.cs:89`, `CmdShortHunt.cs:46`, `BotManager.cs:3474`), `logDebugSwf` (`LogForm.cs:144`, `Tools/Flash.cs:386`), `fps` (`Tools/Flash.cs:405`), `nameColor` (`Tools/Flash.cs:643`), `questListDelay` (declared at `Tools/ClientConfig.cs:15`; read site UNVERIFIED) |
| `config.cfg` | List font, list font size, font-size slider value, and per-command drawing colours | `CommandColorForm.cs:26`-`102` (colour and centered), `BotManager.cs:2449`-`2454` (font, fontSize) | `BotManager.cs:2530`-`2534` (`GetColor`), `2547`-`2550` (`GetBoolCentered`), `CommandColorForm.cs:53`-`102`, `Loaders.cs:568`, `LogForm.cs:125`, `Hotkeys.cs:160`, `Networking/Handlers/HandlerSkills.cs:20` |
| `CharSelect.cfg` | Quick-login list, keys `0`, `1`, ... = `username,password` | nothing in the app writes it (grep) | `Root.cs:135` |
| `hotkeys.json` | Installed hotkeys (JSON array of `Hotkey`: Text, Key, ActionIndex) | `Hotkeys.cs:223` | `Hotkeys.cs:230` |
| `MapConfig.cfg` | Map name to `Cell;Pad;RoomId` under a `Map.` prefix | `Tools/MapConfig.cs:26`-`31` via `SetValue`; no UI caller found (UNVERIFIED) | `Tools/MapConfig.cs:11`, `GetMapNames` `:33`-`50` |
| `MapItemLog.txt` | `id = name` map-item names merged on exit, deduped and sorted | `Root.cs:1781`-`1822`, called from `Root.cs:187` | in-memory `Player.recentMapItem` (`Game/Player.cs:444`); the file-based initialiser is commented out (`Player.cs:447`-`479`) |
| `Config/autoload.json` and other `Config/*.json` | Maid configuration | Maid Save dialog `MaidRemake.cs:1419` | `MaidRemake.cs:1470`, `1450` |
| `Sets/*.gset` | Saved cosmetic and gear sets | `Set.cs:217`-`259`, `CosmeticForm.cs:339` | `Set.cs:88`-`108`, `CosmeticForm.cs:350` |
| `Bots/*.gbot` | Saved bots | BotManager Save `BotManager.cs:1369` | BotManager Load `1340`, tree browser `1902`, `2268` |
| `Plugins/*.dll` | Third-party plugins | user drops DLLs in | `PluginManager.cs:65`, `85` |

The command-colour block ships inside `config.cfg`: the repository copy has 116 `<Name>Color` keys
(Variable, Index, ExtendedVariable, AcceptQuest, CompleteQuest, BankList, SetFPS, ClearTemp, Beep,
Blank, BotDelay, Change, ClientMessage, Delay, GotoLabel, GotoPlayer, Int, Label, LoadBot, Return, Log,
Logout, PacketDelay, and on through EquipSet, GetDrop, Load, MapItem, Sell, Attack, Kill, KillFor, Rest,
UseSkill, SkillSet). The skill presets ship in `ClientConfig.cfg` instead (11 `SS.` lines). The two
files are read by different code paths, so do not move the colour block.

---

## 8. Plugin surface

| Item | Behaviour | Source |
|---|---|---|
| Plugins menu | Dropdown that receives plugin-contributed items | `Root.cs:1131`, populated at `1465` and `1470` |
| Plugin DLLs | Loaded from `Plugins` next to the exe; implement `IGrimoirePlugin` (Author, Description, Load, Unload) | `PluginManager.cs:43`, `Tools/Plugins/IGrimoirePlugin.cs` |
| Entry attribute | A class marked `GrimoirePluginEntry` is the entry point | `Tools/Plugins/GrimoirePlugin.cs:69`, `GrimoirePluginEntry.cs:6` |
| Local proxy port | `Program.Main` picks a free port for the game proxy | `Program.cs:20` onwards |

This is a .NET assembly loader and has nothing in common with AquaStar's manifest-based plugin host,
worth calling out explicitly so the parity matrix does not try to map them one to one.

---

## 9. Features that landed after this snapshot

From the GitHub releases (`gh release list` and `gh release view`) and the
`origin/master` to `jib/master` diff in `/tmp/grimlite-probe-2`.

| Version (repo) | Date | User-visible change |
|---|---|---|
| v1.7.1 (Froztt13) | 2025-07-01 | release exists, notes not read (UNVERIFIED); see the in-repo changelog instead |
| v1.7.3 (Froztt13) | 2025-09-19 | `Resources/Notes/changelog.txt:1`-`4`: setvar for equipped item, forge-enhancement equip, Kill cmd optimisations |
| v1.7.4 (Froztt13) | 2025-10-22 | setvar support for the currently equipped item; equip support for a specific forge enhancement; Kill cmd optimisations; **Lag Killer custom background, changed by replacing `Loader/bg.jpg`**; Maid anti-counter fix |
| v2.0 / 2.0.1 / 2.0.2 (Froztt13) | 2025-11 to 2026-02 | v2.0 adds "Force scale DPI for FHD monitors" and a Maid anti-counter Sun's Heat behaviour; v2.0.2 fixes the anti-counter handler and game flash |
| v1.9 (jib-akbr) | 2025-11-30 | fork starts |
| v1.9.2 (jib-akbr) | 2025-12-14 | release exists, notes not read |
| v1.9.3c (jib-akbr) | 2026-10-10 | Aura handled separately from Flash; aura stacks fix; **Respawn Provoke**; visual indicators when Maid is paused or unfollowed; **MapItemId log (mapitemlog.txt)**; **Map Spoofer**; "Aura Duration is lower than ?" statements; **Maid loads autoload.cfg** (see 5.1); Wiki and Charpage buttons work again except inside the "View Drop" tab; **default BotManager tab changed from Combat to Bots** |
| v1.9.4 (jib-akbr) | 2026-10-13 | Rev cmd compatibility; "Ascendeclipse" map typo fix; "Disabling Pext Forward due to double counting issue" |
| v1.9.3 (Froztt13) | 2026-10-15 | current snapshot, this document |

Structural diff, `git diff --stat origin/master jib/master -- Grimoire/UI`:

| File | Change |
|---|---|
| `BotManager.cs` | 109 lines |
| `Loaders.cs` | 391 lines |
| `Maid/MaidRemake.cs` | 174 lines |
| `PacketLogger.cs` | 12 lines (a `pext` handler printing "pext: " lines, truncated at 2000 chars) |
| `PacketTamperer.cs` | 21 lines (same for `FlashUtil_FlashCallServerPext`) |
| `Root.cs` | 4 lines (`cbCells.MaxDropDownItems` 25 to 50) |

The jib branch also adds `CmdRevCompat` classes (Combat, Item, Misc, Statements), `CmdPacketlist`,
`CmdQuestlist`, `CmdUseSkill`, `CmdBuy`, `CmdJoin`, `CmdBotDelay` and `CmdStop`, and ships a
larger `Loader/grimoire.swf` (29 126 to 33 112 bytes). That matters because several UI features are
thin wrappers over SWF calls.

In-repo changelog for older features (`Resources/Notes/changelog.txt`): v1.6.0 Colossal Vordred
auto-zone; v1.5.x Queen Iona, Astral Empyrean, PartyCmd, Special handlers auto-toggling on bot start and
stop; **v1.5 is the built-in Maid, plus Stop Attack and Leave Combat commands and restart-bot-on-AFK**;
v1.4 MonMapID targeting via `id.50` / `id:50` / `id-50` / `id'50`; v1.3 Aura statements;
v1.1.3 buy by item ID; v1.0 a new Skill Command that broke `.gbot` compatibility.
`Resources/Notes/variables.txt` documents packet variables (`{ROOM_ID}`, `{ROOM_NUMBER}`,
`{GETMAP}`, `PLAYERNAME`) and setvar targets (`{weapon}`, `{class}`, `{cape}`, `{helm}`).

---

## 10. AquaStar today, for comparison

Not part of the Grimlite inventory, but the parity matrix needs both sides in one place.

| Grimlite concept | AquaStar equivalent today | Source |
|---|---|---|
| Menu bar inside the game window | Native "Game" menu from the plugin, plus app "AquaStar" and "Tools" menus | `plugins/adventure-quest-worlds/menus.js:278`-`340`, `res/windows/menu.js:134`, `res/windows/menu.js:144` |
| Char Select dropdown | none | - |
| Artix Game Launcher skin | none | - |
| Client toolbar (Start Bot, Auto Attack, Bank, cell and pad) | none; there is no in-page bot panel | `plugins/adventure-quest-worlds/windows.js` |
| Hotkeys window and `hotkeys.json` | keybind recorders in Settings, Keybinds tab, one set per plugin | `res/features/settings/settings.html:148`, `plugins/adventure-quest-worlds/keybinds.js:11`-`25` |
| Bot Manager (11 tabs, `.gbot` editor) | none | - |
| Feature windows (Reminders, To-Do, Inventory, Strategy) | Reminders Alt+T, To-Do Alt+Y, Inventory Alt+I, Strategy Alt+U | `plugins/adventure-quest-worlds/windows.js:67`-`72`, `keybinds.js:19`-`23` |
| Packet logger, spammer, tamperer, interceptor | none; a plugin can use session rules instead | `res/platform/session-rules.js:1`-`8` |
| `.gbot` bots and the `Bots/` tree | none | - |
| Plugin DLL loader plus Plugins menu | manifest plugins, one active per process; the Plugins menu is per-plugin menus | `docs/PLUGINS.md:9`-`25`, `res/platform/plugin-host.js:195`-`429` |
| Skill presets in `ClientConfig.cfg` | none | - |
| Map-item log | none | - |
| Ruffle raw-socket relay (no Grimlite equivalent, the reverse mapping) | `res/socketProxy.js:11`, allowlist at `socketProxy.js:17` | `res/socketProxy.js:1`-`20` |
| Window shapes | game 960x530 with `sandbox:false`, browser `sandbox:true`, settings 640x680 | `res/windows/config.js:22`-`58` |
| Screenshot, recording, fullscreen, reload | F2, Ctrl+J, F11, Ctrl+F5 | `res/const.js:150`-`168` |
| Manual PPAPI verification surface | `docs/FLASH_CHECKLIST.md` | `docs/FLASH_CHECKLIST.md:24`-`55` |

---

## 11. UNVERIFIED items

- `MapConfig.cfg` write path from the UI: `MapConfig.SetValue` exists (`Tools/MapConfig.cs:26`) and
  the class exposes `GetMapNames`, but no caller was found in the tree. Assumed to be a config the
  user edits by hand; not confirmed.
- `questListDelay` read site: the key is declared (`Tools/ClientConfig.cs:15`) and present in
  `ClientConfig.cfg`, but the citing file under `Botting/Commands/Quest/` was not opened in this
  pass.
- Whether `BotManager.cs:3511` setting a `chkAntiMod` tooltip from a `chkUseSkillTargeted` handler is
  an intentional second tooltip or a copy-paste mistake.
- Whether `tabLogDrops` was intentionally dropped from `tabLogs.Controls` or lost in a merge. The
  consequence (the Drops log unreachable) follows from `LogForm.cs:390`-`392` versus `483`-`493`;
  the intent does not.
- The Froztt13 v1.7.1 and v2.0 release-note text was not read in full; only v1.7.4 and v2.0.2 bodies
  were read.
- The reference tree carries uncommitted local edits on top of `816d9cd`; every line cited here was
  read from that working tree, so a line number may drift slightly against a clean checkout.
- `Resources/Notes/Moved to DropBox.txt` says the shipped bots were moved to a Dropbox link; the
  consequence for the `Bots/` folder in a clean clone was not checked.
- No attempt was made to run Grimlite or to verify any of this against a compiled binary.
