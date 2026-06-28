import assert from 'node:assert/strict'
import test from 'node:test'

import { handleRequest, manifestKey, normalizeSlug } from '../src/index.js'

function bucket(objects) {
  return {
    async get(key) {
      const value = objects[key]
      if (value == null) return null
      return {
        body: value,
        httpEtag: '"test"',
        httpMetadata: { cacheControl: 'public, max-age=60' },
        async json() {
          return JSON.parse(value)
        },
        async text() {
          return String(value)
        },
      }
    },
  }
}

test('normalizes the first path segment as a public slug', () => {
  assert.equal(normalizeSlug('/My Build-123/anything'), 'mybuild-123')
  assert.equal(normalizeSlug('/'), null)
  assert.equal(manifestKey('demo-1'), 'public/builds/demo-1/manifest.json')
})

test('serves a published build from the R2 manifest artifact key', async () => {
  const manifest = JSON.stringify({
    status: 'published',
    artifactKey: 'public/builds/demo-1/v1.html',
  })
  const html = '<!doctype html><html><body><a href="https://c-point.co">Demo</a></body></html>'
  const env = {
    PUBLIC_API_BASE: 'https://example.test',
    BUILDS_BUCKET: bucket({
      'public/builds/demo-1/manifest.json': manifest,
      'public/builds/demo-1/v1.html': html,
    }),
  }
  const response = await handleRequest(new Request('https://builds.example/demo-1'), env)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8')
  const body = await response.text()
  assert.match(body, /https:\/\/www\.c-point\.co/)
  assert.doesNotMatch(body, /https:\/\/c-point\.co/)
  assert.match(body, /cpoint-public-brand-override/)
  assert.match(body, /top:50%/)
  assert.match(body, /window\.open\('https:\/\/www\.c-point\.co'/)
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self' https:\/\/app\.c-point\.co/)
  assert.doesNotMatch(response.headers.get('content-security-policy'), /connect-src 'self' https:(;|$)/)
})

test('returns branded not found when a manifest is missing', async () => {
  const env = { PUBLIC_API_BASE: 'https://example.test', BUILDS_BUCKET: bucket({}) }
  const response = await handleRequest(new Request('https://builds.example/missing'), env)
  assert.equal(response.status, 404)
  const body = await response.text()
  assert.match(body, /Build not found|not available/)
  assert.match(body, /https:\/\/www\.c-point\.co/)
  assert.doesNotMatch(body, /https:\/\/c-point\.co/)
})

test('proxies public capsule reads through the backend without forwarding refresh', async () => {
  const manifest = JSON.stringify({
    status: 'published',
    artifactKey: 'public/builds/demo-1/v1.html',
  })
  const env = {
    PUBLIC_API_BASE: 'https://api.example.test',
    BUILDS_BUCKET: bucket({
      'public/builds/demo-1/manifest.json': manifest,
    }),
  }
  const originalFetch = globalThis.fetch
  let requested = null
  globalThis.fetch = async (url) => {
    requested = new URL(String(url))
    return new Response(JSON.stringify({ success: true, capsule: 'scores', data: {} }), { status: 200 })
  }
  try {
    const response = await handleRequest(
      new Request('https://builds.example/api/capsules/scores?slug=demo-1&refresh=1'),
      env,
    )
    assert.equal(response.status, 200)
    assert.equal(requested.pathname, '/api/builder/public/demo-1/capsules/scores')
    assert.equal(requested.searchParams.get('refresh'), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('does not forward public data refresh through the worker proxy', async () => {
  const manifest = JSON.stringify({
    status: 'published',
    artifactKey: 'public/builds/demo-1/v1.html',
  })
  const env = {
    PUBLIC_API_BASE: 'https://api.example.test',
    BUILDS_BUCKET: bucket({
      'public/builds/demo-1/manifest.json': manifest,
    }),
  }
  const originalFetch = globalThis.fetch
  let requested = null
  globalThis.fetch = async (url) => {
    requested = new URL(String(url))
    return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 })
  }
  try {
    const response = await handleRequest(
      new Request('https://builds.example/api/data/feed?slug=demo-1&connector=sports&params=%7B%7D&refresh=1'),
      env,
    )
    assert.equal(response.status, 200)
    assert.equal(requested.pathname, '/api/builder/public/demo-1/data/feed')
    assert.equal(requested.searchParams.get('connector'), 'sports')
    assert.equal(requested.searchParams.get('refresh'), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})
