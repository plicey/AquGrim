# Grimlite's game-state and packet capabilities

| Field | Value |
|-------|-------|
| **Ticket** | [#4 Which game-state and packet capabilities Grimlite's features need](https://github.com/plicey/AquGrim/issues/4) |
| **Date** | 2026-10-17 |
| **Status** | Research complete; capability inventory ready for [#2](https://github.com/plicey/AquGrim/issues/2)/[#3](https://github.com/plicey/AquGrim/issues/3)/[#7](https://github.com/plicey/AquGrim/issues/7)/[#9](https://github.com/plicey/AquGrim/issues/9) |
| **Reference implementation** | Froztt13/Grimlite-Li @ `816d9cd` (/tmp/grimlite-full); extra ref jib-akbr/Grimlite-Li (older branches, /tmp/grimlite-probe-2) |
| **AquaStar side** | working tree /home/ammar/.codex/worktrees/757d/aqugrim, Electron 11.5.0 + PPAPI Flash |

## Scope and method

Every row below is traced to the C# that performs the read or write, or to the AquaStar module that would have to host it. Line numbers are from the working copies named above.

`Grimoire/Tools/Flash.cs` is the single transport for everything that is not a raw packet: `Flash.Call<T>(name, args...)` builds `<invoke name="name" returntype="xml"><arguments>...</arguments></invoke>` and hands it to `AxShockwaveFlash.CallFunction` (Grimoire/Tools/Flash.cs:159-180); the string overload builds the same envelope with `<string>` args (Grimoire/Tools/Flash.cs:182-207) and json-decodes the reply (Grimoire/Tools/Flash.cs:221-231). The reply is HTML-decoded before parsing, so it must be XML-safe but is otherwise JSON (Grimoire/Tools/Flash.cs:209-219, :233-266). The `Grimoire/FlashTools/*` dynamic layer (`lnkCreate`, `fcCall`, `lnkGetValue`) is referenced only by Grimoire/UI/DevTest.cs, Grimoire/UI/Notepad.cs and Grimoire/FlashTools itself; none of those method names exist in the shipped loader SWF (measured, see section 3), so it is treated as dead code and excluded from the inventory.

Counts measured in the reference clone: 149 .cs files under Grimoire/Botting/Commands (85 statement classes under Misc/Statements/, 64 non-statement files declaring 66 command classes across Combat, Item, Map, Misc and Quest); 36 files under Grimoire/Networking/Handlers including Maid/ (42 class declarations, 33 of them message handlers); 146 distinct `Flash.Call*` function names across the tree; 33 distinct packet shapes sent or synthesised from C#. The ticket's "63 command classes" is low against this tree; the measured figure is 151 `class Cmd*` declarations.

---

## 1. Transport and framing (what any bridge or proxy has to reproduce)

| Capability | Grimlite source | Direction | Type | Observe/mutate | Needs |
|---|---|---|---|---|---|
| Invoke a function on the game's bridge object | Grimoire/Tools/Flash.cs:159-180 (Call), :192-207 (BuildRequest), :209-219 (GetResponse) | C# to SWF | XML envelope, JSON or XML reply | mutate/observe | `ExternalInterface.addCallback` in the movie |
| Read a dot-path in the movie's object graph | Grimoire/Tools/Flash.cs:102-110 (getGameObject, getGameObjectS) | C# to SWF | string | observe | `getGameObject` / `getGameObjectS` |
| Write a dot-path in the movie's object graph | Grimoire/Tools/Flash.cs:129-132 (setGameObject) | C# to SWF | string | mutate | `setGameObject` |
| Call an arbitrary movie function by path | Grimoire/Tools/Flash.cs:74-77, :124-127 (callGameFunction, callGameFunction0) | C# to SWF | mixed args | mutate | `callGameFunction` / `callGameFunction0` |
| Send a client-to-server packet by re-entering the SWF | Grimoire/Tools/Flash.cs:53-56 (SendPacket -> `callGameFunction2("sfc.sendString"/"sfc.sendJson")`), relayed by Grimoire/Networking/Proxy.cs:234-241 | C# to SWF to server | XT or JSON, as a string | mutate | `sfc.sendString` / `sfc.sendJson` |
| Inject a server-to-client packet into the client | Grimoire/Tools/Flash.cs:63-66 (SendClientPacket -> `sendClientPacket(packet, "xml"\|"json"\|"str")`), relayed by Grimoire/Networking/Proxy.cs:248-254 | C# to SWF | XT, JSON or XML | mutate | `sendClientPacket` |
| Full raw TCP path, both directions | Grimoire/Networking/GrimoireClient.cs:144-181 (NUL-delimited, 1024-byte reads with a spill buffer, 16) | socket to C# | raw bytes | observe | a MITM; not needed if the SWF hook is enough |
| Packet classification | Grimoire/Networking/Proxy.cs:213-232 (first char `%`, `<`, `{`) | both | XT, XML, JSON | observe | - |
| Command extraction | Grimoire/Networking/XtMessage.cs:16-19 (split on `%`, index 2, with the `cmd` indirection at index 5); Grimoire/Networking/JsonMessage.cs:13,21 (`b.o.cmd`); Grimoire/Networking/XmlMessage.cs:19 (`body.action`, `cross-domain-policy` to policy) | both | all three | observe | - |
| Handler dispatch by command | Grimoire/Networking/Proxy.cs:34-65, :179-211; default registrations :267-291 | both | all three | observe | - |
| Drop a packet (`message.Send = false`) | Grimoire/Networking/Message.cs:17-21; used at Grimoire/Networking/Handlers/HandlerWarnings.cs:19-22 | both | all three | mutate | - |
| Host-side callback set | Grimoire/Tools/Flash.cs:79-100 (ProcessFlashCall: progress, modifyServers) and :372-471 (CallHandler: debug, openWebsite, connection, progress, modifyServers, getServers, getServers2, packetFromClient, packetFromServer, pext) | SWF to C# | XML envelope | observe/mutate | the SWF must call these names |
| Server-list rewrite (proxy bootstrap) | Grimoire/Tools/Flash.cs:268-347: `sIP` to 127.0.0.1, `iPort` to `Proxy.Instance.ListenerPort`, originals preserved as RealAddress and RealPort | SWF to C# to SWF | JSON or XML | mutate | a hook on the login/servers response |
| Read back the real server address and port | Grimoire/Networking/Proxy.cs:111-112 | C# to SWF | string | observe | `RealAddress` / `RealPort` |
| Member-flag spoof on the server list | Grimoire/Tools/Flash.cs:288-289 (iUpg = 10, iUpgDays = 999) and :318-319 (XML variant) | SWF to C# to SWF | JSON or XML | mutate | client-side only, but ban-adjacent |
| Cross-domain policy port rewrite | Grimoire/Networking/Handlers/HandlerPolicy.cs:15-22 | server to client | XML | mutate | currently unregistered, Grimoire/Networking/Proxy.cs:288-291 |
| Second capture proxy for packet sniffing | Grimoire/GameProxy/CaptureProxy.cs:22,42-46,77-132; UI at Grimoire/UI/PacketInterceptor.cs:81-86 | socket to C# | raw, 4096-byte reads split on NUL | observe | its own listener; `ConnectTo` is UNVERIFIED, see section 3 |

Windows or process specific: the entire call path is ActiveX (`AxShockwaveFlash`, Grimoire/Tools/Flash.cs:1,37,171,213) driving a Windows-only OCX inside a WinForms process. The raw TCP side (Grimoire/Networking/GrimoireClient.cs) is plain .NET sockets and is portable.

---

## 2. Capability inventory by subsystem

Confidence column: **H** means the C# was read and, for a Flash call, the name is present in the loader SWF string table; **M** means the C# was read but the SWF side was not confirmed; **L** means the code is disabled, dead or contradictory.

### 2.1 Combat and targeting

| Capability | Flash call or packet | Grimlite source | Direction | Type | O/M | Conf |
|---|---|---|---|---|---|---|
| Attack by name, or by MonMapID using the `id'`, `id.`, `id:`, `id-` prefix convention | AttackMonster, AttackMonsterByMonMapId | Grimoire/Game/Player.cs:344-366 | C# to SWF | XML | M | H |
| Attack the nearest monster | `AttackMonster("*")` | Grimoire/Botting/Commands/Combat/CmdAttack.cs:25-31 | C# to SWF | XML | M | H |
| Cancel target, cancel self-target, cancel auto-attack | CancelTarget, CancelTargetSelf, CancelAutoAttack | Grimoire/Game/Player.cs:323-333 | C# to SWF | XML | M | H |
| Target presence, target HP, target name, target MonMapID | HasTarget, GetTargetHealth, `GetGameObject("world.myAvatar.target.objData.strMonName")`, same for MonMapID | Grimoire/Game/Player.cs:240,246,373,411 | C# to SWF | XML and string | O | H for the calls; the two dot-paths are UNVERIFIED (see section 3) |
| HP, HP max, MP, MP max, level, gold, state, position | Health, HealthMax, Mana, ManaMax, Level, Gold, State, Position | Grimoire/Game/Player.cs:186,204-261 | C# to SWF | XML | O | H |
| Are all skills off cooldown | AllSkillsAvailable | Grimoire/Game/Player.cs:251 | C# to SWF | XML | O | H |
| Per-skill cooldown and ready check | SkillAvailable, GetSkillCooldown, IsSkillReady (SWF only) | Grimoire/Game/Player.cs:274,279 | C# to SWF | XML | O | H |
| Use a skill, or force-use it ignoring the cooldown gate | UseSkill, ForceUseSkill | Grimoire/Game/Player.cs:396,398 | C# to SWF | XML | M | H |
| Rewrite skill cooldown, range and mana cost | SetSkillCooldown, SetSkillRange, SetSkillMana | Grimoire/Game/Player.cs:285,290,295 | C# to SWF | XML | M | H, ban-prone |
| Rest to recover | Rest | Grimoire/Game/Player.cs:378; Grimoire/Botting/Commands/Combat/CmdRest.cs:26 | C# to SWF | XML | M | H |
| Apply a buff (haste 50 percent, mana refill) | Buff | Grimoire/Game/Player.cs:338 | C# to SWF | XML | M | H, ban-prone |
| Locked-action gate before an action | IsActionAvailable against a 14-entry noun table | Grimoire/Game/World.cs:199,303-361 | C# to SWF | XML | O | H |
| Monster presence, monsters in a cell, monster HP, visible monsters | IsMonsterAvailable, IsMonsterAvailableByMonMapID, GetMonstersInCell, GetVisibleMonstersInCell, GetMonsterHealth | Grimoire/Game/World.cs:30-75,203-227 | C# to SWF | XML and JSON | O | H |
| Target a player, or auto-target PvP | SetTargetPlayer, SetTargetPvP | Grimoire/Game/Player.cs:300,406 | C# to SWF | XML | M | H |
| Taunt cycle: jump-target, cast slot 5, hop back | AttackMonster, SkillAvailable, UseSkill | Grimoire/Botting/Commands/Misc/CmdTauntcycle.cs:20-36 with Grimoire/Networking/Handlers/TauntCycle.cs:37-65 | C# to SWF | XML | M | H |
| Stop attacking while a boss is countering | `anims[].msg == "prepares a counter attack"` sets the stop-attack flag | Grimoire/UI/Maid/MaidRemake.cs:732-777; Grimoire/Botting/Commands/Combat/CmdKill.cs:48-69 | server to client | JSON (`b.o.anims`) | O | H |
| Wait for all skills before a kill | AllSkillsAvailable used as a delay | Grimoire/Botting/Commands/Combat/CmdKill.cs:42-43 | C# to SWF | XML | O | H |

### 2.2 Map and cells

| Capability | Flash call or packet | Grimlite source | Direction | Type | O/M | Conf |
|---|---|---|---|---|---|---|
| Read current map, cell and pad | Map, Cell, Pad | Grimoire/Game/Player.cs:176-229 | C# to SWF | XML | O | H |
| Join a map, cell and pad | `Join(map, cell, pad)` | Grimoire/Game/Player.cs:380; Grimoire/Botting/Commands/Map/CmdJoin.cs:23-72 | C# to SWF | XML | M | H |
| Move to a cell and pad | `Jump(cell, pad)` | Grimoire/Game/Player.cs:375-376 | C# to SWF | XML | M | H |
| Walk to an arbitrary x and y | `WalkToPoint(x, y)` | Grimoire/Game/Player.cs:318; auto-zone handlers pass hard-coded coordinates | C# to SWF | XML | M | H |
| Cell list, players in map, player by name | GetCells, PlayersInMap, Players, PlayerByName (SWF), GetItemTree | Grimoire/Game/World.cs:154-158 | C# to SWF | XML and JSON | O | H |
| Room id and room number (used in outgoing packets) | RoomId, RoomNumber | Grimoire/Game/World.cs:165-167 | C# to SWF | XML | O | H |
| Set respawn point to the current pad | SetSpawnPoint | Grimoire/Game/World.cs:201 | C# to SWF | XML | M | H |
| Reload the map, or load a map SWF directly | ReloadMap, `LoadMap(mapSwf)` | Grimoire/Game/World.cs:141-148 | C# to SWF | XML | M | H |
| Map-load gate | MapLoadComplete | Grimoire/Game/World.cs:152 | C# to SWF | XML | O | H |
| Follow a player by cell and pad, or copy their walk | XT `uotls`, reading strFrame, strPad, tx, ty, then MoveToCell or WalkToPoint | Grimoire/Networking/Handlers/HandlerFollow.cs:13-38; Grimoire/Networking/Handlers/Maid/CopyWalkHandler.cs:12-63 | server to client | XT | observe, then mutate | H |
| Jump to a player's cell (Maid cell jumper) | XT `uotls` plus the whitelist map config | Grimoire/Networking/Handlers/Maid/CellJumperHandler.cs:31-88 | server to client | XT | observe, then mutate | H |
| Go to a player | `GoTo(name)`, or XT `%xt%zm%cmd%1%goto%{user}%@ | Grimoire/Game/Player.cs:388; Grimoire/UI/Maid/MaidRemake.cs:896-902 | C# to SWF or C# to server | XML or XT | M | H |
| Handle a locked zone when jumping to a player | XT `warning` text match, then join an alternative map or `whitemap-NNNNN` | Grimoire/Networking/Handlers/Maid/WarningMsgHandler.cs:29-61 | server to client | XT | observe, then mutate | H |
| Force a private room number on an incoming teleport | XT `tfer` argument 7 rewritten | Grimoire/Networking/Handlers/HandlerXtJoin.cs:39-87 | server to client | XT | mutate | H |
| Map spoofing: rename the area, and the house name | `setGameObject("world.strAreaName")`, `setGameObject("world.objHouseData.unm")`, `callGameFunction0("updateAreaName")`, plus `setGameObject("ui.mcInterface.areaList.title.t1.htmlText")` for the area bar | Grimoire/Game/World.cs:247-297; trigger at Grimoire/Tools/Flash.cs:674-684 | C# to SWF | dot-path writes | mutate | H for the calls, M for the exact paths; ban-prone |
| Player count in the area (for the spoofed label) | `getGameObject("world.areaUsers.length")` | Grimoire/Game/World.cs:272 | C# to SWF | string | O | H |

### 2.3 Quests

| Capability | Flash call or packet | Grimlite source | Direction | Type | O/M | Conf |
|---|---|---|---|---|---|---|
| Read the whole quest tree | GetQuestTree, LoadQuest, LoadQuests, `GetQuests(idList)` | Grimoire/Game/Data/Quests.cs:21,65-86 | C# to SWF | XML and JSON | O | H |
| Read quest progress, iValue and iSlot | `callGameFunction2("world.getQuestValue", iSlot)` | Grimoire/Game/Data/Quests.cs:107-112; Grimoire/Botting/Commands/Combat/CmdQuestHunt.cs:44 | C# to SWF | XML | O | M (both SWFs contain `getQuestValue`; the wrapper is callGameFunction) |
| Max turn-ins for a quest | `callGameFunction2("world.maximumQuestTurnIns", questId)` | Grimoire/Game/Data/Quest.cs:298 | C# to SWF | XML | O | M |
| Accept a quest | `Accept(questId)` | Grimoire/Game/Data/Quests.cs:65; Grimoire/Game/Data/Quest.cs:223-226 | C# to SWF | XML | M | H |
| Ghost accept | raw XT `%xt%zm%acceptQuest%1%{questId}%@ | Grimoire/Game/Data/Quest.cs:228-231; Grimoire/Game/Data/Quests.cs:66 | C# to server | XT | M | H, ban-prone |
| In progress, completable, available checks | IsInProgress, CanComplete, IsAvailable | Grimoire/Game/Data/Quests.cs:88-102; Grimoire/Game/Data/Quest.cs:201-221 | C# to SWF | XML | O | H |
| Complete a quest, with quantity and item pick | `Complete(questId[, qty[, itemId]])` | Grimoire/Game/Data/Quest.cs:233-266 | C# to SWF | XML | M | H |
| Quest completion and quest-load notifications | JSON `ccqr` and `getQuests` | Grimoire/Networking/Handlers/HandlerQuestComplete.cs:8-24; HandlerGetQuests.cs:8-26 | server to client | JSON | O | H |
| Refresh the quest tree from a script | QuestTreeRefresh to GetQuestTree | Grimoire/Game/Player.cs:25-41; Grimoire/Tools/Grabber.cs:68-113 | C# to SWF | XML and JSON | O | H |
| Fake quest progress | client-injected `{"cmd":"updateQuest","iValue":N,"iIndex":M}` | Grimoire/UI/Travel.cs:813-823; Grimoire/UI/BotManager.cs:2408-2417; Grimoire/Tools/Grabber.cs:572-579; also present in the shipped .gbot corpus | client injection | JSON | M | H, ban-prone |
| Old pext quest taps | `getQuests`, `ccqr` and `loadShop` cases commented out of ProcessPext | Grimoire/Tools/Flash.cs:739-759 | - | JSON | - | L, superseded by the handlers |

### 2.4 Inventory, bank, shop and drops

| Capability | Flash call or packet | Grimlite source | Direction | Type | O/M | Conf |
|---|---|---|---|---|---|---|
| Inventory, temp inventory and house contents | GetInventoryItems, GetItemTree, GetTempItems, GetHouseItems, GetItemByName, GetInventoryItemByName, GetBankItemByName | Grimoire/Game/Data/Inventory.cs:14-39; Bank.cs:13-37; TempInventory.cs:12; House.cs:11-13 | C# to SWF | JSON | O | H |
| Slot counts | InventorySlots, UsedInventorySlots, BankSlots, UsedBankSlots, HouseSlots | same files | C# to SWF | XML | O | H |
| Bank view, listing and load | ShowBank, GetBank, LoadBankItems; also XT `%xt%zm%loadBank%{roomId}%All%@ | Grimoire/Game/Data/Bank.cs:86-99; Grimoire/UI/Root.cs:1732 | C# to SWF or C# to server | XML or XT | M | H |
| Transfer and swap bank items | TransferToBank, TransferToInventory, `BankSwap(a, b)` | Grimoire/Game/Data/Bank.cs:39-43 | C# to SWF | XML | M | H |
| Inventory push from the server | JSON `loadInventoryBig` triggers `Player.Bank.GetBank()` | Grimoire/Tools/Flash.cs:670-672 | server to client | JSON | O | H |
| Load a shop, reset shop info, hair shop, armour customiser, shop-loaded check | LoadShop, ResetShopInfo, LoadHairShop, LoadArmorCustomizer, IsShopLoaded | Grimoire/Game/Data/Shop.cs:43,174-220 | C# to SWF | XML | M | H |
| Buy by name, by quantity, or by item and shop-item id | BuyItem, BuyItemQty, BuyItemQtyById | Grimoire/Game/Data/Shop.cs:45-81 | C# to SWF | XML | M | H |
| Sell, including whole-stack | raw XT `%xt%zm%sellItem%{roomId}%{itemId}%{qty}%@ | Grimoire/Game/Data/Shop.cs:193-205 | C# to server | XT | M | H |
| Read the shop item table (stacks, cost, merge requirements) | `getGameObject("world.shopinfo.items")` | Grimoire/Game/Data/Shop.cs:153-170 | C# to SWF | JSON | O | M |
| Shop loaded notification | JSON `loadShop` with `shopinfo` | Grimoire/Networking/Handlers/HandlerLoadShop.cs:7-25 | server to client | JSON | O | H |
| Loot a drop from the ground | raw XT `%xt%zm%getDrop%{roomId}%{itemId}%@ with a 3 s per-item cooldown | Grimoire/Game/DropStack.cs:71-85 | C# to server | XT | M | H |
| Camp a drop by name | DropStack.GetDrop(name) resolving to an item id | Grimoire/Game/DropStack.cs:59-85; Grimoire/Botting/Commands/Item/CmdGetDrop.cs:14-21 | C# to server | XT | M | H |
| Read the drop stack | JSON `dropItem` delivered to `World.OnItemDropped` | Grimoire/Game/DropStack.cs:49-56; Grimoire/Tools/Flash.cs:695-715 | server to client | JSON | O | H |
| Reject unwanted drops | `RejectDrop(name, id)` | Grimoire/Tools/Flash.cs:709,713; Grimoire/Networking/Handlers/HandlerDropItem.cs:37-52 | C# to SWF | XML | M | H |
| Drop-consumed confirmation | JSON `getDrop` with `bSuccess == 1` removes the item from the stack | Grimoire/Tools/Flash.cs:690-693 | server to client | JSON | O | H |
| Equip item and potion, read equipped cosmet | Equip, EquipPotion, SetEquip, GetEquip | Grimoire/Game/Player.cs:382-385; Grimoire/Botting/CosmeticEquipment.cs:40-63 | C# to SWF | XML, including an object argument | M and O | H |
| Pick up a map item | `GetMapItem(id)`, and raw XT `%xt%zm%getMapItem%1%{id}%@ | Grimoire/Game/Player.cs:400-402; Grimoire/Botting/Commands/Combat/CmdQuestHunt.cs:197 | C# to SWF or C# to server | XML or XT | M | H |
| Identify what a map item was | JSON `addItems` resolves the name through temp inventory | Grimoire/Networking/Handlers/MapItemHandler.cs:21-55; spawned from Grimoire/Tools/Flash.cs:509-538 | server to client | JSON | O | H |
| Buy back from the website using the in-game credentials | HTTP POST to `account.aq.com/inventory.aspx?tab=buyback`; credentials read out of the SWF | Grimoire/Tools/Buyback/AutoBuyBack.cs:12,16-18,32-48; scraper Grimoire/Tools/Buyback/BuyBackPage.cs:16-45; Grimoire/Game/Player.cs:126,142; command Grimoire/Botting/Commands/Item/CmdBuyBack.cs:21-41 | out-of-band HTTP | HTML | M | H, ban-prone, and it keeps the account password in the client |

### 2.5 Auras and buffs

| Capability | Flash call or packet | Grimlite source | Direction | Type | O/M | Conf |
|---|---|---|---|---|---|---|
| Aura value on self or on a monster | `GetAurasValue(isSelf, name)` | Grimoire/Game/Player.cs:421-427 | C# to SWF | XML | O | H |
| Aura remaining time on a monster | `AuraDuration(isSelf, name)`, returned as "current/max" | Grimoire/Game/Player.cs:428-441 | C# to SWF | XML | O | H |
| Aura value, duration and stack changes from the packet stream, per target | JSON `aura+` and `aura-` with `tInf` = `p:{uid}` or `m:{monId}`, and `aura.nam / val / dur / isNew` | Grimoire/Tools/Flash.cs:550-618; caches Grimoire/Game/AuraSystem.cs:48-152 | server to client | JSON | O | H |
| Aura "on apply" text (msgOn) captured for bot statements | JSON `aura.msgOn` appends to `Configuration.LastAuraMessages` | Grimoire/Tools/Flash.cs:611-616 | server to client | JSON | O | H |
| Animation text (anims) captured for bot statements | JSON `ct.anims[].msg` | Grimoire/Networking/Handlers/HandlerSpecialAnims.cs:10-36; Grimoire/UI/Maid/MaidRemake.cs:674-728 | server to client | JSON | O | H |
| Aura expiry bookkeeping | TickCount-based ExpireTime, pruned by `Update()` | Grimoire/Game/AuraSystem.cs:17-46,143-152 | local | - | O | H |
| Clear self auras on clearAuras, reset monster caches on moveToArea | cache maintenance only | Grimoire/Tools/Flash.cs:682-688 | server to client | JSON | O | H |
| Reset all auras on respawn | `Flash.Call("ResetAura")` on the client XT `resPlayerTimed` | Grimoire/Tools/Flash.cs:504-507 | C# to SWF | XML | M | UNVERIFIED, ResetAura is in neither SWF string table |
| Re-apply auras after packet loss | comment only, no code | Grimoire/Tools/Flash.cs:505 | - | - | - | L |

### 2.6 World, players and chat

| Capability | Flash call or packet | Grimlite source | Direction | Type | O/M | Conf |
|---|---|---|---|---|---|---|
| Player dictionary, avatars, player by name | Players, GetAvatars, PlayerByName (SWF) | Grimoire/Game/World.cs:16-22; Grimoire/Game/Player.cs:305 | C# to SWF | JSON | O | H |
| Is a given player in my cell | `GetCellPlayers(name)`, CheckCellPlayer, CheckPlayerInMyCell (SWF) | Grimoire/UI/Maid/MaidRemake.cs:33-44; Grimoire/Botting/Commands/Misc/Statements/CmdPlayerIsInMyCell.cs:23 | C# to SWF | XML or string | O | H |
| Another player's HP and HP percentage | GetPlayerHealth, GetPlayerHealthPercentage | Grimoire/Game/World.cs:169-171 | C# to SWF | XML | O | H |
| Access level of a player, for staff detection | `GetAccessLevel(name)` | Grimoire/Game/Player.cs:412; used at Grimoire/UI/BotManager.cs:3217-3259 | C# to SWF | XML | O | H |
| Faction reputation list | GetFactions | Grimoire/Game/Player.cs:90 | C# to SWF | JSON | O | H |
| Player movement updates | XT `uotls` with `mvts, sp, px, py, strFrame, strPad, tx, ty` | Grimoire/Networking/Handlers/Maid/CellJumperHandler.cs:31-88; CopyWalkHandler.cs:12-63 | server to client | XT | O | H |
| Chat, whispers and warnings | XT `chatm`, `warning`, `whisper`, `message` | Grimoire/Networking/Handlers/HandlerChat.cs:10-41 | server to client | XT | O | H |
| Own chat lines and local notices | `callGameFunction2("chatF.pushMsg", type, msg, sender, ...)` | Grimoire/Botting/Commands/Misc/CmdClientMessage.cs:51-53; CmdLog.cs:119-120 | C# to SWF | XML | M | M, `pushMsg` exists in both SWFs but the full path does not |
| Change display name and guild tag locally | ChangeName, ChangeGuild | Grimoire/UI/BotManager.cs:114-133; Grimoire/Botting/Commands/Misc/CmdChange.cs:20-26 | C# to SWF | XML | M | H, ban-prone (client-side identity spoof) |
| Change name colour or access level | ChangeColorName, ChangeAccessLevel | Grimoire/Tools/Flash.cs:639-654; Grimoire/Game/Player.cs:316 | C# to SWF | XML | M | H, ban-prone |
| Gender swap | read Gender, then inject a `genderSwap` JSON packet | Grimoire/UI/BotManager.cs:3603-3610 | C# to SWF and client injection | XML and JSON | M | H, ban-prone |
| Mute and unmute locally | `MuteToggle(b)` | Grimoire/Game/Player.cs:310 | C# to SWF | XML | M | H |
| Log out, log in, pick a server | Logout, Login, FixLogin(user, pass), `Connect(serverName)`, ResetServers, AreServersLoaded, IsTemporarilyKicked | Grimoire/Game/Player.cs:404; Grimoire/Tools/AutoRelogin.cs:13-35 | C# to SWF | XML | M and O | H |
| Session credentials and user id | GetUsername, GetPassword, UserID | Grimoire/Game/Player.cs:43-142 | C# to SWF | XML | O | H (UserID is also in the game SWF; both credential calls are loader-only) |
| Equipped class | Class, cached for 1 s | Grimoire/Game/Player.cs:147-159 | C# to SWF | XML | O | H |
| Cosmetic overrides (skin, pet, weapon, ground) | SetEquip with an object argument | Grimoire/Botting/CosmeticEquipment.cs:40-52; Grimoire/Tools/Grabber.cs:780-785 | C# to SWF | XML object | M | H, ban-prone |
| FPS cap, hide the connection screen, window title | SetFPS, HideConnMC, SetTitle | Grimoire/UI/BotManager.cs:3084-3086,3627-3630; Grimoire/Tools/Flash.cs:405,417 | C# to SWF | XML | M | H |
| Account achievement from the client | raw XT `%xt%zm%setAchievement%79%ia0%18%1%@ | Grimoire/UI/Travel.cs:817 | C# to server | XT | M | H, ban-prone |
| Unlock the Doom Vault B shortcut | two client-injected `updateQuest` packets plus one XT `setAchievement` | Grimoire/UI/Travel.cs:810-829 | client injection and C# to server | JSON and XT | M | H, ban-prone |

### 2.7 Options toggles (the Settings tab)

These are pushed on a timer while the bot runs (`OptionsManager.Timer`, default 1000 ms) and re-applied reactively when the matching packet arrives.

| Capability | Flash call | Re-apply trigger | Grimlite source | Type | O/M | Ban-prone |
|---|---|---|---|---|---|---|
| Infinite range | SetInfiniteRange | JSON `sAct` | Grimoire/Botting/OptionsManager.cs:157,188-215; Grimoire/Tools/Flash.cs:761-764 | XML | M | yes, the classic one |
| Provoke monsters | SetProvokeMonsters | JSON `mtls` on respawn, 50 ms delayed; XT `moveToCell`, 80 ms delayed | OptionsManager.cs:159,184-186,199-202; Flash.cs:473-479,489-495,717-737 | XML | M | yes |
| Enemy magnet | SetEnemyMagnet | 2 s loop | OptionsManager.cs:161,208-209 | XML | M | yes |
| Lag killer | `SetLagKiller("True"/"False")` | 2 s loop, called with both values every tick | OptionsManager.cs:163,214 | XML | M | mild |
| Hide players (destroy avatars) | DestroyPlayers, plus XT `retrieveUserData(s)` filtering | 2 s loop and every user-data packet | OptionsManager.cs:113-122,165,212-213; Grimoire/Networking/Handlers/HandlerPlayers.cs:18-25 | XML and XT | M | mild |
| Skip cutscenes | SetSkipCutscenes | 2 s loop | OptionsManager.cs:167,210-211 | XML | M | mild |
| Walk speed | `SetWalkSpeed(n)`, restored with `SetWalkSpeed("8")` | XT `moveToCell` | OptionsManager.cs:169; Flash.cs:493-494; Grimoire/UI/BotManager.cs:1691-1702 | XML | M | yes |
| Disable animations | JSON `ct` handler with an empty body | registration toggle | OptionsManager.cs:100-111; Grimoire/Networking/Handlers/HandlerAnimations.cs:15-25 | JSON | mutate | L, body is commented out |
| Skill range rewritten to 20000 | JSON `sAct` with `actions.passive/active[].range` rewritten | per packet | Grimoire/Networking/Handlers/HandlerSkills.cs:18-45 | JSON | mutate | yes, but not registered (Grimoire/Networking/Proxy.cs:269) |
| DPS readout from combat packets | `b.o.sarsa[].a[].hp` | per packet | Grimoire/Networking/Handlers/HandlerSkills.cs:48-90 | JSON | O | not registered; logging only |
| Infinite mana | `OptionsManager.InfMana` property only, no call site | - | OptionsManager.cs:39-46 | - | - | L, dead |
| Bot-provoked and script-toggled provoke | CmdProvoke, CmdToggleProvoke set `OptionsManager.ProvokeMonsters` | - | Grimoire/Botting/Commands/Misc/CmdProvoke.cs:9-12; CmdToggleProvoke.cs:13-29 | - | - | yes, inherits provoke |

### 2.8 Maid, auto-zone, auto-relogin and packet tools

| Capability | Mechanism | Grimlite source | Direction | Type | O/M | Conf |
|---|---|---|---|---|---|---|
| Whitelist-based drop rejection | `RejectDrop(name, id)` driven by the bot's drop list | Grimoire/Tools/Flash.cs:701-714; Grimoire/Networking/Handlers/HandlerDropItem.cs:42-52 | C# to SWF | XML | M | H |
| Reject all drops | `Player.isRejectingAllDrop` | Grimoire/Game/Player.cs:443; Flash.cs:712-713 | C# to SWF | XML | M | H |
| Maid follow: cell jump, copy walk, target, warnings | XT `uotls`, `warning`, `server`, `tfer`; GetCellPlayers, MoveToCell, WalkToPoint | Grimoire/UI/Maid/MaidRemake.cs:33-160; Grimoire/Networking/Handlers/Maid/* (7 files) | both | XT and XML | O and M | H |
| Maid: auto-accept party invites | raw XT `%xt%zm%gp%1%pa%{pid}%`@ on JSON `pi` | Grimoire/Networking/Handlers/Maid/PartyInvitationHandler.cs:14-30 | C# to server | XT | M | H |
| Maid: party-chat command bot (.tp .join .acc .turnin .target .stop .start) | XT `chatm` then GetQuests, Accept, Complete, JoinMap | Grimoire/Networking/Handlers/Maid/PartyChatHandler.cs:26-93 | server to client, then C# to SWF | XT then XML | M | H |
| Maid: attack the master's target | JSON `ct` looking for the master in `p` | Grimoire/Networking/Handlers/Maid/TargetHandler.cs:18-34 | server to client | JSON | observe, then mutate | H |
| Maid: taunt and ultra-boss behaviour (Gramiel L1/L2/R1/R2, per-preset offsets) | JSON `ct.anims[].msg` and `tInf`; `AttackMonster("id.N")`; SkillAvailable and UseSkill | Grimoire/UI/Maid/MaidRemake.cs:674-728,1196-1230 | server to client and C# to SWF | JSON then XML | O and M | H |
| Maid: class rotations (EC, LC, AI, ArchMage, ArchPaladin, potions, Chrono Shadow force-cast) | GetAuras, SkillAvailable, ForceUseSkill, EquipPotion, GetTargetName | Grimoire/UI/Maid/MaidRemake.cs:455-600; Grimoire/Tools/Maid/ClassPreset.cs; preset strings Grimoire/Tools/Maid/MaidConfig.cs:5-27 | C# to SWF | XML | O and M | H |
| Auto-relogin sequence: wait out the kick, reset servers, log in, wait for servers, connect, wait for the map, optionally re-check | IsTemporarilyKicked, ResetServers, Login or FixLogin, AreServersLoaded, Connect(server), MapLoadComplete, Logout | Grimoire/Tools/AutoRelogin.cs:37-120; driven from Grimoire/Botting/Bot.cs:242-269 | C# to SWF | XML | M | H |
| Auto-relogin preserves the toggle state across the login | snapshot and restore in the bot loop | Grimoire/Botting/Bot.cs:244-268 | local | - | - | H |
| AFK to logout, or restart the bot on AFK | XT `uotls` with `afk:true` for the player's own username | Grimoire/Networking/Handlers/HandlerAFK.cs:18-37 | server to client | XT | observe, then mutate | H |
| Suppress the server's "slow down" warning while the bot runs | XT `warning` argument match sets `Send = false` | Grimoire/Networking/Handlers/HandlerWarnings.cs:17-23 | server to client | XT | mutate | H, ban-adjacent |
| Anti-mod: detect staff and stop the bot or log out | JSON `initUserDatas` and `uotls` with `GetAccessLevel` | Grimoire/UI/BotManager.cs:3198-3267 | server to client then C# to SWF | JSON and XT then XML | observe, then mutate | defensive |
| Auto-zone handlers for six bosses plus Astral Empyrean P1/P2 | JSON `event` with `args.zoneSet` of A, B or default, then WalkToPoint with hard-coded coordinates | Grimoire/Networking/Handlers/HandlerAutoZoneUltraDage.cs:6-31; DarkCarnax.cs:6-32; AstralEmpyrean.cs:6-31; AstralEmpyreanP1.cs:53-160; QueenIona.cs:7-54; Vordred.cs:6-31 | server to client then C# to SWF | JSON then XML | observe, then mutate | H |
| Ultra Gramiel taunt handler (four presets) | JSON `ct.anims` for `defense shattering`, crystal ids 2 and 3, a 4-slot 20 s cycle, Focus and Vendetta auras, ForceUseSkill and UseSkill | Grimoire/Networking/Handlers/HandlerUltraGramielTaunt.cs:47-219,234-356 | server to client and C# to SWF | JSON and XML | O and M | H |
| Ultra Speaker mechanics (DPS, LR, LOO, AP) | JSON `ct` anims, continuous repositioning, healing allies below 70 percent, 50-attempt taunt spam | Grimoire/Networking/Handlers/HandlerUltraSpeakerMechanics.cs:49-160,300-393,403-418 | server to client and C# to SWF | JSON and XML | O and M | H |
| Scriptable special-handler switch (Gramiel P1 to P4, Ultra Speaker roles, Auto Zone entries) | UI-driven handler registration marshalled through `Control.Invoke` | Grimoire/Botting/Commands/Misc/CmdSpecialHandler.cs:29-52; Grimoire/UI/BotManager.cs:3348-3467 | local | - | - | H, WinForms-specific |
| Packet spammer (list of packets, fixed delay) | `Proxy.SendToServer` in a loop | Grimoire/Tools/Spammer.cs:28-54 | C# to SWF then server | XT or JSON | M | yes |
| Background packet spammer as a bot statement | same, driven by the bot engine; the command body itself is a no-op | Grimoire/Botting/Bot.cs:409-431; Grimoire/Botting/Commands/Misc/CmdBackgroundPacket.cs:16-19 | C# to server | XT or JSON | M | yes |
| Scripted send of an arbitrary packet, with placeholders | Proxy.SendToServer and SendToClient | Grimoire/Botting/Commands/Misc/CmdPacket.cs:41-85; CmdPacketDelay.cs:29-63 | both | XT, JSON, XML | M | H |
| Free-text packet send, log and tamper UI | SendToServer and SendToClient, logger subscribed to packetFromClient | Grimoire/UI/PacketTamperer.cs:47-122; Grimoire/UI/PacketLogger.cs:66-81 | both | all three | M | H |
| Log every `%xt%zm%@ packet | handler on ReceivedFromClient | Grimoire/UI/PacketLogger.cs:87 | client to C# | XT | O | H |
| Crafting and dungeon-queue packets in shipped bots | XT `%xt%zm%crafting%`, `%xt%zm%aggroMon%`, `%xt%zm%dungeonQueue%`, `%xt%zm%mtcid%`, `%xt%zm%mv%`, `%xt%zm%setAchievement%` | Resources/Bots/** (60 .gbot fixtures) sent through CmdPacket | C# to server | XT and JSON | M | yes |

### 2.9 Script statements (85 classes)

All 85 live under Grimoire/Botting/Commands/Misc/Statements/. They are predicates and assignments evaluated against state produced by the calls above, and send no packets of their own. Symbol usage, measured across that folder:

| State read | Files | Examples |
|---|---|---|
| `Player.Inventory` | 10 | CmdInInventory.cs, CmdNotInInventory.cs, CmdIsMaxStack.cs |
| `Player.GetAuras` | 6 | CmdPlayerAuraEquals.cs, CmdPlayerAuraGreaterThan.cs, CmdPlayerAuraLessThan.cs |
| `Player.Quests` | 6 | CmdQuestAvailable.cs, CmdQuestInProgress.cs, CmdQuestCompleted.cs |
| `World.PlayersInMap` | 6 | CmdPlayerInMyCell.cs, CmdPlayerInRoom.cs |
| `Player.HasTarget` | 5 | CmdHasTarget.cs, CmdNotHasTarget.cs |
| `Player.Bank`, `Player.Cell`, `Player.TempInventory`, `Player.Factions`, `Player.Gold`, `Player.Health` / `HealthMax`, `Player.Mana`, `Player.Level`, `Player.Map`, `Player.IsMember`, `Player.CurrentState`, `Player.House` | 2 to 4 each | CmdInBank.cs, CmdCellIs.cs, CmdInTemp.cs, CmdInCombat.cs, CmdInHouse.cs |
| `World.GetMonsterHealth`, `World.IsMonsterAvailable`, `World.VisibleMonsters`, `World.GetPlayerHealthPercentage`, `World.DropStack`, `Player.GetTargetHealth`, `AuraManager.EnemyAura` | 1 to 2 each | CmdMonsterHealthGreaterThan.cs, CmdTargetAuraDuration.cs, CmdItemPickupable.cs |
| Statement-only state | - | CmdSetVar.cs, CmdUpdateVar.cs, CmdInt*, CmdLabel.cs, CmdGotoLabel.cs, CmdDelay.cs, CmdBlank*.cs, CmdIndex.cs, CmdReturn.cs, CmdSpecialAnims.cs |

One caveat: `CmdPlayerAura*` and `CmdTargetAura*` read the `AuraManager` caches, which are only filled by the `aura+` and `aura-` packet tap in section 2.5, not by a Flash call. A bridge that only exposes `GetAurasValue` gives those statements a different, often one-packet-stale, source than Grimlite's.

### 2.10 Commands with no game dependency

CmdBeep (Console.Beep, Grimoire/Botting/Commands/Misc/CmdBeep.cs:14-20), CmdPing (Console.Beep, Grimoire/Botting/Commands/Misc/CmdPing.cs:14), and the files with no `Player.`, `World.` or `Flash.` symbol at all: CmdDelay, CmdBotDelay, CmdRestart, CmdStop, CmdReturn, CmdLabel, CmdGotoLabel, CmdBlank, CmdBlank2, CmdBlank3, CmdIndex, CmdInt, CmdInt2, CmdWhitelist, CmdBankList, CmdClearTemp, CmdSkillSet, CmdPacketSpammer, CmdSetFPS, CmdLoadBot, CmdBackgroundPacket and ItemType.cs.

---

## 3. What the loader SWF actually exposes

Grimlite does not call the game's ActionScript directly. It ships its own loader (Loader/grimoire.swf, a CWS/zlib SWF, 29 126 bytes, inflating to 48 546) that the app loads instead of the stock one (Grimoire/UI/Root.cs:228,260-264 and the About form default `Loader/grimoire.swf`). That loader:

- loads the real game under `https://game.aq.com/game/` (string table entries `sURL|https://game.aq.com/game/|`, `LoginURL`, `gamefiles/`, `loaderVars`, `Security.allowDomain`, `LoaderInfo.applicationDomain`) and
- registers `ExternalInterface.addCallback` handlers named `grimoire:Externalizer`, `grimoire:Caller`, `grimoire:Root`, `grimoire.game:Player`, `:Settings`, `:Quests`, `:World`, `:Bank`, `:Shops`, `:Inventory`, `:House`, `:TempInventory`, `:AutoRelogin` and `grimoire.tools:SFSEvent`.

Its string table contains the whole mirror of the call list. Measured against the game's own SWF (a 5 253 057-byte decompressed AQW client, plus the two jib builds of the loader), 100 of the 146 call names the C# uses exist **only** in this loader, not in the game: SetInfiniteRange, SetProvokeMonsters, SetEnemyMagnet, SetLagKiller, DestroyPlayers, SetSkipCutscenes, SetWalkSpeed, AttackMonster, AttackMonsterByMonMapId, UseSkill, ForceUseSkill, GetAurasValue, AuraDuration, GetCellPlayers, GetUsername, GetPassword, RealAddress, RealPort, RejectDrop, SetEquip, GetEquip, GetBank, GetInventoryItemByName, WalkToPoint, and 76 more.

Only 33 names appear in **both** tables: Accept, BankSlots, BankSwap, Buff, BuyItem, Cell, Class, Complete, Connect, Equip, Gender, Gold, Health, HouseSlots, Join, Jump, Level, LoadHairShop, LoadShop, Login, Logout, Mana, Map, MapLoadComplete, Pad, Players, Position, Rest, RoomId, SellItem, State, UserID and setGameObject.

Names the C# calls that are in **neither** table, and are therefore UNVERIFIED as real SWF functions: ConnectTo (Grimoire/UI/PacketInterceptor.cs:85), ResetAura (Grimoire/Tools/Flash.cs:506), modifyServers and openWebsite (Grimoire/Tools/Flash.cs:389-397,421-423), plus the six object paths resolved by getGameObject at runtime (those six are present in the game SWF, so they are fine; only the contiguous path `world.myAvatar.target.objData.strMonName` is absent from both tables, which is expected because the path is assembled at runtime).

Consequence for the port: a compatible bridge has to implement the **loader's** API surface, and that surface is defined by the SWF, not by the stock game. The names are verified; the semantics are only as good as the decompiled string table. No bytecode was disassembled for this ticket (see section 6, item 1).

---

## 4. Windows and process-specific mechanisms

| Mechanism | Where | Why it must differ in AquaStar |
|---|---|---|
| ActiveX `AxShockwaveFlash.CallFunction`, the entire Flash.Call path | Grimoire/Tools/Flash.cs:1,37,171,213 | Windows-only OCX; AquaStar has no in-process Flash object, only an object embed in a renderer (res/swf_wrapper.html:36-46) |
| EasyHook patch of `kernel32!GetSystemTime` forcing wYear = 2020 | Hook/EoLHook.cs:17-36; hook and unhook are both commented out at Grimoire/UI/Root.cs:287,317 | Windows kernel32 trampoline; the port needs a renderer clock shim or nothing |
| Win32 low-level keyboard hook (WH_KEYBOARD_LL) for global hotkeys | Grimoire/Tools/KeyboardHook.cs:31-43 and Grimoire/Tools/LowLevelKeyboardHook.cs:14-56; consumed by Grimoire/Tools/Hotkey.cs:30-38, Grimoire/UI/Hotkeys.cs:200-250, Grimoire/UI/Maid/MaidRemake.cs:52 | AquaStar's analogue is Electron globalShortcut (res/keybindings.js:259-270) |
| WinForms cross-thread marshalling (Control.Invoke, InvokeRequired) | Grimoire/UI/BotManager.cs:3442-3467; Grimoire/UI/PacketInterceptor.cs:104-126; Grimoire/UI/PacketTamperer.cs:47-122; Grimoire/UI/Maid/MaidRemake.cs | Electron main and renderer split instead; the port must decide where bot state lives |
| Windows-only side effects: MessageBox.Show, Console.Beep, Clipboard.SetText, Process.Start | Grimoire/Game/Player.cs:129; Grimoire/Game/World.cs:67; Grimoire/Botting/Commands/Misc/CmdBeep.cs:18; CmdPing.cs:14; Grimoire/Botting/Bot.cs:516; Grimoire/Tools/Grabber.cs:567,578,621,633,799 | different APIs, same intent |
| HTML scraping plus a cookie session against account.aq.com | Grimoire/Tools/Buyback/AutoBuyBack.cs:12-48; Grimoire/Tools/Buyback/BuyBackPage.cs:1-45 | .NET-only, and a credential-handling decision the port has to make deliberately |
| WinForms form singletons used as the data model by handlers | Grimoire/Networking/Handlers/Maid/TargetHandler.cs:22-29; Grimoire/UI/Maid/MaidRemake.cs throughout | state lives in the UI process in Grimlite; AquaStar keeps it in main-process modules |
| The proxy runs inside the C# process with direct access to both sockets | Grimoire/Networking/Proxy.cs:67-125 | AquaStar's equivalent is res/socketProxy.js:10-11,36-63, which is a Ruffle-only relay gated by an explicit host allowlist (res/socketProxy.js:14-34, :49-52) |
| The modified SWF itself is the bridge | Loader/grimoire.swf | AquaStar runs Artix's stock loader; the only substitution point today is the platform custom SWF override (res/customSwf.js:13,33,40-47) |

Not Windows-specific, and therefore directly reusable as requirements: the packet formats, the framing, the handler and dispatch model, and the state caches under Grimoire/Game/.

---

## 5. Inherently unsafe or ban-prone capabilities

Ordered roughly by how observable they are to the server.

| Capability | What it does | Source | Why it matters |
|---|---|---|---|
| Packet spammer and background packet | Sends an operator-chosen packet list on a fixed delay | Grimoire/Tools/Spammer.cs:41-54; Grimoire/Botting/Bot.cs:409-431 | Server-visible rate pattern |
| Scripted packet send (CmdPacket, CmdPacketDelay) | Arbitrary packet from a .gbot | Grimoire/Botting/Commands/Misc/CmdPacket.cs:41-85 | The bot format is a packet injector by design |
| Ghost accept | acceptQuest sent without the client state transition | Grimoire/Game/Data/Quest.cs:228-231 | Server action with no UI counterpart |
| updateQuest iValue bypass | Client-injected quest progress | Grimoire/UI/Travel.cs:813-823; Grimoire/UI/BotManager.cs:2408-2417; present in the shipped .gbot corpus | Fakes progress the server did not grant |
| Infinite range (plus the dead HandlerSkills 20000 range rewrite) | Skill range and enemy interaction beyond normal reach | OptionsManager.cs:157; Grimoire/Networking/Handlers/HandlerSkills.cs:34,41 | Classic detectable advantage |
| Provoke, including respawn provoke | Monsters target the player on respawn | OptionsManager.cs:159,184-186; Grimoire/Tools/Flash.cs:717-737 | Changes combat AI in a server-visible way |
| Enemy magnet | Pulls monsters toward the player | OptionsManager.cs:161 | Same class as provoke |
| Walk speed | Client movement speed override | OptionsManager.cs:169; Grimoire/UI/BotManager.cs:1691-1702 | Movement is normally server-validated |
| Skill cooldown, range and mana rewriting | SetSkillCooldown, SetSkillRange, SetSkillMana | Grimoire/Game/Player.cs:285,290,295 | Direct combat-stat manipulation |
| Buff | Sets haste 50 percent and refills mana | Grimoire/Game/Player.cs:338 | Stat manipulation |
| Map spoofing | Rewrites the area name and the house name in the movie | Grimoire/Game/World.cs:247-297 | Client-side deception with a UI effect, and it mislabels the map |
| Name, guild, colour, access level, gender and SetEquip spoofing | Client-side identity and appearance overrides | Grimoire/UI/BotManager.cs:114-133,3603-3610; Grimoire/Game/Player.cs:310-316; Grimoire/Botting/CosmeticEquipment.cs:40-52 | Masquerade, easy to misread as a permissions bug |
| setAchievement packet | Sets an account achievement from the client | Grimoire/UI/Travel.cs:817 | Direct account-state write |
| Buy-back over HTTP with in-game credentials | Logs into account.aq.com with GetUsername and GetPassword and buys items back | Grimoire/Tools/Buyback/AutoBuyBack.cs:16-48 | Credential handling plus an out-of-band session |
| Member-flag bypass | Member flags cleared on initUserDatas; the quest iUpg gate is dropped; quests are force-loaded | Grimoire/Tools/Flash.cs:666-668; Grimoire/Networking/Handlers/HandlerGetQuests.cs | Grays out the client's own gating |
| Slow-down warning suppression | Hides the server's rate-limit warning while the bot runs | Grimoire/Networking/Handlers/HandlerWarnings.cs:19-22 | The user loses the one signal the server sends |
| Anti-AFK logout or bot restart | Logs out or restarts on the AFK flag | Grimoire/Networking/Handlers/HandlerAFK.cs:18-37 | Not an exploit, but the inverse (keeping a session alive unattended) is |
| Lag killer, hide players, disable animations, skip cutscenes | Client performance toggles | OptionsManager.cs:100-122,163-169 | Cosmetic, but they are pushed continuously and change how the client handles its own packets |
| Cross-domain policy and server-list rewriting | Makes the game talk to the local proxy instead of the real host | Grimoire/Tools/Flash.cs:268-347; Grimoire/Networking/Handlers/HandlerPolicy.cs:15-22 | Infrastructure, not an exploit, but it is what makes the packet layer possible |

---

## 6. What this inventory does not settle

1. **Which of these calls AquaStar's SWF will have.** The 100 loader-only names in section 3 are the Grimlite loader's API. Whether Artix's stock Loader4.swf (or the custom-game.swf override) can be driven by an injected host-side script under the same names, or whether AquaStar has to ship a bridge SWF, is ticket #2 and #7. Only string tables were read here, no bytecode, so even the loader's own semantics are unverified.
2. **ConnectTo and ResetAura** are called by the C# and are in neither SWF string table. Either the SWF builds them dynamically, a later SWF dropped them, or they are stale. Marked UNVERIFIED above. Same for modifyServers and openWebsite.
3. **The packet shapes beyond what Grimlite handles.** Only these are consumed: JSON ct (anims, sarsa), aura+, aura-, mtls, sAct, moveToArea, clearAuras, getDrop, dropItem, initUserDatas, loadInventoryBig, addItems, ccqr, getQuests, loadShop, event (args.zoneSet), pi, and XT uotls, chatm, warning, whisper, message, server, tfer, loginResponse. A bridge that fans out raw packets to plugins will see far more than Grimlite did; a bridge that mimics Grimlite exactly will see only these.
4. **Whether AquaStar's proxy reproduces the same visibility.** res/socketProxy.js is a WebSocket-to-TCP relay for Ruffle with a host allowlist (res/socketProxy.js:14-34, :49-52): no NUL framing, no reassembly, no re-injection path. Grimlite's model is the opposite: let the SWF own the socket and relay through SendPacket and SendClientPacket (Grimoire/Networking/Proxy.cs:234-259). Which model AquaStar adopts is ticket #3.
5. **The handler table is not a spec.** Grimlite's default registrations are mostly commented out (Grimoire/Networking/Proxy.cs:267-291); what actually runs is a small subset plus whatever the UI turns on. The port has to choose its own set, and that choice interacts with section 5.
6. **Server-side rate limits are not observable from here.** Grimlite hard-codes a 3 s per-item drop cooldown (Grimoire/Game/DropStack.cs:75-79) and detects the slow-down warning (HandlerWarnings.cs:19), but there is no primary source for what the server enforces. Any rate guidance in the port needs its own evidence.
7. **Aura semantics.** AuraDuration is only ever called for enemies (Grimoire/Game/Player.cs:428-441); self auras come from packet-accumulated state, and what GetAurasValue returns for a fractional self aura is not settled by the C# (the path formats an int).
8. **Three named features that are effectively dead.** HandlerAntiMod is an empty class (Grimoire/Networking/Handlers/HandlerAntiMod.cs:9-12), the real anti-mod is BotManager.AntiMODHandler; HandlerLoadBank has an empty body (HandlerLoadBank.cs:15-18); HandlerSpecial, HandlerTaunterChampionDrakath, HandlerSkills, HandlerDPS, HandlerDropItem, HandlerPolicy and HandlerLogin are unregistered. HandlerTaunterChampionDrakath is byte-identical to HandlerAutoZoneUltraDage (diff shows no difference) and is never constructed. Whether the port keeps or drops them belongs to the parity matrix (#9).
9. **Per-boss handlers hard-code coordinates and message strings.** HandlerAutoZone*, HandlerUltraGramielTaunt and HandlerUltraSpeakerMechanics bake in x and y pairs and text such as "behold our starfire", "defense shattering" and "prepares a counter attack". A port inherits maintenance of those strings (Grimoire/Networking/Handlers/HandlerUltraSpeakerMechanics.cs:41-47,167; Grimoire/UI/Maid/MaidRemake.cs:1199-1213).
10. **Nothing here says what the UI must show.** Every state read above is available; how Bot Manager, the drop tab or a Maid panel renders it is ticket #12.
11. **Duplicate and renamed paths in the tree.** Grimoire/Networking/Proxy_Backup.cs (451 lines) and the root-level Grimoire/BotManager.Designer.cs are stale copies of Grimoire/Networking/Proxy.cs (293 lines) and Grimoire/UI/BotManager.Designer.cs; neither stale copy is in the build (Grimoire.csproj has 327 Compile entries and no wildcard, lists no Proxy_Backup entry at all, and compiles the BotManager pair at Grimoire.csproj:491 and :494). Line numbers in this document always point at the files the csproj compiles. The same pair of stale files is already written up in the sibling ticket doc (docs/research/grimlite-file-formats.md:15-17), so neither tells us anything about which features shipped in 816d9cd. The five files previously listed here as uncompiled (HandlerAutoZoneAstralEmpyreanP1.cs, HandlerUltraSpeakerMechanics.cs, HandlerUltraGramielTaunt.cs, AutoBuyBack.cs, EoLHook.cs) are in fact compiled: Grimoire.csproj:205, :209, :437, :461 and :256 respectively.

---

## 7. Where the seams land

| Seam | Grimlite | AquaStar today | Ticket |
|---|---|---|---|
| Host to SWF call | ActiveX CallFunction, envelope built in Grimoire/Tools/Flash.cs:159-207 | nothing; res/swf_wrapper.html:40,45 already sets allowscriptaccess always and allownetworking all | #2, #7 |
| SWF to host callback | ExternalInterface.addCallback names in Loader/grimoire.swf | nothing consumes them | #2, #7 |
| Packet observe | MITM proxy (Grimoire/Networking/Proxy.cs plus the raw socket path in GrimoireClient.cs) | Ruffle socket relay (res/socketProxy.js) with a host allowlist; AQW config in plugins/adventure-quest-worlds/ruffle.js:5-20 | #3 |
| Packet send | Proxy.SendToServer, then Flash.SendPacket, then sfc.send* | none | #3 |
| Packet inject to client | Proxy.SendToClient, then sendClientPacket | none | #3 |
| Block or modify an HTTP request | not applicable (packets, not HTTP) | res/platform/session-rules.js:96-113, one listener per event, first cancel or redirect is final | - |
| Plugin-visible game access | none, single process | permissions net-fetch, web-request, flash-trust, inject-scripts, persistent-store, spawn-helper-process, unsafe-renderer (res/platform/manifest-schema.js:4-23; docs/PLUGINS.md:380-410) | #8 |
| Game window plumbing | the whole app is one WinForms process | game window config res/windows/config.js:23-43 (plugins true, sandbox false, capture preload) | #12 |

---

### Verification commands used

Counts and names in this document come from three sweeps over the two working copies:

1. Call inventory: a Python walk of Grimoire/**/*.cs matching `Flash.(Call2|Call|CallGameFunction2|CallGameFunction|GetGameObject|GetGameObjectStatic|SetGameObject)\s*(<[^>]*>)?\(\s*"([^"]+)"` (excluding *.Designer.cs and Proxy_Backup.cs), which produced the 146 distinct names and their call sites.
2. SWF comparison: `python3 -c "import zlib;d=open(p,'rb').read();print(zlib.decompress(d[8:]) if d[:3]==b'CWS' else d)"` piped into a substring test per name, for Loader/grimoire.swf, /tmp/Game.swf (the game client), /tmp/jib.swf and /tmp/jibswf/*.
3. Counts: `find Grimoire/Botting/Commands -name '*.cs' | wc -l` gives 149; `grep -rho 'class Cmd[A-Za-z0-9_]*' Grimoire/Botting/Commands | sort -u | wc -l` gives 151; `find Grimoire/Networking/Handlers -name '*.cs' | wc -l` gives 36; `grep -rho 'class [A-Za-z]*Handler[A-Za-z0-9_]*' Grimoire/Networking/Handlers | sort -u | wc -l` gives 42.

Paths are repo-relative to the two working copies named in the header: Grimoire/... and Hook/... are the reference clone, res/..., plugins/... and docs/... are AquaStar.
