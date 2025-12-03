/**
 * Signal Protocol Service
 * 
 * Main service for Signal Protocol encryption with multi-device support.
 * Handles device registration, key generation, session management,
 * and message encryption/decryption.
 */

import {
  KeyHelper,
  SignalProtocolAddress,
  SessionBuilder,
  SessionCipher,
} from '@privacyresearch/libsignal-protocol-typescript'
import { signalStore } from './SignalStore'
import type {
  DeviceInfo,
  DeviceRegistration,
  PreKeyBundle,
  DeviceCiphertext,
  EncryptionResult,
  DecryptionResult,
} from './types'

// Number of one-time prekeys to generate
const PREKEY_COUNT = 100
// Signed prekey rotation interval (7 days)
const SIGNED_PREKEY_ROTATION_MS = 7 * 24 * 60 * 60 * 1000

class SignalService {
  private initialized = false
  private currentUsername: string | null = null
  private currentDeviceId: number | null = null

  /**
   * Initialize the Signal Protocol for a user.
   * This will either load existing device registration or create a new one.
   */
  async init(username: string): Promise<{ isNewDevice: boolean; deviceId: number }> {
    this.currentUsername = username
    await signalStore.init(username)

    // Check if we already have a device registration
    const existingRegistration = await signalStore.getLocalRegistration()

    if (existingRegistration) {
      console.log('🔐 Signal: Found existing device registration, deviceId:', existingRegistration.deviceId)
      this.currentDeviceId = existingRegistration.deviceId
      this.initialized = true

      // Check if signed prekey needs rotation
      await this.maybeRotateSignedPreKey()

      return { isNewDevice: false, deviceId: existingRegistration.deviceId }
    }

    // New device - need to register
    console.log('🔐 Signal: No existing registration, will register as new device')
    const deviceId = await this.registerNewDevice()
    
    return { isNewDevice: true, deviceId }
  }

  /**
   * Register this as a new device for the current user.
   */
  async registerNewDevice(): Promise<number> {
    if (!this.currentUsername) throw new Error('User not initialized')

    console.log('🔐 Signal: Generating keys for new device...')

    // Generate identity key pair
    const identityKeyPair = await KeyHelper.generateIdentityKeyPair()
    
    // Generate registration ID
    const registrationId = KeyHelper.generateRegistrationId()

    // Generate signed prekey
    const signedPreKeyId = 1
    const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId)

    // Generate one-time prekeys
    const preKeys = await Promise.all(
      Array.from({ length: PREKEY_COUNT }, (_, i) => 
        KeyHelper.generatePreKey(i + 1)
      )
    )

    // Store identity key pair
    await signalStore.storeIdentityKeyPair(identityKeyPair)

    // Store signed prekey
    await signalStore.storeSignedPreKeyWithSignature(
      signedPreKeyId,
      signedPreKey.keyPair,
      signedPreKey.signature
    )

    // Store one-time prekeys
    for (const preKey of preKeys) {
      await signalStore.storePreKey(preKey.keyId, preKey.keyPair)
    }

    // Prepare registration data for server
    const registrationData = {
      registrationId,
      identityKeyPublic: signalStore.arrayBufferToBase64(identityKeyPair.pubKey),
      signedPreKey: {
        keyId: signedPreKeyId,
        publicKey: signalStore.arrayBufferToBase64(signedPreKey.keyPair.pubKey),
        signature: signalStore.arrayBufferToBase64(signedPreKey.signature),
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: signalStore.arrayBufferToBase64(pk.keyPair.pubKey),
      })),
    }

    // Register with server
    const response = await fetch('/api/signal/register-device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(registrationData),
    })

    if (!response.ok) {
      throw new Error(`Failed to register device: ${response.status}`)
    }

    const result = await response.json()
    if (!result.success || !result.deviceId) {
      throw new Error(result.error || 'Device registration failed')
    }

    const deviceId = result.deviceId

    // Store local registration
    const localRegistration: DeviceRegistration = {
      deviceId,
      deviceName: this.getDeviceName(),
      registrationId,
      identityKeyPair: {
        publicKey: signalStore.arrayBufferToBase64(identityKeyPair.pubKey),
        privateKey: signalStore.arrayBufferToBase64(identityKeyPair.privKey),
      },
      signedPreKey: {
        keyId: signedPreKeyId,
        publicKey: signalStore.arrayBufferToBase64(signedPreKey.keyPair.pubKey),
        privateKey: signalStore.arrayBufferToBase64(signedPreKey.keyPair.privKey),
        signature: signalStore.arrayBufferToBase64(signedPreKey.signature),
        timestamp: Date.now(),
      },
      preKeys: preKeys.map(pk => ({
        keyId: pk.keyId,
        publicKey: signalStore.arrayBufferToBase64(pk.keyPair.pubKey),
        privateKey: signalStore.arrayBufferToBase64(pk.keyPair.privKey),
      })),
    }

    await signalStore.storeLocalRegistration(localRegistration)

    this.currentDeviceId = deviceId
    this.initialized = true

    console.log('🔐 Signal: Device registered successfully, deviceId:', deviceId)
    return deviceId
  }

  /**
   * Get a friendly device name based on platform
   */
  private getDeviceName(): string {
    const ua = navigator.userAgent
    
    if (/iPhone|iPad|iPod/.test(ua)) {
      return 'iOS App'
    } else if (/Android/.test(ua)) {
      return 'Android'
    } else if (/Mac/.test(ua)) {
      return 'Mac Browser'
    } else if (/Windows/.test(ua)) {
      return 'Windows Browser'
    } else if (/Linux/.test(ua)) {
      return 'Linux Browser'
    }
    
    return 'Web Browser'
  }

  /**
   * Check and rotate signed prekey if needed
   */
  private async maybeRotateSignedPreKey(): Promise<void> {
    const registration = await signalStore.getLocalRegistration()
    if (!registration) return

    const signedPreKeyAge = Date.now() - registration.signedPreKey.timestamp
    if (signedPreKeyAge < SIGNED_PREKEY_ROTATION_MS) {
      return // Not time to rotate yet
    }

    console.log('🔐 Signal: Rotating signed prekey...')

    const identityKeyPair = await signalStore.getIdentityKeyPair()
    if (!identityKeyPair) throw new Error('Identity key not found')

    const newSignedPreKeyId = registration.signedPreKey.keyId + 1
    const newSignedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, newSignedPreKeyId)

    // Store locally
    await signalStore.storeSignedPreKeyWithSignature(
      newSignedPreKeyId,
      newSignedPreKey.keyPair,
      newSignedPreKey.signature
    )

    // Update server
    await fetch('/api/signal/update-signed-prekey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        deviceId: this.currentDeviceId,
        signedPreKey: {
          keyId: newSignedPreKeyId,
          publicKey: signalStore.arrayBufferToBase64(newSignedPreKey.keyPair.pubKey),
          signature: signalStore.arrayBufferToBase64(newSignedPreKey.signature),
        },
      }),
    })

    // Update local registration
    registration.signedPreKey = {
      keyId: newSignedPreKeyId,
      publicKey: signalStore.arrayBufferToBase64(newSignedPreKey.keyPair.pubKey),
      privateKey: signalStore.arrayBufferToBase64(newSignedPreKey.keyPair.privKey),
      signature: signalStore.arrayBufferToBase64(newSignedPreKey.signature),
      timestamp: Date.now(),
    }
    await signalStore.storeLocalRegistration(registration)

    // Remove old signed prekey
    await signalStore.removeSignedPreKey(registration.signedPreKey.keyId - 1)

    console.log('🔐 Signal: Signed prekey rotated')
  }

  /**
   * Get all devices for a user
   */
  async getUserDevices(username: string): Promise<DeviceInfo[]> {
    const response = await fetch(`/api/signal/devices/${encodeURIComponent(username)}`, {
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error(`Failed to get devices: ${response.status}`)
    }

    const result = await response.json()
    return result.devices || []
  }

  /**
   * Get prekey bundle for a specific device
   */
  async getPreKeyBundle(username: string, deviceId: number): Promise<PreKeyBundle | null> {
    const response = await fetch(
      `/api/signal/prekey-bundle/${encodeURIComponent(username)}/${deviceId}`,
      { credentials: 'include' }
    )

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get prekey bundle: ${response.status}`)
    }

    const result = await response.json()
    return result.bundle || null
  }

  /**
   * Encrypt a message for a recipient (all their devices)
   */
  async encryptMessage(recipientUsername: string, plaintext: string): Promise<EncryptionResult> {
    if (!this.initialized || !this.currentUsername || !this.currentDeviceId) {
      throw new Error('Signal Protocol not initialized')
    }

    // Get all devices for recipient
    const devices = await this.getUserDevices(recipientUsername)
    
    if (devices.length === 0) {
      return {
        deviceCiphertexts: [],
        failedDevices: [{ deviceId: 0, error: 'Recipient has no registered devices' }],
      }
    }

    const deviceCiphertexts: DeviceCiphertext[] = []
    const failedDevices: Array<{ deviceId: number; error: string }> = []

    // Encrypt for each device
    for (const device of devices) {
      try {
        const ciphertext = await this.encryptForDevice(
          recipientUsername,
          device.deviceId,
          plaintext
        )
        deviceCiphertexts.push(ciphertext)
      } catch (error) {
        console.error(`🔐 Failed to encrypt for device ${device.deviceId}:`, error)
        failedDevices.push({
          deviceId: device.deviceId,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    // Also encrypt for sender's OTHER devices (so they can read their own sent messages)
    if (recipientUsername !== this.currentUsername) {
      const myDevices = await this.getUserDevices(this.currentUsername)
      
      for (const device of myDevices) {
        if (device.deviceId === this.currentDeviceId) continue // Skip current device
        
        try {
          const ciphertext = await this.encryptForDevice(
            this.currentUsername,
            device.deviceId,
            plaintext
          )
          deviceCiphertexts.push(ciphertext)
        } catch (error) {
          console.error(`🔐 Failed to encrypt for own device ${device.deviceId}:`, error)
          // Don't add to failedDevices - sender's other devices failing is not critical
        }
      }
    }

    return { deviceCiphertexts, failedDevices }
  }

  /**
   * Encrypt for a specific device
   */
  private async encryptForDevice(
    username: string,
    deviceId: number,
    plaintext: string
  ): Promise<DeviceCiphertext> {
    const address = new SignalProtocolAddress(username, deviceId)
    const addressString = `${username}.${deviceId}`

    // Check if we have a session
    const hasSession = await signalStore.hasSession(addressString)

    if (!hasSession) {
      // Need to establish session using prekey bundle
      console.log(`🔐 Signal: Building session with ${addressString}`)
      await this.buildSession(username, deviceId)
    }

    // Encrypt message
    const sessionCipher = new SessionCipher(signalStore, address)
    const plaintextBuffer = new TextEncoder().encode(plaintext)
    const ciphertext = await sessionCipher.encrypt(plaintextBuffer.buffer)

    // Convert ciphertext body to ArrayBuffer
    let ciphertextBuffer: ArrayBuffer
    if (typeof ciphertext.body === 'string') {
      ciphertextBuffer = new TextEncoder().encode(ciphertext.body).buffer
    } else if (ciphertext.body) {
      ciphertextBuffer = ciphertext.body
    } else {
      throw new Error('Encryption produced empty ciphertext')
    }

    return {
      targetUsername: username,
      targetDeviceId: deviceId,
      senderDeviceId: this.currentDeviceId!,
      ciphertext: signalStore.arrayBufferToBase64(ciphertextBuffer),
      messageType: ciphertext.type,
    }
  }

  /**
   * Build a session with a remote device using X3DH
   */
  private async buildSession(username: string, deviceId: number): Promise<void> {
    const bundle = await this.getPreKeyBundle(username, deviceId)
    
    if (!bundle) {
      throw new Error(`No prekey bundle available for ${username}:${deviceId}`)
    }

    const address = new SignalProtocolAddress(username, deviceId)
    const sessionBuilder = new SessionBuilder(signalStore, address)

    // Convert bundle to format expected by libsignal
    const processedBundle = {
      registrationId: bundle.registrationId,
      identityKey: signalStore.base64ToArrayBuffer(bundle.identityKey),
      signedPreKey: {
        keyId: bundle.signedPreKey.keyId,
        publicKey: signalStore.base64ToArrayBuffer(bundle.signedPreKey.publicKey),
        signature: signalStore.base64ToArrayBuffer(bundle.signedPreKey.signature),
      },
      preKey: bundle.preKey ? {
        keyId: bundle.preKey.keyId,
        publicKey: signalStore.base64ToArrayBuffer(bundle.preKey.publicKey),
      } : undefined,
    }

    await sessionBuilder.processPreKey(processedBundle)
    console.log(`🔐 Signal: Session established with ${username}.${deviceId}`)
  }

  /**
   * Decrypt a message from a sender
   */
  async decryptMessage(
    senderUsername: string,
    senderDeviceId: number,
    ciphertextBase64: string,
    messageType: number
  ): Promise<DecryptionResult> {
    if (!this.initialized) {
      throw new Error('Signal Protocol not initialized')
    }

    console.log('🔐 Decrypting message:', {
      from: `${senderUsername}.${senderDeviceId}`,
      messageType,
      ciphertextLength: ciphertextBase64.length,
    })

    const address = new SignalProtocolAddress(senderUsername, senderDeviceId)
    const sessionCipher = new SessionCipher(signalStore, address)

    const ciphertextBuffer = signalStore.base64ToArrayBuffer(ciphertextBase64)
    console.log('🔐 Ciphertext buffer size:', ciphertextBuffer.byteLength)

    let plaintextBuffer: ArrayBuffer

    try {
      if (messageType === 3) {
        // PreKey message (first message in session)
        console.log('🔐 Decrypting as PreKey message (type 3)')
        plaintextBuffer = await sessionCipher.decryptPreKeyWhisperMessage(
          ciphertextBuffer,
          'binary'
        )
      } else {
        // Regular message
        console.log('🔐 Decrypting as regular message (type', messageType, ')')
        plaintextBuffer = await sessionCipher.decryptWhisperMessage(
          ciphertextBuffer,
          'binary'
        )
      }
    } catch (decryptError) {
      console.error('🔐 ❌ Decrypt error details:', {
        error: decryptError,
        errorMessage: decryptError instanceof Error ? decryptError.message : String(decryptError),
        senderAddress: `${senderUsername}.${senderDeviceId}`,
        messageType,
      })
      throw decryptError
    }

    const plaintext = new TextDecoder().decode(plaintextBuffer)
    console.log('🔐 ✅ Decrypted plaintext length:', plaintext.length)

    return {
      plaintext,
      senderAddress: `${senderUsername}.${senderDeviceId}`,
    }
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Get current device ID
   */
  getDeviceId(): number | null {
    return this.currentDeviceId
  }

  /**
   * Get current username
   */
  getUsername(): string | null {
    return this.currentUsername
  }

  /**
   * Unregister current device
   */
  async unregisterDevice(): Promise<void> {
    if (!this.currentDeviceId) return

    await fetch(`/api/signal/device/${this.currentDeviceId}`, {
      method: 'DELETE',
      credentials: 'include',
    })

    await signalStore.clearAll()
    
    this.initialized = false
    this.currentDeviceId = null
    this.currentUsername = null

    console.log('🔐 Signal: Device unregistered')
  }

  /**
   * Replenish one-time prekeys if running low
   */
  async replenishPreKeysIfNeeded(): Promise<void> {
    if (!this.initialized || !this.currentDeviceId) return

    const response = await fetch('/api/signal/prekey-count', {
      credentials: 'include',
    })

    if (!response.ok) return

    const { count } = await response.json()

    if (count >= PREKEY_COUNT / 2) return // Still have enough

    console.log('🔐 Signal: Replenishing prekeys...')

    const identityKeyPair = await signalStore.getIdentityKeyPair()
    if (!identityKeyPair) return

    const registration = await signalStore.getLocalRegistration()
    if (!registration) return

    // Generate new prekeys
    const maxExistingKeyId = Math.max(...registration.preKeys.map(pk => pk.keyId))
    const newPreKeys = await Promise.all(
      Array.from({ length: PREKEY_COUNT - count }, (_, i) =>
        KeyHelper.generatePreKey(maxExistingKeyId + i + 1)
      )
    )

    // Store locally
    for (const preKey of newPreKeys) {
      await signalStore.storePreKey(preKey.keyId, preKey.keyPair)
    }

    // Upload to server
    await fetch('/api/signal/upload-prekeys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        deviceId: this.currentDeviceId,
        preKeys: newPreKeys.map(pk => ({
          keyId: pk.keyId,
          publicKey: signalStore.arrayBufferToBase64(pk.keyPair.pubKey),
        })),
      }),
    })

    // Update local registration
    registration.preKeys.push(...newPreKeys.map(pk => ({
      keyId: pk.keyId,
      publicKey: signalStore.arrayBufferToBase64(pk.keyPair.pubKey),
      privateKey: signalStore.arrayBufferToBase64(pk.keyPair.privKey),
    })))
    await signalStore.storeLocalRegistration(registration)

    console.log(`🔐 Signal: Added ${newPreKeys.length} new prekeys`)
  }
}

// Singleton instance
export const signalService = new SignalService()
