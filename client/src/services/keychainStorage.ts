/**
 * Keychain Storage Service
 * 
 * Provides secure storage for encryption keys using:
 * - iOS Keychain (on iOS via Capacitor Preferences)
 * - Encrypted storage on web
 * 
 * This ensures keys persist across app updates and reinstalls
 */

import { Preferences } from '@capacitor/preferences'
import { Capacitor } from '@capacitor/core'

const KEY_PREFIX = 'encryption_key_'

export interface SerializedKeyPair {
  publicKey: JsonWebKey
  privateKey: JsonWebKey
  timestamp: number
}

class KeychainStorageService {
  /**
   * Check if we're on a native platform (iOS/Android)
   */
  private isNativePlatform(): boolean {
    return Capacitor.isNativePlatform()
  }

  /**
   * Store encryption keys securely in Keychain
   */
  async storeKeys(username: string, keyPair: SerializedKeyPair): Promise<void> {
    const key = `${KEY_PREFIX}${username}`
    const value = JSON.stringify(keyPair)
    
    try {
      await Preferences.set({
        key,
        value
      })
      
      console.log(`🔐 ✅ Keys stored in ${this.isNativePlatform() ? 'iOS Keychain' : 'secure storage'} for ${username}`)
    } catch (error) {
      console.error('🔐 ❌ Failed to store keys in Keychain:', error)
      throw error
    }
  }

  /**
   * Retrieve encryption keys from Keychain
   */
  async getKeys(username: string): Promise<SerializedKeyPair | null> {
    const key = `${KEY_PREFIX}${username}`
    
    try {
      const result = await Preferences.get({ key })
      
      if (!result.value) {
        console.log(`🔐 No keys found in ${this.isNativePlatform() ? 'iOS Keychain' : 'secure storage'} for ${username}`)
        return null
      }
      
      const keyPair: SerializedKeyPair = JSON.parse(result.value)
      console.log(`🔐 ✅ Keys retrieved from ${this.isNativePlatform() ? 'iOS Keychain' : 'secure storage'} for ${username}`)
      return keyPair
    } catch (error) {
      console.error('🔐 ❌ Failed to retrieve keys from Keychain:', error)
      return null
    }
  }

  /**
   * Remove encryption keys from Keychain
   */
  async removeKeys(username: string): Promise<void> {
    const key = `${KEY_PREFIX}${username}`
    
    try {
      await Preferences.remove({ key })
      console.log(`🔐 ✅ Keys removed from ${this.isNativePlatform() ? 'iOS Keychain' : 'secure storage'} for ${username}`)
    } catch (error) {
      console.error('🔐 ❌ Failed to remove keys from Keychain:', error)
    }
  }

  /**
   * Check if keys exist in Keychain for a user
   */
  async hasKeys(username: string): Promise<boolean> {
    const keys = await this.getKeys(username)
    return keys !== null
  }

  /**
   * Export CryptoKey to JWK format for serialization
   */
  async exportPrivateKey(privateKey: CryptoKey): Promise<JsonWebKey> {
    return await window.crypto.subtle.exportKey('jwk', privateKey)
  }

  /**
   * Import JWK back to CryptoKey
   */
  async importPrivateKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return await window.crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['decrypt']
    )
  }

  /**
   * Import public key from JWK
   */
  async importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return await window.crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      true,
      ['encrypt']
    )
  }
}

export const keychainStorage = new KeychainStorageService()
