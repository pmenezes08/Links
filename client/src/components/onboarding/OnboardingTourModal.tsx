/**
 * Render-only platform tour modal shown after onboarding completes.
 * Moved verbatim from `pages/OnboardingChat.tsx` — props in, callbacks out
 * (the finish/complete side effects stay with the caller).
 */

import { useTranslation } from 'react-i18next'
import { oc } from '../../i18n/onboardingChatHelpers'

interface TourStep {
  icon: string
  title: string
  description: string
}

interface OnboardingTourModalProps {
  tourStep: number
  tourSteps: TourStep[]
  onClose: () => void
  onBack: () => void
  onNext: () => void
}

export function OnboardingTourModal({
  tourStep,
  tourSteps,
  onClose,
  onBack,
  onNext,
}: OnboardingTourModalProps) {
  const { t } = useTranslation()
  return (
    <div className="fixed inset-0 z-[60] bg-c-bg-overlay backdrop-blur-sm flex items-center justify-center px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="onboarding-tour-title"
        className="w-full max-w-sm bg-c-bg-surface border border-c-border rounded-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-cpoint-turquoise/10 border border-cpoint-turquoise/20 flex items-center justify-center mb-4">
            <i className={`${tourSteps[tourStep].icon} text-2xl text-cpoint-turquoise`} aria-hidden="true" />
          </div>
          <h2 id="onboarding-tour-title" className="text-base font-semibold text-c-text-primary mb-1.5">{tourSteps[tourStep].title}</h2>
          <div className="text-sm text-c-text-tertiary leading-relaxed">{tourSteps[tourStep].description}</div>
        </div>
        {/* Dot indicators */}
        <div className="flex justify-center gap-1.5 pb-3" aria-hidden="true">
          {tourSteps.map((_, i) => (
            <div
              key={i}
              className={`w-1.5 h-1.5 rounded-full transition-colors ${i === tourStep ? 'bg-cpoint-turquoise' : 'bg-c-text-disabled'}`}
            />
          ))}
        </div>
        {/* Navigation */}
        <div className="px-6 pb-5 flex items-center justify-between">
          <button
            onClick={onBack}
            className="px-4 py-2 rounded-lg text-xs font-medium text-c-text-tertiary hover:text-c-text-secondary transition-colors"
          >
            {tourStep > 0 ? oc(t, 'ui.tour_back') : oc(t, 'ui.tour_skip')}
          </button>
          <div className="text-[10px] text-c-text-tertiary">
            {oc(t, 'ui.tour_counter', { current: tourStep + 1, total: tourSteps.length })}
          </div>
          <button
            onClick={onNext}
            className="px-4 py-2 rounded-lg bg-cpoint-turquoise text-c-text-on-accent text-xs font-semibold hover:brightness-110 transition"
          >
            {tourStep < tourSteps.length - 1 ? oc(t, 'ui.tour_next') : oc(t, 'ui.tour_done')}
          </button>
        </div>
      </div>
    </div>
  )
}
