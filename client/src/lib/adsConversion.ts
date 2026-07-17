// Google Ads conversion wiring for the paid-acquisition funnel.
//
// Scope guards (all must hold or this module does nothing):
//  - web only: the tag must never load inside the iOS/Android shells;
//  - production host only: dev/staging sessions send nothing to Google.
//
// EEA consent: the landing page (www.c-point.co) shows a consent banner and
// stores the choice in a `cp_ads_consent` cookie on `.c-point.co`, which this
// app inherits. Consent Mode defaults to denied; we upgrade to granted only
// when that cookie says so. With consent denied gtag sends cookieless pings
// and the conversion is effectively unattributed — that is the intended,
// compliance-first behaviour.

import { Capacitor } from '@capacitor/core'

const ADS_TAG_ID = 'AW-18311361204'

// Conversion label of the "community created" action (Google Ads → Goals →
// Conversions → Tag setup → event snippet `send_to`). Empty disables the fire.
const COMMUNITY_CREATED_LABEL = 'qWAVCKC71s0cELTlxJtE'
// Add the label from Google Ads → Goals → Conversions before campaign launch.
// Empty keeps registration fully functional while disabling this conversion.
const SIGNUP_COMPLETED_LABEL = ''

const PROD_HOSTS = new Set(['app.c-point.co'])
const CONSENT_COOKIE = 'cp_ads_consent'
const PENDING_SIGNUP_KEY = 'cpoint:ads:pending-signup-username'
const SIGNUP_DEDUP_PREFIX = 'cpoint:ads:signup-conversion:'

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

function shouldRun(): boolean {
  try {
    if (Capacitor.isNativePlatform()) return false
    return PROD_HOSTS.has(window.location.hostname)
  } catch {
    return false
  }
}

function hasAdsConsent(): boolean {
  try {
    return document.cookie.split('; ').includes(`${CONSENT_COOKIE}=granted`)
  } catch {
    return false
  }
}

/** Load the Google Ads tag (web + prod only). Safe to call more than once. */
export function initAdsTag(): void {
  if (!shouldRun()) return
  if (typeof window.gtag === 'function') return

  window.dataLayer = window.dataLayer || []
  // Google's tag requires the Arguments object (not a real array) on the layer.
  function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }
  window.gtag = gtag as unknown as (...args: unknown[]) => void

  window.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  })
  if (hasAdsConsent()) {
    window.gtag('consent', 'update', {
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    })
  }
  window.gtag('js', new Date())
  window.gtag('config', ADS_TAG_ID)

  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${ADS_TAG_ID}`
  document.head.appendChild(s)
}

/**
 * Report a top-level community creation to Google Ads. Fire-and-forget:
 * never throws, no-ops off web/prod or until the conversion label is set.
 */
export function trackCommunityCreatedConversion(): void {
  try {
    if (!shouldRun() || !COMMUNITY_CREATED_LABEL) return
    if (typeof window.gtag !== 'function') return
    window.gtag('event', 'conversion', {
      send_to: `${ADS_TAG_ID}/${COMMUNITY_CREATED_LABEL}`,
      value: 1.0,
      currency: 'EUR',
    })
  } catch {
    /* analytics must never break product flow */
  }
}

function normalizedUsername(username: string): string {
  return username.trim().toLowerCase()
}

/** Remember an email signup until verification creates and authenticates it. */
export function markPendingSignupConversion(username: string): void {
  const normalized = normalizedUsername(username)
  if (!normalized) return
  try {
    localStorage.setItem(PENDING_SIGNUP_KEY, normalized)
  } catch {
    /* storage is best-effort */
  }
}

/** Report a newly authenticated account once per username and browser. */
export function trackSignupConversion(username: string): boolean {
  try {
    const normalized = normalizedUsername(username)
    if (!normalized || !shouldRun() || !SIGNUP_COMPLETED_LABEL) return false
    if (typeof window.gtag !== 'function') return false
    const dedupKey = `${SIGNUP_DEDUP_PREFIX}${normalized}`
    if (localStorage.getItem(dedupKey) === '1') return false
    window.gtag('event', 'conversion', {
      send_to: `${ADS_TAG_ID}/${SIGNUP_COMPLETED_LABEL}`,
      value: 1.0,
      currency: 'EUR',
    })
    localStorage.setItem(dedupKey, '1')
    return true
  } catch {
    /* analytics must never break product flow */
    return false
  }
}

/**
 * Complete an email signup conversion only when the authenticated profile
 * matches the username whose registration was waiting for verification.
 */
export function trackPendingSignupConversion(username: string): void {
  try {
    const normalized = normalizedUsername(username)
    if (!normalized) return
    const pending = localStorage.getItem(PENDING_SIGNUP_KEY)
    if (pending !== normalized) return
    localStorage.removeItem(PENDING_SIGNUP_KEY)
    trackSignupConversion(normalized)
  } catch {
    /* analytics must never break product flow */
  }
}
