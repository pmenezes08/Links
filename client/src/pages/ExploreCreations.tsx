import { useCallback, useEffect, useState } from 'react'
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
  // "More from this builder" — filters by the creator's opt-in pseudonym.
  const filterBuilder = (searchParams.get('builder') || '').trim() || null
  // Deep-linked sub-category grid ("only travel apps"). Unknown slugs simply
  // match nothing beyond the kind filter — never a blank page.
  const filterCategory = (searchParams.get('category') || '').trim().toLowerCase() || null
  // Free-text narrowing ("only chess games") — supply-gated below.
  const [searchTerm, setSearchTerm] = useState('')

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

  const builderTap = useCallback((name: string) => {
    navigate(`/explore-creations?builder=${encodeURIComponent(name)}`)
  }, [navigate])

  const baseFiltered = filterBuilder
    ? items.filter(i => (i.builder || '') === filterBuilder)
    : filterKind
      ? (sections.find(s => s.kind === filterKind)?.items ?? [])
          .filter(i => !filterCategory || (i.category || '') === filterCategory)
      : items
  const filterActive = Boolean(filterKind || filterBuilder)
  const featuredItems = items.filter(i => i.featured)

  // Search shows on any deep grid with a couple of items (founder call
  // 2026-07-12: an empty search is a feature — the 0-match state demos the
  // "build the first one" nudge).
  const searchable = filterActive && baseFiltered.length >= 2
  const term = searchable ? searchTerm.trim().toLowerCase() : ''
  const filteredItems = term
    ? baseFiltered.filter(i =>
        (i.title || '').toLowerCase().includes(term) || (i.hook || '').toLowerCase().includes(term))
    : baseFiltered
  // Founder-ratified: 0-1 matches shows the build-the-first nudge INSTEAD of
  // a lonely grid (1 is deliberately treated as 0).
  const showSearchNudge = Boolean(term) && filteredItems.length <= 1

  const buildFromTerm = useCallback(() => {
    const seed = t('explore.seed_term', { term: searchTerm.trim() })
    navigate(`/builder?seed=${encodeURIComponent(seed)}`)
  }, [navigate, t, searchTerm])

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

        {state === 'ready' && items.length > 0 && filterActive && (
          <section aria-label={filterBuilder ? t('explore.more_from_builder') : t(`explore.section_${filterKind}`)}>
            <div className="mb-3 flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate('/explore-creations')}
                className="inline-flex min-h-[32px] items-center gap-1.5 text-sm font-medium text-cpoint-turquoise transition hover:brightness-110"
              >
                <i className="fa-solid fa-chevron-left text-[10px]" aria-hidden="true" /> {t('explore.all_creations')}
              </button>
              <h2 className="text-lg font-semibold text-c-text-primary">
                {filterBuilder
                  ? t('explore.by_builder', { name: filterBuilder })
                  : filterCategory
                    ? `${t(`explore.section_${filterKind}`)} · ${t(`explore.category.${filterCategory}`, { defaultValue: filterCategory })}`
                    : t(`explore.section_${filterKind}`)}
              </h2>
            </div>
            {searchable && (
              <input
                type="search"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('explore.search_placeholder')}
                aria-label={t('explore.search_placeholder')}
                className="mb-3 w-full rounded-xl border border-c-border bg-c-bg-elevated px-3.5 py-2.5 text-[15px] text-c-text-primary outline-none placeholder:text-c-text-tertiary focus:border-cpoint-turquoise/50"
              />
            )}
            {searchable && term && !showSearchNudge && (
              <p className="mb-2 text-xs text-c-text-tertiary" aria-live="polite">
                {t('explore.search_results', { count: filteredItems.length })}
              </p>
            )}
            {showSearchNudge ? (
              <div className="rounded-2xl border border-c-border bg-c-bg-elevated p-8 text-center" aria-live="polite">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-cpoint-turquoise/15 text-cpoint-turquoise">
                  <i className="fa-solid fa-wand-magic-sparkles text-xl" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-c-text-primary">
                  {t('explore.search_empty_title', { term: searchTerm.trim() })}
                </h3>
                <p className="mt-1 text-sm text-c-text-tertiary">{t('explore.search_empty_body')}</p>
                <button
                  type="button"
                  onClick={buildFromTerm}
                  className="mt-4 rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-110"
                >
                  {t('explore.search_empty_cta')}
                </button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filteredItems.map((item, i) => (
                  <ExploreCard
                    key={item.id}
                    item={item}
                    withPreview={i < PREVIEW_BUDGET}
                    onOpen={openCreation}
                    onBuildYourOwn={buildYourOwn}
                    onBuilderTap={builderTap}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {state === 'ready' && items.length > 0 && !filterActive && featuredItems.length > 0 && (
          <section className="mb-6" aria-label={t('explore.featured')}>
            <h2 className="mb-2.5 text-lg font-semibold text-c-text-primary">{t('explore.featured')}</h2>
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {featuredItems.map((item, i) => (
                <ExploreCard
                  key={item.id}
                  item={item}
                  withPreview={i < 2}
                  onOpen={openCreation}
                  onBuildYourOwn={buildYourOwn}
                  onBuilderTap={builderTap}
                  className="w-[85vw] max-w-[360px] flex-none snap-start sm:w-80"
                />
              ))}
            </div>
          </section>
        )}

        {state === 'ready' && items.length > 0 && !filterActive && sectioned && (
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
                    onBuilderTap={builderTap}
                    onSeeAll={(k, cat) => navigate(`/explore-creations?kind=${k}${cat ? `&category=${encodeURIComponent(cat)}` : ''}`)}
                  />
                )
              })
            })()}
          </div>
        )}

        {state === 'ready' && items.length > 0 && !filterActive && !sectioned && (
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
                  onBuilderTap={builderTap}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
