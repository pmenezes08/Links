import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { PersonalForm, ProfessionalForm } from '../../pages/Profile'

export type WorkExperienceRow = {
  title: string
  company: string
  location: string
  start: string
  end: string
  description: string
}

export type EducationRow = {
  school: string
  degree: string
  start: string
  end: string
  description: string
}

const EMPTY_WORK: WorkExperienceRow = {
  title: '',
  company: '',
  location: '',
  start: '',
  end: '',
  description: '',
}

const EMPTY_EDU: EducationRow = {
  school: '',
  degree: '',
  start: '',
  end: '',
  description: '',
}

const STEVE_PAGE1 =
  "Hey—take your time here. A few honest lines help the right people find you. Nothing has to be perfect."
const STEVE_PAGE2 =
  "Your path matters. Add what you're comfortable sharing; you can always come back and refine it."

const PERSONAL_FIELDS = [
  {
    key: 'personal_answer_five_minutes' as const,
    label: 'If we only had five minutes, what should I ask you about?',
  },
  {
    key: 'personal_answer_outside_work' as const,
    label: 'Outside of work, where do we most likely find you?',
  },
  {
    key: 'personal_answer_cpoint_goals' as const,
    label: 'What are you hoping to get from C-Point?',
  },
]

type ProfileDetailsModalProps = {
  open: boolean
  onClose: () => void
  personal: PersonalForm
  setPersonal: Dispatch<SetStateAction<PersonalForm>>
  professional: ProfessionalForm
  setProfessional: Dispatch<SetStateAction<ProfessionalForm>>
  onSavePersonal: (e: FormEvent<HTMLFormElement>) => void | Promise<void>
  onSaveProfessional: (e: FormEvent<HTMLFormElement>) => void | Promise<void>
  savingPersonal: boolean
  savingProfessional: boolean
}

export function ProfileDetailsModal({
  open,
  onClose,
  personal,
  setPersonal,
  professional,
  setProfessional,
  onSavePersonal,
  onSaveProfessional,
  savingPersonal,
  savingProfessional,
}: ProfileDetailsModalProps) {
  const [page, setPage] = useState<1 | 2>(1)

  useEffect(() => {
    if (open) setPage(1)
  }, [open])

  const requestClose = useCallback(() => {
    onClose()
  }, [onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex min-h-0 items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-details-title"
    >
      <div className="relative flex max-h-[min(90dvh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <h2 id="profile-details-title" className="text-base font-semibold text-white">
              Spotlight and timeline
            </h2>
            <p className="text-[11px] text-[#9fb0b5]">
              Step {page} of 2 — {page === 1 ? 'Spotlight answers' : 'Career timeline'}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
            onClick={requestClose}
            aria-label="Close"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
          {page === 1 ? (
            <form id="form-personal-modal" className="space-y-4" onSubmit={onSavePersonal}>
              <p className="text-xs leading-relaxed text-[#b8c8cc] border border-[#4db6ac]/25 rounded-lg px-3 py-2 bg-[#4db6ac]/5">
                <span className="font-medium text-[#4db6ac]">Steve:</span> {STEVE_PAGE1}
              </p>
              {PERSONAL_FIELDS.map(field => (
                <label key={field.key} className="text-sm block">
                  <span className="text-white/90">{field.label}</span>
                  <textarea
                    className="mt-1 w-full min-h-[72px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#4db6ac]"
                    value={personal[field.key]}
                    onChange={e =>
                      setPersonal(prev => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </label>
              ))}
            </form>
          ) : (
            <form id="form-professional-modal" className="space-y-4" onSubmit={onSaveProfessional}>
              <p className="text-xs leading-relaxed text-[#b8c8cc] border border-[#4db6ac]/25 rounded-lg px-3 py-2 bg-[#4db6ac]/5">
                <span className="font-medium text-[#4db6ac]">Steve:</span> {STEVE_PAGE2}
              </p>
              <label className="text-sm sm:col-span-2 block">
                <span className="text-white/90">Current role start</span>
                <span className="block text-[11px] text-[#9fb0b5] font-normal">
                  Month you started your current role (optional). Shown as start — Present on your public profile.
                </span>
                <input
                  type="month"
                  className="mt-1 w-full max-w-[200px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.current_role_start}
                  onChange={e => setProfessional(prev => ({ ...prev, current_role_start: e.target.value }))}
                />
              </label>

              <div className="rounded-lg border border-white/10 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">More professional experience</span>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[#4db6ac]/50 text-[#4db6ac] hover:bg-[#4db6ac]/15"
                    onClick={() =>
                      setProfessional(prev => ({
                        ...prev,
                        work_history: [...prev.work_history, { ...EMPTY_WORK }],
                      }))
                    }
                    aria-label="Add experience"
                  >
                    <i className="fa-solid fa-plus" />
                  </button>
                </div>
                {professional.work_history.length === 0 ? (
                  <p className="text-xs text-[#9fb0b5]">Tap the plus to add a past role.</p>
                ) : null}
                {professional.work_history.map((row, idx) => (
                  <div key={idx} className="rounded-md border border-white/10 bg-black/40 p-3 space-y-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="text-[11px] text-red-400 hover:text-red-300"
                        onClick={() =>
                          setProfessional(prev => ({
                            ...prev,
                            work_history: prev.work_history.filter((_, i) => i !== idx),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                        placeholder="Title"
                        value={row.title}
                        onChange={e => {
                          const v = e.target.value
                          setProfessional(prev => ({
                            ...prev,
                            work_history: prev.work_history.map((r, i) => (i === idx ? { ...r, title: v } : r)),
                          }))
                        }}
                      />
                      <input
                        className="rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                        placeholder="Company"
                        value={row.company}
                        onChange={e => {
                          const v = e.target.value
                          setProfessional(prev => ({
                            ...prev,
                            work_history: prev.work_history.map((r, i) => (i === idx ? { ...r, company: v } : r)),
                          }))
                        }}
                      />
                      <input
                        className="rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm sm:col-span-2"
                        placeholder="Location (optional)"
                        value={row.location}
                        onChange={e => {
                          const v = e.target.value
                          setProfessional(prev => ({
                            ...prev,
                            work_history: prev.work_history.map((r, i) => (i === idx ? { ...r, location: v } : r)),
                          }))
                        }}
                      />
                      <label className="text-[11px] text-[#9fb0b5] sm:col-span-2 grid grid-cols-2 gap-2">
                        <span>Start (month)</span>
                        <span>End (month, optional)</span>
                        <input
                          type="month"
                          className="rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                          value={row.start}
                          onChange={e => {
                            const v = e.target.value
                            setProfessional(prev => ({
                              ...prev,
                              work_history: prev.work_history.map((r, i) => (i === idx ? { ...r, start: v } : r)),
                            }))
                          }}
                        />
                        <input
                          type="month"
                          className="rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                          value={row.end}
                          onChange={e => {
                            const v = e.target.value
                            setProfessional(prev => ({
                              ...prev,
                              work_history: prev.work_history.map((r, i) => (i === idx ? { ...r, end: v } : r)),
                            }))
                          }}
                        />
                      </label>
                    </div>
                    <textarea
                      className="w-full rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm min-h-[64px]"
                      placeholder="What was this role about?"
                      value={row.description}
                      onChange={e => {
                        const v = e.target.value
                        setProfessional(prev => ({
                          ...prev,
                          work_history: prev.work_history.map((r, i) => (i === idx ? { ...r, description: v } : r)),
                        }))
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-white/10 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-white">Education</span>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[#4db6ac]/50 text-[#4db6ac] hover:bg-[#4db6ac]/15"
                    onClick={() =>
                      setProfessional(prev => ({
                        ...prev,
                        education: [...prev.education, { ...EMPTY_EDU }],
                      }))
                    }
                    aria-label="Add education"
                  >
                    <i className="fa-solid fa-plus" />
                  </button>
                </div>
                {professional.education.length === 0 ? (
                  <p className="text-xs text-[#9fb0b5]">Tap the plus to add a school or program.</p>
                ) : null}
                {professional.education.map((row, idx) => (
                  <div key={idx} className="rounded-md border border-white/10 bg-black/40 p-3 space-y-2">
                    <div className="flex justify-end">
                      <button
                        type="button"
                        className="text-[11px] text-red-400 hover:text-red-300"
                        onClick={() =>
                          setProfessional(prev => ({
                            ...prev,
                            education: prev.education.filter((_, i) => i !== idx),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <input
                      className="w-full rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                      placeholder="School"
                      value={row.school}
                      onChange={e => {
                        const v = e.target.value
                        setProfessional(prev => ({
                          ...prev,
                          education: prev.education.map((r, i) => (i === idx ? { ...r, school: v } : r)),
                        }))
                      }}
                    />
                    <input
                      className="w-full rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                      placeholder="Degree / field (optional)"
                      value={row.degree}
                      onChange={e => {
                        const v = e.target.value
                        setProfessional(prev => ({
                          ...prev,
                          education: prev.education.map((r, i) => (i === idx ? { ...r, degree: v } : r)),
                        }))
                      }}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="month"
                        className="rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                        value={row.start}
                        onChange={e => {
                          const v = e.target.value
                          setProfessional(prev => ({
                            ...prev,
                            education: prev.education.map((r, i) => (i === idx ? { ...r, start: v } : r)),
                          }))
                        }}
                      />
                      <input
                        type="month"
                        className="rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                        value={row.end}
                        onChange={e => {
                          const v = e.target.value
                          setProfessional(prev => ({
                            ...prev,
                            education: prev.education.map((r, i) => (i === idx ? { ...r, end: v } : r)),
                          }))
                        }}
                      />
                    </div>
                    <textarea
                      className="w-full rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm min-h-[56px]"
                      placeholder="Description (optional)"
                      value={row.description}
                      onChange={e => {
                        const v = e.target.value
                        setProfessional(prev => ({
                          ...prev,
                          education: prev.education.map((r, i) => (i === idx ? { ...r, description: v } : r)),
                        }))
                      }}
                    />
                  </div>
                ))}
              </div>
            </form>
          )}
        </div>

        <div
          className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <div className="flex gap-2">
            {page === 2 ? (
              <button
                type="button"
                className="rounded-md border border-white/15 px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                onClick={() => setPage(1)}
              >
                Back
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            {page === 1 ? (
              <>
                <button
                  type="submit"
                  form="form-personal-modal"
                  className="rounded-md bg-[#4db6ac] px-4 py-2 text-sm font-medium text-black hover:brightness-110 disabled:opacity-50"
                  disabled={savingPersonal}
                >
                  {savingPersonal ? 'Saving…' : 'Save highlights'}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10"
                  onClick={() => setPage(2)}
                >
                  Next
                </button>
              </>
            ) : (
              <>
                <button
                  type="submit"
                  form="form-professional-modal"
                  className="rounded-md bg-[#4db6ac] px-4 py-2 text-sm font-medium text-black hover:brightness-110 disabled:opacity-50"
                  disabled={savingProfessional}
                >
                  {savingProfessional ? 'Saving…' : 'Save timeline'}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10"
                  onClick={requestClose}
                >
                  Done
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
