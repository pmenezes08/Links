import { useEffect, useRef, useState } from 'react'

type Member = { username:string; display_name?:string; avatar?:string|null }

export default function MentionTextarea({
  value,
  onChange,
  communityId,
  placeholder,
  className,
  rows = 3,
}: {
  value: string
  onChange: (v:string)=>void
  communityId?: number | string
  placeholder?: string
  className?: string
  rows?: number
}){
  const enabled = (import.meta as any).env?.VITE_MENTIONS_ENABLED === 'true'
  const taRef = useRef<HTMLTextAreaElement|null>(null)
  const [open, setOpen] = useState(false)
  // note: store in ref to avoid TS unused warnings
  const queryRef = useRef('')
  const [items, setItems] = useState<Member[]>([])
  const [active, setActive] = useState(0)
  const timerRef = useRef<any>(null)
  const [anchor, setAnchor] = useState<{left:number; top:number}>({ left: 0, top: 0 })

  function getMentionQuery(text: string){
    const selStart = taRef.current?.selectionStart ?? text.length
    const upto = text.slice(0, selStart)
    const match = upto.match(/(^|\s)@([a-zA-Z0-9_]{0,30})$/)
    if (!match) return null
    return match[2] || ''
  }

  useEffect(() => {
    if (!enabled) return
    const q = getMentionQuery(value)
    if (q === null || !communityId){ setOpen(false); setItems([]); return }
    queryRef.current = q
    setOpen(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      try{
        const u = `/api/community_member_suggest?community_id=${encodeURIComponent(String(communityId))}&q=${encodeURIComponent(q)}`
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
  }, [value, communityId, enabled])

  useEffect(() => {
    const ta = taRef.current
    if (!ta || !open) return
    try{
      const { offsetLeft, offsetTop } = ta
      // Simple anchor; for better UX compute caret coordinates
      setAnchor({ left: offsetLeft + 16, top: offsetTop - 8 })
    }catch{}
  }, [open])

  function insert(username: string){
    const ta = taRef.current
    if (!ta) return
    const selStart = ta.selectionStart
    const before = value.slice(0, selStart)
    const after = value.slice(selStart)
    const m = before.match(/(^|\s)@([a-zA-Z0-9_]{0,30})$/)
    if (!m) return
    const replaceStart = before.length - (m[2]?.length || 0)
    const newText = before.slice(0, replaceStart) + username + ' ' + after
    onChange(newText)
    setOpen(false)
    setItems([])
    // no-op
    requestAnimationFrame(() => {
      ta.focus()
      const newPos = replaceStart + username.length + 1
      ta.setSelectionRange(newPos, newPos)
    })
  }

  return (
    <div className="relative">
      <textarea
        ref={taRef}
        rows={rows}
        className={className}
        placeholder={placeholder}
        value={value}
        onChange={(e)=> onChange(e.target.value)}
        onKeyDown={(e)=>{
          if (!open) return
          if (e.key === 'ArrowDown'){ e.preventDefault(); setActive(a=> Math.min(a+1, Math.max(0, items.length-1))) }
          else if (e.key === 'ArrowUp'){ e.preventDefault(); setActive(a=> Math.max(0, a-1)) }
          else if (e.key === 'Enter'){ 
            if (items[active]){ e.preventDefault(); insert('@' + items[active].username) }
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
              onMouseDown={(e)=> { e.preventDefault(); insert('@' + m.username) }}
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

