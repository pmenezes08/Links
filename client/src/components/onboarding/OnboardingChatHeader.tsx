/**
 * Render-only header for the onboarding chat: brand mark, Steve identity
 * row, exit-for-now button, and the progress bar. Moved verbatim from
 * `pages/OnboardingChat.tsx` — props in, callbacks out, zero behavior.
 */

import BrandLogo from '../BrandLogo'
import SteveAvatar from '../steve/SteveAvatar'
import { useTranslation } from 'react-i18next'
import { oc } from '../../i18n/onboardingChatHelpers'
import type { OnboardingProgressPoint } from './onboardingProgress'

interface OnboardingChatHeaderProps {
  progress: OnboardingProgressPoint
  onExitClick: () => void
}

export function OnboardingChatHeader({ progress, onExitClick }: OnboardingChatHeaderProps) {
  const { t } = useTranslation()
  return (
    <div className="shrink-0 border-b border-c-border bg-c-bg-app/95 backdrop-blur-sm">
      <div className="max-w-lg mx-auto px-4 pb-2 flex flex-col items-center" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
        <div className="flex items-center gap-2 mb-2">
          <BrandLogo className="w-8 h-8 rounded-lg object-contain" />
        </div>
        <div className="w-full flex items-center gap-3 pb-2">
          <SteveAvatar size={28} />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-c-text-primary">{oc(t, 'ui.steve')}</div>
          </div>
          <button
            type="button"
            onClick={onExitClick}
            className="rounded-full border border-c-border px-2.5 py-1 text-[10px] font-medium text-c-text-tertiary hover:text-c-text-primary hover:border-c-border-strong transition"
          >
            {oc(t, 'ui.exit_for_now')}
          </button>
          <div className="text-[10px] text-c-text-tertiary">
            {progress.track === 'b2b'
              ? `${oc(t, 'ui.progress_network_label')} · ${oc(t, 'ui.step_of', { current: progress.current, total: progress.total })}`
              : oc(t, 'ui.step_of', { current: progress.current, total: progress.total })}
          </div>
        </div>
      </div>
      {/* Progress bar */}
      <div
        className="h-0.5 bg-c-hover-bg"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.current}
        aria-label={oc(t, 'ui.step_of', { current: progress.current, total: progress.total })}
      >
        <div
          className="h-full bg-cpoint-turquoise transition-all duration-700 ease-out"
          style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
        />
      </div>
    </div>
  )
}
