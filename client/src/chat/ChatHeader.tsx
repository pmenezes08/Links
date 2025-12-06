import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Avatar from '../components/Avatar'

interface ChatHeaderProps {
  username?: string
  displayName?: string
  profilePicture?: string | null
  encryptionNeedsSync?: boolean
}

export default function ChatHeader({
  username,
  displayName,
  profilePicture,
  encryptionNeedsSync = false,
}: ChatHeaderProps) {
  const navigate = useNavigate()
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
      {/* Encryption Sync Banner */}
      {encryptionNeedsSync && (
        <div 
          className="flex-shrink-0 bg-yellow-500/90 text-black px-4 py-2"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            width: '100vw',
            zIndex: 1002,
            paddingTop: 'env(safe-area-inset-top, 0px)',
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm">
              <i className="fa-solid fa-rotate" />
              <span className="font-medium">Encryption keys need sync</span>
            </div>
            <Link 
              to="/settings/encryption"
              className="px-3 py-1 text-xs font-semibold bg-black/20 rounded-full hover:bg-black/30"
            >
              Sync Now
            </Link>
          </div>
        </div>
      )}

      {/* Header - fixed at top with safe area, full viewport width */}
      <div 
        className="flex-shrink-0 border-b border-[#262f30]"
        style={{
          position: 'fixed',
          top: encryptionNeedsSync ? 'calc(env(safe-area-inset-top, 0px) + 40px)' : 0,
          left: 0,
          right: 0,
          width: '100vw',
          zIndex: 1001,
          paddingTop: encryptionNeedsSync ? '0px' : 'env(safe-area-inset-top, 0px)',
          paddingLeft: 'env(safe-area-inset-left, 0px)',
          paddingRight: 'env(safe-area-inset-right, 0px)',
          background: '#000',
        }}
      >
        <div className="h-12 flex items-center gap-2 px-3">
          <button 
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            onClick={() => navigate('/user_chat')} 
            aria-label="Back to Messages"
          >
            <i className="fa-solid fa-arrow-left text-white" />
          </button>
          <Avatar 
            username={username || ''} 
            url={profilePicture || undefined} 
            size={36}
            linkToProfile
          />
          <div className="flex-1 min-w-0">
            <div className="font-semibold truncate text-white text-sm">
              {displayName || username || 'Chat'}
            </div>
          </div>
          <button 
            type="button"
            className="p-2 rounded-full hover:bg-white/10 transition-colors" 
            aria-label="More options"
            aria-haspopup="true"
            aria-expanded={headerMenuOpen}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              setHeaderMenuOpen(prev => !prev)
            }}
          >
            <i className="fa-solid fa-ellipsis-vertical text-white/70" />
          </button>
          {headerMenuOpen && (
            <div
              ref={headerMenuRef}
              className="absolute right-3 top-full mt-2 z-[10020] w-48"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="rounded-xl border border-white/10 bg-[#111111] shadow-lg shadow-black/40 py-1">
                <Link
                  to={profilePath || '/profile'}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
                  onClick={() => setHeaderMenuOpen(false)}
                >
                  <i className="fa-solid fa-user text-xs text-[#4db6ac]" />
                  <span>View Profile</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
