import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useEdgeSwipeBack } from './useEdgeSwipeBack'

const UNDERLAY_ID = 'chat-edge-swipe-underlay'
const EXIT_OVERLAY_ID = 'chat-edge-swipe-exit'

function Harness({ onBack, enabled = true }: { onBack: () => void; enabled?: boolean }) {
  const ref = useEdgeSwipeBack({ onBack, enabled })
  return (
    <div ref={ref} data-testid="page">
      <div className="chat-list-inset" data-testid="list" />
      <button data-testid="edge-button">tap me</button>
    </div>
  )
}

type PointerOpts = {
  x: number
  y?: number
  t?: number
  id?: number
  pointerType?: string
  isPrimary?: boolean
}

function firePointer(el: Element, type: string, opts: PointerOpts) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.x,
    clientY: opts.y ?? 200,
  })
  Object.defineProperty(event, 'pointerId', { value: opts.id ?? 1 })
  Object.defineProperty(event, 'pointerType', { value: opts.pointerType ?? 'touch' })
  Object.defineProperty(event, 'isPrimary', { value: opts.isPrimary ?? true })
  if (opts.t !== undefined) Object.defineProperty(event, 'timeStamp', { value: opts.t })
  el.dispatchEvent(event)
  return event
}

function fireTouchMove(el: Element, x: number, y: number) {
  const event = new Event('touchmove', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] })
  el.dispatchEvent(event)
  return event
}

/** Slow drag from the edge to `endX` — velocity stays below every flick gate. */
function slowDragTo(el: Element, endX: number) {
  firePointer(el, 'pointerdown', { x: 10, t: 0 })
  const steps = 4
  for (let i = 1; i <= steps; i++) {
    const x = 10 + ((endX - 10) * i) / steps
    firePointer(el, 'pointermove', { x, t: i * 400 })
  }
}

describe('useEdgeSwipeBack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.getElementById(UNDERLAY_ID)?.remove()
    document.getElementById(EXIT_OVERLAY_ID)?.remove()
    document.querySelectorAll('.chat-composer-smooth').forEach(el => el.remove())
  })

  it('arms only from the left edge', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    firePointer(page, 'pointerdown', { x: 200, t: 0 })
    firePointer(page, 'pointermove', { x: 260, t: 100 })
    expect(page.style.transform).toBe('')

    firePointer(page, 'pointerdown', { x: 10, t: 0 })
    firePointer(page, 'pointermove', { x: 40, t: 200 })
    expect(page.style.transform).toBe('translate3d(30px, 0, 0)')
    expect(page.style.willChange).toBe('transform')
    expect(document.getElementById(UNDERLAY_ID)).toBeTruthy()
  })

  it('ignores mouse pointers and interactive targets', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    firePointer(page, 'pointerdown', { x: 10, t: 0, pointerType: 'mouse' })
    firePointer(page, 'pointermove', { x: 60, t: 100, pointerType: 'mouse' })
    expect(page.style.transform).toBe('')

    const button = getByTestId('edge-button')
    firePointer(button, 'pointerdown', { x: 10, t: 0 })
    firePointer(button, 'pointermove', { x: 60, t: 100 })
    expect(page.style.transform).toBe('')
  })

  it('hands vertical intent back to the scroller', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    firePointer(page, 'pointerdown', { x: 10, y: 200, t: 0 })
    firePointer(page, 'pointermove', { x: 12, y: 260, t: 50 })
    firePointer(page, 'pointermove', { x: 80, y: 260, t: 100 })
    expect(page.style.transform).toBe('')
  })

  it('translates the portaled composer alongside the page', () => {
    const composer = document.createElement('div')
    composer.className = 'chat-composer-smooth left-1/2'
    document.body.appendChild(composer)
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    firePointer(page, 'pointerdown', { x: 10, t: 0 })
    firePointer(page, 'pointermove', { x: 50, t: 200 })
    expect(composer.style.transform).toBe('translateX(calc(-50% + 40px))')
  })

  it('commit past the distance threshold navigates synchronously and slides a clone off', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    // jsdom viewport is 1024 wide → threshold ≈ 287px.
    slowDragTo(page, 400)
    firePointer(page, 'pointerup', { x: 400, t: 2000 })

    // Navigation is synchronous — before any timer runs.
    expect(onBack).toHaveBeenCalledTimes(1)
    // The live page is left at rest, never translated.
    expect(page.style.transform).toBe('')
    // The exit clone starts at the release offset and animates to the width.
    const overlay = document.getElementById(EXIT_OVERLAY_ID)
    expect(overlay).toBeTruthy()
    const clone = overlay?.firstElementChild as HTMLElement
    expect(clone.style.transition).toContain('transform')
    expect(clone.style.transform).toBe('translate3d(1024px, 0, 0)')

    vi.advanceTimersByTime(1000)
    expect(document.getElementById(EXIT_OVERLAY_ID)).toBeNull()
    expect(document.getElementById(UNDERLAY_ID)).toBeNull()
  })

  it('a rightward flick commits below the distance threshold', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    firePointer(page, 'pointerdown', { x: 10, t: 0 })
    firePointer(page, 'pointermove', { x: 40, t: 16 })
    firePointer(page, 'pointermove', { x: 80, t: 32 })
    firePointer(page, 'pointermove', { x: 130, t: 48 })
    firePointer(page, 'pointerup', { x: 130, t: 64 })
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('a leftward flick cancels even past the distance threshold', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    slowDragTo(page, 420)
    firePointer(page, 'pointermove', { x: 395, t: 1610 })
    firePointer(page, 'pointermove', { x: 365, t: 1620 })
    firePointer(page, 'pointermove', { x: 330, t: 1630 })
    firePointer(page, 'pointerup', { x: 330, t: 1640 })
    expect(onBack).not.toHaveBeenCalled()
  })

  it('a short drag springs home and restores the DOM to rest', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    slowDragTo(page, 100)
    firePointer(page, 'pointerup', { x: 100, t: 2000 })
    expect(onBack).not.toHaveBeenCalled()
    expect(page.style.transition).toContain('transform')
    expect(page.style.transform).toBe('')

    vi.advanceTimersByTime(500)
    expect(page.style.willChange).toBe('')
    expect(page.style.boxShadow).toBe('')
    expect(page.style.zIndex).toBe('')
    expect(document.getElementById(UNDERLAY_ID)).toBeNull()
  })

  it('pointercancel mid-drag springs home', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    slowDragTo(page, 200)
    firePointer(page, 'pointercancel', { x: 200, t: 2000 })
    expect(onBack).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(page.style.transform).toBe('')
    expect(document.getElementById(UNDERLAY_ID)).toBeNull()
  })

  it('prevents horizontal-leaning touchmoves while armed, passes vertical ones', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    firePointer(page, 'pointerdown', { x: 10, y: 200, t: 0 })
    const horizontal = fireTouchMove(page, 18, 202)
    expect(horizontal.defaultPrevented).toBe(true)
    const vertical = fireTouchMove(page, 12, 230)
    expect(vertical.defaultPrevented).toBe(false)

    // Once locked, every frame is prevented regardless of direction.
    firePointer(page, 'pointermove', { x: 60, t: 100 })
    const locked = fireTouchMove(page, 60, 260)
    expect(locked.defaultPrevented).toBe(true)
  })

  it('without an armed gesture touchmoves are untouched', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')
    const move = fireTouchMove(page, 100, 100)
    expect(move.defaultPrevented).toBe(false)
  })

  it('detaches the blocking touchmove listener after release and after vertical hand-back', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    // Released gesture: nothing left armed → later touchmoves untouched.
    slowDragTo(page, 100)
    firePointer(page, 'pointerup', { x: 100, t: 2000 })
    vi.advanceTimersByTime(500)
    const afterRelease = fireTouchMove(page, 30, 202)
    expect(afterRelease.defaultPrevented).toBe(false)

    // Vertical hand-back: disarmed mid-decision → later touchmoves untouched.
    firePointer(page, 'pointerdown', { x: 10, y: 200, t: 3000 })
    firePointer(page, 'pointermove', { x: 12, y: 260, t: 3050 })
    const afterHandBack = fireTouchMove(page, 40, 202)
    expect(afterHandBack.defaultPrevented).toBe(false)
  })

  it('vertical hand-back demotes the speculative layer promotion', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    firePointer(page, 'pointerdown', { x: 10, y: 200, t: 0 })
    expect(page.style.willChange).toBe('transform')
    firePointer(page, 'pointermove', { x: 12, y: 260, t: 50 })
    expect(page.style.willChange).toBe('')
  })

  it('the exit clone prunes rows fully above the viewport and disarms media', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')
    const list = getByTestId('list')

    for (const [id, bottom] of [['above', -300], ['visible', 400]] as const) {
      const row = document.createElement('div')
      row.setAttribute('data-message-id', id)
      row.getBoundingClientRect = () =>
        ({ bottom, top: bottom - 40, left: 0, right: 0, width: 0, height: 40 }) as DOMRect
      const video = document.createElement('video')
      video.src = 'https://example.com/clip.mp4'
      row.appendChild(video)
      list.appendChild(row)
    }

    slowDragTo(page, 400)
    firePointer(page, 'pointerup', { x: 400, t: 2000 })
    const overlay = document.getElementById(EXIT_OVERLAY_ID)
    expect(overlay).toBeTruthy()
    const cloneRows = overlay!.querySelectorAll('[data-message-id]')
    expect(Array.from(cloneRows).map(r => r.getAttribute('data-message-id'))).toEqual(['visible'])
    overlay!.querySelectorAll('video').forEach(v => {
      expect(v.getAttribute('src')).toBeNull()
      expect(v.getAttribute('preload')).toBe('none')
    })
    // The live rows are untouched.
    expect(page.querySelectorAll('[data-message-id]').length).toBe(2)
    vi.advanceTimersByTime(1200)
  })

  it('the card can be caught mid-spring and re-dragged', () => {
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    slowDragTo(page, 200)
    firePointer(page, 'pointerup', { x: 200, t: 2000 })
    expect(onBack).not.toHaveBeenCalled()

    // Mid-spring the computed transform reports the animated position.
    const original = window.getComputedStyle.bind(window)
    const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((el: Element) => {
      const style = original(el)
      if (el === page) {
        return new Proxy(style, {
          get: (target, prop) =>
            prop === 'transform' ? 'matrix(1, 0, 0, 1, 150, 0)' : Reflect.get(target, prop),
        }) as CSSStyleDeclaration
      }
      return style
    })

    // Catch anywhere on screen while settling — not just the edge.
    firePointer(page, 'pointerdown', { x: 300, t: 2100 })
    spy.mockRestore()
    firePointer(page, 'pointermove', { x: 320, t: 2200 })
    expect(page.style.transform).toBe('translate3d(170px, 0, 0)')

    firePointer(page, 'pointerup', { x: 320, t: 2400 })
    expect(onBack).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(page.style.transform).toBe('')
  })

  it('reduced motion commits without any exit overlay', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }))
    const onBack = vi.fn()
    const { getByTestId } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    slowDragTo(page, 400)
    firePointer(page, 'pointerup', { x: 400, t: 2000 })
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(document.getElementById(EXIT_OVERLAY_ID)).toBeNull()
    expect(document.getElementById(UNDERLAY_ID)).toBeNull()
    expect(page.style.transform).toBe('')
  })

  it('unmount mid-drag restores the DOM', () => {
    const onBack = vi.fn()
    const { getByTestId, unmount } = render(<Harness onBack={onBack} />)
    const page = getByTestId('page')

    slowDragTo(page, 150)
    unmount()
    expect(document.getElementById(UNDERLAY_ID)).toBeNull()
  })
})
