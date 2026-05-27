import { useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { chatHapticMenuOpen, chatHapticReaction } from './chatHaptics'

export interface LongPressOptionalAction {
  label: string
  iconClass?: string
  onClick: () => void
  danger?: boolean
}

interface LongPressActionableProps {
  children: React.ReactNode
  onDelete: () => void
  onReact: (emoji: string) => void
  onReply: () => void
  onCopy: () => void
  onEdit?: () => void
  onSelect?: () => void
  /** Extra rows above Delete (e.g. remove one collage attachment). */
  optionalActions?: LongPressOptionalAction[]
  disabled?: boolean
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👏', '😮', '😢', '🙏']

/** Links / controls inside the bubble must receive real clicks (especially on iOS). */
function eventTargetIsInteractiveLinkOrControl(e: React.MouseEvent | React.TouchEvent): boolean {
  let node: EventTarget | null = null
  if ('touches' in e && e.touches.length > 0) {
    node = e.touches[0]?.target ?? null
  } else if ('changedTouches' in e && e.changedTouches.length > 0) {
    node = e.changedTouches[0]?.target ?? null
  } else {
    node = (e as React.MouseEvent).target
  }
  const el = node instanceof Element ? node : (node as Node | null)?.parentElement
  if (!el) return false
  return !!el.closest(
    'a[href], button:not(:disabled), input, textarea, select, label[for], [role="button"]',
  )
}

const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '🥲', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '🙄', '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🥵', '🥶', '🥴', '😵', '😵‍💫', '🤯', '🤠', '🥳', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'],
  'People': ['👶', '👧', '🧒', '👦', '👩', '🧑', '👨', '👩‍🦱', '🧑‍🦱', '👨‍🦱', '👩‍🦰', '🧑‍🦰', '👨‍🦰', '👱‍♀️', '👱', '👱‍♂️', '👩‍🦳', '🧑‍🦳', '👨‍🦳', '👩‍🦲', '🧑‍🦲', '👨‍🦲', '🧔', '👵', '🧓', '👴', '👮‍♀️', '👮', '👷‍♀️', '👷', '💂‍♀️', '💂', '🕵️‍♀️', '🕵️', '👩‍⚕️', '🧑‍⚕️', '👩‍🎓', '🧑‍🎓', '👩‍💻', '🧑‍💻', '👩‍🚀', '🧑‍🚀', '🧑‍🎨', '🧑‍🍳', '🧑‍🏫', '🧑‍🔬', '🧑‍✈️', '🧑‍🚒', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '👯', '🧖', '🧗', '🤸', '⛹️', '🏋️', '🚴', '🚵', '🤼', '🤽', '🤾', '🤺', '🏄', '🏊', '🤿', '🧘'],
  'Gestures': ['👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅', '👄', '🫦'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💑', '💏', '💋', '💍', '💒'],
  'Nature': ['🌍', '🌎', '🌏', '🌐', '🗺️', '🌸', '💮', '🏵️', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌱', '🪴', '🌲', '🌳', '🌴', '🌵', '🌾', '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🪹', '🪺', '🍄', '🌰', '🦀', '🦞', '🦐', '🦑', '🐙', '🐚', '🪸', '🌊', '💧', '💦', '🌈', '☀️', '🌤️', '⛅', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄', '🌬️', '🌀', '🌫️', '🌪️', '🔥', '💥', '✨', '🌟', '💫', '⭐', '🌙', '☁️'],
  'Animals': ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁', '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔', '🐉', '🐲', '🦎', '🐊', '🐳', '🐋', '🐬', '🦭', '🐟', '🐠', '🐡', '🦈', '🐙'],
  'Food': ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🫘', '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🫚', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🫔', '🌮', '🌯', '🫕', '🥙', '🧆', '🥚', '🍲', '🫗', '🥣', '🥗', '🍿', '🧈', '🧂', '🥫', '🍱', '🍘', '🍙', '🍚', '🍛', '🍜', '🍝', '🍠', '🍢', '🍣', '🍤', '🍥', '🥮', '🍡', '🥟', '🥠', '🥡', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖', '☕', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🫗'],
  'Activities': ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🎪', '🎭', '🎨', '🎬', '🎤', '🎧', '🎼', '🎵', '🎶', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🎻', '🪕', '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩'],
  'Objects': ['📱', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '📷', '📹', '🎥', '📺', '📻', '🎙️', '🎚️', '🎛️', '⏰', '⏳', '📡', '🔋', '🔌', '💡', '🔦', '🕯️', '🧯', '🛢️', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '🧾', '✉️', '📧', '📬', '📦', '📋', '📁', '📂', '📌', '📎', '🖇️', '📏', '📐', '✂️', '🗑️', '🔒', '🔓', '🔑', '🗝️', '🔨', '🪓', '⛏️', '🔧', '🔩', '🪛', '🧲', '⚗️', '🧪', '🧫', '🧬', '💊', '💉', '🩸', '🩹', '🩺'],
  'Symbols': ['🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '♻️', '✅', '❌', '❓', '❗', '‼️', '⁉️', '💯', '🔅', '🔆', '⚠️', '🚸', '♿', '🚫', '🚭', '🔞', '📵', '🆗', '🆕', '🆓', '🆒', '🆙', '🆖', '🈁', 'ℹ️', '🔤', '🔣', '🔢', '🔡', '#️⃣', '*️⃣', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🎉', '🎊', '🎁', '🏆', '🥇', '🥈', '🥉', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🀄', '🎴'],
  'Travel': ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🏍️', '🛵', '🚲', '🛴', '🛺', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '💺', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '🗼', '🏰', '🏯', '🏟️', '🎡', '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️', '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪', '🏫', '🏬', '🏭', '🏗️', '🧱', '🪨', '🪵', '🛖', '⛺', '🌁', '🌃', '🏙️', '🌄', '🌅', '🌆', '🌇', '🌉', '🗽', '🗿'],
  'Flags': ['🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '🇺🇸', '🇬🇧', '🇨🇦', '🇦🇺', '🇩🇪', '🇫🇷', '🇪🇸', '🇮🇹', '🇧🇷', '🇯🇵', '🇰🇷', '🇨🇳', '🇮🇳', '🇷🇺', '🇲🇽', '🇦🇷', '🇨🇴', '🇵🇹', '🇳🇱', '🇧🇪', '🇨🇭', '🇦🇹', '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇮🇪', '🇵🇱', '🇹🇷', '🇬🇷', '🇿🇦', '🇳🇬', '🇪🇬', '🇰🇪', '🇸🇦', '🇦🇪', '🇮🇱', '🇹🇭', '🇻🇳', '🇮🇩', '🇵🇭', '🇲🇾', '🇸🇬', '🇳🇿'],
}

type EmojiCategory = keyof typeof EMOJI_CATEGORIES

export default function LongPressActionable({ 
  children, 
  onDelete, 
  onReact, 
  onReply, 
  onCopy, 
  onEdit,
  onSelect,
  optionalActions,
  disabled 
}: LongPressActionableProps) {
  const { t } = useTranslation()
  const [showMenu, setShowMenu] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<EmojiCategory>('Smileys')
  const [isPressed, setIsPressed] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuOpenTimeRef = useRef(0)
  const lastTapRef = useRef<{ time: number; x: number; y: number }>({ time: 0, x: 0, y: 0 })

  const safeAction = (fn: () => void) => {
    if (Date.now() - menuOpenTimeRef.current < 300) return
    fn()
  }
  
  // Calculate menu position when showing - uses fixed positioning for reliability
  const calculateMenuStyle = useCallback((): React.CSSProperties => {
    if (!containerRef.current) return { position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 9999 }
    
    const rect = containerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const menuHeight = 260
    const padding = 12
    const safeAreaTop = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sat') || '0') || 50
    const safeAreaBottom = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sab') || '0') || 80

    // Measure actual menu width: 8 reaction emojis + plus button + gaps + padding
    const menuWidth = Math.min(viewportWidth - padding * 2, 300)
    
    // Available space
    const minTop = safeAreaTop + padding
    const maxBottom = viewportHeight - safeAreaBottom - padding
    const availableHeight = maxBottom - minTop
    const effectiveMenuHeight = Math.min(menuHeight, availableHeight)
    
    // Vertical — center on message, clamped to safe area
    const messageCenterY = rect.top + rect.height / 2
    let top = messageCenterY - effectiveMenuHeight / 2
    top = Math.max(minTop, Math.min(top, maxBottom - effectiveMenuHeight))
    
    // Horizontal — center on message, clamped to viewport
    let left = rect.left + rect.width / 2 - menuWidth / 2
    left = Math.max(padding, Math.min(left, viewportWidth - menuWidth - padding))
    
    return {
      position: 'fixed',
      top,
      left,
      width: menuWidth,
      zIndex: 9999,
      maxHeight: effectiveMenuHeight,
      overflowY: 'auto' as const,
    }
  }, [])
  
  const openMenu = useCallback(() => {
    setMenuStyle(calculateMenuStyle())
    menuOpenTimeRef.current = Date.now()
    chatHapticMenuOpen()
    setShowMenu(true)
    setIsPressed(false)
  }, [calculateMenuStyle])

  function handleDoubleTap(e: React.TouchEvent) {
    if (disabled) return
    if (eventTargetIsInteractiveLinkOrControl(e)) return
    const touch = e.changedTouches[0]
    if (!touch) return
    const now = Date.now()
    const last = lastTapRef.current
    const dt = now - last.time
    const dist = Math.hypot(touch.clientX - last.x, touch.clientY - last.y)
    lastTapRef.current = { time: now, x: touch.clientX, y: touch.clientY }
    if (dt < 300 && dist < 30) {
      e.preventDefault()
      if (timerRef.current) clearTimeout(timerRef.current)
      lastTapRef.current = { time: 0, x: 0, y: 0 }
      openMenu()
    }
  }

  function handleStart(e?: React.MouseEvent | React.TouchEvent) {
    if (disabled) return
    if (!e || !eventTargetIsInteractiveLinkOrControl(e)) {
      try {
        if (e && typeof e.preventDefault === 'function') {
          e.preventDefault()
        }
      } catch {
        // Ignore
      }
    }
    setIsPressed(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(openMenu, 500)
  }
  
  function handleEnd() {
    if (disabled) return
    setIsPressed(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }

  // Recalculate on context menu too
  const handleContextMenu = (e: React.MouseEvent) => {
    if (disabled) return
    e.preventDefault()
    openMenu()
  }
  
  return (
    <div 
      ref={containerRef}
      className="relative" 
      style={{ 
        userSelect: disabled ? 'text' : 'none', 
        WebkitUserSelect: disabled ? 'text' : 'none', 
        WebkitTouchCallout: disabled ? 'default' as never : 'none' as never,
      }}
    >
      <div
        className={`transition-opacity ${!disabled && isPressed ? 'opacity-70' : 'opacity-100'}`}
        onMouseDown={disabled ? undefined : handleStart}
        onMouseUp={disabled ? undefined : handleEnd}
        onMouseLeave={disabled ? undefined : handleEnd}
        onTouchStart={disabled ? undefined : handleStart}
        onTouchEnd={disabled ? undefined : (e) => { handleEnd(); handleDoubleTap(e) }}
        onDoubleClick={disabled ? undefined : (e) => { e.preventDefault(); openMenu() }}
        onContextMenu={handleContextMenu}
      >
        {children}
      </div>
      {!disabled && showMenu && !showEmojiPicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { if (Date.now() - menuOpenTimeRef.current < 400) return; setShowMenu(false); setShowEmojiPicker(false) }} onTouchEnd={(e) => { if (Date.now() - menuOpenTimeRef.current < 400) { e.preventDefault(); e.stopPropagation() } }} />
          <div 
            className="bg-[#111] border border-white/15 rounded-lg shadow-xl px-2 py-2"
            style={menuStyle}
          >
            <div className="flex items-center justify-between gap-1 px-1 pb-2 border-b border-white/10 overflow-hidden">
              {QUICK_REACTIONS.map(e => (
                <button 
                  key={e} 
                  className="text-[17px] flex-shrink-0 hover:scale-110 transition-transform" 
                  onClick={() => safeAction(() => { chatHapticReaction(); setShowMenu(false); setShowEmojiPicker(false); onReact(e) })}
                >
                  {e}
                </button>
              ))}
              <button 
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                onClick={() => safeAction(() => setShowEmojiPicker(true))}
                title="More reactions"
              >
                <i className="fa-solid fa-plus text-xs" />
              </button>
            </div>
            <div className="pt-2 flex flex-col">
              <button 
                className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                onClick={() => safeAction(() => { setShowMenu(false); setShowEmojiPicker(false); onReply() })}
              >
                <i className="fa-solid fa-reply mr-2 text-xs opacity-60" />
                {t('chat.action_reply')}
              </button>
              <button 
                className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                onClick={() => safeAction(() => { setShowMenu(false); setShowEmojiPicker(false); onCopy() })}
              >
                <i className="fa-regular fa-copy mr-2 text-xs opacity-60" />
                {t('chat.action_copy')}
              </button>
              {onEdit && (
                <button 
                  className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                  onClick={() => safeAction(() => { setShowMenu(false); setShowEmojiPicker(false); onEdit() })}
                >
                  <i className="fa-regular fa-pen-to-square mr-2 text-xs opacity-60" />
                  {t('chat.action_edit')}
                </button>
              )}
              {onSelect && (
                <button 
                  className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                  onClick={() => safeAction(() => { setShowMenu(false); setShowEmojiPicker(false); onSelect() })}
                >
                  <i className="fa-regular fa-square-check mr-2 text-xs opacity-60" />
                  {t('chat.action_select')}
                </button>
              )}
              {optionalActions?.map((a, idx) => (
                <button
                  key={idx}
                  type="button"
                  className={`text-left px-2 py-1 text-sm hover:bg-white/5 rounded ${
                    a.danger ? 'text-orange-300' : ''
                  }`}
                  onClick={() =>
                    safeAction(() => {
                      setShowMenu(false)
                      setShowEmojiPicker(false)
                      a.onClick()
                    })
                  }
                >
                  {a.iconClass ? (
                    <i className={`${a.iconClass} mr-2 text-xs opacity-60`} />
                  ) : (
                    <i className="fa-regular fa-file-lines mr-2 text-xs opacity-60" />
                  )}
                  {a.label}
                </button>
              ))}
              <button 
                className="text-left px-2 py-1 text-sm text-red-400 hover:bg-white/5 rounded" 
                onClick={() => safeAction(() => { setShowMenu(false); setShowEmojiPicker(false); onDelete() })}
              >
                <i className="fa-regular fa-trash-can mr-2 text-xs" />
                {t('chat.delete')}
              </button>
            </div>
          </div>
        </>
      )}
      
      {/* Full Emoji Picker Modal */}
      {showEmojiPicker && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/50" onClick={() => { setShowMenu(false); setShowEmojiPicker(false) }} />
          <div className="fixed z-[70] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#1a1a1a] border border-white/15 rounded-2xl shadow-2xl w-[320px] max-h-[400px] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="text-white font-medium">Choose reaction</h3>
              <button 
                className="w-8 h-8 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-full"
                onClick={() => { setShowMenu(false); setShowEmojiPicker(false) }}
              >
                <i className="fa-solid fa-xmark" />
              </button>
            </div>
            
            {/* Category tabs */}
            <div className="flex gap-1 px-2 py-2 border-b border-white/10 overflow-x-auto scrollbar-hide">
              {(Object.keys(EMOJI_CATEGORIES) as EmojiCategory[]).map(cat => (
                <button
                  key={cat}
                  className={`px-3 py-1.5 text-xs rounded-full whitespace-nowrap transition-colors ${
                    selectedCategory === cat 
                      ? 'bg-[#4db6ac] text-black font-medium' 
                      : 'text-white/60 hover:text-white hover:bg-white/10'
                  }`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            
            {/* Emoji grid */}
            <div className="p-3 max-h-[260px] overflow-y-auto">
              <div className="grid grid-cols-8 gap-1">
                {EMOJI_CATEGORIES[selectedCategory].map(emoji => (
                  <button
                    key={emoji}
                    className="w-9 h-9 flex items-center justify-center text-xl hover:bg-white/10 rounded-lg transition-colors"
                    onClick={() => {
                      chatHapticReaction()
                      setShowMenu(false)
                      setShowEmojiPicker(false)
                      onReact(emoji)
                    }}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
