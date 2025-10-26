/**
 * Simple E2E Encryption Service
 * 
 * Uses Web Crypto API for RSA encryption
 * Simpler than Signal Protocol but still provides strong E2E encryption
 */

const DB_NAME = 'chat-encryption'
const DB_VERSION = 1

interface KeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyExport: JsonWebKey
}

class SimpleEncryptionService {
  private db: IDBDatabase | null = null
  private currentUser: string | null = null
  private keyPair: KeyPair | null = null

  /**
   * Initialize encryption for a user
   */
  async init(username: string): Promise<void> {
    this.currentUser = username
    await this.openDatabase()
    
    // Check if user already has keys
    const existingKeys = await this.getStoredKeys()
    
    if (existingKeys) {
      this.keyPair = existingKeys
      console.log('🔐 Loaded existing encryption keys')
    } else {
      console.log('🔐 Generating new encryption keys...')
      await this.generateKeys()
    }
  }

  /**
   * Close database connection (needed before deletion)
   */
  closeDatabase(): void {
    if (this.db) {
      this.db.close()
      this.db = null
      console.log('🔐 Database connection closed')
    }
  }

  /**
   * Open IndexedDB
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
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys', { keyPath: 'username' })
        }
        if (!db.objectStoreNames.contains('publicKeys')) {
          db.createObjectStore('publicKeys', { keyPath: 'username' })
        }
      }
    })
  }

  /**
   * Generate RSA key pair
   */
  private async generateKeys(): Promise<void> {
    if (!this.currentUser) throw new Error('User not initialized')

    // Generate RSA-OAEP key pair
    const cryptoKeyPair = await window.crypto.subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true, // extractable
      ['encrypt', 'decrypt']
    )

    // Export public key for sharing
    const publicKeyExport = await window.crypto.subtle.exportKey('jwk', cryptoKeyPair.publicKey)

    this.keyPair = {
      publicKey: cryptoKeyPair.publicKey,
      privateKey: cryptoKeyPair.privateKey,
      publicKeyExport,
    }

    // Store keys
    await this.storeKeys(this.keyPair)

    // Upload public key to server
    await this.uploadPublicKey(publicKeyExport)

    console.log('🔐 Keys generated and uploaded')
  }

  /**
   * Store keys in IndexedDB
   */
  private async storeKeys(keyPair: KeyPair): Promise<void> {
    if (!this.db || !this.currentUser) throw new Error('Not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keys'], 'readwrite')
      const store = transaction.objectStore('keys')
      const request = store.put({
        username: this.currentUser,
        publicKey: keyPair.publicKeyExport,
        privateKey: keyPair.privateKey, // CryptoKey stored directly
      })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Get stored keys
   */
  private async getStoredKeys(): Promise<KeyPair | null> {
    if (!this.db || !this.currentUser) return null

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keys'], 'readonly')
      const store = transaction.objectStore('keys')
      const request = store.get(this.currentUser!)

      request.onsuccess = async () => {
        if (request.result) {
          try {
            const publicKey = await window.crypto.subtle.importKey(
              'jwk',
              request.result.publicKey,
              { name: 'RSA-OAEP', hash: 'SHA-256' },
              true,
              ['encrypt']
            )

            resolve({
              publicKey,
              privateKey: request.result.privateKey,
              publicKeyExport: request.result.publicKey,
            })
          } catch (error) {
            reject(error)
          }
        } else {
          resolve(null)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Upload public key to server
   */
  private async uploadPublicKey(publicKey: JsonWebKey): Promise<void> {
    const response = await fetch('/api/encryption/upload-public-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ publicKey }),
    })

    if (!response.ok) {
      throw new Error('Failed to upload public key')
    }
  }

  /**
   * Clear cached public key for a user (forces refresh from server)
   */
  async clearCachedPublicKey(username: string): Promise<void> {
    if (!this.db) return

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['publicKeys'], 'readwrite')
      const store = transaction.objectStore('publicKeys')
      store.delete(username)
      transaction.oncomplete = () => {
        console.log('🔐 Cleared cached public key for', username)
        resolve()
      }
      transaction.onerror = () => resolve()
    })
  }

  /**
   * Get public key for another user with timeout
   * ALWAYS fetches fresh from server to avoid stale cache issues
   */
  async getPublicKey(username: string, forceRefresh: boolean = false): Promise<CryptoKey> {
    // ALWAYS fetch fresh from server (no caching)
    // This prevents stale key issues when users reset encryption keys
    // Small performance cost but ensures 100% reliability
    console.log('🔐 Fetching fresh public key for', username, 'from server...')

    // Fetch from server with timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    try {
      const response = await fetch(`/api/encryption/get-public-key/${username}`, {
        method: 'GET',
        credentials: 'include',
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`User ${username} has no encryption keys yet`)
        }
        throw new Error(`Failed to get public key: ${response.status}`)
      }

      const data = await response.json()
      
      if (!data.success || !data.publicKey) {
        throw new Error('Invalid public key response from server')
      }

      const publicKey = await window.crypto.subtle.importKey(
        'jwk',
        data.publicKey,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
      )

      // Cache it
      await this.cachePublicKey(username, data.publicKey)
      console.log('🔐 ✅ Public key fetched and cached for', username)

      return publicKey
    } catch (error) {
      clearTimeout(timeoutId)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Timeout fetching public key for ${username}`)
      }
      throw error
    }
  }

  /**
   * Cache public key
   */
  private async cachePublicKey(username: string, publicKey: JsonWebKey): Promise<void> {
    if (!this.db) return

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['publicKeys'], 'readwrite')
      const store = transaction.objectStore('publicKeys')
      store.put({ username, publicKey })
      transaction.oncomplete = () => resolve()
    })
  }

  /**
   * Get cached public key
   */
  private async getCachedPublicKey(username: string): Promise<CryptoKey | null> {
    if (!this.db) return null

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['publicKeys'], 'readonly')
      const store = transaction.objectStore('publicKeys')
      const request = store.get(username)

      request.onsuccess = async () => {
        if (request.result) {
          try {
            const publicKey = await window.crypto.subtle.importKey(
              'jwk',
              request.result.publicKey,
              { name: 'RSA-OAEP', hash: 'SHA-256' },
              true,
              ['encrypt']
            )
            resolve(publicKey)
          } catch {
            resolve(null)
          }
        } else {
          resolve(null)
        }
      }
      request.onerror = () => resolve(null)
    })
  }

  /**
   * Encrypt a text message for recipient
   */
  async encryptMessage(recipientUsername: string, message: string): Promise<string> {
    console.log('🔐 Starting encryption for recipient:', recipientUsername)
    
    const publicKey = await this.getPublicKey(recipientUsername)
    
    console.log('🔐 🔍 ENCRYPTION DEBUG:', {
      sender: this.currentUser,
      recipient: recipientUsername,
      messageLength: message.length,
      hasPublicKey: !!publicKey
    })
    
    // Convert message to ArrayBuffer
    const messageBuffer = new TextEncoder().encode(message)
    
    // Encrypt with recipient's public key
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      messageBuffer
    )

    console.log('🔐 ✅ Message encrypted successfully for', recipientUsername, 'encrypted size:', encrypted.byteLength)
    
    // Convert to base64
    return this.arrayBufferToBase64(encrypted)
  }

  /**
   * Encrypt a text message for sender (yourself)
   * Uses your own public key so you can decrypt it later with your private key
   */
  async encryptMessageForSender(message: string): Promise<string> {
    if (!this.keyPair) throw new Error('Keys not loaded')
    
    console.log('🔐 Encrypting message for sender (yourself)...')
    
    // Convert message to ArrayBuffer
    const messageBuffer = new TextEncoder().encode(message)
    
    // Encrypt with YOUR OWN public key
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      this.keyPair.publicKey,
      messageBuffer
    )

    console.log('🔐 Message encrypted for sender!')
    
    // Convert to base64
    return this.arrayBufferToBase64(encrypted)
  }

  /**
   * Decrypt a text message
   */
  async decryptMessage(encryptedMessage: string): Promise<string> {
    if (!this.keyPair) throw new Error('Keys not loaded')

    // Convert from base64
    const encrypted = this.base64ToArrayBuffer(encryptedMessage)

    // Decrypt with private key
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' },
      this.keyPair.privateKey,
      encrypted
    )

    // Convert back to string
    const decoder = new TextDecoder()
    return decoder.decode(decrypted)
  }

  /**
   * Helper: ArrayBuffer to base64
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
   * Helper: base64 to ArrayBuffer
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

export const encryptionService = new SimpleEncryptionService()

// Expose helper function globally for debugging
;(window as any).clearCachedKey = async (username: string) => {
  await encryptionService.clearCachedPublicKey(username)
  console.log(`✅ Cleared cached public key for ${username}. Next message will fetch fresh key from server.`)
}

console.log('💡 TIP: If encryption fails, run: clearCachedKey("username")')

