import type { CSSProperties, TouchEvent } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Subtypes the backend emits today as `owner_cta:<subtype>`. Anything else
 * falls back to the generic title/CTA so new server-side subtypes render
 * gracefully before the client catches up (forward compatibility).
 */
const KNOWN_OWNER_CTA_SUBTYPES = new Set([
  'steve_trial_ending',
  'steve_trial_expired',
  'steve_member_blocked',
  'steve_pool_exhausted',
])

export type OwnerCtaNotif = {
  id: number
  type?: string
  message?: string
  is_read: boolean
  link?: string | null
}

type OwnerCtaCardProps = {
  notif: OwnerCtaNotif
  /** Pre-formatted relative timestamp (same formatter as plain rows). */
  timeAgo: string
  /**
   * Fired by the explicit CTA button. The parent reuses the standard
   * notification click handler so mark-as-read + internal navigation to
   * `notif.link` behave exactly like plain rows.
   */
  onCta: () => void
  /** Swipe-to-reveal transform from the parent list (same as plain rows). */
  style?: CSSProperties
  onTouchStart?: (e: TouchEvent<HTMLElement>) => void
  onTouchMove?: (e: TouchEvent<HTMLElement>) => void
  onTouchEnd?: (e: TouchEvent<HTMLElement>) => void
  onTouchCancel?: (e: TouchEvent<HTMLElement>) => void
}

/**
 * Distinct CTA card for `owner_cta:*` notifications ("available, not urgent"):
 * turquoise wash on the app canvas, client-side title per subtype, the
 * server-localized message as body, and one explicit turquoise CTA button.
 * Purely a render variant — no fetching, and unread state / mark-as-read /
 * swipe actions are driven by the parent exactly like normal rows.
 */
export default function OwnerCtaCard({
  notif,
  timeAgo,
  onCta,
  style,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  onTouchCancel,
}: OwnerCtaCardProps) {
  const { t } = useTranslation()
  const subtype = notif.type?.split(':')[1] ?? ''
  const keySuffix = KNOWN_OWNER_CTA_SUBTYPES.has(subtype) ? subtype : 'generic'
  const title = t(`notifications_page.owner_cta.title_${keySuffix}`)
  const ctaLabel = t(`notifications_page.owner_cta.cta_${keySuffix}`)

  return (
    <div
      className={`w-full rounded-2xl border p-4 touch-pan-y ${
        notif.is_read
          ? 'border-cpoint-turquoise/20 bg-cpoint-turquoise/5'
          : 'border-cpoint-turquoise/40 bg-cpoint-turquoise/10'
      }`}
      style={style}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchCancel}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-cpoint-turquoise/20 flex items-center justify-center flex-shrink-0">
          <i className="fa-solid fa-bolt text-cpoint-turquoise text-lg" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-c-text-primary">{title}</div>
          {notif.message ? (
            <div className="text-sm text-c-text-secondary mt-1 break-words">{notif.message}</div>
          ) : null}
          <div className="text-[11px] text-c-text-tertiary mt-1">{timeAgo}</div>
        </div>
        {!notif.is_read && (
          <div className="w-2 h-2 rounded-full bg-cpoint-turquoise flex-shrink-0 mt-2" />
        )}
      </div>
      <button
        type="button"
        onClick={onCta}
        className="mt-3 flex w-full min-h-[44px] items-center justify-center rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-sm font-semibold text-black active:opacity-80"
      >
        {ctaLabel}
      </button>
    </div>
  )
}
