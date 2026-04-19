import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useHeader } from '../contexts/HeaderContext'
import LinkPreview from '../components/LinkPreview'
import {
  formatShareLoadError,
  fileIsPdf,
  fileIsFeedImageOrVideo,
  fileIsChatShareableMedia,
  loadShareIntoStore,
  resetShareStore,
} from '../services/shareImport'
import { peekPendingShareFiles, peekPendingShareUrls } from '../services/shareImportStore'

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
  const [sharedUrls, setSharedUrls] = useState<string[]>([])

  const platform = Capacitor.getPlatform()
  const isNative = platform === 'ios' || platform === 'android'

  const hasSharedLinks = sharedUrls.length > 0

  function goBackOrHome() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/home')
  }

  useEffect(() => {
    setTitle('Share to C-Point')
    return () => setTitle('')
  }, [setTitle])

  useEffect(() => {
    if (!isNative) {
      setError('Sharing from other apps is only available in the C-Point mobile app.')
      setLoading(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const { files, urls } = await loadShareIntoStore()
        if (!cancelled) {
          setSharedFiles(peekPendingShareFiles() ?? files)
          setSharedUrls(peekPendingShareUrls() ?? urls)
        }
        if (!cancelled && files.length === 0 && urls.length === 0) {
          setError('Nothing to share. Try again from Photos, a browser link, or another app.')
        }
      } catch (e) {
        console.error('ShareIncoming load error:', e)
        if (!cancelled) {
          setError('Could not load shared content.')
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

  const canPostToFeed = hasFeedMedia || hasSharedLinks
  const canSendToChat = hasChatMedia || hasSharedLinks

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
      <div className="glass-page min-h-[50vh] flex flex-col items-center justify-center">
        <div className="glass-card px-10 py-12 flex flex-col items-center max-w-sm w-full">
          <div className="w-10 h-10 border-2 border-white/15 border-t-[#4db6ac] rounded-full animate-spin mb-4" />
          <p className="text-sm text-white/75 text-center">Preparing your share…</p>
        </div>
      </div>
    )
  }

  if (error && !uploadingDocs) {
    return (
      <div className="glass-page px-4 py-10 max-w-lg mx-auto">
        <div className="glass-card px-6 py-8 text-center">
          <p className="text-white/90 mb-4">{error}</p>
          {errorDetail ? (
            <p className="text-left text-xs text-white/50 mb-6 whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/25 px-3 py-2 font-mono">
              {errorDetail}
            </p>
          ) : null}
          <button
            type="button"
            onClick={goBackOrHome}
            className="px-6 py-2.5 rounded-full text-sm font-medium border border-[#4db6ac]/40 text-[#b2dfdb] hover:bg-[#4db6ac]/15 transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-page pb-28 max-w-lg mx-auto">
      <div className="mb-6 text-center space-y-2">
        <h1 className="text-lg font-semibold text-white tracking-tight">Share to C-Point</h1>
        <p className="text-sm text-white/55">Choose where to send this content.</p>
      </div>

      {hasSharedLinks && (
        <section className="glass-card glass-highlight mb-6 p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[#b2dfdb]/90 font-medium">Link preview</div>
          {sharedUrls.slice(0, 3).map(u => (
            <div key={u} className="rounded-xl overflow-hidden border border-white/10 bg-black/20">
              <LinkPreview url={u} sent={false} />
            </div>
          ))}
          {sharedUrls.length > 3 ? (
            <p className="text-xs text-white/45">+{sharedUrls.length - 3} more link(s) will be included in your post or message.</p>
          ) : null}
        </section>
      )}

      {(recentsLoading || recentDms.length > 0 || recentGroups.length > 0) && (
        <section className="glass-section mb-5 space-y-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 font-medium">Recent</div>
          {recentsLoading ? (
            <div className="text-sm text-white/45 py-2">Loading conversations…</div>
          ) : (
            <>
              {recentDms.length > 0 && (
                <div>
                  <div className="text-xs text-white/35 mb-1.5">Direct messages</div>
                  <ul className="space-y-1.5">
                    {recentDms.map(t => (
                      <li key={t.other_username}>
                        <button
                          type="button"
                          onClick={() => navigate(`/user_chat/chat/${encodeURIComponent(t.other_username)}${shareQuery}`)}
                          disabled={!canSendToChat}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors ${
                            canSendToChat
                              ? 'border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.08] hover:border-[#4db6ac]/25'
                              : 'opacity-35 cursor-not-allowed border-white/[0.05]'
                          }`}
                        >
                          <span className="font-medium text-[#7fd8cf]">{t.display_name || t.other_username}</span>
                          <span className="text-white/35 text-xs ml-2">DM</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {recentGroups.length > 0 && (
                <div>
                  <div className="text-xs text-white/35 mb-1.5">Group chats</div>
                  <input
                    type="search"
                    value={groupSearch}
                    onChange={e => setGroupSearch(e.target.value)}
                    placeholder="Search groups…"
                    className="w-full mb-2 rounded-xl bg-black/40 border border-white/[0.08] px-3 py-2.5 text-sm placeholder:text-white/30 focus:border-[#4db6ac]/35 focus:outline-none"
                  />
                  <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                    {filteredGroups.map(g => (
                      <li key={g.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/group_chat/${g.id}${shareQuery}`)}
                          disabled={!canSendToChat}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm border transition-colors ${
                            canSendToChat
                              ? 'border-white/[0.07] bg-white/[0.04] hover:bg-white/[0.08] hover:border-[#4db6ac]/25'
                              : 'opacity-35 cursor-not-allowed border-white/[0.05]'
                          }`}
                        >
                          <span className="font-medium text-[#7fd8cf]">{g.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {!canSendToChat && (recentDms.length > 0 || recentGroups.length > 0) ? (
            <p className="text-xs text-amber-200/75 leading-relaxed">
              Photos, video, audio, and links can go to chats. PDFs belong in Links &amp; Docs below.
            </p>
          ) : null}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <button
          type="button"
          onClick={goDmOrGroup}
          disabled={!canSendToChat}
          className={`glass-card text-left p-4 rounded-2xl border transition-all ${
            canSendToChat
              ? 'border-white/[0.08] hover:border-[#4db6ac]/30 hover:shadow-[0_12px_40px_rgba(77,182,172,0.12)] active:scale-[0.99]'
              : 'opacity-35 cursor-not-allowed border-white/[0.05]'
          }`}
        >
          <div className="font-semibold text-[#7fd8cf] text-[15px]">Direct or group message</div>
          <div className="text-xs text-white/50 mt-1.5 leading-relaxed">Open Messages and pick a conversation. Shared items attach to the composer.</div>
        </button>

        <button
          type="button"
          onClick={() => setShowFeedCommunities(v => !v)}
          disabled={!canPostToFeed}
          className={`glass-card text-left p-4 rounded-2xl border transition-all ${
            canPostToFeed
              ? 'border-white/[0.08] hover:border-[#4db6ac]/30 hover:shadow-[0_12px_40px_rgba(77,182,172,0.12)] active:scale-[0.99]'
              : 'opacity-35 cursor-not-allowed border-white/[0.05]'
          }`}
        >
          <div className="font-semibold text-[#7fd8cf] text-[15px]">Community feed post</div>
          <div className="text-xs text-white/50 mt-1.5 leading-relaxed">
            Share images, video, or links to a community feed. Choose a community, then compose.
          </div>
        </button>

        <button
          type="button"
          onClick={() => setShowLinksDocs(v => !v)}
          disabled={!hasPdf}
          className={`glass-card text-left p-4 rounded-2xl border transition-all ${
            hasPdf
              ? 'border-white/[0.08] hover:border-[#4db6ac]/30 hover:shadow-[0_12px_40px_rgba(77,182,172,0.12)] active:scale-[0.99]'
              : 'opacity-35 cursor-not-allowed border-white/[0.05]'
          }`}
        >
          <div className="font-semibold text-[#7fd8cf] text-[15px]">Links &amp; Docs (PDF)</div>
          <div className="text-xs text-white/50 mt-1.5 leading-relaxed">Upload PDFs to a community&apos;s Useful Links &amp; Docs.</div>
        </button>
      </section>

      {showFeedCommunities && canPostToFeed && (
        <div className="mt-5 glass-section p-4">
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 mb-2 font-medium">Community for post</div>
          <input
            type="search"
            value={communitySearch}
            onChange={e => setCommunitySearch(e.target.value)}
            placeholder="Search communities…"
            className="w-full mb-3 rounded-xl bg-black/40 border border-white/[0.08] px-3 py-2.5 text-sm placeholder:text-white/30 focus:border-[#4db6ac]/35 focus:outline-none"
          />
          {communitiesLoading ? (
            <div className="text-sm text-white/45 py-4 text-center">Loading…</div>
          ) : filteredCommunities.length === 0 ? (
            <div className="text-sm text-white/50 py-2">No communities match.</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto space-y-1">
              {filteredCommunities.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pickCommunityFeed(c)}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-sm text-white/90 hover:bg-white/[0.06] border border-transparent hover:border-white/[0.06]"
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
        <div className="mt-5 glass-section p-4 space-y-3">
          <div className="text-[10px] uppercase tracking-[0.14em] text-white/40 font-medium">Upload PDF to Links &amp; Docs</div>
          <input
            type="text"
            value={docDescription}
            onChange={e => setDocDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full rounded-xl bg-black/40 border border-white/[0.08] px-3 py-2.5 text-sm placeholder:text-white/30 focus:border-[#4db6ac]/35 focus:outline-none"
          />
          <input
            type="search"
            value={communitySearch}
            onChange={e => setCommunitySearch(e.target.value)}
            placeholder="Search communities…"
            className="w-full rounded-xl bg-black/40 border border-white/[0.08] px-3 py-2.5 text-sm placeholder:text-white/30 focus:border-[#4db6ac]/35 focus:outline-none"
          />
          {communitiesLoading ? (
            <div className="text-sm text-white/45 py-4 text-center">Loading…</div>
          ) : filteredCommunities.length === 0 ? (
            <div className="text-sm text-white/50 py-2">No communities match.</div>
          ) : (
            <ul className="max-h-64 overflow-y-auto space-y-1">
              {filteredCommunities.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={uploadingDocs}
                    onClick={() => void uploadDocsToCommunity(c)}
                    className="w-full text-left px-3 py-2.5 rounded-xl text-sm hover:bg-white/[0.06] disabled:opacity-45"
                  >
                    {uploadingDocs ? 'Uploading…' : `Upload to ${c.name}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={cancelAndLeave}
        className="mt-10 w-full text-center text-sm text-white/40 hover:text-white/65 transition-colors py-2"
      >
        Cancel
      </button>
    </div>
  )
}
