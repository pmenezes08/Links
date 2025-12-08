import { triggerDashboardServerPull } from './serverPull'
import { refreshDashboardCommunities } from './dashboardCache'

/**
 * Internal Link Handler
 * Intercepts links to app.c-point.co and handles them within the app
 * instead of opening in Safari/browser.
 * 
 * www.c-point.co links open in browser (landing page)
 * app.c-point.co links are handled internally
 */

// Domains that should be handled internally (app subdomain only)
const INTERNAL_DOMAINS = [
  'app.c-point.co',
]

// Domains that should open in external browser (landing page)
const EXTERNAL_DOMAINS = [
  'c-point.co',
  'www.c-point.co',
]

export interface InviteResult {
  success: boolean
  communityId?: number
  communityName?: string
  error?: string
  alreadyMember?: boolean
}

/**
 * Check if a URL should be handled internally (app.c-point.co only)
 */
export function isInternalLink(url: string): boolean {
  try {
    const parsed = new URL(url)
    return INTERNAL_DOMAINS.some(domain => 
      parsed.hostname === domain
    )
  } catch {
    return false
  }
}

/**
 * Check if a URL is a landing page link (www.c-point.co)
 * These should open in external browser
 */
export function isLandingPageLink(url: string): boolean {
  try {
    const parsed = new URL(url)
    return EXTERNAL_DOMAINS.some(domain => 
      parsed.hostname === domain
    )
  } catch {
    return false
  }
}

/**
 * Extract the invite token from a URL if present
 */
export function extractInviteToken(url: string): string | null {
  try {
    const parsed = new URL(url)
    // Check for both /login?invite=TOKEN and /signup?invite=TOKEN patterns
    const inviteParam = parsed.searchParams.get('invite')
    if (inviteParam) {
      return inviteParam
    }
    return null
  } catch {
    return null
  }
}

/**
 * Extract the internal path from a c-point.co URL
 */
export function extractInternalPath(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (!isInternalLink(url)) return null
    // Return the pathname + search params
    return parsed.pathname + parsed.search
  } catch {
    return null
  }
}

/**
 * Join a community using an invite token
 */
export async function joinCommunityWithInvite(token: string): Promise<InviteResult> {
  try {
    const response = await fetch('/api/join_with_invite', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({ invite_token: token }),
    })

    const data = await response.json()

    if (response.ok && data.success) {
      await triggerDashboardServerPull()
      await refreshDashboardCommunities()
      return {
        success: true,
        communityId: data.community_id,
        communityName: data.community_name,
      }
    }

    // Check if already a member
    if (data.error?.includes('already a member')) {
      // Try to get community info from the token
      const infoResponse = await fetch('/api/invite_info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invite_token: token }),
      })
      const infoData = await infoResponse.json()
      
      return {
        success: false,
        alreadyMember: true,
        communityId: infoData.community_id,
        communityName: infoData.community_name,
        error: 'You are already a member of this community',
      }
    }

    return {
      success: false,
      error: data.error || 'Failed to join community',
    }
  } catch (error) {
    console.error('Error joining community:', error)
    return {
      success: false,
      error: 'Network error. Please try again.',
    }
  }
}

/**
 * Handle an internal link click
 * Returns the path to navigate to, or null if the link should be opened externally
 */
export async function handleInternalLink(
  url: string,
  navigate: (path: string) => void,
  showToast?: (message: string, type: 'success' | 'error' | 'info') => void,
  showJoinModal?: (communityName: string, communityId: number) => void
): Promise<{ handled: boolean; navigateTo?: string }> {
  if (!isInternalLink(url)) {
    return { handled: false }
  }

  const inviteToken = extractInviteToken(url)
  
  if (inviteToken) {
    // Handle invite link - join the community directly
    const result = await joinCommunityWithInvite(inviteToken)
    
    if (result.success && result.communityId) {
      // Show success modal/toast and navigate to community
      if (showJoinModal && result.communityName) {
        showJoinModal(result.communityName, result.communityId)
      } else if (showToast) {
        showToast(`Welcome to ${result.communityName}!`, 'success')
      }
      navigate(`/community_feed_react/${result.communityId}`)
      return { handled: true, navigateTo: `/community_feed_react/${result.communityId}` }
    } else if (result.alreadyMember && result.communityId) {
      // Already a member - just navigate to the community
      if (showToast) {
        showToast('You are already a member of this community', 'info')
      }
      navigate(`/community_feed_react/${result.communityId}`)
      return { handled: true, navigateTo: `/community_feed_react/${result.communityId}` }
    } else {
      // Error joining
      if (showToast) {
        showToast(result.error || 'Failed to join community', 'error')
      }
      return { handled: true }
    }
  }

  // For other internal links, just navigate to the path
  const internalPath = extractInternalPath(url)
  if (internalPath) {
    navigate(internalPath)
    return { handled: true, navigateTo: internalPath }
  }

  return { handled: false }
}
