/**
 * Simple E2E Encryption Service with Multi-Device Support
 * 
 * Uses Web Crypto API for RSA encryption.
 * 
 * MULTI-DEVICE ARCHITECTURE:
 * - ONE key pair per USER (not per device)
 * - First device generates keys and creates encrypted backup on server
 * - Subsequent devices restore from backup instead of generating new keys
 * - This ensures all devices can decrypt messages encrypted for this user
 * 
 * Keys are stored in iOS Keychain (via Capacitor Preferences) to persist
 * across app updates and reinstalls. IndexedDB is used as a secondary cache.
 */

import { keychainStorage } from './keychainStorage'

const DB_NAME = 'chat-encryption'
const DB_VERSION = 1

interface KeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
  publicKeyExport: JsonWebKey
}

// Custom error for when backup restore is needed
export class NeedBackupRestoreError extends Error {
  constructor() {
    super('Encryption keys exist on another device. Please enter your password to sync.')
    this.name = 'NeedBackupRestoreError'
  }
}

// Result type for init
export interface InitResult {
  success: boolean
  needsBackupRestore?: boolean
  isFirstDevice?: boolean
  error?: string
}

class SimpleEncryptionService {
  private db: IDBDatabase | null = null
  private currentUser: string | null = null
  private keyPair: KeyPair | null = null

  /**
   * Initialize encryption for a user with multi-device support.
   * 
   * Flow:
   * 1. Check LOCAL storage (Keychain/IndexedDB) for keys
   * 2. If found locally, use them (same device, already synced)
   * 3. If NOT found locally, check SERVER for existing keys
   * 4. If server has keys, need to restore from backup (another device exists)
   * 5. If server has NO keys, generate new keys (first device)
   */
  async init(username: string): Promise<InitResult> {
    this.currentUser = username
    await this.openDatabase()
    
    console.log('🔐 Initializing encryption for', username)
    
    // 1. First, try to load keys from iOS Keychain (persists across updates)
    const keychainKeys = await this.loadKeysFromKeychain()
    
    if (keychainKeys) {
      console.log('🔐 ✅ Loaded keys from iOS Keychain')
      this.keyPair = keychainKeys
      // Also store in IndexedDB as cache for faster access
      await this.storeKeys(keychainKeys)
      return { success: true, isFirstDevice: false }
    }
    
    // 2. If not in Keychain, try IndexedDB (migration from old version)
    const existingKeys = await this.getStoredKeys()
    
    if (existingKeys) {
      console.log('🔐 📦 Found keys in IndexedDB - migrating to Keychain')
      this.keyPair = existingKeys
      // Backup to Keychain for future app updates
      await this.backupKeysToKeychain(existingKeys)
      return { success: true, isFirstDevice: false }
    }
    
    // 3. No keys found locally - check if server has keys (another device)
    console.log('🔐 No local keys found, checking server...')
    const serverStatus = await this.checkServerKeyStatus()
    
    if (serverStatus.hasKeys) {
      // Server has keys from another device
      if (serverStatus.hasBackup) {
        // Backup exists - need password to restore
        console.log('🔐 ⚠️ Keys exist on server from another device. Need backup restore.')
        return { success: false, needsBackupRestore: true }
      } else {
        // Keys exist but no backup - this is a problem
        // For now, generate new keys (will overwrite with force)
        console.log('🔐 ⚠️ Keys exist but no backup. Will generate new keys.')
        await this.generateKeys(true) // force overwrite
        return { success: true, isFirstDevice: true }
      }
    }
    
    // 4. No keys on server - this is the first device
    console.log('🔐 🔑 First device - generating new encryption keys')
    await this.generateKeys(false)
    return { success: true, isFirstDevice: true }
  }

  /**
   * Restore keys from server backup using password.
   * Called when init() returns needsBackupRestore: true
   */
  async restoreFromBackup(password: string): Promise<boolean> {
    if (!this.currentUser) throw new Error('User not initialized')
    
    console.log('🔐 Attempting to restore keys from backup...')
    
    try {
      // Fetch encrypted backup from server
      const response = await fetch('/api/encryption/restore', {
        method: 'GET',
        credentials: 'include',
      })
      
      if (!response.ok) {
        if (response.status === 404) {
          console.error('🔐 No backup found on server')
          return false
        }
        throw new Error(`Failed to fetch backup: ${response.status}`)
      }
      
      const data = await response.json()
      if (!data.success || !data.encryptedBackup || !data.salt) {
        throw new Error('Invalid backup data from server')
      }
      
      // Decrypt the backup using password
      const decryptedKeys = await this.decryptBackup(data.encryptedBackup, data.salt, password)
      
      if (!decryptedKeys) {
        console.error('🔐 Failed to decrypt backup - wrong password?')
        return false
      }
      
      // Import the keys
      const publicKey = await window.crypto.subtle.importKey(
        'jwk',
        decryptedKeys.publicKey,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['encrypt']
      )
      
      const privateKey = await window.crypto.subtle.importKey(
        'jwk',
        decryptedKeys.privateKey,
        { name: 'RSA-OAEP', hash: 'SHA-256' },
        true,
        ['decrypt']
      )
      
      this.keyPair = {
        publicKey,
        privateKey,
        publicKeyExport: decryptedKeys.publicKey
      }
      
      // Store in local storage
      await this.storeKeys(this.keyPair)
      await this.backupKeysToKeychain(this.keyPair)
      
      // Clear the sync needed flag since we've synced
      localStorage.removeItem('encryption_needs_sync')
      
      console.log('🔐 ✅ Successfully restored keys from backup!')
      return true
      
    } catch (error) {
      console.error('🔐 ❌ Failed to restore from backup:', error)
      return false
    }
  }

  /**
   * Create encrypted backup of keys on server.
   * Called after generating new keys on first device.
   */
  async createServerBackup(password: string): Promise<boolean> {
    if (!this.currentUser || !this.keyPair) {
      throw new Error('Keys not initialized')
    }
    
    console.log('🔐 Creating encrypted backup on server...')
    
    try {
      // Export private key
      const privateKeyJwk = await window.crypto.subtle.exportKey('jwk', this.keyPair.privateKey)
      
      // Create backup payload
      const backupData = {
        publicKey: this.keyPair.publicKeyExport,
        privateKey: privateKeyJwk,
        timestamp: Date.now()
      }
      
      // Encrypt with password
      const { encrypted, salt } = await this.encryptBackup(backupData, password)
      
      // Upload to server
      const response = await fetch('/api/encryption/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          encryptedBackup: encrypted,
          salt: salt
        })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to upload backup: ${response.status}`)
      }
      
      console.log('🔐 ✅ Server backup created successfully')
      return true
      
    } catch (error) {
      console.error('🔐 ❌ Failed to create server backup:', error)
      return false
    }
  }

  /**
   * Check if server has existing keys for this user
   */
  private async checkServerKeyStatus(): Promise<{ hasKeys: boolean; hasBackup: boolean }> {
    try {
      const response = await fetch('/api/encryption/has-keys', {
        method: 'GET',
        credentials: 'include',
      })
      
      if (!response.ok) {
        console.warn('🔐 Failed to check server key status')
        return { hasKeys: false, hasBackup: false }
      }
      
      const data = await response.json()
      return {
        hasKeys: data.hasKeys || false,
        hasBackup: data.hasBackup || false
      }
    } catch (error) {
      console.error('🔐 Error checking server key status:', error)
      return { hasKeys: false, hasBackup: false }
    }
  }

  /**
   * Encrypt backup data with password using PBKDF2 + AES-GCM
   */
  private async encryptBackup(data: object, password: string): Promise<{ encrypted: string; salt: string }> {
    // Generate random salt
    const salt = window.crypto.getRandomValues(new Uint8Array(16))
    
    // Derive key from password
    const keyMaterial = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    )
    
    const aesKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    )
    
    // Generate IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12))
    
    // Encrypt
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      aesKey,
      new TextEncoder().encode(JSON.stringify(data))
    )
    
    // Combine IV + encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)
    
    return {
      encrypted: this.arrayBufferToBase64(combined.buffer),
      salt: this.arrayBufferToBase64(salt.buffer)
    }
  }

  /**
   * Decrypt backup data with password
   */
  private async decryptBackup(encryptedBase64: string, saltBase64: string, password: string): Promise<{ publicKey: JsonWebKey; privateKey: JsonWebKey } | null> {
    try {
      const salt = new Uint8Array(this.base64ToArrayBuffer(saltBase64))
      const combined = new Uint8Array(this.base64ToArrayBuffer(encryptedBase64))
      
      // Extract IV and encrypted data
      const iv = combined.slice(0, 12)
      const encrypted = combined.slice(12)
      
      // Derive key from password
      const keyMaterial = await window.crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(password),
        'PBKDF2',
        false,
        ['deriveKey']
      )
      
      const aesKey = await window.crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      )
      
      // Decrypt
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        aesKey,
        encrypted
      )
      
      const data = JSON.parse(new TextDecoder().decode(decrypted))
      return {
        publicKey: data.publicKey,
        privateKey: data.privateKey
      }
      
    } catch (error) {
      console.error('🔐 Decryption failed:', error)
      return null
    }
  }

  /**
   * Check if keys are loaded
   */
  hasKeys(): boolean {
    return this.keyPair !== null
  }

  /**
   * Get current user's public key (for display)
   */
  getPublicKeyExport(): JsonWebKey | null {
    return this.keyPair?.publicKeyExport || null
  }

  /**
   * Close database connection (needed before deletion)
   */
  closeDatabase(): void {
    if (this.db) {
      this.db.close()
      this.db = null
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
   * @param force - If true, will overwrite existing keys on server
   */
  private async generateKeys(force: boolean = false): Promise<void> {
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

    // Store keys in BOTH Keychain (primary) and IndexedDB (cache)
    await this.storeKeys(this.keyPair)
    await this.backupKeysToKeychain(this.keyPair)

    // Upload public key to server
    await this.uploadPublicKey(publicKeyExport, force)
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
   * @param publicKey - The JWK public key to upload
   * @param force - If true, will overwrite existing keys (used after explicit regeneration)
   */
  private async uploadPublicKey(publicKey: JsonWebKey, force: boolean = false): Promise<void> {
    const response = await fetch('/api/encryption/upload-public-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ publicKey, force }),
    })

    if (response.status === 409) {
      // Keys already exist - this shouldn't happen if init() is used correctly
      const data = await response.json()
      console.warn('🔐 Server rejected key upload - keys already exist:', data)
      throw new Error('Keys already exist on server. Use backup restore instead.')
    }

    if (!response.ok) {
      throw new Error('Failed to upload public key')
    }
    
    const data = await response.json()
    console.log('🔐 Public key uploaded successfully. First device:', data.isFirstDevice)
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
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
    })
  }

  /**
   * Get public key for another user with timeout
   * ALWAYS fetches fresh from server to avoid stale cache issues
   */
  async getPublicKey(username: string, forceRefresh: boolean = false): Promise<CryptoKey> {
    // Respect optional forceRefresh by clearing cache first
    if (forceRefresh) {
      try { await this.clearCachedPublicKey(username) } catch {}
    }

    // ALWAYS fetch fresh from server (no caching) for correctness
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

      return publicKey
    } catch (error) {
      clearTimeout(timeoutId)
      // Fallback to cached key if network fails
      try {
        console.warn('🔐 Fetch failed, attempting cached public key for', username)
        const cached = await this.getCachedPublicKey(username)
        if (cached) return cached
      } catch {}

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
    const publicKey = await this.getPublicKey(recipientUsername)
    
    // Convert message to ArrayBuffer
    const messageBuffer = new TextEncoder().encode(message)
    
    // Encrypt with recipient's public key
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      publicKey,
      messageBuffer
    )

    // Convert to base64
    return this.arrayBufferToBase64(encrypted)
  }

  /**
   * Encrypt a text message for sender (yourself)
   * Uses your own public key so you can decrypt it later with your private key
   */
  async encryptMessageForSender(message: string): Promise<string> {
    if (!this.keyPair) throw new Error('Keys not loaded')
    
    // Convert message to ArrayBuffer
    const messageBuffer = new TextEncoder().encode(message)
    
    // Encrypt with YOUR OWN public key
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      this.keyPair.publicKey,
      messageBuffer
    )

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

  /**
   * Backup keys to iOS Keychain for persistence across app updates
   */
  private async backupKeysToKeychain(keyPair: KeyPair): Promise<void> {
    if (!this.currentUser) return

    try {
      // Export private key to JWK (serializable format)
      const privateKeyJwk = await keychainStorage.exportPrivateKey(keyPair.privateKey)
      
      // Store serialized keys in Keychain
      await keychainStorage.storeKeys(this.currentUser, {
        publicKey: keyPair.publicKeyExport,
        privateKey: privateKeyJwk,
        timestamp: Date.now()
      })
      
      console.log('🔐 ✅ Keys backed up to iOS Keychain')
    } catch (error) {
      console.error('🔐 ❌ Failed to backup keys to Keychain:', error)
      // Don't throw - this is a backup operation, main storage (IndexedDB) still works
    }
  }

  /**
   * Load keys from iOS Keychain
   */
  private async loadKeysFromKeychain(): Promise<KeyPair | null> {
    if (!this.currentUser) return null

    try {
      const serializedKeys = await keychainStorage.getKeys(this.currentUser)
      
      if (!serializedKeys) {
        return null
      }

      // Import keys from JWK format
      const publicKey = await keychainStorage.importPublicKey(serializedKeys.publicKey)
      const privateKey = await keychainStorage.importPrivateKey(serializedKeys.privateKey)

      return {
        publicKey,
        privateKey,
        publicKeyExport: serializedKeys.publicKey
      }
    } catch (error) {
      console.error('🔐 ❌ Failed to load keys from Keychain:', error)
      return null
    }
  }

  /**
   * Reset encryption: delete all keys locally and on server.
   * Use with caution - this will make old encrypted messages unreadable!
   */
  async resetEncryption(): Promise<boolean> {
    if (!this.currentUser) return false

    console.log('🔐 ⚠️ Resetting encryption...')

    try {
      // Delete from server
      const response = await fetch('/api/encryption/delete-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm: true })
      })

      if (!response.ok && response.status !== 404) {
        console.error('🔐 Failed to delete keys from server')
      }

      // Delete from local storage
      await keychainStorage.removeKeys(this.currentUser)
      
      if (this.db) {
        const transaction = this.db.transaction(['keys'], 'readwrite')
        const store = transaction.objectStore('keys')
        store.delete(this.currentUser)
      }

      // Clear in-memory keys
      this.keyPair = null

      console.log('🔐 ✅ Encryption reset complete')
      return true

    } catch (error) {
      console.error('🔐 ❌ Failed to reset encryption:', error)
      return false
    }
  }

  /**
   * Regenerate keys: create new keys and backup.
   * Old encrypted messages will become unreadable!
   */
  async regenerateKeys(password: string): Promise<boolean> {
    if (!this.currentUser) return false

    console.log('🔐 ⚠️ Regenerating encryption keys...')

    try {
      // First reset
      await this.resetEncryption()

      // Generate new keys (force = true to overwrite on server)
      await this.generateKeys(true)

      // Create new backup
      await this.createServerBackup(password)

      console.log('🔐 ✅ Keys regenerated successfully')
      return true

    } catch (error) {
      console.error('🔐 ❌ Failed to regenerate keys:', error)
      return false
    }
  }
}

export const encryptionService = new SimpleEncryptionService()

// Expose helper function globally for debugging
;(window as any).clearCachedKey = async (username: string) => {
  await encryptionService.clearCachedPublicKey(username)
}

