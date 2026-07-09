/**
 * Render-only "finish later" confirmation modal for the onboarding chat.
 * Moved verbatim from `pages/OnboardingChat.tsx` — props in, callbacks out.
 */

import { useTranslation } from 'react-i18next'
import { oc } from '../../i18n/onboardingChatHelpers'

interface OnboardingDeferModalProps {
  deferringProfile: boolean
  deferError: string
  onKeepGoing: () => void
  onFinishLater: () => void
}

export function OnboardingDeferModal({
  deferringProfile,
  deferError,
  onKeepGoing,
  onFinishLater,
}: OnboardingDeferModalProps) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-c-bg-overlay px-4 backdrop-blur-sm" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-defer-title"
        className="w-full max-w-sm rounded-3xl border border-cpoint-turquoise/25 bg-c-bg-elevated p-5 shadow-[0_24px_80px_rgba(0,206,200,0.16)]"
      >
        <h2 id="onboarding-defer-title" className="text-lg font-semibold text-c-text-primary">{oc(t, 'ui.need_more_time')}</h2>
        <div className="mt-3 text-sm leading-relaxed text-c-text-secondary">{oc(t, 'ui.defer_body')}</div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onKeepGoing}
            className="flex-1 rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 px-4 py-2.5 text-sm font-semibold text-c-accent-ink transition hover:bg-cpoint-turquoise/15"
          >
            {oc(t, 'ui.keep_going')}
          </button>
          <button
            type="button"
            onClick={onFinishLater}
            disabled={deferringProfile}
            className="flex-1 rounded-xl border border-c-border bg-c-hover-bg px-4 py-2.5 text-sm font-semibold text-c-text-secondary transition hover:bg-c-active-bg disabled:opacity-50"
          >
            {deferringProfile ? oc(t, 'ui.saving') : oc(t, 'ui.finish_later_btn')}
          </button>
        </div>
        {deferError && (
          <div role="alert" className="mt-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-100">
            {deferError}
          </div>
        )}
      </div>
    </div>
  )
}
