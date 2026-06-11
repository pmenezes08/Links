/**
 * Client-side memory of which posts Steve has already summarized this
 * session. Backs two things: instant reopen of the summary sheet, and the
 * glyph's quiet turquoise "Steve has read this" state on post cards.
 * Server-side Redis is the real cache — this is just the visual layer.
 */

export type KnownSummary = { summary: string; generatedAt: string | null; replyCount: number }

const known = new Map<number, KnownSummary>()

export function getKnownSummary(postId: number): KnownSummary | undefined {
  return known.get(postId)
}

export function hasSummary(postId: number): boolean {
  return known.has(postId)
}

export function rememberSummary(postId: number, entry: KnownSummary): void {
  known.set(postId, entry)
}

export function forgetSummary(postId: number): void {
  known.delete(postId)
}
