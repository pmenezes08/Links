import { describe, expect, it } from 'vitest'
import {
  mergeDocumentFields,
  messagePollSignature,
  retainMessagesIfUnchanged,
  shouldRetainOptimisticDuringUpload,
  tryMatchDocumentOptimistic,
} from './dmPollMerge'

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
})
