/**
 * Resize / recompress chat-bound photos before direct R2 upload.
 * PNG/GIF: unchanged (transparency + animation). Small JPEG/WebP: skip.
 */

const MAX_LONG_EDGE = 2560
const JPEG_QUALITY = 0.9
const SKIP_IF_UNDER_BYTES = 1.5 * 1024 * 1024

function loadImageBitmap(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load image'))
    }
    img.crossOrigin = 'anonymous'
    img.src = url
  })
}

function needsResize(w: number, h: number): boolean {
  return Math.max(w, h) > MAX_LONG_EDGE
}

/**
 * Returns a File suitable for upload (JPEG for compressed raster; original for png/gif/small).
 */
export async function compressImageForUpload(file: File): Promise<File> {
  const mime = (file.type || '').toLowerCase()
  if (mime === 'image/gif' || mime === 'image/png') {
    return file
  }
  if (!mime.startsWith('image/')) {
    return file
  }
  if (file.size > 0 && file.size < SKIP_IF_UNDER_BYTES && mime !== 'image/webp') {
    try {
      const img = await loadImageBitmap(file)
      if (!needsResize(img.naturalWidth || img.width, img.naturalHeight || img.height)) {
        return file
      }
    } catch {
      return file
    }
  }

  let img: HTMLImageElement
  try {
    img = await loadImageBitmap(file)
  } catch {
    return file
  }

  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) return file

  let tw = iw
  let th = ih
  const maxSide = Math.max(iw, ih)
  if (maxSide > MAX_LONG_EDGE) {
    const scale = MAX_LONG_EDGE / maxSide
    tw = Math.round(iw * scale)
    th = Math.round(ih * scale)
  } else if (file.size < SKIP_IF_UNDER_BYTES) {
    return file
  }

  const canvas = document.createElement('canvas')
  canvas.width = tw
  canvas.height = th
  const ctx = canvas.getContext('2d')
  if (!ctx) return file
  ctx.drawImage(img, 0, 0, tw, th)

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY)
  )
  if (!blob || blob.size >= file.size) {
    return file
  }
  const base = file.name.replace(/\.[^.]+$/, '') || 'photo'
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' })
}
