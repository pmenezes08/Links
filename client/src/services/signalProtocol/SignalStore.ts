/**
 * Signal Protocol Store
 * 
 * Implements the StorageType interface required by libsignal.
 * Stores all cryptographic state in IndexedDB for persistence.
 */

import type { 
  StorageType, 
  KeyPairType, 
  Direction,
  SessionRecordType 
} from '@privacyresearch/libsignal-protocol-typescript'
import type { 
  StoredSession, 
  StoredIdentity, 
  StoredPreKey, 
  StoredSignedPreKey,
  DeviceRegistration 
} from './types'

const DB_NAME = 'signal-protocol-store'
const DB_VERSION = 1

// Store names
const STORES = {
  IDENTITY_KEY: 'identityKey',
  REGISTRATION: 'registration',
  PREKEYS: 'preKeys',
  SIGNED_PREKEYS: 'signedPreKeys',
  SESSIONS: 'sessions',
  IDENTITIES: 'identities',
} as const

export class SignalStore implements StorageType {
  private db: IDBDatabase | null = null
  private currentUsername: string | null = null

  /**
   * Initialize the store for a specific user
   */
  async init(username: string): Promise<void> {
    this.currentUsername = username
    await this.openDatabase()
    console.log('🔐 SignalStore initialized for:', username)
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

        // Identity key pair (one per user/device)
        if (!db.objectStoreNames.contains(STORES.IDENTITY_KEY)) {
          db.createObjectStore(STORES.IDENTITY_KEY, { keyPath: 'username' })
        }

        // Device registration info
        if (!db.objectStoreNames.contains(STORES.REGISTRATION)) {
          db.createObjectStore(STORES.REGISTRATION, { keyPath: 'username' })
        }

        // PreKeys
        if (!db.objectStoreNames.contains(STORES.PREKEYS)) {
          db.createObjectStore(STORES.PREKEYS, { keyPath: 'keyId' })
        }

        // Signed PreKeys
        if (!db.objectStoreNames.contains(STORES.SIGNED_PREKEYS)) {
          db.createObjectStore(STORES.SIGNED_PREKEYS, { keyPath: 'keyId' })
        }

        // Sessions with other users/devices
        if (!db.objectStoreNames.contains(STORES.SESSIONS)) {
          db.createObjectStore(STORES.SESSIONS, { keyPath: 'address' })
        }

        // Known identity keys of other users
        if (!db.objectStoreNames.contains(STORES.IDENTITIES)) {
          db.createObjectStore(STORES.IDENTITIES, { keyPath: 'address' })
        }
      }
    })
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  /**
   * Helper: Get item from store
   */
  private async get<T>(storeName: string, key: string | number): Promise<T | undefined> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readonly')
      const store = transaction.objectStore(storeName)
      const request = store.get(key)

      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Helper: Put item in store
   */
  private async put<T>(storeName: string, value: T): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.put(value)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * Helper: Delete item from store
   */
  private async delete(storeName: string, key: string | number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([storeName], 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.delete(key)

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  // ============================================
  // StorageType Interface Implementation
  // ============================================

  /**
   * Get our identity key pair
   */
  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    if (!this.currentUsername) return undefined

    const stored = await this.get<{ username: string; publicKey: string; privateKey: string }>(
      STORES.IDENTITY_KEY,
      this.currentUsername
    )

    if (!stored) return undefined

    return {
      pubKey: this.base64ToArrayBuffer(stored.publicKey),
      privKey: this.base64ToArrayBuffer(stored.privateKey),
    }
  }

  /**
   * Store our identity key pair
   */
  async storeIdentityKeyPair(keyPair: KeyPairType): Promise<void> {
    if (!this.currentUsername) throw new Error('User not initialized')

    await this.put(STORES.IDENTITY_KEY, {
      username: this.currentUsername,
      publicKey: this.arrayBufferToBase64(keyPair.pubKey),
      privateKey: this.arrayBufferToBase64(keyPair.privKey),
    })
  }

  /**
   * Get our local registration ID
   */
  async getLocalRegistrationId(): Promise<number | undefined> {
    if (!this.currentUsername) return undefined

    const reg = await this.get<DeviceRegistration>(STORES.REGISTRATION, this.currentUsername)
    return reg?.registrationId
  }

  /**
   * Store local registration
   */
  async storeLocalRegistration(registration: DeviceRegistration): Promise<void> {
    if (!this.currentUsername) throw new Error('User not initialized')

    await this.put(STORES.REGISTRATION, {
      username: this.currentUsername,
      ...registration,
    })
  }

  /**
   * Get local registration data
   */
  async getLocalRegistration(): Promise<DeviceRegistration | undefined> {
    if (!this.currentUsername) return undefined
    return this.get<DeviceRegistration>(STORES.REGISTRATION, this.currentUsername)
  }

  /**
   * Check if an identity key is trusted
   */
  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: Direction
  ): Promise<boolean> {
    // For simplicity, we trust on first use (TOFU)
    // In a production app, you might want to verify key changes
    const stored = await this.get<StoredIdentity>(STORES.IDENTITIES, identifier)
    
    if (!stored) {
      // First time seeing this identity - trust it
      return true
    }

    // Check if key matches what we have stored
    const storedKeyBuffer = this.base64ToArrayBuffer(stored.publicKey)
    return this.arrayBuffersEqual(storedKeyBuffer, identityKey)
  }

  /**
   * Save an identity key for a remote user
   */
  async saveIdentity(
    encodedAddress: string,
    publicKey: ArrayBuffer,
    _nonblockingApproval?: boolean
  ): Promise<boolean> {
    const existing = await this.get<StoredIdentity>(STORES.IDENTITIES, encodedAddress)
    const publicKeyBase64 = this.arrayBufferToBase64(publicKey)

    const isNewKey = !existing || existing.publicKey !== publicKeyBase64

    await this.put<StoredIdentity>(STORES.IDENTITIES, {
      address: encodedAddress,
      publicKey: publicKeyBase64,
      trusted: true,
      addedAt: Date.now(),
    })

    return isNewKey
  }

  /**
   * Load a prekey by ID
   */
  async loadPreKey(keyId: string | number): Promise<KeyPairType | undefined> {
    const stored = await this.get<StoredPreKey>(STORES.PREKEYS, Number(keyId))
    
    if (!stored) return undefined

    return {
      pubKey: this.base64ToArrayBuffer(stored.publicKey),
      privKey: this.base64ToArrayBuffer(stored.privateKey),
    }
  }

  /**
   * Store a prekey
   */
  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    await this.put<StoredPreKey>(STORES.PREKEYS, {
      keyId: Number(keyId),
      publicKey: this.arrayBufferToBase64(keyPair.pubKey),
      privateKey: this.arrayBufferToBase64(keyPair.privKey),
    })
  }

  /**
   * Remove a prekey (after it's been used)
   */
  async removePreKey(keyId: number | string): Promise<void> {
    await this.delete(STORES.PREKEYS, Number(keyId))
  }

  /**
   * Load a signed prekey
   */
  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const stored = await this.get<StoredSignedPreKey>(STORES.SIGNED_PREKEYS, Number(keyId))
    
    if (!stored) return undefined

    return {
      pubKey: this.base64ToArrayBuffer(stored.publicKey),
      privKey: this.base64ToArrayBuffer(stored.privateKey),
    }
  }

  /**
   * Store a signed prekey
   */
  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    await this.put<StoredSignedPreKey>(STORES.SIGNED_PREKEYS, {
      keyId: Number(keyId),
      publicKey: this.arrayBufferToBase64(keyPair.pubKey),
      privateKey: this.arrayBufferToBase64(keyPair.privKey),
      signature: '', // Will be set separately
      timestamp: Date.now(),
    })
  }

  /**
   * Store a signed prekey with signature
   */
  async storeSignedPreKeyWithSignature(
    keyId: number,
    keyPair: KeyPairType,
    signature: ArrayBuffer
  ): Promise<void> {
    await this.put<StoredSignedPreKey>(STORES.SIGNED_PREKEYS, {
      keyId,
      publicKey: this.arrayBufferToBase64(keyPair.pubKey),
      privateKey: this.arrayBufferToBase64(keyPair.privKey),
      signature: this.arrayBufferToBase64(signature),
      timestamp: Date.now(),
    })
  }

  /**
   * Remove a signed prekey
   */
  async removeSignedPreKey(keyId: number | string): Promise<void> {
    await this.delete(STORES.SIGNED_PREKEYS, Number(keyId))
  }

  /**
   * Load a session with a remote address
   */
  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    const stored = await this.get<StoredSession>(STORES.SESSIONS, encodedAddress)
    return stored?.record
  }

  /**
   * Store a session
   */
  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    await this.put<StoredSession>(STORES.SESSIONS, {
      address: encodedAddress,
      record,
      updatedAt: Date.now(),
    })
  }

  /**
   * Check if we have a session with a remote address
   */
  async hasSession(encodedAddress: string): Promise<boolean> {
    const session = await this.loadSession(encodedAddress)
    return session !== undefined
  }

  /**
   * Delete a session
   */
  async deleteSession(encodedAddress: string): Promise<void> {
    await this.delete(STORES.SESSIONS, encodedAddress)
  }

  /**
   * Delete all sessions for a user (all their devices)
   */
  async deleteAllSessionsForUser(username: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([STORES.SESSIONS], 'readwrite')
      const store = transaction.objectStore(STORES.SESSIONS)
      const request = store.openCursor()
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result
        if (cursor) {
          const session = cursor.value as StoredSession
          if (session.address.startsWith(username + '.')) {
            cursor.delete()
          }
          cursor.continue()
        }
      }

      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Convert ArrayBuffer to Base64
   */
  arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  /**
   * Convert Base64 to ArrayBuffer
   */
  base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }

  /**
   * Compare two ArrayBuffers for equality
   */
  private arrayBuffersEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
    if (a.byteLength !== b.byteLength) return false
    const aView = new Uint8Array(a)
    const bView = new Uint8Array(b)
    for (let i = 0; i < aView.length; i++) {
      if (aView[i] !== bView[i]) return false
    }
    return true
  }

  /**
   * Clear all data for current user
   */
  async clearAll(): Promise<void> {
    if (!this.db || !this.currentUsername) return

    const storeNames = Object.values(STORES)
    
    for (const storeName of storeNames) {
      await new Promise<void>((resolve, reject) => {
        const transaction = this.db!.transaction([storeName], 'readwrite')
        const store = transaction.objectStore(storeName)
        const request = store.clear()
        request.onsuccess = () => resolve()
        request.onerror = () => reject(request.error)
      })
    }

    console.log('🔐 SignalStore cleared for:', this.currentUsername)
  }
}

// Singleton instance
export const signalStore = new SignalStore()
