import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function readPage(name: string): string {
  return readFileSync(join(repoRoot, 'client', 'src', 'pages', name), 'utf8')
}

describe('chat thread stale device cache hydrate contract', () => {
  it('ChatThread uses shared threadDeviceCache kernel and useLayoutEffect thread switch', () => {
    const src = readPage('ChatThread.tsx')
    expect(src).toMatch(/readStaleDeviceCache/)
    expect(src).toMatch(/paintDmCacheMessages/)
    expect(src).toMatch(/hydrateThreadFromIndexedDb/)
    expect(src).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*threadGenerationRef\.current \+= 1/)
    expect(src).toMatch(/mergeHydratedMessages/)
    expect(src).not.toMatch(/readDeviceCacheStale/)
  })

  it('ChatThread network shortcut uses readStaleDeviceCache for cached otherUserId', () => {
    const src = readPage('ChatThread.tsx')
    const networkBlock = src.slice(src.indexOf('// Check if we have cached user ID'))
    expect(networkBlock).toMatch(/readStaleDeviceCache/)
  })

  it('GroupChatThread uses shared threadDeviceCache kernel for sync seed and thread switch', () => {
    const src = readPage('GroupChatThread.tsx')
    expect(src).toMatch(/readStaleDeviceCache/)
    expect(src).toMatch(/markThreadCachePainted/)
    expect(src).toMatch(/hydrateThreadFromIndexedDb/)
    expect(src).not.toMatch(/readDeviceCacheStale/)
  })

  it('thread pages defer empty clears until IDB miss when device cache is empty', () => {
    const dm = readPage('ChatThread.tsx')
    expect(dm).toMatch(/hydrateThreadFromIndexedDb/)
    expect(dm).toMatch(/onEmpty:/)
    expect(dm).toContain('notifyMessagesSettledRef.current')
    expect(dm).not.toMatch(/notifyMessagesSettled,\s*\]/)
  })
})
