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
 * The one scope control of the Groups tab: the community's own name vs
 * "In sub-communities". Naming the left option after the community it
 * scopes to (rather than a generic "This community") is what makes the
 * choice legible at a glance — you read "TAP Air Portugal | In
 * sub-communities" and know exactly which groups each side holds.
 */
export default function GroupScopeToggle({
  includeSubs,
  onChange,
  communityName,
}: {
  includeSubs: boolean
  onChange: (next: boolean) => void
  communityName: string
}) {
  const { t } = useTranslation()
  const duration = prefersReducedMotion() ? REDUCED_MOTION_FADE_MS : TAB_CROSSFADE_MS
  // flex-1 so the two options split the pill edge to edge (no dead white
  // gap on the right); min-w-0 + truncate so a long community name shrinks
  // instead of pushing its sibling off a 375px screen.
  const base = 'flex-1 px-3 h-9 rounded-full text-xs font-medium min-w-0 truncate'
  const active = 'bg-cpoint-turquoise/15 text-cpoint-turquoise'
  const idle = 'text-c-text-tertiary hover:text-c-text-secondary'
  const style = { transition: `background-color ${duration}ms ${CPOINT_EASE_OUT}, color ${duration}ms ${CPOINT_EASE_OUT}` }

  return (
    <div role="tablist" aria-label={t('communities.groups_scope_aria')} className="flex w-full p-0.5 rounded-full bg-c-bg-elevated border border-c-border">
      <button
        type="button"
        role="tab"
        aria-selected={!includeSubs}
        aria-label={t('communities.groups_scope_this_aria', { name: communityName })}
        className={`${base} ${!includeSubs ? active : idle}`}
        style={style}
        onClick={() => onChange(false)}
      >
        {communityName}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={includeSubs}
        className={`${base} ${includeSubs ? active : idle}`}
        style={style}
        onClick={() => onChange(true)}
      >
        {t('communities.groups_scope_include')}
      </button>
    </div>
  )
}
