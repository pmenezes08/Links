import type { ReactNode } from 'react'

/**
 * Minimal, injection-safe markdown for Steve's builder replies: builds React
 * nodes (never sets innerHTML), supporting **bold**, *italic*, `code`, bullet
 * and numbered lists, and paragraph breaks.
 *
 * Builder-scoped markdown-lite. Chat surfaces use utils/linkUtils.tsx
 * (renderRichText); folding this list-rendering into that shared helper is
 * tracked as a follow-up — linkUtils feeds the DM/group kernel, so that merge
 * needs its own careful pass.
 */
function renderInline(text: string, kp: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*|_([^_]+)_)/g
  let last = 0, m: RegExpExecArray | null, i = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[2] !== undefined) out.push(<strong key={`${kp}-${i}`}>{m[2]}</strong>)
    else if (m[3] !== undefined) out.push(<code key={`${kp}-${i}`} className="rounded bg-white/10 px-1 py-px text-[12px]">{m[3]}</code>)
    else out.push(<em key={`${kp}-${i}`}>{m[4] ?? m[5]}</em>)
    last = m.index + m[0].length; i++
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export default function SteveRichText({ text }: { text: string }) {
  const lines = (text || '').split('\n')
  const blocks: ReactNode[] = []
  let list: { type: 'ul' | 'ol'; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list, k = `l${blocks.length}`
    const lis = L.items.map((it, j) => <li key={j} className="my-0.5">{renderInline(it, `${k}-${j}`)}</li>)
    blocks.push(L.type === 'ul'
      ? <ul key={k} className="my-1 list-disc pl-[18px]">{lis}</ul>
      : <ol key={k} className="my-1 list-decimal pl-5">{lis}</ol>)
    list = null
  }
  lines.forEach((raw, idx) => {
    const line = raw.replace(/\s+$/, '')
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)
    const num = line.match(/^\s*\d+\.\s+(.*)$/)
    if (bullet) {
      if (!list || list.type !== 'ul') { flush(); list = { type: 'ul', items: [] } }
      list.items.push(bullet[1])
    } else if (num) {
      if (!list || list.type !== 'ol') { flush(); list = { type: 'ol', items: [] } }
      list.items.push(num[1])
    } else {
      flush()
      if (line.trim() === '') blocks.push(<div key={`b${idx}`} className="h-1.5" />)
      else blocks.push(<div key={`b${idx}`}>{renderInline(line, `p${idx}`)}</div>)
    }
  })
  flush()
  return <div className="text-[14px] leading-relaxed text-c-text-primary">{blocks}</div>
}
