import { useEffect } from 'react'

type Props = {
  url: string
  onClose: () => void
}

/**
 * Full-screen iframe fallback for web / dev when native InAppBrowser is not available.
 * Minimal chrome: one floating close control, no URL bar.
 */
export default function WebArticleFallback({ url, onClose }: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[200] bg-black"
      role="dialog"
      aria-modal="true"
      aria-label="Article"
    >
      <iframe
        title="Article"
        src={url}
        className="absolute inset-0 h-full w-full border-0 bg-white"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-downloads allow-popups-to-escape-sandbox"
      />
      <div
        className="pointer-events-none absolute right-0 top-0 z-10 flex w-full justify-end p-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
        style={{ paddingRight: 'max(0.75rem, env(safe-area-inset-right))', paddingLeft: 'max(0.75rem, env(safe-area-inset-left))' }}
      >
        <button
          type="button"
          onClick={onClose}
          className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/15 bg-zinc-950/75 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-zinc-900/90"
          aria-label="Close"
        >
          <i className="fa-solid fa-xmark text-lg" aria-hidden />
        </button>
      </div>
    </div>
  )
}
