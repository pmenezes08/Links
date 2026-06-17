// Native camera + photo-library picker and save-to-gallery, returning plain File[]/bool
// so the EXISTING upload pipeline (mediaSenders / upload kernel) is untouched — we only
// change how the File[] is produced. Web (incl. mobile web) returns null/false so callers
// fall back to their existing <input type=file>. Cancel returns null WITHOUT throwing, so
// callers must distinguish "not native" (fall back) from "native cancelled" (abort).
//
// IMPORTANT — remote server.url: the app loads a REMOTE https origin in the native WebView,
// so the Camera plugin's `webPath` (which points at the local capacitor file server) is NOT
// reachable via fetch() cross-origin. We therefore read the picked/captured file through the
// Filesystem native bridge (item.path) and only fall back to fetch(webPath) for local-server
// dev builds.
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

export function isNativeMediaPlatform(): boolean {
  return Capacitor.isNativePlatform()
}

type PickedItem = { path?: string; webPath?: string; format?: string }

function mimeForFormat(format?: string): { mime: string; ext: string } {
  const f = (format || 'jpeg').toLowerCase()
  if (f.includes('png')) return { mime: 'image/png', ext: 'png' }
  if (f.includes('webp')) return { mime: 'image/webp', ext: 'webp' }
  if (f.includes('gif')) return { mime: 'image/gif', ext: 'gif' }
  if (f.includes('heic')) return { mime: 'image/heic', ext: 'heic' }
  return { mime: 'image/jpeg', ext: 'jpg' }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const byteChars = atob(base64)
  const bytes = new Uint8Array(byteChars.length)
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/** Turn a Camera/Gallery result into a File, reading the native path via Filesystem. */
async function pickedItemToFile(item: PickedItem, name: string): Promise<File> {
  const { mime, ext } = mimeForFormat(item.format)
  // Preferred path: read the native file through the bridge (works under a remote server.url).
  if (item.path) {
    try {
      const { Filesystem } = await import('@capacitor/filesystem')
      const res = await Filesystem.readFile({ path: item.path })
      const blob = typeof res.data === 'string' ? base64ToBlob(res.data, mime) : res.data
      return new File([blob], `${name}.${ext}`, { type: mime })
    } catch {
      /* fall through to webPath for dev/local-server builds */
    }
  }
  if (item.webPath) {
    const res = await fetch(item.webPath)
    const blob = await res.blob()
    return new File([blob], `${name}.${ext}`, { type: blob.type || mime })
  }
  throw new Error('no_readable_path')
}

function isUserCancelled(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return m.includes('cancel') || m.includes('denied') || m.includes('no image')
}

// `onReadStart` fires once the picker has closed and we begin reading files off the bridge
// (which can take a few seconds for several photos) — callers use it to show a "preparing"
// spinner without flashing it behind the still-open picker.

/** Single shot from the CAMERA → [File], or null (not native / user cancelled). */
export async function capturePhotoNative(onReadStart?: () => void): Promise<File[] | null> {
  if (!isNativeMediaPlatform()) return null
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri, // Uri (not base64) → low memory; we read via Filesystem
      quality: 90,
      allowEditing: false,
      saveToGallery: false,
    })
    if (!photo.path && !photo.webPath) return null
    onReadStart?.()
    return [await pickedItemToFile(photo, `camera_${Date.now()}`)]
  } catch (e) {
    if (isUserCancelled(e)) return null
    throw e
  }
}

/** Multi-select from the photo LIBRARY → File[] (images only; videos stay on web input). */
export async function pickFromLibraryNative(limit = 10, onReadStart?: () => void): Promise<File[] | null> {
  if (!isNativeMediaPlatform()) return null
  try {
    const { photos } = await Camera.pickImages({ quality: 90, limit })
    if (!photos?.length) return null
    onReadStart?.()
    // Read photos off the native bridge SEQUENTIALLY, not via Promise.all: each read
    // pulls a full-resolution base64 string + allocates a Uint8Array/Blob, and decoding
    // up to `limit` (10) of them concurrently is a large synchronous memory spike that can
    // trip the iOS WKWebView memory watchdog (presents to the user as an app crash).
    // Sequential reads cap peak memory at roughly one photo at a time.
    const files: File[] = []
    for (let i = 0; i < photos.length; i++) {
      files.push(await pickedItemToFile(photos[i], `library_${Date.now()}_${i}`))
    }
    return files
  } catch (e) {
    if (isUserCancelled(e)) return null
    throw e
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const s = String(r.result || '')
      const comma = s.indexOf(',')
      resolve(comma >= 0 ? s.slice(comma + 1) : s)
    }
    r.onerror = () => reject(new Error('read_failed'))
    r.readAsDataURL(blob)
  })
}

/** Save a remote media URL to the device camera roll. Returns false on web (caller keeps its download path). */
export async function saveToGalleryNative(remoteUrl: string, type: 'image' | 'video'): Promise<boolean> {
  if (!isNativeMediaPlatform()) return false
  const res = await fetch(remoteUrl)
  if (!res.ok) throw new Error('download_failed')
  const blob = await res.blob()
  const base64 = await blobToBase64(blob)
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  const ext = type === 'video' ? 'mp4' : 'jpg'
  const tmp = await Filesystem.writeFile({
    path: `cpoint_${Date.now()}.${ext}`,
    data: base64,
    directory: Directory.Cache,
  })
  const { Media } = await import('@capacitor-community/media')
  if (type === 'video') await Media.saveVideo({ path: tmp.uri })
  else await Media.savePhoto({ path: tmp.uri })
  return true
}
