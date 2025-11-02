import { useState, useEffect } from 'react'

type TalkingAvatarModalProps = {
  isOpen: boolean
  onClose: () => void
  audioBlob: Blob
  audioDuration: number
  userProfilePic?: string | null
  username: string
  onSubmit: (audioFile: File, imageFile: File | null, useProfilePic: boolean) => Promise<void>
}

export function TalkingAvatarModal({ 
  isOpen, 
  onClose, 
  audioBlob,
  audioDuration,
  userProfilePic,
  username,
  onSubmit
}: TalkingAvatarModalProps) {
  const [selectedImage, setSelectedImage] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [useProfilePic, setUseProfilePic] = useState(!!userProfilePic)
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (userProfilePic) {
      setImagePreview(userProfilePic)
      setUseProfilePic(true)
    }
  }, [userProfilePic])

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    // Validate file
    if (!file.type.startsWith('image/')) {
      setError('Please select an image file (JPEG or PNG)')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB')
      return
    }

    setError(null)
    setSelectedImage(file)
    setUseProfilePic(false)
    
    // Generate preview
    const reader = new FileReader()
    reader.onload = (e) => setImagePreview(e.target?.result as string)
    reader.readAsDataURL(file)
  }

  const handleGenerate = async () => {
    if (!useProfilePic && !selectedImage) {
      setError('Please select an image')
      return
    }

    setError(null)
    setIsGenerating(true)
    
    try {
      // Convert blob to file
      const audioFile = new File([audioBlob], 'voice-message.webm', { type: audioBlob.type })
      await onSubmit(audioFile, selectedImage, useProfilePic)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to create talking avatar')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleSwitchToProfilePic = () => {
    if (userProfilePic) {
      setUseProfilePic(true)
      setSelectedImage(null)
      setImagePreview(userProfilePic)
      setError(null)
    }
  }

  const canGenerate = (useProfilePic && userProfilePic) || selectedImage

  if (!isOpen) return null

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4" onClick={(e) => e.currentTarget === e.target && !isGenerating && onClose()}>
      <div className="w-full max-w-[500px] rounded-2xl border border-white/10 bg-[#091013] p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-wand-magic-sparkles text-[#4db6ac]" />
              Create Talking Avatar
            </h2>
            <p className="text-sm text-white/60 mt-1">
              Transform your voice message into an animated video
            </p>
          </div>
          <button 
            onClick={onClose} 
            disabled={isGenerating}
            className="shrink-0 w-9 h-9 rounded-full border border-white/15 text-white/70 hover:text-white hover:bg-white/10 transition disabled:opacity-50"
            aria-label="Close"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        {/* Audio Info */}
        <div className="mb-5 p-3 rounded-lg bg-[#4db6ac]/10 border border-[#4db6ac]/20">
          <div className="flex items-center gap-2 text-sm text-white/80">
            <i className="fa-solid fa-microphone text-[#4db6ac]" />
            <span>Voice message: {formatDuration(audioDuration)}</span>
          </div>
        </div>

        {/* Image Selection */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-white/90 mb-3">
            Choose Avatar Image:
          </label>

          {/* Image Preview */}
          {imagePreview ? (
            <div className="mb-4">
              <div className="relative w-32 h-32 mx-auto rounded-full overflow-hidden border-2 border-[#4db6ac]/50">
                <img 
                  src={imagePreview} 
                  alt="Avatar preview" 
                  className="w-full h-full object-cover"
                />
                {useProfilePic && (
                  <div className="absolute top-1 right-1 w-6 h-6 rounded-full bg-[#4db6ac] flex items-center justify-center">
                    <i className="fa-solid fa-check text-xs text-white" />
                  </div>
                )}
              </div>
              <p className="text-center text-xs text-white/60 mt-2">
                {useProfilePic ? `@${username}'s profile picture` : selectedImage?.name}
              </p>
            </div>
          ) : (
            <div className="mb-4 p-8 rounded-lg border-2 border-dashed border-white/20 bg-white/5 text-center">
              <i className="fa-solid fa-user text-4xl text-white/30 mb-2" />
              <p className="text-sm text-white/60">No profile picture set</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="space-y-2">
            {/* Upload Custom Image */}
            <label className="block">
              <input
                type="file"
                accept="image/jpeg,image/png,image/jpg"
                onChange={handleImageSelect}
                className="hidden"
                disabled={isGenerating}
              />
              <div className="w-full px-4 py-3 rounded-lg border border-white/20 hover:border-[#4db6ac]/60 hover:bg-[#4db6ac]/5 transition cursor-pointer text-center">
                <i className="fa-solid fa-upload mr-2 text-[#4db6ac]" />
                <span className="text-sm text-white/90">
                  {selectedImage ? 'Change Photo' : 'Upload Different Photo'}
                </span>
              </div>
            </label>

            {/* Use Profile Pic Option (if available and custom selected) */}
            {userProfilePic && selectedImage && (
              <button
                type="button"
                onClick={handleSwitchToProfilePic}
                disabled={isGenerating}
                className="w-full px-4 py-3 rounded-lg border border-white/20 hover:border-[#4db6ac]/60 hover:bg-[#4db6ac]/5 transition text-sm text-white/90 disabled:opacity-50"
              >
                <i className="fa-solid fa-user-circle mr-2 text-[#4db6ac]" />
                Use Profile Picture Instead
              </button>
            )}
          </div>
        </div>

        {/* Tip */}
        <div className="mb-5 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <div className="flex gap-2 text-xs text-blue-300">
            <i className="fa-solid fa-lightbulb shrink-0 mt-0.5" />
            <p>For best results, use a clear front-facing photo with the face visible</p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <div className="flex gap-2 text-xs text-red-300">
              <i className="fa-solid fa-exclamation-triangle shrink-0 mt-0.5" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Warning if no profile pic and no upload */}
        {!canGenerate && (
          <div className="mb-5 p-3 rounded-lg bg-orange-500/10 border border-orange-500/20">
            <div className="flex gap-2 text-xs text-orange-300">
              <i className="fa-solid fa-exclamation-triangle shrink-0 mt-0.5" />
              <p>Please upload a photo to continue</p>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isGenerating}
            className="flex-1 px-4 py-3 rounded-lg border border-white/20 text-white/90 hover:bg-white/5 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-[#4db6ac] to-[#26a69a] text-white font-medium hover:shadow-lg hover:shadow-[#4db6ac]/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isGenerating ? (
              <>
                <i className="fa-solid fa-spinner fa-spin mr-2" />
                Generating...
              </>
            ) : (
              <>
                <i className="fa-solid fa-wand-magic-sparkles mr-2" />
                Generate Video
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
