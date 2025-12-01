export interface ChatMessage {
  id: number | string
  text: string
  image_path?: string
  video_path?: string
  audio_path?: string
  audio_duration_seconds?: number
  sent: boolean
  time: string
  reaction?: string
  replySnippet?: string
  isOptimistic?: boolean
  edited_at?: string | null
  clientKey?: string | number
  is_encrypted?: boolean
  encrypted_body?: string
  encrypted_body_for_sender?: string
  decryption_error?: boolean
}
