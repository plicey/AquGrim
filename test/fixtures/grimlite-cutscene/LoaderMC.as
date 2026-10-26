// Stock callback excerpts: /var/tmp/aq48/out-game/scripts/LoaderMC.as
      private function onFileLoadComplete(param1:Event) : void
      {
         var _loc6_:String = null;
         var _loc2_:* = this.rootClass.world;
         var _loc3_:Loader = Loader(param1.target.loader);
         var _loc4_:MovieClip = this.mcDest;
         var _loc5_:Boolean = this.isEvent;
         try
         {
            for(_loc6_ in this.history)
            {
               if(this.history[_loc6_].ldr == _loc3_)
               {
                  if(this.history[_loc6_].dest != null)
                  {
                     _loc4_ = this.history[_loc6_].dest;
                  }
                  _loc5_ = Boolean(this.history[_loc6_].evt);
                  delete this.history[_loc6_];
               }
            }
         }
         catch(e:Error)
         {
         }
         _loc3_.contentLoaderInfo.removeEventListener(Event.INIT,this.onFileLoadComplete);
         _loc3_.contentLoaderInfo.removeEventListener(Event.COMPLETE,this.onFileLoadComplete);
         _loc3_.contentLoaderInfo.removeEventListener(ProgressEvent.PROGRESS,this.onFileLoadProgress);
         _loc3_.contentLoaderInfo.removeEventListener(IOErrorEvent.IO_ERROR,this.onFileLoadError);
         _loc3_.contentLoaderInfo.removeEventListener(SecurityErrorEvent.SECURITY_ERROR,this.onFileLoadSecurityError);
         try
         {
            if(_loc3_.content != null && _loc4_ != null)
            {
               _loc4_.addChild(_loc3_.content);
            }
         }
         catch(e:Error)
         {
         }
         if(_loc5_ && _loc2_ != null)
         {
            trace("[Load] LoaderMC fileLoaded event -> world");
            _loc2_.mapEventTrigger({
               "cmd":"fileLoaded",
               "args":{"loc":"default"}
            });
         }
         this.isEvent = false;
         this.mcDest = null;
         try
         {
            MovieClip(parent).removeChild(this);
         }
         catch(e:Error)
         {
         }
      }
