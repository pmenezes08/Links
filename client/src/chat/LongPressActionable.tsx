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
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute z-50 -top-12 right-2 bg-[#111] border border-white/15 rounded-lg shadow-xl px-2 py-2 min-w-[160px]">
            <div className="flex items-center gap-2 px-2 pb-2 border-b border-white/10">
              {QUICK_REACTIONS.map(e => (
                <button 
                  key={e} 
                  className="text-lg hover:scale-110 transition-transform" 
                  onClick={() => { setShowMenu(false); onReact(e) }}
                >
                  {e}
                </button>
              ))}
            </div>
            <div className="pt-2 flex flex-col">
              <button 
                className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                onClick={() => { setShowMenu(false); onReply() }}
              >
                <i className="fa-solid fa-reply mr-2 text-xs opacity-60" />
                Reply
              </button>
              <button 
                className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                onClick={() => { setShowMenu(false); onCopy() }}
              >
                <i className="fa-regular fa-copy mr-2 text-xs opacity-60" />
                Copy
              </button>
              {onEdit && (
                <button 
                  className="text-left px-2 py-1 text-sm hover:bg-white/5 rounded" 
                  onClick={() => { setShowMenu(false); onEdit() }}
                >
                  <i className="fa-regular fa-pen-to-square mr-2 text-xs opacity-60" />
                  Edit
                </button>
              )}
              <button 
                className="text-left px-2 py-1 text-sm text-red-400 hover:bg-white/5 rounded" 
                onClick={() => { setShowMenu(false); onDelete() }}
              >
                <i className="fa-regular fa-trash-can mr-2 text-xs" />
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
