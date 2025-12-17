import { useEffect, useMemo, useRef, useState } from 'react'
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
  const [isDragging, setIsDragging] = useState(false)
  const audioRef = useRef<HTMLAudioElement>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)

  // Add cache-busting to prevent caching issues
  const cacheBustedPath = useMemo(() => {
    if (!audioPath) return ''
    const separator = audioPath.includes('?') ? '&' : '?'
    return `${audioPath}${separator}_cb=${Date.now()}`
  }, [audioPath])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // Force load on iOS to prevent stuck state
    try {
      audio.load()
    } catch {
      // ignore load errors
    }

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const handleTimeUpdate = () => {
      if (!isDragging) {
        setCurrentTime(audio.currentTime)
      }
    }

    const handleDurationChange = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('durationchange', handleDurationChange)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('durationchange', handleDurationChange)
    }
  }, [cacheBustedPath, isDragging])

  // Update playback rate when speed changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

  const togglePlay = async () => {
    if (!audioRef.current) return

    try {
      if (playing) {
        audioRef.current.pause()
        setPlaying(false)
      } else {
        await audioRef.current.play()
        setPlaying(true)
      }
    } catch {
      // Silently handle play errors
      setPlaying(false)
    }
  }

  const seekToPosition = (clientX: number) => {
    const bar = progressBarRef.current
    const audio = audioRef.current
    if (!bar || !audio || !duration) return

    const rect = bar.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    const percent = x / rect.width
    const newTime = percent * duration
    
    audio.currentTime = newTime
    setCurrentTime(newTime)
  }

  const handleProgressClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    seekToPosition(e.clientX)
  }

  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation()
    setIsDragging(true)
    const touch = e.touches[0]
    if (touch) seekToPosition(touch.clientX)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const touch = e.touches[0]
    if (touch) seekToPosition(touch.clientX)
  }

  const handleTouchEnd = () => {
    setIsDragging(false)
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDragging(true)
    seekToPosition(e.clientX)
    
    const handleMouseMove = (ev: MouseEvent) => {
      seekToPosition(ev.clientX)
    }
    
    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
    
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation()
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed)
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex])
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const displayDuration = duration > 0 ? duration : (message.audio_duration_seconds || 0)

  return (
    <div className="px-2 py-2 min-w-[240px] sm:min-w-[280px]" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-colors bg-[#4db6ac] hover:bg-[#45a99c] flex-shrink-0"
          title={playing ? 'Pause' : 'Play'}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-sm ${!playing ? 'ml-0.5' : ''}`} />
        </button>
        
        {/* Progress and Controls */}
        <div className="flex-1 min-w-0">
          {/* Seekable Progress Bar */}
          <div
            ref={progressBarRef}
            className="h-6 flex items-center cursor-pointer group"
            onClick={handleProgressClick}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <div className="w-full h-1.5 bg-white/15 rounded-full overflow-hidden relative">
              <div 
                className="h-full bg-[#4db6ac] transition-all duration-75" 
                style={{ width: `${progress}%` }} 
              />
              {/* Seek handle */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `calc(${progress}% - 6px)` }}
              />
            </div>
          </div>
          
          {/* Time and Speed */}
          <div className="flex items-center justify-between mt-0.5">
            <div className="text-[11px] text-white/60 tabular-nums">
              {playing || currentTime > 0 ? (
                <span>{formatDuration(currentTime)} / {formatDuration(displayDuration)}</span>
              ) : (
                <span>{displayDuration > 0 ? formatDuration(displayDuration) : '--:--'}</span>
              )}
            </div>
            
            {/* Speed Control */}
            <button
              onClick={cycleSpeed}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
              title="Change playback speed"
            >
              {playbackSpeed}x
            </button>
          </div>
        </div>
      </div>
      
      <audio
        ref={audioRef}
        src={cacheBustedPath}
        preload="metadata"
        playsInline
        webkit-playsinline="true"
        onEnded={() => { setPlaying(false); setCurrentTime(0) }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  )
}
