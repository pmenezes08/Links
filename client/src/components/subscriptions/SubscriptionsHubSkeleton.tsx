export default function SubscriptionsHubSkeleton() {
  return (
    <div className="mt-9 space-y-7">
      {[0, 1].map(i => (
        <div key={i} className="space-y-2">
          <div className="mx-1 h-3 w-24 animate-pulse rounded bg-c-active-bg" />
          <div className="overflow-hidden rounded-3xl border border-c-border bg-c-bg-surface">
            {[0, 1, 2].map(j => (
              <div key={j} className="flex items-center gap-4 px-4 py-3">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-c-active-bg" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-c-active-bg" />
                  <div className="h-3 w-48 animate-pulse rounded bg-c-skeleton-subtle" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
