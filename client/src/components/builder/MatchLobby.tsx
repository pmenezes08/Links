import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Native, host-owned multiplayer lobby for turn-based creations.
 *
 * Generated games built on CPoint.turnBasedGame no longer render their own
 * lobby: the runtime announces itself (__cpmp ready/lobby) and this overlay
 * owns opponents, invites (accept/decline/cancel), and your games — identical
 * UX for every game, immune to generation bugs. Picking a match hands it to
 * the iframe via a __cpmp_open message.
 *
 * Auto-refreshes while visible so incoming invites and accepts appear without
 * a manual reload.
 */

export type LobbyMatch = {
  id: number
  status: string
  your_seat?: number
  your_turn?: boolean
  opponent?: string
  winner?: string | null
  updated_at?: string
}
type Opponent = { handle: string; name: string }

type Props = {
  creationId: number
  title?: string
  withContext: (url: string) => string
  contextPayload: Record<string, unknown>
  onOpenMatch: (matchId: number) => void
  onClose: () => void
}

function phaseOf(m: LobbyMatch): string {
  if (m.status === 'pending') return m.your_seat === 1 ? 'pending_sent' : 'pending_received'
  if (m.status === 'active') return m.your_turn ? 'your_turn' : 'opponent_turn'
  return m.status
}

const ACCENT = 'rgba(0,206,200,1)'
const panel: React.CSSProperties = {
  width: '100%', maxWidth: 420, maxHeight: '78vh', overflowY: 'auto',
  background: 'rgba(16,16,18,0.96)', border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 18, padding: '18px 16px', boxShadow: '0 18px 48px rgba(0,0,0,0.6)',
  backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', color: '#fff',
}
const sectionTitle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: 1.1, textTransform: 'uppercase',
  color: 'rgba(255,255,255,0.45)', margin: '16px 0 8px',
}
const row: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
  padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.07)', marginBottom: 8,
}
const btn = (variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties => ({
  padding: '7px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer',
  border: variant === 'ghost' ? '1px solid rgba(255,255,255,0.22)' : 'none',
  background: variant === 'primary' ? ACCENT : variant === 'danger' ? 'rgba(255,84,84,0.16)' : 'transparent',
  color: variant === 'primary' ? '#00302e' : variant === 'danger' ? '#ff8a8a' : '#fff',
})

export default function MatchLobby({ creationId, title, withContext, contextPayload, onOpenMatch, onClose }: Props) {
  const [matches, setMatches] = useState<LobbyMatch[]>([])
  const [opponents, setOpponents] = useState<Opponent[]>([])
  const [showOpponents, setShowOpponents] = useState(false)
  const [busy, setBusy] = useState<number | string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const base = `/api/builder/${creationId}/match`
  const aliveRef = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(withContext(`${base}/list`), { credentials: 'include' })
      const d = await r.json().catch(() => null) as { success?: boolean; matches?: LobbyMatch[] } | null
      if (r.ok && d?.success && Array.isArray(d.matches) && aliveRef.current) {
        setMatches(d.matches)
        setError(null)
      }
    } catch { /* keep last list; retry on next tick */ }
    finally { if (aliveRef.current) setLoaded(true) }
  }, [base, withContext])

  // Load + auto-refresh (5s) while the lobby is visible; pause when hidden.
  useEffect(() => {
    aliveRef.current = true
    refresh()
    const t = window.setInterval(() => { if (!document.hidden) refresh() }, 5000)
    return () => { aliveRef.current = false; window.clearInterval(t) }
  }, [refresh])

  const loadOpponents = useCallback(async () => {
    setShowOpponents(true)
    try {
      const r = await fetch(withContext(`${base}/opponents`), { credentials: 'include' })
      const d = await r.json().catch(() => null) as { success?: boolean; opponents?: Opponent[] } | null
      if (r.ok && d?.success && aliveRef.current) setOpponents(d.opponents || [])
    } catch { /* noop */ }
  }, [base, withContext])

  const post = useCallback(async (url: string, body: Record<string, unknown>) => {
    const r = await fetch(url, {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...contextPayload }),
    })
    const d = await r.json().catch(() => null) as { success?: boolean; error?: string; match?: LobbyMatch } | null
    if (!r.ok || !d?.success) throw new Error(d?.error || 'request_failed')
    return d
  }, [contextPayload])

  const act = useCallback(async (key: number | string, fn: () => Promise<void>) => {
    setBusy(key); setError(null)
    try { await fn() } catch (e) {
      setError((e as { message?: string })?.message || 'Something went wrong')
      refresh()
    } finally { if (aliveRef.current) setBusy(null) }
  }, [refresh])

  const challenge = (o: Opponent) => act(o.handle, async () => {
    const d = await post(`${base}/create`, { opponent: o.handle })
    if (d.match?.id) onOpenMatch(d.match.id)
  })
  const accept = (m: LobbyMatch) => act(m.id, async () => {
    await post(`${base}/${m.id}/accept`, {})
    onOpenMatch(m.id)
  })
  const decline = (m: LobbyMatch) => act(m.id, async () => { await post(`${base}/${m.id}/decline`, {}); refresh() })
  const cancel = (m: LobbyMatch) => act(m.id, async () => { await post(`${base}/${m.id}/cancel`, {}); refresh() })

  const groups: Record<string, LobbyMatch[]> = { your_turn: [], pending_received: [], pending_sent: [], opponent_turn: [], finished: [] }
  for (const m of matches) {
    const ph = phaseOf(m)
    if (ph in groups) groups[ph].push(m)
    // cancelled/declined invites are noise — hidden by design
  }

  const matchRow = (m: LobbyMatch, right: React.ReactNode, subtitle: string) => (
    <div key={m.id} style={row}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {m.opponent || 'Opponent'}
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>{subtitle}</div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>{right}</div>
    </div>
  )

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 4, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '56px 16px 24px', background: 'rgba(0,0,0,0.55)' }}>
      <div style={panel}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>{title || 'Multiplayer'}</div>
            <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.5)' }}>Challenge a member, or continue a game</div>
          </div>
          <button onClick={onClose} aria-label="Close lobby" style={{ ...btn('ghost'), width: 34, height: 34, padding: 0, borderRadius: '50%' }}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div style={{ margin: '10px 0', padding: '8px 12px', borderRadius: 10, background: 'rgba(255,84,84,0.12)', color: '#ff8a8a', fontSize: 13 }}>
            {error === 'rate_limited' ? 'Too many actions — give it a few seconds.' : 'That didn\u2019t work. Try again.'}
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          {!showOpponents ? (
            <button style={{ ...btn('primary'), width: '100%', padding: '11px 14px', fontSize: 14 }} onClick={loadOpponents}>
              + New game
            </button>
          ) : (
            <div>
              <div style={sectionTitle}>Challenge someone</div>
              {opponents.length === 0 && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', padding: '4px 2px' }}>No other members to challenge here yet.</div>}
              {opponents.map((o) => (
                <div key={o.handle} style={row}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{o.name}</div>
                  <button style={btn('primary')} disabled={busy === o.handle} onClick={() => challenge(o)}>
                    {busy === o.handle ? '…' : 'Challenge'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {groups.your_turn.length > 0 && (<div><div style={sectionTitle}>Your turn</div>
          {groups.your_turn.map((m) => matchRow(m, <button style={btn('primary')} onClick={() => onOpenMatch(m.id)}>Play</button>, 'It\u2019s your move'))}</div>)}

        {groups.pending_received.length > 0 && (<div><div style={sectionTitle}>Invites</div>
          {groups.pending_received.map((m) => matchRow(m, <>
            <button style={btn('primary')} disabled={busy === m.id} onClick={() => accept(m)}>Accept</button>
            <button style={btn('danger')} disabled={busy === m.id} onClick={() => decline(m)}>Decline</button>
          </>, 'Challenged you'))}</div>)}

        {groups.opponent_turn.length > 0 && (<div><div style={sectionTitle}>Waiting on them</div>
          {groups.opponent_turn.map((m) => matchRow(m, <button style={btn('ghost')} onClick={() => onOpenMatch(m.id)}>Open</button>, 'Their move'))}</div>)}

        {groups.pending_sent.length > 0 && (<div><div style={sectionTitle}>Sent invites</div>
          {groups.pending_sent.map((m) => matchRow(m, <button style={btn('danger')} disabled={busy === m.id} onClick={() => cancel(m)}>Cancel</button>, 'Waiting for accept'))}</div>)}

        {groups.finished.length > 0 && (<div><div style={sectionTitle}>Finished</div>
          {groups.finished.slice(0, 8).map((m) => matchRow(m,
            <button style={btn('ghost')} onClick={() => onOpenMatch(m.id)}>View</button>,
            m.winner === 'me' ? 'You won' : m.winner === 'them' ? 'They won' : 'Draw'))}</div>)}

        {loaded && matches.length === 0 && !showOpponents && (
          <div style={{ marginTop: 14, fontSize: 13, color: 'rgba(255,255,255,0.5)', textAlign: 'center' }}>
            No games yet — start one!
          </div>
        )}
      </div>
    </div>
  )
}
