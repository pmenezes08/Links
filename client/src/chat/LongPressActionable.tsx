import { useRef, useState } from 'react'

interface LongPressActionableProps {
  children: React.ReactNode
  onDelete: () => void
  onReact: (emoji: string) => void
  onReply: () => void
  onCopy: () => void
  onEdit?: () => void
  disabled?: boolean
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '🔥', '👏']

// Extended emoji picker categories
const EMOJI_CATEGORIES = {
  'Smileys': ['😀', '😃', '😄', '😁', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😌', '😍', '🥰', '😘', '😋', '😛', '😜', '🤪', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺', '👻', '👽', '👾', '🤖'],
  'Gestures': ['👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '💪', '🦾'],
  'Hearts': ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❤️‍🔥', '❤️‍🩹', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟'],
  'Symbols': ['⭐', '🌟', '✨', '💫', '🔥', '💥', '💢', '💦', '💨', '🎉', '🎊', '🎁', '🏆', '🥇', '🥈', '🥉', '⚽', '🏀', '🎯', '🎮', '🎲', '🎭', '🎨', '🎬', '🎤', '🎧', '🎵', '🎶', '💯', '✅', '❌', '❓', '❗', '💡', '🔔'],
  'Animals': ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🦋', '🐌', '🐛', '🐜', '🐞'],
  'Food': ['🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🌮', '🍕', '🍔', '🍟', '🌭', '🥪', '🍿', '🧁', '🍰', '🎂', '🍩', '🍪', '🍫', '🍬', '☕', '🍵', '🥤', '🍺', '🍷', '🥂', '🍾'],
}

type EmojiCategory = keyof typeof EMOJI_CATEGORIES

export default function LongPressActionable({ 
  children, 
  onDelete, 
  onReact, 
  onReply, 
  onCopy, 
  onEdit, 
  disabled 
}: LongPressActionableProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<EmojiCategory>('Smileys')
  const [isPressed, setIsPressed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  
  function handleStart(e?: React.MouseEvent | React.TouchEvent) {
    if (disabled) return
    try {
      if (e && typeof e.preventDefault === 'function') {
        e.preventDefault()
      }
    } catch {
      // Ignore
    }
    setIsPressed(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setShowMenu(true)
      setIsPressed(false)
    }, 500) // 500ms for better UX
  }
  
  function handleEnd() {
    if (disabled) return
    setIsPressed(false)
    if (timerRef.current) clearTimeout(timerRef.current)
  }
  
  return (
    <div 
      className="relative" 
      style={{ 
        userSelect: disabled ? 'text' : 'none', 
        WebkitUserSelect: disabled ? 'text' : 'none', 
        WebkitTouchCallout: 'none' as never 
      }}
    >
      <div
        className={`transition-opacity ${!disabled && isPressed ? 'opacity-70' : 'opacity-100'}`}
        onMouseDown={disabled ? undefined : handleStart}
        onMouseUp={disabled ? undefined : handleEnd}
        onMouseLeave={disabled ? undefined : handleEnd}
        onTouchStart={disabled ? undefined : handleStart}
        onTouchEnd={disabled ? undefined : handleEnd}
        onContextMenu={(e) => {
          if (disabled) return
          e.preventDefault()
          setShowMenu(true)
        }}
        title="Hold for options or right-click"
      >
        {children}
      </div>
      {!disabled && showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setShowMenu(false); setShowEmojiPicker(false) }} />
          <div className="absolute z-50 -top-12 right-2 bg-[#111] border border-white/15 rounded-lg shadow-xl px-2 py-2 min-w-[160px]">
            <div className="flex items-center gap-2 px-2 pb-2 border-b border-white/10">
              {QUICK_REACTIONS.map(e => (
                <button 
                  key={e} 
                  className="text-lg hover:scale-110 transition-transform" 
                  onClick={() => { setShowMenu(false); setShowEmojiPicker(false); onReact(e) }}
                >
                  {e}
                </button>
              ))}
              {/* More emoji button */}
              <button 
                className="w-7 h-7 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                onClick={() => setShowEmojiPicker(true)}
                title="More reactions"
              >
                <i className="fa-solid fa-plus text-xs" />
              </button>
            </div>
            <div className="pt-2 flex flex-col">
              <button 
                className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                onClick={() => { setShowMenu(false); setShowEmojiPicker(false); onReply() }}
              >
                <i className="fa-solid fa-reply mr-2 text-xs opacity-60" />
                Reply
              </button>
              <button 
                className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                onClick={() => { setShowMenu(false); setShowEmojiPicker(false); onCopy() }}
              >
                <i className="fa-regular fa-copy mr-2 text-xs opacity-60" />
                Copy
              </button>
              {onEdit && (
                <button 
                  className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                  onClick={() => { setShowMenu(false); setShowEmojiPicker(false); onEdit() }}
                >
                  <i className="fa-regular fa-pen-to-square mr-2 text-xs opacity-60" />
                  Edit
                </button>
              )}
              <button 
                className="text-left px-2 py-1 text-sm text-red-400 hover:bg-white/5 rounded" 
                onClick={() => { setShowMenu(false); setShowEmojiPicker(false); onDelete() }}
              >
                <i className="fa-regular fa-trash-can mr-2 text-xs" />
                Delete
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
