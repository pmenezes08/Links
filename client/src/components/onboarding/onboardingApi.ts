/**
 * HTTP layer for the onboarding chat wizard.
 *
 * Every fetch the flow makes lives here as a plain async function with
 * explicit params — request shapes, headers, and response handling moved
 * verbatim from `pages/OnboardingChat.tsx`.
 *
 * Error-handling convention (preserved from the page):
 * - Fire-and-forget saves (`saveField`, `saveOnboardingState`, …) swallow
 *   errors internally, exactly like the original inline try/catch did.
 * - Calls whose failure drives flow decisions (bootstrap, compose_bio,
 *   resolve_*, parse_cv, …) throw on network error so the caller's own
 *   catch branch runs, exactly like the original inline fetch did.
 */

import type { Collected, ProfileSection, Stage } from './types'

// Responses are treated exactly like the page's original inline
// `await r.json().catch(() => null)` — loosely typed, null on parse failure.
type Json = any

async function parseJson(r: Response): Promise<Json> {
  return r.json().catch(() => null)
}

export async function saveField(field: string, value: string): Promise<void> {
  try {
    await fetch('/api/onboarding/save_field', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field, value }),
    })
  } catch {}
}

export async function saveOnboardingState(
  s: Stage,
  c: Collected,
  opts: {
    isSectionOnly: boolean
    sectionOnlyTarget: ProfileSection
    onboardingIntent?: 'b2b' | 'b2c' | null
  },
): Promise<void> {
  try {
    // Section-only runs boot from /api/profile_me, not from the saved
    // onboarding state: the other section's answers are locally '' and
    // its completion flag is locally faked so the flow skips it. Those
    // local conveniences must never persist — the Firestore merge would
    // (a) mark the untouched section complete server-side, killing every
    // future prompt for it, and (b) blank previously saved verbatim
    // answers in Steve's KB (merge copies keys when present, '' included).
    // Strip them from the payload; the server keeps what it already has.
    let payloadCollected: Record<string, unknown> = c as unknown as Record<string, unknown>
    if (opts.isSectionOnly) {
      const sanitized: Record<string, unknown> = { ...payloadCollected }
      if (opts.sectionOnlyTarget === 'professional') {
        delete sanitized.personalSectionComplete
        for (const key of ['talkAllDay', 'reachOut', 'journey', 'recommend'] as const) {
          if (!String(sanitized[key] ?? '').trim()) delete sanitized[key]
        }
      } else {
        delete sanitized.professionalSectionComplete
        for (const key of ['professionalAssociations', 'professionalStrengths'] as const) {
          if (!String(sanitized[key] ?? '').trim()) delete sanitized[key]
        }
      }
      payloadCollected = sanitized
    }
    const body: Record<string, unknown> = {
      stage: s,
      collected: payloadCollected,
      onboarding_auto_open_suppressed: false,
    }
    if (opts.onboardingIntent) body.onboarding_intent = opts.onboardingIntent
    await fetch('/api/onboarding/state', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {}
}

export async function fetchTierHints(): Promise<Json> {
  const tr = await fetch('/api/onboarding/tier_hints', {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  return parseJson(tr)
}

export async function fetchProfileMe(): Promise<Json> {
  const pr = await fetch('/api/profile_me', { credentials: 'include', headers: { Accept: 'application/json' } })
  return parseJson(pr)
}

export async function fetchOnboardingState(): Promise<Json> {
  const r = await fetch('/api/onboarding/state', { credentials: 'include' })
  return parseJson(r)
}

export async function markResumeWelcomeShown(
  resumeStage: Stage,
  savedCollected: Collected,
  onboardingIntent?: 'b2b' | 'b2c' | null,
): Promise<void> {
  try {
    await fetch('/api/onboarding/state', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: resumeStage,
        collected: savedCollected,
        resume_welcome_shown: true,
        onboarding_auto_open_suppressed: false,
        onboarding_intent: onboardingIntent || undefined,
      }),
    })
  } catch {}
}

export async function bootstrapCommunities(
  parentName: string,
  parentType: string,
  childNames: string[],
): Promise<Json> {
  const r = await fetch('/api/onboarding/bootstrap_communities', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parent_name: parentName,
      parent_type: parentType,
      child_names: childNames,
    }),
  })
  return parseJson(r)
}

export interface ComposeBioBody {
  kind: 'personal' | 'professional'
  talk_all_day: string
  recommend: string
  reach_out: string
  journey: string
  role: string
  company: string
  professional_associations: string
  professional_strengths: string
  city: string
  country: string
  style?: 'more_natural' | 'shorter' | 'more_professional'
  current_bio: string
  opposite_bio: string
  existing_bio: string
  reuse_company_intel: string
}

export async function composeBioRequest(body: ComposeBioBody): Promise<Json> {
  const r = await fetch('/api/onboarding/compose_bio', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return parseJson(r)
}

export async function saveCompleteWithEnrichment(
  collected: Collected,
  acceptedEnrichment: string[],
): Promise<void> {
  try {
    await fetch('/api/onboarding/state', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        stage: 'complete',
        collected,
        acceptedEnrichment,
      }),
    })
  } catch {}
}

export async function deferProfile(
  payload: {
    stage: Stage
    collected: Collected
    messages: { from: 'steve' | 'user'; text: string }[]
  },
  signal: AbortSignal,
): Promise<{ ok: boolean; j: Json }> {
  const r = await fetch('/api/onboarding/defer_profile', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      stage: payload.stage,
      collected: payload.collected,
      messages: payload.messages,
      onboarding_auto_open_suppressed: true,
    }),
  })
  return { ok: r.ok, j: await parseJson(r) }
}

export async function applyProfessionalStructured(c: Collected): Promise<{ ok: boolean; j: Json }> {
  const r = await fetch('/api/onboarding/apply_professional_structured', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      role: c.role || '',
      company: c.company || '',
      current_role_start_ym: c.currentRoleStartYm || '',
      work_history: c.workHistory || [],
      professional_about: (c.professionalBio || '').trim(),
    }),
  })
  return { ok: r.ok, j: await parseJson(r) }
}

export async function resolveLocation(city: string): Promise<Json> {
  const r = await fetch('/api/onboarding/resolve_location', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ city }),
  })
  return parseJson(r)
}

export async function resolveRole(text: string): Promise<Json> {
  const r = await fetch('/api/onboarding/resolve_role', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  return parseJson(r)
}

export async function saveSocialLinks(links: { platform: string; url: string }[]): Promise<void> {
  try {
    await fetch('/api/onboarding/social_links', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socialProvidedLinks: links }),
    })
  } catch {}
}

export async function completeOnboardingRequest(): Promise<void> {
  try {
    await fetch('/api/onboarding/complete', { method: 'POST', credentials: 'include' })
  } catch {}
}

export async function redirectOffScript(
  message: string,
  stage: Stage,
  currentQuestion: string,
): Promise<Json> {
  const r = await fetch('/api/onboarding/redirect', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      stage,
      currentQuestion,
    }),
  })
  return parseJson(r)
}

export async function uploadProfilePicture(picFile: File): Promise<{ ok: boolean; j: Json }> {
  const fd = new FormData()
  fd.append('profile_picture', picFile)
  const r = await fetch('/upload_profile_picture', { method: 'POST', credentials: 'include', body: fd })
  return { ok: r.ok, j: await parseJson(r) }
}

export async function parseCvUpload(cvFile: File): Promise<{ ok: boolean; j: Json }> {
  const fd = new FormData()
  fd.append('file', cvFile)
  const r = await fetch('/api/onboarding/parse_cv?persist=1', { method: 'POST', credentials: 'include', body: fd })
  return { ok: r.ok, j: await parseJson(r) }
}
