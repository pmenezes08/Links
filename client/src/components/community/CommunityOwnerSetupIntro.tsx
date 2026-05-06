import { useCallback, useEffect, useId, useState } from 'react'

export const communityOwnerSetupStorageKey = (username: string, communityId: string) =>
  `cpoint_community_owner_setup:v1:${username}:${communityId}`

export type CommunityOwnerSetupIntroProps = {
  communityId: string
  communityName: string
  username: string
  memberCap: number | null
  tierLabel: string | null
  onFinished: (reason: 'completed' | 'dismissed') => void
  onOpenManageCommunity: () => void
}

const GLOW_PANEL_CLASS =
  'rounded-[28px] border border-[#4db6ac]/45 bg-black shadow-[0_0_48px_rgba(77,182,172,0.22),0_24px_80px_rgba(77,182,172,0.14)]'

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Set up your community',
    body:
      "I'm Steve. Let's walk through a few settings so your community feels right from day one. " +
      'You can skip anytime and finish later in Manage Community.',
  },
  {
    title: 'Description',
    body:
      'Add a short description so members know what this space is for. It appears under your community name on the feed.',
  },
  {
    title: 'Subscription',
    body:
      'Your community plan controls limits like storage and how many members you can have. You can upgrade or change tiers whenever you need.',
  },
  {
    title: 'Member limit',
    body: '', // filled per plan cap
  },
  {
    title: 'Community image',
    body:
      'A header or banner image helps members recognize the community. You can upload or change it anytime.',
  },
  {
    title: 'Steve personality',
    body:
      'Choose how I sound when members mention @Steve in comments—friendly, professional, or another style that fits your culture.',
  },
]

function ManageCommunityHint({
  onOpenManageCommunity,
  onStay,
}: {
  onOpenManageCommunity: () => void
  onStay: () => void
}) {
  return (
    <div className="space-y-5 text-center">
      <p className="text-sm leading-relaxed text-[#d5e4e7]">
        You can finish setting up the community in <span className="font-semibold text-white">Manage Community</span>.
      </p>
      <p className="text-xs leading-relaxed text-[#9fb0b5]">
        Open the menu from your <span className="text-[#4db6ac]">profile avatar</span> (top-left), then tap{' '}
        <span className="text-white/90">Manage Community</span>.
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={onOpenManageCommunity}
          className="w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:w-auto"
        >
          Open Manage Community
        </button>
        <button
          type="button"
          onClick={onStay}
          className="w-full rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/90 transition hover:bg-white/[0.08] sm:w-auto"
        >
          Stay on feed
        </button>
      </div>
    </div>
  )
}

export default function CommunityOwnerSetupIntro({
  communityId,
  communityName,
  username,
  memberCap,
  tierLabel,
  onFinished,
  onOpenManageCommunity,
}: CommunityOwnerSetupIntroProps) {
  const titleId = useId()
  const [phase, setPhase] = useState<'steps' | 'exit_hint'>('steps')
  const [stepIndex, setStepIndex] = useState(0)
  const [exitContext, setExitContext] = useState<'skipped' | 'finished_wizard' | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    try {
      setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches)
    } catch {
      setReducedMotion(false)
    }
  }, [])

  const persist = useCallback(
    (reason: 'completed' | 'dismissed') => {
      try {
        localStorage.setItem(communityOwnerSetupStorageKey(username, communityId), reason)
      } catch {
        /* ignore */
      }
      onFinished(reason)
    },
    [communityId, onFinished, username],
  )

  const finishFromSteps = useCallback(() => {
    setExitContext('finished_wizard')
    setPhase('exit_hint')
  }, [])

  const stepsWithDynamic = STEPS.map((s, i) =>
    i === 3
      ? {
          title: s.title,
          body:
            memberCap != null && memberCap > 0
              ? `You can set an optional cap on how many members can join. On your current plan${
                  tierLabel ? ` (${tierLabel})` : ''
                }, the platform allows up to ${memberCap} members—use a number at or below that when you set your limit.`
              : 'You can set an optional cap on how many members can join. The ceiling depends on your community plan—you will see the current limit on Manage Community.',
        }
      : s,
  )

  const step = stepsWithDynamic[stepIndex]
  const lastStep = stepIndex >= stepsWithDynamic.length - 1

  const openManageAndComplete = useCallback(() => {
    try {
      localStorage.setItem(communityOwnerSetupStorageKey(username, communityId), 'completed')
    } catch {
      /* ignore */
    }
    onOpenManageCommunity()
    onFinished('completed')
  }, [communityId, onFinished, onOpenManageCommunity, username])

  if (phase === 'exit_hint') {
    return (
      <div
        className="fixed inset-0 z-[1102] flex items-center justify-center bg-black/90 px-5 py-8"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className={`w-full max-w-md p-6 sm:p-7 ${GLOW_PANEL_CLASS}`}>
          <h2 id={titleId} className="sr-only">
            Finish in Manage Community
          </h2>
          <ManageCommunityHint
            onOpenManageCommunity={openManageAndComplete}
            onStay={() =>
              persist(exitContext === 'finished_wizard' ? 'completed' : 'dismissed')
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[1102] flex items-center justify-center bg-black/90 px-5 py-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className={`w-full max-w-md ${GLOW_PANEL_CLASS} overflow-hidden`}>
        <div className="border-b border-[#4db6ac]/20 px-5 py-4 sm:px-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-[#4db6ac]">Steve</div>
              <h2 id={titleId} className="mt-1 text-lg font-semibold text-white">
                {communityName || 'Your community'}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setExitContext('skipped')
                setPhase('exit_hint')
              }}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-[#9fb0b5] transition hover:border-[#4db6ac]/40 hover:text-white"
            >
              Skip
            </button>
          </div>
          <div className="mt-3 flex gap-1.5" aria-hidden={reducedMotion}>
            {stepsWithDynamic.map((_, i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-[#4db6ac]' : 'bg-white/15'}`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-5 px-5 py-6 sm:px-7">
          <div>
            <h3 className="text-base font-semibold text-white">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-[#9fb0b5]">{step.body}</p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={() => setStepIndex(i => Math.max(0, i - 1))}
                className="order-2 w-full rounded-xl border border-white/15 bg-white/[0.04] px-5 py-3 text-sm font-medium text-white/90 transition hover:bg-white/[0.08] sm:order-1 sm:w-auto"
              >
                Back
              </button>
            )}
            {!lastStep ? (
              <button
                type="button"
                onClick={() => setStepIndex(i => Math.min(stepsWithDynamic.length - 1, i + 1))}
                className="order-1 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:order-2 sm:w-auto"
              >
                Next
              </button>
            ) : (
              <button
                type="button"
                onClick={finishFromSteps}
                className="order-1 w-full rounded-xl bg-[#4db6ac] px-5 py-3 text-sm font-semibold text-black transition hover:brightness-110 sm:order-2 sm:w-auto"
              >
                Done
              </button>
            )}
          </div>

          <p className="text-center text-[11px] leading-relaxed text-white/35">
            When you are ready, use <span className="text-white/50">Manage Community</span> to change any of these
            settings. Menu: avatar (top-left) → Manage Community.
          </p>
        </div>
      </div>
    </div>
  )
}
