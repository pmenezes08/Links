import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEntitlementsHandler } from '../contexts/EntitlementsContext'
import {
  requestTranslateSummary,
  TRANSLATE_LANGUAGES,
  type TranslateContext,
} from '../utils/translateSummary'

type Props = {
  text: string
  context?: TranslateContext
  disabled?: boolean
  onTranslated?: (translated: string) => void
  className?: string
  menuAlign?: 'left' | 'right'
}

export default function TranslateGlobeButton({
  text,
  context = 'voice_summary',
  disabled = false,
  onTranslated,
  className = '',
  menuAlign = 'right',
}: Props) {
  const { t } = useTranslation()
  const entitlementsHandler = useEntitlementsHandler()
  const [showLanguages, setShowLanguages] = useState(false)
  const [isTranslating, setIsTranslating] = useState(false)

  const handleTranslate = useCallback(
    async (targetLang: string) => {
      if (!text.trim()) return
      setShowLanguages(false)
      setIsTranslating(true)
      try {
        const result = await requestTranslateSummary({
          summary: text,
          targetLanguage: targetLang,
          context,
        })
        if (result.ok) {
          onTranslated?.(result.translated)
        } else if (result.entitlementsError) {
          entitlementsHandler.showError(result.entitlementsError)
        } else {
          alert(result.error || t('feed.translation_failed'))
        }
      } finally {
        setIsTranslating(false)
      }
    },
    [text, context, onTranslated, entitlementsHandler, t],
  )

  if (!text.trim()) return null

  return (
    <div className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setShowLanguages((v) => !v)
        }}
        className="text-[#4db6ac] hover:text-[#4db6ac]/80 text-xs px-1"
        title={t('feed.translate')}
        aria-label={t('feed.translate')}
        disabled={disabled || isTranslating}
      >
        {isTranslating ? (
          <i className="fa-solid fa-spinner fa-spin" />
        ) : (
          <i className="fa-solid fa-globe" />
        )}
      </button>
      {showLanguages && (
        <div
          className={`absolute top-6 z-10 bg-[#1a1d29] border border-[#4db6ac]/30 rounded-lg shadow-lg min-w-[160px] ${
            menuAlign === 'right' ? 'right-0' : 'left-0'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {TRANSLATE_LANGUAGES.map((lang) => (
            <button
              key={lang.code}
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void handleTranslate(lang.code)
              }}
              className="w-full px-3 py-2 text-left text-xs text-white hover:bg-[#4db6ac]/20 flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
            >
              <span>{lang.flag}</span>
              <span>{t(lang.nameKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
