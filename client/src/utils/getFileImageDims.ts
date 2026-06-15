// Read an image File's intrinsic [width, height] before upload, so the sender can
// (a) reserve its own bubble height immediately and (b) ship the dimensions with the
// message — letting the RECEIVER reserve height on their very first view (no settle).
// Returns null for non-images or on any failure (caller degrades to measure-on-load).

export async function getFileImageDims(file: File): Promise<[number, number] | null> {
  if (!file || !file.type?.startsWith('image/')) return null
  // Fast path: decode just the header via createImageBitmap (no DOM, no full render).
  try {
    if (typeof createImageBitmap === 'function') {
      const bmp = await createImageBitmap(file)
      const dims: [number, number] = [bmp.width, bmp.height]
      bmp.close?.()
      if (dims[0] > 0 && dims[1] > 0) return dims
    }
  } catch {
    /* fall through to the Image() path */
  }
  return new Promise(resolve => {
    let url = ''
    try {
      url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        const w = img.naturalWidth
        const h = img.naturalHeight
        try { URL.revokeObjectURL(url) } catch { /* ignore */ }
        resolve(w > 0 && h > 0 ? [w, h] : null)
      }
      img.onerror = () => {
        try { URL.revokeObjectURL(url) } catch { /* ignore */ }
        resolve(null)
      }
      img.src = url
    } catch {
      if (url) { try { URL.revokeObjectURL(url) } catch { /* ignore */ } }
      resolve(null)
    }
  })
}
