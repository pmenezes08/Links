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
                  {docs.length === 0 ? (
                    <div className="text-[#9fb0b5]">No documents yet.</div>
                  ) : (
                    docs.map(d => {
                      // Extract filename from file_path if no description
                      const displayName = d.description || (d.file_path ? d.file_path.split('/').pop()?.replace(/^\d+_/, '') : 'PDF Document')
                      return (
                      <div key={d.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-white/90 text-sm truncate">{displayName}</div>
                          <div className="text-xs text-[#9fb0b5]">{d.username} • {new Date(d.created_at).toLocaleString()}</div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <a 
                            href={resolveDocUrl(d.file_path)} 
                            target="_blank" 
                            rel="noreferrer"
                            className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm"
                          >
                            <i className="fa-solid fa-external-link mr-1.5" />
                            Open
                          </a>
                          <button className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm" onClick={()=> removeDoc(d.id)}>Delete</button>
                        </div>
                      </div>
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

