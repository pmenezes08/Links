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
    // Instagram doesn't allow inline playback - their API intentionally redirects to Instagram
    // Show the iframe embed which will display the post preview
    const instagramUrl = embed.embedUrl.replace('/embed', '')
    return (
      <div className={`flex justify-center w-full ${className}`}>
        <a
          href={instagramUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block no-underline relative"
          style={{ maxWidth: '328px', width: '100%' }}
        >
          <div className="relative rounded-lg overflow-hidden border-[3px] border-transparent bg-gradient-to-br from-purple-600 via-pink-600 to-orange-600 p-[3px]">
            <div className="bg-black rounded-lg overflow-hidden">
              {/* Instagram iframe for preview */}
              <iframe
                src={embed.embedUrl}
                className="border-0 w-full"
                height="580"
                frameBorder="0"
                scrolling="no"
                allowTransparency={true}
                style={{ pointerEvents: 'none' }}
                title="Instagram preview"
              />
              {/* Overlay to make it clickable and show it's a link */}
              <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center group">
                <div className="bg-black/80 backdrop-blur-sm rounded-full p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                  <i className="fas fa-external-link-alt text-white text-2xl" />
                </div>
              </div>
            </div>
          </div>
          {/* Instagram badge */}
          <div className="absolute top-3 right-3 px-2 py-1 rounded-md bg-black/90 backdrop-blur-sm text-xs text-white font-medium z-10 pointer-events-none flex items-center gap-1.5">
            <i className="fab fa-instagram" />
            <span>View on Instagram</span>
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
