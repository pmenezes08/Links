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
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const progressBarRef = useRef<HTMLDivElement>(null)

  // Create audio element once and reuse
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

    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    const onCanPlayThrough = () => {
      setIsLoaded(true)
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('canplaythrough', onCanPlayThrough)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)

    // Set source and load
    audio.src = audioPath
    audio.load()

    return () => {
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('canplaythrough', onCanPlayThrough)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
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
      setPlaying(false)
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

  const handleProgressClick = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation()
    const bar = progressBarRef.current
    if (!bar) return

    const rect = bar.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? 0 : e.clientX
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    const percent = x / rect.width

    // On click/tap, seek and play
    seekTo(percent, true)
  }

  const cycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation()
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed)
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex])
  }

  const displayDuration = duration > 0 ? duration : (message.audio_duration_seconds || 0)
  const progress = displayDuration > 0 ? (currentTime / displayDuration) * 100 : 0

  return (
    <div className="px-2 py-2 min-w-[240px] sm:min-w-[280px]" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-3">
        {/* Play/Pause Button */}
        <button
          onTouchStart={(e) => {
            e.stopPropagation()
            e.preventDefault()
            togglePlay()
          }}
          onClick={(e) => {
            e.stopPropagation()
            togglePlay()
          }}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-colors bg-[#4db6ac] hover:bg-[#45a99c] flex-shrink-0 active:scale-95"
          style={{ touchAction: 'manipulation' }}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-sm pointer-events-none ${!playing ? 'ml-0.5' : ''}`} />
        </button>
        
        {/* Progress and Controls */}
        <div className="flex-1 min-w-0">
          {/* Seekable Progress Bar */}
          <div
            ref={progressBarRef}
            className="h-8 flex items-center cursor-pointer"
            onTouchStart={handleProgressClick}
            onClick={handleProgressClick}
            style={{ touchAction: 'manipulation' }}
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
              onTouchStart={(e) => {
                e.stopPropagation()
                e.preventDefault()
                cycleSpeed(e as any)
              }}
              onClick={cycleSpeed}
              className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
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
