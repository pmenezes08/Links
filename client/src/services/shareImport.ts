import { Capacitor, registerPlugin } from '@capacitor/core'
import { clearPendingShareFiles, setPendingShareFiles } from './shareImportStore'

export type ShareImportItem = {
  /** Original filename from the share manifest (e.g. item_0.jpg). */
  filename?: string
  mimeType: string
  kind: string
  /** Base64 file payload from native; avoids WKWebView fetch(capacitor://_capacitor_file_/...) failures. */
  dataBase64: string
}

interface ShareImportPluginInterface {
  getPending(): Promise<{ items: ShareImportItem[] }>
  clearPending(): Promise<void>
}

const ShareImport = registerPlugin<ShareImportPluginInterface>('ShareImport', {
  web: () => ({
    async getPending() {
      return { items: [] }
    },
    async clearPending() {},
  }),
})

/** Human-readable detail for ShareIncoming / debugging (Capacitor uses message or errorMessage). */
export function formatShareLoadError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    if (typeof o.errorMessage === 'string') return o.errorMessage
    if (typeof o.message === 'string') return o.message
  }
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const len = binary.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function guessExtension(mime: string, kind: string): string {
  const m = mime.toLowerCase()
  if (m === 'application/pdf' || kind === 'document') return '.pdf'
  if (m.includes('audio')) {
    if (m.includes('mpeg') && !m.includes('mp4')) return '.mp3'
    if (m.includes('mp4') || m.includes('m4a')) return '.m4a'
    if (m.includes('wav')) return '.wav'
    if (m.includes('aac')) return '.aac'
    if (kind === 'audio') return '.m4a'
  }
  if (m.includes('video')) {
    if (m.includes('quicktime')) return '.mov'
    if (m.includes('webm')) return '.webm'
    return '.mp4'
  }
  if (m.includes('png')) return '.png'
  if (m.includes('gif')) return '.gif'
  if (m.includes('heic')) return '.heic'
  if (kind === 'video') return '.mp4'
  if (kind === 'audio') return '.m4a'
  return '.jpg'
}

/** Classify shared File objects for routing in ShareIncoming. */
export function fileIsPdf(f: File): boolean {
  return f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
}

export function fileIsAudio(f: File): boolean {
  return f.type.startsWith('audio/')
}

export function fileIsChatShareableMedia(f: File): boolean {
  return f.type.startsWith('image/') || f.type.startsWith('video/') || fileIsAudio(f)
}

export function fileIsFeedImageOrVideo(f: File): boolean {
  return f.type.startsWith('image/') || f.type.startsWith('video/')
}

/** Reads App Group manifest via native bridge, copies into File[], clears native inbox. */
export async function hydrateShareFromNative(): Promise<File[]> {
  if (Capacitor.getPlatform() === 'web') return []
  let items: ShareImportItem[]
  try {
    const pending = await ShareImport.getPending()
    items = pending.items ?? []
  } catch (e) {
    throw new Error(`ShareImport.getPending failed: ${formatShareLoadError(e)}`)
  }
  if (!items?.length) return []
  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it.dataBase64 || typeof it.dataBase64 !== 'string') {
      throw new Error(`ShareImport item ${i} missing dataBase64 (rebuild the iOS app with the latest ShareImportPlugin)`)
    }
    try {
      const type = it.mimeType || 'application/octet-stream'
      const blob = base64ToBlob(it.dataBase64, type)
      const ext = guessExtension(type, it.kind)
      const baseName = it.filename?.trim() ? `share_${i}_${it.filename}` : `share_${i}${ext}`
      files.push(new File([blob], baseName, { type }))
    } catch (e) {
      throw new Error(`Failed to decode shared file ${i}: ${formatShareLoadError(e)}`)
    }
  }
  try {
    await ShareImport.clearPending()
  } catch (e) {
    throw new Error(`ShareImport.clearPending failed: ${formatShareLoadError(e)}`)
  }
  return files
}

/** Load native share inbox into the global pending store. */
export async function loadShareIntoStore(): Promise<File[]> {
  const files = await hydrateShareFromNative()
  if (files.length) setPendingShareFiles(files)
  return files
}

export async function resetShareStore() {
  clearPendingShareFiles()
  if (Capacitor.getPlatform() !== 'web') {
    await ShareImport.clearPending()
  }
}
