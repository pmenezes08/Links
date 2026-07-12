import { useTranslation } from 'react-i18next'
import CreationPreview from '../builder/CreationPreview'
import { sectionOf, type ExploreCreation } from '../../hooks/useExploreCreations'

/**
 * One gallery card. The whole card is the tap target (opens the creation);
 * the only inner control is the ghost "Build your own" hook, which seeds the
 * builder composer. No per-card turquoise fill — the page's single primary
 * action is the hero's "Create with Steve".
 *
 * Cover: a deterministic kind-tinted gradient paints from frame one; cards
 * inside the live-preview budget layer a lazy sandboxed micro-preview
 * (CreationPreview) over it once the artifact HTML resolves.
 */

// Social proof floor: "3 opens" reads as unpopular on a discovery surface.
const PLAYS_FLOOR = 10
// Concurrent live-iframe budget per page render (they're expensive); cards
// beyond it keep the gradient cover. IntersectionObserver already prevents
// off-screen mounts inside the budget.
export const PREVIEW_BUDGET = 6

const KIND_GLYPH: Record<string, string> = {
  game: 'fa-gamepad',
  app: 'fa-mobile-screen',
  website: 'fa-globe',
}

// Two gradient variants per kind, picked by id so shelves look varied but any
// given card is stable across renders.
const KIND_GRADIENTS: Record<string, string[]> = {
  game: [
    'bg-gradient-to-br from-cpoint-turquoise/30 via-violet-500/15 to-black',
    'bg-gradient-to-br from-violet-500/25 via-cpoint-turquoise/10 to-black',
  ],
  app: [
    'bg-gradient-to-br from-cpoint-turquoise/25 via-slate-500/15 to-black',
    'bg-gradient-to-br from-sky-500/20 via-cpoint-turquoise/10 to-black',
  ],
  website: [
    'bg-gradient-to-br from-slate-400/20 via-slate-600/10 to-black',
    'bg-gradient-to-br from-cpoint-turquoise/15 via-slate-500/10 to-black',
  ],
}

type Props = {
  item: ExploreCreation
  withPreview: boolean
  onOpen: (item: ExploreCreation) => void
  onBuildYourOwn: (item: ExploreCreation) => void
  className?: string
}

export default function ExploreCard({ item, withPreview, onOpen, onBuildYourOwn, className = '' }: Props) {
  const { t } = useTranslation()
  const section = sectionOf(item)
  const gradients = KIND_GRADIENTS[section]
  const gradient = gradients[Math.abs(item.id) % gradients.length]
  const kindLabel = t(`explore.kind_${section}`)
  const openLabel = t(`explore.open_${section}`)
  const plays = Number(item.plays || 0)
  const categoryLabel = item.category ? t(`explore.category.${item.category}`, { defaultValue: '' }) : ''
  const canPreview = withPreview && typeof IntersectionObserver !== 'undefined'

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${openLabel}: ${item.title || 'Untitled creation'} (${kindLabel})`}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(item) } }}
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-c-border bg-c-bg-elevated text-left shadow-c-card transition active:scale-[0.99] ${className}`}
    >
      <div className={`relative aspect-[16/10] w-full overflow-hidden ${gradient}`}>
        <i
          className={`fa-solid ${KIND_GLYPH[section]} absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-5xl text-white/10`}
          aria-hidden="true"
        />
        {canPreview && <CreationPreview creationId={item.id} background="transparent" />}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
          <i className={`fa-solid ${KIND_GLYPH[section]} text-[9px]`} aria-hidden="true" />
          {kindLabel}
        </span>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <h3 className="line-clamp-2 text-[15px] font-semibold text-c-text-primary">{item.title || 'Untitled creation'}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-xs text-c-text-tertiary">
          {categoryLabel && <span>{categoryLabel}</span>}
          {categoryLabel && plays >= PLAYS_FLOOR && <span aria-hidden="true">·</span>}
          {plays >= PLAYS_FLOOR && <span>{t('explore.opens', { count: plays })}</span>}
          {!categoryLabel && plays < PLAYS_FLOOR && <span>{item.label || t('explore.made_with_steve')}</span>}
        </p>
        <div className="mt-3 flex flex-1 items-end justify-between gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onBuildYourOwn(item) }}
            className="inline-flex min-h-[32px] items-center text-xs font-semibold text-cpoint-turquoise transition hover:brightness-110"
          >
            {t('explore.build_your_own')}
          </button>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-c-text-secondary transition group-hover:text-c-text-primary">
            {openLabel} <i className="fa-solid fa-arrow-right text-[10px]" aria-hidden="true" />
          </span>
        </div>
      </div>
    </div>
  )
}
