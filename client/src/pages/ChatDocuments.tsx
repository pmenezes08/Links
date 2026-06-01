import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { formatSmartTime, parseFlexibleDate } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'
import { resolveDocUrl } from '../chat/utils'

type DocumentItem = {
  id: number
  message_id: number
  sender: string
  url: string
  file_name: string
  created_at: string | number | Date
}

export default function ChatDocuments() {
  const { t } = useTranslation()
  const { username } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [items, setItems] = useState<DocumentItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setTitle(t('chat.documents_title')) }, [setTitle, t])

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      try {
        const r = await fetch(`/api/chat/documents?peer=${encodeURIComponent(username || '')}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const j = await r.json()
        if (!mounted) return
        if (j?.success) {
          setItems(j.documents || [])
          setError(null)
        } else {
          setError(j?.error || t('chat.failed_load_documents'))
        }
      } catch {
        if (mounted) setError(t('chat.failed_load_documents'))
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [username, t])

  const groups = useMemo(() => {
    const unknownKey = t('chat.unknown_date')
    const map: Record<string, DocumentItem[]> = {}
    for (const it of items) {
      const d = parseFlexibleDate(it.created_at)
      const key = d && !isNaN(d.getTime()) ? d.toISOString().split('T')[0] : unknownKey
      if (!map[key]) map[key] = []
      map[key].push(it)
    }
    const keys = Object.keys(map).sort((a, b) => (a === unknownKey ? 1 : b === unknownKey ? -1 : a < b ? 1 : -1))
    const formatted = keys.map(k => {
      if (k === unknownKey) return unknownKey
      const d = parseFlexibleDate(k)
      if (!d || isNaN(d.getTime())) return unknownKey
      const today = new Date()
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      if (d.toDateString() === today.toDateString()) return t('chat.today')
      if (d.toDateString() === yesterday.toDateString()) return t('chat.yesterday_cap')
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    })
    return { keys: formatted, map, originalKeys: keys }
  }, [items, t])

  if (loading) return <div className="p-4 text-c-text-tertiary">{t('common.loading')}</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      <div
        className="fixed left-0 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40 border-b border-c-border"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-c-hover-bg" onClick={() => navigate(-1)} aria-label={t('common.back')}>
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 font-medium">{t('chat.documents_title')}</div>
          <div className="text-sm text-c-text-tertiary">{t('chat.item_count', { count: items.length })}</div>
        </div>
      </div>

      <div
        className="app-subnav-offset max-w-2xl mx-auto pb-20 px-3 overflow-y-auto no-scrollbar"
        style={{ WebkitOverflowScrolling: 'touch' as any, minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        {items.length === 0 ? (
          <div className="text-center py-12">
            <i className="fa-solid fa-file-pdf text-4xl mb-3 block opacity-50 text-c-text-tertiary" />
            <p className="text-lg font-medium text-c-text-tertiary">{t('chat.no_documents')}</p>
          </div>
        ) : (
          <div className="space-y-8 pt-4">
            {groups.keys.map((label, index) => {
              const docsForDate = groups.map[groups.originalKeys[index]] || []
              return (
                <div key={label} className="space-y-3">
                  <div className="text-sm text-c-text-tertiary font-medium border-b border-c-border pb-2">
                    {label} ({docsForDate.length})
                  </div>
                  <div className="space-y-2">
                    {docsForDate.map(doc => (
                      <a
                        key={doc.id}
                        href={resolveDocUrl(doc.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-xl border border-c-border bg-white/[0.04] px-3 py-3 hover:bg-white/[0.08] transition-colors"
                      >
                        <div className="w-10 h-10 rounded-lg bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
                          <i className="fa-solid fa-file-pdf text-cpoint-turquoise" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium truncate">{doc.file_name || t('chat.pdf_document')}</div>
                          <div className="text-[11px] text-c-text-tertiary">
                            {doc.sender} · {formatSmartTime(doc.created_at)}
                          </div>
                        </div>
                        <i className="fa-solid fa-arrow-up-right-from-square text-c-text-tertiary text-xs flex-shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
