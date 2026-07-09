/**
 * Render-only composer card for the onboarding chat: photo upload, CV
 * upload, and the text/url/textarea input row. Moved verbatim from
 * `pages/OnboardingChat.tsx` — props in, callbacks out.
 *
 * Owns the ResizeObserver that tracks the card's height and reports it
 * up via `onHeightChange`; the page keeps the padding math and the
 * FixedComposerShell wiring.
 */

import { useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { oc } from '../../i18n/onboardingChatHelpers'

interface OnboardingComposerProps {
  showPhotoUpload: boolean
  showCvUpload: boolean
  showInput: boolean
  picFile: File | null
  picPreview: string
  uploadingPic: boolean
  cvFile: File | null
  cvUploading: boolean
  cvFileInputRef: React.RefObject<HTMLInputElement | null>
  inputValue: string
  inputType?: 'text' | 'url' | 'textarea'
  inputPlaceholder?: string
  onInputValueChange: (value: string) => void
  onSubmit: () => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onPhotoUpload: () => void
  onCvFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onCvParseUpload: () => void
  onHeightChange: (height: number) => void
}

export function OnboardingComposer({
  showPhotoUpload,
  showCvUpload,
  showInput,
  picFile,
  picPreview,
  uploadingPic,
  cvFile,
  cvUploading,
  cvFileInputRef,
  inputValue,
  inputType,
  inputPlaceholder,
  onInputValueChange,
  onSubmit,
  onFileSelect,
  onPhotoUpload,
  onCvFileSelect,
  onCvParseUpload,
  onHeightChange,
}: OnboardingComposerProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const composerCardRef = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof ResizeObserver === 'undefined') return
    const node = composerCardRef.current
    if (!node) return

    const updateHeight = () => {
      const height = node.getBoundingClientRect().height
      if (!height) return
      onHeightChange(height)
    }

    updateHeight()
    const observer = new ResizeObserver(updateHeight)
    observer.observe(node)

    return () => {
      observer.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showInput, showPhotoUpload, showCvUpload])

  return (
    <div
      ref={composerCardRef}
      className="shrink-0 border-t border-c-border bg-c-bg-app/95 px-4 py-3"
    >
      {showPhotoUpload && (
        <div className="max-w-lg mx-auto">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={onFileSelect}
            className="hidden"
          />
          <div className="flex items-center gap-3">
            {picPreview ? (
              <img src={picPreview} alt={oc(t, 'ui.preview_alt')} className="w-14 h-14 rounded-full object-cover border-2 border-cpoint-turquoise/40" />
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="w-14 h-14 rounded-full border-2 border-dashed border-c-border flex items-center justify-center cursor-pointer hover:border-cpoint-turquoise/50 transition"
              >
                <i className="fa-solid fa-camera text-c-text-tertiary" />
              </div>
            )}
            <div className="flex-1">
              {!picFile ? (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-2.5 rounded-xl bg-c-bg-surface border border-c-border text-sm text-c-text-secondary hover:bg-c-hover-bg transition w-full"
                >
                  {oc(t, 'ui.choose_photo')}
                </button>
              ) : (
                <button
                  onClick={onPhotoUpload}
                  disabled={uploadingPic}
                  className="px-4 py-2.5 rounded-xl bg-cpoint-turquoise text-c-text-on-accent text-sm font-semibold hover:brightness-110 transition w-full disabled:opacity-50"
                >
                  {uploadingPic ? oc(t, 'ui.uploading') : oc(t, 'ui.upload_photo')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showCvUpload && (
        <div className="max-w-lg mx-auto">
          <input
            ref={cvFileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={onCvFileSelect}
            className="hidden"
          />
          <div className="flex items-center gap-3">
            <div
              onClick={() => !cvUploading && cvFileInputRef.current?.click()}
              className="w-14 h-14 rounded-xl border-2 border-dashed border-c-border flex items-center justify-center cursor-pointer hover:border-cpoint-turquoise/50 transition shrink-0"
              role="presentation"
            >
              <i className="fa-solid fa-file-pdf text-c-text-tertiary text-lg" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-c-text-tertiary truncate mb-1.5">
                {cvFile ? cvFile.name : oc(t, 'ui.no_file')}
              </div>
              {!cvFile ? (
                <button
                  type="button"
                  onClick={() => cvFileInputRef.current?.click()}
                  disabled={cvUploading}
                  className="px-4 py-2.5 rounded-xl bg-c-bg-surface border border-c-border text-sm text-c-text-secondary hover:bg-c-hover-bg transition w-full disabled:opacity-50"
                >
                  {oc(t, 'ui.choose_pdf')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onCvParseUpload}
                  disabled={cvUploading}
                  className="px-4 py-2.5 rounded-xl bg-cpoint-turquoise text-c-text-on-accent text-sm font-semibold hover:brightness-110 transition w-full disabled:opacity-50"
                >
                  {cvUploading ? oc(t, 'ui.reading_cv') : oc(t, 'ui.upload_extract')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {showInput && (
        <div className="max-w-lg mx-auto flex gap-2">
          {inputType === 'textarea' ? (
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={e => onInputValueChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSubmit()
                }
              }}
              placeholder={inputPlaceholder || oc(t, 'placeholders.type_here')}
              rows={3}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-c-border bg-c-bg-surface text-sm text-c-text-primary placeholder-c-text-tertiary focus:border-cpoint-turquoise/50 focus:outline-none resize-none"
            />
          ) : (
            <input
              ref={inputRef}
              type={inputType === 'url' ? 'url' : 'text'}
              value={inputValue}
              onChange={e => onInputValueChange(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  onSubmit()
                }
              }}
              placeholder={inputPlaceholder || oc(t, 'placeholders.type_here')}
              className="flex-1 px-3.5 py-2.5 rounded-xl border border-c-border bg-c-bg-surface text-sm text-c-text-primary placeholder-c-text-tertiary focus:border-cpoint-turquoise/50 focus:outline-none"
              autoFocus
            />
          )}
          <button
            onClick={onSubmit}
            disabled={!inputValue.trim()}
            aria-label={oc(t, 'ui.send_message')}
            className="px-4 py-2.5 rounded-xl bg-cpoint-turquoise text-c-text-on-accent font-semibold text-sm hover:brightness-110 transition disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          >
            <i className="fa-solid fa-paper-plane" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}
