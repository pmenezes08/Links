/**
 * Cloudflare Image Optimization Utility
 * Automatically converts images to WebP/AVIF and resizes them
 */

// Your domain for Cloudflare transformations
const CF_DOMAIN = 'https://c-point.co'

// R2 CDN domains that already serve optimized content
const R2_DOMAINS = ['media.c-point.co', 'pub-']

interface ImageOptions {
  width?: number
  height?: number
  quality?: number
  fit?: 'contain' | 'cover' | 'crop' | 'scale-down'
  format?: 'auto' | 'webp' | 'avif' | 'json'
}

/**
 * Generate a Cloudflare-optimized image URL
 * @param originalUrl - The original image URL
 * @param options - Optimization options
 * @returns Optimized URL or original if not applicable
 */
export function optimizeImage(originalUrl: string | null | undefined, options: ImageOptions = {}): string {
  if (!originalUrl) return ''
  
  // Skip optimization for:
  // - Blob URLs (local previews)
  // - Data URLs
  // - Already optimized URLs
  // - SVGs (don't need optimization)
  // - GIFs (preserve animation)
  // - R2 CDN URLs (already on edge)
  const isR2Url = R2_DOMAINS.some(domain => originalUrl.includes(domain))
  if (
    originalUrl.startsWith('blob:') ||
    originalUrl.startsWith('data:') ||
    originalUrl.includes('/cdn-cgi/image/') ||
    originalUrl.endsWith('.svg') ||
    originalUrl.endsWith('.gif') ||
    isR2Url
  ) {
    return originalUrl
  }
  
  // Build the transformation parameters
  const params: string[] = []
  
  if (options.width) params.push(`width=${options.width}`)
  if (options.height) params.push(`height=${options.height}`)
  if (options.quality) params.push(`quality=${options.quality}`)
  if (options.fit) params.push(`fit=${options.fit}`)
  
  // Always use auto format for best compression
  params.push('format=auto')
  
  // If no params, just return original
  if (params.length === 1) {
    params.unshift('quality=85') // Default quality
  }
  
  const paramString = params.join(',')
  
  // Handle different URL formats
  let imageUrl = originalUrl
  
  // If it's a relative URL, make it absolute
  if (originalUrl.startsWith('/')) {
    imageUrl = `https://app.c-point.co${originalUrl}`
  }
  
  // If it's already on media.c-point.co, use it directly
  // Otherwise, use the full URL
  
  return `${CF_DOMAIN}/cdn-cgi/image/${paramString}/${imageUrl}`
}

/**
 * Optimized avatar/profile picture
 * Small, circular images - aggressive optimization
 */
export function optimizeAvatar(url: string | null | undefined, size: number = 80): string {
  return optimizeImage(url, {
    width: size * 2, // 2x for retina
    height: size * 2,
    quality: 80,
    fit: 'cover'
  })
}

/**
 * Optimized message photo
 * Medium size, good quality
 */
export function optimizeMessagePhoto(url: string | null | undefined): string {
  return optimizeImage(url, {
    width: 640,
    quality: 85,
    fit: 'scale-down'
  })
}

/**
 * Optimized story/full-screen image
 * Larger, higher quality
 */
export function optimizeStoryImage(url: string | null | undefined): string {
  return optimizeImage(url, {
    width: 1080,
    quality: 90,
    fit: 'scale-down'
  })
}

/**
 * Optimized community background
 * Wide banner format
 */
export function optimizeBanner(url: string | null | undefined): string {
  return optimizeImage(url, {
    width: 1200,
    quality: 85,
    fit: 'cover'
  })
}

/**
 * Optimized thumbnail
 * Very small, for lists/grids
 */
export function optimizeThumbnail(url: string | null | undefined): string {
  return optimizeImage(url, {
    width: 200,
    quality: 75,
    fit: 'cover'
  })
}
