import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'

type Task = {
  id: number
  community_id: number
  title: string
  description?: string|null
  due_date?: string|null
  assigned_to_username?: string|null
  created_by_username: string
  created_at: string
  completed: number
  status?: 'not_started'|'ongoing'|'completed'
}

export default function CommunityTasks(){
  const { community_id } = useParams()
  const navigate = useNavigate()
  const { setTitle } = useHeader()
  const [tab, setTab] = useState<'community'|'mine'|'create'>('community')
  const [communityTasks, setCommunityTasks] = useState<Task[]>([])
  const [myTasks, setMyTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [members, setMembers] = useState<Array<{ username:string }>>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [assignAll, setAssignAll] = useState(false)
  const [selected, setSelected] = useState<Record<string, boolean>>({})

  useEffect(() => { setTitle('Tasks') }, [setTitle])

  useEffect(() => {
    let mounted = true
    async function load(){
      if (!community_id) return
      setLoading(true)
      try{
        const [ct, mt] = await Promise.all([
          fetch(`/api/community_tasks?community_id=${community_id}`, { credentials:'include' }).then(r=>r.json()).catch(()=>null),
          fetch(`/api/my_tasks?community_id=${community_id}`, { credentials:'include' }).then(r=>r.json()).catch(()=>null),
        ])
        if (!mounted) return
        if (ct?.success) setCommunityTasks(ct.tasks||[])
        if (mt?.success) setMyTasks(mt.tasks||[])
        // Load members and role from backend POST API
        try{
          const body = new URLSearchParams({ community_id: String(community_id) })
          const r = await fetch('/get_community_members', { method:'POST', credentials:'include', body })
          const j = await r.json().catch(()=>null)
          if (j?.success && Array.isArray(j.members)){
            setMembers(j.members.map((m:any)=> ({ username:m.username })))
            const role = String(j.current_user_role||'').toLowerCase()
            setIsAdmin(role==='owner' || role==='admin' || role==='app_admin')
          }
        } catch {}
      } finally { if (mounted) setLoading(false) }
    }
    load()
    return () => { mounted = false }
  }, [community_id])

  async function toggleComplete(t: Task, checked: boolean){
    const body = new URLSearchParams({ task_id: String(t.id), community_id: String(t.community_id), completed: checked ? 'true' : 'false' })
    await fetch('/api/complete_task', { method:'POST', credentials:'include', body })
    // Refresh lists
    try{
      const [ct, mt] = await Promise.all([
        fetch(`/api/community_tasks?community_id=${community_id}`, { credentials:'include' }).then(r=>r.json()).catch(()=>null),
        fetch(`/api/my_tasks?community_id=${community_id}`, { credentials:'include' }).then(r=>r.json()).catch(()=>null),
      ])
      if (ct?.success) setCommunityTasks(ct.tasks||[])
      if (mt?.success) setMyTasks(mt.tasks||[])
    }catch{}
  }

  async function createTask(form: FormData){
    if (!community_id) return
    const params = new URLSearchParams()
    params.append('community_id', String(community_id))
    const title = (form.get('title') as string||'').trim()
    const description = (form.get('description') as string||'').trim()
    const due_date = (form.get('due_date') as string||'').trim()
    const status = (form.get('status') as string||'').trim()
    if (!title) { alert('Title is required'); return }
    params.append('title', title)
    if (description) params.append('description', description)
    if (due_date) params.append('due_date', due_date)
    if (status) params.append('status', status)
    params.append('assign_all', assignAll ? 'true' : 'false')
    if (!assignAll){
      Object.keys(selected).filter(u => selected[u]).forEach(u => params.append('assigned_members[]', u))
    }
    const r = await fetch('/api/create_task', { method:'POST', credentials:'include', body: params })
    const j = await r.json().catch(()=>null)
    if (!j?.success){ alert(j?.error || 'Failed to create task'); return }
    setTab('community')
    setAssignAll(false)
    setSelected({})
    // Reload
    try{
      const [ct, mt] = await Promise.all([
        fetch(`/api/community_tasks?community_id=${community_id}`, { credentials:'include' }).then(r=>r.json()).catch(()=>null),
        fetch(`/api/my_tasks?community_id=${community_id}`, { credentials:'include' }).then(r=>r.json()).catch(()=>null),
      ])
      if (ct?.success) setCommunityTasks(ct.tasks||[])
      if (mt?.success) setMyTasks(mt.tasks||[])
    }catch{}
  }

  async function deleteTask(t: Task){
    if (!community_id) return
    if (!confirm('Delete this task?')) return
    const body = new URLSearchParams({ task_id: String(t.id), community_id: String(community_id) })
    const r = await fetch('/api/delete_task', { method:'POST', credentials:'include', body })
    const j = await r.json().catch(()=>null)
    if (!j?.success){ alert(j?.error || 'Failed to delete'); return }
    // refresh
    setCommunityTasks(prev => prev.filter(x => x.id !== t.id))
    setMyTasks(prev => prev.filter(x => x.id !== t.id))
  }

  function StatusPill({ s }:{ s?: Task['status'] }){
    const map:any = { not_started: 'bg-white/10 text-white', ongoing: 'bg-blue-600/20 text-blue-300', completed: 'bg-green-600/20 text-green-300' }
    const label = s === 'completed' ? 'Completed' : s === 'ongoing' ? 'Ongoing' : 'Not started'
    return <span className={`px-2 py-0.5 rounded-full text-[10px] border border-white/10 ${map[s||'not_started']}`}>{label}</span>
  }

  return (
    <div className="h-screen overflow-hidden bg-black text-white">
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-white/5" onClick={()=> navigate(`/community_feed_react/${community_id}`)} aria-label="Back">
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${tab==='community' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setTab('community')}>
              <div className="pt-2">Community Tasks</div>
              <div className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${tab==='community' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${tab==='mine' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setTab('mine')}>
              <div className="pt-2">Your Tasks</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${tab==='mine' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${tab==='create' ? 'text-white/95' : 'text-[#9fb0b5] hover:text-white/90'}`} onClick={()=> setTab('create')}>
              <div className="pt-2">Create Task</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${tab==='create' ? 'bg-[#4db6ac]' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto pt-[70px] h-[calc(100vh-70px)] pb-20 px-3 overflow-y-auto no-scrollbar">
        {loading ? (
          <div className="text-[#9fb0b5]">Loading…</div>
        ) : (
          <>
            {tab === 'community' && (
              <div className="space-y-3">
                {communityTasks.length === 0 ? (
                  <div className="text-[#9fb0b5]">No community tasks.</div>
                ) : communityTasks.map(t => (
                  <div key={t.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                    <div className="flex items-center gap-2">
                      <button aria-label="Complete task" className={`w-5 h-5 rounded grid place-items-center border ${t.completed ? 'border-[#4db6ac] bg-[#4db6ac]/20' : 'border-white/20 bg-transparent'}`} onClick={()=> toggleComplete(t, !t.completed)}>
                        <i className={`fa-solid ${t.completed ? 'fa-square-check text-[#4db6ac]' : 'fa-square text-white/60'}`} />
                      </button>
                      <div className="font-medium flex-1">{t.title}</div>
                      <StatusPill s={t.status} />
                    </div>
                    {t.description ? (<div className="text-sm text-[#cfd8dc] mt-1 whitespace-pre-wrap">{t.description}</div>) : null}
                    <div className="text-xs text-[#9fb0b5] mt-1">{t.due_date ? `Due: ${t.due_date}` : ''}</div>
                    <div className="text-right mt-2">
                      <button className="px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 text-xs" onClick={()=> deleteTask(t)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'mine' && (
              <div className="space-y-3">
                {myTasks.length === 0 ? (
                  <div className="text-[#9fb0b5]">No tasks assigned to you.</div>
                ) : myTasks.map(t => (
                  <div key={t.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                    <div className="flex items-center gap-2">
                      <button aria-label="Complete task" className={`w-5 h-5 rounded grid place-items-center border ${t.completed ? 'border-[#4db6ac] bg-[#4db6ac]/20' : 'border-white/20 bg-transparent'}`} onClick={()=> toggleComplete(t, !t.completed)}>
                        <i className={`fa-solid ${t.completed ? 'fa-square-check text-[#4db6ac]' : 'fa-square text-white/60'}`} />
                      </button>
                      <div className="font-medium flex-1">{t.title}</div>
                      <StatusPill s={t.status} />
                    </div>
                    {t.description ? (<div className="text-sm text-[#cfd8dc] mt-1 whitespace-pre-wrap">{t.description}</div>) : null}
                    <div className="text-xs text-[#9fb0b5] mt-1">{t.due_date ? `Due: ${t.due_date}` : ''}</div>
                    <div className="text-right mt-2">
                      <button className="px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 text-xs" onClick={()=> deleteTask(t)}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'create' && (
              <form className="rounded-2xl border border-white/10 p-3 bg-white/[0.035] space-y-3" onSubmit={(e)=> { e.preventDefault(); createTask(new FormData(e.currentTarget)) }}>
                <div className="text-sm font-medium">Create Task</div>
                <label className="text-xs text-[#9fb0b5]">Title
                  <input name="title" placeholder="Task title" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" required />
                </label>
                <label className="text-xs text-[#9fb0b5]">Description
                  <textarea name="description" placeholder="Task description" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none min-h-[80px]" />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-[#9fb0b5]">Due date
                    <input name="due_date" type="date" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none" />
                  </label>
                  <label className="text-xs text-[#9fb0b5]">Status
                    <select name="status" defaultValue="not_started" className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-[16px] focus:border-teal-400/70 outline-none">
                      <option value="not_started">Not started</option>
                      <option value="ongoing">Ongoing</option>
                      <option value="completed">Completed</option>
                    </select>
                  </label>
                </div>
                {isAdmin ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <button type="button" className={`px-2 py-1 rounded-md border text-xs hover:bg-white/5 ${assignAll ? 'border-teal-500 text-teal-300 bg-teal-700/15' : 'border-white/10'}`} onClick={()=> setAssignAll(v=> { const nv=!v; if(nv){ setSelected({}) } return nv })}>Assign to entire community</button>
                      {!assignAll && <span className="text-xs text-[#9fb0b5]">or select members:</span>}
                    </div>
                    {!assignAll && (
                      <div className="max-h-40 overflow-y-auto border border-white/10 rounded-md p-2 space-y-1">
                        {members.length === 0 ? (
                          <div className="text-sm text-[#9fb0b5]">No members</div>
                        ) : members.map(m => (
                          <label key={m.username} className="flex items-center justify-between gap-2 py-1 px-2 rounded hover:bg-white/5 cursor-pointer">
                            <span className="text-sm">{m.username}</span>
                            <div 
                              className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${selected[m.username] ? 'border-[#6c757d] bg-black' : 'border-[#6c757d] bg-black'}`}
                              onClick={(e)=> { e.preventDefault(); setSelected(s => ({ ...s, [m.username]: !s[m.username] })) }}
                            >
                              {selected[m.username] && (
                                <i className="fa-solid fa-check text-[#4db6ac] text-xs" />
                              )}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-xs text-[#9fb0b5]">You are not an admin. The task will be assigned to you.</div>
                )}
                <div className="flex justify-end">
                  <button className="px-3 py-1.5 rounded-md bg-[#4db6ac] text-black text-sm hover:brightness-110">Create</button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
