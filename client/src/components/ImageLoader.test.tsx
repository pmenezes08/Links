import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import ImageLoader from './ImageLoader'

describe('ImageLoader', () => {
  it('routes a c-point.co image through the Cloudflare resizer at the requested width', () => {
    const { getByAltText } = render(
      <ImageLoader src="https://app.c-point.co/uploads/x.jpg" alt="pic" targetWidth={640} />,
    )
    const src = (getByAltText('pic') as HTMLImageElement).getAttribute('src') || ''
    expect(src).toContain('/cdn-cgi/image/')
    expect(src).toContain('width=640')
  })

  it('passes an off-zone R2 url through unchanged (resizer cannot pull cross-zone)', () => {
    const url = 'https://pub-abc123.r2.dev/x.jpg'
    const { getByAltText } = render(<ImageLoader src={url} alt="pic2" />)
    expect((getByAltText('pic2') as HTMLImageElement).getAttribute('src')).toBe(url)
  })
})
