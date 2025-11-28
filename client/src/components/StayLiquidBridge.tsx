import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Device } from '@capacitor/device'
import { TabsBar, type TabsBarConfigureOptions } from 'stay-liquid'

interface TabBlueprint {
  id: string
  title: string
  systemIcon: string
  path: string
  matches: (pathname: string) => boolean
}

const TAB_BLUEPRINTS: TabBlueprint[] = [
  {
    id: 'home',
    title: 'Feed',
    systemIcon: 'sparkles',
    path: '/premium_dashboard',
    matches: (pathname) =>
      pathname === '/premium_dashboard' ||
      pathname === '/premium_dashboard_react' ||
      pathname === '/premium' ||
      pathname === '/home',
  },
  {
    id: 'messages',
    title: 'Chats',
    systemIcon: 'bubble.left.and.bubble.right.fill',
    path: '/user_chat',
    matches: (pathname) => pathname.startsWith('/user_chat'),
  },
  {
    id: 'compose',
    title: 'Create',
    systemIcon: 'square.and.pencil',
    path: '/compose',
    matches: (pathname) => pathname.startsWith('/compose') || pathname.startsWith('/post/new'),
  },
  {
    id: 'notifications',
    title: 'Alerts',
    systemIcon: 'bell.badge',
    path: '/notifications',
    matches: (pathname) => pathname.startsWith('/notifications'),
  },
  {
    id: 'profile',
    title: 'Profile',
    systemIcon: 'person.crop.circle',
    path: '/profile',
    matches: (pathname) =>
      pathname.startsWith('/profile') ||
      pathname.startsWith('/account_settings') ||
      pathname.startsWith('/account_settings_react'),
  },
]

const DEFAULT_TAB_ID = TAB_BLUEPRINTS[0]?.id ?? 'home'

function routeToTabId(pathname: string): string | null {
  const match = TAB_BLUEPRINTS.find((tab) => tab.matches(pathname))
  return match?.id ?? null
}

function tabIdToPath(tabId: string): string | null {
  const blueprint = TAB_BLUEPRINTS.find((tab) => tab.id === tabId)
  return blueprint?.path ?? null
}

const LIQUID_IOS_BUILD_THRESHOLD = 180000 // ios 18.0.0+
const LIQUID_OS_VERSION_THRESHOLD = 18

async function ensureTabsConfigured(initialId: string) {
  const config: TabsBarConfigureOptions = {
    visible: true,
    initialId: initialId || DEFAULT_TAB_ID,
    items: TAB_BLUEPRINTS.map(({ id, title, systemIcon }) => ({
      id,
      title,
      systemIcon,
    })),
    selectedIconColor: '#7FE7DF',
    unselectedIconColor: 'rgba(255,255,255,0.55)',
  }
  await TabsBar.configure(config)
}

function isLiquidGlassSupported(info: Awaited<ReturnType<typeof Device.getInfo>>): boolean {
  if (info.platform !== 'ios') return false
  const build = typeof info.iOSVersion === 'number' ? info.iOSVersion : undefined
  const osVersion =
    typeof info.osVersion === 'string'
      ? parseFloat(info.osVersion)
      : typeof info.osVersion === 'number'
        ? info.osVersion
        : undefined

  if (typeof build === 'number') {
    return build >= LIQUID_IOS_BUILD_THRESHOLD
  }
  if (typeof osVersion === 'number') {
    return osVersion >= LIQUID_OS_VERSION_THRESHOLD
  }
  return false
}

export default function StayLiquidBridge() {
  const location = useLocation()
  const navigate = useNavigate()
  const [supported, setSupported] = useState(false)
  const configuredRef = useRef(false)
  const removeListenerRef = useRef<(() => void) | null>(null)
  const lastSelectedRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function detectSupport() {
      try {
        const platform = Capacitor.getPlatform()
        console.log('[StayLiquid] platform detected:', platform)
        if (platform !== 'ios') {
          console.log('[StayLiquid] non-iOS platform, skipping native tabs')
          return
        }
        const info = await Device.getInfo()
        console.log('[StayLiquid] device info:', info)
        if (cancelled) return
        if (isLiquidGlassSupported(info)) {
          console.log('[StayLiquid] liquid glass supported – enabling bridge')
          setSupported(true)
        } else {
          console.log('[StayLiquid] iOS build below requirement, skipping')
        }
      } catch (error) {
        console.warn('[StayLiquid] Unable to detect device info', error)
      }
    }

    detectSupport()

    return () => {
      cancelled = true
      removeListenerRef.current?.()
      removeListenerRef.current = null
      TabsBar.hide().catch(() => {})
      configuredRef.current = false
      lastSelectedRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!supported || configuredRef.current) return
    let cancelled = false

    async function configure() {
      try {
        const initialId = routeToTabId(location.pathname) ?? DEFAULT_TAB_ID
        console.log('[StayLiquid] configuring tabs with initial id:', initialId)
        await ensureTabsConfigured(initialId)
        if (cancelled) return
        const listener = await TabsBar.addListener('selected', ({ id }) => {
          console.log('[StayLiquid] native tab selected:', id)
          const targetPath = tabIdToPath(id)
          if (!targetPath) return
          lastSelectedRef.current = id
          if (location.pathname.startsWith(targetPath)) return
          navigate(targetPath, { replace: false })
        })
        removeListenerRef.current = () => listener.remove()
        configuredRef.current = true
      } catch (error) {
        console.warn('[StayLiquid] configure failed', error)
      }
    }

    configure()

    return () => {
      cancelled = true
    }
  }, [supported, location.pathname, navigate])

  useEffect(() => {
    if (!supported || !configuredRef.current) return
    const tabId = routeToTabId(location.pathname)

    if (!tabId) {
      lastSelectedRef.current = null
      console.log('[StayLiquid] no tab match for route, hiding native bar')
      TabsBar.hide().catch(() => {})
      return
    }

    console.log('[StayLiquid] showing native bar for tab:', tabId)
    TabsBar.show().catch(() => {})
    if (lastSelectedRef.current !== tabId) {
      lastSelectedRef.current = tabId
      TabsBar.select({ id: tabId }).catch(() => {})
    }
  }, [location.pathname, supported])

  return null
}
