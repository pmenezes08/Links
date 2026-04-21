/** True if a reply attachment path is a video (by URL path), not an image. */
export function isVideoAttachmentPath(path: string | null | undefined): boolean {
  if (!path || typeof path !== 'string') return false
  const base = path.split('?')[0].split('#')[0].toLowerCase()
  return /\.(mp4|webm|mov|m4v|avi)$/i.test(base)
}
