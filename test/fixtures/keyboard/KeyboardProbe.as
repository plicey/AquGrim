package {
    import flash.display.Sprite;
    import flash.events.Event;
    import flash.events.KeyboardEvent;
    import flash.external.ExternalInterface;

    public class KeyboardProbe extends Sprite {
        private var down:Object = {};
        private var frames:int = 0;
        private var skills:int = 0;
        private var deactivations:int = 0;

        public function KeyboardProbe() {
            stage.addEventListener(KeyboardEvent.KEY_DOWN, function(e:KeyboardEvent):void {
                down[e.keyCode] = true;
            });
            stage.addEventListener(KeyboardEvent.KEY_UP, function(e:KeyboardEvent):void {
                delete down[e.keyCode];
                if (e.keyCode == 49) skills++;
            });
            stage.addEventListener(Event.DEACTIVATE, function(e:Event):void {
                down = {};
                deactivations++;
            });
            addEventListener(Event.ENTER_FRAME, function(e:Event):void { frames++; });
            ExternalInterface.addCallback('probeKey', function(type:String, code:uint):void {
                stage.dispatchEvent(new KeyboardEvent(type, true, false, 0, code));
            });
            ExternalInterface.addCallback('probeState', function():Object {
                return {x:int(Boolean(down[68])) - int(Boolean(down[65])),
                    y:int(Boolean(down[83])) - int(Boolean(down[87])),
                    frames:frames, skills:skills, deactivations:deactivations};
            });
        }
    }
}
