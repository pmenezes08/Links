import { useEffect, useState, type CSSProperties } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Avatar from '../components/Avatar'
import ImageLoader from '../components/ImageLoader'
import { formatSmartTime } from '../utils/time'
import { clearDeviceCache } from '../utils/deviceCache'

type Post = { id:number; username:string; content:string; image_path?:string|null; timestamp:string; profile_picture?:string|null; reactions: Record<string, number>; user_reaction: string|null; is_starred?: boolean }

export default function KeyPosts(){
  const { t } = useTranslation()
  const { community_id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const groupId = searchParams.get('group_id')
  const groupScope = Boolean(groupId)
  const goBack = () => navigate(groupId ? `/group_feed_react/${groupId}` : `/community_feed_react/${community_id}`)
  const [activeTab, setActiveTab] = useState<'community'|'yours'>('community')
  const [communityPosts, setCommunityPosts] = useState<Post[]>([])
  const [yourPosts, setYourPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string| null>(null)

  const openPost = (postId: number) => {
    clearDeviceCache(`post-${postId}`)
    navigate(`/post/${postId}`)
  }

  useEffect(() => {
    let ok = true
    async function load(){
      setLoading(true)
      try{
        if (groupId) {
          const tab = activeTab === 'yours' ? 'yours' : 'community'
          const r = await fetch(`/api/group_key_posts/${groupId}?tab=${tab}`, { credentials:'include' })
          const j = await r.json().catch(()=>null)
          if (!ok) return
          if (j?.success) {
            setError(null)
            if (tab === 'community') setCommunityPosts(j.posts || [])
            else setYourPosts(j.posts || [])
          } else {
            setError(j?.error || t('common.error'))
          }
          return
        }
        const communityUrl = `/api/community_key_posts?community_id=${community_id}`
        const yourUrl = `/api/key_posts?community_id=${community_id}`
        const [rc, ry] = await Promise.all([
          fetch(communityUrl, { credentials:'include' }),
          fetch(yourUrl, { credentials:'include' }),
        ])
        const jc = await rc.json().catch(()=>null)
        const jy = await ry.json().catch(()=>null)
        if (!ok) return
        if (jc?.success) setCommunityPosts(jc.posts || [])
        if (jy?.success) setYourPosts(jy.posts || [])
        if (!jc?.success && !jy?.success) setError(jc?.error || jy?.error || t('feed.key_posts_page.load_error'))
      }catch{
        if (ok) setError(t('feed.key_posts_page.load_error'))
      } finally {
        if (ok) setLoading(false)
      }
    }
    load()
    return ()=> { ok = false }
  }, [community_id, groupId, activeTab, t])

  if (loading) return <div className="p-4 text-c-text-tertiary">{t('common.loading')}</div>
  if (error) return <div className="p-4 text-red-400">{error}</div>

  const communityTabLabel = groupScope
    ? t('feed.key_posts_page.tab_group')
    : t('feed.key_posts_page.tab_community')
  const emptyCommunity = groupScope
    ? t('feed.key_posts_page.empty_group')
    : t('feed.key_posts_page.empty_community')

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      <div
        className="fixed left-0 right-0 h-10 bg-c-bg-app/70 backdrop-blur z-40"
        style={{ top: 'var(--app-header-height, calc(56px + env(safe-area-inset-top, 0px)))', '--app-subnav-height': '40px' } as CSSProperties}
      >
        <div className="max-w-2xl mx-auto h-full flex items-center gap-2 px-2">
          <button className="p-2 rounded-full hover:bg-c-hover-bg" onClick={goBack} aria-label={t('common.back')}>
            <i className="fa-solid fa-arrow-left" />
          </button>
          <div className="flex-1 h-full flex">
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='community' ? 'text-c-text-secondary' : 'text-c-text-tertiary hover:text-white/90'}`} onClick={()=> setActiveTab('community')}>
              <div className="pt-2">{communityTabLabel}</div>
              <div className={`h-0.5 rounded-full w-20 mx-auto mt-1 ${activeTab==='community' ? 'bg-[#ffd54f]' : 'bg-transparent'}`} />
            </button>
            <button type="button" className={`flex-1 text-center text-sm font-medium ${activeTab==='yours' ? 'text-c-text-secondary' : 'text-c-text-tertiary hover:text-white/90'}`} onClick={()=> setActiveTab('yours')}>
              <div className="pt-2">{t('feed.key_posts_page.tab_yours')}</div>
              <div className={`h-0.5 rounded-full w-16 mx-auto mt-1 ${activeTab==='yours' ? 'bg-cpoint-turquoise' : 'bg-transparent'}`} />
            </button>
          </div>
        </div>
      </div>
      <div
        className="app-subnav-offset max-w-2xl mx-auto px-3 pb-16 overflow-y-auto"
        style={{
          WebkitOverflowScrolling: 'touch' as any,
          minHeight: 'calc(100vh - var(--app-header-offset, calc(56px + env(safe-area-inset-top, 0px))))',
          '--app-subnav-height': '40px',
        } as CSSProperties}
      >
        <div className="mb-3 flex items-center">
          <div className="font-semibold">{t('feed.key_posts')}</div>
        </div>
        {activeTab === 'community' ? (
          communityPosts.length === 0 ? (
            <div className="text-sm text-c-text-tertiary">{emptyCommunity}</div>
          ) : (
            <div className="space-y-3">
              {communityPosts.map(p => (
                <div key={p.id} className="rounded-2xl border border-c-border bg-c-bg-app shadow-sm shadow-black/20 cursor-pointer" onClick={()=> openPost(p.id)}>
                  <div className="px-3 py-2 border-b border-c-border flex items-center gap-2">
                    <Avatar username={p.username} url={p.profile_picture || undefined} size={28} linkToProfile />
                    <div className="font-medium">{p.username}</div>
                    <div className="text-xs text-c-text-tertiary ml-auto">{formatSmartTime((p as any).display_timestamp || p.timestamp)}</div>
                    <i className="fa-solid fa-thumbtack" style={{ color:'#ffd54f' }} />
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{p.content}</div>
                    {p.image_path ? (
                      <ImageLoader
                        src={(() => {
                          const ip = String(p.image_path || '').trim()
                          if (!ip) return ''
                          if (ip.startsWith('http')) return ip
                          if (ip.startsWith('/uploads') || ip.startsWith('/static')) return ip
                          return ip.startsWith('uploads') || ip.startsWith('static') ? `/${ip}` : `/uploads/${ip}`
                        })()}
                        alt={t('feed.post_image_alt')}
                        className="block mx-auto max-w-full max-h-[360px] rounded border border-c-border"
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          yourPosts.length === 0 ? (
            <div className="text-sm text-c-text-tertiary">{t('feed.key_posts_page.empty_yours')}</div>
          ) : (
            <div className="space-y-3">
              {yourPosts.map(p => (
                <div key={p.id} className="rounded-2xl border border-c-border bg-c-bg-app shadow-sm shadow-black/20 cursor-pointer" onClick={()=> openPost(p.id)}>
                  <div className="px-3 py-2 border-b border-c-border flex items-center gap-2">
                    <Avatar username={p.username} url={p.profile_picture || undefined} size={28} linkToProfile />
                    <div className="font-medium">{p.username}</div>
                    <div className="text-xs text-c-text-tertiary ml-auto">{formatSmartTime((p as any).display_timestamp || p.timestamp)}</div>
                    <i className="fa-solid fa-star" style={{ color:'#00CEC8' }} />
                  </div>
                  <div className="px-3 py-2 space-y-2">
                    <div className="whitespace-pre-wrap text-[14px] leading-relaxed">{p.content}</div>
                    {p.image_path ? (
                      <ImageLoader
                        src={(() => {
                          const ip = String(p.image_path || '').trim()
                          if (!ip) return ''
                          if (ip.startsWith('http')) return ip
                          if (ip.startsWith('/uploads') || ip.startsWith('/static')) return ip
                          return ip.startsWith('uploads') || ip.startsWith('static') ? `/${ip}` : `/uploads/${ip}`
                        })()}
                        alt={t('feed.post_image_alt')}
                        className="block mx-auto max-w-full max-h-[360px] rounded border border-c-border"
                      />
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}
