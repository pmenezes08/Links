/**
 * Prepare a generated front-end creation for rendering in a sandboxed iframe.
 *
 * - Injects a `width=device-width` viewport meta so the artifact lays out to
 *   the frame width instead of a desktop default (fixes content overflowing
 *   the phone screen). Forced even if the artifact already declared one.
 */

const VIEWPORT_META =
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">'
const BASE_CSS =
  '<style>html,body{margin:0;padding:0;background:#000;max-width:100%;overflow-x:hidden}img,canvas,svg,video{max-width:100%;height:auto}'
  // iOS auto-zooms when a focused input has font-size < 16px (the "screen
  // jumps" effect). Force a 16px floor so focusing a field never zooms.
  + 'input,textarea,select{font-size:16px}</style>'

// Reports the artifact's content size out to the host so it can scale the
// iframe to fit (fixed-pixel layouts overflow even with a viewport meta).
const FIT_REPORTER = `<script>(function(){
  function measure(){
    try{
      var d=document.documentElement, b=document.body;
      var w=Math.max(d.scrollWidth, b?b.scrollWidth:0, d.offsetWidth||0);
      var h=Math.max(d.scrollHeight, b?b.scrollHeight:0, d.offsetHeight||0);
      parent.postMessage({__cpfit:true, w:w, h:h, vw:window.innerWidth, vh:window.innerHeight}, '*');
    }catch(_){ }
  }
  window.addEventListener('load', measure);
  try{ new ResizeObserver(measure).observe(document.documentElement); }catch(_){ }
  setTimeout(measure, 300); setTimeout(measure, 1200);
})();<\/script>`

// Health reporter — posts a typed __cperr so the host can offer a fix. Catches
// (1) uncaught errors, (2) unhandled rejections, (3) FAILED RESOURCE loads
// (a broken CDN <script>/<link>/<img> — these only surface on the capture
// phase, not window.onerror), and (4) a blank render (nothing painted after
// settle — the silent-failure mode a thrown-error net can't see). One report
// per kind so a single broken CDN can't spam.
const ERROR_REPORTER = `<script>(function(){
  var sent={};
  function report(kind,msg){ if(sent[kind])return; sent[kind]=1; try{ parent.postMessage({__cperr:true, kind:kind, message:String(msg||kind).slice(0,400)}, '*'); }catch(_){ } }
  window.addEventListener('error', function(e){
    var t=e&&e.target;
    if(t && t!==window && (t.tagName==='SCRIPT'||t.tagName==='LINK'||t.tagName==='IMG')){
      report('cdn','Could not load '+(t.src||t.href||t.tagName)); return;
    }
    report('error',(e && e.message) || 'Script error');
  }, true);
  window.addEventListener('unhandledrejection', function(e){ report('error',(e && e.reason && e.reason.message) || 'Unhandled promise rejection'); });
  function checkBlank(){ try{ var b=document.body; if(!b)return;
    var txt=(b.innerText||'').trim().length, els=b.querySelectorAll('*').length, painted=document.querySelector('canvas,svg,img,video,button,input');
    if(txt<2 && els<3 && !painted) report('blank','The page rendered blank'); }catch(_){ } }
  window.addEventListener('load', function(){ setTimeout(checkBlank, 1600); });
})();<\/script>`

// Community data SDK. The artifact gets a promise-based window.CPoint that
// posts RPCs to the host; the host (which is session-authed) performs the real
// authenticated fetch and posts the result back. The artifact never touches the
// network or the app session itself.
const DATA_BRIDGE = `<script>(function(){
  var seq=0, pending={};
  window.addEventListener('message',function(ev){
    var d=ev&&ev.data||{};
    if(d&&d.__cpdata_res&&d.rid&&pending[d.rid]){
      var p=pending[d.rid]; delete pending[d.rid];
      d.ok?p.resolve(d.result):p.reject(new Error(d.error||'cpoint_error'));
    }
  });
  function call(op,payload){return new Promise(function(resolve,reject){
    var rid=(++seq)+'_'+(new Date().getTime());
    pending[rid]={resolve:resolve,reject:reject};
    try{ parent.postMessage({__cpdata:true,rid:rid,op:op,payload:payload||{}},'*'); }catch(_){ reject(new Error('cpoint_unavailable')); return; }
    setTimeout(function(){ if(pending[rid]){ delete pending[rid]; reject(new Error('cpoint_timeout')); } },8000);
  });}
  window.CPoint={
    submitScore:function(n,opts){return call('submitScore',{value:n,key:(opts&&opts.key)||'highscore',name:(opts&&opts.name)});},
    getLeaderboard:function(opts){return call('getLeaderboard',{key:(opts&&opts.key)||'highscore',limit:(opts&&opts.limit)||10});},
    rate:function(x,opts){return call('rate',{value:x,name:(opts&&opts.name)});},
    getResults:function(){return call('getResults',{});},
    // Per-player save slot — localStorage is BLOCKED in this sandbox, so use
    // these to persist progress/state/preferences. value is any JSON.
    save:function(key,value){return call('save',{key:key||'save',value:value});},
    load:function(key){return call('load',{key:key||'save'});},
    // Real, freely-licensed web photos for a query -> {images:[{url,full,title}]}.
    // Use 'url' directly as an <img> src. Fetch at runtime; don't hard-code URLs.
    images:function(query,opts){return call('images',{q:query,limit:(opts&&opts.limit)||8});},
    // Recent public data via vetted host-side connectors -> {data, attribution}.
    data:function(connector,params){return call('feed',{connector:connector,params:params||{}});},
    // Signal the run/round ended — the host shows a native result screen
    // (score count-up, top scores, rate, play again, share). Pass the score
    // for a game; call with no args for a quiz/result with no number.
    gameOver:function(opts){ try{ parent.postMessage({__cpend:true, score:(opts&&opts.score), key:(opts&&opts.key)||'highscore'}, '*'); }catch(_){ } }
  };
  // Feature flag so a creation can detect brokered persistence is available
  // (it always is when this bridge is injected) and show/hide save UI safely.
  window.CPoint.hasPersistence=true;
    window.CPoint.hasData=true;
})();<\/script>`

export function prepareCreationHtml(html: string, opts: { dataBridge?: boolean; errorReporter?: boolean } = {}): string {
  if (!html) return html
  let out = html
  const headInject = VIEWPORT_META + BASE_CSS

  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => m + headInject)
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html[^>]*>/i, (m) => `${m}<head>${headInject}</head>`)
  } else {
    out = headInject + out
  }

  const tail = FIT_REPORTER
    + (opts.errorReporter ? ERROR_REPORTER : '')
    + (opts.dataBridge ? DATA_BRIDGE : '')
  out = out.includes('</body>') ? out.replace('</body>', tail + '</body>') : out + tail
  return out
}
