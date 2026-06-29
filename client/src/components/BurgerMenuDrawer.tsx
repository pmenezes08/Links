import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Avatar from './Avatar'
import { useLogoutRequest } from '../contexts/LogoutPromptContext'
import { triggerHaptic } from '../utils/haptics'
import { getCachedDashboardSnapshot } from '../utils/dashboardCache'

type BurgerMenuDrawerProps = {
  username?: string
  displayName?: string
  avatarUrl?: string | null
  zIndexClass?: string
  onClose: () => void
}

type MenuItemProps = {
  icon: string
  label: string
  onClick: () => void
}

function MenuItem({ icon, label, onClick }: MenuItemProps) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-c-text-primary transition-colors hover:bg-c-hover-bg"
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-4">
        <i className={`${icon} w-5 text-center text-c-text-primary`} />
        <span className="truncate">{label}</span>
      </span>
      <i className="fa-solid fa-chevron-right text-xs text-c-text-primary" />
    </button>
  )
}

export default function BurgerMenuDrawer({
  username,
  displayName,
  avatarUrl,
  zIndexClass = 'z-[1100]',
  onClose,
}: BurgerMenuDrawerProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const requestLogout = useLogoutRequest()
  const profilePath = username ? `/profile/${encodeURIComponent(username)}` : '/profile'
  const title = displayName || username || ''
  const isAdmin = username === 'admin'
  // Owner Dashboard entry: deep-link to a community the user owns (from the
  // cached dashboard). Hidden until we know they own one — the route itself is
  // still server-side gated, so this is cosmetic only.
  const ownedCommunityId = (() => {
    try {
      return getCachedDashboardSnapshot()?.communities?.find(c => c.is_owner || c.is_admin)?.id ?? null
    } catch {
      return null
    }
  })()

  useEffect(() => {
    void triggerHaptic('light')
  }, [])

  const goTo = (path: string) => {
    void triggerHaptic('selection')
    onClose()
    navigate(path)
  }

  const closeDrawer = () => {
    void triggerHaptic('light')
    onClose()
  }

  return (
    <div
      className={`burger-menu-backdrop fixed inset-0 ${zIndexClass} flex bg-black/55`}
      onClick={(e) => e.currentTarget === e.target && closeDrawer()}
    >
      <div
        className="burger-menu-sheet h-full w-[90%] max-w-sm overflow-y-auto overscroll-contain border-r border-c-border bg-c-bg-elevated p-4 text-c-text-primary shadow-[24px_0_70px_rgba(0,0,0,0.72)] backdrop-blur-md"
        style={{
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1rem)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)',
        }}
      >
        <button
          type="button"
          className="flex w-full items-center gap-3 border-b border-c-border pb-5 text-left"
          onClick={() => goTo(profilePath)}
        >
          <Avatar username={username || ''} url={avatarUrl || null} size={52} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{title}</span>
            <span className="block truncate text-sm text-c-text-tertiary">{t('chat.view_profile')}</span>
          </span>
        </button>

        <nav className="mt-4 space-y-1">
          {isAdmin ? (
            <>
              <MenuItem icon="fa-solid fa-shield-halved" label={t('navigation.admin_profile')} onClick={() => goTo('/admin_profile_react')} />
              <MenuItem icon="fa-solid fa-chart-line" label={t('navigation.admin_dashboard')} onClick={() => goTo('/admin')} />
            </>
          ) : null}
          <MenuItem icon="fa-solid fa-house" label={t('navigation.dashboard')} onClick={() => goTo('/premium_dashboard')} />
          {ownedCommunityId != null ? (
            <MenuItem icon="fa-solid fa-chart-simple" label={t('navigation.owner_tools')} onClick={() => goTo(`/community/${ownedCommunityId}/owner`)} />
          ) : null}
          <MenuItem icon="fa-solid fa-user" label={t('navigation.my_profile')} onClick={() => goTo(profilePath)} />
          <MenuItem icon="fa-solid fa-user-group" label={t('navigation.followers')} onClick={() => goTo('/followers')} />
          <MenuItem icon="fa-solid fa-cube" label={t('navigation.subscriptions')} onClick={() => goTo('/subscription_plans')} />
          <MenuItem icon="fa-solid fa-gear" label={t('navigation.account_settings')} onClick={() => goTo('/account_settings')} />

          <div className="my-2 border-t border-c-border pt-2">
            <button
              type="button"
              className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-c-text-primary transition-colors hover:bg-c-hover-bg"
              onClick={(e) => {
                void triggerHaptic('medium')
                onClose()
                requestLogout(e)
              }}
            >
              <i className="fa-solid fa-right-from-bracket w-5 text-center text-c-text-primary" />
              <span className="truncate">{t('navigation.logout')}</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  )
}
