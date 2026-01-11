import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type LinkItem = { id:number; username:string; url:string; description:string; created_at:string; can_delete?:boolean }
type DocItem = { id:number; username:string; file_path:string; description:string; created_at:string }

export default function UsefulLinks(){
  const { community_id } = useParams()
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [links, setLinks] = useState<LinkItem[]>([])
  const [docs, setDocs] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'list'|'add'>('list')
  const [previewDoc, setPreviewDoc] = useState<DocItem|null>(null)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const urlRef = useRef<HTMLInputElement|null>(null)
  const descRef = useRef<HTMLInputElement|null>(null)
  const pdfDescRef = useRef<HTMLInputElement|null>(null)
  const pdfInputRef = useRef<HTMLInputElement|null>(null)

  useEffect(() => { setTitle('Useful Links & Docs') }, [setTitle])

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
    if (j?.success){ if (urlRef.current) urlRef.current.value=''; if (descRef.current) descRef.current.value=''; load() }
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
    if (j?.success){ if (pdfInputRef.current) pdfInputRef.current.value=''; if (pdfDescRef.current) pdfDescRef.current.value=''; load() }
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
                    docs.map(d => (
                      <div key={d.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 flex items-center justify_between gap-3">
                        <div>
                          <div className="text_white/90 text-sm truncate">{d.description || 'PDF Document'}</div>
                          <div className="text-xs text-[#9fb0b5]">{d.username} • {new Date(d.created_at).toLocaleString()}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm" onClick={()=> setPreviewDoc(d)}>Open</button>
                          <button className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm" onClick={()=> removeDoc(d.id)}>Delete</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Preview overlay; click outside closes */}
      {previewDoc && (
        <div 
          className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-sm"
          onClick={() => setPreviewDoc(null)}
        >
          {/* Close button - more prominent */}
          <button 
            className="absolute top-4 right-4 z-[110] w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 border border-white/30 text-white flex items-center justify-center transition-colors"
            onClick={() => setPreviewDoc(null)} 
            aria-label="Close preview"
          >
            <i className="fa-solid fa-xmark text-xl" />
          </button>
          
          {/* Open in new tab */}
          <a
            href={`/uploads/${previewDoc.file_path}`}
            target="_blank"
            rel="noreferrer"
            className="absolute top-4 left-4 z-[110] px-4 py-2 rounded-full border border-white/30 text-sm text-white hover:bg-white/10 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <i className="fa-solid fa-external-link mr-2" />
            Open in new tab
          </a>
          
          {/* PDF Viewer - centered with padding for click-outside area */}
          <div className="absolute inset-0 flex items-center justify-center p-8 pt-16 pointer-events-none">
            <div 
              className="w-full max-w-3xl h-full max-h-[80vh] pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <PdfScrollViewer url={`/uploads/${previewDoc.file_path}`} />
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

function PdfScrollViewer({ url }:{ url: string }){
  const containerRef = useRef<HTMLDivElement|null>(null)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const [zoom, setZoom] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [numPages, setNumPages] = useState(0)
  const pdfDocRef = useRef<any>(null)
  
  // Pinch zoom state
  const pinchRef = useRef({ startDist: 0, startZoom: 1, isPinching: false })

  // Load PDF document once
  useEffect(() => {
    let mounted = true
    async function loadPdf(){
      setLoading(true)
      setError(null)
      try {
        const pdfjsLib: any = await import('pdfjs-dist')
        
        // Set up worker
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
          try {
            // @ts-ignore
            const workerEntry = await import('pdfjs-dist/build/pdf.worker.mjs')
            pdfjsLib.GlobalWorkerOptions.workerSrc = workerEntry
          } catch {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.js'
          }
        }
        
        console.log('Loading PDF from:', url)
        const loadingTask = pdfjsLib.getDocument({ url, withCredentials: true })
        const pdf = await loadingTask.promise
        
        if (!mounted) return
        pdfDocRef.current = pdf
        setNumPages(pdf.numPages)
        setLoading(false)
      } catch (err: any) {
        console.error('PDF load error:', err)
        if (!mounted) return
        setError(`Failed to load PDF: ${err?.message || 'Unknown error'}`)
        setLoading(false)
      }
    }
    loadPdf()
    return () => { mounted = false }
  }, [url])

  // Render pages when PDF is loaded or zoom changes
  useEffect(() => {
    if (!pdfDocRef.current || loading) return
    
    let mounted = true
    async function renderPages() {
      const pdf = pdfDocRef.current
      const cont = containerRef.current
      if (!pdf || !cont) return
      
      cont.innerHTML = ''
      const containerWidth = scrollRef.current?.clientWidth || 350
      
      for (let i = 1; i <= pdf.numPages; i++) {
        if (!mounted) return
        try {
          const page = await pdf.getPage(i)
          const originalViewport = page.getViewport({ scale: 1 })
          const fitScale = (containerWidth - 32) / originalViewport.width
          const viewport = page.getViewport({ scale: fitScale * zoom })
          
          const canvas = document.createElement('canvas')
          canvas.style.display = 'block'
          canvas.style.margin = '0 auto 8px auto'
          canvas.style.borderRadius = '4px'
          canvas.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)'
          canvas.style.backgroundColor = '#fff'
          canvas.width = viewport.width
          canvas.height = viewport.height
          cont.appendChild(canvas)
          
          const ctx = canvas.getContext('2d')
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise
          }
        } catch (pageErr) {
          console.error(`Error rendering page ${i}:`, pageErr)
        }
      }
    }
    renderPages()
    return () => { mounted = false }
  }, [loading, zoom])

  // Get distance between two touch points
  function getDistance(t1: React.Touch, t2: React.Touch): number {
    const dx = t1.clientX - t2.clientX
    const dy = t1.clientY - t2.clientY
    return Math.hypot(dx, dy)
  }

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      pinchRef.current = {
        startDist: getDistance(e.touches[0], e.touches[1]),
        startZoom: zoom,
        isPinching: true
      }
    }
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (pinchRef.current.isPinching && e.touches.length === 2) {
      const currentDist = getDistance(e.touches[0], e.touches[1])
      const scale = currentDist / pinchRef.current.startDist
      const newZoom = Math.max(0.5, Math.min(4, pinchRef.current.startZoom * scale))
      setZoom(newZoom)
    }
  }

  function handleTouchEnd() {
    pinchRef.current.isPinching = false
  }

  return (
    <div 
      ref={scrollRef}
      className="relative w-full h-full bg-[#1a1a1a] rounded-xl overflow-auto"
      style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Zoom controls */}
      <div className="sticky top-0 left-0 right-0 z-10 flex items-center justify-center gap-2 py-2 bg-[#1a1a1a]/90 backdrop-blur-sm border-b border-white/10">
        <button 
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
        >
          <i className="fa-solid fa-minus text-sm" />
        </button>
        <span className="text-white/70 text-sm w-16 text-center">{Math.round(zoom * 100)}%</span>
        <button 
          className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          onClick={() => setZoom(z => Math.min(4, z + 0.25))}
        >
          <i className="fa-solid fa-plus text-sm" />
        </button>
        <button 
          className="ml-2 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          onClick={() => setZoom(1)}
          title="Reset zoom"
        >
          <i className="fa-solid fa-expand text-sm" />
        </button>
        {numPages > 0 && (
          <span className="ml-4 text-white/50 text-xs">{numPages} page{numPages > 1 ? 's' : ''}</span>
        )}
      </div>
      
      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-20">
          <div className="text-white/60 flex items-center gap-2">
            <i className="fa-solid fa-spinner fa-spin" />
            Loading PDF...
          </div>
        </div>
      )}
      
      {/* Error state */}
      {error && (
        <div className="flex flex-col items-center justify-center py-20 px-4">
          <div className="text-red-400 text-center mb-4">{error}</div>
          <a 
            href={url} 
            target="_blank" 
            rel="noreferrer"
            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-white text-sm"
          >
            Open PDF directly
          </a>
        </div>
      )}
      
      {/* PDF pages container */}
      <div ref={containerRef} className="p-4" />
    </div>
  )
}

