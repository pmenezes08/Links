/**
 * Signal Protocol Store
 * 
 * Implements the StorageType interface required by libsignal.
 * Uses localStorage for persistence with Capacitor Preferences (iOS Keychain)
 * backup to survive app updates and iOS storage cleanup.
 */

import type { 
  StorageType, 
  KeyPairType, 
  Direction,
  SessionRecordType 
} from '@privacyresearch/libsignal-protocol-typescript'
import { Preferences } from '@capacitor/preferences'
import { Capacitor } from '@capacitor/core'
import type { 
  StoredSession, 
  StoredIdentity, 
  StoredPreKey, 
  StoredSignedPreKey,
  DeviceRegistration 
} from './types'

// Storage key prefixes
const PREFIX = 'signal'
const KEYCHAIN_PREFIX = 'signal_registration_'
const KEYS = {
  IDENTITY_KEY: 'identityKey',
  REGISTRATION: 'registration',
  PREKEYS: 'preKeys',
  SIGNED_PREKEYS: 'signedPreKeys',
  SESSIONS: 'sessions',
  IDENTITIES: 'identities',
} as const

export class SignalStore implements StorageType {
  private currentUsername: string | null = null

  /**
   * Get storage key with prefix
   */
  private getKey(store: string, id?: string | number): string {
    const base = `${PREFIX}_${this.currentUsername}_${store}`
    return id !== undefined ? `${base}_${id}` : base
  }

  /**
   * Get all keys for a store
   */
  private getAllKeysForStore(store: string): string[] {
    const prefix = this.getKey(store) + '_'
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) {
        keys.push(key)
      }
    }
    return keys
  }

  /**
   * Initialize the store for a specific user
   */
  async init(username: string): Promise<void> {
    this.currentUsername = username
    
    // Debug: Count existing signal keys for this user
    const prefix = `${PREFIX}_${username}_`
    let count = 0
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) count++
    }
    
    console.log('🔐 SignalStore initialized for:', username, `(found ${count} existing keys in localStorage)`)
  }

  /**
   * Get item from storage
   */
  private get<T>(store: string, id: string | number): T | null {
    try {
      const key = this.getKey(store, id)
      const data = localStorage.getItem(key)
      return data ? JSON.parse(data) : null
    } catch (e) {
      console.error('SignalStore get error:', e)
      return null
    }
  }

  /**
   * Put item in storage
   */
  private put<T>(store: string, id: string | number, value: T): void {
    try {
      const key = this.getKey(store, id)
      localStorage.setItem(key, JSON.stringify(value))
    } catch (e) {
      console.error('SignalStore put error:', e)
    }
  }

  /**
   * Delete item from storage
   */
  private remove(store: string, id: string | number): void {
    try {
      const key = this.getKey(store, id)
      localStorage.removeItem(key)
    } catch (e) {
      console.error('SignalStore remove error:', e)
    }
  }

  // ============ Identity Key Pair ============

  /**
   * Get our identity key pair
   */
  async getIdentityKeyPair(): Promise<KeyPairType | undefined> {
    if (!this.currentUsername) return undefined

    const stored = this.get<{ publicKey: string; privateKey: string }>(
      KEYS.IDENTITY_KEY, 
      'pair'
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

    this.put(KEYS.IDENTITY_KEY, 'pair', {
      publicKey: this.arrayBufferToBase64(keyPair.pubKey),
      privateKey: this.arrayBufferToBase64(keyPair.privKey),
    })
  }

  /**
   * Get our local registration ID
   */
  async getLocalRegistrationId(): Promise<number | undefined> {
    if (!this.currentUsername) return undefined

    const reg = this.get<DeviceRegistration>(KEYS.REGISTRATION, 'data')
    return reg?.registrationId
  }

  /**
   * Get local device registration
   * Checks localStorage first, falls back to Keychain if localStorage is empty
   * (handles iOS clearing localStorage on app updates)
   */
  async getLocalRegistration(): Promise<DeviceRegistration | null> {
    if (!this.currentUsername) return null
    
    // First check localStorage
    const reg = this.get<DeviceRegistration>(KEYS.REGISTRATION, 'data')
    if (reg) {
      console.log('🔐 getLocalRegistration from localStorage:', `deviceId=${reg.deviceId}`)
      return reg
    }
    
    // If not in localStorage, try Keychain (iOS persists this across app updates)
    try {
      const keychainKey = `${KEYCHAIN_PREFIX}${this.currentUsername.toLowerCase()}`
      const result = await Preferences.get({ key: keychainKey })
      
      if (result.value) {
        const keychainReg: DeviceRegistration = JSON.parse(result.value)
        console.log('🔐 getLocalRegistration from Keychain (restoring):', `deviceId=${keychainReg.deviceId}`)
        
        // Restore to localStorage for faster access
        this.put(KEYS.REGISTRATION, 'data', keychainReg)
        
        // Also restore identity key pair
        if (keychainReg.identityKeyPair) {
          this.put(KEYS.IDENTITY_KEY, 'pair', keychainReg.identityKeyPair)
        }
        
        // Restore signed prekey
        if (keychainReg.signedPreKey) {
          this.put(KEYS.SIGNED_PREKEYS, keychainReg.signedPreKey.keyId, {
            keyId: keychainReg.signedPreKey.keyId,
            publicKey: keychainReg.signedPreKey.publicKey,
            privateKey: keychainReg.signedPreKey.privateKey,
            signature: keychainReg.signedPreKey.signature,
            timestamp: keychainReg.signedPreKey.timestamp,
          })
        }
        
        // Restore prekeys
        if (keychainReg.preKeys) {
          for (const pk of keychainReg.preKeys) {
            this.put(KEYS.PREKEYS, pk.keyId, {
              keyId: pk.keyId,
              publicKey: pk.publicKey,
              privateKey: pk.privateKey,
            })
          }
        }
        
        console.log('🔐 ✅ Signal registration restored from Keychain to localStorage')
        return keychainReg
      }
    } catch (error) {
      console.warn('🔐 Failed to check Keychain for registration:', error)
    }
    
    console.log('🔐 getLocalRegistration: null (not found in localStorage or Keychain)')
    return null
  }

  /**
   * Store local device registration
   * Saves to both localStorage (fast access) and Keychain (persistence)
   */
  async storeLocalRegistration(registration: DeviceRegistration): Promise<void> {
    if (!this.currentUsername) throw new Error('User not initialized')
    
    // Store in localStorage for fast access
    this.put(KEYS.REGISTRATION, 'data', registration)
    console.log('🔐 storeLocalRegistration to localStorage: deviceId=', registration.deviceId)
    
    // Also backup to Keychain (persists across iOS app updates)
    try {
      const keychainKey = `${KEYCHAIN_PREFIX}${this.currentUsername.toLowerCase()}`
      await Preferences.set({
        key: keychainKey,
        value: JSON.stringify(registration)
      })
      console.log(`🔐 ✅ Signal registration backed up to ${Capacitor.isNativePlatform() ? 'iOS Keychain' : 'Preferences'}`)
    } catch (error) {
      console.warn('🔐 Failed to backup registration to Keychain:', error)
      // Don't throw - localStorage save succeeded, Keychain is just a backup
    }
  }

  // ============ Identity Keys (Remote) ============

  /**
   * Check if we trust an identity key
   */
  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    _direction: Direction
  ): Promise<boolean> {
    const stored = this.get<StoredIdentity>(KEYS.IDENTITIES, identifier)
    if (!stored) return true // Trust on first use

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
    const existing = this.get<StoredIdentity>(KEYS.IDENTITIES, encodedAddress)
    const publicKeyBase64 = this.arrayBufferToBase64(publicKey)

    const isNewKey = !existing || existing.publicKey !== publicKeyBase64

    this.put<StoredIdentity>(KEYS.IDENTITIES, encodedAddress, {
      address: encodedAddress,
      publicKey: publicKeyBase64,
      trusted: true,
      addedAt: Date.now(),
    })

    return isNewKey
  }

  // ============ PreKeys ============

  async loadPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const stored = this.get<StoredPreKey>(KEYS.PREKEYS, keyId)
    if (!stored) return undefined

    return {
      pubKey: this.base64ToArrayBuffer(stored.publicKey),
      privKey: this.base64ToArrayBuffer(stored.privateKey),
    }
  }

  async storePreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    this.put<StoredPreKey>(KEYS.PREKEYS, keyId, {
      keyId: Number(keyId),
      publicKey: this.arrayBufferToBase64(keyPair.pubKey),
      privateKey: this.arrayBufferToBase64(keyPair.privKey),
    })
  }

  async removePreKey(keyId: number | string): Promise<void> {
    this.remove(KEYS.PREKEYS, keyId)
  }

  // ============ Signed PreKeys ============

  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType | undefined> {
    const stored = this.get<StoredSignedPreKey>(KEYS.SIGNED_PREKEYS, keyId)
    if (!stored) return undefined

    return {
      pubKey: this.base64ToArrayBuffer(stored.publicKey),
      privKey: this.base64ToArrayBuffer(stored.privateKey),
    }
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType): Promise<void> {
    this.put<StoredSignedPreKey>(KEYS.SIGNED_PREKEYS, keyId, {
      keyId: Number(keyId),
      publicKey: this.arrayBufferToBase64(keyPair.pubKey),
      privateKey: this.arrayBufferToBase64(keyPair.privKey),
      signature: '', // Will be set separately
      timestamp: Date.now(),
    })
  }

  async storeSignedPreKeyWithSignature(
    keyId: number,
    keyPair: KeyPairType,
    signature: ArrayBuffer
  ): Promise<void> {
    this.put<StoredSignedPreKey>(KEYS.SIGNED_PREKEYS, keyId, {
      keyId,
      publicKey: this.arrayBufferToBase64(keyPair.pubKey),
      privateKey: this.arrayBufferToBase64(keyPair.privKey),
      signature: this.arrayBufferToBase64(signature),
      timestamp: Date.now(),
    })
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    this.remove(KEYS.SIGNED_PREKEYS, keyId)
  }

  // ============ Sessions ============

  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    const stored = this.get<StoredSession>(KEYS.SESSIONS, encodedAddress)
    if (!stored) return undefined

    return stored.record as SessionRecordType
  }

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    this.put<StoredSession>(KEYS.SESSIONS, encodedAddress, {
      address: encodedAddress,
      record: record as any,
      updatedAt: Date.now(),
    })
  }

  async hasSession(encodedAddress: string): Promise<boolean> {
    const stored = this.get<StoredSession>(KEYS.SESSIONS, encodedAddress)
    return !!stored
  }

  async removeSession(encodedAddress: string): Promise<void> {
    this.remove(KEYS.SESSIONS, encodedAddress)
  }

  async removeAllSessions(identifier: string): Promise<void> {
    // Remove all sessions that start with this identifier
    const keys = this.getAllKeysForStore(KEYS.SESSIONS)
    for (const key of keys) {
      // Extract the address part after the prefix
      const parts = key.split('_')
      const address = parts[parts.length - 1]
      if (address.startsWith(identifier + '.')) {
        localStorage.removeItem(key)
      }
    }
  }

  // ============ Utilities ============

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
    const viewA = new Uint8Array(a)
    const viewB = new Uint8Array(b)
    for (let i = 0; i < viewA.length; i++) {
      if (viewA[i] !== viewB[i]) return false
    }
    return true
  }

  /**
   * Clear all signal data for current user (for debugging/reset)
   */
  async clearAllData(): Promise<void> {
    if (!this.currentUsername) return
    
    const prefix = `${PREFIX}_${this.currentUsername}_`
    const keysToRemove: string[] = []
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key)
      }
    }
    
    for (const key of keysToRemove) {
      localStorage.removeItem(key)
    }
    
    console.log(`🔐 Cleared ${keysToRemove.length} signal data items for ${this.currentUsername}`)
  }
}

export const signalStore = new SignalStore()
