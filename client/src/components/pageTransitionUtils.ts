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
    path.startsWith('/post/')
  )
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
  if (!isPilotRoute(prevPath) || !isPilotRoute(nextPath)) return 'none'
  if (navType === 'POP') return 'pop'
  return 'push'
}
