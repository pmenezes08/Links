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

  it('injects the CPoint public data bridge when dataBridge is on', () => {
    const out = prepareCreationHtml(HTML, { dataBridge: true })
    expect(out).toContain('data:function')
    expect(out).toContain("call('feed'")
    expect(out).toContain('hasData=true')
    expect(out).toContain('sharedState:{')
    expect(out).toContain("call('shared.get'")
    expect(out).toContain("call('collection.list'")
    expect(out).toContain('forms:{submit:function')
    expect(out).toContain('hasCreationData=true')
  })

  it('injects multiplayer bridge early with documented match return shapes', () => {
    const bootHtml = '<!doctype html><html><head></head><body><script>window.bootSawCPoint=!!window.CPoint</script></body></html>'
    const out = prepareCreationHtml(bootHtml, { dataBridge: true, startMatchId: 42 })
    expect(out.indexOf('window.CPoint')).toBeLessThan(out.indexOf('window.bootSawCPoint'))
    expect(out).toContain('hasMultiplayer=true')
    expect(out).toContain('window.CPoint.startMatchId=42')
    expect(out).toContain("create:function(handle){return callPick('match.create'")
    expect(out).toContain("get:function(id){return callPick('match.get'")
    expect(out).toContain("accept:function(id){return callPick('match.accept'")
    expect(out).toContain("cancel:function(id){return callPick('match.cancel'")
    expect(out).toContain('matchController=function')
    expect(out).toContain('hasMatchController=true')
    expect(out).toContain("phaseFor")
    expect(out).toContain("pending_sent")
    expect(out).toContain("canMove")
    expect(out).toContain("current.phase==='pending_sent'||current.phase==='opponent_turn'")
    expect(out).toContain('turnBasedGame=function')
    expect(out).toContain('hasTurnBasedGame=true')
    expect(out).toContain('initialState')
    expect(out).toContain('applyMove')
    expect(out).toContain('onOpponentMove')
    expect(out).toContain('lastMove')
    expect(out).toContain("pollMs:config.pollMs||(config.live===false?2500:1000)")
    expect(out).toContain('moves:lastMoves')
  })

  it('omits the data bridge entirely when dataBridge is off', () => {
    const out = prepareCreationHtml(HTML, { dataBridge: false })
    expect(out).not.toContain('window.CPoint')
    expect(out).not.toContain('hasPersistence')
    expect(out).not.toContain('hasData')
  })

  it('injects the error reporter only when requested', () => {
    expect(prepareCreationHtml(HTML, { errorReporter: true })).toContain('__cperr')
    expect(prepareCreationHtml(HTML, { errorReporter: false })).not.toContain('__cperr')
  })

  it('returns falsy input unchanged', () => {
    expect(prepareCreationHtml('')).toBe('')
  })
})
