import { parseGIF, decompressFrames } from 'gifuct-js'

type GifInfo = {
  stillDataUrl: string
  loopDurationMs: number
}

const infoCache = new Map<string, GifInfo>()
const pendingCache = new Map<string, Promise<GifInfo>>()

async function buildGifInfo(src: string): Promise<GifInfo> {
  const response = await fetch(src, { credentials: 'include' })
  if (!response.ok) {
    throw new Error(`Failed to load GIF: ${response.status}`)
  }

  const buffer = await response.arrayBuffer()
  const gif = parseGIF(buffer)
  const frames = decompressFrames(gif, true)
  if (!frames.length) {
    throw new Error('GIF contained no frames')
  }

  const totalDelayHundredths = frames.reduce((sum, frame) => {
    const delay = typeof frame.delay === 'number' ? frame.delay : 0
    return sum + delay
  }, 0)
  const loopDurationMs = Math.max(totalDelayHundredths * 10, 1000)

  const first = frames[0]
  const canvas = document.createElement('canvas')
  canvas.width = first.dims.width
  canvas.height = first.dims.height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Canvas not supported')
  }

  const imageData = ctx.createImageData(first.dims.width, first.dims.height)
  imageData.data.set(first.patch)
  ctx.putImageData(imageData, 0, 0)
  const stillDataUrl = canvas.toDataURL('image/png')

  return { stillDataUrl, loopDurationMs }
}

export async function getGifInfo(src: string): Promise<GifInfo> {
  if (infoCache.has(src)) {
    return infoCache.get(src)!
  }
  if (pendingCache.has(src)) {
    return pendingCache.get(src)!
  }
  const promise = buildGifInfo(src)
    .then(info => {
      infoCache.set(src, info)
      pendingCache.delete(src)
      return info
    })
    .catch(error => {
      pendingCache.delete(src)
      throw error
    })
  pendingCache.set(src, promise)
  return promise
}
