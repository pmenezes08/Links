import type { EntitlementsError } from './entitlementsError'
import { mentionsSteve } from './steveClientGate'

type EntitlementsHandler = {
  handleResponse: <T = unknown>(res: Response) => Promise<T | null>
}

type StevePreflightResult = {
  ok: boolean
  error?: string
}

type StevePreflightArgs = {
  text: string
  communityId?: number | string | null
  postId?: number | string | null
  entitlementsHandler: EntitlementsHandler
}

export async function preflightSteveMention(args: StevePreflightArgs): Promise<StevePreflightResult> {
  if (!mentionsSteve(args.text)) return { ok: true }

  const response = await fetch('/api/ai/steve_preflight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      user_message: args.text,
      community_id: args.communityId ?? null,
      post_id: args.postId ?? null,
    }),
  })

  const data = await args.entitlementsHandler.handleResponse<{
    success?: boolean
    error?: string
  } | EntitlementsError>(response)

  if (!data) return { ok: false }
  if (data.success === false) return { ok: false, error: data.error || 'Steve is not available for this post.' }
  return { ok: true }
}
