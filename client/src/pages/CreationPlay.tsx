import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

type Creation = { id: number; title: string; html: string }

export default function CreationPlay() {
  const { community_id, creation_id } = useParams()
  const navigate = useNavigate()
  const [creation, setCreation] = useState<Creation | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      if (!creation_id) return
      try {
        const res = await fetch(`/api/builder/${creation_id}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const data = await res.json().catch(() => null)
        if (!mounted) return
        if (res.ok && data?.success && data.creation) setCreation(data.creation)
        else setError('This creation is unavailable.')
      } catch {
        if (mounted) setError('Could not load this creation.')
      }
    }
    load()
    return () => { mounted = false }
  }, [creation_id])

  const goBack = () => {
    if (community_id) navigate(`/community_feed_react/${community_id}`)
    else navigate(-1)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: '#000', color: '#f1f1f1',
      display: 'flex', flexDirection: 'column',
      paddingTop: 'var(--sat-px, 0px)', paddingBottom: 'var(--sab-px, 0px)',
    }}>
      <div style={{ flex: '0 0 auto', height: 52, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={goBack} aria-label="Back" style={{ background: 'none', border: 'none', color: '#cfcfcf', fontSize: 22, lineHeight: 1, padding: 4, cursor: 'pointer' }}>‹</button>
        <div style={{ fontSize: 15 }}>{creation?.title || 'Creation'}</div>
      </div>
      <div style={{ flex: '1 1 auto', position: 'relative', background: '#0b0b0b' }}>
        {creation ? (
          <iframe title={creation.title || 'Creation'} sandbox="allow-scripts" srcDoc={creation.html}
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }} />
        ) : (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8a8a', fontSize: 14, padding: 24, textAlign: 'center' }}>
            {error || 'Loading…'}
          </div>
        )}
      </div>
    </div>
  )
}
