import { useCallback, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useHeader } from '../contexts/HeaderContext'
import { useExploreCreations, SECTION_ORDER, sectionOf, type ExploreCreation, type ExploreSectionKind } from '../hooks/useExploreCreations'
import ExploreCard, { PREVIEW_BUDGET } from '../components/explore/ExploreCard'
import ExploreShelf from '../components/explore/ExploreShelf'
import ExploreHero from '../components/explore/ExploreHero'

/**
 * Made with Steve — the anonymous gallery of member creations.
 *
 * Layout is supply-aware: rich catalogs render as sectioned horizontal
 * shelves (Games → Apps → Websites); thin catalogs collapse to one mixed
 * grid (see useExploreCreations). `?kind=` deep-links a filtered full grid
 * ("See all"). Page stays thin — data in useExploreCreations, visuals in
 * components/explore/*.
 */

function SkeletonShelf() {
  return (
    <div className="mb-6">
      <div className="skeleton-box mb-2.5 h-6 w-28 rounded-lg" />
      <div className="-mx-4 flex gap-3 overflow-hidden px-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="w-[68vw] max-w-[280px] flex-none overflow-hidden rounded-2xl border border-c-border sm:w-64">
            <div className="skeleton-box aspect-[16/10] w-full" />
            <div className="p-3">
              <div className="skeleton-box h-4 w-3/4 rounded" />
              <div className="skeleton-box mt-2 h-3 w-1/2 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ExploreCreations() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { t } = useTranslation()
  const { setTitle } = useHeader()
  const { state, items, sections, sectioned, reload } = useExploreCreations()

  const kindParam = (searchParams.get('kind') || '').toLowerCase()
  const filterKind: ExploreSectionKind | null =
    kindParam === 'game' || kindParam === 'app' || kindParam === 'website' ? kindParam : null

  useEffect(() => {
    setTitle(t('explore.title'))
    return () => setTitle('')
  }, [setTitle, t])

  const openCreation = useCallback((item: ExploreCreation) => {
    navigate(item.play_url || `/creation/${item.id}`)
  }, [navigate])

  // The explore→build hook: seed the builder composer with an editable,
  // kind-aware prompt AND the remix source, so the first build seeds from the
  // creation's public HTML (privacy-scoped server-side). Only public data
  // crosses over — never the creator's prompt history or identity.
  const buildYourOwn = useCallback((item: ExploreCreation) => {
    const seed = t(`explore.seed_${sectionOf(item)}`, { title: item.title || '' })
    navigate(`/builder?remix=${item.id}&seed=${encodeURIComponent(seed)}`)
  }, [navigate, t])

  const filteredItems = filterKind ? (sections.find(s => s.kind === filterKind)?.items ?? []) : items

  return (
    <div className="app-content min-h-screen chat-thread-bg text-c-text-primary">
      <div className="mx-auto max-w-5xl px-4 py-6 pb-[var(--app-dashboard-content-pad-bottom)]">
        <ExploreHero onCreate={() => navigate('/builder')} />

        {state === 'loading' && (
          <div aria-busy="true">
            <SkeletonShelf />
            <SkeletonShelf />
          </div>
        )}

        {state === 'error' && (
          <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-6 text-center">
            <p className="text-sm text-c-text-secondary">{t('explore.error_title')}</p>
            <button
              type="button"
              onClick={() => void reload()}
              className="mt-3 rounded-xl bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110"
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {state === 'ready' && items.length === 0 && (
          <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-8 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cpoint-turquoise/15 text-cpoint-turquoise">
              <i className="fa-solid fa-wand-magic-sparkles text-xl" aria-hidden="true" />
            </div>
            <h2 className="text-base font-semibold text-c-text-primary">{t('explore.empty_title')}</h2>
            <p className="mt-1 text-sm text-c-text-tertiary">{t('explore.empty_body')}</p>
            <button
              type="button"
              onClick={() => navigate('/builder')}
              className="mt-4 rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
            >
              {t('explore.empty_cta')}
            </button>
          </div>
        )}

        {state === 'ready' && items.length > 0 && filterKind && (
          <section aria-label={t(`explore.section_${filterKind}`)}>
            <div className="mb-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/explore-creations')}
                className="inline-flex min-h-[32px] items-center gap-1.5 text-sm font-medium text-cpoint-turquoise transition hover:brightness-110"
              >
                <i className="fa-solid fa-chevron-left text-[10px]" aria-hidden="true" /> {t('explore.all_creations')}
              </button>
              <h2 className="text-lg font-semibold text-c-text-primary">{t(`explore.section_${filterKind}`)}</h2>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item, i) => (
                <ExploreCard
                  key={item.id}
                  item={item}
                  withPreview={i < PREVIEW_BUDGET}
                  onOpen={openCreation}
                  onBuildYourOwn={buildYourOwn}
                />
              ))}
            </div>
          </section>
        )}

        {state === 'ready' && items.length > 0 && !filterKind && sectioned && (
          <div>
            {(() => {
              // Preview budget is page-wide: earlier shelves consume it first.
              let consumed = 0
              return SECTION_ORDER.map((kind) => {
                const section = sections.find(s => s.kind === kind)
                if (!section || section.items.length === 0) return null
                const start = consumed
                consumed += section.items.length
                return (
                  <ExploreShelf
                    key={kind}
                    kind={kind}
                    items={section.items}
                    categories={section.categories}
                    previewBudgetStart={start}
                    previewBudget={PREVIEW_BUDGET}
                    onOpen={openCreation}
                    onBuildYourOwn={buildYourOwn}
                    onSeeAll={(k) => navigate(`/explore-creations?kind=${k}`)}
                  />
                )
              })
            })()}
          </div>
        )}

        {state === 'ready' && items.length > 0 && !filterKind && !sectioned && (
          <section aria-label={t('explore.mixed_shelf')}>
            <h2 className="mb-2.5 text-lg font-semibold text-c-text-primary">{t('explore.mixed_shelf')}</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item, i) => (
                <ExploreCard
                  key={item.id}
                  item={item}
                  withPreview={i < PREVIEW_BUDGET}
                  onOpen={openCreation}
                  onBuildYourOwn={buildYourOwn}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
