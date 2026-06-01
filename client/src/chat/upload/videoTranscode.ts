import type { MediaQuality } from './types'

/** Best-effort client video optimization before upload (web). */

const SKIP_BELOW_BYTES = 12 * 1024 * 1024
const TARGET_MAX_BYTES = 28 * 1024 * 1024

export async function optimizeVideoForUpload(file: File, quality: MediaQuality = 'standard'): Promise<File> {
  if (!file.type.startsWith('video/')) return file
  if (quality === 'hd') return file
  if (file.size <= SKIP_BELOW_BYTES) return file

  try {
    const optimized = await transcodeViaMediaRecorder(file)
    if (optimized && optimized.size > 0 && optimized.size < file.size) {
      return optimized
    }
  } catch (err) {
    console.debug('[videoTranscode] skipped:', err)
  }
  return file
}

async function transcodeViaMediaRecorder(file: File): Promise<File | null> {
  if (typeof document === 'undefined' || typeof MediaRecorder === 'undefined') {
    return null
  }

  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error('video load failed'))
    })

    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0) return null

    const capture = (video as HTMLVideoElement & { captureStream?: () => MediaStream }).captureStream?.()
      ?? (video as HTMLVideoElement & { mozCaptureStream?: () => MediaStream }).mozCaptureStream?.()
    if (!capture) return null

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : ''
    if (!mime) return null

    const recorder = new MediaRecorder(capture, { mimeType: mime, videoBitsPerSecond: 2_000_000 })
    const chunks: Blob[] = []
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data)
    }

    const done = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve()
      recorder.onerror = () => reject(new Error('recorder error'))
    })

    recorder.start(1000)
    video.playbackRate = 1
    await video.play()
    await new Promise<void>((resolve) => {
      video.onended = () => resolve()
      setTimeout(resolve, Math.ceil(duration * 1000) + 500)
    })
    recorder.stop()
    await done

    const blob = new Blob(chunks, { type: mime })
    if (blob.size === 0 || blob.size > TARGET_MAX_BYTES * 2) return null
    const ext = mime.includes('webm') ? 'webm' : 'mp4'
    const base = file.name.replace(/\.[^.]+$/, '') || 'video'
    return new File([blob], `${base}_optimized.${ext}`, { type: mime })
  } finally {
    URL.revokeObjectURL(url)
  }
}
