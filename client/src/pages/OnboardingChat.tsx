import { useState, useEffect, useRef, useCallback } from 'react'

type Stage =
  | 'welcome'
  | 'name'
  | 'display_name'
  | 'photo'
  | 'role'
  | 'location'
  | 'linkedin'
  | 'bio'
  | 'enriching'
  | 'review'
  | 'complete'

interface ChatMessage {
  from: 'steve' | 'user'
  text: string
  options?: { label: string; value: string; icon?: string }[]
  cards?: EnrichmentCard[]
  photoUpload?: boolean
  inputType?: 'text' | 'url' | 'textarea'
  inputPlaceholder?: string
}

interface EnrichmentCard {
  id: string
  section: string
  label: string
  detail: string
  field: string
  status?: 'pending' | 'accepted' | 'dismissed'
}

interface Collected {
  firstName: string
  lastName: string
  displayName: string
  role: string
  company: string
  city: string
  country: string
  linkedin: string
  bio: string
}

interface OnboardingChatProps {
  firstName: string
  lastName: string
  username: string
  displayName: string
  communityName?: string | null
  hasCommunity: boolean
  existingProfilePic: string
  onComplete: () => void
  onCreateCommunity: () => void
  onGoToCommunity: () => void
}

const STAGE_ORDER: Stage[] = [
  'welcome', 'name', 'display_name', 'photo', 'role', 'location', 'linkedin', 'bio', 'enriching', 'review', 'complete',
]

function stageProgress(stage: Stage): number {
  const idx = STAGE_ORDER.indexOf(stage)
  if (idx < 0) return 0
  return Math.round((idx / (STAGE_ORDER.length - 1)) * 100)
}

export default function OnboardingChat({
  firstName: initFirst,
  lastName: initLast,
  username,
  displayName: initDisplay,
  communityName,
  hasCommunity,
  existingProfilePic,
  onComplete,
  onCreateCommunity,
  onGoToCommunity,
}: OnboardingChatProps) {
  const [stage, setStage] = useState<Stage>('welcome')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [collected, setCollected] = useState<Collected>({
    firstName: initFirst || '',
    lastName: initLast || '',
    displayName: initDisplay || '',
    role: '',
    company: '',
    city: '',
    country: '',
    linkedin: '',
    bio: '',
  })
  const [isTyping, setIsTyping] = useState(false)
  const [picFile, setPicFile] = useState<File | null>(null)
  const [picPreview, setPicPreview] = useState(existingProfilePic || '')
  const [uploadingPic, setUploadingPic] = useState(false)
  const [enrichmentCards, setEnrichmentCards] = useState<EnrichmentCard[]>([])
  const [enriching, setEnriching] = useState(false)
  const [initialized, setInitialized] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [])

  const addSteveMessage = useCallback((text: string, opts?: Partial<ChatMessage>) => {
    setIsTyping(true)
    setTimeout(() => {
      setIsTyping(false)
      setMessages(prev => [...prev, { from: 'steve', text, ...opts }])
      scrollToBottom()
    }, 600 + Math.random() * 400)
  }, [scrollToBottom])

  const addUserMessage = useCallback((text: string) => {
    setMessages(prev => [...prev, { from: 'user', text }])
    scrollToBottom()
  }, [scrollToBottom])

  const saveField = useCallback(async (field: string, value: string) => {
    try {
      await fetch('/api/onboarding/save_field', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field, value }),
      })
    } catch {}
  }, [])

  const saveState = useCallback(async (s: Stage, c: Collected) => {
    try {
      await fetch('/api/onboarding/state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: s, collected: c }),
      })
    } catch {}
  }, [])

  // ── Initialize: load saved state or start fresh ──
  useEffect(() => {
    if (initialized) return
    setInitialized(true)
    ;(async () => {
      try {
        const r = await fetch('/api/onboarding/state', { credentials: 'include' })
        const j = await r.json().catch(() => null)
        if (j?.success && j.state && j.state.stage && j.state.stage !== 'complete') {
          const saved = j.state
          if (saved.collected) {
            setCollected(prev => ({ ...prev, ...saved.collected }))
          }
          setStage(saved.stage)
          startStage(saved.stage, saved.collected || collected)
          return
        }
      } catch {}
      startStage('welcome', collected)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startStage(s: Stage, c?: Collected) {
    const data = c || collected
    switch (s) {
      case 'welcome': {
        const greeting = data.firstName
          ? `Hey ${data.firstName}! 👋`
          : 'Hey there! 👋'
        let welcomeText = `${greeting} I'm Steve, your AI assistant here at CPoint.`
        if (communityName) {
          welcomeText += ` I see you were invited to ${communityName} — exciting!`
        }
        welcomeText += ` Let me help you set up your profile so people in your networks can find you. This will only take a couple of minutes.`
        addSteveMessage(welcomeText, {
          options: [{ label: "Let's go!", value: 'start', icon: '🚀' }],
        })
        break
      }
      case 'name': {
        const hasName = data.firstName && data.lastName
        if (hasName) {
          addSteveMessage(`I have your name as ${data.firstName} ${data.lastName} — is that right?`, {
            options: [
              { label: "That's correct", value: 'confirm_name', icon: '✅' },
              { label: 'Let me fix that', value: 'edit_name', icon: '✏️' },
            ],
          })
        } else {
          addSteveMessage("Let's start with your name. What's your first and last name?", {
            inputType: 'text',
            inputPlaceholder: 'First Last',
          })
        }
        break
      }
      case 'display_name': {
        const suggestion = `${data.firstName} ${data.lastName}`.trim() || username
        addSteveMessage(`Great! How would you like to appear on the platform? Your display name can be different from your real name.`, {
          inputType: 'text',
          inputPlaceholder: suggestion,
        })
        setInputValue(suggestion)
        break
      }
      case 'photo':
        addSteveMessage("Now let's add a profile picture — it helps people recognize you.", {
          photoUpload: true,
          options: [{ label: 'Skip for now', value: 'skip_photo', icon: '⏭️' }],
        })
        break
      case 'role':
        addSteveMessage("What do you do professionally? Something like \"Product Manager at Google\" or \"Founder, building in fintech\" works great.", {
          inputType: 'text',
          inputPlaceholder: 'e.g. Product Manager at Google',
        })
        break
      case 'location':
        addSteveMessage('Where are you based?', {
          inputType: 'text',
          inputPlaceholder: 'e.g. Munich, Germany',
        })
        break
      case 'linkedin':
        addSteveMessage("Got a LinkedIn URL? It really helps me learn more about your background. Feel free to skip if you'd rather not share.", {
          inputType: 'url',
          inputPlaceholder: 'https://linkedin.com/in/yourprofile',
          options: [{ label: 'Skip', value: 'skip_linkedin', icon: '⏭️' }],
        })
        break
      case 'bio':
        addSteveMessage('Last one — how would you introduce yourself at a networking event? 2-3 sentences is perfect.', {
          inputType: 'textarea',
          inputPlaceholder: 'Tell people a bit about yourself...',
        })
        break
      case 'enriching':
        addSteveMessage("Awesome, thanks! Give me a moment — I'm looking up some public info to help build out your profile. This is based only on publicly available information. 🔍")
        triggerEnrichment()
        break
      case 'review':
        if (enrichmentCards.length > 0) {
          addSteveMessage("Here's what I found about you publicly. You can accept or dismiss each one:", {
            cards: enrichmentCards,
          })
        } else {
          addSteveMessage("I couldn't find additional public information right now — no worries! Your profile is looking great with what you've provided.")
          setTimeout(() => advanceToComplete(), 800)
        }
        break
      case 'complete':
        showComplete()
        break
    }
  }

  function advanceTo(next: Stage, data?: Collected) {
    const c = data || collected
    setStage(next)
    saveState(next, c)
    startStage(next, c)
  }

  function advanceToComplete() {
    setStage('complete')
    showComplete()
  }

  function showComplete() {
    addSteveMessage(
      "You're all set! 🎉 Your profile is live and people in your networks can now find you.\n\nI'm always here if you need anything — just DM me or tag @Steve in any chat.\n\nBy the way, did you know you can create your own communities? Planning a trip with friends? Starting a book club? Organizing weekend tennis? A community is just a group of people you want to keep connected.",
      {
        options: [
          { label: hasCommunity ? 'Take me to my feed' : 'Explore the platform', value: 'go_feed', icon: '🚀' },
          { label: 'Create a community', value: 'create_community', icon: '➕' },
        ],
      }
    )
  }

  async function triggerEnrichment() {
    setEnriching(true)
    try {
      const r = await fetch('/api/onboarding/enrich', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      })
      const j = await r.json().catch(() => null)
      if (j?.success && j.enrichment && j.enrichment.length > 0) {
        const cards = j.enrichment.map((c: EnrichmentCard) => ({ ...c, status: 'pending' as const }))
        setEnrichmentCards(cards)
        setEnriching(false)
        advanceTo('review')
        return
      }
    } catch {}
    setEnriching(false)
    addSteveMessage("I couldn't find additional public information right now — no worries! Your profile is looking great with what you've provided.")
    setTimeout(() => advanceToComplete(), 1200)
  }

  function handleCardAction(cardId: string, action: 'accepted' | 'dismissed') {
    setEnrichmentCards(prev => prev.map(c => c.id === cardId ? { ...c, status: action } : c))
  }

  function allCardsReviewed(): boolean {
    return enrichmentCards.length > 0 && enrichmentCards.every(c => c.status !== 'pending')
  }

  async function handleFinishReview() {
    addUserMessage('Done reviewing')
    const accepted = enrichmentCards.filter(c => c.status === 'accepted')
    if (accepted.length > 0) {
      addSteveMessage(`Great choices! I've added ${accepted.length} item${accepted.length > 1 ? 's' : ''} to your profile.`)
    }
    // Save accepted enrichment data to Firestore via state
    try {
      await fetch('/api/onboarding/state', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage: 'complete',
          collected,
          acceptedEnrichment: accepted.map(c => c.id),
        }),
      })
    } catch {}
    setTimeout(() => advanceToComplete(), 800)
  }

  async function handleOptionClick(value: string) {
    switch (value) {
      case 'start':
        addUserMessage("Let's go!")
        advanceTo('name')
        break
      case 'confirm_name':
        addUserMessage("That's correct")
        advanceTo('display_name')
        break
      case 'edit_name':
        addUserMessage('Let me fix that')
        addSteveMessage("No problem! What's your first and last name?", {
          inputType: 'text',
          inputPlaceholder: 'First Last',
        })
        break
      case 'skip_photo':
        addUserMessage('Skip for now')
        addSteveMessage("No problem — you can always add one later from your profile.")
        setTimeout(() => advanceTo('role'), 600)
        break
      case 'skip_linkedin':
        addUserMessage('Skip')
        advanceTo('bio')
        break
      case 'go_feed':
        await completeOnboarding()
        if (hasCommunity) {
          onGoToCommunity()
        } else {
          onComplete()
        }
        break
      case 'create_community':
        await completeOnboarding()
        onCreateCommunity()
        break
    }
  }

  async function completeOnboarding() {
    try {
      await fetch('/api/onboarding/complete', { method: 'POST', credentials: 'include' })
    } catch {}
    try { localStorage.setItem(`onboarding_done:${username}`, '1') } catch {}
  }

  async function handleSubmit() {
    const val = inputValue.trim()
    if (!val) return
    addUserMessage(val)
    setInputValue('')

    const isOffScript = detectOffScript(stage, val)
    if (isOffScript) {
      await handleOffScript(val)
      return
    }

    switch (stage) {
      case 'name': {
        const parts = val.split(/\s+/)
        const first = parts[0] || ''
        const last = parts.slice(1).join(' ') || ''
        if (!first) {
          addSteveMessage("I need at least a first name! What's your first and last name?", {
            inputType: 'text',
            inputPlaceholder: 'First Last',
          })
          return
        }
        const newCollected = { ...collected, firstName: first, lastName: last }
        setCollected(newCollected)
        await saveField('first_name', first)
        if (last) await saveField('last_name', last)
        advanceTo('display_name', newCollected)
        break
      }
      case 'display_name': {
        const newCollected = { ...collected, displayName: val }
        setCollected(newCollected)
        await saveField('display_name', val)
        advanceTo('photo', newCollected)
        break
      }
      case 'role': {
        const roleMatch = val.match(/^(.+?)\s+at\s+(.+)$/i)
        let role = val
        let company = ''
        if (roleMatch) {
          role = roleMatch[1].trim()
          company = roleMatch[2].trim()
        }
        const newCollected = { ...collected, role, company }
        setCollected(newCollected)
        await saveField('role', role)
        if (company) await saveField('company', company)

        const reactions = [
          'Nice!',
          'That sounds great!',
          'Awesome!',
          'Interesting!',
          'Cool!',
        ]
        const reaction = reactions[Math.floor(Math.random() * reactions.length)]
        addSteveMessage(reaction)
        setTimeout(() => advanceTo('location', newCollected), 600)
        break
      }
      case 'location': {
        const locParts = val.split(',').map(s => s.trim())
        const city = locParts[0] || val
        const country = locParts[1] || ''
        const newCollected = { ...collected, city, country }
        setCollected(newCollected)
        await saveField('city', city)
        if (country) await saveField('country', country)
        advanceTo('linkedin', newCollected)
        break
      }
      case 'linkedin': {
        const newCollected = { ...collected, linkedin: val }
        setCollected(newCollected)
        await saveField('linkedin', val)
        addSteveMessage('Perfect, that will help me learn more about your background!')
        setTimeout(() => advanceTo('bio', newCollected), 600)
        break
      }
      case 'bio': {
        const newCollected = { ...collected, bio: val }
        setCollected(newCollected)
        await saveField('bio', val)
        advanceTo('enriching', newCollected)
        break
      }
      default:
        break
    }
  }

  function detectOffScript(currentStage: Stage, input: string): boolean {
    const lower = input.toLowerCase()
    if (currentStage === 'name') {
      return lower.length > 60 || lower.includes('?') || /^(hey|hi|hello|what|how|can|tell|who)/.test(lower)
    }
    if (currentStage === 'display_name') return false
    if (currentStage === 'role') {
      return lower.length > 150 || (lower.includes('?') && !lower.includes('at'))
    }
    if (currentStage === 'location') {
      return lower.length > 80 || (/^(hey|what|how|can|tell|who)/.test(lower) && lower.includes('?'))
    }
    if (currentStage === 'linkedin') {
      if (lower.includes('linkedin.com') || lower.includes('skip')) return false
      return lower.includes('?') || /^(hey|what|how|can|tell)/.test(lower)
    }
    if (currentStage === 'bio') return false
    return false
  }

  async function handleOffScript(userMsg: string) {
    setIsTyping(true)
    try {
      const questionMap: Record<string, string> = {
        name: "What's your first and last name?",
        role: 'What do you do professionally?',
        location: 'Where are you based?',
        linkedin: 'Got a LinkedIn URL?',
      }
      const r = await fetch('/api/onboarding/redirect', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          stage,
          currentQuestion: questionMap[stage] || '',
        }),
      })
      const j = await r.json().catch(() => null)
      setIsTyping(false)
      const redirectMsg = j?.message || "Interesting! Let's come back to that. For now, let's finish getting you set up."
      setMessages(prev => [...prev, { from: 'steve', text: redirectMsg }])
      scrollToBottom()
    } catch {
      setIsTyping(false)
      setMessages(prev => [...prev, { from: 'steve', text: "Great thought! Let's finish setting up your profile first." }])
      scrollToBottom()
    }
  }

  async function handlePhotoUpload() {
    if (!picFile) return
    setUploadingPic(true)
    try {
      const fd = new FormData()
      fd.append('profile_picture', picFile)
      const r = await fetch('/upload_profile_picture', { method: 'POST', credentials: 'include', body: fd })
      const j = await r.json().catch(() => null)
      if (r.ok && j?.success) {
        addUserMessage('📷 Photo uploaded!')
        addSteveMessage('Looking great! 👌')
        setPicFile(null)
        setTimeout(() => advanceTo('role'), 600)
      } else {
        addSteveMessage(j?.error || "Hmm, that didn't work. Try again or skip for now.", {
          photoUpload: true,
          options: [{ label: 'Skip for now', value: 'skip_photo', icon: '⏭️' }],
        })
      }
    } catch {
      addSteveMessage("Network issue — try again or skip for now.", {
        photoUpload: true,
        options: [{ label: 'Skip for now', value: 'skip_photo', icon: '⏭️' }],
      })
    } finally {
      setUploadingPic(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) {
      setPicFile(f)
      try { setPicPreview(URL.createObjectURL(f)) } catch {}
    }
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages, isTyping, scrollToBottom])

  const lastSteveMsg = [...messages].reverse().find(m => m.from === 'steve')
  const showInput = lastSteveMsg?.inputType && stage !== 'enriching' && stage !== 'review' && stage !== 'complete'
  const showPhotoUpload = lastSteveMsg?.photoUpload && stage === 'photo'

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="shrink-0 border-b border-white/10 bg-black/95 backdrop-blur-sm">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#2a7a72] flex items-center justify-center text-sm font-bold text-black shrink-0">
            S
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-white">Steve</div>
            <div className="text-[10px] text-white/40">Your AI assistant</div>
          </div>
          <div className="text-[10px] text-white/30">{stageProgress(stage)}%</div>
        </div>
        {/* Progress bar */}
        <div className="h-0.5 bg-white/5">
          <div
            className="h-full bg-[#4db6ac] transition-all duration-700 ease-out"
            style={{ width: `${stageProgress(stage)}%` }}
          />
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        <div className="max-w-lg mx-auto space-y-3">
          {messages.map((msg, i) => (
            <div key={i}>
              {msg.from === 'steve' ? (
                <div className="flex items-start gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#2a7a72] flex items-center justify-center text-[10px] font-bold text-black shrink-0 mt-0.5">
                    S
                  </div>
                  <div className="max-w-[85%] space-y-2">
                    <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[13px] text-white/90 leading-relaxed whitespace-pre-line">
                      {msg.text}
                    </div>
                    {/* Quick reply buttons */}
                    {msg.options && i === messages.length - 1 && stage !== 'complete' && (
                      <div className="flex flex-wrap gap-2">
                        {msg.options.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => handleOptionClick(opt.value)}
                            className="px-3.5 py-2 rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 text-[12px] font-medium text-[#4db6ac] hover:bg-[#4db6ac]/20 transition-colors"
                          >
                            {opt.icon && <span className="mr-1.5">{opt.icon}</span>}
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Complete stage options persist */}
                    {msg.options && stage === 'complete' && i === messages.length - 1 && (
                      <div className="flex flex-wrap gap-2">
                        {msg.options.map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => handleOptionClick(opt.value)}
                            className="px-3.5 py-2 rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 text-[12px] font-medium text-[#4db6ac] hover:bg-[#4db6ac]/20 transition-colors"
                          >
                            {opt.icon && <span className="mr-1.5">{opt.icon}</span>}
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Enrichment review cards */}
                    {msg.cards && stage === 'review' && (
                      <div className="space-y-2 mt-1">
                        {enrichmentCards.map(card => (
                          <div
                            key={card.id}
                            className={`rounded-xl border px-3.5 py-3 transition-all ${
                              card.status === 'accepted'
                                ? 'border-[#4db6ac]/40 bg-[#4db6ac]/10'
                                : card.status === 'dismissed'
                                ? 'border-white/5 bg-white/[0.02] opacity-50'
                                : 'border-white/10 bg-white/[0.04]'
                            }`}
                          >
                            <div className="text-[11px] text-white/40 uppercase tracking-wider mb-1">{card.label}</div>
                            <div className="text-[13px] text-white/80 leading-relaxed">{card.detail}</div>
                            {card.status === 'pending' && (
                              <div className="flex gap-2 mt-2">
                                <button
                                  onClick={() => handleCardAction(card.id, 'accepted')}
                                  className="px-3 py-1.5 rounded-lg bg-[#4db6ac]/15 border border-[#4db6ac]/30 text-[11px] font-medium text-[#4db6ac]"
                                >
                                  ✅ Accept
                                </button>
                                <button
                                  onClick={() => handleCardAction(card.id, 'dismissed')}
                                  className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-[11px] font-medium text-white/50"
                                >
                                  ❌ Dismiss
                                </button>
                              </div>
                            )}
                            {card.status === 'accepted' && (
                              <div className="text-[10px] text-[#4db6ac]/70 mt-1.5">✅ Added to your profile</div>
                            )}
                            {card.status === 'dismissed' && (
                              <div className="text-[10px] text-white/30 mt-1.5">Dismissed</div>
                            )}
                          </div>
                        ))}
                        {allCardsReviewed() && (
                          <button
                            onClick={handleFinishReview}
                            className="w-full mt-2 px-4 py-3 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 transition"
                          >
                            Continue
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <div className="max-w-[80%] bg-[#4db6ac]/20 border border-[#4db6ac]/20 rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[13px] text-white/90 leading-relaxed">
                    {msg.text}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {(isTyping || enriching) && (
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#2a7a72] flex items-center justify-center text-[10px] font-bold text-black shrink-0 mt-0.5">
                S
              </div>
              <div className="bg-white/[0.06] border border-white/[0.08] rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-white/30 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
              {enriching && (
                <div className="text-[10px] text-white/30 self-center ml-1">Looking you up...</div>
              )}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Photo upload area */}
      {showPhotoUpload && (
        <div className="shrink-0 border-t border-white/10 bg-black/95 px-4 py-3">
          <div className="max-w-lg mx-auto">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="flex items-center gap-3">
              {picPreview ? (
                <img src={picPreview} alt="Preview" className="w-14 h-14 rounded-full object-cover border-2 border-[#4db6ac]/40" />
              ) : (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="w-14 h-14 rounded-full border-2 border-dashed border-white/20 flex items-center justify-center cursor-pointer hover:border-[#4db6ac]/50 transition"
                >
                  <i className="fa-solid fa-camera text-white/30" />
                </div>
              )}
              <div className="flex-1">
                {!picFile ? (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2.5 rounded-xl bg-white/[0.06] border border-white/10 text-sm text-white/70 hover:bg-white/[0.1] transition w-full"
                  >
                    Choose a photo
                  </button>
                ) : (
                  <button
                    onClick={handlePhotoUpload}
                    disabled={uploadingPic}
                    className="px-4 py-2.5 rounded-xl bg-[#4db6ac] text-black text-sm font-semibold hover:brightness-110 transition w-full disabled:opacity-50"
                  >
                    {uploadingPic ? 'Uploading...' : 'Upload photo'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Text input */}
      {showInput && (
        <div className="shrink-0 border-t border-white/10 bg-black/95 px-4 py-3">
          <div className="max-w-lg mx-auto flex gap-2">
            {lastSteveMsg?.inputType === 'textarea' ? (
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                placeholder={lastSteveMsg.inputPlaceholder || 'Type here...'}
                rows={3}
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-white placeholder-white/30 focus:border-[#4db6ac]/50 focus:outline-none resize-none"
              />
            ) : (
              <input
                ref={inputRef}
                type={lastSteveMsg?.inputType === 'url' ? 'url' : 'text'}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleSubmit()
                  }
                }}
                placeholder={lastSteveMsg?.inputPlaceholder || 'Type here...'}
                className="flex-1 px-3.5 py-2.5 rounded-xl border border-white/10 bg-white/[0.04] text-sm text-white placeholder-white/30 focus:border-[#4db6ac]/50 focus:outline-none"
                autoFocus
              />
            )}
            <button
              onClick={handleSubmit}
              disabled={!inputValue.trim()}
              className="px-4 py-2.5 rounded-xl bg-[#4db6ac] text-black font-semibold text-sm hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
            >
              <i className="fa-solid fa-paper-plane" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
