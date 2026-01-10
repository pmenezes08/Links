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

export async function refreshDashboardCommunities(communities?: DashboardCommunity[], forceRefresh = false): Promise<DashboardCommunity[] | null> {
  try {
    let resolved: DashboardCommunity[] | null = communities ?? null
    if (!resolved) {
      // Add cache-busting when force refresh is requested
      const url = forceRefresh 
        ? `/api/user_parent_community?_nocache=${Date.now()}` 
        : '/api/user_parent_community'
      const resp = await fetch(url, { 
        credentials: 'include',
        cache: forceRefresh ? 'no-store' : 'default'
      })
      const data = await resp.json().catch(() => null)
      if (!(data?.success && Array.isArray(data.communities))) {
        return null
      }
      resolved = data.communities ?? []
    }

    const communitiesSnapshot = resolved ?? []
    const cached = getCachedDashboardSnapshot()
    writeDashboardCacheSnapshot({
      profile: cached?.profile,
      hasGymAccess: cached?.hasGymAccess,
      isAppAdmin: cached?.isAppAdmin,
      communities: communitiesSnapshot,
    })

    return communitiesSnapshot
  } catch (error) {
    invalidateDashboardCache()
    return null
  }
}
