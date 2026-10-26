// The game bridge: a small loader that boots Artix's loader in the shared ApplicationDomain,
// then registers the call surface the parity features drive against the loader's Game root.
//
// Three facts decide its shape, all measured (docs/research/grimlite-bridge-spike.md):
//
//   1. PPAPI Flash inside Chromium grants no local-trusted sandbox, so loading the game
//      cross-origin fails with #2119/#2121. The page, this SWF and the game SWF must share one
//      origin - which is what the plugin's loopback game origin provides.
//   2. ApplicationDomain.currentDomain must be passed explicitly. Without it the game's classes
//      live in a child domain reachable only through getDefinition; with it they are first-class
//      here (509 classes enumerable, currentTotal 510), which is what makes the game's internals
//      addressable rather than merely lookup-able.
//   3. The entry point must not be compiled in. Loader4 performs the game's startup and passes
//      its FlashVars into Game.params; loading the current Game*.swf directly leaves it stopped
//      on its first frame with no login screen.
//
// The call surface is the reference loader's, not the stock game's: the names below are the ones
// the reference's features call, and most of them exist only in its own loader.

package {
    import flash.display.Loader;
    import flash.display.Sprite;
    import flash.display.Stage;
    import flash.display.StageScaleMode;
    import flash.events.Event;
    import flash.events.IOErrorEvent;
    import flash.events.SecurityErrorEvent;
    import flash.events.TimerEvent;
    import flash.external.ExternalInterface;
    import flash.net.URLRequest;
    import flash.system.ApplicationDomain;
    import flash.system.LoaderContext;
    import flash.system.Security;
    import flash.utils.getQualifiedClassName;
    import flash.utils.Timer;

    public class AquaBridge extends Sprite {
        // Bounded so a page that never polls cannot grow the movie's memory without limit.
        private static const MAX_EVENTS:int = 200;

        private var skipCutscenes:Boolean = false;
        private var skipRoot:Object = null;
        private var game:Object = null;          // the game's own root object
        private var domain:ApplicationDomain;    // where the game's classes live (ours)
        private var events:Array = [];
        private var gameLoader:Loader;
        private var gameRootWait:Timer;
        private var base:String = '';

        public function AquaBridge() {
            // Both reference loaders open themselves to the page and to the game they load.
            Security.allowDomain('*');
            Security.allowInsecureDomain('*');

            domain = ApplicationDomain.currentDomain;
            // The reference's AxShockwaveFlash defaults to ShowAll, so the game follows the
            // window's size instead of staying fixed at its authored stage size. Leave align at
            // its default: with ShowAll, that centers the letterboxed stage in the window.
            stage.scaleMode = StageScaleMode.SHOW_ALL;

            registerCallSurface();

            // The base is this movie's own directory, resolved from where it was served. Loader4
            // and the game it loads therefore both use the loopback origin shared with this bridge.
            base = ownBase();
            if (base.length === 0) {
                emit('error', 'cannot tell where this movie was served from, so the game cannot be found');
            } else {
                resolveThenLoad();
            }
        }

        /** This movie's URL up to and including the last '/', or '' when it cannot be read. */
        private function ownBase():String {
            var out:String = '';
            try {
                // url is this movie's own URL; loaderURL is the loader's, which for a top-level
                // embed is the same thing but is empty in some player versions.
                var here:String = loaderInfo.url;
                if (!here) here = loaderInfo.loaderURL;
                if (here && here.indexOf('/') !== -1) out = here.substring(0, here.lastIndexOf('/') + 1);
            } catch (e:Error) {
                out = '';
            }
            return out;
        }

        // ---------------------------------------------------------------- call surface

        private function registerCallSurface():void {
            addCallback('getGameObject', aqGetGameObject);
            addCallback('getGameObjectS', aqGetGameObjectS);
            addCallback('setGameObject', aqSetGameObject);
            addCallback('callGameFunction', aqCallGameFunction);
            addCallback('callGameFunction0', aqCallGameFunction0);
            addCallback('isNull', aqIsNull);
            addCallback('sendClientPacket', aqSendClientPacket);
            addCallback('pollEvents', aqPollEvents);
            addCallback('AttackMonster', aqAttackMonster);
            addCallback('AttackMonsterByMonMapId', aqAttackMonsterByMonMapId);
            addCallback('UseSkill', aqUseSkill);
            addCallback('ForceUseSkill', aqForceUseSkill);
            addCallback('CancelTargetSelf', aqCancelTargetSelf);
            addCallback('SetTargetPvP', aqSetTargetPvP);
            addCallback('RejectDrop', aqRejectDrop);
            addCallback('SetSkipCutscenesEnabled', aqSetSkipCutscenesEnabled);
        }

        private function addCallback(name:String, fn:Function):void {
            try {
                ExternalInterface.addCallback(name, fn);
            } catch (e:Error) {
                emit('error', 'could not register ' + name + ': ' + e.message);
            }
        }

        private function aqSetSkipCutscenesEnabled(enabled:Boolean):String {
            if (skipCutscenes == enabled && (!enabled || skipRoot === game)) return toJson(enabled);
            skipCutscenes = enabled;
            if (skipRoot != null) {
                skipRoot.removeEventListener(Event.ENTER_FRAME, onSkipCutsceneFrame);
                skipRoot = null;
            }
            if (enabled && game != null) {
                skipRoot = game;
                // Run before the handler's readiness/overlay callbacks on the same root.
                skipRoot.addEventListener(Event.ENTER_FRAME, onSkipCutsceneFrame, false, 2147483647, true);
            }
            return toJson(enabled);
        }

        private function onSkipCutsceneFrame(event:Event):void {
            try {
                var world:Object = game == null ? null : game.world;
                var handler:Object = world == null ? null : world.cHandle;
                if (handler == null) return;
                if (!("isPending" in handler) || !("transfer" in handler)) {
                    throw new Error("this game's cutscene handler does not support isPending/transfer");
                }
                if (!handler.isPending()) return;
                // Match stock readiness before canceling the handler and moving its destination.
                if (world.map == null || world.mapLoadInProgress) return;
                // If enabled during an in-flight load, let INIT/COMPLETE finish before transfer.
                var history:Object = game.ldrMC.history;
                for (var key:String in history) {
                    if (history[key].dest === game.mcExtSWF) return;
                }
                handler.transfer();
            } catch (error:Error) {
                aqSetSkipCutscenesEnabled(false);
                emit('error', 'Skip Cutscenes disabled: ' + error.message);
            }
        }

        /** Read a dot-path on the game, as JSON. The reference's getGameObject. */
        private function aqGetGameObject(path:String):String {
            var out:String;
            try {
                out = toJson(resolve(path));
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /**
         * Read a dot-path whose first part is a class in the game's domain, so static and
         * class-level access works too - the reference's getGameObjectS. The longest prefix that
         * is a definition is resolved through the domain; the rest is property traversal.
         */
        private function aqGetGameObjectS(path:String):String {
            var out:String;
            try {
                out = toJson(resolveStatic(path));
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /** Write a value at a dot-path on the game. The reference's setGameObject. */
        private function aqSetGameObject(path:String, value:Object):String {
            var out:String;
            try {
                var parts:Array = String(path).split('.');
                var parent:Object = walk(game, parts.slice(0, parts.length - 1));
                if (parent == null) throw new Error('no object at ' + path);
                parent[parts[parts.length - 1]] = value;
                out = toJson(parent[parts[parts.length - 1]]);
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /** Call a function by dot-path with arguments. The reference's callGameFunction. */
        private function aqCallGameFunction(path:String, ...args):String {
            return invoke(path, args);
        }

        /** The zero-argument variant, which the reference keeps separate. */
        private function aqCallGameFunction0(path:String):String {
            return invoke(path, []);
        }

        /**
         * Existence probe: distinguishes "absent" from "is null" without throwing, which is why
         * the reference keeps it apart from a read.
         */
        private function aqIsNull(path:String):String {
            var missing:Boolean;
            try {
                missing = resolve(path) == null;
            } catch (e:Error) {
                missing = true;
            }
            return missing ? 'true' : 'false';
        }

        /**
         * Hand a frame to the client as if the server had sent it. The reference reaches the
         * game's own SFS extension handler through the shared domain and calls handleMessage on it.
         *
         * shortcut: the handler's exact signature could not be verified offline (the reference
         * decompile was not available here), so the one-argument shape is tried first and the
         * type-carrying shape only if that throws - a failed call has no effect, where guessing
         * wrong twice could. Verify against a live client (docs/FLASH_CHECKLIST.md) and drop the
         * second shape once the real one is known.
         */
        private function aqSendClientPacket(packet:String, type:String):String {
            var out:String;
            try {
                var handlerClass:Class = domain.getDefinition(
                    'it.gotoandplay.smartfoxserver.handlers.ExtHandler') as Class;
                if (handlerClass == null) throw new Error('no ExtHandler in the game domain');
                var handler:Object = new handlerClass();
                try {
                    handler.handleMessage(String(packet));
                } catch (first:Error) {
                    handler.handleMessage(String(type), String(packet));
                }
                out = 'ok';
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /**
         * The event channel back to the plugin: the movie queues what happened and the caller
         * drains it. Pull rather than a SWF-to-page call, because only the page-to-SWF direction
         * is measured to work under PPAPI Flash here.
         */
        private function aqPollEvents():String {
            var drained:Array = events;
            events = [];
            return toJson(drained);
        }

        // ------------------------------------------------------- the live-object calls (#49)

        // Six of the reference loader's helpers hand the game a live ActionScript object - an
        // Avatar to world.setTarget, an action object to world.testAction. Those objects cannot
        // cross ExternalInterface, and they do not have to: the JSON boundary is the page <-> this
        // movie hop, while the game's classes live in THIS movie's own ApplicationDomain (see
        // loadGame), so an object resolved here IS the game's object and can be passed to a game
        // method in-domain, exactly as the reference's own loader does it. Each callback below is
        // therefore the reference's body with the primitive the caller can carry as its argument.
        //
        // The monsters and skills are resolved by calling the game's OWN accessors rather than by
        // walking its members by hand, and the target is set by calling world.setTarget rather
        // than by assigning myAvatar.target: setTarget is where the game keeps its own guards -
        // the caroling-map early return for a non-player target (World.as 8374) and the user's
        // bUntargetSelf preference (8381) - so calling it is what reproduces them.

        /** The live world object. Resolved through the same dot-path reader the callbacks use. */
        private function world():Object {
            var w:Object = resolve('world');
            if (w == null) throw new Error('the game has no world yet');
            return w;
        }

        /**
         * World.as GetMonsterByName: the first living monster in the player's own cell whose name
         * plate contains the want (or the want is "*"), walked in the game's own order.
         */
        private function monsterByName(name:String):Object {
            var want:String = String(name).toLowerCase();
            var w:Object = world();
            var list:Object = w.getMonstersByCell(w.strFrame);
            for each (var monster:Object in list) {
                var clip:Object = monster.pMC;
                if (clip != null) {
                    var plate:Object = clip.pname;
                    var named:String = String(plate.ti.text).toLowerCase();
                    if ((named.indexOf(want) > -1 || name == '*') &&
                        Number(monster.dataLeaf.intState) > 0) {
                        return monster;
                    }
                }
            }
            return null;
        }

        /**
         * World.as GetMonsterByMonMapId: the same walk, matched on dataLeaf.MonMapID. The loader
         * does not lower-case this one, because the id is compared as written.
         */
        private function monsterByMonMapId(id:String):Object {
            var want:String = String(id);
            var w:Object = world();
            var list:Object = w.getMonstersByCell(w.strFrame);
            for each (var monster:Object in list) {
                var clip:Object = monster.pMC;
                if (clip != null) {
                    var monMapId:String = String(monster.dataLeaf.MonMapID);
                    if ((monMapId.indexOf(want) > -1 || id == '*') &&
                        Number(monster.dataLeaf.intState) > 0) {
                        return monster;
                    }
                }
            }
            return null;
        }

        /** world.actions.active[parseInt(index)], the live action object the loader works on. */
        private function actionAt(index:String):Object {
            var parsed:Number = parseInt(String(index));
            var actions:Object = world().actions;
            // The loader reads the member without a guard and faults on a missing index. An
            // unparsable index is refused here rather than coerced: int(NaN) is 0, and casting
            // whatever happens to sit in slot 0 is a worse answer than saying the index is wrong.
            var action:Object = isNaN(parsed) ? null : actions.active[int(parsed)];
            if (action == null) throw new Error('the game has no skill at index ' + index);
            return action;
        }

        /**
         * The loader's own IsSkillReady (Player.as 106), private to its Player class so there is
         * no game member to call: the greater of the global cooldown left and this skill's own,
         * both scaled by the avatar's haste. It also consumes the action's OldCD, which is what
         * the game sets when a packet resets a cooldown (Game.as 4310) - dropping that would make
         * this disagree with the reference on the frame after a reset.
         */
        private function skillReady(action:Object):int {
            var w:Object = world();
            var now:Number = new Date().getTime();
            var haste:Number = 1 - Math.min(Math.max(Number(w.myAvatar.dataLeaf.sta.$tha), -1), 0.5);
            var cd:Number;
            if (action.OldCD != null) {
                cd = Math.round(Number(action.OldCD) * haste);
                delete action.OldCD;
            } else {
                cd = Math.round(Number(action.cd) * haste);
            }
            var global:Number = Number(w.GCD) - (now - Number(w.GCDTS));
            if (global < 0) global = 0;
            var own:Number = cd - (now - Number(action.ts));
            if (own < 0) own = 0;
            return Math.max(global, own);
        }

        /**
         * Player.ForceUseSkill: cast this skill only when it is ready, unlocked and known. The
         * readiness half is the loader's own; the locked half is the game's own action flags.
         */
        private function forceUseSkillAt(index:String):void {
            var action:Object = actionAt(index);
            if (skillReady(action) == 0) {
                if (Boolean(action.isOK) && !action.skillLock) {
                    world().testAction(action);
                }
            }
        }

        /**
         * Player.AttackMonster: setTarget then approachTarget, both and in that order, as the
         * loader writes them. A name no monster answers to is a no-op there and is a no-op here.
         */
        private function aqAttackMonster(name:String):String {
            var out:String;
            try {
                var monster:Object = monsterByName(String(name));
                if (monster != null) {
                    var w:Object = world();
                    w.setTarget(monster);
                    w.approachTarget();
                }
                out = 'ok';
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /** Player.AttackMonsterByMonMapId: the same two calls, resolved by MonMapID instead. */
        private function aqAttackMonsterByMonMapId(id:String):String {
            var out:String;
            try {
                var monster:Object = monsterByMonMapId(String(id));
                if (monster != null) {
                    var w:Object = world();
                    w.setTarget(monster);
                    w.approachTarget();
                }
                out = 'ok';
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /**
         * Player.ForceUseSkill, the callback half. A cast the loader decides not to make - a
         * skill on cooldown, locked, or one the game has not unlocked - answers ok, because
         * refusing to act is what that body does.
         */
        private function aqForceUseSkill(index:String):String {
            var out:String;
            try {
                forceUseSkillAt(String(index));
                out = 'ok';
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /**
         * Player.UseSkill, branch for branch in the loader's own order: a self-targeted or
         * friendly skill is cast outright; a self target is dropped by assigning null (which is
         * what the loader does here, not cancelTarget); otherwise the avatar walks into range and
         * the cast is forced.
         */
        private function aqUseSkill(index:String):String {
            var out:String;
            try {
                var w:Object = world();
                var action:Object = actionAt(String(index));
                if (action.tgt == 's' || action.tgt == 'f') {
                    forceUseSkillAt(String(index));
                } else if (w.myAvatar.target == w.myAvatar) {
                    w.myAvatar.target = null;
                } else if (w.myAvatar.target != null && Number(w.myAvatar.target.dataLeaf.intHP) > 0) {
                    w.approachTarget();
                    forceUseSkillAt(String(index));
                }
                out = 'ok';
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /**
         * Player.CancelTargetSelf: cancel only when the avatar is targeting itself. The compare is
         * between the live objects, which is the whole reason this cannot be a page-side test.
         */
        private function aqCancelTargetSelf():String {
            var out:String;
            try {
                var w:Object = world();
                if (w.myAvatar.target == w.myAvatar) w.cancelTarget();
                out = 'ok';
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /**
         * Player.SetTargetPvP: take a same-cell, living avatar on another PvP team as the target
         * when nothing is targeted, and the named one when the name is given. The loader's own
         * two conditions are kept as written, including the second one's read of the *current*
         * target - which is how it avoids re-targeting the player it already holds.
         */
        private function aqSetTargetPvP(username:String):String {
            var out:String;
            try {
                var w:Object = world();
                var want:String = username == null ? null : String(username);
                var avatars:Object = w.avatars;
                var myLeaf:Object = w.myAvatar.dataLeaf;
                for (var uid:* in avatars) {
                    var avatar:Object = avatars[uid];
                    var leaf:Object = avatar.dataLeaf;
                    if (leaf != null && leaf.strFrame == w.strFrame &&
                        leaf.pvpTeam != myLeaf.pvpTeam &&
                        !avatar.isMyAvatar &&
                        Number(leaf.intState) > 0) {
                        if (w.myAvatar.target == null) w.setTarget(avatar);
                        if (want != null) {
                            var held:Object = w.myAvatar.target;
                            // The loader dereferences the target here with no guard, which faults
                            // whenever nothing is targeted (its first branch declined - caroling,
                            // or the user's own bUntargetSelf) or the target is a monster, whose
                            // dataLeaf carries strMonName and no strUsername. Both mean "this
                            // avatar is not the one being held", so they are read that way instead
                            // of faulting: the scan exists to pick a PvP target, and refusing to
                            // do it because the player happened to hold a monster is not the aim.
                            var heldName:String = '';
                            if (held != null && held.dataLeaf != null &&
                                held.dataLeaf.strUsername != null) {
                                heldName = String(held.dataLeaf.strUsername).toLowerCase();
                            }
                            if (String(leaf.strUsername).toLowerCase() == want.toLowerCase() &&
                                heldName != want.toLowerCase()) {
                                w.setTarget(avatar);
                            }
                        }
                    }
                }
                out = 'ok';
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        /** World.as RejectDrop: false means the relay beat the stock drop UI to this call. */
        private function aqRejectDrop(name:String, id:String):String {
            try {
                var w:Object = world();
                if (game.litePreference.data.bCustomDrops) {
                    var ui:Object = game.cDropsUI;
                    if (ui == null || w.invTree[id] == null) return 'false';
                    for (var j:int = 0; j < ui.invTree.length; j++) {
                        if (String(ui.invTree[j].ItemID) == id) {
                            ui.onBtNo(w.invTree[id]);
                            return 'true';
                        }
                    }
                    return 'false';
                }
                var stack:Object = game.ui.dropStack;
                var removed:Boolean = false;
                // Walk backwards so removing adjacent matches cannot skip a child.
                for (var i:int = stack.numChildren - 1; i >= 0; i--) {
                    var clip:Object = stack.getChildAt(i);
                    if (getQualifiedClassName(clip) == 'DFrame2MC' &&
                        !clip.isClosing && clip.fData != null && String(clip.fData.ItemID) == id) {
                        stack.removeChild(clip);
                        removed = true;
                    }
                }
                if (removed) game.cleanDropStack();
                return removed ? 'true' : 'false';
            } catch (e:Error) {
                return jsonError(e);
            }
            return 'false';
        }

        // ---------------------------------------------------------------- reading and writing

        private function resolve(path:String):Object {
            if (game == null) throw new Error('the game is not loaded yet');
            if (path == null || path === '') return game;
            return walk(game, String(path).split('.'));
        }

        private function resolveStatic(path:String):Object {
            var parts:Array = String(path).split('.');
            var start:Object = null;
            var used:int = 0;
            for (var i:int = parts.length; i > 0; i--) {
                var candidate:String = parts.slice(0, i).join('.');
                if (domain.hasDefinition(candidate)) {
                    start = domain.getDefinition(candidate);
                    used = i;
                    break;
                }
            }
            if (start == null) throw new Error('no class in the game domain for ' + path);
            if (used === parts.length) return start;
            return walk(start, parts.slice(used));
        }

        /** Follow a chain of property names, answering null for the first one that is absent. */
        private function walk(from:Object, parts:Array):Object {
            var current:Object = from;
            for (var i:int = 0; i < parts.length && current != null; i++) {
                current = current[parts[i]];
            }
            return current;
        }

        private function invoke(path:String, args:Array):String {
            var out:String;
            try {
                var parts:Array = String(path).split('.');
                var owner:Object = parts.length > 1 ? walk(game, parts.slice(0, parts.length - 1)) : game;
                if (owner == null) throw new Error('no object at ' + path);
                var name:String = parts[parts.length - 1];
                if (!(name in owner)) throw new Error('no member ' + name + ' at ' + path);
                out = toJson(owner[name].apply(owner, args));
            } catch (e:Error) {
                out = jsonError(e);
            }
            return out;
        }

        // ---------------------------------------------------------------- loading the game

        private function resolveThenLoad():void {
            // shortcut: Loader4 is the current Artix launcher entry; use the launcher config if
            // Artix changes this path.
            loadGameLoader(base + 'gamefiles/Loader4.swf?ver=b');
        }

        private function loadGameLoader(url:String):void {
            emit('load', 'loading the game loader');
            gameLoader = new Loader();
            gameLoader.contentLoaderInfo.addEventListener(Event.COMPLETE, onLoaderComplete);
            gameLoader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, function (e:Event):void {
                stopGameRootWait();
                emit('error', 'could not load ' + url);
            });
            gameLoader.contentLoaderInfo.addEventListener(SecurityErrorEvent.SECURITY_ERROR, function (e:Event):void {
                stopGameRootWait();
                emit('error', 'denied loading ' + url + ' - page, bridge and game must share one origin');
            });
            // Put Loader4 on stage before its first frame so its stage-dependent startup works.
            try {
                addChild(gameLoader);
                // Loader4 loads the game into ApplicationDomain.currentDomain itself.
                gameLoader.load(new URLRequest(url), new LoaderContext(false, ApplicationDomain.currentDomain));
            } catch (e:Error) {
                stopGameRootWait();
                emit('error', 'bad game loader url ' + url + ': ' + e.message);
            }
        }

        private function onLoaderComplete(e:Event):void {
            var content:Object = gameLoader.content;
            emit('load', 'loader ready ' + getQualifiedClassName(content));
            if (captureGameRoot()) return;

            // Loader4 loads the current Game*.swf asynchronously and exposes its root as `Game`.
            // It may not load that SWF until after the user signs in on Loader4's login screen.
            gameRootWait = new Timer(1000);
            gameRootWait.addEventListener(TimerEvent.TIMER, waitForGameRoot);
            gameRootWait.start();
        }

        private function waitForGameRoot(e:TimerEvent):void {
            captureGameRoot();
        }

        private function captureGameRoot():Boolean {
            var candidate:Object = null;
            try {
                // Use the same longest-domain-prefix lookup as getGameObjectS; Loader4.Game may
                // be only a placeholder, and Game.root is not itself a class named Game.
                candidate = resolveStatic('Game.root');
            } catch (e:Error) {
                candidate = null;
            }
            if (candidate == null) {
                // Loader4 may not expose Game; the shared-domain root can arrive later.
                var loader:Object = gameLoader == null ? null : gameLoader.content;
                try {
                    candidate = loader == null ? null : loader['Game'];
                } catch (e2:Error) {
                    candidate = null;
                }
            }
            if (candidate == null) return false;

            // Login and server screens can have a Game root before its live world is ready.
            try {
                if (candidate['world'] == null) return false;
            } catch (e:Error) {
                return false;
            }

            game = candidate;
            aqSetSkipCutscenesEnabled(skipCutscenes);
            stopGameRootWait();
            emit('load', 'loaded ' + getQualifiedClassName(game));
            emit('ready', 'game root available');
            return true;
        }

        private function stopGameRootWait():void {
            if (gameRootWait == null) return;
            gameRootWait.stop();
            gameRootWait.removeEventListener(TimerEvent.TIMER, waitForGameRoot);
            gameRootWait = null;
        }

        // ---------------------------------------------------------------- helpers

        private function emit(type:String, value:String):void {
            if (events.length >= MAX_EVENTS) events.shift();
            events.push({ t: type, v: value });
        }

        private function toJson(value:Object):String {
            var out:String = 'null';
            if (value == null) return out;
            try {
                out = JSON.stringify(value);
            } catch (e:Error) {
                // A live game object can hold cycles and functions, which JSON cannot express.
                out = '"' + String(value).replace(/"/g, '\\"') + '"';
            }
            return out;
        }

        private function jsonError(e:Error):String {
            return JSON.stringify({ error: e.message });
        }
    }
}
