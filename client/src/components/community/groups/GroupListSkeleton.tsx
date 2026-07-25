/** Loading placeholder matching GroupCard's exact geometry (72px rows,
 * 40px icon well) so the list doesn't jump when data lands. Uses the
 * design system's `.skeleton-box`, not animate-pulse. */
export default function GroupListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {[0, 1, 2].map(i => (
        <div key={i} className="rounded-2xl border border-c-border bg-c-bg-elevated px-4 py-3 flex items-start gap-3 min-h-[72px]">
          <div className="flex-1 space-y-2">
            <div className="skeleton-box h-3.5 w-2/5 rounded" />
            <div className="skeleton-box h-3 w-3/5 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}
