import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type LinkItem = { id:number; username:string; url:string; description:string; created_at:string; can_delete?:boolean }
type DocItem = { id:number; username:string; file_path:string; description:string; created_at:string }

// Helper to resolve document URL - handles both CDN URLs and local paths
function resolveDocUrl(filePath: string): string {
  if (!filePath) return ''
  // If it's already a full URL (CDN), return as-is
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath
  }
  // Otherwise prepend /uploads/ for local files
  if (filePath.startsWith('/uploads/')) return filePath
  if (filePath.startsWith('uploads/')) return `/${filePath}`
  return `/uploads/${filePath}`
}

export default function UsefulLinks(){
  const { community_id } = useParams()
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [links, setLinks] = useState<LinkItem[]>([])
  const [docs, setDocs] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'list'|'add'>('list')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [editingDocId, setEditingDocId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [swipedDocId, setSwipedDocId] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const urlRef = useRef<HTMLInputElement|null>(null)
  const descRef = useRef<HTMLInputElement|null>(null)
  const pdfDescRef = useRef<HTMLInputElement|null>(null)
  const pdfInputRef = useRef<HTMLInputElement|null>(null)

  useEffect(() => { 
    setTitle('Useful Links & Docs')
    // Mark docs as seen for this community
    if (community_id) {
      const key = `docs_last_seen_${community_id}`
      localStorage.setItem(key, new Date().toISOString())
    }
  }, [setTitle, community_id])

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function load(){
    setLoading(true)
    try{
      const qs = community_id ? `?community_id=${community_id}` : ''
      const r = await fetch(`/get_links${qs}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        setLinks(j.links || [])
        setDocs(j.docs || [])
      }
    }finally{ setLoading(false) }
  }
  
  useEffect(()=>{ load() }, [community_id])

  async function addLink(){
    const u = urlRef.current?.value.trim() || ''
    const d = descRef.current?.value.trim() || ''
    if (!u || !d) { alert('URL and description are required'); return }
    const body = new URLSearchParams({ url:u, description:d })
    if (community_id) body.append('community_id', String(community_id))
    const r = await fetch('/add_link', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body })
    const j = await r.json().catch(()=>null)
    if (j?.success){ 
      if (urlRef.current) urlRef.current.value=''
      if (descRef.current) descRef.current.value=''
      showToast('Link added successfully!')
      setActiveTab('list')
      load()
    }
    else alert(j?.error || j?.message || 'Failed to add link')
  }

  async function uploadPdf(){
    const file = pdfInputRef.current?.files?.[0]
    const d = pdfDescRef.current?.value.trim() || ''
    if (!file){ alert('Select a PDF'); return }
    if (!file.name.toLowerCase().endsWith('.pdf')){ alert('Only PDF files are allowed'); return }
    const fd = new FormData()
    fd.append('file', file)
    if (d) fd.append('description', d)
    if (community_id) fd.append('community_id', String(community_id))
    const r = await fetch('/upload_doc', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){ 
      if (pdfInputRef.current) pdfInputRef.current.value=''
      if (pdfDescRef.current) pdfDescRef.current.value=''
      showToast('Document uploaded successfully!')
      setActiveTab('list')
      load()
    }
    else alert(j?.error || 'Failed to upload')
  }

  async function remove(id:number){
    const body = new URLSearchParams({ link_id: String(id) })
    const r = await fetch('/delete_link', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setLinks(prev => prev.filter(x => x.id !== id)) }
    else alert(j?.error || j?.message || 'Failed to delete')
  }

  async function removeDoc(id:number){
    const ok = confirm('Delete this document?')
    if (!ok) return
    const body = new URLSearchParams({ doc_id: String(id) })
    const r = await fetch('/delete_doc', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setDocs(prev => prev.filter(x => x.id !== id)) }
    else alert(j?.error || j?.message || 'Failed to delete')
  }

  async function renameDoc(id: number, newName: string) {
    if (!newName.trim()) {
      showToast('Name cannot be empty', 'error')
      return
    }
    const body = new URLSearchParams({ doc_id: String(id), new_name: newName.trim() })
    const r = await fetch('/rename_doc', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const j = await r.json().catch(() => null)
    if (j?.success) {
      setDocs(prev => prev.map(d => d.id === id ? { ...d, description: newName.trim() } : d))
      setEditingDocId(null)
      setEditingName('')
      showToast('Document renamed!')
    } else {
      showToast(j?.error || 'Failed to rename', 'error')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Secondary header with nav tabs */}
      <div
        className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(`/community_feed_react/${community_id||''}`)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='list' ? 'text-white/95' : 'text-[#9fb0b5] hover:text_WHITE/90'}`} onClick={()=> setActiveTab('list')}>
              <div className="pt-2">Useful Links & Docs</div>
              <div className={`h-0.5 rounded-full w-24 mx-auto mt-1 ${activeTab==='list' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='add' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('add')}>
              <div className="pt-2">Add new</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='add' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="app-subnav-offset max-w-2xl mx-auto pb-20 px-3 overflow-y-auto no-scrollbar"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
          '--app-subnav-height': '40px',
        } as CSSProperties}
      >
        {activeTab === 'add' ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border_WHITE/10 bg_WHITE/[0.035] p-3">
              <div className="text-sm font-semibold mb-2">Add a Link</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input ref={urlRef} className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" placeholder="https://..." />
                <input ref={descRef} className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" placeholder="Description" />
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={addLink}>Add</button>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg_WHITE/[0.035] p-3">
              <div className="text-sm font-semibold mb-2">Upload a PDF</div>
              <div className="flex flex-col sm:flex-row gap-2 items-center">
                <input ref={pdfInputRef} type="file" accept="application/pdf" className="flex-1 text-sm" />
                <input ref={pdfDescRef} className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" placeholder="Description (optional)" />
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text_black text-sm hover:brightness-110" onClick={uploadPdf}>Upload</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {loading ? (
              <div className="text-[#9fb0b5]">Loading…</div>
            ) : (
              <>
                <div className="space-y-2">
                  {links.length === 0 ? (
                    <div className="text-[#9fb0b5]">No links yet.</div>
                  ) : (
                    links.map(l => (
                      <div key={l.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                        <div className="text-teal-300 truncate"><a className="hover:underline" href={l.url} target="_blank" rel="noreferrer">{l.url}</a></div>
                        <div className="text-sm text-[#cfd8dc] truncate">{l.description}</div>
                        <div className="mt-2 flex justify-end">
                          {l.can_delete ? (
                            <button className="px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 text-xs" onClick={()=> remove(l.id)}>Delete</button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="pt-2">
                  <div className="text-sm font-semibold mb-2">Documents</div>
                  <div className="text-xs text-[#9fb0b5] mb-2">← Swipe left on your documents to edit or delete</div>
                  {docs.length === 0 ? (
                    <div className="text-[#9fb0b5]">No documents yet.</div>
                  ) : (
                    docs.map(d => {
                      // Extract filename from file_path if no description
                      const displayName = d.description || (d.file_path ? (d.file_path.split('/').pop()?.replace(/^\d+_/, '') || 'PDF Document') : 'PDF Document')
                      const isEditing = editingDocId === d.id
                      const isSwiped = swipedDocId === d.id
                      
                      return (
                      <SwipeableDocCard
                        key={d.id}
                        doc={d}
                        displayName={displayName}
                        isEditing={isEditing}
                        isSwiped={isSwiped}
                        editingName={editingName}
                        onSwipe={(swiped) => setSwipedDocId(swiped ? d.id : null)}
                        onEditStart={() => { setEditingDocId(d.id); setEditingName(d.description || ''); setSwipedDocId(null) }}
                        onEditCancel={() => { setEditingDocId(null); setEditingName('') }}
                        onEditSave={() => renameDoc(d.id, editingName)}
                        onEditNameChange={setEditingName}
                        onDelete={() => removeDoc(d.id)}
                        resolveDocUrl={resolveDocUrl}
                      />
                    )})
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Success/Error Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 animate-fade-in">
          <div className={`px-5 py-3 rounded-xl shadow-lg flex items-center gap-2 ${
            toast.type === 'success' 
              ? 'bg-[#4db6ac] text-black' 
              : 'bg-red-500 text-white'
          }`}>
            <i className={`fa-solid ${toast.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`} />
            <span className="font-medium">{toast.message}</span>
          </div>
        </div>
      )}

    </div>
  )
}

// Swipeable document card component
function SwipeableDocCard({ 
  doc, 
  displayName, 
  isEditing, 
  isSwiped,
  editingName,
  onSwipe,
  onEditStart, 
  onEditCancel, 
  onEditSave,
  onEditNameChange,
  onDelete,
  resolveDocUrl 
}: {
  doc: DocItem
  displayName: string
  isEditing: boolean
  isSwiped: boolean
  editingName: string
  onSwipe: (swiped: boolean) => void
  onEditStart: () => void
  onEditCancel: () => void
  onEditSave: () => void
  onEditNameChange: (name: string) => void
  onDelete: () => void
  resolveDocUrl: (path: string) => string
}) {
  const touchRef = useRef<{ startX: number; startY: number; startTime: number } | null>(null)
  const [translateX, setTranslateX] = useState(0)
  const actionWidth = 140 // Width of action buttons area
  
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isEditing) return
    touchRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
      startTime: Date.now()
    }
  }
  
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchRef.current || isEditing) return
    const deltaX = e.touches[0].clientX - touchRef.current.startX
    const deltaY = e.touches[0].clientY - touchRef.current.startY
    
    // If scrolling vertically, don't swipe
    if (Math.abs(deltaY) > Math.abs(deltaX)) return
    
    // Only allow left swipe (negative deltaX)
    const newX = isSwiped ? Math.max(-actionWidth, Math.min(0, deltaX - actionWidth)) : Math.max(-actionWidth, Math.min(0, deltaX))
    setTranslateX(newX)
  }
  
  const handleTouchEnd = () => {
    if (!touchRef.current || isEditing) return
    // Snap to open or closed position
    if (translateX < -actionWidth / 2) {
      setTranslateX(-actionWidth)
      onSwipe(true)
    } else {
      setTranslateX(0)
      onSwipe(false)
    }
    touchRef.current = null
  }
  
  // Reset position when isSwiped changes externally
  useEffect(() => {
    if (!isSwiped) setTranslateX(0)
    else setTranslateX(-actionWidth)
  }, [isSwiped])

  return (
    <div className="relative overflow-hidden rounded-2xl mb-2">
      {/* Action buttons behind */}
      <div className="absolute right-0 top-0 bottom-0 flex items-stretch" style={{ width: actionWidth }}>
        <button 
          className="flex-1 bg-blue-500 flex items-center justify-center text-white"
          onClick={onEditStart}
        >
          <i className="fa-solid fa-pen" />
        </button>
        <button 
          className="flex-1 bg-red-500 flex items-center justify-center text-white"
          onClick={onDelete}
        >
          <i className="fa-solid fa-trash" />
        </button>
      </div>
      
      {/* Main content - slides */}
      <div 
        className="relative bg-white/[0.035] border border-white/10 rounded-2xl p-3 transition-transform"
        style={{ 
          transform: `translateX(${translateX}px)`,
          transitionDuration: touchRef.current ? '0ms' : '200ms'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isEditing ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={editingName}
              onChange={(e) => onEditNameChange(e.target.value)}
              className="flex-1 rounded-md bg-black border border-white/20 px-2 py-1 text-sm focus:border-teal-400/70 outline-none"
              placeholder="Document name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onEditSave()
                if (e.key === 'Escape') onEditCancel()
              }}
            />
            <button 
              className="px-2 py-1 rounded-md bg-[#4db6ac] text-black text-xs hover:brightness-110"
              onClick={onEditSave}
            >
              Save
            </button>
            <button 
              className="px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 text-xs"
              onClick={onEditCancel}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-white/90 text-sm truncate">{displayName}</div>
              <div className="text-xs text-[#9fb0b5]">{doc.username} • {new Date(doc.created_at).toLocaleString()}</div>
            </div>
            <a 
              href={resolveDocUrl(doc.file_path)} 
              target="_blank" 
              rel="noreferrer"
              className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm flex-shrink-0"
            >
              <i className="fa-solid fa-external-link mr-1.5" />
              Open
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

