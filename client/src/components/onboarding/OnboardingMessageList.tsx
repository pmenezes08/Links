/**
 * Render-only message list for the onboarding chat: Steve/user bubbles,
 * section cards, section picker, quick replies, composed-bio review,
 * profile review, enrichment cards, and the typing indicator. Moved
 * verbatim from `pages/OnboardingChat.tsx` — props in, callbacks out.
 *
 * The page keeps the padding math; `listPaddingBottom` arrives computed.
 */

import SteveAvatar from '../steve/SteveAvatar'
import { renderBoldText } from '../../utils/linkUtils'
import { useTranslation } from 'react-i18next'
import { oc } from '../../i18n/onboardingChatHelpers'
import type { ChatMessage, EnrichmentCard, Stage } from './types'

interface OnboardingMessageListProps {
  messages: ChatMessage[]
  stage: Stage
  isTyping: boolean
  enriching: boolean
  composingBio: boolean
  bioDraftingKind: 'personal' | 'professional' | null
  enrichmentCards: EnrichmentCard[]
  allCardsReviewed: boolean
  listPaddingBottom: string
  onOptionClick: (value: string) => void
  onCardAction: (cardId: string, action: 'accepted' | 'dismissed') => void
  onFinishReview: () => void
  messagesEndRef: React.RefObject<HTMLDivElement | null>
}

export function OnboardingMessageList({
  messages,
  stage,
  isTyping,
  enriching,
  composingBio,
  bioDraftingKind,
  enrichmentCards,
  allCardsReviewed,
  listPaddingBottom,
  onOptionClick,
  onCardAction,
  onFinishReview,
  messagesEndRef,
}: OnboardingMessageListProps) {
  const { t } = useTranslation()
  return (
    <div className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: listPaddingBottom }}>
      <div className="max-w-lg mx-auto space-y-3" role="log" aria-live="polite">
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.from === 'steve' ? (
              <div className="flex items-start gap-2.5">
                <SteveAvatar size={28} className="mt-0.5" />
                <div className="max-w-[85%] space-y-2">
                  <div className="bg-c-bg-surface border border-c-border rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-[13px] text-c-text-secondary leading-relaxed whitespace-pre-line">
                    {renderBoldText(msg.text)}
                  </div>
                  {msg.sectionCard && (
                    <div className="rounded-2xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/[0.06] px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cpoint-turquoise">
                        {msg.sectionCard.title}
                      </div>
                      <div className="mt-1 text-xs leading-relaxed text-c-text-secondary">
                        {msg.sectionCard.subtitle}
                      </div>
                      <div className="mt-3 grid gap-2">
                        {msg.sectionCard.steps.map((step, idx) => (
                          <div
                            key={step}
                            className="rounded-lg border border-c-border bg-c-hover-bg px-3 py-2 text-[12px] text-c-text-tertiary"
                          >
                            {idx + 1}. {step}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {msg.sectionPicker && (
                    <div className="grid gap-2 rounded-2xl border border-cpoint-turquoise/25 bg-cpoint-turquoise/[0.05] px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cpoint-turquoise">
                        {oc(t, 'ui.choose_next_section')}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <button
                          type="button"
                          onClick={() => onOptionClick('choose_personal_section')}
                          className="rounded-xl border border-c-border bg-c-hover-bg px-3 py-2 text-left transition hover:border-cpoint-turquoise/35 hover:bg-cpoint-turquoise/10"
                          >
                          <div className="text-[12px] font-semibold text-c-text-primary">{oc(t, 'ui.personal_identity')}</div>
                          <div className="mt-1 text-[11px] text-c-text-tertiary">
                            {oc(t, 'ui.personal_card_meta', { status: msg.sectionPicker.personalStatus })}
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => onOptionClick('choose_professional_section')}
                          className="rounded-xl border border-c-border bg-c-hover-bg px-3 py-2 text-left transition hover:border-cpoint-turquoise/35 hover:bg-cpoint-turquoise/10"
                          >
                          <div className="text-[12px] font-semibold text-c-text-primary">{oc(t, 'ui.professional_identity')}</div>
                          <div className="mt-1 text-[11px] text-c-text-tertiary">
                            {oc(t, 'ui.professional_card_meta', { status: msg.sectionPicker.professionalStatus })}
                          </div>
                        </button>
                      </div>
                    </div>
                  )}
                  {/* Quick reply buttons */}
                  {msg.options && i === messages.length - 1 && stage !== 'complete' && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {msg.options.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => onOptionClick(opt.value)}
                          className={opt.primary
                            ? 'rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-left text-[12px] font-semibold text-c-text-on-accent transition hover:brightness-110'
                            : 'rounded-xl border border-cpoint-turquoise/35 bg-c-hover-bg px-4 py-2.5 text-left text-[12px] font-semibold text-c-accent-ink transition-colors hover:bg-cpoint-turquoise/10'}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Complete stage options persist — one primary action, the rest quiet */}
                  {msg.options && stage === 'complete' && i === messages.length - 1 && (
                    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                      {msg.options.map(opt => (
                        <button
                          key={opt.value}
                          onClick={() => onOptionClick(opt.value)}
                          className={opt.primary
                            ? 'rounded-xl bg-cpoint-turquoise px-4 py-2.5 text-left text-[12px] font-semibold text-c-text-on-accent transition hover:brightness-110'
                            : 'rounded-xl border border-c-border bg-c-hover-bg px-4 py-2.5 text-left text-[12px] font-medium text-c-text-secondary transition-colors hover:bg-c-active-bg'}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {/* Composed bio preview with action buttons */}
                  {msg.composedBio && i === messages.length - 1 && (stage === 'personal_bio_review' || stage === 'professional_bio_review') && !composingBio && (
                    <div className="space-y-2 mt-1">
                      <div className="rounded-xl border border-cpoint-turquoise/20 bg-cpoint-turquoise/5 px-3.5 py-3">
                        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-cpoint-turquoise">
                          {msg.composedBioKind === 'professional'
                            ? oc(t, 'ui.professional_bio_label')
                            : oc(t, 'ui.personal_bio_label')}
                        </div>
                        <div className="text-[13px] text-c-text-secondary leading-relaxed italic">"{msg.composedBio}"</div>
                      </div>
                      {msg.composedBioKind === 'professional' && msg.composedCompanyIntel ? (
                        <div className="rounded-xl border border-c-border bg-c-bg-surface px-3.5 py-3">
                          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-c-text-tertiary">
                            {oc(t, 'ui.company_intel')}
                          </div>
                          <div className="text-[13px] text-c-text-secondary leading-relaxed italic">"{msg.composedCompanyIntel}"</div>
                        </div>
                      ) : null}
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => onOptionClick('use_bio')} className="px-3.5 py-2 rounded-xl border border-cpoint-turquoise/30 bg-cpoint-turquoise/10 text-[12px] font-medium text-cpoint-turquoise hover:bg-cpoint-turquoise/20 transition-colors">
                          {oc(t, 'options.use_this')}
                        </button>
                        <button onClick={() => onOptionClick('bio_more_natural')} className="px-3.5 py-2 rounded-xl border border-c-border bg-c-hover-bg text-[12px] font-medium text-c-text-tertiary hover:bg-c-active-bg transition-colors">
                          {oc(t, 'options.more_natural')}
                        </button>
                        <button onClick={() => onOptionClick('bio_shorter')} className="px-3.5 py-2 rounded-xl border border-c-border bg-c-hover-bg text-[12px] font-medium text-c-text-tertiary hover:bg-c-active-bg transition-colors">
                          {oc(t, 'options.shorter')}
                        </button>
                        <button onClick={() => onOptionClick('bio_more_professional')} className="px-3.5 py-2 rounded-xl border border-c-border bg-c-hover-bg text-[12px] font-medium text-c-text-tertiary hover:bg-c-active-bg transition-colors">
                          {oc(t, 'options.more_professional')}
                        </button>
                        <button onClick={() => onOptionClick('edit_bio')} className="px-3.5 py-2 rounded-xl border border-c-border bg-c-hover-bg text-[12px] font-medium text-c-text-tertiary hover:bg-c-active-bg transition-colors">
                          {oc(t, 'options.edit')}
                        </button>
                        <button onClick={() => onOptionClick('redo_bio')} className="px-3.5 py-2 rounded-xl border border-c-border bg-c-hover-bg text-[12px] font-medium text-c-text-tertiary hover:bg-c-active-bg transition-colors">
                          {oc(t, 'options.start_fresh')}
                        </button>
                      </div>
                    </div>
                  )}
                  {msg.profileReview && i === messages.length - 1 && (
                    <div className="space-y-2 mt-1">
                      <div className="rounded-xl border border-cpoint-turquoise/20 bg-cpoint-turquoise/5 px-3.5 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cpoint-turquoise">
                          {oc(t, 'ui.personal_bio_label')}
                        </div>
                        <div className="mt-2 text-[13px] leading-relaxed text-c-text-secondary">
                          {msg.profileReview.personalBio || oc(t, 'ui.not_added_yet')}
                        </div>
                      </div>
                      <div className="rounded-xl border border-c-border bg-c-bg-surface px-3.5 py-3">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-c-text-tertiary">
                          {oc(t, 'ui.professional_bio_label')}
                        </div>
                        <div className="mt-2 text-[13px] leading-relaxed text-c-text-secondary">
                          {msg.profileReview.professionalBio || oc(t, 'ui.not_added_yet')}
                        </div>
                        <div className="mt-3 rounded-lg border border-c-border bg-c-hover-bg px-3 py-2 text-[12px] text-c-text-secondary">
                          {oc(t, 'ui.linkedin_row', {
                            status: msg.profileReview.linkedinAdded ? oc(t, 'ui.added') : oc(t, 'ui.not_added'),
                          })}
                        </div>
                        <div className="mt-2 rounded-lg border border-c-border bg-c-hover-bg px-3 py-2 text-[12px] text-c-text-secondary">
                          {oc(t, 'ui.company_intel_row', {
                            status: msg.profileReview.companyIntelAdded ? oc(t, 'ui.added') : oc(t, 'ui.not_added'),
                          })}
                        </div>
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
                              ? 'border-cpoint-turquoise/40 bg-cpoint-turquoise/10'
                              : card.status === 'dismissed'
                              ? 'border-c-border bg-c-bg-surface opacity-50'
                              : 'border-c-border bg-c-bg-surface'
                          }`}
                        >
                          <div className="text-[11px] text-c-text-tertiary uppercase tracking-wider mb-1">{card.label}</div>
                          <div className="text-[13px] text-c-text-secondary leading-relaxed">{card.detail}</div>
                          {card.status === 'pending' && (
                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => onCardAction(card.id, 'accepted')}
                                className="px-3 py-1.5 rounded-lg bg-cpoint-turquoise/15 border border-cpoint-turquoise/30 text-[11px] font-medium text-cpoint-turquoise"
                              >
                                <i className="fa-solid fa-check mr-1" aria-hidden="true" />{oc(t, 'options.accept')}
                              </button>
                              <button
                                onClick={() => onCardAction(card.id, 'dismissed')}
                                className="px-3 py-1.5 rounded-lg bg-c-hover-bg border border-c-border text-[11px] font-medium text-c-text-tertiary"
                              >
                                <i className="fa-solid fa-xmark mr-1" aria-hidden="true" />{oc(t, 'options.dismiss')}
                              </button>
                            </div>
                          )}
                          {card.status === 'accepted' && (
                            <div className="text-[10px] text-cpoint-turquoise/70 mt-1.5"><i className="fa-solid fa-check mr-1" aria-hidden="true" />{oc(t, 'ui.added_to_profile')}</div>
                          )}
                          {card.status === 'dismissed' && (
                            <div className="text-[10px] text-c-text-tertiary mt-1.5">{oc(t, 'ui.dismissed')}</div>
                          )}
                        </div>
                      ))}
                      {allCardsReviewed && (
                        <button
                          onClick={onFinishReview}
                          className="w-full mt-2 px-4 py-3 rounded-xl bg-cpoint-turquoise text-c-text-on-accent text-sm font-semibold hover:brightness-110 transition"
                        >
                          {oc(t, 'ui.continue_btn')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex justify-end">
                <div className="max-w-[80%] bg-cpoint-turquoise/20 border border-cpoint-turquoise/20 rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-[13px] text-c-text-secondary leading-relaxed">
                  {msg.text}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {(isTyping || enriching) && (
          <div className="flex items-start gap-2.5">
            <SteveAvatar size={28} className="mt-0.5" />
            <div className="bg-c-bg-surface border border-c-border rounded-2xl rounded-tl-sm px-4 py-3">
              {bioDraftingKind && (
                <div className="mb-2 text-[12px] font-medium text-c-text-secondary">
                  {oc(t, 'ui.drafting_bio', {
                    kind:
                      bioDraftingKind === 'professional'
                        ? oc(t, 'ui.bio_kind_professional')
                        : oc(t, 'ui.bio_kind_personal'),
                  })}
                </div>
              )}
              <div className="flex gap-1" aria-hidden="true">
                <div className="w-2 h-2 rounded-full bg-c-text-tertiary animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 rounded-full bg-c-text-tertiary animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 rounded-full bg-c-text-tertiary animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
              <span className="sr-only">{oc(t, 'ui.steve_typing')}</span>
            </div>
            {/* enriching indicator hidden as feature is now admin-only */}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>
    </div>
  )
}
