import { useTranslation } from 'react-i18next'
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from './subscriptionConstants'

export default function SubscriptionLegalLinks({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <p className={`text-xs leading-relaxed text-white/45 ${className}`}>
      {t('subscriptions.legal_disclosure')}{' '}
      <a
        href={TERMS_OF_USE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#4db6ac] underline"
      >
        {t('subscriptions.terms_of_use')}
      </a>
      {' · '}
      <a
        href={PRIVACY_POLICY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[#4db6ac] underline"
      >
        {t('subscriptions.privacy_policy')}
      </a>
    </p>
  )
}
