import { useState } from 'react'

interface EditableAISummaryProps {
  postId: number;
  initialSummary: string;
  isOwner: boolean;
  onSummaryUpdate: (newSummary: string) => void;
}

export default function EditableAISummary({ postId, initialSummary, isOwner, onSummaryUpdate }: EditableAISummaryProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [summary, setSummary] = useState(initialSummary);
  const [isSaving, setIsSaving] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);
  const [showLanguages, setShowLanguages] = useState(false);
  
  const languages = [
    { code: 'pt', name: 'Portuguese (PT)', flag: '🇵🇹' },
    { code: 'en', name: 'English', flag: '🇬🇧' },
    { code: 'fr', name: 'French', flag: '🇫🇷' },
    { code: 'de', name: 'German', flag: '🇩🇪' },
    { code: 'es', name: 'Spanish', flag: '🇪🇸' },
    { code: 'it', name: 'Italian', flag: '🇮🇹' }
  ];
  
  const handleTranslate = async (targetLang: string) => {
    setShowLanguages(false);
    setIsTranslating(true);
    try {
      const response = await fetch('/translate_summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          summary: initialSummary, 
          target_language: targetLang 
        })
      });
      const data = await response.json();
      if (data.success) {
        setTranslatedText(data.translated_summary);
      } else {
        alert(data.error || 'Translation failed');
      }
    } catch (error) {
      console.error('Translation error:', error);
      alert('Translation failed');
    } finally {
      setIsTranslating(false);
    }
  };
  
  const handleSave = async () => {
    if (!summary.trim()) return;
    
    setIsSaving(true);
    try {
      const response = await fetch('/update_audio_summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: postId, summary: summary.trim() })
      });
      
      const respData = await response.json();
      if (respData.success) {
        onSummaryUpdate(respData.summary);
        setSummary(respData.summary);
        setIsEditing(false);
        setTranslatedText(null); // Clear translation after edit
      } else {
        alert(respData.error || 'Failed to update summary');
      }
    } catch (error) {
      console.error('Error updating summary:', error);
      alert('Failed to update summary');
    } finally {
      setIsSaving(false);
    }
  };
  
  const handleCancel = () => {
    setSummary(initialSummary);
    setIsEditing(false);
  };
  
  return (
    <div className="px-3 py-2 rounded-lg bg-[#4db6ac]/10 border border-[#4db6ac]/30">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <i className="fa-solid fa-sparkles text-[#4db6ac] text-xs" />
          <span className="text-xs font-medium text-[#4db6ac]">
            {translatedText ? 'AI Summary (Translated)' : 'AI Summary'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {translatedText && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTranslatedText(null);
              }}
              className="text-[#4db6ac] hover:text-[#4db6ac]/80 text-xs px-1"
              title="Show original"
            >
              <i className="fa-solid fa-rotate-left" />
            </button>
          )}
          {!isEditing && (
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowLanguages(!showLanguages);
                }}
                className="text-[#4db6ac] hover:text-[#4db6ac]/80 text-xs px-1"
                title="Translate"
                disabled={isTranslating}
              >
                {isTranslating ? (
                  <i className="fa-solid fa-spinner fa-spin" />
                ) : (
                  <i className="fa-solid fa-language" />
                )}
              </button>
              {showLanguages && (
                <div 
                  className="absolute right-0 top-6 z-10 bg-[#1a1d29] border border-[#4db6ac]/30 rounded-lg shadow-lg min-w-[160px]"
                  onClick={(e) => e.stopPropagation()}
                >
                  {languages.map(lang => (
                    <button
                      key={lang.code}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleTranslate(lang.code);
                      }}
                      className="w-full px-3 py-2 text-left text-xs text-white hover:bg-[#4db6ac]/20 flex items-center gap-2 first:rounded-t-lg last:rounded-b-lg"
                    >
                      <span>{lang.flag}</span>
                      <span>{lang.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {isOwner && !isEditing && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsEditing(true);
              }}
              className="text-[#4db6ac] hover:text-[#4db6ac]/80 text-xs px-1"
              title="Edit summary"
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
            className="w-full px-2 py-1 text-sm bg-[#1a1d29] text-white rounded border border-[#4db6ac]/30 focus:outline-none focus:border-[#4db6ac] min-h-[60px]"
            placeholder="Edit AI summary..."
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={isSaving || !summary.trim()}
              className="px-3 py-1 bg-[#4db6ac] text-white text-xs rounded hover:bg-[#4db6ac]/80 disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="px-3 py-1 bg-white/10 text-white text-xs rounded hover:bg-white/20"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-white/90 leading-relaxed">{translatedText || summary}</p>
      )}
    </div>
  );
}
