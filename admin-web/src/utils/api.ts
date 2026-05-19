const API_BASE = import.meta.env.VITE_API_BASE || ''

export async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    ...options,
  })
  return res
}

export async function apiJson<T = any>(path: string, options?: RequestInit): Promise<T> {
  const res = await api(path, options)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`)
  }
  return res.json()
}

export async function apiPost(path: string, body: any) {
  return apiJson(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/** Turn apiJson/apiPost failures into a short operator-visible message (parses JSON `error` from body). */
export function formatApiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  const raw = err.message
  const brace = raw.indexOf('{')
  if (brace >= 0) {
    try {
      const j = JSON.parse(raw.slice(brace)) as { error?: string }
      if (typeof j?.error === 'string' && j.error.trim()) return j.error.trim()
    } catch {
      /* ignore */
    }
  }
  return raw.length > 360 ? `${fallback}: ${raw.slice(0, 360)}…` : `${fallback}: ${raw}`
}
