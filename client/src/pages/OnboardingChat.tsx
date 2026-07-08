import { useState, useRef, useCallback, useMemo } from 'react'
import { FixedComposerShell } from '../components/FixedComposerShell'
import BrandLogo from '../components/BrandLogo'
import { useTranslation } from 'react-i18next'
import { useFixedComposerKeyboard } from '../hooks/useFixedComposerKeyboard'
import { useOnboardingChatFlow } from '../hooks/useOnboardingChatFlow'
import { getTourSteps, oc } from '../i18n/onboardingChatHelpers'
import type { ProfileSection } from '../components/onboarding/types'
import { OnboardingChatHeader } from '../components/onboarding/OnboardingChatHeader'
import { OnboardingMessageList } from '../components/onboarding/OnboardingMessageList'
import { OnboardingComposer } from '../components/onboarding/OnboardingComposer'
import { OnboardingDeferModal } from '../components/onboarding/OnboardingDeferModal'
import { OnboardingTourModal } from '../components/onboarding/OnboardingTourModal'

// Re-exported for consumers/tests that treat the page as the flow's public
// surface (`OnboardingChat.resume.test.tsx` imports these from here).
export {
  isIntroProfileDeferredStage,
  normalizeResumeStage,
  shouldShowResumeWelcome,
} from '../components/onboarding/stageFlow'

interface OnboardingChatProps {
  firstName: string
  lastName: string
  username: string
  displayName: string
  communityName?: string | null
  hasCommunity: boolean
  existingProfilePic: string
  mode?: 'fresh' | 'profile_builder' | 'section_only'
  targetSection?: ProfileSection
  onComplete: () => void
  onCreateCommunity: () => void
  onGoToCommunity: () => void
  onExit: () => void
}

export default function OnboardingChat({
  firstName: initFirst,
  lastName: initLast,
  username,
  communityName,
  hasCommunity,
  existingProfilePic,
  onComplete,
  onCreateCommunity,
  onGoToCommunity: _onGoToCommunity,
  onExit,
  mode = 'fresh',
  targetSection,
}: OnboardingChatProps) {
  const { t } = useTranslation()
  const tourSteps = useMemo(() => getTourSteps(t), [t])

  const {
    progress,
    stage,
    messages,
    inputValue,
    setInputValue,
    isTyping,
    enriching,
    composingBio,
    bioDraftingKind,
    enrichmentCards,
    allCardsReviewed,
    booting,
    picFile,
    picPreview,
    uploadingPic,
    cvFile,
    cvUploading,
    cvFileInputRef,
    tourStep,
    setTourStep,
    showDeferConfirm,
    setShowDeferConfirm,
    deferringProfile,
    deferError,
    setDeferError,
    messagesEndRef,
    scrollToBottom,
    handleOptionClick,
    handleSubmit,
    handleCardAction,
    handleFinishReview,
    finishLater,
    handleFileSelect,
    handlePhotoUpload,
    handleCvFileSelect,
    handleCvParseUpload,
    completeOnboarding,
  } = useOnboardingChatFlow({
    initFirst,
    initLast,
    username,
    communityName,
    hasCommunity,
    existingProfilePic,
    mode,
    targetSection,
    onComplete,
    onCreateCommunity,
    onExit,
  })

  const composerRef = useRef<HTMLDivElement | null>(null)
  const defaultComposerPadding = 72
  const [composerHeight, setComposerHeight] = useState(defaultComposerPadding)

  const { keyboardLift, safeBottomPx } = useFixedComposerKeyboard({ onLayoutNudge: scrollToBottom })

  const lastSteveMsg = [...messages].reverse().find(m => m.from === 'steve')
  const showCvUpload = Boolean(lastSteveMsg?.cvUpload && stage === 'cv_upload')
  const showInput =
    Boolean(lastSteveMsg?.inputType) &&
    stage !== 'enriching' &&
    stage !== 'review' &&
    stage !== 'complete' &&
    !composingBio &&
    !showCvUpload
  const showPhotoUpload = lastSteveMsg?.photoUpload && stage === 'photo'
  const showComposer = showInput || showPhotoUpload || showCvUpload
  const bottomChromeInset = keyboardLift > 0 ? keyboardLift : safeBottomPx
  const effectiveComposerHeight = showComposer ? composerHeight : 24
  const listPaddingBottom = `${bottomChromeInset + effectiveComposerHeight + 8}px`

  // The composer card measures itself (ResizeObserver in OnboardingComposer)
  // and reports its height up; the padding math above stays here.
  const handleComposerHeightChange = useCallback((height: number) => {
    setComposerHeight(prev => (Math.abs(prev - height) < 1 ? prev : height))
  }, [])

  if (booting) {
    return (
      <div className="fixed inset-0 z-[1200] bg-c-bg-app flex items-center justify-center px-6" style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex flex-col items-center gap-4 text-center">
          <BrandLogo className="w-14 h-14 rounded-2xl object-contain" />
          <div className="w-8 h-8 rounded-full border-2 border-c-border border-t-cpoint-turquoise animate-spin" />
          <div className="text-sm text-c-text-secondary">{oc(t, 'ui.booting')}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[1200] bg-c-bg-app flex flex-col" style={{ height: '100dvh' }}>
      {/* Header with logo */}
      <OnboardingChatHeader progress={progress} onExitClick={() => setShowDeferConfirm(true)} />

      {/* Messages */}
      <OnboardingMessageList
        messages={messages}
        stage={stage}
        isTyping={isTyping}
        enriching={enriching}
        composingBio={composingBio}
        bioDraftingKind={bioDraftingKind}
        enrichmentCards={enrichmentCards}
        allCardsReviewed={allCardsReviewed()}
        listPaddingBottom={listPaddingBottom}
        onOptionClick={handleOptionClick}
        onCardAction={handleCardAction}
        onFinishReview={handleFinishReview}
        messagesEndRef={messagesEndRef}
      />

      {/* Composer \u2014 portaled for Android keyboard lift (matches ChatThread) */}
      {showComposer && (
        <FixedComposerShell
          keyboardLift={keyboardLift}
          safeBottomPx={safeBottomPx}
          shellRef={composerRef}
          className="fixed left-0 right-0 z-[1201]"
          spacerBackground="var(--c-bg-app)"
        >
          <OnboardingComposer
            showPhotoUpload={!!showPhotoUpload}
            showCvUpload={showCvUpload}
            showInput={showInput}
            picFile={picFile}
            picPreview={picPreview}
            uploadingPic={uploadingPic}
            cvFile={cvFile}
            cvUploading={cvUploading}
            cvFileInputRef={cvFileInputRef}
            inputValue={inputValue}
            inputType={lastSteveMsg?.inputType}
            inputPlaceholder={lastSteveMsg?.inputPlaceholder}
            onInputValueChange={setInputValue}
            onSubmit={handleSubmit}
            onFileSelect={handleFileSelect}
            onPhotoUpload={handlePhotoUpload}
            onCvFileSelect={handleCvFileSelect}
            onCvParseUpload={handleCvParseUpload}
            onHeightChange={handleComposerHeightChange}
          />
        </FixedComposerShell>
      )}

      {showDeferConfirm && (
        <OnboardingDeferModal
          deferringProfile={deferringProfile}
          deferError={deferError}
          onKeepGoing={() => {
            setDeferError('')
            setShowDeferConfirm(false)
          }}
          onFinishLater={finishLater}
        />
      )}

      {/* Platform tour modal */}
      {tourStep !== null && (
        <OnboardingTourModal
          tourStep={tourStep}
          tourSteps={tourSteps}
          onClose={() => setTourStep(null)}
          onBack={() => setTourStep(tourStep > 0 ? tourStep - 1 : null)}
          onNext={async () => {
            if (tourStep < tourSteps.length - 1) {
              setTourStep(tourStep + 1)
            } else {
              setTourStep(null)
              await completeOnboarding()
              onComplete()
            }
          }}
        />
      )}
    </div>
  )
}
