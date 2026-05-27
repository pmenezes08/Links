type SkeletonRowProps = {
  className?: string
}

/** Placeholder row for list loading states (chat threads, messages). */
export function SkeletonRow({ className = '' }: SkeletonRowProps) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 animate-pulse ${className}`}>
      <div className="h-12 w-12 shrink-0 rounded-full bg-white/10" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-3.5 w-2/5 rounded bg-white/10" />
        <div className="h-3 w-4/5 rounded bg-white/5" />
      </div>
    </div>
  )
}

export function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="py-1" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}

/** Skeleton matching feed post card layout (avatar + header + body lines + action bar). */
export function SkeletonFeedCard({ className = '' }: { className?: string }) {
  return (
    <div className={`px-4 py-4 animate-pulse ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-1/3 rounded bg-white/10" />
          <div className="h-2.5 w-1/5 rounded bg-white/5" />
        </div>
      </div>
      <div className="space-y-2 mb-3">
        <div className="h-3 w-full rounded bg-white/8" />
        <div className="h-3 w-4/5 rounded bg-white/8" />
        <div className="h-3 w-3/5 rounded bg-white/5" />
      </div>
      <div className="flex items-center gap-4 pt-2 border-t border-white/5">
        <div className="h-6 w-14 rounded-full bg-white/5" />
        <div className="h-6 w-14 rounded-full bg-white/5" />
        <div className="h-6 w-14 rounded-full bg-white/5" />
      </div>
    </div>
  )
}

/** Skeleton matching feed post list (multiple cards). */
export function SkeletonFeedList({ count = 3 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading feed">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonFeedCard key={i} />
      ))}
    </div>
  )
}

/** Skeleton matching PremiumDashboard community card (glass card shape). */
export function SkeletonCommunityCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`relative flex min-h-[8.5rem] w-full rounded-2xl overflow-hidden border border-white/15 animate-pulse ${className}`}
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div className="flex flex-col gap-3 p-6 sm:p-7 w-full">
        <div className="h-4 w-2/3 rounded bg-white/10" />
        <div className="h-3 w-full rounded bg-white/5" />
        <div className="h-3 w-4/5 rounded bg-white/5" />
        <div className="flex items-center gap-3 mt-auto">
          <div className="h-3 w-16 rounded bg-white/5" />
          <div className="h-3 w-20 rounded bg-white/5" />
        </div>
      </div>
    </div>
  )
}

/** Skeleton matching post detail page (header + full post body + replies section). */
export function SkeletonPostDetail({ className = '' }: { className?: string }) {
  return (
    <div className={`px-4 py-4 animate-pulse ${className}`} aria-busy="true" aria-label="Loading post">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 shrink-0 rounded-full bg-white/10" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-1/3 rounded bg-white/10" />
          <div className="h-2.5 w-1/4 rounded bg-white/5" />
        </div>
      </div>
      <div className="space-y-2.5 mb-4">
        <div className="h-3.5 w-full rounded bg-white/8" />
        <div className="h-3.5 w-full rounded bg-white/8" />
        <div className="h-3.5 w-4/5 rounded bg-white/8" />
        <div className="h-3.5 w-2/3 rounded bg-white/5" />
      </div>
      <div className="h-48 w-full rounded-lg bg-white/5 mb-4" />
      <div className="flex items-center gap-4 py-3 border-t border-b border-white/5 mb-4">
        <div className="h-6 w-16 rounded-full bg-white/5" />
        <div className="h-6 w-16 rounded-full bg-white/5" />
        <div className="h-6 w-16 rounded-full bg-white/5" />
      </div>
      <div className="space-y-3">
        <div className="h-3 w-20 rounded bg-white/10" />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    </div>
  )
}
