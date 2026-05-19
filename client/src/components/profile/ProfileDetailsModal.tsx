import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'
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

const PERSONAL_FIELDS = [
  {
    key: 'personal_answer_five_minutes' as const,
    labelKey: 'profile.spotlight.five_minutes',
  },
  {
    key: 'personal_answer_outside_work' as const,
    labelKey: 'profile.spotlight.outside_work',
  },
  {
    key: 'personal_answer_cpoint_goals' as const,
    labelKey: 'profile.spotlight.cpoint_goals',
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
  const { t } = useTranslation()
  const [page, setPage] = useState<1 | 2>(1)

  const stepName =
    page === 1 ? t('profile.details_modal.step_spotlight') : t('profile.details_modal.step_timeline')

  useEffect(() => {
    if (open) setPage(1)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  const requestClose = useCallback(() => {
    onClose()
  }, [onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[1100] flex min-h-0 items-start justify-center overflow-hidden bg-black/75 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur-sm sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-details-title"
    >
      <div className="relative flex max-h-[min(720px,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111] shadow-xl">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <h2 id="profile-details-title" className="text-base font-semibold text-white">
              {t('profile.spotlight.title')}
            </h2>
            <p className="text-[11px] text-[#9fb0b5]">
              {t('profile.details_modal.step', { page, step_name: stepName })}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white"
            onClick={requestClose}
            aria-label={t('profile.aria.close')}
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-3">
          {page === 1 ? (
            <form id="form-personal-modal" className="space-y-4" onSubmit={onSavePersonal}>
              <p className="text-xs leading-relaxed text-[#b8c8cc] border border-[#4db6ac]/25 rounded-lg px-3 py-2 bg-[#4db6ac]/5">
                <span className="font-medium text-[#4db6ac]">{t('profile.details_modal.steve_label')}</span>{' '}
                {t('profile.details_modal.steve_page1')}
              </p>
              {PERSONAL_FIELDS.map(field => (
                <label key={field.key} className="text-sm block">
                  <span className="text-white/90">{t(field.labelKey)}</span>
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
                <span className="font-medium text-[#4db6ac]">{t('profile.details_modal.steve_label')}</span>{' '}
                {t('profile.details_modal.steve_page2')}
              </p>
              <label className="text-sm sm:col-span-2 block">
                <span className="text-white/90">{t('profile.details_modal.current_role_start')}</span>
                <span className="block text-[11px] text-[#9fb0b5] font-normal">
                  {t('profile.details_modal.current_role_start_hint')}
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
                  <span className="text-sm font-medium text-white">{t('profile.details_modal.more_experience')}</span>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[#4db6ac]/50 text-[#4db6ac] hover:bg-[#4db6ac]/15"
                    onClick={() =>
                      setProfessional(prev => ({
                        ...prev,
                        work_history: [...prev.work_history, { ...EMPTY_WORK }],
                      }))
                    }
                    aria-label={t('profile.aria.add_experience')}
                  >
                    <i className="fa-solid fa-plus" />
                  </button>
                </div>
                {professional.work_history.length === 0 ? (
                  <p className="text-xs text-[#9fb0b5]">{t('profile.details_modal.add_experience_hint')}</p>
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
                        {t('profile.remove')}
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <input
                        className="rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                        placeholder={t('profile.work.title')}
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
                        placeholder={t('profile.work.company')}
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
                        placeholder={t('profile.work.location_optional')}
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
                        <span>{t('profile.work.start_month')}</span>
                        <span>{t('profile.work.end_month_optional')}</span>
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
                      placeholder={t('profile.work.description')}
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
                  <span className="text-sm font-medium text-white">{t('profile.details_modal.education')}</span>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center rounded-full border border-[#4db6ac]/50 text-[#4db6ac] hover:bg-[#4db6ac]/15"
                    onClick={() =>
                      setProfessional(prev => ({
                        ...prev,
                        education: [...prev.education, { ...EMPTY_EDU }],
                      }))
                    }
                    aria-label={t('profile.aria.add_education')}
                  >
                    <i className="fa-solid fa-plus" />
                  </button>
                </div>
                {professional.education.length === 0 ? (
                  <p className="text-xs text-[#9fb0b5]">{t('profile.details_modal.add_education_hint')}</p>
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
                        {t('profile.remove')}
                      </button>
                    </div>
                    <input
                      className="w-full rounded-md bg-black border border-white/10 px-2 py-1.5 text-sm"
                      placeholder={t('profile.education.school')}
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
                      placeholder={t('profile.education.degree_optional')}
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
                      placeholder={t('profile.education.description_optional')}
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
                {t('profile.public.back')}
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
                  {savingPersonal ? t('profile.saving') : t('profile.details_modal.save_highlights')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10"
                  onClick={() => setPage(2)}
                >
                  {t('profile.next')}
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
                  {savingProfessional ? t('profile.saving') : t('profile.details_modal.save_timeline')}
                </button>
                <button
                  type="button"
                  className="rounded-md border border-white/15 px-4 py-2 text-sm text-white hover:bg-white/10"
                  onClick={requestClose}
                >
                  {t('profile.done')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
