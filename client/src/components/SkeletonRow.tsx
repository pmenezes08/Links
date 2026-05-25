type SkeletonRowProps = {
  className?: string
}

/** Placeholder row for list loading states. */
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
