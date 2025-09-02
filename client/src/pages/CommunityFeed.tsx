import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'

type PollOption = { id: number; text: string; votes: number }
type Poll = { id: number; question: string; is_active: number; options: PollOption[]; user_vote: number|null; total_votes: number }
type Reply = { id: number; username: string; content: string; timestamp: string; reactions: Record<string, number>; user_reaction: string|null }
type Post = { id: number; username: string; content: string; image_path?: string|null; timestamp: string; reactions: Record<string, number>; user_reaction: string|null; poll?: Poll|null; replies: Reply[] }

export default function CommunityFeed() {
  const { community_id } = useParams()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    // Inject legacy css to match compact desktop/brand styles
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = '/static/styles.css'
    document.head.appendChild(link)
    return () => { document.head.removeChild(link) }
  }, [])

  useEffect(() => {
    let isMounted = true
    setLoading(true)
    fetch(`/api/community_feed/${community_id}`, { credentials: 'include' })
      .then(r => r.json())
      .then(json => { if (!isMounted) return; json?.success ? setData(json) : setError(json?.error || 'Error') })
      .catch(() => isMounted && setError('Error loading feed'))
      .finally(() => isMounted && setLoading(false))
    return () => { isMounted = false }
  }, [community_id])

  const timeline = useMemo(() => {
    if (!data?.posts) return []
    const items: Array<{ type: 'post'|'ad'; post?: Post }> = []
    data.posts.forEach((p: Post, idx: number) => {
      if (idx === 3) items.push({ type: 'ad' })
      items.push({ type: 'post', post: p })
    })
    if (items.length === 0) items.push({ type: 'ad' })
    return items
  }, [data])

  if (loading) return <div className="p-4 text-[#9fb0b5]">Loading…</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>
  if (!data) return null

  return (
    <div className="min-h-screen bg-[#0b0f10] text-white">
      {/* Header + burger */}
      <div className="fixed left-0 right-0 top-0 h-14 border-b border-[#333] bg-black flex items-center px-3 z-40">
        <button className="px-3 py-2 rounded border border-[#333] bg-[#1a1a1a] mr-3 md:hidden" onClick={() => setMenuOpen(v=>!v)} aria-label="Menu">
          <i className="fa-solid fa-bars" />
        </button>
        <div className="font-semibold truncate">{data.community?.name || 'Community'}</div>
      </div>

      {/* Mobile drawer menu (same links structure as desktop) */}
      {menuOpen && (
        <div className="fixed top-14 left-0 right-0 bg-[#1a1a1a] border-t border-[#333] md:hidden z-30">
          <nav className="flex flex-col">
            <a className="px-5 py-3 border-b border-[#222]" href="/dashboard">Dashboard</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/profile">Profile</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/user_chat">Messages</a>
            <a className="px-5 py-3 border-b border-[#222]" href="/communities">Your Communities</a>
            <a className="px-5 py-3" href="/your_sports">Your Sports</a>
          </nav>
        </div>
      )}

      <div className="max-w-3xl mx-auto pt-16 px-3">
        {/* Top header image from legacy template */}
        {data.community?.background_path ? (
          <div className="community-header-image mb-3">
            <img src={data.community.background_path.startsWith('http') ? data.community.background_path : `/static/community_backgrounds/${data.community.background_path.split('/').slice(-1)[0]}`}
                 alt={data.community?.name + ' Header'} className="header-image" />
          </div>
        ) : null}

        {/* Composer (stub for now) */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-3 mb-3 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-white/10" />
          <button className="flex-1 text-left text-sm text-[#9fb0b5] px-3 py-2 rounded border border-white/10 bg-white/5">Write something…</button>
          <button className="px-3 py-2 rounded bg-teal-700/20 text-teal-300 border border-teal-500/40">Post</button>
        </div>

        <div className="space-y-3">
          {timeline.map((item, i) => item.type === 'ad' ? (
            <UniversityStoreAd key={`ad-${i}`} community={data.community} />
          ) : (
            <PostCard key={item.post!.id} post={item.post!} />
          ))}
        </div>
      </div>
    </div>
  )
}

function UniversityStoreAd({ community }: { community: any }) {
  const isUni = (community?.type||'').toLowerCase() === 'university'
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex items-center gap-3">
      <div className="w-12 h-12 rounded bg-white/10 flex items-center justify-center">
        <i className="fa-solid fa-graduation-cap" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[#9fb0b5]">Sponsored • University Store</div>
        <div className="font-medium truncate">Official {community?.name || 'University'} Merch</div>
        <div className="text-sm text-[#9fb0b5] truncate">Hoodies, tees, and accessories. Show your colors.</div>
      </div>
      <button className="px-3 py-2 rounded bg-teal-700/20 text-teal-300 border border-teal-500/40" onClick={() => window.open(isUni ? 'https://store.university.example' : 'https://store.c-point.co', '_blank')}>Shop</button>
    </div>
  )
}

function PostCard({ post }: { post: Post }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-white/10" />
        <div className="font-medium">{post.username}</div>
        <div className="text-xs text-[#9fb0b5] ml-auto">{post.timestamp}</div>
      </div>
      <div className="px-3 py-2 space-y-2">
        <div className="whitespace-pre-wrap text-[14px] leading-snug">{post.content}</div>
        {post.image_path ? (
          <img src={post.image_path.startsWith('/uploads') || post.image_path.startsWith('/static') ? post.image_path : `/uploads/${post.image_path}`} alt="" className="max-h-[360px] rounded border border-white/10" />
        ) : null}
        {post.poll ? <PollBlock poll={post.poll} postId={post.id} /> : null}
        <div className="text-xs text-[#9fb0b5]">{Object.entries(post.reactions||{}).map(([k,v])=> `${k} ${v}`).join('  ') || 'No reactions yet'}</div>
        {post.replies?.length ? (
          <div className="rounded border border-white/10">
            {post.replies.map(r => (
              <div key={r.id} className="px-3 py-2 border-b border-white/10 text-sm">
                <div className="font-medium">{r.username}</div>
                <div className="text-[#dfe6e9] whitespace-pre-wrap">{r.content}</div>
                <div className="text-[11px] text-[#9fb0b5]">{r.timestamp}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function PollBlock({ poll, postId }: { poll: Poll, postId: number }) {
  async function vote(optionId: number) {
    await fetch('/vote_poll', { method: 'POST', credentials: 'include', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ poll_id: poll.id, option_id: optionId, post_id: postId }) })
    location.reload()
  }
  return (
    <div className="rounded border border-white/10 p-2">
      <div className="font-medium mb-1 text-[14px]">{poll.question}</div>
      <div className="space-y-2">
        {poll.options.map(opt => (
          <button key={opt.id} className={`w-full text-left px-3 py-2 rounded border ${poll.user_vote===opt.id?'border-teal-500/50 bg-teal-700/10':'border-white/10 bg-white/5'}`} onClick={() => vote(opt.id)}>
            {opt.text}
            <span className="float-right text-xs text-[#9fb0b5]">{opt.votes}</span>
          </button>
        ))}
      </div>
      <div className="text-xs text-[#9fb0b5] mt-1">Total votes: {poll.total_votes}</div>
    </div>
  )
}

