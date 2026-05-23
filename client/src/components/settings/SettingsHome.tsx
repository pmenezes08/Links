import SettingsRow from './SettingsRow'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type SettingsPanelKey = 'account' | 'subscription' | 'notifications' | 'language' | 'privacy' | 'about'

type SettingsHomeProps = {
  username: string
  email: string
  subscription: string
  notificationsLabel: string
  languageLabel: string
  activePanel: SettingsPanelKey | null
  dangerOpen: boolean
  onOpenPanel: (panel: SettingsPanelKey) => void
  onOpenDanger: () => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.16em] text-white/28">{title}</h2>
      <div className="overflow-hidden rounded-3xl border border-white/[0.06] bg-white/[0.055] shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
        {children}
      </div>
    </section>
  )
}

function Divider() {
  return <div className="ml-[4.75rem] h-px bg-white/[0.055]" />
}

export default function SettingsHome({
  username,
  email,
  subscription,
  notificationsLabel,
  languageLabel,
  activePanel,
  dangerOpen,
  onOpenPanel,
  onOpenDanger,
}: SettingsHomeProps) {
  const { t } = useTranslation()
  const initial = (username || email || 'C').trim().slice(0, 1).toUpperCase()
  const isPro = subscription === 'premium'

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col px-5 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
      <h1 className="text-center text-xl font-bold tracking-[-0.02em] text-white">Settings</h1>

      <div className="mt-8 flex items-center gap-5">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-[#4db6ac] text-3xl font-bold text-black">
          {initial}
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-bold tracking-[-0.03em] text-white">{username || 'Account'}</div>
          <div className="mt-0.5 truncate text-base text-white/38">{email}</div>
          {isPro ? (
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#4db6ac]/12 px-3 py-1 text-xs font-bold text-[#4db6ac]">
              <i className="fa-solid fa-crown text-[10px]" />
              Pro
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-9 space-y-7">
        <Section title="Account">
          <SettingsRow
            icon="fa-regular fa-user"
            title={t('account.info.section_title')}
            subtitle={`${username || 'Username'} · ${email || 'Email'}`}
            active={activePanel === 'account'}
            onClick={() => onOpenPanel('account')}
          />
          <Divider />
          <SettingsRow
            icon="fa-solid fa-crown"
            title={t('account.subscription.section_title')}
            subtitle={isPro ? t('account.subscription.premium') : t('account.subscription.free')}
            active={activePanel === 'subscription'}
            badge={
              isPro ? (
                <span className="rounded-full bg-[#4db6ac]/12 px-3 py-1 text-xs font-bold text-[#4db6ac]">Pro</span>
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
