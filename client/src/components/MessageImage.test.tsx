import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import MessageImage from './MessageImage'
import { recordImageDims, __resetImageDimsCacheForTest } from '../utils/imageDimsCache'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

beforeEach(() => {
  localStorage.clear()
  __resetImageDimsCacheForTest()
})

describe('MessageImage', () => {
  it('reserves the cached aspect ratio so the row does not collapse-then-grow', () => {
    recordImageDims('https://media.example/pic.jpg', 800, 400)
    const { container } = render(<MessageImage src="https://media.example/pic.jpg" alt="pic" />)
    expect((container.firstChild as HTMLElement).style.aspectRatio).toBe('800 / 400')
  })

  it('does not reserve when dimensions are unknown (first view)', () => {
    const { container } = render(<MessageImage src="https://media.example/unseen.jpg" alt="pic" />)
    expect((container.firstChild as HTMLElement).style.aspectRatio).toBe('')
  })
})
