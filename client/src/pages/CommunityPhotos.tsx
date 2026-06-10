import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'

type MediaItem = {
  id: string
  post_id: number
  reply_id: number | null
  username: string
  image_url: string
  type?: 'image' | 'video'
  created_at: string | number | Date
}

const UNKNOWN_DATE_KEY = '__unknown__'

export default function CommunityPhotos(){
  const { t, i18n } = useTranslation()
  const { community_id } = useParams()
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('group_id')
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [items, setItems] = useState<MediaItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const dateLocale = i18n.language === 'pt-PT' ? 'pt-PT' : 'en'

  useEffect(() => { setTitle(t('feed.media')) }, [setTitle, t])

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const url = groupId
          ? `/api/group_photos/${groupId}`
          : `/api/community_photos?community_id=${community_id}`
        const r = await fetch(url, { credentials:'include', headers: { 'Accept': 'application/json' } })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){ setItems(j.photos || j.media || []); setError(null) }
        else setError(j?.error || t('feed.media_page.load_failed'))
      }catch{
        if (mounted) setError(t('feed.media_page.load_failed'))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [community_id, groupId, t])

  const groups = useMemo(() => {
    const map: Record<string, MediaItem[]> = {}
    for (const it of items){
      const parsedDate = parseFlexibleDate(it.created_at)
      let dateKey = UNKNOWN_DATE_KEY

      if (parsedDate && !isNaN(parsedDate.getTime())) {
        dateKey = parsedDate.toISOString().split('T')[0]
      }

      if (!map[dateKey]) map[dateKey] = []
      map[dateKey].push(it)
    }

    const keys = Object.keys(map).sort((a,b) => {
      if (a === UNKNOWN_DATE_KEY) return 1
      if (b === UNKNOWN_DATE_KEY) return -1
      return a < b ? 1 : -1
    })

    for (const k of keys){
      if (k !== UNKNOWN_DATE_KEY) {
        map[k].sort((a,b) => {
          const dateA = parseFlexibleDate(a.created_at)
          const dateB = parseFlexibleDate(b.created_at)
          if (!dateA && !dateB) return 0
          if (!dateA) return 1
          if (!dateB) return -1
          return dateA.getTime() - dateB.getTime()
        })
      }
    }

    const formattedKeys = keys.map(key => {
      if (key === UNKNOWN_DATE_KEY) return t('feed.media_page.unknown_date')

      const date = parseFlexibleDate(key)
      if (!date || isNaN(date.getTime())) return t('feed.media_page.unknown_date')

      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)

      if (date.toDateString() === today.toDateString()) {
        return t('chat.today')
      } else if (date.toDateString() === yesterday.toDateString()) {
        return t('chat.yesterday_cap')
      } else {
        return date.toLocaleDateString(dateLocale, {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        })
      }
    })

    return { keys: formattedKeys, map, originalKeys: keys }
  }, [items, t, dateLocale])

  const backToFeed = () =>
    navigate(groupId ? `/group_feed_react/${groupId}` : `/community_feed_react/${community_id}`)

  const emptyHint = groupId
    ? t('feed.media_page.empty_hint_group')
    : t('feed.media_page.empty_hint_community')

  const photosChrome = (body: ReactNode) => (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      <div
        className="fixed left-0 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-c-hover-bg" onClick={backToFeed} aria-label={t('common.back')}>
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 font-medium">{t('feed.media')}</div>
        </div>
      </div>
      <div
        className="app-subnav-offset max-w-2xl mx-auto pb-20 px-3 overflow-y-auto no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
          '--app-subnav-height': '40px',
        } as CSSProperties}
      >
        {body}
      </div>
    </div>
  )

  if (loading) return photosChrome(<div className="text-c-text-tertiary py-8">{t('common.loading')}</div>)
  if (error) return photosChrome(<div className="text-red-400 py-8">{error}</div>)

  return photosChrome(
        <>
        {items.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-c-text-tertiary mb-4">
              <i className="fa-solid fa-photo-film text-4xl mb-3 block opacity-50"></i>
              <p className="text-lg font-medium">{t('feed.media_page.empty_title')}</p>
              <p className="text-sm">{emptyHint}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {groups.keys.map((formattedDateKey, index) => {
              const originalDateKey = groups.originalKeys[index]
              const photosForDate = groups.map[originalDateKey] || []
              const countLabel = t('feed.media_page.date_group', { date: formattedDateKey, count: photosForDate.length })

              return (
                <div key={formattedDateKey} className="space-y-3">
                  <div className="text-sm text-c-text-tertiary font-medium border-b border-c-border pb-2">
                    {countLabel}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {photosForDate.map(p => (
                      <div key={p.id} className="relative group aspect-square">
                        {p.type === 'video' || p.image_url?.match(/\.(mp4|mov|webm|m4v)$/i) ? (
                          <>
                            <video
                              src={p.image_url.includes('#') ? p.image_url : `${p.image_url}#t=0.1`}
                              className="w-full h-full object-cover rounded-lg border border-c-border cursor-pointer hover:border-white/20 transition-colors"
                              muted
                              playsInline
                              preload="metadata"
                              onClick={() => navigate(`/post/${p.post_id}`)}
                            />
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                              <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center">
                                <i className="fa-solid fa-play text-white text-sm ml-0.5" />
                              </div>
                            </div>
                          </>
                        ) : (
                          <img
                            src={p.image_url}
                            alt={t('feed.media_page.media_alt')}
                            className="w-full h-full object-cover rounded-lg border border-c-border cursor-pointer hover:border-white/20 transition-colors"
                            onClick={() => navigate(`/post/${p.post_id}`)}
                          />
                        )}
                        <div className="absolute bottom-2 left-2 text-xs px-2 py-1 rounded bg-black/70 border border-c-border text-white">
                          {formatSmartTime(p.created_at)}
                        </div>
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            className="px-2 py-1 text-xs rounded bg-black/60 border border-c-border hover:bg-black/80"
                            onClick={(e) => {
                              e.stopPropagation()
                              navigate(`/post/${p.post_id}`)
                            }}
                          >
                            {t('feed.media_page.view')}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        </>
  )
}
