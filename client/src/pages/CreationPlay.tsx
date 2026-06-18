import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PlayableCreation from '../components/builder/PlayableCreation'

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

  if (creation) {
    return <PlayableCreation html={creation.html} title={creation.title} onClose={goBack} />
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 60, background: '#000', color: '#f1f1f1',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      paddingTop: 'var(--sat-px, 0px)', paddingBottom: 'var(--sab-px, 0px)', gap: 14,
    }}>
      <button onClick={goBack} aria-label="Back"
        style={{ position: 'absolute', top: 'calc(var(--sat-px, 0px) + 10px)', left: 10, background: 'none', border: 'none', color: '#cfcfcf', fontSize: 22, padding: 4 }}>‹</button>
      <div style={{ color: '#8a8a8a', fontSize: 14, padding: 24, textAlign: 'center' }}>{error || 'Loading…'}</div>
    </div>
  )
}
