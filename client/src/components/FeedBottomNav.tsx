import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export const FEED_BOTTOM_NAV_HEIGHT_CSS = 'var(--app-feed-bottom-nav-height)'

type FeedBottomNavProps = {
  onHome: () => void
  onMembers: () => void
  onAnnouncements: () => void
  onMore: () => void
  /** Custom compose control (e.g. NativeActionButton with onboarding highlight). */
  composeSlot?: ReactNode
  /** Default compose handler when composeSlot is omitted. */
  onCompose?: () => void
  announcementsHighlight?: boolean
  announcementsDot?: boolean
  moreDot?: boolean
}

export default function FeedBottomNav({
  onHome,
  onMembers,
  onAnnouncements,
  onMore,
  composeSlot,
  onCompose,
  announcementsHighlight = false,
  announcementsDot = false,
  moreDot = false,
}: FeedBottomNavProps) {
  const { t } = useTranslation()

  const composeControl = composeSlot ?? (
    <button
      type="button"
      className="w-10 h-10 rounded-md bg-cpoint-turquoise text-black hover:brightness-110 grid place-items-center transition-all touch-manipulation"
      aria-label={t('feed.new_post')}
      onClick={onCompose}
    >
      <i className="fa-solid fa-plus" />
    </button>
  )

  const chrome = (
    <div
      className="fixed left-0 right-0 z-[900] px-3 sm:px-6 pointer-events-none"
      style={{
        bottom: 'calc(var(--sab-px, 0px) + var(--app-feed-nav-float-gap, 20px))',
        paddingLeft: 'var(--sal-px, 0px)',
        paddingRight: 'var(--sar-px, 0px)',
        touchAction: 'manipulation',
      }}
    >
      <div
        className="liquid-glass-surface border border-c-border rounded-2xl shadow-c-glass max-w-2xl mx-auto"
        style={{ pointerEvents: 'auto' }}
      >
          <div className="h-14 px-2 sm:px-6 flex items-center justify-between text-c-text-secondary">
          <button
            type="button"
            className="p-3 rounded-full bg-c-active-bg transition-colors touch-manipulation"
            aria-label={t('navigation.home')}
            onClick={onHome}
          >
            <i className="fa-solid fa-house text-lg text-cpoint-turquoise" />
          </button>
          <button
            type="button"
            className="p-3 rounded-full hover:bg-c-hover-bg active:bg-c-active-bg transition-colors touch-manipulation"
            aria-label={t('navigation.members')}
            onClick={onMembers}
          >
            <i className="fa-solid fa-users text-lg" />
          </button>
          {composeControl}
          <button
            type="button"
            className="relative p-3 rounded-full hover:bg-c-hover-bg active:bg-c-active-bg transition-colors touch-manipulation"
            aria-label={t('feed.announcements')}
            onClick={onAnnouncements}
          >
            <span className="relative inline-block">
              <i
                className="fa-solid fa-bullhorn text-lg"
                style={announcementsHighlight ? { color: '#00CEC8' } : undefined}
              />
              {announcementsDot ? (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cpoint-turquoise rounded-full" />
              ) : null}
            </span>
          </button>
          <button
            type="button"
            className="relative p-3 rounded-full hover:bg-c-hover-bg active:bg-c-active-bg transition-colors touch-manipulation"
            aria-label={t('common.more')}
            onClick={onMore}
          >
            <span className="relative inline-block">
              <i className="fa-solid fa-ellipsis text-lg" />
              {moreDot ? (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-cpoint-turquoise rounded-full" />
              ) : null}
            </span>
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') return null
  return createPortal(chrome, document.body)
}
