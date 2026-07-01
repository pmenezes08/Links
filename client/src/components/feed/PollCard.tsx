import { useTranslation } from 'react-i18next'
import { formatSmartTime } from '../../utils/time'
import { isPollClosed, isSingleVotePoll, type Poll } from '../../hooks/usePollVote'

type PollCardProps = {
  postId: number
  poll: Poll
  postTimestamp?: string
  isSystemPoll?: boolean
  compact?: boolean
  detail?: boolean
  canManage?: boolean
  onVote?: (postId: number, pollId: number, optionId: number, isGroupPoll?: boolean) => void
  onEdit?: () => void
  onDelete?: () => void
  onOpenVoters?: (pollId: number) => void
  onViewAllPolls?: () => void
  onDiscuss?: () => void
  repliesCount?: number
}

export default function PollCard({
  postId,
  poll,
  postTimestamp,
  isSystemPoll = false,
  compact = false,
  detail = false,
  canManage = false,
  onVote,
  onEdit,
  onDelete,
  onOpenVoters,
  onViewAllPolls,
  onDiscuss,
  repliesCount = 0,
}: PollCardProps) {
  const { t } = useTranslation()
  const closed = isPollClosed(poll)
  const isSingle = isSingleVotePoll(poll)
  const showFooter = !compact || !!onDiscuss

  return (
    <div className={`px-3 space-y-2 ${detail ? 'pb-2' : ''}`} onClick={e => e.stopPropagation()}>
      {isSystemPoll && !compact && (
        <div className="flex items-center justify-between gap-2 border-b border-cpoint-turquoise/15 pb-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-cpoint-turquoise/15 text-cpoint-turquoise">
              <i className="fa-solid fa-chart-bar text-xs" />
            </span>
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cpoint-turquoise/80">
                {t('feed.icebreaker')}
              </div>
              <div className="text-xs text-c-text-tertiary">{t('feed.posted_by_steve')}</div>
            </div>
          </div>
          {postTimestamp ? (
            <div className="text-xs text-c-text-tertiary tabular-nums">{formatSmartTime(postTimestamp)}</div>
          ) : null}
        </div>
      )}

      <div className={`flex items-center gap-2 ${compact ? 'mb-1' : 'mb-2'}`}>
        {!compact && <i className="fa-solid fa-chart-bar text-cpoint-turquoise" />}
        <div className={`flex-1 ${compact ? 'text-sm text-c-text-secondary' : 'font-medium text-sm'}`}>
          {poll.question}
          {!compact && poll.expires_at ? (
            <span className="ml-2 text-[11px] text-c-text-tertiary">
              {t('feed.poll_closes', {
                date: (() => {
                  try {
                    const d = new Date(poll.expires_at as string)
                    if (!Number.isNaN(d.getTime())) return d.toLocaleDateString()
                  } catch {}
                  return String(poll.expires_at)
                })(),
              })}
            </span>
          ) : null}
          {!compact && closed ? (
            <span className="ml-2 rounded-full border border-c-border px-2 py-0.5 text-[10px] uppercase tracking-wide text-c-text-tertiary">
              {t('feed.poll_final_result_closed')}
            </span>
          ) : null}
        </div>
        {!compact && canManage && (
          <>
            {onEdit ? (
              <button
                type="button"
                className="px-2 py-1 rounded-full text-[#6c757d] hover:text-cpoint-turquoise"
                title={t('feed.edit_poll')}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  onEdit()
                }}
              >
                <i className="fa-regular fa-pen-to-square" />
              </button>
            ) : null}
            {onDelete ? (
              <button
                type="button"
                className="px-2 py-1 rounded-full text-red-400 hover:text-red-300"
                title={t('feed.delete_poll')}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <i className="fa-regular fa-trash-can" />
              </button>
            ) : null}
          </>
        )}
        {!compact && onOpenVoters ? (
          <button
            type="button"
            className="ml-1 px-2 py-1 rounded-full text-[#6c757d] hover:text-cpoint-turquoise"
            title={t('feed.voters')}
            onClick={e => {
              e.preventDefault()
              e.stopPropagation()
              onOpenVoters(poll.id)
            }}
          >
            <i className="fa-solid fa-users" />
          </button>
        ) : null}
      </div>

      {compact ? (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={poll.question}>
          {poll.options?.map(option => {
            const selected = !!option.user_voted
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={closed}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  closed
                    ? 'cursor-not-allowed border-c-border opacity-60'
                    : selected
                      ? 'border-cpoint-turquoise/40 bg-cpoint-turquoise/15 text-cpoint-turquoise'
                      : 'border-c-border bg-c-hover-bg text-c-text-secondary hover:border-cpoint-turquoise/40'
                }`}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!closed) onVote?.(postId, poll.id, option.id, !!poll.group_poll)
                }}
              >
                {option.text || option.option_text}
              </button>
            )
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {poll.options?.map(option => {
            const percentage = poll.total_votes ? Math.round(((option.votes || 0) / poll.total_votes) * 100) : 0
            const selected = !!option.user_voted
            return (
              <button
                key={option.id}
                type="button"
                disabled={closed}
                className={`w-full text-left px-3 py-2 rounded-lg border relative overflow-hidden ${
                  closed ? 'opacity-60 cursor-not-allowed' : selected ? 'border-cpoint-turquoise bg-cpoint-turquoise/10' : 'border-c-border hover:bg-c-hover-bg'
                }`}
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (!closed) onVote?.(postId, poll.id, option.id, !!poll.group_poll)
                }}
              >
                <div className="absolute inset-0 bg-cpoint-turquoise/20" style={{ width: `${percentage}%`, transition: 'width 0.3s ease' }} />
                <div className="relative flex items-center justify-between">
                  <span className="text-sm">{option.text || option.option_text}</span>
                  <span className="text-xs text-c-text-tertiary font-medium">
                    {option.votes || 0} {percentage > 0 ? `(${percentage}%)` : ''}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {showFooter ? (
        <div className="flex items-center justify-between gap-3 text-xs text-c-text-tertiary pt-1">
          {!compact && isSingle ? <span>{t('feed.vote_count', { count: poll.total_votes || 0 })}</span> : <span />}
          <div className="ml-auto flex items-center gap-3">
            {onDiscuss ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-cpoint-turquoise hover:underline"
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  onDiscuss()
                }}
              >
                <i className="fa-regular fa-comment" />
                <span>{repliesCount > 0 ? t('feed.discuss_count', { count: repliesCount }) : t('feed.discuss')}</span>
              </button>
            ) : null}
            {!compact && onViewAllPolls ? (
              <button
                type="button"
                onClick={e => {
                  e.preventDefault()
                  e.stopPropagation()
                  onViewAllPolls()
                }}
                className="text-cpoint-turquoise hover:underline"
              >
                {t('feed.view_all_polls')}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
