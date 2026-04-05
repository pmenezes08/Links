import { useState, useEffect, useRef, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { Keyboard } from '@capacitor/keyboard'
import type { KeyboardInfo } from '@capacitor/keyboard'

type Stage =
  | 'welcome'
  | 'name'
  | 'location'
  | 'photo'
  | 'talk_all_day'
  | 'reach_out'
  | 'professional'
  | 'recommend'
  | 'linkedin'
  | 'compose'
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
  composedBio?: string
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
  role: string
  company: string
  city: string
  country: string
  linkedin: string
  bio: string
  talkAllDay: string
  recommend: string
  reachOut: string
}

interface TourStep {
  icon: string
  title: string
  description: string
}

const TOUR_STEPS: TourStep[] = [
  { icon: 'fa-solid fa-house', title: 'Dashboard', description: 'Your home base — see your communities, notifications, and quick actions all in one place.' },
  { icon: 'fa-solid fa-user', title: 'My Profile', description: "Where others learn about you. Keep it fresh and it'll power better connections." },
  { icon: 'fa-solid fa-users', title: 'Followers', description: 'See who follows you and who you follow across your communities.' },
  { icon: 'fa-solid fa-network-wired', title: 'Networking', description: 'Discover people in your networks — Steve helps match you with relevant connections.' },
  { icon: 'fa-solid fa-cog', title: 'Account Settings', description: 'Manage your email, notifications, and privacy preferences.' },
]

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
  onExit: () => void
}

const USER_FACING_STEPS = 8
function stageProgress(stage: Stage): number {
  const stepMap: Record<Stage, number> = {
    welcome: 0,
    name: 1,
    location: 2,
    photo: 3,
    talk_all_day: 4,
    reach_out: 5,
    professional: 6,
    recommend: 7,
    linkedin: 8,
    compose: 8,
    enriching: 8,
    review: 8,
    complete: 8,
  }
  const step = stepMap[stage] ?? 0
  return Math.round((step / USER_FACING_STEPS) * 100)
}

export default function OnboardingChat({
  firstName: initFirst,
  lastName: initLast,
  username,
  communityName,
  hasCommunity,
  existingProfilePic,
  onComplete,
  onCreateCommunity,
  onGoToCommunity,
  onExit,
}: OnboardingChatProps) {
  const [stage, setStage] = useState<Stage>('welcome')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputValue, setInputValue] = useState('')
  const [collected, setCollected] = useState<Collected>({
    firstName: initFirst || '',
    lastName: initLast || '',
    role: '',
    company: '',
    city: '',
    country: '',
    linkedin: '',
    bio: '',
    talkAllDay: '',
    recommend: '',
    reachOut: '',
  })
  const [isTyping, setIsTyping] = useState(false)
  const [picFile, setPicFile] = useState<File | null>(null)
  const [picPreview, setPicPreview] = useState(existingProfilePic || '')
  const [uploadingPic, setUploadingPic] = useState(false)
  const [enrichmentCards, setEnrichmentCards] = useState<EnrichmentCard[]>([])
  const [enriching, setEnriching] = useState(false)
  const [initialized, setInitialized] = useState(false)
  const [booting, setBooting] = useState(true)
  const [composingBio, setComposingBio] = useState(false)
  const [tourStep, setTourStep] = useState<number | null>(null)
  const [keyboardOffset, setKeyboardOffset] = useState(0)
  const [headerLogoSrc, setHeaderLogoSrc] = useState('/api/public/logo')
  const [safeBottomPx, setSafeBottomPx] = useState(0)

  const NATIVE_KEYBOARD_MIN_HEIGHT = 60
  const KEYBOARD_OFFSET_EPSILON = 6
  const isIOS = Capacitor.getPlatform() === 'ios'

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const keyboardOffsetRef = useRef(0)

  const scrollToBottom = useCallback(() => {
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const probe = document.createElement('div')
    probe.style.position = 'fixed'
    probe.style.bottom = '0'
    probe.style.left = '0'
    probe.style.width = '0'
    probe.style.height = 'env(safe-area-inset-bottom, 0px)'
    probe.style.pointerEvents = 'none'
    probe.style.opacity = '0'
    probe.style.zIndex = '-1'
    document.body.appendChild(probe)

    const updateSafeBottom = () => {
      if (keyboardOffsetRef.current > 0) return
      const rect = probe.getBoundingClientRect()
      const next = rect.height || 0
      setSafeBottomPx(prev => {
        if (next < 1 && prev > 1) return prev
        return Math.abs(prev - next) < 1 ? prev : next
      })
    }

    updateSafeBottom()
    window.addEventListener('resize', updateSafeBottom)
    return () => {
      window.removeEventListener('resize', updateSafeBottom)
      probe.remove()
    }
  }, [])

  // Native keyboard handling (Capacitor — iOS only)
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'ios') return
    let showSub: PluginListenerHandle | undefined
    let hideSub: PluginListenerHandle | undefined

    const normalizeHeight = (raw: number) => (raw < NATIVE_KEYBOARD_MIN_HEIGHT ? 0 : raw)

    const handleShow = (info: KeyboardInfo) => {
      const height = normalizeHeight(info?.keyboardHeight ?? 0)
      if (height === 0) return
      if (Math.abs(keyboardOffsetRef.current - height) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = height
      setKeyboardOffset(height)
      requestAnimationFrame(scrollToBottom)
    }

    const handleHide = () => {
      if (Math.abs(keyboardOffsetRef.current) < KEYBOARD_OFFSET_EPSILON) return
      keyboardOffsetRef.current = 0
      setKeyboardOffset(0)
    }

    Keyboard.addListener('keyboardWillShow', handleShow).then(handle => {
      showSub = handle
    })
    Keyboard.addListener('keyboardWillHide', handleHide).then(handle => {
      hideSub = handle
    })

    return () => {
      showSub?.remove()
      hideSub?.remove()
    }
  }, [scrollToBottom])

  // Visual viewport keyboard handling (web + Android)
  useEffect(() => {
    if (isIOS) return
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    if (!viewport) return

    const onResize = () => {
      const offset = window.innerHeight - viewport.height - viewport.offsetTop
      const normalized = offset > 40 ? offset : 0
      if (Math.abs(keyboardOffsetRef.current - normalized) < 10) return
      keyboardOffsetRef.current = normalized
      setKeyboardOffset(normalized)
      if (normalized > 0) requestAnimationFrame(() => scrollToBottom())
    }

    viewport.addEventListener('resize', onResize)
    viewport.addEventListener('scroll', onResize)
    return () => {
      viewport.removeEventListener('resize', onResize)
      viewport.removeEventListener('scroll', onResize)
    }
  }, [isIOS, scrollToBottom])

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
          setBooting(false)
          return
        }
      } catch {}
      startStage('welcome', collected)
      setBooting(false)
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
        let welcomeText = `${greeting} I'm Steve here at CPoint.`
        if (communityName) {
          welcomeText += ` I see you were invited to ${communityName} — exciting!`
        }
        welcomeText += `\n\nA great profile attracts the right connections and lets you control your narrative. I'll walk you through ${USER_FACING_STEPS} quick steps — it takes about 3 minutes. Ready?`
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
      case 'location':
        addSteveMessage('Where are you based?', {
          inputType: 'text',
          inputPlaceholder: 'e.g. Munich, Germany',
        })
        break
      case 'photo':
        addSteveMessage("Let's add a profile picture — it helps people recognize you.", {
          photoUpload: true,
          options: [{ label: 'Skip for now', value: 'skip_photo', icon: '⏭️' }],
        })
        break
      case 'talk_all_day':
        addSteveMessage("Now let's get to know the real you.\n\nWhat are the things you could talk about all day?", {
          inputType: 'text',
          inputPlaceholder: 'e.g. AI, leadership, travel, startups',
        })
        break
      case 'reach_out':
        addSteveMessage("What do you want people to reach out to you about?", {
          inputType: 'text',
          inputPlaceholder: 'e.g. Coffee chats, brainstorming, partnerships, new ventures',
        })
        break
      case 'professional':
        addSteveMessage('What do you do professionally? Something like "Product Manager at Google" or "Founder, building in fintech" works great.', {
          inputType: 'text',
          inputPlaceholder: 'e.g. Product Manager at Google',
        })
        break
      case 'recommend':
        addSteveMessage("As a gift to your network — recommend a book, movie, or TV show.", {
          inputType: 'text',
          inputPlaceholder: 'e.g. Sapiens by Yuval Noah Harari',
        })
        break
      case 'linkedin':
        addSteveMessage("Got a LinkedIn URL? It helps me learn more about your background. Feel free to skip if you'd rather not share.", {
          inputType: 'url',
          inputPlaceholder: 'https://linkedin.com/in/yourprofile',
          options: [{ label: 'Skip', value: 'skip_linkedin', icon: '⏭️' }],
        })
        break
      case 'compose':
        composeBio(data)
        break
      case 'enriching':
        addSteveMessage("Give me a moment — I'm looking up some public info to help build out your profile. This is based only on publicly available information. 🔍")
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
        showCompleteMsg()
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
    showCompleteMsg()
  }

  function showCompleteMsg() {
    addSteveMessage(
      "You're all set! 🎉 Your profile is live!\n\nI'm always here if you need anything — just DM me or tag @Steve in any chat.\n\nBy the way, did you know you can create your own communities? Planning a trip with friends? Starting a book club? Organizing weekend tennis? A community is just a group of people you want to keep connected.",
      {
        options: [
          { label: 'Show me around', value: 'start_tour', icon: '🗺️' },
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

  async function composeBio(data?: Collected) {
    const c = data || collected
    setComposingBio(true)
    addSteveMessage("Nice! Give me a sec — I'm putting your identity together... ✍️")
    try {
      const r = await fetch('/api/onboarding/compose_bio', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          talk_all_day: c.talkAllDay,
          recommend: c.recommend,
          reach_out: c.reachOut,
          role: c.role,
          company: c.company,
          city: c.city,
          country: c.country,
        }),
      })
      const j = await r.json().catch(() => null)
      const bio = j?.bio || ''
      setComposingBio(false)
      if (bio) {
        addSteveMessage("Here's your identity, based on what you told me:", { composedBio: bio })
      } else {
        addSteveMessage("I couldn't compose your identity right now — would you like to write one yourself?", {
          inputType: 'textarea',
          inputPlaceholder: 'Write a 2-3 sentence intro...',
        })
      }
    } catch {
      setComposingBio(false)
      addSteveMessage("Something went wrong. Want to write your own intro instead?", {
        inputType: 'textarea',
        inputPlaceholder: 'Write a 2-3 sentence intro...',
      })
    }
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
      case 'confirm_name': {
        addUserMessage("That's correct")
        const displayName = `${collected.firstName} ${collected.lastName}`.trim()
        if (displayName) saveField('display_name', displayName)
        advanceTo('location')
        break
      }
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
        setTimeout(() => advanceTo('talk_all_day'), 600)
        break
      case 'skip_linkedin':
        addUserMessage('Skip')
        advanceTo('compose')
        break
      case 'use_bio': {
        const lastComposed = [...messages].reverse().find(m => m.composedBio)?.composedBio || ''
        if (lastComposed) {
          addUserMessage('Use this')
          const newCollected = { ...collected, bio: lastComposed }
          setCollected(newCollected)
          await saveField('bio', lastComposed)
          addSteveMessage('Your identity is set! 🎯')
          setTimeout(() => advanceTo('enriching', newCollected), 600)
        }
        break
      }
      case 'edit_bio': {
        const bioToEdit = [...messages].reverse().find(m => m.composedBio)?.composedBio || ''
        addUserMessage('Let me edit')
        setInputValue(bioToEdit)
        addSteveMessage("Go ahead — tweak it however you'd like:", {
          inputType: 'textarea',
          inputPlaceholder: 'Edit your identity...',
        })
        break
      }
      case 'redo_bio':
        addUserMessage('Start fresh')
        addSteveMessage('No problem — write your own intro. 2-3 sentences is perfect.', {
          inputType: 'textarea',
          inputPlaceholder: 'Write your intro...',
        })
        break
      case 'start_tour':
        addUserMessage('Show me around')
        setTourStep(0)
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
        const displayName = `${first} ${last}`.trim()
        await saveField('display_name', displayName)
        advanceTo('location', newCollected)
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
        advanceTo('photo', newCollected)
        break
      }
      case 'talk_all_day': {
        const newCollected = { ...collected, talkAllDay: val }
        setCollected(newCollected)
        const reactions = ['Love it!', 'Great taste!', 'Interesting!', 'Nice!']
        addSteveMessage(reactions[Math.floor(Math.random() * reactions.length)])
        setTimeout(() => advanceTo('reach_out', newCollected), 600)
        break
      }
      case 'reach_out': {
        const newCollected = { ...collected, reachOut: val }
        setCollected(newCollected)
        advanceTo('professional', newCollected)
        break
      }
      case 'professional': {
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
        advanceTo('recommend', newCollected)
        break
      }
      case 'recommend': {
        const newCollected = { ...collected, recommend: val }
        setCollected(newCollected)
        addSteveMessage('Good pick! 📚')
        setTimeout(() => advanceTo('linkedin', newCollected), 600)
        break
      }
      case 'linkedin': {
        const newCollected = { ...collected, linkedin: val }
        setCollected(newCollected)
        await saveField('linkedin', val)
        addSteveMessage('Perfect, that will help me learn more about your background!')
        setTimeout(() => advanceTo('compose', newCollected), 600)
        break
      }
      case 'compose': {
        const newCollected = { ...collected, bio: val }
        setCollected(newCollected)
        await saveField('bio', val)
        addSteveMessage('Your identity is set! 🎯')
        setTimeout(() => advanceTo('enriching', newCollected), 600)
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
    if (currentStage === 'professional') {
      return lower.length > 150 || (lower.includes('?') && !lower.includes('at'))
    }
    if (currentStage === 'location') {
      return lower.length > 80 || (/^(hey|what|how|can|tell|who)/.test(lower) && lower.includes('?'))
    }
    if (currentStage === 'linkedin') {
      if (lower.includes('linkedin.com') || lower.includes('skip')) return false
      return lower.includes('?') || /^(hey|what|how|can|tell)/.test(lower)
    }
    return false
  }

  async function handleOffScript(userMsg: string) {
    setIsTyping(true)
    try {
      const questionMap: Record<string, string> = {
        name: "What's your first and last name?",
        location: 'Where are you based?',
        professional: 'What do you do professionally?',
        linkedin: 'Got a LinkedIn URL?',
        talk_all_day: 'What are the things you could talk about all day?',
        recommend: 'Recommend a book, movie, or TV show to your network.',
        reach_out: 'What do you want people to reach out to you about?',
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
        setTimeout(() => advanceTo('talk_all_day'), 600)
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
  const showInput = lastSteveMsg?.inputType && stage !== 'enriching' && stage !== 'review' && stage !== 'complete' && !composingBio
  const showPhotoUpload = lastSteveMsg?.photoUpload && stage === 'photo'
  const keyboardLift = keyboardOffset > 0 ? Math.max(0, keyboardOffset - safeBottomPx) : 0
  const composerBottom = `${keyboardLift}px`
  const composerClearance = showPhotoUpload ? 124 : showInput ? 112 : 24
  const composerPaddingBottom = keyboardLift > 0 ? '8px' : `calc(env(safe-area-inset-bottom, 0px) + 8px)`

  if (booting) {
    return (
      <div className="fixed inset-0 z-[1100] bg-black flex items-center justify-center px-6" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex flex-col items-center gap-4 text-center">
          <img
            src={headerLogoSrc}
            alt="CPoint"
            className="w-14 h-14 rounded-2xl object-contain"
            onError={() => setHeaderLogoSrc('/static/cpoint-logo.svg')}
          />
          <div className="w-8 h-8 rounded-full border-2 border-white/15 border-t-[#4db6ac] animate-spin" />
          <div className="text-sm text-white/65">Starting your profile setup...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1100] bg-black flex flex-col" style={{ height: '100dvh' }}>
      {/* Header with logo */}
      <div className="shrink-0 border-b border-white/10 bg-black/95 backdrop-blur-sm">
        <div className="max-w-lg mx-auto px-4 pb-2 flex flex-col items-center" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)' }}>
          <div className="flex items-center gap-2 mb-2">
            <img
              src={headerLogoSrc}
              alt="CPoint"
              className="w-8 h-8 rounded-lg object-contain"
              onError={() => setHeaderLogoSrc('/static/cpoint-logo.svg')}
            />
          </div>
          <div className="w-full flex items-center gap-3 pb-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#4db6ac] to-[#2a7a72] flex items-center justify-center text-[10px] font-bold text-black shrink-0">
              S
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-white">Steve</div>
            </div>
            <button
              type="button"
              onClick={onExit}
              className="rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-medium text-white/60 hover:text-white hover:border-white/20 transition"
            >
              Exit for now
            </button>
            <div className="text-[10px] text-white/30">Step {Math.min(Math.ceil(stageProgress(stage) / (100 / USER_FACING_STEPS)), USER_FACING_STEPS)} of {USER_FACING_STEPS}</div>
          </div>
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
      <div className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: `${safeBottomPx + keyboardLift + composerClearance}px` }}>
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
                    {/* Composed bio preview with action buttons */}
                    {msg.composedBio && i === messages.length - 1 && stage === 'compose' && !composingBio && (
                      <div className="space-y-2 mt-1">
                        <div className="rounded-xl border border-[#4db6ac]/20 bg-[#4db6ac]/5 px-3.5 py-3">
                          <div className="text-[13px] text-white/90 leading-relaxed italic">"{msg.composedBio}"</div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => handleOptionClick('use_bio')} className="px-3.5 py-2 rounded-xl border border-[#4db6ac]/30 bg-[#4db6ac]/10 text-[12px] font-medium text-[#4db6ac] hover:bg-[#4db6ac]/20 transition-colors">
                            ✅ Use this
                          </button>
                          <button onClick={() => handleOptionClick('edit_bio')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            ✏️ Let me edit
                          </button>
                          <button onClick={() => handleOptionClick('redo_bio')} className="px-3.5 py-2 rounded-xl border border-white/10 bg-white/5 text-[12px] font-medium text-white/60 hover:bg-white/10 transition-colors">
                            🔄 Start fresh
                          </button>
                        </div>
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
        <div
          className="shrink-0 border-t border-white/10 bg-black/95 px-4 py-3"
          style={{
            bottom: composerBottom,
            position: 'fixed',
            left: '0',
            right: '0',
            zIndex: 1000,
            paddingBottom: composerPaddingBottom,
          }}
        >
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
        <div
          className="shrink-0 border-t border-white/10 bg-black/95 px-4 py-3"
          style={{
            bottom: composerBottom,
            position: 'fixed',
            left: '0',
            right: '0',
            zIndex: 1000,
            paddingBottom: composerPaddingBottom,
          }}
        >
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

      {/* Platform tour modal */}
      {tourStep !== null && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center px-4" onClick={() => setTourStep(null)}>
          <div className="w-full max-w-sm bg-[#111] border border-white/10 rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 pt-6 pb-4 flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#4db6ac]/10 border border-[#4db6ac]/20 flex items-center justify-center mb-4">
                <i className={`${TOUR_STEPS[tourStep].icon} text-2xl text-[#4db6ac]`} />
              </div>
              <div className="text-base font-semibold text-white mb-1.5">{TOUR_STEPS[tourStep].title}</div>
              <div className="text-sm text-white/60 leading-relaxed">{TOUR_STEPS[tourStep].description}</div>
            </div>
            {/* Dot indicators */}
            <div className="flex justify-center gap-1.5 pb-3">
              {TOUR_STEPS.map((_, i) => (
                <div
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${i === tourStep ? 'bg-[#4db6ac]' : 'bg-white/20'}`}
                />
              ))}
            </div>
            {/* Navigation */}
            <div className="px-6 pb-5 flex items-center justify-between">
              <button
                onClick={() => setTourStep(tourStep > 0 ? tourStep - 1 : null)}
                className="px-4 py-2 rounded-lg text-xs font-medium text-white/50 hover:text-white/80 transition-colors"
              >
                {tourStep > 0 ? 'Back' : 'Skip'}
              </button>
              <div className="text-[10px] text-white/30">{tourStep + 1} of {TOUR_STEPS.length}</div>
              <button
                onClick={async () => {
                  if (tourStep < TOUR_STEPS.length - 1) {
                    setTourStep(tourStep + 1)
                  } else {
                    setTourStep(null)
                    await completeOnboarding()
                    if (hasCommunity) onGoToCommunity()
                    else onComplete()
                  }
                }}
                className="px-4 py-2 rounded-lg bg-[#4db6ac] text-black text-xs font-semibold hover:brightness-110 transition"
              >
                {tourStep < TOUR_STEPS.length - 1 ? 'Next' : "Let's go!"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
