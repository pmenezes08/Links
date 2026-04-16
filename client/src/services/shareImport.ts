import { Capacitor, registerPlugin } from '@capacitor/core'
import { clearPendingShareFiles, setPendingShareFiles } from './shareImportStore'

export type ShareImportItem = {
  path: string
  mimeType: string
  kind: string
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

function guessExtension(mime: string, kind: string): string {
  const m = mime.toLowerCase()
  if (m.includes('video')) {
    if (m.includes('quicktime')) return '.mov'
    if (m.includes('webm')) return '.webm'
    return '.mp4'
  }
  if (m.includes('png')) return '.png'
  if (m.includes('gif')) return '.gif'
  if (m.includes('heic')) return '.heic'
  if (kind === 'video') return '.mp4'
  return '.jpg'
}

/** Reads App Group manifest via native bridge, copies into File[], clears native inbox. */
export async function hydrateShareFromNative(): Promise<File[]> {
  if (Capacitor.getPlatform() === 'web') return []
  const { items } = await ShareImport.getPending()
  if (!items?.length) return []
  const files: File[] = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const src = Capacitor.convertFileSrc(it.path)
    const res = await fetch(src)
    const blob = await res.blob()
    const ext = guessExtension(it.mimeType || blob.type, it.kind)
    const name = `share_${i}${ext}`
    const type = it.mimeType || blob.type || 'application/octet-stream'
    files.push(new File([blob], name, { type }))
  }
  await ShareImport.clearPending()
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
