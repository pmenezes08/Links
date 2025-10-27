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
  }

  const resetState = () => {
    setRecording(false)
    setRecordMs(0)
    recorderRef.current = null
    chunksRef.current = []
    stoppedRef.current = false
    finalizeAttemptRef.current = 0
    clearTimers()
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
        alert('Microphone not supported on this device')
        return
      }
      if (!('MediaRecorder' in window)) {
        alert('Recording is not supported in this browser')
        return
      }
      const constraints: MediaStreamConstraints = isMobile ? { audio: true } : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 44100 } }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream
      let mimeType = ''
      const types = isMobile ? ['audio/mp4', 'audio/webm', 'audio/ogg', 'audio/wav'] : ['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4','audio/wav']
      for (const t of types) { try { if ((window as any).MediaRecorder.isTypeSupported(t)) { mimeType = t; break } } catch {}
      }
      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = mr
      chunksRef.current = []
      stoppedRef.current = false
      finalizeAttemptRef.current = 0
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
          setTimeout(() => { try { mr.stop() } catch {} }, 120)
        } else {
          mr.stop()
        }
      }
    } catch {}
    // UI safety reset
    setTimeout(() => { setRecording(false); recorderRef.current = null }, 800)
  }, [isMobile])

  const clearPreview = useCallback(() => {
    try { if (preview?.url) URL.revokeObjectURL(preview.url) } catch {}
    setPreview(null)
  }, [preview])

  useEffect(() => () => { // cleanup on unmount
    try { clearTimers(); stopStream() } catch {}
  }, [])

  return { recording, recordMs, preview, start, stop, clearPreview }
}
