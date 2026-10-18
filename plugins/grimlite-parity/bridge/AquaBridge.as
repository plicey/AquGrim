// The game bridge: a small loader that owns the load of the game SWF and registers the call
// surface the parity features drive, so game state is readable and writable from the app.
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
//   3. The entry point must not be compiled in. This bridge is a loader in the reference's own
//      sense (Grimlite's grimoire.swf): it asks the game host which file is current and loads
//      that, so a game or loader update needs no rebuild here.
//
// The call surface is the reference loader's, not the stock game's: the names below are the ones
// the reference's features call, and most of them exist only in its own loader.

package {
    import flash.display.Loader;
    import flash.display.Sprite;
    import flash.display.Stage;
    import flash.display.StageAlign;
    import flash.display.StageScaleMode;
    import flash.events.Event;
    import flash.events.IOErrorEvent;
    import flash.events.SecurityErrorEvent;
    import flash.external.ExternalInterface;
    import flash.net.URLLoader;
    import flash.net.URLLoaderDataFormat;
    import flash.net.URLRequest;
    import flash.system.ApplicationDomain;
    import flash.system.LoaderContext;
    import flash.system.Security;
    import flash.utils.getQualifiedClassName;

    public class AquaBridge extends Sprite {
        // Bounded so a page that never polls cannot grow the movie's memory without limit.
        private static const MAX_EVENTS:int = 200;

        private var game:Object = null;          // the game's own root object
        private var domain:ApplicationDomain;    // where the game's classes live (ours)
        private var events:Array = [];
        private var gameLoader:Loader;
        private var base:String = '';

        public function AquaBridge() {
            // Both reference loaders open themselves to the page and to the game they load.
            Security.allowDomain('*');
            Security.allowInsecureDomain('*');

            domain = ApplicationDomain.currentDomain;
            stage.scaleMode = StageScaleMode.NO_SCALE;
            stage.align = StageAlign.TOP_LEFT;

            registerCallSurface();

            // The base is this movie's own directory, resolved from where it was served. That is
            // what the stock loader calls sURL, and it is why the bridge is served beside the
            // game's paths: with the bridge at /game/aqua-bridge.swf both the version payload
            // (/game/api/data/gameversion) and the game file (/game/gamefiles/<file>) resolve
            // relative to it, on whatever host served it. Nothing about the game is compiled in.
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
        }

        private function addCallback(name:String, fn:Function):void {
            try {
                ExternalInterface.addCallback(name, fn);
            } catch (e:Error) {
                emit('error', 'could not register ' + name + ': ' + e.message);
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
            emit('load', 'resolving');
            var url:String = base + 'api/data/gameversion';
            var loader:URLLoader = new URLLoader();
            loader.dataFormat = URLLoaderDataFormat.TEXT;
            loader.addEventListener(Event.COMPLETE, onVersionLoaded);
            loader.addEventListener(IOErrorEvent.IO_ERROR, onVersionFailed);
            loader.addEventListener(SecurityErrorEvent.SECURITY_ERROR, onVersionDenied);
            try {
                loader.load(new URLRequest(url));
            } catch (e:Error) {
                emit('error', 'bad game base ' + base + ': ' + e.message);
            }
        }

        // Named and side-effect-only: an inline closure that both returns a value and contains
        // try/catch does not compile (see docs/research/grimlite-bridge-spike.md).
        private function onVersionLoaded(e:Event):void {
            var file:String = gameFileFrom(String(e.target.data));
            if (file.length === 0) {
                emit('error', 'the game host did not name a game file');
                return;
            }
            loadGame(base + 'gamefiles/' + file);
        }

        private function onVersionFailed(e:Event):void {
            emit('error', 'could not ask the game host which file is current');
        }

        private function onVersionDenied(e:Event):void {
            emit('error', 'denied asking the game host which file is current');
        }

        /** The current game file name out of the game host's own version payload. */
        private function gameFileFrom(payload:String):String {
            var file:String = '';
            try {
                var parsed:Object = JSON.parse(payload);
                if (parsed && parsed.sFile) file = String(parsed.sFile);
            } catch (e:Error) {
                emit('error', 'the game host answered with something else: ' + e.message);
            }
            return file;
        }

        private function loadGame(url:String):void {
            emit('load', 'loading ' + url);
            gameLoader = new Loader();
            gameLoader.contentLoaderInfo.addEventListener(Event.COMPLETE, onGameComplete);
            gameLoader.contentLoaderInfo.addEventListener(IOErrorEvent.IO_ERROR, function (e:Event):void {
                emit('error', 'could not load ' + url);
            });
            gameLoader.contentLoaderInfo.addEventListener(SecurityErrorEvent.SECURITY_ERROR, function (e:Event):void {
                emit('error', 'denied loading ' + url + ' - page, bridge and game must share one origin');
            });
            // Sharing the domain explicitly is the load-bearing half: it is what puts the game's
            // classes in this movie's own domain instead of a child's.
            try {
                gameLoader.load(new URLRequest(url), new LoaderContext(true, ApplicationDomain.currentDomain));
            } catch (e:Error) {
                emit('error', 'bad game url ' + url + ': ' + e.message);
            }
        }

        private function onGameComplete(e:Event):void {
            var content:Object = gameLoader.content;
            game = content;
            // The stock loader hands the game on through a property of its own root; when the
            // entry point is the loader rather than the game, that is where the game lives.
            if (game != null && game['Game'] != null) game = game['Game'];

            try {
                addChild(gameLoader);
            } catch (err:Error) {
                emit('error', 'loaded but could not show the game: ' + err.message);
            }
            emit('load', 'loaded ' + getQualifiedClassName(content));
            emit('ready', game == null ? 'no game root' : 'game root available');
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
