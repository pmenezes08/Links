/**
 * Service-worker cache routing tests (PR 1).
 *
 * Account isolation depends on the SW staying out of every authenticated
 * request. These tests assert `shouldBypassCache` rejects the entire
 * authenticated/dynamic surface area while still allowing static assets to
 * be cached. They are the JS-side mirror of `tests/test_http_headers.py`.
 *
 * If you add a new authenticated route family, add a representative path
 * here AND in the SW prefix list (`client/public/sw.js` `NEVER_CACHE_PREFIXES`
 * + `client/src/utils/swCachePolicy.ts` `NEVER_CACHE_PREFIXES`).
 */

import { describe, expect, it } from 'vitest'

import { NEVER_CACHE_PREFIXES, shouldBypassCache } from './swCachePolicy'

const AUTHENTICATED_PATHS = [
  '/api/me/entitlements',
  '/api/me/billing',
  '/api/me/billing/portal',
  '/api/me/ai-usage',
  '/api/me/enterprise-seats',
  '/api/me/iap-nag',
  '/api/me/winback',
  '/api/me/steve/reminders',
  '/api/chat_threads',
  '/api/group_chat/list',
  '/api/group_chat/42/messages',
  '/api/notifications',
  '/api/notifications/check',
  '/api/notifications/badge-count',
  '/api/profile_me',
  '/api/profile/joao',
  '/api/check_admin',
  '/api/admin/users',
  '/api/admin/dashboard',
  '/api/admin/subscriptions/users',
  '/api/admin/enterprise/seats',
  '/api/communities/123/billing',
  '/api/stripe/checkout_status',
  '/api/onboarding/state',
  '/api/community/manageable',
  '/api/community/invites/pending',
  '/api/followers',
  '/api/followers_feed',
  '/api/dashboard_unread_feed',
  '/api/user_communities_hierarchical',
  '/api/premium_dashboard_summary',
  '/get_messages',
  '/get_user_communities_with_members',
  '/check_unread_messages',
  '/check_profile_picture',
  '/update_email',
  '/update_password',
  '/update_public_profile',
  '/delete_account',
  '/delete_chat',
  '/upload_logo',
  '/upload_signup_image',
  '/admin/regenerate_app_icons',
  '/admin',
  '/admin_dashboard',
  '/admin_profile_react',
  '/profile/joao',
  '/notifications',
  '/event/12/rsvp',
  '/account_settings',
  '/edit_profile',
  '/business_login',
  '/business_logout',
  '/remove_community_member',
  '/resend_verification',
  '/clear_onboarding_storage',
  '/verify_required',
  '/logout',
  '/login',
  '/signup',
]

const STATIC_PATHS = [
  '/',
  '/welcome',
  '/static/logo.png',
  '/static/icons/icon-192.png',
  '/uploads/abc.mp4',
  '/manifest.webmanifest',
  '/sw.js',
  '/assets/index-abc.js',
  '/favicon.svg',
  '/apple-touch-icon.png',
]

describe('shouldBypassCache', () => {
  it.each(AUTHENTICATED_PATHS)('bypasses cache for %s', (path) => {
    expect(shouldBypassCache(path)).toBe(true)
  })

  it.each(STATIC_PATHS)('lets the SW cache %s', (path) => {
    expect(shouldBypassCache(path)).toBe(false)
  })
})

describe('NEVER_CACHE_PREFIXES', () => {
  it('has no duplicates', () => {
    const set = new Set(NEVER_CACHE_PREFIXES)
    expect(set.size).toBe(NEVER_CACHE_PREFIXES.length)
  })

  it('uses lowercase prefixes only', () => {
    for (const prefix of NEVER_CACHE_PREFIXES) {
      expect(prefix).toBe(prefix.toLowerCase())
    }
  })

  it('starts every prefix with a forward slash', () => {
    for (const prefix of NEVER_CACHE_PREFIXES) {
      expect(prefix.startsWith('/')).toBe(true)
    }
  })
})
