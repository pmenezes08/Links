import type { VideoEmbed as VideoEmbedType } from '../utils/videoEmbed'

type Props = {
  embed: VideoEmbedType
  className?: string
}

export default function VideoEmbed({ embed, className = '' }: Props) {
  if (!embed || !embed.embedUrl) return null

  // Instagram needs different handling
  const isInstagram = embed.type === 'instagram'

  if (isInstagram) {
    // Instagram embed with native aspect ratio (centered if narrower than container)
    return (
      <div className={`flex justify-center w-full ${className}`}>
        <div className="relative" style={{ width: '100%', maxWidth: '500px', height: '640px' }}>
          <iframe
            src={embed.embedUrl}
            className="w-full h-full border-0"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            scrolling="no"
            title="Instagram video player"
          />
          {/* Platform badge */}
          <div className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/80 backdrop-blur-sm text-xs text-white/90 capitalize z-10 pointer-events-none">
            Instagram
          </div>
        </div>
      </div>
    )
  }

  // YouTube, Vimeo, TikTok: responsive 16:9
  return (
    <div className={`relative w-full ${className}`}>
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', height: 0 }}>
        <iframe
          src={embed.embedUrl}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          title={`${embed.type} video player`}
        />
      </div>
      {/* Platform badge */}
      <div className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/80 backdrop-blur-sm text-xs text-white/90 capitalize z-10 pointer-events-none">
        {embed.type}
      </div>
    </div>
  )
}
