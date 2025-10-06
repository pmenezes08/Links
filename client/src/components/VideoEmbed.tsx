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
    // Instagram embed with fixed height approach
    return (
      <div className={`relative w-full overflow-hidden ${className}`}>
        <div className="relative" style={{ minHeight: '600px', maxHeight: '800px', height: '640px' }}>
          <iframe
            src={`${embed.embedUrl}/captioned`}
            className="w-full h-full border-0"
            frameBorder="0"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
            scrolling="no"
            loading="lazy"
            title="Instagram video player"
          />
        </div>
        {/* Platform badge */}
        <div className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/80 backdrop-blur-sm text-xs text-white/90 capitalize z-10 pointer-events-none">
          Instagram
        </div>
      </div>
    )
  }

  // YouTube, Vimeo, TikTok: responsive 16:9
  return (
    <div className={`relative w-full overflow-hidden ${className}`}>
      <div className="relative pb-[56.25%]">
        <iframe
          src={embed.embedUrl}
          className="absolute top-0 left-0 w-full h-full border-0"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          scrolling="no"
          loading="lazy"
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
