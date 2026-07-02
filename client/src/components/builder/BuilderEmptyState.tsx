/** First-run state for Build with Steve: headline + tappable suggestions. */
export default function BuilderEmptyState({
  suggestions,
  onPick,
  disabled,
}: {
  suggestions: string[]
  onPick: (s: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 pt-1">
      <div>
        <div className="text-xl font-semibold text-c-text-primary">Build with Steve</div>
        <div className="mt-1 text-sm leading-relaxed text-c-text-secondary">
          Websites, apps, games — interactive, with leaderboards and scores — built to share with your community.
        </div>
      </div>
      <div className="flex w-full flex-col gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            disabled={disabled}
            className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-c-border bg-white/[0.04] px-3 py-2.5 text-left text-sm text-c-text-secondary transition hover:border-cpoint-turquoise/35 disabled:opacity-50"
          >
            <span>{s}</span>
            <i className="fa-solid fa-chevron-right text-[10px] text-c-text-tertiary" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}
