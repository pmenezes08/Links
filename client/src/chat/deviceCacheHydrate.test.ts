import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

function readPage(name: string): string {
  return readFileSync(join(repoRoot, 'client', 'src', 'pages', name), 'utf8')
}

describe('chat thread stale device cache hydrate contract', () => {
  it('ChatThread imports readDeviceCacheStale and uses it for message hydrate', () => {
    const src = readPage('ChatThread.tsx')
    expect(src).toMatch(/readDeviceCacheStale/)
    expect(src).toMatch(/readDeviceCacheStale<\{ display_name: string; profile_picture\?: string \| null \}>\(profileCacheKey/)
    expect(src).toMatch(/readDeviceCacheStale<\{ messages: any\[]; otherUserId: number \}>\(chatCacheKey/)
    expect(src).toMatch(/mergeHydratedMessages/)
    expect(src).not.toMatch(
      /readDeviceCache<\{ messages: any\[]; otherUserId: number \}>\(chatCacheKey/,
    )
  })

  it('ChatThread network shortcut uses readDeviceCacheStale for cached otherUserId', () => {
    const src = readPage('ChatThread.tsx')
    const networkBlock = src.slice(src.indexOf('// Check if we have cached user ID'))
    expect(networkBlock).toMatch(/readDeviceCacheStale/)
    expect(networkBlock).not.toMatch(
      /readDeviceCache<\{ messages: any\[]; otherUserId: number \}>\(chatCacheKey/,
    )
  })

  it('GroupChatThread imports readDeviceCacheStale for sync seed and thread switch', () => {
    const src = readPage('GroupChatThread.tsx')
    expect(src).toMatch(/readDeviceCacheStale/)
    expect(src).toMatch(/readDeviceCacheStale<GroupInfo>/)
    expect(src).toMatch(/readDeviceCacheStale<Message\[]>/)
    expect(src).not.toMatch(/readDeviceCache<GroupInfo>\(groupInfoCacheKey/)
    expect(src).not.toMatch(/readDeviceCache<Message\[]>\(groupChatCacheKey/)
  })

  it('thread pages defer empty clears until IDB miss when device cache is empty', () => {
    const dm = readPage('ChatThread.tsx')
    expect(dm).toMatch(/if \(!painted && !cachedChat\?\.messages\?\.length\)/)
    expect(dm).toContain('notifyMessagesSettledRef.current')
    expect(dm).not.toMatch(/notifyMessagesSettled,\s*\]/)
  })
})
