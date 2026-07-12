import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ExploreCard from './ExploreCard'
import type { ExploreCreation, ExploreSectionKind } from '../../hooks/useExploreCreations'

/**
 * One horizontal shelf (App-Store style) for a gallery section. Cards snap;
 * ~1.4 cards peek on mobile so the horizontal scroll affordance is obvious.
 * "See all" only renders when the shelf overflows its visible run.
 *
 * Sub-category chips filter the shelf in place, and are supply-gated so a
 * thin catalog never shows chips over 1-2 items: the row renders only when
 * the section holds ≥ 2 distinct categories AND ≥ 6 items, and only chips
 * with items behind them exist. Untagged items show under "All" only.
 */

const SEE_ALL_THRESHOLD = 6
const CHIPS_MIN_ITEMS = 6
const CHIPS_MIN_CATEGORIES = 2

type Props = {
  kind: ExploreSectionKind
  items: ExploreCreation[]
  categories: Record<string, number>
  previewBudgetStart: number
  previewBudget: number
  onOpen: (item: ExploreCreation) => void
  onBuildYourOwn: (item: ExploreCreation) => void
  onBuilderTap?: (builder: string) => void
  /** Carries the active chip so "See all" deep-links the filtered grid. */
  onSeeAll: (kind: ExploreSectionKind, category?: string | null) => void
}

export default function ExploreShelf({ kind, items, categories, previewBudgetStart, previewBudget, onOpen, onBuildYourOwn, onBuilderTap, onSeeAll }: Props) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string | null>(null)
  if (items.length === 0) return null

  const categorySlugs = Object.keys(categories).filter(slug => categories[slug] > 0)
  const showChips = items.length >= CHIPS_MIN_ITEMS && categorySlugs.length >= CHIPS_MIN_CATEGORIES
  const visible = showChips && selected ? items.filter(i => i.category === selected) : items

  return (
    <section className="mb-6" aria-label={t(`explore.section_${kind}`)}>
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-c-text-primary">{t(`explore.section_${kind}`)}</h2>
        {items.length > SEE_ALL_THRESHOLD && (
          <button
            type="button"
            onClick={() => onSeeAll(kind, selected)}
            className="inline-flex min-h-[32px] items-center gap-1 text-sm font-medium text-cpoint-turquoise transition hover:brightness-110"
          >
            {t('explore.see_all')} <i className="fa-solid fa-chevron-right text-[10px]" aria-hidden="true" />
          </button>
        )}
      </div>
      {showChips && (
        <div className="-mx-4 mb-2.5 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label={t(`explore.section_${kind}`)}>
          <button
            type="button"
            onClick={() => setSelected(null)}
            aria-pressed={selected === null}
            className={`min-h-[32px] flex-none rounded-full border px-3 text-xs font-medium transition ${selected === null ? 'border-cpoint-turquoise bg-cpoint-turquoise text-black' : 'border-c-border text-c-text-secondary hover:text-c-text-primary'}`}
          >
            {t('explore.all_creations')}
          </button>
          {categorySlugs.map(slug => (
            <button
              key={slug}
              type="button"
              onClick={() => setSelected(prev => (prev === slug ? null : slug))}
              aria-pressed={selected === slug}
              className={`min-h-[32px] flex-none rounded-full border px-3 text-xs font-medium transition ${selected === slug ? 'border-cpoint-turquoise bg-cpoint-turquoise text-black' : 'border-c-border text-c-text-secondary hover:text-c-text-primary'}`}
            >
              {t(`explore.category.${slug}`, { defaultValue: slug })}
            </button>
          ))}
        </div>
      )}
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.map((item, i) => (
          <ExploreCard
            key={item.id}
            item={item}
            withPreview={previewBudgetStart + i < previewBudget}
            onOpen={onOpen}
            onBuildYourOwn={onBuildYourOwn}
            onBuilderTap={onBuilderTap}
            className="w-[68vw] max-w-[280px] flex-none snap-start sm:w-64"
          />
        ))}
      </div>
    </section>
  )
}
