import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * B2B landing rule: a member of exactly one community should open the app
 * inside that community, not on the dashboard. The redirect fires at most
 * once per session so the bottom-nav dashboard tab keeps working
 * (sessionStorage survives in-app navigation but resets on app relaunch).
 */
const LANDING_DECIDED_KEY = 'cpoint_single_community_landing_done'

type SingleCommunityLandingArgs = {
  /** All data gates: communities + pending invites loaded, email verified, no ?invite_prompt=1. */
  ready: boolean
  communities: Array<{ id: number }>
  hasPendingInvites: boolean
  /** Onboarding overlays / create-community modal — never redirect from under them. */
  overlayActive: boolean
}

function landingAlreadyDecided(): boolean {
  try {
    return sessionStorage.getItem(LANDING_DECIDED_KEY) === '1'
  } catch {
    return false
  }
}

function markLandingDecided(): void {
  try {
    sessionStorage.setItem(LANDING_DECIDED_KEY, '1')
  } catch {}
}

export function useSingleCommunityLanding({
  ready,
  communities,
  hasPendingInvites,
  overlayActive,
}: SingleCommunityLandingArgs): void {
  const navigate = useNavigate()
  const decidedRef = useRef(landingAlreadyDecided())

  useEffect(() => {
    if (decidedRef.current) return
    if (!ready || overlayActive) return

    decidedRef.current = true
    markLandingDecided()

    if (hasPendingInvites) return
    if (communities.length !== 1) return
    const targetId = communities[0]?.id
    if (!targetId) return
    navigate(`/community_feed_react/${targetId}`, { replace: true })
  }, [ready, overlayActive, hasPendingInvites, communities, navigate])
}
