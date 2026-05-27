/**
 * Inverted (column-reverse) chat list — DOM and scroll-semantic contract.
 *
 * The page wraps `<ChatVirtualMessageList />` in a scroll container whose
 * `flex-direction` is `column-reverse`. That makes `scrollTop = 0` correspond
 * to the visual bottom (newest message above the composer), so the latest
 * message is positioned correctly from the first paint frame without any JS
 * pinning.
 */

import { useRef } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { ChatVirtualMessageList } from './ChatVirtualMessageList'

type Msg = { id: number; clientKey: string; text: string }

function makeMessages(n: number): Msg[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    clientKey: `m${i + 1}`,
    text: `msg-${i + 1}`,
  }))
}

function Harness({ messages }: { messages: Msg[] }) {
  const messageStackRef = useRef<HTMLDivElement | null>(null)
  return (
    <div
      data-testid="scroll-container"
      style={{ display: 'flex', flexDirection: 'column-reverse', overflowY: 'auto' }}
    >
      <ChatVirtualMessageList
        messages={messages}
        messageStackRef={messageStackRef}
        lastMessageRef={() => {}}
        className="msg-stack"
        itemKey={(m) => m.clientKey}
        renderItem={(m) => <div data-testid={`bubble-${m.clientKey}`}>{m.text}</div>}
        footer={<div data-testid="typing">typing</div>}
      />
    </div>
  )
}

describe('ChatVirtualMessageList (inverted)', () => {
  it('renders messages in natural (oldest → newest) DOM order so column-reverse parent shows newest at the visual bottom', () => {
    const messages = makeMessages(3)
    const { getAllByTestId } = render(<Harness messages={messages} />)
    const bubbles = getAllByTestId(/^bubble-/)
    expect(bubbles.map((b) => b.getAttribute('data-testid'))).toEqual([
      'bubble-m1',
      'bubble-m2',
      'bubble-m3',
    ])
  })

  it('renders the typing footer after the last message in DOM order (visual bottom)', () => {
    const messages = makeMessages(2)
    const { getByTestId } = render(<Harness messages={messages} />)
    const stack = getByTestId('typing').parentElement as HTMLElement
    const children = Array.from(stack.children) as HTMLElement[]
    expect(children[children.length - 1].getAttribute('data-testid')).toBe('typing')
    expect(children[children.length - 2].textContent).toBe('msg-2')
  })

  it('renders nothing extra when the message list is empty', () => {
    const { queryAllByTestId } = render(<Harness messages={[]} />)
    expect(queryAllByTestId(/^bubble-/).length).toBe(0)
  })
})
