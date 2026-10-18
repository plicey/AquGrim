// The narrow game interface the bot engine consumes (spec #19, Seam 4). One module, one shape:
// the engine talks to this and nothing else, and under test a plain object of the same shape
// satisfies it - which is what lets the whole loop be covered without Flash.
//
// THE INTERFACE. Every member returns a Promise. A read answers the value; a read that cannot be
// established *rejects* with the reason, so a caller can tell "no" from "cannot tell" - a
// distinction the reference never needs, because its own loader always answers.
//
//   signedIn()      -> boolean  a character is connected
//   alive()         -> boolean  that character is above 0 HP
//   username()      -> string   its name, for {PLAYERNAME}
//   ready()         -> boolean  the game can be driven (no reload in flight)
//   health()        -> number   current HP          healthMax() -> number
//   mana()          -> number   current MP          manaMax()   -> number
//   setSpawnPoint() -> void     stand at the respawn point, after a death
//   rest()          -> void     sit to restore HP/MP
//   exitCombat()    -> void     leave combat when the bot stops
//   state()         -> number   the game's own State: 0 dead, 1 idle, 2 in combat
//
// And the combat and map reads the commands of ticket #38 are built on. Each is one row of the
// loader surface, asked for by the reference's own name, for the same reason as the rest: the
// surface owns what that name means.
//
//   hasTarget() / targetHealth()          Is that monster still alive? (HasTarget, GetTargetHealth)
//   cancelTargets()                       Player.CancelTarget + CancelTargetSelf + CancelAutoAttack
//   cell() / pad() / map()                world.strFrame / strPad / strMapName
//   jump(cell, pad) / join(map,c,p)       the game's moveToCell / gotoTown
//   position()                            myAvatar.pMC.x, .y
//   skillAvailable(i) / allSkillsAvailable()   the loader's own cooldown arithmetic (ms left)
//   monsterAvailable(m) / monsterHealth(m)     the live monster reads (ticket #38)
//   monstersInCell(cell)                  the loader's own eight-field projection

// The five combat names that hand the game a live object - `AttackMonster`,
// `AttackMonsterByMonMapId`, `UseSkill`, `ForceUseSkill` and `CancelTargetSelf` - used to be
// refused here, on the finding that `world.setTarget(liveAvatar)` and `world.testAction(liveAction)`
// take an object the bridge cannot carry. Ticket #49 measured where that boundary actually is:
// `ExternalInterface`, not the game. The game's classes live in the bridge movie's own
// `ApplicationDomain`, so the movie resolves the object on its side and hands it to the game
// in-domain, and these calls are made like any other (see `attackMonster` and `useSkill` below).
//
// Ticket #41 widened it with the reads its statements need, each one a loader helper by its own
// name, so a statement never spells a path out:
//
//   cell() / map()                              -> string   where the character stands
//   gold() / level()                            -> number
//   isMember()                                  -> boolean  the upgrade days the loader tests
//   playerHealthPercentage(name)                -> number   another player, as the loader rounds it
//   inventory() / bank() / tempInventory()       -> list     the item lists the loader reshapes
//   house()                                     -> list
//   factions()                                  -> list     the reputation entries
//   playersInMap()                              -> list     the names the game lists
//   playerInCell(name, cell)                    -> boolean  CheckCellPlayer
//   playerInMyCell(name)                        -> boolean  GetCellPlayers
//   questAvailable(id) / questInProgress(id)     -> boolean
//   questCanComplete(id)                        -> boolean, refused until #39 lands
//   monsterInRoom(name) / monsterByMonMapId(id)  -> boolean, refused until #38 lands
//   monsterHealth(name)                         -> number,  refused until #38 lands
//   visibleMonsters()                           -> list,    refused until #38 lands
//   dropStack()                                 -> list, and it refuses: the reference's own list
//                                                   is filled from the game's dropItem frames
//                                                   (#33), not read out of the game
//
// Those three refusals are deliberate and are the surface's own: a name it does not implement
// rejects naming the ticket that owns it, and this module passes that reason through rather than
// answering a default. A statement that cannot be told reports it.
//
// The state-reading statements (tickets #41, #42) widened it; these are #42's own, and every one
// of them is a loader name the surface answers except the target id, which is named where it is
// read below:
//
//   hasTarget()                  -> boolean  this character has a live target (HasTarget)
//   targetHealth()               -> number   that target's HP (GetTargetHealth)
//   targetId()                   -> number|null  its MonMapID, or null when nothing is targeted
//   state()                      -> number   Player.State: 0 Dead, 1 Idle, 2 InCombat (State)
//   selfId()                     -> number   this character's id, which aura frames are keyed by
//   selfAura(name)               -> number   Player.GetAuras(true, name): the tapped stack
//                                             count, or the loader's GetAurasValue for a name
//                                             containing "locked" (which this bridge refuses)
//   targetAura(name)             -> number   the same for the current target
//   monsterAuraDuration(id, name)-> number   ms left of one aura on one monster, 0 for none
//   lastAnimationMessage()       -> string   the last anims[].msg the tap saw, lowercased
//   consumeAnimation()           -> void     clear it, which is what a matching statement does
//   close()                      -> void     give this window's tap subscription back
//
// The four aura reads are the tap's, not the game's: see bot/auras.js for where each number is
// derived from, and why the wire's seconds become milliseconds on the way in.
//
// A refusal that means *this window is gone* - rather than the game being busy or a path not
// resolving - carries `windowGone: true`. The engine ends that window's bot on it, and treats
// every other refusal as something to wait out; that is the difference between a closed window
// and a map that is still loading, and it is not a distinction a message can be parsed for.
//
// WHERE THE ANSWERS COME FROM. The reference reads this state through a loader it ships
// (`Loader/grimoire.swf`), which is a *renaming layer* over the stock game: each helper body is
// one or two reads and calls on `Root.Game...`, and the stock game does not carry those names.
// Ticket #48 read every one of those decompiled bodies and put the result in one table,
// `loader-surface.js` - one row per name, each row reaching the path or call that name's own body
// performs. So this module asks for the loader's own names through `bridge.loaderCall` rather
// than spelling the paths out again; a second copy of that table here would be free to drift from
// the first, and the first is the one with the decompiled source beside it.
//
// The names, and the row each one resolves to (loader-surface.js):
//
//   IsLoggedIn       sfc.isConnected          (Root.Game.sfc != null && sfc.isConnected)
//   Health/HealthMax world.myAvatar.dataLeaf.intHP / intHPMax   (IsAlive is Health > 0)
//   Mana/ManaMax     world.myAvatar.dataLeaf.intMP / intMPMax
//   SetSpawnPoint    world.setSpawnPoint(world.strFrame, world.strPad)
//   Rest             world.rest()
//   CancelTarget     world.cancelTarget(), twice, in the loader's own order
//   HasTarget        world.myAvatar.target.dataLeaf.intHP > 0
//   GetTargetHealth  world.myAvatar.target.dataLeaf.intHP
//   State            world.myAvatar.dataLeaf.intState
//   UserID           world.myAvatar.uid  - the id an aura frame's `p:` prefix is compared with
//   Cell/Map         world.strFrame / world.strMapName
//   Gold/Level       world.myAvatar.objData.intGold / dataLeaf.intLevel
//   IsMember         world.myAvatar.objData.iUpgDays >= 0
//   GetInventoryItems / GetBankItems / GetTempItems / GetHouseItems
//                    world.myAvatar.items / world.bankinfo.items / world.myAvatar.tempitems /
//                    world.myAvatar.houseitems
//   GetFactions      world.myAvatar.factions
//   PlayersInMap     world.areaUsers
//   CheckCellPlayer  the player's own strFrame against the cell asked for
//   GetCellPlayers   the same against world.strFrame
//   GetPlayerHealthPercentage  the player's intHP / intHPMax, as the loader's own percentage
//   IsAvailable / IsInProgress / CanComplete  world.questTree[id] / world.isQuestInProgress /
//                    world.canTurnInQuest (the last two refused: #38 and #39 own the rest)
//
// TWO WANTS THE SURFACE DOES NOT ANSWER, and both for a real reason rather than an oversight, so
// neither is worked around by inventing a path here:
//
//   MapLoadComplete  the loader's body reads `world.mapLoadInProgress` *and then* inspects its own
//                    display list ("the top child is not the connection movie"), which is state
//                    ticket #41 owns. This module's `ready()` therefore reads the game's own
//                    `world.mapLoadInProgress` - the half a reload trips, and the half the engine's
//                    pause keys off - and says plainly that the display-list half is not checked.
//   GetUsername      the reference loader holds the login it captured from its own login form
//                    (Root.Username), not something it reads out of the game; ticket #35 owns it.
//                    This module reads the game's own `world.myAvatar.objData.strUsername` instead,
//                    which is the same name the loader itself assigns to that field (Player.as
//                    line 455), so `{PLAYERNAME}` still resolves to the character's name.

const PATHS = {
    // The two reads above, and nothing else: everything the surface answers goes through it.
    name: 'world.myAvatar.objData.strUsername',
    mapLoading: 'world.mapLoadInProgress',
    // Player.CurrentTargetId's own body exactly: Flash.GetGameObject(
    // "world.myAvatar.target.objData.MonMapID"). The loader registers no name for it, so unlike
    // every other read here there is nothing to ask by name - which is why it is written out, and
    // why it is written out once, here.
    targetId: 'world.myAvatar.target.objData.MonMapID'
};

// The loader's own translations, for the log and for tests: each name the reference calls, what
// this module asks for, and where the answer comes from.
const LOADER_BODIES = {
    IsLoggedIn: { helper: 'IsLoggedIn', body: 'Root.Game.sfc != null && Root.Game.sfc.isConnected == true' },
    Health: { helper: 'Health', body: 'myAvatar.dataLeaf.intHP' },
    HealthMax: { helper: 'HealthMax', body: 'myAvatar.dataLeaf.intHPMax' },
    Mana: { helper: 'Mana', body: 'myAvatar.dataLeaf.intMP' },
    ManaMax: { helper: 'ManaMax', body: 'myAvatar.dataLeaf.intMPMax' },
    SetSpawnPoint: { helper: 'SetSpawnPoint', body: 'world.setSpawnPoint(world.strFrame, world.strPad)' },
    Rest: { helper: 'Rest', body: 'world.rest()' },
    Logout: { helper: 'Logout', body: 'Root.Game.logout()' },
    CancelTarget: { helper: 'CancelTarget', body: 'world.cancelTarget() twice' },
    CancelAutoAttack: { helper: 'CancelAutoAttack', body: 'world.cancelAutoAttack()' },
    Cell: { helper: 'Cell', body: 'world.strFrame' },
    Map: { helper: 'Map', body: 'world.strMapName' },
    Gold: { helper: 'Gold', body: 'world.myAvatar.objData.intGold' },
    Level: { helper: 'Level', body: 'world.myAvatar.dataLeaf.intLevel' },
    IsMember: { helper: 'IsMember', body: 'world.myAvatar.objData.iUpgDays >= 0' },
    GetInventoryItems: { helper: 'GetInventoryItems', body: 'JSON.stringify(world.myAvatar.items)' },
    GetBankItems: { helper: 'GetBankItems', body: 'JSON.stringify(world.bankinfo.items)' },
    GetTempItems: { helper: 'GetTempItems', body: 'JSON.stringify(world.myAvatar.tempitems)' },
    GetHouseItems: { helper: 'GetHouseItems', body: 'JSON.stringify(world.myAvatar.houseitems)' },
    GetFactions: { helper: 'GetFactions', body: 'JSON.stringify(world.myAvatar.factions)' },
    PlayersInMap: { helper: 'PlayersInMap', body: 'JSON.stringify(world.areaUsers)' },
    CheckCellPlayer: {
        helper: 'CheckCellPlayer',
        body: 'world.uoTree[name].strFrame against the cell asked for; the loader sortAnswers True/False'
    },
    GetCellPlayers: {
        helper: 'GetCellPlayers',
        body: 'the same player own strFrame against world.strFrame'
    },
    GetPlayerHealthPercentage: {
        helper: 'GetPlayerHealthPercentage',
        body: 'the player own intHP / intHPMax * 100, and 100 for a name it does not hold'
    },
    IsAvailable: { helper: 'IsAvailable', body: 'world.questTree[id] != null, all the loader can know' },
    IsInProgress: { helper: 'IsInProgress', body: 'world.isQuestInProgress(parseInt(id))' },
    CanComplete: { helper: 'CanComplete', body: 'world.canTurnInQuest(id) (refused: ticket #39 owns quests)' },
    IsMonsterAvailable: {
        helper: 'IsMonsterAvailable',
        body: 'GetMonsterByName(name) != null (pMC present, name contains, intState > 0, same cell)'
    },
    IsMonsterAvailableByMonMapID: {
        helper: 'IsMonsterAvailableByMonMapID',
        body: 'GetMonsterByMonMapId(id) != null, the same walk matched on dataLeaf.MonMapID'
    },
    GetMonsterHealth: { helper: 'GetMonsterHealth', body: 'GetMonsterByName(name).dataLeaf.intHP' },
    GetVisibleMonstersInCell: {
        helper: 'GetVisibleMonstersInCell',
        body: 'a reshape of live monster objects, done leaf by leaf on this side (#38)'
    },
    State: { helper: 'State', body: 'world.myAvatar.dataLeaf.intState' },
    Pad: { helper: 'Pad', body: 'world.strPad' },
    Position: { helper: 'Position', body: 'JSON of [myAvatar.pMC.x, myAvatar.pMC.y]' },
    HasTarget: {
        helper: 'HasTarget',
        body: 'world.myAvatar.target != null && world.myAvatar.target.dataLeaf.intHP > 0'
    },
    GetTargetHealth: { helper: 'GetTargetHealth', body: 'world.myAvatar.target.dataLeaf.intHP' },
    SkillAvailable: {
        helper: 'SkillAvailable',
        body: 'IsSkillReady(world.actions.active[i]): max(GCD - (now - GCDTS), round(cd * haste) - (now - ts))'
    },
    AllSkillsAvailable: {
        helper: 'AllSkillsAvailable',
        body: 'max of IsSkillReady over world.actions.active[1..4]'
    },
    GetCells: { helper: 'GetCells', body: 'world.map.currentScene.labels[].name' },
    IsActionAvailable: {
        helper: 'IsActionAvailable',
        body: 'world.lock[action].cd elapsed since .ts (Rest is "rest", Transfer is "tfer")'
    },
    Class: { helper: 'Class', body: 'world.myAvatar.objData.strClassName, upper-cased' },
    ReloadMap: { helper: 'ReloadMap', body: 'world.reloadCurrentMap()' },
    LoadMap: { helper: 'LoadMap', body: 'world.loadMap(mapSwf)' },
    Jump: { helper: 'Jump', body: 'world.moveToCell(cell, pad)' },
    Join: { helper: 'Join', body: 'world.gotoTown(map, cell, pad)' },
    WalkToPoint: {
        helper: 'WalkToPoint',
        body: 'myAvatar.pMC.walkTo(x, y, WALKSPEED) then world.moveRequest({mc: pMC, tx, ty, sp})',
        why: 'the loader drives the avatar\'s own MovieClip first, and a live clip cannot cross '
    },
    GetMonstersInCell: {
        helper: 'GetMonstersInCell',
        body: 'world.getMonstersByCell(cell), each projected to sRace/strMonName/MonID/MonMapID/iLvl/intState/intHP/intHPMax'
    },
    AttackMonster: {
        helper: 'AttackMonster',
        body: 'world.setTarget(GetMonsterByName(name)) + world.approachTarget()'
    },
    AttackMonsterByMonMapId: {
        helper: 'AttackMonsterByMonMapId',
        body: 'world.setTarget(GetMonsterByMonMapId(id)) + world.approachTarget()'
    },
    UseSkill: {
        helper: 'UseSkill',
        body: 'world.approachTarget() then ForceUseSkill(index)'
    },
    ForceUseSkill: {
        helper: 'ForceUseSkill',
        body: 'IsSkillReady(action) == 0 && action.isOK && !action.skillLock -> world.testAction(action)'
    },
    CancelTargetSelf: {
        helper: 'CancelTargetSelf',
        body: 'if(myAvatar.target == myAvatar) world.cancelTarget()'
    },
    // #42's own two: the id an aura frame's `p:` prefix is compared with, and the aura state
    // itself, which is not a loader call at all - the reference's cache is filled by its packet
    // handlers (Flash.cs ProcessPacketFromServer, ProcessPext, ProcessPacketFromClient), so this
    // build derives it from the packet tap. Recorded so a reader can check that derivation against
    // the reference rather than trusting it.
    UserID: { helper: 'UserID', body: 'world.myAvatar.uid - the id an aura frame is keyed by' },
    AuraCache: {
        helper: 'GetAurasValue / AuraDuration',
        body: 'AuraManager.SelfAura and AuraManager.EnemyAura(MonMapID), filled from the frames ' +
            'Flash.cs ProcessPacketFromServer and ProcessPext read; the target id itself is ' +
            'Player.CurrentTargetId -> world.myAvatar.target.objData.MonMapID',
        reason: 'this cache is not a loader call at all: the reference fills it from its packet ' +
            'handlers, so this build derives it from the packet tap (bot/auras.js). The two lookup ' +
            'names beside it, GetAurasValue and AuraDuration, are refused by the surface for the ' +
            'same reason (#42)'
    },
    // Not on the surface: see the two named above.
    GetUsername: { path: PATHS.name, body: 'the game own objData.strUsername; the loader holds its own copy (ticket #35)' },
    MapLoadComplete: { path: PATHS.mapLoading, body: 'world.mapLoadInProgress == false; the display-list half is ticket #41' },
    DropStack: {
        body: 'the reference loader keeps this list itself, fed by the game own dropItem frames ' +
            '(Flash.cs HandlerDropItem); no game path answers it',
        reason: 'the reference keeps this list itself, filled from the game own dropItem frames ' +
            '(HandlerDropItem / Flash.cs), so no game path answers it, and this client own list is ' +
            'the drop window own (ticket #33): it is fed by the packet tap only while that window ' +
            'is watching, which a bot session cannot reach'
    }
};

const ERRORS = {
    noChannel: 'this app has no game bridge channel'
};

// The platform's bridge channel says this when the window it was attached to is gone
// (res/platform/bridge-channel.js). It is the one refusal a bot must not wait out.
const WINDOW_GONE = /no game window|the game window went away/i;

function message(error) {
    return (error && error.message) || String(error);
}

/** A refusal, marked when it means the window itself is gone rather than the game being busy. */
function refusal(text) {
    const error = new Error(text);
    if (WINDOW_GONE.test(text)) error.windowGone = true;
    return error;
}

/** The bridge answers a JSON string, and its own error object for a path that did not resolve. */
function decode(value) {
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
}

/**
 * The session over the platform's bridge channel (`host.bridge.attach()` / `call`, #28).
 *
 * @param {object} deps
 * @param {object} deps.bridge host.bridge, or a stand-in with the same two methods
 * @param {(msg: string) => void} [deps.log]
 */
function createSession(deps) {
    deps = deps || {};
    const bridge = deps.bridge;
    const log = deps.log || function () {};

    // The tapped aura state (bot/auras.js). Subscribed once, when this session is made, so a frame
    // that arrives between two calls is not missed: the reference's cache is filled the same way,
    // by a handler registered for the session's whole life rather than around each read.
    const auras = require('./auras.js').createAuraStore();
    let tapFailure = null;
    let release = null;
    if (deps.packets && typeof deps.packets.on === 'function') {
        try {
            release = deps.packets.on('frame', function (frame) { auras.observe(frame); });
        } catch (error) {
            // A plugin without packet-tap, or an app session that is not steering traffic: the
            // reason is kept and handed to whoever asks for an aura, rather than swallowed - a
            // zero here would be indistinguishable from "the aura is gone".
            tapFailure = message(error);
        }
    } else {
        tapFailure = 'this session has no packet tap, so no aura state is being observed';
    }

    /** The tap, or a refusal naming what is missing. */
    function tapped() {
        if (tapFailure) throw refusal('auras come from the packet tap: ' + tapFailure);
        return auras;
    }

    async function attach() {
        if (!bridge) throw refusal(ERRORS.noChannel);
        const attached = await bridge.attach();
        if (!attached || attached.ok !== true) {
            throw refusal((attached && attached.error) || 'the game bridge did not attach');
        }
    }

    /** Read one dot-path of this module's own (the two the surface does not answer). */
    async function readPath(path) {
        await attach();
        const answer = await bridge.call('getGameObject', [path]);
        if (!answer || answer.ok !== true) {
            throw refusal((answer && answer.error) || ('the bridge did not answer ' + path));
        }
        const value = decode(answer.value);
        if (value && typeof value === 'object' && typeof value.error === 'string') {
            throw refusal(value.error);
        }
        return value;
    }

    /**
     * Ask the loader surface for one of the reference's own helper names. The surface owns the
     * loader body for that name (loader-surface.js, ticket #48), so nothing here re-derives a path
     * from it. A refusal - a name the surface does not implement, or the game refusing the read -
     * rejects with the reason, marked when it means the window is gone.
     */
    async function loaderCall(name, args) {
        // Attach first, for the same reason the raw reads do: the surface answers over the same
        // channel, and a channel that is not attached has no game window to ask.
        await attach();
        if (typeof bridge.loaderCall !== 'function') {
            throw refusal('this bridge does not expose the loader surface (ticket #48): ' + name);
        }
        try {
            return await bridge.loaderCall(name, args || []);
        } catch (error) {
            throw refusal(message(error));
        }
    }

    /**
     * A number a helper answered. A helper that answered nothing - null, undefined or an empty
     * string, which is what a walk over an avatar that is not in the world yields - is a refusal,
     * not a zero: reading it as 0 HP would look exactly like a death and send the bot down its
     * respawn branch over a reload.
     */
    function numberFrom(name, promise) {
        return promise.then(function (value) {
            if (value === null || value === undefined || value === '') {
                throw refusal(name + ' answered nothing, so the game has no number there yet');
            }
            const number = Number(value);
            if (!isFinite(number)) {
                throw refusal(name + ' is not a number the game answered (' +
                    JSON.stringify(value) + ')');
            }
            return number;
        });
    }

    /**
     * A yes or a no a helper answered. Anything else - a value the game left unset, a string it
     * did not mean as a boolean, a shape this bridge cannot read - is a refusal rather than a no:
     * a condition that cannot be evaluated must report that, not silently fail a bot's branch.
     */
    function booleanFrom(name, promise) {
        return promise.then(function (value) {
            if (value === true || value === 1 || value === '1' || value === 'true' || value === 'True') return true;
            if (value === false || value === 0 || value === '0' || value === 'false' || value === 'False') return false;
            throw refusal(name + ' is not a yes or a no (' + JSON.stringify(value) + ')');
        });
    }

    /**
     * The loader quotes the strings it answers ("yulgar") because its C# side parses them; this
     * bridge's surface returns the value, so a string that arrived quoted is unquoted here. A
     * value the game left unset is a refusal, for the same reason a number is: an empty cell is
     * indistinguishable from standing nowhere.
     */
    function textFrom(name, promise) {
        return promise.then(function (value) {
            if (value === null || value === undefined || value === '') {
                throw refusal(name + ' answered nothing, so the game has no value there yet');
            }
            if (typeof value === 'string') return value.replace(/^"|"$/g, '');
            if (value && typeof value === 'object') {
                throw refusal(name + ' is not a value this bridge can read (' +
                    JSON.stringify(value).slice(0, 120) + ')');
            }
            return String(value);
        });
    }

    /**
     * A list a helper answered. The game keys these several ways - the bank and the quest tree by
     * id, the avatar's own items by index - and the surface hands each over as it stands, so a
     * caller gets the entries and not the keying. An answer that is not a list at all is a
     * refusal: an unreadable list must not look like an empty one, or every item statement built
     * on it would answer a confident no.
     */
    function listFrom(name, promise) {
        return promise.then(function (value) {
            if (Array.isArray(value)) return value;
            if (value === null || value === undefined || value === '') {
                throw refusal(name + ' answered nothing, so the game has no list there yet');
            }
            if (typeof value === 'object') {
                return Object.keys(value).map(function (key) { return value[key]; })
                    .filter(function (entry) { return entry !== null && entry !== undefined; });
            }
            throw refusal(name + ' is not a list the game answered (' +
                JSON.stringify(value).slice(0, 120) + ')');
        });
    }

    /** The reference's own helper name for a quest id: its C# side passes the id as text. */
    function questId(id) {
        const text = String(id === null || id === undefined ? '' : id).trim();
        if (!/^-?\d+$/.test(text)) {
            throw refusal('"' + id + '" is not a quest id: the reference parses the field as an int');
        }
        return text;
    }

    const session = {
        /** Player.IsLoggedIn's own body: a live socket. A missing socket is a no, not an error. */
        signedIn: function () {
            return loaderCall('IsLoggedIn').then(function (value) {
                // The loader writes the game's own booleans as true/false; anything the game
                // answers that is not a live connection is a no, and a path that did not resolve
                // is a no too (walk answers null for a missing socket).
                return value === true || value === 1 || value === 'true';
            }, function (error) {
                if (error && error.windowGone === true) throw error;
                throw error;
            });
        },

        /** IsAlive is Health > 0, and Health is myAvatar.dataLeaf.intHP. */
        alive: function () {
            return numberFrom('Health', loaderCall('Health')).then(function (hp) { return hp > 0; });
        },

        username: function () {
            return readPath(PATHS.name).then(function (value) {
                return value === null || value === undefined ? '' : String(value);
            }, function (error) {
                // {PLAYERNAME} is a convenience inside a bot's own text: an unreadable name leaves
                // it empty and says so, rather than failing a run over it.
                log('the character name could not be read: ' + message(error));
                return '';
            });
        },

        /**
         * MapLoadComplete's first half, which is the half a reload trips. Its second half - "the
         * top child is not the connection movie" - reads the loader's own display list, which is
         * ticket #41's, so this answers on the part it can honestly answer on.
         */
        ready: function () {
            return readPath(PATHS.mapLoading).then(function (value) {
                // A missing flag means the map is not loading; anything else is the flag's value,
                // and the game writes it as a Boolean.
                return value !== true && value !== 1 && value !== 'true';
            }, function (error) {
                if (/no member /.test(message(error))) return true;
                throw error;
            });
        },

        health: function () { return numberFrom('Health', loaderCall('Health')); },
        healthMax: function () { return numberFrom('HealthMax', loaderCall('HealthMax')); },
        mana: function () { return numberFrom('Mana', loaderCall('Mana')); },
        manaMax: function () { return numberFrom('ManaMax', loaderCall('ManaMax')); },

        // ---------------------------------------------------------------- the state the
        // statements read (#41). One row of the loader surface each, asked for by the name the
        // reference calls, and answered as the value it means rather than as the loader's own
        // hand-quoted string.

        /** Player.Cell / Player.Map: where the character stands. */
        cell: function () { return textFrom('Cell', loaderCall('Cell')); },
        map: function () { return textFrom('Map', loaderCall('Map')); },

        gold: function () { return numberFrom('Gold', loaderCall('Gold')); },
        level: function () { return numberFrom('Level', loaderCall('Level')); },

        /** Player.IsMember is the loader's own upgrade-days test, so it is the surface's answer. */
        isMember: function () { return booleanFrom('IsMember', loaderCall('IsMember')); },

        /**
         * World.GetPlayerHealthPercentage(name) for another player. The loader answers 100 for a
         * name it does not hold, which is the reference's own answer and not a stand-in: CmdPlayers
         * HPGreaterThan compares it directly.
         */
        playerHealthPercentage: function (name) {
            return numberFrom('GetPlayerHealthPercentage',
                loaderCall('GetPlayerHealthPercentage', [String(name)]));
        },

        // The item lists the loader reshapes. Each is asked for by its own helper name, and the
        // surface reaches the path that helper's body reads.
        inventory: function () { return listFrom('GetInventoryItems', loaderCall('GetInventoryItems')); },
        bank: function () { return listFrom('GetBankItems', loaderCall('GetBankItems')); },
        tempInventory: function () { return listFrom('GetTempItems', loaderCall('GetTempItems')); },
        house: function () { return listFrom('GetHouseItems', loaderCall('GetHouseItems')); },
        factions: function () { return listFrom('GetFactions', loaderCall('GetFactions')); },

        /** The names the game lists for the map (World.PlayersInMap is world.areaUsers). */
        playersInMap: function () { return listFrom('PlayersInMap', loaderCall('PlayersInMap')); },

        /** World.CheckCellPlayer(name, cell): is that player standing in that cell. */
        playerInCell: function (name, cell) {
            return booleanFrom('CheckCellPlayer',
                loaderCall('CheckCellPlayer', [String(name), String(cell)]));
        },

        /** World.GetCellPlayers(name): is that player standing in the cell I am in. */
        playerInMyCell: function (name) {
            return booleanFrom('GetCellPlayers', loaderCall('GetCellPlayers', [String(name)]));
        },

        questAvailable: function (id) {
            return booleanFrom('IsAvailable', loaderCall('IsAvailable', [questId(id)]));
        },
        questInProgress: function (id) {
            return booleanFrom('IsInProgress', loaderCall('IsInProgress', [questId(id)]));
        },
        // Refused until #39 lands: the surface's row names the ticket. Asked for by name anyway, so
        // the day it lands the statement works with no change here.
        questCanComplete: function (id) {
            return booleanFrom('CanComplete', loaderCall('CanComplete', [questId(id)]));
        },

        // Refused until #38 lands, for the same reason and with the same effect.
        monsterInRoom: function (name) {
            return booleanFrom('IsMonsterAvailable', loaderCall('IsMonsterAvailable', [String(name)]));
        },
        monsterByMonMapId: function (id) {
            return booleanFrom('IsMonsterAvailableByMonMapID',
                loaderCall('IsMonsterAvailableByMonMapID', [String(id)]));
        },
        monsterHealth: function (name) {
            return numberFrom('GetMonsterHealth', loaderCall('GetMonsterHealth', [String(name)]));
        },
        visibleMonsters: function () {
            return listFrom('GetVisibleMonstersInCell', loaderCall('GetVisibleMonstersInCell'));
        },

        /**
         * The dropped items. The reference's own DropStack, filled from the game's dropItem frames
         * (HandlerDropItem / Flash.cs), so there is no game path to read it from and the surface
         * has no row for it. This client's own list is the drop window's (#33), fed by the packet
         * tap only while that window watches, so it is not a read this session can make: the
         * refusal says where the list lives rather than letting a "has dropped" statement answer a
         * confident no.
         */
        dropStack: function () {
            return Promise.reject(refusal(LOADER_BODIES.DropStack.reason));
        },

        // ---- combat and map (ticket #38) ----------------------------------------------------

        /** Player.CurrentState: the game's own intState, so 0 dead, 1 idle, 2 in combat. */
        state: function () { return numberFrom('State', loaderCall('State')); },

        /**
         * Whether there is a living target. Health above zero is the second half of the loader's
         * own HasTarget, so a target that has died is a no - which is what a kill loop waits on.
         * An unreadable target is that same no rather than a refusal: HasTarget is a question with
         * a false answer, where Health's silence is a death (see numberFrom above).
         */
        hasTarget: function () {
            return loaderCall('HasTarget').then(function (value) {
                return value === true || value === 1 || value === 'true';
            }, function (error) {
                if (error && error.windowGone === true) throw error;
                return false;
            });
        },

        targetHealth: function () { return numberFrom('GetTargetHealth', loaderCall('GetTargetHealth')); },

        /**
         * CmdCancelTarget's own three calls, in its own order: CancelTarget (which the loader's
         * body runs twice), then CancelTargetSelf, then CancelAutoAttack. The middle one is made by
         * the movie (ticket #49), which compares the two live avatar objects there; the reference's
         * own body makes it a no-op unless the avatar is targeting itself, so a failure still only
         * costs the self-target check and the two that matter run.
         */
        cancelTargets: async function () {
            await loaderCall('CancelTarget');
            try {
                await loaderCall('CancelTargetSelf');
            } catch (error) {
                log('cmd cancel target: the self-target check is not available (' + message(error) + ')');
            }
            return loaderCall('CancelAutoAttack');
        },

        /** Milliseconds until this skill can be used, the loader's own arithmetic. */
        skillAvailable: function (index) {
            return loaderCall('SkillAvailable', [String(index)]).then(function (value) {
                const number = Number(value);
                return isFinite(number) ? number : 0;
            }, function (error) {
                if (error && error.windowGone === true) throw error;
                // A skill row that cannot be read is nothing to wait for, which is how the
                // reference treats an action it cannot measure (its IsSkillReady walks an object
                // that may be absent). The wait is on the server's own answer either way.
                log('skill ' + index + ' could not be measured (' + message(error) + ')');
                return 0;
            });
        },

        allSkillsAvailable: function () {
            return numberFrom('AllSkillsAvailable', loaderCall('AllSkillsAvailable'));
        },

        monsterAvailable: function (name) {
            return loaderCall('IsMonsterAvailable', [String(name)]);
        },

        monsterAvailableByMonMapId: function (id) {
            return loaderCall('IsMonsterAvailableByMonMapID', [String(id)]);
        },

        monstersInCell: function (cell) {
            return loaderCall('GetMonstersInCell', [String(cell === undefined ? '' : cell)]);
        },

        /**
         * Point the avatar at a monster. The name is what the loader's own signature takes; the
         * movie resolves the live Avatar it names and hands it to world.setTarget (ticket #49).
         */
        attackMonster: function (name) { return loaderCall('AttackMonster', [String(name)]); },
        attackMonsterByMonMapId: function (id) { return loaderCall('AttackMonsterByMonMapId', [String(id)]); },
        useSkill: function (index) { return loaderCall('UseSkill', [String(index)]); },
        forceUseSkill: function (index) { return loaderCall('ForceUseSkill', [String(index)]); },

        /** Where the avatar stands, as the loader's own Position (a two-number array). */
        position: function () { return loaderCall('Position'); },

        // Cell and Map are the state reads above (#41), which strip the loader's own quotes and
        // refuse an empty answer; only Pad belongs to this block.
        pad: function () { return loaderCall('Pad'); },

        /** Player.MoveToCell, and the Join / GoTo pair the map commands are built on. */
        jump: function (cell, pad) {
            return loaderCall('Jump', pad === undefined ? [String(cell)] : [String(cell), String(pad)]);
        },
        /**
         * Player.WalkToPoint. The loader's body drives the avatar's own MovieClip before it asks
         * the world to move. Unlike the six combat names (ticket #49), the movie registers no
         * callback for this one, so it is refused by the surface - the caller reports what it did
         * rather than assuming it moved.
         */
        walkToPoint: function (x, y) { return loaderCall('WalkToPoint', [String(x), String(y)]); },
        join: function (map, cell, pad) {
            return loaderCall('Join', [String(map), String(cell === undefined ? 'Enter' : cell),
                String(pad === undefined ? 'Spawn' : pad)]);
        },
        setSpawnPointHere: function () { return loaderCall('SetSpawnPoint'); },
        reloadMap: function () { return loaderCall('ReloadMap'); },
        loadMap: function (swf) { return loaderCall('LoadMap', [String(swf)]); },

        /** World.IsActionAvailable: whether a locked action ("rest", "tfer") has come back. */
        actionAvailable: function (name) { return loaderCall('IsActionAvailable', [String(name)]); },

        /** The map's own cell names, which the jump commands walk. */
        cells: function () { return loaderCall('GetCells'); },

        /** The two containers the hunt commands count their items out of. */
        items: function () { return loaderCall('GetInventoryItems'); },
        tempItems: function () { return loaderCall('GetTempItems'); },

        /** Player.GoToPlayer: the loader's own world.goto(name), which walks in this map. */
        goTo: function (name) { return loaderCall('GoTo', [String(name)]); },

        /** The equipped class name, which decides how a skill is cast (Chrono Shadow). */
        className: function () {
            return loaderCall('Class').then(function (value) {
                return value === null || value === undefined ? '' : String(value);
            });
        },

        cancelAutoAttack: function () { return loaderCall('CancelAutoAttack'); },

        // Each of these is one row of the loader surface, asked for by the reference's own name.
        setSpawnPoint: function () { return loaderCall('SetSpawnPoint'); },
        rest: function () { return loaderCall('Rest'); },
        exitCombat: function () { return loaderCall('CancelTarget'); },

        /**
         * Player.CurrentTargetId, and the one read the loader registers no name for, so it is
         * this module's own path (PATHS.targetId, Player.cs line 240 exactly).
         *
         * Nothing targeted answers null rather than 0: a walk over an absent target gives null,
         * and 0 is a MonMapID a monster could have, so reading it as a number would key the aura
         * cache on a monster that is not there. A value that is not a number is a refusal.
         */
        targetId: function () {
            return readPath(PATHS.targetId).then(function (value) {
                if (value === null || value === undefined) return null;
                const number = Number(value);
                if (!isFinite(number)) {
                    throw refusal('CurrentTargetId is not a number the game answered (' +
                        JSON.stringify(value) + ')');
                }
                return number;
            });
        },

        /**
         * The loader's UserID: the id an aura frame's `p:` prefix is compared with, and the one
         * piece of the aura cache's own key that is not on the wire. Read here and handed to the
         * cache, so a `p:` frame for anybody else is dropped rather than kept under a key nothing
         * will ever look up.
         */
        selfId: async function () {
            const id = await numberFrom('UserID', loaderCall('UserID'));
            // A session with no tap has no cache to key, and that gap is the aura reads' refusal
            // to make rather than this one's: the id itself was read all the same.
            if (!tapFailure) auras.setSelf('p:' + id);
            return id;
        },

        /**
         * Player.GetAuras(true, name), which is two sources and not one: the tapped cache for a
         * name that does not contain "locked" (auras.js), and the loader's own GetAurasValue for
         * one that does - the reference's exact test, `isSelf && !auraName.ContainsIgnoreCase(
         * "locked")`. That lookup is a name this bridge refuses, so a locked condition is a
         * refusal rather than a cache answer the reference would never have consulted. A tap that
         * is not there is a refusal naming what is missing, never a zero - zero is what "the stack
         * is gone" reads as.
         */
        selfAura: async function (name) {
            const wanted = name === undefined || name === null ? '' : String(name);
            if (wanted.toLowerCase().indexOf('locked') !== -1) {
                // The C# argument is `isSelf.ToString()`, which the loader's own body reads back
                // as the string "True"; the name is handed on as written, spaces and all.
                return loaderCall('GetAurasValue', ['True', wanted]);
            }
            const store = tapped();
            const id = await session.selfId();
            return store.value('p:' + id, wanted);
        },

        /**
         * Player.GetAuras(false, name) - the target's stacks, from the same cache, keyed by the
         * target's own MonMapID. With nothing targeted the answer is 0, which is exactly what the
         * reference's GetAurasValue returns in that case rather than an error.
         */
        targetAura: async function (name) {
            const store = tapped();
            if (!(await session.hasTarget())) return 0;
            const id = await session.targetId();
            if (id === null || id === undefined) return 0;
            return store.value('m:' + id, name);
        },

        /**
         * AuraManager.EnemyAura(id).GetRemainingTime(name), in milliseconds-removed: the monster's
         * own id is the statement's targetId field, so it is handed in rather than read here.
         */
        monsterAuraDuration: async function (id, name) {
            return tapped().remaining('m:' + id, name);
        },

        /** Configuration.LastAnimationMessage, which the tap's anims handler fills (auras.js). */
        lastAnimationMessage: async function () { return tapped().lastAnimationMessage(); },
        consumeAnimation: async function () { tapped().consumeAnimation(); },

        /**
         * Give this window's tap subscription back. The bot is per window and its subscription
         * outlives every call on it, so the window's own close is where it is released - a
         * subscription that is never released is the leak the platform's release return exists
         * to prevent.
         */
        close: async function () {
            if (typeof release === 'function') {
                const off = release;
                release = null;
                off();
            }
        },

        /** The loader's bodies, exposed so the window and the tests can name their source. */
        bodies: function () { return LOADER_BODIES; }
    };

    return session;
}

module.exports = {
    createSession: createSession,
    PATHS: PATHS,
    LOADER_BODIES: LOADER_BODIES,
    ERRORS: ERRORS
};
