/**
 * Steve sender badge on DM bubbles.
 *
 * A 1:1 DM renders no sender name — the sender is implied by which side the
 * bubble sits on. So when Steve answers an @Steve mention *inside* a human
 * DM (rows tagged with `human_dm_thread`, flagged `is_steve` in the payload),
 * his reply is visually identical to the human peer's messages and the reader
 * cannot tell who is talking. These tests pin the badge's presence rules.
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import MessageBubble from './MessageBubble'
import type { MessageBubbleProps } from './MessageBubble'

type Msg = MessageBubbleProps['message']

function renderBubble(message: Partial<Msg>, otherUsername = 'bob') {
  const props: MessageBubbleProps = {
    message: {
      id: 1,
      text: 'hello there',
      sent: false,
      time: '2026-07-28T12:00:00.000Z',
      ...message,
    } as Msg,
    isEditing: false,
    editText: '',
    editingSaving: false,
    otherDisplayName: 'Bob',
    otherUsername,
    onDelete: () => {},
    onReact: () => {},
    onReply: () => {},
    onCopy: () => {},
    onEditTextChange: () => {},
    onCommitEdit: () => {},
    onCancelEdit: () => {},
    onImageClick: () => {},
  }
  return render(<MessageBubble {...props} />)
}

describe('MessageBubble Steve badge', () => {
  it('badges Steve\'s in-thread reply inside a human DM', () => {
    renderBubble({ is_steve: true, text: 'Here is what I found' })
    expect(screen.getByText('Steve')).toBeTruthy()
  })

  it('leaves the human peer\'s messages unbadged', () => {
    // Badging a peer row would misattribute a real person's message to Steve.
    renderBubble({ is_steve: false, text: 'my own words' })
    expect(screen.queryByText('Steve')).toBeNull()
  })

  it('omits the badge in the private Steve chat, where every row is Steve', () => {
    renderBubble({ is_steve: true, text: 'private answer' }, 'steve')
    expect(screen.queryByText('Steve')).toBeNull()
  })

  it('never badges the viewer\'s own outgoing messages', () => {
    renderBubble({ is_steve: true, sent: true, text: 'my message' })
    expect(screen.queryByText('Steve')).toBeNull()
  })

  it('badges a media-only Steve reply (no text bubble to attribute it)', () => {
    renderBubble({ is_steve: true, text: '', image_path: 'uploads/x.jpg' })
    expect(screen.getByText('Steve')).toBeTruthy()
  })
})
