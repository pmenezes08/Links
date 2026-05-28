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

/** Profile-shaped placeholder: avatar, name lines, stat pills, media grid. */
export function SkeletonProfileShell({ count = 6 }: { count?: number }) {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading profile">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-20 h-20 rounded-full bg-white/8" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-4 w-32 rounded bg-white/8" />
          <div className="h-3 w-20 rounded bg-white/8" />
        </div>
      </div>
      <div className="flex justify-center gap-4">
        <div className="h-6 w-16 rounded-md bg-white/8" />
        <div className="h-6 w-16 rounded-md bg-white/8" />
        <div className="h-6 w-16 rounded-md bg-white/8" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="aspect-square rounded-md bg-white/8" />
        ))}
      </div>
    </div>
  )
}

/** Single settings row placeholder: leading icon circle + title line + trailing chevron. */
export function SkeletonSettingsRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 px-4 h-14 animate-pulse ${className}`}>
      <div className="h-8 w-8 shrink-0 rounded-full bg-white/8" />
      <div className="flex-1 min-w-0">
        <div className="h-3.5 w-2/5 rounded bg-white/8" />
      </div>
      <div className="h-4 w-4 rounded bg-white/5" />
    </div>
  )
}

/** Multiple settings rows in a divided list. */
export function SkeletonSettingsList({ count = 8 }: { count?: number }) {
  return (
    <div className="divide-y divide-white/5" aria-busy="true" aria-label="Loading settings">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonSettingsRow key={i} />
      ))}
    </div>
  )
}

/** Single notification row placeholder: avatar + 2-line preview + timestamp pill. */
export function SkeletonNotificationRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] animate-pulse ${className}`}>
      <div className="h-10 w-10 shrink-0 rounded-full bg-white/8" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3.5 w-4/5 rounded bg-white/8" />
        <div className="h-3 w-3/5 rounded bg-white/5" />
      </div>
      <div className="h-4 w-10 rounded-md bg-white/8 shrink-0 mt-0.5" />
    </div>
  )
}

/** Multiple notification row placeholders. */
export function SkeletonNotificationList({ count = 8 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading notifications">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonNotificationRow key={i} />
      ))}
    </div>
  )
}

/** Single follower row placeholder: avatar + display-name line + follow-button pill. */
export function SkeletonFollowerRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 px-3.5 py-2.5 animate-pulse ${className}`}>
      <div className="h-11 w-11 shrink-0 rounded-full bg-white/8" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3.5 w-1/3 rounded bg-white/8" />
        <div className="h-3 w-1/5 rounded bg-white/5" />
      </div>
      <div className="h-7 w-16 rounded-full bg-white/8" />
    </div>
  )
}

/** Multiple follower row placeholders. */
export function SkeletonFollowerList({ count = 10 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading followers">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonFollowerRow key={i} />
      ))}
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
