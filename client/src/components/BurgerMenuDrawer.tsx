import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Avatar from './Avatar'
import { useLogoutRequest } from '../contexts/LogoutPromptContext'

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
      className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-white transition-colors hover:bg-white/5"
      onClick={onClick}
    >
      <span className="flex min-w-0 items-center gap-4">
        <i className={`${icon} w-5 text-center text-white`} />
        <span className="truncate">{label}</span>
      </span>
      <i className="fa-solid fa-chevron-right text-xs text-white" />
    </button>
  )
}

export default function BurgerMenuDrawer({
  username,
  displayName,
  avatarUrl,
  zIndexClass = 'z-[90]',
  onClose,
}: BurgerMenuDrawerProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const requestLogout = useLogoutRequest()
  const profilePath = username ? `/profile/${encodeURIComponent(username)}` : '/profile'
  const title = displayName || username || ''
  const isAdmin = username === 'admin'

  const goTo = (path: string) => {
    onClose()
    navigate(path)
  }

  return (
    <div
      className={`fixed inset-0 ${zIndexClass} flex bg-black/50`}
      onClick={(e) => e.currentTarget === e.target && onClose()}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div
        className="h-full w-[90%] max-w-sm overflow-y-auto overscroll-auto border-r border-white/10 bg-black/95 p-4 text-white backdrop-blur"
        style={{ paddingTop: '1rem', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <button
          type="button"
          className="flex w-full items-center gap-3 border-b border-white/10 pb-5 text-left"
          onClick={() => goTo(profilePath)}
        >
          <Avatar username={username || ''} url={avatarUrl || null} size={52} />
          <span className="min-w-0">
            <span className="block truncate font-medium">{title}</span>
            <span className="block truncate text-sm text-[#9fb0b5]">{t('chat.view_profile')}</span>
          </span>
        </button>

        <nav className="mt-4 space-y-1">
          {isAdmin ? (
            <>
              <MenuItem icon="fa-solid fa-shield-halved" label={t('navigation.admin_profile')} onClick={() => goTo('/admin_profile_react')} />
              <MenuItem icon="fa-solid fa-chart-line" label={t('navigation.admin_dashboard')} onClick={() => goTo('/admin')} />
            </>
          ) : null}
          <MenuItem icon="fa-solid fa-table-cells-large" label={t('navigation.dashboard')} onClick={() => goTo('/premium_dashboard')} />
          <MenuItem icon="fa-solid fa-user" label={t('navigation.my_profile')} onClick={() => goTo(profilePath)} />
          <MenuItem icon="fa-solid fa-user-group" label={t('navigation.followers')} onClick={() => goTo('/followers')} />
          <MenuItem icon="fa-solid fa-cube" label={t('navigation.subscriptions')} onClick={() => goTo('/subscription_plans')} />
          <MenuItem icon="fa-solid fa-gear" label={t('navigation.account_settings')} onClick={() => goTo('/account_settings')} />

          <div className="my-2 border-t border-white/10 pt-2">
            <button
              type="button"
              className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left text-white transition-colors hover:bg-white/5"
              onClick={(e) => {
                onClose()
                requestLogout(e)
              }}
            >
              <i className="fa-solid fa-right-from-bracket w-5 text-center text-white" />
              <span className="truncate">{t('navigation.logout')}</span>
            </button>
          </div>
        </nav>
      </div>
      <div className="h-full flex-1" onClick={onClose} />
    </div>
  )
}
