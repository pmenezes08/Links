import { useTranslation } from 'react-i18next'

interface LoadErrorRetryProps {
  /** Page-specific error text. Falls back to a generic network message. */
  message?: string | null
  /** Re-trigger the load that failed. */
  onRetry: () => void
  className?: string
}

/**
 * Shared "couldn't load — try again" state so a failed fetch on a weak network
 * reads as recoverable instead of looking like an empty page. Generalizes the
 * inline retry pattern in PostDetail (skeleton / error+retry / loaded).
 */
export default function LoadErrorRetry({ message, onRetry, className = '' }: LoadErrorRetryProps) {
  const { t } = useTranslation()
  return (
    <div className={`p-4 text-center text-c-text-tertiary ${className}`} role="alert">
      <div className="text-red-400 mb-3">{message || t('errors.network')}</div>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 py-1.5 rounded-md border border-c-border text-sm hover:bg-c-hover-bg"
      >
        {t('common.retry')}
      </button>
    </div>
  )
}
