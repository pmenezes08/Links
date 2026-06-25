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
  '<style>html,body{margin:0;padding:0;min-height:100%;background:#000;max-width:100%;overflow-x:hidden}img,canvas,svg,video{max-width:100%;height:auto}'
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

// Reports the artifact's computed body background colour so the host can match
// it — then any area revealed when the page scrolls or the keyboard opens is
// seamless, not a contrasting black band.
const BG_REPORTER = `<script>(function(){
  function rep(){ try{ var c=getComputedStyle(document.body).backgroundColor;
    if(c && c!=='rgba(0, 0, 0, 0)' && c!=='transparent') parent.postMessage({__cpbg:true, color:c}, '*'); }catch(_){ } }
  window.addEventListener('load', rep); setTimeout(rep, 400); setTimeout(rep, 1500);
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
function dataBridgeScript(startMatchId?: number | null): string {
  const start = typeof startMatchId === 'number' && Number.isFinite(startMatchId) ? String(startMatchId) : 'null'
  return `<script>(function(){
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
  function pick(result,key){ return result&&Object.prototype.hasOwnProperty.call(result,key)?result[key]:result; }
  function callPick(op,payload,key){ return call(op,payload).then(function(r){ return pick(r,key); }); }
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
    data:function(connector,params,opts){return call('feed',{connector:connector,params:params||{},refresh:!!(opts&&opts.refresh)});},
    // Shared community-scoped state for lightweight apps (polls, trackers, boards).
    sharedState:{
      get:function(key){return call('shared.get',{key:key||'main'});},
      update:function(key,value,opts){return call('shared.update',{key:key||'main',value:value,version:opts&&opts.version});}
    },
    // Small structured row collections. Use for apps, not arbitrary databases.
    collection:function(name){return {
      list:function(opts){return call('collection.list',{name:name,limit:(opts&&opts.limit)||100});},
      create:function(value){return callPick('collection.create',{name:name,value:value},'item');},
      update:function(id,value,opts){return callPick('collection.update',{name:name,id:id,value:value,version:opts&&opts.version},'item');},
      delete:function(id){return call('collection.delete',{name:name,id:id});}
    };},
    forms:{submit:function(name,value){return call('forms.submit',{name:name,value:value});}},
    // Record the final score when a run ends (persists it). The GAME renders its
    // own end screen; the host shows no UI. Pass the score for a game; omit for a
    // quiz/result with no number.
    gameOver:function(opts){ try{ parent.postMessage({__cpend:true, score:(opts&&opts.score), key:(opts&&opts.key)||'highscore'}, '*'); }catch(_){ } },
    // Two-player turn-based MATCH (chess, checkers, connect-4, cards, ...). The
    // game owns ALL rules + UI; these only sync shared state, enforce turns, and
    // notify the opponent. opponents()/create(handle) to challenge a member;
    // list() for "your games"; get(id)/poll(id,sinceSeq) to read; move(id,{move,
    // state,version,result}) to act (result: 'win'|'lose'|'draw' ends it).
    match:{
      opponents:function(){return call('match.opponents',{});},
      create:function(handle){return callPick('match.create',{opponent:handle},'match');},
      list:function(){return call('match.list',{});},
      get:function(id){return callPick('match.get',{id:id},'match');},
      poll:function(id,sinceSeq){return call('match.poll',{id:id,since:sinceSeq||0});},
      move:function(id,opts){return call('match.move',{id:id,move:(opts&&opts.move),state:(opts&&opts.state),version:(opts&&opts.version)||0,result:(opts&&opts.result)});},
      accept:function(id){return callPick('match.accept',{id:id},'match');},
      decline:function(id){return callPick('match.decline',{id:id},'match');},
      cancel:function(id){return callPick('match.cancel',{id:id},'match');},
      resign:function(id){return callPick('match.resign',{id:id},'match');}
    }
  };
  // Higher-level controller for generated games. It owns the fragile lifecycle
  // (lobby, sent/received invites, polling, retries, stale reloads, seat helpers)
  // so the game code can focus on rules + rendering.
  window.CPoint.matchController=function(opts){
    opts=opts||{};
    var current=null, state=null, pollTimer=null, failures=0, hidden=false, lastMoves=[], lastMove=null;
    function callOpt(name,arg){ try{ if(typeof opts[name]==='function') opts[name](arg); }catch(_){ } }
    function phaseFor(m){ if(!m) return 'idle'; if(m.status==='pending') return m.your_seat===1?'pending_sent':'pending_received'; if(m.status==='active') return m.your_turn?'your_turn':'opponent_turn'; if(m.status==='finished') return 'finished'; if(m.status==='cancelled') return 'cancelled'; if(m.status==='declined') return 'declined'; return m.status||'idle'; }
    function decorate(m){ if(!m) return m; var ph=phaseFor(m); m.phase=ph; m.isPending=ph==='pending_sent'||ph==='pending_received'; m.isWaitingForAccept=ph==='pending_sent'; m.isInviteReceived=ph==='pending_received'; m.canMove=ph==='your_turn'; m.isActive=m.status==='active'; m.isFinished=m.status==='finished'; return m; }
    function shouldPoll(){ if(!current||hidden) return false; return current.phase==='pending_sent'||current.phase==='opponent_turn'; }
    function view(){ current=decorate(current); return {match:current,state:state,phase:current&&current.phase,yourSeat:current&&current.your_seat,isWhite:!!(current&&current.your_seat===1),isBlack:!!(current&&current.your_seat===2),yourTurn:!!(current&&current.your_turn),canMove:!!(current&&current.canMove),isPending:!!(current&&current.isPending),isWaitingForAccept:!!(current&&current.isWaitingForAccept),isInviteReceived:!!(current&&current.isInviteReceived),isActive:!!(current&&current.isActive),isFinished:!!(current&&current.isFinished),status:current&&current.status,winner:current&&current.winner,lastSeq:(current&&current.last_seq)||0,moves:lastMoves,lastMove:lastMove,opponent:(current&&current.opponent)||''}; }
    function stopPolling(){ if(pollTimer){ clearInterval(pollTimer); pollTimer=null; } }
    async function refreshLobby(){ var r=await window.CPoint.match.list(); var matches=((r&&r.matches)||[]).map(decorate); callOpt('onLobby',matches); return matches; }
    async function open(id,incomingMoves){ stopPolling(); lastMoves=incomingMoves||[]; lastMove=lastMoves.length?lastMoves[lastMoves.length-1]:null; current=decorate(await window.CPoint.match.get(id)); state=current.state || (typeof opts.startingState==='function'?opts.startingState(current):null); failures=0; callOpt('onReconnect',0); var v=view(); callOpt('onMatch',v); if(lastMoves.length){ callOpt('onMoves',{moves:lastMoves,lastMove:lastMove,state:state,view:v}); lastMoves.forEach(function(m){ if(m&&m.by==='them') callOpt('onOpponentMove',{move:m.move,delta:m,state:state,view:v}); }); } if(shouldPoll()) startPolling(); return v; }
    function startPolling(){ stopPolling(); if(!shouldPoll()) return; pollTimer=setInterval(async function(){ try{ var p=await window.CPoint.match.poll(current.id,(current&&current.last_seq)||0); var moves=(p&&p.moves)||[]; failures=0; callOpt('onReconnect',0); if(!current||p.last_seq!==current.last_seq||p.status!==current.status||p.your_turn!==current.your_turn||moves.length){ await open(current.id,moves); } }catch(_){ failures++; if(failures>=3) callOpt('onReconnect',failures); } }, opts.pollMs||(opts.live?1000:2500)); }
    async function create(handle){ var m=await window.CPoint.match.create(handle); return open(m.id); }
    async function accept(id){ var m=await window.CPoint.match.accept(id); return open(m.id); }
    async function decline(id){ var m=await window.CPoint.match.decline(id); await refreshLobby(); return m; }
    async function cancel(id){ var m=await window.CPoint.match.cancel(id); await refreshLobby(); return m; }
    async function resign(){ if(!current) return null; var m=await window.CPoint.match.resign(current.id); return open(m.id); }
    async function submitMove(action){ current=decorate(current); if(!current) throw new Error('no_match'); if(!current.canMove) throw new Error('not_your_turn'); var next=typeof opts.applyMove==='function'?opts.applyMove(state,action,current):action&&action.state; var result=typeof opts.getResult==='function'?opts.getResult(next,current,action):undefined; try{ await window.CPoint.match.move(current.id,{move:action,state:next,version:current.version,result:result}); return open(current.id); }catch(e){ await open(current.id); throw e; } }
    if(typeof document!=='undefined'){ document.addEventListener('visibilitychange',function(){ hidden=document.hidden; if(hidden) stopPolling(); else if(shouldPoll()) startPolling(); }); }
    return {refreshLobby:refreshLobby,open:open,create:create,accept:accept,decline:decline,cancel:cancel,resign:resign,submitMove:submitMove,startPolling:startPolling,stopPolling:stopPolling,view:view};
  };
  // Steve-friendly turn-based runtime: the generated game supplies rules +
  // rendering, while the platform owns match lifecycle and move submission.
  window.CPoint.turnBasedGame=function(config){
    config=config||{};
    var root=typeof config.root==='string'?document.querySelector(config.root):config.root;
    if(!root){ root=document.getElementById('app')||document.body; }
    var api=null;
    function safeRender(state,view){ try{ if(typeof config.render==='function') config.render(root,state,view,api); }catch(e){ console.error('[CPoint.turnBasedGame] render failed',e); } }
    var ctrl=window.CPoint.matchController({
      pollMs:config.pollMs||(config.live===false?2500:1000),
      live:config.live!==false,
      startingState:function(match){ return typeof config.initialState==='function'?config.initialState(match):{}; },
      applyMove:function(state,action,match){ return typeof config.applyMove==='function'?config.applyMove(state,action,ctrl.view()):state; },
      getResult:function(next,match,action){ return typeof config.getResult==='function'?config.getResult(next,ctrl.view(),action):undefined; },
      onLobby:function(matches){ safeRender(null,{phase:'lobby',matches:matches,canMove:false,status:'lobby'}); },
      onMatch:function(view){ safeRender(view.state,view); },
      onMoves:function(e){ if(typeof config.onMoves==='function') config.onMoves(e.moves,e.state,e.view); },
      onOpponentMove:function(e){ if(typeof config.onOpponentMove==='function') config.onOpponentMove(e.move,e.state,e.view,e.delta); },
      onReconnect:function(count){ if(count && typeof config.onReconnect==='function') config.onReconnect(count); }
    });
    api={
      boot:async function(){ if(window.CPoint.startMatchId) return ctrl.open(window.CPoint.startMatchId); return ctrl.refreshLobby(); },
      refreshLobby:function(){ return ctrl.refreshLobby(); },
      listOpponents:function(){ return window.CPoint.match.opponents(); },
      challenge:function(handle){ return ctrl.create(handle); },
      open:function(id){ return ctrl.open(id); },
      accept:function(id){ return ctrl.accept(id); },
      decline:function(id){ return ctrl.decline(id); },
      cancel:function(id){ return ctrl.cancel(id); },
      resign:function(){ return ctrl.resign(); },
      view:function(){ return ctrl.view(); },
      submitMove:async function(action){ var view=ctrl.view(); if(typeof config.canMove==='function'&&!config.canMove(view.state,action,view)) throw new Error('illegal_move'); return ctrl.submitMove(action); }
    };
    setTimeout(function(){ api.boot(); },0);
    return api;
  };
  // Feature flags so a creation can detect brokered capabilities and show/hide UI.
  window.CPoint.hasPersistence=true;
  window.CPoint.hasData=true;
  window.CPoint.hasCreationData=true;
  window.CPoint.hasMultiplayer=true;
  window.CPoint.hasMatchController=true;
  window.CPoint.hasTurnBasedGame=true;
  // Set by the host to a match id when opened from a "your move" deep-link, so the
  // game can jump straight into that match on boot (null otherwise).
  window.CPoint.startMatchId=${start};
})();<\/script>`
}

export function prepareCreationHtml(html: string, opts: { dataBridge?: boolean; errorReporter?: boolean; startMatchId?: number | null } = {}): string {
  if (!html) return html
  let out = html
  const headInject = VIEWPORT_META + BASE_CSS + (opts.dataBridge ? dataBridgeScript(opts.startMatchId) : '')

  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => m + headInject)
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html[^>]*>/i, (m) => `${m}<head>${headInject}</head>`)
  } else {
    out = headInject + out
  }

  const tail = FIT_REPORTER + BG_REPORTER
    + (opts.errorReporter ? ERROR_REPORTER : '')
  out = out.includes('</body>') ? out.replace('</body>', tail + '</body>') : out + tail
  return out
}
