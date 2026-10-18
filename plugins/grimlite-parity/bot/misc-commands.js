// The miscellaneous command handlers (#40): everything under Grimoire/Botting/Commands/Misc/ that
// ticket #37 did not already own. The engine keeps the loop, the index and the flow commands; this
// module is the rest of that namespace, one function per reference class.
//
// Three kinds of command live here, and they are kept apart on purpose:
//
//   * games-free work - beeps, ping, the log pane, the spammer window own controls. Nothing here
//     touches the session, which is what the ticket means by commands that work with no game
//     connection; the tests count session calls to keep it that way.
//   * calls into the game, every one of them by the reference loader own helper name through the
//     session (loader-surface.js, #48). The module never spells a game path out, and the names it
//     asks for are listed once in bot/misc.js and asserted against the surface.
//   * the commands this build cannot carry out - the stage frame rate SetFPS sets, and the Maid
//     handler CmdSpecialHandler drives - which report why and whose ticket owns them rather than
//     pretending to work.
//
// Where the reference holds a call with no counterpart at all (Console.Beep is the shell own
// sound), the dependency is injected and the plugin shell provides it.

const misc = require("./misc.js");
// Read, never copied: the reason a helper this build asks for cannot be called belongs to the
// surface row that owns it (#48), so it is quoted from there rather than restated here.
const loaderSurface = require("../loader-surface.js");

// The wait between two frames of a background spammer when the command carries no Delay of its
// own; the reference own property initialiser is 500.
const BACKGROUND_DEFAULT_DELAY = 500;

function number(value, fallback) {
    const parsed = Number(value);
    return isFinite(parsed) ? parsed : fallback;
}

function message(error) {
    return (error && error.message) || String(error);
}

/**
 * A refusal that names the ticket behind it. The sentence itself is the surface's (misc.js's
 * refusalText, which adds the row's own reason only when a refusal does not already carry it), so
 * no wording about why a helper cannot be called is written twice.
 */
function withReason(name, said) {
    return misc.refusalText(said, loaderSurface.SURFACE[name], name);
}

/**
 * The handler table for one engine. Everything it needs is injected, so the table is testable and
 * the engine keeps owning its loop and its state.
 *
 * @param {object} deps
 * @param {object} deps.session the engine own game session (spec #19, Seam 4)
 * @param {(frame: object) => boolean} [deps.sendPacket] host.packets.send
 * @param {(count: number) => void} [deps.beep] the shell own alert sound
 * @param {(name: string, args: Array) => Promise<any>} [deps.loaderCall] one loader name
 * @param {object} [deps.file] the bot-file door: { resolve, read, parse }
 * @param {object} [deps.spammer] the spammer window own controls
 * @param {object} [deps.timers] setTimeout and clearTimeout
 * @param {(ms: number) => Promise<void>} deps.sleep
 * @param {(line: string) => void} deps.log
 * @param {(line: string) => void} [deps.logDebug] the Debug pane CmdLog writes to
 * @param {() => void} [deps.logClear] the CLEAR marker own action on that pane
 */
function createHandlers(deps) {
    const session = deps.session;
    const log = deps.log || function () {};
    const logDebug = deps.logDebug || log;
    const logClear = deps.logClear || function () { log("[CLEAR]"); };
    const sleep = deps.sleep;
    const sendPacket = deps.sendPacket;
    const beep = deps.beep;
    const spammer = deps.spammer || null;
    const timers = deps.timers || { setTimeout: setTimeout, clearTimeout: clearTimeout };
    const background = { labels: [], timer: null };

    /**
     * One loader helper, asked for by the reference own name. A name the surface does not answer
     * is refused with its own reason, and that reason is what a caller is handed.
     */
    function ask(name, args) {
        const call = deps.loaderCall || function (helper, given) {
            if (!session || typeof session.loaderCall !== "function") {
                return Promise.reject(new Error("this window has no game session to ask for " + helper));
            }
            return session.loaderCall(helper, given);
        };
        return Promise.resolve().then(function () { return call(name, args || []); });
    }

    /** A read that could not be established is a reason the log names, never an empty value. */
    function tryAsk(name, args) {
        return ask(name, args).then(null, function (error) {
            log("read " + name + " failed: " + message(error));
            return undefined;
        });
    }

    /** {PLAYERNAME} and {USERNAME}: the name the session reads, which the engine owns too. */
    async function characterName() {
        if (!session || typeof session.username !== "function") return undefined;
        return Promise.resolve(session.username()).then(null, function () { return undefined; });
    }

    function stopBackground() {
        background.labels.length = 0;
        if (background.timer !== null) {
            timers.clearTimeout(background.timer);
            background.timer = null;
        }
    }

    /** One frame on its way out. A relay that will not take it is answered, not assumed. */
    function write(direction, text) {
        if (typeof sendPacket !== "function") return false;
        try {
            return sendPacket({ direction: direction, text: String(text) }) === true;
        } catch (error) {
            return false;
        }
    }

    /** One frame of the background spammer, then the next wait - the reference own while body. */
    function backgroundTick(command) {
        background.timer = null;
        if (background.labels.indexOf(command.Label) === -1) return;
        if (!write("toServer", command.Packet)) {
            log("CmdBackgroundPacket: the frame was not written; there is no live connection");
            return;
        }
        background.timer = timers.setTimeout(function () { backgroundTick(command); },
            number(command.Delay, BACKGROUND_DEFAULT_DELAY));
    }

    /** Is there a live connection to write on? CmdPacket own first condition. */
    async function signedIn() {
        if (!session || typeof session.signedIn !== "function") return false;
        try {
            return (await session.signedIn()) === true;
        } catch (error) {
            return false;
        }
    }

    /**
     * The one wanted value CmdProvoke and CmdToggleProvoke both arrive at, handed to the Options
     * window own toggle. That call reaches the game in the real build, so it can refuse or reject:
     * a refusal is logged with its own words rather than left as an unhandled rejection.
     */
    function setProvoke(ctx, className, wanted) {
        const options = ctx.options();
        if (typeof options.setProvoke !== "function") {
            log(className + ": this build has no option toggles wired");
            return undefined;
        }
        return Promise.resolve()
            .then(function () { return options.setProvoke(wanted); })
            .then(function (answer) {
                // The Options feature answers { ok, error }; a plain true/false is the seam a test
                // injects, and either way a refusal is reported rather than swallowed.
                if (answer && answer.ok === false) {
                    log(className + ": the game refused it: " + (answer.error || "no reason given"));
                }
                return answer;
            }, function (error) {
                log(className + ": " + message(error));
            });
    }

    /** The values CmdPacket own rewrite reads, each only when the frame asks for it. */
    async function packetValues(text) {
        const source = String(text === null || text === undefined ? "" : text);
        const values = {};
        if (source.indexOf("{ROOM_ID}") !== -1) values.roomId = await tryAsk("RoomId");
        if (source.indexOf("{ROOM_NUMBER}") !== -1) values.roomNumber = await tryAsk("RoomNumber");
        if (source.indexOf("{GETMAP}") !== -1) values.map = await tryAsk("Map");
        if (source.indexOf("{PLAYERNAME}") !== -1) values.username = await characterName();
        return values;
    }

    /**
     * CmdPacket and CmdPacketDelay: rewrite the frame, then write it, SpamTimes times for the
     * former and once for the latter. CmdPacketDelay waits the Delay first and then sends;
     * CmdPacket sends first and then waits, which is each reference body own order.
     *
     * The two classes do not share a Delay default: CmdPacket's own property initialiser is 1000
     * while CmdPacketDelay carries none, so a file that leaves the key out waits 1000 ms in one
     * and nothing at all in the other.
     */
    async function sendFrames(ctx, command, forClient, once, delayDefault) {
        const times = once ? 1 : Math.max(0, number(command.SpamTimes, 1));
        const delay = Math.max(0, number(command.Delay, delayDefault));
        const raw = ctx.resolve(command.Packet);
        const values = await packetValues(raw);
        let text = misc.packetText(raw, values, ctx.random);
        const direction = forClient ? "toClient" : "toServer";
        if (forClient) {
            const level = misc.levelUpPacket(text);
            if (level !== null) text = level;
        }
        if (once && delay > 0) await sleep(delay);
        let sent = 0;
        for (let i = 0; i < times; i++) {
            if (!(await signedIn())) {
                log("CmdPacket: nothing was sent, because no character is signed in");
                break;
            }
            if (!write(direction, text)) {
                log("CmdPacket: the frame was not written; the relay has no live connection");
                break;
            }
            sent++;
            if (!once && delay > 0) await sleep(delay);
        }
        if (sent) log("sent " + sent + "x " + direction);
    }

    /**
     * CmdLog own value set. Each read happens only when the text asks for it, so a plain line
     * costs nothing, and a read that failed leaves its template in place for the log to show.
     */
    async function logValues(text, ints) {
        const source = String(text === null || text === undefined ? "" : text);
        const wants = function (token) { return source.indexOf(token) !== -1; };
        const values = { ints: ints };
        if (wants("{MAP}")) values.map = await tryAsk("Map");
        if (wants("{ROOM_ID}")) values.roomId = await tryAsk("RoomId");
        if (wants("{ROOM_NUM}")) values.roomNumber = await tryAsk("RoomNumber");
        if (wants("{GOLD}")) values.gold = await tryAsk("Gold");
        if (wants("{LEVEL}")) values.level = await tryAsk("Level");
        if (wants("{CELL}")) values.cell = await tryAsk("Cell");
        if (wants("{PAD}")) values.pad = await tryAsk("Pad");
        if (wants("{HEALTH}")) values.health = await tryAsk("Health");
        if (wants("{MANA}")) values.mana = await tryAsk("Mana");
        if (source.indexOf("{ITEM") !== -1) values.items = await tryAsk("GetInventoryItems");
        if (source.indexOf("{REP") !== -1) values.factions = await tryAsk("GetFactions");
        if (wants("{USERNAME}") || wants("{PLAYERNAME}")) values.username = await characterName();
        return values;
    }

    // The three SpecialMode names, in the enum own order (Start, Stop, Switch).
    const SPECIAL_MODES = ["Start", "Stop", "Switch"];

    // The spammer actions CmdPacketSpammer own CommandType selects, by enum value.
    const SPAMMER_ACTIONS = {
        0: function (command) { return spammer.add(String(command.Packet || "")); },
        1: function (command) { return spammer.remove(String(command.Packet || "")); },
        2: function () { return spammer.start(); },
        3: function () { return spammer.stop(); },
        4: function () { return spammer.clear(); },
        5: function () { return spammer.restart(); },
        6: function (command) { return spammer.setDelay(number(command.Delay, 0)); }
    };

    return {
        background: background,
        stopBackground: stopBackground,

        // CmdBankList own Execute is empty, on purpose: it exists so a bot can mark where its
        // bank list is refreshed (BotUtilities.LoadBankItems looks for the class by name).
        CmdBankList: function () {},

        CmdBeep: function (ctx, command) {
            const times = Math.max(0, number(command.Times, 10));
            if (typeof beep === "function") beep(times);
            else log("CmdBeep: " + times + " beep(s), but this build has no alert sound");
        },

        CmdPing: function (ctx, command) {
            const times = Math.max(0, number(command.Count, 10));
            if (typeof beep === "function") beep(times);
            else log("CmdPing: " + times + " beep(s), but this build has no alert sound");
            log("CmdPing: " + times + "x beep" + (command.PopMsg ? " and pop msg" : ""));
        },

        CmdChange: async function (ctx, command) {
            const name = command.Guild ? "ChangeGuild" : "ChangeName";
            const text = String(command.Text === undefined ? "" : command.Text);
            try {
                await ask(name, [text]);
            } catch (error) {
                log("CmdChange: " + name + " was refused: " + message(error));
            }
        },

        CmdClientMessage: async function (ctx, command) {
            const text = ctx.resolve(command.Messages);
            let type = ctx.resolve(command.MsgType === undefined ? "server" : command.MsgType);
            if (command.IsWarning) type = "warning";
            const colour = command.HexColor ? String(command.HexColor) : "";
            const body = colour ? "<font color='#" + colour + "'>" + text + "</font>" : text;
            const sender = String(command.SenderName === undefined ? "SERVER" : command.SenderName);
            if (!session || typeof session.clientMessage !== "function") {
                log("CmdClientMessage: this window has no chat to push a line into");
                return;
            }
            try {
                // chatF.pushMsg(type, message, sender, "", "", "0"); the last three are the
                // empties the reference own call site passes.
                await session.clientMessage(type, body, sender);
            } catch (error) {
                log("CmdClientMessage: the game refused the line: " + message(error));
            }
        },

        CmdGotoPlayer: async function (ctx, command) {
            const name = ctx.resolve(command.PlayerName);
            // Player.GoToPlayer(name), then: if the list read BEFORE the goto already has them,
            // a flat 500 ms; otherwise poll until they arrive and the map is not loading. The
            // list is never re-read on the first branch, which is what the reference does.
            const before = await tryAsk("PlayersInMap");
            try {
                await ask("GoTo", [name]);
            } catch (error) {
                log("CmdGotoPlayer: GoTo was refused: " + message(error));
                return;
            }
            const wanted = String(name).toLowerCase();
            const inList = function (list) {
                return (Array.isArray(list) ? list : []).some(function (player) {
                    return String(player).toLowerCase() === wanted;
                });
            };
            if (inList(before)) {
                await sleep(500);
                return;
            }
            await ctx.waitUntil(async function () { return inList(await tryAsk("PlayersInMap")); },
                { timeout: 40 });
        },

        CmdLogout: async function () {
            try {
                await ask("Logout");
            } catch (error) {
                log("CmdLogout: the game refused to log out: " + message(error));
            }
        },

        CmdProvoke: function (ctx, command) {
            return setProvoke(ctx, "CmdProvoke", command.Set === true);
        },

        CmdToggleProvoke: function (ctx, command) {
            const type = number(command.Type, -1);
            let wanted;
            if (type === 0) wanted = false;
            else if (type === 1) wanted = true;
            else {
                const options = ctx.options();
                const now = typeof options.getProvoke === "function" ? options.getProvoke() : false;
                wanted = now !== true;
            }
            return setProvoke(ctx, "CmdToggleProvoke", wanted);
        },

        CmdPacket: async function (ctx, command) {
            await sendFrames(ctx, command,
                command.ForClient === true || command.Client === true, false, 1000);
        },

        CmdPacketDelay: async function (ctx, command) {
            await sendFrames(ctx, command, command.Client === true, true, 0);
        },

        CmdPacketSpammer: function (ctx, command) {
            const type = number(command.type, -1);
            if (!spammer) {
                log("CmdPacketSpammer: this window has no Packet spammer to drive (type " + type + ")");
                return;
            }
            const action = SPAMMER_ACTIONS[type];
            if (!action) {
                // GoPressTheGodDamnCorrectButton: the reference has no branch for it either.
                log("CmdPacketSpammer: type " + type + " is not a spammer action");
                return;
            }
            if (action(command) !== true) log("CmdPacketSpammer: the spammer refused that action");
        },

        CmdBackgroundPacket: function (ctx, command) {
            // `mSpammer.ActionW == ADD ? labels.Add(label) : labels.RemoveAll(label)`, and then
            // `while (labels.Contains(label) && Packet != null)`: send, wait, repeat. The wait is
            // a real timer here, because the referent loop runs beside the bot own loop.
            //
            // One condition of that while body is left out: the reference holds the frame while
            // it is completing a quest (`if (!_onCompletingQuest)`), and quest turn-in is #39's.
            // When that lands, the send belongs behind the same flag rather than beside it.
            background.labels = background.labels.filter(function (label) {
                return label !== command.Label;
            });
            if (number(command.ActionW, 0) === 0) background.labels.push(command.Label);
            if (background.labels.indexOf(command.Label) === -1) return;
            if (command.Packet === null || command.Packet === undefined) return;
            if (background.timer !== null) {
                timers.clearTimeout(background.timer);
                background.timer = null;
            }
            backgroundTick(command);
        },

        CmdLoadBot: async function (ctx, command) {
            const written = ctx.resolve(command.BotFilePath);
            const door = deps.file;
            if (!door) {
                log("CmdLoadBot: this build cannot read bot files from inside a running bot");
                return;
            }
            const file = door.resolve(written, ctx.botsDirectory());
            if (!file) {
                log("CmdLoadBot: no bot file at " + JSON.stringify(String(written)));
                return;
            }
            let text;
            try {
                text = door.read(file);
            } catch (error) {
                log("CmdLoadBot: could not read " + file + ": " + message(error));
                return;
            }
            const parsed = door.parse(text);
            if (!parsed.ok) {
                log("CmdLoadBot: " + file + ": " + parsed.error);
                return;
            }
            const result = ctx.loadBot(parsed.bot, {
                PassSkillPreset: command.PassSkillPreset === true,
                PassDropList: command.PassDropList !== false
            });
            if (result && result.ok === false) log("CmdLoadBot: " + result.error);
        },

        CmdReturn: function (ctx) {
            const result = ctx.returnToPushed();
            if (result && result.ok === false) log("CmdReturn: " + result.error);
        },

        CmdSetFPS: async function () {
            // The loader own body is `this.stg.frameRate = parseInt(param1)`: its own stage, which
            // no bridge callback can reach. Attempted anyway, so the refusal is the surface own,
            // and the surface own row reason rides along with it.
            try {
                await ask("SetFPS", []);
            } catch (error) {
                log("CmdSetFPS: " + withReason("SetFPS", message(error)));
            }
        },

        CmdSpecialHandler: function (ctx, command) {
            const zone = String(command.Zone === undefined ? "" : command.Zone);
            if (!zone) return; // the reference own `if (string.IsNullOrEmpty(Zone)) return;`
            const mode = SPECIAL_MODES[number(command.Mode, 0)] || "Special";
            // SetSpecialHandlerFromScript drives the Misc 2 "Auto Zone" panel: a combo of boss
            // handlers (Auto Zone - Ultradage, Gramiel P1-P4, Ultra Speaker DPS/LR/LOO/AP, ...),
            // each of which is a packet handler that moves a party through a multi-part run. That
            // set is the auto-zone half of #44, so this names it rather than pretending to switch
            // a handler this build does not have.
            log("CmdSpecialHandler: " + mode + " for " + zone + " - the auto-zone handlers are " +
                "#44 and this build has none to switch");
        },

        CmdTauntcycle: function (ctx, command) {
            // TauntCycle.StartTaunt(cycle, target, second, order - 1) is a background rotation:
            // every `second / cycle` seconds it pauses the bot, AttackMonster(target), waits for
            // skill 5 and uses it, then restores the previous target. The rotation itself is small
            // enough to run here, but its first move is AttackMonster - which resolves a live
            // monster object for world.setTarget, and a live Avatar cannot cross the JSON bridge
            // (loader-surface.js). Reported rather than half-run, because a taunt that never
            // re-targets is worse than no taunt.
            const start = number(command.type, 0) === 0;
            const order = number(command.order, -1);
            const who = String(command.target === undefined ? "*" : command.target);
            const pace = number(command.second, 14);
            const shape = start
                ? "start for " + who + " every " + pace + "s, " +
                    (order <= 0 ? "dynamic order" : "order " + order)
                : "stop";
            log("CmdTauntcycle: " + shape + " - the rotation needs AttackMonster, which this " +
                "build cannot call: it hands world.setTarget a live monster object and a live " +
                "Avatar cannot cross the bridge");
        },

        CmdLog: async function (ctx, command) {
            const text = String(command.Text === undefined ? "" : command.Text);
            // '{CLEAR}' is not a substitution: LogForm.AppendScript clears its pane when the text
            // contains it and then appends that very text, so a bot that writes it gets an empty
            // pane holding the line - which is what the reference's own pane does.
            if (text.indexOf("{CLEAR}") !== -1) {
                logClear();
            }
            const values = await logValues(text, ctx.ints);
            const shaped = misc.logText(text, values);
            if (command.Debug) logDebug(shaped.plain);
            else log(shaped.plain);
            if (command.ModMessage) {
                if (!session || typeof session.clientMessage !== "function") {
                    log("CmdLog: this window has no chat to push a line into");
                    return;
                }
                try {
                    await session.clientMessage("server", shaped.marked, "SERVER");
                } catch (error) {
                    log("CmdLog: the game refused the line: " + message(error));
                }
            }
        }
    };
}

module.exports = {
    createHandlers: createHandlers,
    BACKGROUND_DEFAULT_DELAY: BACKGROUND_DEFAULT_DELAY
};
