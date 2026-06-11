import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import SteveAvatar from './SteveAvatar'
import { getKnownSummary, rememberSummary, type KnownSummary } from './steveSummaryStore'
import { useEntitlementsHandler } from '../../contexts/EntitlementsContext'
import { CPOINT_EASE_OUT, TAB_CROSSFADE_MS } from '../../design/motion'

/** Elapsed-ms thresholds for the staged wait line (advance-only, honest:
 * read → comments → write mirrors the real call without claiming events). */
const WAIT_STAGE_COMMENTS_MS = 2_500
const WAIT_STAGE_WRITING_MS = 7_000

export function getSummaryWaitLabel(elapsedMs: number, t: (key: string) => string): string {
  if (elapsedMs >= WAIT_STAGE_WRITING_MS) return t('feed.summary_wait_writing')
  if (elapsedMs >= WAIT_STAGE_COMMENTS_MS) return t('feed.summary_wait_comments')
  return t('feed.summary_wait_reading')
}

function WaitLine() {
  const { t } = useTranslation()
  const [label, setLabel] = useState(() => getSummaryWaitLabel(0, t))
  useEffect(() => {
    const start = Date.now()
    const tick = window.setInterval(() => {
      setLabel(getSummaryWaitLabel(Date.now() - start, t))
    }, 1000)
    return () => window.clearInterval(tick)
  }, [t])
  return (
    <div className="flex h-8 items-center gap-1.5 text-[13px] text-c-text-tertiary" role="status">
      <span className="transition-opacity" style={{ transitionDuration: `${TAB_CROSSFADE_MS}ms` }}>{label}</span>
      <span className="flex gap-0.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" style={{ animationDelay: '300ms' }} />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cpoint-turquoise" style={{ animationDelay: '600ms' }} />
      </span>
    </div>
  )
}

/**
 * "Steve summary" bottom sheet — the glyph is the doorbell, this is Steve
 * answering (his avatar leads the header, per the brand separation rules).
 * Same shell as MatchesSheet/HistorySheet. Mounted only while needed; the
 * enter transition plays via a two-frame open state. Fetches through the
 * entitlements handler so cap denials open the LimitReachedModal and the
 * sheet quietly closes.
 */
export default function SteveSummarySheet({
  postId,
  onClose,
}: {
  postId: number
  onClose: () => void
}) {
  const { t } = useTranslation()
  const entitlementsHandler = useEntitlementsHandler()
  const [shown, setShown] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<KnownSummary | null>(() => getKnownSummary(postId) ?? null)
  const [wasCached, setWasCached] = useState(() => Boolean(getKnownSummary(postId)))

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onClose])

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/post/${postId}/summary`, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      const data = await entitlementsHandler.handleResponse<{
        success?: boolean
        summary?: string
        reply_count?: number
        cached?: boolean
        generated_at?: string | null
        error?: string
      }>(response)
      if (!data) {
        // Entitlements modal took over — get out of its way.
        onClose()
        return
      }
      if (data.success && data.summary) {
        const entry: KnownSummary = {
          summary: data.summary,
          generatedAt: data.generated_at ?? null,
          replyCount: data.reply_count ?? 0,
        }
        rememberSummary(postId, entry)
        setResult(entry)
        setWasCached(Boolean(data.cached))
      } else {
        setError(data.error || t('feed.summary_failed'))
      }
    } catch {
      setError(t('errors.network'))
    } finally {
      setLoading(false)
    }
  }, [postId, entitlementsHandler, onClose, t])

  useEffect(() => {
    if (!result) void fetchSummary()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cachedTimeLabel = (() => {
    if (!result?.generatedAt) return null
    try {
      return new Date(result.generatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    } catch {
      return null
    }
  })()

  return (
    <div
      className={`fixed inset-0 z-[1002] flex items-end justify-center bg-black/60 transition-opacity duration-200 ${shown ? 'opacity-100' : 'opacity-0'}`}
      onClick={e => { if (e.currentTarget === e.target) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-label={t('feed.steve_summary')}
    >
      <div
        className={`w-full max-w-xl max-h-[75dvh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-c-border bg-c-bg-elevated px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] transition-transform duration-[250ms] ${shown ? 'translate-y-0' : 'translate-y-full'} sm:mb-4 sm:rounded-2xl sm:border`}
        style={{ transitionTimingFunction: CPOINT_EASE_OUT }}
        onClick={e => e.stopPropagation()}
      >
        <div className="mx-auto mb-3 h-1 w-11 rounded-full bg-c-text-tertiary/40" aria-hidden="true" />
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-3">
            <SteveAvatar size={32} />
            <div>
              <h2 className="text-base font-semibold text-c-text-primary">{t('feed.steve_summary')}</h2>
              <p className="text-[11px] text-c-text-tertiary">{t('feed.summary_sheet_context')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="flex h-11 w-11 items-center justify-center rounded-full text-c-text-secondary transition hover:bg-c-hover-bg"
          >
            <i className="fa-solid fa-xmark text-sm" />
          </button>
        </div>

        {loading && <WaitLine />}

        {error && !loading && (
          <p className="py-3 text-[13px] text-red-400">{error}</p>
        )}

        {result && !loading && !error && (
          <div className="space-y-3 pb-1">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-c-text-primary">{result.summary}</p>
            <div className="flex items-center gap-3 border-t border-c-border-subtle pt-2">
              {wasCached && cachedTimeLabel && (
                <span className="text-[11px] text-c-text-tertiary">
                  {t('feed.summary_cached_at', { time: cachedTimeLabel })}
                </span>
              )}
              <button
                type="button"
                onClick={() => void fetchSummary()}
                className="ml-auto min-h-[44px] text-[11px] font-medium text-c-text-secondary transition hover:text-c-text-primary"
              >
                {t('feed.summary_refresh')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
