// Utility functions for detecting and embedding video URLs

export type VideoEmbed = {
  type: 'youtube' | 'vimeo' | 'tiktok' | 'instagram' | null
  videoId: string
  embedUrl: string
}

/**
 * Extracts video embed info from a URL or text content
 */
export function extractVideoEmbed(text: string): VideoEmbed | null {
  if (!text) return null

  // YouTube patterns
  const youtubePatterns = [
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ]

  for (const pattern of youtubePatterns) {
    const match = text.match(pattern)
    if (match) {
      const videoId = match[1]
      return {
        type: 'youtube',
        videoId,
        embedUrl: `https://www.youtube.com/embed/${videoId}`,
      }
    }
  }

  // Vimeo patterns
  const vimeoPatterns = [
    /(?:https?:\/\/)?(?:www\.)?vimeo\.com\/(\d+)/,
    /(?:https?:\/\/)?player\.vimeo\.com\/video\/(\d+)/,
  ]

  for (const pattern of vimeoPatterns) {
    const match = text.match(pattern)
    if (match) {
      const videoId = match[1]
      return {
        type: 'vimeo',
        videoId,
        embedUrl: `https://player.vimeo.com/video/${videoId}`,
      }
    }
  }

  // TikTok patterns
  const tiktokPatterns = [
    /(?:https?:\/\/)?(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/(\d+)/,
    /(?:https?:\/\/)?(?:vm\.)?tiktok\.com\/([a-zA-Z0-9]+)/,
  ]

  for (const pattern of tiktokPatterns) {
    const match = text.match(pattern)
    if (match) {
      const videoId = match[1]
      return {
        type: 'tiktok',
        videoId,
        embedUrl: `https://www.tiktok.com/embed/v2/${videoId}`,
      }
    }
  }

  // Instagram patterns (posts and reels) - DISABLED
  // Instagram API doesn't support inline playback - always redirects to instagram.com
  // Treating Instagram as regular links that users can rename
  // const instagramPatterns = [
  //   /(?:https?:\/\/)?(?:www\.)?instagram\.com\/reel\/([a-zA-Z0-9_-]+)/,
  //   /(?:https?:\/\/)?(?:www\.)?instagram\.com\/p\/([a-zA-Z0-9_-]+)/,
  //   /(?:https?:\/\/)?(?:www\.)?instagram\.com\/tv\/([a-zA-Z0-9_-]+)/,
  // ]

  // for (const pattern of instagramPatterns) {
  //   const match = text.match(pattern)
  //   if (match) {
  //     const videoId = match[1]
  //     // Use reel embed for reels, regular embed for posts/tv
  //     const isReel = text.includes('/reel/')
  //     return {
  //       type: 'instagram',
  //       videoId,
  //       embedUrl: isReel 
  //         ? `https://www.instagram.com/reel/${videoId}/embed` 
  //         : `https://www.instagram.com/p/${videoId}/embed`,
  //     }
  //   }
  // }

  return null
}

/**
 * Removes video URL from text content to avoid duplication
 */
export function removeVideoUrlFromText(text: string, videoEmbed: VideoEmbed | null): string {
  if (!videoEmbed || !videoEmbed.type) return text

  const patterns: Record<string, RegExp[]> = {
    youtube: [
      /https?:\/\/(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}[^\s]*/g,
      /https?:\/\/(?:www\.)?youtu\.be\/[a-zA-Z0-9_-]{11}[^\s]*/g,
      /https?:\/\/(?:www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]{11}[^\s]*/g,
      /https?:\/\/(?:www\.)?youtube\.com\/shorts\/[a-zA-Z0-9_-]{11}[^\s]*/g,
    ],
    vimeo: [
      /https?:\/\/(?:www\.)?vimeo\.com\/\d+[^\s]*/g,
      /https?:\/\/player\.vimeo\.com\/video\/\d+[^\s]*/g,
    ],
    tiktok: [
      /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.-]+\/video\/\d+[^\s]*/g,
      /https?:\/\/(?:vm\.)?tiktok\.com\/[a-zA-Z0-9]+[^\s]*/g,
    ],
    // instagram: [  // DISABLED - treating as regular links
    //   /https?:\/\/(?:www\.)?instagram\.com\/p\/[a-zA-Z0-9_-]+[^\s]*/g,
    //   /https?:\/\/(?:www\.)?instagram\.com\/reel\/[a-zA-Z0-9_-]+[^\s]*/g,
    //   /https?:\/\/(?:www\.)?instagram\.com\/tv\/[a-zA-Z0-9_-]+[^\s]*/g,
    // ],
  }

  let cleanedText = text
  const relevantPatterns = patterns[videoEmbed.type] || []
  
  for (const pattern of relevantPatterns) {
    cleanedText = cleanedText.replace(pattern, '').trim()
  }

  return cleanedText
}
