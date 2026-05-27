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
    // Scroll-to-dismiss when reading history.
    expect(src).toMatch(/dismissComposerKeyboard/)
  })

  it('useTouchDismiss exposes pointer-move scroll dismiss', () => {
    const src = readFileSync(join(repoRoot, 'client', 'src', 'chat', 'hooks.ts'), 'utf8')
    expect(src).toMatch(/CHAT_TOUCH_DISMISS_MOVE_PX/)
    expect(src).toMatch(/handleContentPointerMove/)
  })

  it('thread pages wire scroll-to-dismiss pointer move on the list', () => {
    for (const page of ['ChatThread.tsx', 'GroupChatThread.tsx']) {
      const src = readFileSync(join(repoRoot, 'client', 'src', 'pages', page), 'utf8')
      expect(src).toContain('handleContentPointerMove')
      expect(src).toContain('onPointerMove={handleContentPointerMove}')
    }
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

  it('useChatComposerChrome exposes insetMotionIdle gated on keyboard fully closed', () => {
    const src = readFileSync(
      join(repoRoot, 'client', 'src', 'chat', 'useChatComposerChrome.ts'),
      'utf8',
    )
    expect(src).toMatch(/insetMotionIdle/)
    // Gate must reference all three signals: no Android keyboard, no native
    // keyboardLift, and no iOS smoothing tail (displayKeyboardLift ~ 0).
    expect(src).toMatch(/!androidKeyboardOpen/)
    expect(src).toMatch(/keyboardLift === 0/)
    expect(src).toMatch(/displayKeyboardLift/)
  })

  it('ChatThreadShell applies chat-list-idle-smooth when insetMotionIdle is true', () => {
    const src = readFileSync(
      join(repoRoot, 'client', 'src', 'chat', 'ChatThreadShell.tsx'),
      'utf8',
    )
    expect(src).toMatch(/insetMotionIdle/)
    expect(src).toMatch(/chat-list-idle-smooth/)
  })

  it('thread pages wire chat-list-idle-smooth from insetMotionIdle', () => {
    for (const page of ['ChatThread.tsx', 'GroupChatThread.tsx']) {
      const src = readFileSync(join(repoRoot, 'client', 'src', 'pages', page), 'utf8')
      expect(src).toContain('insetMotionIdle')
      expect(src).toContain('chat-list-idle-smooth')
    }
  })

  it('chat-list-idle-smooth CSS is gated by prefers-reduced-motion', () => {
    const src = readFileSync(join(repoRoot, 'client', 'src', 'index.css'), 'utf8')
    expect(src).toMatch(/\.chat-list-idle-smooth\s*\{/)
    expect(src).toMatch(/transition:\s*[\s\S]*padding-bottom\s+250ms/)
    expect(src).toMatch(/prefers-reduced-motion[\s\S]*chat-list-idle-smooth[\s\S]*transition:\s*none/)
  })

  it('useChatComposerChrome caches measured composer height per surface', () => {
    const src = readFileSync(
      join(repoRoot, 'client', 'src', 'chat', 'useChatComposerChrome.ts'),
      'utf8',
    )
    expect(src).toMatch(/ChatComposerSurfaceKey/)
    expect(src).toMatch(/cachedComposerHeightBySurface/)
    expect(src).toMatch(/--chat-composer-height-\$\{surface\}/)
    // No legacy single-global cache symbols left behind.
    expect(src).not.toMatch(/cachedMeasuredComposerHeight\s*=/)
    expect(src).not.toMatch(/--chat-composer-height['"`)\s]/)
  })

  it('thread pages pass surfaceKey to useChatThreadChrome (dm + group)', () => {
    const dm = readFileSync(join(repoRoot, 'client', 'src', 'pages', 'ChatThread.tsx'), 'utf8')
    const group = readFileSync(
      join(repoRoot, 'client', 'src', 'pages', 'GroupChatThread.tsx'),
      'utf8',
    )
    expect(dm).toMatch(/surfaceKey:\s*'dm'/)
    expect(group).toMatch(/surfaceKey:\s*'group'/)
  })
})
