// The Bot Manager's controls, transcribed from the reference's designer
// (Grimoire/UI/BotManager.Designer.cs, Grimlite-Li 816d9cd). Control ids are the reference's own
// names, so tab-actions.js reads like the reference's handlers, and every label is the exact
// string the designer sets. A group, panel or split carries children in the same shape.
//
// kind: group | tick | button | text | number | select | radio | label | list | tree | grid | panel | split | rtf
// TABS is the eleven tab pages; COLUMN is the left column that lives outside the tab host
// (the six list views, the list selector, Remove / up / down / Clear / all, the search box, the
// Enable Bot tickbox), which the reference builds in splitContainer1.

const TABS = [
  {
    id:  "combat",
    title:  "Combat",
    controls:  [
      {
        id:  "darkGroupBox20",
        kind:  "group",
        text:  "Specific Skill Set",
        children:  [
          {
            id:  "txtSkillSet",
            kind:  "text",
            text:  "Skill Set Name"
          },
          {
            id:  "btnAddSkillSet",
            kind:  "button",
            text:  "Add Skill Set"
          },
          {
            id:  "btnUseSkillSet",
            kind:  "button",
            text:  "Use Skill Set"
          }
        ]
      },
      {
        id:  "darkGroupBox19",
        kind:  "group",
        text:  "Rest",
        children:  [
          {
            id:  "btnRest",
            kind:  "button",
            text:  "Rest"
          },
          {
            id:  "chkHP",
            kind:  "tick",
            text:  "HP <="
          },
          {
            id:  "numRest",
            kind:  "number",
            value:  60
          },
          {
            id:  "chkMP",
            kind:  "tick",
            text:  "MP <="
          },
          {
            id:  "btnRestF",
            kind:  "button",
            text:  "Rest fully"
          },
          {
            id:  "numRestMP",
            kind:  "number",
            value:  60
          },
          {
            id:  "label10",
            kind:  "label",
            text:  "%"
          },
          {
            id:  "label12",
            kind:  "label",
            text:  "Rest if"
          },
          {
            id:  "label11",
            kind:  "label",
            text:  "%"
          }
        ]
      },
      {
        id:  "darkGroupBox17",
        kind:  "group",
        text:  "Kill for items",
        children:  [
          {
            id:  "rbItems",
            kind:  "radio",
            checked:  true,
            text:  "Items"
          },
          {
            id:  "rbTemp",
            kind:  "radio",
            text:  "Temp items"
          },
          {
            id:  "txtKillFMon",
            kind:  "text",
            text:  "Monster (* = random)"
          },
          {
            id:  "txtKillFItem",
            kind:  "text",
            text:  "Item name"
          },
          {
            id:  "txtKillFQ",
            kind:  "text",
            text:  "Quantity (* = any)"
          },
          {
            id:  "chkAddToWhiteList",
            kind:  "tick",
            checked:  true,
            text:  "add to Whitelist"
          },
          {
            id:  "btnKillF",
            kind:  "button",
            text:  "Kill for [KF]"
          }
        ]
      },
      {
        id:  "darkGroupBox18",
        kind:  "group",
        text:  "Skill Command",
        children:  [
          {
            id:  "btnLeaveCombat",
            kind:  "button",
            text:  "Leave combat"
          },
          {
            id:  "btnStopAttack",
            kind:  "button",
            text:  "Stop attack"
          },
          {
            id:  "numSkillCmd",
            kind:  "number",
            value:  1
          },
          {
            id:  "cbSkillCmdWait",
            kind:  "tick",
            text:  "Wait"
          },
          {
            id:  "txtMonsterSkillCmd",
            kind:  "text",
            text:  "Monster (* = random)"
          },
          {
            id:  "btnSkillCmd",
            kind:  "button",
            text:  "Add"
          },
          {
            id:  "chkForceSkill",
            kind:  "tick",
            text:  "Force"
          }
        ]
      },
      {
        id:  "chkSkillCD",
        kind:  "tick",
        text:  "Wait for skill to cooldown"
      },
      {
        id:  "btnAttack",
        kind:  "button",
        text:  "Attack"
      },
      {
        id:  "btnKill",
        kind:  "button",
        text:  "Kill"
      },
      {
        id:  "chkExistQuest",
        kind:  "tick",
        text:  "Exit combat before completing quest"
      },
      {
        id:  "chkExitRest",
        kind:  "tick",
        checked:  true,
        text:  "Exit combat before resting"
      },
      {
        id:  "chkAllSkillsCD",
        kind:  "tick",
        text:  "Wait for all skills to cool down"
      },
      {
        id:  "txtMonster",
        kind:  "text",
        text:  "Monster (* = random)"
      },
      {
        id:  "boxSkillSet",
        kind:  "group",
        text:  "Skill Set",
        children:  [
          {
            id:  "darkLabel7",
            kind:  "label",
            text:  "ms"
          },
          {
            id:  "numSkill",
            kind:  "number",
            value:  1
          },
          {
            id:  "btnAddSkill",
            kind:  "button",
            text:  "Add skill"
          },
          {
            id:  "btnAddSafe",
            kind:  "button",
            text:  "Safe skill"
          },
          {
            id:  "btnAllSkill",
            kind:  "button",
            text:  "All"
          },
          {
            id:  "numSafe",
            kind:  "number",
            value:  60
          },
          {
            id:  "label2",
            kind:  "label",
            text:  "%"
          },
          {
            id:  "label17",
            kind:  "label",
            text:  "HP or"
          },
          {
            id:  "chkSafeMp",
            kind:  "tick",
            text:  "MP"
          },
          {
            id:  "cbSafeType",
            kind:  "select",
            options:  [
              "<= Lower than",
              ">= Greater than"
            ]
          },
          {
            id:  "label13",
            kind:  "label",
            text:  "Skill delay"
          },
          {
            id:  "numSkillD",
            kind:  "number",
            value:  50
          }
        ]
      }
    ]
  },
  {
    id:  "map",
    title:  "Map",
    controls:  [
      {
        id:  "darkLabel1",
        kind:  "label",
        text:  "Join attempt(s)"
      },
      {
        id:  "cbJoinMapSwf",
        kind:  "tick"
      },
      {
        id:  "tbJoinMapSwf",
        kind:  "text",
        text:  "Map file (.swf)"
      },
      {
        id:  "darkLabel10",
        kind:  "label",
        text:  "x"
      },
      {
        id:  "numJoinTry",
        kind:  "number",
        value:  1
      },
      {
        id:  "btnSetSpawn",
        kind:  "button",
        text:  "Set Spawnpoint"
      },
      {
        id:  "btnWalkRdm",
        kind:  "button",
        text:  "Walk Randomly"
      },
      {
        id:  "btnWalkCur",
        kind:  "button",
        text:  "Current position"
      },
      {
        id:  "btnWalk",
        kind:  "button",
        text:  "Walk to"
      },
      {
        id:  "numWalkY",
        kind:  "number",
        value:  1
      },
      {
        id:  "numWalkX",
        kind:  "number",
        value:  1
      },
      {
        id:  "button2",
        kind:  "button",
        text:  ">"
      },
      {
        id:  "btnCellSwap",
        kind:  "button",
        text:  "<"
      },
      {
        id:  "btnJump",
        kind:  "button",
        text:  "Jump"
      },
      {
        id:  "btnCurrCell",
        kind:  "button",
        text:  "Get current cell"
      },
      {
        id:  "txtPad",
        kind:  "text",
        text:  "Pad"
      },
      {
        id:  "txtCell",
        kind:  "text",
        text:  "Cell"
      },
      {
        id:  "btnJoin",
        kind:  "button",
        text:  "Join map"
      },
      {
        id:  "txtJoinPad",
        kind:  "text",
        text:  "Spawn"
      },
      {
        id:  "txtJoinCell",
        kind:  "text",
        text:  "Enter"
      },
      {
        id:  "txtJoin",
        kind:  "text",
        text:  "battleon-1e99"
      }
    ]
  },
  {
    id:  "item",
    title:  "Item",
    controls:  [
      {
        id:  "darkGroupBox5",
        kind:  "group",
        text:  "Map Item",
        children:  [
          {
            id:  "btnMapItemExe",
            kind:  "button",
            text:  "Get"
          },
          {
            id:  "btnMapItem",
            kind:  "button",
            text:  "Cmd"
          },
          {
            id:  "numMapItem",
            kind:  "number",
            value:  1
          }
        ]
      },
      {
        id:  "darkGroupBox4",
        kind:  "group",
        text:  "Options",
        children:  [
          {
            id:  "chkInventOnStart",
            kind:  "tick",
            checked:  true,
            text:  "Items to Invent on Start"
          },
          {
            id:  "chkPickupAll",
            kind:  "tick",
            text:  "Pick up all items"
          },
          {
            id:  "chkPickup",
            kind:  "tick",
            checked:  true,
            text:  "Pick up whitelisted"
          },
          {
            id:  "chkReject",
            kind:  "tick",
            text:  "Reject non-whitelisted"
          },
          {
            id:  "chkPickupAcTag",
            kind:  "tick",
            text:  "Pick up ac-tagged only"
          },
          {
            id:  "chkBankOnStop",
            kind:  "tick",
            text:  "Items to Bank on Stop "
          }
        ]
      },
      {
        id:  "darkGroupBox3",
        kind:  "group",
        text:  "Shop",
        children:  [
          {
            id:  "radBuyByName",
            kind:  "radio",
            checked:  true
          },
          {
            id:  "radBuyByID",
            kind:  "radio"
          },
          {
            id:  "tbShopId",
            kind:  "text",
            text:  "Shop Id"
          },
          {
            id:  "tbShopItemId",
            kind:  "text",
            text:  "Shop Item Id"
          },
          {
            id:  "tbItemId",
            kind:  "text",
            text:  "Item Id"
          },
          {
            id:  "label1",
            kind:  "label",
            text:  "Qty"
          },
          {
            id:  "numBuyQty",
            kind:  "number",
            value:  1
          },
          {
            id:  "btnLoadShop",
            kind:  "button",
            text:  "Load (cmd)"
          },
          {
            id:  "tbShopItemName",
            kind:  "text",
            text:  "Shop Item Name"
          },
          {
            id:  "btnBuy",
            kind:  "button",
            text:  "Buy item"
          },
          {
            id:  "btnBuyFast",
            kind:  "button",
            text:  "Buy fast"
          }
        ]
      },
      {
        id:  "darkGroupBox2",
        kind:  "group",
        text:  "Whitelist",
        children:  [
          {
            id:  "btnWhitelistToggle",
            kind:  "button",
            text:  "Toggle"
          },
          {
            id:  "btnWhitelistOn",
            kind:  "button",
            text:  "On"
          },
          {
            id:  "btnWhitelistOff",
            kind:  "button",
            text:  "Off"
          }
        ]
      },
      {
        id:  "btnBoost",
        kind:  "button",
        text:  "Add boost"
      },
      {
        id:  "cbBoosts",
        kind:  "select"
      },
      {
        id:  "btnSwap",
        kind:  "button",
        text:  "Bank swap"
      },
      {
        id:  "txtSwapInv",
        kind:  "text",
        text:  "Inventory item name"
      },
      {
        id:  "txtSwapBank",
        kind:  "text",
        text:  "Bank item name"
      },
      {
        id:  "btnWhitelist",
        kind:  "button",
        text:  "Add to whitelist"
      },
      {
        id:  "btnBoth",
        kind:  "button",
        text:  "Add to both"
      },
      {
        id:  "txtWhitelist",
        kind:  "text",
        text:  "Item name"
      },
      {
        id:  "btnItem",
        kind:  "button",
        text:  "Add command"
      },
      {
        id:  "btnUnbanklst",
        kind:  "button",
        text:  "Add to Unbank list"
      },
      {
        id:  "txtItem",
        kind:  "text",
        text:  "Item name"
      },
      {
        id:  "cbItemCmds",
        kind:  "select",
        unselected:  true,
        options:  [
          "Get drop",
          "Sell",
          "Equip",
          "Unsafe Equip",
          "To bank from inv",
          "To inv from bank",
          "Equip Set",
          "Add to Whitelist",
          "Remove from Whitelist"
        ]
      }
    ]
  },
  {
    id:  "quest",
    title:  "Quest",
    controls:  [
      {
        id:  "darkGroupBox26",
        kind:  "group",
        text:  "Grabber",
        children:  [
          {
            id:  "darkLabel4",
            kind:  "label",
            text:  "Quest ID"
          },
          {
            id:  "numQQuestId",
            kind:  "number",
            value:  1
          },
          {
            id:  "btnQAddToWhitelist",
            kind:  "button",
            text:  "Add item whitelist"
          },
          {
            id:  "chkQRequirements",
            kind:  "tick",
            checked:  true,
            text:  "Requirments"
          },
          {
            id:  "chkQRewards",
            kind:  "tick",
            checked:  true,
            text:  "Rewards"
          }
        ]
      },
      {
        id:  "darkGroupBox25",
        kind:  "group",
        text:  "Quest List",
        children:  [
          {
            id:  "chkReloginCompleteQuest",
            kind:  "tick",
            checked:  true,
            text:  "Logout after 5 times failed to complete a quest"
          },
          {
            id:  "darkLabel13",
            kind:  "label",
            text:  "Quest ID"
          },
          {
            id:  "darkLabel8",
            kind:  "label",
            text:  "Delay"
          },
          {
            id:  "numQuestListID",
            kind:  "number",
            value:  1
          },
          {
            id:  "numQuestDelay",
            kind:  "number",
            value:  1000
          },
          {
            id:  "btnAddQuestList",
            kind:  "button",
            text:  "Add (cmd)"
          },
          {
            id:  "chkQuestListItem",
            kind:  "tick",
            text:  "Item ID"
          },
          {
            id:  "darkLabel5",
            kind:  "label",
            text:  "ms"
          },
          {
            id:  "numQuestListItem",
            kind:  "number",
            value:  1
          },
          {
            id:  "btnRemoveQuestList",
            kind:  "button",
            text:  "Remove (cmd)"
          },
          {
            id:  "btnQuestAdd",
            kind:  "button",
            text:  "Add to quest list"
          }
        ]
      },
      {
        id:  "darkGroupBox24",
        kind:  "group",
        text:  "Quest",
        children:  [
          {
            id:  "darkLabel12",
            kind:  "label",
            text:  "qty"
          },
          {
            id:  "label4",
            kind:  "label",
            text:  "Quest ID"
          },
          {
            id:  "numQuestID",
            kind:  "number",
            value:  1
          },
          {
            id:  "chkQuestItem",
            kind:  "tick",
            text:  "Item ID"
          },
          {
            id:  "numQuestItem",
            kind:  "number",
            value:  1
          },
          {
            id:  "btnQuestComplete",
            kind:  "button",
            text:  "Complete (cmd)"
          },
          {
            id:  "btnQuestAccept",
            kind:  "button",
            text:  "Accept (cmd)"
          },
          {
            id:  "numEnsureTries",
            kind:  "number",
            value:  1
          }
        ]
      }
    ]
  },
  {
    id:  "misc",
    title:  "Misc",
    controls:  [
      {
        id:  "btnClearVarInt",
        kind:  "button",
        text:  "Clear Var&Int"
      },
      {
        id:  "darkGroupBox28",
        kind:  "group",
        text:  "Tauntcycle",
        children:  [
          {
            id:  "ButtonTC_Start",
            kind:  "button",
            text:  "Start"
          },
          {
            id:  "ButtonTC_Stop",
            kind:  "button",
            text:  "Stop"
          }
        ]
      },
      {
        id:  "darkGroupBox15",
        kind:  "group",
        text:  "Follow and Kills",
        children:  [
          {
            id:  "btnFollowCmd",
            kind:  "button",
            text:  "Follow"
          },
          {
            id:  "tbFollowPlayer",
            kind:  "text",
            text:  "Player name"
          }
        ]
      },
      {
        id:  "darkGroupBox11",
        kind:  "group",
        text:  "Labels",
        children:  [
          {
            id:  "lbLabels",
            kind:  "?"
          }
        ]
      },
      {
        id:  "darkGroupBox10",
        kind:  "group",
        text:  "Bot Control",
        children:  [
          {
            id:  "btnStop",
            kind:  "button",
            text:  "Stop bot"
          },
          {
            id:  "btnRestart",
            kind:  "button",
            text:  "Restart"
          }
        ]
      },
      {
        id:  "btnAddLabel",
        kind:  "button",
        text:  "Add"
      },
      {
        id:  "btnGotoLabel",
        kind:  "button",
        text:  "Goto"
      },
      {
        id:  "txtLabel",
        kind:  "text",
        text:  "Label name"
      },
      {
        id:  "numSpamTimes",
        kind:  "number",
        value:  1
      },
      {
        id:  "darkGroupBox14",
        kind:  "group",
        text:  "Player",
        children:  [
          {
            id:  "txtPlayer",
            kind:  "text",
            text:  "Player name"
          },
          {
            id:  "btnGoto",
            kind:  "button",
            text:  "Goto"
          }
        ]
      },
      {
        id:  "darkGroupBox12",
        kind:  "group",
        text:  "Temp Integer",
        children:  [
          {
            id:  "txtSetInt",
            kind:  "text"
          },
          {
            id:  "btnSetInt",
            kind:  "button",
            text:  "Set"
          },
          {
            id:  "numSetInt",
            kind:  "number"
          },
          {
            id:  "btnIncreaseInt",
            kind:  "button",
            text:  "++"
          },
          {
            id:  "btnDecreaseInt",
            kind:  "button",
            text:  "--"
          }
        ]
      },
      {
        id:  "btnReturnCmd",
        kind:  "button",
        text:  "Return (command)"
      },
      {
        id:  "darkGroupBox8",
        kind:  "group",
        text:  "Index",
        children:  [
          {
            id:  "numIndexCmd",
            kind:  "number"
          },
          {
            id:  "btnGotoIndex",
            kind:  "button",
            text:  "Goto"
          },
          {
            id:  "btnGoUpIndex",
            kind:  "button",
            text:  "++"
          },
          {
            id:  "btnGoDownIndex",
            kind:  "button",
            text:  "--"
          }
        ]
      },
      {
        id:  "darkGroupBox7",
        kind:  "group",
        text:  "Provoke",
        children:  [
          {
            id:  "btnProvokeOff",
            kind:  "button",
            text:  "Off"
          },
          {
            id:  "btnProvokeOn",
            kind:  "button",
            text:  "On"
          }
        ]
      },
      {
        id:  "btnBlank",
        kind:  "button",
        text:  "Blank Command"
      },
      {
        id:  "btnLogout",
        kind:  "button",
        text:  "Logout"
      },
      {
        id:  "btnBeep",
        kind:  "button",
        text:  "Play Sound"
      },
      {
        id:  "numBeepTimes",
        kind:  "number",
        value:  10
      },
      {
        id:  "btnDelay",
        kind:  "button",
        text:  "Delay"
      },
      {
        id:  "numDelay",
        kind:  "number",
        value:  1500
      },
      {
        id:  "btnStatementAdd",
        kind:  "button",
        text:  "Add statement"
      },
      {
        id:  "txtStatement2",
        kind:  "text"
      },
      {
        id:  "txtStatement1",
        kind:  "text"
      },
      {
        id:  "cbStatement",
        kind:  "select"
      },
      {
        id:  "cbCategories",
        kind:  "select",
        options:  [
          "Aura",
          "Item",
          "This player",
          "Player",
          "Map",
          "Monster",
          "Quest",
          "Misc"
        ]
      },
      {
        id:  "txtPacket",
        kind:  "text",
        text:  "%xt%zm%[packet]%"
      },
      {
        id:  "btnClientPacket",
        kind:  "button",
        text:  "Client Packet"
      },
      {
        id:  "btnPacket",
        kind:  "button",
        text:  "Packet"
      },
      {
        id:  "btnLoadCmd",
        kind:  "button",
        text:  "Load bot (command)"
      }
    ]
  },
  {
    id:  "misc2",
    title:  "Misc 2",
    controls:  [
      {
        id:  "darkGroupBox21",
        kind:  "group",
        text:  "Special handlers",
        children:  [
          {
            id:  "btnSpecialStart",
            kind:  "button",
            text:  "Start"
          },
          {
            id:  "btnSpecialStop",
            kind:  "button",
            text:  "Stop"
          },
          {
            id:  "btnSpecialSwitch",
            kind:  "button",
            text:  "Switch"
          },
          {
            id:  "chkSpecial",
            kind:  "tick"
          },
          {
            id:  "cmbSpecials",
            kind:  "select",
            unselected:  true,
            options:  [
              "Auto Zone - Ultradage",
              "Auto Zone - Dark Carnax",
              "Auto Zone - Astral Empyrean",
              "Auto Zone - Astral Empyrean P1",
              "Auto Zone - Astral Empyrean P2",
              "Auto Zone - Queen Iona",
              "Auto Zone - Colossal Vordred",
              "Gramiel P1",
              "Gramiel P2",
              "Gramiel P3",
              "Gramiel P4",
              "Ultra Speaker DPS",
              "Ultra Speaker LR",
              "Ultra Speaker LOO",
              "Ultra Speaker AP"
            ]
          }
        ]
      },
      {
        id:  "darkGroupBox13",
        kind:  "group",
        text:  "Bot Delay",
        children:  [
          {
            id:  "chkRestartAFK",
            kind:  "tick",
            checked:  true,
            text:  "Restart bot on AFK"
          },
          {
            id:  "label3",
            kind:  "label",
            text:  "Overall \r\nDelay"
          },
          {
            id:  "chkSkip",
            kind:  "tick",
            checked:  true,
            text:  "Skip bot delay for index/if"
          },
          {
            id:  "btnBotDelay",
            kind:  "button",
            text:  "Set (cmd)"
          },
          {
            id:  "numBotDelay",
            kind:  "number",
            value:  100
          },
          {
            id:  "chkRestartDeath",
            kind:  "tick",
            checked:  true,
            text:  "Restart bot upon dying"
          }
        ]
      },
      {
        id:  "darkGroupBox9",
        kind:  "group",
        text:  "Save/Load",
        children:  [
          {
            id:  "txtAuthor",
            kind:  "text",
            text:  "Author"
          },
          {
            id:  "splitContainer3",
            kind:  "split",
            children:  [
              {
                id:  "splitContainer3.Panel1",
                kind:  "panel",
                children:  [
                  {
                    id:  "btnSave",
                    kind:  "button",
                    text:  "Save bot"
                  }
                ]
              },
              {
                id:  "splitContainer3.Panel2",
                kind:  "panel",
                children:  [
                  {
                    id:  "btnLoad",
                    kind:  "button",
                    text:  "Load bot"
                  }
                ]
              }
            ]
          },
          {
            id:  "txtDescription",
            kind:  "text",
            text:  "Description (Write in RTF)"
          }
        ]
      },
      {
        id:  "chkMerge",
        kind:  "tick",
        text:  "Merge"
      },
      {
        id:  "darkGroupBox1",
        kind:  "group",
        text:  "Packet Spammer",
        children:  [
          {
            id:  "btnBSStop",
            kind:  "button",
            text:  "Stop"
          },
          {
            id:  "label8",
            kind:  "label",
            text:  "ms"
          },
          {
            id:  "tbBSLabel",
            kind:  "text",
            text:  "Packet Name"
          },
          {
            id:  "numBSDelay",
            kind:  "number",
            value:  1000
          },
          {
            id:  "tbBSPacket",
            kind:  "text",
            text:  "%xt%zm%getMapItem%1%[mapItemId]%"
          },
          {
            id:  "btnBSAdd",
            kind:  "button",
            text:  "Add"
          }
        ]
      }
    ]
  },
  {
    id:  "options",
    title:  "Options",
    controls:  [
      {
        id:  "chkAntiCounter",
        kind:  "tick",
        text:  "Anti counter attack"
      },
      {
        id:  "chkFollowOnly",
        kind:  "tick",
        text:  "Follow"
      },
      {
        id:  "tbFollowPlayer2",
        kind:  "text",
        text:  "Player name"
      },
      {
        id:  "chkWalkSpeed",
        kind:  "tick",
        text:  "Walk speed"
      },
      {
        id:  "darkGroupBox6",
        kind:  "group",
        text:  "Logs",
        children:  [
          {
            id:  "splitContainer5",
            kind:  "split",
            children:  [
              {
                id:  "splitContainer5.Panel1",
                kind:  "panel",
                children:  [
                  {
                    id:  "btnLog",
                    kind:  "button",
                    text:  "Log Script"
                  }
                ]
              },
              {
                id:  "splitContainer5.Panel2",
                kind:  "panel",
                children:  [
                  {
                    id:  "btnLogDebug",
                    kind:  "button",
                    text:  "Log Debug"
                  }
                ]
              }
            ]
          },
          {
            id:  "lstLogText",
            kind:  "list",
            options:  [
              "{USERNAME}",
              "{MAP}",
              "{GOLD}",
              "{LEVEL}",
              "{CELL}",
              "{HEALTH}",
              "{TIME: 12}",
              "{TIME: 24}",
              "{CLEAR}",
              "{ITEM: item name}",
              "{ITEM MAX: item name}",
              "{REP XP: faction}",
              "{REP RANK: faction}",
              "{REP TOTAL: faction}",
              "{REP REMAINING: faction}",
              "{REP REQUIRED: faction}",
              "{REP CURRENT: faction}",
              "{INT VALUE: int}",
              "{ROOM_ID}"
            ]
          },
          {
            id:  "txtLog",
            kind:  "text",
            text:  "Text"
          },
          {
            id:  "label5",
            kind:  "label",
            text:  "Viable Log References"
          }
        ]
      },
      {
        id:  "label6",
        kind:  "label",
        text:  "Options Timer"
      },
      {
        id:  "numOptionsTimer",
        kind:  "number",
        value:  500
      },
      {
        id:  "chkEnableSettings",
        kind:  "tick",
        text:  "Enable options\r\nwithout starting"
      },
      {
        id:  "chkDisableAnims",
        kind:  "tick",
        text:  "Disable player anims"
      },
      {
        id:  "txtSoundItem",
        kind:  "text"
      },
      {
        id:  "btnSoundAdd",
        kind:  "button",
        text:  "Add"
      },
      {
        id:  "btnSoundDelete",
        kind:  "button",
        text:  "Delete"
      },
      {
        id:  "btnSoundTest",
        kind:  "button",
        text:  "Test"
      },
      {
        id:  "lstSoundItems",
        kind:  "list"
      },
      {
        id:  "label9",
        kind:  "label",
        text:  "If any of the following items\r\nare dropped, play a sound"
      },
      {
        id:  "numWalkSpeed",
        kind:  "number",
        value:  8
      },
      {
        id:  "chkSkipCutscenes",
        kind:  "tick",
        text:  "Skip cutscenes"
      },
      {
        id:  "chkHidePlayers",
        kind:  "tick",
        text:  "Hide players"
      },
      {
        id:  "chkLag",
        kind:  "tick",
        text:  "Lag killer"
      },
      {
        id:  "chkMagnet",
        kind:  "tick",
        text:  "Enemy magnet"
      },
      {
        id:  "chkProvoke",
        kind:  "tick",
        text:  "Provoke monsters"
      },
      {
        id:  "chkInfiniteRange",
        kind:  "tick",
        text:  "Infinite attack range"
      },
      {
        id:  "chkRespawnProvoke",
        kind:  "tick",
        text:  "Respawn Provoke"
      },
      {
        id:  "grpLogin",
        kind:  "group",
        text:  "Auto relogin",
        children:  [
          {
            id:  "chkAFK",
            kind:  "tick",
            text:  "Relogin on AFK"
          },
          {
            id:  "cbServers",
            kind:  "select"
          },
          {
            id:  "chkRelogRetry",
            kind:  "tick",
            text:  "Relog again if in battleon"
          },
          {
            id:  "chkRelog",
            kind:  "tick",
            text:  "Auto relogin"
          },
          {
            id:  "numRelogDelay",
            kind:  "number",
            value:  5000
          },
          {
            id:  "label7",
            kind:  "label",
            text:  "Delay before starting the bot"
          }
        ]
      }
    ]
  },
  {
    id:  "client",
    title:  "Client",
    controls:  [
      {
        id:  "darkGroupBox27",
        kind:  "group",
        text:  "Load Map",
        children:  [
          {
            id:  "tbLoadMap",
            kind:  "text",
            text:  "Map file (.swf)"
          },
          {
            id:  "btnLoadMap",
            kind:  "button",
            text:  "Load"
          }
        ]
      },
      {
        id:  "darkLabel11",
        kind:  "label",
        text:  "FPS"
      },
      {
        id:  "btnSetFPSCmd",
        kind:  "button",
        text:  "(cmd)"
      },
      {
        id:  "darkGroupBox22",
        kind:  "group",
        text:  "Others",
        children:  [
          {
            id:  "chkSaveProgress",
            kind:  "tick",
            text:  "Relogin every"
          },
          {
            id:  "numSaveProgress",
            kind:  "number",
            value:  60
          },
          {
            id:  "darkLabel6",
            kind:  "label",
            text:  "minutes"
          }
        ]
      },
      {
        id:  "btnHideLoading",
        kind:  "button",
        text:  "Hide Loading"
      },
      {
        id:  "btnReloadMap",
        kind:  "button",
        text:  "Reload Map"
      },
      {
        id:  "colorfulCommands",
        kind:  "tick",
        checked:  true,
        text:  "Enable custom commands (CPU intensive)\r\n"
      },
      {
        id:  "darkGroupBox16",
        kind:  "group",
        text:  "Anti Mod",
        children:  [
          {
            id:  "chkAMStopBot",
            kind:  "tick",
            checked:  true,
            text:  "Stop Bot"
          },
          {
            id:  "chkAMLogout",
            kind:  "tick",
            checked:  true,
            text:  "Logout"
          },
          {
            id:  "chkAntiMod",
            kind:  "tick",
            checked:  true,
            text:  "Enable"
          }
        ]
      },
      {
        id:  "btnSetSpawn2",
        kind:  "button",
        text:  "Set Spawnpoint"
      },
      {
        id:  "chkGender",
        kind:  "tick",
        text:  "Gender swap"
      },
      {
        id:  "chkCorrection",
        kind:  "tick",
        checked:  true,
        text:  "Auto Correct Quantity"
      },
      {
        id:  "darkGroupBox23",
        kind:  "group",
        text:  "Map Spoofer",
        children:  [
          {
            id:  "tbMapSpoof",
            kind:  "text",
            text:  "ThisIsCool"
          },
          {
            id:  "chkMapSpoofer",
            kind:  "tick",
            text:  "Enable Spoofer"
          }
        ]
      },
      {
        id:  "numSetFPS",
        kind:  "number",
        value:  30
      },
      {
        id:  "btnSetFPS",
        kind:  "button",
        text:  "Set"
      },
      {
        id:  "btnSetLevelCmd",
        kind:  "button",
        text:  "(cmd)"
      },
      {
        id:  "btnSetLevel",
        kind:  "button",
        text:  "Set"
      },
      {
        id:  "tbLevel",
        kind:  "text",
        text:  "Level"
      },
      {
        id:  "groupBox1",
        kind:  "group",
        text:  "Messages",
        children:  [
          {
            id:  "btnAddInfoMsg",
            kind:  "button",
            text:  "Add Info"
          },
          {
            id:  "btnAddWarnMsg",
            kind:  "button",
            text:  "Add Warning"
          },
          {
            id:  "inputMsgClient",
            kind:  "text",
            text:  "Hello World!"
          }
        ]
      },
      {
        id:  "grpAccessLevel",
        kind:  "group",
        text:  "Access",
        children:  [
          {
            id:  "chkToggleMute",
            kind:  "tick",
            text:  "Toggle Mute"
          },
          {
            id:  "btnSetMem",
            kind:  "button",
            text:  "Member"
          },
          {
            id:  "btnSetModerator",
            kind:  "button",
            text:  "Moderator"
          },
          {
            id:  "btnSetNonMem",
            kind:  "button",
            text:  "Non-Mem"
          }
        ]
      },
      {
        id:  "grpAlignment",
        kind:  "group",
        text:  "Alignment",
        children:  [
          {
            id:  "btnSetChaos",
            kind:  "button",
            text:  "Chaos"
          },
          {
            id:  "btnSetUndecided",
            kind:  "button",
            text:  "Undecided"
          },
          {
            id:  "btnSetGood",
            kind:  "button",
            text:  "Good"
          },
          {
            id:  "btnSetEvil",
            kind:  "button",
            text:  "Evil"
          }
        ]
      },
      {
        id:  "txtUsername",
        kind:  "text",
        text:  "Username"
      },
      {
        id:  "btnChangeNameCmd",
        kind:  "button",
        text:  "(cmd)"
      },
      {
        id:  "btnchangeName",
        kind:  "button",
        text:  "Set"
      },
      {
        id:  "btnChangeGuildCmd",
        kind:  "button",
        text:  "(cmd)"
      },
      {
        id:  "btnchangeGuild",
        kind:  "button",
        text:  "Set"
      },
      {
        id:  "txtGuild",
        kind:  "text",
        text:  "Guild"
      }
    ]
  },
  {
    id:  "hunt",
    title:  "Hunt",
    controls:  [
      {
        id:  "darkLabeldevNotes",
        kind:  "label",
        text:  "Reworked To The max"
      },
      {
        id:  "btnAddCmdHunt",
        kind:  "button",
        text:  "Add Command"
      },
      {
        id:  "chkIsTempF",
        kind:  "tick",
        text:  "is Temp"
      },
      {
        id:  "chkAddToWhitelistF",
        kind:  "tick",
        checked:  true,
        text:  "add to Whitelist"
      },
      {
        id:  "tbItemQtyF",
        kind:  "text",
        text:  "Quantity (* = any)"
      },
      {
        id:  "tbItemNameF",
        kind:  "text",
        text:  "Item name"
      },
      {
        id:  "tbMonNameF",
        kind:  "text",
        text:  "Monster (* = random)"
      },
      {
        id:  "cbBlankFirstF",
        kind:  "tick",
        checked:  true,
        text:  "Blank first before join"
      },
      {
        id:  "btnGetMapF",
        kind:  "button",
        text:  "Get"
      },
      {
        id:  "tbPadF",
        kind:  "text",
        text:  "Spawn"
      },
      {
        id:  "tbCellF",
        kind:  "text",
        text:  "Enter"
      },
      {
        id:  "tbMapF",
        kind:  "text",
        text:  "battleon-1e99"
      },
      {
        id:  "darkLabel2",
        kind:  "label",
        text:  "Short Hunting"
      }
    ]
  },
  {
    id:  "bots",
    title:  "Bots",
    controls:  [
      {
        id:  "treeBots",
        kind:  "tree"
      },
      {
        id:  "btnSetBotsDir",
        kind:  "button",
        text:  "Set"
      },
      {
        id:  "txtSavedDesc",
        kind:  "text",
        text:  "Description"
      },
      {
        id:  "lblBoosts",
        kind:  "label",
        text:  "Boosts:"
      },
      {
        id:  "lblDrops",
        kind:  "label",
        text:  "Drops:"
      },
      {
        id:  "lblQuests",
        kind:  "label",
        text:  "Quests:"
      },
      {
        id:  "lblSkills",
        kind:  "label",
        text:  "Skills:"
      },
      {
        id:  "lblCommands",
        kind:  "label",
        text:  "Number of\r\nCommands:"
      },
      {
        id:  "lblItems",
        kind:  "label",
        text:  "Items:"
      },
      {
        id:  "txtSavedAuthor",
        kind:  "text",
        text:  "Author"
      },
      {
        id:  "lblBots",
        kind:  "label",
        text:  "Number of Bots:"
      },
      {
        id:  "txtSavedAdd",
        kind:  "text"
      },
      {
        id:  "btnSavedAdd",
        kind:  "button",
        text:  "Add folder"
      },
      {
        id:  "txtSaved",
        kind:  "text"
      }
    ]
  },
  {
    id:  "info",
    title:  "Info",
    controls:  [
      {
        id:  "panel5",
        kind:  "panel",
        children:  [
          {
            id:  "richTextBox2",
            kind:  "rtf",
            editable: true,
            text:  "Test here"
          },
          {
            id:  "rtbInfo",
            kind:  "rtf",
            text:  "This is where information about a bot will be shown in RichTextFormat"
          }
        ]
      }
    ]
  }
];

const COLUMN = [
  {
    id:  "lstCommands",
    kind:  "list"
  },
  {
    id:  "lstDrops",
    kind:  "list"
  },
  {
    id:  "lstBoosts",
    kind:  "list"
  },
  {
    id:  "lstQuests",
    kind:  "list"
  },
  {
    id:  "lstSkills",
    kind:  "list"
  },
  {
    id:  "lstItems",
    kind:  "list"
  },
  {
    id:  "splitContainer1",
    kind:  "split",
    children:  [
      {
        id:  "splitContainer1.Panel1",
        kind:  "panel",
        children:  [
          {
            id:  "btnClear",
            kind:  "button",
            text:  "Clear"
          },
          {
            id:  "tableLayoutPanel1",
            kind:  "grid",
            children:  [
              {
                id:  "btnDown",
                kind:  "button",
                text:  "▼"
              },
              {
                id:  "btnUp",
                kind:  "button",
                text:  "▲"
              }
            ]
          },
          {
            id:  "cbLists",
            kind:  "select",
            options:  [
              "Commands",
              "Skills",
              "Quests",
              "Drops",
              "Boosts",
              "Items"
            ]
          },
          {
            id:  "chkAll",
            kind:  "tick",
            text:  "all"
          }
        ]
      },
      {
        id:  "splitContainer1.Panel2",
        kind:  "panel",
        children:  [
          {
            id:  "panel4",
            kind:  "panel",
            children:  [
              {
                id:  "tableLayoutPanel2",
                kind:  "grid",
                children:  [
                  {
                    id:  "txtSearchCmd",
                    kind:  "text",
                    text:  "Command Text"
                  },
                  {
                    id:  "btnSearchCmd",
                    kind:  "button",
                    text:  "Find"
                  }
                ]
              },
              {
                id:  "chkEnable",
                kind:  "tick",
                text:  "Enable Bot"
              },
              {
                id:  "btnRemove",
                kind:  "button",
                text:  "Remove"
              }
            ]
          }
        ]
      }
    ]
  }
];

module.exports = { TABS: TABS, COLUMN: COLUMN };
