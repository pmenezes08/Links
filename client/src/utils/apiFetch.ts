// client/src/utils/apiFetch.ts
//
// Resilient fetch wrapper for the app's same-origin API calls on weak
// networks. Raw `fetch()` has no timeout (a GET in a tunnel hangs on the
// OS default, ~30–120s, showing an infinite spinner) and no retry (one
// dropped packet => dead screen). This wrapper adds:
//
//   - AbortController timeout (default 10s; composed with any caller signal)
//   - exponential-backoff-with-full-jitter retry on transient failures
//     (network error / 5xx) — GET-only by default; opt-in `idempotent`
//     for client_key-guarded sends. NEVER retries 4xx (401/403/entitlements
//     must surface immediately, not be masked).
//   - in-flight dedup: identical concurrent GETs share one network call.
//
// It returns the native `Response`, so call sites only swap `fetch(` for
// `apiFetch(` and keep their existing `.json()` handling. The locale-header
// monkey-patch in i18n/fetchHeaders.ts still applies ambiently (it patches
// window.fetch, which this calls).
//
// Reference: components/LinkPreview.tsx (timeout + dedup) is the prior art.

export interface ApiFetchOptions extends RequestInit {
  /** Per-request timeout in ms before the request is aborted. Default 10000. */
  timeoutMs?: number
  /**
   * Max retry attempts on a transient failure (network error / 5xx).
   * Defaults to 2 for GET (and for any request flagged `idempotent`), 0 otherwise.
   */
  retries?: number
  /** Allow retrying a non-GET request — only for sends that dedup on a client_key. */
  idempotent?: boolean
  /** Disable in-flight dedup for an idempotent GET (default: dedup enabled). */
  dedupe?: boolean
  /** Backoff base in ms (mainly for tests). Default 400. */
  backoffBaseMs?: number
}

/** Thrown when a request is aborted by our own timeout (not by the caller). */
export class ApiFetchError extends Error {
  readonly isTimeout: boolean
  readonly cause?: unknown
  constructor(message: string, opts?: { cause?: unknown; isTimeout?: boolean }) {
    super(message)
    this.name = 'ApiFetchError'
    this.isTimeout = opts?.isTimeout ?? false
    this.cause = opts?.cause
  }
}

const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_BACKOFF_BASE_MS = 400
const MAX_BACKOFF_MS = 4_000

/** url -> shared in-flight promise, so concurrent identical GETs hit the network once. */
const inFlightGets = new Map<string, Promise<Response>>()

function isOfflineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Full-jitter backoff: random delay in [0, min(MAX, base * 2^attempt)). */
function backoffDelay(attempt: number, base: number): number {
  const ceiling = Math.min(MAX_BACKOFF_MS, base * 2 ** attempt)
  return Math.random() * ceiling
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return (input as Request).url
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const callerSignal = init.signal ?? undefined
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (err) {
    if (timedOut) throw new ApiFetchError('Request timed out', { cause: err, isTimeout: true })
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  cfg: { timeoutMs: number; maxRetries: number; backoffBase: number },
): Promise<Response> {
  let attempt = 0
  for (;;) {
    try {
      const res = await fetchWithTimeout(input, init, cfg.timeoutMs)
      // Retry only server errors (5xx); never 4xx.
      if (res.status >= 500 && attempt < cfg.maxRetries && !isOfflineNow()) {
        attempt += 1
        await sleep(backoffDelay(attempt, cfg.backoffBase))
        continue
      }
      return res
    } catch (err) {
      // A caller-initiated abort is intentional — never retry it.
      const callerAborted = init.signal?.aborted && !(err instanceof ApiFetchError && err.isTimeout)
      if (callerAborted) throw err
      // Don't burn retries while truly offline; fail fast so the UI can show
      // an offline/retry affordance instead of hanging.
      if (attempt < cfg.maxRetries && !isOfflineNow()) {
        attempt += 1
        await sleep(backoffDelay(attempt, cfg.backoffBase))
        continue
      }
      throw err
    }
  }
}

/**
 * Resilient same-origin fetch. Drop-in for `fetch(input, init)` on app API calls.
 * Returns the native Response; throws on network error / timeout (after retries).
 */
export function apiFetch(input: RequestInfo | URL, options: ApiFetchOptions = {}): Promise<Response> {
  const { timeoutMs, retries, idempotent, dedupe, backoffBaseMs, ...init } = options
  const method = (init.method ?? 'GET').toUpperCase()
  const cfg = {
    timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRetries: retries ?? (method === 'GET' || idempotent ? 2 : 0),
    backoffBase: backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS,
  }
  // App API calls are same-origin and cookie-authed; default credentials accordingly.
  const passInit: RequestInit = { ...init, method, credentials: init.credentials ?? 'include' }

  const canDedupe = method === 'GET' && dedupe !== false && !passInit.body
  if (!canDedupe) {
    return fetchWithRetry(input, passInit, cfg)
  }

  const key = `GET ${urlOf(input)}`
  const existing = inFlightGets.get(key)
  if (existing) return existing.then(r => r.clone())

  const shared = fetchWithRetry(input, passInit, cfg).finally(() => {
    inFlightGets.delete(key)
  })
  inFlightGets.set(key, shared)
  // Each awaiter gets its own clone so every caller can read the body independently.
  return shared.then(r => r.clone())
}

/** Convenience: apiFetch + JSON parse. Returns null if the body isn't valid JSON. */
export async function apiFetchJson<T = unknown>(
  input: RequestInfo | URL,
  options: ApiFetchOptions = {},
): Promise<T | null> {
  const res = await apiFetch(input, options)
  return res.json().catch(() => null) as Promise<T | null>
}
