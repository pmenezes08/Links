import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Avatar from '../components/Avatar'

interface ChatHeaderProps {
  username?: string
  displayName?: string
  profilePicture?: string | null
  onSearchOpen?: () => void
}

export default function ChatHeader({
  username,
  displayName,
  profilePicture,
  onSearchOpen,
}: ChatHeaderProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false)
  const headerMenuRef = useRef<HTMLDivElement | null>(null)
  const profilePath = username ? `/profile/${encodeURIComponent(username)}` : null

  // Close menu on outside click or escape
  useEffect(() => {
    if (!headerMenuOpen) return
    const handleDocumentClick = (event: globalThis.PointerEvent) => {
      if (!headerMenuRef.current) return
      if (!headerMenuRef.current.contains(event.target as Node)) {
        setHeaderMenuOpen(false)
      }
    }
    const handleDocumentKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHeaderMenuOpen(false)
      }
    }
    const captureOptions: AddEventListenerOptions = { capture: true }
    document.addEventListener('pointerdown', handleDocumentClick, captureOptions)
    document.addEventListener('keydown', handleDocumentKey)
    return () => {
      document.removeEventListener('pointerdown', handleDocumentClick, captureOptions)
      document.removeEventListener('keydown', handleDocumentKey)
    }
  }, [headerMenuOpen])

  return (
    <>
      {/* Header - fixed at top with safe area, full viewport width */}
      <div 
        className="flex-shrink-0 bg-c-header-bg border-b border-c-border"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          width: '100vw',
          zIndex: 1001,
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
        }}
      >
        <div className="h-12 flex items-center gap-2 px-3">
          <button 
            className="p-2 rounded-full hover:bg-c-hover-bg transition-colors" 
            onClick={() => navigate('/user_chat')} 
            aria-label={t('chat.back_to_messages')}
          >
            <i className="fa-solid fa-arrow-left text-c-text-primary" />
          </button>
          <Avatar 
            username={username || ''} 
            url={profilePicture || undefined} 
            size={36}
            linkToProfile
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-c-text-primary text-sm">
              {displayName || username || t('chat.page_title')}
            </div>
          </div>
          {onSearchOpen && (
            <button
              type="button"
              className="p-2 rounded-full hover:bg-c-hover-bg transition-colors"
              aria-label={t('chat.search_messages', 'Search messages')}
              onClick={onSearchOpen}
            >
              <i className="fa-solid fa-magnifying-glass text-c-text-secondary" />
            </button>
          )}
          <button 
            type="button"
            className="p-2 rounded-full hover:bg-c-hover-bg transition-colors" 
            aria-label={t('chat.more_options')}
            aria-haspopup="true"
            aria-expanded={headerMenuOpen}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setHeaderMenuOpen(prev => !prev)
            }}
          >
            <i className="fa-solid fa-ellipsis-vertical text-c-text-secondary" />
          </button>
          {headerMenuOpen && (
            <div
              ref={headerMenuRef}
              className="absolute right-3 top-full mt-2 z-[10020] w-48"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="rounded-xl border border-c-border bg-c-bg-surface shadow-lg shadow-black/40 py-1">
                <Link
                  to={profilePath || '/profile'}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-c-text-secondary hover:bg-c-hover-bg transition-colors"
                  onClick={() => setHeaderMenuOpen(false)}
                >
                  <i className="fa-solid fa-user text-xs text-cpoint-turquoise" />
                  <span>{t('chat.view_profile')}</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
