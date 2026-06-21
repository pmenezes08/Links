import { describe, it, expect } from 'vitest'
import { prepareCreationHtml } from './creationHtml'

const HTML = '<!doctype html><html><head></head><body><canvas></canvas></body></html>'

describe('prepareCreationHtml', () => {
  it('always injects the viewport meta so artifacts lay out to the frame width', () => {
    const out = prepareCreationHtml(HTML)
    expect(out).toContain('name="viewport"')
    expect(out).toContain('width=device-width')
  })

  it('forces a 16px input font-size floor so iOS does not zoom on focus', () => {
    const out = prepareCreationHtml(HTML)
    expect(out).toContain('input,textarea,select{font-size:16px}')
  })

  it('injects the CPoint save/load persistence bridge when dataBridge is on', () => {
    const out = prepareCreationHtml(HTML, { dataBridge: true })
    expect(out).toContain('window.CPoint')
    expect(out).toContain('save:function')
    expect(out).toContain('load:function')
    // Feature-detect flag so generated games can show/hide save UI safely.
    expect(out).toContain('hasPersistence=true')
  })

  it('omits the data bridge entirely when dataBridge is off', () => {
    const out = prepareCreationHtml(HTML, { dataBridge: false })
    expect(out).not.toContain('window.CPoint')
    expect(out).not.toContain('hasPersistence')
  })

  it('injects the error reporter only when requested', () => {
    expect(prepareCreationHtml(HTML, { errorReporter: true })).toContain('__cperr')
    expect(prepareCreationHtml(HTML, { errorReporter: false })).not.toContain('__cperr')
  })

  it('returns falsy input unchanged', () => {
    expect(prepareCreationHtml('')).toBe('')
  })
})
