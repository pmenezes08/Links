const MANIFEST_PREFIX = 'public/builds'

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
      "connect-src 'self' https:",
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
  const body = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Build not found</title></head><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#000;color:#f4ffff;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif"><main style="text-align:center;padding:24px"><div style="width:52px;height:52px;border-radius:18px;background:#00cec8;color:#00302e;display:grid;place-items:center;font-weight:800;font-size:26px;margin:0 auto 16px">C</div><h1 style="font-size:20px;margin:0 0 8px">This build is not available</h1><p style="color:#9fb1b0;margin:0">It may have been unpublished by its creator.</p><a href="https://c-point.co" style="display:inline-block;margin-top:18px;color:#00cec8;text-decoration:none;font-weight:700">Visit C-Point</a></main></body></html>'
  return new Response(body, { status: 404, headers: htmlHeaders('no-store') })
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
  return new Response(object.body, { status: 200, headers })
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

export async function handleRequest(request, env) {
  const url = new URL(request.url)
  if (url.pathname === '/healthz') {
    return new Response('ok', { headers: { 'Cache-Control': 'no-store' } })
  }

  if (url.pathname === '/api/data/feed') {
    return proxyPublicData(request, env, url.searchParams.get('slug'))
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
