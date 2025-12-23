/**
 * Client-side video compression utility
 * Compresses videos before upload for faster transmission
 */

export interface CompressionProgress {
  stage: 'loading' | 'compressing' | 'done'
  progress: number // 0-100
}

export interface CompressionResult {
  file: File
  originalSize: number
  compressedSize: number
  compressionRatio: number
}

// Target video settings for compression
const TARGET_WIDTH = 720 // 720p max width
const TARGET_HEIGHT = 1280 // For portrait videos
const TARGET_BITRATE = 1_500_000 // 1.5 Mbps
const MAX_DURATION_SECONDS = 120 // 2 minutes max

/**
 * Check if browser supports video compression via MediaRecorder
 */
export function supportsVideoCompression(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLVideoElement !== 'undefined' &&
    // Check for WebM support (most browsers) or MP4 (Safari)
    (MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ||
     MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ||
     MediaRecorder.isTypeSupported('video/mp4'))
  )
}

/**
 * Get the best supported video MIME type
 */
function getBestMimeType(): string {
  const types = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ]
  
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type
    }
  }
  
  return 'video/webm'
}

/**
 * Calculate target dimensions maintaining aspect ratio
 */
function calculateTargetDimensions(
  width: number,
  height: number
): { width: number; height: number } {
  const isPortrait = height > width
  const maxDim = isPortrait ? TARGET_HEIGHT : TARGET_WIDTH
  const minDim = isPortrait ? TARGET_WIDTH : TARGET_HEIGHT
  
  // If video is already small enough, keep original dimensions
  if (width <= maxDim && height <= maxDim) {
    // Round to even numbers for video encoding
    return {
      width: Math.floor(width / 2) * 2,
      height: Math.floor(height / 2) * 2
    }
  }
  
  const aspectRatio = width / height
  let targetWidth: number
  let targetHeight: number
  
  if (isPortrait) {
    targetHeight = Math.min(height, maxDim)
    targetWidth = Math.min(targetHeight * aspectRatio, minDim)
  } else {
    targetWidth = Math.min(width, maxDim)
    targetHeight = Math.min(targetWidth / aspectRatio, minDim)
  }
  
  // Ensure even dimensions for video encoding
  return {
    width: Math.floor(targetWidth / 2) * 2,
    height: Math.floor(targetHeight / 2) * 2
  }
}

/**
 * Compress a video file for faster uploads
 * Falls back to original if compression fails or isn't supported
 */
export async function compressVideo(
  file: File,
  onProgress?: (progress: CompressionProgress) => void
): Promise<CompressionResult> {
  const originalSize = file.size
  
  // Skip compression for small files (< 5MB)
  if (originalSize < 5 * 1024 * 1024) {
    onProgress?.({ stage: 'done', progress: 100 })
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1
    }
  }
  
  // Check browser support
  if (!supportsVideoCompression()) {
    console.log('Video compression not supported, using original')
    onProgress?.({ stage: 'done', progress: 100 })
    return {
      file,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 1
    }
  }
  
  onProgress?.({ stage: 'loading', progress: 0 })
  
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    
    // Clean up function
    const cleanup = () => {
      video.pause()
      video.src = ''
      video.load()
      URL.revokeObjectURL(video.src)
    }
    
    // Fallback to original on error
    const fallbackToOriginal = () => {
      cleanup()
      onProgress?.({ stage: 'done', progress: 100 })
      resolve({
        file,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 1
      })
    }
    
    video.onerror = fallbackToOriginal
    video.src = URL.createObjectURL(file)
    video.muted = true
    
    video.onloadedmetadata = () => {
      const duration = Math.min(video.duration, MAX_DURATION_SECONDS)
      const { width, height } = calculateTargetDimensions(video.videoWidth, video.videoHeight)
      
      canvas.width = width
      canvas.height = height
      
      onProgress?.({ stage: 'loading', progress: 25 })
      
      // Set up MediaRecorder
      const mimeType = getBestMimeType()
      const stream = canvas.captureStream(30) // 30 FPS
      
      // Try to capture audio from video
      try {
        const audioContext = new AudioContext()
        const source = audioContext.createMediaElementSource(video)
        const destination = audioContext.createMediaStreamDestination()
        source.connect(destination)
        source.connect(audioContext.destination)
        
        // Add audio track to stream
        destination.stream.getAudioTracks().forEach(track => {
          stream.addTrack(track)
        })
      } catch (e) {
        // Audio capture failed, continue without audio
        console.log('Audio capture not available, video will be silent')
      }
      
      const chunks: Blob[] = []
      let recorder: MediaRecorder
      
      try {
        recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: TARGET_BITRATE
        })
      } catch (e) {
        // MediaRecorder failed, fallback
        fallbackToOriginal()
        return
      }
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data)
        }
      }
      
      recorder.onstop = () => {
        cleanup()
        
        const blob = new Blob(chunks, { type: mimeType })
        const compressedSize = blob.size
        
        // Only use compressed version if it's actually smaller
        if (compressedSize >= originalSize * 0.9) {
          // Compression didn't help much, use original
          onProgress?.({ stage: 'done', progress: 100 })
          resolve({
            file,
            originalSize,
            compressedSize: originalSize,
            compressionRatio: 1
          })
          return
        }
        
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
        const compressedFile = new File(
          [blob],
          file.name.replace(/\.[^.]+$/, `.${extension}`),
          { type: mimeType }
        )
        
        onProgress?.({ stage: 'done', progress: 100 })
        resolve({
          file: compressedFile,
          originalSize,
          compressedSize,
          compressionRatio: originalSize / compressedSize
        })
      }
      
      recorder.onerror = fallbackToOriginal
      
      // Start recording
      recorder.start(100) // Collect data every 100ms
      onProgress?.({ stage: 'compressing', progress: 30 })
      
      let currentTime = 0
      const frameInterval = 1 / 30 // 30 FPS
      
      const drawFrame = () => {
        if (currentTime >= duration) {
          recorder.stop()
          return
        }
        
        video.currentTime = currentTime
      }
      
      video.onseeked = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        currentTime += frameInterval
        
        // Update progress
        const progress = 30 + (currentTime / duration) * 65
        onProgress?.({ stage: 'compressing', progress: Math.min(95, progress) })
        
        // Use setTimeout to not block the main thread
        setTimeout(drawFrame, 0)
      }
      
      // Start the process
      video.currentTime = 0
    }
    
    // Start loading
    video.load()
  })
}

/**
 * Quick check if a video file should be compressed
 * Returns true if the file is large enough to benefit from compression
 */
export function shouldCompressVideo(file: File): boolean {
  // Compress if larger than 5MB
  return file.size > 5 * 1024 * 1024
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}
