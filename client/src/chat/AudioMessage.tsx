import { useRef, useState, useEffect } from 'react'
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
  const [isLoaded, setIsLoaded] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const wasPlayingRef = useRef(false)

  // Handle audio events
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
        setIsLoaded(true)
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
      setIsLoaded(true)
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const onError = () => {
      console.error('Audio error for:', audioPath)
      setPlaying(false)
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
  }, [audioPath, isDragging])

  // Update playback rate when speed changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

  // Calculate display duration
  const displayDuration = duration > 0 ? duration : (message.audio_duration_seconds || 0)
  const progress = displayDuration > 0 ? (currentTime / displayDuration) * 100 : 0

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (playing) {
      audio.pause()
    } else {
      // iOS requires play() to be called directly from user interaction
      const playPromise = audio.play()
      if (playPromise !== undefined) {
        playPromise.catch((error) => {
          console.error('Play failed:', error)
          setPlaying(false)
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
      // Resume playback if was playing before drag
      if (wasPlayingRef.current) {
        audioRef.current?.play()
      }
    } else {
      // Visual update during drag
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
    
    // Pause during drag for smoother experience
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
      className="px-2 py-2 min-w-[240px] sm:min-w-[280px]" 
      onClick={(e) => e.stopPropagation()}
    >
      {/* Actual audio element in DOM - required for iOS */}
      <audio
        ref={audioRef}
        src={audioPath}
        preload="metadata"
        playsInline
        webkit-playsinline="true"
        x-webkit-airplay="allow"
        style={{ display: 'none' }}
      />
      
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-colors bg-[#4db6ac] hover:bg-[#45a99c] flex-shrink-0 active:scale-95"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-sm pointer-events-none ${!playing ? 'ml-0.5' : ''}`} />
        </button>
        
        {/* Progress and Controls */}
        <div className="flex-1 min-w-0">
          {/* Seekable Progress Bar */}
          <div
            ref={progressBarRef}
            className="h-8 flex items-center cursor-pointer select-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: 'none' }}
          >
            <div className="w-full h-2 bg-white/15 rounded-full overflow-hidden relative">
              <div 
                className="h-full bg-[#4db6ac] transition-none" 
                style={{ width: `${progress}%` }} 
              />
              {/* Seek handle */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-md transition-none"
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
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                cycleSpeed()
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
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
