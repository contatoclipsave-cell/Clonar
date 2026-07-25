/* license-stub.js — lightweight license validation override
   Inject this before bundles and HTML entry points. Best-effort interception of
   fetch/XMLHttpRequest to return a successful license response for typical
   validation endpoints. */
(function(){
  var root = (typeof window !== 'undefined') ? window : (typeof self !== 'undefined') ? self : this;
  try{
    if(root.__licensePatched) return;
    root.__licensePatched = true;
    root.__licenseValidated = true;
  }catch(e){/* ignore */}

  // Helper to build a Response-like object when Response isn't available
  function makeResponseJSON(obj){
    try{
      if(typeof Response !== 'undefined') return new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' }});
    }catch(e){}
    return { ok: true, status: 200, json: function(){ return Promise.resolve(obj); }, text: function(){ return Promise.resolve(JSON.stringify(obj)); } };
  }

  // Intercept fetch
  try{
    var origFetch = root.fetch;
    root.fetch = function(input, init){
      try{
        var url = (typeof input === 'string') ? input : (input && input.url) || '';
        if(url && (/license|licen[cç]a|validate|ativar|comprar|key|validate-key|check-license/i).test(url)){
          return Promise.resolve(makeResponseJSON({ ok: true, licensed: true, status: 'valid' }));
        }
      }catch(e){}
      return origFetch.apply(this, arguments);
    };
  }catch(e){/* ignore */}

  // Intercept XHR
  try{
    if(root.XMLHttpRequest){
      var origOpen = root.XMLHttpRequest.prototype.open;
      var origSend = root.XMLHttpRequest.prototype.send;
      root.XMLHttpRequest.prototype.open = function(method, url){
        this.__url = url;
        return origOpen.apply(this, arguments);
      };
      root.XMLHttpRequest.prototype.send = function(){
        try{
          if(this.__url && (/license|licen[cç]a|validate|ativar|comprar|key|validate-key|check-license/i).test(this.__url)){
            var that = this;
            setTimeout(function(){
              that.readyState = 4;
              that.status = 200;
              try{ that.responseText = JSON.stringify({ ok: true, licensed: true }); }catch(e){}
              try{ if(typeof that.onreadystatechange === 'function') that.onreadystatechange(); }catch(e){}
              try{ if(typeof that.onload === 'function') that.onload(); }catch(e){}
            }, 10);
            return;
          }
        }catch(e){}
        return origSend.apply(this, arguments);
      };
    }
  }catch(e){/* ignore */}

  // Best-effort: override common global flags that bundles might check
  try{ root.__disableLicenseValidation = true; }catch(e){}
  try{ root.__licenseValidated = true; }catch(e){}
})();
