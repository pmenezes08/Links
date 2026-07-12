import { useTranslation } from 'react-i18next'
import ExploreCard from './ExploreCard'
import type { ExploreCreation, ExploreSectionKind } from '../../hooks/useExploreCreations'

/**
 * One horizontal shelf (App-Store style) for a gallery section. Cards snap;
 * ~1.4 cards peek on mobile so the horizontal scroll affordance is obvious.
 * "See all" only renders when the shelf overflows its visible run.
 */

const SEE_ALL_THRESHOLD = 6

type Props = {
  kind: ExploreSectionKind
  items: ExploreCreation[]
  previewBudgetStart: number
  previewBudget: number
  onOpen: (item: ExploreCreation) => void
  onBuildYourOwn: (item: ExploreCreation) => void
  onSeeAll: (kind: ExploreSectionKind) => void
}

export default function ExploreShelf({ kind, items, previewBudgetStart, previewBudget, onOpen, onBuildYourOwn, onSeeAll }: Props) {
  const { t } = useTranslation()
  if (items.length === 0) return null
  return (
    <section className="mb-6" aria-label={t(`explore.section_${kind}`)}>
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <h2 className="text-lg font-semibold text-c-text-primary">{t(`explore.section_${kind}`)}</h2>
        {items.length > SEE_ALL_THRESHOLD && (
          <button
            type="button"
            onClick={() => onSeeAll(kind)}
            className="inline-flex min-h-[32px] items-center gap-1 text-sm font-medium text-cpoint-turquoise transition hover:brightness-110"
          >
            {t('explore.see_all')} <i className="fa-solid fa-chevron-right text-[10px]" aria-hidden="true" />
          </button>
        )}
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item, i) => (
          <ExploreCard
            key={item.id}
            item={item}
            withPreview={previewBudgetStart + i < previewBudget}
            onOpen={onOpen}
            onBuildYourOwn={onBuildYourOwn}
            className="w-[68vw] max-w-[280px] flex-none snap-start sm:w-64"
          />
        ))}
      </div>
    </section>
  )
}
