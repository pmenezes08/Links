/** In-memory handoff for Share Extension → DM / group / compose (survives SPA navigation). */

let pendingFiles: File[] | null = null
let pendingShareUrls: string[] | null = null

/** Survives React Strict Mode double-mount: first mount takes from pending; remount reuses the same handoff for the same navigation key. */
const shareHandoffByKey = new Map<string, File[]>()
const shareUrlHandoffByKey = new Map<string, string[]>()

export function setPendingShareFiles(files: File[]) {
  pendingFiles = files.length ? [...files] : null
}

export function setPendingShareUrls(urls: string[]) {
  pendingShareUrls = urls.length ? [...urls] : null
}

export function peekPendingShareFiles(): File[] | null {
  return pendingFiles ? [...pendingFiles] : null
}

export function peekPendingShareUrls(): string[] | null {
  return pendingShareUrls ? [...pendingShareUrls] : null
}

export function takePendingShareFiles(): File[] | null {
  if (!pendingFiles) return null
  const out = [...pendingFiles]
  pendingFiles = null
  return out
}

export function takePendingShareUrls(): string[] | null {
  if (!pendingShareUrls) return null
  const out = [...pendingShareUrls]
  pendingShareUrls = null
  return out
}

/**
 * Use when consuming the handoff in a route effect. Same key must be used for Strict Mode remounts
 * so the second mount still receives files without calling takePendingShareFiles again.
 */
export function takePendingShareFilesOnce(navigationKey: string): File[] | null {
  const cached = shareHandoffByKey.get(navigationKey)
  if (cached?.length) return cached

  const taken = takePendingShareFiles()
  if (taken?.length) {
    shareHandoffByKey.set(navigationKey, taken)
  }
  return taken
}

export function takePendingShareUrlsOnce(navigationKey: string): string[] | null {
  const cached = shareUrlHandoffByKey.get(navigationKey)
  if (cached?.length) return cached

  const taken = takePendingShareUrls()
  if (taken?.length) {
    shareUrlHandoffByKey.set(navigationKey, taken)
  }
  return taken
}

export function releaseShareHandoffKey(navigationKey: string) {
  shareHandoffByKey.delete(navigationKey)
}

export function releaseShareUrlHandoffKey(navigationKey: string) {
  shareUrlHandoffByKey.delete(navigationKey)
}

export function clearPendingShareFiles() {
  pendingFiles = null
}

export function clearPendingShareUrls() {
  pendingShareUrls = null
}
