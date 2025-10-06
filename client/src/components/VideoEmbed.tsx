import type { VideoEmbed as VideoEmbedType } from '../utils/videoEmbed'

type Props = {
  embed: VideoEmbedType
  className?: string
}

export default function VideoEmbed({ embed, className = '' }: Props) {
  if (!embed || !embed.embedUrl) return null

  return (
    <div className={`relative w-full overflow-hidden rounded-lg border border-white/10 ${className}`}>
      <div className="relative pb-[56.25%]"> {/* 16:9 aspect ratio */}
        <iframe
          src={embed.embedUrl}
          className="absolute top-0 left-0 w-full h-full"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
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
