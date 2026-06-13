type SkeletonRowProps = {
  className?: string
}

/** Placeholder row for list loading states (chat threads, messages). */
export function SkeletonRow({ className = '' }: SkeletonRowProps) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2 ${className}`}>
      <div className="h-12 w-12 shrink-0 rounded-full skeleton-box" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="h-3.5 w-2/5 rounded skeleton-box" />
        <div className="h-3 w-4/5 rounded skeleton-box skeleton-box--soft" />
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
    <div className={`px-4 py-4 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="h-10 w-10 shrink-0 rounded-full skeleton-box" />
        <div className="flex-1 space-y-1.5">
          <div className="h-3.5 w-1/3 rounded skeleton-box" />
          <div className="h-2.5 w-1/5 rounded skeleton-box skeleton-box--soft" />
        </div>
      </div>
      <div className="space-y-2 mb-3">
        <div className="h-3 w-full rounded skeleton-box" />
        <div className="h-3 w-4/5 rounded skeleton-box" />
        <div className="h-3 w-3/5 rounded skeleton-box skeleton-box--soft" />
      </div>
      <div className="flex items-center gap-4 pt-2 border-t border-c-border">
        <div className="h-6 w-14 rounded-full skeleton-box skeleton-box--soft" />
        <div className="h-6 w-14 rounded-full skeleton-box skeleton-box--soft" />
        <div className="h-6 w-14 rounded-full skeleton-box skeleton-box--soft" />
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
      className={`relative flex min-h-[8.5rem] w-full rounded-2xl overflow-hidden border border-c-border ${className}`}
      style={{ background: 'rgba(255,255,255,0.03)' }}
    >
      <div className="flex flex-col gap-3 p-6 sm:p-7 w-full">
        <div className="h-4 w-2/3 rounded skeleton-box" />
        <div className="h-3 w-full rounded skeleton-box skeleton-box--soft" />
        <div className="h-3 w-4/5 rounded skeleton-box skeleton-box--soft" />
        <div className="flex items-center gap-3 mt-auto">
          <div className="h-3 w-16 rounded skeleton-box skeleton-box--soft" />
          <div className="h-3 w-20 rounded skeleton-box skeleton-box--soft" />
        </div>
      </div>
    </div>
  )
}

/** Profile-shaped placeholder: avatar, name lines, stat pills, media grid. */
export function SkeletonProfileShell({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading profile">
      <div className="flex flex-wrap items-center gap-4">
        <div className="w-20 h-20 rounded-full skeleton-box" />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="h-4 w-32 rounded skeleton-box" />
          <div className="h-3 w-20 rounded skeleton-box skeleton-box--soft" />
        </div>
      </div>
      <div className="flex justify-center gap-4">
        <div className="h-6 w-16 rounded-md skeleton-box" />
        <div className="h-6 w-16 rounded-md skeleton-box" />
        <div className="h-6 w-16 rounded-md skeleton-box" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="aspect-square rounded-md skeleton-box skeleton-box--soft" />
        ))}
      </div>
    </div>
  )
}

/** Single settings row placeholder: leading icon circle + title line + trailing chevron. */
export function SkeletonSettingsRow({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 px-4 h-14 ${className}`}>
      <div className="h-8 w-8 shrink-0 rounded-full skeleton-box" />
      <div className="flex-1 min-w-0">
        <div className="h-3.5 w-2/5 rounded skeleton-box" />
      </div>
      <div className="h-4 w-4 rounded skeleton-box skeleton-box--soft" />
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
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border border-c-border bg-white/[0.03] ${className}`}>
      <div className="h-10 w-10 shrink-0 rounded-full skeleton-box" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3.5 w-4/5 rounded skeleton-box" />
        <div className="h-3 w-3/5 rounded skeleton-box skeleton-box--soft" />
      </div>
      <div className="h-4 w-10 rounded-md skeleton-box skeleton-box--soft shrink-0 mt-0.5" />
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
    <div className={`flex items-center gap-3 px-3.5 py-2.5 ${className}`}>
      <div className="h-11 w-11 shrink-0 rounded-full skeleton-box" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-3.5 w-1/3 rounded skeleton-box" />
        <div className="h-3 w-1/5 rounded skeleton-box skeleton-box--soft" />
      </div>
      <div className="h-7 w-16 rounded-full skeleton-box" />
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

/**
 * Skeleton matching the post detail page — a structural twin of the loaded view:
 * its own 56px header (back + title + trailing icons), post body (no media block
 * by default — most posts have none, and a phantom block shifts layout worse
 * than its absence), an action bar, a couple of reply rows, and a composer bar
 * at the bottom. Normal-flow `min-h-screen` so it slides with the page transition
 * on iOS (a `position: fixed` root would pin to the viewport and not slide).
 */
export function SkeletonPostDetail({ className = '' }: { className?: string }) {
  return (
    <div
      className={`min-h-screen flex flex-col bg-c-bg-app text-c-text-primary ${className}`}
      aria-busy="true"
      aria-label="Loading post"
    >
      {/* Header — mirrors the loaded post header height (56px + safe-area). */}
      <div
        className="flex-shrink-0 border-b border-c-border bg-c-header-bg"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="h-14 flex items-center gap-2 px-3">
          <div className="h-9 w-9 shrink-0 rounded-full skeleton-box" />
          <div className="flex-1 min-w-0">
            <div className="h-3.5 w-16 rounded skeleton-box" />
          </div>
          <div className="h-9 w-9 shrink-0 rounded-full skeleton-box skeleton-box--soft" />
          <div className="h-9 w-9 shrink-0 rounded-full skeleton-box skeleton-box--soft" />
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 px-4 py-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 shrink-0 rounded-full skeleton-box" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-1/3 rounded skeleton-box" />
            <div className="h-2.5 w-1/4 rounded skeleton-box skeleton-box--soft" />
          </div>
        </div>
        <div className="space-y-2.5 mb-4">
          <div className="h-3.5 w-full rounded skeleton-box" />
          <div className="h-3.5 w-full rounded skeleton-box" />
          <div className="h-3.5 w-4/5 rounded skeleton-box" />
          <div className="h-3.5 w-2/3 rounded skeleton-box skeleton-box--soft" />
        </div>
        <div className="flex items-center gap-4 py-3 border-t border-b border-c-border mb-4">
          <div className="h-6 w-16 rounded-full skeleton-box skeleton-box--soft" />
          <div className="h-6 w-16 rounded-full skeleton-box skeleton-box--soft" />
          <div className="h-6 w-16 rounded-full skeleton-box skeleton-box--soft" />
        </div>
        <div className="space-y-3">
          <div className="h-3 w-20 rounded skeleton-box" />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </div>

      {/* Composer bar — mirrors the fixed composer footer (~96px + safe-area). */}
      <div
        className="flex-shrink-0 border-t border-c-border bg-c-header-bg px-3 pt-3"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      >
        <div className="h-11 w-full rounded-full skeleton-box skeleton-box--soft" />
      </div>
    </div>
  )
}
