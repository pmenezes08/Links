import { useState, useEffect } from 'react'

interface ArticleReaderModalProps {
  isOpen: boolean
  url: string | null
  onClose: () => void
}

export default function ArticleReaderModal({ isOpen, url, onClose }: ArticleReaderModalProps) {
  const [article, setArticle] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showOriginal, setShowOriginal] = useState(false)

  useEffect(() => {
    if (isOpen && url) {
      fetchArticle(url)
      setShowOriginal(false)
    } else {
      setArticle(null)
      setError('')
      setShowOriginal(false)
    }
  }, [isOpen, url])

  const fetchArticle = async (articleUrl: string) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ url: articleUrl })
      const res = await fetch(`/api/articles/read?${params.toString()}`, { 
        credentials: 'include',
        headers: { 'Accept': 'application/json' }
      })
      const data = await res.json()
      if (data.success) {
        setArticle(data)
      } else {
        setError(data.error || 'Failed to load article')
      }
    } catch (err) {
      console.error('Article fetch error:', err)
      setError('Network error loading article. Please try opening in new tab.')
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen || !url) return null

  return (
    <div 
      className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div 
        className="bg-zinc-900 rounded-3xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with tabs like X in-app viewer */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700 bg-zinc-950">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-500/10 rounded-full flex items-center justify-center">
              <i className="fa-solid fa-newspaper text-blue-400 text-xl"></i>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-white tracking-tight">In-Platform Reader</h2>
              <p className="text-xs text-zinc-500">
                {showOriginal ? 'Original page view' : 'Clean view • Powered by Trafilatura'}
              </p>
            </div>
          </div>

          {/* Tabs for Clean vs Original (like X) */}
          <div className="flex bg-zinc-800 rounded-full p-0.5 text-sm font-medium">
            <button
              onClick={() => setShowOriginal(false)}
              className={`px-5 py-1.5 rounded-full transition-all ${
                !showOriginal 
                  ? 'bg-zinc-900 text-white shadow-sm' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Clean Read
            </button>
            <button
              onClick={() => setShowOriginal(true)}
              className={`px-5 py-1.5 rounded-full transition-all ${
                showOriginal 
                  ? 'bg-zinc-900 text-white shadow-sm' 
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Original Page
            </button>
          </div>

          <button 
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white transition-colors rounded-full hover:bg-zinc-800 ml-4"
            aria-label="Close reader"
          >
            <i className="fa-solid fa-xmark text-2xl"></i>
          </button>
        </div>

        {/* Article Content - supports both clean text (improved paragraphs) and original page like X */}
        <div className="flex-1 overflow-auto bg-zinc-950">
          {loading && (
            <div className="flex flex-col items-center justify-center h-64 text-zinc-400">
              <div className="animate-spin w-8 h-8 border-4 border-zinc-700 border-t-blue-400 rounded-full mb-4"></div>
              <p>Extracting clean article text...</p>
            </div>
          )}

          {error && (
            <div className="p-8 text-center">
              <div className="bg-red-950/50 border border-red-900 rounded-2xl p-8 mx-auto max-w-md">
                <i className="fa-solid fa-circle-exclamation text-4xl text-red-400 mb-4"></i>
                <p className="text-red-300 text-lg mb-2">Could not load article</p>
                <p className="text-zinc-400 mb-6">{error}</p>
                <button
                  onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}
                  className="px-6 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-medium"
                >
                  Open in New Tab Instead
                </button>
              </div>
            </div>
          )}

          {article && !loading && (
            <>
              {/* Header with title (shown for both modes) */}
              <div className="px-8 pt-8 pb-6 border-b border-zinc-800 bg-zinc-900 sticky top-0 z-10">
                <h1 className="text-3xl font-bold text-white leading-tight mb-3">
                  {article.title || 'Article'}
                </h1>
                <a 
                  href={article.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 text-sm inline-flex items-center gap-1 hover:underline"
                >
                  {article.url}
                  <i className="fa-solid fa-external-link text-xs"></i>
                </a>
              </div>

              {/* Content area */}
              <div className="p-8 text-zinc-200">
                {showOriginal ? (
                  /* Original page inside the app (iframe like X in-app browser) */
                  <div className="bg-white rounded-2xl overflow-hidden shadow-inner h-[calc(100vh-280px)]">
                    <iframe
                      src={article.url}
                      className="w-full h-full border-0"
                      title={article.title || 'Original Article'}
                      sandbox="allow-scripts allow-same-origin allow-popups"
                    />
                  </div>
                ) : (
                  /* Improved clean view with better paragraph detection */
                  <div className="prose prose-invert prose-zinc max-w-none text-[15.5px] leading-[1.85] text-zinc-100">
                    {article.content ? (
                      article.content
                        .split(/[\r\n]{2,}/)
                        .map((paragraph: string, idx: number) => {
                          const trimmed = paragraph.trim();
                          return trimmed ? (
                            <p key={idx} className="mb-6 last:mb-0 text-zinc-100">
                              {trimmed}
                            </p>
                          ) : null;
                        })
                    ) : (
                      <p className="italic text-zinc-400">No readable content found.</p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-6 border-t border-zinc-700 bg-zinc-950 flex items-center gap-3">
          <button
            onClick={() => {
              if (article?.url) window.open(article.url, '_blank', 'noopener,noreferrer')
            }}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-medium transition-colors"
          >
            <i className="fa-solid fa-up-right-from-square"></i>
            Open in New Tab
          </button>
          
          <button
            onClick={onClose}
            className="flex-1 py-3.5 bg-white text-zinc-900 hover:bg-zinc-100 rounded-2xl font-semibold transition-colors"
          >
            Close Reader
          </button>
        </div>
      </div>
    </div>
  )
}
