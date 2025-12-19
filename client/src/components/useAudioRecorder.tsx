import { useCallback, useEffect, useRef, useState } from 'react'

export type RecordingPreview = { blob: Blob; url: string; duration: number }

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [recordMs, setRecordMs] = useState(0)
  const [preview, setPreview] = useState<RecordingPreview | null>(null)
  const [level, setLevel] = useState(0)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
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

      // Find supported MIME type (iOS prefers mp4)
      const mimeTypes = ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav']
      let mimeType = ''
      for (const type of mimeTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          break
        }
      }

      // Create recorder
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder

      // Collect audio data
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

      // Start recording with timeslice for long recordings
      recorder.start(1000)
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

  const stop = useCallback((): Promise<RecordingPreview | null> => {
    return new Promise((resolve) => {
      const recorder = recorderRef.current
      const duration = Math.max(1, Math.round((Date.now() - startTimeRef.current) / 1000))

      if (!recorder || recorder.state === 'inactive') {
        cleanup()
        setRecording(false)
        resolve(null)
        return
      }

      // Request any buffered data
      try { recorder.requestData() } catch {}

      recorder.onstop = () => {
        // Small delay to ensure all data is collected
        setTimeout(() => {
          if (chunksRef.current.length > 0) {
            const mimeType = recorder.mimeType || 'audio/mp4'
            const blob = new Blob(chunksRef.current, { type: mimeType })
            
            if (blob.size > 0) {
              const url = URL.createObjectURL(blob)
              const previewData = { blob, url, duration }
              setPreview(previewData)
              cleanup()
              setRecording(false)
              resolve(previewData)
              return
            }
          }
          
          cleanup()
          setRecording(false)
          resolve(null)
        }, 100)
      }

      // Stop recording
      try {
        recorder.stop()
      } catch {
        cleanup()
        setRecording(false)
        resolve(null)
      }
    })
  }, [cleanup])

  const stopAndGetBlob = useCallback(async (): Promise<RecordingPreview | null> => {
    return stop()
  }, [stop])

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
