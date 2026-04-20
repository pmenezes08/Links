import { useCallback, useEffect, useRef, useState } from 'react'

export type RecordingPreview = { blob: Blob; url: string; duration: number }

/** iOS Safari / WKWebView need periodic chunks; without timeslice, ondataavailable often stays empty until stop and blob assembly fails. */
const RECORDER_TIMESLICE_MS = 200

function isAppleWebKitMediaRecorder(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return true
  // iPadOS 13+ desktop UA
  const mtp = (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ?? 0
  if (navigator.platform === 'MacIntel' && mtp > 1) {
    return true
  }
  return false
}

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [recordMs, setRecordMs] = useState(0)
  const [preview, setPreview] = useState<RecordingPreview | null>(null)
  const [level, setLevel] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  /** Prevents double stop (iOS often fires pointerdown + click on one tap). */
  const stoppingRef = useRef(false)
  const startTimeRef = useRef<number>(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)

  const cleanup = useCallback(() => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    // Stop visualizer
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }

    // Close audio context
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close() } catch {}
      audioCtxRef.current = null
      analyserRef.current = null
    }

    // Stop stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try { track.stop() } catch {}
      })
      streamRef.current = null
    }

    // Clear recorder
    recorderRef.current = null
    setLevel(0)
  }, [])

  const start = useCallback(async () => {
    try {
      // Check browser support
      if (!navigator.mediaDevices?.getUserMedia) {
        alert('Microphone not available. Please enable permissions.')
        return
      }
      if (!window.MediaRecorder) {
        alert('Recording not supported. Please update your browser.')
        return
      }

      // Cleanup any existing recording
      cleanup()
      chunksRef.current = []

      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Find supported MIME type (iOS / Safari prefers mp4; Android Chrome often webm)
      const mimeTypes = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/wav']
      let mimeType = ''
      for (const type of mimeTypes) {
        try {
          if (MediaRecorder.isTypeSupported(type)) {
            mimeType = type
            break
          }
        } catch {
          /* some WebViews throw instead of returning false */
        }
      }

      // Create recorder
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      // Collect audio data (must not skip empty-looking events; merge small final chunks on iOS)
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data)
        }
      }

      // Setup visualizer
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
        if (AudioCtx) {
          const ctx = new AudioCtx()
          if (ctx.state === 'suspended') await ctx.resume()
          
          const source = ctx.createMediaStreamSource(stream)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.8
          source.connect(analyser)
          
          audioCtxRef.current = ctx
          analyserRef.current = analyser

          const dataArray = new Uint8Array(analyser.frequencyBinCount)
          const updateLevel = () => {
            if (!analyserRef.current) return
            analyserRef.current.getByteFrequencyData(dataArray)
            const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
            setLevel(Math.min(1, avg / 128))
            rafRef.current = requestAnimationFrame(updateLevel)
          }
          rafRef.current = requestAnimationFrame(updateLevel)
        }
      } catch {}

      // Timeslice required for Safari / iOS WKWebView to emit any chunks; safe on Android Chrome too.
      recorder.start(RECORDER_TIMESLICE_MS)
      startTimeRef.current = Date.now()
      setRecording(true)
      setRecordMs(0)
      setPreview(null)

      // Update timer display
      timerRef.current = setInterval(() => {
        setRecordMs(Date.now() - startTimeRef.current)
      }, 100)

    } catch (e: any) {
      cleanup()
      alert('Could not start recording: ' + (e?.message || 'Unknown error'))
    }
  }, [cleanup])

  // Internal stop function - setPreviewState controls whether to set preview state
  const stopInternal = useCallback((setPreviewState: boolean): Promise<RecordingPreview | null> => {
    return new Promise((resolve) => {
      if (stoppingRef.current) {
        resolve(null)
        return
      }

      const recorder = recorderRef.current
      const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))
      const apple = isAppleWebKitMediaRecorder()
      /** Last data may arrive slightly after onstop on WebKit; give it time before assembling. */
      const flushDelayMs = apple ? 350 : 80

      if (!recorder || recorder.state === 'inactive') {
        cleanup()
        setRecording(false)
        stoppingRef.current = false
        resolve(null)
        return
      }

      stoppingRef.current = true

      const finish = (previewData: RecordingPreview | null) => {
        stoppingRef.current = false
        if (previewData) {
          if (setPreviewState) {
            setPreview(previewData)
          }
        }
        cleanup()
        setRecording(false)
        resolve(previewData)
      }

      recorder.onstop = () => {
        setTimeout(() => {
          try {
            if (chunksRef.current.length > 0) {
              const mimeType =
                recorder.mimeType ||
                chunksRef.current[0]?.type ||
                (apple ? 'audio/mp4' : 'audio/webm')
              const blob = new Blob(chunksRef.current, { type: mimeType })

              if (blob.size > 0) {
                const url = URL.createObjectURL(blob)
                finish({ blob, url, duration })
                return
              }
            }
            finish(null)
          } catch {
            finish(null)
          }
        }, flushDelayMs)
      }

      try {
        // Flush any buffered data before stop (Chrome / spec); ignored if unsupported.
        if (recorder.state === 'recording' && typeof recorder.requestData === 'function') {
          recorder.requestData()
        }
      } catch {
        /* ignore */
      }

      try {
        recorder.stop()
      } catch {
        stoppingRef.current = false
        cleanup()
        setRecording(false)
        resolve(null)
      }
    })
  }, [cleanup])

  // Stop and show preview (pause button)
  const stop = useCallback((): Promise<RecordingPreview | null> => {
    return stopInternal(true)
  }, [stopInternal])

  // Stop and get blob without showing preview (send button)
  const stopAndGetBlob = useCallback(async (): Promise<RecordingPreview | null> => {
    return stopInternal(false)
  }, [stopInternal])

  const clearPreview = useCallback(() => {
    if (preview?.url) {
      try { URL.revokeObjectURL(preview.url) } catch {}
    }
    setPreview(null)
  }, [preview])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
      if (preview?.url) {
        try { URL.revokeObjectURL(preview.url) } catch {}
      }
    }
  }, [cleanup, preview])

  return {
    recording,
    recordMs,
    preview,
    level,
    start,
    stop,
    stopAndGetBlob,
    clearPreview
  }
}
