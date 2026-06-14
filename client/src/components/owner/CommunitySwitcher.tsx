import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { OwnerManagedCommunity } from './types'

/**
 * Header title for the Owner Dashboard. When the user owns/manages more than
 * one community it becomes a tappable switcher (bottom sheet) with a tier badge
 * per community; selecting one routes to that community's dashboard, which
 * re-fetches and shows basic or full analytics by its own tier.
 */
export default function CommunitySwitcher({
  communities,
  currentId,
  fallbackName,
}: {
  communities: OwnerManagedCommunity[]
  currentId: number | null
  fallbackName?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)

  const current = communities.find(c => c.id === currentId)
  const name = current?.name || fallbackName || ''
  const multiple = communities.length > 1

  const select = (id: number) => {
    setOpen(false)
    if (id !== currentId) navigate(`/community/${id}/owner`)
  }

  return (
    <div className="min-w-0 flex-1">
      {multiple ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('owner.switch_aria')}
          className="flex max-w-full items-center gap-1.5"
        >
          <span className="truncate text-[15px] font-medium">{name}</span>
          <i className="fa-solid fa-chevron-down text-[10px] text-c-text-tertiary" />
        </button>
      ) : (
        <div className="truncate text-[15px] font-medium">{name}</div>
      )}
      <div className="text-[11px] text-c-text-tertiary">{t('navigation.owner_tools')}</div>

      {open && (
        <div
          className="fixed inset-0 z-[1100] flex items-end justify-center bg-black/55"
          onClick={e => { if (e.currentTarget === e.target) setOpen(false) }}
        >
          <div
            className="w-full max-w-xl rounded-t-2xl border-t border-c-border bg-c-bg-elevated px-3 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] sm:mb-4 sm:rounded-2xl sm:border"
            onClick={e => e.stopPropagation()}
          >
            <div className="mx-auto mb-3 h-1 w-11 rounded-full bg-c-text-tertiary/40" aria-hidden="true" />
            <div className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-cpoint-turquoise">
              {t('owner.switch_title')}
            </div>
            <div className="space-y-1">
              {communities.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => select(c.id)}
                  className={`flex w-full items-center justify-between rounded-xl px-4 py-3 text-left transition-colors hover:bg-c-hover-bg ${
                    c.id === currentId ? 'bg-c-hover-bg' : ''
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate text-c-text-primary">{c.name}</span>
                  <span className="ml-2 flex shrink-0 items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] ${
                        c.is_paid
                          ? 'bg-cpoint-turquoise/15 text-cpoint-turquoise'
                          : 'border border-c-border text-c-text-tertiary'
                      }`}
                    >
                      {c.is_paid ? t('owner.tier_paid') : t('owner.tier_free')}
                    </span>
                    {c.id === currentId && <i className="fa-solid fa-check text-xs text-cpoint-turquoise" />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
