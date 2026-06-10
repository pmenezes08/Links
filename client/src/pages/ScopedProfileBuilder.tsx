import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import OnboardingChat from './OnboardingChat'
import { useUserProfile } from '../contexts/UserProfileContext'
import { useHeader } from '../contexts/HeaderContext'

type Section = 'personal' | 'professional'

function profileString(profile: Record<string, unknown> | null, key: string): string {
  const raw = profile?.[key]
  return typeof raw === 'string' ? raw : ''
}

export default function ScopedProfileBuilder() {
  const navigate = useNavigate()
  const { section } = useParams()
  const [searchParams] = useSearchParams()
  const { profile, loading } = useUserProfile()
  const { setTitle, setHeaderHidden } = useHeader()
  const profileRecord = profile as Record<string, unknown> | null
  const targetSection: Section = section === 'personal' ? 'personal' : 'professional'
  const communityId = searchParams.get('community_id') || ''
  const [communityName, setCommunityName] = useState('')

  const returnPath = useMemo(() => {
    return communityId ? `/community_feed_react/${communityId}` : '/premium_dashboard'
  }, [communityId])

  useEffect(() => {
    setTitle(targetSection === 'professional' ? 'Professional profile' : 'Personal profile')
    setHeaderHidden(true)
    return () => setHeaderHidden(false)
  }, [setHeaderHidden, setTitle, targetSection])

  useEffect(() => {
    if (!communityId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/community_feed/${communityId}`, {
          credentials: 'include',
          headers: { Accept: 'application/json' },
        })
        const json = await res.json().catch(() => null)
        const name = json?.community?.name
        if (!cancelled && typeof name === 'string') {
          setCommunityName(name)
        }
      } catch {
        if (!cancelled) setCommunityName('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [communityId])

  if (loading && !profileRecord) {
    return (
      <div className="min-h-screen bg-c-bg-app px-4 py-8 text-c-text-primary">
        <div className="mx-auto flex min-h-[60vh] max-w-md items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-c-border border-t-cpoint-turquoise animate-spin" />
        </div>
      </div>
    )
  }

  const firstName = profileString(profileRecord, 'first_name') || profileString(profileRecord, 'firstName')
  const lastName = profileString(profileRecord, 'last_name') || profileString(profileRecord, 'lastName')
  const username = profileString(profileRecord, 'username')
  const displayName =
    profileString(profileRecord, 'display_name') ||
    profileString(profileRecord, 'displayName') ||
    `${firstName} ${lastName}`.trim() ||
    username
  const avatar =
    profileString(profileRecord, 'profile_picture') ||
    profileString(profileRecord, 'profilePicture') ||
    profileString(profileRecord, 'avatar_url')

  return (
    <div className="min-h-screen bg-c-bg-app text-c-text-primary">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
        <div className="sticky top-0 z-30 flex justify-between px-4 pt-[calc(env(safe-area-inset-top,0px)+12px)]">
            <button
              type="button"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-c-border bg-c-bg-elevated/90 text-c-text-secondary shadow-c-card backdrop-blur hover:text-c-text-primary"
              aria-label="Back to community"
              onClick={() => navigate(returnPath)}
            >
              <i className="fa-solid fa-chevron-left text-sm" />
            </button>
            <div className="pointer-events-none min-w-0 rounded-full border border-c-border bg-c-bg-elevated/85 px-3 py-2 text-right shadow-c-card backdrop-blur">
              <div className="truncate text-[11px] font-semibold text-c-text-primary">
                {targetSection === 'professional' ? 'Professional background' : 'Personal background'}
              </div>
              {communityName ? (
                <div className="max-w-[210px] truncate text-[10px] text-c-text-tertiary">For {communityName}</div>
              ) : null}
            </div>
        </div>
        <div className="-mt-14 min-h-0 flex-1">
          <OnboardingChat
            firstName={firstName}
            lastName={lastName}
            username={username}
            displayName={displayName}
            communityName={communityName || null}
            hasCommunity={!!communityId}
            existingProfilePic={avatar}
            mode="section_only"
            targetSection={targetSection}
            onComplete={() => navigate(returnPath)}
            onCreateCommunity={() => navigate('/communities')}
            onGoToCommunity={() => navigate(returnPath)}
            onExit={() => navigate(returnPath)}
          />
        </div>
      </div>
    </div>
  )
}
