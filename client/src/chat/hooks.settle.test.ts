import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { chatMessageTailUnchanged, evaluateThreadListReveal } from './threadReveal'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('evaluateThreadListReveal', () => {
  it('reveals immediately when messages exist', () => {
    expect(evaluateThreadListReveal(0)).toBe(true)
    expect(evaluateThreadListReveal(1)).toBe(true)
    expect(evaluateThreadListReveal(42)).toBe(true)
  })
})

describe('chatMessageTailUnchanged', () => {
  it('matches when length and tail id are equal', () => {
    expect(chatMessageTailUnchanged([{ id: 1 }, { id: 2 }], [{ id: 1 }, { id: 2 }])).toBe(true)
  })

  it('returns false when tail id or length differs', () => {
    expect(chatMessageTailUnchanged([{ id: 1 }], [{ id: 2 }])).toBe(false)
    expect(chatMessageTailUnchanged([{ id: 1 }], [{ id: 1 }, { id: 2 }])).toBe(false)
  })
})

describe('chat thread settle callback contract', () => {
  it('useChatThreadScroll tryRevealList does not depend on messages.length', () => {
    const hooksSrc = readFileSync(join(repoRoot, 'client', 'src', 'chat', 'hooks.ts'), 'utf8')
    const tryRevealBlock = hooksSrc.match(
      /const tryRevealList = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[(.*?)\]\)/,
    )
    expect(tryRevealBlock, 'tryRevealList useCallback').toBeTruthy()
    expect(tryRevealBlock![1].trim()).toBe('')
  })

  it('thread pages call notifyMessagesSettled via ref, not in effect deps', () => {
    for (const page of ['ChatThread.tsx', 'GroupChatThread.tsx']) {
      const src = readFileSync(join(repoRoot, 'client', 'src', 'pages', page), 'utf8')
      expect(src).toContain('notifyMessagesSettledRef')
      expect(src).toContain('notifyMessagesSettledRef.current')
      const initialLoadEffect = src.match(
        /\/\/ Initial load[\s\S]*?useEffect\(\(\) => \{[\s\S]*?\}, \[([^\]]*)\]\)/,
      )
      if (initialLoadEffect) {
        expect(initialLoadEffect[1]).not.toMatch(/\bnotifyMessagesSettled\b/)
      }
    }
  })
})
