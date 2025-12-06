import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../types/chat'
import { formatDuration } from './utils'

interface AudioMessageProps {
  message: ChatMessage
  audioPath: string
}

export default function AudioMessage({ message, audioPath }: AudioMessageProps) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

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
      setCurrentTime(audio.currentTime)
    }

    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)

    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [cacheBustedPath])

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

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="px-2 py-1">
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="w-8 h-8 rounded-full flex items-center justify-center transition-colors bg-[#4db6ac] hover:bg-[#45a99c]"
          title="Play audio"
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-xs`} />
        </button>
        <div className="flex-1">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-white/50 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 text-[11px] text-white/60">
            <span>{playing && duration > 0 ? formatDuration(currentTime) : duration > 0 ? formatDuration(duration) : (message.audio_duration_seconds ? formatDuration(message.audio_duration_seconds) : '--:--')}</span>
          </div>
        </div>
      </div>
      <audio
        ref={audioRef}
        src={cacheBustedPath}
        preload="metadata"
        playsInline
        webkit-playsinline="true"
        onEnded={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        className="hidden"
      />
    </div>
  )
}
