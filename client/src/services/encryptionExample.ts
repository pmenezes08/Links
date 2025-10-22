/**
 * E2E Encryption Usage Examples
 * 
 * This file demonstrates how to use the encryption service
 * for encrypting and decrypting messages, audio, and images.
 */

import { encryptionService } from './encryption'

// ========== INITIALIZATION ==========

/**
 * Initialize encryption for the current user
 * Call this once when the user logs in
 */
async function initializeEncryption(username: string) {
  try {
    await encryptionService.init(username)
    console.log('✅ Encryption initialized for', username)
  } catch (error) {
    console.error('❌ Failed to initialize encryption:', error)
  }
}

// ========== TEXT MESSAGES ==========

/**
 * Encrypt a text message before sending
 */
async function sendEncryptedMessage(recipientUsername: string, message: string) {
  try {
    // Encrypt the message
    const encrypted = await encryptionService.encryptMessage(recipientUsername, message)
    
    // Send to server with encryption metadata
    const response = await fetch('/send_message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        recipient_id: recipientUsername,
        is_encrypted: true,
        encryption_type: encrypted.type,
        encrypted_body: encrypted.body,
        message: '', // Empty plaintext message
      }),
    })
    
    return await response.json()
  } catch (error) {
    console.error('❌ Failed to send encrypted message:', error)
    throw error
  }
}

/**
 * Decrypt a received text message
 */
async function decryptReceivedMessage(senderUsername: string, encryptedMessage: { type: number; body: string }) {
  try {
    const decrypted = await encryptionService.decryptMessage(senderUsername, encryptedMessage)
    console.log('✅ Decrypted message:', decrypted)
    return decrypted
  } catch (error) {
    console.error('❌ Failed to decrypt message:', error)
    return '[Failed to decrypt message]'
  }
}

// ========== AUDIO MESSAGES ==========

/**
 * Encrypt an audio file before sending
 */
async function sendEncryptedAudio(recipientUsername: string, audioBlob: Blob, duration: number) {
  try {
    // Encrypt the audio file
    const encrypted = await encryptionService.encryptFile(recipientUsername, audioBlob)
    
    // Create FormData with encrypted audio
    const formData = new FormData()
    
    // Convert encrypted body back to Blob for upload
    const encryptedBlob = new Blob([encrypted.body], { type: 'application/octet-stream' })
    formData.append('audio', encryptedBlob, 'encrypted_voice.bin')
    formData.append('recipient_id', recipientUsername)
    formData.append('duration_seconds', String(duration))
    formData.append('is_encrypted', 'true')
    formData.append('encryption_type', String(encrypted.type))
    formData.append('original_mime_type', encrypted.mimeType)
    
    const response = await fetch('/send_audio_message', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    
    return await response.json()
  } catch (error) {
    console.error('❌ Failed to send encrypted audio:', error)
    throw error
  }
}

/**
 * Decrypt a received audio file
 */
async function decryptReceivedAudio(
  senderUsername: string,
  encryptedData: { type: number; body: string; mimeType: string }
): Promise<string> {
  try {
    // Decrypt the audio file
    const decryptedBlob = await encryptionService.decryptFile(senderUsername, encryptedData)
    
    // Create a blob URL for playback
    const blobUrl = URL.createObjectURL(decryptedBlob)
    
    console.log('✅ Decrypted audio file')
    return blobUrl
  } catch (error) {
    console.error('❌ Failed to decrypt audio:', error)
    throw error
  }
}

// ========== IMAGE MESSAGES ==========

/**
 * Encrypt an image before sending
 */
async function sendEncryptedImage(recipientUsername: string, imageFile: File, caption?: string) {
  try {
    // Encrypt the image
    const encrypted = await encryptionService.encryptFile(recipientUsername, imageFile)
    
    // Encrypt caption if provided
    let encryptedCaption = null
    if (caption) {
      encryptedCaption = await encryptionService.encryptMessage(recipientUsername, caption)
    }
    
    // Create FormData
    const formData = new FormData()
    const encryptedBlob = new Blob([encrypted.body], { type: 'application/octet-stream' })
    formData.append('photo', encryptedBlob, 'encrypted_image.bin')
    formData.append('recipient_id', recipientUsername)
    formData.append('is_encrypted', 'true')
    formData.append('encryption_type', String(encrypted.type))
    formData.append('original_mime_type', encrypted.mimeType)
    
    if (encryptedCaption) {
      formData.append('encrypted_caption_type', String(encryptedCaption.type))
      formData.append('encrypted_caption_body', encryptedCaption.body)
    }
    
    const response = await fetch('/send_photo_message', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    
    return await response.json()
  } catch (error) {
    console.error('❌ Failed to send encrypted image:', error)
    throw error
  }
}

/**
 * Decrypt a received image
 */
async function decryptReceivedImage(
  senderUsername: string,
  encryptedData: { type: number; body: string; mimeType: string }
): Promise<string> {
  try {
    // Decrypt the image file
    const decryptedBlob = await encryptionService.decryptFile(senderUsername, encryptedData)
    
    // Create a blob URL for display
    const blobUrl = URL.createObjectURL(decryptedBlob)
    
    console.log('✅ Decrypted image file')
    return blobUrl
  } catch (error) {
    console.error('❌ Failed to decrypt image:', error)
    throw error
  }
}

// ========== EXAMPLE USAGE IN CHAT ==========

/**
 * Example: Sending and receiving encrypted messages in ChatThread.tsx
 */
class ChatEncryptionExample {
  async sendMessage(recipientUsername: string, messageText: string) {
    try {
      // Encrypt the message
      const encrypted = await encryptionService.encryptMessage(recipientUsername, messageText)
      
      // Send to server
      const formData = new FormData()
      formData.append('recipient_id', recipientUsername)
      formData.append('message', '') // Empty plaintext
      formData.append('is_encrypted', '1')
      formData.append('encryption_type', String(encrypted.type))
      formData.append('encrypted_body', encrypted.body)
      
      const response = await fetch('/send_message', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      })
      
      return await response.json()
    } catch (error) {
      console.error('Failed to send encrypted message:', error)
      // Fallback to unencrypted if encryption fails
      throw error
    }
  }
  
  async loadMessages(otherUserId: string, otherUsername: string) {
    // Fetch messages from server
    const formData = new FormData()
    formData.append('other_user_id', otherUserId)
    
    const response = await fetch('/get_messages', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    })
    
    const data = await response.json()
    
    if (data.success) {
      // Decrypt encrypted messages
      const decryptedMessages = await Promise.all(
        data.messages.map(async (msg: any) => {
          if (msg.is_encrypted && msg.encrypted_body) {
            try {
              // Decrypt the message
              const sender = msg.sent ? 'me' : otherUsername
              const decrypted = await encryptionService.decryptMessage(
                sender === 'me' ? otherUsername : otherUsername,
                {
                  type: msg.encryption_type,
                  body: msg.encrypted_body,
                }
              )
              
              return {
                ...msg,
                text: decrypted,
                isDecrypted: true,
              }
            } catch (error) {
              console.error('Failed to decrypt message:', msg.id, error)
              return {
                ...msg,
                text: '[Failed to decrypt]',
                isDecrypted: false,
              }
            }
          }
          
          // Return unencrypted message as-is
          return msg
        })
      )
      
      return decryptedMessages
    }
    
    return []
  }
}

export {
  initializeEncryption,
  sendEncryptedMessage,
  decryptReceivedMessage,
  sendEncryptedAudio,
  decryptReceivedAudio,
  sendEncryptedImage,
  decryptReceivedImage,
  ChatEncryptionExample,
}
