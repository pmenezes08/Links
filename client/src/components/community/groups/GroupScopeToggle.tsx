import { useTranslation } from 'react-i18next'
import { REDUCED_MOTION_FADE_MS, TAB_CROSSFADE_MS, CPOINT_EASE_OUT } from '../../../design/motion'

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * "This community" / "Include sub-communities (N)" — the one scope control
 * of the Groups tab. With the breadcrumb handling *which* community,
 * changing community is navigation, not a dropdown, so two options are
 * all that's needed.
 */
export default function GroupScopeToggle({
  includeSubs,
  onChange,
  subCount,
}: {
  includeSubs: boolean
  onChange: (next: boolean) => void
  subCount: number
}) {
  const { t } = useTranslation()
  const duration = prefersReducedMotion() ? REDUCED_MOTION_FADE_MS : TAB_CROSSFADE_MS
  const base = 'px-3.5 h-9 rounded-full text-xs font-medium'
  const active = 'bg-cpoint-turquoise/15 text-cpoint-turquoise'
  const idle = 'text-c-text-tertiary hover:text-c-text-secondary'
  const style = { transition: `background-color ${duration}ms ${CPOINT_EASE_OUT}, color ${duration}ms ${CPOINT_EASE_OUT}` }

  return (
    <div role="tablist" aria-label={t('communities.groups_scope_aria')} className="inline-flex p-0.5 rounded-full bg-c-bg-elevated border border-c-border">
      <button
        type="button"
        role="tab"
        aria-selected={!includeSubs}
        className={`${base} ${!includeSubs ? active : idle}`}
        style={style}
        onClick={() => onChange(false)}
      >
        {t('communities.filter_this_community')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={includeSubs}
        className={`${base} ${includeSubs ? active : idle}`}
        style={style}
        onClick={() => onChange(true)}
      >
        {t('communities.groups_scope_include', { count: subCount })}
      </button>
    </div>
  )
}
