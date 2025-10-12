import { useEffect, useState, useRef, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatSmartTime } from '../utils/time'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import VideoEmbed from '../components/VideoEmbed'
import { extractVideoEmbed, removeVideoUrlFromText } from '../utils/videoEmbed'
import { renderTextWithLinks } from '../utils/linkUtils.tsx'

type Community = { 
  id: number; 
  name: string; 
  type?: string; 
  is_active?: boolean;
  parent_community_id?: number;
  children?: Community[];
  creator_username?: string;
}

export default function Communities(){
  const navigate = useNavigate()
  const location = useLocation()
  const { setTitle } = useHeader()
  const [_data, setData] = useState<{ username:string; current_user_profile_picture?:string|null; community_name?:string }|null>(null)
  const [communities, setCommunities] = useState<Community[]>([])
  const [parentName, setParentName] = useState<string>('')
  const [parentType, setParentType] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [swipedCommunity, setSwipedCommunity] = useState<number|null>(null)
  const [activeTab, setActiveTab] = useState<'timeline'|'management'|'training'>(() => {
    const qs = new URLSearchParams(location.search)
    return qs.get('parent_id') ? 'timeline' : 'management'
  })
  // Sub-community creation state
  const [showCreateSubModal, setShowCreateSubModal] = useState(false)
  const [newSubName, setNewSubName] = useState('')
  const [newSubType, setNewSubType] = useState<string>('')
  // Group creation
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [approvalRequired, setApprovalRequired] = useState(false)
  const [selectedSubCommunityId, setSelectedSubCommunityId] = useState<number | 'none'>('none')
  // Groups modal (list & join)
  const [showGroupsModal, setShowGroupsModal] = useState(false)
  const [groupsModalCommunityId, setGroupsModalCommunityId] = useState<number|null>(null)
  const openGroups = (cid: number) => { setGroupsModalCommunityId(cid); setShowGroupsModal(true) }
  const showTrainingTab = useMemo(() => {
    const parent = communities && communities.length > 0 ? communities[0] : null
    const parentTypeLower = ((parent as any)?.community_type || parent?.type || parentType || '').toLowerCase()
    return parentTypeLower === 'gym'
  }, [communities, parentType])
  

  useEffect(() => {
    const link = document.getElementById('legacy-styles') as HTMLLinkElement | null
    if (!link){
      const l = document.createElement('link')
      l.id = 'legacy-styles'
      l.rel = 'stylesheet'
      l.href = '/static/styles.css'
      document.head.appendChild(l)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    let inflight = false
    async function load(){
      if (inflight) return
      inflight = true
      setLoading(true)
      try{
        // Fetch current user meta from home timeline endpoint
        try{
          const r = await fetch(`/api/profile_me`, { credentials:'include' })
          const j = await r.json().catch(()=>null)
          if (mounted && j?.success && j.profile){
            setData({ username: j.profile.username, current_user_profile_picture: j.profile.profile_picture })
          }
        }catch{}

        const rc = await fetch('/api/user_communities_hierarchical', { credentials:'include' })
        const jc = await rc.json()
        if (!mounted) return
        if (jc?.success){
          // Optional filtering by parent_id
          const qs = new URLSearchParams(location.search)
          const parentIdParam = qs.get('parent_id')
          const all: Community[] = jc.communities || []
          if (parentIdParam) {
            const pid = Number(parentIdParam)
            const parent = all.find(c => c.id === pid)
            if (parent) {
              const subset: Community[] = [{ ...parent, children: parent.children || [] }]
              setCommunities(subset)
              setParentName(parent.name)
              setParentType(parent.type || '')
            } else {
              setCommunities(all)
              setParentName('')
              try {
                // If navigated without parent_id but only one parent root is in view, capture its type
                const roots = all.filter(c => !c.parent_community_id)
                if (roots.length === 1) setParentType(roots[0].type || '')
                else setParentType('')
              } catch { setParentType('') }
            }
          } else {
            setCommunities(all)
            setParentName('')
            setParentType('')
          }
          setError(null)
        } else {
          setError(jc?.error || 'Error loading communities')
        }
      }catch{
        if (mounted) setError('Error loading communities')
      } finally {
        inflight = false
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [])

  useEffect(() => { 
    if (parentName) setTitle(`Community: ${parentName}`)
    else setTitle('Community Management')
  }, [setTitle, parentName])

  return (
    <div className="h-screen overflow-hidden bg-black text-white relative">
      {/* Global header used from App */}

      {/* Secondary nav like X */}
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex items-center">
          <button
            type="button"
            className="mr-2 p-2 rounded-full hover:bg-white/5"
            onClick={()=> navigate('/premium_dashboard')}
            aria-label="Back"
          >
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 flex items-center justify-center gap-8 overflow-x-auto no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' as any }}>
            <button 
              type="button" 
              className={`text-sm font-medium ${activeTab==='timeline' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} 
              onClick={()=> {
                const pidLocal = new URLSearchParams(location.search).get('parent_id')
                if (!pidLocal) { navigate('/home'); return }
                setActiveTab('timeline')
                const el = document.getElementById('parent-timeline')
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              <div className="pt-2 whitespace-nowrap text-center">Home Timeline</div>
              <div className={`h-0.5 ${activeTab==='timeline' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
            </button>
            <button 
              type="button" 
              className={`text-sm font-medium ${activeTab==='management' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`}
              onClick={()=> setActiveTab('management')}
            >
              <div className="pt-2 whitespace-nowrap text-center">Community Management</div>
              <div className={`h-0.5 ${activeTab==='management' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
            </button>
            {showTrainingTab && (
              <button 
                type="button" 
                className={`text-sm font-medium ${activeTab==='training' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`}
                onClick={()=> setActiveTab('training')}
              >
                <div className="pt-2 whitespace-nowrap text-center">Your Training</div>
                <div className={`h-0.5 ${activeTab==='training' ? 'bg-[#4db6ac]' : 'bg-transparent'} rounded-full w-16 mx-auto mt-1`} />
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Groups Modal Root */}
      <GroupsModal
        open={showGroupsModal}
        onClose={()=> setShowGroupsModal(false)}
        communityId={groupsModalCommunityId}
      />

      {/* Slide-out menu (90% width) same as feed */}
      {/* Menu unified via HeaderBar */}

      <div className="max-w-2xl mx-auto pt-[70px] h-[calc(100vh-70px)] pb-6 px-3 overflow-y-auto no-scrollbar">
        {loading ? (
          <div className="text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="text-red-400">{error}</div>
        ) : (
          <div className="space-y-3">
             {(() => {
              const pidLocal = new URLSearchParams(location.search).get('parent_id')
              if (pidLocal && activeTab === 'timeline') {
                return (
                  <div id="parent-timeline">
                    <ParentTimeline parentId={Number(pidLocal)} />
                  </div>
                )
              }
               if (pidLocal && activeTab === 'training' && showTrainingTab) {
                 return (
                   <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                     <button
                       className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black text-sm hover:brightness-110"
                       onClick={()=> {
                         const pidNext = new URLSearchParams(location.search).get('parent_id')
                         window.location.href = pidNext ? `/workout_tracking?parent_id=${pidNext}` : '/workout_tracking'
                       }}
                     >
                       Go to Workout Tracking
                     </button>
                   </div>
                 )
               }
              return (
                <>
                  {!pidLocal && (
                    <JoinCommunity onJoined={()=>{ window.location.reload() }} />
                  )}
                  {activeTab === 'training' && showTrainingTab ? (
                    <div className="bg-white/5 backdrop-blur rounded-xl p-4 border border-white/10">
                      <button
                        className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black text-sm hover:brightness-110"
                        onClick={()=> {
                          const pidNext = new URLSearchParams(location.search).get('parent_id')
                          window.location.href = pidNext ? `/workout_tracking?parent_id=${pidNext}` : '/workout_tracking'
                        }}
                      >
                        Go to Workout Tracking
                      </button>
                    </div>
                  ) : communities.length === 0 ? (
                    <div className="text-[#9fb0b5]">You are not a member of any communities.</div>
                  ) : communities.map(c => (
                    <div key={c.id} className="space-y-2">
                  <CommunityItem 
                        community={c} 
                        isSwipedOpen={swipedCommunity === c.id}
                        onSwipe={(isOpen) => setSwipedCommunity(isOpen ? c.id : null)}
                        onEnter={() => {
                          const ua = navigator.userAgent || ''
                          const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua) || window.innerWidth < 768
                          if (isMobile) navigate(`/community_feed_react/${c.id}`); else window.location.href = `/community_feed/${c.id}`
                        }}
                        onDeleteOrLeave={async (asDelete:boolean) => {
                          const fd = new URLSearchParams({ community_id: String(c.id) })
                          const url = asDelete ? '/delete_community' : '/leave_community'
                          const r = await fetch(url, { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                          const j = await r.json().catch(()=>null)
                          if (j?.success) window.location.reload()
                          else alert(j?.error||`Error ${asDelete?'deleting':'leaving'} community`)
                        }}
                        currentUsername={_data?.username || ''}
                        onOpenGroups={openGroups}
                      />
                      {c.children && c.children.length > 0 && (
                        <div className="ml-6 space-y-2">
                          {c.children.map(child => (
                            <CommunityItem 
                              key={child.id}
                              community={child} 
                              isSwipedOpen={swipedCommunity === child.id}
                              onSwipe={(isOpen) => setSwipedCommunity(isOpen ? child.id : null)}
                              onEnter={() => {
                                const ua = navigator.userAgent || ''
                                const isMobile = /Mobi|Android|iPhone|iPad/i.test(ua) || window.innerWidth < 768
                                if (isMobile) navigate(`/community_feed_react/${child.id}`); else window.location.href = `/community_feed/${child.id}`
                              }}
                              onDeleteOrLeave={async (asDelete:boolean) => {
                                const fd = new URLSearchParams({ community_id: String(child.id) })
                                const url = asDelete ? '/delete_community' : '/leave_community'
                                const r = await fetch(url, { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                                const j = await r.json().catch(()=>null)
                                if (j?.success) window.location.reload()
                                else alert(j?.error||`Error ${asDelete?'deleting':'leaving'} community`)
                              }}
                              isChild={true}
                              currentUsername={_data?.username || ''}
                              onOpenGroups={openGroups}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )
            })()}
          </div>
        )}
      </div>
      {/* Create Sub-Community FAB and Modal */}
      {(() => {
        const pidLocal = new URLSearchParams(location.search).get('parent_id')
        const canCreateChild = activeTab === 'management' && !!pidLocal
        if (!canCreateChild) return null
        const parentTypeLabel = parentType || 'General'
        const parentIdNum = Number(pidLocal)
        return (
          <>
            <PlusActions
              onCreateSub={() => { setNewSubName(''); setNewSubType(parentTypeLabel); setShowCreateSubModal(true) }}
              onCreateGroup={() => { setShowCreateGroup(true); setNewGroupName(''); setApprovalRequired(false) }}
            />

            {showCreateSubModal && (
              <div
                className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center"
                onClick={(e)=> { if (e.currentTarget === e.target) setShowCreateSubModal(false) }}
              >
                <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-sm">Create Sub-Community</div>
                    <button className="p-2 rounded-md hover:bg:white/5" onClick={()=> setShowCreateSubModal(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Parent Community</label>
                      <input value={parentName || `ID ${parentIdNum}`}
                             disabled
                             className="w-full px-3 py-2 rounded-md bg-black border border-white/15 text-sm text-white/70 disabled:opacity-70"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Sub-Community Name</label>
                      <input value={newSubName}
                             onChange={e=> setNewSubName(e.target.value)}
                             placeholder="e.g., Powerlifting Club"
                             className="w-full px-3 py-2 rounded-md bg-black border border-white/15 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Community Type</label>
                      <select value={newSubType || parentTypeLabel}
                              onChange={e=> setNewSubType(e.target.value)}
                              className="w-full px-3 py-2 rounded-md bg-black border border-white/15 text-sm">
                        <option value={parentTypeLabel}>Parent Community Type ({parentTypeLabel || 'General'})</option>
                        <option value="General">General</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={()=> setShowCreateSubModal(false)}>Cancel</button>
                      <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={async()=>{
                        if (!newSubName.trim()) { alert('Please provide a sub-community name'); return }
                        try{
                          const fd = new URLSearchParams({ name: newSubName.trim(), type: (newSubType || parentTypeLabel || 'General') })
                          fd.append('parent_community_id', String(parentIdNum))
                          const r = await fetch('/create_community', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                          const j = await r.json().catch(()=>null)
                          if (j?.success){
                            setShowCreateSubModal(false)
                            setNewSubName('')
                            // Refresh current view to show the new child
                            window.location.reload()
                          } else {
                            alert(j?.error || 'Failed to create sub-community')
                          }
                        }catch{
                          alert('Network error')
                        }
                      }}>Create</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Create Group Modal */}
            {showCreateGroup && (
              <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> { if (e.currentTarget === e.target) setShowCreateGroup(false) }}>
                <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="font-semibold text-sm">Create Group</div>
                    <button className="p-2 rounded-md hover:bg:white/5" onClick={()=> setShowCreateGroup(false)} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Parent Community</label>
                      <input value={parentName || `ID ${parentIdNum}`} disabled className="w-full px-3 py-2 rounded-md bg-black border border-white/15 text-sm text-white/70 disabled:opacity-70" />
                    </div>
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Sub-Community</label>
                      <select value={selectedSubCommunityId === 'none' ? 'none' : String(selectedSubCommunityId)} onChange={e=> {
                        const v = e.target.value
                        setSelectedSubCommunityId(v === 'none' ? 'none' : Number(v))
                      }} className="w-full px-3 py-2 rounded-md bg-black border border-white/15 text-sm">
                        <option value="none">None (associate to parent only)</option>
                        {(() => {
                          const parent = communities.find(c => c.id === parentIdNum)
                          const subs = parent?.children || []
                          return subs.map(sc => (
                            <option key={sc.id} value={String(sc.id)}>{sc.name}</option>
                          ))
                        })()}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Group Name</label>
                      <input value={newGroupName} onChange={e=> setNewGroupName(e.target.value)} placeholder="e.g., Morning Runners" className="w-full px-3 py-2 rounded-md bg-black border border-white/15 text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs text-[#9fb0b5] mb-1">Join Policy</label>
                      <select value={approvalRequired ? 'approval' : 'open'} onChange={e=> setApprovalRequired(e.target.value === 'approval')} className="w-full px-3 py-2 rounded-md bg-black border border-white/15 text-sm">
                        <option value="open">Any member can join</option>
                        <option value="approval">Approval required</option>
                      </select>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <button className="px-3 py-2 rounded-md bg:white/10 hover:bg:white/15" onClick={()=> setShowCreateGroup(false)}>Cancel</button>
                      <button className="px-3 py-2 rounded-md bg-[#4db6ac] text-black hover:brightness-110" onClick={async()=>{
                        if (!newGroupName.trim()) { alert('Please provide a group name'); return }
                        try{
                          const targetCommunityId = selectedSubCommunityId === 'none' ? parentIdNum : Number(selectedSubCommunityId)
                          const fd = new URLSearchParams({ community_id: String(targetCommunityId), name: newGroupName.trim(), approval_required: approvalRequired ? '1' : '0' })
                          const r = await fetch('/api/groups/create', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                          const j = await r.json().catch(()=>null)
                          if (j?.success){ setShowCreateGroup(false); setNewGroupName(''); alert('Group created') }
                          else alert(j?.error || 'Failed to create group')
                        }catch{ alert('Network error') }
                      }}>Create</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )
      })()}
    </div>
  )
}

function PlusActions({ onCreateSub, onCreateGroup }:{ onCreateSub: ()=>void, onCreateGroup: ()=>void }){
  const [open, setOpen] = useState(false)
  return (
    <div className="fixed bottom-6 right-6 z-50">
      {open && (
        <div className="mb-2 rounded-xl border border-white/10 bg-black/80 backdrop-blur p-2 w-56 shadow-lg">
          <button className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm" onClick={()=> { setOpen(false); onCreateSub() }}>
            Create Sub-Community
          </button>
          <button className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm" onClick={()=> { setOpen(false); onCreateGroup() }}>
            Create Group
          </button>
        </div>
      )}
      <button className="w-14 h-14 rounded-full bg-[#4db6ac] text-black shadow-lg hover:brightness-110 grid place-items-center border border-[#4db6ac]" onClick={()=> setOpen(v=>!v)} aria-label="Actions">
        <i className="fa-solid fa-plus" />
      </button>
    </div>
  )
}

function GroupsModal({ open, onClose, communityId }:{ open:boolean, onClose: ()=>void, communityId: number | null }){
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<Array<{ id:number; name:string; approval_required:boolean; membership_status?: string | null; community_id:number, can_delete?: boolean }>>([])
  const [isMember, setIsMember] = useState<boolean | null>(null)
  useEffect(() => {
    const el = document.getElementById('groups-modal-root') as any
    if (el){
      el.__reactOpen = (cid:number)=>{
        try{
          const evt = new CustomEvent('open-groups-modal', { detail: { cid } })
          window.dispatchEvent(evt)
        }catch{}
      }
    }
  }, [])
  useEffect(() => {
    let ok = true
    async function load(){
      if (!open || !communityId) return
      setLoading(true)
      try{
        const r = await fetch(`/api/groups?community_id=${communityId}&include_ancestors=0`, { credentials:'include' })
        if (r.status === 403){ setIsMember(false); setItems([]); return }
        const j = await r.json().catch(()=>null)
        if (!ok) return
        if (j?.success){ setItems(j.groups||[]); setIsMember(typeof j.member === 'boolean' ? j.member : true) }
        else { setItems([]) }
      }catch{ if (ok) setItems([]) }
      finally{ if (ok) setLoading(false) }
    }
    load(); return ()=> { ok = false }
  }, [open, communityId])
  if (!open) return <div id="groups-modal-root" />
  return (
    <div id="groups-modal-root" className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center" onClick={(e)=> { if (e.currentTarget === e.target) onClose() }}>
      <div className="w-[92%] max-w-sm rounded-2xl border border-white/10 bg-[#0b0f10] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-semibold text-sm">Groups</div>
          <button className="p-2 rounded-md hover:bg:white/5" onClick={onClose} aria-label="Close"><i className="fa-solid fa-xmark"/></button>
        </div>
        {loading ? (
          <div className="text-[#9fb0b5] text-sm">Loading…</div>
        ) : (isMember === false) ? (
          <div className="space-y-3">
            <div className="text-[#9fb0b5] text-sm">Join this community to view and join its groups.</div>
            <div className="flex justify-end">
              <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text:black text-sm hover:brightness-110" onClick={()=> { onClose(); window.location.href = `/community_feed_react/${communityId}` }}>Go to community</button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="text-[#9fb0b5] text-sm">No groups available.</div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {items.map(g => {
              const status = g.membership_status
              return (
                <div key={g.id} className="flex items-center gap-2 border border-white/10 rounded-lg p-2">
                  <div className="flex-1">
                    <button className="font-medium text-white underline decoration-white/20 underline-offset-2" onClick={()=> {
                      if (status !== 'member'){
                        alert('Join this group to view its activity')
                        return
                      }
                      window.location.href = `/group_feed_react/${g.id}`
                    }}>{g.name}</button>
                    <div className="text-xs text-[#9fb0b5]">{g.approval_required ? 'Approval required' : 'Open to members'}</div>
                  </div>
                  {status === 'member' ? (
                    <span className="text-xs text-[#4db6ac]">Joined</span>
                  ) : status === 'pending' ? (
                    <span className="text-xs text-yellow-400">Pending</span>
                  ) : (
                    <button className="px-2.5 py-1.5 rounded-md bg-[#4db6ac] text-black text-xs hover:brightness-110" onClick={async()=>{
                      try{
                        const fd = new URLSearchParams({ group_id: String(g.id) })
                        const r = await fetch('/api/groups/join', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
                        const j = await r.json().catch(()=>null)
                        if (j?.success){ setItems(list => list.map(it => it.id===g.id ? ({ ...it, membership_status: j.status }) : it)) }
                        else alert(j?.error || 'Failed to join group')
                      }catch{ alert('Network error') }
                    }}>Join</button>
                  )}
                  {g.can_delete ? (
                    <button className="ml-2 px-2.5 py-1.5 rounded-md border border-red-500/30 text-red-400 text-xs hover:bg-red-500/10" onClick={async()=>{
                      const ok = confirm('Delete this group? This cannot be undone.')
                      if (!ok) return
                      try{
                        const fd = new URLSearchParams({ group_id: String(g.id) })
                        const r = await fetch('/api/groups/delete', { method:'POST', credentials:'include', body: fd })
                        const j = await r.json().catch(()=>null)
                        if (j?.success){ setItems(list => list.filter(it => it.id !== g.id)) }
                        else alert(j?.error || 'Failed to delete group')
                      }catch{ alert('Network error') }
                    }}>Delete</button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ParentTimeline({ parentId }:{ parentId:number }){
  const navigate = useNavigate()
  const [posts, setPosts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|undefined>()
  const [loadedOnce, setLoadedOnce] = useState(false)
  // Module-level caches to prevent duplicate network requests across quick remounts
  const cacheRef = (window as any).__parentTlCache || ((window as any).__parentTlCache = new Map<number, { ts:number; posts:any[] }>())
  const inflightRef = (window as any).__parentTlInflight || ((window as any).__parentTlInflight = new Map<number, Promise<any>>())
  useEffect(() => {
    let ok = true
    let inflight = false
    async function load(){
      if (inflight) return
      inflight = true
      // Try session cache first to avoid refetch loops on remount
      try{
        const key = `parent_tl_cache:${parentId}`
        const raw = sessionStorage.getItem(key)
        if (raw){
          const cached = JSON.parse(raw)
          if (cached && Array.isArray(cached.posts) && typeof cached.ts === 'number' && (Date.now() - cached.ts) < 10000){
            setPosts(cached.posts)
            setLoading(false)
            setLoadedOnce(true)
            inflight = false
            return
          }
        }
        // Check module-level cache/inflight as well
        const entry = cacheRef.get(parentId)
        if (entry && (Date.now() - entry.ts) < 10000){
          setPosts(entry.posts || [])
          setLoading(false)
          setLoadedOnce(true)
          inflight = false
          return
        }
        const existing = inflightRef.get(parentId)
        if (existing){
          await existing
          const after = cacheRef.get(parentId)
          if (ok && after){
            setPosts(after.posts || [])
            setLoading(false)
            setLoadedOnce(true)
          }
          inflight = false
          return
        }
      }catch{}
      setLoading(true)
      try{
        const promise = (async () => {
          const r = await fetch(`/api/community_group_feed/${parentId}`, { credentials:'include' })
          return await r.json()
        })()
        inflightRef.set(parentId, promise)
        const j = await promise
        if (!ok) return
        if (j?.success){
          setPosts(j.posts || [])
          try{ sessionStorage.setItem(`parent_tl_cache:${parentId}`, JSON.stringify({ ts: Date.now(), posts: j.posts||[] })) }catch{}
          try{ cacheRef.set(parentId, { ts: Date.now(), posts: j.posts||[] }) }catch{}
        }
        else setError(j?.error || 'Error loading timeline')
      }catch{
        if (ok) setError('Error loading timeline')
      }finally{
        inflightRef.delete(parentId)
        inflight = false
        if (ok){ setLoading(false); setLoadedOnce(true) }
      }
    }
    load()
    return ()=>{ ok = false }
  }, [parentId])

  if (loading && !loadedOnce) return null
  if (error && !loadedOnce) return null

  return (
    <div>
      {posts.length === 0 ? (
        <div className="text-[#9fb0b5] text-sm">No posts created in the past 48h</div>
      ) : (
        <div className="space-y-3">
          {posts.map((p:any) => (
            <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer"
              onClick={() => navigate(`/post/${p.id}`)}
            >
              <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2" onClick={(e)=> e.stopPropagation()}>
                <Avatar username={p.username || ''} url={p.profile_picture || undefined} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2 min-w-0">
                    <div className="font-medium truncate">{p.username}</div>
                    {p.community_name ? (
                      <div className="text-xs text-[#9fb0b5] truncate">in {p.community_name}</div>
                    ) : null}
                  </div>
                </div>
                <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatSmartTime(p.created_at)}</div>
              </div>
              <div className="px-3 py-2 space-y-2">
                {(() => {
                  const videoEmbed = extractVideoEmbed(p.content || '')
                  const displayContent = videoEmbed ? removeVideoUrlFromText(p.content, videoEmbed) : p.content
                  return (
                    <>
                      {displayContent && <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{renderTextWithLinks(displayContent)}</div>}
                      {videoEmbed && <VideoEmbed embed={videoEmbed} />}
                    </>
                  )
                })()}
                {p.image_path ? (
                  <ImageLoader
                    src={(() => {
                      const ip = String(p.image_path || '').trim()
                      if (!ip) return ''
                      if (ip.startsWith('http')) return ip
                      if (ip.startsWith('/uploads') || ip.startsWith('/static')) return ip
                      return ip.startsWith('uploads') || ip.startsWith('static') ? `/${ip}` : `/uploads/${ip}`
                    })()}
                    alt="Post image"
                    className="block mx-auto max-w-full max-h-[360px] rounded border border-white/10"
                  />
                ) : null}
                <div className="flex items-center gap-2 text-xs" onClick={(e)=> e.stopPropagation()}>
                  <button className="px-2 py-1 rounded transition-colors" onClick={async()=>{
                    // Optimistic toggle
                    const prev = p.user_reaction
                    const next = prev === 'heart' ? null : 'heart'
                    const counts = { ...(p.reactions||{}) }
                    if (prev) counts[prev] = Math.max(0, (counts[prev]||0)-1)
                    if (next) counts[next] = (counts[next]||0)+1
                    setPosts(list => list.map(it => it.id===p.id ? ({ ...it, user_reaction: next, reactions: counts }) : it))
                    try{
                      const fd = new URLSearchParams({ post_id: String(p.id), reaction: 'heart' })
                      const r = await fetch('/add_reaction', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                      const j = await r.json().catch(()=>null)
                      if (j?.success){
                        setPosts(list => list.map(it => it.id===p.id ? ({ ...it, reactions: { ...(it.reactions||{}), ...j.counts }, user_reaction: j.user_reaction }) : it))
                      }
                    }catch{}
                  }}>
                    <i className={`fa-regular fa-heart ${p.user_reaction==='heart' ? '' : ''}`} style={{ color: p.user_reaction==='heart' ? '#4db6ac' : '#6c757d', WebkitTextStroke: p.user_reaction==='heart' ? '1px #4db6ac' : undefined }} />
                    <span className="ml-1" style={{ color: p.user_reaction==='heart' ? '#cfe9e7' : '#9fb0b5' }}>{(p.reactions?.['heart'])||0}</span>
                  </button>
                  <button className="px-2 py-1 rounded transition-colors" onClick={async()=>{
                    const prev = p.user_reaction
                    const next = prev === 'thumbs-up' ? null : 'thumbs-up'
                    const counts = { ...(p.reactions||{}) }
                    if (prev) counts[prev] = Math.max(0, (counts[prev]||0)-1)
                    if (next) counts[next] = (counts[next]||0)+1
                    setPosts(list => list.map(it => it.id===p.id ? ({ ...it, user_reaction: next, reactions: counts }) : it))
                    try{
                      const fd = new URLSearchParams({ post_id: String(p.id), reaction: 'thumbs-up' })
                      const r = await fetch('/add_reaction', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                      const j = await r.json().catch(()=>null)
                      if (j?.success){
                        setPosts(list => list.map(it => it.id===p.id ? ({ ...it, reactions: { ...(it.reactions||{}), ...j.counts }, user_reaction: j.user_reaction }) : it))
                      }
                    }catch{}
                  }}>
                    <i className="fa-regular fa-thumbs-up" style={{ color: p.user_reaction==='thumbs-up' ? '#4db6ac' : '#6c757d', WebkitTextStroke: p.user_reaction==='thumbs-up' ? '1px #4db6ac' : undefined }} />
                    <span className="ml-1" style={{ color: p.user_reaction==='thumbs-up' ? '#cfe9e7' : '#9fb0b5' }}>{(p.reactions?.['thumbs-up'])||0}</span>
                  </button>
                  <button className="px-2 py-1 rounded transition-colors" onClick={async()=>{
                    const prev = p.user_reaction
                    const next = prev === 'thumbs-down' ? null : 'thumbs-down'
                    const counts = { ...(p.reactions||{}) }
                    if (prev) counts[prev] = Math.max(0, (counts[prev]||0)-1)
                    if (next) counts[next] = (counts[next]||0)+1
                    setPosts(list => list.map(it => it.id===p.id ? ({ ...it, user_reaction: next, reactions: counts }) : it))
                    try{
                      const fd = new URLSearchParams({ post_id: String(p.id), reaction: 'thumbs-down' })
                      const r = await fetch('/add_reaction', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/x-www-form-urlencoded' }, body: fd })
                      const j = await r.json().catch(()=>null)
                      if (j?.success){
                        setPosts(list => list.map(it => it.id===p.id ? ({ ...it, reactions: { ...(it.reactions||{}), ...j.counts }, user_reaction: j.user_reaction }) : it))
                      }
                    }catch{}
                  }}>
                    <i className="fa-regular fa-thumbs-down" style={{ color: p.user_reaction==='thumbs-down' ? '#4db6ac' : '#6c757d', WebkitTextStroke: p.user_reaction==='thumbs-down' ? '1px #4db6ac' : undefined }} />
                    <span className="ml-1" style={{ color: p.user_reaction==='thumbs-down' ? '#cfe9e7' : '#9fb0b5' }}>{(p.reactions?.['thumbs-down'])||0}</span>
                  </button>
                  <button className="ml-auto px-2.5 py-1 rounded-full text-[#cfd8dc]" onClick={()=> navigate(`/post/${p.id}`)}>
                    <i className="fa-regular fa-comment" />
                    <span className="ml-1">{p.replies_count||0}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CommunityItem({ 
  community, 
  isSwipedOpen, 
  onSwipe, 
  onEnter, 
  onDeleteOrLeave,
  isChild = false,
  currentUsername,
  onOpenGroups
}: { 
  community: Community
  isSwipedOpen: boolean
  onSwipe: (isOpen: boolean) => void
  onEnter: () => void
  onDeleteOrLeave: (asDelete:boolean) => void
  isChild?: boolean
  currentUsername: string
  onOpenGroups: (communityId:number)=>void
}) {
  const [dragX, setDragX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startXRef = useRef(0)
  const ACTIONS_WIDTH = 160 // reveal width to show both action buttons (2 x 80px)

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX
    setIsDragging(true)
    setDragX(isSwipedOpen ? -ACTIONS_WIDTH : 0)
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return
    const currentX = e.touches[0].clientX
    const deltaX = currentX - startXRef.current
    const newDragX = Math.max(-ACTIONS_WIDTH, Math.min(0, deltaX + (isSwipedOpen ? -ACTIONS_WIDTH : 0)))
    setDragX(newDragX)
  }

  const handleTouchEnd = () => {
    if (!isDragging) return
    setIsDragging(false)
    
    const shouldOpen = dragX < -40
    onSwipe(shouldOpen)
    setDragX(0)
  }

  const handleClick = () => {
    if (isSwipedOpen) {
      onSwipe(false)
    } else if (Math.abs(dragX) < 10) {
      onEnter()
    }
  }

  const handleLeaveClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm(`Are you sure you want to leave ${community.name}?`)) {
      try {
        await onDeleteOrLeave(false)
      } catch (error) {
        console.error('Error leaving community:', error)
        alert('Failed to leave community. Please try again.')
      }
    }
  }

  const handleDeleteClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (window.confirm(`Delete "${community.name}"? This cannot be undone.`)){
      try{
        await onDeleteOrLeave(true)
      }catch(err){
        console.error('Error deleting community:', err)
        alert('Failed to delete community. Please try again.')
      }
    }
  }

  return (
    <div 
      className={`relative w-full overflow-hidden rounded-2xl transition-all duration-200 bg-black ${
        isSwipedOpen || dragX < -10 
          ? 'border-2 border-[#4db6ac]' 
          : 'border border-white/10'
      }`}
    >
      {/* Action button (Leave or Delete depending on ownership) */}
      <div className="absolute inset-y-0 right-0 flex items-center">
        {/* Groups button */}
        <button
          className="h-full w-20 bg-[#4db6ac]/20 text-[#4db6ac] flex items-center justify-center hover:bg-[#4db6ac]/30 transition-all duration-200"
          onClick={(e)=> { e.stopPropagation(); onOpenGroups(community.id) }}
          style={{
            opacity: isSwipedOpen || dragX < -20 ? 1 : 0,
            transform: `translateX(${isSwipedOpen ? '0' : '100%'})`,
            transition: isDragging ? 'none' : 'all 0.2s ease-out'
          }}
        >
          <div className="flex flex-col items-center gap-1">
            <i className="fa-solid fa-users text-sm" />
            <span className="text-xs font-medium">Groups</span>
          </div>
        </button>
        {community.creator_username && currentUsername === community.creator_username ? (
          <button
            className="h-full w-20 bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-all duration-200 rounded-r-2xl"
            onClick={handleDeleteClick}
            style={{
              opacity: isSwipedOpen || dragX < -20 ? 1 : 0,
              transform: `translateX(${isSwipedOpen ? '0' : '100%'})`,
              transition: isDragging ? 'none' : 'all 0.2s ease-out'
            }}
          >
            <div className="flex flex-col items-center gap-1">
              <i className="fa-solid fa-trash text-sm" />
              <span className="text-xs font-medium">Delete</span>
            </div>
          </button>
        ) : (
          <button
            className="h-full w-20 bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-all duration-200 rounded-r-2xl"
            onClick={handleLeaveClick}
            style={{
              opacity: isSwipedOpen || dragX < -20 ? 1 : 0,
              transform: `translateX(${isSwipedOpen ? '0' : '100%'})`,
              transition: isDragging ? 'none' : 'all 0.2s ease-out'
            }}
          >
            <div className="flex flex-col items-center gap-1">
              <i className="fa-solid fa-user-minus text-sm" />
              <span className="text-xs font-medium">Leave</span>
            </div>
          </button>
        )}
      </div>

      {/* Swipeable community content */}
      <div
        className={`w-full px-3 py-3 hover:bg-white/[0.03] flex items-center justify-between cursor-pointer bg-black ${isChild ? 'pl-4' : ''}`}
        style={{
          transform: `translateX(${isDragging ? dragX : (isSwipedOpen ? -ACTIONS_WIDTH : 0)}px)`,
          transition: isDragging ? 'none' : 'transform 0.2s ease-out'
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onClick={handleClick}
      >
        <div className="flex-1 flex items-center">
          {isChild && <div className="w-4 h-4 mr-2 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-[#4db6ac]" />
          </div>}
          <div className="flex-1">
            <div className="font-medium text-white">{community.name}</div>
            <div className="text-xs text-[#9fb0b5]">{community.type || 'Community'}</div>
          </div>
        </div>
        <div className="text-[#4db6ac]">
          <i className="fa-solid fa-chevron-right" />
        </div>
      </div>
      {/* FAB removed pending proper state wiring */}
    </div>
  )
}

// Global opener for groups modal
;(window as any).openGroupsModal = async (communityId: number) => {
  try{
    const el = document.getElementById('groups-modal-root') as any
    if (el && el.__open){ el.__open(communityId) }
  }catch{}
}

function JoinCommunity({ onJoined }:{ onJoined: ()=>void }){
  const [code, setCode] = useState('')
  const submit = async()=>{
    if (!code.trim()) return
    const fd = new URLSearchParams({ community_code: code.trim() })
    const r = await fetch('/join_community', { method:'POST', credentials:'include', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: fd })
    const j = await r.json().catch(()=>null)
    if (j?.success) onJoined()
    else alert(j?.error||'Invalid code')
  }
  return (
    <div className="w-full flex items-center justify-center">
      <div className="w-[80%] max-w-md flex items-center gap-2">
        <input value={code} onChange={e=> setCode(e.target.value)} placeholder="Enter join code" className="flex-1 px-3 py-2 bg-black border border-[#666] text-white placeholder-[#888] focus:outline-none rounded-md" />
        <button aria-label="Join" title="Join" onClick={submit}
          className="w-10 h-10 rounded-full hover:bg-white/5 text-white flex items-center justify-center">
          <i className="fa-solid fa-user-plus" style={{ color: '#22d3c7' }} />
        </button>
      </div>
    </div>
  )
}

