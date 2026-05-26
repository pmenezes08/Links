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
      className="w-10 h-10 rounded-md bg-[#4db6ac] text-black hover:brightness-110 grid place-items-center transition-all touch-manipulation"
      aria-label={t('feed.new_post')}
      onClick={onCompose}
    >
      <i className="fa-solid fa-plus" />
    </button>
  )

  const chrome = (
    <div
      className="fixed bottom-0 left-0 right-0 z-[900] px-3 sm:px-6 bg-gradient-to-t from-black via-black/80 to-transparent"
      style={{
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        touchAction: 'manipulation',
        pointerEvents: 'none',
      }}
    >
      <div
        className="liquid-glass-surface border border-white/10 rounded-2xl shadow-[0_-10px_40px_rgba(0,0,0,0.45)] max-w-2xl mx-auto mb-2"
        style={{ pointerEvents: 'auto' }}
      >
        <div className="h-14 px-2 sm:px-6 flex items-center justify-between text-[#cfd8dc]">
          <button
            type="button"
            className="p-3 rounded-full bg-white/10 transition-colors touch-manipulation"
            aria-label={t('navigation.home')}
            onClick={onHome}
          >
            <i className="fa-solid fa-house text-lg text-[#4db6ac]" />
          </button>
          <button
            type="button"
            className="p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
            aria-label={t('navigation.members')}
            onClick={onMembers}
          >
            <i className="fa-solid fa-users text-lg" />
          </button>
          {composeControl}
          <button
            type="button"
            className="relative p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
            aria-label={t('feed.announcements')}
            onClick={onAnnouncements}
          >
            <span className="relative inline-block">
              <i
                className="fa-solid fa-bullhorn text-lg"
                style={announcementsHighlight ? { color: '#4db6ac' } : undefined}
              />
              {announcementsDot ? (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#4db6ac] rounded-full" />
              ) : null}
            </span>
          </button>
          <button
            type="button"
            className="relative p-3 rounded-full hover:bg-white/10 active:bg-white/15 transition-colors touch-manipulation"
            aria-label={t('common.more')}
            onClick={onMore}
          >
            <span className="relative inline-block">
              <i className="fa-solid fa-ellipsis text-lg" />
              {moreDot ? (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-[#4db6ac] rounded-full" />
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
