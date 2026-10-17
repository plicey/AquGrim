# Grimlite file formats (`.gbot`, `.cfg`, Maid, loose files)

| Field | Value |
|-------|-------|
| **Ticket** | [#5 Grimlite's .gbot and config file formats](https://github.com/plicey/AquGrim/issues/5) |
| **Date** | 2026-10-17 |
| **Status** | Research complete; schema notes ready for the engine ticket |
| **Reference implementation** | `Froztt13/Grimlite-Li` @ `816d9cd` (`/tmp/grimlite-full`); extra refs `49b9d6a` (branch `revamp-fhd`) and `jib-akbr/Grimlite-Li` @ `a633685` in the second clone |
| **AquaStar side** | working tree at commit on `codex/*`, Electron 11.5.0 + PPAPI Flash |

## Scope and method

Every claim below is traced to the C# that produces or consumes the file, or to the AquaStar module that would have to host it. The `.gbot` sample corpus is the 60 files under `Resources/Bots/**` in the reference clone (60 `*.gbot`; 69 files total once `Maid/*.json` and `class.txt` are counted), read with a script that walks `$type`/`$values` wrappers rather than trusting the README.

Two provenance traps in that clone, both worth knowing before trusting any line number from it:

- `Grimoire/BotManager.Designer.cs` (8419 lines, repo-relative) is **not in the build**. `Grimoire.csproj` compiles only `Grimoire\UI\BotManager.cs` (`Grimoire.csproj:491`) and `Grimoire\UI\BotManager.Designer.cs` (`Grimoire.csproj:494`), and there is no wildcard `<Compile>` entry. The root file is a stale duplicate that declares properties (`DropDelay`) and `Configuration` members the compiled assembly does not have. Line numbers in this document always point at the compiled pair.
- `Grimoire/UI/BotManagerbackup (2).backup` is likewise not compiled.

Marked **UNVERIFIED** below: the `autoload.cfg` filename (see [ClientConfig.cfg and the `.cfg` family](#clientconfigcfg-and-the-cfg-family)), the byte layout of `Boosts` entries (no non-empty `Boosts` array exists anywhere in the corpus), and anything inside the shipped plugin DLLs under `Resources/Plugins/**`, which were not disassembled.

---

## 1. The `.gbot` container

A `.gbot` is Newtonsoft.Json output with type information. The exact serializer settings are the whole format:

| Setting | Value | Source |
|---------|-------|--------|
| `DefaultValueHandling` | `Ignore` | `Grimoire/UI/BotManager.cs:51-55` (`_serializerSettings`), `:58-62` (`_saveSerializerSettings`) |
| `NullValueHandling` | `Ignore` | same |
| `TypeNameHandling` | `All` | same |
| `Formatting` | `Indented` (on write) | `Grimoire/UI/BotManager.cs:1383`, `:1917` |
| Enum converter | **none anywhere** — `rg 'StringEnumConverter'` over the whole clone returns nothing | — |

`_serializerSettings` and `_saveSerializerSettings` are byte-for-byte the same object, so clipboard copy (`Grimoire/UI/BotManager.cs:1808`) and file save (`:1383`, `:1917`) produce the same dialect. `CmdLoadBot` builds a third settings object with `DefaultValueHandling.Include` instead of `Ignore` (`Grimoire/Botting/Commands/Misc/CmdLoadBot.cs:52-57`), which affects only in-memory reload of a nested bot, not the file format.

Consequences that a JS implementation must reproduce:

1. **Every object carries `$type`.** The root is `"Grimoire.Botting.Configuration, Grimoire"`; every element of every array carries its own `$type` (see the corpus counts in §2).
2. **Every list is wrapped**, not a bare JSON array:

   ```json
   "Commands": {
     "$type": "System.Collections.Generic.List`1[[Grimoire.Botting.IBotCommand, Grimoire]], mscorlib",
     "$values": [ ... ]
   }
   ```

   Observed wrapper strings, all verbatim from the corpus:

   | Field | `$type` of the wrapper |
   |-------|------------------------|
   | `Commands` | ``System.Collections.Generic.List`1[[Grimoire.Botting.IBotCommand, Grimoire]], mscorlib`` |
   | `Skills` | ``System.Collections.Generic.List`1[[Grimoire.Game.Data.Skill, Grimoire]], mscorlib`` |
   | `Quests` | ``System.Collections.Generic.List`1[[Grimoire.Game.Data.Quest, Grimoire]], mscorlib`` |
   | `Boosts` | ``System.Collections.Generic.List`1[[Grimoire.Game.Data.InventoryItem, Grimoire]], mscorlib`` |
   | `Drops`, `Items`, `NotifyUponDrop` | ``System.Collections.Generic.List`1[[System.String, mscorlib]], mscorlib`` |

   All 60 corpus files use the wrapped form for all seven of these fields (58 use `Items`; two omit it because it was empty).
3. **Enums are integers**, because no `StringEnumConverter` and no `[JsonConverter]` is applied to any enum-typed property. The corpus confirms this directly: `CmdIndex.Type: 1`, `CmdInt.type: 1`, `CmdBackgroundPacket.ActionW: 1`, `Skill.Type: 1` and `Skill.Type: 2`. The full mapping per enum is in §4.
4. **Defaults are omitted, so absence is meaningful only if you know the C# default.** A field missing from a `.gbot` may be `false`, `0`, `""`, `null`, or a non-trivial initializer (`SkillDelay = 150` at `Grimoire/Botting/Configuration.cs:61`, `optionDelay = 500` at `:157`). Whether a *missing* key and an *explicit false* are the same thing therefore depends on the property: for `Configuration` bools they are; for `CmdLoadBot.PassDropList` (default `true`) they are not, which is why that property carries `[JsonProperty(DefaultValueHandling = DefaultValueHandling.Include)]` (`Grimoire/Botting/Commands/Misc/CmdLoadBot.cs:26-31`). Any JS writer must copy that `Include` list rather than infer it.
5. **Bytes on disk**, from a sweep of all 60 files: no UTF-8 BOM, LF-only line endings, no trailing newline, 2-space indentation. `File.WriteAllText` on .NET Framework with no encoding argument writes UTF-8 without a BOM, which matches.

### Reading is lenient, writing is not

`TryDeserialize` is a bare `JsonConvert.DeserializeObject<Configuration>(json, _saveSerializerSettings)` inside a `try` (`Grimoire/UI/BotManager.cs:1357-1366`). Newtonsoft defaults `MissingMemberHandling` to `Ignore`, so:

- Unknown keys are silently discarded. This is load-bearing: 12 corpus bots carry `"DropDelay"` and one carries `"ReloginEvery"`, and **neither property exists anywhere in the compiled C#** (`rg 'DropDelay|ReloginEvery'` over the tree matches only the uncompiled root `BotManager.Designer.cs` and the corpus files themselves). They were written by an older build; current Grimlite reads those bots and drops the keys.
- A `$type` naming a type the assembly cannot resolve throws, and the failure surfaces as a modal `MessageBox` plus a `null` config (`Grimoire/UI/BotManager.cs:1363`). So a writer must emit only `$type` strings that exist in `Grimoire.exe`.

---

## 2. Which command types actually appear

Frequencies across the 60 corpus files (occurrences, not files). This is the practical priority order for an engine port, and the list of `$type` strings an AquaStar writer would have to reproduce byte-for-byte:

| Count | `$type` (leaf) |
|------:|----------------|
| 228 | `Commands.Misc.CmdGotoLabel` |
| 169 | `Commands.Misc.CmdLabel` |
| 145 | `Commands.Misc.CmdBlank3` |
| 115 | `Commands.Map.CmdJoin` |
| 101 | `Commands.Misc.CmdRestart` |
| 99 | `Commands.Combat.CmdShortHunt` |
| 92 | `Commands.Misc.Statements.CmdNotInInventory` |
| 83 | `Commands.Combat.CmdUseSkill` |
| 63 | `Commands.Combat.CmdKillFor` |
| 56 | `Commands.Misc.CmdPacket` |
| 53 | `Commands.Quest.CmdAcceptQuest` |
| 52 | `Commands.Quest.CmdCompleteQuest` |
| 47 | `Commands.Misc.CmdDelay` |
| 37 | `Commands.Map.CmdMoveToCell` |
| 35 | `Commands.Misc.Statements.CmdCellIs` |
| 30 | `Commands.Misc.Statements.CmdSetVar` |
| 29 | `Commands.Item.CmdBuy` |
| 23 | `Commands.Item.CmdEquip` |
| 21 | `Game.Data.Quest` (in `Quests`) |
| 18 | `Commands.Misc.Statements.CmdInInventory` |
| 14 | `Commands.Misc.CmdIndex` |
| 13 | `Commands.Misc.CmdStop` |
| 13 | `Commands.Combat.CmdKill` |
| 12 | `Commands.Misc.Statements.CmdNotInBankAndInvent` |
| 12 | `Commands.Misc.Statements.CmdVarEqualVar` |
| 12 | `Commands.Misc.Statements.CmdMapIsNot` |
| 11 | `Commands.Misc.Statements.CmdMapIs` |
| 11 | `Commands.Map.CmdSetSpawn` |
| 11 | `Commands.Misc.Statements.CmdMonstersLessThan` |
| 9 | `Commands.Misc.Statements.CmdHealthGreaterThan` |
| 9 | `Commands.Misc.Statements.CmdIntIs` |
| 9 | `Commands.Misc.Statements.CmdUpdateVar` |
| 7 | `Commands.Misc.Statements.CmdPlayerAuraLessThan` |
| 6 | `Commands.Misc.CmdProvoke` |
| 6 | `Commands.Item.CmdBankTransfer` |
| 5 | `Commands.Misc.CmdBeep` |
| 5 | `Commands.Combat.CmdAttack` |
| 4 | `Commands.Misc.Statements.CmdPlayerAuraEquals` |
| 4 | `Commands.Misc.Statements.CmdEquipped` |
| 4 | `Commands.Combat.CmdSkillSet` |
| 3 | `Commands.Misc.Statements.CmdTargetAuraLessThan` |
| 3 | `Commands.Misc.Statements.CmdMonstersGreaterThan` |
| 3 | `Commands.Misc.Statements.CmdPlayerNotInRoom` |
| 2 | `Commands.Misc.Statements.CmdTargetAuraGreaterThan` |
| 2 | `Commands.Misc.Statements.CmdTargetHealthLessThan` |
| 2 | `Commands.Misc.Statements.CmdQuestCompleted` |
| 2 | `Commands.Misc.CmdBackgroundPacket` |
| 2 | `Commands.Item.CmdMapItem` |
| 2 | `Commands.Misc.CmdInt` |
| 1 each | `CmdMonsterHealthLessThan`, `CmdLog`, `CmdHealthLessThan`, `CmdPlayerAuraGreaterThan`, `CmdGetDrop`, `CmdLogout`, `CmdInBank`, `CmdNotInTemp`, `CmdRest`, `CmdClearTemp`, `CmdTargetHealthBetween`, `CmdNotEquipped`, `CmdNotHasTarget` |

Two things this list settles for the engine ticket. First, `CmdGotoLabel`/`CmdLabel` outrank everything, so labels are not an edge case — they are the control-flow primitive the corpus is built on. Second, the exhaustion set is large: the compiled tree declares **148 `IBotCommand` implementations** across `Grimoire/Botting/Commands/**` (148 classes implementing `IBotCommand`, of which ~75 are `Misc.Statements.*`). A port that implements only what the corpus exercises will fail on any community bot that uses the other half.

### Property names, and why a JS port must not rename them

Most command properties are C# auto-properties with no attribute, so the JSON key is the C# property name verbatim, including `CmdInt.type` and `CmdTauntcycle.type` (lowercase) and `CmdBackgroundPacket.ActionW` (not `Action`). Full property sets observed in the corpus:

| Command | JSON keys seen |
|---------|----------------|
| `CmdJoin` | `Map`, `Cell`, `Pad`, `Try`, `MapSwf` |
| `CmdUseSkill` | `Monster`, `Index`, `Wait`, `Force` |
| `CmdKill` / `CmdKillFor` | `Monster`, `KillPriority`(`""`), `AntiCounter`, `ItemName`, `ItemType`, `Quantity`, `QuestId`, `DelayAfterKill` |
| `CmdShortHunt` | `Map`, `Cell`, `Pad`, `Monster`, `ItemName`, `ItemType`, `Quantity`, `KillPriority`, `AntiCounter`, `QuestId`, `DelayAfterKill`, `BlankFirst`, `MonId` |
| `CmdIndex` | `Type`, `Index`, `IndexString` |
| `CmdInt` | `type`, `Int`, `Value` |
| `CmdPacket` | `Packet`, `SpamTimes`, `Delay`, `ForClient`, `Client` |
| `CmdLabel` | `Name` |
| `CmdGotoLabel` | `Label` |
| `CmdPacket` payloads | by convention `%xt%zm%...%` or `{...}` with `{ROOM_ID}`, `{ROOM_NUMBER}`, `{GETMAP}`, `PLAYERNAME` placeholders |
| any `Misc.Statements.*` | `Tag`, `Text`, `Value1`, `Value2` (+ `Description1`/`Description2` in the definition list only) |

The placeholder set is defined by the code, not by the notes file: `Grimoire/Botting/Commands/Misc/CmdPacket.cs:58-61` replaces `{ROOM_ID}`, `{ROOM_NUMBER}`, `{GETMAP}`, `PLAYERNAME`; `CmdLog.cs:44` and `CmdPacketDelay.cs:42-43` do the same subset. `Resources/Notes/variables.txt:1-5` documents exactly these four, so the notes file is accurate for this one feature and stale for the rest (see [Resources/Notes/variables.txt](#resourcesnotesvariablestxt)).

---

## 3. Top-level `Configuration`

All from `Grimoire/Botting/Configuration.cs` (compiled). `Default` is the C# default a reader must assume when the key is absent; `Always written?` means the property forces emission of its default.

| Key | Type | Line | Default | Notes |
|-----|------|-----:|---------|-------|
| `$type` | string | — | — | `"Grimoire.Botting.Configuration, Grimoire"`; present in all 60 files |
| `Commands` | wrapped `List<IBotCommand>` | 13 | `[]` (`:342`) | 60/60 present |
| `Skills` | wrapped `List<Skill>` | 19 | `[]` (`:343`) | 60/60 |
| `Quests` | wrapped `List<Quest>` | 25 | `[]` (`:344`) | 60/60 |
| `Author` | string | 31 | `null` | UI substitutes `""` when the box still reads `Author` (`Grimoire/UI/BotManager.cs:313`) |
| `Description` | string | 37 | `null` | **may be gzip+base64 of RTF** — see below |
| `Boosts` | wrapped `List<InventoryItem>` | 43 | `[]` (`:345`) | always empty in the corpus |
| `Drops` | wrapped `List<string>` | 49 | `[]` (`:346`) | |
| `Server` | object | 55 | `null` | `Grimoire.Game.Data.Server, Grimoire`; only `sName`, `iPort`, `sIP` are serialized — seven further properties are suppressed by `ShouldSerialize*` (`Grimoire/Game/Data/Server.cs:65-83`) |
| `SkillDelay` | int | 61 | **150** | initializer, not `0` |
| `ExitCombatBeforeRest` | bool | 67 | `false` | |
| `ExitCombatBeforeQuest` | bool | 73 | `false` | |
| `EnablePickup` | bool | 79 | `false` | |
| `EnableRejection` | bool | 85 | `false` | |
| `EnablePickupAll` | bool | 91 | `false` | |
| `EnablePickupAcTagged` | bool | 97 | `false` | |
| `AutoRelogin` | bool | 103 | `false` | |
| `RelogDelay` | int | 109 | `0` | |
| `RelogRetryUponFailure` | bool | 115 | `false` | |
| `BotDelay` | int | 121 | `0` | |
| `WaitForAllSkills` | bool | 127 | `false` | |
| `WaitForSkill` | bool | 133 | `false` | |
| `SkipDelayIndexIf` | bool | 139 | `false` | |
| `InfiniteAttackRange` | bool | 145 | `false` | |
| `ProvokeMonsters` | bool | 151 | `false` | |
| `optionDelay` | int | 157 | **500** | initializer |
| `respawnProvoke` | bool | 163 | `false` | lowercase key |
| `EnemyMagnet` | bool | 169 | `false` | |
| `UseSkillZeroAutomatically` | bool | 175 | `false` | |
| `LagKiller` | bool | 181 | `false` | |
| `HidePlayers` | bool | 187 | `false` | |
| `SkipCutscenes` | bool | 193 | `false` | |
| `keepLagKiller` | bool | 199 | `false` | lowercase key |
| `DisableAnimations` | bool | 205 | `false` | |
| `WalkSpeed` | int | 211 | `0` | |
| `NotifyUponDrop` | wrapped `List<string>` | 217 | `[]` (`:350`) | |
| `RestIfMp` | bool | 223 | `false` | |
| `RestIfHp` | bool | 229 | `false` | |
| `RestMp` | int | 235 | `0` | |
| `RestHp` | int | 241 | `0` | |
| `RestartUponDeath` | bool | 247 | `false` | |
| `RestartOnAFK` | bool | 253 | `false` | |
| `Items` | wrapped `List<string>` | 259 | `[]` (`:348`) | unbank list |
| `Packet` | bool | 265 | `false` | |
| `BankOnStop` | bool | 271 | `false` | |
| `AFK` | bool | 282 | `false` | |
| `AntiCounter` | bool | 288 | `false` | |
| `SkipAttack` | bool | 294 | `false` | explicit `= false` initializer |
| `FollowCheck` | bool | 300 | `false` | |
| `FollowName` | string | 306 | `null` | |
| `RelogUponItemBuyFailure` | string | 312 | `null` | |
| `AutoZone` | string | 318 | `null` | |
| *inherited from elsewhere* | | | | `BlockedPlayers` is `static` (`:277`) and never serialized; `Tempvalues`/`Tempvariable` are `static` (`:338-339`) and are **runtime-only** — never persisted in a `.gbot` |

Observed top-level key frequencies across the corpus, useful as a sanity check on the above: `$type`/`Commands`/`Skills`/`Quests`/`Author`/`Description`/`Boosts`/`Drops`/`RelogDelay`/`SkipDelayIndexIf`/`WalkSpeed`/`NotifyUponDrop` 60; `ExitCombatBeforeRest`/`RestMp`/`RestHp` 59; `Server`/`RestartUponDeath`/`Items` 58; `FollowName` 57; `EnablePickup` 56; `InfiniteAttackRange` 55; `BotDelay` 51; `AutoRelogin` 31; `ExitCombatBeforeQuest` 28; `RelogRetryUponFailure` 27; `AFK` 26; `EnableRejection`/`DisableAnimations` 16; `LagKiller` 15; `DropDelay` 12 *(legacy, see §1)*; `FollowCheck` 12; `SkillDelay` 11; `SkipCutscenes` 6; `ProvokeMonsters` 5; `AntiCounter` 4; `ReloginEvery` 1 *(legacy)*.

### `Description` is conditionally gzipped

`SaveConfiguration` does:

```csharp
String desc = txtDescription.Text == "Description (Write in RTF)" ? "" : txtDescription.Text;
var compressed = DocConvert.Zip<string>(desc);
...
Description = compressed.Length > txtDescription.Text.Length ? txtDescription.Text : compressed,
```

(`Grimoire/UI/BotManager.cs:313-317`, `:323`.) `DocConvert.Zip<T>` is `UTF8 → GZipStream → Base64` (`Grimoire/Tools/DocToRtf.cs:61-76`) and `Unzip` reverses it (`:93-107`). So `Description` is plain text when base64 would be longer, and base64 gzip when it would be shorter. Measured in the corpus: 35 files hold plain text; exactly one, `Resources/Bots/Ultra Boss/Ultra Timeinn/General-Timeinn.gbot`, holds 332,924 base64 characters that inflate to a 1,675,768-byte RTF document beginning `{\rtf1\ansi\ansicpg1252\deff0\nouicompat`. `ApplyConfiguration` decides via `DocConvert.IsBase64Encoded` (`Grimoire/UI/BotManager.cs:385`, heuristic at `Grimoire/Tools/DocToRtf.cs:14-30`) and unzips only then. A port that reads `Description` must therefore try base64+gzip and fall back to plain text; a port that writes it can always write plain text.

### `Quests`

`Quest` is the most attribute-decorated type in the format. `Id` maps through `[JsonProperty("QuestID", NullValueHandling = NullValueHandling.Ignore)]` (`Grimoire/Game/Data/Quest.cs:112-117`) — so the key is **`QuestID`, not `Id`** — and 17 other properties are suppressed from serialization by a `ShouldSerialize*` block (`:306-339`). `RequiredItems` (`:91-96`) is *not* suppressed. Verbatim cell from `Resources/Bots/Archmage/5 Book of Magus - Incantation.gbot`:

```json
{
  "$type": "Grimoire.Game.Data.Quest, Grimoire",
  "QuestID": 8814,
  "Text": "8814",
  "IsInProgress": true
},
{
  "$type": "Grimoire.Game.Data.Quest, Grimoire",
  "QuestID": 8815,
  "Text": "8815",
  "IsInProgress": true,
  "CanComplete": true
}
```

`IsInProgress` and `CanComplete` are get-only computed properties that call into Flash (`Grimoire/Game/Data/Quest.cs:201-221`), yet both appear here — evidence that these files were written by a build whose `ShouldSerialize` list was shorter than the current one. Readers must tolerate both the two-key and the four-key shape. Also present in the workshop schema but not in this cell: `CompleteInBlank` (`:183`) and `SafeRelogin` (`:189`), plus `ItemId`.

---

## 4. Enum integer tables

Enums are stored as their zero-based declaration order. Getting one of these wrong silently reinterprets an existing bot, so they are recorded per enum with the declaration site.

**`Skill.SkillType`** — `Grimoire/Game/Data/Skill.cs:48-53`

| Value | Name | Meaning |
|------:|------|---------|
| 0 | `Normal` | absent key means this |
| 1 | `Safe` | gated on HP% or MP%, needs `SType` + `SafeValue` (+ `IsSafeMp`) |
| 2 | `Label` | a named skill-set marker; `Text` keys `BotData.SkillSet` after `.ToUpper()` (`Grimoire/Botting/Bot.cs:182-188`) |

**`Skill.SafeType`** — `Grimoire/Game/Data/Skill.cs:55-60`

| Value | Name | Text form |
|------:|------|-----------|
| 0 | `LowerThan` | `<=` |
| 1 | `GreaterThan` | `>=` |
| 2 | `Equals` | `==` |

(The `ToString` at `Grimoire/Game/Data/Skill.cs:171-178` renders only `>=` vs `<=`, collapsing `Equals` to `<=` for display — a display bug, not a storage one.)

**`CmdIndex.IndexCommand`** — `Grimoire/Botting/Commands/Misc/CmdIndex.cs:8-13`

| Value | Name |
|------:|------|
| 0 | `Up` |
| 1 | `Down` |
| 2 | `Goto` |

**`CmdInt.Types`** — `Grimoire/Botting/Commands/Misc/CmdInt.cs:8-13`

| Value | Name |
|------:|------|
| 0 | `Set` |
| 1 | `Upper` |
| 2 | `Lower` |

**`CmdBackgroundPacket.Action`** — `Grimoire/Botting/Commands/Misc/CmdBackgroundPacket.cs:21-25`

| Value | Name |
|------:|------|
| 0 | `ADD` |
| 1 | `STOP` |

**`CmdWhitelist.State`** — `Grimoire/Botting/Commands/Item/CmdWhitelist.cs:10-17`

| Value | Name |
|------:|------|
| 0 | `On` |
| 1 | `Off` |
| 2 | `Toggle` |
| 3 | `Add` |
| 4 | `Remove` |

**`CmdPacketSpammer.CommandType`** — `Grimoire/Botting/Commands/Misc/CmdPacketSpammer.cs:23-32`

| Value | Name |
|------:|------|
| 0 | `Add` |
| 1 | `Remove` |
| 2 | `Start` |
| 3 | `Stop` |
| 4 | `Clear` |
| 5 | `Restart` |
| 6 | `SetDelay` |
| 7 | `GoPressTheGodDamnCorrectButton` |

**`CmdTauntcycle.option`** — `Grimoire/Botting/Commands/Misc/CmdTauntcycle.cs:8-12`

| Value | Name |
|------:|------|
| 0 | `Start` |
| 1 | `Stop` |

**`CmdSpecialHandler.SpecialMode`** — `Grimoire/Botting/Commands/Misc/CmdSpecialHandler.cs:12-17`

| Value | Name |
|------:|------|
| 0 | `Start` |
| 1 | `Stop` |
| 2 | `Switch` |

**`ItemType`** — `Grimoire/Botting/Commands/ItemType.cs:3-7`

| Value | Name |
|------:|------|
| 0 | `Items` |
| 1 | `TempItems` |

Two near-misses worth recording so they are not "fixed" by mistake: `CmdToggleProvoke.Type` is a plain `int`, not an enum, with `0` = off, `1` = on, anything else = toggle (`Grimoire/Botting/Commands/Misc/CmdToggleProvoke.cs:7-28`); and `CmdWalk.Type` is a **string**, compared against the literal `"Random"` (`Grimoire/Botting/Commands/Map/CmdWalk.cs:27`, used at `:36`).

---

## 5. Worked example (verbatim)

`Resources/Bots/Ultra Boss/Ultra Darkon/DPS-General.gbot`, complete, 3534 bytes, as stored on disk:

```json
{
  "$type": "Grimoire.Botting.Configuration, Grimoire",
  "Commands": {
    "$type": "System.Collections.Generic.List`1[[Grimoire.Botting.IBotCommand, Grimoire]], mscorlib",
    "$values": [
      {
        "$type": "Grimoire.Botting.Commands.Misc.Statements.CmdMapIs, Grimoire",
        "Tag": "Map",
        "Text": "Map is",
        "Value1": "ultradarkon",
        "Value2": ""
      },
      {
        "$type": "Grimoire.Botting.Commands.Misc.CmdGotoLabel, Grimoire",
        "Label": "KILL"
      },
      {
        "$type": "Grimoire.Botting.Commands.Misc.CmdBlank3, Grimoire",
        "Text": "...",
        "Alpha": 1,
        "R": 220,
        "G": 220,
        "B": 220
      },
      {
        "$type": "Grimoire.Botting.Commands.Misc.CmdLabel, Grimoire",
        "Name": "JOIN"
      },
      {
        "$type": "Grimoire.Botting.Commands.Misc.CmdPacket, Grimoire",
        "Packet": "{\"t\":\"xt\",\"b\":{\"r\":-1,\"o\":{\"cmd\":\"updateQuest\",\"iValue\":33,\"iIndex\":454}}}",
        "SpamTimes": 1,
        "Delay": 1000,
        "ForClient": true
      },
      {
        "$type": "Grimoire.Botting.Commands.Map.CmdJoin, Grimoire",
        "Map": "ultradarkon-9099",
        "Cell": "Enter",
        "Pad": "Spawn",
        "Try": 1
      },
      {
        "$type": "Grimoire.Botting.Commands.Misc.CmdBlank3, Grimoire",
        "Text": "...",
        "Alpha": 1,
        "R": 220,
        "G": 220,
        "B": 220
      },
      {
        "$type": "Grimoire.Botting.Commands.Misc.CmdLabel, Grimoire",
        "Name": "KILL"
      },
      {
        "$type": "Grimoire.Botting.Commands.Combat.CmdKill, Grimoire",
        "Monster": "Darkon the Conductor",
        "KillPriority": ""
      }
    ]
  },
  "Skills": {
    "$type": "System.Collections.Generic.List`1[[Grimoire.Game.Data.Skill, Grimoire]], mscorlib",
    "$values": [
      {
        "$type": "Grimoire.Game.Data.Skill, Grimoire",
        "Text": "Stalagmite",
        "Index": "1"
      },
      {
        "$type": "Grimoire.Game.Data.Skill, Grimoire",
        "Text": "Echoing Earth",
        "Index": "2"
      },
      {
        "$type": "Grimoire.Game.Data.Skill, Grimoire",
        "Text": "Land's Embrace",
        "Index": "3"
      },
      {
        "$type": "Grimoire.Game.Data.Skill, Grimoire",
        "Text": "Endless Fissure",
        "Index": "4"
      }
    ]
  },
  "Quests": {
    "$type": "System.Collections.Generic.List`1[[Grimoire.Game.Data.Quest, Grimoire]], mscorlib",
    "$values": []
  },
  "Author": "",
  "Description": "DPS\r\n\r\nLC\r\nSC",
  "Boosts": {
    "$type": "System.Collections.Generic.List`1[[Grimoire.Game.Data.InventoryItem, Grimoire]], mscorlib",
    "$values": []
  },
  "Drops": {
    "$type": "System.Collections.Generic.List`1[[System.String, mscorlib]], mscorlib",
    "$values": []
  },
  "Server": {
    "$type": "Grimoire.Game.Data.Server, Grimoire",
    "sName": "Twilly",
    "iPort": 5588,
    "sIP": "twilly.aqw.aq.com"
  },
  "ExitCombatBeforeRest": true,
  "EnablePickup": true,
  "RelogDelay": 5000,
  "BotDelay": 1000,
  "SkipDelayIndexIf": true,
  "InfiniteAttackRange": true,
  "LagKiller": true,
  "WalkSpeed": 20,
  "NotifyUponDrop": {
    "$type": "System.Collections.Generic.List`1[[System.String, mscorlib]], mscorlib",
    "$values": []
  },
  "RestMp": 60,
  "RestHp": 60,
  "RestartUponDeath": true,
  "Items": {
    "$type": "System.Collections.Generic.List`1[[System.String, mscorlib]], mscorlib",
    "$values": []
  },
  "FollowCheck": true,
  "FollowName": "fierce ward"
}
```

Reading it back: a **statement** (`CmdMapIs`, recognised by `Tag`/`Text`/`Value1`/`Value2` and its `StatementCommand` base, `Grimoire/Botting/Commands/Misc/Statements/StatementCommand.cs:7-41`); two **labels** and a **goto** (`CmdLabel`/`CmdGotoLabel`); a **packet command** carrying a 78-character JSON string; a **map command** (`CmdJoin`, with `Try` defaulting to 1 — `Grimoire/Botting/Commands/Map/CmdJoin.cs:17`); and a **skill list** of four normal skills. Note that only 21 of the ~51 `Configuration` properties are present: everything equal to its C# default was dropped, which is exactly the property that makes read→write round-tripping lossy unless the writer keeps the original key set.

### The skill-set shape

`CmdSkillSet` switches the active set by name (`Grimoire/Botting/Commands/Combat/CmdSkillSet.cs:8-19`), and the sets themselves are `Skill` entries with `Type: 2` whose `Text` is the bracketed name. Verbatim from `Resources/Bots/Ultra Boss/Ultra Dage/All Class.gbot`:

```json
{ "$type": "Grimoire.Game.Data.Skill, Grimoire", "Text": "[CAV]", "Type": 2 },
{ "$type": "Grimoire.Game.Data.Skill, Grimoire", "Text": "Chaos Siphon", "Index": "1" },
{ "$type": "Grimoire.Game.Data.Skill, Grimoire", "Text": "Flux", "Index": "2" },
{ "$type": "Grimoire.Game.Data.Skill, Grimoire", "Text": "Fury Unleashed", "Index": "4" },
{ "$type": "Grimoire.Game.Data.Skill, Grimoire", "Text": "Potions", "Index": "5", "Type": 1, "SafeValue": 70 },
```

and the matching commands, which are a `CmdEquipped` guard per set followed by the switch:

```json
{ "$type": "Grimoire.Botting.Commands.Misc.Statements.CmdEquipped, Grimoire", "Tag": "Item", "Text": "Is equipped", "Value1": "Chaos Avenger", "Value2": "" },
{ "$type": "Grimoire.Botting.Commands.Combat.CmdSkillSet, Grimoire", "Name": "CAV" },
```

The guard works because a statement that fails advances the index by one (`instance.Index++`, e.g. `Grimoire/Botting/Commands/Misc/Statements/CmdCellIs.cs:15-22`), skipping the `CmdSkillSet` that follows it. Note `Type: 1` with `SafeValue: 70` and no `IsSafeMp` — that is an HP-gated potion (HP is the default when `IsSafeMp` is false, `Grimoire/Game/Data/Skill.cs:62-109`), and `SType` is absent, meaning `LowerThan` (0). Also note the label skills carry **no `Index`** and the numeric skills carry **`Index` as a string** (`Skill.Index` is `string`, `:16`).

---

## 6. Folders, `botsDir` and `CmdLoadBot`

There is no folder concept in the format. The bot tree is the filesystem, enumerated one level at a time with `Directory.EnumerateDirectories(..., SearchOption.TopDirectoryOnly)` and `Directory.EnumerateFiles(path, "*.gbot", SearchOption.TopDirectoryOnly)` (`Grimoire/UI/BotManager.cs:1575-1608`), counted by `lblBots` with `SearchOption.AllDirectories` (`:1514`). The root is the `botsDir` value from `ClientConfig.cfg` (`:1902`, `:2268`, `:3624`), defaulting to `Path.Combine(Application.StartupPath, "Bots")` (`:2265`). So `Resources/Bots/Ultra Boss/Ultra Dage/All Class.gbot` is just a directory `Ultra Boss/Ultra Dage` containing one `*.gbot` — the corpus sample for this is `Resources/Bots/Ultra Boss/Eclipse/Maid/` (five Maid `.json` files next to sibling `.gbot` files) and `Resources/Bots/Ultra Boss/Ultra Drago/class.txt`.

`CmdLoadBot` stores the nested path in two different ways depending on how it was authored, and this is the part that does not port cleanly:

| Field | Source | Value |
|-------|--------|-------|
| `BotFileName` | file picker (`Grimoire/UI/BotManager.cs:1405`) or tree click (`:1530`) | basename only, e.g. `06 - The lovers embrace.gbot` |
| `BotFilePath` | file picker | `Extensions.MakeRelativePathFrom(Application.StartupPath, openFileDialog.FileName)` |
| `BotFilePath` | tree click | `"Bots" + path.Substring(txtSaved.Text.Length)` (`Grimoire/UI/BotManager.cs:1527`) — a hardcoded `Bots` prefix, so it is only correct when `botsDir` is the default |

At run time `CmdLoadBot` resolves with `File.Exists(path)` against the process working directory (`Grimoire/Botting/Commands/Misc/CmdLoadBot.cs:42-43`), and `CmdEquipSet` does the same thing but worse — `Application.StartupPath + ItemName` with no separator (`Grimoire/Botting/Commands/Item/CmdEquipSet.cs:30`), reading a `.gset` from the executable directory rather than from `Sets/`. Three different path conventions in three commands. None of them survive a move of the bots directory, and none of them are usable verbatim on Linux or macOS.

No bundled bot uses `CmdLoadBot` — it does not appear in the `$type` census of §2 at all.

---

## 7. `ClientConfig.cfg` and the `.cfg` family

### The file format

Every `.cfg` in this application is the same trivial key/value shape, implemented once by `Grimoire/Botting/Config.cs`:

- Parsing: `File.ReadLines(path).Select(l => l.Split(new[] { '=' }, 2)).Where(parts => parts.Length == 2 && !string.IsNullOrWhiteSpace(parts[0])).ToDictionary(parts => parts[0], parts => parts[1])` (`:46-50`). **Values may contain `=`** (limit-2 split); blank lines and lines without `=` are dropped; duplicate keys throw from `ToDictionary` and are swallowed by the surrounding `catch`, which returns an empty dictionary (`:58-65`).
- Writing: `File.WriteAllLines(file, Contents.Select(kvp => $"{kvp.Key}={kvp.Value}"))` (`:32-35`) — **the whole dictionary, re-emitted, in `Dictionary` order, with no header and no escaping.** Multi-line values are written literally, which is why Maid's `LockedZoneHandlerMaps` value contains a raw `\r\n` inside a JSON string (see §8) — same hazard, different file.
- If the file does not exist, `Load` creates it empty via `File.Create` (`:41-44`).

### `autoload.cfg` — UNVERIFIED

**I could not find this file.** It is not read, written, or named anywhere in the reference clone: `Config.Load` is only ever called with `ClientConfig.cfg` (`Grimoire/Tools/ClientConfig.cs:9`), `config.cfg` (`Grimoire/UI/BotManager.cs:183`, `:2449`, `:2532`, `:2547`), `MapConfig.cfg` (`Grimoire/Tools/MapConfig.cs:11`, `:35`), and `CharSelect.cfg` (`Grimoire/UI/Root.cs:135`); a scan for `*.cfg` string literals across all `.cs` yields only `MapItemLog.txt`, `hotkeys.json`, `autoload.json`; and `git log --all --name-only` lists only `ClientConfig.cfg` and `config.cfg` at the repo root, with the branch `revamp-fhd` (`49b9d6a`) adding `bin/Debug/CharSelect.cfg`, `bin/Debug/ClientConfig.cfg`, `bin/Debug/config.cfg` and `bin/Debug/hotkeys.json`. The only `autoload` literal in the tree is `Path.Combine(configFolder, "autoload.json")` (`Grimoire/UI/Maid/MaidRemake.cs:1473`), which is a **Maid JSON config, not a `.cfg`**, and is documented in §8.

I cannot prove a negative across every historical revision — this clone has one commit of history on `master` plus `jib-akbr`'s. Status: **UNVERIFIED**; possibly a filename from an older Grimoire lineage, possibly the ticket meaning Maid's `Config/autoload.json`.

### `ClientConfig.cfg`, key by key

Loader is `Config.Load(Application.StartupPath + "\\ClientConfig.cfg")` (`Grimoire/Tools/ClientConfig.cs:9`); key constants are `:10-18`. Shipped sample (11 keys) and the reader for each:

| Key | Sample value | Read at | Meaning |
|-----|--------------|---------|---------|
| `flash` | `Loader/grimoire.swf` | `Grimoire/UI/Root.cs:112` | game SWF path; when missing/unloadable the app shows a "Game SWF not configured" panel and writes the chosen path back (`Grimoire/UI/Root.cs:228`, `:262`). **AquaStar equivalent: the plugin's primary game URL, or `custom-game.swf`** |
| `botsDir` | `./Bots` | `Grimoire/UI/BotManager.cs:1902`, `:2268`, `:3624` | bot tree root. Note the `./Bots` value is massaged: `Path.Combine(Application.StartupPath, saveDir).Replace(".", "")` (`:1905`), which strips **every** dot from the resulting path |
| `safeCell` | `Enter,Spawn` | `Grimoire/UI/BotManager.cs:3474`, `Grimoire/Botting/Commands/Map/CmdJoin.cs:89`, `Grimoire/Botting/Commands/Combat/CmdShortHunt.cs:46` | comma-separated cell/pad pair used before certain joins. **Any plugin that reads this must not call `.Split(',')` unguarded** — a missing key returns `null` and `GetValue` catches the resulting exception into `null` too (`Grimoire/Tools/ClientConfig.cs:22-34`) |
| `questListDelay` | `100` | *constant declared* at `Grimoire/Tools/ClientConfig.cs:15`, **never read here** | the quest-list loop uses the UI control instead: `int questDelay = (int)BotManager.Instance.numQuestDelay.Value` (`Grimoire/Botting/Bot.cs:334`) |
| `logDebugSwf` | `false` | `Grimoire/Tools/Flash.cs:386`, `Grimoire/UI/LogForm.cs:144` | string-compared to exactly `"true"` |
| `fps` | `24` | `Grimoire/Tools/Flash.cs:405` | `int.Parse` of the value, pushed into the movie via `Flash.Call("SetFPS", ...)`. Unguarded `int.Parse` — a malformed value throws inside the SWF callback |
| `nameColor` | `0` | `Grimoire/Tools/Flash.cs:643-653` | `Split(',')`. `[0]` non-`"0"` → `ChangeColorName(nameColor[0])` for non-members; `[1]` if member and non-`"0"`. With the shipped single-element value the member branch indexes out of range |
| `accessLevel` | — | constant declared at `Grimoire/Tools/ClientConfig.cs:16`, **never referenced** | dead in this revision |
| `SS.<CLASSNAME>` | see below | `Grimoire/UI/Root.cs:1530` | skill preset per class, one key per class |

### `SS.<CLASS>` skill-preset grammar

Read by `getSkillPreset()` (`Grimoire/UI/Root.cs:1523-1580`), keyed on the currently equipped class uppercased: `ClientConfig.GetValue($"{C_SKILL_PRESET_PREFIX}{playerClass.ToUpper()}")`, i.e. `SS.` + uppercase class name.

```
SS.<UPPERCASED CLASS NAME> = <entry> ; <entry> ; …

entry        := <index>                          → Skill { Type = Normal, Index = <index> }
              | <index> : SH <op> <value>        → Skill { Type = Safe, IsSafeMp = false, SType, SafeValue }
              | <index> : SM <op> <value>        → Skill { Type = Safe, IsSafeMp = true,  SType, SafeValue }

<op>         := '>'  → SafeType.GreaterThan
              | anything else → SafeType.LowerThan      (Root.cs:1546-1558: `sType == ">" ? ... : ...`)

wait         := the literal substring "wait" anywhere in the whole value
                → .Replace("wait", "") on the entire string (Root.cs:1533-1537)
                → sets `waitCd = true` on every Normal entry parsed from this preset (Root.cs:1575)
```

Worked from the shipped `ClientConfig.cfg`:

| Preset | Parsed result |
|--------|---------------|
| `SS.LEGION REVENANT=1;2;3;4` | four `Normal` skills, indices `1,2,3,4` |
| `SS.VOID HIGHLORD=1:SH>60;2;3:SH>60;4` | `1` safe HP ≥60%; `2` normal; `3` safe HP ≥60%; `4` normal |
| `SS.TROLL SPELLSMITH=1;2;3:SM<30;4` | `3` safe MP <30% |
| `SS.LIGHTCASTER=1;2;3:SH<60;4` | `3` safe HP <60% |
| `SS.DRAGON OF TIME=3;2;1;2;4;2wait` | "wait" stripped → all five normal entries get `waitCd = true` |

Implementation traps a port must reproduce or consciously fix:

- `Index` and `SafeValue` are parsed positionally from the raw substring: `sType = safer.Remove(0, 2)[0].ToString()` and `sValue = int.Parse(safer.Remove(0, 3))` (`Grimoire/UI/Root.cs:1546-1547`). So `SH>60` → op `>` (the char at offset 2) and value `60` (from offset 3). A two-char operator body would break it.
- `Contains("wait")` + `Replace("wait", "")` is a global substring swap with no delimiters, so a class-name-free entry like `2wait` works but any entry whose text happens to contain `wait` is corrupted.
- The parser only recognises the `SH`/`SM` prefixes; an unknown prefix silently produces no skill (`switch` falls through, `:1549-1571`).
- The preset is applied through `getSkillPreset()`'s caller at `Grimoire/UI/Root.cs:1596`, which is a UI action, not part of bot loading.

### `config.cfg`

A second `.cfg` keyed by *command class name* + `Color`, plus three scalars. Written by `CommandColorForm` (`Grimoire/UI/CommandColorForm.cs:26-29`, and `:253-256`). Readers: `BotManager.GetColor` uses default `"FFDCDCDC"` when the key is absent, `int.Parse` with `NumberStyles.HexNumber`; `GetBoolCentered` reads `"<name>Centered"` default `"false"`; the load path also reads `font` (`:53-57`) and `lstCommandsFontSize` default `"60"` (`:58`), and `Grimoire/UI/BotManager.cs:183-189` reads `font` and `CommandsSize` default `"60"`.

The shipped sample is 128 colour keys and **no** `font`, `fontSize`, `CommandsSize`, `lstCommandsFontSize` or `mana` key, which is the case that exercises every `??` fallback. Colours are ARGB hex written by `colorDialog1.Color.ToArgb().ToString("X")` (`:28`) — which, for values whose high byte round-trips to a `uint`, yields the 8-digit `FFRRGGBB` form seen throughout the sample. An AQW-relevant key is `VariableColor`; `mana` is read by the skill handler (`Grimoire/Networking/Handlers/HandlerSkills.cs:20`, `:24-30`).

Ported to AquaStar this is not a bot file at all — it is desktop UI theming, and nothing about it is worth carrying across.

### `MapConfig.cfg`

`Grimoire/Tools/MapConfig.cs:11` loads `<exe>/MapConfig.cfg` through the same `Config` class, and `Areas` are keyed `Map.<name>` with a `;`-separated payload. The one documented shape is in a dead helper: `Map.Ultradarkon=Enter;Spawn;8733` (`Grimoire/Tools/MapConfig.cs:49-52`), i.e. cell `;` pad `;` room number. `GetMapNames()` (`:33-47`) reads the file **directly** rather than through `Config.Contents` — it re-reads lines, keeps those starting with `Map.` and containing `=`, and returns `key.Substring(4)`. No writer for `Map.<name>` exists anywhere in the compiled tree; the only `SetValue` caller is the commented-out `bangke()`. Treat this file as read-only legacy and UNVERIFIED for any key beyond `Map.*`.

---

## 8. Maid

### `MaidConfig` — plain JSON, no `$type`

Class: `Grimoire/Tools/Maid/MaidConfig.cs:3-29`. 17 properties, all nullable-typed in the file so that "absent" is distinguishable from "false": `Target`, `SkillList`, `LockedZoneHandlerMaps`, `SafeSkillList`, `BuffStopAttackList`, `AttackPriorityMonster`, `SpecialMsg`, `WhitelistMapMaps`, `RelogDelay`, `SkillDelay`, `SafeSkillHP`, `SpecialAct`, `UltraBossExtra`, `AntiCounter`, `CopyWalk`, `AttackPriority`, `BuffStopAttack`, `WaitSkill`, `StopFailedGoto`, `LockedZoneHandler`, `WhitelistMap`, `GlobalHotkey`, `SafeSkill`.

Read and written **without** a serializer-settings object, so there is no `TypeNameHandling.All` and no `$type`/`$values` anywhere:

- save: `File.WriteAllText(path, JsonConvert.SerializeObject(saveConfig(), Formatting.Indented))` (`Grimoire/UI/Maid/MaidRemake.cs:1438`)
- load: `JsonConvert.DeserializeObject<MaidConfig>(json)` (`:1552`)
- `ApplyConfig` is null-tolerant per field: strings are applied only `if (!string.IsNullOrEmpty(...))`, numerics only `if (config.X.HasValue)`, and bools fall back to the current control state via `?? cbX.Checked` (`:1483-1530`)

That `?? cbX.Checked` pattern is why the `bool?` typing matters: an absent bool means "leave the UI as it is", not "false".

`Resources/Plugins/Maid/Default.json` is a template in exactly this shape (plus the full key set including `LockedZoneHandlerMaps: "citadel-6666;m22;Left\r\ntercessuinotlim-6666"` — a **raw CRLF inside a JSON string**, so any port must not assume single-line values). **No C# in this tree reads that file** (`rg` for `Plugins/Maid` and `Default.json` across `*.cs` returns nothing); it is shipped for the user to copy. The DLLs under `Resources/Plugins/**` were not disassembled, so whether `Maid.dll` reads it is **UNVERIFIED**. The five `Resources/Bots/Ultra Boss/Eclipse/Maid/*.json` files are the same shape with `Target: "remake"` and per-phase values (`SpecialMsg`, `SpecialAct`, `UltraBossExtra`, `AntiCounter`).

### Where Maid files live

Both dialogs are hardcoded to `<exe>/Config` and create it if absent (`Grimoire/UI/Maid/MaidRemake.cs:1423-1424` on save, `:1452-1455` on load), with `SaveFileDialog.Filter = "Maid config|*.json"`.

### `Config/autoload.json`

The auto-load path, and this is the piece that most resembles AquaStar's own "seed on first run" pattern:

```csharp
private void AutoLoadConfig()
{
    string configFolder = Path.Combine(Application.StartupPath, "Config");
    string autoConfig = Path.Combine(configFolder, "autoload.json");
    if (!File.Exists(autoConfig)) return;
    if (!TryDeserialize(File.ReadAllText(autoConfig), out MaidConfig config)) return;
    ApplyConfig(config, Path.GetFileName(autoConfig));
}
```

(`Grimoire/UI/Maid/MaidRemake.cs:1470-1481`, called from `:95` on window construction.) Same `MaidConfig` shape, same plain-JSON dialect, fixed filename, silent no-op when missing. The loaded filename is shown in the group box caption (`gbConfig.Text = $"Config : {fileName}"`, `:1485`) so the user can see what was picked up.

Class presets are *not* files: `Grimoire/Tools/Maid/ClassPreset.cs` hardcodes skill lists per class as C# (e.g. `EC()` → `"4,3,2,1,2,1,2,1,2"`, `LOO()` → `"2,1,3,4"`), so they cannot be extended without editing and rebuilding the app.

---

## 9. Everything else written next to the executable

| File / dir | Format | Written by | Notes |
|------------|--------|------------|-------|
| `MapItemLog.txt` | one `id = "name (map)"` per line, sorted by id then value, deduped across runs | `Root.SaveRecentMapItemMerged` (`Grimoire/UI/Root.cs:1781-1822`, separator const `:1780`), called on close (`:187`) | entries originate from the `getn` handler: `Player.recentMapItem[mapItemid] = $"{name} ({Player.Map})"` (`Grimoire/Networking/Handlers/MapItemHandler.cs:41-48`), backing dictionary at `Grimoire/Game/Player.cs:444`. The reader that consumed it (`Player.initMapItem`) is **commented out** (`Grimoire/Game/Player.cs:446-469`), so the file is write-only in this revision. Re-parsed by the Notepad `mapitems` affordance (`Grimoire/UI/Notepad.cs:58-66`) |
| `hotkeys.json` | bare JSON **array** of `{ Text, Key, ActionIndex }` | `Grimoire/UI/Hotkeys.cs:223` (write), `:228-230` (read) | no `$type`, no wrapper; `Key` is the WinForms `Keys` enum as an integer (`Grimoire/Tools/Hotkey.cs:13`). Sample in the `revamp-fhd` branch: `[{"Text": "F10: Show Bot", "Key": 121, "ActionIndex": 1}, …]`. Windows-only by construction |
| `CharSelect.cfg` | `Config` key/value: index → `username,password` | read at `Grimoire/UI/Root.cs:135` | **plaintext credentials** (`bin/Debug/CharSelect.cfg` in `49b9d6a` is `0=username1,password`). AquaStar stores no AQW credentials and must not inherit this |
| `Sets/*.gset` | `{ "$type": …, "Set": { "$type": "List`1[…ISetInterface…]", "$values": [ { "$type": …Item…, "Type": …, "Name": … } ] } }` | `Grimoire/UI/Set.cs:45-51` (build), `:225-229` (save), settings at `:21-26` (`DefaultValueHandling.Include` + `TypeNameHandling.All`), classes at `:289-304` | directory created on demand (`:217-219`, `:254-256`). Consumed by `CmdEquipSet`, which mis-joins the path (see §6) |
| `Sets/*` (Cosmetic form) | **24 fixed lines** of `label: value`, blank-line separated | `Grimoire/UI/CosmeticForm.cs:310-343` (`File.WriteAllLines`) | read positionally with magic indices `s[1], s[2], s[4], s[5], s[7], s[8], s[10], s[11], s[13], s[14], s[16], s[17], s[19], s[20], s[22], s[23]` (`:358-373`), all wrapped in a bare `catch {}`. **Two unrelated formats share one directory** with different extensions (`.gset` JSON vs. extension-less line files) |
| `Plugins/**` | DLLs | `Grimoire/UI/PluginManager.cs:43-50` | native .NET plugin assemblies; out of scope for a JS port. Not disassembled — **UNVERIFIED** |
| `Resources/statementcmds.txt`, `Resources/defaulttext.txt` | type-name JSON (a real `List<StatementCommand>` with `$type` per element) and a plain `{ controlName: placeholder }` map | not runtime files: both are `<None>` items in the project (`Grimoire.csproj:758-759`) referenced as embedded `ResXFileRef` entries (`Properties/Resources.resx`: `statementcmds`, `defaulttext`) and deserialized from `Resources.*` (`Grimoire/UI/BotManager.cs:180-181`) | authoring inputs for the statement catalogue and the placeholder text of every command control |

### Resources/Notes/variables.txt

20 lines (`Resources/Notes/variables.txt`). It claims four placeholder sets; only the first is accurate:

| Section | Lines | Verdict |
|---------|-------|---------|
| Packet-cmd variables | 1-5 | **correct** — `{ROOM_ID}`, `{ROOM_NUMBER}`, `{GETMAP}`, `PLAYERNAME` all exist in code (`Grimoire/Botting/Commands/Misc/CmdPacket.cs:58-61`) |
| `setvar` variables | 7-11 | marked `[WIP]` in the file itself. `{weapon}`, `{class}`, `{helm}`, `{cape}` are implemented, plus an undocumented `{nr10}`; `{class}` has **no `?? "Error"` fallback** unlike its siblings (`Grimoire/Botting/Commands/Misc/Statements/CmdSetVar.cs:30-54`) |
| Equip-command forge names | 13-37 | names are real (`Grimoire/Game/Data/InventoryItem.cs:37+` `forgeID` maps them to numeric ids), but the file does not mention that the lookup is by id |

---

## 10. Portability and round-trip verdict

Split by direction, because the three directions have different blockers.

### Read existing bots — **portable, low risk**

`JSON.parse` accepts all 60 corpus files unchanged; the `$type`/`$values` wrappers are ordinary object properties and need no special handling to be *skipped*. The work is in what you do after parsing:

1. Unwrap `$values` for the seven list fields.
2. Reconstruct omitted defaults. This is the only place with real risk, and it is bounded: consult §3 for the defaults, and remember the two non-zero initializers (`SkillDelay = 150`, `optionDelay = 500`).
3. Branch on the leaf of `$type` to pick a command implementation. Strip only the `Grimoire.` prefix and `, Grimoire` suffix — the full string is the identity.
4. Tolerate unknown fields (the `DropDelay` precedent shows real bots carry them) and tolerate the older `Quest` shape with `IsInProgress`/`CanComplete` present (§3).
5. Try base64+gzip on `Description` first, fall back to plain text.

No AquaStar code reads `.gbot` today: `rg -i 'gbot|grimlite|grimoire'` over the working tree returns nothing outside `node_modules`. This is a greenfield reader.

### Write bots Grimlite can open — **portable, with four hard requirements**

1. **Exact `$type` strings**, including the trailing `, Grimoire` and the `mscorlib` assembly for generic wrappers. A `$type` naming a type absent from `Grimoire.exe` throws during deserialization and surfaces as a `MessageBox` (`Grimoire/UI/BotManager.cs:1363`).
2. **Enums as integers** (§4). Strings will not deserialize into an enum property.
3. **Always-write fields**: copy the C# `DefaultValueHandling.Include` list rather than inferring it — `CmdLoadBot.PassDropList`, `CmdLoadBot.PassSkillPreset` (`Grimoire/Botting/Commands/Misc/CmdLoadBot.cs:26-37`), `CmdCompleteQuest.ReAccept` (`Grimoire/Botting/Commands/Quest/CmdCompleteQuest.cs:15-16`), `CmdAcceptQuest.ghostAccept` (`Grimoire/Botting/Commands/Quest/CmdAcceptQuest.cs:17-22`).
4. **Encoding**: UTF-8 without BOM, `\n` or `\r\n` (Newtonsoft does not care; the corpus uses `\n`), 2-space indent if you want byte-similarity.

Because `DefaultValueHandling.Ignore` only *omits* defaults on write and does not reject them on read, a JS writer may safely emit every known field — Grimlite will read it back identically. The file will simply be larger than a Grimlite-authored one. Byte-identical output requires mirroring every C# default exactly, and is not necessary for interop.

Conversely, **read→write→read is lossy unless you preserve the original key set**, because a field that was absent because it equalled its default cannot be distinguished from a field absent because the authoring build never had it. For the `DropDelay`/`ReloginEvery` bots, a rewrite silently deletes data that current Grimlite already ignores. Recommend keeping the parsed object and mutating it rather than re-serializing from a normalized model.

Fields that are Windows-only or meaningless in AquaStar: `botFilePath`-style backslash paths (§6), `CmdEquipSet`'s `Application.StartupPath` join, `CmdSpecialHandler`'s dependency on a WinForms `BotManager` static (`Grimoire/Botting/Commands/Misc/CmdSpecialHandler.cs:36`), `CmdTauntcycle`'s `World.PlayersInMap` ordering, every `Misc.Statements.Cmd*` that reads the SWF object graph, and `MapConfig.cfg`/`Sets/`/`CharSelect.cfg`/`hotkeys.json` as a whole.

### Execute them — **blocked; this is the real finding**

The `.gbot` format is easy. The execution model is not, and this is where the engine ticket's cost lives.

Grimlite drives the game exclusively through a **bridge exposed by its own modified SWF**, `Loader/grimoire.swf`, not through anything in the stock loader. Inflating that file (`python3 -c "import zlib; …"` over bytes 8+, a CWS/zlib SWF, 29,126 bytes → 48,546 bytes) and scanning its string table shows the bridge by name:

```
grimoire:Externalizer   grimoire:Caller   grimoire:Root
grimoire.game:Player    grimoire.game:World   grimoire.game:Quests
grimoire.game:Bank      grimoire.game:Inventory   grimoire.game:TempInventory
grimoire.game:Shops     grimoire.game:Settings   grimoire.game:House
grimoire.game:AutoRelogin     grimoire.tools:SFSEvent
```

and the host-side call names that Copilot/Grimlite invokes on it — `SetFPS`, `ChangeColorName`, `GetSkillName`, `IsInProgress`, `CanComplete`, `Accept`, `GetMapItem`, `UseSkill`, `ForceUseSkill`, `Equip`, `SetEquip`, `GetEquip`, `Rest`, `Logout`, `SetTargetPlayer`, `GetUsername`, `UserID`, `IsMember`, `GetAccessLevel`, `AuraDuration`, `GetQuestTree`, `Externalizer::init done.` — are all present in that table (`Grimoire/Tools/Flash.cs` is the caller; `Flash.Call` / `Flash.CallGameFunction` / `GetGameObject` are the transport). Packet sends bypass the SWF entirely and go through Grimlite's own man-in-the-middle proxy (`Proxy.Instance.SendToServer`, e.g. `Grimoire/Botting/Commands/Misc/CmdPacket.cs`).

Note the overlap with things AquaStar already observes: `MapItemLog.txt` is fed by parsing an `%xt%zm%getn%…%` reply (`Grimoire/Networking/Handlers/MapItemHandler.cs`), which is the same wire protocol AquaStar's own socket proxy relays.

A port therefore needs two seams, and AquaStar has one of them:

- **Packet seam — partially available.** `res/socketProxy.js` is a localhost WebSocket→TCP relay (`ws://127.0.0.1:8191`, `res/socketProxy.js:10-11`) that exists so **Ruffle** can reach raw-socket netcode; it is gated by an explicit `allowedHosts` allowlist (`res/socketProxy.js:17-34`, `:49-52`) precisely so a local page cannot use it to reach arbitrary hosts. AquaStar's equivalent of Grimlite's MITM is that relay plus the platform's single shared `webRequest` layer (`res/platform/session-rules.js:1-8`, `:61-113`). This is a plausible foundation for `CmdPacket`, `CmdBackgroundPacket` and `CmdQuestHunt`-style flows — but nothing today parses or synthesizes `%xt%zm%` frames, and the relay is a Ruffle-only path (`res/socketProxy.js:4-9`).
- **Movie-control seam — missing.** `Flash.Call`'s transport is the modified SWF's `Externalizer`. AquaStar runs Artix's stock loader by default; the only substitution point is the platform-owned local SWF override (`custom-game.swf`, `res/customSwf.js:13`, `:33`, `:40-47`, with `customSwfAliases: ["aqlite_old.swf"]` in `plugins/adventure-quest-worlds/plugin.json`). `res/swf_wrapper.html` builds the embedding `<object>` and passes `allowscriptaccess: always` (`:40`) plus `allownetworking: all` (`:45`), so the *precondition* for a page-side JS bridge is already satisfied — but **nothing in the tree consumes it**: `rg -i 'ExternalInterface|__flash|flashvars'` over `res/` and `plugins/` returns only unrelated `openExternal`/`flashVars` hits (the latter is Char Page Studio's helper-process config, not a game bridge), and the game window's preload is the screenshot-capture preload (`res/windows/config.js:34-35`, `windows/config.js:38` has `plugins: true` for Flash).

So: an `.gbot` can be parsed, displayed, edited, and re-emitted by AquaStar today. Executing one requires either (a) a Flash-side bridge injected alongside the SWF (the `Externalizer` equivalent), or (b) rewriting the ~148 command implementations against AquaStar's own seams (socket relay + injected page script), or (c) shipping a SWF that exposes the same API. That decision belongs to the engine ticket, not this one.

---

## 11. Schema notes for the engine ticket

**Storage.** Anything AquaStar writes should go through the plugin store, not a bespoke path helper. `host.getStore(ns)` resolves to `<appData>/aquastar.<pluginId>.<ns>.json` unless the manifest declares an alias (`res/platform/storage/namespaced-store.js:7-12`, `:32-58`), and the AQW plugin already uses aliases to hold legacy filenames (`plugins/adventure-quest-worlds/plugin.json:51-56`: `reminders`, `todo`, `strategy`, `inventory`). The underlying adapter is `res/repositories/json-store.js` — `JSON.parse(readFileSync)` on read (`:6-8`) and `JSON.stringify(value, null, 4)` on write (`:10-17`), creating parent directories as needed. Note the read path does **not** catch parse errors; callers must (the existing feature modules do, e.g. `plugins/adventure-quest-worlds/features/todo/todo.js:45-55`).

Consequences for a bot store:

- Suggested namespace: `bots` (bots are user documents, not per-character state, so they are not a `list-state` shape like Reminders/To-Do and should not be routed through `features/common/list_window_common.js`).
- If 1:1 interop with a Grimlite install is wanted, the file is a **document the user opens**, not app state — so a plain `getStore('bots')` holding the current bot is the wrong model; a `dialog.showOpenDialog`/`showSaveDialog` pair over the user's own `botsDir` is the right one, with the store reserved for "last used directory".
- Interop with Grimlite's on-disk tree means accepting an arbitrary user-chosen directory and enumerating `*.gbot` one level at a time to rebuild the folder tree (`Grimoire/UI/BotManager.cs:1575-1608`).

**Settings.** There is no AquaStar analogue of `ClientConfig.cfg`, and there should not be: the four keys with real behaviour map onto existing platform or plugin settings rather than a new key/value file — `flash` → the plugin's primary game URL or the `custom-game.swf` override (`res/customSwf.js`); `botsDir` → an app setting for the bot directory; `safeCell` → a Grimlite-ism that only matters if the command port is done, in which case it belongs in the bot's own JSON, not in a global `.cfg`; `SS.<CLASS>` → the skill-set concept already present in `.gbot` itself as `Skill.Type = 2` + `CmdSkillSet`, which is the better home. `accessLevel` and `questListDelay` are dead even in Grimlite (§7).

**Files that must not be ported.** `CharSelect.cfg` (plaintext credentials, `Grimoire/UI/Root.cs:135`), `config.cfg` (WinForms theming), `Sets/` in either of its two formats, `hotkeys.json` (WinForms `Keys` ints), `MapConfig.cfg` (read-only legacy with no writer), and `Resources/Plugins/**` DLLs.

**Corpus to use as test fixtures.** `Resources/Bots/**` — 60 `.gbot` files covering 148 command types, three `Skills` shapes (plain, safe-gated, label/skill-set), nested folders, a gzipped `Description`, a CRLF-in-string Maid config, and two legacy keys (`DropDelay`, `ReloginEvery`) that current Grimlite silently drops. A reader that survives all 60 and re-emits byte-identical output for the ones without legacy keys is done.
