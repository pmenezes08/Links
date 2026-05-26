export default function SubscriptionsHubSkeleton() {
  return (
    <div className="mt-9 space-y-7">
      {[0, 1].map(i => (
        <div key={i} className="space-y-2">
          <div className="mx-1 h-3 w-24 animate-pulse rounded bg-white/10" />
          <div className="overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.055]">
            {[0, 1, 2].map(j => (
              <div key={j} className="flex items-center gap-4 px-4 py-3">
                <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-white/10" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-32 animate-pulse rounded bg-white/10" />
                  <div className="h-3 w-48 animate-pulse rounded bg-white/[0.06]" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
