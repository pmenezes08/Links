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
  '<style>html,body{margin:0;padding:0;background:#000}</style>'

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

export function prepareCreationHtml(html: string, opts: { controlBridge?: boolean } = {}): string {
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

  if (opts.controlBridge) {
    out = out.includes('</body>') ? out.replace('</body>', CONTROL_BRIDGE + '</body>') : out + CONTROL_BRIDGE
  }
  return out
}
