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
  const html = '<!doctype html><html><body>Demo</body></html>'
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
  assert.equal(await response.text(), html)
})

test('returns branded not found when a manifest is missing', async () => {
  const env = { PUBLIC_API_BASE: 'https://example.test', BUILDS_BUCKET: bucket({}) }
  const response = await handleRequest(new Request('https://builds.example/missing'), env)
  assert.equal(response.status, 404)
  assert.match(await response.text(), /Build not found|not available/)
})
