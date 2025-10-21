import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useHeader } from '../contexts/HeaderContext'
import Avatar from '../components/Avatar'
import { formatSmartTime } from '../utils/time'
import ImageLoader from '../components/ImageLoader'
import VideoEmbed from '../components/VideoEmbed'
import { extractVideoEmbed, removeVideoUrlFromText } from '../utils/videoEmbed'
import { renderTextWithLinks } from '../utils/linkUtils.tsx'

type PollOption = { id: number; text: string; votes: number; user_voted?: boolean }
type Poll = { id: number; question: string; is_active: number; options: PollOption[]; user_vote: number|null; total_votes: number; single_vote?: boolean }
type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; display_timestamp?:string; community_id?:number|null; community_name?:string; reactions:Record<string,number>; user_reaction:string|null; poll?:Poll|null; replies_count?:number; profile_picture?:string|null }

export default function HomeTimeline(){
  const navigate = useNavigate()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    let link = document.getElementById('legacy-styles') as HTMLLinkElement | null
    if (!link){
      link = document.createElement('link')
      link.id = 'legacy-styles'
      link.rel = 'stylesheet'
      link.href = '/static/base.css'
      document.head.appendChild(link)
    }
    return () => { link?.remove() }
  }, [])

  // Refresh data when page becomes visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        setRefreshKey(prev => prev + 1)
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  useEffect(() => {
    let mounted = true
    async function load(){
      setLoading(true)
      try{
        const r = await fetch('/api/home_timeline', { credentials:'include' })
        const j = await r.json()
        if (!mounted) return
        if (j?.success){ setData(j) } else { setError(j?.error || 'Error') }
      }catch{ if (mounted) setError('Error loading') } finally { if (mounted) setLoading(false) }
    }
    load()
    return () => { mounted = false }
  }, [refreshKey])

  const posts: Post[] = useMemo(() => data?.posts || [], [data])
  
  const { setTitle } = useHeader()

  useEffect(() => { setTitle('Home') }, [setTitle])

  async function handlePollVote(postId: number, pollId: number, optionId: number){
    // Optimistic update for poll vote
    setData((prev:any) => {
      if (!prev) return prev
      const updatedPosts = (prev.posts || []).map((p: any) => {
        if (p.id !== postId || !p.poll) return p
        const poll = p.poll
        
        // Find the option being clicked and check if user already voted on it
        const clickedOption = poll.options.find((opt: any) => opt.id === optionId)
        const hasVotedOnThisOption = clickedOption?.user_voted || false
        
        const updatedOptions = poll.options.map((opt: any) => {
          if (opt.id === optionId) {
            // Toggle: if already voted, remove vote; otherwise add vote
            return { 
              ...opt, 
              votes: hasVotedOnThisOption ? Math.max(0, opt.votes - 1) : opt.votes + 1,
              user_voted: !hasVotedOnThisOption
            }
          }
          // If single vote, reduce previous vote when voting on different option
          if (poll.single_vote !== false && opt.user_voted && opt.id !== optionId) {
            return { ...opt, votes: Math.max(0, opt.votes - 1), user_voted: false }
          }
          return opt
        })
        
        // Update user_vote for single vote polls
        const newUserVote = hasVotedOnThisOption ? null : optionId
        return { ...p, poll: { ...poll, options: updatedOptions, user_vote: poll.single_vote !== false ? newUserVote : poll.user_vote } }
      })
      return { ...prev, posts: updatedPosts }
    })

    // Send vote to server
    try{
      const res = await fetch('/vote_poll', { method:'POST', credentials:'include', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ poll_id: pollId, option_id: optionId }) })
      const j = await res.json().catch(()=>null)
      if (!j?.success){
        // Reload on error
        setRefreshKey(prev => prev + 1)
      } else {
        // Reload to get correct user_voted state from server
        setRefreshKey(prev => prev + 1)
      }
    }catch{
      setRefreshKey(prev => prev + 1)
    }
  }

  return (
    <div className="fixed inset-x-0 top-14 bottom-0 bg-black text-white">
      {/* Secondary header below global header */}

      {/* Secondary tabs */}
      <div className="fixed left-0 right-0 top-14 h-10 bg-black/70 backdrop-blur z-40">
        <div className="max-w-2xl mx-auto h-full flex">
          <button type="button" className="flex-1 text-center text-sm font-medium text-white/95">
            <div className="pt-2">Home timeline</div>
            <div className="h-0.5 bg-[#4db6ac] rounded-full w-16 mx-auto mt-1" />
          </button>
          <button type="button" className="flex-1 text-center text-sm font-medium text-[#9fb0b5] hover:text-white/90" onClick={()=> navigate('/communities')}>
            <div className="pt-2">Communities</div>
            <div className="h-0.5 bg-transparent rounded-full w-16 mx-auto mt-1" />
          </button>
        </div>
      </div>

      <div className="h-full max-w-2xl mx-auto overflow-y-auto px-3 pb-24" style={{ WebkitOverflowScrolling: 'touch' as any, paddingTop: '50px' }}>
        {loading ? (
          <div className="p-3 text-[#9fb0b5]">Loading…</div>
        ) : error ? (
          <div className="p-3 text-red-400">{error}</div>
        ) : posts.length === 0 ? (
          <div className="p-3 text-[#9fb0b5]">No recent posts</div>
        ) : (
          <div className="space-y-3">
            {posts.map(p => (
              <div key={p.id} className="rounded-2xl border border-white/10 bg-black shadow-sm shadow-black/20 cursor-pointer" onClick={p.poll ? undefined : () => navigate(`/post/${p.id}`)}>
                <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2" onClick={(e)=> e.stopPropagation()}>
                  <Avatar username={p.username} url={p.profile_picture || undefined} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      <div className="font-medium tracking-[-0.01em] truncate">{p.username}</div>
                      {p.community_name ? (
                        <div className="text-xs text-[#9fb0b5] truncate">in {p.community_name}</div>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-xs text-[#9fb0b5] ml-auto tabular-nums">{formatSmartTime(p.display_timestamp || p.timestamp)}</div>
                </div>
                <div className="py-2 space-y-2">
                  {(() => {
                    // Always use fresh content from post object
                    const content = p.content || ''
                    const videoEmbed = extractVideoEmbed(content)
                    const displayContent = videoEmbed ? removeVideoUrlFromText(content, videoEmbed) : content
                    
                    if (!videoEmbed && !displayContent) return null
                    return (
                      <>
                        {displayContent && <div className="px-3 whitespace-pre-wrap text-[14px] leading-relaxed">{renderTextWithLinks(displayContent)}</div>}
                        {videoEmbed && <VideoEmbed embed={videoEmbed} />}
                      </>
                    )
                  })()}
                  {p.image_path ? (
                    <ImageLoader
                      src={(() => {
                        const ip = p.image_path as string
                        if (!ip) return ''
                        if (ip.startsWith('http')) return ip
                        if (ip.startsWith('/uploads') || ip.startsWith('/static')) return ip
                        return ip.startsWith('uploads') ? `/${ip}` : `/uploads/${ip}`
                      })()}
                      alt="Post image"
                      className="w-full h-auto"
                    />
                  ) : null}
                  {/* Poll display */}
                  {p.poll && (
                    <div className="px-3 space-y-2" onClick={(e)=> e.stopPropagation()}>
                      <div className="flex items-center gap-2 mb-2">
                        <i className="fa-solid fa-chart-bar text-[#4db6ac]" />
                        <div className="font-medium text-sm">{p.poll.question}</div>
                      </div>
                      <div className="space-y-2">
                        {p.poll.options?.map(option => {
                          const percentage = p.poll?.total_votes ? Math.round((option.votes / p.poll.total_votes) * 100) : 0
                          const isUserVote = option.user_voted || false
                          return (
                            <button
                              key={option.id}
                              type="button"
                              className={`w-full text-left px-3 py-2 rounded-lg border relative overflow-hidden ${isUserVote ? 'border-[#4db6ac] bg-[#4db6ac]/10' : 'border-white/10 hover:bg-white/5'}`}
                              onClick={(e)=> { e.preventDefault(); e.stopPropagation(); if (handlePollVote) handlePollVote(p.id, p.poll!.id, option.id) }}
                            >
                              <div className="absolute inset-0 bg-[#4db6ac]/20" style={{ width: `${percentage}%`, transition: 'width 0.3s ease' }} />
                              <div className="relative flex items-center justify-between">
                                <span className="text-sm">{option.text}</span>
                                <span className="text-xs text-[#9fb0b5] font-medium">{option.votes} {percentage > 0 ? `(${percentage}%)` : ''}</span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex items-center justify-between text-xs text-[#9fb0b5] pt-1">
                        <span>{p.poll.total_votes || 0} {p.poll.total_votes === 1 ? 'vote' : 'votes'}</span>
                        {p.community_id && (
                          <button 
                            type="button"
                            onClick={(e)=> { e.preventDefault(); e.stopPropagation(); navigate(`/community/${p.community_id}/polls_react`) }}
                            className="text-[#4db6ac] hover:underline"
                          >
                            View all polls →
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
