/** In-memory handoff for iOS Share Extension → DM / group / compose (survives SPA navigation). */

let pendingFiles: File[] | null = null

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

export function clearPendingShareFiles() {
  pendingFiles = null
}
