/** In-memory handoff for iOS Share Extension → DM / group / compose (survives SPA navigation). */

let pendingFiles: File[] | null = null

/** Survives React Strict Mode double-mount: first mount takes from pendingFiles; remount reuses the same File[] for the same navigation key. */
const shareHandoffByKey = new Map<string, File[]>()

export function setPendingShareFiles(files: File[]) {
  pendingFiles = files.length ? [...files] : null
}

export function peekPendingShareFiles(): File[] | null {
  return pendingFiles ? [...pendingFiles] : null
}

export function takePendingShareFiles(): File[] | null {
  if (!pendingFiles) return null
  const out = [...pendingFiles]
  pendingFiles = null
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

export function releaseShareHandoffKey(navigationKey: string) {
  shareHandoffByKey.delete(navigationKey)
}

export function clearPendingShareFiles() {
  pendingFiles = null
}
