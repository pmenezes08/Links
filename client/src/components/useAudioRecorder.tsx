import { useCallback, useEffect, useRef, useState } from 'react'

export type RecordingPreview = { blob: Blob; url: string; duration: number }

export function useAudioRecorder() {
  const [recording, setRecording] = useState(false)
  const [recordMs, setRecordMs] = useState(0)
  const recordTimerRef = useRef<any>(null)
  const recorderRef = useRef<MediaRecorder|null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const streamRef = useRef<MediaStream|null>(null)
  const [preview, setPreview] = useState<RecordingPreview|null>(null)
  const startedAtRef = useRef<number>(0)
  const finalizeTimerRef = useRef<any>(null)
  const stoppedRef = useRef(false)
  const finalizeAttemptRef = useRef(0)
  const stopTimeoutRef = useRef<any>(null)

  // Simple live level meter using WebAudio analyser
  const audioCtxRef = useRef<AudioContext|null>(null)
  const analyserRef = useRef<AnalyserNode|null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode|null>(null)
  const visRafRef = useRef<number| null>(null)
  const [level, setLevel] = useState(0) // 0..1

  const isMobile = (() => {
    try {
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
        || ((navigator.platform === 'MacIntel') && (navigator.maxTouchPoints || 0) > 2)
    } catch { return false }
  })()

  const stopStream = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
        streamRef.current = null
      }
    } catch {}
  }

  const clearTimers = () => {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current)
    if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current)
  }

  const resetState = () => {
    setRecording(false)
    setRecordMs(0)
    recorderRef.current = null
    chunksRef.current = []
    stoppedRef.current = false
    finalizeAttemptRef.current = 0
    clearTimers()
    setLevel(0)
    try {
      if (visRafRef.current) cancelAnimationFrame(visRafRef.current)
      if (analyserRef.current) analyserRef.current.disconnect()
      if (sourceRef.current) sourceRef.current.disconnect()
      if (audioCtxRef.current) audioCtxRef.current.close()
    } catch {}
    analyserRef.current = null
    sourceRef.current = null
    audioCtxRef.current = null
  }

  const finalize = useCallback(() => {
    if (!stoppedRef.current) return
    if (chunksRef.current.length === 0) {
      if (finalizeAttemptRef.current < 2) {
        finalizeAttemptRef.current += 1
        finalizeTimerRef.current = setTimeout(finalize, 400)
        return
      }
    }
    try {
      const preferType = isMobile ? 'audio/mp4' : 'audio/webm'
      let blob = new Blob(chunksRef.current, { type: preferType })
      if (blob.size === 0) {
        resetState()
        return
      }
      let actualDuration = Math.round(recordMs / 1000)
      try {
        const tmpUrl = URL.createObjectURL(blob)
        const a = new Audio(tmpUrl)
        a.addEventListener('loadedmetadata', () => {
          if (a.duration && isFinite(a.duration)) {
            const d = Math.round(a.duration)
            if (d > actualDuration) actualDuration = d
          }
          URL.revokeObjectURL(tmpUrl)
        })
      } catch {}
      const url = URL.createObjectURL(blob)
      setPreview({ blob, url, duration: actualDuration })
    } finally {
      stopStream()
      resetState()
    }
  }, [isMobile, recordMs])

  const start = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Microphone access is not available. Please enable microphone permissions in your device settings.')
        return
      }
      if (!('MediaRecorder' in window)) {
        alert('Recording is not supported in this browser. Please update iOS to 14.3 or later.')
        return
      }
      
      // CRITICAL iOS FIX: Clean up any existing resources before starting
      stopStream()
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.stop()
        }
      } catch {}
      try {
        if (audioCtxRef.current) {
          await audioCtxRef.current.close()
          audioCtxRef.current = null
        }
      } catch {}
      clearTimers()
      
      // Request microphone permission with specific constraints
      const constraints: MediaStreamConstraints = isMobile ? { audio: true } : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 44100 } }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      
      // Determine best MIME type - prioritize formats that work on iOS
      let mimeType = ''
      const types = isMobile ? ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav'] : ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4','audio/wav']
      for (const t of types) { 
        try { 
          if ((window as any).MediaRecorder.isTypeSupported(t)) { 
            mimeType = t
            break 
          } 
        } catch {}
      }
      
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = mr
      chunksRef.current = []
      stoppedRef.current = false
      finalizeAttemptRef.current = 0
      // Visualizer setup
      try {
        const AudioContextClass: any = (window as any).AudioContext || (window as any).webkitAudioContext
        if (AudioContextClass) {
          const ctx = new AudioContextClass()
          
          // iOS requires AudioContext to be resumed after user interaction
          if (ctx.state === 'suspended') {
            await ctx.resume()
          }
          
          const src = ctx.createMediaStreamSource(stream)
          const analyser = ctx.createAnalyser()
          analyser.fftSize = 256
          analyser.minDecibels = -80
          analyser.maxDecibels = -10
          analyser.smoothingTimeConstant = 0.85
          src.connect(analyser)
          audioCtxRef.current = ctx
          sourceRef.current = src
          analyserRef.current = analyser
          const dataArray = new Uint8Array(analyser.frequencyBinCount)
          const tick = () => {
            try {
              analyser.getByteFrequencyData(dataArray)
              let sum = 0
              for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
              const avg = sum / dataArray.length // 0..255
              const lvl = Math.min(1, Math.max(0, avg / 255))
              setLevel(lvl)
            } catch {}
            visRafRef.current = requestAnimationFrame(tick)
          }
          visRafRef.current = requestAnimationFrame(tick)
        }
      } catch {}
      mr.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) {
          chunksRef.current.push(e.data)
          if (stoppedRef.current) {
            if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
            finalizeTimerRef.current = setTimeout(finalize, 150)
          }
        }
      }
      mr.onstop = () => {
        stoppedRef.current = true
        if (finalizeTimerRef.current) clearTimeout(finalizeTimerRef.current)
        finalizeTimerRef.current = setTimeout(finalize, 400)
      }
      setPreview(null)
      setRecording(true)
      startedAtRef.current = Date.now()
      if (recordTimerRef.current) clearInterval(recordTimerRef.current)
      recordTimerRef.current = setInterval(() => setRecordMs(Date.now() - startedAtRef.current), 200)
      if (isMobile) {
        mr.start()
      } else {
        mr.start(1000)
      }
      // No time limit - user controls when to stop
    } catch (e:any) {
      alert('Could not access microphone: ' + (e?.message || 'Unknown error'))
      resetState()
      stopStream()
    }
  }, [finalize, isMobile])

  const stop = useCallback(() => {
    try {
      const mr = recorderRef.current
      if (mr && mr.state !== 'inactive') {
        stoppedRef.current = true
        if (isMobile) {
          try { mr.requestData() } catch {}
          setTimeout(() => { 
            try { 
              mr.stop() 
              // CRITICAL iOS FIX: Stop stream immediately after stopping recorder
              setTimeout(() => stopStream(), 500)
            } catch {} 
          }, 120)
        } else {
          mr.stop()
          // Stop stream for desktop too
          setTimeout(() => stopStream(), 500)
        }
      }
    } catch {}
    // UI safety reset
    setTimeout(() => { 
      setRecording(false)
      recorderRef.current = null
    }, 800)
  }, [isMobile])

  const clearPreview = useCallback(() => {
    try { 
      if (preview?.url) {
        URL.revokeObjectURL(preview.url)
      }
    } catch {}
    setPreview(null)
  }, [preview])

  // Stop and get blob directly (for "send while recording" scenario)
  const stopAndGetBlob = useCallback(async (): Promise<RecordingPreview | null> => {
    const cleanupState = () => {
      setTimeout(() => {
        setRecording(false)
        recorderRef.current = null
        chunksRef.current = []
        clearTimers()
        setLevel(0)
        try {
          if (visRafRef.current) cancelAnimationFrame(visRafRef.current)
          if (analyserRef.current) analyserRef.current.disconnect()
          if (sourceRef.current) sourceRef.current.disconnect()
          if (audioCtxRef.current) audioCtxRef.current.close()
        } catch {}
        analyserRef.current = null
        sourceRef.current = null
        audioCtxRef.current = null
      }, 100)
    }
    
    return new Promise<RecordingPreview | null>((resolve) => {
      const mr = recorderRef.current
      if (!mr || mr.state === 'inactive') {
        cleanupState()
        resolve(null)
        return
      }
      
      let resolved = false
      const doResolve = (result: RecordingPreview | null) => {
        if (resolved) return
        resolved = true
        cleanupState()
        resolve(result)
      }
      
      // Set up a one-time handler to get the data
      const onStopHandler = () => {
        // Wait for finalization
        const checkPreview = () => {
          // Check if chunks are available
          if (chunksRef.current.length > 0) {
            const preferType = isMobile ? 'audio/mp4' : 'audio/webm'
            const blob = new Blob(chunksRef.current, { type: preferType })
            if (blob.size > 0) {
              const actualDuration = Math.round((Date.now() - startedAtRef.current) / 1000)
              const url = URL.createObjectURL(blob)
              doResolve({ blob, url, duration: actualDuration })
              return
            }
          }
          // Retry
          setTimeout(checkPreview, 100)
        }
        setTimeout(checkPreview, 200)
      }
      
      stoppedRef.current = true
      
      if (isMobile) {
        try { mr.requestData() } catch {}
        setTimeout(() => {
          try { 
            mr.stop()
            onStopHandler()
            setTimeout(() => stopStream(), 500)
          } catch {}
        }, 120)
      } else {
        mr.stop()
        onStopHandler()
        setTimeout(() => stopStream(), 500)
      }
      
      // Safety timeout - resolve with whatever we have
      setTimeout(() => {
        if (resolved) return
        if (chunksRef.current.length > 0) {
          const preferType = isMobile ? 'audio/mp4' : 'audio/webm'
          const blob = new Blob(chunksRef.current, { type: preferType })
          if (blob.size > 0) {
            const actualDuration = Math.round((Date.now() - startedAtRef.current) / 1000)
            const url = URL.createObjectURL(blob)
            doResolve({ blob, url, duration: actualDuration })
            return
          }
        }
        doResolve(null)
      }, 2000)
    })
  }, [isMobile])

  const ensurePreview = useCallback(async (timeoutMs: number = 5000): Promise<RecordingPreview | null> => {
    try {
      if (recording) {
        try { stop() } catch {}
      }
      const startAt = Date.now()
      return await new Promise<RecordingPreview | null>((resolve) => {
        const check = () => {
          if (preview) return resolve(preview)
          if (Date.now() - startAt >= timeoutMs) return resolve(null)
          setTimeout(check, 120)
        }
        check()
      })
    } catch {
      return null
    }
  }, [recording, stop, preview])

  useEffect(() => () => { // cleanup on unmount
    try { clearTimers(); stopStream() } catch {}
    try {
      if (visRafRef.current) cancelAnimationFrame(visRafRef.current)
      if (analyserRef.current) analyserRef.current.disconnect()
      if (sourceRef.current) sourceRef.current.disconnect()
      if (audioCtxRef.current) audioCtxRef.current.close()
    } catch {}
  }, [])

  return { recording, recordMs, preview, start, stop, clearPreview, ensurePreview, level, stopAndGetBlob }
}
