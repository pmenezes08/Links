import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../types/chat'
import { formatDuration } from './utils'

interface AudioMessageProps {
  message: ChatMessage
  audioPath: string
}

export default function AudioMessage({ message, audioPath }: AudioMessageProps) {
  // Detect Safari browser
  const isSafari = typeof navigator !== 'undefined' &&
    /^((?!chrome|android).)*safari/i.test(navigator.userAgent)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const audioRef = useRef<HTMLAudioElement>(null)

  // Add cache-busting to prevent Safari caching issues
  const cacheBustedPath = useMemo(() => {
    if (!audioPath) return ''
    // Add timestamp only on first load and retries to bust cache
    const separator = audioPath.includes('?') ? '&' : '?'
    return `${audioPath}${separator}_cb=${Date.now()}_${retryCount}`
  }, [audioPath, retryCount])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    // CRITICAL iOS FIX: Force load on iOS to prevent stuck state
    try {
      audio.load()
    } catch (e) {
      console.error('Audio load error:', e)
    }

    const handleError = () => {
      setError('Could not load audio')
    }

    const handleCanPlay = () => {
      setError(null)
    }

    const handleLoadedMetadata = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(audio.duration)
      }
    }

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
    }

    audio.addEventListener('error', handleError)
    audio.addEventListener('canplay', handleCanPlay)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('timeupdate', handleTimeUpdate)

    return () => {
      audio.removeEventListener('error', handleError)
      audio.removeEventListener('canplay', handleCanPlay)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('timeupdate', handleTimeUpdate)
    }
  }, [cacheBustedPath, message.id])

  const togglePlay = async () => {
    if (!audioRef.current) return

    try {
      if (playing) {
        audioRef.current.pause()
        setPlaying(false)
      } else {
        // Force reload if there was an error
        if (error) {
          audioRef.current.load()
          setError(null)
        }

        // Clear any previous error state for fresh attempt
        if (error === 'Tap play to enable audio') {
          setError(null)
        }

        await audioRef.current.play()

        // Check if we're actually playing after a short delay
        setTimeout(() => {
          if (audioRef.current && !audioRef.current.paused && audioRef.current.currentTime > 0) {
            setPlaying(true)
          } else {
            // Playback was blocked
            setPlaying(false)
            setError('Tap play to enable audio')
          }
        }, isSafari ? 500 : 200) // Longer delay for Safari

        // Optimistically set playing state
        setPlaying(true)
      }
    } catch (err) {
      // If autoplay failed, show appropriate message
      if (err instanceof Error && err.name === 'NotAllowedError') {
        if (isSafari) {
          setError('Safari blocks audio - try a different browser')
        } else {
          setError('Tap play to enable audio')
        }
      }
      setPlaying(false)
    }
  }
  
  const handleRetry = () => {
    setError(null)
    setRetryCount(prev => prev + 1)
  }

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="px-2 py-1">
      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            error === 'Tap play to enable audio'
              ? isSafari
                ? 'bg-orange-500 hover:bg-orange-600 animate-pulse'
                : 'bg-red-500 hover:bg-red-600 animate-pulse'
              : 'bg-[#4db6ac] hover:bg-[#45a99c]'
          }`}
          disabled={false}
          title={isSafari ? 'Safari blocks audio autoplay - tap to play' : 'Play audio'}
        >
          <i className={`fa-solid ${playing ? 'fa-pause' : 'fa-play'} text-white text-xs`} />
        </button>
        <div className="flex-1">
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-white/50 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-white/60">
            <span>{playing && duration > 0 ? formatDuration(currentTime) : duration > 0 ? formatDuration(duration) : (message.audio_duration_seconds ? formatDuration(message.audio_duration_seconds) : '--:--')}</span>
            {error ? (
              <button 
                onClick={handleRetry}
                className="text-red-400 hover:text-red-300 underline"
              >
                Tap to retry
              </button>
            ) : null}
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
