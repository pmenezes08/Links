type AvatarProps = {
  username: string
  url?: string | null
  size?: number
  className?: string
}

export default function Avatar({ username, url, size = 40, className = '' }: AvatarProps){
  const resolved = url ? ((url.startsWith('http') || url.startsWith('/static')) ? url : `/static/${url}`) : null
  const initials = (username || '?').slice(0, 1).toUpperCase()
  return (
    <div
      className={`rounded-full overflow-hidden bg-white/10 border border-white/10 flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label={`Avatar for ${username}`}
    >
      {resolved ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolved} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <span style={{ fontSize: Math.max(12, Math.floor(size * 0.45)) }} className="text-white/80">
          {initials}
        </span>
      )}
    </div>
  )
}

