// Measured intrinsic image dimensions, cached by URL so a repeat view reserves the
// correct height BEFORE the image decodes — no collapse-then-grow reflow (the chat
// "bubbles overlap then settle" clunk). First-ever view of a brand-new image still
// settles once; every view after that (this session or a later one) is shift-free.
//
// Only the aspect ratio matters for reservation, so it's fine that the recorded size
// is the resized/optimized variant — the ratio is identical to the original.

const MEM = new Map<string, [number, number]>()
const LS_KEY = 'cpoint-image-dims'
const MAX_ENTRIES = 600

function normalize(src: string): string {
  return (src || '').split('?')[0]
}

let loaded = false
function ensureLoaded(): void {
  if (loaded) return
  loaded = true
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const obj = JSON.parse(raw) as Record<string, [number, number]>
    for (const k in obj) {
      const v = obj[k]
      if (Array.isArray(v) && v.length === 2 && v[0] > 0 && v[1] > 0) MEM.set(k, [v[0], v[1]])
    }
  } catch {
    /* corrupt/unavailable — start empty */
  }
}

/** Cached [width, height] for an image URL, or null if never measured. */
export function getImageDims(src: string): [number, number] | null {
  ensureLoaded()
  return MEM.get(normalize(src)) ?? null
}

/** Record an image's measured natural dimensions (first writer wins; bounded + persisted). */
export function recordImageDims(src: string, width: number, height: number): void {
  if (!width || !height) return
  ensureLoaded()
  const key = normalize(src)
  if (!key || MEM.has(key)) return
  MEM.set(key, [width, height])
  if (MEM.size > MAX_ENTRIES) {
    const oldest = MEM.keys().next().value
    if (oldest !== undefined) MEM.delete(oldest)
  }
  try {
    const obj: Record<string, [number, number]> = {}
    MEM.forEach((v, k) => {
      obj[k] = v
    })
    localStorage.setItem(LS_KEY, JSON.stringify(obj))
  } catch {
    /* storage full/unavailable — keep the in-memory cache */
  }
}

/** Test-only reset of the in-memory cache + load flag. */
export function __resetImageDimsCacheForTest(): void {
  MEM.clear()
  loaded = false
}
