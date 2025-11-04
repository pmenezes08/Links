import { useEffect, useState } from 'react'

type TalkingAvatarLoadingModalProps = {
  jobId: number
  postId: number
  onComplete: () => void
  onError: (error: string) => void
}

export function TalkingAvatarLoadingModal({ 
  jobId, 
  postId,
  onComplete, 
  onError 
}: TalkingAvatarLoadingModalProps) {
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('Initializing...')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    let pollInterval: NodeJS.Timeout

    const pollProgress = async () => {
      if (cancelled) return

      try {
        const r = await fetch(`/api/talking_avatar_status/${jobId}`, { credentials: 'include' })
        const j = await r.json()

        if (!r.ok || !j.success) {
          throw new Error(j.error || 'Failed to check status')
        }

        if (cancelled) return

        setProgress(j.progress || 0)

        // Update status message based on progress
        if (j.progress < 30) {
          setStatus('Preparing video generation...')
        } else if (j.progress < 50) {
          setStatus('Loading AI models...')
        } else if (j.progress < 90) {
          setStatus('Generating talking avatar...')
        } else if (j.progress < 100) {
          setStatus('Finalizing video...')
        }

        if (j.completed) {
          clearInterval(pollInterval)
          setProgress(100)
          setStatus('Complete! Redirecting...')
          setTimeout(() => onComplete(), 500)
        } else if (j.failed) {
          clearInterval(pollInterval)
          setFailed(true)
          onError('Video generation failed. Please try again.')
        }
      } catch (err: any) {
        if (!cancelled) {
          clearInterval(pollInterval)
          setFailed(true)
          onError(err.message || 'Failed to generate video')
        }
      }
    }

    // Poll every 2 seconds
    pollProgress() // Initial check
    pollInterval = setInterval(pollProgress, 2000)

    return () => {
      cancelled = true
      clearInterval(pollInterval)
    }
  }, [jobId, onComplete, onError])

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/80 backdrop-blur-sm px-4">
      <div className="w-full max-w-[400px] rounded-2xl border border-white/10 bg-[#091013] p-8 shadow-2xl">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="relative w-20 h-20 rounded-full bg-gradient-to-br from-[#4db6ac]/20 to-[#26a69a]/20 flex items-center justify-center">
            {!failed ? (
              <i className="fa-solid fa-wand-magic-sparkles text-4xl text-[#4db6ac] animate-pulse" />
            ) : (
              <i className="fa-solid fa-exclamation-triangle text-4xl text-red-400" />
            )}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-semibold text-white text-center mb-2">
          {failed ? 'Generation Failed' : 'Creating Your Talking Avatar'}
        </h2>

        {/* Status */}
        <p className="text-sm text-white/60 text-center mb-6">
          {failed ? 'Something went wrong' : status}
        </p>

        {/* Progress Bar */}
        {!failed && (
          <div className="mb-4">
            <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#4db6ac] to-[#26a69a] transition-all duration-500 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-2">
              <span className="text-xs text-white/50">Progress</span>
              <span className="text-sm font-medium text-[#4db6ac]">{progress}%</span>
            </div>
          </div>
        )}

        {/* Info */}
        {!failed && (
          <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex gap-2 text-xs text-blue-300">
              <i className="fa-solid fa-info-circle shrink-0 mt-0.5" />
              <p>
                This usually takes 1-3 minutes. Please don't close this window.
              </p>
            </div>
          </div>
        )}

        {/* Delete button for failed jobs */}
        {failed && (
          <button
            onClick={async () => {
              // Delete the failed post
              try {
                const fd = new FormData()
                fd.append('post_id', String(postId))
                await fetch('/delete_post', { method: 'POST', credentials: 'include', body: fd })
              } catch (e) {
                console.error('Failed to delete post:', e)
              }
              onError('Generation cancelled')
            }}
            className="w-full mt-4 px-4 py-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 hover:bg-red-500/30 transition"
          >
            Close
          </button>
        )}
      </div>
    </div>
  )
}
