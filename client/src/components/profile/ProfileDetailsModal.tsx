import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import { ProfileSelectField, type SelectOption } from './ProfileSelectField'

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

type PersonalFormShape = {
  first_name: string
  last_name: string
  bio: string
  display_name: string
  date_of_birth: string
  gender: string
  country: string
  city: string
  personal_answer_five_minutes: string
  personal_answer_outside_work: string
  personal_answer_cpoint_goals: string
}

type ProfessionalFormShape = {
  role: string
  company: string
  company_intel: string
  industry: string
  linkedin: string
  about: string
  interests: string[]
  current_role_start: string
  work_history: WorkExperienceRow[]
  education: EducationRow[]
}

type ProfileDetailsModalProps = {
  open: boolean
  onClose: () => void
  personal: PersonalFormShape
  setPersonal: Dispatch<SetStateAction<PersonalFormShape>>
  professional: ProfessionalFormShape
  setProfessional: Dispatch<SetStateAction<ProfessionalFormShape>>
  genderOptions: SelectOption[]
  countryOptions: SelectOption[]
  cityOptions: SelectOption[]
  industryOptions: SelectOption[]
  citySelectDisabled: boolean
  cityPlaceholder: string
  citiesLoading: boolean
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
  genderOptions,
  countryOptions,
  cityOptions,
  industryOptions,
  citySelectDisabled,
  cityPlaceholder,
  citiesLoading,
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 backdrop-blur-sm px-3 py-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-details-title"
    >
      <div className="relative flex max-h-[min(90vh,720px)] w-full max-w-lg flex-col rounded-2xl border border-white/10 bg-[#111] shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
          <div>
            <h2 id="profile-details-title" className="text-base font-semibold text-white">
              Edit profile details
            </h2>
            <p className="text-[11px] text-[#9fb0b5]">
              Page {page} of 2 — {page === 1 ? 'Personal' : 'Professional'}
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

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
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
              <label className="text-sm block">
                Personal bio
                <textarea
                  className="mt-1 w-full min-h-[80px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={personal.bio}
                  onChange={e => setPersonal(prev => ({ ...prev, bio: e.target.value }))}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm min-w-0">
                  First name
                  <input
                    className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={personal.first_name}
                    onChange={e => setPersonal(prev => ({ ...prev, first_name: e.target.value }))}
                  />
                </label>
                <label className="text-sm min-w-0">
                  Last name
                  <input
                    className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={personal.last_name}
                    onChange={e => setPersonal(prev => ({ ...prev, last_name: e.target.value }))}
                  />
                </label>
                <label className="text-sm min-w-0">
                  Display name
                  <input
                    className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={personal.display_name}
                    onChange={e => setPersonal(prev => ({ ...prev, display_name: e.target.value }))}
                  />
                </label>
                <label className="text-sm min-w-0">
                  Date of birth
                  <input
                    type="date"
                    className="mt-1 w-full min-w-0 rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={personal.date_of_birth}
                    onChange={e => setPersonal(prev => ({ ...prev, date_of_birth: e.target.value }))}
                  />
                </label>
                <label className="text-sm min-w-0">
                  Gender
                  <div className="mt-1">
                    <ProfileSelectField
                      value={personal.gender}
                      onChange={v => setPersonal(prev => ({ ...prev, gender: v }))}
                      options={genderOptions}
                      placeholder="Select a value"
                    />
                  </div>
                </label>
                <label className="text-sm min-w-0">
                  Country
                  <div className="mt-1">
                    <ProfileSelectField
                      value={personal.country}
                      onChange={v => setPersonal(prev => ({ ...prev, country: v, city: '' }))}
                      options={countryOptions}
                      placeholder="Select a country"
                      searchable
                      allowCustomOption
                      emptyMessage="No countries match your search"
                    />
                  </div>
                </label>
                <label className="text-sm min-w-0 sm:col-span-2">
                  City
                  <div className="mt-1">
                    <ProfileSelectField
                      value={personal.city}
                      onChange={v => setPersonal(prev => ({ ...prev, city: v }))}
                      options={cityOptions}
                      placeholder={cityPlaceholder}
                      disabled={citySelectDisabled}
                      loading={citiesLoading}
                      searchable
                      allowCustomOption
                      emptyMessage={personal.country ? 'No cities found, type to add your own' : 'Select a country first'}
                    />
                  </div>
                </label>
              </div>
            </form>
          ) : (
            <form id="form-professional-modal" className="space-y-4" onSubmit={onSaveProfessional}>
              <p className="text-xs leading-relaxed text-[#b8c8cc] border border-[#4db6ac]/25 rounded-lg px-3 py-2 bg-[#4db6ac]/5">
                <span className="font-medium text-[#4db6ac]">Steve:</span> {STEVE_PAGE2}
              </p>
              <label className="text-sm block">
                About
                <textarea
                  className="mt-1 w-full min-h-[72px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                  value={professional.about}
                  onChange={e => setProfessional(prev => ({ ...prev, about: e.target.value }))}
                  placeholder="Short professional summary"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Current position
                  <input
                    className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={professional.role}
                    onChange={e => setProfessional(prev => ({ ...prev, role: e.target.value }))}
                    placeholder="e.g. Product Manager"
                  />
                </label>
                <label className="text-sm">
                  Company
                  <input
                    className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={professional.company}
                    onChange={e => setProfessional(prev => ({ ...prev, company: e.target.value }))}
                    placeholder="Company name"
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  <span className="text-white/90">Current role start</span>
                  <span className="block text-[11px] text-[#9fb0b5] font-normal">Month you started this role (optional). Shown as start — Present.</span>
                  <input
                    type="month"
                    className="mt-1 w-full max-w-[200px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={professional.current_role_start}
                    onChange={e => setProfessional(prev => ({ ...prev, current_role_start: e.target.value }))}
                  />
                </label>
                <label className="text-sm sm:col-span-2">
                  Company description
                  <span className="block text-[11px] text-[#9fb0b5] font-normal mb-1">
                    In your own words, what the company does (optional).
                  </span>
                  <textarea
                    className="mt-1 w-full min-h-[72px] rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={professional.company_intel}
                    onChange={e => setProfessional(prev => ({ ...prev, company_intel: e.target.value }))}
                  />
                </label>
                <label className="text-sm">
                  Industry
                  <div className="mt-1">
                    <ProfileSelectField
                      value={professional.industry}
                      onChange={v => setProfessional(prev => ({ ...prev, industry: v }))}
                      options={industryOptions}
                      placeholder="Select an industry"
                      searchable
                      allowCustomOption
                      emptyMessage="No industries match your search"
                    />
                  </div>
                </label>
                <label className="text-sm">
                  LinkedIn URL
                  <input
                    className="mt-1 w-full rounded-md bg-black border border-white/10 px-3 py-2 text-sm outline-none focus:border-[#4db6ac]"
                    value={professional.linkedin}
                    onChange={e => setProfessional(prev => ({ ...prev, linkedin: e.target.value }))}
                    placeholder="https://..."
                  />
                </label>
              </div>

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
                        placeholder="Start"
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

        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-4 py-3">
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
                  {savingPersonal ? 'Saving…' : 'Save personal'}
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
                  {savingProfessional ? 'Saving…' : 'Save professional'}
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
