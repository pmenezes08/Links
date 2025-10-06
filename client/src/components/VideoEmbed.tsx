import type { VideoEmbed as VideoEmbedType } from '../utils/videoEmbed'

type Props = {
  embed: VideoEmbedType
  className?: string
}

export default function VideoEmbed({ embed, className = '' }: Props) {
  if (!embed || !embed.embedUrl) return null

  // Instagram needs different aspect ratio and styling
  const isInstagram = embed.type === 'instagram'

  return (
    <div className={`relative w-full overflow-hidden rounded-lg border border-white/10 ${className}`}>
      <div className={`relative ${isInstagram ? 'pb-[125%]' : 'pb-[56.25%]'}`}> {/* Instagram: taller, Others: 16:9 */}
        <iframe
          src={embed.embedUrl}
          className="absolute top-0 left-0 w-full h-full"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          scrolling="no"
          title={`${embed.type} video player`}
        />
      </div>
      {/* Platform badge */}
      <div className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/70 backdrop-blur-sm text-xs text-white/80 capitalize">
        {embed.type}
      </div>
    </div>
  )
}
