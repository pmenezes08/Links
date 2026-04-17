import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useHeader } from '../contexts/HeaderContext'
import {
  formatShareLoadError,
  fileIsPdf,
  fileIsFeedImageOrVideo,
  fileIsChatShareableMedia,
  loadShareIntoStore,
  resetShareStore,
} from '../services/shareImport'
import { peekPendingShareFiles } from '../services/shareImportStore'

type CommunityRow = { id: number; name: string }

type DmRecent = { other_username: string; display_name: string; last_activity_time: string | null }
type GroupRecent = { id: number; name: string }

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
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [communities, setCommunities] = useState<CommunityRow[]>([])
  const [communitiesLoading, setCommunitiesLoading] = useState(false)
  const [showFeedCommunities, setShowFeedCommunities] = useState(false)
  const [showLinksDocs, setShowLinksDocs] = useState(false)
  const [communitySearch, setCommunitySearch] = useState('')
  const [groupSearch, setGroupSearch] = useState('')
  const [docDescription, setDocDescription] = useState('')
  const [uploadingDocs, setUploadingDocs] = useState(false)

  const [recentDms, setRecentDms] = useState<DmRecent[]>([])
  const [recentGroups, setRecentGroups] = useState<GroupRecent[]>([])
  const [recentsLoading, setRecentsLoading] = useState(false)
  const [sharedFiles, setSharedFiles] = useState<File[]>([])

  const platform = Capacitor.getPlatform()
  const isNative = platform === 'ios' || platform === 'android'

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
    if (!isNative) {
      setError('Sharing from other apps is only available in the C.Point mobile app.')
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        await loadShareIntoStore()
        const files = peekPendingShareFiles() ?? []
        if (!cancelled) setSharedFiles(files)
        if (!cancelled && files.length === 0) {
          setError('Nothing to share. Try again from Photos, Files, or another app.')
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
  }, [isNative])

  useEffect(() => {
    if (!isNative || loading || error) return
    let cancelled = false
    setRecentsLoading(true)
    ;(async () => {
      try {
        const [dmRes, gRes] = await Promise.all([
          fetch('/api/chat_threads', { credentials: 'include', headers: { Accept: 'application/json' } }),
          fetch('/api/group_chat/list', { credentials: 'include', headers: { Accept: 'application/json' } }),
        ])
        const dmJ = await dmRes.json().catch(() => null)
        const gJ = await gRes.json().catch(() => null)
        if (cancelled) return
        const dms: DmRecent[] = Array.isArray(dmJ?.threads)
          ? (dmJ.threads as DmRecent[]).slice(0, 6)
          : []
        const gr: GroupRecent[] = Array.isArray(gJ?.groups)
          ? (gJ.groups as GroupRecent[]).slice(0, 6)
          : []
        setRecentDms(dms)
        setRecentGroups(gr)
      } catch {
        if (!cancelled) {
          setRecentDms([])
          setRecentGroups([])
        }
      } finally {
        if (!cancelled) setRecentsLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isNative, loading, error])

  useEffect(() => {
    if (!showFeedCommunities && !showLinksDocs) return
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
          /* fallback */
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
  }, [showFeedCommunities, showLinksDocs])

  const hasPdf = sharedFiles.some(fileIsPdf)
  const hasFeedMedia = sharedFiles.some(fileIsFeedImageOrVideo)
  const hasChatMedia = sharedFiles.some(fileIsChatShareableMedia)
  const pdfFiles = useMemo(() => sharedFiles.filter(fileIsPdf), [sharedFiles])

  const filteredCommunities = useMemo(() => {
    const q = communitySearch.trim().toLowerCase()
    if (!q) return communities
    return communities.filter(c => c.name.toLowerCase().includes(q))
  }, [communities, communitySearch])

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase()
    if (!q) return recentGroups
    return recentGroups.filter(g => g.name.toLowerCase().includes(q))
  }, [recentGroups, groupSearch])

  const shareQuery = '?share=1'

  function goDmOrGroup() {
    navigate('/user_chat?share_pick=1')
  }

  function pickCommunityFeed(c: CommunityRow) {
    navigate(`/compose?community_id=${c.id}&from_share=1`)
  }

  async function uploadDocsToCommunity(c: CommunityRow) {
    if (pdfFiles.length === 0) return
    setUploadingDocs(true)
    setError(null)
    setErrorDetail(null)
    try {
      for (const file of pdfFiles) {
        const fd = new FormData()
        fd.append('file', file)
        const desc = docDescription.trim()
        if (desc) fd.append('description', desc)
        fd.append('community_id', String(c.id))
        const r = await fetch('/upload_doc', { method: 'POST', credentials: 'include', body: fd })
        const j = await r.json().catch(() => null)
        if (!j?.success) {
          throw new Error(j?.error || 'Upload failed')
        }
      }
      await resetShareStore()
      navigate(`/community/${c.id}/useful_links_react`)
    } catch (e) {
      setError('Could not upload document(s).')
      setErrorDetail(formatShareLoadError(e))
    } finally {
      setUploadingDocs(false)
    }
  }

  function cancelAndLeave() {
    void resetShareStore().finally(() => goBackOrHome())
  }

  if (loading) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center text-white px-4">
        <div className="w-10 h-10 border-2 border-white/20 border-t-[#4db6ac] rounded-full animate-spin mb-3" />
        <p className="text-sm text-white/70">Preparing your share…</p>
      </div>
    )
  }

  if (error && !uploadingDocs) {
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
      <p className="text-sm text-white/70 mb-4 text-center">Choose where to send this content.</p>

      {(recentsLoading || recentDms.length > 0 || recentGroups.length > 0) && (
        <div className="mb-6 space-y-3">
          <div className="text-xs text-white/50 uppercase tracking-wide">Recent</div>
          {recentsLoading ? (
            <div className="text-sm text-white/50">Loading conversations…</div>
          ) : (
            <>
              {recentDms.length > 0 && (
                <div>
                  <div className="text-xs text-white/40 mb-1">Direct messages</div>
                  <ul className="space-y-1">
                    {recentDms.map(t => (
                      <li key={t.other_username}>
                        <button
                          type="button"
                          onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(t.other_username)}${shareQuery}`)}
                          disabled={!hasChatMedia}
                          className={`w-full text-left px-3 py-2 rounded-xl text-sm border border-white/10 ${
                            hasChatMedia ? 'hover:bg-white/10 bg-white/[0.03]' : 'opacity-40 cursor-not-allowed'
                          }`}
                        >
                          <span className="font-medium text-[#4db6ac]">{t.display_name || t.other_username}</span>
                          <span className="text-white/45 text-xs ml-2">DM</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {recentGroups.length > 0 && (
                <div>
                  <div className="text-xs text-white/40 mb-1">Group chats</div>
                  <input
                    type="search"
                    value={groupSearch}
                    onChange={e => setGroupSearch(e.target.value)}
                    placeholder="Search groups…"
                    className="w-full mb-2 rounded-lg bg-black/50 border border-white/15 px-3 py-2 text-sm placeholder:text-white/35"
                  />
                  <ul className="space-y-1 max-h-40 overflow-y-auto">
                    {filteredGroups.map(g => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/group_chat/${g.id}${shareQuery}`)}
                          disabled={!hasChatMedia}
                          className={`w-full text-left px-3 py-2 rounded-xl text-sm border border-white/10 ${
                            hasChatMedia ? 'hover:bg-white/10 bg-white/[0.03]' : 'opacity-40 cursor-not-allowed'
                          }`}
                        >
                          <span className="font-medium text-[#4db6ac]">{g.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {!hasChatMedia && (recentDms.length > 0 || recentGroups.length > 0) ? (
            <p className="text-xs text-amber-200/80">Photos, videos, and audio can go to chats. PDFs use Links &amp; Docs below.</p>
          ) : null}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={goDmOrGroup}
          disabled={!hasChatMedia}
          className={`w-full text-left px-4 py-4 rounded-2xl border border-white/15 transition-colors ${
            hasChatMedia ? 'bg-white/5 hover:bg-white/10' : 'opacity-40 cursor-not-allowed'
          }`}
        >
          <div className="font-semibold text-[#4db6ac]">Direct or group message</div>
          <div className="text-xs text-white/60 mt-1">Open Messages and pick a conversation. Media attaches to the composer.</div>
        </button>

        <button
          type="button"
          onClick={() => setShowFeedCommunities(v => !v)}
          disabled={!hasFeedMedia}
          className={`w-full text-left px-4 py-4 rounded-2xl border border-white/15 transition-colors ${
            hasFeedMedia ? 'bg-white/5 hover:bg-white/10' : 'opacity-40 cursor-not-allowed'
          }`}
        >
          <div className="font-semibold text-[#4db6ac]">Community feed post</div>
          <div className="text-xs text-white/60 mt-1">Images and video only. Pick a community, then compose.</div>
        </button>

        <button
          type="button"
          onClick={() => setShowLinksDocs(v => !v)}
          disabled={!hasPdf}
          className={`w-full text-left px-4 py-4 rounded-2xl border border-white/15 transition-colors ${
            hasPdf ? 'bg-white/5 hover:bg-white/10' : 'opacity-40 cursor-not-allowed'
          }`}
        >
          <div className="font-semibold text-[#4db6ac]">Links &amp; Docs (PDF)</div>
          <div className="text-xs text-white/60 mt-1">Upload PDFs to a community&apos;s Useful Links &amp; Docs.</div>
        </button>
      </div>

      {showFeedCommunities && hasFeedMedia && (
        <div className="mt-6 border border-white/10 rounded-2xl p-3 bg-black/40">
          <div className="text-xs text-white/50 mb-2 uppercase tracking-wide">Community for post</div>
          <input
            type="search"
            value={communitySearch}
            onChange={e => setCommunitySearch(e.target.value)}
            placeholder="Search communities…"
            className="w-full mb-3 rounded-lg bg-black/50 border border-white/15 px-3 py-2 text-sm placeholder:text-white/35"
          />
          {communitiesLoading ? (
            <div className="text-sm text-white/50 py-4 text-center">Loading…</div>
          ) : filteredCommunities.length === 0 ? (
            <div className="text-sm text-white/60 py-2">No communities match.</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto space-y-1">
              {filteredCommunities.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pickCommunityFeed(c)}
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

      {showLinksDocs && hasPdf && (
        <div className="mt-6 border border-white/10 rounded-2xl p-3 bg-black/40 space-y-3">
          <div className="text-xs text-white/50 uppercase tracking-wide">Upload PDF to Links &amp; Docs</div>
          <input
            type="text"
            value={docDescription}
            onChange={e => setDocDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-lg bg-black/50 border border-white/15 px-3 py-2 text-sm placeholder:text-white/35"
          />
          <input
            type="search"
            value={communitySearch}
            onChange={e => setCommunitySearch(e.target.value)}
            placeholder="Search communities…"
            className="w-full rounded-lg bg-black/50 border border-white/15 px-3 py-2 text-sm placeholder:text-white/35"
          />
          {communitiesLoading ? (
            <div className="text-sm text-white/50 py-4 text-center">Loading…</div>
          ) : filteredCommunities.length === 0 ? (
            <div className="text-sm text-white/60 py-2">No communities match.</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto space-y-1">
              {filteredCommunities.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={uploadingDocs}
                    onClick={() => void uploadDocsToCommunity(c)}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-white/10 text-sm disabled:opacity-50"
                  >
                    {uploadingDocs ? 'Uploading…' : `Upload to ${c.name}`}
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
