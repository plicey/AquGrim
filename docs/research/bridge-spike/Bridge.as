package {
    import flash.display.Loader;
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.external.ExternalInterface;
    import flash.net.URLRequest;
    import flash.system.ApplicationDomain;
    import flash.system.LoaderContext;
    import flash.system.Security;
    import flash.utils.getQualifiedClassName;

    public class Bridge6 extends Sprite {
        private var report:Object = { stage: 'init' };
        private var gameLoader:Loader;

        public function Bridge6() {
            Security.allowDomain('*');
            ExternalInterface.addCallback('aqReport', aqReport);
            ExternalInterface.addCallback('aqGet', aqGet);
            ExternalInterface.addCallback('aqSet', aqSet);
            ExternalInterface.addCallback('aqKeys', aqKeys);
            ExternalInterface.call('console.log', '[spike] Bridge6 constructed');
            var p:Object = loaderInfo.parameters;
            var url:String = (p && p.swf) ? p.swf : '';
            report.requested = url;
            gameLoader = new Loader();
            gameLoader.contentLoaderInfo.addEventListener(Event.COMPLETE, onComplete);
            // Shared domain: game classes become first-class here.
            gameLoader.load(new URLRequest(url), new LoaderContext(true, ApplicationDomain.currentDomain));
        }

        private function aqReport():String { return JSON.stringify(report); }

        private function resolve(path:String):Object {
            if (path === '') return gameLoader.content;
            var parts:Array = path.split('.');
            var o:Object = gameLoader.content;
            for (var i:int = 0; i < parts.length; i++) {
                if (o == null) throw new Error('null at ' + parts[i]);
                o = o[parts[i]];
            }
            return o;
        }

        private function aqGet(path:String):String {
            var out:String;
            try { var v:Object = resolve(path); out = (v === null) ? 'null' : (typeof v) + '=' + String(v); }
            catch (e:Error) { out = 'ERR:' + e.message; }
            return out;
        }

        private function aqSet(path:String, value:String):String {
            var out:String;
            try {
                var parts:Array = path.split('.');
                var parent:Object = gameLoader.content;
                for (var i:int = 0; i < parts.length - 1; i++) { parent = parent[parts[i]]; }
                parent[parts[parts.length - 1]] = value;
                out = 'ok=' + String(parent[parts[parts.length - 1]]);
            } catch (e:Error) { out = 'ERR:' + e.message; }
            return out;
        }

        private function aqKeys(path:String):String {
            var out:String;
            try {
                var o:Object = resolve(path);
                var ks:Array = [];
                for (var k:String in o) { ks.push(k); if (ks.length >= 30) break; }
                out = 'n=' + ks.length + ' ' + ks.join(',');
            } catch (e:Error) { out = 'ERR:' + e.message; }
            return out;
        }

        private function onComplete(e:Event):void {
            report.stage = 'complete';
            report.childClass = String(getQualifiedClassName(gameLoader.content));
            try { addChild(gameLoader); report.attached = true; } catch (err:Error) { report.attached = 'ERR:' + err.message; }
            ExternalInterface.call('console.log', '[spike] Bridge6 LOADED ' + JSON.stringify(report));
        }
    }
}
