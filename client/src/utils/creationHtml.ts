/**
 * Prepare a generated front-end creation for rendering in a sandboxed iframe.
 *
 * - Injects a `width=device-width` viewport meta so the artifact lays out to
 *   the frame width instead of a desktop default (fixes content overflowing
 *   the phone screen). Forced even if the artifact already declared one.
 * - Optionally injects a postMessage->KeyboardEvent bridge so the host's
 *   on-screen touch controls can drive keyboard-controlled games.
 */

const VIEWPORT_META =
  '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">'
const BASE_CSS =
  '<style>html,body{margin:0;padding:0;background:#000;max-width:100%;overflow-x:hidden}img,canvas,svg,video{max-width:100%;height:auto}</style>'

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

const ERROR_REPORTER = `<script>(function(){
  function report(msg){ try{ parent.postMessage({__cperr:true, message:String(msg).slice(0,400)}, '*'); }catch(_){ } }
  window.addEventListener('error', function(e){ report((e && e.message) || 'Script error'); });
  window.addEventListener('unhandledrejection', function(e){ report((e && e.reason && e.reason.message) || 'Unhandled promise rejection'); });
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
    getResults:function(){return call('getResults',{});}
  };
})();<\/script>`

const CONTROL_BRIDGE = `<script>(function(){
  function fire(type,key){
    try{
      var e=new KeyboardEvent(type,{key:key,code:key,bubbles:true,cancelable:true});
      var t=document.activeElement||document.body||document.documentElement;
      t.dispatchEvent(e);document.dispatchEvent(e);window.dispatchEvent(e);
    }catch(_){}
  }
  window.addEventListener('message',function(ev){
    var d=ev&&ev.data||{};
    if(d&&d.__cpctl&&d.key){fire(d.down?'keydown':'keyup',d.key);}
  });
})();<\/script>`

export function prepareCreationHtml(html: string, opts: { controlBridge?: boolean; dataBridge?: boolean } = {}): string {
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

  const tail = ERROR_REPORTER + FIT_REPORTER
    + (opts.controlBridge ? CONTROL_BRIDGE : '')
    + (opts.dataBridge ? DATA_BRIDGE : '')
  out = out.includes('</body>') ? out.replace('</body>', tail + '</body>') : out + tail
  return out
}
