import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Network } from '@capacitor/network'
import { Filesystem, Directory } from '@capacitor/filesystem'
import ZoomableImage from '../components/ZoomableImage'
import MessageImage from '../components/MessageImage'
import { useHeader } from '../contexts/HeaderContext'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'
import { normalizeMediaPath } from './utils'
import { mediaDeleteScopeForDm, mediaDeleteScopeForGroup, recordDeletedMedia } from './mediaDeletionEvents'

export type MediaGalleryMode =
  | { type: 'dm'; peer: string }
  | { type: 'group'; groupId: string | number }

type MediaItem = {
  id: number
  message_id: number
  sender: string
  url: string
  type: 'image' | 'video'
  created_at: string | number | Date
}

type ConfirmState =
  | { kind: 'single'; items: MediaItem[] }
  | { kind: 'bulk'; items: MediaItem[] }
  | null

export function buildMediaDeletePayload(items: Array<Pick<MediaItem, 'message_id' | 'url'>>) {
  return {
    items: items.map(item => ({ message_id: item.message_id, media_url: item.url })),
  }
}

function currentUsername(): string {
  try {
    return localStorage.getItem('current_username') || ''
  } catch {
    return ''
  }
}

export default function MediaGalleryPage({ mode }: { mode: MediaGalleryMode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selected, setSelected] = useState<Set<number>>(() => new Set())
  const [viewingMedia, setViewingMedia] = useState<MediaItem | null>(null)
  const [confirmState, setConfirmState] = useState<ConfirmState>(null)
  const viewer = currentUsername()

  useEffect(() => { setTitle(t('chat.media_title')) }, [setTitle, t])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const url = mode.type === 'dm'
          ? `/api/chat/media?peer=${encodeURIComponent(mode.peer || '')}`
          : `/api/group_chat/${mode.groupId}/media`
        const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) {
          setItems(j.media || [])
          setError(null)
        } else {
          setError(j?.error || t('chat.failed_load_media'))
        }
      } catch {
        if (mounted) setError(t('chat.failed_load_media'))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => { mounted = false }
  }, [mode, t])

  const ownItems = useMemo(() => items.filter(item => !viewer || item.sender === viewer), [items, viewer])
  const selectedItems = useMemo(() => items.filter(item => selected.has(item.id)), [items, selected])

  const groups = useMemo(() => {
    const unknownKey = t('chat.unknown_date')
    const map: Record<string, MediaItem[]> = {}
    for (const it of items) {
      const d = parseFlexibleDate(it.created_at)
      const key = d && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : unknownKey
      if (!map[key]) map[key] = []
      map[key].push(it)
    }
    const keys = Object.keys(map).sort((a, b) => a === unknownKey ? 1 : b === unknownKey ? -1 : a < b ? 1 : -1)
    const formatted = keys.map(k => {
      if (k === unknownKey) return unknownKey
      const d = parseFlexibleDate(k)
      if (!d || isNaN(d.getTime())) return unknownKey
      const today = new Date()
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
      if (d.toDateString() === today.toDateString()) return t('chat.today')
      if (d.toDateString() === yesterday.toDateString()) return t('chat.yesterday_cap')
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    })
    return { keys: formatted, map, originalKeys: keys }
  }, [items, t])

  const deleteEndpoint = mode.type === 'dm'
    ? '/api/chat/dm/remove_media_bulk'
    : `/api/group_chat/${mode.groupId}/remove_media_bulk`
  const deleteScope = mode.type === 'dm' ? mediaDeleteScopeForDm(mode.peer) : mediaDeleteScopeForGroup(mode.groupId)

  const saveMediaToDevice = async (url: string, type: 'image' | 'video') => {
    try {
      const status = await Network.getStatus()
      if (!status.connected) {
        alert(t('chat.save_offline_cached'))
        return
      }
      const response = await fetch(url)
      if (!response.ok) throw new Error(t('chat.download_failed'))
      const blob = await response.blob()
      const reader = new FileReader()
      const base64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const extension = type === 'video' ? 'mp4' : 'jpg'
      const path = `cpoint-media-${Date.now()}.${extension}`
      await Filesystem.writeFile({ path, data: base64, directory: Directory.Documents })
      alert(t('chat.saved_to_documents', { path }))
    } catch (err) {
      alert(t('chat.save_failed', { message: (err as Error).message }))
    }
  }

  const toggleItem = (item: MediaItem) => {
    if (viewer && item.sender !== viewer) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }

  const performDelete = async (itemsToDelete: MediaItem[]) => {
    if (!itemsToDelete.length) return
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(deleteEndpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMediaDeletePayload(itemsToDelete)),
      })
      const payload = await res.json().catch(() => null)
      if (!res.ok || !payload?.success) throw new Error(payload?.error || t('chat.delete_media_failed'))
      recordDeletedMedia(deleteScope, payload.removed_items || [])
      const removed = new Set<string>(
        (payload.removed_items || []).map((item: { message_id: number; media_url: string }) => `${item.message_id}:${item.media_url}`)
      )
      const fallback = payload.removed_items ? null : new Set(itemsToDelete.map(item => item.id))
      setItems(prev => prev.filter(item => {
        if (fallback) return !fallback.has(item.id)
        return !removed.has(`${item.message_id}:${item.url}`)
      }))
      if (payload.failed > 0) setError(t('chat.delete_all_media_partial_fail'))
      setSelected(new Set())
      setSelectionMode(false)
      setViewingMedia(null)
      setConfirmState(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('chat.delete_media_failed'))
    } finally {
      setDeleting(false)
    }
  }

  if (loading) return <div className="p-4 text-c-text-secondary">{t('common.loading')}</div>
  if (error && items.length === 0) return <div className="p-4 text-red-400">{error}</div>

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      <div className="fixed left-0 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40 border-b border-c-border"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}>
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button
            className="p-2 rounded-full hover:bg-white/5"
            onClick={() => {
              if (mode.type === 'group') navigate(`/group_chat/${mode.groupId}`)
              else navigate(-1)
            }}
            aria-label={t('common.back')}
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 font-medium truncate">{selectionMode ? t('chat.selected_media_count', { count: selected.size }) : t('chat.media_title')}</div>
          {items.length > 0 ? (
            selectionMode ? (
              <>
                <button className="text-xs px-2 py-1 rounded-full bg-white/10" onClick={() => setSelected(new Set(ownItems.map(item => item.id)))}>
                  {t('chat.select_all')}
                </button>
                <button className="text-xs px-2 py-1 rounded-full bg-white/10" onClick={() => { setSelectionMode(false); setSelected(new Set()) }}>
                  {t('common.cancel')}
                </button>
              </>
            ) : (
              <>
                <div className="text-sm text-c-text-secondary">{t('chat.item_count', { count: items.length })}</div>
                {ownItems.length > 0 ? (
                  <button className="text-xs px-2 py-1 rounded-full bg-white/10 text-c-text-primary" onClick={() => setSelectionMode(true)}>
                    {t('chat.select')}
                  </button>
                ) : null}
              </>
            )
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="fixed left-1/2 top-[calc(var(--app-header-height,56px)+48px)] z-50 -translate-x-1/2 rounded-full border border-red-400/25 bg-red-500/20 px-4 py-2 text-sm text-red-100">
          {error}
        </div>
      ) : null}

      <div className="app-subnav-offset max-w-2xl mx-auto pb-24 px-3 overflow-y-auto no-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch' as any, minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))', '--app-subnav-height': '40px' } as CSSProperties}>
        {items.length === 0 ? (
          <div className="text-center py-12">
            <i className="fa-solid fa-photo-film text-4xl mb-3 block opacity-50 text-c-text-secondary" />
            <p className="text-lg font-medium text-c-text-secondary">{t('chat.no_media_yet')}</p>
            <p className="text-sm text-c-text-secondary">{t('chat.no_media_hint')}</p>
          </div>
        ) : (
          <div className="space-y-8 pt-4">
            {groups.keys.map((label, index) => {
              const mediaForDate = groups.map[groups.originalKeys[index]] || []
              return (
                <div key={label} className="space-y-3">
                  <div className="text-sm text-c-text-secondary font-medium border-b border-c-border pb-2">{label} ({mediaForDate.length})</div>
                  <div className="grid grid-cols-3 gap-2">
                    {mediaForDate.map(m => {
                      const isSelected = selected.has(m.id)
                      const canDelete = !viewer || m.sender === viewer
                      return (
                        <button
                          key={m.id}
                          type="button"
                          role={selectionMode ? 'checkbox' : 'button'}
                          aria-checked={selectionMode ? isSelected : undefined}
                          className="relative group aspect-square cursor-pointer text-left"
                          onClick={() => selectionMode ? toggleItem(m) : setViewingMedia(m)}
                          onContextMenu={event => {
                            if (canDelete) {
                              event.preventDefault()
                              setSelectionMode(true)
                              setSelected(new Set([m.id]))
                            }
                          }}
                        >
                          {m.type === 'video' ? (
                            <>
                              <video src={normalizeMediaPath(m.url) + '#t=0.1'} className="w-full h-full object-cover rounded-lg border border-c-border" muted playsInline preload="metadata" />
                              <div className="absolute inset-0 flex items-center justify-center"><div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center"><i className="fa-solid fa-play text-white text-sm ml-0.5" /></div></div>
                            </>
                          ) : (
                            <MessageImage tile src={normalizeMediaPath(m.url)} alt={t('chat.media_preview_alt')} className="rounded-lg border border-c-border" />
                          )}
                          <div className="absolute bottom-1 left-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-white/80">{formatSmartTime(m.created_at)}</div>
                          {mode.type === 'group' ? <div className="absolute top-1 right-1 text-[10px] px-1.5 py-0.5 rounded bg-black/70 border border-white/10 text-white/60">{m.sender}</div> : null}
                          {selectionMode && canDelete ? (
                            <div className={`absolute inset-0 rounded-lg border-2 ${isSelected ? 'border-cpoint-turquoise bg-cpoint-turquoise/20' : 'border-white/30 bg-black/20'}`}>
                              <div className={`absolute top-1 right-1 w-7 h-7 rounded-full flex items-center justify-center ${isSelected ? 'bg-cpoint-turquoise text-black' : 'bg-black/60 text-white'}`}>
                                <i className={`fa-solid ${isSelected ? 'fa-check' : 'fa-plus'} text-xs`} />
                              </div>
                            </div>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {selectionMode && selected.size > 0 ? (
        <div className="fixed left-0 right-0 bottom-0 z-50 px-4 py-3 bg-c-bg-elevated/95 backdrop-blur border-t border-c-border" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}>
          <button
            disabled={deleting}
            onClick={() => setConfirmState({ kind: 'bulk', items: selectedItems })}
            className="w-full min-h-12 rounded-full bg-red-500/90 text-white font-semibold disabled:opacity-60"
          >
            {deleting ? t('chat.deleting_media') : t('chat.delete_selected_media', { count: selected.size })}
          </button>
        </div>
      ) : null}

      {viewingMedia ? (
        <div className="theme-always-dark fixed inset-0 bg-black z-[9999] flex flex-col" onClick={() => setViewingMedia(null)}>
          <div className="flex items-center justify-between px-4 py-3 bg-black/80" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
            <button onClick={() => setViewingMedia(null)} className="text-white p-2 -ml-2"><i className="fa-solid fa-xmark text-xl" /></button>
            <span className="text-white font-medium">{viewingMedia.type === 'video' ? t('chat.video') : t('chat.photo')}</span>
            <div className="flex items-center gap-1">
              {(!viewer || viewingMedia.sender === viewer) ? (
                <button onClick={event => { event.stopPropagation(); setConfirmState({ kind: 'single', items: [viewingMedia] }) }} className="text-white p-2 hover:bg-white/10 rounded-full" title={t('common.delete')}>
                  <i className="fa-solid fa-trash-can" />
                </button>
              ) : null}
              {mode.type === 'dm' ? (
                <button onClick={event => { event.stopPropagation(); void saveMediaToDevice(normalizeMediaPath(viewingMedia.url), viewingMedia.type) }} className="text-white p-2 hover:bg-white/10 rounded-full" title={t('chat.save_to_device_title')}>
                  <i className="fa-solid fa-download" />
                </button>
              ) : null}
            </div>
          </div>
          <div className="flex-1 flex items-center justify-center overflow-hidden" onClick={e => e.stopPropagation()}>
            {viewingMedia.type === 'video' ? (
              <video src={normalizeMediaPath(viewingMedia.url)} controls autoPlay playsInline className="max-w-full max-h-full" />
            ) : (
              <ZoomableImage src={normalizeMediaPath(viewingMedia.url)} alt={t('chat.media_preview_alt')} className="w-full h-full" onRequestClose={() => setViewingMedia(null)} />
            )}
          </div>
          <div className="flex items-center justify-center px-4 py-4 bg-black/80" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
            <button onClick={() => setViewingMedia(null)} className="px-6 py-3 bg-white/10 text-white rounded-full font-medium hover:bg-white/20 transition">{t('common.close')}</button>
          </div>
        </div>
      ) : null}

      {confirmState ? (
        <div className="fixed inset-0 z-[10060] flex items-end justify-center bg-black/55 p-4" onClick={() => setConfirmState(null)}>
          <div className="w-full max-w-md rounded-3xl border border-c-border bg-c-bg-elevated p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="mb-2 text-lg font-semibold text-c-text-primary">
              {confirmState.kind === 'single'
                ? t(confirmState.items[0]?.type === 'video' ? 'chat.delete_media_confirm_video' : 'chat.delete_media_confirm_photo')
                : t('chat.delete_all_media_confirm', { count: confirmState.items.length })}
            </div>
            <div className="mb-5 text-sm text-c-text-secondary">
              {confirmState.kind === 'single' ? t('chat.delete_media_confirm_body') : t('chat.delete_all_media_confirm_body')}
            </div>
            <div className="flex gap-3">
              <button className="flex-1 rounded-full bg-c-active-bg px-4 py-3 font-semibold text-c-text-primary" onClick={() => setConfirmState(null)}>
                {t('common.cancel')}
              </button>
              <button className="flex-1 rounded-full bg-red-500/90 px-4 py-3 font-semibold text-white disabled:opacity-60" disabled={deleting} onClick={() => void performDelete(confirmState.items)}>
                {deleting ? t('chat.deleting_media') : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
