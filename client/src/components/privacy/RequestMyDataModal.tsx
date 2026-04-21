import { useEffect } from 'react'

/**
 * Request-my-data modal.
 *
 * Pure UI: there is no self-serve endpoint that assembles the dump.
 * The user is guided to `privacy@c-point.co` with a prefilled body;
 * our DPO handles the request out-of-band within the SLA printed in
 * the modal and documented in Terms §7.3 / Privacy §7. This is
 * deliberate — a hand-rolled portal would land in the same inbox
 * anyway for MVP volumes, and the mailto avoids us building a
 * second auth layer for data requests.
 */

const PRIVACY_EMAIL = 'privacy@c-point.co'
const SLA_DAYS = 30

type Props = {
  open: boolean
  onClose: () => void
  username?: string
  accountEmail?: string
}

export default function RequestMyDataModal({ open, onClose, username, accountEmail }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const subject = 'GDPR data request'
  const body = [
    'Hi C-Point team,',
    '',
    'I would like to request a copy of the personal data you hold about my',
    'C-Point account.',
    '',
    `Username: ${username || '<your C-Point username>'}`,
    `Account email: ${accountEmail || '<email on file>'}`,
    '',
    'Please reply to confirm receipt and let me know if you need anything',
    'further to verify my identity.',
    '',
    'Thanks,',
  ].join('\n')

  const mailto = `mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Request my data"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#0f1214] p-5 text-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold">Request my data</h3>
            <p className="mt-1 text-sm text-white/60">
              Ask us for a copy of the personal data we hold about your account.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-white/60 hover:bg-white/5 hover:text-white"
            aria-label="Close"
          >
            <i className="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          <section className="rounded-lg border border-white/10 bg-white/5 p-3">
            <h4 className="mb-2 text-sm font-semibold text-white/80">
              What you&rsquo;ll receive
            </h4>
            <ul className="list-disc pl-5 text-white/70 space-y-1">
              <li>Posts, comments, messages and media you have authored.</li>
              <li>Profile fields (username, bio, settings).</li>
              <li>Account metadata (signup date, subscription status, login history).</li>
            </ul>
          </section>

          <section className="rounded-lg border border-white/10 bg-white/5 p-3">
            <h4 className="mb-2 text-sm font-semibold text-white/80">
              What is not included
            </h4>
            <ul className="list-disc pl-5 text-white/70 space-y-1">
              <li>Other members&rsquo; content.</li>
              <li>Community-level data (member rosters, thread history, analytics).</li>
            </ul>
            <p className="mt-2 text-xs text-white/50">
              See Terms &sect;7.3 and our Privacy Policy for the full scope.
            </p>
          </section>

          <section className="rounded-lg border border-[#4db6ac]/20 bg-[#4db6ac]/5 p-3">
            <p className="text-white/80">
              Click the button below to email our Data Protection inbox. We respond
              within <strong>{SLA_DAYS} days</strong> (GDPR Art. 12(3)); complex
              requests may be extended by up to two further months with written
              notice.
            </p>
          </section>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/15 px-4 py-2 text-sm text-white/80 hover:border-white/30"
          >
            Cancel
          </button>
          <a
            href={mailto}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#4db6ac] px-4 py-2 text-sm font-semibold text-black hover:bg-[#3ea69c]"
            onClick={() => {
              setTimeout(onClose, 0)
            }}
          >
            <i className="fa-solid fa-envelope"></i>
            Email {PRIVACY_EMAIL}
          </a>
        </div>
      </div>
    </div>
  )
}
