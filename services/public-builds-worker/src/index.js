const MANIFEST_PREFIX = 'public/builds'
const CPOINT_LOGO_URL = 'https://app.c-point.co/static/cpoint-logo.png'

export function normalizeSlug(pathname) {
  const first = String(pathname || '/').split('/').filter(Boolean)[0] || ''
  const slug = first.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 96)
  return slug || null
}

export function manifestKey(slug) {
  return `${MANIFEST_PREFIX}/${slug}/manifest.json`
}

function htmlHeaders(cacheControl = 'public, max-age=300') {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Content-Security-Policy': [
      "default-src 'self' https: data: blob:",
      "script-src 'self' 'unsafe-inline' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' https: data: blob:",
      "font-src 'self' https: data:",
      "connect-src 'self' https://app.c-point.co https://cpoint-app-739552904126.europe-west1.run.app https://cpoint-app-staging-739552904126.europe-west1.run.app",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; '),
  }
}

function jsonHeaders(status = 200) {
  return {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
      'X-Content-Type-Options': 'nosniff',
    },
  }
}

function notFound() {
  const body = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Build not found</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f4ffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><main style="text-align:center;padding:24px"><img src="${CPOINT_LOGO_URL}" alt="C-Point" style="width:52px;height:52px;border-radius:18px;object-fit:contain;margin:0 auto 16px;display:block;background:#061817"><h1 style="font-size:20px;margin:0 0 8px">This build is not available</h1><p style="color:#9fb1b0;margin:0">It may have been unpublished by its creator.</p><a href="https://www.c-point.co" style="display:inline-block;margin-top:18px;color:#00cec8;text-decoration:none;font-weight:700">Visit C-Point</a></main></body></html>`
  return new Response(body, { status: 404, headers: htmlHeaders('no-store') })
}

function normalizePublicBranding(html) {
  const override = `<style id="cpoint-public-brand-override">
#cpoint-public-brand{right:max(8px,env(safe-area-inset-right))!important;top:50%!important;bottom:auto!important;left:auto!important;transform:translateY(-50%)!important;opacity:.88!important}
#cpoint-public-splash .cp-logo{background:#061817!important;overflow:hidden!important}
#cpoint-public-splash .cp-logo img,#cpoint-public-brand .cp-dot img{width:100%!important;height:100%!important;object-fit:contain!important;display:block!important}
#cpoint-public-brand .cp-dot{background:#061817!important;overflow:hidden!important}
@media(max-width:520px){#cpoint-public-brand{right:max(6px,env(safe-area-inset-right))!important;top:50%!important;bottom:auto!important;left:auto!important;transform:translateY(-50%)!important;font-size:11px!important;padding:7px 9px!important}}
</style><script>
(function(){
  var logoUrl='${CPOINT_LOGO_URL}';
  function fixCPointLogo(){
    var splashLogo=document.querySelector('#cpoint-public-splash .cp-logo');
    if(splashLogo && !splashLogo.querySelector('img')) splashLogo.innerHTML='<img src="'+logoUrl+'" alt="C-Point" />';
    var dot=document.querySelector('#cpoint-public-brand .cp-dot');
    if(dot && !dot.querySelector('img')) dot.innerHTML='<img src="'+logoUrl+'" alt="" />';
  }
  function fixCPointBrand(){
    var badge=document.getElementById('cpoint-public-brand');
    if(!badge) return;
    fixCPointLogo();
    badge.href='https://www.c-point.co';
    badge.target='_blank';
    badge.rel='noopener noreferrer';
    if(badge.dataset.cpointClickFixed) return;
    badge.dataset.cpointClickFixed='1';
    badge.addEventListener('click',function(e){
      e.preventDefault();
      e.stopPropagation();
      try{
        var opened=window.open('https://www.c-point.co','_blank','noopener,noreferrer');
        if(!opened) window.location.href='https://www.c-point.co';
      }catch(_){ window.location.href='https://www.c-point.co'; }
    },true);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fixCPointBrand,{once:true});
  else fixCPointBrand();
})();
</script>`
  const logoImg = `<img src="${CPOINT_LOGO_URL}" alt="C-Point" />`
  const dotImg = `<img src="${CPOINT_LOGO_URL}" alt="" />`
  const body = String(html || '')
    .replaceAll('https://c-point.co', 'https://www.c-point.co')
    .replace(/<div class="cp-logo">\s*C\s*<\/div>/g, `<div class="cp-logo">${logoImg}</div>`)
    .replace(/<span class="cp-dot">\s*C\s*<\/span>/g, `<span class="cp-dot">${dotImg}</span>`)
  if (body.includes('cpoint-public-brand-override')) return body
  if (/<\/head>/i.test(body)) return body.replace(/<\/head>/i, `${override}</head>`)
  return `${override}${body}`
}

async function readManifest(env, slug) {
  const object = await env.BUILDS_BUCKET.get(manifestKey(slug))
  if (!object) return null
  const manifest = await object.json()
  if (!manifest || manifest.status !== 'published' || !manifest.artifactKey) return null
  return manifest
}

async function serveBuild(env, slug) {
  const manifest = await readManifest(env, slug)
  if (!manifest) return notFound()
  const object = await env.BUILDS_BUCKET.get(manifest.artifactKey)
  if (!object) return notFound()
  const headers = htmlHeaders(object.httpMetadata?.cacheControl || 'public, max-age=300')
  headers.ETag = object.httpEtag
  const body = normalizePublicBranding(await object.text())
  return new Response(body, { status: 200, headers })
}

async function proxyPublicData(request, env, slug) {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ success: true }), jsonHeaders(200))
  }
  if (!slug) {
    return new Response(JSON.stringify({ success: false, error: 'not_found' }), jsonHeaders(404))
  }
  const manifest = await readManifest(env, slug)
  if (!manifest) {
    return new Response(JSON.stringify({ success: false, error: 'not_found' }), jsonHeaders(404))
  }
  const url = new URL(request.url)
  const target = new URL(`/api/builder/public/${encodeURIComponent(slug)}/data/feed`, env.PUBLIC_API_BASE)
  for (const key of ['connector', 'params']) {
    const value = url.searchParams.get(key)
    if (value != null) target.searchParams.set(key, value)
  }
  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  })
  const text = await upstream.text()
  return new Response(text, jsonHeaders(upstream.status))
}

async function proxyPublicImages(request, env, slug) {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ success: true }), jsonHeaders(200))
  }
  if (!slug) {
    return new Response(JSON.stringify({ success: false, error: 'not_found', images: [] }), jsonHeaders(404))
  }
  const manifest = await readManifest(env, slug)
  if (!manifest) {
    return new Response(JSON.stringify({ success: false, error: 'not_found', images: [] }), jsonHeaders(404))
  }
  const url = new URL(request.url)
  const target = new URL(`/api/builder/public/${encodeURIComponent(slug)}/data/images`, env.PUBLIC_API_BASE)
  for (const key of ['q', 'limit']) {
    const value = url.searchParams.get(key)
    if (value != null) target.searchParams.set(key, value)
  }
  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  })
  const text = await upstream.text()
  return new Response(text, jsonHeaders(upstream.status))
}

async function proxyPublicCapsule(request, env, slug, name) {
  if (request.method === 'OPTIONS') {
    return new Response(JSON.stringify({ success: true }), jsonHeaders(200))
  }
  if (!slug || !name) {
    return new Response(JSON.stringify({ success: false, error: 'not_found', data: null }), jsonHeaders(404))
  }
  const manifest = await readManifest(env, slug)
  if (!manifest) {
    return new Response(JSON.stringify({ success: false, error: 'not_found', data: null }), jsonHeaders(404))
  }
  const target = new URL(
    `/api/builder/public/${encodeURIComponent(slug)}/capsules/${encodeURIComponent(name)}`,
    env.PUBLIC_API_BASE,
  )
  const upstream = await fetch(target.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' },
    redirect: 'manual',
  })
  const text = await upstream.text()
  return new Response(text, jsonHeaders(upstream.status))
}

export async function handleRequest(request, env) {
  const url = new URL(request.url)
  if (url.pathname === '/healthz') {
    return new Response('ok', { headers: { 'Cache-Control': 'no-store' } })
  }

  if (url.pathname === '/api/data/feed') {
    return proxyPublicData(request, env, url.searchParams.get('slug'))
  }

  if (url.pathname === '/api/data/images') {
    return proxyPublicImages(request, env, url.searchParams.get('slug'))
  }

  const capsuleMatch = url.pathname.match(/^\/api\/capsules\/([a-zA-Z0-9_-]+)$/)
  if (capsuleMatch) {
    return proxyPublicCapsule(request, env, url.searchParams.get('slug'), capsuleMatch[1])
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD, OPTIONS' },
    })
  }

  const slug = normalizeSlug(url.pathname)
  if (!slug) return notFound()
  const response = await serveBuild(env, slug)
  if (request.method === 'HEAD') {
    return new Response(null, { status: response.status, headers: response.headers })
  }
  return response
}

export default {
  fetch(request, env) {
    return handleRequest(request, env)
  },
}
