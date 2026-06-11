import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/** First-person suggestion asks shown on an empty Steve thread — sent
 * verbatim as the member's message, so each one is a real retrieval
 * query, not a category label. Auto-match renders as row 1 separately. */
export const SUGGESTION_KEYS = [
  'networking.suggest_mentor',
  'networking.suggest_cofounder',
  'networking.suggest_investors',
  'networking.suggest_clients',
  'networking.suggest_nearby',
] as const

export const VISIBLE_SUGGESTIONS = 3

/** Below this, the member-count proof line would read as evidence against
 * Steve ("has 0 members I know well") — swap to the getting-to-know copy. */
const PROOF_COUNT_FLOOR = 3

/** Deterministic daily rotation: a contiguous window over the pool keyed
 * by day index, so the set is stable within a visit, varies across days,
 * and every query keeps getting exercised. */
export function pickDailySuggestions(
  keys: readonly string[],
  count: number,
  dayIndex: number,
): string[] {
  if (keys.length <= count) return [...keys]
  const start = ((dayIndex % keys.length) + keys.length) % keys.length
  return Array.from({ length: count }, (_, i) => keys[(start + i) % keys.length])
}

export default function SteveEmptyState({
  communityName,
  activeMemberCount,
  disabled,
  onAutoMatch,
  onSuggestion,
}: {
  communityName: string
  activeMemberCount: number
  disabled: boolean
  onAutoMatch: () => void
  onSuggestion: (text: string) => void
}) {
  const { t } = useTranslation()
  const visibleSuggestions = useMemo(
    () => pickDailySuggestions(SUGGESTION_KEYS, VISIBLE_SUGGESTIONS, Math.floor(Date.now() / 86_400_000)),
    [],
  )
  return (
    <div className="pt-2">
      <div className="space-y-2 text-[14px] leading-relaxed text-c-text-secondary">
        <p className="text-base font-semibold text-c-text-primary">{t('networking.welcome_prompt_bold')}</p>
        <p>
          {activeMemberCount < PROOF_COUNT_FLOOR
            ? t('networking.welcome_members_zero')
            : t(activeMemberCount === 1 ? 'networking.welcome_members_one' : 'networking.welcome_members_other', {
                community: communityName,
                count: activeMemberCount,
              })}
        </p>
      </div>
      <div className="mt-6 divide-y divide-c-border-subtle">
        <button
          type="button"
          onClick={onAutoMatch}
          disabled={disabled}
          className="group flex min-h-[44px] w-full items-center gap-3 text-left transition disabled:opacity-50"
        >
          <i className="fa-solid fa-wand-magic-sparkles w-3 text-[10px] text-c-text-tertiary transition group-hover:text-cpoint-turquoise" aria-hidden="true" />
          <span className="flex-1 truncate text-[13px] text-c-text-secondary transition group-hover:text-c-text-primary">
            {t('networking.auto_match_message')}
          </span>
          <i className="fa-solid fa-chevron-right text-[9px] text-c-text-disabled opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
        </button>
        {visibleSuggestions.map(key => (
          <button
            key={key}
            type="button"
            onClick={() => onSuggestion(t(key))}
            disabled={disabled}
            className="group flex min-h-[44px] w-full items-center gap-3 text-left transition disabled:opacity-50"
          >
            <i className="fa-solid fa-magnifying-glass w-3 text-[10px] text-c-text-tertiary transition group-hover:text-cpoint-turquoise" aria-hidden="true" />
            <span className="flex-1 truncate text-[13px] text-c-text-secondary transition group-hover:text-c-text-primary">
              {t(key)}
            </span>
            <i className="fa-solid fa-chevron-right text-[9px] text-c-text-disabled opacity-0 transition group-hover:opacity-100" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}
