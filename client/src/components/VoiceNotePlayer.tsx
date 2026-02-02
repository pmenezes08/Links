import { useRef, useState, useEffect, useMemo } from 'react'
import { Capacitor } from '@capacitor/core'

interface VoiceNotePlayerProps {
  audioPath: string
  durationSeconds?: number
}

// Detect if we're on iOS (Capacitor native app or Safari)
function isIOSPlatform(): boolean {
  try {
    if (Capacitor.getPlatform() === 'ios') {
      return true
    }
  } catch {
    // Capacitor not available
  }
  
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream) {
    return true
  }
  if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
    return true
  }
  return false
}

// Check if a URL points to a WebM file
function isWebmFile(url: string): boolean {
  if (!url) return false
  const lowerUrl = url.toLowerCase()
  return lowerUrl.includes('.webm') || lowerUrl.includes('audio/webm')
}

// Format duration as M:SS
function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default function VoiceNotePlayer({ audioPath, durationSeconds }: VoiceNotePlayerProps) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const wasPlayingRef = useRef(false)

  // Determine if we need to use transcoding
  const isIOS = useMemo(() => isIOSPlatform(), [])
  const needsTranscoding = isIOS && isWebmFile(audioPath) && !audioPath.startsWith('blob:')
  
  // Build the audio URL - use transcoding endpoint only for iOS + WebM
  const audioUrl = useMemo(() => {
    if (!audioPath) return ''
    
    if (needsTranscoding) {
      let filename = audioPath
      
      if (audioPath.startsWith('http://') || audioPath.startsWith('https://')) {
        try {
          const url = new URL(audioPath)
          filename = url.pathname
          if (filename.startsWith('/')) filename = filename.substring(1)
          if (filename.startsWith('uploads/')) filename = filename.substring(8)
        } catch {
          const idx = audioPath.lastIndexOf('/')
          if (idx >= 0) filename = audioPath.substring(idx + 1)
        }
      } else if (audioPath.startsWith('/uploads/')) {
        filename = audioPath.substring(9)
      } else if (audioPath.startsWith('uploads/')) {
        filename = audioPath.substring(8)
      }
      
      return `/audio_compat/${filename}?transcode=1`
    }
    
    return audioPath
  }, [audioPath, needsTranscoding])

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const onTimeUpdate = () => {
      if (!isDragging) {
        setCurrentTime(audio.currentTime)
      }
    }

    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
      audio.currentTime = 0
    }

    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    const onCanPlay = () => {
      setError(null)
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const onError = () => {
      const errorCode = audio.error?.code
      console.error('[VoiceNotePlayer] Error playing:', audioPath, 'code:', errorCode)
      setPlaying(false)
      
      if (errorCode === 4) {
        setError('Format not supported')
      } else if (errorCode === 2) {
        setError('Network error')
      } else if (errorCode === 3) {
        setError('Decoding error')
      } else {
        setError('Cannot play audio')
      }
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onError)

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('error', onError)
    }
  }, [audioUrl, isDragging])

  // Update playback rate when speed changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

  // Calculate display duration
  const displayDuration = duration > 0 ? duration : (durationSeconds || 0)
  const progress = displayDuration > 0 ? (currentTime / displayDuration) * 100 : 0

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (playing) {
      audio.pause()
    } else {
      setError(null)
      const playPromise = audio.play()
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.error('[VoiceNotePlayer] Play failed:', err)
          setPlaying(false)
          if (err.name === 'NotAllowedError') {
            setError('Tap to play')
          } else if (err.name === 'NotSupportedError') {
            setError('Format not supported')
          }
        })
      }
    }
  }

  // Seek to position
  const seekTo = (percent: number) => {
    const audio = audioRef.current
    if (!audio) return

    const targetDuration = duration > 0 ? duration : displayDuration
    if (!targetDuration || targetDuration <= 0) return

    const newTime = Math.max(0, Math.min(percent * targetDuration, targetDuration))
    audio.currentTime = newTime
    setCurrentTime(newTime)
  }

  // Calculate percent from pointer position
  const getPercentFromPointer = (clientX: number): number => {
    const bar = progressBarRef.current
    if (!bar) return 0
    const rect = bar.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    return x / rect.width
  }

  // Handle drag/tap on progress bar
  const handleProgressInteraction = (clientX: number, isEnd: boolean = false) => {
    const percent = getPercentFromPointer(clientX)
    
    if (isEnd) {
      seekTo(percent)
      setIsDragging(false)
      if (wasPlayingRef.current) {
        audioRef.current?.play()
      }
    } else {
      const targetDuration = duration > 0 ? duration : displayDuration
      if (targetDuration > 0) {
        setCurrentTime(percent * targetDuration)
      }
    }
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    
    const bar = progressBarRef.current
    if (!bar) return
    
    bar.setPointerCapture(e.pointerId)
    setIsDragging(true)
    wasPlayingRef.current = playing
    
    if (playing) {
      audioRef.current?.pause()
    }
    
    handleProgressInteraction(e.clientX)
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    e.stopPropagation()
    handleProgressInteraction(e.clientX)
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return
    e.stopPropagation()
    
    const bar = progressBarRef.current
    if (bar) {
      try { bar.releasePointerCapture(e.pointerId) } catch {}
    }
    
    handleProgressInteraction(e.clientX, true)
  }

  const cycleSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed)
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex])
  }

  return (
    <div 
      className="px-2 py-2 min-w-[220px] sm:min-w-[260px]" 
      onClick={(e) => e.stopPropagation()}
    >
      {/* Audio element */}
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        style={{ display: 'none' }}
      />
      
      {/* Error display */}
      {error && (
        <div className="text-[11px] text-red-400 mb-1 flex items-center gap-1">
          <i className="fa-solid fa-triangle-exclamation text-[10px]" />
          {error}
        </div>
      )}
      
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-colors bg-[#4db6ac] hover:bg-[#45a99c] flex-shrink-0 active:scale-95"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-xs pointer-events-none ${!playing ? 'ml-0.5' : ''}`} />
        </button>
        
        {/* Progress and Controls */}
        <div className="flex-1 min-w-0">
          {/* Seekable Progress Bar */}
          <div
            ref={progressBarRef}
            className="h-7 flex items-center cursor-pointer select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: 'none' }}
          >
            <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden relative">
              <div 
                className="h-full bg-[#4db6ac] transition-none" 
                style={{ width: `${progress}%` }} 
              />
              {/* Seek handle */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md transition-none"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
          </div>
          
          {/* Time and Speed */}
          <div className="flex items-center justify-between -mt-0.5">
            <div className="text-[10px] text-white/60 tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(displayDuration)}
            </div>
            
            {/* Speed Control */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                cycleSpeed()
              }}
              className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              {playbackSpeed}x
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
