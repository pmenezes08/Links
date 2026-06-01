import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

export type Theme = 'dark' | 'light'
export type ThemePreference = Theme | 'system'

interface ThemeContextValue {
  theme: Theme
  preference: ThemePreference
  setPreference: (p: ThemePreference) => void
  /** @deprecated Use setPreference instead. Kept for backward compat. */
  setTheme: (t: Theme) => void
}

const STORAGE_KEY = 'cpoint:theme'
const DEFAULT_THEME: Theme = 'dark'

/**
 * Mobile browser chrome color — kept in lockstep with the canvas
 * tokens documented in `docs/LIGHT_MODE_TOKENS.md` (`--c-bg-app`).
 * Native shells (Capacitor) sync via `useNativeStatusBar`; this map
 * is for the PWA / mobile web fallback (`<meta name="theme-color">`).
 */
const META_THEME_COLOR: Record<Theme, string> = {
  dark: '#000000',
  light: '#FAFBFC',
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME,
  preference: DEFAULT_THEME,
  setPreference: () => {},
  setTheme: () => {},
})

function getSystemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return DEFAULT_THEME
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(pref: ThemePreference): Theme {
  if (pref === 'system') return getSystemTheme()
  return pref
}

function getStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'dark' || stored === 'light' || stored === 'system') {
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return DEFAULT_THEME
}

function applyMetaThemeColor(theme: Theme): void {
  if (typeof document === 'undefined') return
  const color = META_THEME_COLOR[theme]
  let tag = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = 'theme-color'
    document.head.appendChild(tag)
  }
  if (tag.content !== color) {
    tag.content = color
  }
  // `color-scheme` hints the browser/UA to render form controls,
  // scrollbars, and PWA chrome with the correct polarity.
  document.documentElement.style.colorScheme = theme
}

function applyThemeToDOM(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  applyMetaThemeColor(theme)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredPreference)
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme(getStoredPreference()))
  const mqlRef = useRef<MediaQueryList | null>(null)

  const setPreference = useCallback((newPref: ThemePreference) => {
    setPreferenceState(newPref)
    const resolved = resolveTheme(newPref)
    setThemeState(resolved)
    applyThemeToDOM(resolved)
    try {
      localStorage.setItem(STORAGE_KEY, newPref)
    } catch {
      // localStorage unavailable
    }
  }, [])

  const setTheme = useCallback((t: Theme) => {
    setPreference(t)
  }, [setPreference])

  // Listen to OS theme changes when preference is 'system'
  useEffect(() => {
    if (preference !== 'system') return
    if (typeof window === 'undefined' || !window.matchMedia) return

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mqlRef.current = mql

    const handler = () => {
      const resolved = resolveTheme('system')
      setThemeState(resolved)
      applyThemeToDOM(resolved)
    }

    mql.addEventListener('change', handler)
    return () => {
      mql.removeEventListener('change', handler)
      mqlRef.current = null
    }
  }, [preference])

  // Sync DOM on mount
  useEffect(() => {
    applyThemeToDOM(theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, preference, setPreference, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}
