import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { CHAT_KEYBOARD_ANIMATION_MS, CPOINT_EASE_OUT } from '../../design/motion'

type ExpandableTextareaProps = {
  value: string
  onChange: (value: string) => void
  /** Field label — used for the aria-label and the fullscreen editor header. */
  label: string
  /** Classes for the inline (collapsed) textarea. A right pad is added for the icon. */
  className?: string
  placeholder?: string
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  /** Keyboard inset, owned by the parent so we don't stack viewport listeners. */
  keyboardLift: number
  showKeyboard: boolean
  safeBottomPx: number
}

/**
 * A textarea with a corner "expand" affordance that opens a fullscreen editor
 * (same expand glyph the reply composer uses), so members can comfortably write
 * longer answers where the inline field has poor visibility. The fullscreen
 * editor is a modal overlay portaled to the body — it is NOT a route, so its
 * `position: fixed` root does not touch the page-transition invariant.
 */
export function ExpandableTextarea({
  value,
  onChange,
  label,
  className,
  placeholder,
  expanded,
  onExpandedChange,
  keyboardLift,
  showKeyboard,
  safeBottomPx,
}: ExpandableTextareaProps) {
  const { t } = useTranslation()

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExpandedChange(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, onExpandedChange])

  return (
    <div className="relative">
      <textarea
        className={`${className ?? ''} !pr-9`}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={e => {
          // After the keyboard + card-resize settle, pull the focused field into
          // view so clicking a lower section keeps it visible (otherwise the
          // shrunk card can leave only the first section on screen).
          const el = e.currentTarget
          window.setTimeout(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 280)
        }}
        placeholder={placeholder}
      />
      <button
        type="button"
        className="absolute right-2 top-3 flex h-7 w-7 items-center justify-center rounded-md text-c-text-tertiary hover:bg-c-hover-bg hover:text-c-text-primary"
        onClick={() => onExpandedChange(true)}
        aria-label={t('profile.aria.expand_field')}
      >
        <i className="fa-solid fa-up-right-and-down-left-from-center text-xs" />
      </button>

      {expanded &&
        createPortal(
          <div
            className="fixed inset-0 z-[1200] flex flex-col bg-c-bg-app"
            style={{
              paddingBottom: showKeyboard ? `${keyboardLift}px` : `${safeBottomPx}px`,
              transition: `padding-bottom ${CHAT_KEYBOARD_ANIMATION_MS}ms ${CPOINT_EASE_OUT}`,
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-c-border px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
              <h2 className="truncate text-base font-semibold text-c-text-primary">{label}</h2>
              <button
                type="button"
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-cpoint-turquoise hover:bg-c-hover-bg"
                onClick={() => onExpandedChange(false)}
                aria-label={t('profile.aria.collapse_field')}
              >
                {t('profile.done')}
              </button>
            </div>
            <textarea
              autoFocus
              className="min-h-0 flex-1 resize-none bg-c-bg-app px-4 py-3 text-base text-c-text-primary outline-none"
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={placeholder}
            />
          </div>,
          document.body,
        )}
    </div>
  )
}
