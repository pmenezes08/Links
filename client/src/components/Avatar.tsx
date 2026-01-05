import { useState, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { cacheAvatarUrl, isAvatarCached } from '../utils/avatarCache'
import { optimizeAvatar } from '../utils/imageOptimizer'

type AvatarProps = {
  username: string
  url?: string | null
  size?: number
  className?: string
  linkToProfile?: boolean
  onClick?: (event: MouseEvent<HTMLDivElement | HTMLAnchorElement>) => void
  /** Display name to use for initials fallback (if not provided, uses username) */
  displayName?: string | null
}

// Global cache of loaded images to prevent re-fetching during session
const imageCache = new Map<string, boolean>()

// Export function to clear image cache for a user (called when profile picture changes)
export function clearImageCache(username?: string) {
  if (username) {
    // Clear entries that contain this username
    const keysToDelete: string[] = []
    imageCache.forEach((_, key) => {
      if (key.toLowerCase().includes(username.toLowerCase())) {
        keysToDelete.push(key)
      }
    })
    keysToDelete.forEach(key => imageCache.delete(key))
  } else {
    // Clear all
    imageCache.clear()
  }
}

function ImageWithLoader({ src, alt, style, fallbacks = [] as string[], initials, username, fontSize }: { src: string; alt: string; style: React.CSSProperties, fallbacks?: string[], initials?: string, username?: string, fontSize?: number }) {
  // Check if already loaded this session
  const alreadyLoaded = imageCache.has(src)
  const [loading, setLoading] = useState(!alreadyLoaded)
  const [error, setError] = useState(false)
  const [currentSrc, setCurrentSrc] = useState<string>(src)
  const imgRef = useRef<HTMLImageElement>(null)

  // Check if image is already in browser cache (complete and has dimensions)
  useEffect(() => {
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth > 0) {
      setLoading(false)
      imageCache.set(src, true)
      if (username) {
        cacheAvatarUrl(username, src)
      }
    }
  }, [src, username])

  // If error, show initials fallback (same as when no image URL provided)
  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-white/80 font-medium" style={{ fontSize: fontSize || 16 }}>
          {initials || '?'}
        </span>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      {/* Loading state - only show if not already cached */}
      {loading && !alreadyLoaded && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin"></div>
        </div>
      )}

      {/* Image */}
      <img
        ref={imgRef}
        src={currentSrc}
        alt={alt}
        style={style}
        className={`transition-opacity duration-200 ${loading && !alreadyLoaded ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => {
          setLoading(false)
          imageCache.set(currentSrc, true)
          if (username) {
            cacheAvatarUrl(username, currentSrc)
          }
        }}
        onError={() => {
          setLoading(false)
          // Try next fallback if available
          if (fallbacks.length > 0){
            const [next, ...rest] = fallbacks
            setError(false)
            setLoading(true)
            setCurrentSrc(next)
            ;(fallbacks as any).splice(0, fallbacks.length, ...rest)
          } else {
            setError(true)
          }
        }}
        loading="lazy"
      />
    </div>
  )
}

export default function Avatar({ username, url, size = 40, className = '', linkToProfile = false, onClick, displayName }: AvatarProps){
  const navigate = useNavigate()
  
  // Resolve the URL and apply Cloudflare optimization
  const resolved = (() => {
    const p = (url || '').trim()
    if (!p) return null
    
    let resolvedUrl: string
    if (p.startsWith('http')) {
      resolvedUrl = p
    } else if (p.startsWith('/uploads') || p.startsWith('uploads/')) {
      resolvedUrl = p.startsWith('/') ? p : `/${p}`
    } else if (p.startsWith('/static') || p.startsWith('static/')) {
      resolvedUrl = p.startsWith('/') ? p : `/${p}`
    } else {
      // Fallback: assume legacy stored filename in uploads
      resolvedUrl = `/uploads/${p}`
    }
    
    // If this URL is already cached for this user, browser will use its cache
    // This prevents the "constant server request" issue
    if (isAvatarCached(username, resolvedUrl)) {
      // Still apply Cloudflare optimization for faster delivery
      return optimizeAvatar(resolvedUrl, size)
    }
    
    // Apply Cloudflare Image Resizing for optimized delivery
    return optimizeAvatar(resolvedUrl, size)
  })()
  
  // Use display name for initials if provided, otherwise fall back to username
  const nameForInitials = (displayName || username || '?').trim()
  const initials = nameForInitials.slice(0, 1).toUpperCase()
  const profileHref = linkToProfile ? `/profile/${encodeURIComponent(username)}` : null
  const interactive = linkToProfile || typeof onClick === 'function'

  function renderImage(){
    const fontSize = Math.max(12, Math.floor(size * 0.45))
    return resolved ? (
      <ImageWithLoader
        src={resolved}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        fallbacks={(() => {
          const p = (url || '').trim()
          const opts: string[] = []
          if (!p) return opts
          if (p.startsWith('http')) return opts
          if (p.startsWith('/uploads')) opts.push(`/static${p}`)
          if (p.startsWith('uploads/')) opts.push(`/static/${p}`)
          if (!p.startsWith('/uploads') && !p.startsWith('uploads/') && !p.startsWith('/static') && !p.startsWith('static/')){
            opts.push(`/uploads/${p}`)
            opts.push(`/static/uploads/${p}`)
          }
          return opts
        })()}
        initials={initials}
        username={username}
        fontSize={fontSize}
      />
    ) : (
      <span style={{ fontSize }} className="text-white/80 font-medium">
        {initials}
      </span>
    )
  }

  if (linkToProfile && profileHref){
    const handleAnchorClick = (event: MouseEvent<HTMLAnchorElement>) => {
      event.stopPropagation()
      if (onClick) onClick(event)
      if (event.defaultPrevented) return
      if (!username) return
      event.preventDefault()
      try{
        navigate(profileHref)
      }catch{
        window.location.assign(profileHref)
      }
    }

    return (
      <a
        href={profileHref}
        onClick={handleAnchorClick}
        className={`rounded-full overflow-hidden bg-white/10 border border-white/10 flex items-center justify-center cursor-pointer transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4db6ac]/70 ${className}`}
        style={{ width: size, height: size }}
        aria-label={`Avatar for ${username}`}
      >
        {renderImage()}
      </a>
    )
  }

  function handleDivClick(event: MouseEvent<HTMLDivElement>){
    if (linkToProfile) event.stopPropagation()
    if (onClick) onClick(event)
    if (event.defaultPrevented || !linkToProfile || !profileHref) return
    navigate(profileHref)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>){
    if (!interactive) return
    if (event.key === 'Enter' || event.key === ' '){
      event.preventDefault()
      handleDivClick(event as unknown as MouseEvent<HTMLDivElement>)
    }
  }

  return (
    <div
      onClick={interactive ? handleDivClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={`rounded-full overflow-hidden bg-white/10 border border-white/10 flex items-center justify-center ${interactive ? 'cursor-pointer transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4db6ac]/70' : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-label={`Avatar for ${username}`}
    >
      {renderImage()}
    </div>
  )
}

