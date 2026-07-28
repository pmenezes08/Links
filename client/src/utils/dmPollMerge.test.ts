import { describe, expect, it } from 'vitest'
import {
  mergeDocumentFields,
  messagePollSignature,
  retainMessagesIfUnchanged,
  shouldRetainOptimisticDuringUpload,
  tryMatchDocumentOptimistic,
} from './dmPollMerge'
import { mergePolledDmMessages } from './dmPollMergeMessages'

describe('dmPollMerge', () => {
  it('mergeDocumentFields prefers server path but keeps existing when server omits', () => {
    expect(
      mergeDocumentFields(
        { file_path: 'https://cdn.example/doc.pdf', file_name: 'doc.pdf' },
        { file_path: 'blob:abc', file_name: 'old.pdf' },
      ),
    ).toEqual({ file_path: 'https://cdn.example/doc.pdf', file_name: 'doc.pdf' })

    expect(
      mergeDocumentFields(
        { file_path: null, file_name: null },
        { file_path: 'blob:abc', file_name: 'keep.pdf' },
      ),
    ).toEqual({ file_path: 'blob:abc', file_name: 'keep.pdf' })
  })

  it('tryMatchDocumentOptimistic bridges blob PDF to server row by time', () => {
    const optimistic = {
      sent: true,
      file_path: 'blob:http://local/fake',
      file_name: 'brief.pdf',
      isOptimistic: true,
      time: '2026-05-25T12:00:00.000Z',
    }
    expect(
      tryMatchDocumentOptimistic(
        {
          time: '2026-05-25T12:00:02.000Z',
          file_path: 'https://cdn.example/brief.pdf',
          file_name: 'brief.pdf',
        },
        optimistic,
        true,
      ),
    ).toBe(true)
  })

  it('shouldRetainOptimisticDuringUpload keeps in-flight PDF uploads longer', () => {
    const now = Date.parse('2026-05-25T12:01:00.000Z')
    const msg = {
      isOptimistic: true,
      file_path: 'blob:http://local/pdf',
      file_name: 'big.pdf',
      time: '2026-05-25T12:00:30.000Z',
    }
    expect(shouldRetainOptimisticDuringUpload(msg, now)).toBe(true)
    expect(shouldRetainOptimisticDuringUpload({ ...msg, time: '2026-05-25T11:00:00.000Z' }, now)).toBe(false)
  })

  it('retainMessagesIfUnchanged keeps prev ref when poll payload is identical', () => {
    const prev = [{ id: 1, text: 'hi', sent: true }]
    const next = [{ id: 1, text: 'hi', sent: true }]
    expect(retainMessagesIfUnchanged(prev, next, messagePollSignature)).toBe(prev)
  })

  it('mergePolledDmMessages updates reaction on existing id (full sync)', () => {
    const prev = [
      { id: 10, text: 'hello', reaction: null, sent: false, time: '2026-05-26T12:00:00.000Z', clientKey: '10' },
    ]
    const next = mergePolledDmMessages(
      prev,
      [{ id: 10, text: 'hello', reaction: '👍', sent: false, time: '2026-05-26T12:00:00.000Z' }],
      {
        username: 'bob',
        metaRef: {},
        idBridge: { tempToServer: new Map(), serverToTemp: new Map() },
        recentOptimistic: new Map(),
        pendingDeletions: new Set(),
        storedReactions: {},
      },
    )
    expect(next).not.toBe(prev)
    expect(next[0].reaction).toBe('👍')
  })

  it('messagePollSignature reacts to is_steve so the badge can appear on a cached row', () => {
    // A thread painted from a device cache written before is_steve existed has
    // rows without the flag. The poll supplies it; if the signature ignored it,
    // retainMessagesIfUnchanged would keep the old array and the Steve badge
    // would never render until the cache expired.
    const withoutFlag = { id: 5, text: 'in-thread reply', sent: false }
    const withFlag = { id: 5, text: 'in-thread reply', sent: false, is_steve: true }
    expect(messagePollSignature(withoutFlag)).not.toBe(messagePollSignature(withFlag))
    expect(retainMessagesIfUnchanged([withoutFlag], [withFlag], messagePollSignature)).toEqual([
      withFlag,
    ])
  })

  it('mergePolledDmMessages carries is_steve through so in-thread replies stay attributed', () => {
    const prev = [
      { id: 20, text: 'steve answer', sent: false, time: '2026-07-28T12:00:00.000Z', clientKey: '20' },
    ]
    const next = mergePolledDmMessages(
      prev,
      [
        {
          id: 20,
          text: 'steve answer',
          sent: false,
          is_steve: true,
          time: '2026-07-28T12:00:00.000Z',
        },
      ],
      {
        username: 'bob',
        metaRef: {},
        idBridge: { tempToServer: new Map(), serverToTemp: new Map() },
        recentOptimistic: new Map(),
        pendingDeletions: new Set(),
        storedReactions: {},
      },
    )
    expect((next[0] as { is_steve?: boolean }).is_steve).toBe(true)
  })

  it('mergePolledDmMessages keeps prev ref when server delta is unchanged', () => {
    const prev = [
      { id: 10, text: 'hello', reaction: '👍', sent: false, time: '2026-05-26T12:00:00.000Z', clientKey: '10' },
    ]
    const next = mergePolledDmMessages(prev, [], {
      username: 'bob',
      metaRef: {},
      idBridge: { tempToServer: new Map(), serverToTemp: new Map() },
      recentOptimistic: new Map(),
      pendingDeletions: new Set(),
      storedReactions: {},
    })
    expect(next).toBe(prev)
  })
})
