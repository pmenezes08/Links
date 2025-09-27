import { useState } from 'react'

type AvatarProps = {
  username: string
  url?: string | null
  size?: number
  className?: string
}

function ImageWithLoader({ src, alt, style }: { src: string; alt: string; style: React.CSSProperties }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  return (
    <div className="relative w-full h-full">
      {/* Loading state */}
      {loading && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-4 h-4 border border-white/20 border-t-white/60 rounded-full animate-spin"></div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <i className="fa-solid fa-user text-white/40 text-sm"></i>
        </div>
      )}

      {/* Image */}
      <img
        src={src}
        alt={alt}
        style={style}
        className={`transition-opacity duration-300 ${loading ? 'opacity-0' : 'opacity-100'}`}
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false)
          setError(true)
        }}
        loading="lazy"
      />
    </div>
  )
}

export default function Avatar({ username, url, size = 40, className = '' }: AvatarProps){
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
  return (
    <div
      className={`rounded-full overflow-hidden bg-white/10 border border-white/10 flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label={`Avatar for ${username}`}
    >
      {resolved ? (
        <ImageWithLoader src={resolved} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: Math.max(12, Math.floor(size * 0.45)) }} className="text-white/80">
          {initials}
        </span>
      )}
    </div>
  )
}

