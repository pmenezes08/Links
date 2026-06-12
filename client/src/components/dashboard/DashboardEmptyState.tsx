import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CPOINT_EASE_OUT, REDUCED_MOTION_FADE_MS, TAB_CROSSFADE_MS } from '../../design/motion'

/**
 * Zero-communities dashboard state: one welcome card centered in the black
 * canvas. Two doors (create / join-by-handle) and a quiet text link — never
 * three pills — plus a plain-text mantra line. Nothing below the welcome
 * card may wear control grammar: on this canvas a bordered rounded card
 * with a turquoise icon chip reads as tappable, so non-interactive content
 * is typography only (see docs/DESIGN.md § Asks & CTAs).
 */
export default function DashboardEmptyState({
  onCreate,
  onJoin,
  onAbout,
}: {
  onCreate: () => void
  onJoin: () => void
  onAbout: () => void
}) {
  const { t } = useTranslation()

  // One-shot fade from the skeleton state — the sanctioned dashboard
  // crossfade, not a decorative entrance.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])
  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <div
      className="flex min-h-[60vh] flex-col justify-center px-3 py-6"
      style={{
        opacity: entered ? 1 : 0,
        transition: `opacity ${reducedMotion ? REDUCED_MOTION_FADE_MS : TAB_CROSSFADE_MS}ms ${CPOINT_EASE_OUT}`,
      }}
    >
      <div className="mx-auto w-full max-w-md">
        <div className="liquid-glass-surface overflow-hidden rounded-3xl border border-c-border p-6 text-center shadow-c-glass">
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cpoint-turquoise">
            {t('dashboard.welcome_badge')}
          </div>
          <h2 className="mt-2 text-xl font-semibold leading-tight tracking-[-0.025em] text-c-text-primary sm:text-[22px]">
            {t('dashboard.welcome_headline')}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-c-text-tertiary">
            {t('dashboard.welcome_body')}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <button
              type="button"
              className="rounded-full bg-cpoint-turquoise px-5 py-2.5 font-semibold text-black shadow-lg transition-transform hover:brightness-110 active:scale-95 touch-manipulation"
              onClick={onCreate}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {t('dashboard.create_first_community')}
            </button>
            {/* Finding is co-equal with creating — a new member who arrived
                with a handle on a business card must be able to use it
                before anything else (no profile needed). */}
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-full border border-cpoint-turquoise/40 px-5 py-2.5 font-medium text-c-accent-ink transition hover:bg-cpoint-turquoise/10 active:scale-[0.99] touch-manipulation"
              onClick={onJoin}
            >
              <i className="fa-solid fa-at text-sm" aria-hidden="true" />
              {t('communities.find_entry_label')}
            </button>
          </div>
          {/* Explainer, not a door — text link, underlined at rest because
              touch surfaces have no hover to reveal interactivity. */}
          <button
            type="button"
            className="mx-auto mt-3 block min-h-11 text-sm text-c-text-tertiary underline underline-offset-4 transition hover:text-c-text-secondary"
            onClick={onAbout}
          >
            {t('dashboard.how_it_works')}
          </button>
        </div>
        <p className="mt-6 text-center text-[13px] tracking-wide text-c-text-tertiary">
          {t('dashboard.welcome_mantra_1')}
          <span className="mx-2 text-cpoint-turquoise" aria-hidden="true">
            ·
          </span>
          {t('dashboard.welcome_mantra_2')}
          <span className="mx-2 text-cpoint-turquoise" aria-hidden="true">
            ·
          </span>
          {t('dashboard.welcome_mantra_3')}
        </p>
      </div>
    </div>
  )
}
