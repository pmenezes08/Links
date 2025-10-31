import { useCallback, useEffect, useRef, useState } from 'react'

export type ImagineStyle = 'normal' | 'fun' | 'spicy'

export type ImagineJobState = {
  id: number
  targetType: 'post' | 'reply'
  targetId: number
  style: ImagineStyle
  status: 'pending' | 'processing' | 'awaiting_owner' | 'completed' | 'error'
  isOwner: boolean
  nsfwAllowed: boolean
  resultPath?: string
  resultUrl?: string
  error?: string
  action?: string
  autoReplyId?: number | null
}

type StartParams = {
  targetType: 'post' | 'reply'
  targetId: number
  style: ImagineStyle
}

type ResolveAction = 'replace' | 'add_alongside'

const POLL_INTERVAL_MS = 4000

export function useImagineJobs() {
  const [jobs, setJobs] = useState<Record<number, ImagineJobState>>({})
  const timersRef = useRef<Record<number, number>>({})

  const clearTimer = useCallback((jobId: number) => {
    const timer = timersRef.current[jobId]
    if (timer) {
      window.clearTimeout(timer)
      delete timersRef.current[jobId]
    }
  }, [])

  const updateJobState = useCallback((jobId: number, partial: Partial<ImagineJobState>) => {
    setJobs(prev => {
      const existing = prev[jobId]
      if (!existing) return prev
      return {
        ...prev,
        [jobId]: { ...existing, ...partial }
      }
    })
  }, [])

  const pollJob = useCallback((jobId: number) => {
    clearTimer(jobId)
    fetch(`/api/imagine/status?job_id=${jobId}`, { credentials: 'include' })
      .then(async (resp) => {
        const json = await resp.json().catch(() => null)
        if (!resp.ok || !json?.success) {
          const message = json?.error || 'Failed to fetch imagine status'
          updateJobState(jobId, { status: 'error', error: message })
          return
        }
        const status: ImagineJobState['status'] = json.status
        updateJobState(jobId, {
          status,
          resultPath: json.result_path || json.resultPath,
          resultUrl: json.result_url || json.resultUrl,
          error: json.error,
          action: json.action,
          autoReplyId: json.auto_reply_id ?? null
        })
        if (status === 'completed' || status === 'error') {
          return
        }
        if (status === 'awaiting_owner') {
          return
        }
        timersRef.current[jobId] = window.setTimeout(() => pollJob(jobId), POLL_INTERVAL_MS)
      })
      .catch((err) => {
        updateJobState(jobId, { status: 'error', error: err?.message || 'Failed to poll imagine job' })
      })
  }, [clearTimer, updateJobState])

  const startImagine = useCallback(async ({ targetType, targetId, style }: StartParams) => {
    const resp = await fetch('/api/imagine/start', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_type: targetType, target_id: targetId, style })
    })
    const json = await resp.json().catch(() => null)
    if (!resp.ok || !json?.success) {
      throw new Error(json?.error || 'Failed to start imagine job')
    }
    const jobId: number = json.job_id
    const jobState: ImagineJobState = {
      id: jobId,
      targetType,
      targetId,
      style,
      status: 'pending',
      isOwner: !!json.is_owner,
      nsfwAllowed: !!json.nsfw_allowed
    }
    setJobs(prev => ({ ...prev, [jobId]: jobState }))
    timersRef.current[jobId] = window.setTimeout(() => pollJob(jobId), 1500)
    return jobId
  }, [pollJob])

  const resolveImagine = useCallback(async (jobId: number, action: ResolveAction) => {
    const resp = await fetch('/api/imagine/resolve', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, action })
    })
    const json = await resp.json().catch(() => null)
    if (!resp.ok || !json?.success) {
      throw new Error(json?.error || 'Failed to apply imagine result')
    }
    updateJobState(jobId, {
      status: 'completed',
      action,
      resultPath: json.result_path || json.resultPath,
      resultUrl: json.result_url || json.resultUrl,
      error: undefined
    })
  }, [updateJobState])

  const removeJob = useCallback((jobId: number) => {
    clearTimer(jobId)
    setJobs(prev => {
      const copy = { ...prev }
      delete copy[jobId]
      return copy
    })
  }, [clearTimer])

  useEffect(() => {
    return () => {
      Object.values(timersRef.current).forEach(timer => window.clearTimeout(timer))
      timersRef.current = {}
    }
  }, [])

  return {
    jobs,
    startImagine,
    resolveImagine,
    removeJob,
    updateJobState,
    pollJob
  }
}

