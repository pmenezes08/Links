import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../types/chat'
import { formatDuration } from './utils'

interface AudioMessageProps {
  message: ChatMessage
  audioPath: string
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default function AudioMessage({ message, audioPath }: AudioMessageProps) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playbackSpeed, setPlaybackSpeed] = useState(1)
  const [, setIsLoaded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const wasPlayingRef = useRef(false)

  // Create audio element once and reuse
  useEffect(() => {
    if (!audioPath) {
      console.log('No audioPath provided')
      return
    }

    console.log('Setting up audio element for:', audioPath)

    const audio = new Audio()
    audio.preload = 'metadata'  // Changed from 'auto' - more reliable on mobile
    audio.setAttribute('playsinline', 'true')
    audio.setAttribute('webkit-playsinline', 'true')
    // iOS needs these attributes
    ;(audio as any).playsInline = true
    ;(audio as any).webkitPlaysInline = true
    audioRef.current = audio

    const onLoadedMetadata = () => {
      console.log('Audio metadata loaded, duration:', audio.duration)
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
        setIsLoaded(true)
      }
    }

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    const onEnded = () => {
      setPlaying(false)
      setCurrentTime(0)
    }

    const onPlay = () => {
      console.log('Audio playing')
      setPlaying(true)
    }
    
    const onPause = () => {
      console.log('Audio paused')
      setPlaying(false)
    }

    const onCanPlayThrough = () => {
      console.log('Audio can play through')
      setIsLoaded(true)
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const onError = (e: Event) => {
      const audioEl = e.target as HTMLAudioElement
      console.error('Audio error:', audioEl?.error?.message || 'Unknown error', 'code:', audioEl?.error?.code)
      setPlaying(false)
    }

    const onStalled = () => {
      console.log('Audio stalled - network issue?')
    }

    const onWaiting = () => {
      console.log('Audio waiting for data')
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('canplaythrough', onCanPlayThrough)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onError)
    audio.addEventListener('stalled', onStalled)
    audio.addEventListener('waiting', onWaiting)

    // Set source and load
    audio.src = audioPath
    console.log('Audio src set to:', audio.src)
    audio.load()

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('canplaythrough', onCanPlayThrough)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('error', onError)
      audio.removeEventListener('stalled', onStalled)
      audio.removeEventListener('waiting', onWaiting)
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [audioPath])

  // Update playback rate when speed changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

  // Calculate display duration (from audio or from message metadata)
  const displayDuration = duration > 0 ? duration : (message.audio_duration_seconds || 0)
  const progress = displayDuration > 0 ? (currentTime / displayDuration) * 100 : 0

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio) {
      console.log('No audio element')
      return
    }

    try {
      if (playing) {
        audio.pause()
      } else {
        // iOS fix: ensure audio is loaded before playing
        if (audio.readyState < 2) {
          console.log('Audio not ready, loading...', audio.readyState)
          audio.load()
          // Wait a bit for load to start
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        
        console.log('Attempting to play audio:', audioPath, 'readyState:', audio.readyState)
        const playPromise = audio.play()
        if (playPromise !== undefined) {
          await playPromise
        }
      }
    } catch (e: any) {
      console.error('Play error:', e?.message || e, 'src:', audio.src)
      setPlaying(false)
      
      // Try to reload and play on error
      if (e?.name === 'NotAllowedError') {
        console.log('Playback not allowed - user interaction required')
      } else if (e?.name === 'NotSupportedError') {
        console.log('Audio format not supported')
      }
    }
  }

  // Simple seek - works on iOS by seeking while playing
  const seekTo = async (percent: number, andPlay: boolean = false) => {
    const audio = audioRef.current
    if (!audio) return

    const targetDuration = duration > 0 ? duration : displayDuration
    if (!targetDuration || targetDuration <= 0) return

    const newTime = percent * targetDuration

    try {
      // iOS requires: play first, then seek
      const wasPlaying = playing
      
      if (!wasPlaying) {
        // Start playing (this "unlocks" seeking on iOS)
        await audio.play()
      }
      
      // Now seek
      audio.currentTime = newTime
      setCurrentTime(newTime)
      
      // If user didn't want to play, pause after seeking
      if (!andPlay && !wasPlaying) {
        // Small delay to let iOS process the seek
        setTimeout(() => {
          audio.pause()
        }, 100)
      }
    } catch (e) {
      console.log('Seek error:', e)
      // Fallback: try direct seek
      try {
        audio.currentTime = newTime
        setCurrentTime(newTime)
      } catch {}
    }
  }

  // Calculate percent from pointer position
  const getPercentFromPointer = (clientX: number): number => {
    const bar = progressBarRef.current
    if (!bar) return 0
    const rect = bar.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    return x / rect.width
  }

  // Handle drag start
  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    
    const bar = progressBarRef.current
    if (!bar) return
    
    // Capture pointer for drag
    bar.setPointerCapture(e.pointerId)
    setIsDragging(true)
    wasPlayingRef.current = playing
    
    // Seek to initial position
    const percent = getPercentFromPointer(e.clientX)
    seekTo(percent, false)
  }

  // Handle drag move
  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return
    e.stopPropagation()
    e.preventDefault()
    
    const percent = getPercentFromPointer(e.clientX)
    const targetDuration = duration > 0 ? duration : displayDuration
    if (targetDuration > 0) {
      setCurrentTime(percent * targetDuration)
    }
  }

  // Handle drag end
  const handlePointerUp = async (e: React.PointerEvent) => {
    if (!isDragging) return
    e.stopPropagation()
    e.preventDefault()
    
    const bar = progressBarRef.current
    if (bar) {
      bar.releasePointerCapture(e.pointerId)
    }
    
    setIsDragging(false)
    
    // Seek to final position and play
    const percent = getPercentFromPointer(e.clientX)
    await seekTo(percent, true)
  }

  const cycleSpeed = () => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed)
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex])
  }

  return (
    <div 
      className="px-2 py-2 min-w-[240px] sm:min-w-[280px]" 
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            togglePlay()
          }}
          onTouchEnd={(e) => {
            // Prevent ghost click on mobile
            e.stopPropagation()
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-colors bg-[#4db6ac] hover:bg-[#45a99c] flex-shrink-0 active:scale-95"
          style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-sm pointer-events-none ${!playing ? 'ml-0.5' : ''}`} />
        </button>
        
        {/* Progress and Controls */}
        <div className="flex-1 min-w-0">
          {/* Seekable Progress Bar - supports tap and drag */}
          <div
            ref={progressBarRef}
            className="h-8 flex items-center cursor-pointer"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onMouseDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            style={{ touchAction: 'none' }}
          >
            <div className="w-full h-2 bg-white/15 rounded-full overflow-hidden relative">
              <div 
                className="h-full bg-[#4db6ac]" 
                style={{ width: `${progress}%` }} 
              />
              {/* Seek handle - always visible on mobile */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md"
                style={{ left: `calc(${progress}% - 8px)` }}
              />
            </div>
          </div>
          
          {/* Time and Speed */}
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-white/60 tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(displayDuration)}
            </div>
            
            {/* Speed Control */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                cycleSpeed()
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
            >
              {playbackSpeed}x
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
