import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useHeader } from '../contexts/HeaderContext'

type LinkItem = { id:number; username:string; url:string; description:string; created_at:string; can_delete?:boolean }
type DocItem = { id:number; username:string; file_path:string; description:string; details?:string; created_at:string }

function resolveDocUrl(filePath: string): string {
  if (!filePath) return ''
  if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return filePath
  }
  if (filePath.startsWith('/uploads/')) return filePath
  if (filePath.startsWith('uploads/')) return `/${filePath}`
  return `/uploads/${filePath}`
}

export default function UsefulLinks(){
  const { t } = useTranslation()
  const { community_id } = useParams()
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('group_id')
  const { setTitle } = useHeader()
  const navigate = useNavigate()
  const [links, setLinks] = useState<LinkItem[]>([])
  const [docs, setDocs] = useState<DocItem[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'list'|'add'>('list')
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [editingDocId, setEditingDocId] = useState<number | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingDetails, setEditingDetails] = useState('')
  const [swipedDocId, setSwipedDocId] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement|null>(null)
  const urlRef = useRef<HTMLInputElement|null>(null)
  const descRef = useRef<HTMLInputElement|null>(null)
  const pdfNameRef = useRef<HTMLInputElement|null>(null)
  const pdfDetailsRef = useRef<HTMLTextAreaElement|null>(null)
  const pdfInputRef = useRef<HTMLInputElement|null>(null)

  useEffect(() => { 
    setTitle(t('links_docs.page_title'))
    if (community_id) {
      const key = groupId ? `docs_last_seen_group_${groupId}` : `docs_last_seen_${community_id}`
      localStorage.setItem(key, new Date().toISOString())
    }
  }, [setTitle, community_id, groupId, t])

  function showToast(message: string, type: 'success' | 'error' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function load(){
    setLoading(true)
    try{
      let qs = ''
      if (community_id) {
        qs = `?community_id=${community_id}`
        if (groupId) qs += `&group_id=${encodeURIComponent(groupId)}`
      }
      const r = await fetch(`/get_links${qs}`, { credentials:'include' })
      const j = await r.json()
      if (j?.success){
        setLinks(j.links || [])
        setDocs(j.docs || [])
      }
    }finally{ setLoading(false) }
  }
  
  useEffect(()=>{ load() }, [community_id, groupId])

  async function addLink(){
    const u = urlRef.current?.value.trim() || ''
    const d = descRef.current?.value.trim() || ''
    if (!u || !d) { alert(t('links_docs.url_description_required')); return }
    const body = new URLSearchParams({ url:u, description:d })
    if (community_id) body.append('community_id', String(community_id))
    if (groupId) body.append('group_id', groupId)
    const r = await fetch('/add_link', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body })
    const j = await r.json().catch(()=>null)
    if (j?.success){ 
      if (urlRef.current) urlRef.current.value=''
      if (descRef.current) descRef.current.value=''
      showToast(t('links_docs.link_added'))
      setActiveTab('list')
      load()
    }
    else alert(j?.error || j?.message || t('links_docs.add_link_failed'))
  }

  async function uploadPdf(){
    const file = pdfInputRef.current?.files?.[0]
    const name = pdfNameRef.current?.value.trim() || ''
    const details = pdfDetailsRef.current?.value.trim() || ''
    if (!file){ alert(t('links_docs.select_pdf')); return }
    if (!file.name.toLowerCase().endsWith('.pdf')){ alert(t('links_docs.pdf_only')); return }
    if (!name){ alert(t('links_docs.name_required')); return }
    const fd = new FormData()
    fd.append('file', file)
    fd.append('name', name)
    if (details) fd.append('details', details)
    if (community_id) fd.append('community_id', String(community_id))
    if (groupId) fd.append('group_id', groupId)
    const r = await fetch('/upload_doc', { method:'POST', credentials:'include', body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success){ 
      if (pdfInputRef.current) pdfInputRef.current.value=''
      if (pdfNameRef.current) pdfNameRef.current.value=''
      if (pdfDetailsRef.current) pdfDetailsRef.current.value=''
      showToast(t('links_docs.document_uploaded'))
      setActiveTab('list')
      load()
    }
    else alert(j?.error || t('links_docs.upload_failed'))
  }

  async function remove(id:number){
    const body = new URLSearchParams({ link_id: String(id) })
    const r = await fetch('/delete_link', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setLinks(prev => prev.filter(x => x.id !== id)) }
    else alert(j?.error || j?.message || t('links_docs.delete_link_failed'))
  }

  async function removeDoc(id:number){
    const ok = confirm(t('links_docs.delete_document_confirm'))
    if (!ok) return
    const body = new URLSearchParams({ doc_id: String(id) })
    const r = await fetch('/delete_doc', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body })
    const j = await r.json().catch(()=>null)
    if (j?.success){ setDocs(prev => prev.filter(x => x.id !== id)) }
    else alert(j?.error || j?.message || t('links_docs.delete_document_failed'))
  }

  async function renameDoc(id: number, newName: string, newDetails: string) {
    if (!newName.trim()) {
      showToast(t('links_docs.name_empty'), 'error')
      return
    }
    const body = new URLSearchParams({ doc_id: String(id), new_name: newName.trim(), details: newDetails.trim() })
    const r = await fetch('/rename_doc', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const j = await r.json().catch(() => null)
    if (j?.success) {
      setDocs(prev => prev.map(d => d.id === id ? { ...d, description: newName.trim(), details: newDetails.trim() } : d))
      setEditingDocId(null)
      setEditingName('')
      setEditingDetails('')
      showToast(t('links_docs.document_updated'))
    } else {
      showToast(j?.error || t('links_docs.rename_failed'), 'error')
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <div
        className="fixed left-0 right-0 h-10 bg-black/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(groupId ? `/group_feed_react/${groupId}` : `/community_feed_react/${community_id||''}`)} aria-label={t('common.back')}>
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='list' ? 'text-white/95' : 'text-[#9fb0b5] hover:text_WHITE/90'}`} onClick={()=> setActiveTab('list')}>
              <div className="pt-2">{t('links_docs.tab_list')}</div>
              <div className={`h-0.5 rounded-full w-24 mx-auto mt-1 ${activeTab==='list' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='add' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setActiveTab('add')}>
              <div className="pt-2">{t('links_docs.tab_add')}</div>
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
              <div className="text-sm font-semibold mb-2">{t('links_docs.add_link_title')}</div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input ref={urlRef} className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" placeholder={t('links_docs.url_placeholder')} />
                <input ref={descRef} className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" placeholder={t('links_docs.description')} />
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110" onClick={addLink}>{t('common.add')}</button>
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg_WHITE/[0.035] p-3">
              <div className="text-sm font-semibold mb-2">{t('links_docs.upload_pdf_title')}</div>
              <div className="flex flex-col sm:flex-row gap-2 items-center">
                <input ref={pdfInputRef} type="file" accept="application/pdf" className="flex-1 text-sm" />
                <input ref={pdfNameRef} className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none" placeholder={t('links_docs.document_name_required')} />
                <textarea ref={pdfDetailsRef} className="flex-1 rounded-md bg-black border border-white/10 px-3 py-2 text-sm focus:border-teal-400/70 outline-none resize-none" placeholder={t('links_docs.document_description_optional')} rows={2} />
                <button className="px-3 py-2 rounded-md bg-[#4db6ac] text_black text-sm hover:brightness-110" onClick={uploadPdf}>{t('links_docs.upload')}</button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {loading ? (
              <div className="text-[#9fb0b5]">{t('common.loading')}</div>
            ) : (
              <>
                <div className="space-y-2">
                  {links.length === 0 ? (
                    <div className="text-[#9fb0b5]">{t('links_docs.no_links')}</div>
                  ) : (
                    links.map(l => (
                      <div key={l.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                        <div className="text-teal-300 truncate"><a className="hover:underline" href={l.url} target="_blank" rel="noreferrer">{l.url}</a></div>
                        <div className="text-sm text-[#cfd8dc] truncate">{l.description}</div>
                        <div className="mt-2 flex justify-end">
                          {l.can_delete ? (
                            <button className="px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 text-xs" onClick={()=> remove(l.id)}>{t('common.delete')}</button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="pt-2">
                  <div className="text-sm font-semibold mb-2">{t('links_docs.documents_section')}</div>
                  <div className="text-xs text-[#9fb0b5] mb-2">{t('links_docs.swipe_hint')}</div>
                  {docs.length === 0 ? (
                    <div className="text-[#9fb0b5]">{t('links_docs.no_documents')}</div>
                  ) : (
                    docs.map(d => {
                      const displayName = d.description || (d.file_path ? (d.file_path.split('/').pop()?.replace(/^\d+_/, '') || t('links_docs.pdf_document')) : t('links_docs.pdf_document'))
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
                        onEditStart={() => { setEditingDocId(d.id); setEditingName(d.description || ''); setEditingDetails(d.details || ''); setSwipedDocId(null) }}
                        onEditCancel={() => { setEditingDocId(null); setEditingName(''); setEditingDetails('') }}
                        onEditSave={() => renameDoc(d.id, editingName, editingDetails)}
                        onEditNameChange={setEditingName}
                        editingDetails={editingDetails}
                        onEditDetailsChange={setEditingDetails}
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

function SwipeableDocCard({ 
  doc, 
  displayName, 
  isEditing, 
  isSwiped,
  editingName,
  editingDetails,
  onSwipe,
  onEditStart, 
  onEditCancel, 
  onEditSave,
  onEditNameChange,
  onEditDetailsChange,
  onDelete,
  resolveDocUrl 
}: {
  doc: DocItem
  displayName: string
  isEditing: boolean
  isSwiped: boolean
  editingName: string
  editingDetails: string
  onSwipe: (swiped: boolean) => void
  onEditStart: () => void
  onEditCancel: () => void
  onEditSave: () => void
  onEditNameChange: (name: string) => void
  onEditDetailsChange: (details: string) => void
  onDelete: () => void
  resolveDocUrl: (path: string) => string
}) {
  const { t } = useTranslation()
  const touchRef = useRef<{ startX: number; startY: number; startTime: number } | null>(null)
  const [translateX, setTranslateX] = useState(0)
  const actionWidth = 140
  
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
    
    if (Math.abs(deltaY) > Math.abs(deltaX)) return
    
    const newX = isSwiped ? Math.max(-actionWidth, Math.min(0, deltaX - actionWidth)) : Math.max(-actionWidth, Math.min(0, deltaX))
    setTranslateX(newX)
  }
  
  const handleTouchEnd = () => {
    if (!touchRef.current || isEditing) return
    if (translateX < -actionWidth / 2) {
      setTranslateX(-actionWidth)
      onSwipe(true)
    } else {
      setTranslateX(0)
      onSwipe(false)
    }
    touchRef.current = null
  }
  
  useEffect(() => {
    if (!isSwiped) setTranslateX(0)
    else setTranslateX(-actionWidth)
  }, [isSwiped])

  return (
    <div className="relative mb-2">
      <div 
        className="absolute right-0 top-0 bottom-0 flex items-stretch rounded-r-2xl overflow-hidden"
        style={{ width: actionWidth }}
      >
        <button 
          className="flex-1 bg-[#4db6ac] flex items-center justify-center text-black font-medium"
          onClick={onEditStart}
        >
          <i className="fa-solid fa-pen" />
        </button>
        <button 
          className="flex-1 bg-red-500 flex items-center justify-center text-white font-medium"
          onClick={onDelete}
        >
          <i className="fa-solid fa-trash" />
        </button>
      </div>
      
      <div 
        className="relative bg-black border border-white/10 rounded-2xl p-3 transition-transform"
        style={{ 
          transform: `translateX(${translateX}px)`,
          transitionDuration: touchRef.current ? '0ms' : '200ms',
          backgroundColor: '#0a0a0a'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {isEditing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editingName}
              onChange={(e) => onEditNameChange(e.target.value)}
              className="flex-1 rounded-md bg-black border border-white/20 px-2 py-1 text-sm focus:border-teal-400/70 outline-none"
              placeholder={t('links_docs.document_name_placeholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') onEditSave()
                if (e.key === 'Escape') onEditCancel()
              }}
            />
            <textarea
              value={editingDetails}
              onChange={(e) => onEditDetailsChange(e.target.value)}
              className="w-full rounded-md bg-black border border-white/20 px-2 py-1 text-sm focus:border-teal-400/70 outline-none resize-none"
              placeholder={t('links_docs.document_description_optional')}
              rows={2}
            />
            <div className="flex items-center justify-end gap-2">
              <button 
                className="px-2 py-1 rounded-md bg-[#4db6ac] text-black text-xs hover:brightness-110"
                onClick={onEditSave}
              >
                {t('common.save')}
              </button>
              <button 
                className="px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 text-xs"
                onClick={onEditCancel}
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-white/90 text-sm truncate">{displayName}</div>
              {doc.details ? <div className="text-sm text-[#cfd8dc] line-clamp-2 mt-0.5">{doc.details}</div> : null}
              <div className="text-xs text-[#9fb0b5]">{doc.username} • {new Date(doc.created_at).toLocaleString()}</div>
            </div>
            <a 
              href={resolveDocUrl(doc.file_path)} 
              target="_blank" 
              rel="noreferrer"
              className="px-3 py-1.5 rounded-md border border-white/10 hover:bg-white/5 text-sm flex-shrink-0"
            >
              <i className="fa-solid fa-external-link mr-1.5" />
              {t('links_docs.open')}
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
