import { clearDeviceCache, readDeviceCacheStale, writeDeviceCache } from './deviceCache'

export const DASHBOARD_DEVICE_CACHE_KEY = 'dashboard-device-cache'
export const DASHBOARD_CACHE_TTL_MS = 5 * 60 * 1000
export const DASHBOARD_CACHE_VERSION = 'dashboard-v2'

export type DashboardCommunity = { id: number; name: string; type: string }

export type DashboardProfileSnapshot = {
  emailVerified: boolean | null
  emailVerifiedAt: string | null
  username: string
  firstName: string
  displayName: string
  subscription: string
  hasProfilePic: boolean
  existingProfilePic: string
}

export type DashboardCachePayload = {
  profile?: DashboardProfileSnapshot
  communities?: DashboardCommunity[]
  hasGymAccess?: boolean
  isAppAdmin?: boolean
}

export function getCachedDashboardSnapshot(): DashboardCachePayload | null {
  const { data } = readDeviceCacheStale<DashboardCachePayload>(DASHBOARD_DEVICE_CACHE_KEY, DASHBOARD_CACHE_VERSION)
  return data ?? null
}

export function writeDashboardCacheSnapshot(payload: DashboardCachePayload, ttlMs: number = DASHBOARD_CACHE_TTL_MS) {
  writeDeviceCache(DASHBOARD_DEVICE_CACHE_KEY, payload, ttlMs, DASHBOARD_CACHE_VERSION)
}

export function invalidateDashboardCache() {
  clearDeviceCache(DASHBOARD_DEVICE_CACHE_KEY)
}

export async function refreshDashboardCommunities(communities?: DashboardCommunity[]): Promise<DashboardCommunity[] | null> {
  try {
    let resolved = communities
    if (!resolved) {
      const resp = await fetch('/api/user_parent_community', { credentials: 'include' })
      const data = await resp.json().catch(() => null)
      if (!(data?.success && Array.isArray(data.communities))) {
        return null
      }
      resolved = data.communities
    }

    const cached = getCachedDashboardSnapshot()
    writeDashboardCacheSnapshot({
      profile: cached?.profile,
      hasGymAccess: cached?.hasGymAccess,
      isAppAdmin: cached?.isAppAdmin,
      communities: resolved,
    })

    return resolved
  } catch (error) {
    invalidateDashboardCache()
    return null
  }
}
