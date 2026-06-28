type Props = {
  onCreate: () => void
  onExplore: () => void
}

export default function SteveCreateCard({ onCreate, onExplore }: Props) {
  return (
    <section className="mb-4 overflow-hidden rounded-3xl border border-cpoint-turquoise/25 bg-gradient-to-br from-cpoint-turquoise/16 via-c-bg-elevated to-c-bg-elevated p-4 shadow-c-card">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-c-text-primary">Bring an idea to life</h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-c-text-secondary">
            Describe what you want. Steve makes it real: apps, websites, games, and tools you can share with your communities.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={onCreate}
            className="rounded-xl bg-cpoint-turquoise px-4 py-2 text-sm font-semibold text-black transition hover:brightness-110 active:scale-[0.99]"
          >
            Create with Steve
          </button>
          <button
            type="button"
            onClick={onExplore}
            className="rounded-xl border border-c-border bg-c-hover-bg px-4 py-2 text-sm font-semibold text-c-text-primary transition hover:border-cpoint-turquoise/40 active:scale-[0.99]"
          >
            Explore Creations
          </button>
        </div>
      </div>
    </section>
  )
}
