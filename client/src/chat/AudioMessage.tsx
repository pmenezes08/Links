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
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)
  const seekTargetRef = useRef<number | null>(null)

  // Create and setup audio element
  useEffect(() => {
    if (!audioPath) return

    const audio = new Audio()
    audio.preload = 'auto'
    audio.setAttribute('playsinline', 'true')
    audio.setAttribute('webkit-playsinline', 'true')
    audioRef.current = audio

    const onLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const onDurationChange = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
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
      setPlaying(true)
      // If we have a pending seek, do it now
      if (seekTargetRef.current !== null) {
        const target = seekTargetRef.current
        seekTargetRef.current = null
        // Small delay to ensure audio is actually playing
        setTimeout(() => {
          audio.currentTime = target
        }, 50)
      }
    }
    
    const onPause = () => setPlaying(false)

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    audio.src = audioPath
    audio.load()

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [audioPath])

  // Update playback rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackSpeed
    }
  }, [playbackSpeed])

  // Play/pause toggle
  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return

    try {
      if (playing) {
        audio.pause()
      } else {
        await audio.play()
      }
    } catch (e) {
      console.log('Play error:', e)
    }
  }

  // Seek and play from position
  const seekAndPlay = async (percent: number) => {
    const audio = audioRef.current
    if (!audio) return

    const targetDuration = duration > 0 ? duration : (message.audio_duration_seconds || 0)
    if (targetDuration <= 0) return

    const targetTime = percent * targetDuration
    setCurrentTime(targetTime) // Update UI immediately

    try {
      if (playing) {
        // Already playing - just seek directly
        audio.currentTime = targetTime
      } else {
        // Not playing - on iOS we need to play first, then seek
        // Store the target and seek in the onPlay handler
        seekTargetRef.current = targetTime
        await audio.play()
      }
    } catch (e) {
      console.log('Seek error:', e)
      // Try direct seek as fallback
      try {
        audio.currentTime = targetTime
      } catch {}
    }
  }

  // Handle tap on progress bar
  const handleSeek = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    
    const bar = progressBarRef.current
    if (!bar) return

    const rect = bar.getBoundingClientRect()
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const percent = x / rect.width

    seekAndPlay(percent)
  }

  const cycleSpeed = () => {
    const idx = PLAYBACK_SPEEDS.indexOf(playbackSpeed)
    setPlaybackSpeed(PLAYBACK_SPEEDS[(idx + 1) % PLAYBACK_SPEEDS.length])
  }

  const displayDuration = duration > 0 ? duration : (message.audio_duration_seconds || 0)
  const progress = displayDuration > 0 ? (currentTime / displayDuration) * 100 : 0

  return (
    <div className="px-2 py-2 min-w-[240px] sm:min-w-[280px]" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            togglePlay()
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-[#4db6ac] hover:bg-[#45a99c] flex-shrink-0 active:scale-95"
          style={{ touchAction: 'manipulation' }}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-sm pointer-events-none ${!playing ? 'ml-0.5' : ''}`} />
        </button>
        
        {/* Progress and Controls */}
        <div className="flex-1 min-w-0">
          {/* Progress Bar */}
          <div
            ref={progressBarRef}
            className="h-8 flex items-center cursor-pointer"
            onPointerDown={handleSeek}
            style={{ touchAction: 'none' }}
          >
            <div className="w-full h-2 bg-white/15 rounded-full overflow-visible relative">
              <div 
                className="h-full bg-[#4db6ac] rounded-full" 
                style={{ width: `${Math.min(100, progress)}%` }} 
              />
              {/* Seek handle */}
              <div 
                className="absolute top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full shadow-lg"
                style={{ left: `calc(${Math.min(100, progress)}% - 8px)` }}
              />
            </div>
          </div>
          
          {/* Time and Speed */}
          <div className="flex items-center justify-between -mt-1">
            <span className="text-[11px] text-white/60 tabular-nums">
              {formatDuration(currentTime)} / {formatDuration(displayDuration)}
            </span>
            
            <button
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                cycleSpeed()
              }}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70"
              style={{ touchAction: 'manipulation' }}
            >
              {playbackSpeed}x
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
