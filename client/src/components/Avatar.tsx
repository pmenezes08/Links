import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'

type AvatarProps = {
  username: string
  url?: string | null
  size?: number
  className?: string
  linkToProfile?: boolean
  onClick?: (event: MouseEvent<HTMLDivElement | HTMLAnchorElement>) => void
}

function ImageWithLoader({ src, alt, style, fallbacks = [] as string[], initials }: { src: string; alt: string; style: React.CSSProperties, fallbacks?: string[], initials?: string }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [currentSrc, setCurrentSrc] = useState<string>(src)

  // If error, show initials fallback (same as when no image URL provided)
  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <span className="text-white/80" style={{ fontSize: 'inherit' }}>
          {initials || '?'}
        </span>
      </div>
    )
  }

  return (
    <div className="relative w-full h-full">
      {/* Loading state */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin"></div>
        </div>
      )}

      {/* Image */}
      <img
        src={currentSrc}
        alt={alt}
        style={style}
        className={`transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => setLoading(false)}
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

export default function Avatar({ username, url, size = 40, className = '', linkToProfile = false, onClick }: AvatarProps){
  const navigate = useNavigate()
  const resolved = (() => {
    const p = (url || '').trim()
    if (!p) return null
    
    if (p.startsWith('http')) return p
    if (p.startsWith('/uploads') || p.startsWith('uploads/')) return p.startsWith('/') ? p : `/${p}`
    if (p.startsWith('/static') || p.startsWith('static/')) return p.startsWith('/') ? p : `/${p}`
    // Fallback: assume legacy stored filename in uploads
    return `/uploads/${p}`
  })()
  const initials = (username || '?').slice(0, 1).toUpperCase()
  const profileHref = linkToProfile ? `/profile/${encodeURIComponent(username)}` : null
  const interactive = linkToProfile || typeof onClick === 'function'

  function renderImage(){
    const fontSize = Math.max(12, Math.floor(size * 0.45))
    return resolved ? (
      <ImageWithLoader
        src={resolved}
        alt=""
        style={{ width: '100%', height: '100%', objectFit: 'cover', fontSize }}
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
      />
    ) : (
      <span style={{ fontSize }} className="text-white/80">
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

