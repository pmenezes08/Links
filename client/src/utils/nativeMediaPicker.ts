// Native camera + photo-library picker and save-to-gallery, returning plain File[]/bool
// so the EXISTING upload pipeline (mediaSenders / upload kernel) is untouched — we only
// change how the File[] is produced. Web (incl. mobile web) returns null/false so callers
// fall back to their existing <input type=file>. Cancel returns null WITHOUT throwing, so
// callers must distinguish "not native" (fall back) from "native cancelled" (abort).
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'

export function isNativeMediaPlatform(): boolean {
  return Capacitor.isNativePlatform()
}

async function uriToFile(webPath: string, fallbackName: string): Promise<File> {
  const res = await fetch(webPath)
  const blob = await res.blob()
  const type = blob.type || 'image/jpeg'
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : 'jpg'
  return new File([blob], `${fallbackName}.${ext}`, { type })
}

function isUserCancelled(e: unknown): boolean {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase()
  return m.includes('cancel') || m.includes('denied') || m.includes('no image')
}

/** Single shot from the CAMERA → [File], or null (not native / user cancelled). */
export async function capturePhotoNative(): Promise<File[] | null> {
  if (!isNativeMediaPlatform()) return null
  try {
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      resultType: CameraResultType.Uri, // Uri (not base64) → low memory; kernel compresses
      quality: 90,
      allowEditing: false,
      saveToGallery: false,
    })
    if (!photo.webPath) return null
    return [await uriToFile(photo.webPath, `camera_${Date.now()}`)]
  } catch (e) {
    if (isUserCancelled(e)) return null
    throw e
  }
}

/** Multi-select from the photo LIBRARY → File[] (images only; videos stay on web input). */
export async function pickFromLibraryNative(limit = 10): Promise<File[] | null> {
  if (!isNativeMediaPlatform()) return null
  try {
    const { photos } = await Camera.pickImages({ quality: 90, limit })
    if (!photos?.length) return null
    return await Promise.all(photos.map((p, i) => uriToFile(p.webPath, `library_${Date.now()}_${i}`)))
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
