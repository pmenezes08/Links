/**
 * Per-history-entry scroll memory for native-style back navigation.
 *
 * Keyed by react-router's `location.key` (stable per history entry and re-used
 * on POP), so backing out of a drill-down restores the exact scroll offset the
 * user left — the single most-felt "native vs web" behaviour the app was
 * missing (every back-tap otherwise dumps you at the top of the list).
 *
 * Kept in memory (fast, survives client-side navigation) and mirrored to
 * `sessionStorage` so an in-session reload can still restore. Bounded to the
 * most recent `MAX_ENTRIES` entries so it can't grow unbounded across a long
 * session; evicting an entry also drops its sessionStorage mirror.
 */

const MAX_ENTRIES = 50
const SS_PREFIX = 'cpoint:scroll:'

const memory = new Map<string, number>()

function ssKey(key: string): string {
  return `${SS_PREFIX}${key}`
}

export function saveScrollPosition(key: string | undefined | null, top: number): void {
  if (!key || !Number.isFinite(top) || top < 0) return
  // Re-insert so the Map's iteration order tracks recency for the size bound.
  memory.delete(key)
  memory.set(key, top)
  if (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value
    if (oldest !== undefined) {
      memory.delete(oldest)
      try { sessionStorage.removeItem(ssKey(oldest)) } catch { /* ignore */ }
    }
  }
  try { sessionStorage.setItem(ssKey(key), String(Math.round(top))) } catch { /* private mode / quota */ }
}

export function getScrollPosition(key: string | undefined | null): number | null {
  if (!key) return null
  const mem = memory.get(key)
  if (typeof mem === 'number') return mem
  try {
    const raw = sessionStorage.getItem(ssKey(key))
    if (raw != null) {
      const n = Number(raw)
      if (Number.isFinite(n)) return n
    }
  } catch { /* ignore */ }
  return null
}

export function clearScrollPosition(key: string | undefined | null): void {
  if (!key) return
  memory.delete(key)
  try { sessionStorage.removeItem(ssKey(key)) } catch { /* ignore */ }
}

/** Test-only: reset the in-memory store (sessionStorage is left intact). */
export function __resetScrollMemoryForTests(): void {
  memory.clear()
}
