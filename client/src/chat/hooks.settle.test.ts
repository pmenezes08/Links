import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { chatMessageTailUnchanged } from './threadReveal'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('chatMessageTailUnchanged', () => {
  it('matches when length and tail id are equal', () => {
    expect(chatMessageTailUnchanged([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }])).toBe(true)
  })

  it('returns false when tail id or length differs', () => {
    expect(chatMessageTailUnchanged([{ id: 1 }], [{ id: 2 }])).toBe(false)
    expect(chatMessageTailUnchanged([{ id: 1 }], [{ id: 1 }, { id: 2 }])).toBe(false)
  })
})

describe('chat thread inverted-list invariants', () => {
  it('useChatThreadScroll does not pin or reveal on open (no timers, no fastOpen)', () => {
    const hooksSrc = readFileSync(join(repoRoot, 'client', 'src', 'chat', 'hooks.ts'), 'utf8')

    // No open-pin lock timers.
    expect(hooksSrc).not.toMatch(/revealTimer/)
    expect(hooksSrc).not.toMatch(/pinUnlockTimer/)
    expect(hooksSrc).not.toMatch(/openPinDeadlineRef/)

    // No fastOpen / reveal-ready plumbing.
    expect(hooksSrc).not.toMatch(/listRevealReady/)
    expect(hooksSrc).not.toMatch(/listOpening/)
    expect(hooksSrc).not.toMatch(/fastOpen/)

    // No legacy "tryRevealList" callback.
    expect(hooksSrc).not.toMatch(/tryRevealList/)

    // Uses inverted-list helpers.
    expect(hooksSrc).toMatch(/pinInvertedToBottom/)
    expect(hooksSrc).toMatch(/isInvertedAtBottom/)
  })

  it('useChatThreadChrome does not plumb snapListInset / fastOpen', () => {
    const src = readFileSync(
      join(repoRoot, 'client', 'src', 'chat', 'useChatThreadChrome.ts'),
      'utf8',
    )
    expect(src).not.toMatch(/snapListInset/)
    expect(src).not.toMatch(/fastOpen/)
  })

  it('useChatListScrollHandlers reads inverted scrollTop semantics', () => {
    const src = readFileSync(
      join(repoRoot, 'client', 'src', 'chat', 'useChatListScrollHandlers.ts'),
      'utf8',
    )
    // Open-pin lock plumbing is gone.
    expect(src).not.toMatch(/initialPinActiveRef/)
    expect(src).not.toMatch(/programmaticScrollRef/)
    expect(src).not.toMatch(/openPinLocked/)
    // Uses inverted helpers.
    expect(src).toMatch(/distanceFromInvertedBottom/)
    expect(src).toMatch(/distanceFromInvertedTop/)
  })

  it('ChatThreadShell scroll container is column-reverse with no opacity/visibility reveal', () => {
    const src = readFileSync(join(repoRoot, 'client', 'src', 'chat', 'ChatThreadShell.tsx'), 'utf8')
    expect(src).toMatch(/flexDirection:\s*'column-reverse'/)
    expect(src).not.toMatch(/listRevealReady/)
    expect(src).not.toMatch(/listOpening/)
    expect(src).not.toMatch(/chat-list-opening/)
  })

  it('thread pages render the list with column-reverse and no reveal gate', () => {
    for (const page of ['ChatThread.tsx', 'GroupChatThread.tsx']) {
      const src = readFileSync(join(repoRoot, 'client', 'src', 'pages', page), 'utf8')
      expect(src).toMatch(/flexDirection:\s*'column-reverse'/)
      expect(src).not.toMatch(/listRevealReady/)
      expect(src).not.toMatch(/listOpening/)
      expect(src).not.toMatch(/cacheFastOpen/)
      expect(src).not.toMatch(/chat-list-opening/)
      // notifyMessagesSettled is still funneled through a ref to avoid effect-dep churn.
      expect(src).toContain('notifyMessagesSettledRef')
      expect(src).toContain('notifyMessagesSettledRef.current')
    }
  })

  it('thread pages call the smooth scroll helper from the FAB / new-messages chip', () => {
    for (const page of ['ChatThread.tsx', 'GroupChatThread.tsx']) {
      const src = readFileSync(join(repoRoot, 'client', 'src', 'pages', page), 'utf8')
      expect(src).toMatch(/scrollToBottomSmooth\(\)/)
    }
  })
})
