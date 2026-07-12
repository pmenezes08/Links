import { useTranslation } from 'react-i18next'

/**
 * Gallery hero: title, the browse→build pitch, the single privacy line, and
 * the page's ONE turquoise-fill action ("Create with Steve"). Every other
 * affordance on the page stays ghost/tertiary so this CTA keeps its meaning.
 */

type Props = { onCreate: () => void }

export default function ExploreHero({ onCreate }: Props) {
  const { t } = useTranslation()
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-c-text-primary">{t('explore.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-c-text-secondary">{t('explore.description')}</p>
        <p className="mt-1 text-xs text-c-text-tertiary">{t('explore.privacy')}</p>
      </div>
      <button
        type="button"
        onClick={onCreate}
        className="w-full rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-sm font-semibold text-black transition hover:brightness-110 active:scale-[0.99] sm:w-auto"
      >
        {t('explore.create_cta')}
      </button>
    </div>
  )
}
