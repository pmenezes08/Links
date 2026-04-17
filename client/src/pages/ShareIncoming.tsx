import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useHeader } from '../contexts/HeaderContext'
import { formatShareLoadError, loadShareIntoStore } from '../services/shareImport'
import { clearPendingShareFiles, peekPendingShareFiles } from '../services/shareImportStore'

type CommunityRow = { id: number; name: string }

function normalizeCommunities(raw: unknown): CommunityRow[] {
  if (!Array.isArray(raw)) return []
  const out: CommunityRow[] = []
  const seen = new Set<number>()
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const o = row as Record<string, unknown>
    const id = Number(o.id ?? o.community_id ?? o.communityId)
    if (!Number.isFinite(id) || seen.has(id)) continue
    const name =
      (typeof o.name === 'string' && o.name.trim()) ||
      (typeof o.community_name === 'string' && o.community_name.trim()) ||
      `Community ${id}`
    const parentIndicators = [o.parent_community_id, o.parentCommunityId, o.parent_id, o.parentId, o.parent]
    const isParent = parentIndicators.every(v => v === null || v === undefined || v === 0)
    if (!isParent) continue
    seen.add(id)
    out.push({ id, name })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export default function ShareIncoming() {
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /** Technical detail shown under the friendly message so debugging does not rely on console. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [communities, setCommunities] = useState<CommunityRow[]>([])
  const [communitiesLoading, setCommunitiesLoading] = useState(false)
  const [showCommunities, setShowCommunities] = useState(false)

  function goBackOrHome() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/home')
  }

  useEffect(() => {
    setTitle('Share to C.Point')
    return () => setTitle('')
  }, [setTitle])

  useEffect(() => {
    if (Capacitor.getPlatform() === 'web') {
      setError('Sharing from other apps is only available in the iOS app.')
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await loadShareIntoStore()
        const files = peekPendingShareFiles()
        if (!cancelled && (!files || files.length === 0)) {
          setError('No photos or videos to share. Try again from Photos or another app.')
        }
      } catch (e) {
        console.error('ShareIncoming load error:', e)
        if (!cancelled) {
          setError('Could not load shared files.')
          setErrorDetail(formatShareLoadError(e))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!showCommunities) return
    let cancelled = false
    setCommunitiesLoading(true)
    ;(async () => {
      try {
        let list: CommunityRow[] = []
        try {
          const r = await fetch('/api/user_parent_community', { credentials: 'include', headers: { Accept: 'application/json' } })
          const j = await r.json().catch(() => null)
          if (j?.success) list = normalizeCommunities(j.communities)
        } catch {
          // fallback below
        }
        if (!list.length) {
          const r2 = await fetch('/get_user_communities', { credentials: 'include' })
          const j2 = await r2.json().catch(() => null)
          list = normalizeCommunities(j2?.communities)
        }
        if (!cancelled) setCommunities(list)
      } catch {
        if (!cancelled) setCommunities([])
      } finally {
        if (!cancelled) setCommunitiesLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [showCommunities])

  function goDmOrGroup() {
    navigate('/user_chat?share_pick=1')
  }

  function pickCommunity(c: CommunityRow) {
    navigate(`/compose?community_id=${c.id}&from_share=1`)
  }

  function cancelAndLeave() {
    clearPendingShareFiles()
    goBackOrHome()
  }

  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-white px-4">
        <div className="w-10 h-10 border-2 border-white/20 border-t-[#4db6ac] rounded-full animate-spin mb-3" />
        <p className="text-sm text-white/70">Preparing your share…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 py-8 max-w-lg mx-auto text-center text-white">
        <p className="text-white/90 mb-4">{error}</p>
        {errorDetail ? (
          <p className="text-left text-xs text-white/55 mb-4 whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/30 px-3 py-2 font-mono">
            {errorDetail}
          </p>
        ) : null}
        <button
          type="button"
          onClick={goBackOrHome}
          className="px-4 py-2 rounded-full border border-white/20 text-sm hover:bg-white/10"
        >
          Go back
        </button>
      </div>
    )
  }

  return (
    <div className="px-4 py-6 max-w-lg mx-auto text-white pb-24">
      <p className="text-sm text-white/70 mb-6 text-center">Choose where to send this media.</p>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={goDmOrGroup}
          className="w-full text-left px-4 py-4 rounded-2xl border border-white/15 bg-white/5 hover:bg-white/10 transition-colors"
        >
          <div className="font-semibold text-[#4db6ac]">Direct or group message</div>
          <div className="text-xs text-white/60 mt-1">Open Messages and tap a conversation. Media will attach to the composer.</div>
        </button>

        <button
          type="button"
          onClick={() => setShowCommunities(true)}
          className="w-full text-left px-4 py-4 rounded-2xl border border-white/15 bg-white/5 hover:bg-white/10 transition-colors"
        >
          <div className="font-semibold text-[#4db6ac]">Community feed post</div>
          <div className="text-xs text-white/60 mt-1">Pick a community, then compose your post.</div>
        </button>
      </div>

      {showCommunities && (
        <div className="mt-6 border border-white/10 rounded-2xl p-3 bg-black/40">
          <div className="text-xs text-white/50 mb-2 uppercase tracking-wide">Your communities</div>
          {communitiesLoading ? (
            <div className="text-sm text-white/50 py-4 text-center">Loading…</div>
          ) : communities.length === 0 ? (
            <div className="text-sm text-white/60 py-2">No communities found. Join a community first.</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto space-y-1">
              {communities.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pickCommunity(c)}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-sm"
                  >
                    {c.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button type="button" onClick={cancelAndLeave} className="mt-8 w-full text-center text-sm text-white/50 hover:text-white/80">
        Cancel
      </button>
    </div>
  )
}
