import { isPremiumDashboardPath, isAboutCPointPath } from './DashboardBottomNav'

export type TransitionType = 'push' | 'pop' | 'tab' | 'none'

export function isDashboardTabPath(path: string): boolean {
  return isPremiumDashboardPath(path) || path === '/feed' || isAboutCPointPath(path)
}

/** Pilot routes that participate in push/pop transitions (staging flag). */
export function isPilotRoute(path: string): boolean {
  return (
    isDashboardTabPath(path) ||
    path.startsWith('/community_feed_react/') ||
    path.startsWith('/post/') ||
    path.startsWith('/steve/profile-builder/')
  )
}

/**
 * Top-level tab destinations that a back-tap from a deep drill-down route may
 * land on. Broader than `isDashboardTabPath` (which only covers the pilot
 * dashboard cross-fade set): this list is used purely to decide whether a
 * multi-step `POP` should animate as a pop slide.
 *
 * Chat threads (e.g. `/user_chat/chat/:username`) are intentionally excluded
 * — chat surface transitions are deferred to a future pilot wave.
 */
const POP_TAB_ROOT_PATHS: ReadonlySet<string> = new Set([
  '/dashboard',
  '/premium_dashboard',
  '/premium',
  '/premium_dashboard_react',
  '/feed',
  '/about',
  '/about_cpoint',
  '/communities',
  '/networking',
  '/notifications',
  '/messages',
  '/user_chat',
])

export function isTabRootPath(path: string): boolean {
  return POP_TAB_ROOT_PATHS.has(path)
}

/**
 * Deep drill-down routes that descend from a tab root. A back-tap from one of
 * these toward a tab root or another drill-down should slide as `pop` even
 * when the user skipped intermediate history entries (e.g. Post → Tab,
 * skipping Community feed).
 *
 * Excludes chat threads on purpose — see `POP_TAB_ROOT_PATHS` note.
 */
export function isDeepDrillDownRoute(path: string): boolean {
  if (path.startsWith('/post/')) return true
  if (path.startsWith('/community_feed_react/')) return true
  if (path.startsWith('/group_feed_react/')) return true
  if (path.startsWith('/reply/')) return true
  if (path.startsWith('/group_reply/')) return true
  if (/^\/community\/[^/]+\/feed(?:\/|$)/.test(path)) return true
  if (path.startsWith('/steve/profile-builder/')) return true
  return false
}

export function detectTransitionType(
  prevPath: string,
  nextPath: string,
  navType: 'POP' | 'PUSH' | 'REPLACE',
  transitionsEnabled: boolean,
): TransitionType {
  if (!transitionsEnabled) return 'none'
  if (prevPath === nextPath) return 'none'
  if (isDashboardTabPath(prevPath) && isDashboardTabPath(nextPath)) return 'tab'

  // Multi-step pop: leaving a deep drill-down route via the browser/native
  // back stack should slide as `pop` whether the destination is a tab root
  // or another drill-down ancestor — even if it isn't the immediate parent
  // (e.g. Post → Tab skipping Community feed, Reply → Community feed).
  if (navType === 'POP' && isDeepDrillDownRoute(prevPath)) {
    if (isTabRootPath(nextPath) || isDeepDrillDownRoute(nextPath)) {
      return 'pop'
    }
  }

  // Programmatic jump from a drill-down to a tab root (e.g. user typed a tab
  // URL while on a Post page) must not push-slide — it isn't a forward drill.
  if (navType === 'PUSH' && isDeepDrillDownRoute(prevPath) && isTabRootPath(nextPath)) {
    return 'none'
  }

  if (!isPilotRoute(prevPath) || !isPilotRoute(nextPath)) return 'none'
  if (navType === 'POP') return 'pop'
  return 'push'
}
