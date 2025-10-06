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
    // Instagram embeds have severe limitations - they don't support inline video playback
    // Display as a styled link instead
    const instagramUrl = embed.embedUrl.replace('/embed', '')
    return (
      <div className={`flex justify-center w-full ${className}`}>
        <a
          href={instagramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block no-underline"
          style={{ maxWidth: '328px', width: '100%' }}
        >
          <div className="relative border border-white/20 rounded-lg overflow-hidden bg-gradient-to-br from-purple-600 via-pink-600 to-orange-600 p-[2px]">
            <div className="bg-black rounded-lg p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-500 flex items-center justify-center">
                  <i className="fab fa-instagram text-white text-xl" />
                </div>
                <div className="flex-1">
                  <div className="text-white font-medium text-sm">Instagram</div>
                  <div className="text-white/60 text-xs">Tap to view</div>
                </div>
              </div>
              <div className="aspect-[9/16] bg-white/5 rounded flex items-center justify-center">
                <div className="text-center">
                  <i className="fas fa-play-circle text-white/80 text-4xl mb-2" />
                  <div className="text-white/60 text-xs">View on Instagram</div>
                </div>
              </div>
            </div>
          </div>
        </a>
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
