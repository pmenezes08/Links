import { describe, expect, it } from 'vitest'
import { cancelUpload, createUploadController, hasUploadController, removeUploadController } from './uploadControllers'

describe('uploadControllers', () => {
  it('registers, cancels, and removes an upload controller by client key', () => {
    const controller = createUploadController('client-1')

    expect(hasUploadController('client-1')).toBe(true)
    expect(controller.signal.aborted).toBe(false)
    expect(cancelUpload('client-1')).toBe(true)
    expect(controller.signal.aborted).toBe(true)

    removeUploadController('client-1')
    expect(hasUploadController('client-1')).toBe(false)
    expect(cancelUpload('client-1')).toBe(false)
  })
})
