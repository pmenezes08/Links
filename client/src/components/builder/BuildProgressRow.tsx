import { useEffect, useRef, useState } from 'react'
import SteveAvatar from '../steve/SteveAvatar'
import type { BuilderJob } from '../../hooks/useBuilder'

// Server checkpoint stage keys → user-facing copy (see builder.report_progress).
const STAGE_COPY: Record<string, string> = {
  starting: "Steve's on it",
  research: 'Researching real facts',
  coding: 'Writing the code',
  reviewing: 'Checking the details',
  testing: 'Testing in a real browser',
  polishing: 'Polishing the design',
  saving: 'Saving your build',
  done: 'Done',
}

const FALLBACK_STAGES = ["Steve's on it", 'Making it', 'Adding the fun bits', 'Almost there']

/**
 * Honest build progress: catches up quickly to the server's checkpoints and
 * creeps gently between them so the bar never looks frozen — but is capped
 * just above the last real checkpoint so it can't overpromise.
 */
export default function BuildProgressRow({
  job,
  onCancel,
}: {
  job?: BuilderJob | null
  onCancel?: () => void
}) {
  const [secs, setSecs] = useState(0)
  const [disp, setDisp] = useState(0)
  const server = Math.max(0, Math.min(100, job?.progress ?? 0))
  const serverRef = useRef(server)
  serverRef.current = server
  useEffect(() => {
    const id = window.setInterval(() => {
      setSecs((s) => s + 1)
      setDisp((d) => {
        const sv = serverRef.current
        if (d < sv) return Math.min(sv, d + Math.max(2, (sv - d) / 3))
        const cap = sv >= 100 ? 100 : Math.min(sv + 12, 95)
        return Math.min(cap, d + 0.3)
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [])
  const pct = Math.round(disp)
  const stageLabel = STAGE_COPY[job?.progress_stage || '']
  const label = stageLabel
    || (job?.status === 'queued' ? 'Getting a builder ready'
      : secs < 4 ? FALLBACK_STAGES[0] : secs < 12 ? FALLBACK_STAGES[1] : secs < 25 ? FALLBACK_STAGES[2] : FALLBACK_STAGES[3])
  return (
    <div className="my-3.5">
      <div className="flex items-center gap-2.5">
        <SteveAvatar size={22} className="flex-none" />
        <div
          className="h-4 w-4 flex-none rounded-full border-2 border-cpoint-turquoise/25 border-t-cpoint-turquoise"
          style={{ animation: 'cp-spin 0.8s linear infinite' }}
        />
        <span className="text-xs text-c-text-secondary">
          {label} · <span className="font-semibold tabular-nums text-cpoint-turquoise">{pct}%</span> · {secs}s
        </span>
      </div>
      <div className="mt-2 flex gap-2.5">
        <span className="w-[22px] flex-none" />
        <div
          className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          {/* width transition is data motion (server checkpoints), not decorative */}
          <div className="h-full rounded-full bg-cpoint-turquoise" style={{ width: `${pct}%`, transition: 'width 0.9s ease' }} />
        </div>
      </div>
      <div className="mt-2 flex gap-2.5">
        <span className="w-[22px] flex-none" />
        <div className="text-xs leading-relaxed text-c-text-tertiary">
          Steve is building on the server. You can leave this screen, lock your phone, or use other apps — you'll get a notification when it's ready to test.
          {job?.id ? <span className="mt-0.5 block">Build #{job.id} · {job.status}</span> : null}
          {job?.id && onCancel ? (
            <button
              onClick={onCancel}
              className="mt-2 block min-h-[44px] rounded-full border border-cpoint-turquoise/50 px-4 text-sm font-semibold text-cpoint-turquoise transition hover:bg-cpoint-turquoise/10"
            >
              Stop build
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
