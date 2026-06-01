const controllers = new Map<string, AbortController>()

export function createUploadController(clientKey: string): AbortController {
  const existing = controllers.get(clientKey)
  existing?.abort()
  const controller = new AbortController()
  controllers.set(clientKey, controller)
  return controller
}

export function cancelUpload(clientKey: string): boolean {
  const controller = controllers.get(clientKey)
  if (!controller) return false
  controller.abort()
  return true
}

export function removeUploadController(clientKey: string): void {
  controllers.delete(clientKey)
}

export function hasUploadController(clientKey: string): boolean {
  return controllers.has(clientKey)
}
