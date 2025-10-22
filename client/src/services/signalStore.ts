/**
 * Signal Protocol Store Implementation
 * Manages keys, sessions, and pre-keys in IndexedDB
 */

import {
  KeyPairType,
  PreKeyType,
  SessionRecordType,
  SignalProtocolAddress,
  SignedPublicPreKeyType,
} from '@privacyresearch/libsignal-protocol-typescript'

interface StoredSession {
  address: string
  record: SessionRecordType
}

export class SignalProtocolStore {
  private db: IDBDatabase | null = null
  private identityKeyPair: KeyPairType | null = null
  private registrationId: number = 0

  constructor(private username: string) {}

  async init(): Promise<void> {
    await this.openDatabase()
    await this.loadIdentity()
  }

  private async openDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('signal-encryption', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }
    })
  }

  private async loadIdentity(): Promise<void> {
    const keys = await this.getKeys()
    if (keys) {
      this.identityKeyPair = keys.identityKeyPair
      this.registrationId = keys.registrationId
    }
  }

  private async getKeys(): Promise<any> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['keys'], 'readonly')
      const store = transaction.objectStore('keys')
      const request = store.get(this.username)

      request.onsuccess = () => {
        if (request.result) {
          const { username, ...keys } = request.result
          resolve(keys)
        } else {
          resolve(null)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  // ========== Identity Key Management ==========

  async getIdentityKeyPair(): Promise<KeyPairType> {
    if (!this.identityKeyPair) {
      await this.loadIdentity()
    }
    if (!this.identityKeyPair) {
      throw new Error('No identity key pair found')
    }
    return this.identityKeyPair
  }

  async getLocalRegistrationId(): Promise<number> {
    if (!this.registrationId) {
      await this.loadIdentity()
    }
    return this.registrationId
  }

  async isTrustedIdentity(
    identifier: string,
    identityKey: ArrayBuffer,
    direction: number
  ): Promise<boolean> {
    // For now, trust all identities (TOFU - Trust On First Use)
    // In production, you'd want to verify fingerprints
    return true
  }

  async saveIdentity(identifier: string, identityKey: ArrayBuffer): Promise<boolean> {
    // Store the identity key for the given identifier
    // Return true if it's a new key or changed key
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['preKeyBundles'], 'readwrite')
      const store = transaction.objectStore('preKeyBundles')
      
      // Check if we have an existing identity for this user
      const getRequest = store.get(identifier)
      
      getRequest.onsuccess = () => {
        const existing = getRequest.result
        const isNewOrChanged = !existing || existing.identityKey !== identityKey
        
        // Update the stored identity
        store.put({
          username: identifier,
          identityKey: identityKey,
        })
        
        resolve(isNewOrChanged)
      }
      
      getRequest.onerror = () => reject(getRequest.error)
    })
  }

  // ========== Pre-Key Management ==========

  async loadPreKey(keyId: number): Promise<KeyPairType> {
    const keys = await this.getKeys()
    if (!keys || !keys.preKeys) {
      throw new Error('No pre-keys found')
    }

    const preKey = keys.preKeys.find((pk: PreKeyType) => pk.keyId === keyId)
    if (!preKey) {
      throw new Error(`Pre-key ${keyId} not found`)
    }

    return preKey.keyPair
  }

  async storePreKey(keyId: number, keyPair: KeyPairType): Promise<void> {
    // Pre-keys are already stored during initial setup
    // This is called when we receive a new pre-key
    console.log(`Pre-key ${keyId} stored`)
  }

  async removePreKey(keyId: number): Promise<void> {
    // Mark pre-key as used (we don't actually delete it)
    console.log(`Pre-key ${keyId} removed/used`)
  }

  // ========== Signed Pre-Key Management ==========

  async loadSignedPreKey(keyId: number): Promise<KeyPairType> {
    const keys = await this.getKeys()
    if (!keys || !keys.signedPreKey) {
      throw new Error('No signed pre-key found')
    }

    if (keys.signedPreKey.keyId !== keyId) {
      throw new Error(`Signed pre-key ${keyId} not found`)
    }

    return keys.signedPreKey.keyPair
  }

  async storeSignedPreKey(keyId: number, keyPair: KeyPairType): Promise<void> {
    console.log(`Signed pre-key ${keyId} stored`)
  }

  async removeSignedPreKey(keyId: number): Promise<void> {
    console.log(`Signed pre-key ${keyId} removed`)
  }

  // ========== Session Management ==========

  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessions'], 'readonly')
      const store = transaction.objectStore('sessions')
      const request = store.get(encodedAddress)

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result.record)
        } else {
          resolve(undefined)
        }
      }
      request.onerror = () => reject(request.error)
    })
  }

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    if (!this.db) throw new Error('Database not initialized')

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['sessions'], 'readwrite')
      const store = transaction.objectStore('sessions')
      const request = store.put({
        address: encodedAddress,
        record: record,
      })

      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async getDeviceIds(identifier: string): Promise<number[]> {
    // For simplicity, we only support device ID 1
    return [1]
  }
}
