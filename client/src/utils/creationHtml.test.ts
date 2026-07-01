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
    expect(out).toContain('refresh:!!(opts&&opts.refresh)')
    expect(out).toContain("call('feed'")
    expect(out).toContain('hasData=true')
    expect(out).toContain('sharedState:{')
    expect(out).toContain("call('shared.get'")
    expect(out).toContain("call('collection.list'")
    expect(out).toContain('forms:{submit:function')
    expect(out).toContain('hasCreationData=true')
  })

  it('injects the CPoint capsule bridge when dataBridge is on', () => {
    const out = prepareCreationHtml(HTML, { dataBridge: true })
    expect(out).toContain('capsule:function')
    expect(out).toContain("call('capsule.get',{name:name,refresh:false})")
    expect(out).toContain("call('capsule.get',{name:name,refresh:true})")
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
    // Cadence by phase: fast while waiting on the opponent, slow on your own
    // turn / received invites / lobby (resigns + accepts + invites surface).
    expect(out).toContain("if(ph==='pending_sent'||ph==='opponent_turn') return FAST")
    expect(out).toContain("if(ph==='your_turn'||ph==='pending_received') return SLOW")
    expect(out).toContain('lobbyOn?LOBBY:0')
    expect(out).toContain('turnBasedGame=function')
    expect(out).toContain('hasTurnBasedGame=true')
    expect(out).toContain('initialState')
    expect(out).toContain('applyMove')
    expect(out).toContain('onOpponentMove')
    expect(out).toContain('lastMove')
    expect(out).toContain("pollMs:config.pollMs||(config.live===false?2500:1000)")
    expect(out).toContain('moves:lastMoves')
  })

  it('hardens the match runtime against poll death, overlap, and stale conflicts', () => {
    const out = prepareCreationHtml(HTML, { dataBridge: true })
    // Self-chaining timeout loop with a generation token — no overlapping ticks,
    // superseded work is discarded, and a failed reload retries with backoff.
    expect(out).toContain('var g=++gen')
    expect(out).toContain('if(g!==gen') // stale completions discarded
    expect(out).toContain('timer=setTimeout(tick,d)')
    expect(out).toContain('Math.min(1000*(failures+1),MAXBACK)') // reload retry backoff — polling never dies
    // Conflict-absorbing submit: reload + retry once on stale_version/not_your_turn.
    expect(out).toContain("msg==='stale_version'||msg==='not_your_turn'")
  })

  it('injects the host-owned lobby contract for turn-based games', () => {
    const on = prepareCreationHtml(HTML, { dataBridge: true, hostLobby: true })
    expect(on).toContain('window.CPoint.hostLobby=true')
    expect(on).toContain('__cpmp') // runtime announces ready/lobby to the host
    expect(on).toContain('__cpmp_open') // host hands a picked match to the iframe
    const off = prepareCreationHtml(HTML, { dataBridge: true })
    expect(off).toContain('window.CPoint.hostLobby=false')
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
