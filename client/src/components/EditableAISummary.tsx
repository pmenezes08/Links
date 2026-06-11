import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import TranslateGlobeButton from './TranslateGlobeButton'
import { renderBoldText } from '../utils/linkUtils'

interface EditableAISummaryProps {
  postId?: number;
  /** When set, updates `replies.audio_summary` instead of the post. */
  replyId?: number;
  initialSummary: string;
  isOwner: boolean;
  onSummaryUpdate: (newSummary: string) => void;
}

export default function EditableAISummary({ postId, replyId, initialSummary, isOwner, onSummaryUpdate }: EditableAISummaryProps) {
  const { t } = useTranslation()
  const [isEditing, setIsEditing] = useState(false);
  const [summary, setSummary] = useState(initialSummary);
  const [isSaving, setIsSaving] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);

  const handleSave = async () => {
    if (!summary.trim()) return;

    setIsSaving(true);
    try {
      const body: Record<string, unknown> = { summary: summary.trim() }
      if (replyId != null) body.reply_id = replyId
      else if (postId != null) body.post_id = postId
      else {
        alert(t('feed.missing_summary_target'))
        setIsSaving(false)
        return
      }
      const response = await fetch('/update_audio_summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const respData = await response.json();
      if (respData.success) {
        onSummaryUpdate(respData.summary);
        setSummary(respData.summary);
        setIsEditing(false);
        setTranslatedText(null);
      } else {
        alert(respData.error || t('feed.update_summary_failed'));
      }
    } catch (error) {
      console.error('Error updating summary:', error);
      alert(t('feed.update_summary_failed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setSummary(initialSummary);
    setIsEditing(false);
  };

  return (
    <div className="px-3 py-2 rounded-lg bg-cpoint-turquoise/10 border border-cpoint-turquoise/30">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-sparkles text-cpoint-turquoise text-xs" />
          <span className="text-xs font-medium text-cpoint-turquoise">
            {translatedText ? t('feed.steve_summary_translated') : t('feed.steve_summary')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {translatedText && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTranslatedText(null);
              }}
              className="text-cpoint-turquoise hover:text-cpoint-turquoise/80 text-xs px-1"
              title={t('feed.show_original')}
            >
              <i className="fa-solid fa-rotate-left" />
            </button>
          )}
          {!isEditing && (
            <TranslateGlobeButton
              text={initialSummary}
              context="voice_summary"
              onTranslated={setTranslatedText}
            />
          )}
          {isOwner && !isEditing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="text-cpoint-turquoise hover:text-cpoint-turquoise/80 text-xs px-1"
              title={t('feed.edit_summary')}
            >
              <i className="fa-solid fa-pencil" />
            </button>
          )}
        </div>
      </div>
      {isEditing ? (
        <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full px-2 py-1 text-sm bg-c-bg-surface text-c-text-primary rounded border border-cpoint-turquoise/30 focus:outline-none focus:border-cpoint-turquoise min-h-[60px]"
            placeholder={t('feed.edit_steve_summary_placeholder')}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving || !summary.trim()}
              className="px-3 py-1 bg-cpoint-turquoise text-white text-xs rounded hover:bg-cpoint-turquoise/80 disabled:opacity-50"
            >
              {isSaving ? t('account.language.saving') : t('common.save')}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="px-3 py-1 bg-c-active-bg text-c-text-primary text-xs rounded hover:bg-white/20"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-c-text-primary leading-relaxed whitespace-pre-wrap">{renderBoldText(translatedText || summary)}</p>
      )}
    </div>
  );
}
