export interface ChatMessage {
  id: number | string
  text: string
  image_path?: string
  video_path?: string
  media_paths?: string[]
  /** Intrinsic [width, height] per media item (parallel to media_paths / single image), for height reservation. */
  media_dims?: Array<[number, number] | null>
  file_path?: string
  file_name?: string
  audio_path?: string
  audio_duration_seconds?: number
  audio_summary?: string | null
  sent: boolean
  time: string
  reaction?: string
  replySnippet?: string
  storyReply?: {
    id: string
    mediaType: string
    mediaPath: string
  }
  isOptimistic?: boolean
  sendFailed?: boolean
  _originalMessage?: string
  edited_at?: string | null
  clientKey?: string | number
  is_encrypted?: boolean
  encrypted_body?: string
  encrypted_body_for_sender?: string
  decryption_error?: boolean
  signal_protocol?: boolean
}
