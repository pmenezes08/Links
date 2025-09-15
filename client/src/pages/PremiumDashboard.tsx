import { useEffect, useState } from 'react'
import { useHeader } from '../contexts/HeaderContext'
import { useNavigate } from 'react-router-dom'

// type Community = { id: number; name: string; type: string }

export default function PremiumDashboard() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [hasGymAccess, setHasGymAccess] = useState(false)
  const [communities, setCommunities] = useState<Array<{id: number, name: string, type: string}>>([])
  const [parentsWithChildren, setParentsWithChildren] = useState<Set<number>>(new Set())
  const { setTitle } = useHeader()
  useEffect(() => { setTitle('Dashboard') }, [setTitle])
  const navigate = useNavigate()

  useEffect(() => {
    async function loadUserData() {
      try {
        // Check gym membership
        const gymResponse = await fetch('/api/check_gym_membership', {
          method: 'GET',
          credentials: 'include'
        })
        const gymData = await gymResponse.json()
        setHasGymAccess(gymData.hasGymAccess || false)

        // Get all user communities
        const parentResponse = await fetch('/api/user_parent_community', {
          method: 'GET',
          credentials: 'include'
        })
        const parentData = await parentResponse.json()
        console.log('Dashboard: Parent communities API response:', parentData)
        if (parentData.success && parentData.communities) {
          console.log('Dashboard: Setting communities:', parentData.communities)
          setCommunities(parentData.communities)
        } else {
          console.log('Dashboard: No communities found or API error')
        }

        // Fetch hierarchical communities to detect which parents have children
        try {
          const hierResp = await fetch('/api/user_communities_hierarchical', { credentials: 'include' })
          const hierData = await hierResp.json()
          const parents = new Set<number>()
          if (hierData?.success && Array.isArray(hierData.communities)) {
            for (const c of hierData.communities) {
              const pid: number | null | undefined = c.parent_community_id
              if (pid !== null && pid !== undefined) parents.add(pid as number)
            }
          }
          setParentsWithChildren(parents)
        } catch {}
      } catch (error) {
        console.error('Error loading user data:', error)
        setHasGymAccess(false)
        setCommunities([])
      }
    }
    
    loadUserData()
  }, [])


  return (
    <div className="min-h-screen pt-14 bg-[#0b0f10] text-white">
      {/* Desktop sidebar */}
      <div className="fixed left-0 top-14 bottom-0 w-52 border-r border-[#333] bg-[#1a1a1a] hidden md:flex flex-col z-30">
        <div className="flex items-center h-14 px-2 border-b border-[#333]">
          <div className="text-white font-semibold text-base truncate pl-2">Dashboard</div>
        </div>
        <nav className="flex-1 overflow-y-auto py-2">
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/dashboard">Dashboard</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/profile">Profile</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/user_chat">Messages</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/communities">Your Communities</a>
          {hasGymAccess && <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/your_sports">Your Sports</a>}
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/logout">Logout</a>
          <a className="block px-5 py-3 text-sm hover:bg-teal-700/20 hover:text-teal-300" href="/account_settings"><i className="fa-solid fa-cog mr-2" />Settings</a>
        </nav>
      </div>

      {/* page content starts below header via pt-14 */}

      {/* Mobile dropdown menu */}
      {mobileMenuOpen && (
        <div className="fixed top-14 left-0 right-0 z-40 border-t border-[#333] bg-[#1a1a1a] md:hidden">
          <nav className="flex flex-col">
            <a className="px-5 py-3 border-b border-[#222]" href="/dashboard" onClick={() => setMobileMenuOpen(false)}>Dashboard</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/profile" onClick={() => setMobileMenuOpen(false)}>Profile</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/user_chat" onClick={() => setMobileMenuOpen(false)}>Messages</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/communities" onClick={() => setMobileMenuOpen(false)}>Your Communities</a>
            {hasGymAccess && <a className="px-5 py-3 border-b border-[#222]" href="/your_sports" onClick={() => setMobileMenuOpen(false)}>Your Sports</a>}
            <a className="px-5 py-3 border-b border-[#222]" href="/logout" onClick={() => setMobileMenuOpen(false)}>Logout</a>
            <a className="px-5 py-3" href="/account_settings" onClick={() => setMobileMenuOpen(false)}><i className="fa-solid fa-cog mr-2" />Settings</a>
          </nav>
        </div>
      )}

      <div className="">
        {/* Desktop profile summary (kept, but edit profile removed) */}
        <div className="hidden md:flex fixed right-5 top-20 w-44 h-44 rounded-lg border border-[#333] md:border-white/20 bg-[#1a1a1a] md:bg-white/5 flex-col items-center gap-2 p-3">
          <div className="w-20 h-20 rounded-full bg-white/5 border border-white/20 flex items-center justify-center">
            <i className="fa-solid fa-user text-2xl text-[#9fb0b5]" />
          </div>
          <div className="text-sm font-semibold truncate max-w-[10rem]">You</div>
        </div>

        {/* Cards grid */}
        <div className="flex items-start justify-center px-3 md:ml-52 py-6">
          <div className="w-full max-w-5xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Show all communities */}
            {communities.map(community => {
              const typeLower = (community.type || '').toLowerCase()
              const hasChildren = parentsWithChildren.has(community.id)
              const onCardClick = () => {
                if (typeLower === 'gym') {
                  navigate('/gym')
                } else if (!hasChildren) {
                  navigate(`/community_feed_react/${community.id}`)
                } else {
                  navigate(`/communities?parent_id=${community.id}`)
                }
              }
              return (
                <Card 
                  key={community.id}
                  iconClass="fa-solid fa-house" 
                  title={community.name} 
                  onClick={onCardClick} 
                />
              )
            })}
            {hasGymAccess && (
              <>
                <Card iconClass="fa-solid fa-dumbbell" title="Gym" onClick={() => navigate('/gym')} />
                <Card iconClass="fa-solid fa-person-snowboarding" title="Your Sports" onClick={() => (location.assign('/your_sports'))} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Communities modal removed; button links to /communities */}
    </div>
  )
}

function Card({ iconClass, title, onClick }:{ iconClass:string; title:string; onClick:()=>void }){
  return (
    <button
      onClick={onClick}
      aria-label={title}
      className="group relative w-full h-40 rounded-2xl overflow-hidden text-white transition-all duration-300
                 bg-black border border-white/10 hover:border-teal-400/30
                 shadow-[0_10px_30px_rgba(0,0,0,0.4)] hover:shadow-[0_16px_40px_rgba(0,0,0,0.55)] hover:-translate-y-0.5"
    >
      {/* subtle glow on hover */}
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
           style={{ background: 'radial-gradient(600px circle at var(--x,50%) var(--y,50%), rgba(77,182,172,0.10), transparent 40%)' }} />

      <div className="absolute inset-0 flex flex-row items-center justify-start gap-3 px-6">
        <i className={iconClass} style={{ fontSize: 24, color: '#4db6ac' }} />
        <div className="text-[15px] font-semibold tracking-tight text-white/90">{title}</div>
      </div>

      {/* top accent line */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-teal-400/40 to-transparent opacity-60" />
    </button>
  )
}

