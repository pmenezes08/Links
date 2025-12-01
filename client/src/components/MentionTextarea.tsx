import { useEffect, useRef, useState } from 'react'

type Member = { username:string; display_name?:string; avatar?:string|null }

export default function MentionTextarea({
  value,
  onChange,
  communityId,
  postId,
  replyId,
  placeholder,
  className,
  rows = 3,
  perfDegraded = false,
  autoExpand = false,
}: {
  value: string
  onChange: (v:string)=>void
  communityId?: number | string
  postId?: number | string
  replyId?: number | string
  placeholder?: string
  className?: string
  rows?: number
  perfDegraded?: boolean
  autoExpand?: boolean
}){
  // Default to enabled when env flag is unset; only disable if explicitly set to 'false'
  const envVal = (import.meta as any).env?.VITE_MENTIONS_ENABLED
  const enabled = (envVal === undefined || envVal === 'true')
  const taRef = useRef<HTMLTextAreaElement|null>(null)
  const overlayRef = useRef<HTMLDivElement|null>(null)
  const [open, setOpen] = useState(false)
  // note: store in ref to avoid TS unused warnings
  const queryRef = useRef('')
  const [items, setItems] = useState<Member[]>([])
  const [active, setActive] = useState(0)
  const timerRef = useRef<any>(null)
  const [anchor, setAnchor] = useState<{left:number; top:number}>({ left: 0, top: 0 })

  // escapeHtml no longer needed here; handled in overlay

  // highlight mask built in overlay component

  function getMentionQuery(text: string){
    const selStart = taRef.current?.selectionStart ?? text.length
    const upto = text.slice(0, selStart)
    const match = upto.match(/(^|\s)@([a-zA-Z0-9_]{0,30})$/)
    if (!match) return null
    return match[2] || ''
  }

  // Suggestion fetching (throttled) — disabled in degraded mode
  useEffect(() => {
    const suggestionsEnabled = enabled && !perfDegraded
    if (!suggestionsEnabled){ setOpen(false); setItems([]); return }
    const q = getMentionQuery(value)
    if (q === null){ setOpen(false); setItems([]); return }
    queryRef.current = q
    setOpen(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try{
        const params = new URLSearchParams()
        if (communityId){ params.set('community_id', String(communityId)) }
        else if (postId){ params.set('post_id', String(postId)) }
        else if (replyId){ params.set('reply_id', String(replyId)) }
        params.set('q', q)
        const u = `/api/community_member_suggest?${params.toString()}`
        const r = await fetch(u, { credentials:'include' })
        const j = await r.json().catch(()=>null)
        if (j?.success && Array.isArray(j.members)){
          setItems(j.members)
          setActive(0)
        } else {
          setItems([])
        }
      }catch{ setItems([]) }
    }, 180)
  }, [value, communityId, enabled, perfDegraded])

  useEffect(() => {
    const ta = taRef.current
    if (!ta || !open) return
    try{
      const { offsetLeft, offsetTop } = ta
      // Simple anchor; for better UX compute caret coordinates
      setAnchor({ left: offsetLeft + 16, top: offsetTop - 8 })
    }catch{}
  }, [open])

  // Auto-expand textarea height based on content
  useEffect(() => {
    if (!autoExpand) return
    const ta = taRef.current
    if (!ta) return
    // Reset height to auto to get proper scrollHeight
    ta.style.height = 'auto'
    // Set height to scrollHeight, respecting max-height from className
    ta.style.height = `${ta.scrollHeight}px`
  }, [value, autoExpand])

  function insert(username: string){
    const ta = taRef.current
    if (!ta) return
    const selStart = ta.selectionStart
    const before = value.slice(0, selStart)
    const after = value.slice(selStart)
    const m = before.match(/(^|\s)@([a-zA-Z0-9_]{0,30})$/)
    if (!m) return
    // Replace from the '@' to the cursor with a single @username
    let replaceStart = before.lastIndexOf('@')
    if (replaceStart < 0){ replaceStart = before.length - (m[2]?.length || 0) }
    const newText = before.slice(0, replaceStart) + '@' + username + ' ' + after
    onChange(newText)
    setOpen(false)
    setItems([])
    // no-op
    requestAnimationFrame(() => {
      ta.focus()
      const newPos = replaceStart + ('@' + username + ' ').length
      ta.setSelectionRange(newPos, newPos)
    })
  }

  return (
    <div className="relative">
      {/* Highlight overlay (behind textarea) */}
      <MentionHighlightOverlay
        overlayRef={overlayRef as React.RefObject<HTMLDivElement>}
        text={value}
        enabled={enabled && !perfDegraded && value.length <= 2000 && value.indexOf('@') !== -1}
      />
      <textarea
        ref={taRef}
        rows={rows}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e)=> onChange(e.target.value)}
        onScroll={(e)=> { try{ if (overlayRef.current) overlayRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop }catch{} }}
        style={{ backgroundColor: 'transparent' }}
        onKeyDown={(e)=>{
          if (!open) return
          if (e.key === 'ArrowDown'){ e.preventDefault(); setActive(a=> Math.min(a+1, Math.max(0, items.length-1))) }
          else if (e.key === 'ArrowUp'){ e.preventDefault(); setActive(a=> Math.max(0, a-1)) }
          else if (e.key === 'Enter'){ 
            if (items[active]){ e.preventDefault(); insert(items[active].username) }
          }
        }}
      />
      {enabled && open && items.length > 0 && (
        <div className="absolute z-50 bg-[#0b0f10] border border-white/10 rounded-xl shadow-xl overflow-hidden"
          style={{ left: anchor.left, top: anchor.top }}
        >
          {items.map((m, idx) => (
            <button key={m.username}
              className={`w-full px-3 py-2 text-left flex items-center gap-2 ${idx===active? 'bg-white/5' : ''}`}
              onMouseEnter={()=> setActive(idx)}
              onMouseDown={(e)=> { e.preventDefault(); insert(m.username) }}
            >
              <div className="w-7 h-7 rounded-full bg-white/10 overflow-hidden border border-white/10">
                {m.avatar ? <img src={m.avatar.startsWith('http')? m.avatar : `/uploads/${m.avatar}`} alt="" className="w-full h-full object-cover" /> : null}
              </div>
              <div className="text-sm text-white">
                <span className="font-medium">@{m.username}</span>
                {m.display_name && <span className="ml-1 text-white/60">{m.display_name}</span>}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function MentionHighlightOverlay({ overlayRef, text, enabled }:{ overlayRef: React.RefObject<HTMLDivElement>, text: string, enabled: boolean }){
  const [maskHtml, setMaskHtml] = useState('')
  const debounceRef = useRef<any>(null)
  useEffect(() => {
    if (!enabled){ setMaskHtml(''); return }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      // local builder mirrors outer function
      const mentionRe = /(^|\s)@([a-zA-Z0-9_]{1,30})/g
      if (!text || text.indexOf('@') === -1){ setMaskHtml(''); return }
      let out = ''
      let idx = 0
      let m: RegExpExecArray | null
      while ((m = mentionRe.exec(text))){
        const matchStart = m.index
        const lead = m[1] || ''
        const atStart = matchStart + lead.length
        const mentionText = '@' + (m[2] || '')
        const before = text.slice(idx, atStart)
        for (let i = 0; i < before.length; i++){
          const ch = before[i]
          out += ch === '\n' ? '\n' : ' '
        }
        const esc = (s:string)=> s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        out += `<span style="background: rgba(77,182,172,0.28); color: transparent; border-radius: 4px;">${esc(mentionText)}</span>`
        idx = atStart + mentionText.length
      }
      const tail = text.slice(idx)
      for (let i = 0; i < tail.length; i++){
        const ch = tail[i]
        out += ch === '\n' ? '\n' : ' '
      }
      setMaskHtml(out)
    }, 50)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [text, enabled])
  if (!enabled) return null
  return (
    <div
      ref={overlayRef}
      aria-hidden="true"
      className="absolute inset-0 pointer-events-none"
      style={{ padding: '0.375rem 0.75rem', whiteSpace: 'pre-wrap', overflow: 'hidden' }}
    >
      <div
        dangerouslySetInnerHTML={{ __html: maskHtml }}
        style={{ font: 'inherit', lineHeight: 'inherit', wordBreak: 'break-word' }}
      />
    </div>
  )
}

