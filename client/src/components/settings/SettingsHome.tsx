import SettingsRow from './SettingsRow'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Avatar from '../Avatar'
import { MIDDLE_DOT } from '../../utils/typography'

export type SettingsPanelKey = 'account' | 'subscription' | 'notifications' | 'language' | 'appearance' | 'privacy' | 'about'

type SettingsHomeProps = {
  username: string
  email: string
  avatarUrl?: string | null
  subscription: string
  notificationsLabel: string
  languageLabel: string
  appearanceLabel: string
  activePanel: SettingsPanelKey | null
  dangerOpen: boolean
  onOpenPanel: (panel: SettingsPanelKey) => void
  onOpenDanger: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-c-text-tertiary">{title}</h2>
      <div className="overflow-hidden rounded-3xl border border-c-border bg-c-bg-surface shadow-c-glass">
        {children}
      </div>
    </section>
  )
}

function Divider() {
  return <div className="ml-[4.75rem] h-px bg-c-border-subtle" />
}

export default function SettingsHome({
  username,
  email,
  avatarUrl,
  subscription,
  notificationsLabel,
  languageLabel,
  appearanceLabel,
  activePanel,
  dangerOpen,
  onOpenPanel,
  onOpenDanger,
}: SettingsHomeProps) {
  const { t } = useTranslation()
  const isPremium = subscription === 'premium'

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col px-5 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-4">
      <h1 className="text-center text-xl font-bold tracking-[-0.02em] text-c-text-primary">Settings</h1>

      <div className="mt-8 flex items-center gap-5">
        <Avatar
          username={username}
          displayName={username}
          url={avatarUrl}
          size={80}
          className="shrink-0 border-cpoint-turquoise/35 bg-cpoint-turquoise"
        />
        <div className="min-w-0">
          <div className="truncate text-2xl font-bold tracking-[-0.03em] text-c-text-primary">{username || 'Account'}</div>
          <div className="mt-0.5 truncate text-base text-c-text-tertiary">{email}</div>
          {isPremium ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-cpoint-turquoise/12 px-3 py-1 text-xs font-bold text-cpoint-turquoise">
              <i className="fa-solid fa-crown text-[10px]" />
              Premium
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-9 space-y-7">
        <Section title="Account">
          <SettingsRow
            icon="fa-regular fa-user"
            title={t('account.info.section_title')}
            subtitle={`${username || 'Username'} ${MIDDLE_DOT} ${email || 'Email'}`}
            active={activePanel === 'account'}
            onClick={() => onOpenPanel('account')}
          />
          <Divider />
          <SettingsRow
            icon="fa-solid fa-crown"
            title={t('account.subscription.section_title')}
            subtitle={isPremium ? t('account.subscription.premium') : t('account.subscription.free')}
            active={activePanel === 'subscription'}
            badge={
              isPremium ? (
                <span className="rounded-full bg-cpoint-turquoise/12 px-3 py-1 text-xs font-bold text-cpoint-turquoise">Premium</span>
              ) : null
            }
            onClick={() => onOpenPanel('subscription')}
          />
        </Section>

        <Section title="Preferences">
          <SettingsRow
            icon="fa-regular fa-bell"
            title={t('account.notifications.section_title')}
            subtitle={notificationsLabel}
            active={activePanel === 'notifications'}
            onClick={() => onOpenPanel('notifications')}
          />
          <Divider />
          <SettingsRow
            icon="fa-solid fa-language"
            title={t('account.language.section_title')}
            subtitle={languageLabel}
            active={activePanel === 'language'}
            onClick={() => onOpenPanel('language')}
          />
          <Divider />
          <SettingsRow
            icon="fa-regular fa-moon"
            title={t('account.appearance')}
            subtitle={appearanceLabel}
            active={activePanel === 'appearance'}
            onClick={() => onOpenPanel('appearance')}
          />
        </Section>

        <Section title="Security & Legal">
          <SettingsRow
            icon="fa-solid fa-shield-halved"
            title={t('account.privacy.section_title')}
            subtitle={t('account.privacy.helper')}
            active={activePanel === 'privacy'}
            onClick={() => onOpenPanel('privacy')}
          />
          <Divider />
          <SettingsRow
            icon="fa-solid fa-circle-info"
            title={t('account.about.section_title')}
            subtitle="Version, manifesto, docs"
            active={activePanel === 'about'}
            onClick={() => onOpenPanel('about')}
          />
          <Divider />
          <SettingsRow
            icon="fa-solid fa-triangle-exclamation"
            title={t('account.danger.section_title')}
            subtitle={t('account.danger.summary')}
            danger
            active={dangerOpen}
            onClick={onOpenDanger}
          />
        </Section>
      </div>
    </div>
  )
}
