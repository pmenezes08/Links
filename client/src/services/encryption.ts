/**
 * E2E Encryption Service using Signal Protocol
 * 
 * This service handles:
 * - Identity key generation and management
 * - Pre-key generation
 * - Session establishment
 * - Message encryption/decryption
 * - Key backup/recovery
 */

import {
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
  KeyHelper,
  SignedPublicPreKeyType,
  PreKeyType,
} from '@privacyresearch/libsignal-protocol-typescript'

// IndexedDB storage for local keys
const DB_NAME = 'signal-encryption'
const DB_VERSION = 1

interface IdentityKeyPair {
  pubKey: ArrayBuffer
  privKey: ArrayBuffer
}

interface PreKeyBundle {
  identityKey: ArrayBuffer
  signedPreKey: SignedPublicPreKeyType
  preKey: PreKeyType
  registrationId: number
}

interface StoredKeys {
  identityKeyPair: IdentityKeyPair
  registrationId: number
  preKeys: PreKeyType[]
  signedPreKey: SignedPublicPreKeyType
}

class EncryptionService {
  private db: IDBDatabase | null = null
  private currentUser: string | null = null
  private store: SignalProtocolStore | null = null

  /**
   * Initialize the encryption service for a user
   */
  async init(username: string): Promise<void> {
    this.currentUser = username
    await this.openDatabase()
    
    // Check if user already has keys
    const hasKeys = await this.hasStoredKeys()
    
    if (!hasKeys) {
      console.log('🔐 Generating new encryption keys for user:', username)
      await this.generateAndStoreKeys()
    } else {
      console.log('🔐 Loaded existing encryption keys for user:', username)
    }
    
    // Initialize Signal Protocol Store
    this.store = new SignalProtocolStore(username)
    await this.store.init()
  }

  /**
   * Open IndexedDB database
   */
  private async openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result

        // Store for user's own keys
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys', { keyPath: 'username' })
        }

        // Store for sessions with other users
        if (!db.objectStoreNames.contains('sessions')) {
          db.createObjectStore('sessions', { keyPath: 'address' })
        }

        // Store for received pre-keys from other users
        if (!db.objectStoreNames.contains('preKeyBundles')) {
          db.createObjectStore('preKeyBundles', { keyPath: 'username' })
        }
      }
    })
  }

  /**
   * Check if user has stored keys
   */
  private async hasStoredKeys(): Promise<boolean> {
    if (!this.db || !this.currentUser) return false

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keys'], 'readonly')
      const store = transaction.objectStore('keys')
      const request = store.get(this.currentUser!)

      request.onsuccess = () => resolve(!!request.result)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Generate identity keys, pre-keys, and signed pre-key
   */
  private async generateAndStoreKeys(): Promise<void> {
    if (!this.currentUser) throw new Error('User not initialized')

    // Generate identity key pair
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair()

    // Generate registration ID
    const registrationId = KeyHelper.generateRegistrationId()

    // Generate pre-keys (100 keys)
    const preKeys: PreKeyType[] = []
    for (let i = 0; i < 100; i++) {
      const preKey = await KeyHelper.generatePreKey(registrationId + i)
      preKeys.push(preKey)
    }

    // Generate signed pre-key
    const signedPreKey = await KeyHelper.generateSignedPreKey(
      identityKeyPair,
      registrationId
    )

    const keys: StoredKeys = {
      identityKeyPair,
      registrationId,
      preKeys,
      signedPreKey,
    }

    // Store keys in IndexedDB
    await this.storeKeys(keys)

    // Upload public key bundle to server
    await this.uploadPublicKeyBundle(keys)

    console.log('🔐 Keys generated and stored successfully')
  }

  /**
   * Store keys in IndexedDB
   */
  private async storeKeys(keys: StoredKeys): Promise<void> {
    if (!this.db || !this.currentUser) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keys'], 'readwrite')
      const store = transaction.objectStore('keys')
      const request = store.put({
        username: this.currentUser,
        ...keys,
      })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get stored keys for current user
   */
  private async getStoredKeys(): Promise<StoredKeys | null> {
    if (!this.db || !this.currentUser) return null

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keys'], 'readonly')
      const store = transaction.objectStore('keys')
      const request = store.get(this.currentUser!)

      request.onsuccess = () => {
        if (request.result) {
          const { username, ...keys } = request.result
          resolve(keys as StoredKeys)
        } else {
          resolve(null)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Upload public key bundle to server
   */
  private async uploadPublicKeyBundle(keys: StoredKeys): Promise<void> {
    // Convert ArrayBuffers to base64 for transmission
    const bundle = {
      identityKey: this.arrayBufferToBase64(keys.identityKeyPair.pubKey),
      signedPreKey: {
        keyId: keys.signedPreKey.keyId,
        publicKey: this.arrayBufferToBase64(keys.signedPreKey.keyPair.pubKey),
        signature: this.arrayBufferToBase64(keys.signedPreKey.signature),
      },
      preKeys: keys.preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: this.arrayBufferToBase64(pk.keyPair.pubKey),
      })),
      registrationId: keys.registrationId,
    }

    const response = await fetch('/api/encryption/upload-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(bundle),
    })

    if (!response.ok) {
      throw new Error('Failed to upload public key bundle')
    }

    console.log('🔐 Public key bundle uploaded to server')
  }

  /**
   * Get public key bundle for another user from server
   */
  async getPublicKeyBundle(username: string): Promise<PreKeyBundle> {
    const response = await fetch(`/api/encryption/get-keys/${username}`, {
      method: 'GET',
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Failed to get public key bundle for ${username}`)
    }

    const data = await response.json()

    // Convert base64 back to ArrayBuffers
    return {
      identityKey: this.base64ToArrayBuffer(data.identityKey),
      signedPreKey: {
        keyId: data.signedPreKey.keyId,
        keyPair: {
          pubKey: this.base64ToArrayBuffer(data.signedPreKey.publicKey),
          privKey: new ArrayBuffer(0), // We don't have their private key
        },
        signature: this.base64ToArrayBuffer(data.signedPreKey.signature),
      },
      preKey: {
        keyId: data.preKey.keyId,
        keyPair: {
          pubKey: this.base64ToArrayBuffer(data.preKey.publicKey),
          privKey: new ArrayBuffer(0), // We don't have their private key
        },
      },
      registrationId: data.registrationId,
    }
  }

  /**
   * Establish or load session with another user
   */
  private async ensureSession(recipientUsername: string): Promise<void> {
    if (!this.store || !this.currentUser) {
      throw new Error('Encryption service not initialized')
    }

    const address = new SignalProtocolAddress(recipientUsername, 1)
    const sessionCipher = new SessionCipher(this.store, address)

    // Check if we already have a session
    const existingSession = await this.store.loadSession(address.toString())
    
    if (existingSession) {
      console.log('🔐 Using existing session with', recipientUsername)
      return
    }

    console.log('🔐 Creating new session with', recipientUsername)

    // Get recipient's public key bundle
    const bundle = await this.getPublicKeyBundle(recipientUsername)

    // Build session
    const sessionBuilder = new SessionBuilder(this.store, address)
    
    await sessionBuilder.processPreKey({
      registrationId: bundle.registrationId,
      identityKey: bundle.identityKey,
      signedPreKey: {
        keyId: bundle.signedPreKey.keyId,
        publicKey: bundle.signedPreKey.keyPair.pubKey,
        signature: bundle.signedPreKey.signature,
      },
      preKey: {
        keyId: bundle.preKey.keyId,
        publicKey: bundle.preKey.keyPair.pubKey,
      },
    })

    console.log('🔐 Session established with', recipientUsername)
  }

  /**
   * Encrypt a text message
   */
  async encryptMessage(recipientUsername: string, message: string): Promise<{ type: number; body: string }> {
    if (!this.store || !this.currentUser) {
      throw new Error('Encryption service not initialized')
    }

    // Ensure we have a session
    await this.ensureSession(recipientUsername)

    const address = new SignalProtocolAddress(recipientUsername, 1)
    const sessionCipher = new SessionCipher(this.store, address)

    // Convert message to ArrayBuffer
    const messageBuffer = new TextEncoder().encode(message)

    // Encrypt the message
    const ciphertext = await sessionCipher.encrypt(messageBuffer.buffer)

    console.log('🔐 Message encrypted for', recipientUsername, 'type:', ciphertext.type)

    // Return encrypted message with type
    return {
      type: ciphertext.type,
      body: this.arrayBufferToBase64(ciphertext.body),
    }
  }

  /**
   * Decrypt a text message
   */
  async decryptMessage(
    senderUsername: string,
    encryptedMessage: { type: number; body: string }
  ): Promise<string> {
    if (!this.store || !this.currentUser) {
      throw new Error('Encryption service not initialized')
    }

    const address = new SignalProtocolAddress(senderUsername, 1)
    const sessionCipher = new SessionCipher(this.store, address)

    // Convert base64 body to ArrayBuffer
    const ciphertext = {
      type: encryptedMessage.type,
      body: this.base64ToArrayBuffer(encryptedMessage.body),
    }

    let plaintext: ArrayBuffer

    // Decrypt based on message type
    if (ciphertext.type === MessageType.PreKey) {
      // This is a session-establishing message
      console.log('🔐 Decrypting PreKey message from', senderUsername)
      plaintext = await sessionCipher.decryptPreKeyWhisperMessage(ciphertext.body, 'binary')
    } else {
      // This is a regular message in an existing session
      console.log('🔐 Decrypting regular message from', senderUsername)
      plaintext = await sessionCipher.decryptWhisperMessage(ciphertext.body, 'binary')
    }

    // Convert ArrayBuffer back to string
    const decoder = new TextDecoder()
    return decoder.decode(plaintext)
  }

  /**
   * Encrypt binary data (for audio/images)
   */
  async encryptBinaryData(
    recipientUsername: string,
    data: ArrayBuffer
  ): Promise<{ type: number; body: string }> {
    if (!this.store || !this.currentUser) {
      throw new Error('Encryption service not initialized')
    }

    // Ensure we have a session
    await this.ensureSession(recipientUsername)

    const address = new SignalProtocolAddress(recipientUsername, 1)
    const sessionCipher = new SessionCipher(this.store, address)

    // Encrypt the binary data
    const ciphertext = await sessionCipher.encrypt(data)

    console.log('🔐 Binary data encrypted for', recipientUsername, 'size:', data.byteLength)

    return {
      type: ciphertext.type,
      body: this.arrayBufferToBase64(ciphertext.body),
    }
  }

  /**
   * Decrypt binary data (for audio/images)
   */
  async decryptBinaryData(
    senderUsername: string,
    encryptedData: { type: number; body: string }
  ): Promise<ArrayBuffer> {
    if (!this.store || !this.currentUser) {
      throw new Error('Encryption service not initialized')
    }

    const address = new SignalProtocolAddress(senderUsername, 1)
    const sessionCipher = new SessionCipher(this.store, address)

    // Convert base64 body to ArrayBuffer
    const ciphertext = {
      type: encryptedData.type,
      body: this.base64ToArrayBuffer(encryptedData.body),
    }

    let plaintext: ArrayBuffer

    // Decrypt based on message type
    if (ciphertext.type === MessageType.PreKey) {
      plaintext = await sessionCipher.decryptPreKeyWhisperMessage(ciphertext.body, 'binary')
    } else {
      plaintext = await sessionCipher.decryptWhisperMessage(ciphertext.body, 'binary')
    }

    console.log('🔐 Binary data decrypted from', senderUsername, 'size:', plaintext.byteLength)

    return plaintext
  }

  /**
   * Encrypt a file (Blob) for sending
   */
  async encryptFile(recipientUsername: string, file: Blob): Promise<{ type: number; body: string; mimeType: string }> {
    // Convert Blob to ArrayBuffer
    const arrayBuffer = await file.arrayBuffer()
    
    // Encrypt the data
    const encrypted = await this.encryptBinaryData(recipientUsername, arrayBuffer)
    
    return {
      ...encrypted,
      mimeType: file.type,
    }
  }

  /**
   * Decrypt a file and return as Blob
   */
  async decryptFile(
    senderUsername: string,
    encryptedData: { type: number; body: string; mimeType: string }
  ): Promise<Blob> {
    // Decrypt the data
    const arrayBuffer = await this.decryptBinaryData(senderUsername, {
      type: encryptedData.type,
      body: encryptedData.body,
    })
    
    // Convert back to Blob
    return new Blob([arrayBuffer], { type: encryptedData.mimeType })
  }

  /**
   * Backup keys to server (encrypted with user's password)
   */
  async backupKeys(password: string): Promise<void> {
    const keys = await this.getStoredKeys()
    if (!keys) throw new Error('No keys to backup')

    // TODO: Encrypt keys with password-derived key
    // For now, we'll implement basic backup
    console.log('🔐 Key backup feature - to be implemented')
  }

  /**
   * Restore keys from server backup
   */
  async restoreKeys(password: string): Promise<void> {
    // TODO: Decrypt and restore keys from backup
    console.log('🔐 Key restore feature - to be implemented')
  }

  /**
   * Helper: Convert ArrayBuffer to base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * Helper: Convert base64 to ArrayBuffer
   */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }
}

// Export singleton instance
export const encryptionService = new EncryptionService()
